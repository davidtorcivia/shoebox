import json
import time
from pathlib import Path

import numpy as np
import pytest

import dbq
import main


class FakeFace:
    def __init__(self, axis: int = 0):
        self.bbox = np.array([10, 20, 50, 70], dtype=np.float32)
        self.embedding = np.zeros(512, dtype=np.float32)
        self.embedding[axis] = 1.0


class FakeAnalyzer:
    def __init__(self, faces=None):
        self.faces = faces if faces is not None else [FakeFace()]
        self.calls = 0

    def get(self, _image):
        self.calls += 1
        return self.faces


class FakeCapture:
    def __init__(self, frame_count: int, fps: float = 1.0):
        self.frame_count = frame_count
        self.fps = fps
        self.index = 0
        self.released = False

    def get(self, prop):
        if prop == FakeCv2.CAP_PROP_FPS:
            return self.fps
        if prop == FakeCv2.CAP_PROP_FRAME_COUNT:
            return self.frame_count
        return 0

    def read(self):
        if self.index >= self.frame_count:
            return False, None
        self.index += 1
        return True, np.zeros((100, 100, 3), dtype=np.uint8)

    def release(self):
        self.released = True


class FakeCv2:
    CAP_PROP_FPS = 5
    CAP_PROP_FRAME_COUNT = 7

    def __init__(self, capture=None):
        self.capture = capture
        self.imread_path = None

    def imread(self, path):
        self.imread_path = path
        return np.zeros((100, 100, 3), dtype=np.uint8)

    def VideoCapture(self, _path):
        return self.capture


def add_item(conn, item_type="photo", storage_key="media/it1/original.jpg"):
    conn.execute(
        "INSERT INTO items (id, type, width, height, size_bytes, sha256, source, status, uploaded_by, created_at) "
        "VALUES ('it1', ?, 100, 100, 1000, 'aa', 'upload', 'ready', 'u1', 0)",
        (item_type,),
    )
    conn.execute(
        "INSERT INTO item_files (id, item_id, kind, storage_key, mime) VALUES ('if1', 'it1', 'original', ?, 'image/jpeg')",
        (storage_key,),
    )


def add_job(conn, attempts=0):
    conn.execute(
        "INSERT INTO jobs (id, kind, payload, status, attempts, run_after, created_at) VALUES (?,?,?,?,?,?,?)",
        ("job1", "face_scan", json.dumps({"itemId": "it1"}), "running", attempts, 0, 0),
    )
    return {"id": "job1", "payload": {"itemId": "it1"}}


def test_scan_photo_normalizes_boxes_and_serializes_embeddings(monkeypatch, tmp_path):
    fake_cv2 = FakeCv2()
    monkeypatch.setattr(main, "load_cv2", lambda: fake_cv2)

    detections = main.scan_photo(tmp_path / "photo.jpg", FakeAnalyzer())

    assert fake_cv2.imread_path == str(tmp_path / "photo.jpg")
    assert detections == [
        {
            "frame_time": None,
            "box": {"x": 0.1, "y": 0.2, "w": 0.4, "h": 0.5},
            "embedding": FakeFace().embedding.tobytes(),
        }
    ]


def test_scan_video_samples_one_fps_and_caps_at_sixty(monkeypatch, tmp_path):
    fake_cv2 = FakeCv2(FakeCapture(frame_count=90, fps=1.0))
    analyzer = FakeAnalyzer()
    monkeypatch.setattr(main, "load_cv2", lambda: fake_cv2)

    detections = main.scan_video(tmp_path / "clip.mp4", analyzer)

    assert analyzer.calls == 60
    assert len(detections) == 60
    assert detections[0]["frame_time"] == 0.0
    assert detections[-1]["frame_time"] == 59.0
    assert fake_cv2.capture.released is True


def test_process_job_fails_when_original_is_missing(db, tmp_path):
    add_job(db)

    assert main.process_job(db, tmp_path, FakeAnalyzer(), {"id": "job1", "payload": {"itemId": "it1"}}) is False
    row = db.execute("SELECT status, run_after FROM jobs WHERE id='job1'").fetchone()
    assert row["status"] == "pending"
    assert row["run_after"] >= int(time.time()) + 60


def test_process_job_replaces_pending_faces_reclusters_and_completes(db, monkeypatch, tmp_path):
    media_path = tmp_path / "media-root"
    original = media_path / "media/it1/original.jpg"
    original.parent.mkdir(parents=True)
    original.write_bytes(b"photo")
    add_item(db)
    add_job(db)
    db.execute(
        "INSERT INTO faces (id, item_id, frame_time, box, embedding, status) VALUES ('old', 'it1', NULL, '{}', ?, 'pending')",
        (np.zeros(512, dtype=np.float32).tobytes(),),
    )
    monkeypatch.setattr(main, "load_cv2", lambda: FakeCv2())
    analyzer = FakeAnalyzer([FakeFace(0), FakeFace(0), FakeFace(0)])

    assert main.process_job(db, media_path, analyzer, {"id": "job1", "payload": {"itemId": "it1"}}) is True

    rows = db.execute("SELECT id, cluster_id, status FROM faces ORDER BY id").fetchall()
    assert "old" not in {row["id"] for row in rows}
    assert {row["status"] for row in rows} == {"pending"}
    assert len({row["cluster_id"] for row in rows}) == 1
    assert db.execute("SELECT status FROM jobs WHERE id='job1'").fetchone()["status"] == "done"


def test_process_job_rejects_storage_key_escape(db, monkeypatch, tmp_path):
    # A tampered item_files row must never point the decoder outside MEDIA_PATH.
    add_item(db, storage_key="../../etc/passwd")
    add_job(db)
    fake_cv2 = FakeCv2()
    monkeypatch.setattr(main, "load_cv2", lambda: fake_cv2)

    result = main.process_job(db, tmp_path, FakeAnalyzer(), {"id": "job1", "payload": {"itemId": "it1"}})

    assert result is False
    assert fake_cv2.imread_path is None  # decoder never handed the escaped path
    row = db.execute("SELECT status FROM jobs WHERE id='job1'").fetchone()
    assert row["status"] == "pending"  # failed -> backed off, not crashed


def test_run_loop_survives_process_job_raising(monkeypatch, tmp_path):
    # Even if process_job (or fail_job) raises unexpectedly, the loop must keep
    # running rather than tearing the worker down.
    step = {"n": 0}

    def fake_claim(_conn):
        step["n"] += 1
        if step["n"] == 1:
            return {"id": "job1", "payload": {"itemId": "it1"}}
        # BaseException intentionally escapes run_loop's `except Exception` to stop the loop.
        raise SystemExit("break")

    def boom(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(dbq, "claim_face_scan_job", fake_claim)
    monkeypatch.setattr(main, "process_job", boom)
    monkeypatch.setattr(time, "sleep", lambda *_: None)

    # If run_loop failed to catch the RuntimeError it would propagate instead of
    # the SystemExit we use to terminate the loop -> the assertion would fail.
    with pytest.raises(SystemExit):
        main.run_loop(str(tmp_path / "ignored.db"), str(tmp_path), analyzer=object(), poll_interval=0)

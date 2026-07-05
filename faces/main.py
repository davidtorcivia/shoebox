"""Faces worker entrypoint.

The worker claims face_scan jobs from the shared SQLite database, scans the
item original, stores fresh pending faces, reclusters pending/confirmed faces,
and marks the job complete. Person assignment is intentionally absent here;
human review owns that later.
"""

import os
import time
from pathlib import Path

import numpy as np

import cluster
import dbq
from boxes import normalize_box

PHOTO_TYPES = {"photo"}
VIDEO_TYPES = {"video"}
MAX_VIDEO_FRAMES = 60


def load_cv2():
    import cv2

    return cv2


def create_analyzer():
    from insightface.app import FaceAnalysis

    root = os.environ.get("INSIGHTFACE_HOME", "/models")
    analyzer = FaceAnalysis(name="buffalo_l", root=root, providers=["CPUExecutionProvider"])
    analyzer.prepare(ctx_id=0, det_size=(640, 640))
    return analyzer


def _detection(face, frame_time: float | None, img_w: int, img_h: int) -> dict:
    x1, y1, x2, y2 = face.bbox
    embedding = np.asarray(face.embedding, dtype="<f4")
    return {
        "frame_time": frame_time,
        "box": normalize_box(x1, y1, x2, y2, img_w, img_h),
        "embedding": embedding.tobytes(),
    }


def scan_photo(path: Path | str, analyzer) -> list[dict]:
    cv2 = load_cv2()
    image = cv2.imread(str(path))
    if image is None:
        raise FileNotFoundError(f"could not read image {path}")
    img_h, img_w = image.shape[:2]
    return [_detection(face, None, img_w, img_h) for face in analyzer.get(image)]


def scan_video(path: Path | str, analyzer) -> list[dict]:
    cv2 = load_cv2()
    cap = cv2.VideoCapture(str(path))
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 1.0)
    if fps <= 0:
        fps = 1.0
    stride = max(1, round(fps))
    detections: list[dict] = []
    frame_index = 0
    sampled = 0

    try:
        while sampled < MAX_VIDEO_FRAMES:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_index % stride == 0:
                img_h, img_w = frame.shape[:2]
                frame_time = round(frame_index / fps, 3)
                detections.extend(
                    _detection(face, frame_time, img_w, img_h) for face in analyzer.get(frame)
                )
                sampled += 1
            frame_index += 1
    finally:
        cap.release()

    return detections


def process_job(conn, media_path: Path | str, analyzer, job: dict) -> bool:
    try:
        item_id = job["payload"]["itemId"]
        storage_key, item_type = dbq.original_path(conn, item_id)
        original = Path(media_path) / storage_key
        if item_type in PHOTO_TYPES:
            detections = scan_photo(original, analyzer)
        elif item_type in VIDEO_TYPES:
            detections = scan_video(original, analyzer)
        else:
            raise ValueError(f"unsupported item type {item_type}")

        dbq.replace_pending_faces(conn, item_id, detections)
        assignments = cluster.recluster(dbq.load_embeddings_for_clustering(conn))
        dbq.apply_cluster_assignments(conn, assignments)
        dbq.complete_job(conn, job["id"])
        return True
    except Exception:
        dbq.fail_job(conn, job["id"])
        return False


def run_loop(
    db_path: str,
    media_path: str,
    analyzer=None,
    poll_interval: float | None = None,
):
    interval = poll_interval if poll_interval is not None else float(os.environ.get("FACE_POLL_INTERVAL_SECONDS", "5"))
    worker_analyzer = analyzer if analyzer is not None else create_analyzer()
    conn = dbq.connect(db_path)
    try:
        while True:
            job = dbq.claim_face_scan_job(conn)
            if job is None:
                time.sleep(interval)
                continue
            process_job(conn, media_path, worker_analyzer, job)
    finally:
        conn.close()


def main():
    db_path = os.environ["DATABASE_PATH"]
    media_path = os.environ["MEDIA_PATH"]
    run_loop(db_path, media_path)


if __name__ == "__main__":
    main()

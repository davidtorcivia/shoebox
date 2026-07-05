import json
import time

import numpy as np
import pytest

import dbq

NOW = int(time.time())


def add_job(
    conn,
    job_id,
    run_after=NOW - 10,
    status="pending",
    attempts=0,
    created_at=NOW - 10,
    kind="face_scan",
):
    conn.execute(
        "INSERT INTO jobs (id, kind, payload, status, attempts, run_after, created_at) VALUES (?,?,?,?,?,?,?)",
        (job_id, kind, json.dumps({"itemId": "it1"}), status, attempts, run_after, created_at),
    )


def add_face(conn, face_id, item_id="it1", status="pending", cluster_id=None, embedding=None):
    emb = embedding if embedding is not None else np.zeros(512, dtype=np.float32).tobytes()
    conn.execute(
        "INSERT INTO faces (id, item_id, frame_time, box, embedding, cluster_id, person_id, status) VALUES (?,?,?,?,?,?,NULL,?)",
        (face_id, item_id, None, '{"h":0.2,"w":0.2,"x":0.1,"y":0.1}', emb, cluster_id, status),
    )


def test_connect_sets_busy_timeout(db):
    assert db.execute("PRAGMA busy_timeout").fetchone()[0] == 5000


def test_claim_returns_oldest_runnable_and_marks_running(db):
    add_job(db, "j2", created_at=NOW - 5)
    add_job(db, "j1", created_at=NOW - 50)
    job = dbq.claim_face_scan_job(db)
    assert job == {"id": "j1", "payload": {"itemId": "it1"}}
    row = db.execute("SELECT status, attempts FROM jobs WHERE id='j1'").fetchone()
    assert row["status"] == "running" and row["attempts"] == 1


def test_claim_skips_future_running_and_other_kinds(db):
    add_job(db, "future", run_after=NOW + 3600)
    add_job(db, "busy", status="running")
    add_job(db, "other", kind="derivatives")
    assert dbq.claim_face_scan_job(db) is None


def test_claimed_job_is_not_reclaimed(db):
    add_job(db, "j1")
    assert dbq.claim_face_scan_job(db)["id"] == "j1"
    assert dbq.claim_face_scan_job(db) is None


def test_complete_job(db):
    add_job(db, "j1")
    dbq.claim_face_scan_job(db)
    dbq.complete_job(db, "j1")
    assert db.execute("SELECT status FROM jobs WHERE id='j1'").fetchone()["status"] == "done"


def test_fail_job_backs_off_then_fails_permanently(db):
    add_job(db, "j1")
    dbq.claim_face_scan_job(db)
    dbq.fail_job(db, "j1")
    row = db.execute("SELECT status, run_after FROM jobs WHERE id='j1'").fetchone()
    assert row["status"] == "pending"
    assert row["run_after"] >= NOW + 60 * 2

    db.execute("UPDATE jobs SET attempts = 5 WHERE id='j1'")
    dbq.fail_job(db, "j1")
    assert db.execute("SELECT status FROM jobs WHERE id='j1'").fetchone()["status"] == "failed"


def test_original_path(db):
    db.execute(
        "INSERT INTO items (id, type, width, height, size_bytes, sha256, source, status, uploaded_by, created_at) "
        "VALUES ('it1','photo',400,300,1000,'aa','upload','ready','u1',0)"
    )
    db.execute(
        "INSERT INTO item_files (id, item_id, kind, storage_key, mime) "
        "VALUES ('if1','it1','original','media/it1/original.jpg','image/jpeg')"
    )
    assert dbq.original_path(db, "it1") == ("media/it1/original.jpg", "photo")
    with pytest.raises(LookupError):
        dbq.original_path(db, "missing")


def test_replace_pending_faces_keeps_confirmed(db):
    add_face(db, "old_pending", status="pending")
    add_face(db, "kept_confirmed", status="confirmed", cluster_id="c1")
    detections = [
        {
            "frame_time": None,
            "box": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
            "embedding": np.ones(512, dtype=np.float32).tobytes(),
        },
        {
            "frame_time": 3.0,
            "box": {"x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1},
            "embedding": np.ones(512, dtype=np.float32).tobytes(),
        },
    ]
    new_ids = dbq.replace_pending_faces(db, "it1", detections)
    assert len(new_ids) == 2
    rows = db.execute("SELECT id, status, box, embedding, frame_time FROM faces ORDER BY status").fetchall()
    ids = {r["id"] for r in rows}
    assert "old_pending" not in ids and "kept_confirmed" in ids
    pending = [r for r in rows if r["status"] == "pending"]
    assert len(pending) == 2
    assert all(len(r["embedding"]) == 2048 for r in pending)
    assert json.loads(pending[0]["box"]) == {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}


def test_load_embeddings_excludes_rejected(db):
    add_face(db, "p1", status="pending")
    add_face(
        db,
        "c1f",
        status="confirmed",
        cluster_id="c1",
        embedding=np.full(512, 0.5, dtype=np.float32).tobytes(),
    )
    add_face(db, "r1", status="rejected")
    rows = dbq.load_embeddings_for_clustering(db)
    assert {r["id"] for r in rows} == {"p1", "c1f"}
    by_id = {r["id"]: r for r in rows}
    assert by_id["c1f"]["cluster_id"] == "c1"
    assert by_id["c1f"]["embedding"].dtype == np.float32
    assert by_id["c1f"]["embedding"].shape == (512,)
    assert by_id["c1f"]["embedding"][0] == np.float32(0.5)


def test_apply_cluster_assignments(db):
    add_face(db, "a")
    add_face(db, "b", cluster_id="stale")
    dbq.apply_cluster_assignments(db, {"a": "c9", "b": None})
    rows = {r["id"]: r["cluster_id"] for r in db.execute("SELECT id, cluster_id FROM faces").fetchall()}
    assert rows == {"a": "c9", "b": None}

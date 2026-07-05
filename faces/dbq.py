"""SQLite access for the faces worker.

The faces container uses the same SQLite file as the SvelteKit app and Node
worker. Claiming mirrors the Node worker pattern: BEGIN IMMEDIATE, select the
oldest runnable job, update it, then commit.
"""

import json
import sqlite3
import time

import numpy as np

from boxes import box_json
from ids import nanoid

MAX_ATTEMPTS = 5


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def claim_face_scan_job(conn: sqlite3.Connection) -> dict | None:
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute(
            "SELECT id, payload FROM jobs "
            "WHERE kind = 'face_scan' AND status = 'pending' AND run_after <= ? "
            "ORDER BY created_at LIMIT 1",
            (int(time.time()),),
        ).fetchone()
        if row is None:
            conn.execute("COMMIT")
            return None

        conn.execute(
            "UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?",
            (row["id"],),
        )
        conn.execute("COMMIT")
        return {"id": row["id"], "payload": json.loads(row["payload"])}
    except Exception:
        conn.execute("ROLLBACK")
        raise


def complete_job(conn: sqlite3.Connection, job_id: str) -> None:
    conn.execute("UPDATE jobs SET status = 'done' WHERE id = ?", (job_id,))


def fail_job(conn: sqlite3.Connection, job_id: str) -> None:
    row = conn.execute("SELECT attempts FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        return

    if row["attempts"] >= MAX_ATTEMPTS:
        conn.execute("UPDATE jobs SET status = 'failed' WHERE id = ?", (job_id,))
        return

    delay = 60 * (2**row["attempts"])
    conn.execute(
        "UPDATE jobs SET status = 'pending', run_after = ? WHERE id = ?",
        (int(time.time()) + delay, job_id),
    )


def original_path(conn: sqlite3.Connection, item_id: str) -> tuple[str, str]:
    row = conn.execute(
        "SELECT i.type AS item_type, f.storage_key AS storage_key "
        "FROM items i JOIN item_files f ON f.item_id = i.id AND f.kind = 'original' "
        "WHERE i.id = ?",
        (item_id,),
    ).fetchone()
    if row is None:
        raise LookupError(f"no original file for item {item_id}")
    return row["storage_key"], row["item_type"]


def replace_pending_faces(conn: sqlite3.Connection, item_id: str, detections: list[dict]) -> list[str]:
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM faces WHERE item_id = ? AND status = 'pending'", (item_id,))
        new_ids = []
        for detection in detections:
            face_id = nanoid()
            conn.execute(
                "INSERT INTO faces (id, item_id, frame_time, box, embedding, cluster_id, person_id, status) "
                "VALUES (?, ?, ?, ?, ?, NULL, NULL, 'pending')",
                (
                    face_id,
                    item_id,
                    detection["frame_time"],
                    box_json(detection["box"]),
                    detection["embedding"],
                ),
            )
            new_ids.append(face_id)
        conn.execute("COMMIT")
        return new_ids
    except Exception:
        conn.execute("ROLLBACK")
        raise


def load_embeddings_for_clustering(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT id, cluster_id, embedding FROM faces WHERE status IN ('pending','confirmed')"
    ).fetchall()
    return [
        {
            "id": row["id"],
            "cluster_id": row["cluster_id"],
            "embedding": np.frombuffer(row["embedding"], dtype=np.float32),
        }
        for row in rows
    ]


def apply_cluster_assignments(conn: sqlite3.Connection, assignments: dict[str, str | None]) -> None:
    conn.execute("BEGIN IMMEDIATE")
    try:
        for face_id, cluster_id in assignments.items():
            conn.execute("UPDATE faces SET cluster_id = ? WHERE id = ?", (cluster_id, face_id))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise

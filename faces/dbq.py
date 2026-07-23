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
    conn.execute("PRAGMA foreign_keys = ON")
    ensure_face_clusters_table(conn)
    return conn


def ensure_face_clusters_table(conn: sqlite3.Connection) -> None:
    """Create the Python-owned centroid store if it is missing.

    The Node/Drizzle side owns every table it knows about; this one is private to
    the faces worker, which is why it lives behind ``CREATE TABLE IF NOT EXISTS``
    here rather than in a shared migration. It stores the mean embedding per
    stable cluster id so reclusters can rematch a cluster to its id even after all
    of its member faces were replaced.
    """
    conn.execute(
        "CREATE TABLE IF NOT EXISTS face_clusters ("
        "id TEXT PRIMARY KEY, centroid BLOB NOT NULL, "
        "count INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)"
    )


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
        "SELECT id, item_id, frame_time, cluster_id, person_id, status, embedding "
        "FROM faces WHERE status IN ('pending','confirmed')"
    ).fetchall()
    return [
        {
            "id": row["id"],
            "item_id": row["item_id"],
            "frame_time": row["frame_time"],
            "cluster_id": row["cluster_id"],
            "person_id": row["person_id"],
            "status": row["status"],
            "embedding": np.frombuffer(row["embedding"], dtype=np.float32),
        }
        for row in rows
    ]


def pending_face_ids(conn: sqlite3.Connection, item_id: str) -> list[str]:
    rows = conn.execute(
        "SELECT id FROM faces WHERE item_id = ? AND status = 'pending'", (item_id,)
    ).fetchall()
    return [row["id"] for row in rows]


def rejected_embeddings(conn: sqlite3.Connection, item_id: str) -> np.ndarray:
    """Embeddings of this item's rejected faces, as an (n, 512) float array.

    A rescan re-mints face ids, so without these fingerprints every face the
    admin already rejected would resurface as a fresh pending suggestion.
    """
    rows = conn.execute(
        "SELECT embedding FROM faces WHERE item_id = ? AND status = 'rejected'", (item_id,)
    ).fetchall()
    if not rows:
        return np.zeros((0, 0))
    return np.stack(
        [np.frombuffer(row["embedding"], dtype=np.float32).astype(np.float64) for row in rows]
    )


def apply_person_suggestions(conn: sqlite3.Connection, by_cluster: dict[str, str]) -> None:
    """Stamp each pending face with its cluster's best confirmed-person match.

    Suggestions are recomputed wholesale every run: stale ones are cleared first
    so a cluster that drifted away from a person stops advertising them. Pairs
    the admin dismissed ("not them", face_suggestion_dismissals) are never
    re-stamped. Tolerant of the column/table not existing yet (app migration not
    applied), since the Python worker can restart ahead of the app after a joint
    deploy.
    """
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "UPDATE faces SET suggested_person_id = NULL "
            "WHERE status = 'pending' AND suggested_person_id IS NOT NULL"
        )
        for cluster_id, person_id in by_cluster.items():
            conn.execute(
                "UPDATE faces SET suggested_person_id = ? "
                "WHERE cluster_id = ? AND status = 'pending' "
                "AND NOT EXISTS (SELECT 1 FROM face_suggestion_dismissals d "
                "WHERE d.item_id = faces.item_id AND d.person_id = ?)",
                (person_id, cluster_id, person_id),
            )
        conn.execute("COMMIT")
    except sqlite3.OperationalError as exc:
        conn.execute("ROLLBACK")
        if "suggested_person_id" in str(exc) or "face_suggestion_dismissals" in str(exc):
            print(f"[faces] skipping person suggestions: {exc}", flush=True)
            return
        raise
    except Exception:
        conn.execute("ROLLBACK")
        raise


def apply_cluster_assignments(conn: sqlite3.Connection, assignments: dict[str, str | None]) -> None:
    conn.execute("BEGIN IMMEDIATE")
    try:
        for face_id, cluster_id in assignments.items():
            conn.execute("UPDATE faces SET cluster_id = ? WHERE id = ?", (cluster_id, face_id))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def load_cluster_centroids(conn: sqlite3.Connection) -> dict[str, np.ndarray]:
    """Stored centroid per stable cluster id, keyed for centroid rematching."""
    rows = conn.execute("SELECT id, centroid FROM face_clusters").fetchall()
    return {
        row["id"]: np.frombuffer(row["centroid"], dtype="<f4").astype(np.float64)
        for row in rows
    }


def save_cluster_centroids(
    conn: sqlite3.Connection,
    centroids: dict[str, tuple[np.ndarray, int]],
) -> None:
    """Upsert the current centroid fingerprint for each live cluster id.

    Ids that no longer have faces are left in place on purpose: a person who
    briefly drops below the clustering threshold can still reclaim their id when
    they reappear.
    """
    if not centroids:
        return
    now = int(time.time())
    conn.execute("BEGIN IMMEDIATE")
    try:
        for cluster_id, (vector, count) in centroids.items():
            blob = np.asarray(vector, dtype="<f4").tobytes()
            conn.execute(
                "INSERT INTO face_clusters (id, centroid, count, updated_at) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET "
                "centroid = excluded.centroid, count = excluded.count, updated_at = excluded.updated_at",
                (cluster_id, blob, int(count), now),
            )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise

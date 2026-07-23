"""SQLite fixture for the tables the faces worker touches.

Production DDL is owned by the SvelteKit/Drizzle migrations. This fixture keeps
the Python worker tests focused on the shared table contract.
"""

import pytest

import dbq

SCHEMA = """
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL, accent_color TEXT NOT NULL, avatar_storage_key TEXT,
  avatar_mime TEXT, person_id TEXT, comfort_mode INTEGER NOT NULL DEFAULT 0,
  theme TEXT NOT NULL DEFAULT 'system', created_at INTEGER NOT NULL
);
CREATE TABLE items (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, description TEXT,
  date_start TEXT, date_end TEXT, date_precision TEXT NOT NULL DEFAULT 'unknown',
  sort_date TEXT, duration REAL, width INTEGER NOT NULL, height INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, source TEXT NOT NULL,
  tape_label TEXT, status TEXT NOT NULL, uploaded_by TEXT NOT NULL,
  deleted_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE item_files (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL, kind TEXT NOT NULL,
  storage_key TEXT NOT NULL, mime TEXT NOT NULL, width INTEGER, height INTEGER
);
CREATE TABLE faces (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL, frame_time REAL, box TEXT NOT NULL,
  embedding BLOB NOT NULL, cluster_id TEXT, person_id TEXT,
  suggested_person_id TEXT, status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE face_suggestion_dismissals (
  item_id TEXT NOT NULL, person_id TEXT NOT NULL,
  PRIMARY KEY(item_id, person_id)
);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL, created_at INTEGER NOT NULL
);
"""


@pytest.fixture
def db(tmp_path):
    conn = dbq.connect(str(tmp_path / "shoebox.db"))
    conn.executescript(SCHEMA)
    yield conn
    conn.close()

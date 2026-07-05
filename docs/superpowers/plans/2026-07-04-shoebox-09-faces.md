# Shoebox Phase 09 — Face ML Container & Review UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the optional, Docker-only faces subsystem: a Python 3.12 container that claims `face_scan` jobs from the shared SQLite database, detects + embeds faces with InsightFace (buffalo_l), clusters them with incremental HDBSCAN under a stable-cluster-id rule, plus a SvelteKit suggestion API and an `/admin/faces` review UI ("Are these all the same person?") that assigns people only after human confirmation.

**Architecture:** The `faces/` container is a sibling job consumer: it volume-mounts the same SQLite file (`DATABASE_PATH`) and media directory (`MEDIA_PATH`) as the Node worker and claims `jobs` rows of kind `face_scan` using the same `BEGIN IMMEDIATE` claiming discipline (busy_timeout 5000). It writes `faces` rows (normalized box JSON, float32[512] embedding blob, `status='pending'`), then reclusters ALL pending+confirmed embeddings; cluster ids are kept stable across runs by centroid matching (cosine > 0.65 keeps the old id). The Node side only (a) enqueues `face_scan` after successful `derivatives` jobs when `FACES_ENABLED=1`, and (b) serves feature-gated suggestion/review endpoints and UI. `Platform.features.faces` is `false` on Cloudflare always and on Docker unless `FACES_ENABLED=1` — every route, nav link, and UI element in this phase hides behind it. No auto-assignment: `person_id` is only set through the review UI's Assign action.

**Tech Stack:** Python 3.12 (insightface 0.7.3 + onnxruntime CPU, opencv-python-headless, numpy, hdbscan, stdlib `sqlite3`), pytest; SvelteKit 2 + Svelte 5 (runes), TypeScript strict, Drizzle ORM + better-sqlite3, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-04-shoebox-design.md` §7 "Face ML (Docker, optional)" — detection/clustering/review-card behavior is gospel. FORBIDDEN: cloud face APIs, CF-side ML, and any auto-assign of `person_id` without human confirmation.

**Depends on:** Phase 01 (schema, auth, platform), Phase 06 (`reindexItem`), Phase 07 (worker job runner in `src/worker/`).

## Global Constraints

**Master plan:** `docs/superpowers/plans/2026-07-04-shoebox-00-master.md` — its contracts (Contract 1 schema incl. the `faces` table and `jobs.kind='face_scan'`, Contract 2 `Platform.features.faces`, Contract 6 API conventions) are LAW. If this plan conflicts with the master, the master wins.

- **Node ≥ 22**, pnpm ≥ 9, TypeScript `strict: true`. ESM only.
- **Never use the Inter font.** Serif = Fraunces (roman only — `font-style: italic` is forbidden app-wide). Sans = Archivo. Monospace appears ONLY as grid-thumbnail duration badges.
- **Zero `border-radius`** anywhere. No `backdrop-filter`/glassmorphism. No borders on media. No play-button overlays on thumbnails.
- All UI colors come from `src/lib/ui/tokens.ts` — never hard-code hex in components.
- WCAG AA contrast both themes; `prefers-reduced-motion` honored (all decorative animation gated by the `reducedMotion` store); touch targets ≥ 44px; base font ≥ 16px.
- Every user-facing destructive action = soft delete (`deleted_at`), 30-day trash.
- All API routes validate the session and role server-side (see §Auth). CSRF: SvelteKit form actions' origin check + `SameSite=Lax` cookie.
- Runtime-portable server code: nothing in `src/lib/server/` (outside `platform/node*` files and `worker/`) may import `node:*` modules, `sharp`, `ffmpeg`, or `better-sqlite3`.
- Tests: Vitest for units (`*.test.ts` beside source), Playwright e2e in `e2e/`. Every phase plan ends with its e2e green.
- Commits: conventional (`feat:`, `fix:`, `test:`, `chore:`), small, after each green test cycle.
- Copy rules: triage page is called **Arrivals**; comment placeholder is **"Add a memory…"**; circa dates render as **"c. 1994"**.

Phase-09 additions (from spec §7, binding for every task below):

- The Python container talks ONLY to the shared SQLite file and the media volume. No network calls at runtime (models are baked at image build).
- Face detection model: InsightFace **buffalo_l**, `det_size=(640, 640)`, CPU provider.
- Video sampling: 1 fps, capped at **60 frames** per video, via `cv2.VideoCapture`.
- Clustering: HDBSCAN `min_cluster_size=3`, cosine similarity implemented as **euclidean distance over L2-normalized vectors**; runs over ALL `pending` + `confirmed` embeddings; `rejected` faces are excluded.
- Cluster-id stability rule: new cluster centroid vs. previous centroids — best cosine **> 0.65** keeps the old cluster id (greedy, one-to-one, highest similarity first); otherwise a fresh nanoid. Noise (label `-1`) ⇒ `cluster_id = NULL`.
- Embeddings are stored as raw little-endian **float32[512]** bytes (2048 bytes) in `faces.embedding`.
- Timestamps in `jobs` (`run_after`, `created_at`) are **epoch seconds** (Drizzle `{ mode: 'timestamp' }`).

## File Structure

```
faces/                                    # NEW — Python container (Tasks 1–5)
├─ Dockerfile                             # multi-stage: base / test / runtime (model baked)
├─ .dockerignore
├─ requirements.txt                       # runtime deps (insightface, onnxruntime, cv2, numpy, hdbscan, scikit-learn)
├─ requirements-test.txt                  # local pytest venv deps (no insightface/onnxruntime)
├─ conftest.py                            # empty; makes faces/ importable under pytest
├─ ids.py                                 # nanoid()
├─ boxes.py                               # normalize_box(), box_json()
├─ cluster.py                             # l2_normalize, cluster_labels, centroid, assign_stable_ids, recluster
├─ dbq.py                                 # sqlite3 access: connect, claim/complete/fail job, faces IO
├─ main.py                                # analyzer, photo/video scan, process_job, run_loop
└─ tests/
   ├─ conftest.py                         # SCHEMA DDL + db fixture
   ├─ test_ids.py  test_boxes.py  test_cluster.py  test_dbq.py  test_main.py

src/lib/server/platform/features.ts       # NEW — facesEnabled(env) (Task 6)
src/lib/server/platform/features.test.ts  # NEW (Task 6)
src/lib/server/platform/index.ts          # MODIFY — node features.faces from env; CF false (Task 6)
src/routes/+layout.server.ts              # MODIFY — expose locals.platform.features (Task 6)
src/routes/admin/+layout.svelte           # MODIFY — "Faces" nav link gated (Task 6)
.env.example                              # MODIFY — FACES_ENABLED=0 (Task 6)

src/worker/face-enqueue.ts                # NEW — enqueue/maybeEnqueue/backfill (Task 7)
src/worker/face-enqueue.test.ts           # NEW (Task 7)
src/worker/jobs.ts                        # MODIFY — hook after derivatives success (Task 7)
scripts/faces-backfill.ts                 # NEW — pnpm faces:backfill (Task 7)
package.json                              # MODIFY — faces:backfill script (Task 7)

src/lib/server/faces.ts                   # NEW — suggestions, assign/reject/split, box update (Tasks 8–9)
src/lib/server/faces.test.ts              # NEW (Tasks 8–9)
src/lib/server/faces-gate.ts              # NEW — requireFaces(platform) 404 gate (Task 10)
src/lib/server/faces-gate.test.ts         # NEW (Task 10)
src/routes/api/faces/suggestions/+server.ts            # NEW GET (Task 10)
src/routes/api/faces/suggestions/server.test.ts        # NEW (Task 10)
src/routes/api/faces/clusters/[clusterId]/+server.ts   # NEW POST assign|reject|not-same (Task 10)
src/routes/api/faces/[faceId]/+server.ts               # NEW PATCH box (Task 10)
src/routes/api/items/[id]/faces/+server.ts             # NEW GET confirmed faces (Task 10)

src/routes/admin/faces/+page.server.ts    # NEW — review UI load (Task 11)
src/routes/admin/faces/+page.svelte       # NEW — review cards (Task 11)

src/lib/ui/FaceBoxes.svelte               # NEW — 1px cream box overlay (Task 12)
src/routes/item/[id]/+page.server.ts      # MODIFY — faces in item data (Task 12)
src/routes/item/[id]/+page.svelte         # MODIFY — FACES toggle on photo lightbox (Task 12)

e2e/paths.ts                              # NEW or reuse — e2e DATABASE_PATH/MEDIA_PATH constants (Task 13)
e2e/helpers/faces-seed.ts                 # NEW — synthetic faces seeding (Task 13)
e2e/faces.spec.ts                         # NEW (Task 13)
playwright.config.ts                      # MODIFY — FACES_ENABLED=1 in webServer env (Task 13)
```

`docker-compose.yml` is NOT touched in this phase — the faces service stanza is documented in the Appendix and finalized in Phase 10.

---

### Task 1: Python scaffolding — ids + box normalization

**Files:**
- Create: `faces/requirements.txt`
- Create: `faces/requirements-test.txt`
- Create: `faces/conftest.py`
- Create: `faces/ids.py`
- Create: `faces/boxes.py`
- Test: `faces/tests/test_ids.py`, `faces/tests/test_boxes.py`

**Interfaces:**
- Consumes: nothing (pure Python).
- Produces:
  - `ids.nanoid(size: int = 12) -> str` — url-safe id, alphabet `[A-Za-z0-9_-]`, matches Node `nanoid(12)` shape used for all Shoebox ids.
  - `boxes.normalize_box(x1: float, y1: float, x2: float, y2: float, img_w: int, img_h: int) -> dict` — returns `{"x","y","w","h"}` normalized to 0–1, clamped, corner-order-safe; raises `ValueError` on non-positive image dims.
  - `boxes.box_json(box: dict) -> str` — compact, key-sorted JSON (exact string stored in `faces.box` and `item_people.face_box`).

- [ ] **Step 1: Create requirements files, empty conftest, and the local test venv**

`faces/requirements.txt` (runtime, used by Dockerfile):

```
numpy==1.26.4
opencv-python-headless==4.10.0.84
onnxruntime==1.18.1
insightface==0.7.3
hdbscan==0.8.40
scikit-learn==1.5.1
```

`faces/requirements-test.txt` (local unit-test venv — skips insightface/onnxruntime, which the unit tests fake):

```
numpy==1.26.4
opencv-python-headless==4.10.0.84
hdbscan==0.8.40
scikit-learn==1.5.1
pytest==8.3.2
```

`faces/conftest.py`:

```python
# Empty on purpose: a root-level conftest makes pytest add faces/ to sys.path
# so tests can `import ids`, `import boxes`, `import cluster`, `import dbq`, `import main`.
```

Create the venv (from the repo root):

```bash
python3 -m venv faces/.venv
faces/.venv/bin/pip install -r faces/requirements-test.txt
```

- [ ] **Step 2: Write the failing tests**

`faces/tests/test_ids.py`:

```python
import re

from ids import nanoid


def test_nanoid_default_length():
    assert len(nanoid()) == 12


def test_nanoid_custom_length():
    assert len(nanoid(21)) == 21


def test_nanoid_alphabet_is_url_safe():
    for _ in range(50):
        assert re.fullmatch(r"[A-Za-z0-9_-]+", nanoid())


def test_nanoid_unique():
    ids = {nanoid() for _ in range(1000)}
    assert len(ids) == 1000
```

`faces/tests/test_boxes.py`:

```python
import json

import pytest

from boxes import box_json, normalize_box


def test_normalize_simple():
    box = normalize_box(100, 50, 300, 250, 1000, 500)
    assert box == {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.4}


def test_normalize_clamps_to_unit_square():
    box = normalize_box(-40, -20, 1200, 600, 1000, 500)
    assert box == {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}


def test_normalize_swaps_inverted_corners():
    box = normalize_box(300, 250, 100, 50, 1000, 500)
    assert box == {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.4}


def test_normalize_rejects_bad_dimensions():
    with pytest.raises(ValueError):
        normalize_box(0, 0, 10, 10, 0, 500)


def test_box_json_is_compact_and_key_sorted():
    s = box_json({"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4})
    assert s == '{"h":0.4,"w":0.3,"x":0.1,"y":0.2}'
    assert json.loads(s)["w"] == 0.3
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd faces && .venv/bin/pytest tests/test_ids.py tests/test_boxes.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'ids'`.

- [ ] **Step 4: Implement**

`faces/ids.py`:

```python
"""nanoid-compatible ids (same shape as the Node side's nanoid(12))."""
import secrets

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"


def nanoid(size: int = 12) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(size))
```

`faces/boxes.py`:

```python
"""Face bounding boxes, normalized to the 0-1 unit square.

The JSON string produced by box_json() is stored verbatim in faces.box and
(item on assignment) item_people.face_box — matching the master schema's
'JSON normalized' comment: {"x":..,"y":..,"w":..,"h":..} with 0-1 floats.
"""
import json


def normalize_box(x1: float, y1: float, x2: float, y2: float, img_w: int, img_h: int) -> dict:
    if img_w <= 0 or img_h <= 0:
        raise ValueError("image dimensions must be positive")
    x1, x2 = sorted((float(x1), float(x2)))
    y1, y2 = sorted((float(y1), float(y2)))

    def clamp01(v: float) -> float:
        return max(0.0, min(1.0, v))

    x = clamp01(x1 / img_w)
    y = clamp01(y1 / img_h)
    x_end = clamp01(x2 / img_w)
    y_end = clamp01(y2 / img_h)
    return {
        "x": round(x, 6),
        "y": round(y, 6),
        "w": round(max(0.0, x_end - x), 6),
        "h": round(max(0.0, y_end - y), 6),
    }


def box_json(box: dict) -> str:
    return json.dumps(box, separators=(",", ":"), sort_keys=True)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd faces && .venv/bin/pytest tests/test_ids.py tests/test_boxes.py -v
```

Expected: PASS — `9 passed`.

- [ ] **Step 6: Commit**

```bash
git add faces/requirements.txt faces/requirements-test.txt faces/conftest.py faces/ids.py faces/boxes.py faces/tests/test_ids.py faces/tests/test_boxes.py
git commit -m "feat: faces container scaffolding with ids and box normalization"
```

---

### Task 2: Clustering with stable cluster ids

**Files:**
- Create: `faces/cluster.py`
- Test: `faces/tests/test_cluster.py`

**Interfaces:**
- Consumes: `ids.nanoid()` (Task 1).
- Produces (all in `faces/cluster.py`):
  - `l2_normalize(embs: np.ndarray) -> np.ndarray` — row-wise L2 normalization; zero rows pass through without NaN.
  - `cluster_labels(embs_normalized: np.ndarray, min_cluster_size: int = 3) -> np.ndarray` — HDBSCAN labels (`-1` = noise); returns all `-1` when fewer than `min_cluster_size` rows.
  - `centroid(embs_normalized: np.ndarray) -> np.ndarray` — mean, re-normalized to unit length.
  - `assign_stable_ids(labels: np.ndarray, embs_normalized: np.ndarray, previous_centroids: dict[str, np.ndarray], threshold: float = 0.65, make_id=nanoid) -> dict[int, str]` — THE stability rule (see spec §7): map from HDBSCAN label to cluster id.
  - `recluster(rows: list[dict], min_cluster_size: int = 3, threshold: float = 0.65, make_id=nanoid) -> dict[str, str | None]` — rows are `{"id": str, "cluster_id": str | None, "embedding": np.ndarray(float32)}`; returns `face_id -> cluster_id` (None = noise). Task 4's `process_job` and Task 3's DB layer feed/consume this.

- [ ] **Step 1: Write the failing tests**

`faces/tests/test_cluster.py`:

```python
import numpy as np

from cluster import assign_stable_ids, centroid, cluster_labels, l2_normalize, recluster

RNG = np.random.default_rng(42)


def unit(dim: int, axis: int) -> np.ndarray:
    v = np.zeros(dim)
    v[axis] = 1.0
    return v


def make_cluster(direction: np.ndarray, n: int, jitter: float = 0.01) -> np.ndarray:
    d = direction / np.linalg.norm(direction)
    return d + RNG.normal(0.0, jitter, size=(n, d.shape[0]))


def test_l2_normalize_rows_are_unit_length():
    out = l2_normalize(RNG.normal(size=(5, 512)))
    assert np.allclose(np.linalg.norm(out, axis=1), 1.0)


def test_l2_normalize_zero_row_is_nan_safe():
    out = l2_normalize(np.zeros((1, 8)))
    assert not np.any(np.isnan(out))


def test_cluster_labels_finds_two_groups():
    a = make_cluster(unit(64, 0), 6)
    b = make_cluster(unit(64, 1), 6)
    labels = cluster_labels(l2_normalize(np.vstack([a, b])), min_cluster_size=3)
    assert len(set(labels[:6])) == 1 and labels[0] != -1
    assert len(set(labels[6:])) == 1 and labels[6] != -1
    assert labels[0] != labels[6]


def test_cluster_labels_too_few_points_is_all_noise():
    labels = cluster_labels(l2_normalize(make_cluster(unit(8, 0), 2)), min_cluster_size=3)
    assert list(labels) == [-1, -1]


def test_centroid_is_unit_norm():
    c = centroid(l2_normalize(make_cluster(unit(16, 2), 4)))
    assert np.isclose(np.linalg.norm(c), 1.0)


def test_stable_ids_keep_previous_id_when_centroid_matches():
    dim = 32
    prev = {"clusterOld1": centroid(l2_normalize(make_cluster(unit(dim, 0), 6)))}
    new_embs = l2_normalize(make_cluster(unit(dim, 0), 7))
    ids = assign_stable_ids(np.zeros(7, dtype=int), new_embs, prev, make_id=lambda: "NEW")
    assert ids == {0: "clusterOld1"}


def test_stable_ids_mint_new_id_when_no_match():
    dim = 32
    prev = {"clusterOld1": centroid(l2_normalize(make_cluster(unit(dim, 0), 6)))}
    new_embs = l2_normalize(make_cluster(unit(dim, 1), 5))  # orthogonal: cosine ~ 0
    made = iter(["fresh1"])
    ids = assign_stable_ids(np.zeros(5, dtype=int), new_embs, prev, make_id=lambda: next(made))
    assert ids == {0: "fresh1"}


def test_stable_ids_are_one_to_one_best_match_wins():
    dim = 32
    anchor = unit(dim, 0)
    prev = {"old": centroid(l2_normalize(make_cluster(anchor, 6, jitter=0.005)))}
    close = l2_normalize(make_cluster(anchor, 4, jitter=0.005))                       # cosine ~ 1.0 to old
    lean = l2_normalize(make_cluster(anchor * 0.8 + unit(dim, 1) * 0.6, 4, 0.005))    # cosine ~ 0.8 to old
    embs = np.vstack([close, lean])
    labels = np.array([0] * 4 + [1] * 4)
    made = iter(["fresh1", "fresh2"])
    ids = assign_stable_ids(labels, embs, prev, make_id=lambda: next(made))
    assert ids[0] == "old"      # best cosine reuses the old id
    assert ids[1] == "fresh1"   # runner-up may NOT also take it


def test_stable_ids_ignore_noise_label():
    labels = np.array([-1, -1, 0, 0, 0])
    embs = l2_normalize(np.vstack([make_cluster(unit(8, 1), 2), make_cluster(unit(8, 0), 3)]))
    ids = assign_stable_ids(labels, embs, {}, make_id=lambda: "A")
    assert ids == {0: "A"}


def test_recluster_end_to_end_stability():
    dim = 512
    rose = make_cluster(unit(dim, 0), 4)
    theo = make_cluster(unit(dim, 1), 4)
    rows1 = [
        {"id": f"f{i}", "cluster_id": None, "embedding": e.astype(np.float32)}
        for i, e in enumerate(np.vstack([rose, theo]))
    ]
    first = recluster(rows1)
    rose_ids = {first[f"f{i}"] for i in range(4)}
    theo_ids = {first[f"f{i}"] for i in range(4, 8)}
    assert len(rose_ids) == 1 and len(theo_ids) == 1 and rose_ids != theo_ids
    assert None not in rose_ids | theo_ids

    # second pass: rows now carry their cluster ids; one new rose face arrives
    rows2 = [dict(r, cluster_id=first[r["id"]]) for r in rows1]
    new_face = {
        "id": "f8",
        "cluster_id": None,
        "embedding": make_cluster(unit(dim, 0), 1)[0].astype(np.float32),
    }
    second = recluster(rows2 + [new_face])
    assert second["f0"] == first["f0"]   # id survived the re-run
    assert second["f8"] == first["f0"]   # new face joined the existing rose cluster
    assert second["f4"] == first["f4"]


def test_recluster_returns_none_for_noise():
    rows = [{"id": "a", "cluster_id": None, "embedding": np.ones(512, dtype=np.float32)}]
    assert recluster(rows) == {"a": None}


def test_recluster_empty_input():
    assert recluster([]) == {}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd faces && .venv/bin/pytest tests/test_cluster.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'cluster'`.

- [ ] **Step 3: Implement**

`faces/cluster.py`:

```python
"""Incremental face clustering with stable cluster ids.

Cosine similarity is implemented as euclidean distance over L2-normalized
vectors (euclidean distance on the unit sphere is a monotone function of
cosine distance), because HDBSCAN does not support 'cosine' natively.

Stability rule (spec §7): after each full re-cluster over ALL pending +
confirmed embeddings, each new cluster's centroid is compared to every
previous cluster centroid. Greedily, in order of descending cosine
similarity, a new cluster with best similarity > threshold (0.65) KEEPS the
previous cluster's id (each old id reused at most once); every unmatched
cluster gets a fresh nanoid. HDBSCAN noise (-1) maps to cluster_id NULL.
"""
from collections import defaultdict

import hdbscan
import numpy as np

from ids import nanoid


def l2_normalize(embs: np.ndarray) -> np.ndarray:
    embs = np.asarray(embs, dtype=np.float64)
    norms = np.linalg.norm(embs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return embs / norms


def cluster_labels(embs_normalized: np.ndarray, min_cluster_size: int = 3) -> np.ndarray:
    n = len(embs_normalized)
    if n < min_cluster_size:
        return np.full(n, -1, dtype=int)
    clusterer = hdbscan.HDBSCAN(min_cluster_size=min_cluster_size, metric="euclidean")
    return clusterer.fit_predict(np.asarray(embs_normalized, dtype=np.float64))


def centroid(embs_normalized: np.ndarray) -> np.ndarray:
    c = np.asarray(embs_normalized, dtype=np.float64).mean(axis=0)
    n = np.linalg.norm(c)
    return c / n if n > 0 else c


def assign_stable_ids(
    labels: np.ndarray,
    embs_normalized: np.ndarray,
    previous_centroids: dict,
    threshold: float = 0.65,
    make_id=nanoid,
) -> dict:
    labels = np.asarray(labels)
    new_centroids = {}
    for lab in sorted({int(l) for l in labels if l >= 0}):
        new_centroids[lab] = centroid(embs_normalized[labels == lab])

    candidates = []  # (similarity, label, old_id)
    for lab, c in new_centroids.items():
        for old_id, oc in previous_centroids.items():
            denom = np.linalg.norm(c) * np.linalg.norm(oc)
            sim = float(np.dot(c, oc) / denom) if denom > 0 else 0.0
            if sim > threshold:
                candidates.append((sim, lab, old_id))
    candidates.sort(key=lambda t: (-t[0], t[1], t[2]))  # deterministic greedy order

    assigned: dict = {}
    used_old_ids: set = set()
    for _sim, lab, old_id in candidates:
        if lab in assigned or old_id in used_old_ids:
            continue
        assigned[lab] = old_id
        used_old_ids.add(old_id)
    for lab in new_centroids:
        if lab not in assigned:
            assigned[lab] = make_id()
    return assigned


def recluster(rows: list, min_cluster_size: int = 3, threshold: float = 0.65, make_id=nanoid) -> dict:
    """rows: [{'id': str, 'cluster_id': str|None, 'embedding': np.ndarray}] over
    ALL pending + confirmed faces. Returns {face_id: cluster_id_or_None}."""
    if not rows:
        return {}
    embs = l2_normalize(np.stack([np.asarray(r["embedding"], dtype=np.float64) for r in rows]))

    groups = defaultdict(list)
    for i, r in enumerate(rows):
        if r.get("cluster_id"):
            groups[r["cluster_id"]].append(i)
    previous_centroids = {cid: centroid(embs[idx]) for cid, idx in groups.items()}

    labels = cluster_labels(embs, min_cluster_size=min_cluster_size)
    id_by_label = assign_stable_ids(labels, embs, previous_centroids, threshold, make_id)
    return {
        r["id"]: (id_by_label[int(lab)] if lab >= 0 else None)
        for r, lab in zip(rows, labels)
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd faces && .venv/bin/pytest tests/test_cluster.py -v
```

Expected: PASS — `12 passed`.

- [ ] **Step 5: Commit**

```bash
git add faces/cluster.py faces/tests/test_cluster.py
git commit -m "feat: HDBSCAN face clustering with stable cluster-id rule"
```

---

### Task 3: Shared-SQLite job claiming and face persistence (Python)

**Files:**
- Create: `faces/dbq.py`
- Create: `faces/tests/conftest.py`
- Test: `faces/tests/test_dbq.py`

**Interfaces:**
- Consumes: `ids.nanoid()`, `boxes.box_json()` (Task 1); the production tables are created by the Node app's Drizzle migrations — the test fixture mirrors master Contract 1 DDL exactly.
- Produces (all in `faces/dbq.py`, used by Task 4's `main.py`):
  - `connect(db_path: str) -> sqlite3.Connection` — Row factory, `busy_timeout=5000`, WAL, manual transactions (`isolation_level=None`).
  - `claim_face_scan_job(conn) -> dict | None` — `{"id": str, "payload": dict}`; better-sqlite3-compatible claim: `BEGIN IMMEDIATE` → SELECT oldest runnable `face_scan` → `UPDATE … status='running', attempts=attempts+1` → COMMIT (the transactional equivalent of `UPDATE … RETURNING`).
  - `complete_job(conn, job_id: str) -> None` / `fail_job(conn, job_id: str) -> None` (exponential backoff `60 * 2**attempts` s; `status='failed'` at `attempts >= 5`).
  - `original_path(conn, item_id: str) -> tuple[str, str]` — `(storage_key, item_type)`; raises `LookupError` if missing.
  - `replace_pending_faces(conn, item_id: str, detections: list[dict]) -> list[str]` — detections are `{"frame_time": float|None, "box": dict, "embedding": bytes}`; deletes the item's PENDING faces (confirmed/rejected kept), inserts fresh pending rows, returns new face ids.
  - `load_embeddings_for_clustering(conn) -> list[dict]` — `{"id", "cluster_id", "embedding": np.ndarray(float32, shape (512,))}` for ALL pending+confirmed faces.
  - `apply_cluster_assignments(conn, assignments: dict[str, str | None]) -> None` — single `BEGIN IMMEDIATE` transaction.

- [ ] **Step 1: Write the shared DB fixture and the failing tests**

`faces/tests/conftest.py`:

```python
"""Test database mirroring the master-plan Contract 1 tables the faces
container touches. Production DDL is owned by Drizzle migrations (phase 01);
keep this in sync with docs/superpowers/plans/2026-07-04-shoebox-00-master.md."""
import pytest

import dbq

SCHEMA = """
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL, accent_color TEXT NOT NULL, person_id TEXT,
  comfort_mode INTEGER NOT NULL DEFAULT 0, theme TEXT NOT NULL DEFAULT 'system',
  created_at INTEGER NOT NULL
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
  status TEXT NOT NULL DEFAULT 'pending'
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
```

`faces/tests/test_dbq.py`:

```python
import json
import time

import numpy as np
import pytest

import dbq

NOW = int(time.time())


def add_job(conn, job_id, run_after=NOW - 10, status="pending", attempts=0, created_at=NOW - 10, kind="face_scan"):
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
    dbq.claim_face_scan_job(db)  # attempts -> 1
    dbq.fail_job(db, "j1")
    row = db.execute("SELECT status, run_after FROM jobs WHERE id='j1'").fetchone()
    assert row["status"] == "pending"
    assert row["run_after"] >= NOW + 60 * 2  # 60 * 2**1

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
        {"frame_time": None, "box": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}, "embedding": np.ones(512, dtype=np.float32).tobytes()},
        {"frame_time": 3.0, "box": {"x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1}, "embedding": np.ones(512, dtype=np.float32).tobytes()},
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
    add_face(db, "c1f", status="confirmed", cluster_id="c1", embedding=np.full(512, 0.5, dtype=np.float32).tobytes())
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd faces && .venv/bin/pytest tests/test_dbq.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'dbq'` (raised from `tests/conftest.py`).

- [ ] **Step 3: Implement**

`faces/dbq.py`:

```python
"""SQLite access for the faces worker.

The database is the SAME SQLite file the Node app and worker use, volume-
mounted at DATABASE_PATH. Claiming mirrors the better-sqlite3 pattern from
src/worker/jobs.ts (phase 07): BEGIN IMMEDIATE + SELECT + UPDATE inside one
write transaction — the portable equivalent of `UPDATE ... RETURNING` — with
busy_timeout=5000 so concurrent writers wait instead of erroring.

jobs.run_after / jobs.created_at are epoch SECONDS (Drizzle timestamp mode).
"""
import json
import sqlite3
import time

import numpy as np

from boxes import box_json
from ids import nanoid

MAX_ATTEMPTS = 5


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, isolation_level=None)  # manual transactions
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def claim_face_scan_job(conn: sqlite3.Connection):
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
    else:
        delay = 60 * (2 ** row["attempts"])
        conn.execute(
            "UPDATE jobs SET status = 'pending', run_after = ? WHERE id = ?",
            (int(time.time()) + delay, job_id),
        )


def original_path(conn: sqlite3.Connection, item_id: str):
    row = conn.execute(
        "SELECT i.type AS item_type, f.storage_key AS storage_key "
        "FROM items i JOIN item_files f ON f.item_id = i.id AND f.kind = 'original' "
        "WHERE i.id = ?",
        (item_id,),
    ).fetchone()
    if row is None:
        raise LookupError(f"no original file for item {item_id}")
    return row["storage_key"], row["item_type"]


def replace_pending_faces(conn: sqlite3.Connection, item_id: str, detections: list) -> list:
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM faces WHERE item_id = ? AND status = 'pending'", (item_id,))
        new_ids = []
        for d in detections:
            face_id = nanoid()
            conn.execute(
                "INSERT INTO faces (id, item_id, frame_time, box, embedding, cluster_id, person_id, status) "
                "VALUES (?, ?, ?, ?, ?, NULL, NULL, 'pending')",
                (face_id, item_id, d["frame_time"], box_json(d["box"]), d["embedding"]),
            )
            new_ids.append(face_id)
        conn.execute("COMMIT")
        return new_ids
    except Exception:
        conn.execute("ROLLBACK")
        raise


def load_embeddings_for_clustering(conn: sqlite3.Connection) -> list:
    rows = conn.execute(
        "SELECT id, cluster_id, embedding FROM faces WHERE status IN ('pending','confirmed')"
    ).fetchall()
    return [
        {
            "id": r["id"],
            "cluster_id": r["cluster_id"],
            "embedding": np.frombuffer(r["embedding"], dtype=np.float32),
        }
        for r in rows
    ]


def apply_cluster_assignments(conn: sqlite3.Connection, assignments: dict) -> None:
    conn.execute("BEGIN IMMEDIATE")
    try:
        for face_id, cluster_id in assignments.items():
            conn.execute("UPDATE faces SET cluster_id = ? WHERE id = ?", (cluster_id, face_id))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd faces && .venv/bin/pytest tests/test_dbq.py -v
```

Expected: PASS — `10 passed`. Then run the whole Python suite to confirm nothing regressed:

```bash
cd faces && .venv/bin/pytest tests -v
```

Expected: PASS — `31 passed`.

- [ ] **Step 5: Commit**

```bash
git add faces/dbq.py faces/tests/conftest.py faces/tests/test_dbq.py
git commit -m "feat: faces worker sqlite job claiming and face persistence"
```

---

### Task 4: Python analyzer, scan loop, and Dockerfile

**Files:**
- Create: `faces/main.py`
- Create: `faces/tests/test_main.py`
- Create: `faces/Dockerfile`
- Create: `faces/.dockerignore`

**Interfaces:**
- Consumes: `dbq`, `cluster`, `boxes`; env `DATABASE_PATH`, `MEDIA_PATH`, optional `FACE_POLL_INTERVAL_SECONDS`.
- Produces: `scan_photo`, `scan_video`, `process_job`, `run_loop`; Docker image with InsightFace buffalo_l model baked at build time.

- [ ] **Step 1: Write tests with a fake analyzer**

Tests must avoid importing InsightFace. Use a fake analyzer object that returns deterministic detections and embeddings. Cover photo scan, video sampling capped at 60 frames, missing original job failure, `process_job` replacing pending faces, reclustering, and complete/fail job calls.

- [ ] **Step 2: Implement `main.py`**

Runtime imports `cv2`, `numpy`, and `insightface` only in the analyzer construction path. `process_job(conn, media_path, analyzer, job)` reads `payload.itemId`, resolves the original storage key, scans photo/video, writes pending faces, reclusters all pending+confirmed embeddings, applies cluster assignments, then completes the job.

- [ ] **Step 3: Add Dockerfile**

Use Python 3.12 slim, install `requirements.txt`, download/bake buffalo_l during build, set `ENV INSIGHTFACE_HOME=/models`, run `python -m main`. No runtime network calls.

- [ ] **Step 4: Verify and commit**

Run:

```bash
cd faces && .venv/bin/pytest tests -v
docker build -f faces/Dockerfile --target test .
```

```bash
git add faces/main.py faces/tests/test_main.py faces/Dockerfile faces/.dockerignore
git commit -m "feat: faces analyzer loop and Docker image"
```

---

### Task 5: Full Python suite gate

**Files:** none beyond Tasks 1-4.

- [ ] Run:

```bash
cd faces && .venv/bin/pytest tests -v
```

Expected: all Python tests pass. Commit only if Task 4 produced follow-up fixes.

---

### Task 6: Platform feature flag

**Files:**
- Create: `src/lib/server/platform/features.ts`
- Create: `src/lib/server/platform/features.test.ts`
- Modify: `src/lib/server/platform/index.ts`
- Modify: `src/routes/+layout.server.ts`
- Modify: `src/routes/admin/+layout.svelte`
- Modify: `.env.example`

**Interfaces:**
- `facesEnabled(env): boolean` returns true only for Node/Docker when `FACES_ENABLED=1`.
- `Platform.features.faces` is false on Cloudflare regardless of env.
- Layout data exposes `features` so nav can hide/show `/admin/faces`.

- [ ] Write tests for `FACES_ENABLED=1`, `0`, missing, and Cloudflare false.
- [ ] Implement and add `FACES_ENABLED=0` to `.env.example`.
- [ ] Run `pnpm vitest run src/lib/server/platform/features.test.ts && pnpm check`.
- [ ] Commit: `git commit -m "feat: gate faces feature by platform flag"`.

---

### Task 7: Enqueue face_scan jobs after derivatives

**Files:**
- Create: `src/worker/face-enqueue.ts`
- Create: `src/worker/face-enqueue.test.ts`
- Modify: `src/worker/jobs.ts`
- Create: `scripts/faces-backfill.ts`
- Modify: `package.json`

**Interfaces:**
- `maybeEnqueueFaceScan(db, itemId, env)` enqueues `face_scan` only when `FACES_ENABLED=1`.
- Worker derivatives success calls it after canonical derivatives complete.
- `pnpm faces:backfill` enqueues missing `face_scan` jobs for ready, non-deleted items.

- [ ] Tests cover disabled flag, enabled flag, duplicate pending job avoidance, and backfill count.
- [ ] Run `pnpm vitest run src/worker/face-enqueue.test.ts && pnpm check`.
- [ ] Commit: `git commit -m "feat: enqueue face scans behind feature flag"`.

---

### Task 8: Faces server service

**Files:**
- Create: `src/lib/server/faces.ts`
- Create: `src/lib/server/faces.test.ts`

**Interfaces:**
- Produces `listSuggestions`, `assignCluster`, `rejectCluster`, `splitCluster`, `updateFaceBox`, `confirmedFacesForItem`.
- Human confirmation is mandatory: assigning a cluster sets `faces.person_id`, `faces.status='confirmed'`, and upserts `item_people` with `source='ml'`; no background path may set `person_id`.
- Rejecting sets `status='rejected'` and clears `cluster_id`.

- [ ] Tests cover suggestion grouping, assign, reject, split/not-same, box patch validation, and confirmed item faces.
- [ ] Run `pnpm vitest run src/lib/server/faces.test.ts && pnpm check`.
- [ ] Commit: `git commit -m "feat: add faces review service"`.

---

### Task 9: Face review edge cases and reindex hooks

**Files:**
- Modify: `src/lib/server/faces.ts`
- Modify: `src/lib/server/faces.test.ts`

- [ ] Add tests that assigning/rejecting calls `reindexItem` for each affected item and refuses missing people/items.
- [ ] Verify rejected faces are excluded from future suggestions.
- [ ] Run `pnpm vitest run src/lib/server/faces.test.ts`.
- [ ] Commit: `git commit -m "feat: reindex and harden face review actions"`.

---

### Task 10: Faces API routes and feature gate

**Files:**
- Create: `src/lib/server/faces-gate.ts`
- Create: `src/lib/server/faces-gate.test.ts`
- Create: `src/routes/api/faces/suggestions/+server.ts`
- Create: `src/routes/api/faces/suggestions/server.test.ts`
- Create: `src/routes/api/faces/clusters/[clusterId]/+server.ts`
- Create: `src/routes/api/faces/[faceId]/+server.ts`
- Create: `src/routes/api/items/[id]/faces/+server.ts`

**Interfaces:**
- Every route calls `requireRole(locals, 'editor')` except `GET /api/items/[id]/faces`, which requires `user`.
- Every route calls `requireFaces(locals.platform)` and returns 404 when disabled.
- Cluster POST accepts `{ action: 'assign'|'reject'|'not-same', personId?, faceIds? }`.

- [ ] Tests cover disabled 404, unauthorized 401/403, happy-path JSON for suggestions, assign/reject/not-same, box patch, and confirmed item faces.
- [ ] Run `pnpm vitest run src/lib/server/faces-gate.test.ts src/routes/api/faces/suggestions/server.test.ts && pnpm check`.
- [ ] Commit: `git commit -m "feat: add feature-gated faces API"`.

---

### Task 11: Admin faces review UI

**Files:**
- Create: `src/routes/admin/faces/+page.server.ts`
- Create: `src/routes/admin/faces/+page.svelte`

**Interfaces:**
- Loads suggestion clusters and people list.
- UI presents "Are these all the same person?" review cards with Assign, Reject, and Not same actions.
- Hidden behind `features.faces`; disabled direct navigation returns 404.

- [ ] Implement keyboardable review cards with 44px targets, no rounded corners, no hard-coded component hex.
- [ ] Run `pnpm check`.
- [ ] Manual: enable `FACES_ENABLED=1`, seed suggestions, assign a person, verify cards disappear.
- [ ] Commit: `git commit -m "feat: add faces review admin UI"`.

---

### Task 12: Confirmed face overlays in item room

**Files:**
- Create: `src/lib/ui/FaceBoxes.svelte`
- Modify: `src/routes/item/[id]/+page.server.ts`
- Modify: `src/routes/item/[id]/+page.svelte`

**Interfaces:**
- `FaceBoxes.svelte` renders normalized boxes over photo/video stages with a 1px cream outline and person labels.
- Item room loads confirmed faces only when `features.faces` is true.
- UI toggle label is exactly `Faces`; default off for videos, on for photos with confirmed faces.

- [ ] Add component tests for normalized box placement.
- [ ] Run `pnpm vitest run src/lib/ui/FaceBoxes.test.ts && pnpm check`.
- [ ] Commit: `git commit -m "feat: show confirmed face overlays in item room"`.

---

### Task 13: Faces e2e and full gate

**Files:**
- Create or reuse: `e2e/paths.ts`
- Create: `e2e/helpers/faces-seed.ts`
- Create: `e2e/faces.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Playwright webServer env sets `FACES_ENABLED=1`.
- Seed helper inserts synthetic pending faces, clusters, people, and media fixtures without invoking InsightFace.

- [ ] E2E covers: faces nav is visible when enabled; suggestions page assigns a cluster to a person; item room shows confirmed face boxes; disabled feature hides nav and returns 404.
- [ ] Run:

```bash
pnpm check
pnpm vitest run
pnpm test:e2e
cd faces && .venv/bin/pytest tests -v
```

- [ ] Commit:

```bash
git add e2e/paths.ts e2e/helpers/faces-seed.ts e2e/faces.spec.ts playwright.config.ts
git commit -m "test: add faces review e2e coverage"
```

## Self-review

- Phase 09 does not touch `docker-compose.yml`; Phase 10 owns compose profiles.
- No Cloudflare path can enable faces.
- No background code sets `person_id`; only reviewed Assign actions do.
- Every file in the Phase 09 file map is covered by a task.

"""Incremental face clustering with stable cluster ids.

Cosine similarity is implemented as euclidean distance over L2-normalized
vectors because euclidean distance on the unit sphere is monotone with cosine
distance. Runtime Docker images install HDBSCAN; the small fallback keeps local
tests runnable on Python versions where hdbscan wheels are unavailable.
"""

from collections import defaultdict

import numpy as np

from ids import nanoid

try:
    import hdbscan
except ModuleNotFoundError:
    hdbscan = None


def l2_normalize(embs: np.ndarray) -> np.ndarray:
    embs = np.asarray(embs, dtype=np.float64)
    norms = np.linalg.norm(embs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return embs / norms


def _fallback_cluster_labels(embs_normalized: np.ndarray, min_cluster_size: int) -> np.ndarray:
    n = len(embs_normalized)
    labels = np.full(n, -1, dtype=int)
    visited: set[int] = set()
    next_label = 0
    sims = np.asarray(embs_normalized, dtype=np.float64) @ np.asarray(embs_normalized, dtype=np.float64).T

    for start in range(n):
        if start in visited:
            continue
        stack = [start]
        component: list[int] = []
        visited.add(start)
        while stack:
            idx = stack.pop()
            component.append(idx)
            for neighbor in np.where(sims[idx] >= 0.8)[0]:
                j = int(neighbor)
                if j not in visited:
                    visited.add(j)
                    stack.append(j)
        if len(component) >= min_cluster_size:
            labels[component] = next_label
            next_label += 1

    return labels


def cluster_labels(embs_normalized: np.ndarray, min_cluster_size: int = 3) -> np.ndarray:
    n = len(embs_normalized)
    if n < min_cluster_size:
        return np.full(n, -1, dtype=int)
    if hdbscan is None:
        return _fallback_cluster_labels(embs_normalized, min_cluster_size)
    clusterer = hdbscan.HDBSCAN(min_cluster_size=min_cluster_size, metric="euclidean")
    return clusterer.fit_predict(np.asarray(embs_normalized, dtype=np.float64))


def centroid(embs_normalized: np.ndarray) -> np.ndarray:
    c = np.asarray(embs_normalized, dtype=np.float64).mean(axis=0)
    n = np.linalg.norm(c)
    return c / n if n > 0 else c


def assign_stable_ids(
    labels: np.ndarray,
    embs_normalized: np.ndarray,
    previous_centroids: dict[str, np.ndarray],
    threshold: float = 0.65,
    make_id=nanoid,
) -> dict[int, str]:
    labels = np.asarray(labels)
    new_centroids: dict[int, np.ndarray] = {}
    for label in sorted({int(label) for label in labels if label >= 0}):
        new_centroids[label] = centroid(embs_normalized[labels == label])

    candidates: list[tuple[float, int, str]] = []
    for label, c in new_centroids.items():
        for old_id, old_centroid in previous_centroids.items():
            denom = np.linalg.norm(c) * np.linalg.norm(old_centroid)
            similarity = float(np.dot(c, old_centroid) / denom) if denom > 0 else 0.0
            if similarity > threshold:
                candidates.append((similarity, label, old_id))
    candidates.sort(key=lambda candidate: (-candidate[0], candidate[1], candidate[2]))

    assigned: dict[int, str] = {}
    used_old_ids: set[str] = set()
    for _similarity, label, old_id in candidates:
        if label in assigned or old_id in used_old_ids:
            continue
        assigned[label] = old_id
        used_old_ids.add(old_id)

    for label in new_centroids:
        if label not in assigned:
            assigned[label] = make_id()

    return assigned


def recluster(
    rows: list[dict],
    min_cluster_size: int = 3,
    threshold: float = 0.65,
    make_id=nanoid,
) -> dict[str, str | None]:
    if not rows:
        return {}

    embs = l2_normalize(np.stack([np.asarray(row["embedding"], dtype=np.float64) for row in rows]))

    groups: dict[str, list[int]] = defaultdict(list)
    for i, row in enumerate(rows):
        if row.get("cluster_id"):
            groups[row["cluster_id"]].append(i)
    previous_centroids = {cluster_id: centroid(embs[indexes]) for cluster_id, indexes in groups.items()}

    labels = cluster_labels(embs, min_cluster_size=min_cluster_size)
    id_by_label = assign_stable_ids(labels, embs, previous_centroids, threshold, make_id)
    return {
        row["id"]: (id_by_label[int(label)] if label >= 0 else None)
        for row, label in zip(rows, labels)
    }

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
    previous_ids: list[str | None] | None = None,
) -> dict[int, str]:
    """Map freshly-computed cluster labels to stable cluster ids.

    Identity is preserved with two deterministic signals, strongest first:

    1. Membership vote: a new cluster inherits the prior ``cluster_id`` that most
       of its member faces already carried. This directly tracks group identity
       as faces trickle in and keeps confirmed faces glued to their cluster.
    2. Centroid similarity: for clusters no vote could place (their faces are all
       new), reuse a prior id whose stored centroid is close enough. This lets a
       cluster reclaim its id even after a rescan wiped its members' cluster_ids.

    Assignment is greedy and one-to-one, so two new clusters can never grab the
    same old id. Only genuinely new groups mint a fresh id via ``make_id``.
    """
    labels = np.asarray(labels)
    label_members: dict[int, list[int]] = defaultdict(list)
    for index, label in enumerate(labels):
        if label >= 0:
            label_members[int(label)].append(index)

    new_centroids: dict[int, np.ndarray] = {}
    for label in sorted(label_members):
        new_centroids[label] = centroid(embs_normalized[label_members[label]])

    assigned: dict[int, str] = {}
    used_old_ids: set[str] = set()

    # 1) Membership vote. Emit every (label, prior_id, count) pair so a cluster
    # can fall back to its second-choice prior id if the first is claimed by a
    # larger overlapping cluster. Ordered by descending overlap, deterministic.
    if previous_ids is not None:
        vote_candidates: list[tuple[int, int, str]] = []
        for label, members in label_members.items():
            counts: dict[str, int] = defaultdict(int)
            for index in members:
                prior = previous_ids[index]
                if prior:
                    counts[prior] += 1
            for prior_id, count in counts.items():
                vote_candidates.append((count, label, prior_id))
        vote_candidates.sort(key=lambda candidate: (-candidate[0], candidate[1], candidate[2]))
        for _count, label, old_id in vote_candidates:
            if label in assigned or old_id in used_old_ids:
                continue
            assigned[label] = old_id
            used_old_ids.add(old_id)

    # 2) Centroid similarity for clusters no vote placed.
    candidates: list[tuple[float, int, str]] = []
    for label, c in new_centroids.items():
        if label in assigned:
            continue
        for old_id, old_centroid in previous_centroids.items():
            if old_id in used_old_ids:
                continue
            denom = np.linalg.norm(c) * np.linalg.norm(old_centroid)
            similarity = float(np.dot(c, old_centroid) / denom) if denom > 0 else 0.0
            if similarity > threshold:
                candidates.append((similarity, label, old_id))
    candidates.sort(key=lambda candidate: (-candidate[0], candidate[1], candidate[2]))
    for _similarity, label, old_id in candidates:
        if label in assigned or old_id in used_old_ids:
            continue
        assigned[label] = old_id
        used_old_ids.add(old_id)

    # 3) Genuinely new groups get a fresh id.
    for label in new_centroids:
        if label not in assigned:
            assigned[label] = make_id()

    return assigned


def recluster(
    rows: list[dict],
    min_cluster_size: int = 3,
    threshold: float = 0.65,
    make_id=nanoid,
    prior_centroids: dict[str, np.ndarray] | None = None,
) -> dict[str, str | None]:
    if not rows:
        return {}

    embs = l2_normalize(np.stack([np.asarray(row["embedding"], dtype=np.float64) for row in rows]))

    previous_ids = [row.get("cluster_id") for row in rows]

    # Centroids of prior clusters that still have member faces present. These are
    # the freshest view, so they win over any persisted centroid for the same id.
    groups: dict[str, list[int]] = defaultdict(list)
    for i, cluster_id in enumerate(previous_ids):
        if cluster_id:
            groups[cluster_id].append(i)
    member_centroids = {cluster_id: centroid(embs[indexes]) for cluster_id, indexes in groups.items()}
    previous_centroids = {**(prior_centroids or {}), **member_centroids}

    labels = cluster_labels(embs, min_cluster_size=min_cluster_size)
    id_by_label = assign_stable_ids(
        labels, embs, previous_centroids, threshold, make_id, previous_ids=previous_ids
    )
    return {
        row["id"]: (id_by_label[int(label)] if label >= 0 else None)
        for row, label in zip(rows, labels)
    }


def centroids_by_cluster(
    rows: list[dict],
    assignments: dict[str, str | None],
) -> dict[str, tuple[np.ndarray, int]]:
    """Centroid and member count per assigned cluster id, for persistence.

    Noise faces (``None`` assignment) are skipped. The returned centroids are the
    stored fingerprints a later run matches new clusters against, so identity
    survives even when every current member face is later replaced.
    """
    if not rows:
        return {}
    embs = l2_normalize(np.stack([np.asarray(row["embedding"], dtype=np.float64) for row in rows]))
    groups: dict[str, list[int]] = defaultdict(list)
    for i, row in enumerate(rows):
        cluster_id = assignments.get(row["id"])
        if cluster_id:
            groups[cluster_id].append(i)
    return {cluster_id: (centroid(embs[indexes]), len(indexes)) for cluster_id, indexes in groups.items()}

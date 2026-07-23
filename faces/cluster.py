"""Incremental face clustering with stable cluster ids.

Cosine similarity is implemented as euclidean distance over L2-normalized
vectors because euclidean distance on the unit sphere is monotone with cosine
distance. Runtime Docker images install HDBSCAN; the small fallback keeps local
tests runnable on Python versions where hdbscan wheels are unavailable.
"""

from collections import defaultdict
from typing import Mapping

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
    labels = np.full(len(embs_normalized), -1, dtype=int)
    next_label = 0
    for component in connected_components(embs_normalized, 0.8):
        if len(component) >= min_cluster_size:
            labels[component] = next_label
            next_label += 1
    return labels


def connected_components(embs_normalized: np.ndarray, sim: float) -> list[list[int]]:
    """Single-linkage groups at cosine >= ``sim`` over unit vectors."""
    n = len(embs_normalized)
    sims = np.asarray(embs_normalized, dtype=np.float64) @ np.asarray(embs_normalized, dtype=np.float64).T
    visited: set[int] = set()
    components: list[list[int]] = []
    for start in range(n):
        if start in visited:
            continue
        stack = [start]
        component: list[int] = []
        visited.add(start)
        while stack:
            idx = stack.pop()
            component.append(idx)
            for neighbor in np.where(sims[idx] >= sim)[0]:
                j = int(neighbor)
                if j not in visited:
                    visited.add(j)
                    stack.append(j)
        components.append(sorted(component))
    return components


def build_units(
    rows: list[dict],
    embs_normalized: np.ndarray,
    track_sim: float = 0.6,
) -> list[list[int]]:
    """Pre-group faces into identity units before global clustering.

    Faces sampled from the same video (rows carrying a ``frame_time``) are
    linked into tracklets by embedding similarity: within one video the same
    person shares lighting and camera, so same-person pairs score far above
    ``track_sim`` while distinct people stay below it. Clustering then operates
    on tracklet means instead of every sampled frame, which stops one video from
    shattering into dozens of per-frame clusters. Photo faces and rows without
    item context stay singleton units.
    """
    by_item: dict[str, list[int]] = defaultdict(list)
    units: list[list[int]] = []
    for i, row in enumerate(rows):
        if row.get("item_id") is not None and row.get("frame_time") is not None:
            by_item[row["item_id"]].append(i)
        else:
            units.append([i])
    for indexes in by_item.values():
        for component in connected_components(embs_normalized[indexes], track_sim):
            units.append([indexes[i] for i in component])
    return units


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
    min_cluster_size: int = 2,
    threshold: float = 0.65,
    make_id=nanoid,
    prior_centroids: dict[str, np.ndarray] | None = None,
    track_sim: float = 0.6,
    min_track_faces: int = 3,
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

    # Cluster over tracklet means, not raw per-frame faces.
    units = build_units(rows, embs, track_sim)
    unit_embs = np.stack([centroid(embs[unit]) for unit in units])
    unit_labels = np.asarray(cluster_labels(unit_embs, min_cluster_size=min_cluster_size))

    # A substantial tracklet that matched nothing else is still a person worth
    # reviewing — someone who appears in only one video must not vanish as noise.
    next_label = int(unit_labels.max()) + 1 if len(unit_labels) else 0
    for i, label in enumerate(unit_labels):
        if label < 0 and len(units[i]) >= min_track_faces:
            unit_labels[i] = next_label
            next_label += 1

    labels = np.full(len(rows), -1, dtype=int)
    for unit, label in zip(units, unit_labels):
        if label >= 0:
            labels[unit] = int(label)

    id_by_label = assign_stable_ids(
        labels, embs, previous_centroids, threshold, make_id, previous_ids=previous_ids
    )
    return {
        row["id"]: (id_by_label[int(label)] if label >= 0 else None)
        for row, label in zip(rows, labels)
    }


def suggest_people(
    rows: list[dict],
    assignments: Mapping[str, str | None],
    min_sim: float = 0.5,
) -> dict[str, str]:
    """Best confirmed-person match per cluster, by centroid cosine similarity.

    Confirmed faces define a centroid per person; every assigned cluster whose
    own centroid lands within ``min_sim`` of a person is suggested as that
    person. This is what makes labeling compound: each confirmation sharpens the
    person centroid, which pre-fills the next round of review.
    """
    if not rows:
        return {}
    embs = l2_normalize(np.stack([np.asarray(row["embedding"], dtype=np.float64) for row in rows]))

    person_members: dict[str, list[int]] = defaultdict(list)
    for i, row in enumerate(rows):
        if row.get("status") == "confirmed" and row.get("person_id"):
            person_members[row["person_id"]].append(i)
    if not person_members:
        return {}
    person_centroids = {pid: centroid(embs[indexes]) for pid, indexes in person_members.items()}

    cluster_members: dict[str, list[int]] = defaultdict(list)
    for i, row in enumerate(rows):
        cluster_id = assignments.get(row["id"])
        if cluster_id:
            cluster_members[cluster_id].append(i)

    suggestions: dict[str, str] = {}
    for cluster_id, indexes in cluster_members.items():
        c = centroid(embs[indexes])
        scored = sorted(
            ((float(np.dot(c, pc)), pid) for pid, pc in person_centroids.items()),
            reverse=True,
        )
        top_sim, top_pid = scored[0]
        if top_sim >= min_sim:
            suggestions[cluster_id] = top_pid
    return suggestions


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

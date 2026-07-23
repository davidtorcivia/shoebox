import numpy as np

from cluster import (
    assign_stable_ids,
    build_units,
    centroid,
    centroids_by_cluster,
    cluster_labels,
    l2_normalize,
    recluster,
    suggest_people,
)

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
    new_embs = l2_normalize(make_cluster(unit(dim, 1), 5))
    made = iter(["fresh1"])
    ids = assign_stable_ids(np.zeros(5, dtype=int), new_embs, prev, make_id=lambda: next(made))
    assert ids == {0: "fresh1"}


def test_stable_ids_are_one_to_one_best_match_wins():
    dim = 32
    anchor = unit(dim, 0)
    prev = {"old": centroid(l2_normalize(make_cluster(anchor, 6, jitter=0.005)))}
    close = l2_normalize(make_cluster(anchor, 4, jitter=0.005))
    lean = l2_normalize(make_cluster(anchor * 0.8 + unit(dim, 1) * 0.6, 4, 0.005))
    embs = np.vstack([close, lean])
    labels = np.array([0] * 4 + [1] * 4)
    made = iter(["fresh1", "fresh2"])
    ids = assign_stable_ids(labels, embs, prev, make_id=lambda: next(made))
    assert ids[0] == "old"
    assert ids[1] == "fresh1"


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

    rows2 = [dict(r, cluster_id=first[r["id"]]) for r in rows1]
    new_face = {
        "id": "f8",
        "cluster_id": None,
        "embedding": make_cluster(unit(dim, 0), 1)[0].astype(np.float32),
    }
    second = recluster(rows2 + [new_face])
    assert second["f0"] == first["f0"]
    assert second["f8"] == first["f0"]
    assert second["f4"] == first["f4"]


def test_stable_ids_membership_vote_keeps_id_without_centroid_match():
    # The prior centroid is deliberately elsewhere on the sphere, so only the
    # membership vote can preserve the id. An unchanged group must not churn.
    dim = 32
    embs = l2_normalize(make_cluster(unit(dim, 0), 5))
    prev_centroids = {"personA": centroid(l2_normalize(make_cluster(unit(dim, 7), 5)))}
    ids = assign_stable_ids(
        np.zeros(5, dtype=int),
        embs,
        prev_centroids,
        make_id=lambda: "SHOULD_NOT_MINT",
        previous_ids=["personA", "personA", "personA", None, None],
    )
    assert ids == {0: "personA"}


def test_stable_ids_vote_beats_a_conflicting_centroid_match():
    # Two new clusters; centroids say both look like "old", but the vote pins the
    # id to the cluster whose members actually carried it. One-to-one holds.
    dim = 32
    anchor = unit(dim, 0)
    close = l2_normalize(make_cluster(anchor, 4, jitter=0.005))
    also_close = l2_normalize(make_cluster(anchor, 4, jitter=0.005))
    embs = np.vstack([close, also_close])
    labels = np.array([0] * 4 + [1] * 4)
    prev = {"old": centroid(close)}
    made = iter(["fresh1"])
    ids = assign_stable_ids(
        labels,
        embs,
        prev,
        make_id=lambda: next(made),
        # label 1 owns the "old" members; label 0's faces are all new.
        previous_ids=[None, None, None, None, "old", "old", "old", "old"],
    )
    assert ids[1] == "old"
    assert ids[0] == "fresh1"


def test_recluster_reclaims_id_from_persisted_centroid_after_rescan():
    # Simulate a rescan: an item's faces were re-inserted with cluster_id=None, so
    # membership continuity is gone. The persisted centroid must reclaim the id.
    dim = 512
    first_rows = [
        {"id": f"f{i}", "cluster_id": None, "embedding": e.astype(np.float32)}
        for i, e in enumerate(make_cluster(unit(dim, 0), 4))
    ]
    first = recluster(first_rows, make_id=lambda: "personA")
    assert set(first.values()) == {"personA"}

    persisted = {cid: vec for cid, (vec, _count) in centroids_by_cluster(first_rows, first).items()}
    assert set(persisted) == {"personA"}

    # Fresh faces of the same person, all cluster_id=None (post-rescan state).
    rescanned = [
        {"id": f"g{i}", "cluster_id": None, "embedding": e.astype(np.float32)}
        for i, e in enumerate(make_cluster(unit(dim, 0), 4))
    ]
    second = recluster(
        rescanned,
        make_id=lambda: "SHOULD_NOT_MINT",
        prior_centroids=persisted,
    )
    assert set(second.values()) == {"personA"}


def video_row(face_id, item_id, frame_time, emb):
    return {
        "id": face_id,
        "item_id": item_id,
        "frame_time": frame_time,
        "cluster_id": None,
        "embedding": emb.astype(np.float32),
    }


def test_build_units_groups_same_video_faces_by_similarity():
    dim = 64
    a = make_cluster(unit(dim, 0), 3, jitter=0.005)
    b = make_cluster(unit(dim, 1), 2, jitter=0.005)
    rows = [video_row(f"a{i}", "vid1", float(i), e) for i, e in enumerate(a)]
    rows += [video_row(f"b{i}", "vid1", float(i), e) for i, e in enumerate(b)]
    rows.append({"id": "photo", "cluster_id": None, "embedding": unit(dim, 2).astype(np.float32)})

    units = build_units(rows, l2_normalize(np.stack([np.asarray(r["embedding"], dtype=np.float64) for r in rows])))

    sizes = sorted(len(u) for u in units)
    assert sizes == [1, 2, 3]  # photo singleton, person B tracklet, person A tracklet


def test_recluster_links_tracklets_across_videos():
    dim = 512
    person = unit(dim, 0)
    rows = [video_row(f"v1f{i}", "vid1", float(i), e) for i, e in enumerate(make_cluster(person, 5, 0.005))]
    rows += [video_row(f"v2f{i}", "vid2", float(i), e) for i, e in enumerate(make_cluster(person, 4, 0.005))]

    assignments = recluster(rows)

    ids = set(assignments.values())
    assert len(ids) == 1 and None not in ids


def test_recluster_promotes_a_substantial_single_video_tracklet():
    # A person who appears in only one video has nothing to pair with, but a
    # 4-face tracklet must still surface for review rather than die as noise.
    dim = 512
    rows = [
        video_row(f"f{i}", "vid1", float(i), e)
        for i, e in enumerate(make_cluster(unit(dim, 0), 4, 0.005))
    ]

    assignments = recluster(rows)

    ids = set(assignments.values())
    assert len(ids) == 1 and None not in ids


def test_recluster_leaves_tiny_lonely_tracklets_as_noise():
    dim = 512
    rows = [
        video_row(f"f{i}", "vid1", float(i), e)
        for i, e in enumerate(make_cluster(unit(dim, 0), 2, 0.005))
    ]

    assert set(recluster(rows).values()) == {None}


def test_suggest_people_matches_cluster_to_confirmed_person():
    dim = 512
    anchor = unit(dim, 0)
    rows = [
        dict(video_row(f"c{i}", "vid1", float(i), e), status="confirmed", person_id="p1")
        for i, e in enumerate(make_cluster(anchor, 3, 0.005))
    ]
    rows += [
        dict(video_row(f"n{i}", "vid2", float(i), e), status="pending")
        for i, e in enumerate(make_cluster(anchor, 4, 0.005))
    ]
    rows += [
        dict(video_row(f"x{i}", "vid3", float(i), e), status="pending")
        for i, e in enumerate(make_cluster(unit(dim, 1), 4, 0.005))
    ]
    assignments = {r["id"]: ("near" if r["id"][0] in "cn" else "far") for r in rows}

    suggestions = suggest_people(rows, assignments)

    assert suggestions == {"near": "p1"}


def test_recluster_returns_none_for_noise():
    rows = [{"id": "a", "cluster_id": None, "embedding": np.ones(512, dtype=np.float32)}]
    assert recluster(rows) == {"a": None}


def test_recluster_empty_input():
    assert recluster([]) == {}

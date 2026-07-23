"""Faces worker entrypoint.

The worker claims face_scan jobs from the shared SQLite database, scans the
item original, stores fresh pending faces, reclusters pending/confirmed faces,
and marks the job complete. Person assignment is intentionally absent here;
human review owns that later.
"""

import math
import os
import time
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

import numpy as np

import cluster
import dbq
from boxes import normalize_box

PHOTO_TYPES = {"photo"}
VIDEO_TYPES = {"video"}
MAX_VIDEO_FRAMES = 60
CROP_MARGIN = 0.4
CROP_MAX_SIDE = 256
CROP_JPEG_QUALITY = 85


@dataclass(frozen=True)
class Settings:
    """Scan/cluster tuning, each overridable via a FACE_* env var.

    The quality gates exist because home-video frames are full of motion-blurred,
    tiny, or profile faces whose embeddings are noise — keeping them out of the
    database is what keeps the clusters clean.
    """

    min_det_score: float = 0.6  # FACE_MIN_DET_SCORE — detector confidence floor
    min_face_px: int = 48  # FACE_MIN_FACE_PX — smallest usable box side, source pixels
    reject_sim: float = 0.9  # FACE_REJECT_SIM — drop rescanned faces this close to a rejected one
    person_sim: float = 0.5  # FACE_PERSON_SIM — floor for suggesting a confirmed person
    track_sim: float = 0.6  # FACE_TRACK_SIM — same-video tracklet link threshold
    min_track_faces: int = 3  # FACE_MIN_TRACK_FACES — tracklet size that surfaces alone


def _env_float(env: Mapping[str, str], key: str, fallback: float) -> float:
    raw = env.get(key)
    if raw is None or str(raw).strip() == "":
        return fallback
    try:
        return float(str(raw).strip())
    except (TypeError, ValueError):
        return fallback


def settings_from_env(env: Mapping[str, str] | None = None) -> Settings:
    env = _env(env)
    return Settings(
        min_det_score=_env_float(env, "FACE_MIN_DET_SCORE", Settings.min_det_score),
        min_face_px=int(_env_float(env, "FACE_MIN_FACE_PX", Settings.min_face_px)),
        reject_sim=_env_float(env, "FACE_REJECT_SIM", Settings.reject_sim),
        person_sim=_env_float(env, "FACE_PERSON_SIM", Settings.person_sim),
        track_sim=_env_float(env, "FACE_TRACK_SIM", Settings.track_sim),
        min_track_faces=int(_env_float(env, "FACE_MIN_TRACK_FACES", Settings.min_track_faces)),
    )


def _resolve_within(media_path: Path | str, storage_key: str) -> Path:
    """Resolve ``storage_key`` under ``media_path`` and refuse any escape.

    ``storage_key`` is read from the database (``item_files``). We treat it as
    untrusted: an absolute key or one containing ``..`` must never read outside
    the mounted media directory, so a tampered row cannot point the worker at
    arbitrary host files.
    """
    root = Path(media_path).resolve()
    target = (root / storage_key).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise PermissionError(f"refusing path outside MEDIA_PATH: {storage_key}")
    return target


def load_cv2():
    import cv2

    return cv2


def _env(env: Mapping[str, str] | None) -> Mapping[str, str]:
    return os.environ if env is None else env


def parse_providers(env: Mapping[str, str] | None = None) -> list[str]:
    """Read the ORT execution provider list from ``FACE_PROVIDERS``.

    Comma-separated, whitespace trimmed, empties dropped. Defaults to the
    CPU-only behavior the service has always shipped.
    """
    raw = _env(env).get("FACE_PROVIDERS", "CPUExecutionProvider")
    providers = [part.strip() for part in raw.split(",") if part.strip()]
    return providers or ["CPUExecutionProvider"]


def parse_model_pack(env: Mapping[str, str] | None = None) -> str:
    """InsightFace model pack name from ``FACE_MODEL_PACK`` (default buffalo_l)."""
    pack = _env(env).get("FACE_MODEL_PACK", "buffalo_l").strip()
    return pack or "buffalo_l"


def parse_det_size(env: Mapping[str, str] | None = None) -> tuple[int, int]:
    """Square detection size ``(n, n)`` from ``FACE_DET_SIZE`` (default 640)."""
    raw = _env(env).get("FACE_DET_SIZE", "640")
    try:
        n = int(str(raw).strip())
    except (TypeError, ValueError):
        n = 640
    if n <= 0:
        n = 640
    return (n, n)


def parse_det_thresh(env: Mapping[str, str] | None = None) -> float | None:
    """Optional detection threshold from ``FACE_DET_THRESH``.

    Returns ``None`` when unset/blank/invalid so the InsightFace default stands.
    """
    raw = _env(env).get("FACE_DET_THRESH")
    if raw is None or str(raw).strip() == "":
        return None
    try:
        return float(str(raw).strip())
    except (TypeError, ValueError):
        return None


def build_provider_options(providers: list[str], env: Mapping[str, str] | None = None) -> list[dict]:
    """Build an onnxruntime ``provider_options`` list aligned with ``providers``.

    Only the OpenVINO entry receives a ``device_type`` (from
    ``FACE_OPENVINO_DEVICE``, default ``GPU``); every other provider gets ``{}``.
    """
    device = (_env(env).get("FACE_OPENVINO_DEVICE", "GPU") or "GPU").strip() or "GPU"
    return [
        {"device_type": device} if p == "OpenVINOExecutionProvider" else {}
        for p in providers
    ]


def create_analyzer(env: Mapping[str, str] | None = None):
    from insightface.app import FaceAnalysis

    env = _env(env)
    root = env.get("INSIGHTFACE_HOME", "/models")
    model_pack = parse_model_pack(env)
    det_size = parse_det_size(env)
    det_thresh = parse_det_thresh(env)
    providers = parse_providers(env)

    def _prepare(analyzer):
        prepare_kwargs: dict = {"ctx_id": 0, "det_size": det_size}
        if det_thresh is not None:
            prepare_kwargs["det_thresh"] = det_thresh
        analyzer.prepare(**prepare_kwargs)
        return analyzer

    try:
        analysis_kwargs: dict = {"name": model_pack, "root": root, "providers": providers}
        # Only attach provider_options when OpenVINO is requested so the plain
        # CPU path stays byte-for-byte identical to the historical default.
        if "OpenVINOExecutionProvider" in providers:
            analysis_kwargs["provider_options"] = build_provider_options(providers, env)
        analyzer = FaceAnalysis(**analysis_kwargs)
        return _prepare(analyzer)
    except Exception as exc:
        print(
            f"[faces] analyzer init failed for providers={providers} "
            f"pack={model_pack}: {exc}; falling back to CPUExecutionProvider",
            file=sys.stderr,
        )
        analyzer = FaceAnalysis(name=model_pack, root=root, providers=["CPUExecutionProvider"])
        return _prepare(analyzer)


def usable_face(face, settings: Settings) -> bool:
    """Whether a detection is worth embedding at all.

    Low-confidence and tiny faces produce embeddings that cluster as noise (the
    ArcFace crop is 112px — a 30px face is mostly upscaling artifacts), so they
    are dropped at the door instead of polluting review.
    """
    score = getattr(face, "det_score", None)
    if score is not None and float(score) < settings.min_det_score:
        return False
    x1, y1, x2, y2 = face.bbox
    return min(abs(float(x2) - float(x1)), abs(float(y2) - float(y1))) >= settings.min_face_px


def crop_jpeg(frame: np.ndarray, bbox) -> bytes | None:
    """A margin-padded JPEG crop of the face, for the review UI."""
    cv2 = load_cv2()
    img_h, img_w = frame.shape[:2]
    x1, y1, x2, y2 = (float(v) for v in bbox)
    mx = (x2 - x1) * CROP_MARGIN
    my = (y2 - y1) * CROP_MARGIN
    left = max(0, int(x1 - mx))
    top = max(0, int(y1 - my))
    right = min(img_w, int(math.ceil(x2 + mx)))
    bottom = min(img_h, int(math.ceil(y2 + my)))
    if right <= left or bottom <= top:
        return None
    crop = frame[top:bottom, left:right]
    longest = max(crop.shape[:2])
    if longest > CROP_MAX_SIDE:
        scale = CROP_MAX_SIDE / longest
        crop = cv2.resize(
            crop, (max(1, int(crop.shape[1] * scale)), max(1, int(crop.shape[0] * scale)))
        )
    ok, buf = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), CROP_JPEG_QUALITY])
    return buf.tobytes() if ok else None


def _detection(face, frame_time: float | None, frame: np.ndarray) -> dict:
    img_h, img_w = frame.shape[:2]
    x1, y1, x2, y2 = face.bbox
    embedding = np.asarray(face.embedding, dtype="<f4")
    return {
        "frame_time": frame_time,
        "box": normalize_box(x1, y1, x2, y2, img_w, img_h),
        "embedding": embedding.tobytes(),
        "crop": crop_jpeg(frame, face.bbox),
    }


def _detect_frame(analyzer, frame: np.ndarray, frame_time: float | None, settings: Settings) -> list[dict]:
    return [
        _detection(face, frame_time, frame)
        for face in analyzer.get(frame)
        if usable_face(face, settings)
    ]


def scan_photo(path: Path | str, analyzer, settings: Settings = Settings()) -> list[dict]:
    cv2 = load_cv2()
    image = cv2.imread(str(path))
    if image is None:
        raise FileNotFoundError(f"could not read image {path}")
    return _detect_frame(analyzer, image, None, settings)


def scan_video(path: Path | str, analyzer, settings: Settings = Settings()) -> list[dict]:
    """Sample up to MAX_VIDEO_FRAMES frames spread over the WHOLE duration.

    Short clips get ~1 fps; long ones get evenly spaced seeks, so a person who
    only appears in the last act of an 18-minute tape is still found. When the
    container reports no frame count, fall back to a sequential 1 fps scan of
    the first MAX_VIDEO_FRAMES seconds.
    """
    cv2 = load_cv2()
    cap = cv2.VideoCapture(str(path))
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    if fps <= 0:
        fps = 1.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    detections: list[dict] = []

    try:
        if frame_count > 0:
            duration = frame_count / fps
            samples = min(MAX_VIDEO_FRAMES, max(1, math.ceil(duration)))
            step = frame_count / samples
            indices = sorted({min(frame_count - 1, int(i * step)) for i in range(samples)})
            for index in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, index)
                ok, frame = cap.read()
                if not ok:
                    continue
                detections.extend(_detect_frame(analyzer, frame, round(index / fps, 3), settings))
        else:
            stride = max(1, round(fps))
            frame_index = 0
            sampled = 0
            while sampled < MAX_VIDEO_FRAMES:
                ok, frame = cap.read()
                if not ok:
                    break
                if frame_index % stride == 0:
                    detections.extend(
                        _detect_frame(analyzer, frame, round(frame_index / fps, 3), settings)
                    )
                    sampled += 1
                frame_index += 1
    finally:
        cap.release()

    return detections


def drop_rejected_lookalikes(
    detections: list[dict], rejected: np.ndarray, reject_sim: float
) -> list[dict]:
    """Drop detections nearly identical to a face already rejected on this item.

    Rescans mint fresh face ids, so this embedding-level match is the only thing
    honoring past rejections instead of resurfacing the same junk for review.
    """
    if rejected.size == 0 or not detections:
        return detections
    rej = cluster.l2_normalize(rejected)
    keep = []
    for det in detections:
        emb = np.frombuffer(det["embedding"], dtype=np.float32).astype(np.float64)
        norm = np.linalg.norm(emb)
        if norm > 0:
            emb = emb / norm
        if float(np.max(rej @ emb)) < reject_sim:
            keep.append(det)
    return keep


def sync_crops(
    media_path: Path | str,
    item_id: str,
    stale_ids: list[str],
    new_ids: list[str],
    detections: list[dict],
) -> None:
    """Replace the item's pending-face crop files to mirror the faces table."""
    faces_dir = _resolve_within(media_path, f"media/{item_id}/faces")
    for face_id in stale_ids:
        (faces_dir / f"{face_id}.jpg").unlink(missing_ok=True)
    for face_id, det in zip(new_ids, detections):
        data = det.get("crop")
        if not data:
            continue
        faces_dir.mkdir(parents=True, exist_ok=True)
        (faces_dir / f"{face_id}.jpg").write_bytes(data)


def process_job(conn, media_path: Path | str, analyzer, job: dict, settings: Settings | None = None) -> bool:
    settings = settings if settings is not None else settings_from_env()
    try:
        item_id = job["payload"]["itemId"]
        storage_key, item_type = dbq.original_path(conn, item_id)
        original = _resolve_within(media_path, storage_key)
        if item_type in PHOTO_TYPES:
            detections = scan_photo(original, analyzer, settings)
        elif item_type in VIDEO_TYPES:
            detections = scan_video(original, analyzer, settings)
        else:
            raise ValueError(f"unsupported item type {item_type}")

        detections = drop_rejected_lookalikes(
            detections, dbq.rejected_embeddings(conn, item_id), settings.reject_sim
        )
        stale_ids = dbq.pending_face_ids(conn, item_id)
        new_ids = dbq.replace_pending_faces(conn, item_id, detections)
        sync_crops(media_path, item_id, stale_ids, new_ids, detections)
        rows = dbq.load_embeddings_for_clustering(conn)
        prior_centroids = dbq.load_cluster_centroids(conn)
        assignments = cluster.recluster(
            rows,
            prior_centroids=prior_centroids,
            track_sim=settings.track_sim,
            min_track_faces=settings.min_track_faces,
        )
        dbq.apply_cluster_assignments(conn, assignments)
        dbq.save_cluster_centroids(conn, cluster.centroids_by_cluster(rows, assignments))
        dbq.apply_person_suggestions(
            conn, cluster.suggest_people(rows, assignments, settings.person_sim)
        )
        dbq.complete_job(conn, job["id"])
        return True
    except Exception as exc:
        print(f"[faces] job {job.get('id')} failed: {exc}", file=sys.stderr)
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
            try:
                process_job(conn, media_path, worker_analyzer, job)
            except Exception as exc:
                print(f"[faces] worker error on job {job.get('id')}: {exc}", file=sys.stderr)
    finally:
        conn.close()


def main():
    db_path = os.environ["DATABASE_PATH"]
    media_path = os.environ["MEDIA_PATH"]
    run_loop(db_path, media_path)


if __name__ == "__main__":
    main()

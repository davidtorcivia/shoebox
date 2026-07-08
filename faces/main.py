"""Faces worker entrypoint.

The worker claims face_scan jobs from the shared SQLite database, scans the
item original, stores fresh pending faces, reclusters pending/confirmed faces,
and marks the job complete. Person assignment is intentionally absent here;
human review owns that later.
"""

import os
import time
import sys
from pathlib import Path
from typing import Mapping

import numpy as np

import cluster
import dbq
from boxes import normalize_box

PHOTO_TYPES = {"photo"}
VIDEO_TYPES = {"video"}
MAX_VIDEO_FRAMES = 60


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


def _detection(face, frame_time: float | None, img_w: int, img_h: int) -> dict:
    x1, y1, x2, y2 = face.bbox
    embedding = np.asarray(face.embedding, dtype="<f4")
    return {
        "frame_time": frame_time,
        "box": normalize_box(x1, y1, x2, y2, img_w, img_h),
        "embedding": embedding.tobytes(),
    }


def scan_photo(path: Path | str, analyzer) -> list[dict]:
    cv2 = load_cv2()
    image = cv2.imread(str(path))
    if image is None:
        raise FileNotFoundError(f"could not read image {path}")
    img_h, img_w = image.shape[:2]
    return [_detection(face, None, img_w, img_h) for face in analyzer.get(image)]


def scan_video(path: Path | str, analyzer) -> list[dict]:
    cv2 = load_cv2()
    cap = cv2.VideoCapture(str(path))
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 1.0)
    if fps <= 0:
        fps = 1.0
    stride = max(1, round(fps))
    detections: list[dict] = []
    frame_index = 0
    sampled = 0

    try:
        while sampled < MAX_VIDEO_FRAMES:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_index % stride == 0:
                img_h, img_w = frame.shape[:2]
                frame_time = round(frame_index / fps, 3)
                detections.extend(
                    _detection(face, frame_time, img_w, img_h) for face in analyzer.get(frame)
                )
                sampled += 1
            frame_index += 1
    finally:
        cap.release()

    return detections


def process_job(conn, media_path: Path | str, analyzer, job: dict) -> bool:
    try:
        item_id = job["payload"]["itemId"]
        storage_key, item_type = dbq.original_path(conn, item_id)
        original = _resolve_within(media_path, storage_key)
        if item_type in PHOTO_TYPES:
            detections = scan_photo(original, analyzer)
        elif item_type in VIDEO_TYPES:
            detections = scan_video(original, analyzer)
        else:
            raise ValueError(f"unsupported item type {item_type}")

        dbq.replace_pending_faces(conn, item_id, detections)
        rows = dbq.load_embeddings_for_clustering(conn)
        prior_centroids = dbq.load_cluster_centroids(conn)
        assignments = cluster.recluster(rows, prior_centroids=prior_centroids)
        dbq.apply_cluster_assignments(conn, assignments)
        dbq.save_cluster_centroids(conn, cluster.centroids_by_cluster(rows, assignments))
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

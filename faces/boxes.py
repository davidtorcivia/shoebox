import json
from typing import Mapping


def _clamp01(value: float) -> float:
    return min(1.0, max(0.0, float(value)))


def _stable_float(value: float) -> float:
    return round(float(value), 12)


def normalize_box(x1: float, y1: float, x2: float, y2: float, img_w: int, img_h: int) -> dict:
    if img_w <= 0 or img_h <= 0:
        raise ValueError("image dimensions must be positive")

    left = min(float(x1), float(x2))
    right = max(float(x1), float(x2))
    top = min(float(y1), float(y2))
    bottom = max(float(y1), float(y2))

    nx1 = _clamp01(left / img_w)
    ny1 = _clamp01(top / img_h)
    nx2 = _clamp01(right / img_w)
    ny2 = _clamp01(bottom / img_h)

    return {
        "x": _stable_float(nx1),
        "y": _stable_float(ny1),
        "w": _stable_float(max(0.0, nx2 - nx1)),
        "h": _stable_float(max(0.0, ny2 - ny1)),
    }


def box_json(box: Mapping[str, float]) -> str:
    return json.dumps(
        {key: float(box[key]) for key in ("h", "w", "x", "y")},
        sort_keys=True,
        separators=(",", ":"),
    )

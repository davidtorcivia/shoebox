import json

import pytest

from boxes import box_json, normalize_box


def test_normalize_box_returns_unit_coordinates():
    assert normalize_box(10, 20, 50, 70, 100, 100) == {
        "x": 0.1,
        "y": 0.2,
        "w": 0.4,
        "h": 0.5,
    }


def test_normalize_box_clamps_to_image_bounds():
    assert normalize_box(-10, -20, 120, 80, 100, 100) == {
        "x": 0.0,
        "y": 0.0,
        "w": 1.0,
        "h": 0.8,
    }


def test_normalize_box_accepts_reversed_corners():
    assert normalize_box(50, 70, 10, 20, 100, 100) == {
        "x": 0.1,
        "y": 0.2,
        "w": 0.4,
        "h": 0.5,
    }


def test_normalize_box_rejects_non_positive_dimensions():
    with pytest.raises(ValueError):
        normalize_box(0, 0, 1, 1, 0, 100)
    with pytest.raises(ValueError):
        normalize_box(0, 0, 1, 1, 100, -1)


def test_box_json_is_compact_and_key_sorted():
    encoded = box_json({"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4})
    assert encoded == '{"h":0.4,"w":0.3,"x":0.1,"y":0.2}'
    assert json.loads(encoded) == {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}

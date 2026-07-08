"""Unit tests for the env-driven analyzer configuration helpers.

These cover the pure parsing helpers only; ``create_analyzer`` itself needs the
heavyweight InsightFace/onnxruntime stack and is exercised via the container.
"""

import main


def test_parse_providers_defaults_to_cpu():
    assert main.parse_providers({}) == ["CPUExecutionProvider"]


def test_parse_providers_splits_and_trims():
    env = {"FACE_PROVIDERS": " OpenVINOExecutionProvider , CPUExecutionProvider "}
    assert main.parse_providers(env) == [
        "OpenVINOExecutionProvider",
        "CPUExecutionProvider",
    ]


def test_parse_providers_ignores_empty_entries():
    assert main.parse_providers({"FACE_PROVIDERS": ",, ,"}) == ["CPUExecutionProvider"]


def test_parse_model_pack_default_and_override():
    assert main.parse_model_pack({}) == "buffalo_l"
    assert main.parse_model_pack({"FACE_MODEL_PACK": "buffalo_s"}) == "buffalo_s"
    assert main.parse_model_pack({"FACE_MODEL_PACK": "  "}) == "buffalo_l"


def test_parse_det_size_default_and_override():
    assert main.parse_det_size({}) == (640, 640)
    assert main.parse_det_size({"FACE_DET_SIZE": "1024"}) == (1024, 1024)


def test_parse_det_size_falls_back_on_garbage():
    assert main.parse_det_size({"FACE_DET_SIZE": "nope"}) == (640, 640)
    assert main.parse_det_size({"FACE_DET_SIZE": "0"}) == (640, 640)
    assert main.parse_det_size({"FACE_DET_SIZE": "-5"}) == (640, 640)


def test_parse_det_thresh_unset_is_none():
    assert main.parse_det_thresh({}) is None
    assert main.parse_det_thresh({"FACE_DET_THRESH": ""}) is None
    assert main.parse_det_thresh({"FACE_DET_THRESH": "  "}) is None


def test_parse_det_thresh_parses_float():
    assert main.parse_det_thresh({"FACE_DET_THRESH": "0.4"}) == 0.4
    assert main.parse_det_thresh({"FACE_DET_THRESH": "bad"}) is None


def test_build_provider_options_only_openvino_gets_device():
    providers = ["OpenVINOExecutionProvider", "CPUExecutionProvider"]
    assert main.build_provider_options(providers, {}) == [
        {"device_type": "GPU"},
        {},
    ]


def test_build_provider_options_honors_device_env():
    providers = ["OpenVINOExecutionProvider"]
    assert main.build_provider_options(providers, {"FACE_OPENVINO_DEVICE": "GPU.0"}) == [
        {"device_type": "GPU.0"}
    ]


def test_build_provider_options_cpu_only_is_all_empty():
    assert main.build_provider_options(["CPUExecutionProvider"], {}) == [{}]

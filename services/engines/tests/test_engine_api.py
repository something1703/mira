import base64
import io
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from mira_engines import ENGINE_VERSION
from mira_engines.api import app
from mira_engines.colour import hex_to_rgb8

client = TestClient(app, raise_server_exceptions=False)


def png_b64(arr: np.ndarray, mode: str) -> str:
    buf = io.BytesIO()
    Image.fromarray(arr, mode).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def post(path: str, body: dict[str, Any]) -> Any:
    res = client.post(path, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["engine_version"] == ENGINE_VERSION
    assert "MATCH_DE" in data["config"]
    return data["result"]


def test_colour_lab() -> None:
    out = post("/colour/lab", {"hex": ["#FFFFFF", "#C68E6A"]})
    assert out[0]["lab"][0] == pytest.approx(100.0, abs=1e-3)
    assert out[1]["ita_band"] in {"very light", "light", "intermediate", "tan", "brown", "dark"}
    assert client.post("/colour/lab", json={"hex": ["nope"]}).status_code == 422
    assert client.post("/colour/lab", json={"hex": []}).status_code == 422


def test_de2000_matches_sharma_pair_1() -> None:
    out = post("/colour/de2000", {"pairs": [[[50, 2.6772, -79.7751], [50, 0, -82.7485]]]})
    assert out[0] == pytest.approx(2.0425, abs=1e-4)


def test_extra_fields_are_rejected() -> None:
    assert client.post("/colour/de2000", json={"pairs": [], "extra": 1}).status_code == 422


def test_prerank_and_closed_loop() -> None:
    skin = [65.0, 14.0, 20.0]
    ranked = post(
        "/shade/prerank",
        {
            "skin": skin,
            "catalogue": [
                {"id": "a", "name": "A", "lab": [80.0, 14.0, 20.0]},
                {"id": "b", "name": "B", "lab": [65.0, 14.0, 20.0]},
            ],
        },
    )
    assert [r["id"] for r in ranked] == ["b", "a"]
    loop = post(
        "/shade/closed-loop", {"skin": skin, "shade": [70, 14, 24], "render": [66, 14, 21.5]}
    )
    assert loop["direction_ok"] is True


def test_finish_endpoint() -> None:
    out = post("/shade/finish", {"skin_type_whole": "Dry", "concern_raw_scores": {"acne": 30}})
    assert out["finishes"] == ["dewy"]
    assert out["coverage"] == "medium"


def test_look_suggest() -> None:
    out = post(
        "/look/suggest",
        {
            "garment": [40, 39, 7],
            "skin": [65, 11, 16],
            "natural_lip": [55, 27, 12],
            "hair": [20, 3, 4],
            "lips": [{"id": "l", "name": "L", "lab": [30, 33, 9]}],
        },
    )
    assert out["lip"]["shade"]["id"] == "l"


def test_garment_colour_endpoint() -> None:
    img = np.zeros((10, 10, 4), dtype=np.uint8)
    img[..., :3] = hex_to_rgb8("#B03060")
    img[..., 3] = 255
    out = post("/garment/colour", {"image_b64": png_b64(img, "RGBA")})
    assert out["multicolour"] is False
    assert client.post("/garment/colour", json={"image_b64": "!!"}).status_code == 422
    assert client.post("/garment/colour", json={"image_b64": "AAAA"}).status_code == 422


def test_audit_garment_with_supplied_face_box() -> None:
    src = np.full((600, 400, 3), 200, dtype=np.uint8)
    ren = src.copy()
    ren[218:410, 80:320] = hex_to_rgb8("#B03060")
    body = {
        "source_b64": png_b64(src, "RGB"),
        "render_b64": png_b64(ren, "RGB"),
        "garment_labs": [[39.0, 55.0, 7.0]],
        "face_box": {"x": 150, "y": 50, "width": 100, "height": 120},
    }
    assert post("/audit/garment", body)["label"] in {"verified", "drift"}
    unchanged = {**body, "render_b64": body["source_b64"]}
    assert post("/audit/garment", unchanged)["label"] == "not_checked"


def test_audit_garment_without_detector_or_box_is_503(monkeypatch: pytest.MonkeyPatch) -> None:
    # The model is bundled; point at a missing one to test the unavailable path.
    monkeypatch.setenv("MIRA_FACE_MODEL_PATH", "/nonexistent/blaze_face.tflite")
    src = png_b64(np.zeros((20, 20, 3), dtype=np.uint8), "RGB")
    res = client.post(
        "/audit/garment", json={"source_b64": src, "render_b64": src, "garment_labs": [[50, 0, 0]]}
    )
    assert res.status_code == 503


def test_lip_identity_stats_phantom() -> None:
    assert (
        post("/audit/lip", {"rendered": [50, 10, 10], "intended": [50, 10, 10]})["label"]
        == "verified"
    )
    assert post("/audit/identity", {"source": [1, 2], "final": [1, 2.4]})["passed"] is False
    assert client.post("/audit/identity", json={"source": [0], "final": [1]}).status_code == 422

    nf = post("/stats/noise-floor", {"sessions": [[60, 62, 61]] * 3})
    assert nf["s_d_source"] == "estimated"
    assert client.post("/stats/noise-floor", json={"sessions": [[1]]}).status_code == 422

    ch = post("/stats/change", {"baseline": 60, "now": 70, "mdc": 3, "claim_direction": "up"})
    assert ch["words"] == "clear"

    ph = post(
        "/phantom/fit",
        {
            "intensities": [0, 0.25, 0.5, 0.75, 1],
            "scores": [60, 56, 52, 48, 44],
            "mdc": 3,
            "invert_at": -8,
        },
    )
    assert ph["usable"] is True
    assert ph["inverted_intensity"] == pytest.approx(0.5)

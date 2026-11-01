import numpy as np
import pytest

from mira_engines.audit import FaceBox, garment_audit, identity_drift, lip_audit, torso_region
from mira_engines.colour import hex_to_lab, hex_to_rgb8
from mira_engines.garment import garment_colour

H, W = 600, 400
FACE = FaceBox(150, 50, 100, 120)  # chin at y = 170


def scene(torso_hex: str) -> np.ndarray:
    img = np.full((H, W, 3), (200, 200, 200), dtype=np.uint8)
    x0, y0, x1, y1 = torso_region(FACE, H, W)
    img[y0:y1, x0:x1] = hex_to_rgb8(torso_hex)
    return img


def test_torso_region_follows_the_spec_and_clips() -> None:
    assert torso_region(FACE, H, W) == (80, 218, 320, 410)
    assert torso_region(FaceBox(0, 50, 100, 120), H, W)[0] == 0
    assert torso_region(FACE, 300, W)[3] == 300


def test_recoloured_torso_is_verified() -> None:
    source = scene("#3A3A3A")
    render = scene("#B03060")
    out = garment_audit(source, render, FACE, [hex_to_lab("#B03060")])
    assert out.label == "verified"
    assert out.de is not None
    assert out.de < 1.0
    assert out.changed_share > 0.9


def test_unchanged_torso_is_not_checked() -> None:
    source = scene("#3A3A3A")
    out = garment_audit(source, source.copy(), FACE, [hex_to_lab("#B03060")])
    assert out.label == "not_checked"
    assert out.reason == "torso_unchanged"
    assert out.changed_share == 0.0


def test_wrong_colour_is_drift_with_direction() -> None:
    source = scene("#3A3A3A")
    garment = hex_to_lab("#808080")
    lighter = garment_audit(source, scene("#D0D0D0"), FACE, [garment])
    darker = garment_audit(source, scene("#101010"), FACE, [garment])
    assert (lighter.label, lighter.direction) == ("drift", "lighter")
    assert (darker.label, darker.direction) == ("drift", "darker")


def test_multicolour_garment_passes_if_either_audit_colour_matches() -> None:
    source = scene("#3A3A3A")
    out = garment_audit(
        source, scene("#B03060"), FACE, [hex_to_lab("#2050A0"), hex_to_lab("#B03060")]
    )
    assert out.label == "verified"


def test_face_without_torso_in_frame_is_not_checked() -> None:
    low = FaceBox(150, 520, 100, 120)
    out = garment_audit(scene("#3A3A3A"), scene("#B03060"), low, [hex_to_lab("#B03060")])
    assert out.label == "not_checked"
    assert out.reason == "torso_outside_image"


def test_garment_audit_rejects_mismatched_inputs() -> None:
    with pytest.raises(ValueError, match="same size"):
        garment_audit(
            scene("#3A3A3A"), np.zeros((10, 10, 3), dtype=np.uint8), FACE, [(50.0, 0.0, 0.0)]
        )
    with pytest.raises(ValueError, match="garment colour"):
        garment_audit(scene("#3A3A3A"), scene("#3A3A3A"), FACE, [])


def test_lip_audit_threshold() -> None:
    intended = hex_to_lab("#B03060")
    assert lip_audit(intended, intended).label == "verified"
    assert lip_audit(hex_to_lab("#306090"), intended).label == "drift"


def test_identity_drift() -> None:
    base = [1.0, 0.5, 2.0]
    assert identity_drift(base, base).passed
    assert identity_drift(base, [1.0, 0.5 * 1.07, 2.0]).passed
    out = identity_drift(base, [1.0, 0.5 * 1.10, 2.0])
    assert not out.passed
    assert out.drift == pytest.approx(0.10)
    with pytest.raises(ValueError, match="same length"):
        identity_drift([1.0], [1.0, 2.0])
    with pytest.raises(ValueError, match="positive"):
        identity_drift([0.0], [1.0])


def rgba(colours: list[tuple[str, int]], alpha: int = 255) -> np.ndarray:
    rows = []
    for hex_, n in colours:
        px = np.zeros((n, 4), dtype=np.uint8)
        px[:, :3] = hex_to_rgb8(hex_)
        px[:, 3] = alpha
        rows.append(px)
    flat = np.concatenate(rows)
    return flat.reshape(1, -1, 4)


def test_single_colour_garment() -> None:
    out = garment_colour(rgba([("#B03060", 500)]))
    assert not out.multicolour
    assert out.share == 1.0
    assert out.lab == pytest.approx(hex_to_lab("#B03060"), abs=1e-6)


def test_dominant_cluster_wins_and_is_deterministic() -> None:
    img = rgba([("#B03060", 700), ("#202020", 200), ("#F0F0F0", 100)])
    a, b = garment_colour(img), garment_colour(img)
    assert a == b
    assert not a.multicolour
    assert a.share == pytest.approx(0.7)
    assert a.lab == pytest.approx(hex_to_lab("#B03060"), abs=1.0)


def test_multicolour_returns_top_two_for_audit() -> None:
    out = garment_colour(rgba([("#B03060", 400), ("#2050A0", 350), ("#F0F0F0", 250)]))
    assert out.multicolour
    assert len(out.audit_labs) == 2


def test_transparent_pixels_are_ignored() -> None:
    img = np.concatenate([rgba([("#B03060", 100)]), rgba([("#00FF00", 900)], alpha=0)], axis=1)
    assert garment_colour(img).lab == pytest.approx(hex_to_lab("#B03060"), abs=1e-6)
    with pytest.raises(ValueError, match="opaque"):
        garment_colour(rgba([("#00FF00", 10)], alpha=0))
    with pytest.raises(ValueError, match="RGBA"):
        garment_colour(np.zeros((2, 2, 3), dtype=np.uint8))

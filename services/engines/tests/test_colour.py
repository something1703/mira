import csv
from pathlib import Path

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from mira_engines.colour import (
    de2000,
    de2000_vec,
    hex_to_lab,
    hex_to_rgb8,
    hue_difference,
    ita_band,
    ita_degrees,
    lab_to_lch,
    rgb8_to_hex,
    rgb8_to_lab,
)

DATA = Path(__file__).parent / "data" / "sharma_2005.csv"


def _sharma() -> list[tuple[int, tuple[float, ...], tuple[float, ...], float]]:
    with DATA.open() as fh:
        rows = list(csv.reader(line for line in fh if not line.startswith("#")))[1:]
    return [
        (int(r[0]), tuple(map(float, r[1:4])), tuple(map(float, r[4:7])), float(r[7])) for r in rows
    ]


def test_all_34_sharma_pairs_to_four_decimals() -> None:
    pairs = _sharma()
    assert len(pairs) == 34
    for pair, lab1, lab2, expected in pairs:
        got = de2000((lab1[0], lab1[1], lab1[2]), (lab2[0], lab2[1], lab2[2]))
        assert round(got, 4) == pytest.approx(expected, abs=1e-4), f"pair {pair}"


def test_vectorised_matches_published_pairs() -> None:
    pairs = _sharma()
    p = np.array([x[1] for x in pairs])
    q = np.array([x[2] for x in pairs])
    expected = np.array([x[3] for x in pairs])
    np.testing.assert_allclose(de2000_vec(p, q), expected, atol=1e-4)


lab_strategy = st.tuples(st.floats(0, 100), st.floats(-128, 128), st.floats(-128, 128))


@given(lab_strategy)
def test_identity(lab: tuple[float, float, float]) -> None:
    assert de2000(lab, lab) == 0.0


@given(lab_strategy, lab_strategy)
def test_symmetry_and_non_negativity(
    a: tuple[float, float, float], b: tuple[float, float, float]
) -> None:
    d = de2000(a, b)
    assert d >= 0.0
    assert d == pytest.approx(de2000(b, a), abs=1e-9)


@given(lab_strategy, lab_strategy)
def test_vectorised_equals_scalar(
    a: tuple[float, float, float], b: tuple[float, float, float]
) -> None:
    assert float(de2000_vec(np.array(a), np.array(b))) == pytest.approx(de2000(a, b), abs=1e-9)


def test_vectorised_broadcasts_one_against_many() -> None:
    many = np.array([[50.0, 0.0, 0.0], [60.0, 10.0, 10.0], [70.0, -5.0, 20.0]])
    out = de2000_vec(np.array([50.0, 0.0, 0.0]), many)
    assert out.shape == (3,)
    assert out[0] == 0.0


def test_white_and_black() -> None:
    white = hex_to_lab("#FFFFFF")
    assert white[0] == pytest.approx(100.0, abs=1e-3)
    assert white[1] == pytest.approx(0.0, abs=0.05)
    assert white[2] == pytest.approx(0.0, abs=0.05)
    assert hex_to_lab("#000000") == pytest.approx((0.0, 0.0, 0.0), abs=1e-6)


def test_srgb_red_matches_colour_science_reference() -> None:
    # colour-science 0.4.x, D65 / 2°: sRGB (255, 0, 0) → Lab (53.2329, 80.1112, 67.2237).
    assert hex_to_lab("#FF0000") == pytest.approx((53.2329, 80.1112, 67.2237), abs=0.01)


def test_mid_grey_lightness() -> None:
    # The mat (--mira-mat #777777) is documented as L* ≈ 50 (docs/DESIGN_SYSTEM.md).
    assert hex_to_lab("#777777")[0] == pytest.approx(50.0, abs=0.5)


def test_rgb_array_shapes() -> None:
    out = rgb8_to_lab(np.zeros((4, 5, 3)))
    assert out.shape == (4, 5, 3)
    with pytest.raises(ValueError, match="trailing axis"):
        rgb8_to_lab(np.zeros((4, 2)))
    with pytest.raises(ValueError, match="0-255"):
        rgb8_to_lab(np.array([256.0, 0.0, 0.0]))


def test_hex_round_trip_and_validation() -> None:
    assert hex_to_rgb8("#a0b1C2") == (160, 177, 194)
    assert rgb8_to_hex(160, 177, 194) == "#A0B1C2"
    for bad in ("#12345", "red", "#GGGGGG", ""):
        with pytest.raises(ValueError, match="#RRGGBB"):
            hex_to_rgb8(bad)
    with pytest.raises(ValueError, match="range"):
        rgb8_to_hex(0, 0, 256)


def test_lch() -> None:
    lightness, chroma, hue = lab_to_lch((50.0, 3.0, 4.0))
    assert lightness == 50.0
    assert chroma == pytest.approx(5.0)
    assert hue == pytest.approx(53.1301, abs=1e-3)
    assert lab_to_lch((50.0, 0.0, -1.0))[2] == pytest.approx(270.0)


def test_ita_value() -> None:
    # arctan((70 − 50) / 20) = 45°.
    assert ita_degrees((70.0, 5.0, 20.0)) == pytest.approx(45.0)


@pytest.mark.parametrize(
    ("ita", "band"),
    [
        (80.0, "very light"),
        (55.1, "very light"),
        (55.0, "light"),
        (41.1, "light"),
        (41.0, "intermediate"),
        (28.1, "intermediate"),
        (28.0, "tan"),
        (10.1, "tan"),
        (10.0, "brown"),
        (-29.9, "brown"),
        (-30.0, "dark"),
        (-70.0, "dark"),
    ],
)
def test_ita_band_edges(ita: float, band: str) -> None:
    assert ita_band(ita) == band


def test_hue_difference_wraps_the_short_way() -> None:
    # h_ab ≈ 10° to h_ab ≈ 350° is −20°, not +340°.
    from math import cos, radians, sin

    def at(h: float) -> tuple[float, float, float]:
        return 50.0, 20 * cos(radians(h)), 20 * sin(radians(h))

    assert hue_difference(at(10.0), at(350.0)) == pytest.approx(-20.0, abs=1e-9)
    assert hue_difference(at(350.0), at(10.0)) == pytest.approx(20.0, abs=1e-9)

import math

import pytest
from fastapi.testclient import TestClient

from mira_engines import brand
from mira_engines.api import app
from mira_engines.colour import hex_to_lab

client = TestClient(app)


def lab(h: str) -> tuple[float, float, float]:
    v = hex_to_lab(h)
    return (float(v[0]), float(v[1]), float(v[2]))


LIGHT = lab("#F1D5BF")
DEEP = lab("#6E442B")


def test_a_range_with_no_deep_shade_does_not_serve_deep_skin() -> None:
    result = brand.gap_map([LIGHT] * 8 + [DEEP] * 2, [LIGHT, lab("#E8C4A5")])
    assert result.total == 10
    assert result.unserved == 2
    assert result.unserved_share == pytest.approx(0.2)


def test_a_shade_near_a_colour_serves_it() -> None:
    assert brand.gap_map([DEEP], [lab("#6F452C")]).unserved == 0


def test_bins_account_for_every_colour_and_never_invent_one() -> None:
    pts = [LIGHT, LIGHT, DEEP, lab("#C79A78"), lab("#9A6B4B")]
    result = brand.gap_map(pts, [LIGHT])
    assert sum(b.count for b in result.bins) == len(pts)
    assert sum(b.unserved for b in result.bins) == result.unserved
    for b in result.bins:
        assert 0 <= b.hue_lo < b.hue_hi <= 360
        assert 0 <= b.l_lo < b.l_hi <= 100
        assert b.count > 0


def test_the_nearest_difference_is_the_median_of_the_bin() -> None:
    result = brand.gap_map([DEEP, DEEP], [LIGHT])
    (only,) = result.bins
    assert only.nearest_de_median > result.near_de


def test_hue_angle_wraps_to_0_360() -> None:
    assert brand.hue_angle((50.0, 10.0, 0.0)) == pytest.approx(0.0)
    assert brand.hue_angle((50.0, 0.0, 10.0)) == pytest.approx(90.0)
    assert brand.hue_angle((50.0, 0.0, -10.0)) == pytest.approx(270.0)
    assert 0 <= brand.hue_angle((50.0, -10.0, -1.0)) < 360


def test_empty_inputs_are_refused() -> None:
    with pytest.raises(ValueError, match="skin colour"):
        brand.gap_map([], [LIGHT])
    with pytest.raises(ValueError, match="shade"):
        brand.gap_map([LIGHT], [])
    with pytest.raises(ValueError, match="finite"):
        brand.gap_map([(math.nan, 0.0, 0.0)], [LIGHT])


def test_the_endpoint_answers_with_the_threshold_it_used() -> None:
    res = client.post(
        "/brand/gap-map", json={"points": [list(LIGHT), list(DEEP)], "shades": [list(LIGHT)]}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["result"]["unserved"] == 1
    assert body["config"]["GAP_NEAR_DE"]["value"] == 3.5
    assert body["config"]["GAP_NEAR_DE"]["calibrated"] is False


def test_the_endpoint_refuses_unknown_fields_and_oversize_requests() -> None:
    assert (
        client.post(
            "/brand/gap-map", json={"points": [[1, 2, 3]], "shades": [[1, 2, 3]], "x": 1}
        ).status_code
        == 422
    )
    big = [[50.0, 10.0, 10.0]] * 401
    assert (
        client.post(
            "/brand/gap-map", json={"points": [[50.0, 1.0, 1.0]], "shades": big}
        ).status_code
        == 422
    )

import pytest

from mira_engines.colour import hex_to_lab
from mira_engines.shade import Shade, closed_loop, finish_and_coverage, prerank

SKIN = (65.0, 14.0, 20.0)


def shade(id_: str, lab: tuple[float, float, float]) -> Shade:
    return Shade(id_, id_, lab)


def test_prerank_orders_by_de_and_labels_by_threshold() -> None:
    ranked = prerank(
        SKIN,
        [
            shade("far", (80.0, 14.0, 20.0)),
            shade("same", (65.0, 14.0, 20.0)),
            shade("near", (66.0, 14.5, 20.5)),
        ],
    )
    assert [r.shade.id for r in ranked] == ["same", "near", "far"]
    assert ranked[0].de == 0.0
    assert ranked[0].label == "blends_closely"
    assert ranked[2].label == "lighter"


def test_prerank_close_band() -> None:
    probe = prerank(SKIN, [shade("a", (68.0, 14.0, 20.0))])[0]
    assert 2.0 < probe.de <= 3.5
    assert probe.label == "close"


def test_prerank_directions() -> None:
    darker = prerank(SKIN, [shade("d", (50.0, 14.0, 20.0))])[0]
    assert darker.label == "darker"
    # Same lightness, hue angle higher (more yellow) → warmer; lower → cooler.
    warmer = prerank(SKIN, [shade("w", (65.0, 9.0, 24.0))])[0]
    cooler = prerank(SKIN, [shade("c", (65.0, 19.0, 15.0))])[0]
    assert warmer.d_hue > 0
    assert warmer.label == "warmer"
    assert cooler.d_hue < 0
    assert cooler.label == "cooler"


def test_prerank_tie_break_prefers_smaller_hue_then_lightness() -> None:
    # Identical ΔE by symmetry of construction is rare; force it with duplicate labs.
    a = shade("b-id", (66.0, 14.0, 20.0))
    b = shade("a-id", (66.0, 14.0, 20.0))
    assert [r.shade.id for r in prerank(SKIN, [a, b])] == ["a-id", "b-id"]


def test_prerank_on_real_hex_values() -> None:
    skin = hex_to_lab("#C68E6A")
    ranked = prerank(
        skin,
        [
            Shade("light", "Light", hex_to_lab("#F1D3B8")),
            Shade("match", "Match", hex_to_lab("#C48C69")),
            Shade("deep", "Deep", hex_to_lab("#6B4430")),
        ],
    )
    assert ranked[0].shade.id == "match"
    assert ranked[0].label == "blends_closely"


def test_closed_loop_agrees_when_render_moves_toward_the_shade() -> None:
    shade_lab = (70.0, 14.0, 24.0)  # lighter and yellower than skin
    result = closed_loop(SKIN, shade_lab, (66.0, 14.0, 21.5))
    assert result.direction_ok
    assert result.blend_de > 0


def test_closed_loop_flags_opposite_direction() -> None:
    shade_lab = (70.0, 14.0, 24.0)
    assert not closed_loop(SKIN, shade_lab, (60.0, 14.0, 21.0)).direction_ok


def test_closed_loop_ignores_axes_where_the_shade_matches_skin() -> None:
    shade_lab = (70.0, 14.0, 20.2)  # b* barely differs, so no direction to check
    assert closed_loop(SKIN, shade_lab, (66.0, 14.0, 19.5)).direction_ok


def test_perfect_render_has_zero_blend() -> None:
    assert closed_loop(SKIN, SKIN, SKIN).blend_de == 0.0


@pytest.mark.parametrize(
    ("kind", "finishes", "reason"),
    [
        ("Oily", ("matte", "satin"), "oily"),
        ("Oily & Redness", ("matte", "satin"), "oily"),
        ("Dry", ("dewy",), "dry"),
        ("Combination", ("satin",), "combination"),
        (None, ("satin",), "no_skin_type"),
        ("Normal", ("satin",), "no_skin_type"),
    ],
)
def test_finish_rules(kind: str | None, finishes: tuple[str, ...], reason: str) -> None:
    out = finish_and_coverage(kind, {})
    assert out.finishes == finishes
    assert out.finish_reason == reason
    assert out.t_zone_note == (reason == "combination")


def test_coverage_raises_on_lowest_relevant_concern() -> None:
    assert finish_and_coverage("Dry", {"acne": 80.0, "redness": 40.0}).coverage == "medium"
    assert finish_and_coverage("Dry", {"acne": 80.0, "redness": 70.0}).coverage == "light"
    # Concerns outside acne / age_spot / redness never raise coverage.
    assert finish_and_coverage("Dry", {"wrinkle": 5.0}).coverage == "light"
    assert finish_and_coverage("Dry", {}).coverage_reason == "default_light"

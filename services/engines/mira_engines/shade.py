"""Shade matching: zero-unit pre-rank, closed-loop check, finish and coverage (docs/ENGINES.md §4).

Labels and rules here are style heuristics with uncalibrated thresholds (config.py). They are shown
as "why MIRA suggested this", never as skin advice.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from mira_engines.colour import Lab, de2000, hue_difference, lab_to_lch
from mira_engines.config import CLOSE_DE, COVERAGE_RAISE, DIRECTION_EPS, MATCH_DE

Direction = Literal["lighter", "darker", "warmer", "cooler"]
MatchLabel = Literal["blends_closely", "close"] | Direction


@dataclass(frozen=True, slots=True)
class Shade:
    id: str
    name: str
    lab: Lab


@dataclass(frozen=True, slots=True)
class RankedShade:
    shade: Shade
    de: float
    d_lightness: float  # L*(shade) − L*(skin); positive = the shade is lighter
    d_hue: float  # signed shortest h_ab difference in degrees; positive = more yellow
    label: MatchLabel


def off_axis_label(skin: Lab, shade: Lab, d_lightness: float, d_hue: float) -> Direction:
    """Lighter/darker/warmer/cooler: whichever difference is larger in Lab units.

    The hue gap is converted to arc length in the a*b* plane (mean chroma × angle in radians), so
    it is comparable with ΔL*. A higher hue angle reads more yellow, i.e. warmer.
    """
    mean_chroma = (lab_to_lch(skin)[1] + lab_to_lch(shade)[1]) / 2.0
    hue_gap = abs(d_hue) * math.pi / 180.0 * mean_chroma
    if abs(d_lightness) >= hue_gap:
        return "lighter" if d_lightness > 0 else "darker"
    return "warmer" if d_hue > 0 else "cooler"


def prerank(skin: Lab, shades: list[Shade]) -> list[RankedShade]:
    """Rank every catalogue shade by ΔE00 to measured skin; ties by |Δh_ab| then |ΔL*|."""
    ranked: list[RankedShade] = []
    for shade in shades:
        de = de2000(shade.lab, skin)
        d_l = shade.lab[0] - skin[0]
        d_h = hue_difference(skin, shade.lab)
        label: MatchLabel
        if de <= MATCH_DE.value:
            label = "blends_closely"
        elif de <= CLOSE_DE.value:
            label = "close"
        else:
            label = off_axis_label(skin, shade.lab, d_l, d_h)
        ranked.append(RankedShade(shade, de, d_l, d_h, label))
    ranked.sort(key=lambda r: (round(r.de, 6), abs(r.d_hue), abs(r.d_lightness), r.shade.id))
    return ranked


@dataclass(frozen=True, slots=True)
class ClosedLoop:
    blend_de: float
    direction_ok: bool


def closed_loop(skin: Lab, shade: Lab, render: Lab) -> ClosedLoop:
    """Blend = ΔE00(render, skin). Direction: signs of ΔL* and Δb* agree with the shade's own.

    A component where the shade barely differs from skin (|Δ| < DIRECTION_EPS) has no direction to
    agree with, so it is skipped. If the render is labelled "not checked" the caller must not rank
    it (docs/ENGINES.md §4.2).
    """
    eps = DIRECTION_EPS.value
    ok = True
    for axis in (0, 2):
        intended = shade[axis] - skin[axis]
        observed = render[axis] - skin[axis]
        if abs(intended) >= eps and (observed > 0) != (intended > 0):
            ok = False
    return ClosedLoop(blend_de=de2000(render, skin), direction_ok=ok)


Finish = Literal["matte", "satin", "dewy"]
Coverage = Literal["light", "medium"]
FinishReason = Literal["oily", "dry", "combination", "no_skin_type"]
CoverageReason = Literal["raised_for_concern", "default_light"]


@dataclass(frozen=True, slots=True)
class FinishAndCoverage:
    finishes: tuple[Finish, ...]  # preferred first
    coverage: Coverage
    finish_reason: FinishReason
    coverage_reason: CoverageReason
    t_zone_note: bool  # combination skin: say T-zone and U-zone differ


def finish_and_coverage(
    skin_type_whole: str | None, concern_raw_scores: dict[str, float]
) -> FinishAndCoverage:
    """Style rules, docs/ENGINES.md §4.3: oily → matte/satin, dry → dewy, combination → satin.

    ``concern_raw_scores`` may hold ``acne``, ``age_spot`` and ``redness`` raw scores; coverage is
    raised to medium when the lowest of those is below COVERAGE_RAISE.
    """
    kind = (skin_type_whole or "").strip().lower()
    finishes: tuple[Finish, ...]
    reason: FinishReason
    if kind.startswith("oily"):
        finishes, reason = ("matte", "satin"), "oily"
    elif kind.startswith("dry"):
        finishes, reason = ("dewy",), "dry"
    elif kind.startswith("combination"):
        finishes, reason = ("satin",), "combination"
    else:
        finishes, reason = ("satin",), "no_skin_type"
    relevant = [v for k, v in concern_raw_scores.items() if k in {"acne", "age_spot", "redness"}]
    raise_it = bool(relevant) and min(relevant) < COVERAGE_RAISE.value
    return FinishAndCoverage(
        finishes=finishes,
        coverage="medium" if raise_it else "light",
        finish_reason=reason,
        coverage_reason="raised_for_concern" if raise_it else "default_light",
        t_zone_note=reason == "combination",
    )

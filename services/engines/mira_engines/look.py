"""Look colour suggestions: lip and blush, with the rule that fired (docs/ENGINES.md §5).

Documented heuristics, labelled "suggestion" in the UI. Reasons are structured codes; the UI renders
the copy from them.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from mira_engines.colour import Lab, lab_to_lch
from mira_engines.config import BLUSH_HUE_WINDOW_DEG, LIP_HUE_WINDOW_DEG
from mira_engines.shade import Shade

LipReason = Literal[
    "hue_near_garment",
    "hue_near_natural_lip",
    "no_hue_match_closest_to_natural_lip",
]
BlushReason = Literal["hue_near_lip_lower_chroma", "none_in_window"]


def hue_gap(a: Lab, b: Lab) -> float:
    """Unsigned shortest hue-angle gap in degrees, 0-180."""
    d = abs(lab_to_lch(a)[2] - lab_to_lch(b)[2]) % 360.0
    return min(d, 360.0 - d)


@dataclass(frozen=True, slots=True)
class LipSuggestion:
    shade: Shade
    reason: LipReason
    contrast_matched: bool  # lightness contrast against skin follows personal contrast


@dataclass(frozen=True, slots=True)
class BlushSuggestion:
    shade: Shade | None
    reason: BlushReason


@dataclass(frozen=True, slots=True)
class LookSuggestion:
    personal_contrast: float  # |L*(hair) − L*(skin)|
    lip: LipSuggestion | None
    blush: BlushSuggestion | None


def suggest(
    *,
    garment: Lab,
    skin: Lab,
    natural_lip: Lab,
    hair: Lab,
    lips: list[Shade],
    blushes: list[Shade],
) -> LookSuggestion:
    """Pick a lip then a blush.

    Lip: candidates within ±LIP_HUE_WINDOW of the garment hue or the natural lip hue; among them
    the one whose lightness contrast against skin is closest to the person's own contrast
    (|L*hair − L*skin|), so higher-contrast colouring allows a deeper lip.
    Blush: hue within ±BLUSH_HUE_WINDOW of the chosen lip and chroma below the lip's.
    """
    contrast = abs(hair[0] - skin[0])
    if not lips:
        return LookSuggestion(contrast, None, None)

    window = LIP_HUE_WINDOW_DEG.value
    in_window = [
        c
        for c in lips
        if hue_gap(c.lab, garment) <= window or hue_gap(c.lab, natural_lip) <= window
    ]

    def contrast_error(c: Shade) -> float:
        return abs(abs(c.lab[0] - skin[0]) - contrast)

    chosen: Shade
    reason: LipReason
    if in_window:
        chosen = min(in_window, key=lambda c: (contrast_error(c), c.id))
        reason = (
            "hue_near_garment" if hue_gap(chosen.lab, garment) <= window else "hue_near_natural_lip"
        )
    else:
        chosen = min(lips, key=lambda c: (hue_gap(c.lab, natural_lip), c.id))
        reason = "no_hue_match_closest_to_natural_lip"
    matched = contrast_error(chosen) <= 10.0

    lip_chroma = lab_to_lch(chosen.lab)[1]
    near = [
        b
        for b in blushes
        if hue_gap(b.lab, chosen.lab) <= BLUSH_HUE_WINDOW_DEG.value
        and lab_to_lch(b.lab)[1] < lip_chroma
    ]
    blush = (
        BlushSuggestion(
            min(near, key=lambda b: (hue_gap(b.lab, chosen.lab), b.id)), "hue_near_lip_lower_chroma"
        )
        if near
        else BlushSuggestion(None, "none_in_window")
    )
    return LookSuggestion(contrast, LipSuggestion(chosen, reason, matched), blush)

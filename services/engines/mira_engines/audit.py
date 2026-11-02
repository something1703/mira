"""Render Auditor: garment colour, lip colour and identity drift (docs/ENGINES.md §7)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt

from mira_engines.colour import Lab, de2000, de2000_vec, hue_difference, rgb8_to_lab
from mira_engines.config import (
    CHANGED_PX_DE,
    GARMENT_VERIFY_DE,
    IDENTITY_DRIFT_MAX,
    LIP_VERIFY_DE,
    MIN_CHANGED_SHARE,
    TORSO_BOTTOM_FACES,
    TORSO_HALF_WIDTH_FACES,
    TORSO_TOP_FACES,
)
from mira_engines.shade import Direction, off_axis_label

Label = Literal["verified", "drift", "not_checked"]


@dataclass(frozen=True, slots=True)
class FaceBox:
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class GarmentAudit:
    label: Label
    de: float | None
    direction: Direction | None
    changed_share: float
    reason: Literal["ok", "torso_unchanged", "torso_outside_image"]


def torso_region(face: FaceBox, image_height: int, image_width: int) -> tuple[int, int, int, int]:
    """(x0, y0, x1, y1) clipped to the image; x1 and y1 are exclusive."""
    cx = face.x + face.width / 2.0
    half = TORSO_HALF_WIDTH_FACES.value * face.width
    chin = face.y + face.height
    x0 = max(0, round(cx - half))
    x1 = min(image_width, round(cx + half))
    y0 = max(0, round(chin + TORSO_TOP_FACES.value * face.height))
    y1 = min(image_height, round(chin + TORSO_BOTTOM_FACES.value * face.height))
    return x0, y0, x1, y1


def garment_audit(
    source: npt.NDArray[np.uint8],
    render: npt.NDArray[np.uint8],
    face: FaceBox,
    garment_labs: list[Lab],
) -> GarmentAudit:
    """Compare the changed torso pixels of a render with the product's garment colour.

    If too little of the torso changed, the preview may still show the original clothing, so the
    render is "not checked" rather than verified (the failure ShadeSpan documented).
    """
    if source.shape != render.shape or source.ndim != 3 or source.shape[2] != 3:
        raise ValueError("source and render must be (H, W, 3) arrays of the same size")
    if not garment_labs:
        raise ValueError("At least one garment colour is required")
    x0, y0, x1, y1 = torso_region(face, source.shape[0], source.shape[1])
    if x1 <= x0 or y1 <= y0:
        return GarmentAudit("not_checked", None, None, 0.0, "torso_outside_image")

    src_lab = rgb8_to_lab(source[y0:y1, x0:x1].astype(np.float64))
    ren_lab = rgb8_to_lab(render[y0:y1, x0:x1].astype(np.float64))
    changed = de2000_vec(src_lab, ren_lab) > CHANGED_PX_DE.value
    share = float(changed.mean())
    if share < MIN_CHANGED_SHARE.value:
        return GarmentAudit("not_checked", None, None, share, "torso_unchanged")

    median = np.median(ren_lab[changed], axis=0)
    observed: Lab = (float(median[0]), float(median[1]), float(median[2]))
    best = min(garment_labs, key=lambda g: de2000(observed, g))
    de = de2000(observed, best)
    if de <= GARMENT_VERIFY_DE.value:
        return GarmentAudit("verified", de, None, share, "ok")
    direction = off_axis_label(
        best, observed, observed[0] - best[0], hue_difference(best, observed)
    )
    return GarmentAudit("drift", de, direction, share, "ok")


@dataclass(frozen=True, slots=True)
class LipAudit:
    label: Literal["verified", "drift"]
    de: float


def lip_audit(rendered: Lab, intended: Lab) -> LipAudit:
    """ΔE00(lip_render, lip_intended) ≤ LIP_VERIFY_DE → verified (docs/ENGINES.md §7.2)."""
    de = de2000(rendered, intended)
    return LipAudit("verified" if de <= LIP_VERIFY_DE.value else "drift", de)


@dataclass(frozen=True, slots=True)
class IdentityDrift:
    drift: float  # max_i |r_i − r'_i| / r_i
    passed: bool  # False → withhold the render


def identity_drift(source: list[float], final: list[float]) -> IdentityDrift:
    if len(source) != len(final) or not source:
        raise ValueError("Ratio vectors must be non-empty and the same length")
    src = np.asarray(source, dtype=np.float64)
    fin = np.asarray(final, dtype=np.float64)
    if np.any(src <= 0) or not (np.all(np.isfinite(src)) and np.all(np.isfinite(fin))):
        raise ValueError("Source ratios must be positive and all ratios finite")
    drift = float(np.max(np.abs(src - fin) / src))
    return IdentityDrift(drift, drift <= IDENTITY_DRIFT_MAX.value)

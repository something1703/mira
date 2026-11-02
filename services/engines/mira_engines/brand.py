"""The Shade Gap Map (docs/DESIGN_SYSTEM.md §10): which skin colours does a range not serve?

Input is a set of anonymised skin colours (CIELAB) and a brand's shades. A skin colour is served
when some shade lies within ``GAP_NEAR_DE`` of it (ΔE2000). Colours are grouped in bins of hue
angle (h_ab) and lightness (L*), and each bin says how many colours it holds and how many are not
served. Whether a bin is shown at all is decided later, by the minimum cohort, never here: this
function only measures.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from mira_engines.colour import Lab, de2000_vec
from mira_engines.config import GAP_HUE_BINS, GAP_L_BINS, GAP_NEAR_DE


@dataclass(frozen=True, slots=True)
class GapBin:
    hue_lo: float
    hue_hi: float
    l_lo: float
    l_hi: float
    count: int
    unserved: int
    nearest_de_median: float


@dataclass(frozen=True, slots=True)
class GapMap:
    total: int
    unserved: int
    unserved_share: float
    near_de: float
    bins: tuple[GapBin, ...]


def hue_angle(lab: Lab) -> float:
    """h_ab in degrees, 0 to 360."""
    return math.degrees(math.atan2(lab[2], lab[1])) % 360.0


def gap_map(points: list[Lab], shades: list[Lab]) -> GapMap:
    if not points:
        raise ValueError("At least one skin colour is required")
    if not shades:
        raise ValueError("At least one shade is required")
    p = np.asarray(points, dtype=np.float64)
    s = np.asarray(shades, dtype=np.float64)
    if not (np.all(np.isfinite(p)) and np.all(np.isfinite(s))):
        raise ValueError("Colours must be finite")
    # Every colour against every shade; the nearest decides.
    nearest = de2000_vec(p[:, None, :], s[None, :, :]).min(axis=1)
    unserved = nearest > GAP_NEAR_DE.value

    hues = np.degrees(np.arctan2(p[:, 2], p[:, 1])) % 360.0
    hb, lb = int(GAP_HUE_BINS.value), int(GAP_L_BINS.value)
    h_idx = np.minimum((hues / (360.0 / hb)).astype(int), hb - 1)
    l_idx = np.clip((p[:, 0] / (100.0 / lb)).astype(int), 0, lb - 1)

    bins: list[GapBin] = []
    for hi in range(hb):
        for li in range(lb):
            mask = (h_idx == hi) & (l_idx == li)
            n = int(mask.sum())
            if n == 0:
                continue
            bins.append(
                GapBin(
                    hue_lo=hi * 360.0 / hb,
                    hue_hi=(hi + 1) * 360.0 / hb,
                    l_lo=li * 100.0 / lb,
                    l_hi=(li + 1) * 100.0 / lb,
                    count=n,
                    unserved=int((mask & unserved).sum()),
                    nearest_de_median=float(np.median(nearest[mask])),
                )
            )
    total, miss = len(points), int(unserved.sum())
    return GapMap(total, miss, miss / total, GAP_NEAR_DE.value, tuple(bins))

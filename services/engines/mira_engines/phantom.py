"""Calibration phantom for Proof (docs/ENGINES.md §9): does Skin Simulation move Skin Analysis?"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import isotonic_regression
from scipy.stats import spearmanr

from mira_engines.config import PHANTOM_MIN_RHO


@dataclass(frozen=True, slots=True)
class Phantom:
    usable: bool
    rho: float
    score_range: float
    reason: str  # "ok", "too_few_points", "not_monotone", "range_below_mdc"
    intensities: tuple[float, ...]
    fitted_delta: tuple[float, ...]  # isotonic fit of (score − score at lowest intensity)


def fit(intensities: list[float], scores: list[float], mdc: float) -> Phantom:
    """Spearman ρ, usability rule, isotonic fit.

    Usable when |ρ| ≥ PHANTOM_MIN_RHO and (max − min score) > MDC. The sign of ρ is not part of the
    rule because which way a concern's raw score moves with simulated intensity depends on the
    concern; the isotonic fit follows the observed direction.
    """
    if len(intensities) != len(scores):
        raise ValueError("intensities and scores must have the same length")
    if len(intensities) < 3:
        return Phantom(False, 0.0, 0.0, "too_few_points", tuple(intensities), ())
    order = np.argsort(intensities)
    x = np.asarray(intensities, dtype=np.float64)[order]
    y = np.asarray(scores, dtype=np.float64)[order]
    score_range = float(y.max() - y.min())
    rho = 0.0 if score_range == 0.0 or x[0] == x[-1] else float(spearmanr(x, y).statistic)
    # All intensities equal (or any other degenerate input) gives no correlation at all. That is not
    # a usable phantom, and it must not leave NaN in a response.
    if not np.isfinite(rho):
        return Phantom(False, 0.0, score_range, "not_monotone", tuple(float(v) for v in x), ())
    increasing = rho >= 0
    fitted = isotonic_regression(y, increasing=increasing).x
    delta = tuple(float(v - fitted[0]) for v in fitted)
    # ρ is a ratio of integers in theory; allow for float error so exactly 0.9 passes.
    if abs(rho) < PHANTOM_MIN_RHO.value - 1e-9:
        reason = "not_monotone"
    elif score_range <= mdc:
        reason = "range_below_mdc"
    else:
        reason = "ok"
    return Phantom(reason == "ok", rho, score_range, reason, tuple(float(v) for v in x), delta)


def invert(phantom: Phantom, target_delta: float) -> float | None:
    """Intensity whose fitted score change equals ``target_delta`` (linear between points).

    Returns None when the phantom is unusable or the target lies outside the fitted range, so the
    caller shows numbers only rather than extrapolating.
    """
    if not phantom.usable:
        return None
    x = np.asarray(phantom.intensities)
    d = np.asarray(phantom.fitted_delta)
    lo, hi = float(d.min()), float(d.max())
    if not lo <= target_delta <= hi:
        return None
    if d[0] > d[-1]:
        x, d = x[::-1], d[::-1]
    return float(np.interp(target_delta, d, x))

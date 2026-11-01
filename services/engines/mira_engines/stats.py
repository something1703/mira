"""Noise floor and change detection for Proof (docs/ENGINES.md §8). Uses ``raw_score`` only (D6)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np

from mira_engines.config import CLEAR_CHANGE_MULTIPLE, MDC_Z, MIN_SESSIONS_FOR_SD_DAY


@dataclass(frozen=True, slots=True)
class NoiseFloor:
    sessions: int
    captures_per_session: int
    s_w: float  # pooled within-session standard deviation
    s_d: float | None  # between-day SD; None when unknown (fewer than 3 sessions, no prior)
    s_d_source: Literal["estimated", "prior", "unknown"]
    se: float | None  # error of one session mean
    mdc: float | None  # minimal detectable change, 95%


def noise_floor(sessions: list[list[float]], prior_sd_day: float | None = None) -> NoiseFloor:
    """s_w² pooled around session means; s_d² = max(0, var(m) − s_w²/k) once n ≥ 3.

    Before three sessions s_d comes from ``prior_sd_day`` if given, otherwise it is unknown and
    SE/MDC are None, so callers report "n/a" instead of inventing a prior (D16).
    Every session needs the same number of captures, at least two.
    """
    if not sessions:
        raise ValueError("At least one session is required")
    k = len(sessions[0])
    if k < 2:
        raise ValueError("Each session needs at least two captures")
    if any(len(s) != k for s in sessions):
        raise ValueError("Every session must have the same number of captures")
    data = np.array(sessions, dtype=np.float64)
    if not np.all(np.isfinite(data)):
        raise ValueError("Scores must be finite")
    n = data.shape[0]
    means = data.mean(axis=1)
    s_w2 = float(((data - means[:, None]) ** 2).sum() / (n * (k - 1)))

    s_d: float | None
    source: Literal["estimated", "prior", "unknown"]
    if n >= MIN_SESSIONS_FOR_SD_DAY.value:
        s_d, source = math.sqrt(max(0.0, float(means.var(ddof=1)) - s_w2 / k)), "estimated"
    elif prior_sd_day is not None:
        if prior_sd_day < 0:
            raise ValueError("prior_sd_day must not be negative")
        s_d, source = prior_sd_day, "prior"
    else:
        s_d, source = None, "unknown"

    se = None if s_d is None else math.sqrt(s_d**2 + s_w2 / k)
    mdc = None if se is None else MDC_Z.value * math.sqrt(2.0) * se
    return NoiseFloor(n, k, math.sqrt(s_w2), s_d, source, se, mdc)


ChangeWords = Literal["n/a", "within", "small", "clear", "opposite"]

CHANGE_PHRASES: dict[ChangeWords, str] = {
    "n/a": "not enough sessions yet to know your day-to-day variation",
    "within": "within your day-to-day variation",
    "small": "a small change above your day-to-day variation",
    "clear": "a clear change",
    "opposite": "changed, but not in the direction the product claims",
}


@dataclass(frozen=True, slots=True)
class Change:
    delta: float
    words: ChangeWords
    phrase: str


def change(
    baseline: float, now: float, mdc: float | None, claim_direction: Literal["up", "down"]
) -> Change:
    """Δ = now − baseline against the MDC, using the words table in docs/ENGINES.md §8.

    ``claim_direction`` is the direction of ``raw_score`` the product claims (up = better-looking).
    """
    delta = now - baseline
    words: ChangeWords
    if mdc is None:
        words = "n/a"
    elif abs(delta) < mdc:
        words = "within"
    elif (delta > 0) != (claim_direction == "up"):
        words = "opposite"
    elif abs(delta) < CLEAR_CHANGE_MULTIPLE.value * mdc:
        words = "small"
    else:
        words = "clear"
    return Change(delta, words, CHANGE_PHRASES[words])

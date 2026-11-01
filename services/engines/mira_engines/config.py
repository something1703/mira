"""Every measurement threshold, with its source and whether it is calibrated (AGENTS.md §7).

Uncalibrated values are starting points from docs/ENGINES.md. The UI never presents them as
scientific cut-offs, and each engine response echoes the values it used so results are reproducible.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Final


@dataclass(frozen=True, slots=True)
class Threshold:
    value: float
    source: str
    calibrated: bool
    unit: str = ""


# Shade matching (docs/ENGINES.md §4)
MATCH_DE: Final = Threshold(2.0, "docs/ENGINES.md §4.1 starting value; Phase 6 F8", False, "ΔE00")
CLOSE_DE: Final = Threshold(3.5, "docs/ENGINES.md §4.1 starting value; Phase 6 F8", False, "ΔE00")
SHADE_RENDER_TOP_N: Final = Threshold(3, "docs/ENGINES.md §4.1 default", False, "shades")
SHADE_RENDER_TOP_N_MAX: Final = Threshold(5, "docs/ENGINES.md §4.1 max", False, "shades")
COVERAGE_RAISE: Final = Threshold(
    50, "docs/ENGINES.md §4.3; raw_score below which coverage is raised", False, "raw score"
)

# Render Auditor (docs/ENGINES.md §7)
CHANGED_PX_DE: Final = Threshold(8.0, "docs/ENGINES.md §7.1 step 3", False, "ΔE00")
MIN_CHANGED_SHARE: Final = Threshold(0.15, "docs/ENGINES.md §7.1 step 4", False, "share")
GARMENT_VERIFY_DE: Final = Threshold(
    6.0, "docs/ENGINES.md §7.1; loose because try-on applies scene lighting", False, "ΔE00"
)
LIP_VERIFY_DE: Final = Threshold(3.0, "docs/ENGINES.md §7.2", False, "ΔE00")
IDENTITY_DRIFT_MAX: Final = Threshold(
    0.08, "docs/ENGINES.md §7.3; calibrate from repeated analyses of one photo", False, "ratio"
)
TORSO_HALF_WIDTH_FACES: Final = Threshold(1.2, "docs/ENGINES.md §7.1 step 2", False, "faces")
TORSO_TOP_FACES: Final = Threshold(0.4, "docs/ENGINES.md §7.1 step 2", False, "faces")
TORSO_BOTTOM_FACES: Final = Threshold(2.0, "docs/ENGINES.md §7.1 step 2", False, "faces")

# Garment colour (docs/ENGINES.md §6)
GARMENT_ALPHA_MIN: Final = Threshold(0.9, "docs/ENGINES.md §6 step 2", False, "alpha")
GARMENT_KMEANS_K: Final = Threshold(3, "docs/ENGINES.md §6 step 3", False, "clusters")
GARMENT_MULTICOLOUR_SHARE: Final = Threshold(0.5, "docs/ENGINES.md §6 step 4", False, "share")
KMEANS_SEED: Final = Threshold(20261101, "Fixed seed for reproducible clustering", True)

# Look suggestions (docs/ENGINES.md §5)
LIP_HUE_WINDOW_DEG: Final = Threshold(30.0, "docs/ENGINES.md §5", False, "°")
BLUSH_HUE_WINDOW_DEG: Final = Threshold(20.0, "docs/ENGINES.md §5", False, "°")

# Noise floor and change (docs/ENGINES.md §8)
CAPTURES_PER_SESSION: Final = Threshold(3, "docs/ENGINES.md §8 default k", True, "captures")
MIN_SESSIONS_FOR_SD_DAY: Final = Threshold(3, "docs/ENGINES.md §8", True, "sessions")
MDC_Z: Final = Threshold(1.96, "Two-sided 95% normal quantile", True)
CLEAR_CHANGE_MULTIPLE: Final = Threshold(2.0, "docs/ENGINES.md §8 verdict table", False, "× MDC")

# Calibration phantom (docs/ENGINES.md §9)
PHANTOM_INTENSITIES: Final = (0.0, 0.25, 0.5, 0.75, 1.0)
PHANTOM_MIN_RHO: Final = Threshold(0.9, "docs/ENGINES.md §9 step 4", False, "ρ")

# ITA° bands, Chardon et al. (1991), as listed in docs/ENGINES.md §3: (lower bound, name).
ITA_BANDS: Final = (
    (55.0, "very light"),
    (41.0, "light"),
    (28.0, "intermediate"),
    (10.0, "tan"),
    (-30.0, "brown"),
)
ITA_LOWEST_BAND: Final = "dark"

# PRIOR_SD_DAY per concern is set from the Phase 9 noise-floor pilot (docs/FACTS.md F9).
# Until then it is empty, and engines report "n/a" instead of inventing a prior.
PRIOR_SD_DAY: Final[dict[str, Threshold]] = {}


def snapshot() -> dict[str, object]:
    """Every threshold by name, echoed in engine responses for reproducibility."""
    out: dict[str, object] = {}
    for name, value in globals().items():
        if name.isupper() and isinstance(value, Threshold):
            out[name] = asdict(value)
    out["PHANTOM_INTENSITIES"] = list(PHANTOM_INTENSITIES)
    out["PRIOR_SD_DAY"] = {k: asdict(v) for k, v in PRIOR_SD_DAY.items()}
    return out

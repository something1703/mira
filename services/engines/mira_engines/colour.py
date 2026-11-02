"""Colour pipeline, CIEDE2000 and skin-colour descriptors (docs/ENGINES.md §1-3).

Pure functions over numbers and arrays. No I/O.
"""

from __future__ import annotations

import math
import re
from typing import Final

import colour
import numpy as np
import numpy.typing as npt

from mira_engines.config import ITA_BANDS, ITA_LOWEST_BAND

FloatArray = npt.NDArray[np.float64]
Lab = tuple[float, float, float]

# CIE 1931 2° chromaticity of D65 (IEC 61966-2-1 white), the illuminant for sRGB → Lab.
_D65_XY: Final = np.array([0.3127, 0.3290])
_HEX_RE: Final = re.compile(r"^#?([0-9A-Fa-f]{6})$")


def hex_to_rgb8(value: str) -> tuple[int, int, int]:
    """Parse ``#RRGGBB`` (the ``#`` is optional) into 8-bit channels."""
    match = _HEX_RE.match(value.strip())
    if match is None:
        raise ValueError(f"Expected a #RRGGBB colour, got {value!r}")
    digits = match.group(1)
    return int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16)


def rgb8_to_hex(r: int, g: int, b: int) -> str:
    """Upper-case ``#RRGGBB``, the form the schemas require."""
    for channel in (r, g, b):
        if not 0 <= channel <= 255:
            raise ValueError(f"Channel out of range: {channel}")
    return f"#{r:02X}{g:02X}{b:02X}"


def rgb8_to_lab(rgb: npt.ArrayLike) -> FloatArray:
    """8-bit sRGB (``(..., 3)``) → CIELAB, D65, 2° observer.

    Steps follow docs/ENGINES.md §1: IEC 61966-2-1 decoding to linear RGB, linear RGB → XYZ (D65),
    XYZ → CIELAB. ``colour-science`` performs each step.
    """
    arr = np.asarray(rgb, dtype=np.float64)
    if arr.shape[-1] != 3:
        raise ValueError("Expected a trailing axis of length 3")
    if np.any(arr < 0) or np.any(arr > 255):
        raise ValueError("8-bit channels must lie in 0-255")
    xyz = colour.sRGB_to_XYZ(arr / 255.0, illuminant=_D65_XY)
    return np.asarray(colour.XYZ_to_Lab(xyz, illuminant=_D65_XY), dtype=np.float64)


def hex_to_lab(value: str) -> Lab:
    lab = rgb8_to_lab(np.array(hex_to_rgb8(value), dtype=np.float64))
    return float(lab[0]), float(lab[1]), float(lab[2])


def lab_to_lch(lab: Lab) -> Lab:
    """CIELAB → (L*, chroma C*ab, hue angle h_ab in degrees, 0 ≤ h < 360)."""
    lightness, a, b = lab
    return lightness, math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360.0


def ita_degrees(lab: Lab) -> float:
    """Individual typology angle: arctan((L* − 50) / b*) × 180 / π.

    ``atan2`` equals the arctangent for b* > 0 (all skin) and stays defined at b* = 0.
    """
    return math.degrees(math.atan2(lab[0] - 50.0, lab[2]))


def ita_band(ita: float) -> str:
    """Chardon et al. (1991) band name; each band includes its upper bound (docs/ENGINES.md §3).

    ITA is a colour metric, never an identity.
    """
    for lower, name in ITA_BANDS:
        if ita > lower:
            return name
    return ITA_LOWEST_BAND


def de2000_vec(lab1: npt.ArrayLike, lab2: npt.ArrayLike) -> FloatArray:
    """CIEDE2000 with kL = kC = kH = 1, per Sharma, Wu and Dalal (2005), vectorised.

    Inputs are ``(..., 3)`` and broadcast. The branches the paper warns about (hue difference
    across 180°, mean hue when a chroma is zero) are handled explicitly.
    """
    p = np.asarray(lab1, dtype=np.float64)
    q = np.asarray(lab2, dtype=np.float64)
    l1, a1, b1 = p[..., 0], p[..., 1], p[..., 2]
    l2, a2, b2 = q[..., 0], q[..., 1], q[..., 2]

    c1 = np.hypot(a1, b1)
    c2 = np.hypot(a2, b2)
    c_bar7 = ((c1 + c2) / 2.0) ** 7
    g = 0.5 * (1.0 - np.sqrt(c_bar7 / (c_bar7 + 25.0**7)))
    a1p, a2p = (1.0 + g) * a1, (1.0 + g) * a2
    c1p, c2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360.0
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360.0

    dlp = l2 - l1
    dcp = c2p - c1p
    chroma_zero = c1p * c2p == 0.0
    dh = h2p - h1p
    dh = np.where(dh > 180.0, dh - 360.0, np.where(dh < -180.0, dh + 360.0, dh))
    dh = np.where(chroma_zero, 0.0, dh)
    dhp = 2.0 * np.sqrt(c1p * c2p) * np.sin(np.radians(dh) / 2.0)

    l_bar = (l1 + l2) / 2.0
    c_barp = (c1p + c2p) / 2.0
    h_sum = h1p + h2p
    h_bar = np.where(
        np.abs(h1p - h2p) <= 180.0,
        h_sum / 2.0,
        np.where(h_sum < 360.0, (h_sum + 360.0) / 2.0, (h_sum - 360.0) / 2.0),
    )
    h_bar = np.where(chroma_zero, h_sum, h_bar)

    t = (
        1.0
        - 0.17 * np.cos(np.radians(h_bar - 30.0))
        + 0.24 * np.cos(np.radians(2.0 * h_bar))
        + 0.32 * np.cos(np.radians(3.0 * h_bar + 6.0))
        - 0.20 * np.cos(np.radians(4.0 * h_bar - 63.0))
    )
    d_theta = 30.0 * np.exp(-(((h_bar - 275.0) / 25.0) ** 2))
    c_barp7 = c_barp**7
    r_c = 2.0 * np.sqrt(c_barp7 / (c_barp7 + 25.0**7))
    s_l = 1.0 + 0.015 * (l_bar - 50.0) ** 2 / np.sqrt(20.0 + (l_bar - 50.0) ** 2)
    s_c = 1.0 + 0.045 * c_barp
    s_h = 1.0 + 0.015 * c_barp * t
    r_t = -np.sin(np.radians(2.0 * d_theta)) * r_c

    out = np.sqrt(
        (dlp / s_l) ** 2 + (dcp / s_c) ** 2 + (dhp / s_h) ** 2 + r_t * (dcp / s_c) * (dhp / s_h)
    )
    return np.asarray(out, dtype=np.float64)


def de2000(lab1: Lab, lab2: Lab) -> float:
    """Scalar CIEDE2000, written independently of :func:`de2000_vec` (plain ``math``).

    Two implementations that must agree on random samples is the cross-check required by
    docs/ENGINES.md §2.
    """
    l1, a1, b1 = lab1
    l2, a2, b2 = lab2
    c1, c2 = math.hypot(a1, b1), math.hypot(a2, b2)
    c_bar7 = ((c1 + c2) / 2.0) ** 7
    g = 0.5 * (1.0 - math.sqrt(c_bar7 / (c_bar7 + 25.0**7)))
    a1p, a2p = (1.0 + g) * a1, (1.0 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360.0 if c1p else 0.0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360.0 if c2p else 0.0

    dlp, dcp = l2 - l1, c2p - c1p
    if c1p * c2p == 0.0:
        dh = 0.0
    else:
        dh = h2p - h1p
        if dh > 180.0:
            dh -= 360.0
        elif dh < -180.0:
            dh += 360.0
    dhp = 2.0 * math.sqrt(c1p * c2p) * math.sin(math.radians(dh) / 2.0)

    l_bar, c_barp = (l1 + l2) / 2.0, (c1p + c2p) / 2.0
    if c1p * c2p == 0.0:
        h_bar = h1p + h2p
    elif abs(h1p - h2p) <= 180.0:
        h_bar = (h1p + h2p) / 2.0
    elif h1p + h2p < 360.0:
        h_bar = (h1p + h2p + 360.0) / 2.0
    else:
        h_bar = (h1p + h2p - 360.0) / 2.0

    t = (
        1.0
        - 0.17 * math.cos(math.radians(h_bar - 30.0))
        + 0.24 * math.cos(math.radians(2.0 * h_bar))
        + 0.32 * math.cos(math.radians(3.0 * h_bar + 6.0))
        - 0.20 * math.cos(math.radians(4.0 * h_bar - 63.0))
    )
    d_theta = 30.0 * math.exp(-(((h_bar - 275.0) / 25.0) ** 2))
    r_c = 2.0 * math.sqrt(c_barp**7 / (c_barp**7 + 25.0**7))
    s_l = 1.0 + 0.015 * (l_bar - 50.0) ** 2 / math.sqrt(20.0 + (l_bar - 50.0) ** 2)
    s_c = 1.0 + 0.045 * c_barp
    s_h = 1.0 + 0.015 * c_barp * t
    r_t = -math.sin(math.radians(2.0 * d_theta)) * r_c
    return math.sqrt(
        (dlp / s_l) ** 2 + (dcp / s_c) ** 2 + (dhp / s_h) ** 2 + r_t * (dcp / s_c) * (dhp / s_h)
    )


def hue_difference(lab_from: Lab, lab_to: Lab) -> float:
    """Signed shortest hue-angle difference h_ab(to) − h_ab(from), in (−180, 180]."""
    d = (lab_to_lch(lab_to)[2] - lab_to_lch(lab_from)[2] + 180.0) % 360.0 - 180.0
    return 180.0 if d == -180.0 else d

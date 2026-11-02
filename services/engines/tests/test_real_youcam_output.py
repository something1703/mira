"""The engines on a real YouCam result, the first one recorded (2026-11-01).

``packages/fixtures/recorded/sod/files/…png`` is YouCam's background-removal answer for a synthetic
garment image drawn by hand: body colour #A83452, a lighter placket, gold buttons, on a plain
background. No person is in it. Because the true colour is known, this checks Phase 4's garment
colour against ground truth on data MIRA did not make itself.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from mira_engines.colour import de2000, hex_to_lab
from mira_engines.garment import garment_colour

RECORDING = (
    Path(__file__).resolve().parents[3]
    / "packages/fixtures/recorded/sod/files/3b8e90a7d3a541b8.png"
)
BODY = "#A83452"  # the colour the garment was drawn in


def load() -> np.ndarray:
    return np.asarray(Image.open(RECORDING).convert("RGBA"), dtype=np.uint8)


def test_youcam_returned_a_cutout_with_a_transparent_background() -> None:
    rgba = load()
    assert rgba.shape == (640, 640, 4)
    alpha = rgba[..., 3]
    assert alpha[5, 5] == 0  # background removed
    assert alpha[350, 320] >= 250  # garment kept, opaque


def test_garment_colour_recovers_the_drawn_colour_from_real_output() -> None:
    g = garment_colour(load())
    assert not g.multicolour
    assert g.share > 0.8  # the body is most of the garment; placket and buttons are the rest
    assert de2000(g.lab, hex_to_lab(BODY)) < 0.5  # measured 0.006 on 2026-11-01


def test_it_is_deterministic_on_real_output() -> None:
    assert garment_colour(load()) == garment_colour(load())

"""Garment colour from a background-removed product image (docs/ENGINES.md §6)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from scipy.cluster.vq import kmeans2

from mira_engines.colour import Lab, rgb8_to_lab
from mira_engines.config import (
    GARMENT_ALPHA_MIN,
    GARMENT_KMEANS_K,
    GARMENT_MULTICOLOUR_SHARE,
    KMEANS_SEED,
)

# Cluster at most this many pixels (seeded subsample); a product photo has far more than needed.
_MAX_PIXELS = 20_000


@dataclass(frozen=True, slots=True)
class GarmentColour:
    lab: Lab  # centroid of the largest cluster
    share: float  # share of garment pixels in that cluster
    multicolour: bool
    audit_labs: tuple[Lab, ...]  # one Lab, or the top two clusters when multicolour
    pixels: int


def garment_colour(rgba: npt.NDArray[np.uint8]) -> GarmentColour:
    """Keep pixels with alpha > 0.9, convert to Lab, k-means (k = 3, fixed seed)."""
    if rgba.ndim != 3 or rgba.shape[2] != 4:
        raise ValueError("Expected an (H, W, 4) RGBA image")
    alpha = rgba[..., 3].astype(np.float64) / 255.0
    rgb = rgba[..., :3][alpha > GARMENT_ALPHA_MIN.value]
    if rgb.shape[0] == 0:
        raise ValueError("No opaque garment pixels found")
    lab = rgb8_to_lab(rgb.astype(np.float64))
    rng = np.random.default_rng(int(KMEANS_SEED.value))
    if lab.shape[0] > _MAX_PIXELS:
        lab = lab[rng.choice(lab.shape[0], _MAX_PIXELS, replace=False)]

    k = min(int(GARMENT_KMEANS_K.value), len(np.unique(lab, axis=0)))
    if k == 1:
        centre = lab.mean(axis=0)
        one: Lab = (float(centre[0]), float(centre[1]), float(centre[2]))
        return GarmentColour(one, 1.0, False, (one,), int(lab.shape[0]))
    centroids, labels = kmeans2(lab, k, minit="++", seed=int(KMEANS_SEED.value), missing="warn")
    counts = np.bincount(labels, minlength=k)
    order = np.argsort(-counts, kind="stable")
    top = centroids[order[0]]
    share = float(counts[order[0]] / counts.sum())
    multi = share < GARMENT_MULTICOLOUR_SHARE.value
    primary: Lab = (float(top[0]), float(top[1]), float(top[2]))
    audit: list[Lab] = [primary]
    if multi and counts[order[1]] > 0:
        second = centroids[order[1]]
        audit.append((float(second[0]), float(second[1]), float(second[2])))
    return GarmentColour(primary, share, multi, tuple(audit), int(lab.shape[0]))

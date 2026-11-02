"""Local face-box detection with MediaPipe (docs/ENGINES.md §7.1 step 1).

No model other than this local detector ever sees the face. It uses MediaPipe's BlazeFace
short-range model (Apache 2.0), bundled at ``assets/blaze_face_short_range.tflite`` (sha256
b4578f35...0152f, from storage.googleapis.com/mediapipe-models, 2026-11-02);
``MIRA_FACE_MODEL_PATH`` points elsewhere if set.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import numpy.typing as npt

from mira_engines.audit import FaceBox

BUNDLED_MODEL = Path(__file__).resolve().parent.parent / "assets" / "blaze_face_short_range.tflite"


class FaceDetectorUnavailable(RuntimeError):  # noqa: N818 - reads better as a condition name
    """No model file configured, or MediaPipe could not load it."""


def detect_face_box(rgb: npt.NDArray[np.uint8]) -> FaceBox | None:
    """Largest detected face as a pixel box, or None when no face is found."""
    path = os.environ.get("MIRA_FACE_MODEL_PATH") or str(BUNDLED_MODEL)
    if not os.path.isfile(path):
        raise FaceDetectorUnavailable(f"No face model file at {path}")
    try:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        options = vision.FaceDetectorOptions(base_options=BaseOptions(model_asset_path=path))
        detector = vision.FaceDetector.create_from_options(options)
    except (ImportError, OSError, RuntimeError) as err:
        # MediaPipe needs system graphics libraries (libEGL, libGLES) on Linux; without them the
        # import or the detector fails. That is "no detector here", not a server error.
        raise FaceDetectorUnavailable(f"MediaPipe could not start: {err}") from err
    with detector:
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        detections = detector.detect(image).detections
    if not detections:
        return None
    box = max(detections, key=lambda d: d.bounding_box.width * d.bounding_box.height).bounding_box
    return FaceBox(box.origin_x, box.origin_y, box.width, box.height)

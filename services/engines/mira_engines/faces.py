"""Local face-box detection with MediaPipe (docs/ENGINES.md §7.1 step 1).

No model other than this local detector ever sees the face. The detector needs a ``.tflite`` model
file that is not bundled; point ``MIRA_FACE_MODEL_PATH`` at one (MediaPipe's BlazeFace short-range
model). Without it, callers must pass the face box themselves.
"""

from __future__ import annotations

import os

import numpy as np
import numpy.typing as npt

from mira_engines.audit import FaceBox


class FaceDetectorUnavailable(RuntimeError):  # noqa: N818 - reads better as a condition name
    """No model file configured, or MediaPipe could not load it."""


def detect_face_box(rgb: npt.NDArray[np.uint8]) -> FaceBox | None:
    """Largest detected face as a pixel box, or None when no face is found."""
    path = os.environ.get("MIRA_FACE_MODEL_PATH")
    if not path or not os.path.isfile(path):
        raise FaceDetectorUnavailable("MIRA_FACE_MODEL_PATH does not point to a model file")
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    options = vision.FaceDetectorOptions(base_options=BaseOptions(model_asset_path=path))
    with vision.FaceDetector.create_from_options(options) as detector:
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        detections = detector.detect(image).detections
    if not detections:
        return None
    box = max(detections, key=lambda d: d.bounding_box.width * d.bounding_box.height).bounding_box
    return FaceBox(box.origin_x, box.origin_y, box.width, box.height)

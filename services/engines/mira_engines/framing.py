"""Framing a face for skin analysis (docs/YOUCAM_API.md §3).

YouCam's Skin Analysis refuses a photo whose face is narrower than 60% of the image width
(``error_src_face_too_small``); raising the resolution does not help, only cropping does. This picks
a portrait crop centred on the detected face so the face fills ``FACE_TARGET_SHARE`` of the width.
Pure arithmetic over the image size and the face box; the API layer does the pixels.
"""

from __future__ import annotations

from dataclasses import dataclass

from mira_engines.audit import FaceBox
from mira_engines.config import FACE_CROP_ASPECT, FACE_MIN_SHARE, FACE_TARGET_SHARE


@dataclass(frozen=True, slots=True)
class Crop:
    x: int
    y: int
    width: int
    height: int


def frame_face(image_width: int, image_height: int, face: FaceBox) -> Crop | None:
    """The crop that makes the face fill the target share of the width; None if none is needed.

    The crop is portrait (``FACE_CROP_ASPECT``), centred horizontally on the face, with the face a
    little above the vertical centre as in a passport photo, and always inside the image. When the
    image is too narrow or short to reach the target, the crop is as tight as the image allows.
    """
    if image_width <= 0 or image_height <= 0 or face.width <= 0 or face.height <= 0:
        return None
    if face.width / image_width >= FACE_MIN_SHARE.value:
        return None
    width = round(face.width / FACE_TARGET_SHARE.value)
    height = round(width / FACE_CROP_ASPECT.value)
    if height > image_height:  # a wide, short image: keep its height and narrow to the aspect
        height = image_height
        width = min(width, round(height * FACE_CROP_ASPECT.value))
    width = min(width, image_width)
    cx = face.x + face.width / 2
    # The face centre sits at 45% of the crop's height: room for hair above, chin and neck below.
    cy = face.y + face.height / 2
    x = round(min(max(cx - width / 2, 0), image_width - width))
    y = round(min(max(cy - 0.45 * height, 0), image_height - height))
    return Crop(x, y, width, height)

import pytest
from hypothesis import given
from hypothesis import strategies as st

from mira_engines.audit import FaceBox
from mira_engines.config import FACE_CROP_ASPECT, FACE_MIN_SHARE, FACE_TARGET_SHARE
from mira_engines.framing import frame_face


def test_head_and_shoulders_is_cropped_to_the_target_share() -> None:
    # A 1600 x 2400 portrait whose face is 520 px wide: 0.33 of the width, too small for YouCam.
    crop = frame_face(1600, 2400, FaceBox(540, 600, 520, 680))
    assert crop is not None
    assert 520 / crop.width == pytest.approx(FACE_TARGET_SHARE.value, abs=0.01)
    assert crop.width / crop.height == pytest.approx(FACE_CROP_ASPECT.value, abs=0.01)
    # The face is inside the crop.
    assert crop.x <= 540
    assert crop.x + crop.width >= 540 + 520
    assert crop.y <= 600
    assert crop.y + crop.height >= 600 + 680


def test_a_close_up_is_left_alone() -> None:
    assert frame_face(1000, 1300, FaceBox(150, 200, 700, 850)) is None


def test_a_face_at_the_edge_stays_inside_the_image() -> None:
    crop = frame_face(2000, 1500, FaceBox(1700, 100, 280, 360))
    assert crop is not None
    assert crop.x + crop.width <= 2000
    assert crop.y >= 0
    assert crop.y + crop.height <= 1500


@given(
    w=st.integers(200, 6000),
    h=st.integers(200, 6000),
    fx=st.floats(0, 0.9),
    fy=st.floats(0, 0.9),
    fw=st.floats(0.05, 0.6),
)
def test_crops_always_fit_and_always_meet_youcams_rule_when_room_allows(
    w: int, h: int, fx: float, fy: float, fw: float
) -> None:
    face_w = max(1, round(w * fw))
    face_h = max(1, round(face_w * 1.25))
    x = min(round(w * fx), w - face_w)
    y = min(round(h * fy), max(0, h - face_h))
    crop = frame_face(w, h, FaceBox(x, y, face_w, min(face_h, h)))
    if face_w / w >= FACE_MIN_SHARE.value:
        assert crop is None
        return
    assert crop is not None
    assert crop.x >= 0
    assert crop.x + crop.width <= w
    assert crop.y >= 0
    assert crop.y + crop.height <= h
    # Unless the image was too short to give the full width, the face now meets YouCam's rule.
    if crop.height < h:
        assert face_w / crop.width > 0.60


def test_the_endpoint_crops_a_real_head_and_shoulders_photo() -> None:
    """Uses the bundled detector on a drawn face sized like a head-and-shoulders portrait."""
    import base64
    import io

    from fastapi.testclient import TestClient
    from PIL import Image, ImageDraw

    from mira_engines.api import app

    img = Image.new("RGB", (1200, 1600), (119, 119, 119))
    d = ImageDraw.Draw(img)
    d.ellipse((450, 350, 750, 750), fill=(199, 154, 120))
    for x in (540, 660):
        d.ellipse((x - 25, 500, x + 25, 530), fill=(250, 250, 250))
        d.ellipse((x - 10, 505, x + 10, 525), fill=(60, 40, 30))
    d.chord((550, 640, 650, 690), 0, 180, fill=(170, 90, 80))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    res = TestClient(app).post(
        "/face/frame", json={"image_b64": base64.b64encode(buf.getvalue()).decode()}
    )
    if res.status_code == 503:
        pytest.skip("no face detector on this machine (MediaPipe needs libEGL on Linux)")
    assert res.status_code == 200
    body = res.json()["result"]
    if body["face"] is None:
        pytest.skip("the detector did not see a face in the drawing")
    assert body["crop"] is not None
    cropped = Image.open(io.BytesIO(base64.b64decode(body["image_b64"])))
    assert body["face"]["width"] / cropped.width > 0.6

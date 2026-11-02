import math

from mira_engines.look import hue_gap, suggest
from mira_engines.shade import Shade


def lab_at(hue: float, chroma: float, lightness: float) -> tuple[float, float, float]:
    return lightness, chroma * math.cos(math.radians(hue)), chroma * math.sin(math.radians(hue))


SKIN = lab_at(55.0, 20.0, 65.0)
NATURAL_LIP = lab_at(25.0, 30.0, 55.0)
HAIR = lab_at(60.0, 5.0, 20.0)  # contrast |20 − 65| = 45
GARMENT = lab_at(10.0, 40.0, 40.0)


def test_hue_gap_wraps() -> None:
    assert hue_gap(lab_at(350.0, 10, 50), lab_at(10.0, 10, 50)) == __import__("pytest").approx(20.0)


def test_lip_prefers_hue_near_garment_or_lip_and_matching_contrast() -> None:
    lips = [
        Shade("deep", "Deep", lab_at(15.0, 35.0, 25.0)),  # contrast 40: close to 45
        Shade("light", "Light", lab_at(15.0, 35.0, 60.0)),  # contrast 5
        Shade("blue", "Blue", lab_at(250.0, 35.0, 25.0)),  # outside both hue windows
    ]
    out = suggest(
        garment=GARMENT, skin=SKIN, natural_lip=NATURAL_LIP, hair=HAIR, lips=lips, blushes=[]
    )
    assert out.personal_contrast == 45.0
    assert out.lip is not None
    assert out.lip.shade.id == "deep"
    assert out.lip.reason == "hue_near_garment"
    assert out.lip.contrast_matched


def test_lip_falls_back_to_closest_to_natural_lip() -> None:
    lips = [
        Shade("blue", "Blue", lab_at(250.0, 35.0, 40.0)),
        Shade("green", "Green", lab_at(140.0, 35.0, 40.0)),
    ]
    out = suggest(
        garment=GARMENT, skin=SKIN, natural_lip=NATURAL_LIP, hair=HAIR, lips=lips, blushes=[]
    )
    assert out.lip is not None
    assert out.lip.reason == "no_hue_match_closest_to_natural_lip"
    assert out.lip.shade.id == "green"  # 140° is nearer 25° than 250° is


def test_blush_hue_near_lip_with_lower_chroma() -> None:
    lips = [Shade("lip", "Lip", lab_at(15.0, 35.0, 25.0))]
    blushes = [
        Shade("same-chroma", "Same", lab_at(15.0, 35.0, 60.0)),
        Shade("soft", "Soft", lab_at(25.0, 20.0, 60.0)),
        Shade("far", "Far", lab_at(90.0, 20.0, 60.0)),
    ]
    out = suggest(
        garment=GARMENT, skin=SKIN, natural_lip=NATURAL_LIP, hair=HAIR, lips=lips, blushes=blushes
    )
    assert out.blush is not None
    assert out.blush.shade is not None
    assert out.blush.shade.id == "soft"
    none = suggest(
        garment=GARMENT,
        skin=SKIN,
        natural_lip=NATURAL_LIP,
        hair=HAIR,
        lips=lips,
        blushes=blushes[:1] + blushes[2:],
    )
    assert none.blush is not None
    assert none.blush.shade is None
    assert none.blush.reason == "none_in_window"


def test_no_lips_gives_no_suggestion() -> None:
    out = suggest(
        garment=GARMENT, skin=SKIN, natural_lip=NATURAL_LIP, hair=HAIR, lips=[], blushes=[]
    )
    assert out.lip is None
    assert out.blush is None

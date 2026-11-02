"""Fixes from the vision review: strict requests, bounded input and honest labels."""

from __future__ import annotations

import base64
import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from mira_engines.api import app
from mira_engines.look import suggest
from mira_engines.phantom import fit
from mira_engines.shade import Shade, finish_and_coverage, off_axis_label, prerank
from mira_engines.stats import change, noise_floor

client = TestClient(app)


def post(path: str, body: str) -> int:
    res = client.post(path, content=body, headers={"content-type": "application/json"})
    return int(res.status_code)


class TestStrictRequests:
    """D28: JSON is read as TypeScript's Zod reads it. Nothing is coerced."""

    def test_a_string_is_not_a_number(self) -> None:
        assert post("/colour/de2000", '{"pairs":[[[50,"0",0],[50,0,0]]]}') == 422

    def test_a_boolean_is_not_a_number(self) -> None:
        assert post("/audit/identity", '{"source":[1,2],"final":[1,true]}') == 422

    def test_nan_and_infinity_are_refused(self) -> None:
        assert post("/phantom/fit", '{"intensities":[0,1,2],"scores":[1,NaN,3],"mdc":1}') == 422
        assert post("/stats/change", '{"baseline":50,"now":Infinity,"claim_direction":"up"}') == 422

    def test_out_of_range_colour_and_score_are_refused(self) -> None:
        assert post("/colour/de2000", '{"pairs":[[[-500,0,0],[50,0,0]]]}') == 422
        assert post("/shade/finish", '{"concern_raw_scores":{"acne":900}}') == 422

    def test_unknown_fields_are_refused_and_arrays_still_work_as_tuples(self) -> None:
        assert post("/colour/de2000", '{"pairs":[[[50,0,0],[50,0,0]]],"extra":1}') == 422
        assert post("/colour/de2000", '{"pairs":[[[50,0,0],[60,1,1]]]}') == 200

    def test_the_error_does_not_echo_the_input(self) -> None:
        res = client.post(
            "/colour/de2000",
            content='{"pairs":[[[50,"secret-colour",0],[50,0,0]]]}',
            headers={"content-type": "application/json"},
        )
        assert "secret-colour" not in res.text

    def test_a_zero_mdc_is_refused(self) -> None:
        assert (
            post("/stats/change", '{"baseline":50,"now":51,"mdc":0,"claim_direction":"up"}') == 422
        )


class TestImageLimits:
    def _png(self, width: int, height: int) -> str:
        buf = io.BytesIO()
        Image.new("RGBA", (width, height), (200, 100, 100, 255)).save(buf, "PNG")
        return base64.b64encode(buf.getvalue()).decode()

    def test_a_small_file_with_too_many_pixels_is_refused_before_decoding(self) -> None:
        # About 36 megapixels, a few hundred bytes of PNG: it must not be decoded.
        res = client.post("/garment/colour", json={"image_b64": self._png(6000, 6000)})
        assert res.status_code == 413

    def test_an_ordinary_image_still_works(self) -> None:
        res = client.post("/garment/colour", json={"image_b64": self._png(64, 64)})
        assert res.status_code == 200

    def test_an_oversized_body_is_refused(self) -> None:
        res = client.post("/garment/colour", json={"image_b64": "A" * (14 * 1024 * 1024)})
        assert res.status_code == 413


class TestHonestNumbers:
    def test_identical_captures_give_no_minimal_detectable_change(self) -> None:
        floor = noise_floor([[40.0, 40.0, 40.0]] * 3)
        assert floor.s_w == 0.0
        assert floor.mdc is None

    def test_a_change_with_no_mdc_is_not_available_rather_than_clear(self) -> None:
        assert change(50.0, 50.0001, 0.0, "up").words == "n/a"
        assert change(50.0, 50.0, 0.0, "up").words == "n/a"

    def test_a_phantom_with_no_spread_in_intensity_is_not_usable_and_has_no_nan(self) -> None:
        out = fit([0.0, 0.0, 0.0, 0.0], [10.0, 20.0, 30.0, 40.0], 1.0)
        assert not out.usable
        assert np.isfinite(out.rho)


class TestDirectionsFollowChroma:
    skin = (60.0, 15.0, 20.0)

    def test_a_stronger_shade_of_the_same_lightness_and_hue_is_not_darker(self) -> None:
        stronger = (60.0, 22.5, 30.0)  # same L*, same hue angle, 1.5x the chroma
        ranked = prerank(self.skin, [Shade("a", "A", stronger)])[0]
        assert ranked.label == "more_vivid"

    def test_a_weaker_one_is_more_muted(self) -> None:
        assert off_axis_label(self.skin, (60.0, 7.5, 10.0), 0.0, 0.0) == "more_muted"

    def test_lightness_still_wins_when_it_is_the_biggest_difference(self) -> None:
        assert off_axis_label(self.skin, (70.0, 15.5, 20.5), 10.0, 0.0) == "lighter"


class TestLookIgnoresHueOfGrey:
    def test_a_black_garment_does_not_pick_a_lip_by_its_noise_hue(self) -> None:
        red = Shade("red", "Red", (45.0, 55.0, 35.0))
        pink = Shade("pink", "Pink", (60.0, 30.0, 5.0))
        black = (20.0, 0.3, 0.2)
        out = suggest(
            garment=black,
            skin=(65.0, 15.0, 20.0),
            natural_lip=(55.0, 25.0, 12.0),
            hair=(20.0, 1.0, 1.0),
            lips=[red, pink],
            blushes=[],
        )
        assert out.lip is not None
        assert out.lip.reason != "hue_near_garment"


class TestFinishReadsProfileIds:
    def test_profile_metric_ids_and_hd_names_raise_coverage_like_plain_names(self) -> None:
        for key in ("acne", "hd_acne", "skin.hd_acne.whole"):
            out = finish_and_coverage("normal", {key: 10.0})
            assert out.coverage == "medium", key
            assert out.coverage_reason == "raised_for_concern"

    @pytest.mark.parametrize("key", ["hd_pore", "skin.hd_pore.whole"])
    def test_other_concerns_do_not(self, key: str) -> None:
        assert finish_and_coverage("normal", {key: 10.0}).coverage == "light"


class TestClosedLoopLabel:
    def test_the_blend_is_labelled_on_the_same_lines_as_the_pre_rank(self) -> None:
        from mira_engines.shade import closed_loop

        skin = (60.0, 15.0, 20.0)
        assert closed_loop(skin, (62.0, 15.0, 21.0), (60.2, 15.0, 20.2)).label == "blends_closely"
        assert closed_loop(skin, (62.0, 15.0, 21.0), (61.5, 15.5, 20.5)).label in {
            "blends_closely",
            "close",
        }
        assert closed_loop(skin, (75.0, 15.0, 30.0), (75.0, 15.0, 30.0)).label == "not_close"


class TestConcealerSuggestion:
    def test_a_low_dark_circle_reading_suggests_concealer_but_does_not_raise_coverage(self) -> None:
        out = finish_and_coverage("normal", {"skin.hd_dark_circle.left_eye": 20.0})
        assert out.concealer_suggested is True
        assert out.coverage == "light"

    def test_a_high_or_missing_reading_does_not(self) -> None:
        assert finish_and_coverage("normal", {"dark_circle": 80.0}).concealer_suggested is False
        assert finish_and_coverage("normal", {}).concealer_suggested is False

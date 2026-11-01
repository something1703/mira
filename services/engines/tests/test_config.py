from mira_engines import config
from mira_engines.config import Threshold


def _thresholds() -> dict[str, Threshold]:
    return {
        name: value
        for name, value in vars(config).items()
        if name.isupper() and isinstance(value, Threshold)
    }


def test_every_threshold_has_a_source_and_calibration_flag() -> None:
    thresholds = _thresholds()
    assert len(thresholds) >= 20
    for name, t in thresholds.items():
        assert t.source.strip(), f"{name} has no source"
        assert isinstance(t.calibrated, bool), f"{name} has no calibrated flag"


def test_close_is_looser_than_match() -> None:
    assert config.MATCH_DE.value < config.CLOSE_DE.value


def test_ita_bands_descend() -> None:
    bounds = [b for b, _ in config.ITA_BANDS]
    assert bounds == sorted(bounds, reverse=True)


def test_snapshot_is_json_ready() -> None:
    snap = config.snapshot()
    assert snap["MATCH_DE"] == {
        "value": 2.0,
        "source": config.MATCH_DE.source,
        "calibrated": False,
        "unit": "ΔE00",
    }
    assert snap["PRIOR_SD_DAY"] == {}

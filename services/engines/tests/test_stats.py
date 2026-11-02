import math

import numpy as np
import pytest

from mira_engines.stats import change, noise_floor


def test_single_session_gives_s_w_only() -> None:
    nf = noise_floor([[60.0, 62.0, 61.0]])
    assert nf.s_w == pytest.approx(1.0)
    assert nf.s_d is None
    assert nf.s_d_source == "unknown"
    assert nf.mdc is None


def test_prior_used_before_three_sessions() -> None:
    nf = noise_floor([[60.0, 62.0, 61.0], [59.0, 61.0, 60.0]], prior_sd_day=2.0)
    assert nf.s_d_source == "prior"
    assert nf.se == pytest.approx(math.sqrt(4.0 + 1.0 / 3.0))
    assert nf.mdc == pytest.approx(1.96 * math.sqrt(2.0) * nf.se if nf.se else 0.0)


def test_estimated_from_three_sessions_and_clamped_at_zero() -> None:
    flat = noise_floor([[60.0, 62.0, 61.0]] * 3)  # session means identical → s_d² clamps to 0
    assert flat.s_d == 0.0
    assert flat.s_d_source == "estimated"
    assert flat.se == pytest.approx(math.sqrt(1.0 / 3.0))


@pytest.mark.parametrize(
    "bad",
    [[], [[1.0]], [[1.0, 2.0], [1.0, 2.0, 3.0]], [[1.0, float("nan")]]],
)
def test_rejects_bad_input(bad: list[list[float]]) -> None:
    with pytest.raises(ValueError, match=r"."):
        noise_floor(bad)


def test_mdc_recovers_analytic_value_over_1000_seeds() -> None:
    sigma_d, sigma_w, k, n = 3.0, 2.0, 3, 12
    analytic = 1.96 * math.sqrt(2.0) * math.sqrt(sigma_d**2 + sigma_w**2 / k)
    mdcs = []
    for seed in range(1000):
        rng = np.random.default_rng(seed)
        day = rng.normal(0.0, sigma_d, size=(n, 1))
        data = 60.0 + day + rng.normal(0.0, sigma_w, size=(n, k))
        mdc = noise_floor(data.tolist()).mdc
        assert mdc is not None
        mdcs.append(mdc)
    assert np.mean(mdcs) == pytest.approx(analytic, rel=0.10)


@pytest.mark.parametrize(
    ("now", "claim", "words"),
    [
        (61.0, "up", "within"),
        (64.0, "up", "small"),  # MDC 3 → 3 ≤ 4 < 6
        (68.0, "up", "clear"),
        (56.0, "up", "opposite"),
        (51.0, "down", "clear"),
        (61.0, "down", "within"),
    ],
)
def test_change_words(now: float, claim: str, words: str) -> None:
    out = change(60.0, now, 3.0, claim)  # type: ignore[arg-type]
    assert out.words == words
    assert out.delta == pytest.approx(now - 60.0)


def test_change_without_mdc_is_not_available() -> None:
    assert change(60.0, 70.0, None, "up").words == "n/a"

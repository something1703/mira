import pytest

from mira_engines.phantom import fit, invert

X = [0.0, 0.25, 0.5, 0.75, 1.0]


def test_monotone_curve_is_usable_and_invertible() -> None:
    p = fit(X, [60.0, 56.0, 52.0, 48.0, 44.0], mdc=3.0)
    assert p.usable
    assert p.rho == pytest.approx(-1.0)
    assert p.reason == "ok"
    assert invert(p, -8.0) == pytest.approx(0.5)
    assert invert(p, 0.0) == pytest.approx(0.0)
    assert invert(p, -16.0) == pytest.approx(1.0)


def test_increasing_curve() -> None:
    p = fit(X, [40.0, 44.0, 48.0, 52.0, 56.0], mdc=3.0)
    assert p.usable
    assert invert(p, 8.0) == pytest.approx(0.5)


def test_flat_curve_is_unusable() -> None:
    p = fit(X, [50.0] * 5, mdc=1.0)
    assert not p.usable
    assert p.reason == "not_monotone"
    assert invert(p, 0.0) is None


def test_noisy_curve_is_unusable() -> None:
    p = fit(X, [50.0, 55.0, 48.0, 56.0, 49.0], mdc=1.0)
    assert not p.usable
    assert p.reason == "not_monotone"


def test_range_must_exceed_mdc() -> None:
    p = fit(X, [50.0, 50.4, 50.8, 51.2, 51.6], mdc=2.0)
    assert not p.usable
    assert p.reason == "range_below_mdc"


def test_too_few_points() -> None:
    assert fit([0.0, 1.0], [1.0, 2.0], mdc=0.1).reason == "too_few_points"


def test_isotonic_fit_pools_a_small_violation() -> None:
    p = fit(X, [60.0, 55.0, 56.0, 48.0, 40.0], mdc=3.0)
    assert p.usable
    assert list(p.fitted_delta) == sorted(p.fitted_delta, reverse=True)


def test_target_outside_range_is_not_extrapolated() -> None:
    p = fit(X, [60.0, 56.0, 52.0, 48.0, 44.0], mdc=3.0)
    assert invert(p, -30.0) is None
    assert invert(p, 5.0) is None


def test_unsorted_input_and_length_mismatch() -> None:
    p = fit([1.0, 0.0, 0.5, 0.25, 0.75], [44.0, 60.0, 52.0, 56.0, 48.0], mdc=3.0)
    assert p.usable
    with pytest.raises(ValueError, match="same length"):
        fit([0.0, 1.0], [1.0], mdc=1.0)

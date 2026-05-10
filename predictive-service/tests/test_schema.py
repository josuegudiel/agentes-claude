"""Tests del schema sin dependencias pesadas (no carga TimesFM)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from predictive_service.schema import ForecastRequest


def test_minimal_request_ok() -> None:
    req = ForecastRequest(series=[1.0] * 10, horizon=12, frequency=0)
    assert req.horizon == 12
    assert req.quantiles == [0.1, 0.5, 0.9]


def test_too_short_series_rejected() -> None:
    with pytest.raises(ValidationError):
        ForecastRequest(series=[1.0, 2.0], horizon=12, frequency=0)


def test_invalid_quantile_rejected() -> None:
    with pytest.raises(ValidationError):
        ForecastRequest(series=[1.0] * 10, horizon=12, frequency=0, quantiles=[0.05])


def test_horizon_clamped() -> None:
    with pytest.raises(ValidationError):
        ForecastRequest(series=[1.0] * 10, horizon=9999, frequency=0)

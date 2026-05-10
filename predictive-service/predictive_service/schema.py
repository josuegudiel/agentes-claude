"""Schemas Pydantic compartidos entre el HTTP layer y el agente TS.

Un solo archivo intencional: que la API quede facil de leer y de tipar
en el cliente TypeScript (los nombres de campos son contrato).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

# Frecuencias soportadas por TimesFM.
#   0 = high freq (intra-day, hourly, daily fino)
#   1 = medium    (weekly, monthly)
#   2 = low       (quarterly, yearly)
Frequency = Literal[0, 1, 2]


class ForecastRequest(BaseModel):
    """Una serie historica + cuantos pasos predecir."""

    series: list[float] = Field(
        ...,
        description="Valores historicos en orden temporal ascendente.",
        min_length=8,
        max_length=2048,
    )
    horizon: int = Field(
        24, ge=1, le=512, description="Cuantos puntos predecir hacia el futuro."
    )
    frequency: Frequency = Field(
        0, description="0=alta (horaria/diaria), 1=media (semanal/mensual), 2=baja (trimestral/anual)."
    )
    # Quantiles que TimesFM expone (0.1, 0.2, ..., 0.9). Default p10/p50/p90
    # son los mas utiles para mostrar incertidumbre.
    quantiles: list[float] = Field(
        default_factory=lambda: [0.1, 0.5, 0.9],
        description="Quantiles a devolver (entre 0.1 y 0.9, paso 0.1).",
    )

    @field_validator("series")
    @classmethod
    def _no_nan(cls, v: list[float]) -> list[float]:
        for i, x in enumerate(v):
            if x != x:  # NaN check sin importar math
                raise ValueError(f"series[{i}] es NaN")
        return v

    @field_validator("quantiles")
    @classmethod
    def _valid_quantiles(cls, v: list[float]) -> list[float]:
        allowed = {round(0.1 * i, 1) for i in range(1, 10)}
        for q in v:
            if round(q, 1) not in allowed:
                raise ValueError(f"quantile {q} fuera de [0.1..0.9] paso 0.1")
        return v


class ForecastResponse(BaseModel):
    """Forecast point + quantile bands."""

    horizon: int
    point_forecast: list[float]
    quantile_forecast: dict[str, list[float]]  # ej {"0.1": [...], "0.5": [...]}
    model: str
    elapsed_ms: int


class HealthResponse(BaseModel):
    status: Literal["ok", "loading", "error"]
    model: str
    backend: str
    horizon_max: int

"""FastAPI app que sirve TimesFM.

Endpoints:
  GET  /healthz   -> estado y modelo cargado
  POST /forecast  -> point + quantile forecast

Diseno:
  - Carga del modelo en startup (lifespan). Si falla, /healthz devuelve "error"
    para que el agente TS no spamee /forecast.
  - No hay auth: este sidecar vive en localhost / red privada. Si lo expones
    publico, mete un reverse proxy con auth bearer.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from .forecaster import TimesFMForecaster
from .schema import ForecastRequest, ForecastResponse, HealthResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s | %(message)s",
)
logger = logging.getLogger("predictive_service")

forecaster = TimesFMForecaster()
_load_error: str | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _load_error
    try:
        forecaster.load()
    except Exception as exc:  # noqa: BLE001 - queremos capturar todo en boot
        _load_error = f"{type(exc).__name__}: {exc}"
        logger.exception("No se pudo cargar TimesFM")
    yield


app = FastAPI(
    title="Predictive Service (TimesFM)",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    if _load_error is not None:
        return HealthResponse(
            status="error",
            model=forecaster.config.repo_id,
            backend=forecaster.config.backend,
            horizon_max=forecaster.config.horizon_max,
        )
    return HealthResponse(
        status="ok" if forecaster.loaded else "loading",
        model=forecaster.config.repo_id,
        backend=forecaster.config.backend,
        horizon_max=forecaster.config.horizon_max,
    )


@app.post("/forecast", response_model=ForecastResponse)
async def forecast(req: ForecastRequest) -> ForecastResponse:
    if _load_error is not None:
        raise HTTPException(status_code=503, detail=f"model_unavailable: {_load_error}")
    if not forecaster.loaded:
        raise HTTPException(status_code=503, detail="model_loading")

    try:
        point, bands, elapsed = forecaster.forecast(
            series=req.series,
            horizon=req.horizon,
            frequency=req.frequency,
            quantiles=req.quantiles,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ForecastResponse(
        horizon=req.horizon,
        point_forecast=point,
        quantile_forecast=bands,
        model=forecaster.config.repo_id,
        elapsed_ms=elapsed,
    )


@app.exception_handler(Exception)
async def _unhandled(_req, exc: Exception):  # type: ignore[no-untyped-def]
    logger.exception("Error no manejado")
    return JSONResponse(
        status_code=500,
        content={"detail": f"internal_error: {type(exc).__name__}"},
    )

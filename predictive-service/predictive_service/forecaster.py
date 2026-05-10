"""Wrapper alrededor de TimesFM 2.0 (PyTorch).

Se carga UNA vez en startup. El checkpoint vive en ~/.cache/huggingface tras la
primera descarga. Mantenemos el wrapper sin estado en runtime para que la HTTP
layer pueda reusar la misma instancia entre requests sin locks (TimesFM es
thread-safe para inferencia segun la doc de Google).
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass

import numpy as np

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ForecasterConfig:
    repo_id: str = "google/timesfm-2.0-500m-pytorch"
    backend: str = "cpu"  # "cpu" o "gpu" (CUDA)
    context_len: int = 2048
    horizon_max: int = 512
    per_core_batch_size: int = 32


class TimesFMForecaster:
    """Carga perezosa de TimesFM. Construir es barato; load() descarga pesos."""

    def __init__(self, cfg: ForecasterConfig | None = None) -> None:
        self._cfg = cfg or ForecasterConfig(
            backend=os.getenv("TIMESFM_BACKEND", "cpu"),
            repo_id=os.getenv("TIMESFM_REPO_ID", "google/timesfm-2.0-500m-pytorch"),
        )
        self._model = None  # type: ignore[assignment]
        self._loaded = False

    @property
    def config(self) -> ForecasterConfig:
        return self._cfg

    @property
    def loaded(self) -> bool:
        return self._loaded

    def load(self) -> None:
        """Importa timesfm y descarga pesos. Idempotente."""
        if self._loaded:
            return

        logger.info("Cargando TimesFM repo=%s backend=%s", self._cfg.repo_id, self._cfg.backend)
        # Import perezoso: timesfm jala torch (~700MB), no lo queremos al boot
        # del proceso si solo van a llamar /healthz.
        import timesfm  # type: ignore[import-untyped]

        self._model = timesfm.TimesFm(
            hparams=timesfm.TimesFmHparams(
                backend=self._cfg.backend,
                per_core_batch_size=self._cfg.per_core_batch_size,
                horizon_len=self._cfg.horizon_max,
                num_layers=50,
                use_positional_embedding=False,
                context_len=self._cfg.context_len,
            ),
            checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id=self._cfg.repo_id),
        )
        self._loaded = True
        logger.info("TimesFM listo")

    def forecast(
        self,
        series: list[float],
        horizon: int,
        frequency: int,
        quantiles: list[float],
    ) -> tuple[list[float], dict[str, list[float]], int]:
        """Devuelve (point_forecast, quantile_bands, elapsed_ms)."""
        if not self._loaded or self._model is None:
            raise RuntimeError("TimesFM no esta cargado. Llama load() primero.")
        if horizon > self._cfg.horizon_max:
            raise ValueError(f"horizon {horizon} > horizon_max {self._cfg.horizon_max}")

        arr = np.asarray(series, dtype=np.float32)
        t0 = time.perf_counter()
        # TimesFM acepta batches; aqui mandamos una sola serie.
        point, quantile = self._model.forecast(
            inputs=[arr],
            freq=[frequency],
        )
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        # `point` shape: (1, horizon_max). Recortamos al horizon pedido.
        point_arr = np.asarray(point[0])[:horizon]

        # `quantile` shape: (1, horizon_max, 10) -> indices 0..9 para
        # quantiles 0.1..1.0 segun el orden de TimesFM. Mapeamos por indice.
        # En la version 2.0 los quantiles son [0.1, 0.2, ..., 0.9, mean].
        q_arr = np.asarray(quantile[0])  # (horizon_max, 10)
        bands: dict[str, list[float]] = {}
        for q in quantiles:
            idx = int(round(q * 10)) - 1  # 0.1 -> 0, 0.5 -> 4, 0.9 -> 8
            idx = max(0, min(idx, 8))
            bands[f"{q:.1f}"] = q_arr[:horizon, idx].tolist()

        return point_arr.tolist(), bands, elapsed_ms

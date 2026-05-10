# predictive-service

Sidecar HTTP que sirve **TimesFM 2.0** (Google Research, Apache 2.0) detrás de FastAPI. El agente TypeScript en `src/agents/predictive/` lo consume vía `POST /forecast`.

## Por qué es un sidecar

TimesFM es un modelo PyTorch — no es un LLM chat ni corre dentro de Ollama. Mantenerlo en un proceso Python aislado tiene tres ventajas:

1. **Cold-start aislado.** Cargar el checkpoint de 500M parámetros toma 10–60s. Lo haces una vez y reutilizas el proceso.
2. **El runtime TS no jala torch.** El agente Node sigue ligero.
3. **Escala independiente.** Si necesitas GPU para forecasts, mueves solo este proceso a una box con CUDA.

## Setup

Necesitas Python 3.10–3.12. Recomendado `uv`:

```bash
cd predictive-service
uv sync
uv run uvicorn predictive_service.main:app --port 8765
```

O con `pip` clásico:

```bash
cd predictive-service
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn predictive_service.main:app --port 8765
```

La primera llamada descarga el checkpoint de Hugging Face (`google/timesfm-2.0-500m-pytorch`, ~2GB) a `~/.cache/huggingface`. Después queda cacheado.

## Endpoints

### `GET /healthz`

```json
{ "status": "ok", "model": "google/timesfm-2.0-500m-pytorch", "backend": "cpu", "horizon_max": 512 }
```

### `POST /forecast`

```json
{
  "series": [10.2, 11.5, 12.1, ...],
  "horizon": 24,
  "frequency": 0,
  "quantiles": [0.1, 0.5, 0.9]
}
```

`frequency`: `0`=alta (horaria/diaria), `1`=media (semanal/mensual), `2`=baja (trimestral/anual).

Respuesta:

```json
{
  "horizon": 24,
  "point_forecast": [12.3, 12.5, ...],
  "quantile_forecast": { "0.1": [...], "0.5": [...], "0.9": [...] },
  "model": "google/timesfm-2.0-500m-pytorch",
  "elapsed_ms": 412
}
```

## GPU

Para usar GPU exporta antes de levantar:

```bash
TIMESFM_BACKEND=gpu uv run uvicorn predictive_service.main:app --port 8765
```

Necesitas `torch` con CUDA del lado tuyo (`uv pip install torch --index-url https://download.pytorch.org/whl/cu121`).

## Tests

```bash
uv run pytest
```

Los tests del schema no cargan TimesFM, así que corren rápido.

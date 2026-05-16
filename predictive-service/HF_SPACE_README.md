---
title: TimesFM Sidecar
emoji: 📈
colorFrom: blue
colorTo: cyan
sdk: docker
app_port: 7860
pinned: false
short_description: HTTP API que sirve forecasts de TimesFM (Google Research)
---

# TimesFM Sidecar

Sidecar HTTP que expone el modelo [TimesFM 2.0](https://huggingface.co/google/timesfm-2.0-500m-pytorch) de Google Research para forecasting de series temporales.

## Endpoints

- `GET  /healthz`  — estado del servicio + modelo cargado
- `POST /forecast` — devuelve point forecast + quantiles (P10/P90)

## Uso desde el agente

Este Space esta pensado para ser llamado por el agente predictivo en [agentes-claude](https://github.com/josuegudiel/agentes-claude). El frontend Next.js (hosteado en Vercel) hace llamadas server-side a este Space — el cliente del navegador nunca toca este endpoint directo.

## Schema del POST /forecast

```json
{
  "series": [1.0, 2.0, 3.0, ...],  // minimo 8 valores
  "horizon": 12,                    // cuantos pasos predecir
  "frequency": 0,                   // 0=alta, 1=media, 2=baja
  "quantiles": [0.1, 0.5, 0.9]
}
```

## Cold start

La primera llamada despues de que el Space duerma (48h sin trafico) tarda 1-2 minutos porque debe descargar el modelo (~500MB) y cargarlo en memoria. Las siguientes llamadas son ~5-15s en CPU (HF free tier no tiene GPU).

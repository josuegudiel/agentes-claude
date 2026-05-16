# Imagen para correr el sidecar en:
#   - Hugging Face Spaces (Docker SDK, free tier 16GB RAM, puerto 7860)
#   - Cualquier VPS/cloud con Docker
#
# Build:   docker build -t predictive-service .
# Run:     docker run -p 7860:7860 predictive-service
#
# Para HF Spaces no necesitas correr esto local — solo subi el repo a tu
# Space (con Dockerfile + HF_SPACE_README.md como README.md) y HF lo buildea.

FROM python:3.12-slim AS base

# uv = pip pero ~20x mas rapido. Lo usamos para instalar las deps.
RUN pip install --no-cache-dir uv

WORKDIR /app

# Cache de modelos de HuggingFace dentro del filesystem del container.
# En HF Spaces este path persiste entre warm-restarts.
ENV HF_HOME=/app/.cache/huggingface

# Copiamos solo lo necesario (no .venv, no __pycache__).
COPY pyproject.toml ./
COPY predictive_service ./predictive_service

# Install: usamos --system para no crear un venv (innecesario en container).
RUN uv pip install --system --no-cache .

# HF Spaces espera puerto 7860 por convencion (configurable via app_port).
EXPOSE 7860

# Listen en 0.0.0.0 para que sea reachable desde fuera del container.
# Single worker — uvicorn ya es async, mas workers solo tendria sentido si
# saturamos CPU, cosa que aqui no pasa porque TimesFM-inference es el cuello.
CMD ["uvicorn", "predictive_service.main:app", "--host", "0.0.0.0", "--port", "7860"]

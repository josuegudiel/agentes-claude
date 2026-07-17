# Agente predictivo (TimesFM + LLM)

Proyecto Next.js **autocontenido**, extraido del monorepo del scanner.
Forecast de series temporales con TimesFM + interpretacion con un LLM
(Groq en la nube u Ollama local).

## Rutas
- `/` — UI: pega una serie, elige horizonte, ve el forecast y los pasos del agente.
- `POST /api/predict` — stream SSE del agente.
- `GET /api/health` — estado de las dependencias.

## Convertirlo en su propio repo
```bash
cd _split/predictive
git init && git add -A && git commit -m "init: agente predictivo"
git branch -M main
git remote add origin git@github.com:<tu-usuario>/predictive-agent.git
git push -u origin main
```

## Desplegar en Vercel
1. Vercel -> Add New -> Project -> importa el repo nuevo.
2. Framework: Next.js (auto). Root directory: la raiz del repo.
3. Environment Variables (ver `.env.example`):
   - `GROQ_API_KEY` (+ `GROQ_MODEL`) para el LLM en la nube, o dejalo
     vacio y usa Ollama local.
   - `PREDICTIVE_SERVICE_URL` -> tu sidecar Python con TimesFM.
4. Deploy.

## Sidecar Python (TimesFM)
Este proyecto necesita el servicio `predictive-service/` (FastAPI + TimesFM)
que quedo en el repo original. Deshpliegalo aparte (Hugging Face Spaces es
gratis) y apunta `PREDICTIVE_SERVICE_URL` a su URL.

## Seguridad
Antes de hacerlo publico: `/api/predict` es un endpoint sin auth que
consume cuota del LLM. Agrega rate-limiting real (KV/Redis, no el Map en
memoria) o auth si lo expones.

# _split — agentes extraidos como proyectos independientes

Cada subcarpeta es un proyecto Next.js **autocontenido** (su propio
package.json, deps, config y deploy), extraido del monorepo del scanner
sin tocar el scanner.

- `predictive/` — agente predictivo (TimesFM + LLM).
- `auditor/` — auditor GEO/SEO.

Regenerar desde cero: `bash scripts/split-agents.sh` (idempotente).

Cada uno trae su `README.md` con los pasos para: crear su repo en GitHub,
convertirlo (git init/push) y desplegarlo en Vercel con sus env vars.

Los tests de cada agente quedaron en el repo original (`src/agents/*`);
estos bundles son solo para deploy. Cuando confirmes que quedaron bien,
limpiamos el codigo estacionado del repo del scanner.

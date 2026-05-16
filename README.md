# agentes-claude

Browser automation para flujos de SaaS con **Playwright + TypeScript**, organizado para tres casos de uso al mismo tiempo:

1. **E2E testing determinista** — `tests/e2e/*.spec.ts`
2. **Seed de tenants demo** — `scripts/seed-demo.ts`
3. **Agentes LLM productivos** que ejecutan tareas del usuario final — `scripts/run-agent.ts`

Los tres comparten la misma capa de Page Objects + Flows, así no escribes el flujo de "crear paciente" tres veces.

---

## Arquitectura

```
src/
  core/        Infra: config (zod), logger (pino), browser factory, retry, errors, auth state
  pages/       Page Object Model — un objeto por pantalla
  flows/       Composiciones de POMs (caso de uso de negocio, devuelve datos)
  fixtures/    Playwright test fixtures (auth, page objects, factories de datos)
  agents/      Runtime LLM (AI SDK + Anthropic) + tools envolviendo flows
  seed/        Logica de siembra de datos demo
tests/
  e2e/         Specs E2E (auth, pacientes, …)
  global.setup.ts   Login una vez, cachea storage state
scripts/       CLIs operativos
.github/workflows/e2e.yml    CI con sharding x4
```

### Por qué este diseño

- **Tests usan los mismos flows que el agente productivo.** Si la app cambia, arreglas el Page Object una vez.
- **Fail fast en config.** `src/core/config.ts` valida `.env` con zod al boot — falla en 50ms, no en 30s.
- **Storage state cacheado.** Login se hace una vez en `global.setup.ts`. Cada test arranca logueado.
- **Tools del agente son envolturas delgadas sobre flows.** Schema zod estricto → el LLM no inventa argumentos.
- **Retries con jitter.** `withRetry()` para flows críticos sin reintentar errores deterministas (auth, validación).

---

## Setup

```bash
pnpm install
pnpm install:browsers
cp .env.example .env
# llena BASE_URL, TEST_USER_EMAIL, TEST_USER_PASSWORD
```

Para usar el agente LLM además agrega `ANTHROPIC_API_KEY`.

---

## Uso

### Tests E2E

```bash
pnpm test                # corre todo headless
pnpm test:headed         # ver el navegador
pnpm test:ui             # UI mode de Playwright (recomendado para debug)
pnpm test:smoke          # solo tests con tag @smoke
pnpm test:debug          # PWDEBUG=1
pnpm report              # abre el reporte HTML del último run
```

### Tests unitarios (vitest)

Cubren el agente predictivo (`src/agents/predictive/`) con `fetch` mockeado — no necesitan el sidecar Python ni Ollama corriendo.

```bash
pnpm test:unit           # un solo run, ~8s
pnpm test:unit:watch     # watch mode mientras editas
```

### UI web (Next.js, en `web/`)

UI interactiva del agente predictivo: pegás una serie, elegís horizonte, y ves los pasos del agente en vivo + un chart con histórico y forecast con bandas P10–P90.

**Dos modos de correr:**

**Modo local (todo open source en tu PC):**

```bash
# Una sola vez
cp web/.env.local.example web/.env.local

# 3 procesos en paralelo
ollama serve                  # terminal 1
pnpm predict:up               # terminal 2 — sidecar Python con TimesFM
pnpm web:dev                  # terminal 3 — abre http://localhost:3000
```

**Modo cloud (publicado en internet, $0/mes):**

Frontend en Vercel + Groq como LLM + Hugging Face Spaces para TimesFM. Pasos detallados en [`DEPLOY.md`](DEPLOY.md). El agente detecta automaticamente cuál usar via la env var `GROQ_API_KEY`: si está, va a Groq; si no, va a Ollama local.

- `pnpm web:build` y `pnpm web:start` para producción local.
- El web Node es el único punto de entrada al cliente: el sidecar Python y el LLM quedan internos, sólo accesibles vía Next.
- Streaming en vivo (Server-Sent Events) en `POST /api/predict` — cada paso del tool-loop aparece en el panel lateral.
- Rate limit por IP activo solo en producción (10 req / 10 min por default, configurable).

### Seed de tenant demo

```bash
pnpm seed:demo                    # 5 pacientes
pnpm seed:demo -- --count 20      # 20 pacientes
```

### Agente LLM (tareas en lenguaje natural)

```bash
pnpm agent:run -- "Crea un paciente llamado Juan Perez con email juan@test.com"
```

### Agente predictivo (TimesFM + Ollama, todo open source)

Agente independiente del anterior. Usa **TimesFM 2.0** (Google Research, Apache 2.0) para forecasting de series temporales y **Ollama** local (Llama 3.1 / Qwen 2.5 / Mistral) para razonamiento en lenguaje natural. **No depende de la API de Anthropic.**

Arquitectura: el agente vive en `src/agents/predictive/` y habla por HTTP con un sidecar Python (`predictive-service/`) que carga TimesFM en PyTorch. Mantenerlos separados evita meter `torch` en el runtime Node y permite mover el sidecar a una box con GPU sin tocar el agente.

Setup una sola vez:

```bash
# 1. Sidecar Python con TimesFM
cd predictive-service && uv sync && cd ..

# 2. Modelo OSS para Ollama (instala https://ollama.com primero)
ollama pull llama3.1:8b
```

Cada vez que quieras usarlo, levanta el sidecar en otra terminal:

```bash
pnpm predict:up   # uvicorn en :8765, descarga ~2GB la primera vez
```

Y corre el agente:

```bash
pnpm agent:predict -- "Predice las proximas 24 horas de ventas" \
  --series-file ventas.json --horizon 24 --frequency 0
```

Detalles en [`predictive-service/README.md`](predictive-service/README.md).

### Agente Origin (voz para Star Citizen)

Asistente de voz **standalone para Windows** que escucha por **Push-to-Talk**, transcribe local con **faster-whisper** y traduce a teclas DirectInput. Bilingüe ES/EN con toggle, perfiles múltiples (Flight, FPS, EVA, Mining, …), dashboard PySide6, system tray. Sin Internet después de la primera descarga del modelo.

Vive en `origin/` como app Python independiente — no usa Node ni la API de Anthropic. Empaquetable como `.exe` con PyInstaller + Inno Setup.

```powershell
cd origin
uv sync
uv run python -m origin          # GUI
uv run python -m origin --headless --dry-run   # smoke sin enviar teclas
```

Detalles en [`origin/README.md`](origin/README.md).

### Codegen (generar selectores)

```bash
pnpm codegen https://staging.tu-saas.com
```

---

## Cómo agregar un nuevo dominio (ej: inventario)

1. **Page Object** `src/pages/InventoryPage.ts` extendiendo `BasePage`. Sigue las reglas del comentario en `BasePage.ts`.
2. **Flow** `src/flows/inventory.flow.ts` con funciones que representan casos de uso (`createProduct`, `updateStock`). Reciben `Page`, devuelven datos serializables.
3. **Fixtures** — agrega `makeProduct()` en `src/fixtures/data/products.ts`.
4. **Tests** `tests/e2e/inventory.spec.ts` usando los flows.
5. **Tools del agente** (opcional) — añade `inventory_create_product` en `src/agents/tools.ts` envolviendo el flow.

Mismo patrón para POS, billing, lo que sea.

---

## Selectores: orden de preferencia

```
1. getByRole / getByLabel       <- accesibles + estables
2. getByTestId('foo')           <- requiere data-testid en el código de la app
3. getByText                    <- estable si el copy no cambia seguido
4. CSS / XPath                  <- último recurso
```

Si encuentras que muchos selectores son frágiles, presiona al equipo de la app para agregar `data-testid` en los puntos críticos. Es la mejor inversión que puedes hacer.

---

## Decisiones explícitas (y cuándo cambiarlas)

| Decisión | Razón | Cuándo reconsiderar |
|---|---|---|
| Playwright sobre Puppeteer/Cypress | Mejor DX, traces, multi-browser, network mocking | Si tu app es solo Chromium y no necesitas todo eso |
| Page Object Model | Aislar selectores en un solo lugar | Para pruebas muy simples (1-2 archivos), POM es overkill |
| AI SDK + Anthropic para agentes | Buen tool use, Claude maneja contexto largo | Si necesitas hosted browser (Browserbase) cambia el runtime, no los flows |
| Sin Browserbase de inicio | Agrega costo + dependencia. Local funciona bien para todo menos producto | Cuando los agentes pasen a producción multi-tenant |
| storage state cacheado en `.auth/` | Login es lento (5-15s). Cachear ahorra minutos por run | Si tu auth depende de tokens cortos (<5min), invalida más seguido |

---

## Observabilidad

- **Traces de Playwright** — `pnpm trace test-results/.../trace.zip` te muestra cada paso, network, DOM snapshots.
- **Logs estructurados** — Pino. En CI sale JSON, parseable por Datadog/Logtail.
- **Screenshots y video on-failure** — automático en CI.
- **CI con sharding** — 4 shards en paralelo en GitHub Actions, cada uno sube su reporte.

Cuando el volumen lo justifique, agrega:
- Doppler/Infisical para credenciales
- Alertas a Slack en fallos repetidos
- Métricas de duración por flow (Prometheus pushgateway o similar)

---

## Roadmap sugerido

- [ ] Page Objects + flows para inventario
- [ ] Page Objects + flows para POS
- [ ] Tools del agente para los anteriores
- [ ] Tests visuales con `toHaveScreenshot()` para regresiones de UI
- [ ] Worker dedicado (Railway/Fly + BullMQ) cuando los agentes pasen a producto

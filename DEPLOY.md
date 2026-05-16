# Deploy a producción (Vercel + Hugging Face + Groq)

Esta guía te lleva paso a paso para que tu agente predictivo quede en una URL pública (`https://tu-app.vercel.app`) usando solo servicios con tier gratuito.

**Tiempo estimado**: 30 minutos haciendo clicks + esperando deploys.

**Costo mensual esperado**: $0 mientras uses los tiers gratuitos.

---

## Arquitectura final

```
                Browser de cualquiera
                          │
                          ▼
        https://tu-app.vercel.app   (Next.js en Vercel — gratis)
                          │
            ┌─────────────┴──────────────┐
            ▼                            ▼
   https://api.groq.com         https://USER-timesfm.hf.space
   (Llama 3.1, gratis)          (TimesFM en HF Spaces, gratis)
```

Las claves y URLs se inyectan vía variables de entorno en Vercel — nunca quedan en el código.

---

## Paso 1 — Cuenta en Groq (5 min)

1. Andá a **https://console.groq.com**.
2. Click en "Sign in" → con Google o GitHub.
3. Una vez dentro, menú lateral → **API Keys** → **Create API Key**.
4. Le ponés un nombre (`agentes-claude-prod`) → **Submit**.
5. **Copiá la clave** que aparece (empieza con `gsk_...`). Solo se muestra una vez.
6. Guardala en un lugar seguro temporalmente — la usarás en el Paso 3.

**Cuota gratuita**: 14,400 requests por día, 30 requests por minuto. Modelo recomendado: `llama-3.1-8b-instant` (rapidísimo).

---

## Paso 2 — Subir el sidecar TimesFM a Hugging Face Spaces (15 min)

### 2.1 Crear cuenta y un Space vacío

1. Andá a **https://huggingface.co/join** y creá cuenta.
2. Una vez logueado, click en tu avatar arriba a la derecha → **New Space**.
3. Llená:
   - **Space name**: `timesfm-sidecar` (o como quieras).
   - **License**: `apache-2.0`.
   - **Space SDK**: seleccioná **Docker** → **Blank**.
   - **Hardware**: **CPU basic** (gratis, 16GB RAM).
   - **Visibility**: **Public**.
4. Click **Create Space**.

Te llevará a una página tipo `https://huggingface.co/spaces/TU_USUARIO/timesfm-sidecar`. El Space está vacío esperando archivos.

### 2.2 Subir el código del sidecar al Space

Tu Space es un repo git. Tenés dos formas de subir el código:

#### Opción A — Por interfaz web (más fácil, recomendada)

En la página del Space, click en el tab **Files** → **+ Add file** → **Upload files**.

Subí estos 5 archivos/carpetas desde tu clon local de `agentes-claude`:

| Qué subir | De dónde sale | Cómo se llama en el Space |
|---|---|---|
| `predictive-service/Dockerfile` | el archivo | `Dockerfile` |
| `predictive-service/HF_SPACE_README.md` | el archivo | `README.md` (renombrar al subir) |
| `predictive-service/pyproject.toml` | el archivo | `pyproject.toml` |
| `predictive-service/predictive_service/` | toda la carpeta | `predictive_service/` |

⚠️ **Importante**: el `README.md` en HF Spaces tiene un frontmatter especial que le dice a HF cómo desplegar el Space. Por eso renombrás `HF_SPACE_README.md` → `README.md`.

Después de subirlo todo, click **Commit changes to main**.

#### Opción B — Por git CLI (si te sentís cómodo con git)

```bash
git clone https://huggingface.co/spaces/TU_USUARIO/timesfm-sidecar
cd timesfm-sidecar
cp /ruta/a/agentes-claude/predictive-service/Dockerfile .
cp /ruta/a/agentes-claude/predictive-service/HF_SPACE_README.md ./README.md
cp /ruta/a/agentes-claude/predictive-service/pyproject.toml .
cp -r /ruta/a/agentes-claude/predictive-service/predictive_service .
git add .
git commit -m "Initial sidecar"
git push
```

(Si HF te pide credenciales, generá un token en https://huggingface.co/settings/tokens con permiso "write".)

### 2.3 Esperar el build

El Space ahora muestra un log de build. **Tarda 5-10 minutos la primera vez** (descarga PyTorch, instala TimesFM, descarga el modelo). Ves logs en vivo en la pestaña **Logs**.

Cuando ves "Application startup complete" y el badge del Space pasa a **Running** (verde), está listo.

### 2.4 Anotar la URL del Space

Va a ser:

```
https://TU_USUARIO-timesfm-sidecar.hf.space
```

(Reemplazá `TU_USUARIO` y `timesfm-sidecar` por lo que pusiste.)

Probá que funciona abriendo en el navegador:

```
https://TU_USUARIO-timesfm-sidecar.hf.space/healthz
```

Debería devolver algo como `{"status":"ok","model":"google/timesfm-2.0-500m-pytorch", ...}`. Si dice `loading`, esperá 1 minuto más.

Guardá esta URL para el Paso 3.

---

## Paso 3 — Deploy a Vercel (10 min)

### 3.1 Cuenta y conexión con el repo

1. Andá a **https://vercel.com** y creá cuenta con tu GitHub.
2. En el dashboard, click **Add New...** → **Project**.
3. Vercel lista tus repos de GitHub. Buscá `agentes-claude` → click **Import**.

### 3.2 Configurar el proyecto

En la pantalla "Configure Project":

- **Project Name**: lo que quieras.
- **Framework Preset**: Next.js (Vercel debería detectarlo solo).
- **Root Directory**: click **Edit** → seleccioná `web`. ⚠️ Importante.
- **Build Command**: dejá el default (`next build --webpack`).
- **Output Directory**: default.
- **Install Command**: cambialo a `pnpm install --filter agentes-claude-web...`. Esto le dice a pnpm que solo instale las deps del workspace `web` (más rápido).

### 3.3 Environment Variables

Expandí la sección "Environment Variables" y agregá estas 4 (todas para "All environments"):

| Name | Value |
|---|---|
| `GROQ_API_KEY` | la clave del Paso 1 (`gsk_...`) |
| `GROQ_MODEL` | `llama-3.1-8b-instant` |
| `PREDICTIVE_SERVICE_URL` | la URL del Paso 2 (`https://TU_USUARIO-timesfm-sidecar.hf.space`) |
| `NODE_ENV` | `production` |

(Opcional: `RATE_LIMIT_PER_IP=10` y `RATE_LIMIT_WINDOW_MS=600000` para ajustar el freno.)

### 3.4 Deploy

Click **Deploy**. Vercel buildea en ~2 minutos. Cuando termine te muestra:

```
🎉 Congratulations!
https://tu-app-xxx.vercel.app
```

Click en la URL. Deberías ver el agente predictivo. Arriba a la derecha verás dos badges: **TimesFM** y **Groq**. Si ambos están verdes, estás listo para usar.

---

## Probar end-to-end

1. Abrí tu URL pública.
2. La página viene con una serie de ejemplo precargada.
3. Click **Predecir**.
4. En unos 5-15 segundos deberías ver:
   - El panel lateral pintando los pasos del agente uno a uno.
   - El chart con histórico + forecast con bandas P10-P90.
   - El texto de interpretación abajo en español.

---

## Si algo falla

### El badge de Groq está rojo

- Abrí `https://tu-app.vercel.app/api/health` directo en el navegador. Vas a ver el error en el JSON.
- Errores comunes:
  - `GROQ_API_KEY invalida` → la copiaste mal. Regenerá una en https://console.groq.com/keys y actualizala en Vercel (Settings → Environment Variables → editar → redeploy).
  - `no expone el modelo` → revisá que `GROQ_MODEL` esté seteado a uno valido. `llama-3.1-8b-instant` siempre funciona.

### El badge de TimesFM está rojo

- Andá a tu Space en huggingface.co. Si dice **Sleeping**, click "Restart" — tarda 1-2 min en despertar y otros 1-2 min en cargar el modelo. Las siguientes llamadas son rápidas.
- Si dice **Error** en el badge del Space, revisá los Logs del Space — usualmente es un problema de memoria (probá con menos `horizon`).
- Si responde pero lento, es normal: HF free tier es CPU only.

### "Demasiadas predicciones desde esta IP"

El rate limit te frenó. Por default son 10 predicciones cada 10 minutos por IP. Si querés aflojarlo, en Vercel: Settings → Environment Variables → cambiá `RATE_LIMIT_PER_IP` a un número mayor.

### El Space se duerme y la primera llamada tarda mucho

Es esperado en el tier gratuito de HF Spaces (sleep tras 48h de inactividad). Soluciones:

- **Aceptarlo**: la primera persona en usar la app por la mañana espera 2 min. Las siguientes son rápidas.
- **Upgrade a HF Spaces "Always on"**: $9/mes.
- **Mantenerlo despierto con un cron**: usá [cron-job.org](https://cron-job.org) o GitHub Actions para hacer un GET a `/healthz` cada 12h. Gratis, evita el sleep.

---

## Costos reales (resumen)

| Servicio | Tier | Costo | Limite practico |
|---|---|---|---|
| Vercel | Hobby | $0 | 100 GB-h serverless/mes, suficiente para uso personal |
| Groq | Free | $0 | 14,400 req/día, 30 req/min — alcanza si no es viral |
| Hugging Face Spaces | Free | $0 | 16GB RAM, CPU only, sleep tras 48h sin uso |
| **Total** | | **$0/mes** | |

Si esto se vuelve algo serio (>100 usuarios diarios), los upgrades naturales son:

- Vercel Pro: $20/mes (analytics + más recursos)
- HF Spaces upgrade a CPU upgrade + persistent storage: ~$5-10/mes
- Groq: tier pago aún más generoso o cambiar a Together.ai / Fireworks por más volumen

---

## Re-deploys

Cada vez que hagas commit a la rama default (`main` o equivalente) en GitHub, **Vercel redespliega solo**.

Para el sidecar Python, cada vez que cambies algo en `predictive-service/`, tenés que subirlo de nuevo al Space (Opción A o B del Paso 2.2). HF Spaces redepliega automático cuando hay un commit nuevo.

---

## Volver a usar local

Si querés volver a correrlo en tu PC sin tocar los servicios online: en local NO seteás `GROQ_API_KEY`, y el agente cae automaticamente a Ollama local. Necesitás `ollama serve` + `pnpm predict:up` + `pnpm web:dev` como en el setup local clásico.

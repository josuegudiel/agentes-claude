# Scanner agent

Agente de clasificacion de documentos escaneados. Recibe una imagen
capturada con la camara de un movil (o subida desde disco) y devuelve un
JSON con:

- `documentType` — categoria fija (DNI, factura, recibo, contrato, ...).
- `language` — codigo ISO 639-1 del idioma detectado.
- `title` — titulo visible si lo hay.
- `summary` — descripcion breve, **no transcribe el contenido**.
- `suggestedFilename` — slug seguro (`a-zA-Z0-9_-`).
- `confidence` — 0..1.

## Por que existe

La pagina `/scanner` (UI tipo CamScanner, en `web/app/scanner/`) hace todo
el trabajo de captura, crop, filtros y export en cliente — pero necesita
algo de inteligencia para sugerir nombre de archivo y categorizar la
captura. Eso lo resuelve este agente.

## Como se invoca

Desde el browser:

```ts
const res = await fetch('/api/scan/identify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' }),
});
const { classification } = await res.json();
```

Desde Node (script o test):

```ts
import { runScannerAgent } from './src/agents/scanner/index.js';

const out = await runScannerAgent({
  imageBase64: fs.readFileSync('doc.jpg').toString('base64'),
  mimeType: 'image/jpeg',
});
console.log(out.classification);
```

## Diseno

- **Single-shot**, sin tool calling. La tarea es "imagen -> JSON"; un solo
  turn de Claude Vision con `temperature: 0` y `maxTokens: 600`.
- Validamos input y output con `zod`. Si el modelo devuelve algo que no
  cumple el schema, lanzamos en vez de propagar basura.
- El system prompt prohibe transcribir contenido sensible y obliga al
  modelo a usar categorias genericas en `suggestedFilename` (nunca nombres
  de persona).

## Variables de entorno

- `ANTHROPIC_API_KEY` — requerido.
- `AGENT_MODEL` — opcional, default `claude-sonnet-4-6`. Sonnet es
  suficiente para clasificacion; no hace falta Opus.

## Limites

- Tamano maximo de imagen aceptado por el endpoint: 6 MB en base64
  (~4.5 MB binario). El cliente redimensiona antes de enviar para no
  saturarse.
- No hace OCR completo. Si quieres extraer texto, usa otra herramienta
  (Tesseract en cliente, o un endpoint separado).

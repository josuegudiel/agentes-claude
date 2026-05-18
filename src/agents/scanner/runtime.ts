import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { logger } from '../../core/logger.js';
import {
  SCANNER_SYSTEM_PROMPT,
  SCANNER_USER_PROMPT,
} from './prompts.js';
import {
  ScanIdentifyInputSchema,
  ScanIdentifySchema,
  type ScanIdentifyInput,
  type ScanIdentifyResult,
} from './schema.js';

/**
 * Runtime del agente scanner. Single-shot: una llamada a Claude vision con
 * la imagen y obtenemos el JSON de clasificacion.
 *
 * No usamos tool calling porque la tarea es pura "input image -> JSON":
 *   - Mas barato (un solo turn).
 *   - Mas rapido (latencia critica para una app movil).
 *   - Mas facil de testear con un mock simple del SDK.
 *
 * Si el modelo no devuelve JSON valido (raro con Sonnet 4.6+), tiramos un
 * Error que el API route convierte en HTTP 502. El caller decide si reintentar.
 */

export interface ScannerAgentOptions extends ScanIdentifyInput {
  /** Override del modelo. Default: env AGENT_MODEL o claude-sonnet-4-6. */
  model?: string;
}

export interface ScannerAgentResult {
  classification: ScanIdentifyResult;
  model: string;
  latencyMs: number;
}

const DEFAULT_MODEL =
  process.env.AGENT_MODEL?.trim() || 'claude-sonnet-4-6';

export async function runScannerAgent(
  opts: ScannerAgentOptions,
): Promise<ScannerAgentResult> {
  const parsedInput = ScanIdentifyInputSchema.parse(opts);

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no esta configurado');
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const log = logger.child({ component: 'scanner.runtime', model });
  const t0 = Date.now();

  log.info(
    {
      mimeType: parsedInput.mimeType,
      bytes: Math.round((parsedInput.imageBase64.length * 3) / 4),
      hasHint: Boolean(parsedInput.hint),
    },
    'Clasificando documento',
  );

  // El AI SDK acepta `image` como string base64 o Uint8Array. Pasamos el
  // mimeType para que el provider Anthropic lo serialice como image_block.
  const result = await generateText({
    model: anthropic(model),
    system: SCANNER_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: SCANNER_USER_PROMPT(parsedInput.hint) },
          {
            type: 'image',
            image: parsedInput.imageBase64,
            mimeType: parsedInput.mimeType,
          },
        ],
      },
    ],
    temperature: 0,
    maxTokens: 600,
  });

  const text = result.text.trim();
  const json = extractJson(text);
  if (!json) {
    log.warn({ text }, 'Respuesta del modelo no contiene JSON');
    throw new Error('El modelo no devolvio JSON valido');
  }

  const classification = ScanIdentifySchema.parse(json);
  const latencyMs = Date.now() - t0;

  log.info(
    {
      documentType: classification.documentType,
      confidence: classification.confidence,
      latencyMs,
    },
    'Documento clasificado',
  );

  return { classification, model, latencyMs };
}

/**
 * El modelo a veces envuelve el JSON en ```json ... ``` aunque le pidamos
 * que no lo haga. Toleramos ambos casos.
 */
function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const candidate = fenced?.[1] ?? text;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

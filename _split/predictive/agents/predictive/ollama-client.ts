import { z } from 'zod';
import { logger } from '../../core/logger.js';
import { AppError } from '../../core/errors.js';
import type { ChatClient } from './chat-client.js';

// Defaults inline (no via core/config.ts) para que el agente predictivo
// pueda correr en contextos donde las env vars de Playwright no aplican
// (ej: Next.js API routes, CI minimo, etc.).
const DEFAULT_BASE_URL = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
const DEFAULT_MODEL = process.env['OLLAMA_MODEL'] ?? 'llama3.1:8b';
const DEFAULT_TIMEOUT_MS = Number(process.env['OLLAMA_TIMEOUT_MS'] ?? 120_000);

/**
 * Cliente minimo a Ollama (https://ollama.com).
 *
 * Usamos solo dos endpoints del HTTP API:
 *   - POST /api/chat       -> conversacion (lo que usa el agente para tools)
 *   - POST /api/generate   -> oneshot (lo usamos para interpretar forecasts)
 *
 * No usamos la libreria `ollama` npm porque:
 *   1. Una dependencia mas, sin valor frente a fetch.
 *   2. Queremos zod-validar las respuestas igual que con TimesFM.
 *
 * Tool calling: Ollama soporta tool calls nativos en modelos compatibles
 * (llama3.1, qwen2.5, mistral-nemo). Si el modelo no soporta tools, el
 * runtime cae a un loop manual con prompt JSON-mode.
 */

const OllamaToolCallSchema = z.object({
  function: z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
});

const OllamaMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  tool_calls: z.array(OllamaToolCallSchema).optional(),
});

const OllamaChatResponseSchema = z.object({
  model: z.string(),
  message: OllamaMessageSchema,
  done: z.boolean(),
  total_duration: z.number().optional(),
  eval_count: z.number().optional(),
});

const OllamaGenerateResponseSchema = z.object({
  model: z.string(),
  response: z.string(),
  done: z.boolean(),
});

export type OllamaMessage = z.infer<typeof OllamaMessageSchema>;
export type OllamaToolCall = z.infer<typeof OllamaToolCallSchema>;
export type OllamaChatResponse = z.infer<typeof OllamaChatResponseSchema>;

export interface OllamaToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OllamaChatOptions {
  messages: OllamaMessage[];
  tools?: OllamaToolDefinition[];
  format?: 'json';
  temperature?: number;
}

export class OllamaClient implements ChatClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly log = logger.child({ component: 'predictive.ollama' });

  constructor(opts?: { baseUrl?: string; model?: string; timeoutMs?: number }) {
    this.baseUrl = (opts?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.model = opts?.model ?? DEFAULT_MODEL;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get modelName(): string {
    return this.model;
  }

  async chat(opts: OllamaChatOptions): Promise<OllamaChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: opts.messages,
      stream: false,
      options: {
        temperature: opts.temperature ?? 0.2,
      },
    };
    if (opts.tools !== undefined) body['tools'] = opts.tools;
    if (opts.format !== undefined) body['format'] = opts.format;

    const json = await this.request('/api/chat', body);
    return OllamaChatResponseSchema.parse(json);
  }

  async generate(prompt: string, opts?: { format?: 'json'; temperature?: number }): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      stream: false,
      options: { temperature: opts?.temperature ?? 0.2 },
    };
    if (opts?.format !== undefined) body['format'] = opts.format;

    const json = await this.request('/api/generate', body);
    return OllamaGenerateResponseSchema.parse(json).response;
  }

  /**
   * Verifica que Ollama este corriendo y el modelo este descargado.
   * Devuelve null si todo OK; mensaje legible si no.
   */
  async preflight(): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        return `Ollama respondio ${res.status} en /api/tags`;
      }
      const data = (await res.json()) as { models?: { name: string }[] };
      const models = data.models ?? [];
      const has = models.some((m) => m.name === this.model || m.name.startsWith(`${this.model}:`));
      if (!has) {
        return `Ollama no tiene el modelo "${this.model}". Corre: ollama pull ${this.model}`;
      }
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `No pude conectar a Ollama en ${this.baseUrl}: ${msg}`;
    }
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        this.log.warn({ status: res.status, path, body: text.slice(0, 500) }, 'Ollama no-2xx');
        throw new OllamaError(`Ollama ${path} -> ${res.status}: ${text.slice(0, 200)}`, {
          status: res.status,
        });
      }
      try {
        return JSON.parse(text);
      } catch (err) {
        throw new OllamaError(`Ollama ${path} devolvio JSON invalido`, { status: 0, cause: err });
      }
    } catch (err) {
      if (err instanceof OllamaError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new OllamaError(`Ollama ${path} timeout (${this.timeoutMs}ms)`, {
          status: 0,
          cause: err,
        });
      }
      throw new OllamaError(`Ollama ${path} fallo: ${(err as Error).message}`, {
        status: 0,
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export class OllamaError extends AppError {
  override readonly name = 'OllamaError';
  readonly status: number;

  constructor(message: string, opts: { status: number; cause?: unknown }) {
    super(message, {
      code: 'OLLAMA_ERROR',
      context: { status: opts.status },
      ...(opts.cause !== undefined ? { cause: opts.cause } : {}),
    });
    this.status = opts.status;
  }
}

import { z } from 'zod';
import { logger } from '../../core/logger.js';
import { AppError } from '../../core/errors.js';
import type { ChatClient } from './chat-client.js';
import type {
  OllamaChatOptions,
  OllamaChatResponse,
  OllamaToolDefinition,
} from './ollama-client.js';

/**
 * Cliente para Groq (https://groq.com).
 *
 * Groq expone una API OpenAI-compatible (`/openai/v1/chat/completions`) con
 * tool calling estilo OpenAI. Normalizamos la respuesta al shape de
 * OllamaChatResponse para que runtime.ts no se entere de la diferencia.
 *
 * Por que Groq:
 *   - Tier gratuito generoso (~14400 requests/dia).
 *   - Velocidad: 500-800 tok/s (Ollama local: 20-50).
 *   - Soporta Llama 3.1 8B/70B con tool calling estilo OpenAI.
 *
 * Si en el futuro queremos usar otro provider OpenAI-compatible (Together,
 * Fireworks, OpenRouter), basta cambiar el baseUrl.
 */

const DEFAULT_BASE_URL = process.env['GROQ_BASE_URL'] ?? 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = process.env['GROQ_MODEL'] ?? 'llama-3.1-8b-instant';
const DEFAULT_TIMEOUT_MS = Number(process.env['GROQ_TIMEOUT_MS'] ?? 60_000);

// --- Schemas de la respuesta OpenAI-compatible de Groq -----------------------

const OpenAIToolCallSchema = z.object({
  id: z.string().optional(),
  type: z.literal('function').optional(),
  function: z.object({
    name: z.string(),
    // OpenAI manda arguments como string JSON. Lo parseamos al normalizar.
    arguments: z.string(),
  }),
});

const OpenAIMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.null()]).optional(),
  tool_calls: z.array(OpenAIToolCallSchema).optional(),
});

const OpenAIChoiceSchema = z.object({
  index: z.number().optional(),
  message: OpenAIMessageSchema,
  finish_reason: z.string().nullable().optional(),
});

const OpenAIChatResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string(),
  choices: z.array(OpenAIChoiceSchema).min(1),
});

export class GroqClient implements ChatClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly log = logger.child({ component: 'predictive.groq' });

  constructor(opts?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
  }) {
    const apiKey = opts?.apiKey ?? process.env['GROQ_API_KEY'] ?? '';
    if (!apiKey) {
      throw new GroqError('GROQ_API_KEY no esta seteada', { status: 0 });
    }
    this.apiKey = apiKey;
    this.baseUrl = (opts?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.model = opts?.model ?? DEFAULT_MODEL;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get modelName(): string {
    return this.model;
  }

  /**
   * Pinea a `/models` para validar la API key y el modelo. Mas barato que
   * mandar un chat completion solo para preflight.
   */
  async preflight(): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.status === 401) {
        return 'GROQ_API_KEY invalida (HTTP 401). Genera otra en https://console.groq.com/keys';
      }
      if (!res.ok) {
        return `Groq respondio ${res.status} en /models`;
      }
      const data = (await res.json()) as { data?: { id: string }[] };
      const models = data.data ?? [];
      const has = models.some((m) => m.id === this.model);
      if (!has) {
        const sample = models.slice(0, 5).map((m) => m.id).join(', ');
        return `Groq no expone el modelo "${this.model}". Disponibles (sample): ${sample}`;
      }
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `No pude conectar a Groq (${this.baseUrl}): ${msg}`;
    }
  }

  async chat(opts: OllamaChatOptions): Promise<OllamaChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: opts.messages.map(toOpenAIMessage),
      temperature: opts.temperature ?? 0.2,
      stream: false,
    };
    if (opts.tools !== undefined && opts.tools.length > 0) {
      body['tools'] = opts.tools.map(toOpenAITool);
      body['tool_choice'] = 'auto';
    }
    if (opts.format === 'json') {
      body['response_format'] = { type: 'json_object' };
    }

    const json = await this.request('/chat/completions', body);
    const parsed = OpenAIChatResponseSchema.parse(json);
    return normalizeResponse(parsed);
  }

  async generate(
    prompt: string,
    opts?: { format?: 'json'; temperature?: number },
  ): Promise<string> {
    const res = await this.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: opts?.temperature ?? 0.2,
      ...(opts?.format !== undefined ? { format: opts.format } : {}),
    });
    return res.message.content;
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        this.log.warn(
          { status: res.status, path, body: text.slice(0, 500) },
          'Groq no-2xx',
        );
        throw new GroqError(`Groq ${path} -> ${res.status}: ${text.slice(0, 200)}`, {
          status: res.status,
        });
      }
      try {
        return JSON.parse(text);
      } catch (err) {
        throw new GroqError(`Groq ${path} devolvio JSON invalido`, {
          status: 0,
          cause: err,
        });
      }
    } catch (err) {
      if (err instanceof GroqError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new GroqError(`Groq ${path} timeout (${this.timeoutMs}ms)`, {
          status: 0,
          cause: err,
        });
      }
      throw new GroqError(`Groq ${path} fallo: ${(err as Error).message}`, {
        status: 0,
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

// --- Normalizadores OpenAI <-> Ollama ----------------------------------------

function toOpenAIMessage(
  m: OllamaChatOptions['messages'][number],
): Record<string, unknown> {
  if (m.role === 'tool') {
    // OpenAI/Groq quiere tool messages con tool_call_id. Como Ollama no nos
    // da uno y el modelo no nos lo pide para correlacionar, ponemos un id
    // sintetico. Funciona en Groq porque el id es opaco para el modelo.
    return { role: 'tool', content: m.content, tool_call_id: 'call_synthetic' };
  }
  const out: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.tool_calls !== undefined) {
    out['tool_calls'] = m.tool_calls.map((tc, i) => ({
      id: `call_${i}`,
      type: 'function',
      function: {
        name: tc.function.name,
        arguments:
          typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments),
      },
    }));
  }
  return out;
}

function toOpenAITool(t: OllamaToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  };
}

function normalizeResponse(
  res: z.infer<typeof OpenAIChatResponseSchema>,
): OllamaChatResponse {
  const choice = res.choices[0];
  if (!choice) {
    throw new GroqError('Groq devolvio choices vacio', { status: 0 });
  }
  const msg = choice.message;
  return {
    model: res.model,
    message: {
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : '',
      ...(msg.tool_calls && msg.tool_calls.length > 0
        ? {
            tool_calls: msg.tool_calls.map((tc) => ({
              function: {
                name: tc.function.name,
                arguments: parseToolArgs(tc.function.arguments),
              },
            })),
          }
        : {}),
    },
    done: true,
  };
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
    return { _raw: raw };
  } catch {
    return { _raw: raw };
  }
}

export class GroqError extends AppError {
  override readonly name = 'GroqError';
  readonly status: number;

  constructor(message: string, opts: { status: number; cause?: unknown }) {
    super(message, {
      code: 'GROQ_ERROR',
      context: { status: opts.status },
      ...(opts.cause !== undefined ? { cause: opts.cause } : {}),
    });
    this.status = opts.status;
  }
}

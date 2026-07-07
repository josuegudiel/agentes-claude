import { logger } from '../../core/logger.js';
import { AppError } from '../../core/errors.js';
import { withRetry } from '../../core/retry.js';
import { TavilyResponseSchema, type TavilyResponse } from './schema.js';

// Defaults inline (no via core/config.ts) — ver explicacion en ollama-client.ts.
const TAVILY_URL = process.env['TAVILY_BASE_URL'] ?? 'https://api.tavily.com/search';
const DEFAULT_TIMEOUT_MS = Number(process.env['TAVILY_TIMEOUT_MS'] ?? 15_000);

export function isTavilyConfigured(): boolean {
  return Boolean(process.env['TAVILY_API_KEY']);
}

export class TavilyError extends AppError {
  override readonly name = 'TavilyError';
  readonly status: number;

  constructor(message: string, opts: { status: number; cause?: unknown }) {
    super(message, {
      code: 'TAVILY_ERROR',
      context: { status: opts.status },
      ...(opts.cause !== undefined ? { cause: opts.cause } : {}),
    });
    this.status = opts.status;
  }
}

/**
 * Cliente minimo a la API de busqueda de Tavily. Mismas reglas que
 * timesfm-client: reintenta SOLO 5xx/red, nunca 4xx; Zod en el response.
 */
export class TavilyClient {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly log = logger.child({ component: 'geo-auditor.tavily' });

  constructor(opts?: { apiKey?: string; timeoutMs?: number }) {
    const key = opts?.apiKey ?? process.env['TAVILY_API_KEY'];
    if (!key) {
      throw new TavilyError('TAVILY_API_KEY no configurada', { status: 0 });
    }
    this.apiKey = key;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async search(
    query: string,
    opts?: { maxResults?: number; signal?: AbortSignal },
  ): Promise<TavilyResponse> {
    const json = await withRetry(() => this.request(query, opts?.maxResults ?? 8, opts?.signal), {
      retries: 2,
      minDelayMs: 750,
      maxDelayMs: 5_000,
      shouldRetry: (err) => {
        // No reintentar si el llamante aborto (cliente desconectado).
        if (opts?.signal?.aborted) return false;
        if (!(err instanceof TavilyError)) return true;
        return err.status >= 500 || err.status === 0;
      },
    });
    return TavilyResponseSchema.parse(json);
  }

  private async request(
    query: string,
    maxResults: number,
    externalSignal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = (): void => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const res = await fetch(TAVILY_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          max_results: maxResults,
        }),
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        this.log.warn({ status: res.status, query }, 'Tavily no-2xx');
        throw new TavilyError(`Tavily respondio ${res.status}: ${text.slice(0, 200)}`, {
          status: res.status,
        });
      }
      return JSON.parse(text) as unknown;
    } catch (err) {
      if (err instanceof TavilyError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TavilyError(`Tavily timeout (${this.timeoutMs}ms)`, { status: 0, cause: err });
      }
      throw new TavilyError(`Tavily fallo: ${(err as Error).message}`, {
        status: 0,
        cause: err,
      });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onAbort);
    }
  }
}

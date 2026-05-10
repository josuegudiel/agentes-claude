import { config } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import { AppError } from '../../core/errors.js';
import { withRetry } from '../../core/retry.js';
import {
  type ForecastRequest,
  ForecastResponseSchema,
  type ForecastResponse,
  HealthResponseSchema,
  type HealthResponse,
} from './schema.js';

/**
 * Cliente HTTP minimo al sidecar Python (predictive-service/).
 *
 * Reglas:
 *   - Reintenta SOLO errores de red / 5xx. Nunca reintenta 4xx (validacion).
 *   - Timeout configurable por env (PREDICTIVE_SERVICE_TIMEOUT_MS).
 *   - Validacion zod en el response: si TimesFM cambia el shape, fallamos
 *     con un error claro en vez de propagar `any`.
 */
export class TimesFMClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly log = logger.child({ component: 'predictive.timesfm' });

  constructor(opts?: { baseUrl?: string; timeoutMs?: number }) {
    this.baseUrl = (opts?.baseUrl ?? config.PREDICTIVE_SERVICE_URL).replace(/\/$/, '');
    this.timeoutMs = opts?.timeoutMs ?? config.PREDICTIVE_SERVICE_TIMEOUT_MS;
  }

  async health(): Promise<HealthResponse> {
    const json = await this.request('GET', '/healthz', undefined);
    return HealthResponseSchema.parse(json);
  }

  async forecast(req: ForecastRequest): Promise<ForecastResponse> {
    const json = await withRetry(
      () => this.request('POST', '/forecast', req),
      {
        retries: 2,
        minDelayMs: 750,
        maxDelayMs: 5_000,
        shouldRetry: (err) => {
          if (!(err instanceof PredictiveServiceError)) return true;
          // No reintentar 4xx (input invalido). Si reintenta significa
          // problema transitorio del sidecar.
          return err.status >= 500 || err.status === 0;
        },
      },
    );
    return ForecastResponseSchema.parse(json);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const init: RequestInit = {
        method,
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      const res = await fetch(url, init);

      const text = await res.text();
      const parsed: unknown = text ? safeJson(text) : null;

      if (!res.ok) {
        const detail =
          parsed && typeof parsed === 'object' && 'detail' in parsed
            ? String((parsed as { detail: unknown }).detail)
            : text || res.statusText;
        this.log.warn({ status: res.status, detail, path }, 'predictive-service no-2xx');
        throw new PredictiveServiceError(
          `predictive-service ${method} ${path} -> ${res.status}: ${detail}`,
          { status: res.status },
        );
      }

      return parsed;
    } catch (err) {
      if (err instanceof PredictiveServiceError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new PredictiveServiceError(
          `predictive-service ${method} ${path} timeout (${this.timeoutMs}ms)`,
          { status: 0, cause: err },
        );
      }
      throw new PredictiveServiceError(
        `predictive-service ${method} ${path} fallo: ${(err as Error).message}`,
        { status: 0, cause: err },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export class PredictiveServiceError extends AppError {
  override readonly name = 'PredictiveServiceError';
  readonly status: number;

  constructor(message: string, opts: { status: number; cause?: unknown }) {
    super(message, {
      code: 'PREDICTIVE_SERVICE_ERROR',
      context: { status: opts.status },
      ...(opts.cause !== undefined ? { cause: opts.cause } : {}),
    });
    this.status = opts.status;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

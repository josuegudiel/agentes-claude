import { logger } from './logger.js';
import { TimeoutError } from './errors.js';

export interface RetryOptions {
  retries?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  signal?: AbortSignal;
}

const DEFAULTS: Required<Omit<RetryOptions, 'shouldRetry' | 'onRetry' | 'signal'>> = {
  retries: 3,
  minDelayMs: 500,
  maxDelayMs: 8_000,
  factor: 2,
};

/**
 * Retry con backoff exponencial + jitter.
 * Lo que NO hace: no reintenta errores deterministas (validacion, auth).
 * Pasa `shouldRetry` para filtrar.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const o = { ...DEFAULTS, ...opts };
  let lastErr: unknown;

  for (let attempt = 1; attempt <= o.retries + 1; attempt++) {
    if (opts.signal?.aborted) {
      throw new TimeoutError('Operacion abortada antes de completarse', { code: 'ABORTED' });
    }

    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = attempt === o.retries + 1;
      const retry = opts.shouldRetry ? opts.shouldRetry(err, attempt) : true;

      if (isLast || !retry) throw err;

      const base = Math.min(o.maxDelayMs, o.minDelayMs * Math.pow(o.factor, attempt - 1));
      const jitter = Math.random() * base * 0.3;
      const delay = Math.floor(base + jitter);

      logger.warn(
        { attempt, delayMs: delay, err: errSummary(err) },
        'Reintentando tras error',
      );
      opts.onRetry?.(err, attempt, delay);
      await sleep(delay, opts.signal);
    }
  }

  throw lastErr;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TimeoutError('Sleep abortado', { code: 'ABORTED' }));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new TimeoutError('Sleep abortado', { code: 'ABORTED' }));
    });
  });
}

function errSummary(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

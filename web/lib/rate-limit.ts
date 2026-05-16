/**
 * Rate limiter en memoria. Suficiente para una sola instancia Vercel hobby
 * (las funciones serverless reusan el proceso por unos minutos).
 *
 * Si la app crece a multi-instance / multi-region, cambiar el backend a
 * Vercel KV / Upstash Redis. La firma de checkRateLimit() queda igual.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Cuantas requests por ventana. Default 10. */
  limit?: number;
  /** Ventana en ms. Default 10 minutos. */
  windowMs?: number;
}

export function checkRateLimit(key: string, opts: RateLimitOptions = {}): RateLimitResult {
  const limit = opts.limit ?? 10;
  const windowMs = opts.windowMs ?? 10 * 60 * 1000;
  const now = Date.now();

  // Lazy cleanup de buckets viejos para no hacer crecer la memoria infinitamente.
  // Hago O(1) por llamada (no escaneo todo el map cada vez).
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt };
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { ok: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

/**
 * Extrae el identificador del cliente para usar como key del rate limit.
 * Prefiere x-forwarded-for (Vercel proxy) sobre cualquier otro.
 */
export function clientKey(req: Request): string {
  const h = req.headers;
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const real = h.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

/** Solo para tests: limpia el estado entre runs. */
export function _resetRateLimit(): void {
  buckets.clear();
}

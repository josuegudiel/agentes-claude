/**
 * Rate limiter en memoria. Suficiente para una sola instancia Vercel hobby
 * (las funciones serverless reusan el proceso por unos minutos).
 *
 * LIMITACION conocida: bajo varias instancias concurrentes o tras un cold
 * start, el contador NO es global — el limite anunciado es best-effort, no
 * estricto. Para un limite duro pasar el backend a Vercel KV / Upstash Redis
 * (la firma de checkRateLimit() queda igual).
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
 * Extrae el identificador del cliente para el rate limit.
 *
 * Seguridad: NO se usa el primer valor de x-forwarded-for — el cliente lo
 * controla y puede rotar IPs falsas para evadir el limite. Se prefieren las
 * cabeceras que inyecta el proxy de confianza (Vercel/plataforma) y, si solo
 * hay x-forwarded-for, se toma el ULTIMO hop (el que anadio el proxy), que no
 * es spoofeable por el cliente.
 */
export function clientKey(req: Request): string {
  const h = req.headers;
  const trusted = h.get('x-real-ip') ?? h.get('x-vercel-forwarded-for');
  if (trusted) return trusted.trim();
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]!;
  }
  return 'unknown';
}

/** Solo para tests: limpia el estado entre runs. */
export function _resetRateLimit(): void {
  buckets.clear();
}

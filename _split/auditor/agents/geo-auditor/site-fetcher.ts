import { lookup } from 'node:dns/promises';
import { logger } from '../../core/logger.js';
import { AppError } from '../../core/errors.js';

// Defaults inline (no via core/config.ts) — ver explicacion en ollama-client.ts.
const DEFAULT_TIMEOUT_MS = Number(process.env['AUDITOR_FETCH_TIMEOUT_MS'] ?? 15_000);
const AUX_TIMEOUT_MS = 8_000;
export const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2MB

const USER_AGENT =
  'Mozilla/5.0 (compatible; GeoAuditorBot/1.0; auditoria GEO/SEO solicitada por el usuario)';

/**
 * Fetch plano del sitio a auditar (sin Playwright: corre en Vercel).
 * Lo que se obtiene aqui es lo mismo que ve un crawler de IA sin JS.
 */

export type AuxStatus = 'ok' | 'missing' | 'error';

export interface FetchedSite {
  requestedUrl: string;
  finalUrl: string;
  html: string;
  htmlBytes: number;
  truncated: boolean;
  robotsTxt: { status: 'ok'; content: string } | { status: 'missing' } | { status: 'error' };
  sitemap: AuxStatus;
  llmsTxt: AuxStatus;
}

export class SiteFetchError extends AppError {
  override readonly name = 'SiteFetchError';

  constructor(message: string, opts: { code: string; cause?: unknown }) {
    super(message, opts);
  }
}

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i, // IPv6 ULA
];

/**
 * Rangos IP privados/reservados a nivel de OCTETOS ya resueltos — esto
 * cierra el DNS rebinding (evil.com -> 169.254.169.254) que el chequeo de
 * STRING del hostname no puede ver.
 */
function isPrivateIp(ip: string): boolean {
  // IPv6 (incluye ::ffff:a.b.c.d mapeadas).
  if (ip.includes(':')) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fe80:') || low.startsWith('fc') || low.startsWith('fd')) return true;
    const m = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]!);
    return false;
  }
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = o as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reservado
  return false;
}

/** Guard anti-SSRF por STRING: bloquea hosts internos evidentes. */
export function assertPublicHost(url: URL): void {
  const host = url.hostname;
  if (PRIVATE_HOST_PATTERNS.some((p) => p.test(host))) {
    throw new SiteFetchError(`Host no permitido para auditoria: ${host}`, {
      code: 'PRIVATE_HOST',
    });
  }
  if (!host.includes('.')) {
    throw new SiteFetchError(`Host invalido: ${host}`, { code: 'BAD_HOST' });
  }
}

/**
 * Guard anti-SSRF por IP RESUELTA: valida que TODAS las direcciones a las
 * que resuelve el host sean publicas. Cierra el DNS rebinding. Se permite
 * inyectar el resolver para test (default: dns.lookup del OS).
 */
export async function assertPublicResolved(
  url: URL,
  resolver: (host: string) => Promise<string[]> = defaultResolve,
): Promise<void> {
  assertPublicHost(url);
  // Si el host ya es un literal IP, assertPublicHost + isPrivateIp bastan.
  let ips: string[];
  try {
    ips = await resolver(url.hostname);
  } catch {
    throw new SiteFetchError(`No se pudo resolver ${url.hostname}`, { code: 'DNS' });
  }
  if (ips.length === 0 || ips.some(isPrivateIp)) {
    throw new SiteFetchError(`Host resuelve a una IP no permitida: ${url.hostname}`, {
      code: 'PRIVATE_IP',
    });
  }
}

async function defaultResolve(host: string): Promise<string[]> {
  const res = await lookup(host, { all: true });
  return res.map((r) => r.address);
}

/** Maximo de saltos de redirect a seguir (cada uno re-validado). */
const MAX_REDIRECTS = 5;

export async function fetchSite(
  rawUrl: string,
  opts?: { timeoutMs?: number; resolver?: (host: string) => Promise<string[]> },
): Promise<FetchedSite> {
  const log = logger.child({ component: 'geo-auditor.fetch' });
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolver = opts?.resolver;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SiteFetchError(`URL invalida: ${rawUrl}`, { code: 'BAD_URL' });
  }
  await assertPublicResolved(url, resolver);

  const { html, finalUrl, truncated } = await fetchHtml(url, timeoutMs, resolver);
  // debug y no info: el CLI escribe su propio progreso en stdout y un INFO
  // de pino por cada fetch se intercalaria en medio de esas lineas.
  log.debug({ url: url.href, finalUrl, bytes: html.length, truncated }, 'HTML descargado');

  // Los auxiliares se buscan en el origen FINAL (tras redirects www/https).
  const origin = new URL(finalUrl).origin;
  const [robotsTxt, sitemap, llmsTxt] = await Promise.all([
    fetchRobots(`${origin}/robots.txt`, resolver),
    fetchAuxStatus(`${origin}/sitemap.xml`, resolver),
    fetchAuxStatus(`${origin}/llms.txt`, resolver),
  ]);

  return {
    requestedUrl: rawUrl,
    finalUrl,
    html,
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    truncated,
    robotsTxt,
    sitemap,
    llmsTxt,
  };
}

async function fetchHtml(
  url: URL,
  timeoutMs: number,
  resolver?: (host: string) => Promise<string[]>,
): Promise<{ html: string; finalUrl: string; truncated: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Redirect MANUAL: seguir cada salto validando host+IP resuelta. Con
    // redirect:'follow' undici saltaria a un host interno sin re-chequear
    // (el bypass clasico de SSRF: 302 -> http://169.254.169.254/...).
    let current = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(current.href, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
        signal: controller.signal,
        redirect: 'manual',
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await res.body?.cancel();
        if (!loc) break;
        if (hop === MAX_REDIRECTS) {
          throw new SiteFetchError('Demasiados redirects.', { code: 'TOO_MANY_REDIRECTS' });
        }
        current = new URL(loc, current);
        await assertPublicResolved(current, resolver); // re-valida CADA salto
        continue;
      }
      break;
    }

    if (!res) throw new SiteFetchError('Sin respuesta.', { code: 'NO_RESPONSE' });
    if (!res.ok) {
      throw new SiteFetchError(
        `El sitio respondio HTTP ${res.status} (${res.statusText || 'sin detalle'}).`,
        { code: `HTTP_${res.status}` },
      );
    }

    const { text, truncated } = await readCapped(res, MAX_HTML_BYTES);
    return { html: text, finalUrl: current.href, truncated };
  } catch (err) {
    if (err instanceof SiteFetchError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SiteFetchError(`El sitio no respondio en ${timeoutMs}ms.`, {
        code: 'TIMEOUT',
        cause: err,
      });
    }
    throw new SiteFetchError(`No se pudo conectar con ${url.hostname}: ${(err as Error).message}`, {
      code: 'DNS',
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Lee el body por chunks hasta el cap; cancela el resto si se excede. */
async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) {
    const text = await res.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > maxBytes) {
        const keep = value.byteLength - (received - maxBytes);
        chunks.push(value.slice(0, keep));
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  }

  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

async function fetchRobots(
  url: string,
  resolver?: (host: string) => Promise<string[]>,
): Promise<FetchedSite['robotsTxt']> {
  try {
    const res = await fetchAux(url, resolver);
    if (res.ok) {
      const { text } = await readCapped(res, 256 * 1024);
      return { status: 'ok', content: text };
    }
    if (res.status === 404 || res.status === 410) return { status: 'missing' };
    return { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

async function fetchAuxStatus(
  url: string,
  resolver?: (host: string) => Promise<string[]>,
): Promise<AuxStatus> {
  try {
    const res = await fetchAux(url, resolver);
    // Drenar/cancelar el body para no dejar la conexion abierta.
    await res.body?.cancel();
    if (res.ok) return 'ok';
    if (res.status === 404 || res.status === 410) return 'missing';
    return 'error';
  } catch {
    return 'error';
  }
}

async function fetchAux(
  url: string,
  resolver?: (host: string) => Promise<string[]>,
): Promise<Response> {
  // El origen ya fue validado en fetchSite, pero los auxiliares son URLs
  // nuevas: re-validar host+IP. redirect:'manual' -> no seguimos saltos
  // en auxiliares (si redirigen, lo tratamos como no disponible).
  await assertPublicResolved(new URL(url), resolver);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUX_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'manual',
    });
  } finally {
    clearTimeout(timer);
  }
}

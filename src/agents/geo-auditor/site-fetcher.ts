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

/** Guard anti-SSRF: nunca auditar hosts internos desde el servidor. */
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

export async function fetchSite(
  rawUrl: string,
  opts?: { timeoutMs?: number },
): Promise<FetchedSite> {
  const log = logger.child({ component: 'geo-auditor.fetch' });
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SiteFetchError(`URL invalida: ${rawUrl}`, { code: 'BAD_URL' });
  }
  assertPublicHost(url);

  const { html, finalUrl, truncated } = await fetchHtml(url, timeoutMs);
  log.info({ url: url.href, finalUrl, bytes: html.length, truncated }, 'HTML descargado');

  // Los auxiliares se buscan en el origen FINAL (tras redirects www/https).
  const origin = new URL(finalUrl).origin;
  const [robotsTxt, sitemap, llmsTxt] = await Promise.all([
    fetchRobots(`${origin}/robots.txt`),
    fetchAuxStatus(`${origin}/sitemap.xml`),
    fetchAuxStatus(`${origin}/llms.txt`),
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
): Promise<{ html: string; finalUrl: string; truncated: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.href, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!res.ok) {
      throw new SiteFetchError(
        `El sitio respondio HTTP ${res.status} (${res.statusText || 'sin detalle'}).`,
        { code: `HTTP_${res.status}` },
      );
    }

    const { text, truncated } = await readCapped(res, MAX_HTML_BYTES);
    return { html: text, finalUrl: res.url || url.href, truncated };
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

async function fetchRobots(url: string): Promise<FetchedSite['robotsTxt']> {
  try {
    const res = await fetchAux(url);
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

async function fetchAuxStatus(url: string): Promise<AuxStatus> {
  try {
    const res = await fetchAux(url);
    // Drenar/cancelar el body para no dejar la conexion abierta.
    await res.body?.cancel();
    if (res.ok) return 'ok';
    if (res.status === 404 || res.status === 410) return 'missing';
    return 'error';
  } catch {
    return 'error';
  }
}

async function fetchAux(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUX_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

import { lookup } from 'node:dns/promises';
import { lookup as dnsLookupCb } from 'node:dns';
import { isIP } from 'node:net';
// fetch + Agent del MISMO undici: el fetch global de Node usa su undici interno
// y rechaza un dispatcher de otra version ("invalid onRequestStart method").
import { Agent, fetch as undiciFetch } from 'undici';
import { logger } from '../../core/logger.js';
import { AppError } from '../../core/errors.js';

// Defaults inline (no via core/config.ts) — ver explicacion en ollama-client.ts.
const DEFAULT_TIMEOUT_MS = Number(process.env['AUDITOR_FETCH_TIMEOUT_MS'] ?? 15_000);
const AUX_TIMEOUT_MS = 8_000;
export const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_REDIRECTS = 5;

const USER_AGENT =
  'Mozilla/5.0 (compatible; GeoAuditorBot/1.0; auditoria GEO/SEO solicitada por el usuario)';

/**
 * Fetch plano del sitio a auditar (sin Playwright: corre en Vercel).
 * Lo que se obtiene aqui es lo mismo que ve un crawler de IA sin JS.
 *
 * Seguridad (anti-SSRF): la URL la controla el usuario, asi que cada salto
 * de red se valida. No basta con mirar el string del host de la URL inicial:
 *   1. Se resuelve el host por DNS y se validan TODAS las IPs contra rangos
 *      privados/loopback/link-local (v4 y v6) antes de conectar.
 *   2. Los redirects se siguen a mano (redirect:'manual') revalidando cada
 *      Location, para que un 302 hacia 127.0.0.1 / 169.254.169.254 no evada
 *      el guard.
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

/** Hosts textualmente internos (atajo barato antes de resolver DNS). */
const PRIVATE_HOST_PATTERNS: RegExp[] = [/^localhost$/i, /\.local$/i, /\.internal$/i];

/** Comprueba si una IP (v4 o v6) cae en un rango no enrutable/interno. */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) return isPrivateIpv6(ip);
  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // formato raro -> tratar como no confiable
  }
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (metadata cloud)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 (benchmarking)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast / reservado / 240/4
  return false;
}

/** Extrae los 32 bits bajos de un IPv6 (dos hextets) como IPv4 dotted. */
function hextetsToV4(hi: number, lo: number): string {
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.');
}

function isPrivateIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true; // ULA fc00::/7
  // Link-local fe80::/10 completo (fe80..febf), no solo el prefijo 'fe80'.
  const firstHextet = parseInt(addr.split(':')[0] ?? '', 16);
  if (Number.isFinite(firstHextet) && firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true;
  // IPv4 mapeado en forma dotted (::ffff:a.b.c.d, ::a.b.c.d)
  const dotted = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted?.[1]) return isPrivateIpv4(dotted[1]);
  // IPv4 mapeado en forma hex ::ffff:HHHH:HHHH (como lo normaliza URL/Node).
  const mapped = addr.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped?.[1] && mapped[2]) {
    return isPrivateIpv4(hextetsToV4(parseInt(mapped[1], 16), parseInt(mapped[2], 16)));
  }
  // NAT64 64:ff9b::/96 -> los ultimos 32 bits son la IPv4 traducida.
  if (addr.startsWith('64:ff9b:')) {
    const tail = addr.match(/([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    const tailDotted = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (tailDotted?.[1]) return isPrivateIpv4(tailDotted[1]);
    if (tail?.[1] && tail[2]) {
      return isPrivateIpv4(hextetsToV4(parseInt(tail[1], 16), parseInt(tail[2], 16)));
    }
  }
  // 6to4 2002:V4V4:V4V4::/16 -> los 32 bits tras 2002: son la IPv4.
  const sixToFour = addr.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})/);
  if (sixToFour?.[1] && sixToFour[2]) {
    return isPrivateIpv4(hextetsToV4(parseInt(sixToFour[1], 16), parseInt(sixToFour[2], 16)));
  }
  return false;
}

/**
 * Valida que un host sea seguro para conectar desde el servidor.
 * Resuelve DNS y comprueba cada IP; si el host ya es una IP literal, la valida
 * directamente. Devuelve las IPs resueltas (para diagnostico/pinning futuro).
 */
export async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (PRIVATE_HOST_PATTERNS.some((p) => p.test(host))) {
    throw new SiteFetchError(`Host no permitido para auditoria: ${host}`, { code: 'PRIVATE_HOST' });
  }

  // IP literal en la URL: validar sin DNS.
  if (isIP(host)) {
    if (isPrivateIp(host)) {
      throw new SiteFetchError(`Host no permitido para auditoria: ${host}`, { code: 'PRIVATE_HOST' });
    }
    return;
  }

  if (!host.includes('.')) {
    throw new SiteFetchError(`Host invalido: ${host}`, { code: 'BAD_HOST' });
  }

  // Nombre de dominio: resolver y validar TODAS las IPs (evita dominios que
  // apuntan a IP privada y reduce la ventana de DNS rebinding).
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new SiteFetchError(`No se pudo resolver el host: ${host}`, { code: 'DNS' });
  }
  if (addresses.length === 0) {
    throw new SiteFetchError(`El host no resolvio a ninguna IP: ${host}`, { code: 'DNS' });
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new SiteFetchError(
        `Host no permitido para auditoria: ${host} resuelve a IP interna`,
        { code: 'PRIVATE_HOST' },
      );
    }
  }
}

/**
 * Dispatcher de undici que valida la IP a la que se abre CADA socket. Esto
 * cierra el DNS rebinding: la IP que fetch usa para conectar es exactamente la
 * que se valida aqui (no hay una segunda resolucion sin control). Si el host
 * resuelve a una IP interna, la conexion falla antes de abrirse.
 *
 * undici invoca este lookup con `options.all` puesto, asi que el resultado es
 * un array de {address, family}; se valida cada entrada y se reenvia intacto.
 */
type LookupResult = string | Array<{ address: string; family: number }>;
type LookupCallback = (err: Error | null, address: LookupResult, family?: number) => void;
// La firma de dns.lookup tiene overloads que no encajan con nuestra validacion
// generica; usamos una vista permisiva de la funcion callback-form.
const rawLookup = dnsLookupCb as unknown as (
  host: string,
  options: unknown,
  cb: LookupCallback,
) => void;

const safeAgent = new Agent({
  connect: {
    lookup(hostname: string, options: unknown, callback: LookupCallback): void {
      rawLookup(hostname, options, (err, result, family) => {
        if (err) {
          callback(err, result, family);
          return;
        }
        const list = Array.isArray(result)
          ? result
          : [{ address: String(result), family: family ?? 4 }];
        for (const a of list) {
          if (isPrivateIp(a.address)) {
            callback(
              new Error(`SSRF bloqueado: ${hostname} resuelve a IP interna`),
              result,
              family,
            );
            return;
          }
        }
        callback(null, result, family);
      });
    },
  },
});

const useFetch = undiciFetch as unknown as typeof fetch;

// El tipo DOM de RequestInit no expone `dispatcher` (es de undici); lo inyectamos.
type FetchInitWithDispatcher = RequestInit & { dispatcher?: unknown };
function withDispatcher(init: RequestInit): FetchInitWithDispatcher {
  return { ...init, dispatcher: safeAgent };
}

export async function fetchSite(
  rawUrl: string,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<FetchedSite> {
  const log = logger.child({ component: 'geo-auditor.fetch' });
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SiteFetchError(`URL invalida: ${rawUrl}`, { code: 'BAD_URL' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SiteFetchError(`Protocolo no permitido: ${url.protocol}`, { code: 'BAD_SCHEME' });
  }

  const { html, finalUrl, truncated } = await fetchHtml(url, timeoutMs, opts?.signal);
  // debug y no info: el CLI escribe su propio progreso en stdout y un INFO
  // de pino por cada fetch se intercalaria en medio de esas lineas.
  log.debug({ url: url.href, finalUrl, bytes: html.length, truncated }, 'HTML descargado');

  // finalUrl ya fue validado hop por hop dentro de fetchHtml, asi que su
  // origen es seguro para los fetch auxiliares.
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

/**
 * Descarga el HTML siguiendo redirects a mano y revalidando cada salto.
 * El timeout cubre toda la cadena (conexion + lectura del body).
 */
async function fetchHtml(
  startUrl: URL,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<{ html: string; finalUrl: string; truncated: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Enlazar un abort externo (cliente desconectado) al controller interno.
  const onExternalAbort = (): void => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    let current = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(current);

      const res = await useFetch(
        current.href,
        withDispatcher({
          headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
          signal: controller.signal,
          redirect: 'manual',
        }),
      );

      // Redirect: validar el Location y volver a iterar.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel();
        if (!location) {
          throw new SiteFetchError('Redirect sin cabecera Location.', { code: 'BAD_REDIRECT' });
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new SiteFetchError('Redirect con Location invalido.', { code: 'BAD_REDIRECT' });
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          throw new SiteFetchError(`Redirect a protocolo no permitido: ${next.protocol}`, {
            code: 'BAD_SCHEME',
          });
        }
        current = next;
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel();
        throw new SiteFetchError(
          `El sitio respondio HTTP ${res.status} (${res.statusText || 'sin detalle'}).`,
          { code: `HTTP_${res.status}` },
        );
      }

      const { text, truncated } = await readCapped(res, MAX_HTML_BYTES);
      return { html: text, finalUrl: current.href, truncated };
    }
    throw new SiteFetchError(`Demasiados redirects (>${MAX_REDIRECTS}).`, { code: 'TOO_MANY_REDIRECTS' });
  } catch (err) {
    if (err instanceof SiteFetchError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SiteFetchError(`El sitio no respondio en ${timeoutMs}ms.`, {
        code: 'TIMEOUT',
        cause: err,
      });
    }
    // No filtrar el detalle interno (IP/host) al usuario: va al logger, no al mensaje.
    logger.child({ component: 'geo-auditor.fetch' }).debug(
      { err: (err as Error).message, host: startUrl.hostname },
      'fallo de conexion',
    );
    throw new SiteFetchError('No se pudo conectar con el sitio.', { code: 'CONN', cause: err });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/** Lee el body por chunks hasta el cap; cancela el resto si se excede. */
async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) {
    // Sin stream legible: leer texto pero acotarlo. Es un fallback raro.
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
    const res = await fetchAux(url, async (r) => {
      if (r.ok) {
        const { text } = await readCapped(r, 256 * 1024);
        return { status: 'ok' as const, content: text };
      }
      await r.body?.cancel();
      if (r.status === 404 || r.status === 410) return { status: 'missing' as const };
      return { status: 'error' as const };
    });
    return res;
  } catch {
    return { status: 'error' };
  }
}

async function fetchAuxStatus(url: string): Promise<AuxStatus> {
  try {
    return await fetchAux(url, async (r) => {
      // Drenar/cancelar el body para no dejar la conexion abierta.
      await r.body?.cancel();
      if (r.ok) return 'ok';
      if (r.status === 404 || r.status === 410) return 'missing';
      return 'error';
    });
  } catch {
    return 'error';
  }
}

/**
 * Fetch auxiliar (robots/sitemap/llms) sobre un origen ya validado.
 * El AbortController cubre tambien la lectura del body (evita slow-loris en el
 * cuerpo): el handler consume la respuesta ANTES de limpiar el timer.
 *
 * Sigue UN redirect si permanece en el mismo origen (caso comun:
 * /sitemap.xml -> /sitemap_index.xml), pero nunca fuera de el.
 */
async function fetchAux<T>(url: string, handle: (res: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUX_TIMEOUT_MS);
  const origin = new URL(url).origin;
  try {
    let target = url;
    for (let hop = 0; hop < 2; hop++) {
      // redirect:'manual': un aux que redirige fuera del origen no se sigue.
      const res = await useFetch(
        target,
        withDispatcher({
          headers: { 'user-agent': USER_AGENT },
          signal: controller.signal,
          redirect: 'manual',
        }),
      );
      if (res.status >= 300 && res.status < 400 && hop === 0) {
        const location = res.headers.get('location');
        await res.body?.cancel();
        if (!location) break;
        let next: URL;
        try {
          next = new URL(location, target);
        } catch {
          break;
        }
        // Solo seguir si sigue en el mismo origen ya validado.
        if (next.origin !== origin) break;
        target = next.href;
        continue;
      }
      return await handle(res);
    }
    // Redirect fuera de origen o cadena rara: tratar como el handler decida.
    return await handle(new Response(null, { status: 599 }));
  } finally {
    clearTimeout(timer);
  }
}

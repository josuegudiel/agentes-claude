import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertPublicHost, assertPublicResolved, fetchSite, MAX_HTML_BYTES, SiteFetchError } from '../site-fetcher.js';

function htmlResponse(body: string, opts?: { status?: number; url?: string }): Response {
  const res = new Response(body, {
    status: opts?.status ?? 200,
    headers: { 'content-type': 'text/html' },
  });
  if (opts?.url) Object.defineProperty(res, 'url', { value: opts.url });
  return res;
}

/** Resolver mock que devuelve una IP publica (example.com). */
const PUB = async (): Promise<string[]> => ['93.184.216.34'];

describe('assertPublicHost', () => {
  it.each([
    'http://localhost/',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://172.16.1.1/',
    'http://172.31.255.255/',
    'http://192.168.1.10/',
    'http://169.254.1.1/',
    'http://impresora.local/',
  ])('rechaza %s', (url) => {
    expect(() => assertPublicHost(new URL(url))).toThrow(SiteFetchError);
  });

  it('rechaza hosts sin punto (nombres internos)', () => {
    expect(() => assertPublicHost(new URL('http://intranet/'))).toThrow(SiteFetchError);
  });

  it.each(['https://negocio.gt/', 'https://172.200.1.1/', 'http://mi-tienda.com.gt/pagina'])(
    'permite %s',
    (url) => {
      expect(() => assertPublicHost(new URL(url))).not.toThrow();
    },
  );
});

describe('fetchSite', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('descarga HTML y auxiliares en el origen final (tras redirect)', async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://negocio.gt/') {
        return new Response(null, { status: 301, headers: { location: 'https://www.negocio.gt/' } });
      }
      if (url === 'https://www.negocio.gt/') {
        return htmlResponse('<html><body>hola</body></html>');
      }
      if (url === 'https://www.negocio.gt/robots.txt') {
        return new Response('User-agent: *\nDisallow:', { status: 200 });
      }
      if (url === 'https://www.negocio.gt/sitemap.xml') return new Response('ok', { status: 200 });
      if (url === 'https://www.negocio.gt/llms.txt') return new Response('no', { status: 404 });
      throw new Error(`fetch inesperado: ${url}`);
    });

    const site = await fetchSite('https://negocio.gt/', { resolver: PUB });
    expect(site.finalUrl).toBe('https://www.negocio.gt/');
    expect(site.html).toContain('hola');
    expect(site.truncated).toBe(false);
    expect(site.robotsTxt).toEqual({ status: 'ok', content: 'User-agent: *\nDisallow:' });
    expect(site.sitemap).toBe('ok');
    expect(site.llmsTxt).toBe('missing');
  });

  it('lanza SiteFetchError con codigo HTTP_<status> en respuestas no-2xx', async () => {
    fetchSpy.mockResolvedValue(htmlResponse('not found', { status: 404 }));
    await expect(fetchSite('https://negocio.gt/', { resolver: PUB })).rejects.toMatchObject({
      name: 'SiteFetchError',
      code: 'HTTP_404',
    });
  });

  it('lanza TIMEOUT cuando el sitio no responde a tiempo', async () => {
    fetchSpy.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    await expect(fetchSite('https://negocio.gt/', { timeoutMs: 30, resolver: PUB })).rejects.toMatchObject({
      name: 'SiteFetchError',
      code: 'TIMEOUT',
    });
  });

  it('lanza DNS en errores de red', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
    await expect(fetchSite('https://no-existe-este-dominio.gt/', { resolver: PUB })).rejects.toMatchObject({
      name: 'SiteFetchError',
      code: 'DNS',
    });
  });

  it('trunca HTML gigante en MAX_HTML_BYTES y lo marca', async () => {
    const big = 'a'.repeat(MAX_HTML_BYTES + 5000);
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('robots.txt') || url.endsWith('sitemap.xml') || url.endsWith('llms.txt')) {
        return new Response('no', { status: 404 });
      }
      return htmlResponse(big);  // 200 directo, sin redirect
    });

    const site = await fetchSite('https://negocio.gt/', { resolver: PUB });
    expect(site.truncated).toBe(true);
    expect(site.htmlBytes).toBe(MAX_HTML_BYTES);
  });

  it('tolera fallos de auxiliares sin tumbar la auditoria', async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://negocio.gt/') return htmlResponse('<html><body>ok</body></html>');
      throw new TypeError('network down');
    });
    const site = await fetchSite('https://negocio.gt/', { resolver: PUB });
    expect(site.robotsTxt).toEqual({ status: 'error' });
    expect(site.sitemap).toBe('error');
    expect(site.llmsTxt).toBe('error');
  });

  it('rechaza hosts privados sin hacer fetch', async () => {
    await expect(fetchSite('http://127.0.0.1:8080/')).rejects.toMatchObject({
      code: 'PRIVATE_HOST',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('SSRF: bloquea un redirect a una IP interna (169.254 metadata)', async () => {
    // El sitio publico responde 302 -> host de metadata de cloud. El
    // redirect manual debe re-validar y abortar.
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://negocio.gt/') {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        });
      }
      throw new Error('no deberia fetchear el host interno: ' + url);
    });
    await expect(fetchSite('https://negocio.gt/', { resolver: PUB })).rejects.toMatchObject({
      code: 'PRIVATE_HOST',
    });
  });

  it('SSRF: bloquea DNS rebinding (host publico que resuelve a IP privada)', async () => {
    // evil.com pasa el check de string pero resuelve a 169.254.169.254.
    const rebind = async (): Promise<string[]> => ['169.254.169.254'];
    await expect(fetchSite('https://evil.com/', { resolver: rebind })).rejects.toMatchObject({
      code: 'PRIVATE_IP',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('assertPublicResolved', () => {
  it('rechaza cuando la IP resuelta es privada aunque el host sea publico', async () => {
    await expect(
      assertPublicResolved(new URL('https://evil.com/'), async () => ['10.0.0.5']),
    ).rejects.toMatchObject({ code: 'PRIVATE_IP' });
  });

  it('rechaza IPv4-mapped-IPv6 privada (::ffff:169.254.169.254)', async () => {
    await expect(
      assertPublicResolved(new URL('https://evil.com/'), async () => ['::ffff:169.254.169.254']),
    ).rejects.toMatchObject({ code: 'PRIVATE_IP' });
  });

  it('permite una IP publica', async () => {
    await expect(
      assertPublicResolved(new URL('https://negocio.gt/'), async () => ['93.184.216.34']),
    ).resolves.toBeUndefined();
  });

  it('rechaza si el host no resuelve a nada', async () => {
    await expect(
      assertPublicResolved(new URL('https://negocio.gt/'), async () => []),
    ).rejects.toMatchObject({ code: 'PRIVATE_IP' });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El fetcher usa el fetch de undici (con dispatcher de pinning); lo mockeamos
// para no tocar la red. El Agent se stubbea a un no-op.
const { undiciFetchMock } = vi.hoisted(() => ({ undiciFetchMock: vi.fn() }));
vi.mock('undici', () => ({
  Agent: class {
    constructor(_opts?: unknown) {}
  },
  fetch: undiciFetchMock,
}));

// El fetcher resuelve DNS (assertPublicHost) para validar anti-SSRF; mockeamos
// node:dns/promises para no depender de la red y forzar la IP resuelta por host.
const dnsMap = new Map<string, string>();
vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => {
    const ip = dnsMap.get(host) ?? '93.184.216.34'; // IP publica por defecto
    if (ip === '__FAIL__') throw new Error('ENOTFOUND');
    return [{ address: ip, family: ip.includes(':') ? 6 : 4 }];
  },
}));

const { assertPublicHost, fetchSite, isPrivateIp, MAX_HTML_BYTES, SiteFetchError } = await import(
  '../site-fetcher.js'
);

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.1.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '192.0.0.1', // 192.0.0.0/24 IETF
    '198.18.0.5', // 198.18/15 benchmarking
    '198.19.1.1',
    '240.0.0.1', // 240/4 reservado
    'fe90::1', // link-local fe80::/10 completo
    '64:ff9b::7f00:1', // NAT64 -> 127.0.0.1
    '2002:7f00:1::1', // 6to4 -> 127.0.0.1
  ])('marca %s como privada', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:2800:220:1:248:1893:25c8:1946'])(
    'marca %s como publica',
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    },
  );
});

describe('assertPublicHost', () => {
  beforeEach(() => dnsMap.clear());

  it.each([
    'http://localhost/',
    'http://127.0.0.1/',
    'http://169.254.169.254/',
    'http://[::1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://impresora.local/',
    'http://algo.internal/',
  ])('rechaza %s', async (url) => {
    await expect(assertPublicHost(new URL(url))).rejects.toBeInstanceOf(SiteFetchError);
  });

  it('rechaza dominio que resuelve a IP interna (anti-rebinding/DNS)', async () => {
    dnsMap.set('metadata.evil.com', '169.254.169.254');
    await expect(assertPublicHost(new URL('http://metadata.evil.com/'))).rejects.toMatchObject({
      code: 'PRIVATE_HOST',
    });
  });

  it('permite dominio que resuelve a IP publica', async () => {
    dnsMap.set('negocio.gt', '93.184.216.34');
    await expect(assertPublicHost(new URL('https://negocio.gt/'))).resolves.toBeUndefined();
  });

  it('permite IP publica literal sin DNS', async () => {
    await expect(assertPublicHost(new URL('https://93.184.216.34/'))).resolves.toBeUndefined();
  });

  it('rechaza host sin punto', async () => {
    await expect(assertPublicHost(new URL('http://intranet/'))).rejects.toMatchObject({
      code: 'BAD_HOST',
    });
  });
});

describe('fetchSite', () => {
  beforeEach(() => {
    dnsMap.clear();
    undiciFetchMock.mockReset();
  });

  it('descarga HTML y auxiliares sobre el origen final', async () => {
    undiciFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://negocio.gt/') return htmlResponse('<html><body>hola</body></html>');
      if (url === 'https://negocio.gt/robots.txt') {
        return new Response('User-agent: *\nDisallow:', { status: 200 });
      }
      if (url === 'https://negocio.gt/sitemap.xml') return new Response('ok', { status: 200 });
      if (url === 'https://negocio.gt/llms.txt') return new Response('no', { status: 404 });
      throw new Error(`fetch inesperado: ${url}`);
    });

    const site = await fetchSite('https://negocio.gt/');
    expect(site.finalUrl).toBe('https://negocio.gt/');
    expect(site.html).toContain('hola');
    expect(site.robotsTxt).toEqual({ status: 'ok', content: 'User-agent: *\nDisallow:' });
    expect(site.sitemap).toBe('ok');
    expect(site.llmsTxt).toBe('missing');
  });

  it('sigue un redirect hacia un host publico revalidado', async () => {
    dnsMap.set('negocio.gt', '93.184.216.34');
    dnsMap.set('www.negocio.gt', '93.184.216.34');
    undiciFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://negocio.gt/') return redirectTo('https://www.negocio.gt/');
      if (url === 'https://www.negocio.gt/') return htmlResponse('<html><body>final</body></html>');
      return new Response('no', { status: 404 });
    });
    const site = await fetchSite('https://negocio.gt/');
    expect(site.finalUrl).toBe('https://www.negocio.gt/');
    expect(site.html).toContain('final');
  });

  it('BLOQUEA un redirect (302) hacia un host interno — SSRF', async () => {
    undiciFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://evil.com/') return redirectTo('http://169.254.169.254/latest/meta-data/');
      throw new Error(`no deberia hacer fetch a ${url}`);
    });
    await expect(fetchSite('https://evil.com/')).rejects.toMatchObject({ code: 'PRIVATE_HOST' });
    // La clave: nunca se llego a hacer fetch al endpoint interno.
    expect(undiciFetchMock).not.toHaveBeenCalledWith(
      'http://169.254.169.254/latest/meta-data/',
      expect.anything(),
    );
  });

  it('corta cadenas de redirect infinitas', async () => {
    undiciFetchMock.mockImplementation(async () => redirectTo('https://negocio.gt/loop'));
    await expect(fetchSite('https://negocio.gt/')).rejects.toMatchObject({
      code: 'TOO_MANY_REDIRECTS',
    });
  });

  it('lanza SiteFetchError con codigo HTTP_<status> en respuestas no-2xx', async () => {
    undiciFetchMock.mockResolvedValue(htmlResponse('not found', 404));
    await expect(fetchSite('https://negocio.gt/')).rejects.toMatchObject({ code: 'HTTP_404' });
  });

  it('lanza TIMEOUT cuando el sitio no responde a tiempo', async () => {
    undiciFetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    await expect(fetchSite('https://negocio.gt/', { timeoutMs: 30 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('no filtra el detalle interno en errores de conexion', async () => {
    undiciFetchMock.mockRejectedValue(new TypeError('connect ECONNREFUSED 10.1.2.3:80'));
    await expect(fetchSite('https://negocio.gt/')).rejects.toMatchObject({
      code: 'CONN',
      message: 'No se pudo conectar con el sitio.',
    });
  });

  it('trunca HTML gigante en MAX_HTML_BYTES y lo marca', async () => {
    const big = 'a'.repeat(MAX_HTML_BYTES + 5000);
    undiciFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('robots.txt') || url.endsWith('sitemap.xml') || url.endsWith('llms.txt')) {
        return new Response('no', { status: 404 });
      }
      return htmlResponse(big);
    });
    const site = await fetchSite('https://negocio.gt/');
    expect(site.truncated).toBe(true);
    expect(site.htmlBytes).toBe(MAX_HTML_BYTES);
  });

  it('tolera fallos de auxiliares sin tumbar la auditoria', async () => {
    undiciFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://negocio.gt/') return htmlResponse('<html><body>ok</body></html>');
      throw new TypeError('network down');
    });
    const site = await fetchSite('https://negocio.gt/');
    expect(site.robotsTxt).toEqual({ status: 'error' });
    expect(site.sitemap).toBe('error');
    expect(site.llmsTxt).toBe('error');
  });

  it('rechaza IP privada literal sin hacer fetch del body', async () => {
    undiciFetchMock.mockResolvedValue(htmlResponse('x'));
    await expect(fetchSite('http://127.0.0.1:8080/')).rejects.toMatchObject({
      code: 'PRIVATE_HOST',
    });
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });
});

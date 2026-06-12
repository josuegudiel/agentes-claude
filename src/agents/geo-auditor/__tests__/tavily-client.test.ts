import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTavilyConfigured, TavilyClient } from '../tavily-client.js';

const VALID_BODY = JSON.stringify({
  query: 'taller lopez quetzaltenango',
  results: [
    { title: 'Taller Lopez', url: 'https://ejemplo.com', content: 'Un taller', score: 0.9 },
  ],
});

describe('isTavilyConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refleja la presencia de TAVILY_API_KEY', () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    expect(isTavilyConfigured()).toBe(false);
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test');
    expect(isTavilyConfigured()).toBe(true);
  });
});

describe('TavilyClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('lanza si no hay API key ni en opts ni en env', () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    expect(() => new TavilyClient()).toThrow(/TAVILY_API_KEY/);
  });

  it('busca y valida el response con zod', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(VALID_BODY, { status: 200 }));
    const client = new TavilyClient({ apiKey: 'tvly-test' });
    const res = await client.search('taller lopez quetzaltenango');
    expect(res.results).toHaveLength(1);
    expect(res.results[0]?.title).toBe('Taller Lopez');

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ authorization: 'Bearer tvly-test' });
  });

  it('reintenta 5xx hasta exito', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('overloaded', { status: 503 }))
      .mockResolvedValueOnce(new Response(VALID_BODY, { status: 200 }));
    const client = new TavilyClient({ apiKey: 'tvly-test' });
    const res = await client.search('q');
    expect(res.results).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('NO reintenta 4xx (key invalida)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    const client = new TavilyClient({ apiKey: 'tvly-mala' });
    await expect(client.search('q')).rejects.toMatchObject({
      name: 'TavilyError',
      status: 401,
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

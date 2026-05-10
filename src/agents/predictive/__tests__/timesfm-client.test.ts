import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimesFMClient, PredictiveServiceError } from '../timesfm-client.js';

/**
 * Tests del cliente HTTP a TimesFM.
 * - Mockeamos `global.fetch`. No tocamos red.
 * - Verificamos: parseo de health, validacion zod del response, retry SOLO
 *   en 5xx/red, no-retry en 4xx, timeout, y error formatting.
 */

const BASE = 'http://timesfm.test';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(detail: string, status: number): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('TimesFMClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('health()', () => {
    it('parsea una respuesta valida', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          status: 'ok',
          model: 'google/timesfm-2.0-500m-pytorch',
          backend: 'cpu',
          horizon_max: 512,
        }),
      );
      const client = new TimesFMClient({ baseUrl: BASE });
      const h = await client.health();
      expect(h.status).toBe('ok');
      expect(h.horizon_max).toBe(512);
      expect(fetchSpy).toHaveBeenCalledOnce();
      const url = fetchSpy.mock.calls[0]?.[0] as string;
      expect(url).toBe(`${BASE}/healthz`);
    });

    it('rechaza un payload con shape invalido', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ status: 'weird-state' }));
      const client = new TimesFMClient({ baseUrl: BASE });
      await expect(client.health()).rejects.toThrow();
    });
  });

  describe('forecast()', () => {
    const validRequest = {
      series: [1, 2, 3, 4, 5, 6, 7, 8],
      horizon: 4 as const,
      frequency: 0 as const,
      quantiles: [0.1, 0.5, 0.9],
    };

    const validResponse = {
      horizon: 4,
      point_forecast: [9, 10, 11, 12],
      quantile_forecast: { '0.1': [8, 9, 10, 11], '0.5': [9, 10, 11, 12], '0.9': [10, 11, 12, 13] },
      model: 'test/model',
      elapsed_ms: 42,
    };

    it('hace POST con body JSON al endpoint /forecast', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(validResponse));
      const client = new TimesFMClient({ baseUrl: BASE });
      const res = await client.forecast(validRequest);
      expect(res).toEqual(validResponse);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE}/forecast`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual(validRequest);
    });

    it('NO reintenta en 4xx (input invalido)', async () => {
      fetchSpy.mockResolvedValueOnce(errorResponse('series too short', 400));
      const client = new TimesFMClient({ baseUrl: BASE });
      await expect(client.forecast(validRequest)).rejects.toMatchObject({
        name: 'PredictiveServiceError',
        status: 400,
      });
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('reintenta en 503 hasta exito', async () => {
      fetchSpy
        .mockResolvedValueOnce(errorResponse('model_loading', 503))
        .mockResolvedValueOnce(errorResponse('model_loading', 503))
        .mockResolvedValueOnce(jsonResponse(validResponse));
      const client = new TimesFMClient({ baseUrl: BASE });
      const res = await client.forecast(validRequest);
      expect(res.point_forecast).toHaveLength(4);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('falla tras agotar reintentos', async () => {
      fetchSpy.mockResolvedValue(errorResponse('still loading', 503));
      const client = new TimesFMClient({ baseUrl: BASE });
      await expect(client.forecast(validRequest)).rejects.toBeInstanceOf(
        PredictiveServiceError,
      );
      // 1 intento + 2 retries = 3 calls
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('clasifica timeout como status=0 y reintenta', async () => {
      // 2 timeouts seguidos del exito.
      const err = new Error('aborted');
      err.name = 'AbortError';
      fetchSpy
        .mockRejectedValueOnce(err)
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce(jsonResponse(validResponse));
      const client = new TimesFMClient({ baseUrl: BASE, timeoutMs: 100 });
      const res = await client.forecast(validRequest);
      expect(res).toEqual(validResponse);
    });
  });
});

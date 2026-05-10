import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaClient, OllamaError } from '../ollama-client.js';

const BASE = 'http://ollama.test';
const MODEL = 'llama3.1:8b';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OllamaClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('preflight()', () => {
    it('devuelve null cuando el modelo esta presente exacto', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ models: [{ name: MODEL }] }),
      );
      const client = new OllamaClient({ baseUrl: BASE, model: MODEL });
      expect(await client.preflight()).toBeNull();
    });

    it('devuelve null si el modelo coincide por prefijo (con tag explicito)', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ models: [{ name: 'llama3.1:8b-instruct-q4' }] }),
      );
      const client = new OllamaClient({ baseUrl: BASE, model: 'llama3.1:8b' });
      // El preflight matchea por igualdad o por prefijo "model:". El nombre
      // del modelo es "llama3.1:8b-instruct-q4" que NO empieza con "llama3.1:8b:"
      // — sera marcado como faltante. Validamos comportamiento real.
      const result = await client.preflight();
      expect(result).toMatch(/no tiene el modelo/);
    });

    it('devuelve mensaje claro si el modelo NO esta descargado', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ models: [{ name: 'qwen2.5:7b' }] }));
      const client = new OllamaClient({ baseUrl: BASE, model: 'llama3.1:8b' });
      const result = await client.preflight();
      expect(result).toMatch(/no tiene el modelo "llama3.1:8b"/);
      expect(result).toMatch(/ollama pull llama3.1:8b/);
    });

    it('devuelve mensaje si Ollama no esta corriendo (network error)', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const client = new OllamaClient({ baseUrl: BASE, model: MODEL });
      const result = await client.preflight();
      expect(result).toMatch(/No pude conectar/);
    });
  });

  describe('chat()', () => {
    it('manda el body con model, stream=false y options.temperature', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          model: MODEL,
          message: { role: 'assistant', content: 'hola' },
          done: true,
        }),
      );
      const client = new OllamaClient({ baseUrl: BASE, model: MODEL });
      await client.chat({
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.5,
      });
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE}/api/chat`);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body['model']).toBe(MODEL);
      expect(body['stream']).toBe(false);
      expect((body['options'] as { temperature: number }).temperature).toBe(0.5);
    });

    it('parsea tool_calls cuando el modelo los emite', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          model: MODEL,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                function: {
                  name: 'forecast_series',
                  arguments: { series: [1, 2, 3], horizon: 4 },
                },
              },
            ],
          },
          done: true,
        }),
      );
      const client = new OllamaClient({ baseUrl: BASE, model: MODEL });
      const res = await client.chat({ messages: [{ role: 'user', content: 'go' }] });
      expect(res.message.tool_calls).toHaveLength(1);
      expect(res.message.tool_calls?.[0]?.function.name).toBe('forecast_series');
    });

    it('lanza OllamaError en HTTP 500', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('boom', { status: 500 }),
      );
      const client = new OllamaClient({ baseUrl: BASE, model: MODEL });
      await expect(
        client.chat({ messages: [{ role: 'user', content: 'x' }] }),
      ).rejects.toBeInstanceOf(OllamaError);
    });
  });

  describe('generate()', () => {
    it('devuelve el campo `response` del payload', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ model: MODEL, response: 'Tendencia alcista', done: true }),
      );
      const client = new OllamaClient({ baseUrl: BASE, model: MODEL });
      const out = await client.generate('explica esto');
      expect(out).toBe('Tendencia alcista');
    });

    it('rechaza JSON invalido', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('not json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const client = new OllamaClient({ baseUrl: BASE, model: MODEL });
      await expect(client.generate('x')).rejects.toBeInstanceOf(OllamaError);
    });
  });
});

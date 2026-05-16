import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroqClient, GroqError } from '../groq-client.js';

/**
 * Tests del cliente Groq (API OpenAI-compatible).
 * Mockeamos fetch — no tocamos red ni necesitamos GROQ_API_KEY real
 * (la inyectamos en el constructor).
 */

const BASE = 'https://api.groq.test/openai/v1';
const KEY = 'gsk_test_key';
const MODEL = 'llama-3.1-8b-instant';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const validChatResponse = {
  id: 'chatcmpl_1',
  model: MODEL,
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hola desde Groq' },
      finish_reason: 'stop',
    },
  ],
};

describe('GroqClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('constructor', () => {
    it('lanza si no hay apiKey ni env var', () => {
      const orig = process.env['GROQ_API_KEY'];
      delete process.env['GROQ_API_KEY'];
      try {
        expect(() => new GroqClient({ baseUrl: BASE })).toThrow(/GROQ_API_KEY/);
      } finally {
        if (orig !== undefined) process.env['GROQ_API_KEY'] = orig;
      }
    });
  });

  describe('preflight()', () => {
    it('devuelve null cuando el modelo esta disponible', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: MODEL }, { id: 'mixtral-8x7b' }] }),
      );
      const client = new GroqClient({ apiKey: KEY, baseUrl: BASE, model: MODEL });
      expect(await client.preflight()).toBeNull();
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE}/models`);
      const headers = init.headers as Record<string, string>;
      expect(headers['authorization']).toBe(`Bearer ${KEY}`);
    });

    it('devuelve mensaje claro en 401', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('unauthorized', { status: 401 }),
      );
      const client = new GroqClient({ apiKey: 'bad', baseUrl: BASE, model: MODEL });
      const r = await client.preflight();
      expect(r).toMatch(/GROQ_API_KEY invalida/);
      expect(r).toMatch(/console.groq.com/);
    });

    it('devuelve mensaje si el modelo no esta disponible', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'mixtral-8x7b' }, { id: 'gemma-7b' }] }),
      );
      const client = new GroqClient({ apiKey: KEY, baseUrl: BASE, model: 'no-existe' });
      const r = await client.preflight();
      expect(r).toMatch(/no expone el modelo "no-existe"/);
    });

    it('captura errores de red sin lanzar', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const client = new GroqClient({ apiKey: KEY, baseUrl: BASE, model: MODEL });
      const r = await client.preflight();
      expect(r).toMatch(/No pude conectar a Groq/);
    });
  });

  describe('chat()', () => {
    it('manda POST a /chat/completions con auth y body OpenAI', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(validChatResponse));
      const client = new GroqClient({ apiKey: KEY, baseUrl: BASE, model: MODEL });
      await client.chat({
        messages: [{ role: 'user', content: 'hola' }],
        temperature: 0.5,
      });
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE}/chat/completions`);
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['authorization']).toBe(`Bearer ${KEY}`);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body['model']).toBe(MODEL);
      expect(body['temperature']).toBe(0.5);
      expect(body['stream']).toBe(false);
      expect(body['messages']).toEqual([{ role: 'user', content: 'hola' }]);
    });

    it('normaliza la respuesta al shape de Ollama', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(validChatResponse));
      const client = new GroqClient({ apiKey: KEY, baseUrl: BASE, model: MODEL });
      const res = await client.chat({ messages: [{ role: 'user', content: 'go' }] });
      expect(res.model).toBe(MODEL);
      expect(res.message.role).toBe('assistant');
      expect(res.message.content).toBe('Hola desde Groq');
      expect(res.done).toBe(true);
    });

    it('parsea tool_calls cuando el modelo los emite (arguments como JSON string)', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          model: MODEL,
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_abc',
                    type: 'function',
                    function: {
                      name: 'forecast_series',
                      arguments: '{"series":[1,2,3],"horizon":4}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
      );
      const client = new GroqClient({ apiKey: KEY, baseUrl: BASE, model: MODEL });
      const res = await client.chat({ messages: [{ role: 'user', content: 'predice' }] });
      expect(res.message.tool_calls).toHaveLength(1);
      const call = res.message.tool_calls![0]!;
      expect(call.function.name).toBe('forecast_series');
      expect(call.function.arguments).toEqual({ series: [1, 2, 3], horizon: 4 });
    });

    it('envia tools cuando se pasan y agrega tool_choice=auto', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(validChatResponse));
      const client = new GroqClient({ apiKey: KEY, baseUrl: BASE, model: MODEL });
      await client.chat({
        messages: [{ role: 'user', content: 'x' }],
        tools: [
          {
            type: 'function',
            function: { name: 'foo', description: 'd', parameters: { type: 'object' } },
          },
        ],
      });
      const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body['tool_choice']).toBe('auto');
      expect((body['tools'] as unknown[]).length).toBe(1);
    });

    it('lanza GroqError en HTTP 500', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('boom', { status: 500 }));
      const client = new GroqClient({ apiKey: KEY, baseUrl: BASE, model: MODEL });
      await expect(
        client.chat({ messages: [{ role: 'user', content: 'x' }] }),
      ).rejects.toBeInstanceOf(GroqError);
    });
  });

  describe('generate()', () => {
    it('envuelve chat() y devuelve el content', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(validChatResponse));
      const client = new GroqClient({ apiKey: KEY, baseUrl: BASE, model: MODEL });
      const out = await client.generate('explica');
      expect(out).toBe('Hola desde Groq');
    });
  });
});

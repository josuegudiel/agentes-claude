import { describe, expect, it, vi } from 'vitest';
import { runPredictiveAgent } from '../runtime.js';
import type { TimesFMClient } from '../timesfm-client.js';
import type {
  OllamaClient,
  OllamaChatResponse,
  OllamaMessage,
} from '../ollama-client.js';
import type { ForecastResponse, HealthResponse } from '../schema.js';

/**
 * Stubs minimos. Los clients son construidos por el runtime si no se
 * inyectan; aqui SI los inyectamos para evitar tocar red.
 *
 * Usamos `as unknown as TimesFMClient` para mantener los stubs minimales
 * — solo implementamos los metodos que el runtime invoca.
 */

function mkOllama(opts: {
  preflight?: string | null;
  responses: OllamaChatResponse[];
}): { client: OllamaClient; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn();
  for (const res of opts.responses) chat.mockResolvedValueOnce(res);
  const client = {
    modelName: 'llama3.1:8b',
    preflight: vi.fn().mockResolvedValue(opts.preflight ?? null),
    chat,
    generate: vi.fn().mockResolvedValue('mock interpretation'),
  } as unknown as OllamaClient;
  return { client, chat };
}

function mkTimesfm(opts?: {
  health?: HealthResponse;
  forecast?: ForecastResponse;
}): TimesFMClient {
  return {
    health: vi.fn().mockResolvedValue(
      opts?.health ?? {
        status: 'ok',
        model: 'google/timesfm',
        backend: 'cpu',
        horizon_max: 512,
      },
    ),
    forecast: vi.fn().mockResolvedValue(
      opts?.forecast ?? {
        horizon: 4,
        point_forecast: [10, 11, 12, 13],
        quantile_forecast: { '0.1': [9, 10, 11, 12], '0.9': [11, 12, 13, 14] },
        model: 'google/timesfm',
        elapsed_ms: 5,
      },
    ),
  } as unknown as TimesFMClient;
}

function assistant(content: string, toolCalls?: { name: string; args: Record<string, unknown> }[]): OllamaChatResponse {
  const message: OllamaMessage = {
    role: 'assistant',
    content,
    ...(toolCalls
      ? {
          tool_calls: toolCalls.map((c) => ({
            function: { name: c.name, arguments: c.args },
          })),
        }
      : {}),
  };
  return {
    model: 'llama3.1:8b',
    message,
    done: true,
  };
}

describe('runPredictiveAgent', () => {
  it('falla rapido si Ollama no esta listo', async () => {
    const { client: ollama } = mkOllama({
      preflight: 'No pude conectar a Ollama',
      responses: [],
    });
    const timesfm = mkTimesfm();
    await expect(
      runPredictiveAgent({ goal: 'predice', ollama, timesfm }),
    ).rejects.toThrow(/Ollama no esta listo/);
  });

  it('falla rapido si TimesFM healthz devuelve error', async () => {
    const { client: ollama } = mkOllama({ responses: [] });
    const timesfm = mkTimesfm({
      health: { status: 'error', model: 'x', backend: 'cpu', horizon_max: 0 },
    });
    await expect(
      runPredictiveAgent({ goal: 'predice', ollama, timesfm }),
    ).rejects.toThrow(/predictive-service esta en estado error/);
  });

  it('retorna texto plano si el modelo no llama tools', async () => {
    const { client: ollama, chat } = mkOllama({
      responses: [assistant('No tengo datos para responder.')],
    });
    const timesfm = mkTimesfm();
    const result = await runPredictiveAgent({ goal: 'hola', ollama, timesfm });
    expect(result.text).toBe('No tengo datos para responder.');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.steps).toBe(1);
    expect(chat).toHaveBeenCalledOnce();
  });

  it('ejecuta forecast_series + interpret_forecast en sequencia', async () => {
    const series = Array.from({ length: 12 }, (_, i) => i + 1);
    const { client: ollama, chat } = mkOllama({
      responses: [
        assistant('', [{ name: 'forecast_series', args: { series, horizon: 4, frequency: 0 } }]),
        assistant('', [{ name: 'interpret_forecast', args: { question: 'tendencia?' } }]),
        assistant('Subira ~30% en el horizonte de 4 puntos.'),
      ],
    });
    const timesfm = mkTimesfm();

    const result = await runPredictiveAgent({ goal: 'predice', ollama, timesfm });

    expect(result.text).toContain('Subira');
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.map((t) => t.name)).toEqual([
      'forecast_series',
      'interpret_forecast',
    ]);
    expect(result.lastSummary).not.toBeNull();
    expect(result.steps).toBe(3);
    expect(chat).toHaveBeenCalledTimes(3);

    // Verifica que el segundo chat() recibio el mensaje role=tool con el resultado.
    const secondCall = chat.mock.calls[1]?.[0] as { messages: OllamaMessage[] };
    const toolMsgs = secondCall.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.length).toBeGreaterThanOrEqual(1);
    expect(toolMsgs[0]?.content).toContain('"ok":true');
  });

  it('fuerza respuesta final cuando alcanza maxSteps', async () => {
    // Loop infinito: el modelo siempre pide mas tools.
    const series = Array.from({ length: 10 }, (_, i) => i);
    const { client: ollama, chat } = mkOllama({
      responses: [
        assistant('', [{ name: 'forecast_series', args: { series } }]),
        assistant('', [{ name: 'forecast_series', args: { series } }]),
        assistant('Forzado: el agente cierra aqui.'), // respuesta tras "da la respuesta final"
      ],
    });
    const timesfm = mkTimesfm();

    const result = await runPredictiveAgent({
      goal: 'loop',
      ollama,
      timesfm,
      maxSteps: 2,
    });

    expect(chat).toHaveBeenCalledTimes(3);
    expect(result.text).toContain('Forzado');
    // El ultimo mensaje del usuario debe pedir la respuesta final.
    const lastCall = chat.mock.calls[2]?.[0] as { messages: OllamaMessage[] };
    const userMsgs = lastCall.messages.filter((m) => m.role === 'user');
    expect(userMsgs[userMsgs.length - 1]?.content).toMatch(/respuesta final/);
  });

  it('propaga errores de tool al modelo via mensaje role=tool con ok:false', async () => {
    const { client: ollama, chat } = mkOllama({
      responses: [
        assistant('', [{ name: 'forecast_series', args: { series: [1] } }]), // <8 -> BAD_ARGS
        assistant('Necesito mas datos historicos para responder.'),
      ],
    });
    const timesfm = mkTimesfm();

    const result = await runPredictiveAgent({ goal: 'predice', ollama, timesfm });
    expect(result.text).toContain('Necesito mas datos');
    const secondCall = chat.mock.calls[1]?.[0] as { messages: OllamaMessage[] };
    const toolMsg = secondCall.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('"ok":false');
    expect(toolMsg?.content).toContain('BAD_ARGS');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { buildPredictiveTools } from '../tools.js';
import type { TimesFMClient } from '../timesfm-client.js';
import type { OllamaClient } from '../ollama-client.js';
import type { ForecastResponse } from '../schema.js';

/**
 * Tests del dispatch + validacion + manejo de estado entre tools.
 * Stubs minimos de los clients (solo los metodos que se invocan).
 */

const fakeForecast: ForecastResponse = {
  horizon: 4,
  point_forecast: [10, 11, 12, 13],
  quantile_forecast: { '0.1': [9, 10, 11, 12], '0.5': [10, 11, 12, 13], '0.9': [11, 12, 13, 14] },
  model: 'test/timesfm',
  elapsed_ms: 5,
};

function mkStubs(): {
  timesfm: TimesFMClient;
  ollama: OllamaClient;
  timesfmForecast: ReturnType<typeof vi.fn>;
  ollamaGenerate: ReturnType<typeof vi.fn>;
} {
  const timesfmForecast = vi.fn().mockResolvedValue(fakeForecast);
  const ollamaGenerate = vi.fn().mockResolvedValue('Tendencia alcista moderada.');
  const timesfm = { forecast: timesfmForecast } as unknown as TimesFMClient;
  const ollama = { generate: ollamaGenerate } as unknown as OllamaClient;
  return { timesfm, ollama, timesfmForecast, ollamaGenerate };
}

describe('buildPredictiveTools', () => {
  describe('definitions', () => {
    it('expone exactamente forecast_series e interpret_forecast', () => {
      const { timesfm, ollama } = mkStubs();
      const tools = buildPredictiveTools({ timesfm, ollama });
      const names = tools.definitions.map((d) => d.function.name).sort();
      expect(names).toEqual(['forecast_series', 'interpret_forecast']);
    });
  });

  describe('forecast_series', () => {
    it('llama timesfm.forecast y guarda summary en state', async () => {
      const { timesfm, ollama, timesfmForecast } = mkStubs();
      const tools = buildPredictiveTools({ timesfm, ollama });
      const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      const result = await tools.dispatch('forecast_series', {
        series,
        horizon: 4,
        frequency: 0,
      });

      expect(result).toMatchObject({ ok: true, model: 'test/timesfm' });
      expect(timesfmForecast).toHaveBeenCalledOnce();
      expect(tools.state.lastSummary).not.toBeNull();
      expect(tools.state.lastSummary?.history.n).toBe(series.length);
      expect(tools.state.lastSummary?.forecast.next).toBe(10);
    });

    it('rechaza serie demasiado corta con BAD_ARGS y NO llama TimesFM', async () => {
      const { timesfm, ollama, timesfmForecast } = mkStubs();
      const tools = buildPredictiveTools({ timesfm, ollama });

      const result = await tools.dispatch('forecast_series', { series: [1, 2, 3] });

      expect(result).toMatchObject({ ok: false, code: 'BAD_ARGS' });
      expect(timesfmForecast).not.toHaveBeenCalled();
    });

    it('captura excepciones del client y las devuelve serializadas', async () => {
      const { timesfm, ollama, timesfmForecast } = mkStubs();
      timesfmForecast.mockRejectedValueOnce(new Error('upstream 500'));
      const tools = buildPredictiveTools({ timesfm, ollama });

      const result = await tools.dispatch('forecast_series', {
        series: Array.from({ length: 10 }, (_, i) => i),
      });

      expect(result).toMatchObject({ ok: false, code: 'TOOL_FAILED' });
      expect(tools.state.lastSummary).toBeNull();
    });
  });

  describe('interpret_forecast', () => {
    it('falla con NO_FORECAST si no hubo forecast previo', async () => {
      const { timesfm, ollama, ollamaGenerate } = mkStubs();
      const tools = buildPredictiveTools({ timesfm, ollama });

      const result = await tools.dispatch('interpret_forecast', { question: 'que opinas' });

      expect(result).toMatchObject({ ok: false, code: 'NO_FORECAST' });
      expect(ollamaGenerate).not.toHaveBeenCalled();
    });

    it('usa el ultimo summary y devuelve el texto de Ollama', async () => {
      const { timesfm, ollama, ollamaGenerate } = mkStubs();
      const tools = buildPredictiveTools({ timesfm, ollama });

      // Primero dispara un forecast.
      await tools.dispatch('forecast_series', {
        series: Array.from({ length: 10 }, (_, i) => i + 1),
      });
      // Luego interpreta.
      const result = await tools.dispatch('interpret_forecast', { question: 'tendencia?' });

      expect(result).toMatchObject({ ok: true, text: 'Tendencia alcista moderada.' });
      expect(ollamaGenerate).toHaveBeenCalledOnce();
      // El prompt debe incluir el summary serializado.
      const promptArg = ollamaGenerate.mock.calls[0]?.[0] as string;
      expect(promptArg).toContain('"horizon"');
      expect(promptArg).toContain('tendencia?');
    });
  });

  describe('dispatch', () => {
    it('devuelve UNKNOWN_TOOL para nombres desconocidos', async () => {
      const { timesfm, ollama } = mkStubs();
      const tools = buildPredictiveTools({ timesfm, ollama });
      const result = await tools.dispatch('does_not_exist', {});
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_TOOL' });
    });
  });
});

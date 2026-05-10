import { describe, it, expect } from 'vitest';
import { summarizeForecast } from '../summarize.js';
import type { ForecastResponse } from '../schema.js';

function mkForecast(point: number[], p10?: number[], p90?: number[]): ForecastResponse {
  const quantiles: Record<string, number[]> = { '0.5': point };
  if (p10) quantiles['0.1'] = p10;
  if (p90) quantiles['0.9'] = p90;
  return {
    horizon: point.length,
    point_forecast: point,
    quantile_forecast: quantiles,
    model: 'test/model',
    elapsed_ms: 10,
  };
}

describe('summarizeForecast', () => {
  it('calcula stats historicos y de forecast con bandas', () => {
    const history = [10, 12, 11, 13, 14, 16, 15, 18, 20, 22];
    const forecast = mkForecast(
      [23, 24, 25, 26],
      [21, 22, 23, 24],
      [25, 27, 28, 29],
    );

    const s = summarizeForecast(history, forecast);

    expect(s.horizon).toBe(4);
    expect(s.history.n).toBe(10);
    expect(s.history.last).toBe(22);
    expect(s.history.min).toBe(10);
    expect(s.history.max).toBe(22);
    expect(s.history.mean).toBeCloseTo(15.1, 1);
    expect(s.forecast.next).toBe(23);
    expect(s.forecast.end).toBe(26);
    expect(s.forecast.deltaPct).toBeCloseTo(((26 - 22) / 22) * 100, 1);
    expect(s.forecast.p10End).toBe(24);
    expect(s.forecast.p90End).toBe(29);
  });

  it('omite p10End/p90End si la respuesta no trae bandas', () => {
    const history = [1, 2, 3, 4, 5, 6, 7, 8];
    const forecast = mkForecast([9, 10]);
    const s = summarizeForecast(history, forecast);
    expect(s.forecast.p10End).toBeUndefined();
    expect(s.forecast.p90End).toBeUndefined();
  });

  it('maneja last=0 sin dividir por cero', () => {
    const history = [1, 1, 1, 1, 1, 1, 1, 0];
    const forecast = mkForecast([2, 3]);
    const s = summarizeForecast(history, forecast);
    expect(s.forecast.deltaPct).toBe(0);
  });

  it('lanza si la historia es vacia', () => {
    expect(() => summarizeForecast([], mkForecast([1]))).toThrow(/historia vacia/);
  });

  it('lanza si el forecast es vacio', () => {
    expect(() => summarizeForecast([1, 2, 3], mkForecast([]))).toThrow(/forecast vacio/);
  });
});

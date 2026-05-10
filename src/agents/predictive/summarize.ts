import type { ForecastResponse, ForecastSummary } from './schema.js';

/**
 * Resume historia + forecast en un objeto compacto. El LLM razona mucho
 * mejor sobre 12 metricas que sobre 200 floats. Esta es la principal
 * razon por la que el agente puede usar un Llama 3.1 8B y no un 70B.
 */
export function summarizeForecast(history: number[], forecast: ForecastResponse): ForecastSummary {
  if (history.length === 0) {
    throw new Error('summarizeForecast: historia vacia');
  }
  const point = forecast.point_forecast;
  if (point.length === 0) {
    throw new Error('summarizeForecast: forecast vacio');
  }

  const last = history[history.length - 1] as number;
  const next = point[0] as number;
  const end = point[point.length - 1] as number;
  const deltaPct = last !== 0 ? ((end - last) / Math.abs(last)) * 100 : 0;

  const histStats = stats(history);
  const fStats = stats(point);

  const p10 = forecast.quantile_forecast['0.1'];
  const p90 = forecast.quantile_forecast['0.9'];

  return {
    horizon: forecast.horizon,
    history: {
      n: history.length,
      last,
      min: histStats.min,
      max: histStats.max,
      mean: round(histStats.mean),
      stddev: round(histStats.stddev),
    },
    forecast: {
      next: round(next),
      end: round(end),
      min: round(fStats.min),
      max: round(fStats.max),
      mean: round(fStats.mean),
      deltaPct: round(deltaPct),
      ...(p10 && p10.length > 0 ? { p10End: round(p10[p10.length - 1] as number) } : {}),
      ...(p90 && p90.length > 0 ? { p90End: round(p90[p90.length - 1] as number) } : {}),
    },
  };
}

function stats(arr: number[]): { min: number; max: number; mean: number; stddev: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const x of arr) {
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
  }
  const mean = sum / arr.length;
  let sq = 0;
  for (const x of arr) sq += (x - mean) ** 2;
  const stddev = Math.sqrt(sq / arr.length);
  return { min, max, mean, stddev };
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

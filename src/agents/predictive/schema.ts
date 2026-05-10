import { z } from 'zod';

/**
 * Schemas compartidos entre el cliente HTTP, las tools y el runtime del
 * agente predictivo. Reflejan 1:1 los Pydantic del sidecar Python para que
 * los nombres de campos sean contrato.
 */

export const FrequencySchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type Frequency = z.infer<typeof FrequencySchema>;

export const ForecastRequestSchema = z.object({
  series: z.array(z.number().finite()).min(8).max(2048),
  horizon: z.number().int().positive().max(512).default(24),
  frequency: FrequencySchema.default(0),
  quantiles: z
    .array(z.number().min(0.1).max(0.9))
    .default([0.1, 0.5, 0.9])
    .refine(
      (qs) => qs.every((q) => Math.abs(q * 10 - Math.round(q * 10)) < 1e-9),
      'quantiles deben ser multiplos de 0.1',
    ),
});
export type ForecastRequest = z.infer<typeof ForecastRequestSchema>;

export const ForecastResponseSchema = z.object({
  horizon: z.number().int().positive(),
  point_forecast: z.array(z.number()),
  quantile_forecast: z.record(z.string(), z.array(z.number())),
  model: z.string(),
  elapsed_ms: z.number().int().nonnegative(),
});
export type ForecastResponse = z.infer<typeof ForecastResponseSchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'loading', 'error']),
  model: z.string(),
  backend: z.string(),
  horizon_max: z.number().int().positive(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * Resumen de un forecast pensado para el LLM: en vez de pasarle el array
 * completo, le damos las metricas que de verdad necesita para razonar.
 */
export const ForecastSummarySchema = z.object({
  horizon: z.number(),
  history: z.object({
    n: z.number(),
    last: z.number(),
    min: z.number(),
    max: z.number(),
    mean: z.number(),
    stddev: z.number(),
  }),
  forecast: z.object({
    next: z.number(),
    end: z.number(),
    min: z.number(),
    max: z.number(),
    mean: z.number(),
    deltaPct: z.number(), // % de cambio entre last historico y end forecast
    p10End: z.number().optional(),
    p90End: z.number().optional(),
  }),
});
export type ForecastSummary = z.infer<typeof ForecastSummarySchema>;

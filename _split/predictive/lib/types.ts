/**
 * Tipos compartidos entre cliente y server. NO importar nada server-only
 * desde aqui — este modulo se incluye en el bundle del cliente.
 */

import type { AgentEvent } from '@/agents/predictive/runtime';

export type { AgentEvent };

export type SSEEvent =
  | { type: 'start'; goal: string }
  | AgentEvent
  | { type: 'error'; message: string }
  | { type: 'done'; lastSummary: ForecastSummaryClient | null; toolCalls: ToolCall[] };

export interface ForecastSummaryClient {
  horizon: number;
  history: {
    n: number;
    last: number;
    min: number;
    max: number;
    mean: number;
    stddev?: number | undefined;
  };
  forecast: {
    next: number;
    end: number;
    deltaPct: number;
    min?: number | undefined;
    max?: number | undefined;
    p10End?: number | undefined;
    p90End?: number | undefined;
    [key: string]: number | undefined;
  };
  series?: number[] | undefined;
  point?: number[] | undefined;
  p10?: number[] | undefined;
  p90?: number[] | undefined;
}

export interface ToolCall {
  name: string;
  args: unknown;
  result: unknown;
}

export interface PredictRequest {
  series: number[];
  horizon: number;
  question?: string;
}

export interface HealthResponse {
  ok: boolean;
  ollama: { ready: boolean; model: string; error?: string };
  timesfm: { ready: boolean; status: 'ok' | 'loading' | 'error' | 'unreachable'; model?: string; error?: string };
}

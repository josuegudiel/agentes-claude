'use client';

import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { ForecastSummaryClient } from '@/lib/types';

/**
 * Pinta serie historica + forecast con banda P10-P90.
 *
 * Usamos un solo array de puntos donde cada punto tiene:
 *   - history: el valor real (solo en indices < n)
 *   - forecast: el punto medio (solo en indices >= n)
 *   - band: [low, high] para que Recharts pinte el area
 *
 * Asi el chart muestra una linea continua que cambia de color en el corte.
 */

interface Props {
  data: ForecastSummaryClient | null;
}

export function ForecastChart({ data }: Props): React.ReactElement {
  if (!data || !data.series || !data.point) {
    return (
      <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-ink-800 text-sm text-ink-500">
        El chart aparece cuando termina la prediccion.
      </div>
    );
  }

  const series = data.series;
  const point = data.point;
  const p10 = data.p10 ?? point;
  const p90 = data.p90 ?? point;
  const n = series.length;

  const points = [
    ...series.map((v, i) => ({
      idx: i,
      history: v,
      forecast: i === n - 1 ? v : null, // pequeño solapamiento para conectar
      band: undefined,
    })),
    ...point.map((v, i) => ({
      idx: n + i,
      history: null,
      forecast: v,
      band: [p10[i] ?? v, p90[i] ?? v] as [number, number],
    })),
  ];

  const fmt = (n: number): string =>
    n >= 1000 ? n.toLocaleString('es', { maximumFractionDigits: 1 }) : n.toFixed(2);

  return (
    <div className="rounded-md border border-ink-800 bg-ink-900 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">
          Histórico + forecast ({n} → {n + point.length})
        </h2>
        <span className="text-xs text-ink-400">
          Δ {data.forecast.deltaPct >= 0 ? '+' : ''}
          {data.forecast.deltaPct.toFixed(1)}% al cierre
        </span>
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={points} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
          <defs>
            <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
          <XAxis dataKey="idx" stroke="#64748b" tick={{ fontSize: 11 }} />
          <YAxis
            stroke="#64748b"
            tick={{ fontSize: 11 }}
            domain={['auto', 'auto']}
            tickFormatter={fmt}
          />
          <Tooltip
            contentStyle={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 6,
              fontSize: 12,
            }}
            formatter={(value: unknown) => {
              if (typeof value === 'number') return fmt(value);
              if (Array.isArray(value)) {
                return `[${(value as number[]).map(fmt).join(', ')}]`;
              }
              return String(value);
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="band"
            stroke="none"
            fill="url(#bandFill)"
            name="P10–P90"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="history"
            stroke="#e2e8f0"
            strokeWidth={2}
            dot={false}
            name="Histórico"
            isAnimationActive={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="forecast"
            stroke="#22d3ee"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            name="Forecast"
            isAnimationActive={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

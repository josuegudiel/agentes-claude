'use client';

import { useEffect, useState } from 'react';
import type { CategoryScores } from '../../lib/auditor-types';

interface Props {
  scores: CategoryScores;
}

interface Tone {
  text: string;
  stroke: string;
  bar: string;
  glow: string;
  label: string;
}

function toneFor(value: number): Tone {
  if (value >= 70) {
    return {
      text: 'text-emerald-400',
      stroke: '#34d399',
      bar: 'bg-emerald-400',
      glow: 'drop-shadow(0 0 10px rgba(52, 211, 153, 0.45))',
      label: 'Saludable',
    };
  }
  if (value >= 40) {
    return {
      text: 'text-amber-400',
      stroke: '#fbbf24',
      bar: 'bg-amber-400',
      glow: 'drop-shadow(0 0 10px rgba(251, 191, 36, 0.4))',
      label: 'Necesita trabajo',
    };
  }
  return {
    text: 'text-rose-400',
    stroke: '#fb7185',
    bar: 'bg-rose-400',
    glow: 'drop-shadow(0 0 10px rgba(251, 113, 133, 0.45))',
    label: 'En riesgo',
  };
}

/** Contador animado 0 -> value con easing, en ~1.2s. */
function useCountUp(value: number, durationMs = 1200): number {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(Math.round(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return display;
}

const RING_R = 64;
const RING_CIRC = 2 * Math.PI * RING_R;

export function ScoreCards({ scores }: Props): React.ReactElement {
  const tone = toneFor(scores.overall);
  const display = useCountUp(scores.overall);
  const offset = RING_CIRC * (1 - scores.overall / 100);

  return (
    <div className="animate-rise grid grid-cols-1 gap-4 sm:grid-cols-[auto_1fr]">
      {/* Anillo del score global */}
      <div className="card-glass flex flex-col items-center justify-center gap-1 rounded-2xl px-8 py-6">
        <div className="relative h-40 w-40">
          <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
            <circle
              cx="80"
              cy="80"
              r={RING_R}
              fill="none"
              stroke="rgba(148, 163, 184, 0.12)"
              strokeWidth="10"
            />
            <circle
              cx="80"
              cy="80"
              r={RING_R}
              fill="none"
              stroke={tone.stroke}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={RING_CIRC}
              className="ring-animate"
              style={
                {
                  '--ring-circ': RING_CIRC,
                  '--ring-offset': offset,
                  filter: tone.glow,
                } as React.CSSProperties
              }
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-5xl font-bold tabular-nums tracking-tight ${tone.text}`}>
              {display}
            </span>
            <span className="text-[11px] font-medium text-ink-500">de 100</span>
          </div>
        </div>
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-300">
          Global
        </span>
        <span className={`text-[11px] font-medium ${tone.text}`}>{tone.label}</span>
      </div>

      {/* Barras por categoria */}
      <div className="flex flex-col justify-center gap-3">
        <CategoryBar label="SEO tecnico" value={scores.onpage} delayMs={120} />
        <CategoryBar label="Preparacion GEO (visibilidad en IA)" value={scores.geo} delayMs={240} />
        <CategoryBar label="Presencia online" value={scores.presence} delayMs={360} />
      </div>
    </div>
  );
}

function CategoryBar({
  label,
  value,
  delayMs,
}: {
  label: string;
  value: number | null;
  delayMs: number;
}): React.ReactElement {
  if (value === null) {
    return (
      <div className="card-glass rounded-2xl px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-ink-300">{label}</span>
          <span className="text-sm text-ink-500">no medida</span>
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-ink-800" />
      </div>
    );
  }

  const tone = toneFor(value);
  return (
    <div className="card-glass rounded-2xl px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink-200">{label}</span>
        <span className={`text-lg font-bold tabular-nums ${tone.text}`}>
          {value}
          <span className="text-xs font-normal text-ink-500">/100</span>
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div
          className={`bar-animate h-full rounded-full ${tone.bar}`}
          style={{ width: `${value}%`, animationDelay: `${delayMs}ms` }}
        />
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import type { CategoryScores } from '../../lib/auditor-types';
import { IconBrackets, IconRadar, IconSignal } from './icons';

interface Props {
  scores: CategoryScores;
}

interface Tone {
  text: string;
  hex: string;
  bar: string;
  plate: string;
  label: string;
}

function toneFor(value: number): Tone {
  if (value >= 70) {
    return {
      text: 'text-lime-300',
      hex: '#bef264',
      bar: 'bg-gradient-to-r from-lime-400 to-cyan-300',
      plate: 'border-lime-300/30 bg-lime-400/10 text-lime-300',
      label: 'Saludable',
    };
  }
  if (value >= 40) {
    return {
      text: 'text-orange-300',
      hex: '#fdba74',
      bar: 'bg-gradient-to-r from-orange-400 to-amber-300',
      plate: 'border-orange-300/30 bg-orange-400/10 text-orange-300',
      label: 'Necesita trabajo',
    };
  }
  return {
    text: 'text-rose-400',
    hex: '#fb7185',
    bar: 'bg-gradient-to-r from-rose-500 to-fuchsia-400',
    plate: 'border-rose-400/30 bg-rose-500/10 text-rose-400',
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

/** Medidor de 28 ticks en arco de 270°: se encienden en secuencia. */
const TICK_COUNT = 28;
const ARC_START = -225; // grados
const ARC_SPAN = 270;
const R_INNER = 56;
const R_OUTER = 71;

function GaugeTicks({ value, tone }: { value: number; tone: Tone }): React.ReactElement {
  const lit = Math.round((value / 100) * TICK_COUNT);
  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => {
    const angle = ((ARC_START + (i / (TICK_COUNT - 1)) * ARC_SPAN) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const isLit = i < lit;
    return (
      <line
        key={i}
        x1={80 + R_INNER * cos}
        y1={80 + R_INNER * sin}
        x2={80 + R_OUTER * cos}
        y2={80 + R_OUTER * sin}
        stroke={isLit ? tone.hex : 'rgba(167, 139, 250, 0.14)'}
        strokeWidth={i === lit - 1 ? 4 : 3}
        strokeLinecap="round"
        className={isLit ? 'tick-lit' : undefined}
        style={
          isLit
            ? {
                animationDelay: `${i * 38}ms`,
                filter: `drop-shadow(0 0 5px ${tone.hex})`,
              }
            : undefined
        }
      />
    );
  });
  return <svg viewBox="0 0 160 160">{ticks}</svg>;
}

export function ScoreCards({ scores }: Props): React.ReactElement {
  const tone = toneFor(scores.overall);
  const display = useCountUp(scores.overall);

  return (
    <div className="animate-rise grid grid-cols-1 gap-4 sm:grid-cols-[auto_1fr]">
      {/* Medidor del score global */}
      <div className="holo-card holo-tick flex flex-col items-center justify-center gap-1 px-8 py-6">
        <div className="relative h-40 w-40">
          <GaugeTicks value={scores.overall} tone={tone} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-5xl font-bold tabular-nums tracking-tight ${tone.text}`}>
              {display}
            </span>
            <span className="text-[11px] font-medium text-violet-300/50">de 100</span>
          </div>
        </div>
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-200/80">
          Global
        </span>
        <span className={`text-[11px] font-medium ${tone.text}`}>{tone.label}</span>
      </div>

      {/* Barras segmentadas por categoria, con placa de icono */}
      <div className="flex flex-col justify-center gap-3">
        <CategoryBar
          icon={<IconBrackets className="h-5 w-5" />}
          label="SEO tecnico"
          value={scores.onpage}
          delayMs={120}
        />
        <CategoryBar
          icon={<IconRadar className="h-5 w-5" />}
          label="Preparacion GEO (visibilidad en IA)"
          value={scores.geo}
          delayMs={240}
        />
        <CategoryBar
          icon={<IconSignal className="h-5 w-5" />}
          label="Presencia online"
          value={scores.presence}
          delayMs={360}
        />
      </div>
    </div>
  );
}

function CategoryBar({
  icon,
  label,
  value,
  delayMs,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  delayMs: number;
}): React.ReactElement {
  const tone = value === null ? null : toneFor(value);
  return (
    <div className="holo-card px-5 py-4">
      <div className="flex items-center gap-3.5">
        <span
          className={`icon-plate inline-flex h-10 w-10 shrink-0 items-center justify-center border ${
            tone ? tone.plate : 'border-violet-400/20 bg-violet-400/5 text-violet-300/50'
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium text-violet-100/90">{label}</span>
            {tone ? (
              <span className={`text-lg font-bold tabular-nums ${tone.text}`}>
                {value}
                <span className="text-xs font-normal text-violet-300/40">/100</span>
              </span>
            ) : (
              <span className="text-sm text-violet-300/40">no medida</span>
            )}
          </div>
          <div className="bar-segmented mt-2.5 h-2 rounded-sm bg-violet-300/10">
            {tone && (
              <div
                className={`bar-animate h-full ${tone.bar}`}
                style={{ width: `${value}%`, animationDelay: `${delayMs}ms` }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import type { CategoryScores } from '../../lib/auditor-types';

interface Props {
  scores: CategoryScores;
}

export function ScoreCards({ scores }: Props): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <ScoreCard label="Global" value={scores.overall} highlight />
      <ScoreCard label="SEO tecnico" value={scores.onpage} />
      <ScoreCard label="Preparacion GEO" value={scores.geo} />
      <ScoreCard label="Presencia online" value={scores.presence} />
    </div>
  );
}

function ScoreCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number | null;
  highlight?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`flex flex-col gap-1 rounded-md border p-3 ${
        highlight ? 'border-ink-600 bg-ink-800' : 'border-ink-800 bg-ink-900'
      }`}
    >
      <span className="text-xs text-ink-400">{label}</span>
      {value === null ? (
        <span className="text-lg font-semibold text-ink-500">no medida</span>
      ) : (
        <span className={`text-2xl font-semibold ${scoreColor(value)}`}>
          {value}
          <span className="text-sm font-normal text-ink-500">/100</span>
        </span>
      )}
    </div>
  );
}

function scoreColor(value: number): string {
  if (value >= 70) return 'text-emerald-400';
  if (value >= 40) return 'text-amber-400';
  return 'text-rose-400';
}

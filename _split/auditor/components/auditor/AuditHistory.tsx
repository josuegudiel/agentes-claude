'use client';

import type { AuditHistoryEntry } from '@/lib/auditor-history';
import { deltaFor } from '@/lib/auditor-history';

interface Props {
  history: AuditHistoryEntry[];
  onClear: () => void;
}

/** Auditorias recientes (localStorage) con delta vs la anterior del mismo sitio. */
export function AuditHistory({ history, onClear }: Props): React.ReactElement | null {
  if (history.length === 0) return null;

  const recent = [...history].reverse().slice(0, 6);

  return (
    <div className="mt-5">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-300/55">
          Auditorias recientes
        </h2>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] text-violet-300/35 transition hover:text-violet-200"
        >
          borrar
        </button>
      </div>
      <ul className="holo-card divide-y divide-violet-400/10 text-xs">
        {recent.map((entry) => {
          const delta = deltaFor(history, entry);
          return (
            <li key={`${entry.url}-${entry.ts}`} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-violet-100/90">{entry.businessName}</p>
                <p className="truncate font-mono text-[10px] text-violet-300/35">{entry.url}</p>
              </div>
              <span className="text-[10px] text-violet-300/40">
                {new Date(entry.ts).toLocaleDateString()}
              </span>
              <span className="w-12 text-right font-bold tabular-nums text-violet-100">
                {entry.scores.overall}
                <span className="font-normal text-violet-300/35">/100</span>
              </span>
              <DeltaBadge delta={delta} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DeltaBadge({ delta }: { delta: number | null }): React.ReactElement {
  if (delta === null) {
    return <span className="w-11 text-right text-[10px] text-violet-300/30">nueva</span>;
  }
  if (delta === 0) {
    return <span className="w-11 text-right text-[10px] text-violet-300/45">= 0</span>;
  }
  const up = delta > 0;
  return (
    <span
      className={`w-11 text-right text-[11px] font-semibold tabular-nums ${
        up ? 'text-lime-300' : 'text-rose-400'
      }`}
    >
      {up ? '▲ +' : '▼ '}
      {delta}
    </span>
  );
}

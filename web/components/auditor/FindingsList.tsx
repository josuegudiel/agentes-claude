'use client';

import type { Finding, Severity } from '../../lib/auditor-types';

const SEVERITY_META: Record<Severity, { label: string; classes: string }> = {
  critical: {
    label: 'Critico',
    classes: 'border-rose-700/40 bg-rose-900/20 text-rose-300',
  },
  important: {
    label: 'Importante',
    classes: 'border-amber-700/40 bg-amber-900/20 text-amber-300',
  },
  improvement: {
    label: 'Mejora',
    classes: 'border-ink-700 bg-ink-800 text-ink-300',
  },
};

interface Props {
  findings: Finding[];
}

export function FindingsList({ findings }: Props): React.ReactElement {
  if (findings.length === 0) {
    return (
      <div className="rounded-md border border-emerald-700/40 bg-emerald-900/20 p-4 text-sm text-emerald-200">
        Sin hallazgos: todos los checks aplicables pasaron. 🎉
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {findings.map((finding) => {
        const meta = SEVERITY_META[finding.severity];
        return (
          <li key={finding.checkId} className="rounded-md border border-ink-800 bg-ink-900 p-4">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.classes}`}
              >
                {meta.label}
              </span>
              <span className="text-sm font-medium text-ink-100">{finding.title}</span>
            </div>
            <p className="text-sm text-ink-300">{finding.detail}</p>
            <p className="mt-2 text-sm text-emerald-300">
              <span className="font-medium">Solucion:</span> {finding.recommendation}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

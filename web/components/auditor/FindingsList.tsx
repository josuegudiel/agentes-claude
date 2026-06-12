'use client';

import type { Finding, Severity } from '../../lib/auditor-types';

const SEVERITY_META: Record<
  Severity,
  { label: string; chip: string; accent: string; icon: string }
> = {
  critical: {
    label: 'Critico',
    chip: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    accent: 'from-rose-500 to-rose-500/10',
    icon: '▲',
  },
  important: {
    label: 'Importante',
    chip: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    accent: 'from-amber-400 to-amber-400/10',
    icon: '◆',
  },
  improvement: {
    label: 'Mejora',
    chip: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
    accent: 'from-sky-400 to-sky-400/10',
    icon: '●',
  },
};

interface Props {
  findings: Finding[];
}

export function FindingsList({ findings }: Props): React.ReactElement {
  if (findings.length === 0) {
    return (
      <div className="card-glass rounded-2xl p-5 text-sm text-emerald-200">
        Sin hallazgos: todos los checks aplicables pasaron. 🎉
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {findings.map((finding, i) => {
        const meta = SEVERITY_META[finding.severity];
        return (
          <li
            key={finding.checkId}
            className="finding-card card-glass animate-fade-in-up relative overflow-hidden rounded-2xl p-5 pl-6"
            style={{ animationDelay: `${Math.min(i * 60, 420)}ms` }}
          >
            <span
              aria-hidden
              className={`absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b ${meta.accent}`}
            />
            <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${meta.chip}`}
              >
                <span aria-hidden className="text-[8px]">
                  {meta.icon}
                </span>
                {meta.label}
              </span>
              <span className="text-sm font-semibold text-ink-100">{finding.title}</span>
            </div>
            <p className="text-sm leading-relaxed text-ink-400">{finding.detail}</p>
            <p className="mt-2.5 flex gap-2 text-sm leading-relaxed text-emerald-300/90">
              <span aria-hidden className="mt-0.5 shrink-0 text-emerald-400">
                ✓
              </span>
              <span>
                <span className="font-semibold text-emerald-300">Solucion:</span>{' '}
                {finding.recommendation}
              </span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

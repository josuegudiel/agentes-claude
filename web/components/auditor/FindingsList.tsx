'use client';

import type { Finding, Severity } from '../../lib/auditor-types';
import { IconBurst, IconRhombEye, IconSpark } from './icons';

const SEVERITY_META: Record<
  Severity,
  { label: string; chip: string; plate: string; icon: React.ReactNode }
> = {
  critical: {
    label: 'Critico',
    chip: 'border-rose-400/40 bg-rose-500/10 text-rose-300',
    plate: 'border-rose-400/30 bg-rose-500/10 text-rose-400',
    icon: <IconBurst className="h-5 w-5" />,
  },
  important: {
    label: 'Importante',
    chip: 'border-orange-300/40 bg-orange-400/10 text-orange-300',
    plate: 'border-orange-300/30 bg-orange-400/10 text-orange-300',
    icon: <IconRhombEye className="h-5 w-5" />,
  },
  improvement: {
    label: 'Mejora',
    chip: 'border-cyan-300/40 bg-cyan-400/10 text-cyan-300',
    plate: 'border-cyan-300/30 bg-cyan-400/10 text-cyan-300',
    icon: <IconSpark className="h-5 w-5" />,
  },
};

interface Props {
  findings: Finding[];
}

export function FindingsList({ findings }: Props): React.ReactElement {
  if (findings.length === 0) {
    return (
      <div className="holo-card holo-tick p-5 text-sm text-lime-300">
        Sin hallazgos: todos los checks aplicables pasaron. La base esta lista para competir.
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
            className="finding-card holo-card animate-fade-in-up p-5"
            style={{ animationDelay: `${Math.min(i * 60, 420)}ms` }}
          >
            <div className="flex gap-4">
              <span
                className={`icon-plate inline-flex h-11 w-11 shrink-0 items-center justify-center border ${meta.plate}`}
              >
                {meta.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
                  <span className="text-sm font-semibold text-violet-50">{finding.title}</span>
                  <span
                    className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${meta.chip}`}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-violet-200/55">{finding.detail}</p>
                <div className="mt-3 border-l-2 border-fuchsia-400/40 bg-fuchsia-400/[0.06] py-2 pl-3 pr-2 text-sm leading-relaxed text-fuchsia-100/90">
                  <span className="font-semibold text-fuchsia-300">Solucion:</span>{' '}
                  {finding.recommendation}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

'use client';

import { useEffect, useRef } from 'react';
import type { AuditorSSEEvent, AuditPhase, CheckStatus } from '../../lib/auditor-types';

const PHASE_LABEL: Record<AuditPhase, string> = {
  fetch: 'Descargando el sitio',
  onpage: 'SEO tecnico on-page',
  geo: 'Preparacion GEO (visibilidad en IA)',
  presence: 'Presencia online',
  summary: 'Resumen ejecutivo',
};

const STATUS_DOT: Record<CheckStatus, string> = {
  pass: 'bg-lime-300 shadow-[0_0_8px_rgba(190,242,100,0.6)]',
  warn: 'bg-orange-300 shadow-[0_0_8px_rgba(253,186,116,0.55)]',
  fail: 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.6)]',
  na: 'bg-violet-300/30',
};

interface Props {
  events: AuditorSSEEvent[];
  running: boolean;
}

export function AuditProgress({ events, running }: Props): React.ReactElement {
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al ultimo evento mientras corre la auditoria.
  useEffect(() => {
    if (running) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [events.length, running]);

  if (events.length === 0) {
    return (
      <div className="holo-card p-5 text-sm text-violet-300/45">
        {running ? 'Conectando...' : 'Los pasos de la auditoria apareceran aqui, en vivo.'}
      </div>
    );
  }

  return (
    <div className="holo-card holo-tick p-4">
      <ol className="relative flex flex-col gap-0.5 pl-4">
        {/* Riel del timeline */}
        <span
          aria-hidden
          className="absolute bottom-2 left-[5px] top-2 w-px bg-gradient-to-b from-fuchsia-400/50 via-violet-500/25 to-violet-500/10"
        />
        {events.map((event, i) => (
          <li key={i} className="animate-fade-in-up relative">
            {renderEvent(event)}
          </li>
        ))}
        {running && (
          <li className="relative flex items-center gap-2.5 py-1.5 text-xs text-violet-300/60">
            <span className="relative -ml-4 inline-flex h-[11px] w-[11px] shrink-0 items-center justify-center">
              <span className="dot-ping relative inline-flex h-2 w-2 rounded-full bg-fuchsia-400 text-fuchsia-400" />
            </span>
            trabajando...
          </li>
        )}
      </ol>
      <div ref={endRef} />
    </div>
  );
}

function renderEvent(event: AuditorSSEEvent): React.ReactElement | null {
  switch (event.type) {
    case 'start':
      return (
        <div className="-ml-4 mb-2 border border-violet-400/15 bg-[#0a0514]/70 px-3 py-2 text-sm text-violet-100/85">
          Auditando <span className="font-semibold text-violet-50">{event.businessName}</span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-violet-300/40">
            {event.url}
          </span>
        </div>
      );
    case 'phase': {
      if (event.status === 'running') {
        return (
          <div className="-ml-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-300/70">
            {PHASE_LABEL[event.phase]}
          </div>
        );
      }
      if (event.status === 'skipped') {
        return (
          <div className="flex items-center gap-2.5 py-1 text-xs text-violet-300/40">
            <Dot className="bg-violet-300/30" />
            {PHASE_LABEL[event.phase]} omitido{event.detail ? ` — ${event.detail}` : ''}
          </div>
        );
      }
      // 'done' no necesita linea propia: los checks ya cuentan la historia.
      return null;
    }
    case 'check':
      return (
        <div className="flex items-start gap-2.5 py-[5px] text-[13px] leading-snug text-violet-100/80">
          <Dot className={STATUS_DOT[event.status]} />
          {event.title}
        </div>
      );
    case 'scores':
      return (
        <div className="flex items-center gap-2.5 py-1.5 text-xs font-medium text-cyan-300">
          <Dot className="bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.6)]" />
          Scores calculados — global {event.scores.overall}/100
        </div>
      );
    case 'error':
      // El detalle del error vive en el panel principal; aqui solo se marca
      // que la auditoria termino mal para que el log no quede "colgado".
      return (
        <div className="flex items-center gap-2.5 py-1.5 text-xs font-medium text-rose-300">
          <Dot className="bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.6)]" />
          La auditoria se detuvo
        </div>
      );
    default:
      // 'done' se muestra en el panel principal, no en el log.
      return null;
  }
}

function Dot({ className }: { className: string }): React.ReactElement {
  return (
    <span
      aria-hidden
      className={`-ml-4 mt-[5px] inline-block h-[7px] w-[7px] shrink-0 rounded-full ${className}`}
    />
  );
}

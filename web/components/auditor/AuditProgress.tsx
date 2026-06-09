'use client';

import type { AuditorSSEEvent, AuditPhase, CheckStatus } from '../../lib/auditor-types';

const PHASE_LABEL: Record<AuditPhase, string> = {
  fetch: 'Descargando el sitio',
  onpage: 'SEO tecnico on-page',
  geo: 'Preparacion GEO (visibilidad en IA)',
  presence: 'Presencia online',
  summary: 'Resumen ejecutivo',
};

const STATUS_ICON: Record<CheckStatus, string> = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
  na: '·',
};

interface Props {
  events: AuditorSSEEvent[];
  running: boolean;
}

export function AuditProgress({ events, running }: Props): React.ReactElement {
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-ink-800 bg-ink-900 p-4 text-sm text-ink-500">
        {running ? 'Conectando...' : 'Los pasos de la auditoria apareceran aqui.'}
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-1 text-sm">
      {events.map((event, i) => (
        <li key={i} className="animate-fade-in-up">
          {renderEvent(event)}
        </li>
      ))}
      {running && <li className="px-3 py-1 text-xs text-ink-500">trabajando...</li>}
    </ol>
  );
}

function renderEvent(event: AuditorSSEEvent): React.ReactElement | null {
  switch (event.type) {
    case 'start':
      return (
        <div className="rounded-md border border-ink-800 bg-ink-900 px-3 py-2 text-ink-300">
          Auditando <span className="font-medium text-ink-100">{event.businessName}</span>{' '}
          <span className="text-xs text-ink-500">({event.url})</span>
        </div>
      );
    case 'phase': {
      if (event.status === 'running') {
        return <div className="px-3 py-1 text-xs text-ink-400">{PHASE_LABEL[event.phase]}...</div>;
      }
      const icon = event.status === 'done' ? '✔' : '↷';
      return (
        <div className="px-3 py-1 text-xs text-ink-500">
          {icon} {PHASE_LABEL[event.phase]}
          {event.detail ? ` — ${event.detail}` : ''}
          {event.status === 'skipped' ? ' (omitido)' : ''}
        </div>
      );
    }
    case 'check':
      return (
        <div className="flex items-start gap-2 rounded-md border border-ink-800 bg-ink-900 px-3 py-1.5">
          <span aria-hidden>{STATUS_ICON[event.status]}</span>
          <span className="text-ink-200">{event.title}</span>
        </div>
      );
    case 'scores':
      return (
        <div className="px-3 py-1 text-xs text-emerald-400">
          Scores calculados — global {event.scores.overall}/100
        </div>
      );
    default:
      // 'done' y 'error' se muestran en el panel principal, no en el log.
      return null;
  }
}

'use client';

import { useCallback, useState } from 'react';
import { AuditorForm } from './AuditorForm';
import { AuditProgress } from './AuditProgress';
import { ScoreCards } from './ScoreCards';
import { FindingsList } from './FindingsList';
import { exportReportPdf } from './export';
import type { AuditorRequest, AuditorSSEEvent, AuditReport } from '../../lib/auditor-types';

export function AuditorApp(): React.ReactElement {
  const [events, setEvents] = useState<AuditorSSEEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const handleSubmit = useCallback(async (params: AuditorRequest) => {
    setEvents([]);
    setReport(null);
    setErrorMsg(null);
    setRunning(true);

    try {
      const res = await fetch('/api/auditor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok || !res.body) {
        const text = await res.text();
        setErrorMsg(extractError(text) ?? `HTTP ${res.status}`);
        setRunning(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const event = parseSSEFrame(part);
          if (!event) continue;
          setEvents((prev) => [...prev, event]);
          if (event.type === 'done') {
            setReport(event.report);
          } else if (event.type === 'error') {
            setErrorMsg(event.message);
          }
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, []);

  const handleExport = useCallback(async () => {
    if (!report) return;
    setExporting(true);
    try {
      await exportReportPdf(report);
    } finally {
      setExporting(false);
    }
  }, [report]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="flex flex-col gap-6">
        <div
          className="card-glass animate-rise rounded-2xl p-6 sm:p-7"
          style={{ animationDelay: '120ms' }}
        >
          <AuditorForm onSubmit={handleSubmit} disabled={running} />
        </div>

        {report && (
          <>
            <ScoreCards scores={report.scores} />

            {report.executiveSummary && (
              <div
                className="card-glass animate-rise relative overflow-hidden rounded-2xl p-6"
                style={{ animationDelay: '150ms' }}
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-emerald-400 to-emerald-400/10"
                />
                <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">
                  <span aria-hidden>❝</span> Resumen ejecutivo
                </h2>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-100">
                  {report.executiveSummary}
                </p>
              </div>
            )}

            <div
              className="animate-rise flex items-center justify-between"
              style={{ animationDelay: '200ms' }}
            >
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-300">
                Hallazgos priorizados ({report.findings.length})
              </h2>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                className="card-glass inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium text-ink-100 transition duration-200 hover:border-emerald-400/40 hover:text-emerald-300 disabled:cursor-not-allowed disabled:text-ink-500"
              >
                <span aria-hidden>⬇</span>
                {exporting ? 'Generando PDF...' : 'Descargar PDF'}
              </button>
            </div>
            <FindingsList findings={report.findings} />

            {report.warnings.length > 0 && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-200/90">
                {report.warnings.map((warning, i) => (
                  <p key={i}>• {warning}</p>
                ))}
              </div>
            )}
          </>
        )}

        {errorMsg && (
          <div className="animate-rise flex items-start gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/5 p-5 text-sm text-rose-200">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-[11px] font-bold text-rose-300"
            >
              !
            </span>
            <span>
              <strong>Error:</strong> {errorMsg}
            </span>
          </div>
        )}
      </section>

      <aside
        className="animate-rise lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-auto"
        style={{ animationDelay: '220ms' }}
      >
        <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-ink-400">
          Progreso en vivo
        </h2>
        <AuditProgress events={events} running={running} />
      </aside>
    </div>
  );
}

function parseSSEFrame(frame: string): AuditorSSEEvent | null {
  const lines = frame.split('\n');
  let dataLine = '';
  for (const line of lines) {
    if (line.startsWith('data:')) dataLine = line.slice(5).trim();
  }
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine) as AuditorSSEEvent;
  } catch {
    return null;
  }
}

function extractError(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error ?? null;
  } catch {
    return text || null;
  }
}

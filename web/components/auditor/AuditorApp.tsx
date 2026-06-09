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
        <div className="rounded-md border border-ink-800 bg-ink-900 p-4">
          <AuditorForm onSubmit={handleSubmit} disabled={running} />
        </div>

        {report && (
          <>
            <ScoreCards scores={report.scores} />

            {report.executiveSummary && (
              <div className="rounded-md border border-emerald-700/40 bg-emerald-900/20 p-4">
                <h2 className="mb-1 text-sm font-semibold text-emerald-300">Resumen ejecutivo</h2>
                <p className="whitespace-pre-wrap text-sm text-ink-100">
                  {report.executiveSummary}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-300">
                Hallazgos priorizados ({report.findings.length})
              </h2>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 transition hover:bg-ink-700 disabled:cursor-not-allowed disabled:text-ink-500"
              >
                {exporting ? 'Generando PDF...' : 'Descargar PDF'}
              </button>
            </div>
            <FindingsList findings={report.findings} />

            {report.warnings.length > 0 && (
              <div className="rounded-md border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-200">
                {report.warnings.map((warning, i) => (
                  <p key={i}>• {warning}</p>
                ))}
              </div>
            )}
          </>
        )}

        {errorMsg && (
          <div className="rounded-md border border-rose-700/40 bg-rose-900/20 p-4 text-sm text-rose-200">
            <strong>Error:</strong> {errorMsg}
          </div>
        )}
      </section>

      <aside className="lg:max-h-[calc(100vh-8rem)] lg:overflow-auto">
        <h2 className="mb-2 text-sm font-semibold text-ink-300">Progreso</h2>
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

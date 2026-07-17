'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AuditorForm } from './AuditorForm';
import { AuditProgress } from './AuditProgress';
import { ScoreCards } from './ScoreCards';
import { FindingsList } from './FindingsList';
import { AuditHistory, DeltaBadge } from './AuditHistory';
import { exportReportPdf } from './export';
import { IconDownload, IconHexAlert, IconQuote } from './icons';
import {
  appendEntry,
  clearHistory,
  entryFromReport,
  loadHistory,
  persistHistory,
  type AuditHistoryEntry,
} from '@/lib/auditor-history';
import { buildSalesSummary } from '@/lib/sales-summary';
import type { AuditorRequest, AuditorSSEEvent, AuditReport } from '@/lib/auditor-types';

export function AuditorApp(): React.ReactElement {
  const [events, setEvents] = useState<AuditorSSEEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [history, setHistory] = useState<AuditHistoryEntry[]>([]);
  const [delta, setDelta] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const recordAudit = useCallback((done: AuditReport) => {
    const entry = entryFromReport(done);
    setHistory((prev) => {
      const { list, previous } = appendEntry(prev, entry);
      persistHistory(list);
      setDelta(previous ? entry.scores.overall - previous.scores.overall : null);
      return list;
    });
  }, []);

  const handleSubmit = useCallback(
    async (params: AuditorRequest) => {
      setEvents([]);
      setReport(null);
      setErrorMsg(null);
      setDelta(null);
      setCopied(false);
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
              recordAudit(event.report);
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
    },
    [recordAudit],
  );

  const handleCopySummary = useCallback(async () => {
    if (!report) return;
    const text = buildSalesSummary(report);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback para contextos sin Clipboard API (http, permisos).
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2200);
  }, [report]);

  const handleClearHistory = useCallback(() => {
    clearHistory();
    setHistory([]);
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
          className="holo-card holo-tick animate-rise p-6 sm:p-7"
          style={{ animationDelay: '120ms' }}
        >
          <AuditorForm onSubmit={handleSubmit} disabled={running} />
        </div>

        {report && (
          <>
            {delta !== null && (
              <div
                className={`animate-rise flex items-center gap-2.5 border p-3 text-xs font-medium ${
                  delta >= 0
                    ? 'border-lime-300/25 bg-lime-400/[0.06] text-lime-200'
                    : 'border-rose-400/25 bg-rose-500/[0.06] text-rose-200'
                }`}
              >
                <DeltaBadge delta={delta} />
                <span>
                  {delta > 0
                    ? `El sitio mejoró ${delta} punto(s) desde la auditoría anterior.`
                    : delta < 0
                      ? `El sitio bajó ${Math.abs(delta)} punto(s) desde la auditoría anterior.`
                      : 'Mismo score que la auditoría anterior de este sitio.'}
                </span>
              </div>
            )}
            <ScoreCards scores={report.scores} />

            {report.executiveSummary && (
              <div className="holo-card animate-rise p-6" style={{ animationDelay: '150ms' }}>
                <h2 className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                  <IconQuote className="h-4 w-4" /> Resumen ejecutivo
                </h2>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-violet-50/95">
                  {report.executiveSummary}
                </p>
              </div>
            )}

            <div
              className="animate-rise flex items-center justify-between"
              style={{ animationDelay: '200ms' }}
            >
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-violet-200/75">
                Hallazgos priorizados ({report.findings.length})
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopySummary}
                  className="holo-card inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-violet-100 transition duration-200 hover:border-cyan-300/50 hover:text-cyan-300"
                >
                  {copied ? 'Copiado ✓' : 'Copiar resumen'}
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting}
                  className="holo-card inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-violet-100 transition duration-200 hover:border-fuchsia-400/50 hover:text-fuchsia-300 disabled:cursor-not-allowed disabled:text-violet-300/30"
                >
                  <IconDownload className="h-4 w-4" />
                  {exporting ? 'Generando PDF...' : 'Descargar PDF'}
                </button>
              </div>
            </div>
            <FindingsList findings={report.findings} />

            {report.warnings.length > 0 && (
              <div className="border border-orange-300/20 bg-orange-400/[0.06] p-4 text-xs leading-relaxed text-orange-200/85">
                {report.warnings.map((warning, i) => (
                  <p key={i}>• {warning}</p>
                ))}
              </div>
            )}
          </>
        )}

        {errorMsg && (
          <div className="animate-rise flex items-start gap-3 border border-rose-400/25 bg-rose-500/[0.07] p-5 text-sm text-rose-100">
            <IconHexAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
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
        <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-violet-300/55">
          Progreso en vivo
        </h2>
        <AuditProgress events={events} running={running} />
        <AuditHistory history={history} onClear={handleClearHistory} />
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

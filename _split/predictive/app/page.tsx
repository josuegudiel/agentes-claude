'use client';

import { useCallback, useState } from 'react';
import { AgentSteps } from '@/components/AgentSteps';
import { ForecastChart } from '@/components/ForecastChart';
import { HealthBadges } from '@/components/HealthBadges';
import { PredictForm } from '@/components/PredictForm';
import type { ForecastSummaryClient, SSEEvent } from '@/lib/types';

export default function HomePage(): React.ReactElement {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<ForecastSummaryClient | null>(null);
  const [finalText, setFinalText] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (params: { series: number[]; horizon: number; question: string }) => {
      setEvents([]);
      setSummary(null);
      setFinalText('');
      setErrorMsg(null);
      setRunning(true);

      try {
        const res = await fetch('/api/predict', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params),
        });
        if (!res.ok || !res.body) {
          const text = await res.text();
          setErrorMsg(text || `HTTP ${res.status}`);
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
            if (event.type === 'final') {
              setFinalText(event.text);
            } else if (event.type === 'done') {
              setSummary(event.lastSummary);
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
    [],
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Agente predictivo
          </h1>
          <p className="text-sm text-ink-400">
            TimesFM 2.0 (forecast) + Ollama (razonamiento) — todo open source.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/auditor"
            className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700"
          >
            Auditor GEO/SEO -&gt;
          </a>
          <a
            href="/scanner"
            className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700"
          >
            Abrir scanner -&gt;
          </a>
          <HealthBadges />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex flex-col gap-6">
          <div className="rounded-md border border-ink-800 bg-ink-900 p-4">
            <PredictForm onSubmit={handleSubmit} disabled={running} />
          </div>

          <ForecastChart data={summary} />

          {finalText && (
            <div className="rounded-md border border-emerald-700/40 bg-emerald-900/20 p-4">
              <h2 className="mb-1 text-sm font-semibold text-emerald-300">
                Interpretacion
              </h2>
              <p className="whitespace-pre-wrap text-sm text-ink-100">
                {finalText}
              </p>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-md border border-rose-700/40 bg-rose-900/20 p-4 text-sm text-rose-200">
              <strong>Error:</strong> {errorMsg}
            </div>
          )}
        </section>

        <aside className="lg:max-h-[calc(100vh-8rem)] lg:overflow-auto">
          <h2 className="mb-2 text-sm font-semibold text-ink-300">Pasos</h2>
          <AgentSteps events={events} running={running} />
        </aside>
      </div>

      <footer className="mt-auto border-t border-ink-800 pt-4 text-xs text-ink-500">
        <code>POST /api/predict</code> stream SSE · arranca todo con{' '}
        <code>pnpm predict:up</code> (sidecar Python) +{' '}
        <code>ollama serve</code> +{' '}
        <code>pnpm web:dev</code>.
      </footer>
    </main>
  );
}

function parseSSEFrame(frame: string): SSEEvent | null {
  const lines = frame.split('\n');
  let dataLine = '';
  for (const line of lines) {
    if (line.startsWith('data:')) dataLine = line.slice(5).trim();
  }
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine) as SSEEvent;
  } catch {
    return null;
  }
}

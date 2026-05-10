'use client';

import type { SSEEvent } from '../lib/types';

interface Props {
  events: SSEEvent[];
  running: boolean;
}

export function AgentSteps({ events, running }: Props): React.ReactElement {
  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-dashed border-ink-800 p-6 text-sm text-ink-500">
        Los pasos del agente aparecen aqui en vivo.
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-2 text-sm">
      {events.map((event, i) => (
        <li key={i} className="animate-step">
          <Step event={event} />
        </li>
      ))}
      {running && (
        <li className="flex items-center gap-2 text-ink-400">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
          <span>pensando...</span>
        </li>
      )}
    </ol>
  );
}

function Step({ event }: { event: SSEEvent }): React.ReactElement {
  switch (event.type) {
    case 'start':
      return (
        <Row icon="▶" tone="ink-400" title="Inicio">
          <code className="text-xs text-ink-400">{event.goal.slice(0, 100)}…</code>
        </Row>
      );
    case 'preflight':
      return (
        <Row icon="✓" tone="emerald-400" title="Preflight ok">
          <span className="text-xs text-ink-400">
            TimesFM: {event.timesfmModel} · Ollama: {event.ollamaModel}
          </span>
        </Row>
      );
    case 'assistant_message':
      if (event.hasToolCalls) {
        return (
          <Row icon="…" tone="cyan-400" title="Asistente piensa">
            <span className="text-xs text-ink-400">decidio llamar tools</span>
          </Row>
        );
      }
      return (
        <Row icon="◆" tone="ink-200" title="Asistente responde">
          <span className="text-xs text-ink-300">
            {event.text.slice(0, 120)}
            {event.text.length > 120 ? '…' : ''}
          </span>
        </Row>
      );
    case 'tool_call':
      return (
        <Row icon="🔧" tone="amber-400" title={`Llama ${event.name}`}>
          <code className="block max-h-16 overflow-auto rounded bg-ink-950 p-2 text-xs text-amber-200">
            {prettyArgs(event.args)}
          </code>
        </Row>
      );
    case 'tool_result': {
      const ok =
        typeof event.result === 'object' &&
        event.result !== null &&
        (event.result as Record<string, unknown>)['ok'] === true;
      return (
        <Row
          icon={ok ? '✓' : '✗'}
          tone={ok ? 'emerald-400' : 'rose-400'}
          title={`${event.name} ${ok ? 'ok' : 'fallo'}`}
        >
          <code className="block max-h-20 overflow-auto rounded bg-ink-950 p-2 text-xs text-ink-300">
            {summarizeResult(event.result)}
          </code>
        </Row>
      );
    }
    case 'final':
      return (
        <Row icon="🏁" tone="emerald-400" title={`Final · ${event.steps} pasos`}>
          <></>
        </Row>
      );
    case 'done':
      return (
        <Row icon="●" tone="emerald-400" title="Done">
          <span className="text-xs text-ink-400">
            {event.toolCalls.length} tool calls totales
          </span>
        </Row>
      );
    case 'error':
      return (
        <Row icon="!" tone="rose-400" title="Error">
          <span className="text-xs text-rose-300">{event.message}</span>
        </Row>
      );
  }
}

type Tone = 'ink-200' | 'ink-400' | 'cyan-400' | 'amber-400' | 'emerald-400' | 'rose-400';

const TONE_CLASS: Record<Tone, string> = {
  'ink-200': 'text-ink-200',
  'ink-400': 'text-ink-400',
  'cyan-400': 'text-cyan-400',
  'amber-400': 'text-amber-400',
  'emerald-400': 'text-emerald-400',
  'rose-400': 'text-rose-400',
};

function Row({
  icon,
  tone,
  title,
  children,
}: {
  icon: string;
  tone: Tone;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-ink-800 bg-ink-900 p-2.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded text-xs ${TONE_CLASS[tone]}`}
        >
          {icon}
        </span>
        <span className="font-medium">{title}</span>
      </div>
      <div className="mt-1 pl-7">{children}</div>
    </div>
  );
}

function prettyArgs(args: unknown): string {
  try {
    const json = JSON.stringify(args, null, 0);
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  } catch {
    return String(args);
  }
}

function summarizeResult(result: unknown): string {
  if (result === null || typeof result !== 'object') return String(result);
  const obj = result as Record<string, unknown>;
  if (obj['ok'] === false) {
    return `${String(obj['code'] ?? 'ERROR')}: ${String(obj['message'] ?? '?')}`;
  }
  if (typeof obj['text'] === 'string') {
    const t = obj['text'] as string;
    return t.length > 200 ? `${t.slice(0, 200)}…` : t;
  }
  if (obj['summary']) {
    const s = obj['summary'] as Record<string, unknown>;
    const fc = s['forecast'] as Record<string, number> | undefined;
    if (fc) return `next=${fc['next']}, end=${fc['end']}, Δ=${fc['deltaPct']?.toFixed(1)}%`;
  }
  return JSON.stringify(obj).slice(0, 200);
}

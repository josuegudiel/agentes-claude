'use client';

import { useEffect, useState } from 'react';
import type { HealthResponse } from '../lib/types';

const POLL_MS = 30_000;

export function HealthBadges(): React.ReactElement {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchHealth(): Promise<void> {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const body = (await res.json()) as HealthResponse;
        if (!cancelled) {
          setHealth(body);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchHealth();
    const id = setInterval(() => void fetchHealth(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // El label del segundo badge cambia segun si la API usa Groq o Ollama.
  // El campo `ollama.model` viene con prefijo "groq: ..." o "ollama: ..."
  // desde /api/health para facilitar la decision aqui.
  const provider = health?.ollama.model?.split(':')[0]?.trim() ?? 'LLM';
  const providerLabel = provider === 'groq' ? 'Groq' : provider === 'ollama' ? 'Ollama' : 'LLM';

  return (
    <div className="flex items-center gap-2 text-xs">
      <Badge
        label="TimesFM"
        ready={health?.timesfm.ready ?? false}
        loading={loading}
        detail={health?.timesfm.model ?? health?.timesfm.error ?? '...'}
      />
      <Badge
        label={providerLabel}
        ready={health?.ollama.ready ?? false}
        loading={loading}
        detail={health?.ollama.model ?? health?.ollama.error ?? '...'}
      />
    </div>
  );
}

function Badge({
  label,
  ready,
  loading,
  detail,
}: {
  label: string;
  ready: boolean;
  loading: boolean;
  detail: string;
}): React.ReactElement {
  const dotColor = loading
    ? 'bg-ink-500 animate-pulse'
    : ready
      ? 'bg-emerald-500'
      : 'bg-rose-500';
  return (
    <span
      title={detail}
      className="inline-flex items-center gap-1.5 rounded-md border border-ink-800 bg-ink-900 px-2 py-1"
    >
      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      <span className="font-medium">{label}</span>
      <span className="text-ink-400 max-w-[180px] truncate">{detail}</span>
    </span>
  );
}

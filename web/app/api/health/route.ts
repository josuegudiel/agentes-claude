import { NextResponse } from 'next/server';
import { OllamaClient } from '../../../../src/agents/predictive/ollama-client';
import { TimesFMClient } from '../../../../src/agents/predictive/timesfm-client';
import type { HealthResponse } from '../../../lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function buildClients() {
  const ollama = new OllamaClient({
    baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
    model: process.env['OLLAMA_MODEL'] ?? 'llama3.1:8b',
  });
  const timesfm = new TimesFMClient({
    baseUrl: process.env['PREDICTIVE_SERVICE_URL'] ?? 'http://localhost:8765',
  });
  return { ollama, timesfm };
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const { ollama, timesfm } = buildClients();

  // Corremos en paralelo. Cada chequeo tiene su propio try/catch para que
  // un servicio caido no oculte el estado del otro.
  const [ollamaResult, timesfmResult] = await Promise.all([
    ollama.preflight().then(
      (err) => ({ ready: err === null, error: err ?? undefined }),
      (err: Error) => ({ ready: false, error: err.message }),
    ),
    timesfm
      .health()
      .then(
        (h) => ({ ready: h.status === 'ok', status: h.status, model: h.model }),
        (err: Error) => ({ ready: false, status: 'unreachable' as const, error: err.message }),
      ),
  ]);

  const body: HealthResponse = {
    ok: ollamaResult.ready && timesfmResult.ready,
    ollama: {
      ready: ollamaResult.ready,
      model: ollama.modelName,
      ...(ollamaResult.error ? { error: ollamaResult.error } : {}),
    },
    timesfm: {
      ready: timesfmResult.ready,
      status: 'status' in timesfmResult ? timesfmResult.status : 'unreachable',
      ...(('model' in timesfmResult && timesfmResult.model) ? { model: timesfmResult.model } : {}),
      ...(('error' in timesfmResult && timesfmResult.error) ? { error: timesfmResult.error } : {}),
    },
  };
  return NextResponse.json(body);
}

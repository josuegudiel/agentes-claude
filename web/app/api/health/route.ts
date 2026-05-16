import { NextResponse } from 'next/server';
import {
  makeChatClient,
  chatClientProvider,
} from '../../../../src/agents/predictive/chat-client-factory';
import { TimesFMClient } from '../../../../src/agents/predictive/timesfm-client';
import type { HealthResponse } from '../../../lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse<HealthResponse>> {
  // Construimos los clients aqui — si la GROQ_API_KEY falta y querias Groq,
  // makeChatClient() tira; lo capturamos como error claro.
  let chatErr: string | null = null;
  let chatModel = '(unknown)';
  let chatProvider: 'groq' | 'ollama' = chatClientProvider();
  let chatReady = false;
  try {
    const client = makeChatClient();
    chatModel = client.modelName;
    const r = await client.preflight();
    chatReady = r === null;
    chatErr = r;
  } catch (err) {
    chatErr = err instanceof Error ? err.message : String(err);
  }

  const timesfm = new TimesFMClient({
    baseUrl: process.env['PREDICTIVE_SERVICE_URL'] ?? 'http://localhost:8765',
  });
  const timesfmResult = await timesfm
    .health()
    .then(
      (h) => ({ ready: h.status === 'ok', status: h.status, model: h.model }),
      (err: Error) => ({ ready: false, status: 'unreachable' as const, error: err.message }),
    );

  const body: HealthResponse = {
    ok: chatReady && timesfmResult.ready,
    ollama: {
      ready: chatReady,
      model: `${chatProvider}: ${chatModel}`,
      ...(chatErr ? { error: chatErr } : {}),
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

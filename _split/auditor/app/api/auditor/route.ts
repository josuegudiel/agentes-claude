import { AuditRequestSchema } from '@/agents/geo-auditor/schema';
import { runGeoAudit } from '@/agents/geo-auditor/engine';
import { SiteFetchError } from '@/agents/geo-auditor/site-fetcher';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';
import type { AuditorSSEEvent } from '@/lib/auditor-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// maxDuration como config de segmento (Vercel lo respeta sin depender del
// glob de `functions` en vercel.json, que no matchea en monorepos).
export const maxDuration = 60;

// Mas estricto que /api/predict: cada auditoria hace varios fetch externos
// y (si hay claves) consume cuota de Tavily y Groq.
const RATE_LIMIT_ENABLED = process.env['NODE_ENV'] === 'production';
const RATE_LIMIT_PER_IP = Number(process.env['AUDITOR_RATE_LIMIT_PER_IP'] ?? 3);
const RATE_LIMIT_WINDOW_MS = Number(process.env['RATE_LIMIT_WINDOW_MS'] ?? 10 * 60 * 1000);

function sseFormat(event: AuditorSSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request): Promise<Response> {
  // Rate limit antes de parsear el body — protege contra spam mas barato.
  if (RATE_LIMIT_ENABLED) {
    const key = clientKey(req);
    const rl = checkRateLimit(key, {
      limit: RATE_LIMIT_PER_IP,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!rl.ok) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
      return new Response(
        JSON.stringify({
          error: 'Demasiadas auditorias desde esta IP. Espera un rato.',
          retryAfter,
        }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': String(retryAfter),
          },
        },
      );
    }
  }

  let parsed: ReturnType<typeof AuditRequestSchema.parse>;
  try {
    const body: unknown = await req.json();
    parsed = AuditRequestSchema.parse(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid body';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: AuditorSSEEvent): void => {
        try {
          controller.enqueue(encoder.encode(sseFormat(event)));
        } catch {
          // Cliente cerro el stream — no podemos hacer mucho.
        }
      };

      try {
        const report = await runGeoAudit(parsed, { onEvent: send });
        send({ type: 'done', report });
      } catch (err) {
        const code = err instanceof SiteFetchError ? err.code : 'AUDIT_FAILED';
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message, code });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

import { AuditRequestSchema } from '../../../../src/agents/geo-auditor/schema';
import { runGeoAudit } from '../../../../src/agents/geo-auditor/engine';
import { SiteFetchError } from '../../../../src/agents/geo-auditor/site-fetcher';
import { checkRateLimit, clientKey } from '../../../lib/rate-limit';
import type { AuditorSSEEvent } from '../../../lib/auditor-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Parseo defensivo de env numerico: un valor invalido (typo, espacios) NO
// debe desactivar silenciosamente el rate limit -> cae al default.
function posIntEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Mas estricto que /api/predict: cada auditoria hace varios fetch externos
// y (si hay claves) consume cuota de Tavily y Groq.
const RATE_LIMIT_ENABLED = process.env['NODE_ENV'] === 'production';
const RATE_LIMIT_PER_IP = posIntEnv('AUDITOR_RATE_LIMIT_PER_IP', 3);
const RATE_LIMIT_WINDOW_MS = posIntEnv('RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000);

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

  // Aborta la auditoria (fetch del sitio, Tavily, Groq) si el cliente cierra
  // la conexion, para no gastar cuota/CPU en un resultado que nadie recibira.
  const ac = new AbortController();
  req.signal.addEventListener('abort', () => ac.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: AuditorSSEEvent): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseFormat(event)));
        } catch {
          // Cliente cerro el stream — no podemos hacer mucho.
        }
      };

      try {
        const report = await runGeoAudit(parsed, { onEvent: send, signal: ac.signal });
        send({ type: 'done', report });
      } catch (err) {
        if (ac.signal.aborted) {
          // Cliente desconectado: no hay a quien enviar el error.
        } else if (err instanceof SiteFetchError) {
          // SiteFetchError trae codigos estables y mensajes ya saneados.
          send({ type: 'error', message: err.message, code: err.code });
        } else {
          // Error inesperado: no filtrar detalles internos al cliente.
          send({ type: 'error', message: 'Error interno al auditar el sitio.', code: 'AUDIT_FAILED' });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Ya cerrado por cancelacion del cliente.
        }
      }
    },
    cancel() {
      ac.abort();
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

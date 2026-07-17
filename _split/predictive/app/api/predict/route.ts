import { z } from 'zod';
import { makeChatClient } from '@/agents/predictive/chat-client-factory';
import { TimesFMClient } from '@/agents/predictive/timesfm-client';
import {
  runPredictiveAgent,
  type AgentEvent,
} from '@/agents/predictive/runtime';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';
import type { SSEEvent, ForecastSummaryClient } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// maxDuration como config de segmento (Vercel lo respeta sin depender del
// glob de `functions` en vercel.json, que no matchea en monorepos).
export const maxDuration = 60;

const RequestSchema = z.object({
  series: z.array(z.number().finite()).min(8).max(4096),
  horizon: z.number().int().min(1).max(64).default(12),
  question: z.string().max(500).optional(),
});

// Limites mas conservadores en produccion (Vercel) para proteger las cuotas
// gratuitas de Groq / Hugging Face. En local desactivamos rate limit.
const RATE_LIMIT_ENABLED = process.env['NODE_ENV'] === 'production';
const RATE_LIMIT_PER_IP = Number(process.env['RATE_LIMIT_PER_IP'] ?? 10);
const RATE_LIMIT_WINDOW_MS = Number(process.env['RATE_LIMIT_WINDOW_MS'] ?? 10 * 60 * 1000);

function sseFormat(event: SSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function buildGoal(series: number[], horizon: number, question?: string): string {
  const head = series.slice(0, 5).join(', ');
  const tail = series.slice(-5).join(', ');
  const q = question?.trim();
  return [
    `Predice ${horizon} pasos hacia adelante para esta serie de ${series.length} valores.`,
    `Inicio: [${head}]; Fin: [${tail}].`,
    `Llama forecast_series con la serie completa, frequency=0 (alta), horizon=${horizon}.`,
    'Despues llama interpret_forecast para resumir la tendencia y los riesgos.',
    q ? `Pregunta del usuario: "${q}"` : '',
    'Responde en espanol.',
  ]
    .filter(Boolean)
    .join(' ');
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
          error: 'Demasiadas predicciones desde esta IP. Espera un rato.',
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

  let parsed: z.infer<typeof RequestSchema>;
  try {
    const body: unknown = await req.json();
    parsed = RequestSchema.parse(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid body';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { series, horizon, question } = parsed;
  const goal = buildGoal(series, horizon, question);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: SSEEvent): void => {
        try {
          controller.enqueue(encoder.encode(sseFormat(event)));
        } catch {
          // Cliente cerro el stream — no podemos hacer mucho.
        }
      };

      send({ type: 'start', goal });
      // Factory: usa Groq si hay GROQ_API_KEY, Ollama local si no.
      const ollama = makeChatClient();
      const timesfm = new TimesFMClient({
        baseUrl: process.env['PREDICTIVE_SERVICE_URL'] ?? 'http://localhost:8765',
      });

      // Capturamos la ultima respuesta de TimesFM para mandarsela al cliente
      // junto con la serie original (asi el chart puede pintar todo).
      let lastForecastPoint: number[] | undefined;
      let lastForecastP10: number[] | undefined;
      let lastForecastP90: number[] | undefined;

      const onStep = (event: AgentEvent): void => {
        if (event.type === 'tool_result' && event.name === 'forecast_series') {
          const r = event.result as Record<string, unknown> | null;
          if (r && r['ok'] === true) {
            const point = r['point_forecast'];
            const quantiles = r['quantile_forecast'] as Record<string, number[]> | undefined;
            if (Array.isArray(point)) lastForecastPoint = point as number[];
            if (quantiles?.['0.1']) lastForecastP10 = quantiles['0.1'];
            if (quantiles?.['0.9']) lastForecastP90 = quantiles['0.9'];
          }
        }
        send(event);
      };

      try {
        const result = await runPredictiveAgent({
          goal,
          ollama,
          timesfm,
          onStep,
        });
        const summary: ForecastSummaryClient | null = result.lastSummary
          ? {
              ...result.lastSummary,
              series,
              ...(lastForecastPoint ? { point: lastForecastPoint } : {}),
              ...(lastForecastP10 ? { p10: lastForecastP10 } : {}),
              ...(lastForecastP90 ? { p90: lastForecastP90 } : {}),
            }
          : null;
        send({
          type: 'done',
          lastSummary: summary,
          toolCalls: result.toolCalls,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message });
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

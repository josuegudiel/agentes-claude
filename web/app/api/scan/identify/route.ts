import { z } from 'zod';
import {
  runScannerAgent,
  ScanIdentifyInputSchema,
} from '../../../../../src/agents/scanner/index';
import { checkRateLimit, clientKey } from '../../../../lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Hard cap del payload base64 que aceptamos (~6 MB base64 = ~4.5 MB binario).
// La UI redimensiona antes de enviar; este limite es solo defensa en
// profundidad contra clientes maliciosos.
const MAX_BASE64_BYTES = 6 * 1024 * 1024;

const RATE_LIMIT_ENABLED = process.env['NODE_ENV'] === 'production';
const RATE_LIMIT_PER_IP = Number(process.env['SCAN_RATE_LIMIT_PER_IP'] ?? 20);
const RATE_LIMIT_WINDOW_MS = Number(
  process.env['SCAN_RATE_LIMIT_WINDOW_MS'] ?? 10 * 60 * 1000,
);

const BodySchema = ScanIdentifyInputSchema.extend({
  imageBase64: z
    .string()
    .min(32)
    .max(MAX_BASE64_BYTES, 'imagen demasiado grande'),
});

export async function POST(req: Request): Promise<Response> {
  if (RATE_LIMIT_ENABLED) {
    const rl = checkRateLimit(clientKey(req), {
      limit: RATE_LIMIT_PER_IP,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!rl.ok) {
      return jsonError(429, 'Rate limit excedido. Intenta en unos minutos.');
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'JSON invalido');
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues.map((i) => i.message).join('; '));
  }

  try {
    const out = await runScannerAgent(parsed.data);
    return Response.json({
      classification: out.classification,
      model: out.model,
      latencyMs: out.latencyMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ANTHROPIC_API_KEY')) {
      return jsonError(503, 'Servidor no configurado (falta ANTHROPIC_API_KEY)');
    }
    return jsonError(502, `Fallo identificando documento: ${msg}`);
  }
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

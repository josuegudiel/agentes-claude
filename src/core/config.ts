import 'dotenv/config';
import { z } from 'zod';

/**
 * Validacion del entorno al boot. Si falta una var critica, el proceso muere
 * antes de levantar un browser. Mas barato fallar aqui que despues de 30s.
 */
const schema = z.object({
  BASE_URL: z.string().url(),
  ENVIRONMENT: z.enum(['local', 'staging', 'production']).default('staging'),

  TEST_USER_EMAIL: z.string().email(),
  TEST_USER_PASSWORD: z.string().min(1),
  TEST_TENANT_SLUG: z.string().min(1).default('demo'),

  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),

  ANTHROPIC_API_KEY: z.string().optional(),
  AGENT_MODEL: z.string().default('claude-sonnet-4-6'),

  // --- Predictive agent (TimesFM sidecar + Ollama OSS LLM) ---
  // El sidecar Python (predictive-service/) corre TimesFM y expone /forecast.
  // Ollama corre el LLM open source que interpreta el forecast y orquesta tools.
  PREDICTIVE_SERVICE_URL: z.string().url().default('http://localhost:8765'),
  PREDICTIVE_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3.1:8b'),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  TIMESFM_HORIZON: z.coerce.number().int().positive().max(512).default(24),

  PW_WORKERS: z.coerce.number().int().positive().default(4),
  HEADLESS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  CI: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export type AppConfig = z.infer<typeof schema>;

function loadConfig(): AppConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuracion invalida. Revisa tu .env:\n${issues}`);
  }
  return parsed.data;
}

export const config = loadConfig();

export const isCI = config.CI === true;
export const isProd = config.ENVIRONMENT === 'production';

import pino from 'pino';

/**
 * Logger raiz. Usa `logger.child({ flow: 'patients' })` para contexto,
 * en vez de strings concatenados. En CI sale JSON (parseable);
 * en local, pretty.
 *
 * Lee env vars directamente con defaults seguros (en vez de via core/config)
 * para que el modulo sea autosuficiente y pueda usarse en contextos donde
 * el zod schema completo de config no aplica (Next.js routes, etc.).
 */
const LEVEL = (process.env['LOG_LEVEL'] ?? 'info') as pino.Level;
const FORMAT = process.env['LOG_FORMAT'] ?? 'pretty';
const IS_CI = process.env['CI'] === 'true' || process.env['CI'] === '1';
const ENV = process.env['ENVIRONMENT'] ?? 'local';

export const logger = pino({
  level: LEVEL,
  ...(FORMAT === 'pretty' && !IS_CI
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
            singleLine: false,
          },
        },
      }
    : {}),
  base: {
    env: ENV,
  },
  redact: {
    paths: ['password', '*.password', 'TEST_USER_PASSWORD', 'ADMIN_PASSWORD', 'ANTHROPIC_API_KEY'],
    censor: '[REDACTED]',
  },
});

export type Logger = typeof logger;

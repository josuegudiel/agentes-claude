import pino from 'pino';
import { config, isCI } from './config.js';

/**
 * Logger raiz. Usa `logger.child({ flow: 'patients' })` para contexto,
 * en vez de strings concatenados. En CI sale JSON (parseable);
 * en local, pretty.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.LOG_FORMAT === 'pretty' && !isCI
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
    env: config.ENVIRONMENT,
  },
  redact: {
    paths: ['password', '*.password', 'TEST_USER_PASSWORD', 'ADMIN_PASSWORD', 'ANTHROPIC_API_KEY'],
    censor: '[REDACTED]',
  },
});

export type Logger = typeof logger;

import { defineConfig } from 'vitest/config';

/**
 * Vitest config para tests unitarios. NO incluye los specs de Playwright
 * (`tests/e2e/**`) — esos los corre `pnpm test`. Aqui solo `*.test.ts`
 * colocalizados en `src/`.
 *
 * `env` se inyecta antes de que cualquier modulo importe `src/core/config.ts`,
 * que valida con zod al boot.
 */
export default defineConfig({
  test: {
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/*.test.ts',
      'web/lib/**/__tests__/**/*.test.ts',
      'web/lib/**/*.test.ts',
      'web/components/**/__tests__/**/*.test.ts',
    ],
    exclude: ['node_modules', '**/node_modules/**', 'tests/e2e/**', 'predictive-service/**', 'web/.next/**'],
    environment: 'node',
    reporters: ['default'],
    testTimeout: 10_000,
    isolate: true,
    env: {
      BASE_URL: 'http://localhost',
      ENVIRONMENT: 'local',
      TEST_USER_EMAIL: 'test@example.com',
      TEST_USER_PASSWORD: 'password123',
      TEST_TENANT_SLUG: 'test',
      LOG_LEVEL: 'fatal',
      LOG_FORMAT: 'json',
      PREDICTIVE_SERVICE_URL: 'http://localhost:8765',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OLLAMA_MODEL: 'llama3.1:8b',
    },
  },
});

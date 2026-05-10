import type { Page } from '@playwright/test';
import { loginAs } from '../flows/auth.flow.js';
import { createPatient } from '../flows/patients.flow.js';
import { makePatient } from '../fixtures/data/patients.js';
import { logger } from '../core/logger.js';
import { withRetry } from '../core/retry.js';

/**
 * Siembra un tenant demo con datos consistentes para sales/onboarding.
 * Es idempotente en el sentido de que si algun paciente ya existe,
 * el flow lo reporta y seguimos. Si quieres "limpiar antes" ver `reset.ts`.
 */
export async function seedDemoTenant(page: Page, count = 5): Promise<{ created: number }> {
  const log = logger.child({ script: 'seed-demo-tenant' });
  log.info({ count }, 'Sembrando tenant demo');

  await loginAs(page, 'admin');

  let created = 0;
  for (let i = 0; i < count; i++) {
    const input = makePatient({ firstName: `Demo${i + 1}` });
    try {
      await withRetry(() => createPatient(page, input), { retries: 2 });
      created++;
    } catch (err) {
      log.error({ err, input }, 'Fallo crear paciente — sigo con el siguiente');
    }
  }

  log.info({ created, target: count }, 'Seed terminado');
  return { created };
}

#!/usr/bin/env tsx
/**
 * CLI: siembra un tenant demo.
 *   pnpm seed:demo                # 5 pacientes
 *   pnpm seed:demo -- --count 20  # 20 pacientes
 */
import { withBrowser } from '../src/core/browser.js';
import { seedDemoTenant } from '../src/seed/demo-tenant.js';
import { logger } from '../src/core/logger.js';

function parseArgs(argv: string[]): { count: number } {
  const idx = argv.indexOf('--count');
  if (idx === -1) return { count: 5 };
  const value = argv[idx + 1];
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('--count debe ser un entero positivo');
  }
  return { count: parsed };
}

async function main(): Promise<void> {
  const { count } = parseArgs(process.argv);
  await withBrowser(async ({ page }) => {
    const result = await seedDemoTenant(page, count);
    logger.info(result, 'Listo');
  });
}

main().catch((err) => {
  logger.error({ err }, 'Seed fallo');
  process.exit(1);
});

#!/usr/bin/env tsx
/**
 * CLI: corre el agente LLM con un objetivo en lenguaje natural.
 *   pnpm agent:run -- "Crea un paciente llamado Juan Perez con email juan@test.com"
 */
import { withBrowser } from '../src/core/browser.js';
import { runAgent } from '../src/agents/runtime.js';
import { logger } from '../src/core/logger.js';

async function main(): Promise<void> {
  const goal = process.argv.slice(2).join(' ').trim();
  if (!goal) {
    console.error('Uso: pnpm agent:run -- "<objetivo en lenguaje natural>"');
    process.exit(2);
  }

  await withBrowser(async ({ page }) => {
    const result = await runAgent({ goal, page });
    logger.info({ steps: result.steps, toolCalls: result.toolCalls.length }, 'Agente termino');
    console.log('\n=== Respuesta del agente ===\n' + result.text + '\n');
  });
}

main().catch((err) => {
  logger.error({ err }, 'Agente fallo');
  process.exit(1);
});

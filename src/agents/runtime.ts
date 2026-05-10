import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import type { Page } from '@playwright/test';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { buildTools } from './tools.js';
import { SYSTEM_PROMPT } from './prompts.js';

/**
 * Runtime del agente: recibe una `page` ya abierta y un objetivo en lenguaje
 * natural, y deja que el LLM orqueste tools hasta resolverlo.
 *
 * No lanza el browser aqui — el caller decide (test fixture, script CLI,
 * worker en produccion). Asi puedes usar Playwright local o conectar a
 * Browserbase/Stagehand mas adelante sin tocar este archivo.
 */
export interface AgentRunOptions {
  goal: string;
  page: Page;
  maxSteps?: number;
}

export interface AgentRunResult {
  text: string;
  steps: number;
  toolCalls: { name: string; args: unknown; result: unknown }[];
}

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no esta configurado');
  }

  const log = logger.child({ component: 'agent.runtime' });
  log.info({ goal: opts.goal, model: config.AGENT_MODEL }, 'Iniciando agente');

  const tools = buildTools(opts.page);

  const result = await generateText({
    model: anthropic(config.AGENT_MODEL),
    system: SYSTEM_PROMPT,
    prompt: opts.goal,
    tools,
    maxSteps: opts.maxSteps ?? 10,
    onStepFinish: (step) => {
      log.debug(
        { step: step.stepType, toolCalls: step.toolCalls?.length ?? 0 },
        'Step terminado',
      );
    },
  });

  const toolCalls = (result.steps ?? []).flatMap((step) =>
    (step.toolCalls ?? []).map((tc, i) => ({
      name: tc.toolName,
      args: tc.args,
      result: step.toolResults?.[i]?.result ?? null,
    })),
  );

  log.info(
    { steps: result.steps?.length ?? 0, toolCalls: toolCalls.length },
    'Agente completo',
  );

  return {
    text: result.text,
    steps: result.steps?.length ?? 0,
    toolCalls,
  };
}

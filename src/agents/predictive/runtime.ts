import { logger } from '../../core/logger.js';
import { OllamaClient, type OllamaMessage } from './ollama-client.js';
import { TimesFMClient } from './timesfm-client.js';
import { buildPredictiveTools, type PredictiveTools } from './tools.js';
import { SYSTEM_PROMPT } from './prompts.js';
import type { ForecastSummary } from './schema.js';
import type { ChatClient } from './chat-client.js';
import { makeChatClient } from './chat-client-factory.js';

/**
 * Runtime del agente predictivo. Loop minimo de tool-use sobre Ollama:
 *
 *   1. system + user message
 *   2. ollama.chat() -> respuesta puede traer message.tool_calls
 *   3. para cada tool_call: dispatch local, append como mensaje role="tool"
 *   4. repite hasta que el modelo no pida mas tools o se llegue a maxSteps
 *
 * No usamos AI SDK aqui porque:
 *   - Su adapter de Ollama es comunitario, no oficial.
 *   - El loop es ~40 lineas; vale mas mantenerlo explicito.
 *
 * Si el modelo no soporta tool calling nativo (modelos viejos), Ollama
 * simplemente nunca emite tool_calls — caemos a generar texto plano.
 */

export interface PredictiveAgentOptions {
  goal: string;
  maxSteps?: number;
  timesfm?: TimesFMClient;
  /**
   * Chat client (Ollama local o Groq cloud). Si no se pasa, se elige
   * automaticamente: Groq si hay GROQ_API_KEY, Ollama en caso contrario.
   */
  ollama?: ChatClient;
  /**
   * Callback opcional invocado en cada paso del loop. Sirve para hacer
   * streaming via SSE desde un API route. NO debe lanzar — los errores se
   * tragan para no romper el agente.
   */
  onStep?: (event: AgentEvent) => void;
}

export type AgentEvent =
  | { type: 'preflight'; ollamaModel: string; timesfmModel: string; horizonMax: number }
  | { type: 'assistant_message'; text: string; hasToolCalls: boolean }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'final'; text: string; steps: number };

export interface PredictiveAgentResult {
  text: string;
  steps: number;
  toolCalls: { name: string; args: unknown; result: unknown }[];
  lastSummary: ForecastSummary | null;
  model: string;
}

export async function runPredictiveAgent(
  opts: PredictiveAgentOptions,
): Promise<PredictiveAgentResult> {
  const log = logger.child({ component: 'predictive.runtime' });

  const ollama: ChatClient = opts.ollama ?? makeChatClient();
  const timesfm = opts.timesfm ?? new TimesFMClient();
  const tools: PredictiveTools = buildPredictiveTools({ timesfm, ollama });
  const emit = (event: AgentEvent): void => {
    try {
      opts.onStep?.(event);
    } catch (err) {
      log.warn({ err }, 'onStep callback lanzo — ignorando');
    }
  };

  // Preflight: queremos errores claros ANTES de empezar el loop.
  const ollamaErr = await ollama.preflight();
  if (ollamaErr) throw new Error(`Ollama no esta listo: ${ollamaErr}`);

  const health = await timesfm.health();
  if (health.status === 'error') {
    throw new Error(`predictive-service esta en estado error con modelo ${health.model}`);
  }
  if (health.status === 'loading') {
    log.warn(
      { model: health.model },
      'TimesFM aun cargando — la primera llamada va a esperar a que termine',
    );
  }

  log.info(
    {
      goal: opts.goal,
      ollamaModel: ollama.modelName,
      timesfmModel: health.model,
    },
    'Iniciando agente predictivo',
  );

  emit({
    type: 'preflight',
    ollamaModel: ollama.modelName,
    timesfmModel: health.model,
    horizonMax: health.horizon_max,
  });

  const messages: OllamaMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: opts.goal },
  ];

  const maxSteps = opts.maxSteps ?? 6;
  const toolCallsLog: PredictiveAgentResult['toolCalls'] = [];
  let steps = 0;

  for (let i = 0; i < maxSteps; i++) {
    steps++;
    const res = await ollama.chat({
      messages,
      tools: tools.definitions,
    });
    const msg = res.message;
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    emit({
      type: 'assistant_message',
      text: msg.content.trim(),
      hasToolCalls: calls.length > 0,
    });
    if (calls.length === 0) {
      // Modelo termino con texto plano.
      log.info({ steps }, 'Agente termino sin mas tool calls');
      const text = msg.content.trim();
      emit({ type: 'final', text, steps });
      return {
        text,
        steps,
        toolCalls: toolCallsLog,
        lastSummary: tools.state.lastSummary,
        model: ollama.modelName,
      };
    }

    // Ejecutar cada tool call y appendear el resultado.
    for (const call of calls) {
      emit({
        type: 'tool_call',
        name: call.function.name,
        args: call.function.arguments,
      });
      const result = await tools.dispatch(call.function.name, call.function.arguments);
      emit({ type: 'tool_result', name: call.function.name, result });
      toolCallsLog.push({
        name: call.function.name,
        args: call.function.arguments,
        result,
      });
      messages.push({
        role: 'tool',
        content: JSON.stringify(result),
      });
    }
  }

  // Llegamos al max de pasos sin respuesta final. Pedimos al modelo que cierre.
  log.warn({ maxSteps }, 'maxSteps alcanzado, forzando respuesta final');
  messages.push({
    role: 'user',
    content:
      'Has llegado al limite de tool calls. Da la respuesta final ahora con los datos que ya tienes.',
  });
  const final = await ollama.chat({ messages });
  const finalText = final.message.content.trim();
  emit({ type: 'assistant_message', text: finalText, hasToolCalls: false });
  emit({ type: 'final', text: finalText, steps: steps + 1 });
  return {
    text: finalText,
    steps: steps + 1,
    toolCalls: toolCallsLog,
    lastSummary: tools.state.lastSummary,
    model: ollama.modelName,
  };
}

export { TimesFMClient } from './timesfm-client.js';
export { OllamaClient } from './ollama-client.js';
export { buildPredictiveTools } from './tools.js';
export type { ForecastSummary } from './schema.js';

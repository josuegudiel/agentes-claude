import { z } from 'zod';
import { logger } from '../../core/logger.js';
import { AgentToolError } from '../../core/errors.js';
import type { ChatClient, OllamaToolDefinition } from './chat-client.js';
import type { TimesFMClient } from './timesfm-client.js';
import {
  ForecastRequestSchema,
  type ForecastResponse,
  type ForecastSummary,
} from './schema.js';
import { summarizeForecast } from './summarize.js';
import { interpretForecastPrompt } from './prompts.js';

/**
 * Tools del agente predictivo. Diseno simetrico al agente Claude existente:
 *   - cada tool tiene zod schema estricto
 *   - cada tool loguea {tool, ...} para trazabilidad
 *   - errores se devuelven serializables, no se lanzan
 *
 * Diferencias importantes con `src/agents/tools.ts`:
 *   - No usamos AI SDK (`tool()`). Ollama tiene su propio formato.
 *   - Mantenemos un estado "ultimo forecast" para que interpret_forecast
 *     pueda ser invocada sin reenviar todos los datos.
 */

// --- Schemas zod para input validation ---

const ForecastSeriesInput = ForecastRequestSchema;
type ForecastSeriesInput = z.infer<typeof ForecastSeriesInput>;

const InterpretForecastInput = z.object({
  question: z.string().default(''),
});
type InterpretForecastInput = z.infer<typeof InterpretForecastInput>;

// --- Resultados que devolvemos al LLM ---

export type ToolResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; code: string };

interface ForecastSeriesResult {
  summary: ForecastSummary;
  model: string;
  elapsed_ms: number;
}

interface InterpretForecastResult {
  text: string;
}

// --- Estado compartido entre tools ---

interface PredictiveToolState {
  lastSummary: ForecastSummary | null;
}

export interface PredictiveTools {
  /** JSON Schema list para pasarle a Ollama. */
  definitions: OllamaToolDefinition[];
  /** Despacha por nombre con args ya parseados como unknown. */
  dispatch: (name: string, args: unknown) => Promise<ToolResult<object>>;
  /** Estado expuesto para tests / logging. */
  state: PredictiveToolState;
}

export function buildPredictiveTools(deps: {
  timesfm: TimesFMClient;
  /** Cualquier ChatClient (Ollama local o Groq cloud). */
  ollama: ChatClient;
}): PredictiveTools {
  const log = logger.child({ component: 'predictive.tools' });
  const state: PredictiveToolState = { lastSummary: null };

  const definitions: OllamaToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'forecast_series',
        description:
          'Predice los proximos N puntos de una serie temporal usando TimesFM. ' +
          'Requiere al menos 8 valores historicos en orden ascendente.',
        parameters: {
          type: 'object',
          properties: {
            series: {
              type: 'array',
              items: { type: 'number' },
              minItems: 8,
              description: 'Valores historicos en orden temporal ascendente.',
            },
            horizon: {
              type: 'integer',
              minimum: 1,
              maximum: 512,
              description: 'Cuantos puntos predecir hacia el futuro.',
            },
            frequency: {
              type: 'integer',
              enum: [0, 1, 2],
              description: '0=alta (horaria/diaria), 1=media (semanal/mensual), 2=baja.',
            },
          },
          required: ['series'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'interpret_forecast',
        description:
          'Explica el ULTIMO forecast en lenguaje natural. Llamar despues de forecast_series.',
        parameters: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'Pregunta opcional del usuario para enfocar la interpretacion.',
            },
          },
        },
      },
    },
  ];

  async function forecastSeries(input: ForecastSeriesInput): Promise<ToolResult<ForecastSeriesResult>> {
    log.info({ tool: 'forecast_series', n: input.series.length, horizon: input.horizon }, 'Tool call');
    try {
      const res: ForecastResponse = await deps.timesfm.forecast(input);
      const summary = summarizeForecast(input.series, res);
      state.lastSummary = summary;
      return {
        ok: true,
        summary,
        model: res.model,
        elapsed_ms: res.elapsed_ms,
      };
    } catch (err) {
      return toolError('forecast_series', err);
    }
  }

  async function interpretForecast(
    input: InterpretForecastInput,
  ): Promise<ToolResult<InterpretForecastResult>> {
    log.info({ tool: 'interpret_forecast', q: input.question }, 'Tool call');
    if (!state.lastSummary) {
      return {
        ok: false,
        error: 'No hay forecast previo. Llama forecast_series primero.',
        code: 'NO_FORECAST',
      };
    }
    try {
      const text = await deps.ollama.generate(
        interpretForecastPrompt({ question: input.question, summary: state.lastSummary }),
        { temperature: 0.3 },
      );
      return { ok: true, text: text.trim() };
    } catch (err) {
      return toolError('interpret_forecast', err);
    }
  }

  async function dispatch(name: string, args: unknown): Promise<ToolResult<object>> {
    switch (name) {
      case 'forecast_series': {
        const parsed = ForecastSeriesInput.safeParse(args);
        if (!parsed.success) return validationError(name, parsed.error);
        return forecastSeries(parsed.data);
      }
      case 'interpret_forecast': {
        const parsed = InterpretForecastInput.safeParse(args);
        if (!parsed.success) return validationError(name, parsed.error);
        return interpretForecast(parsed.data);
      }
      default:
        return {
          ok: false,
          error: `Tool desconocido: ${name}`,
          code: 'UNKNOWN_TOOL',
        };
    }
  }

  return { definitions, dispatch, state };
}

function validationError<T extends object>(toolName: string, err: z.ZodError): ToolResult<T> {
  const msg = err.issues
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
  return {
    ok: false,
    error: `Argumentos invalidos para ${toolName}: ${msg}`,
    code: 'BAD_ARGS',
  };
}

function toolError<T extends object>(toolName: string, err: unknown): ToolResult<T> {
  const wrapped =
    err instanceof Error
      ? new AgentToolError(err.message, {
          code: 'TOOL_FAILED',
          context: { toolName },
          cause: err,
        })
      : new AgentToolError(String(err), { code: 'TOOL_FAILED', context: { toolName } });
  logger.error({ tool: toolName, err: wrapped.message }, 'Tool error');
  return { ok: false, error: wrapped.message, code: wrapped.code };
}

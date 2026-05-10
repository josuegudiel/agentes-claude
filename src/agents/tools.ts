import { tool } from 'ai';
import { z } from 'zod';
import type { Page } from '@playwright/test';
import { createPatient, searchPatients } from '../flows/patients.flow.js';
import { loginAs } from '../flows/auth.flow.js';
import { logger } from '../core/logger.js';
import { AgentToolError } from '../core/errors.js';

/**
 * Las tools que el agente LLM puede invocar son envoltorios delgados sobre
 * `flows/`. Reglas:
 *   1. Cada tool tiene schema zod estricto — el LLM no puede pasar basura.
 *   2. Cada tool loguea entrada y salida con un `tool` tag.
 *   3. Si un flow lanza, lo capturamos y devolvemos un objeto serializable
 *      con { ok: false, error }. El LLM puede recuperarse o pedir ayuda.
 *
 * Para agregar dominios nuevos (inventario, POS), copia este patron:
 *   import { ... } from '../flows/inventory.flow.js';
 *   inventory_create_product: tool({ ... })
 */

export function buildTools(page: Page) {
  const log = logger.child({ component: 'agent.tools' });

  return {
    auth_login: tool({
      description: 'Inicia sesion en la aplicacion con un rol predefinido',
      parameters: z.object({
        role: z.enum(['user', 'admin']).default('user'),
      }),
      execute: async ({ role }) => {
        log.info({ tool: 'auth_login', role }, 'Tool call');
        try {
          await loginAs(page, role);
          return { ok: true as const };
        } catch (err) {
          return toolError('auth_login', err);
        }
      },
    }),

    patients_create: tool({
      description: 'Crea un paciente nuevo en el sistema',
      parameters: z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      execute: async (input) => {
        log.info({ tool: 'patients_create', email: input.email }, 'Tool call');
        try {
          const result = await createPatient(page, input);
          return { ok: true as const, ...result };
        } catch (err) {
          return toolError('patients_create', err);
        }
      },
    }),

    patients_search: tool({
      description: 'Busca pacientes por nombre o email y devuelve cuantos coinciden',
      parameters: z.object({ query: z.string().min(1) }),
      execute: async ({ query }) => {
        log.info({ tool: 'patients_search', query }, 'Tool call');
        try {
          const result = await searchPatients(page, query);
          return { ok: true as const, ...result };
        } catch (err) {
          return toolError('patients_search', err);
        }
      },
    }),
  };
}

function toolError(toolName: string, err: unknown): { ok: false; error: string; code: string } {
  const wrapped =
    err instanceof Error
      ? new AgentToolError(err.message, { code: 'TOOL_FAILED', context: { toolName }, cause: err })
      : new AgentToolError(String(err), { code: 'TOOL_FAILED', context: { toolName } });
  logger.error({ tool: toolName, err: wrapped.message }, 'Tool error');
  return { ok: false, error: wrapped.message, code: wrapped.code };
}

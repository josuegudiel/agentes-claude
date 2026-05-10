import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Persistencia del storage state (cookies + localStorage) para reusar logins
 * entre tests y evitar re-loguear N veces. Convencion:
 *   .auth/<role>.json
 *
 * Cada rol que necesites (user, admin, cashier) tiene su propio archivo.
 */

const AUTH_DIR = '.auth';

export type AuthRole = 'user' | 'admin' | 'cashier';

export function authStatePath(role: AuthRole = 'user'): string {
  return join(AUTH_DIR, `${role}.json`);
}

export async function ensureAuthDir(): Promise<void> {
  const dir = dirname(authStatePath('user'));
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

export async function saveAuthState(context: BrowserContext, role: AuthRole = 'user'): Promise<void> {
  await ensureAuthDir();
  const path = authStatePath(role);
  await context.storageState({ path });
  logger.debug({ role, path }, 'Storage state guardado');
}

export function hasAuthState(role: AuthRole = 'user'): boolean {
  return existsSync(authStatePath(role));
}

export function credentialsFor(role: AuthRole): { email: string; password: string } {
  if (role === 'admin') {
    if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
      throw new Error('ADMIN_EMAIL/ADMIN_PASSWORD no configurados en .env');
    }
    return { email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD };
  }
  return { email: config.TEST_USER_EMAIL, password: config.TEST_USER_PASSWORD };
}

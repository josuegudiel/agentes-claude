import type { Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage.js';
import { credentialsFor, type AuthRole } from '../core/auth.js';
import { logger } from '../core/logger.js';

/**
 * Flow: login con un rol predefinido. Lo usan tests, fixtures, seeds y el agente.
 */
export async function loginAs(page: Page, role: AuthRole = 'user'): Promise<void> {
  const log = logger.child({ flow: 'auth.loginAs', role });
  const { email, password } = credentialsFor(role);
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  log.info('Login OK');
}

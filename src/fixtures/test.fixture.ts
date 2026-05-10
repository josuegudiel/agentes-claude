import { test as base, expect, type Page } from '@playwright/test';
import { authStatePath, hasAuthState, type AuthRole } from '../core/auth.js';
import { LoginPage, PatientsPage } from '../pages/index.js';
import { loginAs } from '../flows/auth.flow.js';

/**
 * Test fixtures custom. Importa { test, expect } desde aqui en vez de
 * '@playwright/test' para tener acceso a:
 *   - test('...', async ({ asUser, asAdmin, login, patients }) => { ... })
 *
 * Patron: las fixtures crean un context con storageState ya cargado,
 * asi cada test arranca logueado sin re-loguear.
 */

interface PageObjects {
  login: LoginPage;
  patients: PatientsPage;
}

interface AuthFixtures {
  asUser: Page;
  asAdmin: Page;
}

export const test = base.extend<PageObjects & AuthFixtures>({
  // ---- Page Objects ----
  login: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  patients: async ({ page }, use) => {
    await use(new PatientsPage(page));
  },

  // ---- Roles autenticados ----
  // Reusa storageState si existe; si no, hace login y lo guarda.
  asUser: async ({ browser }, use) => {
    await use(await pageWithRole(browser, 'user'));
  },
  asAdmin: async ({ browser }, use) => {
    await use(await pageWithRole(browser, 'admin'));
  },
});

async function pageWithRole(
  browser: import('@playwright/test').Browser,
  role: AuthRole,
): Promise<Page> {
  if (!hasAuthState(role)) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, role);
    await ctx.storageState({ path: authStatePath(role) });
    return page;
  }
  const ctx = await browser.newContext({ storageState: authStatePath(role) });
  return ctx.newPage();
}

export { expect };

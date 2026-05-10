import { test as setup } from '@playwright/test';
import { authStatePath, ensureAuthDir } from '../src/core/auth.js';
import { loginAs } from '../src/flows/auth.flow.js';

/**
 * Setup project: corre UNA VEZ antes de los tests reales y deja el
 * storage state por rol cacheado en disco. Cada test que use el fixture
 * `asUser` o `asAdmin` arranca ya logueado en milisegundos.
 */

setup('autenticar como user', async ({ page }) => {
  await ensureAuthDir();
  await loginAs(page, 'user');
  await page.context().storageState({ path: authStatePath('user') });
});

// Habilita esto cuando tengas ADMIN_EMAIL/ADMIN_PASSWORD configurados:
// setup('autenticar como admin', async ({ page }) => {
//   await ensureAuthDir();
//   await loginAs(page, 'admin');
//   await page.context().storageState({ path: authStatePath('admin') });
// });

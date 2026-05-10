import { test, expect } from '../../src/fixtures/test.fixture.js';
import { config } from '../../src/core/config.js';

test.describe('Autenticacion', () => {
  test('login exitoso con credenciales validas @smoke', async ({ login, page }) => {
    await login.goto();
    await login.login(config.TEST_USER_EMAIL, config.TEST_USER_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('login falla con password invalido', async ({ login }) => {
    await login.goto();
    await expect(login.login(config.TEST_USER_EMAIL, 'password-incorrecto')).rejects.toThrow(
      /login fallido|rejected/i,
    );
  });
});

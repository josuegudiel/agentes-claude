import type { Locator } from '@playwright/test';
import { BasePage } from './BasePage.js';
import { AuthError } from '../core/errors.js';

/**
 * NOTA: Los selectores de abajo son ejemplos. Ajustalos a tu app real.
 * Preferencia de selectores (de mas a menos estable):
 *   1. getByRole / getByLabel       -> accesibles + estables
 *   2. getByTestId('foo')           -> requiere data-testid en el codigo
 *   3. getByText                    -> estable si el texto no cambia
 *   4. CSS / XPath                  -> ultimo recurso
 */
export class LoginPage extends BasePage {
  readonly path = '/login';

  protected readyLocator(): Locator {
    return this.page.getByRole('heading', { name: /iniciar sesion|login/i });
  }

  private get emailInput(): Locator {
    return this.page.getByLabel(/correo|email/i);
  }

  private get passwordInput(): Locator {
    return this.page.getByLabel(/contrase[nñ]a|password/i);
  }

  private get submitButton(): Locator {
    return this.page.getByRole('button', { name: /entrar|iniciar sesion|sign in/i });
  }

  private get errorBanner(): Locator {
    return this.page.getByRole('alert');
  }

  async login(email: string, password: string): Promise<void> {
    this.log.info({ email }, 'Login');
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();

    // Esperamos navegacion O un error visible. Lo que pase primero.
    const result = await Promise.race([
      this.page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })
        .then(() => 'success' as const),
      this.errorBanner.waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => 'error' as const),
    ]).catch(() => 'timeout' as const);

    if (result === 'error') {
      const text = await this.errorBanner.innerText().catch(() => 'desconocido');
      throw new AuthError(`Login fallido: ${text}`, {
        code: 'LOGIN_REJECTED',
        context: { email },
      });
    }
    if (result === 'timeout') {
      throw new AuthError('Login no respondio en 15s', { code: 'LOGIN_TIMEOUT', context: { email } });
    }
  }
}

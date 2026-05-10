import type { Page, Locator } from '@playwright/test';
import { logger, type Logger } from '../core/logger.js';

/**
 * Contrato comun de todos los Page Objects.
 *
 * Reglas para subclases:
 *  1. Cada locator es un getter privado/protegido (NO inicializar en constructor;
 *     los locators son lazy y se reevaluan).
 *  2. Los metodos publicos representan ACCIONES de usuario (clickEditar, llenarFormulario)
 *     o LECTURAS de estado (getNombrePaciente). Devuelven datos, no Locators.
 *  3. Nada de logica de negocio cross-pagina aqui — eso vive en `flows/`.
 */
export abstract class BasePage {
  protected readonly log: Logger;

  constructor(public readonly page: Page) {
    this.log = logger.child({ page: this.constructor.name });
  }

  /** URL relativa al BASE_URL. Override en cada subclase. */
  abstract readonly path: string;

  /** Locator que confirma que la pagina cargo. Override en cada subclase. */
  protected abstract readyLocator(): Locator;

  async goto(): Promise<this> {
    this.log.debug({ path: this.path }, 'Navegando');
    await this.page.goto(this.path);
    await this.waitUntilReady();
    return this;
  }

  async waitUntilReady(timeoutMs = 15_000): Promise<void> {
    await this.readyLocator().waitFor({ state: 'visible', timeout: timeoutMs });
  }

  async screenshot(label: string): Promise<Buffer> {
    return this.page.screenshot({ path: `test-results/screenshots/${label}.png`, fullPage: true });
  }
}

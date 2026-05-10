import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { config } from './config.js';
import { logger } from './logger.js';

export interface LaunchOptions {
  headless?: boolean;
  storageStatePath?: string;
  recordVideo?: boolean;
  viewport?: { width: number; height: number };
}

/**
 * Factory para usar Playwright FUERA del runner de tests
 * (seed scripts, agentes en produccion, debugging).
 *
 * Dentro de tests usa el fixture `page` de Playwright en lugar de esto.
 */
export class BrowserSession {
  private constructor(
    readonly browser: Browser,
    readonly context: BrowserContext,
    readonly page: Page,
  ) {}

  static async launch(opts: LaunchOptions = {}): Promise<BrowserSession> {
    const headless = opts.headless ?? config.HEADLESS;
    logger.debug({ headless, storageStatePath: opts.storageStatePath }, 'Lanzando browser');

    const browser = await chromium.launch({ headless });
    const context = await browser.newContext({
      baseURL: config.BASE_URL,
      viewport: opts.viewport ?? { width: 1440, height: 900 },
      storageState: opts.storageStatePath,
      recordVideo: opts.recordVideo ? { dir: 'test-results/videos' } : undefined,
    });
    const page = await context.newPage();
    return new BrowserSession(browser, context, page);
  }

  async close(): Promise<void> {
    await this.context.close();
    await this.browser.close();
  }
}

/**
 * Ejecuta `fn` con una sesion fresca y la cierra siempre, pase lo que pase.
 * Patron RAII para evitar leaks de procesos chromium.
 */
export async function withBrowser<T>(
  fn: (s: BrowserSession) => Promise<T>,
  opts: LaunchOptions = {},
): Promise<T> {
  const session = await BrowserSession.launch(opts);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

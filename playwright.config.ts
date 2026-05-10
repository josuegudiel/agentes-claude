import { defineConfig, devices } from '@playwright/test';
import { config as appConfig, isCI } from './src/core/config.js';

/**
 * Configuracion de Playwright. Filosofia:
 *  - En LOCAL: pocos workers, headed, traces "on-first-retry".
 *  - En CI: workers paralelos, headless, traces siempre, video on failure.
 *  - Reporters: HTML para humanos + line para logs CI + JSON para integraciones.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? appConfig.PW_WORKERS : undefined,
  timeout: 30_000,
  expect: { timeout: 5_000 },

  reporter: isCI
    ? [
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['list'],
        ['json', { outputFile: 'playwright-report/results.json' }],
        ['github'],
      ]
    : [
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['list'],
      ],

  outputDir: 'test-results',

  use: {
    baseURL: appConfig.BASE_URL,
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: isCI ? 'retain-on-failure' : 'off',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    headless: appConfig.HEADLESS,
    locale: 'es-MX',
    timezoneId: 'America/Guatemala',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    // Descomenta cuando quieras correr cross-browser:
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    //   dependencies: ['setup'],
    // },
    // {
    //   name: 'mobile-chrome',
    //   use: { ...devices['Pixel 7'] },
    //   dependencies: ['setup'],
    // },
  ],
});

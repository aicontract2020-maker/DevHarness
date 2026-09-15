import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3002';
const chromeExecutablePath = process.env.CHROME_BIN ?? '';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.e2e.mjs',
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL,
    headless: true,
    ...(chromeExecutablePath ? { launchOptions: { executablePath: chromeExecutablePath } } : {})
  }
});

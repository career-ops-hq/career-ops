import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './test/cv-visual',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/cv-visual-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  use: {
    browserName: 'chromium',
    viewport: { width: 1050, height: 1485 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
  },
});

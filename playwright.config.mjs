import { defineConfig } from '@playwright/test';

/** Browser tests: dist/ (the shipped files) in Chromium, api.github.com served by tests/e2e/mock-github.mjs. */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.mjs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure' },
});

import { defineConfig } from '@playwright/test';

/** Generates the Chrome Web Store screenshots (not a test suite): `npm run package:screenshots`. */
export default defineConfig({
  testDir: 'tests/store',
  testMatch: '*.store.mjs',
  timeout: 180_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/store',
});

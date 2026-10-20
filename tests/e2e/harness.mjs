// Loads dist/ into Playwright's Chromium with api.github.com served by a MockGitHub.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

export const EXTENSION = join(import.meta.dirname, '..', '..', 'dist');

export async function launch(mock, { viewport = { width: 1280, height: 900 }, colorScheme = 'light', deviceScaleFactor = 1 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'gam-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport,
    colorScheme,
    deviceScaleFactor,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  await context.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const res = mock.handle(req.url(), await req.allHeaders(), req.method());
    await route.fulfill({ status: res.status, headers: res.headers, body: res.body });
  });
  // Nothing may leave for the real GitHub web either (repo/run links are only opened, never fetched).
  await context.route('https://github.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>GitHub</title>' }));
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  return {
    context,
    worker,
    extensionId,
    url: (page) => `chrome-extension://${extensionId}/${page}`,
    async close() {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** Stores a token and repositories directly, as the settings page and popup would. */
export async function seed(ext, { token, repos, extra = {} }) {
  // The install handler writes defaults (an empty repo list); wait for it so it cannot overwrite the seed.
  await ext.worker.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      if ((await chrome.storage.local.get('firstTimeSetup')).firstTimeSetup) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('extension did not initialize');
  });
  await ext.worker.evaluate(
    async ({ token, repos, extra }) => {
      await chrome.storage.local.set({ token, ...extra.local });
      await chrome.storage.sync.set({ repos, syncToken: false, notificationsEnabled: false, pollIntervalSeconds: 30, ...extra.sync });
    },
    { token, repos, extra },
  );
}

/** Asks the service worker to poll now and waits for it to finish. */
export async function pollNow(ext, page) {
  await page.evaluate(() => chrome.runtime.sendMessage({ action: 'refreshNow' }));
}

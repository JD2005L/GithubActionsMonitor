// Renders the extension's static icons (icons/icon{16,32,48,128}.png) from the brand artwork in scripts/brand.mjs.
// Run after changing the artwork: `npm run icons`. The toolbar icon is redrawn at runtime by icon-manager.js once
// the first status is known; these show on chrome://extensions, in the store and before the first check.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { brandSvg } from './brand.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${brandSvg(size)}</body></html>`);
    writeFileSync(join(root, 'icons', `icon${size}.png`), await page.screenshot({ omitBackground: true, type: 'png' }));
  }
  console.log('Rendered icons/icon16.png, icon32.png, icon48.png, icon128.png');
} finally {
  await browser.close();
}

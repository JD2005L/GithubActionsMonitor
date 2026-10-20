// Collects everything the Chrome Web Store submission needs into one folder:
//   release/chrome-web-store-<version>/
//     1-upload-this.zip              the package (built by `node scripts/build.mjs --store`)
//     SUBMIT.html / SUBMIT.md        every dashboard field under its exact label, ready to paste (Copy buttons in .html)
//     PRIVACY.md                     the privacy policy (also published on levac.net)
//     images/store-icon-128.png      store icon: the extension's own 128px icon (icons/icon128.png, see scripts/icons.mjs)
//     images/promo-tile-440x280.png  small promo tile (rendered here)
//     images/screenshots/            five 1280x800 screenshots (sample data), made by tests/store/screenshots.store.mjs
// Run through `npm run package`, after the store build.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { brandSvg } from './brand.mjs';
import { PRODUCT, storeListing } from './store-listing.mjs';
import { checkLimits, renderHtml, renderMarkdown } from './submit-page.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const zip = join(root, 'release', `github-actions-monitor-${version}.zip`);
if (!existsSync(zip)) throw new Error('Run the store build first: node scripts/build.mjs --store');

const out = join(root, 'release', `chrome-web-store-${version}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'images', 'screenshots'), { recursive: true });

renameSync(zip, join(out, '1-upload-this.zip')); // moved, so release/ holds only this folder
copyFileSync(join(root, 'PRIVACY.md'), join(out, 'PRIVACY.md'));
copyFileSync(join(root, 'icons', 'icon128.png'), join(out, 'images', 'store-icon-128.png'));
// images/screenshots/ is filled by `npm run package:screenshots` (part of `npm run package`).

const tabs = storeListing(version);
checkLimits(tabs);
writeFileSync(join(out, 'SUBMIT.html'), renderHtml(tabs, version, PRODUCT));
writeFileSync(join(out, 'SUBMIT.md'), renderMarkdown(tabs, version, PRODUCT));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // Small promo tile, 440x280.
  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:440px;height:280px;background:radial-gradient(420px 260px at 85% 30%,rgba(46,160,67,.22) 0%,rgba(46,160,67,0) 70%),linear-gradient(135deg,#0d1117 0%,#161b22 60%,#141c17 100%);font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#f0f6fc;display:flex;align-items:center;gap:22px;padding:0 30px;box-sizing:border-box;overflow:hidden}
svg{flex:none;filter:drop-shadow(0 6px 16px rgba(0,0,0,.5))}
h1{font-size:27px;line-height:1.15;margin:0 0 10px;font-weight:700}
p{margin:0;font-size:15px;line-height:1.4;color:#9198a1}
b{color:#3fb950;font-weight:600}
</style></head><body>${brandSvg(108)}<div><h1>GitHub Actions Monitor</h1><p>Your CI status, <b>live in the toolbar</b>. Every workflow, every repository.</p></div></body></html>`);
  await page.screenshot({ path: join(out, 'images', 'promo-tile-440x280.png') });
} finally {
  await browser.close();
}

console.log(`Chrome Web Store submission folder -> ${out}`);

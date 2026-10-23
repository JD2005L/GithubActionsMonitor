// Chrome Web Store screenshots: five 1280x800 slides, each a caption plus a real capture of the extension (dist/
// against the mock GitHub API) showing a made-up account. No real account or repository appears.
// Run with `npm run package:screenshots`; output: release/chrome-web-store-<version>/images/screenshots/.
//
// The five tell one story for a developer with build and deploy pipelines:
//   1. every pipeline at a glance (icon, compact cards, filters, add the repository you are looking at)
//   2. why it failed (the error from the log, where it stopped, history, who and which pull request)
//   3. deployments rolling out (step lights by job, a production deploy waiting for review, cancel)
//   4. the moment it breaks (the desktop alert, re-run, switching off noisy workflows)
//   5. kept in view: docked in the side panel beside the page being worked on (or popped out, or on top)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { brandSvg, statusSvg } from '../../scripts/brand.mjs';
import { launch, seed } from '../e2e/harness.mjs';
import { MockGitHub } from '../e2e/mock-github.mjs';

const root = join(import.meta.dirname, '..', '..');
const { version } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const OUT = join(root, 'release', `chrome-web-store-${version}`, 'images', 'screenshots');

// Runs of one push share its commit, as on GitHub: the hash is derived from the commit title, so cards do not
// mark a workflow's commit as older when it ran on the same push.
const commitOf = (title = 'Update') => {
  let h = 2166136261;
  for (const c of title) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 7);
};
const run = (fields) => MockGitHub.run({ sha: commitOf(fields.title), ...fields });
// The failed CI's log: the lines that say why are quoted in the expanded card and the alert.
const CI_LOG = [
  '2026-10-12T10:00:00.0000000Z ##[group]Run npm test',
  '2026-10-12T10:01:10.0000000Z   ● rate limit › returns 429 after 100 requests a minute',
  '2026-10-12T10:01:10.0000000Z     Expected: 429',
  '2026-10-12T10:01:10.0000000Z     Received: 200',
  '2026-10-12T10:01:10.0000000Z ',
  '2026-10-12T10:01:11.0000000Z       at Object.<anonymous> (test/rate-limit.test.js:58:7)',
  '2026-10-12T10:01:12.0000000Z ##[error]Process completed with exit code 1.',
].join('\n');
const RELEASE = 'Release 2026.10.2';

function sampleAccount() {
  return new MockGitHub({
    login: 'maya-chen',
    repos: {
      'northwind-labs/api': {
        private: true,
        branches: ['main', 'develop'],
        runs: [
          run({ id: 13, workflowId: 3, name: 'Deploy', conclusion: 'success', title: 'Add rate limiting to public endpoints', startedAgoSec: 300, durationSec: 96 }),
          run({ id: 12, workflowId: 2, name: 'Lint', conclusion: 'success', title: 'Add rate limiting to public endpoints', startedAgoSec: 420, durationSec: 41 }),
          run({ id: 11, workflowId: 1, name: 'CI', conclusion: 'failure', title: 'Add rate limiting to public endpoints', event: 'pull_request', startedAgoSec: 430, durationSec: 228, pr: 482, actor: 'maya-chen', failedAt: { job: 'Test', step: 'npm test', log: CI_LOG } }),
          run({ id: 10, workflowId: 1, name: 'CI', conclusion: 'success', title: 'Tidy logging', startedAgoSec: 7200, durationSec: 214 }),
          run({ id: 9, workflowId: 1, name: 'CI', conclusion: 'success', title: 'Bump dependencies', startedAgoSec: 30000, durationSec: 220 }),
          run({ id: 8, workflowId: 3, name: 'Deploy', conclusion: 'success', title: 'Tidy logging', startedAgoSec: 7000, durationSec: 90 }),
          run({ id: 7, workflowId: 1, name: 'CI', conclusion: 'failure', title: 'Try new cache', startedAgoSec: 60000, durationSec: 180 }),
          run({ id: 6, workflowId: 1, name: 'CI', conclusion: 'success', title: 'Add request IDs', startedAgoSec: 90000, durationSec: 205 }),
        ],
      },
      'northwind-labs/web-console': {
        private: true,
        runs: [
          // Production waits for a reviewer (environment protection rule) while staging rolls out.
          run({ id: 24, workflowId: 9, name: 'Deploy to production', status: 'waiting', conclusion: null, title: RELEASE, startedAgoSec: 35, actor: 'sam-okafor' }),
          run({
            id: 23, workflowId: 8, name: 'Deploy to staging', status: 'in_progress', conclusion: null, title: RELEASE, startedAgoSec: 166, actor: 'sam-okafor', event: 'release',
            progress: [
              { job: 'Build', steps: [['Checkout', 'done'], ['Install', 'done'], ['Build image', 'done']] },
              { job: 'Migrate', steps: [['Run migrations', 'done']] },
              { job: 'Deploy', steps: [['Push image', 'done'], ['Roll out', 'running'], ['Smoke tests', 'pending']] },
            ],
          }),
          run({ id: 22, workflowId: 4, name: 'CI', conclusion: 'success', title: RELEASE, startedAgoSec: 420, durationSec: 212 }),
          run({ id: 20, workflowId: 4, name: 'CI', conclusion: 'success', title: 'Redesign billing page', startedAgoSec: 9000, durationSec: 220 }),
          run({ id: 19, workflowId: 8, name: 'Deploy to staging', conclusion: 'success', title: 'Redesign billing page', startedAgoSec: 8800, durationSec: 250 }),
          run({ id: 18, workflowId: 9, name: 'Deploy to production', conclusion: 'success', title: 'Redesign billing page', startedAgoSec: 8000, durationSec: 270 }),
          run({ id: 17, workflowId: 8, name: 'Deploy to staging', conclusion: 'failure', title: 'Upgrade the ORM', startedAgoSec: 40000, durationSec: 140 }),
        ],
      },
      'northwind-labs/mobile-app': {
        private: true,
        runs: [
          run({ id: 32, workflowId: 11, name: 'Build', conclusion: 'success', title: 'Release 3.4.0', startedAgoSec: 3600, durationSec: 412 }),
          run({ id: 31, workflowId: 10, name: 'Tests', conclusion: 'success', title: 'Release 3.4.0', startedAgoSec: 3620, durationSec: 268 }),
        ],
      },
      'northwind-labs/docs': { runs: [run({ id: 41, workflowId: 12, name: 'Pages', conclusion: 'success', title: 'Document rate limits', startedAgoSec: 5400, durationSec: 52 })] },
      'maya-chen/bluebird-bakery-site': { runs: [run({ id: 51, workflowId: 20, name: 'Pages', conclusion: 'success', title: 'Holiday hours', startedAgoSec: 90000, durationSec: 45 })] },
      // Not monitored: the page open in the browser, which the popup offers to add.
      'northwind-labs/payments': { private: true, runs: [run({ id: 61, workflowId: 30, name: 'CI', conclusion: 'success' })] },
    },
  });
}
const REPOS = [
  { id: 'northwind-labs/api:main', repo: 'northwind-labs/api', branch: 'main', enabled: true },
  { id: 'northwind-labs/web-console:all', repo: 'northwind-labs/web-console', branch: 'all', enabled: true },
  { id: 'northwind-labs/mobile-app:all', repo: 'northwind-labs/mobile-app', branch: 'all', enabled: true },
  { id: 'northwind-labs/docs:all', repo: 'northwind-labs/docs', branch: 'all', enabled: true },
  { id: 'maya-chen/bluebird-bakery-site:all', repo: 'maya-chen/bluebird-bakery-site', branch: 'all', enabled: false },
];
const TAB_URL = 'https://github.com/northwind-labs/payments/pulls';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A desktop notification drawn the way Chrome shows one, with the extension's own wording (background.js:
 * "Workflow Failed", the repository, the workflow and state, where it failed, and the first error line).
 */
function notificationHtml({ title, lines }) {
  return `<div class="toast"><div class="toast-head">${brandSvg(16)}<span>GitHub Actions Monitor</span><span class="toast-x">✕</span></div>
<div class="toast-body"><div class="toast-icon">${statusSvg(44, 'red')}</div><div><div class="toast-title">${esc(title)}</div>${lines.map((l) => `<div class="toast-line">${esc(l)}</div>`).join('')}</div></div></div>`;
}

/** A slide: caption on the left, the capture on the right (optionally under a browser toolbar, or under an alert). */
function slideHtml({ title, body, bullets, image, width, height, toolbar, notification, docked }) {
  const dot = (color) => `<span class="ext" style="background:${color}"></span>`;
  const strip = toolbar
    ? `<div class="toolbar"><span class="omni">${esc(toolbar.url)}</span><span class="icons">${dot('#57606a')}${dot('#57606a')}<span class="ours">${statusSvg(20, 'red')}<span class="badge">${toolbar.badge}</span></span></span></div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#f0f6fc;
  background:radial-gradient(1100px 650px at 85% 40%,rgba(46,160,67,.18) 0%,rgba(46,160,67,0) 60%),linear-gradient(135deg,#0d1117 0%,#11161d 55%,#141c17 100%);display:flex;align-items:center}
.text{width:500px;padding:0 0 0 72px;flex:none}
.brand{display:flex;align-items:center;gap:10px;color:#9198a1;font-size:16px;font-weight:600;margin-bottom:28px}
.brand svg{width:28px;height:28px}
h1{font-size:44px;line-height:1.12;margin:0 0 18px;font-weight:700;letter-spacing:-0.5px}
p{font-size:19px;line-height:1.5;color:#c9d1d9;margin:0 0 26px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}
li{font-size:17px;color:#c9d1d9;padding-left:30px;position:relative;line-height:1.4}
li::before{content:"";position:absolute;left:2px;top:6px;width:14px;height:14px;border-radius:50%;background:#3fb950;box-shadow:0 0 0 4px rgba(63,185,80,.18)}
.stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;height:800px;padding:36px}
.window{border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(240,246,252,.12);background:#fff}
.window img{display:block;width:${width}px;height:${height}px}
.toolbar{display:flex;align-items:center;gap:14px;height:46px;padding:0 14px;background:#dee1e6;border-bottom:1px solid #c7cbd1}
.omni{flex:1;height:30px;border-radius:15px;background:#fff;color:#5f6368;font-size:14px;display:flex;align-items:center;padding:0 14px}
.icons{display:flex;gap:10px;align-items:center}
.ext{display:inline-block;width:18px;height:18px;border-radius:50%}
.ours{display:inline-flex;padding:4px;border-radius:9px;background:#c2e7ff;box-shadow:0 0 0 2px #0b57d0}.ours svg{display:block}
.ours{position:relative}.badge{position:absolute;right:-5px;bottom:-4px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:#cf222e;color:#fff;font:700 10px/15px "Segoe UI",system-ui,sans-serif;text-align:center;box-shadow:0 0 0 1.5px #dee1e6}
.toast{width:${width}px;max-width:620px;border-radius:10px;background:#2b2b2b;color:#fff;box-shadow:0 24px 60px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08);padding:12px 16px 16px;font-family:"Segoe UI",system-ui,sans-serif}
.toast-head{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#c8c8c8;margin-bottom:12px}.toast-head svg{width:16px;height:16px}
.toast-x{margin-left:auto;color:#9a9a9a;font-size:12px}
.toast-body{display:flex;gap:14px;align-items:flex-start}.toast-icon svg{display:block}
.toast-title{font-size:15px;font-weight:600;margin-bottom:4px}
.toast-line{font-size:13.5px;line-height:1.45;color:#e2e2e2}
.dock{display:flex;background:#0d1117}
.dock .page{width:${docked ? docked.pageWidth : 0}px;padding:26px 24px;border-right:1px solid #30363d;display:flex;flex-direction:column;gap:14px}
.dock .page .bar{height:12px;border-radius:6px;background:#21262d}
.dock .page .row{display:flex;gap:10px;align-items:center}.dock .page .dot{width:14px;height:14px;border-radius:50%;flex:none}
.dock .page .head{height:20px;width:55%;border-radius:6px;background:#30363d;margin-bottom:6px}
.dock .page .box{border:1px solid #30363d;border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:12px}
</style></head><body>
<div class="text"><div class="brand">${brandSvg(28)}GitHub Actions Monitor</div>
<h1>${esc(title)}</h1><p>${esc(body)}</p><ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>
<div class="stage">${notification ? notificationHtml(notification) : ''}<div class="window">${strip}${docked ? `<div class="dock">${pageSkeleton()}<img src="data:image/png;base64,${image.toString('base64')}" alt=""></div>` : `<img src="data:image/png;base64,${image.toString('base64')}" alt="">`}</div></div>
</body></html>`;
}

/** A GitHub page in outline, beside the docked side panel: the panel is the subject, the page only context. */
function pageSkeleton() {
  const row = (color, w) => `<div class="row"><span class="dot" style="background:${color}"></span><div class="bar" style="width:${w}%"></div></div>`;
  return `<div class="page"><div class="head"></div><div class="bar" style="width:80%"></div><div class="bar" style="width:62%"></div>
<div class="box">${row('#3fb950', 70)}${row('#d29922', 55)}${row('#3fb950', 64)}${row('#3fb950', 48)}</div>
<div class="box">${row('#3fb950', 58)}${row('#f85149', 66)}${row('#3fb950', 52)}</div><div class="bar" style="width:70%"></div><div class="bar" style="width:44%"></div></div>`;
}

const fit = (w, h, maxW, maxH) => {
  const k = Math.min(maxW / w, maxH / h);
  return { width: Math.round(w * k), height: Math.round(h * k) };
};

async function regionOf(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
  });
}

async function capture(page, region) {
  return page.screenshot({ clip: region, fullPage: true, animations: 'disabled', caret: 'hide' });
}

/**
 * A region around an element, with a margin, as an image and its size. Cards sit 6px apart, so the margin above
 * and below stays under that: no edge of a neighbour in the capture.
 */
async function shotOf(page, locator, { side = 8, top = 4, bottom = 4 } = {}) {
  const r = await regionOf(locator);
  const region = { x: r.x - side, y: r.y - top, width: r.width + side * 2, height: r.height + top + bottom };
  return { image: await capture(page, region), width: region.width, height: region.height };
}

const setSync = (ext, values) => ext.worker.evaluate((v) => chrome.storage.sync.set(v), values);

async function openPopup(ext, scheme) {
  const page = await ext.context.newPage();
  await page.emulateMedia({ colorScheme: scheme });
  // The popup reads the active tab (activeTab); here the popup page is that tab, so stand in for a GitHub page.
  await page.addInitScript((url) => {
    chrome.tabs.query = async () => [{ url }];
  }, TAB_URL);
  await page.goto(ext.url('popup.html'));
  await page.getByRole('button', { name: 'Refresh Now' }).click();
  await expect(page.locator('.repo-item')).toHaveCount(REPOS.length);
  await expect(page.locator('.repo-item .lights').first()).toBeVisible();
  await settle(page);
  return page;
}

/** Let "Refreshed" fade, timers tick and theme transitions finish; no hover underline in the capture. */
async function settle(page) {
  await page.waitForTimeout(1600);
  await page.locator('#refreshBtn .btn-label').evaluate((el) => {
    el.textContent = 'Refresh Now';
    el.parentElement.classList.remove('is-done');
  });
  await page.mouse.move(0, 0);
}

const card = (page, name) => page.locator('.repo-item', { hasText: name });

test('Chrome Web Store screenshots', async () => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const shots = {};

  // Light: the overview, why it failed, and the failed workflow's actions.
  {
    const mock = sampleAccount();
    const ext = await launch(mock, { viewport: { width: 560, height: 1000 }, deviceScaleFactor: 2 });
    try {
      await seed(ext, { token: mock.token, repos: REPOS, extra: { sync: { expanded: [] } } });
      const page = await openPopup(ext, 'light');
      await expect(page.locator('#tabSuggestion')).toContainText('northwind-labs/payments');
      // The real popup scrolls its list past 400px; show the whole list instead of a cut-off card.
      await page.addStyleTag({ content: '.repo-list{max-height:none!important;overflow:visible!important}' });
      const container = await regionOf(page.locator('.container'));
      shots.overview = { image: await capture(page, container), ...container };
      // The popup on its own (2x), for product pages that show it without a slide around it.
      writeFileSync(join(OUT, '..', `popup-${Math.round(container.width)}x${Math.round(container.height)}.png`), shots.overview.image);

      // Why it failed: the failing repository expanded.
      await setSync(ext, { expanded: ['northwind-labs/api:main'] });
      await expect(card(page, 'northwind-labs/api').locator('.error-lines')).toBeVisible();
      await settle(page);
      shots.failure = await shotOf(page, card(page, 'northwind-labs/api'));

      // Act on it: with re-run and cancel switched on, the failed workflow gets a re-run button.
      await setSync(ext, { runControls: true });
      await page.reload();
      await expect(page.getByRole('button', { name: 'Re-run failed jobs of CI' })).toBeVisible();
      await settle(page);
      shots.actions = await shotOf(page, card(page, 'northwind-labs/api').locator('.workflow-list'), { side: 10, top: 2, bottom: 10 });
    } finally {
      await ext.close();
    }
  }

  // Dark: a deployment rolling out, and setup.
  {
    const mock = sampleAccount();
    const ext = await launch(mock, { viewport: { width: 560, height: 1000 }, colorScheme: 'dark', deviceScaleFactor: 2 });
    try {
      await seed(ext, { token: mock.token, repos: REPOS, extra: { sync: { expanded: ['northwind-labs/web-console:all'], runControls: true } } });
      const page = await openPopup(ext, 'dark');
      await expect(card(page, 'northwind-labs/web-console').locator('.review-pill').first()).toBeVisible();
      shots.deploy = await shotOf(page, card(page, 'northwind-labs/web-console'));

      // Docked in the side panel: the same page at side-panel width, with its keep-on-top and pop-out buttons.
      await setSync(ext, { expanded: [], runControls: false });
      const panel = await ext.context.newPage();
      await panel.emulateMedia({ colorScheme: 'dark' });
      await panel.setViewportSize({ width: 360, height: 1000 });
      await panel.addInitScript((url) => {
        chrome.tabs.query = async () => [{ url }];
      }, 'https://github.com/northwind-labs/web-console/actions');
      await panel.goto(ext.url('popup.html?view=panel'));
      await expect(panel.locator('.repo-item')).toHaveCount(REPOS.length);
      await expect(panel.getByRole('button', { name: 'Keep on top of other windows' })).toBeVisible();
      await settle(panel);
      const height = await panel.evaluate(() => document.querySelector('.container').getBoundingClientRect().bottom + 12);
      shots.panel = { image: await capture(panel, { x: 0, y: 0, width: 360, height }), width: 360, height };
    } finally {
      await ext.close();
    }
  }

  const slides = [
    {
      file: '1-every-pipeline.png',
      title: 'Every pipeline, one glance',
      body: 'The toolbar icon turns green, yellow or red for all your repositories, with a count of what is failing.',
      bullets: ['Compact cards: what failed, what is running', 'Filter to failing, running or awaiting review', 'Add the repository you are looking at in one click'],
      shot: shots.overview,
      max: [600, 700],
      toolbar: { url: TAB_URL.replace('https://', ''), badge: '1' },
    },
    {
      file: '2-why-it-failed.png',
      title: 'See why it failed',
      body: 'A failure names its job and step and quotes the lines from the log that say why, without opening GitHub.',
      bullets: ['The error from the log, right in the card', 'Where the run stopped, step by step', 'The pull request, commit and author behind it'],
      shot: shots.failure,
      max: [660, 600],
    },
    {
      file: '3-deployments-live.png',
      title: 'Watch deployments roll out',
      body: 'A light for each step turns green as it finishes, and checks speed up to every 5 seconds while anything runs.',
      bullets: ['Step lights by job, and the step it is on', 'Deployments waiting for approval, flagged to review', 'Every workflow’s last ten runs at a glance'],
      shot: shots.deploy,
      max: [660, 640],
    },
    {
      file: '4-alerts-and-actions.png',
      title: 'Know the moment it breaks',
      body: 'A desktop alert names the failed step and the error. Re-run it from the popup when you are ready.',
      bullets: ['Alerts when a run starts, passes or fails', 'Re-run failed jobs or cancel a run (optional)', 'Switch off noisy workflows'],
      shot: shots.actions,
      max: [620, 300],
      notification: {
        title: 'Workflow Failed',
        lines: ['northwind-labs/api', 'CI failed', 'Failed at Test > npm test', '● rate limit › returns 429 after 100 requests a minute'],
      },
    },
    {
      file: '5-keep-it-in-view.png',
      title: 'Keep it in view',
      body: 'Dock it in the side panel while you work, pop it out, or keep it on top of every window.',
      bullets: ['Stays open as you browse and switch tabs', 'Read-only by default: one token, just the access you choose', 'Free checks; settings sync across devices'],
      shot: shots.panel,
      max: [350, 640],
      toolbar: { url: 'github.com/northwind-labs/web-console/actions', badge: '1' },
      docked: { pageWidth: 310 },
    },
  ];

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    for (const s of slides) {
      const size = fit(s.shot.width, s.shot.height, s.max[0], s.max[1] - (s.toolbar ? 47 : 0));
      await page.setContent(slideHtml({ ...s, image: s.shot.image, ...size }));
      await page.waitForLoadState('load');
      writeFileSync(join(OUT, s.file), await page.screenshot({ type: 'png' }));
    }
  } finally {
    await browser.close();
  }
});

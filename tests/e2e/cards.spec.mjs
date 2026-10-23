import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, seed } from './harness.mjs';
import { MockGitHub } from './mock-github.mjs';

const SHOTS = join(import.meta.dirname, '..', '..', 'test-results', 'screenshots');
const run = MockGitHub.run;
const entry = (repo, branch = 'all', extra = {}) => ({ id: `${repo}:${branch}`, repo, branch, enabled: true, ...extra });
const badge = (ext) => ext.worker.evaluate(() => chrome.action.getBadgeText({}));
const syncGet = (ext, key) => ext.worker.evaluate(async (k) => (await chrome.storage.sync.get(k))[k], key);

function sample() {
  return new MockGitHub({
    repos: {
      'octo-dev/api': {
        runs: [
          run({ id: 13, workflowId: 3, name: 'Deploy', title: 'Add rate limiting', startedAgoSec: 300, durationSec: 96, pr: 482, actor: 'maya' }),
          run({ id: 11, workflowId: 1, name: 'CI', conclusion: 'failure', title: 'Add rate limiting', startedAgoSec: 430, durationSec: 228, failedAt: { job: 'Test', step: 'npm test' }, pr: 482, actor: 'maya' }),
          run({ id: 10, workflowId: 1, name: 'CI', startedAgoSec: 9000 }),
          run({ id: 9, workflowId: 1, name: 'CI', conclusion: 'failure', startedAgoSec: 19000 }),
        ],
      },
      'octo-dev/web': {
        runs: [
          run({ id: 22, workflowId: 5, name: 'E2E', status: 'in_progress', startedAgoSec: 60 }),
          run({ id: 21, workflowId: 6, name: 'Release', status: 'waiting', startedAgoSec: 90 }),
        ],
      },
      'octo-dev/docs': { runs: [run({ id: 31, workflowId: 7, name: 'Pages' })] },
    },
  });
}

test('compact cards: one-line state with the failed step, workflows and run context on expand, summary chips filter', async () => {
  mkdirSync(SHOTS, { recursive: true });
  const mock = sample();
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [entry('octo-dev/api'), entry('octo-dev/web'), entry('octo-dev/docs')] });
    const page = await ext.context.newPage();
    await page.setViewportSize({ width: 500, height: 600 });
    await page.goto(ext.url('popup.html'));
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    const card = (repo) => page.locator('.repo-item', { has: page.locator('.repo-name', { hasText: repo }) });

    // Collapsed: the state in one line, with the commit it is for and where the failure happened (linked to the
    // failed job's log); the rest is in the hover text. CI last ran on an older commit than Deploy, so its commit
    // is marked older.
    await expect(card('octo-dev/api').locator('.repo-sub')).toHaveText(/^1 failing · cc623a9 · Test › npm test · took 3m 48s$/);
    await expect(card('octo-dev/api').locator('.repo-sub .commit-sha')).toHaveAttribute('href', 'https://github.com/octo-dev/api/commit/cc623a9');
    await expect(card('octo-dev/api').locator('.repo-sub .commit-sha')).toHaveClass(/is-older/);
    await expect(card('octo-dev/api').locator('.repo-sub .failure-text')).toHaveAttribute('href', 'https://github.com/octo-dev/api/actions/runs/11/job/112');
    await expect(card('octo-dev/api').locator('.repo-sub')).toHaveAttribute('title', /CI: Failed \(Test › npm test\)/);
    await expect(card('octo-dev/api').locator('.repo-sub')).toHaveAttribute('title', /“Add rate limiting” · #482 · @maya · pull request/);
    await expect(page.locator('.workflow-row')).toHaveCount(0);

    // A run waiting for a review is marked, and its link opens the run.
    await expect(card('octo-dev/web').locator('.review-pill')).toHaveAttribute('href', 'https://github.com/octo-dev/web/actions/runs/21');
    await expect(card('octo-dev/web').locator('.repo-sub')).toContainText('1 running, 1 awaiting review');

    // Expanded: run context, every workflow with its recent runs, and a link to the failed job's log.
    await page.getByRole('button', { name: 'Show the workflows of octo-dev/api' }).click();
    const api = card('octo-dev/api');
    await expect(api.locator('.context-title')).toHaveText('Add rate limiting');
    await expect(api.getByRole('link', { name: '#482' })).toHaveAttribute('href', 'https://github.com/octo-dev/api/pull/482');
    await expect(api.locator('.context-sha')).toHaveText('cc623a9');
    await expect(api.locator('.workflow-row')).toHaveCount(2);
    const ci = api.locator('.workflow-row', { hasText: 'CI' });
    await expect(ci.locator('.history')).toHaveAttribute('aria-label', 'Last 3 runs (newest right): 2 failed, 1 passed');
    await expect(ci.locator('.bar')).toHaveClass([/bar-red/, /bar-green/, /bar-red/]);
    await expect(ci.getByRole('link', { name: 'Test › npm test' })).toHaveAttribute('href', 'https://github.com/octo-dev/api/actions/runs/11/job/112');
    // Run controls are off by default: no re-run or cancel buttons.
    await expect(page.getByRole('button', { name: /^Re-run|^Cancel/ })).toHaveCount(0);
    await page.screenshot({ path: join(SHOTS, 'popup-cards.png') });

    // The expanded state is remembered, in Chrome Sync so other browsers open the same cards.
    expect(await ext.worker.evaluate(async () => (await chrome.storage.sync.get('expanded')).expanded)).toEqual(['octo-dev/api:all']);
    await page.reload();
    await expect(card('octo-dev/api').locator('.workflow-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Hide the workflows of octo-dev/api' }).click();
    await expect(page.locator('.workflow-row')).toHaveCount(0);
    expect(await ext.worker.evaluate(async () => (await chrome.storage.sync.get('expanded')).expanded)).toEqual([]);

    // Expanded in another browser: the open popup follows the synced change.
    await ext.worker.evaluate(() => chrome.storage.sync.set({ expanded: ['octo-dev/web:all'] }));
    await expect(card('octo-dev/web').locator('.workflow-row')).not.toHaveCount(0);
    await ext.worker.evaluate(() => chrome.storage.sync.set({ expanded: [] }));
    await expect(page.locator('.workflow-row')).toHaveCount(0);

    // The summary counts active repositories by state and filters the list; drag handles hide while filtered.
    const chips = page.getByRole('group', { name: 'Show' }).getByRole('button');
    await expect(chips).toHaveText(['All 3', '1', '1', '1', '1']);
    await expect(page.getByRole('button', { name: '1 failing' })).toBeVisible();
    await page.getByRole('button', { name: '1 awaiting review' }).click();
    await expect(page.locator('.repo-item .repo-name')).toHaveText(['octo-dev/web']);
    await expect(page.locator('.drag-handle:visible')).toHaveCount(0);
    await page.getByRole('button', { name: '1 failing' }).click();
    await expect(page.locator('.repo-item .repo-name')).toHaveText(['octo-dev/api']);
    await page.getByRole('button', { name: '1 failing' }).click();
    await expect(page.locator('.repo-item')).toHaveCount(3);
    await expect(page.locator('#listCount')).toHaveText('3 monitored');
    await expect(page.locator('#checkedAt')).toHaveText('Checked just now');

    // The toolbar badge counts failing repositories.
    await expect.poll(() => badge(ext)).toBe('1');
  } finally {
    await ext.close();
  }
});

test('a workflow switched off stays listed but no longer decides the status, the badge or the alerts', async () => {
  const mock = sample();
  const ext = await launch(mock);
  try {
    // Saved by a 3.0.0 pre-release build on this device only: carried over to Chrome Sync on first read.
    await seed(ext, { token: mock.token, repos: [entry('octo-dev/api')], extra: { local: { expanded: ['octo-dev/api:all'] } } });
    const page = await ext.context.newPage();
    await page.goto(ext.url('popup.html'));
    await expect.poll(() => ext.worker.evaluate(async () => (await chrome.storage.sync.get('expanded')).expanded)).toEqual(['octo-dev/api:all']);
    expect(await ext.worker.evaluate(async () => (await chrome.storage.local.get('expanded')).expanded)).toBeUndefined();
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    const item = page.locator('.repo-item');
    await expect(item.locator('.status-dot')).toHaveClass(/status-red/);
    await expect.poll(() => badge(ext)).toBe('1');
    // Sorting is offered even with a single repository.
    await expect(page.getByLabel('Sort')).toBeVisible();

    const ciSwitch = page.getByRole('checkbox', { name: 'Count CI toward the status' });
    await expect(ciSwitch).toBeChecked();
    await ciSwitch.uncheck();
    await expect(item.locator('.status-dot')).toHaveClass(/status-green/);
    await expect(item.locator('.repo-sub .status-message')).toHaveText('Success');
    await expect(item.locator('.workflow-row.is-ignored')).toContainText('CI');
    await expect(ciSwitch).toBeFocused();
    expect(await syncGet(ext, 'repos')).toEqual([{ ...entry('octo-dev/api'), ignored: ['1'] }]);
    // The background applies it too (a free 304 is rolled up again), so the badge clears.
    await expect.poll(() => badge(ext)).toBe('');
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    await expect(item.locator('.status-dot')).toHaveClass(/status-green/);

    // Everything off: gray, and said so.
    await page.getByRole('checkbox', { name: 'Count Deploy toward the status' }).uncheck();
    await expect(item.locator('.repo-sub .status-message')).toHaveText('All workflows ignored');

    // Back on.
    await page.getByRole('checkbox', { name: 'Count CI toward the status' }).check();
    await page.getByRole('checkbox', { name: 'Count Deploy toward the status' }).check();
    await expect(item.locator('.status-dot')).toHaveClass(/status-red/);
    expect(await syncGet(ext, 'repos')).toEqual([entry('octo-dev/api')]);
    await expect.poll(() => badge(ext)).toBe('1');
  } finally {
    await ext.close();
  }
});

test('re-run and cancel appear only when switched on, and explain a token without write access', async () => {
  const mock = sample();
  const ext = await launch(mock);
  try {
    await seed(ext, {
      token: mock.token,
      repos: [entry('octo-dev/api'), entry('octo-dev/web')],
      extra: { sync: { runControls: true, expanded: ['octo-dev/api:all', 'octo-dev/web:all'] } },
    });
    const page = await ext.context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(ext.url('popup.html'));
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    const rerun = page.getByRole('button', { name: 'Re-run failed jobs of CI' });
    const cancel = page.getByRole('button', { name: 'Cancel E2E' });
    await expect(rerun).toBeVisible();
    await expect(cancel).toBeVisible();
    // A run waiting for review is not running yet: nothing to cancel.
    await expect(page.getByRole('button', { name: 'Cancel Release' })).toHaveCount(0);

    // A read-only token: GitHub refuses, and the popup says what is missing.
    await rerun.click();
    await expect(page.locator('#toast')).toHaveText('The token cannot do this: it needs Actions: Read and write (Settings, Setup, Connect GitHub shows how to add it).');
    await expect(page.locator('#toast')).toHaveClass(/error/);
    // Settings then shows how to add the permission to this token.
    await expect.poll(() => ext.worker.evaluate(async () => (await chrome.storage.local.get('tokenAccess')).tokenAccess)).toBe('read');

    mock.canWrite = true;
    await rerun.click();
    await expect(page.locator('#toast')).toHaveText('Re-running the failed jobs: CI');
    await expect.poll(() => ext.worker.evaluate(async () => (await chrome.storage.local.get('tokenAccess')).tokenAccess)).toBe('write');
    expect(mock.log.filter((r) => r.method === 'POST').map((r) => r.path)).toEqual([
      '/repos/octo-dev/api/actions/runs/11/rerun-failed-jobs',
      '/repos/octo-dev/api/actions/runs/11/rerun-failed-jobs',
    ]);
    // The re-run is queued, so the repository turns yellow.
    await expect(page.locator('.repo-item', { hasText: 'octo-dev/api' }).locator('.status-dot')).toHaveClass(/status-yellow/);

    await cancel.click();
    await expect(page.locator('#toast')).toHaveText('Cancelling the run: E2E');
    expect(mock.log.filter((r) => r.method === 'POST').at(-1).path).toBe('/repos/octo-dev/web/actions/runs/22/cancel');
  } finally {
    await ext.close();
  }
});

test('on a repository page, the popup offers that repository and fills in the add form', async () => {
  const mock = new MockGitHub({
    repos: {
      'octo-dev/api': { runs: [run({ id: 1, workflowId: 1, name: 'CI' })] },
      'octo-dev/web': { branches: ['main', 'feature/login'], runs: [run({ id: 2, workflowId: 2, name: 'CI' })] },
    },
  });
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [entry('octo-dev/api')] });
    const page = await ext.context.newPage();
    // The real popup reads the active tab (activeTab); here the page under test is that tab, so stand in for it.
    await page.addInitScript(() => {
      chrome.tabs.query = async () => [{ url: 'https://github.com/octo-dev/web/tree/feature/login/src/app' }];
    });
    await page.goto(ext.url('popup.html'));
    const strip = page.locator('#tabSuggestion');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('This tab: octo-dev/web');
    await expect(page.locator('#addPanel')).toBeHidden();

    await page.getByRole('button', { name: 'Add it' }).click();
    await expect(page.locator('#addPanel')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Owner' })).toHaveValue('octo-dev');
    await expect(page.locator('#repoSelect')).toHaveValue('octo-dev/web');
    // The branch in the address is picked (the longest branch name it starts with).
    await expect(page.locator('#branchSelect')).toHaveValue('feature/login');
    await expect(page.getByRole('button', { name: 'Add Repo' })).toBeFocused();
    await page.getByRole('button', { name: 'Add Repo' }).click();
    await expect(page.locator('.repo-item .branch-chip')).toHaveText(['feature/login']);
    // Monitored now: the suggestion goes away.
    await expect(strip).toBeHidden();
  } finally {
    await ext.close();
  }
});

test('the badge follows its setting: failing, else running; failing only; or off', async () => {
  const mock = new MockGitHub({
    repos: {
      'octo-dev/api': { runs: [run({ id: 1, workflowId: 1, name: 'CI', status: 'in_progress' })] },
      'octo-dev/web': { runs: [run({ id: 2, workflowId: 2, name: 'CI', status: 'in_progress' })] },
    },
  });
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [entry('octo-dev/api'), entry('octo-dev/web')] });
    const page = await ext.context.newPage();
    await page.goto(ext.url('popup.html'));
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    // Nothing failing: the running count, in amber.
    await expect.poll(() => badge(ext)).toBe('2');
    expect(await ext.worker.evaluate(() => chrome.action.getBadgeBackgroundColor({}))).toEqual([212, 167, 44, 255]);
    expect(await ext.worker.evaluate(() => chrome.action.getTitle({}))).toBe('GitHub Actions Monitor: 2 repositories running');

    await ext.worker.evaluate(() => chrome.storage.sync.set({ badgeMode: 'failing' }));
    await expect.poll(() => badge(ext)).toBe('');
    mock.setRuns('octo-dev/api', [run({ id: 3, workflowId: 1, name: 'CI', conclusion: 'failure' })]);
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    await expect.poll(() => badge(ext)).toBe('1');
    expect(await ext.worker.evaluate(() => chrome.action.getBadgeBackgroundColor({}))).toEqual([207, 34, 46, 255]);

    await ext.worker.evaluate(() => chrome.storage.sync.set({ badgeMode: 'off' }));
    await expect.poll(() => badge(ext)).toBe('');
  } finally {
    await ext.close();
  }
});

test('a running workflow lights a light per finished step; a failed one quotes the error from its log', async () => {
  const LOG = [
    '2026-10-13T01:10:00.0000000Z ##[group]Run npm test',
    '2026-10-13T01:10:01.0000000Z   ● api › returns the user',
    '2026-10-13T01:10:01.0000000Z     Expected: 200',
    '2026-10-13T01:10:01.0000000Z     Received: 500',
    '2026-10-13T01:10:01.0000000Z ',
    '2026-10-13T01:10:02.0000000Z       at Object.<anonymous> (api.test.js:42:5)',
    '2026-10-13T01:10:03.0000000Z ##[error]Process completed with exit code 1.',
  ].join('\n');
  const progress = (testSteps) => [
    { job: 'Build', steps: [['Checkout', 'done'], ['Install', 'done']] },
    { job: 'Test', steps: testSteps },
  ];
  const mock = new MockGitHub({
    repos: {
      'octo-dev/web': { runs: [run({ id: 40, workflowId: 1, name: 'CI', status: 'in_progress', conclusion: null, startedAgoSec: 75, progress: progress([['Checkout', 'done'], ['npm test', 'running'], ['Upload', 'pending']]) })] },
      'octo-dev/api': { runs: [run({ id: 50, workflowId: 2, name: 'CI', conclusion: 'failure', failedAt: { job: 'Test', step: 'npm test', log: LOG } })] },
    },
  });
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [entry('octo-dev/web'), entry('octo-dev/api')], extra: { sync: { expanded: ['octo-dev/web:all', 'octo-dev/api:all'] } } });
    const page = await ext.context.newPage();
    await page.goto(ext.url('popup.html'));
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    const card = (name) => page.locator('.repo-item', { hasText: name });

    // Running: a light per step (GitHub's own "Set up job" left out), grouped by job; the running one pulses.
    const lights = card('octo-dev/web').locator('.repo-sub .lights');
    await expect(lights.locator('.light')).toHaveCount(5);
    await expect(lights.locator('.light-group')).toHaveCount(2);
    await expect(lights.locator('.light-done')).toHaveCount(3);
    await expect(lights.locator('.light-running')).toHaveCount(1);
    await expect(lights.locator('.light-running')).toHaveAttribute('title', 'Test › npm test: running');
    await expect(lights).toHaveAttribute('aria-label', '3 of 5 steps done, now: Test › npm test');
    await expect(card('octo-dev/web').locator('.repo-sub .current-step')).toHaveText('Test › npm test');
    await expect(card('octo-dev/web').locator('.workflow-steps .lights .light')).toHaveCount(5);

    // Failed: where it stopped, and the lines from the log that say why.
    const failed = card('octo-dev/api');
    await expect(failed.locator('.workflow-failure .lights .light-failed')).toHaveCount(1);
    await expect(failed.locator('.error-lines')).toHaveText('● api › returns the user\nExpected: 200\nReceived: 500');
    await expect(failed.locator('.repo-sub')).toHaveAttribute('title', /● api › returns the user/);
    await page.screenshot({ path: join(SHOTS, 'popup-lights.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500); // let the theme's color transitions finish
    await page.screenshot({ path: join(SHOTS, 'popup-lights-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });

    // The next step finishes: its light turns green and the next one runs (jobs are asked at most every 10 s).
    mock.findRun('octo-dev/web', 40).progress = progress([['Checkout', 'done'], ['npm test', 'done'], ['Upload', 'running']]);
    await expect
      .poll(
        async () => {
          await page.getByRole('button', { name: 'Refresh Now' }).click();
          return lights.getAttribute('aria-label');
        },
        { timeout: 30000, intervals: [3000] },
      )
      .toBe('4 of 5 steps done, now: Test › Upload');
    // The failed run's log was read once.
    expect(mock.log.filter((r) => r.path.endsWith('/logs')).length).toBe(1);
  } finally {
    await ext.close();
  }
});

test('dock into the side panel or pop out into a window; the toolbar icon can open the side panel', async () => {
  const mock = sample();
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [entry('octo-dev/api'), entry('octo-dev/web')], extra: { sync: { expanded: ['octo-dev/api:all'] } } });

    // The side panel shows the same page, docked (the manifest's default path).
    expect((await ext.worker.evaluate(() => chrome.sidePanel.getOptions({}))).path).toBe('popup.html?view=panel');

    // The popup offers both: dock and pop out.
    const page = await ext.context.newPage();
    await page.goto(ext.url('popup.html'));
    await expect(page.getByRole('button', { name: 'Dock to the side panel' })).toBeVisible();
    const popoutBtn = page.getByRole('button', { name: 'Pop out into its own window' });
    await expect(popoutBtn).toBeVisible();

    // Pop out: a window of its own, without its own pop-out button; a second click brings it forward instead of
    // opening another.
    const opened = ext.context.waitForEvent('page');
    await popoutBtn.click();
    const win = await opened;
    await win.waitForLoadState();
    expect(new URL(win.url()).search).toBe('?view=window');
    await expect(win.locator('html')).toHaveAttribute('data-view', 'window');
    await expect(win.getByRole('button', { name: 'Pop out into its own window' })).toBeHidden();
    await expect(win.getByRole('button', { name: 'Dock to the side panel' })).toBeHidden();
    // Keep on top: Chrome's picture-in-picture window, showing the same page in a frame; the pop-out window is
    // minimized behind it.
    await win.getByRole('button', { name: 'Keep on top of other windows' }).click();
    await expect.poll(() => win.evaluate(() => window.documentPictureInPicture.window?.document.querySelector('iframe')?.src || null)).toMatch(/popup\.html\?view=pip$/);
    await expect
      .poll(() => ext.worker.evaluate(async () => (await chrome.windows.getAll()).find((w) => w.type === 'popup')?.state))
      .toBe('minimized');
    const popups = () => ext.worker.evaluate(async () => (await chrome.windows.getAll()).filter((w) => w.type === 'popup').length);
    expect(await popups()).toBe(1);
    const again = await ext.context.newPage();
    await again.goto(ext.url('popup.html'));
    await again.getByRole('button', { name: 'Pop out into its own window' }).click();
    await expect.poll(popups).toBe(1);

    // Docked in a narrow side panel: the page fills the width without sideways scrolling; Refresh shows its icon.
    const panel = await ext.context.newPage();
    await panel.setViewportSize({ width: 340, height: 800 });
    await panel.goto(ext.url('popup.html?view=panel'));
    await panel.getByRole('button', { name: 'Refresh Now' }).click();
    await expect(panel.locator('.repo-item')).toHaveCount(2);
    await expect(panel.locator('.workflow-row').first()).toBeVisible();
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(panel.locator('#refreshBtn .btn-label')).toHaveCSS('position', 'absolute');
    await panel.screenshot({ path: join(SHOTS, 'popup-side-panel.png'), fullPage: true });
    // Wider, it fills the panel.
    await panel.setViewportSize({ width: 640, height: 800 });
    expect(await panel.evaluate(() => document.body.getBoundingClientRect().width)).toBe(640);

    // Settings: the toolbar icon can open the side panel instead of the popup, and back.
    const options = await ext.context.newPage();
    await options.goto(ext.url('options.html#monitoring'));
    await options.locator('#iconOpensSelect').selectOption('panel');
    await expect.poll(() => ext.worker.evaluate(() => chrome.action.getPopup({}))).toBe('');
    expect((await ext.worker.evaluate(() => chrome.sidePanel.getPanelBehavior())).openPanelOnActionClick).toBe(true);
    await options.locator('#iconOpensSelect').selectOption('popup');
    await expect.poll(() => ext.worker.evaluate(() => chrome.action.getPopup({}))).toMatch(/popup\.html$/);
    expect((await ext.worker.evaluate(() => chrome.sidePanel.getPanelBehavior())).openPanelOnActionClick).toBe(false);
  } finally {
    await ext.close();
  }
});

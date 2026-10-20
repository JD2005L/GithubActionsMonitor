import { expect, test } from '@playwright/test';
import { launch, seed } from './harness.mjs';
import { MockGitHub } from './mock-github.mjs';

const run = MockGitHub.run;
const repo = (full, branch = 'all') => ({ id: `${full}:${branch}`, repo: full, branch, enabled: true });
const local = (ext, key) => ext.worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);

test('a failing CI is not hidden by a deploy that finished after it', async () => {
  const mock = new MockGitHub({
    repos: {
      'octo-dev/api': {
        runs: [
          // Newest first: the deploy succeeded after CI failed on the same commit.
          run({ id: 2, workflowId: 20, name: 'Deploy', conclusion: 'success', title: 'Add rate limiting' }),
          run({ id: 1, workflowId: 10, name: 'CI', conclusion: 'failure', title: 'Add rate limiting' }),
        ],
      },
    },
  });
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [repo('octo-dev/api')] });
    const page = await ext.context.newPage();
    await page.goto(ext.url('popup.html'));
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    const item = page.locator('.repo-item');
    await expect(item.locator('.status-dot')).toHaveClass(/status-red/);
    await expect(item.locator('.status-message')).toHaveText('1 failing');
    // The card is compact; its workflows are one click away.
    const rows = item.locator('.workflow-row');
    await expect(rows).toHaveCount(0);
    await page.getByRole('button', { name: 'Show the workflows of octo-dev/api' }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'CI' })).toContainText('Failed');
    await expect(rows.filter({ hasText: 'Deploy' })).toContainText('Success');
    await expect(rows.filter({ hasText: 'CI' }).locator('.mini-dot')).toHaveClass(/status-red/);
  } finally {
    await ext.close();
  }
});

test('unchanged runs are re-checked with free conditional requests, and changes still come through', async () => {
  const mock = new MockGitHub({ repos: { 'octo-dev/web': { runs: [run({ id: 1, workflowId: 10, name: 'CI' })] } } });
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [repo('octo-dev/web')] });
    const page = await ext.context.newPage();
    await page.goto(ext.url('popup.html'));
    const runsCalls = () => mock.log.filter((r) => r.path === '/repos/octo-dev/web/actions/runs');

    await page.getByRole('button', { name: 'Refresh Now' }).click();
    await expect(page.locator('.status-dot')).toHaveClass(/status-green/);
    const counted = mock.rateUsed;

    // Unchanged: a conditional request answered 304, which does not use the rate limit.
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    await expect.poll(() => runsCalls().at(-1)?.status).toBe(304);
    expect(runsCalls().at(-1).conditional).toBe(true);
    expect(mock.rateUsed).toBe(counted);
    await expect.poll(async () => (await local(ext, 'pollStats'))?.notModified).toBe(1);
    await expect(page.locator('.status-dot')).toHaveClass(/status-green/);

    // Changed: a new failing run arrives with a 200 and the status follows. Naming the failed step and quoting
    // its error cost two more requests (the run's jobs, the failed job's log), once.
    mock.setRuns('octo-dev/web', [run({ id: 2, workflowId: 10, name: 'CI', conclusion: 'failure', failedAt: { job: 'Test', step: 'npm test' } }), run({ id: 1, workflowId: 10, name: 'CI' })]);
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    await expect.poll(() => runsCalls().at(-1)?.status).toBe(200);
    await expect(page.locator('.status-dot')).toHaveClass(/status-red/);
    await expect(page.locator('.repo-sub .failure-text')).toHaveText('Test › npm test');
    await expect.poll(async () => (await local(ext, 'pollStats'))?.requests).toBe(3);

    // The next check is a free 304 again, and the failed step is remembered rather than asked for again.
    const jobsCalls = () => mock.log.filter((r) => r.path.endsWith('/jobs')).length;
    const logCalls = () => mock.log.filter((r) => r.path.endsWith('/logs')).length;
    expect(jobsCalls()).toBe(1);
    expect(logCalls()).toBe(1);
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    await expect.poll(async () => (await local(ext, 'pollStats'))?.notModified).toBe(1);
    expect(jobsCalls()).toBe(1);
    expect(logCalls()).toBe(1);
    await expect(page.locator('.repo-sub .failure-text')).toHaveText('Test › npm test');

    // The settings page reports it.
    const options = await ext.context.newPage();
    await options.goto(ext.url('options.html'));
    await expect(options.locator('#lastPoll')).toContainText('1 request, 1 free');
    await expect(options.locator('#rateRemaining')).toContainText('of 5,000');
  } finally {
    await ext.close();
  }
});

test('running workflows show a live timer; finished ones show their duration', async () => {
  const mock = new MockGitHub({
    repos: {
      'octo-dev/api': { runs: [run({ id: 1, workflowId: 10, name: 'CI', status: 'in_progress', startedAgoSec: 95 })] },
      'octo-dev/web': { runs: [run({ id: 2, workflowId: 20, name: 'CI', durationSec: 124 })] },
    },
  });
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [repo('octo-dev/api'), repo('octo-dev/web')] });
    const page = await ext.context.newPage();
    await page.goto(ext.url('popup.html'));
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    const timer = page.locator('.repo-item').filter({ hasText: 'octo-dev/api' }).locator('.run-timing');
    await expect(timer).toHaveText(/^running 1m 3\ds$/);
    const first = await timer.textContent();
    await expect.poll(() => timer.textContent(), { timeout: 3000 }).not.toBe(first);
    await expect(page.locator('.repo-item').filter({ hasText: 'octo-dev/web' }).locator('.run-timing')).toHaveText('took 2m 04s');
  } finally {
    await ext.close();
  }
});

test('commit titles and workflow names from GitHub are shown as text, never as HTML', async () => {
  const mock = new MockGitHub({
    repos: {
      'octo-dev/api': {
        runs: [
          run({ id: 1, workflowId: 10, name: '<b id="injected-name">CI</b>', title: '<img id="injected" src="x">Fix' }),
          run({ id: 2, workflowId: 20, name: 'Lint' }),
        ],
      },
    },
  });
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [repo('octo-dev/api')] });
    const page = await ext.context.newPage();
    await page.goto(ext.url('popup.html'));
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    await page.getByRole('button', { name: 'Show the workflows of octo-dev/api' }).click();
    await expect(page.locator('.context-title')).toHaveText('<img id="injected" src="x">Fix');
    await expect(page.locator('.workflow-row').first()).toContainText('<b id="injected-name">CI</b>');
    await expect(page.locator('.repo-sub')).toHaveAttribute('title', /<b id="injected-name">CI<\/b>: Success/);
    expect(await page.locator('#injected, #injected-name').count()).toBe(0);
  } finally {
    await ext.close();
  }
});

test('the token check explains a fine-grained token, and warns about a broad classic one', async () => {
  const mock = new MockGitHub({ repos: { 'octo-dev/api': { runs: [] }, 'octo-dev/web': { runs: [] } } });
  const ext = await launch(mock);
  try {
    const page = await ext.context.newPage();
    await page.goto(ext.url('options.html'));
    await page.getByRole('button', { name: /Connect GitHub/ }).click();
    const create = page.getByRole('link', { name: 'Create a read-only token on GitHub' });
    const href = new URL(await create.getAttribute('href'));
    expect(href.pathname).toBe('/settings/personal-access-tokens/new');
    expect(href.searchParams.get('actions')).toBe('read');
    expect([...href.searchParams.keys()].some((k) => ['contents', 'workflows', 'administration'].includes(k))).toBe(false);

    // Test Token checks a pasted token before saving it.
    await page.locator('#tokenInput').fill(mock.token);
    await page.getByRole('button', { name: 'Test Token' }).click();
    const report = page.locator('#tokenReport');
    await expect(report).toContainText('Token works.');
    await expect(report).toContainText('Signed in as @octo-dev. Fine-grained token.');
    await expect(report).toContainText('It can see 2 repositories.');
    await expect(report).toHaveClass(/good/);
    await page.getByRole('button', { name: 'Save Token' }).click();
    await expect(page.locator('#tcTitle')).toHaveText('Connected as @octo-dev');
    await expect(page.locator('#tcRepos')).toHaveText('Can see 2');
    expect(await local(ext, 'token')).toBe(mock.token);

    await page.getByRole('button', { name: 'Replace token' }).click();
    mock.token = `ghp_${'a'.repeat(36)}`;
    mock.tokenKind = 'classic';
    await page.locator('#tokenInput').fill(mock.token);
    await page.getByRole('button', { name: 'Test Token' }).click();
    await expect(report).toContainText('More access than needed:');
    await expect(report).toHaveClass(/warn/);

    await page.locator('#tokenInput').fill('github_pat_wrong');
    await page.getByRole('button', { name: 'Test Token' }).click();
    await expect(report).toContainText('Token check failed.');
    await expect(report).toHaveClass(/bad/);
  } finally {
    await ext.close();
  }
});

test('popup and settings follow the dark theme', async () => {
  const mock = new MockGitHub({ repos: {} });
  const ext = await launch(mock, { colorScheme: 'dark' });
  try {
    const page = await ext.context.newPage();
    await page.goto(ext.url('popup.html'));
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(13, 17, 23)');
    await page.goto(ext.url('options.html'));
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.settings-section:not(.how-it-works)')).backgroundColor)).toBe('rgb(13, 17, 23)');
    expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe('rgb(230, 237, 243)');
  } finally {
    await ext.close();
  }
});

test('the toolbar icon is drawn as the brand tile with a status-colored circle', async () => {
  const ext = await launch(new MockGitHub({ repos: {} }));
  try {
    const pixels = await ext.worker.evaluate(() => {
      const out = {};
      for (const color of ['green', 'yellow', 'red', 'gray']) {
        const canvas = new OffscreenCanvas(32, 32);
        const ctx = canvas.getContext('2d');
        IconManager.paintStatus(ctx, 32, color);
        const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
        out[color] = { center: at(16, 16), tile: at(4, 16), corner: at(0, 0) };
      }
      return out;
    });
    const expected = { green: [45, 164, 78], yellow: [251, 191, 36], red: [239, 68, 68], gray: [156, 163, 175] };
    for (const [color, rgb] of Object.entries(expected)) {
      expect(pixels[color].center.slice(0, 3)).toEqual(rgb);
      expect(pixels[color].tile.slice(0, 3)).toEqual([31, 35, 40]); // the dark tile around the circle
      expect(pixels[color].corner[3]).toBeLessThan(128); // rounded corner stays (mostly) transparent
    }
  } finally {
    await ext.close();
  }
});
test('a long repository list scrolls with the popup, not in a scroll box of its own', async () => {
  const names = Array.from({ length: 16 }, (_, i) => `octo-dev/service-${i + 1}`);
  const mock = new MockGitHub({ repos: Object.fromEntries(names.map((n, i) => [n, { runs: [run({ id: i + 1, workflowId: i + 1, name: 'CI' })] }])) });
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: names.map((n) => ({ id: `${n}:all`, repo: n, branch: 'all', enabled: true })) });
    const page = await ext.context.newPage();
    await page.setViewportSize({ width: 500, height: 600 }); // Chrome's largest popup
    await page.goto(ext.url('popup.html'));
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    await expect(page.locator('.repo-item')).toHaveCount(16);
    const scroll = await page.evaluate(() => {
      const list = document.getElementById('repoList');
      return { inner: list.scrollHeight - list.clientHeight, outer: document.scrollingElement.scrollHeight - innerHeight };
    });
    expect(scroll.inner).toBe(0);
    expect(scroll.outer).toBeGreaterThan(0);
  } finally {
    await ext.close();
  }
});

test('Refresh Now shows its progress in the button, without moving anything around it', async () => {
  const mock = new MockGitHub({ repos: { 'octo-dev/api': { runs: [run({ id: 1, workflowId: 1, name: 'CI' })] } } });
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [repo('octo-dev/api')] });
    const page = await ext.context.newPage();
    await page.setViewportSize({ width: 500, height: 600 });
    await page.goto(ext.url('popup.html'));
    const button = page.locator('#refreshBtn');
    const add = page.getByRole('button', { name: 'Add a repository' });
    const before = { add: await add.boundingBox(), button: await button.boundingBox() };
    await button.click();
    await expect(button).toHaveText('Refreshing');
    await expect(button).toBeDisabled();
    expect(await add.boundingBox()).toEqual(before.add);
    expect((await button.boundingBox()).width).toBe(before.button.width);
    await expect(button).toHaveText('✓ Refreshed');
    expect(await add.boundingBox()).toEqual(before.add);
    expect((await button.boundingBox()).width).toBe(before.button.width);
    await expect(button).toHaveText('Refresh Now', { timeout: 5000 });
    await expect(button).toBeEnabled();
  } finally {
    await ext.close();
  }
});

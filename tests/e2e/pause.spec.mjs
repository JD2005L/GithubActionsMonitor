import { expect, test } from '@playwright/test';
import { launch, seed } from './harness.mjs';
import { MockGitHub } from './mock-github.mjs';

const run = MockGitHub.run;

test('pausing a repository grays it out, moves it down, stops polling it, and resuming restores it', async () => {
  const mock = new MockGitHub({
    repos: {
      'octo-dev/api': { runs: [run({ id: 1, workflowId: 10, name: 'CI', conclusion: 'failure' })] },
      'octo-dev/web': { runs: [run({ id: 2, workflowId: 20, name: 'CI' })] },
    },
  });
  const ext = await launch(mock);
  try {
    await seed(ext, {
      token: mock.token,
      repos: [
        { id: 'octo-dev/api:all', repo: 'octo-dev/api', branch: 'all', enabled: true },
        { id: 'octo-dev/web:all', repo: 'octo-dev/web', branch: 'all', enabled: true },
      ],
    });
    const page = await ext.context.newPage();
    await page.goto(ext.url('popup.html'));
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    const items = page.locator('.repo-item');
    await expect(items.nth(0)).toContainText('octo-dev/api');
    await expect(items.nth(0).locator('.status-dot')).toHaveClass(/status-red/);

    // Pause the failing repo.
    await items.nth(0).getByTitle('Pause monitoring').click();
    await expect(page.locator('.repo-section-header')).toHaveText('Paused');
    await expect(items.nth(1).locator('.repo-name')).toHaveText('octo-dev/api');
    await expect(items.nth(1).locator('.paused-chip')).toHaveText('Paused');
    await expect(items.nth(1)).toHaveClass(/repo-item-disabled/);
    await expect(items.nth(0)).toContainText('octo-dev/web');

    // The toggle re-polls right away; the paused repo is no longer requested and drops out of the results that
    // drive the toolbar icon (so a paused failure cannot keep it red).
    await expect
      .poll(async () => Object.keys(await ext.worker.evaluate(async () => (await chrome.storage.local.get('lastResults')).lastResults ?? {})))
      .toEqual(['octo-dev/web:all']);
    const before = mock.log.filter((r) => r.path === '/repos/octo-dev/api/actions/runs').length;
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    await expect.poll(() => mock.log.filter((r) => r.path === '/repos/octo-dev/web/actions/runs').length).toBeGreaterThan(1);
    expect(mock.log.filter((r) => r.path === '/repos/octo-dev/api/actions/runs').length).toBe(before);

    // Persisted, and resumable.
    expect(await ext.worker.evaluate(async () => (await chrome.storage.sync.get('repos')).repos.map((r) => [r.id, r.enabled]))).toEqual([
      ['octo-dev/api:all', false],
      ['octo-dev/web:all', true],
    ]);
    await items.nth(1).getByTitle('Resume monitoring').click();
    await expect(page.locator('.repo-section-header')).toHaveCount(0);
    await expect(page.locator('.repo-item-disabled')).toHaveCount(0);
  } finally {
    await ext.close();
  }
});

test('repositories saved before pause existed are migrated to enabled', async () => {
  const mock = new MockGitHub({ repos: { 'octo-dev/api': { runs: [run({ id: 1, workflowId: 10, name: 'CI' })] } } });
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [{ id: 'octo-dev/api:main', repo: 'octo-dev/api', branch: 'main' }] });
    const page = await ext.context.newPage();
    await page.goto(ext.url('popup.html'));
    await expect(page.locator('.repo-item')).toHaveCount(1);
    await expect(page.locator('.repo-item-disabled')).toHaveCount(0);
    expect(await ext.worker.evaluate(async () => (await chrome.storage.sync.get('repos')).repos[0].enabled)).toBe(true);
  } finally {
    await ext.close();
  }
});

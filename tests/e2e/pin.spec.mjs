import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, seed } from './harness.mjs';
import { MockGitHub } from './mock-github.mjs';

const SHOTS = join(import.meta.dirname, '..', '..', 'test-results', 'screenshots');
const run = MockGitHub.run;
const syncGet = (ext, key) => ext.worker.evaluate(async (k) => (await chrome.storage.sync.get(k))[k], key);

function sample() {
  return new MockGitHub({
    repos: {
      'octo-dev/api': {
        branches: ['main', 'develop'],
        runs: [
          // The newest push: Deploy and Lint ran on it, CI's latest result is still the previous commit's.
          run({ id: 40, workflowId: 3, name: 'Deploy', title: 'Ship it', startedAgoSec: 60, sha: 'c0ffee1' }),
          run({ id: 39, workflowId: 2, name: 'Lint', title: 'Ship it', startedAgoSec: 70, sha: 'c0ffee1' }),
          run({ id: 38, workflowId: 1, name: 'CI', conclusion: 'failure', title: 'Try a fix', startedAgoSec: 900, sha: 'bead123', failedAt: { job: 'Test', step: 'npm test' } }),
          run({ id: 37, workflowId: 1, name: 'CI', startedAgoSec: 5000, sha: 'aaaa111' }),
          run({ id: 36, workflowId: 1, name: 'CI', branch: 'develop', startedAgoSec: 6000, sha: 'dddd222' }),
        ],
      },
    },
  });
}

test('a card can watch one workflow: picked when adding, or pinned from an expanded card', async () => {
  mkdirSync(SHOTS, { recursive: true });
  const mock = sample();
  const ext = await launch(mock, { colorScheme: 'dark' });
  try {
    await seed(ext, { token: mock.token, repos: [] });
    const page = await ext.context.newPage();
    await page.setViewportSize({ width: 500, height: 700 });
    await page.goto(ext.url('popup.html'));
    const card = (name) => page.locator('.repo-item', { has: page.locator('.workflow-chip', { hasText: name }) });

    // The add form: owner, repository, branch, then all workflows or one of them.
    // With nothing monitored yet, the form is already open.
    const owner = page.getByRole('combobox', { name: 'Owner' });
    await owner.fill('octo-dev');
    await owner.press('Enter');
    await page.locator('#repoSelect').selectOption('octo-dev/api');
    const workflow = page.getByLabel('Workflow');
    await expect(workflow).toBeEnabled();
    expect(await workflow.locator('option').allTextContents()).toEqual(['All workflows', 'CI', 'Deploy', 'Lint']);
    await page.locator('#branchSelect').selectOption('main');
    await workflow.selectOption({ label: 'CI' });
    await page.getByRole('button', { name: 'Add Repo' }).click();
    await expect(page.locator('#branchStatus')).toHaveText('Added octo-dev/api (main, CI)');
    expect(await syncGet(ext, 'repos')).toEqual([{ id: 'octo-dev/api:main:wf1', repo: 'octo-dev/api', branch: 'main', enabled: true, workflow: { id: 1, name: 'CI' } }]);

    // Only that workflow's runs on that branch, read from its own endpoint: the newer Deploy and Lint runs do not count.
    const ci = card('CI');
    await expect(ci.locator('.branch-chip')).toHaveText('main');
    await expect(ci.locator('.repo-sub')).toHaveText(/^Failed · bead123 · Test › npm test/);
    await expect.poll(() => mock.log.some((l) => l.path === '/repos/octo-dev/api/actions/workflows/1/runs')).toBe(true);
    // The failed step opens the failed job's log directly, and the commit opens the commit.
    await expect(ci.locator('.failure-text')).toHaveAttribute('href', 'https://github.com/octo-dev/api/actions/runs/38/job/382');
    await expect(ci.locator('.repo-sub .commit-sha')).toHaveAttribute('href', 'https://github.com/octo-dev/api/commit/bead123');

    // Expanded: one workflow, its main-branch history only, and nothing to switch off or pin.
    await page.getByRole('button', { name: 'Show the workflows of octo-dev/api (main, CI)' }).click();
    await expect(ci.locator('.workflow-row')).toHaveCount(1);
    await expect(ci.locator('.history')).toHaveAttribute('aria-label', 'Last 2 runs (newest right): 1 passed, 1 failed');
    await expect(ci.locator('.switch')).toHaveCount(0);
    await expect(ci.locator('.btn-pin')).toHaveCount(0);

    // A card for every workflow: CI's result is from an older commit than the newest run there, and says so.
    await page.locator('#repoSelect').selectOption('octo-dev/api');
    await page.locator('#branchSelect').selectOption('main');
    await page.getByRole('button', { name: 'Add Repo' }).click();
    const all = page.locator('.repo-item[data-id="octo-dev/api:main"]');
    await expect(all.locator('.repo-sub')).toHaveText(/^1 failing · bead123 · Test › npm test/);
    await expect(all.locator('.repo-sub .commit-sha')).toHaveClass(/is-older/);
    await expect(all.locator('.repo-sub .commit-sha')).toHaveAttribute('title', 'Commit bead123: older than c0ffee1, the newest commit run here');
    await page.getByRole('button', { name: 'Show the workflows of octo-dev/api (main)' }).click();
    const rowSha = (name) => all.locator('.workflow-row', { hasText: name }).locator('.commit-sha');
    await expect(rowSha('Deploy')).toHaveText('c0ffee1');
    await expect(rowSha('Deploy')).not.toHaveClass(/is-older/);
    await expect(rowSha('CI')).toHaveClass(/is-older/);

    // Pin Deploy from the expanded card: a card of its own, right after the one it came from.
    await all.getByRole('button', { name: 'Add a card for only Deploy' }).click();
    await expect(page.locator('#toast')).toHaveText('Added a card for Deploy');
    await expect(card('Deploy').locator('.repo-sub')).toHaveText(/^Success · c0ffee1/);
    await page.screenshot({ path: join(SHOTS, 'popup-pinned-dark.png') });
    expect((await syncGet(ext, 'repos')).map((r) => r.id)).toEqual(['octo-dev/api:main:wf1', 'octo-dev/api:main', 'octo-dev/api:main:wf3']);
    await all.getByRole('button', { name: 'Add a card for only Deploy' }).click();
    await expect(page.locator('#toast')).toHaveText('Deploy already has its own card');
    await expect(page.locator('.repo-item')).toHaveCount(3);

    // Removing names what the card watches.
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('Remove octo-dev/api (main, Deploy)?');
      await dialog.accept();
    });
    await card('Deploy').getByRole('button', { name: 'Remove repository' }).click();
    await expect(page.locator('.repo-item')).toHaveCount(2);
  } finally {
    await ext.close();
  }
});

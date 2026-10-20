import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, seed } from './harness.mjs';
import { MockGitHub } from './mock-github.mjs';

const SHOTS = join(import.meta.dirname, '..', '..', 'test-results', 'screenshots');
const run = MockGitHub.run;
const entry = (repo, enabled = true) => ({ id: `${repo}:all`, repo, branch: 'all', enabled });

test('the list can be sorted, dragged into a custom order, and reordered with the keyboard', async () => {
  mkdirSync(SHOTS, { recursive: true });
  const mock = new MockGitHub({
    repos: {
      'octo-dev/web': { runs: [run({ id: 1, workflowId: 1, name: 'CI', startedAgoSec: 3600 })] },
      'octo-dev/api': { runs: [run({ id: 2, workflowId: 2, name: 'CI', conclusion: 'failure', startedAgoSec: 5000 })] },
      'octo-dev/docs': { runs: [run({ id: 3, workflowId: 3, name: 'CI', status: 'in_progress', startedAgoSec: 7200 })] },
      'octo-dev/old': { runs: [run({ id: 4, workflowId: 4, name: 'CI' })] },
    },
  });
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [entry('octo-dev/web'), entry('octo-dev/api'), entry('octo-dev/old', false), entry('octo-dev/docs')] });
    const page = await ext.context.newPage();
    await page.setViewportSize({ width: 500, height: 600 });
    await page.goto(ext.url('popup.html'));
    await page.getByRole('button', { name: 'Refresh Now' }).click();
    const names = () => page.locator('.repo-item .repo-name').allTextContents();
    const sort = page.getByLabel('Sort');
    await expect(page.locator('.repo-item').first().locator('.status-dot')).toHaveClass(/status-green/);

    // Custom order is the saved order; paused repositories stay at the bottom.
    await expect(sort).toHaveValue('custom');
    expect(await names()).toEqual(['octo-dev/web', 'octo-dev/api', 'octo-dev/docs', 'octo-dev/old']);
    await expect(page.locator('#listCount')).toHaveText('3 monitored, 1 paused');

    await sort.selectOption('name');
    await expect.poll(names).toEqual(['octo-dev/api', 'octo-dev/docs', 'octo-dev/web', 'octo-dev/old']);
    // A running workflow is the most recent activity.
    await sort.selectOption('recent');
    await expect.poll(names).toEqual(['octo-dev/docs', 'octo-dev/web', 'octo-dev/api', 'octo-dev/old']);
    await sort.selectOption('status');
    await expect.poll(names).toEqual(['octo-dev/docs', 'octo-dev/api', 'octo-dev/web', 'octo-dev/old']);

    // The sort is remembered.
    await page.reload();
    await expect(sort).toHaveValue('status');
    await expect.poll(names).toEqual(['octo-dev/docs', 'octo-dev/api', 'octo-dev/web', 'octo-dev/old']);

    // Dragging while sorted starts a custom order from what is shown: web goes to the top.
    const item = (repo) => page.locator('.repo-item', { has: page.locator('.repo-name', { hasText: new RegExp(`^${repo}`) }) });
    await item('octo-dev/web').locator('.drag-handle').dragTo(item('octo-dev/docs'), { targetPosition: { x: 200, y: 5 } });
    await expect.poll(names).toEqual(['octo-dev/web', 'octo-dev/docs', 'octo-dev/api', 'octo-dev/old']);
    await expect(sort).toHaveValue('custom');
    await expect(page.locator('#orderAnnouncer')).toHaveText('octo-dev/web moved to position 1. Sort set to Custom order.');

    // A paused repository cannot be dropped among active ones.
    await item('octo-dev/old').locator('.drag-handle').dragTo(item('octo-dev/web'), { targetPosition: { x: 200, y: 5 } });
    expect(await names()).toEqual(['octo-dev/web', 'octo-dev/docs', 'octo-dev/api', 'octo-dev/old']);

    // Keyboard: arrow keys on a handle move it, and focus stays on it.
    await item('octo-dev/api').locator('.drag-handle').focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(names).toEqual(['octo-dev/web', 'octo-dev/api', 'octo-dev/docs', 'octo-dev/old']);
    await expect(item('octo-dev/api').locator('.drag-handle')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect.poll(names).toEqual(['octo-dev/api', 'octo-dev/web', 'octo-dev/docs', 'octo-dev/old']);
    await page.screenshot({ path: join(SHOTS, 'popup-order.png') });

    // The custom order is saved (synced), so it survives reopening.
    await page.reload();
    await expect.poll(names).toEqual(['octo-dev/api', 'octo-dev/web', 'octo-dev/docs', 'octo-dev/old']);
    const stored = await ext.worker.evaluate(() => chrome.storage.sync.get(['repos', 'sortMode']));
    expect(stored.sortMode).toBe('custom');
    expect(stored.repos.map((r) => r.repo)).toEqual(['octo-dev/api', 'octo-dev/web', 'octo-dev/docs', 'octo-dev/old']);

    // Changed in another browser (Chrome Sync): the open popup follows the sort and the custom order live.
    await ext.worker.evaluate(() => chrome.storage.sync.set({ sortMode: 'name' }));
    await expect(sort).toHaveValue('name');
    await expect.poll(names).toEqual(['octo-dev/api', 'octo-dev/docs', 'octo-dev/web', 'octo-dev/old']);
    await ext.worker.evaluate(async () => {
      const { repos } = await chrome.storage.sync.get('repos');
      await chrome.storage.sync.set({ sortMode: 'custom', repos: [repos[2], repos[0], repos[1], repos[3]] });
    });
    await expect(sort).toHaveValue('custom');
    await expect.poll(names).toEqual(['octo-dev/docs', 'octo-dev/api', 'octo-dev/web', 'octo-dev/old']);
    // Paused elsewhere: the card moves to the paused section and the counts follow.
    await ext.worker.evaluate(async () => {
      const { repos } = await chrome.storage.sync.get('repos');
      await chrome.storage.sync.set({ repos: repos.map((r) => (r.repo === 'octo-dev/docs' ? { ...r, enabled: false } : r)) });
    });
    await expect(page.locator('#listCount')).toHaveText('2 monitored, 2 paused');
  } finally {
    await ext.close();
  }
});

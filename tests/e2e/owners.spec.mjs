import { expect, test } from '@playwright/test';
import { launch, seed } from './harness.mjs';
import { MockGitHub } from './mock-github.mjs';

const run = MockGitHub.run;
const ci = (id) => [run({ id, workflowId: id, name: 'CI' })];

test('the owner field remembers owners and lists all of an owner’s repositories to pick from', async () => {
  const mock = new MockGitHub({
    repos: {
      'octo-dev/api': { private: true, branches: ['main', 'develop'], runs: ci(1) },
      'octo-dev/web': { runs: ci(2) },
      'acme-org/deploy': { private: true, runs: ci(3) },
      'acme-org/site': { archived: true, runs: ci(4) },
      'torvalds/linux': { foreign: true, runs: ci(5) },
    },
  });
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [] });
    const page = await ext.context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(ext.url('popup.html'));
    const owner = page.getByRole('combobox', { name: 'Owner' });
    const repo = page.locator('#repoSelect');
    const branch = page.locator('#branchSelect');
    const add = page.getByRole('button', { name: 'Add Repo' });
    const options = () => repo.locator('option').allTextContents();

    // Nothing remembered yet: an empty field, and the repository list waits for an owner.
    await expect(owner).toHaveValue('');
    await expect(repo).toBeDisabled();

    // Enter loads every repository of the owner, private ones included.
    await owner.fill('octo-dev');
    await owner.press('Enter');
    await expect(repo).toBeEnabled();
    expect(await options()).toEqual(['Choose a repository', 'api (private)', 'web']);
    // The count sits next to the Repository label, as it describes the dropdown's items.
    await expect(page.locator('label[for="repoSelect"]')).toHaveText('Repository 2 from octo-dev');
    await expect(page.locator('#branchStatus')).toHaveText('');
    await repo.selectOption('octo-dev/api');
    await expect(branch).toBeEnabled();
    expect(await branch.locator('option').allTextContents()).toEqual(['All branches', 'main', 'develop']);
    await add.click();
    await expect(page.locator('.repo-item').first()).toContainText('octo-dev/api');
    // The owner stays, and the list marks what is monitored.
    await expect(owner).toHaveValue('octo-dev');
    await expect.poll(options).toEqual(['Choose a repository', 'api (private, monitored)', 'web']);

    // A pause in typing is enough; GitHub's spelling of the name is used.
    await owner.fill('ACME-ORG');
    await expect.poll(options).toEqual(['Choose a repository', 'deploy (private)', 'site (archived)']);
    await expect(owner).toHaveValue('acme-org');
    await repo.selectOption('acme-org/site');
    await expect(add).toBeEnabled();
    await add.click();
    await expect(page.locator('.repo-item')).toHaveCount(2);

    // Someone else's public repositories are listed too.
    await owner.fill('torvalds');
    await owner.press('Enter');
    await expect.poll(options).toEqual(['Choose a repository', 'linux']);

    // An owner that does not exist says so.
    await owner.fill('nobody-here');
    await owner.press('Enter');
    await expect(page.locator('#branchStatus')).toHaveText('No GitHub user or organization named "nobody-here".');
    await expect(page.locator('#repoCount')).toHaveText('');
    await expect(repo).toBeDisabled();

    // Reopening the popup brings back the last owner that loaded, with its repositories ready. With repositories
    // monitored, the add form starts folded away.
    await page.reload();
    await expect(page.locator('#addPanel')).toBeHidden();
    await page.getByRole('button', { name: 'Add a repository' }).click();
    await expect(owner).toHaveValue('torvalds');
    await expect.poll(options).toEqual(['Choose a repository', 'linux']);

    // Remembered owners, most recent first, with how many repositories each has monitored.
    await owner.fill('');
    await owner.focus();
    const suggestions = page.getByRole('listbox', { name: 'Remembered owners' }).getByRole('option');
    await expect(suggestions).toHaveText([/acme-org\s*1 monitored/, /octo-dev\s*1 monitored/]);
    await owner.press('ArrowDown');
    await owner.press('ArrowDown');
    await owner.press('Enter');
    await expect(owner).toHaveValue('octo-dev');
    await expect.poll(options).toEqual(['Choose a repository', 'api (private, monitored)', 'web']);

    // Removing an owner's last repository keeps the owner remembered until it is forgotten.
    await page.locator('.repo-item', { hasText: 'octo-dev/api' }).getByTitle('Remove repository').click();
    await expect(page.locator('.repo-item')).toHaveCount(1);
    await owner.fill('');
    await owner.focus();
    await expect(suggestions).toHaveText([/acme-org\s*1 monitored/, /octo-dev\s*Remembered/]);
    await page.getByRole('button', { name: 'Forget octo-dev' }).click();
    await expect(suggestions).toHaveText([/acme-org\s*1 monitored/]);
    await expect(page.getByRole('button', { name: 'Forget acme-org' })).toHaveCount(0);
    const stored = await ext.worker.evaluate(() => chrome.storage.sync.get(['owners', 'lastOwner']));
    expect(stored.owners).toEqual(['acme-org']);
  } finally {
    await ext.close();
  }
});

test('a read-only token that cannot list branches still offers branches from workflow runs, and never blocks adding', async () => {
  const mock = new MockGitHub({
    repos: {
      'octo-dev/private-app': {
        private: true,
        branchesForbidden: true,
        runs: [run({ id: 1, workflowId: 1, name: 'CI', branch: 'main' }), run({ id: 2, workflowId: 1, name: 'CI', branch: 'release' }), run({ id: 3, workflowId: 2, name: 'Deploy', branch: 'main' })],
      },
      'octo-dev/quiet': { private: true, branchesForbidden: true, runs: [] },
    },
  });
  const ext = await launch(mock);
  try {
    await seed(ext, { token: mock.token, repos: [] });
    const page = await ext.context.newPage();
    await page.goto(ext.url('popup.html'));
    const owner = page.getByRole('combobox', { name: 'Owner' });
    const repo = page.locator('#repoSelect');
    const branch = page.locator('#branchSelect');
    const add = page.getByRole('button', { name: 'Add Repo' });
    await owner.fill('octo-dev');
    await owner.press('Enter');

    await repo.selectOption('octo-dev/private-app');
    await expect(add).toBeEnabled();
    expect(await branch.locator('option').allTextContents()).toEqual(['All branches', 'main', 'release']);
    await expect(page.locator('#branchStatus')).toHaveText('2 branches with workflow runs (the token cannot list all branches)');
    await branch.selectOption('release');
    await add.click();
    await expect(page.locator('.repo-item .repo-name')).toHaveText(['octo-dev/private-app']);
    await expect(page.locator('.repo-item .branch-chip')).toHaveText(['release']);

    // No runs yet: "All branches" is still available.
    await repo.selectOption('octo-dev/quiet');
    await expect(add).toBeEnabled();
    expect(await branch.locator('option').allTextContents()).toEqual(['All branches']);
    await expect(page.locator('#branchStatus')).toHaveText('No branches with workflow runs yet; "All branches" will pick up any run');
    await add.click();
    await expect(page.locator('.repo-item')).toHaveCount(2);
  } finally {
    await ext.close();
  }
});

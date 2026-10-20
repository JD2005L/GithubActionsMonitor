import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, seed } from './harness.mjs';
import { MockGitHub } from './mock-github.mjs';

const local = (ext, key) => ext.worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);

const SHOTS = join(import.meta.dirname, '..', '..', 'test-results', 'screenshots');
const run = MockGitHub.run;

test('settings are split into tabs: Setup first without a token, then the last tab used', async () => {
  mkdirSync(SHOTS, { recursive: true });
  const mock = new MockGitHub({ repos: { 'octo-dev/api': { private: true, runs: [run({ id: 1, workflowId: 1, name: 'CI' })] }, 'octo-dev/web': { runs: [] } } });
  const ext = await launch(mock);
  try {
    const page = await ext.context.newPage();
    await page.goto(ext.url('options.html'));
    const tab = (name) => page.getByRole('tab', { name });
    // No token yet: Setup is open and marked.
    await expect(tab(/^Setup/)).toHaveAttribute('aria-selected', 'true');
    await expect(tab('Setup (no token yet)')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Choose features/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Polling Interval' })).toBeHidden();

    await tab('API usage').click();
    await expect(page.getByRole('heading', { name: 'API Usage' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'GitHub Personal Access Token' })).toBeHidden();
    await page.keyboard.press('ArrowLeft');
    await expect(tab('Monitoring')).toHaveAttribute('aria-selected', 'true');
    await expect(tab('Monitoring')).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Polling Interval' })).toBeVisible();

    // With a token, the page reopens on the last tab used; a #tab link opens that tab.
    await tab(/^Setup/).click();
    await page.getByRole('button', { name: /Connect GitHub/ }).click();
    await page.locator('#tokenInput').fill(mock.token);
    await page.getByRole('button', { name: 'Save Token' }).click();
    await expect(tab('Setup', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'settings-setup-light.png'), fullPage: true });
    await tab('How it works').click();
    await page.goto(ext.url('options.html'));
    await expect(tab('How it works')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: /Owner and Repository Picker/ })).toBeVisible();
    await page.goto(ext.url('options.html#usage'));
    await expect(tab('API usage')).toHaveAttribute('aria-selected', 'true');

    await page.emulateMedia({ colorScheme: 'dark' });
    await tab(/^Setup/).click();
    await page.screenshot({ path: join(SHOTS, 'settings-setup-dark.png'), fullPage: true });

    // The popup's add form, for a visual check.
    await seed(ext, { token: mock.token, repos: [{ id: 'octo-dev/api:all', repo: 'octo-dev/api', branch: 'all', enabled: true }], extra: { sync: { owners: ['octo-dev'], lastOwner: 'octo-dev' } } });
    const popup = await ext.context.newPage();
    await popup.setViewportSize({ width: 500, height: 600 });
    await popup.emulateMedia({ colorScheme: 'dark' });
    await popup.goto(ext.url('popup.html'));
    await popup.getByRole('button', { name: 'Add a repository' }).click();
    await expect(popup.locator('#repoSelect')).toBeEnabled();
    await popup.getByRole('combobox', { name: 'Owner' }).click();
    await popup.screenshot({ path: join(SHOTS, 'popup-owner-dark.png') });
    await popup.keyboard.press('Escape');
    await popup.locator('#repoSelect').selectOption('octo-dev/web');
    await expect(popup.getByRole('button', { name: 'Add Repo' })).toBeEnabled();
    await popup.screenshot({ path: join(SHOTS, 'popup-add-dark.png') });
  } finally {
    await ext.close();
  }
});

test('setup asks for the features first, so the token is created once with the right permission', async () => {
  const mock = new MockGitHub({ repos: { 'octo-dev/api': { runs: [run({ id: 1, workflowId: 1, name: 'CI' })] } } });
  const ext = await launch(mock);
  try {
    const page = await ext.context.newPage();
    await page.goto(ext.url('options.html'));
    const steps = page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button');
    const next = page.getByRole('button', { name: 'Next' });
    await expect(steps).toHaveText([/1\s*Choose features\s*Optional/, /2\s*Connect GitHub\s*Required/, /3\s*Add repositories/]);
    // Without a token, setup opens on the features.
    await expect(steps.first()).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('button', { name: 'Back' })).toBeHidden();
    await expect(page.getByRole('heading', { name: /Choose features/ })).toBeVisible();

    // Badge and notifications, shared with the Monitoring tab.
    await expect(page.getByRole('radio', { name: /Failing, else running/ })).toBeChecked();
    await page.getByRole('radio', { name: /Failing only/ }).check();
    await expect.poll(() => ext.worker.evaluate(async () => (await chrome.storage.sync.get('badgeMode')).badgeMode)).toBe('failing');
    await expect(page.getByRole('checkbox', { name: /Desktop notifications/ })).toBeChecked();
    await page.getByRole('checkbox', { name: /Desktop notifications/ }).uncheck();

    // Re-run and cancel, off by default. On, it says the token about to be made will include the permission.
    const runControls = page.locator('.setup-step[data-step="features"]').getByRole('checkbox', { name: 'Show re-run and cancel buttons in the popup' });
    await expect(runControls).not.toBeChecked();
    await expect(page.locator('#runControlsHint')).toBeHidden();
    await runControls.check();
    await expect(page.locator('#runControlsHint')).toHaveText(/The token you create in the next step will include Actions: Read and write/);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: join(SHOTS, 'settings-features-dark.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });
    await next.click();

    // The token step's one link asks for exactly that permission.
    await expect(steps.first().locator('.step-num')).toHaveText('✓');
    await expect(page.getByRole('heading', { name: 'GitHub Personal Access Token' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create a read-only token on GitHub' })).toHaveCount(0);
    const create = page.getByRole('link', { name: 'Create a token with re-run and cancel' });
    expect(new URL(await create.getAttribute('href')).searchParams.get('actions')).toBe('write');
    await expect(page.locator('#createTokenNote')).toContainText('Actions: Read and write');
    await expect(page.locator('#tokenUpgrade')).toBeHidden();
    await expect(next).toBeDisabled();
    await expect(page.locator('#stepHint')).toHaveText('Save a token to continue.');
    await page.screenshot({ path: join(SHOTS, 'settings-steps.png'), fullPage: true });

    // The token made from that link has the permission. Saved, the instructions give way to a connected card,
    // and the check confirms re-run and cancel by asking to cancel a finished run, which GitHub declines (409).
    mock.canWrite = true;
    await page.locator('#tokenInput').fill(mock.token);
    await page.getByRole('button', { name: 'Save Token' }).click();
    await expect(next).toBeEnabled();
    const card = page.locator('#tokenConnected');
    await expect(card.locator('#tcTitle')).toHaveText('Connected as @octo-dev');
    await expect(card.locator('#tcAccess')).toHaveText('✓ Allowed');
    await expect(card).toHaveClass(/good/);
    await expect(page.locator('#tokenSetup')).toBeHidden();
    await expect(page.locator('#tokenUpgrade')).toBeHidden();
    expect(await local(ext, 'tokenAccess')).toBe('write');
    // Nothing was cancelled: the only POST went to a run that had already finished.
    expect(mock.log.filter((r) => r.method === 'POST').map((r) => r.path)).toEqual(['/repos/octo-dev/api/actions/runs/1/cancel']);
    await page.screenshot({ path: join(SHOTS, 'settings-token-connected.png'), fullPage: true });
    await next.click();
    await expect(page.locator('#stepHint')).toHaveText('Open the popup to add your first repository.');
    await expect(next).toBeHidden();
    await expect(steps.nth(1).locator('.step-num')).toHaveText('✓');

    // The Monitoring tab shows the same settings.
    await page.getByRole('tab', { name: 'Monitoring' }).click();
    await expect(page.locator('#badgeSelect')).toHaveValue('failing');
    await expect(page.locator('#runControlsCheckbox')).toBeChecked();
    await expect(page.locator('#notificationsCheckbox')).not.toBeChecked();
    await page.locator('#badgeSelect').selectOption('off');
    await page.locator('#runControlsCheckbox').uncheck();
    expect(await ext.worker.evaluate(() => chrome.storage.sync.get(['badgeMode', 'runControls', 'notificationsEnabled']))).toEqual({ badgeMode: 'off', runControls: false, notificationsEnabled: false });

    // Reopening goes back to the step last open.
    await page.goto(ext.url('options.html#setup'));
    await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step');
  } finally {
    await ext.close();
  }
});

test('a saved token shows as connected; with re-run and cancel on, it is checked for write access', async () => {
  const mock = new MockGitHub({ repos: { 'octo-dev/api': { runs: [run({ id: 7, workflowId: 1, name: 'CI' })] } } });
  const ext = await launch(mock);
  try {
    await ext.worker.evaluate((token) => chrome.storage.local.set({ token }), mock.token);
    const page = await ext.context.newPage();
    await page.goto(ext.url('options.html#setup'));
    const steps = page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button');
    // Already set up: the token step is a status card, without instructions.
    await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
    const card = page.locator('#tokenConnected');
    await expect(card.locator('#tcTitle')).toHaveText('Connected as @octo-dev');
    await expect(card.locator('#tcSub')).toHaveText('This step is done. Monitoring uses this token.');
    await expect(card.locator('#tcKind')).toHaveText('Fine-grained, this device only');
    await expect(card.locator('#tcRepos')).toHaveText('Can see 1');
    await expect(card.locator('#tcAccess')).toHaveText('Off (Choose features)');
    await expect(page.locator('#tokenSetup')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Save Token' })).toBeHidden();
    // Read-only needs no write check.
    expect(mock.log.filter((r) => r.method === 'POST')).toEqual([]);

    // Switching on re-run and cancel checks the token: this one is read-only, so GitHub refuses (403).
    await page.goto(ext.url('options.html#monitoring'));
    await page.locator('#runControlsCheckbox').check();
    await page.getByRole('link', { name: 'add it to your token' }).click();
    await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(card.locator('#tcAccess')).toHaveText('Needs Read and write');
    await expect(card).toHaveClass(/warn/);
    const upgrade = page.locator('#tokenUpgrade');
    await expect(upgrade).toBeVisible();
    await expect(upgrade).toContainText('The token\'s value does not change, so there is nothing to paste here again.');
    await expect(upgrade.getByRole('link', { name: 'Open your tokens on GitHub' })).toHaveAttribute('href', 'https://github.com/settings/personal-access-tokens');
    expect(await local(ext, 'tokenAccess')).toBe('read');
    await page.screenshot({ path: join(SHOTS, 'settings-token-upgrade.png'), fullPage: true });
    await steps.first().click();
    await expect(page.locator('#runControlsHint')).toHaveText(/add Actions: Read and write to it\./);

    // After editing the token on GitHub, "Check again" confirms it and the guide goes away.
    mock.canWrite = true;
    await steps.nth(1).click();
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(card.locator('#tcAccess')).toHaveText('✓ Allowed');
    await expect(upgrade).toBeHidden();
    await expect(card).toHaveClass(/good/);
    expect(await local(ext, 'tokenAccess')).toBe('write');
    await steps.first().click();
    await expect(page.locator('#runControlsHint')).toHaveText('Your saved token has Actions: Read and write.');

    // Replace token brings the instructions back under the card; "Keep the current token" folds them away.
    await steps.nth(1).click();
    await page.getByRole('button', { name: 'Replace token' }).click();
    await expect(page.locator('#tokenSetup')).toBeVisible();
    await expect(page.locator('#tokenInput')).toBeFocused();
    await page.getByRole('button', { name: 'Keep the current token' }).click();
    await expect(page.locator('#tokenSetup')).toBeHidden();

    // A classic token is judged by its scopes, without asking GitHub to cancel anything.
    const posts = mock.log.filter((r) => r.method === 'POST').length;
    mock.token = `ghp_${'c'.repeat(36)}`;
    mock.tokenKind = 'classic';
    await ext.worker.evaluate((token) => chrome.storage.local.set({ token, tokenAccess: 'read' }), mock.token);
    await page.reload();
    await expect(card.locator('#tcKind')).toHaveText('Classic, this device only');
    await expect(card.locator('#tcAccess')).toHaveText('✓ Allowed');
    expect(mock.log.filter((r) => r.method === 'POST').length).toBe(posts);

    // A token GitHub no longer accepts: the card says so and the instructions for a new one open.
    mock.token = 'github_pat_rotated_00000000000000000000';
    await page.reload();
    await expect(card.locator('#tcTitle')).toHaveText('GitHub did not accept the saved token');
    await expect(card).toHaveClass(/bad/);
    await expect(page.locator('#tokenSetup')).toBeVisible();

    // Removing it leaves just the instructions.
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Remove token' }).click();
    await expect(card).toBeHidden();
    await expect(page.locator('#tokenStatus')).toHaveText('✓ Token removed');
    expect(await local(ext, 'token')).toBeUndefined();
  } finally {
    await ext.close();
  }
});

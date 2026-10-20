// Options page controller for GitHub Actions Monitor

let currentData = {
  token: null,
  pollIntervalSeconds: 30,
  syncToken: false,
  notificationsEnabled: true,
  repos: [],
  pollStats: null,
  badgeMode: 'both',
  runControls: false
};

// Initialize options page on load
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
  setupTabs();
  setupSteps();
  renderUI();
  checkConnection();
});

const TABS = ['setup', 'monitoring', 'usage', 'guide'];
const TAB_KEY = 'gam.options.tab';

/**
 * Tabs instead of one long page: a #tab link opens that tab, otherwise the last one used. Without a token the page
 * always opens on Setup.
 */
function setupTabs() {
  const fromHash = TABS.find((t) => `#${t}` === location.hash);
  let saved = null;
  try {
    saved = localStorage.getItem(TAB_KEY);
  } catch {
    // Storage blocked: start on Setup.
  }
  selectTab(fromHash || (!currentData.token ? 'setup' : TABS.find((t) => t === saved) || 'setup'), { remember: false });

  // A #tab link followed while the page is already open changes only the hash.
  window.addEventListener('hashchange', () => {
    const tab = TABS.find((t) => `#${t}` === location.hash);
    if (tab) selectTab(tab);
  });

  const tablist = document.querySelector('[role="tablist"]');
  for (const tab of TABS) {
    document.getElementById(`tab-${tab}`).addEventListener('click', () => selectTab(tab));
  }
  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  tablist.addEventListener('keydown', (e) => {
    const index = TABS.indexOf(document.querySelector('[role="tab"][aria-selected="true"]').id.replace('tab-', ''));
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const tab = TABS[(next + TABS.length) % TABS.length];
    selectTab(tab);
    document.getElementById(`tab-${tab}`).focus();
  });
}

function selectTab(tab, { remember = true } = {}) {
  for (const t of TABS) {
    const button = document.getElementById(`tab-${t}`);
    const selected = t === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    document.getElementById(`panel-${t}`).hidden = !selected;
  }
  if (remember) {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // Storage blocked: the tab still switches for this page view.
    }
    history.replaceState(null, '', `#${tab}`);
  }
}

const STEPS = ['features', 'token', 'repos'];
const STEP_KEY = 'gam.options.step';
const SEEN_KEY = 'gam.options.stepsSeen';
let currentStep = 'token';

/** localStorage, which can be blocked: then the page simply does not remember. */
const remembered = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage blocked: only this page view remembers.
    }
  }
};

/**
 * Setup as steps: the optional features first, because re-run and cancel decide which permission the token needs
 * (so only one token is ever created), then the token (required), then where repositories are added. Opens at the
 * step last open, else at the features (no token yet) or the token (already set up). Every step can be opened
 * directly from the step list.
 */
function setupSteps() {
  const saved = remembered.get(STEP_KEY);
  currentStep = STEPS.includes(saved) ? saved : currentData.token ? 'token' : 'features';
  markSeen(currentStep);
  for (const link of document.querySelectorAll('.step-link')) {
    link.addEventListener('click', () => selectStep(link.dataset.step));
  }
  document.getElementById('stepBack').addEventListener('click', () => selectStep(STEPS[Math.max(0, STEPS.indexOf(currentStep) - 1)]));
  document.getElementById('stepNext').addEventListener('click', () => selectStep(STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(currentStep) + 1)]));
  // Links elsewhere on the page that open a step ("set it up").
  for (const link of document.querySelectorAll('[data-goto-step]')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      selectTab('setup');
      selectStep(link.dataset.gotoStep);
    });
  }
}

function seenSteps() {
  return (remembered.get(SEEN_KEY) || '').split(',').filter(Boolean);
}

function markSeen(step) {
  if (!seenSteps().includes(step)) remembered.set(SEEN_KEY, [...seenSteps(), step].join(','));
}

function selectStep(step) {
  currentStep = step;
  remembered.set(STEP_KEY, step);
  markSeen(step);
  renderSteps();
  const section = document.querySelector(`.setup-step[data-step="${step}"]`);
  if (section) section.querySelector('h2').focus({ preventScroll: true });
}

function renderSteps() {
  document.getElementById('setupDot').classList.toggle('hidden', !!currentData.token);
  const seen = seenSteps();
  const done = {
    features: seen.includes('features') || !!currentData.token,
    token: !!currentData.token,
    repos: currentData.repos.length > 0
  };
  for (const link of document.querySelectorAll('.step-link')) {
    const step = link.dataset.step;
    const current = step === currentStep;
    link.classList.toggle('is-current', current);
    link.classList.toggle('is-done', done[step] && !current);
    if (current) link.setAttribute('aria-current', 'step');
    else link.removeAttribute('aria-current');
    link.querySelector('.step-num').textContent = done[step] && !current ? '✓' : String(STEPS.indexOf(step) + 1);
  }
  for (const section of document.querySelectorAll('.setup-step')) {
    section.hidden = section.dataset.step !== currentStep;
    section.querySelector('h2').tabIndex = -1;
  }
  const index = STEPS.indexOf(currentStep);
  const back = document.getElementById('stepBack');
  const next = document.getElementById('stepNext');
  back.hidden = index === 0;
  next.hidden = index === STEPS.length - 1;
  const needsToken = currentStep === 'token' && !currentData.token;
  next.disabled = needsToken;
  const hints = {
    features: 'Optional: the defaults are fine, and the Monitoring tab can change them later.',
    token: needsToken ? 'Save a token to continue.' : '',
    repos: currentData.repos.length ? `${currentData.repos.length} monitored. You are all set.` : 'Open the popup to add your first repository.'
  };
  document.getElementById('stepHint').textContent = hints[currentStep];
}

/** Preferences shown in more than one place (setup steps and the Monitoring tab) stay in step. */
const PREFS = {
  badgeMode: (value) => StorageManager.savePreference('badgeMode', value),
  runControls: (value) => StorageManager.savePreference('runControls', value),
  iconOpens: (value) => StorageManager.savePreference('iconOpens', value),
  notificationsEnabled: (value) => StorageManager.saveNotificationsEnabled(value)
};

function renderPrefs() {
  for (const input of document.querySelectorAll('[data-pref]')) {
    const value = currentData[input.dataset.pref];
    if (input.type === 'checkbox') input.checked = !!value;
    else if (input.type === 'radio') input.checked = input.value === value;
    else input.value = value;
  }
  for (const node of document.querySelectorAll('[data-shown-by]')) {
    node.hidden = !currentData[node.dataset.shownBy];
  }
  renderTokenGuide();
}

const TOKEN_FORM = 'https://github.com/settings/personal-access-tokens/new';

/** What kind of token is saved: classic tokens start with ghp_; fine-grained ones with github_pat_. */
function savedTokenKind() {
  if (!currentData.token) return null;
  return currentData.token.startsWith('ghp_') ? 'classic' : 'fine-grained';
}

/**
 * The token step follows the features chosen before it. Without a token, the link opens GitHub's form with the
 * one permission needed: Actions read-only, or read and write when re-run and cancel are on. With a token already
 * saved and re-run and cancel switched on, it explains how to add the permission to that same token instead of
 * making a new one (a fine-grained token's permissions can be edited; its value stays the same).
 */
function renderTokenGuide() {
  const write = !!currentData.runControls;
  const kind = savedTokenKind();
  const params = new URLSearchParams({
    name: 'GitHub Actions Monitor',
    description: write
      ? 'Workflow runs for the GitHub Actions Monitor Chrome extension, with re-run and cancel'
      : 'Read-only access to workflow runs for the GitHub Actions Monitor Chrome extension',
    expires_in: '90',
    actions: write ? 'write' : 'read'
  });
  const link = document.getElementById('createTokenLink');
  link.href = `${TOKEN_FORM}?${params.toString().replace(/\+/g, '%20')}`;
  link.textContent = write ? 'Create a token with re-run and cancel' : 'Create a read-only token on GitHub';
  // With a token saved, making another is the fallback, not the next thing to do.
  link.classList.toggle('btn-primary', !kind);
  link.classList.toggle('btn-secondary', !!kind);
  const permission = write ? 'Actions: Read and write' : 'Actions: Read-only';
  const note = document.getElementById('createTokenNote');
  note.replaceChildren(
    "Opens GitHub's form with the name, a 90-day expiry and ",
    textEl('strong', permission),
    write
      ? ' already set, for re-run and cancel (Metadata: Read-only is added automatically).'
      : ' already set (Metadata: Read-only is added automatically).'
  );
  const intro = document.getElementById('tokenIntro');
  intro.replaceChildren(
    ...(write
      ? ['With re-run and cancel on, the token needs ', textEl('strong', 'Actions: Read and write'),
         ". A fine-grained token with only that permission can re-run and cancel workflows, but cannot touch code, settings or anything else."]
      : ['The extension only needs to ', textEl('strong', 'read'),
         ' workflow runs. Use a fine-grained token with read-only access: it cannot change anything on GitHub, even if it leaked.'])
  );

  const upgrade = document.getElementById('tokenUpgrade');
  const needsWrite = write && !!kind && currentData.tokenAccess === 'read';
  upgrade.hidden = !needsWrite;
  for (const node of upgrade.querySelectorAll('[data-kind]')) node.hidden = node.dataset.kind !== kind;

  const hint = document.getElementById('runControlsHint');
  hint.textContent = !kind
    ? 'The token you create in the next step will include Actions: Read and write.'
    : currentData.tokenAccess === 'write'
      ? 'Your saved token has Actions: Read and write.'
      : !needsWrite
        ? 'The next step checks whether your saved token has Actions: Read and write.'
        : kind === 'classic'
      ? 'Your saved classic token works if it has the repo scope; the next step says how to check.'
      : 'You already have a token: the next step shows how to add Actions: Read and write to it.';
}

/** A small element with text, for the token guide. */
function textEl(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

async function handlePrefChange(e) {
  const input = e.target.closest && e.target.closest('[data-pref]');
  if (!input) return;
  const pref = input.dataset.pref;
  if (input.type === 'radio' && !input.checked) return;
  const value = input.type === 'checkbox' ? input.checked : input.value;
  currentData[pref] = value;
  await PREFS[pref](value);
  renderPrefs();
  if (pref === 'runControls') renderConnection();
  if (pref === 'runControls' && value && currentData.token && currentData.tokenAccess !== 'write') checkConnection();
  if (pref === 'notificationsEnabled') {
    showStatus('notificationsStatus', `✓ Notifications ${value ? 'enabled' : 'disabled'}`, 'success');
    setTimeout(() => {
      document.getElementById('notificationsStatus').textContent = '';
    }, 3000);
  }
}

// Keep the API usage figures (and the steps' progress) live while the page is open
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if ((areaName === 'local' && changes.pollStats) || (areaName === 'sync' && changes.repos)) {
    await loadSettings();
    renderRateLimitInfo();
    renderSteps();
  }
  if (changes.tokenAccess || (areaName === 'sync' && (changes.badgeMode || changes.runControls || changes.notificationsEnabled || changes.iconOpens))) {
    await loadSettings();
    renderPrefs();
    renderConnection();
  }
});

/**
 * Load settings from storage
 */
async function loadSettings() {
  const data = await StorageManager.getData();
  currentData.token = data.token || null;
  currentData.tokenAccess = data.tokenAccess || null;
  currentData.lastResults = data.lastResults || {};
  currentData.pollIntervalSeconds = data.pollIntervalSeconds || 30;
  currentData.syncToken = data.syncToken || false;
  currentData.notificationsEnabled = data.notificationsEnabled !== undefined ? data.notificationsEnabled : true;
  currentData.repos = data.repos || [];
  currentData.pollStats = data.pollStats || null;
  currentData.badgeMode = data.badgeMode;
  currentData.runControls = data.runControls;
  currentData.iconOpens = data.iconOpens;
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  document.getElementById('saveTokenBtn').addEventListener('click', saveToken);
  document.getElementById('testTokenBtn').addEventListener('click', () => testToken());
  document.getElementById('clearTokenBtn').addEventListener('click', clearToken);
  document.getElementById('saveIntervalBtn').addEventListener('click', saveInterval);
  document.getElementById('syncTokenCheckbox').addEventListener('change', handleSyncChange);
  document.getElementById('checkTokenBtn').addEventListener('click', () => checkConnection());
  document.getElementById('replaceTokenBtn').addEventListener('click', () => setReplacing(true));
  document.getElementById('cancelReplaceBtn').addEventListener('click', () => setReplacing(false));
  document.addEventListener('change', handlePrefChange);

  document.getElementById('tokenInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveToken();
    }
  });
}

/**
 * Render the UI
 */
function renderUI() {
  renderTokenStatus();
  renderIntervalSelect();
  renderSyncCheckbox();
  renderPrefs();
  renderRateLimitInfo();
  renderSteps();
}

/**
 * Render token status
 */
function renderTokenStatus() {
  document.getElementById('setupDot').classList.toggle('hidden', !!currentData.token);
  renderTokenGuide();
  const hasToken = !!currentData.token;
  if (!hasToken) replacingToken = false;
  document.getElementById('tokenConnected').hidden = !hasToken;
  document.getElementById('tokenSetup').hidden = hasToken && !replacingToken;
  document.getElementById('cancelReplaceBtn').hidden = !(hasToken && replacingToken);
  const statusEl = document.getElementById('tokenStatus');
  if (hasToken) {
    statusEl.textContent = '';
    statusEl.className = 'status-text';
  } else {
    statusEl.textContent = '✗ No token configured';
    statusEl.className = 'status-text error';
  }
  renderConnection();
}

/** Replacing the saved token shows the instructions and the field again, under the card. */
let replacingToken = false;

function setReplacing(on) {
  replacingToken = on;
  if (!on) {
    document.getElementById('tokenInput').value = '';
    document.getElementById('tokenReport').classList.add('hidden');
  }
  renderTokenStatus();
  if (on) document.getElementById('tokenInput').focus();
}

/** The last check of the saved token: { state: 'checking' | 'ok' | 'bad', result }. */
let connection = null;
let connectionCheck = 0;

/** Finished runs from the last poll, to check run access against without looking any up. */
function knownFinishedRuns() {
  const runs = [];
  for (const [key, result] of Object.entries(currentData.lastResults || {})) {
    for (const workflow of (result && result.workflows) || []) {
      if (workflow.status === 'completed' && workflow.runId) runs.push({ repo: key.split(':')[0], runId: workflow.runId });
    }
  }
  return runs;
}

/**
 * Check the saved token with GitHub: whose it is, what it can see, and (with re-run and cancel on) whether it has
 * Actions: Read and write. Runs when the page opens, after saving, on "Check again", and when re-run and cancel
 * are switched on.
 */
async function checkConnection() {
  const token = currentData.token;
  if (!token) return;
  const id = ++connectionCheck;
  connection = { state: 'checking', result: connection && connection.result };
  renderConnection();
  const result = await GitHubAPI.testToken(token);
  if (result.ok && currentData.runControls) {
    const access = await GitHubAPI.checkRunAccess(token, result, knownFinishedRuns());
    if (access && id === connectionCheck && token === currentData.token) {
      currentData.tokenAccess = access;
      await StorageManager.saveTokenAccess(access);
    }
    result.accessChecked = !!access;
  }
  if (id !== connectionCheck || token !== currentData.token) return;
  connection = { state: result.ok ? 'ok' : 'bad', result };
  renderConnection();
  renderTokenGuide();
}

function renderConnection() {
  const card = document.getElementById('tokenConnected');
  if (!currentData.token) return;
  const result = connection && connection.result;
  const checking = !connection || connection.state === 'checking';
  // Facts carry a tone class (ok, warn, muted); the title and subtitle keep their own classes.
  const set = (id, text, tone = '') => {
    const node = document.getElementById(id);
    node.textContent = text;
    if (node.tagName === 'DD') node.className = tone;
  };
  const kinds = { 'fine-grained': 'Fine-grained', classic: 'Classic', other: 'Token' };
  const where = currentData.syncToken ? 'synced' : 'this device only';

  // Re-run and cancel: off, allowed, missing, or not yet known.
  const runControls = !!currentData.runControls;
  const access = currentData.tokenAccess;
  let accessText = 'Off (Choose features)';
  let accessTone = 'muted';
  if (runControls && access === 'write') [accessText, accessTone] = ['✓ Allowed', 'ok'];
  else if (runControls && access === 'read') [accessText, accessTone] = ['Needs Read and write', 'warn'];
  else if (runControls && checking) [accessText, accessTone] = ['Checking...', 'muted'];
  else if (runControls) [accessText, accessTone] = ['Not checked yet: no finished run to check against', 'muted'];
  set('tcAccess', accessText, accessTone);

  const warning = document.getElementById('tcWarning');
  warning.hidden = true;
  let tone = 'good';
  if (connection && connection.state === 'bad') {
    tone = 'bad';
    set('tcTitle', 'GitHub did not accept the saved token');
    set('tcSub', result.error);
    set('tcKind', `${kinds[result.kind] || 'Token'}, ${where}`);
    set('tcRepos', '-', 'muted');
    set('tcRate', '-', 'muted');
  } else if (!result) {
    tone = 'checking';
    set('tcTitle', 'Checking the saved token with GitHub...');
    set('tcSub', '');
    set('tcKind', where, 'muted');
    set('tcRepos', '...', 'muted');
    set('tcRate', '...', 'muted');
  } else {
    set('tcTitle', `Connected as @${result.login}`);
    set('tcSub', checking
      ? 'Checking again...'
      : runControls && access === 'read'
        ? 'Monitoring works. Re-run and cancel need one more permission: see below.'
        : 'This step is done. Monitoring uses this token.');
    set('tcKind', `${kinds[result.kind] || 'Token'}, ${where}`);
    set('tcRepos', result.repoCount === null ? 'Could not list them' : `Can see ${result.repoCount}`);
    set('tcRate', result.rateLimit ? `${result.rateLimit.remaining.toLocaleString()} of ${result.rateLimit.limit.toLocaleString()} left this hour` : '-', result.rateLimit ? '' : 'muted');
    if (runControls && access === 'read') tone = 'warn';
    if (result.broad && !runControls) {
      warning.textContent = `More access than needed: the ${result.scopes.join(', ')} scope${result.scopes.length === 1 ? '' : 's'} allow writing to your repositories. A fine-grained token limited to Actions is safer (Replace token).`;
      warning.hidden = false;
      tone = 'warn';
    }
  }
  card.classList.remove('good', 'warn', 'bad', 'checking');
  card.classList.add(tone);
  document.getElementById('tcBadge').textContent = { good: '✓', warn: '!', bad: '✗', checking: '…' }[tone];
  document.getElementById('checkTokenBtn').disabled = checking;
  // A rejected token: the instructions for a new one are what is needed.
  if (tone === 'bad' && !replacingToken) setReplacing(true);
}

/**
 * Render interval select
 */
function renderIntervalSelect() {
  const select = document.getElementById('intervalSelect');
  select.value = currentData.pollIntervalSeconds.toString();
  // Older versions offered 15 seconds, which Chrome never honoured (30 seconds is its minimum): show what applies.
  if (!select.value) select.value = '30';
}

/**
 * Render sync checkbox
 */
function renderSyncCheckbox() {
  const checkbox = document.getElementById('syncTokenCheckbox');
  checkbox.checked = currentData.syncToken;
}

/**
 * Render rate limit info
 */
function renderRateLimitInfo() {
  const active = currentData.repos.filter((r) => typeof r === 'string' || r.enabled !== false).length;
  const paused = currentData.repos.length - active;
  const interval = Math.max(30, currentData.pollIntervalSeconds);
  const requestsPerHour = Math.ceil((3600 / interval) * active);

  document.getElementById('repoCount').textContent = paused ? `${active} (${paused} paused)` : String(active);
  document.getElementById('requestRate').textContent = `~${requestsPerHour.toLocaleString()}`;

  const stats = currentData.pollStats;
  const lastPoll = document.getElementById('lastPoll');
  const remaining = document.getElementById('rateRemaining');
  if (stats && stats.at) {
    const free = stats.notModified || 0;
    lastPoll.textContent = `${new Date(stats.at).toLocaleTimeString()}: ${stats.requests} request${stats.requests === 1 ? '' : 's'}, ${free} free (unchanged)`;
  } else {
    lastPoll.textContent = 'Not yet';
  }
  if (stats && stats.rateLimit) {
    const r = stats.rateLimit;
    const reset = r.resetAt ? `, resets ${new Date(r.resetAt).toLocaleTimeString()}` : '';
    remaining.textContent = `${r.remaining.toLocaleString()} of ${r.limit.toLocaleString()}${reset}`;
  } else {
    remaining.textContent = '-';
  }
}

/**
 * Check the saved (or typed) token with GitHub and explain what it can do. Built with text nodes only.
 */
async function testToken(tokenOverride) {
  const token = tokenOverride || document.getElementById('tokenInput').value.trim() || currentData.token;
  const report = document.getElementById('tokenReport');
  if (!token) {
    showStatus('tokenStatus', 'Enter or save a token first', 'error');
    return;
  }
  report.classList.remove('hidden', 'good', 'bad', 'warn');
  report.replaceChildren(document.createTextNode('Checking with GitHub...'));
  const result = await GitHubAPI.testToken(token);
  const line = (text, strong) => {
    const p = document.createElement('p');
    if (strong) {
      const b = document.createElement('strong');
      b.textContent = strong;
      p.append(b, ' ');
    }
    p.append(text);
    return p;
  };
  if (!result.ok) {
    report.classList.add('bad');
    report.replaceChildren(line(result.error, 'Token check failed.'));
    return;
  }
  const kinds = { 'fine-grained': 'Fine-grained token', classic: 'Classic token', other: 'Token' };
  const lines = [
    line(`Signed in as @${result.login}. ${kinds[result.kind]}.`, 'Token works.'),
    line(result.repoCount === null ? 'Could not list repositories.' : `It can see ${result.repoCount} repositor${result.repoCount === '1' ? 'y' : 'ies'}.`)
  ];
  if (result.rateLimit) {
    lines.push(line(`${result.rateLimit.remaining.toLocaleString()} of ${result.rateLimit.limit.toLocaleString()} API requests left this hour.`));
  }
  if (result.broad) {
    lines.push(line(`It has the ${result.scopes.join(', ')} scope${result.scopes.length === 1 ? '' : 's'}, which allow writing to your repositories. This extension only reads, so a fine-grained read-only token (button above) is safer.`, 'More access than needed:'));
    report.classList.add('warn');
  } else {
    report.classList.add('good');
  }
  report.replaceChildren(...lines);
}

/**
 * Save token
 */
async function saveToken() {
  const input = document.getElementById('tokenInput');
  const token = input.value.trim();

  if (!token) {
    showStatus('tokenStatus', 'Please enter a token', 'error');
    return;
  }

  // Basic validation - fine-grained tokens start with github_pat_, classic ones with ghp_ (and gho_/ghu_/ghs_/ghr_)
  if (!token.match(/^(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{36,})$/)) {
    showStatus('tokenStatus', 'Warning: Token format looks unusual', 'warning');
    // Don't block saving - allow users to save non-standard tokens
  }

  // Save token using StorageManager (respects sync preference). Setup offered the token link for the features
  // chosen, so a token saved with re-run and cancel on is taken to have Actions: Read and write; GitHub's answer
  // to the first re-run or cancel corrects it if not.
  const tokenAccess = currentData.runControls ? 'write' : 'read';
  await StorageManager.saveToken(token, currentData.syncToken, tokenAccess);
  currentData.token = token;
  currentData.tokenAccess = tokenAccess;
  input.value = '';

  replacingToken = false;
  connection = null;
  document.getElementById('tokenReport').classList.add('hidden');
  renderTokenStatus();
  renderSteps();
  checkConnection();

  // Trigger background refresh
  chrome.runtime.sendMessage({ action: 'refreshNow' }).catch(() => {
    // Background worker might not be ready, that's okay
  });
}

/**
 * Clear token
 */
async function clearToken() {
  if (!confirm('Remove the saved token? Monitoring stops until you add a new token.')) {
    return;
  }

  await StorageManager.clearToken();
  currentData.token = null;
  currentData.tokenAccess = null;
  connection = null;
  connectionCheck++;
  document.getElementById('tokenReport').classList.add('hidden');

  renderTokenStatus();
  showStatus('tokenStatus', '✓ Token removed', 'success');
  renderSteps();
}

/**
 * Save polling interval
 */
async function saveInterval() {
  const select = document.getElementById('intervalSelect');
  const intervalSeconds = parseInt(select.value, 10);

  await StorageManager.savePollInterval(intervalSeconds);
  currentData.pollIntervalSeconds = intervalSeconds;

  showStatus('intervalStatus', '✓ Polling interval saved', 'success');
  renderRateLimitInfo();

  // Notify background worker to update the alarm
  chrome.runtime.sendMessage({ action: 'updatePollingInterval', intervalSeconds }).catch(() => {
    // Background worker might not be ready, that's okay
  });
}

/**
 * Handle sync checkbox change
 */
async function handleSyncChange(event) {
  const shouldSync = event.target.checked;
  currentData.syncToken = shouldSync;

  // Update sync preference and migrate token
  await StorageManager.updateSyncPreference(shouldSync);

  // Update status to reflect sync state
  renderTokenStatus();

  const syncStatus = shouldSync ? 'enabled' : 'disabled';
  showStatus('tokenStatus', `✓ Token sync ${syncStatus}`, 'success');
}

/**
 * Show temporary status message
 */
function showStatus(elementId, text, className) {
  const el = document.getElementById(elementId);
  el.textContent = text;
  el.className = `status-text ${className}`;

  if (className === 'success') {
    setTimeout(() => {
      renderTokenStatus();
    }, 3000);
  }
}

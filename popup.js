// Popup UI controller for GitHub Actions Monitor

let currentData = {
  repos: [],
  lastResults: {},
  rateLimitUntil: null,
  token: null,
  owners: [],
  lastOwner: null,
  sortMode: 'custom',
  runControls: false,
  expanded: []
};

let currentBranches = [];
/** The owner whose repositories fill the Repository dropdown: { owner, repos }. */
let ownerRepos = null;
/** Increments per owner lookup, so a slow answer for an owner typed earlier cannot overwrite a newer one. */
let ownerRequest = 0;
let ownerDebounceTimer = null;
let refreshResetTimer = null;
let toastTimer = null;
/** The repository being dragged (id), and whether a poll's re-render waits until the drop. */
let dragId = null;
let renderPending = false;
/** Keyboard position in the owner suggestions (-1: none). */
let ownerActive = -1;
/** Which repositories the list shows: 'all', or only 'red', 'yellow', 'review' or 'green' ones. */
let filter = 'all';
/** The repository in the active tab, when it is a github.com repository page: { owner, repo, branch }. */
let tabRepo = null;
let tabSuggestionDismissed = false;

// Initialize popup on load
/**
 * Where this page is shown: the toolbar popup, the side panel (?view=panel, docked: stays open while browsing) or
 * a pop-out window (?view=window). The panel and the window fill whatever width they are given.
 */
// ?view=pip: inside the always-on-top window ("Keep on top").
const VIEW = ['panel', 'window', 'pip'].includes(new URLSearchParams(location.search).get('view')) ? new URLSearchParams(location.search).get('view') : 'popup';
document.documentElement.dataset.view = VIEW;
// The browser window this page belongs to, known before any click: the side panel must open within the click.
let browserWindowId = null;
chrome.windows.getCurrent().then((win) => {
  browserWindowId = win.id;
}).catch(() => {});

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  setupEventListeners();
  setAddPanelOpen(currentData.repos.length === 0);
  renderUI();
  checkRateLimit();
  initOwnerField();
  // The pop-out and on-top windows have no page of their own to offer; the side panel follows the active tab.
  if (VIEW === 'popup' || VIEW === 'panel') detectTabRepo();
  if (VIEW === 'panel') {
    chrome.tabs.onActivated.addListener(() => detectTabRepo());
    chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
      if (tab.active && change.url !== undefined) detectTabRepo();
    });
  }
});

// Changes made in another browser (Chrome Sync) follow while the popup is open: expanded cards, the sort, and
// the repository list (its custom order, pauses, additions and removals). This popup's own saves change
// currentData first, so they compare equal here and cause no second render. A drag in progress defers the
// render (renderRepoList), so the list never shifts under the pointer.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;
  let list = false;
  let all = false;
  if (changes.expanded) {
    const next = Array.isArray(changes.expanded.newValue) ? changes.expanded.newValue : [];
    if (next.join('|') !== currentData.expanded.join('|')) {
      currentData.expanded = next;
      list = true;
    }
  }
  if (changes.sortMode) {
    const next = RepoOrder.MODES.includes(changes.sortMode.newValue) ? changes.sortMode.newValue : 'custom';
    if (next !== currentData.sortMode) {
      currentData.sortMode = next;
      list = true;
    }
  }
  if (changes.repos && Array.isArray(changes.repos.newValue)) {
    if (JSON.stringify(changes.repos.newValue) !== JSON.stringify(currentData.repos)) {
      currentData.repos = changes.repos.newValue;
      all = true;
    }
  }
  if (all) renderUI();
  else if (list) renderRepoList();
});

// Listen for updates from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'pollComplete') {
    loadData().then(() => {
      renderUI();
      checkRateLimit();
    });
  }
});

/**
 * Load data from storage
 */
async function loadData() {
  const data = await StorageManager.getData();
  currentData.repos = data.repos || [];
  currentData.lastResults = data.lastResults || {};
  currentData.rateLimitUntil = data.rateLimitUntil || null;
  currentData.token = data.token || null;
  currentData.owners = data.owners || [];
  currentData.lastOwner = data.lastOwner || null;
  currentData.sortMode = RepoOrder.MODES.includes(data.sortMode) ? data.sortMode : 'custom';
  currentData.runControls = data.runControls === true;
  currentData.expanded = data.expanded || [];
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  const dock = document.getElementById('dockBtn');
  dock.hidden = VIEW !== 'popup' || !chrome.sidePanel;
  dock.addEventListener('click', dockToSidePanel);
  const popout = document.getElementById('popoutBtn');
  popout.hidden = VIEW === 'window' || VIEW === 'pip';
  popout.addEventListener('click', popOut);
  // Keep on top needs a page that stays open behind it: the pop-out window or the side panel, not the popup.
  const pin = document.getElementById('pinBtn');
  pin.hidden = !(VIEW === 'window' || VIEW === 'panel') || !('documentPictureInPicture' in window);
  pin.addEventListener('click', keepOnTop);
  document.getElementById('addRepoBtn').addEventListener('click', addRepo);
  document.getElementById('refreshBtn').addEventListener('click', refreshNow);
  document.getElementById('addToggle').addEventListener('click', () => {
    const open = document.getElementById('addPanel').hidden;
    setAddPanelOpen(open);
    if (open) document.getElementById('ownerInput').focus();
  });
  document.getElementById('tabAddBtn').addEventListener('click', addFromTab);
  document.getElementById('tabDismissBtn').addEventListener('click', () => {
    tabSuggestionDismissed = true;
    renderTabSuggestion();
  });

  const ownerInput = document.getElementById('ownerInput');
  ownerInput.addEventListener('focus', showOwnerSuggestions);
  ownerInput.addEventListener('input', handleOwnerInput);
  ownerInput.addEventListener('keydown', handleOwnerKeydown);

  document.getElementById('repoSelect').addEventListener('change', handleRepoSelection);
  document.getElementById('sortSelect').addEventListener('change', handleSortChange);
  setupReordering();
  document.getElementById('branchSelect').addEventListener('change', handleBranchSelection);

  // Close the owner suggestions when clicking outside
  document.addEventListener('click', (e) => {
    const autocompleteWrapper = document.querySelector('.autocomplete-wrapper');
    if (!autocompleteWrapper.contains(e.target)) {
      hideOwnerSuggestions();
    }
  });
}

/**
 * Render the UI
 */
function renderUI() {
  renderSummary();
  renderRepoList();
  renderRepoOptions();
  renderTabSuggestion();
}

/**
 * Open settings page
 */
function openSettings() {
  chrome.runtime.openOptionsPage();
}

/** Dock into Chrome's side panel: it stays open while you browse and switch tabs. */
function dockToSidePanel() {
  if (browserWindowId === null) return;
  // Called straight from the click: Chrome opens the side panel only in response to a user action.
  chrome.sidePanel.open({ windowId: browserWindowId })
    .then(() => window.close())
    .catch((error) => showToast(`Could not open the side panel: ${error.message}`, 'error'));
}

/**
 * Keep on top: Chrome's Document Picture-in-Picture window (as for videos) stays above every other window, and
 * can be dragged to a corner and resized. It shows this same page in a frame, so everything works in it. It lasts
 * as long as the page that opened it: the pop-out window is minimized out of the way meanwhile, and comes back
 * when the on-top window is closed.
 */
async function keepOnTop() {
  try {
    const pip = await window.documentPictureInPicture.requestWindow({
      width: Math.max(340, Math.min(window.innerWidth, 520)),
      height: Math.max(360, window.innerHeight)
    });
    const doc = pip.document;
    doc.title = 'GitHub Actions Monitor';
    doc.documentElement.style.height = '100%';
    doc.body.style.cssText = 'margin:0;height:100%';
    const frame = doc.createElement('iframe');
    frame.src = chrome.runtime.getURL('popup.html?view=pip');
    frame.title = 'GitHub Actions Monitor';
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0';
    doc.body.appendChild(frame);
    if (VIEW === 'window' && browserWindowId !== null) {
      const windowId = browserWindowId;
      await chrome.windows.update(windowId, { state: 'minimized' });
      pip.addEventListener('pagehide', () => {
        chrome.windows.update(windowId, { state: 'normal', focused: true }).catch(() => {});
      });
    }
  } catch (error) {
    showToast(`Could not keep it on top: ${error.message}`, 'error');
  }
}

/**
 * Open in a window of its own, where it was last left (the background remembers its size and place). Only one:
 * if it is already open, it is brought forward.
 */
async function popOut() {
  const { popoutWindowId, popoutBounds } = await chrome.storage.local.get(['popoutWindowId', 'popoutBounds']);
  if (popoutWindowId) {
    try {
      await chrome.windows.update(popoutWindowId, { focused: true });
      if (VIEW === 'popup') window.close();
      return;
    } catch {
      // Closed since: open a new one.
    }
  }
  const bounds = popoutBounds || { width: 520, height: 760 };
  const placed = Number.isFinite(bounds.left) && Number.isFinite(bounds.top) ? { left: bounds.left, top: bounds.top } : {};
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html?view=window'),
    type: 'popup',
    width: Math.max(360, bounds.width),
    height: Math.max(320, bounds.height),
    focused: true,
    ...placed
  });
  await chrome.storage.local.set({ popoutWindowId: win.id });
  if (VIEW === 'popup') window.close();
}

/** The add form opens on demand (and on its own while nothing is monitored), so the list gets the space. */
function setAddPanelOpen(open) {
  document.getElementById('addPanel').hidden = !open;
  const toggle = document.getElementById('addToggle');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.classList.toggle('is-open', open);
}

// ---------------------------------------------------------------------------------------------------------------
// Small DOM helpers. Everything from GitHub (names, commit titles, branches) goes in as text, never as HTML.

/** Element with a class and plain-text content. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/** Line icons (16x16, stroked in the current text color). */
const ICONS = {
  grip: '<circle cx="6" cy="4" r="1"/><circle cx="10" cy="4" r="1"/><circle cx="6" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="6" cy="12" r="1"/><circle cx="10" cy="12" r="1"/>',
  chevron: '<path d="M6 4l4 4-4 4"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  play: '<path d="M5 3.5l7 4.5-7 4.5z"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  rerun: '<path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89"/><path d="M13.5 2.5v3h-3"/>',
  stop: '<rect x="4.5" y="4.5" width="7" height="7" rx="1"/>',
  flag: '<path d="M4 14V2.5M4 3h7.5L10 5.5 11.5 8H4"/>'
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', `icon icon-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name]; // static markup above, never data
  return svg;
}

/** A small icon button; the label is its accessible name and tooltip. */
function iconButton(name, label, className, onClick) {
  const button = el('button', `btn btn-ghost btn-icon-sm ${className || ''}`.trim());
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.appendChild(icon(name));
  button.addEventListener('click', onClick);
  return button;
}

function openUrl(url) {
  if (url) chrome.tabs.create({ url });
}

/** A link that opens in a new tab (popup links cannot navigate the popup itself). */
function tabLink(className, text, url, title) {
  const a = el('a', className, text);
  a.href = url || '#';
  if (title) a.title = title;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    openUrl(url);
  });
  return a;
}

/** "45s", "3m 12s", "1h 04m" */
function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** "just now", "4m ago", "3h ago", "2d ago" */
function formatAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// github-api.js (loaded on this page too) declares ACTIVE_STATUSES; a second top-level const would be a SyntaxError.
const RUNNING_STATUSES = ['queued', 'in_progress', 'waiting', 'requested', 'pending'];

/** Live elapsed time for running workflows, duration for finished ones. Ticked every second while the popup is open. */
function timingSpan(workflow) {
  const span = el('span', 'run-timing');
  const started = workflow.startedAt ? Date.parse(workflow.startedAt) : NaN;
  if (Number.isNaN(started)) return span;
  if (RUNNING_STATUSES.includes(workflow.status)) {
    span.dataset.startedAt = String(started);
    span.textContent = `running ${formatDuration(Date.now() - started)}`;
  } else if (workflow.updatedAt) {
    span.textContent = `took ${formatDuration(Date.parse(workflow.updatedAt) - started)}`;
  }
  return span;
}

// Running timers count up live while the popup is open.
setInterval(() => {
  for (const span of document.querySelectorAll('.run-timing[data-started-at]')) {
    span.textContent = `running ${formatDuration(Date.now() - Number(span.dataset.startedAt))}`;
  }
}, 1000);

// ---------------------------------------------------------------------------------------------------------------
// Summary chips: counts of active repositories by state; clicking one shows only those.

const FILTERS = [
  { key: 'red', label: (n) => `${n} failing`, test: (r) => r && r.color === 'red' },
  { key: 'yellow', label: (n) => `${n} running`, test: (r) => r && r.color === 'yellow' },
  { key: 'review', label: (n) => `${n} awaiting review`, test: (r) => needsReview(r) },
  { key: 'green', label: (n) => `${n} passing`, test: (r) => r && r.color === 'green' }
];

/** Some counted workflow waits for a deployment review or an approval. */
function needsReview(result) {
  return !!(result && (result.workflows || []).some((w) => w.needsReview && !w.ignored));
}

function activeEntries() {
  return currentData.repos.filter((r) => RepoOrder.isEnabled(r));
}

function renderSummary() {
  const chips = document.getElementById('filterChips');
  const active = activeEntries();
  const results = active.map((r) => currentData.lastResults[RepoOrder.idOf(r)]);
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, results.filter(f.test).length]));
  // A filter whose repositories are all gone (fixed, paused or removed) goes back to showing everything.
  if (filter !== 'all' && !counts[filter]) filter = 'all';

  const chip = (key, text, label) => {
    const button = el('button', `chip chip-${key}`);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(filter === key));
    button.title = key === 'all' ? 'Show every repository' : `Show only: ${label}`;
    button.setAttribute('aria-label', label);
    if (key !== 'all') button.appendChild(key === 'review' ? icon('flag') : el('span', `mini-dot status-${key}`));
    button.appendChild(el('span', 'chip-count', text));
    button.addEventListener('click', () => {
      filter = filter === key || key === 'all' ? 'all' : key;
      renderSummary();
      renderRepoList();
    });
    return button;
  };
  const nodes = [];
  if (active.length > 1) nodes.push(chip('all', `All ${active.length}`, `All ${active.length}`));
  for (const f of FILTERS) {
    if (counts[f.key]) nodes.push(chip(f.key, String(counts[f.key]), f.label(counts[f.key])));
  }
  chips.replaceChildren(...nodes);

  const total = currentData.repos.length;
  const paused = total - active.length;
  document.getElementById('listCount').textContent = total ? `${active.length} monitored${paused ? `, ${paused} paused` : ''}` : '';
  const stamps = results.filter(Boolean).map((r) => r.timestamp).filter(Boolean);
  const checked = document.getElementById('checkedAt');
  checked.textContent = stamps.length ? `Checked ${formatAgo(Math.max(...stamps))}` : '';
  checked.title = stamps.length ? new Date(Math.max(...stamps)).toLocaleString() : '';
}

// ---------------------------------------------------------------------------------------------------------------
// The repository list

/**
 * Render repository list
 */
function renderRepoList() {
  // A poll finishing mid-drag would replace the element being dragged: render after the drop instead.
  if (dragId) {
    renderPending = true;
    return;
  }
  const listEl = document.getElementById('repoList');
  document.getElementById('sortSelect').value = currentData.sortMode;

  if (currentData.repos.length === 0) {
    listEl.replaceChildren(el('div', 'empty-state', 'No repositories added yet'));
    return;
  }

  // Re-rendering replaces every control: keep focus on the one that had it (a moved handle, a toggled switch).
  const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focusKey : null;

  // Active repositories first, paused ones at the bottom, each in the chosen order. A filter shows matching active ones.
  const shown = filter === 'all' ? displayedRepos() : displayedRepos().filter((r) => RepoOrder.isEnabled(r) && FILTERS.find((f) => f.key === filter).test(currentData.lastResults[RepoOrder.idOf(r)]));
  const nodes = [];
  let pausedHeader = false;
  for (const entry of shown) {
    if (!RepoOrder.isEnabled(entry) && !pausedHeader && shown.some((r) => RepoOrder.isEnabled(r))) {
      nodes.push(el('div', 'repo-section-header', 'Paused'));
      pausedHeader = true;
    }
    nodes.push(createRepoItem(entry));
  }
  listEl.replaceChildren(...nodes);

  if (focusKey) {
    const target = [...listEl.querySelectorAll('[data-focus-key]')].find((node) => node.dataset.focusKey === focusKey);
    if (target) target.focus();
  }
}

/** The list in the order it is shown. */
function displayedRepos() {
  return RepoOrder.sort(currentData.repos, currentData.lastResults, currentData.sortMode);
}

async function handleSortChange(e) {
  currentData.sortMode = e.target.value;
  await StorageManager.saveSortMode(currentData.sortMode);
  renderRepoList();
}

/**
 * Saves a new order. Reordering while sorted by name, activity or status starts the custom order from what is
 * shown, so "sort by name, then move a few" works.
 */
async function saveOrder(newOrder, movedId) {
  currentData.repos = newOrder;
  const switched = currentData.sortMode !== 'custom';
  currentData.sortMode = 'custom';
  await StorageManager.saveRepos(currentData.repos);
  if (switched) await StorageManager.saveSortMode('custom');
  renderRepoList();
  const position = displayedRepos().findIndex((e) => RepoOrder.idOf(e) === movedId) + 1;
  const { repo } = RepoOrder.label(currentData.repos.find((e) => RepoOrder.idOf(e) === movedId));
  document.getElementById('orderAnnouncer').textContent = `${repo} moved to position ${position}${switched ? '. Sort set to Custom order.' : ''}`;
}

/**
 * Drag a repository by its handle and drop it above or below another one, or focus the handle and use the up and
 * down arrow keys. Active and paused repositories are reordered separately. Handles are hidden while a filter
 * shows only part of the list.
 */
function setupReordering() {
  const listEl = document.getElementById('repoList');
  const clearMarks = () => {
    for (const item of listEl.querySelectorAll('.drop-before, .drop-after')) item.classList.remove('drop-before', 'drop-after');
  };
  const dropTarget = (e) => {
    const item = e.target.closest && e.target.closest('.repo-item');
    if (!dragId || !item || item.dataset.id === dragId) return null;
    const dragged = listEl.querySelector(`.repo-item[data-id="${CSS.escape(dragId)}"]`);
    if (!dragged || dragged.dataset.enabled !== item.dataset.enabled) return null;
    const box = item.getBoundingClientRect();
    return { item, place: e.clientY < box.top + box.height / 2 ? 'before' : 'after' };
  };

  listEl.addEventListener('dragstart', (e) => {
    const handle = e.target.closest && e.target.closest('.drag-handle');
    if (!handle) return;
    const item = handle.closest('.repo-item');
    dragId = item.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    e.dataTransfer.setDragImage(item, 16, 16);
    item.classList.add('dragging');
  });
  listEl.addEventListener('dragover', (e) => {
    const target = dropTarget(e);
    clearMarks();
    if (!target) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    target.item.classList.add(target.place === 'before' ? 'drop-before' : 'drop-after');
  });
  listEl.addEventListener('drop', (e) => {
    const target = dropTarget(e);
    clearMarks();
    if (!target) return;
    e.preventDefault();
    const moved = dragId;
    const next = RepoOrder.move(displayedRepos(), moved, target.item.dataset.id, target.place);
    dragId = null;
    if (next) saveOrder(next, moved);
  });
  listEl.addEventListener('dragend', () => {
    clearMarks();
    for (const item of listEl.querySelectorAll('.dragging')) item.classList.remove('dragging');
    dragId = null;
    if (renderPending) {
      renderPending = false;
      renderRepoList();
    }
  });
  listEl.addEventListener('keydown', (e) => {
    const handle = e.target.closest && e.target.closest('.drag-handle');
    if (!handle || filter !== 'all' || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const id = handle.closest('.repo-item').dataset.id;
    const next = RepoOrder.moveBy(displayedRepos(), id, e.key === 'ArrowUp' ? -1 : 1);
    if (next) saveOrder(next, id);
  });
}

/** The first counted workflow in a given state. */
function firstWorkflow(result, test) {
  return ((result && result.workflows) || []).find((w) => !w.ignored && test(w)) || null;
}

/** "Test > npm test" */
function failureText(failure) {
  return failure.step ? `${failure.job} › ${failure.step}` : failure.job;
}

/** What triggered a run, for hover text and the expanded card: title, pull request, who, how, commit. */
function contextParts(w) {
  const parts = [];
  if (w.commitTitle) parts.push(`“${w.commitTitle}”`);
  if (w.pr) parts.push(`#${w.pr}`);
  if (w.actor) parts.push(`@${w.actor}`);
  if (w.event) parts.push(w.event.replace(/_/g, ' '));
  if (w.sha) parts.push(w.sha);
  return parts;
}

/**
 * One repository: a compact two-line card (name and state; the details are in the hover text), with the
 * workflows, their history and the run context one click away.
 */
function createRepoItem(entry) {
  const id = RepoOrder.idOf(entry);
  const { repo: repoKey, branch } = RepoOrder.label(entry);
  const enabled = RepoOrder.isEnabled(entry);
  const result = currentData.lastResults[id];
  const color = enabled && result ? result.color : 'gray';
  const workflows = (result && result.workflows) || [];
  const expanded = enabled && currentData.expanded.includes(id);

  const item = el('div', `repo-item state-${color}`);
  item.dataset.id = id;
  item.dataset.enabled = String(enabled);
  if (!enabled) item.classList.add('repo-item-disabled');
  if (expanded) item.classList.add('is-expanded');

  // Drag handle; also a keyboard target (arrow keys move the repository).
  const handle = el('button', 'drag-handle');
  handle.type = 'button';
  handle.draggable = filter === 'all';
  handle.hidden = filter !== 'all';
  handle.dataset.focusKey = `${id}|handle`;
  handle.title = 'Drag to reorder (or focus and use the arrow keys)';
  handle.setAttribute('aria-label', `Reorder ${repoKey}${branch !== 'all' ? ` (${branch})` : ''}: use the up and down arrow keys`);
  handle.appendChild(icon('grip'));

  const statusDot = el('span', `status-dot status-${color}`);
  statusDot.setAttribute('aria-hidden', 'true');

  // Line 1: name, branch, review marker.
  const main = el('div', 'repo-main');
  const line = el('div', 'repo-line');
  const repoLink = el('a', 'repo-name', repoKey);
  repoLink.href = '#';
  repoLink.title = result && result.runUrl ? `Open ${result.workflowName || 'the latest run'} on GitHub` : `Open ${repoKey} on GitHub`;
  repoLink.addEventListener('click', (e) => {
    e.preventDefault();
    openRepo(repoKey, result);
  });
  line.appendChild(repoLink);
  if (branch !== 'all') line.appendChild(el('span', 'branch-chip', branch));
  if (!enabled) line.appendChild(el('span', 'paused-chip', 'Paused'));
  const review = enabled ? firstWorkflow(result, (w) => w.needsReview) : null;
  if (review) {
    const pill = tabLink('review-pill', 'Review', review.runUrl, `${review.name} is waiting for a review or approval: open the run to review it`);
    pill.prepend(icon('flag'));
    line.appendChild(pill);
  }
  main.appendChild(line);

  // Line 2: the state in one line; everything else is in its hover text.
  const sub = el('div', 'repo-sub');
  const hover = [];
  if (!enabled) {
    sub.appendChild(el('span', 'status-message', 'Monitoring paused'));
  } else if (!result) {
    sub.appendChild(el('span', 'status-message', 'Not checked yet'));
  } else {
    sub.appendChild(el('span', 'status-message', result.message));
    const failed = firstWorkflow(result, (w) => w.color === 'red' && w.failure);
    if (failed) sub.append(' · ', el('span', 'failure-text', failureText(failed.failure)));
    const lead = firstWorkflow(result, (w) => w.color === 'yellow') || firstWorkflow(result, (w) => w.color === 'red') || (workflows.length === 1 ? workflows[0] : null);
    // Step lights for the workflow that is actually running (one waiting for approval has no steps yet).
    const live = firstWorkflow(result, (w) => w.color === 'yellow' && w.progress && w.progress.length);
    if (live) {
      const lights = stepLights(live.progress);
      sub.append(' · ', lights.node);
      if (lights.current) sub.append(' ', el('span', 'current-step', lights.current));
    }
    if (lead) {
      const timing = timingSpan(lead);
      if (timing.textContent) sub.append(' · ', timing);
    }
    const counted = workflows.filter((w) => !w.ignored);
    for (const w of counted) {
      hover.push(`${w.name}: ${w.message}${w.failure ? ` (${failureText(w.failure)})` : ''}`);
      if (w.failure && w.failure.errors && w.failure.errors.length) hover.push(`  ${w.failure.errors[0]}`);
      if (w.color === 'yellow' && w.progress && w.progress.length) hover.push(`  ${stepLights(w.progress).summary}`);
    }
    const ignoredCount = workflows.length - counted.length;
    if (ignoredCount) hover.push(`${ignoredCount} ignored workflow${ignoredCount === 1 ? '' : 's'}`);
    const headline = firstWorkflow(result, (w) => w.runUrl === result.runUrl) || counted[0];
    if (headline) {
      const context = contextParts(headline);
      if (context.length) hover.push(context.join(' · '));
      const activity = RepoOrder.lastActivity(result);
      if (activity) hover.push(`Last activity ${formatAgo(activity)}`);
    }
    if (result.timestamp) hover.push(`Checked ${formatAgo(result.timestamp)}`);
  }
  sub.title = hover.join('\n');
  main.appendChild(sub);

  // Actions: expand, pause/resume, remove.
  const actions = el('div', 'repo-actions');
  const toggleBtn = iconButton(enabled ? 'pause' : 'play', enabled ? 'Pause monitoring' : 'Resume monitoring', 'btn-toggle', () => toggleRepoEnabled(id));
  toggleBtn.dataset.focusKey = `${id}|toggle`;
  const removeBtn = iconButton('trash', 'Remove repository', 'btn-remove', () => removeRepo(id));
  removeBtn.dataset.focusKey = `${id}|remove`;
  actions.append(toggleBtn, removeBtn);

  item.append(handle, statusDot, main, actions);

  if (enabled && workflows.length) {
    const expand = el('button', 'btn btn-ghost btn-icon-sm expand-btn');
    expand.type = 'button';
    expand.dataset.focusKey = `${id}|expand`;
    expand.setAttribute('aria-expanded', String(expanded));
    expand.setAttribute('aria-label', `${expanded ? 'Hide' : 'Show'} the workflows of ${repoKey}${branch !== 'all' ? ` (${branch})` : ''}`);
    expand.title = expanded ? 'Hide workflows' : `Show ${workflows.length} workflow${workflows.length === 1 ? '' : 's'}`;
    expand.appendChild(icon('chevron'));
    if (workflows.length > 1) expand.appendChild(el('span', 'expand-count', String(workflows.length)));
    expand.addEventListener('click', () => toggleExpanded(id));
    item.insertBefore(expand, actions);
    if (expanded) item.appendChild(repoDetail(entry, result));
  } else {
    item.insertBefore(el('span', 'expand-spacer'), actions);
  }
  return item;
}

async function toggleExpanded(id) {
  const set = new Set(currentData.expanded);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  // Only ids still in the list are kept.
  currentData.expanded = [...set].filter((x) => currentData.repos.some((r) => RepoOrder.idOf(r) === x));
  await StorageManager.saveExpanded(currentData.expanded);
  renderRepoList();
}

/** The expanded part of a card: what triggered the latest run, then every workflow with its history. */
function repoDetail(entry, result) {
  const id = RepoOrder.idOf(entry);
  const [owner, repoName] = RepoOrder.label(entry).repo.split('/');
  const detail = el('div', 'repo-detail');
  const headline = (result.workflows || []).find((w) => w.runUrl === result.runUrl) || result.workflows[0];

  // Context line: commit title, pull request, who, how, commit.
  if (headline) {
    const context = el('div', 'run-context');
    if (headline.commitTitle) context.appendChild(el('span', 'context-title', headline.commitTitle));
    const meta = el('span', 'context-meta');
    const add = (node) => {
      if (meta.childNodes.length) meta.append(' · ');
      meta.append(node);
    };
    const base = `https://github.com/${owner}/${repoName}`;
    if (headline.pr) add(tabLink('context-link', `#${headline.pr}`, `${base}/pull/${headline.pr}`, `Open pull request #${headline.pr}`));
    if (headline.actor) add(el('span', 'context-actor', `@${headline.actor}`));
    if (headline.event) add(el('span', null, headline.event.replace(/_/g, ' ')));
    if (headline.sha) add(tabLink('context-link context-sha', headline.sha, `${base}/commit/${headline.sha}`, 'Open the commit'));
    const activity = RepoOrder.lastActivity(result);
    if (activity) add(el('span', null, formatAgo(activity)));
    if (meta.childNodes.length) context.appendChild(meta);
    if (context.childNodes.length) detail.appendChild(context);
  }

  const list = el('ul', 'workflow-list');
  for (const w of result.workflows) {
    const key = String(w.workflowId ?? w.name);
    const row = el('li', `workflow-row${w.ignored ? ' is-ignored' : ''}`);
    row.appendChild(el('span', `mini-dot status-${w.color}`));
    const name = tabLink('workflow-name', w.name || 'Workflow', w.runUrl, [w.name, ...contextParts(w)].join(' · '));
    row.appendChild(name);
    row.appendChild(historyStrip(w));

    const state = el('span', 'workflow-state', w.message);
    const timing = timingSpan(w);
    if (timing.textContent) state.append(' · ', timing);
    row.appendChild(state);

    const tools = el('span', 'workflow-tools');
    if (w.needsReview) {
      const pill = tabLink('review-pill', 'Review', w.runUrl, 'Waiting for a review or approval: open the run');
      pill.prepend(icon('flag'));
      tools.appendChild(pill);
    }
    if (currentData.runControls && w.runId) {
      if (w.color === 'red' && ['failure', 'timed_out', 'cancelled'].includes(w.conclusion)) {
        const b = iconButton('rerun', `Re-run failed jobs of ${w.name}`, 'btn-run', () => runControl(owner, repoName, w, 'rerun'));
        b.dataset.focusKey = `${id}|rerun|${key}`;
        tools.appendChild(b);
      } else if (w.status === 'in_progress' || w.status === 'queued') {
        const b = iconButton('stop', `Cancel ${w.name}`, 'btn-run', () => runControl(owner, repoName, w, 'cancel'));
        b.dataset.focusKey = `${id}|cancel|${key}`;
        tools.appendChild(b);
      }
    }
    // On: the workflow counts toward the repository's status. Off: listed, dimmed, never red or yellow.
    const sw = el('input', 'switch');
    sw.type = 'checkbox';
    sw.checked = !w.ignored;
    sw.dataset.focusKey = `${id}|count|${key}`;
    sw.title = w.ignored ? 'Ignored: does not affect the status. Click to count it again.' : 'Counts toward the status. Click to ignore it.';
    sw.setAttribute('aria-label', `Count ${w.name} toward the status`);
    sw.addEventListener('change', () => setWorkflowIgnored(id, key, !sw.checked));
    tools.appendChild(sw);
    row.appendChild(tools);

    if (w.color === 'yellow' && w.progress && w.progress.length) {
      const steps = el('div', 'workflow-steps');
      const lights = stepLights(w.progress);
      steps.appendChild(lights.node);
      if (lights.current) steps.append(' ', el('span', 'current-step', lights.current));
      row.appendChild(steps);
    }
    if (w.failure) {
      const failure = el('div', 'workflow-failure');
      if (w.failure.jobs && w.failure.jobs.length) failure.append(stepLights(w.failure.jobs).node, ' ');
      failure.append('Failed at ', tabLink('failure-link', failureText(w.failure), w.failure.url || w.runUrl, 'Open the failed job’s log'));
      row.appendChild(failure);
      if (w.failure.errors && w.failure.errors.length) {
        // The lines from the log that say why (GitHub masks secrets in logs as ***).
        const errors = el('pre', 'error-lines', w.failure.errors.join('\n'));
        errors.title = 'From the failed step’s log';
        row.appendChild(errors);
      }
    }
    list.appendChild(row);
  }
  detail.appendChild(list);
  return detail;
}

const STEP_WORDS = { done: 'done', failed: 'failed', cancelled: 'cancelled', skipped: 'skipped', running: 'running', pending: 'waiting' };

/**
 * Step lights: one small light per step, grouped by job, lit as each step finishes (green), the running one
 * pulsing amber, a failed one red, the rest dim. A run with many jobs (a matrix) gets one light per job.
 * @param {Array<{name: string, state: string, steps: Array<{name: string, state: string}>}>} jobs
 * @returns {{node: HTMLElement, current: string|null, summary: string}}
 */
function stepLights(jobs) {
  const wrap = el('span', 'lights');
  const total = jobs.reduce((n, job) => n + Math.max(1, job.steps.length), 0);
  const perJob = total > 36;
  let done = 0;
  let count = 0;
  let current = null;
  let failed = null;
  for (const job of jobs) {
    const group = el('span', 'light-group');
    const items = perJob || !job.steps.length ? [{ name: job.name, state: job.state, whole: true }] : job.steps;
    for (const step of items) {
      const label = step.whole ? step.name : `${job.name} › ${step.name}`;
      const light = el('span', `light light-${step.state}`);
      light.title = `${label}: ${STEP_WORDS[step.state] || step.state}`;
      group.appendChild(light);
      count++;
      if (step.state === 'done') done++;
      if (!current && step.state === 'running') current = label;
      if (!failed && step.state === 'failed') failed = label;
    }
    wrap.appendChild(group);
  }
  const summary = `${done} of ${count} ${perJob ? 'jobs' : 'steps'} done${current ? `, now: ${current}` : ''}${failed ? `, failed: ${failed}` : ''}`;
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', summary);
  return { node: wrap, current, summary };
}

/** The workflow's last runs as small bars, oldest left, newest right. */
function historyStrip(w) {
  const history = w.history || [w.color];
  const strip = el('span', 'history');
  const words = { green: 'passed', red: 'failed', yellow: 'running', gray: 'other' };
  const counts = {};
  for (const c of history) {
    strip.appendChild(el('span', `bar bar-${c}`));
    counts[c] = (counts[c] || 0) + 1;
  }
  const summary = Object.entries(counts).map(([c, n]) => `${n} ${words[c] || c}`).join(', ');
  strip.title = `Last ${history.length} run${history.length === 1 ? '' : 's'} (newest right): ${summary}`;
  strip.setAttribute('role', 'img');
  strip.setAttribute('aria-label', strip.title);
  return strip;
}

/**
 * Switch a workflow off (ignored) or on. The status is rolled up again right away from the last results, and the
 * background re-polls so the toolbar icon follows.
 */
async function setWorkflowIgnored(id, workflowKey, ignore) {
  const index = currentData.repos.findIndex((r) => RepoOrder.idOf(r) === id);
  if (index < 0) return;
  const entry = currentData.repos[index];
  const ignored = new Set((entry.ignored || []).map(String));
  if (ignore) ignored.add(workflowKey);
  else ignored.delete(workflowKey);
  const next = { ...entry };
  if (ignored.size) next.ignored = [...ignored];
  else delete next.ignored;
  currentData.repos[index] = next;
  await StorageManager.saveRepos(currentData.repos);

  const result = currentData.lastResults[id];
  if (result && result.workflows) {
    currentData.lastResults[id] = GitHubAPI.applySummary({ ...result }, GitHubAPI.rollUp(result.workflows, next.ignored || []));
    await StorageManager.saveResults(currentData.lastResults);
  }
  renderSummary();
  renderRepoList();
  chrome.runtime.sendMessage({ action: 'refreshNow' }).catch(() => {});
}

/** Re-run failed jobs or cancel a run (only shown when run controls are switched on in Settings). */
async function runControl(owner, repo, workflow, action) {
  if (action === 'cancel' && !confirm(`Cancel ${workflow.name} in ${owner}/${repo}?`)) return;
  const result = await GitHubAPI.runAction(owner, repo, workflow.runId, action, currentData.token);
  showToast(result.ok ? `${result.message}: ${workflow.name}` : result.message, result.ok ? 'success' : 'error');
  // GitHub's answer settles what the token allows, so Settings shows how to add the permission only when needed.
  if (result.ok || result.denied) await StorageManager.saveTokenAccess(result.ok ? 'write' : 'read');
  if (result.ok) refreshNow();
}

function showToast(text, kind = '') {
  const toast = document.getElementById('toast');
  toast.textContent = text;
  toast.className = `toast ${kind}`.trim();
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 6000);
}

/**
 * Open repository or workflow run
 */
function openRepo(repoKey, result) {
  openUrl(result && result.runUrl ? result.runUrl : `https://github.com/${repoKey}`);
}

// ---------------------------------------------------------------------------------------------------------------
// "This tab": the popup offers the repository open in the current tab (activeTab: the address is read only when
// the popup opens, and never stored or sent anywhere).

async function detectTabRepo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabRepo = tab && tab.url ? GitHubAPI.repoFromUrl(tab.url) : null;
  } catch (error) {
    tabRepo = null;
  }
  renderTabSuggestion();
}

function isMonitored(fullName) {
  const lower = fullName.toLowerCase();
  return currentData.repos.some((r) => RepoOrder.label(r).repo.toLowerCase() === lower);
}

function renderTabSuggestion() {
  const strip = document.getElementById('tabSuggestion');
  const show = !!(tabRepo && currentData.token && !tabSuggestionDismissed && !isMonitored(`${tabRepo.owner}/${tabRepo.repo}`));
  strip.classList.toggle('hidden', !show);
  if (show) document.getElementById('tabRepoName').textContent = `${tabRepo.owner}/${tabRepo.repo}`;
}

/** Fill the add form with the tab's repository (and its branch, when the tab shows one), ready to add. */
async function addFromTab() {
  if (!tabRepo) return;
  setAddPanelOpen(true);
  document.getElementById('ownerInput').value = tabRepo.owner;
  await selectOwner(tabRepo.owner);
  if (!ownerRepos) return;
  const wanted = `${tabRepo.owner}/${tabRepo.repo}`.toLowerCase();
  const match = ownerRepos.repos.find((r) => r.fullName.toLowerCase() === wanted);
  if (!match) {
    setAddStatus(`${tabRepo.owner}/${tabRepo.repo} is not visible to this token`, 'error');
    return;
  }
  const repoSelect = document.getElementById('repoSelect');
  repoSelect.value = match.fullName;
  await handleRepoSelection();
  const branchSelect = document.getElementById('branchSelect');
  if (tabRepo.branch) {
    // /tree/<branch>/<path>: the longest known branch the address starts with.
    const branch = currentBranches.filter((b) => tabRepo.branch === b || tabRepo.branch.startsWith(`${b}/`)).sort((a, b) => b.length - a.length)[0];
    if (branch) branchSelect.value = branch;
  }
  document.getElementById('addRepoBtn').focus();
}

// ---------------------------------------------------------------------------------------------------------------
// Adding repositories: owner, then repository, then branch

/** The owner part of a repository entry ("owner/name"). */
function ownerOf(repoEntry) {
  return RepoOrder.label(repoEntry).repo.split('/')[0];
}

/** Owners to offer: remembered ones (most recent first), then owners of monitored repositories. */
function knownOwners() {
  const seen = new Map();
  const add = (owner) => {
    if (owner && !seen.has(owner.toLowerCase())) seen.set(owner.toLowerCase(), owner);
  };
  currentData.owners.forEach(add);
  currentData.repos.forEach((r) => add(ownerOf(r)));
  return [...seen.values()];
}

function monitoredCount(owner) {
  const lower = owner.toLowerCase();
  return currentData.repos.filter((r) => ownerOf(r).toLowerCase() === lower).length;
}

function setAddStatus(text, className = '') {
  const statusEl = document.getElementById('branchStatus');
  statusEl.textContent = text;
  statusEl.className = `status-text ${className}`.trim();
}

function resetBranchSelect() {
  const branchSelect = document.getElementById('branchSelect');
  branchSelect.replaceChildren(new Option('Select branch...', ''));
  branchSelect.disabled = true;
  document.getElementById('addRepoBtn').disabled = true;
  currentBranches = [];
}

function resetRepoSelect(placeholder) {
  document.getElementById('repoCount').textContent = '';
  const repoSelect = document.getElementById('repoSelect');
  repoSelect.replaceChildren(new Option(placeholder, ''));
  repoSelect.disabled = true;
}

/**
 * The Owner field starts with the last owner used (or the first remembered one) and loads its repositories, so
 * adding another repository from the same owner is two clicks.
 */
function initOwnerField() {
  const input = document.getElementById('ownerInput');
  if (!currentData.token) {
    input.disabled = true;
    setAddPanelOpen(true);
    setAddStatus('Add a GitHub token in Settings first', 'error');
    return;
  }
  const owner = currentData.lastOwner || knownOwners()[0] || '';
  input.value = owner;
  if (owner) selectOwner(owner);
}

function handleOwnerInput() {
  showOwnerSuggestions();
  if (ownerDebounceTimer) clearTimeout(ownerDebounceTimer);
  const owner = document.getElementById('ownerInput').value.trim();
  if (ownerRepos && owner.toLowerCase() === ownerRepos.owner.toLowerCase()) return;
  ownerRepos = null;
  resetBranchSelect();
  resetRepoSelect(owner ? 'Press Enter or pick an owner' : 'Enter an owner first');
  setAddStatus('');
  // A pause in typing loads the owner's repositories without needing Enter.
  if (GitHubAPI.OWNER_PATTERN.test(owner)) {
    ownerDebounceTimer = setTimeout(() => selectOwner(owner), 700);
  }
}

function handleOwnerKeydown(e) {
  const items = [...document.querySelectorAll('#ownerSuggestions [role="option"]')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    e.preventDefault();
    ownerActive = e.key === 'ArrowDown' ? Math.min(items.length - 1, ownerActive + 1) : Math.max(0, ownerActive - 1);
    highlightOwner(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const picked = ownerActive >= 0 && items[ownerActive] ? items[ownerActive].dataset.owner : e.target.value;
    selectOwner(picked);
  } else if (e.key === 'Escape') {
    hideOwnerSuggestions();
  }
}

function highlightOwner(items) {
  items.forEach((item, i) => item.classList.toggle('active', i === ownerActive));
  const input = document.getElementById('ownerInput');
  if (ownerActive >= 0 && items[ownerActive]) input.setAttribute('aria-activedescendant', items[ownerActive].id);
  else input.removeAttribute('aria-activedescendant');
}

/**
 * Remembered owners matching what is typed. Built with text nodes only.
 */
function showOwnerSuggestions() {
  const input = document.getElementById('ownerInput');
  const suggestionsEl = document.getElementById('ownerSuggestions');
  const typed = input.value.trim().toLowerCase();
  // While the field holds a loaded owner, show every remembered owner so switching is one click.
  const filtering = typed && !(ownerRepos && ownerRepos.owner.toLowerCase() === typed);
  const owners = knownOwners().filter((o) => !filtering || o.toLowerCase().includes(typed));
  ownerActive = -1;
  if (!owners.length) {
    hideOwnerSuggestions();
    return;
  }
  suggestionsEl.replaceChildren(
    ...owners.map((owner, i) => {
      const count = monitoredCount(owner);
      const node = el('div', 'autocomplete-item owner-item');
      node.id = `owner-option-${i}`;
      node.setAttribute('role', 'option');
      node.dataset.owner = owner;
      const text = el('div', 'owner-item-text');
      text.append(el('div', 'autocomplete-item-name', owner), el('div', 'autocomplete-item-desc', count ? `${count} monitored` : 'Remembered'));
      node.append(text);
      node.addEventListener('click', () => {
        document.getElementById('ownerInput').value = owner;
        selectOwner(owner);
      });
      // Owners with monitored repositories are always offered; the others can be forgotten.
      if (!count) {
        const forget = el('button', 'owner-forget', '×');
        forget.type = 'button';
        forget.title = `Forget ${owner}`;
        forget.setAttribute('aria-label', `Forget ${owner}`);
        forget.addEventListener('click', (e) => {
          e.stopPropagation();
          forgetOwner(owner);
        });
        node.append(forget);
      }
      return node;
    })
  );
  suggestionsEl.classList.remove('hidden');
  input.setAttribute('aria-expanded', 'true');
}

function hideOwnerSuggestions() {
  const suggestionsEl = document.getElementById('ownerSuggestions');
  suggestionsEl.classList.add('hidden');
  suggestionsEl.replaceChildren();
  ownerActive = -1;
  const input = document.getElementById('ownerInput');
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
}

async function forgetOwner(owner) {
  const lower = owner.toLowerCase();
  currentData.owners = currentData.owners.filter((o) => o.toLowerCase() !== lower);
  if (currentData.lastOwner && currentData.lastOwner.toLowerCase() === lower) currentData.lastOwner = null;
  await StorageManager.saveOwners(currentData.owners, currentData.lastOwner);
  showOwnerSuggestions();
}

/**
 * Load every repository of an owner into the Repository dropdown.
 */
async function selectOwner(rawOwner) {
  const owner = (rawOwner || '').trim();
  if (ownerDebounceTimer) clearTimeout(ownerDebounceTimer);
  hideOwnerSuggestions();
  resetBranchSelect();
  if (!owner) {
    ownerRepos = null;
    resetRepoSelect('Enter an owner first');
    return;
  }
  if (!currentData.token) {
    setAddStatus('Add a GitHub token in Settings first', 'error');
    return;
  }
  const request = ++ownerRequest;
  ownerRepos = null;
  resetRepoSelect('Loading repositories...');
  setAddStatus(`Loading ${owner}'s repositories...`);
  const result = await GitHubAPI.listOwnerRepos(owner, currentData.token);
  if (request !== ownerRequest) return;
  if (!result.ok) {
    resetRepoSelect('No repositories');
    setAddStatus(result.error, 'error');
    return;
  }
  ownerRepos = { owner: result.owner, repos: result.repos };
  document.getElementById('ownerInput').value = result.owner;
  currentData.lastOwner = result.owner;
  await StorageManager.saveOwners(currentData.owners, result.owner);
  renderRepoOptions(true);
  const n = result.repos.length;
  // The count describes the dropdown's items, so it sits in the Repository label rather than the status line.
  document.getElementById('repoCount').textContent = n ? `${n} from ${result.owner}` : '';
  if (n) setAddStatus('');
  else setAddStatus(`${result.owner} has no repositories this token can see`, 'error');
}

/**
 * Fill the Repository dropdown for the loaded owner, marking what is already monitored. Polls re-render the popup
 * every few seconds, so the options are only rebuilt when they would change (an open dropdown stays open).
 */
function renderRepoOptions(force = false) {
  const repoSelect = document.getElementById('repoSelect');
  if (!ownerRepos) return;
  const monitored = new Set(currentData.repos.map((r) => RepoOrder.label(r).repo.toLowerCase()));
  const signature = ownerRepos.owner + '|' + ownerRepos.repos.map((r) => (monitored.has(r.fullName.toLowerCase()) ? '1' : '0')).join('');
  if (!force && repoSelect.dataset.signature === signature) return;
  repoSelect.dataset.signature = signature;
  const selected = repoSelect.value;
  const n = ownerRepos.repos.length;
  repoSelect.replaceChildren(
    new Option(n ? 'Choose a repository' : 'No repositories', ''),
    ...ownerRepos.repos.map((repo) => {
      const notes = [repo.isPrivate ? 'private' : '', repo.archived ? 'archived' : '', monitored.has(repo.fullName.toLowerCase()) ? 'monitored' : ''].filter(Boolean);
      const option = new Option(notes.length ? `${repo.name} (${notes.join(', ')})` : repo.name, repo.fullName);
      if (repo.description) option.title = repo.description;
      return option;
    })
  );
  repoSelect.value = ownerRepos.repos.some((r) => r.fullName === selected) ? selected : '';
  repoSelect.disabled = n === 0;
}

/**
 * A repository was chosen: load its branches.
 */
async function handleRepoSelection() {
  const repoKey = document.getElementById('repoSelect').value;
  resetBranchSelect();
  if (!repoKey) {
    setAddStatus('');
    return;
  }
  const branchSelect = document.getElementById('branchSelect');
  const addBtn = document.getElementById('addRepoBtn');
  setAddStatus('Loading branches...');
  const [owner, repo] = repoKey.split('/');
  const { branches, source } = await GitHubAPI.fetchBranches(owner, repo, currentData.token);
  if (document.getElementById('repoSelect').value !== repoKey) return; // another repository was chosen meanwhile

  currentBranches = branches;
  branchSelect.replaceChildren(new Option('All branches', 'all'), ...branches.map((branch) => new Option(branch, branch)));

  // "All branches" is always possible (it only needs workflow runs), so adding is never blocked by the branch list.
  branchSelect.value = 'all';
  branchSelect.disabled = false;
  addBtn.disabled = false;

  const n = branches.length;
  if (source === 'branches') setAddStatus(`${n} branch${n !== 1 ? 'es' : ''} found`, 'success');
  else if (source === 'runs') setAddStatus(`${n} branch${n !== 1 ? 'es' : ''} with workflow runs (the token cannot list all branches)`);
  else setAddStatus('No branches with workflow runs yet; "All branches" will pick up any run');
}

/**
 * Handle branch selection
 */
function handleBranchSelection() {
  const branchSelect = document.getElementById('branchSelect');
  const addBtn = document.getElementById('addRepoBtn');

  addBtn.disabled = !branchSelect.value;
}

/**
 * Add repository
 */
async function addRepo() {
  const repoSelect = document.getElementById('repoSelect');
  const branchSelect = document.getElementById('branchSelect');
  const repoKey = repoSelect.value;
  const branch = branchSelect.value;

  if (!repoKey || !branch) {
    return;
  }

  if (!validateRepoFormat(repoKey)) {
    alert('Invalid repository format. Use: owner/repo');
    return;
  }

  // Create unique ID for this repo+branch combination
  const id = `${repoKey}:${branch}`;

  // Check if this exact repo+branch combination already exists
  if (currentData.repos.some((r) => RepoOrder.idOf(r) === id)) {
    alert(`Repository ${repoKey} with branch "${branch}" is already being monitored`);
    return;
  }

  currentData.repos.push({ id, repo: repoKey, branch, enabled: true });
  await StorageManager.saveRepos(currentData.repos);

  // Remember the owner (most recent first) for the Owner field; it stays filled in for the next addition.
  const owner = repoKey.split('/')[0];
  currentData.owners = [owner, ...currentData.owners.filter((o) => o.toLowerCase() !== owner.toLowerCase())];
  currentData.lastOwner = owner;
  await StorageManager.saveOwners(currentData.owners, owner);

  // Reset the repository and branch choice; the owner and its repository list stay, and so does the open form.
  repoSelect.value = '';
  resetBranchSelect();
  setAddStatus(`Added ${repoKey}${branch === 'all' ? '' : ` (${branch})`}`, 'success');

  renderUI();

  // Trigger immediate refresh for the new repo
  refreshNow();
}

/**
 * Toggle repository enabled/disabled state
 */
async function toggleRepoEnabled(id) {
  const repoIndex = currentData.repos.findIndex((r) => RepoOrder.idOf(r) === id);
  if (repoIndex === -1) {
    console.error('Repository not found:', id);
    return;
  }

  const repo = currentData.repos[repoIndex];
  if (typeof repo === 'string') {
    // Convert old format to new format with enabled = false
    currentData.repos[repoIndex] = { id, repo: id.split(':')[0], branch: id.split(':')[1] || 'all', enabled: false };
  } else {
    // Toggle the effective state: a missing property means enabled, so flip that rather than the raw value
    currentData.repos[repoIndex] = { ...repo, enabled: repo.enabled === false };
  }

  await StorageManager.saveRepos(currentData.repos);

  // Refresh UI, then re-poll so the toolbar icon and polling speed reflect the change right away
  renderUI();
  refreshNow();
}

/**
 * Remove repository
 */
async function removeRepo(id) {
  const entry = currentData.repos.find((r) => RepoOrder.idOf(r) === id);
  const { repo, branch } = RepoOrder.label(entry);
  if (!confirm(`Remove ${repo}${branch === 'all' ? '' : ` (${branch})`}?`)) {
    return;
  }

  currentData.repos = currentData.repos.filter((r) => RepoOrder.idOf(r) !== id);
  await StorageManager.saveRepos(currentData.repos);

  // Also remove from results and the expanded cards
  delete currentData.lastResults[id];
  await StorageManager.saveResults(currentData.lastResults);
  if (currentData.expanded.includes(id)) {
    currentData.expanded = currentData.expanded.filter((x) => x !== id);
    await StorageManager.saveExpanded(currentData.expanded);
  }

  renderUI();
}

/**
 * Validate repository format
 */
function validateRepoFormat(repoKey) {
  const pattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
  return pattern.test(repoKey);
}

/**
 * Refresh now
 */
async function refreshNow() {
  const btn = document.getElementById('refreshBtn');
  const label = btn.querySelector('.btn-label');
  // The button itself shows progress (fixed width), so nothing around it moves.
  const show = (text, state) => {
    label.textContent = text;
    btn.classList.toggle('is-busy', state === 'busy');
    btn.classList.toggle('is-done', state === 'done');
    btn.disabled = state === 'busy';
  };
  if (refreshResetTimer) clearTimeout(refreshResetTimer);
  show('Refreshing', 'busy');

  try {
    await chrome.runtime.sendMessage({ action: 'refreshNow' });

    // Wait a moment for results to be saved
    setTimeout(async () => {
      await loadData();
      renderUI();
      checkRateLimit();
      show('✓ Refreshed', 'done');
      refreshResetTimer = setTimeout(() => show('Refresh Now', 'idle'), 2000);
    }, 500);
  } catch (error) {
    show('Refresh Now', 'idle');
    // Handle connection errors gracefully (service worker might be restarting)
    if (error.message && error.message.includes('Receiving end does not exist')) {
      showToast('Refresh requested (extension starting up)');
    } else {
      showToast(`Refresh failed: ${error.message}`, 'error');
    }
  }
}

/**
 * Check and display rate limit status
 */
function checkRateLimit() {
  const banner = document.getElementById('rateLimitBanner');
  const message = document.getElementById('rateLimitMessage');

  if (!currentData.rateLimitUntil || Date.now() >= currentData.rateLimitUntil) {
    banner.classList.add('hidden');
    return;
  }

  const retryTime = new Date(currentData.rateLimitUntil);
  message.textContent = `⚠ Rate limited. Retry at ${retryTime.toLocaleTimeString()}`;
  banner.classList.remove('hidden');
}

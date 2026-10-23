// Background service worker for GitHub Actions Monitor
// Handles periodic polling, adaptive polling, icon updates, and data storage

importScripts('github-api.js', 'icon-manager.js', 'storage-manager.js', 'repo-order.js');

const RATE_LIMIT_PAUSE_MINUTES = 10;
const ALARM_NAME = 'github-actions-poll';
const FAST_POLL_SECONDS = 5;
const DEFAULT_POLL_INTERVAL_SECONDS = 30;
const CHROME_ALARM_MIN_MINUTES = 1; // Chrome's minimum alarm period for packed extensions

// Track current polling mode to avoid recreating alarms unnecessarily
let currentPollingMode = 'normal'; // 'normal' or 'fast'
let currentIntervalSeconds = DEFAULT_POLL_INTERVAL_SECONDS;
let fastPollTimeoutId = null; // Track setTimeout for fast polling
let previousResults = {}; // Track previous status to detect changes

/**
 * What the toolbar icon opens. The side panel opens on a click only when the action has no popup, so choosing
 * the panel removes the popup, and choosing the popup puts it back.
 */
async function applyIconOpens(mode) {
  const panel = mode === 'panel' && !!chrome.sidePanel;
  await chrome.action.setPopup({ popup: panel ? '' : 'popup.html' });
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: panel });
  }
}

// Every time the service worker starts: the action's popup is not kept across browser restarts.
StorageManager.getData().then((data) => applyIconOpens(data.iconOpens)).catch(() => {});

// The pop-out window: remember where it was left (moved or resized), and forget it once closed.
chrome.windows.onBoundsChanged.addListener(async (win) => {
  const { popoutWindowId } = await chrome.storage.local.get(['popoutWindowId']);
  if (win.id !== popoutWindowId) return;
  await chrome.storage.local.set({ popoutBounds: { left: win.left, top: win.top, width: win.width, height: win.height } });
});
chrome.windows.onRemoved.addListener(async (windowId) => {
  const { popoutWindowId } = await chrome.storage.local.get(['popoutWindowId']);
  if (windowId === popoutWindowId) await chrome.storage.local.remove(['popoutWindowId']);
});

// Initialize storage on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('GitHub Actions Monitor installed');

  // Initialize defaults using storage manager
  await StorageManager.initializeDefaults();

  // Get current settings
  const data = await StorageManager.getData();
  currentIntervalSeconds = data.pollIntervalSeconds;

  // Initialize previous results from storage to avoid false notifications on first poll
  previousResults = data.lastResults || {};

  // Set up initial alarm
  await setupAlarm('normal');

  // Do initial poll
  pollAllRepos();
});

// Handle alarm triggers
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    pollAllRepos();
  }
});

// Handle messages from popup and options page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'refreshNow') {
    // Clear any pending fast poll timeout to avoid duplicate polling
    if (fastPollTimeoutId) {
      clearTimeout(fastPollTimeoutId);
      fastPollTimeoutId = null;
    }

    pollAllRepos().then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // Indicates async response
  }

  if (message.action === 'updatePollingInterval') {
    const intervalSeconds = message.intervalSeconds;
    if (intervalSeconds && intervalSeconds > 0) {
      currentIntervalSeconds = intervalSeconds;
      // If we're in normal mode, update the alarm
      if (currentPollingMode === 'normal') {
        setupAlarm('normal').then(() => {
          console.log(`Polling interval updated to ${intervalSeconds} seconds`);
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: true });
      }
    }
    return true;
  }
});

// Listen for storage changes (e.g., from options page)
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  // Handle polling interval changes (stored in sync)
  if (areaName === 'sync' && changes.pollIntervalSeconds) {
    const newInterval = changes.pollIntervalSeconds.newValue;
    if (newInterval && newInterval !== currentIntervalSeconds) {
      currentIntervalSeconds = newInterval;
      console.log(`Detected polling interval change: ${newInterval} seconds`);
      // Update alarm if in normal mode
      if (currentPollingMode === 'normal') {
        await setupAlarm('normal');
      }
    }
  }

  // The toolbar icon's target changed (popup or side panel).
  if (areaName === 'sync' && changes.iconOpens) {
    await applyIconOpens(changes.iconOpens.newValue);
  }

  // The badge setting changed: repaint the count from the last results right away.
  if (areaName === 'sync' && changes.badgeMode) {
    const data = await StorageManager.getData();
    await IconManager.showCount(data.lastResults, data.badgeMode);
  }

  // Handle sync preference changes - migrate token if needed
  if (areaName === 'sync' && changes.syncToken) {
    console.log(`Sync preference changed: ${changes.syncToken.newValue}`);
    // Token migration is handled by StorageManager.updateSyncPreference
  }
});

/**
 * Set up polling alarm based on mode
 * @param {string} mode - 'normal' or 'fast'
 */
async function setupAlarm(mode) {
  // Clear existing alarm and timeout
  await chrome.alarms.clear(ALARM_NAME);
  if (fastPollTimeoutId) {
    clearTimeout(fastPollTimeoutId);
    fastPollTimeoutId = null;
  }

  // Ensure we have the latest interval from storage (in case service worker restarted)
  if (mode === 'normal') {
    const data = await StorageManager.getData();
    currentIntervalSeconds = data.pollIntervalSeconds;
  }

  let periodInMinutes;
  if (mode === 'fast') {
    // Fast polling uses setTimeout for true 5-second intervals
    // Still create an alarm as backup in case service worker restarts
    periodInMinutes = CHROME_ALARM_MIN_MINUTES;
    console.log(`Setting up fast polling: ${FAST_POLL_SECONDS} seconds (with ${periodInMinutes}-minute backup alarm)`);
  } else {
    // Normal polling: use configured interval
    // Note: Chrome enforces 1-minute minimum for packed extensions automatically
    periodInMinutes = currentIntervalSeconds / 60;
    console.log(`Setting up normal polling: ${currentIntervalSeconds} seconds`);
  }

  // Create new alarm
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: periodInMinutes
  });

  currentPollingMode = mode;
}

/**
 * Schedule next fast poll using setTimeout
 * This allows true 5-second polling while service worker is active
 */
function scheduleFastPoll() {
  if (fastPollTimeoutId) {
    clearTimeout(fastPollTimeoutId);
  }

  fastPollTimeoutId = setTimeout(() => {
    console.log('Fast poll timeout triggered');
    pollAllRepos();
  }, FAST_POLL_SECONDS * 1000);
}

/**
 * Create a notification for status change
 * @param {string} repoKey - Repository identifier (owner/repo)
 * @param {Object} newResult - New status result
 * @param {Object} oldResult - Previous status result
 */
async function createStatusNotification(repoKey, newResult, oldResult) {
  // Check if notifications are enabled
  const data = await StorageManager.getData();
  if (!data.notificationsEnabled) {
    return;
  }

  // Don't notify if we don't have previous status (first poll)
  if (!oldResult) {
    return;
  }

  // Only notify on meaningful status changes
  const oldColor = oldResult.color;
  const newColor = newResult.color;

  // Skip if status hasn't changed
  if (oldColor === newColor) {
    return;
  }

  // Skip if changing from/to gray (errors, no data)
  if (oldColor === 'gray' || newColor === 'gray') {
    return;
  }

  // Determine notification title and message. The card's name, not its id: "owner/repo (main, CI)".
  const entry = (data.repos || []).find((r) => RepoOrder.idOf(r) === repoKey);
  const name = entry ? RepoOrder.describe(entry) : repoKey;
  let title = '';
  let message = '';

  if (newColor === 'green') {
    title = 'Workflow Succeeded';
    message = `${name}\n${newResult.workflowName || 'Workflow'} completed successfully`;
  } else if (newColor === 'red') {
    title = 'Workflow Failed';
    // "CI failed", plus the repository's state only when it adds something ("CI failed: 2 failing, 1 running").
    const state = newResult.message && !/^(1 failing|failed)$/i.test(newResult.message) ? `: ${newResult.message}` : '';
    message = `${name}\n${newResult.workflowName || 'Workflow'} failed${state}`;
    const failed = (newResult.workflows || []).find((w) => w.color === 'red' && !w.ignored && w.failure);
    if (failed) message += `\nFailed at ${failed.failure.job}${failed.failure.step ? ` > ${failed.failure.step}` : ''}`;
    // The first line that says why, when the log named one.
    if (failed && failed.failure.errors && failed.failure.errors.length) message += `\n${failed.failure.errors[0]}`;
  } else if (newColor === 'yellow') {
    title = 'Workflow Started';
    message = `${name}\n${newResult.workflowName || 'Workflow'} is now ${newResult.message.toLowerCase()}`;
  }

  // Create the notification with colored icon
  if (title && message) {
    const notificationId = `workflow-${repoKey}-${Date.now()}`;

    // Generate colored icon data URL
    const iconUrl = await IconManager.generateIconDataUrl(newColor, 128);

    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: iconUrl,
      title: title,
      message: message,
      priority: newColor === 'red' ? 2 : 1,
      requireInteraction: false
    });

    console.log(`Notification created for ${repoKey}: ${oldColor} -> ${newColor}`);
  }
}

/**
 * Check for status changes and create notifications
 * @param {Object} newResults - Current poll results
 */
async function checkStatusChanges(newResults) {
  for (const repoKey in newResults) {
    const newResult = newResults[repoKey];
    const oldResult = previousResults[repoKey];

    await createStatusNotification(repoKey, newResult, oldResult);
  }

  // Update previous results
  previousResults = { ...newResults };
}

// Handle notification clicks - open the workflow run URL
chrome.notifications.onClicked.addListener(async (notificationId) => {
  // Extract repo key from notification ID (format: workflow-owner/repo-timestamp)
  const match = notificationId.match(/^workflow-(.+)-\d+$/);
  if (match) {
    const repoKey = match[1];
    const data = await StorageManager.getData();
    const result = data.lastResults[repoKey];

    // A failure opens the failed job's log (one click less than the run page); anything else opens the run.
    const failed = result && result.color === 'red' ? (result.workflows || []).find((w) => w.color === 'red' && !w.ignored && w.failure && w.failure.url) : null;
    const url = failed ? failed.failure.url : result && result.runUrl;
    if (url) {
      chrome.tabs.create({ url });
    }
  }

  // Clear the notification
  chrome.notifications.clear(notificationId);
});

/**
 * Names the failed job and step of each failed workflow ("failed at Test > npm test"). A run's answer never
 * changes, so it is cached by run and attempt and costs one request per new failure, not one per poll.
 */
async function addFailures(owner, repo, token, result, storedFailures, usedFailures, stats) {
  for (const workflow of result.workflows || []) {
    if (workflow.color !== 'red' || !workflow.runId || !['failure', 'timed_out'].includes(workflow.conclusion)) continue;
    const key = `${owner}/${repo}#${workflow.runId}#${workflow.runAttempt || 1}`;
    let failure = storedFailures[key];
    if (failure === undefined) {
      failure = await GitHubAPI.fetchFailure(owner, repo, workflow.runId, token);
      stats.requests++;
      if (failure === undefined) continue; // could not ask: try again next poll
    }
    // The lines that say why, from the failed job's log: asked once (a missing "errors" means not asked yet, or
    // GitHub could not be reached last time; null means the log names nothing).
    if (failure && failure.jobId && !('errors' in failure)) {
      const errors = await GitHubAPI.fetchErrorLines(owner, repo, failure, token);
      stats.requests++;
      if (errors !== undefined) failure = { ...failure, errors };
    }
    usedFailures[key] = failure;
    if (failure) workflow.failure = failure;
  }
}

// Step lights for running runs: the jobs of each running run, asked at most every PROGRESS_INTERVAL_MS (fast
// polling is every 5 seconds) and conditionally, so an unchanged answer is free. Kept in memory: a restarted
// service worker simply asks again.
const PROGRESS_INTERVAL_MS = 10000;
const progressCache = new Map();

async function addProgress(owner, repo, token, result, usedProgress, stats) {
  for (const workflow of result.workflows || []) {
    if (workflow.status !== 'in_progress' || !workflow.runId) continue;
    const key = `${owner}/${repo}#${workflow.runId}#${workflow.runAttempt || 1}`;
    let entry = progressCache.get(key);
    if (!entry || Date.now() - entry.at >= PROGRESS_INTERVAL_MS) {
      const answer = await GitHubAPI.fetchJobs(owner, repo, workflow.runId, token, entry ? entry.etag : null);
      stats.requests++;
      if (answer && answer.notModified) stats.notModified++;
      if (answer) entry = { at: Date.now(), etag: answer.etag, jobs: answer.jobs || (entry && entry.jobs) || [] };
    }
    if (!entry) continue;
    usedProgress.add(key);
    progressCache.set(key, entry);
    workflow.progress = entry.jobs;
  }
}

/**
 * Poll all configured repositories
 */
async function pollAllRepos() {
  console.log('Polling all repositories...');

  const data = await StorageManager.getData();

  // Check if we're rate limited
  if (data.rateLimitUntil) {
    const now = Date.now();
    if (now < data.rateLimitUntil) {
      console.log('Skipping poll: rate limited until', new Date(data.rateLimitUntil));
      return;
    } else {
      // Rate limit expired, clear it
      await StorageManager.clearRateLimit();
    }
  }

  const repos = data.repos || [];
  const token = data.token;

  if (!token || repos.length === 0) {
    console.log('Skipping poll: no token or no repos configured');
    // Update icon to gray if no repos or token
    await IconManager.updateBadge('gray');
    await IconManager.showCount({}, data.badgeMode);
    return;
  }

  const results = {};
  let rateLimited = false;
  let rateLimitResetTime = null;

  // ETag cache (persisted, so conditional requests survive service worker restarts). Only entries used in this
  // poll are kept, so removed repos and changed branches do not accumulate.
  const storedCache = await StorageManager.getEtagCache();
  const usedCache = {};
  const cache = {
    get: (url) => {
      if (storedCache[url]) usedCache[url] = storedCache[url];
      return storedCache[url] || null;
    },
    set: (url, entry) => { usedCache[url] = entry; }
  };
  const stats = { requests: 0, notModified: 0 };
  let latestRateLimit = null;
  // Where failed runs failed: asked once per run and attempt, then kept while the run is still shown.
  const storedFailures = await StorageManager.getFailureCache();
  const usedFailures = {};
  const usedProgress = new Set();

  for (const repoEntry of repos) {
    // Handle both old string format and new object format during migration
    let repoKey, branch, resultId, enabled;
    if (typeof repoEntry === 'string') {
      repoKey = repoEntry;
      branch = 'all';
      resultId = `${repoKey}:all`;
      enabled = true; // Default for old format
    } else {
      repoKey = repoEntry.repo;
      branch = repoEntry.branch || 'all';
      resultId = repoEntry.id;
      enabled = repoEntry.enabled !== false; // Default to true if missing
    }

    // Skip disabled repos
    if (!enabled) {
      console.log('Skipping disabled repo:', resultId);
      continue;
    }

    const [owner, repo] = repoKey.split('/');
    if (!owner || !repo) {
      console.warn('Invalid repo format:', repoKey);
      continue;
    }

    try {
      // A pinned workflow is the card's only workflow, so nothing on it is ignored.
      const workflowId = typeof repoEntry === 'string' ? null : repoEntry.workflow?.id ?? null;
      const ignored = typeof repoEntry === 'string' || workflowId ? [] : repoEntry.ignored || [];
      const result = await GitHubAPI.fetchRepoStatus(owner, repo, token, branch, cache, ignored, workflowId);
      // Copies: the ETag cache holds these same workflow objects, and the failure details and step lights added
      // below belong to this poll's results, not to the cache.
      if (result.workflows) result.workflows = result.workflows.map((w) => ({ ...w }));
      await addFailures(owner, repo, token, result, storedFailures, usedFailures, stats);
      await addProgress(owner, repo, token, result, usedProgress, stats);
      stats.requests++;
      if (result.notModified) stats.notModified++;
      if (result.rateLimit) latestRateLimit = result.rateLimit;
      delete result.rateLimit;
      delete result.notModified;
      results[resultId] = result;

      if (result.rateLimited) {
        rateLimited = true;
        if (result.rateLimitReset) {
          rateLimitResetTime = result.rateLimitReset.getTime();
        }
      }
    } catch (error) {
      console.error('Error fetching status for', resultId, error);
      results[resultId] = {
        repo: repoKey,
        timestamp: Date.now(),
        status: 'error',
        color: 'gray',
        message: `Error: ${error.message}`,
        workflowName: null,
        branch: branch,
        runUrl: null,
        updatedAt: null
      };
    }
  }

  // Runs that finished or were removed no longer need their step lights.
  for (const key of progressCache.keys()) {
    if (!usedProgress.has(key)) progressCache.delete(key);
  }

  // Check for status changes and create notifications
  await checkStatusChanges(results);

  // Save results, the ETag cache, and what this poll cost against the rate limit (shown on the settings page)
  await StorageManager.saveResults(results);
  await StorageManager.saveEtagCache(usedCache);
  await StorageManager.saveFailureCache(usedFailures);
  await StorageManager.savePollStats({ ...stats, at: Date.now(), rateLimit: latestRateLimit });

  // Handle rate limiting
  if (rateLimited) {
    const pauseUntil = rateLimitResetTime || (Date.now() + RATE_LIMIT_PAUSE_MINUTES * 60 * 1000);
    await StorageManager.saveRateLimit(pauseUntil);
    console.log('Rate limited. Pausing until', new Date(pauseUntil));
  }

  console.log('Poll complete. Results:', results);

  // Update extension icon based on aggregate status
  const aggregateColor = IconManager.aggregateStatus(results);
  await IconManager.updateBadge(aggregateColor);
  await IconManager.showCount(results, data.badgeMode);
  console.log('Icon updated to color:', aggregateColor);

  // Implement adaptive polling
  const hasActiveWorkflows = IconManager.hasActiveWorkflows(results);

  if (hasActiveWorkflows && currentPollingMode !== 'fast') {
    // Switch to fast polling
    console.log('Active workflows detected. Switching to fast polling.');
    await setupAlarm('fast');
    // Schedule immediate fast poll
    scheduleFastPoll();
  } else if (hasActiveWorkflows && currentPollingMode === 'fast') {
    // Continue fast polling - schedule next poll
    scheduleFastPoll();
  } else if (!hasActiveWorkflows && currentPollingMode !== 'normal') {
    // Switch back to normal polling
    console.log('No active workflows. Switching to normal polling.');
    await setupAlarm('normal');
  }

  // Notify popup if it's open
  chrome.runtime.sendMessage({ action: 'pollComplete', results }).catch(() => {
    // Popup might not be open, that's okay
  });
}

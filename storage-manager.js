// Storage manager for GitHub Actions Monitor
// Handles sync vs local storage based on user preferences

const StorageManager = {
  /** What the toolbar badge counts: failing repositories, else running ones ('both'); failing only; or nothing. */
  BADGE_MODES: ['both', 'failing', 'off'],

  /** What clicking the toolbar icon opens: the popup, or the side panel (docked, stays open while browsing). */
  ICON_OPENS: ['popup', 'panel'],

  /**
   * Get all extension data from appropriate storage locations
   * @returns {Promise<Object>} Combined data from sync and local storage
   */
  async getData() {
    // Get sync preferences first
    const syncPrefs = await chrome.storage.sync.get(['syncToken']);
    const shouldSyncToken = syncPrefs.syncToken || false;

    // Get synced data
    const syncData = await chrome.storage.sync.get([
      'repos',
      'pollIntervalSeconds',
      'syncToken',
      'notificationsEnabled',
      'owners',
      'lastOwner',
      'sortMode',
      'badgeMode',
      'runControls',
      'expanded',
      'iconOpens'
    ]);

    // Get local-only data
    const localData = await chrome.storage.local.get([
      'lastResults',
      'rateLimitUntil',
      'firstTimeSetup',
      'pollStats',
      'expanded'
    ]);

    // Expanded cards are synced; 3.0.0 pre-release builds kept them on the device: carry such a list over once.
    if (!Array.isArray(syncData.expanded) && Array.isArray(localData.expanded)) {
      syncData.expanded = localData.expanded;
      await chrome.storage.sync.set({ expanded: localData.expanded });
      await chrome.storage.local.remove(['expanded']);
    }

    // Get token from appropriate location
    // (with what it is known to allow: see saveTokenAccess)
    const tokenArea = shouldSyncToken ? chrome.storage.sync : chrome.storage.local;
    const tokenData = await tokenArea.get(['token', 'tokenAccess']);
    const token = tokenData.token || null;
    const tokenAccess = token && this.TOKEN_ACCESS.includes(tokenData.tokenAccess) ? tokenData.tokenAccess : null;

    // Migrate old repos format to new format if needed
    let repos = syncData.repos || [];
    repos = await this.migrateReposFormat(repos);

    return {
      repos: repos,
      pollIntervalSeconds: syncData.pollIntervalSeconds || 30,
      syncToken: syncData.syncToken || false,
      notificationsEnabled: syncData.notificationsEnabled !== undefined ? syncData.notificationsEnabled : true,
      owners: Array.isArray(syncData.owners) ? syncData.owners : [],
      lastOwner: syncData.lastOwner || null,
      sortMode: syncData.sortMode || 'custom',
      badgeMode: this.BADGE_MODES.includes(syncData.badgeMode) ? syncData.badgeMode : 'both',
      iconOpens: this.ICON_OPENS.includes(syncData.iconOpens) ? syncData.iconOpens : 'popup',
      runControls: syncData.runControls === true,
      expanded: Array.isArray(syncData.expanded) ? syncData.expanded : [],
      token: token,
      tokenAccess: tokenAccess,
      lastResults: localData.lastResults || {},
      rateLimitUntil: localData.rateLimitUntil || null,
      firstTimeSetup: localData.firstTimeSetup || false,
      pollStats: localData.pollStats || null
    };
  },

  /**
   * Migrate repos from old string format to new object format
   * Old format: ["owner/repo", "owner2/repo2"]
   * New format: [{ id: "owner/repo:all", repo: "owner/repo", branch: "all", enabled: true }]
   * @param {Array} repos - Repository list in old or new format
   * @returns {Promise<Array>} Repository list in new format
   */
  async migrateReposFormat(repos) {
    if (!repos || repos.length === 0) {
      return [];
    }

    let needsSave = false;

    // Phase 1: Check if migration from string format is needed
    if (typeof repos[0] === 'string') {
      console.log('Migrating repos from old string format to new object format');
      repos = repos.map(repoKey => ({
        id: `${repoKey}:all`,
        repo: repoKey,
        branch: 'all',
        enabled: true
      }));
      needsSave = true;
    }

    // Phase 2: Ensure all repo objects have enabled property
    const reposWithEnabled = repos.map(repoEntry => {
      if (repoEntry.enabled === undefined) {
        console.log(`Adding enabled property to ${repoEntry.id}`);
        return { ...repoEntry, enabled: true };
      }
      return repoEntry;
    });

    // Check if any repos were updated
    if (!needsSave && reposWithEnabled.some((repo, index) => repo.enabled !== repos[index].enabled)) {
      needsSave = true;
    }

    // Save migrated format if needed
    if (needsSave) {
      await this.saveRepos(reposWithEnabled);
    }

    return reposWithEnabled;
  },

  /**
   * Save token to appropriate storage based on sync preference
   * @param {string} token - GitHub token
   * @param {boolean} shouldSync - Whether to sync the token
   */
  async saveToken(token, shouldSync, tokenAccess = null) {
    const keep = shouldSync ? chrome.storage.sync : chrome.storage.local;
    const drop = shouldSync ? chrome.storage.local : chrome.storage.sync;
    // The token's known access travels with it, so a synced token is not asked about again on another device.
    await keep.set(tokenAccess ? { token, tokenAccess } : { token });
    if (!tokenAccess) await keep.remove(['tokenAccess']);
    await drop.remove(['token', 'tokenAccess']);
  },

  /** What a token is known to allow for workflow runs: 'read' or 'write' (Actions: Read and write). */
  TOKEN_ACCESS: ['read', 'write'],

  /**
   * Remember what the saved token allows. Set from the token link it was made with (Setup), when the user says
   * they added Actions: Read and write, and from GitHub's answer to a re-run or cancel (accepted or refused).
   * Settings shows how to add the permission only while it is not known to be there.
   * @param {'read'|'write'} tokenAccess
   */
  async saveTokenAccess(tokenAccess) {
    if (!this.TOKEN_ACCESS.includes(tokenAccess)) throw new Error(`Unknown token access: ${tokenAccess}`);
    const { syncToken } = await chrome.storage.sync.get(['syncToken']);
    await (syncToken ? chrome.storage.sync : chrome.storage.local).set({ tokenAccess });
  },

  /**
   * Clear token from both storages
   */
  async clearToken() {
    await chrome.storage.local.remove(['token', 'tokenAccess']);
    await chrome.storage.sync.remove(['token', 'tokenAccess']);
  },

  /**
   * Save repository list (always synced)
   * @param {Array<string>} repos - Repository list
   */
  async saveRepos(repos) {
    await chrome.storage.sync.set({ repos });
  },

  /**
   * Remember owners for the popup's Owner field (always synced): most recently used first, at most 30.
   * Owners stay remembered after their repositories are removed, until forgotten in the popup.
   * @param {Array<string>} owners - Owner names, most recent first
   * @param {string|null} lastOwner - The owner the field shows next time
   */
  async saveOwners(owners, lastOwner) {
    await chrome.storage.sync.set({ owners: owners.slice(0, 30), lastOwner });
  },

  /**
   * Save how the popup orders repositories (always synced): 'custom', 'name', 'recent' or 'status'.
   * @param {string} sortMode - The order
   */
  async saveSortMode(sortMode) {
    await chrome.storage.sync.set({ sortMode });
  },

  /**
   * Save one of the simple synced preferences: badgeMode ('both', 'failing' or 'off') or runControls (boolean,
   * shows re-run and cancel buttons; the token then needs Actions: Read and write).
   * @param {string} key - 'badgeMode' or 'runControls'
   * @param {*} value
   */
  async savePreference(key, value) {
    if (!['badgeMode', 'runControls', 'iconOpens'].includes(key)) throw new Error(`Unknown preference: ${key}`);
    await chrome.storage.sync.set({ [key]: value });
  },

  /**
   * Which repository cards are expanded in the popup (repository ids; synced, so every browser opens the same cards).
   * @param {Array<string>} expanded
   */
  async saveExpanded(expanded) {
    await chrome.storage.sync.set({ expanded });
  },

  /**
   * Where failed runs failed, by "owner/repo#runId#attempt" (local only). Asked once per failed run.
   */
  async getFailureCache() {
    const { failureCache } = await chrome.storage.local.get(['failureCache']);
    return failureCache || {};
  },

  async saveFailureCache(failureCache) {
    await chrome.storage.local.set({ failureCache });
  },

  /**
   * Save polling interval (always synced)
   * @param {number} intervalSeconds - Polling interval in seconds
   */
  async savePollInterval(intervalSeconds) {
    await chrome.storage.sync.set({ pollIntervalSeconds: intervalSeconds });
  },

  /**
   * Save notifications enabled preference (always synced)
   * @param {boolean} enabled - Whether notifications are enabled
   */
  async saveNotificationsEnabled(enabled) {
    await chrome.storage.sync.set({ notificationsEnabled: enabled });
  },

  /**
   * Update sync token preference and migrate token if needed
   * @param {boolean} shouldSync - Whether to sync the token
   */
  async updateSyncPreference(shouldSync) {
    // Get current token from both locations
    const localToken = await chrome.storage.local.get(['token', 'tokenAccess']);
    const syncToken = await chrome.storage.sync.get(['token', 'tokenAccess']);
    const currentToken = localToken.token || syncToken.token || null;
    const currentAccess = localToken.tokenAccess || syncToken.tokenAccess || null;

    // Save the preference
    await chrome.storage.sync.set({ syncToken: shouldSync });

    // Migrate token to appropriate location
    if (currentToken) {
      await this.saveToken(currentToken, shouldSync, currentAccess);
    }
  },

  /**
   * Save results to local storage (never synced - too large and device-specific)
   * @param {Object} results - Poll results
   */
  async saveResults(results) {
    await chrome.storage.local.set({ lastResults: results });
  },

  /**
   * ETag cache for conditional requests: { url: { etag, result } } (local only)
   * @returns {Promise<Object>}
   */
  async getEtagCache() {
    const { etagCache } = await chrome.storage.local.get(['etagCache']);
    return etagCache || {};
  },

  async saveEtagCache(etagCache) {
    await chrome.storage.local.set({ etagCache });
  },

  /**
   * What the last poll cost: requests made, how many were free 304s, and GitHub's rate-limit headers (local only)
   * @param {{requests: number, notModified: number, at: number, rateLimit: Object|null}} pollStats
   */
  async savePollStats(pollStats) {
    await chrome.storage.local.set({ pollStats });
  },

  /**
   * Save rate limit status (local only - device-specific)
   * @param {number} rateLimitUntil - Timestamp when rate limit expires
   */
  async saveRateLimit(rateLimitUntil) {
    await chrome.storage.local.set({ rateLimitUntil });
  },

  /**
   * Clear rate limit status
   */
  async clearRateLimit() {
    await chrome.storage.local.set({ rateLimitUntil: null });
  },

  /**
   * Initialize storage with defaults for new installs
   */
  async initializeDefaults() {
    const data = await this.getData();

    // Set defaults if not present
    if (!data.repos || data.repos.length === 0) {
      await this.saveRepos([]);
    }
    if (!data.pollIntervalSeconds) {
      await this.savePollInterval(30);
    }
    if (data.syncToken === undefined) {
      await chrome.storage.sync.set({ syncToken: false }); // Default: don't sync token
    }
    if (data.notificationsEnabled === undefined) {
      await this.saveNotificationsEnabled(true); // Default: notifications enabled
    }
    if (!data.firstTimeSetup) {
      await chrome.storage.local.set({ firstTimeSetup: true });
    }
  }
};

// Make available to other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}

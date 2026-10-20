// Icon manager for GitHub Actions Monitor
// Dynamically generates and updates extension icon based on repository statuses

const IconManager = {
  flashIntervalId: null,
  currentFlashColor: 'red',

  /** Status colors (also used for notifications). */
  COLORS: {
    'red': '#ef4444',      // Red for failures
    'yellow': '#fbbf24',   // Yellow for in-progress
    'green': '#2da44e',    // Green for success
    'gray': '#9ca3af'      // Gray for unknown/no data
  },

  /**
   * Draw the status icon: the brand's dark rounded tile with a solid status circle (scripts/brand.mjs statusSvg).
   * @param {OffscreenCanvasRenderingContext2D} ctx - Context of a size x size canvas
   * @param {number} size - Icon size in pixels
   * @param {string} color - Color code: 'red', 'yellow', 'green', or 'gray'
   */
  paintStatus(ctx, size, color) {
    const margin = size * 0.02;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#1f2328';
    ctx.beginPath();
    ctx.roundRect(margin, margin, size - 2 * margin, size - 2 * margin, size * 0.2);
    ctx.fill();
    ctx.fillStyle = this.COLORS[color] || this.COLORS['gray'];
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2);
    ctx.fill();
  },

  /**
   * Aggregate status from multiple repository results
   * Priority: yellow (any in-progress) > all green > mixed (flash red/green) > gray
   * @param {Object} lastResults - Object mapping repo keys to status results
   * @returns {string} Aggregate color: 'yellow', 'green', 'mixed', or 'gray'
   */
  aggregateStatus(lastResults) {
    if (!lastResults || Object.keys(lastResults).length === 0) {
      return 'gray';
    }

    let hasRed = false;
    let hasYellow = false;
    let hasGreen = false;

    for (const repoKey in lastResults) {
      const result = lastResults[repoKey];
      const color = result.color || 'gray';

      if (color === 'red') {
        hasRed = true;
      } else if (color === 'yellow') {
        hasYellow = true;
      } else if (color === 'green') {
        hasGreen = true;
      }
    }

    // Priority: yellow (any in-progress) > all green > mixed red/green > gray
    if (hasYellow) {
      return 'yellow';
    } else if (hasGreen && !hasRed) {
      return 'green';
    } else if (hasRed && hasGreen) {
      return 'mixed';
    } else if (hasRed) {
      return 'red';
    } else {
      return 'gray';
    }
  },

  /**
   * Check if any repository has an in-progress workflow
   * @param {Object} lastResults - Object mapping repo keys to status results
   * @returns {boolean} True if any repo is yellow (in_progress or queued)
   */
  hasActiveWorkflows(lastResults) {
    if (!lastResults || Object.keys(lastResults).length === 0) {
      return false;
    }

    for (const repoKey in lastResults) {
      const result = lastResults[repoKey];
      if (result.color === 'yellow') {
        return true;
      }
    }

    return false;
  },

  /**
   * Update extension icon based on aggregate status
   * Dynamically generates a colored circle icon
   * Note: Function name kept as 'updateBadge' for compatibility, but it updates the entire icon
   * @param {string} color - Color code: 'red', 'yellow', 'green', 'gray', or 'mixed'
   */
  async updateBadge(color) {
    // Clear any existing flash interval
    if (this.flashIntervalId) {
      clearInterval(this.flashIntervalId);
      this.flashIntervalId = null;
    }

    if (color === 'mixed') {
      // Start flashing between red and green
      this.currentFlashColor = 'red';
      await this.drawIcon('red');

      this.flashIntervalId = setInterval(async () => {
        this.currentFlashColor = this.currentFlashColor === 'red' ? 'green' : 'red';
        await this.drawIcon(this.currentFlashColor);
      }, 1000);
    } else {
      // Single color
      await this.drawIcon(color);
    }
  },

  /**
   * Draw the icon with a specific color
   * @param {string} color - Color code: 'red', 'yellow', 'green', or 'gray'
   */
  async drawIcon(color) {
    try {
      // Create icon ImageData for multiple sizes
      const sizes = [16, 32, 48, 128];
      const imageData = {};

      for (const size of sizes) {
        const canvas = new OffscreenCanvas(size, size);
        const ctx = canvas.getContext('2d');
        this.paintStatus(ctx, size, color);
        imageData[size] = ctx.getImageData(0, 0, size, size);
      }

      // Update the extension icon (the count badge is set separately, by showCount)
      await chrome.action.setIcon({ imageData });

    } catch (error) {
      console.error('Error updating icon:', error);
    }
  },

  /**
   * The number on the toolbar icon: how many repositories are failing, or (when none are and the mode allows)
   * how many are running. Counted per monitored repository and branch, like the popup's summary.
   * @param {Object} lastResults - Results by repository id
   * @param {string} mode - 'both', 'failing' or 'off'
   * @returns {{text: string, color: string|null, title: string}}
   */
  badgeFor(lastResults, mode) {
    const results = Object.values(lastResults || {});
    const failing = results.filter((r) => r.color === 'red').length;
    const running = results.filter((r) => r.color === 'yellow').length;
    const plural = (n, what) => `${n} repositor${n === 1 ? 'y' : 'ies'} ${what}`;
    const parts = [failing ? plural(failing, 'failing') : '', running ? plural(running, 'running') : ''].filter(Boolean);
    const title = `GitHub Actions Monitor${parts.length ? `: ${parts.join(', ')}` : ''}`;
    const text = (n) => (n > 99 ? '99+' : String(n));
    if (mode === 'off') return { text: '', color: null, title };
    if (failing) return { text: text(failing), color: 'red', title };
    if (running && mode === 'both') return { text: text(running), color: 'yellow', title };
    return { text: '', color: null, title };
  },

  /** Badge colors: the status colors, with text that stays readable on each. */
  BADGE_COLORS: {
    red: { background: '#cf222e', text: '#ffffff' },
    yellow: { background: '#d4a72c', text: '#1f2328' }
  },

  /**
   * Show the count badge (and a tooltip naming what it counts) on the toolbar icon.
   * @param {Object} lastResults - Results by repository id
   * @param {string} mode - 'both', 'failing' or 'off'
   */
  async showCount(lastResults, mode) {
    const badge = this.badgeFor(lastResults, mode);
    try {
      if (badge.color) {
        const colors = this.BADGE_COLORS[badge.color];
        await chrome.action.setBadgeBackgroundColor({ color: colors.background });
        if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: colors.text });
      }
      await chrome.action.setBadgeText({ text: badge.text });
      await chrome.action.setTitle({ title: badge.title });
    } catch (error) {
      console.error('Error updating badge:', error);
    }
  },

  /**
   * Generate a colored icon as a data URL for notifications
   * @param {string} color - Color code: 'red', 'yellow', 'green', or 'gray'
   * @param {number} size - Icon size (default: 128)
   * @returns {string} Data URL of the colored icon
   */
  generateIconDataUrl(color, size = 128) {
    try {
      // Create canvas
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d');
      this.paintStatus(ctx, size, color);

      // Convert to blob then data URL
      return canvas.convertToBlob({ type: 'image/png' })
        .then(blob => {
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
        });

    } catch (error) {
      console.error('Error generating icon data URL:', error);
      // Return empty data URL as fallback
      return Promise.resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
    }
  }
};

// Make available to other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = IconManager;
}

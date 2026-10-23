// Order of the popup's repository list: your own order (drag and drop, or the arrow keys on a handle) or a sort.
// Paused repositories always follow the active ones, under their own header.

const RepoOrder = {
  MODES: ['custom', 'name', 'recent', 'status'],

  /** Running first, then failing, then passing, then everything without a result. */
  STATUS_RANK: { yellow: 0, red: 1, green: 2, gray: 3 },

  idOf(entry) {
    return typeof entry === 'string' ? entry : entry.id;
  },

  isEnabled(entry) {
    return typeof entry === 'string' ? true : entry.enabled !== false;
  },

  /** What an entry watches: repository, branch ('all' for every branch) and pinned workflow ({id, name}, or null). */
  label(entry) {
    const repo = typeof entry === 'string' ? entry.split(':')[0] : entry.repo;
    const branch = typeof entry === 'string' ? 'all' : entry.branch;
    const workflow = typeof entry === 'string' || !entry.workflow ? null : entry.workflow;
    return { repo, branch, workflow };
  },

  /** The id of a repository, branch and optional pinned workflow ("owner/repo:main", "owner/repo:main:wf123"). */
  makeId(repo, branch, workflowId = null) {
    return workflowId ? `${repo}:${branch}:wf${workflowId}` : `${repo}:${branch}`;
  },

  /** "owner/repo", "owner/repo (main)", "owner/repo (main, CI)": for confirmations and accessible names. */
  describe(entry) {
    const { repo, branch, workflow } = this.label(entry);
    const parts = [branch !== 'all' ? branch : '', workflow ? workflow.name : ''].filter(Boolean);
    return parts.length ? `${repo} (${parts.join(', ')})` : repo;
  },

  /** The newest start or update time across a result's workflows (ms), or null when nothing has run. */
  lastActivity(result) {
    if (!result) return null;
    const runs = result.workflows && result.workflows.length ? result.workflows : result.headline ? [result.headline] : [];
    let newest = null;
    for (const run of runs) {
      for (const value of [run.updatedAt, run.startedAt]) {
        const at = value ? Date.parse(value) : NaN;
        if (!Number.isNaN(at) && (newest === null || at > newest)) newest = at;
      }
    }
    return newest;
  },

  byName(a, b) {
    const x = this.label(a);
    const y = this.label(b);
    const repo = x.repo.localeCompare(y.repo, undefined, { sensitivity: 'base' });
    if (repo) return repo;
    // "All branches" before specific branches of the same repository.
    if (x.branch !== y.branch) {
      if (x.branch === 'all' || y.branch === 'all') return (x.branch === 'all' ? 0 : 1) - (y.branch === 'all' ? 0 : 1);
      return x.branch.localeCompare(y.branch, undefined, { sensitivity: 'base' });
    }
    // Every workflow before a pinned one of the same repository and branch.
    if (!x.workflow || !y.workflow) return (x.workflow ? 1 : 0) - (y.workflow ? 1 : 0);
    return x.workflow.name.localeCompare(y.workflow.name, undefined, { sensitivity: 'base' });
  },

  byRecent(a, b, results) {
    const x = this.lastActivity(results[this.idOf(a)]);
    const y = this.lastActivity(results[this.idOf(b)]);
    if (x !== y) {
      if (x === null) return 1; // never ran: last
      if (y === null) return -1;
      return y - x;
    }
    return this.byName(a, b);
  },

  /**
   * The list as displayed: active repositories, then paused ones, each group in the chosen order. "custom" keeps
   * the saved order. Never changes the input.
   * @param {Array} repos - Repository entries in their saved (custom) order
   * @param {Object} results - Last results by entry id
   * @param {string} mode - One of MODES
   */
  sort(repos, results, mode) {
    const indexed = repos.map((entry, index) => ({ entry, index }));
    const compare = (a, b) => {
      let order = 0;
      if (mode === 'name') order = this.byName(a.entry, b.entry);
      else if (mode === 'recent') order = this.byRecent(a.entry, b.entry, results);
      else if (mode === 'status') {
        const rank = (e) => this.STATUS_RANK[(results[this.idOf(e)] || {}).color] ?? this.STATUS_RANK.gray;
        order = rank(a.entry) - rank(b.entry) || this.byRecent(a.entry, b.entry, results);
      }
      return order || a.index - b.index;
    };
    const active = indexed.filter((x) => this.isEnabled(x.entry)).sort(compare);
    const paused = indexed.filter((x) => !this.isEnabled(x.entry)).sort(compare);
    return [...active, ...paused].map((x) => x.entry);
  },

  /**
   * Moves one entry next to another (a drop). Only within its group: active and paused repositories stay apart.
   * @returns {Array|null} the new order, or null when the move is not allowed or changes nothing
   */
  move(list, id, targetId, place) {
    const from = list.findIndex((e) => this.idOf(e) === id);
    const target = list.find((e) => this.idOf(e) === targetId);
    if (from < 0 || !target || id === targetId) return null;
    if (this.isEnabled(list[from]) !== this.isEnabled(target)) return null;
    const rest = list.filter((e) => this.idOf(e) !== id);
    const at = rest.indexOf(target) + (place === 'after' ? 1 : 0);
    const next = [...rest.slice(0, at), list[from], ...rest.slice(at)];
    return next.every((e, i) => e === list[i]) ? null : next;
  },

  /** Moves one entry up (-1) or down (+1) past its neighbor in the same group (keyboard reordering). */
  moveBy(list, id, delta) {
    const index = list.findIndex((e) => this.idOf(e) === id);
    const neighbor = list[index + delta];
    if (index < 0 || !neighbor) return null;
    return this.move(list, id, this.idOf(neighbor), delta < 0 ? 'before' : 'after');
  },
};

// Make available to tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RepoOrder;
}

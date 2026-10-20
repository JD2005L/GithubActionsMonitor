// GitHub API utility module
// Handles all interactions with the GitHub API

const ACTIVE_STATUSES = ['queued', 'in_progress', 'waiting', 'requested', 'pending'];
const ACTIVE_MESSAGES = { queued: 'Queued', in_progress: 'In Progress', waiting: 'Awaiting review', requested: 'Requested', pending: 'Pending' };
/** Conclusions that mean "something needs attention". */
const FAILED_CONCLUSIONS = { failure: 'Failed', timed_out: 'Timed out', startup_failure: 'Startup failure', action_required: 'Action required' };
/** Conclusions that say nothing about health (superseded, skipped by conditions): shown, but never turn a repo red. */
const NEUTRAL_CONCLUSIONS = { cancelled: 'Cancelled', skipped: 'Skipped', neutral: 'Neutral', stale: 'Stale' };
/** How many recent runs to read: enough to find the latest run of every workflow on a busy repository. */
const RUNS_PER_PAGE = 50;
/** How many past runs of each workflow the popup's history strip shows. */
const HISTORY_LENGTH = 10;
/** Conclusions whose run has jobs worth naming ("failed at Test > npm test"). */
const JOB_FAILURES = ['failure', 'timed_out'];

const GitHubAPI = {
  BASE_URL: 'https://api.github.com',

  /**
   * One workflow's latest run, reduced to what the popup shows.
   * @param {Object} run - A workflow run from the REST API
   */
  summarizeRun(run) {
    const summary = {
      workflowId: run.workflow_id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      color: 'gray',
      message: `Unknown status: ${run.status}`,
      branch: run.head_branch,
      runUrl: run.html_url,
      commitTitle: run.head_commit?.message?.split('\n')[0] || null,
      startedAt: run.run_started_at || run.created_at || null,
      updatedAt: run.updated_at || null,
      // Context for the expanded card and hover text: what triggered the run, and who.
      runId: run.id ?? null,
      runAttempt: run.run_attempt || 1,
      runNumber: run.run_number ?? null,
      event: run.event || null,
      actor: run.triggering_actor?.login || run.actor?.login || null,
      pr: run.pull_requests?.[0]?.number ?? null,
      sha: run.head_sha ? run.head_sha.slice(0, 7) : null,
      // A deployment waiting for a reviewer, or a run waiting for a maintainer to approve it (forks).
      needsReview: run.status === 'waiting' || run.conclusion === 'action_required'
    };
    if (ACTIVE_STATUSES.includes(run.status)) {
      summary.color = 'yellow';
      summary.message = ACTIVE_MESSAGES[run.status];
    } else if (run.status === 'completed') {
      if (run.conclusion === 'success') {
        summary.color = 'green';
        summary.message = 'Success';
      } else if (FAILED_CONCLUSIONS[run.conclusion]) {
        summary.color = 'red';
        summary.message = FAILED_CONCLUSIONS[run.conclusion];
      } else {
        summary.color = 'gray';
        summary.message = NEUTRAL_CONCLUSIONS[run.conclusion] || run.conclusion || 'Completed';
      }
    }
    return summary;
  },

  /**
   * Repository status from its recent runs: the latest run of EACH workflow counts, so a failing CI is not hidden
   * by a later successful deploy. Running beats failed beats succeeded; cancelled/skipped runs are shown but never
   * decide the color on their own.
   * @param {Array<Object>} runs - Workflow runs, newest first
   * @returns {{color: string, message: string, headline: Object|null, workflows: Array<Object>}}
   */
  summarizeRuns(runs, ignored = []) {
    const byWorkflow = new Map();
    for (const run of runs) {
      const key = run.workflow_id ?? run.name;
      if (!byWorkflow.has(key)) byWorkflow.set(key, []);
      byWorkflow.get(key).push(run);
    }
    const workflows = [...byWorkflow.values()].map((list) => ({
      ...this.summarizeRun(list[0]),
      // Recent runs of this workflow, oldest first (the strip reads left to right), from the same response.
      history: list.slice(0, HISTORY_LENGTH).reverse().map((run) => this.summarizeRun(run).color)
    }));
    return this.rollUp(workflows, ignored);
  },

  /**
   * The repository's color and message from its workflows. Ignored workflows (switched off in the popup) stay
   * listed but never decide the color, the counts or the headline.
   * @param {Array<Object>} workflows - Summarized workflows (summarizeRuns)
   * @param {Array<number|string>} ignored - Workflow IDs that do not count
   */
  rollUp(workflows, ignored = []) {
    const skip = new Set((ignored || []).map(String));
    const marked = workflows.map((w) => ({ ...w, ignored: skip.has(String(w.workflowId ?? w.name)) }));
    const counted = marked.filter((w) => !w.ignored);
    const pick = (color) => counted.find((w) => w.color === color) || null;
    const headline = pick('yellow') || pick('red') || pick('green') || counted[0] || null;
    if (!headline) {
      return { color: 'gray', message: marked.length ? 'All workflows ignored' : 'No runs found', headline: null, workflows: marked };
    }
    const counts = { red: 0, yellow: 0, review: 0 };
    for (const w of counted) {
      if (w.needsReview) counts.review++;
      else if (counts[w.color] !== undefined) counts[w.color]++;
    }
    let message = headline.message;
    if (counted.length > 1) {
      const parts = [];
      if (counts.yellow) parts.push(`${counts.yellow} running`);
      if (counts.red) parts.push(`${counts.red} failing`);
      if (counts.review) parts.push(`${counts.review} awaiting review`);
      message = parts.length ? parts.join(', ') : headline.color === 'green' ? `All ${counted.length} workflows passing` : headline.message;
    }
    return { color: headline.color, message, headline, workflows: marked };
  },

  /** Copies a roll-up onto a status result (the headline run's fields lead). */
  applySummary(result, summary) {
    const headline = summary.headline || {};
    result.status = headline.status || 'unknown';
    result.color = summary.color;
    result.message = summary.message;
    result.workflowName = headline.name || null;
    result.branch = headline.branch || null;
    result.runUrl = headline.runUrl || null;
    result.updatedAt = headline.updatedAt || null;
    result.startedAt = headline.startedAt || null;
    result.commitTitle = headline.commitTitle || null;
    result.workflows = summary.workflows;
    return result;
  },

  /** Rate-limit headers from any response (304s included), for the settings page. */
  readRateLimit(response) {
    const limit = parseInt(response.headers.get('X-RateLimit-Limit'), 10);
    const remaining = parseInt(response.headers.get('X-RateLimit-Remaining'), 10);
    const reset = parseInt(response.headers.get('X-RateLimit-Reset'), 10);
    if (Number.isNaN(limit) || Number.isNaN(remaining)) return null;
    return { limit, remaining, resetAt: Number.isNaN(reset) ? null : reset * 1000, checkedAt: Date.now() };
  },

  /**
   * Fetch a repository's workflow status (the latest run of each workflow).
   *
   * Requests are conditional: with a cache, the last ETag is sent as If-None-Match and an unchanged answer comes
   * back as "304 Not Modified", which GitHub does not count against the 5,000 requests/hour rate limit. That is what
   * makes 5-second fast polling safe with many repositories.
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} token - GitHub personal access token
   * @param {string} branch - Optional branch name to filter by (defaults to "all")
   * @param {{get: Function, set: Function}} [cache] - ETag cache keyed by request URL
   * @returns {Promise<Object>} Status result object
   */
  async fetchRepoStatus(owner, repo, token, branch = 'all', cache = null, ignored = []) {
    const repoKey = `${owner}/${repo}`;

    try {
      // Build URL with optional branch filter
      let url = `${this.BASE_URL}/repos/${owner}/${repo}/actions/runs?per_page=${RUNS_PER_PAGE}`;
      if (branch && branch !== 'all') {
        url += `&branch=${encodeURIComponent(branch)}`;
      }

      const cached = cache ? cache.get(url) : null;
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      if (cached && cached.etag) {
        headers['If-None-Match'] = cached.etag;
      }

      // cache: 'no-store' keeps the browser's HTTP cache out of the way; freshness comes from the ETag exchange.
      const response = await fetch(url, { headers, cache: 'no-store' });
      const rateLimit = this.readRateLimit(response);

      if (response.status === 304 && cached && cached.result) {
        // Unchanged runs, but the ignored workflows may have changed since: roll up again.
        const again = { ...cached.result, timestamp: Date.now(), rateLimit, notModified: true };
        if (again.workflows && again.workflows.length) this.applySummary(again, this.rollUp(again.workflows, ignored));
        return again;
      }

      const result = {
        repo: repoKey,
        timestamp: Date.now(),
        status: 'unknown',
        color: 'gray',
        message: 'Unknown status',
        workflowName: null,
        commitTitle: null,
        branch: null,
        runUrl: null,
        updatedAt: null,
        startedAt: null,
        workflows: [],
        rateLimit
      };

      if (response.status === 404) {
        result.message = 'Repo not found or no access';
        return result;
      }

      if (response.status === 401) {
        result.message = 'Bad token';
        return result;
      }

      if (response.status === 403) {
        const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
        const rateLimitReset = response.headers.get('X-RateLimit-Reset');

        if (rateLimitRemaining === '0') {
          const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000) : null;
          return {
            ...result,
            message: 'Rate limited',
            rateLimited: true,
            rateLimitReset: resetTime
          };
        }

        result.message = 'Access forbidden';
        return result;
      }

      if (response.status === 429) {
        return {
          ...result,
          message: 'Rate limited',
          rateLimited: true,
          rateLimitReset: new Date(Date.now() + 10 * 60 * 1000)
        };
      }

      if (!response.ok) {
        result.message = `HTTP ${response.status}`;
        return result;
      }

      const data = await response.json();

      if (!data.workflow_runs || data.workflow_runs.length === 0) {
        result.message = 'No runs found';
        this.remember(cache, url, response, result);
        return result;
      }

      this.applySummary(result, this.summarizeRuns(data.workflow_runs, ignored));

      this.remember(cache, url, response, result);
      return result;

    } catch (error) {
      return {
        repo: repoKey,
        timestamp: Date.now(),
        status: 'error',
        color: 'gray',
        message: `Error: ${error.message}`,
        workflowName: null,
        branch: null,
        runUrl: null,
        updatedAt: null
      };
    }
  },

  /** Keeps the ETag and the derived result, so the next unchanged answer can be a free 304. */
  remember(cache, url, response, result) {
    const etag = response.headers.get('ETag');
    if (cache && etag) {
      const { rateLimit, notModified, ...stored } = result;
      cache.set(url, { etag, result: stored });
    }
  },

  /**
   * Check a token: who it belongs to, what kind it is, how many repositories it can see, and whether it carries
   * more access than this extension needs.
   * @param {string} token - GitHub token to check
   * @returns {Promise<Object>} { ok, login, kind, scopes, repoCount, broad, rateLimit, error }
   */
  async testToken(token) {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    const kind = token.startsWith('github_pat_') ? 'fine-grained' : /^ghp_/.test(token) ? 'classic' : 'other';
    try {
      const userResponse = await fetch(`${this.BASE_URL}/user`, { headers, cache: 'no-store' });
      if (userResponse.status === 401) {
        return { ok: false, kind, error: 'GitHub rejected this token. It may be mistyped, expired or revoked.' };
      }
      if (!userResponse.ok) {
        return { ok: false, kind, error: `GitHub answered HTTP ${userResponse.status}.` };
      }
      const user = await userResponse.json();
      // Classic tokens report their scopes; "repo" means full read/write access to every private repository.
      const scopesHeader = userResponse.headers.get('X-OAuth-Scopes');
      const scopes = scopesHeader ? scopesHeader.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const broad = scopes.includes('repo') || scopes.includes('workflow') || scopes.includes('admin:org');

      const reposResponse = await fetch(`${this.BASE_URL}/user/repos?per_page=100&affiliation=owner,collaborator,organization_member`, { headers, cache: 'no-store' });
      let repoCount = null;
      let repoNames = [];
      if (reposResponse.ok) {
        const repos = await reposResponse.json();
        const more = /rel="next"/.test(reposResponse.headers.get('Link') || '');
        repoCount = more ? `${repos.length}+` : String(repos.length);
        repoNames = repos.map((r) => r.full_name).filter(Boolean);
      }
      return { ok: true, login: user.login, kind, scopes, broad, repoCount, repoNames, rateLimit: this.readRateLimit(reposResponse) || this.readRateLimit(userResponse) };
    } catch (error) {
      return { ok: false, kind, error: `Could not reach GitHub: ${error.message}` };
    }
  },

  /**
   * Whether a token can re-run and cancel workflow runs (Actions: Read and write), without changing anything.
   * A classic token lists its scopes: repo (or public_repo) allows it. A fine-grained token lists nothing, so it is
   * asked to cancel a run that already finished: GitHub refuses with 403 when the token lacks the permission, and
   * with 409 ("already completed") when it has it. Either way nothing is cancelled.
   * @param {string} token - GitHub token
   * @param {Object} check - testToken's result (kind, scopes, repoNames)
   * @param {Array<{repo: string, runId: number}>} finishedRuns - Known finished runs ("owner/repo"), tried first
   * @returns {Promise<'write'|'read'|null>} null when it could not tell (no finished run to ask about)
   */
  async checkRunAccess(token, check, finishedRuns = []) {
    if (check.kind === 'classic') {
      return check.scopes.some((s) => s === 'repo' || s === 'public_repo') ? 'write' : 'read';
    }
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    const path = (full) => full.split('/').map(encodeURIComponent).join('/');
    let candidates = finishedRuns.slice(0, 3);
    try {
      if (!candidates.length) {
        // Nothing monitored yet: look for one finished run in the first repositories the token can see.
        for (const full of (check.repoNames || []).slice(0, 3)) {
          const response = await fetch(`${this.BASE_URL}/repos/${path(full)}/actions/runs?status=completed&per_page=1`, { headers, cache: 'no-store' });
          if (!response.ok) continue;
          const run = ((await response.json()).workflow_runs || []).find((r) => r.status === 'completed');
          if (run) {
            candidates = [{ repo: full, runId: run.id }];
            break;
          }
        }
      }
      for (const { repo, runId } of candidates) {
        const response = await fetch(`${this.BASE_URL}/repos/${path(repo)}/actions/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', headers, cache: 'no-store' });
        if (response.status === 409) return 'write';
        if (response.status === 403) return 'read';
        // 404 (the run or repository is gone) or anything else: try the next run.
      }
    } catch {
      // Network trouble: unknown.
    }
    return null;
  },

  /**
   * Branches to offer for a repository.
   * GitHub's branch list needs "Contents: Read" on a fine-grained token for private repositories, which would also
   * let the token read code, so the read-only token this extension recommends does not have it. When the list is
   * refused, the branches that appear in the repository's recent workflow runs (Actions: Read) are offered instead:
   * those are the branches worth monitoring anyway.
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} token - GitHub personal access token
   * @returns {Promise<{branches: Array<string>, source: string}>} source: 'branches', 'runs' or 'none'
   */
  async fetchBranches(owner, repo, token) {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    const base = `${this.BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    try {
      const response = await fetch(`${base}/branches?per_page=100`, { headers });
      if (response.ok) {
        const branches = await response.json();
        return { branches: branches.map((branch) => branch.name), source: 'branches' };
      }
      const runsResponse = await fetch(`${base}/actions/runs?per_page=100`, { headers });
      if (runsResponse.ok) {
        const data = await runsResponse.json();
        const seen = [...new Set((data.workflow_runs || []).map((run) => run.head_branch).filter(Boolean))];
        if (seen.length) return { branches: seen, source: 'runs' };
      }
      return { branches: [], source: 'none' };
    } catch (error) {
      return { branches: [], source: 'none' };
    }
  },

  /**
   * Where a failed run failed: its first failed job and that job's first failed step. One request per failed run
   * (the caller caches the answer by run and attempt, so polling never repeats it).
   * @returns {Promise<{job: string, step: string|null, url: string|null}|null|undefined>} null: nothing to name;
   *   undefined: could not ask (try again on a later poll)
   */
  async fetchFailure(owner, repo, runId, token) {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    const url = `${this.BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}/jobs?filter=latest&per_page=100`;
    try {
      const response = await fetch(url, { headers, cache: 'no-store' });
      if (!response.ok) return response.status === 404 ? null : undefined;
      const data = await response.json();
      const job = (data.jobs || []).find((j) => JOB_FAILURES.includes(j.conclusion));
      if (!job) return null;
      const step = (job.steps || []).find((s) => JOB_FAILURES.includes(s.conclusion));
      return {
        job: job.name,
        step: step ? step.name : null,
        url: job.html_url || null,
        // For the error lines: which job's log, and when the failed step ran (to find its part of the log).
        jobId: job.id ?? null,
        stepStart: (step && step.started_at) || null,
        stepEnd: (step && step.completed_at) || null,
        // Every job's steps, for the step lights: how far the run got before it failed.
        jobs: this.summarizeJobs(data.jobs || [])
      };
    } catch (error) {
      return undefined;
    }
  },

  /**
   * A job or step's state for the step lights: done, failed, cancelled, skipped, running or pending.
   * @param {{status: string, conclusion: string|null}} item - A job or a step from GitHub's jobs API
   */
  stepState(item) {
    if (item.status === 'in_progress') return 'running';
    if (item.status !== 'completed') return 'pending';
    if (item.conclusion === 'success') return 'done';
    if (JOB_FAILURES.includes(item.conclusion)) return 'failed';
    if (item.conclusion === 'skipped' || item.conclusion === 'neutral') return 'skipped';
    return 'cancelled';
  },

  /**
   * Jobs and their steps, reduced to names and states for the step lights. GitHub's own "Set up job" and
   * "Complete job" bookends are left out: they say nothing about the workflow.
   * @param {Array<Object>} jobs - GitHub's jobs
   * @returns {Array<{name: string, state: string, steps: Array<{name: string, state: string}>}>}
   */
  summarizeJobs(jobs) {
    const BOOKENDS = ['Set up job', 'Complete job'];
    return jobs.slice(0, 20).map((job) => ({
      name: job.name,
      state: this.stepState(job),
      steps: (job.steps || [])
        .filter((step) => !BOOKENDS.includes(step.name))
        .slice(0, 40)
        .map((step) => ({ name: step.name, state: this.stepState(step) }))
    }));
  },

  /**
   * The jobs of a running run, for the step lights. Conditional: an unchanged answer is a free 304.
   * @param {string} owner
   * @param {string} repo
   * @param {number} runId
   * @param {string} token
   * @param {string|null} etag - The ETag of the last answer for this run
   * @returns {Promise<{jobs: Array<Object>|null, etag: string|null, notModified: boolean}|undefined>}
   *   jobs is null on a 304 (keep the last ones); undefined when GitHub could not be asked
   */
  async fetchJobs(owner, repo, runId, token, etag = null) {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (etag) headers['If-None-Match'] = etag;
    const url = `${this.BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}/jobs?filter=latest&per_page=100`;
    try {
      const response = await fetch(url, { headers, cache: 'no-store' });
      if (response.status === 304) return { jobs: null, etag, notModified: true };
      if (!response.ok) return undefined;
      const data = await response.json();
      return { jobs: this.summarizeJobs(data.jobs || []), etag: response.headers.get('ETag'), notModified: false };
    } catch (error) {
      return undefined;
    }
  },

  /**
   * The lines that say why a failed step failed, from its job's log. GitHub answers the log request with a
   * redirect to its log storage, which allows cross-origin reads, so no other host permission is needed.
   * @param {string} owner
   * @param {string} repo
   * @param {Object} failure - fetchFailure's result (jobId, stepStart, stepEnd)
   * @param {string} token
   * @returns {Promise<Array<string>|null|undefined>} lines; null when the log names nothing; undefined to retry
   */
  async fetchErrorLines(owner, repo, failure, token) {
    if (!failure || !failure.jobId) return null;
    const url = `${this.BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/jobs/${encodeURIComponent(failure.jobId)}/logs`;
    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
        cache: 'no-store'
      });
      // Logs expire (90 days by default) or the job is gone: nothing to show.
      if (response.status === 404 || response.status === 410) return null;
      if (!response.ok) return undefined;
      const lines = this.extractError(await response.text(), { start: failure.stepStart, end: failure.stepEnd });
      return lines.length ? lines : null;
    } catch (error) {
      return undefined;
    }
  },

  /**
   * Pick the lines that explain a failure out of a job log.
   * 1. The failed step's part of the log only, by the step's start and end times (each log line is timestamped).
   * 2. Errors the step reported itself (::error / ##[error]), except the generic "Process completed with exit
   *    code N", which says nothing.
   * 3. Otherwise the lines that read like a failure: exceptions and errors ("SqlException : ...",
   *    "TypeError: ..."), failed tests ("Failed X", "FAIL x", "● x", "✕ x"), expected/received, compiler errors,
   *    npm ERR!. A few lines after each, up to a stack trace.
   * 4. Otherwise the last lines before the step gave up.
   * @param {string} text - The job log
   * @param {{start?: string, end?: string}} window - The failed step's start and end times
   * @returns {Array<string>} At most 6 lines, each at most 220 characters
   */
  extractError(text, window = {}) {
    const STAMP = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ?/;
    const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
    const TOOL = /^\s*\[[\w. -]+ \d\d:\d\d:\d\d(?:\.\d+)?\]\s*/; // "[xUnit.net 00:00:27.19] "
    const EXIT = /^Process completed with exit code \d+\.?$/;
    const NOISE = /^\s*(?:##\[(?!error)|\[command\]|Error Message:?\s*$|Stack Trace:?\s*$|Post job cleanup)/;
    const STACK = /^\s*(?:at\s|Stack Trace:|--- End of|File "|Traceback \()/;
    const MARK = /[\w.]*(?:Exception|Error)\b\s*:|^\s*(?:Failed|FAIL|FAILED)\s+\S|^\s*(?:●|✕|×|✗)\s|\bAssert\w*\b.*\b(?:Expected|failed)|^\s*(?:Expected|Received|Actual)\b\s*[:(]|npm ERR!|\berror\s+[A-Z]{1,4}\d{2,5}\s*:|^\s*error(?:\[[\w-]+\])?:/i;
    const clip = (line) => (line.length > 220 ? `${line.slice(0, 219)}…` : line);

    const start = window.start ? Date.parse(window.start) - 1000 : NaN;
    const end = window.end ? Date.parse(window.end) + 1000 : NaN;
    const all = [];
    const step = [];
    let inside = true;
    for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const m = STAMP.exec(raw);
      if (m) {
        const t = Date.parse(m[1]);
        inside = !(t < start) && !(t > end);
      }
      const line = (m ? raw.slice(m[0].length) : raw).replace(ANSI, '').replace(TOOL, '').trimEnd();
      all.push(line);
      if (inside) step.push(line);
    }
    // A step window that matched nothing (clock skew): use the whole log.
    const lines = step.some((l) => l.trim()) ? step : all;

    const errors = [];
    for (const line of lines) {
      const m = /^\s*##\[error\](.*)$/.exec(line);
      if (m && m[1].trim() && !EXIT.test(m[1].trim())) errors.push(m[1].trim());
    }
    const unique = (list) => [...new Set(list.map((l) => l.trim()).filter(Boolean))];
    if (errors.length) return unique(errors).slice(0, 6).map(clip);

    const picked = [];
    for (let i = 0; i < lines.length && picked.length < 6; i++) {
      if (NOISE.test(lines[i]) || STACK.test(lines[i]) || !MARK.test(lines[i])) continue;
      picked.push(lines[i]);
      for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
        if (!lines[j].trim() || STACK.test(lines[j]) || /^\s*##\[/.test(lines[j])) break;
        if (!NOISE.test(lines[j])) picked.push(lines[j]);
        i = j;
      }
    }
    if (picked.length) return unique(picked).slice(0, 6).map(clip);

    const exitAt = lines.findIndex((l) => /^\s*##\[error\]/.test(l));
    const before = (exitAt >= 0 ? lines.slice(0, exitAt) : lines).filter((l) => l.trim() && !NOISE.test(l) && !/^\s*##\[/.test(l));
    return unique(before.slice(-5)).map(clip);
  },

  /** Run controls (optional; the token needs Actions: Read and write). */
  RUN_ACTIONS: {
    rerun: { path: 'rerun-failed-jobs', done: 'Re-running the failed jobs' },
    cancel: { path: 'cancel', done: 'Cancelling the run' }
  },

  /**
   * Re-run a run's failed jobs, or cancel a running run.
   * @param {'rerun'|'cancel'} action
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  async runAction(owner, repo, runId, action, token) {
    const spec = this.RUN_ACTIONS[action];
    if (!spec) return { ok: false, message: 'Unknown action' };
    const url = `${this.BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}/${spec.path}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        cache: 'no-store'
      });
      if (response.ok) return { ok: true, message: spec.done };
      if (response.status === 403 || response.status === 404) {
        // denied: the token lacks Actions: Read and write (Settings then shows how to add it).
        return { ok: false, denied: true, message: 'The token cannot do this: it needs Actions: Read and write (Settings, Setup, Connect GitHub shows how to add it).' };
      }
      if (response.status === 409) {
        return { ok: false, message: action === 'cancel' ? 'The run already finished.' : 'The run cannot be re-run right now.' };
      }
      return { ok: false, message: `GitHub answered HTTP ${response.status}.` };
    } catch (error) {
      return { ok: false, message: `Could not reach GitHub: ${error.message}` };
    }
  },

  /** First path segments on github.com that are not repository owners. */
  RESERVED_PATHS: ['settings', 'orgs', 'organizations', 'notifications', 'marketplace', 'explore', 'topics', 'sponsors', 'login', 'new', 'apps', 'features', 'pulls', 'issues', 'search', 'codespaces', 'collections', 'trending', 'enterprise', 'about', 'pricing', 'security', 'site', 'users', 'account', 'dashboard'],

  /**
   * The repository a github.com address points at, for "Add this repository" in the popup.
   * @param {string} url - A tab's address
   * @returns {{owner: string, repo: string, branch: string|null}|null} branch: the /tree/<branch> part, if any
   */
  repoFromUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      return null;
    }
    if (parsed.hostname !== 'github.com') return null;
    const [owner, repo, kind, ...rest] = parsed.pathname.split('/').filter(Boolean);
    if (!owner || !repo || !this.OWNER_PATTERN.test(owner) || this.RESERVED_PATHS.includes(owner.toLowerCase())) return null;
    if (!/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
    // Branch names can contain slashes, so the whole remainder after /tree/ is the candidate.
    let branch = null;
    if (kind === 'tree' && rest.length) {
      try {
        branch = decodeURIComponent(rest.join('/'));
      } catch (error) {
        branch = null;
      }
    }
    return { owner, repo: repo.replace(/\.git$/, ''), branch };
  },

  /** A valid GitHub user or organization name. */
  OWNER_PATTERN: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,

  /** The repositories this token can reach (owned, collaborations, organizations), kept for the popup's lifetime. */
  accessibleCache: null,

  /**
   * Read every page of a list endpoint (100 per page, following GitHub's Link header).
   * @returns {Promise<{status: number, items: Array}>} status of the first page; items from all pages read
   */
  async fetchAllPages(url, token, maxPages = 10) {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    const items = [];
    let next = url;
    let status = 0;
    for (let page = 0; next && page < maxPages; page++) {
      const response = await fetch(next, { headers });
      if (page === 0) status = response.status;
      if (!response.ok) break;
      items.push(...(await response.json()));
      const link = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('Link') || '');
      next = link ? link[1] : null;
    }
    return { status, items };
  },

  /**
   * Every repository of one owner (user or organization) that this token can see, for the popup's picker.
   * Two sources, merged: the owner's own listing (all of its public repositories, and an organization's private
   * ones the token may read) and the token's accessible repositories filtered to that owner (a user's private
   * repositories and collaborations, which no per-owner listing returns).
   * @param {string} owner - User or organization name
   * @param {string} token - GitHub token
   * @returns {Promise<Object>} { ok, owner (GitHub's spelling), repos: [{ name, fullName, isPrivate, archived, description }], error }
   */
  async listOwnerRepos(owner, token) {
    if (!this.OWNER_PATTERN.test(owner)) {
      return { ok: false, repos: [], error: 'That is not a valid GitHub user or organization name.' };
    }
    try {
      if (!this.accessibleCache || this.accessibleCache.token !== token) {
        const accessible = await this.fetchAllPages(`${this.BASE_URL}/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=full_name`, token);
        if (accessible.status === 401) {
          return { ok: false, repos: [], error: 'GitHub rejected the token. Check it in Settings.' };
        }
        this.accessibleCache = { token, repos: accessible.items };
      }
      const lower = owner.toLowerCase();
      const mine = this.accessibleCache.repos.filter((r) => r.owner && r.owner.login.toLowerCase() === lower);
      const listing = await this.fetchAllPages(`${this.BASE_URL}/users/${encodeURIComponent(owner)}/repos?per_page=100&type=owner&sort=full_name`, token);
      if (listing.status === 404 && mine.length === 0) {
        return { ok: false, repos: [], error: `No GitHub user or organization named "${owner}".` };
      }
      const byName = new Map();
      for (const repo of [...mine, ...listing.items]) {
        if (byName.has(repo.full_name)) continue;
        byName.set(repo.full_name, {
          name: repo.name,
          fullName: repo.full_name,
          isPrivate: !!repo.private,
          archived: !!repo.archived,
          description: repo.description || ''
        });
      }
      const repos = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      const spelled = repos.length ? repos[0].fullName.split('/')[0] : owner;
      return { ok: true, owner: spelled, repos };
    } catch (error) {
      return { ok: false, repos: [], error: `Could not reach GitHub: ${error.message}` };
    }
  },

  /**
   * Map status result to a color code
   * @param {Object} result - Status result from fetchRepoStatus
   * @returns {string} Color code: 'green', 'yellow', 'red', 'gray'
   */
  getStatusColor(result) {
    return result.color || 'gray';
  }
};

// Make available to other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GitHubAPI;
}

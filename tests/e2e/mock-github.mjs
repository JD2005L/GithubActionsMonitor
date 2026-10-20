// A small GitHub REST API for the browser tests and store screenshots: the endpoints the extension uses, with
// ETags and 304s (like GitHub, a conditional hit does not count against the rate limit), rate-limit headers and
// per-test control of workflow runs.

const iso = (ms) => new Date(ms).toISOString();

export class MockGitHub {
  constructor({ login = 'octo-dev', repos = {}, now = () => Date.now() } = {}) {
    this.login = login;
    /**
     * "owner/name" -> { private, archived, foreign, branchesForbidden, description, branches: [], runs: [run] } (runs newest first).
     * foreign: someone else's public repository, not in the token's own listing.
     */
    this.repos = repos;
    this.now = now;
    this.token = 'github_pat_11MOCKTOKEN0000000000_mockmockmockmockmockmockmockmockmockmockmockmockmockmo';
    this.tokenKind = 'fine-grained'; // or 'classic' (classic tokens report X-OAuth-Scopes)
    this.rateLimit = 5000;
    this.rateUsed = 0;
    /** Every request: { method, path, status, conditional } */
    this.log = [];
    /** Whether the token may re-run and cancel (Actions: Read and write). */
    this.canWrite = false;
  }

  /** A workflow run in GitHub's REST shape. */
  /**
   * A workflow run. failedAt: { job, step, log? } (log: the failed job's log text). progress (a running run):
   * [{ job, steps: [[name, state], ...] }] with states done, running, pending, failed, skipped.
   */
  static run({ id, workflowId, name, status = 'completed', conclusion = 'success', branch = 'main', title = 'Update', startedAgoSec = 600, durationSec = 120, owner, repo, actor = 'octo-dev', event = 'push', pr = null, failedAt = null, progress = null }) {
    return { id, workflowId, name, status, conclusion, branch, title, startedAgoSec, durationSec, owner, repo, actor, event, pr, failedAt, progress };
  }

  /** A run whose failed job has this id, with its repository. */
  findFailedJob(id) {
    for (const [full, repo] of Object.entries(this.repos)) {
      const r = (repo.runs || []).find((x) => x.failedAt && String(x.id * 10 + 2) === String(id));
      if (r) return { full, r };
    }
    return null;
  }

  /** A run by id. */
  findRun(fullName, id) {
    return (this.repos[fullName]?.runs || []).find((r) => String(r.id) === String(id)) || null;
  }

  setRuns(fullName, runs) {
    this.repos[fullName].runs = runs;
  }

  json(status, body, extra = {}) {
    return { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra }, body: JSON.stringify(body) };
  }

  rateHeaders(counted) {
    if (counted) this.rateUsed++;
    return {
      'x-ratelimit-limit': String(this.rateLimit),
      'x-ratelimit-remaining': String(Math.max(0, this.rateLimit - this.rateUsed)),
      'x-ratelimit-used': String(this.rateUsed),
      'x-ratelimit-reset': String(Math.floor(this.now() / 1000) + 3600),
    };
  }

  etag(body) {
    let h = 2166136261;
    for (let i = 0; i < body.length; i++) h = Math.imul(h ^ body.charCodeAt(i), 16777619);
    return `"${(h >>> 0).toString(16)}"`;
  }

  apiRun(fullName, r) {
    const [owner, repo] = fullName.split('/');
    const started = this.now() - r.startedAgoSec * 1000;
    const done = r.status === 'completed';
    return {
      id: r.id,
      name: r.name,
      workflow_id: r.workflowId,
      head_branch: r.branch,
      status: r.status,
      conclusion: done ? r.conclusion : null,
      html_url: `https://github.com/${owner}/${repo}/actions/runs/${r.id}`,
      run_started_at: iso(started),
      created_at: iso(started - 2000),
      updated_at: iso(done ? started + r.durationSec * 1000 : this.now() - 3000),
      head_commit: { message: `${r.title}\n\nDetails of the change.` },
      head_sha: `${String(r.id).padStart(7, '0')}abcdef0123456789`,
      run_number: r.id,
      run_attempt: r.attempt ?? 1,
      event: r.pr ? 'pull_request' : r.event,
      actor: { login: r.actor },
      triggering_actor: { login: r.actor },
      pull_requests: r.pr ? [{ number: r.pr }] : [],
    };
  }

  /** The jobs of a run; a run created with failedAt: { job, step } has that job and step failed. */
  apiJobs(fullName, r) {
    const [owner, repo] = fullName.split('/');
    const url = (job) => `https://github.com/${owner}/${repo}/actions/runs/${r.id}/job/${job}`;
    if (r.progress) {
      const STATES = { done: ['completed', 'success'], failed: ['completed', 'failure'], skipped: ['completed', 'skipped'], running: ['in_progress', null], pending: ['queued', null] };
      const jobs = r.progress.map((p, i) => {
        const steps = [['Set up job', 'done'], ...p.steps].map(([name, state], n) => ({ name, number: n + 1, status: STATES[state][0], conclusion: STATES[state][1] }));
        const running = steps.some((s) => s.status === 'in_progress');
        const allDone = steps.every((s) => s.status === 'completed');
        return { id: r.id * 10 + 1 + i, name: p.job, status: running ? 'in_progress' : allDone ? 'completed' : 'queued', conclusion: allDone ? 'success' : null, html_url: url(r.id * 10 + 1 + i), steps };
      });
      return { total_count: jobs.length, jobs };
    }
    const jobs = [{ id: r.id * 10 + 1, name: 'Build', status: 'completed', conclusion: 'success', html_url: url(r.id * 10 + 1), steps: [{ name: 'Checkout', status: 'completed', conclusion: 'success' }] }];
    if (r.failedAt) {
      jobs.push({
        id: r.id * 10 + 2,
        name: r.failedAt.job,
        status: 'completed',
        conclusion: 'failure',
        html_url: url(r.id * 10 + 2),
        steps: [{ name: 'Checkout', status: 'completed', conclusion: 'success' }, { name: r.failedAt.step, status: 'completed', conclusion: 'failure' }, { name: 'Upload', status: 'completed', conclusion: 'skipped' }],
      });
    }
    return { total_count: jobs.length, jobs };
  }

  /** A repository in GitHub's REST list shape. */
  apiRepo(fullName) {
    const [owner, name] = fullName.split('/');
    const r = this.repos[fullName];
    return { name, full_name: fullName, owner: { login: owner }, private: !!r.private, archived: !!r.archived, description: r.description ?? null };
  }

  /** Handles one request; returns { status, headers, body }. */
  handle(url, headers, method = 'GET') {
    const u = new URL(url);
    const path = u.pathname;
    const auth = headers.authorization ?? headers.Authorization ?? '';
    const inm = headers['if-none-match'] ?? headers['If-None-Match'] ?? null;
    let res;
    if (auth !== `Bearer ${this.token}`) {
      res = this.json(401, { message: 'Bad credentials' }, this.rateHeaders(false));
    } else if (path === '/rate_limit') {
      res = this.json(200, { resources: { core: { limit: this.rateLimit, remaining: this.rateLimit - this.rateUsed, used: this.rateUsed } } }, this.rateHeaders(false));
    } else if (path === '/user') {
      res = this.json(200, { login: this.login, id: 1 }, { ...this.rateHeaders(true), ...(this.tokenKind === 'classic' ? { 'x-oauth-scopes': 'repo, workflow' } : {}) });
    } else if (path === '/user/repos') {
      // Everything the token can reach (private included), like GitHub's own listing for the token.
      res = this.json(200, Object.keys(this.repos).filter((full) => !this.repos[full].foreign).map((full) => this.apiRepo(full)), this.rateHeaders(true));
    } else if (/^\/users\/[^/]+\/repos$/.test(path)) {
      // One owner's public repositories; 404 for an owner that does not exist.
      const owner = decodeURIComponent(path.split('/')[2]).toLowerCase();
      const owned = Object.keys(this.repos).filter((full) => full.split('/')[0].toLowerCase() === owner);
      if (!owned.length && owner !== this.login.toLowerCase()) res = this.json(404, { message: 'Not Found' }, this.rateHeaders(true));
      else res = this.json(200, owned.filter((full) => !this.repos[full].private).map((full) => this.apiRepo(full)), this.rateHeaders(true));
    } else if (/^\/repos\/[^/]+\/[^/]+\/actions\/runs\/\d+\/(jobs|rerun-failed-jobs|cancel)$/.test(path)) {
      const [, , owner, name, , , id, what] = path.split('/');
      const full = `${owner}/${name}`;
      const r = this.findRun(full, id);
      if (!r) res = this.json(404, { message: 'Not Found' }, this.rateHeaders(true));
      else if (what === 'jobs') {
        // Conditional like GitHub: the same answer again is a free 304.
        const body = JSON.stringify(this.apiJobs(full, r));
        const etag = `W/"${Buffer.from(body).toString('base64').slice(-24)}"`;
        const inm = headers['if-none-match'] ?? headers['If-None-Match'] ?? null;
        res = inm === etag ? { status: 304, headers: { etag, ...this.rateHeaders(false) }, body: '' } : { ...this.json(200, JSON.parse(body), { etag, ...this.rateHeaders(true) }) };
      }
      else if (method !== 'POST') res = this.json(404, { message: 'Not Found' }, this.rateHeaders(true));
      else if (!this.canWrite) res = this.json(403, { message: 'Resource not accessible by personal access token' }, this.rateHeaders(true));
      else if (what === 'cancel') {
        if (r.status === 'completed') res = this.json(409, { message: 'Cannot cancel a workflow run that is completed.' }, this.rateHeaders(true));
        else {
          Object.assign(r, { status: 'completed', conclusion: 'cancelled' });
          res = this.json(202, {}, this.rateHeaders(true));
        }
      } else {
        Object.assign(r, { status: 'queued', conclusion: null, failedAt: null, attempt: (r.attempt ?? 1) + 1, startedAgoSec: 1 });
        res = this.json(201, {}, this.rateHeaders(true));
      }
    } else if (/^\/repos\/[^/]+\/[^/]+\/actions\/jobs\/\d+\/logs$/.test(path)) {
      // GitHub redirects to its log storage; the mock answers with the text directly.
      const found = this.findFailedJob(path.split('/')[6]);
      if (!found || !found.r.failedAt.log) res = this.json(404, { message: 'Not Found' }, this.rateHeaders(true));
      else res = { status: 200, headers: { 'content-type': 'text/plain', ...this.rateHeaders(true) }, body: found.r.failedAt.log };
    } else {
      const m = /^\/repos\/([^/]+)\/([^/]+)\/(branches|actions\/runs)$/.exec(path);
      const repo = m ? this.repos[`${m[1]}/${m[2]}`] : null;
      if (!repo) {
        res = this.json(404, { message: 'Not Found' }, this.rateHeaders(true));
      } else if (m[3] === 'branches' && repo.branchesForbidden) {
        // A fine-grained token without "Contents: Read" on a private repository.
        res = this.json(403, { message: 'Resource not accessible by personal access token' }, this.rateHeaders(true));
      } else if (m[3] === 'branches') {
        res = this.json(200, (repo.branches ?? ['main']).map((name) => ({ name })), this.rateHeaders(true));
      } else {
        const branch = u.searchParams.get('branch');
        const perPage = Math.min(100, Number(u.searchParams.get('per_page') ?? 30));
        const runs = repo.runs.filter((r) => !branch || r.branch === branch).slice(0, perPage);
        const body = JSON.stringify({ total_count: runs.length, workflow_runs: runs.map((r) => this.apiRun(`${m[1]}/${m[2]}`, r)) });
        // Like GitHub, the ETag covers the body. A matching conditional request is a free 304.
        const tag = this.etag(body.replace(/"updated_at":"[^"]+"/g, '').replace(/"run_started_at":"[^"]+"/g, '').replace(/"created_at":"[^"]+"/g, ''));
        if (inm && inm.replace(/^W\//, '') === tag) res = { status: 304, headers: { etag: tag, ...this.rateHeaders(false) }, body: '' };
        else res = { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `W/${tag}`, ...this.rateHeaders(true) }, body };
      }
    }
    this.log.push({ method, path, status: res.status, conditional: !!inm });
    return res;
  }
}

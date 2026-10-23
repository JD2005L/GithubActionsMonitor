// Unit tests for the status logic in github-api.js, loaded the way the extension loads it (a classic script).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(join(import.meta.dirname, '..', '..', 'github-api.js'), 'utf8');
function load(fetchImpl) {
  const context = vm.createContext({ fetch: fetchImpl, console, Date, URL, Map });
  vm.runInContext(`${source}\nthis.GitHubAPI = GitHubAPI;`, context);
  return context.GitHubAPI;
}
const GitHubAPI = load(() => {
  throw new Error('no network in this test');
});

let id = 0;
const run = (workflowId, status, conclusion = null, extra = {}) => ({
  id: ++id,
  workflow_id: workflowId,
  name: `WF${workflowId}`,
  status,
  conclusion,
  head_branch: 'main',
  html_url: `https://github.com/o/r/actions/runs/${id}`,
  run_started_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:02:00Z',
  head_commit: { message: 'Fix login\n\nbody' },
  ...extra,
});

describe('summarizeRuns', () => {
  it('a failing CI is not hidden by a later successful deploy', () => {
    // Newest first: deploy (success) ran after CI (failure) on the same commit.
    const s = GitHubAPI.summarizeRuns([run(2, 'completed', 'success'), run(1, 'completed', 'failure')]);
    assert.equal(s.color, 'red');
    assert.equal(s.headline.name, 'WF1');
    assert.equal(s.message, '1 failing');
    assert.equal(s.workflows.length, 2);
  });

  it('only the latest run of each workflow counts (a fixed workflow turns green)', () => {
    const s = GitHubAPI.summarizeRuns([run(1, 'completed', 'success'), run(1, 'completed', 'failure')]);
    assert.equal(s.color, 'green');
    assert.equal(s.workflows.length, 1);
  });

  it('running beats failed beats succeeded, and counts both', () => {
    const s = GitHubAPI.summarizeRuns([run(1, 'in_progress'), run(2, 'completed', 'failure'), run(3, 'completed', 'success')]);
    assert.equal(s.color, 'yellow');
    assert.equal(s.headline.message, 'In Progress');
    assert.equal(s.message, '1 running, 1 failing');
  });

  it('all passing says so', () => {
    const s = GitHubAPI.summarizeRuns([run(1, 'completed', 'success'), run(2, 'completed', 'success')]);
    assert.equal(s.color, 'green');
    assert.equal(s.message, 'All 2 workflows passing');
  });

  it('cancelled and skipped runs never turn a repository red', () => {
    const s = GitHubAPI.summarizeRuns([run(1, 'completed', 'cancelled'), run(2, 'completed', 'success')]);
    assert.equal(s.color, 'green');
    const only = GitHubAPI.summarizeRuns([run(1, 'completed', 'skipped')]);
    assert.equal(only.color, 'gray');
    assert.equal(only.workflows[0].message, 'Skipped');
  });

  it('maps every failing conclusion to red with a readable message', () => {
    for (const [conclusion, message] of [['failure', 'Failed'], ['timed_out', 'Timed out'], ['startup_failure', 'Startup failure'], ['action_required', 'Action required']]) {
      const s = GitHubAPI.summarizeRuns([run(1, 'completed', conclusion)]);
      assert.equal(s.color, 'red', conclusion);
      assert.equal(s.message, message);
    }
  });

  it('keeps commit title and timing for the popup', () => {
    const w = GitHubAPI.summarizeRuns([run(1, 'completed', 'success')]).workflows[0];
    assert.equal(w.commitTitle, 'Fix login');
    assert.equal(w.startedAt, '2026-10-01T10:00:00Z');
    assert.equal(w.updatedAt, '2026-10-01T10:02:00Z');
  });

  it('no runs is gray', () => {
    assert.equal(GitHubAPI.summarizeRuns([]).color, 'gray');
  });
});

describe('fetchRepoStatus conditional requests', () => {
  const headers = (h) => ({ get: (name) => h[name.toLowerCase()] ?? null });
  it('sends the stored ETag and serves a 304 from the cache', async () => {
    const calls = [];
    const api = load(async (url, init) => {
      calls.push({ url, inm: init.headers['If-None-Match'] ?? null });
      if (init.headers['If-None-Match'] === 'W/"abc"') return { status: 304, ok: false, headers: headers({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990' }) };
      return {
        status: 200,
        ok: true,
        headers: headers({ etag: 'W/"abc"', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990' }),
        json: async () => ({ workflow_runs: [run(1, 'completed', 'success')] }),
      };
    });
    const store = new Map();
    const cache = { get: (u) => store.get(u) ?? null, set: (u, e) => store.set(u, e) };
    const first = await api.fetchRepoStatus('o', 'r', 't', 'all', cache);
    assert.equal(first.color, 'green');
    assert.equal(first.notModified, undefined);
    const second = await api.fetchRepoStatus('o', 'r', 't', 'all', cache);
    assert.equal(second.notModified, true);
    assert.equal(second.color, 'green');
    assert.equal(second.workflows.length, 1);
    assert.deepEqual(calls.map((c) => c.inm), [null, 'W/"abc"']);
    assert.ok(!calls[0].url.includes('_t='), 'no cache-busting parameter');
    assert.equal(second.rateLimit.remaining, 4990);
  });
});

describe('listOwnerRepos', () => {
  const repo = (full, extra = {}) => ({ name: full.split('/')[1], full_name: full, owner: { login: full.split('/')[0] }, private: false, archived: false, description: null, ...extra });
  const reply = (status, body, link) => ({ ok: status < 300, status, json: async () => body, headers: { get: (h) => (h === 'Link' ? link ?? null : null) } });

  it('merges the token’s private repositories with the owner’s public listing, across pages, sorted by name', async () => {
    const calls = [];
    const api = load(async (url) => {
      calls.push(url);
      if (url.includes('/user/repos') && !url.includes('page=2')) return reply(200, [repo('me/zeta', { private: true }), repo('other/x')], '<https://api.github.com/user/repos?page=2>; rel="next"');
      if (url.includes('/user/repos')) return reply(200, [repo('ME/alpha', { private: true })]);
      if (url.includes('/users/me/repos')) return reply(200, [repo('me/beta'), repo('me/zeta', { private: true })]);
      throw new Error(`unexpected ${url}`);
    });
    const result = await api.listOwnerRepos('me', 'tok');
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.repos.map((r) => [r.fullName, r.isPrivate]))), [['ME/alpha', true], ['me/beta', false], ['me/zeta', true]]);
    // The token's listing is read once per popup, whichever owner is chosen next.
    await api.listOwnerRepos('other', 'tok');
    assert.equal(calls.filter((u) => u.includes('/user/repos')).length, 2);
  });

  it('says when an owner does not exist, and rejects invalid names without asking GitHub', async () => {
    const api = load(async (url) => (url.includes('/user/repos') ? reply(200, []) : reply(404, { message: 'Not Found' })));
    const missing = await api.listOwnerRepos('nobody', 'tok');
    assert.equal(missing.ok, false);
    assert.match(missing.error, /No GitHub user or organization named "nobody"/);
    const invalid = await api.listOwnerRepos('bad/name', 'tok');
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /not a valid/);
  });
});

describe('pinned workflows', () => {
  const reply = (body) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body });

  it('reads only the pinned workflow’s runs, from its own endpoint, on the chosen branch', async () => {
    const calls = [];
    const api = load(async (url) => {
      calls.push(url);
      return reply({ workflow_runs: [run(7, 'completed', 'failure'), run(7, 'completed', 'success')] });
    });
    const result = await api.fetchRepoStatus('o', 'r', 't', 'main', null, [], 7);
    assert.equal(calls[0], 'https://api.github.com/repos/o/r/actions/workflows/7/runs?per_page=10&branch=main');
    assert.equal(result.color, 'red');
    assert.equal(result.workflows.length, 1);
  });

  it('lists a repository’s active workflows by name for the add form', async () => {
    const api = load(async () => reply({
      workflows: [
        { id: 3, name: 'Release', path: '.github/workflows/release.yml', state: 'active' },
        { id: 1, name: 'ci', path: '.github/workflows/ci.yml', state: 'active' },
        { id: 2, name: 'Old', path: '.github/workflows/old.yml', state: 'disabled_manually' },
      ],
    }));
    const workflows = await api.listWorkflows('o', 'r', 't');
    assert.deepEqual(JSON.parse(JSON.stringify(workflows)), [{ id: 1, name: 'ci', path: '.github/workflows/ci.yml' }, { id: 3, name: 'Release', path: '.github/workflows/release.yml' }]);
    const failing = load(async () => ({ ok: false, status: 403 }));
    assert.equal(await failing.listWorkflows('o', 'r', 't'), null);
  });
});

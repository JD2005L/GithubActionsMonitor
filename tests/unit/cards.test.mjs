// Unit tests for what the compact cards show: history, reviews, run context, ignored workflows, failed steps,
// run controls and "this tab" (github-api.js, loaded the way the extension loads it: a classic script).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(join(import.meta.dirname, '..', '..', 'github-api.js'), 'utf8');
function load(fetchImpl) {
  const context = vm.createContext({ fetch: fetchImpl, console, Date, URL, Map, Set });
  vm.runInContext(`${source}\nthis.GitHubAPI = GitHubAPI;`, context);
  return context.GitHubAPI;
}
const GitHubAPI = load(() => {
  throw new Error('no network in this test');
});
// Values from the vm context have its own prototypes: compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });

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

describe('history, review, context and ignored workflows', () => {
  it('keeps each workflow’s recent runs, oldest first, from the same response', () => {
    const s = GitHubAPI.summarizeRuns([run(1, 'in_progress'), run(2, 'completed', 'success'), run(1, 'completed', 'success'), run(1, 'completed', 'failure')]);
    assert.deepEqual(plain(s.workflows.find((w) => w.workflowId === 1).history), ['red', 'green', 'yellow']);
    assert.deepEqual(plain(s.workflows.find((w) => w.workflowId === 2).history), ['green']);
  });

  it('keeps at most ten runs of history', () => {
    const runs = Array.from({ length: 14 }, () => run(1, 'completed', 'success'));
    assert.equal(GitHubAPI.summarizeRuns(runs).workflows[0].history.length, 10);
  });

  it('marks runs waiting for a review or an approval', () => {
    const s = GitHubAPI.summarizeRuns([run(1, 'waiting'), run(2, 'in_progress')]);
    assert.equal(s.color, 'yellow');
    assert.equal(s.message, '1 running, 1 awaiting review');
    assert.equal(s.workflows[0].needsReview, true);
    assert.equal(s.workflows[0].message, 'Awaiting review');
    assert.equal(GitHubAPI.summarizeRun(run(3, 'completed', 'action_required')).needsReview, true);
    assert.equal(GitHubAPI.summarizeRun(run(3, 'completed', 'failure')).needsReview, false);
  });

  it('carries what triggered a run: pull request, who, event, commit, attempt', () => {
    const w = GitHubAPI.summarizeRun(run(1, 'completed', 'success', { event: 'pull_request', triggering_actor: { login: 'maya' }, actor: { login: 'bot' }, pull_requests: [{ number: 7 }], head_sha: 'abcdef1234567', run_attempt: 2 }));
    assert.deepEqual([w.event, w.actor, w.pr, w.sha, w.runAttempt], ['pull_request', 'maya', 7, 'abcdef1', 2]);
  });

  it('ignored workflows stay listed but never decide the color, the counts or the headline', () => {
    const runs = [run(2, 'completed', 'success'), run(1, 'completed', 'failure')];
    const counted = GitHubAPI.summarizeRuns(runs);
    assert.equal(counted.color, 'red');
    const ignoring = GitHubAPI.summarizeRuns(runs, ['1']);
    assert.equal(ignoring.color, 'green');
    assert.equal(ignoring.message, 'Success');
    assert.equal(ignoring.headline.workflowId, 2);
    assert.deepEqual(plain(ignoring.workflows.map((w) => [w.workflowId, w.ignored])), [[2, false], [1, true]]);
    // Numbers and strings both match (storage keeps strings).
    assert.equal(GitHubAPI.rollUp(counted.workflows, [1]).color, 'green');
    const none = GitHubAPI.rollUp(counted.workflows, ['1', '2']);
    assert.equal(none.color, 'gray');
    assert.equal(none.message, 'All workflows ignored');
  });

  it('an unchanged (304) answer is rolled up again with the current ignored list', async () => {
    const runs = [run(2, 'completed', 'success'), run(1, 'completed', 'failure')];
    const store = new Map();
    const cache = { get: (url) => store.get(url) || null, set: (url, entry) => store.set(url, entry) };
    const headers = (etag) => ({ get: (h) => ({ ETag: etag, 'X-RateLimit-Limit': '5000', 'X-RateLimit-Remaining': '4999' })[h] ?? null });
    const api = load(async (url, init) =>
      init.headers['If-None-Match'] ? { ok: false, status: 304, headers: headers('"a"') } : { ok: true, status: 200, headers: headers('"a"'), json: async () => ({ workflow_runs: runs }) },
    );
    assert.equal((await api.fetchRepoStatus('o', 'r', 'tok', 'all', cache)).color, 'red');
    const again = await api.fetchRepoStatus('o', 'r', 'tok', 'all', cache, ['1']);
    assert.equal(again.notModified, true);
    assert.equal(again.color, 'green');
  });
});

describe('fetchFailure', () => {
  it('names the first failed job and its first failed step', async () => {
    const jobs = {
      jobs: [
        { name: 'Build', status: 'completed', conclusion: 'success', steps: [] },
        {
          id: 2,
          name: 'Test',
          status: 'completed',
          conclusion: 'failure',
          html_url: 'https://x/job/2',
          steps: [
            { name: 'Set up job', status: 'completed', conclusion: 'success' },
            { name: 'Setup', status: 'completed', conclusion: 'success' },
            { name: 'npm test', status: 'completed', conclusion: 'failure', started_at: '2026-10-13T01:35:57Z', completed_at: '2026-10-13T01:39:47Z' },
            { name: 'Upload', status: 'completed', conclusion: 'skipped' },
          ],
        },
      ],
    };
    let calledUrl = null;
    const api = load(async (url) => {
      calledUrl = url;
      return reply(200, jobs);
    });
    assert.deepEqual(plain(await api.fetchFailure('o', 'r', 5, 'tok')), {
      job: 'Test',
      step: 'npm test',
      url: 'https://x/job/2',
      jobId: 2,
      stepStart: '2026-10-13T01:35:57Z',
      stepEnd: '2026-10-13T01:39:47Z',
      // The step lights, without GitHub's own "Set up job".
      jobs: [
        { name: 'Build', state: 'done', steps: [] },
        { name: 'Test', state: 'failed', steps: [{ name: 'Setup', state: 'done' }, { name: 'npm test', state: 'failed' }, { name: 'Upload', state: 'skipped' }] },
      ],
    });
    assert.equal(calledUrl, 'https://api.github.com/repos/o/r/actions/runs/5/jobs?filter=latest&per_page=100');
  });

  it('tells "nothing to name" (null, cached) from "could not ask" (undefined, asked again later)', async () => {
    assert.equal(await load(async () => reply(200, { jobs: [{ name: 'Build', conclusion: 'success' }] })).fetchFailure('o', 'r', 5, 'tok'), null);
    assert.equal(await load(async () => reply(404, {})).fetchFailure('o', 'r', 5, 'tok'), null);
    assert.equal(await load(async () => reply(502, {})).fetchFailure('o', 'r', 5, 'tok'), undefined);
    assert.equal(
      await load(async () => {
        throw new Error('offline');
      }).fetchFailure('o', 'r', 5, 'tok'),
      undefined,
    );
  });
});

describe('runAction', () => {
  it('posts re-run and cancel', async () => {
    const calls = [];
    const api = load(async (url, init) => {
      calls.push([init.method, url]);
      return reply(url.endsWith('/cancel') ? 409 : 201, {});
    });
    assert.deepEqual(plain(await api.runAction('o', 'r', 9, 'rerun', 'tok')), { ok: true, message: 'Re-running the failed jobs' });
    assert.deepEqual(plain(calls[0]), ['POST', 'https://api.github.com/repos/o/r/actions/runs/9/rerun-failed-jobs']);
    assert.equal((await api.runAction('o', 'r', 9, 'cancel', 'tok')).message, 'The run already finished.');
    assert.equal((await api.runAction('o', 'r', 9, 'delete', 'tok')).ok, false);
  });

  it('explains a token without write access', async () => {
    const denied = await load(async () => reply(403, {})).runAction('o', 'r', 9, 'rerun', 'tok');
    assert.equal(denied.ok, false);
    assert.match(denied.message, /needs Actions: Read and write/);
  });
});

describe('repoFromUrl', () => {
  it('finds the repository, and the branch after /tree/', () => {
    assert.deepEqual(plain(GitHubAPI.repoFromUrl('https://github.com/octo/web')), { owner: 'octo', repo: 'web', branch: null });
    assert.deepEqual(plain(GitHubAPI.repoFromUrl('https://github.com/octo/web/pull/4')), { owner: 'octo', repo: 'web', branch: null });
    assert.deepEqual(plain(GitHubAPI.repoFromUrl('https://github.com/octo/web/tree/feature/x%2Fy/src')), { owner: 'octo', repo: 'web', branch: 'feature/x/y/src' });
    assert.deepEqual(plain(GitHubAPI.repoFromUrl('https://github.com/octo/web.git')), { owner: 'octo', repo: 'web', branch: null });
  });

  it('ignores pages that are not a repository', () => {
    for (const url of ['https://github.com/octo', 'https://github.com/settings/tokens', 'https://github.com/orgs/acme/people', 'https://gist.github.com/octo/abc', 'https://example.com/octo/web', 'chrome://extensions', 'not a url']) {
      assert.equal(GitHubAPI.repoFromUrl(url), null, url);
    }
  });
});

describe('step lights', () => {
  it('maps job and step states', () => {
    const state = (status, conclusion = null) => GitHubAPI.stepState({ status, conclusion });
    assert.deepEqual(
      [state('completed', 'success'), state('completed', 'failure'), state('completed', 'timed_out'), state('completed', 'skipped'), state('completed', 'cancelled'), state('in_progress'), state('queued'), state('waiting')],
      ['done', 'failed', 'failed', 'skipped', 'cancelled', 'running', 'pending', 'pending'],
    );
  });

  it("asks for a running run's jobs conditionally, and keeps the last ones on a 304", async () => {
    let sent = null;
    const api = load(async (url, init) => {
      sent = init.headers['If-None-Match'] || null;
      return sent
        ? { ok: false, status: 304, headers: { get: () => null } }
        : { ok: true, status: 200, headers: { get: (h) => (h === 'ETag' ? '"j1"' : null) }, json: async () => ({ jobs: [{ name: 'Test', status: 'in_progress', steps: [{ name: 'npm test', status: 'in_progress' }] }] }) };
    });
    const first = plain(await api.fetchJobs('o', 'r', 5, 'tok'));
    assert.deepEqual(first, { jobs: [{ name: 'Test', state: 'running', steps: [{ name: 'npm test', state: 'running' }] }], etag: '"j1"', notModified: false });
    const again = plain(await api.fetchJobs('o', 'r', 5, 'tok', '"j1"'));
    assert.equal(sent, '"j1"');
    assert.deepEqual(again, { jobs: null, etag: '"j1"', notModified: true });
  });
});

describe('extractError', () => {
  const stamp = (s, line) => `2026-10-13T01:${s}.1234567Z ${line}`;

  it('prefers the errors a step reported itself, without the generic exit code', () => {
    const log = [
      stamp('44:40', '##[group]Run ./deploy.ps1'),
      stamp('44:41', 'Info: Updating file (api/web.config).'),
      stamp('44:48', '##[error]API deploy failed after 3 attempts. Its previous version was put back.'),
      stamp('44:48', '##[error]Process completed with exit code 1.'),
      stamp('44:49', 'Post job cleanup.'),
    ].join('\n');
    assert.deepEqual(plain(GitHubAPI.extractError(log)), ['API deploy failed after 3 attempts. Its previous version was put back.']);
  });

  it('finds the exception and the failed test, without stack traces, in the failed step only', () => {
    const log = [
      '﻿' + stamp('35:10', 'Error: an earlier step logged this, outside the failed step'),
      stamp('36:00', '##[group]Run dotnet test'),
      stamp('38:38', '[xUnit.net 00:00:27.18]     Tests.ReportVideos.Show_client_races [FAIL]'),
      stamp('38:38', "[xUnit.net 00:00:27.19]       Microsoft.Data.SqlClient.SqlException : Invalid object name 'ReportVideoLikes'."),
      stamp('38:38', '[xUnit.net 00:00:27.19]       Stack Trace:'),
      stamp('38:38', '[xUnit.net 00:00:27.19]            at Microsoft.Data.SqlClient.SqlCommand.Execute()'),
      stamp('38:39', '  Failed Tests.ReportVideos.Show_client_races [3 s]'),
      stamp('38:39', '  Error Message:'),
      stamp('38:39', "   Microsoft.Data.SqlClient.SqlException : Invalid object name 'ReportVideoLikes'."),
      stamp('38:39', '  Stack Trace:'),
      stamp('38:39', '     at Microsoft.Data.SqlClient.SqlCommand.Execute()'),
      stamp('39:47', 'Test Run Failed.'),
      stamp('39:47', '##[error]Process completed with exit code 1.'),
    ].join('\n');
    const lines = GitHubAPI.extractError(log, { start: '2026-10-13T01:36:00Z', end: '2026-10-13T01:39:47Z' });
    assert.deepEqual(plain(lines), ["Microsoft.Data.SqlClient.SqlException : Invalid object name 'ReportVideoLikes'.", 'Failed Tests.ReportVideos.Show_client_races [3 s]']);
  });

  it('reads JavaScript test failures and strips colors', () => {
    const log = [
      stamp('10:00', '##[group]Run npm test'),
      stamp('10:01', '\u001b[31m  ● api › returns the user\u001b[39m'),
      stamp('10:01', '    Expected: 200'),
      stamp('10:01', '    Received: 500'),
      stamp('10:01', ''),
      stamp('10:02', '      at Object.<anonymous> (api.test.js:42:5)'),
      stamp('10:03', '##[error]Process completed with exit code 1.'),
    ].join('\n');
    assert.deepEqual(plain(GitHubAPI.extractError(log)), ['● api › returns the user', 'Expected: 200', 'Received: 500']);
  });

  it('falls back to the last lines before the step gave up', () => {
    const log = [stamp('10:00', '##[group]Run make'), stamp('10:01', 'building target one'), stamp('10:02', 'make: *** [all] stopped'), stamp('10:03', '##[error]Process completed with exit code 2.')].join('\n');
    assert.deepEqual(plain(GitHubAPI.extractError(log)), ['building target one', 'make: *** [all] stopped']);
  });

  it("asks for the failed job's log, and knows an expired log from a network failure", async () => {
    let calledUrl = null;
    const api = load(async (url) => {
      calledUrl = url;
      return { ok: true, status: 200, text: async () => stamp('10:00', '##[error]Deploy refused') };
    });
    assert.deepEqual(plain(await api.fetchErrorLines('o', 'r', { jobId: 7 }, 'tok')), ['Deploy refused']);
    assert.equal(calledUrl, 'https://api.github.com/repos/o/r/actions/jobs/7/logs');
    assert.equal(await load(async () => ({ ok: false, status: 410 })).fetchErrorLines('o', 'r', { jobId: 7 }, 'tok'), null);
    assert.equal(await load(async () => ({ ok: false, status: 502 })).fetchErrorLines('o', 'r', { jobId: 7 }, 'tok'), undefined);
    assert.equal(await GitHubAPI.fetchErrorLines('o', 'r', { job: 'Test' }, 'tok'), null);
  });
});

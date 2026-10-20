// Unit tests for repo-order.js, loaded the way the popup loads it (a classic script).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(join(import.meta.dirname, '..', '..', 'repo-order.js'), 'utf8');
const context = vm.createContext({ Date, Number });
vm.runInContext(`${source}\nthis.RepoOrder = RepoOrder;`, context);
const { RepoOrder } = context;

const entry = (repo, branch = 'all', enabled = true) => ({ id: `${repo}:${branch}`, repo, branch, enabled });
const ids = (list) => JSON.parse(JSON.stringify(list.map((e) => e.id)));
const result = (color, ...times) => ({ color, workflows: times.map((t) => ({ startedAt: t, updatedAt: t })) });

const repos = [entry('me/zeta'), entry('me/alpha', 'main'), entry('me/paused', 'all', false), entry('me/Beta'), entry('me/alpha')];
const results = {
  'me/zeta:all': result('green', '2026-10-01T10:00:00Z'),
  'me/alpha:main': result('red', '2026-10-03T09:00:00Z'),
  'me/Beta:all': result('yellow', '2026-09-30T08:00:00Z', '2026-10-02T08:00:00Z'),
  'me/paused:all': result('red', '2026-10-04T00:00:00Z'),
};

describe('RepoOrder.sort', () => {
  it('custom keeps the saved order, with paused repositories after active ones', () => {
    assert.deepEqual(ids(RepoOrder.sort(repos, results, 'custom')), ['me/zeta:all', 'me/alpha:main', 'me/Beta:all', 'me/alpha:all', 'me/paused:all']);
  });

  it('name sorts case-insensitively, "All branches" before a specific branch', () => {
    assert.deepEqual(ids(RepoOrder.sort(repos, results, 'name')), ['me/alpha:all', 'me/alpha:main', 'me/Beta:all', 'me/zeta:all', 'me/paused:all']);
  });

  it('recent puts the newest workflow activity first and never-run repositories last', () => {
    assert.deepEqual(ids(RepoOrder.sort(repos, results, 'recent')), ['me/alpha:main', 'me/Beta:all', 'me/zeta:all', 'me/alpha:all', 'me/paused:all']);
  });

  it('status puts running, then failing, then passing, then unknown', () => {
    assert.deepEqual(ids(RepoOrder.sort(repos, results, 'status')), ['me/Beta:all', 'me/alpha:main', 'me/zeta:all', 'me/alpha:all', 'me/paused:all']);
  });

  it('does not change the saved list', () => {
    const before = ids(repos);
    RepoOrder.sort(repos, results, 'name');
    assert.deepEqual(ids(repos), before);
  });
});

describe('RepoOrder.move', () => {
  const list = [entry('a/1'), entry('a/2'), entry('a/3'), entry('a/4', 'all', false)];

  it('drops before or after another repository', () => {
    assert.deepEqual(ids(RepoOrder.move(list, 'a/3:all', 'a/1:all', 'before')), ['a/3:all', 'a/1:all', 'a/2:all', 'a/4:all']);
    assert.deepEqual(ids(RepoOrder.move(list, 'a/1:all', 'a/3:all', 'after')), ['a/2:all', 'a/3:all', 'a/1:all', 'a/4:all']);
  });

  it('refuses moves between active and paused, and moves that change nothing', () => {
    assert.equal(RepoOrder.move(list, 'a/1:all', 'a/4:all', 'after'), null);
    assert.equal(RepoOrder.move(list, 'a/2:all', 'a/1:all', 'after'), null);
    assert.equal(RepoOrder.move(list, 'a/2:all', 'a/2:all', 'before'), null);
  });

  it('moves by one with the keyboard, but not out of its group or past the ends', () => {
    assert.deepEqual(ids(RepoOrder.moveBy(list, 'a/2:all', -1)), ['a/2:all', 'a/1:all', 'a/3:all', 'a/4:all']);
    assert.deepEqual(ids(RepoOrder.moveBy(list, 'a/2:all', 1)), ['a/1:all', 'a/3:all', 'a/2:all', 'a/4:all']);
    assert.equal(RepoOrder.moveBy(list, 'a/1:all', -1), null);
    assert.equal(RepoOrder.moveBy(list, 'a/3:all', 1), null);
  });
});

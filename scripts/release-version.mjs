// The version a Chrome Web Store package carries. It is never edited by hand: `node scripts/build.mjs --store`
// claims it with `python3 tools/release.py tag --push` (last vX.Y.Z tag plus the highest bump among the change
// fragments since it; see changes/README.md) and records it in release/VERSION, which the later packaging steps
// (store assets, screenshots, SUBMIT pages) read. manifest.json's "version" stays as the local-build default.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SEMVER = /^\d+\.\d+\.\d+$/;

/** The packaged version from release/VERSION, falling back to manifest.json's "version" outside a store build. */
export function packagedVersion(root) {
  const file = join(root, 'release', 'VERSION');
  if (existsSync(file)) {
    const v = readFileSync(file, 'utf8').trim();
    if (!SEMVER.test(v)) throw new Error(`release/VERSION is not X.Y.Z: ${JSON.stringify(v)}`);
    return v;
  }
  return JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version;
}

/** Writes release/VERSION (release/ must exist). */
export function recordVersion(root, version) {
  if (!SEMVER.test(version)) throw new Error(`Not an X.Y.Z version: ${JSON.stringify(version)}`);
  writeFileSync(join(root, 'release', 'VERSION'), `${version}\n`);
}

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function python(root, args) {
  for (const exe of process.env.PYTHON ? [process.env.PYTHON] : ['python3', 'python']) {
    try {
      return execFileSync(exe, [join(root, 'tools', 'release.py'), ...args], { cwd: root, encoding: 'utf8' }).trim();
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  throw new Error('Python 3 is needed for tools/release.py (set PYTHON to its path).');
}

/**
 * Claims the next release version by pushing its vX.Y.Z tag, then returns it. Only from a clean checkout of
 * origin/main: a tag on an unmerged or dirty tree would name a version main never had.
 */
export function claimVersion(root) {
  git(root, 'fetch', '--quiet', '--tags', 'origin', 'main');
  if (git(root, 'status', '--porcelain', '--untracked-files=no')) {
    throw new Error('The store build tags a release: commit or stash your changes first.');
  }
  if (git(root, 'rev-parse', 'HEAD') !== git(root, 'rev-parse', 'FETCH_HEAD')) {
    throw new Error('The store build tags a release: check out origin/main (git switch main && git pull) first.');
  }
  return python(root, ['tag', '--push']).split('\n').at(-1);
}

/** Release notes (Markdown, newest first) compiled from the change fragments. */
export function releaseNotes(root) {
  return python(root, ['notes', '--format', 'markdown']);
}

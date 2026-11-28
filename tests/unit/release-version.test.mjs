// The store package's version comes from release/VERSION (written by the store build after it claims the tag), never
// from a hand-edited manifest.json; manifest.json's "version" is only the local-build default.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { packagedVersion, recordVersion } from '../../scripts/release-version.mjs';

const repoRoot = join(import.meta.dirname, '..', '..');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gam-version-'));
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ manifest_version: 3, version: '3.2.1' }));
  return root;
}

test('manifest.json carries an X.Y.Z default version', () => {
  const { version } = JSON.parse(readFileSync(join(repoRoot, 'manifest.json'), 'utf8'));
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test('without a store build the packaged version is the manifest default', () => {
  const root = fixture();
  try {
    assert.equal(packagedVersion(root), '3.2.1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('after a store build the packaged version is the claimed one', () => {
  const root = fixture();
  try {
    mkdirSync(join(root, 'release'));
    recordVersion(root, '3.3.0');
    assert.equal(packagedVersion(root), '3.3.0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a version that is not X.Y.Z is refused', () => {
  const root = fixture();
  try {
    mkdirSync(join(root, 'release'));
    assert.throws(() => recordVersion(root, 'v3.3.0'), /X\.Y\.Z/);
    writeFileSync(join(root, 'release', 'VERSION'), '3.3\n');
    assert.throws(() => packagedVersion(root), /X\.Y\.Z/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

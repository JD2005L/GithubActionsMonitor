// Copies exactly the files the extension ships into dist/ (loaded by the browser tests), and with --store also
// writes release/github-actions-monitor-<version>.zip for the Chrome Web Store.
// The extension itself has no build step: these are the same files you can load unpacked from the repo root.
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDirectory } from './zip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'dist');

/** Everything the extension needs at runtime, and nothing else (no docs, tests, tooling or node_modules). */
export const EXTENSION_FILES = [
  'manifest.json',
  'background.js',
  'github-api.js',
  'repo-order.js',
  'icon-manager.js',
  'storage-manager.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'options.html',
  'options.css',
  'options.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

rmSync(outdir, { recursive: true, force: true });
for (const file of EXTENSION_FILES) {
  mkdirSync(dirname(join(outdir, file)), { recursive: true });
  copyFileSync(join(root, file), join(outdir, file));
}

if (process.argv.includes('--store')) {
  mkdirSync(join(root, 'release'), { recursive: true });
  const zip = join(root, 'release', `github-actions-monitor-${manifest.version}.zip`);
  const count = zipDirectory(outdir, zip);
  console.log(`Built Chrome Web Store package -> ${zip} (${count} files)`);
} else {
  console.log(`Built extension ${manifest.version} -> ${outdir}`);
}

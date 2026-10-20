// Unit tests for the toolbar badge count in icon-manager.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(join(import.meta.dirname, '..', '..', 'icon-manager.js'), 'utf8');
const context = vm.createContext({ console });
vm.runInContext(`${source}\nthis.IconManager = IconManager;`, context);
const { IconManager } = context;
const plain = (value) => JSON.parse(JSON.stringify(value));
const results = (...colors) => Object.fromEntries(colors.map((color, i) => [`r${i}`, { color }]));

describe('badgeFor', () => {
  it('counts failing repositories first, else running ones', () => {
    assert.deepEqual(plain(IconManager.badgeFor(results('red', 'red', 'yellow', 'green'), 'both')), {
      text: '2',
      color: 'red',
      title: 'GitHub Actions Monitor: 2 repositories failing, 1 repository running',
    });
    assert.deepEqual(plain(IconManager.badgeFor(results('yellow', 'green'), 'both')), { text: '1', color: 'yellow', title: 'GitHub Actions Monitor: 1 repository running' });
    assert.deepEqual(plain(IconManager.badgeFor(results('green', 'gray'), 'both')), { text: '', color: null, title: 'GitHub Actions Monitor' });
  });

  it('"failing" shows only failures; "off" shows nothing, while the tooltip still counts', () => {
    assert.equal(IconManager.badgeFor(results('yellow'), 'failing').text, '');
    assert.equal(IconManager.badgeFor(results('red', 'yellow'), 'failing').text, '1');
    const off = IconManager.badgeFor(results('red'), 'off');
    assert.equal(off.text, '');
    assert.equal(off.title, 'GitHub Actions Monitor: 1 repository failing');
  });

  it('caps the number at 99+', () => {
    assert.equal(IconManager.badgeFor(results(...Array(120).fill('red')), 'both').text, '99+');
  });
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'renderer', 'i18n.js')).href);

test('both languages have the same keys', async () => {
  const { TEXT } = await load();
  assert.deepStrictEqual(Object.keys(TEXT.en).sort(), Object.keys(TEXT.ru).sort());
});

test('every data-i18n key in the page exists', async () => {
  const { TEXT } = await load();
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 30);
  for (const k of keys) assert.ok(TEXT.ru[k], 'no text for ' + k);
});

test('no long dashes in texts (writing rule)', async () => {
  const { TEXT } = await load();
  for (const lang of ['ru', 'en']) for (const [k, v] of Object.entries(TEXT[lang])) assert.ok(!/[–—]/.test(v), lang + ' ' + k);
});

test('formatTime rounds to minutes before hours', async () => {
  const m = await load();
  m.setLang && (globalThis.document = { documentElement: {} }, m.setLang('ru'));
  assert.strictEqual(m.formatTime(7199), '2 ч 0 мин');
  assert.strictEqual(m.formatTime(3725), '1 ч 2 мин');
  assert.strictEqual(m.formatTime(20), '1 мин');
});

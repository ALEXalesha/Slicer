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

// Обзор 23.10 Б10: «72 слоёв», «Отправили 3 раз», «в 1 местах» - числа со склонением.
test('numbers agree with nouns: 1 слой, 2 слоя, 5 слоёв, 21 слой; English one/many', async () => {
  const m = await load();
  globalThis.document = { documentElement: {} };
  m.setLang('ru');
  const L = (n) => m.t('res.layers', { n });
  assert.deepStrictEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 72, 100, 111].map(L),
    ['1 слой', '2 слоя', '4 слоя', '5 слоёв', '11 слоёв', '12 слоёв', '14 слоёв', '21 слой', '22 слоя', '72 слоя', '100 слоёв', '111 слоёв']);
  assert.match(m.t('send.not-listed', { n: 3 }), /Отправили 3 раза/);
  assert.match(m.t('send.not-listed', { n: 5 }), /Отправили 5 раз /);
  assert.match(m.t('send.size-mismatch', { n: 2, got: 1, want: 2 }), /Повторили 2 раза/);
  assert.match(m.t('cut.open', { n: 1 }), /в 1 месте /);
  assert.match(m.t('cut.open', { n: 3 }), /в 3 местах/);
  assert.match(m.t('send.upload-failed', { n: 1, why: 'x' }), /после 1 попытки/);
  assert.match(m.t('send.upload-failed', { n: 3, why: 'x' }), /после 3 попыток/);
  m.setLang('en');
  assert.strictEqual(L(1), '1 layer');
  assert.strictEqual(L(72), '72 layers');
  assert.match(m.t('send.not-listed', { n: 1 }), /Sent 1 time /);
  m.setLang('ru');
});

test('no Russian text puts a bare {n} before a noun that needs agreement', async () => {
  const { TEXT } = await load();
  // слово сразу после {n}, которое меняется по числу (слоёв, раз, местах, попыток, моделей...)
  const bad = Object.entries(TEXT.ru).filter(([, v]) => /\{n\} (слоёв|слоя|раз|местах|попыток|моделей|копий|граней|штук)/.test(v));
  assert.deepStrictEqual(bad, []);
});

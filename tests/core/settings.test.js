'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fc = require('fast-check');
const S = require('../../src/core/settings');

test('broken or foreign file gives defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicer-set-'));
  const f = path.join(dir, 's.json');
  fs.writeFileSync(f, '{"lang": "ru", "theme": "glas');
  assert.deepStrictEqual(S.load(f), S.normalize(null));
  assert.deepStrictEqual(S.load(path.join(dir, 'none.json')), S.normalize(null));
});

test('save then load returns the same settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicer-set-'));
  const f = path.join(dir, 'sub', 's.json');
  const s = S.normalize({ lang: 'en', theme: 'night', printerHost: '10.0.0.7', mode: 'advanced' });
  S.save(f, s);
  assert.deepStrictEqual(S.load(f), s);
  assert.ok(!fs.existsSync(f + '.tmp'));
});

test('law: normalize is idempotent and always gives allowed values', () => {
  fc.assert(fc.property(fc.anything(), (raw) => {
    const a = S.normalize(raw);
    assert.deepStrictEqual(S.normalize(a), a);
    assert.ok(S.THEMES.includes(a.theme) && S.LANGS.includes(a.lang) && S.MODES.includes(a.mode));
    assert.ok(S.isHost(a.printerHost));
  }), { numRuns: 400 });
});

test('host check refuses paths and urls', () => {
  for (const bad of ['http://x', 'a/b', '..\\x', 'x y', '1.2.3.4:99999999', '1.2.3.4:70000', '-x']) assert.strictEqual(S.isHost(bad), false, bad);
  for (const good of ['', '192.168.1.20', 'printer.local', '127.0.0.1:4030']) assert.strictEqual(S.isHost(good), true, good);
});

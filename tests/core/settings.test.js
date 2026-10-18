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

// А3: старый плоский формат правок филамента (общий для всех) переносится в выбранный тогда
// филамент без потерь; новые правки по id не трогаются.
test('law: old flat filament edits migrate to the chosen filament without loss', () => {
  const old = { choice: { filament: 'petg' }, advanced: { process: { wall_loops: '4' }, filament: { nozzle_temperature: '215', fan_max_speed: ['60'] } } };
  const s = S.normalize(old);
  assert.deepStrictEqual(s.advanced, { process: { wall_loops: '4' }, filament: { petg: { nozzle_temperature: '215', fan_max_speed: '60' } } });
  assert.deepStrictEqual(S.normalize(s), s);
  const noChoice = S.normalize({ advanced: { filament: { nozzle_temperature: '205' } } });
  assert.deepStrictEqual(noChoice.advanced.filament, { pla: { nozzle_temperature: '205' } });
  const mixed = S.normalize({ choice: { filament: 'abs' }, advanced: { filament: { nozzle_temperature: '250', abs: { nozzle_temperature: '255' }, pla: { fan_min_speed: '90' } } } });
  assert.deepStrictEqual(mixed.advanced.filament, { abs: { nozzle_temperature: '255' }, pla: { fan_min_speed: '90' } });
  fc.assert(fc.property(fc.constantFrom('pla', 'petg', 'tpu', 'abs', 'asa'), fc.integer({ min: 150, max: 350 }), (id, temp) => {
    const n = S.normalize({ choice: { filament: id }, advanced: { filament: { nozzle_temperature: String(temp) } } });
    assert.deepStrictEqual(n.advanced.filament, { [id]: { nozzle_temperature: String(temp) } });
  }), { numRuns: 100 });
});

// А4: неверное значение не сохраняется, запятая становится точкой.
test('edits are checked by the catalog before they are stored', () => {
  const s = S.normalize({ advanced: { process: { layer_height: '0,16', wall_loops: 'abc', initial_layer_print_height: '5', unknown_key: '7', 'bad key': '1' }, filament: { pla: { nozzle_temperature: 'abc', fan_min_speed: '40' } } } });
  assert.deepStrictEqual(s.advanced.process, { layer_height: '0.16', unknown_key: '7' });
  assert.deepStrictEqual(s.advanced.filament, { pla: { fan_min_speed: '40' } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicer-set-'));
  const f = path.join(dir, 's.json');
  fs.writeFileSync(f, JSON.stringify({ advanced: { process: { layer_height: 'abc' }, filament: {} } }));
  assert.deepStrictEqual(S.load(f).advanced, { process: {}, filament: {} });
});

// Ревью 18.10 (В1): «http://192.0.2.1» молча становился пустым адресом и окно писало «Принтер не отвечает».
test('host typed as a URL is cleaned: scheme, trailing slash and spaces go, the rest must be a host', () => {
  for (const [raw, want] of [['http://192.0.2.1', '192.0.2.1'], ['http://192.0.2.1/', '192.0.2.1'], ['HTTPS://printer.local//', 'printer.local'],
    ['  192.168.0.50  ', '192.168.0.50'], ['ws://127.0.0.1:4030/', '127.0.0.1:4030'], ['', ''], ['192.168.0.50', '192.168.0.50']]) {
    assert.strictEqual(S.normalizeHost(raw), want, raw);
  }
  for (const bad of ['http://192.0.2.1/index.html', 'ftp://1.2.3.4', 'a b', 'http://', ' / ', '..\\x', null, 5]) assert.strictEqual(S.normalizeHost(bad), null, String(bad));
  assert.strictEqual(S.normalize({ printerHost: 'http://192.0.2.1/' }).printerHost, '192.0.2.1');
  fc.assert(fc.property(fc.string(), (s) => {
    const h = S.normalizeHost(s);
    if (h !== null) { assert.ok(S.isHost(h)); assert.strictEqual(S.normalizeHost(h), h); }
  }), { numRuns: 500 });
});

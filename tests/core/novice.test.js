'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const N = require('../../src/core/novice');
const P = require('../../src/core/presets');
const { findEngine } = require('../../src/core/engine-locate');

const base = { nozzle_temperature: ['230'], nozzle_temperature_initial_layer: ['235'] };
const anyChoice = fc.record({
  filament: fc.oneof(fc.constantFrom('pla', 'petg', 'tpu', 'abs', 'asa'), fc.string()),
  tempDelta: fc.oneof(fc.integer({ min: -100, max: 100 }), fc.double(), fc.string(), fc.constant(null)),
  supports: fc.oneof(fc.constantFrom('none', 'plate', 'everywhere'), fc.string()),
  brim: fc.oneof(fc.boolean(), fc.string()),
}, { requiredKeys: [] });

test('law: temperature = base + clamped delta, always within +-15', () => {
  fc.assert(fc.property(anyChoice, fc.integer({ min: 150, max: 320 }), (choice, b) => {
    const o = N.noviceOverrides(choice, { nozzle_temperature: [String(b)], nozzle_temperature_initial_layer: [String(b + 5)] });
    const t = Number(o.filament.nozzle_temperature[0]);
    const d = N.normalizeChoice(choice).tempDelta;
    assert.strictEqual(t, b + d);
    assert.ok(t >= b - 15 && t <= b + 15);
    assert.strictEqual(Number(o.filament.nozzle_temperature_initial_layer[0]), b + 5 + d);
  }), { numRuns: 400 });
});

test('law: overrides touch only the whitelisted keys', () => {
  fc.assert(fc.property(anyChoice, (choice) => {
    const o = N.noviceOverrides(choice, base);
    assert.deepStrictEqual(Object.keys(o.filament).sort(), [...N.FILAMENT_KEYS].sort());
    assert.deepStrictEqual(Object.keys(o.process).sort(), [...N.PROCESS_KEYS].sort());
  }), { numRuns: 400 });
});

test('law: normalizeChoice is idempotent and gives allowed values', () => {
  fc.assert(fc.property(fc.oneof(anyChoice, fc.anything()), (raw) => {
    const a = N.normalizeChoice(raw);
    assert.deepStrictEqual(N.normalizeChoice(a), a);
    assert.ok(N.FILAMENTS.some((f) => f.id === a.filament));
    assert.ok(N.SUPPORTS.includes(a.supports));
    assert.ok(Number.isInteger(a.tempDelta) && Math.abs(a.tempDelta) <= 15);
    assert.strictEqual(typeof a.brim, 'boolean');
  }), { numRuns: 400 });
});

test('law: supports none means support off whatever else', () => {
  fc.assert(fc.property(anyChoice, (choice) => {
    const o = N.noviceOverrides(Object.assign({}, choice, { supports: 'none' }), base);
    assert.strictEqual(o.process.enable_support, '0');
  }), { numRuns: 200 });
});

test('supports map to tree supports from the plate or everywhere; brim', () => {
  assert.deepStrictEqual(N.noviceOverrides({ supports: 'plate' }, base).process,
    { enable_support: '1', support_type: 'tree(auto)', support_on_build_plate_only: '1', brim_type: 'no_brim', brim_width: '5' });
  const e = N.noviceOverrides({ supports: 'everywhere', brim: true }, base).process;
  assert.strictEqual(e.support_on_build_plate_only, '0');
  assert.strictEqual(e.brim_type, 'outer_only');
});

test('novice screen has exactly three decisions', () => {
  assert.deepStrictEqual(N.NOVICE_ITEMS, ['filament', 'temperature', 'supports']);
});

const engine = findEngine();
test('composeConfigs on the real presets', { skip: !engine && 'ElegooSlicer not installed' }, () => {
  const idx = P.buildIndex(engine.profilesDir);
  const pla = N.composeConfigs(idx, { choice: { filament: 'pla', tempDelta: 5, supports: 'plate' } });
  assert.deepStrictEqual(pla.filament.nozzle_temperature, ['215']);
  assert.strictEqual(pla.process.enable_support, '1');
  assert.strictEqual(pla.process.curr_bed_type, 'Textured PEI Plate');
  const petg = N.composeConfigs(idx, { choice: { filament: 'petg' } });
  assert.deepStrictEqual(petg.filament.filament_retraction_length, ['1.8']);
  assert.deepStrictEqual(petg.filament.textured_plate_temp, ['80']);
  for (const f of N.FILAMENTS) {
    const c = N.composeConfigs(idx, { choice: { filament: f.id } });
    const cp = c.filament.compatible_printers;
    assert.ok(!cp || !cp.length || cp.includes(N.MACHINE), f.id + ' compatible');
    assert.ok(!('inherits' in c.filament) && !('inherits' in c.process) && !('inherits' in c.machine));
  }
  // Review Focus 5: в «Новичке» правки «Продвинутого» не участвуют
  const adv = { process: { wall_loops: '9' }, filament: { pla: { nozzle_temperature: '260' } } };
  const plain = N.composeConfigs(idx, { mode: 'novice', choice: { filament: 'pla' } });
  const withAdv = N.composeConfigs(idx, { mode: 'novice', choice: { filament: 'pla' }, advanced: adv, quality: N.QUALITIES[0], plate: 'Cool Plate' });
  assert.deepStrictEqual(withAdv, plain);
  const a = N.composeConfigs(idx, { mode: 'advanced', choice: { filament: 'pla' }, advanced: adv, quality: N.QUALITIES[0], plate: 'Cool Plate' });
  assert.strictEqual(a.process.wall_loops, '9');
  assert.deepStrictEqual(a.filament.nozzle_temperature, ['260']);
  assert.strictEqual(a.process.curr_bed_type, 'Cool Plate');
  assert.strictEqual(a.process.layer_height, '0.12');
});

// А3 (ревьювер): сопло 215 из PETG уезжало в G-code PLA. Правки филамента - по id.
test('law: filament edits belong to their filament only', { skip: !engine && 'ElegooSlicer not installed' }, () => {
  const idx = P.buildIndex(engine.profilesDir);
  const adv = { process: {}, filament: { petg: { nozzle_temperature: '215' }, pla: { nozzle_temperature: '205' } } };
  const pla = N.composeConfigs(idx, { mode: 'advanced', choice: { filament: 'pla' }, advanced: adv });
  const petg = N.composeConfigs(idx, { mode: 'advanced', choice: { filament: 'petg' }, advanced: adv });
  const abs = N.composeConfigs(idx, { mode: 'advanced', choice: { filament: 'abs' }, advanced: adv });
  const absPlain = N.composeConfigs(idx, { mode: 'advanced', choice: { filament: 'abs' } });
  assert.deepStrictEqual(pla.filament.nozzle_temperature, ['205']);
  assert.deepStrictEqual(petg.filament.nozzle_temperature, ['215']);
  assert.deepStrictEqual(abs.filament, absPlain.filament, 'no edits of PLA/PETG reach ABS');
  fc.assert(fc.property(fc.constantFrom(...N.FILAMENTS.map((f) => f.id)), fc.constantFrom(...N.FILAMENTS.map((f) => f.id)), fc.integer({ min: 180, max: 300 }), (a, b, temp) => {
    fc.pre(a !== b);
    const one = { process: {}, filament: { [a]: { nozzle_temperature: String(temp) } } };
    const other = N.composeConfigs(idx, { mode: 'advanced', choice: { filament: b }, advanced: one });
    const clean = N.composeConfigs(idx, { mode: 'advanced', choice: { filament: b } });
    assert.deepStrictEqual(other.filament, clean.filament);
    const mine = N.composeConfigs(idx, { mode: 'advanced', choice: { filament: a }, advanced: one });
    assert.deepStrictEqual(mine.filament.nozzle_temperature, [String(temp)]);
  }), { numRuns: 30 });
});

test('engine keys missing from the preset are added only when the catalog knows them', () => {
  const p = { a: '1' };
  N.applyEdits(p, { fuzzy_skin: 'external', zzz: '1', filament_shrink: '99%' }, 'process');
  assert.deepStrictEqual(p, { a: '1', fuzzy_skin: 'external' });
  const f = { b: ['1'] };
  N.applyEdits(f, { filament_shrink: '99%', fuzzy_skin: 'external' }, 'filament');
  assert.deepStrictEqual(f, { b: ['1'], filament_shrink: ['99%'] });
});

test('applyEdits ignores protected and unknown keys', () => {
  const t = { name: 'x', a: '1', b: ['1', '2'] };
  N.applyEdits(t, { name: 'hack', compatible_printers: [], zzz: '1', a: 5, b: '3' });
  assert.deepStrictEqual(t, { name: 'x', a: '5', b: ['3', '3'] });
});

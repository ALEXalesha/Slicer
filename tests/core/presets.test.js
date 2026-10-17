'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fc = require('fast-check');
const P = require('../../src/core/presets');
const { findEngine } = require('../../src/core/engine-locate');

const FIX = path.join(__dirname, '..', 'fixtures', 'profiles');

test('chain of three levels: child wins, inherits removed', () => {
  const idx = P.buildIndex(FIX);
  const r = P.resolvePreset(idx, 'filament', 'Generic PETG @System');
  assert.deepStrictEqual({ a: r.a, b: r.b, c: r.c }, { a: '1', b: '2', c: '3' });
  assert.strictEqual(r.inherits, undefined);
  assert.strictEqual(r.name, 'Generic PETG @System');
});

test('missing parent and cycle are errors with codes', () => {
  const idx = P.buildIndex(FIX);
  assert.throws(() => P.resolvePreset(idx, 'filament', 'Orphan'), (e) => e.code === 'missing' && e.preset === 'Nobody');
  assert.throws(() => P.resolvePreset(idx, 'filament', 'Loop A'), (e) => e.code === 'cycle');
  assert.throws(() => P.resolvePreset(idx, 'filament', 'No such'), (e) => e.code === 'missing');
});

test('Elegoo wins over the library for the same name; broken json skipped', () => {
  const idx = P.buildIndex(FIX);
  assert.strictEqual(P.resolvePreset(idx, 'filament', 'Shared').who, 'elegoo');
  assert.ok(P.listPresets(idx, 'filament').includes('Generic PETG @System'));
  assert.ok(!P.listPresets(idx, 'filament').includes('fdm_filament_pet'));
});

test('law: resolved preset equals left fold of the chain', () => {
  const key = fc.constantFrom('k1', 'k2', 'k3', 'k4', 'k5');
  fc.assert(fc.property(fc.array(fc.dictionary(key, fc.string()), { minLength: 1, maxLength: 6 }), (levels) => {
    const idx = new Map();
    levels.forEach((props, i) => {
      const json = Object.assign({}, props, { type: 'process', name: 'L' + i });
      if (i > 0) json.inherits = 'L' + (i - 1);
      idx.set('process|L' + i, { file: '', json });
    });
    const last = 'L' + (levels.length - 1);
    const got = P.resolvePreset(idx, 'process', last);
    const want = {};
    levels.forEach((props, i) => Object.assign(want, props, { type: 'process', name: 'L' + i }));
    assert.deepStrictEqual(got, want);
    assert.ok(!('inherits' in got));
  }), { numRuns: 400 });
});

const engine = findEngine();
test('real engine presets resolve with the values the engine itself loses', { skip: !engine && 'ElegooSlicer not installed' }, () => {
  const idx = P.buildIndex(engine.profilesDir);
  const pla = P.resolvePreset(idx, 'filament', 'Generic PLA @Elegoo Centauri');
  assert.deepStrictEqual(pla.filament_density, ['1.25']);
  assert.deepStrictEqual(pla.nozzle_temperature, ['210']);
  const petg = P.resolvePreset(idx, 'filament', 'Generic PETG @System');
  assert.deepStrictEqual(petg.hot_plate_temp, ['80']);
  assert.deepStrictEqual(petg.textured_plate_temp, ['80']);
  const proc = P.resolvePreset(idx, 'process', '0.20mm Standard @Elegoo CC 0.4 nozzle');
  assert.ok(proc.outer_wall_acceleration && proc.outer_wall_acceleration.length, 'outer_wall_acceleration');
  assert.deepStrictEqual(proc.compatible_printers, ['Elegoo Centauri Carbon 0.4 nozzle']);
  const m = P.resolvePreset(idx, 'machine', 'Elegoo Centauri Carbon 0.4 nozzle');
  assert.deepStrictEqual(m.printable_area, ['0x0', '256x0', '256x256', '0x256']);
});

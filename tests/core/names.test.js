'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const N = require('../../src/core/names');

const SAFE = /^[A-Za-z0-9_.-]{1,54}\.gcode$/;

test('examples', () => {
  assert.strictEqual(N.printerFileName({ model: 'Ваза спиральная.stl', filament: 'petg', timeSec: 15600 }), 'Vaza_spiralnaya_PETG_4h20m.gcode');
  assert.strictEqual(N.printerFileName({ model: '旋转花瓶E', filament: 'PETG', timeSec: 60 }), 'E_PETG_1m.gcode');
  assert.strictEqual(N.printerFileName({ model: '旋转花瓶', filament: 'pla' }), 'model_PLA.gcode');
  assert.strictEqual(N.printerFileName({ model: '..\\..\\Windows\\x' }), 'Windows_x.gcode');
  assert.strictEqual(N.printerFileName({}), 'model.gcode');
  assert.strictEqual(N.translit('Щука Ёж'), 'Shchuka Ezh');
});

test('law: any model name gives a short safe printer name that does not start with a dot', () => {
  fc.assert(fc.property(fc.oneof(fc.string(), fc.fullUnicodeString(), fc.constantFrom('..', '. .', 'Ёлка 🎄 v1.2', ' ', '\u0000')),
    fc.oneof(fc.constantFrom('pla', 'petg', 'tpu'), fc.string()), fc.oneof(fc.integer({ min: -10, max: 10 * 86400 }), fc.double()),
    (model, filament, timeSec) => {
      const n = N.printerFileName({ model, filament, timeSec });
      assert.match(n, SAFE);
      assert.ok(n.length <= 60);
      assert.ok(!n.startsWith('.') && !n.startsWith('_') && !n.startsWith('-'));
      assert.strictEqual(N.printerFileName({ model, filament, timeSec }), n);
    }), { numRuns: 400 });
});

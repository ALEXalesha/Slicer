'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const G = require('../../src/core/gcode-info');

test('durations', () => {
  assert.strictEqual(G.parseDuration('18m 2s'), 1082);
  assert.strictEqual(G.parseDuration('1h 2m 5s'), 3725);
  assert.strictEqual(G.parseDuration('2d 3h 0m 0s'), 183600);
  assert.strictEqual(G.parseDuration('45s'), 45);
  assert.strictEqual(G.parseDuration('soon'), null);
});

test('law: format then parse gives the seconds back', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 30 * 86400 }), (s) => {
    assert.strictEqual(G.parseDuration(G.formatDuration(s)), s);
  }), { numRuns: 400 });
});

test('parse header, footer and config block', () => {
  const text = '; HEADER_BLOCK_START\n; total layer number: 100\n; HEADER_BLOCK_END\nG1\n; filament used [mm] = 2931.40\n' +
    '; filament used [g] = 7.53\n; total filament used [g] = 7.53\n; estimated printing time (normal mode) = 1h 2m 5s\n' +
    '; CONFIG_BLOCK_START\n; nozzle_temperature = 250\n; brim_type = no_brim\n; CONFIG_BLOCK_END\n';
  const i = G.parseGcodeInfo(text);
  assert.deepStrictEqual(i, { layers: 100, timeSec: 3725, filamentMm: 2931.4, filamentG: 7.53, settings: { nozzle_temperature: '250', brim_type: 'no_brim' } });
  assert.deepStrictEqual(G.parseGcodeInfo(null).layers, 0);
});

// Законы предпросмотра по слоям (пункт 1 Алексея): типы линий, слои, перемещения, дуги.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseGcodePreview, KINDS } = require('../../src/core/gcode-preview');

const idx = (id) => KINDS.findIndex((k) => k.id === id);
const segs = (r, id) => r.data[idx(id)].positions.length / 6;

const SAMPLE = [
  'M83', 'G90', 'G1 X0 Y0 Z0.2 F6000', ';TYPE:Custom', 'G1 X10 Y0 E1 F1200',          // прочистка до первого слоя
  ';LAYER_CHANGE', ';Z:0.2', ';TYPE:Outer wall',
  'G1 X20 Y0 E0.5', 'G1 X20 Y10 E0.5', 'G1 X10 Y10 E0.5', 'G1 X10 Y0 E0.5',
  'G1 E-0.8 F1800', 'G1 X50 Y50 F12000', 'G1 E0.8',                                      // откат, перемещение
  ';TYPE:Sparse infill', 'G1 X60 Y60 E1 F3000',
  ';LAYER_CHANGE', ';Z:0.4', 'G1 Z0.4', ';TYPE:Support', 'G1 X70 Y60 E0.3',
  ';TYPE:Something new', 'G1 X70 Y70 E0.3',                                            // неизвестный тип - «прочее»
  'G3 X80 Y70 I5 J0 E1 ; дуга',
  'G1 X90 Y90 ; перемещение без E',
].join('\n');

test('types, layers and travel are separated; unknown type goes to custom', () => {
  const r = parseGcodePreview(SAMPLE);
  assert.strictEqual(r.layers.length, 2);
  assert.deepStrictEqual(r.layers.map((l) => l.z), [0.2, 0.4]);
  assert.strictEqual(segs(r, 'outer'), 4);
  assert.strictEqual(segs(r, 'sparse'), 1);
  assert.strictEqual(segs(r, 'support'), 1);
  assert.ok(segs(r, 'travel') >= 2);
  assert.ok(segs(r, 'custom') >= 3, 'purge + unknown type + arc pieces');
  // прочистка до первого слоя относится к первому слою
  assert.strictEqual(r.data[idx('custom')].layerEnd[0], 1);
  // слои по порядку: конец слоя не убывает и последний = всего отрезков
  for (const d of r.data) {
    for (let l = 1; l < d.layerEnd.length; l++) assert.ok(d.layerEnd[l] >= d.layerEnd[l - 1]);
    assert.strictEqual(d.layerEnd[d.layerEnd.length - 1], d.positions.length / 6);
  }
});

test('arc G3 is drawn as many short pieces ending exactly at the target', () => {
  const r = parseGcodePreview(SAMPLE);
  const p = r.data[idx('custom')].positions;
  const last = p.slice(p.length - 6);
  assert.deepStrictEqual([last[3], last[4]].map((v) => Math.round(v * 1000) / 1000), [80, 70]);
  // все точки дуги на окружности радиуса 5 вокруг (75, 70)
  for (let i = 6; i < p.length; i += 6) {
    const rr = Math.hypot(p[i] - 75, p[i + 1] - 70);
    if (p[i + 1] >= 69.999 && i > 6) assert.ok(Math.abs(rr - 5) < 1e-3 || rr > 5.5);
  }
});

test('absolute extrusion (M82) with G92 resets', () => {
  const r = parseGcodePreview(['M82', ';LAYER_CHANGE', ';Z:0.2', ';TYPE:Inner wall', 'G1 X10 Y0 E1', 'G1 X20 Y0 E2', 'G92 E0', 'G1 X30 Y0 E0.5', 'G1 X40 Y0 E0.5'].join('\n'));
  assert.strictEqual(segs(r, 'inner'), 3);
  assert.strictEqual(segs(r, 'travel'), 1);
});

test('law: garbage never throws and never yields NaN positions', () => {
  const junk = ['G1 X', 'G1 Xabc Y-', 'G2 X1 Y1', ';TYPE:', ';LAYER_CHANGE', ';Z:nope', 'M83', 'G1 E-5', 'G91', 'G1 X1 Y1 E1', '', '\r', 'G1 X1e3 Y-2e2 E.5'];
  for (let n = 0; n < 300; n++) {
    const text = Array.from({ length: 40 }, () => junk[Math.floor(Math.random() * junk.length)]).join('\n');
    const r = parseGcodePreview(text);
    for (const d of r.data) for (const v of d.positions) assert.ok(Number.isFinite(v));
  }
});

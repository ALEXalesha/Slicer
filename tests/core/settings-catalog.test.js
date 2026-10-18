'use strict';
// Каталог «Продвинутого»: у каждой показанной настройки есть раздел, у важных - подпись и
// описание на двух языках, значение из пресета проходит свою же проверку, ввод с запятой
// принимается, мусор - нет.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fc = require('fast-check');
const C = require('../../src/core/settings-catalog');
const N = require('../../src/core/novice');
const P = require('../../src/core/presets');
const { findEngine } = require('../../src/core/engine-locate');
const { prepareJob } = require('../../src/core/job');
const { slice } = require('../../src/core/engine');
const { writeCube } = require('../support/models');

const engine = findEngine();
const noEngine = !engine && 'ElegooSlicer not installed';
const SKIP = new Set(['name', 'type', 'from', 'inherits', 'instantiation', 'compatible_printers', 'setting_id', 'version', 'print_settings_id', 'filament_settings_id']);

// Ключи, которые показывает «Продвинутый» (как в advanced.js), со значениями из пресетов:
// все качества и все 5 филаментов.
function shownKeys() {
  const idx = P.buildIndex(engine.profilesDir);
  const out = new Map();
  for (const quality of N.QUALITIES) {
    for (const f of N.FILAMENTS) {
      const c = N.composeConfigs(idx, { mode: 'advanced', choice: { filament: f.id }, quality });
      for (const kind of ['process', 'filament']) {
        for (const [key, v] of Object.entries(c[kind])) {
          if (SKIP.has(key) || (v && typeof v === 'object' && !Array.isArray(v))) continue;
          if (Array.isArray(v) && new Set(v.map(String)).size > 1) continue;
          const text = Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
          if (text.includes('\n')) continue;
          if (!out.has(key)) out.set(key, new Set());
          out.get(key).add(text);
        }
      }
    }
  }
  return out;
}

test('law: every shown key has a section, a label and a description; defaults pass their own check', { skip: noEngine }, () => {
  const keys = shownKeys();
  assert.ok(keys.size > 150, 'shown keys: ' + keys.size);
  for (const [key, values] of keys) {
    assert.ok(C.SECTION_IDS.includes(C.sectionOf(key)), 'section for ' + key);
    assert.ok(C.entry(key), 'catalog entry for ' + key);
    for (const v of values) {
      const r = C.check(key, v, v);
      assert.ok(r.ok, `${key} = "${v}" fails its own check: ${r.ok ? '' : C.message(r.err, 'ru')}`);
      assert.ok(C.check(key, r.value, v).ok, key + ' canonical value passes too');
    }
  }
});

test('catalog: at least 150 labeled keys, ru and en for every label, description and option', () => {
  let labeled = 0;
  for (const e of C.ENTRIES.values()) {
    assert.ok(C.SECTION_IDS.includes(e.section), e.key + ' section');
    for (const l of ['ru', 'en']) {
      assert.ok(e.label[l] && e.label[l].trim(), e.key + ' label ' + l);
      assert.ok(e.desc[l] && e.desc[l].trim().length > 5, e.key + ' desc ' + l);
      assert.ok(!/[–—]/.test(e.label[l] + e.desc[l]), e.key + ' no long dashes ' + l);
    }
    assert.ok(!/[а-яё]/i.test(e.label.en + e.desc.en), e.key + ' English texts have no Cyrillic');
    assert.ok(['num', 'pct', 'bool', 'enum', 'text'].includes(e.type.t), e.key + ' type');
    if (e.type.t === 'enum') for (const o of e.type.options) assert.ok(o.ru && o.en && o.value !== undefined, e.key + ' option');
    if (e.type.t === 'num' || e.type.t === 'pct') assert.ok(e.type.min < e.type.max, e.key + ' range');
    if (e.extra) assert.ok(C.check(e.key, e.def, e.def).ok, e.key + ' extra default passes');
    labeled += 1;
  }
  assert.ok(labeled >= 150, 'labeled: ' + labeled);
  for (const s of C.SECTIONS) assert.ok(s.ru && s.en, s.id);
  assert.deepStrictEqual(C.SECTION_IDS, ['quality', 'walls', 'topbottom', 'infill', 'speed', 'accel', 'temps', 'cooling', 'retract', 'support', 'adhesion', 'special', 'filament', 'other']);
});

test('keys without a record get a section by name rules', () => {
  assert.strictEqual(C.sectionOf('support_new_thing'), 'support');
  assert.strictEqual(C.sectionOf('brim_new'), 'adhesion');
  assert.strictEqual(C.sectionOf('fuzzy_skin_new'), 'special');
  assert.strictEqual(C.sectionOf('some_fan_speed'), 'cooling');
  assert.strictEqual(C.sectionOf('zzz'), 'other');
});

test('А4: comma becomes a dot, garbage and out-of-range values are refused with a clear text', () => {
  assert.deepStrictEqual(C.check('layer_height', '0,16'), { ok: true, value: '0.16' });
  assert.deepStrictEqual(C.check('layer_height', ' 0.2 '), { ok: true, value: '0.2' });
  for (const bad of ['abc', '5', '0', '', '0.16.2', '1e2', '0,1,2']) assert.strictEqual(C.check('layer_height', bad).ok, false, bad);
  const r = C.check('layer_height', '5');
  assert.strictEqual(C.message(r.err, 'ru'), 'Нужно число от 0.04 до 0.32 мм');
  assert.strictEqual(C.message(r.err, 'en'), 'Needs a number from 0.04 to 0.32 mm');
  assert.strictEqual(C.check('wall_loops', '2.5').ok, false);
  assert.match(C.message(C.check('wall_loops', '2.5').err, 'ru'), /целое число от 0 до 50/);
  assert.deepStrictEqual(C.check('sparse_infill_density', '20'), { ok: true, value: '20%' });
  assert.deepStrictEqual(C.check('sparse_infill_density', '12,5 %'), { ok: true, value: '12.5%' });
  assert.strictEqual(C.check('sparse_infill_density', '120%').ok, false);
  assert.deepStrictEqual(C.check('line_width', '105%'), { ok: true, value: '105%' });
  assert.deepStrictEqual(C.check('filament_retraction_length', 'nil'), { ok: true, value: 'nil' });
  assert.strictEqual(C.check('nozzle_temperature', 'nil').ok, false);
  assert.deepStrictEqual(C.check('enable_support', 'true'), { ok: true, value: '1' });
  assert.strictEqual(C.check('enable_support', '2').ok, false);
  assert.strictEqual(C.check('sparse_infill_pattern', 'bogus').ok, false);
  assert.ok(C.check('sparse_infill_pattern', 'gyroid').ok);
  assert.strictEqual(C.check('filament_type', 'PLA\nG28').ok, false);
});

test('law: check is idempotent and comma input equals dot input', () => {
  const keys = [...C.ENTRIES.keys()];
  fc.assert(fc.property(fc.constantFrom(...keys), fc.oneof(fc.string(), fc.double({ min: -500, max: 50000, noNaN: true }).map(String)), (key, raw) => {
    const a = C.check(key, raw);
    if (!a.ok) return;
    const b = C.check(key, a.value);
    assert.ok(b.ok, key + ' ' + raw);
    assert.strictEqual(b.value, a.value);
  }), { numRuns: 1500 });
  const nums = keys.filter((k) => C.entry(k).type.t === 'num' && !C.entry(k).type.int);
  fc.assert(fc.property(fc.constantFrom(...nums), fc.integer({ min: 0, max: 10000 }), (key, k) => {
    const ty = C.entry(key).type;
    const v = Math.round((ty.min + (ty.max - ty.min) * (k / 10000)) * 1000) / 1000;
    fc.pre(v >= ty.min && v <= ty.max);
    const dot = C.check(key, String(v));
    const comma = C.check(key, String(v).replace('.', ','));
    assert.deepStrictEqual(comma, dot, key + ' ' + v);
    assert.ok(dot.ok, key + ' ' + v);
  }), { numRuns: 500 });
});

test('engine messages point to the setting', () => {
  const keys = ['layer_height', 'wall_loops', 'initial_layer_print_height', 'sparse_infill_density'];
  assert.strictEqual(C.findKeyInText('Invalid value provided for parameter wall_loops: abc', keys), 'wall_loops');
  assert.strictEqual(C.findKeyInText('Layer height cannot exceed nozzle diameter.', keys), 'layer_height');
  assert.strictEqual(C.findKeyInText('Invalid value provided for parameter nozzle_diameter: x', keys), null);
  assert.strictEqual(C.findKeyInText('Nothing fits on the plate', keys), null);
});

test('real engine: extra keys exist in the engine with the catalog defaults and edits reach the G-code', { skip: noEngine, timeout: 300000 }, async () => {
  const idx = P.buildIndex(engine.profilesDir);
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'slicer-cat-'));
  const cube = writeCube(path.join(src, 'c.stl'), 20);
  const run = async (advanced) => {
    const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicer-cat-job-'));
    const configs = N.composeConfigs(idx, { mode: 'advanced', choice: { filament: 'pla' }, advanced });
    const j = prepareJob({ jobDir, models: [{ path: cube }], configs });
    const r = await slice({ exe: engine.exe, jobDir, ...j });
    return fs.readFileSync(r.gcodePath, 'utf8');
  };
  const plain = await run(null);
  for (const x of C.extras()) {
    const m = new RegExp('^; ' + x.key + ' = (.*)$', 'm').exec(plain);
    assert.ok(m, 'engine knows ' + x.key);
    assert.strictEqual(m[1], x.def, 'default of ' + x.key);
  }
  const g = await run({ process: { fuzzy_skin: 'external', seam_gap: '15%' }, filament: { pla: { filament_shrink: '99.5%', enable_pressure_advance: '1' } } });
  assert.match(g, /^; fuzzy_skin = external$/m);
  assert.match(g, /^; seam_gap = 15%$/m);
  assert.match(g, /^; filament_shrink = 99.5%$/m);
  assert.match(g, /^; enable_pressure_advance = 1$/m);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findEngine } = require('../../src/core/engine-locate');
const P = require('../../src/core/presets');
const N = require('../../src/core/novice');
const { prepareJob } = require('../../src/core/job');
const { slice, engineArgs, EngineError } = require('../../src/core/engine');
const { writeCube } = require('../support/models');

const FAKE = path.join(__dirname, '..', 'support', 'fake-engine.js');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const engine = findEngine();
const noEngine = !engine && 'ElegooSlicer not installed';
let index = null;
const idx = () => (index = index || P.buildIndex(engine.profilesDir));

function job(models, choice, extra = {}) {
  const jobDir = tmp('slicer-job-');
  const configs = N.composeConfigs(idx(), Object.assign({ choice }, extra));
  return Object.assign({ jobDir }, prepareJob({ jobDir, models, configs }));
}

test('fake engine: ok, fail, empty, missing exe', async () => {
  const src = tmp('slicer-src-');
  const cube = writeCube(path.join(src, 'Куб.stl'), 20);
  const jobDir = tmp('slicer-job-');
  const configs = { machine: { name: 'M' }, process: { name: 'P' }, filament: { name: 'F' } };
  const j = prepareJob({ jobDir, models: [{ path: cube }], configs });
  assert.deepStrictEqual(j.modelFiles, ['Kub_1.stl']);
  process.env.FAKE_ENGINE = 'ok';
  const r = await slice({ exe: FAKE, jobDir, ...j });
  assert.strictEqual(r.info.layers, 5);
  assert.strictEqual(r.info.timeSec, 123);
  process.env.FAKE_ENGINE = 'fail';
  await assert.rejects(slice({ exe: FAKE, jobDir, ...j }), (e) => e instanceof EngineError && e.code === 'failed' && /found error/.test(e.detail));
  process.env.FAKE_ENGINE = 'empty';
  await assert.rejects(slice({ exe: FAKE, jobDir, ...j }), (e) => e.code === 'empty');
  process.env.FAKE_ENGINE = 'hang';
  await assert.rejects(slice({ exe: FAKE, jobDir, ...j, timeoutMs: 1500 }), (e) => e.code === 'timeout');
  delete process.env.FAKE_ENGINE;
  await assert.rejects(slice({ exe: path.join(jobDir, 'none.exe'), jobDir, ...j }), (e) => e.code === 'not-found');
});

test('job writes engine-ready presets and refuses odd model types', () => {
  const src = tmp('slicer-src-');
  const jobDir = tmp('slicer-job-');
  const configs = { machine: { name: 'M', from: 'User' }, process: { name: 'P' }, filament: { name: 'F' } };
  const cube = writeCube(path.join(src, 'a.stl'), 10);
  prepareJob({ jobDir, models: [{ path: cube }], configs });
  const m = JSON.parse(fs.readFileSync(path.join(jobDir, 'machine.json'), 'utf8'));
  assert.strictEqual(m.from, 'system');          // с "User" без inherits движок отказывает (код 127)
  assert.strictEqual(m.printer_settings_id, 'M');
  fs.writeFileSync(path.join(src, 'x.exe'), 'x');
  assert.throws(() => prepareJob({ jobDir, models: [{ path: path.join(src, 'x.exe') }], configs }), (e) => e.code === 'bad-model');
  assert.throws(() => prepareJob({ jobDir, models: [], configs }), (e) => e.code === 'no-models');
});

test('real engine: novice cube, values from the resolved presets, no user path in G-code', { skip: noEngine }, async () => {
  const src = tmp('slicer-src-');
  const cube = writeCube(path.join(src, 'Кубик тест.stl'), 20);
  const j = job([{ path: cube }], { filament: 'pla' });
  const r = await slice({ exe: engine.exe, ...j });
  assert.strictEqual(r.info.layers, 100);
  assert.strictEqual(r.info.settings.nozzle_temperature, '210');
  assert.strictEqual(r.info.settings.enable_support, '0');
  assert.strictEqual(r.info.settings.curr_bed_type, 'Textured PEI Plate');
  assert.ok(Number(r.info.filamentG) > 2, 'grams');
  const text = fs.readFileSync(r.gcodePath, 'utf8');
  assert.match(text, /; filament_density: 1\.25/);
  assert.ok(!text.includes(src.replace(/\\/g, '/')) && !text.includes(src) && !text.includes(os.homedir()), 'no source path in G-code');
  assert.ok(!/Users[\\/_]/.test(text.split('; CONFIG_BLOCK_START')[0]), 'no user folder in the G-code body');
});

test('real engine: two models on one plate', { skip: noEngine }, async () => {
  const src = tmp('slicer-src-');
  const a = writeCube(path.join(src, 'a.stl'), 20);
  const b = writeCube(path.join(src, 'b.stl'), 15);
  const j = job([{ path: a }, { path: b }], { filament: 'petg', tempDelta: -5, supports: 'plate', brim: true });
  const r = await slice({ exe: engine.exe, ...j });
  const text = fs.readFileSync(r.gcodePath, 'utf8');
  assert.strictEqual((text.match(/^EXCLUDE_OBJECT_DEFINE /gm) || []).length, 2);
  assert.strictEqual(r.info.settings.nozzle_temperature, '245');   // база PETG 250 - 5
  assert.strictEqual(r.info.settings.brim_type, 'outer_only');
  assert.strictEqual(r.info.settings.textured_plate_temp, '80');
});

test('real engine: model larger than the 256 mm bed is refused with code failed', { skip: noEngine }, async () => {
  const src = tmp('slicer-src-');
  const big = writeCube(path.join(src, 'big.stl'), 300);
  const j = job([{ path: big }], { filament: 'pla' });
  await assert.rejects(slice({ exe: engine.exe, ...j }), (e) => e.code === 'failed' || e.code === 'empty');
});

test('law: our wrapper adds nothing - the same JSON given to the engine directly gives the same G-code', { skip: noEngine }, async () => {
  const src = tmp('slicer-src-');
  const cube = writeCube(path.join(src, 'c.stl'), 20);
  const j = job([{ path: cube }], { filament: 'pla', tempDelta: 3, supports: 'everywhere' });
  const r = await slice({ exe: engine.exe, ...j });
  const direct = tmp('slicer-direct-');
  for (const f of ['machine.json', 'process.json', 'filament.json', ...j.modelFiles]) fs.copyFileSync(path.join(j.jobDir, f), path.join(direct, f));
  fs.mkdirSync(path.join(direct, 'out'));
  fs.mkdirSync(path.join(direct, 'data'));
  try {
    execFileSync(engine.exe, engineArgs(j), { cwd: direct, windowsHide: true });
  } catch (e) { assert.fail('direct engine run failed: ' + e.status); }
  const strip = (t) => t.split(/\r?\n/).filter((l) => !l.startsWith('; generated by')).join('\n');
  assert.strictEqual(strip(fs.readFileSync(r.gcodePath, 'utf8')), strip(fs.readFileSync(path.join(direct, 'out', 'plate_1.gcode'), 'utf8')));
});

test('real engine: tiny binary STL with an empty header still loads (admesh would guess ASCII)', { skip: noEngine }, async () => {
  const src = tmp('slicer-src-');
  for (const size of [10, 12, 15]) {
    const cube = writeCube(path.join(src, 'tiny' + size + '.stl'), size);
    assert.ok(!fs.readFileSync(cube).subarray(80, 208).some((b) => b > 127), 'fixture really looks ASCII to admesh');
    const j = job([{ path: cube }], { filament: 'pla' });
    const r = await slice({ exe: engine.exe, ...j });
    assert.strictEqual(r.info.layers, size * 5, 'layers for ' + size);
    assert.deepStrictEqual(fs.readFileSync(cube), fs.readFileSync(path.join(src, 'tiny' + size + '.stl')), 'source untouched');
  }
});

// А4: движок упал из-за значения настройки - человек видит, какой (код bad-setting с ключом),
// а не «модель больше стола».
test('fake engine: a bad value named in the engine log gives bad-setting with the key', async () => {
  const src = tmp('slicer-src-');
  const cube = writeCube(path.join(src, 'c.stl'), 20);
  const jobDir = tmp('slicer-job-');
  const configs = { machine: { name: 'M' }, process: { name: 'P', layer_height: '0.2' }, filament: { name: 'F' } };
  const j = prepareJob({ jobDir, models: [{ path: cube }], configs });
  process.env.FAKE_ENGINE = 'bad-setting';
  try {
    await assert.rejects(slice({ exe: FAKE, jobDir, ...j, keys: ['layer_height', 'wall_loops'] }),
      (e) => e.code === 'bad-setting' && e.key === 'layer_height' && /Invalid value provided for parameter layer_height: abc/.test(e.detail));
    await assert.rejects(slice({ exe: FAKE, jobDir, ...j }), (e) => e.code === 'failed');
    process.env.FAKE_ENGINE = 'fail';
    await assert.rejects(slice({ exe: FAKE, jobDir, ...j, keys: ['layer_height'] }), (e) => e.code === 'failed');
  } finally { delete process.env.FAKE_ENGINE; }
});

test('real engine: bad values are reported as bad-setting, a big model is not', { skip: noEngine }, async () => {
  const src = tmp('slicer-src-');
  const cube = writeCube(path.join(src, 'c.stl'), 20);
  const run = async (model, processEdit) => {
    const jobDir = tmp('slicer-job-');
    const configs = N.composeConfigs(idx(), { choice: { filament: 'pla' } });
    Object.assign(configs.process, processEdit);
    const j = prepareJob({ jobDir, models: [{ path: model }], configs });
    const keys = [...Object.keys(configs.process), ...Object.keys(configs.filament)];
    return slice({ exe: engine.exe, jobDir, ...j, keys, preferred: Object.keys(processEdit) });
  };
  await assert.rejects(run(cube, { layer_height: 'abc' }), (e) => e.code === 'bad-setting' && e.key === 'layer_height');
  await assert.rejects(run(cube, { layer_height: '5' }), (e) => e.code === 'bad-setting' && e.key === 'layer_height');
  const big = writeCube(path.join(src, 'big.stl'), 300);
  await assert.rejects(run(big, {}), (e) => (e.code === 'failed' || e.code === 'empty') && !e.key);
});

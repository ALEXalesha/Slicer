// Каналы между окном и главным процессом. Окно - чужой код с точки зрения Node: пути,
// адреса и запросы из него проверяются, а не принимаются как есть.
'use strict';
const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Settings = require('../src/core/settings');
const { findEngine } = require('../src/core/engine-locate');
const Presets = require('../src/core/presets');
const Novice = require('../src/core/novice');
const Catalog = require('../src/core/settings-catalog');
const { prepareJob, MODEL_EXT } = require('../src/core/job');
const { slice } = require('../src/core/engine');
const { printerFileName } = require('../src/core/names');
const { sendToPrinter } = require('../src/core/send');
const { discover } = require('../src/core/discovery');
const { PrinterPanel } = require('./printer-session');
const { Worker } = require('worker_threads');
const { parseModel } = require('../src/core/mesh');
const { parseGcodePreview } = require('../src/core/gcode-preview');
const { buildProject3mf } = require('../src/core/project3mf');
const { bounds, multiply } = require('../src/core/geom');
const { safeBase } = require('../src/core/names');

const BED = 256;
const MAX_OBJECTS = 500;
const MAX_TRIANGLES = 30e6;

// Разбор в отдельном потоке; если поток не завёлся (например, внутри упакованного app.asar
// что-то не так) - разбираем здесь же: медленнее для окна, но работает.
function runWorker(kind, file) {
  return new Promise((resolve) => {
    let w;
    const inline = () => {
      try {
        const result = kind === 'model' ? parseModel(fs.readFileSync(file), file) : parseGcodePreview(fs.readFileSync(file, 'utf8'));
        resolve({ ok: true, result });
      } catch (e) { resolve({ ok: false, code: e.code || 'bad-file', detail: String(e.detail || e.message || '') }); }
    };
    try { w = new Worker(path.join(__dirname, 'worker.js'), { workerData: { kind, path: file } }); } catch { inline(); return; }
    let done = false;
    w.once('message', (m) => { done = true; resolve(m); w.terminate(); });
    w.once('error', () => { if (!done) { done = true; inline(); } });
    w.once('exit', () => { if (!done) { done = true; inline(); } });
  });
}

/**
 * Модели стола из окна -> проверенные объекты для 3MF. Окно - чужой код: проверяем типы,
 * размеры и числа. Модель за краем стола - отказ с именами (ревьювер 17.10: движок молча
 * раскладывал лишнее на другие пластины, печаталась только первая).
 */
function checkPlate(list) {
  if (!Array.isArray(list) || !list.length) return { error: { ok: false, code: 'no-models' } };
  if (list.length > MAX_OBJECTS) return { error: { ok: false, code: 'too-many', detail: String(list.length) } };
  const out = [];
  const offBed = [];
  let tris = 0;
  for (const o of list) {
    if (!o || !(o.positions instanceof Float32Array) || !o.positions.length || o.positions.length % 9) return { error: { ok: false, code: 'bad-model' } };
    if (!Array.isArray(o.matrix) || o.matrix.length !== 16 || !o.matrix.every(Number.isFinite)) return { error: { ok: false, code: 'bad-model' } };
    const paint = o.paint instanceof Uint8Array && o.paint.length === o.positions.length / 9 ? o.paint : null;
    tris += o.positions.length / 9;
    if (tris > MAX_TRIANGLES) return { error: { ok: false, code: 'too-big' } };
    const b = bounds(o.positions, o.matrix);
    if (![...b.min, ...b.max].every(Number.isFinite)) return { error: { ok: false, code: 'bad-model' } };
    const name = String(typeof o.name === 'string' ? o.name : 'model');
    // на стол: низ модели ровно на z = 0
    const matrix = Math.abs(b.min[2]) > 1e-6 ? multiply([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -b.min[2], 1], o.matrix) : o.matrix;
    const e = 0.01;
    if (b.min[0] < -e || b.min[1] < -e || b.max[0] > BED + e || b.max[1] > BED + e || b.size[2] > BED + e) offBed.push(name);
    out.push({ name: safeBase(name.replace(/\.(stl|3mf|obj)$/i, ''), 40) || 'model', title: name, positions: o.positions, matrix, paint });
  }
  if (offBed.length) return { error: { ok: false, code: 'off-bed', names: offBed } };
  return { objects: out, painted: { enforce: out.some((o) => o.paint && o.paint.includes(1)), block: out.some((o) => o.paint && o.paint.includes(2)) } };
}

const MAX_MODEL_BYTES = 512 * 1024 * 1024;

function isModelPath(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
  if (!MODEL_EXT.includes(path.extname(p).toLowerCase())) return false;
  try { const st = fs.statSync(p); return st.isFile() && st.size > 0 && st.size <= MAX_MODEL_BYTES; } catch { return false; }
}

function jobsRoot() {
  return process.env.SLICER_JOBS_DIR || path.join(os.tmpdir(), 'SlicerCC');
}

// Старые папки заданий: оставляем три последние, остальное - в мусор (это временные файлы).
function cleanJobs(root, keep = 3) {
  let dirs = [];
  try { dirs = fs.readdirSync(root).filter((d) => d.startsWith('job-')).sort(); } catch { return; }
  for (const d of dirs.slice(0, Math.max(0, dirs.length - keep))) {
    try { fs.rmSync(path.join(root, d), { recursive: true, force: true }); } catch { /* занято - в следующий раз */ }
  }
}

function registerIpc(ctx) {
  const settingsFile = path.join(ctx.userData, 'settings.json');
  let settings = Settings.load(settingsFile);
  const persist = () => { if (!ctx.test || process.env.SLICER_TEST_SAVE === '1') Settings.save(settingsFile, settings); };
  const send = (channel, data) => { const w = ctx.getWindow(); if (w && !w.isDestroyed()) w.webContents.send(channel, data); };

  let engine = null, index = null;
  const getIndex = () => {
    engine = engine || findEngine();
    if (!engine) return null;
    index = index || Presets.buildIndex(engine.profilesDir);
    return index;
  };
  let last = null;            // последняя нарезка: {gcodePath, info, modelName, filament}
  let sending = false;

  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_e, patch) => {
    settings = Settings.normalize(Object.assign({}, settings, patch && typeof patch === 'object' ? patch : {}));
    persist();
    return settings;
  });

  ipcMain.handle('models:open', async () => {
    const r = await dialog.showOpenDialog(ctx.getWindow(), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'STL, 3MF, OBJ', extensions: ['stl', '3mf', 'obj'] }],
    });
    if (r.canceled) return [];
    return (r.filePaths || []).filter(isModelPath);
  });

  ipcMain.handle('models:read', (_e, p) => {
    if (!isModelPath(p)) return null;
    const b = fs.readFileSync(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  });

  ipcMain.handle('models:load', async (_e, p) => {
    if (!isModelPath(p)) return { ok: false, code: 'bad-path' };
    const r = await runWorker('model', p);
    if (!r.ok) return r;
    return { ok: true, objects: r.result.objects, warnings: r.result.warnings };
  });

  ipcMain.handle('preview', async () => {
    if (!last || !fs.existsSync(last.gcodePath)) return { ok: false, code: 'no-gcode' };
    const r = await runWorker('preview', last.gcodePath);
    return r.ok ? { ok: true, preview: r.result } : r;
  });

  ipcMain.handle('presets:info', () => {
    let idx = null;
    try { idx = getIndex(); } catch { idx = null; }
    const filaments = Novice.FILAMENTS.map((f) => {
      let temp = null;
      if (idx) {
        try {
          const full = Object.assign(Presets.resolvePreset(idx, 'filament', f.preset), f.extra);
          temp = Number(full.nozzle_temperature && full.nozzle_temperature[0]) || null;
        } catch { temp = null; }
      }
      return { id: f.id, label: f.label, tested: f.tested, temp };
    });
    return { engine: !!idx, filaments, qualities: Novice.QUALITIES, plates: Novice.PLATES, tempLimit: Novice.TEMP_LIMIT };
  });

  // База «Продвинутого»: собранные пресеты с выбором «Новичка», качеством и пластиной, без правок.
  ipcMain.handle('presets:full', (_e, req) => {
    let idx;
    try { idx = getIndex(); } catch { idx = null; }
    if (!idx) return null;
    const r = req && typeof req === 'object' ? req : {};
    const quality = Novice.QUALITIES.includes(r.quality) ? r.quality : settings.quality;
    const plate = Novice.PLATES.includes(r.plate) ? r.plate : settings.plate;
    const c = Novice.composeConfigs(idx, { mode: 'advanced', choice: r.choice || settings.choice, quality, plate });
    return { process: c.process, filament: c.filament };
  });

  async function sliceFiles(r) {
    const models = r.models.filter((m) => m && isModelPath(m.path))
      .map((m) => ({ path: m.path, name: typeof m.name === 'string' ? m.name : '' }));
    if (!models.length) return { ok: false, code: 'no-models' };
    let idx;
    try { idx = getIndex(); } catch (e) { return { ok: false, code: 'preset', detail: e.message }; }
    if (!idx) return { ok: false, code: 'not-found' };
    try {
      const mode = r.mode === 'advanced' ? 'advanced' : 'novice';
      const configs = Novice.composeConfigs(idx, { mode, choice: r.choice, advanced: settings.advanced, quality: settings.quality, plate: settings.plate });
      const root = jobsRoot();
      cleanJobs(root);
      const jobDir = path.join(root, 'job-' + Date.now());
      const job = prepareJob({ jobDir, models, configs });
      const keys = [...Object.keys(configs.process), ...Object.keys(configs.filament)];
      const adv = settings.advanced;
      const preferred = mode === 'advanced' ? [...Object.keys(adv.process), ...Object.keys(Novice.filamentEdits(adv, configs.choice.filament))] : [];
      last = null;
      const res = await slice({ exe: engine.exe, jobDir, ...job, keys, preferred });
      const fil = Novice.filamentInfo(configs.choice.filament);
      last = { gcodePath: res.gcodePath, info: res.info, modelName: models[0].name || path.basename(models[0].path), filament: fil.label };
      const { settings: _s, ...short } = res.info;
      return { ok: true, info: short, temp: res.info.settings.nozzle_temperature, name: printerFileName({ model: last.modelName, filament: fil.label, timeSec: res.info.timeSec }) };
    } catch (e) {
      // bad-setting: в detail сразу понятное «Высота слоя» (layer_height): причина движка.
      const detail = String(e.detail || e.message || '');
      if (e.code === 'bad-setting' && e.key) {
        const label = Catalog.label(e.key, settings.lang) || e.key;
        return { ok: false, code: 'bad-setting', key: e.key, detail: '«' + label + '» (' + e.key + '): ' + detail };
      }
      return { ok: false, code: e.code || 'failed', detail };
    }
  }

  ipcMain.handle('slice', async (_e, req) => {
    const r = req && typeof req === 'object' ? req : {};
    // Старый путь (окно 0.1.0 шлёт пути файлов): движок сам расставляет. Уйдёт, когда окно
    // перейдёт на модели стола (objects).
    if (!r.objects && Array.isArray(r.models)) return sliceFiles(r);
    const plate = checkPlate(r.objects);
    if (plate.error) return plate.error;
    let idx;
    try { idx = getIndex(); } catch (e) { return { ok: false, code: 'preset', detail: e.message }; }
    if (!idx) return { ok: false, code: 'not-found' };
    try {
      const mode = r.mode === 'advanced' ? 'advanced' : 'novice';
      const configs = Novice.composeConfigs(idx, { mode, choice: r.choice, advanced: settings.advanced, quality: settings.quality, plate: settings.plate });
      Novice.applyPaintedSupports(configs.process, configs.choice, plate.painted);
      const root = jobsRoot();
      cleanJobs(root);
      const jobDir = path.join(root, 'job-' + Date.now());
      const buffer = buildProject3mf(plate.objects);
      const job = prepareJob({ jobDir, models: [{ path: 'plate.3mf', name: 'plate', buffer }], configs });
      last = null;
      const res = await slice({ exe: engine.exe, jobDir, ...job, arrange: 0 });
      const fil = Novice.filamentInfo(configs.choice.filament);
      last = { gcodePath: res.gcodePath, info: res.info, modelName: plate.objects[0].title, filament: fil.label };
      const { settings: _s, ...short } = res.info;
      return { ok: true, info: short, temp: res.info.settings.nozzle_temperature, objects: plate.objects.length, name: printerFileName({ model: last.modelName, filament: fil.label, timeSec: res.info.timeSec }) };
    } catch (e) {
      return { ok: false, code: e.code || 'failed', detail: String(e.detail || e.message || '') };
    }
  });

  ipcMain.handle('export', async () => {
    if (!last || !fs.existsSync(last.gcodePath)) return { ok: false, code: 'no-gcode' };
    const name = printerFileName({ model: last.modelName, filament: last.filament, timeSec: last.info.timeSec });
    const r = await dialog.showSaveDialog(ctx.getWindow(), { defaultPath: name, filters: [{ name: 'G-code', extensions: ['gcode'] }] });
    if (r.canceled || !r.filePath) return { ok: false, code: 'canceled' };
    fs.copyFileSync(last.gcodePath, r.filePath);
    return { ok: true, path: r.filePath };
  });

  ipcMain.handle('print', async (_e, opts) => {
    if (!last || !fs.existsSync(last.gcodePath)) return { ok: false, code: 'no-gcode' };
    if (sending) return { ok: false, code: 'sending' };
    sending = true;
    try {
      let host = settings.printerHost;
      if (!host) {
        const found = await discover({ timeoutMs: 2000 });
        if (!found.length) return { ok: false, code: 'no-host' };
        host = found[0].host;
      }
      const buffer = fs.readFileSync(last.gcodePath);
      const remoteName = printerFileName({ model: last.modelName, filament: last.filament, timeSec: last.info.timeSec });
      const start = !(opts && opts.start === false);
      const r = await sendToPrinter({ host, buffer, remoteName, start, bedLeveling: settings.bedLeveling, onStep: (s) => send('send:step', s) });
      return Object.assign({ host }, r);
    } catch (e) {
      const { code, message, stack, ...rest } = e;
      return Object.assign({ ok: false, code: code || 'failed', detail: message }, rest);
    } finally {
      sending = false;
    }
  });

  ipcMain.handle('printer:discover', async () => discover({ timeoutMs: 2000 }));

  const panel = new PrinterPanel({ send });
  ipcMain.handle('printer:connect', (_e, host) => panel.connect(Settings.isHost(host) && host ? host : settings.printerHost));
  ipcMain.handle('printer:disconnect', () => panel.disconnect());
  ipcMain.handle('printer:command', (_e, what) => panel.command(what));
  ipcMain.handle('printer:camera', () => panel.camera());
  ipcMain.handle('aifp:poll', () => panel.aiState());
  ipcMain.handle('aifp:dismiss', (_e, id) => panel.dismiss(id));

  return { get settings() { return settings; }, panel };
}

module.exports = { registerIpc, isModelPath, cleanJobs, checkPlate };

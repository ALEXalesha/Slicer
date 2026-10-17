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
const { prepareJob, MODEL_EXT } = require('../src/core/job');
const { slice } = require('../src/core/engine');
const { printerFileName } = require('../src/core/names');
const { sendToPrinter } = require('../src/core/send');
const { discover } = require('../src/core/discovery');
const { PrinterPanel } = require('./printer-session');

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

  ipcMain.handle('presets:full', (_e, req) => {
    const idx = getIndex();
    if (!idx) return null;
    const r = req && typeof req === 'object' ? req : {};
    const c = Novice.composeConfigs(idx, { mode: 'novice', choice: r.choice || settings.choice, quality: r.quality, plate: r.plate });
    const base = Novice.composeConfigs(idx, { mode: 'advanced', choice: r.choice || settings.choice, quality: r.quality || settings.quality, plate: r.plate || settings.plate });
    return { process: base.process, filament: base.filament, novice: { process: c.process, filament: c.filament } };
  });

  ipcMain.handle('slice', async (_e, req) => {
    const r = req && typeof req === 'object' ? req : {};
    const models = (Array.isArray(r.models) ? r.models : []).filter((m) => m && isModelPath(m.path))
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
      const res = await slice({ exe: engine.exe, jobDir, ...job });
      const fil = Novice.filamentInfo(configs.choice.filament);
      last = { gcodePath: res.gcodePath, info: res.info, modelName: models[0].name || path.basename(models[0].path), filament: fil.label };
      const { settings: _s, ...short } = res.info;
      return { ok: true, info: short, temp: res.info.settings.nozzle_temperature, name: printerFileName({ model: last.modelName, filament: fil.label, timeSec: res.info.timeSec }) };
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

module.exports = { registerIpc, isModelPath, cleanJobs };

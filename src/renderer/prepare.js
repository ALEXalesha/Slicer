// Раздел «Подготовка»: модели на столе, три выбора «Новичка», нарезка, экспорт, печать.
import { t, formatTime } from './i18n.js';
import { onSettings, getSettings, patchSettings } from './app.js';
import { Viewer } from './viewer.js';
import { confirmHost } from './ask.js';

const $ = (s) => document.querySelector(s);
const S = window.slicer;
const viewer = new Viewer($('#viewer'));
const models = [];           // {path, name, object}
let info = null;             // presets:info
let choice = { filament: 'pla', tempDelta: 0, supports: 'none', brim: false };
let sliced = null;           // результат последней нарезки
let busy = false;

function setStatus(text, kind = '') {
  const el = $('#status');
  el.textContent = text || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function invalidate() {
  if (sliced && $('#status').classList.contains('ok')) setStatus('');
  sliced = null;
  $('#result').hidden = true;
  $('#print').disabled = true;
  $('#export').disabled = true;
}

function renderModels() {
  const box = $('#models');
  box.textContent = '';
  for (const [i, m] of models.entries()) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    const name = document.createElement('span');
    name.textContent = m.name;
    name.title = m.name;
    const rm = document.createElement('button');
    rm.textContent = '×';
    rm.title = t('stage.remove');
    rm.dataset.remove = String(i);
    rm.addEventListener('click', () => { models.splice(i, 1); renderModels(); invalidate(); });
    chip.append(name, rm);
    box.append(chip);
  }
  $('#drop-hint').classList.toggle('has-models', models.length > 0);
  $('#open-models').textContent = models.length ? t('stage.add') : t('stage.open');
  viewer.setModels(models.map((m) => m.object).filter(Boolean));
}

async function addModels(paths) {
  for (const p of paths) {
    if (!p || models.some((m) => m.path === p)) continue;
    const name = p.split(/[\\/]/).pop();
    const buf = await S.readModel(p);
    if (!buf) { setStatus(t('stage.badFile', { name, why: '?' }), 'error'); continue; }
    let object = null;
    try { object = Viewer.parse(name, buf); } catch (e) {
      if (viewer.ok) { setStatus(t('stage.badFile', { name, why: e.message }), 'error'); continue; }
    }
    models.push({ path: p, name, object });
  }
  renderModels();
  invalidate();
}

function renderChoice() {
  const fil = info ? info.filaments.find((f) => f.id === choice.filament) : null;
  for (const b of document.querySelectorAll('#filament button')) b.classList.toggle('active', b.dataset.value === choice.filament);
  for (const b of document.querySelectorAll('#supports button')) b.classList.toggle('active', b.dataset.value === choice.supports);
  $('#filament-hint').textContent = t('fil.' + choice.filament) + (fil && !fil.tested ? ' (' + t('fil.untested') + ')' : '');
  $('#supports-hint').textContent = t('supports.hint.' + choice.supports);
  $('#temp').value = String(choice.tempDelta);
  const d = choice.tempDelta;
  $('#temp-value').textContent = (d > 0 ? '+' : '') + d + ' °C';
  $('#temp-hint').textContent = fil && fil.temp
    ? t('novice.tempNow', { t: fil.temp + d, b: fil.temp }) + '. ' + t('novice.tempHint')
    : t('novice.tempHint');
  $('#brim').checked = choice.brim;
}

function setChoice(patch) {
  choice = Object.assign({}, choice, patch);
  renderChoice();
  invalidate();
  patchSettings({ choice });
}

function buildFilaments() {
  const box = $('#filament');
  box.textContent = '';
  for (const f of info.filaments) {
    const b = document.createElement('button');
    b.dataset.value = f.id;
    b.textContent = f.label;
    b.addEventListener('click', () => setChoice({ filament: f.id }));
    box.append(b);
  }
}

const ENGINE_CODES = ['not-found', 'failed', 'timeout', 'empty', 'bad-setting'];

async function doSlice() {
  if (busy) return;
  if (!models.length) { setStatus(t('act.needModel'), 'error'); return; }
  busy = true;
  invalidate();
  $('#slice').disabled = true;
  setStatus(t('act.slicing'));
  try {
    const r = await S.slice({ models: models.map((m) => ({ path: m.path, name: m.name })), mode: document.querySelector('#mode button.active').dataset.mode, choice });
    if (!r.ok) {
      const key = ENGINE_CODES.includes(r.code) ? 'eng.' + r.code : r.code === 'preset' ? 'eng.preset' : r.code === 'no-models' ? 'act.needModel' : 'eng.failed';
      setStatus(t(key, { why: r.detail || '' }), 'error');
      return;
    }
    sliced = r;
    $('#res-time').textContent = t('res.time', { t: formatTime(r.info.timeSec) });
    $('#res-weight').textContent = r.info.filamentG ? t('res.weight', { g: Math.round(r.info.filamentG * 10) / 10 }) : '';
    $('#res-layers').textContent = t('res.layers', { n: r.info.layers });
    $('#result').hidden = false;
    $('#print').disabled = false;
    $('#export').disabled = false;
    setStatus(r.name, 'ok');
  } finally {
    busy = false;
    $('#slice').disabled = false;
  }
}

async function doExport() {
  const r = await S.exportGcode();
  if (r.ok) setStatus(t('exp.saved', { path: r.path }), 'ok');
}

const STEPS = ['connect', 'check-idle', 'upload', 'verify', 'start', 'started'];

function stepList() {
  const ol = $('#send-steps');
  ol.textContent = '';
  for (const s of STEPS) {
    const li = document.createElement('li');
    li.dataset.step = s;
    li.textContent = t('send.' + s);
    ol.append(li);
  }
  ol.hidden = false;
  return ol;
}

function markStep(ol, step, extra) {
  const i = STEPS.indexOf(step);
  for (const li of ol.children) {
    const j = STEPS.indexOf(li.dataset.step);
    li.className = j < i ? 'done' : j === i ? 'now' : '';
  }
  const li = ol.querySelector(`[data-step="${step}"]`);
  if (li && extra) li.textContent = t('send.' + step) + ' ' + extra;
}

function sendError(r) {
  const n = r.attempts || 3;
  switch (r.code) {
    case 'offline': return t('send.offline');
    case 'busy': return t('send.busy');
    case 'no-host': return t('send.noHost');
    case 'upload': return t('send.upload-failed', { n, why: r.detail || '' });
    case 'not-listed': return t('send.not-listed', { n });
    case 'size-mismatch': return t('send.size-mismatch', { got: r.got, want: r.want, n });
    case 'start-rejected': return t('send.start-rejected', { ack: r.ack, why: t(['1', '2', '3', '4', '5', '6', '7'].includes(String(r.ack)) ? 'ack.' + r.ack : 'ack.x') });
    case 'not-started': return t('send.not-started');
    case 'host-canceled': return t('send.hostCanceled');
    default: return t('send.offline');
  }
}

async function doPrint() {
  if (busy || !sliced) return;
  busy = true;
  $('#print').disabled = true;
  $('#slice').disabled = true;
  setStatus('');
  const ol = stepList();
  const off = S.onSendStep((s) => {
    let extra = '';
    if (s.step === 'upload' && s.total) extra = Math.floor((s.sent / s.total) * 100) + ' %' + (s.attempt > 1 ? ', ' + t('send.retry', { n: s.attempt, max: s.attempts }) : '');
    markStep(ol, s.step, extra);
  });
  try {
    let r = await S.print({ start: true });
    // Адрес не задан: главный процесс не печатает на первый найденный молча, а спрашивает.
    if (r.code === 'confirm-host') {
      const host = await confirmHost(r.found);
      if (host) { await patchSettings({ printerHost: host }); r = await S.print({ start: true }); }
      else r = { ok: false, code: 'host-canceled' };
    }
    if (r.ok) {
      for (const li of ol.children) li.className = 'done';
      setStatus(t('send.ok', { name: r.name }), 'ok');
    } else {
      const now = ol.querySelector('.now');
      if (now) now.className = 'fail';
      setStatus(sendError(r), 'error');
    }
  } finally {
    off();
    busy = false;
    $('#print').disabled = !sliced;
    $('#slice').disabled = false;
  }
}

function wireDrop() {
  const stage = $('#stage');
  stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('drag'); });
  stage.addEventListener('dragleave', () => stage.classList.remove('drag'));
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('drag');
    const paths = [...(e.dataTransfer.files || [])].map((f) => S.pathForFile(f)).filter((p) => /\.(stl|3mf|obj)$/i.test(p));
    addModels(paths);
  });
  // Брошенный мимо стола файл не открывает его как страницу.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
}

async function init() {
  info = await S.presetsInfo();
  buildFilaments();
  const saved = getSettings().choice;
  if (saved) choice = Object.assign(choice, saved);
  if (!info.filaments.some((f) => f.id === choice.filament)) choice.filament = 'pla';
  renderChoice();
  if (!info.engine) setStatus(t('eng.not-found'), 'error');
  $('#temp').addEventListener('input', (e) => setChoice({ tempDelta: Number(e.target.value) }));
  for (const b of document.querySelectorAll('#supports button')) b.addEventListener('click', () => setChoice({ supports: b.dataset.value }));
  $('#brim').addEventListener('change', (e) => setChoice({ brim: e.target.checked }));
  $('#open-models').addEventListener('click', async () => addModels(await S.openModels()));
  $('#slice').addEventListener('click', doSlice);
  $('#export').addEventListener('click', doExport);
  $('#print').addEventListener('click', doPrint);
  wireDrop();
  document.addEventListener('slicer:lang', () => { renderChoice(); renderModels(); });
  document.addEventListener('slicer:mode', invalidate);
  document.addEventListener('slicer:advanced', invalidate);
  onSettings(() => {});
}

await init();
window.slicerPrepare = { addModels, models: () => models.map((m) => m.name), choice: () => choice };

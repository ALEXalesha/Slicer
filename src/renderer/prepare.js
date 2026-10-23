// Раздел «Подготовка»: модели на столе (редактор - editor.js), три выбора «Новичка»,
// нарезка, слои (preview.js), экспорт, печать.
import { t, formatTime, num } from './i18n.js';
import { onSettings, getSettings, patchSettings } from './app.js';
import { Editor } from './editor.js';
import { Preview } from './preview.js';
import { confirmHost, ask } from './ask.js';
import * as History from './history.js';

const $ = (s) => document.querySelector(s);
const S = window.slicer;
let info = null;             // presets:info
let choice = { filament: 'pla', tempDelta: 0, supports: 'none', brim: false };
let sliced = null;           // результат последней нарезки
let busy = false;
let gen = 0;                 // поколение стола и выборов: нарезка, начатая до изменения, устарела (ревьювер А2)
let status = { key: '', vars: {}, kind: '' };
let sendState = null;        // {step, extra, done, fail}

const editor = new Editor({ onChange: () => { invalidate(true); renderModels(); }, onStatus: (key, vars, kind) => setStatus(key, vars, kind) });
editor.supportsNone = () => choice.supports === 'none';
editor.confirm = (key, vars) => ask(t(key, vars), t(key + '.yes'), t('ask.no'));
editor.spacing = () => (choice.supports !== 'none' || editor.painted() ? 12 : 6);
const preview = new Preview(editor.scene);

// Статус хранится ключом и параметрами: при смене языка перерисовывается (ревьювер Б1).
function setStatus(key, vars = {}, kind = '') {
  status = { key, vars, kind };
  drawStatus();
}

function drawStatus() {
  const el = $('#status');
  const { key, vars, kind } = status;
  el.textContent = key ? (key === '=' ? vars.text : t(key, vars)) : '';
  el.title = vars && vars.title ? vars.title : el.textContent;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

// Статусы прошлого действия над столом (нарезка, расстановка, разрез, экспорт, печать)
// после следующей правки стола уже неправда: зелёное «Все модели на столе.» висело, когда
// модель ушла за край (обзор 0.2 Б1). Остаются только «движок не найден» и загрузка файла.
// Смена режима или настройки стол не трогает: «движок не принял настройку X» должна дожить
// до вкладки «Продвинутый».
function stale(s) {
  if (!s.key || s.key === 'eng.not-found' || s.key.startsWith('stage.')) return false;
  return s.kind === 'ok' || s.kind === 'error' || /^(arr|eng|act|cut|exp|send)\./.test(s.key) || s.key === '=';
}

function invalidate(plate = false) {
  gen++;
  if (plate === true ? stale(status) : sliced && status.kind === 'ok') setStatus('');
  sliced = null;
  $('#result').hidden = true;
  $('#print').disabled = true;
  $('#export').disabled = true;
  $('#send-steps').hidden = true;          // старый список шагов печати не висит (ревьювер Б5)
  sendState = null;
  $('#show-layers').disabled = true;
  preview.clear();
  showStage('models');
}

function showStage(mode) {
  for (const b of document.querySelectorAll('#view-switch button')) b.classList.toggle('active', b.dataset.show === mode);
  editor.scene.setMode(mode);
  $('#legend').hidden = mode !== 'layers';
  $('#layers').hidden = mode !== 'layers';
  $('#left-col').hidden = mode !== 'models';           // и шапка «Моделей: N» не висит над легендой слоёв
  $('#models').hidden = mode !== 'models';
  $('#drop-hint').hidden = mode !== 'models';
  $('#show-layers').title = $('#show-layers').disabled ? t('view.needSlice') : '';
  editor.refreshPanel();
}

function renderModels() {
  const box = $('#models');
  box.textContent = '';
  const states = editor.states();
  for (const s of states) {
    const chip = document.createElement('div');
    chip.className = 'chip' + (s.selected ? ' selected' : '') + (s.off ? ' off' : '');
    chip.dataset.uid = String(s.uid);
    const name = document.createElement('span');
    name.textContent = s.name;
    name.title = s.name;                    // полное имя - в подсказке (пункт 9)
    name.addEventListener('click', (e) => editor.select(editor.items.find((i) => i.uid === s.uid), e.ctrlKey || e.shiftKey));
    const rm = document.createElement('button');
    rm.textContent = '×';
    rm.title = t('stage.remove');
    rm.dataset.remove = String(s.uid);
    rm.addEventListener('click', () => editor.removeWithNote([editor.items.find((i) => i.uid === s.uid)]));
    chip.append(name, rm);
    box.append(chip);
  }
  // Шапка списка: сколько моделей и сколько за краем, кнопка «Убрать лишние» (обзор 23.10 А3, В11).
  const head = $('#models-head');
  head.textContent = '';
  const off = states.filter((s) => s.off).length;
  head.hidden = states.length < 2 && !off;
  if (!head.hidden) {
    const n = document.createElement('span');
    n.textContent = t('stage.count', { n: states.length });
    head.append(n);
    if (off) {
      const b = document.createElement('button');
      b.id = 'remove-off';
      b.className = 'danger';
      b.textContent = t('stage.removeOff', { n: off });
      b.title = t('stage.removeOffHint');
      b.addEventListener('click', () => { const k = editor.removeOff(); if (k) setStatus('act.removed', { n: k }, ''); });
      head.append(b);
    }
  }
  $('#drop-hint').classList.toggle('has-models', states.length > 0);
  $('#open-models').textContent = states.length ? t('stage.add') : t('stage.open');
  editor.refreshToolbar();
}
editor.onSelect = renderModels;

async function addModels(paths) {
  for (const p of paths) {
    if (!p) continue;
    const name = p.split(/[\\/]/).pop();
    setStatus('stage.loading', { name });
    const r = await S.loadModel(p);
    if (!r || !r.ok) { setStatus('stage.badFile', { name, why: t('mesh.' + ((r && r.code) || 'bad-path')) }, 'error'); continue; }
    editor.add(r.objects, name);
    const warn = (r.warnings || []).filter((w) => w.startsWith('warn') || ['modifier_part', 'negative_part', 'support_enforcer', 'support_blocker', 'not-printable', 'missing-object'].includes(w));
    if (warn.length) setStatus('stage.warn', { name, what: warn.map((w) => t('warn.' + w)).join(', ') });
    else setStatus('');
  }
  renderModels();
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
  const before = choice;
  choice = Object.assign({}, choice, patch);
  // Ctrl+Z возвращает и выбор «Новичка»; ползунок температуры - одним шагом на всё движение.
  if (JSON.stringify(before) !== JSON.stringify(choice)) History.pushChange('tempDelta' in patch ? 'choice.temp' : '', before, choice, applyChoice);
  renderChoice();
  invalidate();
  editor.refreshPanel();
  patchSettings({ choice });
}

function applyChoice(c) {
  choice = Object.assign({}, c);
  renderChoice();
  invalidate();
  editor.refreshPanel();
  return patchSettings({ choice });
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

const ENGINE_CODES = ['not-found', 'failed', 'timeout', 'empty', 'bad-setting', 'plates', 'too-big', 'too-many', 'bad-model'];

function renderResult() {
  if (!sliced) return;
  $('#res-time').textContent = t('res.time', { t: formatTime(sliced.info.timeSec) });
  $('#res-weight').textContent = sliced.info.filamentG ? t('res.weight', { g: num(sliced.info.filamentG, 1) }) : '';
  $('#res-layers').textContent = t('res.layers', { n: sliced.info.layers });
}

async function doSlice() {
  if (busy) return;
  if (!editor.items.length) { setStatus('act.needModel', {}, 'error'); return; }
  busy = true;
  invalidate();
  const my = gen;
  $('#slice').disabled = true;
  setStatus('act.slicing');
  try {
    const r = await S.slice({ objects: editor.forSlice(), mode: document.querySelector('#mode button.active').dataset.mode, choice });
    if (my !== gen) { setStatus('act.stale', {}, 'error'); return; }
    if (!r.ok) {
      if (r.code === 'off-bed') setStatus('eng.off-bed', { names: (r.names || []).join(', ') }, 'error');
      else if (r.code === 'conflict') setStatus('eng.conflict', { a: (r.names || [])[0] || '', b: (r.names || [])[1] || '' }, 'error');
      else if (r.code === 'no-models') setStatus('act.needModel', {}, 'error');
      else if (r.code === 'preset') setStatus('eng.preset', { why: r.detail || '' }, 'error');
      else setStatus(ENGINE_CODES.includes(r.code) ? 'eng.' + r.code : 'eng.failed', { why: r.detail || '' }, 'error');
      return;
    }
    sliced = r;
    renderResult();
    $('#result').hidden = false;
    $('#print').disabled = false;
    $('#export').disabled = false;
    setStatus('act.sliced', { name: r.name }, 'ok');            // В3: не одно имя файла, а «Нарезано: …»
    const p = await S.preview();
    if (my !== gen || !p || !p.ok) return;
    preview.set(p.preview);
    $('#show-layers').disabled = false;
    showStage('layers');
    editor.scene.fitBox(editor.platedBox());      // Б9: слои - ближе к моделям; «весь стол» - кнопкой
  } finally {
    busy = false;
    $('#slice').disabled = false;
  }
}

async function doExport() {
  const r = await S.exportGcode();
  if (r.ok) setStatus('exp.saved', { path: r.path.split(/[\\/]/).pop(), title: r.path }, 'ok');     // путь целиком - в подсказке (ревьювер Б2)
}

const STEPS = ['connect', 'check-idle', 'upload', 'verify', 'start', 'started'];

function drawSteps() {
  const ol = $('#send-steps');
  ol.textContent = '';
  if (!sendState) { ol.hidden = true; return; }
  ol.hidden = false;
  const i = STEPS.indexOf(sendState.step);
  for (const s of STEPS) {
    const li = document.createElement('li');
    li.dataset.step = s;
    const j = STEPS.indexOf(s);
    li.textContent = t('send.' + s) + (s === sendState.step && sendState.extra ? ': ' + sendState.extra : '');
    li.className = sendState.done ? 'done' : j < i ? 'done' : j === i ? (sendState.fail ? 'fail' : 'now') : '';
    ol.append(li);
  }
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

// Где остановилась неудачная отправка (обзор 23.10 Б3: «занят» красил шаг «Связь с принтером»).
const FAIL_STEP = { offline: 'connect', 'no-host': 'connect', 'host-canceled': 'connect', busy: 'check-idle', upload: 'upload',
  'not-listed': 'verify', 'size-mismatch': 'verify', 'start-rejected': 'start', 'not-started': 'start' };

// Отменить можно до команды старта: она уходит один раз, дальше печать идёт на принтере (Б4).
function showCancel(on) {
  const b = $('#send-cancel');
  b.hidden = !on;
  if (on) { b.disabled = false; b.textContent = t('send.cancel'); }
}

async function doPrint() {
  if (busy || !sliced) return;
  busy = true;
  $('#print').disabled = true;
  $('#slice').disabled = true;
  setStatus('');
  sendState = { step: 'connect', extra: '' };
  drawSteps();
  showCancel(true);
  const off = S.onSendStep((s) => {
    let extra = '';
    if (s.step === 'upload' && s.total) extra = Math.floor((s.sent / s.total) * 100) + ' %' + (s.attempt > 1 ? ', ' + t('send.retry', { n: s.attempt, max: s.attempts }) : '');
    // Б4: ожидание «принтер видит файл» - не тишина до минуты, а попытка и секунды.
    if (s.step === 'verify' && s.attempts) extra = t('send.verifyWait', { n: s.attempt, max: s.attempts, s: s.waitedSec || 0, total: s.timeoutSec || 0 });
    if (s.step === 'start' || s.step === 'started') showCancel(false);
    sendState = { step: s.step, extra };
    drawSteps();
  });
  try {
    let r = await S.print({ start: true });
    // Адрес не задан: главный процесс не печатает на первый найденный молча, а спрашивает.
    if (r.code === 'confirm-host') {
      const host = await confirmHost(r.found);
      if (host) { await patchSettings({ printerHost: host }); r = await S.print({ start: true }); } else r = { ok: false, code: 'host-canceled' };
    }
    if (r.ok) {
      sendState = { step: 'started', extra: '', done: true };
      setStatus('send.ok', { name: r.name }, 'ok');
    } else if (r.code === 'canceled') {
      sendState = null;
      setStatus('send.canceled', {}, '');
    } else {
      sendState = { step: r.step || FAIL_STEP[r.code] || (sendState && sendState.step) || 'connect', extra: '', fail: true };
      setStatus('=', { text: sendError(r) }, 'error');
      status.retext = () => sendError(r);
    }
    drawSteps();
  } finally {
    off();
    showCancel(false);
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

// Б6: куда уйдёт печать и калибровка стола - прямо над «Печать» (общая с вкладкой «Принтер»).
function drawTarget(s) {
  if (!s) return;
  const el = $('#print-target');
  el.textContent = s.printerHost ? t('act.target', { host: s.printerHost }) : t('act.targetNone');
  el.title = s.printerHost ? t('act.targetHint') : t('act.targetNoneHint');
  $('#print-leveling').checked = !!s.bedLeveling;
}

function onLang() {
  drawTarget(getSettings());
  renderChoice();
  renderModels();
  renderResult();
  if (status.retext) status.vars.text = status.retext();
  drawStatus();
  drawSteps();
  editor.texts();
  preview.texts();
  $('#fit-view').title = t('view.fit');
}

async function init() {
  info = await S.presetsInfo();
  buildFilaments();
  const saved = getSettings().choice;
  if (saved) choice = Object.assign(choice, saved);
  if (!info.filaments.some((f) => f.id === choice.filament)) choice.filament = 'pla';
  renderChoice();
  if (!info.engine) setStatus('eng.not-found', {}, 'error');
  $('#temp').addEventListener('input', (e) => setChoice({ tempDelta: Number(e.target.value) }));
  for (const b of document.querySelectorAll('#supports button')) b.addEventListener('click', () => setChoice({ supports: b.dataset.value }));
  $('#brim').addEventListener('change', (e) => setChoice({ brim: e.target.checked }));
  $('#open-models').addEventListener('click', async () => addModels(await S.openModels()));
  $('#slice').addEventListener('click', doSlice);
  $('#export').addEventListener('click', doExport);
  $('#print').addEventListener('click', doPrint);
  $('#send-cancel').addEventListener('click', () => {
    const b = $('#send-cancel');
    b.disabled = true;
    b.textContent = t('send.canceling');
    S.cancelPrint();
  });
  $('#print-leveling').addEventListener('change', (e) => patchSettings({ bedLeveling: e.target.checked }));
  for (const b of document.querySelectorAll('#view-switch button')) b.addEventListener('click', () => { if (!b.disabled) showStage(b.dataset.show); });
  $('#fit-view').addEventListener('click', () => editor.scene.fitView());
  $('#fit-view').title = t('view.fit');
  // Клавиши редактора. По e.code, а не e.key: в русской раскладке Ctrl+Z приходит как «я».
  // В текстовом поле Ctrl+Z - его собственная отмена набора.
  document.addEventListener('keydown', (e) => {
    if ($('#view-prepare').hidden || document.querySelector('dialog[open]')) return;
    const a = document.activeElement;
    const typing = a && (/SELECT|TEXTAREA/.test(a.tagName) || (a.tagName === 'INPUT' && !['checkbox', 'range', 'radio', 'button'].includes(a.type)));
    if (typing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && !e.altKey && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) History.redo(); else History.undo(); }
    else if (ctrl && !e.altKey && e.code === 'KeyY') { e.preventDefault(); History.redo(); }
    else if (ctrl && !e.altKey && e.code === 'KeyA' && editor.scene.mode === 'models') { e.preventDefault(); editor.selectAll(); }
    else if (e.key === 'Delete' && editor.scene.mode === 'models') editor.removeWithNote();
  });
  const theme = () => editor.scene.setTheme(document.documentElement.dataset.theme || 'dark');
  new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  theme();
  wireDrop();
  document.addEventListener('slicer:lang', onLang);
  document.addEventListener('slicer:mode', invalidate);
  document.addEventListener('slicer:advanced', invalidate);
  document.addEventListener('slicer:choice', (e) => { if (e.detail) { choice = Object.assign({}, choice, e.detail); renderChoice(); invalidate(); } });
  onSettings(drawTarget);
  showStage('models');
}

await init();
window.slicerPrepare = {
  addModels, editor, preview,
  models: () => editor.items.map((m) => m.name),
  choice: () => choice,
  gen: () => gen,
  history: History,
  refreshTarget: async () => drawTarget(await S.settings.get()),
};

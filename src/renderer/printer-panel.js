// Раздел «Принтер»: состояние, камера, пауза / продолжить / отмена, ИИ-контроль брака,
// управление (оси, «домой», температуры, вентиляторы, свет, скорость).
import { t, formatTime, getLang } from './i18n.js';
import { getSettings, patchSettings, onSettings } from './app.js';
import { ask } from './ask.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const P = window.slicer.printer;
const AI = window.slicer.ai;
let connected = '';
let lastStatus = null;
let aiTimer = null;
let aiPolls = 0;
let visible = false;
let jogSize = 10;
let fanDrag = false;
let controlBusy = false;

// Тексты, которые зависят от языка, хранятся ключом и параметрами: после смены языка
// перерисовываются (раньше «Подключено: …» оставалось на старом языке).
const msgs = new Map();         // id -> {key, vars, kind}
function say(id, key, vars, kind = '', base = 'status') {
  msgs.set(id, { key, vars, kind, base });
  paint(id);
}
function paint(id) {
  const el = document.getElementById(id);
  const m = msgs.get(id);
  if (!el || !m) return;
  el.textContent = m.key ? t(m.key, m.vars) : '';
  el.title = el.textContent;
  el.className = m.base + (m.kind ? ' ' + m.kind : '');
}
const conn = (key, vars, kind) => say('printer-conn', key, vars, kind);
const pcMsg = (key, vars, kind) => say('pc-msg', key, vars, kind, 'status pc-msg');

// null и '' - не число (Number(null) === 0 показал бы «0 °C» и уронил разбор пустого статуса).
function num(v) { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

export function describeStatus(s) {
  const pi = (s && s.PrintInfo) || {};
  const code = num(pi.Status);
  const known = [0, 1, 5, 6, 7, 8, 9, 10, 13, 16, 20];
  const state = code === null ? '-' : known.includes(code) ? t('pst.' + code) : t('pst.x', { code });
  const cl = num(pi.CurrentLayer), tl = num(pi.TotalLayer);
  const ct = num(pi.CurrentTicks), tt = num(pi.TotalTicks);
  const active = code !== null && ![0, 8, 9].includes(code);
  const pct = num(pi.Progress) ?? (tl ? Math.round((cl / tl) * 100) : null);
  return {
    code, state, active,
    file: active && pi.Filename ? String(pi.Filename).split('/').pop() : '',
    layer: active && tl ? `${cl}/${tl}` : '-',
    left: active && tt ? formatTime(Math.max(0, tt - (ct || 0))) : '-',
    nozzle: s && num(s.TempOfNozzle) !== null ? Math.round(s.TempOfNozzle) + ' °C' : '-',
    bed: s && num(s.TempOfHotbed) !== null ? Math.round(s.TempOfHotbed) + ' °C' : '-',
    pct: active && pct !== null ? Math.max(0, Math.min(100, pct)) : 0,
  };
}

/**
 * Оси можно двигать только в простое: PrintInfo.Status 0/8/9 и CurrentStatus без занятости.
 * Неизвестный статус = занят. Та же проверка в главном процессе (printer-control.canMove) -
 * окно лишь не даёт нажать, решает главный процесс.
 */
export function canMove(s) {
  if (!s || typeof s !== 'object') return false;
  const pi = s.PrintInfo;
  if (!pi || typeof pi !== 'object' || typeof pi.Status !== 'number' || ![0, 8, 9].includes(pi.Status)) return false;
  const cs = s.CurrentStatus;
  return cs === undefined || (Array.isArray(cs) && cs.every((v) => v === 0));
}

function coordOf(s) {
  const p = s && typeof s.CurrenCoord === 'string' ? s.CurrenCoord.split(',').map((v) => (v.trim() === '' ? NaN : Number(v))) : [];
  return p.length === 3 && p.every(Number.isFinite) ? p : null;
}

function showControl(s) {
  const online = !!connected && !!s;
  const move = online && canMove(s);
  for (const b of $$('#pc-axes button[data-jog], #pc-axes button[data-home]')) b.disabled = !move || controlBusy;
  for (const b of $$('#pc-step button')) b.disabled = !move;
  for (const b of $$('#pc-temps button, #pc-temps input, #pc-fans input, #pc-speed button')) b.disabled = !online;
  say('pc-lock', online ? (move ? '' : 'pc.lockPrint') : 'pc.lockOffline', null, '', 'hint pc-lock');
  const c = coordOf(online ? s : null);
  ['x', 'y', 'z'].forEach((k, i) => { $('#pc-' + k).textContent = c ? c[i].toFixed(2) : '-'; });
  const temp = (now, target) => (num(now) === null ? '-' : Math.round(num(now))) + ' / ' + (num(target) === null ? '-' : Math.round(num(target))) + ' °C';
  $('#pc-nozzle-now').textContent = online ? temp(s.TempOfNozzle, s.TempTargetNozzle) : '-';
  $('#pc-bed-now').textContent = online ? temp(s.TempOfHotbed, s.TempTargetHotbed) : '-';
  const fans = online && s.CurrentFanSpeed && typeof s.CurrentFanSpeed === 'object' ? s.CurrentFanSpeed : {};
  for (const [id, key] of [['model', 'ModelFan'], ['aux', 'AuxiliaryFan'], ['box', 'BoxFan']]) {
    const v = num(fans[key]);
    if (!fanDrag && v !== null) $('#pc-fan-' + id).value = String(v);
    $('#pc-fan-' + id + '-v').textContent = v === null ? '-' : (fanDrag ? $('#pc-fan-' + id).value : v) + ' %';
  }
  const light = online && s.LightStatus && typeof s.LightStatus === 'object' ? s.LightStatus.SecondLight : null;
  $('#pc-light').checked = light === 1;
  const speed = online && s.PrintInfo ? num(s.PrintInfo.PrintSpeedPct) : null;
  for (const b of $$('#pc-speed button')) b.classList.toggle('active', Number(b.dataset.speed) === speed);
}

let lostOnce = false;

function showStatus(s) {
  lastStatus = s;
  const d = describeStatus(s);
  // В4: без статуса - не одинокий «-», а «Не подключён» / «Нет связи».
  $('#p-state').textContent = s ? d.state : t(lostOnce ? 'printer.noLink' : 'printer.notConnected');
  $('#ai-pause').disabled = !connected;
  $('#ai-pause').title = connected ? '' : t('ai.needLink');
  $('#p-file').textContent = d.file;
  $('#p-file').title = d.file;
  $('#p-layer').textContent = d.layer;
  $('#p-left').textContent = d.left;
  $('#p-nozzle').textContent = d.nozzle;
  $('#p-bed').textContent = d.bed;
  $('#p-bar').style.width = d.pct + '%';
  $('#p-pause').disabled = !(d.code === 13 || d.code === 16);
  $('#p-resume').disabled = d.code !== 6;
  $('#p-stop').disabled = !d.active;
  showControl(s);
}

async function startCamera() {
  const r = await P.camera();
  if (r.ok && r.url) {
    $('#camera').src = r.url;
    $('#camera-hint').hidden = true;
  }
}

// Уйти с панели = перестать показывать видео (закрыть соединение картинки).
// Команду «выключить поток» принтеру не шлём: она ломает камеру всем.
function stopCamera() {
  $('#camera').removeAttribute('src');
  cameraHint('printer.noCamera');
}

// Подпись поверх окна камеры: ключ в data-i18n, чтобы смена языка её переводила.
function cameraHint(key) {
  const h = $('#camera-hint');
  h.dataset.i18n = key;
  h.textContent = t(key);
  h.hidden = false;
}

async function connect() {
  const host = $('#printer-host').value.trim();
  conn('', null);
  $('#printer-conn').textContent = '…';
  const r = await P.connect(host);
  if (!r.ok) {
    connected = '';
    conn(r.code === 'bad-host' ? 'printer.badHost' : 'send.offline', null, 'error');
    showStatus(null);
    return;
  }
  connected = r.host;
  // Адрес уже приведён к виду «192.168.0.50» (без http:// и «/») - его и запоминаем.
  if (host) $('#printer-host').value = r.host;
  if (host && r.host !== getSettings().printerHost) await patchSettings({ printerHost: r.host });
  conn('printer.connected', { host: r.host }, 'ok');
  showStatus(r.status || null);
  if (visible) startCamera();
}

async function find() {
  conn('', null);
  $('#printer-conn').textContent = '…';
  const found = await P.discover();
  if (!found.length) { conn('printer.notFound', null, 'error'); return; }
  $('#printer-host').value = found[0].host;
  conn('printer.found', { name: found[0].name || found[0].model || 'Centauri Carbon', host: found[0].host }, 'ok');
}

async function command(what) {
  if (what === 'stop' && !(await ask(t('printer.stopAsk'), t('printer.yesStop'), t('printer.no')))) return;
  const r = await P.command(what);
  if (!r.ok) conn('send.offline', null, 'error');
  P.command('status');
}

const CONTROL_ERR = { offline: 'pc.lockOffline', busy: 'pc.busy', 'not-homed': 'pc.notHomed', rejected: 'pc.rejected' };

async function control(kind, args) {
  if (controlBusy) return null;
  controlBusy = true;
  showControl(lastStatus);
  try {
    const r = await P.control(kind, args);
    if (r.ok) { pcMsg('pc.done', null, 'ok'); if (r.status) showStatus(r.status); }
    else pcMsg(CONTROL_ERR[r.code] || 'pc.bad', { ack: r.ack ?? '?' }, 'error');
    return r;
  } finally {
    controlBusy = false;
    showControl(lastStatus);
  }
}

// Температура: целое в пределах, иначе ничего не уходит. Нагрев (> 0) - только после «да»;
// во время печати любая смена - с предупреждением.
async function setTemp(which) {
  const max = which === 'nozzle' ? 350 : 110;
  const raw = $('#pc-' + which).value.trim();
  const v = raw === '' ? NaN : Number(raw);
  const what = t('pc.' + which);
  if (!Number.isInteger(v) || v < 0 || v > max) { pcMsg('pc.range', { what, max }, 'error'); return; }
  const printing = describeStatus(lastStatus).active;
  if (printing || v > 0) {
    const text = t(printing ? 'pc.heatPrintAsk' : 'pc.heatAsk', { what, t: v });
    if (!(await ask(text, t('pc.yesHeat'), t('pc.no')))) return;
  }
  await control('temp', { [which]: v });
}

function sendFans() {
  fanDrag = false;
  const v = (id) => Number($('#pc-fan-' + id).value);
  control('fans', { model: v('model'), aux: v('aux'), box: v('box') });
}

// В6: служба пишет имя брака по-русски; в английском окне - её класс (spaghetti, stringing...).
function defectName(a) {
  return getLang() === 'en' && a.cls ? String(a.cls).replace(/_/g, ' ') : a.name;
}

async function pollAi() {
  aiPolls += 1;
  let r;
  try { r = await AI.poll(); } catch { return; }
  say('ai-state', !r.service.running ? 'ai.off' : r.service.state === 'offline' ? 'ai.offline' : 'ai.on', null, '', 'ai-state hint');
  const a = r.alerts[0];
  $('#ai-alert').hidden = !a;
  if (a) {
    $('#ai-text').textContent = t('ai.text', { name: defectName(a), p: Math.round(a.score * 100), layer: a.layer, total: a.total });
    if (a.frame) $('#ai-frame').src = a.frame; else $('#ai-frame').removeAttribute('src');
    $('#ai-alert').dataset.id = a.id;
    $('#ai-alert').dataset.alert = JSON.stringify({ name: a.name, cls: a.cls, score: a.score, layer: a.layer, total: a.total });
  }
}

function applyTitles() {
  for (const el of $$('#view-printer [data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}

function relang() {
  for (const id of msgs.keys()) paint(id);
  applyTitles();
  showStatus(lastStatus);
  const al = $('#ai-alert').dataset.alert;
  if (al) { try { const a = JSON.parse(al); $('#ai-text').textContent = t('ai.text', { name: defectName(a), p: Math.round(a.score * 100), layer: a.layer, total: a.total }); } catch { /* старая плашка */ } }
}

function init() {
  const s = getSettings();
  $('#printer-host').value = s.printerHost;
  $('#bed-leveling').checked = s.bedLeveling;
  $('#bed-leveling').addEventListener('change', (e) => patchSettings({ bedLeveling: e.target.checked }));
  onSettings((st) => { $('#bed-leveling').checked = !!st.bedLeveling; });       // и из «Подготовки» (Б6)
  $('#printer-connect').addEventListener('click', connect);
  $('#printer-find').addEventListener('click', find);
  $('#p-pause').addEventListener('click', () => command('pause'));
  $('#p-resume').addEventListener('click', () => command('resume'));
  $('#p-stop').addEventListener('click', () => command('stop'));
  $('#ai-pause').addEventListener('click', async () => { await command('pause'); });
  $('#ai-ok').addEventListener('click', async () => { await AI.dismiss($('#ai-alert').dataset.id); $('#ai-alert').hidden = true; });

  for (const b of $$('#pc-step button')) {
    b.addEventListener('click', () => {
      jogSize = Number(b.dataset.step);
      for (const o of $$('#pc-step button')) o.classList.toggle('active', o === b);
    });
  }
  for (const b of $$('#pc-axes button[data-jog]')) b.addEventListener('click', () => control('move', { axis: b.dataset.jog, dir: Number(b.dataset.dir), size: jogSize }));
  for (const b of $$('#pc-axes button[data-home]')) b.addEventListener('click', () => control('home', { axis: b.dataset.home }));
  $('#pc-nozzle-set').addEventListener('click', () => setTemp('nozzle'));
  $('#pc-bed-set').addEventListener('click', () => setTemp('bed'));
  for (const id of ['model', 'aux', 'box']) {
    const el = $('#pc-fan-' + id);
    el.addEventListener('input', () => { fanDrag = true; $('#pc-fan-' + id + '-v').textContent = el.value + ' %'; });
    el.addEventListener('change', sendFans);
  }
  $('#pc-light').addEventListener('change', (e) => control('light', { on: e.target.checked ? 1 : 0 }));
  for (const b of $$('#pc-speed button')) b.addEventListener('click', () => control('speed', { pct: Number(b.dataset.speed) }));

  // Камера не ответила (занята другой программой, зависла) - не пустой чёрный прямоугольник,
  // а слова (обзор 0.2 Б3).
  $('#camera').addEventListener('error', () => { if ($('#camera').getAttribute('src')) cameraHint('printer.cameraLost'); });
  $('#camera').addEventListener('load', () => { $('#camera-hint').hidden = true; });
  P.onStatus(showStatus);
  // Связь пропала: старое «Печатает» и живые кнопки вводили в заблуждение - всё в прочерки,
  // все кнопки выключены, блок управления тоже.
  P.onLost(() => { connected = ''; lostOnce = true; conn('printer.lost', null, 'error'); stopCamera(); showStatus(null); });
  showStatus(null);
  applyTitles();
  document.addEventListener('slicer:view', (e) => {
    visible = e.detail === 'printer';
    if (visible) {
      if (!connected && $('#printer-host').value.trim()) connect();
      else if (connected) startCamera();
      pollAi();
      aiTimer = aiTimer || setInterval(pollAi, 5000);
    } else {
      // Ушли с вкладки: ни камеры, ни опроса папки AiForPrinter. Плашка тревоги всё равно
      // появится: при возврате на «Принтер» опрос идёт сразу.
      stopCamera();
      if (aiTimer) { clearInterval(aiTimer); aiTimer = null; }
    }
  });
  document.addEventListener('slicer:lang', relang);
}

init();
window.slicerPrinter = { describeStatus, canMove, connected: () => connected, aiPolls: () => aiPolls, aiTimer: () => !!aiTimer };

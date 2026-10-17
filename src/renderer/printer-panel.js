// Раздел «Принтер»: состояние, камера, пауза / продолжить / отмена, ИИ-контроль брака.
import { t, formatTime } from './i18n.js';
import { getSettings, patchSettings } from './app.js';

const $ = (s) => document.querySelector(s);
const P = window.slicer.printer;
const AI = window.slicer.ai;
let connected = '';
let lastStatus = null;
let aiTimer = null;
let visible = false;

function conn(text, kind = '') {
  const el = $('#printer-conn');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

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

function showStatus(s) {
  lastStatus = s;
  const d = describeStatus(s);
  $('#p-state').textContent = d.state;
  $('#p-file').textContent = d.file;
  $('#p-layer').textContent = d.layer;
  $('#p-left').textContent = d.left;
  $('#p-nozzle').textContent = d.nozzle;
  $('#p-bed').textContent = d.bed;
  $('#p-bar').style.width = d.pct + '%';
  $('#p-pause').disabled = !(d.code === 13 || d.code === 16);
  $('#p-resume').disabled = d.code !== 6;
  $('#p-stop').disabled = !d.active;
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
  $('#camera-hint').hidden = false;
}

async function connect() {
  const host = $('#printer-host').value.trim();
  conn('…');
  const r = await P.connect(host);
  if (!r.ok) { conn(t('send.offline'), 'error'); connected = ''; return; }
  connected = r.host;
  if (host !== getSettings().printerHost) await patchSettings({ printerHost: host });
  conn(t('printer.connected', { host: r.host }), 'ok');
  if (r.status) showStatus(r.status);
  if (visible) startCamera();
}

async function find() {
  conn('…');
  const found = await P.discover();
  if (!found.length) { conn(t('printer.notFound'), 'error'); return; }
  $('#printer-host').value = found[0].host;
  conn(t('printer.found', { name: found[0].name || found[0].model || 'Centauri Carbon', host: found[0].host }), 'ok');
}

function ask(text, yes, no) {
  return new Promise((resolve) => {
    const dlg = $('#confirm');
    $('#confirm-text').textContent = text;
    $('#confirm-yes').textContent = yes;
    $('#confirm-no').textContent = no;
    const done = (v) => { dlg.close(); $('#confirm-yes').onclick = null; $('#confirm-no').onclick = null; resolve(v); };
    $('#confirm-yes').onclick = () => done(true);
    $('#confirm-no').onclick = () => done(false);
    dlg.oncancel = () => done(false);
    dlg.showModal();
  });
}

async function command(what) {
  if (what === 'stop' && !(await ask(t('printer.stopAsk'), t('printer.yesStop'), t('printer.no')))) return;
  const r = await P.command(what);
  if (!r.ok) conn(t('send.offline'), 'error');
  P.command('status');
}

async function pollAi() {
  let r;
  try { r = await AI.poll(); } catch { return; }
  const st = $('#ai-state');
  st.textContent = !r.service.running ? t('ai.off') : r.service.state === 'offline' ? t('ai.offline') : t('ai.on');
  const a = r.alerts[0];
  $('#ai-alert').hidden = !a;
  if (a) {
    $('#ai-text').textContent = t('ai.text', { name: a.name, p: Math.round(a.score * 100), layer: a.layer, total: a.total });
    if (a.frame) $('#ai-frame').src = a.frame; else $('#ai-frame').removeAttribute('src');
    $('#ai-alert').dataset.id = a.id;
  }
}

function init() {
  const s = getSettings();
  $('#printer-host').value = s.printerHost;
  $('#bed-leveling').checked = s.bedLeveling;
  $('#bed-leveling').addEventListener('change', (e) => patchSettings({ bedLeveling: e.target.checked }));
  $('#printer-connect').addEventListener('click', connect);
  $('#printer-find').addEventListener('click', find);
  $('#p-pause').addEventListener('click', () => command('pause'));
  $('#p-resume').addEventListener('click', () => command('resume'));
  $('#p-stop').addEventListener('click', () => command('stop'));
  $('#ai-pause').addEventListener('click', async () => { await command('pause'); });
  $('#ai-ok').addEventListener('click', async () => { await AI.dismiss($('#ai-alert').dataset.id); $('#ai-alert').hidden = true; });
  P.onStatus(showStatus);
  P.onLost(() => { connected = ''; conn(t('printer.lost'), 'error'); stopCamera(); });
  showStatus(null);
  document.addEventListener('slicer:view', (e) => {
    visible = e.detail === 'printer';
    if (visible) {
      if (!connected && $('#printer-host').value.trim()) connect();
      else if (connected) startCamera();
      pollAi();
      aiTimer = aiTimer || setInterval(pollAi, 5000);
    } else {
      stopCamera();
    }
  });
  document.addEventListener('slicer:lang', () => showStatus(lastStatus));
  // Тревоги ИИ проверяем и вне панели: плашка должна быть видна, когда человек откроет «Принтер».
  setInterval(pollAi, 15000);
}

init();
window.slicerPrinter = { describeStatus, connected: () => connected };

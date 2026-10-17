// «Продвинутый»: все настройки движка по разделам, с подписями, описаниями и проверкой ввода.
// Правки поверх базы; правки филамента хранятся отдельно для каждого филамента
// (settings.advanced.filament[<id>]). В «Новичке» правки не участвуют вовсе (закон в
// tests/core/novice.test.js). Каталог настроек - src/core/settings-catalog.js (тот же файл
// работает в Node и здесь).
import '../core/settings-catalog.js';
import { t, getLang } from './i18n.js';
import { getSettings, patchSettings, onSettings } from './app.js';

const C = globalThis.SlicerCatalog;
const $ = (s) => document.querySelector(s);
const SKIP = new Set(['name', 'type', 'from', 'inherits', 'instantiation', 'compatible_printers', 'setting_id', 'version', 'print_settings_id', 'filament_settings_id']);
const FIL_IDS = ['pla', 'petg', 'tpu', 'abs', 'asa'];
const ORDER = new Map([...C.ENTRIES.keys()].map((k, i) => [k, i]));

let base = null;              // {process, filament} - собранные пресеты без правок
let loadedFor = '';           // филамент, для которого собрана база
let view = 'all';             // 'all' | 'changed'
const open = new Set(['quality']);   // раскрытые разделы
let openRow = '';             // строка с раскрытым описанием: 'process.layer_height'
const bad = new Map();        // 'kind.key' -> введённый неверный текст (не сохранён)
let badKey = '';              // настройка, которую не принял движок

const lang = () => getLang();
const show = (v) => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''));
const filId = () => {
  const c = getSettings().choice;
  return c && FIL_IDS.includes(c.filament) ? c.filament : 'pla';
};
const filLabel = (id) => id.toUpperCase();
function edits() {
  const a = getSettings().advanced || {};
  const by = a.filament && typeof a.filament === 'object' ? a.filament : {};
  return { process: a.process || {}, filament: by[filId()] || {} };
}
function labelOf(key) {
  const l = C.label(key, lang());
  const u = C.unitOf(key, lang());
  return (l || key) + (u ? ', ' + u : '');
}

// Все строки: ключи пресетов плюс ключи движка из каталога, которых в пресете нет.
function allRows() {
  if (!base) return [];
  const e = edits();
  const out = [];
  for (const kind of ['process', 'filament']) {
    const seen = new Set();
    const add = (key, baseText) => {
      const changed = Object.prototype.hasOwnProperty.call(e[kind], key);
      out.push({ kind, key, base: baseText, value: changed ? String(e[kind][key]) : baseText, changed, section: C.sectionOf(key) });
    };
    for (const key of Object.keys(base[kind])) {
      const v = base[kind][key];
      if (SKIP.has(key) || (typeof v === 'object' && v !== null && !Array.isArray(v))) continue;
      if (Array.isArray(v) && new Set(v.map(String)).size > 1) continue;     // составное - не здесь
      const text = show(v);
      if (text.includes('\n')) continue;                                       // G-code - не здесь
      seen.add(key);
      add(key, text);
    }
    for (const x of C.extras(kind)) if (!seen.has(x.key)) add(x.key, x.def);
  }
  const ord = (k) => (ORDER.has(k) ? ORDER.get(k) : 1e6);
  return out.sort((a, b) => ord(a.key) - ord(b.key) || a.key.localeCompare(b.key));
}

function visibleRows() {
  const q = $('#adv-search').value;
  return allRows().filter((r) => (view !== 'changed' || r.changed) && C.matches(r.key, q));
}

function el(tag, cls, text) {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (text !== undefined) x.textContent = text;
  return x;
}

function control(r, id) {
  const ty = C.typeOf(r.key, r.base);
  const ro = C.isReadOnly(r.key);
  if (ty.t === 'enum') {
    const s = el('select', 'adv-select');
    const values = ty.options.map((o) => o.value);
    for (const v of [r.base, r.value]) if (v !== '' && !values.includes(v)) values.push(v);
    for (const v of values) {
      const o = el('option', '', C.optionLabel(r.key, v, lang()));
      o.value = v;
      s.append(o);
    }
    s.value = r.value;
    s.disabled = ro;
    s.addEventListener('change', () => setEdit(r, s.value));
    return s;
  }
  if (ty.t === 'bool' && (r.value === '0' || r.value === '1')) {
    const wrap = el('label', 'adv-switch');
    const c = el('input');
    c.type = 'checkbox';
    c.setAttribute('role', 'switch');
    c.checked = r.value === '1';
    c.disabled = ro;
    c.addEventListener('change', () => setEdit(r, c.checked ? '1' : '0'));
    wrap.append(c, el('span'));
    return wrap;
  }
  const input = el('input', 'adv-input');
  input.type = 'text';
  input.spellcheck = false;
  if (ty.t !== 'text') input.inputMode = 'decimal';
  input.value = bad.has(id) ? bad.get(id) : r.value;
  input.readOnly = ro;
  input.title = (getLang() === 'en' ? 'Preset value: ' : 'В пресете: ') + r.base;
  input.addEventListener('input', () => markInput(r, input));
  input.addEventListener('change', () => commitInput(r, input));
  return input;
}

// Проверка сразу при вводе: поле подсвечено, под ним понятный текст.
function markInput(r, input) {
  const id = r.kind + '.' + r.key;
  const row = input.closest('.adv-item');
  const res = C.check(r.key, input.value, r.base);
  const err = row.querySelector('.adv-err');
  row.classList.toggle('bad', !res.ok);
  input.setAttribute('aria-invalid', res.ok ? 'false' : 'true');
  err.hidden = res.ok;
  err.textContent = res.ok ? '' : C.message(res.err, lang());
  if (res.ok) bad.delete(id);
  else bad.set(id, input.value);
  return res;
}

function commitInput(r, input) {
  const res = markInput(r, input);
  if (!res.ok) return;                         // неверное не сохраняется
  if (res.value !== input.value) input.value = res.value;
  setEdit(r, res.value);
}

function row(r) {
  const id = r.kind + '.' + r.key;
  const d = C.desc(r.key, lang());
  const item = el('div', 'adv-item');
  item.classList.toggle('changed', r.changed);
  item.classList.toggle('open', openRow === id);
  item.classList.toggle('engine-bad', badKey === r.key);
  item.classList.toggle('ro', C.isReadOnly(r.key));
  item.dataset.key = id;
  item.dataset.section = r.section;
  const name = el('div', 'adv-name');
  const lab = el('span', 'adv-label', labelOf(r.key));
  lab.title = labelOf(r.key) + (d ? '\n' + d : '') + '\n' + r.key;
  name.append(lab);
  if (C.label(r.key, lang())) name.append(el('small', 'adv-key', r.key));
  name.addEventListener('click', () => toggleRow(id));
  const help = el('button', 'adv-help', '?');
  help.type = 'button';
  help.title = d || r.key;
  help.setAttribute('aria-label', t('adv.help'));
  help.addEventListener('click', () => toggleRow(id));
  const ctl = el('div', 'adv-ctl');
  ctl.append(control(r, id));
  ctl.addEventListener('focusin', () => { if (openRow !== id) { openRow = id; for (const x of document.querySelectorAll('#adv-list .adv-item.open')) x.classList.remove('open'); item.classList.add('open'); } });
  item.append(name, ctl, help);
  if (d) {
    const p = el('p', 'adv-desc', d);
    p.title = d;
    item.append(p);
  }
  const err = el('p', 'adv-err');
  err.hidden = true;
  item.append(err);
  if (bad.has(id)) {
    const res = C.check(r.key, bad.get(id), r.base);
    if (!res.ok) { item.classList.add('bad'); err.hidden = false; err.textContent = C.message(res.err, lang()); }
  }
  if (badKey === r.key) {
    const p = el('p', 'adv-err', t('adv.engineBad'));
    item.append(p);
  }
  return item;
}

function toggleRow(id) {
  openRow = openRow === id ? '' : id;
  for (const x of document.querySelectorAll('#adv-list .adv-item')) x.classList.toggle('open', x.dataset.key === openRow);
}

function render() {
  renderFilament();
  const list = $('#adv-list');
  list.textContent = '';
  if (!base) {
    list.append(el('p', 'hint', t('eng.not-found')));
    return;
  }
  const rows = visibleRows();
  const searching = $('#adv-search').value.trim() !== '';
  if (view === 'changed') {
    const others = otherFilamentEdits();
    if (!rows.length) list.append(el('p', 'hint', t('adv.none')));
    if (others) list.append(el('p', 'hint adv-others', t('adv.otherFil', { list: others })));
    if (!rows.length) return;
  }
  if (!rows.length) { list.append(el('p', 'hint', t('adv.notFound'))); return; }
  for (const sec of C.SECTIONS) {
    const mine = rows.filter((r) => r.section === sec.id);
    if (!mine.length) continue;
    const expanded = searching || view === 'changed' || open.has(sec.id);
    const box = el('section', 'adv-sec');
    box.dataset.section = sec.id;
    const head = el('button', 'adv-sec-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(expanded));
    const title = el('span', 'adv-sec-title', C.sectionTitle(sec.id, lang()));
    title.title = title.textContent;
    const nChanged = mine.filter((r) => r.changed).length;
    const count = el('span', 'adv-sec-count', String(mine.length) + (nChanged && view !== 'changed' ? ' · ' + t('adv.changedN', { n: nChanged }) : ''));
    head.append(title, count);
    head.addEventListener('click', () => {
      if (searching || view === 'changed') return;
      if (open.has(sec.id)) open.delete(sec.id); else open.add(sec.id);
      render();
    });
    box.append(head);
    if (expanded) {
      const body = el('div', 'adv-sec-body');
      for (const r of mine) body.append(row(r));
      box.append(body);
    }
    list.append(box);
  }
}

function otherFilamentEdits() {
  const by = (getSettings().advanced || {}).filament || {};
  return FIL_IDS.filter((id) => id !== filId() && by[id] && Object.keys(by[id]).length)
    .map((id) => filLabel(id) + ' (' + Object.keys(by[id]).length + ')').join(', ');
}

function renderFilament() {
  const id = filId();
  for (const b of document.querySelectorAll('#adv-filament button')) b.classList.toggle('active', b.dataset.value === id);
  $('#adv-fil-hint').textContent = t('adv.filHint', { f: filLabel(id) });
}

async function setEdit(r, value) {
  const id = filId();
  const a = JSON.parse(JSON.stringify(getSettings().advanced || { process: {}, filament: {} }));
  a.process = a.process || {};
  a.filament = a.filament || {};
  const target = r.kind === 'process' ? a.process : (a.filament[id] = a.filament[id] || {});
  const baseCheck = C.check(r.key, r.base, r.base);
  const same = value === r.base || (baseCheck.ok && baseCheck.value === value);
  if (same) delete target[r.key];
  else target[r.key] = value;
  if (r.kind === 'filament' && !Object.keys(target).length) delete a.filament[id];
  if (badKey === r.key) badKey = '';
  openRow = r.kind + '.' + r.key;
  await patchSettings({ advanced: a });
  document.dispatchEvent(new CustomEvent('slicer:advanced'));
  render();
}

// Филамент выбирается общий с «Новичком»: нажимаем его кнопку - он сохранит выбор
// (patchSettings({choice})) и сбросит старую нарезку.
async function selectFilament(id) {
  if (id === filId()) return;
  const nb = document.querySelector(`#filament button[data-value="${id}"]`);
  if (nb) nb.click();
  else await patchSettings({ choice: Object.assign({}, getSettings().choice, { filament: id }) });
}

async function load() {
  loadedFor = filId();
  base = await window.slicer.presetsFull({});
  render();
}

function buildFilament() {
  const box = $('#adv-filament');
  box.textContent = '';
  for (const id of FIL_IDS) {
    const b = el('button', '', filLabel(id));
    b.type = 'button';
    b.dataset.value = id;
    b.addEventListener('click', () => selectFilament(id));
    box.append(b);
  }
}

function fillSelects() {
  const s = getSettings();
  const q = $('#adv-quality');
  q.textContent = '';
  for (const name of window.__slicerInfo.qualities) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name.split(' @')[0];
    q.append(o);
  }
  q.value = s.quality || '0.20mm Standard @Elegoo CC 0.4 nozzle';
  const p = $('#adv-plate');
  p.textContent = '';
  for (const name of window.__slicerInfo.plates) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    p.append(o);
  }
  p.value = s.plate;
}

// Движок не принял настройку: окно «Подготовки» пишет общее «не смог нарезать», а мы
// уточняем, какая именно настройка и что сказал движок, и подсвечиваем её здесь.
function watchStatus() {
  const st = $('#status');
  new MutationObserver(async () => {
    if (!st.classList.contains('error') || st.textContent !== t('eng.failed') || !window.slicer.sliceError) return;
    const e = await window.slicer.sliceError();
    if (!e || e.code !== 'bad-setting' || !e.key) return;
    badKey = e.key;
    st.textContent = t('eng.bad-setting', { label: C.label(e.key, lang()) || e.key, key: e.key, why: e.detail || '' });
    if (getSettings().mode === 'advanced') {
      const sec = C.sectionOf(e.key);
      open.add(sec);
      render();
    }
  }).observe(st, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}

async function init() {
  window.__slicerInfo = window.__slicerInfo || await window.slicer.presetsInfo();
  fillSelects();
  buildFilament();
  $('#adv-search').addEventListener('input', render);
  for (const b of document.querySelectorAll('#adv-kind button')) {
    b.addEventListener('click', () => {
      view = b.dataset.kind === 'changed' ? 'changed' : 'all';
      for (const x of document.querySelectorAll('#adv-kind button')) x.classList.toggle('active', x === b);
      render();
    });
  }
  $('#adv-quality').addEventListener('change', async (e) => { await patchSettings({ quality: e.target.value }); document.dispatchEvent(new CustomEvent('slicer:advanced')); load(); });
  $('#adv-plate').addEventListener('change', async (e) => { await patchSettings({ plate: e.target.value }); document.dispatchEvent(new CustomEvent('slicer:advanced')); load(); });
  $('#adv-reset').addEventListener('click', async () => {
    bad.clear();
    badKey = '';
    await patchSettings({ advanced: { process: {}, filament: {} } });
    document.dispatchEvent(new CustomEvent('slicer:advanced'));
    render();
  });
  document.addEventListener('slicer:mode', (e) => { if (e.detail === 'advanced') load(); });
  document.addEventListener('slicer:lang', render);
  // Филамент сменили здесь или в «Новичке»: база другая, и правки - этого филамента.
  onSettings((s) => {
    if (!base || s.mode !== 'advanced') return;
    if (filId() !== loadedFor) { bad.clear(); load(); } else renderFilament();
  });
  watchStatus();
  if (getSettings().mode === 'advanced') load();
}

await init();
window.slicerAdvanced = {
  rows: () => visibleRows().length,
  total: () => allRows().length,
  reload: load,
  filament: filId,
  check: (key, raw, b) => C.check(key, raw, b),
};

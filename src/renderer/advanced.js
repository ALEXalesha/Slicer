// «Продвинутый»: все настройки движка с поиском, правки поверх базы. В «Новичке» правки
// не участвуют вовсе (закон в tests/core/novice.test.js).
import { t, getLang } from './i18n.js';
import { getSettings, patchSettings } from './app.js';

const $ = (s) => document.querySelector(s);
const MAX_ROWS = 200;

// Подписи самых нужных настроек. Остальные показываются именем движка.
const LABELS = {
  layer_height: ['Высота слоя, мм', 'Layer height, mm'],
  initial_layer_print_height: ['Первый слой, мм', 'First layer height, mm'],
  wall_loops: ['Число периметров', 'Wall loops'],
  top_shell_layers: ['Слоёв сверху', 'Top layers'],
  bottom_shell_layers: ['Слоёв снизу', 'Bottom layers'],
  sparse_infill_density: ['Заполнение', 'Infill density'],
  sparse_infill_pattern: ['Узор заполнения', 'Infill pattern'],
  outer_wall_speed: ['Скорость внешней стенки, мм/с', 'Outer wall speed, mm/s'],
  inner_wall_speed: ['Скорость внутренних стенок, мм/с', 'Inner wall speed, mm/s'],
  sparse_infill_speed: ['Скорость заполнения, мм/с', 'Infill speed, mm/s'],
  travel_speed: ['Скорость перемещений, мм/с', 'Travel speed, mm/s'],
  initial_layer_speed: ['Скорость первого слоя, мм/с', 'First layer speed, mm/s'],
  enable_support: ['Поддержки (0/1)', 'Supports (0/1)'],
  support_type: ['Тип поддержек', 'Support type'],
  support_threshold_angle: ['Угол поддержек, °', 'Support threshold angle, °'],
  support_on_build_plate_only: ['Поддержки только от стола (0/1)', 'Supports from plate only (0/1)'],
  brim_type: ['Кайма', 'Brim type'],
  brim_width: ['Ширина каймы, мм', 'Brim width, mm'],
  skirt_loops: ['Юбка, линий', 'Skirt loops'],
  seam_position: ['Шов', 'Seam position'],
  ironing_type: ['Разглаживание', 'Ironing'],
  fuzzy_skin: ['Шероховатая поверхность', 'Fuzzy skin'],
  enable_prime_tower: ['Башня очистки (0/1)', 'Prime tower (0/1)'],
  nozzle_temperature: ['Температура сопла, °C', 'Nozzle temperature, °C'],
  nozzle_temperature_initial_layer: ['Сопло на первом слое, °C', 'Nozzle first layer, °C'],
  textured_plate_temp: ['Стол (текстурная пластина), °C', 'Bed, textured plate, °C'],
  hot_plate_temp: ['Стол (гладкая пластина), °C', 'Bed, smooth plate, °C'],
  fan_max_speed: ['Обдув максимум, %', 'Fan max, %'],
  fan_min_speed: ['Обдув минимум, %', 'Fan min, %'],
  filament_flow_ratio: ['Поток', 'Flow ratio'],
  filament_max_volumetric_speed: ['Предел расхода, мм³/с', 'Max volumetric speed, mm³/s'],
  pressure_advance: ['Pressure advance', 'Pressure advance'],
  filament_retraction_length: ['Откат, мм', 'Retraction length, mm'],
  filament_z_hop: ['Подъём при перемещении, мм', 'Z hop, mm'],
  slow_down_layer_time: ['Мин. время слоя, с', 'Min layer time, s'],
};

let base = null;            // {process, filament}
let kind = 'process';

const edits = () => getSettings().advanced || { process: {}, filament: {} };
const show = (v) => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''));
const label = (k) => (LABELS[k] ? LABELS[k][getLang() === 'en' ? 1 : 0] : '');

function rows() {
  if (!base) return [];
  const q = $('#adv-search').value.trim().toLowerCase();
  const e = edits();
  const out = [];
  for (const k2 of ['process', 'filament']) {
    if (kind !== 'changed' && kind !== k2) continue;
    for (const key of Object.keys(base[k2]).sort()) {
      const v = base[k2][key];
      const text = show(v);
      if (text.includes('\n') || typeof v === 'object' && !Array.isArray(v)) continue;     // G-code и составное - не здесь
      if (['name', 'type', 'from', 'inherits', 'instantiation', 'compatible_printers', 'setting_id', 'version', 'print_settings_id', 'filament_settings_id'].includes(key)) continue;
      const changed = Object.prototype.hasOwnProperty.call(e[k2] || {}, key);
      if (kind === 'changed' && !changed) continue;
      if (q && !key.toLowerCase().includes(q) && !label(key).toLowerCase().includes(q)) continue;
      out.push({ kind: k2, key, value: changed ? String(e[k2][key]) : text, base: text, changed });
    }
  }
  // Подписанные - первыми: их ищут чаще всего.
  return out.sort((a, b) => (label(b.key) ? 1 : 0) - (label(a.key) ? 1 : 0) || a.key.localeCompare(b.key));
}

function render() {
  const list = $('#adv-list');
  list.textContent = '';
  const all = rows();
  if (kind === 'changed' && !all.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = t('adv.none');
    list.append(p);
    return;
  }
  for (const r of all.slice(0, MAX_ROWS)) {
    const row = document.createElement('div');
    row.className = 'adv-item' + (r.changed ? ' changed' : '');
    row.dataset.key = r.kind + '.' + r.key;
    const lab = document.createElement('label');
    lab.textContent = label(r.key) || r.key;
    if (label(r.key)) { const sm = document.createElement('small'); sm.textContent = r.key; lab.append(sm); }
    const input = document.createElement('input');
    input.value = r.value;
    input.title = r.base;
    input.addEventListener('change', () => setEdit(r.kind, r.key, input.value, r.base));
    row.append(lab, input);
    list.append(row);
  }
  if (all.length > MAX_ROWS) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = t('adv.count', { n: MAX_ROWS, total: all.length });
    list.append(p);
  }
}

async function setEdit(k, key, value, baseText) {
  const e = JSON.parse(JSON.stringify(edits()));
  e[k] = e[k] || {};
  if (value.trim() === baseText) delete e[k][key];
  else e[k][key] = value.trim();
  await patchSettings({ advanced: e });
  document.dispatchEvent(new CustomEvent('slicer:advanced'));
  render();
}

async function load() {
  base = await window.slicer.presetsFull({});
  render();
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

async function init() {
  window.__slicerInfo = window.__slicerInfo || await window.slicer.presetsInfo();
  fillSelects();
  $('#adv-search').addEventListener('input', render);
  for (const b of document.querySelectorAll('#adv-kind button')) {
    b.addEventListener('click', () => {
      kind = b.dataset.kind;
      for (const x of document.querySelectorAll('#adv-kind button')) x.classList.toggle('active', x === b);
      render();
    });
  }
  $('#adv-quality').addEventListener('change', async (e) => { await patchSettings({ quality: e.target.value }); document.dispatchEvent(new CustomEvent('slicer:advanced')); load(); });
  $('#adv-plate').addEventListener('change', async (e) => { await patchSettings({ plate: e.target.value }); document.dispatchEvent(new CustomEvent('slicer:advanced')); load(); });
  $('#adv-reset').addEventListener('click', async () => { await patchSettings({ advanced: { process: {}, filament: {} } }); document.dispatchEvent(new CustomEvent('slicer:advanced')); render(); });
  document.addEventListener('slicer:mode', (e) => { if (e.detail === 'advanced') load(); });
  document.addEventListener('slicer:lang', render);
  if (getSettings().mode === 'advanced') load();
}

await init();
window.slicerAdvanced = { rows: () => rows().length, reload: load };

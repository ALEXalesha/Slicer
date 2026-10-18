// Настройки программы: язык, тема, режим, выбор «Новичка», адрес принтера.
// Файл settings.json в папке userData. Запись через временный файл: обрыв посреди записи
// не оставляет половину JSON. Испорченный или чужой файл даёт значения по умолчанию.
'use strict';
const fs = require('fs');
const path = require('path');
const Catalog = require('./settings-catalog');
const { FILAMENTS, normalizeChoice } = require('./novice');

const THEMES = ['glass', 'formal', 'light', 'night', 'warm'];
const LANGS = ['ru', 'en'];
const MODES = ['novice', 'advanced'];

const DEFAULTS = Object.freeze({
  lang: 'ru',
  theme: 'glass',
  mode: 'novice',
  choice: null,          // нормализует novice.normalizeChoice
  printerHost: '',       // '' - искать в сети
  bedLeveling: true,     // калибровка стола перед печатью (Calibration_switch)
  advanced: { process: {}, filament: {} },   // filament: { <id филамента>: { ключ: значение } }
  quality: '',           // '' - 0.20mm Standard
  plate: 'Textured PEI Plate',
});

// Адрес принтера: имя или IP, необязательный порт (для тестов). Не путь и не URL.
function isHost(s) {
  if (typeof s !== 'string') return false;
  if (s === '') return true;
  const m = /^([A-Za-z0-9][A-Za-z0-9.-]{0,252})(?::(\d{1,5}))?$/.exec(s);
  return !!m && (m[2] === undefined || (Number(m[2]) >= 1 && Number(m[2]) <= 65535));
}

/**
 * Адрес, как его вводит человек: «http://192.168.0.50/», « 192.168.0.50 » -> «192.168.0.50».
 * Срезаем схему (http, https, ws), хвостовые «/» и пробелы. Если и после этого не адрес - null
 * (окно пишет «Адрес вида 192.168.0.50», а не молча заменяет пустым).
 */
function normalizeHost(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  const h = t.replace(/^(?:https?|wss?):\/\//i, '').replace(/\/+$/, '');
  if (t && !h) return null;                    // «http://» без адреса - не пустой адрес, а ошибка
  return isHost(h) ? h : null;
}

function plainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;
const FIL_IDS = FILAMENTS.map((f) => f.id);
const isScalar = (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

// Правки одного пресета: только ключи-имена и значения, которые проходят проверку каталога
// (запятая -> точка). Неверное не сохраняется: в файл попадает только то, что примет движок.
function cleanEdits(raw) {
  const out = {};
  for (const [k, v0] of Object.entries(plainObject(raw) || {})) {
    const v = Array.isArray(v0) && v0.length && isScalar(v0[0]) ? v0[0] : v0;
    if (!KEY_RE.test(k) || !isScalar(v)) continue;
    const c = Catalog.check(k, String(v));
    if (c.ok && c.value.length <= 500) out[k] = c.value;
  }
  return out;
}

// Правки филаментов по id. Старый формат (до 0.1.1) - плоские правки, общие для всех
// филаментов: переносим в выбранный тогда филамент, ничего не теряя. Новые правки этого
// филамента, если есть, главнее.
function filamentEditsById(advFilament, choice) {
  const src = plainObject(advFilament) || {};
  const out = {};
  const legacy = {};
  for (const [k, v] of Object.entries(src)) {
    if (!KEY_RE.test(k)) continue;
    if (FIL_IDS.includes(k) && plainObject(v)) out[k] = cleanEdits(v);
    else if (!FIL_IDS.includes(k)) legacy[k] = v;
  }
  const old = cleanEdits(legacy);
  if (Object.keys(old).length) {
    const id = normalizeChoice(choice).filament;
    out[id] = Object.assign(old, out[id] || {});
  }
  for (const id of Object.keys(out)) if (!Object.keys(out[id]).length) delete out[id];
  return out;
}

function normalize(raw) {
  const r = plainObject(raw) || {};
  const adv = plainObject(r.advanced) || {};
  return {
    lang: LANGS.includes(r.lang) ? r.lang : DEFAULTS.lang,
    theme: THEMES.includes(r.theme) ? r.theme : DEFAULTS.theme,
    mode: MODES.includes(r.mode) ? r.mode : DEFAULTS.mode,
    choice: plainObject(r.choice),
    printerHost: normalizeHost(r.printerHost) ?? DEFAULTS.printerHost,
    bedLeveling: typeof r.bedLeveling === 'boolean' ? r.bedLeveling : DEFAULTS.bedLeveling,
    advanced: { process: cleanEdits(adv.process), filament: filamentEditsById(adv.filament, r.choice) },
    quality: typeof r.quality === 'string' ? r.quality : DEFAULTS.quality,
    plate: typeof r.plate === 'string' && r.plate ? r.plate : DEFAULTS.plate,
  };
}

function load(file) {
  try {
    return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return normalize(null);
  }
}

function save(file, settings) {
  const data = JSON.stringify(normalize(settings), null, 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = { load, save, normalize, cleanEdits, DEFAULTS, THEMES, LANGS, MODES, isHost, normalizeHost };

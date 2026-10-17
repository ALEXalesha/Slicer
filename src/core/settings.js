// Настройки программы: язык, тема, режим, выбор «Новичка», адрес принтера.
// Файл settings.json в папке userData. Запись через временный файл: обрыв посреди записи
// не оставляет половину JSON. Испорченный или чужой файл даёт значения по умолчанию.
'use strict';
const fs = require('fs');
const path = require('path');

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
  advanced: { process: {}, filament: {} },
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

function plainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

function normalize(raw) {
  const r = plainObject(raw) || {};
  const adv = plainObject(r.advanced) || {};
  return {
    lang: LANGS.includes(r.lang) ? r.lang : DEFAULTS.lang,
    theme: THEMES.includes(r.theme) ? r.theme : DEFAULTS.theme,
    mode: MODES.includes(r.mode) ? r.mode : DEFAULTS.mode,
    choice: plainObject(r.choice),
    printerHost: isHost(r.printerHost) ? r.printerHost : DEFAULTS.printerHost,
    bedLeveling: typeof r.bedLeveling === 'boolean' ? r.bedLeveling : DEFAULTS.bedLeveling,
    advanced: { process: plainObject(adv.process) || {}, filament: plainObject(adv.filament) || {} },
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

module.exports = { load, save, normalize, DEFAULTS, THEMES, LANGS, MODES, isHost };

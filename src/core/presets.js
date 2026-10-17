// Пресеты движка. Движок, получив пресет файлом, разворачивает цепочку `inherits` не до
// конца: замер 17.10 - у «Generic PLA @Elegoo Centauri» filament_density 0, ускорение
// внешней стенки 1000 вместо 5000, у «Generic PETG @System» стол 45 °C вместо 80.
// Поэтому цепочку собираем сами и отдаём движку полный пресет без `inherits`.
'use strict';
const fs = require('fs');
const path = require('path');

const KINDS = ['machine', 'process', 'filament'];
const DEFAULT_VENDORS = ['OrcaFilamentLibrary', 'Elegoo'];

class PresetError extends Error {
  constructor(code, name) {
    super(code + ': ' + name);
    this.code = code;
    this.preset = name;
  }
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.json')) out.push(p);
  }
}

/** Индекс `type|name` -> {file, json}. При одном имени у двух производителей выигрывает последний. */
function buildIndex(profilesDir, vendors = DEFAULT_VENDORS) {
  const index = new Map();
  for (const vendor of vendors) {
    for (const kind of KINDS) {
      const files = [];
      walk(path.join(profilesDir, vendor, kind), files);
      for (const file of files) {
        let json;
        try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
        if (!json || typeof json.name !== 'string') continue;
        const type = typeof json.type === 'string' ? json.type : kind;
        index.set(type + '|' + json.name, { file, json });
      }
    }
  }
  return index;
}

/** Полный пресет: свойства всех предков, поверх - потомка; без `inherits`. */
function resolvePreset(index, type, name) {
  const chain = [];
  const seen = new Set();
  let cur = name;
  while (cur) {
    if (seen.has(cur)) throw new PresetError('cycle', cur);
    seen.add(cur);
    const e = index.get(type + '|' + cur);
    if (!e) throw new PresetError('missing', cur);
    chain.push(e.json);
    cur = typeof e.json.inherits === 'string' ? e.json.inherits : '';
  }
  const out = {};
  for (let i = chain.length - 1; i >= 0; i--) Object.assign(out, chain[i]);
  delete out.inherits;
  return out;
}

/** Имена пресетов, которые можно выбрать (instantiation true), по типу. */
function listPresets(index, type, filter = () => true) {
  const out = [];
  for (const [key, e] of index) {
    if (!key.startsWith(type + '|')) continue;
    if (String(e.json.instantiation) !== 'true') continue;
    if (filter(e.json)) out.push(e.json.name);
  }
  return out.sort();
}

module.exports = { buildIndex, resolvePreset, listPresets, PresetError, KINDS, DEFAULT_VENDORS };

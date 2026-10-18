// Режим «Новичок»: человек решает три вещи - филамент, поправку температуры, поддержки
// (с переключателем «Кайма»). Всё остальное - база: собранные пресеты движка Elegoo для
// Centauri Carbon 0.4 и 0.20mm Standard.
'use strict';
const { resolvePreset } = require('./presets');
const Catalog = require('./settings-catalog');

const MACHINE = 'Elegoo Centauri Carbon 0.4 nozzle';
const PROCESS = '0.20mm Standard @Elegoo CC 0.4 nozzle';
const QUALITIES = [
  '0.12mm Fine @Elegoo CC 0.4 nozzle',
  '0.16mm Optimal @Elegoo CC 0.4 nozzle',
  '0.20mm Standard @Elegoo CC 0.4 nozzle',
  '0.20mm Strength @Elegoo CC 0.4 nozzle',
  '0.24mm Draft @Elegoo CC 0.4 nozzle',
  '0.28mm Extra Draft @Elegoo CC 0.4 nozzle',
];
const PLATES = ['Textured PEI Plate', 'High Temp Plate', 'Cool Plate', 'Engineering Plate'];
const TEMP_LIMIT = 15;

// PETG: правки проверенного пресета Алексея «Generic PETG @System - Копировать»
// (ElegooSlicer, все калибровки «работают отлично» 02.10.2026). Стол 80 на всех пластинах.
const PETG_TESTED = {
  cool_plate_temp: ['80'], cool_plate_temp_initial_layer: ['80'],
  eng_plate_temp: ['80'], eng_plate_temp_initial_layer: ['80'],
  hot_plate_temp: ['80'], hot_plate_temp_initial_layer: ['80'],
  textured_plate_temp: ['80'], textured_plate_temp_initial_layer: ['80'],
  supertack_plate_temp: ['80'], supertack_plate_temp_initial_layer: ['80'],
  textured_cool_plate_temp: ['80'], textured_cool_plate_temp_initial_layer: ['80'],
  enable_overhang_bridge_fan: ['0'],
  fan_max_speed: ['80'], fan_min_speed: ['0'],
  filament_deretraction_speed: ['60'], filament_retraction_speed: ['60'],
  filament_extruder_variant: ['Direct Drive Standard'],
  filament_retraction_length: ['1.8'], filament_retraction_minimum_travel: ['3'],
  filament_wipe: ['0'], filament_z_hop: ['1.2'], filament_z_hop_types: ['Normal Lift'],
  nozzle_temperature_range_low: ['250'],
  reduce_fan_stop_start_freq: ['0'],
  slow_down_for_layer_cooling: ['0'], slow_down_layer_time: ['10'],
};

const FILAMENTS = [
  { id: 'pla', label: 'PLA', preset: 'Generic PLA @Elegoo Centauri', extra: {}, tested: true },
  { id: 'petg', label: 'PETG', preset: 'Generic PETG @System', extra: PETG_TESTED, tested: true },
  { id: 'tpu', label: 'TPU', preset: 'Elegoo TPU 95A @ECC', extra: {}, tested: false },
  { id: 'abs', label: 'ABS', preset: 'Elegoo ABS @ECC', extra: {}, tested: false },
  { id: 'asa', label: 'ASA', preset: 'Elegoo ASA @ECC', extra: {}, tested: false },
];
const SUPPORTS = ['none', 'plate', 'everywhere'];
const NOVICE_ITEMS = ['filament', 'temperature', 'supports'];

// Ключи, которые меняют три выбора. Всё прочее в «Новичке» не трогается (закон в тестах).
const FILAMENT_KEYS = ['nozzle_temperature', 'nozzle_temperature_initial_layer'];
const PROCESS_KEYS = ['enable_support', 'support_type', 'support_on_build_plate_only', 'brim_type', 'brim_width'];

function normalizeChoice(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const fil = FILAMENTS.find((f) => f.id === r.filament);
  let delta = Math.round(Number(r.tempDelta));
  if (!Number.isFinite(delta)) delta = 0;
  delta = Math.max(-TEMP_LIMIT, Math.min(TEMP_LIMIT, delta));
  if (Object.is(delta, -0)) delta = 0;
  return {
    filament: fil ? fil.id : 'pla',
    tempDelta: delta,
    supports: SUPPORTS.includes(r.supports) ? r.supports : 'none',
    brim: r.brim === true,
  };
}

function firstNumber(v, fallback) {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : fallback;
}

/** Правки, которые дают три выбора, поверх собранного филамента baseFilament. */
function noviceOverrides(rawChoice, baseFilament) {
  const c = normalizeChoice(rawChoice);
  const base = firstNumber(baseFilament && baseFilament.nozzle_temperature, 210);
  const baseFirst = firstNumber(baseFilament && baseFilament.nozzle_temperature_initial_layer, base);
  const filament = {
    nozzle_temperature: [String(base + c.tempDelta)],
    nozzle_temperature_initial_layer: [String(baseFirst + c.tempDelta)],
  };
  const process = {
    enable_support: c.supports === 'none' ? '0' : '1',
    support_type: 'tree(auto)',
    support_on_build_plate_only: c.supports === 'everywhere' ? '0' : '1',
    brim_type: c.brim ? 'outer_only' : 'no_brim',
    brim_width: '5',
  };
  return { filament, process };
}

function filamentInfo(id) {
  return FILAMENTS.find((f) => f.id === id) || FILAMENTS[0];
}

/**
 * Три полных пресета для движка.
 * mode 'novice' - база + три выбора, правки «Продвинутого» не участвуют вообще.
 * mode 'advanced' - база + три выбора + качество, пластина и правки поверх.
 */
function composeConfigs(index, { mode = 'novice', choice, advanced, quality, plate } = {}) {
  const c = normalizeChoice(choice);
  const fil = filamentInfo(c.filament);
  const isAdv = mode === 'advanced';
  const procName = isAdv && QUALITIES.includes(quality) ? quality : PROCESS;
  const machine = resolvePreset(index, 'machine', MACHINE);
  const process = resolvePreset(index, 'process', procName);
  const filament = Object.assign(resolvePreset(index, 'filament', fil.preset), fil.extra);
  const o = noviceOverrides(c, filament);
  Object.assign(filament, o.filament);
  Object.assign(process, o.process);
  process.curr_bed_type = isAdv && PLATES.includes(plate) ? plate : PLATES[0];
  if (isAdv && advanced && typeof advanced === 'object') {
    applyEdits(process, advanced.process, 'process');
    applyEdits(filament, filamentEdits(advanced, c.filament), 'filament');
  }
  // У собранного пресета filament совместимость с этим принтером должна остаться: движок
  // отвергает пресет, если принтера нет в непустом compatible_printers.
  return { machine, process, filament, choice: c };
}

/**
 * Поддержки, поставленные кистью (пункт 3 Алексея). Замер 18.10 на движке: раскраска
 * «ставить» при выключенных поддержках ничего не даёт, а с tree(manual) - поддержки ровно
 * там, где покрашено. Поэтому: выбрано «Нет», но человек покрасил - ручные деревья только
 * по раскраске; выбрано «Где нужно»/«Везде» - авто остаётся, раскраска добавляет и
 * запрещает. «Запретить» работает при любых включённых поддержках.
 */
function applyPaintedSupports(process, rawChoice, painted) {
  const c = normalizeChoice(rawChoice);
  if (!painted || !painted.enforce || c.supports !== 'none') return process;
  process.enable_support = '1';
  process.support_type = 'tree(manual)';
  process.support_on_build_plate_only = '0';
  return process;
}

const PROTECTED = new Set(['type', 'name', 'inherits', 'from', 'instantiation', 'compatible_printers', 'setting_id']);
const plainObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** Правки «Продвинутого» для одного филамента: advanced.filament[<id>]. Чужие не участвуют. */
function filamentEdits(advanced, id) {
  const by = plainObject(advanced && advanced.filament) || {};
  return plainObject(by[id]) || {};
}

// kind: 'process' | 'filament'. Ключ, которого нет в пресете, принимается только если каталог
// знает его как ключ движка (extra): у филамента значения - массивы.
function applyEdits(target, edits, kind) {
  if (!edits || typeof edits !== 'object') return;
  for (const [k, v] of Object.entries(edits)) {
    if (PROTECTED.has(k)) continue;
    if (!(k in target)) {
      if (!kind || !Catalog.isExtra(kind, k)) continue;
      target[k] = kind === 'filament' ? [String(Array.isArray(v) ? v[0] : v)] : String(Array.isArray(v) ? v[0] : v);
      continue;
    }
    const old = target[k];
    if (Array.isArray(old)) target[k] = Array.isArray(v) ? v.map(String) : old.map(() => String(v));
    else target[k] = String(v);
  }
}

module.exports = {
  MACHINE, PROCESS, QUALITIES, PLATES, TEMP_LIMIT, FILAMENTS, SUPPORTS, NOVICE_ITEMS,
  FILAMENT_KEYS, PROCESS_KEYS, PETG_TESTED, PROTECTED,
  normalizeChoice, noviceOverrides, composeConfigs, filamentInfo, applyEdits, filamentEdits, applyPaintedSupports,
};

// Управление принтером по SDCP: оси, «домой», температуры, вентиляторы, свет, скорость.
// Значения сверены с официальным кодом Elegoo (ElegooSlicer, lan_service_web):
//   401 {Axis:"X"|"Y"|"Z", Step:<мм со знаком>}; у оси Z знак обратный: «Z вверх» = Step < 0.
//   402 {Axis:"XYZ"|"X"|"Y"|"Z"}.
//   403 {TempTargetNozzle} / {TempTargetHotbed} / {TargetFanSpeed:{ModelFan, AuxiliaryFan, BoxFan}} /
//       {LightStatus:{SecondLight:0|1, RgbLight:[0,0,0]}} / {PrintSpeedPct:50|100|130|160}.
// Здесь только формирование Data с проверками: всё неверное бросает, а не уходит принтеру.
// sdcp.makeRequest проверяет 401/402/403 этими же функциями, так что обойти их нельзя.
'use strict';

const AXES = Object.freeze(['X', 'Y', 'Z']);
const HOME_AXES = Object.freeze(['XYZ', 'X', 'Y', 'Z']);
const STEPS = Object.freeze([0.1, 1, 10, 50]);     // выбор шага в окне
const MAX_STEP = 100;                              // |шаг| за одно нажатие, мм
const LIMITS = Object.freeze({ nozzle: 350, bed: 110, fan: 100 });
const SPEEDS = Object.freeze([50, 100, 130, 160]); // тихий, баланс, спорт, безумный

class ControlError extends Error {
  constructor(code, detail) {
    super(code + (detail ? ': ' + detail : ''));
    this.code = code;
    this.detail = detail || '';
  }
}

// Текст значения для ошибки: у чужого объекта toString может быть чем угодно.
const show = (v) => { try { return String(v); } catch { return typeof v; } };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function checkAxis(axis, list) {
  if (typeof axis !== 'string' || !list.includes(axis)) throw new ControlError('bad-axis', show(axis));
  return axis;
}

function checkStep(step) {
  if (typeof step !== 'number' || !Number.isFinite(step) || step === 0 || Math.abs(step) > MAX_STEP) throw new ControlError('bad-step', show(step));
  return Math.round(step * 1000) / 1000;
}

function checkInt(v, max, code) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) throw new ControlError(code, show(v));
  return v;
}

/** Data для 401: ось из списка, шаг - конечное число, не ноль, |шаг| <= 100 мм. */
function moveData(axis, step) {
  return { Axis: checkAxis(axis, AXES), Step: checkStep(step) };
}

/**
 * Шаг для кнопки окна: dir +1 - «плюс / вверх», -1 - «минус / вниз». Для Z знак обратный,
 * как у Elegoo: кнопка «Z вверх» шлёт Step = -шаг.
 */
function jogStep(axis, dir, size) {
  checkAxis(axis, AXES);
  if (dir !== 1 && dir !== -1) throw new ControlError('bad-dir', show(dir));
  const step = checkStep(size) * dir;
  return axis === 'Z' ? -step : step;
}

/** Data для 402. */
function homeData(axis) {
  return { Axis: checkAxis(axis, HOME_AXES) };
}

/** Data для 403 с температурами: хотя бы одна, целые °C, сопло 0..350, стол 0..110. */
function tempData({ nozzle, bed } = {}) {
  const out = {};
  if (nozzle !== undefined) out.TempTargetNozzle = checkInt(nozzle, LIMITS.nozzle, 'bad-temp');
  if (bed !== undefined) out.TempTargetHotbed = checkInt(bed, LIMITS.bed, 'bad-temp');
  if (!Object.keys(out).length) throw new ControlError('bad-temp', 'nothing to set');
  return out;
}

/** Data для 403 с вентиляторами: все три сразу (так шлёт Elegoo), целые 0..100 %. */
function fanData({ model, aux, box } = {}) {
  return { TargetFanSpeed: {
    ModelFan: checkInt(model, LIMITS.fan, 'bad-fan'),
    AuxiliaryFan: checkInt(aux, LIMITS.fan, 'bad-fan'),
    BoxFan: checkInt(box, LIMITS.fan, 'bad-fan'),
  } };
}

/** Data для 403 со светом: 0 или 1. */
function lightData(on) {
  if (on !== 0 && on !== 1) throw new ControlError('bad-light', show(on));
  return { LightStatus: { SecondLight: on, RgbLight: [0, 0, 0] } };
}

/** Data для 403 со скоростью печати. */
function speedData(pct) {
  if (!SPEEDS.includes(pct)) throw new ControlError('bad-speed', show(pct));
  return { PrintSpeedPct: pct };
}

const NUM = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Проверка готового Data перед отправкой (вызывает sdcp.makeRequest). Разрешено только то,
 * что строят функции выше, без лишних полей.
 */
function checkData(cmd, body) {
  if (!isObj(body)) throw new ControlError('bad-data', 'not an object');
  const keys = Object.keys(body);
  if (cmd === 401) {
    if (keys.length !== 2 || !has(body, 'Axis') || !has(body, 'Step')) throw new ControlError('bad-data', keys.join(','));
    moveData(body.Axis, body.Step);
    if (checkStep(body.Step) !== body.Step) throw new ControlError('bad-step', show(body.Step));
    return;
  }
  if (cmd === 402) {
    if (keys.length !== 1 || !has(body, 'Axis')) throw new ControlError('bad-data', keys.join(','));
    homeData(body.Axis);
    return;
  }
  if (cmd !== 403) return;
  const allowed = ['TempTargetNozzle', 'TempTargetHotbed', 'TargetFanSpeed', 'LightStatus', 'PrintSpeedPct'];
  if (!keys.length || keys.some((k) => !allowed.includes(k))) throw new ControlError('bad-data', keys.join(','));
  if (has(body, 'TempTargetNozzle') || has(body, 'TempTargetHotbed')) {
    const t = tempData({ nozzle: body.TempTargetNozzle, bed: body.TempTargetHotbed });
    if (has(body, 'TempTargetNozzle') !== has(t, 'TempTargetNozzle') || has(body, 'TempTargetHotbed') !== has(t, 'TempTargetHotbed')) throw new ControlError('bad-temp', '');
  }
  if (has(body, 'TargetFanSpeed')) {
    const f = body.TargetFanSpeed;
    if (!isObj(f) || Object.keys(f).sort().join() !== 'AuxiliaryFan,BoxFan,ModelFan') throw new ControlError('bad-fan', '');
    fanData({ model: f.ModelFan, aux: f.AuxiliaryFan, box: f.BoxFan });
  }
  if (has(body, 'LightStatus')) {
    const l = body.LightStatus;
    if (!isObj(l)) throw new ControlError('bad-light', '');
    lightData(l.SecondLight);
  }
  if (has(body, 'PrintSpeedPct')) speedData(body.PrintSpeedPct);
}

/**
 * Можно ли двигать оси: принтер в простое (PrintInfo.Status 0/8/9) и машина ничем не занята
 * (CurrentStatus без ненулевых кодов). Нет статуса или он непонятный - нельзя.
 */
function canMove(status) {
  if (!isObj(status)) return false;
  const pi = status.PrintInfo;
  if (!isObj(pi) || !NUM(pi.Status)) return false;
  if (![0, 8, 9].includes(pi.Status)) return false;
  const cs = status.CurrentStatus;
  if (cs !== undefined && !(Array.isArray(cs) && cs.every((v) => v === 0))) return false;
  return true;
}

/** Поля управления из статуса: координаты, цели, вентиляторы, свет, скорость. null - нет данных. */
function readControl(status) {
  const s = isObj(status) ? status : {};
  let x = null, y = null, z = null;
  if (typeof s.CurrenCoord === 'string') {
    const p = s.CurrenCoord.split(',').map((v) => (v.trim() === '' ? NaN : Number(v)));
    if (p.length === 3 && p.every(Number.isFinite)) [x, y, z] = p;
  }
  const n = (v) => (NUM(v) ? v : null);
  const fans = isObj(s.CurrentFanSpeed) ? s.CurrentFanSpeed : {};
  const light = isObj(s.LightStatus) && (s.LightStatus.SecondLight === 0 || s.LightStatus.SecondLight === 1) ? s.LightStatus.SecondLight : null;
  const pi = isObj(s.PrintInfo) ? s.PrintInfo : {};
  return {
    x, y, z,
    nozzleTarget: n(s.TempTargetNozzle), bedTarget: n(s.TempTargetHotbed),
    fans: { model: n(fans.ModelFan), aux: n(fans.AuxiliaryFan), box: n(fans.BoxFan) },
    light,
    speed: SPEEDS.includes(pi.PrintSpeedPct) ? pi.PrintSpeedPct : null,
  };
}

module.exports = { AXES, HOME_AXES, STEPS, MAX_STEP, LIMITS, SPEEDS, ControlError,
  moveData, jogStep, homeData, tempData, fanData, lightData, speedData, checkData, canMove, readControl };

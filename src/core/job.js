// Папка задания: три полных пресета и копии моделей под нейтральными именами. Движок
// пишет имя модели в G-code (EXCLUDE_OBJECT_DEFINE NAME=...): с полным путём туда
// попадала бы папка пользователя, поэтому модели лежат рядом и передаются без пути.
'use strict';
const fs = require('fs');
const path = require('path');
const { safeBase } = require('./names');

const MODEL_EXT = ['.stl', '.3mf', '.obj'];

// Движок (admesh) считает STL двоичным, только если в 128 байтах сразу после заголовка
// (число граней и первые грани) есть байт > 127. Двоичный STL с нулевыми нормалями у
// маленькой модели (куб 10-15 мм) под это не попадает, читается как текстовый и не
// открывается: «Loading of a model file failed» (замер 17.10: кубы 10-15 мм падали, 16+
// резались, байты заголовка на это не влияют). Нормали движок пересчитывает сам, поэтому
// в копии задания в нормаль первой грани ставим -0.0 (тот же ноль, но байт 0x80) или,
// если нулей в ней нет, настоящую нормаль грани.
const looksAscii = (buf) => !buf.subarray(80, 208).some((b) => b > 127);

function markBinary(buf) {
  const n = 84;                         // нормаль первой грани: 3 float
  for (let i = 0; i < 3; i++) {
    if (buf.readFloatLE(n + i * 4) === 0) { buf.writeFloatLE(-0, n + i * 4); return; }
  }
  const v = (k) => [0, 1, 2].map((i) => buf.readFloatLE(n + 12 + k * 12 + i * 4));
  const [a, b, c] = [v(0), v(1), v(2)];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const len = Math.hypot(...nn) || 1;
  nn.forEach((x, i) => buf.writeFloatLE(x / len, n + i * 4));
}

function copyModel(src, dst) {
  const buf = fs.readFileSync(src);
  if (path.extname(src).toLowerCase() === '.stl' && buf.length >= 134) {
    const count = buf.readUInt32LE(80);
    if (buf.length === 84 + count * 50 && looksAscii(buf)) markBinary(buf);
  }
  fs.writeFileSync(dst, buf);
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 1), 'utf8');
}

/**
 * @param {{jobDir: string, models: Array<{path: string, name?: string}>, configs: {machine, process, filament}}} p
 * @returns {{configFiles: {machine, process, filament}, modelFiles: string[]}} имена файлов внутри jobDir
 */
function prepareJob({ jobDir, models, configs }) {
  if (!Array.isArray(models) || !models.length) throw Object.assign(new Error('no models'), { code: 'no-models' });
  fs.mkdirSync(jobDir, { recursive: true });
  const machine = Object.assign({}, configs.machine, { from: 'system' });
  machine.printer_settings_id = machine.name;
  const process = Object.assign({}, configs.process);
  process.print_settings_id = process.name;
  const filament = Object.assign({}, configs.filament);
  filament.filament_settings_id = [filament.name];
  writeJson(path.join(jobDir, 'machine.json'), machine);
  writeJson(path.join(jobDir, 'process.json'), process);
  writeJson(path.join(jobDir, 'filament.json'), filament);
  const modelFiles = models.map((m, i) => {
    const ext = path.extname(m.path).toLowerCase();
    if (!MODEL_EXT.includes(ext)) throw Object.assign(new Error('bad model type ' + ext), { code: 'bad-model' });
    const base = safeBase(m.name || path.basename(m.path, path.extname(m.path)), 40) || 'model';
    const name = base + '_' + (i + 1) + ext;
    copyModel(m.path, path.join(jobDir, name));
    return name;
  });
  return { configFiles: { machine: 'machine.json', process: 'process.json', filament: 'filament.json' }, modelFiles };
}

module.exports = { prepareJob, copyModel, looksAscii, MODEL_EXT };

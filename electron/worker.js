// Тяжёлый разбор вне главного потока: модель на 50 МБ разбирается секунды, окно в это
// время не должно замирать. Задание: {kind: 'model'|'preview', path}. Ответ - те же
// типизированные массивы, что дают src/core/mesh.js и src/core/gcode-preview.js.
'use strict';
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const { parseModel } = require('../src/core/mesh');
const { parseGcodePreview } = require('../src/core/gcode-preview');

try {
  const { kind, path: file } = workerData;
  if (kind === 'model') {
    const r = parseModel(fs.readFileSync(file), file);
    parentPort.postMessage({ ok: true, result: r });
  } else if (kind === 'preview') {
    parentPort.postMessage({ ok: true, result: parseGcodePreview(fs.readFileSync(file, 'utf8')) });
  } else {
    parentPort.postMessage({ ok: false, code: 'bad-kind' });
  }
} catch (e) {
  parentPort.postMessage({ ok: false, code: e.code || 'bad-file', detail: String(e.detail || e.message || '') });
}

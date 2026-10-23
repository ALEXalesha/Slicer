// Запуск движка ElegooSlicer из командной строки. Окон он не открывает, в stdout молчит;
// ошибка - код 127 и строка `Slic3r::CLI::run found error, exit`.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { parseGcodeInfo } = require('./gcode-info');
const { findKeyInText } = require('./settings-catalog');

class EngineError extends Error {
  constructor(code, detail) {
    super(code + (detail ? ': ' + detail : ''));
    this.code = code;
    this.detail = detail || '';
  }
}

// arrange: 1 - движок сам расставляет модели (старый путь, файлы с диска как есть);
// 0 - модели стоят там, где их поставил человек в окне (3MF стола, замер 18.10).
function engineArgs({ configFiles, modelFiles, arrange = 1 }) {
  return [
    '--datadir', 'data',
    '--slice', '0',
    '--load-settings', configFiles.machine + ';' + configFiles.process,
    '--load-filaments', configFiles.filament,
    '--outputdir', 'out',
    '--arrange', String(arrange ? 1 : 0),
    ...modelFiles,
  ];
}

function run(exe, args, opts) {
  // Поддельный движок в тестах - скрипт Node.
  const [cmd, full] = exe.toLowerCase().endsWith('.js') ? ['node', [exe, ...args]] : [exe, args];
  return new Promise((resolve) => {
    execFile(cmd, full, opts, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

// Движок пишет причину отказа не в stdout, а в свой журнал в рабочей папке (00000.log):
// «Invalid value provided for parameter layer_height: abc», «got error when validate: Layer
// height cannot exceed nozzle diameter.» Берём хвост журнала и вывода.
function engineLog(jobDir) {
  let text = '';
  try {
    for (const f of fs.readdirSync(jobDir).filter((n) => n.toLowerCase().endsWith('.log')).sort()) {
      text += fs.readFileSync(path.join(jobDir, f), 'utf8') + '\n';
    }
  } catch { /* журнала нет */ }
  return text.split(/\r?\n/).slice(-60).join('\n');
}

// Самая понятная строка причины: что не понравилось движку.
function reasonLine(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hit = lines.reverse().find((l) => /Invalid value|got error when validate|error/i.test(l) && !/CLI::run found error/.test(l));
  if (!hit) return '';
  const m = /(Invalid value provided for parameter .*|got error when validate:\s*(.*))$/.exec(hit);
  return (m ? (m[2] || m[1]) : hit).slice(0, 300);
}

/**
 * keys - имена настроек этого задания: если движок упал и в причине есть одна из них, ошибка
 * 'bad-setting' с этим ключом (а не «модель больше стола»). preferred - правки человека,
 * их проверяем первыми.
 * @returns {Promise<{gcodePath: string, info: object}>}
 */
async function slice({ exe, jobDir, configFiles, modelFiles, arrange = 1, timeoutMs = 600000, keys = [], preferred = [] }) {
  if (!exe || !fs.existsSync(exe)) throw new EngineError('not-found', exe || '');
  const outDir = path.join(jobDir, 'out');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(jobDir, 'data'), { recursive: true });
  for (const f of fs.readdirSync(jobDir)) if (f.toLowerCase().endsWith('.log')) fs.rmSync(path.join(jobDir, f), { force: true });
  const r = await run(exe, engineArgs({ configFiles, modelFiles, arrange }), { cwd: jobDir, windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const tail = (r.stdout + r.stderr).trim().split(/\r?\n/).slice(-3).join(' ');
  if (r.err && (r.err.killed || r.err.signal)) throw new EngineError('timeout', tail);
  const gcodePath = path.join(outDir, 'plate_1.gcode');
  if (r.err || !fs.existsSync(gcodePath)) {
    const log = engineLog(jobDir);
    // Модели слишком близко (обычно поддержки-деревья одной заходят на другую): движок из
    // командной строки считает это ошибкой (замер 23.10: Benchy и tee в 6 мм с поддержками).
    // Имена объектов в 3MF стола - safeBase, без пробелов.
    const conflict = /gcode path conflicts found between (\S+) and (\S+)/i.exec(log);
    if (conflict) throw Object.assign(new EngineError('conflict', conflict[0]), { names: [conflict[1], conflict[2]] });
    const why = reasonLine(log + '\n' + r.stdout + '\n' + r.stderr);
    const key = why && keys.length ? findKeyInText(why, keys, preferred) : null;
    if (key) throw Object.assign(new EngineError('bad-setting', why), { key });
    throw new EngineError('failed', tail || (r.err && String(r.err.code)) || 'no output');
  }
  // Не влезло на один стол - движок раскладывает остальное на plate_2, plate_3...: печать
  // только первой пластины молча теряла модели (ревьювер 17.10: из 10 кубов 6 пропали).
  const plates = fs.readdirSync(outDir).filter((f) => /^plate_\d+\.gcode$/.test(f)).length;
  if (plates > 1) throw new EngineError('plates', String(plates));
  const info = parseGcodeInfo(fs.readFileSync(gcodePath, 'utf8'));
  if (!info.layers) throw new EngineError('empty', '');
  return { gcodePath, info };
}

module.exports = { slice, engineArgs, EngineError };

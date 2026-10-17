// Запуск движка ElegooSlicer из командной строки. Окон он не открывает, в stdout молчит;
// ошибка - код 127 и строка `Slic3r::CLI::run found error, exit`.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { parseGcodeInfo } = require('./gcode-info');

class EngineError extends Error {
  constructor(code, detail) {
    super(code + (detail ? ': ' + detail : ''));
    this.code = code;
    this.detail = detail || '';
  }
}

function engineArgs({ configFiles, modelFiles }) {
  return [
    '--datadir', 'data',
    '--slice', '0',
    '--load-settings', configFiles.machine + ';' + configFiles.process,
    '--load-filaments', configFiles.filament,
    '--outputdir', 'out',
    '--arrange', '1',
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

/** @returns {Promise<{gcodePath: string, info: object}>} */
async function slice({ exe, jobDir, configFiles, modelFiles, timeoutMs = 600000 }) {
  if (!exe || !fs.existsSync(exe)) throw new EngineError('not-found', exe || '');
  const outDir = path.join(jobDir, 'out');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(jobDir, 'data'), { recursive: true });
  const r = await run(exe, engineArgs({ configFiles, modelFiles }), { cwd: jobDir, windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const tail = (r.stdout + r.stderr).trim().split(/\r?\n/).slice(-3).join(' ');
  if (r.err && (r.err.killed || r.err.signal)) throw new EngineError('timeout', tail);
  const gcodePath = path.join(outDir, 'plate_1.gcode');
  if (r.err || !fs.existsSync(gcodePath)) throw new EngineError('failed', tail || (r.err && String(r.err.code)) || 'no output');
  const info = parseGcodeInfo(fs.readFileSync(gcodePath, 'utf8'));
  if (!info.layers) throw new EngineError('empty', '');
  return { gcodePath, info };
}

module.exports = { slice, engineArgs, EngineError };

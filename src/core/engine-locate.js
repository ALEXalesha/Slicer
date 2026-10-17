// Где лежит движок нарезки. ElegooSlicer ставится в Program Files; путь можно задать
// переменной SLICER_ENGINE (тесты подставляют поддельный движок).
'use strict';
const fs = require('fs');
const path = require('path');

function candidates(env) {
  const list = [];
  if (env.SLICER_ENGINE) list.push(env.SLICER_ENGINE);
  for (const root of [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\Program Files']) {
    if (root) list.push(path.join(root, 'ElegooSlicer', 'elegoo-slicer.exe'));
  }
  return [...new Set(list)];
}

/** @returns {{exe: string, profilesDir: string} | null} */
function findEngine(env = process.env) {
  for (const exe of candidates(env)) {
    try {
      if (fs.statSync(exe).isFile()) {
        const profilesDir = env.SLICER_PROFILES || path.join(path.dirname(exe), 'resources', 'profiles');
        return { exe, profilesDir };
      }
    } catch { /* нет файла - следующий */ }
  }
  return null;
}

module.exports = { findEngine, candidates };

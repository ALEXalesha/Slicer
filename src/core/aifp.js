// ИИ-контроль брака: служба AiForPrinter уже следит за печатью (камера, нейросеть) и
// пишет в %LOCALAPPDATA%\AiForPrinter: state.json (состояние службы) и alerts\<id>\alert.json
// + frame.jpg, строки в alerts\history.jsonl. Здесь только чтение: в её файлы не пишем.
'use strict';
const fs = require('fs');
const path = require('path');

const FRESH_SEC = 30 * 60;

function defaultDir(env = process.env) {
  if (env.SLICER_AIFP_DIR) return env.SLICER_AIFP_DIR;
  return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'AiForPrinter') : '';
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Состояние службы: {running, state, t}. Служба пишет state.json на каждом шаге (простой - раз в 30 с,
 *  нет связи - до 120 с), поэтому файл старше 5 минут значит «служба не запущена». */
function serviceState(dir, nowSec = Date.now() / 1000) {
  const s = dir ? readJson(path.join(dir, 'state.json')) : null;
  if (!s || typeof s !== 'object') return { running: false, state: 'none', t: 0 };
  let mtime = 0;
  try { mtime = fs.statSync(path.join(dir, 'state.json')).mtimeMs / 1000; } catch { /* нет */ }
  const t = Number(s.t) || mtime;
  return { running: nowSec - Math.max(t, mtime) < 300, state: typeof s.state === 'string' ? s.state : '?', t };
}

/** Свежие тревоги без ответа, новые первыми. */
function readAlerts(dir, { nowSec = Date.now() / 1000, freshSec = FRESH_SEC } = {}) {
  if (!dir) return [];
  let lines = [];
  try { lines = fs.readFileSync(path.join(dir, 'alerts', 'history.jsonl'), 'utf8').split(/\r?\n/); } catch { return []; }
  const alerts = new Map();
  const answered = new Set();
  for (const line of lines) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (!j || typeof j !== 'object' || typeof j.id !== 'string') continue;
    if (j.answer_for) { answered.add(String(j.answer_for)); continue; }
    if (j.answer) answered.add(j.id);
    alerts.set(j.id, j);
  }
  const out = [];
  for (const a of alerts.values()) {
    if (answered.has(a.id)) continue;
    const t = Number(a.t);
    if (!Number.isFinite(t) || nowSec - t > freshSec || t - nowSec > 60) continue;
    if (!/^[A-Za-z0-9_-]+$/.test(a.id)) continue;
    const frame = path.join(dir, 'alerts', a.id, 'frame.jpg');
    out.push({ id: a.id, name: String(a.name || a.cls || ''), score: Number(a.score) || 0, layer: Number(a.layer) || 0,
      total: Number(a.total) || 0, t, framePath: fs.existsSync(frame) ? frame : '' });
  }
  return out.sort((a, b) => b.t - a.t);
}

module.exports = { defaultDir, serviceState, readAlerts, FRESH_SEC };

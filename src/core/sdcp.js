// SDCP - протокол принтеров Elegoo (Centauri Carbon): WebSocket ws://<ip>:3030/websocket,
// JSON-запросы с MainboardID. Значения проверены на живом принтере в n8n_pc (камера,
// статус, пауза, список, старт) и по журналу ElegooSlicer (загрузка файла).
'use strict';
const crypto = require('crypto');
const Control = require('./printer-control');

const CMD = Object.freeze({ STATUS: 0, ATTR: 1, START: 128, PAUSE: 129, STOP: 130, RESUME: 131, FILES: 258, CAMERA: 386,
  MOVE: 401, HOME: 402, CONTROL: 403 });

// PrintInfo.Status у Centauri Carbon. Идёт печать = 13 (проверено 18.09 на живом принтере).
const PRINT_STATUS = Object.freeze({ 0: 'idle', 1: 'homing', 5: 'pausing', 6: 'paused', 7: 'stopping', 8: 'stopped', 9: 'finished',
  10: 'checking', 13: 'printing', 16: 'heating', 20: 'leveling' });
const FREE = new Set([0, 8, 9]);
// Состояния, в которые принтер уходит после команды старта: значит, команда принята в работу.
const STARTED = new Set([1, 10, 13, 16, 20]);

class SdcpError extends Error {
  constructor(code, detail) {
    super(code + (detail ? ': ' + detail : ''));
    this.code = code;
    this.detail = detail || '';
  }
}

function printStatus(status) {
  const pi = status && status.PrintInfo;
  const n = pi && Number(pi.Status);
  return Number.isFinite(n) ? n : null;
}

/** Принтер занят: что-то печатает, на паузе, греется. Неизвестное состояние - тоже занят. */
function isBusy(status) {
  const s = printStatus(status);
  return s === null ? true : !FREE.has(s);
}

function hasStarted(status) {
  const s = printStatus(status);
  return s !== null && STARTED.has(s);
}

/**
 * Запрос SDCP строкой JSON. Единственное место, где формируются запросы, поэтому здесь
 * и запрет: камеру выключать нельзя никогда - Enable 0 обрывает поток всем, кто его
 * смотрит (Elegoo Slicer, веб-страница принтера, AiForPrinter), 09.10.2026. Запросы 401/402/403
 * (оси, «домой», температуры, вентиляторы, свет) проверяются printer-control.checkData.
 */
function makeRequest(cmd, data, mainboardId, now = Date.now()) {
  if (!Number.isInteger(cmd)) throw new SdcpError('bad-cmd', String(cmd));
  const body = data && typeof data === 'object' ? data : {};
  if (cmd === CMD.CAMERA && body.Enable !== 1) throw new SdcpError('forbidden', 'camera stream may only be enabled');
  // Оси, температуры, вентиляторы, свет: только то, что прошло проверки printer-control.
  if (cmd === CMD.MOVE || cmd === CMD.HOME || cmd === CMD.CONTROL) {
    try { Control.checkData(cmd, data); } catch (e) { throw new SdcpError(e.code || 'bad-data', e.detail || ''); }
  }
  if (!mainboardId) throw new SdcpError('no-mainboard', '');
  return JSON.stringify({
    Id: crypto.randomUUID(),
    Data: { Cmd: cmd, Data: body, RequestID: crypto.randomUUID(), MainboardID: mainboardId, TimeStamp: Math.floor(now / 1000), From: 0 },
    Topic: 'sdcp/request/' + mainboardId,
  });
}

/** MainboardID из любого сообщения принтера (поле или хвост Topic). */
function mainboardOf(msg) {
  if (!msg || typeof msg !== 'object') return '';
  const d = msg.Data && typeof msg.Data === 'object' ? msg.Data : {};
  const id = d.MainboardID || msg.MainboardID || '';
  if (id) return String(id);
  const t = typeof msg.Topic === 'string' ? msg.Topic : '';
  const i = t.lastIndexOf('/');
  return i >= 0 && t.startsWith('sdcp/') ? t.slice(i + 1) : '';
}

/** Список файлов из ответа 258: только файлы, с размером, если принтер его дал. */
function parseFileList(data) {
  const list = data && Array.isArray(data.FileList) ? data.FileList : [];
  const out = [];
  for (const it of list) {
    if (!it || typeof it !== 'object' || Number(it.type) !== 1 || typeof it.name !== 'string') continue;
    const sizeRaw = it.FileSize ?? it.fileSize ?? it.size ?? it.Size;
    const size = Number(sizeRaw);
    out.push({ name: it.name, size: sizeRaw !== undefined && Number.isFinite(size) ? size : null });
  }
  return out;
}

module.exports = { CMD, PRINT_STATUS, SdcpError, makeRequest, mainboardOf, parseFileList, printStatus, isBusy, hasStarted, FREE, STARTED };

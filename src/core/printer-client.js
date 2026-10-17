// Связь с принтером по SDCP. Одно соединение на весь сеанс: принтер не любит частые
// переподключения (n8n_pc: список и старт в одном соединении).
'use strict';
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { CMD, SdcpError, makeRequest, mainboardOf, parseFileList } = require('./sdcp');

const DEFAULT_PORT = 3030;

function splitHost(host, port) {
  const m = /^(.+?)(?::(\d+))?$/.exec(String(host || ''));
  return { hostname: m ? m[1] : '', port: m && m[2] ? Number(m[2]) : port || DEFAULT_PORT };
}

class PrinterClient extends EventEmitter {
  constructor(ws, info) {
    super();
    this.ws = ws;
    this.hostname = info.hostname;
    this.port = info.port;
    this.mainboardId = info.mainboardId || '';
    this.lastStatus = null;
    this.pending = new Map();      // cmd -> [{resolve, reject, timer}]
    this.closed = false;
    ws.on('message', (raw) => this._onMessage(raw));
    ws.on('close', () => this._onClose());
    ws.on('error', () => {});
  }

  /** Подключиться. MainboardID - из опции, из первых сообщений принтера или из ответа на атрибуты. */
  static connect(host, { port, timeoutMs = 6000, mainboardId = '' } = {}) {
    const info = splitHost(host, port);
    if (!info.hostname) return Promise.reject(new SdcpError('offline', 'no host'));
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${info.hostname}:${info.port}/websocket`, { handshakeTimeout: timeoutMs, maxPayload: 64 * 1024 * 1024 });
      let done = false;
      const fail = (e) => { if (!done) { done = true; try { ws.terminate(); } catch { /* уже закрыт */ } reject(new SdcpError('offline', e && e.message)); } };
      const timer = setTimeout(() => fail(new Error('timeout')), timeoutMs + 500);
      ws.once('error', fail);
      ws.once('open', () => {
        clearTimeout(timer);
        if (done) return;
        done = true;
        const client = new PrinterClient(ws, Object.assign(info, { mainboardId }));
        client._waitMainboard(Math.min(2500, timeoutMs)).then(() => resolve(client), (e) => { client.close(); reject(e); });
      });
    });
  }

  _waitMainboard(ms) {
    if (this.mainboardId) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.off('mainboard', ok); reject(new SdcpError('no-mainboard', 'printer sent no MainboardID')); }, ms);
      const ok = () => { clearTimeout(t); resolve(); };
      this.once('mainboard', ok);
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!this.mainboardId) {
      const id = mainboardOf(msg);
      if (id) { this.mainboardId = id; this.emit('mainboard', id); }
    }
    if (msg.Status && typeof msg.Status === 'object') {
      this.lastStatus = msg.Status;
      this.emit('status', msg.Status);
    }
    if (msg.Attributes && typeof msg.Attributes === 'object') this.emit('attributes', msg.Attributes);
    const d = msg.Data && typeof msg.Data === 'object' ? msg.Data : null;
    if (d && Number.isInteger(d.Cmd)) {
      const q = this.pending.get(d.Cmd);
      if (q && q.length) {
        const p = q.shift();
        clearTimeout(p.timer);
        p.resolve(d.Data && typeof d.Data === 'object' ? d.Data : {});
      }
    }
  }

  _onClose() {
    this.closed = true;
    for (const q of this.pending.values()) for (const p of q) { clearTimeout(p.timer); p.reject(new SdcpError('offline', 'connection closed')); }
    this.pending.clear();
    this.emit('close');
  }

  /** Команда и её ответ (Data.Data). Ответы сопоставляются по номеру команды по порядку. */
  request(cmd, data = {}, { timeoutMs = 8000 } = {}) {
    if (this.closed) return Promise.reject(new SdcpError('offline', 'closed'));
    const text = makeRequest(cmd, data, this.mainboardId);     // бросает на запрещённое
    return new Promise((resolve, reject) => {
      const p = { resolve, reject, timer: null };
      p.timer = setTimeout(() => {
        const q = this.pending.get(cmd) || [];
        const i = q.indexOf(p);
        if (i >= 0) q.splice(i, 1);
        reject(new SdcpError('timeout', 'cmd ' + cmd));
      }, timeoutMs);
      if (!this.pending.has(cmd)) this.pending.set(cmd, []);
      this.pending.get(cmd).push(p);
      this.ws.send(text, (err) => { if (err) { clearTimeout(p.timer); reject(new SdcpError('offline', err.message)); } });
    });
  }

  /** Свежий статус: запрос 0 и следующее сообщение Status. */
  async status({ timeoutMs = 8000 } = {}) {
    const next = new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.off('status', h); reject(new SdcpError('timeout', 'status')); }, timeoutMs);
      const h = (s) => { clearTimeout(t); resolve(s); };
      this.once('status', h);
    });
    this.request(CMD.STATUS, {}, { timeoutMs }).catch(() => {});
    return next;
  }

  async listFiles({ timeoutMs = 8000 } = {}) {
    const data = await this.request(CMD.FILES, { Url: '/local/' }, { timeoutMs });
    return parseFileList(data);
  }

  pause() { return this.request(CMD.PAUSE, {}); }
  resume() { return this.request(CMD.RESUME, {}); }
  stop() { return this.request(CMD.STOP, {}); }

  /** Адрес видео. Только включение: Enable 0 не шлём никогда (см. sdcp.makeRequest). */
  async cameraUrl() {
    const d = await this.request(CMD.CAMERA, { Enable: 1 });
    const url = d && typeof d.VideoUrl === 'string' ? d.VideoUrl : '';
    if (!url) return null;
    return /^https?:\/\//.test(url) ? url : 'http://' + url;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.ws.close(); } catch { /* уже закрыт */ }
  }
}

module.exports = { PrinterClient, splitHost, DEFAULT_PORT };

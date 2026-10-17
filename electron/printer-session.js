// Панель принтера: одно соединение SDCP, пока открыт раздел «Принтер», статус - в окно.
// Камера: только включение потока (386 Enable 1). При уходе с панели поток не выключаем -
// просто перестаём его показывать: Enable 0 ломает камеру всем (09.10.2026).
'use strict';
const fs = require('fs');
const { PrinterClient } = require('../src/core/printer-client');
const Aifp = require('../src/core/aifp');

class PrinterPanel {
  constructor({ send, connect = PrinterClient.connect, aifpDir = Aifp.defaultDir() }) {
    this.send = send;
    this.connectFn = connect;
    this.aifpDir = aifpDir;
    this.client = null;
    this.host = '';
    this.dismissed = new Set();
  }

  async connect(host) {
    if (!host) return { ok: false, code: 'no-host' };
    if (this.client && !this.client.closed && this.host === host) return { ok: true, host, status: this.client.lastStatus };
    this.disconnect();
    try {
      const c = await this.connectFn(host);
      this.client = c;
      this.host = host;
      c.on('status', (s) => this.send('printer:status', s));
      c.on('close', () => { if (this.client === c) { this.client = null; this.send('printer:lost', host); } });
      let status = null;
      try { status = await c.status(); } catch { status = c.lastStatus; }
      return { ok: true, host, status };
    } catch (e) {
      return { ok: false, code: e.code || 'offline' };
    }
  }

  disconnect() {
    if (this.client) { const c = this.client; this.client = null; c.close(); }
    return { ok: true };
  }

  async command(what) {
    const c = this.client;
    if (!c || c.closed) return { ok: false, code: 'offline' };
    const fn = { pause: () => c.pause(), resume: () => c.resume(), stop: () => c.stop(), status: () => c.status() }[what];
    if (!fn) return { ok: false, code: 'bad-command' };
    try { const r = await fn(); return { ok: true, result: r }; } catch (e) { return { ok: false, code: e.code || 'failed' }; }
  }

  async camera() {
    const c = this.client;
    if (!c || c.closed) return { ok: false, code: 'offline' };
    try { return { ok: true, url: await c.cameraUrl() }; } catch (e) { return { ok: false, code: e.code || 'failed' }; }
  }

  aiState() {
    const service = Aifp.serviceState(this.aifpDir);
    const alerts = Aifp.readAlerts(this.aifpDir).filter((a) => !this.dismissed.has(a.id)).slice(0, 1).map((a) => {
      let frame = '';
      if (a.framePath) { try { frame = 'data:image/jpeg;base64,' + fs.readFileSync(a.framePath).toString('base64'); } catch { frame = ''; } }
      return Object.assign({}, a, { framePath: undefined, frame });
    });
    return { service, alerts };
  }

  dismiss(id) { this.dismissed.add(String(id)); return { ok: true }; }
}

module.exports = { PrinterPanel };

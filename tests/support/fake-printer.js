// Поддельный Centauri Carbon на 127.0.0.1: WebSocket SDCP, HTTP-загрузка кусками, UDP-поиск.
// Поломки по заказу (opts.faults) - те, на которые жалуется Алексей: файл дошёл криво или
// принтер его не показывает. Журнал log - все команды и запросы, тесты проверяют по нему
// «ни одного второго старта» и «ни одного выключения камеры».
'use strict';
const http = require('http');
const dgram = require('dgram');
const crypto = require('crypto');
const WebSocket = require('ws');

const MAINBOARD = 'FAKE000000000000000000000000BEEF';
const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const fields = {};
  let pos = body.indexOf(boundary);
  while (pos >= 0) {
    const start = pos + boundary.length;
    if (body.slice(start, start + 2).toString() === '--') break;
    const next = body.indexOf(boundary, start);
    if (next < 0) break;
    const part = body.slice(start + 2, next - 2);           // без \r\n в начале и конце
    const sep = part.indexOf('\r\n\r\n');
    const head = part.slice(0, sep).toString('utf8');
    const content = part.slice(sep + 4);
    const name = /name="([^"]*)"/.exec(head);
    const filename = /filename="([^"]*)"/.exec(head);
    if (name) fields[name[1]] = filename ? { filename: filename[1], data: content } : content.toString('utf8');
    pos = next;
  }
  return fields;
}

async function startFakePrinter(opts = {}) {
  const faults = Object.assign({}, opts.faults);
  const state = {
    status: opts.status !== undefined ? opts.status : 0,
    files: new Map(),               // '/local/<имя>' -> Buffer
    uploads: new Map(),             // Uuid -> {buf, received}
    listAfter: new Map(),           // имя -> время, с которого файл виден в списке
    camera: false,
    starts: 0,
    // Управление (401/402/403) - как у настоящего: координаты, цели, вентиляторы, свет, скорость.
    coord: Object.assign({ x: 0, y: 0, z: 0 }, opts.coord),
    homed: opts.homed !== undefined ? opts.homed : true,
    targetNozzle: 0, targetBed: 0,
    fans: { ModelFan: 0, AuxiliaryFan: 0, BoxFan: 0 },
    light: 0,
    speed: 100,
  };
  const FREE = [0, 8, 9];
  const LIMIT = { x: 256, y: 256, z: 256 };
  const log = [];
  let failChunks = faults.failChunks || 0;
  let dropTimes = faults.dropTimes === undefined ? 1 : faults.dropTimes;
  let truncateTimes = faults.truncateTimes === undefined ? Infinity : faults.truncateTimes;
  let hideTimes = faults.hideTimes === undefined ? Infinity : faults.hideTimes;
  let bytesSeen = 0;

  const statusMsg = () => ({
    Status: {
      CurrentStatus: [FREE.includes(state.status) ? 0 : 1],
      TempOfNozzle: 26.5, TempOfHotbed: 24.1, TempOfBox: 25,
      TempTargetNozzle: state.targetNozzle, TempTargetHotbed: state.targetBed, TempTargetBox: 0,
      CurrentFanSpeed: Object.assign({}, state.fans),
      LightStatus: { SecondLight: state.light, RgbLight: [0, 0, 0] },
      CurrenCoord: [state.coord.x, state.coord.y, state.coord.z].map((v) => v.toFixed(2)).join(','),
      PrintInfo: { Status: state.status, CurrentLayer: state.status === 13 ? 8 : 0, TotalLayer: state.status === 13 ? 22 : 0,
        CurrentTicks: 600, TotalTicks: 3600, Filename: state.current || '', Progress: 30, PrintSpeedPct: state.speed },
    },
    MainboardID: MAINBOARD, TimeStamp: Math.floor(Date.now() / 1000), Topic: 'sdcp/status/' + MAINBOARD,
  });

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/video') {
      log.push({ http: 'video' });
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' });
      res.write('--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + TINY_JPEG.length + '\r\n\r\n');
      res.write(TINY_JPEG);
      res.write('\r\n');
      return;                                   // поток не закрываем, как настоящая камера
    }
    const chunks = [];
    let dropped = false;
    req.on('data', (c) => {
      chunks.push(c);
      bytesSeen += c.length;
      if (!dropped && faults.dropAfterBytes !== undefined && dropTimes > 0 && bytesSeen > faults.dropAfterBytes) {
        dropped = true;
        dropTimes -= 1;
        bytesSeen = 0;
        log.push({ http: 'drop' });
        req.socket.destroy();
      }
    });
    req.on('end', () => {
      if (dropped) return;
      const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method !== 'POST' || req.url !== '/uploadFile/upload') return reply(404, { success: false });
      const f = parseMultipart(Buffer.concat(chunks), req.headers['content-type']);
      if (!f || !f.File || !f.Uuid) return reply(200, { code: '111111', messages: [{ field: 'common_field', message: 'param error' }], data: null, success: false });
      const offset = Number(f.Offset), total = Number(f.TotalSize);
      log.push({ http: 'chunk', offset, size: f.File.data.length, total, name: f.File.filename });
      if (failChunks > 0) { failChunks -= 1; return reply(500, { success: false }); }
      let up = state.uploads.get(f.Uuid);
      if (!up || offset === 0) { up = { buf: Buffer.alloc(total), received: 0 }; state.uploads.set(f.Uuid, up); }
      f.File.data.copy(up.buf, offset);
      up.received = Math.max(up.received, offset + f.File.data.length);
      if (offset + f.File.data.length >= total) {
        const md5 = crypto.createHash('md5').update(up.buf).digest('hex');
        if (faults.md5Mismatch || md5 !== String(f['S-File-MD5']).toLowerCase()) {
          state.uploads.delete(f.Uuid);
          return reply(200, { code: '111111', messages: [{ field: 'common_field', message: 'File MD5 check failed' }], data: null, success: false });
        }
        const name = '/local/' + f.File.filename;
        let stored = up.buf;
        if (faults.truncateStore && truncateTimes > 0) { truncateTimes -= 1; stored = up.buf.subarray(0, Math.floor(up.buf.length / 2)); }
        if (faults.hideFile && hideTimes > 0) { hideTimes -= 1; state.listAfter.set(name, Infinity); }
        else state.listAfter.set(name, Date.now() + (faults.listDelayMs || 0));
        state.files.set(name, stored);
        state.uploads.delete(f.Uuid);
      }
      return reply(200, { code: '000000', messages: null, data: null, success: true });
    });
  });

  const wss = new WebSocket.Server({ server, path: '/websocket' });
  wss.on('connection', (ws) => {
    if (!faults.silentMainboard) ws.send(JSON.stringify(statusMsg()));
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      const d = msg.Data || {};
      log.push({ cmd: d.Cmd, data: d.Data, mainboard: d.MainboardID });
      if (faults.silent) return;
      const respond = (data) => ws.send(JSON.stringify({ Id: msg.Id, Data: { Cmd: d.Cmd, Data: Object.assign({ Ack: 0 }, data), RequestID: d.RequestID, MainboardID: MAINBOARD, TimeStamp: Math.floor(Date.now() / 1000) }, Topic: 'sdcp/response/' + MAINBOARD }));
      switch (d.Cmd) {
        case 0: respond({}); ws.send(JSON.stringify(statusMsg())); break;
        case 1: respond({}); ws.send(JSON.stringify({ Attributes: { Name: 'Fake CC', MachineName: 'Elegoo Centauri Carbon', MainboardID: MAINBOARD }, MainboardID: MAINBOARD, Topic: 'sdcp/attributes/' + MAINBOARD })); break;
        case 258: {
          const now = Date.now();
          const list = [...state.files.entries()].filter(([n]) => (state.listAfter.get(n) || 0) <= now)
            .map(([n, b]) => Object.assign({ name: n, type: 1 }, faults.noSizeInList ? {} : { FileSize: b.length }));
          setTimeout(() => respond({ FileList: [{ name: '/local/folder', type: 0 }, ...list] }), faults.listReplyDelayMs || 0);
          break;
        }
        case 128: {
          state.starts += 1;
          const ack = faults.startAck !== undefined ? faults.startAck : (state.files.has(d.Data && d.Data.Filename) ? 0 : 2);
          respond({ Ack: ack });
          if (ack === 0 && !faults.neverStarts) {
            state.current = d.Data.Filename;
            setTimeout(() => { state.status = 16; ws.send(JSON.stringify(statusMsg())); }, faults.startDelayMs || 50);
          }
          break;
        }
        case 129: respond({}); state.status = 6; break;
        case 131: respond({}); state.status = 13; break;
        case 130: respond({}); state.status = 8; break;
        case 401: {
          // Занятый принтер оси не двигает (Ack 1), без «домой» - Ack 3, как у Elegoo.
          const a = d.Data || {};
          const k = String(a.Axis || '').toLowerCase();
          if (!FREE.includes(state.status)) { respond({ Ack: 1 }); break; }
          if (!state.homed) { respond({ Ack: 3 }); break; }
          if (!['x', 'y', 'z'].includes(k) || !Number.isFinite(a.Step)) { respond({ Ack: 2 }); break; }
          state.coord[k] = Math.max(0, Math.min(LIMIT[k], state.coord[k] + a.Step));
          respond({});
          ws.send(JSON.stringify(statusMsg()));
          break;
        }
        case 402: {
          const a = String((d.Data && d.Data.Axis) || '');
          if (!FREE.includes(state.status)) { respond({ Ack: 1 }); break; }
          if (!['XYZ', 'X', 'Y', 'Z'].includes(a)) { respond({ Ack: 2 }); break; }
          for (const k of a.toLowerCase()) state.coord[k] = 0;
          if (a === 'XYZ') state.homed = true;
          respond({});
          ws.send(JSON.stringify(statusMsg()));
          break;
        }
        case 403: {
          const a = d.Data || {};
          if (a.TempTargetNozzle !== undefined) state.targetNozzle = a.TempTargetNozzle;
          if (a.TempTargetHotbed !== undefined) state.targetBed = a.TempTargetHotbed;
          if (a.TargetFanSpeed) Object.assign(state.fans, a.TargetFanSpeed);
          if (a.LightStatus && a.LightStatus.SecondLight !== undefined) state.light = a.LightStatus.SecondLight;
          if (a.PrintSpeedPct !== undefined) state.speed = a.PrintSpeedPct;
          respond({});
          ws.send(JSON.stringify(statusMsg()));
          break;
        }
        case 386: state.camera = d.Data && d.Data.Enable === 1; respond({ VideoUrl: '127.0.0.1:' + server.address().port + '/video' }); break;
        default: respond({ Ack: 1 });
      }
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const udp = dgram.createSocket('udp4');
  udp.on('message', (buf, rinfo) => {
    if (String(buf) !== 'M99999') return;
    log.push({ udp: 'M99999' });
    // announcePort: адрес вместе с портом подделки, чтобы найденный «принтер» был этой подделкой.
    const ip = opts.announcePort ? '127.0.0.1:' + server.address().port : '127.0.0.1';
    udp.send(Buffer.from(JSON.stringify({ Id: 'x', Data: { Name: 'Fake CC', MachineName: 'Elegoo Centauri Carbon', MainboardIP: ip, MainboardID: MAINBOARD } })), rinfo.port, rinfo.address);
  });
  await new Promise((r) => udp.bind(0, '127.0.0.1', r));
  const port = server.address().port;
  let closing = null;
  return {
    host: '127.0.0.1:' + port, hostname: '127.0.0.1', port, udpPort: udp.address().port, mainboardId: MAINBOARD,
    state, log, faults,
    setStatus(s) { state.status = s; for (const c of wss.clients) c.send(JSON.stringify(statusMsg())); },
    pushStatus() { for (const c of wss.clients) c.send(JSON.stringify(statusMsg())); },
    commands(cmd) { return log.filter((e) => e.cmd === cmd); },
    // Повторный close ничего не делает (закон «обрыв связи» закрывает подделку посреди теста).
    close: () => closing || (closing = new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(); udp.close(); server.close(() => r()); server.closeAllConnections && server.closeAllConnections(); })),
  };
}

module.exports = { startFakePrinter, parseMultipart, MAINBOARD };

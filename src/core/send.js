// Надёжная отправка: вторая жалоба Алексея - «криво скидываются и там могут не
// отображаться, приходится скидывать раз 5». Печать стартует только когда принтер сам
// показывает файл в списке (и размер совпал, если он его сообщает). Сбой - повтор
// загрузки целиком, до attempts раз. Команда старта уходит не больше одного раза.
'use strict';
const { PrinterClient } = require('./printer-client');
const { uploadFile } = require('./upload');
const { CMD, isBusy, hasStarted } = require('./sdcp');

class SendError extends Error {
  constructor(code, info = {}) {
    super(code);
    this.code = code;
    Object.assign(this, info);
  }
}


/** Имя, которого ещё нет на принтере: иначе проверка «файл виден» нашла бы старый файл. */
function uniqueName(name, taken) {
  const set = new Set(taken.map((t) => t.replace(/^\/local\//, '')));
  if (!set.has(name)) return name;
  const m = /^(.*?)(\.gcode)$/i.exec(name) || [name, name, ''];
  for (let i = 2; i < 1000; i++) {
    const n = `${m[1]}_${i}${m[2]}`;
    if (!set.has(n)) return n;
  }
  return `${m[1]}_${Date.now()}${m[2]}`;
}

// Пауза, которую прерывает отмена.
function pause(ms, signal) {
  return new Promise((resolve) => {
    if (!signal) { setTimeout(resolve, ms); return; }
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); signal.removeEventListener('abort', done); resolve(); }
    signal.addEventListener('abort', done);
  });
}

async function waitListed(client, remote, size, { timeoutMs, pollMs, signal, onTick = () => {} }) {
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  let last = null;
  for (;;) {
    if (signal && signal.aborted) throw new SendError('canceled');
    onTick(Math.floor((Date.now() - t0) / 1000));
    let list = null;
    try { list = await client.listFiles({ timeoutMs: Math.min(8000, Math.max(1000, deadline - Date.now())) }); } catch { /* повторим */ }
    if (list) {
      const f = list.find((x) => x.name === remote);
      if (f) {
        if (f.size === null || f.size === size) return { ok: true, size: f.size };
        last = { ok: false, code: 'size-mismatch', got: f.size };
        return last;                       // размер уже не изменится: принтер сохранил файл криво
      }
    }
    if (Date.now() >= deadline) return last || { ok: false, code: 'not-listed' };
    await pause(pollMs, signal);
  }
}

async function waitStarted(client, timeoutMs, pollMs) {
  if (client.lastStatus && hasStarted(client.lastStatus)) return true;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(t); clearInterval(poll); client.off('status', h); resolve(v); };
    const h = (s) => { if (hasStarted(s)) finish(true); };
    client.on('status', h);
    const poll = setInterval(() => { client.status({ timeoutMs: pollMs }).catch(() => {}); }, pollMs);
    const t = setTimeout(async () => {
      try { finish(hasStarted(await client.status({ timeoutMs: 4000 }))); } catch { finish(false); }
    }, timeoutMs);
  });
}

/**
 * @returns {Promise<{ok: true, name: string, attempts: number, started: boolean}>}
 * Ошибки SendError.code: offline, busy, empty, upload, not-listed, size-mismatch, start-rejected, not-started.
 */
async function sendToPrinter({
  host, port, buffer, remoteName, start = true, attempts = 3, bedLeveling = true,
  verifyTimeoutMs = 20000, startTimeoutMs = 60000, pollMs = 1000, chunkSize,
  connect = PrinterClient.connect, upload = uploadFile, onStep = () => {}, signal = null,
}) {
  if (!buffer || !buffer.length) throw new SendError('empty');
  // Отмена (обзор 23.10 Б4): проверяется до каждого шага. После команды старта не отменить:
  // она уходит один раз, дальше печать идёт на принтере.
  const stop = () => { if (signal && signal.aborted) throw new SendError('canceled', { step: 'cancel' }); };
  onStep({ step: 'connect' });
  let client;
  try { client = await connect(host, { port }); } catch (e) { throw new SendError('offline', { detail: e.message, step: 'connect' }); }
  try {
    stop();
    onStep({ step: 'check-idle' });
    let status;
    try { status = await client.status(); } catch (e) { throw new SendError('offline', { detail: e.message, step: 'check-idle' }); }
    if (start && isBusy(status)) throw new SendError('busy', { status: status && status.PrintInfo && status.PrintInfo.Status, step: 'check-idle' });
    stop();
    let taken = [];
    try { taken = (await client.listFiles()).map((f) => f.name); } catch { /* список не пришёл - имя проверим после загрузки */ }
    const name = uniqueName(remoteName, taken);
    const remote = '/local/' + name;

    let lastErr = null, attempt = 0, listed = false;
    while (attempt < attempts && !listed) {
      stop();
      attempt += 1;
      onStep({ step: 'upload', attempt, attempts, sent: 0, total: buffer.length });
      try {
        await upload({ host, port, buffer, remoteName: name, chunkSize, signal,
          onProgress: (p) => onStep({ step: 'upload', attempt, attempts, sent: p.sent, total: p.total }) });
      } catch (e) {
        stop();
        lastErr = new SendError('upload', { detail: e.code || e.message, attempts: attempt, step: 'upload' });
        continue;
      }
      const timeoutSec = Math.round(verifyTimeoutMs / 1000);
      const v = await waitListed(client, remote, buffer.length, { timeoutMs: verifyTimeoutMs, pollMs, signal,
        onTick: (waitedSec) => onStep({ step: 'verify', attempt, attempts, waitedSec, timeoutSec }) });
      if (v.ok) listed = true;
      else lastErr = new SendError(v.code, { got: v.got, want: buffer.length, attempts: attempt, step: 'verify' });
    }
    if (!listed) throw lastErr;
    stop();
    if (!start) return { ok: true, name, attempts: attempt, started: false };

    onStep({ step: 'start' });
    try {
      const now = await client.status();
      if (isBusy(now)) throw new SendError('busy', { status: now.PrintInfo && now.PrintInfo.Status, step: 'start' });
    } catch (e) { if (e instanceof SendError) throw e; }
    stop();                                 // последняя возможность отменить - до команды старта
    let ack = null;
    try {
      const r = await client.request(CMD.START, { Filename: remote, StartLayer: 0, Calibration_switch: bedLeveling ? 1 : 0, Tlp_Switch: 0 }, { timeoutMs: 10000 });
      ack = Number(r.Ack);
    } catch { ack = null; }                 // ответа нет - но команда могла дойти: второй раз не шлём
    if (ack !== null && ack !== 0) throw new SendError('start-rejected', { ack, name, step: 'start' });
    const started = await waitStarted(client, startTimeoutMs, Math.max(pollMs, 2000));
    if (!started) throw new SendError('not-started', { name, step: 'start' });
    onStep({ step: 'started', name });
    return { ok: true, name, attempts: attempt, started: true };
  } finally {
    client.close();
  }
}

module.exports = { sendToPrinter, SendError, uniqueName };

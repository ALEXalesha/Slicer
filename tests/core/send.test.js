'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fc = require('fast-check');
const { sendToPrinter, uniqueName } = require('../../src/core/send');
const { uploadFile } = require('../../src/core/upload');
const { startFakePrinter } = require('../support/fake-printer');

const CH = 64 * 1024;
const fast = { verifyTimeoutMs: 600, startTimeoutMs: 1500, pollMs: 100, chunkSize: CH };
const data = (n, seed = 1) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed * 7) & 255; return b; };

async function withFake(opts, fn) {
  const fake = await startFakePrinter(opts);
  try { return await fn(fake); } finally { await fake.close(); }
}

function checkInvariants(fake) {
  assert.ok(fake.commands(128).length <= 1, 'start sent more than once');
  assert.ok(fake.commands(386).every((e) => e.data && e.data.Enable === 1), 'camera disabled');
}

test('happy path: upload in chunks, listed, started once', () => withFake({}, async (fake) => {
  const buf = data(200 * 1024 + 17);
  const steps = [];
  const r = await sendToPrinter({ host: fake.host, buffer: buf, remoteName: 'Cube_PLA_10m.gcode', ...fast, onStep: (s) => steps.push(s.step) });
  assert.deepStrictEqual(r, { ok: true, name: 'Cube_PLA_10m.gcode', attempts: 1, started: true });
  assert.ok(fake.state.files.get('/local/Cube_PLA_10m.gcode').equals(buf));
  assert.deepStrictEqual(fake.commands(128).map((e) => e.data), [{ Filename: '/local/Cube_PLA_10m.gcode', StartLayer: 0, Calibration_switch: 1, Tlp_Switch: 0 }]);
  assert.deepStrictEqual([...new Set(steps)], ['connect', 'check-idle', 'upload', 'verify', 'start', 'started']);
  assert.strictEqual(fake.log.filter((e) => e.http === 'chunk').length, 4);
  checkInvariants(fake);
}));

test('connection drop in the middle of the upload: retried and succeeds', () => withFake({ faults: { dropAfterBytes: 100 * 1024 } }, async (fake) => {
  const buf = data(300 * 1024);
  const r = await sendToPrinter({ host: fake.host, buffer: buf, remoteName: 'a.gcode', ...fast });
  assert.strictEqual(r.ok, true);
  assert.ok(fake.state.files.get('/local/a.gcode').equals(buf));
  assert.ok(fake.log.some((e) => e.http === 'drop'));
  checkInvariants(fake);
}));

test('two failed chunks are repeated in place', () => withFake({ faults: { failChunks: 2 } }, async (fake) => {
  const r = await sendToPrinter({ host: fake.host, buffer: data(150 * 1024), remoteName: 'b.gcode', ...fast });
  assert.strictEqual(r.attempts, 1);
}));

test('printer stores the file cut in half every time: size-mismatch after 3 attempts, no start', () => withFake({ faults: { truncateStore: true } }, async (fake) => {
  await assert.rejects(sendToPrinter({ host: fake.host, buffer: data(100 * 1024), remoteName: 'c.gcode', ...fast }),
    (e) => e.code === 'size-mismatch' && e.attempts === 3 && e.got === 50 * 1024 && e.want === 100 * 1024);
  assert.strictEqual(fake.commands(128).length, 0);
}));

test('cut once, then fine: second attempt wins', () => withFake({ faults: { truncateStore: true, truncateTimes: 1 } }, async (fake) => {
  const r = await sendToPrinter({ host: fake.host, buffer: data(100 * 1024), remoteName: 'd.gcode', ...fast });
  assert.strictEqual(r.attempts, 2);
  assert.strictEqual(fake.commands(128).length, 1);
}));

test('printer never shows the file: not-listed, no start', () => withFake({ faults: { hideFile: true } }, async (fake) => {
  await assert.rejects(sendToPrinter({ host: fake.host, buffer: data(1000), remoteName: 'e.gcode', ...fast }), (e) => e.code === 'not-listed' && e.attempts === 3);
  assert.strictEqual(fake.commands(128).length, 0);
}));

test('file appears in the list after a delay: waits, no extra upload', () => withFake({ faults: { listDelayMs: 300 } }, async (fake) => {
  const r = await sendToPrinter({ host: fake.host, buffer: data(1000), remoteName: 'f.gcode', ...fast });
  assert.strictEqual(r.attempts, 1);
}));

test('printer without sizes in the list still verifies by name', () => withFake({ faults: { noSizeInList: true } }, async (fake) => {
  const r = await sendToPrinter({ host: fake.host, buffer: data(1000), remoteName: 'g.gcode', ...fast });
  assert.strictEqual(r.ok, true);
}));

test('start refused: start-rejected with the ack', () => withFake({ faults: { startAck: 1 } }, async (fake) => {
  await assert.rejects(sendToPrinter({ host: fake.host, buffer: data(1000), remoteName: 'h.gcode', ...fast }), (e) => e.code === 'start-rejected' && e.ack === 1);
  assert.strictEqual(fake.commands(128).length, 1);
}));

test('printer accepts the start but never starts: not-started, start sent once', () => withFake({ faults: { neverStarts: true } }, async (fake) => {
  await assert.rejects(sendToPrinter({ host: fake.host, buffer: data(1000), remoteName: 'i.gcode', ...fast }), (e) => e.code === 'not-started');
  assert.strictEqual(fake.commands(128).length, 1);
}));

test('busy printer: refused before any upload', () => withFake({ status: 13 }, async (fake) => {
  await assert.rejects(sendToPrinter({ host: fake.host, buffer: data(1000), remoteName: 'j.gcode', ...fast }), (e) => e.code === 'busy');
  assert.strictEqual(fake.log.filter((e) => e.http).length, 0);
}));

test('export-only send to a busy printer is allowed (start false)', () => withFake({ status: 13 }, async (fake) => {
  const r = await sendToPrinter({ host: fake.host, buffer: data(1000), remoteName: 'k.gcode', start: false, ...fast });
  assert.deepStrictEqual([r.ok, r.started], [true, false]);
  assert.strictEqual(fake.commands(128).length, 0);
}));

test('an old file with the same name cannot pass for the new one', () => withFake({ faults: { hideFile: true } }, async (fake) => {
  fake.state.files.set('/local/same.gcode', data(1000, 9));
  fake.state.listAfter.set('/local/same.gcode', 0);
  await assert.rejects(sendToPrinter({ host: fake.host, buffer: data(1000), remoteName: 'same.gcode', ...fast }), (e) => e.code === 'not-listed');
  assert.ok(fake.log.filter((e) => e.http === 'chunk').every((e) => e.name === 'same_2.gcode'));
}));

test('offline printer and empty file', async () => {
  await assert.rejects(sendToPrinter({ host: '127.0.0.1:1', buffer: data(10), remoteName: 'x.gcode', ...fast }), (e) => e.code === 'offline');
  await assert.rejects(sendToPrinter({ host: '127.0.0.1:1', buffer: Buffer.alloc(0), remoteName: 'x.gcode', ...fast }), (e) => e.code === 'empty');
});

test('uniqueName', () => {
  assert.strictEqual(uniqueName('a.gcode', []), 'a.gcode');
  assert.strictEqual(uniqueName('a.gcode', ['/local/a.gcode', '/local/a_2.gcode']), 'a_3.gcode');
});

test('upload sends the same MD5 as the whole file in every chunk', () => withFake({}, async (fake) => {
  const buf = data(130 * 1024);
  const r = await uploadFile({ host: fake.host, buffer: buf, remoteName: 'm.gcode', chunkSize: CH });
  assert.strictEqual(r.md5, crypto.createHash('md5').update(buf).digest('hex'));
  assert.deepStrictEqual(fake.log.filter((e) => e.http === 'chunk').map((e) => e.offset), [0, CH, 2 * CH]);
}));

test('law: under any mix of faults - at most one start, never camera off, ok means byte-exact file', async () => {
  await fc.assert(fc.asyncProperty(
    fc.record({
      size: fc.integer({ min: 1, max: 400 * 1024 }),
      drop: fc.option(fc.integer({ min: 1, max: 300 * 1024 }), { nil: undefined }),
      failChunks: fc.integer({ min: 0, max: 5 }),
      truncateTimes: fc.integer({ min: 0, max: 4 }),
      hideTimes: fc.integer({ min: 0, max: 4 }),
      startAck: fc.option(fc.constantFrom(0, 1, 2, 3), { nil: undefined }),
      neverStarts: fc.boolean(),
      busy: fc.boolean(),
    }),
    async (f) => {
      const faults = { failChunks: f.failChunks, truncateStore: f.truncateTimes > 0, truncateTimes: f.truncateTimes, hideFile: f.hideTimes > 0, hideTimes: f.hideTimes, neverStarts: f.neverStarts };
      if (f.drop !== undefined) faults.dropAfterBytes = f.drop;
      if (f.startAck !== undefined) faults.startAck = f.startAck;
      await withFake({ faults, status: f.busy ? 13 : 0 }, async (fake) => {
        const buf = data(f.size, f.size);
        let r = null;
        try { r = await sendToPrinter({ host: fake.host, buffer: buf, remoteName: 'law.gcode', ...fast, verifyTimeoutMs: 300, startTimeoutMs: 600 }); } catch (e) { assert.ok(e.code, 'error without code'); }
        checkInvariants(fake);
        if (r) {
          assert.ok(fake.state.files.get('/local/' + r.name).equals(buf), 'ok but file differs');
          assert.strictEqual(fake.commands(128).length, 1);
        }
        if (f.busy) assert.strictEqual(r, null);
      });
    }), { numRuns: 60 });
});

// Обзор 23.10 Б4: ожидание «принтер видит файл» шло до минуты молча, отменить было нельзя.
test('verify step reports attempt and seconds; cancel while waiting stops before any start', () => withFake({ faults: { hideFile: true } }, async (fake) => {
  const ctl = new AbortController();
  const ticks = [];
  const p = sendToPrinter({ host: fake.host, buffer: data(1000), remoteName: 'c.gcode', ...fast, verifyTimeoutMs: 5000, signal: ctl.signal,
    onStep: (s) => { if (s.step === 'verify') { ticks.push(s); if (ticks.length === 3) ctl.abort(); } } });
  const t0 = Date.now();
  await assert.rejects(p, (e) => e.code === 'canceled');
  assert.ok(Date.now() - t0 < 3000, 'cancel took too long');
  assert.ok(ticks.every((s) => s.attempt === 1 && s.attempts === 3 && s.timeoutSec === 5 && Number.isFinite(s.waitedSec)));
  assert.strictEqual(fake.commands(128).length, 0);
}));

test('cancel before the upload: nothing is uploaded, nothing starts', () => withFake({}, async (fake) => {
  const ctl = new AbortController();
  const p = sendToPrinter({ host: fake.host, buffer: data(300 * 1024), remoteName: 'd.gcode', ...fast, signal: ctl.signal,
    onStep: (s) => { if (s.step === 'check-idle') ctl.abort(); } });
  await assert.rejects(p, (e) => e.code === 'canceled');
  assert.strictEqual(fake.log.filter((e) => e.http === 'chunk').length, 0);
  assert.strictEqual(fake.commands(128).length, 0);
}));

test('cancel during the upload stops between chunks; nothing starts', () => withFake({}, async (fake) => {
  const ctl = new AbortController();
  const p = sendToPrinter({ host: fake.host, buffer: data(640 * 1024), remoteName: 'u.gcode', ...fast, signal: ctl.signal,
    onStep: (s) => { if (s.step === 'upload' && s.sent >= 2 * CH) ctl.abort(); } });
  await assert.rejects(p, (e) => e.code === 'canceled');
  assert.ok(fake.log.filter((e) => e.http === 'chunk').length < 10);
  assert.strictEqual(fake.commands(128).length, 0);
}));

test('cancel that comes with the start step still stops before the start command', () => withFake({}, async (fake) => {
  const ctl = new AbortController();
  const p = sendToPrinter({ host: fake.host, buffer: data(1000), remoteName: 's.gcode', ...fast, signal: ctl.signal,
    onStep: (s) => { if (s.step === 'start') ctl.abort(); } });
  await assert.rejects(p, (e) => e.code === 'canceled');
  assert.strictEqual(fake.commands(128).length, 0);
}));

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const fc = require('fast-check');
const S = require('../../src/core/sdcp');
const { PrinterClient, splitHost } = require('../../src/core/printer-client');
const { discover, parseReply } = require('../../src/core/discovery');
const { startFakePrinter, MAINBOARD } = require('../support/fake-printer');

test('request shape matches what the printer accepts', () => {
  const r = JSON.parse(S.makeRequest(258, { Url: '/local/' }, 'MB1', 1700000000000));
  assert.strictEqual(r.Topic, 'sdcp/request/MB1');
  assert.deepStrictEqual(Object.keys(r.Data).sort(), ['Cmd', 'Data', 'From', 'MainboardID', 'RequestID', 'TimeStamp']);
  assert.strictEqual(r.Data.TimeStamp, 1700000000);
  assert.strictEqual(r.Data.From, 0);
});

test('law: the camera may only be enabled - any other 386 request throws', () => {
  fc.assert(fc.property(fc.oneof(fc.anything(), fc.record({ Enable: fc.anything() })), (data) => {
    const enableOne = data && typeof data === 'object' && !Array.isArray(data) && data.Enable === 1;
    if (enableOne) assert.doesNotThrow(() => S.makeRequest(386, data, 'MB'));
    else assert.throws(() => S.makeRequest(386, data, 'MB'), (e) => e.code === 'forbidden');
  }), { numRuns: 400 });
  assert.throws(() => S.makeRequest(386, { Enable: 0 }, 'MB'), (e) => e.code === 'forbidden');
});

test('law: no source file builds a camera request other than Enable 1', () => {
  const dir = path.join(__dirname, '..', '..', 'src');
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); } else if (p.endsWith('.js')) files.push(p); } };
  walk(dir);
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/Enable\s*:\s*0/.test(t), f + ' has Enable: 0');
    assert.ok(!/\b386\b[^\n]*Enable[^\n]*false/.test(t), f);
  }
});

test('busy and started states', () => {
  const st = (n) => ({ PrintInfo: { Status: n } });
  for (const n of [0, 8, 9]) assert.strictEqual(S.isBusy(st(n)), false, String(n));
  for (const n of [1, 5, 6, 7, 10, 13, 16, 20, 99]) assert.strictEqual(S.isBusy(st(n)), true, String(n));
  assert.strictEqual(S.isBusy({}), true);                 // неизвестно - считаем занятым
  assert.strictEqual(S.hasStarted(st(16)), true);
  assert.strictEqual(S.hasStarted(st(0)), false);
});

test('mainboard id from fields or topic; file list parsing', () => {
  assert.strictEqual(S.mainboardOf({ Data: { MainboardID: 'A' } }), 'A');
  assert.strictEqual(S.mainboardOf({ Topic: 'sdcp/status/BCD' }), 'BCD');
  assert.strictEqual(S.mainboardOf({ Topic: 'other/x' }), '');
  assert.deepStrictEqual(S.parseFileList({ FileList: [{ name: '/local/a', type: 0 }, { name: '/local/b.gcode', type: 1, FileSize: 5 }, { name: '/local/c.gcode', type: 1 }, null] }),
    [{ name: '/local/b.gcode', size: 5 }, { name: '/local/c.gcode', size: null }]);
  assert.deepStrictEqual(splitHost('10.0.0.5'), { hostname: '10.0.0.5', port: 3030 });
  assert.deepStrictEqual(splitHost('127.0.0.1:4000'), { hostname: '127.0.0.1', port: 4000 });
});

test('client against the fake printer: status, list, pause, resume, stop, camera', async () => {
  const fake = await startFakePrinter({ status: 13 });
  const c = await PrinterClient.connect(fake.host);
  try {
    assert.strictEqual(c.mainboardId, MAINBOARD);
    const s = await c.status();
    assert.strictEqual(s.PrintInfo.Status, 13);
    assert.deepStrictEqual(await c.listFiles(), []);
    await c.pause();
    await c.resume();
    await c.stop();
    assert.deepStrictEqual(fake.log.filter((e) => [129, 130, 131].includes(e.cmd)).map((e) => e.cmd), [129, 131, 130]);
    assert.match(await c.cameraUrl(), /^http:\/\/127\.0\.0\.1:\d+\/video$/);
    assert.deepStrictEqual(fake.commands(386).map((e) => e.data), [{ Enable: 1 }]);
  } finally { c.close(); await fake.close(); }
});

test('client: silent printer times out, no printer is offline, no mainboard id is an error', async () => {
  const fake = await startFakePrinter({ faults: { silent: true } });
  const c = await PrinterClient.connect(fake.host);
  await assert.rejects(c.request(0, {}, { timeoutMs: 300 }), (e) => e.code === 'timeout');
  c.close();
  await fake.close();
  await assert.rejects(PrinterClient.connect('127.0.0.1:1', { timeoutMs: 800 }), (e) => e.code === 'offline');
  const quiet = await startFakePrinter({ faults: { silentMainboard: true } });
  await assert.rejects(PrinterClient.connect(quiet.host, { timeoutMs: 600 }), (e) => e.code === 'no-mainboard');
  const ok = await PrinterClient.connect(quiet.host, { mainboardId: MAINBOARD });
  ok.close();
  await quiet.close();
});

test('discovery finds the fake printer and skips foreign replies', async () => {
  const fake = await startFakePrinter();
  try {
    const found = await discover({ address: '127.0.0.1', port: fake.udpPort, timeoutMs: 700 });
    assert.deepStrictEqual(found.map((f) => [f.host, f.mainboardId]), [['127.0.0.1', MAINBOARD]]);
  } finally { await fake.close(); }
  assert.strictEqual(parseReply(Buffer.from('hello')), null);
  assert.strictEqual(parseReply(Buffer.from('{"Data":{"Name":"tv"}}')), null);
});

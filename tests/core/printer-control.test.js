// Управление принтером: формирование 401/402/403, защита «занятый принтер не двигается»
// в клиенте и в сеансе главного процесса, поддельный принтер отвечает как настоящий.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const C = require('../../src/core/printer-control');
const S = require('../../src/core/sdcp');
const { PrinterClient } = require('../../src/core/printer-client');
const { PrinterPanel } = require('../../electron/printer-session');
const { startFakePrinter } = require('../support/fake-printer');

const anyValue = fc.oneof(fc.anything(), fc.double(), fc.integer({ min: -1000, max: 1000 }), fc.constantFrom('X', 'Y', 'Z', 'XYZ', 'x', '', 0, 1, -1, 0.1, 100, 101, -100, 350, 351, 110, 111, NaN, Infinity, -0));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const okInt = (v, max) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const throwsCode = (fn) => { try { fn(); return null; } catch (e) { return e.code || 'no-code'; } };

test('law: move data - axis only X/Y/Z, step finite, not zero, |step| <= 100; anything else throws', () => {
  fc.assert(fc.property(anyValue, anyValue, (axis, step) => {
    const valid = C.AXES.includes(axis) && isNum(step) && step !== 0 && Math.abs(step) <= 100;
    const code = throwsCode(() => C.moveData(axis, step));
    if (valid) {
      assert.strictEqual(code, null);
      const d = C.moveData(axis, step);
      assert.deepStrictEqual(Object.keys(d), ['Axis', 'Step']);
      assert.strictEqual(d.Axis, axis);
      assert.ok(Math.abs(d.Step - step) < 0.001);
    } else assert.ok(code === 'bad-axis' || code === 'bad-step', String(code));
  }), { numRuns: 1500 });
});

test('law: temperatures - whole degrees, nozzle 0..350, bed 0..110, at least one; anything else throws', () => {
  fc.assert(fc.property(fc.oneof(fc.constant(undefined), anyValue), fc.oneof(fc.constant(undefined), anyValue), (nozzle, bed) => {
    const valid = (nozzle !== undefined || bed !== undefined) && (nozzle === undefined || okInt(nozzle, 350)) && (bed === undefined || okInt(bed, 110));
    const code = throwsCode(() => C.tempData({ nozzle, bed }));
    if (!valid) { assert.strictEqual(code, 'bad-temp'); return; }
    const d = C.tempData({ nozzle, bed });
    const want = {};
    if (nozzle !== undefined) want.TempTargetNozzle = nozzle;
    if (bed !== undefined) want.TempTargetHotbed = bed;
    assert.deepStrictEqual(d, want);
  }), { numRuns: 1500 });
  for (const bad of [351, -1, 220.5, '220', null, NaN]) assert.strictEqual(throwsCode(() => C.tempData({ nozzle: bad })), 'bad-temp', String(bad));
  for (const bad of [111, -1, 60.5]) assert.strictEqual(throwsCode(() => C.tempData({ bed: bad })), 'bad-temp', String(bad));
  assert.deepStrictEqual(C.tempData({ nozzle: 350 }), { TempTargetNozzle: 350 });
  assert.deepStrictEqual(C.tempData({ bed: 110 }), { TempTargetHotbed: 110 });
});

test('law: fans - all three, whole 0..100; light 0/1; speed 50/100/130/160; home axis from the list', () => {
  fc.assert(fc.property(anyValue, anyValue, anyValue, (model, aux, box) => {
    const valid = [model, aux, box].every((v) => okInt(v, 100));
    const code = throwsCode(() => C.fanData({ model, aux, box }));
    if (valid) assert.deepStrictEqual(C.fanData({ model, aux, box }), { TargetFanSpeed: { ModelFan: model, AuxiliaryFan: aux, BoxFan: box } });
    else assert.strictEqual(code, 'bad-fan');
  }), { numRuns: 1000 });
  fc.assert(fc.property(anyValue, (v) => {
    if (v === 0 || v === 1) assert.deepStrictEqual(C.lightData(v), { LightStatus: { SecondLight: v, RgbLight: [0, 0, 0] } });
    else assert.strictEqual(throwsCode(() => C.lightData(v)), 'bad-light');
    if ([50, 100, 130, 160].includes(v)) assert.deepStrictEqual(C.speedData(v), { PrintSpeedPct: v });
    else assert.strictEqual(throwsCode(() => C.speedData(v)), 'bad-speed');
    if (['XYZ', 'X', 'Y', 'Z'].includes(v)) assert.deepStrictEqual(C.homeData(v), { Axis: v });
    else assert.strictEqual(throwsCode(() => C.homeData(v)), 'bad-axis');
  }), { numRuns: 1000 });
});

test('law: makeRequest refuses any 401/402/403 that the builders would not make', () => {
  const good = [
    [401, C.moveData('X', 10)], [401, C.moveData('Z', -0.1)], [402, C.homeData('XYZ')], [403, C.tempData({ nozzle: 200, bed: 60 })],
    [403, C.fanData({ model: 100, aux: 0, box: 50 })], [403, C.lightData(1)], [403, C.speedData(130)],
  ];
  for (const [cmd, data] of good) assert.doesNotThrow(() => S.makeRequest(cmd, data, 'MB'), JSON.stringify(data));
  fc.assert(fc.property(fc.constantFrom(401, 402, 403), fc.oneof(fc.anything(),
    fc.record({ Axis: anyValue, Step: anyValue }), fc.record({ TempTargetNozzle: anyValue }), fc.record({ TempTargetHotbed: anyValue }),
    fc.record({ TargetFanSpeed: fc.record({ ModelFan: anyValue, AuxiliaryFan: anyValue, BoxFan: anyValue }) }),
    fc.record({ LightStatus: fc.record({ SecondLight: anyValue }) }), fc.record({ PrintSpeedPct: anyValue })), (cmd, data) => {
    let builderOk = false;
    try { C.checkData(cmd, data); builderOk = true; } catch { builderOk = false; }
    const sent = throwsCode(() => S.makeRequest(cmd, data, 'MB')) === null;
    assert.strictEqual(sent, builderOk, cmd + ' ' + JSON.stringify(data));
    if (sent && cmd === 401) assert.ok(C.AXES.includes(data.Axis) && Math.abs(data.Step) <= 100 && data.Step !== 0);
    if (sent && cmd === 403 && 'TempTargetNozzle' in data) assert.ok(okInt(data.TempTargetNozzle, 350));
    if (sent && cmd === 403 && 'TempTargetHotbed' in data) assert.ok(okInt(data.TempTargetHotbed, 110));
  }), { numRuns: 2000 });
  // крайние случаи руками
  for (const [cmd, data] of [[401, { Axis: 'X', Step: 101 }], [401, { Axis: 'E', Step: 1 }], [401, { Axis: 'X', Step: 0 }], [401, { Axis: 'X', Step: 1, Extra: 1 }],
    [403, { TempTargetNozzle: 351 }], [403, { TempTargetHotbed: 111 }], [403, {}], [403, { Foo: 1 }], [403, { LightStatus: { SecondLight: 2 } }],
    [403, { TargetFanSpeed: { ModelFan: 101, AuxiliaryFan: 0, BoxFan: 0 } }], [403, { TargetFanSpeed: { ModelFan: 1 } }], [402, { Axis: 'XY' }]]) {
    assert.throws(() => S.makeRequest(cmd, data, 'MB'), JSON.stringify(data));
  }
});

test('law: Z up is a negative step, X/Y keep the sign; the size is the step', () => {
  fc.assert(fc.property(fc.constantFrom('X', 'Y', 'Z'), fc.constantFrom(1, -1), fc.constantFrom(...C.STEPS), (axis, dir, size) => {
    const s = C.jogStep(axis, dir, size);
    assert.strictEqual(Math.abs(s), size);
    assert.strictEqual(Math.sign(s), axis === 'Z' ? -dir : dir);
  }));
  assert.strictEqual(C.jogStep('Z', 1, 10), -10);              // «Z вверх» как у Elegoo
  assert.strictEqual(C.jogStep('Z', -1, 0.1), 0.1);
  assert.strictEqual(C.jogStep('X', 1, 50), 50);
  for (const [a, d, s] of [['Z', 0, 1], ['Z', 2, 1], ['Q', 1, 1], ['X', 1, 101], ['X', 1, 0], ['X', 1, NaN]]) assert.throws(() => C.jogStep(a, d, s));
});

test('canMove: only idle / stopped / finished with nothing running; unknown = busy', () => {
  const st = (n, cs) => Object.assign({ PrintInfo: { Status: n } }, cs === undefined ? {} : { CurrentStatus: cs });
  for (const n of [0, 8, 9]) { assert.strictEqual(C.canMove(st(n)), true, String(n)); assert.strictEqual(C.canMove(st(n, [0])), true); }
  for (const n of [1, 5, 6, 7, 10, 13, 16, 20, 99, -1]) assert.strictEqual(C.canMove(st(n, [0])), false, String(n));
  assert.strictEqual(C.canMove(st(0, [1])), false);
  assert.strictEqual(C.canMove(st(0, 'x')), false);
  for (const bad of [null, undefined, {}, [], 'x', { PrintInfo: null }, { PrintInfo: { Status: '0' } }, { PrintInfo: { Status: NaN } }, { PrintInfo: {} }]) assert.strictEqual(C.canMove(bad), false, JSON.stringify(bad));
  fc.assert(fc.property(fc.anything(), (s) => { if (C.canMove(s)) assert.ok([0, 8, 9].includes(s.PrintInfo.Status)); }));
});

test('readControl: coordinates from CurrenCoord, targets, fans, light, speed; junk gives nulls', () => {
  const r = C.readControl({ CurrenCoord: '12.50,30.00,5.25', TempTargetNozzle: 210, TempTargetHotbed: 60, CurrentFanSpeed: { ModelFan: 100, AuxiliaryFan: 0, BoxFan: 40 },
    LightStatus: { SecondLight: 1 }, PrintInfo: { PrintSpeedPct: 130 } });
  assert.deepStrictEqual(r, { x: 12.5, y: 30, z: 5.25, nozzleTarget: 210, bedTarget: 60, fans: { model: 100, aux: 0, box: 40 }, light: 1, speed: 130 });
  for (const junk of [null, {}, { CurrenCoord: '1,2' }, { CurrenCoord: 'a,b,c' }, { CurrenCoord: ',,' }]) {
    const j = C.readControl(junk);
    assert.strictEqual(j.x, null);
    assert.strictEqual(j.light, null);
  }
});

test('client: printing printer - move and home send nothing (busy); idle - exactly one right request each', async () => {
  const fake = await startFakePrinter({ status: 13 });
  const c = await PrinterClient.connect(fake.host);
  try {
    await assert.rejects(c.move('X', 10), (e) => e.code === 'busy');
    await assert.rejects(c.home('XYZ'), (e) => e.code === 'busy');
    assert.strictEqual(fake.commands(401).length + fake.commands(402).length, 0);
    for (const s of [1, 5, 6, 7, 10, 16, 20]) {
      fake.setStatus(s);
      await assert.rejects(c.move('Y', 1), (e) => e.code === 'busy', String(s));
    }
    assert.strictEqual(fake.commands(401).length, 0);
    // температура во время печати разрешена (её подтверждает человек в окне)
    await c.setTemps({ nozzle: 215 });
    assert.deepStrictEqual(fake.commands(403).map((e) => e.data), [{ TempTargetNozzle: 215 }]);

    fake.setStatus(0);
    await c.move('X', 10);
    await c.move('Z', C.jogStep('Z', 1, 1));                     // «Z вверх» на 1 мм
    assert.deepStrictEqual(fake.commands(401).map((e) => e.data), [{ Axis: 'X', Step: 10 }, { Axis: 'Z', Step: -1 }]);
    await c.home('Y');
    assert.deepStrictEqual(fake.commands(402).map((e) => e.data), [{ Axis: 'Y' }]);
    await c.setFans({ model: 100, aux: 30, box: 0 });
    await c.setLight(1);
    await c.setSpeed(50);
    await c.setTemps({ bed: 60 });
    assert.deepStrictEqual(fake.commands(403).slice(1).map((e) => e.data), [
      { TargetFanSpeed: { ModelFan: 100, AuxiliaryFan: 30, BoxFan: 0 } },
      { LightStatus: { SecondLight: 1, RgbLight: [0, 0, 0] } },
      { PrintSpeedPct: 50 },
      { TempTargetHotbed: 60 },
    ]);
    const s = await c.status();
    assert.strictEqual(s.CurrenCoord, '10.00,0.00,0.00');
    assert.deepStrictEqual(s.CurrentFanSpeed, { ModelFan: 100, AuxiliaryFan: 30, BoxFan: 0 });
    assert.strictEqual(s.LightStatus.SecondLight, 1);
    assert.strictEqual(s.TempTargetNozzle, 215);
    assert.strictEqual(s.TempTargetHotbed, 60);
    assert.strictEqual(s.PrintInfo.PrintSpeedPct, 50);
    // неверное не уходит вовсе
    const before = fake.log.length;
    await assert.rejects(c.setTemps({ nozzle: 351 }), (e) => e.code === 'bad-temp');
    await assert.rejects(c.setTemps({ bed: 111 }), (e) => e.code === 'bad-temp');
    await assert.rejects(c.setFans({ model: 101, aux: 0, box: 0 }), (e) => e.code === 'bad-fan');
    await assert.rejects(c.setLight(2), (e) => e.code === 'bad-light');
    await assert.rejects(c.move('X', 150), (e) => e.code === 'bad-step');
    assert.strictEqual(fake.log.length, before);
  } finally { c.close(); await fake.close(); }
});

test('client: axes not homed - the printer answers Ack 3, the client says not-homed', async () => {
  const fake = await startFakePrinter({ status: 0, homed: false });
  const c = await PrinterClient.connect(fake.host);
  try {
    await assert.rejects(c.move('X', 1), (e) => e.code === 'not-homed');
    await c.home('XYZ');
    await c.move('X', 1);
    assert.strictEqual((await c.status()).CurrenCoord, '1.00,0.00,0.00');
  } finally { c.close(); await fake.close(); }
});

// Сеанс главного процесса с подставным клиентом без своей защиты: проверяем именно защиту сеанса.
function stubClient(status) {
  const calls = [];
  const c = {
    closed: false, lastStatus: status, calls,
    on() {}, close() {},
    status: async () => c.lastStatus,
    move: async (axis, step) => { calls.push(['move', axis, step]); },
    home: async (axis) => { calls.push(['home', axis]); },
    setTemps: async (t) => { calls.push(['temp', t]); },
    setFans: async (f) => { calls.push(['fans', f]); },
    setLight: async (on) => { calls.push(['light', on]); },
    setSpeed: async (p) => { calls.push(['speed', p]); },
  };
  return c;
}

test('law: session refuses move/home unless the last status is idle; unknown status = busy', async () => {
  for (const st of [{ PrintInfo: { Status: 13 } }, { PrintInfo: { Status: 6 } }, { PrintInfo: { Status: 16 } }, { PrintInfo: { Status: 20 } }, null, {}, { PrintInfo: { Status: 0 }, CurrentStatus: [1] }]) {
    const stub = stubClient(st);
    const panel = new PrinterPanel({ send() {}, connect: async () => stub, aifpDir: '' });
    await panel.connect('127.0.0.1:1');
    assert.deepStrictEqual(await panel.control('move', { axis: 'X', dir: 1, size: 10 }), { ok: false, code: 'busy' }, JSON.stringify(st));
    assert.deepStrictEqual(await panel.control('home', { axis: 'XYZ' }), { ok: false, code: 'busy' });
    assert.deepStrictEqual(stub.calls, [], JSON.stringify(st));
  }
  const stub = stubClient({ PrintInfo: { Status: 9 }, CurrentStatus: [0] });
  const panel = new PrinterPanel({ send() {}, connect: async () => stub, aifpDir: '' });
  await panel.connect('127.0.0.1:1');
  assert.strictEqual((await panel.control('move', { axis: 'Z', dir: 1, size: 0.1 })).ok, true);
  assert.strictEqual((await panel.control('home', { axis: 'Z' })).ok, true);
  assert.deepStrictEqual(stub.calls, [['move', 'Z', -0.1], ['home', 'Z']]);
});

test('session: wrong values from the window never reach the client', async () => {
  const stub = stubClient({ PrintInfo: { Status: 0 } });
  const panel = new PrinterPanel({ send() {}, connect: async () => stub, aifpDir: '' });
  assert.deepStrictEqual(await panel.control('temp', { nozzle: 200 }), { ok: false, code: 'offline' });
  await panel.connect('127.0.0.1:1');
  const bad = [['move', { axis: 'E', dir: 1, size: 1 }], ['move', { axis: 'X', dir: 3, size: 1 }], ['move', { axis: 'X', dir: 1, size: 500 }], ['move', null],
    ['home', { axis: 'XY' }], ['temp', { nozzle: 351 }], ['temp', { bed: 111 }], ['temp', { nozzle: '200' }], ['temp', {}], ['temp', { nozzle: -5 }],
    ['fans', { model: 50, aux: 50 }], ['fans', { model: 50, aux: 50, box: 101 }], ['light', { on: true }], ['speed', { pct: 120 }], ['shell', {}], [42, {}]];
  for (const [kind, args] of bad) {
    const r = await panel.control(kind, args);
    assert.strictEqual(r.ok, false, JSON.stringify([kind, args]));
  }
  assert.deepStrictEqual(stub.calls, []);
  assert.strictEqual((await panel.control('temp', { nozzle: 0, bed: 0 })).ok, true);
  assert.deepStrictEqual(stub.calls, [['temp', { nozzle: 0, bed: 0 }]]);
});

test('session on the fake printer: printing - nothing moves; idle - one 401 with Z up negative', async () => {
  const fake = await startFakePrinter({ status: 13 });
  const panel = new PrinterPanel({ send() {}, aifpDir: '' });
  try {
    assert.strictEqual((await panel.connect(fake.host)).ok, true);
    assert.strictEqual((await panel.control('move', { axis: 'X', dir: 1, size: 10 })).code, 'busy');
    assert.strictEqual((await panel.control('home', { axis: 'XYZ' })).code, 'busy');
    assert.strictEqual(fake.commands(401).length + fake.commands(402).length, 0);
    fake.setStatus(0);
    await new Promise((r) => setTimeout(r, 100));
    const r = await panel.control('move', { axis: 'Z', dir: 1, size: 10 });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(fake.commands(401).map((e) => e.data), [{ Axis: 'Z', Step: -10 }]);
    assert.strictEqual((await panel.control('temp', { nozzle: 400 })).code, 'bad-temp');
    assert.strictEqual(fake.commands(403).length, 0);
  } finally { panel.disconnect(); await fake.close(); }
});

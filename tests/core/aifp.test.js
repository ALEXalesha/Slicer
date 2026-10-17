'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../../src/core/aifp');

function dir(lines, state) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-'));
  fs.mkdirSync(path.join(d, 'alerts'), { recursive: true });
  fs.writeFileSync(path.join(d, 'alerts', 'history.jsonl'), lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'));
  if (state) fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify(state));
  return d;
}

test('fresh unanswered alerts only, newest first, broken lines skipped', () => {
  const now = 2000000000;
  const d = dir([
    { id: 'old', t: now - 3600, name: 'x' },
    { id: 'answered', t: now - 10, name: 'x' }, { id: 'answered', answer_for: 'answered', answer: 'ok', t: now },
    { id: 'inline', t: now - 10, name: 'x', answer: 'pause' },
    'not json', '', '{"id": 5}',
    { id: 'a', t: now - 100, name: 'ком на сопле', score: 0.9, layer: 3, total: 10 },
    { id: 'b', t: now - 50, name: 'спагетти', score: 0.8 },
    { id: '../evil', t: now - 5, name: 'x' },
    { id: 'future', t: now + 3600, name: 'x' },
  ]);
  const got = A.readAlerts(d, { nowSec: now });
  assert.deepStrictEqual(got.map((a) => a.id), ['b', 'a']);
  assert.strictEqual(got[1].name, 'ком на сопле');
  assert.deepStrictEqual(A.readAlerts(path.join(d, 'none'), { nowSec: now }), []);
  assert.deepStrictEqual(A.readAlerts('', { nowSec: now }), []);
});

test('service state: fresh file - running; missing - not running', () => {
  const now = Date.now() / 1000;
  assert.strictEqual(A.serviceState(dir([], { state: 'watching', t: now }), now).running, true);
  assert.deepStrictEqual(A.serviceState(fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-')), now), { running: false, state: 'none', t: 0 });
});

test('default folder comes from the environment', () => {
  assert.strictEqual(A.defaultDir({ SLICER_AIFP_DIR: 'X' }), 'X');
  assert.strictEqual(A.defaultDir({ LOCALAPPDATA: 'L' }), path.join('L', 'AiForPrinter'));
  assert.strictEqual(A.defaultDir({}), '');
});

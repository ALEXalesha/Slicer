// window-state.js - общий модуль всех Electron-программ Алексея: тело должно совпадать
// с копией в Calibrate3dPrinter (она сама сверяется с калькуляторами).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ours = path.join(__dirname, '..', '..', 'electron', 'window-state.js');
const theirs = path.join(__dirname, '..', '..', '..', 'Calibrate3dPrinter', 'electron', 'window-state.js');

test('window-state.js equals the shared copy', { skip: !fs.existsSync(theirs) && 'no Calibrate3dPrinter next to this repo' }, () => {
  assert.strictEqual(fs.readFileSync(ours, 'utf8').replace(/\r\n/g, '\n'), fs.readFileSync(theirs, 'utf8').replace(/\r\n/g, '\n'));
});

test('restore keeps the window on a screen', () => {
  const WS = require(ours);
  const r = WS.restore({ x: 99999, y: 99999, width: 5000, height: 5000 }, [{ x: 0, y: 0, width: 1920, height: 1040 }],
    { width: 1280, height: 820, minWidth: 980, minHeight: 640 });
  assert.ok(r.width <= 1920 && r.height <= 1040);
  assert.strictEqual(r.x, undefined);
});

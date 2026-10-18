// Ручная проба собранной программы (dist/win-unpacked), невидимо: открыть 3MF, нарезать.
//   node tests/app/probe-packed.js
'use strict';
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('@playwright/test');
const { tmp, ROOT } = require('./helpers');
const { bambuLike } = require('../support/threemf');

(async () => {
  const exe = path.join(ROOT, 'dist', 'win-unpacked', 'Slicer CC.exe');
  const app = await electron.launch({ executablePath: exe, args: ['--user-data-dir=' + tmp('slicer-packed-')], env: Object.assign({}, process.env, { SLICER_TEST: '1' }) });
  try {
    const win = await app.firstWindow();
    const stub = () => { Element.prototype.requestPointerLock = function () {}; document.exitPointerLock = function () {}; };
    await win.addInitScript(stub);
    await win.evaluate(stub);
    await win.waitForFunction(() => window.slicerApp && window.slicerApp.ready(), null, { timeout: 60000 });
    const f = path.join(tmp('slicer-packed-m-'), 'p.3mf');
    fs.writeFileSync(f, bambuLike());
    const t0 = Date.now();
    const r = await win.evaluate((p) => window.slicer.loadModel(p), f);
    console.log('load', r.ok, r.objects && r.objects.length, Date.now() - t0, 'ms');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, f);
    await win.click('#open-models');
    await win.waitForFunction(() => window.slicerPrepare.models().length === 2, null, { timeout: 30000 });
    await win.click('#slice');
    await win.waitForSelector('#legend:not([hidden])', { timeout: 90000 });
    console.log('status:', await win.locator('#status').textContent(), '| layers:', await win.locator('#layer-label').textContent());
  } finally { await app.close(); }
})();

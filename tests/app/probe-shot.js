// Ручная проба (не тест): невидимое окно, открыть модели, нарезать, снимки в %TEMP%\slicer-probe.
//   node tests/app/probe-shot.js [ширина высота]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, tmp } = require('./helpers');
const { writeCube } = require('../support/models');

async function shot(app, win, name) {
  const dir = path.join(os.tmpdir(), 'slicer-probe');
  fs.mkdirSync(dir, { recursive: true });
  await win.waitForTimeout(300);
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.invalidate();
    await new Promise((r) => setTimeout(r, 200));
    return (await w.webContents.capturePage()).toPNG().toString('base64');
  });
  fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(png, 'base64'));
}

(async () => {
  const [w, h] = [Number(process.argv[2]) || 1280, Number(process.argv[3]) || 820];
  const { app, win } = await launch();
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]), [w, h]);
    const d = tmp('slicer-probe-m-');
    const a = writeCube(path.join(d, 'Очень_длинное_название_модели_для_проверки_обрезки_имени.stl'), 30);
    const b = writeCube(path.join(d, 'box.stl'), 20);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p }); }, [a, b]);
    await win.click('#open-models');
    await win.waitForFunction(() => window.slicerPrepare.models().length === 2, null, { timeout: 30000 });
    await shot(app, win, 'p1-models');
    await win.click('#slice');
    await win.waitForSelector('#legend:not([hidden])', { timeout: 90000 });
    await win.waitForTimeout(3000);
    console.log(await win.evaluate(() => ({ mode: window.slicerPrepare.editor.scene.mode, legend: document.querySelector('#legend').hidden, btn: document.querySelector('#show-layers').disabled, slice: document.querySelector('#slice').disabled, drawn: window.slicerPrepare.editor.scene.drawnSegments(), inView: window.slicerPrepare.editor.scene.bedInView() })));
    await shot(app, win, 'p2-layers');
    console.log('status:', await win.locator('#status').textContent());
    console.log('errors:', errors);
  } finally { await app.close(); }
})();

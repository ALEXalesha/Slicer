// Раздел «Принтер» на поддельном принтере: состояние, кнопки, камера, тревога ИИ.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launch, tmp } = require('./helpers');
const { startFakePrinter } = require('../support/fake-printer');

function aiDir({ alert = true, ageSec = 30 } = {}) {
  const dir = tmp('slicercc-aifp-');
  const now = Date.now() / 1000;
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ state: 'watching', t: now }));
  fs.mkdirSync(path.join(dir, 'alerts', 'a1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'alerts', 'a1', 'frame.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  if (alert) fs.writeFileSync(path.join(dir, 'alerts', 'history.jsonl'),
    JSON.stringify({ id: 'a1', t: now - ageSec, cls: 'blob', name: 'ком на сопле', score: 0.95, layer: 176, total: 750, answer: null }) + '\n');
  return dir;
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[p] = fs.readFileSync(p).toString('base64'); } };
  walk(dir);
  return out;
}

test('status, pause, cancel needs a yes, camera only ever enabled', async () => {
  const fake = await startFakePrinter({ status: 13 });
  const { app, win } = await launch({ env: { SLICER_AIFP_DIR: aiDir({ alert: false }) } });
  try {
    await win.click('#tab-printer');
    await win.fill('#printer-host', fake.host);
    await win.click('#printer-connect');
    await expect(win.locator('#p-state')).toHaveText('Печатает');
    await expect(win.locator('#p-layer')).toHaveText('8/22');
    await expect(win.locator('#p-nozzle')).toHaveText('27 °C');
    await expect(win.locator('#camera')).toHaveAttribute('src', /\/video$/);
    await win.click('#p-pause');
    await expect.poll(() => fake.commands(129).length).toBe(1);
    await win.click('#p-stop');
    await expect(win.locator('#confirm')).toBeVisible();
    await win.click('#confirm-no');
    await win.waitForTimeout(300);
    expect(fake.commands(130)).toHaveLength(0);
    await win.click('#tab-prepare');
    expect(await win.locator('#camera').getAttribute('src')).toBeNull();
    await win.click('#tab-printer');
    await expect(win.locator('#camera')).toHaveAttribute('src', /\/video$/);
    expect(fake.commands(386).every((e) => e.data.Enable === 1)).toBe(true);
    expect(fake.commands(386).length).toBeGreaterThanOrEqual(2);
    await expect(win.locator('#ai-state')).toHaveText('ИИ-контроль брака следит за печатью');
    // адрес запомнился
    expect((await win.evaluate(() => window.slicer.settings.get())).printerHost).toBe(fake.host);
  } finally { await app.close(); await fake.close(); }
});

test('AI alert: banner with the frame, pause goes to the printer, "all fine" hides it and writes nothing', async () => {
  const fake = await startFakePrinter({ status: 13 });
  const dir = aiDir();
  const before = snapshot(dir);
  const { app, win } = await launch({ env: { SLICER_AIFP_DIR: dir } });
  try {
    await win.click('#tab-printer');
    await win.fill('#printer-host', fake.host);
    await win.click('#printer-connect');
    await expect(win.locator('#ai-alert')).toBeVisible();
    await expect(win.locator('#ai-text')).toContainText('ком на сопле, уверенность 95 %, слой 176 из 750');
    await expect(win.locator('#ai-frame')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await win.click('#ai-pause');
    await expect.poll(() => fake.commands(129).length).toBe(1);
    await win.click('#ai-ok');
    await expect(win.locator('#ai-alert')).toBeHidden();
    await win.waitForTimeout(5500);                              // следующий опрос не возвращает плашку
    await expect(win.locator('#ai-alert')).toBeHidden();
    expect(snapshot(dir)).toEqual(before);
  } finally { await app.close(); await fake.close(); }
});

test('old alert (over 30 min) is not shown; no service means a plain note', async () => {
  const { app, win } = await launch({ env: { SLICER_AIFP_DIR: aiDir({ ageSec: 3600 }) } });
  try {
    await win.click('#tab-printer');
    await win.waitForTimeout(500);
    await expect(win.locator('#ai-alert')).toBeHidden();
  } finally { await app.close(); }
  const second = await launch({ env: { SLICER_AIFP_DIR: tmp('slicercc-noaifp-') } });
  try {
    await second.win.click('#tab-printer');
    await expect(second.win.locator('#ai-state')).toHaveText('ИИ-контроль брака (AiForPrinter) не запущен');
  } finally { await second.app.close(); }
});

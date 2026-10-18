// Раздел «Принтер» на поддельном принтере: состояние, кнопки, камера, тревога ИИ.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launch, tmp } = require('./helpers');
const { startFakePrinter } = require('../support/fake-printer');
const { findEngine } = require('../../src/core/engine-locate');
const { writeCube } = require('../support/models');
const { ROOT } = require('./helpers');

const engine = findEngine();
const FAKE_ENGINE = path.join(ROOT, 'tests', 'support', 'fake-engine.js');

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

// ---------- Управление принтером и находки ревью 18.10 ----------

const JOG = '#pc-axes button[data-jog], #pc-axes button[data-home]';

async function connectTo(win, fake) {
  await win.click('#tab-printer');
  await win.fill('#printer-host', fake.host);
  await win.click('#printer-connect');
  await expect(win.locator('#printer-conn')).toHaveText('Подключено: ' + fake.host);
}

async function allDisabled(win, sel) {
  return win.locator(sel).evaluateAll((els) => els.length > 0 && els.every((e) => e.disabled));
}

test('law: while printing jog and home are off with a reason, the main process refuses them too; temperature needs a yes', async () => {
  const fake = await startFakePrinter({ status: 13 });
  const { app, win } = await launch({ env: { SLICER_AIFP_DIR: aiDir({ alert: false }) } });
  try {
    await connectTo(win, fake);
    await expect(win.locator('#p-state')).toHaveText('Печатает');
    expect(await allDisabled(win, JOG)).toBe(true);
    await expect(win.locator('#pc-lock')).toHaveText('Во время печати оси двигать нельзя');
    // окно - чужой код: прямой вызов мимо кнопок тоже ничего не двигает
    expect(await win.evaluate(() => window.slicer.printer.control('move', { axis: 'X', dir: 1, size: 10 }))).toEqual({ ok: false, code: 'busy' });
    expect(await win.evaluate(() => window.slicer.printer.control('home', { axis: 'XYZ' }))).toEqual({ ok: false, code: 'busy' });
    for (const s of [6, 16, 20, 1]) {
      fake.setStatus(s);
      await expect.poll(() => allDisabled(win, JOG)).toBe(true);
      expect((await win.evaluate(() => window.slicer.printer.control('move', { axis: 'Z', dir: 1, size: 1 }))).code).toBe('busy');
    }
    fake.setStatus(13);
    // температура во время печати: только после «да» с предупреждением
    await win.fill('#pc-nozzle', '215');
    await win.click('#pc-nozzle-set');
    await expect(win.locator('#confirm')).toBeVisible();
    await expect(win.locator('#confirm-text')).toContainText('Идёт печать');
    await win.click('#confirm-no');
    await win.waitForTimeout(300);
    expect(fake.commands(403)).toHaveLength(0);
    await win.click('#pc-nozzle-set');
    await win.click('#confirm-yes');
    await expect.poll(() => fake.commands(403).map((e) => e.data)).toEqual([{ TempTargetNozzle: 215 }]);
    expect(fake.commands(401).length + fake.commands(402).length).toBe(0);
  } finally { await app.close(); await fake.close(); }
});

test('law: idle printer - one right request per press, Z up is negative, out-of-range never leaves, heating after a yes', async () => {
  const fake = await startFakePrinter({ status: 0 });
  const { app, win } = await launch({ env: { SLICER_AIFP_DIR: aiDir({ alert: false }) } });
  try {
    await connectTo(win, fake);
    await expect(win.locator('#pc-lock')).toHaveText('');
    expect(await win.locator(JOG).evaluateAll((els) => els.every((e) => !e.disabled))).toBe(true);
    await win.click('#pc-axes button[data-jog="X"][data-dir="1"]');                  // шаг по умолчанию 10
    await expect.poll(() => fake.commands(401).map((e) => e.data)).toEqual([{ Axis: 'X', Step: 10 }]);
    await expect(win.locator('#pc-x')).toHaveText('10.00');
    await win.click('#pc-step button[data-step="50"]');
    await win.click('#pc-axes button[data-jog="Z"][data-dir="-1"]');                 // Z вниз = +50
    await expect(win.locator('#pc-z')).toHaveText('50.00');
    await win.click('#pc-step button[data-step="1"]');
    await win.click('#pc-axes button[data-jog="Z"][data-dir="1"]');                  // Z вверх = -1
    await expect(win.locator('#pc-z')).toHaveText('49.00');
    await win.click('#pc-step button[data-step="0.1"]');
    await win.click('#pc-axes button[data-jog="Y"][data-dir="-1"]');
    await expect.poll(() => fake.commands(401).length).toBe(4);
    expect(fake.commands(401).map((e) => e.data)).toEqual([{ Axis: 'X', Step: 10 }, { Axis: 'Z', Step: 50 }, { Axis: 'Z', Step: -1 }, { Axis: 'Y', Step: -0.1 }]);
    await win.click('.pc-homes button[data-home="Z"]');
    await expect.poll(() => fake.commands(402).length).toBe(1);
    await win.click('#pc-home-all');
    await expect.poll(() => fake.commands(402).map((e) => e.data)).toEqual([{ Axis: 'Z' }, { Axis: 'XYZ' }]);
    await expect(win.locator('#pc-x')).toHaveText('0.00');

    // температура вне предела не уходит
    for (const [id, v] of [['#pc-nozzle', '351'], ['#pc-nozzle', '-5'], ['#pc-nozzle', '200.5'], ['#pc-bed', '111']]) {
      await win.fill(id, v);
      await win.click(id + '-set');
      await expect(win.locator('#pc-msg')).toContainText('целое число от 0 до');
      await expect(win.locator('#confirm')).toBeHidden();
    }
    expect(fake.commands(403)).toHaveLength(0);
    // нагрев - только после «да»
    await win.fill('#pc-nozzle', '210');
    await win.click('#pc-nozzle-set');
    await expect(win.locator('#confirm-text')).toHaveText('Нагреть сопло до 210 °C? Пока горячо, не трогайте сопло и стол руками.');
    await win.click('#confirm-no');
    await win.waitForTimeout(300);
    expect(fake.commands(403)).toHaveLength(0);
    await win.click('#pc-nozzle-set');
    await win.click('#confirm-yes');
    await expect(win.locator('#pc-nozzle-now')).toHaveText('27 / 210 °C');
    await win.fill('#pc-bed', '60');
    await win.click('#pc-bed-set');
    await win.click('#confirm-yes');
    await expect(win.locator('#pc-bed-now')).toHaveText('24 / 60 °C');
    await win.fill('#pc-nozzle', '0');                                                // выключить - без вопроса
    await win.click('#pc-nozzle-set');
    await expect(win.locator('#pc-nozzle-now')).toHaveText('27 / 0 °C');
    await expect(win.locator('#confirm')).toBeHidden();
    // вентиляторы (все три сразу) и свет
    await win.fill('#pc-fan-model', '80');
    await expect.poll(() => fake.state.fans.ModelFan).toBe(80);
    await expect(win.locator('#pc-fan-model-v')).toHaveText('80 %');
    await win.check('#pc-light');
    await expect.poll(() => fake.state.light).toBe(1);
    await win.click('#pc-speed button[data-speed="130"]');
    await expect(win.locator('#pc-speed button[data-speed="130"]')).toHaveClass(/active/);
    expect(fake.commands(403).map((e) => e.data)).toEqual([
      { TempTargetNozzle: 210 }, { TempTargetHotbed: 60 }, { TempTargetNozzle: 0 },
      { TargetFanSpeed: { ModelFan: 80, AuxiliaryFan: 0, BoxFan: 0 } },
      { LightStatus: { SecondLight: 1, RgbLight: [0, 0, 0] } },
      { PrintSpeedPct: 130 },
    ]);
  } finally { await app.close(); await fake.close(); }
});

test('law (review B4): lost connection - dashes, every button off, control block too', async () => {
  const fake = await startFakePrinter({ status: 13 });
  const { app, win } = await launch({ env: { SLICER_AIFP_DIR: aiDir({ alert: false }) } });
  try {
    await connectTo(win, fake);
    await expect(win.locator('#p-layer')).toHaveText('8/22');
    await expect(win.locator('#p-pause')).toBeEnabled();
    await fake.close();
    await expect(win.locator('#printer-conn')).toHaveText('Нет связи с принтером');
    await expect(win.locator('#p-state')).toHaveText('-');
    await expect(win.locator('#p-layer')).toHaveText('-');
    await expect(win.locator('#p-nozzle')).toHaveText('-');
    for (const id of ['#p-pause', '#p-resume', '#p-stop']) await expect(win.locator(id)).toBeDisabled();
    expect(await allDisabled(win, '#pcontrol button, #pcontrol input')).toBe(true);
    await expect(win.locator('#pc-lock')).toHaveText('Нет связи с принтером');
    await expect(win.locator('#pc-x')).toHaveText('-');
  } finally { await app.close(); await fake.close(); }
});

test('law (review B1): after a language switch the printer texts follow it', async () => {
  const fake = await startFakePrinter({ status: 13 });
  const { app, win } = await launch({ env: { SLICER_AIFP_DIR: aiDir({ alert: false }) } });
  try {
    await connectTo(win, fake);
    await expect(win.locator('#ai-state')).toHaveText('ИИ-контроль брака следит за печатью');
    await win.selectOption('#lang', 'en');
    await expect(win.locator('#printer-conn')).toHaveText('Connected: ' + fake.host);
    await expect(win.locator('#ai-state')).toHaveText('AI defect watch is watching the print');
    await expect(win.locator('#p-state')).toHaveText('Printing');
    await expect(win.locator('#pc-lock')).toHaveText('Axes cannot be moved while printing');
    expect(await win.locator('#pc-home-all').getAttribute('title')).toBe('Home: all axes');
    await win.selectOption('#lang', 'ru');
    await expect(win.locator('#printer-conn')).toHaveText('Подключено: ' + fake.host);
    await expect(win.locator('#pc-lock')).toHaveText('Во время печати оси двигать нельзя');
  } finally { await app.close(); await fake.close(); }
});

test('law (review B2): a long file name is one line with an ellipsis, full name in the tooltip, no sideways scroll', async () => {
  const fake = await startFakePrinter({ status: 13 });
  const long = 'Ochen_dlinnoe_imya_modeli_dlya_proverki_perenosa_' + 'x'.repeat(160) + '_PLA_4h20m.gcode';
  fake.state.current = '/local/' + long;
  const { app, win } = await launch({ env: { SLICER_AIFP_DIR: aiDir({ alert: false }) } });
  try {
    for (const [w, h] of [[980, 640], [1280, 820]]) {
      // Размер окна целиком (980x640 - наименьший, что разрешает программа): внутри ещё меньше.
      await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setSize(cw, ch), [w, h]);
      if (w === 980) await connectTo(win, fake);
      await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(w);
      await expect(win.locator('#p-file')).toHaveText(long);
      expect(await win.locator('#p-file').getAttribute('title')).toBe(long);
      const m = await win.evaluate(() => {
        const v = document.querySelector('#view-printer'), f = document.querySelector('#p-file');
        const cs = getComputedStyle(f);
        const right = v.getBoundingClientRect().right;
        return { vw: v.scrollWidth, vc: v.clientWidth, fw: f.scrollWidth, fc: f.clientWidth, ws: cs.whiteSpace, to: cs.textOverflow, body: document.body.scrollWidth, win: window.innerWidth,
          wide: [...v.querySelectorAll('*')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > right + 1).map((e) => e.id || e.className).slice(0, 5) };
      });
      expect(m.vw, JSON.stringify(m)).toBeLessThanOrEqual(m.vc);
      expect(m.body).toBeLessThanOrEqual(m.win);
      expect(m.wide).toEqual([]);
      expect(m.fw).toBeGreaterThan(m.fc);                    // имя обрезано, а не растянуло раздел
      expect([m.ws, m.to]).toEqual(['nowrap', 'ellipsis']);
    }
  } finally { await app.close(); await fake.close(); }
});

test('law (review V1): an address typed as a URL is cleaned, a wrong one gets a clear hint', async () => {
  const fake = await startFakePrinter({ status: 0 });
  const { app, win } = await launch({ env: { SLICER_AIFP_DIR: aiDir({ alert: false }) } });
  try {
    await win.click('#tab-printer');
    await win.fill('#printer-host', 'http://bad host/');
    await win.click('#printer-connect');
    await expect(win.locator('#printer-conn')).toHaveText('Адрес вида 192.168.0.50');
    await win.fill('#printer-host', ' http://' + fake.host + '/ ');
    await win.click('#printer-connect');
    await expect(win.locator('#printer-conn')).toHaveText('Подключено: ' + fake.host);
    await expect(win.locator('#printer-host')).toHaveValue(fake.host);
    expect((await win.evaluate(() => window.slicer.settings.get())).printerHost).toBe(fake.host);
  } finally { await app.close(); await fake.close(); }
});

test('law (review V3): AI polling stops when leaving the Printer tab and comes back with it', async () => {
  const { app, win } = await launch({ env: { SLICER_AIFP_DIR: aiDir({ alert: false }) } });
  try {
    expect(await win.evaluate(() => window.slicerPrinter.aiTimer())).toBe(false);
    await win.click('#tab-printer');
    await expect.poll(() => win.evaluate(() => window.slicerPrinter.aiPolls())).toBeGreaterThanOrEqual(1);
    expect(await win.evaluate(() => window.slicerPrinter.aiTimer())).toBe(true);
    await win.click('#tab-prepare');
    expect(await win.evaluate(() => window.slicerPrinter.aiTimer())).toBe(false);
    const n = await win.evaluate(() => window.slicerPrinter.aiPolls());
    await win.waitForTimeout(16000);                         // дольше обоих старых таймеров (5 и 15 с)
    expect(await win.evaluate(() => window.slicerPrinter.aiPolls())).toBe(n);
    await win.click('#tab-printer');
    await expect.poll(() => win.evaluate(() => window.slicerPrinter.aiPolls())).toBe(n + 1);
  } finally { await app.close(); }
});

// Ревью 18.10 (В2): «Печать» без адреса уходила на первый ответивший принтер. Теперь - вопрос.
test('law (review V2): print without an address asks "print on <name> (<IP>)?"; no - nothing sent, yes - prints and remembers', async () => {
  test.skip(!engine, 'needs the real profiles');
  const fake = await startFakePrinter({ announcePort: true });
  const env = { SLICER_ENGINE: FAKE_ENGINE, SLICER_PROFILES: engine.profilesDir, FAKE_ENGINE: 'ok', SLICER_DISCOVER_PORT: String(fake.udpPort), SLICER_AIFP_DIR: aiDir({ alert: false }) };
  const { app, win } = await launch({ env });
  try {
    expect((await win.evaluate(() => window.slicer.settings.get())).printerHost).toBe('');
    const dir = tmp('slicercc-models-');
    const file = writeCube(path.join(dir, 'cube.stl'), 20);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, file);
    await win.click('#open-models');
    await win.click('#slice');
    await expect(win.locator('#print')).toBeEnabled();
    await win.click('#print');
    await expect(win.locator('#confirm-text')).toHaveText(`Адрес принтера не задан. Печатать на Fake CC (${fake.host})?`);
    await win.click('#confirm-no');
    await expect(win.locator('#status')).toContainText('принтер не выбран');
    expect(fake.log.filter((e) => e.http)).toEqual([]);
    expect(fake.commands(128)).toHaveLength(0);
    expect((await win.evaluate(() => window.slicer.settings.get())).printerHost).toBe('');
    await win.click('#print');
    await win.click('#confirm-yes');
    await expect(win.locator('#status')).toContainText('Печать началась', { timeout: 30000 });
    expect(fake.commands(128)).toHaveLength(1);
    expect((await win.evaluate(() => window.slicer.settings.get())).printerHost).toBe(fake.host);
  } finally { await app.close(); await fake.close(); }
});

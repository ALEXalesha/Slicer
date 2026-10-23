// Законы по свежему обзору 0.2 (23.10): находки А и Б. Окно невидимо (SLICER_TEST=1),
// диалоги подменены, принтер - только поддельный.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launch, tmp, ROOT } = require('./helpers');
const { findEngine } = require('../../src/core/engine-locate');
const { startFakePrinter } = require('../support/fake-printer');
const { teeStl } = require('../support/models');

const engine = findEngine();
const FAKE_ENGINE = path.join(ROOT, 'tests', 'support', 'fake-engine.js');
const fake = (mode = 'ok') => ({ SLICER_ENGINE: FAKE_ENGINE, FAKE_ENGINE: mode, SLICER_PROFILES: engine ? engine.profilesDir : '' });

async function open(app, win, files) {
  const before = await win.evaluate(() => window.slicerPrepare.models().length);
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p }); }, files);
  await win.click('#open-models');
  await win.waitForFunction((n) => window.slicerPrepare.models().length > n, before, { timeout: 60000 });
}

function tee(dir, name) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, teeStl());
  return f;
}

// Наименьший зазор между прямоугольниками моделей на столе (мм).
const minGap = (win) => win.evaluate(() => {
  const e = window.slicerPrepare.editor;
  const b = e.items.map((i) => e.box(i));
  let g = Infinity;
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
    const dx = Math.max(b[j].min.x - b[i].max.x, b[i].min.x - b[j].max.x);
    const dy = Math.max(b[j].min.y - b[i].max.y, b[i].min.y - b[j].max.y);
    g = Math.min(g, Math.max(dx, dy));
  }
  return g;
});

async function size(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setContentSize(s[0], s[1]), [w, h]);
  await win.waitForTimeout(400);
}

// А1: Benchy и tee в 6 мм друг от друга с поддержками - движок отказывал («gcode path conflicts»),
// а окно говорило «модель больше стола или испорчена».
test('review-02 A1: engine path conflict names both models and points to Arrange, not "bigger than the bed"', async () => {
  test.skip(!engine, 'needs the real profiles');
  const d = tmp('slicercc-m-');
  const { app, win } = await launch({ env: fake('conflict') });
  try {
    await open(app, win, [tee(d, 'Лодка.stl')]);
    await open(app, win, [tee(d, 'tee.stl')]);
    await win.click('#slice');
    const st = win.locator('#status');
    await expect(st).toHaveClass(/error/, { timeout: 60000 });
    await expect(st).toContainText('Лодка.stl');
    await expect(st).toContainText('tee.stl');
    await expect(st).toContainText('Разложить');
    await expect(st).not.toContainText('256x256x256');
    await expect(win.locator('#print')).toBeDisabled();
  } finally { await app.close(); }
});

test('review-02 A1: with supports a new model and Arrange keep 12 mm between models, without - 6 mm', async () => {
  const d = tmp('slicercc-m-');
  const { app, win } = await launch();
  try {
    await win.click('#supports [data-value="plate"]');
    await open(app, win, [tee(d, 'a.stl')]);
    await open(app, win, [tee(d, 'b.stl')]);
    expect(await minGap(win)).toBeGreaterThanOrEqual(12 - 0.01);
    await win.click('#toolbar button[data-act="copy"]');
    expect(await minGap(win)).toBeGreaterThanOrEqual(12 - 0.01);
    await win.click('#toolbar button[data-act="arrange"]');
    expect(await minGap(win)).toBeGreaterThanOrEqual(12 - 0.01);
    await win.click('#supports [data-value="none"]');
    await win.click('#toolbar button[data-act="arrange"]');
    const g = await minGap(win);
    expect(g).toBeGreaterThanOrEqual(6 - 0.01);
    expect(g).toBeLessThan(12);
  } finally { await app.close(); }
});

test('review-02 A1: real engine - two models opened one after another with supports slice', async () => {
  test.skip(!engine, 'ElegooSlicer not installed');
  const d = tmp('slicercc-m-');
  const { app, win } = await launch();
  try {
    await win.click('#supports [data-value="everywhere"]');
    await open(app, win, [tee(d, 'a.stl')]);
    await open(app, win, [tee(d, 'b.stl')]);
    await win.click('#slice');
    await expect(win.locator('#print')).toBeEnabled({ timeout: 180000 });
  } finally { await app.close(); }
});

// Б1: «Все модели на столе.» зелёным оставалось после того, как модель ушла за стол.
test('review-02 B1: a plate status does not outlive the next change of the plate', async () => {
  const d = tmp('slicercc-m-');
  const { app, win } = await launch();
  try {
    await open(app, win, [tee(d, 'a.stl')]);
    await win.click('#toolbar button[data-act="arrange"]');
    await expect(win.locator('#status')).toHaveText('Все модели на столе.');
    await win.click('#toolbar button[data-tool="scale"]');
    const scale = win.locator('#tool-panel input[data-kind="scl"]').first();
    await scale.fill('4000');
    await scale.press('Enter');
    await expect(win.locator('#models .chip.off')).toHaveCount(1);
    await expect(win.locator('#status')).not.toHaveText('Все модели на столе.');
  } finally { await app.close(); }
});

// Б2: на 1280 три карточки управления занимали 3/4 ширины - пустая строка сообщений была
// четвёртой колонкой сетки.
test('review-02 B2: printer control cards share the whole row; the message line is its own row', async () => {
  const { app, win } = await launch();
  try {
    await size(app, win, 1280, 800);
    await win.click('#tab-printer');
    const r = await win.evaluate(() => {
      const box = document.querySelector('#pcontrol').getBoundingClientRect();
      const cards = [...document.querySelectorAll('#pcontrol .pc-card')].map((c) => c.getBoundingClientRect());
      const msg = document.querySelector('#pc-msg').getBoundingClientRect();
      return { right: box.right, last: Math.max(...cards.map((c) => c.right)), top: cards[0].top, sameRow: cards.every((c) => Math.abs(c.top - cards[0].top) < 1), msgLeft: msg.left, boxLeft: box.left, msgTop: msg.top, cardsBottom: Math.max(...cards.map((c) => c.bottom)) };
    });
    expect(r.sameRow).toBe(true);
    expect(Math.abs(r.right - r.last)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.msgLeft - r.boxLeft)).toBeLessThanOrEqual(1);
    expect(r.msgTop).toBeGreaterThanOrEqual(r.cardsBottom - 1);
  } finally { await app.close(); }
});

// Б3: камера не ответила - был пустой чёрный прямоугольник без слов.
test('review-02 B3: a camera that does not answer says so instead of a black box', async () => {
  const fp = await startFakePrinter({ status: 0, faults: { noVideo: true } });
  const { app, win } = await launch();
  try {
    await win.click('#tab-printer');
    await win.fill('#printer-host', fp.host);
    await win.click('#printer-connect');
    await expect(win.locator('#camera')).toHaveAttribute('src', /\/video$/);
    await expect(win.locator('#camera-hint')).toBeVisible();
    await expect(win.locator('#camera-hint')).toHaveText('Камера не отвечает. Проверьте, что её не держит другая программа.');
    await win.selectOption('#lang', 'en');
    await expect(win.locator('#camera-hint')).toHaveText('The camera does not answer. Check that no other program holds it.');
  } finally { await app.close(); await fp.close(); }
});

// Б4: светлая тема - панели поверх стола полупрозрачные (сетка сквозь текст), зелёный статус
// на белом почти не читается.
test('review-02 B4: light theme - panels over the bed are solid enough, the ok status is readable', async () => {
  const d = tmp('slicercc-m-');
  const { app, win } = await launch({ env: fake() });
  try {
    await win.selectOption('#theme', 'light');
    await open(app, win, [tee(d, 'a.stl')]);
    const alpha = (sel) => win.evaluate((sel) => {
      const c = getComputedStyle(document.querySelector(sel)).backgroundColor;
      const m = /rgba?\(([^)]+)\)/.exec(c);
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return p.length > 3 ? p[3] : 1;
    }, sel);
    expect(await alpha('#tool-panel')).toBeGreaterThanOrEqual(0.85);
    expect(await alpha('#toolbar')).toBeGreaterThanOrEqual(0.85);
    await win.click('#slice');
    await expect(win.locator('#status')).toHaveClass(/ok/, { timeout: 60000 });
    expect(await alpha('#legend')).toBeGreaterThanOrEqual(0.85);
    const contrast = await win.evaluate(() => {
      const rgb = (s) => /rgba?\(([^)]+)\)/.exec(s)[1].split(/[ ,/]+/).filter(Boolean).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const fg = lum(rgb(getComputedStyle(document.querySelector('#status')).color));
      const bg = lum([232, 236, 243]);                       // --app-base светлой темы
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  } finally { await app.close(); }
});

// Б5: легенда слоёв тянулась на всю высоту сцены с пустым низом.
test('review-02 B5: the layer legend is as tall as its rows, not the whole stage', async () => {
  const d = tmp('slicercc-m-');
  const { app, win } = await launch({ env: fake() });
  try {
    await size(app, win, 1280, 800);
    await open(app, win, [tee(d, 'a.stl')]);
    await win.click('#slice');
    await expect(win.locator('#legend')).toBeVisible({ timeout: 60000 });
    const r = await win.evaluate(() => {
      const lg = document.querySelector('#legend');
      const last = [...lg.querySelectorAll('.lg-row')].pop().getBoundingClientRect();
      return { empty: lg.getBoundingClientRect().bottom - last.bottom, scroll: lg.scrollHeight > lg.clientHeight + 1 };
    });
    expect(r.scroll).toBe(false);
    expect(r.empty).toBeLessThanOrEqual(16);
  } finally { await app.close(); }
});

// Б6: «Высота срез…» обрезано, «Добавить копии» и «Where needed» в две строки.
test('review-02 B6: tool panel labels are not cut and buttons stay one line, ru and en, 980 and 1280', async () => {
  const d = tmp('slicercc-m-');
  const { app, win } = await launch();
  try {
    await open(app, win, [tee(d, 'a.stl')]);
    const bad = [];
    for (const [w, h] of [[980, 640], [1280, 800]]) {
      await size(app, win, w, h);
      for (const lang of ['ru', 'en']) {
        await win.selectOption('#lang', lang);
        for (const tool of ['move', 'rotate', 'scale', 'face', 'cut', 'paint']) {
          await win.click(`#toolbar [data-tool="${tool}"]`);
          bad.push(...await win.evaluate((where) => {
            const out = [];
            // Б7: ползунок разреза шире панели на 4 px - под кнопкой «Разрезать» была полоса прокрутки.
            const p = document.querySelector('#tool-panel');
            if (p.scrollWidth > p.clientWidth) out.push(where + ' panel scrolls sideways');
            for (const el of document.querySelectorAll('#tool-panel *, #novice button')) {
              if (!el.offsetParent || el.classList.contains('tp-name')) continue;
              const cs = getComputedStyle(el);
              const txt = (el.textContent || '').trim();
              if (!txt) continue;
              if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(where + ' cut: ' + txt);
              if (el.tagName === 'BUTTON' && !el.children.length) {
                const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25;
                if (el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) > lh * 1.6) out.push(where + ' two lines: ' + txt);
              }
            }
            return out;
          }, `${w} ${lang} ${tool}`));
        }
      }
    }
    expect(bad).toEqual([]);
  } finally { await app.close(); }
});

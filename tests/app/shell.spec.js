const { test, expect } = require('@playwright/test');
const { launch } = require('./helpers');

test('test window is invisible, unfocusable and off screen', async () => {
  const { app, win } = await launch();
  try {
    const st = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { visible: w.isVisible(), focusable: w.isFocusable(), bounds: w.getBounds() };
    });
    expect(st.visible).toBe(false);
    expect(st.focusable).toBe(false);
    expect(st.bounds.x).toBeLessThan(-10000);
    expect(await win.evaluate(() => typeof require)).toBe('undefined');
    await win.evaluate(() => document.body.requestPointerLock());
    expect(await win.evaluate(() => window.__pl)).toBe(1);          // сработала заглушка, не родная функция
    expect(await win.evaluate(() => document.pointerLockElement)).toBeNull();
  } finally {
    await app.close();
  }
});

test('language and theme switch', async () => {
  const { app, win } = await launch();
  try {
    await expect(win.locator('#tab-printer')).toHaveText('Принтер');
    await win.selectOption('#lang', 'en');
    await expect(win.locator('#tab-printer')).toHaveText('Printer');
    await win.selectOption('#theme', 'light');
    expect(await win.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
    const errors = [];
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.click('#tab-printer');
    await expect(win.locator('#view-printer')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

// Закон после ошибки 17.10: пустой статус (null) ронял панель принтера целиком -
// Number(null) === 0, и разбор шёл в null.TempOfNozzle. Любой статус - без исключения.
test('law: describeStatus survives any status, no page errors on any tab', async () => {
  const { app, win } = await launch();
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  try {
    const bad = await win.evaluate(() => {
      const samples = [null, undefined, {}, [], 0, '', 'x', { PrintInfo: null }, { PrintInfo: { Status: '13', CurrentLayer: null, TotalLayer: 0 } },
        { TempOfNozzle: null, TempOfHotbed: 'hot' }, { PrintInfo: { Status: 13, CurrentTicks: 'a', TotalTicks: 5, Progress: 900 } }];
      for (let i = 0; i < 300; i++) {
        const r = () => [null, undefined, 0, -1, 13, 6, 'x', '', 1e9, NaN, {}, []][Math.floor(Math.random() * 12)];
        samples.push({ PrintInfo: { Status: r(), CurrentLayer: r(), TotalLayer: r(), CurrentTicks: r(), TotalTicks: r(), Progress: r(), Filename: r() }, TempOfNozzle: r(), TempOfHotbed: r() });
      }
      const out = [];
      for (const s of samples) {
        try {
          const d = window.slicerPrinter.describeStatus(s);
          if (typeof d.state !== 'string' || !(d.pct >= 0 && d.pct <= 100)) out.push(JSON.stringify(s));
        } catch (e) { out.push(String(e) + ' ' + JSON.stringify(s)); }
      }
      return out;
    });
    expect(bad).toEqual([]);
    for (const tab of ['#tab-printer', '#tab-prepare']) await win.click(tab);
    await win.click('#mode button[data-mode="advanced"]');
    await win.click('#mode button[data-mode="novice"]');
    await win.waitForTimeout(300);
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

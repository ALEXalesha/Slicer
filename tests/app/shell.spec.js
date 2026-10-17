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

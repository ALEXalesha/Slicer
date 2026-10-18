// «Новичок» в настоящем окне: три решения, нарезка настоящим движком, экспорт, печать на
// поддельный принтер. Окно невидимо (SLICER_TEST=1), диалоги подменены.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launch, tmp, ROOT } = require('./helpers');
const { findEngine } = require('../../src/core/engine-locate');
const { writeCube } = require('../support/models');
const { startFakePrinter } = require('../support/fake-printer');

const engine = findEngine();
const FAKE_ENGINE = path.join(ROOT, 'tests', 'support', 'fake-engine.js');

async function openCube(app, win, name = 'Кубик.stl', size = 20) {
  const dir = tmp('slicercc-models-');
  const file = writeCube(path.join(dir, name), size);
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, file);
  await win.click('#open-models');
  await expect(win.locator('#models .chip')).toHaveCount(1);
  return file;
}

test('novice screen shows exactly three decisions', async () => {
  const { app, win } = await launch();
  try {
    await expect(win.locator('#novice [data-novice-item]')).toHaveCount(3);
    expect(await win.locator('#novice [data-novice-item]').evaluateAll((els) => els.map((e) => e.dataset.noviceItem))).toEqual(['filament', 'temperature', 'supports']);
    // и ничего больше, что можно нажать, кроме этих трёх карточек
    const controls = await win.locator('#novice').locator('button, input, select').evaluateAll((els) => els.map((e) => e.closest('[data-novice-item]') ? 1 : 0));
    expect(controls.every((x) => x === 1)).toBe(true);
    await expect(win.locator('#filament button')).toHaveCount(5);
  } finally { await app.close(); }
});

test('temperature slider shows the real nozzle temperature', async () => {
  test.skip(!engine, 'ElegooSlicer not installed');
  const { app, win } = await launch();
  try {
    await win.click('#filament button[data-value="petg"]');
    await win.locator('#temp').fill('7');
    await expect(win.locator('#temp-value')).toHaveText('+7 °C');
    await expect(win.locator('#temp-hint')).toContainText('257');
    await win.locator('#temp').fill('-15');
    await expect(win.locator('#temp-hint')).toContainText('235');
  } finally { await app.close(); }
});

test('open, slice with the real engine, export to disk', async () => {
  test.skip(!engine, 'ElegooSlicer not installed');
  const out = tmp('slicercc-out-');
  const { app, win } = await launch();
  try {
    await openCube(app, win);
    await expect(win.locator('#print')).toBeDisabled();
    await win.click('#supports button[data-value="plate"]');
    await win.click('#slice');
    await expect(win.locator('#result')).toBeVisible({ timeout: 60000 });
    await expect(win.locator('#res-layers')).toHaveText('100 слоёв');
    await expect(win.locator('#status')).toHaveText('Kubik_PLA_' + (await win.locator('#status').textContent()).split('_PLA_')[1]);
    const file = path.join(out, 'cube.gcode');
    await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);
    await win.click('#export');
    await expect(win.locator('#status')).toContainText('cube.gcode');
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toMatch(/; enable_support = 1/);
    expect(text).toMatch(/; support_on_build_plate_only = 1/);
    // любая смена выбора делает старую нарезку недействительной
    await win.click('#supports button[data-value="none"]');
    await expect(win.locator('#print')).toBeDisabled();
    await expect(win.locator('#export')).toBeDisabled();
  } finally { await app.close(); }
});

test('engine failure gives a human message, not a code', async () => {
  test.skip(!engine, 'needs the real profiles');
  const { app, win } = await launch({ env: { SLICER_ENGINE: FAKE_ENGINE, SLICER_PROFILES: engine.profilesDir, FAKE_ENGINE: 'fail' } });
  try {
    await openCube(app, win);
    await win.click('#slice');
    await expect(win.locator('#status')).toContainText('256x256x256');
    await expect(win.locator('#status')).toHaveClass(/error/);
  } finally { await app.close(); }
});

test('print to the fake printer: steps up to started; hidden file gives a clear message', async () => {
  test.setTimeout(300000);
  test.skip(!engine, 'needs the real profiles');
  const env = { SLICER_ENGINE: FAKE_ENGINE, SLICER_PROFILES: engine.profilesDir, FAKE_ENGINE: 'ok' };
  const fake = await startFakePrinter();
  const { app, win } = await launch({ env });
  try {
    await win.evaluate((h) => window.slicer.settings.set({ printerHost: h }), fake.host);
    await openCube(app, win);
    await win.click('#slice');
    await expect(win.locator('#print')).toBeEnabled();
    await win.click('#print');
    await expect(win.locator('#status')).toContainText('Печать началась', { timeout: 30000 });
    await expect(win.locator('#send-steps li.done')).toHaveCount(6);
    // шаги переводятся при смене языка (ревьювер Б1) и уходят, когда нарезка устарела (Б5)
    await win.selectOption('#lang', 'en');
    await expect(win.locator('#send-steps li').first()).toHaveText('Connecting to the printer');
    await win.selectOption('#lang', 'ru');
    await win.click('#supports button[data-value="plate"]');
    await expect(win.locator('#send-steps')).toBeHidden();
    expect(fake.commands(128)).toHaveLength(1);
    expect([...fake.state.files.keys()][0]).toMatch(/^\/local\/Kubik_PLA_\d+m\.gcode$/);
  } finally { await app.close(); await fake.close(); }

  const hidden = await startFakePrinter({ faults: { hideFile: true } });
  const second = await launch({ env });
  try {
    await second.win.evaluate((h) => window.slicer.settings.set({ printerHost: h }), hidden.host);
    await openCube(second.app, second.win);
    await second.win.click('#slice');
    await expect(second.win.locator('#print')).toBeEnabled();
    await second.win.click('#print');
    await expect(second.win.locator('#status')).toContainText('принтер его не видит', { timeout: 120000 });
    expect(hidden.commands(128)).toHaveLength(0);
  } finally { await second.app.close(); await hidden.close(); }
});

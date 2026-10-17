// «Продвинутый»: поиск, правка, качество и пластина попадают в G-code; в «Новичке» - нет.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launch, tmp } = require('./helpers');
const { findEngine } = require('../../src/core/engine-locate');
const { writeCube } = require('../support/models');

const engine = findEngine();

async function sliceAndRead(app, win, out, name) {
  await win.click('#slice');
  await expect(win.locator('#export')).toBeEnabled({ timeout: 60000 });
  const file = path.join(out, name);
  await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);
  await win.click('#export');
  await expect(win.locator('#status')).toContainText(name);
  return fs.readFileSync(file, 'utf8');
}

test('advanced edits, quality and plate reach the G-code; novice ignores them', async () => {
  test.skip(!engine, 'ElegooSlicer not installed');
  const out = tmp('slicercc-adv-');
  const { app, win } = await launch();
  try {
    const cube = writeCube(path.join(tmp('slicercc-m-'), 'c.stl'), 20);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, cube);
    await win.click('#open-models');
    await win.click('#mode button[data-mode="advanced"]');
    await expect(win.locator('#adv-list .adv-item').first()).toBeVisible();
    await win.fill('#adv-search', 'периметр');
    await expect(win.locator('#adv-list .adv-item')).toHaveCount(1);
    const input = win.locator('[data-key="process.wall_loops"] input');
    await input.fill('5');
    await input.press('Enter');
    await input.blur();
    await expect(win.locator('[data-key="process.wall_loops"]')).toHaveClass(/changed/);
    await win.selectOption('#adv-quality', '0.12mm Fine @Elegoo CC 0.4 nozzle');
    await win.selectOption('#adv-plate', 'High Temp Plate');
    await win.click('#adv-kind button[data-kind="changed"]');
    await expect(win.locator('#adv-list .adv-item')).toHaveCount(1);
    const adv = await sliceAndRead(app, win, out, 'adv.gcode');
    expect(adv).toMatch(/^; wall_loops = 5$/m);
    expect(adv).toMatch(/^; layer_height = 0\.12$/m);
    expect(adv).toMatch(/^;curr_bed_type:High Temp Plate$/m);

    await win.click('#mode button[data-mode="novice"]');
    const nov = await sliceAndRead(app, win, out, 'nov.gcode');
    expect(nov).not.toMatch(/^; wall_loops = 5$/m);
    expect(nov).toMatch(/^; layer_height = 0\.2$/m);
    expect(nov).toMatch(/^;curr_bed_type:Textured PEI Plate$/m);

    await win.click('#mode button[data-mode="advanced"]');
    await win.click('#adv-reset');
    await expect(win.locator('#adv-list p.hint')).toHaveText('Ничего не изменено');
  } finally { await app.close(); }
});

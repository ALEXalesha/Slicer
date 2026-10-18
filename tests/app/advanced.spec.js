// «Продвинутый»: разделы, подписи и описания, проверка ввода, правки по филаменту; правка,
// качество и пластина попадают в G-code; в «Новичке» - нет.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launch, tmp, ROOT } = require('./helpers');
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

async function openCube(app, win) {
  const cube = writeCube(path.join(tmp('slicercc-m-'), 'c.stl'), 20);
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, cube);
  await win.click('#open-models');
}

const settings = (win) => win.evaluate(() => window.slicer.settings.get());

test('advanced edits, quality and plate reach the G-code; novice ignores them', async () => {
  test.skip(!engine, 'ElegooSlicer not installed');
  const out = tmp('slicercc-adv-');
  const { app, win } = await launch();
  try {
    await openCube(app, win);
    await win.click('#mode button[data-mode="advanced"]');
    await expect(win.locator('#adv-list .adv-item').first()).toBeVisible();
    await win.fill('#adv-search', 'wall_loops');
    await expect(win.locator('#adv-list .adv-item')).toHaveCount(1);
    const input = win.locator('[data-key="process.wall_loops"] input');
    await input.fill('5');
    await input.press('Enter');
    await input.blur();
    await expect(win.locator('[data-key="process.wall_loops"]')).toHaveClass(/changed/);
    await win.selectOption('#adv-quality', '0.12mm Fine @Elegoo CC 0.4 nozzle');
    await win.selectOption('#adv-plate', 'High Temp Plate');
    await win.fill('#adv-search', '');
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

test('sections, labels and descriptions; search by label, description and key; language switch', async () => {
  test.skip(!engine, 'ElegooSlicer not installed');
  const { app, win } = await launch();
  try {
    const errors = [];
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.click('#mode button[data-mode="advanced"]');
    const heads = win.locator('#adv-list .adv-sec-head');
    await expect(heads.first()).toContainText('Качество и слои');
    expect(await heads.count()).toBeGreaterThanOrEqual(12);
    const titles = await win.locator('#adv-list .adv-sec-title').allTextContents();
    for (const want of ['Стенки', 'Заполнение', 'Скорость', 'Температуры и стол', 'Охлаждение', 'Поддержки']) expect(titles).toContain(want);
    // Раскрыт только первый раздел; щелчок раскрывает другой.
    await expect(win.locator('.adv-sec[data-section="quality"] .adv-item').first()).toBeVisible();
    await expect(win.locator('.adv-sec[data-section="walls"] .adv-item')).toHaveCount(0);
    await win.click('.adv-sec[data-section="walls"] .adv-sec-head');
    await expect(win.locator('[data-key="process.wall_loops"] .adv-label')).toHaveText('Число периметров (стенок)');
    // Подпись, имя движка мелко, описание видно без наведения; полное - в title.
    const lh = win.locator('[data-key="process.layer_height"]');
    await expect(lh.locator('.adv-label')).toHaveText('Высота слоя, мм');
    await expect(lh.locator('.adv-key')).toHaveText('layer_height');
    await expect(lh.locator('.adv-desc')).toBeVisible();
    await expect(lh.locator('.adv-desc')).toHaveAttribute('title', /ступеньки/);
    await lh.locator('.adv-help').click();
    await expect(lh).toHaveClass(/open/);
    // Описание раскрытой строки не вылезает за край панели.
    const fits = await win.evaluate(() => {
      const d = document.querySelector('[data-key="process.layer_height"] .adv-desc');
      const p = document.querySelector('#advanced');
      return d.getBoundingClientRect().right <= p.getBoundingClientRect().right + 1 && d.scrollWidth <= d.clientWidth + 1;
    });
    expect(fits).toBe(true);
    // Поиск: по подписи, по описанию, по ключу.
    await win.fill('#adv-search', 'число периметров');
    await expect(win.locator('[data-key="process.wall_loops"]')).toBeVisible();
    await win.fill('#adv-search', 'ступеньки');
    await expect(win.locator('[data-key="process.layer_height"]')).toBeVisible();
    await win.fill('#adv-search', 'sparse_infill_pattern');
    await expect(win.locator('#adv-list .adv-item')).toHaveCount(1);
    // Перечисление - выпадающий список с подписями, 0/1 - переключатель.
    const pat = win.locator('[data-key="process.sparse_infill_pattern"] select');
    await expect(pat.locator('option[value="gyroid"]')).toHaveText('Гироид');
    await win.fill('#adv-search', 'enable_support');
    await expect(win.locator('[data-key="process.enable_support"] input[role="switch"]')).toHaveCount(1);
    // Язык: подписи, разделы и описания переводятся.
    await win.fill('#adv-search', '');
    await win.selectOption('#lang', 'en');
    await expect(heads.first()).toContainText('Quality and layers');
    await expect(lh.locator('.adv-label')).toHaveText('Layer height, mm');
    await expect(lh.locator('.adv-desc')).toContainText('Thickness of one layer');
    await expect(win.locator('#adv-fil-hint')).toContainText('Now: PLA');
    await win.selectOption('#lang', 'ru');
    await expect(lh.locator('.adv-label')).toHaveText('Высота слоя, мм');
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('А4: a wrong value is flagged while typing and never stored; comma means a dot', async () => {
  test.skip(!engine, 'ElegooSlicer not installed');
  const { app, win } = await launch();
  try {
    await win.click('#mode button[data-mode="advanced"]');
    const row = win.locator('[data-key="process.layer_height"]');
    const input = row.locator('input');
    await input.fill('abc');
    await expect(row).toHaveClass(/bad/);
    await expect(row.locator('.adv-err')).toHaveText('Нужно число от 0.04 до 0.32 мм');
    await input.press('Enter');
    await input.blur();
    expect((await settings(win)).advanced.process).toEqual({});
    await input.fill('5');
    await expect(row.locator('.adv-err')).toHaveText('Нужно число от 0.04 до 0.32 мм');
    await input.press('Enter');
    expect((await settings(win)).advanced.process).toEqual({});
    // Язык меняется - и текст ошибки тоже.
    await win.selectOption('#lang', 'en');
    await expect(win.locator('[data-key="process.layer_height"] .adv-err')).toHaveText('Needs a number from 0.04 to 0.32 mm');
    await win.selectOption('#lang', 'ru');
    const input2 = win.locator('[data-key="process.layer_height"] input');
    await input2.fill('0,16');
    await expect(win.locator('[data-key="process.layer_height"]')).not.toHaveClass(/bad/);
    await input2.press('Enter');
    await expect(win.locator('[data-key="process.layer_height"]')).toHaveClass(/changed/);
    await expect(win.locator('[data-key="process.layer_height"] input')).toHaveValue('0.16');
    expect((await settings(win)).advanced.process).toEqual({ layer_height: '0.16' });
    // В обход окна неверное тоже не записать: настройки проверяет ядро.
    await win.evaluate(() => window.slicer.settings.set({ advanced: { process: { layer_height: 'abc', wall_loops: '4' }, filament: {} } }));
    expect((await settings(win)).advanced.process).toEqual({ wall_loops: '4' });
  } finally { await app.close(); }
});

test('А3: filament edits are kept per filament; nozzle 215 of PETG does not reach PLA', async () => {
  test.skip(!engine, 'ElegooSlicer not installed');
  const out = tmp('slicercc-adv-fil-');
  const { app, win } = await launch();
  try {
    await openCube(app, win);
    await win.click('#mode button[data-mode="advanced"]');
    await expect(win.locator('#adv-filament button.active')).toHaveText('PLA');
    await win.click('#adv-filament button[data-value="petg"]');
    await expect(win.locator('#adv-filament button.active')).toHaveText('PETG');
    await expect(win.locator('#filament button.active')).toHaveText('PETG');           // выбор общий с «Новичком»
    expect((await settings(win)).choice.filament).toBe('petg');
    await win.fill('#adv-search', 'nozzle_temperature');
    const nozzle = win.locator('[data-key="filament.nozzle_temperature"] input');
    await expect(nozzle).toHaveValue('250');
    await nozzle.fill('215');
    await nozzle.press('Enter');
    await expect(win.locator('[data-key="filament.nozzle_temperature"]')).toHaveClass(/changed/);
    expect((await settings(win)).advanced.filament).toEqual({ petg: { nozzle_temperature: '215' } });

    await win.click('#adv-filament button[data-value="pla"]');
    await expect(win.locator('#adv-filament button.active')).toHaveText('PLA');
    await expect(win.locator('[data-key="filament.nozzle_temperature"] input')).toHaveValue('210');
    await expect(win.locator('[data-key="filament.nozzle_temperature"]')).not.toHaveClass(/changed/);
    const pla = await sliceAndRead(app, win, out, 'pla.gcode');
    expect(pla).toMatch(/^; nozzle_temperature = 210$/m);
    await win.click('#adv-kind button[data-kind="changed"]');
    await expect(win.locator('#adv-list .adv-others')).toContainText('PETG (1)');

    await win.click('#adv-filament button[data-value="petg"]');
    const petg = await sliceAndRead(app, win, out, 'petg.gcode');
    expect(petg).toMatch(/^; nozzle_temperature = 215$/m);
  } finally { await app.close(); }
});

test('А4: the engine refuses a setting - the status names it, not "model larger than the bed"', async () => {
  test.skip(!engine, 'ElegooSlicer not installed');
  const { app, win } = await launch({ env: {
    SLICER_ENGINE: path.join(ROOT, 'tests', 'support', 'fake-engine.js'),
    SLICER_PROFILES: engine.profilesDir, FAKE_ENGINE: 'bad-setting', FAKE_BAD_KEY: 'layer_height',
  } });
  try {
    await openCube(app, win);
    await win.click('#mode button[data-mode="advanced"]');
    // Строку состояния пишет prepare.js (код bad-setting добавит координатор при слиянии):
    // проверяем ответ нарезки и текст, который из него получится.
    const res = await win.evaluate(async () => {
      const { t } = await import('./i18n.js');
      const paths = await window.slicer.openModels();
      const r = await window.slicer.slice({ models: paths.map((p) => ({ path: p, name: 'c.stl' })), mode: 'advanced', choice: window.slicerPrepare.choice() });
      return { r, text: t('eng.bad-setting', { why: r.detail }) };
    });
    expect(res.r.ok).toBe(false);
    expect(res.r.code).toBe('bad-setting');
    expect(res.r.key).toBe('layer_height');
    expect(res.r.detail).toContain('«Высота слоя» (layer_height)');
    expect(res.text).toContain('Invalid value provided for parameter layer_height');
    expect(res.text).not.toContain('больше стола');
  } finally { await app.close(); }
});

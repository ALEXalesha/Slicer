// Законы редактора моделей, слоёв и вида в настоящем окне (замечания Алексея 17.10 и
// находки ревьювера). Окно невидимо (SLICER_TEST=1), диалоги подменены, принтер не нужен.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launch, tmp, ROOT } = require('./helpers');
const { findEngine } = require('../../src/core/engine-locate');
const { writeCube, teeStl } = require('../support/models');
const { bambuLike } = require('../support/threemf');

const engine = findEngine();
const FAKE_ENGINE = path.join(ROOT, 'tests', 'support', 'fake-engine.js');
const fake = (mode = 'ok') => ({ SLICER_ENGINE: FAKE_ENGINE, FAKE_ENGINE: mode, SLICER_PROFILES: engine ? engine.profilesDir : '' });

async function open(app, win, files) {
  const before = await win.evaluate(() => window.slicerPrepare.models().length);
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p }); }, files);
  await win.click('#open-models');
  await win.waitForFunction((n) => window.slicerPrepare.models().length > n, before, { timeout: 60000 });
}

const state = (win) => win.evaluate(() => {
  const e = window.slicerPrepare.editor;
  return e.states().map((s) => {
    const inst = e.items.find((i) => i.uid === s.uid);
    const b = e.box(inst);
    return { name: s.name, off: s.off, min: b.min.toArray(), max: b.max.toArray(), size: [s.size.x, s.size.y, s.size.z], paint: inst.paint ? [...inst.paint].filter(Boolean).length : 0 };
  });
});

async function sliceAndExport(app, win, out, name) {
  await win.click('#slice');
  await expect(win.locator('#export')).toBeEnabled({ timeout: 90000 });
  const file = path.join(out, name);
  await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);
  await win.click('#export');
  await expect(win.locator('#status')).toContainText(name);
  return fs.readFileSync(file, 'utf8');
}

const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

test('item 4: a 3MF like Elegoo/Orca opens with its objects, names and placement, and slices', async () => {
  test.skip(!engine, 'ElegooSlicer not installed');
  const dir = tmp('slicercc-3mf-');
  const file = path.join(dir, 'Проект Elegoo.3mf');
  fs.writeFileSync(file, bambuLike());
  const out = tmp('slicercc-out-');
  const { app, win } = await launch();
  try {
    await open(app, win, [file]);
    const s = await state(win);
    expect(s.map((x) => x.name)).toEqual(['Кубик с модификатором', 'second.stl']);
    expect(s.every((x) => !x.off)).toBe(true);
    expect(s[0].size.map(Math.round)).toEqual([50, 50, 50]);
    expect(near(s[0].min[0], 103, 0.1) && near(s[0].min[1], 104, 0.1)).toBe(true);          // место из файла
    const g = await sliceAndExport(app, win, out, 'p.gcode');
    expect(g.match(/^EXCLUDE_OBJECT_DEFINE /gm)).toHaveLength(2);
    expect(g).toMatch(/EXCLUDE_OBJECT_DEFINE NAME=Kubik_s_modifikatorom/);
    expect(g).toMatch(/POLYGON=\[\[103,104\],\[153,104\]/);                                    // там же, где на экране
  } finally { await app.close(); }
});

test('item 2: drag with the mouse, numbers, mirror, lay flat, copies, center', async () => {
  const d = tmp('slicercc-m-');
  const { app, win } = await launch({ env: fake() });
  try {
    await open(app, win, [writeCube(path.join(d, 'cube.stl'), 20)]);
    const [a] = await state(win);
    // мышью: точка модели на экране -> тянем на 120 px вправо
    const at = await win.evaluate(() => {
      const e = window.slicerPrepare.editor;
      const s = e.scene;
      const inst = e.items[0];
      const v = inst.mesh.position.clone().project(s.camera);
      const r = s.canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    });
    await win.mouse.move(at.x, at.y);
    await win.mouse.down();
    for (let i = 1; i <= 6; i++) await win.mouse.move(at.x + i * 20, at.y);
    await win.mouse.up();
    const [b] = await state(win);
    expect(b.min[0] - a.min[0]).toBeGreaterThan(10);
    expect(near(b.min[2], 0)).toBe(true);
    // числа: место X, поворот Z 45°, масштаб 200 %
    await win.fill('#tool-panel input[data-kind="pos"][data-axis="x"]', '60');
    await win.press('#tool-panel input[data-kind="pos"][data-axis="x"]', 'Enter');
    let [c] = await state(win);
    expect(near((c.min[0] + c.max[0]) / 2, 60)).toBe(true);
    await win.fill('#tool-panel input[data-kind="rot"][data-axis="z"]', '45');
    await win.press('#tool-panel input[data-kind="rot"][data-axis="z"]', 'Enter');
    [c] = await state(win);
    expect(near(c.size[0], 20 * Math.SQRT2, 0.1)).toBe(true);
    await win.fill('#tool-panel input[data-kind="scl"][data-axis="x"]', '200');
    await win.press('#tool-panel input[data-kind="scl"][data-axis="x"]', 'Enter');
    [c] = await state(win);
    expect(near(c.size[2], 40, 0.1)).toBe(true);                                            // пропорционально
    // гранью на стол: наклон 30° по X, затем «самой большой гранью» - снова плоско
    await win.fill('#tool-panel input[data-kind="rot"][data-axis="x"]', '30');
    await win.press('#tool-panel input[data-kind="rot"][data-axis="x"]', 'Enter');
    [c] = await state(win);
    expect(c.size[2]).toBeGreaterThan(41);
    await win.click('#toolbar button[data-tool="face"]');
    await win.click('#tp-layflat');
    [c] = await state(win);
    expect(near(c.size[2], 40, 0.1)).toBe(true);
    expect(near(c.min[2], 0)).toBe(true);
    // зеркало и копии
    await win.click('#toolbar button[data-tool="move"]');
    await win.click('#tool-panel button[data-mirror="x"]');
    await win.fill('#tp-copies', '3');
    await win.click('#tp-copies-go');
    const all = await state(win);
    expect(all).toHaveLength(4);
    expect(all.every((x) => !x.off)).toBe(true);
    for (let i = 0; i < all.length; i++) for (let j = 0; j < i; j++) {
      const p = all[i], q = all[j];
      expect(p.max[0] <= q.min[0] + 0.01 || q.max[0] <= p.min[0] + 0.01 || p.max[1] <= q.min[1] + 0.01 || q.max[1] <= p.min[1] + 0.01).toBe(true);
    }
    // выравнивание по левому краю двух выбранных
    await win.evaluate(() => { const e = window.slicerPrepare.editor; e.selected = new Set(e.items.slice(0, 2).map((i) => i.uid)); e.refreshPanel(); });
    await win.click('#tool-panel button[data-align="left"]');
    const al = await state(win);
    expect(near(al[0].min[0], al[1].min[0])).toBe(true);
  } finally { await app.close(); }
});

test('reviewer A1: ten 90 mm cubes - arrange tells 4 of 10, slicing refuses with names, print stays off', async () => {
  const d = tmp('slicercc-m-');
  const files = Array.from({ length: 10 }, (_, i) => writeCube(path.join(d, `c${i}.stl`), 90));
  const { app, win } = await launch({ env: fake() });
  try {
    await open(app, win, files);
    await win.waitForFunction(() => window.slicerPrepare.models().length === 10);
    await win.click('#toolbar button[data-act="arrange"]');
    await expect(win.locator('#status')).toHaveText('На стол влезло 4 из 10. Лишние стоят справа от стола (красные): уберите их и напечатайте отдельно.');
    expect((await state(win)).filter((x) => x.off)).toHaveLength(6);
    await expect(win.locator('#models .chip.off')).toHaveCount(6);
    await win.click('#slice');
    await expect(win.locator('#status')).toContainText('За краем стола: c');
    await expect(win.locator('#print')).toBeDisabled();
  } finally { await app.close(); }
});

test('item 2: cut a cube in two; both parts closed and sliced as two objects', async () => {
  test.skip(!engine, 'ElegooSlicer not installed');
  const d = tmp('slicercc-m-');
  const out = tmp('slicercc-out-');
  const { app, win } = await launch();
  try {
    await open(app, win, [writeCube(path.join(d, 'cube.stl'), 20)]);
    await win.click('#toolbar button[data-tool="cut"]');
    await win.fill('#tp-cut-z', '8');
    await win.press('#tp-cut-z', 'Enter');
    await win.click('#tp-cut');
    const s = await state(win);
    expect(s.map((x) => Math.round(x.size[2] * 10) / 10).sort()).toEqual([12, 8]);
    expect(s.every((x) => !x.off && near(x.min[2], 0))).toBe(true);
    const g = await sliceAndExport(app, win, out, 'cut.gcode');
    expect(g.match(/^EXCLUDE_OBJECT_DEFINE /gm)).toHaveLength(2);
  } finally { await app.close(); }
});

test('item 3: supports painted with the brush print only there; blocked paint removes auto supports', async () => {
  test.skip(!engine, 'ElegooSlicer not installed');
  const d = tmp('slicercc-m-');
  const tee = path.join(d, 'tee.stl');
  fs.writeFileSync(tee, teeStl());
  const out = tmp('slicercc-out-');
  const { app, win } = await launch();
  try {
    await open(app, win, [tee]);
    const plain = await sliceAndExport(app, win, out, 'plain.gcode');
    expect(plain).not.toMatch(/^;TYPE:Support$/m);
    await win.click('#view-switch button[data-show="models"]');
    await win.click('#toolbar button[data-tool="paint"]');
    await expect(win.locator('#tool-panel')).toContainText('напечатаются только покрашенные места');
    // кисть «ставить» под левым выступом полки (низ полки z = 20)
    await win.evaluate(() => {
      const e = window.slicerPrepare.editor;
      const inst = e.items[0];
      const b = e.box(inst);
      const p = b.min.clone(); p.x += 4; p.y = (b.min.y + b.max.y) / 2; p.z = 20;
      e.brush = { mode: 1, radius: 4 };
      e.paintAt(inst, p, true);
      e.changed();
    });
    expect((await state(win))[0].paint).toBeGreaterThan(0);
    const painted = await sliceAndExport(app, win, out, 'painted.gcode');
    expect(painted).toMatch(/^;TYPE:Support$/m);
    expect(painted).toMatch(/^; support_type = tree\(manual\)$/m);
    // «Где нужно» + запрет на всей модели - поддержек нет
    await win.click('#supports button[data-value="plate"]');
    await win.evaluate(() => {
      const e = window.slicerPrepare.editor;
      e.items[0].paint.fill(2);
      e.scene.setPaintOverlay(e.items[0].mesh, e.items[0].mesh.geometry.attributes.position.array, e.items[0].paint);
      e.changed();
    });
    const blocked = await sliceAndExport(app, win, out, 'blocked.gcode');
    expect(blocked).not.toMatch(/^;TYPE:Support$/m);
  } finally { await app.close(); }
});

test('item 1: layers with legend; the slider and the boxes change what is drawn', async () => {
  test.skip(!engine, 'ElegooSlicer not installed');
  const d = tmp('slicercc-m-');
  const { app, win } = await launch();
  try {
    await open(app, win, [writeCube(path.join(d, 'cube.stl'), 20)]);
    await win.click('#slice');
    await expect(win.locator('#legend')).toBeVisible({ timeout: 90000 });
    await expect(win.locator('#view-switch button[data-show="layers"]')).toHaveClass(/active/);
    for (const k of ['outer', 'inner', 'sparse', 'top', 'bottom', 'travel']) await expect(win.locator(`#legend .lg-row[data-kind="${k}"]`)).toHaveCount(1);
    await expect(win.locator('#legend .lg-row[data-kind="travel"] input')).not.toBeChecked();
    await expect(win.locator('#layer-label')).toHaveText(/^Слой 100 из 100, 20 мм$/);
    const drawn = () => win.evaluate(() => window.slicerPrepare.editor.scene.drawnSegments());
    const all = await drawn();
    await win.locator('#layer-top').fill('10');
    await expect(win.locator('#layer-label')).toHaveText(/^Слой 10 из 100, 2 мм$/);
    const ten = await drawn();
    expect(ten).toBeGreaterThan(0);
    expect(ten).toBeLessThan(all);
    await win.check('#layer-only');
    expect(await drawn()).toBeLessThan(ten);
    await win.uncheck('#layer-only');
    await win.locator('#legend .lg-row[data-kind="sparse"] input').uncheck();
    expect(await drawn()).toBeLessThan(ten);
    // язык переключается и здесь
    await win.selectOption('#lang', 'en');
    await expect(win.locator('#layer-label')).toHaveText(/^Layer 10 of 100, 2 mm$/);
    await expect(win.locator('#legend .lg-row[data-kind="outer"] .lg-name')).toHaveText('Outer wall');
    await expect(win.locator('#res-time')).toContainText('Time');
    // любое изменение моделей прячет слои
    await win.click('#view-switch button[data-show="models"]');
    await win.fill('#tool-panel input[data-kind="pos"][data-axis="x"]', '100');
    await win.press('#tool-panel input[data-kind="pos"][data-axis="x"]', 'Enter');
    await expect(win.locator('#show-layers')).toBeDisabled();
    await expect(win.locator('#print')).toBeDisabled();
  } finally { await app.close(); }
});

test('reviewer A2: a model removed while slicing makes the result stale - print stays off', async () => {
  const d = tmp('slicercc-m-');
  const { app, win } = await launch({ env: fake('slow') });
  try {
    test.skip(!engine, 'needs the real profiles');
    await open(app, win, [writeCube(path.join(d, 'a.stl'), 20), writeCube(path.join(d, 'b.stl'), 20)]);
    await win.click('#slice');
    await expect(win.locator('#status')).toHaveText('Режу модель…');
    await win.click('#models button[data-remove]');
    await expect(win.locator('#status')).toHaveText('Пока шла нарезка, модели или настройки поменялись - нарежьте снова.', { timeout: 30000 });
    await expect(win.locator('#print')).toBeDisabled();
    await expect(win.locator('#export')).toBeDisabled();
    // то же с выбором «Новичка»
    await win.click('#slice');
    await expect(win.locator('#status')).toHaveText('Режу модель…');
    await win.click('#supports button[data-value="plate"]');
    await expect(win.locator('#status')).toHaveText('Пока шла нарезка, модели или настройки поменялись - нарежьте снова.', { timeout: 30000 });
    await expect(win.locator('#print')).toBeDisabled();
  } finally { await app.close(); }
});

test('items 5, 6, 9 and reviewer B3: thin scrollbar, select arrow off the edge, long names cut with a tooltip, the whole bed in view', async () => {
  test.skip(!engine, 'needs the real profiles');
  const d = tmp('slicercc-m-');
  const long = 'Очень_длинное_название_модели_для_проверки_обрезки_имени_в_окне_слайсера_и_всплывающей_подсказки.stl';
  const { app, win } = await launch({ env: fake() });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 640));
    await win.waitForTimeout(400);
    expect(await win.evaluate(() => window.slicerPrepare.editor.scene.bedInView())).toBe(1);
    // полоса прокрутки: настоящая ширина у прокручиваемой панели
    await win.click('#mode button[data-mode="advanced"]');
    await win.waitForTimeout(800);
    const bar = await win.evaluate(() => { const el = document.querySelector('#advanced'); return { over: el.scrollHeight > el.clientHeight, w: el.offsetWidth - el.clientWidth - (parseFloat(getComputedStyle(el).borderLeftWidth) || 0) - (parseFloat(getComputedStyle(el).borderRightWidth) || 0) }; });
    expect(bar.over).toBe(true);
    expect(bar.w).toBeLessThanOrEqual(8);
    expect(bar.w).toBeGreaterThan(0);
    await win.click('#mode button[data-mode="novice"]');
    // стрелка списка: своя, с отступом от правого края
    const sel = await win.evaluate(() => [...document.querySelectorAll('select')].filter((s) => s.offsetParent).map((s) => {
      const cs = getComputedStyle(s);
      const pos = cs.backgroundPositionX.split(',').map((x) => Number((/100% - (\d+(?:\.\d+)?)px/.exec(x) || [])[1]));
      return { id: s.id, appearance: cs.appearance, pr: parseFloat(cs.paddingRight), right: Math.min(...pos) };
    }));
    expect(sel.length).toBeGreaterThan(1);
    for (const s of sel) {
      expect(s.appearance, s.id).toBe('none');
      expect(s.pr, s.id).toBeGreaterThanOrEqual(26);
      expect(s.right, s.id).toBeGreaterThanOrEqual(10);                     // стрелка не вплотную к рамке
    }
    // длинное имя: одна строка с «…», полное - в title; ничто не вылезает за край
    await open(app, win, [writeCube(path.join(d, long), 20)]);
    const chip = await win.evaluate(() => {
      const span = document.querySelector('#models .chip span');
      const box = document.querySelector('#models');
      const stage = document.querySelector('#stage').getBoundingClientRect();
      const r = document.querySelector('#models .chip').getBoundingClientRect();
      return { title: span.title, cut: span.scrollWidth > span.clientWidth, ellipsis: getComputedStyle(span).textOverflow, inside: r.right <= stage.right, fits: box.scrollWidth <= box.clientWidth + 1 };
    });
    expect(chip).toEqual({ title: long, cut: true, ellipsis: 'ellipsis', inside: true, fits: true });
    const panelName = await win.evaluate(() => { const n = document.querySelector('#tool-panel .tp-name'); return { title: n.title, fits: n.scrollWidth > n.clientWidth && getComputedStyle(n).textOverflow === 'ellipsis' }; });
    expect(panelName).toEqual({ title: long, fits: true });
    await win.click('#slice');
    await expect(win.locator('#print')).toBeEnabled({ timeout: 30000 });
    const st = await win.evaluate(() => { const el = document.querySelector('#status'); const side = document.querySelector('.side').getBoundingClientRect(); return el.getBoundingClientRect().right <= side.right + 1 && el.scrollWidth <= el.clientWidth + 1; });
    expect(st).toBe(true);
    // экспорт в длинную папку: в строке только имя файла, путь - в подсказке (ревьювер Б2)
    const deep = path.join(tmp('slicercc-out-'), 'очень_длинная_папка_'.repeat(5));
    fs.mkdirSync(deep, { recursive: true });
    const file = path.join(deep, 'длинное_имя_файла_для_проверки_строки_состояния.gcode');
    await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);
    await win.click('#export');
    await expect(win.locator('#status')).toHaveText('Сохранено: длинное_имя_файла_для_проверки_строки_состояния.gcode');
    await expect(win.locator('#status')).toHaveAttribute('title', file);
  } finally { await app.close(); }
});

test('light theme makes the bed light too', async () => {
  const { app, win } = await launch();
  try {
    const color = () => win.evaluate(() => window.slicerPrepare.editor.scene.bedGroup.children[0].material.color.getHex());
    const dark = await color();
    await win.selectOption('#theme', 'light');
    await win.waitForTimeout(200);
    const light = await color();
    expect(light).not.toBe(dark);
    expect(((light >> 16) & 255) + ((light >> 8) & 255) + (light & 255)).toBeGreaterThan(450);
  } finally { await app.close(); }
});

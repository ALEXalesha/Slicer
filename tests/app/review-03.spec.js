// Законы по независимой проверке 23.10 вечером (Python/review-23-10/slicer/ОТЧЁТ.md): А1-А3, Б1-Б10.
// Окно невидимо (SLICER_TEST=1), диалоги подменены, принтер - только поддельный.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launch, tmp, ROOT } = require('./helpers');
const { findEngine } = require('../../src/core/engine-locate');
const { writeCube, teeStl } = require('../support/models');

const engine = findEngine();
const FAKE_ENGINE = path.join(ROOT, 'tests', 'support', 'fake-engine.js');
const fake = (mode = 'ok') => ({ SLICER_ENGINE: FAKE_ENGINE, FAKE_ENGINE: mode, SLICER_PROFILES: engine ? engine.profilesDir : '' });

async function open(app, win, files) {
  const before = await win.evaluate(() => window.slicerPrepare.models().length);
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p }); }, files);
  await win.click('#open-models');
  await win.waitForFunction((n) => window.slicerPrepare.models().length > n, before, { timeout: 60000 });
}

async function size(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => { const b = BrowserWindow.getAllWindows()[0]; b.setMinimumSize(1, 1); b.setContentSize(s[0], s[1]); }, [w, h]);
  await win.waitForTimeout(400);
}

const centers = (win) => win.evaluate(() => {
  const e = window.slicerPrepare.editor;
  return e.items.map((i) => { const b = e.box(i); return [Math.round(((b.min.x + b.max.x) / 2) * 100) / 100, Math.round(((b.min.y + b.max.y) / 2) * 100) / 100]; });
});
const names = (win) => win.evaluate(() => window.slicerPrepare.models());
const selected = (win) => win.evaluate(() => [...window.slicerPrepare.editor.selected].sort());
const blur = (win) => win.evaluate(() => document.activeElement && document.activeElement.blur());
// Ctrl+Z / Ctrl+Y как в русской раскладке: e.key «я» / «н», e.code - клавиша Z / Y.
const key = (win, code, opts = {}) => win.evaluate(([code, o]) => {
  const k = { KeyZ: 'я', KeyY: 'н', KeyA: 'ф' }[code] || code;
  document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, code, bubbles: true, cancelable: true, ctrlKey: true }, o)));
}, [code, opts]);
const undo = (win) => key(win, 'KeyZ');
const redo = (win) => key(win, 'KeyY');
const settled = (win) => win.waitForFunction(() => !window.slicerPrepare.history.restoring(), null, { timeout: 10000 });

// Точка модели на экране (центр рамки модели, на половине высоты).
const screenOf = (win, k) => win.evaluate((k) => {
  const e = window.slicerPrepare.editor;
  const s = e.scene;
  const b = e.box(e.items[k]);
  const v = b.getCenter(b.min.clone()).project(s.camera);
  const r = s.canvas.getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}, k);

// ------------------------------------------------------------------ А1

test('review-03 A1: after the first brush stroke the model keeps its shading - normals are rebuilt for the finer mesh', async () => {
  const d = tmp('slicercc-m-');
  const tee = path.join(d, 'tee.stl');
  fs.writeFileSync(tee, teeStl());
  const { app, win } = await launch();
  try {
    await size(app, win, 1280, 800);
    await open(app, win, [tee]);
    await win.click('#toolbar button[data-tool="paint"]');
    // настоящий мазок мышью по середине столба (нормаль смотрит на камеру)
    const at = await win.evaluate(() => {
      const e = window.slicerPrepare.editor;
      const s = e.scene;
      const b = e.box(e.items[0]);
      const p = b.getCenter(b.min.clone()); p.z = 8; p.y = b.min.y;
      const v = p.project(s.camera);
      const r = s.canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    });
    const before = await win.evaluate(() => window.slicerPrepare.editor.items[0].mesh.geometry.attributes.position.count);
    await win.mouse.move(at.x, at.y);
    await win.mouse.down();
    await win.mouse.up();
    const g = await win.evaluate(() => {
      const geo = window.slicerPrepare.editor.items[0].mesh.geometry;
      const n = geo.attributes.normal;
      let zero = 0;
      for (let i = 0; i < n.count; i++) if (Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) < 0.5) zero++;
      return { pos: geo.attributes.position.count, nor: n.count, zero, paint: window.slicerPrepare.editor.items[0].paint ? [...window.slicerPrepare.editor.items[0].paint].filter(Boolean).length : 0 };
    });
    expect(g.pos).toBeGreaterThan(before);           // сетка измельчена
    expect(g.paint).toBeGreaterThan(0);              // мазок попал
    expect(g.nor).toBe(g.pos);                       // нормаль у каждой вершины
    expect(g.zero).toBe(0);
    // и на картинке: полка модели не чёрная (светотень есть)
    const lum = await win.evaluate(() => {
      const e = window.slicerPrepare.editor;
      const s = e.scene;
      e.select(null); s.render();
      const b = e.box(e.items[0]);
      const p = b.getCenter(b.min.clone()); p.z = 24; p.x = b.min.x + 3;
      const v = p.project(s.camera);
      const c = s.canvas;
      const x = Math.round(((v.x + 1) / 2) * c.width), y = Math.round(((1 - v.y) / 2) * c.height);
      const cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height;
      const ctx = cv.getContext('2d'); ctx.drawImage(c, 0, 0);
      const px = ctx.getImageData(x - 1, y - 1, 3, 3).data;
      let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
      return sum / 9 / 3;
    });
    expect(lum).toBeGreaterThan(60);
  } finally { await app.close(); }
});

// Ластик кисти - то, чего Алексею не хватает в Orca / Elegoo Slicer: стереть часть мазка.
test('review-03 A1: the eraser removes support marks only where it passes; the rest stays; the model keeps its shading; Ctrl+Z undoes the erase', async () => {
  const d = tmp('slicercc-m-');
  const tee = path.join(d, 'tee.stl');
  fs.writeFileSync(tee, teeStl());
  const { app, win } = await launch();
  try {
    await open(app, win, [tee]);
    await win.click('#toolbar button[data-tool="paint"]');
    // «ставить» под левым и под правым выступом полки (низ полки z = 20), мазок через события вида
    const stroke = (mode, side) => win.evaluate(([mode, side]) => {
      const e = window.slicerPrepare.editor;
      const inst = e.items[0];
      const b = e.box(inst);
      const p = b.min.clone(); p.y = (b.min.y + b.max.y) / 2; p.z = 20;
      p.x = side === 'left' ? b.min.x + 5 : b.max.x - 5;
      e.brush = { mode, radius: 4 };
      e.scene.events.paint(inst, p, true);
      e.scene.events.paintEnd(inst);
    }, [mode, side]);
    const look = () => win.evaluate(() => {
      const e = window.slicerPrepare.editor;
      const inst = e.items[0];
      const pos = inst.mesh.geometry.attributes.position.array;
      const b = e.box(inst);
      const mid = (b.min.x + b.max.x) / 2;
      let left = 0, right = 0;
      if (inst.paint) for (let t = 0; t < inst.paint.length; t++) {
        if (inst.paint[t] !== 1) continue;
        const wx = new e.scene.camera.position.constructor(pos[t * 9], pos[t * 9 + 1], pos[t * 9 + 2]).applyMatrix4(inst.mesh.matrixWorld).x;
        if (wx < mid) left++; else right++;
      }
      const overlay = inst.mesh.children.reduce((n, c) => n + c.geometry.attributes.position.count / 3, 0);
      const g = inst.mesh.geometry;
      return { left, right, overlay, normalsOk: g.attributes.normal.count === g.attributes.position.count };
    });
    await stroke(1, 'left');
    await stroke(1, 'right');
    const both = await look();
    expect(both.left).toBeGreaterThan(0);
    expect(both.right).toBeGreaterThan(0);
    expect(both.overlay).toBe(both.left + both.right);
    // ластик по левому: слева меток нет, справа - все на месте, наложение совпадает
    await win.click('#tool-panel [data-brush="0"]');
    expect(await win.evaluate(() => window.slicerPrepare.editor.brush.mode)).toBe(0);
    await stroke(0, 'left');
    const erased = await look();
    expect(erased.left).toBe(0);
    expect(erased.right).toBe(both.right);
    expect(erased.overlay).toBe(erased.right);
    expect(erased.normalsOk).toBe(true);
    // Ctrl+Z - стёртое вернулось
    await blur(win);
    await undo(win); await settled(win);
    expect(await look()).toEqual(both);
  } finally { await app.close(); }
});

// ------------------------------------------------------------------ А2

test('review-03 A2: Ctrl+Z / Ctrl+Y undo and redo plate edits: delete, numbers, arrange, cut, copies', async () => {
  const d = tmp('slicercc-m-');
  const { app, win } = await launch();
  try {
    await open(app, win, [writeCube(path.join(d, 'cube.stl'), 20)]);
    const c0 = await centers(win);
    // Delete -> модели нет; Ctrl+Z -> вернулась на то же место; Ctrl+Y -> снова нет
    await blur(win);
    await win.keyboard.press('Delete');
    expect(await names(win)).toEqual([]);
    await expect(win.locator('#status')).toContainText('Ctrl+Z');
    await undo(win); await settled(win);
    expect(await names(win)).toEqual(['cube.stl']);
    expect(await centers(win)).toEqual(c0);
    await redo(win); await settled(win);
    expect(await names(win)).toEqual([]);
    await undo(win); await settled(win);
    expect(await names(win)).toEqual(['cube.stl']);
    // место числом -> Ctrl+Z
    await win.evaluate(() => { const e = window.slicerPrepare.editor; e.selected = new Set([e.items[0].uid]); e.refreshPanel(); });
    await win.fill('#tool-panel input[data-kind="pos"][data-axis="x"]', '60');
    await win.press('#tool-panel input[data-kind="pos"][data-axis="x"]', 'Enter');
    expect((await centers(win))[0][0]).toBeCloseTo(60, 1);
    await undo(win); await settled(win);
    expect(await centers(win)).toEqual(c0);
    // копия и «Разложить»: Ctrl+Z возвращает ручную расстановку, ещё Ctrl+Z - убирает копию
    await win.click('#toolbar button[data-act="copy"]');
    const placed = await centers(win);
    expect(placed).toHaveLength(2);
    await win.click('#toolbar button[data-act="arrange"]');
    expect(await centers(win)).not.toEqual(placed);
    await undo(win); await settled(win);
    expect(await centers(win)).toEqual(placed);
    await undo(win); await settled(win);
    expect(await names(win)).toEqual(['cube.stl']);
    // разрез -> Ctrl+Z: одна целая модель с прежним именем
    await win.evaluate(() => { const e = window.slicerPrepare.editor; e.selected = new Set([e.items[0].uid]); e.refreshPanel(); });
    await win.click('#toolbar button[data-tool="cut"]');
    await win.click('#tp-cut');
    expect(await names(win)).toHaveLength(2);
    await undo(win); await settled(win);
    expect(await names(win)).toEqual(['cube.stl']);
    expect(await centers(win)).toEqual(c0);
    // кнопки на панели инструментов тоже работают и гаснут, когда нечего отменять
    await win.click('#toolbar button[data-act="redo"]'); await settled(win);
    expect(await names(win)).toHaveLength(2);
    await expect(win.locator('#toolbar button[data-act="redo"]')).toBeDisabled();
    await win.click('#toolbar button[data-act="undo"]'); await settled(win);
    expect(await names(win)).toEqual(['cube.stl']);
    // нарезка после отмены - снова нужна: результат прошлой нарезки не висит
    await expect(win.locator('#print')).toBeDisabled();
  } finally { await app.close(); }
});

test('review-03 A2: brush "Clear" with nothing selected asks first; no - paint stays; yes - cleared, Ctrl+Z brings it back', async () => {
  const d = tmp('slicercc-m-');
  const tee = path.join(d, 'tee.stl');
  fs.writeFileSync(tee, teeStl());
  const { app, win } = await launch();
  try {
    await open(app, win, [tee]);
    await open(app, win, [writeCube(path.join(d, 'cube.stl'), 20)]);
    const paint = () => win.evaluate(() => window.slicerPrepare.editor.items.map((i) => (i.paint ? [...i.paint].filter(Boolean).length : 0)));
    await win.evaluate(() => {
      const e = window.slicerPrepare.editor;
      for (const inst of e.items) { const b = e.box(inst); const p = b.getCenter(b.min.clone()); p.z = b.max.z; e.brush = { mode: 1, radius: 4 }; e.paintAt(inst, p, true); }
      e.changed();
      e.select(null);
    });
    const painted = await paint();
    expect(painted.every((n) => n > 0)).toBe(true);
    await win.click('#toolbar button[data-tool="paint"]');
    await win.evaluate(() => window.slicerPrepare.editor.setTool('paint'));
    await win.evaluate(() => window.slicerPrepare.editor.select(null));
    await win.click('#tp-paint-clear');
    await expect(win.locator('#confirm')).toBeVisible();
    await expect(win.locator('#confirm-text')).toContainText('всех покрашенных моделей (2)');
    await win.click('#confirm-no');
    expect(await paint()).toEqual(painted);
    await win.click('#tp-paint-clear');
    await win.click('#confirm-yes');
    expect(await paint()).toEqual([0, 0]);
    await blur(win);
    await undo(win); await settled(win);
    expect(await paint()).toEqual(painted);
  } finally { await app.close(); }
});

test('review-03 A2: settings are in the same undo line - novice choices and Advanced; "Reset changes" asks and is undone', async () => {
  const { app, win } = await launch();
  try {
    await win.click('#supports [data-value="plate"]');
    await win.click('#filament [data-value="petg"]');
    await blur(win);
    await undo(win); await settled(win);
    expect(await win.evaluate(() => window.slicerPrepare.choice().filament)).toBe('pla');
    await expect(win.locator('#filament button.active')).toHaveAttribute('data-value', 'pla');
    await undo(win); await settled(win);
    expect(await win.evaluate(() => window.slicerPrepare.choice().supports)).toBe('none');
    await redo(win); await settled(win);
    expect(await win.evaluate(() => window.slicerPrepare.choice().supports)).toBe('plate');
    // «Продвинутый»: правка, затем «Сбросить правки» - вопрос; «Не надо» - правка цела
    test.skip(!engine, 'needs the real profiles');
    await win.click('#mode button[data-mode="advanced"]');
    await win.fill('#adv-search', 'layer_height');
    const input = win.locator('#adv-list .adv-item[data-key="process.layer_height"] input');
    await input.fill('0.28');
    await input.press('Enter');
    const edits = () => win.evaluate(async () => (await window.slicer.settings.get()).advanced.process);
    await expect.poll(edits).toEqual({ layer_height: '0.28' });
    await win.click('#adv-reset');
    await expect(win.locator('#confirm-text')).toContainText('(1:');
    await win.click('#confirm-no');
    expect(await edits()).toEqual({ layer_height: '0.28' });
    await win.click('#adv-reset');
    await win.click('#confirm-yes');
    await expect.poll(edits).toEqual({});
    await blur(win);
    await undo(win); await settled(win);
    await expect.poll(edits).toEqual({ layer_height: '0.28' });
    await expect(win.locator('#adv-list .adv-item[data-key="process.layer_height"] input')).toHaveValue('0.28');
  } finally { await app.close(); }
});

// ------------------------------------------------------------------ А3

test('review-03 A3: many models - the name list scrolls on its own and never lies under the tool panel; extra models can be removed', async () => {
  const d = tmp('slicercc-m-');
  const { app, win } = await launch();
  try {
    await open(app, win, [writeCube(path.join(d, 'cube70.stl'), 70)]);
    await win.fill('#tp-copies', '11');
    await win.click('#tp-copies-go');
    expect(await names(win)).toHaveLength(12);
    await win.click('#toolbar button[data-act="arrange"]');
    for (const [w, h] of [[1280, 800], [980, 640]]) {
      await size(app, win, w, h);
      for (const tool of ['move', 'cut', 'paint']) {
        await win.click(`#toolbar [data-tool="${tool}"]`);
        const r = await win.evaluate(() => {
          const a = document.querySelector('#models').getBoundingClientRect();
          const b = document.querySelector('#tool-panel').getBoundingClientRect();
          const head = document.querySelector('#models-head').getBoundingClientRect();
          const stage = document.querySelector('#stage').getBoundingClientRect();
          const box = document.querySelector('#models');
          return { gap: b.top - Math.max(a.bottom, head.bottom), scrolls: box.scrollHeight > box.clientHeight, inside: b.bottom <= stage.bottom && a.top >= stage.top };
        });
        expect(r.gap, `${w} ${tool}`).toBeGreaterThanOrEqual(0);
        expect(r.scrolls, `${w} ${tool}`).toBe(true);
        expect(r.inside).toBe(true);
      }
    }
    // красные «лишние» видны в шапке списка, «Убрать лишние» убирает их, Ctrl+Z возвращает
    await expect(win.locator('#models-head')).toContainText('за краем: 3');
    await win.click('#remove-off');
    expect(await names(win)).toHaveLength(9);
    await expect(win.locator('#models .chip.off')).toHaveCount(0);
    await blur(win);
    await undo(win); await settled(win);
    expect(await names(win)).toHaveLength(12);
  } finally { await app.close(); }
});

// ------------------------------------------------------------------ Б1, Б2

test('review-03 B1: turning the view with the mouse keeps the selection; a plain click on empty space clears it', async () => {
  const d = tmp('slicercc-m-');
  const { app, win } = await launch();
  try {
    await size(app, win, 1280, 800);
    await open(app, win, [writeCube(path.join(d, 'cube.stl'), 20)]);
    expect(await selected(win)).toHaveLength(1);
    const st = await win.locator('#stage').boundingBox();
    const x = st.x + st.width - 120, y = st.y + 120;              // пустой угол стола
    await win.mouse.move(x, y);
    await win.mouse.down();
    for (let i = 1; i <= 8; i++) await win.mouse.move(x - i * 15, y + i * 5);
    await win.mouse.up();
    expect(await selected(win)).toHaveLength(1);
    await expect(win.locator('#tool-panel .tp-name')).toHaveText('cube.stl');
    await win.mouse.click(x, y);
    expect(await selected(win)).toHaveLength(0);
  } finally { await app.close(); }
});

test('review-03 B2: dragging one of several selected models moves all of them; a click without a drag selects just that one', async () => {
  const d = tmp('slicercc-m-');
  const { app, win } = await launch();
  try {
    await size(app, win, 1280, 800);
    await open(app, win, [writeCube(path.join(d, 'a.stl'), 20)]);
    await open(app, win, [writeCube(path.join(d, 'b.stl'), 20)]);
    await win.evaluate(() => window.slicerPrepare.editor.selectAll());
    expect(await selected(win)).toHaveLength(2);
    const c0 = await centers(win);
    const at = await screenOf(win, 0);
    await win.mouse.move(at.x, at.y);
    await win.mouse.down();
    for (let i = 1; i <= 6; i++) await win.mouse.move(at.x + i * 15, at.y);
    await win.mouse.up();
    const c1 = await centers(win);
    expect(await selected(win)).toHaveLength(2);
    const dx = [c1[0][0] - c0[0][0], c1[1][0] - c0[1][0]];
    expect(dx[0]).toBeGreaterThan(5);
    expect(Math.abs(dx[1] - dx[0])).toBeLessThan(0.01);           // обе на одно и то же
    // одна отмена возвращает обе
    await blur(win);
    await undo(win); await settled(win);
    expect(await centers(win)).toEqual(c0);
    // щелчок без движения по одной из выбранных - выбрана только она
    const at2 = await screenOf(win, 1);
    await win.mouse.click(at2.x, at2.y);
    expect((await selected(win)).length).toBe(1);
    // Ctrl+A - все
    await key(win, 'KeyA');
    expect(await selected(win)).toHaveLength(2);
  } finally { await app.close(); }
});

// ------------------------------------------------------------------ Б3-Б9: печать, кнопки, тема, малое окно, слои

const { startFakePrinter } = require('../support/fake-printer');

async function slicedCube(app, win, d) {
  await open(app, win, [writeCube(path.join(d, 'cube.stl'), 20)]);
  await win.click('#slice');
  await expect(win.locator('#print')).toBeEnabled({ timeout: 60000 });
}

test('review-03 B3: a busy printer marks step 2 "printer is free" red, step 1 "connection" green', async () => {
  test.skip(!engine, 'needs the real profiles');
  const fp = await startFakePrinter({ status: 13 });
  const { app, win } = await launch({ env: fake() });
  try {
    await win.evaluate((h) => window.slicer.settings.set({ printerHost: h }), fp.host);
    await slicedCube(app, win, tmp('slicercc-m-'));
    await win.click('#print');
    await expect(win.locator('#status')).toContainText('занят', { timeout: 30000 });
    await expect(win.locator('#send-steps li[data-step="connect"]')).toHaveClass('done');
    await expect(win.locator('#send-steps li[data-step="check-idle"]')).toHaveClass('fail');
    await expect(win.locator('#send-steps li.fail')).toHaveCount(1);
    expect(fp.commands(128)).toHaveLength(0);
  } finally { await app.close(); await fp.close(); }
});

test('review-03 B4: waiting for the printer to show the file shows the attempt and seconds; the send can be canceled, nothing starts', async () => {
  test.skip(!engine, 'needs the real profiles');
  const fp = await startFakePrinter({ faults: { hideFile: true } });
  const { app, win } = await launch({ env: fake() });
  try {
    await win.evaluate((h) => window.slicer.settings.set({ printerHost: h }), fp.host);
    await slicedCube(app, win, tmp('slicercc-m-'));
    await win.click('#print');
    const verify = win.locator('#send-steps li[data-step="verify"]');
    await expect(verify).toContainText('попытка 1 из 3', { timeout: 30000 });
    await expect(verify).toContainText(/\d+ из \d+ с/);
    const t1 = await verify.textContent();
    await win.waitForTimeout(2500);
    expect(await verify.textContent()).not.toBe(t1);                 // счётчик идёт
    await expect(win.locator('#send-cancel')).toBeVisible();
    const t0 = Date.now();
    await win.click('#send-cancel');
    await expect(win.locator('#status')).toContainText('Отправка отменена', { timeout: 10000 });
    expect(Date.now() - t0).toBeLessThan(10000);
    await expect(win.locator('#send-cancel')).toBeHidden();
    await expect(win.locator('#print')).toBeEnabled();
    await win.waitForTimeout(1500);
    expect(fp.commands(128)).toHaveLength(0);
  } finally { await app.close(); await fp.close(); }
});

test('review-03 B5: Slice / Print / Export stay where they are after slicing and printing (1280 and 980)', async () => {
  test.skip(!engine, 'needs the real profiles');
  test.setTimeout(240000);
  const fp = await startFakePrinter();
  const { app, win } = await launch({ env: fake() });
  try {
    await win.evaluate((h) => window.slicer.settings.set({ printerHost: h }), fp.host);
    for (const [w, h] of [[1280, 800], [980, 640]]) {
      await size(app, win, w, h);
      const top = () => win.evaluate(() => ['#slice', '#print', '#export'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
      await win.evaluate(() => window.slicerPrepare.editor.remove(window.slicerPrepare.editor.items.slice()));
      await open(app, win, [writeCube(path.join(tmp('slicercc-m-'), 'cube.stl'), 20)]);
      const y0 = await top();
      await win.click('#slice');
      await expect(win.locator('#print')).toBeEnabled({ timeout: 60000 });
      expect(await top(), `${w} after slice`).toEqual(y0);
      fp.state.status = 0;                                          // поддельный снова свободен
      await win.click('#print');
      await expect(win.locator('#status')).toContainText('Печать началась', { timeout: 30000 });
      expect(await top(), `${w} after print`).toEqual(y0);
      // шаги печати видны и не лежат на кнопках
      const r = await win.evaluate(() => {
        const s = document.querySelector('#send-steps').getBoundingClientRect();
        const b = document.querySelector('#slice').getBoundingClientRect();
        const side = document.querySelector('.side').getBoundingClientRect();
        return { h: s.height, over: s.bottom > b.top + 1 && s.top < b.bottom, inside: s.top >= side.top - 1 };
      });
      expect(r.h).toBeGreaterThan(40);
      expect(r.over).toBe(false);
      expect(r.inside).toBe(true);
    }
  } finally { await app.close(); await fp.close(); }
});

test('review-03 B6: above Print - where it goes and the bed leveling switch, shared with the Printer tab', async () => {
  const { app, win } = await launch();
  try {
    const target = win.locator('#print-target');
    await expect(target).toContainText('спрошу');                     // адрес не задан
    await win.evaluate(() => window.slicer.settings.set({ printerHost: '192.168.5.77', bedLeveling: true }));
    await win.evaluate(() => window.slicerPrepare.refreshTarget());
    await expect(target).toContainText('192.168.5.77');
    await expect(win.locator('#print-leveling')).toBeChecked();
    await win.click('#print-leveling');
    await expect.poll(async () => (await win.evaluate(() => window.slicer.settings.get())).bedLeveling).toBe(false);
    await win.click('#tab-printer');
    await expect(win.locator('#bed-leveling')).not.toBeChecked();
    await win.click('#bed-leveling');
    await win.click('#tab-prepare');
    await expect(win.locator('#print-leveling')).toBeChecked();
  } finally { await app.close(); }
});

test('review-03 B7: the camera note is readable on the black camera box in every theme', async () => {
  const { app, win } = await launch();
  try {
    await win.click('#tab-printer');
    for (const th of ['glass', 'formal', 'light', 'night', 'warm']) {
      await win.selectOption('#theme', th);
      const c = await win.evaluate(() => {
        const rgb = (s) => /rgba?\(([^)]+)\)/.exec(s)[1].split(/[ ,/]+/).filter(Boolean).slice(0, 3).map(Number);
        const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const fg = lum(rgb(getComputedStyle(document.querySelector('#camera-hint')).color));
        const bg = lum(rgb(getComputedStyle(document.querySelector('.camera')).backgroundColor));
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      });
      expect(c, th).toBeGreaterThanOrEqual(4.5);
    }
  } finally { await app.close(); }
});

test('review-03 B8: the smallest window 980x640 - all three Beginner cards fit, Advanced keeps room for the list', async () => {
  test.skip(!engine, 'needs the real profiles');
  const { app, win } = await launch();
  try {
    await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.setMinimumSize(980, 640); b.setSize(980, 640); });
    await win.waitForTimeout(400);
    const r = await win.evaluate(() => {
      const n = document.querySelector('#novice');
      const p = n.getBoundingClientRect();
      const last = document.querySelector('#brim').closest('label').getBoundingClientRect();
      return { fits: last.bottom <= p.bottom + 0.5, scroll: n.scrollHeight <= n.clientHeight + 1 };
    });
    expect(r).toEqual({ fits: true, scroll: true });
    await win.click('#mode button[data-mode="advanced"]');
    await expect(win.locator('#adv-list .adv-item').first()).toBeVisible();
    const list = await win.evaluate(() => {
      const panel = document.querySelector('#advanced').getBoundingClientRect();
      const l = document.querySelector('#adv-list').getBoundingClientRect();
      return Math.min(panel.bottom, l.bottom) - l.top;
    });
    expect(list).toBeGreaterThanOrEqual(150);
  } finally { await app.close(); }
});

test('review-03 B9: after slicing the Layers view comes closer to the models; "whole plate" goes back', async () => {
  test.skip(!engine, 'needs the real profiles');
  const { app, win } = await launch({ env: fake() });
  try {
    await size(app, win, 1280, 800);
    await slicedCube(app, win, tmp('slicercc-m-'));
    await expect(win.locator('#legend')).toBeVisible();
    const share = () => win.evaluate(() => {
      const e = window.slicerPrepare.editor;
      const s = e.scene;
      const b = e.box(e.items[0]);
      let x0 = 1, x1 = -1, y0 = 1, y1 = -1;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        const v = b.min.clone().set(x, y, z).project(s.camera);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      return { h: (y1 - y0) / 2, inside: x0 >= -1 && x1 <= 1 && y0 >= -1 && y1 <= 1, bed: s.bedInView() };
    });
    const near = await share();
    expect(near.h).toBeGreaterThan(0.3);                    // куб 20 мм - треть высоты вида и больше
    expect(near.inside).toBe(true);
    await win.click('#fit-view');
    const far = await share();
    expect(far.bed).toBe(1);
    expect(far.h).toBeLessThan(near.h);
  } finally { await app.close(); }
});

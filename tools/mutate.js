// Проверка проверок: нарочно ломаем продукт в одном месте и ждём, что упадёт нужный тест.
// Мутант, после которого тесты зелёные, - дыра в законах. Файл всегда возвращается назад.
//   node tools/mutate.js            все мутанты
//   node tools/mutate.js send       только те, где в имени есть «send»
// Мутант с полем app проверяется тестом окна (Playwright, невидимое окно, SLICER_TEST=1) с отбором -g grep.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTANTS = [
  { name: 'sdcp: camera may be disabled', file: 'src/core/sdcp.js', from: 'body.Enable !== 1', to: 'false', test: 'tests/core/sdcp.test.js' },
  { name: 'send: start without the file in the list', file: 'src/core/send.js', from: 'if (!listed) throw lastErr;', to: 'if (false) throw lastErr;', test: 'tests/core/send.test.js' },
  { name: 'send: size ignored', file: 'src/core/send.js', from: 'f.size === null || f.size === size', to: 'true', test: 'tests/core/send.test.js' },
  { name: 'send: busy printer not checked', file: 'src/core/send.js', from: 'if (start && isBusy(status))', to: 'if (false)', test: 'tests/core/send.test.js' },
  { name: 'send: old file with the same name', file: 'src/core/send.js', from: 'if (!set.has(name)) return name;', to: 'return name;', test: 'tests/core/send.test.js' },
  { name: 'send: start retried after no answer', file: 'src/core/send.js', from: 'if (!started) throw new SendError(\'not-started\', { name, step: \'start\' });',
    to: 'if (!started) { await client.request(CMD.START, { Filename: remote, StartLayer: 0 }).catch(() => {}); throw new SendError(\'not-started\', { name, step: \'start\' }); }', test: 'tests/core/send.test.js' },
  { name: 'upload: chunk not retried', file: 'src/core/upload.js', from: 'for (let i = 0; i <= retriesPerChunk; i++)', to: 'for (let i = 0; i < 1; i++)', test: 'tests/core/send.test.js' },
  { name: 'novice: delta not clamped', file: 'src/core/novice.js', from: 'delta = Math.max(-TEMP_LIMIT, Math.min(TEMP_LIMIT, delta));', to: '', test: 'tests/core/novice.test.js' },
  { name: 'novice: advanced edits leak into novice', file: 'src/core/novice.js', from: 'if (isAdv && advanced && typeof advanced === \'object\')', to: 'if (advanced && typeof advanced === \'object\')', test: 'tests/core/novice.test.js' },
  { name: 'novice: everywhere = plate only', file: 'src/core/novice.js', from: "c.supports === 'everywhere' ? '0' : '1'", to: "'1'", test: 'tests/core/novice.test.js' },
  { name: 'presets: parent wins over child', file: 'src/core/presets.js', from: 'for (let i = chain.length - 1; i >= 0; i--)', to: 'for (let i = 0; i < chain.length; i++)', test: 'tests/core/presets.test.js' },
  { name: 'presets: only one level', file: 'src/core/presets.js', from: "cur = typeof e.json.inherits === 'string' ? e.json.inherits : '';", to: "cur = chain.length < 2 && typeof e.json.inherits === 'string' ? e.json.inherits : '';", test: 'tests/core/presets.test.js' },
  { name: 'names: spaces and unicode kept', file: 'src/core/names.js', from: ".replace(/[^A-Za-z0-9_.-]+/g, '_')", to: ".replace(/ +/g, '_')", test: 'tests/core/names.test.js' },
  { name: 'job: tiny binary STL not marked', file: 'src/core/job.js', from: 'if (buf.length === 84 + count * 50 && looksAscii(buf)) markBinary(buf);', to: '', test: 'tests/core/engine.test.js' },
  { name: 'job: machine from User', file: 'src/core/job.js', from: "{ from: 'system' }", to: "{ from: 'User' }", test: 'tests/core/engine.test.js' },
  { name: 'aifp: answered alert shown', file: 'src/core/aifp.js', from: 'if (answered.has(a.id)) continue;', to: '', test: 'tests/core/aifp.test.js' },
  { name: 'catalog: comma not turned into a dot', file: 'src/core/settings-catalog.js', from: "const v = s.replace(/,/g, '.')", to: 'const v = s', test: 'tests/core/settings-catalog.test.js' },
  { name: 'catalog: range not checked', file: 'src/core/settings-catalog.js', from: "if (!inRange(n, ty.min, ty.max)) return fail('range');", to: '', test: 'tests/core/settings-catalog.test.js' },
  { name: 'settings: invalid advanced value stored', file: 'src/core/settings.js', from: 'if (c.ok && c.value.length <= 500) out[k] = c.value;', to: 'out[k] = String(v);', test: 'tests/core/settings.test.js' },
  { name: 'settings: old flat filament edits lost', file: 'src/core/settings.js', from: 'const old = cleanEdits(legacy);', to: 'const old = {};', test: 'tests/core/settings.test.js' },
  { name: 'novice: filament edits shared by all filaments', file: 'src/core/novice.js', from: 'return plainObject(by[id]) || {};', to: 'return Object.assign({}, ...Object.values(by).filter(plainObject));', test: 'tests/core/novice.test.js' },
  { name: 'engine: bad setting reported as failed', file: 'src/core/engine.js', from: "if (key) throw Object.assign(new EngineError('bad-setting', why), { key });", to: '', test: 'tests/core/engine.test.js' },
  { name: 'settings: any host accepted', file: 'src/core/settings.js', from: "if (s === '') return true;", to: 'return true;', test: 'tests/core/settings.test.js' },
  { name: 'settings: http:// not cut from the address', file: 'src/core/settings.js', from: ".replace(/^(?:https?|wss?):\\/\\//i, '')", to: '', test: 'tests/core/settings.test.js' },
  // 0.2: 3MF, стол, разрез, расстановка, слои, поддержки кистью.
  { name: '3mf: component transform ignored', file: 'src/core/mesh.js', from: 'collect(c.path || filePath, c.objectid, multiply(m, c.transform), depth + 1, null, out);', to: 'collect(c.path || filePath, c.objectid, m, depth + 1, null, out);', test: 'tests/core/mesh.test.js' },
  { name: '3mf: modifier parts printed', file: 'src/core/mesh.js', from: "if (sub && sub !== 'normal_part') { warnings.add(sub); continue; }", to: '', test: 'tests/core/mesh.test.js' },
  { name: '3mf: units ignored', file: 'src/core/mesh.js', from: 'const mm = mdl.unit !== 1 ?', to: 'const mm = false ?', test: 'tests/core/mesh.test.js' },
  { name: 'plate 3mf: mirror turns faces inside', file: 'src/core/project3mf.js', from: 'const flip = m ? det3(m) < 0 : false;', to: 'const flip = false;', test: 'tests/core/mesh.test.js' },
  { name: 'plate 3mf: support paint lost', file: 'src/core/project3mf.js', from: "const paint = obj.paint ? PAINT_CODE[obj.paint[t]] : undefined;", to: 'const paint = undefined;', test: 'tests/core/mesh.test.js' },
  { name: 'cut: holes not cut into the cap', file: 'src/renderer/mesh-ops.js', from: 'if (depth[i] % 2) continue;', to: '', test: 'tests/core/mesh-ops.test.js' },
  { name: 'cut: no cap', file: 'src/renderer/mesh-ops.js', from: 'try { faces = triangulate(contour, holes); } catch { faces = []; }', to: 'faces = [];', test: 'tests/core/mesh-ops.test.js' },
  { name: 'arrange: overflow placed on the bed anyway', file: 'src/renderer/mesh-ops.js', from: 'if (usedD + (rows.length ? gap : 0) + s.d > usable) { overflow.push(i); continue; }', to: '', test: 'tests/core/mesh-ops.test.js' },
  { name: 'lay flat: inner faces count', file: 'src/renderer/mesh-ops.js', from: 'if (Math.abs(dk / 20 - extreme) < 0.11) area += a;', to: 'area += a;', test: 'tests/core/mesh-ops.test.js' },
  { name: 'engine: second plate printed silently', file: 'src/core/engine.js', from: "if (plates > 1) throw new EngineError('plates', String(plates));", to: '', test: 'tests/core/engine.test.js' },
  { name: 'paint: enforcers ignored when supports are off', file: 'src/core/novice.js', from: "process.support_type = 'tree(manual)';", to: '', test: 'tests/core/novice.test.js' },
  { name: 'layers: travel drawn as extrusion', file: 'src/core/gcode-preview.js', from: 'const k = de > 0 && moved ? kind : TRAVEL;', to: 'const k = moved ? kind : TRAVEL;', test: 'tests/core/gcode-preview.test.js' },
  { name: 'layers: purge not in the first layer', file: 'src/core/gcode-preview.js', from: "if (layer < 0 && total) { layer = 0; layers.push({ z }); }", to: '', test: 'tests/core/gcode-preview.test.js' },
  // Управление принтером: занятый принтер не двигается, пределы температур, знак Z.
  { name: 'control: session moves a busy printer', file: 'electron/printer-session.js', from: "if ((kind === 'move' || kind === 'home') && !Control.canMove(c.lastStatus)) return { ok: false, code: 'busy' };", to: '', test: 'tests/core/printer-control.test.js' },
  { name: 'control: client moves a busy printer', file: 'src/core/printer-client.js', from: "if (!Control.canMove(s)) throw new SdcpError('busy', 'printer is not idle');", to: '', test: 'tests/core/printer-control.test.js' },
  { name: 'control: unknown status counts as idle', file: 'src/core/printer-control.js', from: 'if (!isObj(pi) || !NUM(pi.Status)) return false;', to: 'if (!isObj(pi) || !NUM(pi.Status)) return true;', test: 'tests/core/printer-control.test.js' },
  { name: 'control: printing counts as idle', file: 'src/core/printer-control.js', from: 'if (![0, 8, 9].includes(pi.Status)) return false;', to: 'if (![0, 8, 9, 13].includes(pi.Status)) return false;', test: 'tests/core/printer-control.test.js' },
  { name: 'control: nozzle over 350', file: 'src/core/printer-control.js', from: "checkInt(nozzle, LIMITS.nozzle, 'bad-temp')", to: "checkInt(nozzle, 1000, 'bad-temp')", test: 'tests/core/printer-control.test.js' },
  { name: 'control: bed over 110', file: 'src/core/printer-control.js', from: "checkInt(bed, LIMITS.bed, 'bad-temp')", to: "checkInt(bed, LIMITS.nozzle, 'bad-temp')", test: 'tests/core/printer-control.test.js' },
  { name: 'control: fan over 100', file: 'src/core/printer-control.js', from: "ModelFan: checkInt(model, LIMITS.fan, 'bad-fan')", to: "ModelFan: checkInt(model, 255, 'bad-fan')", test: 'tests/core/printer-control.test.js' },
  { name: 'control: step not limited', file: 'src/core/printer-control.js', from: ' || Math.abs(step) > MAX_STEP)', to: ')', test: 'tests/core/printer-control.test.js' },
  { name: 'control: Z sign like X', file: 'src/core/printer-control.js', from: "return axis === 'Z' ? -step : step;", to: 'return step;', test: 'tests/core/printer-control.test.js' },
  { name: 'control: makeRequest skips the check', file: 'src/core/sdcp.js', from: 'try { Control.checkData(cmd, data); }', to: 'try { /* */ }', test: 'tests/core/printer-control.test.js' },
  { name: 'panel: jog enabled while printing', file: 'src/renderer/printer-panel.js', from: 'b.disabled = !move || controlBusy;', to: 'b.disabled = controlBusy;', app: 'tests/app/printer-panel.spec.js', grep: 'while printing jog' },
  { name: 'panel: heating without a yes', file: 'src/renderer/printer-panel.js', from: 'if (printing || v > 0) {', to: 'if (false) {', app: 'tests/app/printer-panel.spec.js', grep: 'heating after a yes' },
  { name: 'panel: old status after the link is lost', file: 'src/renderer/printer-panel.js', from: 'stopCamera(); showStatus(null); });', to: 'stopCamera(); });', app: 'tests/app/printer-panel.spec.js', grep: 'review B4' },
  { name: 'panel: texts stay on the old language', file: 'src/renderer/printer-panel.js', from: 'for (const id of msgs.keys()) paint(id);', to: '', app: 'tests/app/printer-panel.spec.js', grep: 'review B1' },
  { name: 'panel: long file name not cut', file: 'src/renderer/app.css', from: '#p-file { white-space: nowrap;', to: '#p-file { white-space: normal;', app: 'tests/app/printer-panel.spec.js', grep: 'review B2' },
  { name: 'panel: AI polling keeps running off the tab', file: 'src/renderer/printer-panel.js', from: 'if (aiTimer) { clearInterval(aiTimer); aiTimer = null; }', to: '', app: 'tests/app/printer-panel.spec.js', grep: 'review V3' },
  { name: 'ipc: print goes to the first printer found', file: 'electron/ipc.js', from: 'const host = settings.printerHost;', to: 'const host = settings.printerHost || ((await findPrinters())[0] || {}).host;', app: 'tests/app/printer-panel.spec.js', grep: 'review V2' },
  // Свежий обзор 0.2 (23.10): конфликт путей, зазор с поддержками, устаревший статус, вид.
  { name: 'engine: path conflict reported as failed', file: 'src/core/engine.js', from: "if (conflict) throw Object.assign(new EngineError('conflict', conflict[0]), { names: [conflict[1], conflict[2]] });", to: '', test: 'tests/core/engine.test.js' },
  { name: 'ipc: conflict names not turned into window names', file: 'electron/ipc.js', from: 'const names = e.names.map((n) => (plate.objects.find((o) => o.name === n) || {}).title || n);', to: 'const names = [];', app: 'tests/app/review-02.spec.js', grep: 'engine path conflict' },
  { name: 'editor: 6 mm between models with supports', file: 'src/renderer/prepare.js', from: "editor.spacing = () => (choice.supports !== 'none' || editor.painted() ? 12 : 6);", to: 'editor.spacing = () => 6;', app: 'tests/app/review-02.spec.js', grep: 'keep 12 mm' },
  { name: 'status: plate status outlives the plate change', file: 'src/renderer/prepare.js', from: "if (plate === true ? stale(status) : sliced && status.kind === 'ok') setStatus('');", to: "if (sliced && status.kind === 'ok') setStatus('');", app: 'tests/app/review-02.spec.js', grep: 'B1' },
  { name: 'panel: control cards in an auto-fit grid', file: 'src/renderer/app.css', from: '.pcontrol { display: flex; flex-wrap: wrap; gap: 12px; }', to: '.pcontrol { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 12px; }', app: 'tests/app/review-02.spec.js', grep: 'B2' },
  { name: 'panel: silent black camera box', file: 'src/renderer/printer-panel.js', from: "if ($('#camera').getAttribute('src')) cameraHint('printer.cameraLost');", to: '', app: 'tests/app/review-02.spec.js', grep: 'B3' },
  { name: 'light: pale green status', file: 'src/renderer/app.css', from: ':root[data-theme="light"] { --success: #08694f; }', to: '', app: 'tests/app/review-02.spec.js', grep: 'B4' },
  { name: 'light: see-through panels over the bed', file: 'src/renderer/app.css', from: ':root[data-theme="light"] .tool-panel, :root[data-theme="light"] .legend, :root[data-theme="light"] .toolbar { background: rgba(255, 255, 255, 0.9); }', to: '', app: 'tests/app/review-02.spec.js', grep: 'B4' },
  { name: 'layers: legend stretched to the bottom', file: 'src/renderer/app.css', from: 'top: 56px; max-height: calc(100% - 68px);', to: 'top: 56px; bottom: 12px;', app: 'tests/app/review-02.spec.js', grep: 'B5' },
  { name: 'tool panel: cut slider wider than the panel', file: 'src/renderer/app.css', from: '.tool-panel input[type="range"] { width: 100%; margin-left: 0; margin-right: 0; }', to: '.tool-panel input[type="range"] { width: 100%; }', app: 'tests/app/review-02.spec.js', grep: 'B6' },
  { name: 'novice: choice buttons wrap', file: 'src/renderer/app.css', from: '.choices button { flex: 1; min-width: 56px; padding-left: 8px; padding-right: 8px; white-space: nowrap; }', to: '.choices button { flex: 1; min-width: 56px; }', app: 'tests/app/review-02.spec.js', grep: 'B6' },
  { name: 'tool panel: cut label cut short', file: 'src/renderer/editor.js', from: "const row = h('div', 'tp-row tp-wide');", to: "const row = h('div', 'tp-row');", app: 'tests/app/review-02.spec.js', grep: 'B6' },
  // Независимая проверка 23.10 вечером: кисть, ластик, отмена, список моделей, выбор и групповое перетаскивание.
  { name: 'brush: old normals after the finer mesh', file: 'src/renderer/editor.js', from: "g.deleteAttribute('normal');", to: '', app: 'tests/app/review-03.spec.js', grep: 'keeps its shading - normals' },
  { name: 'brush: eraser does nothing', file: 'src/renderer/editor.js', from: 'for (const k of hit) inst.paint[k] = code;', to: 'for (const k of hit) if (code) inst.paint[k] = code;', app: 'tests/app/review-03.spec.js', grep: 'eraser' },
  { name: 'undo: Delete not undoable', file: 'src/renderer/editor.js', from: "['add', 'remove', 'removeOff',", to: "['add', 'removeOff',", app: 'tests/app/review-03.spec.js', grep: 'undo and redo plate' },
  { name: 'undo: Ctrl+Z by e.key (dead in the Russian layout)', file: 'src/renderer/prepare.js', from: "e.code === 'KeyZ') { e.preventDefault(); if", to: "e.key === 'z') { e.preventDefault(); if", app: 'tests/app/review-03.spec.js', grep: 'undo and redo plate' },
  { name: 'paint clear: all models without a question', file: 'src/renderer/editor.js', from: "if (this.confirm && !(await this.confirm('paint.clearAsk', { n: list.length }))) return false;", to: '', app: 'tests/app/review-03.spec.js', grep: 'brush "Clear"' },
  { name: 'advanced: reset without a question', file: 'src/renderer/advanced.js', from: "if (!(await ask(t('adv.resetAsk', { n }), t('adv.resetAsk.yes'), t('ask.no')))) return;", to: '', app: 'tests/app/review-03.spec.js', grep: 'same undo line' },
  { name: 'undo: novice choice not recorded', file: 'src/renderer/prepare.js', from: "History.pushChange('tempDelta' in patch ? 'choice.temp' : '', before, choice, applyChoice);", to: '', app: 'tests/app/review-03.spec.js', grep: 'same undo line' },
  { name: 'models list: no own scroll, runs under the panel', file: 'src/renderer/app.css', from: '.models { flex: 0 1 auto; min-height: 0; overflow-y: auto;', to: '.models { flex: none; overflow-y: visible;', app: 'tests/app/review-03.spec.js', grep: 'A3' },
  { name: 'view: turning the view clears the selection', file: 'src/renderer/scene.js', from: 'if (!m.add && e && Math.hypot(e.clientX - m.x, e.clientY - m.y) < 4)', to: 'if (!m.add)', app: 'tests/app/review-03.spec.js', grep: 'B1: turning' },
  { name: 'view: dragging moves only the grabbed model', file: 'src/renderer/scene.js', from: 'const keep = isSel(inst) && !add;', to: 'const keep = false;', app: 'tests/app/review-03.spec.js', grep: 'B2: dragging' },
  { name: 'print: failed step taken from the last event', file: 'src/renderer/prepare.js', from: "step: r.step || FAIL_STEP[r.code] || (sendState && sendState.step) || 'connect'", to: "step: 'connect'", app: 'tests/app/review-03.spec.js', grep: 'B3: a busy' },
  { name: 'send: cancel not checked while waiting for the list', file: 'src/core/send.js', from: "    if (signal && signal.aborted) throw new SendError('canceled');\n", to: '', test: 'tests/core/send.test.js' },
  { name: 'send: cancel before the start not checked', file: 'src/core/send.js', from: '    stop();                                 // последняя возможность', to: '    // последняя возможность', test: 'tests/core/send.test.js' },
  { name: 'ipc: cancel ignored', file: 'electron/ipc.js', from: 'if (sendCtl) sendCtl.abort();', to: '', app: 'tests/app/review-03.spec.js', grep: 'B4: waiting' },
  { name: 'print: silent wait for the file', file: 'src/renderer/prepare.js', from: "if (s.step === 'verify' && s.attempts) extra =", to: "if (false) extra =", app: 'tests/app/review-03.spec.js', grep: 'B4: waiting' },
  { name: 'actions: Slice above the growing part again', file: 'src/renderer/app.css', from: '.actions .status:empty { display: none; }', to: '.actions .status:empty { display: none; } .actions #slice { order: -1; }', app: 'tests/app/review-03.spec.js', grep: 'B5: Slice' },
  { name: 'print: leveling not shared with the Printer tab', file: 'src/renderer/printer-panel.js', from: "  onSettings((st) => { $('#bed-leveling').checked = !!st.bedLeveling; });", to: '', app: 'tests/app/review-03.spec.js', grep: 'B6: above Print' },
  { name: 'camera: dim note on the black box', file: 'src/renderer/app.css', from: '.camera .hint { color: #c9ced8;', to: '.camera .hint { color: var(--text-dim);', app: 'tests/app/review-03.spec.js', grep: 'B7: the camera' },
  { name: 'small window: no compact layout', file: 'src/renderer/app.css', from: '@media (max-height: 720px) {', to: '@media (max-height: 1px) {', app: 'tests/app/review-03.spec.js', grep: 'B8: the smallest' },
  { name: 'layers: view stays on the whole bed', file: 'src/renderer/prepare.js', from: '    editor.scene.fitBox(editor.platedBox());', to: '', app: 'tests/app/review-03.spec.js', grep: 'B9: after slicing' },
  { name: 'i18n: no plural forms', file: 'src/renderer/i18n.js', from: 'forms[d === 1 && h !== 11 ? 0 : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 1 : 2]', to: 'forms[2]', test: 'tests/core/i18n.test.js' },
  { name: 'panel: lone dash when the link is lost', file: 'src/renderer/printer-panel.js', from: "s ? d.state : t(lostOnce ? 'printer.noLink' : 'printer.notConnected')", to: 'd.state', app: 'tests/app/printer-panel.spec.js', grep: 'review B4' },
];

const filter = process.argv[2] || '';
let caught = 0, total = 0;
for (const m of MUTANTS) {
  if (filter && !m.name.includes(filter)) continue;
  total += 1;
  const file = path.join(ROOT, m.file);
  const orig = fs.readFileSync(file, 'utf8');
  const count = orig.split(m.from).length - 1;
  if (count !== 1) { console.log(`?? ${m.name}: pattern found ${count} times - fix the mutant`); continue; }
  try {
    fs.writeFileSync(file, orig.replace(m.from, m.to));
    const args = m.app
      ? [path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--config=playwright.app.config.js', '--workers=1', '--retries=0', m.app, '-g', m.grep]
      : ['--test', '--test-concurrency=1', m.test];
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
    if (r.status !== 0) { caught += 1; console.log(`ok  ${m.name}`); }
    else console.log(`!!  ${m.name}: tests stayed green`);
  } finally {
    fs.writeFileSync(file, orig);
  }
}
console.log(`${caught}/${total} mutants caught`);
process.exit(caught === total ? 0 : 1);

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
  { name: 'send: start retried after no answer', file: 'src/core/send.js', from: 'if (!started) throw new SendError(\'not-started\', { name });',
    to: 'if (!started) { await client.request(CMD.START, { Filename: remote, StartLayer: 0 }).catch(() => {}); throw new SendError(\'not-started\', { name }); }', test: 'tests/core/send.test.js' },
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
  { name: 'settings: any host accepted', file: 'src/core/settings.js', from: "if (s === '') return true;", to: 'return true;', test: 'tests/core/settings.test.js' },
  { name: 'settings: http:// not cut from the address', file: 'src/core/settings.js', from: ".replace(/^(?:https?|wss?):\\/\\//i, '')", to: '', test: 'tests/core/settings.test.js' },
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

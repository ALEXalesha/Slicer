// Проверка проверок: нарочно ломаем продукт в одном месте и ждём, что упадёт нужный тест.
// Мутант, после которого тесты зелёные, - дыра в законах. Файл всегда возвращается назад.
//   node tools/mutate.js            все мутанты
//   node tools/mutate.js send       только те, где в имени есть «send»
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
  { name: 'catalog: comma not turned into a dot', file: 'src/core/settings-catalog.js', from: "const v = s.replace(/,/g, '.')", to: 'const v = s', test: 'tests/core/settings-catalog.test.js' },
  { name: 'catalog: range not checked', file: 'src/core/settings-catalog.js', from: "if (!inRange(n, ty.min, ty.max)) return fail('range');", to: '', test: 'tests/core/settings-catalog.test.js' },
  { name: 'settings: invalid advanced value stored', file: 'src/core/settings.js', from: 'if (c.ok && c.value.length <= 500) out[k] = c.value;', to: 'out[k] = String(v);', test: 'tests/core/settings.test.js' },
  { name: 'settings: old flat filament edits lost', file: 'src/core/settings.js', from: 'const old = cleanEdits(legacy);', to: 'const old = {};', test: 'tests/core/settings.test.js' },
  { name: 'novice: filament edits shared by all filaments', file: 'src/core/novice.js', from: 'return plainObject(by[id]) || {};', to: 'return Object.assign({}, ...Object.values(by).filter(plainObject));', test: 'tests/core/novice.test.js' },
  { name: 'engine: bad setting reported as failed', file: 'src/core/engine.js', from: "if (key) throw Object.assign(new EngineError('bad-setting', why), { key });", to: '', test: 'tests/core/engine.test.js' },
  { name: 'settings: any host accepted', file: 'src/core/settings.js', from: "if (s === '') return true;", to: 'return true;', test: 'tests/core/settings.test.js' },
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
    const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', m.test], { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
    if (r.status !== 0) { caught += 1; console.log(`ok  ${m.name}`); }
    else console.log(`!!  ${m.name}: tests stayed green`);
  } finally {
    fs.writeFileSync(file, orig);
  }
}
console.log(`${caught}/${total} mutants caught`);
process.exit(caught === total ? 0 : 1);

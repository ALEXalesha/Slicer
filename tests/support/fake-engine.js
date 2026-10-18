// Поддельный движок: ведёт себя по FAKE_ENGINE (ok | slow | fail | empty | hang | bad-setting).
// bad-setting - как настоящий движок с неверным значением: причина в журнале 00000.log.
'use strict';
const fs = require('fs');
const path = require('path');
const mode = process.env.FAKE_ENGINE || 'ok';
const args = process.argv.slice(2);
const out = args[args.indexOf('--outputdir') + 1];
// slow - как ok, но через 3 с: для законов «поменяли во время нарезки».
if (mode === 'slow') { const t = Date.now() + 3000; while (Date.now() < t) { /* ждём */ } }
if (mode === 'bad-setting') {
  fs.writeFileSync('00000.log', 'Slic3r::ConfigBase::load_from_json: parse process.json got a generic exception, reason = Invalid value provided for parameter ' +
    (process.env.FAKE_BAD_KEY || 'layer_height') + ': abc\nSlic3r::CLI::run: Can not load config from file process.json\n');
  process.stdout.write('Slic3r::CLI::run found error, exit\n');
  process.exit(251);
}
if (mode === 'fail') { process.stdout.write('Slic3r::CLI::run found error, exit\n'); process.exit(127); }
if (mode === 'hang') setTimeout(() => {}, 1e9);
else {
  fs.mkdirSync(out, { recursive: true });
  const layers = mode === 'empty' ? 0 : 5;
  const models = args.filter((a) => /\.(stl|3mf|obj)$/i.test(a));
  fs.writeFileSync(path.join(out, 'plate_1.gcode'),
    '; HEADER_BLOCK_START\n; total layer number: ' + layers + '\n; HEADER_BLOCK_END\n' +
    models.map((m) => 'EXCLUDE_OBJECT_DEFINE NAME=' + m + '\n').join('') +
    'G1 X1 Y1\n; filament used [mm] = 100.5\n; filament used [g] = 0.30\n; total filament used [g] = 0.30\n' +
    '; estimated printing time (normal mode) = 2m 3s\n; CONFIG_BLOCK_START\n; nozzle_temperature = 210\n; CONFIG_BLOCK_END\n');
}

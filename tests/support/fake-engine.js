// Поддельный движок: ведёт себя по FAKE_ENGINE (ok | fail | empty | hang).
'use strict';
const fs = require('fs');
const path = require('path');
const mode = process.env.FAKE_ENGINE || 'ok';
const args = process.argv.slice(2);
const out = args[args.indexOf('--outputdir') + 1];
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

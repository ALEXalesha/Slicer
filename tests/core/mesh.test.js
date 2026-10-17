// Законы чтения моделей. Пункт 4 Алексея 17.10: «3MF не открывается» - 3MF из Elegoo/Orca/
// Bambu хранит сетки в 3D/Objects/*.model (расширение production) с матрицами у ссылок и у
// места на столе; three.js 3MFLoader этого не читал.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const fc = require('fast-check');
const { parseModel, parse3mf, parseStl, parseObj } = require('../../src/core/mesh');
const { writeZip } = require('../../src/core/zip');
const { bounds, multiply } = require('../../src/core/geom');
const { buildProject3mf } = require('../../src/core/project3mf');
const { cubeStl } = require('../support/models');
const { findEngine } = require('../../src/core/engine-locate');

const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const worldBounds = (o) => bounds(o.positions, o.matrix);

// Куб 2x2x2 вокруг нуля текстом 3MF.
const CUBE_V = '<vertices><vertex x="1" y="1" z="1"/><vertex x="-1" y="1" z="1"/><vertex x="-1" y="-1" z="1"/><vertex x="1" y="-1" z="1"/>' +
  '<vertex x="1" y="1" z="-1"/><vertex x="-1" y="1" z="-1"/><vertex x="-1" y="-1" z="-1"/><vertex x="1" y="-1" z="-1"/></vertices>';
const CUBE_T = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]];
const cubeMesh = (paintFirst = '') => `<mesh>${CUBE_V}<triangles>${CUBE_T.map((t, i) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"${i < 2 && paintFirst ? ` paint_supports="${paintFirst}"` : ''}/>`).join('')}</triangles></mesh>`;

/** 3MF в духе Bambu/Orca: корень со ссылками на 3D/Objects, модификатор в model_settings. */
function bambuLike({ printable = '1', unit = 'millimeter' } = {}) {
  const root = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <resources>
  <object id="2" type="model"><components>
   <component p:path="/3D/Objects/Rubik&apos;s part_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   <component p:path="/3D/Objects/Rubik&apos;s part_1.model" objectid="5" transform="1 0 0 0 1 0 0 0 1 0 0 3"/>
  </components></object>
  <object id="4" type="model"><components>
   <component p:path="/3D/Objects/second.model" objectid="3" transform="0 1 0 -1 0 0 0 0 1 0 0 0"/>
  </components></object>
 </resources>
 <build>
  <item objectid="2" transform="25 0 0 0 25 0 0 0 25 128 129 25" printable="${printable}"/>
  <item objectid="4" transform="1 0 0 0 2 0 0 0 3 40 50 3" printable="${printable}"/>
 </build>
</model>`;
  const part = `<?xml version="1.0" encoding="UTF-8"?><model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
  <object id="1" type="model">${cubeMesh('4')}</object>
  <object id="5" type="model">${cubeMesh()}</object>
 </resources><build/></model>`;
  const second = `<?xml version="1.0" encoding="UTF-8"?><model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
  <object id="3" type="model">${cubeMesh()}</object></resources><build/></model>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?><config>
  <object id="2"><metadata key="name" value="Кубик с модификатором"/><part id="1" subtype="normal_part"/><part id="5" subtype="modifier_part"/></object>
  <object id="4"><metadata key="name" value="second.stl"/><part id="3" subtype="normal_part"/></object>
</config>`;
  return writeZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: '_rels/.rels', data: '<Relationships><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: '3D/3dmodel.model', data: root },
    { name: "3D/Objects/Rubik's part_1.model", data: part },
    { name: '3D/Objects/second.model', data: second },
    { name: 'Metadata/model_settings.config', data: settings },
  ]);
}

test('3MF like Bambu/Orca: objects in 3D/Objects, transforms, names, modifier skipped, paint read', () => {
  const r = parse3mf(bambuLike(), { fileName: 'proj.3mf' });
  assert.strictEqual(r.objects.length, 2);
  const [a, b] = r.objects;
  assert.strictEqual(a.name, 'Кубик с модификатором');
  assert.strictEqual(a.positions.length, 12 * 9, 'modifier part is not geometry');
  assert.ok(r.warnings.includes('modifier_part'));
  const ba = worldBounds(a);
  assert.deepStrictEqual(ba.size.map((x) => Math.round(x)), [50, 50, 50]);           // куб 2 мм x25
  assert.deepStrictEqual(ba.min.map((x) => Math.round(x)), [103, 104, 0]);
  assert.ok(a.paint && a.paint[0] === 1 && a.paint[1] === 1 && a.paint[2] === 0);
  const bb = worldBounds(b);
  // поворот ссылки на 90° вокруг Z, затем масштаб места 1x2x3
  assert.deepStrictEqual(bb.size.map((x) => Math.round(x)), [2, 4, 6]);
  assert.deepStrictEqual(bb.min.map((x) => Math.round(x)), [39, 48, 0]);
});

test('3MF: units, only non-printable items are still opened', () => {
  const inch = parse3mf(bambuLike({ unit: 'inch' }));
  assert.ok(near(bounds(inch.objects[1].positions).size[2], 2 * 25.4));
  const hidden = parse3mf(bambuLike({ printable: '0' }));
  assert.strictEqual(hidden.objects.length, 2);
  assert.ok(hidden.warnings.includes('not-printable'));
});

test('3MF: broken archive or no model gives a coded error, not a crash', () => {
  assert.throws(() => parse3mf(Buffer.from('not a zip')), (e) => e.code === 'bad-3mf');
  assert.throws(() => parse3mf(writeZip([{ name: 'a.txt', data: 'x' }])), (e) => e.code === 'bad-3mf');
});

test('law: our 3MF for the engine reads back to the same triangles (paint kept, mirror keeps faces outward)', () => {
  fc.assert(fc.property(
    fc.array(fc.tuple(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 }), fc.integer({ min: 0, max: 50 })), { minLength: 1, maxLength: 4 }),
    fc.boolean(),
    (offsets, mirror) => {
      const objs = offsets.map(([x, y, z], i) => {
        const pos = parseStl(cubeStl(10 + i, [0, 0, 0]));
        const paint = new Uint8Array(12); paint[i % 12] = 1 + (i % 2);
        const m = multiply([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 120 + x, 120 + y, z, 1], mirror ? [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        return { name: 'o' + i, positions: pos, matrix: m, paint };
      });
      const back = parse3mf(buildProject3mf(objs)).objects;
      if (back.length !== objs.length) return false;
      return back.every((b, i) => {
        const want = bounds(objs[i].positions, objs[i].matrix);
        const got = bounds(b.positions, b.matrix);
        if (![0, 1, 2].every((k) => near(want.min[k], got.min[k], 1e-3) && near(want.max[k], got.max[k], 1e-3))) return false;
        if (!b.paint || b.paint[i % 12] !== 1 + (i % 2)) return false;
        // нормали наружу: объём по формуле дивергенции положительный
        let vol = 0;
        const p = b.positions;
        for (let t = 0; t < p.length; t += 9) {
          vol += (p[t] * (p[t + 4] * p[t + 8] - p[t + 5] * p[t + 7]) - p[t + 1] * (p[t + 3] * p[t + 8] - p[t + 5] * p[t + 6]) + p[t + 2] * (p[t + 3] * p[t + 7] - p[t + 4] * p[t + 6])) / 6;
        }
        return vol > 0;
      });
    }), { numRuns: 40 });
});

test('STL binary and ASCII, OBJ with quads and negative indices', () => {
  assert.strictEqual(parseStl(cubeStl(20)).length, 12 * 9);
  const ascii = 'solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n';
  assert.deepStrictEqual([...parseStl(Buffer.from(ascii))], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const obj = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1/1/1 2/2/2 3/3/3 4/4/4\nf -4 -3 -2\n';
  assert.strictEqual(parseObj(obj).length, 3 * 9);
  assert.throws(() => parseModel(Buffer.from('x'), 'a.step'), (e) => e.code === 'type');
});

const engine = findEngine();
// Настоящий 3MF движка: он сам пишет проект Orca (две модели, поворот 30°, масштаб 1.5,
// расстановка с поворотом - итог 30 и 45 мм по осям, центры там, где их поставил движок).
// Свой 3MF-проект движок с внешними настройками резать не может - падает (0xC0000005,
// замер 18.10), поэтому в движок идёт только наш 3MF, собранный из прочитанного. Закон:
// следы моделей в G-code (EXCLUDE_OBJECT_DEFINE POLYGON) совпадают с прочитанным.
test('real 3MF written by the ElegooSlicer engine: read, re-sliced through our 3MF at the same place', { skip: !engine && 'ElegooSlicer not installed' }, () => {
  const Presets = require('../../src/core/presets');
  const Novice = require('../../src/core/novice');
  const { prepareJob } = require('../../src/core/job');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicercc-3mf-'));
  fs.writeFileSync(path.join(dir, 'a.stl'), cubeStl(20));
  fs.writeFileSync(path.join(dir, 'b.stl'), cubeStl(30));
  execFileSync(engine.exe, ['--datadir', 'data', '--export-3mf', 'out.3mf', '--arrange', '1', '--rotate', '30', '--scale', '1.5', 'a.stl', 'b.stl'], { cwd: dir, windowsHide: true, stdio: 'pipe', timeout: 120000 });
  const file = fs.readFileSync(path.join(dir, 'out.3mf'));
  const r = parseModel(file, 'out.3mf');
  assert.strictEqual(r.objects.length, 2);
  assert.deepStrictEqual(r.objects.map((o) => o.name).sort(), ['a.stl', 'b.stl']);
  const root = require('../../src/core/zip').readZip(file).get('3D/3dmodel.model').toString('utf8');
  const centers = [...root.matchAll(/<item [^>]*transform="([^"]+)"/g)].map((m) => m[1].split(' ').slice(9, 11).map(Number));
  for (const o of r.objects) {
    const b = worldBounds(o);
    const size = Math.round(b.size[2]);
    assert.ok([30, 45].includes(size));
    assert.ok(near(b.size[0], size, 0.01) && near(b.size[1], size, 0.01), 'rotations of item and component combined');
    const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
    assert.ok(centers.some((e) => near(e[0], c[0], 0.01) && near(e[1], c[1], 0.01)), 'center where the engine placed it');
  }
  // прочитанное -> наш 3MF (модель на стол, z от нуля) -> движок
  const placed = r.objects.map((o) => {
    const b = worldBounds(o);
    return { name: o.name, positions: o.positions, matrix: multiply([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -b.min[2], 1], o.matrix) };
  });
  fs.writeFileSync(path.join(dir, 'ours.3mf'), buildProject3mf(placed));
  const idx = Presets.buildIndex(engine.profilesDir);
  const configs = Novice.composeConfigs(idx, { mode: 'novice', choice: {} });
  const job = path.join(dir, 'job');
  const { modelFiles } = prepareJob({ jobDir: job, models: [{ path: path.join(dir, 'ours.3mf'), name: 'ours' }], configs });
  fs.mkdirSync(path.join(job, 'out'));
  execFileSync(engine.exe, ['--datadir', 'data', '--slice', '0', '--load-settings', 'machine.json;process.json', '--load-filaments', 'filament.json', '--outputdir', 'out', '--arrange', '0', ...modelFiles], { cwd: job, windowsHide: true, stdio: 'pipe', timeout: 120000 });
  const g = fs.readFileSync(path.join(job, 'out', 'plate_1.gcode'), 'utf8');
  const engineBoxes = [...g.matchAll(/EXCLUDE_OBJECT_DEFINE .*POLYGON=(\[\[.*\]\])/g)].map((m) => {
    const pts = JSON.parse(m[1]);
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  }).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const ours = placed.map((o) => { const b = bounds(o.positions, o.matrix); return [b.min[0], b.min[1], b.max[0], b.max[1]]; }).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  assert.strictEqual(engineBoxes.length, 2);
  for (let i = 0; i < 2; i++) for (let k = 0; k < 4; k++) assert.ok(near(engineBoxes[i][k], ours[i][k], 1.01), `object ${i}: engine ${engineBoxes[i]} ours ${ours[i]}`);
});

// Настоящие файлы Алексея (Elegoo/Bambu/Orca, сотни штук): только чтение, на CI папки нет.
const REAL = 'C:\\Work\\3D\\All_3d\\3mf';
test('real 3MF files from Elegoo/Bambu/Orca open (read-only, local)', { skip: !fs.existsSync(REAL) && 'no local 3MF folder' }, () => {
  const files = fs.readdirSync(REAL).filter((f) => f.toLowerCase().endsWith('.3mf'))
    .map((f) => ({ f, size: fs.statSync(path.join(REAL, f)).size })).filter((x) => x.size < 3e6).slice(0, 80);
  assert.ok(files.length > 10);
  const bad = [];
  for (const { f } of files) {
    try {
      const r = parseModel(fs.readFileSync(path.join(REAL, f)), f);
      for (const o of r.objects) {
        const b = worldBounds(o);
        if (!b.size.every((s) => Number.isFinite(s) && s >= 0) || !o.positions.length) bad.push(f + ': bad bounds');
      }
    } catch (e) { bad.push(f + ': ' + e.message); }
  }
  assert.deepStrictEqual(bad, []);
});

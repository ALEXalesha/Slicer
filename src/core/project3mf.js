// 3MF для движка: все модели стола одним файлом, уже в координатах стола (поворот,
// масштаб, зеркало и место запечены в вершины), плюс раскраска поддержек. Движок режет его
// с --arrange 0 и ставит модели ровно туда, где они стоят в окне (замер 18.10: STL и 3MF
// с --arrange 0 печатаются на своих координатах).
//
// Раскраска поддержек - атрибут треугольника paint_supports (формат Bambu/Orca): "4" -
// поддержка обязательна, "8" - поддержка запрещена (весь треугольник целиком).
'use strict';
const { writeZip } = require('./zip');
const { applyMatrix, det3 } = require('./geom');

const PAINT_CODE = { 1: '4', 2: '8' };

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n';
const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (x) => {
  const r = Math.round(x * 1e5) / 1e5;
  return Object.is(r, -0) ? '0' : String(r);
};

/**
 * Одна модель: вершины в координатах стола, сшитые по совпадению (движку нужна связная
 * сетка, иначе он считает каждую грань отдельной).
 * @param {{name: string, positions: Float32Array|number[], matrix?: number[], paint?: Uint8Array|number[]}} obj
 */
function objectXml(id, obj) {
  const pos = obj.positions;
  const m = obj.matrix || null;
  const flip = m ? det3(m) < 0 : false;          // зеркало выворачивает грани - меняем порядок обхода
  const map = new Map();
  const verts = [];
  const tris = [];
  const p = [0, 0, 0];
  const vid = (i) => {
    p[0] = pos[i]; p[1] = pos[i + 1]; p[2] = pos[i + 2];
    const w = m ? applyMatrix(m, p) : p;
    const key = num(w[0]) + ' ' + num(w[1]) + ' ' + num(w[2]);
    let id2 = map.get(key);
    if (id2 === undefined) { id2 = verts.length; map.set(key, id2); verts.push(key); }
    return id2;
  };
  const triCount = Math.floor(pos.length / 9);
  for (let t = 0; t < triCount; t++) {
    const a = vid(t * 9), b = vid(t * 9 + 3), c = vid(t * 9 + 6);
    if (a === b || b === c || a === c) continue;            // вырожденная грань
    const paint = obj.paint ? PAINT_CODE[obj.paint[t]] : undefined;
    tris.push(flip ? [a, c, b, paint] : [a, b, c, paint]);
  }
  const out = [`  <object id="${id}" name="${esc(obj.name || 'model')}" type="model">\n   <mesh>\n    <vertices>\n`];
  for (const v of verts) {
    const [x, y, z] = v.split(' ');
    out.push(`     <vertex x="${x}" y="${y}" z="${z}"/>\n`);
  }
  out.push('    </vertices>\n    <triangles>\n');
  for (const [a, b, c, paint] of tris) out.push(`     <triangle v1="${a}" v2="${b}" v3="${c}"${paint ? ` paint_supports="${paint}"` : ''}/>\n`);
  out.push('    </triangles>\n   </mesh>\n  </object>\n');
  return { xml: out.join(''), triangles: tris.length };
}

/** Буфер 3MF со всеми моделями. */
function buildProject3mf(objects) {
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n',
    ' <metadata name="Application">Slicer CC</metadata>\n <resources>\n'];
  const items = [];
  objects.forEach((o, i) => {
    const r = objectXml(i + 1, o);
    if (!r.triangles) return;
    parts.push(r.xml);
    items.push(`  <item objectid="${i + 1}" printable="1"/>\n`);
  });
  parts.push(' </resources>\n <build>\n', ...items, ' </build>\n</model>\n');
  return writeZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: RELS },
    { name: '3D/3dmodel.model', data: parts.join('') },
  ]);
}

module.exports = { buildProject3mf, PAINT_CODE };

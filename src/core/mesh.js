// Чтение моделей в треугольники: STL (двоичный и текстовый), OBJ, 3MF.
//
// 3MF из Elegoo Slicer / Orca / Bambu Studio (замечание Алексея 17.10: «3MF не открывается»):
// сетки лежат не в 3D/3dmodel.model, а в 3D/Objects/*.model (расширение production,
// <component p:path=...>), у каждого объекта и у каждой ссылки своя матрица, у места на
// столе (build item) - ещё одна. Детали-модификаторы и блоки поддержек (model_settings.config,
// subtype не normal_part) - не тело модели, их не печатаем.
//
// Итог для окна: [{name, positions: Float32Array (9 чисел на треугольник, мм, без матрицы
// места), matrix: number[16] (место на столе, порядок three.js), paint: Uint8Array|null}].
'use strict';
const path = require('path');
const { readZip } = require('./zip');
const { identity, multiply, from3mf, applyMatrix, det3 } = require('./geom');

class MeshError extends Error {
  constructor(code, detail) { super(code + (detail ? ': ' + detail : '')); this.code = code; this.detail = detail || ''; }
}

const MAX_TRIANGLES = 30e6;
const UNITS = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

// ---------------------------------------------------------------- STL

function parseStl(buf) {
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (buf.length === 84 + n * 50) return stlBinary(buf, n);
  }
  const head = buf.toString('latin1', 0, Math.min(buf.length, 512)).trimStart();
  if (/^solid/i.test(head) && /facet/i.test(buf.toString('latin1', 0, Math.min(buf.length, 4096)))) return stlAscii(buf.toString('latin1'));
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (n > 0 && buf.length >= 84 + n * 50) return stlBinary(buf, n);      // хвост после граней бывает у старых программ
  }
  throw new MeshError('bad-stl');
}

function stlBinary(buf, n) {
  if (n > MAX_TRIANGLES) throw new MeshError('too-big', String(n));
  const pos = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    for (let k = 0; k < 9; k++) pos[t * 9 + k] = buf.readFloatLE(o + k * 4);
  }
  return pos;
}

function stlAscii(text) {
  const out = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let m;
  while ((m = re.exec(text))) out.push(Number(m[1]), Number(m[2]), Number(m[3]));
  const usable = out.length - (out.length % 9);
  if (!usable) throw new MeshError('bad-stl');
  return Float32Array.from(out.slice(0, usable));
}

// ---------------------------------------------------------------- OBJ

function parseObj(text) {
  const v = [];
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.slice(2).trim().split(/\s+/).map(Number);
      v.push([p[0] || 0, p[1] || 0, p[2] || 0]);
    } else if (line.startsWith('f ')) {
      const idx = line.slice(2).trim().split(/\s+/).map((s) => {
        const i = parseInt(s.split('/')[0], 10);
        return i < 0 ? v.length + i : i - 1;
      }).filter((i) => i >= 0 && i < v.length);
      for (let k = 1; k + 1 < idx.length; k++) out.push(...v[idx[0]], ...v[idx[k]], ...v[idx[k + 1]]);
    }
  }
  if (!out.length) throw new MeshError('bad-obj');
  return Float32Array.from(out);
}

// ---------------------------------------------------------------- 3MF

function attrs(s) {
  const o = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) o[m[1]] = m[3] !== undefined ? m[3] : m[4];
  return o;
}

const unxml = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Вершины и грани. Быстрый путь - атрибуты в обычном порядке (так пишут все слайсеры):
// модель на 50 МБ разбирается за секунды, а не за минуту.
function parseMesh(body, from) {
  let vs = new Float64Array(3 * 4096), nv = 0;
  const vEnd = body.indexOf('</vertices>', from);
  const vStop = vEnd < 0 ? body.length : vEnd;
  const fast = /<vertex\s+x\s*=\s*"([^"]*)"\s+y\s*=\s*"([^"]*)"\s+z\s*=\s*"([^"]*)"|<vertex\b([^>]*)>/g;
  fast.lastIndex = from;
  let v;
  while ((v = fast.exec(body)) && v.index < vStop) {
    let x, y, z;
    if (v[1] !== undefined) { x = +v[1]; y = +v[2]; z = +v[3]; } else { const a = attrs(v[4]); x = +a.x; y = +a.y; z = +a.z; }
    if (nv + 3 > vs.length) { const g = new Float64Array(vs.length * 2); g.set(vs); vs = g; }
    vs[nv++] = x; vs[nv++] = y; vs[nv++] = z;
  }
  let ts = new Uint32Array(3 * 4096), nt = 0;
  let paint = null;
  const tRe = /<triangle\s+v1\s*=\s*"(\d+)"\s+v2\s*=\s*"(\d+)"\s+v3\s*=\s*"(\d+)"([^>]*)>|<triangle\b([^>]*)>/g;
  tRe.lastIndex = vEnd >= 0 ? vEnd : from;
  let t;
  while ((t = tRe.exec(body))) {
    let a, b, c, rest;
    if (t[1] !== undefined) { a = +t[1]; b = +t[2]; c = +t[3]; rest = t[4]; } else { const ta = attrs(t[5]); a = +ta.v1; b = +ta.v2; c = +ta.v3; rest = t[5]; }
    if (nt + 3 > ts.length) { const g = new Uint32Array(ts.length * 2); g.set(ts); ts = g; if (paint) { const pg = new Uint8Array(ts.length / 3); pg.set(paint); paint = pg; } }
    if (rest && rest.indexOf('supports') >= 0) {
      const pm = /(?:paint_supports|slic3rpe:custom_supports)\s*=\s*"([^"]*)"/.exec(rest);
      const code = pm ? (pm[1] === '4' ? 1 : pm[1] === '8' ? 2 : 0) : 0;
      if (code) {
        if (!paint) paint = new Uint8Array(ts.length / 3);
        paint[nt / 3] = code;
      }
    }
    ts[nt++] = a; ts[nt++] = b; ts[nt++] = c;
    if (nt / 3 > MAX_TRIANGLES) throw new MeshError('too-big');
  }
  return { v: vs.subarray(0, nv), t: ts.subarray(0, nt), paint: paint ? paint.subarray(0, nt / 3) : null };
}

/** Все объекты одного файла .model: id -> {name, type, mesh?, components[]}; build; unit. */
function parseModelXml(xml) {
  const unitM = /<model\b[^>]*\bunit\s*=\s*"([^"]+)"/.exec(xml);
  const unit = UNITS[unitM ? unitM[1] : 'millimeter'] || 1;
  const objects = new Map();
  const objRe = /<object\b([^>]*?)(\/>|>([\s\S]*?)<\/object>)/g;
  let m;
  while ((m = objRe.exec(xml))) {
    const a = attrs(m[1]);
    const body = m[3] || '';
    const o = { id: a.id, name: unxml(a.name || ''), type: a.type || 'model', mesh: null, components: [] };
    const meshStart = body.indexOf('<mesh');
    if (meshStart >= 0) o.mesh = parseMesh(body, meshStart);
    const cRe = /<component\b([^>]*)>/g;
    let c;
    while ((c = cRe.exec(body))) {
      const ca = attrs(c[1]);
      o.components.push({ objectid: ca.objectid, path: unxml(ca['p:path'] || ''), transform: ca.transform ? from3mf(ca.transform) : identity() });
    }
    objects.set(String(o.id), o);
  }
  const build = [];
  const buildM = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(xml);
  if (buildM) {
    const iRe = /<item\b([^>]*)>/g;
    let it;
    while ((it = iRe.exec(buildM[1]))) {
      const ia = attrs(it[1]);
      build.push({ objectid: String(ia.objectid), path: unxml(ia['p:path'] || ''), transform: ia.transform ? from3mf(ia.transform) : identity(), printable: ia.printable !== '0' });
    }
  }
  return { unit, objects, build };
}

/** Детали из model_settings.config (Bambu/Orca): объект -> {name, parts: id -> subtype}. */
function parseModelSettings(xml) {
  const out = new Map();
  if (!xml) return out;
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let m;
  while ((m = objRe.exec(xml))) {
    const id = attrs(m[1]).id;
    const body = m[2];
    const nameM = /^\s*<metadata\s+key="name"\s+value="([^"]*)"/m.exec(body.split('<part')[0]);
    const parts = new Map();
    const pRe = /<part\b([^>]*)>/g;
    let p;
    while ((p = pRe.exec(body))) {
      const pa = attrs(p[1]);
      parts.set(String(pa.id), pa.subtype || 'normal_part');
    }
    out.set(String(id), { name: nameM ? unxml(nameM[1]) : '', parts });
  }
  return out;
}

function parse3mf(buf, { fileName = 'model.3mf' } = {}) {
  let files;
  try { files = readZip(buf); } catch (e) { throw new MeshError('bad-3mf', e.message); }
  const get = (p) => files.get(String(p).replace(/^\/+/, '')) || null;
  let rootPath = '3D/3dmodel.model';
  const rels = get('_rels/.rels');
  if (rels) {
    const r = /<Relationship\b[^>]*Target\s*=\s*"([^"]+)"[^>]*Type\s*=\s*"[^"]*3dmodel"/i.exec(rels.toString('utf8')) ||
      /<Relationship\b[^>]*Type\s*=\s*"[^"]*3dmodel"[^>]*Target\s*=\s*"([^"]+)"/i.exec(rels.toString('utf8'));
    if (r) rootPath = r[1].replace(/^\/+/, '');
  }
  if (!get(rootPath)) {
    const any = [...files.keys()].find((k) => /^3D\/[^/]+\.model$/i.test(k));
    if (!any) throw new MeshError('bad-3mf', 'no 3D model inside');
    rootPath = any;
  }
  const cache = new Map();
  const model = (p) => {
    const key = String(p).replace(/^\/+/, '');
    if (!cache.has(key)) {
      const data = get(key);
      cache.set(key, data ? parseModelXml(data.toString('utf8')) : null);
    }
    return cache.get(key);
  };
  const settingsFile = get('Metadata/model_settings.config') || get('Metadata/Slic3r_PE_model.config');
  const settings = parseModelSettings(settingsFile ? settingsFile.toString('utf8') : '');
  const root = model(rootPath);
  if (!root) throw new MeshError('bad-3mf', 'no root model');

  const warnings = new Set();
  // Сетка объекта со всеми вложенными деталями, в координатах объекта (мм). Куски -
  // типизированные массивы: обычный массив чисел на моделях в миллионы граней - минуты и гигабайты.
  const collect = (filePath, id, m, depth, skipParts, out) => {
    if (depth > 16) throw new MeshError('bad-3mf', 'components nested too deep');
    const mdl = model(filePath);
    const obj = mdl && mdl.objects.get(String(id));
    if (!obj) { warnings.add('missing-object'); return; }
    if (obj.mesh) {
      const mm = mdl.unit !== 1 ? multiply(m, [mdl.unit, 0, 0, 0, 0, mdl.unit, 0, 0, 0, 0, mdl.unit, 0, 0, 0, 0, 1]) : m;
      const { v, t, paint } = obj.mesh;
      const flip = det3(mm) < 0;
      const nv = v.length / 3;
      const pos = new Float32Array(t.length * 3);
      const pt = new Uint8Array(t.length / 3);
      let n = 0;
      for (let i = 0; i + 2 < t.length; i += 3) {
        const a = t[i], b = flip ? t[i + 2] : t[i + 1], c = flip ? t[i + 1] : t[i + 2];
        if (!(a < nv && b < nv && c < nv)) continue;
        const w = (k, o) => {
          const x = v[k * 3], y = v[k * 3 + 1], z = v[k * 3 + 2];
          pos[o] = mm[0] * x + mm[4] * y + mm[8] * z + mm[12];
          pos[o + 1] = mm[1] * x + mm[5] * y + mm[9] * z + mm[13];
          pos[o + 2] = mm[2] * x + mm[6] * y + mm[10] * z + mm[14];
        };
        w(a, n * 9); w(b, n * 9 + 3); w(c, n * 9 + 6);
        pt[n] = paint ? paint[i / 3] : 0;
        n++;
      }
      out.push({ pos: pos.subarray(0, n * 9), paint: pt.subarray(0, n) });
    }
    for (const c of obj.components) {
      const sub = skipParts && skipParts.get(String(c.objectid));
      if (sub && sub !== 'normal_part') { warnings.add(sub); continue; }
      collect(c.path || filePath, c.objectid, multiply(m, c.transform), depth + 1, null, out);
    }
  };

  const base = path.basename(fileName).replace(/\.3mf$/i, '');
  const objects = [];
  const items = root.build.length ? root.build : [...root.objects.keys()].map((id) => ({ objectid: id, path: '', transform: identity(), printable: true }));
  // Bambu помечает printable="0" модели вне пластин; если печатных нет совсем - берём все.
  const anyPrintable = items.some((it) => it.printable);
  if (!anyPrintable) warnings.add('not-printable');
  items.forEach((it, n) => {
    if (anyPrintable && !it.printable) return;
    const filePath = it.path || rootPath;
    const obj = model(filePath) && model(filePath).objects.get(it.objectid);
    if (!obj || (obj.type && obj.type !== 'model')) return;
    const st = settings.get(String(it.objectid));
    const chunks = [];
    collect(filePath, it.objectid, identity(), 0, st ? st.parts : null, chunks);
    const total = chunks.reduce((s, c) => s + c.pos.length, 0);
    if (!total) return;
    const positions = new Float32Array(total);
    const paint = new Uint8Array(total / 9);
    let o = 0;
    for (const c of chunks) { positions.set(c.pos, o); paint.set(c.paint, o / 9); o += c.pos.length; }
    const name = (st && st.name) || obj.name || (items.length > 1 ? base + '_' + (n + 1) : base);
    objects.push({ name, positions, matrix: it.transform, paint: paint.some(Boolean) ? paint : null });
  });
  if (!objects.length) throw new MeshError('empty', 'no printable objects');
  return { objects, warnings: [...warnings] };
}

/** Модель с диска в объекты для стола. */
function parseModel(buf, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const base = path.basename(fileName);
  if (ext === '.stl') return { objects: [{ name: base, positions: parseStl(buf), matrix: identity(), paint: null }], warnings: [] };
  if (ext === '.obj') return { objects: [{ name: base, positions: parseObj(buf.toString('utf8')), matrix: identity(), paint: null }], warnings: [] };
  if (ext === '.3mf') return parse3mf(buf, { fileName: base });
  throw new MeshError('type', ext);
}

module.exports = { parseModel, parseStl, parseObj, parse3mf, parseModelXml, parseModelSettings, MeshError, UNITS };

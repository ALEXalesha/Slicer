// Законы редактора моделей (пункты 2 и 3 Алексея): разрез, «положить гранью», кисть
// поддержек, расстановка по столу. Модуль окна - ES, грузим его здесь через import().
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const fc = require('fast-check');
const { parseStl } = require('../../src/core/mesh');
const { cubeStl } = require('../support/models');

let M, THREE;
test.before(async () => {
  M = await import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'renderer', 'mesh-ops.js')).href);
  THREE = await import('three');
});
const tri = (c, h) => THREE.ShapeUtils.triangulateShape(c.map((p) => new THREE.Vector2(p.x, p.y)), h.map((x) => x.map((p) => new THREE.Vector2(p.x, p.y))));
const cube = (s, off = [0, 0, 0]) => parseStl(cubeStl(s, off));
const near = (a, b, eps) => Math.abs(a - b) <= eps;

function invert(pos) {               // грани внутрь - полость
  const out = Float32Array.from(pos);
  for (let t = 0; t < out.length; t += 9) for (let k = 0; k < 3; k++) { const a = out[t + 3 + k]; out[t + 3 + k] = out[t + 6 + k]; out[t + 6 + k] = a; }
  return out;
}
function concat(...arrs) { const out = new Float32Array(arrs.reduce((s, a) => s + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; }

test('cut a cube: two closed parts, volumes add up, caps face outwards', () => {
  const r = M.cutMesh(cube(20), 7, tri);
  assert.strictEqual(r.open, 0);
  assert.ok(near(M.volume(r.below), 20 * 20 * 7, 0.05), 'below ' + M.volume(r.below));
  assert.ok(near(M.volume(r.above), 20 * 20 * 13, 0.05), 'above ' + M.volume(r.above));
  assert.strictEqual(r.belowPaint.length, r.below.length / 9);
});

test('cut through a hollow box: the cap has a hole (volume = outer - inner)', () => {
  const hollow = concat(cube(30), invert(cube(10, [10, 10, 10])));
  const r = M.cutMesh(hollow, 15, tri);
  assert.strictEqual(r.open, 0);
  assert.ok(near(M.volume(r.below), 30 * 30 * 15 - 10 * 10 * 5, 0.1), 'below ' + M.volume(r.below));
  assert.ok(near(M.volume(r.above), 30 * 30 * 15 - 10 * 10 * 5, 0.1), 'above ' + M.volume(r.above));
});

test('law: any cut height through any box keeps the total volume and closes both parts', () => {
  fc.assert(fc.property(fc.integer({ min: 5, max: 60 }), fc.double({ min: 0.05, max: 0.95, noNaN: true }), (s, f) => {
    const pos = cube(s);
    const r = M.cutMesh(pos, s * f, tri);
    return r.open === 0 && near(M.volume(r.below) + M.volume(r.above), s ** 3, s ** 3 * 1e-4) && M.volume(r.below) > 0 && M.volume(r.above) > 0;
  }), { numRuns: 60 });
});

test('cut exactly through vertices (z = 0 of the top face) does not break the mesh', () => {
  const r = M.cutMesh(cube(20), 20 - 1e-7, tri);
  assert.ok(r.open === 0);
  const r2 = M.cutMesh(cube(20), 10, tri, new Uint8Array(12).fill(1));
  assert.ok([...r2.belowPaint].includes(1) && [...r2.belowPaint].includes(0), 'paint follows the pieces, caps unpainted');
});

function pyramid() {
  const b = [[-10, -10, 0], [10, -10, 0], [10, 10, 0], [-10, 10, 0]], top = [0, 0, 30];
  const tris = [[b[0], b[2], b[1]], [b[0], b[3], b[2]], [b[0], b[1], top], [b[1], b[2], top], [b[2], b[3], top], [b[3], b[0], top]];
  return Float32Array.from(tris.flat(2));
}

test('law: lay flat finds the base of a pyramid however it is rotated', () => {
  fc.assert(fc.property(fc.double({ min: -3, max: 3, noNaN: true }), fc.double({ min: -3, max: 3, noNaN: true }), fc.double({ min: -3, max: 3, noNaN: true }), (a, b, c) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(a, b, c));
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    const p = pyramid();
    const v = new THREE.Vector3();
    for (let i = 0; i < p.length; i += 3) { v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(m); p[i] = v.x; p[i + 1] = v.y; p[i + 2] = v.z; }
    const n = M.largestFlatNormal(p);
    const want = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    return n && near(n[0], want.x, 1e-3) && near(n[1], want.y, 1e-3) && near(n[2], want.z, 1e-3);
  }), { numRuns: 50 });
});

test('brush picks triangles near the point only; subdivision keeps the shape and gives a fine brush', () => {
  const pos = cube(20);
  const top = M.trianglesInSphere(pos, [10, 10, 20], 3);
  assert.ok(top.length >= 1);
  for (const t of top) assert.ok([pos[t * 9 + 2], pos[t * 9 + 5], pos[t * 9 + 8]].every((z) => z === 20));
  assert.deepStrictEqual(M.trianglesInSphere(pos, [100, 100, 100], 5), []);
  const paint = new Uint8Array(12); paint[0] = 2;
  const fine = M.subdivideForBrush(pos, paint);
  assert.ok(near(M.volume(fine.positions), 8000, 0.01));
  assert.strictEqual(fine.paint.length, fine.positions.length / 9);
  assert.ok(fine.paint.filter((x) => x === 2).length === fine.paint.length / 12, 'paint follows its pieces');
  const area = (ts) => ts.length;
  const picked = M.trianglesInSphere(fine.positions, [10, 10, 20], 3);
  const faceTop = fine.positions.length / 9 / 6;      // треугольников на одну грань куба
  assert.ok(area(picked) > 0 && area(picked) < faceTop / 4, 'a 3 mm brush paints a small spot, not the whole face');
});

test('law: arrange never overlaps and keeps every placed model on the bed', () => {
  fc.assert(fc.property(fc.array(fc.record({ w: fc.integer({ min: 2, max: 270 }), d: fc.integer({ min: 2, max: 270 }) }), { minLength: 1, maxLength: 25 }), (sizes) => {
    const { centers, overflow } = M.arrange(sizes);
    const rects = sizes.map((s, i) => ({ x0: centers[i].x - s.w / 2, x1: centers[i].x + s.w / 2, y0: centers[i].y - s.d / 2, y1: centers[i].y + s.d / 2 }));
    for (let i = 0; i < sizes.length; i++) {
      const r = rects[i];
      const on = r.x0 >= 0 && r.y0 >= 0 && r.x1 <= M.BED && r.y1 <= M.BED;
      if (overflow.includes(i) === on) return false;           // не влезшие - не на столе, влезшие - на столе
      for (let j = 0; j < i; j++) {
        const o = rects[j];
        if (r.x0 < o.x1 && o.x0 < r.x1 && r.y0 < o.y1 && o.y0 < r.y1) return false;
      }
    }
    return true;
  }), { numRuns: 200 });
});

test('ten 90 mm cubes: four fit, six are reported (reviewer A1)', () => {
  const r = M.arrange(Array.from({ length: 10 }, () => ({ w: 90, d: 90 })));
  assert.strictEqual(r.overflow.length, 6);
});

test('free spot avoids models already on the bed', () => {
  const taken = [{ min: [100, 100, 0], max: [156, 156, 20] }];
  const s = M.freeSpot({ w: 30, d: 30 }, taken);
  assert.ok(s && (s.x + 15 + 6 <= 100 || s.x - 15 - 6 >= 156 || s.y + 15 + 6 <= 100 || s.y - 15 - 6 >= 156));
  assert.strictEqual(M.freeSpot({ w: 300, d: 30 }, []), null);
});

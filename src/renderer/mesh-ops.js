// Действия над сеткой и столом без three.js и без окна: разрезать, найти грань для
// «положить на стол», выбрать треугольники кистью поддержек, разложить модели по столу.
// Проверяются в node (tests/core/mesh-ops.test.js), окно только вызывает.
//
// Сетка - треугольники подряд: Float32Array, 9 чисел на треугольник.

export const BED = 256;

/** Нормаль и площадь каждого треугольника. */
export function faceInfo(pos) {
  const n = pos.length / 9;
  const normals = new Float32Array(n * 3);
  const areas = new Float32Array(n);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    areas[t] = len / 2;
    if (len > 0) { nx /= len; ny /= len; nz /= len; }
    normals[t * 3] = nx; normals[t * 3 + 1] = ny; normals[t * 3 + 2] = nz;
  }
  return { normals, areas };
}

/**
 * Грань, на которую модель лучше всего лечь: самая большая по площади плоская группа
 * треугольников (одна нормаль) из тех, что лежат на краю модели в своём направлении -
 * не внутренняя полость. Возвращает нормаль в координатах сетки или null.
 */
export function largestFlatNormal(pos) {
  const { normals, areas } = faceInfo(pos);
  const groups = new Map();
  const n = areas.length;
  for (let t = 0; t < n; t++) {
    if (!(areas[t] > 0)) continue;
    const nx = normals[t * 3], ny = normals[t * 3 + 1], nz = normals[t * 3 + 2];
    const key = Math.round(nx * 200) + ',' + Math.round(ny * 200) + ',' + Math.round(nz * 200);
    // насколько далеко грань в направлении своей нормали
    const d = pos[t * 9] * nx + pos[t * 9 + 1] * ny + pos[t * 9 + 2] * nz;
    let g = groups.get(key);
    if (!g) { g = { n: [0, 0, 0], area: 0, dMax: -Infinity, byD: new Map() }; groups.set(key, g); }
    g.n[0] += nx * areas[t]; g.n[1] += ny * areas[t]; g.n[2] += nz * areas[t];
    const dk = Math.round(d * 20);
    g.byD.set(dk, (g.byD.get(dk) || 0) + areas[t]);
  }
  let best = null, bestArea = 0;
  for (const g of groups.values()) {
    const len = Math.hypot(...g.n);
    if (!len) continue;
    const dir = g.n.map((x) => x / len);
    // крайняя плоскость модели в этом направлении
    let extreme = -Infinity;
    for (let i = 0; i < pos.length; i += 3) extreme = Math.max(extreme, pos[i] * dir[0] + pos[i + 1] * dir[1] + pos[i + 2] * dir[2]);
    let area = 0;
    for (const [dk, a] of g.byD) if (Math.abs(dk / 20 - extreme) < 0.11) area += a;
    if (area > bestArea) { bestArea = area; best = dir; }
  }
  return best;
}

// Квадрат расстояния от точки до треугольника (ближайшая точка, Ericson, «Real-Time
// Collision Detection» 5.1.5).
function dist2ToTriangle(p, pos, o) {
  const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
  const abx = pos[o + 3] - ax, aby = pos[o + 4] - ay, abz = pos[o + 5] - az;
  const acx = pos[o + 6] - ax, acy = pos[o + 7] - ay, acz = pos[o + 8] - az;
  const apx = p[0] - ax, apy = p[1] - ay, apz = p[2] - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  const at = (s, t) => { qx = ax + abx * s + acx * t; qy = ay + aby * s + acy * t; qz = az + abz * s + acz * t; };
  if (d1 <= 0 && d2 <= 0) at(0, 0);
  else {
    const bpx = p[0] - pos[o + 3], bpy = p[1] - pos[o + 4], bpz = p[2] - pos[o + 5];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = p[0] - pos[o + 6], cpy = p[1] - pos[o + 7], cpz = p[2] - pos[o + 8];
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) at(1, 0);
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) at(d1 / (d1 - d3), 0);
    else if (d6 >= 0 && d5 <= d6) at(0, 1);
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) at(0, d2 / (d2 - d6));
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); at(1 - w, w); }
    else { const den = 1 / (va + vb + vc); at(vb * den, vc * den); }
  }
  return (qx - p[0]) ** 2 + (qy - p[1]) ** 2 + (qz - p[2]) ** 2;
}

/** Треугольники, которых касается шар кисти радиуса r с центром p (координаты сетки). */
export function trianglesInSphere(pos, p, r) {
  const out = [];
  const r2 = r * r;
  for (let t = 0, o = 0; o < pos.length; t++, o += 9) if (dist2ToTriangle(p, pos, o) <= r2) out.push(t);
  return out;
}

/**
 * Мелкие треугольники для кисти: у куба грань - два треугольника, и кисть красила бы всю
 * грань. Делим каждый треугольник на 4 по серединам рёбер - соседние делятся одинаково,
 * сетка остаётся замкнутой (без Т-стыков). Делим, пока длинные рёбра длиннее maxEdge и
 * треугольников меньше maxTris. Раскраска переходит к четвертинкам.
 */
export function subdivideForBrush(pos, paint = null, { maxEdge = 3, maxTris = 300000 } = {}) {
  let p = pos, pt = paint || new Uint8Array(pos.length / 9);
  const longest = (a) => {
    let m = 0;
    for (let o = 0; o < a.length; o += 9) {
      for (const [i, j] of [[0, 3], [3, 6], [6, 0]]) m = Math.max(m, (a[o + i] - a[o + j]) ** 2 + (a[o + i + 1] - a[o + j + 1]) ** 2 + (a[o + i + 2] - a[o + j + 2]) ** 2);
    }
    return Math.sqrt(m);
  };
  // делим, пока самое длинное ребро велико: и пока в среднем треугольник крупный
  for (let guard = 0; guard < 8 && (p.length / 9) * 4 <= maxTris && longest(p) > maxEdge; guard++) {
    const n = p.length / 9;
    const out = new Float32Array(n * 36);
    const op = new Uint8Array(n * 4);
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      const a = [p[o], p[o + 1], p[o + 2]], b = [p[o + 3], p[o + 4], p[o + 5]], c = [p[o + 6], p[o + 7], p[o + 8]];
      const mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2];
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      out.set([...a, ...ab, ...ca, ...ab, ...b, ...bc, ...ca, ...bc, ...c, ...ab, ...bc, ...ca], t * 36);
      op.fill(pt[t], t * 4, t * 4 + 4);
    }
    p = out; pt = op;
  }
  return { positions: p, paint: pt };
}

// ---------------------------------------------------------------- разрез

const key2 = (x, y) => Math.round(x * 1e4) + ',' + Math.round(y * 1e4);

function signedArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function inside(pt, loop) {
  let c = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/**
 * Разрезать сетку плоскостью z = h (координаты стола). Обе части закрываются крышкой по
 * срезу. triangulate(contour, holes) -> [[i,j,k]...] (THREE.ShapeUtils.triangulateShape),
 * точки - {x, y}, индексы - по контуру, затем по дыркам подряд.
 * @returns {{below: Float32Array, above: Float32Array, belowPaint: Uint8Array, abovePaint: Uint8Array, open: number}}
 *   open - сколько контуров среза не замкнулись (сетка с дырами): их крышкой не закрыть.
 */
export function cutMesh(pos, h, triangulate, paint = null) {
  // Вершина ровно на плоскости даёт вырожденные отрезки: сдвигаем плоскость на волосок.
  for (let guard = 0; guard < 8; guard++) {
    let touch = false;
    for (let i = 2; i < pos.length; i += 3) if (Math.abs(pos[i] - h) < 1e-5) { touch = true; break; }
    if (!touch) break;
    h += 1.7e-4;
  }
  const below = [], above = [], bp = [], ap = [];
  const segs = [];
  // Точка на ребре считается одинаково для обоих соседних треугольников: от меньшей вершины.
  const cross = (ax, ay, az, bx, by, bz) => {
    if (az > bz || (az === bz && (ax > bx || (ax === bx && ay > by)))) { [ax, ay, az, bx, by, bz] = [bx, by, bz, ax, ay, az]; }
    const t = (h - az) / (bz - az);
    return [ax + (bx - ax) * t, ay + (by - ay) * t, h];
  };
  const n = pos.length / 9;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const v = [[pos[o], pos[o + 1], pos[o + 2]], [pos[o + 3], pos[o + 4], pos[o + 5]], [pos[o + 6], pos[o + 7], pos[o + 8]]];
    const s = v.map((p) => p[2] > h);
    const cnt = s.filter(Boolean).length;
    const pt = paint ? paint[t] : 0;
    if (cnt === 3) { above.push(...v[0], ...v[1], ...v[2]); ap.push(pt); continue; }
    if (cnt === 0) { below.push(...v[0], ...v[1], ...v[2]); bp.push(pt); continue; }
    // одна вершина по одну сторону, две - по другую; повернём так, что одиночка - v[i]
    const lone = cnt === 1 ? s.indexOf(true) : s.indexOf(false);
    const a = v[lone], b = v[(lone + 1) % 3], c = v[(lone + 2) % 3];
    const ab = cross(...a, ...b), ac = cross(...a, ...c);
    const loneSide = cnt === 1 ? above : below, loneP = cnt === 1 ? ap : bp;
    const pairSide = cnt === 1 ? below : above, pairP = cnt === 1 ? bp : ap;
    loneSide.push(...a, ...ab, ...ac); loneP.push(pt);
    pairSide.push(...ab, ...b, ...c, ...ab, ...c, ...ac); pairP.push(pt, pt);
    segs.push([ab, ac]);
  }
  // Отрезки среза -> замкнутые контуры.
  const byKey = new Map();
  segs.forEach((sg, i) => {
    for (const end of [0, 1]) {
      const k = key2(sg[end][0], sg[end][1]);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push([i, end]);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  let open = 0;
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop = [{ x: segs[i][0][0], y: segs[i][0][1] }];
    let cur = segs[i][1];
    const startKey = key2(segs[i][0][0], segs[i][0][1]);
    let closed = false;
    for (let guard = 0; guard < segs.length + 2; guard++) {
      const k = key2(cur[0], cur[1]);
      if (k === startKey) { closed = true; break; }
      loop.push({ x: cur[0], y: cur[1] });
      const next = (byKey.get(k) || []).find(([j]) => !used[j]);
      if (!next) break;
      used[next[0]] = 1;
      cur = segs[next[0]][1 - next[1]];
    }
    if (closed && loop.length >= 3) loops.push(loop); else open++;
  }
  // Вложенность: чётная глубина - наружный контур, нечётная - дырка в ближайшем наружном.
  const depth = loops.map((l, i) => loops.filter((m, j) => j !== i && inside(l[0], m)).length);
  for (let i = 0; i < loops.length; i++) {
    if (depth[i] % 2) continue;
    const holes = loops.filter((l, j) => depth[j] === depth[i] + 1 && inside(l[0], loops[i]));
    const contour = loops[i];
    const pts = [contour, ...holes].flat();
    let faces;
    try { faces = triangulate(contour, holes); } catch { faces = []; }
    for (const f of faces) {
      const [p, q, r] = f.map((k) => pts[k]);
      if (!p || !q || !r) continue;
      const up = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) > 0;
      // крышка нижней части смотрит вверх, верхней - вниз
      const [u, w] = up ? [q, r] : [r, q];
      below.push(p.x, p.y, h, u.x, u.y, h, w.x, w.y, h); bp.push(0);
      above.push(p.x, p.y, h, w.x, w.y, h, u.x, u.y, h); ap.push(0);
    }
  }
  return { below: Float32Array.from(below), above: Float32Array.from(above), belowPaint: Uint8Array.from(bp), abovePaint: Uint8Array.from(ap), open };
}

/** Объём сетки (по формуле дивергенции): у замкнутой сетки с гранями наружу > 0. */
export function volume(pos) {
  let v = 0;
  for (let t = 0; t < pos.length; t += 9) {
    v += (pos[t] * (pos[t + 4] * pos[t + 8] - pos[t + 5] * pos[t + 7]) - pos[t + 1] * (pos[t + 3] * pos[t + 8] - pos[t + 5] * pos[t + 6]) +
      pos[t + 2] * (pos[t + 3] * pos[t + 7] - pos[t + 4] * pos[t + 6])) / 6;
  }
  return v;
}

// ---------------------------------------------------------------- расстановка

/**
 * Разложить прямоугольники следов моделей по столу полками от центра. Не влезшие ставятся
 * рядом со столом справа (их видно и они красные), список - в overflow.
 * @param {Array<{w: number, d: number}>} sizes
 * @returns {{centers: Array<{x: number, y: number}>, overflow: number[]}}
 */
export function arrange(sizes, { bed = BED, gap = 6, margin = 3 } = {}) {
  const order = sizes.map((s, i) => i).sort((a, b) => sizes[b].d - sizes[a].d || sizes[b].w - sizes[a].w);
  const usable = bed - 2 * margin;
  const rows = [];                  // {items: [i], w, d}
  const overflow = [];
  let usedD = 0;
  for (const i of order) {
    const s = sizes[i];
    if (s.w > usable || s.d > usable) { overflow.push(i); continue; }
    let row = rows.find((r) => r.w + gap + s.w <= usable && s.d <= r.d);
    if (!row) {
      if (usedD + (rows.length ? gap : 0) + s.d > usable) { overflow.push(i); continue; }
      row = { items: [], w: -gap, d: s.d };
      usedD += (rows.length ? gap : 0) + s.d;
      rows.push(row);
    }
    row.items.push(i);
    row.w += gap + s.w;
  }
  const centers = new Array(sizes.length);
  let y = bed / 2 + usedD / 2;      // сверху вниз, весь блок по центру стола
  for (const r of rows) {
    let x = bed / 2 - r.w / 2;
    for (const i of r.items) {
      centers[i] = { x: x + sizes[i].w / 2, y: y - sizes[i].d / 2 };
      x += sizes[i].w + gap;
    }
    y -= r.d + gap;
  }
  let oy = bed - sizes.length;      // не влезшие - столбиком справа от стола
  let ox = bed + 20;
  let colW = 0;
  oy = bed;
  for (const i of overflow) {
    const s = sizes[i];
    if (oy - s.d < 0 && colW) { ox += colW + gap; oy = bed; colW = 0; }
    centers[i] = { x: ox + s.w / 2, y: oy - s.d / 2 };
    oy -= s.d + gap;
    colW = Math.max(colW, s.w);
  }
  return { centers, overflow };
}

/** Прямоугольник следа целиком на столе (с допуском на округление). */
export function onBed(min, max, bed = BED, eps = 0.01) {
  return min[0] >= -eps && min[1] >= -eps && max[0] <= bed + eps && max[1] <= bed + eps && max[2] <= bed + eps;
}

/** Свободное место для новой модели среди уже стоящих (следы {min,max}), или null. */
export function freeSpot(size, taken, { bed = BED, gap = 6, step = 4 } = {}) {
  const fits = (x, y) => taken.every((r) => x + size.w / 2 + gap <= r.min[0] || x - size.w / 2 - gap >= r.max[0] ||
    y + size.d / 2 + gap <= r.min[1] || y - size.d / 2 - gap >= r.max[1]);
  // по спирали от центра стола: ближе к центру - лучше; сдвиг вбок дешевле, чем назад, - камера
  // смотрит спереди, и модель прямо за другой не видна (В10)
  const cands = [];
  for (let x = size.w / 2 + 3; x <= bed - size.w / 2 - 3; x += step) {
    for (let y = size.d / 2 + 3; y <= bed - size.d / 2 - 3; y += step) cands.push([x, y, (x - bed / 2) ** 2 + 4 * (y - bed / 2) ** 2]);
  }
  cands.sort((a, b) => a[2] - b[2]);
  for (const [x, y] of cands) if (fits(x, y)) return { x, y };
  return null;
}

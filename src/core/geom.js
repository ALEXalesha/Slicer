// Геометрия без three.js (ядро проверяется node:test): матрицы 4x4 в порядке three.js
// (по столбцам, elements), сетка - треугольники подряд, 9 чисел на треугольник.
'use strict';

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** a * b (сначала b, потом a). */
function multiply(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function applyMatrix(m, p) {
  const [x, y, z] = p;
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

function det3(m) {
  return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}

/** Матрица 3MF «m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32» (строка-вектор) -> elements. */
function from3mf(text) {
  const v = String(text || '').trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some((x) => !Number.isFinite(x))) return identity();
  return [v[0], v[1], v[2], 0, v[3], v[4], v[5], 0, v[6], v[7], v[8], 0, v[9], v[10], v[11], 1];
}

function transformPositions(pos, m) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  // Зеркало выворачивает грани: меняем местами 2-ю и 3-ю вершины.
  if (det3(m) < 0) {
    for (let t = 0; t < out.length; t += 9) {
      for (let k = 0; k < 3; k++) { const a = out[t + 3 + k]; out[t + 3 + k] = out[t + 6 + k]; out[t + 6 + k] = a; }
    }
  }
  return out;
}

function bounds(pos, m = null) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const p = [0, 0, 0];
  for (let i = 0; i < pos.length; i += 3) {
    p[0] = pos[i]; p[1] = pos[i + 1]; p[2] = pos[i + 2];
    const w = m ? applyMatrix(m, p) : p;
    for (let k = 0; k < 3; k++) { if (w[k] < min[k]) min[k] = w[k]; if (w[k] > max[k]) max[k] = w[k]; }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

module.exports = { identity, multiply, applyMatrix, det3, from3mf, transformPositions, bounds };

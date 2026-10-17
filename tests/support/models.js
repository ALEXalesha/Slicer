// Модели для тестов: двоичный STL куба заданного размера.
'use strict';
const fs = require('fs');

function cubeStl(size = 20, offset = [0, 0, 0]) {
  const [ox, oy, oz] = offset;
  const s = size;
  const v = [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]].map(([x, y, z]) => [x + ox, y + oy, z + oz]);
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const buf = Buffer.alloc(84 + f.length * 50);
  buf.writeUInt32LE(f.length, 80);
  f.forEach((tri, i) => {
    let o = 84 + i * 50 + 12;
    for (const idx of tri) for (const c of v[idx]) { buf.writeFloatLE(c, o); o += 4; }
  });
  return buf;
}

function writeCube(file, size, offset) {
  fs.writeFileSync(file, cubeStl(size, offset));
  return file;
}

module.exports = { cubeStl, writeCube };

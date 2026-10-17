// Значок программы кодом: скруглённый квадрат с градиентом Paint и три «слоя» печати
// сверху вниз - как нарезанная модель. Пишет assets/icon.png (256) и assets/icon.ico
// (PNG внутри ICO, 256/64/48/32/16).
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// Покрытие пикселя скруглённым прямоугольником (4x4 подвыборки - сглаживание краёв).
function cover(x, y, x0, y0, x1, y1, r) {
  let n = 0;
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
    const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
    if (px < x0 || px > x1 || py < y0 || py > y1) continue;
    const cx = Math.min(Math.max(px, x0 + r), x1 - r), cy = Math.min(Math.max(py, y0 + r), y1 - r);
    if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) n++;
  }
  return n / 16;
}

function pixel(x, y, s) {
  const k = s / 256;
  const bg = cover(x, y, 8 * k, 8 * k, 248 * k, 248 * k, 52 * k);
  if (!bg) return [0, 0, 0, 0];
  const t = (x + y) / (2 * s);
  let r = lerp(0x5b, 0x9d, t), g = lerp(0x8d, 0x5b, t), b = lerp(0xef, 0xef, t);
  // три слоя: ширина растёт книзу, как у нарезанной вазы
  const layers = [[78, 70, 178], [116, 56, 200], [154, 42, 214]];
  let w = 0;
  for (const [yy, x0, x1] of layers) w = Math.max(w, cover(x, y, x0 * k, yy * k, x1 * k, (yy + 26) * k, 9 * k));
  // сопло сверху
  w = Math.max(w, cover(x, y, 112 * k, 30 * k, 144 * k, 58 * k, 6 * k));
  r = lerp(r, 255, w); g = lerp(g, 255, w); b = lerp(b, 255, w);
  // плита снизу
  const plate = cover(x, y, 30 * k, 194 * k, 226 * k, 206 * k, 6 * k);
  r = lerp(r, 0x1a, plate * 0.8); g = lerp(g, 0x13, plate * 0.8); b = lerp(b, 0x30, plate * 0.8);
  return [r, g, b, Math.round(bg * 255)];
}

const dir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(dir, { recursive: true });
const sizes = [256, 64, 48, 32, 16];
const pngs = sizes.map((s) => png(s, pixel));
fs.writeFileSync(path.join(dir, 'icon.png'), pngs[0]);
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  head[e] = s === 256 ? 0 : s; head[e + 1] = s === 256 ? 0 : s; head[e + 2] = 0; head[e + 3] = 0;
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(pngs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([head, ...pngs]));
console.log('assets/icon.png, assets/icon.ico');

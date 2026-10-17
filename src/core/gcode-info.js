// Что показать человеку после нарезки и что проверить в законах: время, слои, граммы и
// настройки, которые движок пишет в конец G-code (`; ключ = значение`).
'use strict';

function parseDuration(s) {
  if (typeof s !== 'string') return null;
  let total = 0, found = false;
  const re = /(\d+(?:\.\d+)?)\s*([dhms])/g;
  let m;
  while ((m = re.exec(s))) {
    found = true;
    total += Number(m[1]) * { d: 86400, h: 3600, m: 60, s: 1 }[m[2]];
  }
  return found ? Math.round(total) : null;
}

function formatDuration(sec) {
  let s = Math.max(0, Math.round(sec));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return [d && d + 'd', (d || h) && h + 'h', (d || h || m) && m + 'm', s + 's'].filter((x) => x !== 0 && x !== '').join(' ');
}

function parseGcodeInfo(text) {
  const info = { layers: 0, timeSec: null, filamentMm: null, filamentG: null, settings: {} };
  if (typeof text !== 'string') return info;
  const head = text.slice(0, 4000);
  const lm = /; total layer number:\s*(\d+)/.exec(head);
  if (lm) info.layers = Number(lm[1]);
  const tail = text.slice(-200000);
  const tm = /; estimated printing time \(normal mode\) = ([^\r\n]+)/.exec(tail);
  if (tm) info.timeSec = parseDuration(tm[1]);
  const mm = /; filament used \[mm\] = ([\d.]+)/.exec(tail);
  if (mm) info.filamentMm = Number(mm[1]);
  const g = /; total filament used \[g\] = ([\d.]+)/.exec(tail) || /; filament used \[g\] = ([\d.]+)/.exec(tail);
  if (g) info.filamentG = Number(g[1]);
  const start = tail.lastIndexOf('; CONFIG_BLOCK_START');
  const end = tail.lastIndexOf('; CONFIG_BLOCK_END');
  if (start >= 0 && end > start) {
    for (const line of tail.slice(start, end).split(/\r?\n/)) {
      const m = /^; ([A-Za-z0-9_]+) = (.*)$/.exec(line);
      if (m) info.settings[m[1]] = m[2];
    }
  }
  if (!info.layers && info.settings.total_layers_count) info.layers = Number(info.settings.total_layers_count) || 0;
  return info;
}

module.exports = { parseGcodeInfo, parseDuration, formatDuration };

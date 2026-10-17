// Имена файлов. На принтер уходит имя только из [A-Za-z0-9_.-]: ElegooSlicer шлёт имена
// с пробелами и иероглифами (`ECC_0.4_旋转花瓶E_Generic PETG _0.2_4h20m.gcode`), а
// «не отображается на принтере» - одна из двух жалоб Алексея.
'use strict';

const RU = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

function translit(s) {
  let out = '';
  for (const ch of String(s)) {
    const low = ch.toLowerCase();
    if (RU[low] !== undefined) {
      const r = RU[low];
      out += ch !== low && r ? r[0].toUpperCase() + r.slice(1) : r;
    } else out += ch;
  }
  return out;
}

/** Безопасная основа имени: латиница, цифры, _ . -; без точек и _ по краям; '' если ничего не осталось. */
function safeBase(s, max = 50) {
  let b = translit(String(s == null ? '' : s).normalize('NFC'))
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '');
  if (b.length > max) b = b.slice(0, max).replace(/[._-]+$/g, '');
  return b;
}

function shortTime(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0 || n > 30 * 86400) return '';   // больше месяца - не время печати
  const total = Math.round(n / 60);
  const h = Math.floor(total / 60), m = total % 60;
  return h ? h + 'h' + m + 'm' : Math.max(1, m) + 'm';
}

/** Имя файла на принтере: `<модель>_<ФИЛАМЕНТ>_<время>.gcode`, не длиннее 60 символов. */
function printerFileName({ model, filament, timeSec } = {}) {
  const parts = [safeBase(String(model || '').replace(/\.(stl|3mf|obj)$/i, ''), 36) || 'model'];
  const fil = safeBase(filament, 8).toUpperCase();
  if (fil) parts.push(fil);
  const t = shortTime(timeSec);
  if (t) parts.push(t);
  let base = parts.join('_');
  if (base.length > 53) base = base.slice(0, 53).replace(/[._-]+$/g, '');
  return base + '.gcode';
}

module.exports = { translit, safeBase, printerFileName, shortTime };

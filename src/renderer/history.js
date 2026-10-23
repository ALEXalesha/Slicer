// Отмена и повтор (Ctrl+Z / Ctrl+Y) - одна лента на стол и настройки (обзор 23.10 А2).
// Запись - {undo(), redo(), merge?}: стол кладёт снимки моделей (editor.js), настройки -
// значения «до» и «после» (prepare.js, advanced.js). Подряд идущие правки одного ползунка
// (merge с тем же ключом быстрее чем за 1,5 с) - одна запись.
const LIMIT = 100;
const undoStack = [];
const redoStack = [];
const listeners = [];
let busy = false;

function notify() { for (const cb of listeners) cb(); }

export function onHistory(cb) { listeners.push(cb); }
export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
export function sizes() { return { undo: undoStack.length, redo: redoStack.length }; }
export function restoring() { return busy; }

export function push(entry) {
  if (busy) return;                     // отмена сама не пишет новых записей
  const last = undoStack[undoStack.length - 1];
  const now = Date.now();
  if (entry.merge && last && last.merge === entry.merge && now - last.time < 1500 && last.absorb) {
    last.absorb(entry);
    last.time = now;
  } else {
    entry.time = now;
    undoStack.push(entry);
    if (undoStack.length > LIMIT) undoStack.shift();
  }
  redoStack.length = 0;
  notify();
}

async function step(from, to, how) {
  if (busy || !from.length) return false;
  const e = from.pop();
  busy = true;
  try { await e[how](); } finally { busy = false; }
  to.push(e);
  notify();
  return true;
}

export const undo = () => step(undoStack, redoStack, 'undo');
export const redo = () => step(redoStack, undoStack, 'redo');

/** Правка настройки: apply(значение) ставит его обратно (и перерисовывает своё окно). */
export function pushChange(merge, before, after, apply) {
  const e = { kind: 'settings', merge, before, after };
  e.undo = () => apply(e.before);
  e.redo = () => apply(e.after);
  e.absorb = (n) => { e.after = n.after; };
  push(e);
}

export function clear() { undoStack.length = 0; redoStack.length = 0; notify(); }

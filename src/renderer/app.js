// Окно: вкладки, режим, тема, язык. Подготовка модели - prepare.js, принтер - printer-panel.js.
import { setLang, applyTexts } from './i18n.js';

const $ = (sel) => document.querySelector(sel);
let settings = null;
let ready = false;
const listeners = [];

export function onSettings(cb) { listeners.push(cb); if (settings) cb(settings); }
export function getSettings() { return settings; }
export async function patchSettings(patch) {
  settings = await window.slicer.settings.set(patch);
  for (const cb of listeners) cb(settings);
  return settings;
}

function applyTheme(theme) {
  if (theme === 'glass') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

function showView(view) {
  for (const b of document.querySelectorAll('.tabs .tab')) b.classList.toggle('active', b.dataset.view === view);
  $('#view-prepare').hidden = view !== 'prepare';
  $('#view-printer').hidden = view !== 'printer';
  $('#mode').style.visibility = view === 'prepare' ? 'visible' : 'hidden';
  document.dispatchEvent(new CustomEvent('slicer:view', { detail: view }));
}

function showMode(mode) {
  for (const b of document.querySelectorAll('#mode button')) b.classList.toggle('active', b.dataset.mode === mode);
  $('#novice').hidden = mode !== 'novice';
  $('#advanced').hidden = mode !== 'advanced';
  document.dispatchEvent(new CustomEvent('slicer:mode', { detail: mode }));
}

async function start() {
  settings = await window.slicer.settings.get();
  setLang(settings.lang);
  applyTexts();
  applyTheme(settings.theme);
  $('#theme').value = settings.theme;
  $('#lang').value = settings.lang;
  showMode(settings.mode);

  $('#theme').addEventListener('change', (e) => { applyTheme(e.target.value); patchSettings({ theme: e.target.value }); });
  $('#lang').addEventListener('change', async (e) => {
    setLang(e.target.value);
    applyTexts();
    await patchSettings({ lang: e.target.value });
    document.dispatchEvent(new CustomEvent('slicer:lang'));
  });
  for (const b of document.querySelectorAll('.tabs .tab')) b.addEventListener('click', () => showView(b.dataset.view));
  for (const b of document.querySelectorAll('#mode button')) {
    b.addEventListener('click', () => { showMode(b.dataset.mode); patchSettings({ mode: b.dataset.mode }); });
  }
  for (const cb of listeners) cb(settings);
  const parts = await Promise.allSettled([import('./prepare.js'), import('./printer-panel.js'), import('./advanced.js')]);
  for (const p of parts) if (p.status === 'rejected') console.error(p.reason);
  ready = true;
}

window.slicerApp = { ready: () => ready, showView, showMode };
start();

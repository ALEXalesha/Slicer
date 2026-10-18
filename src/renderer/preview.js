// Слои после нарезки (пункт 1 Алексея): ползунок слоя, легенда с цветами типов линий
// (стенки, заполнение, поддержки, перемещения...) и галочками, время по типам.
import { t, formatTime } from './i18n.js';

const $ = (s) => document.querySelector(s);
const GROUPS = ['walls', 'infill', 'support', 'adhesion', 'other', 'travel'];

export class Preview {
  constructor(scene) {
    this.scene = scene;
    this.data = null;
    this.visible = new Set(['outer', 'inner', 'overhang', 'sparse', 'solid', 'top', 'bottom', 'bridge', 'gap', 'ironing', 'support', 'supportIf', 'skirt', 'tower', 'custom']);
    $('#layer-top').addEventListener('input', () => this.apply());
    $('#layer-only').addEventListener('change', () => this.apply());
  }

  set(preview) {
    this.data = preview;
    this.scene.showLayers(preview);
    const n = preview.layers.length;
    const r = $('#layer-top');
    r.min = '1';
    r.max = String(Math.max(1, n));
    r.value = String(Math.max(1, n));
    this.legend();
    this.apply();
  }

  clear() {
    this.data = null;
    this.scene.clearLayers();
    $('#legend').textContent = '';
  }

  apply() {
    if (!this.data) return;
    const n = this.data.layers.length;
    const top = Math.max(1, Math.min(n, Number($('#layer-top').value) || n));
    const only = $('#layer-only').checked;
    this.scene.setLayerRange(only ? top - 1 : 0, top - 1, this.visible);
    const z = this.data.layers[top - 1] ? this.data.layers[top - 1].z : 0;
    $('#layer-label').textContent = t('pv.layer', { n: top, m: n, z: Math.round(z * 100) / 100 });
  }

  legend() {
    const box = $('#legend');
    box.textContent = '';
    if (!this.data) return;
    const total = this.data.kinds.filter((k) => k.id !== 'travel').reduce((s, k) => s + k.seconds, 0) || 1;
    for (const g of GROUPS) {
      const kinds = this.data.kinds.filter((k) => k.group === g && k.segments > 0);
      if (!kinds.length) continue;
      const head = document.createElement('div');
      head.className = 'lg-group';
      head.textContent = t('g.' + g);
      box.append(head);
      for (const k of kinds) {
        const row = document.createElement('label');
        row.className = 'lg-row';
        row.dataset.kind = k.id;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = this.visible.has(k.id);
        cb.addEventListener('change', () => { if (cb.checked) this.visible.add(k.id); else this.visible.delete(k.id); this.apply(); });
        const sw = document.createElement('i');
        sw.className = 'lg-sw';
        sw.style.background = k.color;
        const name = document.createElement('span');
        name.className = 'lg-name';
        name.textContent = t('k.' + k.id);
        name.title = name.textContent;
        const tm = document.createElement('small');
        tm.textContent = k.id === 'travel' ? '' : Math.round((k.seconds / total) * 100) + ' %';
        if (k.id !== 'travel') tm.title = formatTime(k.seconds);
        row.append(cb, sw, name, tm);
        box.append(row);
      }
    }
    if (this.data.truncated) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = t('pv.cut'); box.append(p); }
  }

  texts() { if (this.data) { this.legend(); this.apply(); } }
}

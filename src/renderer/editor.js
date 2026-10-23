// Редактор моделей на столе (пункты 2 и 3 Алексея 17.10, «как в Elegoo Slicer»):
// перетаскивание мышью, поворот и масштаб ручками и числами, «гранью на стол», зеркало,
// копии, выравнивание, расстановка, разрез, поддержки кистью. Здесь - состояние моделей
// и панель инструмента; картинка и мышь - scene.js, геометрия без окна - mesh-ops.js.
import { t } from './i18n.js';
import { Scene, THREE, BED } from './scene.js';
import * as Ops from './mesh-ops.js';
import * as History from './history.js';

const $ = (s) => document.querySelector(s);
const ICONS = {
  move: '<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
  scale: '<path d="M4 20h7v-7H4zM11 13l9-9M14 4h6v6"/>',
  face: '<path d="M3 20h18M7 16l5-10 5 10z"/>',
  cut: '<path d="M2 12h20M6 4v6M6 14v6M18 4v6M18 14v6"/>',
  paint: '<path d="M4 20c3 0 5-2 5-5l9-9-3-3-9 9c-3 0-5 2-5 5z"/>',
  arrange: '<path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/>',
  copy: '<path d="M8 8h12v12H8zM4 16V4h12"/>',
  delete: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

let uidSeq = 0;

export class Editor {
  constructor({ onChange, onStatus }) {
    this.onChange = onChange;          // модели или их место изменились - нарезка устарела
    this.onStatus = onStatus;          // (ключ, параметры, вид)
    this.items = [];                   // {uid, name, mesh, paint, fine}
    this.selected = new Set();
    this.tool = 'move';
    this.brush = { mode: 1, radius: 3 };
    this.cut = { z: null, flip: true };
    this.lock = true;
    // Зазор между моделями, мм. С поддержками 6 мм мало: деревья одной модели заходят на пути
    // другой, и движок отказывает (замер 23.10: Benchy и tee - 6 мм отказ, 10 мм уже режется).
    this.spacing = () => 6;
    this.depth = 0;                    // вложенность undoable: запись в историю - только внешняя
    this.pending = null;               // снимок до начала жеста мышью (перетаскивание, ручки, мазок)
    this.scene = new Scene($('#viewer'), {
      select: (inst, add) => this.select(inst, add),
      isSelected: (inst) => this.selected.has(inst.uid),
      // Б2: тянем за одну из выбранных - едут все выбранные.
      dragGroup: (inst) => (this.selected.has(inst.uid) ? this.sel().map((i) => i.mesh) : [inst.mesh]),
      gestureStart: () => this.begin(),
      transforming: (inst) => { if (inst) this.refreshPanel(true); },
      transformed: (list) => {
        for (const inst of [].concat(list || [])) if (inst) this.dropToBed(inst);
        this.changed();
        this.commit();
      },
      gestureEnd: () => this.commit(),
      pickFace: (inst, n) => this.undoable(() => { this.layOnNormal(inst, n); this.changed(); }),
      paint: (inst, p, first) => { if (first) this.begin(); this.paintAt(inst, p, first); },
      paintEnd: () => { this.changed(); this.commit(); },
      brushRadius: () => this.brush.radius,
    });
    this.buildToolbar();
  }

  get ok() { return this.scene.ok; }

  // ---------------------------------------------------------------- модели

  /** Объекты из src/core/mesh.js одного файла -> на стол. */
  add(objects, fileName) {
    const added = [];
    for (const o of objects) {
      const pos = o.positions;
      // центр сетки - в начало координат: поворот и масштаб вокруг середины модели
      const mm = new THREE.Matrix4().fromArray(o.matrix);
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.length; i += 3) box.expandByPoint(v.set(pos[i], pos[i + 1], pos[i + 2]));
      const c = box.getCenter(new THREE.Vector3());
      const local = new Float32Array(pos.length);
      for (let i = 0; i < pos.length; i += 3) { local[i] = pos[i] - c.x; local[i + 1] = pos[i + 1] - c.y; local[i + 2] = pos[i + 2] - c.z; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(local, 3));
      g.computeVertexNormals();
      const mesh = this.scene.makeMesh(g);
      const m2 = mm.clone().multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
      m2.decompose(mesh.position, mesh.quaternion, mesh.scale);
      const inst = { uid: ++uidSeq, name: o.name || fileName, mesh, paint: o.paint ? Uint8Array.from(o.paint) : null, fine: false };
      mesh.userData.inst = inst;
      if (inst.paint) this.scene.ok && this.scene.setPaintOverlay(mesh, local, inst.paint);
      this.dropToBed(inst);
      this.items.push(inst);
      added.push(inst);
    }
    this.placeNew(added);
    this.selected = new Set(added.slice(-1).map((i) => i.uid));
    this.changed();
    return added;
  }

  box(inst) {
    inst.mesh.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(inst.mesh, true);
  }

  dropToBed(inst) {
    const b = this.box(inst);
    inst.mesh.position.z -= b.min.z;
  }

  /** Новые модели: если все стоят на столе (3MF из слайсера) - как есть, иначе в свободное место. */
  placeNew(added) {
    const others = this.items.filter((i) => !added.includes(i)).map((i) => this.box(i));
    const boxes = added.map((i) => this.box(i));
    const keep = boxes.every((b) => Ops.onBed(b.min.toArray(), b.max.toArray())) &&
      boxes.every((b, k) => [...others, ...boxes.slice(0, k)].every((o) => !b.intersectsBox(o)));
    if (keep && added.length > 1) return;
    for (const inst of added) {
      const b = this.box(inst);
      const size = b.getSize(new THREE.Vector3());
      const taken = this.items.filter((i) => i !== inst && (!added.includes(i) || added.indexOf(i) < added.indexOf(inst))).map((i) => { const x = this.box(i); return { min: x.min.toArray(), max: x.max.toArray() }; });
      const spot = Ops.freeSpot({ w: size.x, d: size.y }, taken, { gap: this.spacing() }) || { x: BED + 20 + size.x / 2, y: BED / 2 };
      this.moveCenterTo(inst, spot.x, spot.y);
    }
  }

  moveCenterTo(inst, x, y) {
    const b = this.box(inst);
    const c = b.getCenter(new THREE.Vector3());
    inst.mesh.position.x += x - c.x;
    inst.mesh.position.y += y - c.y;
  }

  states() {
    return this.items.map((i) => {
      const b = this.box(i);
      const size = b.getSize(new THREE.Vector3());
      const off = !Ops.onBed(b.min.toArray(), b.max.toArray());
      return { uid: i.uid, name: i.name, off, big: size.x > BED || size.y > BED || size.z > BED, tiny: Math.max(size.x, size.y, size.z) < 3, size, selected: this.selected.has(i.uid) };
    });
  }

  repaint() {
    if (!this.scene.ok) return;
    for (const s of this.states()) {
      const inst = this.items.find((i) => i.uid === s.uid);
      this.scene.paintState(inst.mesh, s);
    }
    const sel = this.sel();
    this.scene.attachGizmo(sel.length === 1 ? sel[0].mesh : null);
    this.updateCutPlane();
    this.scene.render();
  }

  changed() {
    this.repaint();
    this.refreshPanel();
    this.onChange && this.onChange();
  }

  sel() { return this.items.filter((i) => this.selected.has(i.uid)); }

  select(inst, add) {
    if (!inst) this.selected.clear();
    else if (add) { if (this.selected.has(inst.uid)) this.selected.delete(inst.uid); else this.selected.add(inst.uid); }
    else this.selected = new Set([inst.uid]);
    this.repaint();
    this.refreshPanel();
    this.onSelect && this.onSelect();
  }

  remove(list = this.sel()) {
    for (const i of list) {
      this.scene.removeMesh(i.mesh);
      this.items.splice(this.items.indexOf(i), 1);
      this.selected.delete(i.uid);
    }
    this.changed();
  }

  /** Убрать с UI: с подсказкой, что вернуть можно Ctrl+Z. */
  removeWithNote(list = this.sel()) {
    const n = list.filter(Boolean).length;
    if (!n) return;
    this.remove(list.filter(Boolean));
    this.onStatus('act.removed', { n }, '');
  }

  /** «Убрать лишние»: модели за краем стола (после «Разложить» - те, что не влезли). */
  removeOff() {
    const off = this.states().filter((s) => s.off).map((s) => this.items.find((i) => i.uid === s.uid));
    if (off.length) this.remove(off);
    return off.length;
  }

  clone(inst) {
    const g = inst.mesh.geometry.clone();
    const mesh = this.scene.makeMesh(g);
    mesh.position.copy(inst.mesh.position); mesh.quaternion.copy(inst.mesh.quaternion); mesh.scale.copy(inst.mesh.scale);
    const c = { uid: ++uidSeq, name: inst.name, mesh, paint: inst.paint ? Uint8Array.from(inst.paint) : null, fine: inst.fine };
    mesh.userData.inst = c;
    if (c.paint && this.scene.ok) this.scene.setPaintOverlay(mesh, g.attributes.position.array, c.paint);
    this.items.push(c);
    return c;
  }

  copies(n) {
    const src = this.sel();
    const made = [];
    for (const s of src) for (let k = 0; k < n; k++) made.push(this.clone(s));
    this.placeNew(made);
    this.changed();
    return made.length;
  }

  /** Разложить все модели по столу; не влезшие - справа от стола, сообщение «влезло N из M». */
  arrange() {
    if (!this.items.length) return;
    const boxes = this.items.map((i) => this.box(i));
    const r = Ops.arrange(boxes.map((b) => { const s = b.getSize(new THREE.Vector3()); return { w: s.x, d: s.y }; }), { gap: this.spacing() });
    this.items.forEach((inst, k) => this.moveCenterTo(inst, r.centers[k].x, r.centers[k].y));
    this.changed();
    if (r.overflow.length) this.onStatus('arr.over', { n: this.items.length - r.overflow.length, m: this.items.length }, 'error');
    else this.onStatus('arr.ok', {}, 'ok');
    return r;
  }

  mirror(axis) {
    for (const i of this.sel()) {
      i.mesh.scale[axis] *= -1;
      this.dropToBed(i);
    }
    this.changed();
  }

  layOnNormal(inst, worldNormal) {
    const q = new THREE.Quaternion().setFromUnitVectors(worldNormal.clone().normalize(), new THREE.Vector3(0, 0, -1));
    const before = this.box(inst).getCenter(new THREE.Vector3());
    inst.mesh.quaternion.premultiply(q);
    this.moveCenterTo(inst, before.x, before.y);
    this.dropToBed(inst);
  }

  layFlatAuto() {
    for (const inst of this.sel()) {
      const n = Ops.largestFlatNormal(inst.mesh.geometry.attributes.position.array);
      if (!n) continue;
      inst.mesh.updateMatrixWorld(true);
      const nm = new THREE.Matrix3().getNormalMatrix(inst.mesh.matrixWorld);
      this.layOnNormal(inst, new THREE.Vector3(...n).applyMatrix3(nm).normalize());
    }
    this.changed();
  }

  center() {
    const sel = this.sel();
    if (!sel.length) return;
    const b = new THREE.Box3();
    for (const i of sel) b.union(this.box(i));
    const c = b.getCenter(new THREE.Vector3());
    for (const i of sel) { i.mesh.position.x += BED / 2 - c.x; i.mesh.position.y += BED / 2 - c.y; }
    this.changed();
  }

  align(how) {
    const sel = this.sel();
    if (sel.length < 2) return;
    const boxes = sel.map((i) => this.box(i));
    const all = boxes.reduce((a, b) => a.clone().union(b));
    sel.forEach((inst, k) => {
      const b = boxes[k];
      const c = b.getCenter(new THREE.Vector3());
      const d = { left: [all.min.x - b.min.x, 0], right: [all.max.x - b.max.x, 0], cx: [all.getCenter(new THREE.Vector3()).x - c.x, 0],
        front: [0, all.min.y - b.min.y], back: [0, all.max.y - b.max.y], cy: [0, all.getCenter(new THREE.Vector3()).y - c.y] }[how];
      inst.mesh.position.x += d[0]; inst.mesh.position.y += d[1];
    });
    this.changed();
  }

  setPosition(axis, v) {
    const [inst] = this.sel();
    if (!inst || !Number.isFinite(v)) return;
    const c = this.box(inst).getCenter(new THREE.Vector3());
    inst.mesh.position[axis] += v - c[axis];
    this.changed();
  }

  setRotation(axis, deg) {
    const [inst] = this.sel();
    if (!inst || !Number.isFinite(deg)) return;
    const e = new THREE.Euler().setFromQuaternion(inst.mesh.quaternion, 'XYZ');
    e[axis] = THREE.MathUtils.degToRad(deg);
    const before = this.box(inst).getCenter(new THREE.Vector3());
    inst.mesh.quaternion.setFromEuler(e);
    this.moveCenterTo(inst, before.x, before.y);
    this.dropToBed(inst);
    this.changed();
  }

  setScale(axis, pct) {
    const sel = this.sel();
    if (!sel.length || !(pct > 0)) return;
    for (const inst of sel) {
      const f = pct / 100;
      const before = this.box(inst).getCenter(new THREE.Vector3());
      if (this.lock || axis === 'all') {
        const cur = Math.abs(inst.mesh.scale[axis === 'all' ? 'x' : axis]) || 1;
        const k = f / cur;
        inst.mesh.scale.multiplyScalar(k);
      } else inst.mesh.scale[axis] = Math.sign(inst.mesh.scale[axis] || 1) * f;
      this.moveCenterTo(inst, before.x, before.y);
      this.dropToBed(inst);
    }
    this.changed();
  }

  setSize(axis, mm) {
    const [inst] = this.sel();
    if (!inst || !(mm > 0)) return;
    const size = this.box(inst).getSize(new THREE.Vector3());
    const k = mm / size[axis];
    if (this.lock) this.setScale('all', Math.abs(inst.mesh.scale.x) * k * 100);
    else {
      // ось модели, которая больше всего смотрит вдоль этой оси стола
      const dirs = ['x', 'y', 'z'].map((a) => { const v = new THREE.Vector3(); v[a] = 1; return v.applyQuaternion(inst.mesh.quaternion); });
      const w = { x: 0, y: 1, z: 2 }[axis];
      const best = ['x', 'y', 'z'][[0, 1, 2].sort((p, q) => Math.abs(dirs[q].getComponent(w)) - Math.abs(dirs[p].getComponent(w)))[0]];
      this.setScale(best, Math.abs(inst.mesh.scale[best]) * k * 100);
    }
  }

  fitToBed() {
    for (const inst of this.sel()) {
      const s = this.box(inst).getSize(new THREE.Vector3());
      const k = Math.min(1, (BED * 0.95) / Math.max(s.x, s.y), (BED * 0.95) / s.z);
      inst.mesh.scale.multiplyScalar(k);
      this.dropToBed(inst);
    }
    this.placeNew(this.sel());
    this.changed();
  }

  scaleBy(k) {
    for (const inst of this.sel()) { inst.mesh.scale.multiplyScalar(k); this.dropToBed(inst); }
    this.placeNew(this.sel());
    this.changed();
  }

  // ---------------------------------------------------------------- разрез

  updateCutPlane() {
    const [inst] = this.sel();
    if (this.tool !== 'cut' || !inst || this.sel().length !== 1) { this.scene.setCutPlane(null); return; }
    const b = this.box(inst);
    if (this.cut.z === null || this.cut.z <= b.min.z || this.cut.z >= b.max.z) this.cut.z = Math.round(((b.min.z + b.max.z) / 2) * 10) / 10;
    this.scene.setCutPlane(this.cut.z, b);
  }

  worldPositions(inst) {
    inst.mesh.updateMatrixWorld(true);
    const m = inst.mesh.matrixWorld;
    const p = inst.mesh.geometry.attributes.position.array;
    const out = new Float32Array(p.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.length; i += 3) { v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(m); out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z; }
    if (m.determinant() < 0) {
      for (let o = 0; o < out.length; o += 9) for (let k = 0; k < 3; k++) { const a = out[o + 3 + k]; out[o + 3 + k] = out[o + 6 + k]; out[o + 6 + k] = a; }
    }
    return out;
  }

  doCut() {
    const sel = this.sel();
    if (sel.length !== 1 || this.cut.z === null) return null;
    const inst = sel[0];
    const tri = (c, h) => THREE.ShapeUtils.triangulateShape(c.map((p) => new THREE.Vector2(p.x, p.y)), h.map((x) => x.map((p) => new THREE.Vector2(p.x, p.y))));
    const r = Ops.cutMesh(this.worldPositions(inst), this.cut.z, tri, inst.paint);
    if (!r.below.length || !r.above.length) return null;
    const base = inst.name.replace(/\.(stl|3mf|obj)$/i, '');
    const lowerCenter = this.box(inst).getCenter(new THREE.Vector3());
    this.remove([inst]);
    const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const [lower] = this.add([{ name: base + '_1', positions: r.below, matrix: ident, paint: r.belowPaint.some(Boolean) ? r.belowPaint : null }], base);
    this.moveCenterTo(lower, lowerCenter.x, lowerCenter.y);
    const [upper] = this.add([{ name: base + '_2', positions: r.above, matrix: ident, paint: r.abovePaint.some(Boolean) ? r.abovePaint : null }], base);
    if (this.cut.flip) { upper.mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)); this.dropToBed(upper); }
    this.placeNew([upper]);
    this.cut.z = null;
    this.selected = new Set([lower.uid, upper.uid]);
    this.changed();
    if (r.open) this.onStatus('cut.open', { n: r.open }, 'error'); else this.onStatus('cut.done', {}, 'ok');
    return r;
  }

  // ---------------------------------------------------------------- кисть поддержек

  paintAt(inst, worldPoint, first) {
    if (!inst.fine) {
      const g = inst.mesh.geometry;
      const f = Ops.subdivideForBrush(g.attributes.position.array, inst.paint);
      g.setAttribute('position', new THREE.BufferAttribute(f.positions, 3));
      // Старый normal короче нового position: computeVertexNormals пишет в него же, и модель
      // чернела после первого мазка (обзор 23.10 А1). Нормали - заново под новую сетку.
      g.deleteAttribute('normal');
      g.computeVertexNormals();
      g.computeBoundingBox(); g.computeBoundingSphere();
      inst.paint = f.paint;
      inst.fine = true;
    }
    if (!inst.paint) inst.paint = new Uint8Array(inst.mesh.geometry.attributes.position.count / 3);
    inst.mesh.updateMatrixWorld(true);
    const inv = inst.mesh.matrixWorld.clone().invert();
    const lp = worldPoint.clone().applyMatrix4(inv);
    const s = Math.max(Math.abs(inst.mesh.scale.x), Math.abs(inst.mesh.scale.y), Math.abs(inst.mesh.scale.z)) || 1;
    const hit = Ops.trianglesInSphere(inst.mesh.geometry.attributes.position.array, [lp.x, lp.y, lp.z], this.brush.radius / s);
    const code = this.brush.mode;
    for (const k of hit) inst.paint[k] = code;
    if (!inst.paint.some(Boolean)) inst.paint = null;
    if (this.scene.ok) this.scene.setPaintOverlay(inst.mesh, inst.mesh.geometry.attributes.position.array, inst.paint);
    void first;
  }

  /**
   * «Очистить»: у выбранных моделей. Ничего не выбрано - раньше молча стирала раскраску у ВСЕХ
   * (обзор 23.10 А2); теперь сначала вопрос с числом моделей. Отменяется Ctrl+Z.
   */
  async clearPaint() {
    let list = this.sel().filter((i) => i.paint);
    if (!this.sel().length) {
      list = this.items.filter((i) => i.paint);
      if (!list.length) return false;
      if (this.confirm && !(await this.confirm('paint.clearAsk', { n: list.length }))) return false;
    }
    this.clearPaintOf(list);
    return true;
  }

  clearPaintOf(list) {
    for (const i of list) { i.paint = null; this.scene.ok && this.scene.setPaintOverlay(i.mesh, null, null); }
    this.changed();
  }

  painted() { return this.items.some((i) => i.paint && i.paint.includes(1)); }

  // ---------------------------------------------------------------- отмена (обзор 23.10 А2)

  /** Снимок стола. Массив вершин не меняется на месте (кисть ставит новый) - храним ссылку. */
  snap() {
    return {
      items: this.items.map((i) => ({
        uid: i.uid, name: i.name, geo: i.mesh.geometry.attributes.position.array,
        pos: i.mesh.position.clone(), quat: i.mesh.quaternion.clone(), scale: i.mesh.scale.clone(),
        paint: i.paint ? Uint8Array.from(i.paint) : null, fine: i.fine,
      })),
      selected: [...this.selected],
    };
  }

  static same(a, b) {
    if (a.items.length !== b.items.length) return false;
    const samePaint = (p, q) => (!p && !q) || (p && q && p.length === q.length && p.every((v, k) => v === q[k]));
    return a.items.every((x, k) => {
      const y = b.items[k];
      return x.uid === y.uid && x.geo === y.geo && x.name === y.name && x.pos.equals(y.pos) && x.quat.equals(y.quat) && x.scale.equals(y.scale) && samePaint(x.paint, y.paint);
    });
  }

  /** Вернуть стол к снимку: модели с той же сеткой остаются, остальные строятся заново. */
  restore(s) {
    const old = new Map(this.items.map((i) => [i.uid, i]));
    const next = [];
    for (const it of s.items) {
      let inst = old.get(it.uid);
      if (inst && inst.mesh.geometry.attributes.position.array === it.geo) old.delete(it.uid);
      else {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(it.geo, 3));
        g.computeVertexNormals();
        g.computeBoundingBox(); g.computeBoundingSphere();
        inst = { uid: it.uid, mesh: this.scene.makeMesh(g) };
        inst.mesh.userData.inst = inst;
      }
      inst.name = it.name;
      inst.fine = it.fine;
      inst.paint = it.paint ? Uint8Array.from(it.paint) : null;
      inst.mesh.position.copy(it.pos); inst.mesh.quaternion.copy(it.quat); inst.mesh.scale.copy(it.scale);
      if (this.scene.ok) this.scene.setPaintOverlay(inst.mesh, it.geo, inst.paint);
      next.push(inst);
    }
    for (const i of old.values()) this.scene.removeMesh(i.mesh);
    this.items = next;
    this.selected = new Set(s.selected.filter((uid) => next.some((i) => i.uid === uid)));
    this.cut.z = null;
    this.changed();
    this.onSelect && this.onSelect();
  }

  /** Правка стола одним шагом истории. Вложенные вызовы (разрез = убрать + добавить) - внутри внешнего. */
  undoable(fn) {
    if (this.depth) return fn();
    const before = this.snap();
    this.depth = 1;
    let r;
    try { r = fn(); } finally { this.depth = 0; }
    this.record(before);
    return r;
  }

  record(before) {
    const after = this.snap();
    if (Editor.same(before, after)) return;
    History.push({ kind: 'plate', undo: () => this.restore(before), redo: () => this.restore(after) });
  }

  begin() { this.pending = this.snap(); }
  commit() { const p = this.pending; this.pending = null; if (p) this.record(p); }

  selectAll() {
    this.selected = new Set(this.items.map((i) => i.uid));
    this.repaint();
    this.refreshPanel();
    this.onSelect && this.onSelect();
  }

  // ---------------------------------------------------------------- для нарезки

  forSlice() {
    return this.items.map((i) => {
      i.mesh.updateMatrixWorld(true);
      return {
        name: i.name,
        positions: i.mesh.geometry.attributes.position.array,
        matrix: Array.from(new THREE.Matrix4().compose(i.mesh.position, i.mesh.quaternion, i.mesh.scale).elements),
        paint: i.paint || null,
      };
    });
  }

  // ---------------------------------------------------------------- панель

  buildToolbar() {
    for (const b of document.querySelectorAll('#toolbar button')) {
      const name = b.dataset.tool || b.dataset.act;
      b.innerHTML = icon(name);
      b.addEventListener('click', () => {
        if (b.dataset.tool) this.setTool(b.dataset.tool);
        else if (name === 'arrange') this.arrange();
        else if (name === 'copy') this.copies(1);
        else if (name === 'delete') this.removeWithNote();
        else if (name === 'undo') History.undo();
        else if (name === 'redo') History.redo();
      });
    }
    const hist = () => {
      const u = $('#toolbar [data-act="undo"]'), r = $('#toolbar [data-act="redo"]');
      if (u) u.disabled = !History.canUndo();
      if (r) r.disabled = !History.canRedo();
      this.refreshToolbar();
    };
    History.onHistory(hist);
    hist();
    this.texts();
  }

  texts() {
    for (const b of document.querySelectorAll('#toolbar button')) {
      const name = b.dataset.tool || b.dataset.act;
      b.title = t('tool.' + name);
      b.setAttribute('aria-label', t('tool.' + name));
    }
    this.refreshPanel();
  }

  setTool(tool) {
    this.tool = tool;
    for (const b of document.querySelectorAll('#toolbar button[data-tool]')) b.classList.toggle('active', b.dataset.tool === tool);
    this.scene.setTool(tool);
    this.repaint();
    this.refreshPanel();
  }

  /** Панель инструментов видна при моделях на столе - и на пустом столе, если есть что отменить. */
  refreshToolbar() {
    const tb = $('#toolbar');
    if (!tb) return;
    tb.hidden = this.scene.mode !== 'models' || (!this.items.length && !History.canUndo() && !History.canRedo());
    for (const b of tb.querySelectorAll('button[data-tool], button[data-act="arrange"], button[data-act="copy"], button[data-act="delete"]')) b.disabled = !this.items.length;
  }

  refreshPanel(live = false) {
    const box = $('#tool-panel');
    if (!box) return;
    this.refreshToolbar();
    if (!this.items.length || this.scene.mode !== 'models') { box.hidden = true; return; }
    box.hidden = false;
    const sel = this.sel();
    const st = this.states().filter((s) => this.selected.has(s.uid));
    if (live && box.dataset.tool === this.tool && sel.length === 1) { this.fillNumbers(sel[0]); return; }
    box.dataset.tool = this.tool;
    box.textContent = '';
    const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const title = h('div', 'tp-title');
    title.append(h('b', '', t('tool.' + this.tool)));
    box.append(title);
    // Кисти выбор не нужен: красит модель под курсором; «Очистить» без выбора - у всех, с вопросом.
    if (!sel.length && this.tool !== 'paint') { box.append(h('p', 'hint', t('obj.none'))); return; }
    if (!sel.length) { /* кисть без выбора */ } else if (sel.length === 1) { const n = h('div', 'tp-name', sel[0].name); n.title = sel[0].name; box.append(n); } else box.append(h('p', 'hint', t('obj.many', { n: sel.length })));
    const warn = st.find((s) => s.big) ? 'obj.big' : st.find((s) => s.off) ? 'obj.offBed' : st.find((s) => s.tiny) ? 'obj.tiny' : '';
    if (warn) {
      const p = h('p', 'tp-warn', t(warn, { mm: st[0] ? Math.round(Math.max(st[0].size.x, st[0].size.y, st[0].size.z) * 100) / 100 : 0 }));
      box.append(p);
      const row = h('div', 'row');
      if (warn === 'obj.big') { const b = h('button', '', t('obj.fit')); b.onclick = () => this.fitToBed(); row.append(b); }
      if (warn === 'obj.tiny') for (const k of [10, 25.4, 1000]) { const b = h('button', '', '×' + k); b.dataset.scaleBy = String(k); b.onclick = () => this.scaleBy(k); row.append(b); }
      if (warn === 'obj.offBed') { const b = h('button', '', t('tool.arrange')); b.onclick = () => this.arrange(); row.append(b); }
      box.append(row);
    }
    const tool = this.tool;
    if (tool === 'move' || tool === 'rotate' || tool === 'scale') {
      if (sel.length === 1) {
        box.append(this.numRow('obj.position', ['x', 'y'], 'pos'));
        box.append(this.numRow('obj.rotation', ['x', 'y', 'z'], 'rot'));
        box.append(this.numRow('obj.scale', ['x', 'y', 'z'], 'scl'));
        box.append(this.numRow('obj.size', ['x', 'y', 'z'], 'size'));
        const lock = h('label', 'check');
        const cb = h('input'); cb.type = 'checkbox'; cb.checked = this.lock; cb.id = 'tp-lock';
        cb.onchange = () => { this.lock = cb.checked; };
        lock.append(cb, h('span', '', t('obj.lock')));
        box.append(lock);
        this.fillNumbers(sel[0]);
      }
      const mir = h('div', 'tp-row');
      mir.append(h('span', 'tp-lab', t('obj.mirror')));
      for (const a of ['x', 'y', 'z']) { const b = h('button', '', a.toUpperCase()); b.dataset.mirror = a; b.onclick = () => this.mirror(a); mir.append(b); }
      box.append(mir);
      const cp = h('div', 'tp-row tp-copies');
      cp.append(h('span', 'tp-lab', t('obj.copies')));
      const n = h('input'); n.type = 'number'; n.min = '1'; n.max = '50'; n.value = '1'; n.id = 'tp-copies';
      const go = h('button', '', t('obj.addCopies')); go.id = 'tp-copies-go';
      go.onclick = () => this.copies(Math.max(1, Math.min(50, Math.round(Number(n.value) || 1))));
      cp.append(n, go);
      box.append(cp);
      const cen = h('button', '', t('obj.center')); cen.id = 'tp-center'; cen.onclick = () => this.center();
      box.append(cen);
      if (sel.length > 1) {
        const al = h('div', 'tp-align');
        al.append(h('span', 'tp-lab', t('obj.align')));
        for (const k of ['left', 'cx', 'right', 'front', 'cy', 'back']) { const b = h('button', '', t('align.' + k)); b.dataset.align = k; b.onclick = () => this.align(k); al.append(b); }
        box.append(al);
      }
    } else if (tool === 'face') {
      box.append(h('p', 'hint', t('face.hint')));
      const b = h('button', '', t('face.auto')); b.id = 'tp-layflat'; b.onclick = () => this.layFlatAuto();
      box.append(b);
    } else if (tool === 'cut') {
      if (sel.length === 1) {
        this.updateCutPlane();
        const b = this.box(sel[0]);
        const row = h('div', 'tp-row tp-wide');
        row.append(h('span', 'tp-lab', t('cut.height')));
        const num = h('input'); num.type = 'number'; num.step = '0.1'; num.id = 'tp-cut-z'; num.value = String(this.cut.z);
        const rng = h('input'); rng.type = 'range'; rng.min = String(b.min.z); rng.max = String(b.max.z); rng.step = '0.1'; rng.value = String(this.cut.z);
        const set = (v) => { if (!Number.isFinite(v)) return; this.cut.z = Math.min(b.max.z - 0.05, Math.max(b.min.z + 0.05, v)); num.value = String(Math.round(this.cut.z * 100) / 100); rng.value = String(this.cut.z); this.updateCutPlane(); };
        num.onchange = () => set(Number(String(num.value).replace(',', '.')));
        rng.oninput = () => set(Number(rng.value));
        row.append(num);
        box.append(row, rng);
        const fl = h('label', 'check');
        const cb = h('input'); cb.type = 'checkbox'; cb.checked = this.cut.flip; cb.onchange = () => { this.cut.flip = cb.checked; };
        fl.append(cb, h('span', '', t('cut.flip')));
        box.append(fl);
        const go = h('button', 'primary', t('cut.do')); go.id = 'tp-cut'; go.onclick = () => this.doCut();
        box.append(go);
      }
    } else if (tool === 'paint') {
      const seg = h('div', 'seg tp-brush');
      for (const [mode, key] of [[1, 'paint.enforce'], [2, 'paint.block'], [0, 'paint.erase']]) {
        const b = h('button', this.brush.mode === mode ? 'active' : '', t(key)); b.dataset.brush = String(mode);
        b.onclick = () => { this.brush.mode = mode; for (const x of seg.children) x.classList.toggle('active', x === b); };
        seg.append(b);
      }
      box.append(seg);
      const row = h('div', 'tp-row');
      row.append(h('span', 'tp-lab', t('paint.radius')));
      const rng = h('input'); rng.type = 'range'; rng.min = '1'; rng.max = '20'; rng.step = '0.5'; rng.value = String(this.brush.radius);
      const val = h('b', '', String(this.brush.radius));
      rng.oninput = () => { this.brush.radius = Number(rng.value); val.textContent = rng.value; };
      row.append(rng, val);
      box.append(row);
      box.append(h('p', 'hint', t('paint.hint')));
      if (this.supportsNone && this.supportsNone()) box.append(h('p', 'hint', t('paint.noneNote')));
      const cl = h('button', '', t(sel.length ? 'paint.clear' : 'paint.clearAll')); cl.id = 'tp-paint-clear';
      cl.disabled = !(sel.length ? sel : this.items).some((i) => i.paint); cl.onclick = () => this.clearPaint();
      box.append(cl);
    }
  }

  numRow(key, axes, kind) {
    const row = document.createElement('div');
    row.className = 'tp-row';
    const lab = document.createElement('span');
    lab.className = 'tp-lab';
    lab.textContent = t(key);
    row.append(lab);
    for (const a of axes) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'decimal';
      inp.dataset.kind = kind;
      inp.dataset.axis = a;
      inp.title = a.toUpperCase();
      inp.addEventListener('change', () => {
        const v = Number(String(inp.value).replace(',', '.').trim());
        if (!Number.isFinite(v)) { this.refreshPanel(); return; }
        if (kind === 'pos') this.setPosition(a, v);
        else if (kind === 'rot') this.setRotation(a, v);
        else if (kind === 'scl') this.setScale(a, v);
        else if (kind === 'size') this.setSize(a, v);
      });
      // Enter - принять и уйти из поля: следующий Ctrl+Z - отмена правки стола, а не набора.
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      row.append(inp);
    }
    return row;
  }

  fillNumbers(inst) {
    const b = this.box(inst);
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    const e = new THREE.Euler().setFromQuaternion(inst.mesh.quaternion, 'XYZ');
    const r1 = (x) => String(Math.round(x * 100) / 100);
    const vals = {
      pos: { x: c.x, y: c.y },
      rot: { x: THREE.MathUtils.radToDeg(e.x), y: THREE.MathUtils.radToDeg(e.y), z: THREE.MathUtils.radToDeg(e.z) },
      scl: { x: Math.abs(inst.mesh.scale.x) * 100, y: Math.abs(inst.mesh.scale.y) * 100, z: Math.abs(inst.mesh.scale.z) * 100 },
      size: { x: s.x, y: s.y, z: s.z },
    };
    for (const inp of document.querySelectorAll('#tool-panel input[data-kind]')) {
      if (document.activeElement === inp) continue;
      inp.value = r1(vals[inp.dataset.kind][inp.dataset.axis]);
    }
  }
}

// Каждая правка стола из кнопок, чисел и меню - один шаг Ctrl+Z (обзор 23.10 А2).
for (const name of ['add', 'remove', 'removeOff', 'copies', 'arrange', 'mirror', 'layFlatAuto', 'center', 'align', 'setPosition', 'setRotation', 'setScale', 'setSize', 'fitToBed', 'scaleBy', 'doCut', 'clearPaintOf']) {
  const f = Editor.prototype[name];
  Editor.prototype[name] = function (...args) { return this.undoable(() => f.apply(this, args)); };
}

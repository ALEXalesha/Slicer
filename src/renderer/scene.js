// Вид стола и всё, что делается мышью: выбор и перетаскивание моделей, поворот и масштаб
// ручками (TransformControls), выбор грани «на стол», кисть поддержек, плоскость среза,
// линии слоёв после нарезки. Состояние моделей держит editor.js, здесь - только картинка
// и события. Без WebGL окно работает, просто без картинки (ok = false).
import * as THREE from './vendor/three/build/three.module.min.js';
import { OrbitControls } from './vendor/three/jsm/controls/OrbitControls.js';
import { TransformControls } from './vendor/three/jsm/controls/TransformControls.js';

export const BED = 256;
const DIR = new THREE.Vector3(0, -0.78, 0.62).normalize();      // откуда смотрит камера по умолчанию

const COLORS = {
  model: 0x9d8cff, selected: 0x5b8def, off: 0xff5b5b,
  enforce: 0x2dd4a8, block: 0xff5b5b,
};
const THEME_BED = {
  dark: { plate: 0x2a2d3a, grid: 0x444a60, axis: 0x5b8def },
  light: { plate: 0xc9d0dc, grid: 0x9aa4b6, axis: 0x3a6fd8 },
};

export class Scene {
  constructor(canvas, events = {}) {
    this.canvas = canvas;
    this.events = events;
    this.ok = false;
    this.tool = 'move';
    this.mode = 'models';               // models | layers
    this.userMoved = false;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.ok = true;
    } catch (e) {
      console.warn('no WebGL', e);
      return;
    }
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 6000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(BED / 2, BED / 2, 0);
    this.controls.addEventListener('change', () => this.render());
    this.controls.addEventListener('start', () => { this.userMoved = true; });
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(200, -150, 400);
    this.scene.add(sun);
    this.bedGroup = new THREE.Group();
    this.scene.add(this.bedGroup);
    this.setTheme(false);
    this.models = new THREE.Group();
    this.scene.add(this.models);
    this.layers = new THREE.Group();
    this.layers.visible = false;
    this.scene.add(this.layers);
    // плоскость среза
    this.cutPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    this.cutPlane.visible = false;
    this.scene.add(this.cutPlane);
    // кольцо кисти
    this.brush = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide }));
    this.brush.visible = false;
    this.brush.renderOrder = 10;
    this.scene.add(this.brush);
    // ручки поворота и масштаба
    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.8);
    this.gizmo.addEventListener('change', () => this.render());
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (e.value) this.events.gestureStart && this.events.gestureStart();
      if (!e.value && this.gizmo.object) this.events.transformed && this.events.transformed(this.gizmo.object.userData.inst);
    });
    this.gizmo.addEventListener('objectChange', () => this.events.transforming && this.events.transforming(this.gizmo.object && this.gizmo.object.userData.inst));
    this.scene.add(this.gizmo.getHelper());
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.drag = null;
    // В фазе захвата: решаем раньше OrbitControls, будет ли это вращение вида или работа с моделью.
    canvas.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.miss = null;                   // нажали мимо моделей: снять выбор, если отпустят без движения
    canvas.addEventListener('pointerleave', () => { this.brush.visible = false; this.render(); });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setTheme(light) {
    if (!this.ok) return;
    const c = THEME_BED[light ? 'light' : 'dark'];
    this.bedGroup.clear();
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(BED, BED), new THREE.MeshStandardMaterial({ color: c.plate, roughness: 0.9 }));
    plate.position.set(BED / 2, BED / 2, -0.02);
    this.bedGroup.add(plate);
    const grid = new THREE.GridHelper(BED, 16, c.axis, c.grid);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(BED / 2, BED / 2, 0);
    this.bedGroup.add(grid);
    this.render();
  }

  /** Камера так, чтобы стол целиком помещался в окне любой формы (ревьювер Б3). */
  fitView() {
    if (!this.ok) return;
    const r = (BED / 2) * Math.SQRT2 * 1.06;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const d = r / Math.sin(Math.min(vfov, hfov) / 2);
    this.controls.target.set(BED / 2, BED / 2, 0);
    this.camera.position.copy(this.controls.target).addScaledVector(DIR, d);
    this.controls.update();
    this.userMoved = false;
    this.render();
  }

  resize() {
    if (!this.ok) return;
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved) this.fitView(); else this.render();
  }

  render() { if (this.ok) this.renderer.render(this.scene, this.camera); }

  /** Сколько процентов стола видно в кадре (для закона «стол не обрезан»). */
  bedInView() {
    if (!this.ok) return 0;
    let inside = 0;
    const v = new THREE.Vector3();
    for (const [x, y] of [[0, 0], [BED, 0], [BED, BED], [0, BED]]) {
      v.set(x, y, 0).project(this.camera);
      if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) inside++;
    }
    return inside / 4;
  }

  // ------------------------------------------------------------ модели

  makeMesh(geometry) {
    if (!this.ok) return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: COLORS.model, roughness: 0.55, metalness: 0.05 }));
    this.models.add(mesh);
    return mesh;
  }

  removeMesh(mesh) {
    if (!this.ok) return;
    if (this.gizmo.object === mesh) this.gizmo.detach();
    mesh.removeFromParent();
    mesh.geometry.dispose();
    for (const c of mesh.children) c.geometry && c.geometry.dispose();
  }

  /** Цвет по состоянию: выбрана, за краем стола. */
  paintState(mesh, { selected, off }) {
    const m = mesh.material;
    m.color.setHex(off ? COLORS.off : selected ? COLORS.selected : COLORS.model);
    m.transparent = off;
    m.opacity = off ? 0.6 : 1;
    m.emissive.setHex(selected ? 0x1a2a55 : 0x000000);
  }

  /** Раскраска поддержек поверх модели: два меша из покрашенных треугольников. */
  setPaintOverlay(mesh, positions, paint) {
    for (const c of [...mesh.children]) { c.geometry.dispose(); mesh.remove(c); }
    if (!paint) { this.render(); return; }
    for (const [code, color] of [[1, COLORS.enforce], [2, COLORS.block]]) {
      let n = 0;
      for (let t = 0; t < paint.length; t++) if (paint[t] === code) n++;
      if (!n) continue;
      const p = new Float32Array(n * 9);
      let o = 0;
      for (let t = 0; t < paint.length; t++) if (paint[t] === code) { p.set(positions.subarray(t * 9, t * 9 + 9), o); o += 9; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.userData.overlay = true;
      mesh.add(m);
    }
    this.render();
  }

  attachGizmo(mesh) {
    if (!this.ok) return;
    if (mesh && (this.tool === 'rotate' || this.tool === 'scale') && this.mode === 'models') {
      this.gizmo.setMode(this.tool);
      this.gizmo.setSpace('local');
      this.gizmo.attach(mesh);
    } else this.gizmo.detach();
    this.render();
  }

  setTool(tool) {
    this.tool = tool;
    this.brush.visible = false;
    this.render();
  }

  setCutPlane(z, box) {
    if (!this.ok) return;
    if (z === null || !box) { this.cutPlane.visible = false; this.render(); return; }
    const w = box.max.x - box.min.x + 20, d = box.max.y - box.min.y + 20;
    this.cutPlane.scale.set(w, d, 1);
    this.cutPlane.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, z);
    this.cutPlane.visible = true;
    this.render();
  }

  // ------------------------------------------------------------ мышь

  setPointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  hitModel(e) {
    this.setPointer(e);
    const hits = this.raycaster.intersectObjects(this.models.children, false);
    return hits.length ? hits[0] : null;
  }

  planePoint(z = 0) {
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), p) ? p : null;
  }

  onDown(e) {
    if (!this.ok || this.mode !== 'models' || e.button !== 0) return;
    if (this.gizmo.dragging || this.gizmo.axis) return;             // ручки поворота/масштаба
    const hit = this.hitModel(e);
    if (!hit) {
      // Б1 (обзор 23.10): поворот вида мышью мимо модели выбор не снимает - только щелчок без движения.
      this.miss = { x: e.clientX, y: e.clientY, add: e.ctrlKey || e.shiftKey };
      return;
    }
    const inst = hit.object.userData.inst;
    if (this.tool === 'paint') {
      this.controls.enabled = false;
      this.drag = { kind: 'paint', inst };
      this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
      this.events.paint && this.events.paint(inst, hit.point, true);
      return;
    }
    if (this.tool === 'face') {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      this.events.pickFace && this.events.pickFace(inst, n);
      return;
    }
    const add = e.ctrlKey || e.shiftKey;
    const isSel = (x) => !!(this.events.isSelected && this.events.isSelected(x));
    // Б2: нажали на одну из выбранных без Ctrl - выбор не трогаем, чтобы тянуть все выбранные;
    // отпустили без движения - выбрана только она.
    const keep = isSel(inst) && !add;
    if (!keep) this.events.select && this.events.select(inst, add);
    if (this.tool === 'move' || this.tool === 'cut') {
      if (add && !isSel(inst)) return;                    // Ctrl-щелчок снял выбор - тянуть нечего
      const p = this.planePoint(0);
      if (!p) return;
      this.controls.enabled = false;
      const group = this.events.dragGroup ? this.events.dragGroup(inst) : [hit.object];
      this.drag = { kind: 'move', inst, start: p, moved: false, x: e.clientX, y: e.clientY, clickOnly: keep,
        group: group.map((m) => ({ mesh: m, origin: m.position.clone() })) };
      this.events.gestureStart && this.events.gestureStart();
      this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
    } else if (keep) this.events.select && this.events.select(inst, false);
  }

  onMove(e) {
    if (!this.ok || this.mode !== 'models') return;
    if (this.tool === 'paint') {
      const hit = this.hitModel(e);
      this.brush.visible = !!hit;
      if (hit) {
        const r = this.events.brushRadius ? this.events.brushRadius() : 3;
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        this.brush.position.copy(hit.point).addScaledVector(n, 0.05);
        this.brush.lookAt(hit.point.clone().add(n));
        this.brush.scale.setScalar(r);
        if (this.drag && this.drag.kind === 'paint') this.events.paint && this.events.paint(hit.object.userData.inst, hit.point, false);
      }
      this.render();
      return;
    }
    if (!this.drag || this.drag.kind !== 'move') return;
    this.setPointer(e);
    const p = this.planePoint(0);
    if (!p) return;
    const d = this.drag;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;      // дрожь руки при щелчке
    d.moved = true;
    for (const g of d.group) g.mesh.position.set(g.origin.x + p.x - d.start.x, g.origin.y + p.y - d.start.y, g.origin.z);
    this.events.transforming && this.events.transforming(d.inst);
    this.render();
  }

  onUp(e) {
    if (this.miss) {
      const m = this.miss;
      this.miss = null;
      if (!m.add && e && Math.hypot(e.clientX - m.x, e.clientY - m.y) < 4) this.events.select && this.events.select(null, false);
    }
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    if (d.kind === 'move') {
      if (d.moved) this.events.transformed && this.events.transformed(d.group.map((g) => g.mesh.userData.inst));
      else {
        if (d.clickOnly) this.events.select && this.events.select(d.inst, false);
        this.events.gestureEnd && this.events.gestureEnd();
      }
    }
    if (d.kind === 'paint') this.events.paintEnd && this.events.paintEnd(d.inst);
  }

  // ------------------------------------------------------------ слои

  setMode(mode) {
    this.mode = mode;
    if (!this.ok) return;
    this.models.visible = mode === 'models';
    this.layers.visible = mode === 'layers';
    this.cutPlane.visible = this.cutPlane.visible && mode === 'models';
    this.brush.visible = false;
    if (mode !== 'models') this.gizmo.detach();
    this.render();
  }

  /** Линии G-code: по LineSegments на каждый тип. preview - из src/core/gcode-preview.js. */
  showLayers(preview) {
    if (!this.ok) return;
    for (const c of [...this.layers.children]) { c.geometry.dispose(); this.layers.remove(c); }
    this.preview = preview;
    this.lines = preview.kinds.map((k, i) => {
      const d = preview.data[i];
      if (!d.positions.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(k.color), transparent: k.id === 'travel', opacity: k.id === 'travel' ? 0.5 : 1 }));
      l.frustumCulled = false;
      l.userData.kind = k.id;
      this.layers.add(l);
      return l;
    });
    this.render();
  }

  clearLayers() {
    if (!this.ok) return;
    for (const c of [...this.layers.children]) { c.geometry.dispose(); this.layers.remove(c); }
    this.preview = null;
    this.lines = null;
    this.render();
  }

  /** Показать слои с lo по hi (с нуля включительно) и только видимые типы. */
  setLayerRange(lo, hi, visibleKinds) {
    if (!this.ok || !this.preview) return;
    this.preview.kinds.forEach((k, i) => {
      const l = this.lines[i];
      if (!l) return;
      const ends = this.preview.data[i].layerEnd;
      const start = lo > 0 ? ends[lo - 1] : 0;
      const end = ends[Math.min(hi, ends.length - 1)];
      l.geometry.setDrawRange(start * 2, Math.max(0, end - start) * 2);
      l.visible = visibleKinds.has(k.id);
    });
    this.render();
  }

  /** Сколько отрезков сейчас нарисовано (для законов). */
  drawnSegments() {
    if (!this.lines) return 0;
    return this.lines.reduce((s, l) => s + (l && l.visible ? l.geometry.drawRange.count / 2 : 0), 0);
  }
}

export { THREE };

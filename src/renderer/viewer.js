// Вид стола: 256x256 мм, модели рядами (полками). Расставляет всё равно движок
// (--arrange 1), вид только показывает, что лежит на столе. Без WebGL окно работает,
// просто без картинки.
import * as THREE from './vendor/three/build/three.module.min.js';
import { OrbitControls } from './vendor/three/jsm/controls/OrbitControls.js';
import { STLLoader } from './vendor/three/jsm/loaders/STLLoader.js';
import { OBJLoader } from './vendor/three/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from './vendor/three/jsm/loaders/3MFLoader.js';

export const BED = 256;
const GAP = 8;

/** Раскладка полками: [{w, d}] -> [{x, y}] левых нижних углов, в пределах стола, если влезает. */
export function shelfLayout(sizes, bed = BED, gap = GAP) {
  const out = [];
  let x = gap, y = gap, row = 0;
  for (const s of sizes) {
    if (x + s.w > bed - gap && x > gap) { x = gap; y += row + gap; row = 0; }
    out.push({ x, y });
    x += s.w + gap;
    row = Math.max(row, s.d);
  }
  return out;
}

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.models = [];
    this.ok = false;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.ok = true;
    } catch (e) {
      console.warn('no WebGL', e);
      return;
    }
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(BED / 2, -BED * 0.9, BED * 0.9);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(BED / 2, BED / 2, 0);
    this.controls.update();
    this.controls.addEventListener('change', () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(200, -150, 400);
    this.scene.add(sun);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(BED, BED), new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.9 }));
    plate.position.set(BED / 2, BED / 2, -0.01);
    this.scene.add(plate);
    const grid = new THREE.GridHelper(BED, 16, 0x5b8def, 0x444a60);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(BED / 2, BED / 2, 0);
    this.scene.add(grid);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    if (!this.ok) return;
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() { if (this.ok) this.renderer.render(this.scene, this.camera); }

  /** Разобрать модель в объект three; бросает при битом файле. */
  static parse(name, buffer) {
    const ext = name.toLowerCase().split('.').pop();
    const mat = new THREE.MeshStandardMaterial({ color: 0x9d8cff, roughness: 0.55, metalness: 0.05 });
    if (ext === 'stl') {
      const g = new STLLoader().parse(buffer);
      if (!g.attributes.position || !g.attributes.position.count) throw new Error('empty');
      // Нормали в файле часто нулевые (модель чёрная): считаем свои по граням.
      g.computeVertexNormals();
      return new THREE.Mesh(g, mat);
    }
    if (ext === 'obj') {
      const o = new OBJLoader().parse(new TextDecoder().decode(buffer));
      o.traverse((c) => { if (c.isMesh) c.material = mat; });
      return o;
    }
    if (ext === '3mf') {
      const o = new ThreeMFLoader().parse(buffer);
      o.traverse((c) => { if (c.isMesh) c.material = mat; });
      return o;
    }
    throw new Error('type');
  }

  setModels(objects) {
    if (!this.ok) return;
    this.group.clear();
    const items = objects.map((o) => {
      if (o.parent) o.parent.remove(o);
      o.position.set(0, 0, 0);
      o.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(o);
      const size = box.getSize(new THREE.Vector3());
      return { o, box, w: size.x, d: size.y };
    });
    const place = shelfLayout(items);
    items.forEach((it, i) => {
      const holder = new THREE.Group();
      it.o.position.set(-it.box.min.x, -it.box.min.y, -it.box.min.z);
      holder.add(it.o);
      holder.position.set(place[i].x, place[i].y, 0);
      this.group.add(holder);
    });
    this.render();
  }
}

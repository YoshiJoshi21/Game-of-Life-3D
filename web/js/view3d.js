// three.js renderer and voxel editor for the 3D grid.
//
// Grid cell (x, y, z) is drawn at world (x, z, y) (minus the centre), so the
// grid's z axis points up and the "layer" being edited is a horizontal slice.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { ageRGB, trailRGB, TRAIL_MAX, AGE_MAX } from './palette.js';

const toLinear = c => Math.pow(c / 255, 2.2);
// linear-space colour tables for the instance colour buffers. New cells are
// pushed past white so they read as glowing
const AGE_LIN = ageRGB.map((c, a) => c.map(v => toLinear(v) * (a === 0 ? 1.6 : a < 3 ? 1.25 : 1)));
const TRAIL_LIN = trailRGB.map(c => c.map(v => Math.min(1, toLinear(v) * 5)));

export class View3D {
  constructor(container, { onEdit, isAlive }) {
    this.container = container;
    this.onEdit = onEdit;
    this.isAlive = isAlive;
    this.mode = 'draw'; // draw | erase | view
    this.layer = 0;
    this.cutaway = false;
    this.options = { trails: true, glow: true };
    this.dirty = true;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#050c1c');
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotateSpeed = 0.8;

    scene.add(new THREE.HemisphereLight('#cfe8ff', '#0a1838', 1.5));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(0.6, 1, 0.8);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#38bdf8', 1.2);
    rim.position.set(-1, -0.4, -0.8);
    scene.add(rim);

    this.group = new THREE.Group();
    scene.add(this.group);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.bindInput();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  setSize(w, h, d) {
    this.w = w;
    this.h = h;
    this.d = d;
    const size = w * h * d;
    this.group.clear();
    this.disposeMeshes();

    // live cells
    const geo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 });
    this.cells = new THREE.InstancedMesh(geo, mat, size);
    this.cells.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(size * 3), 3);
    this.cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cells.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.cells.frustumCulled = false;
    this.fillIdentity(this.cells, size, 1);
    this.group.add(this.cells);

    // trails: small translucent cubes where cells recently died
    const tgeo = new THREE.BoxGeometry(1, 1, 1);
    const tmat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false });
    this.trails = new THREE.InstancedMesh(tgeo, tmat, size);
    this.trails.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(size * 3), 3);
    this.trails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trails.frustumCulled = false;
    this.fillIdentity(this.trails, size, 0.34);
    this.group.add(this.trails);

    // bounding box
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, d, h)),
      new THREE.LineBasicMaterial({ color: '#3b82f6', transparent: true, opacity: 0.55 }),
    );
    this.group.add(box);

    // editing layer: translucent plane + grid lines
    this.layerGroup = new THREE.Group();
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2;
    this.layerGroup.add(plane);
    const pts = [];
    for (let x = 0; x <= w; x++) pts.push(x - w / 2, 0, -h / 2, x - w / 2, 0, h / 2);
    for (let y = 0; y <= h; y++) pts.push(-w / 2, 0, y - h / 2, w / 2, 0, y - h / 2);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.layerGroup.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.16 })));
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)),
      new THREE.LineBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.7 }),
    );
    edge.rotation.x = -Math.PI / 2;
    this.layerGroup.add(edge);
    this.group.add(this.layerGroup);

    // hover cursor
    this.ghost = new THREE.Group();
    this.ghost.add(new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false }),
    ));
    this.ghost.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
      new THREE.LineBasicMaterial({ color: '#ffffff' }),
    ));
    this.ghost.visible = false;
    this.group.add(this.ghost);

    this.instanceCell = new Int32Array(size);
    this.setLayer(Math.min(this.layer, d - 1));
    this.resetCamera();
    this.dirty = true;
  }

  disposeMeshes() {
    for (const m of [this.cells, this.trails]) {
      if (!m) continue;
      m.geometry.dispose();
      m.material.dispose();
      m.dispose();
    }
  }

  fillIdentity(mesh, count, scale) {
    const a = mesh.instanceMatrix.array;
    for (let i = 0; i < count; i++) {
      const o = i * 16;
      a[o] = scale; a[o + 5] = scale; a[o + 10] = scale; a[o + 15] = 1;
    }
  }

  resetCamera() {
    const r = Math.max(this.w, this.h, this.d);
    this.camera.position.set(r * 1.25, r * 0.95, r * 1.55);
    this.camera.near = 0.1;
    this.camera.far = r * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.scene.fog = new THREE.Fog('#050c1c', r * 1.4, r * 4.2);
  }

  setLayer(z) {
    this.layer = z;
    if (this.layerGroup) this.layerGroup.position.y = z - this.d / 2;
    this.dirty = true;
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }

  // rebuilds the instance buffers from the age tracker
  update(tracker) {
    const { w, h, d } = this;
    const age = tracker.age;
    const cm = this.cells.instanceMatrix.array;
    const cc = this.cells.instanceColor.array;
    const tm = this.trails.instanceMatrix.array;
    const tc = this.trails.instanceColor.array;
    const zMax = this.cutaway ? this.layer : d - 1;
    const trails = this.options.trails;
    let n = 0;
    let t = 0;
    let i = 0;
    for (let z = 0; z < d; z++) {
      const wy = z - d / 2 + 0.5;
      for (let y = 0; y < h; y++) {
        const wz = y - h / 2 + 0.5;
        for (let x = 0; x < w; x++, i++) {
          const a = age[i];
          if (z > zMax) continue;
          if (a >= 0) {
            const o = n * 16;
            cm[o + 12] = x - w / 2 + 0.5;
            cm[o + 13] = wy;
            cm[o + 14] = wz;
            const c = AGE_LIN[a > AGE_MAX ? AGE_MAX : a];
            cc[n * 3] = c[0];
            cc[n * 3 + 1] = c[1];
            cc[n * 3 + 2] = c[2];
            this.instanceCell[n] = i;
            n++;
          } else if (trails && -a <= TRAIL_MAX) {
            const o = t * 16;
            tm[o + 12] = x - w / 2 + 0.5;
            tm[o + 13] = wy;
            tm[o + 14] = wz;
            const c = TRAIL_LIN[-a];
            tc[t * 3] = c[0];
            tc[t * 3 + 1] = c[1];
            tc[t * 3 + 2] = c[2];
            t++;
          }
        }
      }
    }
    this.cells.count = n;
    this.trails.count = t;
    this.cells.instanceMatrix.clearUpdateRanges();
    this.cells.instanceMatrix.addUpdateRange(0, n * 16);
    this.cells.instanceMatrix.needsUpdate = true;
    this.cells.instanceColor.clearUpdateRanges();
    this.cells.instanceColor.addUpdateRange(0, n * 3);
    this.cells.instanceColor.needsUpdate = true;
    this.trails.instanceMatrix.clearUpdateRanges();
    this.trails.instanceMatrix.addUpdateRange(0, t * 16);
    this.trails.instanceMatrix.needsUpdate = true;
    this.trails.instanceColor.clearUpdateRanges();
    this.trails.instanceColor.addUpdateRange(0, t * 3);
    this.trails.instanceColor.needsUpdate = true;
    this.dirty = false;
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- picking ----------

  // walks the ray through the grid one cell at a time (Amanatides & Woo) and
  // returns the first live, visible cell plus the empty cell just before it
  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const { w, h, d } = this;
    // world -> grid space, where cell (x, y, z) fills [x, x+1) x [y, y+1) x [z, z+1)
    const o = [origin.x + w / 2, origin.z + h / 2, origin.y + d / 2];
    const dir = [direction.x, direction.z, direction.y];
    const size = [w, h, d];

    let hitCell = null;
    let before = null;
    let hitT = Infinity;

    // clip the ray to the grid box
    let t0 = 0;
    let t1 = Infinity;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(dir[k]) < 1e-12) {
        if (o[k] < 0 || o[k] > size[k]) { t1 = -1; break; }
      } else {
        let a = (0 - o[k]) / dir[k];
        let b = (size[k] - o[k]) / dir[k];
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
    }
    const zMax = this.cutaway ? this.layer : d - 1;
    if (t0 <= t1) {
      const p = o.map((v, k) => v + dir[k] * (t0 + 1e-6));
      const cell = p.map((v, k) => Math.min(size[k] - 1, Math.max(0, Math.floor(v))));
      const step = dir.map(v => (v > 0 ? 1 : -1));
      const tDelta = dir.map(v => (Math.abs(v) < 1e-12 ? Infinity : Math.abs(1 / v)));
      const tMax = dir.map((v, k) => {
        if (Math.abs(v) < 1e-12) return Infinity;
        const next = v > 0 ? cell[k] + 1 : cell[k];
        return t0 + (next - p[k]) / v;
      });
      let prev = null;
      let t = t0;
      for (let guard = 0; guard < w + h + d + 3; guard++) {
        const [x, y, z] = cell;
        if (z <= zMax && this.isAlive(x, y, z)) {
          hitCell = [x, y, z];
          before = prev;
          hitT = t;
          break;
        }
        prev = [x, y, z];
        const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
        t = tMax[k];
        if (t > t1) break;
        cell[k] += step[k];
        tMax[k] += tDelta[k];
      }
    }

    // the editing layer's floor
    let planeCell = null;
    let planeT = Infinity;
    if (Math.abs(dir[2]) > 1e-9) {
      const t = (this.layer - o[2]) / dir[2];
      if (t > 0) {
        const x = Math.floor(o[0] + dir[0] * t);
        const y = Math.floor(o[1] + dir[1] * t);
        if (x >= 0 && y >= 0 && x < w && y < h) {
          planeCell = [x, y, this.layer];
          planeT = t;
        }
      }
    }
    return { hitCell, before, hitT, planeCell, planeT };
  }

  target(e) {
    if (this.mode === 'view') return null;
    const p = this.pick(e);
    if (this.mode === 'erase') return p.hitCell ? { cell: p.hitCell, alive: false } : null;
    if (p.planeCell && p.planeT < p.hitT && !this.isAlive(...p.planeCell)) return { cell: p.planeCell, alive: true };
    if (p.hitCell && p.before) return { cell: p.before, alive: true };
    return null;
  }

  bindInput() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', e => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener('pointerup', e => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 5) return;
      const tgt = this.target(e);
      if (tgt) {
        this.onEdit(...tgt.cell, tgt.alive);
        this.showGhost(this.target(e));
      }
    });
    el.addEventListener('pointermove', e => {
      if (down) return;
      this.showGhost(this.target(e));
    });
    el.addEventListener('pointerleave', () => { this.ghost.visible = false; });
  }

  showGhost(tgt) {
    if (!tgt) { this.ghost.visible = false; return; }
    const [x, y, z] = tgt.cell;
    this.ghost.visible = true;
    this.ghost.position.set(x - this.w / 2 + 0.5, z - this.d / 2 + 0.5, y - this.h / 2 + 0.5);
    this.ghost.children[0].material.color.set(tgt.alive ? '#ffffff' : '#f87171');
    this.ghost.children[1].material.color.set(tgt.alive ? '#ffffff' : '#f87171');
  }
}

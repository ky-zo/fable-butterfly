// The corridor itself: steel frame, curb, roof structure, pipe and lamps, the wet floor, and the glass quads.

import * as THREE from 'three';
import { HW, Y0, EAVE, RIDGE, ZB, ZE, ZBACK, BAY, TRANSOM, WALL_LEN, WALL_H, END_W } from './layout.js';
import { SOLID_VERT, SOLID_FRAG, FLOOR_VERT, FLOOR_FRAG } from './corridorShaders.js';
import { makeGlassMaterial } from './glass.js';

const STEEL = 0;
const BRASS = 1;
const STONE = 2;
const ENAMEL = 3;

/** Accumulates boxes / cylinders into one geometry with per-face physical sizes (for edge wear) and a material id. */
class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.dim = [];
    this.kind = [];
    this.idx = [];
    this.m = new THREE.Matrix4();
    this.nm = new THREE.Matrix3();
    this.v = new THREE.Vector3();
  }
  _push(geo, kind, dims) {
    const base = this.pos.length / 3;
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    const uv = geo.attributes.uv;
    this.nm.getNormalMatrix(this.m);
    for (let i = 0; i < p.count; i++) {
      this.v.fromBufferAttribute(p, i).applyMatrix4(this.m);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(n, i).applyMatrix3(this.nm).normalize();
      this.nrm.push(this.v.x, this.v.y, this.v.z);
      this.uv.push(uv.getX(i), uv.getY(i));
      const d = dims(i);
      this.dim.push(d[0], d[1]);
      this.kind.push(kind);
    }
    const ix = geo.index;
    for (let i = 0; i < ix.count; i++) this.idx.push(ix.getX(i) + base);
    geo.dispose();
  }
  /** Axis-aligned box centred at (x,y,z); optional rotation about Z (roof members). */
  box(w, h, d, x, y, z, kind = STEEL, rotZ = 0) {
    this.m.makeRotationZ(rotZ).setPosition(x, y, z);
    const dims = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ];
    this._push(new THREE.BoxGeometry(w, h, d), kind, (i) => dims[Math.floor(i / 4)]);
  }
  /** Cylinder from a to b. */
  rod(a, b, r, kind = STEEL, sides = 10) {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    this.m.compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    this._push(new THREE.CylinderGeometry(r, r, len, sides, 1, false), kind, () => [50, 50]);
  }
  /** Lathe profile around Y at (x, y, z). pts: [[r, y], …] */
  lathe(pts, x, y, z, kind, segs = 20) {
    this.m.makeTranslation(x, y, z);
    this._push(new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), segs), kind, () => [50, 50]);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aDim', new THREE.Float32BufferAttribute(this.dim, 2));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 1));
    g.setIndex(this.idx);
    return g;
  }
}

function buildFrame() {
  const b = new Builder();
  const zs = [];
  for (let z = ZBACK; z >= ZE - 1e-6; z -= BAY) zs.push(z);
  const H = EAVE - Y0;
  const yMid = (EAVE + Y0) / 2;
  const slope = Math.atan2(RIDGE - EAVE, HW);
  const rl = Math.hypot(RIDGE - EAVE, HW);
  for (const side of [-1, 1]) {
    const x = side * HW;
    // curb
    b.box(0.2, Y0, ZBACK - ZE + 0.2, x + side * 0.04, Y0 / 2, (ZBACK + ZE) / 2, STONE);
    b.box(0.07, 0.035, ZBACK - ZE, x - side * 0.02, Y0 + 0.0175, (ZBACK + ZE) / 2, STEEL); // sill
    for (const z of zs) {
      // T-section mullion: web against the glass, flange facing the corridor
      b.box(0.04, H, 0.012, x - side * 0.02, yMid, z, STEEL);
      b.box(0.008, H, 0.052, x - side * 0.044, yMid, z, STEEL);
      // base plate + bolts
      b.box(0.075, 0.008, 0.11, x - side * 0.04, Y0 + 0.039, z, STEEL);
      for (const dz of [-0.038, 0.038]) b.rod([x - side * 0.055, Y0 + 0.043, z + dz], [x - side * 0.055, Y0 + 0.054, z + dz], 0.008, STEEL, 6);
      // cleats at the transom, two bolts each
      b.box(0.006, 0.07, 0.1, x - side * 0.05, TRANSOM, z, STEEL);
      for (const dz of [-0.034, 0.034]) b.rod([x - side * 0.053, TRANSOM, z + dz], [x - side * 0.064, TRANSOM, z + dz], 0.007, STEEL, 6);
      // rafter up to the ridge
      const cx = side * HW * 0.5;
      const cy = (EAVE + RIDGE) / 2;
      b.box(rl, 0.045, 0.012, cx, cy - 0.022, z, STEEL, -side * slope);
      b.box(rl, 0.008, 0.05, cx, cy - 0.048, z, STEEL, -side * slope);
      // gusset at the eave
      b.box(0.006, 0.16, 0.16, x - side * 0.05, EAVE - 0.06, z, STEEL);
      for (const [dy, dz] of [[-0.03, -0.05], [-0.03, 0.05], [-0.1, 0]]) b.rod([x - side * 0.053, EAVE + dy, z + dz], [x - side * 0.063, EAVE + dy, z + dz], 0.007, STEEL, 6);
    }
    // transom and eave plate run the whole length
    b.box(0.032, 0.044, ZBACK - ZE, x - side * 0.016, TRANSOM, (ZBACK + ZE) / 2, STEEL);
    b.box(0.07, 0.07, ZBACK - ZE, x - side * 0.03, EAVE, (ZBACK + ZE) / 2, STEEL);
    // purlin halfway up the slope
    b.box(0.03, 0.05, ZBACK - ZE, side * 0.58, EAVE + (RIDGE - EAVE) * (1 - 0.58 / HW) - 0.03, (ZBACK + ZE) / 2, STEEL, -side * slope);
  }
  // ridge
  b.box(0.06, 0.09, ZBACK - ZE, 0, RIDGE - 0.05, (ZBACK + ZE) / 2, STEEL);
  // tie rods with a turnbuckle, every second bay
  for (let i = 0; i < zs.length; i += 2) {
    const z = zs[i];
    b.rod([-HW + 0.05, EAVE - 0.04, z], [HW - 0.05, EAVE - 0.04, z], 0.007, STEEL, 8);
    b.rod([-0.06, EAVE - 0.04, z], [0.06, EAVE - 0.04, z], 0.014, STEEL, 6);
  }
  // end wall: posts, head, king post in the gable
  b.box(0.1, EAVE - Y0, 0.05, -HW + 0.02, yMid, ZE + 0.025, STEEL);
  b.box(0.1, EAVE - Y0, 0.05, HW - 0.02, yMid, ZE + 0.025, STEEL);
  b.box(END_W, 0.07, 0.06, 0, EAVE, ZE + 0.03, STEEL);
  b.box(END_W + 0.2, Y0, 0.2, 0, Y0 / 2, ZE - 0.04, STONE);
  b.box(END_W, 0.035, 0.07, 0, Y0 + 0.0175, ZE + 0.02, STEEL);
  b.box(0.04, RIDGE - EAVE, 0.03, 0, (RIDGE + EAVE) / 2, ZE + 0.02, STEEL);
  for (const side of [-1, 1]) b.box(rl, 0.05, 0.04, side * HW * 0.5, (EAVE + RIDGE) / 2 - 0.025, ZE + 0.02, STEEL, -side * slope);

  // brass misting line under the ridge, on hangers, with nozzles
  const py = RIDGE - 0.2;
  b.rod([0.0, py, ZBACK], [0.0, py, ZE + 0.1], 0.011, BRASS, 10);
  for (const z of zs) {
    b.rod([0, py, z + 0.5], [0, RIDGE - 0.09, z + 0.5], 0.003, STEEL, 5);
    b.rod([0, py - 0.011, z + 0.25], [0, py - 0.045, z + 0.25], 0.006, BRASS, 8);
    b.rod([0, py - 0.045, z + 0.25], [0, py - 0.052, z + 0.25], 0.009, BRASS, 8);
    b.rod([0, py + 0.016, z - 0.02], [0, py - 0.016, z - 0.02], 0.014, BRASS, 8); // coupling
  }
  // lamps, switched off
  for (const z of [-2.5, -6.5, -10.5]) {
    const top = RIDGE - 0.1;
    const ly = 3.02;
    b.rod([0.16, top, z], [0.16, ly + 0.12, z], 0.0035, ENAMEL, 5);
    b.lathe([[0.012, 0.13], [0.03, 0.12], [0.036, 0.07], [0.09, 0.03], [0.17, -0.02], [0.175, -0.03], [0.165, -0.025], [0.085, 0.022], [0.03, 0.06]], 0.16, ly, z, ENAMEL, 24);
    b.lathe([[0.0, -0.075], [0.03, -0.06], [0.042, -0.025], [0.03, 0.02], [0.016, 0.04]], 0.16, ly, z, ENAMEL, 14);
  }
  return b.build();
}

function quad(a, b, c, d, uvs) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * @returns {{ scene, glass: Material[], mats, floorMat, solidMat, dispose() }}
 */
export function buildCorridor(ctx, shared) {
  const scene = new THREE.Scene();
  const disposables = [];
  const keep = (x) => {
    disposables.push(x);
    return x;
  };
  const taps = ctx.quality.level >= 2 ? 10 : ctx.quality.level === 1 ? 8 : 6;

  // ---- glass
  const glass = [];
  const AMB = {
    left: new THREE.Vector3(0.115, 0.115, 0.098),
    right: new THREE.Vector3(0.075, 0.1, 0.12),
    end: new THREE.Vector3(0.11, 0.115, 0.095),
    roof: new THREE.Vector3(0.14, 0.18, 0.22),
  };
  const addPane = (geo, wall, normal, tanS, amb = AMB.roof, sunGain = 0.36) => {
    const mat = keep(
      makeGlassMaterial({ wall, normal: new THREE.Vector3(...normal), tanS: new THREE.Vector3(...tanS), shared, taps: wall === 3 ? Math.min(taps, 8) : taps, amb, sunGain, tier: ctx.quality.level }),
    );
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(keep(geo), mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    glass.push(mat);
    return mat;
  };
  const L = WALL_LEN;
  const Hh = WALL_H;
  const mats = {};
  mats.left = addPane(quad([-HW, Y0, ZB], [-HW, Y0, ZE], [-HW, EAVE, ZE], [-HW, EAVE, ZB], [[0, 0], [L, 0], [L, Hh], [0, Hh]]), 0, [1, 0, 0], [0, 0, -1], AMB.left, 0.4);
  mats.right = addPane(quad([HW, Y0, ZB], [HW, Y0, ZE], [HW, EAVE, ZE], [HW, EAVE, ZB], [[0, 0], [L, 0], [L, Hh], [0, Hh]]), 1, [-1, 0, 0], [0, 0, -1], AMB.right, 0.04);
  mats.end = addPane(quad([-HW, Y0, ZE], [HW, Y0, ZE], [HW, EAVE, ZE], [-HW, EAVE, ZE], [[0, 0], [END_W, 0], [END_W, Hh], [0, Hh]]), 2, [0, 0, 1], [1, 0, 0], AMB.end, 0.36);
  // static panes: the stretch behind the visitor, the roof, the gable
  const back = ZB - ZBACK;
  addPane(quad([-HW, Y0, ZBACK], [-HW, Y0, ZB], [-HW, EAVE, ZB], [-HW, EAVE, ZBACK], [[back, 0], [0, 0], [0, Hh], [back, Hh]]), 3, [1, 0, 0], [0, 0, -1], AMB.left, 0.4);
  addPane(quad([HW, Y0, ZBACK], [HW, Y0, ZB], [HW, EAVE, ZB], [HW, EAVE, ZBACK], [[back + 40, 0], [40, 0], [40, Hh], [back + 40, Hh]]), 3, [-1, 0, 0], [0, 0, -1], AMB.right, 0.02);
  const rl = Math.hypot(RIDGE - EAVE, HW);
  const rn = [(RIDGE - EAVE) / rl, HW / rl];
  const RL = ZBACK - ZE;
  addPane(quad([-HW, EAVE, ZBACK], [-HW, EAVE, ZE], [0, RIDGE, ZE], [0, RIDGE, ZBACK], [[60, 0], [60 + RL, 0], [60 + RL, rl], [60, rl]]), 3, [rn[0], -rn[1], 0], [0, 0, -1]);
  addPane(quad([HW, EAVE, ZBACK], [HW, EAVE, ZE], [0, RIDGE, ZE], [0, RIDGE, ZBACK], [[90, 0], [90 + RL, 0], [90 + RL, rl], [90, rl]]), 3, [-rn[0], -rn[1], 0], [0, 0, -1]);
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-HW, EAVE, ZE, HW, EAVE, ZE, 0, RIDGE, ZE], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([120, 0, 120 + END_W, 0, 120 + HW, RIDGE - EAVE], 2));
    g.setIndex([0, 1, 2]);
    addPane(g, 3, [0, 0, 1], [1, 0, 0]);
  }

  // ---- steel, brass, stone
  const solidMat = keep(new THREE.ShaderMaterial({ vertexShader: SOLID_VERT, fragmentShader: SOLID_FRAG, uniforms: shared }));
  const frame = new THREE.Mesh(keep(buildFrame()), solidMat);
  frame.frustumCulled = false;
  scene.add(frame);

  // ---- floor (it mirrors the corridor as it was drawn one frame ago: see index.js)
  const floorMat = keep(
    new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      uniforms: { ...shared, tScene: { value: null }, uViewProj: { value: new THREE.Matrix4() } },
    }),
  );
  const fg = new THREE.PlaneGeometry(HW * 2, ZBACK - ZE);
  fg.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(keep(fg), floorMat);
  floor.position.set(0, 0, (ZBACK + ZE) / 2);
  floor.frustumCulled = false;
  scene.add(floor);

  return {
    scene,
    glass,
    mats,
    floorMat,
    solidMat,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

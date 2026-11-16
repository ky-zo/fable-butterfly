// The garden behind the glass: where every plant stands. A few thousand instanced leaves, placed by species-level
// rules ("a fern is a rosette of arching fronds"), densest right behind the panes, with a deliberate number of leaves
// leaning into the glass — the vertex shader presses those flat against the pane instead of letting them through.

import * as THREE from 'three';
import { HW, ZB, ZE, HULL, SUN_DIR, WALLS } from './layout.js';
import { CLEARINGS, QUIET } from './heroes.js';
import { buildLeafGeometries, curveTube, rockGeo, Raw } from './plantGeo.js';
import { makeLeafMaterials, LEAF_TYPES } from './leafShader.js';
import { makeSolidMaterials } from './gardenSolid.js';
import { makeSky, makeGround, makeFloorMask, POOL, pathX } from './gardenEnv.js';
import { PLANT_STAGES } from './planting.js';

const UP = new THREE.Vector3(0, 1, 0);
// far form and the distance (m, from the camera to the edge of a stretch of border) at which it takes over
const LOD = { fern: ['fernLo', 2.7], monstera: ['monsteraLo', 3.8], paddle: ['paddleLo', 3.8], palm: ['palmLo', 4.5] };
const STALK = { monstera: 1.1, monsteraLo: 0, paddle: 0.7, heart: 0.45, blade: 0, fern: 0, fernLo: 0, palm: 0, orchid: 0, bloom: 0, heliconia: 0 };

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Signed distance outside the glass hull (positive = in the garden). */
function outside(p) {
  let m = -Infinity;
  for (let i = 0; i < 5; i++) m = Math.max(m, HULL[i][0] * p.x + HULL[i][1] * p.y + HULL[i][2] * p.z - HULL[i][3]);
  return m;
}

class Batch {
  constructor() {
    this.items = [];
  }
  add(matrix, seed, tint, key) {
    this.items.push({ m: matrix.clone(), seed, tint, key });
  }
}

export class Garden {
  constructor(ctx, shared) {
    this.ctx = ctx;
    this.shared = shared;
    this.scene = new THREE.Scene();
    this.batches = new Map(); // "type|group" → Batch
    this.wood = new Raw();
    this.meshes = [];
    this.clearings = CLEARINGS.map(([wall, s, t, r, len]) => {
      // (wall < 0: a gap that starts at a point in the garden itself, given as [-1, [x, y, z], _, r, len])
      if (wall < 0) return { o: new THREE.Vector3(...s), r, len };
      const w = WALLS[wall];
      return { o: new THREE.Vector3().copy(w.origin).addScaledVector(w.u, s).addScaledVector(w.v, t), r, len };
    });
    this.lods = [];
    this.lodScale = ctx.quality.level >= 2 ? 1 : ctx.quality.level === 1 ? 0.75 : 0.5;
    this.triangles = 0;
  }

  /** Pick the level of detail of each stretch of border for this camera. */
  update(camera) {
    // front to back, stretch by stretch: leaves are cut out with discard, so the depth test is the only thing that
    // keeps hidden ones from being shaded
    for (const m of this.sorted) {
      const d = camera.position.distanceTo(m.boundingSphere.center);
      m.renderOrder = Math.round(d * 8);
      // grass further than a few panes away is under a pixel wide and behind fog: not drawn
      if (m.userData.grass) m.visible = d - m.boundingSphere.radius < 5.2;
    }
    for (const l of this.lods) {
      const near = camera.position.distanceTo(l.centre) - l.radius < l.dist * this.lodScale;
      l.hi.visible = near;
      l.lo.visible = !near;
      l.lo.renderOrder = l.hi.renderOrder;
    }
  }

  // ------------------------------------------------------------------ primitives

  /** Is this point inside one of the gaps that let the sun through to a composed leaf? */
  inClearing(p) {
    for (const c of this.clearings) {
      _c.subVectors(p, c.o);
      const t = _c.dot(SUN_DIR);
      if (t < 0.12 || t > c.len) continue;
      // the tunnel opens up as it leaves the glass
      const r = c.r * (0.45 + 0.55 * Math.min(1, t / 1.2));
      if (_c.addScaledVector(SUN_DIR, -t).lengthSq() < r * r) return true;
    }
    return false;
  }

  /** Is this point in front of a pane that has been kept for composed leaves only (or over the pool, or on the path)? */
  inQuiet(p, deeper = 0) {
    if (p.z < ZE - 0.3 && p.y < 2.6) {
      const dx = (p.x - POOL.x) / (POOL.rx + 0.25);
      const dz = (p.z - POOL.z) / (POOL.rz + 0.25);
      if (dx * dx + dz * dz < 1) return true;
      if (p.y < 0.9 && p.z > ZE - 12 && Math.abs(p.x - pathX(p.z)) < 0.42) return true;
      // and the view from the end pane down the path to the water is kept open above knee height
      if (p.y > 0.42 && p.y < 2.3 && p.z > ZE - 5.6 && p.z < ZE - 0.75 && Math.abs(p.x - pathX(p.z) - 0.35) < 0.5 + (ZE - p.z) * 0.16) return true;
    }
    for (const [wall, s0, s1, t0, t1, depth] of QUIET) {
      const w = WALLS[wall];
      _c.subVectors(p, w.origin);
      const out = -_c.dot(w.n);
      if (out > depth + deeper) continue;
      const ps = _c.dot(w.u);
      const pt = _c.dot(w.v);
      if (ps > s0 && ps < s1 && pt > t0 && pt < t1) return true;
    }
    return false;
  }

  /** Place one leaf: `base` = where the blade starts, `dir` = blade axis, `face` = roughly where its upper side looks. */
  leaf(type, base, dir, face, scale, o = {}) {
    const rnd = this.rnd;
    _y.copy(dir).normalize();
    if (!o.hero) {
      const n = Math.max(3, Math.ceil(scale / 0.14));
      for (let i = 0; i < n; i++) {
        _p.copy(base).addScaledVector(_y, (scale * (i + 0.6)) / n);
        if (this.inClearing(_p) || this.inQuiet(_p)) return;
      }
    }
    _z.copy(face).addScaledVector(_y, -face.dot(_y));
    if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0).addScaledVector(_y, -_y.x);
    _z.normalize();
    _x.crossVectors(_y, _z);
    if (o.roll) {
      _x.applyAxisAngle(_y, o.roll);
      _z.applyAxisAngle(_y, o.roll);
    }
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    _s.set(scale * (o.wide ?? 1), scale, scale);
    _m.compose(base, _q, _s);
    // sort key and shading hints from where the blade's middle ends up
    _p.copy(base).addScaledVector(_y, scale * 0.5);
    const out = outside(_p);
    const ao = THREE.MathUtils.clamp(0.42 + 0.2 * _p.y + (out < 0.25 ? 0.25 : 0) - Math.min(0.25, out * 0.06) + rnd() * 0.25, 0.3, 1);
    const sen = o.sen ?? (rnd() < 0.07 ? 0.6 + rnd() * 0.4 : rnd() * 0.3);
    // groups: the end garden, and each border cut into stretches along the corridor (coarse frustum culling;
    // the shade side never casts into the sun map)
    const group = base.z < ZE - 0.02 ? 'E' : `${base.x < 0 ? 'L' : 'R'}${Math.min(6, Math.max(0, Math.floor((ZB + 1.5 - base.z) / 2.5)))}`;
    const key = `${type}|${group}`;
    let batch = this.batches.get(key);
    if (!batch) this.batches.set(key, (batch = new Batch()));
    // (a composed leaf is never one of the eaten ones: see the tear threshold in the leaf shader)
    let sx = rnd();
    if (o.hero) while ((sx * 13.7) % 1 < 0.16) sx = rnd();
    batch.add(_m, [sx, rnd(), o.phase ?? rnd(), o.pin ?? (out < 0.35 ? 1 : 0)], [o.value ?? 0.25 + rnd() * 0.75, o.hue ?? rnd() * 2 - 1, sen, o.ao ?? ao], out);
  }

  /** Lay a leaf against a pane (see heroes.js). */
  press(wall, s, t, type, size, ang, o = {}) {
    const w = WALLS[wall];
    const base = new THREE.Vector3().copy(w.origin).addScaledVector(w.u, s).addScaledVector(w.v, t).addScaledVector(w.n, -(o.out ?? 0.004));
    const dir = new THREE.Vector3().addScaledVector(w.v, Math.cos(ang)).addScaledVector(w.u, Math.sin(ang)).addScaledVector(w.n, -(o.tilt ?? 0));
    const face = new THREE.Vector3().copy(w.n).multiplyScalar(o.back ? -1 : 1);
    this.leaf(type, base, dir, face, size, { pin: o.loose ? 1 : o.hero === 2 ? 3 : 2, roll: o.roll ?? 0, sen: o.sen ?? this.rnd() * 0.25, hue: o.hue, value: o.value, ao: 1, hero: o.hero || 1, phase: this.rnd() });
  }

  /** Leaf on a stalk growing from `crown`. */
  stalked(type, crown, dir, face, scale, o) {
    _p.copy(dir).normalize();
    const base = new THREE.Vector3().copy(crown).addScaledVector(_p, STALK[type] * scale);
    this.leaf(type, base, dir, face, scale, o);
  }

  /** kind: 0 bark, 1 root / liana, 3 green stem. flare: extra radius at the foot (buttress). */
  trunk(points, r0, r1, sides = 7, kind = 0, flare = 0) {
    for (const q of points) if (this.inClearing(_p.set(q[0], q[1], q[2])) || this.inQuiet(_p)) return false;
    // (wood is dark: no bole may stand close behind a pane that was composed, anywhere along its length)
    if (r0 > 0.05) {
      for (let i = 0; i + 1 < points.length; i++) {
        for (let k = 0; k < 6; k++) {
          const f = k / 6;
          _p.set(points[i][0] + (points[i + 1][0] - points[i][0]) * f, points[i][1] + (points[i + 1][1] - points[i][1]) * f, points[i][2] + (points[i + 1][2] - points[i][2]) * f);
          if (this.inQuiet(_p, 1.9)) return false;
        }
      }
    }
    const { raw } = curveTube(points, (t) => r0 + (r1 - r0) * t + flare * Math.exp(-t * 16), sides, null, kind);
    this.wood.add(raw, null);
    return true;
  }

  /** A stone, half sunk. */
  rock(x, y, z, size, rnd) {
    const g = this.rockShapes[Math.floor(rnd() * this.rockShapes.length)];
    const w = this.wood;
    const base = w.count;
    const a = rnd() * 6.28;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const sx = size * (0.8 + rnd() * 0.5);
    const sz = size * (0.8 + rnd() * 0.5);
    const sy = size * (0.7 + rnd() * 0.5);
    for (let i = 0; i < g.pos.length; i += 3) {
      const px = g.pos[i] * sx;
      const pz = g.pos[i + 2] * sz;
      w.pos.push(x + px * ca - pz * sa, y + g.pos[i + 1] * sy, z + px * sa + pz * ca);
      w.uv.push(0, 0);
      w.aux.push(0, 2);
      w.bend.push(0, 0);
    }
    for (const k of g.idx) w.idx.push(base + k);
  }

  // ------------------------------------------------------------------ species

  /** dir from azimuth (around Y, 0 = +X) and elevation. */
  static dir(az, el, out = new THREE.Vector3()) {
    return out.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
  }

  monstera(crown, toward, n, size, o = {}) {
    const rnd = this.rnd;
    const d = new THREE.Vector3();
    const phase = rnd();
    for (let i = 0; i < n; i++) {
      // half the leaves reach for the glass, the rest fan out
      const lean = i < n * (o.lean ?? 0.45);
      const az = lean ? toward + (rnd() - 0.5) * 1.5 : rnd() * Math.PI * 2;
      const el = lean ? 0.75 + rnd() * 0.55 : 0.5 + rnd() * 0.8;
      Garden.dir(az, el, d);
      const s = size * (0.7 + rnd() * 0.55);
      // faces: up-ish, turned back toward the crown
      const face = new THREE.Vector3(-d.x * 0.6, 1, -d.z * 0.6);
      if (o.lo) this.leaf('monsteraLo', crown.clone().addScaledVector(d, s * 0.5), d, face, s, { phase: phase + rnd() * 0.1, roll: (rnd() - 0.5) * 0.7 });
      else this.stalked('monstera', crown, d, face, s, { phase: phase + rnd() * 0.1, roll: (rnd() - 0.5) * 0.7 });
    }
  }

  fern(crown, n, size, o = {}) {
    const rnd = this.rnd;
    const d = new THREE.Vector3();
    const type = o.lo ? 'fernLo' : 'fern';
    const phase = rnd();
    const a0 = rnd() * 6.28;
    for (let i = 0; i < n; i++) {
      const az = a0 + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const el = (o.el ?? 0.75) + (rnd() - 0.5) * 0.7;
      Garden.dir(az, el, d);
      this.leaf(type, crown, d, UP, size * (0.65 + rnd() * 0.6), { phase: phase + rnd() * 0.15, roll: (rnd() - 0.5) * 0.5, sen: rnd() < 0.1 ? 0.8 : rnd() * 0.3 });
    }
  }

  paddle(crown, n, size) {
    const rnd = this.rnd;
    const d = new THREE.Vector3();
    const phase = rnd();
    for (let i = 0; i < n; i++) {
      const az = rnd() * Math.PI * 2;
      const el = 0.95 + rnd() * 0.5;
      Garden.dir(az, el, d);
      const face = new THREE.Vector3(-d.x, 0.6, -d.z);
      this.stalked('paddle', crown, d, face, size * (0.6 + rnd() * 0.7), { phase: phase + rnd() * 0.1, roll: (rnd() - 0.5) * 1.2, wide: 0.85 + rnd() * 0.4 });
    }
  }

  grass(crown, n, size) {
    const rnd = this.rnd;
    const d = new THREE.Vector3();
    const phase = rnd();
    for (let i = 0; i < n; i++) {
      Garden.dir(rnd() * 6.28, 0.85 + rnd() * 0.65, d);
      this.leaf('blade', crown, d, UP, size * (0.5 + rnd() * 0.8), { phase: phase + rnd() * 0.2, roll: (rnd() - 0.5) * 0.8, wide: 0.8 + rnd() * 1.4 });
    }
  }

  palm(foot, height, n, size, lean = 0, lo = false) {
    const rnd = this.rnd;
    const top = new THREE.Vector3(foot.x + lean * (rnd() - 0.5) * 2, foot.y + height, foot.z + lean * (rnd() - 0.5) * 2);
    if (height > 0.3) this.trunk([[foot.x, foot.y - 0.1, foot.z], [(foot.x + top.x) / 2 + (rnd() - 0.5) * 0.15, foot.y + height * 0.5, (foot.z + top.z) / 2 + (rnd() - 0.5) * 0.15], [top.x, top.y, top.z]], 0.07 + height * 0.012, 0.045);
    const d = new THREE.Vector3();
    const phase = rnd();
    const a0 = rnd() * 6.28;
    for (let i = 0; i < n; i++) {
      Garden.dir(a0 + (i / n) * 6.28 + (rnd() - 0.5) * 0.5, -0.1 + rnd() * 1.05, d);
      this.leaf(lo ? 'palmLo' : 'palm', top, d, UP, size * (0.75 + rnd() * 0.45), { phase: phase + rnd() * 0.1, roll: (rnd() - 0.5) * 0.4, sen: rnd() < 0.12 ? 0.85 : rnd() * 0.25 });
    }
  }

  /**
   * A climber on the glass. wall: 0 left, 1 right, 2 end. (s, t) path in wall metres.
   */
  vine(wall, path, o = {}) {
    const rnd = this.rnd;
    const gapOut = 0.012;
    const toWorld = (s, t, out) => {
      if (wall === 0) return [-(HW + out), t, ZB - s];
      if (wall === 1) return [HW + out, t, ZB - s];
      return [-HW + s, t, ZE - out];
    };
    const n = wall === 0 ? new THREE.Vector3(1, 0, 0) : wall === 1 ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const pts = path.map(([s, t], i) => toWorld(s, t, gapOut + 0.012 * Math.sin(i * 1.7)));
    const { raw, curve } = curveTube(pts, (t) => 0.0045 * (1 - 0.6 * t), 5, pts.length * 6, 3);
    this.wood.add(raw, null);
    const len = curve.getLength();
    const step = o.step ?? 0.085;
    const count = Math.floor(len / step);
    const P = new THREE.Vector3();
    const T = new THREE.Vector3();
    const side = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const face = new THREE.Vector3();
    const phase = rnd();
    for (let i = 1; i < count; i++) {
      const u = (i + (rnd() - 0.5) * 0.5) / count;
      curve.getPointAt(u, P);
      curve.getTangentAt(u, T);
      side.crossVectors(T, n).normalize().multiplyScalar(i % 2 ? 1 : -1);
      // leaves hang: mostly down, kicked out to one side of the stem, lying nearly in the plane of the pane
      dir.set(0, -1, 0).addScaledVector(side, 0.5 + rnd() * 0.9).addScaledVector(T, (rnd() - 0.5) * 0.6).addScaledVector(n, 0.04 + rnd() * 0.1);
      const flip = rnd() < (o.flip ?? 0.35) ? -1 : 1;
      face.copy(n).multiplyScalar(flip).addScaledVector(side, (rnd() - 0.5) * 0.5);
      const sc = (o.size ?? 0.1) * (0.55 + rnd() * 0.75) * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, u * 1.15)));
      this.stalked('heart', P, dir, face, sc, { phase: phase + rnd() * 0.2, pin: 1, roll: (rnd() - 0.5) * 0.5 });
    }
    // a climber in flower: small white blooms along the stem, their faces to the glass
    if (o.blooms) {
      const r2 = this.rnd2;
      for (let i = 0; i < o.blooms; i++) {
        curve.getPointAt(0.25 + 0.75 * r2(), P);
        P.x += (r2() - 0.5) * 0.09 * Math.abs(n.z);
        P.z += (r2() - 0.5) * 0.09 * Math.abs(n.x);
        P.y += (r2() - 0.5) * 0.09;
        dir.set(r2() - 0.5, r2() - 0.5, r2() - 0.5).addScaledVector(n, -dir.dot(n)).normalize();
        this.flower('bloom', P, dir, n, 0.022 + r2() * 0.012, { pin: 1 });
      }
    }
  }

  /** One flower. `face` = the way it looks. Uses its own rng so the planting that was here before it is not disturbed. */
  flower(type, pos, dir, face, size, o = {}) {
    const saved = this.rnd;
    this.rnd = this.rnd2;
    this.leaf(type, pos, dir, face, size, { hero: 1, sen: 0, hue: type === 'bloom' ? -1 : type === 'heliconia' ? 1 : 0, value: o.value ?? 0.7 + this.rnd2() * 0.3, ao: 1, roll: o.roll ?? 0, pin: o.pin ?? 0, phase: o.phase });
    this.rnd = saved;
  }

  // ------------------------------------------------------------------ build

  async build(seed = 11) {
    const { ctx, shared } = this;
    const rnd = (this.rnd = ctx.rng(seed));
    const detail = ctx.quality.level;
    const geos = buildLeafGeometries(ctx.rng(seed + 1), detail >= 1 ? 1 : 0);
    this.rnd2 = ctx.rng(seed + 7);
    const rr = ctx.rng(seed + 3);
    this.rockShapes = [rockGeo(rr), rockGeo(rr), rockGeo(rr)];
    await ctx.yield();
    for (const stage of PLANT_STAGES) {
      stage(this);
      await ctx.yield();
    }

    this.sky = makeSky(ctx.renderer);
    this.scene.add(this.sky.mesh);
    this.mask = makeFloorMask();
    this.scene.add(this.mask);
    this.ground = makeGround(shared, this.sky.texture);
    this.ground.renderOrder = 9000;
    this.scene.add(this.ground);
    ctx.track(this.ground.geometry);
    ctx.track(this.ground.material);

    const mats = {};
    const used = new Set();
    const keys = [...this.batches.keys()].sort();
    let built = 0;
    for (const key of keys) {
      if (++built % 10 === 0) await ctx.yield();
      const [name, group] = key.split('|');
      const items = this.batches.get(key).items;
      if (!items.length) continue;
      used.add(name);
      items.sort((a, b) => a.key - b.key); // nearest the glass first → early-z does the rest
      // instanced attributes live on the geometry, so every group needs its own (index/vertex buffers are shared)
      const src = geos[name];
      const geo = ctx.track(new THREE.BufferGeometry());
      for (const a of Object.keys(src.attributes)) geo.setAttribute(a, src.attributes[a]);
      geo.setIndex(src.index);
      geo.boundingSphere = (src.boundingSphere || (src.computeBoundingSphere(), src.boundingSphere)).clone();
      geo.boundingBox = null;
      const type = LEAF_TYPES[name];
      if (!mats[type]) {
        mats[type] = makeLeafMaterials(type, shared);
        ctx.track(mats[type].material);
        ctx.track(mats[type].shadowMaterial);
      }
      const mesh = new THREE.InstancedMesh(geo, mats[type].material, items.length);
      const seeds = new Float32Array(items.length * 4);
      const tints = new Float32Array(items.length * 4);
      items.forEach((it, i) => {
        mesh.setMatrixAt(i, it.m);
        seeds.set(it.seed, i * 4);
        tints.set(it.tint, i * 4);
      });
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
      geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 4));
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += 0.3;
      if (group[0] !== 'R' && name !== 'blade') mesh.userData.shadowMaterial = mats[type].shadowMaterial;
      if (name === 'blade' && group !== 'E') mesh.userData.grass = true;
      this.scene.add(mesh);
      this.meshes.push(mesh);
      this.triangles += (src.index.count / 3) * items.length;
      // level of detail: a fern frond is a thousand triangles. Past a few metres it is drawn from a 200-triangle form,
      // through the very same instance buffers (and likewise the other big leaves).
      if (LOD[name]) {
        const lg = ctx.track(new THREE.BufferGeometry());
        const ls = geos[LOD[name][0]];
        for (const a of Object.keys(ls.attributes)) lg.setAttribute(a, ls.attributes[a]);
        lg.setIndex(ls.index);
        lg.setAttribute('aSeed', geo.attributes.aSeed);
        lg.setAttribute('aTint', geo.attributes.aTint);
        lg.boundingSphere = geo.boundingSphere.clone();
        const lo = new THREE.InstancedMesh(lg, mats[type].material, items.length);
        lo.instanceMatrix = mesh.instanceMatrix;
        lo.boundingSphere = mesh.boundingSphere.clone();
        lo.visible = false;
        this.scene.add(lo);
        this.lods.push({ hi: mesh, lo, centre: mesh.boundingSphere.center, radius: mesh.boundingSphere.radius, dist: LOD[name][1] });
      }
    }
    this.sources = Object.values(geos);
    this.mats = mats;

    await ctx.yield();
    // trunks, roots, lianas, stems and stones: one merged mesh with its own shader
    if (this.wood.count) {
      const geo = ctx.track(this.wood.toGeometry());
      geo.deleteAttribute('uv');
      geo.deleteAttribute('aBend');
      const sm = makeSolidMaterials(shared);
      sm.material.side = sm.shadowMaterial.side = THREE.DoubleSide;
      ctx.track(sm.material);
      ctx.track(sm.shadowMaterial);
      const mesh = new THREE.Mesh(geo, sm.material);
      mesh.frustumCulled = false;
      mesh.userData.shadowMaterial = sm.shadowMaterial;
      mesh.renderOrder = -5;
      this.scene.add(mesh);
      this.solid = mesh;
      this.triangles += geo.index.count / 3;
    }
    this.sorted = this.meshes.filter((m) => m.boundingSphere);
    this.batches = null;
    this.wood = null;
    this.rockShapes = null;
  }

  dispose() {
    for (const m of this.meshes) m.dispose();
    for (const l of this.lods) l.lo.dispose();
    for (const g of this.sources || []) g.dispose();
    this.sky?.dispose();
    if (this.mask) {
      this.mask.geometry.dispose();
      this.mask.material.dispose();
    }
  }
}

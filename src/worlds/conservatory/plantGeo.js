// Procedural leaf geometry. Everything is built at unit length in a leaf-local frame:
//   +Y runs from the base of the blade to its tip, +X across it, +Z is the upper face.
// Attributes:
//   uv    (u, v)   u = -1..1 across the blade (±1 = the margin), v = 0..1 along it. u > 4 marks stalk geometry.
//   aAux  (a, b)   a = position along the whole frond (compound leaves), b = a per-leaflet random
//   aBend (s, f)   s = how much this vertex sways in the wind (0 at the base), f = flutter weight

import * as THREE from 'three';

const lerp = (a, b, t) => a + (b - a) * t;

/** Bump profile with its maximum (1) at a/(a+b). */
const bump = (v, a, b) => {
  if (v <= 0 || v >= 1) return 0;
  const m = a / (a + b);
  return (Math.pow(v, a) * Math.pow(1 - v, b)) / (Math.pow(m, a) * Math.pow(1 - m, b));
};

export const PROFILES = {
  lance: (v) => bump(v, 0.55, 1.15),
  paddle: (v) => Math.pow(bump(v, 0.5, 0.42), 0.8) * (1 - 0.1 * v),
  oval: (v) => bump(v, 0.6, 0.75),
  blade: (v) => Math.pow(Math.max(0, 1 - v), 0.55) * Math.min(1, v * 14 + 0.25),
  heart: (v) => {
    if (v < 0) return 0.97 * Math.sqrt(Math.max(0, 1 - Math.pow(v / -0.2, 2.2)));
    return (0.97 + 0.03 * Math.sin(Math.PI * Math.min(1, v * 3))) * Math.pow(Math.max(0, 1 - v), 0.6) * (1 - 0.22 * v);
  },
  monstera: (v) => {
    if (v < 0) return 0.95 * Math.sqrt(Math.max(0, 1 - Math.pow(v / -0.24, 2.4)));
    return (0.95 + 0.05 * Math.sin(Math.PI * Math.min(1, v * 2.2))) * Math.pow(Math.max(0, 1 - v), 0.5) * (1 - 0.1 * v);
  },
};

class Raw {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.aux = [];
    this.bend = [];
    this.idx = [];
  }
  get count() {
    return this.pos.length / 3;
  }
  /** Append another Raw, transformed by a Matrix4, optionally overriding aux and remapping bend. */
  add(other, m, aux = null, bendFn = null) {
    const base = this.count;
    const v = new THREE.Vector3();
    for (let i = 0; i < other.count; i++) {
      v.set(other.pos[i * 3], other.pos[i * 3 + 1], other.pos[i * 3 + 2]);
      if (m) v.applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      this.uv.push(other.uv[i * 2], other.uv[i * 2 + 1]);
      if (aux) this.aux.push(aux[0], aux[1]);
      else this.aux.push(other.aux[i * 2], other.aux[i * 2 + 1]);
      if (bendFn) {
        const b = bendFn(other.bend[i * 2], other.bend[i * 2 + 1]);
        this.bend.push(b[0], b[1]);
      } else this.bend.push(other.bend[i * 2], other.bend[i * 2 + 1]);
    }
    for (const k of other.idx) this.idx.push(k + base);
    return this;
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aAux', new THREE.Float32BufferAttribute(this.aux, 2));
    g.setAttribute('aBend', new THREE.Float32BufferAttribute(this.bend, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/**
 * A single blade.
 *  width      half-width at the widest point (in units of length = 1)
 *  profile    v → 0..1 relative half-width
 *  nu, nv     quads across (even) and along
 *  vMin       where the blade starts (negative for basal lobes behind the stalk)
 *  fold       V-fold along the midrib (rad), relaxes toward the tip
 *  arch       total bend toward -Z from base to tip (rad); archPow shapes where it happens
 *  cup        margins curl (+ up / - down)
 *  wave       ruffled margin: { amp, freq, phase }
 *  twist      rotation about the midrib accumulated to the tip (rad)
 *  stalk      { len, r, sag } petiole behind the base
 */
export function blade(o = {}) {
  const { width = 0.3, profile = PROFILES.oval, nu = 4, nv = 8, vMin = 0, fold = 0.25, arch = 0.5, archPow = 1.4, cup = 0, wave = null, twist = 0, stalk = null, flutter = 0 } = o;
  const raw = new Raw();
  const rows = nv + 1;
  const cols = nu + 1;
  // centreline
  const c = new THREE.Vector3(0, vMin, 0);
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  let prevV = vMin;
  for (let j = 0; j < rows; j++) {
    // rows crowd toward the base and the tip, where the outline turns fastest
    const tj = j / nv;
    const v = lerp(vMin, 1, lerp(tj, 0.5 - 0.5 * Math.cos(Math.PI * tj), 0.8));
    const vc = Math.max(0, v);
    const th = arch * Math.pow(vc, archPow);
    T.set(0, Math.cos(th), -Math.sin(th));
    if (j > 0) {
      // integrate with the mid-angle of the step
      const vm = Math.max(0, (v + prevV) / 2);
      const tm = arch * Math.pow(vm, archPow);
      c.x += 0;
      c.y += Math.cos(tm) * (v - prevV);
      c.z += -Math.sin(tm) * (v - prevV);
    }
    prevV = v;
    N.set(0, Math.sin(th), Math.cos(th));
    B.set(1, 0, 0);
    const tw = twist * vc;
    if (tw !== 0) {
      B.applyAxisAngle(T, tw);
      N.applyAxisAngle(T, tw);
    }
    const w = width * profile(v);
    const fo = fold * (1 - 0.55 * vc);
    for (let i = 0; i < cols; i++) {
      const u = lerp(-1, 1, i / nu);
      const au = Math.abs(u);
      let lift = au * w * Math.sin(fo) + cup * u * u * w;
      if (wave) lift += wave.amp * au * au * Math.sin(v * wave.freq + (u > 0 ? 0 : 1.7) + (wave.phase || 0)) * w;
      const x = u * w * Math.cos(fo);
      raw.pos.push(c.x + B.x * x + N.x * lift, c.y + B.y * x + N.y * lift, c.z + B.z * x + N.z * lift);
      raw.uv.push(u, v);
      raw.aux.push(0, 0);
      raw.bend.push(vc * vc, flutter * vc);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      raw.idx.push(a, b, e, a, e, d);
    }
  }
  if (stalk) raw.add(tube([0, 0, 0], [0, -stalk.len, 0], stalk.r, stalk.r * 1.5, stalk.sag || 0, 5, 5));
  return raw;
}

/** Tapered tube from a to b sagging toward -Z. Marked as stalk (u = 5). */
export function tube(a, b, r0, r1, sag = 0, segs = 5, sides = 5, bend = [0, 0]) {
  const raw = new Raw();
  const A = new THREE.Vector3(...a);
  const Bv = new THREE.Vector3(...b);
  const axis = new THREE.Vector3().subVectors(Bv, A);
  const len = axis.length();
  axis.normalize();
  const ref = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const X = new THREE.Vector3().crossVectors(axis, ref).normalize();
  const Y = new THREE.Vector3().crossVectors(axis, X).normalize();
  const p = new THREE.Vector3();
  for (let j = 0; j <= segs; j++) {
    const t = j / segs;
    const r = lerp(r0, r1, t);
    p.copy(A).addScaledVector(axis, len * t);
    p.z -= sag * Math.sin(Math.PI * t) * len;
    for (let i = 0; i < sides; i++) {
      const an = (i / sides) * Math.PI * 2;
      raw.pos.push(p.x + (X.x * Math.cos(an) + Y.x * Math.sin(an)) * r, p.y + (X.y * Math.cos(an) + Y.y * Math.sin(an)) * r, p.z + (X.z * Math.cos(an) + Y.z * Math.sin(an)) * r);
      raw.uv.push(5, t);
      raw.aux.push(0, 0);
      raw.bend.push(bend[0], bend[1]);
    }
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < sides; i++) {
      const a0 = j * sides + i;
      const a1 = j * sides + ((i + 1) % sides);
      raw.idx.push(a0, a1, a1 + sides, a0, a1 + sides, a0 + sides);
    }
  }
  return raw;
}

/**
 * A compound leaf: leaflets in pairs along an arching rachis (fern frond, palm frond).
 *  pairs        number of leaflet pairs
 *  outline      v → relative leaflet length along the frond
 *  leafLen      longest leaflet, in frond lengths
 *  leaf         options for blade() of one leaflet
 *  angle        angle between leaflet and rachis at the base / tip (rad)
 *  arch         frond droop (rad)
 *  droop        how much leaflets hang (rad)
 *  jitter       randomness 0..1
 */
export function frond(o = {}, rnd = Math.random) {
  const { pairs = 26, outline = (v) => bump(v, 0.5, 0.9), leafLen = 0.2, leaf = {}, angle = [1.35, 0.75], arch = 0.9, archPow = 1.6, droop = 0.25, jitter = 0.5, start = 0.1, rachis = 0.006, vTwist = 0.0 } = o;
  const raw = new Raw();
  const pt = (v) => {
    // closed-form-ish integration of the arching centreline
    const n = 24;
    let y = 0;
    let z = 0;
    for (let i = 0; i < n; i++) {
      const vm = ((i + 0.5) / n) * v;
      const th = arch * Math.pow(vm, archPow);
      y += (Math.cos(th) * v) / n;
      z += (-Math.sin(th) * v) / n;
    }
    return [0, y, z];
  };
  // rachis
  const segs = o.rachisSegs ?? 10;
  for (let i = 0; i < segs; i++) {
    const v0 = i / segs;
    const v1 = (i + 1) / segs;
    raw.add(tube(pt(v0), pt(v1), rachis * (1 - 0.8 * v0), rachis * (1 - 0.8 * v1), 0, 1, 3), null, [v0, 0], () => [v0 * v0, 0]);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let k = 0; k < pairs; k++) {
    const v = lerp(start, 0.985, k / (pairs - 1));
    const th = arch * Math.pow(v, archPow);
    const len = leafLen * Math.max(0.06, outline(v));
    for (const side of [-1, 1]) {
      const vv = v + (side > 0 ? 0.5 / pairs : 0) * 0.6 + (rnd() - 0.5) * jitter * 0.01;
      const lf = blade({ ...leaf, arch: (leaf.arch ?? 0.3) + droop * (0.6 + rnd() * 0.8), twist: (rnd() - 0.5) * jitter * 0.5 });
      const a = lerp(angle[0], angle[1], v) + (rnd() - 0.5) * jitter * 0.25;
      // leaflet local +Y → pointing sideways (±X), swept toward the tip (+Y), lying in the frond plane
      e.set(-th + (rnd() - 0.5) * jitter * 0.3, vTwist * side, -side * a, 'XZY');
      q.setFromEuler(e);
      const c = pt(Math.min(1, vv));
      p.set(c[0], c[1], c[2]);
      s.setScalar(len * (1 + (rnd() - 0.5) * jitter * 0.3));
      m.compose(p, q, s);
      const hsh = rnd();
      raw.add(lf, m, [v, hsh], (bs, bf) => [v * v + 0.12 * bs, 0.5 + bs]);
    }
  }
  return raw;
}

/** The six leaf forms of this garden. Returns { name: BufferGeometry }. */
export function buildLeafGeometries(rnd, detail = 1) {
  const out = {};
  const hi = detail >= 1;
  out.monstera = blade({ width: 0.44, profile: PROFILES.monstera, nu: hi ? 10 : 6, nv: hi ? 18 : 10, vMin: -0.24, fold: 0.16, arch: 0.5, archPow: 1.8, cup: -0.05, wave: { amp: 0.05, freq: 13 }, stalk: { len: 1.1, r: 0.013, sag: 0.05 } }).toGeometry();
  out.monsteraLo = blade({ width: 0.44, profile: PROFILES.monstera, nu: 4, nv: 6, vMin: -0.24, fold: 0.16, arch: 0.5, archPow: 1.8, cup: -0.05 }).toGeometry();
  out.paddle = blade({ width: 0.2, profile: PROFILES.paddle, nu: hi ? 6 : 4, nv: hi ? 14 : 9, fold: 0.22, arch: 0.55, archPow: 1.5, wave: { amp: 0.035, freq: 11 }, stalk: { len: 0.7, r: 0.011, sag: 0.03 } }).toGeometry();
  out.paddleLo = blade({ width: 0.2, profile: PROFILES.paddle, nu: 2, nv: 6, fold: 0.22, arch: 0.55, archPow: 1.5 }).toGeometry();
  out.heart = blade({ width: 0.4, profile: PROFILES.heart, nu: 4, nv: hi ? 8 : 6, vMin: -0.2, fold: 0.2, arch: 0.45, archPow: 1.6, cup: -0.06, stalk: { len: 0.45, r: 0.016, sag: 0.02 } }).toGeometry();
  // (enough rows that the bow is a curve and not three straight pieces when a blade comes near the lens)
  out.blade = blade({ width: 0.024, profile: PROFILES.blade, nu: 2, nv: hi ? 18 : 10, fold: 0.5, arch: 1.9, archPow: 1.7, twist: 0.5 }).toGeometry();
  out.fern = frond(
    { pairs: hi ? 30 : 22, leafLen: 0.19, leaf: { width: hi ? 0.105 : 0.14, profile: PROFILES.lance, nu: 2, nv: 4, fold: 0.3, arch: 0.25, flutter: 1 }, arch: 1.1, droop: 0.35, angle: [1.4, 0.8], jitter: 0.6 },
    rnd,
  ).toGeometry();
  out.fernLo = frond(
    { pairs: 15, leafLen: 0.2, leaf: { width: 0.2, profile: PROFILES.lance, nu: 1, nv: 3, fold: 0.3, arch: 0.25, flutter: 1 }, arch: 1.2, droop: 0.35, angle: [1.4, 0.8], jitter: 0.6, rachisSegs: 6 },
    rnd,
  ).toGeometry();
  out.palm = frond(
    {
      pairs: hi ? 22 : 16,
      outline: (v) => Math.pow(bump(v, 0.35, 0.6), 0.6),
      leafLen: 0.42,
      leaf: { width: 0.062, profile: PROFILES.lance, nu: 1, nv: 3, fold: 0.5, arch: 0.5, archPow: 1.2, flutter: 1 },
      arch: 1.25,
      archPow: 1.4,
      droop: 0.7,
      angle: [1.1, 0.55],
      jitter: 0.8,
      start: 0.22,
      rachis: 0.011,
      rachisSegs: 8,
    },
    rnd,
  ).toGeometry();
  out.orchid = orchid(rnd).toGeometry();
  out.bloom = bloom(rnd).toGeometry();
  out.heliconia = heliconia(rnd).toGeometry();
  out.palmLo = frond(
    {
      pairs: 10,
      outline: (v) => Math.pow(bump(v, 0.35, 0.6), 0.6),
      leafLen: 0.42,
      leaf: { width: 0.12, profile: PROFILES.lance, nu: 1, nv: 2, fold: 0.5, arch: 0.5, archPow: 1.2, flutter: 1 },
      arch: 1.25,
      archPow: 1.4,
      droop: 0.7,
      angle: [1.1, 0.55],
      jitter: 0.8,
      start: 0.22,
      rachis: 0.011,
      rachisSegs: 4,
    },
    rnd,
  ).toGeometry();
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Flowers. Each is one small merged geometry built from blades; aAux.x says which part a vertex belongs to
// (0 = petal, 1 = lip / bract tip / throat) and the petal shader colours it by species.

const _fm = new THREE.Matrix4();
const _fq = new THREE.Quaternion();
const _fe = new THREE.Euler();
const _fs = new THREE.Vector3();
const _fp = new THREE.Vector3();
function addPetal(raw, opts, pos, euler, scale, part, rnd) {
  const lf = blade(opts);
  _fe.set(euler[0], euler[1], euler[2], 'ZXY');
  _fq.setFromEuler(_fe);
  _fp.set(pos[0], pos[1], pos[2]);
  _fs.setScalar(scale);
  _fm.compose(_fp, _fq, _fs);
  raw.add(lf, _fm, [part, rnd()], (bs) => [0.3 + 0.5 * bs, 0.6]);
}

/** A moth orchid, face on: three narrow sepals, two broad petals, a small cupped lip. Unit = the flower's span. */
export function orchid(rnd) {
  const raw = new Raw();
  const sep = { width: 0.2, profile: PROFILES.oval, nu: 2, nv: 4, fold: 0.1, arch: 0.25, cup: 0.1 };
  const pet = { width: 0.42, profile: PROFILES.paddle, nu: 4, nv: 5, fold: 0.06, arch: 0.3, cup: -0.12 };
  for (const a of [0, 2.2, -2.2]) addPetal(raw, sep, [0, 0, -0.01], [0, 0, a], 0.5, 0, rnd);
  for (const a of [1.15, -1.15]) addPetal(raw, pet, [0, 0, 0], [0, 0, a], 0.52, 0, rnd);
  addPetal(raw, { width: 0.4, profile: PROFILES.heart, vMin: -0.15, nu: 4, nv: 4, fold: 0.7, arch: -0.9, cup: 0.3 }, [0, -0.03, 0.03], [0.9, 0, Math.PI], 0.26, 1, rnd);
  return raw;
}

/** A small five-petalled bloom (jasmine). */
export function bloom(rnd) {
  const raw = new Raw();
  for (let i = 0; i < 5; i++) addPetal(raw, { width: 0.2, profile: PROFILES.oval, nu: 2, nv: 3, fold: 0.15, arch: 0.5, twist: 0.35 }, [0, 0, 0], [0.35, 0, (i / 5) * Math.PI * 2 + 0.2], 0.5, 0, rnd);
  addPetal(raw, { width: 0.5, profile: PROFILES.oval, nu: 2, nv: 2, fold: 0.0, arch: 0.0 }, [0, -0.05, 0.02], [0, 0, 0], 0.1, 1, rnd);
  return raw;
}

/** A hanging heliconia: boat-shaped bracts alternating down a zig-zag rachis. Hangs along -Y; unit = its length. */
export function heliconia(rnd) {
  const raw = new Raw();
  const n = 9;
  let x = 0;
  let prev = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    const y = -0.06 - (i / n) * 0.94;
    x = side * 0.028;
    const cur = [x, y, 0];
    raw.add(tube(prev, cur, 0.012, 0.011, 0, 1, 4), null, [1, 0], () => [0.2 + 0.6 * (i / n), 0]);
    prev = cur;
    const sc = 0.3 * (1 - 0.45 * (i / n));
    addPetal(raw, { width: 0.21, profile: PROFILES.lance, nu: 4, nv: 6, fold: 1.05, arch: -0.5, archPow: 1.3 }, cur, [0.15, 0, -side * 1.95], sc, 0, rnd);
  }
  // the stalk it hangs from
  raw.add(tube([0, 0.25, 0], [0, 0, 0], 0.012, 0.012, 0.05, 3, 4), null, [1, 0], () => [0.1, 0]);
  return raw;
}

/** A lumpy stone: a subdivided icosahedron, welded, pushed about and flattened. Returns { pos: number[], idx: number[] } at unit size. */
export function rockGeo(rnd) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const seen = new Map();
  const pos = [];
  const idx = [];
  const v = new THREE.Vector3();
  const lobes = Array.from({ length: 5 }, () => [new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), 0.12 + rnd() * 0.25]);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) {
      let d = 1;
      for (const [dir, amp] of lobes) d += amp * Math.max(0, v.dot(dir)) ** 2;
      d *= 0.9 + rnd() * 0.16;
      k = pos.length / 3;
      seen.set(key, k);
      pos.push(v.x * d, v.y * d * 0.62, v.z * d);
    }
    idx.push(k);
  }
  g.dispose();
  return { pos, idx };
}

/** A curved vine / liana / trunk as one merged tube. points: array of [x,y,z]; radius fn of t. */
export function curveTube(points, radius, sides = 6, steps = null, kind = 0) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    false,
    'centripetal',
    0.5,
  );
  const n = steps || Math.max(6, points.length * 5);
  const raw = new Raw();
  const frames = curve.computeFrenetFrames(n, false);
  const p = new THREE.Vector3();
  for (let j = 0; j <= n; j++) {
    const t = j / n;
    curve.getPoint(t, p);
    const r = typeof radius === 'function' ? radius(t) : radius;
    const Nn = frames.normals[j];
    const Bn = frames.binormals[j];
    for (let i = 0; i < sides; i++) {
      const an = (i / sides) * Math.PI * 2;
      const cx = Math.cos(an);
      const sy = Math.sin(an);
      raw.pos.push(p.x + (Nn.x * cx + Bn.x * sy) * r, p.y + (Nn.y * cx + Bn.y * sy) * r, p.z + (Nn.z * cx + Bn.z * sy) * r);
      raw.uv.push(5 + i / sides, t * curve.getLength());
      raw.aux.push(t, kind);
      raw.bend.push(0, 0);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < sides; i++) {
      const a0 = j * sides + i;
      const a1 = j * sides + ((i + 1) % sides);
      raw.idx.push(a0, a1, a1 + sides, a0, a1 + sides, a0 + sides);
    }
  }
  return { raw, curve };
}

export { Raw };

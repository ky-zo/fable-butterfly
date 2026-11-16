// Mirror — what the liquid does. Everything the shader draws of it is decided here, on the CPU: which shape it is
// trying, where every lobe and droplet is, how far the wings have grown.
//
// What it tries is a function of progress, and each attempt is nearer the animal:
//   a drop → a ring, a knot (a shape, any shape) → two halves (it has sides) → four paddles on a body (it has parts)
//   → wings: the kit's own outline and veins, grown out from where they hinge, the film between the veins letting go.
// Through all of it a few points do not move (POINTS): the clusters of cells that were there the whole time.
//
// Sphere slots:  0 the swelling toward whoever is watching · 1–2 halves · 3–10 paddles · 11–26 the body, laid along the
//                kit's own curves (thorax, head, eyes, abdomen) · 27–31 beads it sheds when it changes its mind
//                · 32–47 droplets (press, and it scatters; they find their way back)

import * as THREE from 'three';
import { clamp, lerp, smoothstep, damp, band } from '../../core/util.js';
import { wingFrame, thoraxAt, abdomenAt, headAt, EYE, EYE_R } from '../../shared/butterfly/index.js';
import { NS, NRING } from './sdf.glsl.js';
import { key } from './story.js';

export const HOME = new THREE.Vector3(0, 0, 0);
export const R0 = 0.5;
/** world units inside per millimetre of the animal, and where its thorax is */
export const BF_MM = 0.045;
export const BF_C = new THREE.Vector3(0, 0.1, 0);
const mm = (x, y, z) => new THREE.Vector3(BF_C.x + x * BF_MM, BF_C.y + y * BF_MM, BF_C.z + z * BF_MM);
/** The points that never dissolved (body frame, mm → inside): wings, eyes, legs, the far end of the abdomen. */
export const POINTS = [
  mm(2.9, 1.55, 1.6), mm(-2.9, 1.55, 1.6), mm(2.95, -0.75, 1.45), mm(-2.95, -0.75, 1.45), // where the four wings will hinge
  mm(0.75, 4.1, 0.2), mm(-0.75, 4.1, 0.2), // eyes
  mm(1.3, 0.4, -1.4), mm(-1.3, 0.4, -1.4), // legs
  mm(0, -6.05, -0.05), mm(0, -10.7, -0.45), // down the abdomen (the kit's: abdomenAt(0.4), abdomenAt(0.92))
];

// the body, from the kit's curves: [x, y, z, radius] in millimetres. 0–1 thorax (the core is its middle), 2 head,
// 3–4 eyes, 5… abdomen
const BODY = [];
for (const t of [0.2, 0.8]) {
  const c = thoraxAt(t);
  BODY.push([0, c.y, c.z, 0.47 * (c.rx + c.rz)]);
}
{
  const c = headAt(0.5);
  BODY.push([0, c.y, c.z, 0.36 * (c.rx + c.rz)]);
  for (const sx of [1, -1]) BODY.push([(EYE[0] + 0.2) * sx, EYE[1], EYE[2], EYE_R[0] * 0.98]);
}
for (const t of [0.04, 0.13, 0.23, 0.33, 0.43, 0.53, 0.63, 0.72, 0.81, 0.89, 0.96]) {
  const c = abdomenAt(t);
  BODY.push([0, c.y, c.z, 0.5 * (c.rx + c.rz)]);
}
const BODY0 = 11;
const SAT0 = BODY0 + BODY.length; // 27
// beads it sheds between one shape and the next: [from p, to p, which way (x, y, z), how far, radius]
const SATS = [
  [0.398, 0.448, [0.25, 1, 0.3], 0.62, 0.07],
  [0.44, 0.502, [1, -0.5, 0.35], 0.5, 0.058],
  [0.446, 0.508, [-1, -0.42, -0.3], 0.46, 0.05],
  [0.5, 0.574, [0.12, -1, 0.2], 0.34, 0.04],
  [0.512, 0.566, [0.8, 0.75, 0.3], 0.5, 0.046],
];
const DROP0 = SAT0 + SATS.length; // 32
const DROPS = NS - DROP0;
// where it changes its mind: the surface is restless there
const TURNS = [0.345, 0.372, 0.404, 0.418, 0.462, 0.5, 0.538, 0.572];
const USED = DROP0 + DROPS;
const OFF = -10;
const K_R0 = [[0, 0.5], [0.408, 0.5], [0.44, 0.34], [0.468, 0.26], [0.5, 0.2], [0.54, 0.13], [0.57, 0.084], [1, 0.084]];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Form {
  constructor(rng, uniforms) {
    this.u = uniforms;
    this.rng = rng;
    this.tau = 0;
    this.clock = 0;
    this.center = HOME.clone();
    this.axis = new THREE.Vector3(0, 0, 1);
    this.ex = new THREE.Vector3(1, 0, 0);
    this.ez = new THREE.Vector3(0, 0, 1);
    this.R = 0;
    this.a = 0;
    this.r = R0;
    this.k = 0.085;
    this.bodyR = R0;
    this.reach = R0;
    this.sph = uniforms.uSph.value;
    this.sphK = uniforms.uSphK.value;
    for (let i = 0; i < NS; i++) this.sph[i * 4 + 3] = OFF;

    this.aDir = new THREE.Vector3(0.2, 0.15, 1).normalize();
    this.aVel = new THREE.Vector3();
    this.engage = 0;
    this.wasHit = false;
    this.sinceRing = 9;
    this.ghostRingAt = 3.5;
    this.rings = Array.from({ length: NRING }, () => ({ o: new THREE.Vector3(), age: 99, amp: 0 }));
    this.ringI = 0;

    this.drops = Array.from({ length: DROPS }, (_, i) => ({
      on: false,
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      r: i < 4 ? rng.range(0.15, 0.2) : i < 10 ? rng.range(0.08, 0.12) : rng.range(0.04, 0.065),
      grow: 0,
      age: 0,
      delay: 0,
      back: false,
      homing: 0,
      spin: new THREE.Vector3(rng.gauss(), rng.gauss() * 0.5 + 1.2, rng.gauss()).normalize(),
      shell: 0,
    }));
    this.scattered = false;
    this.releaseAt = -99;
    this.wasDown = false;
    this.dropVol = 0;

    this.events = { touch: 0, shatter: 0, merge: 0 };
    this.wings = 0; // how much of it is the animal now
    this.turn = 0;
    this.restless = 0;
    this._o = new THREE.Vector3();
    this._ax = new THREE.Vector3();
    this._ay = new THREE.Vector3();
  }

  ring(dir, amp) {
    const r = this.rings[this.ringI];
    this.ringI = (this.ringI + 1) % NRING;
    r.o.copy(dir).multiplyScalar(this.bodyR);
    r.age = 0;
    r.amp = amp;
    this.sinceRing = 0;
    this.events.touch++;
  }

  shatter(away) {
    const rng = this.rng;
    for (let i = 0; i < DROPS; i++) {
      const dr = this.drops[i];
      const y = 1 - (2 * (i + 0.5)) / DROPS;
      const rad = Math.sqrt(1 - y * y);
      const th = i * 2.399963 + rng() * 0.7;
      const dir = _a.set(Math.cos(th) * rad, y * 0.7 + 0.02, Math.sin(th) * rad).addScaledVector(away, 0.3).normalize();
      if (dr.on) dr.v.addScaledVector(dir, 1.0 + rng());
      else {
        dr.p.copy(this.center).addScaledVector(dir, this.bodyR * 0.55);
        dr.v.copy(dir).multiplyScalar((0.9 + 1.4 * rng()) * (1.15 - 0.55 * (dr.r / 0.2)));
        dr.grow = 0;
        dr.age = 0;
        dr.on = true;
      }
      dr.back = false;
      dr.homing = 0;
      dr.delay = 2.0 + 3.0 * rng() + (i < 4 ? 0.8 : 0);
      dr.shell = this.bodyR * 0.6 + 0.3 + rng() * 0.5;
    }
    this.scattered = true;
    this.events.shatter++;
  }

  /** @param camera the lens inside   @param on false while nobody is in here (nothing is advanced) */
  update(frame, camera) {
    const { dt, progress: p, pointer } = frame;
    const u = this.u;
    const s = this.sph;
    const K = this.sphK;
    this.tau += dt;
    this.clock += dt;
    const tau = this.tau;
    const real = pointer.inside && pointer.idle < 6;

    // ---- what it is trying
    const ringT = band(p, 0.342, 0.366, 0.398, 0.414);
    const knotT = band(p, 0.368, 0.384, 0.396, 0.41);
    const halves = band(p, 0.406, 0.424, 0.452, 0.474);
    const paddles = band(p, 0.458, 0.484, 0.524, 0.556);
    const body = smoothstep(0.446, 0.5, p);
    const wings = (this.wings = smoothstep(0.52, 0.566, p));
    const open = smoothstep(0.558, 0.592, p);
    const fold = smoothstep(0.59, 0.63, p);
    this.restless = Math.max(knotT, halves * 0.6, paddles * 0.8);
    const shaped = Math.max(ringT, body);
    /** whether it is a shape that shows itself in itself (a ring, a knot) */
    this.self = ringT > 0.02;

    this._droplets(dt, pointer, real, wings);

    // ---- the core: a drop, a ring, a knot; then what is left of it is the thorax
    const r0 = key(K_R0, p) * Math.cbrt(Math.max(0.2, 1 - this.dropVol));
    const R = (this.R = 0.46 * ringT);
    const a = (this.a = 0.205 * knotT);
    let r = r0 * Math.pow(1 + Math.pow(R / r0 / 0.2122, 1.5), -1 / 3);
    if (a > 0) r /= Math.sqrt((1 + smoothstep(0, r, a)) * Math.sqrt(1 + Math.pow((1.5 * a) / Math.max(R, 0.1), 2)));
    this.r = r;
    this.k = clamp(0.17 * r, 0.022, 0.085);
    this.bodyR = R + a + r;
    const hover = 1 - body;
    this.center.set(HOME.x + 0.02 * Math.sin(tau * 0.31) * hover, HOME.y + 0.028 * Math.sin(tau * 0.43) * hover + 0.07 * knotT, HOME.z + 0.02 * Math.sin(tau * 0.27 + 2) * hover).lerp(BF_C, body);

    // the ring's axis keeps turning to face whoever is watching, with a slow tumble
    _a.copy(camera.position).sub(this.center).normalize();
    _a.x += 0.42 * Math.sin(tau * 0.21);
    _a.y += 0.26 * Math.sin(tau * 0.16 + 1.3) + 0.1;
    _a.normalize();
    if (dt > 0) this.axis.lerp(_a, 1 - Math.exp(-1.3 * dt)).normalize();
    else this.axis.copy(_a);
    const psi = tau * 0.13;
    _b.crossVectors(UP, this.axis).normalize();
    _c.crossVectors(this.axis, _b);
    this.ex.copy(_b).multiplyScalar(Math.cos(psi)).addScaledVector(_c, Math.sin(psi));
    this.ez.crossVectors(this.ex, this.axis);

    // ---- two halves: it has sides
    for (let i = 0; i < 2; i++) {
      const o = (1 + i) * 4;
      if (halves < 0.004) {
        s[o + 3] = OFF;
        continue;
      }
      const sx = i ? -1 : 1;
      const rr = 0.3 * halves * (1 + 0.05 * Math.sin(tau * 0.9 + i * 3));
      const dist = Math.max(0, r0 + rr + lerp(-0.52, -0.1, halves));
      s[o] = this.center.x + sx * dist;
      s[o + 1] = this.center.y + 0.06 * Math.sin(tau * 0.5 + i * 2.2) * halves;
      s[o + 2] = this.center.z;
      s[o + 3] = rr;
      K[1 + i] = 0.08;
    }
    // ---- four paddles: it has parts. Blunt, the wrong outline, in the right places
    for (let i = 0; i < 8; i++) {
      const o = (3 + i) * 4;
      if (paddles < 0.004) {
        s[o + 3] = OFF;
        continue;
      }
      const w = i >> 1; // which paddle: fore right, fore left, hind right, hind left
      const sx = w & 1 ? -1 : 1;
      const hind = w >> 1;
      const far = i & 1;
      const ang = (hind ? -0.55 : 0.75) + 0.07 * Math.sin(tau * 0.7 + w * 1.7);
      const dist = (far ? 0.6 : 0.3) * (hind ? 0.92 : 1) * (0.5 + 0.5 * paddles);
      const rr = (far ? 0.15 : 0.19) * (hind ? 0.9 : 1) * paddles;
      s[o] = BF_C.x + sx * Math.cos(ang) * dist;
      s[o + 1] = BF_C.y + Math.sin(ang) * dist + (hind ? -0.05 : 0.03);
      s[o + 2] = BF_C.z + 0.05 * Math.sin(tau * 0.8 + w * 2.1) * paddles;
      s[o + 3] = rr;
      K[3 + i] = 0.06;
    }
    // ---- the body: beads laid along the kit's curves, drawn out from the middle as the rest thins
    for (let i = 0; i < BODY.length; i++) {
      const o = (BODY0 + i) * 4;
      if (body < 0.004) {
        s[o + 3] = OFF;
        continue;
      }
      const b = BODY[i];
      // (the abdomen is fat until the wings take the metal out of it)
      const fat = i >= 5 ? lerp(1.55, 1, wings) : i >= 2 ? lerp(1.2, 1, wings) : 1;
      const out = i >= 3 && i < 5 ? smoothstep(0.5, 1, body) : 1; // the eyes come last
      s[o] = BF_C.x + b[0] * BF_MM * body * out;
      s[o + 1] = BF_C.y + b[1] * BF_MM * body;
      s[o + 2] = BF_C.z + b[2] * BF_MM * body;
      s[o + 3] = b[3] * BF_MM * fat * body * (0.6 + 0.4 * out);
      K[BODY0 + i] = i < 2 ? 0.03 : 0.02;
    }
    // ---- beads shed between one shape and the next: a neck, a pinch, a bead that hangs off and is taken back
    for (let i = 0; i < SATS.length; i++) {
      const o = (SAT0 + i) * 4;
      const [p0, p1, dir, far, rad] = SATS[i];
      const uu = (p - p0) / (p1 - p0);
      if (uu <= 0 || uu >= 1) {
        s[o + 3] = OFF;
        continue;
      }
      const g = Math.pow(Math.sin(Math.PI * uu), 0.8);
      const rr = rad * smoothstep(0, 0.16, uu) * smoothstep(1, 0.84, uu);
      _a.set(dir[0], dir[1], dir[2]).normalize();
      const dist = this.bodyR * 0.75 + far * g;
      s[o] = this.center.x + _a.x * dist + 0.02 * Math.sin(tau * 0.8 + i * 2.1) * g;
      s[o + 1] = this.center.y + _a.y * dist + 0.025 * Math.sin(tau * 0.63 + i * 1.3) * g;
      s[o + 2] = this.center.z + _a.z * dist;
      s[o + 3] = rr > 0.004 ? rr : OFF;
      K[SAT0 + i] = Math.min(0.5 * Math.max(rr, 0.02), 0.06);
    }

    // ---- wings: the kit's own, on the planes its rig holds them in
    const bfOn = wings > 0.001;
    const phi = lerp(0.38 + 0.1 * Math.sin(tau * 0.9), 1.45, fold);
    for (let hnd = 0; hnd < 2; hnd++) {
      wingFrame(1, hnd, phi - hnd * 0.07, this._o, this._ax, this._ay, 0);
      u.uBfO.value[hnd].copy(this._o);
      u.uBfAX.value[hnd].copy(this._ax);
      u.uBfAY.value[hnd].copy(this._ay);
    }
    const thick = lerp(1.1, 0.3, smoothstep(0.535, 0.6, p));
    u.uBf.value.x = wings * 34;
    u.uBf.value.y = thick;
    u.uBf.value.z = fold;
    u.uBf.value.w = open * open * (3 - 2 * open);
    const bfBound = (4 + wings * 30) * BF_MM + 0.12;
    u.uBfB.value.set(0.03, bfBound, BF_MM, bfOn ? 1 : 0);
    u.uBfC.value.copy(BF_C);

    // ---- attention: it swells toward the pointer, or the lens; touched, a ring runs away over it
    this._attention(dt, frame, camera, real, shaped, wings);

    // where it changes its mind a train of rings runs over it, for as long as it is changing
    let turn = 0;
    for (const c of TURNS) turn = Math.max(turn, Math.exp(-Math.pow((p - c) / 0.011, 2)));
    this.turn = turn;
    if (dt > 0 && turn > 0.3 && this.sinceRing > 1.15) {
      _a.set(Math.sin(tau * 1.7), 0.6 + 0.4 * Math.cos(tau * 1.1), Math.cos(tau * 1.3)).normalize();
      this.ring(_a, 0.5 + 0.6 * turn);
      this.events.touch--; // (not a touch: the sound does not ring for it)
    }

    const RING = u.uRing.value;
    const RINGP = u.uRingP.value;
    let ringMax = 0;
    for (let i = 0; i < NRING; i++) {
      const rg = this.rings[i];
      rg.age += dt;
      const amp = rg.age < 3.2 ? rg.amp * 0.0125 * (1 - 0.8 * wings) * Math.exp(-rg.age * 1.25) * smoothstep(0, 0.12, rg.age) * (1 - smoothstep(2.6, 3.2, rg.age)) : 0;
      const sig = 0.055 + 0.04 * rg.age;
      RING[i * 4] = this.center.x + rg.o.x;
      RING[i * 4 + 1] = this.center.y + rg.o.y;
      RING[i * 4 + 2] = this.center.z + rg.o.z;
      RING[i * 4 + 3] = 0.6 * rg.age;
      RINGP[i * 4] = amp;
      RINGP[i * 4 + 1] = 1 / (sig * sig);
      RINGP[i * 4 + 2] = 46;
      ringMax += amp;
    }
    this.sinceRing += dt;

    // ---- uniforms
    const wob = 0.0105 * (1 + 0.5 * this.restless + 0.7 * turn) * (1 - 0.86 * wings) * clamp(r / 0.3, 0.3, 1);
    u.uWob.value.set(wob, 4.6, tau, 0);
    u.uCoreC.value.copy(this.center);
    u.uCoreRot.value.set(this.ex.x, this.ex.y, this.ex.z, this.axis.x, this.axis.y, this.axis.z, this.ez.x, this.ez.y, this.ez.z);
    u.uCoreP.value.set(this.R, this.a, this.r, this.k);
    const disp = 0.002; // (the ripples are in the normal only)
    u.uCoreB.value.set(this.bodyR + 6 * this.k + disp, 0.03, this.bodyR + disp, 1.5 * this.k);
    u.uCoreAxis.value.copy(this.axis);
    u.uCoreSlab.value = this.a + this.r + disp;
    u.uSphCount.value = this.scattered ? USED : DROP0;
    let reach = this.bodyR;
    let bound = this.bodyR + 6 * this.k + disp;
    const n = u.uSphCount.value;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (s[o + 3] <= 0) continue;
      const d3 = Math.hypot(s[o] - this.center.x, s[o + 1] - this.center.y, s[o + 2] - this.center.z) + s[o + 3];
      reach = Math.max(reach, d3);
      bound = Math.max(bound, d3 + 6 * K[i] + disp);
    }
    if (bfOn) {
      const d3 = this.center.distanceTo(BF_C) + bfBound;
      reach = Math.max(reach, d3 - 0.1);
      bound = Math.max(bound, d3 + 0.2);
    }
    this.reach = reach;
    u.uBound.value.set(this.center.x, this.center.y, this.center.z, bound);
  }

  _attention(dt, frame, camera, real, shaped, wings) {
    const { pointer } = frame;
    const s = this.sph;
    const tau = this.tau;
    const tgt = _b;
    let want = 0.38;
    let omega = 2.0;
    // a ghost looks at the lens, and now and then away
    tgt.copy(camera.position).sub(this.center).normalize();
    tgt.x += 0.5 * Math.sin(tau * 0.23);
    tgt.y += 0.35 * Math.sin(tau * 0.31 + 1);
    tgt.normalize();
    let hit = false;
    if (real) {
      // the pointer as a ray: where it passes the liquid
      const o = camera.position;
      const d = _d.set(pointer.x, pointer.y, 0.5).unproject(camera).sub(o).normalize();
      _c.copy(this.center).sub(o);
      const tc = _c.dot(d);
      const near = Math.sqrt(Math.max(0, _c.lengthSq() - tc * tc));
      const rb = this.reach;
      _c.copy(o).addScaledVector(d, tc - Math.sqrt(Math.max(0, rb * rb - near * near))).sub(this.center).normalize();
      hit = near < rb;
      const e = smoothstep(rb + 1.2, rb * 0.6, near);
      tgt.lerp(_c, 0.25 + 0.75 * e).normalize();
      want = lerp(want, 1, e);
      omega = 6;
      if (hit && (!this.wasHit || (pointer.speed > 0.25 && this.sinceRing > 0.3))) this.ring(_c, this.wasHit ? 0.7 : 1);
    } else if (tau > this.ghostRingAt) {
      this.ring(this.aDir, 0.85);
      this.ghostRingAt = tau + 5 + 3 * this.rng();
    }
    this.wasHit = hit;
    if (dt > 0) {
      const zeta = 0.72;
      _c.copy(tgt).sub(this.aDir).multiplyScalar(omega * omega).addScaledVector(this.aVel, -2 * zeta * omega);
      this.aVel.addScaledVector(_c, dt);
      this.aDir.addScaledVector(this.aVel, dt).normalize();
      this.engage = damp(this.engage, want, real ? 4.5 : 1.6, dt);
    } else {
      this.aDir.copy(tgt);
      this.engage = want;
    }
    // (a swelling only while it is a drop: a ring, a knot or a wing keeps its own shape)
    const gate = (1 - shaped) * (1 - wings);
    const e = this.engage;
    const scale = clamp(this.r / 0.3, 0.45, 1);
    const rL = (0.13 + 0.085 * e) * scale * gate;
    if (rL < 0.01) {
      s[3] = OFF;
      return;
    }
    const reach = (0.012 + 0.13 * e * e) * scale * (1 + 0.22 * Math.sin(tau * 1.3));
    const dist = Math.max(0, this.bodyR + reach - 0.66 * rL);
    s[0] = this.center.x + this.aDir.x * dist;
    s[1] = this.center.y + this.aDir.y * dist;
    s[2] = this.center.z + this.aDir.z * dist;
    s[3] = rL;
    this.sphK[0] = 0.075 * scale;
  }

  _droplets(dt, pointer, real, wings) {
    const s = this.sph;
    const K = this.sphK;
    const tau = this.tau;
    const down = real && pointer.down;
    if (down && !this.wasDown && wings < 0.3) this.shatter(_c.copy(this.aDir).multiplyScalar(-1));
    this.wasDown = down;
    if (down) this.releaseAt = this.clock;
    let vol = 0;
    let any = false;
    const c = this.center;
    for (let i = 0; i < DROPS; i++) {
      const dr = this.drops[i];
      const o = (DROP0 + i) * 4;
      if (!dr.on) {
        s[o + 3] = OFF;
        continue;
      }
      any = true;
      if (dt > 0) {
        dr.age += dt;
        const rel = _a.copy(dr.p).sub(c);
        const dist = Math.max(rel.length(), 1e-4);
        rel.multiplyScalar(1 / dist);
        if (!dr.back && !down && (Math.min(this.clock - this.releaseAt, dr.age) > dr.delay || wings > 0.05)) dr.back = true;
        if (dr.back) {
          dr.homing += dt;
          dr.v.addScaledVector(rel, -(2.2 + 3.5 * Math.min(2, dr.homing)) * dt);
          dr.v.multiplyScalar(Math.exp(-2.2 * dt));
          if (dist < this.bodyR * 0.72 + dr.r * 0.35) {
            dr.grow -= dt / 0.4;
            if (dr.grow <= 0) {
              dr.on = false;
              s[o + 3] = OFF;
              this.events.merge++;
              continue;
            }
          } else dr.grow = Math.min(1, dr.grow + dt / 0.3);
        } else {
          dr.grow = Math.min(1, dr.grow + dt / 0.3);
          dr.v.multiplyScalar(Math.exp(-2.4 * dt));
          if (dr.age > 0.3) {
            dr.v.addScaledVector(rel, -(dist - dr.shell) * 1.7 * dt);
            _b.crossVectors(dr.spin, rel);
            dr.v.addScaledVector(_b, 0.75 * dt);
            dr.v.y += 0.12 * Math.sin(tau * 1.1 + i * 2.3) * dt;
          }
        }
        dr.p.addScaledVector(dr.v, dt);
      }
      const rr = dr.r * smoothstep(0, 1, dr.grow);
      s[o] = dr.p.x;
      s[o + 1] = dr.p.y;
      s[o + 2] = dr.p.z;
      s[o + 3] = rr > 0.004 ? rr : OFF;
      K[DROP0 + i] = Math.min(0.42 * Math.max(rr, 0.02), 0.07);
      vol += (rr * rr * rr) / (R0 * R0 * R0);
    }
    this.dropVol = Math.min(0.85, vol);
    if (!any) {
      this.scattered = false;
      this.releaseAt = -99;
    }
  }
}

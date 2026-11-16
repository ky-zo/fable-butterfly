// GEOMETRY · the body and its fur, usable with any material.
//
// The body is swept tubes (see bodyData.js for the curves). Attributes:
//   position  vec3  body frame, millimetres, standing        aAlt  vec3  the same vertex with the legs folded for flight
//   normal    vec3                                           aPart vec4  x: which part (PART), y: 0..1 along it,
//                                                                        z: 0..1 around it, w: which leg 0..3 (-2 the
//                                                                        front brushes, 10 | 11 right | left antenna, else -1)
//   aRad      float half-width of the part at this vertex (mm): lets a shader keep an antenna or a leg a pixel wide
// Feed position, aAlt, normal, aPart to the rig (rig.js: bfBody()).
// Fur is hair quads: position = root, aTip = root → tip (mm), aHair = (0 root … 1 tip, ±1 across, random, white).

import * as THREE from 'three';
import { PART, EYE, EYE_R, SPOTS, sm, thoraxAt, abdomenAt, headAt, through, palpPath, palpRad, legPath, legRad, LEGS, brushPath, brushRad, antennaPath, antennaRad, tonguePath, tongueRad } from './bodyData.js';

class Builder {
  constructor() {
    this.pos = [];
    this.alt = [];
    this.nrm = [];
    this.part = [];
    this.rad = [];
    this.idx = [];
  }
  /**
   * Sweep a closed section along a path. path(t) → [x, y, z]; rad(t) → [ra, rb] (half-widths across / along `up`).
   * alt: optional second path with the same parameter (a second pose).
   */
  tube(path, rad, n, sides, part, leg = -1, alt = null, up = [0, 0, 1]) {
    const base = this.pos.length / 3;
    const P = new THREE.Vector3();
    const T = new THREE.Vector3();
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    const U = new THREE.Vector3(...up);
    const frame = (fn, t) => {
      const a = fn(Math.max(0, t - 1e-3));
      const b = fn(Math.min(1, t + 1e-3));
      T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      A.crossVectors(T, U);
      if (A.lengthSq() < 1e-6) A.crossVectors(T, new THREE.Vector3(1, 0, 0));
      A.normalize();
      B.crossVectors(A, T).normalize();
      const p = fn(t);
      P.set(p[0], p[1], p[2]);
    };
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const [ra, rb] = rad(t);
      // (where the tube swells or tapers, its surface leans along the path)
      const t0 = Math.max(0, t - 2e-3);
      const t1 = Math.min(1, t + 2e-3);
      const p0 = path(t0);
      const p1 = path(t1);
      const slope = (rad(t1)[0] - rad(t0)[0]) / (Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) || 1);
      const lean = Math.max(-4, Math.min(4, slope));
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        frame(path, t);
        this.pos.push(P.x + A.x * ca * ra + B.x * sa * rb, P.y + A.y * ca * ra + B.y * sa * rb, P.z + A.z * ca * ra + B.z * sa * rb);
        // (normal of an ellipse: scale by the other half-width)
        let nx = A.x * ca * rb + B.x * sa * ra;
        let ny = A.y * ca * rb + B.y * sa * ra;
        let nz = A.z * ca * rb + B.z * sa * ra;
        let nl = Math.hypot(nx, ny, nz) || 1;
        nx = nx / nl - T.x * lean;
        ny = ny / nl - T.y * lean;
        nz = nz / nl - T.z * lean;
        nl = Math.hypot(nx, ny, nz) || 1;
        this.nrm.push(nx / nl, ny / nl, nz / nl);
        this.part.push(part, t, s / sides, leg);
        this.rad.push(Math.max(ra, rb));
        if (alt) {
          frame(alt, t);
          this.alt.push(P.x + A.x * ca * ra + B.x * sa * rb, P.y + A.y * ca * ra + B.y * sa * rb, P.z + A.z * ca * ra + B.z * sa * rb);
        } else this.alt.push(this.pos[this.pos.length - 3], this.pos[this.pos.length - 2], this.pos[this.pos.length - 1]);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let s = 0; s < sides; s++) {
        const a = base + i * sides + s;
        const b = base + i * sides + ((s + 1) % sides);
        this.idx.push(a, a + sides, b, b, a + sides, b + sides);
      }
    }
    // close both ends
    for (const end of [0, 1]) {
      const c = this.pos.length / 3;
      const ring = base + end * n * sides;
      frame(path, end);
      this.pos.push(P.x, P.y, P.z);
      this.nrm.push(T.x * (end ? 1 : -1), T.y * (end ? 1 : -1), T.z * (end ? 1 : -1));
      this.part.push(part, end, 0, leg);
      this.rad.push(0);
      if (alt) frame(alt, end);
      this.alt.push(P.x, P.y, P.z);
      for (let s = 0; s < sides; s++) {
        const a = ring + s;
        const b = ring + ((s + 1) % sides);
        if (end) this.idx.push(a, c, b);
        else this.idx.push(a, b, c);
      }
    }
  }
  /** An ellipsoid (the eyes). */
  ball(c, r, nu, nv, part) {
    const base = this.pos.length / 3;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      const th = v * Math.PI;
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const ph = u * Math.PI * 2;
        const d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        this.pos.push(c[0] + d[0] * r[0], c[1] + d[1] * r[1], c[2] + d[2] * r[2]);
        this.alt.push(c[0] + d[0] * r[0], c[1] + d[1] * r[1], c[2] + d[2] * r[2]);
        const nl = Math.hypot(d[0] / r[0], d[1] / r[1], d[2] / r[2]);
        this.nrm.push(d[0] / r[0] / nl, d[1] / r[1] / nl, d[2] / r[2] / nl);
        this.part.push(part, u, v, -1);
        this.rad.push(Math.max(r[0], r[1], r[2]));
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i;
        this.idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
      }
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aAlt', new THREE.Float32BufferAttribute(this.alt, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 4));
    g.setAttribute('aRad', new THREE.Float32BufferAttribute(this.rad, 1));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * @param detail 1 = the one the lens goes up to (≈ 13 000 triangles), 0 = small or far (≈ 500)
 */
export function buildBody(detail = 1) {
  const b = new Builder();
  const hi = detail > 0;
  const seg = (a, c) => (hi ? a : c);
  const lathe = (fn, n, sides, part) =>
    b.tube(
      (t) => {
        const s = fn(t);
        return [0, s.y, s.z];
      },
      (t) => {
        const s = fn(t);
        return [s.rx, s.rz];
      },
      n,
      sides,
      part,
    );
  lathe(thoraxAt, seg(40, 7), seg(32, 8), PART.THORAX);
  lathe(abdomenAt, seg(48, 10), seg(16, 6), PART.ABDOMEN);
  lathe(headAt, seg(26, 4), seg(30, 6), PART.HEAD);
  for (const sx of [1, -1]) {
    b.ball([EYE[0] * sx, EYE[1], EYE[2]], EYE_R, seg(56, 8), seg(40, 6), PART.EYE);
    // labial palps: two furred horns in front of the face
    b.tube(palpPath(sx), (t) => [palpRad(t), palpRad(t)], seg(12, 3), seg(8, 4), PART.PALP);
    b.tube(antennaPath(sx), (t) => [antennaRad(t), antennaRad(t)], seg(56, 12), seg(7, 3), PART.ANTENNA, sx > 0 ? 10 : 11);
    // the legs it stands on
    for (const k of [0, 1]) {
      const leg = k * 2 + (sx > 0 ? 0 : 1);
      b.tube(legPath(k, sx), legRad, seg(64, 8), seg(8, 3), PART.LEG, leg, legPath(k, sx, true));
      if (hi) {
        // two claws at the toe
        const m = (p) => [p[0] * sx, p[1], p[2]];
        const toe = m(LEGS[k].stand[4]);
        const toeF = m(LEGS[k].fold[4]);
        for (const c of [-1, 1]) {
          const claw = (o) => through([o, [o[0] + 0.11 * sx + 0.07 * c, o[1] + 0.1 * (k ? -1 : 1), o[2] + 0.07], [o[0] + 0.2 * sx + 0.14 * c, o[1] + 0.18 * (k ? -1 : 1), o[2] - 0.04]]);
          b.tube(claw(toe), (t) => [0.026 * (1 - 0.85 * t), 0.026 * (1 - 0.85 * t)], 4, 4, PART.CLAW, leg, claw(toeF));
        }
      }
    }
    // the front pair: a brush, folded up under the head
    b.tube(brushPath(sx), (t) => [brushRad(t), brushRad(t)], seg(10, 3), seg(6, 3), PART.LEG, -2);
  }
  if (hi) {
    // the tongue, coiled like a watch spring under the face
    b.tube(tonguePath, tongueRad, 640, 10, PART.TONGUE, -1, null, [1, 0, 0]);
  }
  return b.build();
}

/**
 * The body in two halves that share its buffers: `trunk` (thorax, abdomen, head, eyes, palps, tongue) and `limbs`
 * (antennae, legs, claws — the hairs, which the realistic animal draws blended and antialiased). Only the index
 * differs, so nothing is stored twice and no vertex is worked out twice.
 */
export function splitBody(geometry) {
  const part = geometry.attributes.aPart.array;
  const idx = geometry.index.array;
  const trunk = [];
  const limbs = [];
  for (let i = 0; i < idx.length; i += 3) {
    const to = part[idx[i] * 4] > 5.5 ? limbs : trunk;
    to.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  const make = (index) => {
    const g = new THREE.BufferGeometry();
    for (const k of Object.keys(geometry.attributes)) g.setAttribute(k, geometry.attributes[k]);
    g.setIndex(index);
    return g;
  };
  return { trunk: make(trunk), limbs: make(limbs) };
}

/**
 * Fur: short hairs as quads the shader turns toward the lens. position = root, aTip = root → tip, aHair = (0|1 along,
 * ±1 across, random, white).
 */
export function buildFur(rnd) {
  const pos = [];
  const tip = [];
  const hair = [];
  const idx = [];
  const whiteAt = (x, y, z) => {
    let w = 0;
    for (const [sx, sy, sz, r] of SPOTS) w = Math.max(w, 1 - sm(r * 0.7, r * 1.25, Math.hypot(Math.abs(x) - sx, y - sy, z - sz)));
    return w;
  };
  const add = (p, n, len, lean, white) => {
    // lean back along the body, and a little every way
    const d = [n[0] + (rnd() - 0.5) * 0.9, n[1] - lean * (0.6 + 0.8 * rnd()) + (rnd() - 0.5) * 0.5, n[2] + (rnd() - 0.5) * 0.9];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const base = pos.length / 3;
    const r = rnd();
    for (const [t, s] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
      pos.push(p[0], p[1], p[2]);
      tip.push((d[0] / dl) * len, (d[1] / dl) * len, (d[2] / dl) * len);
      hair.push(t, s, r, white);
    }
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  };
  const coat = (fn, count, len, lean, t0 = 0, t1 = 1, dorsalBias = 0) => {
    for (let i = 0; i < count; i++) {
      const t = t0 + (t1 - t0) * rnd();
      let a = rnd() * Math.PI * 2;
      if (rnd() < dorsalBias) a = Math.PI * (0.15 + 0.7 * rnd());
      const s = fn(t);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const p = [ca * s.rx * 0.97, s.y, s.z + sa * s.rz * 0.97];
      const nl = Math.hypot(ca * s.rz, sa * s.rx) || 1;
      // (nothing grows through an eye)
      if (Math.hypot((Math.abs(p[0]) - EYE[0]) / EYE_R[0], (p[1] - EYE[1]) / EYE_R[1], (p[2] - EYE[2]) / EYE_R[2]) < 1.12) continue;
      const w = whiteAt(p[0], p[1], p[2]);
      add(p, [(ca * s.rz) / nl, 0, (sa * s.rx) / nl], len * (0.5 + 1.0 * rnd() * rnd()) * (1 - 0.6 * w), lean, w > 0.5 ? 1 : 0);
    }
  };
  // (velvet, not a coat: the pile is a third of a millimetre deep and lies back, so the body keeps its outline)
  coat(thoraxAt, 3000, 0.34, 1.3, 0.03, 0.99, 0.35);
  coat(headAt, 2800, 0.2, 1.1, 0.05, 0.98, 0.5);
  coat(thoraxAt, 1000, 0.4, 1.2, 0.03, 0.3, 0.3); // (the collar behind the head is the thickest of it)
  coat(abdomenAt, 420, 0.2, 1.6, 0, 0.25);
  coat(abdomenAt, 260, 0.1, 1.8, 0.25, 1);
  // the palps are all fur: dark above, white underneath
  for (const sx of [1, -1]) {
    const path = palpPath(sx);
    for (let i = 0; i < 240; i++) {
      const t = 0.05 + 0.93 * rnd();
      const a = rnd() * Math.PI * 2;
      const c = path(t);
      const c2 = path(Math.min(1, t + 0.02));
      const T = [c2[0] - c[0], c2[1] - c[1], c2[2] - c[2]];
      const tl = Math.hypot(T[0], T[1], T[2]) || 1;
      // two axes square to the horn
      const A = [T[1] / tl, -T[0] / tl, 0];
      const al = Math.hypot(A[0], A[1]) || 1;
      A[0] /= al;
      A[1] /= al;
      const B = [(T[1] * A[2] - T[2] * A[1]) / tl, (T[2] * A[0] - T[0] * A[2]) / tl, (T[0] * A[1] - T[1] * A[0]) / tl];
      const n = [A[0] * Math.cos(a) + B[0] * Math.sin(a), A[1] * Math.cos(a) + B[1] * Math.sin(a), A[2] * Math.cos(a) + B[2] * Math.sin(a)];
      const r = palpRad(t) * 0.9;
      // (hairs point along the horn, toward its tip)
      const base = pos.length / 3;
      const len = 0.13 * (0.5 + rnd());
      const d = [n[0] * 0.5 + (T[0] / tl) * 1.1, n[1] * 0.5 + (T[1] / tl) * 1.1, n[2] * 0.5 + (T[2] / tl) * 1.1];
      const dl = Math.hypot(d[0], d[1], d[2]);
      const white = n[2] < -0.6 ? 1 : 0; // (pale only along the underside: no stripes)
      const rr = rnd();
      for (const [tt, ss] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
        pos.push(c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r);
        tip.push((d[0] / dl) * len, (d[1] / dl) * len, (d[2] / dl) * len);
        hair.push(tt, ss, rr, white);
      }
      idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 3));
  g.setAttribute('aHair', new THREE.Float32BufferAttribute(hair, 4));
  g.setIndex(idx);
  return g;
}

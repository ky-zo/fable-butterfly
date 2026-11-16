// The night, as a plan: where the butterfly is, where the lamp and the leaf are, how far the day has come and where
// the lens stands — every one of them a pure function of progress. Hold progress still and the lens holds still; only
// the animal, the others and the air move. Nothing in this file reads the clock.
//
//   0.00  hand-in: still water, a slope rising left to right, one warm lamp low on it; the animal small, heading in
//   0.07  it leans off its line and crosses the bay to the dark hill on the right
//   0.13  up the slope, close, side-on: the field it feels shows under it
//   0.18  over the top; the lamp is below
//   0.24  the descent, close, from in front: each wingbeat a small correction, the trail curling down behind it
//   0.30  the whole path at once, from over the bay: a line laid down the hill, and again in the water
//   0.37  along the shore toward the lamp: the field is rings of light now
//   0.46  the lamp, wide: a nest of orbits, the others already in it
//   0.56  long lens from outside: banked, its back to the light, the lamp through its wings
//   0.64  closer still
//   0.70  from above: the spiral
//   0.79  first light behind the lamp; the spiral opens
//   0.89  it leaves, low over wet grass, lit from behind by the morning
//   1.00  hand-off: under a leaf, wings shut, and one strand of silk hung with dew

import * as THREE from 'three';
import { clamp, smoothstep } from '../../core/util.js';
import { WATER, LS as G } from './chunks.js';

export const DEG = Math.PI / 180;
/** how many times life size it is drawn (as in the crossing before this: an 18 cm wingspan) */
export const SIZE = 3.0;
export const MM = 0.001 * SIZE;
/** the hand-in is taken on a longer lens than the flight that follows, from just above the water: it is what puts
 * the horizon and the foot of the headland where the crossing before this left them */
const FOV0 = 19.5;
const TAN0 = Math.tan(0.5 * FOV0 * DEG);

/** Piecewise-smooth lookup: keys = [[progress, value], …]. */
export function key(keys, p) {
  if (p <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const f = (p - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * f * f * (3 - 2 * f);
    }
  }
  return keys[keys.length - 1][1];
}

// ---- the night along the way
/** first light: 0 night … 1 the sky has taken over */
export const K_DAWN = [[0, 0], [0.7, 0], [0.76, 0.2], [0.84, 0.72], [0.92, 0.95], [1, 1]];
/** the sun's height, degrees (it comes up over the sea, south of east) */
export const K_SUN_EL = [[0, -14], [0.7, -14], [0.8, -5], [0.87, -1.2], [0.92, 0.5], [1, 1.5]];
export const SUN_AZ = new THREE.Vector2(0.72, 0.69).normalize();
/** how bright the flight trails are: they fade in daylight */
export const K_TRAIL = [[0, 0.24], [0.03, 0.4], [0.1, 1], [0.78, 1], [0.86, 0.45], [0.93, 0.08], [0.97, 0]];
/** how far the others' orbits have opened (0 a nest … 1 gone) */
export const K_OPEN = [[0, 0], [0.74, 0], [0.8, 0.22], [0.88, 0.75], [0.94, 1], [1, 1]];
/** how strongly it holds its back to the lamp (the dorsal light response): nothing far away, everything close */
export const K_DORSAL = [[0, 0], [0.36, 0], [0.42, 0.65], [0.5, 0.9], [0.74, 0.9], [0.8, 0.5], [0.86, 0.1], [0.9, 0]];
/** the field under it: the land's contours and running seeds (x, z of uField), the rings of light (y) */
export const K_CONTOUR = [[0, 0], [0.07, 0], [0.11, 1], [0.34, 1], [0.4, 0.25], [0.46, 0], [1, 0]];
export const K_RINGS = [[0, 0.35], [0.04, 0.35], [0.09, 0], [0.33, 0], [0.38, 0.9], [0.74, 1], [0.8, 0.5], [0.86, 0], [1, 0]];
/** how much of the wingbeat it uses (it is gliding as it is handed in, and still as it is handed on) */
export const K_BEAT = [[0, 0.25], [0.025, 0.35], [0.06, 1], [0.95, 1], [0.975, 0], [1, 0]];
/** how far it wanders off its line (1 = ±12 cm) */
export const K_WANDER = [[0, 0.2], [0.06, 0.3], [0.4, 0.3], [0.5, 0.25], [0.9, 0.3], [0.95, 0.12], [0.97, 0], [1, 0]];
/** nose-up attitude in flight (rad) */
export const K_PITCH = [[0, 0.62], [0.05, 0.5], [0.4, 0.42], [0.9, 0.42], [1, 0.42]];
/** 0 flying … 1 hanging under the leaf */
/** how bright the others' lines are: quieter in the hand-in, and while the lens is close on the one */
export const K_OTHERS = [[0, 0.3], [0.15, 0.4], [0.4, 0.6], [0.5, 0.6], [0.54, 0.6], [0.6, 0.28], [0.67, 0.28], [0.705, 0.6], [0.8, 0.7], [1, 0.7]];
export const K_HANG = [[0, 0], [0.95, 0], [0.978, 1], [1, 1]];
/** how far below its feet the middle of its thorax hangs (model mm): the legs are let out a little, as under a weight */
export const HANG_DROP = 7.0;
/** the last picture's own background (backdrop.js): it comes up as the lens opens */
export const K_BACK = [[0, 0], [0.922, 0], [0.948, 1], [1, 1]];
/** the dew on the strand swells toward sunrise (1 = as the night left it) */
export const K_BIG = [[0, 1], [0.955, 1], [1, 1.5]];

// The lens. Aperture 0 = the core's depth of field is not run at all.
export const K_APERTURE = [[0, 0], [0.06, 0], [0.1, 0.3], [0.15, 0.45], [0.185, 0], [0.22, 0], [0.25, 0.35], [0.275, 0], [0.33, 0], [0.37, 0.3], [0.41, 0], [0.5, 0], [0.53, 0], [0.575, 0.9], [0.6, 1.1], [0.665, 1.1], [0.69, 0], [0.84, 0], [0.89, 1.2], [0.93, 0.6], [0.965, 2.2], [1, 3.2]];
export const K_BLUR = [[0, 10], [0.5, 10], [0.56, 12], [0.66, 12], [0.7, 10], [0.9, 12], [0.96, 20], [1, 26]];
export const K_EXPOSURE = [[0, 1.15], [0.08, 1.6], [0.3, 1.7], [0.4, 1.3], [0.46, 0.95], [0.56, 0.8], [0.6, 0.72], [0.665, 0.72], [0.72, 0.95], [0.8, 0.9], [0.88, 0.8], [0.95, 0.7], [1, 0.66]];
export const K_NEAR = [[0, 0.08], [0.94, 0.08], [0.97, 0.04], [1, 0.04]];

// ---- the lamp's orbit, as the butterfly flies it
const P_IN = 0.41; // it is caught
const P_OUT = 0.865; // it is let go
const K_RADIUS = [[P_IN, 3.3], [0.49, 2.3], [0.58, 1.45], [0.66, 0.95], [0.735, 0.9], [0.8, 1.9], [P_OUT, 3.4]];
const K_RISE = [[P_IN, -0.4], [0.5, -0.05], [0.62, 0.12], [0.735, 0.08], [0.8, 0.3], [P_OUT, 0.55]];
const TH0 = -Math.PI / 2 - 0.35;
const TURNS = 5;
// It does not come round at an even rate. Where the lens rides round the lamp with it, it must come round slowly, or
// the whole night swings past behind it: so the turns are counted out by stretch of progress — [from, to, turns] —
// and inside each stretch they are spent as its own speed would spend them (the tighter the circle, the faster round).
// The fourth stretch is the long close shot: half a turn, from north of the lamp round by the east to the south of
// it, which keeps the iron crook (it stands to the west) out of the line of sight.
const SPANS = [
  [P_IN, 0.455, 0.32],
  [0.455, 0.5, 0.3],
  [0.5, 0.578, 0.468],
  [0.578, 0.66, 0.5],
];

/**
 * Lay the whole night out over the land. Returns the plan:
 *   LAMP (Vector3: the flame), POST (Vector3: the foot of its post), PLANT { … }, HANG (Vector3: where it sleeps)
 *   pathAt(p, out)        where the butterfly is on its line (p may be < 0: where it came from)
 *   placeCamera(camera, p, aspect)
 */
export function buildPlan(land) {
  const ground = (x, z) => Math.max(land.height(x, z), WATER);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---- the lamp: on a short post just above the water, on the near shore of the headland
  const POST = V(6.0 * G, 0, 19.3 * G);
  POST.y = land.height(POST.x, POST.z);
  const LAMP = V(POST.x + 0.42, POST.y + 1.22, POST.z);

  // ---- the hand-in (what world 03 leaves): the lamp in the middle, 58 % of the way down; the animal at 45 %,
  // a little to the left, 5.3 m from the lens; the horizon 74 % of the way down, water from there to the foot of the slope
  const D0 = 5.3;
  const C0 = V(5.0 * G, WATER + 0.35, 1.0 * G);
  const aim = (C, at, ndcY, fovHalfTan) => {
    // a look-at point that puts `at` in the middle of the frame, ndcY of the way up it
    const dl = Math.hypot(at.x - C.x, at.z - C.z);
    const pitch = Math.atan((at.y - C.y) / dl) - Math.atan(ndcY * fovHalfTan);
    return V(at.x, C.y + Math.tan(pitch) * dl, at.z);
  };
  const T0 = aim(C0, LAMP, -0.16, TAN0);
  const H0 = V(0, 0, 0);
  {
    const f = T0.clone().sub(C0).normalize();
    const r = V(-f.z, 0, f.x).normalize();
    const u = r.clone().cross(f);
    H0.copy(f).addScaledVector(u, 0.1 * TAN0).addScaledVector(r, -0.082 * TAN0).normalize().multiplyScalar(D0).add(C0);
  }

  // ---- the plant it comes down under, up the headland from the lamp
  const PLANT = { x: 0.9 * G, z: 21.7 * G };
  PLANT.y = land.height(PLANT.x, PLANT.z);
  /** the last shot looks this way: east, a little north — across the mouth of the bay to the dark land beyond it, the
   * morning low and well to the right, out of frame */
  const VIEW = V(0.98, 0, -0.19).normalize();
  const RIGHT = V(-VIEW.z, 0, VIEW.x);
  /** where its feet hold the underside of the leaf, and where the strand is tied */
  const GRIP = V(PLANT.x, PLANT.y + 1.95, PLANT.z).addScaledVector(RIGHT, 1.05).addScaledVector(VIEW, -0.15);
  const HANG = GRIP.clone().add(V(0, -HANG_DROP * MM, 0));
  const STRAND = GRIP.clone().addScaledVector(RIGHT, 0.105).add(V(0, 0.012, 0));

  // ---- its line. Free flight: [p, x, z (in the land's own units), clearance over the ground or the water (m)]
  const FREE = [
    [-0.36, 30, -9, 2.2],
    [-0.2, 17, -5.5, 2.2],
    [-0.08, 8.2, -0.6, 2.0],
    [0.045, 2.2, 7.4, 2.4],
    [0.09, -1.4, 8.7, 1.6],
    [0.125, -4.9, 8.7, 1.0],
    [0.158, -8.1, 7.7, 1.0],
    [0.186, -9.8, 9.4, 1.2],
    [0.215, -8.7, 11.4, 0.9],
    [0.25, -6.9, 12.9, 0.7],
    [0.285, -5.1, 14.3, 0.62],
    [0.32, -3.1, 15.7, 0.58],
    [0.35, -0.9, 16.7, 0.7],
    [0.375, 1.5, 16.6, 1.2],
    [0.393, 3.6, 17.2, 2.2],
    [0.402, 4.6, 17.75, 2.9],
  ];
  const cps = []; // [p, Vector3]
  for (const [p, x, z, c] of FREE) cps.push([p, V(x * G, ground(x * G, z * G) + c, z * G)]);
  cps.push([0, H0.clone()]);
  cps.sort((a, b) => a[0] - b[0]);
  // the orbit (see SPANS)
  {
    const want = Math.PI + 0.35 + 2 * Math.PI * TURNS; // it leaves heading west, from the south side
    const spans = SPANS.map(([a, b, t]) => [a, b, t * 2 * Math.PI]);
    spans.push([0.66, P_OUT, want - spans.reduce((q, w) => q + w[2], 0)]);
    const SUB = 4, n = 200 * SUB;
    const dp = (P_OUT - P_IN) / n;
    // which stretch a moment belongs to: each fades into the next over a little progress, so its speed never jumps
    const share = (k, p) => {
      const up = k === 0 ? 1 : smoothstep(spans[k][0] - 0.012, spans[k][0] + 0.012, p);
      const dn = k === spans.length - 1 ? 0 : smoothstep(spans[k][1] - 0.012, spans[k][1] + 0.012, p);
      return up - dn;
    };
    // the rate each stretch must fly at for the turns to come out as written: a small linear system
    const N = spans.length;
    const M = spans.map(() => new Array(N + 1).fill(0));
    for (let i = 0; i < n; i++) {
      const p = P_IN + (i + 0.5) * dp;
      const row = spans.findIndex((w) => p < w[1]);
      const r = dp / key(K_RADIUS, p);
      for (let k = 0; k < N; k++) M[row < 0 ? N - 1 : row][k] += r * share(k, p);
    }
    for (let k = 0; k < N; k++) M[k][N] = spans[k][2];
    for (let c = 0; c < N; c++) {
      let piv = c;
      for (let r = c + 1; r < N; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < N; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= N; k++) M[r][k] -= f * M[c][k];
      }
    }
    const rate = M.map((row, k) => row[N] / row[k]);
    let a = TH0;
    for (let i = 0; i <= n; i++) {
      const p = P_IN + i * dp;
      if (i > 0) {
        const pm = p - 0.5 * dp;
        let m = 0;
        for (let k = 0; k < N; k++) m += rate[k] * share(k, pm);
        a += (m * dp) / key(K_RADIUS, pm);
      }
      if (i % SUB) continue;
      const R = key(K_RADIUS, p);
      const y = LAMP.y + key(K_RISE, p) + 0.2 * (R / 3) * Math.sin(a * 0.5 + 1.0) + 0.07 * Math.sin(a * 1.7);
      cps.push([p, V(LAMP.x + R * Math.cos(a), y, LAMP.z + R * Math.sin(a))]);
    }
  }
  // away along the headland, down into the grass, and up under the leaf
  cps.push([0.895, V(4.0 * G, ground(4.0 * G, 21.3 * G) + 0.9, 21.3 * G)]);
  cps.push([0.93, V(2.1 * G, ground(2.1 * G, 21.75 * G) + 0.8, 21.75 * G)]);
  cps.push([0.952, HANG.clone().addScaledVector(VIEW, 0.3).addScaledVector(RIGHT, -0.12).add(V(0, -0.22, 0))]);
  cps.push([0.966, HANG.clone().addScaledVector(VIEW, 0.05).addScaledVector(RIGHT, -0.02).add(V(0, -0.07, 0))]);
  cps.push([0.978, HANG.clone()]);
  cps.push([1.0, HANG.clone()]);
  const CP = cps.map((c) => c[0]);
  const NC = cps.length;
  const cpAt = (k, c) => cps[Math.max(0, Math.min(NC - 1, k))][1].getComponent(c);
  const cpP = (k) => CP[Math.max(0, Math.min(NC - 1, k))];
  /** how much it corrects its course (the small side-steps of something feeling its way) */
  const K_CORR = [[-0.1, 0], [0.02, 0], [0.07, 0.5], [0.16, 1], [0.34, 1], [0.4, 0.25], [0.44, 0], [0.87, 0], [0.9, 0.5], [0.94, 0.3], [0.955, 0], [1, 0]];
  const _t = V(0, 0, 0);
  const base = (p, out) => {
    p = clamp(p, CP[0], 1);
    let i = 0;
    while (i < NC - 2 && p > CP[i + 1]) i++;
    const h = CP[i + 1] - CP[i];
    const f = clamp((p - CP[i]) / h, 0, 1);
    const f2 = f * f, f3 = f2 * f;
    for (let c = 0; c < 3; c++) {
      const p1 = cpAt(i, c), p2 = cpAt(i + 1, c);
      let m1 = i > 0 ? ((p2 - cpAt(i - 1, c)) / (CP[i + 1] - cpP(i - 1))) * h : p2 - p1;
      let m2 = i < NC - 2 ? ((cpAt(i + 2, c) - p1) / (cpP(i + 2) - CP[i])) * h : p2 - p1;
      if (i >= NC - 3) m2 = 0; // it comes to rest
      if (i >= NC - 2) m1 = 0;
      out.setComponent(c, (2 * f3 - 3 * f2 + 1) * p1 + (f3 - 2 * f2 + f) * m1 + (-2 * f3 + 3 * f2) * p2 + (f3 - f2) * m2);
    }
    return out;
  };
  // over land it keeps a little above whatever is under it (the line is drawn through a few points; the ground
  // between them is not flat)
  const K_SKIM = [[-1, 1], [0.38, 1], [P_IN, 0], [P_OUT, 0], [0.885, 1], [0.93, 1], [0.94, 0], [1, 0]];
  const pathAt = (p, out) => {
    base(p, out);
    const skim = key(K_SKIM, p);
    if (skim > 0) {
      const x = out.x, z = out.z;
      const g = 0.4 * ground(x, z) + 0.15 * (ground(x + 0.8, z) + ground(x - 0.8, z) + ground(x, z + 0.8) + ground(x, z - 0.8));
      const d = out.y - (g + 0.5);
      out.y += skim * (0.5 * (Math.sqrt(d * d + 0.02) - d));
    }
    const k = key(K_CORR, p);
    if (k > 0) {
      // small corrections, a few to every metre: to one side, then the other, never the same twice
      base(p + 0.002, _t).sub(out);
      const l = Math.hypot(_t.x, _t.z) || 1;
      const side = (0.13 * Math.sin(p * 610 + 1.2 * Math.sin(p * 173)) + 0.075 * Math.sin(p * 1370 + 1.7) + 0.04 * Math.sin(p * 2330 + 0.4)) * k;
      out.x += (-_t.z / l) * side;
      out.z += (_t.x / l) * side;
      out.y += (0.045 * Math.sin(p * 830 + 2.1) + 0.025 * Math.sin(p * 1790)) * k;
    }
    return out;
  };

  // ---- the lens
  // A key is where the lens stands and what it looks at, each as (a fixed point) + w × (where the animal is at p):
  // w = 0 a tripod, w = 1 the lens travels with it. Everything is interpolated as written, so between a tripod and a
  // travelling shot the lens glides from one to the other.
  const rel = (o, x, y, z) => [o.x + x, o.y + y, o.z + z];
  // A third way to write a key: { f: [right, up, ahead] } — metres from the animal in ITS frame (the way it is
  // heading, smoothed), for shots that travel with it. All three kinds interpolate into one another.
  /** [p, lens, w, look-at, w, fov, upright opening, upright turn, distance (hand-off only), lens in its frame, look-at in its frame] */
  const KEYS = [];
  const Z3 = [0, 0, 0];
  // And a fourth, for the lamp: { r: [out, up, round] } — metres from the animal along the line from the lamp through
  // it, so that the lens rides round with it and the lamp stays behind it.
  const part = (v, w) => (v.f || v.r ? Z3 : w >= 1 ? v : [v[0] * (1 - w), v[1] * (1 - w), v[2] * (1 - w)]);
  const mk = (p, pos, pw, tgt, tw, fov, open = 0, turn = pos.f || pos.r ? 0.85 : 0, dist = 0) => [p, part(pos, pw), pos.f || pos.r ? 1 : pw, part(tgt, tw), tgt.f || tgt.r ? 1 : tw, fov, open, turn, dist, pos.f || Z3, tgt.f || Z3, pos.r || Z3, tgt.r || Z3];
  // The same moment is written twice where a frame that stands upright needs another shot altogether: a wide frame
  // can hold the lamp, the whole nest of orbits and the one among them from a tripod; an upright one cannot without
  // making the animal a speck, so there the lens stands behind it instead and looks past it at the lamp.
  const KEYSP = [];
  const K = (...a) => {
    const k = mk(...a);
    KEYS.push(k);
    KEYSP.push(k);
  };
  /** …and in an upright frame (same arguments as K, without the progress) */
  const UPR = (...a) => (KEYSP[KEYSP.length - 1] = mk(KEYS[KEYS.length - 1][0], ...a));
  const F = (r, u, a) => ({ f: [r, u, a] });
  const RD = (o, u, t) => ({ r: [o, u, t] });
  // (the hand-in is aimed at the lamp; written as an offset from the animal, so that from the first moment the lens
  // turns with it)
  const AIM0 = T0.clone().sub(C0).normalize().multiplyScalar(D0).add(C0).sub(H0).toArray();
  K(0, C0.toArray(), 0, AIM0, 1, FOV0);
  K(0.016, rel(C0, 0, 0.04, 0.4), 0, AIM0, 1, FOV0 + 0.6);
  // behind and below it as it crosses to the hill: against the stars, its image in the water
  K(0.045, F(0.7, -0.25, -1.9), 1, F(-0.1, 0.12, 0.5), 1, 26, 0.5);
  K(0.085, F(0.8, -0.4, -1.5), 1, F(-0.1, 0.12, 0.5), 1, 26, 0.5);
  // up the slope, close, from the side
  K(0.135, F(-0.85, -0.28, -0.95), 1, F(0.05, 0.1, 0.4), 1, 26, 0.9);
  K(0.165, F(1.2, 0.25, 0.95), 1, F(0, 0.03, 0.08), 1, 25, 0.9);
  // over the top: the lens lets it go ahead, and the bay and the lamp come into the picture below
  K(0.2, F(0.5, 0.85, -2.5), 1, F(0, -0.05, 1.2), 1, 32, 0.5);
  K(0.218, F(-1.5, 0.5, -0.5), 1, F(0, 0.0, 0.3), 1, 28, 0.7);
  // the descent, from in front and below: the hill and the sky behind it
  K(0.24, F(-0.6, -0.3, 1.25), 1, F(0.1, 0.08, -0.3), 1, 26, 0.9);
  K(0.265, F(-1.0, -0.15, 1.0), 1, F(0.08, 0.06, -0.2), 1, 26, 0.9);
  // the whole path: well ahead of it, looking back up the hill it has come down
  K(0.305, F(-1.3, 0.75, 3.8), 1, F(0.2, 0.42, -1.0), 1, 30, 0.5);
  K(0.325, F(-1.1, 0.8, 3.5), 1, F(0.2, 0.42, -1.0), 1, 30, 0.5);
  // round its uphill side, level with it: side-on against the bay
  K(0.345, F(1.15, 0.25, -0.55), 1, F(0, 0.1, 0.25), 1, 27, 0.7);
  // along the shore, behind it: the lamp ahead
  K(0.368, F(0.4, 0.14, -1.5), 1, F(0, 0.12, 1.5), 1, 26, 0.7);
  K(0.395, F(0.6, 0.2, -1.8), 1, F(0, 0.14, 1.5), 1, 27, 0.7);
  // the lamp, wide: from out over the water
  K(0.455, rel(LAMP, -4.6, 1.5, -6.2), 0, rel(LAMP, 0.1, -0.25, 0), 0.55, 33, 1.0);
  UPR(RD(2.5, 1.05, 0.25), 1, RD(-0.9, -0.1, 0.0), 1, 32, 0, 0);
  K(0.5, rel(LAMP, -3.6, 1.2, -6.6), 0, rel(LAMP, 0, -0.2, 0), 0.5, 32, 1.0);
  UPR(RD(2.4, 1.0, 0.2), 1, RD(-0.9, -0.1, 0.0), 1, 31, 0, 0);
  // closer, from the north of it: where the long shot begins
  K(0.526, rel(LAMP, -0.9, 0.85, -5.3), 0, rel(LAMP, 0, -0.1, 0), 0.6, 22, 1.0);
  UPR(RD(2.3, 0.6, 0.3), 1, RD(-0.6, 0.0, 0.02), 1, 26, 0, 0);
  // the lens rides round with it, outside it, the lamp behind its wings: on its side, its back to the light
  // (in an upright frame it stays more nearly in line with the lamp, which would otherwise leave by the side)
  K(0.578, RD(2.1, -0.05, 0.6), 1, RD(-0.3, 0.0, 0.02), 1, 17, 0.8);
  UPR(RD(2.1, -0.05, 0.3), 1, RD(-0.3, 0.0, 0.02), 1, 17, 0.8);
  K(0.6, RD(1.75, -0.1, 0.42), 1, RD(-0.25, 0.0, 0.02), 1, 15, 0.8);
  UPR(RD(1.75, -0.1, 0.22), 1, RD(-0.25, 0.0, 0.02), 1, 15, 0.8);
  K(0.63, RD(1.6, -0.06, 0.1), 1, RD(-0.2, 0.0, 0.03), 1, 14, 0.8);
  K(0.66, RD(1.5, -0.02, -0.35), 1, RD(-0.2, 0.0, -0.02), 1, 14, 0.8);
  UPR(RD(1.5, -0.02, -0.18), 1, RD(-0.2, 0.0, -0.02), 1, 14, 0.8);
  // from above
  K(0.705, rel(LAMP, 0.5, 5.6, -1.6), 0, rel(LAMP, 0, -0.5, 0.1), 0.2, 36, 0.5, 0.2);
  UPR(rel(LAMP, 0.35, 4.0, -1.2), 0, rel(LAMP, 0, -0.5, 0.1), 0.3, 36, 0.15, 0.2);
  K(0.73, rel(LAMP, 0.4, 5.4, -1.9), 0, rel(LAMP, 0, -0.5, 0.1), 0.2, 36, 0.5, 0.2);
  UPR(rel(LAMP, 0.3, 3.9, -1.4), 0, rel(LAMP, 0, -0.5, 0.1), 0.3, 36, 0.15, 0.2);
  // first light: low on the bay side, the lamp against the morning
  K(0.785, rel(LAMP, -4.4, -0.75, -3.4), 0, rel(LAMP, 0.7, 0.45, 0.6), 0.45, 31, 1.0, 0.1);
  UPR(rel(LAMP, -4.4, -0.75, -3.4), 0, rel(LAMP, 0.7, 0.45, 0.6), 0.45, 31, 0.8, 0.1);
  K(0.83, rel(LAMP, -4.9, -0.7, -2.6), 0, rel(LAMP, 0.6, 0.5, 0.5), 0.5, 31, 1.0, 0.1);
  UPR(rel(LAMP, -4.9, -0.7, -2.6), 0, rel(LAMP, 0.6, 0.5, 0.5), 0.5, 31, 0.8, 0.1);
  // it leaves: ahead of it and to one side, the morning behind it
  K(0.885, F(0.85, -0.1, 1.05), 1, F(0, 0.03, -0.1), 1, 24, 0.6);
  K(0.92, F(1.0, -0.02, 0.8), 1, F(0, 0.02, -0.1), 1, 24, 0.6);
  // the plant
  K(0.95, rel(HANG, -1.9 * VIEW.x - 0.3 * RIGHT.x, 0.02, -1.9 * VIEW.z - 0.3 * RIGHT.z), 0, [0.05 * RIGHT.x, -0.02, 0.05 * RIGHT.z], 1, 20, 0.6);

  // ---- the hand-off (what world 05 opens on): the leaf across the top fifth, the animal hanging under it at 30 %,
  // a little left; the strand down the middle of the frame, top to bottom
  const FOV1 = 10.5;
  const OPEN1 = 0.3;
  const DIST1 = 2.68;
  const lastKey = (p, dist, fov) => K(p, [0, 0, 0], 0, [0, 0, 0], 0, fov, OPEN1, 0, dist);
  lastKey(0.982, DIST1 + 0.25, FOV1 + 1.5);
  lastKey(1.0, DIST1, FOV1);

  const N = KEYS.length;
  const KP = KEYS.map((k) => k[0]);
  // Monotone cubic through the keys (Fritsch–Carlson): between two keys that say the same thing the lens holds
  // still, and it never swings out past a key on its way to the next.
  const tangent = (k, get) => {
    if (k <= 0 || k >= N - 1) return 0;
    const d0 = (get(k) - get(k - 1)) / (KP[k] - KP[k - 1]);
    const d1 = (get(k + 1) - get(k)) / (KP[k + 1] - KP[k]);
    if (d0 * d1 <= 0) return 0;
    const m = 0.5 * (d0 + d1);
    const lim = 3 * Math.min(Math.abs(d0), Math.abs(d1));
    return Math.abs(m) > lim ? Math.sign(m) * lim : m;
  };
  const hermite = (i, f, get) => {
    const h = KP[i + 1] - KP[i];
    const p1 = get(i), p2 = get(i + 1);
    const m1 = tangent(i, get) * h, m2 = tangent(i + 1, get) * h;
    const f2 = f * f, f3 = f2 * f;
    return (2 * f3 - 3 * f2 + 1) * p1 + (f3 - 2 * f2 + f) * m1 + (-2 * f3 + 3 * f2) * p2 + (f3 - f2) * m2;
  };
  const _pos = V(0, 0, 0), _tgt = V(0, 0, 0), _hero = V(0, 0, 0), _ha = V(0, 0, 0), _hb = V(0, 0, 0);
  const _pos2 = V(0, 0, 0), _tgt2 = V(0, 0, 0), _hc = V(0, 0, 0);
  let lastAspect = -1;
  /** the two hand-off keys depend on the shape of the frame: the strand is the middle of it, the grip 27 % down */
  const fitLast = (aspect) => {
    if (aspect === lastAspect) return;
    lastAspect = aspect;
    const tall = clamp((1.25 - aspect) / 0.7, 0, 1);
    for (let k = N - 2; k < N; k++) {
      const key_ = KEYS[k];
      const half = Math.tan((key_[5] * DEG) / 2) * (1 + OPEN1 * tall);
      const dist = key_[8];
      // look-at: on the strand, far enough below the grip that the grip sits 20 % of the way down the frame
      const drop = 0.595 * half * dist;
      const T = V(STRAND.x, GRIP.y - drop, STRAND.z);
      const C = T.clone().addScaledVector(VIEW, -dist);
      C.y -= 0.03 * dist; // from a little below: it is the underside of the leaf that shows
      key_[1] = C.toArray();
      key_[3] = T.toArray();
    }
  };

  /**
   * Place the camera for progress p (and nothing else: no clock, no pointer). In an upright frame (a phone) the lens
   * is opened where the animal would otherwise run out of the sides of the picture; the hand-in frame is the same in
   * every shape of frame.
   */
  /** one table of keys at progress p (i, f: where p is between two of them) → where the lens stands, what it looks at, its field */
  const sample = (T, i, f, tall, pos, tgt) => {
    const pw = hermite(i, f, (k) => T[k][2]);
    const tw = hermite(i, f, (k) => T[k][4]);
    for (let c = 0; c < 3; c++) {
      pos.setComponent(c, hermite(i, f, (k) => T[k][1][c]) + pw * _hero.getComponent(c));
      tgt.setComponent(c, hermite(i, f, (k) => T[k][3][c]) + tw * _hero.getComponent(c));
    }
    // (the part of each that is written in the animal's own frame)
    const hl = Math.hypot(_ha.x, _ha.z);
    if (hl > 1e-5) {
      const hx = _ha.x / hl, hz = _ha.z / hl;
      for (const [v, col] of [[pos, 9], [tgt, 10]]) {
        const r = hermite(i, f, (k) => T[k][col][0]), u = hermite(i, f, (k) => T[k][col][1]), a = hermite(i, f, (k) => T[k][col][2]);
        v.x += -hz * r + hx * a;
        v.y += u;
        v.z += hx * r + hz * a;
      }
    }
    // (…and the part written along the line from the lamp through the animal)
    const rx = _hb.x - LAMP.x, rz = _hb.z - LAMP.z;
    const rl = Math.hypot(rx, rz);
    if (rl > 1e-4) {
      const nx = rx / rl, nz = rz / rl;
      for (const [v, col] of [[pos, 11], [tgt, 12]]) {
        const o = hermite(i, f, (k) => T[k][col][0]), u = hermite(i, f, (k) => T[k][col][1]), t = hermite(i, f, (k) => T[k][col][2]);
        v.x += nx * o - nz * t;
        v.y += u;
        v.z += nz * o + nx * t;
      }
    }
    const s = f * f * (3 - 2 * f);
    let fov = T[i][5] + (T[i + 1][5] - T[i][5]) * s;
    const open = T[i][6] + (T[i + 1][6] - T[i][6]) * s;
    const turn = T[i][7] + (T[i + 1][7] - T[i][7]) * s;
    if (tall > 0) {
      if (open > 0) fov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (1 + open * tall)) * 180) / Math.PI;
      if (turn > 0) tgt.lerp(_hero, turn * tall);
    }
    return fov;
  };
  const placeCamera = (camera, p, aspect) => {
    p = clamp(p, 0, 1);
    fitLast(aspect);
    let i = 0;
    while (i < N - 2 && p > KP[i + 1]) i++;
    const f = clamp((p - KP[i]) / (KP[i + 1] - KP[i]), 0, 1);
    pathAt(p, _hero);
    base(Math.min(1, p + 0.014), _ha).sub(base(p - 0.014, _hc));
    base(p, _hb);
    const tall = clamp((1.25 - aspect) / 0.7, 0, 1);
    let fov = sample(tall >= 1 ? KEYSP : KEYS, i, f, tall, _pos, _tgt);
    if (tall > 0 && tall < 1) {
      // (a frame between the two shapes gets a shot between the two)
      const fov2 = sample(KEYSP, i, f, tall, _pos2, _tgt2);
      _pos.lerp(_pos2, tall);
      _tgt.lerp(_tgt2, tall);
      fov += (fov2 - fov) * tall;
    }
    // never under: wherever the keys put it, the lens stays clear of the ground and of the water
    const floor = Math.max(land.height(_pos.x, _pos.z), land.height(_pos.x + 0.25, _pos.z), land.height(_pos.x, _pos.z + 0.25), land.height(_pos.x - 0.25, _pos.z), land.height(_pos.x, _pos.z - 0.25), WATER) + 0.16;
    const d = _pos.y - floor;
    _pos.y = floor + 0.5 * (d + Math.sqrt(d * d + 0.004));
    camera.position.copy(_pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(_tgt);
    const near = key(K_NEAR, p);
    if (Math.abs(camera.fov - fov) > 1e-4 || camera.near !== near || camera.aspect !== aspect) {
      camera.fov = fov;
      camera.near = near;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    return _hero;
  };

  return { LAMP, POST, PLANT, VIEW, RIGHT, GRIP, HANG, STRAND, C0, H0, P_IN, P_OUT, pathAt, placeCamera, P_MIN: CP[0] };
}

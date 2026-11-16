// Where the butterfly is, as a pure function of progress. (How its wings go is the kit's business: shared/butterfly/motion.js.)
//
// It rests three times: on a glazing bar by the door (where the visit begins), on the inside of one pane half-way
// down the sunlit wall (where another settles outside, opposite), and at the foot of the end pane. Between the rests
// it flies: down the corridor, through the one shaft of sun that crosses to the shade wall, along the sunlit glass
// looking for a way out, across to the ferns, to the end. The visitor scrolls this back and forth; nothing here
// remembers anything.

import * as THREE from 'three';
import { clamp, smoothstep } from '../../core/util.js';
import { SUN_DIR, HW, ZB, WALLS } from './layout.js';
import { STAND as STAND_MM } from '../../shared/butterfly/index.js';

/** Its size against life (the model is in millimetres: a 29.5 mm forewing). A large specimen. */
export const SIZE = 1.06;
/** Metres per millimetre of the model. */
export const MM = 0.001 * SIZE;
/** How far the middle of the thorax is carried above what it stands on (m). */
export const STAND = STAND_MM * MM;

/** Where the sun, let in through one clear upper pane, lands on the shade wall — and the butterfly's shadow with it. */
export const SHADOW_SPOT = new THREE.Vector3(HW, 1.1, -2.6);
const onBeam = (tau) => [SHADOW_SPOT.x + SUN_DIR.x * tau, SHADOW_SPOT.y + SUN_DIR.y * tau, SHADOW_SPOT.z + SUN_DIR.z * tau];

/** The pane it lands on (wall 0, metres), and where the free one settles on the other side: head to head. */
export const LANDING = { wall: 0, s: 8.632, t: 1.272, head: [-0.77, 0.64] };
export const OPPOSITE = { wall: 0, s: 8.632 - 0.77 * 0.044 + 0.004, t: 1.272 + 0.64 * 0.044 + 0.005, head: [0.77, -0.64] };

const onWall = (w, s, t, out) => new THREE.Vector3().copy(WALLS[w].origin).addScaledVector(WALLS[w].u, s).addScaledVector(WALLS[w].v, t).addScaledVector(WALLS[w].n, out);

/**
 * The three rests. pos = the body's centre; n = out of what it stands on; head = which way it faces.
 * [from, to] = the progress window in which its feet are down.
 */
export const PERCH = [
  // the flange of the second mullion on the sunlit side, at eye level, head up
  { from: 0, to: 0.084, pos: new THREE.Vector3(-HW + 0.048 + STAND, 1.432, ZB - 2.0 + 0.004), n: new THREE.Vector3(1, 0, 0), head: new THREE.Vector3(0, 1, 0.1).normalize() },
  { from: 0.478, to: 0.548, pos: onWall(0, LANDING.s, LANDING.t, STAND), n: new THREE.Vector3(1, 0, 0), head: new THREE.Vector3(0, LANDING.head[1], -LANDING.head[0]).normalize() },
  // at the foot of the end pane, just above the steel sill, head up, the whole garden in front of it
  { from: 0.89, to: 2, pos: onWall(2, 2.08, 0.07, STAND), n: new THREE.Vector3(0, 0, 1), head: new THREE.Vector3(0.08, 1, 0).normalize() },
];
/** The body's axes on perch k, turned by `yaw` about the surface's normal: right, toward the head, out of the back. */
export function perchBasis(k, yaw, R, F, U) {
  const pc = PERCH[k];
  U.copy(pc.n);
  F.copy(pc.head).addScaledVector(U, -pc.head.dot(U)).normalize().applyAxisAngle(U, yaw);
  R.crossVectors(F, U);
}
const LIFT = 0.02; // progress it takes to get off a perch, or down onto one

/** 0 on a perch … 1 in the air. */
export function airborne(p) {
  let a = 1;
  for (const k of PERCH) a = Math.min(a, 1 - smoothstep(k.from - LIFT, k.from, p) * (1 - smoothstep(k.to, k.to + LIFT, p)));
  return a;
}
/** Which perch it is on, coming down to, or has just left (index into PERCH). */
export function perchAt(p) {
  let best = 0;
  let bd = 9;
  PERCH.forEach((k, i) => {
    const d = p < k.from ? k.from - p : p > k.to ? p - k.to : 0;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

const V = (v) => (v.isVector3 ? v.toArray() : v);
/** [progress, position, stop?] — the line of flight. A stop is a perch: the path arrives and leaves with no speed. */
const KEYS = [
  [0, V(PERCH[0].pos), 1],
  [0.084, V(PERCH[0].pos), 1],
  [0.104, [-0.9, 1.5, -1.32]],
  [0.128, [-0.34, 1.6, -2.2]],
  [0.152, [0.2, 1.5, -2.95]],
  [0.174, [0.6, 1.36, -3.06]],
  [0.192, onBeam(0.38)],
  [0.214, onBeam(0.26)],
  [0.24, onBeam(0.16)],
  [0.264, [0.94, 1.27, -3.4]],
  [0.29, [0.5, 1.42, -4.15]],
  [0.32, [-0.5, 1.5, -4.95]],
  [0.352, [-0.98, 1.43, -5.6]],
  [0.386, [-1.01, 1.37, -6.4]],
  [0.42, [-0.99, 1.47, -7.05]],
  [0.452, [-1.02, 1.42, -7.46]],
  [0.478, V(PERCH[1].pos), 1],
  [0.548, V(PERCH[1].pos), 1],
  [0.57, [-1.0, 1.42, -7.86]],
  [0.604, [-0.55, 1.44, -8.5]],
  [0.66, [0.34, 1.22, -9.7]],
  [0.71, [0.86, 1.22, -10.4]],
  [0.758, [0.9, 1.42, -11.0]],
  [0.8, [0.66, 1.5, -11.8]],
  [0.84, [0.62, 0.95, -12.9]],
  [0.866, [0.84, 0.5, -13.6]],
  [0.89, V(PERCH[2].pos), 1],
  [1.0, V(PERCH[2].pos), 1],
];
const N = KEYS.length;
const KP = KEYS.map((k) => k[0]);
function tangent(i, c) {
  if (KEYS[i][2]) return 0;
  const a = Math.max(0, i - 1);
  const b = Math.min(N - 1, i + 1);
  return (KEYS[b][1][c] - KEYS[a][1][c]) / (KP[b] - KP[a]);
}
/** The line of flight at progress p (no flutter). Returns `out`. */
export function pathAt(p, out) {
  p = clamp(p, 0, 1);
  let i = 0;
  while (i < N - 2 && p > KP[i + 1]) i++;
  const h = KP[i + 1] - KP[i];
  const f = clamp((p - KP[i]) / h, 0, 1);
  const f2 = f * f;
  const f3 = f2 * f;
  for (let c = 0; c < 3; c++) {
    const p1 = KEYS[i][1][c];
    const p2 = KEYS[i + 1][1][c];
    out.setComponent(c, (2 * f3 - 3 * f2 + 1) * p1 + (f3 - 2 * f2 + f) * tangent(i, c) * h + (-2 * f3 + 3 * f2) * p2 + (f3 - f2) * tangent(i + 1, c) * h);
  }
  return out;
}

// The plan of the world: where everything hangs, where the animal is, what it is turned toward, how much of it is woven,
// and where the lens stands — every one of them a pure function of progress. Nothing in this file reads the clock.
//
//   0.00  hand-in: one strand of silk with dew on it, the animal at rest on it, wings shut, side-on; a leaf of a few strands
//   0.10  its wings open; the lens goes in: the veins are the warp, a point of light shuttles the weft in between them
//   0.20  macro along a wing: filaments, their twist, their dew
//   0.28  it lets go. Wide: strands are being laid (points of light writing figures of eight), all of them leading to it
//   0.36  it turns to the leaf · 0.45 to the drop · 0.53 to the light · 0.61 to the pane: what it turns to pulls tight
//   0.70  up the one strand everything hangs from
//   0.78  under the glazing bar: it holds on; the wings unweave; the body shortens and thickens
//   1.00  hand-off: a small pad of silk under the steel bar, one bright curved thing wound in thread hanging from it

import * as THREE from 'three';
import { clamp, smoothstep, band } from '../../core/util.js';

export const DEG = Math.PI / 180;
/** how many times life size the animal is drawn */
export const SIZE = 4;
export const MM = 0.001 * SIZE;

// ---- where things hang (metres)
export const BAR_Y = 2.0; // underside of the steel glazing bar
export const PAD = new THREE.Vector3(0, BAR_Y, 0);
export const PANE_Z = -3.2; // the fogged glass
export const DROP = new THREE.Vector3(0, -0.2, 0); // the heaviest bead of dew on the strand
export const GLOW = new THREE.Vector3(0.42, -0.8, PANE_Z); // the low warm light, through the glass
export const LEAF = new THREE.Vector3(-0.24, 0.22, -0.06); // middle of the leaf of a few strands
export const PANE_AT = new THREE.Vector3(-1.1, 1.0, PANE_Z + 0.05); // the part of the pane it turns to
export const STRAND_BOTTOM = -2.4;
/** the chrysalis: how tall, and how far below the bar its middle hangs */
export const CHRYS_H = 0.075;
export const CHRYS_C = new THREE.Vector3(0, BAR_Y - 0.068, 0);
/** where its thorax is when it rests on the strand, and when it holds on under the bar */
export const REST = new THREE.Vector3(-4 * MM, 0, 0);
export const HANG = new THREE.Vector3(-4 * MM, CHRYS_C.y + 0.012, 0);

// strand groups (silk.js: uGroup)
export const G = { LEAF: 0, DROP: 1, LIGHT: 2, PANE: 3, PAD: 4, MAIN: 5, AMBIENT: 6, LOOSE: 7 };
export const TARGETS = [LEAF, DROP, GLOW, PANE_AT, PAD];
// poly groups (silk.js: uPoly)
export const PG = { LEAF: 0, TRAIL: 1, PAD: 2, WIND: 3, STALK: 4, HOLD_LIGHT: 5, HOLD_PANE: 6 };

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

// ---- the animal
/** 0 holding on to the strand … 1 in the air */
export const K_AIR = [[0, 0], [0.225, 0], [0.265, 1], [0.725, 1], [0.775, 0], [1, 0]];
/** how far its wings are open while it holds on (0 shut over its back … 1 fanning as it likes) */
export const K_OPEN = [[0, 0], [0.045, 0], [0.1, 0.85], [0.15, 0.95], [0.185, 0.22], [0.215, 0.22], [0.24, 0.6], [0.76, 0.5], [0.8, 0.9], [0.86, 0.25], [0.9, 0], [1, 0]];
/** how much of the wingbeat it uses in the air */
export const K_BEAT = [[0, 0.5], [0.26, 0.62], [0.7, 0.62], [0.76, 0.5], [1, 0.5]];
/** the weft between the veins: how much of it is woven */
export const K_WEFT = [[0, 0.3], [0.05, 0.34], [0.215, 1], [0.8, 1], [0.895, 0], [1, 0]];
/** the veins and margins themselves: they go last, drawn in from the tips */
export const K_WARP = [[0, 1], [0.86, 1], [0.935, 0], [1, 0]];
/** limbs and antennae */
export const K_LIMB = [[0, 1], [0.84, 1], [0.9, 0], [1, 0]];
/** the body: shorter and thicker, then gone into the winding */
export const K_SHORT = [[0, 0], [0.84, 0], [0.915, 1], [1, 1]];
export const K_BODY = [[0, 1], [0.93, 1], [0.98, 0], [1, 0]];
/** the winding that takes its place, and the metal under the thread */
export const K_WIND = [[0, 0], [0.895, 0], [0.982, 1], [1, 1]];
export const K_CHROME = [[0, 0], [0.9, 0], [0.985, 1], [1, 1]];
/** light of the drawn animal */
export const K_HERO = [[0, 1.0], [0.08, 1.0], [0.14, 1.1], [0.8, 1.2], [1, 1.2]];

const PATH = [
  [0, REST.x, REST.y, REST.z],
  [0.225, REST.x, REST.y, REST.z],
  [0.285, 0.1, 0.12, 0.22],
  [0.36, -0.04, 0.2, 0.2],
  [0.45, 0.15, -0.13, 0.14],
  [0.53, 0.3, -0.06, -0.05],
  [0.61, -0.08, 0.42, -0.2],
  [0.69, 0.1, 1.45, 0.14],
  [0.775, HANG.x, HANG.y, HANG.z],
  [1, HANG.x, HANG.y, HANG.z],
];
const mono = (keys, c) => {
  // monotone cubic (Fritsch–Carlson) through column c of keys: it never overshoots a key, and holds still between equal ones
  const n = keys.length;
  const tan = (k) => {
    if (k <= 0 || k >= n - 1) return 0;
    const d0 = (keys[k][c] - keys[k - 1][c]) / (keys[k][0] - keys[k - 1][0]);
    const d1 = (keys[k + 1][c] - keys[k][c]) / (keys[k + 1][0] - keys[k][0]);
    if (d0 * d1 <= 0) return 0;
    const m = 0.5 * (d0 + d1);
    const lim = 3 * Math.min(Math.abs(d0), Math.abs(d1));
    return Math.abs(m) > lim ? Math.sign(m) * lim : m;
  };
  return (p) => {
    p = clamp(p, 0, 1);
    let i = 0;
    while (i < n - 2 && p > keys[i + 1][0]) i++;
    const h = keys[i + 1][0] - keys[i][0];
    const f = clamp((p - keys[i][0]) / h, 0, 1);
    const f2 = f * f;
    const f3 = f2 * f;
    return (2 * f3 - 3 * f2 + 1) * keys[i][c] + (f3 - 2 * f2 + f) * tan(i) * h + (-2 * f3 + 3 * f2) * keys[i + 1][c] + (f3 - f2) * tan(i + 1) * h;
  };
};
const px = mono(PATH, 1);
const py = mono(PATH, 2);
const pz = mono(PATH, 3);
/** Where the animal is at progress p (before the small wander time gives it). */
export const pathAt = (p, out) => out.set(px(p), py(p), pz(p));

// ---- what it is turned toward
/** attention per target, 0..1: leaf, drop, light, pane, pad */
const ATT = [
  [0.315, 0.345, 0.395, 0.425],
  [0.405, 0.435, 0.48, 0.505],
  [0.485, 0.515, 0.565, 0.59],
  [0.57, 0.6, 0.65, 0.68],
  [0.66, 0.7, 0.86, 0.93],
];
export const attention = (i, p) => band(p, ...ATT[i]);
/** how much of the web has been laid, per group (the trails of light lay it between 0.22 and 0.33) */
export const K_LAID = [[0, 0], [0.215, 0], [0.33, 1], [1, 1]];
/** everything draws together into the pad */
export const K_GATHER = [[0, 0], [0.775, 0], [0.9, 1], [1, 1]];
export const K_WEB = [[0, 1], [0.79, 1], [0.905, 0.0], [1, 0.0]];
/** how much light the strands it is NOT turned to carry: little while the first of them are being laid (the lens is
 * close then, and they are a tangle across it), and little again once they are being drawn in to the pad */
export const K_REST = [[0, 0.4], [0.262, 0.4], [0.3, 1], [0.79, 1], [0.86, 0.45], [1, 0.45]];
/** …and the slack ones that run between the things themselves, which cross the whole frame */
export const K_SLACK = [[0, 0.3], [0.262, 0.3], [0.305, 1], [0.775, 1], [0.84, 0.1], [1, 0.1]];
/** seen from far off the strands are thinner than a pixel: they are given more light there */
export const K_WIDE = [[0, 1], [1, 1]];
/** the dawn behind the glass, and the pane itself */
/** dew on the filaments of the animal and the leaf: first light, then it dries */
export const K_DEW = [[0, 0.4], [0.2, 0.4], [0.32, 0.12], [0.75, 0.1], [0.82, 0.3], [1, 0.22]];
export const K_DAWN = [[0, 1], [0.6, 1], [0.8, 0.5], [1, 0.4]];

// ---- the lens
// [progress, lens offset from the animal, look-at offset from the animal, vertical field of view,
//  how much an upright frame opens the lens, K (blur px at infinity), exposure]
const H_IN = 0.76; // metres of height the hand-in frame shows (the animal as large as the world before leaves it)
const D_IN = H_IN / 2 / Math.tan(12 * DEG);
const H_OUT = CHRYS_H / 0.22;
const D_OUT = H_OUT / 2 / Math.tan(10 * DEG);
const OUT_Y = BAR_Y + 0.18 * H_OUT - H_OUT / 2 - HANG.y;
// An eighth entry rewrites a key for a frame that stands upright ({ pos, look, fov, open }): where the wide frame
// holds the animal and what it is turned to side by side, an upright one has to look more nearly at the animal itself.
const KEYS = [
  // the hand-in: the strand in the middle, the animal 30 % of the way down, the heaviest bead at 55 %
  [0, [-REST.x, -0.16, D_IN], [-REST.x, -0.16, 0], 24, 0, 16, 1.0],
  [0.05, [-REST.x, -0.155, D_IN - 0.12], [-REST.x, -0.155, 0], 24, 0, 16, 1.0],
  // in on the wings as they open: three-quarter, from a little below
  [0.115, [0.26, -0.03, 0.5], [-0.035, 0.012, 0], 26, 0.5, 16, 0.95, { look: [-0.05, 0.012, 0], open: 0.72 }],
  [0.155, [0.2, 0.0, 0.34], [-0.045, 0.02, 0.0], 26, 0.5, 18, 0.9, { look: [-0.058, 0.02, 0], open: 0.78 }],
  // macro along a wing
  [0.195, [-0.05, 0.04, 0.125], [-0.062, 0.03, 0.0], 26, 0.15, 16, 0.86],
  [0.215, [-0.066, 0.02, 0.125], [-0.074, 0.012, 0.0], 26, 0.15, 16, 0.86],
  [0.245, [-0.02, 0.08, 0.36], [-0.05, 0.02, 0.0], 28, 0.2, 14, 0.9],
  // wide: a small bright figure where every strand leads
  [0.3, [0.5, 0.5, 2.7], [0.0, 0.05, 0], 34, 0.3, 5, 1.12],
  [0.335, [0.3, 0.5, 2.3], [-0.05, 0.03, 0], 32, 0.3, 6, 1.1],
  // the leaf: from below and to the right, three-quarter
  [0.385, [0.34, 0.42, 0.78], [-0.07, 0.02, -0.02], 30, 0.35, 9, 1.0],
  // the drop: level, side-on, close
  [0.455, [0.34, -0.03, 0.82], [-0.06, -0.035, 0], 26, 0.4, 12, 0.95],
  // the light: behind it, looking down the strands into the glow
  [0.535, [-0.5, 0.2, 0.8], [0.12, -0.07, -0.2], 30, 0.35, 9, 0.92],
  // the pane: low and wide, looking up past it along the strands, which stay fine all the way to the glass
  [0.62, [0.72, -0.22, 0.6], [-0.2, 0.14, -0.5], 32, 0.3, 2.6, 1.0, { pos: [0.5, -0.3, 0.86], look: [-0.035, 0.06, -0.1], open: 0.3 }],
  // up the strand
  [0.7, [0.45, 0.3, 1.15], [0.0, 0.12, 0], 32, 0.3, 8, 1.0],
  // under the bar: it holds on, three-quarter
  [0.79, [0.26, -0.1, 0.62], [0.03, -0.01, 0], 26, 0.5, 22, 0.95, { look: [-0.02, -0.01, 0], open: 0.6 }],
  // close: the wings come apart
  [0.86, [-0.1, -0.03, 0.38], [0.0, -0.01, 0], 26, 0.7, 20, 0.92, { pos: [-0.1, -0.03, 0.66], look: [-0.07, -0.012, 0], open: 0.7 }],
  // the hand-off
  [0.955, [-HANG.x, OUT_Y, D_OUT], [-HANG.x, OUT_Y, 0], 20, 0, 22, 1.0],
  [1, [-HANG.x, OUT_Y, D_OUT], [-HANG.x, OUT_Y, 0], 20, 0, 22, 1.0],
];
const KEYSP = KEYS.map((k) => (k[7] ? [k[0], k[7].pos || k[1], k[7].look || k[2], k[7].fov || k[3], k[7].open ?? k[4], k[5], k[6]] : k));
const table = (T) => {
  const camF = [];
  for (let a = 1; a <= 2; a++) for (let c = 0; c < 3; c++) camF.push(mono(T.map((k) => [k[0], k[a][c]]), 1));
  const cols = [3, 4, 5, 6].map((j) => T.map((k) => [k[0], k[j]]));
  return { camF, fov: (p) => key(cols[0], p), open: (p) => key(cols[1], p), K: (p) => key(cols[2], p), exposure: (p) => key(cols[3], p) };
};
const WIDE = table(KEYS);
const UPRIGHT = table(KEYSP);

const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _pos2 = new THREE.Vector3();
const _tgt2 = new THREE.Vector3();
const _hero = new THREE.Vector3();
const sample = (T, p, tall, pos, tgt) => {
  pos.set(T.camF[0](p), T.camF[1](p), T.camF[2](p)).add(_hero);
  tgt.set(T.camF[3](p), T.camF[4](p), T.camF[5](p)).add(_hero);
  let fov = T.fov(p);
  const open = T.open(p);
  if (tall > 0 && open > 0) fov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (1 + open * tall)) * 180) / Math.PI;
  return fov;
};
/**
 * Place the camera for progress p — and nothing else: no clock, no pointer. Returns { hero, focus, K, exposure }.
 * In an upright frame the lens is opened where the animal would otherwise run out of the sides (and a few shots are
 * taken from another place altogether); the two hand-over frames are the same in every shape of frame.
 */
export function placeCamera(camera, p, aspect, out) {
  p = clamp(p, 0, 1);
  pathAt(p, _hero);
  const tall = clamp((1.25 - aspect) / 0.7, 0, 1);
  let fov = sample(tall >= 1 ? UPRIGHT : WIDE, p, tall, _pos, _tgt);
  if (tall > 0 && tall < 1) {
    const fov2 = sample(UPRIGHT, p, tall, _pos2, _tgt2);
    _pos.lerp(_pos2, tall);
    _tgt.lerp(_tgt2, tall);
    fov += (fov2 - fov) * tall;
  }
  camera.position.copy(_pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(_tgt);
  if (Math.abs(camera.fov - fov) > 1e-4 || camera.aspect !== aspect) {
    camera.fov = fov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  out.hero = _hero;
  out.focus = Math.max(0.08, _pos.distanceTo(_tgt));
  // seen from far off a filament is thinner than a pixel: it is given more light there (a function of the lens's place, so of progress)
  out.far = Math.pow(Math.max(1, _pos.distanceTo(_hero) / 0.85), 1.15);
  out.K = WIDE.K(p);
  out.exposure = WIDE.exposure(p);
  return out;
}

export { smoothstep, band, clamp };

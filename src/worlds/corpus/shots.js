// The crossing, as a plan: where the butterfly is, where the moon is, how big the sea runs and where the lens stands —
// every one of them a pure function of progress. Hold progress still and the lens holds still; only the animal and the
// water move. Nothing in this file reads the clock.
//
// The whole journey is shot from the moon line: the lens is always somewhere behind the animal on the line from it to
// the moon, because that is where the road of light lies, and the writing is only legible in the road.
//
//   0.00  hand-in: the moon, its road, the animal small and seen from behind (plain water: no writing yet)
//   0.16  telephoto, level with it: the moon's disc behind its wings
//   0.31  over its back, looking down: the route, in small print, read through the wings
//   0.385 a cross wind: it turns into it, and is seen from the side, low, the moon's road behind it and the writing
//         in the water showing through the clear cells of its wings
//   0.45  close behind it and level: the others ahead, a thin river of them along the road
//   0.58  the hard middle: a big sea, spindrift, the moon going in and out of cloud
//   0.80  calm again, the wind from the other side: side-on, a hand above the water, its image under it whole, and
//         the drops its wingtips knock off the surface
//   0.92  the moon goes down behind the low end of the land
//   1.00  hand-off: a dark shore, a slope, one warm light; the last glitter on the water

import * as THREE from 'three';
import { clamp } from '../../core/util.js';

export const DEG = Math.PI / 180;
/** how many times life size it is drawn (an 18 cm wingspan against letters a hand high) */
export const SIZE = 3.0;
export const MM = 0.001 * SIZE;
/** metres of open water */
export const PATH_LEN = 300;
/** where the moon stands relative to the heading, degrees (negative: to the left). Dead ahead for most of the night; as it
 * goes down it draws off to the left, and the animal does not follow it: it holds the heading it was given. */
export const K_MOON_AZ = [[0, 0], [0.72, 0], [0.95, -4.5], [1, -4.5]];
/** angular radius of the moon's disc (it is a storybook moon: several times the real one) */
export const MOON_R = 0.0205;
/** sum of the wave amplitudes at uSteep = 1: the highest any crest can ever stand (m) */
export const CREST = 1.4945;

// ---- the shore (see shore.js for the land itself)
/** z of the waterline dead ahead */
export const SHORE_Z = -(PATH_LEN + 35);
/** the one light: on the slope, dead ahead */
export const LAMP = new THREE.Vector3(0, 5.9, SHORE_Z - 23.5);

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

// ---- the sea and the sky along the way
/** how big the sea runs (multiplies every wave's amplitude): glass at both ends, a real sea in the middle */
export const K_STEEP = [[0, 0.075], [0.34, 0.08], [0.42, 0.2], [0.5, 0.42], [0.58, 0.8], [0.65, 0.75], [0.71, 0.4], [0.76, 0.1], [0.8, 0.06], [1, 0.06]];
/** how hard the crests are breaking */
export const K_BREAK = [[0, 0], [0.44, 0], [0.53, 0.75], [0.6, 1], [0.66, 0.8], [0.73, 0], [1, 0]];
/** cloud over the moon: twice in the hard middle it goes in, and the road goes with it */
export const K_VEIL = [[0, 0], [0.5, 0], [0.55, 0.62], [0.585, 0.45], [0.62, 0.08], [0.655, 0.45], [0.7, 0], [1, 0]];
/** the moon's height above the horizon, degrees: it is going down all night */
export const K_MOON_EL = [[0, 2.7], [0.5, 2.7], [0.8, 2.3], [0.9, 1.6], [0.96, 0.4], [1, -1.4]];
/** how much of the land has come out of the haze */
export const K_LAND = [[0, 0], [0.7, 0], [0.9, 1], [1, 1]];
/** how many of the others are still flying: all of them, then fewer */
export const K_OTHERS = [[0, 0], [0.07, 0], [0.34, 1], [0.5, 1], [0.72, 0.5], [0.88, 0.2], [1, 0.1]];

/** how near the lens a letter may lie on the water and still be drawn (m): close-ups along the surface drop the nearest
 * ones (out of focus they are only glare), the hand-over frames keep the foreground plain water, and where a caption
 * stands the sea does not write under it */
export const K_NEARFADE = [[0, 3.2], [0.06, 3.0], [0.11, 0.5], [0.19, 0.6], [0.2, 0.9], [0.255, 0.9], [0.285, 0], [0.34, 0], [0.39, 0.8], [0.41, 1.6], [0.49, 1.6], [0.53, 0.35], [0.72, 0.35], [0.775, 1.3], [0.835, 1.3], [0.9, 2.0], [1, 2.0]];

// ---- the animal
/** its height above the water it rides (m) */
export const K_ALT = [[0, 0.2], [0.1, 0.24], [0.15, 0.32], [0.22, 0.32], [0.27, 0.24], [0.34, 0.24], [0.42, 0.4], [0.5, 0.75], [0.6, 1.05], [0.68, 0.95], [0.72, 0.5], [0.765, 0.05], [0.84, 0.05], [0.9, 0.45], [1, 1.62]];
/** how much of the swell under it it follows (0: it holds its height and the water comes and goes under it) */
export const K_RIDE = [[0, 0.5], [0.1, 0.25], [0.14, 0.1], [0.23, 0.1], [0.27, 0.2], [0.34, 0.2], [0.4, 0.08], [0.5, 0.05], [0.68, 0.05], [0.74, 0.5], [0.8, 0.8], [0.88, 0.5], [1, 0]];
/** how flat the water has gone under it (0 … 1): late in the crossing, near land, there is a stretch with no wind on
 * it at all, and for as long as that lasts the animal has an image */
export const K_SLICK = [[0, 0], [0.74, 0], [0.775, 1], [0.835, 1], [0.87, 0], [1, 0]];
/** how far it wanders off its line (1 = ±9 cm): hardly at all while the lens is a hand from it */
export const K_WANDER = [[0, 0.2], [0.12, 0.12], [0.24, 0.12], [0.28, 0.07], [0.34, 0.07], [0.42, 0.25], [0.7, 0.3], [0.77, 0.1], [0.835, 0.1], [0.92, 0.5], [1, 0.22]];
/** how much of the wingbeat it uses (1 = the full stroke; less: wings held nearer a glide). It is gliding as it is handed
 * in and as it is handed on, so that both frames have a butterfly in them whenever they are taken; and side-on in the
 * first cross wind it beats shallow, wings never below its back, so that their faces are toward the lens all the time. */
export const K_BEAT = [[0, 0.3], [0.03, 0.4], [0.08, 1], [0.345, 1], [0.37, 0.56], [0.4, 0.56], [0.43, 1], [0.94, 1], [0.985, 0.3], [1, 0.3]];
/** nose-up attitude in flight (rad): higher where it is seen from behind, so that the wings show their faces; lower
 * where it is seen from the side, which is what a butterfly looks like */
export const K_PITCH = [[0, 0.62], [0.22, 0.62], [0.27, 0.36], [0.34, 0.36], [0.372, 0.3], [0.4, 0.3], [0.43, 0.5], [0.7, 0.5], [0.745, 0.5], [0.775, 0.3], [0.83, 0.3], [0.87, 0.58], [1, 0.62]];
/**
 * Which way its body points, off the line it is travelling (rad; +: nose to its left). Twice in the crossing the wind
 * takes it from the side. A butterfly over open water is not carried off its line by a cross wind: it turns into it
 * and flies crabwise, body across the track, and the track holds (this is how they are seen to cross lakes and
 * straits). For as long as each gust lasts, the lens — which has not moved off the moon line — has the animal
 * side-on, with the road of light behind it.
 */
export const K_YAW = [[0, 0], [0.343, 0], [0.37, 1.12], [0.4, 1.12], [0.427, 0], [0.742, 0], [0.772, -1.2], [0.832, -1.2], [0.862, 0], [1, 0]];

const _mo = new THREE.Vector3();
/** Unit vector toward the moon at progress p. */
export function moonAt(p, out = _mo) {
  const el = key(K_MOON_EL, p) * DEG;
  const az = key(K_MOON_AZ, p) * DEG;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** Where the butterfly is on its line at progress p, over a sea taken as flat: (x, height above the water, z). */
export function pathAt(p, out) {
  p = clamp(p, 0, 1);
  return out.set(0, key(K_ALT, p), -PATH_LEN * p);
}

// ---- the lens
// The moon line: `back` runs from the animal away from the moon, `side` to the right of that.
const frame = (p, v) => {
  const az = key(K_MOON_AZ, p) * DEG;
  const c = Math.cos(az);
  const s = Math.sin(az);
  return [c * v[0] - s * v[2], v[1], s * v[0] + c * v[2]];
};
/** A key given from the animal's own place at p, in the moon-line frame (side, up, back): lens = there + off, look-at = there + lead. */
// (Keys are kept as offsets from the animal and interpolated as offsets: the animal's own place is added afterwards,
// for the progress asked for. Interpolating world positions instead lets the lens run ahead of what it is looking at.)
const by = (p, off, lead, fov, open = 0) => [p, frame(p, off), frame(p, lead), fov, open];

const TAN13 = Math.tan(13 * DEG);
/**
 * The hand-in, as world 02 leaves it: the moon's centre 36 % of the way down the frame, the animal at 62 %, both in
 * the middle; a 26° lens makes the disc 9 % of the frame's height. `back` = how far behind the animal the lens stands.
 */
function handIn(p, back, moonY = 0.28, heroY = -0.24) {
  const el = key(K_MOON_EL, p) * DEG;
  const pitch = el - Math.atan(moonY * TAN13); // of the lens
  const drop = Math.atan(-heroY * TAN13) - pitch; // how far below the horizontal the animal is seen
  const up = back * Math.tan(drop);
  return by(p, [0, up, back], [0, up + Math.tan(pitch) * (back + 30), -30], 26);
}

/**
 * The hand-off, as world 04 takes it: the light in the middle, 58 % of the way down; the animal at 45 %, a little to
 * the left, on its way to the light; the waterline at 80 %.
 */
function handOff() {
  const H = pathAt(1, new THREE.Vector3());
  const back = 4.4;
  // the lens stands behind the animal on the line from the light, a little to the right of it
  const dir = new THREE.Vector3(LAMP.x - H.x, 0, LAMP.z - H.z).normalize();
  const right = new THREE.Vector3(-dir.z, 0, dir.x);
  const C = new THREE.Vector3().copy(H).addScaledVector(dir, -back).addScaledVector(right, 0.11);
  // …and low enough that the animal is 45 % of the way down while the light is at 58 %
  let y = 1.0;
  for (let i = 0; i < 12; i++) {
    const dl = Math.hypot(LAMP.x - C.x, LAMP.z - C.z);
    const pitch = Math.atan((LAMP.y - y) / dl) + Math.atan(0.16 * TAN13);
    y = H.y - back * Math.tan(pitch + Math.atan(0.1 * TAN13));
  }
  C.y = y;
  const dl = Math.hypot(LAMP.x - C.x, LAMP.z - C.z);
  const pitch = Math.atan((LAMP.y - y) / dl) + Math.atan(0.16 * TAN13);
  const T = new THREE.Vector3(LAMP.x, y + Math.tan(pitch) * dl, LAMP.z);
  return [1, [C.x - H.x, C.y - H.y, C.z - H.z], [T.x - H.x, T.y - H.y, T.z - H.z], 26, 0];
}

/** [progress, lens position, look-at, vertical field of view, how much an upright frame opens the lens] */
const KEYS = [
  handIn(0, 4.3),
  handIn(0.055, 3.9),
  by(0.105, [0.01, 0.16, 3.2], [0, 0.2, -8], 20, 0.1),
  // level with it, a long lens: the moon's disc stands behind its wings
  by(0.155, [0.006, -0.1, 2.2], [0.0, -0.004, 0], 8.5, 0.9),
  by(0.215, [0.004, -0.092, 2.0], [0.0, -0.004, 0], 8.5, 0.9),
  // up over its back
  by(0.245, [0.01, 0.2, 1.35], [0, 0.0, -0.05], 17, 0.6),
  // …and down onto it: the water under it is the page
  by(0.285, [0.0, 0.36, 0.62], [0, -0.05, -0.2], 28, 0.5),
  by(0.335, [0.0, 0.39, 0.58], [0, -0.05, -0.2], 28, 0.5),
  // the cross wind: the lens comes down behind it, a little above it, as it turns side-on. The water it is seen against
  // is the road two or three metres past it, and that is where the writing is
  by(0.372, [0.0, 0.16, 1.0], [0.0, 0.0, -1.0], 18, 0.7),
  by(0.402, [0.0, 0.15, 1.05], [0.0, 0.0, -1.0], 18, 0.7),
  // behind it and level, close: past it, the others — a few wingbeats ahead, and on to the horizon along the road
  by(0.437, [0.0, 0.1, 0.95], [0.28, -0.12, -8], 25, 0.55),
  by(0.475, [0.0, 0.14, 1.0], [0.3, -0.1, -8], 25, 0.55),
  // the hard middle: a real sea under it; the lens stays with the animal, just above the crests
  by(0.525, [0.02, 0.24, 1.15], [0.2, -0.5, -6], 27, 0.55),
  by(0.585, [0.02, 0.26, 1.2], [-0.15, -0.55, -6], 27, 0.55),
  by(0.655, [0.02, 0.24, 1.15], [0.0, -0.52, -6], 27, 0.55),
  by(0.715, [0.02, 0.26, 1.2], [0.08, -0.2, -5], 25, 0.5),
  // calm: low and close — the animal side-on, a hand above the water, and its image in the water under it
  by(0.775, [0.0, 0.13, 1.15], [0.0, -0.075, -0.6], 20, 0.5),
  by(0.83, [0.0, 0.14, 1.2], [0.0, -0.075, -0.6], 20, 0.5),
  by(0.885, [0.04, 0.05, 3.0], [0, 0.25, -8], 25, 0.1),
  by(0.95, [0.12, -0.42, 3.9], [0, 0.55, -20], 26, 0),
  handOff(),
];

// The lens along the way. Aperture 0 = the core's depth of field is not run at all.
export const K_APERTURE = [[0, 0], [0.06, 0], [0.11, 1.2], [0.155, 2.2], [0.215, 2.2], [0.25, 0.7], [0.275, 0], [0.37, 0], [0.43, 0.2], [0.475, 0.2], [0.525, 0.16], [0.66, 0.16], [0.72, 0.5], [0.775, 0.34], [0.835, 0.34], [0.88, 0.35], [0.93, 0], [1, 0]];
export const K_BLUR = [[0, 10], [0.11, 12], [0.155, 15], [0.215, 15], [0.26, 12], [0.7, 10], [0.77, 13], [0.84, 13], [0.9, 10], [1, 10]];
export const K_EXPOSURE = [[0, 1.0], [0.1, 1.0], [0.155, 0.9], [0.215, 0.9], [0.285, 1.12], [0.335, 1.12], [0.43, 1.05], [0.55, 1.12], [0.6, 1.25], [0.66, 1.12], [0.77, 1.0], [0.9, 1.05], [1, 1.12]];
/** the lens's bloom. Less of it on the long lens, where the moon's disc is a third of the frame and stands right behind
 * the animal: there its veil lay over the body and the black of the wings, and they were grey */
export const K_BLOOM = [[0, 0.6], [0.11, 0.6], [0.155, 0.16], [0.215, 0.16], [0.25, 0.6], [1, 0.6]];
export const K_NEAR = [[0, 0.06], [0.1, 0.06], [0.15, 0.04], [0.36, 0.04], [0.42, 0.1], [0.72, 0.1], [0.77, 0.05], [0.85, 0.05], [0.9, 0.08], [1, 0.08]];

const N = KEYS.length;
const KP = KEYS.map((k) => k[0]);
// Monotone cubic through the keys (Fritsch–Carlson): between two keys that say the same thing the lens holds still,
// and it never swings out past a key on its way to the next.
function tangent(k, get) {
  if (k <= 0 || k >= N - 1) return 0;
  const d0 = (get(k) - get(k - 1)) / (KP[k] - KP[k - 1]);
  const d1 = (get(k + 1) - get(k)) / (KP[k + 1] - KP[k]);
  if (d0 * d1 <= 0) return 0;
  const m = 0.5 * (d0 + d1);
  const lim = 3 * Math.min(Math.abs(d0), Math.abs(d1));
  return Math.abs(m) > lim ? Math.sign(m) * lim : m;
}
function hermite(i, f, get) {
  const h = KP[i + 1] - KP[i];
  const p1 = get(i);
  const p2 = get(i + 1);
  const m1 = tangent(i, get) * h;
  const m2 = tangent(i + 1, get) * h;
  const f2 = f * f;
  const f3 = f2 * f;
  return (2 * f3 - 3 * f2 + 1) * p1 + (f3 - 2 * f2 + f) * m1 + (-2 * f3 + 3 * f2) * p2 + (f3 - f2) * m2;
}

const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _hero = new THREE.Vector3();

/**
 * Place the camera for progress p (and nothing else: no clock, no pointer). In an upright frame (a phone) the lens is
 * opened where the animal would otherwise run out of the sides of the picture; the two hand-over frames are the same
 * in every shape of frame.
 */
export function placeCamera(camera, p, aspect) {
  p = clamp(p, 0, 1);
  let i = 0;
  while (i < N - 2 && p > KP[i + 1]) i++;
  const f = clamp((p - KP[i]) / (KP[i + 1] - KP[i]), 0, 1);
  pathAt(p, _hero);
  for (let c = 0; c < 3; c++) {
    _pos.setComponent(c, _hero.getComponent(c) + hermite(i, f, (k) => KEYS[k][1][c]));
    _tgt.setComponent(c, _hero.getComponent(c) + hermite(i, f, (k) => KEYS[k][2][c]));
  }
  const s = f * f * (3 - 2 * f);
  let fov = KEYS[i][3] + (KEYS[i + 1][3] - KEYS[i][3]) * s;
  const open = KEYS[i][4] + (KEYS[i + 1][4] - KEYS[i][4]) * s;
  const tall = clamp((1.25 - aspect) / 0.7, 0, 1);
  if (tall > 0 && open > 0) fov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (1 + open * tall)) * 180) / Math.PI;
  // never under: wherever the keys put it, the lens stays above the highest crest this sea can raise
  _pos.y = Math.max(_pos.y, key(K_STEEP, p) * CREST + 0.07);
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
}

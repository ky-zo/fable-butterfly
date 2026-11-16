// Mirror — the plan. Where everything hangs, what state it is in and where the lens stands: every one of them a pure
// function of progress. Nothing in this file reads the clock or the pointer.
//
// The world is world 01's glasshouse (its real dimensions: ../conservatory/layout.js), a hand's width of it: the second
// mullion of the sunlit wall, where world 01 begins, and a short angle bar bolted across it a little higher up, under
// whose lip the chrysalis hangs.
//
//   0.00  hand-in: before first light. A steel bar across the top, a pad of silk under it, the chrysalis: mirror-silver
//   0.07  the lens comes round it as the light comes up: the glasshouse is in its surface
//   0.20  macro: condensation, one drop running, the room bent across the frame
//   0.285 through the surface
//   0.31  inside: liquid. It tries shapes round a few points that do not move: a knot, two halves, four paddles, wings
//   0.60  out again: the shell has gone clear, the folded wings show through it
//   0.69  it splits; the animal climbs out and hangs from the empty shell
//   0.76  the wings, wet and crumpled, are pumped flat from the base outward
//   0.88  it hangs still while they dry
//   0.925 it lets go, rights itself, and flies for the first time: a hand's width down to the mullion, where it settles
//   0.985 the first frame of world 01

import * as THREE from 'three';
import { clamp, smoothstep } from '../../core/util.js';
import { HW } from '../conservatory/layout.js';
import { PERCH, SIZE, MM, STAND, perchBasis } from '../conservatory/heroPath.js';
import { placeCamera as placeCamera01 } from '../conservatory/shots.js';

export { SIZE, MM, STAND, perchBasis };
export const DEG = Math.PI / 180;

// ---- where things are (metres, world 01's frame)
/** where it comes to rest: the body's centre on the flange of the mullion (world 01's first perch) */
export const P0 = PERCH[0].pos.clone();
export const FLANGE_X = -HW + 0.048; // the face of the mullion's flange
export const MULLION_Z = -1.0;
/** the angle bar: its vertical leg is bolted across the faces of the mullions, its lip stands out into the corridor */
export const BAR_Y = 1.538; // underside of the lip
export const LIP = { x0: FLANGE_X + 0.004, x1: FLANGE_X + 0.018, t: 0.003 };
export const LEG = { x0: FLANGE_X, x1: FLANGE_X + 0.004, h: 0.036 };
export const PAD = new THREE.Vector3(FLANGE_X + 0.011, BAR_Y, -1.042);
/** the chrysalis: how tall, and where its middle hangs */
export const CH_H = 0.021;
export const CH_C = new THREE.Vector3(PAD.x, BAR_Y - 0.018, PAD.z);
/** its own axes in the world: x (the side the wing cases swell to), y up, z (toward the corridor) */
export const CH_X = new THREE.Vector3(0, 0, -1);
export const CH_Y = new THREE.Vector3(0, 1, 0);
export const CH_Z = new THREE.Vector3(1, 0, 0);
/**
 * Where the thorax of the new animal is while it hangs from the empty shell, and how far its head is above level
 * (it hangs back down). Found by trying every place near the shell (the surface is chrysalis.js: chP, split) for the
 * one where all four feet reach it with the legs at their own length and the body clear of it by a millimetre:
 * in front of the split and a little under it, the middle feet on its two lips, the hind feet either side of its end.
 */
export const HANG = new THREE.Vector3(CH_C.x, CH_C.y - 0.0095, CH_C.z - 0.006);
export const HANG_PITCH = 35 * (Math.PI / 180);
/** …and where each foot holds on there, as millimetres from where it would stand (body frame; hero.js) */
export const HANG_FEET = [[-1.62, -0.51, -1.73], [1.62, -0.51, -1.73], [-2.5, 0.43, -1.94], [2.5, 0.43, -1.94]];

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

/** A monotone cubic through column c of keys (Fritsch–Carlson): never overshoots a key, holds still between equal ones. */
export function mono(keys, c) {
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
    p = clamp(p, keys[0][0], keys[n - 1][0]);
    let i = 0;
    while (i < n - 2 && p > keys[i + 1][0]) i++;
    const h = keys[i + 1][0] - keys[i][0];
    const f = clamp((p - keys[i][0]) / h, 0, 1);
    const f2 = f * f;
    const f3 = f2 * f;
    return (2 * f3 - 3 * f2 + 1) * keys[i][c] + (f3 - 2 * f2 + f) * tan(i) * h + (-2 * f3 + 3 * f2) * keys[i + 1][c] + (f3 - f2) * tan(i + 1) * h;
  };
}

// ---- the story's dials
/** the light: 0 before dawn … 1 the low warm sun world 01 opens in */
export const K_DAY = [[0, 0], [0.05, 0.03], [0.14, 0.34], [0.24, 0.6], [0.3, 0.66], [0.6, 0.7], [0.7, 0.8], [0.86, 0.94], [0.95, 1], [1, 1]];
/** condensation on the shell */
export const K_FOG = [[0, 0.18], [0.1, 0.3], [0.2, 0.62], [0.3, 0.7], [0.6, 0.5], [0.68, 0.3], [1, 0.25]];
/** how far inside the lens is: 0 the glasshouse … 1 the liquid */
export const K_IN = [[0, 0], [0.283, 0], [0.312, 1], [0.598, 1], [0.628, 0], [1, 0]];
/** the shell: 0 chrome … 1 clear, what is folded inside showing through */
export const K_CLEAR = [[0, 0], [0.6, 0.12], [0.67, 1], [1, 1]];
/** it splits, and the animal comes out of it */
export const K_SPLIT = [[0, 0], [0.685, 0], [0.74, 1], [1, 1]];
export const K_OUT = [[0, 0], [0.692, 0], [0.765, 1], [1, 1]];
/** the kit's hatching number: 0 crumpled … 0.75 pumped flat … 1 dry */
export const K_EMERGE = [[0, 0], [0.75, 0], [0.865, 0.75], [0.915, 0.96], [0.96, 1], [1, 1]];
/** the film of fluid on the wings drying off them: 0 all of it there … 1 gone (hero.js: the colours it takes as it goes) */
export const K_DRY = [[0, 0], [0.852, 0], [0.878, 0.22], [0.9, 0.5], [0.922, 0.8], [0.945, 1], [1, 1]];
/** its first flight: from under the shell down to the mullion */
export const K_WALK = [[0, 0], [0.915, 0], [0.974, 1], [1, 1]];
/** the empty shell: 0 full … 1 a husk */
export const K_HUSK = [[0, 0], [0.71, 0], [0.77, 1], [1, 1]];

// ---- where the animal is (its thorax), outside: coming out of the shell, hanging under it, flying down to the mullion
const IN = new THREE.Vector3(CH_C.x, CH_C.y - 0.27 * CH_H, CH_C.z - 0.0012);
const MID = new THREE.Vector3(CH_C.x + 0.0005, CH_C.y - 0.6 * CH_H, CH_C.z - 0.0046);
/**
 * The flight: [w, position]. It drops away from the shell and out from the steel (its wings are three centimetres
 * each: beating, they need that much room beside the mullion), comes down beside it, and in to where world 01 finds it.
 * hero.js holds how it is turned along the way.
 */
export const WALK = [
  [0, HANG.toArray()],
  [0.14, [FLANGE_X + 0.026, HANG.y - 0.009, HANG.z + 0.003]],
  [0.45, [FLANGE_X + 0.042, P0.y + 0.05, P0.z - 0.026]],
  [0.74, [FLANGE_X + 0.034, P0.y + 0.016, P0.z - 0.007]],
  [0.92, [P0.x + 0.003, P0.y + 0.0015, P0.z]],
  [1, P0.toArray()],
];
const walkF = [0, 1, 2].map((c) => mono(WALK.map((k) => [k[0], k[1][c]]), 1));
const ss = (x) => x * x * (3 - 2 * x);
/** Where its thorax is at progress p (no clock). */
export function heroPos(p, out) {
  const w = key(K_WALK, p);
  if (w > 0) return out.set(walkF[0](w), walkF[1](w), walkF[2](w));
  const o = key(K_OUT, p);
  if (o < 0.55) return out.copy(IN).lerp(MID, ss(o / 0.55));
  return out.copy(MID).lerp(HANG, ss((o - 0.55) / 0.45));
}

// ---- the lens outside
// world 01's opening shot, taken from world 01 itself for whatever shape of frame this is
const _cam01 = new THREE.PerspectiveCamera(12, 1, 0.012, 70);
const C = CH_C;
const HIN = CH_H / 0.22; // metres of height the hand-in frame shows
const DIN = HIN / 2 / Math.tan(10 * DEG);
const INY = -0.24 * Math.tan(10 * DEG) * DIN; // the chrysalis sits at 38 % of the frame's height
// what the wings hang round while they are pumped
const W = new THREE.Vector3(HANG.x, HANG.y - 0.012, HANG.z - 0.006);
const P01 = [P0.x + 0.04, P0.y, P0.z + 0.28];
const T01 = [P0.x + 0.031, P0.y + 0.001, P0.z];
const ang = (deg, r, y = 0) => [C.x + Math.cos(deg * DEG) * r, C.y + y, C.z - Math.sin(deg * DEG) * r];
// [progress, lens, look-at, vertical field of view, how much an upright frame opens the lens]
const KEYS = [
  // the hand-in: bar across the top, the pad at the centre, the chrysalis at 38 %
  [0, [C.x + DIN, C.y + INY, C.z], [C.x, C.y + INY, C.z], 20, 0],
  [0.055, [C.x + DIN - 0.03, C.y + INY * 0.9, C.z], [C.x, C.y + INY * 0.9, C.z], 20, 0],
  // round it, toward the long view down the corridor, as the light comes up
  [0.12, ang(10, 0.15, 0.006), [C.x, C.y - 0.001, C.z], 19, 0.1],
  [0.2, ang(16, 0.09, 0.012), [C.x, C.y - 0.0015, C.z - 0.0012], 19, 0.25],
  // macro: the room in the surface
  [0.255, ang(15, 0.042, 0.007), [C.x + 0.001, C.y - 0.002, C.z - 0.0016], 22, 0.3],
  [0.285, ang(14, 0.023, 0.004), [C.x + 0.002, C.y - 0.0022, C.z - 0.002], 24, 0.3],
  [0.312, ang(13, 0.014, 0.002), [C.x + 0.002, C.y - 0.0022, C.z - 0.002], 26, 0.3],
  // (inside: the lens out here waits where it will come out)
  [0.598, ang(4, 0.022, -0.002), [C.x, C.y - 0.003, C.z], 26, 0.3],
  [0.628, ang(2, 0.04, -0.002), [C.x, C.y - 0.003, C.z], 24, 0.3],
  // the shell is clear: what is folded inside it
  [0.67, ang(20, 0.085, -0.003), [C.x, C.y - 0.002, C.z], 19, 0.2],
  // it splits; it climbs out
  [0.725, ang(9, 0.115, -0.012), [C.x, C.y - 0.009, C.z - 0.002], 20, 0.25],
  [0.765, [W.x + 0.125, W.y + 0.004, W.z + 0.004], [W.x, W.y + 0.008, W.z], 20, 0.3],
  // macro on the wet wings
  [0.8, [W.x + 0.086, W.y + 0.004, W.z + 0.004], [W.x, W.y + 0.0065, W.z - 0.001], 20, 0.95],
  [0.855, [W.x + 0.112, W.y - 0.003, W.z + 0.008], [W.x, W.y - 0.003, W.z - 0.005], 21, 1.1],
  // it hangs still while they dry: all of it, the shell above, the steel beside
  [0.905, [W.x + 0.165, W.y + 0.002, W.z + 0.02], [W.x - 0.003, W.y + 0.005, W.z - 0.005], 20, 0.95],
];
// the flight: the lens goes round to where world 01 will stand, keeps the animal in the middle of the frame while its
// wings are spread, and lets it come to where world 01 will find it as it shuts them
{
  const h = new THREE.Vector3();
  const off = [mono([[0, 0.165], [0.3, 0.1], [0.6, 0.055], [1, 0.04]], 1), mono([[0, 0.004], [0.4, 0.012], [1, 0]], 1), mono([[0, 0.02], [0.3, 0.2], [0.6, 0.265], [1, 0.28]], 1)];
  const lead = mono([[0, 0], [0.6, 0.003], [0.82, 0.018], [1, 0.031]], 1);
  const fv = mono([[0, 20], [0.35, 18], [0.7, 14], [1, 12]], 1);
  // (an upright frame is barely wider than the spread wings at this distance: the lens opens for them)
  const op = mono([[0, 0.95], [0.1, 1.5], [0.2, 1.9], [0.35, 1.7], [0.6, 1.25], [1, 1.05]], 1);
  // (hanging, the wings are all to one side of the body and below it: the lens looks at the middle of the whole
  //  animal, and comes back to the body as they spread)
  const tz = mono([[0, -0.013], [0.14, -0.009], [0.3, 0]], 1);
  const ty = mono([[0, -0.007], [0.12, 0], [0.26, 0.007], [0.6, 0.002], [1, 0]], 1);
  for (let i = 1; i <= 9; i++) {
    const e = i / 9;
    const p = 0.915 + (0.985 - 0.915) * e;
    heroPos(p, h);
    KEYS.push([p, [h.x + off[0](e), h.y + off[1](e) + ty(e), h.z + off[2](e) + tz(e)], [h.x + lead(e), h.y + 0.001 * e + ty(e), h.z + tz(e)], fv(e), op(e)]);
  }
  KEYS.push([1, P01, T01, 12, 1.05]);
}
const camF = [];
for (let a = 1; a <= 2; a++) for (let c = 0; c < 3; c++) camF.push(mono(KEYS.map((k) => [k[0], k[a][c]]), 1));
const fovF = mono(KEYS.map((k) => [k[0], k[3]]), 1);
const openF = mono(KEYS.map((k) => [k[0], k[4]]), 1);

/** In an upright frame the animal would not fit side-on while it hangs: the lens comes round behind it (radians). */
const K_TURN = [[0, 0], [0.705, 0], [0.775, 0.62], [0.918, 0.62], [0.94, 0.25], [0.955, 0], [1, 0]];
/** …and stands a little higher, so that it and the shell it hangs from sit in the middle of the frame, not the top of it (metres) */
const K_RISE = [[0, 0], [0.76, 0], [0.84, 0.006], [0.91, 0.007], [0.945, 0], [1, 0]];
const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _q = new THREE.Quaternion();
/**
 * Place the outside camera for progress p — and nothing else: no clock, no pointer.
 * In an upright frame the lens opens where the subject would run out of the sides; the hand-in is the same picture in
 * every shape of frame, and the last frame is world 01's own first frame for that shape.
 */
export function placeCamera(camera, p, aspect) {
  p = clamp(p, 0, 1);
  _pos.set(camF[0](p), camF[1](p), camF[2](p));
  _tgt.set(camF[3](p), camF[4](p), camF[5](p));
  let fov = fovF(p);
  const tall = clamp((1.25 - aspect) / 0.7, 0, 1);
  const end = smoothstep(0.95, 0.985, p);
  const open = openF(p) * (1 - end);
  if (tall > 0 && open > 0) fov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (1 + open * tall)) * 180) / Math.PI;
  const turn = tall > 0 ? key(K_TURN, p) * tall : 0;
  if (tall > 0) {
    const rise = key(K_RISE, p) * tall;
    _tgt.y += rise;
    _pos.y += rise;
  }
  if (turn > 0) {
    // (…and looks a little further back along it, so that the end of the abdomen is in the picture)
    _tgt.z += 0.012 * turn;
    _pos.z += 0.012 * turn;
    const dx = _pos.x - _tgt.x;
    const dz = _pos.z - _tgt.z;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    _pos.x = _tgt.x + dx * c - dz * s;
    _pos.z = _tgt.z + dx * s + dz * c;
  }
  camera.position.copy(_pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(_tgt);
  if (end > 0) {
    // the last stretch eases into world 01's opening camera, whatever that is for this frame
    _cam01.aspect = aspect;
    placeCamera01(_cam01, 0, aspect);
    const e = end * end * (3 - 2 * end);
    camera.position.lerp(_cam01.position, e);
    camera.quaternion.slerp(_q.copy(_cam01.quaternion), e);
    const t0 = Math.tan((fov * Math.PI) / 360);
    const t1 = Math.tan((_cam01.fov * Math.PI) / 360);
    fov = (2 * Math.atan(t0 * Math.pow(t1 / t0, e)) * 180) / Math.PI;
  }
  if (Math.abs(camera.fov - fov) > 1e-5 || camera.aspect !== aspect) {
    camera.fov = fov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
}

/** what the lens is focused on outside, as a distance from it */
export function focusAt(camera, p, heroPos) {
  const onHero = smoothstep(0.73, 0.775, p);
  _tgt.copy(CH_C).lerp(heroPos, onHero);
  return Math.max(0.01, camera.position.distanceTo(_tgt));
}

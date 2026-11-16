// MOTION · pose values from time. Pure functions of their arguments (no state, no allocation, any t in any order),
// except Feet, which remembers where four feet were put down.
//
//   wingbeat(t, out)            the stroke of one in flight: bursts of beats and the glide after them
//   fanning(t, seed, out)       the slow opening and closing of the wings of one at rest
//   flap(t, seed, hz, out)      a cheaper beat for the many small ones
//   flightPose(pose, t, …)      wingbeat → a whole pose (wings, legs tucked, abdomen countering the stroke)
//   restPose(pose, t, …)        fanning → a whole pose (legs down, a breath, an antenna flicking now and then)
//   emergePose(pose, u, t)      0..1 through hatching: crumpled and hanging → pumped flat → dry and opening
//   flightBasis(…)              heading + pitch + roll → the body's three axes
//   Feet                        plants the four feet: they stay where they stand while the body turns, and step

import * as THREE from 'three';
import { FEET } from './bodyData.js';

const sstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hash1 = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Seconds per wingbeat (slower than life, so that it reads and never strobes), and per burst-and-glide. */
export const BEAT = 0.2;
export const CYCLE = 1.9;
const TOP = 1.56; // wings clapped together over the back
/** The forewing's stroke angle with the wings shut at rest (the hindwing is REST - 0.05). */
export const REST = 1.53;
const BOTTOM = -0.52;
/** How much of wingbeat()'s `flex` goes into the pose (wings.w): the wing bends and cups, it is never a flat plate. */
export const FLEX = 0.55;
const GLIDE = 0.5;
// 0 at the top of the stroke … 1 at the bottom … 0: the downstroke takes the first 44 % of the beat
const stroke = (ph) => {
  ph -= Math.floor(ph);
  return ph < 0.44 ? 0.5 - 0.5 * Math.cos((Math.PI * ph) / 0.44) : 0.5 + 0.5 * Math.cos((Math.PI * (ph - 0.44)) / 0.56);
};

/**
 * The wings in flight at time t (seconds). Writes into `out` and returns it:
 *   fore, hind  stroke angles (rad above the body's plane): the forewing leads, the hindwing follows 0.045 of a beat later
 *   flex        bend along the span (the tip trails the root)          twist   feathering: with the stroke it makes
 *                                                                              the tip draw a narrow figure of eight
 *   lift        metres the body is carried above its path              pitch   rad the body nods against the stroke
 *   beating     0..1 burst envelope (0 in the glide)                   index   which beat this is (-1 in the glide)
 *   phase       0..1 within the beat (0 = top of the stroke)
 */
export function wingbeat(t, out) {
  const c = Math.floor(t / CYCLE);
  const local = t - c * CYCLE;
  // (a glasswing floats: a few easy beats, then a long glide)
  const beats = 4 + Math.floor(hash1(c) * 2.99);
  const burst = beats * BEAT;
  if (local < burst) {
    const b = Math.floor(local / BEAT);
    const ph = local / BEAT - b;
    const env = Math.min(1, Math.min(local / 0.07, (burst - local) / 0.09));
    const x = stroke(ph);
    // (the two wings of a side are hooked together and beat as one sheet: the hindwing is a twentieth of a beat behind)
    const xh = stroke(ph - 0.045);
    out.fore = TOP - (TOP - BOTTOM) * x * env - (TOP - GLIDE) * (1 - env) * 0.9;
    out.hind = TOP - 0.08 - (TOP - 0.08 - BOTTOM * 0.92) * xh * env - (TOP - GLIDE) * (1 - env) * 0.9;
    const v = ph < 0.44 ? Math.sin((Math.PI * ph) / 0.44) : -0.8 * Math.sin((Math.PI * (ph - 0.44)) / 0.56);
    out.flex = 0.42 * v * env;
    out.twist = -0.26 * Math.sin((ph - 0.06) * 6.2832) * env;
    out.lift = env * 0.0045 * (x - 0.5) + 0.016 * sstep(0, burst, local);
    out.pitch = 0.11 * Math.sin((ph - 0.14) * 6.2832) * env;
    out.beating = env;
    out.index = c * 8 + b;
    out.phase = ph;
  } else {
    const g = (local - burst) / (CYCLE - burst);
    out.fore = GLIDE + 0.05 * Math.sin(t * 9.0);
    out.hind = GLIDE - 0.06 + 0.05 * Math.sin(t * 9.0 - 0.35);
    out.flex = 0.06;
    out.twist = 0;
    out.lift = 0.016 * (1 - g * g * (3 - 2 * g));
    out.pitch = -0.05 * Math.sin(g * Math.PI);
    out.beating = 0;
    out.index = -1;
    out.phase = 0;
  }
  return out;
}

/**
 * At rest: the wings open and close slowly, never quite the same way twice, and sometimes stay shut for a while.
 * `seed` (0..1) sets the rhythm apart for each animal or each rest. Writes fore, hind into `out`.
 */
export function fanning(t, seed, out) {
  const a = 0.5 - 0.5 * Math.cos(t * 0.74 + seed * 9.0);
  const b = 0.5 + 0.5 * Math.sin(t * 0.31 + seed * 4.0);
  // (mostly a narrow V, opening wide every few breaths)
  const open = a * a * (0.55 + 0.45 * b);
  // (shut, the wings are upright over the back and all but touching: that, more than anything, is a butterfly at rest)
  out.fore = REST - 0.8 * open;
  out.hind = out.fore - 0.05 - 0.14 * open;
  return out;
}

/**
 * A cheap beat for many small ones: bursts of plain sine beats at `hz`, then a short glide in a shallow V.
 * Writes fore, hind, flex, env (0 gliding … 1 beating) into `out`.
 */
export function flap(t, seed, hz, out) {
  const env = sstep(-0.25, 0.35, Math.sin(t * (1.1 + seed * 0.5) + seed * 40));
  const a = t * hz * 6.2832 + seed * 17;
  out.fore = 0.3 + env * (0.2 + 0.95 * Math.sin(a)) + (1 - env) * 0.12;
  out.hind = 0.25 + env * (0.15 + 0.85 * Math.sin(a - 0.5)) + (1 - env) * 0.1;
  out.flex = -0.05 * env * Math.cos(a);
  out.env = env;
  return out;
}

const _beat = { fore: 0, hind: 0, flex: 0, twist: 0, lift: 0, pitch: 0, beating: 0, index: -1, phase: 0 };
const _fan = { fore: 0, hind: 0 };

/**
 * A whole pose for one in flight at time t. Returns the beat (see wingbeat) so that the caller can add `lift` (m) to
 * the body's height and `pitch` (rad) to its nose.
 * @param amount  0..1 how much of the beat to show (0.45 with the wings held nearer a glide: reduced motion)
 */
export function flightPose(pose, t, amount = 1) {
  const wb = wingbeat(t, _beat);
  const g = GLIDE + 0.1;
  pose.wings.set(g + (wb.fore - g) * amount, g - 0.06 + (wb.hind - g + 0.06) * amount, wb.twist * amount, wb.flex * amount * FLEX);
  // (legs tight against the thorax, the abdomen all but in line with it, the antennae straight ahead in a narrow V)
  pose.limbs.set(1, 0.12 - 0.4 * wb.pitch, 0.22, 0);
  pose.twitch.set(0, 0, 0, 0);
  for (const f of pose.feet) f.set(0, 0, 0);
  return wb;
}

/**
 * A whole pose for one at rest at time t: fanning wings, legs down, a breath, an antenna flicking now and then.
 * @param seed 0..1, sets this animal's rhythm apart     @param open 0..1 scales how far the wings open (1 = as it likes)
 */
export function restPose(pose, t, seed = 0.37, open = 1) {
  fanning(t, seed, _fan);
  pose.wings.set(REST + (_fan.fore - REST) * open, REST - 0.05 + (_fan.hind - REST + 0.05) * open, 0, 0);
  pose.limbs.set(0, 0.1, 0, 0.6 + 0.4 * Math.sin(t * 1.9 + seed * 7));
  for (let s = 0; s < 2; s++) {
    const n = t / 2.3 + s * 0.41 + seed;
    const ph = n - Math.floor(n);
    const v = Math.exp(-Math.pow((ph - 0.3) / 0.04, 2)) * (hash1(Math.floor(n) + s * 7) - 0.3) * 0.5 + 0.03 * Math.sin(t * 1.1 + s * 2);
    if (s === 0) pose.twitch.x = v;
    else pose.twitch.y = v;
  }
  return pose;
}

/**
 * Hatching, as one number. u: 0 just out (wings a wet crumpled third of their size, hanging, shut) → 0.75 pumped flat
 * (still shut, still soft) → 1 dry, and opening for the first time. t gives it a little life (a shiver while it pumps).
 */
export function emergePose(pose, u, t = 0) {
  const pump = sstep(0.0, 0.75, u);
  const dry = sstep(0.75, 1.0, u);
  const shiver = (1 - dry) * pump * (1 - pump) * 4;
  pose.shape.set(pump, 0.6 * (1 - dry), 0, 0);
  const shut = 1.5 - 0.5 * dry * (0.5 - 0.5 * Math.cos(t * 0.74));
  pose.wings.set(shut + 0.02 * shiver * Math.sin(t * 23), shut - 0.08 + 0.02 * shiver * Math.sin(t * 23 + 1), 0, -0.05 * (1 - pump));
  pose.limbs.set(0, 0.45 * (1 - pump) + 0.1, 0.35 * (1 - pump), 0.5 + 0.5 * Math.sin(t * (2.6 - 0.7 * dry)) * (1 - 0.4 * dry));
  pose.twitch.set(0.04 * Math.sin(t * 1.3), 0.04 * Math.sin(t * 1.1 + 2), 0, 0);
  return pose;
}

const UP = new THREE.Vector3(0, 1, 0);
/**
 * The body's axes for one flying along `heading` (unit, horizontal-ish; world +Y is up): nose raised by `pitch`
 * (rad; 0.42 is a butterfly's ordinary flight attitude), banked by `roll`. Writes R (right), F (toward the head),
 * U (out of the back).
 */
export function flightBasis(heading, pitch, roll, R, F, U) {
  F.copy(heading).multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch));
  R.crossVectors(heading, UP).normalize();
  U.crossVectors(R, F);
  if (roll) {
    R.applyAxisAngle(F, roll);
    U.applyAxisAngle(F, roll);
  }
}

const _l = new THREE.Vector3();
const STEP_AT = 1.6; // mm a foot may be dragged from where it wants to stand before it steps
const STEP_TIME = 0.16; // seconds for lift, swing, place

/**
 * Plants the four feet. Each foot stays where it was put down (in the world) while the body turns or shifts above
 * it; when it has been pulled more than a millimetre and a half from where it wants to be, it lifts, swings and is set
 * down again — never while the foot beside it or the one behind it is in the air. Writes pose.feet (mm, body frame).
 *
 *   const feet = new Feet();
 *   feet.update(pose, bodyMatrix, dt)       // every frame it is standing; bodyMatrix = Glasswing.group.matrix
 *   feet.reset()                            // when it takes off, or is put somewhere else
 */
export class Feet {
  constructor() {
    this.planted = FEET.map(() => new THREE.Vector3());
    this.from = FEET.map(() => new THREE.Vector3());
    this.t = [1, 1, 1, 1]; // 0..1 through a step; 1 = down
    this.fresh = true;
    this.inv = new THREE.Matrix4();
  }

  reset() {
    this.fresh = true;
  }

  /** Lift foot i and set it down again where it stands (something a resting butterfly does now and then). */
  tap(i) {
    if (this.fresh || this.t[i] < 1 || this.t[i ^ 1] < 1 || this.t[i ^ 2] < 1) return;
    this.t[i] = 0;
    this.from[i].copy(this.planted[i]);
  }

  /** @param matrix body frame → world (Glasswing.group.matrix)   @param stride scales how far a foot is dragged before it steps */
  update(pose, matrix, dt, stride = 1) {
    this.inv.copy(matrix).invert();
    for (let i = 0; i < 4; i++) {
      const home = FEET[i];
      if (this.fresh || dt <= 0) {
        this.planted[i].set(home[0], home[1], home[2]).applyMatrix4(matrix);
        this.t[i] = 1;
      }
      // where the planted foot is now, as the body sees it
      _l.copy(this.planted[i]).applyMatrix4(this.inv);
      let lift = 0;
      if (this.t[i] < 1) {
        this.t[i] = Math.min(1, this.t[i] + dt / STEP_TIME);
        const k = this.t[i] * this.t[i] * (3 - 2 * this.t[i]);
        _l.copy(this.from[i]).applyMatrix4(this.inv);
        _l.set(_l.x + (home[0] - _l.x) * k, _l.y + (home[1] - _l.y) * k, _l.z + (home[2] - _l.z) * k);
        lift = Math.sin(Math.PI * this.t[i]) * 1.1;
        if (this.t[i] >= 1) this.planted[i].set(home[0], home[1], home[2]).applyMatrix4(matrix);
      } else if (dt > 0) {
        const d = Math.hypot(_l.x - home[0], _l.y - home[1]);
        // (diagonal pairs may go together, 0 with 3 and 1 with 2; never two feet of one side, never both of a pair)
        if (d > STEP_AT * stride && this.t[i ^ 1] >= 1 && this.t[i ^ 2] >= 1) {
          this.t[i] = 0;
          this.from[i].copy(this.planted[i]);
        }
      }
      // (a foot never leaves the surface it stands on, except to step)
      pose.feet[i].set(_l.x - home[0], _l.y - home[1], lift);
    }
    this.fresh = false;
    return pose;
  }
}

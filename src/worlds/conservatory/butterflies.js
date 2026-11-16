// The others. Outside, in the garden, butterflies are free: glasswings, an orange longwing, a small white. Some drift
// between the flowers; some come to rest on the OUTSIDE of the glass, undersides and feet against the pane, where the
// frost shows their feet razor sharp and their wingtips already soft. One of them settles opposite the one inside,
// head to head through the glass.
//
// They are the same animal as the one inside (the shared kit: shared/butterfly), drawn from a few hundred triangles
// each, all in two instanced draws; only the one that comes to the landing pane is built at full detail. Like every
// garden surface they write q (how far behind the pane they are) into alpha — that is this world's light rig.

import * as THREE from 'three';
import { smoothstep, clamp } from '../../core/util.js';
import { WALLS, ZE, HW } from './layout.js';
import { POOL, pathX } from './gardenEnv.js';
import { STAND, flap, fanning } from '../../shared/butterfly/index.js';
import { OPPOSITE } from './heroPath.js';

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** size against life, by species: glasswing, longwing, white */
const SIZES = [1, 1.35, 0.82];

const _fl = { fore: 0, hind: 0, flex: 0, env: 0 };

export class Butterflies {
  /**
   * @param kit    the butterfly kit
   * @param light  the light rig for something out in the garden (bfLight.js)
   */
  constructor(ctx, kit, light) {
    const lvl = ctx.quality.level;
    const r = ctx.rng(907);
    // ---- who is where
    const fl = [];
    const flier = (hx, hy, hz, rx, ry, rz, species = 0) => fl.push({ hx, hy, hz, rx, ry, rz, species, seed: r(), w1: 0.22 + r() * 0.2, w2: 0.2 + r() * 0.22, w3: 0.3 + r() * 0.3 });
    // along the sunlit border, close enough to the panes to be shapes in the fog
    flier(-HW - 0.75, 1.5, -3.6, 0.35, 0.3, 0.9);
    flier(-HW - 0.6, 1.2, -6.4, 0.3, 0.35, 0.8, 2);
    flier(-HW - 0.95, 1.75, -8.3, 0.5, 0.3, 0.8);
    flier(-HW - 0.7, 1.4, -10.6, 0.35, 0.4, 1.0, 1);
    flier(-HW - 1.2, 2.0, -12.4, 0.6, 0.4, 0.9);
    flier(HW + 0.8, 1.5, -10.8, 0.4, 0.3, 0.9);
    flier(HW + 1.0, 1.3, -5.0, 0.5, 0.35, 1.0, 2);
    // the garden beyond the end pane: over the path, over the water, in the shafts
    flier(pathX(ZE - 1.6), 1.35, ZE - 1.6, 0.5, 0.3, 0.6);
    flier(0.7, 1.7, ZE - 2.6, 0.9, 0.4, 0.8, 1);
    flier(-0.5, 1.1, ZE - 3.4, 0.8, 0.35, 1.0);
    flier(POOL.x - 0.4, 0.75, POOL.z + 0.3, 1.2, 0.3, 0.8, 2);
    flier(POOL.x + 0.5, 1.5, POOL.z - 0.5, 1.4, 0.5, 1.0);
    flier(-1.5, 2.1, ZE - 5.0, 1.0, 0.5, 1.2);
    flier(0.3, 2.4, ZE - 7.5, 1.6, 0.6, 1.4, 1);
    if (lvl >= 1) {
      flier(-0.9, 1.6, ZE - 1.2, 0.35, 0.25, 0.4, 2);
      flier(1.1, 1.2, ZE - 1.9, 0.5, 0.3, 0.5);
      flier(-HW - 0.55, 0.9, -1.8, 0.3, 0.25, 0.8);
    }
    // at rest on the outside of the glass: [wall, s, t, yaw, species]
    const sit = [
      [0, 2.62, 1.52, 0.3, 0], [0, 4.3, 1.0, -0.5, 2], [0, 6.42, 1.66, 0.15, 0], [0, 7.6, 0.92, 0.6, 0], [0, 10.55, 1.35, -0.25, 1], [0, 12.4, 1.6, 0.4, 0],
      [1, 11.18, 1.42, -0.2, 0], [1, 6.5, 1.2, 0.35, 2],
      [2, 0.86, 1.47, 0.25, 0], [2, 1.72, 1.12, -0.45, 0], [2, 1.42, 1.95, 0.1, 1],
    ].map(([wall, s, t, yaw, species]) => ({ wall, s, t, yaw, species, seed: r() }));
    this.fliers = fl;
    this.sitters = sit;
    const n = (this.count = fl.length + sit.length);

    // ---- all of them in two instanced draws
    const flock = (this.flock = kit.flock(n, { light, order: -20 }));
    fl.forEach((f, i) => flock.look(i, f.species, 0, f.seed, 0.5));
    sit.forEach((s, i) => flock.look(fl.length + i, s.species, 1, s.seed, 0.5));

    // ---- the one that comes to the landing pane
    this.free = kit.glasswing({ light, mode: 'cutout', seed: 0.71, order: -22, sheenOrder: 19000 });
    this.fan = { fore: 1, hind: 1 };
    this.group = new THREE.Group();
    this.group.add(flock.group, this.free.group);
  }

  _path(f, t, out) {
    const a = f.w1 * t + f.seed * 31;
    const b = f.w2 * t + f.seed * 57;
    const c = f.w3 * t + f.seed * 83;
    return out.set(f.hx + f.rx * (Math.sin(a) + 0.3 * Math.sin(2.3 * a + c)), f.hy + f.ry * (Math.sin(c) + 0.25 * Math.sin(1.9 * b)), f.hz + f.rz * (Math.cos(b) + 0.3 * Math.sin(1.7 * b + a)));
  }

  /** Basis for something flying along `vel` (unit-ish): Y = head, Z = back. Body pitched up a little. */
  _flyBasis(vel, pitch) {
    _y.copy(vel);
    _y.y *= 0.4;
    if (_y.lengthSq() < 1e-8) _y.set(0, 0, -1);
    _y.normalize();
    _x.crossVectors(_y, UP).normalize();
    _z.crossVectors(_x, _y);
    _y.addScaledVector(_z, pitch).normalize();
    _z.crossVectors(_x, _y);
  }

  /**
   * Pure function of time and progress — and, in play, of `shy`: how much the one that comes to the landing pane is
   * kept off it (1: it hovers two fingers above where it would settle, all but touching the glass; 0: it is where its
   * authored arrival puts it). Leave it out and everything is authored by progress alone, as it always was.
   */
  update(time, progress, shy = 0) {
    let i = 0;
    for (const f of this.fliers) {
      this._path(f, time, _p);
      this._path(f, time + 0.12, _a);
      _a.sub(_p);
      const w = flap(time, f.seed, f.species === 1 ? 5.5 : 7.5, _fl);
      _p.y += 0.012 * w.env * Math.sin(time * 7.5 * 6.2832 + f.seed * 17 + 1.2);
      this._flyBasis(_a, 0.45);
      this.flock.set(i++, _p, _x, _y, _z, SIZES[f.species], w.fore, w.hind, w.flex);
    }
    for (const s of this.sitters) {
      const w = WALLS[s.wall];
      const size = SIZES[s.species];
      _p.copy(w.origin).addScaledVector(w.u, s.s).addScaledVector(w.v, s.t).addScaledVector(w.n, -STAND * 0.001 * size);
      _z.copy(w.n).negate();
      _y.copy(w.v).multiplyScalar(Math.cos(s.yaw)).addScaledVector(w.u, Math.sin(s.yaw));
      _x.crossVectors(_y, _z);
      // basking: the wings open and close slowly, and now and then stay shut for a while
      const k = Math.sin(time * (0.5 + s.seed * 0.5) + s.seed * 50);
      const shut = smoothstep(0.55, 0.9, Math.sin(time * 0.13 + s.seed * 90));
      // (spread against the pane, so that from inside the whole wing is seen)
      const th = clamp(0.42 + 0.3 * k + 0.9 * shut, 0.1, 1.45);
      this.flock.set(i++, _p, _x, _y, _z, size, th, th - 0.1, 0);
    }
    this.flock.commit();

    // ---- the one that comes to the landing pane. It flies in as the one inside comes down, settles a moment after
    // it, stays, and leaves a little after it does: all of it a function of progress.
    const w = WALLS[OPPOSITE.wall];
    const tgt = _b.copy(w.origin).addScaledVector(w.u, OPPOSITE.s).addScaledVector(w.v, OPPOSITE.t).addScaledVector(w.n, -STAND * 0.001);
    const arrive = smoothstep(0.425, 0.494, progress);
    const leave = smoothstep(0.553, 0.63, progress);
    const u = arrive * (1 - leave);
    const k = 1 - u;
    const side = leave > 0 ? -1 : 1;
    // the way in (and, mirrored along the wall, the way out): a falling curve out of the garden
    _p.copy(tgt)
      .addScaledVector(w.n, -(k * 0.75 + k * k * 0.5))
      .addScaledVector(w.u, side * (k * k * 0.9 + 0.12 * Math.sin(k * 7)))
      .addScaledVector(w.v, k * 0.55 + 0.18 * Math.sin(k * 5 + 1) * k);
    // (play: kept off the pane it does not hang on a nail: it hovers where it waits, and drifts)
    const off = shy > 0 ? shy * smoothstep(0.6, 0.95, u) : 0;
    if (off > 0) {
      // (never more than a finger behind the glass: any farther and the fog has it)
      _p.addScaledVector(w.n, -(0.003 + 0.002 * Math.sin(time * 0.61)) * off)
        .addScaledVector(w.u, (-0.006 + 0.01 * Math.sin(time * 0.9 + 0.4)) * off)
        .addScaledVector(w.v, (0.032 + 0.008 * Math.sin(time * 1.37 + 2)) * off);
      _p.y += 0.005 * Math.sin(time * 47 + 1) * off;
    }
    const fw = flap(time, 0.37, 7.5, _fl);
    if (k > 0.02) _p.y += 0.006 * Math.sin(time * 47 + 1) * Math.min(1, k * 8);
    _a.copy(w.n).multiplyScalar(k > 0.02 ? 1 : 0).addScaledVector(w.u, -side * k * 0.8).addScaledVector(w.v, -0.4 * k + 0.25);
    this._flyBasis(_a, 0.5);
    const down = smoothstep(0.86, 1.0, u);
    // (kept off, it is turned to the pane as if it had settled, and goes on beating: seen from inside, all of its wings)
    // (its wings half spread on the glass, half beating: flat against the fog is the only way they are seen at all)
    const settle = down * (1 - 0.5 * off);
    // blend the flying frame into the resting one (its back to the garden, its head toward the one inside)
    _z.lerp(_a.copy(w.n).negate(), down).normalize();
    _y.lerp(_a.copy(w.u).multiplyScalar(OPPOSITE.head[0]).addScaledVector(w.v, OPPOSITE.head[1]), down);
    _y.addScaledVector(_z, -_y.dot(_z)).normalize();
    _x.crossVectors(_y, _z);
    fanning(time + 3.1, 0.71, this.fan);
    // (spread all but flat against the pane: from inside its whole wing is seen, and its hindwings lie along its abdomen)
    this.fan.fore = 0.14 + (this.fan.fore - 0.75) * 0.22;
    this.fan.hind = this.fan.fore - 0.05;
    const free = this.free;
    free.pose.wings.set(fw.fore + (this.fan.fore - fw.fore) * settle, fw.hind + (this.fan.hind - fw.hind) * settle, 0, fw.flex * (1 - settle));
    free.pose.limbs.set(1 - smoothstep(0.5, 1, settle), 0.1 * (1 - settle), 0.22 * (1 - settle), settle * 0.6);
    free.group.visible = u > 0.001;
    free.place(_p, _x, _y, _z, 1);
  }
}

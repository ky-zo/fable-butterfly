// Recollection: where the pointer rests on the water the words warm and a ring spreads through the text; when it
// moves on, the warmth it left fades. With nobody at the pointer the butterfly does the remembering: the lines left
// for it warm as it passes over them (uWake, set by hero.js), and a ring spreads where a wingtip meets the water.

import * as THREE from 'three';
import { damp } from '../../core/util.js';
import { NRIP, seaRay, seaInvert } from './waves.js';
import { NREC } from './shared.js';

const _d = new THREE.Vector3();
const _b = { x: 0, z: 0 };

export class Recall {
  constructor(U) {
    this.U = U;
    this.trail = Array.from({ length: NREC - 1 }, () => ({ x: 0, z: 0, born: -1e9, amp: 0, r: 1 }));
    this.rings = Array.from({ length: NRIP }, () => ({ x: 0, z: 0, born: -1e9, amp: 0 }));
    this.live = { x: 0, z: 0, s: 0, r: 1.2, valid: false };
    this.reset(-1);
  }

  reset(t) {
    for (const p of this.trail) p.amp = 0;
    for (const p of this.rings) p.amp = 0;
    this.live.valid = false;
    this.live.s = 0;
    this.ti = 0;
    this.ri = 0;
    this.moved = 0;
    this.sinceRing = 99;
    this.lastT = t;
  }

  drop(x, z, amp, r, t) {
    const p = this.trail[this.ti];
    this.ti = (this.ti + 1) % this.trail.length;
    p.x = x;
    p.z = z;
    p.amp = amp;
    p.r = r;
    p.born = t;
  }

  ring(x, z, amp, t) {
    const p = this.rings[this.ri];
    this.ri = (this.ri + 1) % this.rings.length;
    p.x = x;
    p.z = z;
    p.amp = amp;
    p.born = t;
  }

  update(frame, world, horizonNdc) {
    const { time: t, dt, pointer: ptr } = frame;
    if (t < this.lastT - 1e-4 || t - this.lastT > 2.5) this.reset(t);
    this.lastT = t;
    const cam = world.camera;
    const steep = this.U.uSteep.value;
    const active = !!(ptr && ptr.inside && ptr.idle < 5);

    // (with nobody at the pointer nothing is recalled by hand: the butterfly's own passage does it — see uWake)
    const nx = active ? ptr.x : 0;
    const ny = active ? ptr.y : 2;

    let dist = -1;
    if (ny > -1.05 && ny < horizonNdc - 0.01) {
      world._ray(nx, ny, _d);
      dist = seaRay(cam.position.x, cam.position.y, cam.position.z, _d.x, _d.y, _d.z, t, steep, 260);
    }

    const L = this.live;
    if (dist > 0) {
      seaInvert(cam.position.x + _d.x * dist, cam.position.z + _d.z * dist, t, steep, 8, _b);
      const rad = Math.max(0.26, Math.min(0.13 * dist, 0.5 + 0.03 * dist));
      const jump = L.valid ? Math.hypot(_b.x - L.x, _b.z - L.z) : 1e9;
      if (!L.valid || jump > 3 + rad * 2.5) {
        if (L.valid && L.s > 0.15) this.drop(L.x, L.z, L.s, L.r, t);
        L.x = _b.x;
        L.z = _b.z;
        L.r = rad;
        L.s = 0;
        L.valid = true;
        this.moved = 0;
        this.sinceRing = 99;
      } else {
        // a moving pointer is followed closely; a resting one stays with the words it found while the sea shifts under it
        const k = 1 - Math.exp(-(active ? (ptr.speed > 0.06 ? 9 : 1.4) : 2.5) * dt);
        const mx = (_b.x - L.x) * k;
        const mz = (_b.z - L.z) * k;
        L.x += mx;
        L.z += mz;
        this.moved += Math.hypot(mx, mz);
        L.r = damp(L.r, rad, 3, dt);
      }
      L.s = damp(L.s, 1, active ? 3.2 : 1.3, dt);
      if (this.moved > 0.6 * L.r) {
        this.drop(L.x, L.z, L.s * 0.7, L.r, t);
        this.moved = 0;
      }
      this.sinceRing += dt;
      if (this.sinceRing > (active ? 1.8 : 3.6) && L.s > 0.25) {
        this.ring(L.x, L.z, Math.min(0.07, 0.02 + 0.0035 * dist), t);
        this.sinceRing = 0;
      }
    } else {
      if (L.valid && L.s > 0.15) this.drop(L.x, L.z, L.s, L.r, t);
      L.valid = false;
      L.s = 0;
    }

    // ---- to the shaders
    const rec = this.U.uRecall.value;
    rec[0].set(L.x, L.z, L.r, L.valid ? L.s : 0);
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      const age = t - p.born;
      const s = p.amp > 0 && age >= 0 ? p.amp * Math.exp(-age / 1.3) : 0;
      if (s < 0.01) p.amp = 0;
      rec[i + 1].set(p.x, p.z, p.r * (1 + 0.07 * Math.max(age, 0)), s < 0.01 ? 0 : s);
    }
    const rip = this.U.uRip.value;
    for (let i = 0; i < this.rings.length; i++) {
      const p = this.rings[i];
      const age = t - p.born;
      if (p.amp <= 0 || age < 0 || age > 9) {
        p.amp = 0;
        rip[i].set(0, 0, 0, 0);
      } else rip[i].set(p.x, p.z, age, p.amp * Math.exp(-age * 0.45) * Math.min(1, age * 4));
    }
  }
}

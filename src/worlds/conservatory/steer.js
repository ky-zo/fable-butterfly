// Who moves the butterfly off its line. The pointer is where the visitor wants it to go: it veers that way, as far
// as a bounded offset from its path allows, and if what is pointed at is glass within reach it flies at the glass
// and bumps — a tap, the beads around shaken loose, and the fog brushed clear where the wings and the four feet met
// the pane. When nobody moves the pointer it does what a butterfly at a window does on its own: flutters up the
// nearest pane in short hops, bumping, slips back, and tries again somewhere else.
// While it is down on a perch the same hand only makes it turn and shuffle its feet.

import * as THREE from 'three';
import { clamp, smoothstep } from '../../core/util.js';
import { HULL, WALLS, hullExit, wallST } from './layout.js';
import { FEET } from '../../shared/butterfly/index.js';
import { MM } from './heroPath.js';

const REACH = 0.16; // metres off its line of flight, at most
const WING_MARK = 0.046; // how long a wing's mark on the fog is (a little more than the wing)
const BEAT_MARK = 0.06; // …and of one laid on it on purpose, beat after beat (play)

const _d = new THREE.Vector3();
const _t = new THREE.Vector3();
const _v = new THREE.Vector3();
const _st = new THREE.Vector2();

export class Steer {
  /**
   * @param cond   Condensation
   * @param rnd    deterministic rng
   * @param onTap  (strength 0..1, world position) → void
   * @param onBeat (wall) → void: in play, the player's own wings have just been laid on that pane
   */
  constructor(cond, rnd, onTap, onBeat = null) {
    this.cond = cond;
    this.rnd = rnd;
    this.onTap = onTap;
    this.onBeat = onBeat;
    // ---- play (docs/PLAY.md, section 5): set by the world (index.js)
    /** an offset from its line (m) that the world steers it to when nobody does: a gate playing itself out */
    this.auto = null;
    /** the idle hand may run (in play it only does where a gate has waited long enough) */
    this.ghostOn = false;
    /** how many times the idle hand has finished a run up a pane */
    this.ghostRuns = 0;
    /** is the player steering right now, and how far (m) that carried it off its line this frame */
    this.real = false;
    this.moved = 0;
    this._strokes = 0;
    /** seconds since its wings last marked a pane */
    this.since = 9;
    this.target = new THREE.Vector3();
    this.ghost = { wait: 2.2, t: 0, hops: [], wall: -1 };
    /** 0..1: how lately the glass was brushed (drives the sound of it) */
    this.rub = 0;
    this.touching = false;
    this.cool = 0;
    /** set by the world where the path has something of its own to show (the shadow): the idle hand keeps off */
    this.quiet = false;
  }

  /** Both wings laid against the pane at (s, t), body along (dx, dy); `feet`: and the four feet set down. */
  mark(wall, s, t, dx, dy, len, strength, feet) {
    const c = this.cond;
    const r = this.rnd;
    for (const side of [-1, 1]) {
      const a = side * (1.0 + (r() - 0.5) * 0.4);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const wx = dx * ca - dy * sa;
      const wy = dx * sa + dy * ca;
      c.fan(wall, s + wx * len * 0.08, t + wy * len * 0.08, wx, wy, len * (0.85 + r() * 0.3), strength);
    }
    if (feet) for (const [fx, fy] of FEET) c.foot(wall, s + (dx * fy - dy * fx) * MM, t + (dy * fy + dx * fx) * MM, 0.0015);
  }

  /** The idle hand: a few hops up the nearest pane, then a slip back down. */
  _plan(hero) {
    const g = this.ghost;
    let wall = -1;
    let best = REACH * 0.92;
    for (let i = 0; i < 3; i++) {
      const h = HULL[i];
      const d = h[3] - (h[0] * hero.base.x + h[1] * hero.base.y + h[2] * hero.base.z);
      if (d < best) {
        best = d;
        wall = i;
      }
    }
    if (wall < 0) return false;
    wallST(wall, hero.base, _st);
    const r = this.rnd;
    let s = _st.x + (r() - 0.5) * 0.16;
    let t = _st.y - 0.06 + (r() - 0.5) * 0.06;
    let time = 0;
    g.hops = [];
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const T = 0.3 + r() * 0.3;
      g.hops.push({ t0: time, t1: time + T, s, t });
      time += T + (r() < 0.3 ? 0.4 + r() * 0.5 : 0.05);
      s += (r() - 0.5) * 0.09;
      t += 0.035 + r() * 0.05;
    }
    g.hops.push({ t0: time, t1: time + 0.5, s: s + (r() - 0.5) * 0.1, t: t - 0.1 - r() * 0.08, away: true });
    g.T = time + 0.5;
    g.t = 0;
    g.wall = wall;
    return true;
  }

  /** One frame of the idle hand. Writes where it wants the butterfly into `tgt`; returns whether it wants anything. */
  _ghost(dt, hero, tgt) {
    const g = this.ghost;
    if (!g.hops.length) {
      g.wait -= dt;
      if (g.wait <= 0) g.wait = this._plan(hero) ? 0 : 1.5;
      return false;
    }
    g.t += dt;
    let h = g.hops[g.hops.length - 1];
    for (const k of g.hops) {
      if (g.t < k.t1) {
        h = k;
        break;
      }
    }
    const w = WALLS[g.wall];
    tgt.copy(w.origin).addScaledVector(w.u, h.s).addScaledVector(w.v, h.t).addScaledVector(w.n, h.away ? 0.12 : -0.03);
    if (g.t >= g.T) {
      g.hops.length = 0;
      g.wait = 2.6 + this.rnd() * 3.2;
      this.ghostRuns++;
    }
    return true;
  }

  /**
   * @param frame  the core's frame
   * @param camera this frame's camera
   * @param hero   Hero (its base, position, air, offset, offsetVel, yaw, upright are read and written)
   */
  update(frame, camera, hero) {
    const { pointer, dt, progress: p } = frame;
    if (dt <= 0) return;
    // play: the aim is the hand (a thumb that has dragged and now holds still is still steering); otherwise the pointer
    const play = frame.play;
    const on = !!play && play.mode === 'play';
    // scroll (docs/PLAY.md, section 15): the scroll flies it and the aim leans it (a mouse moved on purpose, or the
    // sideways part of a drag). Left alone it does what it does in the film.
    const sc = !!play && play.mode === 'scroll';
    const hand = on || sc;
    const real = hand ? play.aim.active : pointer.inside && pointer.idle < 5;
    this.real = real;
    this.moved = 0;
    const air = hero.air;
    const g = this.ghost;
    this.rub *= Math.exp(-3 * dt);
    this.cool -= dt;

    // ---- down on a perch: the hand turns it, the feet follow
    const calm = 1 - smoothstep(0.925, 0.95, p);
    // (in play the smoothed pointer rests at the centre, so that no lens can lean on it: the turn reads the aim itself)
    const wantYaw = real ? clamp(hand ? -play.aim.dx * 0.9 : -pointer.sx * 0.75, -0.65, 0.65) * calm : 0;
    const yaw0 = hero.yaw;
    hero.yaw += (wantYaw - hero.yaw) * (1 - Math.exp(-(air < 0.5 ? 2.2 : 6) * dt));
    hero.yawRate = (hero.yaw - yaw0) / dt;

    // ---- in the air: where does the hand want it?
    const tgt = this.target.copy(hero.base);
    let has = false;
    let reach = REACH;
    // (scroll with no hand on it is the film: today's reach, today's spring)
    const led = on || (sc && real);
    if (led) {
      // (played, a pane that is close is always within reach: the hand must be able to put it on the glass)
      let d0 = 9;
      for (let i = 0; i < 3; i++) {
        const h = HULL[i];
        d0 = Math.min(d0, h[3] - (h[0] * hero.base.x + h[1] * hero.base.y + h[2] * hero.base.z));
      }
      if (d0 < 0.22) reach = Math.max(REACH, d0 + 0.05);
    }
    if (air > 0.5) {
      if (real) {
        g.wait = 2.5;
        g.hops.length = 0;
        // (scroll: the pointer is left raw for the worlds that read it; the hand is the aim)
        _d.set(sc ? play.aim.x : pointer.x, sc ? play.aim.y : pointer.y, 0.5).unproject(camera).sub(camera.position).normalize();
        const hit = hullExit(camera.position, _d, 7);
        _t.copy(camera.position).addScaledVector(_d, hit.t);
        // (play: a thumb that rests where it came down is not pointing at anything. Only a lean that is meant, a
        // finger's width or more, sends it at the glass behind where it is aimed)
        const meant = hand ? smoothstep(0.05, 0.12, Math.hypot(play.aim.dx * camera.aspect, play.aim.dy)) : 1;
        // (scroll: nothing holds the journey beside a pane, so glass it could reach at all counts as glass pointed at)
        if (hit.idx > 2 || meant <= 0 || _t.distanceTo(hero.base) > (sc ? reach : REACH) * 1.5) {
          // not glass within reach: the point of that line of sight that passes nearest its path
          _t.copy(camera.position).addScaledVector(_d, Math.max(0.05, _v.subVectors(hero.base, camera.position).dot(_d)));
        } else {
          _t.addScaledVector(_v.set(HULL[hit.idx][0], HULL[hit.idx][1], HULL[hit.idx][2]), 0.03); // (aim past the pane: it does not know it is there)
          if (meant < 1) {
            const along = Math.max(0.05, _v.subVectors(hero.base, camera.position).dot(_d));
            _t.lerp(_v.copy(camera.position).addScaledVector(_d, along), 1 - meant);
          }
        }
        tgt.copy(_t);
        has = true;
      } else if (on) {
        // play: left alone it keeps to its line. Only a gate that has waited long enough moves it (the world says how)
        if (this.auto) {
          tgt.copy(hero.base).add(this.auto);
          has = true;
          g.hops.length = 0;
        } else if (this.ghostOn && air > 0.95) {
          if (!g.hops.length && g.wait > 0.4) g.wait = 0.4;
          has = this._ghost(dt, hero, tgt);
        } else {
          g.hops.length = 0;
          g.wait = 0.4;
        }
      } else if (!this.quiet && air > 0.95) {
        has = this._ghost(dt, hero, tgt);
      } else {
        g.hops.length = 0;
        g.wait = Math.max(g.wait, 1.2);
      }
    }
    _v.subVectors(tgt, hero.base);
    if (!has) _v.set(0, 0, 0);
    const len = _v.length();
    if (len > reach) _v.multiplyScalar(reach / len);
    // a soft spring: it is carried there, it does not snap (a little tighter under a thumb than under a cursor)
    const o = hero.offset;
    const ov = hero.offsetVel;
    const K = led ? 40 : 26;
    const C = led ? 10 : 7.5;
    ov.x += ((_v.x - o.x) * K - ov.x * C) * dt;
    ov.y += ((_v.y - o.y) * K - ov.y * C) * dt;
    ov.z += ((_v.z - o.z) * K - ov.z * C) * dt;
    o.addScaledVector(ov, dt);
    if (real) this.moved = ov.length() * dt * air;

    // ---- the glass
    let near = 9;
    let wall = -1;
    for (let i = 0; i < 3; i++) {
      const h = HULL[i];
      const d = h[3] - (h[0] * hero.position.x + h[1] * hero.position.y + h[2] * hero.position.z);
      if (d < near) {
        near = d;
        wall = i;
      }
    }
    const want = air > 0.5 ? 1 - smoothstep(0.03, 0.2, near) : 0;
    hero.upright += (want - hero.upright) * (1 - Math.exp(-5 * dt));
    const h = HULL[wall];
    const vn = ov.x * h[0] + ov.y * h[1] + ov.z * h[2]; // speed toward the pane
    const touch = air > 0.6 && near < 0.03;
    // (play: once it is being held on a pane and brushing it, coming back to the glass between two beats is not a
    // fresh blow: only one that arrives after more than half a second away is thrown back)
    this.since += dt;
    const bump = touch && !this.touching && vn > 0.02 && this.cool <= 0 && !(on && this.since < 0.62);
    // play: for as long as the hand holds it against a pane, every second downstroke lays both wings on the fog
    // (flown at glass by a cursor it bumps once and then leans there; a thumb that keeps holding keeps brushing)
    const stroke = on && hero.strokes !== this._strokes && (hero.strokes & 1) === 0;
    this._strokes = hero.strokes;
    const beat = !bump && stroke && real && play.held && air > 0.6 && near < 0.045 && this.cool <= 0 && !(play.gate && play.gate.stage === 2);
    if (bump || beat) {
      this.since = 0;
      wallST(wall, hero.position, _st);
      const w = this.cond.walls[wall];
      if (_st.x > 0.02 && _st.x < w.w - 0.02 && _st.y > 0.02 && _st.y < w.h - 0.02) {
        const k = bump ? clamp(vn / 0.5, 0.35, 1) : 0.5;
        // head up the pane, leaning the way it was going
        const along = ov.x * WALLS[wall].u.x + ov.y * WALLS[wall].u.y + ov.z * WALLS[wall].u.z;
        const dl = Math.hypot(along * 0.6, 1);
        this.cond.lift(wall, this.rnd());
        // (play: on the shade wall, where the frost is lit from in front and what is behind it is dark, a full mark is
        // a black hole in a bright picture: there it leaves a print, not a clearing)
        const str = (beat ? 0.9 : 0.55 + 0.4 * k) * (on && wall === 1 ? 0.42 : 1);
        this.mark(wall, _st.x, _st.y, (along * 0.6) / dl, 1 / dl, beat ? BEAT_MARK : WING_MARK, str, true);
        // (…and no beads are shaken loose there: every one that runs draws a dark line down the picture of the shadow)
        if (!(on && wall === 1)) this.cond.shake(wall, _st.x, _st.y, 0.13);
        this.rub = 1;
        this.cool = on ? 0.3 : 0.16;
        if (this.onTap) this.onTap(k, hero.position);
        if (on && real && this.onBeat) this.onBeat(wall);
      }
      // thrown back off the glass, to come at it again (a beat only rocks it off the pane)
      const back = bump ? vn * 1.5 + 0.2 : 0.14;
      ov.x -= h[0] * back;
      ov.y -= h[1] * back;
      ov.z -= h[2] * back;
    }
    this.touching = touch;
  }
}

/**
 * History: marks made before the visitor's arrival, so every shot of the path finds glass in a different state of
 * clearing. [wall, secondsBeforeArrival, wingLength, [[s, t], …]] — each point is a beat against the pane.
 */
export const HISTORY = [
  [0, 16.0, 0.11, [[3.3, 1.15], [3.38, 1.3], [3.3, 1.46], [3.45, 1.6]]],
  [1, 6.0, 0.1, [[4.45, 1.3], [4.38, 1.48], [4.5, 1.62], [4.42, 1.78]]],
  [0, 9.0, 0.085, [[5.6, 1.3], [5.68, 1.45], [5.62, 1.6]]],
  [0, 5.0, 0.05, [[8.63, 1.3], [8.6, 1.36]]],
  [0, 11.0, 0.075, [[8.72, 1.62], [8.8, 1.74], [8.74, 1.86]]],
  [1, 8.0, 0.085, [[11.9, 1.4], [12.0, 1.55], [11.92, 1.68], [12.05, 1.8]]],
  [1, 14.0, 0.1, [[9.9, 1.25], [10.0, 1.4], [9.92, 1.55]]],
  [2, 12.0, 0.1, [[0.8, 1.45], [0.9, 1.6], [0.82, 1.75]]],
];

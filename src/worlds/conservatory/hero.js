// The butterfly that is inside: where its body is and how it is held, every frame.
//
// Progress says where along its line of flight it is and whether it is down (heroPath.js). Time gives it life on top
// of that: the wingbeat, bursts and glides, a wandering course, the body nodding against each stroke; at rest the slow
// fanning of the wings, a breath, a twitch of an antenna, a foot lifted and set down again. The visitor's hand
// (steer.js) pushes it off its line, within bounds. None of this ever reaches the camera.

import * as THREE from 'three';
import { clamp, smoothstep } from '../../core/util.js';
import { HULL, WALLS } from './layout.js';
import { wingbeat, fanning, setShadow, Feet, FLEX, BEAT } from '../../shared/butterfly/index.js';
import { PRESSED } from './heroes.js';
import { SIZE, STAND, PERCH, airborne, perchAt, perchBasis, pathAt } from './heroPath.js';

const UP = new THREE.Vector3(0, 1, 0);
const GLIDE = 0.6; // wings held in a shallow V (what is left of the beat when motion is to be reduced)
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const hash1 = (n) => {
  const s = Math.sin(n * 91.7 + 13.1) * 43758.5453;
  return s - Math.floor(s);
};

// The leaves that lie against the glass: where the middle of each blade is, how much leaf there is, which side it is on.
// Sunlit from behind they are the brightest green things in the corridor, and what is near one takes a little of it.
const LEAVES = PRESSED.map(([wall, s, t, type, size, ang]) => {
  const w = WALLS[wall];
  const c = new THREE.Vector3().copy(w.origin).addScaledVector(w.u, s + Math.sin(ang) * size * 0.5).addScaledVector(w.v, t + Math.cos(ang) * size * 0.5);
  return { c, area: size * size * (type === 'fern' ? 0.3 : 0.6) * (wall === 1 ? 0.4 : 1), side: wall === 0 ? -1 : wall === 1 ? 1 : 0 };
});
/** Green light thrown back at `pos` by the leaves on the panes near it → out (rgb, a = which side most of it is on). */
function leafBounce(pos, out) {
  let sum = 0;
  let side = 0;
  for (let i = 0; i < LEAVES.length; i++) {
    const L = LEAVES[i];
    const k = L.area / (pos.distanceToSquared(L.c) + 0.02);
    sum += k;
    side += k * L.side;
  }
  const g = Math.min(sum * 0.22, 0.6);
  return out.set(0.3 * g, 0.72 * g, 0.12 * g, sum > 0 ? side / sum : 0);
}
/** A limit with no wall in it: x is passed through unchanged up to a, then eased toward b, which it never reaches. */
const ease = (x, a, b) => {
  const m = Math.abs(x);
  return m <= a ? x : Math.sign(x) * (a + (b - a) * Math.tanh((m - a) / (b - a)));
};

/** A slow wandering in three axes: metres off the line of flight at time t. */
function wander(t, out) {
  return out.set(
    (Math.sin(t * 0.83) + 0.5 * Math.sin(t * 1.97 + 1.3) + 0.22 * Math.sin(t * 4.3 + 0.7)) * 0.042,
    (Math.sin(t * 0.71 + 2.1) + 0.5 * Math.sin(t * 1.63 + 0.4) + 0.2 * Math.sin(t * 5.1)) * 0.026,
    (Math.cos(t * 0.67 + 0.9) + 0.5 * Math.sin(t * 2.23 + 2.0) + 0.22 * Math.sin(t * 3.7 + 1.1)) * 0.042,
  );
}

// ---- play (docs/PLAY.md, section 5): the beat under the player's hand
// One beat of the kit's own stroke at full strength, by phase. (wingbeat() is a function of time; 0.2 s into any of its
// cycles it is in the second beat of a burst, with the burst's envelope fully open: that beat is read out by phase,
// so the stroke the player drives is the kit's stroke and nothing of it is copied here.)
const _k = { fore: 0, hind: 0, flex: 0, twist: 0, lift: 0, pitch: 0, beating: 0, index: -1, phase: 0 };
const _idle = { fore: 0, hind: 0, flex: 0, twist: 0, lift: 0, pitch: 0, beating: 0, index: -1, phase: 0 };
const strokeAt = (ph) => wingbeat(BEAT + ph * BEAT, _k);
const FORE_TOP = strokeAt(0).fore;
const FORE_SPAN = FORE_TOP - strokeAt(0.44).fore;
const V_FORE = 0.6; // the shallow V the wings are held in when a hand lets go (the kit ends its own bursts there)
const V_HIND = 0.52;
const TAU = Math.PI * 2;

export class Hero {
  /**
   * @param kit    the butterfly kit
   * @param shared the world's uniform bag
   * @param light  the light rig for something inside the corridor (bfLight.js)
   * @param mirror the same light, as glass gives it back (bfLight.js: mirrorLight)
   */
  constructor(kit, shared, light, mirror) {
    // (it shows the room behind its wings out of focus, and its eyes hold the garden: both pictures are this world's)
    this.gw = kit.glasswing({ light, scene: true, eyeMap: true, uniforms: { uBfRes: shared.uRes, tBfScene: shared.tScene1, uBfLens: shared.uLens, tBfEye: shared.tEye, uBfEye: shared.uEyeGarden } });
    this.scene = new THREE.Scene();
    this.scene.add(this.gw.group);
    // what the pane it stands on gives back of it: a second animal behind the glass, sharing the first one's pose,
    // added to the picture and never hiding anything
    const twin = (this.twin = kit.glasswing({ light: mirror, detail: 'mid', pose: this.gw.pose, order: -40 }));
    for (const m of twin.mats) {
      m.depthTest = false;
      m.depthWrite = false;
      m.transparent = true;
      m.blending = THREE.CustomBlending;
      m.blendSrc = THREE.OneFactor;
      m.blendDst = THREE.OneMinusSrcAlphaFactor;
    }
    this.scene.add(twin.group);
    this.shared = shared;
    this.position = new THREE.Vector3();
    this.base = new THREE.Vector3();
    this.F = new THREE.Vector3(0, 0, -1);
    this.R = new THREE.Vector3(1, 0, 0);
    this.U = new THREE.Vector3(0, 1, 0);
    this.heading = new THREE.Vector3(0, 0, -1);
    this.air = 0;
    this.perch = 0;
    this.beat = { fore: 1, hind: 1, flex: 0, twist: 0, lift: 0, pitch: 0, beating: 0, index: -1, phase: 0 };
    this.fan = { fore: 1, hind: 1 };
    /** set by whoever steers: metres off the line, its rate of change, a turn while at rest (rad) */
    this.offset = new THREE.Vector3();
    this.offsetVel = new THREE.Vector3();
    this.yaw = 0;
    this.yawRate = 0;
    /** how upright it holds itself (0 flying level … 1 up against a pane) */
    this.upright = 0;
    this.feet = new Feet();
    // ---- play: set by the world before update() (index.js), read by whoever steers
    /** it is being flown now: a hand is holding, or the journey is carrying it through a landing or a lift-off */
    this.driving = false;
    /** how far its own wandering reaches, against today's (a cue swings it wider for a moment) */
    this.wanderGain = 1;
    /** 0..1: it has stopped answering the hand for a while (down on the pane, at the end of a long wait) */
    this.tired = 0;
    /** downstrokes made under the player's hand, counted (the glass is brushed on every second one) */
    this.strokes = 0;
    this.pl = { ph: 0, env: 0, mix: 0, n: 0, group: 6, gap: 0, count: 0, rest: 9, done: true, climb: 0, eff: 0, flick: 0 };
    this.reduced = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  }

  /**
   * @param frame  the core's frame
   * @param camera the camera this frame is drawn with (already placed)
   * @param lens   is the lens open (is anything out of focus)?
   */
  update(frame, camera, lens) {
    const { progress: p, time: t, dt } = frame;
    this._dt = dt;
    const calm = this.reduced ? 0.3 : 1;
    const air = (this.air = airborne(p));
    const k = (this.perch = perchAt(p));
    pathAt(p, this.base);
    const play = frame.play;
    const on = !!play && play.mode === 'play';
    const wb = on ? this._playBeat(t, dt, play, air) : wingbeat(t, this.beat);
    fanning(t, k * 0.37 + 0.1, this.fan);
    if (k === 1) {
      // on the pane, in the warmth of it, it basks: the wings held wide open and all but flat, breathing; every half
      // minute it draws them half shut for a moment and opens them again
      const dip = Math.pow(0.5 + 0.5 * Math.sin(t * 0.21 + 3.6), 6);
      this.fan.fore = 0.2 + 0.07 * (1 + Math.sin(t * 0.5 + 1.0)) * calm + 0.55 * dip * calm;
      this.fan.hind = this.fan.fore - 0.07;
    }

    // ---- where
    const pos = this.position.copy(this.base);
    wander(t, _a).multiplyScalar(calm * (on ? this.wanderGain : 1));
    pos.addScaledVector(_a, air).addScaledVector(this.offset, air);
    pos.y += wb.lift * air * calm;
    // never through the glass, the floor or the roof, and never into a mullion
    if (air > 0.02) {
      const margin = 0.012 + 0.012 * (1 - this.upright);
      for (let i = 0; i < 6; i++) {
        const h = HULL[i];
        const d = h[3] - (h[0] * pos.x + h[1] * pos.y + h[2] * pos.z);
        const m = (i === 5 ? 0.05 : margin) * air;
        if (d < m) pos.set(pos.x - h[0] * (m - d), pos.y - h[1] * (m - d), pos.z - h[2] * (m - d));
      }
      const fz = pos.z - Math.round(pos.z);
      if (Math.abs(fz) < 0.05 && 1.15 - Math.abs(pos.x) < 0.075) pos.z += (fz < 0 ? -1 : 1) * (0.05 - Math.abs(fz)) * air;
    }

    // …and never out of the picture: whatever the wandering and the visitor's hand add up to, it is held inside the
    // middle of the frame (the camera does not chase it)
    if (air > 0.02) {
      // (eased, not clamped: pushed toward the edge it slows and leans, it does not meet a wall)
      _a.copy(pos).project(camera);
      // (in an upright frame its wings are a large part of the width: the body is kept far enough in for the whole
      // animal, and a finger's width beside it, to be in the picture)
      let wide = 0.72;
      if (camera.aspect < 1) {
        const half = (0.033 * SIZE) / Math.max(camera.position.distanceTo(pos), 0.05) / (Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
        wide = clamp(1 - half - 0.3, 0.12, 0.72);
      }
      // Played, it goes where the hand sends it, as far as its line allows: so the limits also know how large it is
      // in the picture. On a phone it is kept high (under it are the line it has just earned and the thumb that flies
      // it) and clear of the wing in the corner above it; in a wide frame the whole animal stays inside the edges.
      let top = 0.66;
      let softTop = 0.4;
      let bottom = 0.66;
      let softBottom = 0.4;
      if (on) {
        const tall = (0.036 * SIZE) / Math.max(camera.position.distanceTo(pos), 0.05) / Math.tan((camera.fov * Math.PI) / 360);
        if (camera.aspect < 1) {
          top = clamp(0.78 - tall, 0.28, 0.62);
          bottom = 0.34;
        } else {
          top = clamp(0.92 - tall, 0.3, 0.66);
          bottom = clamp(0.56 - 0.5 * tall, 0.25, 0.5);
          wide = Math.min(wide, clamp(0.95 - tall / camera.aspect, 0.3, 0.72));
        }
        softTop = top - 0.12;
        softBottom = bottom - 0.1;
      }
      const nx = ease(_a.x, wide * 0.64, wide);
      const ny = _a.y >= 0 ? ease(_a.y, softTop, top) : ease(_a.y, softBottom, bottom);
      if (nx !== _a.x || ny !== _a.y) {
        _a.x = nx;
        _a.y = ny;
        pos.lerp(_a.unproject(camera), air);
      }
    }

    // ---- which way: along the line of flight, leaning into wherever it is being pushed
    pathAt(p + 0.004, _a).sub(pathAt(p - 0.004, _b));
    _a.y = 0;
    if (_a.lengthSq() > 1e-9) _a.normalize();
    else _a.copy(this.heading);
    wander(t + 0.12, _b).sub(wander(t - 0.12, _c)).multiplyScalar(2.2 * calm);
    _a.add(_b).addScaledVector(this.offsetVel, 1.6);
    _a.y = 0;
    if (_a.lengthSq() < 1e-8) _a.set(0, 0, -1);
    _a.normalize();
    // A butterfly seen from dead astern, or head on, is two lines: its wings are edge-on to the lens whatever they
    // do. So it never flies straight along the line of sight: it is turned up to half a radian off it (a butterfly's
    // heading and its course are seldom the same thing), and carries its body a little more upright.
    _b.copy(pos).sub(camera.position);
    _b.y = 0;
    let astern = 0;
    if (_b.lengthSq() > 1e-8 && air > 0.02) {
      _b.normalize();
      const ang = Math.atan2(_b.z * _a.x - _b.x * _a.z, _b.x * _a.x + _b.z * _a.z); // from the line of sight to the heading
      const near = Math.abs(ang) < Math.PI / 2 ? ang : Math.sign(ang) * (Math.abs(ang) - Math.PI); // …or to its opposite
      // (which side it turns to is kept until it is clearly on the other: it does not dither)
      if (this.side === undefined || dt <= 0 || Math.abs(near) > 0.3) this.side = near < 0 ? -1 : 1;
      astern = Math.cos(near) * Math.cos(near);
      const turn = (this.side * 0.52 * astern - (Math.sign(near) === this.side ? 0 : near) * astern) * air;
      _a.applyAxisAngle(UP, -turn);
    }
    if (dt > 0 && air > 0.02) this.heading.lerp(_a, 1 - Math.exp(-6 * dt)).normalize();
    else this.heading.copy(_a);
    const pitch = 0.42 + wb.pitch * calm + 0.75 * this.upright + 0.2 * astern * air;
    _f.copy(this.heading).multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch));
    _r.crossVectors(this.heading, UP).normalize();
    const roll = (0.1 * Math.sin(t * 1.3 + 0.4) + 0.06 * Math.sin(t * 2.9)) * calm + clamp(this.offsetVel.dot(_r) * 1.2, -0.4, 0.4);
    _u.crossVectors(_r, _f);
    _r.applyAxisAngle(_f, roll);
    _u.applyAxisAngle(_f, roll);
    _q1.setFromRotationMatrix(_m.makeBasis(_r, _f, _u));
    // at rest: its back to the surface's normal, turned by the visitor's hand
    perchBasis(k, this.yaw + 0.04 * Math.sin(t * 0.23 + k) * calm, _r, _f, _u);
    _q0.setFromRotationMatrix(_m.makeBasis(_r, _f, _u));
    const e = air * air * (3 - 2 * air);
    _q.copy(_q0).slerp(_q1, e);
    this.R.set(1, 0, 0).applyQuaternion(_q);
    this.F.set(0, 1, 0).applyQuaternion(_q);
    this.U.set(0, 0, 1).applyQuaternion(_q);
    const gw = this.gw;
    gw.place(pos, this.R, this.F, this.U, SIZE);

    // ---- wings: fanning at rest, beating in the air (forewing leads, hindwing follows)
    const fold = this.reduced ? 0.45 : 1;
    if (on && e < 1) this._playRest(t, p, k, play, fold);
    const fore = this.fan.fore + (wb.fore * fold + GLIDE * (1 - fold) - this.fan.fore) * e;
    const hind = this.fan.hind + (wb.hind * fold + (GLIDE - 0.1) * (1 - fold) - this.fan.hind) * e;
    gw.pose.wings.set(fore, hind, wb.twist * e * fold, wb.flex * e * fold * FLEX);

    // ---- limbs: legs drawn up tight in the air; the abdomen all but in line; antennae ahead in a narrow V; a breath at rest
    gw.pose.limbs.set(smoothstep(0.1, 0.65, air), 0.1 + e * (0.02 - 0.4 * wb.pitch), e * 0.22, (1 - e) * (0.6 + 0.4 * Math.sin(t * 1.9)));
    // an antenna flicks now and then; a foot is lifted and set down again (always when it is being turned)
    const tw = gw.pose.twitch;
    for (let s = 0; s < 2; s++) {
      const n = t / 2.3 + s * 0.41;
      const ph = n - Math.floor(n);
      // (at rest the two are never held alike: seen from the side they are a narrow V, not one line)
      const v = Math.exp(-Math.pow((ph - 0.3) / 0.04, 2)) * (hash1(Math.floor(n) + s * 7) - 0.3) * 0.5 * (1 - e) * calm + 0.03 * Math.sin(t * 1.1 + s * 2) + (s === 0 ? 0.13 : -0.1) * (1 - e);
      if (s === 0) tw.x = v;
      else tw.y = v;
    }
    // feet: planted where they stand. When the body is turned they stay, and step after it one at a time; now and
    // then one is lifted and put down again for no reason at all
    if (e <= 0) {
      const n = Math.floor(t / 1.7);
      if (n !== this._tap && hash1(n * 3.1) < 0.22 * calm) this.feet.tap((n * 3) % 4);
      this._tap = n;
      this.feet.update(gw.pose, gw.group.matrix, dt);
    } else {
      this.feet.reset();
      for (let i = 0; i < 4; i++) gw.pose.feet[i].set(0, 0, 0);
    }

    // ---- what the shadow needs to know
    // its image in the glass: only while it is down on a pane (the first rest is on steel)
    const twin = this.twin;
    // (and not in the last push, where the lens is on the eye and the pane is far out of focus behind it)
    const glassy = k > 0 ? (1 - e) * (1 - smoothstep(0.95, 0.965, p)) : 0;
    twin.group.visible = glassy > 0.01;
    if (twin.group.visible) {
      const n = PERCH[k].n;
      // (the pane is STAND behind the body's middle)
      const d = _a.copy(pos).sub(PERCH[k].pos).dot(n) + STAND;
      _b.copy(pos).addScaledVector(n, -2 * d);
      twin.place(_b, _c.copy(this.R).addScaledVector(n, -2 * this.R.dot(n)), _f.copy(this.F).addScaledVector(n, -2 * this.F.dot(n)), _u.copy(this.U).addScaledVector(n, -2 * this.U.dot(n)), SIZE);
      twin.sort(camera, false);
      // (the new animal is far brighter where light comes through it than the old one was: glass gives back a few per cent)
      this.shared.uBfMirror.value.set(n.x, n.y, n.z, 1.3 * glassy);
    }

    // (the shadow of a wing in motion is drawn swept between where the wing was and where it is, and that costs. On
    // the bar where the visit begins the lens is a hand away and the frame has nothing to spare, so when the wings
    // shiver there under a hold, a few degrees eleven times a second, their shadow is drawn as it stands)
    setShadow(this.shared, gw, 1, on && k === 0 && e <= 0 ? 0 : dt);
    leafBounce(pos, this.shared.uBfBounce.value);

    // (in the last push the wings come to fill the frame, four deep, and the frame has nothing left to pay with: what
    // is behind them is drawn with two taps instead of six, each softer (it is far out of focus by then), and let go
    // of by 0.9865 — past that the wings are themselves going out of focus and the lens blurs them and what is behind
    // them together. Stopping at 0.975, as this did, left the sill behind them sharp inside wings that were still sharp)
    gw.uniforms.uBfPre.value = (1 - 0.66 * smoothstep(0.966, 0.976, p)) * (1 - smoothstep(0.9835, 0.9865, p));
    gw.sort(camera, lens && p < 0.9865);
  }

  /**
   * Play: the wings in the air, under a hand. Held, it beats without the kit's long glides (five to seven beats, a
   * catch of breath, five to seven more) and is carried a little above its line; the frame a press lands the stroke
   * starts again from the top. Let go, it finishes the stroke it is in, holds its wings in a shallow V, sinks a
   * little, and then goes back to the kit's own bursts and glides: a hovering animal is today's animal.
   * Writes this.beat (the same fields as the kit's wingbeat) and returns it.
   */
  _playBeat(t, dt, play, air) {
    const s = this.pl;
    const out = this.beat;
    const idle = wingbeat(t, _idle);
    const drive = this.driving;
    if (dt > 0) {
      if (play.pressed) {
        s.ph = 0;
        s.n = 0;
        s.gap = 0;
        // (and the body answers: a hop upward that the spring it hangs on takes back)
        this.offsetVel.y += 0.25 * air;
      }
      if (drive) {
        s.rest = 0;
        s.done = false;
        s.mix = Math.min(1, s.mix + dt * 12);
        if (s.gap > 0) {
          s.gap -= dt;
          s.env += (0.5 - s.env) * (1 - Math.exp(-30 * dt));
        } else {
          s.env += (1 - s.env) * (1 - Math.exp(-22 * dt));
          const ph0 = s.ph;
          s.ph += dt / BEAT;
          if (ph0 < 0.3 && s.ph >= 0.3) this.strokes++;
          if (s.ph >= 1) {
            s.ph -= 1;
            s.count++;
            if (++s.n >= s.group) {
              s.n = 0;
              s.gap = 0.15;
              s.group = 5 + ((s.count * 7) % 3);
            }
          }
        }
      } else {
        s.rest += dt;
        if (!s.done && s.ph > 0.04) {
          // the stroke it was in is finished, and its upstroke only rises as far as the glide
          s.ph += dt / BEAT;
          s.env = Math.min(s.env, Math.max(0, (1 - s.ph) / 0.45));
          if (s.ph >= 1) s.done = true;
        } else s.done = true;
        if (s.done) {
          s.ph = 0;
          s.env *= Math.exp(-14 * dt);
        }
        if (s.rest > 0.7) s.mix = Math.max(0, s.mix - dt * 2.4);
      }
      // carried up to three centimetres above its line while it is flown; let go, it sinks back
      s.climb += ((drive ? 0.03 : 0.005) - s.climb) * (1 - Math.exp(-(drive ? 1.7 : 2.4) * dt));
    }
    const k = strokeAt(s.ph);
    const env = s.env;
    const m = s.mix;
    const tremble = 0.04 * Math.sin(t * 9.0);
    const x = (FORE_TOP - k.fore) / FORE_SPAN; // 0 at the top of the stroke … 1 at the bottom
    out.fore = idle.fore + (V_FORE + tremble + (k.fore - V_FORE) * env - idle.fore) * m;
    out.hind = idle.hind + (V_HIND + tremble + (k.hind - V_HIND) * env - idle.hind) * m;
    out.flex = idle.flex + (0.06 + (k.flex - 0.06) * env - idle.flex) * m;
    out.twist = idle.twist + (k.twist * env - idle.twist) * m;
    out.pitch = idle.pitch + (k.pitch * env - idle.pitch) * m;
    out.lift = idle.lift * (1 - m) + (0.0045 * (x - 0.5) * env + s.climb) * m;
    const mine = m > 0.5;
    out.beating = mine ? env : idle.beating;
    out.index = mine ? (env > 0.3 && s.gap <= 0 ? 4096 + s.count : -1) : idle.index;
    out.phase = mine ? s.ph : idle.phase;
    return out;
  }

  /**
   * Play: the wings while it is down. On the bar where the visit begins a hold opens them and they shiver (what a
   * butterfly does to warm the muscles it flies with), harder the nearer it is to leaving; untouched for a while, it
   * shivers by itself now and then. On a pane a hold is flight that goes nowhere: it flutters against the glass.
   * Let go and all of it is folded back into the slow fanning within half a second. Rewrites this.fan.
   */
  _playRest(t, p, k, play, fold) {
    const s = this.pl;
    const dt = this._dt;
    const want = this.driving ? 1 - this.tired : 0;
    if (dt > 0) s.eff += (want - s.eff) * (1 - Math.exp(-(want > s.eff ? 10 : 4.5) * dt));
    const fan = this.fan;
    if (k === 0) {
      const near = smoothstep(0, 0.084, p);
      const quick = Math.sin(t * TAU * 11);
      // (nobody has touched it for a while: a shiver of half a second, every four)
      const since = play.restFor - 6;
      const inv = since > 0 ? Math.max(0, Math.sin((Math.PI * (since % 4)) / 0.5)) * ((since % 4) < 0.5 ? 1 : 0) : 0;
      fan.fore += (-0.1 + 0.09 * quick) * inv * fold * (1 - s.eff);
      // (the frame a touch lands it answers with one whole stroke: the wings thrown open and brought back)
      // (a tap lets go in the middle of it: what is left of the stroke is let out, not dropped)
      if (play.held && play.heldFor < 0.3) s.flick = Math.sin((Math.PI * play.heldFor) / 0.3);
      else if (dt > 0) s.flick *= Math.exp(-18 * dt);
      const open = 0.8 - 0.14 * near + (0.07 + 0.1 * near) * quick * fold - 0.4 * s.flick * s.flick * fold;
      fan.fore += (open - fan.fore) * s.eff;
      fan.hind = fan.fore - 0.07 - 0.05 * s.eff * Math.sin(t * TAU * 11 - 0.7) * fold;
    } else {
      // (at the end pane it stops trying before the lens goes in to its eye)
      const a = s.eff * (k === 2 ? 1 - smoothstep(0.925, 0.95, p) : 1);
      const beat = Math.sin(t * TAU * 7.5);
      const flutter = 0.72 + 0.5 * beat * fold;
      fan.fore += (flutter - fan.fore) * a;
      fan.hind += (flutter - 0.1 - 0.06 * Math.sin(t * TAU * 7.5 - 0.6) - fan.hind) * a;
    }
  }
}

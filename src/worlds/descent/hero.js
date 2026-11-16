// The one that is finding its way: where its body is and how it is held, every frame.
//
// Progress says where along its line it is (shots.js). Time gives it life on top of that: the wingbeat, bursts and
// glides, a wandering course, the body nodding against each stroke. None of this ever reaches the camera.
//
// Two things here are the point of the world. Far from the lamp it flies level, banking only into its own turns.
// Near the lamp it does what every flying insect does: it rolls until its back is to the brightest thing there is
// (the dorsal light response). Under an open sky that keeps it level. Beside a lamp it tips it over on its side, and
// the turn that follows never ends. And at the end of the night it turns right over, and hangs under a leaf.

import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { wingbeat, fanning, FLEX } from '../../shared/butterfly/index.js';
import { makeSheenMaterial } from './sheen.js';
import { SIZE, key, K_BEAT, K_WANDER, K_PITCH, K_DORSAL, K_HANG, HANG_DROP } from './shots.js';

const UP = new THREE.Vector3(0, 1, 0);
const GLIDE = 0.6;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();

/** A slow wandering in three axes: metres off the line of flight at time t (for an animal of life size). */
function wander(t, out) {
  return out.set(
    (Math.sin(t * 0.83) + 0.5 * Math.sin(t * 1.97 + 1.3) + 0.22 * Math.sin(t * 4.3 + 0.7)) * 0.04,
    (Math.sin(t * 0.71 + 2.1) + 0.5 * Math.sin(t * 1.63 + 0.4) + 0.2 * Math.sin(t * 5.1)) * 0.02,
    (Math.cos(t * 0.67 + 0.9) + 0.5 * Math.sin(t * 2.23 + 2.0) + 0.22 * Math.sin(t * 3.7 + 1.1)) * 0.04,
  );
}

export class Hero {
  /**
   * @param kit   the butterfly kit
   * @param U     the world's uniform bag
   * @param light the rig (sheen.js: makeNightRig)
   * @param plan  from buildPlan
   */
  constructor(ctx, kit, U, light, plan, { detail = 'high' } = {}) {
    this.U = U;
    this.light = light;
    this.plan = plan;
    this.gw = kit.glasswing({ light, detail, uniforms: { uBfRes: U.uRes } });
    this.scene = new THREE.Scene();
    this.scene.add(this.gw.group);
    // the lamp in its wings (sheen.js): the same four wings again, light only
    const gu = this.gw.uniforms;
    // (the film's flash, the haze in the cells, the ember, the pearl; and the line round the margin, the veins'
    // line, single scales, how much of the night sky is in the film)
    this.sheen = new THREE.Vector4(1.4, 1.0, 1.6, 1.2);
    this.more = new THREE.Vector4(0.8, 1.0, 1.0, 1.0);
    this.sheenGain = { value: 1 };
    const sheenMat = makeSheenMaterial(ctx, U, kit, this.sheen, this.more, this.sheenGain, { uPose: gu.uPose, uShape: gu.uShape, uLook: gu.uLook });
    for (const g of this.gw.geos) {
      const m = new THREE.Mesh(g, sheenMat);
      m.frustumCulled = false;
      m.renderOrder = 40;
      this.gw.group.add(m);
    }
    this.position = new THREE.Vector3();
    this.base = new THREE.Vector3();
    this.heading = new THREE.Vector3(0, 0, 1);
    this.R = new THREE.Vector3(1, 0, 0);
    this.F = new THREE.Vector3(0, 0, 1);
    this.Uv = new THREE.Vector3(0, 1, 0);
    /** how far it is rolled toward the lamp (rad) */
    this.bank = 0;
    this.beat = { fore: 1, hind: 1, flex: 0, twist: 0, lift: 0, pitch: 0, beating: 0, index: -1, phase: 0 };
    this.fan = { fore: 1, hind: 1 };
    this.reduced = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    // how it hangs: head to the left of the last frame, its back to the ground, so that its shut wings are seen side-on
    this.hangF = plan.RIGHT.clone().multiplyScalar(-1).addScaledVector(UP, 0.1).normalize();
    this.hangU = new THREE.Vector3(0, -1, 0).addScaledVector(this.hangF, 0.1).normalize();
    this.hangR = new THREE.Vector3().crossVectors(this.hangF, this.hangU).normalize();
    this.hangU.crossVectors(this.hangR, this.hangF);
  }

  /**
   * @param frame  the core's frame
   * @param camera the camera this frame is drawn with (already placed)
   * @param sky    { lampE: Vector3 (what the lamp gives at 0 m), sun: Vector3 (unit), sunCol: Vector3, skyUp: Color, dawn }
   */
  update(frame, camera, sky) {
    const { progress: p, time: t } = frame;
    const plan = this.plan;
    const calm = this.reduced ? 0.3 : 1;
    const wb = wingbeat(t, this.beat);
    const hang = key(K_HANG, p);
    const fly = 1 - hang;

    // ---- where: on its line, a little off it
    plan.pathAt(p, this.base);
    const pos = this.position.copy(this.base);
    const loose = key(K_WANDER, p) * calm;
    wander(t, _a).multiplyScalar(SIZE * loose);
    pos.add(_a);
    const fold = (this.reduced ? 0.45 : 1) * key(K_BEAT, p);
    pos.y += (wb.lift - 0.008) * SIZE * calm * fold;

    // ---- which way: along its line
    plan.pathAt(Math.min(1, p + 0.0012), _a);
    plan.pathAt(p - 0.0012, _b);
    _c.copy(_a).sub(_b);
    const hl = Math.hypot(_c.x, _c.z);
    if (hl > 1e-4) this.heading.set(_c.x / hl, 0, _c.z / hl);
    const climb = hl > 1e-4 ? Math.atan2(_c.y, hl) : 0;
    // …banking into its turns
    plan.pathAt(Math.min(1, p + 0.004), _a).sub(this.base);
    plan.pathAt(p - 0.004, _b).sub(this.base).multiplyScalar(-1);
    const la = Math.hypot(_a.x, _a.z), lb = Math.hypot(_b.x, _b.z);
    let turn = 0;
    if (la > 1e-4 && lb > 1e-4) turn = (_b.x * _a.z - _b.z * _a.x) / (la * lb) / (0.5 * (la + lb)); // signed curvature, 1/m (+ = to the right)
    const pitch = key(K_PITCH, p) + wb.pitch * calm * fold + clamp(climb * 0.7, -0.3, 0.35);
    _f.copy(this.heading).multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch));
    _r.crossVectors(this.heading, UP).normalize();
    _u.crossVectors(_r, _f);
    const sway = (0.07 * Math.sin(t * 1.3 + 0.4) + 0.04 * Math.sin(t * 2.9)) * calm;
    const roll = clamp(turn * 0.55, -0.55, 0.55) + sway;
    _r.applyAxisAngle(_f, roll);
    _u.applyAxisAngle(_f, roll);
    // ---- the dorsal light response: roll until the back is to the lamp
    const dors = key(K_DORSAL, p);
    this.bank = 0;
    if (dors > 0) {
      _a.copy(plan.LAMP).sub(pos);
      _a.addScaledVector(_f, -_a.dot(_f)).normalize(); // the way to the lamp, square to the body's own axis
      const full = Math.atan2(_a.dot(_r), _a.dot(_u)); // how far it would have to roll to face its back right at it
      this.bank = full * dors;
      _r.applyAxisAngle(_f, this.bank);
      _u.applyAxisAngle(_f, this.bank);
    }
    // ---- and at the end, over onto its back under the leaf
    if (hang > 0) {
      _m.makeBasis(_r, _f, _u);
      _q0.setFromRotationMatrix(_m);
      _m.makeBasis(this.hangR, this.hangF, this.hangU);
      _q1.setFromRotationMatrix(_m);
      _q0.slerp(_q1, hang * hang * (3 - 2 * hang));
      _m.makeRotationFromQuaternion(_q0);
      _m.extractBasis(_r, _f, _u);
    }
    this.R.copy(_r);
    this.F.copy(_f);
    this.Uv.copy(_u);
    const gw = this.gw;
    gw.place(pos, _r, _f, _u, SIZE);

    // ---- wings and limbs
    // (the lens is often behind it, where wings clapped shut over the back are a single line: the top of the stroke
    // is held a little open, a V and never a blade)
    const open = (a) => (a > 0.95 ? 0.95 + (a - 0.95) * 0.42 : a);
    fanning(t, 0.21, this.fan);
    const shutF = 1.5 - (1.47 - this.fan.fore) * 0.16;
    const flyF = open(wb.fore * fold + GLIDE * (1 - fold));
    const flyH = open(wb.hind * fold + (GLIDE - 0.06) * (1 - fold));
    gw.pose.wings.set(flyF * fly + shutF * hang, flyH * fly + (shutF - 0.05) * hang, wb.twist * fold * fly, wb.flex * fold * FLEX * fly);
    gw.pose.shape.set(1, 0.35 * hang, 0, 0);
    // (in flight: legs tight under the thorax, the abdomen all but in line with it, antennae a narrow V straight ahead)
    gw.pose.limbs.set(fly, (0.12 - 0.4 * wb.pitch) * fly + 0.12 * hang, 0.22 * fly + 0.1 * hang, hang * (0.5 + 0.5 * Math.sin(t * 1.7)));
    gw.pose.twitch.set(0.03 * Math.sin(t * 1.1), 0.03 * Math.sin(t * 1.1 + 2), 0, 0);
    // hanging, its legs are let out and drawn in under it; the leaf slopes up toward the lens, so the two feet on
    // that side (its right) reach higher than the two on the other
    const let_ = HANG_DROP - 4;
    for (let i = 0; i < 4; i++) {
      const sx = i % 2 ? -1 : 1;
      gw.pose.feet[i].set(-sx * 3.2 * hang, 0, -(let_ + sx * 2.1) * hang);
    }

    // ---- its light: whatever is brightest where it is
    const L = this.light;
    _a.copy(plan.LAMP).sub(pos);
    const r2 = _a.lengthSq();
    _a.normalize();
    const fall = 1 / (1 + r2 * 0.3);
    const lw = sky.lampE.x * fall;
    const sw = sky.sunCol.x + 1e-4;
    _b.copy(_a).multiplyScalar(lw).addScaledVector(sky.sun, sw).normalize();
    L.sunDir.copy(_b);
    L.sunColor.copy(sky.lampE).multiplyScalar(fall).add(sky.sunCol);
    L.sky.set(sky.skyUp.r * 0.55, sky.skyUp.g * 0.55, sky.skyUp.b * 0.55);
    L.ground.set(sky.skyUp.r * 0.22, sky.skyUp.g * 0.24, sky.skyUp.b * 0.26);
    L.lamp.set(plan.LAMP.x, plan.LAMP.y, plan.LAMP.z, 0.12);
    L.lampColor.copy(sky.lampE);
    // (the flame as the one point of life in its eye, for as long as it is near one)
    L.eye.copy(sky.lampE).multiplyScalar(5.0 * fall);
    // (by day the sky is in everything already: the film's cold sheen and the silver line are the night's)
    // (and handed in, where it is a few pixels of wing against the sky: the silver line round the margin and the
    // sky in the film carry it, as they did in the last frame of the crossing before this)
    const far0 = 1 - clamp((p - 0.02) / 0.07, 0, 1);
    this.more.x = 0.8 + 2.4 * far0;
    this.more.w = 1 - 0.75 * sky.dawn + 2.0 * far0;
    gw.sort(camera, false);
  }
}

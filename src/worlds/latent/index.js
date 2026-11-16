// WORLD 02 — LATENT (Meaning)
//
// Inside the butterfly's mind. World 01 ended pushed into its compound eye; this one opens on what that eye delivers
// — a mosaic of hexagonal facets, each with its own small view of the garden — and then the facets let go, drift
// apart in depth and resolve into points of light. What is left is how the animal holds the garden: not as pictures
// but as about a million points, gathered by what things are for. The butterfly, drawn as a constellation of points
// sampled from the shared kit, flies through it: past a fern, upwind along broken filaments of scent to the flowers
// (which carry marks only it can see), past the eye of a bird, to a flat sheet it cannot pass. One region is unlike
// the rest: cold, blue-white. It grows until it is a moon over water, and world 03 opens on that.
//
//   config.js   where things are kept, the line of flight, what happens when (all by progress)
//   shots.js    the camera: a pure function of progress
//   mosaic.js   the way in: the facets                         hero.js    the butterfly as points, and the other one
//   targets.js  forms / dust / web / scent baked into textures  forms/*.js the things the regions condense into
//   sim.js      GPGPU simulation (spring + curl flow + wake + touch + the hand)        flow.js  tileable curl field
//   lens.js     per-point depth of field                        render.js  the field, the air
//   audio.js    the bed and the shimmer

import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../../core/util.js';
import { NS, ST, STATIONS, PERCH, STAND, MOON_LOCAL, MOON_WORLD, smooth, timeline, layout } from './config.js';
import { makeFlowTexture } from './flow.js';
import { buildForms, buildHome, buildWebGraph, buildAxis } from './targets.js';
import { Sim } from './sim.js';
import { lensUniforms } from './lens.js';
import { PointRenderer } from './render.js';
import { Hero } from './hero.js';
import { Mosaic } from './mosaic.js';
import { placeCamera, key, K_APERTURE, K_EXPOSURE, K_TEMP, K_BLOOM } from './shots.js';
import { createLatentAudio } from './audio.js';

export const meta = {
  duration: 128,
  scroll: 12000,
  hint: 'Pass a hand through the dust',
  captions: [
    { from: 0.105, to: 0.185, text: 'I keep no pictures of the garden. I keep what each thing is for.' },
    { from: 0.3, to: 0.375, text: 'The flower has marks on it that only eyes like mine can see.' },
    { from: 0.685, to: 0.755, text: 'The flat part is the glass. I know it from edge to edge.' },
    { from: 0.835, to: 0.915, text: 'One light in here is cold. I have never been near it.' },
  ],
};

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _a = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m4 = new THREE.Matrix4();
const HAZE_WARM = new THREE.Vector3(0.0062, 0.0066, 0.0036);
const HAZE_COOL = new THREE.Vector3(0.0034, 0.005, 0.0102);
const HAZE_NIGHT = new THREE.Vector3(0.0012, 0.002, 0.0052);

export default class LatentWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.camera = new THREE.PerspectiveCamera(34, ctx.size.aspect, 0.1, 4000);
    this.post = {
      dof: null, // depth of field is done per point, in lens.js
      bloom: { strength: 0.5, radius: 0.84, threshold: 0.7, knee: 0.6 },
      exposure: 1.0,
      contrast: 1.06,
      saturation: 1.04,
      temperature: 0.0,
      lift: [0.0, 0.004, 0.014],
      vignette: 0.42,
      grain: 0.03,
      ca: 0.0016,
    };
    this.tl = timeline(0);
    this.lastP = -99;
    this.ghost = 1;
    this.hand = { x: 0, y: 0, vx: 0, vy: 0, has: false };
    this.eyeYaw = 0;
    this.eyePitch = 0;
  }

  async init() {
    const { ctx } = this;
    const L = (this.L = layout(ctx.quality.level));

    const flow = await makeFlowTexture(ctx, 48, 11);
    await ctx.yield();
    const forms = await buildForms(ctx, L);
    await ctx.yield();
    const graph = buildWebGraph(ctx);
    await ctx.yield();
    const home = await buildHome(ctx, L, graph);
    const axis = buildAxis(ctx);
    await ctx.yield();

    const lens = (this.lens = lensUniforms());
    this.sim = new Sim(ctx, L, { flow, forms, home, axis });
    this.points = new PointRenderer(ctx, L, this.sim, lens);
    await ctx.yield();
    this.hero = new Hero(ctx, lens, ctx.quality.level);
    await this.hero.init();
    this.hero.addTo(this.points);
    this.mosaic = new Mosaic(ctx, lens);
    this.points.over = this.mosaic.mesh;
    this.target = ctx.createTarget({});
    await ctx.yield();

    // textures go to the GPU one at a time, shaders are compiled off the main thread: this all happens while the
    // world before this one is on screen
    for (const t of [flow, forms, home, axis]) {
      ctx.renderer.initTexture(t);
      await ctx.yield();
    }
    placeCamera(this.camera, 0, ctx.size.aspect);
    this.camera.updateMatrixWorld(true);
    await this.sim.pass.compile(ctx.renderer);
    await ctx.yield();
    await this.points.compile(this.camera);
    await ctx.yield();
    await this.mosaic.compile(this.camera);
    await ctx.yield();
  }

  update(frame) {
    const { dt, time, progress: p, pointer } = frame;
    const cam = this.camera;
    const jumped = Math.abs(p - this.lastP) > 0.02;
    const tl = timeline(p, this.tl);
    const su = this.sim.uniforms;
    const pu = this.points.uniforms;
    const lens = this.lens;

    // ---- camera: where progress puts it, and the pointer turning the head a little. Nothing here depends on time.
    const focus = placeCamera(cam, p, frame.size.aspect);
    _e.set(pointer.sy * 0.035 * (1 - tl.fin), -pointer.sx * 0.05 * (1 - tl.fin), 0);
    cam.quaternion.multiply(_q.setFromEuler(_e));
    cam.updateMatrixWorld(true);
    const m = cam.matrixWorld.elements;
    _right.set(m[0], m[1], m[2]);
    _up.set(m[4], m[5], m[6]);
    _fwd.set(-m[8], -m[9], -m[10]);

    // ---- the animal
    const hero = this.hero;
    hero.update(frame, tl);

    // ---- lens: focus rides on the butterfly's place on its line
    lens.uFocus.value = focus;
    lens.uAperture.value = key(K_APERTURE, p) * Math.min(1.25, 10 / focus);

    // ---- the way in
    this.mosaic.update(time, tl.loosen, tl.mosaic, cam.position, hero.base);

    // ---- the hand: the real pointer, when there is one. When nobody is steering, it is the butterfly that stirs things.
    const real = pointer.inside && pointer.idle < 5;
    this.ghost = dt > 0 ? damp(this.ghost, real ? 0 : 1, real ? 5 : 0.8, dt) : real ? 0 : 1;
    const hand = this.hand;
    const hx = pointer.x, hy = pointer.y;
    if (dt > 0 && hand.has) {
      hand.vx = damp(hand.vx, clamp((hx - hand.x) / dt, -4, 4), 10, dt);
      hand.vy = damp(hand.vy, clamp((hy - hand.y) / dt, -4, 4), 10, dt);
    }
    hand.x = hx;
    hand.y = hy;
    hand.has = true;
    const th = Math.tan((cam.fov * Math.PI) / 360);
    const tw = th * cam.aspect;
    su.uRayO.value.copy(cam.position);
    su.uRayD.value.copy(_fwd).addScaledVector(_right, hx * tw).addScaledVector(_up, hy * th).normalize();
    su.uRayV.value.set(0, 0, 0).addScaledVector(_right, hand.vx * tw).addScaledVector(_up, hand.vy * th);
    const speed = Math.min(3, Math.hypot(hand.vx, hand.vy));
    const reach = (1 - this.ghost) * (1 - tl.fin) * tl.field;
    su.uHand.value.set(0.07 + 0.012 * speed, (0.8 + 2.0 * speed) * reach, 6.0 * reach, 0.95 * reach);

    // ---- the butterfly's own wake, and the ring that runs out from where it stands
    su.uWake.value.set(hero.position.x, hero.position.y, hero.position.z, 1.15);
    su.uWakeV.value.set(hero.velocity.x, hero.velocity.y, hero.velocity.z, 14 * hero.stroke);
    for (let k = 0; k < 2; k++) {
      const pc = PERCH[k];
      su.uTouch.value[k].set(pc.pos.x - pc.n.x * STAND, pc.pos.y - pc.n.y * STAND, pc.pos.z - pc.n.z * STAND, k === 0 ? 3.4 : 9);
      const period = k === 0 ? 2.6 : 3.2;
      su.uTouchK.value[k].set((time / period) % 1, tl.touch[k], k === 0 ? 0.11 : 0.3, k === 0 ? 8 : 7);
      // on the flower the ring is one clean line in the petals: it starts clear of the animal's own feet, leaves the
      // stamens and the pollen in the air alone, and moves what it passes very little. On the glass it is as it was.
      su.uTouchN.value[k].set(pc.n.x, pc.n.y, pc.n.z, k === 0 ? 0.42 : 0);
      su.uTouchS.value[k].set(k === 0 ? 0.2 : 0, k === 0 ? 3.5 : 16, 0, 0);
    }
    // …and what it stands on is taken down under it (see render.js: under)
    pu.uShade.value.set(hero.position.x + hero.U.x * 0.22, hero.position.y + hero.U.y * 0.22, hero.position.z + hero.U.z * 0.22, 0.86 * tl.shade);
    pu.uShadeR.value.copy(hero.R).multiplyScalar(1 / 1.0);
    pu.uShadeF.value.copy(hero.F).multiplyScalar(1 / 0.8);

    // ---- the eye turns to follow it (slowly: it is the world that is alive, not the lens)
    {
      const s = STATIONS[ST.EYE];
      _a.copy(hero.position).sub(s.c);
      const x = _a.dot(s.r), y = _a.dot(s.u), z = Math.max(1, _a.dot(s.n));
      const yaw = clamp(Math.atan2(x, z), -0.62, 0.62);
      const pit = clamp(Math.atan2(y, Math.hypot(x, z)), -0.4, 0.4);
      const snap = dt <= 0 || jumped;
      this.eyeYaw = snap ? yaw : damp(this.eyeYaw, yaw, 1.6, dt);
      this.eyePitch = snap ? pit : damp(this.eyePitch, pit, 1.6, dt);
      _e.set(-this.eyePitch, this.eyeYaw, 0);
      su.uEyeRot.value.setFromMatrix4(_m4.makeRotationFromEuler(_e));
    }

    // ---- simulation
    for (let i = 0; i < NS; i++) su.uCond.value[i] = tl.cond[i];
    su.uMoon.value.set(MOON_LOCAL.x, MOON_LOCAL.y, MOON_LOCAL.z, tl.moon);
    su.uPlume.value.w = tl.plume;
    su.uTime.value = time;
    su.uBoxCenter.value.copy(cam.position).addScaledVector(_fwd, su.uBoxSize.value * 0.4);
    this.sim.step(dt, jumped);
    this.lastP = p;

    // ---- light: the field comes up behind the mosaic; at the end everything that is not cold goes dark
    const comp = this.points.comp;
    const day = tl.field * (1 - tl.fin);
    // (the far web is not dimmed here: it goes out region by region in the shader, and so do the four things of the
    // garden, each in its turn, in the order they were visited)
    pu.uLum.value.set(0.5 * comp, 0.3 * comp * tl.field * (1 - 0.6 * tl.fin) * (1 - 0.85 * smoothstep(0.93, 0.99, p)), 0.42 * comp * tl.field * (1 + 1.3 * smooth(0.75, 0.81, p)), 4.0);
    pu.uWink.value.x = tl.wink;
    pu.uColdSize.value.z = smooth(0.76, 0.84, p);
    const sl = pu.uStLum.value;
    sl[ST.FERN] = 3.2 * tl.field * (1 - smooth(0.8, 0.82, p));
    sl[ST.FOOD] = 3.0 * tl.field * (1 - smooth(0.825, 0.845, p));
    sl[ST.EYE] = 7.0 * tl.field * (1 - smooth(0.85, 0.87, p));
    sl[ST.PANE] = 4.5 * tl.field * (1 - smooth(0.88, 0.935, p));
    sl[ST.COLD] = 0.85 * tl.field;
    pu.uPlumeLum.value = 3.0 * comp * day;
    pu.uUV.value.set(tl.uv, 0.02 + 1.2 * smoothstep(0.0, 0.85, tl.uv), 0, 0);
    pu.uNeedle.value = 0.03;
    // (small and far in the last picture: it carries more light there, so it is not lost against the water)
    hero.self.uniforms.uHero.value.y = hero.light * (1 + 0.45 * tl.fin);
    hero.self.uniforms.uHero.value.x = hero.radius * (1 + 0.3 * tl.fin);
    hero.self.uniforms.uCold.value.set(MOON_WORLD.x - hero.position.x, MOON_WORLD.y - hero.position.y, MOON_WORLD.z - hero.position.z, 0).normalize().setW(tl.rim);
    pu.uMoonGain.value = Math.pow(tl.moon, 0.9);
    const cu = this.points.compose.uniforms;
    cu.uGlow.value = day;
    cu.uHaze.value.copy(HAZE_WARM).lerp(HAZE_COOL, smoothstep(0.08, 0.5, p)).lerp(HAZE_NIGHT, tl.fin).multiplyScalar(0.25 + 0.75 * tl.field);

    this.post.exposure = key(K_EXPOSURE, p);
    this.post.temperature = key(K_TEMP, p);
    this.post.bloom.strength = key(K_BLOOM, p);
  }

  render(frame) {
    this.points.render(this.target, this.camera, frame);
    return this.target;
  }

  createAudio(bus) {
    return createLatentAudio(bus, this);
  }

  dispose() {
    this.sim?.dispose();
    this.points?.dispose();
    this.mosaic?.dispose();
  }
}

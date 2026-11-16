// WORLD 04 — DESCENT (Learning)
// A glasswing at night, finding its way the only way it can: by leaning, each wingbeat, toward what is a little
// better — lower, wetter, brighter. It draws a thin line of light where it has been. The line comes down a dark hill
// to a lamp, and there it winds into a spiral that cannot be left, because an insect does not fly at a light: it
// keeps its back to the brightest thing there is, and beside a lamp that is a turn with no end. Then the day comes.
//
//   shots.js    the plan: its line, the lamp, the leaf, the day, the lens — all pure functions of progress
//   land.js     the baked height function (landBake.js: the hills, the bay, the sea) + its CPU mirror
//   terrain.js  the ground, the still water, the field it feels, the sky
//   hero.js     the butterfly (shared kit): its attitude, the roll toward the lamp, the hang under the leaf
//   sheen.js    lamplight in a clear wing; the light rig for the kit
//   trail.js    where it has been        others.js  the ones already circling, and their lines
//   lamp.js     the lantern              plant.js   the leaf, the strand of silk, the dew
//
// Frame: land + water + sky → lantern, shrub, the others, the lines → the butterfly.

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { clamp, smoothstep, damp } from '../../core/util.js';
import { createButterflyKit } from '../../shared/butterfly/index.js';
import { Land } from './land.js';
import { Terrain, SKY_VERT, SKY_FRAG } from './terrain.js';
import { makeDebugTop } from './debug.js';
import { WATER } from './chunks.js';
import { buildPlan, key, DEG, SIZE, SUN_AZ, K_DAWN, K_SUN_EL, K_TRAIL, K_OPEN, K_OTHERS, K_CONTOUR, K_RINGS, K_HANG, K_APERTURE, K_BLUR, K_EXPOSURE, K_BACK, K_BIG } from './shots.js';
import { makeBackdrop } from './backdrop.js';
import { Hero } from './hero.js';
import { makeNightRig } from './sheen.js';
import { Trail } from './trail.js';
import { Others } from './others.js';
import { makeLamp } from './lamp.js';
import { makePlant } from './plant.js';
import { makeGrass } from './grass.js';
import { createDescentAudio } from './sound.js';

export const meta = {
  duration: 96,
  scroll: 8600,
  hint: 'Point at the ground',
  captions: [
    { from: 0.04, to: 0.12, text: 'I do not choose where to go. I feel which side is better and lean that way.' },
    { from: 0.365, to: 0.435, text: 'The brightest thing is up. I keep it on my back. That has always kept me level.' },
    { from: 0.585, to: 0.655, text: 'I am doing everything right.' },
    { from: 0.8, to: 0.87, text: 'It was not the sun.' },
  ],
};

const LAMP_COL = [1.0, 0.5, 0.17];
const NIGHT_UP = [0.2, 0.31, 0.53];
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export default class DescentWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.dof = { focus: 4, aperture: 0, maxBlur: 10 };
    this.post = {
      dof: null,
      bloom: { strength: 0.58, radius: 0.84, threshold: 1.0, knee: 0.8 },
      exposure: 1.1,
      contrast: 1.06,
      saturation: 1.04,
      temperature: -0.05,
      tint: 0.0,
      lift: [0.0, 0.002, 0.006],
      gamma: [1, 1, 1],
      gain: [1, 1, 1],
      vignette: 0.34,
      grain: 0.04,
      ca: 0.001,
    };
    this.camera = new THREE.PerspectiveCamera(26, ctx.size.aspect, 0.08, 2600);
    this.debugTop = 0;
    this.probe = 0;
  }

  async init() {
    const { ctx } = this;
    const lv = ctx.quality.level;
    this.sceneRT = ctx.createTarget({ depth: true });

    this.land = new Land(ctx);
    await this.land.bake();
    await ctx.yield();
    const plan = (this.plan = buildPlan(this.land));

    // uniforms shared by everything that is lit, or seen through the air
    const env = (this.env = {
      uCam: { value: new THREE.Vector3() },
      uFog: { value: new THREE.Vector4(0.02, WATER, 2.0, 0.0009) },
      uLamp: { value: new THREE.Vector4(plan.LAMP.x, plan.LAMP.y, plan.LAMP.z, 1) },
      uLampCol: { value: new THREE.Color(...LAMP_COL) },
      uHalo: { value: 0.0035 },
      uSunDir: { value: new THREE.Vector3(SUN_AZ.x, -0.2, SUN_AZ.y).normalize() },
      uSunCol: { value: new THREE.Color(0, 0, 0) },
      uDawn: { value: 0 },
      uTime: { value: 0 },
    });
    this.terrain = new Terrain(ctx, this.land, env);
    await ctx.yield();
    const tu = this.terrain.uniforms;
    const U = (this.U = {
      land: this.land.uniforms,
      air: env,
      uLamp: env.uLamp,
      uLampCol: env.uLampCol,
      uSunDir: env.uSunDir,
      uSunCol: env.uSunCol,
      uSkyUp: tu.uSkyUp,
      uKeyDir: tu.uKeyDir,
      uKeyCol: tu.uKeyCol,
      uRes: { value: new THREE.Vector2(1920, 1080) },
      uPpm: { value: 1000 },
      uCamR: { value: new THREE.Vector3() },
      uCamU: { value: new THREE.Vector3() },
      uCamB: { value: new THREE.Vector3() },
    });
    this.sky = new FSPass(
      SKY_FRAG,
      { ...this.land.uniforms, ...env, uInvVP: { value: new THREE.Matrix4() }, uPixelAngle: tu.uPixelAngle, uSkyUp: tu.uSkyUp, uSunDisc: { value: 0 } },
      { vertexShader: SKY_VERT, depthTest: true, depthFunc: THREE.LessEqualDepth },
    );

    // ---- the butterfly kit (the hero at full detail, the others small)
    const kit = (this.kit = await createButterflyKit(ctx, { detail: lv > 0 ? ['high', 'low'] : ['mid', 'low'] }));
    await ctx.yield();

    const scene = (this.scene = new THREE.Scene());
    this.lamp = makeLamp(ctx, U, plan);
    scene.add(this.lamp.group);
    await ctx.yield();
    this.plant = makePlant(ctx, U, plan);
    scene.add(this.plant.group);
    await ctx.yield();
    if (lv > 0) {
      this.grass = await makeGrass(ctx, U, tu.tGrain.value, { tufts: [0, 14000, 34000][lv], blades: 3, win: [0, 9, 12][lv] });
      scene.add(this.grass);
      await ctx.yield();
    }
    this.others = new Others(ctx, kit, U, (this.flockLight = makeNightRig()), plan, { count: [14, 24, 36][lv], segs: [36, 48, 60][lv] });
    scene.add(this.others.group);
    await ctx.yield();
    this.trail = new Trail(ctx, plan, U, { samples: [2000, 2800, 3600][lv] });
    await this.trail.build();
    scene.add(this.trail.group);
    await ctx.yield();
    this.hero = new Hero(ctx, kit, U, (this.heroLight = makeNightRig()), plan, { detail: lv > 0 ? 'high' : 'mid' });
    this.sky_ = { lampE: new THREE.Vector3(), sun: env.uSunDir.value, sunCol: new THREE.Vector3(), skyUp: tu.uSkyUp.value, dawn: 0 };
    // what is behind the last picture: drawn with the clear things, and marked as in focus after the butterfly
    this.backdrop = makeBackdrop(ctx, plan);
    scene.add(this.backdrop.mesh);
    this.hero.scene.add(this.backdrop.depthMesh);

    this.dbg = makeDebugTop(this.land);
    {
      const marks = [];
      for (let i = 0; i <= 80; i++) {
        const q = plan.pathAt(-0.1 + (1.1 * i) / 80, new THREE.Vector3());
        marks.push([q.x, q.z, 0.25]);
      }
      marks.push([plan.LAMP.x, plan.LAMP.z, 1.0], [plan.PLANT.x, plan.PLANT.z, 0.9], [plan.C0.x, plan.C0.z, 0.8]);
      this.dbg.setMarks(marks);
    }
    this._m = new THREE.Matrix4();

    // compile everything off the main thread before anyone looks
    const r = ctx.renderer;
    plan.placeCamera(this.camera, 0, ctx.size.aspect);
    this.backdrop.mesh.visible = this.backdrop.depthMesh.visible = true; // (hidden things are not compiled)
    await r.compileAsync(this.terrain.scene, this.camera);
    await ctx.yield();
    await this.sky.compile(r);
    await ctx.yield();
    await r.compileAsync(scene, this.camera);
    await ctx.yield();
    await r.compileAsync(this.hero.scene, this.camera);
    this.backdrop.mesh.visible = this.backdrop.depthMesh.visible = false;
  }

  update(frame) {
    const { progress: p, time: t, dt, size } = frame;
    const { env, plan, camera: cam, U } = this;
    const tu = this.terrain.uniforms;

    // ---- the plan: the lens and the hour. All of it from progress alone.
    plan.placeCamera(cam, p, size.aspect);
    env.uCam.value.copy(cam.position);
    env.uTime.value = t;
    U.uRes.value.set(size.width, size.height);
    U.uPpm.value = size.height / (2 * Math.tan((cam.fov * DEG) / 2));
    const e = cam.matrixWorld.elements;
    U.uCamR.value.set(e[0], e[1], e[2]);
    U.uCamU.value.set(e[4], e[5], e[6]);
    U.uCamB.value.set(e[8], e[9], e[10]);
    tu.uPixelAngle.value = ((cam.fov * DEG) / size.height) * 1.2;

    const dawn = key(K_DAWN, p);
    const el = key(K_SUN_EL, p) * DEG;
    env.uSunDir.value.set(SUN_AZ.x * Math.cos(el), Math.sin(el), SUN_AZ.y * Math.cos(el));
    const up = smoothstep(-0.6 * DEG, 3.0 * DEG, el);
    env.uSunCol.value.setRGB(2.6 * up, 1.2 * up, 0.42 * up * (0.6 + 0.4 * up));
    this.sky.uniforms.uSunDisc.value = 22 * smoothstep(-1.0 * DEG, 0.2 * DEG, el);
    env.uDawn.value = dawn;
    tu.uKeyDir.value.set(SUN_AZ.x * 0.82, 0.5, SUN_AZ.y * 0.82).normalize();
    tu.uKeyCol.value.setRGB(0.22 + 0.25 * dawn, 0.34 + 0.3 * dawn, 0.55 + 0.25 * dawn);
    const d2 = dawn * dawn;
    tu.uSkyUp.value.setRGB(NIGHT_UP[0] + 0.5 * d2, NIGHT_UP[1] + 0.62 * d2, NIGHT_UP[2] + 0.66 * d2);
    // mist comes up off the water toward morning
    env.uFog.value.set(0.008 + 0.014 * dawn, WATER, 1.6 + 0.4 * dawn, 0.0009 + 0.0003 * dawn);
    // the flame, never quite steady
    const flick = 1 + 0.035 * Math.sin(t * 9.1) + 0.025 * Math.sin(t * 23.7 + 1.3) + 0.02 * Math.sin(t * 3.3);
    env.uLamp.value.w = flick;
    this.lamp.flame.value = 1;
    const ld = cam.position.distanceTo(plan.LAMP);
    this.lamp.far.value = 1 - smoothstep(2.0, 7.0, (0.014 * U.uPpm.value) / ld);
    const sky = this.sky_;
    sky.lampE.set(LAMP_COL[0], LAMP_COL[1], LAMP_COL[2]).multiplyScalar(3.0 * flick);
    sky.sunCol.set(env.uSunCol.value.r, env.uSunCol.value.g, env.uSunCol.value.b).addScaledVector(_v.set(0.5, 0.42, 0.4), 0.5 * d2);
    sky.dawn = dawn;

    // ---- the animals
    const hero = this.hero;
    hero.gw.setSize(size.width, size.height);
    hero.update(frame, cam, sky);
    const gain = key(K_TRAIL, p);
    const open = key(K_OPEN, p);
    const ok = key(K_OTHERS, p);
    this.others.update(t, open, gain * 0.7 * ok);
    this.others.sheenGain.value = 0.35 + 0.65 * ok;
    this.others.more.w = 1 - 0.75 * dawn;
    this.others.group.visible = open < 0.995;
    const fl = this.flockLight;
    fl.sunDir.copy(env.uSunDir.value);
    fl.sunColor.copy(sky.sunCol);
    fl.sky.set(tu.uSkyUp.value.r * 0.55, tu.uSkyUp.value.g * 0.55, tu.uSkyUp.value.b * 0.55);
    fl.ground.set(tu.uSkyUp.value.r * 0.22, tu.uSkyUp.value.g * 0.24, tu.uSkyUp.value.b * 0.26);
    fl.lamp.set(plan.LAMP.x, plan.LAMP.y, plan.LAMP.z, 1);
    fl.lampColor.copy(sky.lampE);
    this.trail.update(p, hero.position, hero.base, gain);

    // ---- the field it feels (and the pointer, which shows it anywhere)
    const hang = key(K_HANG, p);
    tu.uHero.value.set(hero.position.x, hero.position.y, hero.position.z, 3.6);
    const beat = hero.beat.beating * (0.5 + 0.5 * Math.cos(hero.beat.phase * 6.2832));
    tu.uField.value.set(key(K_CONTOUR, p), key(K_RINGS, p), key(K_CONTOUR, p), (0.55 + 0.45 * beat) * gain * (1 - hang));
    const ptr = frame.pointer;
    let want = 0;
    if (ptr && ptr.inside && ptr.idle < 6 && p > 0.03 && p < 0.94) {
      _v.set(ptr.x, ptr.y, 0.5).unproject(cam);
      _d.copy(_v).sub(cam.position).normalize();
      const hit = this.land.raycast(cam.position, _d, 60);
      if (hit > 0) {
        tu.uProbe.value.x = cam.position.x + _d.x * hit;
        tu.uProbe.value.y = cam.position.z + _d.z * hit;
        tu.uProbe.value.z = clamp(hit * 0.12, 0.7, 3.0);
        want = 1;
      }
    }
    this.probe = dt > 0 ? damp(this.probe, want, want ? 4 : 1.5, dt) : this.probe;
    tu.uProbe.value.w = this.probe * (1 - dawn);

    // ---- lens: on the butterfly, always
    const dof = this.dof;
    dof.aperture = key(K_APERTURE, p);
    dof.maxBlur = key(K_BLUR, p) * [0.8, 0.9, 1][this.ctx.quality.level];
    dof.focus = cam.position.distanceTo(hero.base);
    this.post.dof = dof.aperture * dof.maxBlur > 0.4 ? dof : null;
    this.post.exposure = key(K_EXPOSURE, p);
    this.post.temperature = -0.05 + 0.07 * dawn;
    if (p > 0.9) this.plant.aim(cam, -0.1, t);
    this.plant.big.value = key(K_BIG, p);
    this.backK = key(K_BACK, p);
    this.backdrop.update(this.backK, cam, size.aspect, dof.focus, t);
    this.plant.group.visible = p > 0.3;

    if (this.grass) {
      // the turf is wherever the lens is looking: a few metres out along its line of sight, on the ground
      cam.getWorldDirection(_d);
      const reach = Math.min(4.5, 0.75 * cam.position.distanceTo(hero.base));
      this.grass.centre.set(cam.position.x + _d.x * reach, 0, cam.position.z + _d.z * reach);
      tu.uGrass.value.set(this.grass.centre.x, this.grass.centre.z, this.grass.reach);
    }
    this.terrain.update(cam);
  }

  render(frame) {
    const r = this.ctx.renderer;
    const cam = this.camera;
    const prevAuto = r.autoClear;
    if (this.debugTop) {
      r.autoClear = true;
      this.dbg.render(r, this.sceneRT, this.debugTop, frame.size.aspect);
      r.autoClear = prevAuto;
      return this.sceneRT;
    }
    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.autoClear = false;
    // (once the last picture's own background is all there, it stands in front of the whole land and the sky)
    if (!(this.backK >= 1)) {
      r.render(this.terrain.scene, cam);
      this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
      this.sky.uniforms.uInvVP.value.copy(this._m);
      this.sky.render(r, this.sceneRT);
      r.setRenderTarget(this.sceneRT);
    }
    r.render(this.scene, cam);
    // the butterfly, over everything, far wings first
    r.render(this.hero.scene, cam);
    r.autoClear = prevAuto;
    return this.sceneRT;
  }

  createAudio(bus) {
    return createDescentAudio(bus, this);
  }

  dispose() {
    this.dbg?.dispose();
    this.sky?.dispose();
    this.scene = null;
    this.hero = null;
    this.others = null;
  }
}

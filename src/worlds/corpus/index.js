// WORLD 03 — CORPUS (Memory)
// The night crossing. A glasswing low over open water, steering by the moon, on a route it has never flown: it was
// handed down. The sea is made of writing — what the ones before left — and it can only be read where the moon lies on it.
//
//   shots.js   the plan: path, moon, sea state and lens, all pure functions of progress
//   hero.js    the butterfly (shared kit), its drops, its shadow and image, the warm words under it
//   river.js   the others making the same crossing        shore.js   the far shore and its one light
//   corpus.js  the lines        atlas.js   glyph SDF atlas       layout.js  typesetting the tile (and the lane)
//   waves.js   the sea state    water.js   surface + far field   glyphs.js  the legible near field
//   spray.js   spindrift        sky.js     moon, cloud, letter-stars        recall.js  the pointer
//
// Frame: sea + letters + sky + land + the others → a soft copy of that (what a wing shows of what is behind it) → the butterfly.

import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../../core/util.js';
import { FSPass } from '../../core/Pass.js';
import { midi } from '../../core/Audio.js';
import { createButterflyKit, shadowUniforms } from '../../shared/butterfly/index.js';
import { LINES, STAR_CHARS } from './corpus.js';
import { buildAtlas } from './atlas.js';
import { layoutTile } from './layout.js';
import { NRIP } from './waves.js';
import { NREC, makeNoiseTexture } from './shared.js';
import { makeChopTexture, makeSeaGeometry, makeSeaMaterial } from './water.js';
import { makeGlyphGeometry, makeGlyphMaterial, makeDeepMaterial, renderTileTexture } from './glyphs.js';
import { makeSpray } from './spray.js';
import { makeSky, makeStars, makeCloudTexture } from './sky.js';
import { Recall } from './recall.js';
import { Hero, makeMoonRig } from './hero.js';
import { River } from './river.js';
import { makeShore } from './shore.js';
import { DEG, SIZE, PATH_LEN, LAMP, key, moonAt, placeCamera, K_STEEP, K_BREAK, K_VEIL, K_LAND, K_OTHERS, K_APERTURE, K_BLUR, K_EXPOSURE, K_NEARFADE, K_YAW, K_SLICK, K_BLOOM } from './shots.js';

export const meta = {
  duration: 92,
  scroll: 8200,
  hint: 'Rest the cursor on the water',
  captions: [
    { from: 0.025, to: 0.105, text: 'I remember this water. I have never been over it.' },
    { from: 0.2, to: 0.268, text: 'The ones who crossed left the way written down.' },
    { from: 0.415, to: 0.49, text: 'None of us who set out will land. It takes more than one life.' },
    { from: 0.905, to: 0.975, text: 'The moon is going down. There is one other light.' },
  ],
};

// where the sea breaks hardest: the stretch of the line the hard middle is flown over (see spray.js)
const SHOAL = { x: 0.8, z: -PATH_LEN * 0.585, rx: 11, rz: 30 };
const MOON_COL = new THREE.Vector3(0.74, 0.84, 1.0);

export default class CorpusWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.dof = { focus: 4, aperture: 0, maxBlur: 10 };
    this.post = {
      dof: null,
      bloom: { strength: 0.62, radius: 0.84, threshold: 1.05, knee: 0.8 },
      exposure: 1.0,
      contrast: 1.06,
      saturation: 1.04,
      temperature: -0.06,
      tint: 0.0,
      lift: [0.0, 0.002, 0.007],
      gamma: [1, 1, 1],
      gain: [1, 1, 1],
      vignette: 0.34,
      grain: 0.04,
      ca: 0.001,
    };
    this.camera = new THREE.PerspectiveCamera(26, ctx.size.aspect, 0.05, 40000);
    this.focus = 4;
    this.lastTime = -1;
    this.coarse = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
  }

  async init() {
    const { ctx } = this;
    const lv = ctx.quality.level;
    const Q = [
      { tile: 28, res: 2048, rings: 300, front: 190, stars: 7000, clusters: 300, members: 40, puffs: 3, risers: 300, river: 90, near: 10 },
      { tile: 34, res: 2048, rings: 380, front: 240, stars: 13000, clusters: 460, members: 54, puffs: 4, risers: 500, river: 140, near: 18 },
      { tile: 40, res: 4096, rings: 460, front: 300, stars: 22000, clusters: 640, members: 72, puffs: 5, risers: 800, river: 200, near: 26 },
    ][lv];

    this.target = ctx.createTarget({ depth: true });
    // a half-resolution copy of the finished sea, with its mip chain: rgb = colour, a = distance from the lens. It is
    // what a wing shows of what is behind it when the lens is open, and what tints its scales.
    this.wingScene = lv > 0;
    this.copy = this.wingScene ? ctx.createTarget({ scale: 0.5, mipmaps: true }) : null;

    // ---- letters
    const atlas = await buildAtlas(ctx, LINES, STAR_CHARS);
    await ctx.yield();
    const layout = await layoutTile(LINES, atlas, Q.tile, ctx.rng(5), { dropSmallest: lv === 0, pause: () => ctx.yield() });
    await ctx.yield();

    // ---- the butterfly kit (the hero at full detail, the others small)
    const noise = makeNoiseTexture(ctx);
    const kit = (this.kit = await createButterflyKit(ctx, { detail: lv > 0 ? ['high', 'low'] : ['low'] }));
    await ctx.yield();

    // ---- uniforms shared by everything
    const v4s = (n) => Array.from({ length: n }, () => new THREE.Vector4(0, 0, 0, 0));
    const U = (this.U = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uSteep: { value: 1 },
      uBreak: { value: 0 },
      uShoal: { value: new THREE.Vector4(SHOAL.x, SHOAL.z, 1 / (SHOAL.rx + 3), 1 / (SHOAL.rz + 3)) },
      uRip: { value: v4s(NRIP) },
      uRecall: { value: v4s(NREC) },
      uMoonDir: { value: moonAt(0, new THREE.Vector3()) },
      uMoonCol: { value: MOON_COL.clone() },
      uMoonSky: { value: MOON_COL.clone() },
      uVeil: { value: 0 },
      uLand: { value: 0 },
      uLamp: { value: new THREE.Vector4(LAMP.x, LAMP.y, LAMP.z, 0) },
      uWake: { value: new THREE.Vector4(0, 0, 0.4, 0) },
      uSlick: { value: new THREE.Vector4(0, 0, 0.6, 0) },
      uCapt: { value: new THREE.Vector4(2, -0.5, -2, 0) },
      uNear: { value: new THREE.Vector2(0, 0.05) },
      uRiver: { value: new THREE.Vector4(0, 0, 0, 0) },
      uPpm: { value: 1000 },
      uLod: { value: new THREE.Vector4(0.1, Q.tile / 2 - 4.5, Q.tile / 2 - 1.5, 0) },
      uDrift: { value: 0 },
      uTile: { value: Q.tile },
      uAtlas: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
      tAtlas: { value: atlas.texture },
      tTile: { value: null },
      tChop: { value: null },
      tNoise: { value: noise },
      tCloud: { value: null },
      uFwd: { value: new THREE.Vector2(0, -1) },
      uR0: { value: 1 },
      uRL: { value: 10 },
      uDeepOn: { value: lv },
      uSprayTile: { value: 52 },
      uRise: { value: 1 },
      uStarZoom: { value: 0.5 },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uRes: { value: new THREE.Vector2(1920, 1080) },
      tScene: { value: this.copy ? this.copy.texture : null },
      uLens: { value: new THREE.Vector4(1, 0, 0, 0.075 * SIZE) },
      ...shadowUniforms(),
    });
    U.tShade.value = kit.atlas.shade;

    U.tChop.value = makeChopTexture(ctx);
    U.tCloud.value = makeCloudTexture(ctx);
    await ctx.yield();

    const scene = (this.scene = new THREE.Scene());
    scene.matrixAutoUpdate = false;

    // ---- the near field of letters, and the flat render of the same tile that the far field samples
    const glyphGeo = makeGlyphGeometry(ctx, layout);
    await ctx.yield();
    U.tTile.value = renderTileTexture(ctx, glyphGeo, U, Q.res).texture;
    await ctx.yield();
    const glyphs = (this.glyphs = new THREE.Mesh(glyphGeo, makeGlyphMaterial(ctx, U)));
    glyphs.frustumCulled = false;
    glyphs.renderOrder = 2;
    scene.add(glyphs);
    // drowned copies of the same tile, close to the lens (further out the water shader takes over)
    const sunk = [[0.34, 9.5, 13.7, 0.035], [0.95, 7.0, 27.1, 0.085]].slice(0, lv);
    this.sunk = [];
    for (const d of sunk) {
      const m = new THREE.Mesh(glyphGeo, makeDeepMaterial(ctx, U, d));
      this.sunk.push(m);
      m.frustumCulled = false;
      m.renderOrder = 1.8;
      scene.add(m);
    }

    // ---- water
    const sea = makeSeaGeometry(ctx, Q.rings, Q.front, 40, 66 * DEG);
    this.seaStep = sea.step;
    const water = (this.water = new THREE.Mesh(sea.geo, makeSeaMaterial(ctx, U)));
    water.frustumCulled = false;
    water.renderOrder = 1;
    scene.add(water);
    await ctx.yield();

    // ---- sky, shore
    scene.add(makeSky(ctx, U));
    scene.add(makeStars(ctx, U, atlas, STAR_CHARS, Q.stars));
    this.shore = makeShore(ctx, U);
    scene.add(this.shore.group);
    await ctx.yield();

    // ---- spray
    scene.add(makeSpray(ctx, U, atlas, STAR_CHARS, { clusters: Q.clusters, members: Q.members, puffs: Q.puffs, risers: Q.risers, tile: 52, shoal: SHOAL }));
    await ctx.yield();

    // ---- the animals
    const light = (this.light = makeMoonRig());
    this.river = new River(ctx, kit, U, light, { count: Q.river, near: Q.near });
    scene.add(this.river.group);
    await ctx.yield();
    this.hero = new Hero(ctx, kit, U, light, { detail: lv > 0 ? 'high' : 'mid', scene: this.wingScene });
    this.recall = new Recall(U);
    this.hero.onTouch = (x, z, strength) => this.recall.ring(x, z, 0.004 + 0.006 * strength, this.lastTime);

    if (this.copy) {
      this.downPass = new FSPass(
        /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tSrc, tDepth;
        uniform vec2 uTexel, uNearFar;
        void main(){
          vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
                 + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
          float ndc = texture2D(tDepth, vUv).x * 2.0 - 1.0;
          float d = 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - ndc * (uNearFar.y - uNearFar.x));
          gl_FragColor = vec4(min(c * 0.25, vec3(30.0)), d);
        }`,
        { tSrc: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNearFar: { value: new THREE.Vector2(0.05, 40000) } },
      );
    }

    // compile everything off the main thread before anyone looks
    const r = ctx.renderer;
    placeCamera(this.camera, 0, ctx.size.aspect);
    await r.compileAsync(scene, this.camera);
    await ctx.yield();
    await r.compileAsync(this.hero.scene, this.camera);
    if (this.downPass) await this.downPass.compile(r);
  }

  /** World ray through an NDC point. Returns direction in `out`. */
  _ray(nx, ny, out) {
    const cam = this.camera;
    out.set(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
    return out;
  }

  update(frame) {
    const { progress: p, time: t, dt, size } = frame;
    const U = this.U;
    const cam = this.camera;

    // ---- the plan: sea, sky, lens. All of it from progress alone.
    const steep = key(K_STEEP, p);
    const veil = key(K_VEIL, p);
    U.uSteep.value = steep;
    U.uBreak.value = key(K_BREAK, p);
    U.uTime.value = t;
    U.uDrift.value = t * 0.012;
    moonAt(p, U.uMoonDir.value);
    U.uVeil.value = veil;
    U.uMoonCol.value.copy(MOON_COL).multiplyScalar(1 - 0.86 * veil);
    const land = key(K_LAND, p);
    const nf = key(K_NEARFADE, p);
    U.uNear.value.set(nf, nf * 1.9 + 0.05);
    U.uLand.value = land;
    this.shore.group.visible = land > 0.001;
    U.uLamp.value.w = smoothstep(0.1, 0.75, land);

    placeCamera(cam, p, size.aspect);
    U.uCam.value.copy(cam.position);
    U.uPpm.value = size.height / (2 * Math.tan((cam.fov * DEG) / 2));
    U.uInvProj.value.copy(cam.projectionMatrixInverse);
    U.uCamWorld.value.copy(cam.matrixWorld);
    U.uRes.value.set(size.width, size.height);

    // water mesh: heading snapped to the angular grid, radius scaled with altitude
    const v = (this._v ||= new THREE.Vector3());
    cam.getWorldDirection(v);
    const yaw = Math.atan2(v.x, -v.z);
    const pitch = Math.asin(clamp(v.y, -1, 1));
    // (the drowned copies of the text are only ever seen looking down into the water)
    for (const m of this.sunk) m.visible = pitch < -0.16;
    const ys = Math.round(yaw / this.seaStep) * this.seaStep;
    U.uFwd.value.set(Math.sin(ys), -Math.cos(ys));
    const r0 = clamp(cam.position.y * 0.2, 0.05, 6);
    U.uR0.value = r0;
    U.uRL.value = Math.log(30000 / r0 + 1);

    // ---- lens: on the butterfly, always
    const dof = this.dof;
    dof.aperture = key(K_APERTURE, p);
    dof.maxBlur = key(K_BLUR, p) * [0.8, 0.9, 1][this.ctx.quality.level];
    this.post.dof = dof.aperture * dof.maxBlur > 0.4 ? dof : null;

    // ---- the animals
    const hero = this.hero;
    this.lastTime = t;
    hero.gw.setSize(size.width, size.height);
    hero.update(frame, cam, !!this.post.dof, { moon: U.uMoonDir.value, moonCol: U.uMoonCol.value, veil, lamp: U.uLamp.value });
    this.river.update(t, hero.base, steep, key(K_OTHERS, p), key(K_YAW, p));
    U.uSlick.value.set(hero.position.x, hero.position.z, 0.55, key(K_SLICK, p));

    const want = cam.position.distanceTo(hero.position);
    this.focus = dt > 0 ? damp(this.focus, want, 6, dt) : want;
    dof.focus = this.focus;
    U.uLens.value.set(dof.focus, this.post.dof ? dof.aperture : 0, dof.maxBlur * (size.height / 1080), 0.075 * SIZE);
    this.post.exposure = key(K_EXPOSURE, p);
    this.post.bloom.strength = key(K_BLOOM, p);

    // ---- where the caption stands, the sea does not write (shared.js: captZone). The HUD's own rule for the line
    // (src/ui/hud.css: .hl-caption), worked out again here in NDC: on a phone it is as wide as the screen, and nothing
    // is written below it either; on a wide screen it is a block in the lower middle and the sea writes round it.
    {
      let on = 0;
      for (const c of meta.captions) on = Math.max(on, smoothstep(c.from - 0.022, c.from - 0.002, p) * (1 - smoothstep(c.to + 0.002, c.to + 0.022, p)));
      const cw = size.cssWidth || size.width, ch = size.cssHeight || size.height;
      const font = clamp(12.8 + 0.0075 * cw, 17, 23);
      const narrow = cw <= 720 || this.coarse;
      const bottom = narrow ? 150 : Math.max(0.135 * ch, 128);
      const top = bottom + 2.72 * font;
      if (narrow) U.uCapt.value.set(2, 1 - 2 * (1 - top / ch) + 0.1, -2, on);
      else U.uCapt.value.set(Math.min(1, (15 * font) / cw), 1 - 2 * (1 - top / ch) + 0.03, 1 - 2 * (1 - bottom / ch) - 0.03, on);
    }

    // ---- recall: the pointer (the butterfly's own wake of warm words is hero.js's)
    const horizonNdc = Math.tan(-pitch) / Math.tan((cam.fov * DEG) / 2);
    this.recall.update(frame, this, horizonNdc);

    U.uStarZoom.value = 0.5;
    U.uRise.value = 0.5;
  }

  render() {
    const r = this.ctx.renderer;
    const cam = this.camera;
    const prevAuto = r.autoClear;
    r.setRenderTarget(this.target);
    r.clear(true, true, false);
    r.autoClear = false;
    r.render(this.scene, cam);
    if (this.copy) {
      const dp = this.downPass.uniforms;
      dp.tSrc.value = this.target.texture;
      dp.tDepth.value = this.target.depthTexture;
      dp.uTexel.value.set(0.5 / this.target.width, 0.5 / this.target.height);
      dp.uNearFar.value.set(cam.near, cam.far);
      this.downPass.render(r, this.copy, true);
      r.autoClear = false;
      r.setRenderTarget(this.target);
    }
    // the butterfly, over everything, far wings first
    r.render(this.hero.scene, cam);
    r.autoClear = prevAuto;
    return this.target;
  }

  createAudio(bus) {
    // slow surf: two beds of filtered noise breathing at swell period, a low drone, and a rare bell
    const surfA = bus.noise({ color: 'brown', gain: 0.03, type: 'lowpass', freq: 420, q: 0.3, lfoRate: 0.075, lfoDepth: 0.75, pan: -0.35 });
    const surfB = bus.noise({ color: 'pink', gain: 0.012, type: 'bandpass', freq: 900, q: 0.5, lfoRate: 0.11, lfoDepth: 0.8, pan: 0.4 });
    const hiss = bus.noise({ color: 'white', gain: 0.0, type: 'highpass', freq: 3200, q: 0.4, lfoRate: 0.19, lfoDepth: 0.0 });
    const drone = bus.drone({ freqs: [midi(33), midi(40), midi(45)], gain: 0.04, detune: 5, attack: 8, filter: 380, lfoRate: 0.045, lfoDepth: 0.3 });
    const scale = [69, 72, 76, 79, 81, 84];
    bus.every(9, 22, () => {
      const n = scale[Math.floor(Math.random() * scale.length)];
      bus.bell({ freq: midi(n), gain: 0.022, decay: 7, pan: Math.random() * 1.4 - 0.7, partials: [1, 2.01, 3.02] });
    });
    const at = (param, v) => param.setTargetAtTime(v, bus.ctx.currentTime, 0.4);
    return {
      update: (frame) => {
        const p = frame.progress;
        // the sea is small at both ends and big in the middle; the wind hisses while it breaks; the drone opens as the shore comes
        const sea = smoothstep(0.08, 1.1, key(K_STEEP, p));
        const brk = key(K_BREAK, p);
        const shore = key(K_LAND, p);
        at(surfA.filter.frequency, 280 + 300 * sea);
        at(surfA.gain.gain, 0.016 + 0.02 * sea);
        at(surfB.filter.frequency, 650 + 700 * sea + 500 * brk);
        at(surfB.gain.gain, 0.006 + 0.01 * sea);
        at(hiss.gain.gain, 0.006 * brk);
        at(drone.filter.frequency, 300 + 260 * shore);
      },
    };
  }

  dispose() {
    // everything GPU-side is registered with ctx.track / ctx.createTarget
    this.downPass?.dispose();
    this.scene = null;
    this.recall = null;
    this.hero = null;
    this.river = null;
  }
}

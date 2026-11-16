// WORLD 06 — MIRROR (Self)
//
// The chrysalis. A glasswing's chrysalis really is mirror-silver, and it hung inside the glasshouse of world 01 all
// along: the room is in its surface. Inside it the body is liquid and tries shapes round a few points that never
// dissolved; it goes clear, splits, and the animal hangs from the empty shell while its wings are pumped flat and dry.
// Then it lets go and flies, for the first time, a hand's width down to the steel; the last frame is the first frame of world 01.
//
//   story.js       where everything is, the dials, the lens: pure functions of progress
//   house.glsl.js  world 01's glasshouse as one function of a ray (what is behind, and what the chrome shows)
//   set.js         the steel, the silk, the room;  chrysalis.js  the shell;  hero.js  the animal (the shared kit)
//   form.js        what the liquid tries;  sdf.glsl.js  its distance field;  march.js  where it is, found small
//   plate.glsl.js  its wings;  shell.glsl.js  the room inside the shell;  inside.js  the lens in there, and the picture
//
// The lens is a function of progress and nothing else, outside and in (story.js: placeCamera, inside.js: placeInside).

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { clamp, lerp, smoothstep, damp } from '../../core/util.js';
import { createButterflyKit } from '../../shared/butterfly/index.js';
import { houseUniforms, setDaylight } from './house.glsl.js';
import { buildSet } from './set.js';
import { Hero } from './hero.js';
import { createNoiseTexture } from './noiseTex.js';
import { createMarchPass, createSharedUniforms } from './march.js';
import { Form } from './form.js';
import { placeInside, createWallPass, createLiquidPasses } from './inside.js';
import { bakeWingField } from './plate.glsl.js';
import { createMirrorAudio } from './audio.js';
import { key, placeCamera, focusAt, K_DAY, K_FOG, K_IN, K_CLEAR, K_SPLIT, K_HUSK, CH_C } from './story.js';

export const meta = {
  duration: 100,
  scroll: 9000,
  hint: 'Touch it. Inside, press to scatter it',
  captions: [
    { from: 0.125, to: 0.24, text: 'The room was on my skin before I had eyes for it.' },
    { from: 0.335, to: 0.44, text: 'Inside I was liquid. I tried shapes I had no use for.' },
    { from: 0.5, to: 0.585, text: 'A few parts never dissolved. The wings grew out of those.' },
    { from: 0.955, to: 0.995, text: 'When I could see, what I saw was glass.' },
  ],
};

// the lens settings world 05 hands over with, and the ones world 01 begins with
const POST0 = { thr: 0.9, knee: 0.6, contrast: 1.05, saturation: 1.04, temperature: 0, vignette: 0.36, grain: 0.032, ca: 0.0009, lift: [0, 0, 0], gain: [1, 1, 1] };
const POST1 = { thr: 1.1, knee: 0.8, contrast: 1.12, saturation: 1.06, temperature: 0.05, vignette: 0.4, grain: 0.04, ca: 0.001, lift: [0, 0.004, 0.009], gain: [1.02, 1, 0.955] };
const K_EXPOSURE = [[0, 1.0], [0.08, 1.0], [0.2, 0.9], [0.3, 0.86], [0.62, 0.86], [0.7, 0.84], [0.9, 0.82], [0.985, 0.86], [1, 0.86]];
const K_APERTURE = [[0, 1.0], [0.2, 1.3], [0.3, 1.6], [0.62, 1.6], [0.7, 1.4], [0.9, 1.5], [0.985, 1.7], [1, 1.7]];
const K_MAXBLUR = [[0, 12], [0.9, 12], [0.985, 14], [1, 14]];
/** how soft the room behind is drawn, before the lens's own blur (radians) */
const _v = new THREE.Vector3();
/** what the liquid costs at the size of a 1920x1080 picture, milliseconds (measured: tools/shot.mjs --perf-p) */
const K_LIQ = [[0.3, 4.2], [0.33, 4.2], [0.36, 6], [0.39, 9], [0.42, 6.8], [0.45, 7.3], [0.48, 6.6], [0.5, 5.6], [0.53, 4.8], [0.55, 5.3], [0.57, 8.4], [0.585, 8.4], [0.6, 7], [0.64, 7]];
const K_BGBLUR = [[0, 0.05], [0.07, 0.04], [0.13, 0.008], [0.235, 0.008], [0.27, 0.06], [0.64, 0.06], [0.7, 0.02], [0.9, 0.012], [0.975, 0.0025], [1, 0.0025]];

export default class MirrorWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.dof = { focus: 0.27, aperture: 1, maxBlur: 12 };
    this.post = {
      dof: null,
      bloom: { strength: 0.5, radius: 0.84, threshold: 0.9, knee: 0.6 },
      exposure: 1.0,
      contrast: 1.05,
      saturation: 1.04,
      temperature: 0,
      lift: [0, 0, 0],
      gain: [1, 1, 1],
      vignette: 0.36,
      grain: 0.032,
      ca: 0.0009,
    };
    this.camera = new THREE.PerspectiveCamera(20, ctx.size.aspect, 0.004, 60);
  }

  async init() {
    const { ctx } = this;
    const level = ctx.quality.level;
    const kit = (this.kit = await createButterflyKit(ctx, { detail: ['high'] }));
    await ctx.yield();

    this.house = houseUniforms();
    this.house.tHN.value = ctx.track(createNoiseTexture(ctx.rng(5)));
    await ctx.yield();
    this.set = buildSet(ctx, this.house, kit);
    await ctx.yield();

    // ---- targets: the picture; a half-size copy of it without the animal, down its mip chain (what a wing shows of
    //      the room behind it, out of focus)
    this.mainRT = ctx.createTarget({ depth: true });
    this.fineRT = ctx.createTarget({ depth: true, samples: 4 }); // …and while there is no animal: every edge of the chrome and the steel drawn four times over
    this.halfRT = ctx.createTarget({ scale: 0.7, depth: true }); // the outside while the lens goes through the surface
    this.copyRT = ctx.createTarget({ scale: 0.5, mipmaps: true });
    this.nearFar = new THREE.Vector2(this.camera.near, this.camera.far);
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
      { tSrc: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNearFar: { value: this.nearFar } },
    );

    // ---- the animal
    this.heroU = {
      ...this.house,
      uBfKeyL: { value: new THREE.Vector4(0, 0, 0, 0.3) },
      uBfRes: { value: new THREE.Vector2(1, 1) },
      tBfScene: { value: this.copyRT.texture },
      uBfLens: { value: new THREE.Vector4(1, 0, 0, 0.075) },
    };
    this.hero = new Hero(ctx, kit, this.heroU);
    await ctx.yield();

    // ---- inside: the liquid, traced small (march.js) and laid over the wall of the shell at full size (inside.js)
    const shared = (this.shared = createSharedUniforms());
    shared.tShN.value = this.house.tHN.value;
    shared.tWF.value = await bakeWingField(ctx);
    this.set.chrys.uniforms.tWF.value = shared.tWF.value;
    this.march = createMarchPass(level, shared);
    this.wall = createWallPass(shared);
    const lp = createLiquidPasses(level, shared);
    this.liquid = lp.liquid;
    this.compose = lp.compose;
    this.liqRT = ctx.createTarget();
    this.form = new Form(ctx.rng(11), shared);
    this.coneRT = ctx.createTarget({ scale: 0.25, type: THREE.FloatType, filter: THREE.NearestFilter });
    this.wallRT = ctx.createTarget({ scale: 0.5 });
    this.outRT = ctx.createTarget();
    this.camIn = new THREE.PerspectiveCamera(32, ctx.size.aspect, 0.05, 60);
    this.camRef = new THREE.PerspectiveCamera(32, 16 / 9, 0.05, 60);
    this.camRot = new THREE.Matrix3();
    await ctx.yield();

    this.focus = 0.27;
    this.wrig = 0;
    this.wrigT = 0;
    this.wrigWait = 3;
    this.touches = 0; // (for the sound)
    this.rnd = ctx.rng(29);
    this.dropT = 0;
    this.level = level;
    this.liqBudget = [3.4, 4.2, 5.2][level]; // milliseconds the liquid may take
    this.liqScale = 1;

    const r = ctx.renderer;
    await r.compileAsync(this.set.scene, this.camera);
    await r.compileAsync(this.set.room, this.camera);
    await ctx.yield();
    await kit.compile(this.hero.scene, this.camera);
    await this.downPass.compile(r);
    await ctx.yield();
    await this.march.compile(r);
    await ctx.yield();
    await this.compose.compile(r);
    await this.liquid.compile(r);
    await this.wall.compile(r);
    await ctx.yield();
    // A program that has compiled still makes its pipeline the first time it draws into a target of a given kind, and
    // that takes a frame: where the lens first goes inside, where the animal first shows. So everything that is not
    // in the first frame draws one pixel here, one thing at a time, while the world before this one is still on.
    const warm = async (rt, draw) => {
      const prev = r.getRenderTarget();
      const auto = r.autoClear;
      rt.scissorTest = true;
      rt.scissor.set(0, 0, 1, 1);
      r.autoClear = false;
      r.setRenderTarget(rt);
      draw();
      rt.scissorTest = false;
      rt.scissor.set(0, 0, rt.width, rt.height);
      r.autoClear = auto;
      r.setRenderTarget(prev);
      await ctx.yield();
    };
    const fs = (pass) => () => r.render(pass.mesh, this.camIn);
    await warm(this.coneRT, fs(this.march));
    await warm(this.wallRT, fs(this.wall));
    await warm(this.liqRT, fs(this.liquid));
    await warm(this.outRT, fs(this.compose));
    await warm(this.copyRT, fs(this.downPass));
    for (const rt of [this.halfRT, this.mainRT]) await warm(rt, () => r.render(this.set.scene, this.camera));
    // (the animal is a dozen programs: its body, its wings and the wet on them each in a breath of their own)
    for (const part of ['body', 'wings', 'wet']) {
      this.hero.show(true, part);
      await warm(this.mainRT, () => r.render(this.hero.scene, this.camera));
    }
    this.hero.show(false);
  }

  update(frame) {
    const { time, progress: p, dt, size } = frame;
    const cam = this.camera;
    placeCamera(cam, p, size.aspect);

    // ---- the light of the day
    const day = key(K_DAY, p);
    setDaylight(this.house, day);
    this.house.uHTime.value = time;
    const sun = Math.pow(Math.max(0, (day - 0.12) / 0.88), 1.5);
    this.heroU.uBfKeyL.value.set(16 * sun, 10.56 * sun, 5.76 * sun, 0.3);

    // ---- the shell
    const ch = this.set.chrys.uniforms;
    const inside = key(K_IN, p);
    // the drop: it gathers, runs, stops, runs — and starts again
    if (dt > 0) this.dropT += dt;
    const cyc = (this.dropT * 0.055 + 0.18) % 1;
    const run = smoothstep(0.08, 0.3, cyc) * 0.45 + smoothstep(0.42, 0.58, cyc) * 0.3 + smoothstep(0.7, 0.86, cyc) * 0.25;
    const dropOn = smoothstep(0.1, 0.16, p) * (1 - smoothstep(0.6, 0.66, p));
    ch.uCh.value.set(key(K_FOG, p), key(K_CLEAR, p), key(K_SPLIT, p), key(K_HUSK, p));
    ch.uCh2.value.set(time, smoothstep(0.262, 0.3, p) * (1 - smoothstep(0.61, 0.64, p)), smoothstep(0.2, 0.29, p) * (1 - smoothstep(0.62, 0.68, p)), dropOn > 0 ? Math.max(0.002, run * (1 - smoothstep(0.93, 1, cyc))) * dropOn : 0);
    this.set.steelU.uPadGlow.value = 0.5 * (1 - smoothstep(0.03, 0.2, day));
    // (the sweat on the steel and the patches in the fog are this world's own morning; by the time the animal walks
    //  to the mullion they are gone, and the last frame is the room exactly as world 01 opens on it)
    const own = 1 - smoothstep(0.86, 0.935, p);
    this.set.steelU.uSweat.value = own;
    this.set.steelU.uDull.value = smoothstep(0.945, 0.985, p);
    this.house.uDawn.value.w = own;
    // (…and the air has cleared: world 01's corridor holds its haze in its shafts of sun, not between the lens and a bar a metre off)
    this.house.uHaze.value.w *= 1 - 0.8 * smoothstep(0.9, 0.985, p);
    // touched, it wriggles (a pupa does); left alone, it does so now and then anyway
    this._wriggle(frame, cam, inside < 0.02 && p < 0.685);
    const wr = this.wrig * this.wrig * Math.sin(this.wrigT * 17);
    ch.uCh3.value.set(0.13 * wr, 0.05 * wr * Math.cos(this.wrigT * 5), 0, 0);
    this.set.bgU.uBgBlur.value = key(K_BGBLUR, p);

    // ---- the animal
    const dof = this.dof;
    dof.aperture = key(K_APERTURE, p);
    dof.maxBlur = key(K_MAXBLUR, p) * [0.8, 0.9, 1][this.level];
    this.hero.update(frame, cam, true);
    const want = focusAt(cam, p, this.hero.position);
    this.focus = dt > 0 ? damp(this.focus, want, 6, dt) : want;
    dof.focus = this.focus;
    this.post.dof = inside > 0.02 ? null : dof;
    this.heroU.uBfRes.value.set(size.width, size.height);
    this.heroU.uBfLens.value.set(dof.focus, dof.aperture, dof.maxBlur * (size.height / 1080), 0.075);

    // ---- the lens: from what world 05 hands over to what world 01 begins with
    const e = smoothstep(0.9, 0.985, p);
    const post = this.post;
    post.exposure = key(K_EXPOSURE, p);
    post.bloom.threshold = lerp(POST0.thr, POST1.thr, e);
    post.bloom.knee = lerp(POST0.knee, POST1.knee, e);
    post.bloom.radius = lerp(0.84, 0.85, e);
    for (const k of ['contrast', 'saturation', 'temperature', 'vignette', 'grain', 'ca']) post[k] = lerp(POST0[k], POST1[k], e);
    // (the reveal of the room in the chrome is graded a little harder, and a little warmer)
    const reveal = smoothstep(0.08, 0.17, p) * (1 - smoothstep(0.27, 0.31, p));
    post.contrast += 0.07 * reveal;
    post.saturation += 0.06 * reveal;
    post.temperature += 0.035 * reveal;
    // (in an upright frame the lens comes round behind the hanging animal and looks toward the sun: stop down for it)
    const glare = clamp((1.25 - size.aspect) / 0.7, 0, 1) * smoothstep(0.75, 0.84, p) * (1 - smoothstep(0.9, 0.945, p));
    post.exposure *= 1 - 0.3 * glare;
    post.contrast += 0.1 * glare;
    for (let i = 0; i < 3; i++) {
      post.lift[i] = lerp(POST0.lift[i], POST1.lift[i], e);
      post.gain[i] = lerp(POST0.gain[i], POST1.gain[i], e);
    }
    this.inside = inside;

    // ---- inside
    if (inside > 0) {
      const ci = this.camIn;
      placeInside(ci, p, size.aspect);
      this.form.update(frame, ci);
      const tanH = Math.tan(THREE.MathUtils.degToRad(ci.fov) / 2);
      this.camRot.setFromMatrix4(ci.matrixWorld);
      const lu = this.liquid.uniforms;
      const cu = this.compose.uniforms;
      for (const u of [this.march.uniforms, this.wall.uniforms, lu, cu]) {
        u.uCamPos.value.copy(ci.position);
        u.uCamRot.value.copy(this.camRot);
        u.uTan.value.set(tanH * ci.aspect, tanH);
      }
      // the small pass walks a cone down each of its pixels, wide enough to hold every ray of the picture near it
      const cone = this.coneRT;
      this.march.uniforms.uCone.value = (0.8 * 2 * tanH) / cone.height;
      lu.uConeRes.value.set(cone.width, cone.height);
      // How large the liquid is drawn: at the size of the picture when that fits the budget, down to three fifths of
      // it when it does not. K_LIQ is what it was measured to cost at full size in a 16:9 frame; a frame of another
      // shape holds more or less of it.
      const f = this.form;
      const coverOf = (cam) => {
        const rr = (f.reach + 0.05) / Math.max(0.3, cam.position.distanceTo(f.center) * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
        return Math.min(1, (Math.PI * rr * rr) / (4 * cam.aspect));
      };
      placeInside(this.camRef, p, 16 / 9);
      const ms = key(K_LIQ, p) * clamp(coverOf(ci) / Math.max(coverOf(this.camRef), 1e-3), 0.25, 1.6) * (f.scattered ? 1.3 : 1);
      const sc = (this.liqScale = clamp(Math.sqrt((this.liqBudget - (inside < 1 ? 2.4 : 0)) / ms), 0.58, 1));
      const liq = this.liqRT;
      this.liqW = Math.max(2, Math.min(liq.width, Math.round(liq.width * sc)));
      this.liqH = Math.max(2, Math.min(liq.height, Math.round(liq.height * sc)));
      lu.uPixAngle.value = (2 * tanH) / this.liqH;
      cu.uPixAngle.value = (2 * tanH) / size.height;
      cu.uLiqUV.value.set(this.liqW / liq.width, this.liqH / liq.height, (this.liqW - 0.5) / liq.width, (this.liqH - 0.5) / liq.height);
      // the points are steady; they only breathe
      const pts = cu.uPts.value;
      for (let i = 0; i < pts.length; i++) pts[i].w = 0.8 + 0.2 * Math.sin(time * 0.7 + i * 1.9);
      this.shared.uShWarm.value.set(2.5, 1.62, 0.78).multiplyScalar(0.45 + 0.55 * day);
      this.shared.uShCool.value.set(0.2, 0.3, 0.37).multiplyScalar(0.7 + 0.3 * day);
      lu.uIn.value.set(inside, time, size.aspect, f.self ? 1 : 0);
      cu.uIn.value.set(inside, time, size.aspect, 0);
      this.wall.uniforms.uIn.value.set(inside, time, 0.012, ci.position.distanceTo(f.center));
      post.exposure = lerp(post.exposure, 0.95, inside);
    }
  }

  _wriggle(frame, cam, can) {
    const { dt, pointer } = frame;
    this.wrigT += dt;
    this.wrig = Math.max(0, this.wrig - dt / 1.3);
    this.wrigWait -= dt;
    if (!can || dt <= 0 || this.wrigWait > 0) return;
    let go = false;
    if (pointer.inside && pointer.idle < 0.5) {
      // the pointer on it, or passing close
      _v.copy(CH_C).project(cam);
      const dx = (pointer.x - _v.x) * cam.aspect;
      const dy = pointer.y - _v.y;
      const reach = (0.022 / Math.max(0.02, cam.position.distanceTo(CH_C))) / Math.tan((cam.fov * Math.PI) / 360);
      go = dx * dx + dy * dy < reach * reach && (pointer.speed > 0.05 || pointer.down);
    } else if (this.ctx.still ? false : this.wrigWait < -9 - 5 * this.rnd()) go = true;
    if (go) {
      this.wrig = 1;
      this.wrigT = 0;
      this.wrigWait = 2.2;
      this.touches++;
    }
  }

  render(frame) {
    const r = this.ctx.renderer;
    const cam = this.camera;
    const prevAuto = r.autoClear;
    r.autoClear = true;
    const inside = this.inside;
    const cu = this.compose.uniforms;
    if (inside > 0) {
      this.march.render(r, this.coneRT);
      this.wall.render(r, this.wallRT);
      this.liquid.uniforms.tCone.value = this.coneRT.texture;
      this.liqRT.viewport.set(0, 0, this.liqW, this.liqH);
      this.liquid.render(r, this.liqRT, true);
      cu.tLiq.value = this.liqRT.texture;
      cu.tWall.value = this.wallRT.texture;
    }
    if (inside >= 1) {
      this.compose.render(r, this.outRT);
      r.autoClear = prevAuto;
      return this.outRT;
    }
    // (going through the surface there are both sides of it for a moment: the outside is then drawn at half size)
    const ext = inside > 0 ? this.halfRT : this.hero.visible ? this.mainRT : this.fineRT;
    this.set.drawRoom(r, cam, ext.width, ext.height);
    r.setRenderTarget(ext);
    r.render(this.set.scene, cam);
    if (inside > 0) {
      cu.tExt.value = ext.texture;
      this.compose.render(r, this.outRT);
      r.autoClear = prevAuto;
      return this.outRT;
    }
    if (this.hero.visible) {
      const dp = this.downPass.uniforms;
      dp.tSrc.value = this.mainRT.texture;
      dp.tDepth.value = this.mainRT.depthTexture;
      dp.uTexel.value.set(0.5 / this.mainRT.width, 0.5 / this.mainRT.height);
      this.nearFar.set(cam.near, cam.far);
      this.downPass.render(r, this.copyRT, true);
      r.autoClear = false;
      r.setRenderTarget(this.mainRT);
      r.render(this.hero.scene, cam);
    }
    r.autoClear = prevAuto;
    return ext;
  }

  createAudio(bus) {
    return createMirrorAudio(bus, this);
  }

  dispose() {
    this.downPass?.dispose();
    this.march?.dispose();
    this.compose?.dispose();
    this.liquid?.dispose();
    this.wall?.dispose();
  }
}

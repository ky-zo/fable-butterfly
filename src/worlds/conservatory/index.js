// WORLD 01 — CONSERVATORY (Perception)
// A fogged glass corridor through a tropical garden at the end of a warm day. Everything the visitor sees of the
// garden arrives through condensation: sharp where a leaf touches the pane, guessed at a hand's width behind it.
//
// The visitor follows a glasswing butterfly that has got in and cannot get out (hero.js, shots.js).
//
// Frame:  condensation sim → sun on the frost → garden (HDR + q) → depth-layered blur pyramids
//         → corridor (glass gathers the garden) → floor (analytic reflection of what was just drawn) → air (shafts, motes)
//         → a soft copy of all that (for the floor's mirror, and for what is seen through a wing) → the butterfly.
// The sun's depth map is drawn once, at the first frame.

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { damp, smoothstep } from '../../core/util.js';
import { HW, ZE, ZBACK, HULL, WALLS, SUN_DIR, hullExit, wallST, layoutGLSL } from './layout.js';
import { SunShadow, FrostScreen, ShadeScreen } from './sun.js';
import { Garden } from './garden.js';
import { Pyramid } from './pyramid.js';
import { Condensation } from './condensation.js';
import { buildCorridor } from './corridor.js';
import { makeDrops } from './drops.js';
import { Steer, HISTORY } from './steer.js';
import { Air } from './air.js';
import { createSound } from './sound.js';
import { bakeDressing } from './dressing.js';
import { Butterflies } from './butterflies.js';
import { GardenLife } from './gardenLife.js';
import { createButterflyKit, makeNoiseTexture, shadowUniforms } from '../../shared/butterfly/index.js';
import { insideLight, outsideLight, mirrorLight } from './bfLight.js';
import { Hero } from './hero.js';
import { LANDING, OPPOSITE } from './heroPath.js';
import { placeCamera, key, EYE, K_APERTURE, K_BLUR, K_EXPOSURE, K_BLOOM, K_TEMP, K_BEHIND } from './shots.js';

const EYE_FRONT = EYE.clone().add(new THREE.Vector3(0.00074, 0, 0));

export const meta = {
  duration: 84,
  scroll: 8000,
  hint: 'Point it at glass',
  captions: [
    { from: 0.02, to: 0.085, text: 'Everything I know about leaves, I learned through glass.' },
    { from: 0.196, to: 0.25, text: 'There is a shape on the wall. It moves when I move.' },
    { from: 0.492, to: 0.546, text: 'One of them rests where I rest. I can count its legs.' },
    { from: 0.9, to: 0.95, text: 'Now I can see all of it. I am still inside.' },
  ],
  // Played (docs/PLAY.md, section 5). Hold to fly; three times the journey waits for the animal to do what it would
  // do there: move, and see its shadow move; beat against the glass until the fog gives; keep still, and be joined.
  play: {
    // [from, k]: the pace of the journey from that progress on, against 1 / duration
    pace: [[0, 3], [0.084, 1], [0.104, 1.1], [0.192, 0.7], [0.232, 1.1], [0.49, 2], [0.548, 1], [0.568, 1.3], [0.87, 1], [0.89, 0.8]],
    // lift-offs and landings: a pose blended on progress cannot be stopped half-way, so these run on by themselves
    commit: [[0.084, 0.104], [0.458, 0.49], [0.548, 0.568], [0.87, 0.89]],
    finds: [
      { id: 'shadow', says: 'There is a shape on the wall. It moves when I move.' },
      { id: 'glass', says: 'Everything I know about leaves, I learned through glass.' },
      { id: 'other', says: 'One of them rests where I rest. I can count its legs.' },
    ],
    gates: [
      { id: 'shadow', at: 0.232, kind: 'steer' },
      // (brushing a pane clear takes a couple of seconds of doing: the world waits a little longer before it hints)
      { id: 'glass', at: 0.445, kind: 'beat', cue: 6.5, auto: 13 },
      { id: 'other', at: 0.49, kind: 'rest' },
    ],
    lines: [{ from: 0.9, to: 0.95, text: 'Now I can see all of it. I am still inside.' }],
  },
};
const COMMIT = meta.play.commit;
const inCommit = (p) => {
  for (let i = 0; i < COMMIT.length; i++) if (p >= COMMIT[i][0] && p < COMMIT[i][1]) return true;
  return false;
};
const TRAVEL = 0.15; // metres the hand must carry it off its line for its shadow to have been seen to follow
const BEATS = 5; // times its wings must be laid on the fog of the sunlit wall
const MEET = 2.2; // seconds of keeping still that bring the other one down
// Scroll (docs/PLAY.md, section 15): the same three finds with nothing that waits for them. Scrolling flies it and
// the visitor's hand leans it; a find is made when the hand has brought it there. [from, to, seconds it must be there]
const REACHED = { shadow: [0.192, 0.3, 0.15], glass: [0.352, 0.47, 0.4], other: [0.488, 0.553, 0.4] };
const AT_SHADE = 0.055; // m from the shade wall: its shadow, which the sun throws on that wall, has met it
const AT_GLASS = 0.045; // m from the sunlit wall: its wings are on the fog
const BY_HAND = 0.03; // m of that which the hand, not its own wandering, must have carried it
const TOWARD = 0.6; // of the way across the picture to the other one that the hand must lean it
// the one instruction, how to steer: it comes up on the way in to a find that has not been made (for the first, in the
// corridor, where there is nothing to hit), from this much progress before it can be made until this much after…
const HINT_LEAD = 0.075;
const HINT_PAST = 0.03;
const HINT_TRAVEL = 0.12; // …and goes for good once the hand has carried the animal this far (m)
const leadIn = (p, w) => p > w[0] - HINT_LEAD && p < w[0] + HINT_PAST;
/** Where the other one settles, on the far side of the landing pane. */
const OTHER_AT = new THREE.Vector3().copy(WALLS[OPPOSITE.wall].origin).addScaledVector(WALLS[OPPOSITE.wall].u, OPPOSITE.s).addScaledVector(WALLS[OPPOSITE.wall].v, OPPOSITE.t);

const FROST_TAN = 0.42; // half-angle of the fog's scattering cone, as a tangent
const NEAR_R = 28; // near-field gather radius, px at 1080p

export default class Conservatory {
  constructor(ctx) {
    this.ctx = ctx;
    this.dof = { focus: 4, aperture: 0, maxBlur: 8 };
    this.post = {
      dof: null,
      bloom: { strength: 0.5, radius: 0.85, threshold: 1.1, knee: 0.8 },
      exposure: 1.0,
      contrast: 1.12,
      saturation: 1.06,
      temperature: 0.04,
      lift: [0.0, 0.004, 0.009], // shadows lean toward the green-blue of wet glass
      gain: [1.02, 1.0, 0.955], // highlights toward the sun
      vignette: 0.4,
      grain: 0.04,
      ca: 0.001,
    };
    this.camera = new THREE.PerspectiveCamera(38, ctx.size.aspect, 0.012, 70);
  }

  async init() {
    const { ctx } = this;
    const lvl = ctx.quality.level;
    this.noise = ctx.track(makeNoiseTexture(256));
    await ctx.yield();
    // the butterfly (shared/butterfly): its meshes and atlas are built once, for the one inside, the one that lands
    // opposite it on the outside, and the small ones in the garden
    const kit = (this.kit = await createButterflyKit(ctx, { detail: ['high', 'low'], noise: this.noise }));

    const box = new THREE.Box3(new THREE.Vector3(-6.5, -0.2, ZE - 9), new THREE.Vector3(HW + 0.3, 6.5, ZBACK));
    this.shadow = new SunShadow(lvl >= 2 ? [4096, 2048] : lvl === 1 ? [2048, 2048] : [2048, 1024], box);

    this.screen = new FrostScreen(this.shadow, FSPass);
    this.cond = new Condensation(ctx, this.noise);
    this.pyramid = new Pyramid();

    // one bag of uniforms shared by every material of this world
    const U = (this.U = {
      tNoise: { value: this.noise },
      uTime: { value: 0 },
      ...this.shadow.uniforms,
      tFogL: { value: null },
      uFogBeam: { value: 0.14 },
      uSky: { value: new THREE.Vector3(0.2, 0.3, 0.42) },
      uBounce: { value: new THREE.Vector3(0.05, 0.075, 0.03) },
      uHaze: { value: new THREE.Vector3(0.26, 0.22, 0.12) },
      uHazeDensity: { value: 0.024 },
      uSunScale: { value: 0.16 },
      uRes: { value: new THREE.Vector2(1, 1) },
      tGarden: { value: null },
      uGS: { value: new THREE.Vector4(1, 1, 1, 1) },
      ...this.pyramid.uniforms,
      uK: { value: 600 },
      uR: { value: NEAR_R },
      uNearFar: { value: new THREE.Vector2(0.012, 70) },
      uCamK: { value: 0 },
      ...shadowUniforms(),
      uBfBounce: { value: new THREE.Vector4(0, 0, 0, 0) },
      tBfPane0: { value: null },
      uBfMirror: { value: new THREE.Vector4(1, 0, 0, 0) },
      tBfPane2: { value: null },
      uBfKey: { value: new THREE.Vector3(0.25, 1, 1) },
      tScene1: { value: null },
      tEye: { value: null },
      uEyeGarden: { value: 0 },
      uLens: { value: new THREE.Vector4(1, 0, 0, 0) },
      uViewDir: { value: new THREE.Vector3(0, 0, -1) },
      uClear: { value: 0 },
      uGlow: {
        value: [
          new THREE.Vector3(0.78, 0.6, 0.36), // left: sun through fog
          new THREE.Vector3(0.17, 0.23, 0.27), // right: sky shade
          new THREE.Vector3(0.6, 0.52, 0.36), // end
          new THREE.Vector3(0.36, 0.43, 0.48), // roof
          new THREE.Vector3(0.3, 0.38, 0.44),
          new THREE.Vector3(0.02, 0.022, 0.02), // floor
          new THREE.Vector3(0.015, 0.018, 0.018), // back
        ],
      },
    });

    U.tShade.value = kit.atlas.shade;
    const inside = insideLight(U);
    const outside = outsideLight(U);

    this.garden = new Garden(ctx, U);
    await this.garden.build(11);
    await ctx.yield();

    this.butterflies = new Butterflies(ctx, kit, outside);
    this.garden.scene.add(this.butterflies.group);
    this.life = new GardenLife(ctx, U);
    this.life.addTo(this.garden.scene);

    this.corridor = buildCorridor(ctx, U);
    const cm = this.corridor.mats;
    this.wallMats = [cm.left, cm.right, cm.end];
    this.wallMats.forEach((m, i) => m.uniforms.uSimSize.value.set(this.cond.walls[i].size[0], this.cond.walls[i].size[1]));
    await ctx.yield();
    this.dressing = await bakeDressing(ctx, this.cond.walls);
    this.wallMats.forEach((m, i) => {
      m.uniforms.tDress.value = this.dressing.textures[i];
      m.uniforms.uDressTexel.value = this.dressing.texel[i];
    });

    // sun-on-frost accumulators for the two walls the sun reaches from behind (left, end)
    // (and, at half that resolution, the sun that crosses the corridor onto the shade wall)
    const sz1 = this.cond.walls[1].size;
    this.screenRT = [
      ctx.createTarget({ size: this.cond.walls[0].size, type: THREE.HalfFloatType }),
      ctx.createTarget({ size: [sz1[0] / 2, sz1[1] / 2], type: THREE.HalfFloatType }),
      ctx.createTarget({ size: this.cond.walls[2].size, type: THREE.HalfFloatType }),
    ];
    this.wallMats.forEach((m, i) => (m.uniforms.tScreen.value = this.screenRT[i].texture));
    U.tBfPane0.value = this.screenRT[0].texture;
    U.tBfPane2.value = this.screenRT[2].texture;
    this.shade = new ShadeScreen(U, FSPass, layoutGLSL);
    this.screenInit = false;
    this.screenTick = 0;
    this.drops = this.cond.walls.map((w, i) => {
      const d = makeDrops(w, w.drops, U, i === 1 ? null : this.screenRT[i].texture);
      this.corridor.scene.add(d.mesh);
      return d;
    });
    this.air = new Air(ctx, U, this.screenRT[0].texture);
    this.air.addTo(this.corridor.scene);
    for (const m of this.corridor.glass) m.uniforms.tAir.value = this.air.texture;
    this.gardenRT = ctx.createTarget({ depth: true });
    this.mainRT = ctx.createTarget({ depth: true });
    // a half-resolution copy of the finished corridor, with its mip chain: rgb = colour, a = distance from the lens
    this.copyRT = ctx.createTarget({ scale: 0.5, mipmaps: true });
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
      { tSrc: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNearFar: U.uNearFar },
    );
    this.corridor.floorMat.uniforms.tScene.value = this.copyRT.texture;

    U.tScene1.value = this.copyRT.texture;
    // what the butterfly's eye has in front of it at the end of the walk: the garden beyond the end pane, drawn once
    this.eyeRT = ctx.createTarget({ size: [384, 256], depth: true, mipmaps: true });
    this.eyeCam = new THREE.PerspectiveCamera(104, 1.5, 0.05, 70);
    this.eyeCam.position.copy(EYE);
    this.eyeCam.lookAt(EYE.x - 0.15, EYE.y + 0.3, EYE.z - 1);
    this.eyeCam.updateMatrixWorld(true);
    this.eyeCam.matrixWorldInverse.copy(this.eyeCam.matrixWorld).invert();
    U.tEye.value = this.eyeRT.texture;
    this.hero = new Hero(kit, U, inside, mirrorLight(U));

    this._ray = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._st = new THREE.Vector2();
    this._hit = { wall: 0, s: 0, t: 0, dist: 0 };
    this.focus = 4;
    this.gardenScale = 1;
    this.lodScale = this.garden.lodScale;
    /** knocks against the glass, for the sound: a counter and the strength of the last one */
    this.taps = 0;
    this.tapStrength = 0;
    this.steer = new Steer(
      this.cond,
      ctx.rng(5),
      (strength) => {
        this.taps++;
        this.tapStrength = strength;
      },
      (wall) => {
        this.beatN++;
        this.beatWall = wall;
      },
    );
    // ---- play: what the visitor has done here on this visit (reset whenever progress jumps: see _play)
    this.beatN = 0;
    this.beatWall = -1;
    this.pv = { time: 0, p: 0, travel: 0, beats: 0, beatSeen: 0, meet: 0, circle: 0, dropT: 0, ghost0: -1, tapT: 0.25, tired: 0, shadow: false, glass: false, other: false };
    this._auto = new THREE.Vector3();
    // ---- scroll: seconds the hand has had it at each find, and how far the hand has carried it in all (m)
    this.sv = { shadow: 0, glass: 0, other: 0, travel: 0 };
    /** scroll: the visitor should be told how to steer now (something to find is close and they have not steered yet). */
    this.steerHint = false;
    /** where its line of flight is on screen (NDC): the core starts the thumb's aim from here. Never its steered place. */
    this.anchor = { x: 0, y: 0 };
    this.rnd = ctx.rng(23);
    this.runnerT = 3;
    this.eyeTick = 0;
    this.landT = 0;

    // let the condensation live for a while before anyone arrives: droplets run, old strokes half close
    const r = ctx.renderer;
    const STEPS = 64;
    const DT = 0.28;
    for (let i = 0; i < STEPS; i++) {
      const left = (STEPS - i) * DT;
      for (const [wall, ago, len, pts] of HISTORY) {
        if (ago <= left && ago > left - DT) {
          this.cond.lift(wall, (ago * 0.37) % 1);
          for (let k = 0; k < pts.length; k++) {
            const nx = k + 1 < pts.length ? pts[k + 1][0] - pts[k][0] : pts[k][0] - pts[k - 1][0];
            const ny = k + 1 < pts.length ? pts[k + 1][1] - pts[k][1] : pts[k][1] - pts[k - 1][1];
            const l = Math.hypot(nx, ny) || 1;
            this.steer.mark(wall, pts[k][0], pts[k][1], nx / l, ny / l, len, 0.95, k === 0);
          }
        }
      }
      if (i === STEPS - 26) this.cond.walls[1].drops.spawn(11.6, 2.02, 0.0048); // the long runner on the shade wall
      this.cond.step(r, DT, i * DT);
      if (i % 16 === 15) await ctx.yield();
    }
    r.setRenderTarget(null);
    await r.compileAsync(this.hero.scene, this.camera);
  }

  /** Cast a ray from NDC onto the simulated glass. Returns { wall, s, t, dist } (reused object) or null. */
  castNDC(x, y) {
    const cam = this.camera;
    const d = this._ray.set(x, y, 0.5).unproject(cam).sub(cam.position).normalize();
    const hit = hullExit(cam.position, d, 7);
    if (hit.idx < 0 || hit.idx > 2) return null;
    this._v.copy(cam.position).addScaledVector(d, hit.t);
    wallST(hit.idx, this._v, this._st);
    const w = this.cond.walls[hit.idx];
    if (this._st.x < 0 || this._st.x > w.w || this._st.y < 0 || this._st.y > w.h) return null;
    const h = this._hit;
    h.wall = hit.idx;
    h.s = this._st.x;
    h.t = this._st.y;
    h.dist = hit.t;
    return h;
  }

  /** Distance from the camera to the nearest glass that is in view (a few rays across the frame). */
  nearGlass() {
    let d = 9;
    for (const [x, y] of [[-0.8, 0], [0.8, 0], [-0.45, 0.3], [0.45, 0.3], [0, -0.3]]) {
      const h = this.castNDC(x, y);
      if (h) d = Math.min(d, h.dist);
    }
    return d;
  }

  /**
   * Play (docs/PLAY.md, section 5): what the animal is told this frame, what the visitor has done, and what the world
   * does by itself where the journey has waited long enough. Returns `shy` for butterflies.update.
   * Nothing here touches the camera.
   */
  _play(frame, play) {
    const { progress: p, dt, time } = frame;
    const s = this.pv;
    const hero = this.hero;
    const steer = this.steer;
    // a visit starts clean, and so does anything that jumps
    if (time < s.time || p < s.p - 1e-6 || p > s.p + 0.02) {
      s.travel = s.beats = s.circle = s.dropT = s.tired = 0;
      s.ghost0 = -1;
      s.meet = 0;
      s.shadow = s.glass = s.other = false;
    }
    s.time = time;
    s.p = p;
    const g = play.gate;
    const stage = g ? g.stage : 0;
    const id = g ? g.id : '';
    const soft = play.reduced ? 0.3 : 1;
    // it beats while a hand flies it, and while the journey carries it through a lift-off or a landing
    hero.driving = play.held || (inCommit(p) && frame.velocity > 0.001);
    hero.wanderGain = 1;
    steer.auto = null;
    steer.ghostOn = false;

    // ---- its shadow: carried off its line in the shaft of sun, the shape on the wall goes with it
    if (!s.shadow && p >= 0.212 && p < 0.3) {
      s.travel += steer.moved;
      if (s.travel >= TRAVEL) {
        s.shadow = true;
        play.find('shadow');
      }
    }
    if (id === 'shadow' && !s.shadow) {
      if (stage === 1) {
        // the cue: for two seconds in every five it wanders wider by itself, and the shadow swings on the wall
        const ph = (g.t % 5) / 2;
        const sw = ph < 1 ? Math.sin(Math.PI * ph) : 0;
        hero.wanderGain = 1 + 1.4 * soft * sw * sw;
      } else if (stage === 2) {
        // by itself: once round a circle a hand's width across, in the plane of the wall
        s.circle += dt;
        const a = (s.circle / 2.5) * Math.PI * 2;
        const ramp = Math.max(0, Math.min(1, s.circle / 0.4, (2.6 - s.circle) / 0.4));
        steer.auto = this._auto.set(0.03, Math.sin(a), -Math.cos(a)).multiplyScalar(0.12 * ramp * (0.5 + 0.5 * soft));
        if (s.circle >= 2.5) {
          s.shadow = true;
          play.pass('shadow');
        }
      }
    }

    // ---- the glass: held against the sunlit wall, each beat brushes the fog; enough of them and the way opens
    if (this.beatN !== s.beatSeen) {
      if (this.beatWall === 0 && p >= 0.352 && p < 0.47 && !s.glass) {
        s.beats += this.beatN - s.beatSeen;
        if (s.beats >= BEATS) {
          s.glass = true;
          play.find('glass');
        }
      }
      s.beatSeen = this.beatN;
    }
    if (id === 'glass' && !s.glass) {
      if (stage === 1) {
        // the cue: a heavy drop lets go above it and its trail wipes a clear line through the fog; and it leans at
        // the pane itself, half-way, and comes back
        s.dropT -= dt;
        wallST(0, hero.base, this._st);
        if (s.dropT <= 0) {
          s.dropT = 4;
          this.cond.walls[0].drops.spawn(this._st.x + 0.03 + this.rnd() * 0.05, this._st.y + 0.17 + this.rnd() * 0.05, 0.0047);
        }
        const ph = ((g.t + 1.6) % 4) / 1.3;
        const lean = ph < 1 ? Math.sin(Math.PI * ph) : 0;
        steer.auto = this._auto.set(-1, 0.12, 0).multiplyScalar(Math.max(0, HW + hero.base.x - 0.05) * lean * lean * (0.4 + 0.6 * soft));
      } else if (stage === 2) {
        // by itself: the idle hand takes it up the pane in short hops, bumping (steer.js)
        steer.ghostOn = true;
        if (s.ghost0 < 0) s.ghost0 = steer.ghostRuns;
        else if (steer.ghostRuns > s.ghost0) {
          s.glass = true;
          play.pass('glass');
        }
      }
    }

    // ---- the other one: for as long as ours flutters on the pane it hangs back in the garden. Keep still, and it
    // comes down head to head.
    const cue = id === 'other' && !s.other;
    s.tired += ((cue && stage === 2 ? 1 : 0) - s.tired) * (1 - Math.exp(-3 * dt));
    hero.tired = s.tired;
    if (s.other || play.has('other') || p > 0.4925) s.meet = Math.min(1, s.meet + dt / MEET);
    else if (p > 0.46) {
      if (cue && stage === 2) {
        // by itself: ours tires and stops answering the hand, and the other settles
        s.meet = Math.min(1, s.meet + dt / MEET);
        if (s.meet >= 1) {
          s.other = true;
          play.pass('other');
        }
      } else if (!play.held && hero.air < 0.05) {
        s.meet = Math.min(1, s.meet + dt / MEET);
        if (s.meet >= 1 && p >= 0.488) {
          s.other = true;
          play.find('other');
        }
      } else {
        // (the cue: it keeps coming most of the way down, and is off again at the fluttering)
        let want = 0;
        if (cue && stage === 1) {
          const ph = g.t % 2.4;
          want = ph < 1.7 ? 0.75 * smoothstep(0, 1.7, ph) : 0;
        }
        s.meet += (want - s.meet) * (1 - Math.exp(-(want < s.meet ? 6 : 2.2) * dt));
      }
    } else s.meet = play.has('other') ? 1 : 0;

    // ---- the end pane: clear from edge to edge, and still glass. It beats against it and there is nothing left to
    // brush: a dull tap, the beads let go, no mark. Then it stops trying.
    const trying = 1 - smoothstep(0.925, 0.95, p);
    if (hero.perch === 2 && hero.air < 0.3 && play.held && trying > 0.05 && dt > 0) {
      s.tapT -= dt;
      if (s.tapT <= 0) {
        s.tapT = 0.5;
        this.taps++;
        this.tapStrength = 0.5 * trying;
        wallST(2, hero.position, this._st);
        this.cond.shake(2, this._st.x, this._st.y, 0.13);
      }
    } else s.tapT = 0.25;
    return 1 - s.meet;
  }

  /**
   * Scroll (docs/PLAY.md, section 15): has the visitor's hand brought it to one of the three finds? Called after the
   * animal has been placed and steered. Only counts and tells the core; nothing here moves anything.
   */
  _scroll(frame, play) {
    const { progress: p, dt } = frame;
    const s = this.sv;
    const hero = this.hero;
    const R = REACHED;
    s.travel += this.steer.moved;
    if (this.steer.real && dt > 0) {
      const x = hero.position.x;
      const ox = hero.offset.x;
      if (hero.air > 0.6) {
        // its shadow: flown at the shade wall in the shaft of sun, it meets the shape the sun throws there
        if (p >= R.shadow[0] && p < R.shadow[1] && HW - x < AT_SHADE && ox > BY_HAND) s.shadow += dt;
        // the glass: flown at the sunlit wall and kept there, its wings on the fog
        if (p >= R.glass[0] && p < R.glass[1] && HW + x < AT_GLASS && ox < -BY_HAND) s.glass += dt;
      } else if (hero.air < 0.05 && p >= R.other[0] && p < R.other[1]) {
        // the other one: down on the pane, it is turned toward the one that has settled opposite
        const gap = this._v.copy(OTHER_AT).project(this.camera).x - this.anchor.x;
        if (play.aim.dx * Math.sign(gap) > TOWARD * Math.abs(gap)) s.other += dt;
      }
    }
    if (s.shadow >= R.shadow[2]) {
      s.shadow = 0;
      play.find('shadow');
    }
    if (s.glass >= R.glass[2]) {
      s.glass = 0;
      play.find('glass');
    }
    if (s.other >= R.other[2]) {
      s.other = 0;
      play.find('other');
    }
    this.steerHint =
      s.travel < HINT_TRAVEL && ((leadIn(p, R.shadow) && !play.has('shadow')) || (leadIn(p, R.glass) && !play.has('glass')) || (leadIn(p, R.other) && !play.has('other')));
  }

  /** For the play harness: the meters, and which way (NDC) a player who gets it would lean right now. */
  playState() {
    const s = this.pv;
    const hero = this.hero;
    // toward the nearest pane, as the picture shows it
    let wall = 0;
    let d = 9;
    for (let i = 0; i < 3; i++) {
      const h = HULL[i];
      const di = h[3] - (h[0] * hero.base.x + h[1] * hero.base.y + h[2] * hero.base.z);
      if (di < d) {
        d = di;
        wall = i;
      }
    }
    const h = HULL[wall];
    const q = new THREE.Vector3(hero.base.x + h[0] * d, hero.base.y + h[1] * d, hero.base.z + h[2] * d).project(this.camera);
    let ax = q.x - this.anchor.x;
    let ay = q.y - this.anchor.y;
    const l = Math.hypot(ax, ay);
    if (l > 0.03) {
      ax /= l;
      ay /= l;
    } else {
      ax = 0;
      ay = 1;
    }
    // scroll: where on screen (NDC) a hand would point to make each find now, the progress window it can be made in,
    // and the meters. Taken from its line of flight, never from where it has been steered to.
    const cam = this.camera;
    const b = hero.base;
    const ndc = (v) => [+v.x.toFixed(4), +v.y.toFixed(4)];
    // (its shadow on the shade wall; the sunlit pane a little way along from it, on whichever side is more in the picture)
    const shadow = new THREE.Vector3().copy(b).addScaledVector(SUN_DIR, (HW - b.x) / SUN_DIR.x).project(cam);
    const g1 = new THREE.Vector3(-HW, b.y, b.z - 0.05).project(cam);
    const g2 = new THREE.Vector3(-HW, b.y, b.z + 0.05).project(cam);
    const other = OTHER_AT.clone().project(cam);
    const finds = [
      { id: 'shadow', from: REACHED.shadow[0], to: REACHED.shadow[1], at: ndc(shadow) },
      { id: 'glass', from: REACHED.glass[0], to: REACHED.glass[1], at: ndc(Math.abs(g1.x) < Math.abs(g2.x) ? g1 : g2) },
      { id: 'other', from: REACHED.other[0], to: REACHED.other[1], at: ndc(other) },
    ];
    const v = this.sv;
    const scroll = { shadow: +v.shadow.toFixed(3), glass: +v.glass.toFixed(3), other: +v.other.toFixed(3), travel: +v.travel.toFixed(3), hint: this.steerHint };
    return { travel: +s.travel.toFixed(3), beats: s.beats, meet: +s.meet.toFixed(3), wall, glass: +d.toFixed(3), aim: [+ax.toFixed(3), +ay.toFixed(3)], finds, scroll };
  }

  update(frame) {
    const { time, progress, dt, size } = frame;
    const cam = this.camera;
    if (cam.aspect !== size.aspect) {
      cam.aspect = size.aspect;
      cam.updateProjectionMatrix();
    }
    placeCamera(cam, progress, size.aspect);
    const fw = this.castNDC(0, 0);
    const glassDist = (this.glassDist = fw ? fw.dist : 6);

    // ---- lens: on the butterfly, always. Shallow for the three rests, deep where the place itself is the subject.
    const U = this.U;
    const dof = this.dof;
    dof.aperture = key(K_APERTURE, progress);
    dof.maxBlur = key(K_BLUR, progress) * [0.8, 0.9, 1][this.ctx.quality.level];
    this.post.dof = dof.aperture * dof.maxBlur > 0.4 ? dof : null;

    const hero = this.hero;
    const play = frame.play;
    const on = !!play && play.mode === 'play';
    const shy = on ? this._play(frame, play) : 0;
    hero.update(frame, cam, !!this.post.dof);
    this.steer.quiet = progress > 0.165 && progress < 0.265;
    this.steer.update(frame, cam, hero);
    this.butterflies.update(time, progress, shy);
    this._v.copy(hero.base).project(cam);
    this.anchor.x = Math.max(-0.9, Math.min(0.9, this._v.x));
    this.anchor.y = Math.max(-0.9, Math.min(0.9, this._v.y));
    if (play && play.mode === 'scroll') this._scroll(frame, play);
    else this.steerHint = false;

    // down on the pane: the four feet are set on the fog, and for as long as it stays the patch it cleared coming in
    // stays clear (a function of progress: leave, and it fogs over)
    if (hero.perch === 1 && hero.air < 0.5 && dt > 0) {
      this.landT -= dt;
      if (this.landT <= 0) {
        this.landT = 0.5;
        this.steer.mark(LANDING.wall, LANDING.s, LANDING.t, LANDING.head[0], LANDING.head[1], 0.05, 0.45 + 0.4 * (1 - hero.air), true);
      }
    } else this.landT = 0;

    // every few seconds a heavy drop lets go near the top of whatever glass is in view, and runs down through the frame
    if (dt > 0) {
      this.runnerT -= dt;
      if (this.runnerT <= 0) {
        this.runnerT = 5 + this.rnd() * 6;
        const hit = this.castNDC((this.rnd() - 0.5) * 1.3, 0.55 + this.rnd() * 0.4);
        // (play: not on the wall the shadow falls on while the journey waits there. The lens can stay for as long as
        // the visitor likes, and every runner leaves a dark line through that picture)
        const spare = on && hit && hit.wall === 1 && progress > 0.185 && progress < 0.265;
        if (hit && hit.t > 0.5 && !spare) this.cond.walls[hit.wall].drops.spawn(hit.s, hit.t, 0.0036 + this.rnd() * 0.0014);
      }
    }

    const clear = smoothstep(0.83, 0.94, progress);
    // (on the eye for the last shot, where a millimetre is the whole depth of field)
    const want = cam.position.distanceTo(hero.position.clone().lerp(EYE_FRONT, smoothstep(0.955, 0.985, progress)));
    this.focus = dt > 0 ? damp(this.focus, want, 5, dt) : want;
    dof.focus = this.focus;
    // (what a wing shows of the room behind it is defocused by the wing's own shader: see wingShader.js, pass 4)
    U.uLens.value.set(dof.focus, this.post.dof ? dof.aperture : 0, dof.maxBlur * (size.height / 1080), 0.075);
    U.uEyeGarden.value = smoothstep(0.95, 0.985, progress);
    // with the lens a finger from the animal, whatever is behind the pane falls out of focus with its distance behind
    // — which the pane already knows (q), so it does that blur itself
    U.uCamK.value = key(K_BEHIND, progress) * (size.height / 1080);
    this.post.exposure = key(K_EXPOSURE, progress);
    if (this.post.bloom) this.post.bloom.strength = key(K_BLOOM, progress);
    this.post.temperature = key(K_TEMP, progress);
    // garden resolution: full when the pane is at arm's length or the end wall has cleared, less down the corridor
    // (not at the shadow on the shade wall: that pane is fully fogged, and close)
    // (nor quite full on the shade wall, where the lens is open and the picture is soft anyway)
    const near =
      (1 - smoothstep(0.5, 1.4, Math.min(glassDist, this.nearGlass()))) *
      (1 - smoothstep(0.1, 0.14, progress) * (1 - smoothstep(0.27, 0.31, progress))) *
      (1 - 0.5 * smoothstep(0.6, 0.66, progress) * (1 - smoothstep(0.8, 0.83, progress))) *
      // (nor as it lifts off the landing pane: the lens is pulling back and turning, and nothing holds still to be read)
      (1 - 0.18 * smoothstep(0.555, 0.575, progress) * (1 - smoothstep(0.6, 0.63, progress)));
    // (and where the lens is a hand from the butterfly, the garden is so far out of focus that half of it is plenty)
    const macro = Math.max(1 - smoothstep(0.08, 0.1, progress), smoothstep(0.962, 0.985, progress));
    // (and in the last push the garden behind the animal is only colour)
    this.gardenScale = Math.round((0.62 + 0.38 * Math.max(near, smoothstep(0.1, 0.55, clear), smoothstep(0.825, 0.86, progress))) * (1 - 0.55 * macro) * (1 - 0.4 * smoothstep(0.962, 0.985, progress)) * [0.72, 0.86, 1][this.ctx.quality.level] * 32) / 32;
    // which walls are in frame: the others only need their fog advanced now and then
    this.seen = this.seen || [true, true, true];
    this.seen[0] = this.seen[1] = this.seen[2] = false;
    let deep = 0;
    for (const [x, y] of [[-0.95, 0], [0.95, 0], [0, 0], [-0.5, 0.6], [0.5, 0.6], [-0.5, -0.5], [0.5, -0.5], [-0.95, 0.9], [0.95, 0.9]]) {
      const h = this.castNDC(x, y);
      if (h) this.seen[h.wall] = true;
      const d = this._ray.set(x, y, 0.5).unproject(cam).sub(cam.position).normalize();
      deep = Math.max(deep, Math.min(hullExit(cam.position, d, 7).t, 20));
    }
    /** how much air there is in frame: with the lens up against a wall, the corridor's haze and shafts are not worth marching */
    this.airK = smoothstep(1.25, 2.2, deep) * (1 - macro);
    this.garden.lodScale = this.lodScale * (1 - 0.85 * macro);
    U.uTime.value = time;
    U.uClear.value = clear;
  }

  render(frame) {
    const r = this.ctx.renderer;
    const { size, dt, time } = frame;
    const U = this.U;
    const cam = this.camera;
    const prevAuto = r.autoClear;
    r.autoClear = true;

    this.cond.step(r, dt, time, this.seen);
    U.tFogL.value = this.cond.tex(0);
    for (const d of this.drops) d.attr.needsUpdate = true;
    this.wallMats.forEach((m, i) => {
      m.uniforms.tSim.value = this.cond.walls[i].a.texture;
      m.uniforms.tDir.value = this.cond.walls[i].dir.texture;
    });

    U.uSunT.value = time;
    if (!this.shadowDone) {
      // the sun's depth map is drawn once (see sun.js: the wind lives in the lookups)
      this.shadow.render(r, this.garden.scene);
      this.shadowDone = true;
    }
    // The garden as the eye on the end pane has it in front of it: drawn once, and then again every fourth frame for as
    // long as the lens is close enough to see it there — leaves move in it, and whatever is flying crosses it.
    if (!this.eyeDone || (U.uEyeGarden.value > 0 && this.eyeTick++ % 4 === 0)) {
      this.eyeDone = true;
      const free = this.butterflies.free.group;
      const was = free.visible;
      free.visible = false;
      this.garden.update(this.eyeCam);
      r.setRenderTarget(this.eyeRT);
      r.render(this.garden.scene, this.eyeCam);
      free.visible = was;
    }
    // the sun as it lands on the two walls it reaches from behind: converged once, then refreshed one wall every other
    // frame (the shadows only sway)
    r.autoClear = false;
    const n = this.screenInit ? 1 : 10;
    for (let k = 0; k < n; k++) {
      const a = this.screenInit ? 0.35 : k === 0 ? 1 : 0.3;
      const turn = this.screenInit ? this.screenTick++ % 4 : -1;
      if (turn === -1 || turn === 0) this.screen.render(r, this.cond.walls[0], this.screenRT[0], a);
      if (turn === -1 || turn === 2) this.screen.render(r, this.cond.walls[2], this.screenRT[2], a);
      if (turn === -1 || turn === 1) this.shade.render(r, this.cond.walls[1], this.screenRT[1], a);
    }
    this.screenInit = true;
    r.autoClear = true;

    // The garden is only ever seen through at least a pixel of blur, except where the glass is close or clear. So it is
    // drawn into a corner of its target, at a scale that follows how near the glass in view is.
    this.garden.update(cam);
    const gs = this.gardenScale;
    const gw = Math.max(2, Math.round(size.width * gs));
    const gh = Math.max(2, Math.round(size.height * gs));
    const grt = this.gardenRT;
    grt.viewport.set(0, 0, gw, gh); // (no scissor: the clear then covers the whole target and nothing has to be loaded)
    U.uGS.value.set(gw / grt.width, gh / grt.height, (gw - 0.5) / grt.width, (gh - 0.5) / grt.height);
    r.setRenderTarget(grt);
    r.render(this.garden.scene, cam);

    const sH = size.height / 1080;
    const focalPx = size.height / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const K = FROST_TAN * focalPx;
    const R = NEAR_R * sH;
    this.pyramid.resize(size.width, size.height);
    this.pyramid.build(r, this.gardenRT, K, R, U.uGS.value);

    U.uRes.value.set(size.width, size.height);
    U.tGarden.value = this.gardenRT.texture;
    U.uK.value = K;
    U.uR.value = R;
    U.uNearFar.value.set(cam.near, cam.far);
    cam.getWorldDirection(U.uViewDir.value);

    // (with the lens against a pane the corridor's own air is not marched, only the garden's)
    const corridorAir = this.airK > 0.003;
    this.air.comp.mesh.visible = corridorAir;
    this.air.update(r, cam, this.dof, size.height, corridorAir, this.airK);
    this.corridor.floorMat.uniforms.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    // glass, steel, floor, droplets, shafts, motes: one pass
    r.setRenderTarget(this.mainRT);
    r.render(this.corridor.scene, cam);

    // What the floor will mirror next frame, and what a wing shows of the room behind it when that room is out of
    // focus: the corridor as it stands now, without the butterfly, at half resolution and down its mip chain.
    // (and its translucent scales are tinted by it: so it is made every frame)
    {
      const dp = this.downPass.uniforms;
      dp.tSrc.value = this.mainRT.texture;
      dp.tDepth.value = this.mainRT.depthTexture;
      dp.uTexel.value.set(0.5 / this.mainRT.width, 0.5 / this.mainRT.height);
      this.downPass.render(r, this.copyRT, true);
    }

    // the butterfly, over everything, back to front (see hero.js)
    r.autoClear = false;
    r.setRenderTarget(this.mainRT);
    r.render(this.hero.scene, cam);
    r.autoClear = prevAuto;
    return this.mainRT;
  }

  createAudio(bus) {
    return createSound(bus, this);
  }

  dispose() {
    this.garden?.dispose();
    for (const d of this.drops || []) {
      d.geo.dispose();
      d.mat.dispose();
    }
    this.corridor?.dispose();
    this.pyramid?.dispose();
    this.air?.dispose();
    this.downPass?.dispose();
    this.cond?.dispose();
    this.shadow?.dispose();
    this.screen?.dispose();
    this.shade?.dispose();
    this.dressing?.dispose();
    this.life?.dispose();
  }
}

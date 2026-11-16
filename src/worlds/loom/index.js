// WORLD 05 — LOOM (Attention): silk.
// The thread it once spun to hang itself from, when it was something else. One strand with dew on it; the animal
// drawn in thread on that strand, its veins the warp, the membrane woven between them as weft; a web of hanks from it
// to everything it can turn to, which pull tight toward whatever it attends to and go slack elsewhere; and at the end
// all of it drawn back into one small pad under a steel bar, with something bright and curved hanging from it.
//
//   story.js    the plan: places, the animal's path, what it attends to, how much is woven, the lens. Pure in progress.
//   silk.js     the ribbon shader every filament is drawn with (strands between anchors; polylines; the kit's rig)
//   hero.js     the animal in thread, from the butterfly kit's curves and rig
//   web.js      strands, the leaf, the figure-of-eight trails, the pad, the winding of the chrysalis
//   dew.js      beads of dew riding on the strands, dust        words.js   its own words, riding on what is tight
//   scene.js    the fogged glass at dawn, the steel bar, the chrysalis under the winding
//   lens.js     this world's own depth of field (ribbons carry their own circle of confusion)
//   audio.js    air, a low tone, a string for whatever is pulled tight

import * as THREE from 'three';
import { damp, clamp, smoothstep } from '../../core/util.js';
import { silkShared, NG } from './silk.js';
import { buildHero, makeAttachTexture } from './hero.js';
import { buildWeb } from './web.js';
import { buildDew } from './dew.js';
import { buildWords } from './words.js';
import { buildScene } from './scene.js';
import { Lens } from './lens.js';
import { buildAudio } from './audio.js';
import { G, PG, PAD, TARGETS, key, attention, placeCamera, K_LAID, K_GATHER, K_WEB, K_DAWN, K_DEW, K_WIND, K_CHROME, K_REST, K_SLACK } from './story.js';

export const meta = {
  duration: 88,
  scroll: 7800,
  hint: 'Point at something',
  captions: [
    { from: 0.035, to: 0.15, text: 'Before I had wings, I had thread.' },
    { from: 0.37, to: 0.5, text: 'Whatever I turn to pulls tight. The rest lets go.' },
    { from: 0.63, to: 0.735, text: 'Every strand I laid goes back to one place.' },
    { from: 0.85, to: 0.955, text: 'I hung everything I was from a single point.' },
  ],
};

const _v = new THREE.Vector3();
const NT = TARGETS.length;

export default class Loom {
  constructor(ctx) {
    this.ctx = ctx;
    this.post = {
      dof: null,
      bloom: { strength: 0.5, radius: 0.84, threshold: 0.9, knee: 0.6 },
      exposure: 1.0,
      contrast: 1.05,
      saturation: 1.04,
      temperature: 0.0,
      vignette: 0.36,
      grain: 0.032,
      ca: 0.0009,
    };
  }

  async init() {
    const { ctx } = this;
    this.camera = new THREE.PerspectiveCamera(24, ctx.size.aspect, 0.02, 60);
    this.shot = {};
    placeCamera(this.camera, 0, ctx.size.aspect, this.shot);
    this.lens = new Lens(ctx);
    this.glow = ctx.createTarget({ scale: 0.25, mipmaps: true }); // all the thread light, small and soft: what it leaves in the air
    this.lens.compose.uniforms.tGlow.value = this.glow.texture;
    this.shared = silkShared(makeAttachTexture(ctx));
    this.shared.uPad.value.copy(PAD);
    await ctx.yield();

    this.hero = await buildHero(ctx, this.shared);
    await ctx.yield();
    this.web = buildWeb(ctx, this.shared);
    await ctx.yield();
    this.set = buildScene(ctx);
    this.dew = buildDew(ctx, this.shared, this.web, this.set.uDawn);
    this.dew.group.add(this.web.heads); // (the points that write the trails are drawn with the other sharp lights)
    await ctx.yield();
    this.words = await buildWords(ctx, this.shared, this.web);
    await ctx.yield();

    // one scene per pass: the same three geometries with that pass's materials
    this.passes = [0, 1, 2, 3].map((k) => {
      const s = new THREE.Scene();
      s.add(this.web.strands[k], this.web.polys[k], this.hero.meshes[k]);
      return s;
    });
    this.emph = new Float32Array(NT);
    this.att = new Float32Array(NT);
    this.live = false;
    this.attended = -1;
    this.turn = 0;

    // compile everything off the main thread
    this._state(0, 0, 0);
    const r = ctx.renderer;
    for (const s of this.passes) {
      await r.compileAsync(s, this.camera);
      await ctx.yield();
    }
    await r.compileAsync(this.set.scene, this.camera);
    await r.compileAsync(this.dew.group, this.camera);
    await r.compileAsync(this.words.mesh, this.camera);
    for (const pass of [this.lens.dofPre, this.lens.dofA, this.lens.dofB, this.lens.compose, this.lens.gatherNear, this.lens.gatherFar, this.lens.add]) {
      await pass.compile(r);
    }
    await ctx.yield();
  }

  // ---- what is being attended to: where the story has it turned, or what the pointer is held near
  _attend(frame) {
    const { pointer, dt, progress } = frame;
    const live = (this.live = pointer.inside && pointer.idle < 5);
    let pick = -1;
    if (live) {
      let best = 0.42;
      for (let i = 0; i < NT; i++) {
        _v.copy(TARGETS[i]).project(this.camera);
        if (_v.z > 1) continue;
        const d = Math.hypot((_v.x - pointer.x) * Math.min(1, this.camera.aspect), _v.y - pointer.y);
        if (d < best) {
          best = d;
          pick = i;
        }
      }
    }
    let top = 0;
    let which = -1;
    for (let i = 0; i < NT; i++) {
      if (dt > 0) this.emph[i] = damp(this.emph[i], i === pick ? 1 : 0, 5, dt);
      else if (frame.time === 0) this.emph[i] = 0;
      const web = key(K_LAID, progress) * (1 - key(K_GATHER, progress));
      const a = (this.att[i] = Math.max(attention(i, progress), this.emph[i] * web));
      if (a > top) {
        top = a;
        which = i;
      }
    }
    this.attended = top > 0.25 ? which : -1;
    this.iso = top;
  }

  _state(p, time, dt) {
    const sh = this.shared;
    const laid = key(K_LAID, p);
    const gather = key(K_GATHER, p);
    const far = this.shot.far || 1;
    const webOn = key(K_WEB, p) * Math.min(far, 3.4);
    const rest = key(K_REST, p);
    const others = (i) => {
      let m = 0;
      for (let j = 0; j < NT; j++) if (j !== i) m = Math.max(m, this.att[j]);
      return m;
    };
    for (let i = 0; i < NG; i++) {
      const g = sh.uGroup.value[i];
      const b = sh.uGroupB.value[i];
      if (i < NT) {
        const a = this.att[i];
        const o = others(i);
        // what it turns to pulls tight, brightens and sings; the rest sags and dims
        const sing = a * (0.75 + 0.25 * Math.sin(time * 1.7 + i * 2.1));
        g.set(Math.max(0.22 * (1 - 0.7 * o), a, gather), (0.17 * (1 - 0.55 * o) * rest + 0.75 * a) * webOn, laid, sing);
        b.set(a, gather, 0.075 + 0.05 * o, 0);
      } else if (i === G.MAIN) {
        g.set(1, 1.5, 1, 0.12 + 0.5 * this.att[1] + 0.5 * this.att[4]);
        b.set(0.3, smoothstep(0.79, 0.9, p), 0, 0);
      } else if (i === G.AMBIENT) {
        g.set(Math.max(0.04, gather), (0.13 - 0.06 * this.iso) * key(K_WEB, p) * key(K_SLACK, p) * Math.sqrt(far), laid, 0);
        b.set(0.05, gather, 0.2, 0);
      } else {
        g.set(0, 0.22 * smoothstep(0.7, 0.8, p), 1, 0);
        b.set(0.1, 0, 0.5, 0);
      }
    }
    const wind = key(K_WIND, p);
    const poly = sh.uPoly.value;
    poly[PG.LEAF].set(1, 0.55 * (1 + 0.9 * this.att[0]) * (1 - 0.5 * gather), 0.1 + 0.5 * this.att[0], 0.5 + this.att[0]);
    poly[PG.TRAIL].set(laid * 1.34 * (1 - smoothstep(0.74, 0.86, p)), 0.12 + 0.5 * smoothstep(0.215, 0.24, p) * (1 - smoothstep(0.33, 0.39, p)), 0.3, 0.4);
    poly[PG.PAD].set(smoothstep(0.69, 0.8, p), 0.24, 0.35, 0.5);
    poly[PG.STALK].set(smoothstep(0.88, 0.93, p), 0.5, 0.3, 0.3);
    poly[PG.WIND].set(wind, 1.25, 0.12, 0.7);
    // where the strands are tied to the glass: there with the web, and lit with whichever of the two it turns to
    const held = laid > 0.5 ? (1 - gather) * key(K_WEB, p) * Math.min(far, 3.4) : 0;
    poly[PG.HOLD_LIGHT].set(1, (0.1 + 0.8 * this.att[2]) * held, 0.3 + 0.5 * this.att[2], 0.3);
    poly[PG.HOLD_PANE].set(1, (0.1 + 0.8 * this.att[3]) * held, 0.3 + 0.5 * this.att[3], 0.3);

    sh.uDew.value = key(K_DEW, p);
    const dawn = key(K_DAWN, p);
    // (what it turns to is a little brighter for it: the panes, the low light)
    this.set.uDawn.value.set(dawn, 0.55 + 0.75 * (1 - dawn) + 0.9 * this.att[3], (0.25 + 0.75 * dawn) * (1 + 0.35 * this.att[2]), time);
    this.set.barU.uPadGlow.value = 0.1 * smoothstep(0.7, 0.8, p);
    this.set.chrysU.uChrys.value.set(p > 0.89 ? 1 : 0, key(K_CHROME, p) * (0.2 + 0.8 * wind), wind / 0.44 - 0.03, 0);
    this.set.chrys.visible = p > 0.89;
  }

  update(frame) {
    const { time, progress, dt } = frame;
    const cam = this.camera;
    // the lens: progress and nothing else
    const lz = placeCamera(cam, progress, frame.size.aspect, this.shot);
    this.post.exposure = lz.exposure;

    this._attend(frame);
    this._state(progress, time, dt);
    this.post.bloom.strength = 0.5;
    // it turns a little toward what the pointer picks out
    const want = this.live && this.attended >= 0 ? clamp((_v.copy(TARGETS[this.attended]).project(cam).x - 0) * 0.5, -0.6, 0.6) : 0;
    this.turn = dt > 0 ? damp(this.turn, want, 1.5, dt) : this.turn;
    this.hero.update(progress, time, this.turn, lz.far);

    const L = this.lens;
    L.set(cam, lz.focus, lz.K, 0.05);
    const u = this.shared;
    u.uTime.value = time;
    u.uFocus.value = L.focus;
    u.uK.value = L.K;
    u.uMaxCoc.value = L.maxCoc;
    u.uSplit.value.set(L.split[0], L.split[1], L.split[2]);
    u.uPxPerM.value = L.opaque.height / 2 / Math.tan((cam.fov * Math.PI) / 360);
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    this.set.setCamera(cam);
    this.dew.setCamera(cam);
    this.words.update(this.att, key(K_LAID, progress) * (1 - smoothstep(0, 0.25, key(K_GATHER, progress))), cam);
  }

  render() {
    const r = this.ctx.renderer;
    const cam = this.camera;
    const L = this.lens;
    const prevAuto = r.autoClear;
    const prevAlpha = r.getClearAlpha();
    r.autoClear = false;
    r.setClearAlpha(0);
    const mat = (k, i) => this.passes[k].children[i].material.uniforms;
    const each = (k, f) => {
      for (let i = 0; i < 3; i++) f(mat(k, i));
    };

    // 0. the light the threads leave in the air
    r.setRenderTarget(this.glow);
    r.clear();
    each(3, (m) => {
      m.uInvTarget.value.set(1 / this.glow.width, 1 / this.glow.height);
      m.uRes.value = this.glow.height / L.opaque.height;
    });
    r.render(this.passes[3], cam);

    // 1. what is solid, and what is behind everything
    r.setRenderTarget(L.opaque);
    r.clear();
    r.render(this.set.scene, cam);
    L.resolveOpaque(r);

    // 2. threads, by how far out of focus they are; dew, dust and words with the sharp ones
    this.shared.tDepth.value = L.opaque.depthTexture;
    each(0, (m) => m.uInvTarget.value.set(1 / L.main.width, 1 / L.main.height));
    r.setRenderTarget(L.main);
    r.render(this.passes[0], cam);
    r.render(this.dew.group, cam);
    r.render(this.words.mesh, cam);
    if (L.useBand) {
      each(1, (m) => m.uInvTarget.value.set(1 / L.band.width, 1 / L.band.height));
      r.setRenderTarget(L.band);
      r.clear();
      r.render(this.passes[1], cam);
    }
    if (L.useFar) {
      each(2, (m) => m.uInvTarget.value.set(1 / L.lines.width, 1 / L.lines.height));
      r.setRenderTarget(L.lines);
      r.clear();
      r.render(this.passes[2], cam);
    }
    L.resolveSoft(r);

    r.setRenderTarget(null);
    r.autoClear = prevAuto;
    r.setClearAlpha(prevAlpha);
    return L.main;
  }

  createAudio(bus) {
    return buildAudio(bus, this);
  }

  dispose() {
    this.lens?.dispose();
  }
}

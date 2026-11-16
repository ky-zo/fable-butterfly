// Living condensation. Each simulated wall owns
//   sim  (float, ping-pong)  r = fog amount, g = water film, b = age since last disturbed (0..1)
//   dir  (half float)        rg = doubled-angle direction of the last stroke (so streaks run with the wing that made
//                            them), b = wing scales left on the glass (they stay: the pane keeps every attempt)
// The fog regrows on its own: slowly everywhere once the film has drained, faster where the neighbours are already
// fogged, so a mark closes in from its edges. What touches the glass is stamped in: the fan of a wing laid against
// it, the thin drag of a body, the four dots of a landing, the trail of a running drop.

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { WALLS, BAY, TRANSOM, Y0, layoutGLSL } from './layout.js';
import { paneGLSL, paneUniforms } from './panes.js';

const STEP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tPrev, tNoise;
uniform vec2 uTexel, uWallSize;
uniform float uDt, uInit, uFogBase;
uniform int uWall;
${layoutGLSL}
${paneGLSL}
float target(vec2 st){
  vec4 n1 = texture2D(tNoise, st * vec2(0.23, 0.31));
  vec4 n0 = texture2D(tNoise, st * vec2(0.061, 0.11) + 0.5);
  float hgt = st.y / uWallSize.y;
  // thinner where the sun warms the upper glass, heavy and wet near the sill
  float f = uFogBase + 0.42 * (n1.r - 0.5) + 0.3 * (n0.g - 0.5) - 0.2 * smoothstep(0.35, 1.0, hgt) + 0.2 * smoothstep(0.25, 0.0, hgt);
  return clamp(f, 0.0, 1.0);
}
void main(){
  vec2 st = vUv * uWallSize;
  float tg = target(st);
  // (alpha: how readily this pane fogs — see panes.js. Kept beside the fog so that whoever asks how much sun a pane
  // lets through gets the same answer the pane shader draws.)
  vec2 pl, psz; float row;
  float pz = paneAt(uWall, st, pl, psz, row).z;
  if (uInit > 0.5) { gl_FragColor = vec4(tg, 0.0, 1.0, pz); return; }
  vec4 s = texture2D(tPrev, vUv);
  float fog = s.r, water = s.g, age = s.b;
  float nb = 0.25 * (texture2D(tPrev, vUv + vec2(uTexel.x, 0.0)).r + texture2D(tPrev, vUv - vec2(uTexel.x, 0.0)).r
                   + texture2D(tPrev, vUv + vec2(0.0, uTexel.y)).r + texture2D(tPrev, vUv - vec2(0.0, uTexel.y)).r);
  age = min(1.0, age + uDt / 70.0);
  water = max(0.0, water - uDt * (0.018 + 0.055 * water));
  float grain = texture2D(tNoise, st * 3.1 + 0.37).g;
  float gate = smoothstep(0.06, 0.2, age + (grain - 0.5) * 0.12) * (1.0 - smoothstep(0.05, 0.28, water));
  float rate = gate * (0.03 + 0.34 * nb * nb);
  fog += (tg - fog) * (1.0 - exp(-rate * uDt));
  gl_FragColor = vec4(fog, water, age, pz);
}`;

const STAMP_VERT = /* glsl */ `
attribute vec4 aSeg;    // a.xy → b.xy in wall metres
attribute vec4 aPar;    // radius, kind (0 body drag, 1 droplet trail, 2 wing fan, 3 foot), strength, seed
attribute float aLen;   // stroke length travelled before a
uniform vec2 uWallSize;
varying vec2 vP;
varying vec4 vSeg;
varying vec4 vPar;
varying float vLen;
void main(){
  vec2 a = aSeg.xy, b = aSeg.zw;
  vec2 d = b - a;
  float l = length(d);
  vec2 t = l > 1e-6 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  float r = aPar.x * 1.08;
  vec2 p = mix(a, b, position.x * 0.5 + 0.5) + t * position.x * r + n * position.y * r;
  vP = p; vSeg = aSeg; vPar = aPar; vLen = aLen;
  gl_Position = vec4(p / uWallSize * 2.0 - 1.0, 0.0, 1.0);
}`;

const STAMP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vP;
varying vec4 vSeg;
varying vec4 vPar;
varying float vLen;
uniform sampler2D tNoise;
void main(){
  vec2 a = vSeg.xy, ab = vSeg.zw - vSeg.xy;
  float l2 = dot(ab, ab);
  float h = l2 > 1e-10 ? clamp(dot(vP - a, ab) / l2, 0.0, 1.0) : 0.0;
  float l = sqrt(l2);
  vec2 t = l > 1e-5 ? ab / l : vec2(0.0, -1.0);
  float x = length(vP - (a + ab * h)) / vPar.x;
  float across = dot(vP - a, vec2(-t.y, t.x)) / vPar.x;
  float along = vLen + h * l;
  float alpha = 0.0; vec3 src = vec3(0.0); vec2 dirv = t; float scales = 0.0;
  if (vPar.y < 0.5) {
    // the body dragged along the pane: a narrow ragged line
    float n1 = texture2D(tNoise, vec2(across * 0.33 + vPar.w * 3.0, along * 2.1)).g;
    float e = 1.0 - smoothstep(0.35 + (n1 - 0.5) * 0.6, 0.97, x);
    alpha = e * (0.55 + 0.45 * n1) * vPar.z;
    src = vec3(0.0, 0.1 + 0.2 * n1, 0.0);
    scales = 0.12 * e;
  } else if (vPar.y < 1.5) {
    alpha = (1.0 - smoothstep(0.5, 1.0, x)) * vPar.z;
    src = vec3(0.0, 0.9, 0.0);
  } else if (vPar.y < 2.5) {
    // a wing brushed across the fog: a soft lobe that opens from the hinge (a) toward the tip (b). The wing turns
    // about its hinge as it beats, so what it leaves is combed in arcs, feathered at both ends of the sweep, never
    // quite clear — and thickest with scales where the border dragged.
    vec2 q = (vP - a) / max(l, 1e-5);
    float r = length(q);
    float al = dot(q, t), ac = dot(q, vec2(-t.y, t.x));
    float ang = atan(ac, al);
    float arcs = texture2D(tNoise, vec2(r * 2.3 + vPar.w * 11.0, ang * 0.11 + vPar.w)).g;
    float fine = texture2D(tNoise, vec2(r * 7.1 + vPar.w * 5.0, ang * 0.37)).g;
    float wide = 0.5 + 0.34 * smoothstep(0.1, 0.8, r);                       // broader toward the tip, like the wing
    float lobe = exp(-ang * ang / (wide * wide) * (ang > 0.0 ? 1.7 : 0.9));
    float reach = 0.94 + (arcs - 0.5) * 0.3;
    float fan = lobe * smoothstep(reach, reach - 0.3, r) * smoothstep(0.02, 0.22, r);
    alpha = fan * (0.3 + 0.7 * smoothstep(0.28, 0.62, arcs * 0.65 + fine * 0.35)) * vPar.z;
    src = vec3(0.0, 0.1 + 0.22 * fine, 0.0);
    dirv = r > 1e-4 ? vec2(-q.y, q.x) / r : t;                              // streaks run along the sweep
    scales = fan * (0.2 + 0.8 * smoothstep(reach - 0.4, reach - 0.1, r)) * (0.5 + 0.5 * fine);
  } else {
    // a foot
    float d = length(vP - a) / vPar.x;
    alpha = (1.0 - smoothstep(0.55, 1.0, d)) * vPar.z;
    src = vec3(0.0, 0.3, 0.0);
  }
#ifdef DIR_PASS
  float al = smoothstep(0.02, 0.35, alpha);
  float th = atan(dirv.y, dirv.x) * 2.0;
  gl_FragColor = vec4(cos(th) * al, sin(th) * al, max(scales, 0.0) * al, al);
#else
  gl_FragColor = vec4(src * alpha, alpha);
#endif
}`;

const MAX_STAMPS = 384;

// cheap smooth 1D/2D noise for droplet behaviour (CPU)
const h1 = (n) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};
const vn = (x, y) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = h1(xi + yi * 57.0);
  const b = h1(xi + 1 + yi * 57.0);
  const c = h1(xi + (yi + 1) * 57.0);
  const d = h1(xi + 1 + (yi + 1) * 57.0);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
};

/** Droplets that hang, swell, let go, run, merge and stall. Positions in wall metres. */
class Drops {
  constructor(n, wall, rnd) {
    this.n = n;
    this.wall = wall;
    this.rnd = rnd;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.r = new Float32Array(n);
    this.sleep = new Float32Array(n);
    this.seed = new Float32Array(n);
    /** x, y, radius, stretch — uploaded to the lens instances */
    this.data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      this.respawn(i);
      this.sleep[i] = rnd() * 6;
      this.r[i] = 0.0012 + rnd() * 0.002;
    }
  }

  floorOf(y) {
    const tr = TRANSOM - Y0;
    return this.wall.id < 2 && y > tr ? tr + 0.03 : 0.012;
  }

  respawn(i) {
    const { rnd, wall } = this;
    const bay = wall.id < 2 ? BAY : wall.w;
    const k = Math.floor(rnd() * (wall.w / bay));
    const margin = wall.id < 2 ? 0.05 : 0.08;
    this.x[i] = k * bay + margin + rnd() * (bay - margin * 2);
    const tr = TRANSOM - Y0;
    const upper = wall.id < 2 && rnd() < 0.22;
    this.y[i] = upper ? tr + 0.06 + rnd() * (wall.h - tr - 0.1) : 0.25 + Math.pow(rnd(), 0.7) * (Math.min(tr, wall.h) - 0.3);
    this.px[i] = this.x[i];
    this.py[i] = this.y[i];
    this.vy[i] = 0;
    this.r[i] = 0.0009 + rnd() * 0.0012;
    this.sleep[i] = 1 + rnd() * 9;
    this.seed[i] = rnd() * 100;
  }

  /** Put a droplet somewhere on purpose (water pushed aside by a hand). */
  spawn(x, y, r) {
    // recycle the smallest sleeper
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < this.n; i += 3) {
      const sc = this.r[i] - this.sleep[i] * 0.001 + Math.abs(this.vy[i]) * 0.1;
      if (sc < bestScore) {
        bestScore = sc;
        best = i;
      }
    }
    const i = best;
    this.x[i] = this.px[i] = x;
    this.y[i] = this.py[i] = y;
    this.r[i] = r;
    this.vy[i] = 0;
    this.sleep[i] = 0;
    this.seed[i] = this.rnd() * 100;
  }

  step(dt, time, stamps) {
    const { n, x, y, px, py, vy, r, sleep, seed, wall } = this;
    const bay = wall.id < 2 ? BAY : wall.w;
    for (let i = 0; i < n; i++) {
      px[i] = x[i];
      py[i] = y[i];
      if (sleep[i] > 0) {
        sleep[i] -= dt;
        continue;
      }
      // the glass is not uniform: a droplet lets go only when it is heavier than the patch it sits on can hold
      const hold = 0.0019 + 0.0016 * vn(x[i] * 23.0 + seed[i], y[i] * 31.0);
      const running = r[i] > hold;
      if (running) {
        const vt = 0.05 * Math.pow(r[i] / 0.003, 2.0) * (0.55 + 0.9 * vn(x[i] * 9.0, y[i] * 14.0 + seed[i]));
        vy[i] += (-vt - vy[i]) * (1 - Math.exp(-3.5 * dt));
        r[i] -= Math.abs(vy[i]) * dt * 0.0016; // leaves water behind
      } else {
        vy[i] *= Math.exp(-9 * dt);
        r[i] += dt * 0.00005 * (0.5 + h1(seed[i])); // and swells again while it waits
      }
      const sp = Math.abs(vy[i]);
      if (sp > 1e-4) {
        y[i] += vy[i] * dt;
        // meander: follows invisible grain in the glass
        x[i] += (vn(y[i] * 26.0, seed[i]) - 0.5) * 0.9 * sp * dt;
        const fx = x[i] - Math.floor(x[i] / bay) * bay;
        const m = wall.id < 2 ? 0.035 : 0.06;
        if (fx < m) x[i] += m - fx;
        else if (fx > bay - m) x[i] -= fx - (bay - m);
      }
      if (y[i] < this.floorOf(py[i]) || r[i] < 0.0006) {
        this.respawn(i);
        continue;
      }
      if (sp > 0.002 && stamps.length < MAX_STAMPS) stamps.push(px[i], py[i], x[i], y[i], r[i] * 0.95, 1, 1, seed[i], 0);
    }
    // merging: the lower drop swallows the upper one and is suddenly heavy enough to run
    for (let i = 0; i < n; i++) {
      if (sleep[i] > 0) continue;
      for (let j = i + 1; j < n; j++) {
        if (sleep[j] > 0) continue;
        const dx = x[i] - x[j];
        if (dx > 0.012 || dx < -0.012) continue;
        const dy = y[i] - y[j];
        const rr = r[i] + r[j];
        if (dx * dx + dy * dy < rr * rr * 0.8) {
          const lo = y[i] < y[j] ? i : j;
          const hi = lo === i ? j : i;
          r[lo] = Math.min(0.0052, Math.cbrt(r[lo] ** 3 + r[hi] ** 3));
          this.respawn(hi);
        }
      }
    }
    const d = this.data;
    for (let i = 0; i < n; i++) {
      const vis = sleep[i] > 0 ? 0 : 1;
      d[i * 4] = x[i];
      d[i * 4 + 1] = y[i];
      d[i * 4 + 2] = r[i] * vis;
      d[i * 4 + 3] = Math.min(1.6, Math.abs(vy[i]) * 9.0);
    }
  }
}

export class Condensation {
  constructor(ctx, noiseTex) {
    this.ctx = ctx;
    const lvl = ctx.quality.level;
    const long = lvl >= 2 ? [2048, 384] : lvl === 1 ? [1536, 288] : [1024, 192];
    const end = lvl >= 1 ? [384, 480] : [256, 320];
    const fogBase = [0.8, 0.97, 0.95];
    const rnd = ctx.rng(71);
    this.walls = WALLS.map((w) => {
      const size = w.id === 2 ? end : long;
      const mk = () => ctx.createTarget({ size, type: THREE.HalfFloatType, filter: THREE.LinearFilter });
      return {
        ...w,
        size,
        a: mk(),
        b: mk(),
        dir: ctx.createTarget({ size: [size[0] / 2, size[1] / 2], type: THREE.HalfFloatType }),
        fogBase: fogBase[w.id],
        drops: new Drops(w.id === 2 ? 34 : lvl >= 1 ? 120 : 70, w, rnd),
        stamps: [],
        stroke: 0,
        pendingDt: 0,
        urgent: false,
      };
    });
    this.stepPass = new FSPass(STEP_FRAG, {
      tPrev: { value: null },
      tNoise: { value: noiseTex },
      uTexel: { value: new THREE.Vector2() },
      uWallSize: { value: new THREE.Vector2() },
      uDt: { value: 0 },
      uInit: { value: 0 },
      uFogBase: { value: 0.9 },
      uWall: { value: 0 },
      uPane: { value: null },
    });
    this.paneU = [0, 1, 2].map((i) => paneUniforms(i).uPane.value);
    // capsule stamps
    const geo = (this.stampGeo = new THREE.InstancedBufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.segArr = new Float32Array(MAX_STAMPS * 4);
    this.parArr = new Float32Array(MAX_STAMPS * 4);
    this.lenArr = new Float32Array(MAX_STAMPS);
    geo.setAttribute('aSeg', (this.segAttr = new THREE.InstancedBufferAttribute(this.segArr, 4).setUsage(THREE.DynamicDrawUsage)));
    geo.setAttribute('aPar', (this.parAttr = new THREE.InstancedBufferAttribute(this.parArr, 4).setUsage(THREE.DynamicDrawUsage)));
    geo.setAttribute('aLen', (this.lenAttr = new THREE.InstancedBufferAttribute(this.lenArr, 1).setUsage(THREE.DynamicDrawUsage)));
    const uniforms = (this.stampUniforms = { uWallSize: { value: new THREE.Vector2() }, tNoise: { value: noiseTex } });
    const mk = (dirPass) =>
      new THREE.ShaderMaterial({
        vertexShader: STAMP_VERT,
        fragmentShader: STAMP_FRAG,
        uniforms,
        defines: dirPass ? { DIR_PASS: 1 } : {},
        depthTest: false,
        depthWrite: false,
        transparent: true,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      });
    this.stampMat = mk(false);
    this.dirMat = mk(true);
    this.stampMesh = new THREE.Mesh(geo, this.stampMat);
    this.stampMesh.frustumCulled = false;
    this.stampMesh.renderOrder = 1;
    // the step and the stamps go into the target in ONE pass (cleared, never loaded): see the note in pyramid.js
    this.scene = new THREE.Scene();
    this.scene.add(this.stepPass.mesh, this.stampMesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.inited = false;
  }

  /** Current fog texture of a wall. */
  tex(i) {
    return this.walls[i].a.texture;
  }

  _clearDrops(w, s0, t0, s1, t1, radius) {
    // droplets under whatever touched the glass are simply gone
    const d = w.drops;
    const ax = s1 - s0;
    const ay = t1 - t0;
    const l2 = ax * ax + ay * ay;
    for (let j = 0; j < d.n; j++) {
      if (d.sleep[j] > 0) continue;
      const h = l2 > 1e-10 ? Math.max(0, Math.min(1, ((d.x[j] - s0) * ax + (d.y[j] - t0) * ay) / l2)) : 0;
      const dx = d.x[j] - (s0 + ax * h);
      const dy = d.y[j] - (t0 + ay * h);
      if (dx * dx + dy * dy < radius * radius) d.respawn(j);
    }
  }

  /** The body dragged from (s0,t0) to (s1,t1) on wall i: a narrow line. radius in metres. */
  wipe(i, s0, t0, s1, t1, radius, strength = 0.9) {
    const w = this.walls[i];
    if (w.stamps.length / 9 >= MAX_STAMPS - 8) return;
    w.urgent = true;
    const len = Math.hypot(s1 - s0, t1 - t0);
    w.stamps.push(s0, t0, s1, t1, radius, 0, strength, w.strokeSeed || 0.37, w.stroke);
    w.stroke += len;
    this._clearDrops(w, s0, t0, s1, t1, radius * 0.8);
  }

  /**
   * A wing laid against the fog: a fan from the hinge (s, t) along (dx, dy) (unit), `len` metres long.
   * Water lifted by the wing beads along the lower edge of the mark.
   */
  fan(i, s, t, dx, dy, len, strength = 0.9, water = 1) {
    const w = this.walls[i];
    if (w.stamps.length / 9 >= MAX_STAMPS - 8) return;
    w.urgent = true;
    const rnd = w.drops.rnd;
    w.stamps.push(s, t, s + dx * len, t + dy * len, len * 0.72, 2, strength, rnd(), 0);
    this._clearDrops(w, s + dx * len * 0.3, t + dy * len * 0.3, s + dx * len * 0.75, t + dy * len * 0.75, len * 0.42);
    const n = len * 26 * water;
    for (let k = 0; k < Math.floor(n + rnd()); k++) {
      const u = 0.25 + rnd() * 0.75;
      const big = rnd();
      w.drops.spawn(s + dx * len * u + (rnd() - 0.5) * len * 0.5, t + dy * len * u - len * (0.3 + rnd() * 0.3), 0.0012 + big * big * 0.0024);
    }
  }

  /** A foot set down at (s, t). */
  foot(i, s, t, r = 0.0022) {
    const w = this.walls[i];
    if (w.stamps.length / 9 >= MAX_STAMPS - 8) return;
    w.urgent = true;
    w.stamps.push(s, t, s + 1e-4, t, r, 3, 0.9, 0, 0);
  }

  /** A knock on the glass: every bead within `radius` swells past what its patch of glass can hold, and runs. */
  shake(i, s, t, radius) {
    const d = this.walls[i].drops;
    const r2 = radius * radius;
    for (let j = 0; j < d.n; j++) {
      if (d.sleep[j] > 0.6) continue;
      const dx = d.x[j] - s;
      const dy = d.y[j] - t;
      const q = dx * dx + dy * dy;
      if (q > r2) continue;
      d.sleep[j] = 0;
      d.r[j] = Math.min(0.0048, Math.max(d.r[j] * 1.3, 0.0031 + 0.001 * (1 - q / r2)));
      d.vy[j] = -0.02;
    }
  }

  /** Begin a new stroke (resets streak phase). */
  lift(i, seed) {
    const w = this.walls[i];
    w.stroke = 0;
    w.strokeSeed = seed;
  }

  /** seen: optional [left, right, end] — a wall nobody is looking at is advanced only every eighth frame. */
  step(renderer, dt, time, seen = null) {
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    const su = this.stepPass.uniforms;
    this.tick = (this.tick || 0) + 1;
    for (const w of this.walls) {
      if (dt > 0) w.drops.step(dt, time, w.stamps);
      // the fog itself changes slowly: each wall is advanced every other frame (with the time it missed), unless a
      // hand is on it right now
      w.pendingDt += dt;
      const every = seen && !seen[w.id] ? 8 : 2;
      if (this.inited && !w.urgent && dt > 0 && (this.tick + w.id) % every !== 0) continue;
      const wdt = w.pendingDt;
      w.pendingDt = 0;
      w.urgent = false;
      su.tPrev.value = w.a.texture;
      su.uTexel.value.set(1 / w.size[0], 1 / w.size[1]);
      su.uWallSize.value.set(w.w, w.h);
      su.uDt.value = wdt;
      su.uInit.value = this.inited ? 0 : 1;
      su.uFogBase.value = w.fogBase;
      su.uWall.value = w.id;
      su.uPane.value = this.paneU[w.id];
      const n = Math.min(MAX_STAMPS, w.stamps.length / 9);
      if (n > 0) {
        for (let k = 0; k < n; k++) {
          const o = k * 9;
          for (let j = 0; j < 4; j++) {
            this.segArr[k * 4 + j] = w.stamps[o + j];
            this.parArr[k * 4 + j] = w.stamps[o + 4 + j];
          }
          this.lenArr[k] = w.stamps[o + 8];
        }
        this.segAttr.needsUpdate = this.parAttr.needsUpdate = this.lenAttr.needsUpdate = true;
        this.stampGeo.instanceCount = n;
        this.stampUniforms.uWallSize.value.set(w.w, w.h);
      }
      this.stampMesh.visible = n > 0;
      this.stampMesh.material = this.stampMat;
      this.stepPass.mesh.visible = true;
      renderer.autoClear = true;
      renderer.setRenderTarget(w.b);
      renderer.render(this.scene, this.cam);
      renderer.autoClear = false;
      if (n > 0) {
        this.stepPass.mesh.visible = false;
        this.stampMesh.material = this.dirMat;
        renderer.setRenderTarget(w.dir);
        renderer.render(this.scene, this.cam);
        w.stamps.length = 0;
      }
      const t = w.a;
      w.a = w.b;
      w.b = t;
    }
    this.inited = true;
    renderer.autoClear = prevAuto;
  }

  dispose() {
    this.stepPass.dispose();
    this.stampGeo.dispose();
    this.stampMat.dispose();
    this.dirMat.dispose();
  }
}

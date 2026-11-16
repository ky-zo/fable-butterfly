// Where it has been. One thin ribbon of light along the whole of the butterfly's line, of which only the part already
// flown is drawn: brightest at the animal, fading with age, a little brighter wherever it corrected its course.
// The line is laid out once (it is a pure function of progress); the newest stretch is bent to the animal itself,
// which wanders off its line with time. A second copy, turned over in the waterline, is its image in still water.

import * as THREE from 'three';
import { LAND } from './chunks.js';

const VERT = /* glsl */ `
precision highp float;
attribute vec3 aNext;
attribute vec3 aData;        // progress here, side, how hard it was correcting its course
uniform float uHead;         // progress now
uniform vec3 uHeadPos;       // where the animal really is
uniform vec3 uHeadOff;       // … less where its line says
uniform vec2 uRes;
uniform float uPpm, uGain, uMirror, uStep;
uniform vec4 uShape;         // how long the bright part is (progress), how long the whole of it, least and greatest width (px)
varying vec3 vCol;
varying vec2 vEdge;
varying vec2 vSurf;
${LAND}
void main(){
  float u = aData.x;
  float age = uHead - u;
  vec3 P = position, Q = aNext;
  float k = exp(-max(age, 0.0) / 0.004);
  P += uHeadOff * k;
  Q += uHeadOff * k;
  // the line ends at the animal: everything not yet flown is gathered there, with no width
  bool ahead = age <= 0.0;
  if (ahead) { Q = uHeadPos; P = uHeadPos + (uHeadPos - position - uHeadOff) * 0.01 + vec3(0.0, 1e-5, 0.0); }
  if (uMirror > 0.5) { P.y = 2.0 * WATER - P.y; Q.y = 2.0 * WATER - Q.y; }
  vec4 v0 = viewMatrix * vec4(P, 1.0), v1 = viewMatrix * vec4(Q, 1.0);
  float d = -v0.z;
  vCol = vec3(0.0); vEdge = vec2(0.0, 1.0); vSurf = P.xz;
  vec4 c0 = projectionMatrix * v0;
  gl_Position = c0;
  if (d < 0.06 || age > uShape.y || age < -uStep) return;
  if (-v1.z < 0.06) v1 = mix(v0, v1, clamp((d - 0.06) / max(d + v1.z, 1e-5), 0.0, 1.0));
  vec4 c1 = projectionMatrix * v1;
  vec2 dir = (c1.xy / c1.w - c0.xy / c0.w) * uRes;
  float dl = length(dir);
  dir = dl > 1e-5 ? dir / dl : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float truePx = 0.011 * uPpm / d * (1.0 + 1.6 * k);
  float rs = uRes.y / 1080.0;
  float wpx = clamp(truePx, uShape.z * rs, uShape.w * rs);
  float fresh = exp(-max(age, 0.0) / uShape.x);
  float a = (0.2 + 0.8 * fresh) * (1.0 - smoothstep(uShape.y * 0.55, uShape.y, age)) * (1.0 + 1.6 * aData.z * (0.4 + 0.6 * fresh));
  a *= pow(min(truePx / wpx, 1.0), 0.45);                      // far away it is still a line, only fainter
  vec3 hue = mix(vec3(1.0, 0.34, 0.09), vec3(1.0, 0.58, 0.22), fresh);
  hue = mix(hue, vec3(1.0, 0.7, 0.36), k);
  vCol = hue * (a * uGain * 0.5 * (1.0 + 0.6 * k));
  float half_ = wpx * 2.4 + 0.75 * rs;
  vEdge = vec2(aData.y * half_, wpx);
  if (uMirror > 0.5) {
    // where on the water this part of the image lies (the line of sight through it meets the surface there)
    vec3 cw = cameraPosition;
    float t = (cw.y - WATER) / max(cw.y - P.y, 1e-4);
    vSurf = cw.xz + (P.xz - cw.xz) * t;
  }
  gl_Position.z -= 0.0004 * c0.w;
  gl_Position.xy += nrm * vEdge.x * 2.0 / uRes * c0.w;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uMirror;
varying vec3 vCol;
varying vec2 vEdge;
varying vec2 vSurf;
${LAND}
void main(){
  float x = abs(vEdge.x) / vEdge.y;
  // a hair of light with a little glow round it
  float prof = exp(-x * x * 2.2) + 0.07 * exp(-x * 1.1);
  float m = 1.0;
  if (uMirror > 0.5) m = smoothstep(0.0, 0.06, WATER - landSoft(vSurf, 0.0)) * 0.6;
#ifdef CORE
  // (the heart of the line is written into the depth buffer, so that the lens keeps it sharp where it is in focus)
  if (x > 0.55 || dot(vCol, vec3(1.0)) < 0.05) discard;
  prof = 0.0;
#endif
  gl_FragColor = vec4(vCol * prof * m, 0.0);
}`;

const GLOW_VERT = /* glsl */ `
precision highp float;
uniform vec3 uHeadPos;
uniform float uPpm, uGain;
varying vec2 vQ;
varying float vK;
void main(){
  vQ = position.xy * 2.0;
  vec4 vp = viewMatrix * vec4(uHeadPos, 1.0);
  // a small ember where the line is being drawn; never smaller on screen than a few pixels, and no brighter for it
  float r = 0.05;
  float px = r * uPpm / max(-vp.z, 0.1);
  float grow = max(1.0, 5.0 / px);
  vK = uGain / (grow * sqrt(grow)) * min(1.0, 30.0 / px);
  vp.xy += position.xy * 2.0 * r * grow;
  gl_Position = projectionMatrix * vp;
}`;
const GLOW_FRAG = /* glsl */ `
precision highp float;
varying vec2 vQ;
varying float vK;
void main(){
  float r2 = dot(vQ, vQ);
  float a = (exp(-r2 * 7.0) * 0.3 + exp(-r2 * 40.0) * 1.2) * vK;
  if (a < 0.001) discard;
  gl_FragColor = vec4(vec3(1.0, 0.7, 0.36) * a, 0.0);
}`;

export class Trail {
  /** @param plan from buildPlan   @param U the world's uniform bag (land uniforms, uRes, uPpm) */
  constructor(ctx, plan, U, { samples = 3200 } = {}) {
    this.ctx = ctx;
    this.plan = plan;
    this.samples = samples;
    this.uniforms = {
      ...U.land,
      uHead: { value: 0 },
      uHeadPos: { value: new THREE.Vector3() },
      uHeadOff: { value: new THREE.Vector3() },
      uRes: U.uRes,
      uPpm: U.uPpm,
      uGain: { value: 1 },
      uMirror: { value: 0 },
      uShape: { value: new THREE.Vector4(0.05, 0.62, 0.8, 1.9) },
      uStep: { value: (1 - plan.P_MIN) / samples },
    };
    this.group = new THREE.Group();
  }

  /** Lay the line out (in slices: it is a few thousand evaluations of the path). */
  async build() {
    const { ctx, plan } = this;
    const n = this.samples;
    const p0 = plan.P_MIN, p1 = 1;
    const pts = new Float32Array((n + 1) * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      plan.pathAt(p0 + ((p1 - p0) * i) / n, v);
      pts[i * 3] = v.x;
      pts[i * 3 + 1] = v.y;
      pts[i * 3 + 2] = v.z;
      if (i % 800 === 799) await ctx.yield();
    }
    // how hard it was turning at each point (per metre flown), smoothed
    const turn = new Float32Array(n + 1);
    for (let i = 2; i < n - 2; i++) {
      const ax = pts[i * 3] - pts[(i - 2) * 3], az = pts[i * 3 + 2] - pts[(i - 2) * 3 + 2];
      const bx = pts[(i + 2) * 3] - pts[i * 3], bz = pts[(i + 2) * 3 + 2] - pts[i * 3 + 2];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      turn[i] = la > 1e-5 && lb > 1e-5 ? Math.min(1, Math.abs(ax * bz - az * bx) / (la * lb) / (0.5 * (la + lb)) / 2.2) : 0;
    }
    const pos = new Float32Array((n + 1) * 2 * 3);
    const nxt = new Float32Array((n + 1) * 2 * 3);
    const dat = new Float32Array((n + 1) * 2 * 3);
    for (let i = 0; i <= n; i++) {
      const j = Math.min(i + 1, n);
      const u = p0 + ((p1 - p0) * i) / n;
      for (let s = 0; s < 2; s++) {
        const o = (i * 2 + s) * 3;
        pos.set([pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]], o);
        if (j > i) nxt.set([pts[j * 3], pts[j * 3 + 1], pts[j * 3 + 2]], o);
        else nxt.set([2 * pts[i * 3] - pts[(i - 1) * 3], 2 * pts[i * 3 + 1] - pts[(i - 1) * 3 + 1], 2 * pts[i * 3 + 2] - pts[(i - 1) * 3 + 2]], o);
        dat.set([u, s ? 1 : -1, turn[i]], o);
      }
    }
    const idx = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    const geo = ctx.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aNext', new THREE.BufferAttribute(nxt, 3));
    geo.setAttribute('aData', new THREE.BufferAttribute(dat, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const add = { transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
    const mat = ctx.track(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, ...add }));
    this.line = new THREE.Mesh(geo, mat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 30;
    const cmat = ctx.track(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, defines: { CORE: 1 }, ...add, depthWrite: true }));
    this.core = new THREE.Mesh(geo, cmat);
    this.core.frustumCulled = false;
    this.core.renderOrder = 29.5;
    // its image in the water (same line, turned over; drawn over the water's own colour, and only where there is water)
    const mu = { ...this.uniforms, uMirror: { value: 1 } };
    const mmat = ctx.track(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: mu, ...add, depthTest: false }));
    this.mirror = new THREE.Mesh(geo, mmat);
    this.mirror.frustumCulled = false;
    this.mirror.renderOrder = 2;
    const q = ctx.track(new THREE.PlaneGeometry(1, 1));
    const gmat = ctx.track(new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: this.uniforms, ...add }));
    this.glow = new THREE.Mesh(q, gmat);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 31;
    this.group.add(this.mirror, this.core, this.line, this.glow);
  }

  /** @param p progress   @param pos where the animal is   @param base where its line says it is */
  update(p, pos, base, gain) {
    const u = this.uniforms;
    u.uHead.value = p;
    u.uHeadPos.value.copy(pos);
    u.uHeadOff.value.copy(pos).sub(base);
    u.uGain.value = gain;
    const on = gain > 0.003;
    this.group.visible = on;
  }
}

// Dew on silk, and the dust in the air.
//
// Water on a thread does not stay a film: surface tension breaks it into beads one wavelength apart (the
// Rayleigh–Plateau instability; the fastest-growing wavelength is about nine times the film's radius), with a small
// satellite bead between each pair. So every dewy strand carries an even string of beads, each riding exactly on its
// strand (the same curve function as the ribbon), each a ball lens holding the room upside down, each with its own
// circle of confusion.

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { STRAND_GLSL } from './silk.js';
import { BACKDROP_GLSL } from './scene.js';
import { PAD, DROP, STRAND_BOTTOM, G } from './story.js';

const QUAD = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
const QUAD_IDX = [0, 1, 2, 2, 1, 3];

const LENS = /* glsl */ `
uniform float uFocus, uK, uMaxCoc, uPxPerM, uNearClip;
float cocOf(float d){ return min(uK * abs(1.0 - uFocus / max(d, uNearClip)), uMaxCoc); }
`;

const DEW_VERT = /* glsl */ `
precision highp float;
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iP;
attribute vec4 iD;               // where along the strand, radius (m), random, extra light
${hash}
${STRAND_GLSL}
${BACKDROP_GLSL}
${LENS}
varying vec2 vQ;
varying vec4 vR;                 // R px, radius px, blur fraction, light
varying vec3 vP;
varying vec3 vAvg;
void main(){
  int gi = int(iB.w + 0.5);
  vec4 g = uGroup[gi], gb = uGroupB[gi];
  float gT = clamp(g.z * 1.5 - 0.5 * iP.w, 0.0, 1.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (g.y <= 0.0005 || iD.x > gT - 0.01) return;
  Strand s = strandOf(iA, iB, iP);
  vec3 T;
  vec3 P = strandPoint(s, iD.x, T);
  float rm = iD.y * (1.0 - smoothstep(0.0, 0.3, gb.y));
  // a bead hangs a little under its thread; a plucked thread shakes it
  P.y -= rm * 0.3;
  vec4 vp = viewMatrix * vec4(P, 1.0);
  float d = -vp.z;
  if (d < uNearClip * 2.0 || rm <= 0.0) return;
  float rpx = rm * uPxPerM / d;
  float coc = cocOf(d);
  float R = max(rpx, 0.6) + coc;
  vec3 Vd = normalize(P - cameraPosition);
  // what it gathers: the light behind it, and a little of everything
  vec3 avg = backdrop(P, Vd) * 2.4 + backdrop(P, normalize(Vd + vec3(0.0, -0.5, 0.0))) * 0.8 + vec3(0.01, 0.014, 0.014);
  float tw = 0.75 + 0.5 * pow(0.5 + 0.5 * sin(uTime * (0.4 + 1.3 * iD.z) + iD.z * 50.0), 3.0);
  float light = (1.0 + iD.w) * tw * min(1.0, rpx / 0.6);
  float lum = dot(avg, vec3(0.3, 0.5, 0.2)) * light * rpx * rpx / (R * R);
  if (lum < 0.0016) return;
  vQ = position.xy;
  vR = vec4(R, rpx, coc / R, light);
  vP = P;
  vAvg = avg;
  vp.xy += position.xy * (R + 1.0) * d / uPxPerM;
  gl_Position = projectionMatrix * vp;
}`;

const DEW_FRAG = /* glsl */ `
precision highp float;
varying vec2 vQ;
varying vec4 vR;
varying vec3 vP;
varying vec3 vAvg;
uniform vec3 uCamR, uCamU, uCamB, uL1;
${BACKDROP_GLSL}
void main(){
  float R = vR.x, rpx = vR.y, cf = vR.z;
  float r = length(vQ) * (R + 1.0);
  // far out of focus: a disc of its gathered light, a little brighter at the rim
  float disc = clamp(R - r + 0.5, 0.0, 1.0) * (1.0 + 0.3 * smoothstep(3.0, 10.0, R) * smoothstep(0.6, 0.96, r / R));
  vec3 soft = vAvg * disc * rpx * rpx / (R * R);
  vec3 col = soft;
  if (cf < 0.72 && rpx > 1.2) {
    // in focus: a ball lens
    vec2 q = vQ * (R + 1.0) / rpx;
    float rr = dot(q, q);
    vec3 sharp = vec3(0.0);
    if (rr < 1.0) {
      float nz = sqrt(1.0 - rr);
      vec3 N = uCamR * q.x + uCamU * q.y + uCamB * nz;
      vec3 Vd = normalize(vP - cameraPosition);
      vec3 nt = uCamR * q.x + uCamU * q.y;
      // through the drop: the room, upside down and drawn in
      vec3 thru = backdrop(vP, normalize(Vd - 1.5 * nt)) * (1.6 + 2.6 * rr);
      // off the drop: the sky at the rim, and one point of the low light
      float fres = 0.02 + 0.98 * pow(1.0 - nz, 4.0);
      vec3 Rf = reflect(Vd, N);
      vec3 refl = backdrop(vP, normalize(vec3(Rf.xy, -abs(Rf.z) - 0.05))) * 2.0 + vec3(0.05, 0.075, 0.085) * max(Rf.y, 0.0);
      float glint = pow(max(dot(normalize(Vd - 1.1 * nt), uL1), 0.0), 60.0);
      sharp = thru * (1.0 - fres) + refl * fres * 2.0 + vec3(1.0, 0.72, 0.42) * glint * 2.2 + vec3(0.6, 0.75, 0.8) * pow(max(dot(N, normalize(vec3(-0.35, 0.8, 0.5))), 0.0), 90.0) * 0.9;
      sharp *= clamp((1.0 - sqrt(rr)) * rpx + 0.5, 0.0, 1.0);
    }
    col = mix(sharp, soft, smoothstep(0.3, 0.72, cf));
  }
  col *= vR.w;
  if (dot(col, vec3(1.0)) <= 0.0) discard;
  gl_FragColor = vec4(col, 1.0);
}`;

const MOTE_VERT = /* glsl */ `
precision highp float;
attribute vec4 iSeed;            // xyz place in the unit box, w random
uniform vec3 uCenter, uBox;
uniform float uTime, uGain, uWrap;
uniform vec4 uDawn;
${LENS}
varying vec2 vQ;
varying vec4 vCol;               // rgb light, a disc radius in px
void main(){
  float h = iSeed.w;
  vec3 base = iSeed.xyz * uBox;
  // slow fall, slower wander
  base += vec3(sin(uTime * 0.071 + h * 40.0) * 0.1 + uTime * 0.004, -uTime * (0.003 + 0.006 * h), cos(uTime * 0.053 + h * 71.0) * 0.1);
  vec3 rel = mod(base - uCenter * uWrap + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec3 P = uCenter + rel;
  vec3 e = 1.0 - smoothstep(0.36, 0.5, abs(rel) / uBox);
  float fade = e.x * e.y * e.z;
  vec4 vp = viewMatrix * vec4(P, 1.0);
  float d = -vp.z;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (d < 0.05 || fade < 0.01) return;
  float coc = min(cocOf(d), uMaxCoc * 0.3);
  float R = coc + 0.75;
  // a flake turning in the air: mostly dull, now and then it catches
  float tw = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(uTime * (0.5 + 1.7 * fract(h * 7.3)) + h * 50.0), 4.0);
  float size = 0.4 + 1.6 * h * h;
  // lit from low down by the dawn, from above by the panes
  vec3 light = vec3(1.0, 0.62, 0.3) * uDawn.z * exp(-max(P.y + 0.6, 0.0) * 0.9) + vec3(0.5, 0.66, 0.7) * 0.35 * uDawn.y;
  float flux = uGain * fade * tw * size * pow(1.0 / max(d, 0.08), 1.6) * smoothstep(0.05, 0.12, d);
  vCol = vec4(light * flux / (0.6 + pow(R, 1.7)), R);
  vQ = position.xy;
  vp.xy += position.xy * (R + 1.0) * d / uPxPerM;
  gl_Position = projectionMatrix * vp;
}`;

const MOTE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vQ;
varying vec4 vCol;
void main(){
  float R = vCol.a;
  float r = length(vQ) * (R + 1.0);
  float a = clamp(R - r + 0.5, 0.0, 1.0);
  a *= 1.0 + 0.35 * smoothstep(3.0, 10.0, R) * smoothstep(0.55, 0.95, r / R);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vCol.rgb * a, 1.0);
}`;

const ADDITIVE = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
  depthTest: true,
  depthWrite: false,
  transparent: true,
};

/** @param web from buildWeb: `beads` lists the strands that carry dew */
export function buildDew(ctx, shared, web, uDawn) {
  const level = ctx.quality.level;
  const rnd = ctx.rng(733);
  const quad = () => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(QUAD, 3));
    g.setIndex(QUAD_IDX);
    return ctx.track(g);
  };

  // ---- beads
  const A = [];
  const B = [];
  const P = [];
  const D = [];
  const cap = [2600, 4200, 6000][level];
  const put = (it, t, r, boost = 0) => {
    A.push(...it.A);
    B.push(...it.B);
    P.push(...it.P);
    D.push(t, r, rnd(), boost);
  };
  for (const { it, dew } of web.beads) {
    const isMain = it.B[3] === G.MAIN;
    // (a strand tied to the animal is measured as it hangs when the animal is at rest)
    const ax = it.A[3] >= 0 ? [0, 0, 0] : it.A;
    const L = Math.hypot(it.B[0] - ax[0], it.B[1] - ax[1], it.B[2] - ax[2]);
    const film = isMain ? 0.00165 : 0.0009 + 0.0009 * rnd();
    const lambda = 9.02 * film;
    const R = 1.89 * film;
    // the whole of the main strand is wet; the others only along a part of themselves
    const t0 = isMain ? 0.02 : 0.08 + 0.5 * rnd();
    const t1 = isMain ? 0.995 : Math.min(0.96, t0 + (0.12 + 0.3 * rnd()) * Math.min(1, 1.2 / L));
    const tDrop = (PAD.y - DROP.y) / (PAD.y - STRAND_BOTTOM);
    const n = Math.floor(((t1 - t0) * L) / lambda);
    const ph = rnd() * 6.28;
    for (let k = 0; k < n && D.length / 4 < cap; k++) {
      const t = t0 + ((k + 0.5) * lambda) / L;
      const env = isMain ? 1 : Math.sin((Math.PI * (k + 0.5)) / n);
      let r = R * (0.82 + 0.3 * Math.sin(k * 0.61 + ph) * Math.sin(k * 0.13 + ph * 2)) * (0.45 + 0.55 * env);
      // the heaviest bead has drunk its neighbours
      if (isMain) {
        const near = Math.abs(t - tDrop) * L;
        if (near < lambda * 0.5) continue;
        if (near < lambda * 3.2) r *= 0.3 + 0.2 * (near / (lambda * 3.2));
      }
      put(it, t, r, isMain ? 0.35 : 0);
      if (level > 0 || isMain) put(it, t + (0.5 * lambda) / L, r * 0.3, 0);
    }
    if (isMain) put(it, tDrop, 0.0112, 1.3);
  }
  const count = D.length / 4;
  const dg = quad();
  dg.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(A), 4));
  dg.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(B), 4));
  dg.setAttribute('iP', new THREE.InstancedBufferAttribute(new Float32Array(P), 4));
  dg.setAttribute('iD', new THREE.InstancedBufferAttribute(new Float32Array(D), 4));
  dg.instanceCount = count;
  const camU = { uCamR: { value: new THREE.Vector3() }, uCamU: { value: new THREE.Vector3() }, uCamB: { value: new THREE.Vector3() } };
  const dew = new THREE.Mesh(dg, ctx.track(new THREE.ShaderMaterial({ vertexShader: DEW_VERT, fragmentShader: DEW_FRAG, uniforms: { ...shared, uDawn, ...camU }, ...ADDITIVE })));
  dew.frustumCulled = false;
  dew.matrixAutoUpdate = false;

  // ---- dust
  const cloud = (n, box, wrap, gain, center) => {
    const g = quad();
    const seed = new Float32Array(n * 4);
    for (let k = 0; k < n * 4; k++) seed[k] = rnd();
    g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.instanceCount = n;
    const m = ctx.track(new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: { ...shared, uDawn, uCenter: { value: center }, uBox: { value: box }, uWrap: { value: wrap }, uGain: { value: gain } }, ...ADDITIVE }));
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    return mesh;
  };
  const camCenter = new THREE.Vector3();
  const near = cloud([500, 900, 1400][level], new THREE.Vector3(2.4, 2.0, 2.4), 1, 0.012, camCenter);
  const field = cloud([900, 1800, 3200][level], new THREE.Vector3(6, 5, 5), 0, 0.02, new THREE.Vector3(0, 0.6, -0.8));

  const group = new THREE.Scene();
  group.add(field, near, dew);
  return {
    group,
    count,
    setCamera(cam) {
      camCenter.copy(cam.position);
      const e = cam.matrixWorld.elements;
      camU.uCamR.value.set(e[0], e[1], e[2]);
      camU.uCamU.value.set(e[4], e[5], e[6]);
      camU.uCamB.value.set(e[8], e[9], e[10]);
    },
  };
}

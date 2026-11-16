// Turf. Short grass in tufts, wherever the ground shader says there is turf. Only the near field is ever drawn (a blade
// is a few millimetres wide): one square of tufts, wrapped round wherever the lens is looking; further off the ground's
// own colour stands in for it. Each blade takes what light there is on one side and passes a
// little through to the other, so that against the lamp, and against the morning, the turf has a lit edge.

import * as THREE from 'three';
import { LAND, AIR } from './chunks.js';

const VERT = /* glsl */ `
precision highp float;
attribute vec4 aI;        // tuft: x, z, seed, size
attribute vec4 aV;        // blade: which way it leans (rad), how far up it this vertex is, side, random
uniform sampler2D tGrain;
uniform float uReach, uPpm, uWin;
uniform vec3 uCentre;
varying vec3 vW;
varying vec3 vN;
varying vec3 vK;          // how far up the blade, the blade's random, fade
${LAND}
${AIR}
void main(){
  float t = aV.y;
  float rb = fract(aV.w * 7.13 + aI.z * 3.7);
  float a = aV.x + aI.z * 6.2832;
  vec2 dir = vec2(cos(a), sin(a));
  // the tufts are laid out once over one square of ground, and the square is wrapped round wherever the lens is looking
  vec2 tuft = uCentre.xz + mod(aI.xy - uCentre.xz + 0.5 * uWin, uWin) - 0.5 * uWin;
  vec2 xz = tuft + dir * (0.006 + 0.02 * rb);
  vec4 L = land(xz);
  // the same patches of turf the ground is painted with
  float gA = texture2D(tGrain, xz * 0.11 + 0.3).z, gB = texture2D(tGrain, xz * 0.47).z;
  float slope = length(L.yz);
  float rock = smoothstep(0.75, 1.2, slope + (gB - 0.5) * 0.7);
  float turf = (1.0 - rock) * smoothstep(0.22, 0.4, gA + (gB - 0.5) * 0.4);
  float dist = length(vec3(xz.x, L.x, xz.y) - uCam);
  float fade = (1.0 - smoothstep(uReach * 0.62, uReach, length(tuft - uCentre.xz))) * step(WATER + 0.12, L.x);
  float hgt = (0.04 + 0.09 * rb + 0.14 * step(0.95, rb)) * aI.w * (0.3 + 0.7 * turf) * fade * step(0.12, turf);
  float lean = 0.25 + 0.6 * fract(rb * 5.3);
  // the air is never quite still
  float w = 0.012 * sin(uTime * 1.3 + xz.x * 1.7 + xz.y * 1.1) + 0.006 * sin(uTime * 2.9 + xz.x * 4.1);
  vec2 bend = dir * (lean * t * t) + vec2(w, w * 0.6) * t * t * 6.0;
  vec3 P = vec3(xz.x, L.x, xz.y) + vec3(bend.x * hgt, hgt * t * (1.0 - 0.25 * lean * t), bend.y * hgt);
  vec2 across = vec2(-dir.y, dir.x);
  float wid = (0.0022 + 0.0022 * rb) * aI.w * (1.0 - t * 0.85);
  // (never thinner on screen than most of a pixel: it goes fainter instead)
  float px = wid * uPpm / max(dist, 0.1);
  float grow = max(1.0, 0.55 / max(px, 1e-4));
  P.xz += across * aV.z * wid * grow;
  vW = P;
  vec3 tan_ = normalize(vec3(bend.x * 2.0 * 1.0, 1.0, bend.y * 2.0));
  vN = normalize(cross(vec3(across.x, 0.0, across.y), tan_));
  vK = vec3(t, rb, min(1.0, 1.0 / grow) * step(0.001, hgt));
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vW;
varying vec3 vN;
varying vec3 vK;
uniform vec3 uSkyUp, uKeyDir, uKeyCol;
${AIR}
void main(){
  if (vK.z < 0.02) discard;
  vec3 V = normalize(uCam - vW);
  vec3 N = normalize(vN);
  if (dot(N, V) < 0.0) N = -N;
  float t = vK.x;
  // dark where the blades stand close together at the root, paler and drier toward the tip
  vec3 alb = mix(vec3(0.022, 0.04, 0.027), vec3(0.06, 0.09, 0.055), t) * (0.65 + 0.7 * vK.y);
  float occ = 0.22 + 0.78 * t;
  vec3 col = alb * uSkyUp * (0.5 + 0.5 * N.y) * occ;
  col += alb * uKeyCol * (0.25 + 0.75 * abs(dot(N, uKeyDir))) * occ;
  col += uKeyCol * pow(max(dot(N, normalize(uKeyDir + V)), 0.0), 16.0) * 0.25 * t;
  vec3 tl = uLamp.xyz - vW;
  float r2 = dot(tl, tl);
  vec3 Ld = tl * inversesqrt(r2);
  vec3 E = uLampCol * (uLamp.w * 5.0 / (1.0 + r2 * 0.3)) * occ;
  // a blade is thin: lit on one face, it glows on the other
  col += E * alb * (max(dot(N, Ld), 0.0) + 0.7 * max(dot(-N, Ld), 0.0) * vec3(0.8, 1.0, 0.45));
  col += E * pow(max(dot(N, normalize(Ld + V)), 0.0), 30.0) * 0.03 * t;
  col += uSunCol * occ * (alb * (max(dot(N, uSunDir), 0.0) + 0.9 * max(dot(-N, uSunDir), 0.0) * vec3(0.8, 1.0, 0.4)) + pow(max(dot(N, normalize(uSunDir + V)), 0.0), 30.0) * 0.05 * t);
  col = applyAir(col, -V, length(uCam - vW));
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * @param U     the world's uniform bag
 */
export async function makeGrass(ctx, U, tGrain, { tufts = 30000, blades = 3, win = 12 } = {}) {
  const rnd = ctx.rng(57);
  const inst = new Float32Array(tufts * 4);
  for (let i = 0; i < tufts; i++) {
    inst.set([rnd() * win, rnd() * win, rnd(), 0.75 + 0.6 * rnd()], i * 4);
    if (i % 12000 === 11999) await ctx.yield();
  }
  const n = tufts;
  // one tuft: a few blades, each a tapering strip of four cross-sections
  const LV = 4;
  const vv = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const ang = (b / blades) * 6.2832 + 0.7 * b;
    const r = (b * 0.618034) % 1;
    const base = vv.length / 4;
    for (let l = 0; l < LV; l++) {
      const t = l / (LV - 1);
      if (l < LV - 1) vv.push(ang, t, -1, r, ang, t, 1, r);
      else vv.push(ang, t, 0, r);
    }
    for (let l = 0; l < LV - 2; l++) {
      const a = base + l * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const a = base + (LV - 2) * 2;
    idx.push(a, a + 1, a + 2);
  }
  const geo = ctx.track(new THREE.InstancedBufferGeometry());
  geo.setAttribute('aV', new THREE.BufferAttribute(new Float32Array(vv), 4));
  geo.setIndex(idx);
  geo.setAttribute('aI', new THREE.InstancedBufferAttribute(inst.subarray(0, n * 4), 4));
  geo.instanceCount = n;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = ctx.track(
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...U.land, ...U.air, tGrain: { value: tGrain }, uSkyUp: U.uSkyUp, uKeyDir: U.uKeyDir, uKeyCol: U.uKeyCol, uPpm: U.uPpm, uReach: { value: win * 0.5 }, uWin: { value: win }, uCentre: { value: new THREE.Vector3() } },
      side: THREE.DoubleSide,
    }),
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.centre = mat.uniforms.uCentre.value;
  mesh.reach = win * 0.5;
  return mesh;
}

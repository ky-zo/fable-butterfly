// The far shore: a slope coming up out of the water, low at its left end and climbing to the right, and one warm light
// low on it. It is a silhouette and nothing else for most of the approach — it comes out of the haze late.
//
// The land is one analytic height function, used three ways: the mesh (vertex shader), the water (which mirrors it
// and stands in its moon-shadow: a cut-out card at one depth is enough for both), and the plan (shots.js puts the
// light on it).

import * as THREE from 'three';
import { NOISE_GLSL, COMMON_GLSL } from './shared.js';
import { SHORE_Z, LAMP } from './shots.js';

const f = (x) => {
  const t = Number(x).toFixed(4);
  return t.includes('.') ? t : t + '.0';
};

const W = 80; // how slowly the near slope flattens (m)
const CARD_D = 70; // depth behind the waterline at which the land is taken as a cut-out card
const ss = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** amplitude of the near slope and of the ridge behind it, along the shore */
export const landA = (x) => (2.2 + 19.2 * ss(-10, 4, x) + 6 * ss(4, 70, x)) * ss(-175, -95, x);
export const landB = (x) => 7 * ss(-9, 22, x) + 8 * ss(15, 110, x);
const shoreZ = (x) => SHORE_Z + 2.4 * (Math.sin(0.045 * x) + 0.4 * Math.sin(0.17 * x));
/** Height of the ground at (x, z), without its small roughness. */
export function landHeight(x, z) {
  const d = shoreZ(x) - z;
  if (d <= 0) return -0.4;
  return landA(x) * (1 - Math.exp(-d / W)) + landB(x) * ss(22, 105, d);
}

/** GLSL: landCard(x) = height of the land's outline, landShade(P, dir) = 0 where a ray from P along dir meets land. */
export const LAND_GLSL = /* glsl */ `
#ifndef CORPUS_LAND
#define CORPUS_LAND
float landA(float x){ return (2.2 + 19.2 * smoothstep(-10.0, 4.0, x) + 6.0 * smoothstep(4.0, 70.0, x)) * smoothstep(-175.0, -95.0, x); }
float landB(float x){ return 7.0 * smoothstep(-9.0, 22.0, x) + 8.0 * smoothstep(15.0, 110.0, x); }
float landCard(float x){ return landA(x) * ${f(1 - Math.exp(-CARD_D / W))} + landB(x) * ${f(ss(22, 105, CARD_D))}; }
// 1 = a ray from P along dir clears the land, 0 = it runs into it; soft: how wide the edge is (as a slope)
float landClear(vec3 P, vec3 dir, float soft){
  if (dir.z > -0.02) return 1.0;
  float t = (${f(SHORE_Z - CARD_D)} - P.z) / dir.z;
  float h = P.y + dir.y * t;
  float top = landCard(P.x + dir.x * t);
  return smoothstep(-soft, soft, (h - top) / t);
}
#endif
`;

const VERT = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec3 vWorld;
varying vec3 vN;
varying float vD;
${NOISE_GLSL}
${LAND_GLSL}
float shoreZ(float x){ return ${f(SHORE_Z)} + 2.4 * (sin(0.045 * x) + 0.4 * sin(0.17 * x)); }
float ground(vec2 q){
  float d = shoreZ(q.x) - q.y;
  if (d <= 0.0) return -0.4 + d * 0.05;
  float h = landA(q.x) * (1.0 - exp(-d / ${f(W)})) + landB(q.x) * smoothstep(22.0, 105.0, d);
  // rock at the water, scrub and then trees further up: the outline is never a clean curve
  vec4 n1 = noise4(q * 0.11), n2 = noise4(q * 0.47 + 7.0), n3 = noise4(q * 1.7 + 3.0);
  float rough = smoothstep(0.0, 6.0, d);
  h += (n1.r - 0.5) * 2.6 * rough * smoothstep(0.0, 8.0, h) + (n2.g - 0.35) * 1.5 * smoothstep(12.0, 40.0, d) * smoothstep(1.0, 6.0, h) + (n3.b - 0.5) * 0.34 * rough;
  // (trees on the upper slope: crowns a few metres across, which is what makes the skyline ragged)
  vec4 n4 = noise4(q * 0.9 + 11.0);
  h += smoothstep(0.42, 0.75, n4.r) * 1.9 * smoothstep(26.0, 60.0, d) * smoothstep(4.0, 9.0, h);
  h += (n2.r - 0.3) * 0.5 * (1.0 - smoothstep(0.0, 7.0, d));
  return h;
}
void main(){
  vec2 q = position.xz;
  float h = ground(q);
  float e = 0.6;
  vN = normalize(vec3(h - ground(q + vec2(e, 0.0)), e, h - ground(q + vec2(0.0, e))));
  vWorld = vec3(q.x, h, q.y);
  vD = shoreZ(q.x) - q.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vN;
varying float vD;
${NOISE_GLSL}
${COMMON_GLSL}
void main(){
  vec3 tc = uCam - vWorld;
  float dist = length(tc);
  vec3 V = tc / dist;
  vec3 N = normalize(vN);
  vec4 n = noise4(vWorld.xz * 2.3);
  // night: what the sky gives a dark slope, a little more on what faces up; wet rock at the waterline is paler
  float wet = 1.0 - smoothstep(0.0, 1.6, vWorld.y);
  vec4 nb = noise4(vWorld.xz * 0.31 + 5.0);
  // scrub and grass in patches, bare ground between them, pale rock at the water
  vec3 alb = mix(vec3(0.020, 0.026, 0.022), vec3(0.046, 0.044, 0.04), smoothstep(0.35, 0.65, nb.g));
  alb = mix(alb, vec3(0.075, 0.08, 0.085), wet) * (0.5 + 1.0 * n.r) * (0.7 + 0.6 * nb.r);
  vec3 c = alb * vec3(0.012, 0.019, 0.034) * (0.35 + 0.65 * max(N.y, 0.0)) * 3.0;
  // the moon is behind the land: only what leans toward it catches any
  c += alb * uMoonCol * 0.35 * max(dot(N, uMoonDir), 0.0);
  // the lamp's pool of light on the ground around it
  vec3 tl = uLamp.xyz - vWorld;
  float r2 = dot(tl, tl);
  float pool = uLamp.w * (0.6 * exp(-r2 / 9.0) + 0.02 / (1.0 + r2 * 0.02)) * (0.2 + 0.8 * max(dot(N, tl) * inversesqrt(r2 + 1e-4), 0.0));
  c += alb * vec3(1.0, 0.50, 0.17) * pool * 22.0;
  // haze: far land is the colour of the sky behind it, and all of it is until late in the crossing
  float a = uLand * exp(-dist / 620.0);
  gl_FragColor = vec4(c * a, a);
}`;

const LAMP_VERT = /* glsl */ `
precision highp float;
uniform vec4 uLamp;
uniform float uPpm;
varying vec2 vQ;
varying float vK;
void main(){
  vQ = position.xy * 2.0;
  vec4 vp = viewMatrix * vec4(uLamp.xyz, 1.0);
  // a small flame behind glass; never smaller on screen than a few pixels, and no brighter for being drawn larger
  float r = 0.11;
  float px = r * uPpm / max(-vp.z, 0.1);
  float grow = max(1.0, 2.6 / px);
  vK = 1.0 / (grow * grow);
  vp.xy += position.xy * 2.0 * r * grow * 3.0;
  gl_Position = projectionMatrix * vp;
}`;
const LAMP_FRAG = /* glsl */ `
precision highp float;
uniform vec4 uLamp;
varying vec2 vQ;
varying float vK;
void main(){
  float r = length(vQ) * 3.0;
  float core = exp(-r * r * 1.6);
  float halo = exp(-r * 1.9) * 0.05;
  float a = (core * vK + halo) * uLamp.w;
  if (a < 0.0005) discard;
  gl_FragColor = vec4(vec3(1.0, 0.52, 0.17) * a * 30.0 + vec3(1.0, 0.85, 0.6) * core * core * vK * uLamp.w * 22.0, 0.0);
}`;

/** The land and the light. Returns a group; everything GPU-side is tracked. */
export function makeShore(ctx, U) {
  const lv = ctx.quality.level;
  const x0 = -180;
  const x1 = 250;
  const nx = [150, 230, 320][lv];
  // rows: close together at the waterline, opening out up the slope
  const rows = [];
  const nd = [40, 56, 72][lv];
  for (let j = 0; j <= nd; j++) {
    const t = j / nd;
    rows.push(-4 + 184 * t * (0.3 + 0.7 * t));
  }
  const pos = new Float32Array((nx + 1) * rows.length * 3);
  let o = 0;
  for (let j = 0; j < rows.length; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      pos[o++] = x;
      pos[o++] = 0;
      pos[o++] = shoreZ(x) - rows[j];
    }
  }
  const idx = new Uint32Array(nx * (rows.length - 1) * 6);
  o = 0;
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx[o++] = a;
      idx[o++] = b;
      idx[o++] = c;
      idx[o++] = b;
      idx[o++] = d;
      idx[o++] = c;
    }
  }
  const geo = ctx.track(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const mat = ctx.track(
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: U,
      side: THREE.DoubleSide,
      // (drawn over the sky and before the stars: it hides them even while it is still mostly haze)
      transparent: true,
      depthWrite: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    }),
  );
  const land = new THREE.Mesh(geo, mat);
  land.frustumCulled = false;
  land.renderOrder = -1;

  const lgeo = ctx.track(new THREE.PlaneGeometry(1, 1));
  const lmat = ctx.track(
    new THREE.ShaderMaterial({
      vertexShader: LAMP_VERT,
      fragmentShader: LAMP_FRAG,
      uniforms: U,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    }),
  );
  const lamp = new THREE.Mesh(lgeo, lmat);
  lamp.frustumCulled = false;
  lamp.renderOrder = 6;

  const group = new THREE.Group();
  group.add(land, lamp);
  return { group, land, lamp, lampPos: LAMP };
}

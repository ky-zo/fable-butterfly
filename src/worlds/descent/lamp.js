// The lamp: a storm lantern hung from an iron crook driven into the turf, just above the water. A flame behind glass.
// Everything it does to the land, the water, the air and the wings is done by whoever draws those (they read uLamp);
// here is only the thing itself, and the small hard disc of light it is from far away.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AIR } from './chunks.js';

const SOLID_VERT = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
varying vec3 vC;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vC = color;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SOLID_FRAG = /* glsl */ `
precision highp float;
varying vec3 vW;
varying vec3 vN;
varying vec3 vC;
uniform vec3 uSkyUp;
uniform float uFlame;
${AIR}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  if (dot(N, V) < 0.0) N = -N;
  // weathered iron and old wood: lit by its own flame from very close, by the sky, and in the morning by the sun
  float n = hash13(floor(vW * 90.0)) * 0.5 + hash13(floor(vW * 31.0)) * 0.5;
  vec3 alb = vC * (0.6 + 0.8 * n);
  vec3 col = alb * uSkyUp * (0.45 + 0.55 * N.y);
  vec3 tl = uLamp.xyz - vW;
  float r2 = dot(tl, tl);
  vec3 L = tl * inversesqrt(r2);
  vec3 E = uLampCol * (uLamp.w * uFlame / (0.02 + r2 * 6.0));
  float ndl = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  col += E * (alb * ndl + pow(max(dot(N, H), 0.0), 24.0) * 0.05 * step(0.0, dot(N, L)));
  col += uSunCol * (alb * max(dot(N, uSunDir), 0.0) + pow(max(dot(N, normalize(uSunDir + V)), 0.0), 24.0) * 0.04);
  col = applyAir(col, -V, length(uCam - vW));
  gl_FragColor = vec4(col, 1.0);
}`;

const GLASS_FRAG = /* glsl */ `
precision highp float;
varying vec3 vW;
varying vec3 vN;
varying vec3 vC;
uniform vec3 uSkyUp;
uniform float uFlame;
${AIR}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  float ndv = abs(dot(N, V));
  // smoked a little by the flame; a cold edge from the sky, and the flame's own glow in the thickness of it
  float edge = pow(1.0 - ndv, 3.0);
  vec3 col = skyBase(reflect(-V, N * sign(dot(N, V)))) * (0.4 + 3.0 * edge) + uLampCol * uLamp.w * uFlame * (0.05 + 0.7 * edge);
  gl_FragColor = vec4(col, 0.0);
}`;

const FLAME_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vQ;
void main(){
  vQ = uv;
  vec3 p = position;
  // it leans and licks, a little
  float k = uv.y * uv.y;
  p.x += k * 0.012 * sin(uTime * 7.3 + 1.0) + k * 0.006 * sin(uTime * 17.0);
  p.z += k * 0.01 * sin(uTime * 5.9 + 2.0);
  p.y *= 1.0 + 0.06 * sin(uTime * 11.0) * uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FLAME_FRAG = /* glsl */ `
precision highp float;
uniform vec4 uLamp;
uniform float uFlame;
varying vec2 vQ;
void main(){
  // blue at the wick, white in the body, orange at the tip
  vec3 c = mix(vec3(1.0, 0.86, 0.6), vec3(1.0, 0.5, 0.14), smoothstep(0.35, 1.0, vQ.y));
  c = mix(vec3(0.25, 0.4, 1.0) * 0.35, c, smoothstep(0.0, 0.2, vQ.y));
  gl_FragColor = vec4(c * 38.0 * uLamp.w * uFlame, 1.0);
}`;

const GLOW_VERT = /* glsl */ `
precision highp float;
uniform vec4 uLamp;
uniform float uPpm;
varying vec2 vQ;
varying float vK;
void main(){
  vQ = position.xy * 2.0;
  vec4 vp = viewMatrix * vec4(uLamp.xyz, 1.0);
  // never smaller on screen than a few pixels, and no brighter for being drawn larger
  float r = 0.07;
  float px = r * uPpm / max(-vp.z, 0.1);
  float grow = max(1.0, 3.0 / px);
  vK = 1.0 / (grow * grow);
  vp.xy += position.xy * 2.0 * r * grow * 4.0;
  gl_Position = projectionMatrix * vp;
}`;
const GLOW_FRAG = /* glsl */ `
precision highp float;
uniform vec4 uLamp;
uniform vec3 uLampCol;
uniform float uFlame, uFar;
varying vec2 vQ;
varying float vK;
void main(){
  float r = length(vQ) * 4.0;
  float core = exp(-r * r * 1.2);
  float halo = exp(-r * 1.6) * 0.035 + 0.008 / (1.0 + r * r * 3.0);
  // (the core is only for when the lantern itself is too small to see: close to, the flame does this)
  float a = (core * vK * uFar + halo) * uLamp.w * uFlame;
  if (a < 0.0004) discard;
  gl_FragColor = vec4(uLampCol * a * 26.0 + vec3(1.0, 0.85, 0.6) * core * core * vK * uFar * uLamp.w * 20.0, 0.0);
}`;

const lathe = (profile, seg, col) => {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  return paint(g, col);
};
function paint(g, col) {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g.index ? g.toNonIndexed() : g;
}

/**
 * @param U    the world's uniform bag (uLamp … uPpm, uSkyUp, and the AIR set)
 * @param plan LAMP = the flame, POST = the foot of the post
 */
export function makeLamp(ctx, U, plan) {
  const { LAMP, POST } = plan;
  const IRON = [0.02, 0.019, 0.018];
  const BRASS = [0.07, 0.05, 0.022];
  const parts = [];
  // a shepherd's crook of iron rod, driven into the ground: up, over, and down to a hook
  const top = new THREE.Vector3(POST.x - 0.02, LAMP.y + 0.5, POST.z + 0.015);
  const foot = new THREE.Vector3(POST.x - 0.05, POST.y - 0.3, POST.z - 0.02);
  const hook = new THREE.Vector3(LAMP.x, LAMP.y + 0.3, LAMP.z);
  {
    const curve = new THREE.CatmullRomCurve3([
      foot,
      new THREE.Vector3(POST.x - 0.035, POST.y + 0.4, POST.z),
      new THREE.Vector3(top.x - 0.01, top.y - 0.3, top.z),
      new THREE.Vector3(top.x + 0.03, top.y + 0.02, top.z),
      new THREE.Vector3(top.x + 0.2, top.y + 0.12, top.z),
      new THREE.Vector3(hook.x - 0.06, top.y + 0.1, top.z * 0.5 + hook.z * 0.5),
      new THREE.Vector3(hook.x + 0.014, hook.y + 0.07, hook.z),
      new THREE.Vector3(hook.x, hook.y + 0.005, hook.z),
      new THREE.Vector3(hook.x - 0.024, hook.y + 0.014, hook.z),
    ]);
    parts.push(paint(new THREE.TubeGeometry(curve, 72, 0.0085, 7, false), IRON));
  }
  // the lantern, about its flame
  const at = (g, dy = 0) => g.translate(LAMP.x, LAMP.y + dy, LAMP.z);
  parts.push(at(lathe([[0.0, -0.175], [0.062, -0.175], [0.068, -0.165], [0.068, -0.115], [0.05, -0.098], [0.028, -0.09], [0.028, -0.07], [0.036, -0.066], [0.036, -0.058], [0.0, -0.058]], 20, BRASS)));
  parts.push(at(lathe([[0.0, 0.118], [0.04, 0.118], [0.05, 0.128], [0.05, 0.14], [0.026, 0.165], [0.026, 0.205], [0.04, 0.212], [0.044, 0.222], [0.0, 0.232]], 20, IRON)));
  // two side tubes and the wire guard round the glass
  for (const sx of [-1, 1]) {
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(sx * 0.06, -0.12, 0), new THREE.Vector3(sx * 0.082, -0.05, 0), new THREE.Vector3(sx * 0.084, 0.07, 0), new THREE.Vector3(sx * 0.05, 0.16, 0), new THREE.Vector3(sx * 0.03, 0.2, 0)]);
    parts.push(at(paint(new THREE.TubeGeometry(c, 16, 0.007, 6, false), IRON)));
    const w = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.05, sx * 0.045), new THREE.Vector3(0, 0.03, sx * 0.07), new THREE.Vector3(0, 0.11, sx * 0.045)]);
    parts.push(at(paint(new THREE.TubeGeometry(w, 10, 0.002, 4, false), IRON)));
  }
  // the bail it hangs by
  {
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.05, 0.16, 0), new THREE.Vector3(-0.06, 0.24, 0), new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0.06, 0.24, 0), new THREE.Vector3(0.05, 0.16, 0)]);
    parts.push(at(paint(new THREE.TubeGeometry(c, 20, 0.0028, 5, false), IRON)));
  }
  const solidGeo = ctx.track(mergeGeometries(parts.map((g) => { const o = new THREE.BufferGeometry(); for (const k of ['position', 'normal', 'color']) o.setAttribute(k, g.attributes[k]); return o; })));
  for (const g of parts) g.dispose();
  const flame = { value: 1 };
  const uniforms = { ...U.air, uSkyUp: U.uSkyUp, uFlame: flame, uPpm: U.uPpm, uFar: { value: 1 } };
  const solid = new THREE.Mesh(solidGeo, ctx.track(new THREE.ShaderMaterial({ vertexShader: SOLID_VERT, fragmentShader: SOLID_FRAG, uniforms, vertexColors: true, side: THREE.DoubleSide })));
  solid.renderOrder = 4;

  const glassGeo = ctx.track(at(lathe([[0.03, -0.058], [0.05, -0.03], [0.062, 0.02], [0.058, 0.07], [0.042, 0.105], [0.036, 0.118]], 24, [1, 1, 1])));
  const add = { transparent: true, depthTest: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
  const glass = new THREE.Mesh(glassGeo, ctx.track(new THREE.ShaderMaterial({ vertexShader: SOLID_VERT, fragmentShader: GLASS_FRAG, uniforms, vertexColors: true, side: THREE.DoubleSide, ...add })));
  glass.renderOrder = 22;

  const fgeo = ctx.track(new THREE.LatheGeometry([[0.0, 0.0], [0.011, 0.008], [0.014, 0.022], [0.009, 0.042], [0.003, 0.06], [0.0, 0.07]].map(([r, y]) => new THREE.Vector2(r, y)), 10));
  {
    // v runs up the flame
    const uv = fgeo.attributes.uv, p = fgeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), p.getY(i) / 0.07);
  }
  const fl = new THREE.Mesh(fgeo, ctx.track(new THREE.ShaderMaterial({ vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, uniforms: { uTime: U.air.uTime, uLamp: U.air.uLamp, uFlame: flame } })));
  fl.position.set(LAMP.x, LAMP.y - 0.045, LAMP.z);
  fl.renderOrder = 5;

  const glow = new THREE.Mesh(ctx.track(new THREE.PlaneGeometry(1, 1)), ctx.track(new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms, ...add })));
  glow.renderOrder = 23;

  const group = new THREE.Group();
  group.add(solid, fl, glass, glow);
  for (const m of group.children) m.frustumCulled = false;
  return { group, flame, far: uniforms.uFar };
}

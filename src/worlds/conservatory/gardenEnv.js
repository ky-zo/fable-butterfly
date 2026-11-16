// What surrounds the plants: the late sky with its treeline, and the ground. Both write q (see layout.js) into alpha
// like every other garden surface, so the glass can treat them as "infinitely far behind".

import * as THREE from 'three';
import { hash, noise, fbm } from '../../core/glsl.js';
import { FSPass } from '../../core/Pass.js';
import { layoutGLSL, HW, Y0, ZE, ZBACK } from './layout.js';
import { sunGLSL } from './sun.js';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vec4 v = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vDir = (inverse(viewMatrix) * vec4(v.xyz / v.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

export const skyGLSL = /* glsl */ `
vec3 skyColor(vec3 d){
  float e = d.y;
  vec2 dh = normalize(d.xz + 1e-5), lh = normalize(SUN_DIR.xz);
  float az = dot(dh, lh);
  float sd = max(dot(d, SUN_DIR), 0.0);
  vec3 zen = vec3(0.16, 0.30, 0.52) * 1.5;
  vec3 hSun = vec3(2.4, 1.5, 0.72);
  vec3 hAnti = vec3(0.34, 0.42, 0.52);
  vec3 hor = mix(hAnti, hSun, pow(0.5 + 0.5 * az, 2.5));
  vec3 c = mix(hor, zen, pow(smoothstep(-0.02, 0.7, e), 0.55));
  // thin high cloud catching the last light
  vec2 cp = d.xz / max(e + 0.25, 0.08);
  float cl = fbm(cp * 0.9 + vec2(3.1, 0.0), 4);
  cl = smoothstep(0.5, 0.82, cl) * smoothstep(0.02, 0.3, e);
  c = mix(c, mix(vec3(1.5, 1.25, 1.0), vec3(3.4, 2.1, 1.1), pow(0.5 + 0.5 * az, 2.0)), cl * 0.55);
  c += SUN_COL * (0.02 * pow(sd, 6.0) + 0.16 * pow(sd, 48.0) + 3.5 * smoothstep(0.9993, 0.99975, sd));
  return c;
}
// The forest beyond the planting, as four curtains of trees one behind the other. Each is a ragged canopy on bare
// trunks above an understorey; each stands deeper in the garden's lit air than the one in front, so the far ones are
// pale and warm toward the sun and the near ones are dark. This is what gives the garden its distance.
float canopyLayer(float ang, float e, float fi, out float crownLit){
  float o = fi * 17.3;
  float top = mix(0.56, 0.2, fi / 3.0) + 0.2 * (fbm(vec2(ang * mix(2.1, 4.5, fi / 3.0) + o, 1.7 + o), 4) - 0.5) * mix(1.4, 0.9, fi / 3.0);
  // crowns are lumps: domes of different sizes pushed up out of the line
  float lump = fbm(vec2(ang * 13.0 + o, 3.0), 3);
  top += 0.07 * lump * lump;
  float thick = mix(0.2, 0.11, fi / 3.0) * (0.6 + 0.8 * fbm(vec2(ang * 5.0 + o, 9.0), 2));
  float rag = (fbm(vec2(ang * 47.0 + o, e * 41.0), 4) - 0.5) * 0.085;
  float crown = smoothstep(top + 0.006, top - 0.006, e + rag) * smoothstep(top - thick - 0.03, top - thick + 0.03, e + rag * 1.6);
  // sky holes inside the crown
  crown *= smoothstep(0.34, 0.44, fbm(vec2(ang * 29.0 + o, e * 33.0 + 5.0), 3) + 0.25 * smoothstep(top - thick, top, e));
  crownLit = smoothstep(top - 0.09, top, e + rag);                       // the upper edge of a crown catches the light
  // trunks
  float n = mix(46.0, 20.0, fi / 3.0);
  float cell = ang * n + o;
  vec2 h = hash22(vec2(floor(cell), fi + 3.0));
  float lean = (h.y - 0.5) * 0.5 * (e - 0.1);
  float w = mix(0.035, 0.11, h.x * h.x) * mix(0.6, 1.0, fi / 3.0);
  float trunk = step(0.42, h.y + h.x * 0.3) * smoothstep(w, w * 0.6, abs(fract(cell) - 0.5 + lean)) * step(e, top - thick * 0.5);
  // understorey
  float ut = mix(0.1, -0.02, fi / 3.0) + 0.09 * fbm(vec2(ang * 9.0 + o, 4.0), 4) + rag * 0.5;
  float under = smoothstep(ut + 0.008, ut - 0.008, e);
  return max(max(crown, trunk), under);
}
vec3 backdrop(vec3 d){
  vec3 c = skyColor(d);
  float ang = atan(d.z, d.x);
  float e = asin(clamp(d.y, -1.0, 1.0));
  float az = dot(normalize(d.xz + 1e-5), normalize(SUN_DIR.xz));
  float sd = max(dot(d, SUN_DIR), 0.0);
  // the air between the curtains: gold toward the sun, blue-green away from it
  vec3 air = mix(vec3(0.085, 0.125, 0.12), vec3(1.25, 0.8, 0.34), pow(0.5 + 0.5 * az, 3.0)) * (0.75 + 0.9 * pow(sd, 4.0));
  air *= mix(1.0, 0.55, smoothstep(0.0, 0.7, e));
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float lit;
    float m = canopyLayer(ang, e, fi, lit);
    float depth = 1.0 - fi / 3.0;                                          // 1 = the farthest curtain
    vec3 leafC = mix(vec3(0.011, 0.03, 0.013), vec3(0.05, 0.085, 0.022), lit * (0.3 + 0.7 * pow(0.5 + 0.5 * az, 2.0)));
    leafC += vec3(1.1, 0.75, 0.2) * 0.05 * lit * pow(sd, 3.0);             // rim light on the crowns around the sun
    vec3 lc = mix(leafC, air, 0.2 + 0.72 * depth);
    c = mix(c, lc, m);
    // a breath of lit air in front of each curtain
    c = mix(c, air, 0.06 * (1.0 - smoothstep(0.0, 0.5, e)));
  }
  return c;
}`;

// The sky never changes, so its noise is evaluated once into a small panorama (rgb + treeline mask) and looked up after that.
const SKY_RANGE = '#define SKY_EL0 -0.38\n#define SKY_EL1 1.2\n';

const SKY_BAKE_FRAG = /* glsl */ `
precision highp float;
${SKY_RANGE}
varying vec2 vUv;
${hash}
${noise}
${fbm}
${layoutGLSL}
${skyGLSL}
void main(){
  float az = (vUv.x - 0.5) * 6.2831853;
  float el = mix(SKY_EL0, SKY_EL1, vUv.y);
  vec3 d = vec3(cos(az) * cos(el), sin(el), sin(az) * cos(el));
  gl_FragColor = vec4(backdrop(d), 1.0);
}`;

const SKY_FRAG = /* glsl */ `
precision highp float;
${SKY_RANGE}
varying vec3 vDir;
uniform sampler2D tSky;
void main(){
  vec3 d = normalize(vDir);
  vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, (asin(clamp(d.y, -1.0, 1.0)) - SKY_EL0) / (SKY_EL1 - SKY_EL0));
  gl_FragColor = vec4(textureLod(tSky, uv, 0.0).rgb, 0.9995);
}`;

const GROUND_VERT = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/** The pool and the path beyond the end pane (world metres). Shared with the planting, which keeps clear of both. */
export const POOL = { x: 1.55, z: ZE - 6.1, rx: 1.9, rz: 1.25 };
export const pathX = (z) => {
  const t = ZE - z;
  return 0.05 + 0.55 * Math.sin(t * 0.55) - 0.165 * t;
};

const GROUND_FRAG = /* glsl */ `
precision highp float;
${SKY_RANGE}
varying vec3 vWorld;
uniform sampler2D tNoise;
uniform sampler2D tSky;
uniform vec3 uSky, uBounce, uHaze;
uniform float uHazeDensity, uSunScale, uTime;
${hash}
${layoutGLSL}
${sunGLSL}
const vec2 POOL_C = vec2(${POOL.x.toFixed(3)}, ${POOL.z.toFixed(3)});
const vec2 POOL_R = vec2(${POOL.rx.toFixed(3)}, ${POOL.rz.toFixed(3)});
float pathX(float z){ float t = ZE - z; return 0.05 + 0.55 * sin(t * 0.55) - 0.165 * t; }
vec3 skyAt(vec3 d){
  vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, (asin(clamp(d.y, -1.0, 1.0)) - SKY_EL0) / (SKY_EL1 - SKY_EL0));
  return textureLod(tSky, uv, 0.0).rgb;
}
void main(){
  vec2 p = vWorld.xz;
  vec3 ray = vWorld - cameraPosition;
  float rl = length(ray);
  vec3 V = -ray / rl;
  // (how big a pixel is on the ground: detail is faded out before it turns to noise)
  float fw = rl * 0.0009 / max(V.y, 0.06);
  vec4 n1 = texture2D(tNoise, p * 0.11);
  vec4 n2 = texture2D(tNoise, p * 0.83 + 0.21);
  vec4 n3 = texture2D(tNoise, p * 4.7);
  float fine = smoothstep(0.02, 0.004, fw);
  // damp soil, cushions of moss, a litter of dead leaves
  vec3 soil = mix(vec3(0.008, 0.006, 0.004), vec3(0.024, 0.017, 0.01), n2.g) * (0.8 + 0.4 * n3.g * fine);
  float mossK = smoothstep(0.36, 0.58, n1.r + n2.r * 0.35 + (n3.g - 0.5) * 0.2 * fine);
  vec3 moss = mix(vec3(0.006, 0.02, 0.004), vec3(0.02, 0.05, 0.007), n3.g * fine + n2.a * 0.4);
  vec3 alb = mix(soil, moss, mossK);
  float litter = smoothstep(0.64, 0.72, n3.r) * smoothstep(0.4, 0.62, n2.g + n1.g * 0.4) * fine;
  alb = mix(alb, mix(vec3(0.05, 0.028, 0.01), vec3(0.09, 0.06, 0.018), n3.a), litter * 0.7);
  vec3 N = normalize(vec3((n3.g - 0.5) * 0.5 * fine + (n2.g - 0.5) * 0.25, 1.0, (n3.r - 0.5) * 0.5 * fine + (n2.r - 0.5) * 0.25));
  float rough = 0.85;
  float wetK = 0.4 + 0.6 * n2.r;

  // ---- the path: worn stepping stones sunk in moss, winding away from the end pane
  float dPath = abs(p.x - pathX(p.y));
  float onPath = smoothstep(0.62, 0.3, dPath) * smoothstep(ZE + 0.2, ZE - 0.4, p.y) * smoothstep(ZE - 15.0, ZE - 11.0, p.y);
  float stone = 0.0;
  if (onPath > 0.01) {
    vec2 sp = p * 0.17 + 0.3;
    float a = texture2D(tNoise, sp).a;
    float e = 2.0 / 256.0;
    vec2 gr = vec2(texture2D(tNoise, sp + vec2(e, 0.0)).a, texture2D(tNoise, sp + vec2(0.0, e)).a) - a;
    stone = smoothstep(0.5, 0.44, a + (n3.g - 0.5) * 0.05) * onPath;
    vec3 sc = mix(vec3(0.07, 0.066, 0.058), vec3(0.15, 0.14, 0.12), n2.g) * (0.7 + 0.5 * n3.r);
    sc = mix(sc, vec3(0.03, 0.06, 0.016), smoothstep(0.5, 0.8, n3.g + smoothstep(0.36, 0.5, a)) * 0.7);      // moss creeping in from the joints
    alb = mix(alb, sc, stone);
    N = normalize(mix(N, vec3(gr.x * 9.0 + (n3.g - 0.5) * 0.15, 1.0, gr.y * 9.0 + (n3.r - 0.5) * 0.15), stone));
    rough = mix(rough, 0.35, stone);
    mossK *= 1.0 - stone;
    alb = mix(alb, moss * 1.3, (1.0 - stone) * onPath * 0.8);
  }

  // ---- the pool
  vec2 pq = (p - POOL_C) / POOL_R;
  float pd = (length(pq) - 1.0 + (n1.g - 0.5) * 0.35 + (n2.g - 0.5) * 0.08) * 1.2;      // < 0 in the water (≈ metres)
  float bank = smoothstep(0.55, 0.0, pd);
  // (the bank is wet stone and black mud)
  alb = mix(alb, mix(vec3(0.02, 0.017, 0.012), vec3(0.085, 0.08, 0.07), smoothstep(0.5, 0.36, texture2D(tNoise, p * 0.31).a)), bank * 0.85);
  rough = mix(rough, 0.3, bank);
  wetK = max(wetK, bank);

  float vis = shadowHard(vWorld + vec3(0.0, 0.02, 0.0));
  vis *= mix(1.0, uSunScale, smoothstep(HW - 0.3, HW + 0.3, vWorld.x) * smoothstep(ZE - 1.5, ZE + 0.5, vWorld.z));
  vec3 sun = SUN_COL * vis;
  vec3 col = alb * (sun * max(dot(N, SUN_DIR), 0.0) * 0.6 + uSky * 0.45 + uBounce * 0.3);
  col += moss * sun * 0.1 * mossK;                                                       // moss glows a little when the sun is in it
  // wet sheen
  float F = 0.03 + 0.6 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  col += mix(uSky, skyAt(R), 1.0 - rough) * F * 0.5 * wetK * (1.0 - rough * 0.6);
  vec3 H = normalize(SUN_DIR + V);
  col += sun * pow(max(dot(N, H), 0.0), mix(20.0, 260.0, 1.0 - rough)) * (1.0 - rough) * 1.5 * wetK;

  if (pd < 0.0) {
    // still water, a hand deep at the edge: the sky and the far trees in it, the sun where a ripple turns, and the
    // lit bottom showing through wherever the mirror is weak
    vec2 rp = p * 2.6 + vec2(uTime * 0.021, uTime * 0.013);
    vec2 rip = (texture2D(tNoise, rp).rg - 0.5) * 0.05 + (texture2D(tNoise, rp * 3.1 - uTime * 0.02).rg - 0.5) * 0.025;
    vec3 Nw = normalize(vec3(rip.x, 1.0, rip.y));
    vec3 Rw = reflect(-V, Nw);
    Rw.y = abs(Rw.y);
    float Fw = 0.02 + 0.98 * pow(1.0 - max(dot(Nw, V), 0.0), 5.0);
    float depth = smoothstep(0.0, -0.7, pd);
    vec3 bottom = mix(vec3(0.05, 0.045, 0.02), vec3(0.008, 0.016, 0.008), depth) * (sun * 0.5 + uSky * 0.5);
    bottom += vec3(0.5, 0.42, 0.12) * sun * 0.03 * (0.5 + 0.5 * sin(p.x * 23.0 + rip.x * 90.0 + uTime * 0.6) * sin(p.y * 19.0 + rip.y * 90.0)) * (1.0 - depth);   // caustics in the shallows
    vec3 water = mix(bottom, skyAt(Rw), Fw);
    water += sun * (pow(max(dot(Rw, SUN_DIR), 0.0), 900.0) * 6.0 + pow(max(dot(Rw, SUN_DIR), 0.0), 40.0) * 0.06);
    // lily pads
    vec2 lp = p * 0.5 + 0.7;
    float la = texture2D(tNoise, lp).a;
    vec2 lid = floor(lp * 16.0);
    float pad = smoothstep(0.3, 0.27, la) * step(0.45, hash12(lid + 3.0)) * smoothstep(-0.12, -0.3, pd);
    vec3 padC = mix(vec3(0.03, 0.1, 0.02), vec3(0.07, 0.17, 0.03), n3.g) * (sun * 0.55 + uSky * 0.5) + sun * 0.02;
    water = mix(water, padC, pad);
    col = mix(col, water, smoothstep(0.0, -0.03, pd));
  }
  float q = paneQ(cameraPosition, vWorld);
  float hz = 1.0 - exp(-rl * q * uHazeDensity);
  vec3 hazeC = hazeColor(normalize(ray), uHaze);
  gl_FragColor = vec4(mix(col, hazeC, hz), q);
}`;

/** @returns {{ mesh, dispose() }} — the backdrop, drawn last and only where nothing else was. */
export function makeSky(renderer) {
  const rt = new THREE.WebGLRenderTarget(3072, 768, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    generateMipmaps: false,
  });
  const bake = new FSPass(SKY_BAKE_FRAG);
  bake.render(renderer, rt);
  bake.dispose();
  renderer.setRenderTarget(null);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { tSky: { value: rt.texture } }, depthTest: true, depthWrite: false, depthFunc: THREE.LessEqualDepth });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10000;
  return {
    mesh,
    texture: rt.texture,
    dispose() {
      rt.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Nothing of the garden can be seen through the corridor's floor: a depth-only lid at curb height spares the leaf
 * shader every pixel underneath it.
 */
export function makeFloorMask() {
  const geo = new THREE.PlaneGeometry(HW * 2, ZBACK - ZE);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'void main(){ gl_FragColor = vec4(0.02, 0.028, 0.016, 0.9995); }',
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, Y0 - 0.004, (ZBACK + ZE) / 2);
  mesh.renderOrder = -10000;
  mesh.frustumCulled = false;
  return mesh;
}

export function makeGround(shared, skyTex) {
  const geo = new THREE.PlaneGeometry(60, 60, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({ vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, uniforms: { ...shared, tSky: { value: skyTex } } });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, -0.02, -8);
  return mesh;
}

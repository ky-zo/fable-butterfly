// The near field: every letter an instanced quad riding the wave function, leaning up towards the reader,
// flashing when the swell tips its facet through the mirror angle, warming when it is recalled.
// Also renders the whole tile once, flat, into the coverage texture the far field is made of.

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { SEA_GLSL } from './waves.js';
import { COMMON_GLSL, NOISE_GLSL } from './shared.js';
import { CELL_EM } from './atlas.js';
import { LAND_GLSL } from './shore.js';

export function makeGlyphGeometry(ctx, layout) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aA', new THREE.InstancedBufferAttribute(layout.a, 4));
  geo.setAttribute('aB', new THREE.InstancedBufferAttribute(layout.b, 4));
  geo.setAttribute('aC', new THREE.InstancedBufferAttribute(layout.c, 2));
  geo.instanceCount = layout.count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  ctx.track(geo);
  return geo;
}

const VERT = /* glsl */ `
precision highp float;
attribute vec4 aA;   // base x, base z, rotation, em
attribute vec4 aB;   // atlas index, glyph rand, phrase rand, face (+8: a line left for the one crossing, +16: set in the lane under its line of flight)
attribute vec2 aC;   // phrase centre − glyph base
uniform float uTime, uTile;
uniform vec2 uAtlas;
uniform vec2 uNear;     // letters nearer the lens than this (m: gone, all there) are let go: out of focus they are only glare
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vGlow;
varying vec4 vLq;     // the moon in the letter's own frame (along the line, up the letter, out of its face); w: how much relief shows
varying vec3 vHq;     // the mirror direction likewise
${hash}
${NOISE_GLSL}
${SEA_GLSL}
${COMMON_GLSL}
${LAND_GLSL}

void main(){
  vec2 base = aA.xy + uTile * floor((uCam.xz - aA.xy) / uTile + 0.5);
  vec2 dh = base - uCam.xz;
  vUv = vec2(0.0); vCol = vec4(0.0); vGlow = vec4(0.0); vLq = vec4(0.0); vHq = vec3(0.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (dot(dh, dh) > uLod.z * uLod.z) return;
  // nothing behind the lens or well outside the frame needs the sea worked out for it
  vec4 cc = projectionMatrix * viewMatrix * vec4(base.x, 0.0, base.y, 1.0);
  if (cc.w < -1.5 || abs(cc.x) > cc.w * 1.15 + 5.0 || abs(cc.y) > cc.w * 1.2 + 7.0) return;
  float lane = step(15.5, aB.w);
  float way = step(7.5, mod(aB.w, 16.0));
  // the lane is small print: further off than a few metres it is not there to be drawn
  if (lane > 0.5 && dot(dh, dh) > 60.0) return;
  // what is being remembered: the pointer warms any line; the butterfly, passing over, the lines that were left for it
  float warmP = recallWarm(base + aC);
  float warmG = recallWarm(base);
  float wake = wakeWarm(base + aC) * way;
  // nothing can be read outside the moon road (taken wide here: a wave face can carry a piece of it some way off)
  vec3 V0 = normalize(uCam - vec3(base.x, 0.0, base.y));
  if (moonRoad(vec3(0.0, 1.0, 0.0), V0) < 2e-5 * (1.0 - uVeil) && warmP + warmG + wake < 0.02) return;
  float dens = textDensity(base, 0.0);
  if (lane < 0.5 && dens + (1.0 - dens) * 0.36 < aB.z * 0.9) return;     // this phrase is never afloat here, whatever the swell does

  vec3 P, N, Ta, Tb;
  float J;
  float dist0 = length(vec3(base.x, 0.0, base.y) - uCam);
  seaEval(base, uTime, dist0, P, N, Ta, Tb, J);
  float up = seaUp(P.y);
  float vis = mix(smoothstep(0.0, 0.10, textFrac(dens, up) - aB.z * 0.9), 1.0, lane);
  if (vis < 0.004) return;
  float tip;
  float lodw = glyphLod(P, N, tip);
  if (lodw < 0.004) return;

  vec3 tc = uCam - P;
  float dist = length(tc);
  vec3 V = tc / dist;
  if (dot(N, V) < 0.02) return;             // on the far side of a wave: the wave hides it

  float cr = cos(aA.z), sr = sin(aA.z);
  vec3 U = normalize(Ta * cr + Tb * sr);
  vec3 W = normalize(cross(N, U));         // glyph "up" lying on the surface (away from the reader)

  float crest = 1.0 - smoothstep(0.34, 0.80, J);
  float brk = breaking(base, J);
  float loose = max((1.0 - smoothstep(0.22, 0.52, J)) * (0.4 + 0.6 * uBreak), brk);   // about to be torn off

  // every letter rocks on its own little patch of chop
  float t1 = uTime * (0.55 + aB.y * 1.0) + aB.y * 40.0;
  vec2 tilt = 0.20 * (0.35 + fract(aB.y * 7.13)) * vec2(sin(t1 + aB.z * 6.28), cos(t1 * 0.77 + aB.y * 17.0));
  float rock = 0.5 + 1.5 * crest;
  float wk = smoothstep(0.22, 0.75, wake);
  tip += crest * 0.30 + loose * 0.5 * sin(t1 * 2.3) + wk * 0.16;
  float ct = cos(tip), st = sin(tip);
  vec3 Wt = W * ct + N * st;
  vec3 Ur = normalize(U + N * tilt.x * 0.45 * rock);
  vec3 Wr = normalize(Wt + N * tilt.y * 0.35 * rock);
  vec3 Nf = normalize(cross(Ur, Wr));      // geometric facet normal (leaning)
  if (Nf.y < 0.0) Nf = -Nf;
  if (dot(Nf, V) < 0.015) return;           // seen from underneath it is on the far side of a wave: the wave hides it

  float cell = aA.w * ${CELL_EM.toFixed(5)};
  vec2 q = position.xy;
  float lift = 0.004 + 0.0012 * dist + loose * (0.03 + 0.10 * fract(aB.y * 3.7)) * (0.6 + 0.4 * sin(t1 * 1.7)) + wk * 0.012;
  vec3 pos = P + N * lift - W * (0.5 * cell) + Ur * (q.x * cell) + Wr * ((q.y + 0.5) * cell);

  vec4 cp = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  // depth only: sit a hair in front of the water so coplanar letters never fight it
  vec4 cb = projectionMatrix * viewMatrix * vec4(pos + V * (0.012 + 0.005 * dist), 1.0);
  cp.z = cb.z / cb.w * cp.w;
  gl_Position = cp;

  float col = mod(aB.x, uAtlas.x), row = floor(aB.x / uAtlas.x);
  vUv = (vec2(col, row) + vec2(q.x + 0.5, 0.5 - q.y)) / uAtlas;

  // ---- light
  vec3 lit = letterLit(N, max(crest, brk * 0.8), up);
  lit *= 0.74 + 0.5 * aB.z;                                  // some lines are fainter than others
  vec2 md = mirrorDelta(N, V) + tilt;
  float m2 = dot(md, md);
  float fl = exp(-m2 / (GW * GW));                           // the flash
  float silver = exp(-m2 / GS2);                             // …and the silvering of everything near the mirror angle
  float warm = max(smoothstep(0.34 + 0.3 * aB.z, 0.80 + 0.3 * aB.z, warmP * 0.7 + warmG * 0.3), wk);
  float road = moonRoad(N, V);
  if (uLand > 0.002) road *= mix(1.0, landClear(P, uMoonDir, 0.034), uLand);
  float show = max(road, warm);
  if (show < 0.004) return;
  // the ring that spreads from a recalled place lifts each letter it passes into the light for a moment
  float ring = clamp(seaRing * 34.0, 0.0, 1.0);
  vec3 c = mix(lit + uMoonCol * BONE * silver * 1.15, AMBER * (0.42 + 0.62 * warm), warm) + mix(BONE, AMBER, 0.6) * ring * 0.9;
  c += uMoonCol * fl * 26.0 * (1.0 - 0.6 * warm);
  float alpha = lodw * vis * show * smoothstep(uNear.x, uNear.y, dist) * (1.0 - captZone(cp.xy / cp.w));
  if (alpha < 0.003) return;
  vCol = vec4(c, alpha);
  // small print is set a little bolder, as a punchcutter would, so that it does not thin out into grey
  float emPx = aA.w * uPpm / dist * sin(min(asin(clamp(dot(V, N), 0.0, 1.0)) + tip, 1.5708));
  float bold = 0.10 * (1.0 - smoothstep(5.0, 22.0, emPx));
  vCol.a *= mix(1.0, smoothstep(1.6, 4.0, emPx), lane);   // (small print goes before it turns to sand)
  vGlow = vec4(AMBER * warm * 0.14 + uMoonCol * (fl * 2.8 + silver * 0.05), bold);
  vec3 Hh = normalize(V + uMoonDir);
  vLq = vec4(dot(uMoonDir, Ur), dot(uMoonDir, Wr), dot(uMoonDir, Nf), smoothstep(13.0, 44.0, emPx) * (1.0 - warm * 0.5));
  vHq = vec3(dot(Hh, Ur), dot(Hh, Wr), dot(Hh, Nf));
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tAtlas;
uniform vec2 uAtlas;
uniform vec3 uMoonCol;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vGlow;
varying vec4 vLq;
varying vec3 vHq;
void main(){
  float sd = texture2D(tAtlas, vUv).r;
  float fw = fwidth(sd);
  float aa = clamp(fw * 0.75, 0.004, 0.25);
  float a = smoothstep(0.5 - aa, 0.5 + aa, sd + vGlow.a);
  float halo = smoothstep(0.06, 0.5, sd);
  halo *= halo;
  // (the butterfly's moon-shadow used to be worked out here, for every pixel of every letter. It falls metres behind
  // the lens in every shot there is — see water.js — so it is gone.)
  const float sh = 1.0;
  vec3 body = vCol.rgb * sh;
  vec3 edge = vec3(0.0);
  if (vLq.w > 0.01) {
    // Up close a letter has thickness: a rounded, wet shoulder all the way round. The far shoulder of every
    // stroke catches the low moon, the near one is in shade, and now and then an edge throws a hairline of light.
    vec2 ux = dFdx(vUv), uy = dFdy(vUv);
    float sx = dFdx(sd), sy = dFdy(sd);
    float det = ux.x * uy.y - ux.y * uy.x;
    vec2 g = vec2(sx * uy.y - sy * ux.y, sy * ux.x - sx * uy.x) / (abs(det) > 1e-14 ? det : 1e-14) / uAtlas;
    float shoulder = smoothstep(0.47, 0.56, sd) * (1.0 - smoothstep(0.56, 0.66, sd)) * vLq.w;
    g = clamp(g, -6.0, 6.0);
    vec3 n = normalize(vec3(-g.x * 0.24 * shoulder, g.y * 0.24 * shoulder, 1.0));
    float dl = dot(n, vLq.xyz) - vLq.z;
    body *= clamp(1.0 + 1.7 * dl, 0.45, 2.4);
    float sp = pow(max(dot(n, normalize(vHq)), 0.0), 56.0) - pow(max(normalize(vHq).z, 0.0), 56.0);
    edge = uMoonCol * max(sp, 0.0) * 5.0 * shoulder;
    // and it sits in the water: a thin dark line where the surface climbs its edge
    halo = mix(halo, halo * 0.8, vLq.w);
  }
  float alpha = a * vCol.a;
  float fringe = (1.0 - a) * smoothstep(0.30, 0.5, sd) * 0.42 * vCol.a * vLq.w;
  vec3 col = (body + edge * sh) * alpha + vGlow.rgb * sh * halo * vCol.a * (1.0 - a * 0.6);
  if (alpha + fringe + dot(col, vec3(1.0)) < 0.0005) discard;
  gl_FragColor = vec4(col, alpha + fringe);
}`;

export function makeGlyphMaterial(ctx, uniforms) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  ctx.track(mat);
  return mat;
}

// ------------------------------------------------------------------------------------------ drowned layers
// The same typeset tile again, shifted and sunk: letters lying flat some way under the surface, dim and soft.
// Each quad is drawn where the line of sight to the sunken letter crosses the surface, so the layers slide
// against the floating text with true parallax and are still hidden by any crest in front of them.

const DEEP_VERT = /* glsl */ `
precision highp float;
attribute vec4 aA;
attribute vec4 aB;
uniform float uTime, uTile;
uniform vec2 uAtlas;
uniform vec4 uDeep;    // depth under the surface (m), reach (m), layout shift (m), softness
varying vec2 vUv;
varying vec4 vCol;
${hash}
${NOISE_GLSL}
${SEA_GLSL}
${COMMON_GLSL}
void main(){
  vUv = vec2(0.0); vCol = vec4(0.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vec2 a = aA.xy + vec2(uDeep.z, uDeep.z * 0.618) + vec2(0.013, -0.021) * uTime * (0.4 + uDeep.x);
  vec2 base = a + uTile * floor((uCam.xz - a) / uTile + 0.5);
  vec2 dh = base - uCam.xz;
  float hd = length(dh);
  if (hd > uDeep.y) return;
  vec4 cc = projectionMatrix * viewMatrix * vec4(base.x, 0.0, base.y, 1.0);
  if (cc.w < -1.5 || abs(cc.x) > cc.w * 1.15 + 5.0 || abs(cc.y) > cc.w * 1.2 + 7.0) return;
  if (aB.w > 15.5) return;
  float dens = textDensity(base + 31.0, 0.0);
  if (dens < 0.12 + aB.z * 0.85) return;
  vec3 P, N, Ta, Tb;
  float J;
  seaEval(base, uTime, 70.0, P, N, Ta, Tb, J);          // only the long swell reaches down here
  if (uCam.y < P.y + 0.05) return;
  float cr = cos(aA.z), sr = sin(aA.z);
  float cell = aA.w * ${CELL_EM.toFixed(5)};
  vec2 q = position.xy;
  vec3 D = vec3(P.x, P.y - uDeep.x, P.z) + vec3(cr, 0.0, sr) * (q.x * cell) + vec3(sr, 0.0, -cr) * (q.y * cell);
  vec3 S = uCam + (D - uCam) * ((uCam.y - P.y) / (uCam.y - D.y));
  vec3 tc = uCam - S;
  float dist = length(tc);
  vec3 V = tc / dist;
  float emPx = aA.w * uPpm / dist * max(V.y, 0.0);
  float lod = smoothstep(2.5, 6.0, emPx) * (1.0 - smoothstep(uDeep.y * 0.55, uDeep.y, hd));
  if (lod < 0.004) return;
  vec4 cp = projectionMatrix * viewMatrix * vec4(S, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(S + V * (0.03 + 0.012 * dist), 1.0);
  cp.z = cb.z / cb.w * cp.w;
  gl_Position = cp;
  float col = mod(aB.x, uAtlas.x), row = floor(aB.x / uAtlas.x);
  vUv = (vec2(col, row) + vec2(q.x + 0.5, 0.5 - q.y)) / uAtlas;

  float NoV = clamp(dot(N, V), 0.03, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  float att = exp(-uDeep.x / max(V.y, 0.12) * 0.75);       // the longer the way through the water, the less comes back
  float warm = clamp(recallWarm(base) * 0.8, 0.0, 1.0);
  vec3 c = mix(vec3(0.040, 0.074, 0.122) * (0.55 + 0.7 * aB.z), AMBER * 0.22, warm);
  vCol = vec4(c * (1.0 - F) * att * lod * smoothstep(0.12 + aB.z * 0.85, 0.24 + aB.z * 0.85, dens) * (0.05 + 0.95 * moonRoad(N, V)) * (1.0 - captZone(cp.xy / cp.w)), uDeep.w);
}`;

const DEEP_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tAtlas;
varying vec2 vUv;
varying vec4 vCol;
void main(){
  float sd = texture2D(tAtlas, vUv).r;
  float aa = clamp(fwidth(sd) * 0.75, 0.004, 0.25) + vCol.a;
  float a = smoothstep(0.5 - aa, 0.5 + aa, sd + 0.03);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol.rgb * a, 0.0);
}`;

/** @param deep [depth m, reach m, layout shift m, softness] */
export function makeDeepMaterial(ctx, uniforms, deep) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: DEEP_VERT,
    fragmentShader: DEEP_FRAG,
    uniforms: { ...uniforms, uDeep: { value: new THREE.Vector4(...deep) } },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  ctx.track(mat);
  return mat;
}

// ------------------------------------------------------------------------------------------ flat tile render

const TILE_VERT = /* glsl */ `
precision highp float;
attribute vec4 aA;
attribute vec4 aB;
uniform float uTile;
uniform vec2 uAtlas;
varying vec2 vUv;
void main(){
  float cr = cos(aA.z), sr = sin(aA.z);
  float cell = aA.w * ${CELL_EM.toFixed(5)};
  vec2 q = position.xy * cell;
  vec2 p = aA.xy + vec2(cr, sr) * q.x + vec2(sr, -cr) * q.y;
  p += (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
  float col = mod(aB.x, uAtlas.x), row = floor(aB.x / uAtlas.x);
  vUv = (vec2(col, row) + vec2(position.x + 0.5, 0.5 - position.y)) / uAtlas;
  gl_Position = vec4(p / uTile * 2.0 - 1.0, 0.0, 1.0);
}`;

const TILE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tAtlas;
varying vec2 vUv;
void main(){
  float sd = texture2D(tAtlas, vUv).r;
  float aa = clamp(fwidth(sd) * 0.8, 0.004, 0.3);
  float a = smoothstep(0.5 - aa, 0.5 + aa, sd + 0.07);
  gl_FragColor = vec4(a, a, a, a);
}`;

/** Render the whole tile, flat and wrapped, into a mip-mapped anisotropic coverage texture. */
export function renderTileTexture(ctx, geo, uniforms, res) {
  const renderer = ctx.renderer;
  const rt = new THREE.WebGLRenderTarget(res, res, {
    type: THREE.UnsignedByteType,
    format: THREE.RedFormat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    generateMipmaps: true,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  ctx.track(rt);

  const mat = new THREE.ShaderMaterial({
    vertexShader: TILE_VERT,
    fragmentShader: TILE_FRAG,
    uniforms: { uTile: uniforms.uTile, uAtlas: uniforms.uAtlas, tAtlas: uniforms.tAtlas },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquation: THREE.MaxEquation,
  });
  const scene = new THREE.Scene();
  const T = uniforms.uTile.value;
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(ix * T, 0, iz * T);
      m.frustumCulled = false;
      scene.add(m);
    }
  }
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevTarget = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  const prevColor = new THREE.Color();
  renderer.getClearColor(prevColor);
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.autoClear = prevAuto;
  mat.dispose();
  return rt;
}

// Everything in the garden that is not a leaf: trunks with their bark, hanging roots and lianas, vine stems, stones.
// One merged mesh, one shader. aAux.y is the kind of surface:
//   0 bark · 1 aerial root / liana · 2 stone · 3 green stem
// Like every garden surface it writes q into alpha (see layout.js) so the glass knows how far behind the pane it stands.

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { layoutGLSL } from './layout.js';
import { sunGLSL } from './sun.js';

const SOLID_VERT = /* glsl */ `
attribute vec2 aAux;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vAux;
${layoutGLSL}
void main(){
  vAux = aAux;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // nothing passes through glass
  float mx = -1e9; vec3 nm = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float sd = dot(HULL[i].xyz, wp.xyz) - HULL[i].w;
    if (sd > mx) { mx = sd; nm = HULL[i].xyz; }
  }
  wp.xyz += nm * max(0.0, 0.004 - mx);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SOLID_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vAux;
uniform sampler2D tNoise;
uniform vec3 uSky, uBounce, uHaze;
uniform float uHazeDensity, uSunScale;
${hash}
${layoutGLSL}
${sunGLSL}
void main(){
#ifdef SHADOW_PASS
  gl_FragColor = vec4(1.0);
#else
  vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 ray = vWorld - cameraPosition;
  float rl = length(ray);
  vec3 V = -ray / rl;
  int kind = int(vAux.y + 0.5);
  // bark runs with the trunk: stretched along Y, wrapped around it by whichever horizontal axis the face looks along
  vec2 around = abs(N.x) > abs(N.z) ? vec2(vWorld.z, vWorld.y) : vec2(vWorld.x, vWorld.y);
  vec4 n1 = texture2D(tNoise, around * vec2(1.1, 0.23));
  vec4 n2 = texture2D(tNoise, around * vec2(6.3, 0.9) + 0.37);
  vec4 n3 = texture2D(tNoise, around * vec2(17.0, 9.0));
  vec3 alb; float rough = 0.8; float hgt = 0.0;
  if (kind == 0) {
    // plates of bark split by dark fissures; lichen in pale islands; moss on the weather side and toward the foot
    float fis = smoothstep(0.38, 0.56, n2.g + (n3.g - 0.5) * 0.25);
    alb = mix(vec3(0.028, 0.022, 0.015), mix(vec3(0.09, 0.07, 0.048), vec3(0.16, 0.135, 0.1), n1.g), fis);
    alb = mix(alb, vec3(0.2, 0.22, 0.16) * (0.7 + 0.5 * n3.r), smoothstep(0.66, 0.74, n1.r + n3.g * 0.2) * fis * 0.8);
    float mossK = smoothstep(0.52, 0.75, n1.a * 0.6 + n2.r * 0.5 + 0.3 * smoothstep(2.2, 0.0, vWorld.y) + 0.25 * N.x);
    alb = mix(alb, mix(vec3(0.014, 0.04, 0.008), vec3(0.04, 0.09, 0.014), n3.g), mossK * 0.85);
    hgt = fis * 0.6 + n3.g * 0.3 + mossK * 0.3;
    rough = mix(0.75, 0.95, mossK);
  } else if (kind == 1) {
    alb = mix(vec3(0.03, 0.022, 0.014), vec3(0.085, 0.07, 0.045), n2.g) * (0.7 + 0.6 * n1.g);
    hgt = n2.g * 0.4;
    rough = 0.7;
  } else if (kind == 2) {
    vec4 s1 = texture2D(tNoise, vWorld.xz * 1.3 + vWorld.y * 0.7);
    vec4 s2 = texture2D(tNoise, vWorld.xz * 7.0 + vWorld.y * 3.0);
    alb = mix(vec3(0.045, 0.043, 0.04), vec3(0.14, 0.13, 0.115), s1.g) * (0.7 + 0.5 * s2.g);
    alb = mix(alb, vec3(0.21, 0.22, 0.17), smoothstep(0.7, 0.78, s1.r + s2.g * 0.2) * 0.7);                 // lichen
    float mossK = smoothstep(0.35, 0.75, N.y * 0.8 + s1.a * 0.5 + s2.g * 0.25 - 0.2);
    alb = mix(alb, mix(vec3(0.015, 0.045, 0.008), vec3(0.05, 0.11, 0.015), s2.g), mossK * 0.9);
    hgt = s2.g * 0.5 + s1.g * 0.4;
    rough = mix(0.4, 0.95, mossK);
  } else {
    alb = mix(vec3(0.05, 0.11, 0.025), vec3(0.09, 0.07, 0.03), n2.g) * (0.75 + 0.5 * n1.g);
    rough = 0.5;
    // (stems are thin and half lit through: never black against the fog)
    alb += vec3(0.02, 0.035, 0.008);
  }
  {
    vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
    float dhx = dFdx(hgt), dhy = dFdy(hgt);
    vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
    float dt = dot(dpx, r1);
    N = normalize(abs(dt) * N - 0.004 * sign(dt) * (r1 * dhx + r2 * dhy));
  }
  float q = paneQ(cameraPosition, vWorld);
  float dBehind = rl * q;
  vec3 Ps = vWorld + SUN_DIR * 0.04 + N * 0.02;
  float vis = dBehind < 0.7 ? shadowHard(Ps) : shadow1(Ps);
  float shadeSide = smoothstep(HW - 0.3, HW + 0.3, vWorld.x) * smoothstep(ZE - 1.5, ZE + 0.5, vWorld.z);
  vis *= mix(1.0, uSunScale, shadeSide);
  vec3 sun = SUN_COL * vis;
  float NdL = max(dot(N, SUN_DIR), 0.0);
  float ao = mix(0.45, 1.0, smoothstep(0.0, 1.6, vWorld.y)) * (0.75 + 0.25 * N.y);
  vec3 col = alb * (sun * NdL * 0.6 + mix(uBounce, uSky, 0.5 + 0.5 * N.y) * ao);
  // the garden's own lit air fills every shadow out here: wood is brown in it, never black
  col += alb * mix(vec3(0.5, 0.42, 0.26), mix(uBounce, uSky, 0.75) * 0.5, shadeSide) * (0.45 + 0.55 * ao);
  // everything out here is damp
  vec3 H = normalize(SUN_DIR + V);
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  col += sun * pow(max(dot(N, H), 0.0), mix(180.0, 16.0, rough)) * NdL * (1.0 - rough) * 0.8;
  col += mix(uBounce, uSky * 1.4, smoothstep(-0.2, 0.6, reflect(-V, N).y)) * F * (1.0 - rough) * ao * 0.7;
  float hz = 1.0 - exp(-dBehind * uHazeDensity);
  col = mix(col, hazeColor(-V, uHaze), hz);
  gl_FragColor = vec4(max(col, 0.0), q);
#endif
}`;

/** @returns {{ material, shadowMaterial }} sharing the garden's uniform bag. */
export function makeSolidMaterials(shared) {
  const mk = (shadow) =>
    new THREE.ShaderMaterial({
      vertexShader: SOLID_VERT,
      fragmentShader: SOLID_FRAG,
      defines: shadow ? { SHADOW_PASS: 1 } : {},
      uniforms: shared,
      colorWrite: !shadow,
    });
  return { material: mk(false), shadowMaterial: mk(true) };
}

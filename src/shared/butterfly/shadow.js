// SHADOW · the shadow of one butterfly, without a shadow map. Its four wings are four flat plates and its body two
// capsules, so how much of a directional light they take at any point is worked out exactly: the ray toward the light
// is met with each plate and the flat wing's opacity (the `shade` atlas) is read there. The penumbra widens with the
// distance to the receiver; the clear cells let the light through, the veins and the border do not.
//
// Use: spread shadowUniforms() into the receiver's uniforms, include shadowGLSL('<vec3 toward the light>') in its
// fragment shader, multiply its direct light by bfShadow(worldPos), and call setShadow(uniforms, glasswing) each frame.
// The same atlas makes a reflection: sample kit.atlas.shade at bfAtlasUV(p, hind) on a mirrored plate.

import * as THREE from 'three';
import { ATLAS } from './wingData.js';
import { SIG_F, SIG_H, HINGE_F, HINGE_H } from './rig.js';

const f = (x) => Number(x).toFixed(4);
const v3 = (a) => `vec3(${a.map(f).join(', ')})`;

/** Uniforms for the shadow: spread into the receiver's uniforms (or a bag every receiver shares). */
export function shadowUniforms() {
  return {
    tShade: { value: null },
    uBfPos: { value: new THREE.Vector3(0, -50, 0) }, // middle of the thorax
    uBfF: { value: new THREE.Vector3(0, 0, -1) }, // toward the head
    uBfR: { value: new THREE.Vector3(1, 0, 0) },
    uBfU: { value: new THREE.Vector3(0, 1, 0) }, // out of the back
    uBfWing: { value: new THREE.Vector4(0.5, 0.5, 0, 0.001) }, // stroke angle fore, hind; strength; world units per millimetre
    uBfWing0: { value: new THREE.Vector4(0.5, 0.5, 0, 0) }, // the stroke a frame ago (the shadow is smeared between the two); sweep
  };
}

/** @param sun GLSL expression: unit vec3 toward the light (a constant, a uniform, a macro) */
export const shadowGLSL = (sun) => /* glsl */ `
#ifndef BF_SHADOW
#define BF_SHADOW
#define BF_SHADOW_SUN (${sun})
uniform sampler2D tShade;
uniform vec3 uBfPos, uBfF, uBfR, uBfU;
uniform vec4 uBfWing, uBfWing0;
float bfCapsule(vec3 off, vec3 a, vec3 b, float ra, float rb, float soft){
  // off: from the sun ray to the thorax, square to the ray. The capsule a → b (relative to the thorax), seen along the sun.
  vec3 pa = -off - a, ba = b - a;
  pa -= BF_SHADOW_SUN * dot(pa, BF_SHADOW_SUN); ba -= BF_SHADOW_SUN * dot(ba, BF_SHADOW_SUN);
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
  return smoothstep(soft, -soft, length(pa - ba * h) - mix(ra, rb, h));
}
// 1 = the sun reaches P past the butterfly; less where a wing or the body is in the way
float bfShadow(vec3 P){
  float mm = uBfWing.w;
  if (uBfWing.z <= 0.0) return 1.0;
  vec3 rel = uBfPos - P;
  float t = dot(rel, BF_SHADOW_SUN);
  if (t < -34.0 * mm) return 1.0;
  vec3 off = rel - BF_SHADOW_SUN * t;
  if (dot(off, off) > 1300.0 * mm * mm) return 1.0;
  // The wings move a long way in a sixtieth of a second: the shadow is the average over the stroke between the last
  // frame and this one (three positions), which is what the eye would have seen — it smears, it does not strobe.
  vec2 dphi = uBfWing.xy - uBfWing0.xy;
  int taps = max(abs(dphi.x), abs(dphi.y)) > 0.03 ? 3 : 1;
  float lit = 0.0;
  for (int k = 0; k < 3; k++) {
    if (k >= taps) break;
    float l = 1.0;
    vec2 str = uBfWing0.xy + dphi * (taps == 1 ? 1.0 : float(k) * 0.5);
    for (int i = 0; i < 4; i++) {
      float hind = i > 1 ? 1.0 : 0.0;
      float side = (i == 0 || i == 2) ? 1.0 : -1.0;
      float sg = mix(${f(SIG_F)} + 0.42 * uBfWing0.z, ${f(SIG_H)} + 0.1 * uBfWing0.z, hind);
      float phi = mix(str.x, str.y, hind);
      vec3 hg = mix(${v3(HINGE_F)}, ${v3(HINGE_H)}, hind);
      float c = cos(phi), s = sin(phi);
      // the wing's own axes, in the world (see wingFrame in rig.js)
      vec3 ax = uBfR * (sin(sg) * c * side) + uBfF * cos(sg) + uBfU * (sin(sg) * s);
      vec3 ay = uBfR * (-cos(sg) * c * side) + uBfF * sin(sg) + uBfU * (-cos(sg) * s);
      vec3 n = cross(ax, ay);
      float dn = dot(BF_SHADOW_SUN, n);
      if (abs(dn) < 0.03) continue;
      vec3 O = rel + (uBfR * (hg.x * side) + uBfF * hg.y + uBfU * hg.z) * mm;    // from P to the hinge
      float d = dot(O, n) / dn;                                                  // along the ray to the plate
      if (d < 0.0004) continue;
      vec3 X = BF_SHADOW_SUN * d - O;
      vec2 q = vec2(dot(X, ax), dot(X, ay)) / mm;                                // millimetres on the wing
      if (q.x < -1.0 || q.x > mix(31.0, 21.5, hind) || q.y < mix(-8.2, -10.4, hind) || q.y > mix(4.9, 5.8, hind)) continue;
      float soft = 0.02 + d * 0.0052 / mm;                                       // the sun is a disc (mm of penumbra)
      vec2 uv = (q * ${f(ATLAS.px)} + mix(vec2(${f(ATLAS.fore[0])}, ${f(ATLAS.fore[1])}), vec2(${f(ATLAS.hind[0])}, ${f(ATLAS.hind[1])}), hind)) / ${f(ATLAS.size)};
      l *= 1.0 - textureLod(tShade, uv, clamp(log2(soft * 32.0), 0.0, 6.0)).r;
    }
    lit += l;
  }
  lit /= float(taps);
  float soft = 0.0002 + max(t, 0.0) * 0.0052;
  float body = bfCapsule(off, uBfF * (-3.0 * mm), uBfF * (4.6 * mm), 1.55 * mm, 1.0 * mm, soft);
  body = max(body, bfCapsule(off, uBfF * (-3.0 * mm), (uBfF * -11.3 - uBfU * 0.5) * mm, 0.85 * mm, 0.3 * mm, soft));
  lit *= 1.0 - 0.95 * body * step(0.0005, t);
  return mix(1.0, lit, uBfWing.z);
}
#endif
`;

/**
 * Point the shadow at a butterfly. Call every frame after it has been placed and posed.
 * @param u         the uniforms from shadowUniforms()      @param gw  a Glasswing (its group.matrix and pose are read)
 * @param strength  0 = no shadow … 1                       @param dt  seconds since the last call: > 0 smears the
 *                  shadow over the stroke since then; 0 (a still, a jump in time) draws it as it stands
 */
export function setShadow(u, gw, strength = 1, dt = 0) {
  const e = gw.group.matrix.elements;
  const mm = Math.hypot(e[0], e[1], e[2]);
  u.uBfPos.value.set(e[12], e[13], e[14]);
  u.uBfR.value.set(e[0], e[1], e[2]).divideScalar(mm);
  u.uBfF.value.set(e[4], e[5], e[6]).divideScalar(mm);
  u.uBfU.value.set(e[8], e[9], e[10]).divideScalar(mm);
  const w = gw.pose.wings;
  const cur = u.uBfWing.value;
  if (dt > 0 && cur.z > 0) u.uBfWing0.value.set(cur.x, cur.y, gw.pose.shape.y, 0);
  else u.uBfWing0.value.set(w.x, w.y, gw.pose.shape.y, 0);
  cur.set(w.x, w.y, strength, mm);
}

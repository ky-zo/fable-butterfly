// LIGHT · what the realistic materials ask of a world.
//
// The kit's wing, body and fur shaders contain no lights of their own. They call six small GLSL functions, and a
// "light rig" supplies them. Use standardLight() (a key light, a sky/ground ambient, a bounce, point lights, fog) or
// write your own rig when your world already knows better (the conservatory does: its walls are its lamps).
//
// A rig is { uniforms, common, vertex, fragment }:
//   uniforms   { name: { value } } merged into every material (share the objects: update once, all materials follow)
//   common     GLSL for BOTH stages. Must define the macros   BF_SUN_DIR  vec3, unit, toward the key light
//                                                             BF_SUN_COL  vec3, its radiance (linear HDR)
//   vertex     GLSL defining   float bfSunVisV(vec3 P)        how much of the key reaches world point P, 0..1
//                                                             (evaluated per vertex: shadow maps, cookies, 1.0)
//   fragment   GLSL defining
//       vec3 bfAmb(vec3 P, vec3 N)              irradiance at P on a surface facing N from everything but the key
//       vec3 bfEnv(vec3 P, vec3 R, float soft)  radiance arriving along R (what a glossy surface mirrors); soft 0..1
//       vec3 bfEyeKey()                         the one broad soft light a dark eye is photographed with
//       vec4 bfFinish(vec3 col, float a, vec3 P)  last word on a fragment: col is PREMULTIPLIED by a. Apply fog
//                                               here; return what goes to gl_FragColor.
// `cameraPosition`, `viewMatrix` and the hash functions of core/glsl.js are available to all of them.

import * as THREE from 'three';

/**
 * The general-purpose rig.
 * @param o.points  how many point lights (0..4): position, colour, reach. Warm lamps in a dark landscape.
 * @returns a rig, plus the handles:
 *   sunDir (Vector3, unit, toward the light) · sunColor (Vector3, linear HDR: 4–8 for a sun, 0.3–1 for a moon)
 *   sky, ground (Vector3)  ambient from above / below      bounce (Vector3) extra fill from below-and-beside
 *   fog (Vector4: rgb colour, a density per metre)         envGain (number) how bright reflections are
 *   points[i] = { position: Vector3, color: Vector3, reach: metres }   (edit, then call rig.update())
 */
export function standardLight({ points = 0 } = {}) {
  const n = Math.min(4, Math.max(0, points | 0));
  const handles = {
    sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
    sunColor: new THREE.Vector3(4.2, 3.6, 2.8),
    sky: new THREE.Vector3(0.3, 0.38, 0.5),
    ground: new THREE.Vector3(0.08, 0.09, 0.06),
    bounce: new THREE.Vector3(0, 0, 0),
    fog: new THREE.Vector4(0.5, 0.55, 0.6, 0),
    points: Array.from({ length: n }, () => ({ position: new THREE.Vector3(0, -1e3, 0), color: new THREE.Vector3(0, 0, 0), reach: 1 })),
  };
  const pt = Array.from({ length: Math.max(n, 1) }, () => new THREE.Vector4(0, -1e3, 0, 1));
  const ptCol = Array.from({ length: Math.max(n, 1) }, () => new THREE.Vector3());
  const uniforms = {
    uBfSunDir: { value: handles.sunDir },
    uBfSunCol: { value: handles.sunColor },
    uBfSky: { value: handles.sky },
    uBfGround: { value: handles.ground },
    uBfBounce: { value: handles.bounce },
    uBfFog: { value: handles.fog },
    uBfEnvGain: { value: 1 },
    uBfPt: { value: pt },
    uBfPtCol: { value: ptCol },
  };
  const common = /* glsl */ `
uniform vec3 uBfSunDir, uBfSunCol;
#define BF_SUN_DIR uBfSunDir
#define BF_SUN_COL uBfSunCol
`;
  const vertex = /* glsl */ `
float bfSunVisV(vec3 P){ return 1.0; }
`;
  const fragment = /* glsl */ `
uniform vec3 uBfSky, uBfGround, uBfBounce;
uniform vec4 uBfFog;
uniform float uBfEnvGain;
uniform vec4 uBfPt[${Math.max(n, 1)}];
uniform vec3 uBfPtCol[${Math.max(n, 1)}];
vec3 bfAmb(vec3 P, vec3 N){
  vec3 a = mix(uBfGround, uBfSky, 0.5 + 0.5 * N.y) + uBfBounce * (0.5 - 0.5 * N.y);
  for (int i = 0; i < ${n}; i++) {
    vec3 d = uBfPt[i].xyz - P;
    float r2 = dot(d, d);
    float fall = 1.0 / (1.0 + r2 / (uBfPt[i].w * uBfPt[i].w * 0.04));
    fall *= clamp(1.0 - r2 / (uBfPt[i].w * uBfPt[i].w), 0.0, 1.0);
    a += uBfPtCol[i] * fall * (0.35 + 0.65 * max(dot(N, d) * inversesqrt(r2 + 1e-9), 0.0));
  }
  return a;
}
vec3 bfEnv(vec3 P, vec3 R, float soft){
  vec3 e = mix(uBfGround * 0.8, uBfSky * 1.5, smoothstep(-0.25 - soft, 0.5 + soft, R.y));
  // (the key light itself, as a soft disc: what puts a glint in a wing at night)
  e += BF_SUN_COL * 0.06 * pow(max(dot(R, BF_SUN_DIR), 0.0), mix(900.0, 12.0, soft));
  for (int i = 0; i < ${n}; i++) {
    vec3 d = uBfPt[i].xyz - P;
    float r2 = dot(d, d);
    e += uBfPtCol[i] * clamp(1.0 - r2 / (uBfPt[i].w * uBfPt[i].w), 0.0, 1.0) * pow(max(dot(R, d) * inversesqrt(r2 + 1e-9), 0.0), mix(200.0, 8.0, soft)) * 4.0;
  }
  return e * uBfEnvGain;
}
vec3 bfEyeKey(){ return uBfSky * 1.4 + BF_SUN_COL * 0.02; }
vec4 bfFinish(vec3 col, float a, vec3 P){
  float f = 1.0 - exp(-length(P - cameraPosition) * uBfFog.a);
  return vec4(mix(col, uBfFog.rgb * a, f), a);
}
`;
  const rig = {
    ...handles,
    uniforms,
    common,
    vertex,
    fragment,
    get envGain() {
      return uniforms.uBfEnvGain.value;
    },
    set envGain(v) {
      uniforms.uBfEnvGain.value = v;
    },
    /** Copy points[] into the uniforms. Call after moving a point light or changing its colour. No allocation. */
    update() {
      for (let i = 0; i < n; i++) {
        const p = handles.points[i];
        pt[i].set(p.position.x, p.position.y, p.position.z, p.reach);
        ptCol[i].copy(p.color);
      }
      return rig;
    },
  };
  return rig;
}

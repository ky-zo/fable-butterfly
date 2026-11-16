// Shared constants + GLSL chunks for DESCENT.
// The land is one function. It is composed analytically (landBake.js), baked once into float textures, and from then
// on every consumer (terrain vertices, terrain shading, the water's mirror, the camera and the butterfly on the CPU)
// reads it through the `LAND` chunk below, so they agree exactly.

import { hash, noise } from '../../core/glsl.js';

/** The land is designed and baked in its own units; one of them is this many metres (the butterfly is not scaled). */
export const LS = 3;
export const D_HALF = 36; // near bake half-extent, design units
export const D_FAR = 288; // far bake half-extent (distant ranges)
export const FLOOR = 0.3; // the bed of the bay (design units)
export const HALF = D_HALF * LS; // … in metres
export const FAR = D_FAR * LS;
export const WATER = 1.0 * LS; // still water stands at this height (m)

export const DEFS = /* glsl */ `
#ifndef DESCENT_DEFS
#define DESCENT_DEFS
#define HALF ${HALF.toFixed(1)}
#define FARX ${FAR.toFixed(1)}
#define WATER ${WATER.toFixed(2)}
#define LS ${LS.toFixed(1)}
#define NEAR_IN ${(33 * LS).toFixed(1)}
#define NEAR_OUT ${(35.5 * LS).toFixed(1)}
#endif
`;

// ---------------------------------------------------------------------------------------------------------------
// LAND: height + gradient + sky visibility at a world xz.  land(p) = vec4(h, dh/dx, dh/dz, ao)
// B-spline bicubic reconstruction (4 bilinear taps) so the surface and its normals are smooth at any magnification.
export const LAND = /* glsl */ `
${DEFS}
#ifndef DESCENT_LAND
#define DESCENT_LAND
uniform sampler2D tLand;      // near: (h, hx, hz, ao)
uniform sampler2D tLandFar;   // far ranges
uniform vec4 uLandInfo;       // near res, 1/(2*HALF), far res, 1/(2*FAR)
const vec4 LSC = vec4(LS, 1.0, 1.0, 1.0);   // heights are stored in design units

vec4 landCubic(sampler2D t, vec2 uv, float res) {
  vec2 st = uv * res - 0.5;
  vec2 i = floor(st), f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 s0 = w0 + w1, s1 = w2 + w3;
  vec2 o0 = (i - 0.5 + w1 / s0) / res;
  vec2 o1 = (i + 1.5 + w3 / s1) / res;
  return (textureLod(t, vec2(o0.x, o0.y), 0.0) * s0.x + textureLod(t, vec2(o1.x, o0.y), 0.0) * s1.x) * s0.y
       + (textureLod(t, vec2(o0.x, o1.y), 0.0) * s0.x + textureLod(t, vec2(o1.x, o1.y), 0.0) * s1.x) * s1.y;
}
vec4 landNear(vec2 p) { return landCubic(tLand, p * uLandInfo.y + 0.5, uLandInfo.x) * LSC; }
vec4 landFar(vec2 p) { return landCubic(tLandFar, p * uLandInfo.w + 0.5, uLandInfo.z) * LSC; }
// exact (LOD 0) version: vertices
vec4 land(vec2 p) {
  float e = max(abs(p.x), abs(p.y));
  if (e < NEAR_IN) return landNear(p);
  if (e > NEAR_OUT) return landFar(p);
  return mix(landNear(p), landFar(p), smoothstep(NEAR_IN, NEAR_OUT, e));
}
// cheap smoothed height (for marching a ray over the land: shadows, the water's mirror)
float landSoft(vec2 p, float lod) {
  float e = max(abs(p.x), abs(p.y));
  return LS * (e < HALF ? textureLod(tLand, p * uLandInfo.y + 0.5, lod).x : textureLod(tLandFar, p * uLandInfo.w + 0.5, max(lod - 3.0, 0.0)).x);
}
#endif
`;

// Fragment-only: screen-space filtered version (bicubic when magnified, trilinear + aniso when minified).
export const LAND_FS = /* glsl */ `
#ifndef DESCENT_LAND_FS
#define DESCENT_LAND_FS
vec4 landShade(vec2 p) {
  vec2 uvN = p * uLandInfo.y + 0.5;
  vec2 uvF = p * uLandInfo.w + 0.5;
  float fw = max(length(dFdx(uvN)), length(dFdy(uvN))) * uLandInfo.x;   // near texels per pixel
  float e = max(abs(p.x), abs(p.y));
  vec4 tri = texture2D(tLand, uvN);
  vec4 far = texture2D(tLandFar, uvF);
  vec4 v = tri;
  if (fw < 1.1 && e < NEAR_OUT) v = mix(landCubic(tLand, uvN, uLandInfo.x), tri, smoothstep(0.55, 1.1, fw));
  return mix(v, far, smoothstep(NEAR_IN, NEAR_OUT, e)) * LSC;
}
#endif
`;

// ---------------------------------------------------------------------------------------------------------------
// SKY: one sky for the whole night. uDawn 0 = moonless and full of stars; 1 = first light: a cold zenith, a band of
// green-grey, and low on the side the sun will come from, warmth.
export const SKY = /* glsl */ `
${hash}
#ifndef DESCENT_SKY
#define DESCENT_SKY
uniform vec3 uSunDir;         // toward the sun (below the horizon all night)
uniform vec3 uSunCol;         // its radiance on the land (0 until it clears the horizon)
uniform float uDawn;          // 0 night … 1 first light
uniform float uTime;
vec3 skyBase(vec3 d) {
  float y = max(d.y, 0.0);
  vec2 sd = normalize(uSunDir.xz + 1e-5);
  float az = dot(normalize(d.xz + 1e-5), sd);
  float toward = max(az, 0.0);
  float k = pow(1.0 - y, 7.0);
  // night: nearly black overhead, a little paler low down, most of all where the day will come from
  vec3 zen = vec3(0.0040, 0.0065, 0.013);
  vec3 hor = vec3(0.022, 0.036, 0.066) * (1.0 + 2.6 * toward * toward * toward);
  vec3 night = mix(zen, hor, k);
  // first light: the whole sky lifts cold; low on the sun's side it goes through green-grey to a band of warmth
  // that hugs the horizon
  float d2 = uDawn * uDawn;
  float t2 = toward * toward;
  vec3 zenD = vec3(0.022, 0.048, 0.105);
  vec3 midD = mix(vec3(0.042, 0.08, 0.1), vec3(0.08, 0.125, 0.11), t2);
  vec3 lowD = mix(vec3(0.07, 0.105, 0.13), vec3(0.8, 0.33, 0.1), t2 * toward);
  vec3 day = mix(zenD, midD, pow(1.0 - y, 4.0));
  day = mix(day, lowD, pow(1.0 - y, 13.0));
  // the glow around where the sun is about to be
  float sa = max(dot(normalize(d), normalize(uSunDir)), 0.0);
  day += vec3(1.3, 0.55, 0.2) * (pow(sa, 40.0) * 0.2 + pow(sa, 500.0) * 1.2) * smoothstep(0.35, 1.0, uDawn);
  return night * (1.0 - 0.6 * d2) + day * d2;
}
// stars for a ray (px = angular size of a pixel)
vec3 starField(vec3 d, float px) {
  vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0)));
  float sc = 90.0;
  vec2 cell = floor(sp * sc);
  vec2 hh = hash22(cell);
  float m = hash12(cell + 9.1);
  vec2 c = (cell + 0.2 + 0.6 * hh) / sc;
  float dd = length((sp - c) * vec2(cos(sp.y), 1.0));
  float mag = pow(m, 11.0) * 2.2;
  float tw = 0.8 + 0.2 * sin(uTime * (1.0 + 3.0 * hh.x) + hh.y * 40.0);
  float star = exp(-dd * dd / (px * px * 0.6)) * mag * tw;
  float fade = (1.0 - uDawn) * (1.0 - uDawn);
  return mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.9, 0.78), hh.y) * star * 1.6 * smoothstep(0.0, 0.1, d.y) * fade;
}
#endif
`;

// ---------------------------------------------------------------------------------------------------------------
// AIR: a thin haze for depth, mist that pools on low ground and over the water (thicker toward morning), and the
// lamp's own halo in it (the exact integral of an inverse-square light along the ray through uniform air).
export const AIR = /* glsl */ `
${SKY}
#ifndef DESCENT_AIR
#define DESCENT_AIR
uniform vec3 uCam;
uniform vec4 uFog;            // x: pooled density, y: base height, z: scale height, w: haze density
uniform vec4 uLamp;           // xyz, w = how bright it is 0..1
uniform vec3 uLampCol;
uniform float uHalo;

float fogOptical(vec3 ro, vec3 rd, float t) {
  float a = uFog.x * exp(-(ro.y - uFog.y) / uFog.z);
  float k = rd.y / uFog.z;
  float integ = abs(k) < 1e-4 ? t : (1.0 - exp(-k * t)) / k;
  return uFog.w * t + a * integ;
}
vec3 lampHalo(vec3 rd, float t) {
  vec3 q = uCam - uLamp.xyz;
  float b = dot(rd, q);
  float sb = sqrt(max(dot(q, q) - b * b, 0.0009));
  float I = (atan((t + b) / sb) - atan(b / sb)) / sb;
  return uLampCol * (uLamp.w * uHalo * I);
}
// col seen through the air between the camera and a point at distance t along rd
vec3 applyAir(vec3 col, vec3 rd, float t) {
  float T = exp(-fogOptical(uCam, rd, t));
  vec3 air = skyBase(vec3(rd.x, 0.02 + 0.2 * abs(rd.y), rd.z)) * 0.7;
  return col * T + air * (1.0 - T) + lampHalo(rd, t);
}
#endif
`;

export { hash, noise };

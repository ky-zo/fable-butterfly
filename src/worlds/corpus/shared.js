// GLSL shared by the water, the glyph field, the spray and the sky, so that every part of the picture agrees
// about the moon, the haze, where text gathers, how a letter is lit and where glyph quads hand over to the far field.

import * as THREE from 'three';
import { WIND, setWarpNoise } from './waves.js';

/**
 * Four independent channels of smooth noise in one bilinear lookup: a 256² half-float lattice of random values.
 * Every shader stage reads it with textureLod, so vertices and pixels see exactly the same field.
 */
export function makeNoiseTexture(ctx) {
  const n = 256;
  const rnd = ctx.rng(1234);
  const data = new Uint16Array(n * n * 4);
  for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(rnd());
  // the sea's CPU mirror needs the same field to bend its short waves exactly as the shaders do
  const rg = new Float32Array(n * n * 2);
  for (let i = 0; i < n * n; i++) {
    rg[i * 2] = THREE.DataUtils.fromHalfFloat(data[i * 4]);
    rg[i * 2 + 1] = THREE.DataUtils.fromHalfFloat(data[i * 4 + 1]);
  }
  setWarpNoise(rg, n);
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  ctx.track(tex);
  return tex;
}

export const NOISE_GLSL = /* glsl */ `
#ifndef CORPUS_NOISE
#define CORPUS_NOISE
uniform sampler2D tNoise;
vec4 noise4(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(tNoise, (i + f + 0.5) / 256.0, 0.0);
}
#endif
`;

export const NREC = 8;

const f = (x) => {
  const t = x.toFixed(5);
  return t.includes('.') ? t : t + '.0';
};

export const COMMON_GLSL = /* glsl */ `
#ifndef CORPUS_COMMON
#define CORPUS_COMMON
#define NREC ${NREC}
#ifndef CORPUS_CAM
#define CORPUS_CAM
uniform vec3 uCam;
#endif
uniform vec3 uMoonDir;
uniform vec3 uMoonCol;
uniform float uPpm;            // pixels per metre at one metre from the lens
uniform vec4 uLod;             // x: reference em (m), y: fade start radius, z: fade end radius, w: unused
uniform vec4 uRecall[NREC];    // recalled places: x, z, radius, strength
uniform float uDrift;
uniform vec4 uShoal;           // the patch of sea where crests break: centre x, z, 1 / radius x, 1 / radius z
uniform float uBreak;          // 0..1 how hard it is breaking there
uniform vec4 uLamp;            // the light on the shore: position, w = how much of it there is (0 until the land is near)
uniform float uLand;           // 0..1 how far the land has come out of the haze
uniform float uVeil;           // 0..1 cloud over the moon (uMoonCol already carries its dimming)
uniform vec4 uWake;            // where the butterfly is over the water: base x, base z, radius (m), strength
uniform vec4 uCapt;            // where the caption stands on the screen, in NDC: half width, top, bottom; w: is one standing (0..1)

const vec3 BONE = vec3(0.90, 0.855, 0.76);
const vec3 AMBER = vec3(1.0, 0.56, 0.19);
const float TIPK = 1.75;        // a letter leans up towards the reader as far as the line pitch lets it without covering the line behind
const float TIPMAX = 0.56;
const float GW = 0.052;         // glint lobe width in slope space
const float GS2 = 0.030;        // silvering lobe (variance) around the mirror angle

// ---------------------------------------------------------------- sky (no disc, no stars, no cloud): also what the water mirrors
vec3 skyGlow(vec3 d){
  float y = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(vec3(0.0100, 0.0180, 0.0335), vec3(0.0020, 0.0040, 0.0100), pow(y, 0.40));
  float th = sqrt(max(2.0 - 2.0 * dot(d, uMoonDir), 0.0));   // angle from the moon (chord length: exact where it matters)
  // aureole: forward scattering in thin maritime haze
  float g = 0.55 * exp(-th / 0.030) + 0.066 * exp(-th / 0.12) + 0.009 * exp(-th / 0.45);
  c += uMoonCol * g;
  // a low band of mist on the horizon, catching the moon
  vec2 dh = normalize(d.xz + vec2(1e-5));
  float mh = max(dot(dh, normalize(uMoonDir.xz)), 0.0);
  float band = exp(-y * 11.0);
  c += vec3(0.0085, 0.0135, 0.0215) * band * (0.55 + 3.2 * pow(mh, 8.0) + 0.6 * pow(mh, 2.0));
  return c;
}

// ---------------------------------------------------------------- where the writing gathers (windrows and slicks)
float textDensity(vec2 b, float dist){
  vec2 q = vec2(dot(b, vec2(${f(Math.cos(WIND))}, ${f(-Math.sin(WIND))})), dot(b, vec2(${f(Math.sin(WIND))}, ${f(Math.cos(WIND))})));
  float n1 = noise4(q * vec2(0.085, 0.021) + vec2(3.1, uDrift)).r;
  float n2 = noise4(q * vec2(0.021, 0.012) + vec2(11.7, uDrift * 0.4)).g;
  float n3 = dist < 120.0 ? noise4(q * vec2(0.33, 0.11) + vec2(5.3, uDrift * 2.0)).b : 0.5;
  float d = n1 * 0.50 + n2 * 0.36 + n3 * 0.14;
  return smoothstep(0.23, 0.41, d);
}

// ---------------------------------------------------------------- the shoal
// 0..1: how much the sea at base point b is breaking right now. J is the Jacobian of the wave displacement there:
// below 1 where the surface is being squeezed together, which is what a crest is, however low it stands.
float breaking(vec2 b, float J){
  vec2 d = (b - uShoal.xy) * uShoal.zw;
  return uBreak * (1.0 - smoothstep(0.55, 1.25, dot(d, d))) * (1.0 - smoothstep(0.68, 0.91, J));
}

// ---------------------------------------------------------------- recalled places
float recallWarm(vec2 b){
  float w = 0.0;
  for (int i = 0; i < NREC; i++) {
    vec4 r = uRecall[i];
    if (r.w <= 0.001) continue;
    vec2 d = b - r.xy;
    w += r.w * exp(-dot(d, d) / (r.z * r.z));
  }
  return w;
}

// ---------------------------------------------------------------- how much of the writing is afloat
// dens: the windrow field (0..1). up: 0 in a trough … 1 on a crest. Returns the fraction of phrases that show there:
// inside a windrow every line rides the crests and two in three stay down in the troughs; outside one, a few
// words still surface along the tops of the waves, the way foam does.
float textFrac(float dens, float up){
  return dens * (0.70 + 0.30 * up) + (1.0 - dens) * 0.36 * smoothstep(0.42, 1.0, up);
}
float seaUp(float h){ return smoothstep(-0.42, 0.66, h); }   // surface height (m) → 0 trough … 1 crest

// ---------------------------------------------------------------- one letter, lit by the moon and the sky
// n: the water's normal under the letter. The moon is low and ahead, so the far side of every wave is lit and the
// side that faces the reader stands in its own shade; troughs are darker than crests.
vec3 letterLit(vec3 n, float crest, float up){
  float lam = smoothstep(-0.16, 0.42, dot(n, uMoonDir));
  vec3 c = BONE * (uMoonCol * (0.21 + 0.60 * lam) * (0.62 + 0.58 * up) + vec3(0.011, 0.018, 0.031) * (0.55 + 0.9 * up));
  return c * (1.0 + crest * 1.5);
}

// slope-space mirror test: how far a facet with the water's mean normal is from throwing the moon into the lens.
// Add the facet's own tilt to the result; exp(-|d|^2 / GW^2) is the flash, a wider lobe the silvering around it.
vec2 mirrorDelta(vec3 nMean, vec3 V){
  vec3 H = normalize(V + uMoonDir);
  return -nMean.xz / max(nMean.y, 0.08) + H.xz / max(H.y, 0.08);
}

// ---------------------------------------------------------------- the moon road
// The writing can only be read where the moon lies on the water. n: the swell's normal, V: toward the lens.
// 1 on the road, falling to 0 either side of it. The road is as wide as the moon at the horizon and opens toward
// the reader, because the nearer water is looked down on more steeply; a wave face tipped the right way carries a
// piece of it off to one side.
float moonRoad(vec3 n, vec3 V){
  vec2 m = mirrorDelta(n, V);
  vec2 a = normalize(uMoonDir.xz);
  float along = dot(m, a), across = m.x * a.y - m.y * a.x;
  return exp(-across * across / 0.105 - along * along / 0.62) * (1.0 - uVeil);
}

// The words the butterfly is seen against: base point b → how warm. uWake: centre (base x, z), how far the patch
// reaches along the line of flight (m; it is 0.2 m across), strength.
float wakeWarm(vec2 b){
  vec2 d = b - uWake.xy;
  float ax = d.x / 0.26, az = d.y / uWake.z;
  return uWake.w * exp(-ax * ax - az * az);
}

// ---------------------------------------------------------------- the caption's place
// The sea does not write where the caption is standing: 1 inside that part of the frame, 0 clear of it (n: NDC).
// The edges are wide, because a letter out of focus spreads.
float captZone(vec2 n){
  if (uCapt.w <= 0.0) return 0.0;
  return uCapt.w * (1.0 - smoothstep(uCapt.x, uCapt.x + 0.16, abs(n.x))) * (1.0 - smoothstep(uCapt.y, uCapt.y + 0.11, n.y)) * smoothstep(uCapt.z - 0.11, uCapt.z, n.y);
}

// ---------------------------------------------------------------- near/far hand-over
// Weight of the instanced glyph quads at surface point P (1 = quads, 0 = far-field texture), and how far a
// glyph there leans up towards the reader. Evaluated identically by the glyph vertices and the water pixels.
float glyphLod(vec3 P, vec3 N, out float tip){
  vec3 tc = uCam - P;
  float d = length(tc);
  vec3 V = tc / d;
  float sg = clamp(dot(V, N), 0.0, 1.0);
  float gam = asin(sg);
  tip = clamp(asin(min(TIPK * sg, 0.96)) - gam, 0.0, TIPMAX);
  float px = uLod.x * uPpm / d * sin(min(gam + tip, 1.5708));
  float hd = length(tc.xz);
  return smoothstep(1.3, 3.2, px) * (1.0 - smoothstep(uLod.y, uLod.z, hd));
}
#endif
`;

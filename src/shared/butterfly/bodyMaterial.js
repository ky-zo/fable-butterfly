// MATERIAL · skin and fur of the body (see bodyGeo.js for the parts). Lighting comes from a rig (light.js).
//   thorax, head   black velvet: a short pile that only shows where the light rakes it, crisp white dots
//   abdomen        slender, black above, cream underneath, a fine pale line down each flank where the two meet
//   antennae       hair-fine, black, ending in a pale orange club that the light comes through
//   (antennae and legs are never drawn thinner than a pixel: see uBfRes. In 'blend' mode they are a second, blended
//   draw of the same mesh — define BF_LIMBS — a pixel and a half wide and as faint as they are thin, so that a hair
//   is a soft line and not a staircase; the body proper is then drawn with BF_NO_LIMBS)
//   eyes           compound: a few thousand facets, each a small lens. The ones that look straight down the camera's
//                  axis swallow everything (the dark spot that follows you round a butterfly's eye); the rest hold the
//                  world around them and, when the key light finds them, the key light.
//   tongue, antennae, legs   chitin: dark, ringed, glossy
// Fur is a second mesh of hair quads turned toward the lens, blended over the skin.

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { PART, SPOTS, EYE, EYE_R, CLUB, ABDOMEN } from './bodyData.js';
import { bodyVertexGLSL } from './rig.js';

const v3 = (a) => `vec3(${a.map((x) => x.toFixed(3)).join(', ')})`;

const BODY_VERT = (L) => /* glsl */ `
${bodyVertexGLSL}
attribute float aRad;      // half-width of the part at this vertex (mm)
uniform vec2 uBfRes;       // size of the target being drawn into (px); (0, 0) = not known, draw things as thin as they are
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vPart;
varying vec4 vLook;
varying float vSun;
varying vec3 vSunB;
varying vec2 vThin;        // half-width as drawn, half-width as it is (px); (0, 0) = not a hair
${hash}
${L.common}
${L.vertex}
void main(){
  mat4 m = bfModel();
  vec3 p = bfBody();
  vObj = p; vPart = aPart; vLook = BF_LOOK;
  vec4 wp = m * vec4(p, 1.0);
  vThin = vec2(0.0);
  bool hair = aPart.x > 5.5;
#ifdef BF_LIMBS
  const float LEAST = 0.8;
#else
  const float LEAST = 0.52;
#endif
  if (hair && aRad > 0.0 && uBfRes.y > 1.0) {
    // an antenna, a leg, a claw: hair-fine, but never thinner than a pixel (it would break up into dashes)
    float pxPerMm = projectionMatrix[1][1] * 0.5 * uBfRes.y / max((projectionMatrix * viewMatrix * wp).w, 1e-4) * length(m[0].xyz);
    float is = aRad * pxPerMm;
    float thin = LEAST / max(is, 1e-3);
    if (thin > 1.0) wp = m * vec4(p + normal * aRad * (thin - 1.0), 1.0);
    vThin = vec2(max(is, LEAST), is);
  }
  vWorld = wp.xyz;
  vNormal = normalize(mat3(m) * normal);
  vSun = bfSunVisV(wp.xyz);
  vSunB = BF_SUN_DIR * mat3(m);                  // the key light as the body sees it (not normalised)
  gl_Position = projectionMatrix * viewMatrix * wp;
#ifdef BF_LIMBS
  if (!hair) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#endif
#ifdef BF_NO_LIMBS
  if (hair) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#endif
}`;

const BODY_FRAG = (L) => /* glsl */ `
precision highp float;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vPart;
varying vec4 vLook;
varying float vSun;
varying vec3 vSunB;
varying vec2 vThin;
uniform sampler2D tNoise;
uniform vec4 uSpots[${SPOTS.length}];
${hash}
${L.common}
${L.fragment}
#ifdef BF_EYE_MAP
uniform sampler2D tBfEye;      // what the eye has in front of it (any picture a world draws for it; linear HDR)
uniform float uBfEye;          // how much of it the eye holds, 0..1
// The eye as a small dark convex mirror with the whole picture in it, the way a bead of water holds a room: the middle
// of the picture in the middle of the dome, its edges gathered in toward the rim.
vec3 eyeGarden(vec3 n, float lod){
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), normalize(mat3(viewMatrix) * n));
  vec2 uv = vec2(0.5) + r.xy * vec2(-0.42, 0.46);
  vec3 g = textureLod(tBfEye, clamp(uv, 0.01, 0.99), lod).rgb;
  // (a dark mirror keeps the picture and loses the glare: highlights are held back, and what is left is given the
  // contrast and the colour a wet black surface gives a reflection)
  float l = dot(g, vec3(0.3, 0.5, 0.2));
  g = g / (1.0 + 0.3 * l);
  l = dot(g, vec3(0.3, 0.5, 0.2));
  g = max(mix(vec3(l), g, 1.6), 0.0);
  return g * sqrt(g) * (0.7 + 1.5 * smoothstep(0.05, 0.9, l));
}
#endif
// ---- what the body hides from itself (body frame, mm)
// the sky, from its own creases: under the thorax among the hips, the neck, the waist, where a leg leaves the body
float bfBodyAO(vec3 P, vec4 part){
  float id = part.x, ao = 1.0;
  if (id < 0.5) {
    ao *= mix(1.0, 0.5, smoothstep(0.1, -1.5, P.z));
    ao *= 1.0 - 0.45 * exp(-pow((P.y - 3.05) / 0.45, 2.0)) - 0.4 * exp(-pow((P.y + 3.1) / 0.5, 2.0));
  } else if (id < 1.5) {
    ao *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.07, part.y));
  } else if (id < 2.5) {
    ao *= 1.0 - 0.4 * smoothstep(3.75, 3.1, P.y);
  } else if (id > 3.5 && id < 5.5) {
    ao *= 0.72;
  } else if (id > 6.5) {
    ao *= mix(0.5, 1.0, smoothstep(0.02, 0.3, part.y));
  }
  return ao;
}
// the key light, from the three big parts: each is an ellipsoid, and what it hides is soft-edged
float bfOcc(vec3 P, vec3 L, vec3 c, vec3 r){
  vec3 o = (c - P) / r, d = normalize(L / r);
  float t = dot(o, d);
  if (t < 0.0) return 0.0;
  return (1.0 - smoothstep(0.72, 1.15, length(o - d * t))) * smoothstep(0.0, 0.7, t);
}
float bfBodyShadow(vec3 P, vec3 L, float id){
  float s = 0.0;
  if (id > 0.5) s = max(s, bfOcc(P, L, vec3(0.0, -0.1, 0.25), vec3(1.52, 3.2, 1.62)));                // the thorax
  if (id < 0.5 || id > 1.5) s = max(s, bfOcc(P, L, vec3(0.0, -6.0, -0.05), vec3(0.82, 3.3, 0.88)));   // the front of the abdomen
  if (id < 1.5 || id > 3.5) s = max(s, bfOcc(P, L, vec3(0.0, 4.0, 0.18), vec3(1.25, 1.0, 1.05)));     // the head and its eyes
  return 1.0 - 0.92 * s;
}
void main(){
  int part = int(vPart.x + 0.5);
  float u = vPart.y, ang = vPart.z * 6.2831853;
  vec3 P = vObj;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float px = length(fwidth(P)) * 0.7;                       // mm per pixel
  vec4 n1 = texture2D(tNoise, P.xy * 0.19 + P.z * 0.11);
  vec4 n2 = texture2D(tNoise, P.yz * 1.9 + P.x * 1.3);
  float species = vLook.x;
  float white = 0.0;
  if (part == ${PART.THORAX} || part == ${PART.HEAD}) {
    for (int i = 0; i < ${SPOTS.length}; i++) {
      vec4 s = uSpots[i];
      // (a tuft of white scales, not a painted disc: its edge is soft and a little ragged)
      white = max(white, 1.0 - smoothstep(s.w - 0.07 - px, s.w + 0.05 + px, length(vec3(abs(P.x), P.yz) - s.xyz) + (n2.g - 0.5) * 0.09));
    }
  }
  vec3 dark = species > 1.5 ? vec3(0.07, 0.065, 0.06) : vec3(0.0105, 0.0095, 0.0105);
  vec3 pale = vec3(0.62, 0.61, 0.56);
  vec3 alb = dark; float rough = 0.6, fuzz = 0.0, gloss = 0.35;
  vec3 lucent = vec3(0.0);                                   // what comes through it when the light is behind
  bool eye = false;
  if (part == ${PART.THORAX}) {
    alb = mix(dark, pale, white); fuzz = 1.0; rough = 0.95; gloss = 0.0;
  } else if (part == ${PART.ABDOMEN}) {
    // black above; underneath a soft grey-buff that comes up over the flank with no line between the two; the joints
    // are hairlines a shade darker. Matt: seen from above it stays black whatever the light does.
    float sa = sin(ang);
    float belly = smoothstep(0.0, -0.95, sa);
    float fs = fract(u * ${ABDOMEN.segments.toFixed(1)});
    alb = mix(dark * 1.2, vec3(0.032, 0.03, 0.027) * (0.85 + 0.3 * n2.g), belly * belly);
    alb = mix(alb, vec3(0.085, 0.08, 0.07), 0.45 * smoothstep(0.12, 0.03, abs(sa + 0.45)) * (1.0 - smoothstep(0.55, 0.95, u)));   // a faint paler line low on each flank
    alb *= 1.0 - 0.22 * smoothstep(0.06, 0.0, min(fs, 1.0 - fs)) * smoothstep(0.2, 0.04, px);                        // the joint between two segments
    fuzz = 0.5 * (1.0 - smoothstep(0.0, 0.3, u)) + 0.12; rough = 0.8; gloss = 0.02;
  } else if (part == ${PART.HEAD}) {
    alb = mix(dark, pale, white); fuzz = 0.8; rough = 0.9; gloss = 0.0;
  } else if (part == ${PART.EYE}) {
    eye = true;
  } else if (part == ${PART.PALP}) {
    alb = mix(dark, pale * 0.6, smoothstep(-0.3, -0.85, sin(ang)) * 0.5); fuzz = 0.6; rough = 0.9; gloss = 0.0;
  } else if (part == ${PART.TONGUE}) {
    // the tongue: two half-tubes zipped together down the middle (a seam on the outside of the coil), ringed like a hose
    float ring = cos(u * 150.0 * 6.2831853);
    float zip = smoothstep(0.16, 0.02, abs(sin(ang * 0.5 + 0.785)));
    alb = vec3(0.075, 0.034, 0.014) * (0.7 + 0.3 * ring * smoothstep(0.05, 0.012, px)) * (1.0 - 0.7 * zip); rough = 0.2; gloss = 0.9;
    N = normalize(N + normalize(dFdx(P) * dFdx(u) + dFdy(P) * dFdy(u) + 1e-6) * sin(u * 150.0 * 6.2831853) * 0.35 * smoothstep(0.05, 0.012, px));
  } else if (part == ${PART.ANTENNA}) {
    float ring = mix(1.0, 0.75 + 0.25 * smoothstep(0.1, 0.3, abs(fract(u * 60.0) - 0.5)), smoothstep(0.03, 0.012, px));
    // the club: pale orange, a little translucent, darker at the very tip
    float club = smoothstep(${(CLUB - 0.02).toFixed(3)}, ${(CLUB + 0.08).toFixed(3)}, u);
    vec3 clubC = mix(vec3(0.82, 0.4, 0.07), vec3(0.5, 0.17, 0.03), smoothstep(0.93, 1.0, u));
    // (thinner than a pixel it has no highlight to show: only its own colour)
    alb = mix(vec3(0.012, 0.01, 0.009), clubC, club) * ring; rough = mix(0.35, 0.5, club); gloss = mix(0.25, 0.5, club) * smoothstep(0.09, 0.025, px);
    lucent = clubC * club * 0.7;
  } else {
    // legs: dark, with a line of pale scales down the outside of femur and tibia; spines; a ringed foot
    float outer = smoothstep(0.8, 0.99, sin(ang)) * step(u, 0.72) * step(0.1, u);
    alb = mix(vec3(0.016, 0.013, 0.012), vec3(0.3, 0.29, 0.26), outer * 0.6);
    alb *= 0.8 + 0.4 * n1.g;
    // the joints: a paler collar of membrane at the knee and at the heel
    alb = mix(alb, vec3(0.09, 0.075, 0.06), 0.6 * max(exp(-pow((u - 0.4) / 0.014, 2.0)), exp(-pow((u - 0.72) / 0.012, 2.0))));
    if (u > 0.72) alb *= 0.7 + 0.3 * smoothstep(0.1, 0.3, abs(fract((u - 0.72) / 0.28 * 5.0) - 0.5));
    if (vPart.w < -1.5) { alb = mix(dark * 1.6, pale * 0.7, smoothstep(0.2, 0.8, sin(ang))); fuzz = 0.6; }
    rough = 0.42; gloss = 0.5 * smoothstep(0.16, 0.05, px);
  }
  if (species > 0.5 && species < 1.5 && part == ${PART.ABDOMEN}) alb = mix(alb, vec3(0.5, 0.2, 0.03), 0.5);

  vec3 sun = BF_SUN_COL * vSun;
  vec3 col;
  float NdV = max(dot(N, V), 0.0);
  vec3 H = normalize(BF_SUN_DIR + V);
  if (eye) {
    // ---- the compound eye: a dome of hexagonal facets, each the lens of one ommatidium
    vec3 c = vec3(sign(P.x) * ${EYE[0].toFixed(3)}, ${EYE[1].toFixed(3)}, ${EYE[2].toFixed(3)});
    vec3 d = normalize((P - c) / ${v3(EYE_R)});
    vec2 e = vec2(d.y, d.z) / (1.0 + abs(d.x));
    const float S = 44.0;
    vec2 h = e * S;
    vec2 r = vec2(1.0, 1.7320508);
    vec2 a = mod(h, r) - r * 0.5, b = mod(h - r * 0.5, r) - r * 0.5;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;                 // where this pixel is within its facet
    vec2 fid = h - g;                                       // which facet
    vec2 ag = abs(g);
    float fd = max(ag.x, ag.x * 0.5 + ag.y * 0.8660254) * 2.0;     // 0 in the middle of the hexagon … 1 on its edge
    float fpx = length(fwidth(h));
    float lodE = smoothstep(0.7, 0.2, fpx);                 // the facets can be told apart
    float big = smoothstep(0.1, 0.025, fpx);                // …and each is many pixels wide (the lens is on the eye)
    float fr = hash12(fid + 7.0);
    vec3 t1 = normalize(cross(N, vec3(0.0, 1.0, 0.0))), t2 = cross(N, t1);
    // each lens is a small dome of its own, flattening toward the seam it shares with its neighbours
    vec3 Ne = normalize(N + (t1 * g.x + t2 * g.y) * mix(0.5, 0.95, big) * lodE);
    float seam = smoothstep(mix(0.74, 0.86, big), 1.0, fd) * lodE;
    // the pseudopupil: the facets that look straight back down the lens swallow its light, and so the dark spot
    // follows the viewer round the eye. Six fainter ones ring it. Its edge is made of whole facets.
    vec3 Nv = mat3(viewMatrix) * N;
    // (from too far off to tell the facets it is a soft round shadow, not a block)
    float pp = smoothstep(mix(0.86, 0.945, lodE), 0.992, NdV + (fr - 0.5) * 0.012 * lodE) * mix(0.75, 1.0, lodE);
    float six = 0.5 + 0.5 * cos(6.0 * atan(Nv.y, Nv.x));
    pp = max(pp, smoothstep(0.035, 0.0, abs(NdV - 0.86)) * smoothstep(0.4, 0.9, six) * 0.5);
    vec3 amb = bfAmb(vWorld, N);
    // dark amber, deeper where the light has to come a long way through it; no two lenses quite the same
    vec3 base = vec3(0.04, 0.016, 0.008) * (0.7 + 0.6 * n1.g) * (0.82 + 0.36 * fr * lodE);
    col = base * (amb + sun * max(dot(N, BF_SUN_DIR), 0.0) * 0.5) * (0.7 + 0.5 * (1.0 - fd * fd) * lodE);
    col += vec3(0.1, 0.035, 0.01) * bfAmb(vWorld, -V) * pow(1.0 - NdV, 2.0) * 0.1;
    col *= (1.0 - 0.9 * pp) * (1.0 - 0.75 * seam);
    // every facet is a lens with the world in it
    vec3 Re = reflect(-V, Ne);
    float Fe = 0.05 + 0.22 * pow(1.0 - NdV, 5.0);
    vec3 envE = bfEnv(vWorld, Re, 0.02);
    // (and the one broad soft light a dark eye is always photographed with, taken as a single pale sheet above and a
    // little to one side of the lens: across the dome it is one soft patch, and in that patch every lens has its own
    // small bright copy of it)
    vec3 Kv = normalize(vec3(-0.45, 0.62, 0.64));
    vec3 Nve = mat3(viewMatrix) * Ne;
    float key = pow(max(dot(Nve, Kv), 0.0), 14.0);
    float glint = pow(max(dot(Nv, Kv), 0.0), 5.0) * pow(max(dot(Nve, Kv), 0.0), 90.0) * 5.0 * lodE;
    // (from too far off to tell the facets apart that patch is one clean catch-light: the point of life in a dark eye.
    // It stays where the light is, so it moves over the eye as the head turns)
    glint += pow(max(dot(Nv, Kv), 0.0), 60.0) * 7.0 * (1.0 - lodE);
    envE += bfEyeKey() * (key + glint);
#ifdef BF_EYE_MAP
    if (uBfEye > 0.001) {
      // the lens is close enough to see what the eye holds. Across the dome, softly, the whole picture as a dark
      // mirror has it; and in every facet the same picture again, small and complete, each from where that facet stands
      vec3 whole = eyeGarden(normalize(mix(N, Ne, 0.3)), 0.0);
      vec3 each = eyeGarden(Ne, 0.5);
      vec3 gdn = mix(whole * 0.8 + each * 0.35, whole * 0.3 + each * 1.0, big) * (0.9 + 0.2 * fr);
      float wg = uBfEye * (1.0 - 0.8 * pp);
      envE = mix(envE, gdn + bfEyeKey() * glint * 0.6, wg);
      Fe = mix(Fe, 0.8 + 0.2 * pow(1.0 - NdV, 3.0), wg);
      col *= 1.0 - 0.55 * wg;                                // (a mirror shows its own colour less)
      col += vec3(0.03, 0.011, 0.003) * (amb + bfEyeKey() * 0.4) * (1.0 - pp) * (0.5 + 0.5 * (1.0 - fd * fd)) * uBfEye;   // amber from inside
    }
#endif
    col += envE * Fe * (1.0 - 0.7 * seam);
    col += sun * (exp(-(1.0 - max(dot(Ne, H), 0.0)) * 900.0) * 14.0 + exp(-(1.0 - max(dot(N, H), 0.0)) * 60.0) * 0.25) * step(0.0, dot(N, BF_SUN_DIR));
  } else {
    float ao = bfBodyAO(P, vPart);
    sun *= bfBodyShadow(P, vSunB, vPart.x);
    // (under the pile the skin is not smooth either: scales, lying back along the body like the fur above them)
    vec4 n3 = texture2D(tNoise, vec2(ang * 1.7, P.y * 0.45) + P.x * 0.07);
    float pile = fuzz * smoothstep(0.12, 0.02, px);
    alb *= 1.0 + pile * (n3.g * 1.1 - 0.55);
    N = normalize(N + (vec3(n3.r, n3.a, n3.g) - 0.5) * 0.7 * pile);
    float ndl = dot(N, BF_SUN_DIR);
    float wrap = mix(max(ndl, 0.0), max((ndl + 0.6) / 1.6, 0.0), fuzz);
    vec3 amb = bfAmb(vWorld, N) * ao;
    col = alb * (amb + sun * wrap * 0.5);
    // velvet: the pile only shows where light rakes across it — a pale edge, lit by whatever is bright beside and behind
    // (it is what draws the body's outline when the body is black and so is what it sits on)
    float rim = pow(1.0 - NdV, 2.6);
    float back = pow(max(dot(-V, BF_SUN_DIR), 0.0), 3.0);
    vec3 beside = bfAmb(vWorld, normalize(N - V * 0.85)) * mix(ao, 1.0, 0.5);
    // (a rim is light from beside that is not also coming from the lens's side: in a room that is bright all round
    // black velvet has no rim, it is black)
    vec3 rimL = max(beside - bfAmb(vWorld, V) * 0.8, 0.0) + beside * 0.2;
    col += fuzz * rim * (alb * 0.9 + vec3(0.05, 0.047, 0.048)) * (rimL * 0.9 + sun * (0.2 + 1.6 * back) * smoothstep(-0.7, 0.2, ndl));
    col += lucent * (bfAmb(vWorld, -N) * 0.5 + sun * (max(-ndl, 0.0) * 0.3 + back * 0.4));
    // chitin
    vec3 Nb = normalize(N + (vec3(n2.r, n2.g, n2.a) - 0.5) * 0.25 * rough);
    vec3 R = reflect(-V, Nb);
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(Nb, V), 0.0), 5.0);
    col += bfEnv(vWorld, R, 0.05 + rough * 0.4) * F * gloss * mix(ao, 1.0, 0.4);
    float a2 = pow(max(rough, 0.12), 4.0);
    float nh = max(dot(Nb, H), 0.0);
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    col += sun * (a2 / (3.14159 * dd * dd)) * max(ndl, 0.0) * 0.06 * gloss;
  }
#ifdef BF_LIMBS
  // a hair: its outline fades over a pixel, and where it is drawn wider than it is, it is as faint as it is thin
  float across = sqrt(max(1.0 - pow(dot(normalize(vNormal), V), 2.0), 0.0));       // 0 on its middle line … 1 on its outline
  float cov = clamp(vThin.x * (1.0 - across) + 0.2, 0.0, 1.0) * clamp(2.0 * vThin.y / max(0.9 * vThin.x, 1e-3), 0.34, 1.0);
  gl_FragColor = bfFinish(max(col, 0.0) * cov, cov, vWorld);
#else
  gl_FragColor = bfFinish(max(col, 0.0), 1.0, vWorld);
#endif
}`;

const FUR_VERT = (L) => /* glsl */ `
attribute vec3 aTip;
attribute vec4 aHair;      // 0 root … 1 tip, ±1 across, random, white
uniform vec2 uBfRes;           // size of the target being drawn into (px)
varying vec4 vHair;
varying vec3 vWorld;
varying vec3 vDir;
varying float vAlpha;
varying float vSun;
${hash}
${L.common}
${L.vertex}
void main(){
  vec4 wr = modelMatrix * vec4(position, 1.0);
  vec4 wt = modelMatrix * vec4(position + aTip, 1.0);
  // (a hair is not straight: it lies back a little more toward its tip)
  vec3 wp = mix(wr.xyz, wt.xyz, aHair.x);
  mat4 pv = projectionMatrix * viewMatrix;
  vec4 c0 = pv * wr, c1 = pv * wt, cp = pv * vec4(wp, 1.0);
  vec2 dir = (c1.xy / c1.w - c0.xy / c0.w) * uBfRes;
  dir = normalize(dir + vec2(1e-4, 0.0));
  float mm = length(modelMatrix[0].xyz);                           // metres per millimetre of the model
  float pxPerMm = projectionMatrix[1][1] * 0.5 * uBfRes.y / max(cp.w, 1e-4) * mm;
  float w = 0.0085 * (1.0 - 0.8 * aHair.x) * pxPerMm;              // half-width in pixels: a hair is 17 µm thick at its root
  float use = max(w, 0.7);
  // (thinner than a pixel it is drawn a pixel wide and faint — but never so faint that the coat disappears)
  vAlpha = min(1.0, sqrt(w / use) * 0.75) * smoothstep(5.0, 8.0, pxPerMm);     // (a hair under two pixels long is not fur, only velvet: Glasswing.sort() stops drawing the coat there)
  cp.xy += vec2(-dir.y, dir.x) * aHair.y * use * 2.0 / uBfRes * cp.w;
  vHair = aHair; vWorld = wp; vDir = normalize(wt.xyz - wr.xyz);
  vSun = bfSunVisV(wr.xyz);
  gl_Position = cp;
}`;

const FUR_FRAG = (L) => /* glsl */ `
precision highp float;
varying vec4 vHair;
varying vec3 vWorld;
varying vec3 vDir;
varying float vAlpha;
varying float vSun;
${hash}
${L.common}
${L.fragment}
void main(){
  float a = (1.0 - vHair.y * vHair.y) * vAlpha * (1.0 - 0.5 * vHair.x);
  if (a < 0.01) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 alb = mix(vec3(0.015, 0.013, 0.014) * (0.4 + 1.2 * vHair.z), vec3(0.62, 0.61, 0.56), vHair.w) * (0.3 + 0.7 * vHair.x);
  // a hair is a cylinder: it is lit across its axis, and scatters forward when the light is behind it
  vec3 T = vDir;
  float sinTL = sqrt(max(1.0 - dot(T, BF_SUN_DIR) * dot(T, BF_SUN_DIR), 0.0));
  float back = pow(max(dot(-V, BF_SUN_DIR), 0.0), 4.0);
  vec3 Nh = normalize(V - T * dot(V, T));
  // (light from the lens's side, and light from the side the hair grows toward: the second is what rims the body)
  vec3 col = alb * (bfAmb(vWorld, Nh) * 0.55 + bfAmb(vWorld, T) * 0.75 + BF_SUN_COL * vSun * sinTL * (0.22 + 2.6 * back) * (0.4 + 0.6 * vHair.x));
  // and whatever is bright behind it comes through the tip
  vec3 tint = mix(vec3(0.2, 0.15, 0.12), vec3(0.85, 0.82, 0.74), vHair.w);
  float through = pow(max(dot(-V, BF_SUN_DIR), 0.0), 2.0);
  col += tint * (bfAmb(vWorld, normalize(T - V)) * 0.2 + BF_SUN_COL * vSun * through * 0.16) * (0.15 + 0.85 * vHair.x * vHair.x);
  gl_FragColor = bfFinish(max(col, 0.0) * a, a, vWorld);
}`;

const spots = () => SPOTS.map((s) => new THREE.Vector4(...s));
const cache = new WeakMap();
function shaders(light) {
  let c = cache.get(light);
  if (!c) cache.set(light, (c = { body: { vertexShader: BODY_VERT(light), fragmentShader: BODY_FRAG(light) }, fur: { vertexShader: FUR_VERT(light), fragmentShader: FUR_FRAG(light) } }));
  return c;
}

/**
 * @param o.light     a light rig (light.js)
 * @param o.eyeMap    true: the eyes can hold a picture (uniforms tBfEye, uBfEye)
 * @param o.limbs     null: the whole body, opaque · 'none': all but antennae, legs and claws · 'only': those alone,
 *                    blended and antialiased (draw it after the body; Glasswing does both in 'blend' mode)
 * @param o.uniforms  tNoise, the pose (rig.js: poseUniforms) and, with eyeMap, tBfEye / uBfEye
 */
export function makeBodyMaterial({ light, eyeMap = false, limbs = null, uniforms = {} }) {
  const defines = eyeMap ? { BF_EYE_MAP: 1 } : {};
  if (limbs === 'only') defines.BF_LIMBS = 1;
  else if (limbs === 'none') defines.BF_NO_LIMBS = 1;
  return new THREE.ShaderMaterial({
    ...shaders(light).body,
    defines,
    uniforms: { ...(light.uniforms || {}), ...uniforms, uSpots: { value: spots() } },
    // (the hairs are blended, premultiplied, over whatever is already there — and write depth, so wings sort against them)
    ...(limbs === 'only' ? { transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor } : {}),
  });
}

/** @param o.uniforms  uBfRes (px of the target being drawn into) */
export function makeFurMaterial({ light, uniforms = {} }) {
  return new THREE.ShaderMaterial({
    ...shaders(light).fur,
    uniforms: { ...(light.uniforms || {}), ...uniforms },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

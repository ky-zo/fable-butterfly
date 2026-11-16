// Silk ribbons. Every filament in this world is one of these: a strip expanded in the vertex shader along a curve, with
// its own circle of confusion. Two kinds of geometry feed the same shading:
//
//   STRAND  an instanced strip between two anchors: catenary sag by its tension, slow air, a standing wave when plucked.
//           One end may ride on the animal (an index into the attach texture).
//   POLY    a polyline given point by point (the leaf, figure-of-eight trails, the pad, the winding), optionally passed
//           through the butterfly kit's rig first (RIG: the animal itself, drawn from the kit's veins, margins and body).
//
// The same geometry is drawn in up to four passes:
//   PASS 0  sharp   full-res. Two twisted brins (silk leaves the spinneret as a pair), anisotropic sheen with thin-film
//                   colour, fuzz, analytic AA, 1px minimum width.
//   PASS 1  band    half-res. Out-of-focus threads as soft bands: a line convolved with a disc, energy conserved.
//   PASS 2  far     quarter-res MRT. Heavily defocused threads as thin lines carrying their blur radius; a gather pass
//                   spreads them afterwards.
//   PASS 3  small   quarter-res: the glow map (the light threads leave in the air).

import * as THREE from 'three';
import { hash, color } from '../../core/glsl.js';
import { rigGLSL } from '../../shared/butterfly/index.js';

export const NG = 8; // strand groups
export const NP = 8; // poly groups

const COMMON = /* glsl */ `
precision highp float;
varying float vX;      // signed distance across the ribbon, target px
varying vec4 vGeo;     // x band half-width px, y coc fraction of it, z energy, w px to the nearest end (negative past it)
varying vec4 vPar;     // x 0..1 along, y metres along, z pass weight, w view depth
varying vec4 vLit;     // x brightness, y pulse amplitude, z growth front, w seed
varying vec4 vAux;     // x kind, y true core half-width px, z coc (full-res px), w how warm (attended)
varying vec4 vPul;     // x,y where the two pulses are (0..1 along), z sheen (far field), w thin-film phase
varying vec3 vC;       // steady colour: body + sheen
varying vec3 vT;       // tangent, world
varying vec3 vPw;      // position, world
varying vec3 vSh;      // sheen, per vertex (far field)
uniform float uDew;    // how wet the filaments themselves are
uniform vec3 uL1, uL2; // the low warm light, the cool sky
${hash}
${color}
const vec3 SILK = vec3(0.60, 0.74, 0.72);
const vec3 SILK_HI = vec3(0.86, 0.96, 1.0);
const vec3 WARM = vec3(1.0, 0.76, 0.48);
const vec3 WARM_HI = vec3(1.0, 0.88, 0.68);
// kinds: 0 strand · 1 warp (veins, margins) · 2 weft (membrane) · 3 leaf · 4 winding · 5 trail/pad · 6 body · 7 limbs
//        8 … 8.4 ember thread (the fraction is its heat: 8 amber … 8.4 crimson) · 9 the white thread (bar, dots, spots)
void palette(float kind, float warm, out vec3 base, out vec3 hi){
  base = mix(SILK, WARM, warm);
  hi = mix(SILK_HI, WARM_HI, warm);
  if (kind > 7.5 && kind < 8.5) {
    // dyed, not lit: the ember of the border keeps its own colour whatever the animal is turned to
    float heat = clamp((kind - 8.0) / 0.4, 0.0, 1.0);
    base = mix(vec3(1.0, 0.4, 0.08), vec3(0.86, 0.07, 0.04), heat);
    hi = mix(vec3(1.0, 0.66, 0.34), vec3(1.0, 0.3, 0.17), heat);
  }
  if (kind > 8.5) { base = vec3(1.0, 0.96, 0.88); hi = vec3(1.0, 0.99, 0.96); }
  if (kind > 2.5 && kind < 3.5) { base *= vec3(0.62, 1.0, 0.6); hi *= vec3(0.8, 1.0, 0.82); }
  if (kind > 3.5 && kind < 4.5) { base = mix(vec3(0.5, 0.56, 0.6), base, 0.35); hi = mix(vec3(0.92, 0.97, 1.0), hi, 0.4); }
}
// sheen of a fibre under two lights (Kajiya–Kay)
// (the low light is warm and mostly behind things; the sky is cool and overhead: a filament takes its colour from its lie)
vec3 sheenOf(vec3 T, vec3 V, float n){
  vec3 H1 = normalize(uL1 + V * 0.6), H2 = normalize(uL2 + V);
  float a = dot(T, H1), b = dot(T, H2);
  return vec3(1.0, 0.7, 0.4) * 1.25 * pow(max(1.0 - a * a, 0.0), n) + vec3(0.6, 0.84, 0.95) * 0.6 * pow(max(1.0 - b * b, 0.0), n * 0.6);
}
`;

/** How a strand hangs. Shared with the dew and the words, so that they ride exactly on it. */
export const STRAND_GLSL = /* glsl */ `
uniform sampler2D tAttach;
uniform vec4 uGroup[${NG}];    // x tension, y brightness, z grown, w plucked
uniform vec4 uGroupB[${NG}];   // x warm, y gathered to the pad, z sag when slack, w -
uniform vec3 uPad;
uniform float uTime;
struct Strand { vec3 A; vec3 AB; vec3 bow; vec3 lat; float L; float tau; float loose; float amp; float nmode; float ph; };
Strand strandOf(vec4 a, vec4 b, vec4 p){
  Strand s;
  int gi = int(b.w + 0.5);
  vec4 g = uGroup[gi], gb = uGroupB[gi];
  float h1 = hash11(p.x * 91.7 + 3.1), h2 = hash11(p.x * 37.3 + 11.9), h3 = hash11(p.x * 53.9 + 7.7);
  s.A = a.w >= 0.0 ? texelFetch(tAttach, ivec2(int(a.w + 0.5), 0), 0).xyz : a.xyz;
  // late, everything is drawn in to the one place it hangs from (the main strand becomes the stalk)
  vec3 B = mix(b.xyz, uPad + (gi == 5 ? vec3(0.0, -0.031, 0.0) : (vec3(h1, 0.5, h2) - 0.5) * 0.03), gb.y);
  if (a.w < 0.0) s.A = mix(s.A, uPad + (vec3(h2, 0.5, h3) - 0.5) * 0.03 - vec3(0.0, 0.03 + 0.3 * h1, 0.0), gb.y * step(0.5, b.w - 5.0) * step(b.w, 6.5));
  s.AB = B - s.A;
  s.L = length(s.AB);
  s.tau = clamp(g.x * (0.72 + 0.56 * h3), 0.0, 1.0);
  float slack = mix(gb.z * (0.25 + 1.5 * h1 * h1), 0.002, pow(s.tau, 0.5)) * p.z;
  s.lat = normalize(cross(s.AB, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  s.bow = vec3(0.0, -s.L * slack, 0.0) + s.lat * (h2 - 0.5) * s.L * (0.004 + slack * 0.22);
  s.loose = clamp(slack * 9.0, 0.04, 1.0);
  s.amp = g.w * s.tau * min(s.L, 1.2) * 0.0007 * (0.5 + h2);
  s.nmode = 1.0 + floor(h3 * 2.99);
  s.ph = p.x * 44.0;
  return s;
}
vec3 strandPoint(Strand s, float t, out vec3 T){
  float sh = 4.0 * t * (1.0 - t);
  vec3 P = s.A + s.AB * t + s.bow * sh;
  T = s.AB + s.bow * (4.0 - 8.0 * t);
  // slow air
  vec3 q = P * vec3(0.9, 0.7, 0.8);
  vec3 sw = vec3(sin(q.z * 1.3 + q.y * 0.7 + uTime * 0.31 + s.ph), 0.35 * sin(q.x * 1.1 + uTime * 0.23 + s.ph * 1.3), sin(q.x * 0.9 - q.y * 0.8 + uTime * 0.27 + s.ph * 0.7));
  P += sw * sh * (0.0006 + 0.012 * s.loose);
  // plucked: a standing wave, mode n, the part of it slow enough to see (the rest is drawn as blur)
  P += s.lat * s.amp * sin(3.14159265 * s.nmode * t) * sin(uTime * (9.0 + 5.0 * fract(s.ph)) + s.ph);
  return P;
}
`;

const VERT_HEAD = /* glsl */ `
${COMMON}
uniform float uFocus, uK, uMaxCoc, uPxPerM, uRes, uNearClip, uSegs;
uniform vec3 uSplit;   // coc thresholds between the passes (full-res px)
float cocOf(float d){ return min(uK * abs(1.0 - uFocus / max(d, uNearClip)), uMaxCoc); }
float passWeight(float coc){
#if PASS == 0
  return 1.0 - smoothstep(uSplit.x * 0.8, uSplit.x * 1.2, coc);
#elif PASS == 1
  return smoothstep(uSplit.x * 0.8, uSplit.x * 1.2, coc) * (1.0 - smoothstep(uSplit.y * 0.8, uSplit.y * 1.2, coc));
#elif PASS == 2
  return smoothstep(uSplit.y * 0.8, uSplit.y * 1.2, coc);
#else
  return 1.0;
#endif
}
// P, T world · u 0..1 along · len metres · rad metres · spindle: metres of fast vibration drawn as blur
void ribbon(vec3 P, vec3 T, float u, float side, float len, float kind, float rad, float bright, float pulseAmp, float gT, float seed, float warm, float spindle, vec2 pulse, float segPx0){
  vec4 vp = viewMatrix * vec4(P, 1.0);
  vec3 vt = (viewMatrix * vec4(T, 0.0)).xyz;
  float d = max(-vp.z, uNearClip);
  float coc = cocOf(-vp.z);
  float pw = passWeight(coc) * step(uNearClip * 0.5, -vp.z);
  float pxPerM = uPxPerM * uRes;
  float coreTrue = rad * pxPerM / d;
  float core = max(coreTrue, 0.5);
#if PASS == 2
  float cocT = 0.0;
#elif PASS == 3
  float cocT = 0.6;
#else
  float cocT = coc * uRes;
#endif
  cocT += spindle * pxPerM / d;
  float R = core + cocT;
  float cf = cocT / R;
  float energy = coreTrue / R / mix(1.0, 0.7854, cf);
#if PASS == 0
  float halo = max(coreTrue - 0.7, 0.0) * 2.4;
#else
  float halo = 0.0;
#endif
  float hw = (R + 0.75 + halo) * step(0.0005, pw);
  vec3 sideV = normalize(cross(vt, vp.xyz) + vec3(1e-9, 0.0, 0.0));
  float pxToView = d / pxPerM;
  float cap = u < 0.0005 ? -1.0 : (u > 0.9995 ? 1.0 : 0.0);
  vp.xyz += sideV * side * hw * pxToView + normalize(vt + vec3(1e-9)) * cap * hw * pxToView;
  gl_Position = projectionMatrix * vp;

  vec3 base, hi;
  palette(kind, warm, base, hi);
  vec3 Tn = normalize(T + vec3(1e-9));
  vec3 V = normalize(cameraPosition - P);
  vec3 sheen = sheenOf(Tn, V, 36.0);
  float film = 0.0;
  if (kind > 1.5 && kind < 2.5) {
    // the membrane's weft is thin enough to interfere with itself: its colour turns with the angle it is seen at
    float c = sqrt(max(1.0 - pow(dot(Tn, V), 2.0), 0.0));
    // (the film of a glasswing: not the whole rainbow — cyan and violet, and a thread of pale gold between them)
    float h = (250.0 + 190.0 * fract(seed * 7.13) + 60.0 * sin(u * 9.0)) * (0.72 + 0.28 * c) / 170.0;
    vec3 tf = mix(vec3(0.74, 0.56, 1.0) * 1.15, vec3(0.4, 0.86, 1.0), 0.5 + 0.5 * cos(6.2831853 * h));
    float gold = 0.5 + 0.5 * cos(6.2831853 * (h * 0.5 + 0.21));
    tf = mix(tf, vec3(1.0, 0.8, 0.5), gold * gold * gold * 0.75);
    base = mix(base, base * (0.35 + 1.25 * tf), 0.8);
    hi = mix(hi, hi * (0.35 + 1.25 * tf), 0.8);
  }
  if (kind > 3.5 && kind < 4.5) sheen = sheen * 3.0 + vec3(0.6, 0.84, 0.95) * 0.2 * pow(max(1.0 - pow(dot(Tn, normalize(uL2 + V)), 2.0), 0.0), 6.0);
  // (the winding is lit like metal: almost no body, all sheen)
  float bodyK = kind > 3.5 && kind < 4.5 ? 0.1 : 0.6;
  // (every filament keeps a little sheen however dim it is — except one that has been let go altogether)
  vC = base * bright * bodyK + hi * sheen * (0.04 * min(1.0, bright / 0.02) + 0.8 * bright);
  vX = side * hw;
  vGeo = vec4(R, cf, energy, cap != 0.0 ? -hw : segPx0);
  vPar = vec4(u, u * len, pw, -vp.z);
  vLit = vec4(bright, pulseAmp, gT, seed);
  vAux = vec4(kind, coreTrue, coc, warm);
  vPul = vec4(pulse, 0.0, rad);
  vSh = sheen;
  vT = T;
  vPw = P;
}
#define HIDE { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
`;

const VERT_STRAND = /* glsl */ `
${VERT_HEAD}
attribute vec4 iA;     // xyz anchor, w index of a point on the animal (or -1)
attribute vec4 iB;     // xyz anchor, w group
attribute vec4 iP;     // seed, radius (m), slack scale, order in which it is laid (0..1)
${STRAND_GLSL}
void main(){
  int gi = int(iB.w + 0.5);
  vec4 g = uGroup[gi], gb = uGroupB[gi];
  if (g.y <= 0.0005 || g.z <= 0.001) HIDE
  float seed = iP.x;
  float h1 = hash11(seed * 91.7 + 3.1), h3 = hash11(seed * 53.9 + 7.7);
  float gT = clamp(g.z * 1.5 - 0.5 * iP.w, 0.0, 1.0);
  if (gT <= 0.0) HIDE
  Strand s = strandOf(iA, iB, iP);
  // every filament is a little different: most are quiet, a few carry more light
  float own = 0.4 + 1.9 * h3 * h3 * h3;
  float bright = g.y * own * mix(0.3, 1.0, s.tau);

  // ---- which pass does this thread belong to? (cheap test on three points, before any real work)
  vec3 Mid = s.A + s.AB * 0.5 + s.bow;
  vec3 vA = (viewMatrix * vec4(s.A, 1.0)).xyz, vB = (viewMatrix * vec4(s.A + s.AB, 1.0)).xyz, vM = (viewMatrix * vec4(Mid, 1.0)).xyz;
  float dmin = min(-vA.z, min(-vB.z, -vM.z)), dmax = max(-vA.z, max(-vB.z, -vM.z));
  bool cull = dmax < 0.0;
  {
    float px = projectionMatrix[0][0], py = projectionMatrix[1][1];
    vec3 ax = vec3(vA.x, vB.x, vM.x) * px, ay = vec3(vA.y, vB.y, vM.y) * py;
    vec3 wv = max(-vec3(vA.z, vB.z, vM.z), 0.0) * 1.25 + 0.12;
    cull = cull || all(greaterThan(ax, wv)) || all(lessThan(ax, -wv)) || all(greaterThan(ay, wv)) || all(lessThan(ay, -wv));
  }
#if PASS < 3
  float cA = cocOf(-vA.z), cB = cocOf(-vB.z), cM = cocOf(-vM.z);
  float cmax = max(cA, max(cB, cM));
  float cmin = (dmin - uFocus) * (dmax - uFocus) < 0.0 ? 0.0 : min(cA, min(cB, cM));
#endif
#if PASS == 0
  cull = cull || cmin > uSplit.x * 1.25;
#elif PASS == 1
  cull = cull || cmax < uSplit.x * 0.75 || cmin > uSplit.y * 1.25;
#elif PASS == 2
  cull = cull || cmax < uSplit.y * 0.75;
#endif
  if (cull) HIDE

  float t = position.x;
  vec3 T;
  vec3 P = strandPoint(s, t, T);
  // light travelling along what is attended to, toward the animal; and each thread's own small glints
  float tp = 1.0 - fract(uTime * (0.16 + 0.1 * h1) + seed * 5.0) * 1.5 + 0.25;
  float tp2 = fract(uTime * (0.02 + 0.04 * h1) + seed * 3.0);
  float spindle = s.amp * abs(sin(3.14159265 * s.nmode * t)) * 1.6;
  float segPx = length((viewMatrix * vec4(T, 0.0)).xyz) / uSegs * uPxPerM * uRes / max(-(viewMatrix * vec4(P, 1.0)).z, uNearClip);
  // (the ones that run from it to the glass are drawn out as they go: half as thick at the pane, and fainter)
  float away = (gi == 2 || gi == 3) ? t : 0.0;
  ribbon(P, T, t, position.y, s.L, 0.0, iP.y * (1.0 - 0.5 * away), bright * (1.0 - 0.66 * smoothstep(0.0, 0.9, away)), g.w * s.tau, gT, seed, gb.x * s.tau, spindle, vec2(tp, tp2), segPx);
}
`;

const VERT_POLY = /* glsl */ `
${VERT_HEAD}
attribute vec3 aNext;  // the next point along the line (the same frame as position)
attribute vec4 aS;     // side ±1, distance along (raw units), whole length (raw units), random per line
attribute vec4 aK;     // kind, radius (m), when it starts being laid (0..1), how long that takes
uniform float uUnit;   // metres per raw unit
uniform float uTime;
#ifdef RIG
attribute vec2 aWing;
attribute vec3 aAlt;
attribute vec3 aNextAlt;
attribute vec4 aPart;
uniform vec4 uPose, uShape, uLimbs, uTwitch;
uniform vec3 uFeet[4];
uniform vec4 uHero;    // how much is drawn: veins and margins, weft, body, limbs
uniform vec4 uHeroB;   // x body shortened and thickened, y brightness, z warm, w glint
uniform vec4 uHeroC;   // x how far off it is seen from (1 = near; the light it is given for that is already in uHeroB.y)
${rigGLSL}
vec3 posed(vec3 p, vec3 alt){
  if (aWing.x == 0.0) {
    vec3 b = bfBodyLocal(p, alt, vec3(0.0), aPart, uLimbs, uTwitch, uFeet);
    // going back: shorter, thicker
    b.y = mix(b.y, b.y * 0.62 - 1.5, uHeroB.x);
    b.xz *= mix(1.0, 1.75, uHeroB.x * step(aPart.x, 2.5));
    return b;
  }
  return bfWingBody(bfWingLocal(p.xy, aWing, uPose, uShape), aWing, uPose, uShape);
}
#else
attribute float aG;
uniform vec4 uPoly[${NP}];     // grown, brightness, warm, glint
#endif
void main(){
  float kind = aK.x;
#ifdef RIG
  vec3 p0 = posed(position, aAlt), p1 = posed(aNext, aNextAlt);
  // (the dyed threads go with what they lie on: with the veins and margins on a wing, with the limbs on the body)
  float grown = kind < 1.5 || (kind > 7.5 && aWing.x != 0.0) ? uHero.x : (kind < 2.5 ? uHero.y : (kind < 6.5 ? uHero.z : uHero.w));
  float bright = uHeroB.y * (kind < 1.5 ? 0.9 : (kind < 2.5 ? 0.62 : (kind < 6.5 ? 0.5 : (kind < 7.5 ? 0.62 : (kind < 8.5 ? 1.5 : 1.12)))));
  // (from far off the weft is hundreds of filaments to the ember's four: the dyed threads are given more, so that the
  // small animal still has an ember edge and a white bar and is not one pale shape)
  if (kind > 7.5) bright *= 1.0 + 0.6 * (uHeroC.x - 1.0);
  // (…and the weft less: a glasswing's wing is clear, and seen small it must not close up into a white one)
  if (kind > 1.5 && kind < 2.5) bright /= 1.0 + 0.6 * (uHeroC.x - 1.0);
  float warm = kind > 1.5 && kind < 2.5 ? uHeroB.z * 0.25 : uHeroB.z;
  float glint = uHeroB.w;
#else
  vec3 p0 = position, p1 = aNext;
  vec4 m = uPoly[int(aG + 0.5)];
  float grown = m.x, bright = m.y, warm = m.z, glint = m.w;
#endif
  float gT = clamp((grown - aK.z) / max(aK.w, 1e-5), 0.0, 1.0);
  if (gT <= 0.0 || bright <= 0.0005) HIDE
  vec3 P = (modelMatrix * vec4(p0, 1.0)).xyz;
  vec3 T = (modelMatrix * vec4(p1, 1.0)).xyz - P;
  float u = aS.y / aS.z;
  float seed = aS.w;
  bright *= 0.7 + 0.6 * hash11(seed * 31.7);
  float tp2 = fract(uTime * (0.05 + 0.07 * hash11(seed * 9.1)) + seed * 3.0);
  ribbon(P, T, u, aS.x, aS.z * uUnit, kind, aK.y, bright, glint, gT, seed, warm, 0.0, vec2(-9.0, tp2), 8.0);
}
`;

const FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tDepth;
uniform vec2 uInvTarget;
uniform float uNear, uFar, uGain;
uniform vec3 uSplit;
#if PASS == 2
layout(location = 0) out vec4 oNear;
layout(location = 1) out vec4 oFar;
#endif

float sceneDepth(){
  float z = texture2D(tDepth, gl_FragCoord.xy * uInvTarget).x;
  float ndc = z * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear));
}
// a line convolved with a disc: flat when sharp, a half-ellipse when blurred. x in px from the centre line.
float bandOf(float x, float e, float R, float cf){
  float rr = sqrt(x * x + e * e);
  float s = rr / R;
  return pow(max(1.0 - s * s, 1e-4), 0.5 * cf) * clamp(R - rr + 0.5, 0.0, 1.0);
}

void main(){
  float passW = vPar.z;
  if (passW < 0.003) discard;
#if PASS == 1 || PASS == 2
  if (sceneDepth() < vPar.w - 0.004) discard;      // the sharp pass uses the real depth buffer
#endif
  float e = min(vGeo.w, 0.0);
  float R = vGeo.x, cf = vGeo.y;
  float t = vPar.x, gT = vLit.z;
  float grown = gT > 0.999 ? 1.0 : smoothstep(gT, gT - 0.004, t);
  // the point that is laying it
  float tipW = 0.0022 / max(vPar.y / max(t, 1e-4), 0.01);
  float tip = gT > 0.999 ? 0.0 : exp(-pow((t - gT) / tipW, 2.0)) * step(0.0005, gT);
  vec3 base, hi;
  palette(vAux.x, vAux.w, base, hi);
  float bright = vLit.x, seed = vLit.w;
  float pulse = (exp(-pow((t - vPul.x) / 0.07, 2.0)) + 0.3 * exp(-pow((t - vPul.y) / 0.03, 2.0))) * vLit.y;
  vec3 pulseCol = mix(base, hi, 0.6) * pulse * (0.5 + 2.2 * bright);
  // (the veins are not laid, they are drawn in: no point of light on those)
  if ((vAux.x > 0.5 && vAux.x < 1.5) || vAux.x > 5.5) tip *= 0.08;
  if (vAux.x > 4.5 && vAux.x < 5.5) tip *= 5.0;
  vec3 tipCol = vec3(1.0, 0.9, 0.72) * tip * (2.0 + 5.0 * bright);
  // silk is laid wet and bright and cools as it sets: the last few turns behind the point that is writing it
  float hot = 0.0;
  if (vAux.x > 4.5 && vAux.x < 5.5 && gT < 0.999) {
    float behind = max(gT - t, 0.0) * vPar.y / max(t, 1e-4);      // metres of thread laid since this point
    hot = exp(-behind / 0.16) * 0.75 + exp(-behind / 0.55) * 0.25;
    hot *= step(0.0005, gT);
  }
  vec3 hotCol = vec3(1.0, 0.8, 0.5) * hot * (0.5 + 2.2 * bright);
  tipCol += hotCol;
  vec3 col;

#if PASS == 0
  float coreP = max(vAux.y, 0.5);
  float detail = smoothstep(1.1, 2.6, vAux.y) * (1.0 - smoothstep(0.2, 0.55, cf));
  if (detail > 0.001) {
    vec3 Tn = normalize(vT);
    vec3 V = normalize(cameraPosition - vPw);
    float along = vPar.y;
    float pitch = 0.0021 * (0.85 + 0.3 * hash11(seed * 13.0));
    float turn = along / pitch + seed * 7.0;
    // irregular thickness: slubs along the length, the silhouette follows the two brins
    float slub = 0.11 * sin(along * 310.0 + seed * 50.0) + 0.08 * sin(along * 97.0 + seed * 20.0);
    float hE = sin(3.14159265 * fract(sign(vX) * 0.5 + turn));
    float thick = mix(1.0, (1.0 + slub) * (0.86 + 0.14 * hE), detail);
    float rc = coreP * thick;
    float Rd = rc + (R - coreP);
    float band = bandOf(abs(vX), e, Rd, (R - coreP) / Rd) * vGeo.z;
    float u = clamp(vX / rc, -1.0, 1.0);
    // cylinder + two twisted brins
    vec3 S = normalize(cross(Tn, V));
    vec3 Fw = cross(S, Tn);
    float nz = sqrt(max(1.0 - u * u, 0.0));
    vec3 N = normalize(-S * u + Fw * nz);
    float v = fract(asin(u) / 3.14159265 + turn);
    float hgt = sin(3.14159265 * v);
    vec3 C = cross(Tn, N);
    vec3 G = normalize(C * 0.62 + Tn * 0.38);
    vec3 Np = normalize(N + G * cos(3.14159265 * v) * 0.75);
    vec3 Tf = normalize(cross(Np, G));
    float occ = mix(1.0, mix(0.26, 1.0, pow(hgt, 0.55)), detail);
    float fil = mix(1.0, 0.76 + 0.24 * sin(v * 47.0 + sin(along * 900.0 + seed * 9.0) * 1.4), detail);
    vec3 sheen = mix(vSh, sheenOf(Tf, V, 28.0) * 1.7 * fil, detail);
    // the gum that coats the pair is a thin film: its colour runs along the filament with its thickness
    vec3 film = thinFilm(clamp(dot(Np, V), 0.0, 1.0), 240.0 + 260.0 * (0.5 + 0.5 * sin(along * 41.0 + seed * 60.0)) + 120.0 * v, 1.55);
    film = mix(vec3(dot(film, vec3(0.3333))), film, 0.7);
    vec3 hiF = mix(hi, hi * (0.4 + 1.3 * film), 0.6 * detail);
    float limb = mix(1.0, 0.55 + 0.45 * (1.0 - nz), detail);
    // (close enough to see the brins, it is lit like a thing, not like a light: the body dims and the sheen draws it)
    float body = vAux.x > 3.5 && vAux.x < 4.5 ? 0.08 : mix(0.6, 0.2, detail);
    col = base * bright * (body * limb * occ * fil + 0.03) + pulseCol * occ + hiF * sheen * (0.05 * min(1.0, bright / 0.02) + 0.62 * bright) * occ + tipCol;
    col *= band * grown;
    // dew on the filament itself: beads one wavelength apart (see dew.js), each a small lens
    float rad = vPul.w;
    if (uDew > 0.001 && vAux.x > 0.5 && vAux.x < 3.5) {
      float lam = 12.6 * rad * (0.9 + 0.5 * hash11(seed * 3.3));
      float kb = along / lam + seed * 9.0;
      float cb = floor(kb);
      float hb = hash12(vec2(cb, seed * 57.0));
      float wet = uDew * (0.5 + 0.5 * sin(along * 14.0 + seed * 30.0));
      if (hb < wet) {
        float rb = rad * (1.5 + 1.6 * hash11(hb * 91.0));
        vec2 q = vec2((fract(kb) - 0.5) * lam, vX * rad / vAux.y + rb * 0.25) / rb;
        float rr = dot(q, q);
        if (rr < 1.0) {
          float nzb = sqrt(1.0 - rr);
          vec3 Nb = normalize(Tn * q.x - S * q.y + Fw * nzb);
          // the room upside down in it: the low warm light comes out on top, the sky underneath; a rim; one glint
          vec3 thru = (vec3(1.0, 0.74, 0.48) * smoothstep(0.1, 0.9, q.y * 0.6 + 0.5 + 0.3 * q.x) * 0.42 + vec3(0.35, 0.5, 0.52) * smoothstep(0.2, -0.8, q.y) * 0.22) * (0.6 + 1.6 * rr);
          float fr = pow(1.0 - nzb, 3.0);
          float gl = pow(max(dot(reflect(-V, Nb), normalize(vec3(-0.35, 0.8, 0.5))), 0.0), 50.0);
          vec3 bead = thru + vec3(0.5, 0.66, 0.7) * fr * 0.5 + vec3(1.0) * gl * 1.6;
          float aa = clamp((1.0 - sqrt(rr)) * rb * vAux.y / rad + 0.5, 0.0, 1.0);
          col = mix(col * 0.55, col * 0.3 + bead * (0.35 + 0.5 * bright), aa * detail) ;
        }
      }
    }
    // fuzz: a faint halo and single filaments leaving the thread
    if (abs(vX) > rc * 0.85) {
      float hx = max(abs(vX) - rc, 0.0) / coreP;
      float glow = exp(-hx * 2.4) * 0.06;
      float cell = along / 0.0019;
      float ci = floor(cell), cfr = fract(cell);
      float hh = hash12(vec2(ci, seed * 100.0 + sign(vX) * 3.0));
      float f0 = hash11(hh * 71.0) * 0.5;
      float slope = 1.0 + 2.6 * hash11(hh * 31.0);
      float hy = (cfr - f0) * slope * (0.6 + cfr);
      float dpx = abs(hx - hy) * coreP;
      float hair = step(hh, 0.36) * step(f0, cfr) * smoothstep(0.8, 0.0, dpx) * exp(-hx * 0.8) * (1.0 - cfr * cfr) * 0.3;
      col += base * (bright * 0.8 + pulse * 0.6) * (glow + hair) * detail * grown * step(0.0, vGeo.w);
    }
  } else {
    col = (vC + pulseCol + tipCol) * bandOf(abs(vX), e, R, cf) * vGeo.z * grown;
  }
  gl_FragColor = vec4(col * passW * uGain, 1.0);

#elif PASS == 1
  float s = sqrt(vX * vX + e * e) / R;
  col = vC + pulseCol + tipCol;
  col *= 1.0 + 0.25 * cf * smoothstep(0.5, 0.95, s);   // a hint of the optical ring at the rim of the band
  gl_FragColor = vec4(col * bandOf(abs(vX), e, R, cf) * vGeo.z * grown * passW * uGain, 1.0);

#elif PASS == 2
  col = (vC + pulseCol + tipCol) * bandOf(abs(vX), e, R, cf) * vGeo.z * grown * passW * uGain;
  float coc = vAux.z;
  float far = smoothstep(uSplit.z * 0.8, uSplit.z * 1.2, coc);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  oNear = vec4(col, l * coc) * (1.0 - far);
  oFar = vec4(col, l * coc) * far;

#else
  col = vC + pulseCol + tipCol;
  gl_FragColor = vec4(col * bandOf(abs(vX), e, R, cf) * vGeo.z * grown * uGain, 1.0);
#endif
}
`;

/** Uniforms every silk material shares (by reference). */
export function silkShared(attachTex) {
  const v4 = (n) => Array.from({ length: n }, () => new THREE.Vector4());
  return {
    tAttach: { value: attachTex },
    tDepth: { value: null },
    uTime: { value: 0 },
    uFocus: { value: 2 },
    uK: { value: 4 },
    uMaxCoc: { value: 80 },
    uPxPerM: { value: 1000 },
    uNearClip: { value: 0.02 },
    uNear: { value: 0.02 },
    uFar: { value: 60 },
    uSplit: { value: new THREE.Vector3(1.7, 9, 27) },
    uGroup: { value: v4(NG) },
    uGroupB: { value: v4(NG) },
    uPoly: { value: v4(NP) },
    uPad: { value: new THREE.Vector3() },
    uDew: { value: 0 },
    uL1: { value: new THREE.Vector3(0.25, -0.3, -0.92).normalize() },
    uL2: { value: new THREE.Vector3(-0.3, 0.85, 0.3).normalize() },
  };
}

/**
 * One material per (geometry kind, pass).
 * @param mode 'strand' | 'poly' | 'rig'   @param pass 0..3   @param segs segments per strand (strand only)
 */
export function silkMaterial(ctx, shared, mode, pass, extra = {}, segs = 16) {
  const m = new THREE.ShaderMaterial({
    vertexShader: mode === 'strand' ? VERT_STRAND : VERT_POLY,
    fragmentShader: FRAG,
    defines: mode === 'rig' ? { PASS: pass, RIG: 1 } : { PASS: pass },
    uniforms: {
      ...shared,
      uRes: { value: [1, 0.5, 0.25, 0.25][pass] },
      uSegs: { value: segs },
      uInvTarget: { value: new THREE.Vector2(1, 1) },
      uGain: { value: 0.8 },
      uUnit: { value: 1 },
      ...extra,
    },
    glslVersion: pass === 2 ? THREE.GLSL3 : null,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    depthTest: pass === 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  });
  return ctx.track(m);
}

/** A strip of `segs` quads: x = 0..1 along, y = ±1 across. */
export function stripGeometry(segs) {
  const pos = new Float32Array((segs + 1) * 2 * 3);
  const idx = new Uint16Array(segs * 6);
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    pos.set([t, -1, 0, t, 1, 0], k * 6);
    if (k < segs) {
      const a = k * 2;
      idx.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], k * 6);
    }
  }
  return { pos, idx };
}

/**
 * Collects polylines and turns them into one ribbon geometry.
 *   add(points, { kind, radius | radii, start, span, group, rand, extra })   points: [[x, y, z], …] in the raw frame
 * `extra(i)` → { wing: [side, hind], alt: [x, y, z], part: [id, along, around, leg] } for rigged lines.
 */
export class PolyBag {
  constructor(rig = false) {
    this.rig = rig;
    this.pos = [];
    this.next = [];
    this.s = [];
    this.k = [];
    this.g = [];
    this.wing = [];
    this.alt = [];
    this.nextAlt = [];
    this.part = [];
    this.idx = [];
    this.count = 0;
    this.lines = 0;
  }
  add(pts, { kind = 0, radius = 0.0004, radii = null, start = 0, span = 1, group = 0, rand = 0, extra = null, closed = false } = {}) {
    const P = closed ? [...pts, pts[0]] : pts;
    const n = P.length;
    if (n < 2) return 0;
    let total = 0;
    const acc = [0];
    for (let i = 1; i < n; i++) acc.push((total += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2])));
    if (!(total > 0)) return 0;
    const ex = (i) => (extra ? extra(Math.min(i, pts.length - 1) % pts.length) : null);
    for (let i = 0; i < n; i++) {
      const p = P[i];
      // (the last point looks past itself)
      const q = i < n - 1 ? P[i + 1] : [2 * p[0] - P[i - 1][0], 2 * p[1] - P[i - 1][1], 2 * p[2] - P[i - 1][2]];
      const e = ex(i);
      const e1 = this.rig ? (i < n - 1 ? ex(i + 1) : null) : null;
      const r = radii ? radii[Math.min(i, radii.length - 1)] : radius;
      for (const side of [-1, 1]) {
        this.pos.push(p[0], p[1], p[2]);
        this.next.push(q[0], q[1], q[2]);
        this.s.push(side, acc[i], total, rand);
        this.k.push(kind, r, start, span);
        if (this.rig) {
          const a = e.alt || p;
          const b = e1 ? e1.alt || q : [2 * a[0] - (ex(i - 1).alt || P[i - 1])[0], 2 * a[1] - (ex(i - 1).alt || P[i - 1])[1], 2 * a[2] - (ex(i - 1).alt || P[i - 1])[2]];
          this.wing.push(e.wing[0], e.wing[1]);
          this.alt.push(a[0], a[1], a[2]);
          this.nextAlt.push(b[0], b[1], b[2]);
          this.part.push(e.part[0], e.part[1], e.part[2], e.part[3]);
        } else this.g.push(group);
      }
      if (i < n - 1) {
        const a = this.count + i * 2;
        this.idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    this.count += n * 2;
    this.lines++;
    return total;
  }
  geometry(ctx) {
    const g = new THREE.BufferGeometry();
    const f = (a, n) => new THREE.Float32BufferAttribute(a, n);
    g.setAttribute('position', f(this.pos, 3));
    g.setAttribute('aNext', f(this.next, 3));
    g.setAttribute('aS', f(this.s, 4));
    g.setAttribute('aK', f(this.k, 4));
    if (this.rig) {
      g.setAttribute('aWing', f(this.wing, 2));
      g.setAttribute('aAlt', f(this.alt, 3));
      g.setAttribute('aNextAlt', f(this.nextAlt, 3));
      g.setAttribute('aPart', f(this.part, 4));
    } else g.setAttribute('aG', f(this.g, 1));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    return ctx.track(g);
  }
}

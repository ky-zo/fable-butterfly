// The wing of a glasswing. Three things on one sheet:
//   the membrane  blown glass. Face-on it is all but invisible (that is the animal's trick); turned, it takes a sweep of
//                 thin-film colour — violet, cyan, gold — whose bands follow the cells, because the film is thinnest
//                 along the veins; and at one angle the key light itself. It is not flat: wrinkles fan out from the
//                 hinge and it rises to every vein, so what is seen through it is a little bent.
//   the veins     hair-fine glossy tubes, near black. A tube's highlight is a line across the light: it runs along the
//                 vein as the wing turns (the direction of each vein is in the atlas).
//   the border    velvet and ember. From the margin inward: a black rim with a row of very small white dots, a band
//                 that goes from orange to crimson and glows like stained glass with light behind it, black velvet,
//                 and a clean inner contour made of whole scales. Single scales catch the light as sparks. The white
//                 bar of the forewing is opal, and the brightest thing on the animal.
//
// MATERIAL · the realistic wing. Lighting comes from a rig (light.js); nothing here knows what world it is in.
// Variants (defines): PASS 0 everything, premultiplied and blended over what is already drawn (the default look) ·
// 1 only what is opaque, alpha-tested (for a world that draws it into an opaque scene) · 2 only the membrane's sheen,
// to go over pass 1 · 3 the flat wing's opacity into the shadow atlas · 4 what is behind the wing, defocused and bent
// (needs a picture of the scene: see Glasswing `scene`) · LOD no single scales, no relief (small or far).

import * as THREE from 'three';
import { color, hash } from '../../core/glsl.js';
import { ATLAS, BAR } from './wingData.js';
import { RG, atlasGLSL } from './atlas.js';
import { wingVertexGLSL } from './rig.js';

const f = (x) => Number(x).toFixed(4);
const v2 = (a) => `vec2(${f(a[0])}, ${f(a[1])})`;
const ORG = /* glsl */ `mix(vec2(${f(ATLAS.fore[0])}, ${f(ATLAS.fore[1])}), vec2(${f(ATLAS.hind[0])}, ${f(ATLAS.hind[1])}), W.y)`;

const VERT = (L) => /* glsl */ `
${wingVertexGLSL}
varying vec2 vP;
varying vec3 vEdge;
varying vec2 vWing;
varying vec3 vWorld;
varying vec3 vTx;
varying vec3 vTy;
varying vec4 vLook;
varying float vSun;
varying float vFar;
varying vec4 vBodyO;       // middle of the thorax (world), world units per millimetre
varying vec3 vBodyF;       // the body's long axis, toward the head (unit)
#if PASS == 4
uniform vec4 uBfLens;
#endif
#if PASS != 3
${hash}
${L.common}
${L.vertex}
#endif
void main(){
  vec2 p = position.xy;
  vec2 W = aWing;
  vP = p; vEdge = aEdge; vWing = W;
#if PASS == 3
  vWorld = vec3(0.0); vTx = vec3(1.0, 0.0, 0.0); vTy = vec3(0.0, 1.0, 0.0); vLook = vec4(0.0); vSun = 0.0; vFar = 0.0;
  vBodyO = vec4(0.0); vBodyF = vec3(0.0, 1.0, 0.0);
  gl_Position = vec4((p * ${f(ATLAS.px)} + ${ORG}) / ${f(ATLAS.size)} * 2.0 - 1.0, 0.0, 1.0);
#else
  vLook = BF_LOOK;
  mat4 m = bfModel();
  vec3 b0, tx, ty;
  bfWingFrame(b0, tx, ty);
  vec4 wp = m * vec4(b0, 1.0);
  vWorld = wp.xyz;
  vTx = normalize(mat3(m) * tx);
  vTy = normalize(mat3(m) * ty);
  vSun = bfSunVisV(wp.xyz);
  // With the wings shut over the back and the lens square to them, the pair on the far side of the body is seen
  // THROUGH the pair on the near side. 1 = this is such a wing; 0 = it is not (the wings are open, or this is the
  // near pair, or the lens looks along the wings and sees the far pair past the near one, not through it).
  vBodyO = vec4(m[3].xyz, length(m[1].xyz));
  vBodyF = m[1].xyz / vBodyO.w;
  vec3 toCam = cameraPosition - m[3].xyz;
  float lat = dot(toCam, m[0].xyz) / max(length(m[0].xyz) * length(toCam), 1e-9);
  vFar = smoothstep(0.55, 0.9, -lat * W.x) * smoothstep(0.8, 1.25, mix(BF_POSE.x, BF_POSE.y, W.y));
  vec4 vp = viewMatrix * wp;
#if PASS == 4
  // (tested against the depth buffer well behind itself: it must not paint over the body or a farther wing)
  vp.xyz *= 1.0 + uBfLens.w / max(-vp.z, 1e-4);
#endif
  gl_Position = projectionMatrix * vp;
#endif
}`;

/**
 * Where the pigment is on a wing, and the scales it is made of: for any material that wants the same markings. Needs `hash`.
 *   vec4 bfPigment(p, aEdge, hind, texture2D(tVein, bfAtlasUV(p, hind)), mmPerPixel)  → (vein, scaled, white, rust)
 *   vec4 bfPigmentBand(…same…, jitter, out vec4 band)   the same, with the border laid open in `band`
 *   vec4 bfScale(p, seed)                               the scales themselves
 */
export const pigmentGLSL = /* glsl */ `
#ifndef BF_PIGMENT
#define BF_PIGMENT
float bfSdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }

// Where the pigment is.
//   returns  x: vein   y: scaled (the border, the dark band over the end of the cell, the frame of the white bar)
//            z: white (the bar of the forewing, the dots of the margin)   w: rust, how much of the border here is ember
//   band     x: ember 0..1 (the band of amber and crimson inside the border)   y: its heat, 0 the amber core … 1 the
//            crimson of its inner shoulder (0.55 on its outer lip)   z: the white bar alone   w: across the border,
//            0 the margin … 1 its inner contour
//   jit      millimetres every contour is moved by: 0, or each scale's own number, so that an edge is made of whole scales
vec4 bfPigmentBand(vec2 p, vec3 e, float hind, vec4 vf, float px, float jit, out vec4 band){
  float vd = (vf.r - 0.5) * ${f(2 * RG)};
#ifdef BF_VEIN_SOLID
  // (alpha-tested, a vein cannot be faint: it is never drawn thinner than a pixel)
  float grow = clamp(0.5 * px - 0.02, 0.0, 0.2);
  float aa = min(0.75 * px, 0.14);
  float vein = smoothstep(-aa, aa, vd + grow) * mix(1.0, 0.3, smoothstep(0.25, 1.0, px));
#else
  // a vein is hair-fine. Thinner than a pixel it is drawn a pixel wide and as faint as it is thin — never a pixel of
  // solid black: that is what turns a clear wing into smoked glass when the animal is small
  // (a vein is about 0.07 mm across: that much of a pixel is the most it can cover)
  float vein = min(clamp(0.5 + vd / clamp(px, 0.012, 0.5), 0.0, 1.0), clamp(0.065 / px, 0.1, 1.0));
#endif
  float x = e.x + jit;
  // the border reaches a little way inward along every vein that meets it: its inner contour is scalloped
  float bw = e.y * (1.0 + 0.7 * vf.g * vf.g);
  float ea = clamp(0.6 * px, 0.01, 0.45 * bw);
  float cover = 1.0 - smoothstep(bw - ea, bw + ea, x);
  // across it, from the margin inward: a black rim, the ember, black velvet. The ember has an amber core a third of
  // the way in and falls to crimson on both shoulders, and from crimson into the black: no hard line anywhere in it
  float rim = min(0.4, 0.32 * bw);
  float ew = (bw - rim) * 0.6 * e.z;
  float et = (x - rim) / max(ew, 0.001);
  float es = min(ea / max(ew, 0.001), 0.3);
  float ember = smoothstep(-es, 0.16 + es, et) * (1.0 - smoothstep(0.58 - es, 1.0 + es, et));
  // (where the band is thinner than a pixel there is less of it, not a line of it)
  ember *= clamp(ew / max(1.5 * px, 0.03), 0.0, 1.0);
  float heat = clamp(smoothstep(0.3, 1.0, et) + 0.55 * smoothstep(0.3, 0.0, et), 0.0, 1.0);
  // (from far off the band is narrower than a pixel: the border is then the blend the eye would make of it)
  float farK = smoothstep(0.25, 0.7, px / max(bw, 0.05));
  ember = mix(ember, 0.45 * e.z, farK) * cover;
  heat = mix(heat, 0.3, farK);
  // (and none at the root of the wing: the base is plain dark)
  ember *= smoothstep(1.2, 4.0, length(p));
  // a row of very small white dots in the rim of the outer margins
  float s = hind < 0.5 ? p.x * 1.13 : atan(p.y + 1.4, p.x - 8.2) * 11.6;
  float da = clamp(0.6 * px, 0.008, 0.09);
  float dots = 1.0 - smoothstep(0.105 - da, 0.105 + da, length(vec2((fract(s / 1.5) - 0.5) * 1.5, e.x - 0.21)));
  dots *= smoothstep(0.95, 1.15, e.y) * smoothstep(0.3, 0.1, px) * mix(smoothstep(-0.7, -1.7, p.y), 1.0, hind);
  float bar = 0.0;
  if (hind < 0.5) {
    // forewing: a dark band over the end of the cell, narrowing toward the back of it; beyond it the white bar, a
    // lozenge from the leading edge drawn to a point, in a hairline frame
    float dc = min(bfSdSeg(p, ${v2(BAR.dc[0])}, ${v2(BAR.dc[1])}), bfSdSeg(p, ${v2(BAR.dc[1])}, ${v2(BAR.dc[2])})) * (1.0 + 0.5 * smoothstep(0.5, -2.8, p.y));
    cover = max(cover, 1.0 - smoothstep(${f(BAR.dcw)} - ea, ${f(BAR.dcw)} + ea, dc + jit));
    vec2 ab = ${v2(BAR.b)} - ${v2(BAR.a)};
    float along = clamp(dot(p - ${v2(BAR.a)}, ab) / dot(ab, ab), 0.0, 1.0);
    float wdt = ${f(BAR.w)} * (0.55 + 0.45 * smoothstep(0.0, 0.22, along)) * (1.0 - 0.8 * along * sqrt(along));
    float db = bfSdSeg(p, ${v2(BAR.a)}, ${v2(BAR.b)}) + jit;
    bar = (1.0 - smoothstep(wdt - ea, wdt + ea, db)) * smoothstep(0.26 - ea, 0.26 + ea, x);
    cover = max(cover, 1.0 - smoothstep(wdt + 0.13 - ea, wdt + 0.13 + ea, db));
  }
  band = vec4(ember * (1.0 - bar), heat, bar, clamp(x / max(bw, 0.001), 0.0, 1.0));
  return vec4(vein, cover, max(bar, dots) * cover, e.z);
}
vec4 bfPigment(vec2 p, vec3 e, float hind, vec4 vf, float px){
  vec4 band;
  return bfPigmentBand(p, e, hind, vf, px, 0.0, band);
}

// Scales: rows around a point behind the hinge, staggered, each tip rounded and lying over the next row.
// Returns x: 1 on the lit part of a scale → 0 in the shadow under the row before it, y z: two random numbers of this
// scale, w: distance to its tip in rows (for the rim).
vec4 bfScale(vec2 p, float seed){
  vec2 q = p - vec2(-9.0, 0.6);
  float r = length(q), th = atan(q.y, q.x);
  const float ROW = 0.21, COL = 0.15;
  float rf = r / ROW;
  float ri = floor(rf), v = rf - ri;
  float n = floor(6.2831853 * (ri + 0.5) * ROW / COL);
  float cf = th / 6.2831853 * n + 0.5 * mod(ri, 2.0) + hash11(ri + seed) * 0.4;
  float ci = floor(cf), u = cf - ci - 0.5;
  float tip = 1.0 - 2.1 * u * u;                    // the outline of this row's tips, in rows
  float own = tip - v;
  if (own < 0.0) {
    // in the notch between two tips: the scale of the next row out is what shows
    ri += 1.0; v -= 1.0;
    n = floor(6.2831853 * (ri + 0.5) * ROW / COL);
    cf = th / 6.2831853 * n + 0.5 * mod(ri, 2.0) + hash11(ri + seed) * 0.4;
    ci = floor(cf); u = cf - ci - 0.5;
  }
  vec2 h = hash22(vec2(ri, ci) + seed * 31.0);
  // (lit toward its tip, in shadow where the row before lies over it; fine ridges run its length)
  float lit = smoothstep(-0.6, 0.7, v) * (0.88 + 0.12 * cos(u * 44.0));
  return vec4(lit, h, own < 0.0 ? 1.0 : own);
}
#endif
`;

const FRAG = (L) => /* glsl */ `
precision highp float;
varying vec2 vP;
varying vec3 vEdge;
varying vec2 vWing;
varying vec3 vWorld;
varying vec3 vTx;
varying vec3 vTy;
varying vec4 vLook;
varying float vSun;
varying float vFar;
varying vec4 vBodyO;
varying vec3 vBodyF;
uniform sampler2D tVein, tNoise;
${hash}
${color}
#if PASS != 3
${L.common}
${L.fragment}
#endif
#if PASS == 4 || defined(BF_SCENE)
uniform sampler2D tBfScene;    // the scene without the insect, with a mip chain; a = distance from the lens (m)
uniform vec2 uBfRes;           // size of the target being drawn into (px)
uniform vec4 uBfLens;          // focus (m), aperture, largest blur (px), how far behind itself the wing is tested (m)
#if PASS == 4
uniform float uBfPre;          // 1 the whole disc of taps … 0.34 two of them, each softer (when the wings fill the frame); under a sixth it fades out
#endif
#endif
#if PASS == 1
#define BF_VEIN_SOLID
#endif
${atlasGLSL}
${pigmentGLSL}
// The film's thickness (nm): thinnest along a vein, thickest in the middle of a cell, so its colours run in bands
// round each cell. g = the atlas's vein field there, wr = the wrinkle that fans out from the hinge through this point.
float bfFilm(vec2 p, float g, float wr, float grain, float seed){
  // (most of the change is slow, across whole cells: a film that changed only beside the veins would give each vein a
  // coloured fringe, like a badly corrected lens)
  return 244.0 + 64.0 * (1.0 - g) * (0.62 + 0.38 * wr) + 20.0 * grain + 60.0 * wr + 66.0 * sin(p.x * 0.21 + p.y * 0.13 + seed * 9.0) + 48.0 * sin(p.x * 0.09 - p.y * 0.33 + seed * 5.0);
}
// The film's colour for an optical path (nm: thickness × the cosine inside the film). Not the whole rainbow, which is
// what a soap bubble or a foil sticker shows: two neighbours, cyan and violet, and a thread of pale gold between them —
// the cool half of the palette, against the ember of the border.
vec3 bfFilmCol(float opd){
  float h = opd / 170.0;
  vec3 c = mix(vec3(0.66, 0.54, 1.0), vec3(0.42, 0.86, 1.0), 0.5 + 0.5 * cos(6.2831853 * h));
  float g = 0.5 + 0.5 * cos(6.2831853 * (h * 0.5 + 0.21));
  return mix(c, vec3(1.0, 0.82, 0.52), g * g * g * 0.7);
}

void main(){
  vec2 W = vWing;
  float px = max(length(dFdx(vP)), length(dFdy(vP)));            // millimetres per pixel
  vec4 n1 = texture2D(tNoise, vP * 0.047 + W.yx * 0.37 + vLook.z);
  vec4 n2 = texture2D(tNoise, vP * 0.33 + W.xy * 0.21);
  // the margin: the tips of the last row of scales, a twentieth of a millimetre of unevenness and no more
  float fringe = (n2.g - 0.5) * 0.05 * smoothstep(0.12, 0.03, px);
  float inside = smoothstep(-0.7 * px, 0.7 * px, vEdge.x + fringe);
  if (inside < 0.004) discard;
  vec2 auv = (vP * ${f(ATLAS.px)} + ${ORG}) / ${f(ATLAS.size)};
  vec4 vf = texture2D(tVein, auv);
  // Single scales. Two distances: from lod inward a scale is two or three pixels and shows only as grain (no two
  // the same value); from fine inward it is many pixels, and then it has its own relief and every contour of the
  // pigment is made of whole scales. (Whole scales at three pixels each would only look like a staircase.)
  vec4 sc = vec4(1.0, 0.5, 0.5, 1.0);
  float lod = 1.0, fine = 0.0;
  vec4 band;
#if !defined(LOD) && PASS != 3 && PASS != 4
  lod = smoothstep(0.03, 0.1, px);
  fine = 1.0 - smoothstep(0.011, 0.028, px);
#endif
  vec4 pg = bfPigmentBand(vP, vEdge, W.y, vf, px, -0.08 * fine, band);
#if !defined(LOD) && PASS != 3 && PASS != 4
  if (lod < 1.0 && pg.y > 0.002) {
    sc = bfScale(vP, vLook.z + W.y * 3.0 + W.x);
    if (fine > 0.0) pg = bfPigmentBand(vP, vEdge, W.y, vf, px, (sc.y - 0.5) * 0.11 * fine, band);
  }
#endif

#if PASS == 3
  float op = max(max(pg.x * 0.92, pg.y * 0.95), 0.1 + 0.05 * n2.g);
  op = mix(op, 0.62, pg.z);
  gl_FragColor = vec4(op * inside);
#elif PASS == 4
  // What is behind the wing, as far out of focus as the lens has it. (The lens's own depth of field cannot do this: to
  // it the wing is one sharp surface.) Drawn before the wing itself; where the room behind is in focus it does nothing.
  vec2 uv = gl_FragCoord.xy / uBfRes;
  float d = textureLod(tBfScene, uv, 0.0).a;
  float coc = clamp((d - uBfLens.x) / max(d, 1e-4) * uBfLens.y, 0.0, 1.0) * uBfLens.z;
  float k = smoothstep(0.5, 2.5, coc);
  vec3 rd = normalize(vWorld - cameraPosition);
  vec3 Nw = normalize(cross(vTx, vTy));
  // (the breath of colour the film lends to what is seen through it is added by the wing itself, pass 0: it does not
  // need the lens to be open)
  float cover = k * clamp(uBfPre * 6.0, 0.0, 1.0);
  if (cover < 0.01) discard;
  // blown glass bends what it shows: by its own curve, by its grain, and most where it rises to a vein
  uv += (Nw.xy * 0.009 + (n1.rg - 0.5) * 0.006) * (0.3 + 0.7 * (1.0 - abs(dot(Nw, rd))));
  uv -= clamp(vec2(dFdx(vf.g), dFdy(vf.g)) * 0.34 / max(px * px, 0.0009), -9.0, 9.0) / uBfRes * (1.0 - pg.x);
  // (a disc of taps, like the lens's own; each tap already as soft as the gaps between them — and where the room behind
  // is in focus anyway, one tap: there is only the colour to add)
  float lodS = max(log2(max(coc, 1.0)) - 1.6, 0.0);
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  vec3 acc; float tot = 0.6;
  if (uBfPre > 0.999) {
    acc = textureLod(tBfScene, uv, lodS).rgb * 0.6;
    if (k > 0.01) {
      for (int i = 0; i < 6; i++) {
        float a = rot + float(i) * 2.39996323;
        float rr = sqrt((float(i) + 0.6) / 6.0) * coc;
        acc += min(textureLod(tBfScene, uv + vec2(cos(a), sin(a)) * rr / uBfRes, lodS).rgb, vec3(30.0)); tot += 1.0;
      }
    }
  } else {
    // (uBfPre < 1: fewer taps, the outer ones leaving first, and each of those that stay wider and softer for it — for
    // the moment the lens is so close that the wings are most of the frame and four of them lie over one another)
    float taps = 6.0 * uBfPre;
    lodS += 1.9 * (1.0 - uBfPre);
    acc = textureLod(tBfScene, uv, lodS).rgb * 0.6;
    for (int i = 0; i < 6; i++) {
      float wt = clamp(taps - float(i), 0.0, 1.0);
      if (wt <= 0.0 || k <= 0.01) break;
      float a = rot + float(i) * 2.39996323;
      float rr = sqrt((float(i) + 0.6) / max(taps, 1.0)) * coc;
      acc += min(textureLod(tBfScene, uv + vec2(cos(a), sin(a)) * rr / uBfRes, lodS).rgb, vec3(30.0)) * wt; tot += wt;
    }
  }
  gl_FragColor = vec4(acc / tot, cover * inside);
#else
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N0 = normalize(cross(vTx, vTy));
  float face = dot(N0, V) < 0.0 ? -1.0 : 1.0;
  vec3 Nf = N0 * face;
  float ndv0 = abs(dot(N0, V));
  float species = vLook.x;
  float backlit = max(dot(-V, BF_SUN_DIR), 0.0);
  vec3 sun = BF_SUN_COL * vSun;
  float ndl = dot(Nf, BF_SUN_DIR);
  float seed = vLook.z;
#if PASS == 1
  float mute = 1.0;
#else
  // (the far pair, seen through the near pair: held back, so that the picture is one wing and its echo, not two outlines)
  float mute = 1.0 - 0.5 * vFar;
#endif

  // ---- the membrane's own relief: wrinkles fanned out from the hinge, a rise to every vein, fine grain
  float th = atan(vP.y, vP.x + 3.0), rr = length(vP + vec2(3.0, 0.0));
  float wr = texture2D(tNoise, vec2(th * 2.7 + seed, rr * 0.011)).g;
  vec2 bump = (n1.rg - 0.5) * 0.1 + (n2.ra - 0.5) * 0.04 + vec2(-sin(th), cos(th)) * (wr - 0.5) * 0.16;
#ifndef LOD
  {
    // (the slope of the vein field, per millimetre, from its slope per pixel)
    vec2 dx = dFdx(vP), dy = dFdy(vP);
    float det = dx.x * dy.y - dx.y * dy.x;
    vec2 gs = vec2(dFdx(vf.g), dFdy(vf.g));
    if (abs(det) > 1e-9) bump -= clamp(vec2(dy.y * gs.x - dx.y * gs.y, dx.x * gs.y - dy.x * gs.x) / det, -1.2, 1.2) * 0.09;
  }
#endif
  vec3 Nm = normalize(Nf + (vTx * bump.x + vTy * bump.y) * face);
  float NdV = abs(dot(Nm, V));

  // ---- membrane. Two separate things: what it takes away from what is behind it (next to nothing: 2 % face-on, a
  // sixth edge-on), and what it adds — the room mirrored in a film that colours the mirror image, never the glass.
  // (A glasswing's membrane is the least reflective thing in nature: 1 % face-on, and little until it is well turned.
  // Window glass gives back 8 %, and a wing that did would be a grey sheet in front of anything dark.)
  float graze = pow(1.0 - NdV, 3.0);
  float F = 0.011 + 0.33 * pow(1.0 - NdV, 4.5);
  vec3 R = reflect(-V, Nm);
  vec3 env = bfEnv(vWorld, R, 0.2);
  // (its colours run in bands round each cell, and slide across it as the wing turns: the colour goes with the angle too)
  vec3 film = bfFilmCol(bfFilm(vP, vf.g, wr, n1.r, seed) * sqrt(1.0 - (1.0 - NdV * NdV) / 2.25));
  // (full colour when half turned; edge-on the film is a silver sheen with a quarter of it — foil is what full colour
  // at a grazing angle looks like)
  vec3 tint = mix(vec3(1.0), film * 1.3, 0.85 * mix(0.25, 1.0, smoothstep(0.05, 0.36, NdV)));
  vec3 mem = env * F * tint;
  vec3 H = normalize(BF_SUN_DIR + V);
  float nh = abs(dot(Nm, H));
  float sideL = smoothstep(-0.05, 0.05, ndl);
  // the key light in the film: a hot core, a bloom of the film's colour round it, a wide faint wash beyond that
  mem += sun * (exp(-(1.0 - nh) * 3000.0) * 3.0 + (exp(-(1.0 - nh) * 260.0) * 0.3 + exp(-(1.0 - nh) * 26.0) * 0.025) * tint) * (0.03 + 0.75 * graze) * sideL;
  // lit from behind, the little the membrane holds — its own grain — glows
  float fwd = pow(backlit, 5.0);
  mem += sun * fwd * (0.7 + 0.6 * max(-ndl, 0.0)) * (0.005 + 0.014 * n1.g * n2.g);
  mem *= 1.0 - 0.8 * vFar;
  float aMem = 0.02 + 0.15 * graze;
#ifdef BF_SCENE
  {
    // …and what blown glass does to what is seen through it: it lends it a breath of its own colour. Never a shade:
    // the colour is given at the brightness of what is behind (glass that darkens what it shows is tinted plastic).
    // Most when the film is half turned from the eye; face-on a whisper; edge-on next to none (full colour at a
    // grazing angle is what foil looks like). What is behind is
    // multiplied by (1 + ta (thr - 1)): the part of that below 1 is taken as coverage, the part above it is added.
    vec3 thr = film / dot(film, vec3(0.25, 0.62, 0.13));
    float mn = min(thr.r, min(thr.g, thr.b));
    // (and less on a small animal: there the bands have run together, and a wing of one colour is a tinted wing)
    float ta = (0.17 + 0.36 * smoothstep(1.0, 0.62, NdV) * smoothstep(0.14, 0.5, NdV)) * (0.25 + 0.75 * smoothstep(0.02, 0.3, NdV)) * (1.0 - 0.8 * vFar) * (0.55 + 0.45 * smoothstep(0.4, 0.12, px));
    // (but not where it is its own body that is behind this part of the wing: the picture of the scene has no insect
    // in it, and the body is black. A wing in front of the body is the only kind this is drawn for — one behind it
    // fails the depth test — so it is enough to ask how near the line of sight passes to the body's axis.)
    vec3 bA = vBodyO.xyz - vBodyF * (11.6 * vBodyO.w) - vWorld, bB = vBodyF * (16.4 * vBodyO.w);
    bA -= V * dot(V, bA); bB -= V * dot(V, bB);
    float clearOf = smoothstep(1.1, 2.1, length(bA + bB * clamp(-dot(bA, bB) / max(dot(bB, bB), 1e-12), 0.0, 1.0)) / vBodyO.w);
    mem += min(textureLod(tBfScene, gl_FragCoord.xy / uBfRes, 0.0).rgb, vec3(8.0)) * ta * (thr - mn) * clearOf;
    aMem += ta * (1.0 - mn) * clearOf;
  }
#endif

  vec3 col = mem; float alpha = aMem;
  // ---- pigment (most of a glasswing's wing has none: only where there is a vein or a scale is any of this worked out)
  if (species > 0.5 || pg.x + pg.y > 0.004) {
  // (scales are translucent: besides the light on their far face, they are tinted by whatever is bright behind them
  // along the line of sight — the picture of the scene if the world gave one, else what the rig says is out there)
#ifdef BF_SCENE
  vec3 behind = min(textureLod(tBfScene, gl_FragCoord.xy / uBfRes, 3.5).rgb, vec3(6.0));
#else
  vec3 behind = bfEnv(vWorld, -V, 0.7);
#endif
  // both faces are lit; whatever is behind comes through coloured
  vec3 ambF = bfAmb(vWorld, Nf), ambB = bfAmb(vWorld, -Nf);
  vec3 front = ambF + sun * max(ndl, 0.0) * 0.5;
  vec3 back = ambB * 0.55 + behind * 0.9 + sun * (max(-ndl, 0.0) * 0.3 + fwd * 0.35);

  // veins: glossy tubes. The highlight of a tube is a line across the light — where the vein runs square to the
  // half-vector — so it lies along a length of the vein as a soft warm sheen, and travels along it as the wing turns
  float vd = (vf.r - 0.5) * ${f(2 * RG)};
  float round_ = clamp(vd / 0.05 + 0.4, 0.0, 1.0);
  vec2 td = bfVeinDir(vf);
  // (no vein is quite straight: it wavers with the film it stands on)
  vec3 Tv = normalize(vTx * td.x + vTy * td.y + Nf * (0.16 * sin(vP.x * 0.37 + vP.y * 0.29 + seed * 5.0) + (wr - 0.5) * 0.1));
  // (a tube stands proud of both faces of the film: with the light behind the wing it is the tube's rim that catches
  // it, along the same line — so the light is taken as its mirror image in the wing)
  vec3 Hf = normalize(BF_SUN_DIR - 2.0 * min(ndl, 0.0) * Nf + V);
  float tH = dot(Tv, Hf);
  vec3 veinC = vec3(0.011, 0.009, 0.008) * front * (0.5 + 0.7 * round_) + vec3(0.09, 0.035, 0.012) * back * 0.02;
  // (a third of what it was, a wider lobe, and none at all once a vein is thinner than a pixel: a white dash across a
  // small wing reads as a scratch)
  veinC += env * 0.06 * round_ + sun * exp(-tH * tH * 240.0) * (0.6 + 0.4 * sideL) * 0.085 * smoothstep(0.3, 0.1, px);

  // border scales
  float shade = 1.0 + fine * (-0.5 + 0.62 * sc.x + 0.4 * smoothstep(0.16, 0.0, sc.w) * step(0.01, sc.x));
  // (never the same from one scale to the next; and velvet is never one value even where no scale can be told)
  float vary = mix(sc.y, 0.5, lod), vary2 = mix(sc.z, 0.5, lod);
  float grain = 0.8 + 0.4 * n2.b;
  float white = pg.z;
  // (edge-on, the band is a dark line: light does not come through a scale along its length)
  float eK = band.x * smoothstep(0.03, 0.26, ndv0);
  float heat = band.y;
  vec3 emberT = mix(vec3(1.0, 0.5, 0.07), vec3(0.6, 0.035, 0.012), heat);
  // (lit from the front it is a deep burnt orange, not paint: it is the light THROUGH it that makes it an ember)
  vec3 emberA = mix(vec3(0.25, 0.075, 0.01), vec3(0.1, 0.009, 0.006), heat);
  vec3 scAlb = mix(vec3(0.0095, 0.0075, 0.0075) * (0.6 + 0.8 * vary2), emberA * (0.75 + 0.5 * vary), eK) * grain;
  vec3 scTrans = mix(vec3(0.01, 0.004, 0.003), emberT * (0.72 + 0.56 * vary), eK);
  // white scales: warm pearl, one hue, a little uneven; with the light behind them they glow like milk glass
  scAlb = mix(scAlb, vec3(0.66, 0.64, 0.585) * (0.88 + 0.24 * vary2) * (0.9 + 0.2 * n2.b), white);
  scTrans = mix(scTrans, vec3(1.0, 0.94, 0.82), white);
  vec3 scC = scAlb * front * shade + scTrans * back * mix(0.68, 0.86, white) * (0.6 + 0.4 * shade);
  // (the ember keeps its colour however hard it is lit: it deepens, it does not bleach to peach)
  scC /= 1.0 + 0.7 * max(scC.r - 0.7, 0.0) * eK;
  if (pg.y > 0.004) {
    float blackK = (1.0 - white) * (1.0 - eK);
    float fall0 = 1.0 - ndv0;
    // velvet: the black shows its pile where light rakes across it
    scC += vec3(0.02, 0.018, 0.018) * blackK * fall0 * fall0 * smoothstep(0.0, 0.2, ndv0) * (ambF + ambB + sun * 0.3);
    // …and a structural sheen, the one cold note on the animal: blue-violet, in the key's highlight and faintly in
    // whatever the wing mirrors. Pearl on the white.
    float nhf = abs(dot(Nm, Hf));
    scC += mix(vec3(0.045, 0.07, 0.19), vec3(0.2, 0.24, 0.3), white) * (1.0 - eK) * grain * (sun * pow(nhf, 26.0) * 0.22 + env * 0.1);
    // sparks: every scale lies a little differently, and the few that face the light just so flash. Copper-gold on
    // the ember, where almost all of them are; a rare cold one on the black; white on the white.
    // (taken a scale at a time up close, a pixel at a time from far off: the border glints at any size)
    float cs = max(0.17, 1.6 * px);
    vec2 cq = vP / cs;
    vec2 ci = floor(cq);
    vec2 hs = hash22(ci + seed * 17.0 + W * 7.0);
    vec3 Ns = normalize(Nf + (vTx * (hs.x - 0.5) + vTy * (hs.y - 0.5)) * 1.3);
    float spot = smoothstep(0.36, 0.08, length(fract(cq) - 0.5)) * step(0.7, hash12(ci * 1.37 + 3.1));
    vec3 sparkC = mix(mix(vec3(0.3, 0.42, 1.0), vec3(1.0, 0.62, 0.2), eK), vec3(1.0, 0.96, 0.88), white);
    float tight = mix(1100.0, 170.0, smoothstep(0.1, 0.4, px));
    scC += sparkC * spot * (eK + 0.6 * white + 0.1 * blackK) * (sun * pow(abs(dot(Ns, Hf)), tight) * 4.0 + (ambF + ambB) * pow(abs(dot(Ns, V)), 2600.0) * 1.2);
  }
  float aSc = mix(0.97, 0.86, white) * mute;

  if (species < 0.5) {
    col = mix(col, scC * aSc, pg.y); alpha = mix(alpha, aSc, pg.y);
    col = mix(col, veinC * 0.97 * mute, pg.x); alpha = mix(alpha, 0.97 * mute, pg.x);
  } else {
    // the others in the garden: the same wing, fully scaled. 1: an orange longwing, black veins and tips. 2: a white.
    float tipD = smoothstep(0.62, 0.86, vP.x / mix(29.5, 20.0, W.y) + 0.1 * (n1.g - 0.5));
    vec3 alb, tr;
    if (species < 1.5) {
      float dark = max(max(pg.x, pg.y), tipD * (1.0 - W.y));
      alb = mix(vec3(0.62, 0.19, 0.02), vec3(0.02, 0.012, 0.008), dark); tr = mix(vec3(1.0, 0.4, 0.06), vec3(0.2, 0.08, 0.03), dark);
      alb = mix(alb, vec3(0.7, 0.6, 0.4), pg.z * 0.8);
    } else {
      float dark = max(pg.x * 0.3, max(pg.y * 0.25, tipD * (1.0 - W.y) * 0.8));
      alb = mix(vec3(0.66, 0.64, 0.54), vec3(0.05, 0.045, 0.04), dark); tr = vec3(0.85, 0.8, 0.62);
    }
    col = alb * front * (0.85 + 0.3 * n2.g) + tr * alb * back * 1.6; alpha = 1.0;
  }
  }
#if PASS != 1
  if (species < 0.5) {
    // (a wing seen exactly edge-on is a hairline, and a faint one)
    float thin = 0.2 + 0.8 * smoothstep(0.0, 0.14, ndv0);
    col *= thin; alpha *= thin;
  }
#endif

#if PASS == 1
  if (alpha * inside < 0.5) discard;
  gl_FragColor = bfFinish(max(col / max(alpha, 0.5), 0.0), 1.0, vWorld);
#elif PASS == 2
  if (species > 0.5 || alpha > 0.5) discard;
  gl_FragColor = vec4(bfFinish(max(col, 0.0), 1.0, vWorld).rgb * inside, alpha * inside);
#else
  gl_FragColor = bfFinish(max(col, 0.0) * inside, alpha * inside, vWorld);
#endif
#endif
}`;

const cache = new WeakMap();
function shaders(light) {
  let c = cache.get(light);
  if (!c) cache.set(light, (c = { vertexShader: VERT(light), fragmentShader: FRAG(light) }));
  return c;
}
const NO_LIGHT = { common: '', vertex: '', fragment: '' };

/**
 * @param o.pass      0..4 (see the top of this file)       @param o.lod  no single scales, no relief
 * @param o.scene     true: translucent scales are tinted by the picture of the scene behind them (tBfScene, uBfRes)
 * @param o.light     a light rig (light.js); not needed for pass 3
 * @param o.uniforms  the rest: tVein, tNoise, the pose (rig.js: poseUniforms) and, for pass 4, tBfScene / uBfRes / uBfLens
 */
export function makeWingMaterial({ pass = 0, lod = false, scene = false, light = NO_LIGHT, uniforms = {} }) {
  const defines = { PASS: pass };
  if (scene) defines.BF_SCENE = 1;
  if (lod) defines.LOD = 1;
  const premult = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };
  const opts =
    pass === 0
      ? { transparent: true, depthWrite: true, ...premult }
      : pass === 2
        ? { transparent: true, depthWrite: false, ...premult, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor }
        : pass === 3
          ? { depthTest: false, depthWrite: false }
          : pass === 4
            ? { transparent: true, depthWrite: false, ...premult, blendSrc: THREE.SrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor }
            : {};
  return new THREE.ShaderMaterial({
    ...shaders(light),
    defines,
    uniforms: { ...(light.uniforms || {}), ...uniforms },
    side: THREE.DoubleSide,
    ...opts,
  });
}

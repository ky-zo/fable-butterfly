// The pane. Frosted, depth-aware refraction + living condensation.
//
// What makes fogged glass read as fogged glass is that blur grows with distance BEHIND the pane: a leaf that touches
// the glass is razor sharp, a hand's width back it is a ghost, a metre back it is only colour. So:
//   near field  : gathered tap by tap from the sharp garden image. Each tap carries q (how far behind the glass it is),
//                 which gives it its own circle of confusion; a tap only contributes if its circle reaches this pixel,
//                 and a tap behind the centre sample cannot blur further than the centre does (no bleed over contact shapes).
//   mid / far   : read from pyramids that were premultiplied by depth-layer weights, then composited back to front.
// The same q drives the camera's defocus of whatever is seen through cleared glass, so a wiped streak in the macro shot
// shows creamy bokeh while each droplet — a tiny wide-angle lens — shows the whole garden sharp and upside down.

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { layoutGLSL } from './layout.js';
import { pyramidGLSL } from './pyramid.js';
import { sunGLSL } from './sun.js';
import { paneGLSL, paneUniforms } from './panes.js';
import { dressGLSL } from './dressing.js';
import { bodyGLSL, dressApplyGLSL } from './glassBody.js';
import { shadowGLSL } from '../../shared/butterfly/shadow.js';

export const GLASS_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vST;
void main(){
  vST = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;


/** A water bead as a lens: the whole garden, upside down, with a dark meniscus, the sky pooled at the bottom,
 *  the opposite wall as a small window highlight, and the sun as a hard spark. Needs pyramid + layout + uGlow + uRes. */
export const lensGLSL = /* glsl */ `
vec3 lensColor(vec2 d, float dd, vec2 cuv, float rpx, vec3 nrm, vec3 tanS, float vis){
  float hgt = sqrt(max(1.0 - dd * dd, 0.0));
  float aspect = uRes.x / uRes.y;
  vec2 span = vec2(0.3 / aspect, 0.3) * (0.6 + 0.4 * dd * dd);
  vec2 luv = cuv - d * span;
  float lv = log2(max(0.3 * uRes.y / max(rpx, 1.0), 2.0));
  vec3 lc = pyrAll(lv, luv).rgb;
  lc *= mix(0.1, 1.0, smoothstep(0.0, 0.55, hgt));                              // dark meniscus
  lc *= 1.0 + 1.8 * smoothstep(0.35, 0.95, -d.y) * smoothstep(1.0, 0.75, dd);   // the sky pools at the bottom
  float flip = nrm.x > 0.0 ? 1.0 : -1.0;
  vec2 hl = d - vec2(-0.32 * flip, 0.42);
  float win = smoothstep(0.2, 0.06, max(abs(hl.x) * 1.4, abs(hl.y)));
  lc += uGlow[nrm.x > 0.0 ? 1 : 0] * (win * 1.4 + 0.07 * hgt);     // (and a little of the room in the whole of it)
  vec2 Lt = vec2(dot(SUN_DIR, tanS), SUN_DIR.y);
  float spark = smoothstep(0.2, 0.03, length(d + Lt * 0.62));
  lc += SUN_COL * vis * max(dot(-nrm, SUN_DIR), 0.0) * spark * 1.2;
  return lc;
}`;

const GLASS_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec2 vST;
// WALL (define): 0 left, 1 right, 2 end, 3 roof / gable / behind the visitor (static fog, no simulation)
uniform vec3 uNormal;         // pane normal, pointing into the corridor
uniform vec3 uTanS;           // world direction of +s on this wall
uniform vec3 uViewDir;        // camera forward
uniform vec2 uRes;
uniform sampler2D tGarden;
uniform vec4 uGS;             // the garden image occupies a corner of its target: uv scale (xy) and last valid uv (zw)
uniform sampler2D tSim;       // r fog, g water film, b age
uniform sampler2D tDir;       // rg doubled-angle stroke direction
uniform sampler2D tScreen;    // sun arriving on this pane (soft leaf shadows), wall space
uniform sampler2D tNoise;
uniform vec2 uSimSize;
uniform float uK, uR;         // frost blur px per q at full fog; near-field gather radius px
uniform vec2 uNearFar;
uniform float uTime, uClear;
uniform vec3 uGlow[7];        // what each hull plane looks like in a reflection
uniform vec3 uAmb;            // what the fog on this wall glows with when no direct sun reaches it
uniform float uSunGain;       // art direction of the direct sun on this wall's fog
${hash}
${layoutGLSL}
${pyramidGLSL}
${sunGLSL}
${lensGLSL}
${paneGLSL}
${dressGLSL}
${bodyGLSL}
${dressApplyGLSL}
uniform vec4 uTape[2];
uniform float uCamK;          // px of camera defocus per unit q (only while the lens rests on the pane)
uniform sampler2D tAir;       // a: sun shafts in the garden's air along this line of sight
#if WALL == 1
${shadowGLSL('SUN_DIR')}
#endif

vec4 texBicubic(sampler2D t, vec2 uv, vec2 size){
  vec2 p = uv * size - 0.5;
  vec2 f = fract(p); p -= f;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (p - 0.5 + w1 / g0) / size;
  vec2 h1 = (p + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * texture2D(t, vec2(h0.x, h0.y)) + g1.x * texture2D(t, vec2(h1.x, h0.y)))
       + g1.y * (g0.x * texture2D(t, vec2(h0.x, h1.y)) + g1.x * texture2D(t, vec2(h1.x, h1.y)));
}

// One layer of beads on a jittered grid. Returns local position inside the bead (xy, -1..1), coverage (z), radius in metres (w).
vec4 beadLayer(vec2 st, float cell, float grow, float seed, float px, float rMin, float rMax){
  vec2 g = st / cell;
  vec2 id = floor(g);
  vec3 h = hash32(id + seed);
  float r = mix(rMin, rMax, h.x * h.x) * grow;
  vec2 c = 0.5 + (hash22(id + seed + 7.3) - 0.5) * (1.0 - 2.0 * rMax);
  vec2 d = (fract(g) - c) / max(r, 1e-4);
  d.y = d.y * (0.92 + 0.1 * d.y);                  // gravity: a little heavier at the bottom
  float dd = length(d);
  float aa = px / max(cell * r, 1e-6);
  float m = smoothstep(1.0 + aa, 1.0 - aa, dd) * step(0.02, r) * smoothstep(0.55, 0.3, aa);   // (under ~2 px a bead is not drawn at all)
  return vec4(d, m, cell * r);
}

void main(){
  vec2 fragUV = gl_FragCoord.xy / uRes;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float NdV = abs(dot(uNormal, V));
  float sH = uRes.y / 1080.0;
  vec2 st = vST;
  vec2 dsdx = dFdx(st), dsdy = dFdy(st);
  float px = max(length(dsdx), length(dsdy));      // metres per pixel on the pane
  float det = dsdx.x * dsdy.y - dsdx.y * dsdy.x;
  mat2 toPx = mat2(dsdy.y, -dsdx.y, -dsdy.x, dsdx.x) / (abs(det) < 1e-12 ? 1e-12 : det);
  bool closeUp = px < 0.0024;                      // beads only exist where a pixel can hold them
  vec2 wsz = WALL == 2 ? vec2(END_W, WALL_H) : vec2(WALL_LEN, WALL_H);

  // ------------------------------------------------------------------ which pane, and what a century left on it
  vec2 pl, psz; float prow;
  vec4 pane = paneAt(WALL, st, pl, psz, prow);
  int ptype = int(mod(pane.x + 0.5, 8.0));
  float age = pane.w;
#if WALL < 3
  vec4 dA = dressA(st, wsz);
  // (the second layer only holds things that live at the edge of a pane, on an etched one, or along a snail's road)
  vec2 pe = paneEdge(WALL, pl, psz, prow);
  vec4 dB = vec4(0.0);
  if (min(pe.x, pe.y) < 0.03 || ptype == 5 || pane.x > 7.5) dB = dressB(st, wsz, px);
#else
  vec4 dA = vec4(0.35, 0.0, 0.0, 0.0), dB = vec4(0.0);
#endif

  // ------------------------------------------------------------------ condensation state
  vec4 n1 = texture2D(tNoise, st * vec2(0.23, 0.31));
  vec4 n2 = texture2D(tNoise, st * 3.1 + 0.37);
  vec4 n3 = texture2D(tNoise, st * 23.0);
  vec4 sim = vec4(0.95, 0.0, 1.0, 0.0);
  vec3 dir3 = vec3(0.0);
#if WALL < 3
  vec2 suv = st / wsz;
#if TIER > 0
  if (px < 0.002) sim = texBicubic(tSim, suv, uSimSize); else sim = texture2D(tSim, suv);
#else
  sim = texture2D(tSim, suv);
#endif
  dir3 = texture2D(tDir, suv).xyz;
#else
  sim.r = 0.74 + 0.26 * n1.r;
#endif
  vec2 dir2 = dir3.xy;
  float fogS = sim.r, water = sim.g, age2 = sim.b;
  float clearK = 0.0;
#if WALL == 2
  {
    // the end pane lets go of its fog from the centre as the walk ends — a pure function of progress
    vec2 c = (st - vec2(END_W * 0.5, WALL_H * 0.52)) / vec2(END_W * 0.5, WALL_H * 0.5);
    float rr = length(c * vec2(1.0, 0.86)) + (n1.g - 0.5) * 0.5 + (n2.g - 0.5) * 0.16;
    clearK = smoothstep(uClear * 2.3, uClear * 2.3 - 0.55, rr) * step(0.0005, uClear);
    fogS *= 1.0 - clearK;
  }
#endif
  float grain = n2.g * 0.6 + n3.g * 0.4;
  // (every pane fogs in its own way: fluted and new glass carry a thinner, evener film)
  float f = smoothstep(grain * 0.34, grain * 0.34 + 0.66, fogS) * pane.z;

  // old runs: where drops went down an hour ago the fog is still thinner, in fine vertical tracks
  // (on reeded glass they keep to the valleys between the flutes)
  float runs = 0.0;
#if WALL < 3
  if (ptype != 7) {
    float lw = ptype == 1 ? max(pane.y, 0.02) : 0.021;
    float xw = st.x + (ptype == 1 ? 0.0 : (texture2D(tNoise, vec2(st.x * 0.9, st.y * 1.7)).r - 0.5) * 0.012);
    float lane = xw / lw + (ptype == 1 ? 0.5 : 0.0);
    float id = floor(lane);
    vec3 hr = hash32(vec2(id, floor(st.x) + 17.0));
    float cx = ptype == 1 ? abs(fract(lane) - 0.5) : abs(fract(lane) - 0.2 - 0.6 * hr.x);
    float wdt = mix(0.035, 0.11, hr.z) * 0.021 / lw;
    float top = mix(0.25, 1.0, hr.y) * WALL_H;
    runs = step(0.78, hr.z + hr.x * 0.3) * smoothstep(wdt + px / lw, wdt * 0.4, cx) * smoothstep(top, top - 0.08, st.y) * smoothstep(0.0, 0.5, top - st.y + 0.3);
    runs *= 0.55 + 0.45 * n2.r;
    f *= 1.0 - 0.6 * runs * (1.0 - clearK);
  }
#endif

  // streaks left by the stroke: fine lines along the direction the wing moved
  float dl = length(dir2);
  float film = clamp(water * 2.2, 0.0, 1.0) * smoothstep(0.02, 0.2, dl);
  float smear = 0.0;
  if (film > 0.004) {
    float ang = atan(dir2.y, dir2.x) * 0.5;
    vec2 sd = vec2(cos(ang), sin(ang));
    vec2 sp = vec2(dot(st, vec2(-sd.y, sd.x)), dot(st, sd));
    float streak = texture2D(tNoise, sp * vec2(7.0, 0.3)).g * 0.7 + texture2D(tNoise, sp * vec2(29.0, 0.7) + 0.31).g * 0.3;
    // (broken along their length, or they read as engraved lines)
    smear = film * (1.0 - f) * smoothstep(0.3, 0.8, streak) * smoothstep(0.3, 0.62, n2.r + n3.g * 0.25);
    f = max(f, smear * 0.2);
  }

  // ------------------------------------------------------------------ beads
  // water gathers: mature fog carries a few fat beads, a fresh film breaks into many small ones
  vec4 lens = vec4(0.0);     // xy local, z coverage, w radius (m)
#if WALL < 3
  if (closeUp) {
    float lowBias = smoothstep(0.9, 0.0, fract(st.y / WALL_H));
    {
      float cell = 0.0105;
      vec2 cc = (floor(st / cell) + 0.5) * cell / wsz;
      vec4 sc = texture2D(tSim, cc);
      float dens = sc.r * sc.b * (0.10 + 0.28 * n1.r + 0.18 * lowBias) + clamp(sc.g * 1.6, 0.0, 1.0) * 0.5;
      vec3 hh = hash32(floor(st / cell) + 3.7);
      float grow = smoothstep(hh.z, hh.z + 0.22, dens) * (1.0 - clearK * 0.6);
      vec4 b = beadLayer(st, cell, grow, 0.0, px, 0.1, 0.4);
      if (b.z > lens.z) lens = b;
    }
    if (px < 0.0009 && TIER > 0) {
      float cell = 0.0037;
      vec2 cc = (floor(st / cell) + 0.5) * cell / wsz;
      vec4 sc = texture2D(tSim, cc);
      float dens = sc.r * sc.b * (0.16 + 0.3 * n2.r) + clamp(sc.g * 2.2, 0.0, 1.0) * 0.75;
      vec3 hh = hash32(floor(st / cell) + 11.1);
      float grow = smoothstep(hh.z, hh.z + 0.25, dens);
      vec4 b = beadLayer(st, cell, grow, 19.0, px, 0.12, 0.42);
      if (b.z > lens.z) lens = b;
    }
  }
#endif
  float bead = lens.z;
  f *= 1.0 - bead;

  // ------------------------------------------------------------------ the glass itself bends the ray
  Body body = glassBody(ptype, pane.y, st, px, n1, n2);
  float crackD = 1.0, crackL = 0.0;
#if WALL < 2
  if (ptype == 6) {
    crackD = crackDist(st, tNoise);
    crackL = smoothstep(px * 0.9 + 0.00025, px * 0.15, crackD) * clamp(0.0008 / px, 0.12, 1.0);
    // the two lips of a fracture never sit flush: the picture breaks across it
    body.slope += vec2(0.2, 0.1) * smoothstep(0.006, 0.0, crackD) * (0.4 + 0.6 * n2.r);
  }
#endif
  float dz = max(dot(-toCam, uViewDir), 0.05);
  vec2 pxuv = 1.0 / uRes;
  // refraction: water film and frost grain bend the ray a little
  vec2 wob = (vec2(n3.r, n3.a) - 0.5) * (film * (1.0 - f) * 5.0 + f * 1.2) * sH;
  vec2 uv0 = fragUV + wob * pxuv;
  vec2 shK = toPx * body.slope * (0.5 * dist);          // px of shift for a point infinitely far behind (q = 1)
  // the shift grows with the distance behind the pane, which is only known once we have looked: look, shift, look again.
  // A leaf on the glass is not moved at all; nearer things win.
  vec4 g0 = texture2D(tGarden, min(uv0 * uGS.xy, uGS.zw));
  if (dot(shK, shK) * g0.a * g0.a > 0.4) {
    float q0 = g0.a;
    vec2 uvs = uv0 + shK * q0 * pxuv;
    g0 = texture2D(tGarden, min(uvs * uGS.xy, uGS.zw));
    if (g0.a < q0 - 0.03) {
      uvs = uv0 + shK * g0.a * pxuv;
      g0 = texture2D(tGarden, min(uvs * uGS.xy, uGS.zw));
    }
    uv0 = uvs;
  }
  g0.rgb = min(g0.rgb, vec3(40.0));
  // contact: where a leaf lies on the pane there is no room for blur, and the glass under it stays clearer
  float dBehind = dist * g0.a / max(1.0 - g0.a, 1e-3);
  float contact = 1.0 - smoothstep(0.003, 0.02, dBehind);
  f *= 1.0 - 0.86 * contact;
  // sandblasting is frost that no wing can clear
  float etchF = 0.0;
#if WALL < 2
  if (ptype == 5) {
    etchF = smoothstep(-px * 0.75 - 0.0004, px * 0.75 + 0.0004, (dB.a - 0.5) * 0.02) * (0.86 + 0.14 * n3.g);
    f = max(f, etchF * 0.78);
  }
#endif

  // the fog itself, up close: a skin of droplets too small to name
  float macro = smoothstep(0.00035, 0.00008, px);
  float cellN = macro > 0.0 ? texture2D(tNoise, st * 9.0).a : 0.5;
  float micro = mix(1.0, smoothstep(0.05, 0.5, cellN) * 0.4 + 0.68, macro * smoothstep(0.00004, 0.00012, px));
  float fVeil = f * mix(micro, 1.0, etchF);

  float b = f * (0.35 + 0.65 * f);
  // blur per unit of q: the fog's scattering cone, plus what the relief of the glass squeezes into each pixel
  float kq = b * uK + dist * (0.55 * body.curv + 0.5 * body.smear / max(px, 1e-5)) + uCamK;
  float nearCov = pyrAllAt(4, uv0).a;
  float minR = mix(1.15, 0.7, contact);
  float qN = uR / uK;                                   // q at the near/mid boundary
  float Rg = clamp(kq * qN * 1.2, minR, uR);
  vec3 nearSum = vec3(0.0), otherSum = vec3(0.0);
  float nearW = 0.0, otherW = 0.0;
  {
    float coc0 = max(kq * g0.a, minR);
    float n0 = 1.0 - smoothstep(0.7 * uR, 1.15 * uR, uK * g0.a);
    float wc = 0.6;
    nearSum += g0.rgb * n0 * wc; nearW += n0 * wc; otherSum += g0.rgb * (1.0 - n0) * wc; otherW += (1.0 - n0) * wc;
#if WALL < 3
    if (nearCov > 0.002 || Rg < 3.0) {
      int taps = Rg < 3.0 ? 5 : GATHER_TAPS;
      float rot = ign(gl_FragCoord.xy) * 6.2831853;
      for (int i = 0; i < GATHER_TAPS; i++) {
        if (i >= taps) break;
        float t = (float(i) + 0.75) / float(taps);
        float r = t * Rg;
        float a = rot + float(i) * 2.39996323;
        vec2 o = vec2(cos(a), sin(a)) * r;
        vec4 s = texture2D(tGarden, min((uv0 + o * pxuv) * uGS.xy, uGS.zw));
        s.rgb = min(s.rgb, vec3(40.0));
        float coc = max(kq * s.a, minR);
        if (s.a > g0.a) coc = min(coc, coc0 * 1.25);
        float w = smoothstep(r - 1.0, r + 1.0, coc) * (0.25 + t * 1.5);   // density ∝ 1/r → weight ∝ r
        float n = 1.0 - smoothstep(0.7 * uR, 1.15 * uR, uK * s.a);
        nearSum += s.rgb * n * w; nearW += n * w;
        otherSum += s.rgb * (1.0 - n) * w; otherW += (1.0 - n) * w;
      }
    }
#endif
  }
  float nearA = nearW / max(nearW + otherW, 1e-5);
  vec3 nearC = nearSum / max(nearW, 1e-5);
  vec3 sharpOther = otherSum / max(otherW, 1e-5);

  float qM = 2.2 * qN, qF = 0.55;
  float blurM = kq * qM;
  float blurF = kq * qF;
  vec3 behind = sharpOther;
  float midA = 0.0;
  if (blurF >= 1.0 || otherW < 1e-4) {
    // (clear glass needs none of this: the sharp samples already in hand are the answer)
    float lvM = log2(max(blurM, 0.01)) - 0.2;
    float lvF = log2(max(blurF, 0.01)) - 0.2;
    vec2 jit = (vec2(n3.g, n3.b) - 0.5) * pxuv;
    vec4 farS = pyrFar(lvF, uv0 + jit * exp2(clamp(lvF, 2.0, 8.0)) * 0.6);
    vec4 midS = pyrMid(lvM, uv0 + jit * exp2(clamp(lvM, 2.0, 8.0)) * 0.6);
    vec3 farC = farS.rgb / max(farS.a, 1e-4);
    vec3 midC = midS.rgb / max(midS.a, 1e-4);
    midA = clamp(midS.a / max(midS.a + farS.a, 1e-4), 0.0, 1.0);
    if (farS.a < 1e-3) farC = midC;
    // barely blurred (thin fog, no defocus): lean on the sharp samples (the pyramid starts at a 4 px blur)
    vec3 farU = mix(sharpOther, farC, clamp(lvF * 0.6, 0.0, 1.0));
    vec3 midU = mix(sharpOther, midC, clamp(lvM * 0.6, 0.0, 1.0));
    if (otherW < 1e-4) { farU = farC; midU = midC; }
    behind = mix(farU, midU, midA);
  }
  vec3 through = nearC * nearA + behind * (1.0 - nearA);
#if WALL != 1
  // shafts of low sun in the air of the garden (nothing of them in front of a leaf that touches the glass)
  // (two taps a low-resolution texel apart: the march is jittered, and this is what smooths the jitter away)
  vec2 ao = pxuv * 2.6;
  through += SUN_COL * 0.5 * (texture2D(tAir, fragUV + ao).a + texture2D(tAir, fragUV - ao).a) * (1.0 - contact) * (1.0 - 0.7 * nearA);
#endif

  // ------------------------------------------------------------------ the light that arrives at the pane from behind
  float vis = 1.0;
  float sunFacing = max(dot(-uNormal, SUN_DIR), 0.0);
#if WALL == 0 || WALL == 2
  vis = texture2D(tScreen, suv).r;
#elif WALL == 3
  if (sunFacing > 0.0) vis = shadow1(vWorld - uNormal * 0.006);
#endif
  vec4 wide = pyrAllAt(6, uv0);                       // everything behind, widely averaged (rgb), and how much of it stands near (a)
  float open = (1.0 - 0.88 * nearA) * (1.0 - 0.4 * midA * (1.0 - nearA)) * (1.0 - 0.45 * smoothstep(0.0, 0.8, wide.a));
  vec3 sunOut = vec3(0.0);
  float cosVL = max(dot(-V, SUN_DIR), 0.0);
  if (sunFacing > 0.0) {
    float c2 = cosVL * cosVL;
    float phase = 0.10 + 0.2 * c2 + 0.5 * c2 * c2 * c2 * c2;
    sunOut = SUN_COL * vis * (0.35 + 0.65 * sunFacing) * phase * uSunGain;
  }
#if WALL == 1
  // the shade wall: what is left of the beam after the far garden, the far glass and the width of the corridor is
  // a soft warm dapple, not a picture (kept in a small texture: see ShadeScreen)
  float dapple = texture2D(tScreen, suv).r;
  // (art direction: brightest around the one place the path stops to look at it)
  vec2 dsp = (st - vec2(3.6, 0.96)) / vec2(0.9, 0.7);
  sunOut = SUN_COL * dapple * max(dot(uNormal, SUN_DIR), 0.0) * uSunGain * (1.0 + 3.2 * exp(-dot(dsp, dsp)));
  // …and in it, the shadow of whoever is flying here: it takes the sun, and a share of everything else with it, so
  // that it reads as a shadow on a white screen and not as a patch of the wall's own blue
  float own = 1.0 - bfShadow(vWorld);
  sunOut *= 1.0 - own * 0.94;
#elif WALL == 3
  else {
    float sunFront = max(dot(uNormal, SUN_DIR), 0.0);
    if (sunFront > 0.0) sunOut = SUN_COL * shadow1(vWorld + uNormal * 0.02 + (vec3(n3.r, n3.g, n3.a) - 0.5) * 0.1) * 0.3 * sunFront * uSunGain;
  }
#endif
  // more sky reaches the top of a pane than its foot, where the planting is thickest
  float hgt = clamp(vWorld.y / EAVE, 0.0, 1.3);
  vec3 amb = uAmb * (0.82 + 0.36 * n1.g) * mix(0.42, 1.12, smoothstep(0.08, 0.85, hgt));
  if (ptype == 1) {
    // A flute is a lens in front of the frost: it gathers the light behind it into a line on the inner face. The sky
    // makes a soft bright core down the middle of every flute; the sun, a hot line that sits where its angle puts it.
    float res = smoothstep(2.0, 4.5, pane.y / px);
    float u = body.uu;
    float us = clamp(dot(SUN_DIR, uTanS) / max(-dot(SUN_DIR, uNormal), 0.2) * 0.55, -0.7, 0.7);
    float du = (u - us) / 0.3;
    amb *= mix(1.0, 0.62 + 0.76 * (1.0 - u * u) * (1.0 - 0.35 * u * u), res);
    sunOut *= mix(1.0, 0.25 + 2.0 * exp(-du * du), res);
  }
  vec3 glow = (amb + wide.rgb * 0.22) * open + sunOut;  // (+ the pane's own multiple scattering)
#if WALL == 1
  glow *= 1.0 - 0.34 * own * smoothstep(0.02, 0.2, dapple);
#endif

  // ------------------------------------------------------------------ the outside face: algae, dirt, a snail's road
  float dirt = dA.r * (0.6 + 0.4 * n2.g);
  float algae = dA.g * smoothstep(0.12, 0.5, dA.g + (n3.g - 0.5) * 0.5);
  through = mix(through, (glow * 1.6 + through * 0.5) * mix(vec3(0.07, 0.2, 0.03), vec3(0.2, 0.36, 0.05), n3.a), algae * 0.82);
#if WALL < 3
  float snailD = (1.0 - dB.r) * 0.02;
  if (dB.r > 0.5 && px < 0.004) {
    // dried slime: two bright edges and a dull broken sheen between them
    float edge = smoothstep(0.0012 + px, 0.0, abs(snailD - 0.0036));
    float bodyS = smoothstep(0.0036, 0.002, snailD) * (0.25 + 0.75 * smoothstep(0.35, 0.75, texture2D(tNoise, st * vec2(41.0, 57.0)).g));
    float sl = (edge * 0.3 + bodyS * 0.2) * smoothstep(0.004, 0.0015, px);
    through += (glow * 0.9 + SUN_COL * vis * sunFacing * 0.5 * smoothstep(0.55, 0.9, n3.b)) * sl;
  }
#endif
  // ------------------------------------------------------------------ inside the glass: its colour, its wire, its flutes
  through *= mix(vec3(1.0), vec3(0.88, 0.98, 0.9), 0.8 * age);                    // old glass is green in section
  if (body.wire > 0.0) through = mix(through, glow * vec3(0.05, 0.045, 0.04) + SUN_COL * vis * sunFacing * 0.012, body.wire * 0.92);
  if (body.rib > 0.0) {
    // the cusp between two flutes: a dark seam, then everything the neighbouring cylinder gathers
    through = through * (1.0 - 0.5 * body.rib) + (wide.rgb * 0.75 + sunOut * 1.4) * body.rib * 0.55;
  }
  float sunLine = 0.0;
#if WALL == 0 || WALL == 2
  if (ptype == 1 && vis > 0.003) {
    // each flute holds one image of the sun: a hot vertical line where its slope turns the ray toward it. Flutes do
    // nothing vertically, so the lines only light up in the band of the pane that stands at the sun's own height.
    vec3 E = -V;
    float a = dot(E, uTanS) / max(-dot(E, uNormal), 0.05), a2 = dot(SUN_DIR, uTanS) / max(-dot(SUN_DIR, uNormal), 0.05);
    float e1 = E.y / max(-dot(E, uNormal), 0.05), e2 = SUN_DIR.y / max(-dot(SUN_DIR, uNormal), 0.05);
    float need = (a2 - a) * 1.25;
    float ds = (body.slope.x - need) / 0.07;
    float dv = (e2 - e1) / 0.3;
    sunLine = exp(-ds * ds) * exp(-dv * dv) * vis * step(0.5, smoothstep(2.0, 4.5, pane.y / px));
    through += SUN_COL * sunLine * 2.2 * (1.0 - 0.8 * f);
  }
#endif

  // ------------------------------------------------------------------ frost: a screen that light falls on
  // The fog is lit from behind. What reaches it is the sky and the bright air of the garden (uAmb) — less of it where
  // something stands close to the pane: sharply where a leaf touches, softly where it only leans near — and the sun.
  // Lime, dust and the film of dirt outside scatter the same light; no wing clears those.
  float dep = dA.b * (0.55 + 0.45 * n3.g);
  float veil = 1.0 - (1.0 - fVeil) * (1.0 - 0.5 * dep) * (1.0 - 0.2 * dirt);
  vec3 col = through * (1.0 - 0.25 * fVeil) * (1.0 - 0.3 * dep) * (1.0 - 0.16 * dirt) + glow * veil * mix(vec3(1.0), vec3(1.08, 1.04, 0.96), dep);
  col += glow * dep * 0.4;                              // (chalk is whiter than water: a tide-mark shows even through the fog)
  // a leaf lying on the glass is wet where it touches: darker, deeper
  col = mix(col, col * vec3(0.8, 0.92, 0.72), contact * 0.5);
  // sparkle of the droplet skin against the sun, only when the lens is close enough to resolve it
  col += SUN_COL * vis * sunFacing * macro * f * smoothstep(0.16, 0.02, cellN) * 0.2 * smoothstep(0.00004, 0.00012, px);
#if WALL < 3
  // scales: where a wing has beaten against the pane it leaves dust that takes the light
  if (dir3.z > 0.01 && px < 0.003) {
    float sc = texture2D(tNoise, st * 61.0 + 0.13).b;
    float tw = smoothstep(1.0 - 0.3 * dir3.z, 1.0, sc) * smoothstep(0.003, 0.0012, px);
    col += (glow * 3.0 + SUN_COL * vis * sunFacing * 1.4 + uGlow[WALL == 1 ? 0 : 1] * 0.8) * tw * (0.5 + 0.5 * n3.r);
    col *= 1.0 - 0.1 * dir3.z * smoothstep(0.3, 0.7, n3.g);
  }
#endif

  // ------------------------------------------------------------------ beads: tiny wide-angle lenses
  if (bead > 0.001) {
    vec2 d = lens.xy;
    vec2 offPx = toPx * (d * lens.w);
    vec2 cuv = fragUV - offPx * pxuv;
    vec3 lc = lensColor(d, min(length(d), 1.0), cuv, lens.w / max(px, 1e-7), uNormal, uTanS, vis);
    col = mix(col, lc, bead);
  }

  // ------------------------------------------------------------------ the inner surface: what the corridor sees of itself
  vec3 Nn = normalize(uNormal - (uTanS * body.slope.x + vec3(0.0, 1.0, 0.0) * body.slope.y) * 0.9 + vec3(n3.r - 0.5, n3.g - 0.5, n3.a - 0.5) * 0.05 * f);
  vec3 Rd = reflect(-V, Nn);
  Rd -= uNormal * min(dot(Rd, uNormal) - 0.02, 0.0);     // (a flute can throw the mirror ray back into the glass: keep it in the room)
  int ri; float rt = hullExit(vWorld + uNormal * 0.002, Rd, 7, ri);
  vec3 rp = vWorld + Rd * rt;
  vec3 env = uGlow[ri] * (ri < 5 ? 0.25 + 0.75 * frameOpen(ri, rp, 0.02 + 0.1 * f) : 1.0);
  // (the mirror is capped: a wiped streak seen at a glancing angle must still be a window, not a flat reflection)
  float fres = min(0.04 + 0.96 * pow(1.0 - abs(dot(Nn, V)), 5.0), 0.3);
  col = mix(col, env, fres * (1.0 - 0.55 * f));
  if (ptype == 1) {
    // and each flute carries one thin bright line: the roof, rolled up in a cylinder. It slides as the eye moves.
    float res = smoothstep(2.5, 6.0, pane.y / px);
    float uh = clamp(dot(V, uTanS) * 0.95, -0.82, 0.82);
    float dh = (body.uu - uh) / (0.05 + 1.2 * px / pane.y);
    col += (uGlow[3] + uGlow[4]) * (0.22 * exp(-dh * dh) * res * (1.0 - 0.5 * f));
  }

  // ------------------------------------------------------------------ what has run down it, and what holds it in
  col *= mix(vec3(1.0), vec3(0.5, 0.43, 0.3), dA.a * 0.62);
#if WALL < 2
  {
    // grime where panes meet steel: old glass is never clean at its edges
    float edge = min(pe.x, pe.y - 0.0);
    float grime = smoothstep(0.09, 0.0, edge - n1.g * 0.05 - n2.g * 0.02) * (0.45 + 0.55 * smoothstep(0.5, 0.0, st.y));
    col *= mix(vec3(1.0), vec3(0.42, 0.5, 0.36), grime * 0.75 * (0.15 + 0.85 * age));
  }
#endif
#if WALL < 3 && TIER > 1
  if (sunFacing > 0.0 && vis > 0.02 && px < 0.0022) {
    // hairline scratches: invisible until the sun rakes across them, and then only the ones that lie square to it —
    // so they close into broken rings around the place where the sun stands behind the pane
    vec3 sp = cameraPosition + SUN_DIR * (dot(vWorld - cameraPosition, uNormal) / min(dot(SUN_DIR, uNormal), -0.05));
    vec2 rel = vec2(dot(vWorld - sp, uTanS), vWorld.y - sp.y);
    col += SUN_COL * vis * scratchFlare(rel, st, px, n1.r) * (0.25 + 0.75 * age) * (1.0 - 0.7 * f) * smoothstep(0.00012, 0.0005, px);
  }
#endif
#if WALL < 2
  if (ptype == 6) {
    // the fracture: a bright lip where it faces the light, a dark one where it does not
    col = mix(col, col * 0.3 + (glow * 1.6 + sunOut * 4.0 * smoothstep(0.55, 0.8, n2.r) + env * 0.5) * (0.2 + 0.8 * n2.g), crackL * 0.85);
    // and the tape that has held it since: yellowed, lifting at the edges, glowing where the sun is behind it
    for (int i = 0; i < 2; i++) {
      vec3 tp = tapeSD(st, uTape[i], 0.024);
      float ta = smoothstep(px * 0.7, -px * 0.7, tp.z + (n3.g - 0.5) * 0.0016);
      if (ta > 0.0) {
        float wr = texture2D(tNoise, vec2(tp.y * 0.9 + float(i) * 0.3, tp.x * 0.07)).g;
        float weave = 0.9 + 0.1 * sin(tp.x * 60.0) * sin(tp.y * 420.0);
        vec3 tc = (glow * 1.5 + col * 0.35) * vec3(0.95, 0.66, 0.27) * weave * (0.7 + 0.5 * wr);
        tc *= 1.0 - 0.45 * smoothstep(0.75, 1.0, abs(tp.x)) - 0.3 * smoothstep(0.035, 0.0, min(tp.y, 1.0 - tp.y));   // dirt along the edges
        tc += env * 0.12 * smoothstep(0.55, 0.8, wr);
        col = mix(col, tc, ta * 0.9);
        f = max(f, ta);
      }
    }
  }
#endif
#if WALL < 3
  {
    // putty: a bead of linseed and chalk along every bar, cracked, with pieces gone
    float pd = (dB.g - 0.5) * 0.03;
    float pm = smoothstep(-px, px, pd) * step(0.02, age);
    if (pm > 0.0) {
      vec3 pc = mix(vec3(0.34, 0.33, 0.27), vec3(0.16, 0.17, 0.12), n2.g) * (0.55 + 0.6 * n3.g);
      pc = mix(pc, vec3(0.05, 0.1, 0.035), smoothstep(0.3, 0.8, dA.g + n2.r * 0.3) * 0.6);                           // green where it stays damp
      vec3 light = uGlow[WALL == 0 ? 1 : 0] * 0.55 + (uGlow[3] + uGlow[4]) * 0.2 + uGlow[5] * 0.5 + glow * 0.25;
      col = mix(col, pc * light * (0.5 + 0.5 * smoothstep(0.0, 0.006, pd)), pm);
      f = max(f, pm);
    }
  }
#endif
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  // where the pane is clear the lens sees THROUGH it: hand the depth of the garden to the depth of field
  float clearness = (1.0 - f) * (1.0 - f) * (1.0 - bead) * (1.0 - smear) * (1.0 - contact) * (1.0 - veil);
  // (not all of it: a lens focused on the pane would turn everything behind a wiped streak to mush, and the point of
  // wiping is to see. Only the end wall, when it lets go, hands over the true depth of the garden.)
  float zTrue = dz / max(1.0 - g0.a, 0.03);
  float zSeen = min(zTrue, dz * 1.16 + 0.02);
#if WALL == 2
  zSeen = mix(zSeen, zTrue, clearK);
#endif
  float zv = mix(dz, zSeen, clearness);
  gl_FragDepth = clamp((1.0 / uNearFar.x - 1.0 / zv) / (1.0 / uNearFar.x - 1.0 / uNearFar.y), 0.0, 1.0);
}`;

export function makeGlassMaterial({ wall, normal, tanS, shared, taps, amb, sunGain, tier = 2 }) {
  return new THREE.ShaderMaterial({
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    defines: { GATHER_TAPS: taps, WALL: wall, TIER: tier },
    uniforms: {
      ...shared,
      ...paneUniforms(Math.min(wall, 2)),
      tDress: { value: null },
      tAir: { value: null },
      uDressTexel: { value: 0.004 },
      uAmb: { value: amb },
      uSunGain: { value: sunGain },
      uNormal: { value: normal },
      uTanS: { value: tanS },
      tSim: { value: null },
      tDir: { value: null },
      tScreen: { value: null },
      uSimSize: { value: new THREE.Vector2(1, 1) },
    },
  });
}

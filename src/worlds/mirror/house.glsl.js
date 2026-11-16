// Mirror — the glasshouse of world 01, as one function of a ray.
//
// `houseEnv(ro, rd, blur, direct)` returns the light arriving along a ray from the corridor: fogged panes with the sun
// and the garden behind them, the steel frame (the mullions of the two long walls are real boxes, so they stack up in
// perspective when the ray grazes a wall), the pitched roof with its rafters, the end pane, the wet stone floor. `blur`
// is the angular footprint of the ray in radians: every edge is pre-filtered by it, so the same function draws the room
// behind the subject out of focus, and the room bent small in a chrome surface without a single aliased bar.
//
// Dimensions are world 01's (../conservatory/layout.js). The light is this world's own: uGlow[] holds what each wall
// gives off at this time of day (index.js moves it from before dawn to the low sun world 01 opens in).

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { HW, Y0, EAVE, RIDGE, ZE, ZBACK, TRANSOM, HULL, SUN_DIR } from '../conservatory/layout.js';
import { BAR_Y, LIP, LEG, FLANGE_X } from './story.js';

const f = (x) => {
  const s = Number(x).toFixed(5);
  return s.includes('.') ? s : `${s}.0`;
};

/** The uniforms every material of the set shares. */
export function houseUniforms() {
  return {
    uGlow: { value: Array.from({ length: 7 }, () => new THREE.Vector3()) },
    uSun: { value: new THREE.Vector4(0, 0, 0, 0) }, // rgb: the sun as the fog hands it on; a: how green the garden is
    uHaze: { value: new THREE.Vector4(0.26, 0.22, 0.12, 0.024) },
    uDawn: { value: new THREE.Vector4(0, 0, 0, 1) }, // rgb: a low warm band on the horizon before the sun is up; a: how much of this world's own morning is on the glass (0 = the panes exactly as world 01 opens on them)
    uMoon: { value: new THREE.Vector4(0, 0, 0, 0) }, // rgb: the moon through the fogged roof, before dawn; a: how much night is left
    tHN: { value: null },
    uHTime: { value: 0 },
  };
}

export const houseGLSL = /* glsl */ `
#ifndef MR_HOUSE
#define MR_HOUSE
${hash}
uniform vec3 uGlow[7];
uniform vec4 uSun;
uniform vec4 uHaze;
uniform vec4 uDawn;
uniform vec4 uMoon;
uniform sampler2D tHN;
uniform float uHTime;
#define H_HW ${f(HW)}
#define H_X1 ${f(-FLANGE_X)}
#define H_Y0 ${f(Y0)}
#define H_EAVE ${f(EAVE)}
#define H_RIDGE ${f(RIDGE)}
#define H_ZE ${f(ZE)}
#define H_ZBACK ${f(ZBACK)}
#define H_TRANSOM ${f(TRANSOM)}
const vec3 H_SUN = vec3(${f(SUN_DIR.x)}, ${f(SUN_DIR.y)}, ${f(SUN_DIR.z)});
const vec3 H_MOON = vec3(0.50175, 0.62217, 0.60099);
const vec4 H_HULL[7] = vec4[7](
${HULL.map((p) => `  vec4(${p.map(f).join(', ')})`).join(',\n')}
);

// noise pre-filtered to a footprint of bw metres; sc = tiles per metre
vec4 hNz(vec2 q, float sc, float bw){ return textureLod(tHN, q * sc, log2(max(bw * sc * 256.0, 1.0))); }

float hExit(vec3 o, vec3 d, out int idx){
  float tmin = 1e9; idx = 5;
  for (int i = 0; i < 7; i++) {
    float dn = dot(H_HULL[i].xyz, d);
    if (dn > 1e-6) {
      float t = (H_HULL[i].w - dot(H_HULL[i].xyz, o)) / dn;
      if (t < tmin) { tmin = t; idx = i; }
    }
  }
  return max(tmin, 0.0);
}

// light arriving at a matte point from the glass all round it (the radiance of a white surface there)
vec3 hIrr(vec3 P, vec3 N){
  float endW = 0.35 * clamp(6.0 / max(P.z - H_ZE, 1.0), 0.0, 1.0);
  return uGlow[0] * (0.5 - 0.5 * N.x) + uGlow[1] * (0.5 + 0.5 * N.x)
       + (uGlow[3] + uGlow[4]) * 0.5 * (0.5 + 0.5 * N.y)
       + uGlow[2] * (0.5 - 0.5 * N.z) * endW
       + uGlow[5] * (0.5 - 0.5 * N.y);
}

// steel that lies in the plane of the glass: 1 = open glass. soft = edge softness in metres.
float hFrame(int idx, vec3 P, float soft){
  float m = 1.0;
  if (idx <= 1) {
    m *= smoothstep(0.022 - soft, 0.022 + soft, abs(P.y - H_TRANSOM));
    m *= smoothstep(H_Y0 + 0.035 - soft, H_Y0 + 0.035 + soft, P.y);
    m *= smoothstep(0.035 - soft, 0.035 + soft, abs(P.y - H_EAVE));
  } else if (idx == 2) {
    m *= smoothstep(0.07 - soft, 0.07 + soft, H_HW - abs(P.x));
    m *= smoothstep(H_Y0 + 0.035 - soft, H_Y0 + 0.035 + soft, P.y);
    m *= smoothstep(0.035 - soft, 0.035 + soft, abs(P.y - H_EAVE));
    m *= 1.0 - (1.0 - smoothstep(0.02 - soft, 0.02 + soft, abs(P.x))) * step(H_EAVE, P.y);
  } else if (idx <= 4) {
    float ds = abs(fract(P.z + 0.5) - 0.5);
    m *= smoothstep(0.024 - soft, 0.024 + soft, ds);
    m *= smoothstep(0.03 - soft, 0.03 + soft, abs(abs(P.x) - 0.58));
    m *= smoothstep(0.04 - soft, 0.04 + soft, abs(P.x));
    m *= smoothstep(0.035 - soft, 0.035 + soft, H_HW - abs(P.x));
  }
  return m;
}
// …and with the mullions flattened into it: for the cheap lookups (what a floor or a painted bar mirrors)
float hFrameFlat(int idx, vec3 P, float soft){
  float m = hFrame(idx, P, soft);
  if (idx <= 1) m *= smoothstep(0.026 - soft, 0.026 + soft, abs(fract(P.z + 0.5) - 0.5));
  return m;
}
vec3 hGlowAt(vec3 P, vec3 R, float soft){
  int ri;
  float rt = hExit(P, R, ri);
  vec3 c = uGlow[ri];
  if (ri < 5) c *= 0.16 + 0.84 * hFrameFlat(ri, P + R * rt, soft + rt * 0.02);
  return c;
}

vec3 hSteelAlb(){ return vec3(0.026, 0.05, 0.042); }

// A fogged pane from inside. st = metres along and up the wall.
vec3 hPane(int idx, vec3 P, vec3 rd, float w){
  vec2 st = idx == 2 ? vec2(P.x + 40.0, P.y) : (idx <= 1 ? vec2(-P.z + float(idx) * 17.0, P.y) : vec2(-P.z + 60.0, abs(P.x)));
  vec4 n1 = hNz(st, 0.19, w);
  float runs = hNz(vec2(st.x * 4.0, st.y * 0.3), 0.6, w * 4.0).g;
  // (close to, fog is never even: it lies in soft patches a hand wide)
  float fog = (0.8 + 0.32 * n1.r + 0.14 * (runs - 0.5)) * (1.0 + uDawn.a * (0.44 * hNz(st + 1.7, 5.0, w).g - 0.22));
  vec3 col = uGlow[idx] * fog;
  if (idx == 1) col += uGlow[0] * 0.1;                                    // the shade wall takes a little of the sunlit one
  if (idx <= 2) col *= 0.82 + 0.3 * smoothstep(0.2, 2.8, P.y);            // a fogged pane is brightest where it holds the most sky
  if (idx == 2) col *= vec3(0.56, 0.64, 0.61);                             // the end pane has the garden's own shade on it
  if (idx == 0 || idx == 2 || idx == 3) {
    // the sun, as fog scatters it on: a broad lobe about its direction and a hotter heart
    float c = max(dot(rd, H_SUN), 0.0);
    float c2 = c * c;
    col += uSun.rgb * (0.34 * c2 * c + 1.4 * c2 * c2 * c2 * c2 * c2 * c2 + 5.0 * pow(c, 60.0)) * fog * (idx == 3 ? 0.4 : 1.0);
  }
  if (idx == 1 || idx == 4 || idx == 3) {
    // the moon, the same way, while there is one
    float c = max(dot(rd, H_MOON), 0.0);
    float c2 = c * c;
    col += uMoon.rgb * (0.3 * c2 + 1.6 * c2 * c2 * c2 * c2 * c2 * c2) * fog * (idx == 1 ? 0.5 : 1.0);
  }
  if (idx <= 2) {
    // first light: a low warm band
    float low = exp(-(P.y - 0.25) * (P.y - 0.25) / 0.7);
    col += uDawn.rgb * low * (idx == 1 ? 0.12 : 1.0) * (0.75 + 0.5 * n1.g);
    // the garden: where a plant stands close behind the glass the fog goes green, and darker
    // (nothing behind fogged glass has an edge: what is seen of it is already a hand's width soft)
    float wg = max(w, 0.07);
    float dens = hNz(st + 3.7, 0.37, wg).g * 0.5 + hNz(st, 1.45, wg).r * 0.3 + hNz(st, 4.1, wg).g * 0.2 + 0.36 * (1.0 - smoothstep(0.1, 2.2, P.y));
    // (the stretch of the sunlit wall the chrysalis hangs on is clear of it, but for the one leaf)
    if (idx == 0) dens -= 0.3 * smoothstep(1.7, 1.0, abs(P.z + 1.6)) * smoothstep(0.9, 1.25, P.y);
    float m = smoothstep(0.54, 0.72, dens);
    float dy = uSun.a;
    vec3 leaf = col * mix(vec3(0.55), vec3(0.52, 0.64, 0.4), dy) + uGlow[idx] * dy * vec3(0.01, 0.05, 0.0);
    col = mix(col, leaf, m * (idx == 1 ? 0.6 : 0.7));
    if (idx == 2) {
      // the end pane, a long way off: a leaf against it low on the left, something climbing on the right
      vec2 e1 = (P.xy - vec2(-0.7, 0.9)) / vec2(0.17, 0.23);
      vec2 e2 = (P.xy - vec2(0.66 + 0.06 * sin(P.y * 5.0), 1.25)) / vec2(0.09, 0.85);
      float lf = 1.25 * exp(-dot(e1, e1)) + 0.8 * exp(-dot(e2, e2) * 1.2) * (0.6 + 0.6 * hNz(st, 2.3, wg).r);
      col = mix(col, col * vec3(0.3, 0.6, 0.16) + uGlow[2] * dy * vec3(0.02, 0.1, 0.0), clamp(lf, 0.0, 1.0) * 0.85);
    }
    if (idx == 0) {
      // one leaf lies against this pane, low beside where the chrysalis hangs: sharp where it touches, lit through
      vec2 lq = vec2(-P.z - 1.135, P.y - 1.455);
      lq = mat2(0.82, 0.57, -0.57, 0.82) * lq;
      float len = 0.15;
      float tt = clamp(lq.y / len + 0.5, 0.0, 1.0);
      float half_ = 0.05 * pow(sin(3.14159 * pow(tt, 0.72)), 0.8);
      float ld = max(abs(lq.x) - half_, abs(lq.y) - len * 0.5);
      float lm = smoothstep(w + 0.002, -w - 0.002, ld);
      float rib = smoothstep(0.0022 + w, 0.0006, abs(lq.x)) + 0.5 * smoothstep(0.0016 + w, 0.0004, abs(fract((lq.y + abs(lq.x) * 0.9) / 0.021) - 0.5) * 0.021);
      vec3 lc = col * mix(vec3(0.72), vec3(0.4, 0.62, 0.2), dy) * (1.0 - 0.3 * min(rib, 1.0)) + uSun.rgb * dy * vec3(0.02, 0.08, 0.0);
      col = mix(col, lc, lm * 0.85);
    }
    if (w < 0.008) {
      float nearK = 1.0 - smoothstep(0.003, 0.008, w);
      // what a clear patch of glass shows: the garden, darker than the fog — but toward the sun, the sun
      float sunny = idx == 0 ? smoothstep(0.1, 0.75, dot(rd, H_SUN)) * min(uSun.r * 2.0, 1.0) * uDawn.a : 0.0;
      vec3 through = col * mix(mix(vec3(0.6), vec3(0.34, 0.46, 0.25), dy), vec3(1.7, 1.55, 1.3), sunny);
      // water that has run: long clear lines, a little crooked
      float cx = st.x / 0.023;
      float ci = floor(cx);
      vec3 hr = hash31(ci + 13.0);
      float top = 1.2 + 1.6 * hr.y;
      float xr = (fract(cx) - 0.25 - 0.5 * hr.x) * 0.023 - 0.0016 * sin(st.y * 43.0 + hr.z * 20.0) - 0.0008 * sin(st.y * 131.0 + hr.x * 9.0);
      float runm = smoothstep(0.0011 + w, 0.0004, abs(xr)) * step(hr.z, 0.42) * smoothstep(top, top - 0.02, st.y) * (0.0011 / (0.0011 + w));
      col = mix(col, through, runm * 0.7 * nearK);
      // beads: each a small clear window in the fog, bright along its lower edge
      for (int L = 0; L < 2; L++) {
        float cs = L == 0 ? 0.0125 : 0.0052;
        vec2 q = st / cs + float(L) * 7.3;
        q.y += hash11(floor(q.x) + 3.0) * 7.0;            // (no two columns of them line up)
        vec2 id = floor(q);
        vec3 hh = hash32(id + 5.0);
        vec2 d = fract(q) - (0.28 + 0.44 * hh.xy);
        float rr = (0.1 + 0.2 * hh.z * hh.z) ;
        float ww = w / cs;
        float b = smoothstep(rr + ww * 1.5 + 0.02, rr - 0.02, length(d)) * step(hh.z, L == 0 ? 0.5 : 0.34) * (rr / (rr + ww * 2.0));
        vec3 bc = through * (0.8 + 0.9 * smoothstep(0.3, -0.9, d.y / rr)) + uGlow[idx] * 0.5 * smoothstep(0.55, 1.0, -d.y / rr);
        col = mix(col, bc, b * 0.85 * nearK);
      }
    }
  }
  return col;
}

vec3 hFloor(vec3 P, vec3 rd, float w){
  vec2 g = vec2(P.x / 0.575 + 2.0, P.z / 0.86);
  g.x += mod(floor(g.y), 2.0) * 0.5;
  vec2 fr = fract(g);
  vec2 e = min(fr, 1.0 - fr) * vec2(0.575, 0.86);
  float joint = smoothstep(0.012 + w, 0.003, min(e.x, e.y)) * (0.012 / (0.012 + w));
  vec4 n1 = hNz(P.xz, 0.13, w);
  vec4 n2 = hNz(P.xz, 1.1, w);
  vec3 stone = mix(vec3(0.02, 0.022, 0.023), vec3(0.055, 0.053, 0.048), n2.g) * (0.55 + 0.9 * hash12(floor(g) + 9.0));
  stone = mix(stone, vec3(0.014, 0.022, 0.012), joint * 0.8);
  vec3 col = stone * hIrr(P, vec3(0.0, 1.0, 0.0)) * 2.2;
  // wet stone: it mirrors the glass
  vec3 R = normalize(vec3(rd.x + (n2.r - 0.5) * 0.05, abs(rd.y) + 1e-3, rd.z + (n2.a - 0.5) * 0.05));
  vec3 refl = hGlowAt(P + vec3(0.0, 0.002, 0.0), R, 0.04 + w);
  float F = 0.025 + 0.975 * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 5.0);
  float puddle = smoothstep(0.42, 0.6, n1.r);
  return mix(col, refl, clamp(F * mix(0.5, 1.0, puddle) + 0.1 * puddle, 0.0, 1.0));
}

// The mullions of a long wall as boxes (H_HW - H_X1) deep and 52 mm wide, one every metre. Does the ray meet one
// before tMax? Returns (t, coverage 0..1). side = -1 the sunlit wall, +1 the shade wall.
vec2 hMullion(vec3 ro, vec3 rd, float side, float tMax, float blur, float skipNear, out vec3 n){
  n = vec3(-side, 0.0, 0.0);
  float xs = side * ro.x, dx = side * rd.x;
  float t0 = 0.0, t1 = tMax;
  if (xs < H_X1) {
    if (dx < 1e-6) return vec2(0.0);
    t0 = (H_X1 - xs) / dx;
  } else if (dx < -1e-6) t1 = min(t1, (H_X1 - xs) / dx);
  if (t0 >= t1) return vec2(0.0);
  const float h = 0.026;
  float z0 = ro.z + rd.z * t0, z1 = ro.z + rd.z * t1;
  float k = floor(z0 + 0.5);
  float w = max(blur * t1, 2e-4);
  float cov = 0.0, t = t0;
  bool skip = skipNear > 0.5 && side < 0.0;
  // through the plane of the flanges, onto the face of one
  if (t0 > 0.0 && !(skip && abs(k + 1.0) < 0.5)) cov = smoothstep(-w, w, h - abs(z0 - k));
  if (cov < 1.0 && abs(rd.z) > 1e-6) {
    // …or into the side of the next one along, before the ray is out of the depth of the frame
    float sg = rd.z < 0.0 ? -1.0 : 1.0;
    float kb = sg < 0.0 ? (z0 > k + h ? k : k - 1.0) : (z0 < k - h ? k : k + 1.0);
    float zb = kb - sg * h;
    float c2 = smoothstep(-w, w, (z1 - zb) * sg);
    if (skip && abs(kb + 1.0) < 0.5) c2 = 0.0;
    if (c2 > cov) { cov = c2; t = t0 + max((zb - z0) / rd.z, 0.0); n = vec3(0.0, 0.0, -sg); }
  }
  return vec2(t, cov);
}

// the angle bar the chrysalis hangs from, for what the chrysalis shows of it: its lip and its leg as two slabs
float hBox2(vec2 o, vec2 d, vec2 lo, vec2 hi){
  vec2 inv = 1.0 / (abs(d) + 1e-7) * sign(d + 1e-9);
  vec2 a = (lo - o) * inv, b = (hi - o) * inv;
  vec2 tn = min(a, b), tf = max(a, b);
  float t0 = max(tn.x, tn.y), t1 = min(tf.x, tf.y);
  return t1 > max(t0, 0.0) ? max(t0, 0.0) : -1.0;
}

// blur: angular footprint (radians). direct: 1 = seen by the lens itself (the near mullion and the bar are real
// geometry then, and are left out here), 0 = seen in a mirror.
vec3 houseEnv(vec3 ro, vec3 rd, float blur, float direct){
  blur = clamp(blur, 0.0, 0.6);
  int idx;
  float t = hExit(ro, rd, idx);
  vec3 P = ro + rd * t;
  float w = max(blur * t, 5e-4);
  vec3 col;
  if (idx <= 4) {
    col = hPane(idx, P, rd, w);
    float open = hFrame(idx, P, w);
    vec3 nn = -H_HULL[idx].xyz;
    col = mix(hSteelAlb() * hIrr(P, nn) * 0.8, col, open);
  } else if (idx == 5) {
    col = hFloor(P, rd, w);
  } else {
    // the wall behind: brick, a door, nothing that gives light
    col = uGlow[6] * (0.7 + 0.6 * hNz(P.xy, 0.3, w).r);
  }
  float dist = t;
  // the frame of the long walls
  vec3 n0, n1;
  vec2 mL = hMullion(ro, rd, -1.0, t, blur, direct, n0);
  vec2 mR = hMullion(ro, rd, 1.0, t, blur, 0.0, n1);
  if (mR.y > mL.y) { mL = mR; n0 = n1; }
  if (mL.y > 0.0) {
    vec3 Pm = ro + rd * mL.x;
    float inY = smoothstep(H_EAVE + w, H_EAVE - w, Pm.y);
    // (the side of a mullion is its shade side: it stands square to the glass, and the glass beside it lights the room, not it)
    vec3 st = hSteelAlb() * (0.5 + 0.4 * hNz(Pm.zy + Pm.x, 2.3, w).g) * hIrr(Pm, n0) * (1.0 - 0.45 * abs(n0.z));
    // paint is glossy: seen along its face it gives back the far glass
    float fres = pow(1.0 - clamp(-dot(rd, n0), 0.0, 1.0), 5.0);
    st += hGlowAt(Pm + n0 * 0.002, reflect(rd, n0), 0.08) * fres * 0.4;
    col = mix(col, st, mL.y * inY);
    dist = mix(dist, mL.x, mL.y * inY);
  }
  if (direct < 0.5) {
    float tl = hBox2(ro.xy, rd.xy, vec2(${f(LIP.x0)}, ${f(BAR_Y)}), vec2(${f(LIP.x1)}, ${f(BAR_Y + LIP.t)}));
    float tg = hBox2(ro.xy, rd.xy, vec2(${f(LEG.x0)}, ${f(BAR_Y)}), vec2(${f(LEG.x1)}, ${f(BAR_Y + LEG.h)}));
    float tb = tl < 0.0 ? tg : (tg < 0.0 ? tl : min(tl, tg));
    if (tb >= 0.0 && tb < dist) {
      vec3 Pb = ro + rd * tb;
      vec3 nb = abs(Pb.y - ${f(BAR_Y)}) < 1e-4 ? vec3(0.0, -1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      col = hSteelAlb() * hIrr(Pb, nb) * (0.7 + 0.5 * hNz(Pb.zx, 9.0, blur * tb).g) + hGlowAt(Pb + nb * 0.002, reflect(rd, nb), 0.1) * (0.05 + 0.5 * pow(1.0 - clamp(-dot(rd, nb), 0.0, 1.0), 4.0));
      dist = tb;
    }
  }
  // the air of the corridor
  float hz = 1.0 - exp(-dist * uHaze.a);
  float sc = max(dot(rd, H_SUN), 0.0);
  col = mix(col, uHaze.rgb * (1.0 + 1.6 * sc * sc * sc), hz);
  return col;
}
#endif
`;

/**
 * What each wall gives off, written into uGlow[] for a time of day (0 before dawn … 1 the low sun of world 01).
 * The day values are world 01's own (conservatory/index.js: uGlow).
 */
const NIGHT = [
  [0.013, 0.027, 0.046], // sunlit wall, before the sun: the fog holds a little sky
  [0.15, 0.2, 0.26], // shade wall: the moon is on this side, and its fog holds it
  [0.022, 0.036, 0.044],
  [0.2, 0.275, 0.34], // roof: the sky is ahead of the ground, and the moon is still in it
  [0.26, 0.35, 0.43],
  [0.003, 0.004, 0.005],
  [0.003, 0.004, 0.005],
];
const DAY = [
  [0.78, 0.6, 0.36],
  [0.17, 0.23, 0.27],
  [0.6, 0.52, 0.36],
  [0.36, 0.43, 0.48],
  [0.3, 0.38, 0.44],
  [0.02, 0.022, 0.02],
  [0.015, 0.018, 0.018],
];
export function setDaylight(u, day) {
  const k = Math.pow(day, 1.6);
  for (let i = 0; i < 7; i++) {
    const g = u.uGlow.value[i];
    g.set(NIGHT[i][0] + (DAY[i][0] - NIGHT[i][0]) * k, NIGHT[i][1] + (DAY[i][1] - NIGHT[i][1]) * k, NIGHT[i][2] + (DAY[i][2] - NIGHT[i][2]) * k);
  }
  // the sun through fog: nothing until it is over the hedge, then all at once warm
  const s = Math.pow(Math.max(0, (day - 0.12) / 0.88), 1.5);
  u.uSun.value.set(1.9 * s, 1.3 * s, 0.68 * s, 0.25 + 0.75 * k);
  // first light: strongest just before the sun shows
  const d = Math.exp(-Math.pow((day - 0.16) / 0.2, 2)) * 0.11 + 0.05 * (1 - day);
  u.uDawn.value.set(1.0 * d, 0.47 * d, 0.17 * d, u.uDawn.value.w);
  const mn = Math.pow(1 - day, 2.5);
  u.uMoon.value.set(1.5 * mn, 1.9 * mn, 2.3 * mn, mn);
  u.uHaze.value.set(0.012 + 0.248 * k, 0.018 + 0.202 * k, 0.022 + 0.098 * k, 0.045);
}

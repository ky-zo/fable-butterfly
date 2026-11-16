// The designed loss landscape: composition data + the analytic GLSL that turns it into height.
// Evaluated only at bake time (see land.js); everything at runtime samples the baked result.
//
// The land is a DRAINAGE NETWORK first: every point lies on the wall of some valley, so every marble has somewhere
// to go. Ridges are where two valleys' walls meet. Noise, gullies and roughness are added on top, and whatever
// accidental pits remain are filled (flood.js). Only the minima listed here survive.

import { hash, noise, fbm } from '../../core/glsl.js';
import { FLOOR } from './chunks.js';

// Closed hollows: [x, z, floor, radius].
export const PITS = [
  [-10.3, 15.7, 4.3, 3.0], // a hanging bowl west of the bay
  [20, -19.5, 12.55, 3.4], // a shallow pan on the plateau
  [-19.5, -3.5, 10.5, 2.0], // a small tarn high in the west
];

export const BASIN = { x: 8, z: 9, floor: FLOOR, flat: 5.6 };
export const PASS = { x: 1.28, z: -5.56 };

// Valleys, as polylines of [x, z, floor height, width]. Floors fall monotonically downstream.
export const CHANNELS = [
  // 0: the long valley: from under the north-west heights, round the north, through the pass, into the basin
  [
    [-21, -13, 11.0, 2.4],
    [-15, -19, 10.2, 2.8],
    [-7, -20.5, 9.2, 3.0],
    [0, -17, 8.2, 3.0],
    [1.0, -12, 7.3, 2.6],
    [0.36, -7.56, 6.3, 1.9],
    [1.28, -5.56, 5.8, 1.2],
    [2.29, -3.38, 4.8, 1.4],
    [3.8, -0.2, 3.3, 2.0],
    [5.6, 3.6, 1.5, 2.6],
  ],
  // its tributaries
  [[-9, -31, 12.4, 1.8], [-8, -26, 10.7, 2.0], [-7, -20.5, 9.25, 2.4]],
  [[11, -30, 12.4, 1.8], [7, -24.5, 10.3, 2.0], [2.5, -19.5, 8.7, 2.2], [0, -17, 8.25, 2.4]],
  [[-31, -11, 13.0, 1.8], [-26, -13, 12.0, 2.0], [-21, -13, 11.05, 2.2]],
  // moats along the outer foot of the wall, both draining to the pass, and their feeders
  [[-12.5, 6.5, 8.2, 1.7], [-9.2, 0.9, 7.5, 1.7], [-5.4, -4.5, 6.9, 1.6], [-1.5, -7.0, 6.45, 1.5], [0.2, -7.7, 6.32, 1.5]],
  [[-26, -1.5, 11.8, 1.8], [-19, 2.5, 10.0, 2.0], [-12.5, 6.5, 8.25, 1.9]],
  [[20.3, -5.5, 8.2, 1.7], [13.0, -9.3, 7.5, 1.7], [6.4, -9.9, 6.9, 1.6], [2.3, -8.7, 6.5, 1.5], [0.9, -8.1, 6.36, 1.5]],
  [[27, -13, 11.0, 1.8], [23.5, -8.5, 9.4, 1.9], [20.3, -5.5, 8.25, 1.8]],
  // western valley that dead-ends in a hanging bowl (a local minimum)
  [[-21, 11.5, 8.6, 1.7], [-16, 13.8, 6.6, 1.8], [-12, 15.4, 5.0, 1.8]],
  // the west drains past it into the basin
  [[-31, 14, 12.0, 1.8], [-24, 19, 9.6, 2.0], [-14, 21.5, 6.4, 2.0], [-4, 18, 2.9, 2.0], [1.5, 13.8, 1.2, 2.2]],
  // valleys that fall straight into the basin from the south and east
  [[-10, 31, 11.4, 1.8], [-4.5, 25.5, 8.8, 2.0], [1, 20.5, 5.4, 2.0], [4.5, 15.5, 2.3, 2.2]],
  [[-27, 25, 12.0, 1.8], [-18, 26, 10.2, 1.9], [-10.5, 26.5, 9.4, 1.9], [-4.5, 25.5, 8.85, 2.0]],
  [[15, 31.5, 10.8, 1.8], [13.5, 26, 7.8, 2.0], [11.5, 20.5, 3.8, 2.0], [9.8, 15.8, 1.5, 2.2]],
  [[31, 17, 10.6, 1.8], [26, 15, 7.9, 2.0], [20.5, 12.5, 3.9, 2.0], [15.5, 10.5, 1.4, 2.2]],
  [[31, 2, 10.6, 1.8], [26, 3.5, 8.1, 2.0], [20.5, 5.5, 4.5, 2.0], [15.5, 7.2, 1.7, 2.2]],
  [[29, 29, 11.0, 1.8], [23, 23.5, 7.6, 2.0], [17.5, 18, 3.2, 2.0], [13.5, 13.8, 1.1, 2.2]],
];

// Ridges, as polylines of [x, z, crest height, half width]. The wall the pass cuts through, in two halves.
export const RIDGES = [
  [[-8.0, 8.9, 6.3, 2.0], [-6.5, 2.2, 7.6, 2.2], [-3.3, -2.4, 8.5, 2.2], [-0.67, -4.45, 8.9, 2.0]],
  [[3.38, -6.32, 8.9, 2.0], [6.66, -6.94, 8.5, 2.2], [12.2, -6.44, 7.7, 2.2], [18.3, -3.2, 6.3, 2.0]],
];

export const PLATEAU = { x: 19, z: -20, h: 13.0, r: 6.5 };

// ---- helpers: Catmull-Rom subdivision of [x,z,a,b] control polylines into a flat vec4 list.
// The first node of each polyline carries a NEGATIVE width as a "pen up" flag.
function subdivide(lines, per) {
  const out = [];
  for (const pts of lines) {
    const n = pts.length;
    const at = (i) => pts[Math.max(0, Math.min(n - 1, i))];
    let first = true;
    for (let i = 0; i < n - 1; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let s = 0; s < per; s++) {
        const t = s / per;
        const t2 = t * t, t3 = t2 * t;
        const c = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
        const lin = (k) => p1[k] + (p2[k] - p1[k]) * t;
        out.push([c(0), c(1), lin(2), first ? -lin(3) : lin(3)]);
        first = false;
      }
    }
    const e = pts[n - 1];
    out.push([e[0], e[1], e[2], e[3]]);
  }
  return out;
}

export function bakeUniformData() {
  const nodes = subdivide(CHANNELS, 3);
  const ridges = subdivide(RIDGES, 3);
  return { nodes, ridges, pits: PITS };
}

/** The centre line of channel k, densely sampled: [{x, z, floor, w}] (for the camera rail). */
export function channelPath(k, per = 8) {
  return subdivide([CHANNELS[k]], per).map((n) => ({ x: n[0], z: n[1], floor: n[2], w: Math.abs(n[3]) }));
}

// ---- pass 1: the macro relief (drainage network + basin + wall + pits + far ranges). Smooth; baked at half res.
export const macroFrag = (NCH, NRG, NPIT) => /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uRect;           // centre xz, half extent xz
uniform vec4 uNodes[${NCH}];
uniform vec4 uRidges[${NRG}];
uniform vec4 uPits[${NPIT}];
uniform vec4 uBasin;          // x, z, floor, flat radius
uniform vec4 uPlateau;        // x, z, height, radius
${hash}
${noise}
${fbm}

float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float smax(float a, float b, float k) { return -smin(-a, -b, k); }

float ridgeLines(vec2 p) {
  float best = -1e4;
  for (int i = 1; i < ${NRG}; i++) {
    vec4 a = uRidges[i - 1], b = uRidges[i];
    if (b.w < 0.0) continue;
    vec2 pa = p - a.xy, ba = b.xy - a.xy;
    float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float d = length(pa - ba * t);
    float w = mix(abs(a.w), abs(b.w), t);
    float crest = mix(a.z, b.z, t) + 0.8 * (vnoise(vec2((float(i) + t) * 1.3, 3.7)) - 0.5);
    best = max(best, crest - 2.2 * pow(d / w, 1.35));
  }
  return best;
}

// x: valley surface with long even walls (the drainage network); y: the same floors with steep walls (to re-cut gaps)
vec2 network(vec2 p) {
  float soft = 1e4, hard = 1e4, cur = 1e4;
  for (int i = 1; i < ${NCH}; i++) {
    vec4 a = uNodes[i - 1], b = uNodes[i];
    if (b.w < 0.0) { soft = smin(soft, cur, 0.3); cur = 1e4; continue; }
    vec2 pa = p - a.xy, ba = b.xy - a.xy;
    float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float d = length(pa - ba * t);
    float w = mix(abs(a.w), abs(b.w), t);
    float fl = mix(a.z, b.z, t);
    float x = max(d - 0.24 * w, 0.0);
    float side = sign(ba.x * pa.y - ba.y * pa.x) * d;
    // streamlined bars on the valley floor: the river braids around them
    float bars = (vnoise(vec2((float(i) + t) * 0.8, side * 1.7 + float(i) * 0.37)) - 0.5) * 0.05 * (1.0 - smoothstep(0.0, 1.2 * w, x));
    cur = min(cur, fl + bars + 0.58 * x * x / (x + w));
    float xs = x / w;
    hard = min(hard, fl + bars + 2.0 * xs * xs);
  }
  soft = smin(soft, cur, 0.3);
  return vec2(soft, hard);
}

float macro(vec2 p) {
  vec2 wp = p + 4.0 * (vec2(vnoise(p * 0.05 + 3.1), vnoise(p * 0.05 + 17.7)) - 0.5);
  vec2 net = network(p);
  float h = net.x;
  // the plateau: a flat tableland where there is almost no gradient to follow
  float pm = exp(-pow(length(p - uPlateau.xy) / uPlateau.w, 4.0));
  h = mix(h, uPlateau.z + (fbm(p * 0.3 + 2.0, 3) - 0.5) * 0.35, pm * 0.96);
  // the basin
  vec2 q = p - uBasin.xy;
  float r = length(q + 1.6 * (vec2(vnoise(p * 0.11 + 40.0), vnoise(p * 0.11 + 71.0)) - 0.5));
  float B = uBasin.z + 0.004 * r * r + 0.045 * pow(max(r - uBasin.w, 0.0), 2.0);
  h = smin(h, B, 1.2);
  // rolling relief on the high ground
  float up = smoothstep(1.0, 5.0, h - uBasin.z);
  h += (fbm(wp * 0.2 + 9.0, 4) - 0.5) * 1.1 * up;
  // the wall, then re-cut the gap and the moats through it
  h = smax(h, ridgeLines(p), 0.8);
  h = smin(h, net.y, 0.6);
  for (int i = 0; i < ${NPIT}; i++) {
    vec2 d = p - uPits[i].xy;
    float P = uPits[i].z + 2.0 * dot(d, d) / (uPits[i].w * uPits[i].w);
    h = smin(h, P, 0.7);
  }
  // the crest of the headland south of the bay (the skyline of the first picture): bare rock stands out of it in
  // teeth, a narrow band of them along the very top — the line it flies at the end is two metres north of that
  float cz = 22.32 - 0.235 * (p.x - 2.0);
  float cd = (p.y - cz) / 0.34;
  float cm = exp(-cd * cd) * smoothstep(-14.0, -10.0, p.x) * (1.0 - smoothstep(6.4, 8.6, p.x)) * smoothstep(0.7, 1.7, length(p - vec2(0.9, 21.7)));
  float cr = (1.0 - abs(2.0 * vnoise(vec2(p.x * 1.5 + 3.0, p.y * 0.5)) - 1.0)) * 0.6 + (1.0 - abs(2.0 * vnoise(vec2(p.x * 3.9 + 9.0, p.y * 1.1)) - 1.0)) * 0.4;
  h += cm * 0.34 * pow(smoothstep(0.42, 0.92, cr), 1.2);
  // distant ranges beyond the playable ground
  float e = length(p);
  float farM = 9.5 + (ridged(wp * 0.05 + 2.3, 5) - 0.4) * 5.0 + smoothstep(34.0, 90.0, e) * (2.0 + 28.0 * ridged(wp * 0.0105 + 7.0, 6));
  h = mix(h, farM, smoothstep(31.5, 47.0, max(abs(p.x), abs(p.y))));
  // the sea: east of the bay, and round behind the headland to the south of it. The bay opens into it.
  float wob = 2.2 * (vnoise(p * 0.07 + 11.0) - 0.5) + 0.7 * (vnoise(p * 0.31 + 5.0) - 0.5);
  float sa = p.x - 17.5;
  float sb = (p.y + 0.35 * p.x - 25.5) * 0.94;
  float sc = 7.5 - length(p - vec2(16.5, 21.0));
  float sd = max(max(sa, sb), sc) + wob;
  h = mix(h, max(-1.6 - 0.03 * sd, -5.0), smoothstep(-2.5, 3.5, sd));
  return h;
}

void main() {
  vec2 p = uRect.xy + (vUv * 2.0 - 1.0) * uRect.zw;
  gl_FragColor = vec4(macro(p), 0.0, 0.0, 1.0);
}
`;

export const CUBIC = /* glsl */ `
vec4 cubic(sampler2D t, vec2 uv, float res) {
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
`;

// ---- pass 2: erosion + roughness on top of the macro relief, at full resolution
export const detailFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tMacro;
uniform float uMacroRes;
uniform vec4 uRect;
uniform float uSS;
uniform vec2 uTexelW;
uniform float uDetail;        // 1 near, <1 for the far ranges
${hash}
${noise}
${fbm}
${CUBIC}

float macroAt(vec2 p) { return cubic(tMacro, (p - uRect.xy) / uRect.zw * 0.5 + 0.5, uMacroRes).x; }

// Erosion: anisotropic (Gabor) noise whose stripes run ACROSS the slope, so its troughs are gullies that run downhill.
float gullies(vec2 p, vec2 g) {
  float sl = length(g);
  vec2 dn = g / max(sl, 1e-4);
  vec2 perp = vec2(-dn.y, dn.x);
  float amp = smoothstep(0.10, 0.5, sl);
  float sum = 0.0, f = 0.30, a = 0.30;
  for (int o = 0; o < 3; o++) {
    vec2 q = p * f;
    vec2 ip = floor(q), fp = q - ip;
    float va = 0.0, wt = 0.0;
    for (int j = -1; j <= 2; j++) for (int i = -1; i <= 2; i++) {
      vec2 c = vec2(float(i), float(j));
      vec2 hh = hash22(ip + c + float(o) * 17.0);
      vec2 pp = fp - c - hh + 0.5;
      float w = exp(-dot(pp, pp) * 2.2);
      va += cos(dot(pp, perp) * (5.2 + 3.4 * hh.y) + hh.x * 6.2831) * w;
      wt += w;
    }
    float v = va / wt;
    sum += a * (0.35 - abs(v)) * 1.5;        // sharp crests between rounded gullies
    f *= 2.3; a *= 0.42;
  }
  return sum * amp;
}

float baseH(vec2 p) {
  float h = macroAt(p);
  const float e = 0.35;
  vec2 g = vec2(macroAt(p + vec2(e, 0.0)) - macroAt(p - vec2(e, 0.0)), macroAt(p + vec2(0.0, e)) - macroAt(p - vec2(0.0, e))) / (2.0 * e);
  h += gullies(p, g) * uDetail;
  h += (fbm(p * 0.85 + 5.0, 3) - 0.5) * 0.06;
  h += (vnoise(p * 3.3 + 1.7) - 0.5) * 0.014;
  return h;
}

void main() {
  vec2 p = uRect.xy + (vUv * 2.0 - 1.0) * uRect.zw;
  float h;
  if (uSS > 1.5) {
    vec2 o = uTexelW * 0.25;
    h = 0.25 * (baseH(p + vec2(-o.x, -o.y)) + baseH(p + vec2(o.x, -o.y)) + baseH(p + vec2(-o.x, o.y)) + baseH(p + o));
  } else h = baseH(p);
  gl_FragColor = vec4(h, 0.0, 0.0, 1.0);
}
`;

// height → (h, dh/dx, dh/dz, sky visibility)
export const deriveFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tH;
uniform vec2 uTexel;          // 1 / resolution
uniform float uTexelWorld;    // world size of a texel
uniform float uAoScale;
float H(vec2 uv) { return textureLod(tH, uv, 0.0).x; }
void main() {
  float h = H(vUv);
  float hx = (H(vUv + vec2(uTexel.x, 0.0)) - H(vUv - vec2(uTexel.x, 0.0))) / (2.0 * uTexelWorld);
  float hz = (H(vUv + vec2(0.0, uTexel.y)) - H(vUv - vec2(0.0, uTexel.y))) / (2.0 * uTexelWorld);
  // horizon-based sky visibility
  float occ = 0.0;
  for (int d = 0; d < 8; d++) {
    float an = (float(d) + 0.5) * 0.7853981634;
    vec2 dir = vec2(cos(an), sin(an));
    float mt = 0.0, rad = 0.12 * uAoScale;
    for (int s = 0; s < 6; s++) {
      float hs = H(vUv + dir * rad / uTexelWorld * uTexel);
      mt = max(mt, (hs - h) / rad);
      rad *= 2.25;
    }
    occ += mt / sqrt(1.0 + mt * mt);
  }
  float ao = 1.0 - occ / 8.0;
  gl_FragColor = vec4(h, hx, hz, ao);
}
`;

// raw height + the flood result (W = filled level, hc = coarse height) → height with every accidental pit filled
export const fillFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tH, tFill;
uniform float uFillRes;
${CUBIC}
void main() {
  float h = textureLod(tH, vUv, 0.0).x;
  vec2 wc = cubic(tFill, vUv, uFillRes).xy;      // filled level, coarse height
  float c = max(wc.x - wc.y, 0.0);
  float m = smoothstep(0.01, 0.07, c);
  gl_FragColor = vec4(mix(h + c, wc.x, m), 0.0, 0.0, 1.0);
}
`;

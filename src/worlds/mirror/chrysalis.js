// Mirror — the chrysalis. A real Greta oto pupa is chrome: this one is a mirror of the glasshouse it hangs in.
//
// The surface is one function, chP(s, θ): s runs from the cremaster (0, hooked into the silk) to the head (1, at the
// bottom: a pupa hangs head down), θ round it from the front, where the wing cases meet. Its outline is the curve world
// 05 winds its thread round, so the hand-over is the same shape; the rest is the animal's own: ringed abdomen, the keel
// of the thorax, the wing cases as plates with a step at their edge, two caps over the eyes, a few gold points.
// The vertex shader places the grid with it and the fragment shader differentiates it, so the mirror has an exact
// normal at every pixel and no facet anywhere.
//
// It has four states, all dials of progress: fogged with condensation (beads, and one drop that runs), chrome, clear
// (what is folded inside shows through: the forewing's own pattern from the kit's atlas, laid under the wing case),
// and split down the front, a husk: paper, with the day behind it coming through.

import * as THREE from 'three';
import { atlasGLSL, BAR } from '../../shared/butterfly/index.js';
import { houseGLSL } from './house.glsl.js';
import { fieldGLSL } from './plate.glsl.js';
import { CH_C, CH_H, CH_X, CH_Y, CH_Z } from './story.js';

/** Gold points: [s, angle from the front]. Each is there on both sides. */
export const GOLD = [
  [0.47, 2.62],
  [0.535, 2.2],
  [0.6, 2.82],
  [0.7, 1.52],
  [0.8, 1.02],
  [0.36, 2.3],
  [0.9, 0.42],
];

const f = (x) => Number(x).toFixed(4);
const v2 = (p) => `vec2(${f(p[0])}, ${f(p[1])})`;

export const chrysGLSL = /* glsl */ `
uniform vec4 uCh;      // condensation, clear, split, husk
uniform vec4 uCh2;     // time, the surface loosening as the lens goes in, glow of the gold points, where the drop is (0..1)
uniform vec4 uCh3;     // a wriggle: how far the body is swung on its abdomen, two ways
const float CH_PI = 3.14159265;
const float CH_TAU = 6.2831853;
float chProf(float s){
  return pow(max(sin(CH_PI * pow(s, 1.1)), 0.0), 0.52) * (0.44 + 0.56 * min(1.0, pow(s / 0.43, 1.25))) * (0.93 + 0.07 * sin(s * 5.2 - 0.2));
}
float chAxis(float s){ return 0.2 * sin(CH_PI * pow(s, 0.75)) * (1.0 - 0.3 * s) - 0.113; }
// abdominal segments: 0 in a suture … 1 on the swell
float chSeg(float s){
  float x = (s - 0.07) / 0.375 * 4.0;
  float c = 0.5 - 0.5 * cos(CH_TAU * x);
  return c * (2.0 - c) * smoothstep(0.045, 0.085, s) * (1.0 - smoothstep(0.4, 0.46, s));
}
// where the hind edge of the wing case lies at this height (angle from the front)
float chWingEdge(float s){ return mix(2.3, 0.42, smoothstep(0.43, 0.93, s)); }
float chPlate(float s, float am){
  float e = chWingEdge(s);
  return smoothstep(e + 0.13, e - 0.13, am) * smoothstep(0.42, 0.52, s) * (1.0 - smoothstep(0.88, 0.96, s));
}
float chGold(float s, float am){
  float g = 0.0;
${GOLD.map(([gs, ga]) => `  { vec2 d = vec2(s - ${f(gs)}, (am - ${f(ga)}) * 0.24); g += exp(-dot(d, d) / 0.00016); }`).join('\n')}
  return min(g, 1.0);
}
float chRelief(float s, float am){
  float h = 0.0013 * (chSeg(s) - 0.6) * smoothstep(0.03, 0.09, s);
  h += 0.012 * exp(-pow((s - 0.535) / 0.07, 2.0)) * pow(max(-cos(am), 0.0), 6.0);       // the keel of the thorax
  h += 0.006 * chPlate(s, am);                                                          // wing cases
  h += 0.02 * exp(-pow((s - 0.955) / 0.022, 2.0)) * exp(-pow((am - 0.75) / 0.3, 2.0));  // caps over the eyes
  h += 0.008 * smoothstep(0.2, 0.75, chGold(s, am));
  return h;
}
// the angle on the shell for a grid angle th (0..2π from the front): the split opens a slit down the front
float chAngle(float s, float th){
  float gap = uCh.z * 1.25 * smoothstep(0.4, 0.8, s) * (1.0 - 0.45 * smoothstep(0.9, 1.0, s));
  return gap * 0.5 + th * (1.0 - gap / CH_TAU);
}
vec3 chP(float s, float th){
  float a = chAngle(s, th);
  float am = a > CH_PI ? CH_TAU - a : a;
  float c = cos(a), sn = sin(a);
  float cb = max(c, 0.0); cb = cb * cb * (3.0 - 2.0 * cb);
  float bulge = 0.3 * exp(-pow((s - 0.6) / 0.2, 2.0)) * cb;
  float r = 0.26 * chProf(s) * (1.0 + bulge) + 0.0147 * (1.0 - s);
  r += chRelief(s, am) * smoothstep(0.0, 0.04, s) * smoothstep(1.0, 0.97, s);
  // the lips of the split curl outward
  float edge = min(th, CH_TAU - th);
  r *= 1.0 + 0.3 * uCh.z * exp(-edge * edge / 0.2) * smoothstep(0.42, 0.75, s);
  // touched, a pupa wriggles: the abdomen flexes and everything below it swings
  float sw = smoothstep(0.1, 0.42, s) * (s - 0.1);
  return vec3(chAxis(s) + r * c * 0.92 + uCh3.x * sw, 0.5 - s, r * sn + uCh3.y * sw);
}
`;

const VERT = /* glsl */ `
precision highp float;
${chrysGLSL}
varying vec2 vST;
varying vec3 vWorld;
void main(){
  vST = vec2(position.x, position.y * CH_TAU);
  vec4 w = modelMatrix * vec4(chP(vST.x, vST.y), 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vST;
varying vec3 vWorld;
uniform mat4 modelMatrix;
${houseGLSL}
${chrysGLSL}
${atlasGLSL}
${fieldGLSL}
uniform sampler2D tVein, tShade, tWF;

// Beads of water, in the surface's own metric. Returns the bead's normal in the tangent frame (xy) and how much bead (z).
vec3 chBeads(vec2 uv, float cell, float density, float seed, out float rim){
  vec2 q = uv / cell;
  vec2 id = floor(q);
  vec3 acc = vec3(0.0);
  rim = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = id + vec2(float(i), float(j));
    vec3 h = hash32(g + seed);
    if (h.z > density) continue;
    vec2 c = g + 0.22 + 0.56 * h.xy;
    float rad = 0.13 + 0.3 * fract(h.z * 91.7 + h.x);
    vec2 d = (q - c) / rad;
    float l = dot(d, d);
    if (l < 1.0) {
      float z = sqrt(1.0 - l);
      acc = vec3(d * 0.8, z);
      rim = smoothstep(0.6, 1.0, l);
    }
  }
  return acc;
}

// the folded forewing under the wing case: (s, angle from the front) → millimetres on the flat wing
// (as a pupa carries it: a third of its size, its leading edge along the hind edge of the wing case, its outer margin
//  toward the front — so the border and the white bar lie on the flank, where they can be seen)
vec2 chWingMM(float s, float am){
  vec2 m = vec2(am * 0.25, s);
  vec2 ex = normalize(vec2(-0.826, 0.564));
  vec2 ey = vec2(ex.y, -ex.x);
  vec2 d = m - vec2(0.48, 0.5);
  return vec2(dot(d, ex), dot(d, ey)) * (29.5 / 0.44);
}
float chSegD(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }

void main(){
  float s = clamp(vST.x, 0.004, 0.996), th = vST.y;
  float a = chAngle(s, th);
  float am = a > CH_PI ? CH_TAU - a : a;
  // the surface's own frame, by differentiating it
  const float E = 0.0015;
  vec3 p0 = chP(s, th), ps = chP(s + E, th), pt = chP(s, th + E * 4.0);
  vec3 Ts = normalize(mat3(modelMatrix) * (ps - p0));
  vec3 Tt = normalize(mat3(modelMatrix) * (pt - p0));
  vec3 N = normalize(cross(Tt, Ts));
  vec3 V = normalize(cameraPosition - vWorld);
  bool back = dot(N, V) < 0.0;
  if (back) N = -N;

  float husk = uCh.w;
  vec2 uv = vec2(a * 0.24, s);
  float seg = chSeg(s);
  float gold = chGold(s, am);
  float plate = chPlate(s, am);
  float stem = 1.0 - smoothstep(0.035, 0.07, s);                 // the cremaster: black, hooked into the silk

  // ---- condensation: a breath of fog in patches, beads, and one drop that has run
  float wet = uCh.x * (1.0 - husk);
  vec4 nf = hNz(uv, 1.3, 0.0);
  float fogAmt = wet * smoothstep(0.42, 0.74, nf.r * 0.7 + nf.g * 0.3 + 0.2 * (s - 0.5) + 0.22 * wet);
  float rimA, rimB, rimD;
  vec3 bA = chBeads(uv, 0.034, 0.1 + 0.3 * wet, 3.1, rimA);
  vec3 bB = chBeads(uv + 7.7, 0.012, 0.16 + 0.42 * wet, 11.4, rimB);
  // the drop: it gathers under the shoulder, runs, stops, runs
  float sd = mix(0.17, 0.9, uCh2.w);
  vec2 du = vec2((a - (1.02 + 0.5 * (s - 0.5) + 0.06 * sin(s * 23.0))) * 0.24, s - sd);
  float trail = smoothstep(0.012, 0.004, abs(du.x)) * step(0.17, s) * step(s, sd) * step(0.001, uCh2.w);
  vec2 dd = du / vec2(0.017, 0.026 + 0.012 * step(0.0, -du.y));
  float dl = dot(dd, dd);
  vec3 bD = dl < 1.0 && uCh2.w > 0.001 ? vec3(dd * 0.9, sqrt(1.0 - dl)) : vec3(0.0);
  rimD = smoothstep(0.55, 1.0, dl);
  float inFog = smoothstep(0.15, 0.5, fogAmt);
  // (a bead seen edge-on is a speck, not a lens)
  float facing = smoothstep(0.22, 0.6, dot(N, V));
  bA *= inFog * (1.0 - trail) * facing;
  bB *= inFog * (1.0 - trail) * facing;
  bD *= smoothstep(0.12, 0.4, dot(N, V));
  vec3 bead = bD.z > 0.0 ? bD : (bA.z > 0.0 ? bA : bB);
  float rim = bD.z > 0.0 ? rimD : (bA.z > 0.0 ? rimA : rimB);
  float beadAmt = step(0.001, bead.z) * wet;
  fogAmt *= (1.0 - trail * 0.92) * (1.0 - beadAmt);
  vec3 Nm = N;
  if (beadAmt > 0.0) Nm = normalize(Tt * bead.x + Ts * bead.y + N * (bead.z + 0.9));
  // the surface loosens as the lens goes in: it was only ever holding still
  if (uCh2.y > 0.0) {
    float t = uCh2.x;
    vec2 q = uv * 26.0;
    vec2 g = vec2(cos(q.x + t * 1.3 + 1.7 * sin(q.y * 0.6 - t * 0.5)) * sin(q.y * 1.13 - t * 0.9), sin(q.x * 0.9 + t) * cos(q.y * 1.31 + t * 0.7 + 1.3 * sin(q.x * 0.5)));
    Nm = normalize(Nm + (Tt * g.x + Ts * g.y) * 0.16 * uCh2.y);
  }

  // ---- chrome
  float NdV = max(dot(Nm, V), 0.0);
  vec3 R = reflect(-V, Nm);
  vec3 R0 = reflect(-V, N);
  float foot = length(fwidth(R0)) * (0.6 + 2.5 * beadAmt);
  float blur = max(foot, 0.003) + fogAmt * 0.3;
  vec3 env = houseEnv(vWorld + N * 0.0004, R, blur, 0.0);
  float gM = smoothstep(0.3, 0.62, gold);                           // a gold point: a bead of another metal set in the silver
  vec3 F0 = mix(vec3(0.93, 0.935, 0.905), vec3(1.0, 0.74, 0.3), gM);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
  vec3 irr = hIrr(vWorld, N);
  // (the sun side of the room and what the floor gives back of it reach the metal too; and where the mirror looks
  //  straight at the sun through the fogged pane there is a small hot place that slides along its rim)
  float toSun = max(dot(R, H_SUN), 0.0);
  env += uSun.rgb * (0.05 + 0.05 * max(-R.x, 0.0) + 5.0 * pow(toSun, 220.0) * (1.0 - fogAmt));
  vec3 chrome = env * F;
  chrome = mix(chrome, chrome * 0.72 + irr * 0.2, fogAmt);          // fog scatters what it does not pass
  chrome *= 1.0 - 0.45 * rim * beadAmt;                              // a bead has a dark edge
  chrome += irr * 0.5 * beadAmt * smoothstep(0.25, 0.95, bead.z) * smoothstep(0.1, -0.5, bead.y);   // …and gathers light along the other
  float crease = (1.0 - seg) * smoothstep(0.05, 0.09, s) * (1.0 - smoothstep(0.42, 0.455, s));
  chrome *= 1.0 - 0.3 * pow(crease, 10.0);                           // sutures see only themselves
  chrome *= 1.0 + 0.5 * gM;
  chrome += vec3(1.0, 0.62, 0.2) * gM * uCh2.z * 0.3 * (0.3 + 0.7 * NdV);

  // ---- clear: what is folded inside
  vec3 col = chrome;
  float clear = uCh.y;
  float wingLine = 0.0;
  if (clear > 0.002 || husk > 0.0) {
    // the body: dark, the membranes between its segments paler; white points on the thorax
    vec3 body = mix(vec3(0.085, 0.052, 0.03), vec3(0.024, 0.017, 0.013), smoothstep(0.02, 0.3, seg + step(0.44, s)));
    body = mix(body, vec3(0.5, 0.47, 0.4), gold * 0.8);
    // down the front between the wing cases: antennae, legs and the tongue, laid side by side
    float strands = smoothstep(0.34, 0.1, am) * smoothstep(0.44, 0.52, s);
    body = mix(body, vec3(0.11, 0.07, 0.035) * (0.5 + 0.8 * step(0.5, fract(am * 21.0))), strands);
    // the eyes
    body = mix(body, vec3(0.012, 0.008, 0.006), exp(-pow((s - 0.955) / 0.024, 2.0)) * exp(-pow((am - 0.75) / 0.32, 2.0)));
    // the forewing, a third of its size, flat under the wing case
    vec2 mm = chWingMM(s, am);
    vec2 auv = bfAtlasUV(mm, 0.0);
    float lod = log2(max(length(fwidth(mm)) * 32.0, 1.0));
    float sh = textureLod(tShade, auv, lod * 0.5).r;
    vec2 vn = textureLod(tVein, auv, lod).rg;
    float inWing = smoothstep(0.035, 0.08, sh) * step(0.0, mm.x) * step(mm.x, 29.9) * step(-8.0, mm.y) * step(mm.y, 4.6) * smoothstep(0.42, 0.47, s);
    float scales = smoothstep(0.35, 0.75, sh);
    // its markings are the kit's: black, the ember inside the outer margin, the white bar (wingMaterial.js: bfPigmentBand)
    vec4 wf = textureLod(tWF, wfUV(mm, 0.0), 0.0);                                    // mm inside the margin, -, mm from the scales, how much ember
    float ex = wf.r;
    scales = max(scales, 1.0 - smoothstep(-0.1, 0.12, wf.b));
    float bwd = max(ex - wf.b, 0.3);                                                  // the border's width there
    float ember = smoothstep(0.3, 0.5, ex) * (1.0 - smoothstep(0.5 + 0.25 * bwd, 0.5 + 0.55 * bwd, ex)) * smoothstep(0.25, 0.7, wf.a);
    vec2 ba = ${v2(BAR.b)} - ${v2(BAR.a)};
    float al = clamp(dot(mm - ${v2(BAR.a)}, ba) / dot(ba, ba), 0.0, 1.0);
    float bw = ${f(BAR.w)} * (0.55 + 0.45 * smoothstep(0.0, 0.22, al)) * (1.0 - 0.8 * al * sqrt(al));
    float white = (1.0 - smoothstep(bw - 0.12, bw + 0.12, chSegD(mm, ${v2(BAR.a)}, ${v2(BAR.b)}))) * smoothstep(0.2, 0.4, ex);
    vec3 wing = mix(vec3(0.1, 0.082, 0.058), vec3(0.016, 0.012, 0.01), scales);        // smoky membrane; black velvet
    wing = mix(wing, mix(vec3(0.62, 0.21, 0.03), vec3(0.3, 0.05, 0.012), smoothstep(0.55, 1.05, ex)), ember);
    wing = mix(wing, vec3(0.03, 0.018, 0.012), smoothstep(0.42, 0.56, vn.r) * 0.85);  // veins
    wing = mix(wing, vec3(0.68, 0.64, 0.56), white);
    body = mix(body, wing, inWing * plate);
    wingLine = smoothstep(0.42, 0.56, vn.r) * inWing * plate;
    // lit through the cuticle: from the glass behind as much as from in front
    vec3 lit = body * (irr + hIrr(vWorld, -N) * 0.6) * 1.15;
    float Fc = 0.06 + 0.94 * pow(1.0 - NdV, 5.0);
    // (clear cuticle is glass: it mirrors the room, and where it turns away the day behind it comes round the edge)
    vec3 skin = lit * (1.0 - Fc) + env * Fc * 1.25 + hIrr(vWorld, -N) * vec3(0.5, 0.3, 0.12) * pow(1.0 - NdV, 2.5) * 0.9;
    skin = mix(skin, skin * 0.8 + irr * 0.12, fogAmt);
    // it clears from the wing cases outward
    float k = smoothstep(0.0, 1.0, clear * 1.5 - 0.5 * (1.0 - plate));
    col = mix(chrome, skin, k);
  }
  col = mix(col, vec3(0.012, 0.01, 0.008) + irr * 0.012, stem);

  if (husk > 0.0) {
    // empty: a shell of cuticle thinner than paper. What is seen of it is the day behind it, less what its thickness
    // takes: more in the sutures, along the veins the wing cases were moulded on, and wherever it turns away (the
    // light has further to go through it there, so its outline is amber). It is glass too, and has the room on it.
    vec3 thr = houseEnv(vWorld - N * 0.0006, -V, 0.1, 0.0);
    float pleat = 0.5 + 0.5 * sin(6.2832 * (am * 9.0 + s * 14.0));
    float thick = 0.34 + 1.5 * pow(crease, 3.0) + 1.0 * wingLine + 0.55 * nf.g + 0.3 * plate * pleat * pleat + 0.5 * gold;
    float path = thick / max(NdV, 0.2) * (back ? 1.7 : 1.0);
    vec3 tr = exp(-path * vec3(0.15, 0.34, 0.92));
    float Fh = 0.045 + 0.955 * pow(1.0 - NdV, 4.0);
    vec3 hk = thr * tr * 1.3 + irr * vec3(0.5, 0.4, 0.26) * 0.04 * thick + (env + uSun.rgb * 3.0 * pow(toSun, 90.0)) * Fh * (back ? 0.15 : 0.85);
    col = mix(col, hk, husk * (1.0 - stem));
  } else if (back) col = vec3(0.3, 0.24, 0.15) * irr;
  gl_FragColor = vec4(col, 1.0);
}`;

/** @returns {{ full: THREE.Mesh, uniforms }} */
export function buildChrysalis(ctx, house, kit) {
  const NS = 150;
  const NT = 96;
  const pos = new Float32Array((NS + 1) * (NT + 1) * 3);
  const idx = new Uint32Array(NS * NT * 6);
  let k = 0;
  for (let i = 0; i <= NS; i++) {
    for (let j = 0; j <= NT; j++) {
      const o = (i * (NT + 1) + j) * 3;
      // (denser toward the two ends, where the surface turns fastest)
      const u = i / NS;
      pos[o] = 0.0005 + 0.999 * (0.5 - 0.5 * Math.cos(Math.PI * u) * 0.35 + (u - 0.5) * 0.65);
      pos[o + 1] = j / NT;
      if (i < NS && j < NT) {
        const a = i * (NT + 1) + j;
        idx[k++] = a;
        idx[k++] = a + 1;
        idx[k++] = a + NT + 1;
        idx[k++] = a + 1;
        idx[k++] = a + NT + 2;
        idx[k++] = a + NT + 1;
      }
    }
  }
  const geo = ctx.track(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const uniforms = {
    ...house,
    uCh: { value: new THREE.Vector4(0.2, 0, 0, 0) },
    uCh2: { value: new THREE.Vector4(0, 0, 0, 0) },
    uCh3: { value: new THREE.Vector4(0, 0, 0, 0) },
    tVein: { value: kit.atlas.veins },
    tShade: { value: kit.atlas.shade },
    tWF: { value: null }, // the wing field (plate.glsl.js), baked after this is built: index.js hands it over
  };
  const matrix = new THREE.Matrix4().makeBasis(CH_X, CH_Y, CH_Z).scale(new THREE.Vector3(CH_H, CH_H, CH_H)).setPosition(CH_C);
  const mat = ctx.track(new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide }));
  const full = new THREE.Mesh(geo, mat);
  full.frustumCulled = false;
  full.matrixAutoUpdate = false;
  full.matrix.copy(matrix);
  full.matrixWorldNeedsUpdate = true;
  return { full, uniforms };
}

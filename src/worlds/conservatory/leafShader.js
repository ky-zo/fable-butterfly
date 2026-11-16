// Leaf shading. One vertex shader for every plant; the fragment shader is specialised per leaf form (LEAF_TYPE):
//   0 monstera (fenestrated)   1 fern leaflets   2 paddle (pinstripe)   3 heart (variegated)   4 blade   5 palm
// What matters for leaves: translucency against the low sun (with the veins and the shadows of other leaves printed
// into the glow), a waxy wet specular layer, vein relief, and enough imperfection that no two read the same.

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { layoutGLSL } from './layout.js';
import { sunGLSL } from './sun.js';

export const LEAF_VERT = /* glsl */ `
attribute vec2 aAux;
attribute vec2 aBend;
attribute vec4 aSeed;   // x random, y second random, z wind phase, w pinned (0 free … 1 held against the glass)
attribute vec4 aTint;   // x value, y hue shift (-1 blue-green … +1 yellow), z senescence, w ambient occlusion
uniform float uTime;
varying vec2 vUv;
varying vec2 vAux;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vSeed;
varying vec4 vTint;
varying float vPress;
${layoutGLSL}
void main(){
  vUv = uv; vAux = aAux; vSeed = aSeed; vTint = aTint;
  mat4 m = modelMatrix * instanceMatrix;
  // a leaf that was laid against the pane (w = 2) has been pushed nearly flat by it
  float laid = step(1.5, aSeed.w);
  vec4 wp = m * vec4(position.xy, position.z * mix(1.0, aSeed.w > 2.5 ? 0.05 : 0.16, laid), 1.0);
  vec3 wn = normalize(mat3(m) * normal);

  // wind: a slow shared gust, a sway per plant, a flutter per leaflet
  float ph = aSeed.z * 6.2831853;
  float gust = 0.55 + 0.45 * sin(uTime * 0.19 + wp.z * 0.31 + wp.x * 0.17);
  float free = 1.0 - 0.8 * min(aSeed.w, 1.0);
  vec3 sway = vec3(sin(uTime * 0.83 + ph), 0.35 * sin(uTime * 1.21 + ph * 1.7), cos(uTime * 0.67 + ph * 1.3));
  wp.xyz += sway * (0.028 * aBend.x * gust * free * length(m[1].xyz));
  wp.xyz += wn * (sin(uTime * 2.3 + ph * 3.1 + aAux.y * 40.0) * 0.006 * aBend.y * gust * free * length(m[1].xyz));

  // nothing passes through glass: whatever would poke into the corridor is pressed flat against the pane instead
  float mx = -1e9; vec3 nm = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float sd = dot(HULL[i].xyz, wp.xyz) - HULL[i].w;
    if (sd > mx) { mx = sd; nm = HULL[i].xyz; }
  }
  float gap = 0.0025 + 0.004 * aSeed.x;
  float push = max(0.0, gap - mx);
  wp.xyz += nm * push;
  vPress = smoothstep(0.0, 0.012, push);
  wn = normalize(mix(wn, nm * (dot(wn, nm) < 0.0 ? -1.0 : 1.0), vPress * 0.85));

  vWorld = wp.xyz;
  vNormal = wn;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const LEAF_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec2 vAux;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vSeed;
varying vec4 vTint;
varying float vPress;
uniform sampler2D tNoise;
uniform float uTime;
uniform vec3 uSky, uBounce, uHaze;
uniform float uHazeDensity;
uniform float uSunScale;     // art direction: how much direct sun this side of the garden gets
${hash}
${layoutGLSL}
${sunGLSL}

// --- venation -------------------------------------------------------------------------------------------------
// s = "which lateral vein am I on": constant along a vein that leaves the midrib and sweeps toward the tip.
float lateralCoord(vec2 uv, float sweep){
  float au = abs(uv.x);
  return uv.y - au * sweep * (1.0 - 0.28 * au);
}
// x = vein intensity, y = signed position inside the cell between two veins (-0.5..0.5).
// gNet receives the finer net: a thin vein halfway between two laterals and the rungs that cross from one to the next.
float gNet;
vec2 pinnate(vec2 uv, float n, float sweep, float wLat, float wMid, float rungs){
  float au = abs(uv.x);
  float s = lateralCoord(uv, sweep) * n + (uv.x > 0.0 ? 0.37 : 0.0);
  float fs = fract(s) - 0.5;
  float aa = fwidth(s) * 0.75 + 1e-4;
  float fade = smoothstep(1.0, 0.9, au) * smoothstep(0.012, 0.04, au);
  float wl = wLat * (1.0 - 0.7 * au) * n;
  float lat = smoothstep(wl + aa, wl * 0.35, abs(fs)) * fade;
  float am = fwidth(uv.x) * 0.75 + 1e-4;
  float mid = smoothstep(wMid * (1.0 - 0.75 * clamp(uv.y, 0.0, 1.0)) + am, 0.0, au);
  gNet = 0.0;
  float id = floor(s) + (uv.x > 0.0 ? 31.0 : 0.0);
  vec2 wn = texture2D(tNoise, uv * vec2(0.9, 1.4) + vSeed.xy).rg;
  if (rungs > 0.0) {
    float inter = smoothstep(wLat * 0.4 * n + aa, 0.0, 0.5 - abs(fs)) * 0.8 * smoothstep(0.6, 0.2, aa);
    // (rungs that are neither evenly spaced nor straight: each wanders, and each cell has its own rhythm)
    float r = au * rungs * (0.75 + 0.5 * hash11(id + 3.0)) + fs * (0.5 + 0.8 * wn.g) + hash11(id) * 7.0 + (wn.r - 0.5) * 2.2;
    float ar = fwidth(r) * 0.75 + 1e-4;
    float rung = smoothstep(0.05 + ar, 0.0, abs(fract(r) - 0.5)) * 0.75 * smoothstep(0.5, 0.15, ar);
    gNet = max(inter, rung) * fade;
  }
  return vec2(max(lat, mid), fs);
}

void main(){
  vec2 uv = vUv;
  bool stalk = uv.x > 4.0;
  float au = abs(uv.x);
  float seed = vSeed.x;
  vec4 nA = texture2D(tNoise, uv * vec2(0.21, 0.33) + vSeed.xy * 7.0);
  vec4 nB = texture2D(tNoise, uv * vec2(1.3, 2.1) + vSeed.yx * 3.0);

  // ---------------------------------------------------------------- outline: splits, holes, bites
  float vein = 0.0, cellPos = 0.0;
  gNet = 0.0;
  float edge = 1.0 - au;                       // 0 at the margin
  if (!stalk) {
#if LEAF_TYPE == 0
    {
      float n = 7.0;
      float sC = lateralCoord(uv, 0.34) * n + (uv.x > 0.0 ? 0.37 : 0.0);
      float lobe = floor(sC);
      float fs = fract(sC);
      float h1 = hash12(vec2(lobe, floor(seed * 91.0) + (uv.x > 0.0 ? 5.0 : 0.0)));
      float h2 = fract(h1 * 7.13);
      float gate = smoothstep(-0.9, 0.4, sC) * smoothstep(n * 0.98, n * 0.8, sC);
      // splits from the margin toward the midrib, between two veins: a rounded sinus that widens on its way out,
      // with edges that are never quite straight
      float depth = mix(0.22, 0.62, h1);
      float open = clamp((au - depth) / (1.0 - depth), 0.0, 1.0);
      float has = gate * step(0.18, h2);
      float slit = (0.02 + 0.11 * open) * sqrt(open) * has * (0.8 + 0.4 * nA.g);
      float dSlit = min(fs, 1.0 - fs) - slit;
      if (dSlit < 0.0) discard;
      // lobe tips are rounded: the margin pulls back as it nears a split
      float corner = 1.0 - smoothstep(0.0, 0.22, dSlit);
      float marg = 1.0 - 0.13 * corner * corner * has;
      if (au > marg) discard;
      edge = min(marg - au, dSlit * 2.5 + (1.0 - step(0.001, slit)));
      // oval holes near the midrib
      vec2 hp = vec2((au - mix(0.2, 0.42, h2)) / mix(0.07, 0.13, h1), (min(fs, 1.0 - fs)) / 0.1);
      float hole = dot(hp, hp);
      if (h1 > 0.45 && gate > 0.5 && au < depth - 0.06) {
        if (hole < 1.0) discard;
        edge = min(edge, (sqrt(hole) - 1.0) * 0.12);
      }
    }
    vec2 pv = pinnate(uv, 7.0, 0.34, 0.022, 0.06, 9.0);
#elif LEAF_TYPE == 1
    {
      // pinnae are lobed: a row of rounded teeth along each margin
      float lob = abs(fract(uv.y * 6.0 + (uv.x > 0.0 ? 0.5 : 0.0)) - 0.5) * 2.0;
      float cut = 1.0 - 0.34 * (1.0 - lob * lob) * smoothstep(0.02, 0.2, uv.y);
      if (au > cut) discard;
      edge = min(edge, (cut - au) * 2.0);
    }
    vec2 pv = pinnate(uv, 6.0, 0.5, 0.03, 0.12, 0.0);
#elif LEAF_TYPE == 2
    vec2 pv = pinnate(uv, 16.0, 0.34, 0.016, 0.05, 13.0);
#elif LEAF_TYPE == 3
    {
      // the sinus of the heart
      float notch = smoothstep(0.02, -0.2, uv.y) * 0.2 + 0.015;
      if (uv.y < 0.03 && au < notch) discard;
    }
    vec2 pv = pinnate(uv, 5.0, 0.55, 0.03, 0.06, 7.0);
#elif LEAF_TYPE == 4
    float st = fract(uv.x * 2.5 + 0.5) - 0.5;
    vec2 pv = vec2(smoothstep(0.1, 0.0, abs(uv.x)) * 0.7 + smoothstep(0.08, 0.0, abs(st)) * 0.3, st);
#elif LEAF_TYPE == 6
    // petals: fine parallel veins that fan from the claw
    float st = fract(uv.x * 4.0 + 0.5) - 0.5;
    vec2 pv = vec2(smoothstep(0.1, 0.0, abs(uv.x)) * 0.35 + smoothstep(0.1, 0.0, abs(st)) * 0.22, st);
#else
    float st = fract(uv.x * 3.0 + 0.5) - 0.5;
    vec2 pv = vec2(smoothstep(0.12, 0.0, abs(uv.x)) + smoothstep(0.1, 0.0, abs(st)) * 0.5, st);
#endif
    vein = pv.x; cellPos = pv.y;
#if LEAF_TYPE < 4
    // bites and tears: a few leaves have been eaten, from the margin inward
    // (grass and palm leaflets are left whole: with no discard anywhere in their shader the GPU can skip every hidden pixel)
    float tear = nA.r * 0.7 + nB.g * 0.3 + smoothstep(0.45, 0.0, edge) * 0.2;
    float tearT = mix(0.8, 2.0, step(0.14, fract(seed * 13.7)));
    if (tear > tearT) discard;
    edge = min(edge, (tearT - tear) * 5.0);
#endif
  }
#ifdef SHADOW_PASS
  gl_FragColor = vec4(1.0);
#else
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 Ng = normalize(vNormal);
  float facing = gl_FrontFacing ? 1.0 : -1.0;
  bool underside = !gl_FrontFacing;
  vec3 N = Ng * facing;

  // ---------------------------------------------------------------- relief
  if (!stalk) {
    // veins are ridges underneath, grooves on top; the tissue between them bulges (quilting)
    float quilt = cos(cellPos * 6.2831853) * 0.5;
    float hgt = (vein * 0.8 + gNet * 0.35 - quilt * 0.35) * (gl_FrontFacing ? -1.0 : 1.0) + nB.g * 0.3 + nB.a * 0.25;
    vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
    float dhx = dFdx(hgt), dhy = dFdy(hgt);
    vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
    float dt = dot(dpx, r1);
    vec3 grad = (r1 * dhx + r2 * dhy) * sign(dt);
    float bumpK = 0.0022 * (1.0 - vPress * 0.5);
    N = normalize(abs(dt) * N - bumpK * grad);
  }

  // ---------------------------------------------------------------- pigment
#if LEAF_TYPE == 0
  vec3 base = vec3(0.022, 0.085, 0.018), veinC = vec3(0.09, 0.20, 0.045), transC = vec3(0.30, 0.58, 0.05);
  float rough = 0.26;
#elif LEAF_TYPE == 1
  vec3 base = vec3(0.06, 0.17, 0.022), veinC = vec3(0.05, 0.11, 0.02), transC = vec3(0.50, 0.78, 0.07);
  float rough = 0.42;
  base = mix(base, vec3(0.12, 0.26, 0.03), smoothstep(0.55, 1.0, vAux.x) * 0.7);   // young growth at the tip of the frond
#elif LEAF_TYPE == 2
  vec3 base = vec3(0.03, 0.105, 0.026), veinC = vec3(0.12, 0.24, 0.09), transC = vec3(0.34, 0.64, 0.07);
  float rough = 0.3;
#elif LEAF_TYPE == 3
  vec3 base = vec3(0.04, 0.13, 0.022), veinC = vec3(0.12, 0.24, 0.05), transC = vec3(0.42, 0.70, 0.06);
  float rough = 0.24;
  {
    // variegation: pale islands that respect the veins a little
    float vg = nA.g + nB.r * 0.35 - abs(cellPos) * 0.12;
    float amt = smoothstep(0.62, 0.74, vg) * step(0.45, fract(seed * 5.3));
    base = mix(base, vec3(0.42, 0.46, 0.13), amt * 0.85);
    transC = mix(transC, vec3(0.9, 0.85, 0.3), amt * 0.7);
  }
#elif LEAF_TYPE == 4
  vec3 base = vec3(0.05, 0.12, 0.04), veinC = vec3(0.26, 0.34, 0.16), transC = vec3(0.40, 0.66, 0.10);
  float rough = 0.36;
#elif LEAF_TYPE == 6
  // flowers — the only strong colour in the garden. vAux.x: 0 petal, 1 lip / heart / rachis. vTint.y picks the species.
  vec3 base, veinC, transC;
  float rough = 0.55;
  float part = vAux.x;
  if (vTint.y < -0.5) {
    base = mix(vec3(0.62, 0.61, 0.54), vec3(0.6, 0.4, 0.04), part);                    // jasmine: milk white, a yellow eye
    base = mix(base, vec3(0.5, 0.55, 0.3), smoothstep(0.3, 0.0, uv.y) * 0.4);
  } else if (vTint.y > 0.5) {
    base = mix(vec3(0.5, 0.03, 0.01), vec3(0.62, 0.42, 0.03), smoothstep(0.5, 0.95, uv.y) + smoothstep(0.75, 1.0, abs(uv.x)) * 0.5);   // heliconia: red, yellow-lipped
  } else {
    base = mix(vec3(0.66, 0.62, 0.6), vec3(0.42, 0.02, 0.17), part);                   // orchid: white, a magenta lip
    base = mix(base, vec3(0.5, 0.16, 0.34), smoothstep(0.4, 0.0, uv.y) * (1.0 - part) * 0.55);
    base = mix(base, vec3(0.5, 0.1, 0.3), smoothstep(0.5, 0.9, nB.g) * (1.0 - part) * 0.25 * smoothstep(0.7, 0.2, uv.y));   // freckles
  }
  base *= 0.62;                       // (in full sun a petal is still a petal, not a lamp)
  veinC = base * 0.6;
  transC = base * 1.25 + vec3(0.03, 0.0, 0.0);
#else
  vec3 base = vec3(0.028, 0.095, 0.022), veinC = vec3(0.06, 0.15, 0.03), transC = vec3(0.32, 0.62, 0.06);
  float rough = 0.3;
#endif
  vec3 alb = base;
  // leaf-to-leaf variation
  alb *= 0.7 + 0.5 * vTint.x;
#if LEAF_TYPE != 6
  alb = mix(alb, alb * vec3(1.5, 1.12, 0.6), max(vTint.y, 0.0) * 0.5);        // toward yellow-green
  alb = mix(alb, alb * vec3(0.7, 0.98, 1.2), max(-vTint.y, 0.0) * 0.5);       // toward blue-green
#endif
  alb *= 0.84 + 0.32 * nA.g;                                                   // blotchy chlorophyll
  float veinAmt = stalk ? 0.0 : vein;
  if (underside) {
#if LEAF_TYPE == 2
    alb = mix(alb, vec3(0.05, 0.022, 0.03), 0.6);                               // wine-dark underside
#else
    alb = alb * vec3(1.05, 1.1, 0.95) * 1.25 + 0.006;                           // paler, matte
#endif
    rough = min(1.0, rough + 0.25);
  }
  float netAmt = stalk ? 0.0 : gNet;
  alb = mix(alb, veinC * (0.7 + 0.6 * vTint.x), max(veinAmt * 0.75, netAmt * 0.45));
  // senescence: yellowing, then brown and dry from the margin inward
  float sen = vTint.z;
  float yel = smoothstep(0.72, 1.0, sen + (nA.r - 0.5) * 0.4);
  alb = mix(alb, vec3(0.24, 0.22, 0.03) * (0.8 + 0.4 * nB.g), yel * 0.7);
  float brown = smoothstep(0.1, 0.0, edge - sen * 0.16 + (0.5 - nB.g) * 0.12) * smoothstep(0.25, 0.7, sen + nA.g * 0.3);
  brown = max(brown, smoothstep(0.022, 0.0, edge) * 0.35);
  alb = mix(alb, vec3(0.07, 0.04, 0.016) * (0.7 + 0.8 * nB.r), brown);
  transC = mix(transC, vec3(0.7, 0.55, 0.06), yel * 0.7);
  transC = mix(transC, vec3(0.2, 0.09, 0.02), brown);
  rough = mix(rough, 0.8, brown);
  if (stalk) {
    alb = mix(vec3(0.05, 0.11, 0.025), vec3(0.09, 0.07, 0.03), nB.g) * (0.6 + 0.6 * vTint.x);
    transC = vec3(0.1, 0.2, 0.02);
    rough = 0.5;
  }

  // ---------------------------------------------------------------- light
  vec3 L = SUN_DIR;
  float NdL = dot(N, L);
  vec3 ray = vWorld - cameraPosition;
  float q = paneQ(cameraPosition, vWorld);
  float dBehind = length(ray) * q;
  vec3 Ps = vWorld + L * 0.03 + Ng * sign(dot(Ng, L)) * 0.012;
  float vis = dBehind < 0.9 ? shadowHard(Ps) : shadow1(Ps);
  float shadeSide = smoothstep(HW - 0.3, HW + 0.3, vWorld.x) * smoothstep(ZE - 1.5, ZE + 0.5, vWorld.z);
  vis *= mix(1.0, uSunScale, shadeSide);                             // the far side sits in the shade of this one
  // the leaves laid on the sunlit panes are never left entirely in the dark: some sun always finds a way through
  vis = max(vis, 0.5 * step(2.5, vSeed.w) * (1.0 - shadeSide));
  float ao = vTint.w;
  vec3 sun = SUN_COL * vis;
  vec3 amb = mix(uBounce, uSky, 0.5 + 0.5 * N.y) * ao;
  vec3 col = alb * (sun * max(NdL, 0.0) * 0.55 + amb);
  // translucency: light through the blade. Veins and thick tissue hold it back; the leaf pressed on glass glows evenly.
  // (the areoles between the finest veins, the thicker tissue along the midrib, blotches of denser chlorophyll)
  float cells = texture2D(tNoise, uv * vec2(4.7, 7.9) + vSeed.yx * 5.0).a;
  float thick = (1.0 - 0.55 * veinAmt) * (1.0 - 0.62 * netAmt) * (0.56 + 0.42 * nB.a + 0.4 * cells) * mix(0.8, 1.0, smoothstep(0.0, 0.4, au)) * (0.78 + 0.44 * nA.g);
  transC = mix(transC, transC * vec3(1.25, 1.05, 0.7), smoothstep(0.35, 0.0, edge) * 0.6);      // thinner, yellower toward the margin
  float tr = max(-NdL, 0.0) * 0.62 + 0.14;
  col += transC * sun * tr * thick * 0.082 * (underside ? 0.85 : 1.0);
  // the sky comes through the blade as well: this is why a leaf in shade is still green and not black
  // (on the sunlit side that sky is the bright warm haze around the sun)
  col += transC * mix(vec3(0.5, 0.42, 0.26), mix(uBounce, uSky, 0.75) * 0.5, shadeSide) * thick * (0.25 + 0.75 * ao) * 0.56;
  // lying on the glass, a leaf is wet where it touches: deeper, and nothing of the sky left to mirror
  col = mix(col, col * vec3(0.82, 1.0, 0.7), vPress * 0.6);
  // waxy cuticle + water
  float wet = 0.35 + 0.65 * smoothstep(0.4, 0.7, nA.r + vSeed.y * 0.3);
  float r = clamp(rough * mix(1.0, 0.55, wet) + (nB.r - 0.5) * 0.12, 0.08, 1.0);
  vec3 H = normalize(L + V);
  float NdH = max(dot(N, H), 0.0), NdV = max(dot(N, V), 1e-3);
  float a2 = r * r * r * r;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * dd * dd);
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  col += sun * D * F * max(NdL, 0.0) * 0.25 * (1.0 - vPress);
  vec3 R = reflect(-V, N);
  vec3 skyR = mix(uBounce * 0.6, uSky * 1.6, smoothstep(-0.2, 0.6, R.y));
  float Fv = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  col += skyR * Fv * (1.0 - r) * ao * 0.9 * (1.0 - vPress);

  // ---------------------------------------------------------------- air
  float hz = 1.0 - exp(-dBehind * uHazeDensity);
  vec3 rd = normalize(ray);
  vec3 hazeC = hazeColor(rd, uHaze);
  col = mix(col, hazeC, hz);
  gl_FragColor = vec4(max(col, 0.0), q);
#endif
}`;

export const LEAF_TYPES = { monstera: 0, monsteraLo: 0, fern: 1, fernLo: 1, paddle: 2, paddleLo: 2, heart: 3, blade: 4, palm: 5, palmLo: 5, orchid: 6, bloom: 6, heliconia: 6 };

/** Returns { material, shadowMaterial } for a leaf form. `shared` holds the uniforms common to the whole garden. */
export function makeLeafMaterials(type, shared) {
  const mk = (shadow) =>
    new THREE.ShaderMaterial({
      vertexShader: LEAF_VERT,
      fragmentShader: LEAF_FRAG,
      defines: shadow ? { LEAF_TYPE: type, SHADOW_PASS: 1 } : { LEAF_TYPE: type },
      uniforms: shared,
      side: THREE.DoubleSide,
      colorWrite: !shadow,
    });
  return { material: mk(false), shadowMaterial: mk(true) };
}

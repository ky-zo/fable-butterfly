// The water itself: a camera-centred polar mesh carrying the long waves, shaded per pixel with the full analytic
// wave sum (filtered by pixel footprint, so the horizon never shimmers), a mirrored sky, the moon's glitter,
// light coming through the crests, drowned layers of text underneath and the far field of the writing on top.

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { FSPass } from '../../core/Pass.js';
import { SEA_GLSL } from './waves.js';
import { COMMON_GLSL, NOISE_GLSL } from './shared.js';
import { LAND_GLSL } from './shore.js';
import { shadowGLSL } from '../../shared/butterfly/index.js';

/** Tileable chop: gradient (rg) and height (b) of a sum of integer-frequency plane waves. */
export function makeChopTexture(ctx) {
  const size = 512;
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    generateMipmaps: true,
    depthBuffer: false,
  });
  rt.texture.anisotropy = 2;
  ctx.track(rt);
  const pass = new FSPass(
    /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    ${hash}
    void main(){
      vec2 g = vec2(0.0);
      float h = 0.0;
      for (int i = 0; i < 30; i++) {
        float fi = float(i);
        vec2 r = hash21(fi * 7.31 + 1.7);
        float ang = r.x * 6.2831853;
        float m = 3.0 + floor(r.y * r.y * 24.0);
        vec2 kv = floor(vec2(cos(ang), sin(ang)) * m + 0.5);
        float ph = hash11(fi * 3.7 + 0.3) * 6.2831853;
        float a = 1.0 / (1.0 + 0.9 * length(kv));
        float arg = 6.2831853 * dot(kv, vUv) + ph;
        h += a * cos(arg);
        g -= a * sin(arg) * kv;
      }
      gl_FragColor = vec4(clamp(g * 0.045 + 0.5, 0.0, 1.0), h * 0.12 + 0.5, 1.0);
    }`,
    {},
  );
  pass.render(ctx.renderer, rt);
  pass.dispose();
  return rt.texture;
}

/** Polar grid: dense in the forward sector, sparse behind. Attribute = (radial t, cos a, sin a). */
export function makeSeaGeometry(ctx, rings, front, back, frontHalfAngle) {
  const angles = [];
  for (let j = 0; j <= front; j++) angles.push(-frontHalfAngle + (2 * frontHalfAngle * j) / front);
  const rest = Math.PI * 2 - 2 * frontHalfAngle;
  for (let j = 1; j < back; j++) angles.push(frontHalfAngle + (rest * j) / back);
  const na = angles.length;
  const pos = new Float32Array(na * rings * 3);
  let o = 0;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    for (let j = 0; j < na; j++) {
      pos[o++] = t;
      pos[o++] = Math.cos(angles[j]);
      pos[o++] = Math.sin(angles[j]);
    }
  }
  const idx = new Uint32Array(na * (rings - 1) * 6);
  o = 0;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < na; j++) {
      const j1 = (j + 1) % na;
      const a = i * na + j;
      const b = i * na + j1;
      const c = (i + 1) * na + j;
      const d = (i + 1) * na + j1;
      idx[o++] = a;
      idx[o++] = c;
      idx[o++] = b;
      idx[o++] = b;
      idx[o++] = c;
      idx[o++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  ctx.track(geo);
  return { geo, step: (2 * frontHalfAngle) / front };
}

const VERT = /* glsl */ `
precision highp float;
uniform vec2 uFwd;
uniform float uR0, uRL, uTime;
varying vec2 vBase;
varying vec3 vWorld;
${NOISE_GLSL}
${SEA_GLSL}
void main(){
  float r = uR0 * (exp(uRL * position.x) - 1.0);
  vec2 rt = vec2(-uFwd.y, uFwd.x);
  vec2 b = uCam.xz + r * (uFwd * position.y + rt * position.z);
  float dist = length(vec3(b.x, 0.0, b.y) - uCam);
  vec3 P, N, Ta, Tb;
  float J;
  seaEval(b, uTime, dist, P, N, Ta, Tb, J);
  vBase = b;
  vWorld = P;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vBase;
varying vec3 vWorld;
uniform float uTime, uTile, uDeepOn;
uniform sampler2D tTile;
uniform sampler2D tChop;
${hash}
${NOISE_GLSL}
${SEA_GLSL}
${COMMON_GLSL}
${LAND_GLSL}
// the butterfly over the water: the kit's shadow function asks what a ray from a point of the surface meets of its
// wings. Along the mirrored line of sight that is its image in the water. (Along the ray to the moon it would be its
// moon-shadow: but the moon is three degrees up, so the shadow of an animal a hand above the water falls metres
// behind the lens, and it is the shadow of clear wings. It was worked out for every pixel and never once seen; it
// is not worked out any more.)
uniform vec4 uSlick;           // a patch of water with no wind on it: base x, base z, radius (m), how flat
vec3 gBfDir;
${shadowGLSL('gBfDir')}

// One octave of the far-field glitter. A world-anchored cell holds some number of letters too small to draw;
// lam is how many of them are expected to be at the mirror angle right now. Few: the cell flashes rarely, as a
// point. Many: it is nearly always lit and fills out, and the path closes up into a sheen.
float sparkCell(vec2 b, vec2 cs, float lam, float t){
  vec2 q = b / cs;
  vec2 id = floor(q);
  vec3 r = hash32(id + cs.x * 91.7 + cs.y * 13.1);
  float f = 1.0 - exp(-lam);
  float tri = abs(fract(t * (0.30 + r.x * 0.85) + r.y * 17.0) * 2.0 - 1.0);
  float on = smoothstep(1.0 - f, 1.0 - f * 0.55, tri);
  vec2 fq = fract(q) - 0.5 - (r.yz - 0.5) * 0.4 * (1.0 - f);
  float m = 1.0 - smoothstep(0.05 + 0.3 * f, 0.30 + 0.6 * f, length(fq));
  // one letter at the mirror angle is a hard point of light, dimmer the more water its cell has to stand for;
  // a cell full of them is exactly as bright as the odds allow
  return on * m * min(16.0, 0.56 / (cs.x * cs.y)) * max(1.0, lam);
}

void main(){
  vec2 b = vBase;
  vec3 tc = uCam - vWorld;
  float dist = length(tc);
  vec3 V = tc / dist;
  vec2 dbx = dFdx(b), dby = dFdy(b);

  // ---- the long waves, per pixel, each filtered by how much of its phase one pixel spans
  float hx = 0.0, hz = 0.0, sxx = 0.0, szz = 0.0, sxz = 0.0, var = 0.0, hgt = 0.0;
  vec2 bw = seaWarp(b, uTime);
  for (int i = 0; i < NW; i++) {
    vec4 w = WV[i];
    float fp = w.z * (abs(dot(dbx, w.xy)) + abs(dot(dby, w.xy)));
    float fd = 1.0 - smoothstep(0.55, 2.3, fp);
    float A = w.w * uSteep;
    float ka = w.z * A;
    var += (1.0 - fd * fd) * ka * ka * 0.5;
    if (fd <= 0.0) continue;
    float ph = w.z * dot(w.xy, i >= WARP_FROM ? bw : b) - WT[i].x * uTime + WT[i].y;
    float s = sin(ph), c = cos(ph);
    ka *= fd;
    hgt += A * fd * c;
    hx += ka * w.x * s;
    hz += ka * w.y * s;
    sxx += ka * w.x * w.x * c;
    szz += ka * w.y * w.y * c;
    sxz += ka * w.x * w.y * c;
  }
  vec2 rg;
  float ring = clamp(seaRipple(b, rg) * 34.0, 0.0, 1.0);
  hx -= rg.x;
  hz -= rg.y;
  float J = (1.0 - sxx) * (1.0 - szz) - sxz * sxz;
  vec3 Ng = normalize(vec3(hx * (1.0 - szz) + hz * sxz, J, hz * (1.0 - sxx) + hx * sxz));

  // ---- chop: sheets of tileable wave noise at several scales, sliding over one another.
  // The wind does not blow evenly: gusts roughen some patches and leave others glassy. What a pixel is too far
  // away to resolve (the mip chain averages it out of the normal) goes into the roughness of the moon's lobe instead.
  vec2 wq = vec2(dot(b, vec2(0.98, -0.2)), dot(b, vec2(0.2, 0.98)));
  float gust = 0.40 + 1.15 * smoothstep(0.22, 0.78, noise4(wq * vec2(0.034, 0.013) + vec2(uDrift * 0.6, 4.2)).a);
  float dgain = (0.8 + 0.5 * uBreak) * gust;
  // (where the water has gone flat it is a mirror, and what is over it is seen in it whole)
  vec2 sk = b - uSlick.xy;
  dgain *= 1.0 - uSlick.w * (0.35 + 0.57 * exp(-dot(sk, sk) / (uSlick.z * uSlick.z)));
  float fpl = length(dbx) + length(dby);     // metres of sea under one pixel, the long way
  float cx = 0.0, cz = 0.0;
  if (dist < 500.0) {
    vec2 n0 = texture2D(tChop, bw * 0.118 - vec2(0.012, 0.047) * uTime).rg - 0.5;                  // 0.3 – 2.8 m
    vec2 n1 = texture2D(tChop, b * 0.47 + vec2(0.021, 0.034) * uTime).rg - 0.5;                    // 8 – 70 cm
    vec2 n2 = texture2D(tChop, vec2(b.y, -b.x) * 1.63 + vec2(-0.05, 0.027) * uTime).rg - 0.5;      // 2 – 20 cm
    float nc = dgain * (1.0 - smoothstep(300.0, 500.0, dist));
    cx += (n0.x * 0.62 + n1.x * 0.40 + n2.y * 0.30) * nc;
    cz += (n0.y * 0.62 + n1.y * 0.40 - n2.x * 0.30) * nc;
  }
  var += dgain * dgain * (0.0110 * smoothstep(0.15, 1.6, fpl) + 0.0046 * smoothstep(0.04, 0.4, fpl) + 0.0026 * smoothstep(0.01, 0.12, fpl));
  // further out the long waves alone would comb the moon's path into a regular lattice: a wide sheet of the
  // same wave noise, moving downwind, keeps the sea irregular
  float midW = smoothstep(22.0, 120.0, dist);
  if (midW > 0.0) {
    vec2 n3 = texture2D(tChop, b * 0.027 - vec2(0.008, 0.039) * uTime).rg - 0.5;
    vec2 n4 = texture2D(tChop, vec2(-b.y, b.x) * 0.0061 + vec2(0.013, -0.004) * uTime).rg - 0.5;
    cx += (n3.x * 0.50 - n4.y * 0.42) * midW;
    cz += (n3.y * 0.50 + n4.x * 0.42) * midW;
  }
  float tx = hx + cx, tz = hz + cz;
  vec3 N = normalize(vec3(tx * (1.0 - szz) + tz * sxz, max(J, 0.12), tz * (1.0 - sxx) + tx * sxz));

  // ---- optics
  float NoV = max(dot(N, V), 0.025);
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.004;
  R = normalize(R);
  // the land ahead: where the mirrored ray runs into the slope the water shows that instead of the sky, and where
  // the slope stands between the water and the moon there is no moon on it (the moon's glow is wide: a soft edge)
  float open = 1.0, moonV = 1.0;
  if (uLand > 0.002) {
    open = mix(1.0, landClear(vWorld, R, 0.010), uLand);
    // (the last of it is slow to go: the glow around a moon that has just set still finds the water)
    moonV = mix(1.0, 0.26 + 0.74 * landClear(vWorld, uMoonDir, 0.034), uLand);
  }
  vec3 refl = skyGlow(R) * (0.05 + 0.95 * open);
  // the butterfly: its image (the sky it hides), right under it
  const float shLit = 1.0;
  float rfLit = 1.0;
  vec3 hd = vWorld - uBfPos;
  if (uBfWing.z > 0.0 && hd.y < 0.0 && dot(hd.xz, hd.xz) < 0.5 + 4.0 * hd.y * hd.y) {
    gBfDir = R;
    rfLit = bfShadow(vWorld);
    // (its image: wings lit from behind, as the water under them sees them. The film stops little light but
    // it is what the image is made of: it is given more weight here than it has in a shadow.)
    float im = 1.0 - rfLit;
    rfLit = 1.0 - clamp(im * 1.6 + smoothstep(0.02, 0.09, im) * 0.5, 0.0, 1.0);
    // (where the water has gone flat the image is the animal itself, mirrored — hero.js — and this pale one stands down)
    refl = mix(uMoonCol * vec3(0.66, 0.6, 0.54), refl, mix(rfLit, 1.0, uSlick.w));
  }
  float road = moonRoad(Ng, V) * moonV;

  // moon on the water: Beckmann lobe whose width soaks up every wave the pixel could not resolve
  vec3 H = normalize(V + uMoonDir);
  float NoH = max(dot(N, H), 0.0);
  float nvar = dot(dFdx(N), dFdx(N)) + dot(dFdy(N), dFdy(N));
  float a2 = 0.0035 + 2.0 * var + min(0.05, 0.9 * nvar);
  float c2 = NoH * NoH;
  float t2 = (1.0 - c2) / max(c2, 1e-4);
  float D = exp(-t2 / a2) / (3.14159 * a2 * c2 * c2 + 1e-5);
  float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  // close to the lens the water keeps only a dim, broken image of the moon: there the glitter is left to the letters
  float specGain = mix(0.34, 1.0, smoothstep(40.0, 520.0, dist));
  float specL = min(Fh * D / (4.0 * NoV + 0.35) * 0.26, 60.0) * specGain;
  // …and that image is not a smear of light. Seen from close, it is set in small print: the finest layer of the
  // writing, too faint to notice anywhere else, shows wherever the moon lies on the water.
  if (specL > 0.004 && dist < 70.0) {
    vec2 um = vec2(b.x * 0.951 - b.y * 0.309, b.y * 0.951 + b.x * 0.309) * 3.3 / uTile + vec2(0.13, 0.57) + vec2(0.0007, -0.0004) * uTime;
    float gm = (length(dbx) + length(dby)) * 0.5 * 3.3 / uTile;
    float cm = textureGrad(tTile, um, vec2(gm, 0.0), vec2(0.0, gm)).r;
    specL *= mix(cm * 5.0 + 0.10, 1.0, smoothstep(14.0, 70.0, dist));
  }
  vec3 spec = uMoonCol * specL * shLit * (0.15 + 0.85 * rfLit) * moonV;
  // the lamp ashore, mirrored: a short warm streak toward the reader
  if (uLamp.w > 0.002) {
    vec3 Ll = uLamp.xyz - vWorld;
    float dl = length(Ll);
    Ll /= dl;
    vec3 Hl = normalize(V + Ll);
    float nhl = max(dot(N, Hl), 0.0);
    float cl2 = nhl * nhl;
    float al = 0.0018 + 1.3 * var + min(0.03, 0.5 * nvar);
    float Dl = exp(-(1.0 - cl2) / max(cl2, 1e-4) / al) / (3.14159 * al * cl2 * cl2 + 1e-5);
    spec += vec3(1.0, 0.50, 0.17) * uLamp.w * min(Dl * 0.006 / (1.0 + dl * dl * 0.0012), 2.0);
  }

  // body: ink-dark water, a cold glow where moonlight comes through the upper part of a wave towards the lens
  float crestH = clamp(hgt * 0.75 + 0.45, 0.0, 1.0);
  float toward = pow(max(dot(-V, uMoonDir), 0.0), 2.0);
  float facing = clamp(dot(normalize(V.xz + 1e-5), N.xz) * 2.2 + 0.35, 0.0, 1.0);
  vec3 body = vec3(0.0011, 0.0034, 0.0078) + vec3(0.004, 0.026, 0.040) * toward * crestH * crestH * facing * uMoonCol.b * 1.4;

  // drowned layers of text, seen through the surface along the refracted ray
  vec3 T = refract(-V, N, 0.752);
  float tyi = 1.0 / max(-T.y, 0.12);
  vec3 deep = vec3(0.0);
  if (uDeepOn > 0.5 && dist < 70.0 && F < 0.62) {
    float fadeD = (1.0 - smoothstep(35.0, 70.0, dist)) * smoothstep(uDeepOn > 1.5 ? 6.0 : 2.0, uDeepOn > 1.5 ? 10.0 : 5.0, dist);   // up close the drowned layers are drawn letter by letter instead
    float p1 = (0.55 + vWorld.y) * tyi;
    vec2 h1 = vWorld.xz + T.xz * p1;
    vec2 u1 = (vec2(h1.x * 0.966 + h1.y * 0.259, h1.y * 0.966 - h1.x * 0.259) * 0.9 + vec2(3.7, 9.1) + vec2(0.012, -0.02) * uTime) / uTile;
    float gfp = (length(dbx) + length(dby)) * 0.5 / uTile;
    float g1 = gfp * 0.4 + 0.0003;
    float c1 = textureGrad(tTile, u1, vec2(g1, 0.0), vec2(0.0, g1)).r;
    float p2 = (1.9 + vWorld.y) * tyi;
    vec2 h2 = vWorld.xz + T.xz * p2;
    vec2 u2 = (vec2(h2.x * 0.978 - h2.y * 0.208, h2.y * 0.978 + h2.x * 0.208) * 0.72 + vec2(17.3, 4.4) + vec2(-0.016, 0.009) * uTime) / uTile;
    float g2 = gfp * 0.5 + 0.0007;
    float c2d = textureGrad(tTile, u2, vec2(g2, 0.0), vec2(0.0, g2)).r;
    deep = (c1 * exp(-p1 * 0.6) * vec3(0.030, 0.052, 0.080) + c2d * exp(-p2 * 0.45) * vec3(0.016, 0.034, 0.058)) * fadeD * (0.06 + 0.94 * road);
  }

  vec3 col = (body + deep) * (1.0 - F) + refl * F + spec;

  // ---- the writing, where it is too small to be drawn letter by letter
  float tip;
  float lodw = glyphLod(vWorld, Ng, tip);
  float farW = 1.0 - lodw;
  float up = seaUp(hgt);
  float crest = 1.0 - smoothstep(0.34, 0.80, J);
  float brk = breaking(b, J);
  float warm = recallWarm(b);
  vec2 ds = mirrorDelta(Ng, V);
  float m2 = dot(ds, ds);
  float frac = 0.5, cov = 0.0;
  // (close to the lens every letter is drawn as itself and none of this is wanted: most of a low shot is such water)
  if (farW > 0.004 || crest > 0.01 || brk > 0.01) {
    float dens = textDensity(b, dist);
    frac = clamp(textFrac(dens, up) * 1.1 - 0.03, 0.0, 1.0);
    cov = texture2D(tTile, b / uTile).r;
    float bunch = 1.0 / clamp(J, 0.4, 1.0);
    // drawn letters lean up towards the reader and so cover more of the screen than flat print would: match that
    float sg = clamp(dot(V, Ng), 0.02, 1.0);
    float lean = min(TIPK, sin(min(asin(sg) + tip, 1.5708)) / sg);
    float covFar = clamp(cov * frac * bunch * lean, 0.0, 1.0) * farW;
    // froth of small print along sharpening crests
    float froth = 0.0;
    if (crest > 0.01 || brk > 0.01) {
      vec2 uf = b * 2.3 / uTile + vec2(0.37, 0.11);
      float gf = (length(dbx) + length(dby)) * 0.5 * 2.3 / uTile;
      vec2 ug = vec2(b.x * 0.94 + b.y * 0.34, b.y * 0.94 - b.x * 0.34) * 4.1 / uTile + vec2(0.71, 0.29);
      float fine = textureGrad(tTile, uf, vec2(gf, 0.0), vec2(0.0, gf)).r + textureGrad(tTile, ug, vec2(gf * 1.8, 0.0), vec2(0.0, gf * 1.8)).r;
      froth = min(fine, 1.0) * max(crest * (0.35 + 0.65 * dens) * (0.55 + 0.6 * uBreak), brk * 1.3);
      crest = max(crest, brk * 0.8);
    }
    vec3 lit = (letterLit(Ng, crest, up) + uMoonCol * BONE * exp(-m2 / (GS2 + 0.05)) * 0.55) * (0.25 + 0.75 * shLit);
    lit = mix(lit, AMBER * (0.4 + 0.5 * warm), clamp(warm * 0.8, 0.0, 1.0)) + mix(BONE, AMBER, 0.6) * ring * 0.55;
    // the writing shows where the moon lies on the water, and where it is being remembered; nowhere else.
    // (the froth of a breaking crest is paler than the night whatever the moon does)
    float show = max(road, clamp(warm, 0.0, 1.0));
    col = mix(col, lit, clamp(covFar * show + froth * (0.4 + 0.6 * farW) * max(show, 0.22 * uBreak), 0.0, 1.0));
  }
  // (what is being remembered is its own light: it lies on the water around it)
  col += AMBER * (warm * 0.006 + ring * 0.026 + wakeWarm(b) * 0.014) * (1.0 - F);

  // far glitter: letters too small to see, still flashing one by one
  float pm = exp(-m2 / 0.055);               // chance that a letter's own tilt closes the gap to the mirror angle
  if (farW > 0.01 && pm > 0.012) {
    float fpx = dist / uPpm;
    float fpz = abs(dby.y) + abs(dbx.y) + abs(dby.x) * 0.3;
    float lx = log2(max(fpx * 2.6, 0.02));
    float lz = log2(max(fpz * 1.7, 0.02));
    float fx = fract(lx), fz = fract(lz);
    vec2 c0 = exp2(vec2(floor(lx), floor(lz)));
    float lam = c0.x * c0.y * 60.0 * (0.15 + 0.85 * frac) * 0.10 * pm;   // 60 letters to the square metre
    float sp = mix(mix(sparkCell(b, c0, lam, uTime), sparkCell(b, c0 * vec2(2.0, 1.0), lam * 2.0, uTime), fx),
                   mix(sparkCell(b, c0 * vec2(1.0, 2.0), lam * 2.0, uTime), sparkCell(b, c0 * 2.0, lam * 4.0, uTime), fx), fz);
    col += uMoonCol * farW * sp * shLit * moonV;
  }

  // ---- air
  float fog = 1.0 - exp(-dist / 2600.0);
  fog = fog * fog * (3.0 - 2.0 * fog);
  if (fog > 0.004) col = mix(col, skyGlow(normalize(vec3(-V.x, 0.0, -V.z))), clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeSeaMaterial(ctx, uniforms) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  ctx.track(mat);
  return mat;
}

// Spindrift: letters torn off breaking crests. Entirely stateless — every particle's whole life is a pure
// function of time, so the journey can jump or run backwards. Clusters of particles share a burst: each cycle a
// cluster picks a stretch of crest; if the sea is steep enough there at that moment, its letters tear loose,
// are thrown up and forward with the crest, and then the wind has them: they tumble, thin out and are gone.
// With them goes a breath of mist (print too fine to see), which the low moon lights from behind.
// A few letters never come down: they keep rising and join the sky.

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { SEA_GLSL } from './waves.js';
import { COMMON_GLSL, NOISE_GLSL } from './shared.js';
import { CELL_EM } from './atlas.js';

const VERT = /* glsl */ `
precision highp float;
attribute vec4 aS0;   // home x, home z, cluster phase, cycle seconds
attribute vec4 aS1;   // rand, rand, rand, atlas index
attribute vec4 aS2;   // cluster id, em, delay in burst, kind (0 letter, 1 riser, 2 mist; +4: anchored over the shoal)
uniform float uTime, uSprayTile, uRise;
uniform vec2 uAtlas, uFwd;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vQ;      // quad coordinate, erosion (letters) or -1 (mist)
${hash}
${NOISE_GLSL}
${SEA_GLSL}
${COMMON_GLSL}

vec3 rotAxis(vec3 v, vec3 k, float a){
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

void main(){
  vUv = vec2(0.0); vCol = vec4(0.0); vQ = vec3(0.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);

  float cyc = aS0.w;
  float tt = uTime / cyc + aS0.z;
  float n = floor(tt);
  float tb = (n - aS0.z) * cyc;                      // when this cluster's current cycle began
  vec2 jit = hash22(vec2(aS2.x * 1.37 + 3.1, n * 0.731 + 11.0));
  vec3 rr = aS1.xyz;
  float kind = aS2.w;
  bool shoal = kind > 3.5;
  if (shoal) kind -= 4.0;

  vec3 pos, Uq, Wq;
  float alpha, erode = 0.0, bright = 1.0, size = aS2.y * ${CELL_EM.toFixed(5)};

  if (kind < 0.5 || kind > 1.5) {
    bool mist = kind > 1.5;
    // (a life has to end before its cluster's next cycle begins)
    float life = min(mist ? 3.4 + 2.6 * rr.x : 1.7 + 3.6 * rr.x, cyc - aS2.z - 0.05);
    float t0 = tb + aS2.z;
    float age = uTime - t0;
    if (age < 0.0 || age > life) return;
    // mostly the middling waves, which are always near; the big swell's crest, when it comes, throws the most
    int wi = jit.x < 0.24 ? 0 : jit.x < 0.54 ? 1 : jit.x < 0.86 ? 2 : 3;
    vec4 w = WV[wi];
    vec2 along = vec2(-w.y, w.x);
    vec2 home = aS0.xy + (jit - 0.5) * (shoal ? 3.0 : 9.0) + along * ((rr.y - 0.5) * 5.2) + w.xy * ((rr.z - 0.5) * 0.45);
    if (!shoal) home += uSprayTile * floor((uCam.xz - home) / uSprayTile + 0.5);
    // slide the birthplace onto the crest of that wave at the moment of birth
    float ph = w.z * dot(w.xy, home) - WT[wi].x * t0 + WT[wi].y;
    ph -= 6.2831853 * floor(ph / 6.2831853 + 0.5);
    home -= w.xy * (ph / w.z);
    float hd = length(home - uCam.xz);
    float edge = shoal ? 1.0 - smoothstep(34.0, 44.0, hd) : 1.0 - smoothstep(uSprayTile * 0.36, uSprayTile * 0.47, hd);
    // the wind carries everything towards and past the lens: what is born behind it is never seen
    if (edge <= 0.0 || dot(home - uCam.xz, uFwd) < -4.0) return;
    vec3 P0, N0, Ta, Tb;
    float J0;
    seaEval(home, t0, 0.0, P0, N0, Ta, Tb, J0);
    float thr = mix(0.56, shoal ? 1.02 : 0.90, uBreak);
    float brk = 1.0 - smoothstep(thr - 0.22, thr, J0);
    // away from the shoal a crest does not break along its whole length: stretches of it do, for a while
    if (!shoal) brk *= smoothstep(0.44, 0.60, noise4(home * 0.075 + vec2(t0 * 0.03, 7.3)).g);
    if (brk <= 0.01) return;
    // thrown up and forward with the crest, then the wind has it: light as paper, it hangs and drifts
    float cph = WT[wi].x / w.z;
    float cd = mist ? 0.8 : 0.85;
    float e = (1.0 - exp(-cd * age)) / cd;
    float vh = cph * (0.75 + 0.7 * rr.z);
    // some scraps the wind takes at once; others hang over the place they left
    float vw = mist ? 1.5 + 1.0 * rr.y : (fract(rr.x * 7.3) < 0.45 ? 1.0 + 1.3 * rr.y : 2.7 + 2.9 * rr.y);      // the wind outruns the waves
    float vy = (mist ? 0.35 + 0.9 * rr.x : 0.22 + 3.7 * rr.x * rr.x * rr.x) * (0.5 + 0.5 * brk) * (wi == 0 ? 1.25 : wi == 3 ? 0.7 : 1.0);
    float vt = mist ? 0.05 : 0.16 + 0.42 * rr.z;
    pos = P0 + vec3(w.x, 0.0, w.y) * ((vh - vw) * e + vw * age)
        + vec3(along.x, 0.0, along.y) * ((rr.y - 0.5) * 1.9 * e)
        + vec3(0.0, vy * e - vt * (age - e), 0.0);
    // the air is not still
    float tu = 0.08 + 0.15 * age;
    pos += tu * vec3(sin(age * 1.9 + rr.x * 50.0), sin(age * 1.5 + rr.y * 50.0) * 0.7, cos(age * 1.7 + rr.z * 50.0));
    float k = age / life;
    if (mist) {
      alpha = smoothstep(0.0, 0.25, k) * (1.0 - smoothstep(0.35, 1.0, k)) * brk * edge;
      size = aS2.y * (0.45 + 1.1 * k);
      erode = -1.0;
    } else {
      alpha = smoothstep(0.0, 0.10, age) * (1.0 - smoothstep(0.62, 1.0, k)) * min(brk * 1.6, 1.0) * edge;
      erode = smoothstep(0.25, 1.0, k);
      vec3 ax = normalize(rr - 0.5 + vec3(0.001));
      float ang = (1.0 - exp(-0.6 * age)) * (5.0 + 9.0 * rr.y) * (rr.z > 0.5 ? 1.0 : -1.0) + age * 0.7 + rr.x * 6.28;
      // it leaves the water lying on it, and only then starts to turn
      ang *= smoothstep(0.0, 0.5, age);
      Uq = rotAxis(normalize(Ta), ax, ang);
      Wq = rotAxis(normalize(cross(N0, Ta)), ax, ang);
      bright = 1.0 + 0.9 * brk;
    }
  } else {
    // risers: one long ascent per cycle
    float age = (tt - n) * cyc;
    float k = age / cyc;
    vec2 home = aS0.xy + (jit - 0.5) * 8.0;
    home += uSprayTile * floor((uCam.xz - home) / uSprayTile + 0.5);
    float hd = length(home - uCam.xz);
    float edge = 1.0 - smoothstep(uSprayTile * 0.34, uSprayTile * 0.47, hd);
    if (edge <= 0.0) return;
    vec3 P0, N0, Ta, Tb;
    float J0;
    seaEval(home, tb, 0.0, P0, N0, Ta, Tb, J0);
    float rise = 0.30 + 0.75 * rr.x;
    float h = rise * age * (1.0 + 0.010 * age);
    vec2 dr = vec2(0.20, 0.55) * age * 0.22 + 0.9 * vec2(sin(age * 0.21 + rr.y * 40.0), cos(age * 0.17 + rr.z * 40.0));
    pos = P0 + vec3(dr.x, h, dr.y);
    alpha = smoothstep(0.0, 2.5, age) * (1.0 - smoothstep(0.70, 1.0, k)) * edge * uRise;
    vec3 ax = normalize(rr - 0.5 + vec3(0.001));
    float ang = age * (0.25 + 0.5 * rr.y) + rr.x * 6.28;
    Uq = rotAxis(vec3(1.0, 0.0, 0.0), ax, ang * 0.6);
    Wq = rotAxis(vec3(0.0, 1.0, 0.0), ax, ang * 0.6);
    bright = 1.1 + 2.2 * smoothstep(2.0, 30.0, h);
  }

  vec3 tc = uCam - pos;
  float dist = length(tc);
  vec3 V = tc / dist;

  if (erode < -0.5) {
    // mist: a soft billboard, bright where it stands between the lens and the moon
    vec3 rt = normalize(cross(V, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(rt, V);
    vec3 wp = pos + (rt * position.x * 1.5 + up * position.y) * size;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    float fwd = max(dot(-V, uMoonDir), 0.0);
    float phase = 0.012 + 0.12 * pow(fwd, 6.0) + 0.5 * pow(fwd, 70.0);
    float nearFade = smoothstep(2.5, 9.0, dist);        // the lens never sits inside its own fog
    vCol = vec4(uMoonCol * phase, clamp(alpha, 0.0, 1.0) * 0.11 * nearFade);
    vQ = vec3(position.xy * 2.0, -1.0);
    return;
  }

  float px = size * uPpm / dist;
  float grow = max(1.0, 2.6 / px);                   // sub-pixel letters stay as mist: bigger, fainter
  alpha *= 1.0 / (grow * grow);
  vec3 wp = pos + (Uq * position.x + Wq * position.y) * size * grow;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);

  float col = mod(aS1.w, uAtlas.x), row = floor(aS1.w / uAtlas.x);
  vUv = (vec2(col, row) + vec2(position.x + 0.5, 0.5 - position.y)) / uAtlas;

  // a wet scrap of paper against the moon: it glows through when the light is behind it, and flashes when it
  // turns its face through the mirror angle
  vec3 Nq = normalize(cross(Uq, Wq));
  float ndl = abs(dot(Nq, uMoonDir));
  vec3 H = normalize(V + uMoonDir);
  float sp = pow(abs(dot(Nq, H)), 90.0);
  float through = pow(max(dot(-V, uMoonDir), 0.0), 3.0) * (1.0 - abs(dot(Nq, V)) * 0.6);
  float shade = 0.55 + 0.9 * fract(rr.x * 13.7);             // no two scraps are equally wet
  vec3 c = BONE * uMoonCol * (0.10 + 0.34 * ndl + 0.50 * through) * bright * shade + uMoonCol * sp * 20.0;
  alpha *= smoothstep(0.7, 1.9, dist);                        // nothing slaps the lens
  vCol = vec4(c, clamp(alpha, 0.0, 1.0));
  vQ = vec3(position.xy, erode);
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tAtlas;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vQ;
void main(){
  if (vQ.z < -0.5) {
    float g = exp(-dot(vQ.xy, vQ.xy) * 3.2) - 0.04;
    if (g <= 0.0) discard;
    float a = g * vCol.a;
    gl_FragColor = vec4(vCol.rgb * a, a * 0.9);         // laid over itself it thickens instead of adding up without end
    return;
  }
  float sd = texture2D(tAtlas, vUv).r;
  float aa = clamp(fwidth(sd) * 0.75, 0.004, 0.3);
  float thr = 0.5 + vQ.z * 0.2;
  float a = smoothstep(thr - aa, thr + aa, sd) * vCol.a;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol.rgb * a, a);
}`;

export function makeSpray(ctx, uniforms, atlas, chars, { clusters, members, puffs, risers, tile, shoal }) {
  const rnd = ctx.rng(77);
  const total = clusters * (members + puffs) + risers;
  const s0 = new Float32Array(total * 4);
  const s1 = new Float32Array(total * 4);
  const s2 = new Float32Array(total * 4);
  const glyphs = [];
  for (const ch of chars) {
    for (const face of ['r', 'i', 'm']) {
      const g = atlas.lookup(face, ch);
      if (g && g.index >= 0) glyphs.push(g.index);
    }
  }
  let n = 0;
  const put = (h, id, em, delay, kind) => {
    s0[n * 4] = h.x;
    s0[n * 4 + 1] = h.z;
    s0[n * 4 + 2] = h.phase;
    s0[n * 4 + 3] = h.cyc;
    s1[n * 4] = rnd();
    s1[n * 4 + 1] = rnd();
    s1[n * 4 + 2] = rnd();
    s1[n * 4 + 3] = glyphs[Math.floor(rnd() * glyphs.length)];
    s2[n * 4] = id;
    s2[n * 4 + 1] = em;
    s2[n * 4 + 2] = delay;
    s2[n * 4 + 3] = kind + (h.anchored ? 4 : 0);
    n++;
  };
  // Three clusters in four stand over the shoal, a fixed patch of sea where every crest that crosses breaks;
  // the rest follow the viewer around and break only now and then.
  const heads = [];
  for (let c = 0; c < clusters; c++) {
    const anchored = c % 4 < 3;
    if (anchored) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd());
      heads.push({ x: shoal.x + Math.cos(a) * r * shoal.rx, z: shoal.z + Math.sin(a) * r * shoal.rz, phase: rnd(), cyc: 2.7 + rnd() * 1.7, anchored });
    } else heads.push({ x: rnd() * tile, z: rnd() * tile, phase: rnd(), cyc: 5.5 + rnd() * 4.0, anchored });
  }
  // mist first, so the letters are drawn over it
  for (let c = 0; c < clusters; c++) for (let m = 0; m < puffs; m++) put(heads[c], c, 0.42 + rnd() * rnd() * 1.0, rnd() * 1.2, 2);
  // mostly small print, a few letters as large as the headlines they were torn from
  for (let c = 0; c < clusters; c++) for (let m = 0; m < members; m++) put(heads[c], c, 0.026 + Math.pow(rnd(), 3.0) * 0.16, Math.pow(rnd(), 1.4) * 1.3, 0);
  for (let k = 0; k < risers; k++) put({ x: rnd() * tile, z: rnd() * tile, phase: rnd(), cyc: 45 + rnd() * 50, anchored: false }, clusters + k, 0.04 + rnd() * 0.09, 0, 1);

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aS0', new THREE.InstancedBufferAttribute(s0, 4));
  geo.setAttribute('aS1', new THREE.InstancedBufferAttribute(s1, 4));
  geo.setAttribute('aS2', new THREE.InstancedBufferAttribute(s2, 4));
  geo.instanceCount = n;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  ctx.track(geo);

  const color = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  ctx.track(color);
  const mesh = new THREE.Mesh(geo, color);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return mesh;
}

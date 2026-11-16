// The sky: night gradient, a low moon with its aureole, thin cirrus, and stars that are single letters.

import * as THREE from 'three';
import { hash, noise, fbm } from '../../core/glsl.js';
import { FSPass } from '../../core/Pass.js';
import { COMMON_GLSL, NOISE_GLSL } from './shared.js';

// Cirrus is baked once (domain-warped streaks) and scrolled; one lookup at run time, shared with the stars.
const CLOUD_SPAN = 9.0;
const CLOUD_GLSL = /* glsl */ `
uniform sampler2D tCloud;
float cloudDensity(vec3 d, float t){
  if (d.y < 0.004) return 0.0;
  vec2 p = d.xz / (d.y + 0.16) * 0.62 + vec2(t * 0.0030, t * 0.0011);
  float c = textureLod(tCloud, p / ${CLOUD_SPAN.toFixed(1)} + 0.5, 0.0).r;
  return c * smoothstep(0.0, 0.07, d.y) * (1.0 - smoothstep(0.55, 0.95, d.y) * 0.6);
}
`;

export function makeCloudTexture(ctx) {
  const size = ctx.quality.level > 0 ? 2048 : 1024;
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    format: THREE.RedFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
    depthBuffer: false,
  });
  ctx.track(rt);
  const pass = new FSPass(
    /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    ${hash}
    ${noise}
    ${fbm}
    void main(){
      vec2 p = (vUv - 0.5) * ${CLOUD_SPAN.toFixed(1)};
      float n = fbm(p * vec2(0.7, 2.7) + vec2(1.7, 9.2), 6);
      float m = fbm(p * vec2(2.3, 6.5) + vec2(n * 1.8, 4.1), 6);
      float k = fbm(p * vec2(7.0, 15.0) + vec2(m * 2.2, n * 3.0), 5);
      float c = smoothstep(0.43, 0.80, n * 0.70 + m * 0.30 + (k - 0.5) * 0.16);
      c *= 0.80 + 0.40 * k;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0));
    }`,
    {},
  );
  pass.render(ctx.renderer, rt);
  pass.dispose();
  return rt.texture;
}

// The river of small print crosses the last shot of the rail on a diagonal: a great circle through a point of the
// sky (yaw, pitch), leaning by `lean` from the horizontal.
function greatCircle(yawDeg, pitchDeg, leanDeg) {
  const D = Math.PI / 180;
  const y = yawDeg * D;
  const p = pitchDeg * D;
  const c = new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  const right = new THREE.Vector3(0, 1, 0).cross(c).normalize().negate();
  const up = new THREE.Vector3().crossVectors(right, c).negate();
  const t = right.multiplyScalar(Math.cos(leanDeg * D)).addScaledVector(up, Math.sin(leanDeg * D));
  return new THREE.Vector3().crossVectors(c, t).normalize();
}
const BAND = greatCircle(-15, 17, 33);
if (BAND.y < 0) BAND.negate();
const g3 = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;

// The whole sky turns, very slowly, about an axis tipped towards the viewer. skyTurn(d, -angle) takes a world
// direction back to where that part of the sky started, so the band's glow and the letter-stars turn together.
const ROT_GLSL = /* glsl */ `
const vec3 SKY_AXIS = vec3(0.2265, 0.4983, 0.8369);
const vec3 BAND_N = ${g3(BAND)};
vec3 skyTurn(vec3 d, float a){
  float ca = cos(a), sa = sin(a);
  return d * ca + cross(SKY_AXIS, d) * sa + SKY_AXIS * dot(SKY_AXIS, d) * (1.0 - ca);
}
`;
const SKY_RATE = 0.0007;

const SKY_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);     // on the far plane: the sea is drawn first and hides most of it
}`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform float uTime;
uniform vec3 uMoonSky;     // the moon's own colour, whatever is in front of it
${hash}
${noise}
${fbm}
${NOISE_GLSL}
${COMMON_GLSL}
${CLOUD_GLSL}
${ROT_GLSL}
void main(){
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize((uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz);
  vec3 c = skyGlow(d);
  // the river of small print across the sky: unresolved, it is only a faint glow with dark lanes
  vec3 ds = skyTurn(d, -uTime * ${SKY_RATE});
  float bd = dot(ds, BAND_N);
  float g1 = exp(-bd * bd / 0.020);
  if (g1 > 0.004 && d.y > 0.0) {
    float lane = fbm(ds * 6.0 + 3.0, 3);
    float river = g1 * (0.30 + 0.70 * smoothstep(0.32, 0.68, lane)) + exp(-bd * bd / 0.16) * 0.20;
    c += vec3(0.0070, 0.0098, 0.0160) * river * smoothstep(0.0, 0.25, d.y);
  }
  float mu = clamp(dot(d, uMoonDir), -1.0, 1.0);
  float th = acos(mu);
  float cl = cloudDensity(d, uTime);
  // cirrus: almost nothing away from the moon, a silver veil in front of it
  vec3 cc = uMoonCol * (0.0040 + 0.13 * exp(-th / 0.11) + 0.022 * exp(-th / 0.42));
  c = mix(c, c * 0.70 + cc, cl);
  // weather: a bank of low cloud that the wind brings across the moon and takes away again. Thick enough to put
  // the road out; its torn edges and thin places still glow.
  float veil = 0.0;
  if (uVeil > 0.002 && d.y > -0.01) {
    vec2 q = d.xz / (d.y + 0.34);
    float n1 = textureLod(tCloud, q * vec2(0.050, 0.11) + vec2(0.31 + 0.03 * sin(uTime * 0.041), 0.42), 0.0).r;
    float n2 = textureLod(tCloud, q * vec2(0.12, 0.2) + vec2(0.5 - 0.03 * sin(uTime * 0.057 + 1.0), 0.5), 0.0).r;
    float body = n1 * 0.75 + n2 * 0.45 + 1.25 * uVeil - 0.55 - 0.6 * smoothstep(0.10, 0.42, d.y);
    veil = smoothstep(0.0, 0.5, body) * smoothstep(-0.01, 0.012, d.y);
    float thin = 1.0 - smoothstep(0.1, 0.9, body);
    vec3 lit = uMoonSky * (0.0035 + (0.34 * exp(-th * th / 0.0011) + 0.085 * exp(-th / 0.06) + 0.022 * exp(-th / 0.2)) * (0.25 + 0.75 * thin));
    c = mix(c, c * 0.25 + lit, veil);
  }

  // the disc: limb darkening, faint maria, softened by whatever cloud crosses it
  const float MR = 0.0205;
  float px = 1.2 / uPpm;
  float disc = 1.0 - smoothstep(MR - px, MR + px, th);
  if (disc > 0.0) {
    vec3 mx = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
    vec3 my = cross(uMoonDir, mx);
    vec2 q = vec2(dot(d, mx), dot(d, my)) / MR;
    float r2 = clamp(dot(q, q), 0.0, 1.0);
    float limb = 0.62 + 0.38 * sqrt(1.0 - r2);
    float maria = fbm(q * 1.9 + vec2(3.3, 1.1), 5);
    float crat = fbm(q * 7.0 + 11.0, 3);
    float alb = 0.50 + 0.50 * smoothstep(0.34, 0.66, maria) + (crat - 0.5) * 0.2;
    c += uMoonSky * disc * limb * alb * 4.2 * (1.0 - cl * 0.55) * (1.0 - 0.985 * veil) * (1.0 - 0.75 * smoothstep(0.0, 0.5, uVeil));
  }
  if (d.y < 0.0) c *= 0.75 + 0.25 * smoothstep(-0.02, 0.0, d.y);
  gl_FragColor = vec4(c, 1.0);
}`;

/** The sky as a far-plane triangle inside the scene, drawn after the water so hidden pixels cost nothing. */
export function makeSky(ctx, uniforms) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  ctx.track(geo);
  const mat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms, depthTest: true, depthWrite: false, depthFunc: THREE.LessEqualDepth });
  ctx.track(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1.5;
  return mesh;
}

const STAR_VERT = /* glsl */ `
precision highp float;
attribute vec3 aDir;
attribute vec4 aP;     // angular cell size, brightness, atlas index, roll
attribute vec2 aR;     // rand, warmth
uniform float uTime, uStarZoom;
uniform vec2 uAtlas;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vQ;
${NOISE_GLSL}
${COMMON_GLSL}
${CLOUD_GLSL}
${ROT_GLSL}
void main(){
  vec3 d = skyTurn(aDir, uTime * ${SKY_RATE});

  vec3 rt = normalize(cross(d, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, d);
  float cr = cos(aP.w), sr = sin(aP.w);
  vec3 R = rt * cr + up * sr;
  vec3 Uq = up * cr - rt * sr;

  float size = aP.x * uStarZoom;
  float px = size * uPpm;
  float grow = max(1.0, 3.4 / px);
  vQ = vec3(position.xy, 1.0 - smoothstep(4.0, 9.0, px));
  vec3 wp = uCam + (d + (R * position.x + Uq * position.y) * size * grow) * 2000.0;
  vec4 cp = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  cp.z = cp.w * 0.999999;
  gl_Position = cp;

  float col = mod(aP.z, uAtlas.x), row = floor(aP.z / uAtlas.x);
  vUv = (vec2(col, row) + vec2(position.x + 0.5, 0.5 - position.y)) / uAtlas;

  float th = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
  float glare = smoothstep(0.035, 0.42, th);
  float ext = smoothstep(0.004, 0.16, d.y);
  float cl = cloudDensity(d, uTime);
  float tw = 0.80 + 0.20 * sin(uTime * (1.3 + 3.1 * aR.x) + aR.x * 97.0);
  // looked at closely a star is a letter; it must not get brighter for being larger
  float I = (0.34 + 7.0 * aP.y) * tw * glare * ext * (1.0 - 0.85 * cl) / (grow * grow) / pow(max(uStarZoom, 0.6), 1.35);
  vec3 tint = mix(vec3(0.74, 0.84, 1.0), vec3(1.0, 0.86, 0.68), aR.y);
  vCol = vec4(tint * I, 0.14 + 0.5 * aP.y);
  if (d.y < -0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const STAR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tAtlas;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vQ;
void main(){
  float sd = texture2D(tAtlas, vUv).r;
  float aa = clamp(fwidth(sd) * 0.75, 0.004, 0.3);
  float a = smoothstep(0.5 - aa, 0.5 + aa, sd);
  float r2 = dot(vQ.xy, vQ.xy);
  float win = 1.0 - smoothstep(0.10, 0.25, r2);
  float halo = smoothstep(0.05, 0.5, sd);
  float letter = (a + halo * halo * vCol.a) * win;
  float dotv = exp(-r2 * 26.0) * 0.55;          // too small to be a letter yet: a point of light
  gl_FragColor = vec4(vCol.rgb * mix(letter, dotv, vQ.z), 1.0);
}`;

// short plain words set among the stars as constellations: [word, yaw°, pitch°]
const WORDS = [
  ['hello', -30, 22],
  ['home', -9.5, 23.5],
  ['soon', -22.5, 9.5],
  ['yes', -1.5, 14],
  ['still', 3.5, 25.5],
  ['dear', -19.5, 27],
  ['and', -35, 12.5],
];

/** Stars: letters on the dome. A background scatter, a denser river of faint print, and a few words. */
export function makeStars(ctx, uniforms, atlas, chars, count) {
  const rnd = ctx.rng(31);
  const wordLetters = WORDS.reduce((s, w) => s + w[0].length, 0);
  const total = count + wordLetters;
  const dir = new Float32Array(total * 3);
  const p = new Float32Array(total * 4);
  const r = new Float32Array(total * 2);
  // the band: a great circle tilted across the sky
  const bn = BAND.clone();
  const b1 = new THREE.Vector3().crossVectors(bn, new THREE.Vector3(0, 1, 0)).normalize();
  const b2 = new THREE.Vector3().crossVectors(bn, b1);
  const v = new THREE.Vector3();
  const glyphs = [];
  for (const ch of chars) {
    for (const face of ['r', 'i']) {
      const g = atlas.lookup(face, ch);
      if (g && g.index >= 0) glyphs.push(g.index);
    }
  }
  let n = 0;
  let guard = 0;
  while (n < count && guard++ < count * 40) {
    const inBand = rnd() < 0.62;
    if (inBand) {
      const a = rnd() * Math.PI * 2;
      const off = rnd.gauss() * (rnd() < 0.7 ? 0.05 : 0.12);
      v.copy(b1).multiplyScalar(Math.cos(a)).addScaledVector(b2, Math.sin(a)).addScaledVector(bn, off).normalize();
    } else {
      const y = -0.04 + rnd() * 1.04;
      const a = rnd() * Math.PI * 2;
      const s = Math.sqrt(Math.max(0, 1 - y * y));
      v.set(Math.cos(a) * s, y, Math.sin(a) * s);
    }
    if (v.y < -0.04) continue;
    const u = rnd();
    const dust = rnd() < (inBand ? 0.72 : 0.5); // most of the sky is print too fine to ever resolve
    const bright = dust ? Math.pow(u, 3) * 0.02 : Math.pow(u, inBand ? 10 : 8.5);
    dir[n * 3] = v.x;
    dir[n * 3 + 1] = v.y;
    dir[n * 3 + 2] = v.z;
    p[n * 4] = dust ? 0.0016 + rnd() * 0.0014 : 0.0030 + 0.0084 * Math.sqrt(bright) + rnd() * 0.0008;
    p[n * 4 + 1] = bright;
    p[n * 4 + 2] = glyphs[Math.floor(rnd() * glyphs.length)];
    p[n * 4 + 3] = (rnd() - 0.5) * 0.7;
    r[n * 2] = rnd();
    r[n * 2 + 1] = Math.pow(rnd(), 3);
    n++;
  }
  // words: letters spaced like stars along a slightly wandering baseline
  const up = new THREE.Vector3(0, 1, 0);
  const rt = new THREE.Vector3();
  const uu = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const [word, yawDeg, pitchDeg] of WORDS) {
    const yaw = (yawDeg * Math.PI) / 180;
    const pitch = (pitchDeg * Math.PI) / 180;
    c.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    rt.crossVectors(c, up).normalize();
    uu.crossVectors(rt, c);
    const size = 0.0086 + rnd() * 0.0016;
    const face = rnd() < 0.5 ? 'r' : 'i';
    const m = atlas.measure(face, word);
    const track = 2.1; // wide letterspacing: these are stars first
    const tilt = (rnd() - 0.5) * 0.3;
    for (let k = 0; k < m.chars.length; k++) {
      const g = atlas.lookup(face, m.chars[k]);
      if (!g || g.index < 0) continue;
      const x = ((m.x[k] + g.adv * 0.5 - m.w * 0.5) * track * size) / 1.54;
      const y = x * Math.sin(tilt) + (rnd() - 0.5) * size * 0.16;
      v.copy(c).addScaledVector(rt, x * Math.cos(tilt)).addScaledVector(uu, y).normalize();
      dir[n * 3] = v.x;
      dir[n * 3 + 1] = v.y;
      dir[n * 3 + 2] = v.z;
      p[n * 4] = size * (0.92 + rnd() * 0.16);
      p[n * 4 + 1] = 0.10 + rnd() * 0.2;
      p[n * 4 + 2] = g.index;
      p[n * 4 + 3] = tilt + (rnd() - 0.5) * 0.16;
      r[n * 2] = rnd();
      r[n * 2 + 1] = Math.pow(rnd(), 3);
      n++;
    }
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aDir', new THREE.InstancedBufferAttribute(dir, 3));
  geo.setAttribute('aP', new THREE.InstancedBufferAttribute(p, 4));
  geo.setAttribute('aR', new THREE.InstancedBufferAttribute(r, 2));
  geo.instanceCount = n;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  ctx.track(geo);
  const mat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms,
    transparent: true,
    depthTest: true, // drawn at the far plane: anything in front (the sea, spray) hides them
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  ctx.track(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  return mesh;
}


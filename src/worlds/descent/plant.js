// Where the night ends: a shrub on the headland, one long leaf of it held out level, and from the underside of that
// leaf a single strand of silk hanging to the ground. The butterfly comes down under the leaf. The dew is on the strand.
//
// The strand is the last picture of this world and the first of the next, so it is drawn with some care. Dew on a
// thread does not sit evenly: a film of water on a fibre is unstable (Plateau–Rayleigh) and pulls itself into beads at
// a regular spacing, each pair of large beads with one or two much smaller ones left between them. Every bead is a
// ball lens: it holds the whole landscape behind it upside down — the sky at the bottom, the dark land at the top — and
// the sun as a single point on the side away from the sun.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AIR } from './chunks.js';

const UP = new THREE.Vector3(0, 1, 0);

/** One leaf as an indexed grid: O where its stalk starts, X the way it grows, Y "up" for it, roll about its own axis. */
function leaf(O, X, Y, len, wid, { roll = 0, droop = 0.4, lift = 0.1, ns = 26, nv = 8, wave = 1 } = {}) {
  const x = X.clone().normalize();
  const y = Y.clone().addScaledVector(x, -Y.dot(x)).normalize();
  const s0 = new THREE.Vector3().crossVectors(x, y);
  const pos = new Float32Array((ns + 1) * (nv + 1) * 3);
  const uv = new Float32Array((ns + 1) * (nv + 1) * 2);
  const half = new Float32Array((ns + 1) * (nv + 1));
  const C = O.clone();
  const T = new THREE.Vector3(), N = new THREE.Vector3(), A = new THREE.Vector3(), Nr = new THREE.Vector3(), P = new THREE.Vector3();
  for (let i = 0; i <= ns; i++) {
    const s = i / ns;
    const beta = droop * Math.pow(s, 1.5) - lift;
    T.copy(x).multiplyScalar(Math.cos(beta)).addScaledVector(y, -Math.sin(beta));
    if (i > 0) C.addScaledVector(T, len / ns);
    N.crossVectors(s0, T);
    A.copy(s0).multiplyScalar(Math.cos(roll)).addScaledVector(N, Math.sin(roll));
    Nr.crossVectors(A, T);
    const sb = Math.max(0, (s - 0.1) / 0.9);
    let w = 0.5 * wid * Math.pow(Math.sin(Math.PI * Math.pow(sb, 0.82)), 0.72) * (1 - 0.12 * sb);
    w = Math.max(w, 0.011 * (1 - sb));
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1;
      // a shallow keel along the midrib, and a margin that is never quite flat
      const z = -0.16 * w * (1 - Math.abs(v)) * (1 - Math.abs(v)) + wave * 0.02 * w * v * v * Math.sin(s * 23 + v * 2.0);
      P.copy(C).addScaledVector(A, v * w).addScaledVector(Nr, z);
      const o = i * (nv + 1) + j;
      pos.set([P.x, P.y, P.z], o * 3);
      uv.set([sb, v], o * 2);
      half[o] = w;
    }
  }
  const idx = [];
  for (let i = 0; i < ns; i++)
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = a + 1, c = a + nv + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aHalf', new THREE.BufferAttribute(half, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/**
 * A point of a leaf built by `leaf` (grid ns × nv): sb 0..1 along the blade (as in its uv), v -1..1 across it.
 * Returns the place (out) and the half-width of the blade there.
 */
function leafAt(g, ns, nv, sb, v, out) {
  const fi = Math.min(ns - 1e-4, Math.max(0, (0.1 + 0.9 * sb) * ns));
  const fj = Math.min(nv - 1e-4, Math.max(0, ((v + 1) / 2) * nv));
  const i = Math.floor(fi), j = Math.floor(fj), ti = fi - i, tj = fj - j;
  const P = g.attributes.position.array, H = g.attributes.aHalf.array;
  const a = i * (nv + 1) + j, b = a + 1, c = a + nv + 1, d = c + 1;
  const w = [(1 - ti) * (1 - tj), (1 - ti) * tj, ti * (1 - tj), ti * tj];
  out.set(0, 0, 0);
  let h = 0;
  [a, b, c, d].forEach((k, n) => {
    out.x += P[k * 3] * w[n];
    out.y += P[k * 3 + 1] * w[n];
    out.z += P[k * 3 + 2] * w[n];
    h += H[k] * w[n];
  });
  return h;
}
/** How many teeth the margin of the long leaf has, and how deep the notches between them are cut (m). */
const TEETH = 84;
const NOTCH = 0.0062;
/** tooth k: how tall it stands out of the notches (0..1) — the same numbers in the shader and here */
const toothHeight = (k) => 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(k * 12.9898 + 1.3));
const notchAt = (sb) => NOTCH * Math.min(1, sb / 0.08) * Math.min(1, (1 - sb) / 0.06);

const LEAF_VERT = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const LEAF_FRAG = /* glsl */ `
precision highp float;
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
uniform vec3 uSkyUp;
${AIR}
void main(){
  vec3 Nu = -normalize(vN);                      // the upper face (the grid is wound so that its own normal points down)
  vec3 V = normalize(uCam - vW);
  float under = step(dot(Nu, V), 0.0);
  vec3 N = mix(Nu, -Nu, under);
  float s = vUv.x, v = vUv.y, av = abs(v);
  if (s <= 0.0) {
    // the stalk
    vec3 c = vec3(0.02, 0.03, 0.014) * (uSkyUp * (0.5 + 0.5 * N.y) + uSunCol * max(dot(N, uSunDir), 0.0));
    gl_FragColor = vec4(applyAir(c, -V, length(uCam - vW)), 1.0);
    return;
  }
  // veins: the midrib, the side veins that leave it and run forward to the margin, and the net between them
  float mid = 1.0 - smoothstep(0.0, 0.035 * (1.2 - s), av);
  float sc = s * 11.0 - av * 1.7 - 0.25 * av * av + 0.5 * step(0.0, v);
  float sidev = 1.0 - smoothstep(0.0, 0.07 + 0.05 * av, abs(fract(sc) - 0.5) * 2.0 * (0.25 + 0.4 * av));
  sidev *= smoothstep(0.02, 0.1, av) * (1.0 - smoothstep(0.8, 0.98, av));
  vec2 cq = vec2(s * 90.0, v * 21.0 + sin(s * 9.0) * 0.7);
  vec2 ci = floor(cq), cf = cq - ci;
  float net = 1e9;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = vec2(float(i), float(j));
    vec2 o = c + hash22(ci + c) - cf;
    net = min(net, dot(o, o));
  }
  float cell = hash12(ci + 0.5);
  float netv = smoothstep(0.42, 0.62, sqrt(net));               // the far corners of the cells: where the small veins run
  float vein = max(mid, max(sidev * 0.85, netv * 0.3));
  float len = length(uCam - vW);
  // (a leaf of the shrub that the lens passes within arm's reach of thins out and lets it by, rather than fill the frame)
  if (ign(gl_FragCoord.xy) > smoothstep(0.45, 1.25, len)) discard;
  // the upper face is dark and waxy; the underside pale, matt, and its veins stand out of it
  vec3 albU = vec3(0.013, 0.036, 0.012) * (0.92 + 0.16 * cell);
  vec3 albD = mix(vec3(0.034, 0.055, 0.036) * (0.92 + 0.16 * cell), vec3(0.075, 0.1, 0.066), vein);
  vec3 alb = mix(albU, albD, under);
  // (what faces down is lit by what the ground and the low sky give back)
  vec3 col = alb * uSkyUp * mix(0.6, 1.0, 0.5 + 0.5 * N.y);
  vec3 tl = uLamp.xyz - vW;
  float r2 = dot(tl, tl);
  vec3 Ll = tl * inversesqrt(r2);
  vec3 El = uLampCol * (uLamp.w / (1.0 + r2 * 0.3));
  // light on the face that is seen, and light that comes through from the other: green, with the veins dark in it
  vec3 thru = vec3(0.05, 0.19, 0.04) * (1.0 - 0.75 * vein) * (0.9 + 0.2 * cell);
  col += El * 3.0 * (alb * max(dot(N, Ll), 0.0) + thru * 0.12 * max(dot(-N, Ll), 0.0));
  col += uSunCol * (alb * max(dot(N, uSunDir), 0.0) + thru * 0.16 * max(dot(-N, uSunDir), 0.0));
  // (the sky comes through it too: by morning the underside of a leaf is the colour of the leaf)
  col += uSkyUp * thru * 0.3 * under;
  float gloss = pow(1.0 - max(dot(N, V), 0.0), 4.0) * (1.0 - under) * (0.3 + 0.7 * (1.0 - vein));
  col += skyBase(reflect(-V, N)) * gloss * 0.6;
  gl_FragColor = vec4(applyAir(col, -V, len), 1.0);
}`;

// ---- the one long leaf it sleeps under, seen from below and from very close. A leaf held against the light is a
// window: the blade between the veins lets the morning through, yellow-green; every vein is thicker than the blade and
// stands dark in it — the midrib, the side veins that leave it and run forward to the margin, the rungs between those,
// and the net of small cells in between. Its margin is toothed, each tooth pointing at the tip.
const HLEAF_VERT = /* glsl */ `
attribute float aHalf;
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
varying float vHalf;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  vHalf = aHalf;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const HLEAF_FRAG = /* glsl */ `
precision highp float;
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
varying float vHalf;
uniform vec3 uSkyUp;
uniform vec3 uAxis;          // the way it grows
uniform vec4 uGrip;          // where the butterfly holds on (xyz), the length of the blade (m)
${AIR}
float vn2(vec2 p){
  vec2 i = floor(p), f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main(){
  float s = vUv.x, v = vUv.y, av = abs(v);
  vec3 Nu = -normalize(vN);                      // the upper face (the grid is wound so that its own normal points down)
  vec3 V = normalize(uCam - vW);
  float dist = length(uCam - vW);
  float under = step(dot(Nu, V), 0.0);
  vec3 N = mix(Nu, -Nu, under);
  if (s <= 0.0) {
    vec3 c = vec3(0.02, 0.03, 0.014) * (uSkyUp * (0.5 + 0.5 * N.y) + uSunCol * max(dot(N, uSunDir), 0.0));
    gl_FragColor = vec4(applyAir(c, -V, dist), 1.0);
    return;
  }
  float blade = uGrip.w;
  float along = s * blade;                       // metres from the foot of the blade
  float across = v * vHalf;                      // metres from the midrib
  float aacr = abs(across);

  // ---- the margin: teeth
  float tt = s * ${TEETH}.0;
  float ti = floor(tt), tf = tt - ti;
  float tooth = tf < 0.8 ? tf / 0.8 : (1.0 - tf) / 0.2;
  float notch = ${NOTCH} * min(1.0, s / 0.08) * min(1.0, (1.0 - s) / 0.06);
  float hgt = notch * (0.55 + 0.45 * (0.5 + 0.5 * sin(ti * 12.9898 + 1.3)));
  float dM = vHalf - notch + hgt * pow(tooth, 1.35) - aacr;       // metres inside the margin
  float cover = clamp(dM / max(fwidth(dM), 1e-6) + 0.5, 0.0, 1.0);
  if (cover < 0.004) discard;

  // ---- the veins, each as a distance in metres
  float px = fwidth(along) + fwidth(across) + 1e-6;                // metres a pixel covers
  float wm = mix(0.0052, 0.0011, s);
  float mid = 1.0 - smoothstep(wm * 0.55, wm, aacr);
  float midSh = 1.0 - smoothstep(wm, wm * 3.5, aacr);
  // side veins: they leave the midrib at an angle and bend forward as they near the margin
  float sc = s * 13.0 - av * 1.45 - 0.35 * av * av + 0.5 * step(0.0, v);
  float gs = length(vec2(13.0 / blade, (1.45 + 0.7 * av) / max(vHalf, 1e-3)));
  float d1 = abs(fract(sc) - 0.5) / gs;
  float w1 = mix(0.0015, 0.00045, av);
  float sec = (1.0 - smoothstep(w1 * 0.55, w1 + px * 0.7, d1)) * smoothstep(0.0, 0.03, av);
  float secSh = 1.0 - smoothstep(w1, w1 * 4.5, d1);
  // rungs between one side vein and the next
  float cid = floor(sc - 0.5), fc = fract(sc - 0.5);
  float tc = aacr / 0.0115 + 0.9 * fc + 6.0 * hash11(cid * 3.7 + 1.0 + step(0.0, v) * 17.0);
  float d2 = abs(fract(tc) - 0.5) * 0.0115;
  float ter = (1.0 - smoothstep(0.00022, 0.00042 + px * 0.7, d2)) * (1.0 - smoothstep(0.0, 0.12, px / 0.0115));
  // the net: small cells, each closed by the finest veins
  vec2 cq = vec2(along, across) / 0.0038;
  vec2 ci = floor(cq), cf = cq - ci;
  float f1 = 1e9, f2 = 1e9, cell = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = vec2(float(i), float(j));
    vec2 o = c + hash22(ci + c) - cf;
    float d = dot(o, o);
    if (d < f1) { f2 = f1; f1 = d; cell = hash12(ci + c + 0.5); } else if (d < f2) f2 = d;
  }
  float netK = 1.0 - smoothstep(0.12, 0.4, px / 0.0038);
  float net = (1.0 - smoothstep(0.02, 0.16, sqrt(f2) - sqrt(f1))) * netK;
  float vein = max(max(mid, sec * 0.92), max(ter * 0.7, net * 0.42));
  float rib = max(mid, max(sec * 0.85, ter * 0.4));               // what stands out of the underside

  // ---- the two faces
  vec3 albU = vec3(0.013, 0.036, 0.012) * (0.92 + 0.16 * cell);
  vec3 albD = mix(vec3(0.03, 0.05, 0.034) * (0.94 + 0.12 * cell), vec3(0.085, 0.108, 0.072), rib);
  vec3 alb = mix(albU, albD, under);
  vec3 col = alb * uSkyUp * mix(0.55, 1.0, 0.5 + 0.5 * N.y);
  vec3 tl = uLamp.xyz - vW;
  float r2 = dot(tl, tl);
  vec3 Ll = tl * inversesqrt(r2);
  vec3 El = uLampCol * (uLamp.w / (1.0 + r2 * 0.3));
  // how much of what falls on one face comes out of the other: least through a vein, most through the thin blade
  // and the thinner margin
  float thick = clamp(vein + 0.45 * midSh + 0.22 * secSh, 0.0, 1.0);
  vec3 T = mix(vec3(0.19, 0.35, 0.045), vec3(0.03, 0.1, 0.014), thick) * (0.9 + 0.2 * cell);
  T *= 1.0 + 0.55 * (1.0 - smoothstep(0.0, 0.006, dM));
  col += El * 3.0 * (alb * max(dot(N, Ll), 0.0) + T * 0.1 * max(dot(-N, Ll), 0.0));
  col += uSunCol * alb * max(dot(N, uSunDir), 0.0);
  if (under > 0.5) {
    // the morning on the upper face, seen through it: not evenly — other leaves stand between this one and the sun,
    // and the low light reaches it in patches, more of them toward the side the sun is on
    vec2 dq = vec2(dot(vW - uGrip.xyz, uAxis), across);
    float dap = 0.6 * vn2(dq * vec2(4.6, 11.0) + 3.7) + 0.4 * vn2(dq * vec2(11.0, 23.0) + 9.1);
    float sunny = smoothstep(0.34, 0.64, dap + 0.6 * smoothstep(-0.25, 0.6, dq.x) - 0.42);
    vec3 warm = mix(uSunCol, vec3(dot(uSunCol, vec3(0.4))), 0.35);
    col += (warm * (0.012 + 0.27 * sunny) + uSkyUp * 0.07) * T;
    // the ribs stand out of the underside and take the cool light from below along one flank
    col += uSkyUp * 0.012 * rib * (0.5 + 0.5 * N.y + 0.6);
  } else {
    float gloss = pow(1.0 - max(dot(N, V), 0.0), 4.0) * (0.3 + 0.7 * (1.0 - vein));
    col += skyBase(reflect(-V, N)) * gloss * 0.6;
  }
  gl_FragColor = vec4(applyAir(col, -V, dist), cover);
}`;

const WOOD_VERT = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const WOOD_FRAG = /* glsl */ `
precision highp float;
varying vec3 vW;
varying vec3 vN;
uniform vec3 uSkyUp;
${AIR}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  vec3 alb = vec3(0.028, 0.03, 0.02) * (0.6 + 0.8 * hash13(floor(vW * vec3(140.0, 30.0, 140.0))));
  vec3 tl = uLamp.xyz - vW;
  float r2 = dot(tl, tl);
  vec3 col = alb * (uSkyUp * (0.45 + 0.55 * N.y) + uLampCol * (uLamp.w * 3.0 / (1.0 + r2 * 0.3)) * max(dot(N, tl * inversesqrt(r2)), 0.0) + uSunCol * max(dot(N, uSunDir), 0.0));
  gl_FragColor = vec4(applyAir(col, -V, length(uCam - vW)), 1.0);
}`;

// the strand and its beads move together (hardly at all: the air before sunrise is still)
const SWAY = /* glsl */ `
uniform vec3 uTop;          // where it is tied
uniform vec3 uAcross;       // the frame's "right"
uniform float uLen, uSwayT;
vec3 strandAt(float depth){
  float q = depth / uLen;
  float sw = q * q * (0.006 * sin(uSwayT * 0.62 + 1.0) + 0.002 * sin(uSwayT * 1.7 + q * 3.0));
  return uTop - vec3(0.0, depth, 0.0) + uAcross * sw + vec3(-uAcross.z, 0.0, uAcross.x) * (sw * 0.6);
}`;

const STRAND_VERT = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uPpm;
varying vec3 vW;
varying float vX;
varying float vD;
varying float vK;
${SWAY}
void main(){
  vec3 P = strandAt(position.y * uLen);
  vW = P; vD = position.y * uLen;
  vec4 v0 = viewMatrix * vec4(P, 1.0);
  vec4 c0 = projectionMatrix * v0;
  // silk a fiftieth of a millimetre thick, magnified like everything here; never thinner on screen than a line
  float truePx = 0.00035 * uPpm / max(-v0.z, 0.05);
  float wpx = max(truePx, max(0.55, 0.7 * uRes.y / 1080.0));
  vK = min(truePx / wpx, 1.0);
  vX = position.x;
  gl_Position = c0;
  gl_Position.x += position.x * (wpx * 1.6) * 2.0 / uRes.x * c0.w;
}`;
const STRAND_FRAG = /* glsl */ `
precision highp float;
varying vec3 vW;
varying float vX;
varying float vD;
varying float vK;
uniform vec3 uSkyUp;
${AIR}
void main(){
  vec3 V = normalize(uCam - vW);
  float a = (1.0 - smoothstep(0.35, 1.0, abs(vX))) * mix(0.35, 1.0, vK);
  // a fibre lights up along its whole length when the light, the eye and the fibre agree (and at sunrise, with the
  // sun low and the strand hanging plumb, they do): the highlight of a cylinder is a line
  vec3 H = normalize(uSunDir + V);
  float line = pow(1.0 - H.y * H.y, 30.0);
  float fwd = 0.25 + 2.2 * pow(max(dot(-V, uSunDir), 0.0), 3.0);
  // (it is two fibres laid together, with a twist: brighter and dimmer along its length)
  float tw = 0.6 + 0.4 * sin(vD * 310.0) * sin(vD * 73.0 + 1.0);
  vec3 col = uSunCol * line * fwd * tw * 1.6 + uSkyUp * 0.55 + uLampCol * (uLamp.w * 0.5 / (1.0 + dot(uLamp.xyz - vW, uLamp.xyz - vW) * 0.3));
  if (a < 0.3) discard;
  gl_FragColor = vec4(col * a, a);
}`;

const BEAD_VERT = /* glsl */ `
precision highp float;
attribute vec4 aB;           // how far down the strand (m), radius (m), seed, 1 = a large bead
uniform vec2 uRes;
uniform float uPpm, uShift, uHot, uBig;
varying vec2 vQ;
varying vec3 vC;             // the bead's centre
varying vec4 vI;             // radius, seed, how much it is the one that has the sun in it, coverage
${SWAY}
void main(){
  float depth = aB.x + uShift;
  vec3 C = strandAt(depth);
  float hot = aB.w * exp(-pow((depth - uHot) / 0.01, 2.0));
  // (toward sunrise the dew is at its heaviest: the large beads swell, the one with the sun in it most of all)
  float r = aB.y * (1.0 + 0.45 * hot) * mix(1.0, 1.0 + (uBig - 1.0) * (0.45 + 0.55 * hot), aB.w);
  // a bead hangs a little below the thread it is on
  C.y -= r * 0.18;
  vec4 vp = viewMatrix * vec4(C, 1.0);
  float px = r * uPpm / max(-vp.z, 0.05);
  float grow = max(1.0, 1.1 / px);
  vQ = position.xy * 2.0;
  vC = C;
  vI = vec4(r, aB.z, hot, 1.0 / (grow * grow));
  vp.xy += position.xy * 2.0 * r * grow * 1.06;
  // (no large bead just under the tie: that is where the butterfly's abdomen is)
  gl_Position = depth > uLen || depth < mix(0.004, 0.06, aB.w) ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * vp;
}`;
// Dew does not only settle: at the end of a still night a leaf pushes water out at the tips of its teeth (guttation),
// one bead to a tooth. They are the same ball lenses as the ones on the strand.
const GUT_VERT = /* glsl */ `
precision highp float;
attribute vec4 aC;           // where it hangs (xyz), radius (m)
attribute float aSeed;
uniform vec2 uRes;
uniform float uPpm, uSwayT;
varying vec2 vQ;
varying vec3 vC;
varying vec4 vI;
void main(){
  float r = aC.w * (1.0 + 0.04 * sin(uSwayT * 0.7 + aSeed * 40.0));
  vec3 C = aC.xyz - vec3(0.0, r * 0.82, 0.0);
  vec4 vp = viewMatrix * vec4(C, 1.0);
  float px = r * uPpm / max(-vp.z, 0.05);
  float grow = max(1.0, 1.1 / px);
  vQ = position.xy * 2.0;
  vC = C;
  vI = vec4(r, aSeed, 0.0, 1.0 / (grow * grow));
  vp.xy += position.xy * 2.0 * r * grow * 1.06;
  gl_Position = projectionMatrix * vp;
}`;
const BEAD_FRAG = /* glsl */ `
precision highp float;
varying vec2 vQ;
varying vec3 vC;
varying vec4 vI;
uniform vec3 uCamR, uCamU, uCamB, uSkyUp;
uniform vec3 uLeafDir;       // the way to the leaf over it
${AIR}
// everything a bead can see from where it hangs
vec3 scene(vec3 d, float hot){
  // (a bead is not a camera: the sky it holds is paler than the sky)
  vec3 sky = skyBase(vec3(d.x, abs(d.y), d.z));
  sky = mix(sky, vec3(dot(sky, vec3(0.3, 0.5, 0.2))), 0.4);
  vec3 c = sky;
  float az = atan(d.z, d.x);
  // below the horizon: the bay giving the sky back, brightest far out; nearer, the dark ground of the headland
  if (d.y < 0.0) {
    vec3 sea = sky * (0.22 + 0.62 * exp(d.y * 9.0)) + uSunCol * 0.02;
    vec3 ground = uSkyUp * vec3(0.035, 0.05, 0.036) + uSunCol * 0.006;
    c = mix(ground, sea, smoothstep(-0.34 - 0.08 * sin(az * 2.0 + 0.5), -0.1, d.y));
  }
  // the land across the bay: dark hills standing on the horizon, the highest of them where it came down in the night
  float hills = 0.04 + 0.034 * sin(az * 2.3 + 1.0) + 0.018 * sin(az * 7.0) + 0.008 * sin(az * 19.0 + 2.0);
  c = mix(c, uSkyUp * vec3(0.03, 0.045, 0.045), smoothstep(hills + 0.01, hills - 0.01, d.y) * step(0.0, d.y) * 0.94);
  // the leaf it hangs from fills the sky straight overhead
  c = mix(c, uSkyUp * vec3(0.05, 0.11, 0.035), smoothstep(0.55, 0.8, dot(d, uLeafDir)));
  // the sun (and the lamp, still lit, a long way down the list)
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  c += uSunCol * (pow(sd, 2600.0) * 140.0 + pow(sd, 240.0) * 4.0 + pow(sd, 24.0) * 0.25) * (1.0 + 5.0 * hot);
  float ld = max(dot(d, normalize(uLamp.xyz - vC)), 0.0);
  c += uLampCol * uLamp.w * pow(ld, 1800.0) * 6.0;
  return c;
}
void main(){
  vec2 q = vQ * 1.06;
  float rr = dot(q, q);
  if (rr > 1.0) discard;
  float z = sqrt(1.0 - rr);
  vec3 n = normalize(uCamR * q.x + uCamU * q.y + uCamB * z);
  vec3 I = normalize(vC + (uCamR * q.x + uCamU * q.y) * vI.x - uCam);
  // through the ball: in at n, across the chord, out the far side — which turns the picture over
  vec3 t1 = refract(I, n, 0.7502);
  vec3 p2 = n + t1 * (-2.0 * dot(t1, n));
  vec3 t2 = refract(t1, -p2, 1.333);
  if (dot(t2, t2) < 0.5) t2 = reflect(t1, -p2);
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, -I), 0.0), 5.0);
  vec3 col = scene(t2, vI.z) * (1.0 - F) * 0.94 + scene(reflect(I, n), 0.0) * F;
  // the thread it is on, seen through it: a dark line the lens makes of the far side of the strand
  col *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.07, abs(q.x))) * (1.0 - rr);
  // what the ball gathers of the sun it throws on its own far wall: a bright crescent on the side away from the sun
  vec3 sv = normalize(uSunDir);
  vec2 s2 = normalize(vec2(dot(sv, uCamR), dot(sv, uCamU)) + 1e-5);
  float cres = smoothstep(0.35, 0.9, dot(q, -s2)) * smoothstep(0.25, 0.8, rr) * (1.0 - smoothstep(0.86, 0.99, rr));
  col += uSunCol * cres * (0.35 + 1.8 * vI.z);
  float edge = 1.0 - smoothstep(0.9, 1.0, rr);
  gl_FragColor = vec4(col * edge * vI.w, edge);
}`;

/**
 * @param U    the world's uniform bag (the AIR set as U.air, uSkyUp, uRes, uPpm, uCamR/U/B)
 * @param plan GRIP, STRAND, VIEW, RIGHT, PLANT
 */
export function makePlant(ctx, U, plan) {
  const { GRIP, VIEW, RIGHT, PLANT } = plan;
  const rnd = ctx.rng(88);
  const group = new THREE.Group();
  const leaves = [];
  // ---- the leaf it sleeps under: level where it holds on, tipped so that its underside is toward the last frame.
  // It holds on just inside the far margin, so that it hangs below the edge of the leaf with the morning behind it.
  const HL = { len: 1.55, wid: 0.34, o: { roll: 0.5, droop: 0.38, lift: 0.13, ns: 96, nv: 20 } };
  const X = RIGHT.clone();
  const GS = 0.5, GV = -0.955;
  const hang = ctx.track(leaf(new THREE.Vector3(), X, UP, HL.len, HL.wid, HL.o));
  const lp = (sb, v, out = new THREE.Vector3()) => {
    const h = leafAt(hang, HL.o.ns, HL.o.nv, sb, v, out);
    out.h = h;
    return out;
  };
  const O = GRIP.clone().sub(lp(GS, GV));
  hang.translate(O.x, O.y, O.z);
  /** the tip of tooth k of the far margin */
  const tip = (k, out = new THREE.Vector3()) => {
    const sb = (k + 0.8) / TEETH;
    lp(sb, -1, out);
    return lp(sb, -(1 - (notchAt(sb) * (1 - toothHeight(k))) / out.h), out);
  };
  // (the strand is tied to the tip of a tooth, a little further along the same margin)
  const TIE_K = Math.round((GS + 0.04) * TEETH - 0.8);
  const tie = tip(TIE_K);
  plan.STRAND.copy(tie);
  // ---- the rest of the shrub: stems from one root, leaves along them, all of it to the left of the last frame
  const root = new THREE.Vector3(PLANT.x, PLANT.y - 0.1, PLANT.z);
  const stems = [];
  const wood = [];
  const stemTo = (pts, r0) => {
    const c = new THREE.CatmullRomCurve3(pts);
    wood.push(new THREE.TubeGeometry(c, 14, r0, 6, false));
    stems.push(c);
  };
  const up = (x, y, z) => new THREE.Vector3(root.x + RIGHT.x * x + VIEW.x * z, root.y + y, root.z + RIGHT.z * x + VIEW.z * z);
  stemTo([root.clone(), up(0.03, 0.55, 0.02), up(0.1, 1.05, 0.06), O.clone().addScaledVector(RIGHT, -0.02)], 0.016);
  stemTo([root.clone(), up(-0.12, 0.5, 0.1), up(-0.3, 1.0, 0.3), up(-0.42, 1.5, 0.42)], 0.014);
  stemTo([root.clone(), up(-0.1, 0.45, -0.12), up(-0.34, 0.85, -0.3), up(-0.6, 1.2, -0.4)], 0.013);
  stemTo([root.clone(), up(0.02, 0.6, 0.2), up(-0.05, 1.1, 0.5), up(-0.1, 1.75, 0.62)], 0.012);
  const n = ctx.quality.level > 0 ? 17 : 11;
  const tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const c = stems[i % stems.length];
    const t = 0.35 + 0.65 * rnd();
    const o = c.getPoint(t);
    const a = rnd() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0.25 + 0.5 * rnd(), Math.sin(a)).normalize();
    const len = 0.7 + 0.75 * rnd();
    // nothing of it may come between the lens and the animal at the end, or hang behind the strand
    tmp.copy(o).addScaledVector(dir, len * 0.6).sub(GRIP);
    if (tmp.dot(RIGHT) > -0.55 - 0.3 * len) continue;
    leaves.push(leaf(o, dir, UP, len, len * (0.3 + 0.12 * rnd()), { roll: (rnd() - 0.5) * 0.9, droop: 0.5 + 0.9 * rnd(), lift: 0.1, ns: 16, nv: 6 }));
  }
  const leafGeo = ctx.track(mergeGeometries(leaves));
  for (const g of leaves) g.dispose();
  const uniforms = { ...U.air, uSkyUp: U.uSkyUp };
  const leafMesh = new THREE.Mesh(leafGeo, ctx.track(new THREE.ShaderMaterial({ vertexShader: LEAF_VERT, fragmentShader: LEAF_FRAG, uniforms, side: THREE.DoubleSide })));
  // (its toothed margin is cut in the shader and laid over what is behind it, so it is drawn with the clear things)
  const hangMesh = new THREE.Mesh(
    hang,
    ctx.track(
      new THREE.ShaderMaterial({
        vertexShader: HLEAF_VERT,
        fragmentShader: HLEAF_FRAG,
        uniforms: { ...uniforms, uAxis: { value: X.clone() }, uGrip: { value: new THREE.Vector4(GRIP.x, GRIP.y, GRIP.z, HL.len * 0.9) } },
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
      }),
    ),
  );
  hangMesh.renderOrder = 6;
  const woodGeo = ctx.track(mergeGeometries(wood.map((g) => { const o2 = new THREE.BufferGeometry(); o2.setAttribute('position', g.attributes.position); o2.setAttribute('normal', g.attributes.normal); o2.setIndex(g.index); return o2; })));
  for (const g of wood) g.dispose();
  const woodMesh = new THREE.Mesh(woodGeo, ctx.track(new THREE.ShaderMaterial({ vertexShader: WOOD_VERT, fragmentShader: WOOD_FRAG, uniforms })));
  leafMesh.renderOrder = woodMesh.renderOrder = 6;

  // ---- the strand
  const LEN = Math.max(0.6, tie.y - PLANT.y - 0.05);
  const SEG = 48;
  const sp = new Float32Array((SEG + 1) * 2 * 3);
  const si = [];
  for (let j = 0; j <= SEG; j++) {
    sp.set([-1, j / SEG, 0, 1, j / SEG, 0], j * 6);
    if (j < SEG) {
      const a = j * 2;
      si.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const sgeo = ctx.track(new THREE.BufferGeometry());
  sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sgeo.setIndex(si);
  const su = {
    ...uniforms,
    uRes: U.uRes,
    uPpm: U.uPpm,
    uCamR: U.uCamR,
    uCamU: U.uCamU,
    uCamB: U.uCamB,
    uTop: { value: tie.clone() },
    uAcross: { value: RIGHT.clone() },
    uLen: { value: LEN },
    uSwayT: { value: 0 },
    uShift: { value: 0 },
    uHot: { value: 0.2 },
    uBig: { value: 1 },
    uLeafDir: { value: new THREE.Vector3(0, 1, 0) },
  };
  const strand = new THREE.Mesh(sgeo, ctx.track(new THREE.ShaderMaterial({ vertexShader: STRAND_VERT, fragmentShader: STRAND_FRAG, uniforms: su, transparent: true, depthWrite: true, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor })));
  strand.renderOrder = 26;

  // ---- the dew: large beads at the spacing the instability sets, one or two satellites between each pair
  const beads = [];
  const mains = [];
  let y = 0.022;
  while (y < LEN + 0.06) {
    const r = 0.008 + 0.005 * rnd() * rnd();
    beads.push(y, r, rnd(), 1);
    mains.push(y);
    const gap = r * (7.5 + 3.5 * rnd());
    const ns = rnd() < 0.3 ? 2 : 1;
    for (let k = 0; k < ns; k++) beads.push(y + gap * ((k + 1) / (ns + 1) + 0.08 * (rnd() - 0.5)), 0.0012 + 0.0011 * rnd(), rnd(), 0);
    y += gap;
  }
  const bgeo = ctx.track(new THREE.InstancedBufferGeometry());
  bgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  bgeo.setIndex([0, 1, 2, 0, 2, 3]);
  bgeo.setAttribute('aB', new THREE.InstancedBufferAttribute(new Float32Array(beads), 4));
  bgeo.instanceCount = beads.length / 4;
  bgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const bead = new THREE.Mesh(bgeo, ctx.track(new THREE.ShaderMaterial({ vertexShader: BEAD_VERT, fragmentShader: BEAD_FRAG, uniforms: su, transparent: true, depthWrite: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor })));
  bead.renderOrder = 27;
  // ---- and the water the leaf itself has put out, one bead to a tooth (not every tooth, and no two the same)
  const gut = [];
  const gseed = [];
  const q = new THREE.Vector3();
  for (let k = 5; k < TEETH - 4; k++) {
    if (k === TIE_K || rnd() < 0.24) continue;
    tip(k, q);
    const big = rnd();
    gut.push(q.x, q.y, q.z, 0.0016 + 0.0022 * rnd() + (big > 0.86 ? 0.0026 : 0));
    gseed.push(rnd());
  }
  const ggeo = ctx.track(new THREE.InstancedBufferGeometry());
  ggeo.setAttribute('position', bgeo.attributes.position);
  ggeo.setIndex(bgeo.index);
  ggeo.setAttribute('aC', new THREE.InstancedBufferAttribute(new Float32Array(gut), 4));
  ggeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(gseed), 1));
  ggeo.instanceCount = gseed.length;
  ggeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const gutMesh = new THREE.Mesh(ggeo, ctx.track(new THREE.ShaderMaterial({ vertexShader: GUT_VERT, fragmentShader: BEAD_FRAG, uniforms: su, transparent: true, depthWrite: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor })));
  gutMesh.renderOrder = 27;
  group.add(leafMesh, hangMesh, woodMesh, strand, bead, gutMesh);
  for (const m of group.children) m.frustumCulled = false;

  return {
    group,
    tie,
    length: LEN,
    /** how swollen the large beads on the strand are (1 = as the night left them) */
    big: su.uBig,
    /**
     * Put the bead that has the sun in it `ndcY` of the way up the frame (the strand's beads are slid along it by at
     * most half a spacing to do so). A function of the lens only.
     */
    aim(camera, ndcY, t) {
      su.uSwayT.value = t;
      const d = tie.distanceTo(camera.position);
      const fwd = camera.getWorldDirection(tmp);
      const dist = Math.max(0.1, (tie.x - camera.position.x) * fwd.x + (tie.z - camera.position.z) * fwd.z) / Math.max(1e-3, Math.hypot(fwd.x, fwd.z));
      // height of the line of sight through ndcY, where it meets the strand
      const half = Math.tan((camera.fov * Math.PI) / 360);
      const pitch = Math.asin(fwd.y);
      const want = camera.position.y + dist * Math.tan(pitch + Math.atan(ndcY * half));
      const depth = tie.y - want;
      let best = mains[0];
      for (const m of mains) if (Math.abs(m - depth) < Math.abs(best - depth)) best = m;
      su.uShift.value = Math.max(-0.04, Math.min(0.04, depth - best));
      su.uHot.value = depth;
      return d;
    },
  };
}

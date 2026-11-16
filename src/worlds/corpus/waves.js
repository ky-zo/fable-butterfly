// The sea state. One definition, two implementations: GLSL (every vertex + every water pixel) and JS
// (camera bob, pointer → water intersection). A sum of trochoidal (Gerstner) waves with wind spread; the
// horizontal motion is what makes lines of text stretch on the faces and bunch at the crests.

const G = 9.81;
export const TIME_SCALE = 0.55; // the sea runs in slight slow motion
export const WIND = Math.atan2(0.2, 1.0); // dominant travel direction, angle from +Z (towards the viewer)

// [wavelength m, amplitude m, direction offset from the wind in degrees]
const GEO = [
  [38.0, 0.62, 6],
  [23.0, 0.36, -19],
  [14.5, 0.215, 24],
  [9.2, 0.13, -36],
  [5.9, 0.078, 41],
  [3.7, 0.046, -11],
  [2.3, 0.027, 57],
  [1.45, 0.0155, -52],
];
function build(table, seed) {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return table.map(([lambda, amp, deg]) => {
    const a = WIND + (deg * Math.PI) / 180;
    const k = (2 * Math.PI) / lambda;
    return { dx: Math.sin(a), dz: Math.cos(a), k, amp, omega: Math.sqrt(G * k) * TIME_SCALE, phase: rnd() * Math.PI * 2, lambda };
  });
}

export const WAVES = build(GEO, 4711);
const WARP_FROM = 4; // waves from this index on run through a slowly warped domain (see seaWarp)
export const NRIP = 6;
export const RIP_SPEED = 1.15;
export const RIP_K = (2 * Math.PI) / 0.62;

// Short waves fade out of the geometry where the mesh can no longer carry them (the per-pixel normal keeps them).
export const LOD_A = 5.0;
export const LOD_B = 9.0;

const f = (x) => {
  const t = x.toFixed(6);
  return t.includes('.') ? t : t + '.0';
};
const arr4 = (name, list) => `const vec4 ${name}[${list.length}] = vec4[${list.length}](${list.map((w) => `vec4(${f(w.dx)}, ${f(w.dz)}, ${f(w.k)}, ${f(w.amp)})`).join(', ')});`;
const arr2 = (name, list) => `const vec2 ${name}[${list.length}] = vec2[${list.length}](${list.map((w) => `vec2(${f(w.omega)}, ${f(w.phase)})`).join(', ')});`;

export const SEA_GLSL = /* glsl */ `
#ifndef CORPUS_SEA
#define CORPUS_SEA
#define NW ${WAVES.length}
#define NRIP ${NRIP}
${arr4('WV', WAVES)}
${arr2('WT', WAVES)}
uniform float uSteep;          // amplitude multiplier (rises when the sea is asked to break)
uniform vec4 uRip[NRIP];       // ripple rings: x, z, age (s), amplitude (m)
#ifndef CORPUS_CAM
#define CORPUS_CAM
uniform vec3 uCam;
#endif

// ring ripples spreading from recalled places. returns height, writes d/dx, d/dz
float seaRipple(vec2 b, out vec2 grad){
  float h = 0.0;
  grad = vec2(0.0);
  for (int i = 0; i < NRIP; i++) {
    vec4 rp = uRip[i];
    if (rp.w <= 0.00001) continue;
    vec2 dv = b - rp.xy;
    float r = length(dv) + 1e-4;
    float R = 0.15 + rp.z * ${f(RIP_SPEED)};
    float u = r - R;
    float wd = 0.42 + 0.11 * rp.z;
    float env = exp(-(u * u) / (wd * wd));
    if (env < 0.002) continue;
    float ph = ${f(RIP_K)} * u;
    float amp = rp.w / (1.0 + 0.3 * R);
    float c = cos(ph);
    h += amp * env * c;
    float dhdr = amp * env * (-2.0 * u / (wd * wd) * c - ${f(RIP_K)} * sin(ph));
    grad += dhdr * dv / r;
  }
  return h;
}

// A slow warp of the domain for the shorter waves, so two of them can never line up into a regular lattice.
vec2 seaWarp(vec2 b, float t){
  return b + (noise4(b * 0.15 + vec2(0.0, t * 0.012)).rg - 0.5) * 1.3;
}
#define WARP_FROM ${WARP_FROM}

float seaRing;   // set by seaEval: height of the recall ripples alone at that point (m)

// Displaced point, frame and Jacobian for a point b of the undisplaced sea at time t.
// dist = distance to the camera, used to drop waves the mesh cannot resolve.
void seaEval(vec2 b, float t, float dist, out vec3 P, out vec3 N, out vec3 Ta, out vec3 Tb, out float J){
  float hx = 0.0, hz = 0.0, sxx = 0.0, szz = 0.0, sxz = 0.0;
  vec3 D = vec3(0.0);
  vec2 bw = seaWarp(b, t);
  for (int i = 0; i < NW; i++) {
    vec4 w = WV[i];
    float lam = 6.2831853 / w.z;
    float fd = 1.0 - smoothstep(lam * ${f(LOD_A)}, lam * ${f(LOD_B)}, dist);
    if (fd <= 0.0) continue;
    float ph = w.z * dot(w.xy, i >= WARP_FROM ? bw : b) - WT[i].x * t + WT[i].y;
    float s = sin(ph), c = cos(ph);
    float A = w.w * uSteep * fd;
    float ka = w.z * A;
    D.xz -= w.xy * (A * s);
    D.y += A * c;
    hx += ka * w.x * s;
    hz += ka * w.y * s;
    sxx += ka * w.x * w.x * c;
    szz += ka * w.y * w.y * c;
    sxz += ka * w.x * w.y * c;
  }
  vec2 rg;
  float rh = seaRipple(b, rg);
  seaRing = rh;
  D.y += rh;
  hx -= rg.x;
  hz -= rg.y;
  P = vec3(b.x, 0.0, b.y) + D;
  Ta = vec3(1.0 - sxx, -hx, -sxz);
  Tb = vec3(-sxz, -hz, 1.0 - szz);
  J = (1.0 - sxx) * (1.0 - szz) - sxz * sxz;
  N = normalize(vec3(hx * (1.0 - szz) + hz * sxz, J, hz * (1.0 - sxx) + hx * sxz));
}
#endif
`;

// ------------------------------------------------------------------------------------------- CPU mirror

const _o = { x: 0, y: 0, z: 0 };
let warpData = null;
let warpN = 256;
/** Hand over the red/green channels of the shared noise lattice (see shared.js) so seaWarp matches the GLSL one. */
export function setWarpNoise(rg, n) {
  warpData = rg;
  warpN = n;
}
const _w = { x: 0, z: 0 };
function seaWarp(bx, bz, t) {
  if (!warpData) {
    _w.x = bx;
    _w.z = bz;
    return _w;
  }
  const n = warpN;
  const px = bx * 0.15;
  const pz = bz * 0.15 + t * 0.012;
  const ix = Math.floor(px);
  const iz = Math.floor(pz);
  let fx = px - ix;
  let fz = pz - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const x0 = ((ix % n) + n) % n;
  const z0 = ((iz % n) + n) % n;
  const x1 = (x0 + 1) % n;
  const z1 = (z0 + 1) % n;
  const a = (z0 * n + x0) * 2;
  const b = (z0 * n + x1) * 2;
  const c = (z1 * n + x0) * 2;
  const d = (z1 * n + x1) * 2;
  const r = (warpData[a] * (1 - fx) + warpData[b] * fx) * (1 - fz) + (warpData[c] * (1 - fx) + warpData[d] * fx) * fz;
  const g = (warpData[a + 1] * (1 - fx) + warpData[b + 1] * fx) * (1 - fz) + (warpData[c + 1] * (1 - fx) + warpData[d + 1] * fx) * fz;
  _w.x = bx + (r - 0.5) * 1.3;
  _w.z = bz + (g - 0.5) * 1.3;
  return _w;
}

/** Displaced position of base point (bx, bz) at time t, using the first n waves. */
export function seaPoint(bx, bz, t, steep = 1, n = WAVES.length, out = _o) {
  let x = bx;
  let y = 0;
  let z = bz;
  let wx = bx;
  let wz = bz;
  if (n > WARP_FROM) {
    const w = seaWarp(bx, bz, t);
    wx = w.x;
    wz = w.z;
  }
  for (let i = 0; i < n; i++) {
    const w = WAVES[i];
    const ph = w.k * (i >= WARP_FROM ? w.dx * wx + w.dz * wz : w.dx * bx + w.dz * bz) - w.omega * t + w.phase;
    const A = w.amp * steep;
    const s = Math.sin(ph);
    x -= w.dx * A * s;
    z -= w.dz * A * s;
    y += A * Math.cos(ph);
  }
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** Height of the surface above world point (X, Z): inverts the horizontal displacement by fixed-point iteration. */
export function seaHeight(X, Z, t, steep = 1, n = WAVES.length) {
  let bx = X;
  let bz = Z;
  let p = _o;
  for (let it = 0; it < 4; it++) {
    p = seaPoint(bx, bz, t, steep, n, _o);
    bx += X - p.x;
    bz += Z - p.z;
  }
  return seaPoint(bx, bz, t, steep, n, _o).y;
}

/** Base (undisplaced) coordinates of the surface point above world (X, Z). Writes { x, z } into out. */
export function seaInvert(X, Z, t, steep = 1, n = WAVES.length, out = { x: 0, z: 0 }) {
  let bx = X;
  let bz = Z;
  for (let it = 0; it < 5; it++) {
    const p = seaPoint(bx, bz, t, steep, n, _o);
    bx += X - p.x;
    bz += Z - p.z;
  }
  out.x = bx;
  out.z = bz;
  return out;
}

/**
 * Intersect a ray with the moving surface. Returns distance along the ray, or -1 if it misses (looks above the horizon).
 * Marches outward in growing steps against the height field of the long waves, then bisects.
 */
export function seaRay(ox, oy, oz, dx, dy, dz, t, steep = 1, maxDist = 400) {
  if (dy > 0.25) return -1;
  let s0 = 0;
  let s1 = 0.12;
  let found = false;
  for (let it = 0; it < 120 && s1 < maxDist; it++) {
    const h = seaHeight(ox + dx * s1, oz + dz * s1, t, steep, 5);
    if (oy + dy * s1 <= h) {
      found = true;
      break;
    }
    s0 = s1;
    s1 = s1 * 1.09 + 0.06;
  }
  if (!found) return -1;
  for (let it = 0; it < 9; it++) {
    const sm = 0.5 * (s0 + s1);
    const h = seaHeight(ox + dx * sm, oz + dz * sm, t, steep, s1 < 60 ? WAVES.length : 5);
    if (oy + dy * sm <= h) s1 = sm;
    else s0 = sm;
  }
  return 0.5 * (s0 + s1);
}

// LATENT — shared constants: where things are kept, the line the butterfly flies, what happens when (all by progress).
// Everything that both the JS side (camera, hero, audio) and the GLSL side (simulation, render) must agree on lives here.
//
// The map is organised by meaning, not by place. Five regions, in the order they are visited:
//   FERN  shelter      a fern: the first thing the loosened facets settle into
//   FOOD  food         flowers (with the marks only it can see), a bud, water beads
//   EYE   danger       a bird's eye and the feathers that go with it
//   PANE  the glass    a flat sheet it cannot pass; the other one, and the garden, beyond
//   COLD  the one that is unlike the rest: a blue-white disc over dark ripples. World 03 opens on it.

import * as THREE from 'three';

export const NS = 5;
export const ST = { FERN: 0, FOOD: 1, EYE: 2, PANE: 3, COLD: 4 };

/** The sun compass: one fixed bright direction. Everything in here leans on it a little. */
export const SUN = new THREE.Vector3(0.13, 0.155, -0.98).normalize();

/** The butterfly against life: one model millimetre is MM world units (a 59 mm wingspan is 1.6 units). */
export const SIZE = 27;
export const MM = 0.001 * SIZE;

const sm = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const smooth = sm;
const sm5 = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/** up over [a,b], down over [c,d] */
export const window4 = (x, a, b, c, d) => sm(a, b, x) * (1 - sm(c, d, x));

const hex = (h) => {
  const c = new THREE.Color(h); // sRGB hex → linear working space
  return [c.r, c.g, c.b];
};

// ---------------------------------------------------------------------------------------------------------------
// Palettes. Each region owns four three-colour ramps (a point carries which ramp, and where along it).

export const WHITE = hex('#fff0dc');
const RAMPS = [
  // FERN: frond · (unused ×3)
  ['#1f8a4c', '#9fdc6a', '#f6d67a'], ['#1f8a4c', '#9fdc6a', '#f6d67a'], ['#1f8a4c', '#9fdc6a', '#f6d67a'], ['#1f8a4c', '#9fdc6a', '#f6d67a'],
  // FOOD: petal as anyone sees it · the ultraviolet marks · stem and leaf · stamens, water
  ['#e9a22c', '#ffd25e', '#fff0bd'], ['#4a2cf0', '#8f6bff', '#efe4ff'], ['#1c7a44', '#7fcf63', '#e6dc7c'], ['#ffe2a0', '#fff6e2', '#cfe6ff'],
  // EYE: iris · the light in it · feathers · the lid
  ['#a8480f', '#f0a22a', '#ffe9a8'], ['#dfeaff', '#f4f8ff', '#ffffff'], ['#f1e6d4', '#c79a62', '#7d6044'], ['#5a3a1c', '#b98a44', '#ecd9a6'],
  // PANE: the sheet · beads of water · steel · the garden beyond
  ['#6f9a90', '#b9d6cc', '#f2f6ee'], ['#cfe8e2', '#f6fbf6', '#ffffff'], ['#5d7480', '#a9bcc4', '#e8eef0'], ['#2c8f4c', '#a8dc6c', '#f6d67a'],
  // COLD: water · the disc · the road of glitter · the same road nearer the viewer than the last frame shows
  ['#0d2a5c', '#3566b4', '#9cc0ff'], ['#9db9ff', '#dbe7ff', '#f6f9ff'], ['#a9c6ff', '#eaf1ff', '#ffffff'], ['#3566b4', '#bcd2ff', '#ffffff'],
  // 20 dust · 21 the far web · 22 scent
  ['#ffd9a0', '#f1ecd9', '#b9cdfa'],
  ['#e9c47a', '#b9d68e', '#8fb4e8'],
  ['#ffe2a0', '#e2f0a6', '#fff6de'],
];
export const PAL = { DUST: 20, WEB: 21, PLUME: 22, UV: ST.FOOD * 4 + 1, MOON: ST.COLD * 4 + 1, ROAD: ST.COLD * 4 + 2, NEAR: ST.COLD * 4 + 3 };
export const N_PAL = RAMPS.length;

/** Flat array of N_PAL ramps × 3 colours (linear RGB) for the render shader. */
export function paletteUniform() {
  const out = [];
  for (const r of RAMPS) for (const h of r) out.push(new THREE.Vector3(...hex(h)));
  return out;
}
/** The tint each region lends to the air around it. */
export const REGION_TINT = [RAMPS[0][1], RAMPS[4][1], RAMPS[8][1], RAMPS[12][1], RAMPS[17][1]].map((h) => new THREE.Vector3(...hex(h)));

// ---------------------------------------------------------------------------------------------------------------
// Where things are kept. Each region has a centre and a frame (columns: right, up, normal — a form faces `normal`).

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const frameOf = (normal, upHint = v3(0, 1, 0)) => {
  const n = normal.clone().normalize();
  const r = new THREE.Vector3().crossVectors(upHint, n).normalize();
  const u = new THREE.Vector3().crossVectors(n, r);
  return { r, u, n, m: new THREE.Matrix3().set(r.x, u.x, n.x, r.y, u.y, n.y, r.z, u.z, n.z) };
};

// The last picture is built in its own frame: the lens at END.o, level but for a small downward pitch, looking along
// END.f at a disc 400 units off. World 03 opens on exactly this, so the numbers are the brief's:
//   disc centre 36 % of the frame height from the top, diameter 9 % of it; the butterfly at 62 %; one lens for
//   every shape of screen (the vertical field of view does not change with aspect in this shot).
export const END_FOV = 34;
const TAN = Math.tan((END_FOV * Math.PI) / 360);
const HORIZON = 0.42; // of the frame height from the top: where the water meets the dark
const pitch = Math.atan((1 - 2 * HORIZON) * TAN); // the lens looks down by this much
const elev = (frac) => Math.atan((1 - 2 * frac) * TAN) - pitch; // elevation above the horizon of a height in the frame
export const END = {
  o: v3(-132, 4, -118),
  f: v3(-1, 0, 0),
  pitch,
  moonDist: 400,
  moonElev: elev(0.36),
  moonRadius: 0.5 * 0.09 * 2 * TAN * 400 * Math.cos(elev(0.36)),
  water: -5.0, // the water lies this far below the lens
  heroRange: 22,
  heroElev: elev(0.632), // (the middle of its body; its wings stand above that, so the animal as a whole sits at 62 %)
};
// local frame of the last picture: x right, y up, z toward the viewer
const endFrame = frameOf(END.f.clone().negate());
/** A point given in the last picture's frame (x right, y up, z toward the viewer) → the world. */
export const endPoint = (x, y, z, out = new THREE.Vector3()) => out.copy(END.o).addScaledVector(endFrame.r, x).addScaledVector(endFrame.u, y).addScaledVector(endFrame.n, z);
export const MOON_LOCAL = v3(0, Math.tan(END.moonElev) * END.moonDist, -END.moonDist);
export const HERO_END = endPoint(0, Math.sin(END.heroElev) * END.heroRange, -Math.cos(END.heroElev) * END.heroRange);
export const CAM_END_LOOK = endPoint(0, -Math.tan(END.pitch) * 100, -100);
/** Centre of the cold disc, in the world. */
export const MOON_WORLD = endPoint(MOON_LOCAL.x, MOON_LOCAL.y, MOON_LOCAL.z);
/** When the rest goes dark: the first region goes out at WINK[0], the last by WINK[0] + WINK[1] (progress). */
export const WINK = [0.795, 0.15];

export const STATIONS = [
  { name: 'fern', c: v3(-6.6, -0.6, -27), ...frameOf(v3(0.5, 0.08, 1)), loose: [1.35, 7.0], sway: [0.06, 0.55, -2.2, 0.5] },
  { name: 'food', c: v3(6.4, 0.9, -58), ...frameOf(v3(-0.3, 0.5, 0.82)), loose: [1.4, 8.0], sway: [0.012, 0.4, -6.0, 0.3] },
  { name: 'eye', c: v3(-21, 9.5, -97), ...frameOf(v3(17, -3, 13)), loose: [1.25, 12.0], sway: [0, 0, 0, 0] },
  { name: 'pane', c: v3(10, 3.2, -128), ...frameOf(v3(0, 0, 1)), loose: [1.0, 5.0], sway: [0, 0, 0, 0] },
  { name: 'cold', c: END.o.clone(), ...endFrame, loose: [1.0, 26.0], sway: [0, 0, 0, 0] },
];
export const PANE = { w: 38, h: 24 };
export const EYE_R = 4.3; // the iris

/** A point given in a region's frame → the world. */
export const inStation = (i, x, y, z, out = new THREE.Vector3()) => {
  const s = STATIONS[i];
  return out.copy(s.c).addScaledVector(s.r, x).addScaledVector(s.u, y).addScaledVector(s.n, z);
};

// ---------------------------------------------------------------------------------------------------------------
// The line of flight, as a pure function of progress. Two rests: on the flower, and on the glass.

export const STAND = 4.0 * MM; // how far the thorax is carried above what it stands on
export const PERCH = [
  // on the face of the big flower, a little off its middle, head toward the middle (it is feeding)
  { from: 0.356, to: 0.43, station: ST.FOOD, at: [0.62, 0.34, 0.2 + STAND], head: [-0.84, -0.5, 0.12] },
  // on the glass, head up
  { from: 0.668, to: 0.75, station: ST.PANE, at: [-1.4, 0.4, STAND], head: [0.1, 1, 0] },
];
for (const k of PERCH) {
  const s = STATIONS[k.station];
  k.pos = inStation(k.station, ...k.at);
  k.n = s.n.clone();
  k.head = v3(0, 0, 0).addScaledVector(s.r, k.head[0]).addScaledVector(s.u, k.head[1]).addScaledVector(s.n, k.head[2]).normalize();
}
const LIFT = 0.022; // progress it takes to get off a perch, or down onto one

/** 0 on a perch … 1 in the air. */
export function airborne(p) {
  let a = 1;
  for (const k of PERCH) a = Math.min(a, 1 - sm(k.from - LIFT, k.from, p) * (1 - sm(k.to, k.to + LIFT, p)));
  return a;
}
/** Which perch it is on, coming down to, or has just left. */
export function perchAt(p) {
  return p < 0.55 ? 0 : 1;
}

const P0 = PERCH[0].pos;
const P1 = PERCH[1].pos;
/** [progress, x, y, z, hold?] — hold: it stops here (no speed through the key). */
const PATH = [
  [0.0, 0, 0, 0, 1],
  [0.05, 0.25, 0.12, -1.3],
  [0.1, 0.6, 0.5, -7],
  [0.16, -0.6, 0.9, -19.5],
  [0.21, 0.6, 1.3, -31],
  [0.27, 3.6, 1.7, -44],
  [0.32, 6.0, 2.6, -53.2],
  [0.345, P0.x + 0.1, P0.y + 0.55, P0.z + 1.1],
  [0.358, P0.x, P0.y, P0.z, 1],
  [0.43, P0.x, P0.y, P0.z, 1],
  [0.455, P0.x - 0.8, P0.y + 1.5, P0.z - 2.2],
  [0.5, -1.5, 5.4, -76],
  [0.545, -4.2, 6.6, -90],
  [0.59, -0.5, 5.6, -106],
  [0.635, 6.2, 4.2, -119.5],
  [0.658, P1.x + 0.3, P1.y + 0.1, P1.z + 1.6],
  [0.67, P1.x, P1.y, P1.z, 1],
  [0.75, P1.x, P1.y, P1.z, 1],
  [0.775, P1.x - 2.5, P1.y + 0.5, P1.z + 2.6],
  [0.83, -22, 4.6, -121],
  [0.91, -86, 3.4, -118.4],
  [1.0, HERO_END.x, HERO_END.y, HERO_END.z],
];

/** Keyed curve through [t, …values, hold?] rows: Catmull-Rom in the keys' own spacing, at rest on a `hold` key. */
export function makeTrack(keys, dims) {
  const n = keys.length;
  const T = keys.map((k) => k[0]);
  const hold = keys.map((k) => !!k[dims + 1]);
  const tangent = (i, c) => {
    if (hold[i]) return 0;
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    return (keys[b][c + 1] - keys[a][c + 1]) / (T[b] - T[a]);
  };
  const M = keys.map((_, i) => Array.from({ length: dims }, (_, c) => tangent(i, c)));
  return (t, out) => {
    t = Math.min(T[n - 1], Math.max(T[0], t));
    let i = 0;
    while (i < n - 2 && t > T[i + 1]) i++;
    const h = T[i + 1] - T[i];
    const f = (t - T[i]) / h;
    const f2 = f * f, f3 = f2 * f;
    const a = 2 * f3 - 3 * f2 + 1, b = f3 - 2 * f2 + f, c2 = -2 * f3 + 3 * f2, d = f3 - f2;
    for (let c = 0; c < dims; c++) out[c] = a * keys[i][c + 1] + b * h * M[i][c] + c2 * keys[i + 1][c + 1] + d * h * M[i + 1][c];
    return out;
  };
}
const pathTrack = makeTrack(PATH, 3);
const _pa = [0, 0, 0];
/** Where the butterfly is on its line at progress p (before the life that time adds). */
export function pathAt(p, out) {
  pathTrack(p, _pa);
  return out.set(_pa[0], _pa[1], _pa[2]);
}

// ---------------------------------------------------------------------------------------------------------------
// What happens when. All of it by progress; scroll back and it un-happens.

export function timeline(p, o = {}) {
  // the mosaic lets go, from where the butterfly is outward; the field comes up behind it
  o.loosen = sm(0.012, 0.15, p) * 1.25;
  o.mosaic = 1 - sm(0.2, 0.3, p);
  o.field = sm(0.03, 0.13, p);
  // how far each region has condensed (0 a loose cloud … 1 the thing)
  o.cond = o.cond || [0, 0, 0, 0, 0];
  o.cond[ST.FERN] = window4(p, 0.045, 0.15, 0.27, 0.37);
  o.cond[ST.FOOD] = window4(p, 0.17, 0.29, 0.47, 0.57);
  o.cond[ST.EYE] = window4(p, 0.405, 0.49, 0.585, 0.67);
  o.cond[ST.PANE] = window4(p, 0.5, 0.62, 0.83, 0.93);
  // (the cold one starts to gather while it is still on the glass, and is water under it before it gets there)
  o.cond[ST.COLD] = sm(0.69, 0.885, p);
  // scent: the plume it follows upwind to the flowers
  o.plume = window4(p, 0.06, 0.13, 0.35, 0.45);
  // the marks only it can see come up as it nears the flower
  o.uv = window4(p, 0.285, 0.35, 0.47, 0.53);
  // feet down: the form answers from where it stands
  o.touch = [window4(p, 0.352, 0.362, 0.425, 0.437), window4(p, 0.664, 0.674, 0.745, 0.757)];
  // down on the flower, what is under it and round it is taken down so that it can be seen (render.js)
  o.shade = window4(p, 0.3, 0.35, 0.435, 0.47);
  // the other one, on the far side of the glass
  o.mate = window4(p, 0.56, 0.65, 0.81, 0.9);
  // the cold disc swells; everything that is not cold goes dark
  o.moon = 0.26 + 0.74 * (0.45 * sm(0.75, 0.9, p) + 0.55 * sm5(0.8, 1.0, p));
  o.fin = sm(0.82, 0.975, p);
  // …and it does not go dark all at once: region by region, each in its own time (render.js), between these two
  o.wink = p;
  // how much of the cold light falls on the animal: one side of it cold, the side toward what it is leaving still warm
  o.rim = sm(0.765, 0.86, p) * (1 - 0.45 * sm(0.95, 1.0, p));
  return o;
}

/** Rows of the simulation texture given to each population, per quality level. */
export function layout(level) {
  const W = [512, 768, 1024][level];
  const k = W / 1024;
  const band = [64, 128, 104, 96, 120].map((r) => Math.round(r * k)); // rows per region, in ST order
  const Hf = band.reduce((a, b) => a + b, 0);
  const Hp = Math.round(48 * k); // scent
  const Hd = Math.round(160 * k); // near dust (wraps around the camera)
  const Hw = W - Hf - Hp - Hd; // the far web
  const start = [];
  let acc = 0;
  for (const b of band) {
    start.push(acc);
    acc += b;
  }
  return { W, H: W, band, start, Hf, Hp, Hd, Hw, N: W * W };
}

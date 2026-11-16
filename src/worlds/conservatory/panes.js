// The glazing schedule. This house was glazed once and repaired for a century: every pane between two bars has its own
// kind of glass. The table lives in a uniform array (one vec4 per pane) that the glass, the condensation and the
// dressing bake all read, so "what is this pane" has exactly one answer.
//
//   x  type      0 old sheet · 1 reeded / fluted · 2 drawn (wavy) · 3 hammered · 4 Georgian wired · 5 etched border
//                6 cracked, taped · 7 replaced (new float glass)
//   y  param     reeded: flute pitch in metres
//   z  fog       how readily this pane fogs (multiplies the condensation target)
//   w  age       0 new and clean … 1 a hundred years of weather

import * as THREE from 'three';

export const P = { SHEET: 0, REED: 1, DRAWN: 2, HAMMER: 3, WIRED: 4, ETCH: 5, CRACK: 6, NEW: 7 };
export const NPANE = 30;

const sheet = (fog = 1, age = 1) => [P.SHEET, 0, fog, age];
const reed = (pitch, fog = 0.62, age = 0.8) => [P.REED, pitch, fog, age];
const drawn = (fog = 0.95, age = 1) => [P.DRAWN, 0, fog, age];
const hammer = (fog = 0.8, age = 0.9) => [P.HAMMER, 0, fog, age];
const wired = (fog = 0.9, age = 1) => [P.WIRED, 0, fog, age];
const etch = (fog = 0.62, age = 0.7) => [P.ETCH, 0, fog, age];
const crack = (fog = 0.9, age = 1) => [P.CRACK, 0, fog, age];
const fresh = (fog = 0.5, age = 0.08) => [P.NEW, 0, fog, age];

const WIDE = 0.036; // fluted
const FINE = 0.0125; // reeded

// [lower pane, upper pane] per bay, from the door (s = 0) to the end wall (s = 15).
// Sunlit wall: fluted glass wherever the low sun stands behind it; the landing pane (bay 8) is the best-kept old
// drawn sheet in the house, flanked by reeds.
const LEFT = [
  [drawn(), sheet()],
  [reed(WIDE), drawn()],
  [sheet(), wired()],
  [hammer(), hammer()],
  [reed(FINE), reed(FINE)],
  [crack(), sheet()],
  [reed(WIDE, 0.58), fresh(0.1, 0.04)], // (the upper pane here is the newest in the house: the low sun comes straight through it)
  [etch(), wired()],
  [drawn(0.92, 0.75), sheet()],
  [reed(FINE, 0.6), reed(FINE)],
  [fresh(), sheet()],
  [hammer(), wired()],
  [reed(WIDE), drawn()],
  [drawn(), sheet()],
  [sheet(), sheet()],
];
// Shade wall: older, plainer; wired and hammered glass read well against its even cool glow.
const RIGHT = [
  [sheet(), sheet()],
  [wired(), sheet()],
  [drawn(), drawn()],
  [sheet(1, 0.9), sheet()], // (kept plain: this is where the sun from across the corridor lands, and a shadow in it)
  [etch(0.7), wired()],
  [reed(FINE, 0.7), hammer()],
  [hammer(), sheet()],
  [drawn(), wired()],
  [reed(WIDE, 0.7), drawn()],
  [crack(), sheet()],
  [drawn(1, 0.9), sheet()],
  [drawn(1, 0.85), wired()],
  [fresh(0.6), sheet()],
  [wired(), drawn()],
  [sheet(), sheet()],
];
const END = [[drawn(1, 0.7), sheet()]];

/** Fractures, as polylines in wall metres (each cracked pane was struck once; the lines run out from there). */
const CRACK_LINES = [
  [
    [[5.3, 0.62], [5.47, 0.93], [5.6, 1.28], [5.78, 1.62], [5.97, 2.02]],
    [[5.3, 0.62], [5.16, 0.4], [5.03, 0.2]],
    [[5.3, 0.62], [5.52, 0.55], [5.8, 0.44], [5.98, 0.3]],
    [[5.47, 0.93], [5.38, 1.12]],
  ],
  [
    [[9.62, 1.2], [9.8, 1.45], [9.97, 1.63]],
    [[9.62, 1.2], [9.45, 1.02], [9.25, 0.95], [9.03, 0.8]],
    [[9.62, 1.2], [9.66, 0.9], [9.6, 0.55], [9.7, 0.2]],
    [[9.45, 1.02], [9.4, 1.22]],
  ],
  [],
];
/** The tape that holds them: [ax, ay, bx, by] in wall metres. */
const TAPES = [
  [[5.43, 0.85, 5.63, 1.34], [5.44, 0.585, 5.84, 0.42]],
  [[9.7, 1.31, 9.93, 1.6], [9.52, 1.07, 9.2, 0.92]],
  [],
];
export const NCRACK = 10;

/** Snail trails on the outside of the lower panes: [s0, s1, t at s0, slope]. */
const SNAILS = [
  [[2.1, 2.95, 1.25, -0.3], [8.08, 8.95, 0.62, 0.18], [10.1, 11.4, 1.0, 0.25], [12.9, 13.9, 1.3, -0.4]],
  [[3.1, 3.9, 0.9, 0.3], [6.2, 7.6, 1.2, -0.2], [10.1, 10.95, 1.5, -0.25], [12.1, 12.9, 0.8, 0.5]],
  [[0.3, 1.7, 0.75, 0.3], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
];

/** Uniform values for wall `i` (0 left, 1 right, 2 end): { uPane, uTape, uCrack, uSnail }. */
export function paneUniforms(i) {
  const src = [LEFT, RIGHT, END][i];
  const arr = [];
  for (let k = 0; k < NPANE / 2; k++) {
    const bay = src[Math.min(k, src.length - 1)];
    const lower = new THREE.Vector4(...bay[0]);
    // (+8 on the type marks a pane that a snail has crossed)
    if (SNAILS[i].some(([s0, s1]) => s1 > s0 && (i === 2 || (s0 < k + 1 && s1 > k)))) lower.x += 8;
    arr.push(lower, new THREE.Vector4(...bay[1]));
  }
  const tape = [0, 1].map((k) => new THREE.Vector4(...(TAPES[i][k] || [0, -9, 0, -9])));
  const segs = [];
  for (const line of CRACK_LINES[i]) for (let k = 1; k < line.length; k++) segs.push(new THREE.Vector4(...line[k - 1], ...line[k]));
  while (segs.length < NCRACK) segs.push(new THREE.Vector4(0, -9, 0, -9));
  return { uPane: { value: arr }, uTape: { value: tape }, uCrack: { value: segs.slice(0, NCRACK) }, uSnail: { value: SNAILS[i].map((t) => new THREE.Vector4(...t)) } };
}

/** GLSL: the table lookup and pane-local coordinates. Needs layoutGLSL. */
export const paneGLSL = /* glsl */ `
#ifndef CV_PANES
#define CV_PANES
uniform vec4 uPane[${NPANE}];
// For a point of wall \`wall\` (0 left, 1 right, 2 end; anything else = untabled glass):
// pl = metres from the lower-left corner of its pane (bar centre lines), psz = size of that pane, row = 0 lower / 1 upper.
vec4 paneAt(int wall, vec2 st, out vec2 pl, out vec2 psz, out float row){
  row = 0.0;
  if (wall < 2) {
    float bay = clamp(floor(st.x / BAY), 0.0, ${NPANE / 2 - 1}.0);
    row = step(TRANSOM - Y0, st.y);
    pl = vec2(st.x - bay * BAY, st.y - row * (TRANSOM - Y0));
    psz = vec2(BAY, mix(TRANSOM - Y0, EAVE - TRANSOM, row));
    return uPane[int(bay) * 2 + int(row)];
  }
  pl = st; psz = vec2(END_W, WALL_H);
  if (wall == 2) return uPane[0];
  return vec4(0.0, 0.0, 1.0, 1.0);
}
// Distance (m) from the nearest bar to this point of glass (negative = behind steel). x: to a mullion / post,
// y: to the sill, transom or head.
vec2 paneEdge(int wall, vec2 pl, vec2 psz, float row){
  if (wall < 2) {
    float ex = min(pl.x, psz.x - pl.x) - 0.026;
    float ey = min(pl.y - mix(0.035, 0.022, row), psz.y - pl.y - mix(0.022, 0.035, row));
    return vec2(ex, ey);
  }
  return vec2(min(pl.x, psz.x - pl.x) - 0.05, min(pl.y - 0.035, psz.y - pl.y - 0.03));
}
uniform vec4 uCrack[${NCRACK}];
// distance (m) to the nearest fracture line of this wall. Each line wanders a little: glass does not break straight.
float crackDist(vec2 st, sampler2D nz){
  vec2 p = st + (texture2D(nz, st * 1.9).rg - 0.5) * 0.014;
  float d = 1e3;
  for (int i = 0; i < ${NCRACK}; i++) {
    vec2 a = uCrack[i].xy, ba = uCrack[i].zw - a, pa = p - a;
    d = min(d, length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0)));
  }
  return d;
}
#endif
`;

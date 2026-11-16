// DATA · the wings of a glasswing (Greta oto), as drawn from a set specimen.
//
// Units and frame: millimetres, in the wing's own flat frame. The origin is the hinge (where the wing joins the
// thorax), +x runs out along the wing toward the tip, +y toward its leading edge (the costa). A forewing is 29.5 mm
// long and under 12 mm deep, a hindwing 20 mm. Both wings are described for the RIGHT side; the left is the mirror image (the rig does that).
//
//   wingOutline(hind, n)    the margin as a closed polyline, optionally with a few weeks of wear
//   wingVeins(hind)         the venation of a nymphalid as named polylines with a radius at each end
//   veinSegments(hind)      the same as short straight pieces (what the atlas is drawn from)
//   borderAt(hind, x, y)    how wide the band of scales along the margin is there, and how much of it is ember
//   wingCells(hind)         the clear cells between the veins: centroid, area, and a lookup "which cell is this point in"
//   pigmentAt(hind, x, y)   vein / border / membrane weights of a point (CPU twin of the wing shader's pigment field)

/** Atlas mapping shared by the vein bake, the wing shader and the shadow: uv = (p_mm * px + origin) / size. */
export const ATLAS = { size: 1024, px: 32, fore: [32, 290], hind: [32, 780] };

// The forewing of an ithomiine: long and narrow, the leading edge a gentle arc, the tip rounded and drawn out, the outer
// margin straight to slightly hollow (it is the hollow that makes the wing read as elegant rather than as a paddle).
const FORE_OUTLINE = [
  [0, 0], [1.5, 0.95], [4, 1.85], [8, 2.8], [13, 3.55], [18, 3.95], [22, 3.9], [25.4, 3.35], [27.9, 2.2], [29.3, 0.75],
  [29.6, -0.75], [28.7, -2.05], [26.55, -3.0], [24.5, -3.9], [22.5, -4.9], [20.5, -5.95], [18.6, -6.95], [16.8, -7.55], [14.8, -7.4], [12, -6.25], [8, -4.45], [4, -2.5], [1.2, -0.9],
];
// The hindwing: a rounded oval whose inner margin lies along the abdomen itself (a fifth of a millimetre from it) for
// two thirds of its length, and then curves away: spread, the two hindwings cradle the abdomen and only its last
// millimetres show in the notch between them; shut, that inner fold stands beside it like the sides of a gutter.
const HIND_OUTLINE = [
  [0, 0], [1.2, 1.25], [3.5, 2.8], [7, 4.25], [11, 4.95], [15, 4.8], [18, 3.6], [19.7, 1.5], [20.1, -1.2], [19.2, -4.0],
  [17.1, -6.5], [14, -8.5], [10.8, -9.6], [8, -9.85], [5.2, -9.8], [2.9, -9.45], [1.3, -8.4], [0.52, -6.3], [0.25, -3.6], [0.26, -1.75],
];

// [radius at the base, radius at the end, …points]. Ends run a little past the margin and are cut by it.
// Hair-fine: a main stem is a sixth of a millimetre across at the base, a branch a fifteenth where it meets the margin.
const FORE_VEINS = [
  [0.12, 0.07, [0, 0.25], [4, 1.7], [8, 2.65], [13, 3.4], [18, 3.8], [22, 3.75], [25.4, 3.2], [27.9, 2.05], [29.25, 0.7]], // costa
  [0.07, 0.04, [0, 0.2], [5, 1.65], [10, 2.65], [15.5, 3.85]], // Sc
  [0.085, 0.06, [0, 0], [5, 1.25], [10, 1.95], [15, 2.3], [17.5, 2.2]], // R stem: the front of the cell
  [0.052, 0.032, [12, 2.14], [16, 3.0], [20.4, 4.05]], // R1
  [0.052, 0.032, [16.2, 2.3], [19.8, 2.95], [24.2, 3.75]], // R2
  [0.06, 0.048, [17.5, 2.2], [20, 2.45], [22.4, 2.5]], // the stalk of R3–R5
  [0.046, 0.03, [22.4, 2.5], [24.8, 2.85], [27.4, 2.8]], // R3
  [0.046, 0.03, [22.4, 2.5], [25.6, 2.05], [29.2, 1.05]], // R4
  [0.046, 0.03, [22.4, 2.5], [26, 1.1], [29.9, -0.6]], // R5
  [0.052, 0.032, [17.5, 2.2], [20.5, 1.3], [24.8, -0.1], [29.4, -2.2]], // M1
  [0.06, 0.06, [17.5, 2.2], [17.25, 1.2], [16.85, 0.2]], // discocellulars: the end of the cell
  [0.06, 0.06, [16.85, 0.2], [16.0, -1.2], [15.5, -2.6]],
  [0.036, 0.02, [16.85, 0.2], [15.6, 0.15], [14.2, 0.0]], // the recurrent vein, into the cell
  [0.052, 0.032, [16.85, 0.2], [19.7, -0.55], [23.2, -1.85], [26.9, -3.4]], // M2
  [0.052, 0.032, [15.5, -2.6], [18.4, -3.1], [21.4, -3.75], [24.3, -4.5]], // M3
  [0.085, 0.06, [0, -0.05], [5, -0.9], [10, -1.9], [13, -2.35], [15.5, -2.6]], // Cu stem: the back of the cell
  [0.052, 0.032, [13, -2.35], [15.8, -3.3], [18.7, -4.5], [21.7, -5.9]], // CuA1
  [0.052, 0.032, [9, -1.72], [12, -2.9], [15.5, -4.8], [19.2, -7.3]], // CuA2
  [0.062, 0.036, [0, -0.2], [5, -2.2], [10, -4.3], [14, -6.2], [16.6, -7.9]], // 1A+2A
];
const HIND_VEINS = [
  [0.085, 0.05, [0, 0.25], [2.6, 1.95], [6, 3.55], [10.5, 4.6], [15, 5.0]], // Sc+R1
  [0.036, 0.024, [1.3, 1.1], [1.6, 1.75], [2.4, 2.4]], // humeral spur
  [0.078, 0.06, [0, 0], [3, 0.9], [6.5, 1.7], [9.5, 2.15]], // front of the cell
  [0.052, 0.032, [9.5, 2.15], [13, 2.85], [16.5, 3.3], [19.4, 3.2]], // Rs
  [0.06, 0.06, [9.5, 2.15], [10.05, 1.2], [10.2, 0.1]], // discocellulars
  [0.06, 0.06, [10.2, 0.1], [9.8, -1.2], [9.0, -2.3]],
  [0.052, 0.032, [10.05, 1.2], [13.5, 1.3], [17, 1.0], [20.6, 0.4]], // M1
  [0.052, 0.032, [10.2, 0.1], [13.5, -0.85], [17, -2.1], [20.2, -3.2]], // M2
  [0.052, 0.032, [9.0, -2.3], [12, -3.6], [15.2, -5.0], [18.4, -6.3]], // M3
  [0.078, 0.06, [0, -0.05], [4.5, -1.2], [7.5, -1.95], [9.0, -2.3]], // back of the cell
  [0.052, 0.032, [7.5, -1.95], [10, -3.9], [12.6, -6.4], [14.6, -8.7]], // CuA1
  [0.052, 0.032, [5, -1.33], [7.2, -3.6], [9, -6.3], [10.5, -10.0]], // CuA2
  [0.056, 0.034, [0, -0.3], [2.6, -2.8], [4.9, -5.9], [7.0, -10.2]], // 1A+2A
  [0.042, 0.026, [0, -0.5], [0.55, -2.6], [1.0, -5.0], [1.6, -7.4], [2.5, -9.7]], // 3A (along the fold that lies against the abdomen)
];

// nicks in the margin: [x, y (a point near the margin), depth, half-width] in mm. A fresh animal: two, and small.
const FORE_NICKS = [[21.4, -5.5, 0.16, 0.5]];
const HIND_NICKS = [[18.4, -5.0, 0.2, 0.6]];

export function catmull(P, n, closed) {
  const out = [];
  const N = P.length;
  const at = (i) => (closed ? P[((i % N) + N) % N] : P[Math.max(0, Math.min(N - 1, i))]);
  const segs = closed ? N : N - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a, b, cc, d) => 0.5 * (2 * b + (cc - a) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (3 * b - a - 3 * cc + d) * t3);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push(P[N - 1].slice());
  return out;
}

/** Resample a closed polyline to n points, evenly by arc length. */
export function resample(poly, n) {
  const N = poly.length;
  const len = [0];
  for (let i = 0; i < N; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % N];
    len.push(len[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = len[N];
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (k / n) * total;
    while (len[j + 1] < s) j++;
    const f = (s - len[j]) / (len[j + 1] - len[j] || 1);
    const a = poly[j];
    const b = poly[(j + 1) % N];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

export function distToPoly(x, y, poly) {
  let d = Infinity;
  const N = poly.length;
  for (let i = 0; i < N; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % N];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const h = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1)));
    d = Math.min(d, Math.hypot(x - a[0] - ex * h, y - a[1] - ey * h));
  }
  return d;
}

const S = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Width of the scaled border (mm) and how much of it is the ember band (0..1), for a point of the margin. Returns
 * [width, rust]. Forewing: a hairline along the leading edge that thickens past the end of the cell, the broad dark
 * tip, an even band down the outer margin, a narrow one along the trailing edge. Hindwing: narrow in front, an even
 * band round the outside. The ember is strongest on the outer margins and all but absent from the leading edges.
 */
export function borderAt(hind, x, y) {
  if (!hind) {
    const apex = S(24, 29.2, x) * S(-4.6, -0.6, y);
    const outer = S(15.5, 19.5, x) * S(1.5, -1.0, y);
    const costa = S(1.0, 2.6, y) * (1 - S(23, 27.5, x));
    const sub = S(15.5, 18.5, x) * S(1.0, 2.6, y); // the leading edge from the end of the cell to the tip
    // (the ember belongs to the outer margin and the tip. Along the leading edge, and along the trailing edge where the
    // hindwing lies under it, the border is plain dark: two orange lines side by side across the middle of the animal
    // would make an outline drawing of it)
    const back = S(-0.4, -2.4, y) * S(9, 15.5, x);
    return [0.52 + 0.78 * outer + 1.35 * apex - 0.14 * costa + 0.42 * sub * (1 - apex), 0.04 + 0.92 * Math.max(outer, 0.3 * back) * (1 - 0.25 * apex)];
  }
  // (the inner margin, beside the abdomen, has only a hairline; the front, under the forewing, no ember)
  const outer = Math.max(S(12, 18.5, x), S(-4.5, -8, y) * S(1.6, 5.5, x));
  const costa = S(1, 3.6, y) * (1 - S(15, 19, x));
  return [0.66 + 0.7 * outer * (1 - costa) - 0.24 * costa - 0.2 * (1 - S(1.6, 5.5, x)) * S(-1, -3, y), 0.03 + 0.95 * outer * (1 - costa)];
}

/** The white bar of the forewing: [from (on the leading edge), to, greatest half-width] (mm), and the dark band over the end of the cell. */
export const BAR = { a: [21.5, 3.9], b: [25.1, -1.5], w: 0.92, dc: [[18.0, 4.0], [16.9, 0.2], [15.4, -2.8]], dcw: 0.46 };

export const OUTLINES = [FORE_OUTLINE, HIND_OUTLINE];
export const NICKS = [FORE_NICKS, HIND_NICKS];
/** The hub the mesh fans out from (mm), and the length of each wing along its axis. */
export const CENTRES = [[9.5, -0.2], [8.2, -1.4]];
export const SPAN = [29.5, 20.0];
/** Bounding box of each wing in its own frame: [xmin, ymin, xmax, ymax] (mm). */
export const BOUNDS = [[0, -7.7, 29.7, 4.1], [0, -10.0, 20.2, 5.1]];
const VEINS = [FORE_VEINS, HIND_VEINS];
/** Names of the veins, in the order wingVeins() returns them (Comstock–Needham; dc = discocellular, rec = recurrent). */
export const VEIN_NAMES = [
  ['C', 'Sc', 'R', 'R1', 'R2', 'R3-5', 'R3', 'R4', 'R5', 'M1', 'dc1', 'dc2', 'rec', 'M2', 'M3', 'Cu', 'CuA1', 'CuA2', '1A+2A'],
  ['Sc+R1', 'h', 'R', 'Rs', 'dc1', 'dc2', 'M1', 'M2', 'M3', 'Cu', 'CuA1', 'CuA2', '1A+2A', '3A'],
];

/**
 * The margin of a wing as a closed polyline of n points, evenly spaced by arc length, starting at the hinge and going
 * round by the leading edge first.
 * @param hind  false | 0 = forewing, true | 1 = hindwing
 * @param rnd   optional () → 0..1: adds the wear of a few weeks of flying (two or three nicks, a margin that is never
 *              a clean curve when `fine`). Leave it out for the clean outline.
 */
export function wingOutline(hind, n = 128, rnd = null, fine = n >= 64) {
  const k = hind ? 1 : 0;
  const outline = resample(catmull(OUTLINES[k], 14, true), n);
  if (!rnd) return outline;
  const centre = CENTRES[k];
  return outline.map(([x, y], i) => {
    let pull = fine ? 0.035 * (rnd() - 0.5) : 0;
    for (const [nx, ny, depth, half] of NICKS[k]) {
      const d = Math.hypot(x - nx, y - ny);
      if (d < half * 1.6) pull += depth * Math.pow(Math.max(0, 1 - d / (half * 1.6)), 1.4) * (0.75 + 0.5 * rnd());
    }
    const dx = centre[0] - x;
    const dy = centre[1] - y;
    // (the hinge itself stays where it is)
    const f = i === 0 ? 0 : pull / Math.hypot(dx, dy);
    return [x + dx * f, y + dy * f];
  });
}

/**
 * The veins of a wing as smooth polylines.
 * @param step  points per control span (7 = what the atlas is drawn from; 3 is plenty for a thread)
 * @returns {{ name: string, points: number[][], r0: number, r1: number }[]}  r0, r1 = radius (mm) at the first and
 *          last point; ends run a little past the margin and should be cut by it (distToPoly / aEdge).
 */
export function wingVeins(hind, step = 7) {
  const k = hind ? 1 : 0;
  return VEINS[k].map(([r0, r1, ...pts], i) => ({ name: VEIN_NAMES[k][i], points: catmull(pts, step, false), r0, r1 }));
}

/** The veins as straight pieces: [{ a: [x, y], b: [x, y], ra, rb }] (mm). */
export function veinSegments(hind) {
  const out = [];
  for (const v of wingVeins(hind, 7)) {
    const sm = v.points;
    for (let i = 0; i + 1 < sm.length; i++) {
      const t0 = i / (sm.length - 1);
      const t1 = (i + 1) / (sm.length - 1);
      out.push({ a: sm[i], b: sm[i + 1], ra: v.r0 + (v.r1 - v.r0) * t0, rb: v.r0 + (v.r1 - v.r0) * t1 });
    }
  }
  return out;
}

/** Half-width of the white bar (mm) abreast of a point: full for its first third, drawn to a point at its far end. */
const barWidth = (x, y) => {
  const ex = BAR.b[0] - BAR.a[0];
  const ey = BAR.b[1] - BAR.a[1];
  const along = Math.max(0, Math.min(1, ((x - BAR.a[0]) * ex + (y - BAR.a[1]) * ey) / (ex * ex + ey * ey)));
  return BAR.w * (0.55 + 0.45 * S(0, 0.22, along)) * (1 - 0.8 * along * Math.sqrt(along));
};

const sdSeg = (px, py, ax, ay, bx, by) => {
  const ex = bx - ax;
  const ey = by - ay;
  const h = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1)));
  return Math.hypot(px - ax - ex * h, py - ay - ey * h);
};

/**
 * What a point of a wing is made of. CPU twin of the wing shader's pigment field (wingMaterial.js: bfPigment), good to
 * a tenth of a millimetre.
 * @param outline  wingOutline(hind, …)      @param segs  veinSegments(hind)
 * @returns {{ inside, veinDist, vein, border, white, membrane, edge }}  veinDist = mm to the edge of the nearest vein;
 *          inside = mm inside the margin (< 0 outside); vein, border, white, membrane = weights 0..1 (membrane is
 *          what is left: the clear part); edge = 0..1 how near the margin (1 on it).
 */
export function pigmentAt(hind, x, y, outline, segs, out = {}) {
  let inside = distToPoly(x, y, outline);
  // (distToPoly is unsigned: a point is outside when a ray from it crosses the margin an even number of times)
  let c = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  if (!c) inside = -inside;
  let vd = 9;
  let wide = 0;
  for (const s of segs) {
    const d = sdSeg(x, y, s.a[0], s.a[1], s.b[0], s.b[1]);
    vd = Math.min(vd, d - 0.5 * (s.ra + s.rb));
    wide = Math.max(wide, 1 - d / 1.2);
  }
  const vein = 1 - S(-0.03, 0.03, vd);
  const [bw0] = borderAt(hind, x, y);
  const bw = bw0 * (1 + 0.7 * wide * wide);
  // (the band has a clean inner contour: a twentieth of a millimetre from scaled to clear)
  let cover = 1 - S(bw - 0.05, bw + 0.05, inside);
  let white = 0;
  if (!hind) {
    const [d0, d1, d2] = BAR.dc;
    const dc = Math.min(sdSeg(x, y, d0[0], d0[1], d1[0], d1[1]), sdSeg(x, y, d1[0], d1[1], d2[0], d2[1]));
    cover = Math.max(cover, 1 - S(BAR.dcw - 0.05, BAR.dcw + 0.05, dc * (1 + 0.5 * S(0.5, -2.8, y))));
    const wdt = barWidth(x, y);
    const db = sdSeg(x, y, BAR.a[0], BAR.a[1], BAR.b[0], BAR.b[1]);
    white = 1 - S(wdt - 0.05, wdt + 0.05, db);
    cover = Math.max(cover, 1 - S(wdt + 0.17, wdt + 0.27, db));
  }
  out.inside = inside;
  out.veinDist = vd;
  out.vein = inside > 0 ? vein : 0;
  out.border = inside > 0 ? cover * (1 - out.vein) : 0;
  out.white = white * cover;
  out.membrane = inside > 0 ? Math.max(0, 1 - out.vein - out.border) : 0;
  out.edge = 1 - S(0, 1.2, Math.abs(inside));
  return out;
}

/**
 * The cells of a wing: the clear panes between its veins, found by flooding a 0.2 mm grid in which the margin and the
 * veins are walls. About 100 ms of CPU per wing: call it once in init, with `pause: () => ctx.yield()` so that it is
 * taken in slices of a few milliseconds, and keep the result.
 * @returns {{ cells: { id, x, y, area }[], at(x, y) → id | -1, grid: Int16Array, w, h, x0, y0, step }}
 *          cells are sorted by area, largest first (id 0 of the forewing is the discal cell); x, y = centroid (mm),
 *          area in mm². grid holds the id of every 0.2 mm square (-1 = vein, scaled border, or outside).
 */
export async function wingCells(hind, { step = 0.2, pause = null } = {}) {
  const k = hind ? 1 : 0;
  const [x0, y0, x1, y1] = BOUNDS[k];
  const w = Math.ceil((x1 - x0) / step) + 2;
  const h = Math.ceil((y1 - y0) / step) + 2;
  const grid = new Int16Array(w * h).fill(-2);
  const outline = wingOutline(hind, 96);
  const segs = veinSegments(hind);
  const pg = {};
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      pigmentAt(hind, x0 + (i - 0.5) * step, y0 + (j - 0.5) * step, outline, segs, pg);
      if (pg.inside < 0.15 || pg.veinDist < step * 0.75 || pg.border > 0.5) grid[j * w + i] = -1;
    }
    if (pause && j % 8 === 7) await pause();
  }
  const found = [];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (grid[s] !== -2) continue;
    const id = found.length;
    let n = 0;
    let sx = 0;
    let sy = 0;
    stack.push(s);
    grid[s] = id;
    while (stack.length) {
      const c = stack.pop();
      const ci = c % w;
      const cj = (c - ci) / w;
      n++;
      sx += ci;
      sy += cj;
      for (const d of [c - 1, c + 1, c - w, c + w]) {
        if (d >= 0 && d < w * h && grid[d] === -2 && Math.abs((d % w) - ci) <= 1) {
          grid[d] = id;
          stack.push(d);
        }
      }
    }
    found.push({ id, x: x0 + (sx / n - 0.5) * step, y: y0 + (sy / n - 0.5) * step, area: n * step * step });
  }
  // largest first; slivers are not cells
  const order = found.map((c, i) => i).sort((a, b) => found[b].area - found[a].area);
  const remap = new Int16Array(found.length).fill(-1);
  const cells = [];
  for (const i of order) {
    if (found[i].area < 0.6) continue;
    remap[i] = cells.length;
    cells.push({ ...found[i], id: cells.length });
  }
  for (let s = 0; s < w * h; s++) if (grid[s] >= 0) grid[s] = remap[grid[s]];
  const at = (x, y) => {
    const i = Math.round((x - x0) / step + 0.5);
    const j = Math.round((y - y0) / step + 0.5);
    return i < 0 || j < 0 || i >= w || j >= h ? -1 : grid[j * w + i];
  };
  return { cells, at, grid, w, h, x0, y0, step };
}

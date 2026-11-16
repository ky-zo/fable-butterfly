// SAMPLES · the same butterfly as points, and as lines, that follow the same rig on the GPU.
//
//   samplePoints(n, opts)   → BufferGeometry of n points on veins, border, membrane and body
//   threadLines(opts)       → BufferGeometry of line segments: every vein, both margins, the body's curves
//   pointVertexGLSL         vertex preamble for either: vec3 bfPoint() = this vertex in the body frame (mm), posed
//
// Attributes (both):
//   position  vec3   wings: (x, y, 0) mm in the wing's flat frame · body: mm in the body frame
//   aWing     vec2   x: side (+1 right, -1 left, 0 = this is a point of the BODY), y: 0 fore | 1 hind
//   aUv       vec2   wings: 0..1 across the wing's bounding box (BOUNDS in wingData.js) · body: (along the part, around it)
//   aKind     vec4   weights: x vein, y scaled border, z clear membrane, w body  (points: one of them is 1)
//   aAlt      vec3   body: the same point with the legs folded (= position elsewhere)
//   aPart     vec4   body: part id (PART), along, around, which leg  (x = -1 on the wings)
//   aRand     float  0..1, one per point (per line for threads)
// Points also carry aCell (float: which clear cell of its wing a membrane point is in, -1 otherwise; needs opts.cells).
// Lines also carry aLine (vec3: line id, millimetres along it, its whole length) for strands that grow or travel.

import * as THREE from 'three';
import { BOUNDS, wingOutline, wingVeins, veinSegments, borderAt, pigmentAt } from './wingData.js';
import { PART, thoraxAt, abdomenAt, headAt, palpPath, palpRad, antennaPath, antennaRad, legPath, legRad, bodyCurves } from './bodyData.js';
import { rigGLSL } from './rig.js';

/** For points and threads: declares the attributes above and the pose uniforms; vec3 bfPoint() → body frame (mm). */
export const pointVertexGLSL = /* glsl */ `
attribute vec2 aWing;
attribute vec2 aUv;
attribute vec4 aKind;
attribute vec3 aAlt;
attribute vec4 aPart;
attribute float aRand;
uniform vec4 uPose;
uniform vec4 uShape;
uniform vec4 uLimbs;
uniform vec4 uTwitch;
uniform vec3 uFeet[4];
${rigGLSL}
vec3 bfPoint(){
  if (aWing.x == 0.0) return bfBodyLocal(position, aAlt, vec3(0.0), aPart, uLimbs, uTwitch, uFeet);
  return bfWingBody(bfWingLocal(position.xy, aWing, uPose, uShape), aWing, uPose, uShape);
}
`;

class Bag {
  constructor() {
    this.pos = [];
    this.wing = [];
    this.uv = [];
    this.kind = [];
    this.alt = [];
    this.part = [];
    this.rand = [];
  }
  wingPoint(x, y, side, hind, kind, r) {
    const b = BOUNDS[hind];
    this.pos.push(x, y, 0);
    this.alt.push(x, y, 0);
    this.wing.push(side, hind);
    this.uv.push((x - b[0]) / (b[2] - b[0]), (y - b[1]) / (b[3] - b[1]));
    this.kind.push(kind === 0 ? 1 : 0, kind === 1 ? 1 : 0, kind === 2 ? 1 : 0, 0);
    this.part.push(-1, 0, 0, -1);
    this.rand.push(r);
  }
  bodyPoint(p, alt, part, t, around, leg, r) {
    this.pos.push(p[0], p[1], p[2]);
    this.alt.push(alt[0], alt[1], alt[2]);
    this.wing.push(0, 0);
    this.uv.push(t, around);
    this.kind.push(0, 0, 0, 1);
    this.part.push(part, t, around, leg);
    this.rand.push(r);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(this.wing, 2));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 4));
    g.setAttribute('aAlt', new THREE.Float32BufferAttribute(this.alt, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 4));
    g.setAttribute('aRand', new THREE.Float32BufferAttribute(this.rand, 1));
    return g;
  }
}

const TUBES = [
  [PART.THORAX, thoraxAt, 5],
  [PART.ABDOMEN, abdomenAt, 6],
  [PART.HEAD, headAt, 2],
];

/**
 * n points spread over the animal. About 9 µs each (20 000 take 190 ms): pass `pause` and it is done in slices of
 * 2000 points, under 20 ms each.
 * @param n          how many
 * @param o.rnd      () → 0..1 (ctx.rng(seed)). Required: screenshots must be reproducible.
 * @param o.share    how the points are divided: { veins: 0.34, border: 0.3, membrane: 0.2, body: 0.16 }
 * @param o.cells    [fore, hind] from wingCells(): adds aCell
 * @param o.pause    () → Promise, awaited every 2000 points (ctx.yield)
 * @returns Promise<THREE.BufferGeometry>  draw it with THREE.Points and a material that includes pointVertexGLSL
 */
export async function samplePoints(n, { rnd, share = {}, cells = null, pause = null } = {}) {
  const sh = { veins: 0.34, border: 0.3, membrane: 0.2, body: 0.16, ...share };
  const tot = sh.veins + sh.border + sh.membrane + sh.body;
  const bag = new Bag();
  const cell = [];
  const outline = [wingOutline(0, 96), wingOutline(1, 96)];
  const fine = [wingOutline(0, 256), wingOutline(1, 256)];
  const segs = [veinSegments(0), veinSegments(1)];
  // (a forewing is a little more than half of the wing area)
  const pickWing = () => (rnd() < 0.57 ? 0 : 1);
  const segLen = segs.map((ss) => {
    let acc = 0;
    return ss.map((s) => (acc += Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1])));
  });
  const pg = {};
  for (let i = 0; i < n; i++) {
    const r = rnd() * tot;
    const side = rnd() < 0.5 ? 1 : -1;
    if (r < sh.veins) {
      // along a vein, by length; kept only where the vein is inside the margin
      for (let tries = 0; tries < 8; tries++) {
        const hind = pickWing();
        const L = segLen[hind];
        const at = rnd() * L[L.length - 1];
        let k = 0;
        while (L[k] < at) k++;
        const s = segs[hind][k];
        const f = rnd();
        const x = s.a[0] + (s.b[0] - s.a[0]) * f;
        const y = s.a[1] + (s.b[1] - s.a[1]) * f;
        if (pigmentAt(hind, x, y, outline[hind], segs[hind], pg).inside > 0.05 || tries === 7) {
          bag.wingPoint(x, y, side, hind, 0, rnd());
          cell.push(-1);
          break;
        }
      }
    } else if (r < sh.veins + sh.border) {
      // the band of scales: a point of the margin, moved inward by up to the band's width
      const hind = pickWing();
      const o = fine[hind];
      const k = Math.floor(rnd() * o.length);
      const a = o[k];
      const b = o[(k + 1) % o.length];
      const f = rnd();
      const x = a[0] + (b[0] - a[0]) * f;
      const y = a[1] + (b[1] - a[1]) * f;
      // (inward = to the left of the direction of travel: the outline goes round by the leading edge first)
      const tx = b[0] - a[0];
      const ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      const d = borderAt(hind, x, y)[0] * Math.pow(rnd(), 1.5) * 0.95;
      bag.wingPoint(x + (ty / tl) * d, y - (tx / tl) * d, side, hind, 1, rnd());
      cell.push(-1);
    } else if (r < sh.veins + sh.border + sh.membrane) {
      for (let tries = 0; tries < 30; tries++) {
        const hind = pickWing();
        const b = BOUNDS[hind];
        const x = b[0] + (b[2] - b[0]) * rnd();
        const y = b[1] + (b[3] - b[1]) * rnd();
        pigmentAt(hind, x, y, outline[hind], segs[hind], pg);
        if (pg.membrane > 0.6 || tries === 29) {
          bag.wingPoint(x, y, side, hind, 2, rnd());
          cell.push(cells ? cells[hind].at(x, y) : -1);
          break;
        }
      }
    } else {
      const q = rnd();
      const around = rnd();
      const a = around * Math.PI * 2;
      if (q < 0.62) {
        // thorax, abdomen, head: on the skin
        let pick = rnd() * 13;
        let tube = TUBES[0];
        for (const tb of TUBES) {
          if (pick < tb[2]) {
            tube = tb;
            break;
          }
          pick -= tb[2];
        }
        const t = rnd();
        const s = tube[1](t);
        const p = [Math.cos(a) * s.rx, s.y, s.z + Math.sin(a) * s.rz];
        bag.bodyPoint(p, p, tube[0], t, around, -1, rnd());
      } else if (q < 0.8) {
        const sx = rnd() < 0.5 ? 1 : -1;
        const t = rnd();
        const c = antennaPath(sx)(t);
        const rr = antennaRad(t);
        const p = [c[0] + Math.cos(a) * rr, c[1], c[2] + Math.sin(a) * rr];
        bag.bodyPoint(p, p, PART.ANTENNA, t, around, sx > 0 ? 10 : 11, rnd());
      } else if (q < 0.86) {
        const sx = rnd() < 0.5 ? 1 : -1;
        const t = rnd();
        const c = palpPath(sx)(t);
        const rr = palpRad(t);
        const p = [c[0] + Math.cos(a) * rr, c[1], c[2] + Math.sin(a) * rr];
        bag.bodyPoint(p, p, PART.PALP, t, around, -1, rnd());
      } else {
        const sx = rnd() < 0.5 ? 1 : -1;
        const k = rnd() < 0.5 ? 0 : 1;
        const t = rnd();
        const c = legPath(k, sx)(t);
        const f = legPath(k, sx, true)(t);
        const rr = legRad(t)[0];
        const o = [Math.cos(a) * rr, Math.sin(a) * rr * 0.5, Math.sin(a) * rr];
        bag.bodyPoint([c[0] + o[0], c[1] + o[1], c[2] + o[2]], [f[0] + o[0], f[1] + o[1], f[2] + o[2]], PART.LEG, t, around, k * 2 + (sx > 0 ? 0 : 1), rnd());
      }
      cell.push(-1);
    }
    if (pause && i % 2000 === 1999) await pause();
  }
  const g = bag.geometry();
  g.setAttribute('aCell', new THREE.Float32BufferAttribute(cell, 1));
  return g;
}

/**
 * The animal as line segments: the margin of each wing, every vein (cut where it leaves the wing), and the body's
 * curves. Draw with THREE.LineSegments and a material that includes pointVertexGLSL — or read the same curves as plain
 * arrays from wingOutline(), wingVeins() and bodyCurves() and lay your own strands along them.
 * @param o.outline  points per wing margin (96)       @param o.step  vein smoothness (4)
 * @param o.body     include the body's curves (true)  @param o.rnd   () → 0..1 for aRand (default: by line id)
 * @returns THREE.BufferGeometry (non-indexed pairs) with userData.lines = [{ id, kind, name, side, hind, length }]
 */
export function threadLines({ outline = 96, step = 4, body = true, rnd = null } = {}) {
  const bag = new Bag();
  const line = [];
  const lines = [];
  const poly = (pts, closed, emit, info) => {
    const id = lines.length;
    const r = rnd ? rnd() : (id * 0.618034) % 1;
    let total = 0;
    const n = pts.length;
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) total += Math.hypot(...pts[(i + 1) % n].map((v, c) => v - pts[i][c]));
    let at = 0;
    for (let i = 0; i < m; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const d = Math.hypot(...b.map((v, c) => v - a[c]));
      emit(a, i, r);
      line.push(id, at, total);
      emit(b, (i + 1) % n, r);
      line.push(id, at + d, total);
      at += d;
    }
    lines.push({ id, length: total, ...info });
  };
  for (const hind of [0, 1]) {
    const margin = wingOutline(hind, outline);
    const veins = wingVeins(hind, step);
    for (const side of [1, -1]) {
      poly(margin, true, (p, i, r) => bag.wingPoint(p[0], p[1], side, hind, 1, r), { kind: 'margin', name: hind ? 'hind' : 'fore', side, hind });
      for (const v of veins) {
        // (a vein ends at the margin)
        const pts = [];
        for (const p of v.points) {
          if (pts.length > 1 && !inside(p, margin)) break;
          pts.push(p);
        }
        if (pts.length > 1) poly(pts, false, (p, i, r) => bag.wingPoint(p[0], p[1], side, hind, 0, r), { kind: 'vein', name: v.name, side, hind });
      }
    }
  }
  if (body) {
    const ids = { thorax: PART.THORAX, abdomen: PART.ABDOMEN, head: PART.HEAD, antenna: PART.ANTENNA, palp: PART.PALP, tongue: PART.TONGUE, leg: PART.LEG, brush: PART.LEG };
    for (const c of bodyCurves(14)) {
      const n = c.points.length;
      const leg = c.part === 'antenna' ? (c.side > 0 ? 10 : 11) : c.part === 'brush' ? -2 : c.leg;
      const lathe = !!c.rings;
      if (lathe) {
        // the three big parts: their outline seen from above and from the side, not their centre line
        for (const [ax, sign] of [[0, 1], [0, -1], [2, 1], [2, -1]]) {
          const pts = c.rings.map((s) => (ax === 0 ? [s.rx * sign, s.y, s.z] : [0, s.y, s.z + s.rz * sign]));
          poly(pts, false, (p, i, r) => bag.bodyPoint(p, p, ids[c.part], i / (n - 1), ax === 0 ? (sign > 0 ? 0 : 0.5) : sign > 0 ? 0.25 : 0.75, -1, r), { kind: 'body', name: c.part, side: 0, hind: 0 });
        }
      } else {
        poly(c.points, false, (p, i, r) => bag.bodyPoint(p, c.alt ? c.alt[i] : p, ids[c.part], c.part === 'leg' ? [0, 0.1, 0.4, 0.72, 1][i] : i / (n - 1), 0, leg, r), { kind: 'body', name: c.part, side: c.side, hind: 0 });
      }
    }
  }
  const g = bag.geometry();
  g.setAttribute('aLine', new THREE.Float32BufferAttribute(line, 3));
  g.userData.lines = lines;
  return g;
}

function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

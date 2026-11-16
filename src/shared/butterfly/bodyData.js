// DATA · the body of a glasswing. Millimetres, body frame: +X right, +Y toward the head, +Z out of the back; the
// origin is the middle of the thorax. A brush-footed butterfly: it stands on FOUR legs — the front pair is a
// centimetre of fur folded against the chest and never touches anything.
//
// Everything long is a curve with a radius: thorax, abdomen and head are lathed about their centre line (xxxAt(t) →
// { y, z, rx, rz }); palps, antennae, tongue and legs are paths (t → [x, y, z]) with a radius function. bodyGeo.js
// sweeps tubes along them; bodyCurves() hands the same curves out as polylines, for a world that draws in thread.

import { STAND } from './rig.js';

export const PART = { THORAX: 0, ABDOMEN: 1, HEAD: 2, EYE: 3, PALP: 4, TONGUE: 5, ANTENNA: 6, LEG: 7, CLAW: 8 };
export const EYE = [0.6, 4.02, 0.2];
export const EYE_R = [0.74, 0.92, 0.98];

/**
 * White markings, for the skin and for the fur that grows out of it: [|x|, y, z, radius] (mm; x = 0 is one spot on
 * the midline, anything else a pair). Each lies on the skin: SPOTS is worked out from the body's own curves below.
 */
export const SPOTS = [];

/** Where the four feet stand, body frame (mm): mid right, mid left, hind right, hind left. */
export const FEET = [
  [5.7, 4.5, -STAND], [-5.7, 4.5, -STAND], [5.3, -5.9, -STAND], [-5.3, -5.9, -STAND],
];

export const sm = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// (nothing on an insect ends in a flat disc: each long part is rounded off over its first and last few per cent)
const dome = (t, a, b) => Math.sqrt(Math.max(0, 1 - Math.pow(1 - Math.min(1, t / a), 2))) * Math.sqrt(Math.max(0, 1 - Math.pow(1 - Math.min(1, (1 - t) / b), 2)));

// ---- the long shapes, as functions of t = 0 (front) … 1 (back): centre line and half-widths
// The thorax: deepest and widest at the wing bases, a third of the way back, drawn in to a neck and to a waist.
export function thoraxAt(t) {
  const y = 3.05 - 6.3 * t;
  const k = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, 0.05 + 0.92 * Math.pow(t, 0.85))))), 0.7);
  const d = dome(t, 0.14, 0.1);
  return { y, z: 0.12 + 0.22 * Math.sin(Math.PI * t), rx: (0.5 + 1.02 * k) * d, rz: (0.52 + 1.1 * k) * d };
}
/** Where the abdomen ends (mm along the body's axis): well short of the back of the hindwings, which close over it. */
export const ABDOMEN = { y0: -2.45, length: 9.0, segments: 8 };
// The abdomen: slender, a little fuller behind the waist, tapering all the way to a fine tip.
export function abdomenAt(t) {
  const y = ABDOMEN.y0 - ABDOMEN.length * t;
  // (it begins inside the back of the thorax: a butterfly has no waist)
  const r = (0.7 + 0.1 * sm(0, 0.2, t)) * (1 - 0.56 * sm(0.22, 1, t)) * (1 - 0.6 * sm(0.94, 1, t));
  // (every segment swells a little)
  const seg = 1 + 0.022 * Math.cos(t * ABDOMEN.segments * 2 * Math.PI);
  const d = dome(t, 0.03, 0.02);
  return { y, z: 0.1 - 0.45 * t * t - 0.18 * t, rx: r * seg * d, rz: r * seg * 1.08 * d };
}
export function headAt(t) {
  const y = 4.95 - 1.95 * t;
  const k = Math.pow(Math.max(0, Math.sin(Math.PI * (0.08 + 0.84 * t))), 0.7);
  const d = dome(t, 0.3, 0.22);
  return { y, z: 0.18, rx: (0.2 + 0.72 * k) * d, rz: (0.2 + 0.84 * k) * d };
}

// the white dots of an ithomiine: [which part, t along it, degrees round it (0 = the flank, 90 = the back), radius]
{
  const on = (fn, t, deg, r) => {
    const s = fn(t);
    const a = (deg * Math.PI) / 180;
    SPOTS.push([Math.abs(Math.cos(a) * s.rx) < 0.02 ? 0 : Math.cos(a) * s.rx, s.y, s.z + Math.sin(a) * s.rz, r]);
  };
  // (graded: the largest pair at the collar, smaller toward the waist — a row of even dots reads as a pattern printed on)
  on(headAt, 0.2, 90, 0.1); // between the antennae
  on(headAt, 0.86, 62, 0.12); // behind each eye
  on(thoraxAt, 0.09, 58, 0.2); // the collar
  on(thoraxAt, 0.17, 90, 0.1);
  on(thoraxAt, 0.31, 44, 0.17); // the shoulders, over the wing bases
  on(thoraxAt, 0.5, 68, 0.12);
  on(thoraxAt, 0.7, 52, 0.105);
  on(thoraxAt, 0.87, 90, 0.09);
  on(thoraxAt, 0.36, -14, 0.22); // the flanks, under the wings
  on(thoraxAt, 0.68, -16, 0.16);
  on(thoraxAt, 0.3, -60, 0.22); // the chest, between the legs
  on(thoraxAt, 0.62, -62, 0.18);
}

/** A path through points, Catmull-Rom, parametrised by t in 0..1 with the knots at given fractions. */
export function through(pts, at = null) {
  const n = pts.length;
  const ks = at || pts.map((_, i) => i / (n - 1));
  return (t) => {
    let i = 0;
    while (i < n - 2 && t > ks[i + 1]) i++;
    const f = Math.max(0, Math.min(1, (t - ks[i]) / (ks[i + 1] - ks[i])));
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    const f2 = f * f;
    const f3 = f2 * f;
    return [0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * f + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * f2 + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * f3));
  };
}
/** Straight segments with rounded joints: a leg. Knots at the given fractions; `round` = how much of t each bend takes. */
export function jointed(pts, at, round = 0.022) {
  const seg = (i, t) => {
    const f = (t - at[i]) / (at[i + 1] - at[i]);
    return [0, 1, 2].map((c) => pts[i][c] + (pts[i + 1][c] - pts[i][c]) * f);
  };
  return (t) => {
    let i = 0;
    while (i < pts.length - 2 && t > at[i + 1]) i++;
    // near an inner knot: a short curve from the segment before it to the segment after
    for (const k of [i, i + 1]) {
      if (k > 0 && k < pts.length - 1 && Math.abs(t - at[k]) < round) {
        const s = (t - at[k] + round) / (2 * round);
        const A = seg(k - 1, at[k] - round);
        const C = seg(k, at[k] + round);
        return [0, 1, 2].map((c) => (1 - s) * (1 - s) * A[c] + 2 * s * (1 - s) * pts[k][c] + s * s * C[c]);
      }
    }
    return seg(i, Math.max(at[i], Math.min(at[i + 1], t)));
  };
}

/** The labial palps: two small furred horns that lie close in front of the face and end below the top of the eye. */
export const palpPath = (sx) => through([[0.3 * sx, 4.5, -0.62], [0.33 * sx, 5.02, -0.6], [0.3 * sx, 5.3, -0.3], [0.27 * sx, 5.4, 0.08]]);
export const palpRad = (t) => 0.11 * (1 - 0.72 * t * t) * (0.5 + 0.5 * sm(0, 0.15, t));

export const LEG_AT = [0, 0.1, 0.4, 0.72, 1];
// coxa, trochanter, knee, heel (end of the tibia), toe
// (standing, the knee is carried high and the foot comes down not far from the body: a butterfly's stance is narrow.
// Folded for flight each leg is a flat Z drawn up against the underside of the thorax, and nothing trails)
export const LEGS = [
  { stand: [[0.8, 1.0, -1.2], [1.2, 1.25, -1.62], [3.0, 2.4, 0.05], [4.5, 3.6, -3.45], FEET[0]], fold: [[0.8, 1.0, -1.2], [0.9, 0.9, -1.42], [0.95, -1.7, -0.98], [0.75, 1.7, -1.22], [0.65, 0.1, -1.34]] },
  { stand: [[0.8, -0.9, -1.2], [1.15, -1.2, -1.62], [2.8, -2.5, 0.1], [4.2, -4.6, -3.45], FEET[2]], fold: [[0.8, -0.9, -1.2], [0.88, -1.1, -1.38], [0.85, -3.5, -0.72], [0.48, 0.3, -1.4], [0.42, -1.3, -1.3]] },
];
export const legRad = (t) => {
  // (coxa, femur, tibia, tarsus: each thinner than the last, and none of them thick — a butterfly stands on wire)
  const r = t < 0.1 ? 0.16 : t < 0.4 ? 0.092 - 0.022 * ((t - 0.1) / 0.3) : t < 0.72 ? 0.06 - 0.014 * ((t - 0.4) / 0.32) : 0.04 - 0.014 * ((t - 0.72) / 0.28);
  // (joints are knuckles; the tarsus is five beads)
  const knuckle = 1 + 0.26 * Math.exp(-Math.pow((t - 0.4) / 0.014, 2)) + 0.22 * Math.exp(-Math.pow((t - 0.72) / 0.012, 2));
  const beads = t > 0.72 ? 1 + 0.12 * Math.cos(((t - 0.72) / 0.28) * 5 * 2 * Math.PI) : 1;
  return [r * knuckle * beads, r * knuckle * beads];
};

/** A leg as a path: k = 0 middle pair, 1 hind pair; sx = +1 right, -1 left; folded = the pose for flight. */
export const legPath = (k, sx, folded = false) => jointed((folded ? LEGS[k].fold : LEGS[k].stand).map((p) => [p[0] * sx, p[1], p[2]]), LEG_AT);
/** The front pair: a brush, folded up under the head. */
export const brushPath = (sx) => through([[0.5 * sx, 2.2, -1.0], [0.56 * sx, 2.7, -0.95], [0.5 * sx, 3.1, -0.72], [0.44 * sx, 3.4, -0.58]]);
export const brushRad = (t) => 0.1 * (1 - 0.6 * t);
/** Antennae: hair-fine and long, ending in a distinct club (CLUB = where along it the club begins). */
export const CLUB = 0.8;
export const antennaPath = (sx) => through([[0.42 * sx, 4.5, 0.98], [0.75 * sx, 5.9, 1.9], [1.6 * sx, 8.6, 3.0], [2.7 * sx, 12.0, 3.75], [3.6 * sx, 15.0, 3.95], [4.05 * sx, 16.9, 3.8]]);
export const antennaRad = (t) => 0.034 - 0.011 * sm(0, 0.5, t) + 0.097 * sm(CLUB, 0.93, t) * (1 - 0.7 * sm(0.955, 1, t));
/** The tongue (proboscis), coiled like a watch spring under the face. */
export const TONGUE_TURNS = 2.6;
export const tonguePath = (t) => {
  const a = -0.9 + t * TONGUE_TURNS * Math.PI * 2;
  const r = 0.46 * (1 - 0.74 * t) + 0.04;
  // (a spring is never quite flat: each turn lies a little to one side of the last)
  return [0.05 * Math.sin(a * 0.5 + 0.6) * (1 - t), 4.98 + Math.sin(a) * r, -0.86 - Math.cos(a) * r];
};
/** Half-widths across / through the coil (mm): two half-tubes zipped together, ringed along their whole length. */
export const tongueRad = (t) => {
  const ring = 1 + 0.07 * Math.cos(t * 150 * 2 * Math.PI);
  return [(0.105 - 0.05 * t) * ring, (0.08 - 0.036 * t) * ring];
};

const sample = (fn, n) => Array.from({ length: n + 1 }, (_, i) => fn(i / n));

/**
 * The whole body as polylines, for a world that lays strands along it. Body frame, millimetres.
 * @param n  points per curve (legs always keep their five joints)
 * @returns {{ part: string, side: -1|0|1, leg: number, points: number[][], alt?: number[][], radius: number[] }[]}
 *   part    'thorax' | 'abdomen' | 'head' (centre lines; radius[i] = half-width there, and `rings` gives the outline:
 *           [{ y, z, rx, rz }] ellipses about the line) | 'antenna' | 'palp' | 'tongue' | 'leg' | 'brush'
 *   leg     0..3 for the legs it stands on (the index of the pose's feet[]), -1 otherwise
 *   alt     legs only: the same points folded for flight (blend by the pose's limbs.x)
 */
export function bodyCurves(n = 16) {
  const out = [];
  for (const [part, fn] of [['thorax', thoraxAt], ['abdomen', abdomenAt], ['head', headAt]]) {
    const rings = sample(fn, n);
    out.push({ part, side: 0, leg: -1, points: rings.map((s) => [0, s.y, s.z]), radius: rings.map((s) => s.rx), rings });
  }
  for (const sx of [1, -1]) {
    out.push({ part: 'antenna', side: sx, leg: -1, points: sample(antennaPath(sx), n), radius: sample(antennaRad, n) });
    out.push({ part: 'palp', side: sx, leg: -1, points: sample(palpPath(sx), Math.ceil(n / 2)), radius: sample(palpRad, Math.ceil(n / 2)) });
    out.push({ part: 'brush', side: sx, leg: -1, points: sample(brushPath(sx), Math.ceil(n / 2)), radius: sample(brushRad, Math.ceil(n / 2)) });
    for (const k of [0, 1]) {
      const m = (p) => [p[0] * sx, p[1], p[2]];
      out.push({ part: 'leg', side: sx, leg: k * 2 + (sx > 0 ? 0 : 1), points: LEGS[k].stand.map(m), alt: LEGS[k].fold.map(m), radius: LEG_AT.map((t) => legRad(t)[0]) });
    }
  }
  out.push({ part: 'tongue', side: 0, leg: -1, points: sample(tonguePath, n * 3), radius: sample((t) => tongueRad(t)[0], n * 3) });
  return out;
}

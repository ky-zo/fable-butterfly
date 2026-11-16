// "food" — what it feeds from, kept together: an open five-petalled flower (and two smaller ones behind it), a bud,
// and beads of water. Each flower is drawn twice over:
//
//   ramp 0  the flower as anyone sees it: margins, a fan of veins, the lamina between; plain yellow
//   ramp 1  the flower as a butterfly sees it. Petals that look one colour to us absorb ultraviolet near the base
//           and reflect it at the tips, so to an eye that sees ultraviolet the middle of the flower is a dark
//           bullseye, and lines run down each petal to it like the lights of a runway. Here those marks are points
//           of their own, and the renderer only lights them when the animal is near (tint = how far out from the
//           middle a mark is, so they can come up from the centre outward).
//   ramp 2  sepals, stem, leaves        ramp 3  stamens and stigma, water
//
// Local frame: the flower faces +z, y is up in its face. Generators yield now and then so init can breathe.

import { TAU, clamp, smooth, noise1 } from './cloud.js';

const PETALS = 5;

/** half width of a petal (as a fraction of its length) at a ∈ 0..1 along it: narrow claw, broad shoulder, shallow notch */
const petalWidth = (a) => 0.56 * Math.pow(Math.sin(Math.PI * Math.pow(clamp(a, 0, 1), 1.35)), 0.62) * (0.35 + 0.65 * smooth(0.0, 0.3, a)) + 0.03;
/** how far out of the face a petal stands at a: cupped, the tip rolled back */
const petalLift = (a) => 0.36 * a * a - 0.3 * a * a * a * a;

/**
 * One open flower of radius R at the origin facing +z, with its stem.
 * share: fraction of the cloud's whole budget this flower may use.
 */
function* openFlower(cloud, rnd, { R = 2.6, share = 0.4, seed = 0, stem = 7.5, order0 = 0, order1 = 1 }) {
  const start = cloud.i;
  const n = cloud.share(share);
  const ord = (x) => order0 + (order1 - order0) * clamp(x);
  const q = [0, 0, 0];
  // a point of petal k at (a along, c across −1..1), lifted by dz
  const petal = (k, a, c, dz = 0) => {
    const th = Math.PI / 2 + (k * TAU) / PETALS + 0.05 * noise1(k * 3.1, seed + 3);
    const w = petalWidth(a) * R;
    // the notch at the tip
    const notch = 1 - 0.1 * smooth(0.5, 0.0, Math.abs(c)) * smooth(0.8, 1.0, a);
    const rr = a * R * notch;
    const z = R * petalLift(a) - 0.16 * w * c * c + 0.035 * R * Math.sin(c * 5.5 + a * 7 + k * 1.7 + seed) * a * a + dz;
    const cx = Math.cos(th), sx = Math.sin(th);
    q[0] = cx * rr - sx * c * w;
    q[1] = sx * rr + cx * c * w;
    q[2] = z + (k & 1 ? 0.02 : -0.02) * R; // alternate petals lap over their neighbours
    return q;
  };

  const counts = {
    margin: Math.floor(n * 0.09),
    veins: Math.floor(n * 0.23),
    lamina: Math.floor(n * 0.27),
    bull: Math.floor(n * 0.12),
    runway: Math.floor(n * 0.09),
    centre: Math.floor(n * 0.05),
    green: Math.floor(n * 0.145),
  };
  let tick = 0;

  // ---- margin
  for (let i = 0; i < counts.margin; i++) {
    if ((++tick & 1023) === 0) yield;
    const k = (rnd() * PETALS) | 0;
    const a = Math.pow(rnd(), 0.6);
    const s = rnd() < 0.5 ? -1 : 1;
    petal(k, a, s * (1 - 0.012 * rnd()));
    cloud.add(q[0], q[1], q[2], 0.95 * smooth(0.08, 0.4, a), clamp(0.25 + 0.7 * a), ord(0.15 + 0.6 * a), 0);
  }
  // ---- veins: nine to a petal, fanning from the claw, forking near the tip
  for (let i = 0; i < counts.veins; i++) {
    if ((++tick & 1023) === 0) yield;
    const k = (rnd() * PETALS) | 0;
    const j = (rnd() * 9) | 0;
    const c0 = (j - 4) / 4.4;
    const a = 0.04 + 0.95 * rnd();
    let c = c0 * (0.25 + 0.75 * smooth(0.0, 0.55, a));
    if (a > 0.62 && rnd() < 0.5) c += (rnd() < 0.5 ? -1 : 1) * 0.09 * (a - 0.62) * 2.6;
    if (Math.abs(c) > 0.97) continue;
    petal(k, a, c + rnd.gauss() * 0.004);
    cloud.add(q[0], q[1], q[2], (j === 4 ? 1.1 : 0.8) * (1 - 0.3 * a), clamp(0.12 + 0.6 * a + 0.1 * rnd()), ord(0.1 + 0.6 * a), 0);
  }
  // ---- lamina
  for (let i = 0; i < counts.lamina; i++) {
    if ((++tick & 1023) === 0) yield;
    const k = (rnd() * PETALS) | 0;
    const a = Math.pow(rnd(), 0.72);
    const c = rnd() * 2 - 1;
    petal(k, a, c);
    cloud.add(q[0], q[1], q[2], 0.3 + 0.24 * rnd(), clamp(0.2 + 0.72 * a + 0.08 * (rnd() - 0.5)), ord(0.12 + 0.62 * a), 0);
  }
  // ---- the bullseye: the inner two fifths of every petal, filled, with a hard scalloped edge
  const BULL = 0.41;
  for (let i = 0; i < counts.bull; i++) {
    if ((++tick & 1023) === 0) yield;
    const k = (rnd() * PETALS) | 0;
    const c = rnd() * 2 - 1;
    const edge = BULL * (1 + 0.1 * Math.cos(c * Math.PI)); // scalloped: further out along the midrib
    const onEdge = rnd() < 0.3;
    const a = onEdge ? edge * (1 - 0.012 * rnd()) : edge * Math.pow(rnd(), 0.6);
    petal(k, a, c * 0.985, 0.012);
    cloud.add(q[0], q[1], q[2], onEdge ? 1.5 : 0.34 + 0.3 * rnd(), clamp(a * 0.92), ord(0.1 + 0.6 * a), 1);
  }
  // ---- the runway: lines of beads down each petal, converging on the middle; a scatter of sparks at the tips
  for (let i = 0; i < counts.runway; i++) {
    if ((++tick & 1023) === 0) yield;
    const k = (rnd() * PETALS) | 0;
    const u = rnd();
    if (u < 0.86) {
      const j = (rnd() * 5) | 0;
      const c0 = (j - 2) * 0.3;
      const a = BULL + (0.97 - BULL) * rnd();
      // beads: short dashes that get shorter and further apart toward the tip
      const bead = a * 15 - Math.floor(a * 15);
      if (bead > 0.62 - 0.25 * a) {
        i--;
        continue;
      }
      const c = c0 * (0.25 + 0.75 * smooth(0.0, 0.55, a));
      petal(k, a, c + rnd.gauss() * 0.006, 0.014);
      cloud.add(q[0], q[1], q[2], (j === 2 ? 1.6 : 1.05) * (1 - 0.4 * a), clamp(a * 0.95), ord(0.1 + 0.6 * a), 1);
    } else {
      const a = 0.55 + 0.42 * rnd();
      petal(k, a, (rnd() * 2 - 1) * 0.9, 0.014);
      cloud.add(q[0], q[1], q[2], 0.5 + 2.2 * Math.pow(rnd(), 6), clamp(a), ord(0.1 + 0.6 * a), 1);
    }
  }
  // ---- the middle: a ring of stamens leaning out, and the style with its five-lobed stigma
  const NST = 34;
  const stamens = [];
  for (let s = 0; s < NST; s++) stamens.push({ az: (s / NST) * TAU + rnd() * 0.2, lean: 0.25 + 0.6 * rnd(), len: R * (0.2 + 0.14 * rnd()), ph: rnd() * TAU });
  for (let i = 0; i < counts.centre; i++) {
    if ((++tick & 1023) === 0) yield;
    const u = rnd();
    if (u < 0.74) {
      const s = stamens[(rnd() * NST) | 0];
      const anther = rnd() < 0.55;
      const t = anther ? 1 : rnd();
      const out = Math.sin(s.lean) * t * s.len + 0.03 * R;
      const up = Math.cos(s.lean) * t * s.len + 0.035 * R * Math.sin(t * Math.PI);
      let x = Math.cos(s.az) * out, y = Math.sin(s.az) * out, z = up;
      if (anther) {
        // a little saddle of pollen across the top of the filament
        const a = rnd() * TAU, r = 0.03 * R * Math.sqrt(rnd());
        x += Math.cos(a) * r * 1.6 * -Math.sin(s.az) + Math.cos(s.az) * Math.sin(a) * r * 0.6;
        y += Math.cos(a) * r * 1.6 * Math.cos(s.az) + Math.sin(s.az) * Math.sin(a) * r * 0.6;
        z += Math.sin(a) * r * 0.5;
      }
      cloud.add(x, y, z, anther ? 0.34 + 0.26 * rnd() : 0.14, anther ? 0.05 + 0.2 * rnd() : 0.45, ord(0.02 + 0.1 * t), 3);
    } else if (u < 0.9) {
      const t = rnd();
      const lobe = (rnd() * 5) | 0;
      const tip = smooth(0.82, 1, t);
      const a = (lobe / 5) * TAU;
      cloud.add(Math.cos(a) * tip * 0.05 * R + rnd.gauss() * 0.006 * R, Math.sin(a) * tip * 0.05 * R + rnd.gauss() * 0.006 * R, t * 0.36 * R, 0.3 + 0.5 * tip, 0.5, ord(0.02 + 0.08 * t), 3);
    } else {
      // the floor of the cup, where the nectar is
      const r = 0.075 * R * Math.sqrt(rnd()), a = rnd() * TAU;
      cloud.add(Math.cos(a) * r, Math.sin(a) * r, 0.01 * R * rnd(), 0.3, 0.25, ord(0.02), 3);
    }
  }
  // ---- green: five sepals behind the gaps between the petals; the stem, bowing back and down; two leaves on it
  const stemAt = (s, out) => {
    out[0] = 0.5 * R * 0.3 * Math.sin(s * 2.1 + seed);
    out[1] = -s * stem - 0.02 * R;
    out[2] = -0.12 * R - (0.9 * R * s) * (1 - 0.35 * s);
    return out;
  };
  const sp = [0, 0, 0];
  for (let i = 0; i < counts.green; i++) {
    if ((++tick & 1023) === 0) yield;
    const u = rnd();
    if (u < 0.3) {
      const k = (rnd() * PETALS) | 0;
      const th = Math.PI / 2 + ((k + 0.5) * TAU) / PETALS;
      const a = rnd();
      const w = 0.13 * R * Math.sin(Math.PI * Math.pow(a, 0.6));
      const c = rnd() < 0.4 ? (rnd() < 0.5 ? -1 : 1) : rnd() * 2 - 1;
      const rr = a * 0.5 * R;
      cloud.add(Math.cos(th) * rr - Math.sin(th) * c * w, Math.sin(th) * rr + Math.cos(th) * c * w, -0.06 * R + 0.1 * R * a * a, Math.abs(c) === 1 ? 0.4 : 0.18, 0.15 + 0.4 * a, ord(0.05 + 0.2 * a), 2);
    } else if (u < 0.62) {
      const s = Math.pow(rnd(), 0.8);
      stemAt(s, sp);
      const a = rnd() * TAU;
      const rad = 0.03 * R * (1 + 0.5 * smooth(0.0, 0.05, 0.05 - s));
      cloud.add(sp[0] + Math.cos(a) * rad, sp[1], sp[2] + Math.sin(a) * rad, (0.42 + 0.2 * Math.cos(a)) * (1 - 0.8 * s), 0.2 + 0.3 * rnd(), ord(0.75 + 0.25 * s), 2);
    } else {
      // a leaf: lance-shaped, a midrib, eight pairs of side veins, held out from the stem
      const which = rnd() < 0.5 ? 0 : 1;
      const s0 = which ? 0.58 : 0.3;
      stemAt(s0, sp);
      const dir = which ? -1 : 1;
      const L = R * (which ? 1.25 : 1.0);
      const a = rnd();
      const w = 0.2 * L * Math.pow(Math.sin(Math.PI * Math.pow(a, 0.7)), 0.8);
      const kind = rnd();
      let c;
      let bright;
      if (kind < 0.16) {
        c = 0;
        bright = 0.5;
      } else if (kind < 0.42) {
        const j = Math.floor(rnd() * 8);
        const r = rnd();
        c = (rnd() < 0.5 ? -1 : 1) * r;
        const av = clamp((j + 0.7) / 8.6 + r * 0.09);
        cloud.add(sp[0] + dir * (av * L * 0.92) + 0, sp[1] + c * 0.2 * L * Math.pow(Math.sin(Math.PI * Math.pow(av, 0.7)), 0.8) * 0.4 - 0.32 * L * av * av, sp[2] + c * 0.2 * L * Math.pow(Math.sin(Math.PI * Math.pow(av, 0.7)), 0.8) * 0.9 + 0.25 * L * av, 0.3 * (1 - 0.5 * s0), 0.3 + 0.3 * av, ord(0.8 + 0.2 * av), 2);
        continue;
      } else if (kind < 0.6) {
        c = rnd() < 0.5 ? -1 : 1;
        bright = 0.4;
      } else {
        c = rnd() * 2 - 1;
        bright = 0.13;
      }
      cloud.add(sp[0] + dir * (a * L * 0.92), sp[1] + c * w * 0.4 - 0.32 * L * a * a, sp[2] + c * w * 0.9 + 0.25 * L * a, bright * (1 - 0.5 * s0), 0.25 + 0.35 * a, ord(0.8 + 0.2 * a), 2);
    }
  }
  return start;
}

/** A bud: petals still wound in a spiral, held in its sepals. Points up (+y). */
function* bud(cloud, rnd, { R = 1, share = 0.05 }) {
  const n = cloud.share(share);
  for (let i = 0; i < n; i++) {
    if ((i & 1023) === 1023) yield;
    const t = rnd();
    const prof = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.8) * (1 - 0.25 * t); // spindle
    const u = rnd();
    if (u < 0.5) {
      // the wound petals: spiral lines up the spindle
      const line = (rnd() * 5) | 0;
      const a = (line / 5) * TAU + t * 3.6 + rnd.gauss() * 0.02;
      cloud.add(Math.cos(a) * prof * 0.34 * R, (t - 0.25) * 1.5 * R, Math.sin(a) * prof * 0.34 * R, 0.5, 0.3 + 0.6 * t, 0.3 + 0.5 * t, 0);
    } else if (u < 0.72) {
      const a = rnd() * TAU;
      cloud.add(Math.cos(a) * prof * 0.33 * R, (t - 0.25) * 1.5 * R, Math.sin(a) * prof * 0.33 * R, 0.14, 0.3 + 0.6 * t, 0.3 + 0.5 * t, 0);
    } else if (u < 0.9) {
      // sepals: five green blades clasping the lower half
      const k = (rnd() * 5) | 0;
      const tt = t * 0.62;
      const pr = Math.pow(Math.sin(Math.PI * Math.pow(tt, 0.62)), 0.8) * (1 - 0.25 * tt) * 0.36 * R + 0.012 * R;
      const half = 0.5 * (1 - tt / 0.62) + 0.04;
      const a = (k / 5) * TAU + (rnd() < 0.5 ? (rnd() < 0.5 ? -1 : 1) * half : (rnd() * 2 - 1) * half);
      cloud.add(Math.cos(a) * pr, (tt - 0.25) * 1.5 * R, Math.sin(a) * pr, 0.3, 0.2 + 0.4 * tt, 0.2 + 0.3 * tt, 2);
    } else {
      // its stalk
      const s = rnd();
      const a = rnd() * TAU;
      cloud.add(Math.cos(a) * 0.035 * R + 0.25 * R * s * s, (-0.25 - s * 3.2) * 1.5 * R * 0.6 - 0.02, Math.sin(a) * 0.035 * R - 0.5 * R * s, 0.34 * (1 - 0.8 * s), 0.3, 0.6 + 0.4 * s, 2);
    }
  }
}

/**
 * A bead of water of radius r hanging at (x, y, z): its rim (grazing light), the hard spot of the sun on it, the
 * bright smear that the light makes on the far side after passing through, and a short neck above.
 * sun: unit vector toward the light, in the cloud's frame.
 */
function drop(cloud, rnd, x, y, z, r, n, sun, order) {
  for (let i = 0; i < n; i++) {
    const u = rnd();
    let nx, ny, nz;
    do {
      nx = rnd() * 2 - 1;
      ny = rnd() * 2 - 1;
      nz = rnd() * 2 - 1;
    } while (nx * nx + ny * ny + nz * nz > 1 || nx * nx + ny * ny + nz * nz < 0.01);
    const il = 1 / Math.hypot(nx, ny, nz);
    nx *= il;
    ny *= il;
    nz *= il;
    // a pendant drop is a little longer than it is wide
    const sy = ny > 0 ? 1.25 : 1.0;
    if (u < 0.5) {
      // the skin, brightest where it is seen edge-on
      const rim = 1 - Math.abs(nz);
      cloud.add(x + nx * r, y + ny * r * sy, z + nz * r, 0.08 + 0.7 * rim * rim * rim, 0.55 + 0.4 * rnd(), order, 3);
    } else if (u < 0.68) {
      // the sun on it
      const k = 0.16 * Math.sqrt(rnd());
      const a = rnd() * TAU;
      let px = sun[0] + Math.cos(a) * k, py = sun[1] + Math.sin(a) * k, pz = sun[2] + 0.4;
      const l = 1 / Math.hypot(px, py, pz);
      px *= l;
      py *= l;
      pz *= l;
      cloud.add(x + px * r, y + py * r * sy, z + pz * r, 2.6, 0.9, order, 3);
    } else {
      // the caustic: light gathered on the side away from the sun, inside
      const k = 0.5 * Math.pow(rnd(), 0.7);
      const a = rnd() * TAU;
      cloud.add(x - sun[0] * r * 0.55 + Math.cos(a) * k * r * 0.5, y - sun[1] * r * 0.6 + Math.sin(a) * k * r * 0.34, z + r * 0.2 * (rnd() - 0.5), 1.0 * (1 - k), 0.35 + 0.3 * rnd(), order, 3);
    }
  }
}

/**
 * The whole region. `sun` is the compass direction in this region's frame (the beads of water show it).
 */
export function* food(cloud, rnd, sun = [0.4, 0.6, 0.5]) {
  // the one it lands on
  yield* openFlower(cloud, rnd, { R: 2.6, share: 0.47, seed: 0, stem: 8.5, order0: 0, order1: 0.55 });
  // two more of the same kind, smaller and further back, turned their own ways
  let s = cloud.i;
  yield* openFlower(cloud, rnd, { R: 2.6, share: 0.18, seed: 5, stem: 7, order0: 0.3, order1: 0.8 });
  cloud.transform({ rx: -0.25, ry: 0.62, rz: 0.4, scale: 0.6, tx: -5.0, ty: 1.9, tz: -3.6 }, s);
  s = cloud.i;
  yield* openFlower(cloud, rnd, { R: 2.6, share: 0.13, seed: 9, stem: 6, order0: 0.4, order1: 0.9 });
  cloud.transform({ rx: 0.2, ry: -0.7, rz: -0.5, scale: 0.47, tx: 4.3, ty: -2.6, tz: -2.6 }, s);
  // a bud that has not opened
  s = cloud.i;
  yield* bud(cloud, rnd, { R: 1.0, share: 0.05 });
  cloud.transform({ rx: 0.3, rz: 0.35, scale: 1.0, tx: -3.1, ty: -2.7, tz: 0.4 }, s);
  // water: one bead under the lowest petal of the big flower, one on its leaf, a string of small ones on the stem
  const beads = [
    [-1.5, -2.37, 0.2, 0.2, 0.3],
    [1.55, -2.28, 0.2, 0.13, 0.33],
    [0.9, -3.9, -1.3, 0.16, 0.6],
    [-0.1, -4.6, -2.0, 0.09, 0.7],
    [-5.3, 0.55, -3.5, 0.1, 0.6],
    [3.6, -3.6, -2.8, 0.08, 0.7],
  ];
  const per = Math.floor(cloud.share(0.11) / beads.length);
  for (const b of beads) {
    drop(cloud, rnd, b[0], b[1], b[2], b[3], Math.floor(per * (0.5 + b[3] * 4)), sun, b[4]);
    yield;
  }
  // loose pollen in the air in front of the big one
  while (cloud.left > 0) {
    if ((cloud.left & 1023) === 0) yield;
    const r = 0.4 + 2.6 * Math.pow(rnd(), 1.5);
    const a = rnd() * TAU, c = rnd() * 2 - 1, sn = Math.sqrt(1 - c * c);
    cloud.add(Math.cos(a) * sn * r, c * r * 0.8, Math.abs(Math.sin(a) * sn) * r * 0.9 + 0.2, 0.05 + 0.25 * Math.pow(rnd(), 4), 0.1 + 0.3 * rnd(), 0.3 + 0.7 * rnd(), 3);
  }
}

/** Height of the big flower's face above its own plane at radius r along a petal's midrib (for standing on it). */
export const faceLift = (r, R = 2.6) => R * petalLift(clamp(r / R));

// "danger" — what has looked at it, kept together: the eye of a bird, and feathers.
//
//   ramp 0  the iris: radial fibres, the frill round the pupil, crypts, the dark limbal ring. The pupil is left
//           empty: nothing is in it
//   ramp 1  the light in the eye: the window it was seen through, bent on the cornea (four panes and their bars)
//   ramp 2  feathers: the small contour feathers of the face, lying back from the eye, and two that came away
//   ramp 3  the ring of beaded skin round the eye
//
// Local frame: the eye looks along +z. R is the radius of the iris.

import { Cloud, TAU, clamp, smooth, noise1 } from './cloud.js';
import { feather } from './feather.js';

export function* eye(cloud, rnd, R = 4.3) {
  const n = cloud.n;
  const RP = 0.37 * R; // the pupil
  const dome = (r) => 0.3 * R * Math.sqrt(Math.max(0, 1 - Math.pow(r / (1.3 * R), 2)));
  let tick = 0;

  // ---- iris fibres
  const NF = 300;
  const fibres = [];
  for (let k = 0; k < NF; k++) fibres.push({ th: (k / NF) * TAU + rnd.gauss() * 0.004, wob: rnd() * TAU, amp: 0.01 + 0.02 * rnd(), end: 0.86 + 0.14 * rnd(), w: 0.4 + rnd(), fork: rnd() < 0.3 ? 0.45 + 0.3 * rnd() : 2 });
  let m = Math.floor(n * 0.33);
  for (let i = 0; i < m; i++) {
    if ((++tick & 1023) === 0) yield;
    const f = fibres[(rnd() * NF) | 0];
    const t = Math.pow(rnd(), 0.85) * f.end;
    const r = RP + (R - RP) * t;
    // crypts: places where the front layer is missing and the fibre goes dim
    const crypt = smooth(0.25, 0.6, 0.5 + 0.5 * noise1(f.th * 9 + t * 3.1, 7)) * smooth(0.2, 0.35, t) * (1 - smooth(0.6, 0.8, t));
    let th = f.th + f.amp * Math.sin(t * 7 + f.wob);
    if (t > f.fork) th += (rnd() < 0.5 ? -1 : 1) * 0.012 * (t - f.fork) * 4;
    cloud.add(Math.cos(th) * r, Math.sin(th) * r, dome(r) - 0.04 * R * crypt, (0.3 + 0.5 * f.w) * (1 - 0.72 * crypt) * (1 - 0.35 * t), clamp(0.92 - 0.85 * t + 0.1 * (f.w - 0.9)), 0.04 + 0.3 * t, 0);
  }
  // ---- the frill at the edge of the pupil, the collarette, the limbal ring
  m = Math.floor(n * 0.085);
  for (let i = 0; i < m; i++) {
    if ((++tick & 1023) === 0) yield;
    const u = rnd();
    const th = rnd() * TAU;
    let r, bright, tint;
    if (u < 0.34) {
      r = RP * (1 + 0.012 * Math.sin(th * 64) + 0.018 * rnd());
      bright = 1.2;
      tint = 0.98;
    } else if (u < 0.6) {
      r = RP + (R - RP) * (0.3 + 0.035 * Math.sin(th * 23 + 1.3) + 0.02 * Math.sin(th * 57) + 0.012 * rnd.gauss());
      bright = 0.8;
      tint = 0.75;
    } else {
      r = R * (0.975 + 0.03 * rnd());
      bright = 0.36;
      tint = 0.02;
    }
    cloud.add(Math.cos(th) * r, Math.sin(th) * r, dome(r), bright, tint, 0.03 + 0.3 * ((r - RP) / (R - RP)), 0);
  }
  // ---- the window in it: a small bright rectangle of four panes high on the cornea, bent by the curve of it
  m = Math.floor(n * 0.03);
  for (let i = 0; i < m; i++) {
    let u = rnd() * 2 - 1, v = rnd() * 2 - 1;
    // the glazing bars are dark
    if (Math.abs(u) < 0.09 || Math.abs(v) < 0.1) {
      if (rnd() < 0.92) continue;
    }
    const edge = rnd() < 0.3;
    if (edge) {
      if (rnd() < 0.5) u = rnd() < 0.5 ? -1 : 1;
      else v = rnd() < 0.5 ? -1 : 1;
    }
    const cx = -0.36 * R + u * 0.17 * R + 0.03 * R * v * v;
    const cy = 0.42 * R + v * 0.12 * R - 0.05 * R * u * u;
    const r = Math.hypot(cx, cy);
    cloud.add(cx, cy, dome(r) + 0.02 * R, edge ? 1.0 : 0.5 + 0.4 * rnd(), 0.5 + 0.5 * rnd(), 0.02, 1);
  }
  // a second, small glint low on the other side
  m = Math.floor(n * 0.004);
  for (let i = 0; i < m; i++) {
    const a = rnd() * TAU, r0 = 0.035 * R * Math.sqrt(rnd());
    const cx = 0.3 * R + Math.cos(a) * r0, cy = -0.34 * R + Math.sin(a) * r0 * 0.7;
    cloud.add(cx, cy, dome(Math.hypot(cx, cy)) + 0.02 * R, 0.7, 0.6, 0.02, 1);
  }
  // ---- the ring of skin: three rows of beads
  m = Math.floor(n * 0.065);
  for (let i = 0; i < m; i++) {
    if ((++tick & 1023) === 0) yield;
    const row = (rnd() * 3) | 0;
    const rr = R * (1.085 + 0.085 * row);
    const nb = 58 + row * 6;
    const k = (rnd() * nb) | 0;
    const th = ((k + (row & 1 ? 0.5 : 0)) / nb) * TAU;
    const a = rnd() * TAU, q = 0.03 * R * Math.sqrt(rnd());
    const ring = rnd() < 0.5;
    const qq = ring ? 0.03 * R : q;
    cloud.add(Math.cos(th) * rr + Math.cos(a) * qq, Math.sin(th) * rr + Math.sin(a) * qq, dome(rr) * 0.6 - 0.02 * R * row, ring ? 0.5 : 0.2, 0.25 + 0.6 * rnd(), 0.3 + 0.08 * row, 3);
  }
  // ---- the feathers of the face: each a short shaft with barbs, lying back and away from the eye; they thin out into the dark
  const NFE = 760;
  const fe = [];
  for (let k = 0; k < NFE; k++) {
    const rr = R * (1.36 + 2.3 * Math.pow(rnd(), 1.25));
    const th = rnd() * TAU;
    // swept: radial, turned toward the back of the head (−x) the further out they are
    const out = th + 0.5 * Math.sin(th - Math.PI) * smooth(1.2 * R, 3 * R, rr);
    fe.push({ x: Math.cos(th) * rr, y: Math.sin(th) * rr * 0.92, dir: out, len: R * (0.2 + 0.2 * rnd()) * (0.7 + 0.25 * (rr / R)), w: 0.5 + 0.5 * rnd(), rr, tint: rnd(), curl: (rnd() - 0.5) * 0.5 });
  }
  m = Math.floor(n * 0.325);
  for (let i = 0; i < m; i++) {
    if ((++tick & 1023) === 0) yield;
    const f = fe[(rnd() * NFE) | 0];
    const t = rnd();
    const fade = 1 - smooth(1.7 * R, 3.7 * R, f.rr);
    const dx = Math.cos(f.dir + f.curl * t), dy = Math.sin(f.dir + f.curl * t);
    let x = f.x + dx * t * f.len, y = f.y + dy * t * f.len;
    let bright = 0.5;
    if (rnd() < 0.72) {
      // a barb: leaves the shaft at an angle, shorter toward the tip, so the feather is a rounded blade
      const side = rnd() < 0.5 ? -1 : 1;
      const v = rnd();
      const bl = f.len * 0.34 * Math.sin(Math.PI * Math.pow(t, 0.7)) * f.w;
      const a = f.dir + f.curl * t + side * (0.95 - 0.35 * v);
      x += Math.cos(a) * bl * v;
      y += Math.sin(a) * bl * v;
      bright = 0.26 * (1 - 0.5 * v);
    }
    const z = -0.05 * R - 0.16 * R * Math.pow(f.rr / R - 1, 1.3) + 0.06 * R * t;
    cloud.add(x, y, z, bright * (0.25 + 0.75 * fade), clamp(0.15 + 0.5 * f.tint + 0.25 * t), 0.4 + 0.5 * smooth(1.3 * R, 3.7 * R, f.rr), 2);
  }
  // ---- two that came away: whole flight feathers adrift in front of it
  const places = [
    { rx: 0.2, ry: 0.5, rz: 1.05, scale: 1.25, tx: -2.3 * R, ty: -1.55 * R, tz: 2.6 },
    { rx: -0.3, ry: -0.6, rz: -0.75, scale: 0.95, tx: 1.9 * R, ty: -1.9 * R, tz: 4.2 },
  ];
  for (const pl of places) {
    const sub = new Cloud(Math.floor(n * 0.07));
    yield* feather(sub, rnd);
    const s = cloud.i;
    cloud.take(sub, 2);
    cloud.transform(pl, s);
    cloud.reorder(s, 0.3, 0.68);
    yield;
  }
  // ---- down in the air
  while (cloud.left > 0) {
    if ((cloud.left & 1023) === 0) yield;
    const rr = R * (1.2 + 2.6 * rnd());
    const th = rnd() * TAU;
    cloud.add(Math.cos(th) * rr, Math.sin(th) * rr, rnd.gauss() * 1.6, 0.04 + 0.1 * rnd(), rnd(), 0.5 + 0.5 * rnd(), 2);
  }
}

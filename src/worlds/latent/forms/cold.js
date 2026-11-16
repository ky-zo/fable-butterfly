// The one that is unlike the rest: a cold disc over dark water. World 03 opens on it.
//
// It is built backwards from the last picture: every point of the water is chosen where it should fall in the frame
// of the last lens, and then put on the plane of the water where that ray meets it. So the road of glitter runs
// straight down the frame and widens toward the viewer by construction, at any shape of screen.
//
//   ramp 0  dark water: long faint crests, to either side of the road and under it
//   ramp 1  the disc (the simulation swells it; it is the only thing in here that is always whole)
//   ramp 2  the road: short bright dashes on the crests, broken, brighter down the middle
//   ramp 3  road and water nearer the viewer than the last frame shows
//
// The road does not stop at the bottom of the last picture. It runs on toward the viewer, under the place the last
// lens stands and some way behind it: none of that is in the last frame, but the lens is still on its way there when
// the water comes together, and what it sees first is a road of light laid toward it.
//
// Local frame: the last lens is at the origin, x right, y up, looking along −z and down by `pitch`.

import { TAU, clamp, smooth, noise1 } from './cloud.js';

/**
 * @param o.tan     tan of half the vertical field of view of the last shot
 * @param o.pitch   how far the last lens looks down (rad)
 * @param o.water   height of the water (negative: below the lens)
 * @param o.moon    [x, y, z] centre of the disc, o.radius its radius
 * @param o.horizon height in the frame (0 top … 1 bottom) where the water ends
 */
export function* cold(cloud, rnd, o) {
  const n = cloud.n;
  const { tan, pitch, water, moon, radius } = o;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  let tick = 0;

  // ---- the disc: limb-darkened, with a few dim seas so that it is a body and not a hole
  const seas = [];
  for (let k = 0; k < 7; k++) seas.push([(rnd() * 2 - 1) * 0.6, (rnd() * 2 - 1) * 0.6, 0.16 + 0.26 * rnd(), 0.25 + 0.3 * rnd()]);
  let m = Math.floor(n * 0.3);
  for (let i = 0; i < m; i++) {
    if ((++tick & 1023) === 0) yield;
    const r = Math.sqrt(rnd());
    const a = rnd() * TAU;
    const u = Math.cos(a) * r, v = Math.sin(a) * r;
    let dim = 0;
    for (const s of seas) dim = Math.max(dim, s[3] * smooth(s[2], s[2] * 0.45, Math.hypot(u - s[0], v - s[1])));
    const limb = 0.62 + 0.38 * Math.sqrt(1 - r * r);
    cloud.add(moon[0] + u * radius, moon[1] + v * radius, moon[2], limb * (1 - dim) * (0.8 + 0.4 * rnd()), clamp(0.3 + 0.4 * limb - 0.4 * dim), 0, 1);
  }
  // a breath of light round it
  m = Math.floor(n * 0.025);
  for (let i = 0; i < m; i++) {
    const r = 1 + 1.6 * Math.pow(rnd(), 1.6);
    const a = rnd() * TAU;
    cloud.add(moon[0] + Math.cos(a) * r * radius, moon[1] + Math.sin(a) * r * radius, moon[2], 0.05 * Math.pow(2.6 - r, 2) * 0.4, 0.3, 0, 1);
  }

  // ---- the water. Frame coordinates: X in half-frame-heights from the middle, Y likewise (+1 top, −1 bottom).
  const YH = 1 - 2 * o.horizon; // the horizon
  const FAR = 385; // the water stops just short of the disc
  const q = [0, 0, 0];
  /** frame (X, Y) → the point of the water seen there. Returns false above the far edge of the water. */
  const onWater = (X, Y) => {
    const dx = X * tan;
    const dy = Y * tan * cp - sp;
    const dz = -(Y * tan * sp + cp);
    if (dy > -1e-4) return false;
    const t = water / dy;
    if (-dz * t > FAR) return false;
    q[0] = dx * t;
    q[1] = water;
    q[2] = dz * t;
    return true;
  };
  // crests: rows that are close together at the horizon and open out toward the viewer
  const ROWS = 84;
  const rowY = (k) => YH - 0.035 - 1.32 * Math.pow((k + 0.5) / ROWS, 1.75);
  const depth = (Y) => clamp((YH - Y) / (YH + 1.3)); // 0 at the horizon … 1 at the bottom of the frame
  // the road: per row, a handful of dashes, gathered about the middle
  const dashes = [];
  for (let k = 0; k < ROWS; k++) {
    const Y = rowY(k);
    const d = depth(Y);
    const half = 0.03 + 0.36 * Math.pow(d, 1.15);
    const count = 3 + Math.floor(5 * rnd() + 5 * d);
    for (let j = 0; j < count; j++) {
      const X = rnd.gauss() * half * 0.5;
      if (Math.abs(X) > half * 1.25) continue;
      // the water is quiet where the butterfly will be: it must not be lost in the glitter
      if (o.calm && rnd() > 0.12 + 0.88 * smooth(0.06, 0.2, Math.hypot(X - o.calm[0], (Y - o.calm[1]) * 1.6))) continue;
      const mid = Math.exp(-Math.pow(X / (half * 0.62), 2));
      const len = (0.006 + 0.06 * Math.pow(d, 1.4)) * (0.4 + 1.2 * rnd());
      // most dashes are quiet, a few are the ones that flash
      const lum = (0.25 + 2.6 * Math.pow(rnd(), 3.2)) * (0.3 + 0.7 * mid);
      dashes.push({ X, Y: Y + (rnd() - 0.5) * 0.01 * (1 + 6 * d), len, lum, w: len * (0.4 + lum) + 0.004, d, bow: (rnd() - 0.3) * 0.25 });
    }
  }
  // when a point of the water comes together: the far edge first, the foot of the last frame at about 0.7, and the
  // rest of the range is for the water nearer the viewer than that
  const ORD = (d) => clamp(0.1 + 0.6 * d);
  const EXT_ROAD = Math.floor(n * 0.07), EXT_DARK = Math.floor(n * 0.05);
  const DARK_GAIN = 1.6;
  let wsum = 0;
  for (const s of dashes) {
    wsum += s.w;
    s.cdf = wsum;
  }
  m = Math.floor(n * 0.36);
  for (let i = 0; i < m; i++) {
    if ((++tick & 1023) === 0) yield;
    const u = rnd() * wsum;
    let lo = 0, hi = dashes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dashes[mid].cdf < u) lo = mid + 1;
      else hi = mid;
    }
    const s = dashes[lo];
    const t = rnd() * 2 - 1;
    const thick = 0.0016 + 0.006 * s.d;
    if (!onWater(s.X + t * s.len, s.Y - s.bow * s.len * t * t + rnd.gauss() * thick)) continue;
    const end = 1 - t * t;
    cloud.add(q[0], q[1], q[2], s.lum * (0.35 + 0.65 * end) * (0.7 + 0.6 * rnd()), clamp(0.3 + 0.5 * rnd() + 0.2 * end), ORD(s.d), 2);
  }
  // ---- the same road, on toward the viewer: laid out on the water itself (z: toward the viewer; the last frame's
  // bottom edge meets the water about 12 units in front of the last lens, so everything from there back is out of it)
  const NEAR0 = -11.5, NEAR1 = 104;
  const ordNear = (z) => 0.72 + 0.2 * clamp((z - NEAR0) / (NEAR1 - NEAR0));
  for (let i = 0; i < EXT_ROAD; i++) {
    if ((++tick & 1023) === 0) yield;
    // crests about half a unit apart; a dash lies along its crest
    const z = NEAR0 + (NEAR1 - NEAR0) * Math.pow(rnd(), 1.15);
    const row = Math.round(z / 0.52);
    const j = (rnd() * 3) | 0; // three dashes to a crest
    const h1 = 0.5 + 0.5 * noise1(row * 7.31 + j * 17.7, 11), h2 = 0.5 + 0.5 * noise1(row * 3.17 + j * 5.3, 12);
    const half = 1.0 + 0.011 * (z - NEAR0);
    const cx = (h1 * 2 - 1) * half * 0.9 * (0.4 + 0.6 * h2);
    const len = 0.1 + 0.5 * h2 * h2;
    const t = rnd() * 2 - 1;
    const x = cx + t * len + (rnd() < 0.3 ? rnd.gauss() * half * 0.5 : 0);
    const mid = Math.exp(-Math.pow(x / (half * 0.75), 2));
    const lum = (0.22 + 3.2 * Math.pow(0.5 + 0.5 * noise1(row * 1.93 + j * 9.1, 13), 4.0)) * (0.3 + 0.7 * mid);
    cloud.add(x, water, row * 0.52 + 0.06 * (t * t - 0.5) + rnd.gauss() * 0.012, lum * (1 - 0.6 * t * t) * (0.7 + 0.6 * rnd()), clamp(0.45 + 0.4 * rnd() + 0.15 * (1 - t * t)), ordNear(z), 3);
  }
  // …and the dark water to either side of it
  for (let i = 0; i < EXT_DARK; i++) {
    if ((++tick & 1023) === 0) yield;
    const z = NEAR0 + (NEAR1 - NEAR0) * rnd();
    const row = Math.round(z / 0.9);
    const x = (rnd() < 0.6 ? rnd.gauss() * 11 : (rnd() * 2 - 1) * 34);
    if (0.5 + 0.5 * noise1(Math.floor(x * 0.5) * 1.31 + row * 3.7, 14) < 0.45) continue;
    const near = Math.exp(-Math.pow(x / 9, 2));
    cloud.add(x, water, row * 0.9 + 0.25 * noise1(x * 0.4 + row * 5.1, 15) + rnd.gauss() * 0.02, (0.1 + 0.22 * rnd() * rnd()) * (0.45 + 0.9 * near), clamp(0.05 + 0.2 * near * rnd() + 0.1 * rnd()), ordNear(z), 3);
  }
  // dark water: long faint crests across the whole width, densest near the road
  // (a third of its points went to the water behind the last lens: the ones left carry that much more light each)
  while (cloud.left > 0) {
    if ((++tick & 1023) === 0) yield;
    const k = Math.min(ROWS - 1, Math.floor(Math.pow(rnd(), 0.8) * ROWS));
    const d = depth(rowY(k));
    const u = rnd();
    const X0 = (u < 0.55 ? rnd.gauss() * 0.55 : (rnd() * 2 - 1) * 2.2);
    const seg = Math.floor(X0 * (9 - 6 * d) + k * 3.7);
    // crests come in pieces
    if (0.5 + 0.5 * noise1(seg * 1.31, k) < 0.42) continue;
    const Y = rowY(k) + 0.012 * (1 + 5 * d) * noise1(X0 * (6 - 3 * d) + k * 5.1, 3) + rnd.gauss() * (0.001 + 0.004 * d);
    if (!onWater(X0, Y)) continue;
    const near = Math.exp(-Math.pow(X0 / 0.7, 2));
    cloud.add(q[0], q[1], q[2], (0.045 + 0.1 * rnd() * rnd()) * (0.45 + 0.9 * near) * DARK_GAIN, clamp(0.15 + 0.5 * near * rnd() + 0.25 * rnd()), ORD(d), 0);
  }
}

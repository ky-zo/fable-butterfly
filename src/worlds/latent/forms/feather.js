// "feather" — a barred flight feather: hollow calamus, tapering rachis, an asymmetric vane of several hundred curved
// barbs, each fringed with barbules that overlap the next barb, a few places where the vane has unzipped into
// V-shaped splits, and a loose downy afterfeather at the base. The vane is cambered and the shaft bows, so it is
// never flat to the eye.

import { TAU, clamp, smooth, noise1 } from './cloud.js';

const R = [0, 0, 0], T = [0, 0, 0], S = [0, 0, 0], N = [0, 0, 0];

/** Rachis position and frame at t ∈ [0,1] (calamus tip → feather tip). */
function rachis(t) {
  const x = -0.3 + 0.75 * t * t - 0.12 * t + 0.05 * Math.sin(t * 5.0);
  const y = -2.55 + 5.0 * t;
  const z = 0.42 * Math.sin(Math.PI * Math.pow(t, 0.9)) - 0.2;
  const dx = 1.5 * t - 0.12 + 0.25 * Math.cos(t * 5.0);
  const dy = 5.0;
  const dz = 0.42 * Math.PI * 0.9 * Math.pow(Math.max(t, 1e-3), -0.1) * Math.cos(Math.PI * Math.pow(t, 0.9));
  const il = 1 / Math.hypot(dx, dy, dz);
  R[0] = x;
  R[1] = y;
  R[2] = z;
  T[0] = dx * il;
  T[1] = dy * il;
  T[2] = dz * il;
  // side = T × (0,0,1) → to the feather's right; normal = S × T → toward the viewer
  let sx = T[1], sy = -T[0], sz = 0;
  const sl = 1 / Math.hypot(sx, sy);
  sx *= sl;
  sy *= sl;
  S[0] = sx;
  S[1] = sy;
  S[2] = sz;
  N[0] = sy * T[2] - sz * T[1];
  N[1] = sz * T[0] - sx * T[2];
  N[2] = sx * T[1] - sy * T[0];
}

const vaneWidth = (t, side) => {
  const u = clamp((t - 0.17) / 0.83);
  const f = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.6) * (1 - 0.18 * u);
  return (side > 0 ? 0.98 : 0.56) * f;
};

export function* feather(cloud, rnd) {
  const NB = 190; // barbs per side
  // where the vane has come unzipped
  const splits = { '-1': [], 1: [] };
  for (const side of [-1, 1]) {
    const k = side > 0 ? 7 : 4;
    for (let i = 0; i < k; i++) splits[side].push({ t: 0.3 + 0.66 * rnd(), gap: 0.05 + 0.13 * rnd() * rnd() });
    splits[side].sort((a, b) => a.t - b.t);
  }
  // barbs: precompute their static parameters
  const barbs = [];
  for (const side of [-1, 1]) {
    for (let j = 0; j < NB; j++) {
      const t = 0.215 + 0.782 * Math.pow((j + 0.5) / NB, 0.97);
      const w = vaneWidth(t, side);
      if (w < 0.01) continue;
      const a0 = (side > 0 ? 0.98 : 0.8) - 0.5 * t + 0.03 * noise1(j * 0.31, side + 5);
      let lean = 0.035 * noise1(t * 9.0, 20 + side);
      let open = 0;
      for (const sp of splits[side]) {
        const d = t - sp.t;
        // barbs just below a split lean back, those just above lean forward: a V opens toward the edge
        const near = Math.exp(-Math.pow(d / 0.03, 2));
        open += (d < 0 ? 1 : -1) * sp.gap * near;
      }
      const bend = 0.34 + 0.1 * noise1(j * 0.13, 3);
      const mean = a0 - bend * 0.5;
      barbs.push({ t, side, w, a0: a0 + lean, bend, open, len: w / Math.max(0.25, Math.sin(mean)), seed: rnd() });
    }
  }
  let wsum = 0;
  for (const b of barbs) wsum += b.len + 0.05;
  let acc = 0;
  for (const b of barbs) {
    acc += (b.len + 0.05) / wsum;
    b.cdf = acc;
  }
  const pickBarb = () => {
    const u = rnd();
    let lo = 0, hi = barbs.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (barbs[m].cdf < u) lo = m + 1;
      else hi = m;
    }
    return barbs[lo];
  };
  const P = [0, 0, 0], D = [0, 0, 0];
  /** Point at v along barb b (→ P) and the barb's direction there (→ D), in the local vane frame. */
  const barbPoint = (b, v) => {
    rachis(b.t);
    const a = b.a0 - b.bend * v + b.open * v * v * 3.0;
    // integrate direction (cos a · T + sin a · side · S) over v
    const a1 = b.a0, k = b.bend - b.open * v * 3.0;
    const kk = Math.abs(k) < 1e-3 ? 1e-3 : k;
    const along = (Math.sin(a1) - Math.sin(a1 - kk * v)) / kk;
    const out = (Math.cos(a1 - kk * v) - Math.cos(a1)) / kk;
    const l = b.len;
    const lat = l * out;
    // camber: the vane curls back away from the viewer toward its edges, the trailing side more
    const cam = -(b.side > 0 ? 0.3 : 0.42) * lat * lat + 0.02 * Math.sin(v * 9 + b.seed * 20) * v;
    P[0] = R[0] + l * along * T[0] + lat * b.side * S[0] + cam * N[0];
    P[1] = R[1] + l * along * T[1] + lat * b.side * S[1] + cam * N[1];
    P[2] = R[2] + l * along * T[2] + lat * b.side * S[2] + cam * N[2];
    D[0] = Math.cos(a) * T[0] + Math.sin(a) * b.side * S[0];
    D[1] = Math.cos(a) * T[1] + Math.sin(a) * b.side * S[1];
    D[2] = Math.cos(a) * T[2] + Math.sin(a) * b.side * S[2];
    return lat;
  };
  // barring: dark chevrons that follow the growth of the vane, pale tip, pale along the shaft
  const marking = (t, lat, w) => {
    const ph = (t - 0.12 * lat) * 6.4 + 0.25 * noise1(lat * 7 + t * 3, 41);
    const bar = smooth(0.52, 0.8, 0.5 + 0.5 * Math.sin(ph * TAU * 0.5 + 0.9)) * smooth(0.02, 0.2, lat / Math.max(w, 0.05)) * (1 - smooth(0.93, 0.99, t));
    return bar;
  };

  // --- rachis and calamus
  let n = cloud.share(0.035);
  for (let i = 0; i < n; i++) {
    if ((i & 1023) === 1023) yield;
    const t = Math.pow(rnd(), 0.8);
    rachis(t);
    const quill = 1 - smooth(0.1, 0.2, t);
    const rad = (0.036 - 0.031 * Math.pow(t, 0.7)) * (1 - 0.75 * smooth(0.05, 0.0, t));
    const a = rnd() * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    // the shaft is squarish with a groove on the underside; the calamus is a hollow, translucent tube
    const rr = rad * (quill > 0.5 ? 1 : 0.8 + 0.2 * Math.abs(Math.cos(2 * a)));
    cloud.add(R[0] + (S[0] * ca + N[0] * sa) * rr, R[1] + (S[1] * ca + N[1] * sa) * rr, R[2] + (S[2] * ca + N[2] * sa) * rr, quill > 0.5 ? 0.3 : 0.75 + 0.2 * sa, 0.05 + 0.1 * rnd(), clamp(t * 0.8));
  }

  // --- barbs
  n = cloud.share(0.4);
  for (let i = 0; i < n; i++) {
    if ((i & 1023) === 1023) yield;
    const b = pickBarb();
    const v = Math.pow(rnd(), 0.9);
    const lat = barbPoint(b, v);
    const bar = marking(b.t, lat, b.w);
    const j = 0.0015;
    cloud.add(P[0] + rnd.gauss() * j, P[1] + rnd.gauss() * j, P[2] + rnd.gauss() * j, (0.55 - 0.2 * v) * (1 - 0.6 * bar), clamp(0.08 + 0.3 * v + 0.62 * bar), clamp(b.t * 0.8 + 0.15 * v));
  }

  // --- barbules: short hooked branches on both sides of every barb, lapping over its neighbours
  n = cloud.share(0.41);
  for (let i = 0; i < n; i++) {
    if ((i & 1023) === 1023) yield;
    const b = pickBarb();
    const v = rnd();
    const lat = barbPoint(b, v);
    const sgn = rnd() < 0.5 ? 1 : -1;
    const u = rnd();
    const len = (0.03 + 0.012 * rnd()) * (1 - 0.5 * v);
    // rotate the barb direction ±~45° within the vane to get the barbule direction
    const ca = 0.72, sa = 0.69 * sgn * b.side;
    const ox = S[0] * b.side, oy = S[1] * b.side, oz = S[2] * b.side;
    const sinA = D[0] * ox + D[1] * oy + D[2] * oz, cosA = D[0] * T[0] + D[1] * T[1] + D[2] * T[2];
    const c2 = cosA * ca - sinA * sa, s2 = sinA * ca + cosA * sa;
    const bx = c2 * T[0] + s2 * ox, by = c2 * T[1] + s2 * oy, bz = c2 * T[2] + s2 * oz;
    const hook = u * u * 0.012;
    const bar = marking(b.t, lat, b.w);
    cloud.add(P[0] + bx * len * u + N[0] * hook, P[1] + by * len * u + N[1] * hook, P[2] + bz * len * u + N[2] * hook, (0.26 - 0.1 * u) * (1 - 0.6 * bar), clamp(0.12 + 0.3 * v + 0.6 * bar), clamp(b.t * 0.8 + 0.15 * v));
  }

  // --- afterfeather: long, loose, wavy down around the top of the calamus
  const NDOWN = 90;
  const down = [];
  for (let k = 0; k < NDOWN; k++) {
    const side = k & 1 ? 1 : -1;
    down.push({ t: 0.125 + 0.13 * rnd(), side, az: (rnd() - 0.5) * 2.2, el: 0.5 + 0.9 * rnd(), len: 0.45 + 0.55 * rnd(), f1: 2 + 4 * rnd(), f2: 5 + 6 * rnd(), p1: rnd() * TAU, p2: rnd() * TAU, sag: 0.25 + 0.5 * rnd() });
  }
  n = cloud.share(0.12);
  for (let i = 0; i < n; i++) {
    if ((i & 1023) === 1023) yield;
    const d = down[(rnd() * NDOWN) | 0];
    rachis(d.t);
    const v = Math.pow(rnd(), 0.85);
    // direction: out to the side, forward along the shaft, and off the vane plane
    const ce = Math.cos(d.el), se = Math.sin(d.el);
    const ox = S[0] * d.side * Math.cos(d.az) + N[0] * Math.sin(d.az), oy = S[1] * d.side * Math.cos(d.az) + N[1] * Math.sin(d.az), oz = S[2] * d.side * Math.cos(d.az) + N[2] * Math.sin(d.az);
    const l = d.len * v;
    const wob = 0.05 * v * Math.sin(v * d.f1 + d.p1) + 0.02 * v * Math.sin(v * d.f2 + d.p2);
    let x = R[0] + l * (se * ox + ce * T[0]) + wob * N[0] + wob * 0.6 * T[0];
    let y = R[1] + l * (se * oy + ce * T[1]) + wob * N[1] - d.sag * l * l * 0.5;
    let z = R[2] + l * (se * oz + ce * T[2]) + wob * N[2];
    let bright = 0.34 * (1 - 0.5 * v);
    if (rnd() < 0.6) {
      // downy barbules: long and fine, standing out in every direction
      const r = 0.07 * rnd() * (0.4 + v);
      const a = rnd() * TAU, c = rnd() * 2 - 1, s = Math.sqrt(1 - c * c);
      x += r * s * Math.cos(a);
      y += r * c;
      z += r * s * Math.sin(a);
      bright *= 0.5;
    }
    cloud.add(x, y, z, bright, 0.02 + 0.14 * rnd(), clamp(d.t * 0.8 + 0.1 * v));
  }

  // --- a few barbules that have come away and hang in the air nearby
  while (cloud.left > 0) {
    if ((cloud.left & 1023) === 0) yield;
    const b = pickBarb();
    barbPoint(b, 0.5 + 0.5 * rnd());
    const r = 0.05 + 0.5 * rnd() * rnd();
    cloud.add(P[0] + rnd.gauss() * r, P[1] + rnd.gauss() * r, P[2] + rnd.gauss() * r * 1.5, 0.08 + 0.12 * rnd(), 0.2 * rnd(), clamp(b.t));
  }

  cloud.transform({ rx: -0.18, ry: 0.42, rz: -0.5, scale: 1.0, tx: -0.05, ty: 0.02 });
}

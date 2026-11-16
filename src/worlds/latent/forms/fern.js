// "fern" — a rosette of fronds, built the way a fern is: rachis → pinnae → pinnules.
// Each pinnule gets a midvein, forked lateral veins, a crenate margin, a cupped lamina and, on the fertile fronds,
// two rows of sori on the underside. Young fronds are still coiled into croziers and covered in gold scales.

import { TAU, clamp, smooth, noise1 } from './cloud.js';

const N_R = 220; // rachis samples

function buildFrond(o, rnd) {
  const { azim, tilt, droop, len, curl, width, crozier, base } = o;
  const ca = Math.cos(azim), sa = Math.sin(azim);
  // integrate the rachis in its own vertical plane; a mature tip nods, a crozier winds up into a spiral
  const P = new Float32Array((N_R + 1) * 3);
  const T = new Float32Array((N_R + 1) * 3);
  const S = new Float32Array((N_R + 1) * 3);
  const Nn = new Float32Array((N_R + 1) * 3);
  let x = base[0], y = base[1], z = base[2];
  let coil = 0; // how far the crozier has wound (radians)
  for (let i = 0; i <= N_R; i++) {
    const t = i / N_R;
    const c = crozier ? smooth(0.25, 1.0, t) : smooth(0.8, 1.0, t);
    const ds = (len / N_R) * (crozier ? 1.0 : 1.0 - 0.45 * c * c);
    let th;
    if (crozier) {
      // a straight stalk, then a logarithmic spiral that tightens as it winds
      if (t > 0.42) coil += ds / (0.105 * len * Math.exp(-0.14 * coil));
      th = tilt + droop * t + coil;
    } else th = tilt + droop * Math.pow(t, 1.5) + curl * c * c;
    const yaw = o.wander * Math.sin(t * 3.1 + o.seed) * t;
    const dx = Math.sin(th) * Math.cos(azim + yaw), dy = Math.cos(th), dz = Math.sin(th) * Math.sin(azim + yaw);
    P[i * 3] = x;
    P[i * 3 + 1] = y;
    P[i * 3 + 2] = z;
    T[i * 3] = dx;
    T[i * 3 + 1] = dy;
    T[i * 3 + 2] = dz;
    // side vector: horizontal, perpendicular to the frond's plane, with a slow twist along the blade
    const tw = o.roll + o.twist * t;
    let sx = -sa, sy = 0, sz = ca;
    // normal = T × S
    let nx = dy * sz - dz * sy, ny = dz * sx - dx * sz, nz = dx * sy - dy * sx;
    const ct = Math.cos(tw), st = Math.sin(tw);
    const s2x = sx * ct + nx * st, s2y = sy * ct + ny * st, s2z = sz * ct + nz * st;
    nx = nx * ct - sx * st;
    ny = ny * ct - sy * st;
    nz = nz * ct - sz * st;
    S[i * 3] = s2x;
    S[i * 3 + 1] = s2y;
    S[i * 3 + 2] = s2z;
    Nn[i * 3] = nx;
    Nn[i * 3 + 1] = ny;
    Nn[i * 3 + 2] = nz;
    x += dx * ds;
    y += dy * ds;
    z += dz * ds;
  }
  // pinnae
  const K = crozier ? 20 : 27;
  const pinnae = [];
  let wsum = 0;
  for (let j = 0; j < K; j++) {
    for (let side = -1; side <= 1; side += 2) {
      const t = clamp(0.1 + 0.885 * Math.pow((j + (side > 0 ? 0.45 : 0)) / K, 0.94), 0, 0.995);
      const env = Math.min(1, Math.pow(t / 0.26, 0.75)) * Math.pow(1 - Math.max(0, (t - 0.26) / 0.76), 0.92);
      let l = width * env * (0.9 + 0.2 * rnd()) * (crozier ? 0.5 * (1 - 0.8 * smooth(0.3, 0.9, t)) : 1);
      if (l < 0.03) continue;
      const beta = (82 - 30 * t + 8 * (rnd() - 0.5)) * (Math.PI / 180);
      const w = Math.pow(l, 1.55);
      wsum += w;
      pinnae.push({ t, side, l, beta, w, gap: (len * 0.885 * 0.94 * Math.pow(Math.max(0.03, (j + 0.5) / K), -0.06)) / K, M: clamp(Math.round(l / 0.07), 3, 22), hue: rnd(), sag: 0.1 + 0.12 * rnd(), fertile: !crozier && t > 0.28 && rnd() < 0.85 });
    }
  }
  let acc = 0;
  for (const p of pinnae) {
    acc += p.w / wsum;
    p.cdf = acc;
  }
  return { ...o, P, T, S, Nn, pinnae, area: len * width };
}

export function* fern(cloud, rnd) {
  const base = [0.1, -2.5, 0];
  const defs = [
    // the great arching fronds that make the silhouette: rolled so their blades face the viewer
    { azim: Math.PI * 0.93, tilt: 0.22, droop: 1.15, len: 5.3, curl: 1.3, width: 1.05, roll: -1.1 },
    { azim: -0.2, tilt: 0.3, droop: 1.2, len: 4.9, curl: 1.6, width: 1.0, roll: 1.15 },
    // one tall at the back, two low ones spilling toward the viewer
    { azim: -Math.PI * 0.52, tilt: 0.16, droop: 0.55, len: 4.7, curl: 1.0, width: 0.92, roll: -0.25 },
    { azim: Math.PI * 0.62, tilt: 0.95, droop: 0.9, len: 3.3, curl: 1.4, width: 0.8, roll: -0.7 },
    { azim: Math.PI * 0.2, tilt: 1.05, droop: 0.8, len: 3.1, curl: 1.2, width: 0.76, roll: 0.75 },
    // croziers: young fronds still wound up, rising in the gap between the old ones
    { azim: Math.PI * 0.42, tilt: 0.1, droop: 0.12, len: 4.3, curl: 0, width: 0.5, crozier: true, roll: 1.3 },
    { azim: Math.PI * 0.8, tilt: 0.3, droop: 0.15, len: 3.2, curl: 0, width: 0.42, crozier: true, roll: -1.25 },
    { azim: -Math.PI * 0.05, tilt: 0.34, droop: 0.2, len: 2.5, curl: 0, width: 0.36, crozier: true, roll: 1.1 },
  ];
  const fronds = defs.map((d, i) => buildFrond({ crozier: false, wander: 0.12, twist: (i % 2 ? 1 : -1) * 0.35, seed: i * 1.9, base, ...d }, rnd));
  let asum = 0;
  for (const f of fronds) asum += f.area * (f.crozier ? 0.42 : 1);
  let acc = 0;
  for (const f of fronds) {
    acc += (f.area * (f.crozier ? 0.42 : 1)) / asum;
    f.cdf = acc;
  }

  const q = [0, 0, 0];
  const rach = (f, t) => {
    const x = clamp(t) * N_R;
    const i = Math.min(N_R - 1, Math.floor(x));
    return [i, x - i];
  };

  const total = cloud.left;
  let tick = 0;
  for (let n = 0; n < total; n++) {
    if ((++tick & 1023) === 0) yield;
    // frond
    let u = rnd();
    let fi = 0;
    while (fi < fronds.length - 1 && u > fronds[fi].cdf) fi++;
    const f = fronds[fi];
    const { P, T, S, Nn } = f;
    const kind = rnd();

    if (kind < (f.crozier ? 0.42 : 0.05)) {
      // rachis and stipe: a thin stem, with papery scales near the base and all over the croziers
      const t = f.crozier ? Math.pow(rnd(), 0.55) : rnd();
      const [i, fr] = rach(f, t);
      const o = i * 3;
      const px = P[o] + (P[o + 3] - P[o]) * fr, py = P[o + 1] + (P[o + 4] - P[o + 1]) * fr, pz = P[o + 2] + (P[o + 5] - P[o + 2]) * fr;
      const rad = 0.024 * (1 - 0.75 * t) * (f.len / 4.5);
      const scaly = f.crozier ? 0.75 : 1 - smooth(0.0, 0.16, t);
      if (rnd() < scaly * 0.6) {
        // a scale: a short bristle standing off the stem
        const a = rnd() * TAU;
        const h = rad + rnd() * (f.crozier ? 0.075 : 0.05);
        const ox = S[o] * Math.cos(a) + Nn[o] * Math.sin(a), oy = S[o + 1] * Math.cos(a) + Nn[o + 1] * Math.sin(a), oz = S[o + 2] * Math.cos(a) + Nn[o + 2] * Math.sin(a);
        cloud.add(px + ox * h + T[o] * h * 0.6, py + oy * h + T[o + 1] * h * 0.6, pz + oz * h + T[o + 2] * h * 0.6, 0.28 + 0.3 * rnd(), 0.78 + 0.22 * rnd(), clamp(0.05 * fi + t * 0.7));
      } else {
        const a = rnd() * TAU;
        cloud.add(px + (S[o] * Math.cos(a) + Nn[o] * Math.sin(a)) * rad, py + (S[o + 1] * Math.cos(a) + Nn[o + 1] * Math.sin(a)) * rad, pz + (S[o + 2] * Math.cos(a) + Nn[o + 2] * Math.sin(a)) * rad, f.crozier ? 0.4 : 0.9, 0.3 + 0.2 * rnd(), clamp(0.05 * fi + t * 0.7));
      }
      continue;
    }

    // pinna
    u = rnd();
    let lo = 0, hi = f.pinnae.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (f.pinnae[mid].cdf < u) lo = mid + 1;
      else hi = mid;
    }
    const pn = f.pinnae[lo];
    const [i, fr] = rach(f, pn.t);
    const o = i * 3;
    const bx = P[o] + (P[o + 3] - P[o]) * fr, by = P[o + 1] + (P[o + 4] - P[o + 1]) * fr, bz = P[o + 2] + (P[o + 5] - P[o + 2]) * fr;
    const tx = T[o], ty = T[o + 1], tz = T[o + 2];
    const sx = S[o] * pn.side, sy = S[o + 1] * pn.side, sz = S[o + 2] * pn.side;
    const nx = Nn[o], ny = Nn[o + 1], nz = Nn[o + 2];
    const cb = Math.cos(pn.beta), sb = Math.sin(pn.beta);
    const d0x = cb * tx + sb * sx, d0y = cb * ty + sb * sy, d0z = cb * tz + sb * sz;
    // midrib of the pinna: sweeps toward the frond tip and sags a little under its own weight
    const l = pn.l;
    const SW = 0.24;
    const order = clamp(0.05 * fi + 0.62 * pn.t);
    const mid = (v, out) => {
      out[0] = bx + l * (v * d0x + v * v * SW * tx) + l * v * v * -0.02;
      out[1] = by + l * (v * d0y + v * v * SW * ty) - l * v * v * pn.sag;
      out[2] = bz + l * (v * d0z + v * v * SW * tz);
    };
    const sub = rnd();
    if (sub < 0.065) {
      const v = rnd();
      mid(v, q);
      cloud.add(q[0] + rnd.gauss() * 0.003, q[1] + rnd.gauss() * 0.003, q[2] + rnd.gauss() * 0.003, 0.85, 0.36 + 0.14 * rnd(), clamp(order + 0.2 * v));
      continue;
    }
    // pinnule: choose one along the pinna (longer ones nearer the rachis hold more points)
    const M = pn.M;
    const v = Math.min(0.985, 0.03 + 0.95 * (1 - Math.sqrt(1 - rnd() * 0.97)));
    const k = Math.min(M - 1, Math.floor(v * M));
    const vk = (k + 0.5) / M;
    const ps = (k + (lo & 1)) & 1 ? 1 : -1; // alternate sides, staggered between neighbouring pinnae
    const pside = rnd() < 0.5 ? ps : -ps;
    const vv = clamp(vk + (pside > 0 ? 0.25 : -0.25) / M, 0.01, 0.99);
    mid(vv, q);
    // local frame of the pinna at vv
    let ax = d0x + 2 * vv * SW * tx, ay = d0y + 2 * vv * SW * ty - 2 * vv * pn.sag, az = d0z + 2 * vv * SW * tz;
    let il = 1 / Math.hypot(ax, ay, az);
    ax *= il;
    ay *= il;
    az *= il;
    // b = n × a (in-blade perpendicular), signed to the chosen side
    let px = (ny * az - nz * ay) * pside, py = (nz * ax - nx * az) * pside, pz = (nx * ay - ny * ax) * pside;
    il = 1 / Math.hypot(px, py, pz);
    px *= il;
    py *= il;
    pz *= il;
    const lam = Math.min(0.56 * pn.gap, 0.34 * l) * Math.pow(1 - vv, 0.62) * (0.75 + 0.25 * smooth(0, 0.12, vv)) * (0.9 + 0.2 * noise1(k * 1.7 + lo * 3.1, 5));
    const hw = (l / M) * 0.46; // half width
    const CD = 0.5, SD = 0.866; // pinnule leaves the midrib at ~60°
    const dx = CD * ax + SD * px, dy = CD * ay + SD * py, dz = CD * az + SD * pz;
    const wx = SD * ax - CD * px, wy = SD * ay - CD * py, wz = SD * az - CD * pz;
    const shape = (a) => Math.sqrt(Math.min(1, a * 5)) * Math.pow(1 - a, 0.55) * (1 + 0.16 * Math.cos(a * 6.5 * TAU)) * 1.12;
    let a, c, bright, tint, lift = 0;
    const leaf = 0.06 + 0.2 * pn.hue + 0.12 * noise1(k * 0.9 + lo, 11) + 0.16 * pn.t;
    if (sub < 0.17) {
      // midvein
      a = rnd();
      c = rnd.gauss() * 0.03;
      bright = 0.7;
      tint = leaf + 0.2;
    } else if (sub < 0.36) {
      // forked lateral veins running out to the margin
      const kv = Math.floor(rnd() * 6);
      const r = rnd();
      c = (rnd() < 0.5 ? -1 : 1) * r;
      const fork = r > 0.55 ? (rnd() < 0.5 ? 0.05 : -0.03) * (r - 0.55) * 2 : 0;
      a = clamp((kv + 0.6) / 6.6 + r * 0.11 + fork, 0, 1);
      c *= 0.96;
      bright = 0.5;
      tint = leaf + 0.14;
    } else if (sub < 0.47) {
      // margin
      a = Math.pow(rnd(), 0.8);
      c = rnd() < 0.5 ? -1 : 1;
      bright = 0.62;
      tint = leaf + 0.1;
    } else if (sub < 0.54 && pn.fertile && lam > 0.05) {
      // sori: round clusters in two rows under the leaflet
      const ks = Math.floor(rnd() * 4);
      const g1 = rnd.gauss() * 0.3, g2 = rnd.gauss() * 0.3;
      a = clamp((ks + 0.8) / 5 + (g1 * hw * 0.42) / lam, 0, 1);
      c = (rnd() < 0.5 ? -0.5 : 0.5) + g2 * 0.42;
      bright = 0.9;
      tint = 0.88 + 0.12 * rnd();
      lift = -0.012;
    } else {
      // lamina
      a = rnd();
      c = rnd() * 2 - 1;
      if (rnd() > shape(a) * 0.8) {
        n--;
        continue;
      }
      bright = 0.24 + 0.14 * rnd();
      tint = leaf + 0.08 * (rnd() - 0.5);
    }
    const h = hw * shape(a);
    const cup = -0.28 * h * c * c + lift - 0.04 * lam * a * a;
    cloud.add(
      q[0] + lam * a * dx + c * h * wx + nx * cup,
      q[1] + lam * a * dy + c * h * wy + ny * cup,
      q[2] + lam * a * dz + c * h * wz + nz * cup,
      bright,
      clamp(tint),
      clamp(order + 0.22 * vv + 0.06 * a),
    );
  }
  cloud.transform({ ry: 0.25, scale: 1.0, ty: 0.28 });
}

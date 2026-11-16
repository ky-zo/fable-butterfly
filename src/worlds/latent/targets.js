// Everything a point can be attracted to, baked into textures once at init:
//   forms  — one texel per form point (xyz in its region's frame, w = packed ramp/order/tint/brightness), laid out
//            in the same rows as the simulation: region i owns rows [start[i], start[i] + band[i])
//   home   — rest positions of the near dust (unit cube, wraps around the camera) and of the far web (world space)
//   axis   — the centre line of the scent plume, from the flowers downwind
//
// All of it is made in slices of a few milliseconds: this runs while the world before this one is on screen.

import * as THREE from 'three';
import { NS, ST, STATIONS, SUN, PANE, EYE_R, END, END_FOV, MOON_LOCAL, PERCH, pathAt } from './config.js';
import { generateForm } from './forms/index.js';

const now = () => performance.now();
/** `await tick()` gives the page a breath if more than `budget` ms have gone by since the last one. */
function ticker(ctx, budget = 5) {
  let t0 = now();
  return async () => {
    if (now() - t0 > budget) {
      await ctx.yield();
      t0 = now();
    }
  };
}

function floatTexture(ctx, data, w, h) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return ctx.track(tex);
}

// ------------------------------------------------------------------------------------------------ forms

export async function buildForms(ctx, L) {
  const data = new Float32Array(L.W * L.Hf * 4);
  const pause = () => ctx.yield();
  // the compass direction in a region's own frame
  const sunIn = (i) => [SUN.dot(STATIONS[i].r), SUN.dot(STATIONS[i].u), SUN.dot(STATIONS[i].n)];
  const args = {
    [ST.FERN]: [],
    [ST.FOOD]: [sunIn(ST.FOOD)],
    [ST.EYE]: [EYE_R],
    [ST.PANE]: [PANE.w, PANE.h, [PERCH[1].at[0], PERCH[1].at[1]]],
    [ST.COLD]: [{ tan: Math.tan((END_FOV * Math.PI) / 360), pitch: END.pitch, water: END.water, moon: MOON_LOCAL.toArray(), radius: END.moonRadius, horizon: 0.42, calm: [0, 1 - 2 * 0.615] }],
  };
  for (let i = 0; i < NS; i++) {
    const n = L.W * L.band[i];
    const cloud = await generateForm(STATIONS[i].name, n, ctx.rng(100 + i * 17), pause, ...args[i]);
    data.set(cloud.data, L.W * L.start[i] * 4);
    await ctx.yield();
  }
  return floatTexture(ctx, data, L.W, L.Hf);
}

// ------------------------------------------------------------------------------------------------ scent

export const AXIS_N = 64;
/** The plume's centre line: out of the big flower and away downwind, back along the line the butterfly flies in on. */
export function buildAxis(ctx) {
  const data = new Float32Array(AXIS_N * 4);
  const p = new THREE.Vector3();
  const src = STATIONS[ST.FOOD].c.clone().addScaledVector(STATIONS[ST.FOOD].n, 0.5);
  const first = pathAt(0.335, new THREE.Vector3());
  for (let i = 0; i < AXIS_N; i++) {
    const e = i / (AXIS_N - 1);
    if (e < 0.07) p.copy(src).lerp(first, e / 0.07);
    else {
      const t = (e - 0.07) / 0.93;
      pathAt(0.335 - 0.315 * t, p);
      // beyond where the visit begins it carries on, and it never lies exactly on the line of flight
      p.z += 16 * Math.max(0, t - 0.94) * 16;
      p.x += Math.sin(t * 7.0) * 1.1 * t - 0.5 * t;
      p.y += -0.55 * Math.sin(t * 3.1) - 0.5 * t + Math.sin(t * 11.0) * 0.3 * t;
    }
    data.set([p.x, p.y, p.z, 1], i * 4);
  }
  return floatTexture(ctx, data, AXIS_N, 1);
}

// ------------------------------------------------------------------------------------------------ dust + web

/** Random periodic potential; its gradient moves uniformly scattered points into sheets, filaments and knots. */
function makePotential(rnd, modes, kmin, kmax, slope) {
  const list = [];
  for (let m = 0; m < modes; m++) {
    let kx = 0, ky = 0, kz = 0, kl = 0;
    do {
      kx = rnd.int(-kmax, kmax);
      ky = rnd.int(-kmax, kmax);
      kz = rnd.int(-kmax, kmax);
      kl = Math.hypot(kx, ky, kz);
    } while (kl < kmin || kl > kmax);
    list.push([kx * 6.2831853, ky * 6.2831853, kz * 6.2831853, 1 / Math.pow(kl, slope), rnd() * 6.2831853]);
  }
  return list;
}
function grad(pot, x, y, z, out) {
  let gx = 0, gy = 0, gz = 0;
  for (let m = 0; m < pot.length; m++) {
    const k = pot[m];
    const s = -k[3] * Math.sin(k[0] * x + k[1] * y + k[2] * z + k[4]);
    gx += s * k[0];
    gy += s * k[1];
    gz += s * k[2];
  }
  out[0] = gx;
  out[1] = gy;
  out[2] = gz;
}

export const WEB_RADIUS = 215;
export const WEB_CENTRE = new THREE.Vector3(-8, 4, -74);

/** w channel of a home texel: integer part = brightness × 16, fraction = tint. */
const packHome = (bright, tint) => Math.floor(Math.max(0, Math.min(60, bright)) * 16) + Math.max(0, Math.min(0.99, tint * 0.99));

/**
 * The far web: everything else it holds, too far off to be a thing. Knots, and filaments between knots that lie near
 * each other. The four regions of the garden are knots in it too.
 */
export function buildWebGraph(ctx) {
  const rnd = ctx.rng(4242);
  const c = WEB_CENTRE;
  const nodes = STATIONS.slice(0, 4).map((s, i) => ({ p: s.c.clone(), station: i, size: 0 }));
  const R = WEB_RADIUS;
  let guard = 0;
  while (nodes.length < 4 + 84 && guard++ < 20000) {
    const u = rnd() * 2 - 1, ph = rnd() * 6.2831853, s = Math.sqrt(1 - u * u);
    const r = R * Math.pow(rnd(), 0.5);
    const p = new THREE.Vector3(c.x + Math.cos(ph) * s * r, c.y + u * r * 0.62, c.z + Math.sin(ph) * s * r);
    let ok = true;
    for (const n of nodes) if (n.p.distanceTo(p) < (n.station != null ? 30 : 30)) ok = false;
    if (ok) nodes.push({ p, station: null, size: 2.2 + 4.5 * rnd() * rnd() });
  }
  const edges = [];
  const has = (a, b) => edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  for (let i = 0; i < nodes.length; i++) {
    const near = nodes
      .map((n, j) => ({ j, d: n.p.distanceTo(nodes[i].p) }))
      .filter((x) => x.j !== i)
      .sort((x, y) => x.d - y.d);
    const k = nodes[i].station != null ? 2 : rnd() < 0.5 ? 2 : 3;
    for (let m = 0; m < k; m++) {
      const j = near[m].j;
      if (!has(i, j) && near[m].d < 95) edges.push({ a: i, b: j, w: 0.5 + rnd() * 0.8 });
    }
  }
  for (const e of edges) {
    const A = nodes[e.a].p, B = nodes[e.b].p;
    const len = A.distanceTo(B);
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const bow = new THREE.Vector3(rnd.gauss(), rnd.gauss() * 0.7, rnd.gauss()).multiplyScalar(len * 0.16);
    e.A = A;
    e.B = B;
    e.C = mid.add(bow);
    e.len = len;
    e.seed = rnd() * 100;
    // a perpendicular frame for the braids
    const d = B.clone().sub(A).normalize();
    e.u = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    e.v = new THREE.Vector3().crossVectors(d, e.u);
    e.strands = Array.from({ length: 3 }, () => ({ ph: rnd() * 6.283, tw: (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 5), r: 0.5 + rnd() * 1.6 }));
  }
  return { nodes, edges };
}

export async function buildHome(ctx, L, graph) {
  const rows = L.Hd + L.Hw;
  const data = new Float32Array(L.W * rows * 4);
  const g = [0, 0, 0];
  const tick = ticker(ctx, 5);

  // near dust: unit cube, gently clumped into wisps
  {
    const rnd = ctx.rng(51);
    const pot = makePotential(rnd, 14, 1, 4, 2.2);
    const n = L.W * L.Hd;
    for (let i = 0; i < n; i++) {
      const x = rnd(), y = rnd(), z = rnd();
      grad(pot, x, y, z, g);
      const D = 0.0075;
      const o = i * 4;
      data[o] = x + g[0] * D;
      data[o + 1] = y + g[1] * D;
      data[o + 2] = z + g[2] * D;
      const r = rnd();
      // most motes are faint; a few catch the light
      data[o + 3] = packHome(0.12 + 0.7 * r * r * r + (rnd() < 0.006 ? 6 + 16 * rnd() : 0), rnd());
      if ((i & 511) === 0) await tick();
    }
  }

  // far web
  {
    const rnd = ctx.rng(77);
    const pot = makePotential(rnd, 22, 1, 5, 2.0);
    const n = L.W * L.Hw;
    const c = WEB_CENTRE;
    // the air is kept clear round each region of the garden, and all along the line of flight
    const clear = STATIONS.slice(0, 4).map((s) => [s.c.x, s.c.y, s.c.z, 14]);
    const pp = new THREE.Vector3();
    for (let k = 0; k <= 40; k++) {
      pathAt(0.02 + 0.8 * (k / 40), pp);
      clear.push([pp.x, pp.y, pp.z, 9]);
    }
    const { nodes, edges } = graph;
    const R = WEB_RADIUS;
    const base = L.W * L.Hd * 4;
    let wsum = 0;
    for (const e of edges) wsum += (e.cw = e.len * e.w);
    const halos = nodes.filter((nd) => nd.station == null);
    // beyond the web we travel through there is more of it, and more beyond that: a thin outer shell of far
    // knots and sheets that only ever shows as soft light, so the room has no visible wall
    const nFar = Math.floor(n * 0.2);
    const nNear = n - nFar;
    const blobs = [];
    for (let k = 0; k < 90; k++) {
      const u = rnd() * 2 - 1, ph = rnd() * 6.2831853, s = Math.sqrt(1 - u * u);
      const r = 300 + 900 * Math.pow(rnd(), 1.4);
      blobs.push({ x: c.x + Math.cos(ph) * s * r, y: c.y + u * r * 0.6, z: c.z + Math.sin(ph) * s * r, r: (8 + 30 * rnd() * rnd()) * (r / 500), e: [0.4 + rnd(), 0.4 + rnd(), 0.4 + rnd()] });
    }
    let i = 0;
    let guard = 0;
    while (i < n) {
      if ((++guard & 255) === 0) await tick();
      if (i >= nNear) {
        let x, y, z, bright;
        const tint = 0.3 + 0.7 * rnd();
        if (rnd() < 0.45) {
          const b = blobs[(rnd() * blobs.length) | 0];
          const q = Math.pow(Math.abs(rnd.gauss()), 1.4) * b.r;
          const u = rnd() * 2 - 1, ph = rnd() * 6.2831853, s = Math.sqrt(1 - u * u);
          x = b.x + Math.cos(ph) * s * q * b.e[0];
          y = b.y + u * q * b.e[1];
          z = b.z + Math.sin(ph) * s * q * b.e[2];
          bright = 1.2 + 5 * rnd() * rnd();
        } else {
          const u = rnd() * 2 - 1, ph = rnd() * 6.2831853, s = Math.sqrt(1 - u * u);
          const r = 260 + 1000 * Math.pow(rnd(), 1.2);
          x = Math.cos(ph) * s * r;
          y = u * r * 0.6;
          z = Math.sin(ph) * s * r;
          grad(pot, x / 2600 + 0.5, y / 2600 + 0.5, z / 2600 + 0.5, g);
          x += g[0] * 26 + c.x;
          y += g[1] * 26 + c.y;
          z += g[2] * 26 + c.z;
          bright = 0.8 + 4 * rnd() * rnd() * rnd();
        }
        const dd = Math.hypot(x - c.x, y - c.y, z - c.z);
        bright *= Math.pow(dd / 420, 1.3);
        if (rnd() < 0.006) bright *= 5;
        const o = base + i * 4;
        data[o] = x;
        data[o + 1] = y;
        data[o + 2] = z;
        data[o + 3] = packHome(bright, tint);
        i++;
        continue;
      }
      let x, y, z, bright, tint;
      const kind = rnd();
      if (kind < 0.6) {
        // along a filament
        let pick = rnd() * wsum;
        let e = edges[0];
        for (const q of edges) {
          pick -= q.cw;
          if (pick <= 0) {
            e = q;
            break;
          }
        }
        const t = rnd();
        const a = (1 - t) * (1 - t), b = 2 * t * (1 - t), cc = t * t;
        x = e.A.x * a + e.C.x * b + e.B.x * cc;
        y = e.A.y * a + e.C.y * b + e.B.y * cc;
        z = e.A.z * a + e.C.z * b + e.B.z * cc;
        // filaments swell and pinch along their length
        const env = 0.55 + 0.45 * Math.sin(t * e.len * 0.11 + e.seed) + 0.35 * Math.sin(t * e.len * 0.31 + e.seed * 2.3);
        let ou, ov, sig;
        if (rnd() < 0.62) {
          const st = e.strands[(rnd() * 3) | 0];
          const ang = st.ph + st.tw * t * 6.283 * (e.len / 60);
          const rr = st.r * (0.6 + 0.6 * env);
          sig = 0.16 + 0.3 * rnd() * rnd();
          ou = Math.cos(ang) * rr + rnd.gauss() * sig;
          ov = Math.sin(ang) * rr + rnd.gauss() * sig;
          bright = 0.5 + 0.9 * rnd() * rnd();
          tint = 0.1 + 0.4 * rnd();
        } else {
          sig = 1.6 + 2.6 * Math.max(0, env);
          const q = Math.abs(rnd.gauss());
          const an = rnd() * 6.283;
          ou = Math.cos(an) * q * sig;
          ov = Math.sin(an) * q * sig;
          bright = 0.22 + 0.4 * rnd() * rnd();
          tint = 0.35 + 0.5 * rnd();
        }
        x += e.u.x * ou + e.v.x * ov;
        y += e.u.y * ou + e.v.y * ov;
        z += e.u.z * ou + e.v.z * ov;
      } else if (kind < 0.74) {
        // a knot of dust around something else it knows
        const nd = halos[(rnd() * halos.length) | 0];
        const q = nd.size * Math.pow(Math.abs(rnd.gauss()), 1.6);
        const u = rnd() * 2 - 1, ph = rnd() * 6.2831853, s = Math.sqrt(1 - u * u);
        x = nd.p.x + Math.cos(ph) * s * q;
        y = nd.p.y + u * q;
        z = nd.p.z + Math.sin(ph) * s * q;
        bright = 0.35 + 1.1 * Math.exp(-q / nd.size) * rnd();
        tint = 0.05 + 0.5 * rnd();
      } else {
        // the diffuse field between, pulled into faint sheets
        const u = rnd() * 2 - 1, ph = rnd() * 6.2831853, s = Math.sqrt(1 - u * u);
        const r = R * 1.15 * Math.pow(rnd(), 0.4);
        x = Math.cos(ph) * s * r;
        y = u * r * 0.7;
        z = Math.sin(ph) * s * r;
        grad(pot, x / (2.4 * R) + 0.5, y / (2.4 * R) + 0.5, z / (2.4 * R) + 0.5, g);
        const D = 0.0085 * 2.4 * R;
        x += g[0] * D + c.x;
        y += g[1] * D + c.y;
        z += g[2] * D + c.z;
        bright = 0.14 + 0.5 * rnd() * rnd() * rnd();
        tint = 0.5 + 0.5 * rnd();
      }
      let keep = 1;
      for (let k = 0; k < clear.length; k++) {
        const cl = clear[k];
        const dx = x - cl[0], dy = y - cl[1], dz = z - cl[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        const rr = cl[3];
        if (d2 < rr * rr) keep = Math.min(keep, d2 < rr * rr * 0.25 ? 0 : (Math.sqrt(d2) - rr * 0.5) / (rr * 0.5));
      }
      if (rnd() > keep) continue;
      if (rnd() < 0.004) bright += 3 + 9 * rnd();
      const o = base + i * 4;
      data[o] = x;
      data[o + 1] = y;
      data[o + 2] = z;
      data[o + 3] = packHome(bright, tint);
      i++;
    }
  }
  await ctx.yield();
  return floatTexture(ctx, data, L.W, rows);
}

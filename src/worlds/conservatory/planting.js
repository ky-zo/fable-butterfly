// The planting plan: where everything in the garden stands. The first half is the planting the corridor was composed
// around (two borders pressed against the long walls, the leaves laid on particular panes, the climbers); the second
// half is what makes it a place you could walk into: big trees with roots hanging from them, stones, a pool and a path
// beyond the end pane, and — rarely — flowers.

import * as THREE from 'three';
import { HW, EAVE, RIDGE, ZB, ZE } from './layout.js';
import { PRESSED } from './heroes.js';
import { POOL, pathX } from './gardenEnv.js';

const dirOf = (az, el, out = new THREE.Vector3()) => out.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * The stages of the plan, in order. The garden runs them one at a time with a breath between (they are built while
 * another world is on screen).
 */
export const PLANT_STAGES = [plantBorders, plantComposed, plantPlace, plantFlowers];

function plantBorders(g) {
  const rnd = g.rnd;
  const dens = 1; // the planting is the same on every tier (it is the composition); tiers change how it is drawn

  // --- the two long borders. side = -1 (sunlit) / +1 (shade)
  for (const side of [-1, 1]) {
    const toward = side < 0 ? 0 : Math.PI; // azimuth pointing at the glass
    const X = (d) => side * (HW + d);
    for (let z = ZB + 1.5; z > ZE - 0.6; z -= 1.0) {
      const bay = Math.round(-z);
      // right behind the pane: ferns at every height, the odd monstera leaning in
      const nFern = Math.round((side > 0 ? 2.6 : 1.7) * dens + rnd() * 1.4);
      for (let i = 0; i < nFern; i++) {
        const d = 0.1 + rnd() * rnd() * 0.75;
        const y = rnd() < 0.5 ? rnd() * 0.5 : 0.5 + rnd() * 1.9;
        const c = V(X(d), y, z + (rnd() - 0.5) * 1.0);
        g.fern(c, 6 + Math.floor(rnd() * 5), 0.5 + rnd() * 0.45, { lo: d > 0.3 });
        // (its caudex leans in from further back, so that it is the fronds that meet the glass and not the wood)
        if (y > 0.5) g.trunk([[X(d + 0.3), -0.1, c.z + 0.05], [X(d + 0.16) + (rnd() - 0.5) * 0.06, y * 0.55, c.z], [X(d + 0.03), y - 0.03, c.z]], 0.03, 0.018, 6, 3);
      }
      if (rnd() < (side < 0 ? 0.62 : 0.4) * dens + 0.1) {
        const d = 0.14 + rnd() * 0.4;
        const y = rnd() * 1.25;
        const c = V(X(d), y, z + (rnd() - 0.5) * 0.9);
        g.monstera(c, toward, 4 + Math.floor(rnd() * 5), 0.34 + rnd() * 0.22);
        if (y > 0.3) g.trunk([[X(d + 0.25), -0.1, c.z], [X(d + 0.12), y * 0.6, c.z + 0.04], [X(d + 0.02), y, c.z]], 0.03, 0.018, 6, 3);
      }
      if (rnd() < 0.55 * dens) g.paddle(V(X(0.2 + rnd() * 0.8), rnd() * 0.25, z + (rnd() - 0.5)), 5 + Math.floor(rnd() * 5), 0.5 + rnd() * 0.4);
      const nGrass = Math.round(2 * dens + rnd() * 2);
      for (let i = 0; i < nGrass; i++) g.grass(V(X(0.05 + rnd() * 0.9), 0, z + (rnd() - 0.5)), 8 + Math.floor(rnd() * 8), 0.45 + rnd() * 0.6);

      // an arm's length to a few metres back: bigger, looser
      for (let i = 0; i < 2; i++) {
        const d = 0.8 + rnd() * 2.2;
        const c = V(X(d), rnd() * 0.4, z + (rnd() - 0.5) * 1.2);
        const r = rnd();
        if (r < 0.34) g.monstera(c, rnd() * 6.28, 5 + Math.floor(rnd() * 4), 0.45 + rnd() * 0.3, { lean: 0 });
        else if (r < 0.62) g.paddle(c, 6 + Math.floor(rnd() * 5), 0.75 + rnd() * 0.5);
        else g.fern(c.setY(0.3 + rnd() * 1.4), 7 + Math.floor(rnd() * 5), 0.8 + rnd() * 0.5, { lo: true });
      }
      if (rnd() < 0.6) g.palm(V(X(0.9 + rnd() * 3.2), 0, z + (rnd() - 0.5)), 0.8 + rnd() * rnd() * 4.2, 6 + Math.floor(rnd() * 3), 1.3 + rnd() * 0.9, 0.3);
      // tall palms whose crowns hang over the roof
      if (bay % 3 === (side < 0 ? 0 : 1)) g.palm(V(X(0.7 + rnd() * 1.1), 0, z + (rnd() - 0.5)), 3.7 + rnd() * 1.3, 8, 2.0 + rnd() * 0.6, 0.4);
      // far masses: big dark leaves high up, so the sky arrives in pieces
      const nFar = Math.round(2 * dens);
      for (let i = 0; i < nFar; i++) {
        const c = V(X(2.6 + rnd() * 3.2), 1.2 + rnd() * 4.5, z + (rnd() - 0.5) * 1.4);
        g.monstera(c, rnd() * 6.28, 4 + Math.floor(rnd() * 3), 0.7 + rnd() * 0.6, { lean: 0, lo: true });
      }
    }
  }

}

function plantComposed(g) {
  const rnd = g.rnd;
  const dens = 1;
  // --- composed: leaves laid against particular panes
  for (const [wall, ps, pt, type, size, ang, o] of PRESSED) g.press(wall, ps, pt, type, size, ang, o);

  // --- climbers on the glass
  const climb = (wall, s0, h, wander, o) => {
    const path = [];
    const n = 7;
    let s = s0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      s += (rnd() - 0.5) * wander;
      path.push([s, 0.02 + (h - 0.02) * Math.pow(t, 0.9)]);
    }
    g.vine(wall, path, o);
  };
  for (const s of [3.3, 5.6, 6.35, 9.2, 11.6, 13.7]) climb(0, s + (rnd() - 0.5) * 0.3, 1.3 + rnd() * 1.5, 0.3, { size: 0.085 + rnd() * 0.05, blooms: s === 6.35 || s === 11.6 ? 9 : s === 3.3 ? 5 : 0 });
  for (const s of [2.5, 4.9, 7.6, 10.4, 12.3, 14.1]) climb(1, s + (rnd() - 0.5) * 0.3, 1.2 + rnd() * 1.6, 0.34, { size: 0.08 + rnd() * 0.05, blooms: s === 4.9 || s === 12.3 ? 7 : 0 });
  climb(2, 1.85, 2.3, 0.3, { size: 0.11, blooms: 8 });
  climb(2, 0.2, 1.1, 0.16, { size: 0.09 });

  // --- beyond the end pane: composed for the last shot. Low and dense at the glass, a clearing, then tall trunks.
  for (let i = 0; i < 9 * dens; i++) {
    const dz = 0.15 + rnd() * 1.6;
    g.fern(V(-2.6 + rnd() * 5.2, rnd() < 0.6 ? rnd() * 0.3 : 0.5 + rnd() * 1.2, ZE - dz), 7 + Math.floor(rnd() * 5), 0.55 + rnd() * 0.5, { lo: dz > 0.7 });
  }
  g.monstera(V(0.95, 0.5, ZE - 0.3), -Math.PI / 2, 7, 0.42);
  g.monstera(V(-1.3, 0.2, ZE - 0.9), -Math.PI / 2, 6, 0.5);
  g.monstera(V(1.7, 0.0, ZE - 2.2), 0, 7, 0.6, { lean: 0 });
  for (let i = 0; i < 7 * dens; i++) g.paddle(V(-3.5 + rnd() * 7, 0, ZE - 1.2 - rnd() * 4), 6 + Math.floor(rnd() * 5), 0.7 + rnd() * 0.6);
  for (let i = 0; i < 26 * dens; i++) {
    // (same four draws in the same order as before, so nothing planted after this moves)
    const x = -3 + rnd() * 6;
    let dz = 0.1 + rnd() * 4;
    const n = 9 + Math.floor(rnd() * 8);
    let size = 0.5 + rnd() * 0.7;
    // The last shot looks out through this pane from 30 cm away, low, near x = 1. A clump at the foot of the glass
    // there puts single blades right across the lens, where they read as green slabs: in that window the grass
    // starts further out, and along the whole pane the clumps nearest the glass are the small ones.
    if (x > -1.8 && x < 2.0 && dz < 1.6) dz = 1.6 + dz * 0.5;
    size *= Math.min(1, 0.45 + dz * 0.35);
    g.grass(V(x, 0, ZE - dz), n, size);
  }
  for (let i = 0; i < 12; i++) {
    const x = (rnd() < 0.5 ? -1 : 1) * (0.9 + rnd() * 4.2);
    g.palm(V(x, 0, ZE - 2.5 - rnd() * 8), 1.2 + rnd() * 4.8, 8 + Math.floor(rnd() * 3), 1.5 + rnd() * 1.0, 0.5);
  }
  for (let i = 0; i < 16 * dens; i++) g.monstera(V(-5 + rnd() * 10, 1.5 + rnd() * 4.5, ZE - 4 - rnd() * 7), rnd() * 6.28, 4 + Math.floor(rnd() * 3), 0.7 + rnd() * 0.7, { lean: 0, lo: true });
  // lianas
  for (let i = 0; i < 7; i++) {
    const x = -3.2 + rnd() * 6.4;
    const z = ZE - 1.5 - rnd() * 6;
    g.trunk([[x, 6.5, z], [x + (rnd() - 0.5) * 0.5, 4, z + (rnd() - 0.5) * 0.4], [x + (rnd() - 0.5) * 0.9, 2.2 + rnd(), z + (rnd() - 0.5) * 0.5], [x + (rnd() - 0.5) * 1.2, 3.5 + rnd() * 2, z + 0.6]], 0.016, 0.012, 5, 1);
  }

  // --- fallen leaves lying on the roof glass
  const rl = Math.hypot(RIDGE - EAVE, HW);
  for (let i = 0; i < 46; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const k = rnd();
    const x = side * HW * (1 - k);
    const y = EAVE + (RIDGE - EAVE) * k;
    const nrm = new THREE.Vector3((side * (RIDGE - EAVE)) / rl, HW / rl, 0);
    const pos = V(x, y, ZB - rnd() * (ZB - ZE)).addScaledVector(nrm, -0.01);
    const a = rnd() * 6.28;
    const tan = new THREE.Vector3(0, 0, 1).applyAxisAngle(nrm, a);
    const t = rnd() < 0.55 ? 'heart' : 'paddle';
    g.leaf(t, pos, tan, nrm.clone().multiplyScalar(rnd() < 0.5 ? 1 : -1), t === 'heart' ? 0.09 + rnd() * 0.1 : 0.2 + rnd() * 0.25, { pin: 1, sen: 0.5 + rnd() * 0.5, ao: 1 });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The place. Everything below draws on the garden's second random stream (g.rnd2), so the composed borders above are
// exactly what they were before any of this was added.

/** Big trees: [x, z, height, radius]. On the sunlit side each one lays a soft vertical bar of shadow on the wall. */
const TREES = [
  // sunlit side
  [-2.6, 0.5, 8.4, 0.15], [-3.4, -1.8, 9.2, 0.19], [-2.35, -3.9, 7.8, 0.12], [-4.6, -5.2, 9.0, 0.22], [-2.9, -8.6, 8.2, 0.14],
  [-3.6, -11.6, 9.4, 0.18], [-2.5, -11.2, 7.6, 0.1], [-5.5, -14.5, 9.0, 0.2], [-3.1, -13.6, 8.0, 0.13], [-6.0, -8.0, 9.5, 0.24], [-5.8, -2.5, 9.0, 0.2],
  // shade side
  [2.7, -0.5, 8.0, 0.16], [3.6, -3.2, 9.0, 0.2], [2.45, -5.6, 7.6, 0.11], [4.4, -7.5, 9.2, 0.23], [2.9, -9.8, 8.2, 0.14], [3.9, -12.2, 9.0, 0.19], [5.5, -5.0, 9.4, 0.22], [5.8, -10.5, 9.0, 0.2],
  // beyond the end pane
  [-2.5, ZE - 2.7, 8.6, 0.17], [3.7, ZE - 3.3, 9.0, 0.2], [-3.7, ZE - 6.6, 9.4, 0.24], [-0.7, ZE - 9.8, 9.0, 0.19], [4.2, ZE - 8.4, 9.2, 0.22],
  [1.4, ZE - 12.0, 9.5, 0.25], [-5.2, ZE - 10.0, 9.0, 0.2], [5.6, ZE - 12.0, 9.0, 0.2], [-2.2, ZE - 14.0, 9.5, 0.24],
];

function plantPlace(g) {
  const r = g.rnd2;
  const up = new THREE.Vector3(0, 1, 0);
  const d = new THREE.Vector3();

  // ---- trees: a leaning bole with a flared foot, buttress roots, a crown far overhead, roots let down from it
  const tops = [];
  for (const [x, z, h, rad] of TREES) {
    const lx = (r() - 0.5) * 1.0;
    const lz = (r() - 0.5) * 1.0;
    const pts = [[x, -0.25, z], [x + lx * 0.2 + (r() - 0.5) * 0.12, h * 0.3, z + lz * 0.2 + (r() - 0.5) * 0.12], [x + lx * 0.6, h * 0.65, z + lz * 0.6], [x + lx, h, z + lz]];
    // (the low sun reaches the composed leaves through gaps: no bole may stand in one)
    let blocked = false;
    for (let k = 0; k <= 16 && !blocked; k++) {
      const t = k / 16;
      const i = Math.min(2, Math.floor(t * 3));
      const f = t * 3 - i;
      d.set(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f, pts[i][2] + (pts[i + 1][2] - pts[i][2]) * f);
      blocked = g.inClearing(d) || g.inQuiet(d);
    }
    if (blocked) continue;
    g.trunk(pts, rad, rad * 0.62, 10, 0, rad * 0.9);
    tops.push([x + lx, h, z + lz, rad]);
    const nb = 3 + Math.floor(r() * 3);
    const a0 = r() * 6.28;
    for (let k = 0; k < nb; k++) {
      const a = a0 + (k / nb) * 6.28 + (r() - 0.5) * 0.6;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const reach = 0.5 + r() * 0.7;
      g.trunk([[x + ca * rad * 0.5, 0.5 + r() * 0.35, z + sa * rad * 0.5], [x + ca * (rad + reach * 0.4), 0.16, z + sa * (rad + reach * 0.4)], [x + ca * (rad + reach), -0.08, z + sa * (rad + reach)]], rad * 0.5, rad * 0.14, 5, 0);
    }
    // crown: fronds or big leaves, high enough that their shade passes over the roof
    const top = V(x + lx, h, z + lz);
    const palmy = r() < 0.5;
    const nl = palmy ? 9 : 12;
    const b0 = r() * 6.28;
    for (let k = 0; k < nl; k++) {
      dirOf(b0 + (k / nl) * 6.28 + (r() - 0.5) * 0.5, palmy ? -0.25 + r() * 0.9 : -0.5 + r() * 1.2, d);
      if (palmy) g.leaf('palmLo', top, d, up, 2.3 + r() * 0.9, { roll: (r() - 0.5) * 0.4 });
      else g.leaf('monsteraLo', top.clone().addScaledVector(d, 0.5 + r() * 0.8), d, V(-d.x * 0.5, 1, -d.z * 0.5), 1.0 + r() * 0.7, { roll: (r() - 0.5) * 0.8 });
    }
    // aerial roots
    const nr = 2 + Math.floor(r() * 5);
    for (let k = 0; k < nr; k++) {
      const a = r() * 6.28;
      const rr = 0.25 + r() * 1.1;
      const rx = top.x + Math.cos(a) * rr;
      const rz = top.z + Math.sin(a) * rr;
      const y0 = h - 0.4 - r() * 1.2;
      const y1 = r() < 0.45 ? -0.05 : 0.5 + r() * 2.4;
      const sw = (r() - 0.5) * 0.25;
      g.trunk([[rx, y0, rz], [rx + sw, y0 + (y1 - y0) * 0.45, rz + sw * 0.6], [rx + sw * 0.6, y1 + (y0 - y1) * 0.12, rz - sw * 0.5], [rx + sw * 0.7, y1, rz - sw * 0.4]], 0.011 - r() * 0.004, 0.005, 4, 1);
    }
    // something always grows on a trunk
    if (r() < 0.75) {
      const a = r() * 6.28;
      g.fern(V(x + lx * 0.15 + Math.cos(a) * rad, 1.1 + r() * 2.4, z + lz * 0.15 + Math.sin(a) * rad), 5 + Math.floor(r() * 4), 0.45 + r() * 0.3, { lo: true, el: 0.5 });
    }
  }
  // lianas slung from crown to crown
  for (let k = 0; k < tops.length - 1; k++) {
    const a = tops[k];
    const b = tops[(k + 1 + Math.floor(r() * 2)) % tops.length];
    const dist = Math.hypot(a[0] - b[0], a[2] - b[2]);
    if (dist > 4.6 || dist < 1) continue;
    const sag = 1.5 + r() * 2.5;
    const mid = [(a[0] + b[0]) / 2 + (r() - 0.5) * 0.4, Math.min(a[1], b[1]) - 1.2 - sag, (a[2] + b[2]) / 2 + (r() - 0.5) * 0.4];
    g.trunk([[a[0], a[1] - 1.2, a[2]], [(a[0] * 3 + b[0]) / 4, mid[1] + sag * 0.35, (a[2] * 3 + b[2]) / 4], mid, [(a[0] + b[0] * 3) / 4, mid[1] + sag * 0.3, (a[2] + b[2] * 3) / 4], [b[0], b[1] - 1.5, b[2]]], 0.014, 0.012, 5, 1);
  }

  // ---- the middle distance: looser, bigger, so that the ground is never bare between the border and the trees
  for (const side of [-1, 1]) {
    for (let z = ZB + 1; z > ZE - 1; z -= 1.25) {
      for (let k = 0; k < 2; k++) {
        const c = V(side * (HW + 3.0 + r() * 5.2), r() * 0.3, z + (r() - 0.5) * 1.2);
        const t = r();
        if (t < 0.35) g.fern(c.setY(0.2 + r() * 0.9), 7 + Math.floor(r() * 4), 0.9 + r() * 0.6, { lo: true });
        else if (t < 0.65) g.monstera(c, r() * 6.28, 5 + Math.floor(r() * 3), 0.6 + r() * 0.4, { lean: 0, lo: true });
        else if (t < 0.85) g.palm(c, 0.4 + r() * 1.6, 6, 1.2 + r() * 0.7, 0.3, true);
        else g.grass(c, 10, 0.7 + r() * 0.6);
      }
    }
  }

  // ---- stones: the rim of the pool, the edges of the path, a few at the foot of the glass
  for (let k = 0; k < 17; k++) {
    const a = (k / 17) * 6.28 + r() * 0.25;
    const m = 1.02 + r() * 0.16;
    g.rock(POOL.x + Math.cos(a) * POOL.rx * m, -0.02, POOL.z + Math.sin(a) * POOL.rz * m, 0.1 + r() * r() * 0.3, r);
  }
  for (let k = 0; k < 14; k++) {
    const z = ZE - 0.8 - r() * 10;
    g.rock(pathX(z) + (r() < 0.5 ? -1 : 1) * (0.55 + r() * 0.35), -0.02, z, 0.07 + r() * 0.16, r);
  }
  for (const side of [-1, 1]) for (let k = 0; k < 9; k++) g.rock(side * (HW + 0.32 + r() * 0.5), -0.03, ZB - 0.5 - r() * (ZB - ZE - 1), 0.1 + r() * 0.17, r);
  for (let k = 0; k < 5; k++) g.rock(-HW + 0.2 + r() * (HW * 2 - 0.4), -0.03, ZE - 0.3 - r() * 0.5, 0.09 + r() * 0.13, r);

  // ---- around the pool and along the path: reeds at the water, ferns under the trees
  for (let k = 0; k < 13; k++) {
    const a = r() * 6.28;
    const m = 1.12 + r() * 0.3;
    g.grass(V(POOL.x + Math.cos(a) * POOL.rx * m, 0, POOL.z + Math.sin(a) * POOL.rz * m), 10 + Math.floor(r() * 8), 0.7 + r() * 0.7);
  }
  for (let k = 0; k < 14; k++) {
    const z = ZE - 1.5 - r() * 11;
    const x = pathX(z) + (r() < 0.5 ? -1 : 1) * (0.8 + r() * 1.6);
    if (r() < 0.6) g.fern(V(x, r() * 0.25, z), 7 + Math.floor(r() * 4), 0.6 + r() * 0.5, { lo: z < ZE - 4 });
    else g.paddle(V(x, 0, z), 5 + Math.floor(r() * 4), 0.6 + r() * 0.5);
  }

}

function plantFlowers(g) {
  const r = g.rnd2;
  const d = new THREE.Vector3();
  // ---- flowers. Few, and placed: they are the only strong colour out here.
  const spray = (base, toward, n, len, size) => {
    // an arching stem that carries its flowers on the last two thirds, faces turned to the glass
    const tip = base.clone().addScaledVector(toward, len * 0.55).add(V((r() - 0.5) * len * 0.5, len * 0.45, (r() - 0.5) * len * 0.5));
    const mid = base.clone().lerp(tip, 0.5).add(V(0, len * 0.3, 0));
    g.trunk([base.toArray(), mid.toArray(), tip.toArray()], 0.0035, 0.002, 4, 3);
    const p = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const t = 0.35 + (0.65 * (k + 0.5)) / n;
      // quadratic through base, mid, tip
      p.copy(base).multiplyScalar((1 - t) * (1 - t)).addScaledVector(mid, 2 * t * (1 - t) * 1.0).addScaledVector(tip, t * t);
      p.addScaledVector(toward, 0.012).add(V((r() - 0.5) * 0.03, (r() - 0.5) * 0.02 - 0.02, (r() - 0.5) * 0.03));
      d.set((r() - 0.5) * 0.5, 1, (r() - 0.5) * 0.5).normalize();
      g.flower('orchid', p.clone(), d, toward.clone().add(V((r() - 0.5) * 0.5, -0.15, (r() - 0.5) * 0.5)), size * (0.8 + r() * 0.35), { roll: (r() - 0.5) * 0.5 });
    }
  };
  const L = V(1, 0, 0);
  const R = V(-1, 0, 0);
  const E = V(0, 0, 1);
  spray(V(-HW - 0.34, 1.05, ZB - 4.42), L, 5, 0.55, 0.085);
  spray(V(-HW - 0.2, 0.95, ZB - 7.28), L, 4, 0.5, 0.08);
  spray(V(-HW - 0.16, 1.35, ZB - 9.66), L, 5, 0.42, 0.075);
  spray(V(-HW - 0.3, 0.8, ZB - 12.7), L, 6, 0.7, 0.09);
  spray(V(HW + 0.22, 1.25, ZB - 11.05), R, 5, 0.5, 0.08);
  spray(V(HW + 0.3, 0.9, ZB - 3.3), R, 4, 0.55, 0.085);
  spray(V(-0.62, 1.0, ZE - 0.42), E, 6, 0.6, 0.09);
  spray(V(0.92, 1.55, ZE - 0.6), E, 4, 0.45, 0.08);
  // heliconias hanging in the paddle clumps
  for (const [x, y, z, s, face] of [[-HW - 0.75, 1.75, -4.6, 0.55, L], [-HW - 0.5, 1.55, -10.35, 0.5, L], [HW + 0.6, 1.65, -8.2, 0.5, R], [-1.15, 1.9, ZE - 1.35, 0.6, E], [2.2, 2.0, ZE - 2.7, 0.65, E], [-2.9, 1.7, ZE - 4.2, 0.6, E]]) {
    const top = V(x, y, z);
    g.paddle(V(x - face.x * 0.25, 0, z - face.z * 0.25), 6, 0.85 + r() * 0.3);
    g.flower('heliconia', top, V((r() - 0.5) * 0.12, 1, (r() - 0.5) * 0.12).normalize(), face, s, { roll: r() * 0.6 });
  }
  // a drift of white blooms low on the shrubs by the path, for the last shot
  for (let k = 0; k < 26; k++) {
    const z = ZE - 0.7 - r() * 3.2;
    const p = V(pathX(z) + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.9), 0.25 + r() * 0.8, z);
    d.set(r() - 0.5, r() - 0.2, r() - 0.5).normalize();
    g.flower('bloom', p, d, V((r() - 0.5) * 0.6, 0.5, 1), 0.024 + r() * 0.014);
  }
}

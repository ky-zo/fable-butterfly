// Typesets one toroidal tile of sea: bands of lines at several sizes, each line a run of unrelated fragments.
// The tile wraps around the viewer, so this is all the text there ever is; the density field in the shader
// decides which parts of which copy are actually afloat.

import { CELL_EM } from './atlas.js';

// em size (m), area share, rows per band [min, max], phrase gap in em [min, max]
const CLASSES = [
  { em: 0.056, share: 0.12, rows: [3, 6], gap: [1.6, 4.5] }, // footnotes
  { em: 0.082, share: 0.27, rows: [2, 5], gap: [1.5, 4.0] },
  { em: 0.118, share: 0.34, rows: [2, 4], gap: [1.4, 3.6] }, // body
  { em: 0.185, share: 0.18, rows: [1, 2], gap: [1.2, 3.0] },
  { em: 0.34, share: 0.09, rows: [1, 1], gap: [1.0, 2.5] }, // headlines
];
/** half the width of the lane of small print under the butterfly's line of flight (it flies along x = 0), m */
export const LANE = 0.5;
export const LEADING = 2.0; // line pitch in em: generous, so a letter can lean up without covering the line behind

/**
 * @returns {{ count:number, a:Float32Array, b:Float32Array, c:Float32Array, phrases:number }}
 *   a = base x, base z, rotation, em      b = atlas index, glyph rand, phrase rand, face id      c = phrase centre − glyph base
 */
export async function layoutTile(lines, atlas, tile, rnd, { dropSmallest = false, pause = null } = {}) {
  // (cut into slices of a few milliseconds: this runs while another world is on screen)
  let since = performance.now();
  const breathe = async () => {
    if (pause && performance.now() - since > 5) {
      await pause();
      since = performance.now();
    }
  };
  const classes = dropSmallest ? CLASSES.slice(1) : CLASSES;
  const shareSum = classes.reduce((s, c) => s + c.share, 0);

  // pre-measure every line once
  const measured = [];
  for (const l of lines) {
    await breathe();
    measured.push(one(l));
  }
  function one(l) {
    const m = atlas.measure(l.face, l.text);
    const gi = new Int32Array(m.chars.length);
    const ga = new Float32Array(m.chars.length);
    for (let k = 0; k < m.chars.length; k++) {
      const g = atlas.lookup(l.face, m.chars[k]);
      gi[k] = g ? g.index : -1;
      ga[k] = g ? g.adv : 0;
    }
    return { ...l, m, gi, ga, at: [] };
  }
  const faceId = { r: 0, i: 1, m: 2, s: 3, x: 4 };

  // shuffle bag, so every line is used before any is used again; and of the next few in the bag the one whose
  // earlier copies lie furthest from this spot (on the torus) is taken, so the eye rarely meets the same line twice
  let bag = [];
  const refill = () => {
    const fresh = measured.slice();
    for (let k = fresh.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1));
      [fresh[k], fresh[j]] = [fresh[j], fresh[k]];
    }
    bag = fresh.concat(bag);
  };
  const FAR2 = 8.5 * 8.5;
  const torus = (d) => {
    d = Math.abs(d) % tile;
    return d > tile / 2 ? tile - d : d;
  };
  const draw = (x, z) => {
    if (bag.length < 12) refill();
    let pick = bag.length - 1;
    let best = -1;
    for (let tries = 0; tries < 12; tries++) {
      const k = bag.length - 1 - tries;
      const at = bag[k].at;
      let d = 1e9;
      for (let q = 0; q < at.length; q += 2) {
        const dx = torus(at[q] - x);
        const dz = torus(at[q + 1] - z);
        d = Math.min(d, dx * dx + dz * dz);
      }
      if (d > best) {
        best = d;
        pick = k;
      }
      if (d > FAR2) break;
    }
    return bag.splice(pick, 1)[0];
  };

  let cap = 1 << 17;
  let a = new Float32Array(cap * 4);
  let b = new Float32Array(cap * 4);
  let c = new Float32Array(cap * 2);
  let n = 0;
  let phrases = 0;
  const grow = () => {
    cap *= 2;
    const a2 = new Float32Array(cap * 4);
    a2.set(a);
    a = a2;
    const b2 = new Float32Array(cap * 4);
    b2.set(b);
    b = b2;
    const c2 = new Float32Array(cap * 2);
    c2.set(c);
    c = c2;
  };
  const wrap = (v) => v - Math.floor(v / tile) * tile;

  // a slow, tile-periodic current that bends the ruled lines into flow lines
  const K = (Math.PI * 2) / tile;
  const wp = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const sc = tile / 32;
  const warp = (x, z, out) => {
    const a1 = K * 2 * z + wp[0];
    const a2 = K * 3 * (x + z) + wp[1];
    const b1 = K * 2 * x + wp[2];
    const b2 = K * 3 * (x - z) + wp[3];
    const b3 = K * 5 * x + K * 1 * z + wp[4];
    out.x = x + sc * (0.3 * Math.sin(a1) + 0.1 * Math.sin(a2));
    out.z = z + sc * (0.42 * Math.sin(b1) + 0.16 * Math.sin(b2) + 0.06 * Math.sin(b3));
    out.rot = Math.atan(sc * (0.42 * K * 2 * Math.cos(b1) + 0.16 * K * 3 * Math.cos(b2) + 0.06 * K * 5 * Math.cos(b3)));
    return out;
  };
  const wo = { x: 0, z: 0, rot: 0 };

  let z = 0;
  let lastClass = -1;
  while (z < tile - 0.02) {
    // pick a size class by area share, never the same twice in a row
    let ci = 0;
    for (let tries = 0; tries < 6; tries++) {
      let u = rnd() * shareSum;
      ci = 0;
      while (ci < classes.length - 1 && u > classes[ci].share) {
        u -= classes[ci].share;
        ci++;
      }
      if (ci !== lastClass) break;
    }
    lastClass = ci;
    const cls = classes[ci];
    const em = cls.em * (0.9 + rnd() * 0.22);
    const pitch = em * LEADING;
    let rows = cls.rows[0] + Math.floor(rnd() * (cls.rows[1] - cls.rows[0] + 1));
    const remaining = tile - z;
    rows = Math.max(1, Math.min(rows, Math.floor((remaining - em * 0.2) / pitch)));
    if (remaining < pitch * 1.05) break;
    const cellW = em * CELL_EM;
    // slow undulation of the baselines of this band (periodic over the tile)
    const waveM = 1 + Math.floor(rnd() * 3);
    const wavePh = rnd() * Math.PI * 2;
    const waveA = em * (0.1 + rnd() * 0.3);

    for (let r = 0; r < rows; r++) {
      await breathe();
      const baseZ = z + (r + 0.82) * pitch;
      let x = rnd() * tile;
      const end = x + tile;
      // a ragged line: fragments one after another until the line would bite its own tail
      for (;;) {
        const L = draw(x, baseZ);
        const w = L.m.w * em;
        const gap = em * (cls.gap[0] + rnd() * (cls.gap[1] - cls.gap[0]));
        if (x + w > end - em * 1.2) break;
        // nothing large is set across the lane: that column of sea is kept for the small print
        if (Math.floor((x + w + 0.3 + LANE) / tile) > Math.floor((x - 0.3 - LANE) / tile)) {
          x += w + gap;
          continue;
        }
        if (rnd() < 0.07) {
          x += w * (0.4 + rnd()) + gap; // a pause in the line
          continue;
        }
        const rot = (rnd() - 0.5) * 0.07 + (cls.em > 0.2 ? (rnd() - 0.5) * 0.06 : 0);
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        const cx = x + w * 0.5;
        const dz = waveA * Math.sin((cx / tile) * Math.PI * 2 * waveM + wavePh) + (rnd() - 0.5) * em * 0.18;
        const cz = baseZ + dz;
        L.at.push(cx, cz);
        const pr = rnd();
        const fid = faceId[L.face];
        warp(cx, cz, wo);
        const pcx = wo.x;
        const pcz = wo.z;
        const px = L.m.x;
        const gi = L.gi;
        const ga = L.ga;
        for (let k = 0; k < gi.length; k++) {
          if (gi[k] < 0) continue;
          if (n >= cap) grow();
          // glyph cell centre in line space: pen + half advance along the line, cell centre above the baseline
          const lx = (px[k] + ga[k] * 0.5) * em - w * 0.5;
          const ly = (0.69 - 0.5) * cellW; // baseline sits 0.19 cell below the cell centre → centre is "up" (−z) of it
          // line direction u = (cos, sin) in (x, z); glyph up v = (sin, −cos)
          const fx = cx + lx * cr + ly * sr;
          const fz = cz + lx * sr - ly * cr;
          warp(fx, fz, wo);
          const gx = wo.x;
          const gz = wo.z;
          const wx = wrap(gx);
          const wz = wrap(gz);
          a[n * 4] = wx;
          a[n * 4 + 1] = wz;
          a[n * 4 + 2] = rot + wo.rot;
          a[n * 4 + 3] = em;
          b[n * 4] = gi[k];
          b[n * 4 + 1] = rnd();
          b[n * 4 + 2] = pr;
          b[n * 4 + 3] = fid + (L.way ? 8 : 0);
          c[n * 2] = pcx - gx;
          c[n * 2 + 1] = pcz - gz;
          n++;
        }
        phrases++;
        x += w + gap;
      }
    }
    z += rows * pitch + em * (0.25 + rnd() * 0.9);
  }

  // ---- the lane: what the ones before left for the one crossing now, in small print, one line under another along
  // the line of flight. Not warped, not gathered into windrows: it is always there, under the animal.
  const notes = measured.filter((l) => l.way);
  if (notes.length) {
    let order = [];
    let zl = 0.05;
    while (zl < tile - 0.12) {
      if (!order.length) {
        order = notes.slice();
        for (let k = order.length - 1; k > 0; k--) {
          const j = Math.floor(rnd() * (k + 1));
          [order[k], order[j]] = [order[j], order[k]];
        }
      }
      if ((phrases & 31) === 0) await breathe();
      const L = order.pop();
      let em = 0.026 + rnd() * 0.011;
      let w = L.m.w * em;
      const room = LANE * 2 - 0.08;
      if (w > room) {
        em *= room / w;
        w = room;
      }
      const cellW = em * CELL_EM;
      const cx = (rnd() - 0.5) * (room - w);
      const cz = zl + em;
      const rot = (rnd() - 0.5) * 0.045;
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const pr = rnd() * 0.5;
      const fid = faceId[L.face];
      for (let k = 0; k < L.gi.length; k++) {
        if (L.gi[k] < 0) continue;
        if (n >= cap) grow();
        const lx = (L.m.x[k] + L.ga[k] * 0.5) * em - w * 0.5;
        const ly = (0.69 - 0.5) * cellW;
        const gx = cx + lx * cr + ly * sr;
        const gz = cz + lx * sr - ly * cr;
        a[n * 4] = wrap(gx);
        a[n * 4 + 1] = wrap(gz);
        a[n * 4 + 2] = rot;
        a[n * 4 + 3] = em;
        b[n * 4] = L.gi[k];
        b[n * 4 + 1] = rnd();
        b[n * 4 + 2] = pr;
        b[n * 4 + 3] = fid + 24;
        c[n * 2] = cx - gx;
        c[n * 2 + 1] = cz - gz;
        n++;
      }
      phrases++;
      zl += em * (2.3 + rnd() * 1.5) + (rnd() < 0.16 ? em * 4 : 0);
    }
  }

  return { count: n, a: a.subarray(0, n * 4), b: b.subarray(0, n * 4), c: c.subarray(0, n * 2), phrases };
}

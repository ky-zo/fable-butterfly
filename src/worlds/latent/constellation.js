// The glasswing as a constellation: the kit's own sampling of the animal (veins, border, clear membrane, body), and
// on top of it the markings that make it this butterfly and not a drawing of any butterfly —
//
//   the border laid open   every point of the band of scales knows where across it it lies: the dark rim, the ember
//                          (amber at its core, crimson on its shoulders), the velvet inside that
//   the white bar          the lozenge near the tip of each forewing: the densest, brightest cluster in the animal
//   the dark band          over the end of the cell, in front of the bar
//   the dots of the margin a row of very small white stars in the rim of the outer margins, a millimetre and a half apart
//   the spots of the body  the white dots of an ithomiine, each a small star on a dark body
//   the clubs              a knot of points at the end of each antenna
//
// All of it from the kit's data (borderAt, BAR, SPOTS, antennaPath …), so it is the same animal as in every other world.
// Adds two attributes to the kit's: aCell (which clear cell a membrane point is in) and
//   aTone  vec4   x ember 0…1 · y its heat (0 amber core … 1 crimson) · z white (1 the bar, less for dots and spots)
//                 w veins: 0 at the margin … 1 clear of the border · border: 0 the margin … 1 its inner contour

import * as THREE from 'three';
import { samplePoints, wingOutline, veinSegments, borderAt, pigmentAt, distToPoly, BAR, BOUNDS, SPOTS, PART, CLUB, antennaPath, antennaRad } from '../../shared/butterfly/index.js';

const S = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Across the border (the kit's bfPigmentBand, on the CPU): x mm inside the margin → [ember, heat]. */
function emberAt(hind, px, py, x) {
  const [bw, rust] = borderAt(hind, px, py);
  const rim = Math.min(0.4, 0.32 * bw);
  const ew = (bw - rim) * 0.6 * rust;
  const et = (x - rim) / Math.max(ew, 0.001);
  let ember = S(-0.12, 0.2, et) * (1 - S(0.5, 1.1, et));
  // (a band thinner than a point is across is less of it, not a line of it; and none at the root of the wing)
  ember *= Math.min(1, ew / 0.22) * S(1.2, 4.0, Math.hypot(px, py));
  const heat = Math.min(1, S(0.3, 1.0, et) + 0.55 * S(0.3, 0.0, et));
  return [ember, heat, bw];
}

/**
 * @param count  points in all        @param cells  [fore, hind] from wingCells()
 * @returns Promise<THREE.BufferGeometry>  the kit's point attributes + aCell + aTone
 */
export async function buildConstellation(ctx, count, cells, pause) {
  const rnd = ctx.rng(11);
  const k = count / 24000;
  const nBar = Math.round(520 * k); // per forewing
  const nBand = Math.round(120 * k);
  const perDot = k > 0.8 ? 3 : k > 0.5 ? 2 : 1;
  const perSpot = Math.max(3, Math.round(9 * k));
  const nClub = Math.round(110 * k); // per antenna
  const fine = [wingOutline(0, 256), wingOutline(1, 256)];
  const coarse = [wingOutline(0, 96), wingOutline(1, 96)];
  const segs = [veinSegments(0), veinSegments(1)];

  // ---- where the dots of the margin are (the kit's rule: every 1.5 mm of its own measure along the outer margins)
  const dots = [];
  for (const hind of [0, 1]) {
    const o = fine[hind];
    const sOf = (p) => (hind ? Math.atan2(p[1] + 1.4, p[0] - 8.2) * 11.6 : p[0] * 1.13) / 1.5;
    for (let i = 0; i < o.length; i++) {
      const a = o[i];
      const b = o[(i + 1) % o.length];
      const sa = sOf(a);
      const sb = sOf(b);
      if (Math.abs(sb - sa) > 0.5) continue; // (the angle wraps once on the way round)
      const n = Math.floor(Math.max(sa, sb) - 0.5) + 0.5;
      if (n < Math.min(sa, sb)) continue;
      const f = (n - sa) / (sb - sa || 1);
      const x = a[0] + (b[0] - a[0]) * f;
      const y = a[1] + (b[1] - a[1]) * f;
      if (borderAt(hind, x, y)[0] < 1.05 || (!hind && y > -1.2)) continue;
      const tx = b[0] - a[0];
      const ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      dots.push([hind, x + (ty / tl) * 0.24, y - (tx / tl) * 0.24]);
    }
  }
  const spots = [];
  for (const s of SPOTS) for (const sx of s[0] === 0 ? [1] : [1, -1]) spots.push([s[0] * sx, s[1], s[2], s[3]]);

  const extra = 2 * nBar + 2 * nBand + 2 * dots.length * perDot + spots.length * perSpot + 2 * nClub;
  const base = await samplePoints(count - extra, { rnd, share: { veins: 0.31, border: 0.32, membrane: 0.26, body: 0.11 }, cells, pause });
  const nb = base.attributes.position.count;
  const N = nb + extra;
  const names = [['position', 3], ['aWing', 2], ['aUv', 2], ['aKind', 4], ['aAlt', 3], ['aPart', 4], ['aRand', 1], ['aCell', 1]];
  const A = {};
  for (const [name, size] of names) {
    A[name] = new Float32Array(N * size);
    A[name].set(base.attributes[name].array);
  }
  const tone = (A.aTone = new Float32Array(N * 4));
  base.dispose();

  // ---- the kit's points: where across the border each lies
  const P = A.position, W = A.aWing, K = A.aKind;
  for (let i = 0; i < nb; i++) {
    const side = W[i * 2];
    if (side !== 0 && K[i * 4 + 2] < 0.5) {
      const hind = W[i * 2 + 1];
      const x = P[i * 3], y = P[i * 3 + 1];
      const d = distToPoly(x, y, fine[hind]);
      const [ember, heat, bw] = emberAt(hind, x, y, d);
      if (K[i * 4 + 1] > 0.5) {
        tone[i * 4] = ember;
        tone[i * 4 + 1] = heat;
        tone[i * 4 + 3] = Math.min(1, d / bw);
      } else tone[i * 4 + 3] = S(0.25 * bw, 1.1 * bw, d); // a vein goes dark where it runs under the scales
    }
    if (pause && i % 3000 === 2999) await pause();
  }

  // ---- what is added
  let n = nb;
  const wingPt = (x, y, side, hind, t0, t1, t2, t3) => {
    const b = BOUNDS[hind];
    P.set([x, y, 0], n * 3);
    A.aAlt.set([x, y, 0], n * 3);
    W.set([side, hind], n * 2);
    A.aUv.set([(x - b[0]) / (b[2] - b[0]), (y - b[1]) / (b[3] - b[1])], n * 2);
    K.set([0, 1, 0, 0], n * 4);
    A.aPart.set([-1, 0, 0, -1], n * 4);
    A.aRand[n] = rnd();
    A.aCell[n] = -1;
    tone.set([t0, t1, t2, t3], n * 4);
    n++;
  };
  const bodyPt = (p, part, t, leg, white) => {
    P.set(p, n * 3);
    A.aAlt.set(p, n * 3);
    W.set([0, 0], n * 2);
    A.aUv.set([t, 0], n * 2);
    K.set([0, 0, 0, 1], n * 4);
    A.aPart.set([part, t, 0, leg], n * 4);
    A.aRand[n] = rnd();
    A.aCell[n] = -1;
    tone.set([0, 0, white, 0], n * 4);
    n++;
  };
  const pg = {};
  for (const side of [1, -1]) {
    // the white bar: wherever the kit says white, and denser toward its middle line
    for (let i = 0; i < nBar; i++) {
      let x = 0, y = 0;
      for (let tries = 0; tries < 40; tries++) {
        const f = rnd();
        const w = (rnd() - 0.5) * 2 * (BAR.w + 0.1);
        const ex = BAR.b[0] - BAR.a[0], ey = BAR.b[1] - BAR.a[1];
        const el = Math.hypot(ex, ey);
        x = BAR.a[0] + ex * f + (ey / el) * w;
        y = BAR.a[1] + ey * f - (ex / el) * w;
        if (pigmentAt(0, x, y, coarse[0], segs[0], pg).white > 0.5) break;
      }
      wingPt(x, y, side, 0, 0, 0, 1, 1);
    }
    if (pause) await pause();
    // the dark band over the end of the cell
    for (let i = 0; i < nBand; i++) {
      const [d0, d1, d2] = BAR.dc;
      const f = rnd() * 2;
      const a = f < 1 ? d0 : d1, b = f < 1 ? d1 : d2;
      const g = f % 1;
      const w = (rnd() - 0.5) * 2 * BAR.dcw * 0.8;
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const el = Math.hypot(ex, ey);
      wingPt(a[0] + ex * g + (ey / el) * w, a[1] + ey * g - (ex / el) * w, side, 0, 0, 0, 0, 0.6);
    }
    for (const [hind, x, y] of dots) {
      for (let j = 0; j < perDot; j++) {
        const r = j === 0 ? 0 : 0.07;
        wingPt(x + (rnd() - 0.5) * 2 * r, y + (rnd() - 0.5) * 2 * r, side, hind, 0, 0, j === 0 ? 0.62 : 0.3, 0.2);
      }
    }
    // the club of the antenna
    const path = antennaPath(side);
    for (let i = 0; i < nClub; i++) {
      const t = CLUB + (1 - CLUB) * Math.pow(rnd(), 0.8);
      const c = path(t);
      const a = rnd() * Math.PI * 2;
      const rr = antennaRad(t) * Math.sqrt(rnd());
      bodyPt([c[0] + Math.cos(a) * rr, c[1], c[2] + Math.sin(a) * rr], PART.ANTENNA, t, side > 0 ? 10 : 11, 0);
    }
  }
  for (const s of spots) {
    for (let j = 0; j < perSpot; j++) {
      const r = j === 0 ? 0 : s[3] * Math.sqrt(rnd());
      const a = rnd() * Math.PI * 2;
      // (a spot lies on the skin: spread along the body and round it, lifted a hair so that it is not inside)
      bodyPt([s[0] + Math.cos(a) * r * (s[0] === 0 ? 1 : 0.5), s[1] + Math.sin(a) * r, s[2] + (s[0] === 0 ? 0.03 : Math.cos(a) * r * 0.5)], PART.THORAX, 0.5, -1, j === 0 ? 1 : 0.55);
    }
  }

  const g = new THREE.BufferGeometry();
  for (const [name, size] of names) g.setAttribute(name, new THREE.BufferAttribute(A[name], size));
  g.setAttribute('aTone', new THREE.BufferAttribute(tone, 4));
  g.setDrawRange(0, n);
  return g;
}

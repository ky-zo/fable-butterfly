// "the glass" — a flat sheet it cannot pass, remembered whole.
//
//   ramp 0  the sheet itself: a regular lattice of points (it has no picture of glass, only where it stops), thinned
//           where the fog was thin, cleared in the tracks where drops ran down
//   ramp 1  beads of water standing on it, and the bead at the foot of every track
//   ramp 2  steel: the frame, two mullions and a transom
//   ramp 3  what is on the other side and cannot be got to: green and gold, never in focus
//
// Local frame: the sheet is the xy plane, the animal's side is +z. It condenses outward from where it lands (`touch`).

import { TAU, clamp, smooth, noise1 } from './cloud.js';

const n2 = (x, y, s) => 0.5 + 0.25 * (noise1(x + 31.7 * Math.floor(y), s) * (1 - (y - Math.floor(y))) + noise1(x + 31.7 * (Math.floor(y) + 1), s) * (y - Math.floor(y))) + 0.25 * noise1(y * 1.3 + 3.1, s + 9);

export function* pane(cloud, rnd, W = 38, H = 24, touch = [-1.4, 0.4]) {
  const n = cloud.n;
  const hw = W / 2, hh = H / 2;
  const far = Math.hypot(hw + Math.abs(touch[0]), hh + Math.abs(touch[1]));
  const ord = (x, y) => clamp(0.02 + 0.9 * (Math.hypot(x - touch[0], y - touch[1]) / far));
  const MULL = [-W / 6, W / 6];
  const TRANSOM = H * 0.2;
  let tick = 0;

  // tracks where a drop ran down: [x, top, bottom, half width]
  const runs = [];
  for (let k = 0; k < 46; k++) {
    const x = (rnd() * 2 - 1) * hw * 0.97;
    const top = (rnd() * 2 - 1) * hh * 0.9;
    const len = 1.5 + 9 * rnd() * rnd();
    runs.push([x, top, Math.max(-hh * 0.98, top - len), 0.05 + 0.09 * rnd(), rnd() * 10]);
  }
  const runX = (r, y) => r[0] + 0.1 * Math.sin((r[1] - y) * 1.7 + r[4]) + 0.05 * Math.sin((r[1] - y) * 4.3 + r[4] * 2);
  const inRun = (x, y) => {
    for (const r of runs) if (y < r[1] && y > r[2] && Math.abs(x - runX(r, y)) < r[3]) return true;
    return false;
  };
  // fog: thick in the lower half and the corners, thin where a hand or a leaf once wiped it
  const fog = (x, y) => clamp(0.2 + 0.95 * n2(x * 0.14 + 3, y * 0.14, 4) * (0.75 + 0.35 * n2(x * 0.5, y * 0.5 + 7, 5)) + 0.2 * smooth(0, -hh, y) - 0.1);

  // ---- the lattice. Sites are visited in a scrambled order, so that running out of points thins it evenly.
  const nLat = Math.floor(n * 0.5);
  const pitch = Math.sqrt((W * H * 0.62) / (nLat * 0.866));
  const cols = Math.floor(W / pitch), rows = Math.floor(H / (pitch * 0.866));
  const sites = cols * rows;
  const stride = 7919 * 104729;
  let made = 0;
  for (let s = 0, k = 17; s < sites && made < nLat; s++) {
    if ((++tick & 1023) === 0) yield;
    k = (k + stride) % sites;
    const ix = k % cols, iy = (k / cols) | 0;
    const x = -hw + (ix + (iy & 1 ? 0.5 : 0) + 0.25) * pitch + rnd.gauss() * pitch * 0.035;
    const y = -hh + (iy + 0.5) * pitch * 0.866 + rnd.gauss() * pitch * 0.035;
    const f = fog(x, y);
    if (rnd() > 0.16 + 0.84 * f) continue;
    if (inRun(x, y)) continue;
    cloud.add(x, y, rnd.gauss() * 0.006, 0.22 + 0.5 * f * (0.6 + 0.8 * rnd()), clamp(0.15 + 0.7 * f + 0.15 * (rnd() - 0.5)), ord(x, y), 0);
    made++;
  }
  // ---- the edges of the tracks (water piled to either side), and the bead at the foot of each
  let m = Math.floor(n * 0.07);
  for (let i = 0; i < m; i++) {
    if ((++tick & 1023) === 0) yield;
    const r = runs[(rnd() * runs.length) | 0];
    if (rnd() < 0.7) {
      const y = r[2] + (r[1] - r[2]) * rnd();
      const side = rnd() < 0.5 ? -1 : 1;
      cloud.add(runX(r, y) + side * r[3], y, 0.01, 0.3 + 0.3 * rnd(), 0.7 + 0.3 * rnd(), ord(r[0], y), 1);
    } else {
      const a = rnd() * TAU;
      const rr = r[3] * 1.7;
      const rim = rnd() < 0.6;
      const q = rim ? 1 : Math.sqrt(rnd()) * 0.5;
      const hl = !rim && rnd() < 0.5;
      cloud.add(runX(r, r[2]) + (hl ? -0.4 * rr : Math.cos(a) * rr * q), r[2] - rr * 0.6 + (hl ? 0.45 * rr : Math.sin(a) * rr * q * 1.25), 0.02, hl ? 1.2 : rim ? 0.3 : 0.15, 0.8, ord(r[0], r[2]), 1);
    }
  }
  // ---- beads standing on the glass: a ring, a spot of light, a crescent of light gathered at the far edge
  const beads = [];
  for (let k = 0; k < 520; k++) {
    const x = (rnd() * 2 - 1) * hw * 0.98, y = (rnd() * 2 - 1) * hh * 0.98;
    beads.push([x, y, 0.035 + 0.2 * Math.pow(rnd(), 3.2)]);
  }
  let wsum = 0;
  for (const b of beads) wsum += (b[3] = b[2] + 0.03);
  m = Math.floor(n * 0.13);
  for (let i = 0; i < m; i++) {
    if ((++tick & 1023) === 0) yield;
    let pick = rnd() * wsum;
    let b = beads[0];
    for (const q of beads) {
      pick -= q[3];
      if (pick <= 0) {
        b = q;
        break;
      }
    }
    const u = rnd();
    const a = rnd() * TAU;
    if (u < 0.55) cloud.add(b[0] + Math.cos(a) * b[2], b[1] + Math.sin(a) * b[2], 0.02, 0.22 + 0.2 * Math.max(0, Math.sin(a + 0.6)), 0.6 + 0.4 * rnd(), ord(b[0], b[1]), 1);
    else if (u < 0.75) cloud.add(b[0] - 0.36 * b[2] + rnd.gauss() * b[2] * 0.09, b[1] + 0.4 * b[2] + rnd.gauss() * b[2] * 0.09, 0.05, 1.2, 0.95, ord(b[0], b[1]), 1);
    else {
      const t = a * 0.22 - 0.9;
      cloud.add(b[0] + Math.cos(t) * b[2] * 0.72, b[1] + Math.sin(t) * b[2] * 0.72, 0.03, 0.45, 0.5, ord(b[0], b[1]), 1);
    }
  }
  // ---- steel: the frame round the whole sheet, two mullions, a transom. Each bar is two edges and a few rivets.
  const bars = [];
  const BW = 0.34;
  bars.push([-hw, -hh, hw, -hh], [-hw, hh, hw, hh], [-hw, -hh, -hw, hh], [hw, -hh, hw, hh]);
  for (const x of MULL) bars.push([x, -hh, x, hh]);
  bars.push([-hw, TRANSOM, hw, TRANSOM]);
  let lsum = 0;
  for (const b of bars) lsum += (b[4] = Math.hypot(b[2] - b[0], b[3] - b[1]));
  m = Math.floor(n * 0.13);
  for (let i = 0; i < m; i++) {
    if ((++tick & 1023) === 0) yield;
    let pick = rnd() * lsum;
    let b = bars[0];
    for (const q of bars) {
      pick -= q[4];
      if (pick <= 0) {
        b = q;
        break;
      }
    }
    const t = rnd();
    const x = b[0] + (b[2] - b[0]) * t, y = b[1] + (b[3] - b[1]) * t;
    const px = -(b[3] - b[1]) / b[4], py = (b[2] - b[0]) / b[4];
    const u = rnd();
    let off, z, bright;
    if (u < 0.62) {
      off = (rnd() < 0.5 ? -1 : 1) * BW * 0.5;
      z = 0.06;
      bright = 0.9;
    } else if (u < 0.74) {
      // the web of the T, standing off the glass toward the room
      off = 0;
      z = 0.06 + 0.5 * rnd();
      bright = 0.2;
    } else if (u < 0.86) {
      // rivets, a hand apart
      const k = Math.round((t * b[4]) / 1.15);
      const a = rnd() * TAU;
      const cx = b[0] + ((b[2] - b[0]) * (k * 1.15)) / b[4], cy = b[1] + ((b[3] - b[1]) * (k * 1.15)) / b[4];
      cloud.add(cx + Math.cos(a) * 0.05, cy + Math.sin(a) * 0.05, 0.09, 1.3, 0.8, ord(cx, cy), 2);
      continue;
    } else {
      off = (rnd() - 0.5) * BW;
      z = 0.06;
      bright = 0.09;
    }
    cloud.add(x + px * off, y + py * off, z, bright, 0.3 + 0.4 * rnd(), ord(x, y), 2);
  }
  // ---- the other side: masses of leaf and a low sun through them, well behind the sheet
  const clumps = [];
  for (let k = 0; k < 26; k++) clumps.push([(rnd() * 2 - 1) * hw * 1.25, (rnd() * 2 - 1) * hh * 1.05 - 2, -7 - 22 * rnd(), 1.5 + 4.5 * rnd(), rnd()]);
  while (cloud.left > 0) {
    if ((++tick & 1023) === 0) yield;
    const c = clumps[(rnd() * clumps.length) | 0];
    const r = c[3] * Math.pow(Math.abs(rnd.gauss()), 1.3) * 0.6;
    const a = rnd() * TAU, cz = rnd() * 2 - 1, sn = Math.sqrt(1 - cz * cz);
    const x = c[0] + Math.cos(a) * sn * r * 1.3, y = c[1] + cz * r, z = c[2] + Math.sin(a) * sn * r;
    // gold where the sun comes through, low on the right
    const gold = smooth(0.4, 1.0, 0.5 + x / (2.2 * hw) + 0.25 * c[4]) * smooth(hh, -hh, y);
    cloud.add(x, y, z, 0.35 + 1.4 * Math.pow(rnd(), 5) + 0.6 * gold, clamp(0.1 + 0.4 * c[4] + 0.5 * gold), clamp(0.55 + 0.4 * rnd()), 3);
  }
}

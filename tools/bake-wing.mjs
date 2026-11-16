#!/usr/bin/env node
// Bakes the HUD's wing glyph from the butterfly kit, so the page never pays for it at boot (wingCells floods a
// 0.2 mm grid: about 100 ms a wing).
//
//   node tools/bake-wing.mjs            writes src/ui/wingGlyph.js
//   node tools/bake-wing.mjs --check    prints what it would write (cell table only) and changes nothing
//
// What is drawn: the RIGHT forewing and hindwing, set like a specimen (the kit's own hinge points and sweep angles),
// seen from above with the head toward the top. The margin of each wing, its veins cut at the margin, and the 19 clear
// cells between them as closed paths. Nothing here is typed in by hand: outlines, veins, cells and the pose all come
// from src/shared/butterfly (wingOutline, wingVeins, wingCells, rig.js). Run it again whenever the kit's wings change.
//
// Cell order (docs/PLAY.md, section 4): the nine forewing cells other than the discal cell, from the tip inward, are
// cells 0..8; the nine hindwing cells, from the outer margin inward, are 9..17; the forewing's discal cell (the kit's
// forewing id 0, the largest) is cell 18. So cell = worldIndex * 3 + findIndex, and 18 is the loop.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wingOutline, wingVeins, wingCells, distToPoly } from '../src/shared/butterfly/wingData.js';
import { SIG_F, SIG_H, HINGE_F, HINGE_H } from '../src/shared/butterfly/rig.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/ui/wingGlyph.js');
const check = process.argv.includes('--check');

// ---- the flat wing (mm, its own frame) → the body frame, spread flat (rig.js: wingPoint with no stroke, no camber).
// On the animal the front third of the hindwing lies under the forewing. A glyph has to show all 19 cells, so the
// hindwing is swept further back on its own hinge, by the smallest angle that brings it clear (found below).
let hindSweep = 0;
const toBody = (hind, x, y) => {
  const sg = hind ? SIG_H + hindSweep : SIG_F;
  const h = hind ? HINGE_H : HINGE_F;
  return [Math.sin(sg) * x - Math.cos(sg) * y + h[0], Math.cos(sg) * x + Math.sin(sg) * y + h[1]];
};

const inside = (x, y, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

// ---- the edge of one cell of the flood grid, as a closed loop round its squares (the longest loop: no holes wanted)
function traceCell(g, id, grid = g.grid) {
  const { w, h, x0, y0, step } = g;
  const is = (i, j) => i >= 0 && j >= 0 && i < w && j < h && grid[j * w + i] === id;
  // directed edges with the cell on their left, keyed by their start corner
  const next = new Map();
  const key = (i, j) => j * (w + 1) + i;
  const add = (ai, aj, bi, bj) => {
    const k = key(ai, aj);
    if (!next.has(k)) next.set(k, []);
    next.get(k).push([bi, bj]);
  };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!is(i, j)) continue;
      if (!is(i, j - 1)) add(i, j, i + 1, j);
      if (!is(i + 1, j)) add(i + 1, j, i + 1, j + 1);
      if (!is(i, j + 1)) add(i + 1, j + 1, i, j + 1);
      if (!is(i - 1, j)) add(i, j + 1, i, j);
    }
  }
  let best = [];
  while (next.size) {
    const [k0] = next.keys();
    let i = k0 % (w + 1);
    let j = (k0 - i) / (w + 1);
    const loop = [];
    for (;;) {
      const k = key(i, j);
      const outs = next.get(k);
      if (!outs) break;
      const [ni, nj] = outs.pop();
      if (!outs.length) next.delete(k);
      loop.push([i, j]);
      i = ni;
      j = nj;
    }
    if (loop.length > best.length) best = loop;
  }
  // corner (i, j) of the grid is the point x0 + (i - 1) * step (square i is centred on x0 + (i - 0.5) * step)
  return best.map(([i, j]) => [x0 + (i - 1) * step, y0 + (j - 1) * step]);
}

// ---- a staircase → a clean shape: average out the steps, then drop the points a straight line already says
function smoothLoop(P, passes = 3) {
  let Q = P;
  for (let s = 0; s < passes; s++) {
    const N = Q.length;
    Q = Q.map((p, i) => {
      const a = Q[(i - 1 + N) % N];
      const b = Q[(i + 1) % N];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
    });
  }
  return Q;
}
function simplify(P, tol, closed) {
  const keep = new Uint8Array(P.length);
  const rec = (a, b) => {
    let worst = 0;
    let at = -1;
    const A = P[a];
    const B = P[b % P.length];
    const ex = B[0] - A[0];
    const ey = B[1] - A[1];
    const L = Math.hypot(ex, ey) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((P[i][0] - A[0]) * ey - (P[i][1] - A[1]) * ex) / L;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tol) {
      keep[at] = 1;
      rec(a, at);
      rec(at, b);
    }
  };
  if (closed) {
    // split a loop at its two most distant points so neither half is degenerate
    let far = 0;
    let fd = 0;
    for (let i = 1; i < P.length; i++) {
      const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1]);
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    keep[0] = keep[far] = 1;
    rec(0, far);
    rec(far, P.length);
  } else {
    keep[0] = keep[P.length - 1] = 1;
    rec(0, P.length - 1);
  }
  return P.filter((_, i) => keep[i]);
}

const cellsOf = [await wingCells(0), await wingCells(1)];
const outlines = [wingOutline(0, 96), wingOutline(1, 96)];

// ---- the smallest extra sweep that clears the hindwing from under the forewing (the first millimetres from the
// hinges always share ground: both wings spring from the same thorax)
{
  const fore = outlines[0].map(([x, y]) => toBody(0, x, y));
  const clear = () =>
    outlines[1].every(([x, y]) => {
      if (Math.hypot(x, y) < 4.5) return true;
      const [bx, by] = toBody(1, x, y);
      return !inside(bx, by, fore) && distToPoly(bx, by, fore) > 0.55;
    });
  while (!clear() && hindSweep < 1.2) hindSweep += 0.01;
}

// ---- panes. The kit's cells are the clear membrane only: each stops short of its veins and of the band of scales
// round the margin. A pane of the glyph is that cell grown out to meet its neighbours and the margin (so every lit
// pane sits flush between the hairlines), then drawn in by one square so the veins still show between two lit ones.
function panes(hind) {
  const g = cellsOf[hind];
  const { grid, w, h, x0, y0, step } = g;
  const outline = outlines[hind];
  const lab = new Int16Array(w * h).fill(-1);
  const open = new Uint8Array(w * h);
  let front = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = j * w + i;
      if (grid[s] >= 0) {
        lab[s] = grid[s];
        front.push(s);
      } else if (inside(x0 + (i - 0.5) * step, y0 + (j - 0.5) * step, outline)) open[s] = 1;
    }
  }
  while (front.length) {
    const nextFront = [];
    for (const c of front) {
      const ci = c % w;
      for (const d of [c - 1, c + 1, c - w, c + w]) {
        if (d < 0 || d >= w * h || Math.abs((d % w) - ci) > 1 || !open[d] || lab[d] >= 0) continue;
        lab[d] = lab[c];
        nextFront.push(d);
      }
    }
    front = nextFront;
  }
  const out = new Int16Array(w * h).fill(-1);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = j * w + i;
      const id = lab[s];
      if (id < 0) continue;
      let keep = true;
      for (let dj = -1; dj <= 1 && keep; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= w || jj >= h || lab[jj * w + ii] !== id) {
            keep = false;
            break;
          }
        }
      }
      if (keep) out[s] = id;
    }
  }
  return out;
}
const paneOf = [panes(0), panes(1)];

// ---- which kit cell is which HUD cell
const order = [];
for (const hind of [0, 1]) {
  const list = cellsOf[hind].cells.filter((c) => !(hind === 0 && c.id === 0));
  if (list.length !== 9) throw new Error(`the ${hind ? 'hind' : 'fore'}wing has ${list.length} cells besides the discal cell; the glyph is laid out for 9`);
  list.sort((a, b) => b.x - a.x);
  for (const c of list) order.push({ hind, kit: c });
}
order.push({ hind: 0, kit: cellsOf[0].cells[0] });

// ---- everything into the body frame, then into the picture: +x right, +y DOWN, the box tight round both wings
const bodyOutlines = outlines.map((o, hind) => o.map(([x, y]) => toBody(hind, x, y)));
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const o of bodyOutlines) {
  for (const [x, y] of o) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
}
const PAD = 0.4; // mm of air so a hairline on the margin is not cut by the box
const W = maxX - minX + PAD * 2;
const H = maxY - minY + PAD * 2;
const toPic = ([x, y]) => [x - minX + PAD, maxY - y + PAD];
const n2 = (v) => {
  const s = v.toFixed(2).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};
const path = (P, closed) => `M${P.map((p) => `${n2(p[0])} ${n2(p[1])}`).join('L')}${closed ? 'Z' : ''}`;

const outlinePaths = bodyOutlines.map((o) => path(simplify(o, 0.05, true).map(toPic), true));

const veinPaths = [];
for (const hind of [0, 1]) {
  for (const v of wingVeins(hind, 5)) {
    // (the costa of the forewing and the front vein of the hindwing run along the margin itself: the margin is drawn already)
    const pts = v.points.filter(([x, y]) => inside(x, y, outlines[hind]) && distToPoly(x, y, outlines[hind]) > 0.12);
    if (pts.length < 2) continue;
    const near = pts.reduce((a, [x, y]) => a + (distToPoly(x, y, outlines[hind]) < 0.45 ? 1 : 0), 0);
    if (near > pts.length * 0.6) continue;
    veinPaths.push(path(simplify(pts, 0.05, false).map((p) => toPic(toBody(hind, p[0], p[1]))), false));
  }
}

const cellPaths = [];
const table = [];
order.forEach(({ hind, kit }, i) => {
  const loop = simplify(smoothLoop(traceCell(cellsOf[hind], kit.id, paneOf[hind]), 3), 0.06, true);
  cellPaths.push(path(loop.map((p) => toPic(toBody(hind, p[0], p[1]))), true));
  const [cx, cy] = toPic(toBody(hind, kit.x, kit.y));
  table.push({ cell: i, wing: hind ? 'hind' : 'fore', kitId: kit.id, area: +kit.area.toFixed(1), x: +cx.toFixed(1), y: +cy.toFixed(1), points: loop.length });
});

console.log(`wing glyph: ${n2(W)} x ${n2(H)} mm, ${veinPaths.length} veins, ${cellPaths.length} cells, hindwing swept back ${hindSweep.toFixed(2)} rad to clear the forewing`);
for (const r of table) console.log(`  cell ${String(r.cell).padStart(2)}  ${r.wing}wing  kit id ${r.kitId}  ${String(r.area).padStart(5)} mm2  at ${r.x}, ${r.y}  (${r.points} points)`);

const src = `// GENERATED by tools/bake-wing.mjs from src/shared/butterfly (wingOutline, wingVeins, wingCells, rig.js). Do not edit:
// run \`node tools/bake-wing.mjs\` again when the kit's wings change.
//
// The right forewing and hindwing of the glasswing, set like a specimen, head toward the top. Units are millimetres.
// cells[i] is HUD cell i (docs/PLAY.md, section 4): 0..8 forewing from the tip inward, 9..17 hindwing from the outer
// margin inward, 18 the forewing's discal cell. cell = worldIndex * 3 + findIndex; 18 is the loop.

export const WING_GLYPH = {
  w: ${n2(W)},
  h: ${n2(H)},
  outline: ${JSON.stringify(outlinePaths, null, 2).replace(/\n/g, '\n  ')},
  veins: ${JSON.stringify(veinPaths, null, 2).replace(/\n/g, '\n  ')},
  cells: ${JSON.stringify(cellPaths, null, 2).replace(/\n/g, '\n  ')},
  /** centre of each cell, for anything that wants to point at one */
  centres: ${JSON.stringify(table.map((r) => [r.x, r.y]))},
};
`;
if (check) console.log(`--check: ${src.length} bytes, nothing written`);
else {
  writeFileSync(OUT, src);
  console.log(`wrote ${OUT} (${src.length} bytes)`);
}

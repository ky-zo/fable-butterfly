// GEOMETRY · one wing as a mesh, at any detail, usable with any material.
//
// A fan of spokes from a point inside the wing to its margin, with rings between (so it can bend along the span and
// crumple), and one more ring just outside the margin so that the edge can be antialiased by a shader.
//
// Attributes (all wings):
//   position  vec3   (x, y, 0) millimetres in the wing's flat frame — see wingData.js. NOT a body or world position:
//                    feed it to the rig (rig.js: bfWing() in a vertex shader, wingPoint() on the CPU)
//   aEdge     vec3   x: millimetres inside the margin (negative on the skirt outside it), y: width of the scaled
//                    border here (mm), z: how far the border turns to rust 0..1
//   aWing     vec2   x: side (+1 right, -1 left), y: 0 forewing | 1 hindwing

import * as THREE from 'three';
import { CENTRES, wingOutline, distToPoly, borderAt, veinSegments } from './wingData.js';

/** Which wing a geometry is: side (+1 right, -1 left) and fore / hind, on every vertex, so that one shader serves all four. */
export function sideAttr(geometry, side, hind) {
  const n = geometry.attributes.position.count;
  const w = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    w[i * 2] = side;
    w[i * 2 + 1] = hind;
  }
  geometry.setAttribute('aWing', new THREE.BufferAttribute(w, 2));
  return geometry;
}

/**
 * One wing (the right one), ready for the GPU.
 * @param hind    false = forewing, true = hindwing
 * @param o.spokes  points of the margin: 128 the one a lens goes up to (≈ 1400 triangles), 64 middle distance, 28 a flock
 * @param o.rings   rings between hub and margin: an array of fractions, or a count (12 or more if the wing is to crumple:
 *                  see `unfurl` in rig.js). Default 6 (fine) or 3.
 * @param o.rnd     () → 0..1 for wear on the margin; leave out for a clean wing
 * @returns {{ outline: number[][], veins: {a,b,ra,rb}[], geometry: THREE.BufferGeometry, centre: number[], hind: 0|1 }}
 */
export function buildWing(hind, { spokes = 128, rings = null, skirt = null, rnd = null } = {}) {
  const k = hind ? 1 : 0;
  const centre = CENTRES[k];
  const fine = spokes >= 64;
  const outline = wingOutline(hind, spokes, rnd, fine);

  // (the border is a contour of the distance to the margin: two rings close inside the margin keep that contour true)
  if (!rings) rings = fine ? [0.34, 0.6, 0.78, 0.88, 0.95, 1.0] : [0.55, 0.86, 1.0];
  else if (typeof rings === 'number') rings = Array.from({ length: rings }, (_, i) => Math.pow((i + 1) / rings, 0.8));
  const SKIRT = skirt ?? (fine ? 0.22 : 0.5); // mm outside the margin
  const R = rings.length + 1;
  const nv = 1 + spokes * R;
  const pos = new Float32Array(nv * 3);
  const edge = new Float32Array(nv * 3); // distance inside the margin (mm), border width (mm), rust
  const put = (i, x, y, e, bw, rust) => {
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    edge[i * 3] = e;
    edge[i * 3 + 1] = bw;
    edge[i * 3 + 2] = rust;
  };
  const cb = borderAt(hind, centre[0] + 6, centre[1]);
  put(0, centre[0], centre[1], distToPoly(centre[0], centre[1], outline), cb[0], cb[1]);
  for (let s = 0; s < spokes; s++) {
    const [ox, oy] = outline[s];
    const [bw, rust] = borderAt(hind, ox, oy);
    const a = outline[(s + spokes - 1) % spokes];
    const b = outline[(s + 1) % spokes];
    let nx = b[1] - a[1];
    let ny = -(b[0] - a[0]);
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    if (nx * (ox - centre[0]) + ny * (oy - centre[1]) < 0) {
      nx = -nx;
      ny = -ny;
    }
    for (let r = 0; r < R; r++) {
      const i = 1 + s * R + r;
      if (r === R - 1) put(i, ox + nx * SKIRT, oy + ny * SKIRT, -SKIRT, bw, rust);
      else {
        const f = rings[r];
        const x = centre[0] + (ox - centre[0]) * f;
        const y = centre[1] + (oy - centre[1]) * f;
        put(i, x, y, f === 1 ? 0 : distToPoly(x, y, outline), bw, rust);
      }
    }
  }
  const idx = [];
  for (let s = 0; s < spokes; s++) {
    const s1 = (s + 1) % spokes;
    const a = 1 + s * R;
    const b = 1 + s1 * R;
    idx.push(0, a, b);
    for (let r = 0; r < R - 1; r++) idx.push(a + r, a + r + 1, b + r, b + r, a + r + 1, b + r + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aEdge', new THREE.BufferAttribute(edge, 3));
  geometry.setIndex(idx);
  sideAttr(geometry, 1, hind ? 1 : 0);

  return { outline, veins: veinSegments(hind), geometry, centre, hind: k };
}

/** The left wing: shares the right one's buffers, mirrored by the rig (aWing.x = -1). */
export function mirrorWing(geometry, hind) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geometry.attributes.position);
  g.setAttribute('aEdge', geometry.attributes.aEdge);
  g.setIndex(geometry.index);
  return sideAttr(g, -1, hind ? 1 : 0);
}

/**
 * All four wings in one geometry (one draw call; what the flock and the cheapest single animal use).
 * @param wings  [fore, hind] from buildWing      @param Class  THREE.BufferGeometry | THREE.InstancedBufferGeometry
 */
export function fourWings(wings, Class = THREE.BufferGeometry) {
  const pos = [];
  const edge = [];
  const wing = [];
  const idx = [];
  for (const hind of [0, 1]) {
    const g = wings[hind].geometry;
    for (const side of [1, -1]) {
      const base = pos.length / 3;
      for (const v of g.attributes.position.array) pos.push(v);
      for (const v of g.attributes.aEdge.array) edge.push(v);
      for (let i = 0; i < g.attributes.position.count; i++) wing.push(side, hind);
      for (const i of g.index.array) idx.push(base + i);
    }
  }
  const out = new Class();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 3));
  out.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 2));
  out.setIndex(idx);
  return out;
}

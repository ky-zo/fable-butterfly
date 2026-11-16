// Mirror — one small tileable noise texture, so the room's surfaces cost a texture fetch instead of a stack of
// procedural octaves in the hottest shader of the world. 256², mipmapped, repeating.
//   r, g : two independent 5-octave value-noise fbm fields
//   b    : fine 3-octave noise (grain, pores)
//   a    : a single smooth low octave (slow variation)

import * as THREE from 'three';

function lattice(rnd, n) {
  const a = new Float32Array(n * n);
  for (let i = 0; i < a.length; i++) a[i] = rnd();
  return a;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Periodic value noise sampled on a size×size grid; `cells` lattice cells across the tile. */
function octave(rnd, size, cells, out, gain) {
  const lat = lattice(rnd, cells);
  const s = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * s;
    const y0 = Math.floor(fy);
    const ty = fade(fy - y0);
    const ya = (y0 % cells) * cells;
    const yb = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = x * s;
      const x0 = Math.floor(fx);
      const tx = fade(fx - x0);
      const xa = x0 % cells;
      const xb = (x0 + 1) % cells;
      const a = lat[ya + xa] + (lat[ya + xb] - lat[ya + xa]) * tx;
      const b = lat[yb + xa] + (lat[yb + xb] - lat[yb + xa]) * tx;
      out[y * size + x] += (a + (b - a) * ty) * gain;
    }
  }
}

function field(rnd, size, cellList) {
  const out = new Float32Array(size * size);
  let g = 0.5;
  let norm = 0;
  for (const c of cellList) {
    octave(rnd, size, c, out, g);
    norm += g;
    g *= 0.5;
  }
  // stretch to the full 0..1 range
  let lo = 1e9;
  let hi = -1e9;
  for (let i = 0; i < out.length; i++) {
    out[i] /= norm;
    lo = Math.min(lo, out[i]);
    hi = Math.max(hi, out[i]);
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
  return out;
}

export function createNoiseTexture(rnd, size = 256) {
  const r = field(rnd, size, [4, 8, 16, 32, 64]);
  const g = field(rnd, size, [5, 10, 20, 40, 80]);
  const b = field(rnd, size, [32, 64, 128]);
  const a = field(rnd, size, [3, 6]);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(r[i] * 255);
    data[i * 4 + 1] = Math.round(g[i] * 255);
    data[i * 4 + 2] = Math.round(b[i] * 255);
    data[i * 4 + 3] = Math.round(a[i] * 255);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

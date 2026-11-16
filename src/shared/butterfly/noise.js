// A small tileable noise atlas, built once on the CPU. Sampling this is far cheaper than hashing in every shader.
//   R  smooth fbm (period 4)        — large blotches, density variation
//   G  fbm (period 16, 4 octaves)   — grain, streaks, edge breakup
//   B  uniform white noise          — dither, sparkle seeds
//   A  tileable cellular F1 (period 16) — beads, pores, pitting

import * as THREE from 'three';

function lattice(period, seed) {
  const n = period * period;
  const a = new Float32Array(n);
  let s = (seed * 2654435761) >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    a[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return a;
}

function valueNoise(lat, period, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = lat[y0 * period + x0];
  const b = lat[y0 * period + x1];
  const c = lat[y1 * period + x0];
  const d = lat[y1 * period + x1];
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const octs = (base, seed, n) => Array.from({ length: n }, (_, i) => ({ p: base << i, lat: lattice(base << i, seed + i * 17) }));
  const lowO = octs(4, 11, 4);
  const hiO = octs(16, 53, 4);
  const white = lattice(size, 97);
  // cellular feature points on a 16x16 torus
  const CP = 16;
  const cx = lattice(CP, 131);
  const cy = lattice(CP, 173);
  const fb = (o, u, v) => {
    let s = 0;
    let a = 0.5;
    let n = 0;
    for (const k of o) {
      s += a * valueNoise(k.lat, k.p, u * k.p, v * k.p);
      n += a;
      a *= 0.5;
    }
    return s / n;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, (fb(lowO, u, v) - 0.5) * 1.9 * 255 + 127.5));
      data[i + 1] = Math.max(0, Math.min(255, (fb(hiO, u, v) - 0.5) * 1.9 * 255 + 127.5));
      data[i + 2] = white[y * size + x] * 255;
      const px = u * CP;
      const py = v * CP;
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      let f1 = 9;
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          const gx = (((ix + k) % CP) + CP) % CP;
          const gy = (((iy + j) % CP) + CP) % CP;
          const dx = ix + k + cx[gy * CP + gx] - px;
          const dy = iy + j + cy[gy * CP + gx] - py;
          f1 = Math.min(f1, dx * dx + dy * dy);
        }
      }
      data[i + 3] = Math.min(255, Math.sqrt(f1) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

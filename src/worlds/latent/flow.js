// A tileable, divergence-free velocity field baked into a small 3D texture.
// The field is the curl of a vector potential made of random Fourier modes with integer wave vectors, so it wraps
// seamlessly and costs one trilinear fetch in the simulation instead of eighteen simplex evaluations.

import * as THREE from 'three';

export async function makeFlowTexture(ctx, size = 48, seed = 11) {
  const rnd = ctx.rng(seed);
  const M = 10;
  // modes[c] → potential component c
  const modes = [];
  for (let c = 0; c < 3; c++) {
    const list = [];
    for (let m = 0; m < M; m++) {
      let kx = 0, ky = 0, kz = 0;
      while (kx === 0 && ky === 0 && kz === 0) {
        const kmax = m < 5 ? 1 : m < 8 ? 2 : 3;
        kx = rnd.int(-kmax, kmax);
        ky = rnd.int(-kmax, kmax);
        kz = rnd.int(-kmax, kmax);
      }
      const kl = Math.hypot(kx, ky, kz);
      list.push({ kx, ky, kz, a: 1 / Math.pow(kl, 1.7), ph: rnd() * Math.PI * 2 });
    }
    modes.push(list);
  }
  const n = size;
  const vel = new Float32Array(n * n * n * 3);
  const TAU = Math.PI * 2;
  const g = new Float32Array(9); // g[c*3+j] = d psi_c / d x_j
  let sum2 = 0;
  let o = 0;
  let t0 = performance.now();
  for (let z = 0; z < n; z++) {
    // (made in slices: this runs while another world is on screen)
    if (performance.now() - t0 > 5) {
      await ctx.yield();
      t0 = performance.now();
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        g.fill(0);
        const px = x / n, py = y / n, pz = z / n;
        for (let c = 0; c < 3; c++) {
          const list = modes[c];
          for (let m = 0; m < M; m++) {
            const k = list[m];
            const d = k.a * Math.cos(TAU * (k.kx * px + k.ky * py + k.kz * pz) + k.ph);
            g[c * 3] += d * k.kx;
            g[c * 3 + 1] += d * k.ky;
            g[c * 3 + 2] += d * k.kz;
          }
        }
        const vx = g[7] - g[5];
        const vy = g[2] - g[6];
        const vz = g[3] - g[1];
        vel[o++] = vx;
        vel[o++] = vy;
        vel[o++] = vz;
        sum2 += vx * vx + vy * vy + vz * vz;
      }
    }
  }
  const rms = Math.sqrt(sum2 / (n * n * n));
  const RANGE = 3.2; // stored value = v / rms, clamped to ±RANGE
  await ctx.yield();
  const data = new Uint8Array(n * n * n * 4);
  for (let i = 0, j = 0; i < vel.length; i += 3, j += 4) {
    for (let c = 0; c < 3; c++) {
      const v = Math.max(-1, Math.min(1, vel[i + c] / rms / RANGE));
      data[j + c] = Math.round(v * 127 + 128);
    }
    data[j + 3] = 255;
  }
  const tex = new THREE.Data3DTexture(data, n, n, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  ctx.track(tex);
  return tex;
}

// GLSL: unit-RMS flow at p (p in texture periods).
export const FLOW_GLSL = /* glsl */ `
uniform highp sampler3D tFlow;
vec3 flowTex(vec3 p){ return (textureLod(tFlow, p, 0.0).xyz * 255.0 - 128.0) / 127.0 * 3.2; }
`;

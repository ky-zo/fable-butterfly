// A fixed-size bag of points that the form generators fill.
// Each point is (x, y, z, w) where w packs 24 bits: which of the region's four ramps (2), growth order (7), tint along
// the ramp (7), log brightness (8). 24 bits is what a float32 holds exactly.
//   sub    0..3  which ramp of its region (cloud.sub is used when the generator does not say)
//   order  0..1  when this point condenses (the tide that sweeps through the form)
//   tint   0..1  position on the ramp
//   bright 2^-6 .. 2^2 (log encoded)

export class Cloud {
  constructor(n) {
    this.n = n;
    this.data = new Float32Array(n * 4);
    this.i = 0;
    this.sub = 0;
  }

  get left() {
    return this.n - this.i;
  }

  /** How many points a share of the whole budget is worth. */
  share(f) {
    return Math.max(0, Math.min(this.left, Math.floor(this.n * f)));
  }

  add(x, y, z, bright = 1, tint = 0.5, order = 0.5, sub = this.sub) {
    if (this.i >= this.n) return false;
    const o = this.i * 4;
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    const b8 = Math.max(0, Math.min(255, Math.round(((Math.log2(Math.max(bright, 1e-4)) + 6) / 8) * 255)));
    const t7 = Math.max(0, Math.min(127, Math.round(tint * 127)));
    const o7 = Math.max(0, Math.min(127, Math.round(order * 127)));
    d[o + 3] = sub * 4194304 + o7 * 32768 + t7 * 256 + b8;
    this.i++;
    return true;
  }

  /** Rotate (Euler XYZ order applied as Rz·Ry·Rx), scale and translate everything added so far, from index `start`. */
  transform({ rx = 0, ry = 0, rz = 0, scale = 1, tx = 0, ty = 0, tz = 0 }, start = 0) {
    const d = this.data;
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    for (let i = start; i < this.i; i++) {
      const o = i * 4;
      let x = d[o], y = d[o + 1], z = d[o + 2];
      let t = y * cx - z * sx;
      z = y * sx + z * cx;
      y = t;
      t = x * cy + z * sy;
      z = -x * sy + z * cy;
      x = t;
      t = x * cz - y * sz;
      y = x * sz + y * cz;
      x = t;
      d[o] = x * scale + tx;
      d[o + 1] = y * scale + ty;
      d[o + 2] = z * scale + tz;
    }
  }

  /** Fill whatever is left with a sparse gaussian halo so no texel is ever uninitialised. */
  pad(rnd, radius = 2.2) {
    while (this.i < this.n) {
      this.add(rnd.gauss() * radius, rnd.gauss() * radius, rnd.gauss() * radius, 0.05, rnd(), rnd(), 0);
    }
  }

  /** Copy every point of another cloud in after the ones already here (keeps their packed w, sets their ramp). */
  take(other, sub = null) {
    const n = Math.min(other.i, this.left);
    const d = this.data;
    const s = other.data;
    for (let k = 0; k < n; k++) {
      const o = (this.i + k) * 4;
      d[o] = s[k * 4];
      d[o + 1] = s[k * 4 + 1];
      d[o + 2] = s[k * 4 + 2];
      const w = s[k * 4 + 3];
      d[o + 3] = sub == null ? w : (w % 4194304) + sub * 4194304;
    }
    this.i += n;
  }

  /** Add `delta` to the growth order of every point from index `start` on, scaled by `gain` first. */
  reorder(start, gain, delta) {
    const d = this.data;
    for (let i = start; i < this.i; i++) {
      const w = d[i * 4 + 3];
      const sub = Math.floor(w / 4194304);
      const rest = w - sub * 4194304;
      const o7 = Math.floor(rest / 32768);
      const lo = rest - o7 * 32768;
      const q = Math.max(0, Math.min(127, Math.round((o7 / 127) * gain * 127 + delta * 127)));
      d[i * 4 + 3] = sub * 4194304 + q * 32768 + lo;
    }
  }

  /** Fisher–Yates over whole points: any regular subset of the texture is then an unbiased sample of the form. */
  shuffle(rnd) {
    const d = this.data;
    for (let i = this.n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const a = i * 4, b = j * 4;
      for (let c = 0; c < 4; c++) {
        const t = d[a + c];
        d[a + c] = d[b + c];
        d[b + c] = t;
      }
    }
  }

  /** Centroid and robust radius of the cloud. Used to normalise forms to the same size. */
  bounds() {
    const d = this.data;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < this.i; i++) {
      cx += d[i * 4];
      cy += d[i * 4 + 1];
      cz += d[i * 4 + 2];
    }
    cx /= this.i;
    cy /= this.i;
    cz /= this.i;
    // radius that contains 97 % of the points (spray and strays do not get to shrink the sculpture)
    const m = Math.ceil(this.i / 7);
    const dd = new Float32Array(m);
    for (let i = 0, k = 0; i < this.i; i += 7, k++) {
      const dx = d[i * 4] - cx, dy = d[i * 4 + 1] - cy, dz = d[i * 4 + 2] - cz;
      dd[k] = dx * dx + dy * dy + dz * dz;
    }
    dd.sort();
    const r2 = dd[Math.floor(m * 0.97)];
    return { cx, cy, cz, r: Math.sqrt(r2) };
  }
}

export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Cheap smooth 1D value noise (deterministic, no state). */
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n) => {
    let t = Math.imul((n + seed * 7919) | 0, 0x27d4eb2d);
    t ^= t >>> 15;
    t = Math.imul(t, 0x85ebca6b);
    t ^= t >>> 13;
    return ((t >>> 0) / 4294967296) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

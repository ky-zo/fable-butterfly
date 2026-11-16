// Small math + determinism helpers shared by the core and every world.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (x) => clamp(x, 0, 1);
export const smoothstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const remap = (x, a, b, c, d) => c + ((x - a) / (b - a)) * (d - c);
export const remapClamped = (x, a, b, c, d) => c + saturate((x - a) / (b - a)) * (d - c);

/** Frame-rate independent exponential approach. `rate` ≈ 1/time-constant (per second). */
export const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

/** Window that is 0 outside [a,d], 1 inside [b,c], smooth in between. Handy for progress-gated events. */
export const band = (x, a, b, c, d) => smoothstep(a, b, x) * (1 - smoothstep(c, d, x));

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/** Deterministic PRNG. `const rnd = mulberry32(7); rnd()` → [0,1). Use this instead of Math.random() so screenshots are reproducible. */
export function mulberry32(seed = 1) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.sign = () => (f() < 0.5 ? -1 : 1);
  /** Standard normal (Box–Muller). */
  f.gauss = () => {
    const u = Math.max(1e-9, f());
    const v = f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return f;
}

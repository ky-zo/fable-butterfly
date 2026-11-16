// Shared GLSL chunks. Every export is a string; interpolate the ones you need at the top of a shader:
//
//   import { hash, noise, simplex, fbm, curl } from '../../core/glsl.js';
//   const frag = /* glsl */`
//     ${hash}
//     ${simplex}
//     void main(){ ... snoise(p) ... }
//   `;
//
// Dependencies: `noise`, `fbm`, `voronoi` need `hash`. `fbm` needs `noise`. `curl` needs `simplex`.
// `ALL` is every chunk in dependency order if you just want everything.

export const constants = /* glsl */ `
#ifndef HL_CONSTANTS
#define HL_CONSTANTS
#define PI 3.141592653589793
#define TAU 6.283185307179586
#define GOLDEN_ANGLE 2.399963229728653
#endif
`;

// Hash without sine (Dave Hoskins). Stable across GPUs.
export const hash = /* glsl */ `
#ifndef HL_HASH
#define HL_HASH
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash21(float p){ vec3 p3 = fract(vec3(p) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec2 hash23(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash31(float p){ vec3 p3 = fract(vec3(p) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
vec3 hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
// Interleaved gradient noise (Jimenez) — great per-pixel dither / rotation source. Pass gl_FragCoord.xy.
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
#endif
`;

// Value noise (cheap, smooth) in 2D / 3D, with analytic-free quintic interpolation. Range 0..1.
export const noise = /* glsl */ `
#ifndef HL_NOISE
#define HL_NOISE
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
#endif
`;

// Simplex noise 2D/3D (Ian McEwan / Ashima Arts, MIT). Range ≈ -1..1.
export const simplex = /* glsl */ `
#ifndef HL_SIMPLEX
#define HL_SIMPLEX
vec3 _mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 _mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 _mod289(vec2 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 _permute(vec3 x){ return _mod289(((x * 34.0) + 1.0) * x); }
vec4 _permute(vec4 x){ return _mod289(((x * 34.0) + 1.0) * x); }
vec4 _taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = _mod289(i);
  vec3 p = _permute(_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float snoise(vec3 v){
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = _mod289(i);
  vec4 p = _permute(_permute(_permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = _taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
#endif
`;

// Fractal sums. fbm() is value-noise based (0..1); sfbm() is simplex based (≈ -1..1). Octaves are compile-time ints.
export const fbm = /* glsl */ `
#ifndef HL_FBM
#define HL_FBM
float fbm(vec2 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vnoise(p); n += a; p = r * p * 2.03 + 17.1; a *= 0.5; }
  return s / n;
}
float fbm(vec3 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vnoise(p); n += a; p = p.yzx * 2.03 + vec3(17.1, 3.7, 9.2); a *= 0.5; }
  return s / n;
}
// Ridged multifractal — veins, mountain crests, cracks. 0..1.
float ridged(vec2 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0, w = 1.0;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 8; i++) { if (i >= oct) break; float v = 1.0 - abs(vnoise(p) * 2.0 - 1.0); v *= v * w; w = clamp(v * 2.0, 0.0, 1.0); s += a * v; n += a; p = r * p * 2.07 + 11.3; a *= 0.5; }
  return s / n;
}
#endif
`;

// Divergence-free flow field from simplex noise — the classic "smoke" motion for particles.
export const curl = /* glsl */ `
#ifndef HL_CURL
#define HL_CURL
vec3 _snoise3(vec3 x){
  return vec3(snoise(x), snoise(vec3(x.y - 19.1, x.z + 33.4, x.x + 47.2)), snoise(vec3(x.z + 74.2, x.x - 124.5, x.y + 99.4)));
}
vec3 curlNoise(vec3 p){
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0), dy = vec3(0.0, e, 0.0), dz = vec3(0.0, 0.0, e);
  vec3 px0 = _snoise3(p - dx), px1 = _snoise3(p + dx);
  vec3 py0 = _snoise3(p - dy), py1 = _snoise3(p + dy);
  vec3 pz0 = _snoise3(p - dz), pz1 = _snoise3(p + dz);
  float x = py1.z - py0.z - pz1.y + pz0.y;
  float y = pz1.x - pz0.x - px1.z + px0.z;
  float z = px1.y - px0.y - py1.x + py0.x;
  return normalize(vec3(x, y, z) / (2.0 * e) + 1e-6);
}
#endif
`;

// Cellular noise. voronoi(p) → vec3(F1, F2, cellId). F2-F1 gives cell borders.
export const voronoi = /* glsl */ `
#ifndef HL_VORONOI
#define HL_VORONOI
vec3 voronoi(vec2 p){
  vec2 n = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(n + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = hash12(n + g); } else if (d < f2) { f2 = d; }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
vec3 voronoi(vec3 p){
  vec3 n = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 g = vec3(float(i), float(j), float(k));
    vec3 o = hash33(n + g);
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = hash13(n + g); } else if (d < f2) { f2 = d; }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
#endif
`;

// Colour + small utilities.
export const color = /* glsl */ `
#ifndef HL_COLOR
#define HL_COLOR
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toLinear(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
// IQ cosine palette: a + b*cos(2π(c*t+d))
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b * cos(6.283185307179586 * (c * t + d)); }
// Approximate black-body colour (linear RGB) for a temperature in Kelvin, 1000..12000.
vec3 blackbody(float k){
  float t = k / 100.0;
  vec3 c;
  c.r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
  c.g = t <= 66.0 ? clamp(0.39008157876 * log(t) - 0.63184144378, 0.0, 1.0) : clamp(1.129890861 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  c.b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.54320678911 * log(t - 10.0) - 1.19625408914, 0.0, 1.0));
  return c * c; // roughly linearise
}
// Wavelength (380..700nm) → linear RGB, for dispersion / thin-film / spectral tricks.
vec3 spectrum(float nm){
  float x = clamp((nm - 380.0) / 320.0, 0.0, 1.0);
  vec3 c = vec3(
    smoothstep(0.50, 0.72, x) + 0.35 * smoothstep(0.18, 0.0, x) * smoothstep(0.0, 0.08, x) * 2.0,
    smoothstep(0.18, 0.42, x) * smoothstep(0.86, 0.60, x),
    smoothstep(0.0, 0.14, x) * smoothstep(0.48, 0.30, x));
  return c * smoothstep(0.0, 0.06, x) * smoothstep(1.0, 0.88, x);
}
// Thin-film interference tint (soap bubble / oil / beetle shell). cosTheta = N·V, thickness in nm.
vec3 thinFilm(float cosTheta, float thickness, float ior){
  float ct = sqrt(max(0.0, 1.0 - (1.0 - cosTheta * cosTheta) / (ior * ior)));
  float opd = 2.0 * ior * thickness * ct;
  vec3 phase = 6.283185307179586 * opd / vec3(650.0, 532.0, 450.0);
  return 0.5 + 0.5 * cos(phase);
}
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float sat(float x){ return clamp(x, 0.0, 1.0); }
float remap01(float x, float a, float b){ return clamp((x - a) / (b - a), 0.0, 1.0); }
#endif
`;

// Depth helpers for reading a three.js perspective DepthTexture.
export const depth = /* glsl */ `
#ifndef HL_DEPTH
#define HL_DEPTH
// Raw depth-buffer value (0..1) → positive view-space distance along the camera axis.
float linearDepth(float z, float near, float far){
  float ndc = z * 2.0 - 1.0;
  return 2.0 * near * far / (far + near - ndc * (far - near));
}
#endif
`;

export const ALL = [constants, hash, noise, simplex, fbm, curl, voronoi, color, depth].join('\n');

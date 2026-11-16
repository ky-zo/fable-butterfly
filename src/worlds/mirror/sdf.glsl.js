// Mirror — the liquid form as a signed distance field.
//
// The body is ONE "core" primitive that can be a sphere, a torus or a (2,3) torus knot depending on three numbers
// (R, a, r), plus up to NS spheres (lobes, the attention swelling, droplets). Everything is fused with a
// compactly-supported smooth union:
//
//     f(p) = Σ wᵢ,   wᵢ = max(0, 1 − dᵢ / 6kᵢ)⁶   (≈ exp(−dᵢ/kᵢ), but exactly zero beyond 6kᵢ)
//     d(p) = −log(f) · f / Σ(wᵢ/kᵢ)                (surface where f = 1)
//
// It is C⁵ everywhere (no crease in a mirror reflection where a blend starts, which a polynomial smooth-min shows),
// order independent, each primitive has its own blend width, and — because the support is compact — a ray only has
// to evaluate the primitives whose kernels it actually passes through. `cull()` builds that list once per ray;
// `map()` then loops over a handful of indices instead of forty spheres.
//
// Normals are analytic (`mapG`): a mirror shows every bit of noise in a finite-difference normal, and one
// evaluation with its gradient is cheaper than four without.
//
// The last thing the liquid tries is the animal itself. Its body is still this field (a chain of spheres laid along
// the kit's own body curves); its wings are not: they are four thin plates, met by the ray analytically (plate.glsl.js).
//
// The field is traced twice. A small pass walks a cone down every fourth pixel and writes how far it got before the
// cone touched anything (marchCone); the picture, at full size, starts each of its rays there and needs two or three
// steps to land exactly on the surface (march). So the outline, the normal and what the mirror shows are all exact at
// the size of the picture, and the long empty walk is paid for sixteen times less often.

export const NS = 48; // sphere slots
export const NRING = 4; // travelling surface rings

export const sdfUniformsGLSL = /* glsl */ `
#define NS ${NS}
#define NRING ${NRING}
uniform vec4 uSph[NS];        // xyz centre, w radius (inactive slots have a very negative radius)
uniform float uSphK[NS];      // blend width
uniform int uSphCount;        // slots in use
uniform vec4 uBound;          // one sphere around everything the form currently is (kernels included)
uniform vec3 uCoreC;          // core centre
uniform mat3 uCoreRot;        // world → core space
uniform vec3 uCoreAxis;       // the ring axis in world space (row 1 of uCoreRot)
uniform vec4 uCoreP;          // R (ring radius), a (strand offset), r (tube radius), k (blend width)
uniform vec4 uCoreB;          // kernel-support radius, strand blend, tight radius, blend inflation
uniform float uCoreSlab;      // half thickness of the core along its axis
uniform vec4 uRing[NRING];    // ring origin (world), w = current front radius
uniform vec4 uRingP[NRING];   // amplitude, 1/width², wavenumber, -
uniform vec4 uWob;            // amplitude, frequency, time, max total displacement
`;

export const sdfGLSL = /* glsl */ `
#ifndef MAXL
#define MAXL 14
#endif
int gN;
int gI[MAXL];
bool gCore;

// cos/sin of 1.5·φ from the direction (cos φ, sin φ), without atan. The half angle has a sign ambiguity across
// φ = ±π that turns the cross-section by π — which swaps the knot's two strands, so the field does not notice.
vec2 cs15(vec2 e){
  float ch = sqrt(max(0.5 + 0.5 * e.x, 0.0));
  float sh = sqrt(max(0.5 - 0.5 * e.x, 0.0)) * (e.y < 0.0 ? -1.0 : 1.0);
  return vec2(e.x * ch - e.y * sh, e.y * ch + e.x * sh);
}

// Sphere → torus → trefoil in one function. q is in core space, y is the ring axis.
// The two strands of the knot are fused with a cubic (C2) smooth minimum.
float sdCore(vec3 q){
  float R = uCoreP.x, a = uCoreP.y, r = uCoreP.z;
  float rho = length(q.xz);
  vec2 c = vec2(rho - R, q.y);
  float fat = length(c) - (a + r);           // exact bound: the knot lives inside this torus
  if (a < 1e-4 || fat > 6.0 * uCoreP.w + 0.01) return fat;   // (beyond the blend kernel the cheap bound is all anyone needs)
  vec2 e = cs15(q.xz / max(rho, 1e-5));
  vec2 w = vec2(e.x * c.x + e.y * c.y, e.x * c.y - e.y * c.x);
  float d1 = length(w - vec2(a, 0.0)) - r;
  float d2 = length(w + vec2(a, 0.0)) - r;
  float ks = uCoreB.y;
  float h = max(ks - abs(d1 - d2), 0.0) / ks;
  float d = min(d1, d2) - h * h * h * ks * (1.0 / 6.0);
  // the twist stretches distances by this much; undo it so sphere tracing stays honest
  float tw = 1.5 * a / max(rho, 0.03);
  return max(fat, d * inversesqrt(1.0 + tw * tw));
}

// The same, with its gradient in world space (valid near the surface, which is the only place it is asked for).
float sdCoreG(vec3 pw, out vec3 grad){
  vec3 q = uCoreRot * (pw - uCoreC);
  float R = uCoreP.x, a = uCoreP.y, r = uCoreP.z;
  float rho = max(length(q.xz), 1e-5);
  vec2 rad = q.xz / rho;
  vec2 c = vec2(rho - R, q.y);
  vec3 gl;
  float d;
  if (a < 1e-4) {
    float lc = max(length(c), 1e-6);
    d = lc - r;
    vec2 u = c / lc;
    gl = vec3(u.x * rad.x, u.y, u.x * rad.y);
  } else {
    vec2 e = cs15(rad);
    float cs = e.x, sn = e.y;
    vec2 w = vec2(cs * c.x + sn * c.y, cs * c.y - sn * c.x);
    vec2 w1 = w - vec2(a, 0.0), w2 = w + vec2(a, 0.0);
    float l1 = max(length(w1), 1e-6), l2 = max(length(w2), 1e-6);
    float d1 = l1 - r, d2 = l2 - r;
    float ks = uCoreB.y;
    float h = max(ks - abs(d1 - d2), 0.0) / ks;
    d = min(d1, d2) - h * h * h * ks * (1.0 / 6.0);
    // d/d(d1), d/d(d2) of the cubic smooth min
    float m = 0.5 * h * h;
    float m1 = d1 < d2 ? 1.0 - m : m;
    vec2 u = (w1 / l1) * m1 + (w2 / l2) * (1.0 - m1);
    vec2 dc = vec2(cs * u.x - sn * u.y, sn * u.x + cs * u.y);
    float da = dot(u, vec2(w.y, -w.x)) * 1.5 / rho;
    gl = vec3(dc.x * rad.x - da * rad.y, dc.y, dc.x * rad.y + da * rad.x);
    float tw = 1.5 * a / max(rho, 0.03);
    float corr = inversesqrt(1.0 + tw * tw);
    d *= corr; gl *= corr;
  }
  grad = gl * uCoreRot;
  return d;
}

// Slow undulation of the whole surface + the rings that travel away from a touch. Only its slope is ever asked for
// (it goes into the normal: mapG), so the undulation is four plane waves and costs four cosines.
void surfDispG(vec3 p, out vec3 g){
  g = vec3(0.0);
  if (uWob.x > 0.0) {
    vec3 q = (p - uCoreC) * uWob.y;
    float t = uWob.z;
    g = uWob.x * uWob.y * (
        vec3(0.93, 0.31, 0.2) * cos(dot(q, vec3(0.93, 0.31, 0.2)) + t * 0.61)
      + vec3(-0.28, 1.05, 0.42) * cos(dot(q, vec3(-0.28, 1.05, 0.42)) - t * 0.47 + 1.3)
      + vec3(0.35, -0.44, 0.98) * cos(dot(q, vec3(0.35, -0.44, 0.98)) + t * 0.53 + 2.1)
      + vec3(-1.5, 0.9, -1.3) * 0.34 * cos(dot(q, vec3(-1.5, 0.9, -1.3)) - t * 0.83 + 4.0));
  }
  for (int i = 0; i < NRING; i++) {
    vec4 rp = uRingP[i];
    if (rp.x > 0.0) {
      vec3 v = p - uRing[i].xyz;
      float l = max(length(v), 1e-5);
      float x = l - uRing[i].w;
      float en = rp.x * exp(-x * x * rp.y);
      g += (v / l) * (en * (-2.0 * x * rp.y * cos(x * rp.z) - rp.z * sin(x * rp.z)));
    }
  }
}

float map(vec3 p){
  float d = 1e9;
  if (gN == 0) {
    if (gCore) d = sdCore(uCoreRot * (p - uCoreC));
  } else {
    float f = 0.0, g = 0.0;
    if (gCore) {
      d = sdCore(uCoreRot * (p - uCoreC));
      float k = uCoreP.w;
      float x = max(0.0, 1.0 - d / (6.0 * k));
      float e = x * x * x; e *= e;
      f = e; g = e / k;
    }
    for (int j = 0; j < gN; j++) {
      int i = gI[j];
      vec4 s = uSph[i];
      float k = uSphK[i];
      float di = length(p - s.xyz) - s.w;
      float x = max(0.0, 1.0 - di / (6.0 * k));
      float e = x * x * x; e *= e;
      f += e; g += e / k; d = min(d, di);
    }
    if (f > 1e-6) d = min(d, -log(f) * f / g);
  }
  return d;
}

// Distance, unit normal and a curvature estimate (1 / local radius) in one evaluation. Call it AT a hit.
float mapG(vec3 p, out vec3 n, out float curv){
  vec3 g = vec3(0.0, 1.0, 0.0);
  float d = 1e9;
  curv = 1.0 / max(uCoreP.z, 0.02);
  if (gN == 0) {
    if (gCore) d = sdCoreG(p, g);
  } else {
    float f = 0.0, gs = 0.0, cv = 0.0;
    vec3 ga = vec3(0.0);
    if (gCore) {
      vec3 gc;
      d = sdCoreG(p, gc);
      float k = uCoreP.w;
      float x = max(0.0, 1.0 - d / (6.0 * k));
      float x2 = x * x, x5 = x2 * x2 * x, e = x5 * x;
      f = e; gs = e / k; ga = gc * (x5 / k); cv = e * curv;
    }
    for (int j = 0; j < gN; j++) {
      int i = gI[j];
      vec4 s = uSph[i];
      float k = uSphK[i];
      vec3 v = p - s.xyz;
      float l = max(length(v), 1e-6);
      float di = l - s.w;
      float x = max(0.0, 1.0 - di / (6.0 * k));
      float x2 = x * x, x5 = x2 * x2 * x, e = x5 * x;
      f += e; gs += e / k; ga += (v / l) * (x5 / k); cv += e / max(s.w, 0.03);
      d = min(d, di);
    }
    if (f > 1e-6) { d = min(d, -log(f) * f / gs); g = ga / gs; curv = cv / f; }
  }
  // (the ripples are in the normal only: a mirror shows a slope long before it shows a height, and the walk to the
  //  surface stays free of them)
  vec3 gd;
  surfDispG(p, gd);
  n = normalize(g - gd);
  return d;
}

// Which primitives can this ray touch? A primitive joins the list when the ray enters the full support of its
// blend kernel (so the field is exact), but the interval worth marching only spans the much tighter shells in
// which a surface can actually exist. leaving = the ray starts on the form: a convex primitive it is moving away
// from cannot be hit again, which lets most reflection rays skip the march entirely.
// Returns [near, far]; near > far → nothing to hit.
vec2 cull(vec3 ro, vec3 rd, bool leaving){
  gN = 0; gCore = false;
  vec3 ob = uBound.xyz - ro;
  float bb = dot(ob, rd), ob2 = dot(ob, ob), rb2 = uBound.w * uBound.w;
  if (ob2 - bb * bb > rb2 || (bb < 0.0 && ob2 > rb2)) return vec2(1.0, 0.0);

  float t0 = 1e9, t1 = -1e9;
  vec3 oc = uCoreC - ro;
  float cb = dot(oc, rd), co2 = dot(oc, oc);
  float cl2 = co2 - cb * cb;
  float rw = uCoreB.x;
  if (uCoreP.z > 0.0 && cl2 < rw * rw && cb + sqrt(rw * rw - cl2) > 0.0) gCore = true;

  float grow = leaving ? 2.0 : 2.6;
  for (int i = 0; i < uSphCount; i++) {
    vec4 s = uSph[i];
    float k = uSphK[i];
    float rs = s.w + 6.0 * k + uWob.w;
    if (rs <= 0.0) continue;
    vec3 os = s.xyz - ro;
    float b = dot(os, rd), o2 = dot(os, os);
    float l2 = o2 - b * b;
    if (l2 < rs * rs && gN < MAXL && b + sqrt(rs * rs - l2) > 0.0) {
      gI[gN] = i; gN++;
      float rt = s.w + grow * k + uWob.w;
      float h2 = rt * rt - l2;
      if (h2 > 0.0) {
        float q = sqrt(h2);
        if (b + q > 0.0 && !(leaving && b < 0.0 && o2 < rt * rt)) { t0 = min(t0, b - q); t1 = max(t1, b + q); }
      }
    }
  }
  if (gCore) {
    float infl = gN > 0 ? uCoreB.w : 0.0;
    float rt = uCoreB.z + infl;
    float h2 = rt * rt - cl2;
    if (h2 > 0.0) {
      float q = sqrt(h2);
      float a0 = cb - q, a1 = cb + q;
      bool ball = uCoreP.x <= 0.0;
      if (!ball) {
        // a ring or a knot is flat: clip the interval to the slab it lives in
        float oy = -dot(uCoreAxis, oc), dy = dot(uCoreAxis, rd), hy = uCoreSlab + infl;
        if (abs(dy) > 1e-4) {
          float ta = (-hy - oy) / dy, tb = (hy - oy) / dy;
          a0 = max(a0, min(ta, tb)); a1 = min(a1, max(ta, tb));
        } else if (abs(oy) > hy) a1 = -1.0;
      }
      if (a1 > max(a0, 0.0) && !(leaving && ball && cb < 0.0 && co2 < rt * rt)) { t0 = min(t0, a0); t1 = max(t1, a1); }
    }
  }
  return vec2(max(t0, 0.0), t1);
}

// Sphere tracing over [tt.x, tt.y]. Returns t at first contact, or -1. The caller snaps the hit onto the
// surface along the analytic normal, which is what keeps a mirror free of stepping bands.
float gNear, gNearT;   // the closest the last march came to the surface, as an angle seen from the ray's origin, and where
float gEdge, gEdgeT;   // …and the closest it passed by something on its way to what it hit: the outline of a nearer limb
float march(vec3 ro, vec3 rd, vec2 tt, int steps, float minStep, float hitK){
  float t = tt.x;
  float d = 1e9, dp = 1e9, tp = t;
  gNear = 1e9; gNearT = t; gEdge = 1e9; gEdgeT = t;
  for (int i = 0; i < steps; i++) {
    d = map(ro + rd * t);
    if (d < hitK * max(t, 0.3)) return t;
    float q = d / max(t, 1e-3);
    if (q < gNear) { gNear = q; gNearT = t; }
    if (d > dp) { float qp = dp / max(tp, 1e-3); if (qp < gEdge) { gEdge = qp; gEdgeT = tp; } }
    dp = d; tp = t;
    t += max(d * (d > 0.035 ? FAR_SCALE : NEAR_SCALE), minStep);
    if (t > tt.y) return -1.0;
  }
  return d < 0.006 ? t : -1.0;     // ran out of steps right at the surface
}

// A cone instead of a ray: k = its half angle. Returns how far the whole cone is clear of the form (so any ray inside
// it may start there), or 1e9 when it never touches it.
float marchCone(vec3 ro, vec3 rd, vec2 tt, int steps, float k){
  float t = tt.x;
  for (int i = 0; i < steps; i++) {
    float d = map(ro + rd * t) - k * t;
    if (d < 0.002) return t;
    t += d * (d > 0.035 ? 0.9 : NEAR_SCALE);
    if (t > tt.y) return 1e9;
  }
  return t;
}
`;

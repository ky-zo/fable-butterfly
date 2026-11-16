// The body of the glass: what each kind of pane does to a ray on its way through.
//
// Every kind is described by the SLOPE of its surface (in wall space, dimensionless): a ray that crosses a face tilted
// by g is bent by about (n − 1)·g, so a point D metres behind the pane appears shifted by D·(n − 1)·g. That one rule
// gives all of it: a flute is a cylindrical lens (slope linear across it) that squeezes — and past its focal length
// mirrors — whatever is behind into a stripe; drawn glass has a slow wandering slope that makes the garden swim;
// hammered glass is a field of lenslets. And because the shift is proportional to D, a leaf that TOUCHES the pane is
// not moved at all: sharp contact shapes, striped garden. The fog sits on the inner face and is handled by the caller.
//
// Needs: tNoise, layout + pane chunks.

export const bodyGLSL = /* glsl */ `
struct Body {
  vec2 slope;     // surface slope in wall space (s, t)
  float curv;     // |d slope / d s| in 1/m where the relief is resolved: how hard the image is squeezed
  float smear;    // rms slope of relief too fine for this pixel: what is left of it is blur
  float rib;      // 0..1 on the cusp between two flutes
  float wire;     // 0..1 coverage of embedded wire
  float uu;       // position across the flute, -1..1
};

Body glassBody(int type, float param, vec2 st, float px, vec4 n1, vec4 n2){
  Body b = Body(vec2(0.0), 0.0, 0.0, 0.0, 0.0, 0.0);
  if (type == 1) {
    // reeded / fluted: convex cylinders, edge to edge
    float pitch = param;
    float u = fract(st.x / pitch) * 2.0 - 1.0;
    float fl = pitch / px;                                   // pixels per flute
    float res = smoothstep(2.0, 4.5, fl);
    float k = 0.5 + 0.34 * u * u;                            // a circular arc, steeper toward its edges
    b.slope.x = -u * k * res;
    b.curv = 2.0 * (0.5 + 1.02 * u * u) / pitch * res;
    b.smear = 0.34 * (1.0 - res);
    float aw = 1.6 / fl;
    b.rib = smoothstep(1.0 - 0.07 - aw, 1.0 - aw * 0.3, abs(u)) * res;
    b.uu = u;
    // the rolls that made it were never perfect: each flute leans a little
    b.slope.x += (hash12(vec2(floor(st.x / pitch), 7.0)) - 0.5) * 0.05 * res;
  } else if (type == 3) {
    // hammered: lenslets the size of a fingertip
    vec2 hp = st * 4.4;
    float cell = 1.0 / (16.0 * 4.4);
    float res = smoothstep(1.5, 4.0, cell / px);
    if (res > 0.0) {
      float e = 1.6 / 256.0;
      float a = texture2D(tNoise, hp).a;
      vec2 gr = vec2(texture2D(tNoise, hp + vec2(e, 0.0)).a, texture2D(tNoise, hp + vec2(0.0, e)).a) - a;
      b.slope = -gr * (16.0 / (e * 256.0)) * 0.16 * res * smoothstep(0.02, 0.12, a);
      b.curv = 30.0 * res;
    }
    b.smear = 0.2 * (1.0 - res);
  } else if (type == 7) {
    // float glass: flat
  } else {
    // sheet and drawn glass: the slow waves of the draw, and (close up) the fine cords that run with it
    float amp = type == 2 || type == 6 ? 1.0 : type == 4 ? 0.7 : 0.4;
    b.slope = vec2(n2.r - 0.5, n1.g - 0.5) * vec2(0.03, 0.008) * amp;
    if (px < 0.0026) b.slope.x += (texture2D(tNoise, vec2(st.x * 8.7, st.y * 0.045) + 0.53).g - 0.5) * 0.004 * amp * smoothstep(0.0026, 0.0012, px);
    b.curv = 0.6 * amp;
    if (type == 4) {
      // Georgian wired: a half-inch square mesh rolled into the sheet
      vec2 g = st / 0.0127 + 0.5;
      vec2 d = (0.5 - abs(fract(g) - 0.5)) * 0.0127;
      float w0 = 0.00042;
      float dm = min(d.x, d.y);
      b.wire = smoothstep(w0 + px * 0.8, w0 - px * 0.5, dm) * min(1.0, 2.6 * w0 / px + 0.1);
      // the glass puckers where it closed over the wire
      b.slope += normalize(vec2(d.x < d.y ? 1.0 : 0.0, d.x < d.y ? 0.0 : 1.0) + 1e-4) * smoothstep(0.003, 0.0006, dm) * 0.05 * smoothstep(0.002, 0.0006, px) * sign(fract(d.x < d.y ? g.x : g.y) - 0.5);
    }
  }
  return b;
}
`;

// What is ON the glass, on either face, and at its edges. Applied by the pane shader in the order light meets it.
export const dressApplyGLSL = /* glsl */ `
// distance (m) from a tape strip; x = across (signed), y = along (0..1), z = sd (negative inside)
vec3 tapeSD(vec2 st, vec4 seg, float hw){
  vec2 a = seg.xy, ab = seg.zw - seg.xy;
  float l = length(ab);
  vec2 t = ab / max(l, 1e-5);
  vec2 d = st - a;
  float along = dot(d, t), across = dot(d, vec2(-t.y, t.x));
  float sd = max(abs(across) - hw, max(-along, along - l));
  return vec3(across / hw, along / max(l, 1e-5), sd);
}
// Fine scratches. rel = this point of the pane relative to where the sun is seen through it (m).
float scratchFlare(vec2 rel, vec2 st, float px, float gate){
  float r = length(rel);
  float th = atan(rel.y, rel.x);
  // hairlines at a constant radius, each a short arc; two sets so that they cross
  float a = texture2D(tNoise, vec2(r * 83.0, th * 0.27 + r * 0.7)).g;
  float b = texture2D(tNoise, vec2(r * 51.0 + 0.4, th * 0.71 - r * 1.3) + st * 0.11).g;
  float line = smoothstep(0.87, 0.895, a) + smoothstep(0.885, 0.905, b) * 0.7;
  return line * smoothstep(0.45, 0.65, gate) * exp(-r * 5.0) * 0.2 * smoothstep(0.0022, 0.0006, px);
}
`;

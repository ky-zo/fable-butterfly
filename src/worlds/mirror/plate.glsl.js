// Mirror — the wings the liquid ends as, and the one texture they are cut from.
//
// A wing here is a film of mercury held in a plane: the plane the kit's rig holds that wing in (rig.js: wingFrame).
// A ray meets the plane analytically, and everything else is read from a small field baked once from the kit's own
// outline and veins (bakeWingField):
//
//   r   millimetres inside the margin (negative outside)
//   g   millimetres from the edge of the nearest vein (negative inside one); all the veins as one smooth minimum,
//       so that the corners where two veins meet are fillets and not creases
//   b   millimetres from the nearest scales (negative among them): the border at the width the kit gives it there
//       (wingData.js: borderAt), the white bar of the forewing, the dark band over the end of its cell
//   a   how much of the border nearest here is ember (borderAt's rust)
//
// From those numbers: where the film is (it runs out from the hinge, ahead along the veins; at the end it lets go
// wherever the finished wing will be clear, from the middle of each cell outward, and what is left is the glasswing
// itself in chrome: its veins, its border, its bar — metal where there will be scales, nothing where there will be glass),
// how thick it stands there (a film of liquid has a round rim; a vein is a ridge on it), and so its normal. The field
// is read through a cubic, so the normal is smooth at any magnification: a mirror shows every texel otherwise.

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { wingOutline, wingVeins, borderAt, BAR } from '../../shared/butterfly/index.js';

const SIZE = 512;
const PX = 16; // texels per millimetre
const RECT = [
  { x0: -1.5, y0: -9.0, row: 0, h: 224 }, // forewing
  { x0: -1.5, y0: -10.6, row: 224, h: 288 }, // hindwing
];

export const plateUniformsGLSL = /* glsl */ `
uniform vec4 uBf;             // how far the wings reach from their hinge (mm), half thickness (mm), -, how far the cells have opened 0..1
uniform vec4 uBfB;            // -, bound radius (world), world units per mm, there at all (0 | 1)
uniform vec3 uBfC;            // the thorax
uniform mat3 uBfRot;          // world → the body's frame
uniform vec3 uBfO[2];         // fore, hind: hinge (mm, right side) and the plate's two axes
uniform vec3 uBfAX[2];
uniform vec3 uBfAY[2];
`;

export const fieldGLSL = /* glsl */ `
#ifndef MR_FIELD
#define MR_FIELD
vec2 wfUV(vec2 p, float hind){
  return ((p - vec2(-1.5, mix(-9.0, -10.6, hind))) * ${PX}.0 + vec2(0.0, ${RECT[1].row}.0 * hind)) / ${SIZE}.0;
}
// (a smooth cubic through the field: four taps)
vec3 wfCubic(sampler2D tex, vec2 uv){
  vec2 st = uv * ${SIZE}.0 - 0.5;
  vec2 fi = floor(st), ff = st - fi;
  vec2 w0 = (1.0 - ff) * (1.0 - ff) * (1.0 - ff) / 6.0, w1 = (4.0 - 6.0 * ff * ff + 3.0 * ff * ff * ff) / 6.0;
  vec2 w3 = ff * ff * ff / 6.0, w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (fi - 0.5 + w1 / g0) / ${SIZE}.0, h1 = (fi + 1.5 + w3 / g1) / ${SIZE}.0;
  return (textureLod(tex, vec2(h0.x, h0.y), 0.0).rgb * g0.x + textureLod(tex, vec2(h1.x, h0.y), 0.0).rgb * g1.x) * g0.y
       + (textureLod(tex, vec2(h0.x, h1.y), 0.0).rgb * g0.x + textureLod(tex, vec2(h1.x, h1.y), 0.0).rgb * g1.x) * g1.y;
}
#endif
`;

export const plateGLSL = /* glsl */ `
${fieldGLSL}
float plSmin(float a, float b, float k){
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * h * k * (1.0 / 6.0);
}
// How far inside the film a point of a wing is (mm; negative: no liquid here). f = the field there.
float plFilm(vec2 xy, vec3 f){
  float r = length(xy);
  // it runs out from the hinge, and ahead along the veins: they are its channels
  float lead = 1.0 - smoothstep(-0.15, 1.5, f.g);
  float e = plSmin(f.r, uBf.x * (0.7 + 0.3 * lead) - r, 1.2);
  if (uBf.w > 0.0) {
    // the film lets go where the wing will be glass, from the middle of each cell outward: it stays on the veins and
    // wherever there will be scales (the border, the bar)
    float hold = mix(5.2, 0.24, uBf.w);
    e = plSmin(e, hold - plSmin(f.g, f.b + 0.14, 0.7), 0.45);
  }
  return e;
}
// How high the liquid stands over the plane (mm): a round rim, a flat film, the veins as ridges on it.
float plHeight(float e, vec3 f){
  float T = uBf.y;
  float x = 1.0 - clamp(e / T, 0.0, 1.0);
  return T * sqrt(max(1.0 - x * x, 0.0)) + 0.34 * (1.0 - smoothstep(-0.3, 0.55, f.g)) * smoothstep(0.0, 0.5, e);
}

// One wing. o, d: the ray in the body's frame (mm; d unit), already mirrored to the right side. hind: 0 | 1.
// pix: a pixel's angle. Returns the distance (mm) or -1; n = the normal in the body's frame, r = (how much of the pixel
// the film covers, mm from the hinge, how wide an angle of the room one pixel of it shows: a rim a third of a millimetre
// round shows half the room across a few pixels).
float plHit(vec3 o, vec3 d, int i, float pix, out vec3 n, out vec3 r){
  vec3 ax = uBfAX[i], ay = uBfAY[i];
  vec3 nz = cross(ax, ay);
  vec3 q = o - uBfO[i];
  float dz = dot(d, nz);
  n = nz; r = vec3(0.0);
  if (abs(dz) < 1e-4) return -1.0;
  float t = -dot(q, nz) / dz;
  if (t <= 0.0) return -1.0;
  vec3 h = q + d * t;
  vec2 xy = vec2(dot(h, ax), dot(h, ay));
  vec4 bnd = i == 0 ? vec4(-0.6, -8.2, 30.2, 4.6) : vec4(-0.6, -10.5, 20.7, 5.6);
  if (xy.x < bnd.x || xy.x > min(bnd.z, uBf.x + 0.5) || xy.y < bnd.y || xy.y > bnd.w) return -1.0;
  vec2 uv = wfUV(xy, float(i));
  // (one plain tap first: most of a wing's rectangle is not wing)
  vec3 f0 = textureLod(tWF, uv, 0.0).rgb;
  float px = t * pix / max(abs(dz), 0.12);
  if (plFilm(xy, f0) < -px - 0.2) return -1.0;
  const float E = 0.07;
  vec3 fc = wfCubic(tWF, uv);
  vec3 fx = wfCubic(tWF, uv + vec2(E * ${PX}.0 / ${SIZE}.0, 0.0));
  vec3 fy = wfCubic(tWF, uv + vec2(0.0, E * ${PX}.0 / ${SIZE}.0));
  float e = plFilm(xy, fc);
  float cov = clamp(e / px + 0.5, 0.0, 1.0);
  if (cov <= 0.0) return -1.0;
  float h0 = plHeight(e, fc);
  float hx = plHeight(plFilm(xy + vec2(E, 0.0), fx), fx);
  float hy = plHeight(plFilm(xy + vec2(0.0, E), fy), fy);
  vec2 g = clamp(vec2(hx - h0, hy - h0) / E, -4.0, 4.0);
  n = normalize(nz * (dz < 0.0 ? 1.0 : -1.0) - ax * g.x - ay * g.y);
  float rim = e < uBf.y ? 1.0 / uBf.y : 0.0;
  float ridge = 2.2 * smoothstep(-0.45, -0.1, fc.g) * smoothstep(0.7, 0.35, fc.g);
  r = vec3(cov, length(xy), 2.0 * px * max(rim, ridge));
  return t;
}
`;

const v2 = (p) => `vec2(${p[0].toFixed(3)}, ${p[1].toFixed(3)})`;
const BAKE = /* glsl */ `
precision highp float;
precision highp int;
varying vec2 vUv;
uniform sampler2D tData;      // row 0: a vein's pieces a.xy b.xy; row 1: radius at a, at b, which vein; row 2: the margin: xy, the border's width there, its rust
uniform vec4 uRect;           // mm: x0, y0, width, height
uniform ivec3 uCount;         // pieces of vein, points of the margin, first row
uniform float uHind;
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * h * k * (1.0 / 6.0); }
void main(){
  vec2 p = uRect.xy + vUv * uRect.zw;
  float dm = 1e9;
  vec2 bw = vec2(0.5, 0.0);
  bool inside = false;
  vec4 a = texelFetch(tData, ivec2(uCount.y - 1, uCount.z + 2), 0);
  for (int i = 0; i < uCount.y; i++) {
    vec4 b = texelFetch(tData, ivec2(i, uCount.z + 2), 0);
    vec2 e = b.xy - a.xy, w = p - a.xy;
    float h = clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    vec2 q = w - e * h;
    float d2 = dot(q, q);
    if (d2 < dm) { dm = d2; bw = mix(a.zw, b.zw, h); }
    if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    a = b;
  }
  dm = sqrt(dm) * (inside ? 1.0 : -1.0);
  // the nearest piece of each vein, then the veins together as one smooth minimum
  const float K = 0.3;
  float acc = 0.0, cur = 30.0, id = -1.0;
  for (int i = 0; i < uCount.x; i++) {
    vec4 s = texelFetch(tData, ivec2(i, uCount.z), 0);
    vec4 r = texelFetch(tData, ivec2(i, uCount.z + 1), 0);
    if (r.z != id) { if (id >= 0.0) acc += exp(-cur / K); cur = 30.0; id = r.z; }
    vec2 pa = p - s.xy, ba = s.zw - s.xy;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    cur = min(cur, length(pa - ba * h) - mix(r.x, r.y, h));
  }
  acc += exp(-cur / K);
  // where the scales will be: the border, and on the forewing the white bar and the band over the end of the cell
  // (the kit's own: wingMaterial.js, bfPigmentBand)
  float pig = dm - bw.x;
  if (uHind < 0.5) {
    vec2 ab = ${v2(BAR.b)} - ${v2(BAR.a)};
    float along = clamp(dot(p - ${v2(BAR.a)}, ab) / dot(ab, ab), 0.0, 1.0);
    float wdt = ${BAR.w.toFixed(3)} * (0.55 + 0.45 * smoothstep(0.0, 0.22, along)) * (1.0 - 0.8 * along * sqrt(along));
    pig = smin(pig, sdSeg(p, ${v2(BAR.a)}, ${v2(BAR.b)}) - wdt - 0.13, 0.25);
    float dc = min(sdSeg(p, ${v2(BAR.dc[0])}, ${v2(BAR.dc[1])}), sdSeg(p, ${v2(BAR.dc[1])}, ${v2(BAR.dc[2])})) * (1.0 + 0.5 * smoothstep(0.5, -2.8, p.y));
    pig = smin(pig, dc - ${BAR.dcw.toFixed(3)}, 0.25);
  }
  gl_FragColor = vec4(clamp(dm, -4.0, 12.0), min(-K * log(max(acc, 1e-36)), 12.0), clamp(pig, -4.0, 12.0), bw.y);
}`;

/**
 * Bake the field: one 512² float target, both wings, drawn on the GPU a strip at a time so that no frame of the world
 * that is on screen meanwhile has to wait for it.
 * @returns {Promise<THREE.Texture>}
 */
export async function bakeWingField(ctx) {
  const W = 512;
  const data = new Float32Array(W * 6 * 4);
  const counts = [];
  for (let hind = 0; hind < 2; hind++) {
    const base = hind * 3;
    let n = 0;
    wingVeins(hind, 5).forEach((v, id) => {
      const pts = v.points;
      for (let i = 0; i + 1 < pts.length && n < W; i++, n++) {
        const t0 = i / (pts.length - 1);
        const t1 = (i + 1) / (pts.length - 1);
        data.set([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]], (base * W + n) * 4);
        data.set([v.r0 + (v.r1 - v.r0) * t0, v.r0 + (v.r1 - v.r0) * t1, id, 0], ((base + 1) * W + n) * 4);
      }
    });
    const poly = wingOutline(hind, 160);
    poly.forEach((q, i) => {
      const [width, rust] = borderAt(hind, q[0], q[1]);
      data.set([q[0], q[1], width, rust], ((base + 2) * W + i) * 4);
    });
    counts.push([n, poly.length, base]);
  }
  const tex = new THREE.DataTexture(data, W, 6, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  const rt = ctx.createTarget({ size: [SIZE, SIZE], type: THREE.FloatType });
  const pass = new FSPass(BAKE, { tData: { value: tex }, uRect: { value: new THREE.Vector4() }, uCount: { value: new THREE.Vector3() }, uHind: { value: 0 } });
  await pass.compile(ctx.renderer);
  await ctx.yield();
  const STRIPS = 8;
  const prev = ctx.renderer.getRenderTarget();
  rt.scissorTest = true;
  for (let hind = 0; hind < 2; hind++) {
    const R = RECT[hind];
    for (let s = 0; s < STRIPS; s++) {
      const x = (s * SIZE) / STRIPS;
      const w = SIZE / STRIPS;
      rt.viewport.set(x, R.row, w, R.h);
      rt.scissor.set(x, R.row, w, R.h);
      pass.uniforms.uRect.value.set(R.x0 + x / PX, R.y0, w / PX, R.h / PX);
      pass.uniforms.uCount.value.set(counts[hind][0], counts[hind][1], counts[hind][2]);
      pass.uniforms.uHind.value = hind;
      pass.render(ctx.renderer, rt);
      await ctx.yield();
    }
  }
  rt.scissorTest = false;
  rt.viewport.set(0, 0, SIZE, SIZE);
  rt.scissor.set(0, 0, SIZE, SIZE);
  ctx.renderer.setRenderTarget(prev);
  pass.dispose();
  tex.dispose();
  return rt.texture;
}

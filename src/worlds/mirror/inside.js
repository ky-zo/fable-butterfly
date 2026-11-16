// Mirror — inside the chrysalis: the lens in there, the picture put together, and the one texture the liquid's wings
// are cut from.
//
//   placeInside()   where the lens stands inside, as a function of progress and nothing else
//   wall pass       the wall of the shell (shell.glsl.js) and the cells adrift in front of it, each out of focus by how
//                   far it is from what the lens is on: soft things, drawn at half size
//   compose pass    the picture, at full size. The liquid is traced here exactly (the small pass of march.js only says
//                   where to start), so its outline, its normal and what it mirrors are sharp at the size of the
//                   picture; its wings are plates met analytically (plate.glsl.js); body and wings are laid over the
//                   wall from the front — and, while the lens is going through the surface, the opening the outside
//                   is seen through

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { clamp } from '../../core/util.js';
import { hash } from '../../core/glsl.js';
import { shellGLSL } from './shell.glsl.js';
import { sdfUniformsGLSL, sdfGLSL } from './sdf.glsl.js';
import { plateUniformsGLSL, plateGLSL } from './plate.glsl.js';
import { POINTS } from './form.js';
import { mono } from './story.js';

export const NP = POINTS.length;

// [progress, lens, look-at, vertical field of view, how much an upright frame opens the lens and steps back]
const KEYS = [
  [0.28, [1.9, 0.3, 3.5], [0, 0.0, 0], 34, 0.6], // through the wall: a drop of metal in the middle of the room
  [0.33, [1.2, 0.22, 2.7], [0, 0.0, 0], 32, 0.7],
  [0.378, [-0.4, 0.55, 3.3], [0, 0.05, 0], 32, 0.7], // the knot
  [0.412, [-1.15, 0.25, 2.85], [0, 0.03, 0], 32, 0.8],
  [0.44, [-0.6, 0.0, 2.7], [0, 0.0, 0], 32, 1.0], // two halves
  [0.495, [0.55, 0.2, 3.0], [0, 0.05, 0], 33, 0.6], // four paddles
  [0.545, [0.35, 0.22, 3.5], [0, 0.14, 0], 34, 1.0], // wings
  [0.582, [-0.72, 0.42, 1.75], [-0.52, 0.34, 0.1], 32, 0.2], // macro along one: the film letting go between the veins
  [0.6, [-0.4, 0.36, 2.4], [-0.3, 0.26, 0.05], 33, 0.7],
  [0.64, [0.5, 0.2, 3.9], [0, 0.1, 0], 34, 0.9],
];
const camF = [];
for (let a = 1; a <= 2; a++) for (let c = 0; c < 3; c++) camF.push(mono(KEYS.map((k) => [k[0], k[a][c]]), 1));
const fovF = mono(KEYS.map((k) => [k[0], k[3]]), 1);
const openF = mono(KEYS.map((k) => [k[0], k[4]]), 1);
const _t = new THREE.Vector3();

/** Place the inside camera for progress p: no clock, no pointer. */
export function placeInside(camera, p, aspect) {
  p = clamp(p, KEYS[0][0], KEYS[KEYS.length - 1][0]);
  camera.position.set(camF[0](p), camF[1](p), camF[2](p));
  _t.set(camF[3](p), camF[4](p), camF[5](p));
  let fov = fovF(p);
  const tall = clamp((1.25 - aspect) / 0.7, 0, 1);
  const open = openF(p) * tall;
  if (open > 0) {
    // an upright frame: a wider lens, from a little further off
    fov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (1 + 0.75 * open)) * 180) / Math.PI;
    camera.position.sub(_t).multiplyScalar(1 + 0.5 * open).add(_t);
  }
  camera.up.set(0, 1, 0);
  camera.lookAt(_t);
  if (Math.abs(camera.fov - fov) > 1e-5 || camera.aspect !== aspect) {
    camera.fov = fov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
}

// the wall of the shell and what drifts in front of it: soft things, drawn at half size
const WALL = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uCamPos;
uniform mat3 uCamRot;
uniform vec2 uTan;
uniform vec4 uIn;              // how far inside 0..1, time, how soft the wall is drawn (radians), how far off the lens is focused
${hash}
${shellGLSL}
void main(){
  vec3 rd = uCamRot * normalize(vec3((vUv * 2.0 - 1.0) * uTan, -1.0));
  vec3 col = shellEnv(uCamPos, rd, uIn.z);
  // cells adrift in the fluid: four depths of them. One near where the lens is focused is a point; the others are
  // discs, larger and fainter the further they are from there
  float t = uIn.y, F = uIn.w;
  float sd = max(dot(rd, SH_SUN), 0.0);
  vec3 lit = uShWarm * (0.1 + 0.9 * sd * sd) + uShCool * 0.5;
  for (int k = 0; k < 4; k++) {
    float dk = 0.75 + 0.85 * float(k);
    float cs = 0.3 + 0.1 * float(k);
    vec3 P = uCamPos + rd * dk;
    vec3 id = floor(P / cs);
    vec3 h = hash33(id + float(k) * 17.0);
    if (h.z > 0.36) continue;
    vec3 c = (id + 0.27 + 0.46 * h + 0.07 * sin(t * (0.13 + 0.2 * h.yzx) + h * 6.283)) * cs;
    vec3 v = c - uCamPos;
    float tc = dot(v, rd);
    float d2 = dot(v, v) - tc * tc;
    float r0 = 0.0035 + 0.006 * h.x * h.x;
    float rad = min(r0 + 0.03 * abs(tc - F) / F, cs * 0.26);
    float x = d2 / (rad * rad);
    float disc = smoothstep(1.0, 0.72, x) * (0.75 + 0.55 * smoothstep(0.35, 0.95, x)) * smoothstep(cs * 0.5, cs * 0.2, abs(tc - dk));
    col += lit * disc * (r0 * r0 / (rad * rad)) * (0.5 + 2.2 * h.y);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const TIERS = [
  { steps0: 14, steps1: 0, maxl: 12 },
  { steps0: 18, steps1: 8, maxl: 16 },
  { steps0: 22, steps1: 10, maxl: 20 },
];

// The liquid: body and wings, premultiplied, coverage in alpha.
const LIQUID = (q) => /* glsl */ `
precision highp float;
precision highp int;
varying vec2 vUv;
#define STEPS0 ${q.steps0}
#define STEPS1 ${q.steps1}
#define MAXL ${q.maxl}
#define FAR_SCALE 0.97
#define NEAR_SCALE 0.9
#define NP ${NP}
uniform sampler2D tCone;
uniform vec4 uIn;              // -, time, -, whether the liquid is a shape that shows itself in itself
uniform vec3 uCamPos;
uniform mat3 uCamRot;          // camera → world
uniform vec2 uTan;             // tan(fov/2) * (aspect, 1)
uniform float uPixAngle;       // the angle one pixel of this pass subtends
uniform vec2 uConeRes;         // size of tCone, texels
uniform vec4 uPts[NP];         // the points that do not move: xyz, w = how bright
uniform vec4 uPtsB;            // a sphere round all of them
${hash}
${sdfUniformsGLSL}
${plateUniformsGLSL}
${shellGLSL}
${sdfGLSL}
${plateGLSL}

vec3 metalF(float c){
  const vec3 F0 = vec3(0.905, 0.9, 0.875);
  float x = 1.0 - c, x2 = x * x;
  return F0 + (1.0 - F0) * x2 * x2 * x;
}
const vec3 GOLD = vec3(1.0, 0.66, 0.24);

// a wing met by a ray that has left the liquid: flat is near enough for a picture of it in something else
bool seenWing(inout vec3 ro, inout vec3 rd, inout vec3 thr){
  vec3 ob = (uBfRot * (ro - uBfC)) / uBfB.z, db = uBfRot * rd;
  float best = 1e9;
  vec3 bn = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    int i = j >> 1;
    float sx = (j & 1) == 0 ? 1.0 : -1.0;
    vec3 nz = cross(uBfAX[i], uBfAY[i]);
    vec3 q = vec3(ob.x * sx, ob.yz) - uBfO[i], e = vec3(db.x * sx, db.yz);
    float dz = dot(e, nz);
    float t = -dot(q, nz) / (abs(dz) < 1e-4 ? 1e-4 : dz);
    if (t <= 0.4 || t >= best) continue;
    vec3 h = q + e * t;
    vec2 xy = vec2(dot(h, uBfAX[i]), dot(h, uBfAY[i]));
    if (xy.x < -0.6 || xy.x > min(30.2, uBf.x + 0.5) || abs(xy.y + 2.2) > 8.3) continue;
    if (plFilm(xy, textureLod(tWF, wfUV(xy, float(i)), 0.0).rgb) < 0.0) continue;
    best = t; bn = vec3(nz.x * sx, nz.yz) * (dz < 0.0 ? 1.0 : -1.0);
  }
  if (best > 1e8) return false;
  vec3 n = bn * uBfRot;
  ro += rd * best * uBfB.z + n * 0.004;
  thr *= metalF(clamp(-dot(rd, n), 0.0, 1.0)) * 0.9;
  rd = reflect(rd, n);
  return true;
}

void main(){
  vec3 rd = uCamRot * normalize(vec3((vUv * 2.0 - 1.0) * uTan, -1.0));
  vec3 ro = uCamPos;
  bool wings = uBfB.w > 0.5;
  if (wings) {
    vec3 ow = uBfC - ro;
    float bw = dot(ow, rd);
    wings = dot(ow, ow) - bw * bw < uBfB.y * uBfB.y;
  }
  // where the cones of the small pass say the body may be
  vec2 st = vUv * uConeRes - 0.5;
  ivec2 ci = ivec2(floor(st)), cm = ivec2(uConeRes) - 1, c0 = ivec2(0);
  float t0 = min(min(texelFetch(tCone, clamp(ci, c0, cm), 0).r, texelFetch(tCone, clamp(ci + ivec2(1, 0), c0, cm), 0).r),
                 min(texelFetch(tCone, clamp(ci + ivec2(0, 1), c0, cm), 0).r, texelFetch(tCone, clamp(ci + ivec2(1, 1), c0, cm), 0).r));
  if (t0 > 1e8 && !wings) { gl_FragColor = vec4(0.0); return; }

  // ---- the body. One walk to it from where the cones say it is safe to start; and if it is a ring or a knot, a second
  //      from there to wherever on itself it shows. (One loop, so that the walk exists once in this shader: a branch
  //      not taken is not free here.)
  float tB = 1e9, aB = 0.0, beta = uPixAngle * 0.5, foot = 0.0;
  vec3 oB = ro, dB = rd, thrB = vec3(1.0), emis = vec3(0.0);
  if (t0 < 1e8) {
    int nb = uIn.w > 0.5 ? 2 : 1;
    for (int b = 0; b < nb; b++) {
      vec2 tt = cull(oB, dB, b > 0);
      if (b == 0) tt.x = max(tt.x, t0 - 0.004);
      if (tt.x >= tt.y) break;
      float t = march(oB, dB, tt, b == 0 ? STEPS0 : STEPS1, b == 0 ? 0.0008 : 0.012, b == 0 ? 0.5 * uPixAngle : 0.003);
      bool graze = t < 0.0;
      if (b == 0) {
        // (a ray that just misses: the edge of the liquid covers part of this pixel)
        if (graze) { aB = clamp(1.5 - gNear / uPixAngle, 0.0, 1.0); t = gNearT; } else aB = 1.0;
        if (aB <= 0.0) break;
        tB = t;
      } else if (graze) break;
      vec3 p = oB + dB * t, n;
      float curv;
      float dd = mapG(p, n, curv);
      if (!graze) p -= n * dd;
      float cth = clamp(-dot(dB, n), 0.0, 1.0);
      foot += beta * t;
      beta += 2.0 * curv * foot / max(cth, 0.08);
      if (b == 0) {
        // where the liquid lies over one of the points, it shows through: gold under the skin
        vec3 vb = p - uPtsB.xyz;
        if (dot(vb, vb) < uPtsB.w * uPtsB.w) for (int i = 0; i < NP; i++) {
          vec3 v = p - uPts[i].xyz;
          float v2 = dot(v, v);
          if (v2 < 0.04) emis += GOLD * uPts[i].w * (4.0 * exp(-v2 / 0.0012) + 0.25 * exp(-v2 / 0.008));
        }
      }
      thrB *= metalF(cth);
      dB = reflect(dB, n);
      oB = p + n * 0.003;
    }
  }

  // ---- the wings: four plates
  float tP[5], aP[5], xP[5], sP[5];
  vec3 nP[5];
  for (int j = 0; j < 5; j++) { tP[j] = 1e9; aP[j] = 0.0; xP[j] = 0.0; sP[j] = 0.0; nP[j] = vec3(0.0); }
  tP[4] = tB; aP[4] = aB;
  if (wings) {
    vec3 ob = (uBfRot * (ro - uBfC)) / uBfB.z, db = uBfRot * rd;
    for (int j = 0; j < 4; j++) {
      float sx = (j & 1) == 0 ? 1.0 : -1.0;
      vec3 n, r;
      float t = plHit(vec3(ob.x * sx, ob.yz), vec3(db.x * sx, db.yz), j >> 1, uPixAngle, n, r);
      if (t > 0.0 && t * uBfB.z < tB) { tP[j] = t * uBfB.z; aP[j] = r.x; xP[j] = r.y; sP[j] = r.z; nP[j] = vec3(n.x * sx, n.yz) * uBfRot; }
    }
    // (what the body shows may be a wing)
    if (aB > 0.0) seenWing(oB, dB, thrB);
  }

  // ---- laid over one another from the front; each of them a mirror, shown the room
  vec3 col = vec3(0.0);
  float trans = 1.0;
  for (int k = 0; k < 5; k++) {
    int best = -1;
    float bt = 1e8;
    for (int j = 0; j < 5; j++) if (aP[j] > 0.0 && tP[j] < bt) { best = j; bt = tP[j]; }
    if (best < 0 || trans < 0.015) break;
    vec3 o2 = oB, r2 = dB, thr = thrB, add = emis;
    float bl = max(beta, 0.003), dim = 1.0;
    if (best < 4) {
      vec3 n = nP[best];
      float x2 = xP[best] * xP[best];
      thr = metalF(clamp(-dot(rd, n), 0.0, 1.0));
      r2 = reflect(rd, n);
      o2 = ro + rd * bt + n * 0.004;
      bl = 0.003 + uPixAngle + sP[best];
      // (against the body a wing sees mostly the body, and the point it grew from is under it there)
      dim = 1.0 - 0.5 * exp(-x2 / 16.0);
      add = GOLD * (0.9 * exp(-x2 / 1.6) + 0.07 * exp(-x2 / 24.0));
    }
    col += trans * aP[best] * (add + thr * dim * shellEnv(o2, r2, bl));
    trans *= 1.0 - aP[best];
    aP[best] = 0.0;
  }
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  gl_FragColor = vec4(min(max(col, 0.0), vec3(40.0)), 1.0 - trans);
}`;

// The picture put together at full size: the wall, the liquid over it, the points that never dissolved.
const COMPOSE = /* glsl */ `
precision highp float;
varying vec2 vUv;
#define NP ${NP}
uniform sampler2D tLiq, tWall, tExt, tShN;
uniform vec4 uIn;              // how far inside 0..1, time, aspect, -
uniform vec4 uLiqUV;           // the part of tLiq that was drawn this frame: scale, and the last texel inside it
uniform vec3 uCamPos;
uniform mat3 uCamRot;
uniform vec2 uTan;
uniform float uPixAngle;
uniform vec4 uPts[NP];
uniform vec4 uPtsB;
const vec3 GOLD = vec3(1.0, 0.66, 0.24);
void main(){
  vec4 liq = texture2D(tLiq, min(vUv * uLiqUV.xy, uLiqUV.zw));
  vec3 col = texture2D(tWall, vUv).rgb * (1.0 - liq.a) + liq.rgb;
  // the points themselves: small, steady, each with its halo (under the liquid they are in its own colour already)
  vec3 rd = uCamRot * normalize(vec3((vUv * 2.0 - 1.0) * uTan, -1.0));
  vec3 vb = uPtsB.xyz - uCamPos;
  float tb = dot(vb, rd);
  if (dot(vb, vb) - tb * tb < uPtsB.w * uPtsB.w) {
    vec3 glow = vec3(0.0);
    for (int i = 0; i < NP; i++) {
      vec3 v = uPts[i].xyz - uCamPos;
      float tc = dot(v, rd);
      float d2 = dot(v, v) - tc * tc;
      if (d2 < 0.05) {
        float s = 0.00016 + uPixAngle * uPixAngle * tc * tc;
        glow += GOLD * uPts[i].w * (14.0 * exp(-d2 / s) * (0.00016 / s) + 0.32 * exp(-d2 / 0.0011) + 0.03 * exp(-d2 / 0.01));
      }
    }
    col += glow * (1.0 - 0.8 * liq.a);
  }
  if (uIn.x < 0.999) {
    // going through the surface: it opens from the middle, and the lip of the opening catches the light
    vec2 q = (vUv - 0.5) * vec2(uIn.z, 1.0);
    float r = length(q);
    float n = textureLod(tShN, vUv * vec2(uIn.z, 1.0) * 0.35 + uIn.y * 0.01, 0.0).r;
    float edge = uIn.x * (0.62 + 0.55 * max(uIn.z, 1.0 / uIn.z)) - 0.1;
    float m = smoothstep(edge, edge - 0.09, r + (n - 0.5) * 0.3);
    float lip = 4.0 * m * (1.0 - m);
    vec3 ext = texture2D(tExt, vUv - normalize(q + 1e-5) * lip * 0.025).rgb;
    col = mix(ext, col, m) + (ext * 0.6 + vec3(0.5, 0.48, 0.42)) * lip * lip * 0.55;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function createWallPass(shared) {
  return new FSPass(WALL, {
    uCamPos: { value: new THREE.Vector3() },
    uCamRot: { value: new THREE.Matrix3() },
    uTan: { value: new THREE.Vector2(1, 1) },
    uIn: { value: new THREE.Vector4(1, 0, 0.02, 3) },
    uShWarm: shared.uShWarm,
    uShCool: shared.uShCool,
    tShN: shared.tShN,
    tWF: shared.tWF,
  });
}
const camUniforms = () => ({
  uCamPos: { value: new THREE.Vector3() },
  uCamRot: { value: new THREE.Matrix3() },
  uTan: { value: new THREE.Vector2(1, 1) },
  uPixAngle: { value: 0.001 },
});
/** @returns the two passes; they share the points (uPts, uPtsB) by reference */
export function createLiquidPasses(level, shared) {
  const pts = { value: POINTS.map((p) => new THREE.Vector4(p.x, p.y, p.z, 1)) };
  const c = new THREE.Vector3();
  for (const p of POINTS) c.add(p);
  c.multiplyScalar(1 / POINTS.length);
  let r = 0;
  for (const p of POINTS) r = Math.max(r, p.distanceTo(c));
  const ptsB = { value: new THREE.Vector4(c.x, c.y, c.z, r + 0.24) };
  const liquid = new FSPass(LIQUID(TIERS[level] ?? TIERS[2]), {
    tCone: { value: null },
    uIn: { value: new THREE.Vector4(1, 0, 1, 0) },
    uConeRes: { value: new THREE.Vector2(1, 1) },
    uPts: pts,
    uPtsB: ptsB,
    ...camUniforms(),
    ...shared,
  });
  const compose = new FSPass(COMPOSE, {
    tLiq: { value: null },
    tWall: { value: null },
    tExt: { value: null },
    tShN: shared.tShN,
    uIn: { value: new THREE.Vector4(1, 0, 1, 0) },
    uLiqUV: { value: new THREE.Vector4(1, 1, 1, 1) },
    uPts: pts,
    uPtsB: ptsB,
    ...camUniforms(),
  });
  return { liquid, compose };
}

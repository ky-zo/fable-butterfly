// The simulation: position and velocity of every point in two float textures, advanced by one fullscreen pass.
//
// Where a point WANTS to be is a pure function of progress (and a little of time): its place in the thing its region
// condenses into, or its place in the loose cloud that region is when the animal is not near. So scrolling backwards
// or jumping always lands in a sensible state. How it GETS there is physics: a spring to that target, drag against a
// slow divergence-free current, the wake of the butterfly's wings, the ring that runs out from where its feet touch,
// and the visitor's hand. While a point is in flight the spring goes slack and the current shows, so a region does
// not fade into a thing: it comes in like a tide, from the first part grown to the last.
//
// Four populations, by row:
//   forms   one band per region (config.js: layout)          plume   scent: broken filaments streaming downwind
//   dust    near motes, in a box that travels with the lens    web     the far field

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { NS, ST, STATIONS } from './config.js';
import { FLOW_GLSL } from './flow.js';
import { AXIS_N } from './targets.js';

export const HASH42 = /* glsl */ `
vec4 hash42(vec2 p){
  vec4 p4 = fract(vec4(p.xyxy) * vec4(.1031, .1030, .0973, .1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}`;

/** The ring that runs out from where it stands: shared by the simulation (a push) and the renderer (light). */
export const TOUCH_GLSL = /* glsl */ `
uniform vec4 uTouch[2];      // where its feet are (xyz), how far the ring runs (w)
uniform vec4 uTouchK[2];     // phase 0..1, strength, width of the ring, how much light it carries
uniform vec4 uTouchN[2];     // what it stands on: the normal of it (xyz); the ring runs only through a slab of it this thick (w; 0 = through everything)
uniform vec4 uTouchS[2];     // how far out (of its run, 0..1) the ring has come before it is at full strength; how hard it pushes what it passes
float touchWave(vec3 p, out vec3 dir){
  float w = 0.0;
  dir = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    if (uTouchK[k].y <= 0.0) continue;
    vec3 q = p - uTouch[k].xyz;
    float d = length(q);
    if (d > uTouch[k].w * 1.2) continue;
    float slab = 1.0;
    if (uTouchN[k].w > 0.0) {
      // a ring in the surface, not a shell in the air: what stands up out of the surface is left alone
      slab = 1.0 - smoothstep(0.6 * uTouchN[k].w, uTouchN[k].w, abs(dot(q, uTouchN[k].xyz)));
      if (slab <= 0.0) continue;
    }
    for (int m = 0; m < 2; m++) {
      float ph = fract(uTouchK[k].x + 0.5 * float(m));
      float x = (d - ph * uTouch[k].w) / uTouchK[k].z;
      float a = exp(-x * x) * (1.0 - ph) * (1.0 - ph) * uTouchK[k].y * slab * smoothstep(0.0, uTouchS[k].x + 1e-4, ph);
      w += a;
      dir += q / (d + 1e-3) * (a * uTouchS[k].y);
    }
  }
  return w;
}`;

const SIM_FRAG = /* glsl */ `
precision highp float;
precision highp int;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
#define NS ${NS}
#define PI 3.14159265
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform sampler2D tHome;
uniform sampler2D tForm;
uniform sampler2D tAxis;
${FLOW_GLSL}
uniform float uTime, uDt, uWarp;
uniform vec3 uCenter[NS];
uniform mat3 uFrame[NS];
uniform vec4 uSway[NS];      // amplitude, frequency, pivot height, twist
uniform vec4 uLoose[NS];     // the region as a loose cloud: scale, scatter, how flat the scatter is, brightness
uniform float uCond[NS];     // 0 loose … 1 the thing
uniform int uStart[NS];      // first row of each region
uniform ivec4 uRows;         // forms, plume, dust, web
uniform vec3 uBoxCenter;
uniform float uBoxSize;
uniform vec3 uRayO, uRayD, uRayV;
uniform vec4 uHand;          // cone radius per unit depth, parting push, coupling to the hand's motion, release
uniform vec4 uWake;          // the butterfly: where (xyz), how far its wings reach (w)
uniform vec4 uWakeV;         // its velocity (xyz), the push of the stroke (w)
uniform vec4 uPhys;          // K_HOLD, K_FLY, FLOW_HOLD, FLOW_FLY
uniform float uDrag;
uniform mat3 uEyeRot;        // the eye turns to follow
uniform vec4 uMoon;          // centre of the disc in its region's frame, how far it has swollen
uniform vec4 uPlume;         // speed downwind, width, -, brightness
${TOUCH_GLSL}
${HASH42}

struct Tgt { vec3 p; float fly; float bright; float pal; float tint; float sat; float k; float flow; };

float ease5(float t){ return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

vec3 sway(int i, vec3 p){
  vec4 sw = uSway[i];
  if (sw.x != 0.0) {
    float h = max(p.y - sw.z, 0.0) * 0.25;
    float ph = uTime * sw.y + p.y * 0.7 + p.x * sw.w;
    p.x += sw.x * h * h * sin(ph);
    p.z += sw.x * h * h * 0.7 * cos(ph * 0.83 + 1.3);
  }
  return p;
}

Tgt formPoint(ivec2 tc, vec4 rnd, vec4 rnd2){
  Tgt T;
  int i = 0;
  for (int k = 1; k < NS; k++) if (tc.y >= uStart[k]) i = k;
  vec4 f = texelFetch(tForm, tc, 0);
  int w = int(f.w + 0.5);
  int sub = w >> 22;
  float order = float((w >> 15) & 127) / 127.0;
  float tint = float((w >> 8) & 127) / 127.0;
  float bright = exp2(float(w & 255) / 255.0 * 8.0 - 6.0);
  vec3 l = f.xyz;
  float c = uCond[i];
  vec4 lo = uLoose[i];
  if (i == ${ST.COLD} && sub == 1) {
    // the disc is always whole; it only swells
    l = uMoon.xyz + (l - uMoon.xyz) * uMoon.w;
    c = 1.0;
  }
  vec3 lf = l;
  // the eye, and the face round it, turn to follow (the two loose feathers in front of it do not)
  if (i == ${ST.EYE} && l.z < 2.0) lf = uEyeRot * l;
  vec3 formed = uCenter[i] + uFrame[i] * sway(i, lf);

  float d = 0.84 * order + 0.16 * rnd.x;
  float t = clamp((c - d * 0.68) / 0.32, 0.0, 1.0);
  float e = ease5(t);
  // loose: the same points, further apart, scattered, and wound a little round the region's upright
  // (peaked in the middle with long thin tails: a nebula, not a ball)
  vec3 sc = vec3(rnd2.x, rnd2.y, rnd2.w) - 0.5;
  sc *= (0.35 + 6.0 * dot(sc, sc)) * lo.y;
  sc.y *= lo.z;
  vec3 ll = l * lo.x + sc;
  float ang = (1.0 - e) * (0.5 + 1.2 * rnd.y);
  float ca = cos(ang), sa = sin(ang);
  ll.xz = mat2(ca, -sa, sa, ca) * ll.xz;
  vec3 loose = uCenter[i] + uFrame[i] * ll;

  T.p = mix(loose, formed, e);
  T.fly = sin(PI * t);
  T.bright = bright * mix(lo.w, 1.0, e);
  T.pal = float(i * 4 + sub);
  T.tint = tint;
  T.sat = mix(0.35, 1.0, e);
  T.k = mix(0.045, 1.0, e);
  T.flow = mix(3.2, 1.0, e);
  return T;
}

// Scent does not arrive as a smooth cloud. It comes as filaments, torn into packets by the wind, with clean air
// between them; an insect flying upwind is flying from packet to packet.
vec3 plumeAt(float q, float e, float sid, vec4 h){
  float x = e * float(${AXIS_N - 1});
  int i0 = int(floor(x));
  vec3 a = mix(texelFetch(tAxis, ivec2(i0, 0), 0).xyz, texelFetch(tAxis, ivec2(min(i0 + 1, ${AXIS_N - 1}), 0), 0).xyz, fract(x));
  // the plume widens as it goes; a filament keeps its own place in it and meanders (periodic in q, so it has no seam)
  float rad = uPlume.y * (0.07 + pow(e, 0.8));
  vec3 off = (h.xzw - 0.5) * 1.1 + flowTex(vec3(q * 3.0, sid * 0.173, 0.37)) * 0.75 + flowTex(vec3(q * 9.0 + 0.3, sid * 0.31, uTime * 0.013)) * 0.3;
  return a + off * rad;
}
vec3 plumePoint(ivec2 tc, vec4 rnd, vec4 rnd2, out float bright, out float tint, out vec3 along){
  float sid = floor(pow(rnd.w, 1.3) * 20.0);
  vec4 h = hash42(vec2(sid + 0.5, 91.5));
  float q = rnd.x;                                        // which parcel of its filament this point is
  float e = fract(q + uTime * uPlume.x * (0.7 + 0.6 * h.y)); // 0 at the flower … 1 far downwind
  vec3 p = plumeAt(q, e, sid, h);
  along = normalize(plumeAt(q + 0.004, min(e + 0.004, 1.0), sid, h) - p + 1e-5);
  // packets and the gaps between them
  float gate = smoothstep(0.0, 0.5, flowTex(vec3(q * 6.0, sid * 0.37, 0.71)).x) * smoothstep(-0.7, 0.1, flowTex(vec3(q * 19.0, sid * 0.53, 0.2)).y);
  // inside a packet the points keep to the line; a few have strayed
  float j = (0.008 + 0.5 * pow(rnd2.y, 7.0)) * (1.0 + 2.5 * e);
  p += (vec3(rnd2.x, rnd2.z, rnd2.w) - 0.5) * j;
  bright = uPlume.w * (0.02 + gate) * smoothstep(0.0, 0.04, e) * (1.0 - smoothstep(0.7, 1.0, e)) * (0.45 + rnd.y);
  tint = h.z;
  return p;
}

vec3 current(vec3 p){
  return flowTex(p * 0.043 + uTime * vec3(0.0051, 0.0036, -0.0043)) + 0.3 * flowTex(p * 0.127 - uTime * vec3(0.0083, -0.0061, 0.0072) + 0.37);
}

void main(){
  ivec2 tc = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(tPos, tc, 0);
  vec4 V = texelFetch(tVel, tc, 0);
  vec3 pos = P.xyz, vel = V.xyz;
  vec4 rnd = hash42(vec2(tc) + 0.5);
  vec4 rnd2 = hash42(vec2(tc.yx) + 113.5);
  int plume0 = uRows.x;
  int dust0 = plume0 + uRows.y;
  int web0 = dust0 + uRows.z;

  Tgt T;
  float drag = uDrag;
  bool form = tc.y < plume0;
  if (form) T = formPoint(tc, rnd, rnd2);
  else if (tc.y < dust0) {
    // scent keeps no state: it is where the wind has it
    float b, tn;
    vec3 al;
    vec3 p = plumePoint(tc, rnd, rnd2, b, tn, al);
    oPos = vec4(p, b);
    oVel = vec4(al, 22.0 * 4096.0 + floor(tn * 63.0 + 0.5) * 64.0 + 50.0);
    return;
  } else if (tc.y < web0) {
    vec4 h = texelFetch(tHome, ivec2(tc.x, tc.y - dust0), 0);
    vec3 home = h.xyz * uBoxSize;
    if (uWarp > 0.5) pos = home;
    pos += uBoxSize * floor((uBoxCenter - pos) / uBoxSize + 0.5);
    home += uBoxSize * floor((pos - home) / uBoxSize + 0.5);
    // motes ride the current on a very long leash
    T.p = home; T.fly = 0.0; T.bright = floor(h.w) / 16.0; T.pal = 20.0; T.tint = fract(h.w) / 0.99; T.sat = 0.7; T.k = 0.0056; T.flow = 3.8;
    drag *= 0.5;
  } else {
    vec4 h = texelFetch(tHome, ivec2(tc.x, tc.y - dust0), 0);
    // the web only breathes: it must still be a web an hour from now
    T.p = h.xyz; T.fly = 0.0; T.bright = floor(h.w) / 16.0; T.pal = 21.0; T.tint = fract(h.w) / 0.99; T.sat = 0.8; T.k = 0.018; T.flow = 0.6;
  }

  float k = mix(uPhys.x, uPhys.y, T.fly) * T.k;
  float fl = mix(uPhys.z, uPhys.w, T.fly) * T.flow;

  if (uWarp > 0.5) {
    // a jump in progress: land where the point would have come to rest, already carried a little by the current
    pos = T.p + current(T.p) * min(fl * drag / k, 2.5);
    vel = vec3(0.0);
  } else {
    float dt = uDt;
    // the hand: not a force field but a moving body. Where it is, a point lets go of its place (the spring goes
    // slack and the air churns); smoke in its path is carried along, smoke beside it is swept back around (a
    // divergence-free dipole), and when the hand has passed the springs swirl everything home.
    vec3 q = pos - uRayO;
    float tt = dot(q, uRayD);
    vec3 pp = q - tt * uRayD;
    float R = uHand.x * max(tt, 1.0);
    float g = exp(-dot(pp, pp) / (R * R)) * smoothstep(0.4, 2.5, tt);
    float slack = g * uHand.w;
    vec3 churn = vec3(0.0);
    if (slack > 0.002) churn = (flowTex(pos * 0.42 + uTime * vec3(0.031, -0.023, 0.027)) + 0.6 * flowTex(pos * 1.1 - uTime * vec3(0.05, 0.04, -0.045))) * (1.5 * slack);
    vec3 acc = (T.p - pos) * (k * (1.0 - slack)) + (churn + current(pos) * fl - vel) * drag;
    vec3 U = uRayV * tt;
    vec3 vh = U + (2.0 / (R * R)) * dot(cross(U, pp), uRayD) * cross(uRayD, pp);
    acc += (vh - vel) * g * uHand.z;
    acc += pp / (length(pp) + 1e-4) * g * uHand.y;
    // the butterfly: what is near its wings is carried along with it and thrown out on each downstroke
    vec3 qw = pos - uWake.xyz;
    float gw = exp(-dot(qw, qw) / (uWake.w * uWake.w));
    if (gw > 0.002) acc += (uWakeV.xyz * 0.6 - vel) * gw * 5.0 + qw / (length(qw) + 1e-3) * gw * uWakeV.w;
    // …and where its feet are down, a ring runs out through whatever it is standing on
    if (form) {
      vec3 dir;
      float tw = touchWave(pos, dir);
      acc += dir;
    }
    vel += acc * dt;
    pos += vel * dt;
  }
  oPos = vec4(pos, T.bright);
  oVel = vec4(vel, T.pal * 4096.0 + floor(T.tint * 63.0 + 0.5) * 64.0 + floor(T.sat * 63.0 + 0.5));
}
`;

export class Sim {
  constructor(ctx, L, tex) {
    this.ctx = ctx;
    this.L = L;
    const mk = () => ctx.createTarget({ size: [L.W, L.H], type: THREE.FloatType, filter: THREE.NearestFilter, count: 2 });
    this.rt = [mk(), mk()];
    this.cur = 0;
    const v4 = (n) => Array.from({ length: n }, () => new THREE.Vector4(0, 0, 0, 0));
    this.uniforms = {
      tPos: { value: null },
      tVel: { value: null },
      tHome: { value: tex.home },
      tForm: { value: tex.forms },
      tAxis: { value: tex.axis },
      tFlow: { value: tex.flow },
      uTime: { value: 0 },
      uDt: { value: 0 },
      uWarp: { value: 1 },
      uCenter: { value: STATIONS.map((s) => s.c.clone()) },
      uFrame: { value: STATIONS.map((s) => s.m.clone()) },
      uSway: { value: STATIONS.map((s) => new THREE.Vector4(...s.sway)) },
      uLoose: { value: STATIONS.map((s, i) => new THREE.Vector4(s.loose[0], s.loose[1], i === ST.COLD ? 0.12 : i === ST.PANE ? 0.7 : 0.75, i === ST.COLD ? 0.2 : 0.11)) },
      uCond: { value: new Array(NS).fill(0) },
      uStart: { value: L.start.slice() },
      uRows: { value: new THREE.Vector4(L.Hf, L.Hp, L.Hd, L.Hw) },
      uBoxCenter: { value: new THREE.Vector3() },
      uBoxSize: { value: 64 },
      uRayO: { value: new THREE.Vector3() },
      uRayD: { value: new THREE.Vector3(0, 0, -1) },
      uRayV: { value: new THREE.Vector3() },
      uHand: { value: new THREE.Vector4(0.06, 0, 0, 0) },
      uWake: { value: new THREE.Vector4(0, 0, 0, 1) },
      uWakeV: { value: new THREE.Vector4(0, 0, 0, 0) },
      uPhys: { value: new THREE.Vector4(34, 6, 0.17, 0.8) },
      uDrag: { value: 6.0 },
      uEyeRot: { value: new THREE.Matrix3() },
      uMoon: { value: new THREE.Vector4(0, 0, 0, 1) },
      uPlume: { value: new THREE.Vector4(0.012, 3.0, 0, 0) },
      uTouch: { value: v4(2) },
      uTouchK: { value: v4(2) },
      uTouchN: { value: v4(2) },
      uTouchS: { value: v4(2) },
    };
    this.pass = new FSPass(SIM_FRAG, this.uniforms, { glslVersion: THREE.GLSL3 });
  }

  get pos() {
    return this.rt[this.cur].textures[0];
  }
  get vel() {
    return this.rt[this.cur].textures[1];
  }

  /** Advance by dt seconds (0 is fine). `warp` snaps every point to where it belongs right now. */
  step(dt, warp) {
    const u = this.uniforms;
    if (dt <= 0 && !warp) return;
    // split long frames so the stiff springs stay stable
    const n = warp ? 1 : dt > 0.026 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const src = this.rt[this.cur];
      const dst = this.rt[1 - this.cur];
      u.tPos.value = src.textures[0];
      u.tVel.value = src.textures[1];
      u.uDt.value = dt / n;
      u.uWarp.value = warp ? 1 : 0;
      this.pass.render(this.ctx.renderer, dst);
      this.cur = 1 - this.cur;
    }
  }

  dispose() {
    this.pass.dispose();
  }
}

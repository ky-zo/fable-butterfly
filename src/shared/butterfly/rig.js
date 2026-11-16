// RIG · how a butterfly is held. One pose model, the same on the CPU (wingPoint, bodyPoint) and in any vertex shader
// (rigGLSL, plus the two ready-made preambles wingVertexGLSL / bodyVertexGLSL).
//
// Frames
//   wing frame   millimetres, flat: origin at the hinge, +x out along the wing, +y toward the leading edge (wingData.js)
//   body frame   millimetres: +X right, +Y toward the head, +Z out of the back; origin in the middle of the thorax
//   world        whatever the world uses: Glasswing.place() / Flock.set() put the body frame there, 0.001 × size per mm
//
// The pose (makePose) — every number, its range, what it does:
//   wings.x  fore    stroke angle of the forewings, radians above the body's plane. 0 = spread flat, 1.56 = shut over
//                    the back (the resting "fold"), -0.5 = bottom of the downstroke
//   wings.y  hind    the same for the hindwings; in flight it follows the forewing by about a tenth of a beat
//   wings.z  twist   feathering about the wing's own axis, rad (-0.3 … 0.3): with the stroke, the tip draws a figure of eight
//   wings.w  flex    bend along the span, as a fraction of the wing's length (-0.25 … 0.25): the tip trails the root,
//                    and the membrane behind the leading edge trails with it (the wing cups)
//   shape.x  unfurl  1 = the finished flat wing. 0 = as it leaves the chrysalis: a third of its length, pleated like a
//                    fan, limp. Between, it is pumped flat from the base outward. (wings need ≥ 12 rings to show it)
//   shape.y  sweep   0 … 1 the forewing drawn back over the hindwing (a sleeping butterfly; 0 = set like a specimen)
//   limbs.x  legs    0 standing … 1 folded against the body (flight)
//   limbs.y  droop   abdomen hung down, 0 … 1 (≈ 0.1 at rest, 0.2–0.4 in flight; it counters the stroke)
//   limbs.z  sweep   antennae swept back, 0 … 1
//   limbs.w  breath  0 … 1 the abdomen swelling
//   twitch.x, .y     right, left antenna flicked up (-0.3 … 0.3)
//   feet[0..3]       millimetres each foot is moved from where it stands (body frame): mid right, mid left, hind right,
//                    hind left. The leg shears from the hip to follow. See Feet in motion.js.
// Body pitch and roll are not in the pose: they are the body frame itself (see flightBasis in motion.js).

import * as THREE from 'three';

export const SIG_F = 1.2; // how far the forewing's axis is swept from the head, radians
export const SIG_H = 1.7;
/** Where each wing is hinged to the thorax, body frame (mm), right side. */
export const HINGE_F = [1.35, 0.9, 1.05];
export const HINGE_H = [1.25, -0.5, 0.95];
/** How far below the middle of the thorax the feet stand (mm). */
export const STAND = 4.0;
/** Length of a wing along its axis (mm): fore, hind. */
export const SPAN_F = 29.5;
export const SPAN_H = 20.0;

const f3 = (x) => Number(x).toFixed(3);
const v3 = (a) => `vec3(${a.map(f3).join(', ')})`;

/** Pure functions, no uniforms: include in any shader. (Include-guarded.) */
export const rigGLSL = /* glsl */ `
#ifndef BF_RIG
#define BF_RIG
// A point of the flat wing (mm) → the same point of the wing as it is held, still in the wing's own frame.
//   wing = (side ±1, hind 0|1)   pose = (fore, hind, twist, flex)   shape = (unfurl, sweep, -, -)
vec3 bfWingLocal(vec2 p, vec2 wing, vec4 pose, vec4 shape){
  float L = mix(${f3(SPAN_F)}, ${f3(SPAN_H)}, wing.y);
  float z = 0.0;
  float wet = 1.0 - clamp(shape.x, 0.0, 1.0);
  if (wet > 0.0) {
    // fresh out of the chrysalis: a third of its size, and pumped flat from the base outward
    float s0 = clamp(p.x / L, 0.0, 1.2);
    float e = smoothstep(0.0, 0.85, (1.0 - wet) * 1.45 - 0.5 * s0);
    float w = 1.0 - e;
    p *= mix(0.34, 1.0, e * e * (3.0 - 2.0 * e) * 0.6 + 0.4 * (1.0 - wet));
    // pleats across the span like a fan that has not been opened, finer ones along it; and it hangs
    float fan = atan(p.y, p.x + 2.0);
    z += w * (0.9 * sin(fan * 34.0 + wing.y * 2.0) + 0.5 * sin(p.x * 2.3 + p.y * 1.1) * sin(fan * 13.0)) * (0.25 + 0.75 * s0);
    p.y *= 1.0 - 0.28 * w * s0;
    p.y += w * 0.5 * sin(p.x * 1.7 + wing.y * 3.0) * s0;
    z -= w * L * 0.22 * s0 * s0;
  }
  // the wing bends: flex along the span, a shallow dome, a droop toward the edges; then it feathers about its own axis
  float xs = clamp(p.x / L, 0.0, 1.2);
  z += pose.w * L * xs * xs;
  // (and the membrane behind the stiff leading edge trails with it: a beating wing is cupped, never a flat plate)
  float tr = clamp(4.0 - p.y, 0.0, 14.0);
  z += pose.w * 0.075 * tr * tr * (0.35 + 0.65 * min(xs, 1.0));
  z += 0.5 * sin(min(xs, 1.0) * 3.1416);
  z -= 0.011 * p.y * p.y * xs;
  z -= wing.y * 0.16;                                   // the hindwing lies under the forewing
  float psi = pose.z * (0.35 + 0.65 * xs);
  float c = cos(psi), s = sin(psi);
  return vec3(p.x, p.y * c - z * s, p.y * s + z * c);
}
// …→ the body frame (mm): swept on its hinge, raised by the stroke, mirrored for the left side
vec3 bfWingBody(vec3 q, vec2 wing, vec4 pose, vec4 shape){
  float sg = mix(${f3(SIG_F)} + 0.42 * shape.y, ${f3(SIG_H)} + 0.1 * shape.y, wing.y);
  float phi = mix(pose.x, pose.y, wing.y);
  vec3 b = vec3(sin(sg) * q.x - cos(sg) * q.y, cos(sg) * q.x + sin(sg) * q.y, q.z);
  float c = cos(phi), s = sin(phi);
  b = vec3(b.x * c - b.z * s, b.y, b.x * s + b.z * c);
  b += mix(${v3(HINGE_F)}, ${v3(HINGE_H)}, wing.y);
  b.x *= wing.x;
  return b;
}
// A vertex of the body (bodyGeo.js) as it is held. p, alt = position standing / legs folded; n = normal;
//   part = aPart (which part, along, around, which leg)   limbs, twitch: see the pose   feet: mm each foot is moved
vec3 bfBodyLocal(vec3 p, vec3 alt, vec3 n, vec4 part, vec4 limbs, vec4 twitch, vec3 feet[4]){
  p = mix(p, alt, limbs.x);
  float id = part.x, u = part.y;
  if (id > 0.5 && id < 1.5) {
    p.z -= limbs.y * u * u * 3.2;
    p += n * 0.045 * limbs.w * sin(min(u * 1.6, 1.0) * 3.1416);
  } else if (id > 5.5 && id < 6.5) {
    float t = part.w > 10.5 ? twitch.y : twitch.x;
    float k = u * u;
    p.z += k * (t * 2.4 - limbs.z * 2.2);
    p.y -= k * limbs.z * 5.5;
    p.x += k * t * 0.9 * sign(p.x);
  } else if (id > 6.5 && part.w > -0.5 && part.w < 3.5) {
    // a leg (or its claws) follows its foot: nothing at the hip, everything from the heel down
    float k = id > 7.5 ? 1.0 : smoothstep(0.08, 0.72, u);
    p += feet[int(part.w + 0.5)] * k * (1.0 - limbs.x);
  }
  return p;
}
#endif
`;

/**
 * Vertex preamble for anything drawn on the kit's WING geometry. Declares the attributes and the pose (uniforms, or
 * per-instance attributes aPose / aLook under InstancedMesh, where shape is the finished wing) and gives:
 *   mat4 bfModel()                                    modelMatrix (× instanceMatrix)
 *   vec3 bfWing(vec2 p)                               wing-frame point (mm) → body frame (mm)
 *   void bfWingFrame(out vec3 b, out vec3 tx, out vec3 ty)   this vertex in the body frame, and the two tangents of
 *                                                     the bent sheet there (normal = cross(tx, ty)); not normalised
 *   BF_LOOK                                           vec4 (species, landed, seed, wear)
 */
export const wingVertexGLSL = /* glsl */ `
attribute vec3 aEdge;      // mm inside the margin, width of the border (mm), rust
attribute vec2 aWing;      // side (+1 right, -1 left), hind (0 | 1)
#ifdef USE_INSTANCING
attribute vec4 aPose;
attribute vec4 aLook;
#define BF_POSE aPose
#define BF_SHAPE vec4(1.0, 0.0, 0.0, 0.0)
#define BF_LOOK aLook
mat4 bfModel(){ return modelMatrix * instanceMatrix; }
#else
uniform vec4 uPose;
uniform vec4 uShape;
uniform vec4 uLook;
#define BF_POSE uPose
#define BF_SHAPE uShape
#define BF_LOOK uLook
mat4 bfModel(){ return modelMatrix; }
#endif
${rigGLSL}
vec3 bfWing(vec2 p){ return bfWingBody(bfWingLocal(p, aWing, BF_POSE, BF_SHAPE), aWing, BF_POSE, BF_SHAPE); }
void bfWingFrame(out vec3 b, out vec3 tx, out vec3 ty){
  b = bfWing(position.xy);
  tx = bfWing(position.xy + vec2(0.5, 0.0)) - b;
  ty = bfWing(position.xy + vec2(0.0, 0.5)) - b;
}
`;

/**
 * Vertex preamble for anything drawn on the kit's BODY geometry. Gives:
 *   mat4 bfModel()      vec3 bfBody()   this vertex in the body frame (mm), posed      BF_LOOK
 * Under InstancedMesh the limbs follow aLook.y (landed): legs down when landed, folded when not.
 */
export const bodyVertexGLSL = /* glsl */ `
attribute vec3 aAlt;       // the same vertex with the legs folded
attribute vec4 aPart;      // part id (PART in bodyData.js), 0..1 along it, 0..1 around it, which leg (or -1)
#ifdef USE_INSTANCING
attribute vec4 aLook;
#define BF_LOOK aLook
mat4 bfModel(){ return modelMatrix * instanceMatrix; }
${rigGLSL}
vec3 bfBody(){
  vec3 still[4] = vec3[4](vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
  float fly = 1.0 - aLook.y;
  return bfBodyLocal(position, aAlt, normal, aPart, vec4(fly, 0.12 * fly, 0.22 * fly, 0.0), vec4(0.0), still);
}
#else
uniform vec4 uLook;
uniform vec4 uLimbs;
uniform vec4 uTwitch;
uniform vec3 uFeet[4];
#define BF_LOOK uLook
mat4 bfModel(){ return modelMatrix; }
${rigGLSL}
vec3 bfBody(){ return bfBodyLocal(position, aAlt, normal, aPart, uLimbs, uTwitch, uFeet); }
#endif
`;

/** A pose at rest, wings half open. See the table at the top of this file. */
export function makePose() {
  return {
    wings: new THREE.Vector4(0.6, 0.55, 0, 0),
    shape: new THREE.Vector4(1, 0, 0, 0),
    limbs: new THREE.Vector4(0, 0.1, 0, 0),
    twitch: new THREE.Vector4(0, 0, 0, 0),
    feet: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
  };
}

/** The uniforms the two preambles read, bound to a pose (by reference: change the pose, the picture follows). */
export function poseUniforms(pose, look = new THREE.Vector4(0, 0, 0.37, 0.6)) {
  return { uPose: { value: pose.wings }, uShape: { value: pose.shape }, uLimbs: { value: pose.limbs }, uTwitch: { value: pose.twitch }, uFeet: { value: pose.feet }, uLook: { value: look } };
}

const sstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * CPU twin of bfWing(): a point of the flat wing (mm) → the body frame (mm). No allocation.
 * @param side +1 right, -1 left   @param hind 0 | 1   @param pose from makePose()   @param out THREE.Vector3
 */
export function wingPoint(out, x, y, side, hind, pose) {
  const L = hind ? SPAN_H : SPAN_F;
  const { wings, shape } = pose;
  let z = 0;
  const wet = 1 - Math.max(0, Math.min(1, shape.x));
  if (wet > 0) {
    const s0 = Math.max(0, Math.min(1.2, x / L));
    const e = sstep(0, 0.85, (1 - wet) * 1.45 - 0.5 * s0);
    const w = 1 - e;
    const k = 0.34 + 0.66 * (e * e * (3 - 2 * e) * 0.6 + 0.4 * (1 - wet));
    x *= k;
    y *= k;
    const fan = Math.atan2(y, x + 2);
    z += w * (0.9 * Math.sin(fan * 34 + hind * 2) + 0.5 * Math.sin(x * 2.3 + y * 1.1) * Math.sin(fan * 13)) * (0.25 + 0.75 * s0);
    y *= 1 - 0.28 * w * s0;
    y += w * 0.5 * Math.sin(x * 1.7 + hind * 3) * s0;
    z -= w * L * 0.22 * s0 * s0;
  }
  const xs = Math.max(0, Math.min(1.2, x / L));
  const tr = Math.max(0, Math.min(14, 4 - y));
  z += wings.w * L * xs * xs + wings.w * 0.075 * tr * tr * (0.35 + 0.65 * Math.min(xs, 1)) + 0.5 * Math.sin(Math.min(xs, 1) * 3.1416) - 0.011 * y * y * xs - hind * 0.16;
  const psi = wings.z * (0.35 + 0.65 * xs);
  const qy = y * Math.cos(psi) - z * Math.sin(psi);
  const qz = y * Math.sin(psi) + z * Math.cos(psi);
  const sg = hind ? SIG_H + 0.1 * shape.y : SIG_F + 0.42 * shape.y;
  const phi = hind ? wings.y : wings.x;
  const bx = Math.sin(sg) * x - Math.cos(sg) * qy;
  const by = Math.cos(sg) * x + Math.sin(sg) * qy;
  const h = hind ? HINGE_H : HINGE_F;
  return out.set((bx * Math.cos(phi) - qz * Math.sin(phi) + h[0]) * side, by + h[1], bx * Math.sin(phi) + qz * Math.cos(phi) + h[2]);
}

/**
 * A flat wing's hinge and its two axes in the body frame (mm): the wing as a plate, for sorting, shadows, reflections.
 * @param side +1 right, -1 left    @param hind 0 | 1    @param phi stroke angle    @param sweep shape.y
 */
export function wingFrame(side, hind, phi, origin, axisX, axisY, sweep = 0) {
  const sg = hind ? SIG_H + 0.1 * sweep : SIG_F + 0.42 * sweep;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const h = hind ? HINGE_H : HINGE_F;
  origin.set(h[0] * side, h[1], h[2]);
  // wing x: (sin sg, cos sg, 0) → flapped;  wing y: (-cos sg, sin sg, 0) → flapped
  axisX.set(Math.sin(sg) * c * side, Math.cos(sg), Math.sin(sg) * s);
  axisY.set(-Math.cos(sg) * c * side, Math.sin(sg), -Math.cos(sg) * s);
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
/**
 * The body frame → the world, as a matrix: `right`, `fwd` (toward the head), `up` (out of the back) are unit axes,
 * `pos` is where the middle of the thorax goes, `size` 1 = life size (a 59 mm wingspan when the world's unit is a metre).
 * A mirror image (a reflection in water) is the same call with the three axes and the position reflected.
 */
export function bodyMatrix(out, pos, right, fwd, up, size = 1) {
  _m.makeBasis(right, fwd, up);
  _m.scale(_s.setScalar(0.001 * size));
  _m.setPosition(pos);
  return out.copy(_m);
}

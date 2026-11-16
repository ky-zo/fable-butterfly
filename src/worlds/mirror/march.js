// Mirror — the liquid's first pass: where it is. At a quarter of the picture's size, a cone is walked down every pixel
// (the cone a pixel of this pass covers, with room to spare) and how far it got before it touched the liquid is written
// out. The picture itself (inside.js) starts each of its own rays from there, so that at full size a ray takes two or
// three steps instead of forty, and a pixel no cone touched takes none.
//
// Also here: the uniforms the form is described by (form.js writes them; this pass, the picture and the wall read them).

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { sdfUniformsGLSL, sdfGLSL, NS, NRING } from './sdf.glsl.js';
import { shellUniforms } from './shell.glsl.js';

const TIERS = [
  { steps: 30, maxl: 12 },
  { steps: 36, maxl: 16 },
  { steps: 44, maxl: 20 },
];

const frag = (q) => /* glsl */ `
precision highp float;
precision highp int;
varying vec2 vUv;
#define MAXL ${q.maxl}
#define FAR_SCALE 0.97
#define NEAR_SCALE 0.78
uniform vec3 uCamPos;
uniform mat3 uCamRot;          // camera → world
uniform vec2 uTan;             // tan(fov/2) * (aspect, 1)
uniform float uCone;           // the cone's half angle
${sdfUniformsGLSL}
${sdfGLSL}
void main(){
  vec3 rd = uCamRot * normalize(vec3((vUv * 2.0 - 1.0) * uTan, -1.0));
  float t = 1e9;
  vec2 tt = cull(uCamPos, rd, false);
  if (tt.x < tt.y) t = marchCone(uCamPos, rd, tt, ${q.steps}, uCone);
  gl_FragColor = vec4(t, 0.0, 0.0, 1.0);
}
`;

export function createMarchPass(level, shared) {
  const q = TIERS[level] ?? TIERS[2];
  const uniforms = {
    uCamPos: { value: new THREE.Vector3() },
    uCamRot: { value: new THREE.Matrix3() },
    uTan: { value: new THREE.Vector2(1, 1) },
    uCone: { value: 0.004 },
    ...formUniforms(shared),
  };
  return new FSPass(frag(q), uniforms);
}

const FORM_KEYS = ['uSph', 'uSphK', 'uSphCount', 'uBound', 'uCoreC', 'uCoreRot', 'uCoreAxis', 'uCoreP', 'uCoreB', 'uCoreSlab', 'uRing', 'uRingP', 'uWob'];
/** the part of the shared uniforms the distance field reads */
export function formUniforms(shared) {
  const out = {};
  for (const k of FORM_KEYS) out[k] = shared[k];
  return out;
}

/** Uniforms shared (by reference) between the passes: the form, its wings, and the shell round it. */
export function createSharedUniforms() {
  const sph = new Float32Array(NS * 4);
  for (let i = 0; i < NS; i++) sph[i * 4 + 3] = -10;
  const v3 = () => new THREE.Vector3();
  return {
    uSph: { value: sph },
    uSphK: { value: new Float32Array(NS).fill(0.05) },
    uSphCount: { value: 0 },
    uBound: { value: new THREE.Vector4(0, 0, 0, 2) },
    uCoreC: { value: new THREE.Vector3(0, 0, 0) },
    uCoreRot: { value: new THREE.Matrix3() },
    uCoreAxis: { value: new THREE.Vector3(0, 0, 1) },
    uCoreP: { value: new THREE.Vector4(0, 0, 0.5, 0.08) },
    uCoreB: { value: new THREE.Vector4(1.1, 0.03, 0.6, 0.1) },
    uCoreSlab: { value: 0.6 },
    uRing: { value: new Float32Array(NRING * 4) },
    uRingP: { value: new Float32Array(NRING * 4) },
    uWob: { value: new THREE.Vector4(0, 5, 0, 0) },
    uBf: { value: new THREE.Vector4(0, 1, 0, 0) },
    uBfB: { value: new THREE.Vector4(0.03, 1, 0.045, 0) },
    uBfC: { value: new THREE.Vector3() },
    uBfRot: { value: new THREE.Matrix3() },
    uBfO: { value: [v3(), v3()] },
    uBfAX: { value: [v3(), v3()] },
    uBfAY: { value: [v3(), v3()] },
    ...shellUniforms(),
  };
}

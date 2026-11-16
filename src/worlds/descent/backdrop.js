// What is behind the last picture. The lens ends two and a half metres from a leaf with its aperture wide open, and
// at that distance nothing behind the leaf has an edge any more: the rest of the shrub is masses of dark green-grey,
// its stems are soft bars, the low sun coming through it is one warm glow, and every bead of dew out there is a disc
// of whatever light is behind it. This is that picture, as the lens would make it — drawn already out of focus, on a
// plane standing well behind the strand, so that it shifts against the leaf as the lens moves the way a real
// background does. It is laid out in the coordinates of the last frame (the next world opens on the same glow in the
// same place), and it comes up as the lens opens.
//
// The core's depth of field would blur it a second time, so where it is drawn the depth is afterwards set to the
// plane of focus (depthMesh, drawn after the butterfly): it is already what the lens sees.

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';

const VERT = /* glsl */ `
varying vec3 vW;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vW;
uniform mat4 uEndVP;         // the lens of the last frame
uniform float uEndAspect, uBack, uTime;
uniform vec3 uWarm, uCool;   // the low sun, the sky
${hash}
// where the low light is, in the last frame: x to the right in half-heights of the frame, y up
const vec2 GLOW = vec2(0.47, -0.55);
vec3 lightAt(vec2 q){
  // masses of leaf, far out of focus
  float n1 = sin(q.x * 2.3 + 1.7 * sin(q.y * 1.9 + 0.4)) * sin(q.y * 2.9 + 0.5 + 1.3 * sin(q.x * 1.7));
  float n2 = sin(q.x * 5.3 + 2.0 + 0.8 * sin(q.y * 4.1)) * sin(q.y * 4.7 + 1.0);
  // the open air under the leaf: paler, and cool
  float open = exp(-pow((q.y - 0.2) / 0.62, 2.0));
  vec3 green = uCool * (0.56 + 0.3 * n1 + 0.14 * n2) * (0.3 + 0.7 * open);
  vec2 dg = (q - GLOW) * vec2(1.0, 1.3);
  float r2 = dot(dg, dg);
  vec3 warm = uWarm * (0.2 * exp(-r2 / 0.085) + 0.085 * exp(-r2 / 0.5) + 0.022 * exp(-r2 / 3.0));
  // stems of the shrub: soft bars, none of them straight
  float s1 = abs(q.x + 0.84 - 0.07 * sin(q.y * 1.3 + 0.4)) / 0.085;
  float s2 = abs(q.x - 0.82 - 0.09 * sin(q.y * 1.1 + 2.0) - 0.05 * q.y) / 0.06;
  float s3 = abs(q.x + 1.52 + 0.1 * q.y) / 0.1;
  float stems = (1.0 - 0.42 * exp(-s1 * s1)) * (1.0 - 0.34 * exp(-s2 * s2)) * (1.0 - 0.4 * exp(-s3 * s3));
  return (green + warm) * stems;
}
void main(){
  vec4 c = uEndVP * vec4(vW, 1.0);
  vec2 q = c.xy / c.w * vec2(uEndAspect, 1.0);
  vec3 col = lightAt(q);
  // dew on the far leaves: discs of whatever light is behind them, most of them faint
  float px = fwidth(q.y);
  const float cell = 0.29;
  vec2 g0 = q / cell;
  vec2 id = floor(g0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = id + vec2(float(i), float(j));
    vec3 r = hash32(g + 7.3);
    if (r.z > 0.46) continue;
    vec2 cc = (g + 0.15 + 0.7 * r.xy) * cell;
    float rad = cell * (0.13 + 0.42 * hash12(g + 3.1));
    float d = length(q - cc) / rad;
    if (d >= 1.0) continue;
    float tw = 0.8 + 0.2 * sin(uTime * (0.3 + 0.9 * r.x) + r.y * 40.0);
    // (a disc of confusion is flat, with a slightly brighter rim)
    float disc = (1.0 - smoothstep(1.0 - 2.0 * px / rad, 1.0, d)) * (0.78 + 0.32 * smoothstep(0.55, 0.95, d));
    col += lightAt(cc) * disc * tw * (0.1 + 1.5 * r.z * r.z);
  }
  gl_FragColor = vec4(col, uBack);
}`;

const DEPTH_FRAG = /* glsl */ `
precision highp float;
uniform float uCover, uDepth;
${hash}
void main(){
  if (ign(gl_FragCoord.xy) >= uCover) discard;
  gl_FragDepth = uDepth;
  gl_FragColor = vec4(0.0);
}`;

/**
 * @param plan  STRAND, VIEW, placeCamera
 * Returns { mesh (the picture: add it to the scene of clear things), depthMesh (draw it after the butterfly), update }.
 */
export function makeBackdrop(ctx, plan) {
  const geo = ctx.track(new THREE.PlaneGeometry(1, 1));
  const uniforms = {
    uEndVP: { value: new THREE.Matrix4() },
    uEndAspect: { value: 1 },
    uBack: { value: 0 },
    uTime: { value: 0 },
    uWarm: { value: new THREE.Vector3(1.0, 0.47, 0.17) },
    uCool: { value: new THREE.Vector3(0.076, 0.108, 0.094) },
  };
  const mesh = new THREE.Mesh(geo, ctx.track(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthTest: true, depthWrite: false })));
  mesh.renderOrder = 5.5;
  const du = { uCover: { value: 0 }, uDepth: { value: 0.5 } };
  const depthMesh = new THREE.Mesh(geo, ctx.track(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DEPTH_FRAG, uniforms: du, colorWrite: false, depthTest: true, depthWrite: true })));
  depthMesh.renderOrder = 100;
  for (const m of [mesh, depthMesh]) {
    m.frustumCulled = false;
    m.visible = false;
    m.matrixAutoUpdate = false;
  }
  const end = new THREE.PerspectiveCamera();
  let endAspect = -1;
  const _z = new THREE.Vector3();
  return {
    mesh,
    depthMesh,
    /** @param k 0 not there … 1 all of it   @param focus the distance the lens is focused at (m) */
    update(k, camera, aspect, focus, time) {
      const on = k > 0.002;
      mesh.visible = depthMesh.visible = on;
      if (!on) return;
      if (aspect !== endAspect) {
        endAspect = aspect;
        plan.placeCamera(end, 1, aspect);
        uniforms.uEndVP.value.multiplyMatrices(end.projectionMatrix, end.matrixWorldInverse);
        uniforms.uEndAspect.value = aspect;
        // the plane: square to the last line of sight, eight metres behind the strand
        end.getWorldDirection(_z);
        mesh.position.copy(plan.STRAND).addScaledVector(_z, 8);
        mesh.quaternion.copy(end.quaternion);
        mesh.scale.set(90, 90, 1);
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
        depthMesh.matrix.copy(mesh.matrix);
        depthMesh.matrixWorld.copy(mesh.matrixWorld);
      }
      uniforms.uBack.value = k;
      uniforms.uTime.value = time;
      // (only once it is nearly all there does it count as in focus: until then the sea behind it is still being blurred)
      const c = Math.min(1, Math.max(0, (k - 0.5) / 0.5));
      du.uCover.value = c * c * (3 - 2 * c) * 1.001;
      const n = camera.near, f = camera.far;
      du.uDepth.value = 0.5 * ((f + n) / (f - n) - (2 * f * n) / ((f - n) * focus)) + 0.5;
    },
  };
}

// Running droplets, drawn as instanced quads lying on the pane. Each one is a lens (see lensGLSL): resolution-independent,
// so it holds up when the camera is a hand's width from the glass.

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { layoutGLSL } from './layout.js';
import { pyramidGLSL } from './pyramid.js';
import { lensGLSL } from './glass.js';

const DROP_VERT = /* glsl */ `
attribute vec4 aDrop;      // x, y on the wall (m), radius (m), stretch
uniform vec3 uOrigin, uAxisU, uAxisV, uNormal;
uniform vec2 uRes;
varying vec2 vLocal;
varying vec2 vCentreUV;
varying vec2 vWallUV;
varying float vRpx;
varying float vTail;
void main(){
  float r = aDrop.z;
  float tail = aDrop.w;
  vec2 loc = position.xy * 1.3;
  if (position.y > 0.0) loc.y *= 1.0 + tail;
  vec2 st = aDrop.xy + loc * r;
  vec3 P = uOrigin + uAxisU * st.x + uAxisV * st.y + uNormal * 0.0006;
  vec3 C = uOrigin + uAxisU * aDrop.x + uAxisV * aDrop.y;
  vec4 cc = projectionMatrix * viewMatrix * vec4(C, 1.0);
  vCentreUV = cc.xy / cc.w * 0.5 + 0.5;
  vRpx = r * projectionMatrix[1][1] * 0.5 * uRes.y / max(cc.w, 1e-4);
  vLocal = loc; vTail = tail; vWallUV = aDrop.xy;
  gl_Position = r > 0.0 ? projectionMatrix * viewMatrix * vec4(P, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const DROP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vLocal;
varying vec2 vCentreUV;
varying vec2 vWallUV;
varying float vRpx;
varying float vTail;
uniform vec3 uNormal, uAxisU;
uniform vec2 uRes, uWallSize;
uniform vec3 uGlow[7];
uniform sampler2D tScreen;
uniform float uHasScreen;
${hash}
${layoutGLSL}
${pyramidGLSL}
${lensGLSL}
void main(){
  // a drop that is moving drags a narrowing tail behind (above) it
  vec2 d = vLocal;
  if (d.y > 0.0) {
    float ty = d.y / (1.0 + vTail);
    float w = mix(1.0, 0.42, smoothstep(0.0, 1.0, ty) * min(vTail, 1.0));
    d = vec2(d.x / w, ty);
  }
  float dd = length(d);
  float aa = 1.4 / max(vRpx, 0.5);
  float alpha = smoothstep(1.0 + aa, 1.0 - aa, dd) * smoothstep(0.25, 1.1, vRpx);
  if (alpha < 0.003) discard;
  float vis = uHasScreen > 0.5 ? texture2D(tScreen, vWallUV / uWallSize).r : 0.0;
  vec3 lc = lensColor(d, min(dd, 1.0), vCentreUV, vRpx, uNormal, uAxisU, vis);
  gl_FragColor = vec4(lc, alpha);
}`;

export function makeDrops(wall, drops, shared, screenTex) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const attr = new THREE.InstancedBufferAttribute(drops.data, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aDrop', attr);
  geo.instanceCount = drops.n;
  const mat = new THREE.ShaderMaterial({
    vertexShader: DROP_VERT,
    fragmentShader: DROP_FRAG,
    uniforms: {
      ...shared,
      uOrigin: { value: wall.origin },
      uAxisU: { value: wall.u },
      uAxisV: { value: wall.v },
      uNormal: { value: wall.n },
      uWallSize: { value: new THREE.Vector2(wall.w, wall.h) },
      tScreen: { value: screenTex },
      uHasScreen: { value: screenTex ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { mesh, attr, geo, mat };
}

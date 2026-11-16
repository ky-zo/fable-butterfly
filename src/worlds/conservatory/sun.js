// The low sun: one orthographic depth map of the garden, shared by everything that needs to know whether the sun
// reaches a point — leaves (self-shadowing, translucency), the frost (which is a projection screen for leaf shadows),
// the haze in the corridor (shafts), the floor, the steel.

import * as THREE from 'three';
import { SUN_DIR } from './layout.js';

/** Needs layoutGLSL to be included before it. */
export const sunGLSL = /* glsl */ `
#ifndef CV_SUN
#define CV_SUN
uniform sampler2D tShadow;
uniform mat4 uShadowMat;      // world → shadow clip (orthographic)
uniform vec4 uShadowP;        // texel x, texel y, depth range (m), metres per texel
uniform sampler2D tFogL;      // fog on the sunlit wall, for the beam that enters through it
uniform float uFogBeam;       // how much of the direct beam survives a fully fogged pane
uniform float uSunT;          // time, for the sway of the shadows

// The depth map is drawn once. The garden still moves in it: every lookup is displaced by a slow, spatially varying
// sway of about a centimetre, which is what wind does to a shadow.
vec2 shadowSway(vec3 P){
  vec2 w = vec2(sin(P.z * 1.9 + P.y * 2.7 + uSunT * 0.83), cos(P.x * 2.3 - P.y * 1.7 + P.z * 0.7 + uSunT * 0.61));
  w += 0.5 * vec2(sin(P.y * 5.1 - P.z * 3.3 + uSunT * 1.37), cos(P.z * 4.7 + P.x * 3.1 - uSunT * 1.13));
  return w * uShadowP.xy * (0.007 / uShadowP.w);
}
vec3 shadowCoord(vec3 P){
  vec4 c = uShadowMat * vec4(P, 1.0);
  vec3 r = c.xyz * 0.5 + 0.5;
  r.xy += shadowSway(P);
  return r;
}

// 1 = lit. Four texels, weighted bilinearly: the edge of a shadow is a soft ramp one texel wide instead of a staircase,
// which is what lets a leaf fill the frame without showing the depth map.
float shadowHard(vec3 P){
  vec3 c = shadowCoord(P);
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float bias = 0.03 / uShadowP.z;
  vec2 t = c.xy / uShadowP.xy - 0.5;
  vec2 f = fract(t);
  vec2 b = (floor(t) + 0.5) * uShadowP.xy;
  float s00 = step(c.z - bias, texture2D(tShadow, b).x);
  float s10 = step(c.z - bias, texture2D(tShadow, b + vec2(uShadowP.x, 0.0)).x);
  float s01 = step(c.z - bias, texture2D(tShadow, b + vec2(0.0, uShadowP.y)).x);
  float s11 = step(c.z - bias, texture2D(tShadow, b + uShadowP.xy).x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}

// 1 = lit, one texel: for things too far behind the glass for the edge of a shadow to matter.
float shadow1(vec3 P){
  vec3 c = shadowCoord(P);
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  return step(c.z - 0.03 / uShadowP.z, texture2D(tShadow, c.xy).x);
}

// The colour of the garden's air along a view direction: warm and bright toward the sun, cool and dim away from it.
vec3 hazeColor(vec3 rd, vec3 warm){
  float s = dot(rd, SUN_DIR);
  vec3 cool = vec3(0.075, 0.105, 0.125);
  return mix(cool, warm, smoothstep(-0.35, 0.45, s)) * (1.0 + 2.2 * pow(max(s, 0.0), 3.0));
}

// How much of the direct beam gets INTO the corridor at P: steel frame × fogged glass. (Leaves: multiply by a shadow lookup.)
float sunInto(vec3 P, float soft){
  int idx;
  float t = hullExit(P, SUN_DIR, 5, idx);
  vec3 Q = P + SUN_DIR * t;
  float open = frameOpen(idx, Q, soft + t * 0.008);
  float fog = 0.9;
  if (idx == 0) { vec4 fs = texture2D(tFogL, vec2(ZB - Q.z, Q.y - Y0) / vec2(WALL_LEN, WALL_H)); fog = fs.r * fs.a; }   // (a: how readily that pane fogs)
  return open * mix(1.0, uFogBeam, fog * fog);
}
#endif
`;

export class SunShadow {
  /**
   * @param size [w, h] of the depth map
   * @param box  THREE.Box3 that must be covered (world space)
   */
  constructor(size, box) {
    const depth = new THREE.DepthTexture(size[0], size[1]);
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    this.rt = new THREE.WebGLRenderTarget(size[0], size[1], {
      format: THREE.RedFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: depth,
      generateMipmaps: false,
    });
    this.depth = depth;

    // fit an orthographic camera looking down the sun direction around the box
    const cam = (this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100));
    const centre = box.getCenter(new THREE.Vector3());
    cam.position.copy(centre).addScaledVector(SUN_DIR, 40);
    cam.up.set(0, 1, 0);
    cam.lookAt(centre);
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const mn = new THREE.Vector3(Infinity, Infinity, Infinity);
    const mx = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
      mn.min(p);
      mx.max(p);
    }
    cam.left = mn.x;
    cam.right = mx.x;
    cam.bottom = mn.y;
    cam.top = mx.y;
    cam.near = Math.max(0.1, -mx.z - 1);
    cam.far = -mn.z + 1;
    cam.updateProjectionMatrix();
    this.matrix = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const range = cam.far - cam.near;
    const mpt = Math.max((mx.x - mn.x) / size[0], (mx.y - mn.y) / size[1]);
    /** Spread into consumer materials. */
    this.uniforms = {
      tShadow: { value: depth },
      uSunT: { value: 0 },
      uShadowMat: { value: this.matrix },
      uShadowP: { value: new THREE.Vector4(1 / size[0], 1 / size[1], range, mpt) },
    };
  }

  /** Render `scene` with each mesh's userData.shadowMaterial (meshes without one are skipped). */
  render(renderer, scene) {
    const swapped = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.shadowMaterial) {
        swapped.push(o, o.material, o.visible);
        o.material = o.userData.shadowMaterial;
        o.visible = true;
      } else {
        swapped.push(o, o.material, o.visible);
        o.visible = false;
      }
    });
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, this.camera);
    for (let i = 0; i < swapped.length; i += 3) {
      swapped[i].material = swapped[i + 1];
      swapped[i].visible = swapped[i + 2];
    }
  }

  dispose() {
    this.depth.dispose();
    this.rt.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The frost as a projection screen. For each sunlit wall we keep, in wall space, how much sun arrives at every point
// of the pane — soft shadows whose penumbra widens with the distance to the leaf that casts them. Computed with a few
// rotating taps per frame and accumulated over time (the wall does not move), so the result is smooth and stable.

const SCREEN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tShadow;
uniform mat4 uShadowMat;
uniform vec4 uShadowP;
uniform vec3 uOrigin, uAxisU, uAxisV, uNormal;
uniform vec2 uWallSize;
uniform float uFrame, uAlpha, uSunT;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 st = vUv * uWallSize;
  vec3 P = uOrigin + uAxisU * st.x + uAxisV * st.y - uNormal * 0.004;
  vec4 c4 = uShadowMat * vec4(P, 1.0);
  vec3 c = c4.xyz * 0.5 + 0.5;
  // wind: the shadows sway (the depth map itself is static)
  vec2 sw = vec2(sin(P.z * 1.9 + P.y * 2.7 + uSunT * 0.83), cos(P.x * 2.3 - P.y * 1.7 + P.z * 0.7 + uSunT * 0.61));
  sw += 0.5 * vec2(sin(P.y * 5.1 - P.z * 3.3 + uSunT * 1.37), cos(P.z * 4.7 + P.x * 3.1 - uSunT * 1.13));
  c.xy += sw * uShadowP.xy * (0.007 / uShadowP.w);
  float bias = 0.01 / uShadowP.z;
  float rot = (h12(gl_FragCoord.xy) + uFrame * 0.61803399) * 6.2831853;
  float bs = 0.0, bn = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = rot + float(i) * 2.39996323;
    float r = sqrt((float(i) + 0.5) / 8.0) * 22.0;
    float d = texture2D(tShadow, c.xy + vec2(cos(a), sin(a)) * r * uShadowP.xy).x;
    if (d < c.z - bias) { bs += d; bn += 1.0; }
  }
  float s = 1.0;
  if (bn > 0.5) {
    float gap = (c.z - bs / bn) * uShadowP.z;                    // metres between the leaf and the glass
    float rad = clamp(gap * 0.085 / uShadowP.w, 0.9, 22.0);
    s = 0.0;
    for (int i = 0; i < 12; i++) {
      float a = rot + 0.7 + float(i) * 2.39996323;
      float r = sqrt((float(i) + 0.5) / 12.0) * rad;
      s += step(c.z - bias, texture2D(tShadow, c.xy + vec2(cos(a), sin(a)) * r * uShadowP.xy).x);
    }
    s /= 12.0;
  }
  gl_FragColor = vec4(s, s, s, uAlpha);
}`;

export class FrostScreen {
  /** walls: [{ origin, u, v, n, w, h, rt }] */
  constructor(shadow, FSPass) {
    this.pass = new FSPass(
      SCREEN_FRAG,
      {
        ...shadow.uniforms,
        uOrigin: { value: new THREE.Vector3() },
        uAxisU: { value: new THREE.Vector3() },
        uAxisV: { value: new THREE.Vector3() },
        uNormal: { value: new THREE.Vector3() },
        uWallSize: { value: new THREE.Vector2() },
        uFrame: { value: 0 },
        uAlpha: { value: 1 },
      },
      { transparent: true, blending: THREE.NormalBlending },
    );
    this.frame = 0;
  }

  /** alpha = 1 overwrites, smaller values accumulate. */
  render(renderer, wall, rt, alpha) {
    const u = this.pass.uniforms;
    u.uOrigin.value.copy(wall.origin);
    u.uAxisU.value.copy(wall.u);
    u.uAxisV.value.copy(wall.v);
    u.uNormal.value.copy(wall.n);
    u.uWallSize.value.set(wall.w, wall.h);
    u.uFrame.value = this.frame++ % 64;
    u.uAlpha.value = alpha;
    this.pass.render(renderer, rt);
  }

  dispose() {
    this.pass.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The shade wall is lit from across the corridor: what is left of the beam after the far garden, the far glass and
// the steel is a soft warm dapple. It changes slowly and has no edges, so it is kept in a small wall-space texture
// (a few jittered lookups per frame, accumulated) instead of being worked out again for every pixel of every frame.

const SHADE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uOrigin, uAxisU, uAxisV, uNormal;
uniform vec2 uWallSize;
uniform float uFrame, uAlpha;
//@LAYOUT@
//@SUNCHUNK@
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 st = vUv * uWallSize;
  vec3 Pw = uOrigin + uAxisU * st.x + uAxisV * st.y + uNormal * 0.01;
  float a = (h12(gl_FragCoord.xy) + uFrame * 0.61803399) * 6.2831853;
  float sv = 0.0;
  for (int i = 0; i < 4; i++) {
    float an = a + float(i) * 1.5708;
    float r = 0.02 + 0.02 * float(i);
    vec3 o = vec3(0.0, sin(an), cos(an)) * r;
    // (the frame's own shadow is taken at the same jittered point: a hard edge here would show the texels of this map)
    sv += shadowHard(Pw + o) * sunInto(Pw + o, 0.03);
  }
  float s = 0.25 * sv;
  gl_FragColor = vec4(s, s, s, uAlpha);
}`;

export class ShadeScreen {
  /** shared: the world's uniform bag (shadow map, fog on the sunlit wall …) */
  constructor(shared, FSPass, layoutGLSL) {
    this.pass = new FSPass(
      SHADE_FRAG.replace('//@LAYOUT@', layoutGLSL).replace('//@SUNCHUNK@', sunGLSL),
      {
        ...shared,
        uOrigin: { value: new THREE.Vector3() },
        uAxisU: { value: new THREE.Vector3() },
        uAxisV: { value: new THREE.Vector3() },
        uNormal: { value: new THREE.Vector3() },
        uWallSize: { value: new THREE.Vector2() },
        uFrame: { value: 0 },
        uAlpha: { value: 1 },
      },
      { transparent: true, blending: THREE.NormalBlending },
    );
    this.frame = 0;
  }

  render(renderer, wall, rt, alpha) {
    const u = this.pass.uniforms;
    u.uOrigin.value.copy(wall.origin);
    u.uAxisU.value.copy(wall.u);
    u.uAxisV.value.copy(wall.v);
    u.uNormal.value.copy(wall.n);
    u.uWallSize.value.set(wall.w, wall.h);
    u.uFrame.value = this.frame++ % 64;
    u.uAlpha.value = alpha;
    this.pass.render(renderer, rt);
  }

  dispose() {
    this.pass.dispose();
  }
}

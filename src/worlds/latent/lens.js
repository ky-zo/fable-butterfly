// The lens every point in this world is seen through: the field, the butterfly, what trails off its wings.
//
// Every point is a tiny luminous sphere. Its image is a disc whose radius is the root-sum-square of its projected
// size and its circle of confusion, and whose brightness is its flux divided by the disc area — so defocus is
// energy-conserving and a point far off the focal plane melts into a large, faint disc instead of a big bright blob.
//
// Each set of points is drawn twice:
//   sharp  — discs up to a few pixels, full resolution
//   bokeh  — everything larger, into a half-resolution target (a quarter of the fill cost), with the lens' signature:
//            a brighter rim behind the focal plane, a soft core in front of it, a little longitudinal chromatic
//            fringe, and cat's-eye clipping toward the corners of the frame

import * as THREE from 'three';

/** One set of lens uniforms, shared by reference by every material that draws through it. */
export function lensUniforms() {
  return {
    uFocus: { value: 10 },
    uAperture: { value: 18 },
    uFocalPx: { value: 1800 },
    uPx: { value: 1 },
    uMaxSize: { value: 64 },
    uBack: { value: 6.0 },
    uCut: { value: new THREE.Vector4(0.0014, 4.0, 7.0, 60) },
    uAspect: { value: new THREE.Vector2(1, 1) },
  };
}

/** Vertex side: declares the varyings and gives lensCoc(d) and lensEmit(clip, d, rgeo, colour × flux). */
export const LENS_VERT = /* glsl */ `
uniform float uFocus, uAperture, uFocalPx, uPx, uMaxSize, uBack;
uniform vec4 uCut;        // intensity cutoff, split r0, split r1, max radius (px @1080)
varying vec3 vCol;
varying vec4 vInfo;       // disc radius (pass px), point size (pass px), side (-1 front … +1 behind), structure amount
varying vec2 vNdc;
varying vec3 vNeedle;     // unit direction on screen (xy) and half length in pass px (z): 0 = a plain disc

/** circle of confusion (full-resolution px) at view depth d */
float lensCoc(float d){
  float coc = uAperture * uPx * abs(d - uFocus) / d;
  // behind the focal plane the blur saturates early: what is far stays a soft glow instead of vanishing
  if (d > uFocus) coc = uBack * uPx * (1.0 - exp(-coc / (uBack * uPx)));
  return coc;
}
void lensHide(){
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 1.0;
  vCol = vec3(0.0); vInfo = vec4(0.0); vNdc = vec2(0.0); vNeedle = vec3(1.0, 0.0, 0.0);
}
/** Image of a point: clip position, view depth, geometric radius (full-res px), colour × flux. false = not drawn. */
bool lensEmit(vec4 clip, float d, float rgeo, vec3 col){
  lensHide();
  float coc = lensCoc(d);
  float r = max(sqrt(rgeo * rgeo + coc * coc), 0.5);
  vec3 c = col * (rgeo * rgeo / (r * r + 0.0833));
  // points too faint to matter are dropped (this is what keeps the fill rate bounded)
  float vis = mix(1.0, smoothstep(uCut.x, uCut.x * 3.0, max(c.r, max(c.g, c.b))), smoothstep(1.0, 2.5, r));
  float big = smoothstep(uCut.y, uCut.z, r);
#ifdef BOKEH
  float w = big; const float SC = 0.5;
#else
  float w = 1.0 - big; const float SC = 1.0;
#endif
  w *= vis;
  if (w <= 0.0) return false;
  float rdraw = min(r, uCut.w * uPx) * SC;
  float size = min(2.0 * rdraw + 2.0, uMaxSize);
  gl_Position = clip;
  gl_PointSize = size;
  vCol = c * w;
  float side = clamp((d - uFocus) / max(d, 1e-3) * 4.0, -1.0, 1.0);
  vInfo = vec4(rdraw, size, side, smoothstep(2.0, 5.0, rdraw));
  vNdc = clip.xy / clip.w;
  return true;
}
/** Draw the point just emitted as a needle instead: dir = unit direction on screen, len = half length (full-res px). */
void lensNeedle(vec2 dir, float len){
#ifndef BOKEH
  float r = vInfo.x;
  len *= 1.0 - smoothstep(2.0, 4.0, r);
  if (len < 0.25) return;
  float size = min(2.0 * (r + len) + 2.0, uMaxSize);
  len = min(len, 0.5 * size - r - 1.0);
  gl_PointSize = size;
  vInfo.y = size;
  // the same light, spread along the needle
  vCol *= 3.1416 * r * r / (3.1416 * r * r + 4.0 * r * len);
  vNeedle = vec3(dir, len);
#endif
}
`;

export const LENS_FRAG = /* glsl */ `
precision highp float;
varying vec3 vCol;
varying vec4 vInfo;
varying vec2 vNdc;
varying vec3 vNeedle;
uniform vec2 uAspect;
void main(){
  vec2 q = (gl_PointCoord - 0.5) * vInfo.y;
  q.y = -q.y;
  float R = vInfo.x;
#ifdef BOKEH
  float dist = length(q);
  float cov = clamp(R + 0.5 - dist, 0.0, 1.0);
  float t = dist / max(R, 1e-3);
  float s = vInfo.w;
  // behind the focal plane: flat disc with a brighter rim; in front: brightest in the middle, dissolving outward
  float back = 0.8 + 0.62 * smoothstep(0.62, 0.98, t);
  float front = 1.5 * (1.0 - 0.66 * t * t);
  float prof = mix(1.0, mix(front, back, smoothstep(-0.25, 0.25, vInfo.z)), s);
  // longitudinal chromatic aberration: the rim leans cyan behind focus and warm in front of it
  vec3 rim = mix(vec3(1.22, 0.96, 0.8), vec3(0.78, 1.02, 1.24), step(0.0, vInfo.z));
  vec3 tintc = mix(vec3(1.0), rim, s * smoothstep(0.7, 1.0, t) * 0.7);
  // optical vignetting: toward the corners the disc is clipped by a second, displaced aperture → cat's eyes
  vec2 dir = vNdc * uAspect;
  float e = dot(dir, dir);
  vec2 off = dir * (0.34 * R * smoothstep(0.1, 1.6, e));
  float cat = clamp(R * 1.04 + 0.5 - length(q + off), 0.0, 1.0);
  cov *= mix(1.0, cat, s);
  gl_FragColor = vec4(vCol * tintc * (cov * prof), 1.0);
#else
  float al = clamp(dot(q, vNeedle.xy), -vNeedle.z, vNeedle.z);
  float dist = length(q - vNeedle.xy * al);
  float cov = clamp(R + 0.5 - dist, 0.0, 1.0);
  gl_FragColor = vec4(vCol * cov, 1.0);
#endif
}`;

/** An additive point material that draws through the lens. `defines.BOKEH` selects the half-resolution pass. */
export function lensMaterial(ctx, vertexShader, uniforms, defines = {}) {
  return ctx.track(
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: LENS_FRAG,
      uniforms,
      defines,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    }),
  );
}

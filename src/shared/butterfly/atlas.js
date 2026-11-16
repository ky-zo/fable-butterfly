// ATLAS · two small textures every glasswing shares, drawn once on the GPU:
//   veins   (1024², rgba, mipmapped) r: signed distance to the edge of the nearest vein (0.5 = the edge, ±RG mm full scale)
//                                   g: 1 on a vein's centre line, falling to 0 at WIDE mm from it
//                                   b, a: which way the nearest vein runs, as (cos 2θ, sin 2θ) · 0.5 + 0.5 in the wing's
//                                   own frame (the doubled angle: a line has no front, and it filters) — what lets a
//                                   highlight run along a vein (atlasGLSL: bfVeinDir)
//   shade   (512², r, mipmapped)    how much light the flat wing stops, 0 clear … 1 opaque: what its shadow or its
//                                   reflection in water is made of. The membrane stops about a tenth.
// Both wings sit side by side in one square: uv = (p_mm * ATLAS.px + origin) / ATLAS.size, origin = ATLAS.fore | .hind
// (atlasGLSL: bfAtlasUV(p, hind)). p is a point of the flat wing in millimetres (wingData.js).

import * as THREE from 'three';
import { ATLAS } from './wingData.js';

export const RG = 0.3125; // mm either side of a vein's edge that the field resolves
export const WIDE = 1.2;

/** vec2 bfAtlasUV(vec2 p_mm, float hind): where a point of a flat wing is in both textures. */
export const atlasGLSL = /* glsl */ `
#ifndef BF_ATLAS
#define BF_ATLAS
vec2 bfAtlasUV(vec2 p, float hind){
  return (p * ${ATLAS.px}.0 + mix(vec2(${ATLAS.fore[0]}.0, ${ATLAS.fore[1]}.0), vec2(${ATLAS.hind[0]}.0, ${ATLAS.hind[1]}.0), hind)) / ${ATLAS.size}.0;
}
// The direction of the nearest vein, unit, in the wing's flat frame (its sign means nothing). vf = a lookup of the atlas.
vec2 bfVeinDir(vec4 vf){
  vec2 d = vf.ba * 2.0 - 1.0;
  float c = d.x * inversesqrt(max(dot(d, d), 1e-6));
  return vec2(sqrt(max(0.5 + 0.5 * c, 0.0)), (d.y < 0.0 ? -1.0 : 1.0) * sqrt(max(0.5 - 0.5 * c, 0.0)));
}
#endif
`;

const VEIN_VERT = /* glsl */ `
attribute vec4 aSeg;      // a.xy, b.xy (mm)
attribute vec4 aRad;      // radius at a, radius at b, atlas origin (px)
attribute vec4 aTan;      // which way the vein runs at a, at b (unit: a vein is a curve, its pieces are not)
varying vec2 vP;
varying vec4 vSeg;
varying vec2 vRad;
varying vec4 vTan;
void main(){
  vTan = aTan;
  vec2 a = aSeg.xy, b = aSeg.zw;
  vec2 t = normalize(b - a + vec2(1e-5, 0.0));
  vec2 n = vec2(-t.y, t.x);
  float pad = max(aRad.x, aRad.y) + ${WIDE.toFixed(3)};
  vec2 p = mix(a, b, position.x * 0.5 + 0.5) + t * position.x * pad + n * position.y * pad;
  vP = p; vSeg = aSeg; vRad = aRad.xy;
  gl_Position = vec4((p * ${ATLAS.px}.0 + aRad.zw) / ${ATLAS.size}.0 * 2.0 - 1.0, 0.0, 1.0);
}`;

const VEIN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vP;
varying vec4 vSeg;
varying vec2 vRad;
void main(){
  vec2 pa = vP - vSeg.xy, ba = vSeg.zw - vSeg.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  float d = length(pa - ba * h);
  float r = mix(vRad.x, vRad.y, h);
  gl_FragColor = vec4(clamp(0.5 + (r - d) / ${(2 * RG).toFixed(4)}, 0.0, 1.0), clamp(1.0 - d / ${WIDE.toFixed(3)}, 0.0, 1.0), 0.0, 1.0);
}`;

// second pass over the same pieces: the direction of whichever is nearest (a depth test picks it), into b and a only
const DIR_FRAG = /* glsl */ `
precision highp float;
varying vec2 vP;
varying vec4 vSeg;
varying vec4 vTan;
void main(){
  vec2 pa = vP - vSeg.xy, ba = vSeg.zw - vSeg.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  float d = length(pa - ba * h);
  vec2 t = normalize(mix(vTan.xy, vTan.zw, h));
  gl_FragDepth = clamp(d / ${(WIDE + 0.2).toFixed(3)}, 0.0, 1.0);
  gl_FragColor = vec4(0.0, 0.0, 0.5 + 0.5 * (t.x * t.x - t.y * t.y), 0.5 + t.x * t.y);
}`;

/**
 * @param wings      [fore, hind] from buildWing (full detail)
 * @param shadeMat   (hind, veinTexture) → ShaderMaterial that draws a flat wing's opacity (the wing material, pass 3)
 * @returns {{ veins: THREE.Texture, shade: THREE.Texture, dispose() }}
 */
export function bakeWingAtlas(renderer, wings, shadeMat) {
  const mk = (size, depthBuffer = false) =>
    new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer,
      stencilBuffer: false,
    });
  const veinRT = mk(ATLAS.size, true);
  const shadeRT = mk(512);
  veinRT.texture.anisotropy = 4;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();

  const segs = [];
  const rads = [];
  const tans = [];
  wings.forEach((w, k) => {
    const org = k === 0 ? ATLAS.fore : ATLAS.hind;
    const dir = w.veins.map((v) => {
      const l = Math.hypot(v.b[0] - v.a[0], v.b[1] - v.a[1]) || 1;
      return [(v.b[0] - v.a[0]) / l, (v.b[1] - v.a[1]) / l];
    });
    w.veins.forEach((v, i) => {
      segs.push(v.a[0], v.a[1], v.b[0], v.b[1]);
      rads.push(v.ra, v.rb, org[0], org[1]);
      // (the direction at each end is shared with the piece that joins it there, so that it turns smoothly along the vein)
      const joined = (j, p, q) => j >= 0 && j < dir.length && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
      const ta = joined(i - 1, w.veins[i - 1]?.b || [9e9, 0], v.a) ? [dir[i][0] + dir[i - 1][0], dir[i][1] + dir[i - 1][1]] : dir[i];
      const tb = joined(i + 1, w.veins[i + 1]?.a || [9e9, 0], v.b) ? [dir[i][0] + dir[i + 1][0], dir[i][1] + dir[i + 1][1]] : dir[i];
      const la = Math.hypot(ta[0], ta[1]) || 1;
      const lb = Math.hypot(tb[0], tb[1]) || 1;
      tans.push(ta[0] / la, ta[1] / la, tb[0] / lb, tb[1] / lb);
    });
  });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aSeg', new THREE.InstancedBufferAttribute(new Float32Array(segs), 4));
  geo.setAttribute('aRad', new THREE.InstancedBufferAttribute(new Float32Array(rads), 4));
  geo.setAttribute('aTan', new THREE.InstancedBufferAttribute(new Float32Array(tans), 4));
  geo.instanceCount = segs.length / 4;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VEIN_VERT,
    fragmentShader: VEIN_FRAG,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  scene.add(mesh);
  // (src · (0, 0, 1, 1) + dst · (1, 1, 0, 0): a write to b and a that leaves r and g as the first pass made them)
  const dirMat = new THREE.ShaderMaterial({
    vertexShader: VEIN_VERT,
    fragmentShader: DIR_FRAG,
    depthTest: true,
    depthWrite: true,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ConstantColorFactor,
    blendDst: THREE.OneMinusConstantColorFactor,
    blendColor: new THREE.Color(0, 0, 1),
    blendAlpha: 1,
  });
  const dirMesh = new THREE.Mesh(geo, dirMat);
  dirMesh.frustumCulled = false;
  dirMesh.renderOrder = 1;
  scene.add(dirMesh);

  const prevTarget = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(veinRT);
  renderer.render(scene, cam);

  // the flat wings, as the sun sees them
  scene.remove(mesh);
  scene.remove(dirMesh);
  const flats = wings.map((w, k) => {
    const m = shadeMat(k === 1, veinRT.texture);
    const f = new THREE.Mesh(w.geometry, m);
    f.frustumCulled = false;
    scene.add(f);
    return m;
  });
  renderer.setRenderTarget(shadeRT);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.autoClear = prevAuto;
  geo.dispose();
  mat.dispose();
  dirMat.dispose();
  for (const m of flats) m.dispose();

  return {
    veins: veinRT.texture,
    shade: shadeRT.texture,
    dispose() {
      veinRT.dispose();
      shadeRT.dispose();
    },
  };
}

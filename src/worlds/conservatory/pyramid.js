// The garden, pre-blurred — but split by how far behind the glass each pixel is, so that blur never smears
// a leaf that touches the pane into the light behind it.
//
// From the sharp garden image (rgb + q, q = fraction of the view ray that lies behind the glass) we build three
// image pyramids at once (MRT):
//   mid : colour premultiplied by "a hand's width to an arm's length behind the glass"
//   far : colour premultiplied by "further than that"
//   all : everything, unweighted (rgb) + the near-field coverage (a)
// The near field itself is never pre-blurred: the pane shader gathers it tap by tap with depth-aware weights.
//
// One pass writes the three layers at quarter resolution (level 2); the levels above it are the mip chain of that
// target. (An earlier version filtered every level in its own pass, for a rounder kernel. On a tile-based GPU each of
// those passes costs a load and a store whatever its size: six of them were a tenth of the frame. The pane jitters its
// lookups by a fraction of a texel, which hides the box filter.)

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';

export const PYR_LEVELS = 8;

const OUTS = /* glsl */ `
layout(location = 0) out highp vec4 oMid;
layout(location = 1) out highp vec4 oFar;
layout(location = 2) out highp vec4 oAll;
`;

const PRE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tGarden;
uniform vec4 uGS;
uniform vec2 uTexel;
uniform float uK, uR;
${OUTS}
void main(){
  vec4 mid = vec4(0.0), far = vec4(0.0), all = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i & 1) * 2.0 - 1.0, float(i >> 1) * 2.0 - 1.0);   // four bilinear taps = a 4x4 box
    vec4 s = texture2D(tGarden, min((vUv + o * uTexel) * uGS.xy, uGS.zw));
    s.rgb = min(s.rgb, vec3(40.0));
    float coc = uK * s.a;
    float n = 1.0 - smoothstep(0.7 * uR, 1.15 * uR, coc);
    float f = smoothstep(2.6 * uR, 5.0 * uR, coc);
    float m = (1.0 - n) * (1.0 - f);
    mid += vec4(s.rgb * m, m);
    far += vec4(s.rgb * f, f);
    all += vec4(s.rgb, n);
  }
  oMid = mid * 0.25; oFar = far * 0.25; oAll = all * 0.25;
}`;

/** GLSL for consumers: pyrMid / pyrFar / pyrAll (lvl 2..8, uv 0..1). */
export const pyramidGLSL = /* glsl */ `
uniform sampler2D tMid, tFar, tAll;
// one level, one fetch
vec4 pyrAllAt(int k, vec2 uv){ return textureLod(tAll, uv, float(k) - 2.0); }
vec4 pyrMid(float lvl, vec2 uv){ return textureLod(tMid, uv, clamp(lvl, 2.0, ${PYR_LEVELS}.0) - 2.0); }
vec4 pyrFar(float lvl, vec2 uv){ return textureLod(tFar, uv, clamp(lvl, 2.0, ${PYR_LEVELS}.0) - 2.0); }
vec4 pyrAll(float lvl, vec2 uv){ return textureLod(tAll, uv, clamp(lvl, 2.0, ${PYR_LEVELS}.0) - 2.0); }
`;

export class Pyramid {
  constructor() {
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      count: 3,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: true,
    });
    this.pre = new FSPass(PRE_FRAG, { tGarden: { value: null }, uGS: { value: new THREE.Vector4(1, 1, 1, 1) }, uTexel: { value: new THREE.Vector2() }, uK: { value: 600 }, uR: { value: 28 } }, { glslVersion: THREE.GLSL3 });
    /** Spread into a consumer material's uniforms. */
    this.uniforms = {
      tMid: { value: this.rt.textures[0] },
      tFar: { value: this.rt.textures[1] },
      tAll: { value: this.rt.textures[2] },
    };
    this.w = 0;
    this.h = 0;
  }

  resize(W, H) {
    if (W === this.w && H === this.h) return;
    this.w = W;
    this.h = H;
    this.rt.setSize(Math.max(2, Math.ceil(W / 4)), Math.max(2, Math.ceil(H / 4)));
  }

  /**
   * @param garden render target holding rgb + q
   * @param K px of frost blur per unit q at full fog
   * @param R near-field gather radius in px
   */
  build(renderer, garden, K, R, gs) {
    const pu = this.pre.uniforms;
    pu.tGarden.value = garden.texture;
    pu.uGS.value.copy(gs);
    pu.uTexel.value.set(1 / (garden.width * gs.x), 1 / (garden.height * gs.y));
    pu.uK.value = K;
    pu.uR.value = R;
    this.pre.render(renderer, this.rt, true);
  }

  dispose() {
    this.rt.dispose();
    this.pre.dispose();
  }
}

// What a century leaves on a pane. Everything here is static and lives in wall space, so it is baked once per wall
// into a two-layer atlas (the two layers sit one above the other in a single mip-mapped texture):
//
//   layer A   r  dirt on the OUTSIDE face, with the clean tracks rain has run down it
//             g  algae growing up from the sill and out of the corners (outside)
//             b  white deposits on the inside: limescale tide-marks above the sill, runs under the bars, dust in corners
//             a  dark stains: what has dripped off each glazing bar for decades, rust at the joints
//   layer B   r  snail trails (outside), stored as distance so the shader can draw both of their bright edges
//             g  putty: signed distance to the edge of the bead (0.5 = the edge), chunks missing, cracked
//             b  (free)
//             a  etching: signed distance to the sandblasted motif (0.5 = its edge)
//
// The shader that reads it decides how each of those takes the light.

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { hash, noise, fbm } from '../../core/glsl.js';
import { layoutGLSL } from './layout.js';
import { paneGLSL, paneUniforms } from './panes.js';

const BAKE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uWallSize;
uniform int uWall;
uniform vec4 uSnail[4];
${hash}
${noise}
${fbm}
${layoutGLSL}
${paneGLSL}

float sdSeg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
// a leaf-shaped lens along +x: length 2L, half-width w. > 0 inside (metres, roughly).
float sdLeaf(vec2 p, float L, float w){
  float x = clamp(p.x / L, -1.0, 1.0);
  return w * (1.0 - x * x) - abs(p.y) - max(abs(p.x) - L, 0.0);
}
// The sandblasted border: two ruled lines, a running stem with a leaf at every bend, a rosette in each corner.
float etchMotif(vec2 pl, vec2 psz, vec2 e){
  float dE = min(e.x, e.y);
  float sd = max(0.0022 - abs(dE - 0.045), 0.0016 - abs(dE - 0.158));
  // corner rosettes
  vec2 c = vec2(min(pl.x, psz.x - pl.x) - 0.026, min(pl.y, psz.y - pl.y) - 0.03) - 0.1015;
  bool corner = e.x < 0.165 && e.y < 0.165;
  if (corner) {
    float r = length(c), th = atan(c.y, c.x);
    float petal = 0.012 + 0.03 * pow(abs(cos(th * 3.0 + 0.5236)), 0.7);
    sd = max(sd, min(petal - r, r - 0.008));
    sd = max(sd, 0.004 - r);
  } else if (dE < 0.158 && dE > 0.045) {
    bool vert = e.x < e.y;
    float a = vert ? pl.y - psz.y * 0.5 : pl.x - psz.x * 0.5;       // along the border, symmetric about the middle
    float lim = (vert ? psz.y : psz.x) * 0.5 - 0.2;                  // where the run stops short of the rosette
    float v = dE - 0.1015;
    if (abs(a) < lim) {
      float fadeEnd = smoothstep(lim, lim - 0.03, abs(a));
      float per = 0.15;
      float stem = 0.016 * sin(a * 6.2831853 / per);
      sd = max(sd, (0.0021 - abs(v - stem)) * fadeEnd - (1.0 - fadeEnd) * 0.01);
      // a leaf at each crest, on the outer side of the bend, pointing along the run
      float k = floor(a / (per * 0.5));
      float ak = (k + 0.5) * per * 0.5;
      float sgn = mod(k, 2.0) < 0.5 ? 1.0 : -1.0;
      vec2 q = vec2(a - ak, v - sgn * 0.028);
      float ang = sgn * 0.62;
      q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q;
      float leaf = sdLeaf(q, 0.026, 0.0105);
      leaf = min(leaf, abs(q.y) - 0.0011 + 0.004 * smoothstep(0.012, 0.026, abs(q.x)));   // the midrib stays clear
      if (abs(ak) < lim - 0.02) sd = max(sd, leaf);
    }
  }
  return sd;
}

void main(){
  bool layerB = vUv.y >= 0.5;
  vec2 st = vec2(vUv.x, fract(vUv.y * 2.0)) * uWallSize;
  vec2 pl, psz; float row;
  vec4 pane = paneAt(uWall, st, pl, psz, row);
  int type = int(mod(pane.x + 0.5, 8.0));
  float age = pane.w;
  vec2 e = paneEdge(uWall, pl, psz, row);
  float ed = min(e.x, e.y);
  float seed = float(uWall) * 17.0;
  float lower = 1.0 - row;

  if (!layerB) {
    // ---------------------------------------------------------------- dirt outside, rain tracks through it
    float dirt = 0.22 + 0.5 * fbm(st * vec2(1.3, 1.1) + seed, 4);
    dirt += 0.5 * smoothstep(0.6, 0.0, pl.y) * lower + 0.35 * smoothstep(0.14, 0.0, ed);
    float rs = vnoise(vec2(st.x * 85.0 + seed, st.y * 0.9 + 3.0)) * 0.7 + vnoise(vec2(st.x * 31.0, st.y * 0.5 + seed)) * 0.3;
    float streak = smoothstep(0.6, 0.78, rs) * smoothstep(0.3, 0.55, fbm(vec2(st.x * 0.8, st.y * 0.35 + seed), 3));
    dirt *= 1.0 - 0.85 * streak;
    // what the rain kicks back up off the sill
    float sp = vnoise(st * 190.0 + seed);
    dirt += smoothstep(0.32, 0.02, pl.y) * lower * smoothstep(0.72, 0.9, sp) * 0.9;
    dirt = clamp(dirt * (0.15 + 0.85 * age), 0.0, 1.0);

    // ---------------------------------------------------------------- algae
    float ah = 0.02 + 0.36 * pow(fbm(vec2(st.x * 1.7 + seed, 3.1), 4), 2.2) * lower + 0.02 * row;
    ah += 0.34 * smoothstep(0.13, 0.0, e.x) * fbm(vec2(st.x * 9.0, st.y * 0.6 + seed), 3) * lower;
    float fr = (fbm(st * 13.0 + seed, 4) - 0.5) * 0.16 + (vnoise(st * 120.0) - 0.5) * 0.03;
    float algae = smoothstep(ah, ah * 0.2, pl.y - mix(0.035, 0.022, row) + fr);
    algae *= 0.5 + 0.5 * fbm(st * 7.0 + 9.0, 3);
    algae += 0.55 * smoothstep(0.045, 0.0, ed + fr * 0.35) * smoothstep(0.35, 0.7, fbm(st * 2.3 + seed, 3));  // and along the bars
    algae = clamp(algae * (0.1 + 0.9 * age), 0.0, 1.0);

    // ---------------------------------------------------------------- white deposits (inside)
    float dep = 0.0;
    {
      // tide marks: where the water that pools on the sill bead has dried, over and over
      float field = (pl.y - 0.035) + 0.05 * (fbm(vec2(st.x * 2.6 + seed, 1.0), 3) - 0.5) + 0.01 * (vnoise(vec2(st.x * 37.0, 2.0)) - 0.5);
      float lv[4] = float[4](0.016, 0.04, 0.078, 0.14);
      for (int i = 0; i < 4; i++) {
        float brk = smoothstep(0.3, 0.6, vnoise(vec2(st.x * 6.0 + float(i) * 13.0, seed)));
        float w = 0.0035 + 0.003 * float(i);
        dep += smoothstep(w, 0.0, abs(field - lv[i])) * brk * (1.0 - 0.18 * float(i));
        dep += smoothstep(lv[i], lv[i] - 0.03, field) * 0.07 * brk;           // and the bloom beneath each line
      }
      dep *= lower;
      // lime that ran down from the bar above
      float dy = psz.y - pl.y - 0.022;
      float lane = st.x * 61.0;
      vec2 hh = hash22(vec2(floor(lane), seed + row * 5.0));
      float len = mix(0.03, 0.42, hh.y * hh.y);
      float run = step(0.74, hh.x) * smoothstep(0.5, 0.12, abs(fract(lane) - 0.5)) * smoothstep(len, len * 0.2, dy) * smoothstep(-0.005, 0.01, dy);
      dep += run * 0.75 * (0.6 + 0.4 * vnoise(vec2(st.x * 300.0, st.y * 14.0)));
      // dust drifted into the lower corners and lying along the top of each bar
      vec2 cq = vec2(min(pl.x, psz.x - pl.x) - 0.026, pl.y - 0.03);
      float cd = length(max(vec2(0.2, 0.26) - cq, 0.0) / vec2(0.2, 0.26));
      dep += smoothstep(1.0, 1.4, cd + 0.25 * (fbm(st * 9.0, 3) - 0.5)) * 0.8;
      dep += smoothstep(0.03, 0.0, e.y - 0.0) * step(pl.y, psz.y * 0.5) * 0.5 * fbm(st * vec2(22.0, 3.0), 3);
    }
    dep = clamp(dep * (0.12 + 0.88 * age), 0.0, 1.0);

    // ---------------------------------------------------------------- stains under the bars
    float stain = 0.0;
    {
      float dy = psz.y - pl.y - 0.022;
      float lane = st.x * 19.0 + 0.3 * sin(st.y * 7.0 + seed);
      vec2 hh = hash22(vec2(floor(lane), seed + 3.0 + row * 7.0));
      float len = mix(0.08, 0.75, hh.y);
      float w = mix(0.5, 0.2, hh.x);
      stain = step(0.35, hh.x) * smoothstep(w, w * 0.3, abs(fract(lane) - 0.5)) * smoothstep(len, 0.0, dy) * (0.5 + 0.5 * vnoise(vec2(st.x * 140.0, st.y * 3.0)));
      // rust weeping out of the joint where the transom meets a mullion, and a line of it right under the bar
      stain += smoothstep(0.12, 0.0, e.x) * smoothstep(0.55, 0.0, dy) * (0.4 + 0.6 * fbm(vec2(st.x * 30.0, st.y * 2.0 + seed), 3));
      stain += smoothstep(0.025, 0.0, dy) * 0.6;
    }
    stain = clamp(stain * (0.1 + 0.9 * age), 0.0, 1.0);
    gl_FragColor = vec4(dirt, algae, dep, stain);
  } else {
    // ---------------------------------------------------------------- snail trails
    float snail = 0.0;
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float s0 = uSnail[k].x, s1 = uSnail[k].y;
      if (s1 <= s0) continue;
      float tc = uSnail[k].z + uSnail[k].w * (st.x - s0)
               + 0.3 * (fbm(vec2(st.x * 1.6 + fk * 7.1 + seed, fk), 4) - 0.5) + 0.012 * sin(st.x * 31.0 + fk * 2.0 + 3.0 * vnoise(vec2(st.x * 4.0, fk)));
      float d = abs(st.y - tc);
      float on = smoothstep(s0, s0 + 0.02, st.x) * smoothstep(s1, s1 - 0.02, st.x);
      on *= 0.35 + 0.65 * smoothstep(0.3, 0.55, vnoise(vec2(st.x * 2.3 + fk * 3.0, 4.0)));    // old stretches have half weathered away
      snail = max(snail, clamp(1.0 - d / 0.02, 0.0, 1.0) * on);
    }
    // ---------------------------------------------------------------- putty
    float along = e.x < e.y ? st.y : st.x;
    float pw = 0.011 * (0.55 + 0.9 * fbm(vec2(along * 3.0 + seed, e.x < e.y ? 1.0 : 5.0), 3));
    pw *= 1.0 - smoothstep(0.62, 0.7, vnoise(vec2(along * 7.0 + seed * 3.0, e.x < e.y ? 2.0 : 9.0))) * age;      // chunks fallen out
    pw *= 1.0 - 0.45 * smoothstep(0.012, 0.0, abs(fract(along * 19.0 + 0.9 * vnoise(vec2(along * 5.0, 3.0))) - 0.5)) * age;   // cracks across the bead
    float putty = clamp(0.5 + (pw - ed + (vnoise(st * 260.0) - 0.5) * 0.003) / 0.03, 0.0, 1.0);
    float crack = 0.0;
    // ---------------------------------------------------------------- etching
    float et = 0.0;
    if (type == 5) et = clamp(0.5 + etchMotif(pl, psz, e) / 0.02, 0.0, 1.0);
    gl_FragColor = vec4(snail, putty, crack, et);
  }
}`;

/** GLSL for the readers. uv for layer 0 / 1 of a wall point. */
export const dressGLSL = /* glsl */ `
uniform sampler2D tDress;
uniform float uDressTexel;      // metres per texel of the atlas along s
vec4 dressA(vec2 st, vec2 wsz){ return texture2D(tDress, vec2(st.x / wsz.x, clamp(st.y / wsz.y, 0.004, 0.996) * 0.5)); }
// (explicit level: this one is read inside a branch)
vec4 dressB(vec2 st, vec2 wsz, float px){ return textureLod(tDress, vec2(st.x / wsz.x, clamp(st.y / wsz.y, 0.004, 0.996) * 0.5 + 0.5), log2(max(px / uDressTexel, 1.0))); }
`;

/**
 * Bake the dressing of the three walls. Returns { textures: [left, right, end], dispose() }.
 * The work is cut into strips with a breath between them: it runs while another world is on screen.
 */
export async function bakeDressing(ctx, walls) {
  const lvl = ctx.quality.level;
  const r = ctx.renderer;
  const sizes = lvl >= 2 ? [[4096, 1280], [4096, 1280], [1024, 2560]] : lvl === 1 ? [[2048, 1024], [2048, 1024], [512, 1536]] : [[2048, 640], [2048, 640], [512, 1024]];
  const pass = new FSPass(BAKE_FRAG, { uWallSize: { value: new THREE.Vector2() }, uWall: { value: 0 }, uSnail: { value: null }, ...paneUniforms(0) });
  await pass.compile(r);
  const targets = [];
  const prevScissor = r.getScissorTest();
  for (let i = 0; i < 3; i++) {
    const [w, h] = sizes[i];
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const pu = paneUniforms(i);
    pass.uniforms.uPane.value = pu.uPane.value;
    pass.uniforms.uSnail.value = pu.uSnail.value;
    pass.uniforms.uWall.value = i;
    pass.uniforms.uWallSize.value.set(walls[i].w, walls[i].h);
    const strips = i === 2 ? 2 : 6;
    rt.scissorTest = true;
    for (let k = 0; k < strips; k++) {
      const x0 = Math.floor((w * k) / strips);
      const x1 = Math.floor((w * (k + 1)) / strips);
      rt.scissor.set(x0, 0, x1 - x0, h);
      pass.render(r, rt, false);
      await ctx.yield();
    }
    rt.scissorTest = false;
    targets.push(rt);
  }
  r.setScissorTest(prevScissor);
  r.setRenderTarget(null);
  pass.dispose();
  return {
    textures: targets.map((t) => t.texture),
    texel: targets.map((t, i) => walls[i].w / t.width),
    dispose() {
      for (const t of targets) t.dispose();
    },
  };
}

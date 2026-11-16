// The world's own lens. Core depth of field is off (threads are thin additive geometry), so focus is done here:
//   - opaque things (glass, room) get a gather blur from their depth,
//   - sharp and mildly soft threads are drawn as ribbons with their own circle of confusion,
//   - heavily defocused threads are drawn as thin lines that carry their blur radius and are spread by a gather pass.

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { hash } from '../../core/glsl.js';

const DEPTH = /* glsl */ `
uniform sampler2D tDepth;
uniform float uNear, uFar, uFocus, uK, uMax;
float lin(vec2 uv){
  float ndc = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear));
}
float cocOf(float d){ return min(uK * abs(1.0 - uFocus / max(d, 1e-3)), uMax); }
`;

// half-res colour + signed circle of confusion (negative in front of the focal plane), read once from depth
const DOF_PRE = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
${DEPTH}
void main(){
  float d = lin(vUv);
  gl_FragColor = vec4(min(texture2D(tColor, vUv).rgb, vec3(40.0)), cocOf(d) * sign(d - uFocus));
}`;

// half-res scatter-as-gather for the opaque layer
const DOF_A = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius, uLod;
${hash}
void main(){
  vec4 c0 = texture2D(tSrc, vUv);
  float c = abs(c0.a);
  vec3 acc = c0.rgb;
  float tot = 1.0;
  float ang = ign(gl_FragCoord.xy) * 6.2831853;
  for (int i = 0; i < TAPS; i++) {
    float f = (float(i) + 0.5) / float(TAPS);
    float r = sqrt(f) * uRadius;
    ang += 2.39996323;
    // each tap stands for the patch of the disc around it: read a mip that wide, or thin bright rims turn to stipple
    vec4 s = textureLod(tSrc, vUv + vec2(cos(ang), sin(ang)) * r * uTexel, min(uLod, log2(max(1.0, r * 0.3))));
    float sc = abs(s.a);
    if (s.a > c0.a) sc = min(sc, c * 2.0);          // background must not bleed over something sharper in front of it
    float w = smoothstep(r - 1.0, r + 1.0, sc);
    acc += mix(acc / tot, s.rgb, w);
    tot += 1.0;
  }
  gl_FragColor = vec4(acc / tot, c);
}`;

// second, small pass: fills the gaps between the taps of the first
const DOF_B = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
${hash}
void main(){
  vec4 c0 = texture2D(tSrc, vUv);
  vec3 acc = c0.rgb;
  float tot = 1.0;
  float ang = ign(gl_FragCoord.xy + 17.0) * 6.2831853;
  float rad = c0.a * 0.36;
  for (int i = 0; i < 8; i++) {
    float r = sqrt((float(i) + 0.5) / 8.0) * rad;
    ang += 2.39996323;
    vec4 s = texture2D(tSrc, vUv + vec2(cos(ang), sin(ang)) * r * uTexel);
    float w = smoothstep(0.0, 1.0, s.a - r * 0.5 + 0.5);
    acc += s.rgb * w;
    tot += w;
  }
  gl_FragColor = vec4(acc / tot, c0.a);
}`;

// opaque layer → main target: FXAA on the sharp image, mixed with the blurred one by circle of confusion,
// plus the light the threads leave in the air (additive, so it can go down before they do)
const COMPOSE = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tBlur;
uniform sampler2D tGlow;
uniform vec2 uTexel;
uniform float uBlurOn, uHaze;
${hash}
${DEPTH}
float lum(vec3 c){ c = c / (1.0 + c); return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 fxaa(){
  vec3 m = texture2D(tColor, vUv).rgb;
  float lM = lum(m);
  float lNW = lum(texture2D(tColor, vUv + vec2(-1.0, -1.0) * uTexel).rgb);
  float lNE = lum(texture2D(tColor, vUv + vec2(1.0, -1.0) * uTexel).rgb);
  float lSW = lum(texture2D(tColor, vUv + vec2(-1.0, 1.0) * uTexel).rgb);
  float lSE = lum(texture2D(tColor, vUv + vec2(1.0, 1.0) * uTexel).rgb);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.012, lMax * 0.09)) return m;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -8.0, 8.0) * uTexel;
  vec3 a = 0.5 * (texture2D(tColor, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tColor, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tColor, vUv - dir * 0.5).rgb + texture2D(tColor, vUv + dir * 0.5).rgb);
  float lB = lum(b);
  return (lB < lMin || lB > lMax) ? a : b;
}
void main(){
  vec3 c = fxaa();
  float d = lin(vUv);
  if (uBlurOn > 0.001) {
    float coc = cocOf(d);
    vec4 b = texture2D(tBlur, vUv);
    c = mix(c, b.rgb, smoothstep(0.6, 2.4, max(coc, b.a * 0.5)) * uBlurOn);
  }
  // haze: three widths of the small thread-light map, jittered so the coarse mips do not show their texels.
  // there is less air between the lens and something close
  vec2 j = vec2(ign(gl_FragCoord.xy), ign(gl_FragCoord.yx + 37.0)) - 0.5;
  vec3 h = textureLod(tGlow, vUv + j * 0.006, 2.6).rgb * 0.34
         + textureLod(tGlow, vUv + j * 0.02, 4.2).rgb * 0.36
         + textureLod(tGlow, vUv + j * 0.05, 5.8).rgb * 0.3;
  c += h * uHaze * (1.0 - exp(-d * 0.32));
  gl_FragColor = vec4(c, 1.0);
  gl_FragDepth = texture2D(tDepth, vUv).x;      // hand the depth on, so sharp threads can use the real depth test
}`;

// thin lines carrying (colour, luminance × blur radius) → discs. Energy conserving, additive.
const GATHER = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRmax, uLod, uToTexel, uCmin;
${hash}
void main(){
  vec3 acc = vec3(0.0);
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  for (int i = 0; i < TAPS; i++) {
    float f = (float(i) + 0.5) / float(TAPS);
    float r = sqrt(f) * uRmax;
    float a = rot + float(i) * 2.39996323;
    vec4 s = textureLod(tSrc, vUv + vec2(cos(a), sin(a)) * r * uTexel, uLod);
    float l = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
    float c = clamp(s.a / max(l, 1e-7) * uToTexel, uCmin, uRmax);
    float hit = 1.0 - smoothstep(c - 0.8, c + 0.8, r);
    acc += s.rgb * hit / (c * c);
  }
  gl_FragColor = vec4(acc * uRmax * uRmax / float(TAPS), 1.0);
}`;

// everything soft, added on top of the main target
const ADD = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tBand;
uniform sampler2D tNear;
uniform sampler2D tFar;
uniform vec2 uTexelQ;
uniform float uSpreadNear, uSpreadFar, uFarOn;
vec3 soft(sampler2D t, float r){
  vec2 o = uTexelQ * r;
  return texture2D(t, vUv).rgb * 0.28
       + (texture2D(t, vUv + vec2(o.x, o.y * 0.4)).rgb + texture2D(t, vUv + vec2(-o.x, -o.y * 0.4)).rgb
        + texture2D(t, vUv + vec2(-o.x * 0.4, o.y)).rgb + texture2D(t, vUv + vec2(o.x * 0.4, -o.y)).rgb) * 0.18;
}
void main(){
  vec3 c = texture2D(tBand, vUv).rgb;
  if (uFarOn > 0.5) c += soft(tNear, uSpreadNear) + soft(tFar, uSpreadFar);
  gl_FragColor = vec4(c, 1.0);
}`;

export class Lens {
  constructor(ctx) {
    this.ctx = ctx;
    const lvl = ctx.quality.level;
    this.opaque = ctx.createTarget({ depth: true });
    this.main = ctx.createTarget({ depth: true });
    this.half0 = ctx.createTarget({ scale: 0.5, mipmaps: true });
    this.half1 = ctx.createTarget({ scale: 0.5 });
    this.half2 = ctx.createTarget({ scale: 0.5 });
    this.band = ctx.createTarget({ scale: 0.5 });
    this.lines = ctx.createTarget({ scale: 0.25, count: 2, mipmaps: true });
    this.nearG = ctx.createTarget({ scale: 0.25 });
    this.farG = ctx.createTarget({ scale: 0.25 });

    const depthU = () => ({ tDepth: { value: this.opaque.depthTexture }, uNear: { value: 0.02 }, uFar: { value: 60 }, uFocus: { value: 5 }, uK: { value: 4 }, uMax: { value: 26 } });
    this.dofPre = new FSPass(DOF_PRE, { tColor: { value: this.opaque.texture }, ...depthU() });
    this.dofA = new FSPass(DOF_A, { tSrc: { value: this.half0.texture }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 8 }, uLod: { value: 0 } }, { defines: { TAPS: (this.dofTaps = [12, 16, 26][lvl]) } });
    this.dofB = new FSPass(DOF_B, { tSrc: { value: this.half1.texture }, uTexel: { value: new THREE.Vector2() } });
    this.compose = new FSPass(
      COMPOSE,
      { tColor: { value: this.opaque.texture }, tBlur: { value: this.half2.texture }, tGlow: { value: null }, uTexel: { value: new THREE.Vector2() }, uBlurOn: { value: 1 }, uHaze: { value: 0.06 }, ...depthU() },
      { depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true },
    );
    const gU = (tex) => ({ tSrc: { value: tex }, uTexel: { value: new THREE.Vector2() }, uRmax: { value: 8 }, uLod: { value: 1 }, uToTexel: { value: 0.25 }, uCmin: { value: 1 } });
    this.tapsNear = [20, 28, 36][lvl];
    this.tapsFar = [28, 40, 52][lvl];
    this.gatherNear = new FSPass(GATHER, gU(this.lines.textures[0]), { defines: { TAPS: this.tapsNear } });
    this.gatherFar = new FSPass(GATHER, gU(this.lines.textures[1]), { defines: { TAPS: this.tapsFar } });
    this.add = new FSPass(
      ADD,
      { tBand: { value: this.band.texture }, tNear: { value: this.nearG.texture }, tFar: { value: this.farG.texture }, uTexelQ: { value: new THREE.Vector2() }, uSpreadNear: { value: 1 }, uSpreadFar: { value: 2 }, uFarOn: { value: 0 } },
      { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true },
    );
    this.focus = 5;
    this.K = 4;
    this.scale = 1;
  }

  /**
   * @param focus metres  @param K blur radius (px at 1080p) of things at infinity
   * @param dmin distance from the lens to the nearest thing that could be out of focus
   */
  set(camera, focus, K, dmin) {
    const s = (this.scale = this.opaque.height / 1080);
    this.focus = focus;
    this.K = K * s;
    this.maxCoc = 88 * s;
    this.split = [1.7 * s, 9 * s, 27 * s];
    const worst = Math.min(this.maxCoc, Math.max(this.K, this.K * (focus / Math.max(dmin, 0.02) - 1)));
    this.useBand = worst > this.split[0] * 0.75;
    this.useFar = worst > this.split[1] * 0.75;
    this.blurOpaque = K > 6.2;
    this.blurFade = Math.min(1, Math.max(0, (K - 6.2) / 2.6));
    for (const p of [this.dofPre, this.compose]) {
      const u = p.uniforms;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uFocus.value = focus;
      u.uK.value = this.K;
      u.uMax.value = 26 * s;
    }
  }

  /** opaque layer (already rendered into this.opaque) → this.main */
  resolveOpaque(r) {
    const o = this.opaque;
    if (this.blurOpaque) {
      this.dofPre.render(r, this.half0);
      this.dofA.uniforms.uTexel.value.set(1 / o.width, 1 / o.height);
      const rad = (this.dofA.uniforms.uRadius.value = Math.min(26 * this.scale, Math.max(3 * this.scale, this.K * 1.6)));
      this.dofA.uniforms.uLod.value = Math.max(0, Math.log2(rad * 0.5 * Math.sqrt(Math.PI / this.dofTaps)));
      this.dofA.render(r, this.half1);
      this.dofB.uniforms.uTexel.value.set(1 / o.width, 1 / o.height);
      this.dofB.render(r, this.half2);
    }
    this.compose.uniforms.uBlurOn.value = this.blurOpaque ? this.blurFade : 0;
    this.compose.uniforms.uTexel.value.set(1 / o.width, 1 / o.height);
    this.compose.render(r, this.main);
  }

  /** spread the far lines, then add every soft layer onto this.main */
  resolveSoft(r) {
    if (!this.useBand) return;
    const q = this.lines;
    const u = this.add.uniforms;
    if (this.useFar) {
      const toQ = q.height / this.opaque.height; // full-res px → line-buffer texels
      const run = (pass, target, lo, hi, taps) => {
        const g = pass.uniforms;
        const rmax = Math.max(1.5, hi * toQ);
        const spacing = rmax * Math.sqrt(Math.PI / taps);
        g.uTexel.value.set(1 / q.width, 1 / q.height);
        g.uRmax.value = rmax;
        g.uCmin.value = Math.max(0.9, lo * toQ * 0.7);
        g.uToTexel.value = toQ;
        g.uLod.value = Math.max(0, Math.log2(spacing));
        pass.render(r, target);
        return spacing;
      };
      u.uSpreadNear.value = 0.6 * run(this.gatherNear, this.nearG, this.split[1], this.split[2] * 1.2, this.tapsNear);
      u.uSpreadFar.value = 0.6 * run(this.gatherFar, this.farG, this.split[2], this.maxCoc, this.tapsFar);
    }
    u.uFarOn.value = this.useFar ? 1 : 0;
    u.uTexelQ.value.set(1 / q.width, 1 / q.height);
    this.add.render(r, this.main);
  }

  dispose() {
    for (const p of [this.dofPre, this.dofA, this.dofB, this.compose, this.gatherNear, this.gatherFar, this.add]) p.dispose();
  }
}

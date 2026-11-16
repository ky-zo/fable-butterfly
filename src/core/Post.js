import * as THREE from 'three';
import { FSPass } from './Pass.js';
import { hash, color } from './glsl.js';

/**
 * Per-world post settings. A world exposes `this.post = { ... }` (any subset) and may mutate it every frame.
 * Everything a world renders is LINEAR HDR; the look is finished here so all six worlds share one "lens".
 */
export const POST_DEFAULTS = {
  // Depth of field. null = off. Needs the world's returned target to have a depthTexture, and `world.camera`.
  //   focus    : distance (world units) that is perfectly sharp
  //   aperture : how fast blur grows away from focus. blur = maxBlur when |d - focus| / d = 1 / aperture
  //   maxBlur  : maximum blur radius in px at 1080p (scaled with resolution)
  dof: null,
  // Bloom. strength = additive amount, radius 0..1 = how wide the glow spreads,
  // threshold/knee = soft-knee prefilter in linear HDR units (threshold 0 → everything blooms, physically "hazy").
  bloom: { strength: 0.45, radius: 0.8, threshold: 0.9, knee: 0.6 },
  exposure: 1.0,
  tonemap: 'agx', // 'agx' (neutral, filmic rolloff) | 'aces' (contrasty, saturated) | 'none' (clamp)
  contrast: 1.0, // display-space, pivot 0.5
  saturation: 1.0,
  temperature: 0.0, // -1 cool … +1 warm
  tint: 0.0, // -1 green … +1 magenta
  lift: [0, 0, 0], // shadows offset (display space)
  gamma: [1, 1, 1], // midtones
  gain: [1, 1, 1], // highlights multiplier
  vignette: 0.28,
  grain: 0.035,
  ca: 0.0012, // chromatic aberration at the frame edge (fraction of screen)
};

const _resolved = { bloom: {}, dof: null };
/** Merge a world's partial post object with defaults (allocation-free). */
export function resolvePost(p, out = {}) {
  const d = POST_DEFAULTS;
  p = p || {};
  out.dof = p.dof || null;
  const b = p.bloom || d.bloom;
  out.bloom = out.bloom || {};
  out.bloom.strength = b.strength ?? d.bloom.strength;
  out.bloom.radius = b.radius ?? d.bloom.radius;
  out.bloom.threshold = b.threshold ?? d.bloom.threshold;
  out.bloom.knee = b.knee ?? d.bloom.knee;
  out.exposure = p.exposure ?? d.exposure;
  out.tonemap = p.tonemap ?? d.tonemap;
  out.contrast = p.contrast ?? d.contrast;
  out.saturation = p.saturation ?? d.saturation;
  out.temperature = p.temperature ?? d.temperature;
  out.tint = p.tint ?? d.tint;
  out.lift = p.lift || d.lift;
  out.gamma = p.gamma || d.gamma;
  out.gain = p.gain || d.gain;
  out.vignette = p.vignette ?? d.vignette;
  out.grain = p.grain ?? d.grain;
  out.ca = p.ca ?? d.ca;
  return out;
}

const rtOpts = () => ({
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
});

const DOF_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;       // texel of the FULL-res source
uniform float uNear, uFar, uFocus, uAperture, uMaxBlur;
${hash}
float lin(vec2 uv){
  float z = texture2D(tDepth, uv).x;
  float ndc = z * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear));
}
float coc(float d){ return clamp((d - uFocus) / max(d, 1e-4) * uAperture, -1.0, 1.0) * uMaxBlur; }
void main(){
  // Half-resolution scatter-as-gather bokeh. The full-res image is kept wherever the blur is under ~2px (see combine).
  float d = lin(vUv);
  float c = abs(coc(d));
  vec3 acc = texture2D(tColor, vUv).rgb;
  float tot = 1.0;
  float ang = ign(gl_FragCoord.xy) * 6.2831853;
  for (int i = 0; i < TAPS; i++) {
    float t = (float(i) + 0.5) / float(TAPS);
    float r = sqrt(t) * uMaxBlur;
    ang += 2.39996323;
    vec2 uv = vUv + vec2(cos(ang), sin(ang)) * r * uTexel;
    float sd = lin(uv);
    float sc = abs(coc(sd));
    if (sd > d) sc = clamp(sc, 0.0, c * 2.0);       // keep blurry background from bleeding over sharp foreground
    float w = smoothstep(r - 1.0, r + 1.0, sc);     // a tap contributes only if its own blur disc reaches us
    vec3 s = min(texture2D(tColor, uv).rgb, vec3(48.0));
    acc += mix(acc / tot, s, w);
    tot += 1.0;
  }
  gl_FragColor = vec4(acc / tot, 1.0);
}`;

const DOWN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst, uThreshold, uKnee;
vec3 s(vec2 o){ return texture2D(tSrc, vUv + o * uTexel).rgb; }
float karis(vec3 c){ return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
void main(){
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0, 0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 col;
  if (uFirst > 0.5) {
    // Karis-weighted groups kill single-pixel fireflies before they smear into the whole chain.
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = karis(g0), w1 = karis(g1), w2 = karis(g2), w3 = karis(g3), w4 = karis(g4);
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) / (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
    float br = max(col.r, max(col.g, col.b));
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
    if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
    col = min(col, vec3(64.0));
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

const UP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tLow;   // smaller mip (already upsampled chain)
uniform sampler2D tHigh;  // this level's downsample
uniform vec2 uTexel;      // texel of tLow
uniform float uRadius;
void main(){
  vec4 d = uTexel.xyxy * vec4(1.0, 1.0, -1.0, 0.0);
  vec3 s = texture2D(tLow, vUv - d.xy).rgb + texture2D(tLow, vUv - d.wy).rgb * 2.0 + texture2D(tLow, vUv - d.zy).rgb
         + texture2D(tLow, vUv + d.zw).rgb * 2.0 + texture2D(tLow, vUv).rgb * 4.0 + texture2D(tLow, vUv + d.xw).rgb * 2.0
         + texture2D(tLow, vUv + d.zy).rgb + texture2D(tLow, vUv + d.wy).rgb * 2.0 + texture2D(tLow, vUv + d.xy).rgb;
  gl_FragColor = vec4(mix(texture2D(tHigh, vUv).rgb, s / 16.0, uRadius), 1.0);
}`;

const COMBINE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tDof;
uniform sampler2D tDepth;
uniform float uStrength, uDof;
uniform float uNear, uFar, uFocus, uAperture, uMaxBlur;
void main(){
  vec3 c = texture2D(tScene, vUv).rgb;
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  c = max(c, 0.0);
  if (uDof > 0.5) {
    float z = texture2D(tDepth, vUv).x;
    float ndc = z * 2.0 - 1.0;
    float d = 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear));
    float coc = abs(clamp((d - uFocus) / max(d, 1e-4) * uAperture, -1.0, 1.0)) * uMaxBlur;
    c = mix(c, texture2D(tDof, vUv).rgb, smoothstep(0.5, 2.5, coc));
  }
  c += texture2D(tBloom, vUv).rgb * uStrength;
  gl_FragColor = vec4(c, 1.0);
}`;

/** DOF → bloom → combined linear HDR, written to `out`. Shared by all worlds (buffers are reused). */
export class PostChain {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.levels = quality.level >= 2 ? 7 : 6;
    const taps = quality.level >= 2 ? 40 : quality.level === 1 ? 28 : 18;
    this.dofPass = new FSPass(
      DOF_FRAG,
      {
        tColor: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 100 },
        uFocus: { value: 5 },
        uAperture: { value: 1 },
        uMaxBlur: { value: 10 },
      },
      { defines: { TAPS: taps } },
    );
    this.downPass = new FSPass(DOWN_FRAG, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uFirst: { value: 0 },
      uThreshold: { value: 1 },
      uKnee: { value: 0.5 },
    });
    this.upPass = new FSPass(UP_FRAG, {
      tLow: { value: null },
      tHigh: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uRadius: { value: 0.8 },
    });
    this.combinePass = new FSPass(COMBINE_FRAG, {
      tScene: { value: null },
      tBloom: { value: null },
      tDof: { value: null },
      tDepth: { value: null },
      uStrength: { value: 0.5 },
      uDof: { value: 0 },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uFocus: { value: 5 },
      uAperture: { value: 1 },
      uMaxBlur: { value: 10 },
    });
    this.dofRT = new THREE.WebGLRenderTarget(4, 4, rtOpts());
    this.down = [];
    this.up = [];
    this.width = 4;
    this.height = 4;
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    this.dofRT.setSize(Math.max(2, Math.round(w / 2)), Math.max(2, Math.round(h / 2)));
    for (const rt of [...this.down, ...this.up]) rt.dispose();
    this.down = [];
    this.up = [];
    let mw = Math.max(2, Math.round(w / 2));
    let mh = Math.max(2, Math.round(h / 2));
    for (let i = 0; i < this.levels; i++) {
      this.down.push(new THREE.WebGLRenderTarget(mw, mh, rtOpts()));
      if (i < this.levels - 1) this.up.push(new THREE.WebGLRenderTarget(mw, mh, rtOpts()));
      if (Math.min(mw, mh) <= 4) break;
      mw = Math.max(2, Math.round(mw / 2));
      mh = Math.max(2, Math.round(mh / 2));
    }
  }

  /**
   * @param {THREE.WebGLRenderTarget} src world output (linear HDR, optional depthTexture)
   * @param {object} post resolved post settings
   * @param {THREE.PerspectiveCamera|null} camera
   * @param {THREE.WebGLRenderTarget} out destination (same size as src)
   */
  process(src, post, camera, out) {
    const r = this.renderer;
    const colorTex = src.texture;
    const cu = this.combinePass.uniforms;

    if (post.dof && src.depthTexture && camera) {
      const u = this.dofPass.uniforms;
      const maxBlur = (post.dof.maxBlur ?? 10) * (src.height / 1080);
      u.tColor.value = colorTex;
      u.tDepth.value = src.depthTexture;
      u.uTexel.value.set(1 / src.width, 1 / src.height);
      cu.uNear.value = u.uNear.value = camera.near;
      cu.uFar.value = u.uFar.value = camera.far;
      cu.uFocus.value = u.uFocus.value = post.dof.focus ?? 5;
      cu.uAperture.value = u.uAperture.value = post.dof.aperture ?? 1;
      cu.uMaxBlur.value = u.uMaxBlur.value = maxBlur;
      this.dofPass.render(r, this.dofRT);
      cu.tDof.value = this.dofRT.texture;
      cu.tDepth.value = src.depthTexture;
      cu.uDof.value = 1;
    } else {
      cu.tDof.value = null;
      cu.tDepth.value = null;
      cu.uDof.value = 0;
    }

    const n = this.down.length;
    const strength = post.bloom.strength;
    if (strength > 0.0001 && n > 1) {
      const du = this.downPass.uniforms;
      du.uThreshold.value = post.bloom.threshold;
      du.uKnee.value = Math.max(1e-4, post.bloom.knee);
      let prevTex = colorTex;
      let pw = src.width;
      let ph = src.height;
      for (let i = 0; i < n; i++) {
        du.tSrc.value = prevTex;
        du.uTexel.value.set(1 / pw, 1 / ph);
        du.uFirst.value = i === 0 ? 1 : 0;
        this.downPass.render(r, this.down[i]);
        prevTex = this.down[i].texture;
        pw = this.down[i].width;
        ph = this.down[i].height;
      }
      const uu = this.upPass.uniforms;
      uu.uRadius.value = post.bloom.radius;
      let low = this.down[n - 1];
      for (let i = n - 2; i >= 0; i--) {
        uu.tLow.value = low.texture;
        uu.tHigh.value = this.down[i].texture;
        uu.uTexel.value.set(1 / low.width, 1 / low.height);
        this.upPass.render(r, this.up[i]);
        low = this.up[i];
      }
      this.combinePass.uniforms.tBloom.value = low.texture;
      this.combinePass.uniforms.uStrength.value = strength;
    } else {
      this.combinePass.uniforms.tBloom.value = null;
      this.combinePass.uniforms.uStrength.value = 0;
    }
    this.combinePass.uniforms.tScene.value = colorTex;
    this.combinePass.render(r, out);
  }
}

const FINISH_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tA;
uniform sampler2D tB;
uniform float uMix;        // 0 = world A, 1 = world B
uniform float uTime;
uniform vec2 uRes;
uniform float uExposure, uContrast, uSaturation, uVignette, uGrain, uCA, uFade;
uniform float uTonemap;    // 0 agx, 1 aces, 2 none
uniform vec3 uWB, uLift, uGamma, uGain;
${hash}
${color}

// ---- world-to-world transition: the outgoing world is noised into coarse "latents", the incoming one is denoised out of them.
vec3 blockSample(sampler2D t, vec2 frag, float b){
  vec2 uv = (floor(frag / b) + 0.5) * b / uRes;
  return texture2D(t, uv).rgb;
}
vec3 sceneAt(vec2 uv){
  if (uMix <= 0.0005) return texture2D(tA, uv).rgb;
  if (uMix >= 0.9995) return texture2D(tB, uv).rgb;
  vec2 frag = uv * uRes;
  float s = uRes.y / 1080.0;
  float k = 1.0 - abs(uMix * 2.0 - 1.0);                 // 0 → 1 → 0
  float lvl = smoothstep(0.0, 1.0, k) * 4.7;             // up to ~24px latents at 1080p
  float b0 = exp2(floor(lvl)) * s, b1 = b0 * 2.0;
  float f = smoothstep(0.2, 0.8, fract(lvl));
  vec3 a = mix(blockSample(tA, frag, b0), blockSample(tA, frag, b1), f);
  vec3 b = mix(blockSample(tB, frag, b0), blockSample(tB, frag, b1), f);
  // each coarse block flips from A to B at its own moment
  float cell = 48.0 * s;
  float id = hash12(floor(frag / cell) + 7.0);
  float id2 = hash12(floor(frag / (cell * 0.25)) + 3.0);
  float sel = smoothstep(0.40, 0.60, uMix + (id - 0.5) * 0.26 + (id2 - 0.5) * 0.14);
  vec3 c = mix(a, b, sel);
  // mostly-monochrome noise that "boils" at the latent scale, strongest mid-transition
  vec2 nb = floor(frag / max(s, b0 * 0.5));
  float tick = floor(uTime * 20.0);
  float n = hash12(nb + tick * 13.7) + hash12(nb.yx + 91.7 + tick * 5.1) - 1.0;
  vec3 chroma = hash32(nb + tick * 3.3) - 0.5;
  float amt = k * k;
  c = c * (1.0 + n * amt * 0.9) + (abs(n) * 0.05 + chroma * 0.035) * amt;
  return max(c, 0.0);
}

vec3 agxContrast(vec3 x){
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 tonemapAgX(vec3 c){
  const mat3 toRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 toSRGBlin = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float minEv = -12.47393, maxEv = 4.026069;
  c = inset * (toRec2020 * c);
  c = clamp((log2(max(c, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
  c = agxContrast(c);
  // "punchy" look: a touch more contrast + saturation than base AgX, which is deliberately flat
  c = pow(max(c, 0.0), vec3(1.18));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = l + 1.22 * (c - l);
  c = outset * c;
  c = pow(max(c, 0.0), vec3(2.2));
  return clamp(toSRGBlin * c, 0.0, 1.0);
}
vec3 tonemapACES(vec3 c){
  // Stephen Hill's fit (RRT + ODT)
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = inM * (c / 0.6);
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(outM * (a / b), 0.0, 1.0);
}

void main(){
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float aspect = uRes.x / uRes.y;
  float r2 = dot(d, d);
  vec3 c;
  if (uCA > 0.00001) {
    vec2 off = d * (r2 * 4.0) * uCA;
    c.r = sceneAt(uv + off).r;
    c.g = sceneAt(uv).g;
    c.b = sceneAt(uv - off).b;
  } else {
    c = sceneAt(uv);
  }

  // lens falloff in scene-referred space
  float vr = length(d * vec2(mix(1.0, aspect, 0.55), 1.0));
  float vig = 1.0 - uVignette * smoothstep(0.25, 0.95, vr);
  c *= uExposure * uWB * vig * vig;

  if (uTonemap < 0.5) c = tonemapAgX(c);
  else if (uTonemap < 1.5) c = tonemapACES(c);
  else c = clamp(c, 0.0, 1.0);

  c = toSRGB(c);
  c = (c - 0.5) * uContrast + 0.5;
  float l = luma(c);
  c = mix(vec3(l), c, uSaturation);
  c = c * uGain + uLift * (1.0 - c);
  c = pow(max(c, 0.0), 1.0 / max(uGamma, vec3(0.01)));

  // film grain (stronger in the mids/shadows) + triangular dither to kill banding in dark gradients
  vec2 gp = gl_FragCoord.xy + fract(uTime * 7.31) * vec2(113.0, 71.0);
  float g = hash12(gp) + hash12(gp + 19.19) - 1.0;
  c += g * uGrain * mix(1.0, 0.35, smoothstep(0.2, 0.95, l));
  c *= uFade;
  float tri = hash12(gl_FragCoord.xy + 0.37 + fract(uTime) * 61.0) + hash12(gl_FragCoord.xy + 5.71 + fract(uTime) * 61.0) - 1.0;
  c += tri / 255.0;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const TONEMAPS = { agx: 0, aces: 1, none: 2 };
const lerp = (a, b, t) => a + (b - a) * t;

/** Transition blend + lens + tonemap + grade + grain → screen. */
export class Finisher {
  constructor(renderer) {
    this.renderer = renderer;
    this.pass = new FSPass(FINISH_FRAG, {
      tA: { value: null },
      tB: { value: null },
      uMix: { value: 0 },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uExposure: { value: 1 },
      uContrast: { value: 1 },
      uSaturation: { value: 1 },
      uVignette: { value: 0.25 },
      uGrain: { value: 0.03 },
      uCA: { value: 0.001 },
      uFade: { value: 1 },
      uTonemap: { value: 0 },
      uWB: { value: new THREE.Vector3(1, 1, 1) },
      uLift: { value: new THREE.Vector3() },
      uGamma: { value: new THREE.Vector3(1, 1, 1) },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
    });
  }

  /** a/b: resolved post settings of the two worlds (b may be null). */
  render(texA, texB, mix, a, b, time, fade, width, height) {
    const u = this.pass.uniforms;
    const m = texB && b ? mix : 0;
    const B = texB && b ? b : a;
    u.tA.value = texA;
    u.tB.value = texB || texA;
    u.uMix.value = m;
    u.uTime.value = time;
    u.uRes.value.set(width, height);
    u.uExposure.value = lerp(a.exposure, B.exposure, m);
    u.uContrast.value = lerp(a.contrast, B.contrast, m);
    u.uSaturation.value = lerp(a.saturation, B.saturation, m);
    u.uVignette.value = lerp(a.vignette, B.vignette, m);
    u.uGrain.value = lerp(a.grain, B.grain, m);
    u.uCA.value = lerp(a.ca, B.ca, m);
    u.uFade.value = fade;
    u.uTonemap.value = TONEMAPS[m < 0.5 ? a.tonemap : B.tonemap] ?? 0;
    const temp = lerp(a.temperature, B.temperature, m);
    const tint = lerp(a.tint, B.tint, m);
    u.uWB.value.set(1 + temp * 0.14 + tint * 0.05, 1 - tint * 0.08, 1 - temp * 0.14 + tint * 0.05);
    for (let i = 0; i < 3; i++) {
      u.uLift.value.setComponent(i, lerp(a.lift[i], B.lift[i], m));
      u.uGamma.value.setComponent(i, lerp(a.gamma[i], B.gamma[i], m));
      u.uGain.value.setComponent(i, lerp(a.gain[i], B.gain[i], m));
    }
    this.pass.render(this.renderer, null);
  }
}

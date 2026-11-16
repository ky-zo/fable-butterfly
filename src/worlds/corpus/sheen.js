// Moonlight in a clear wing. A glasswing's membrane is a film a few hundred nanometres thick: face-on it gives back
// almost nothing, which is the animal's whole trick — but turn it so that it throws the moon, or the moon's road on
// the water, at the eye, and for an instant the film lights up, tinted by its own thickness. Over a dark sea that
// flicker, once a stroke, is most of what there is to see of a butterfly at night.
//
// This is that light and nothing else: an additive pass over the kit's wings (same geometry, same rig, same markings),
// drawn after the kit's own materials. It knows where the pigment is (the kit's own bfPigmentBand), so each part of the
// wing answers the moon in its own way:
//   the membrane   the film's two colours and a thread of a third (cyan, violet, pale gold: the kit's palette), in
//                  broad sweeps across the cells; silver when the wing is edge-on
//   the margin     a hairline of silver all the way round: the fringe of the last row of scales, lit from behind
//   the ember      the band inside the outer margins passes the moon like stained glass, amber at its core and
//                  crimson on its shoulders. The black either side of it stays black
//   the white bar  pearl: it is the brightest thing on the animal, by reflection and with the moon behind it
//   single scales  a few of them face the moon just so, and flash
// On the hero it is the glint in the wing; on the others it is most of what there is to see of them.

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { wingVertexGLSL, atlasGLSL, pigmentGLSL } from '../../shared/butterfly/index.js';

const VERT = /* glsl */ `
${wingVertexGLSL}
varying vec2 vP;
varying vec3 vEdge;
varying vec2 vWing;
varying vec3 vW;
varying vec3 vTx;
varying vec3 vTy;
varying float vSeed;
void main(){
  vec3 b, tx, ty;
  bfWingFrame(b, tx, ty);
  mat4 m = bfModel();
  vec4 wp = m * vec4(b, 1.0);
  vW = wp.xyz;
  vTx = normalize(mat3(m) * tx);
  vTy = normalize(mat3(m) * ty);
  vP = position.xy; vEdge = aEdge; vWing = aWing; vSeed = BF_LOOK.z;
  vec4 vp = viewMatrix * wp;
  gl_Position = projectionMatrix * vp;
}`;

// (the film, as the kit's own wing has it: the same thickness and the same colours, so that the light this pass adds
// lies in the sweeps the kit's membrane already shows)
export const FILM_GLSL = /* glsl */ `
float wlFilm(vec2 p, float g, float wr, float grain, float seed){
  return 244.0 + 64.0 * (1.0 - g) * (0.62 + 0.38 * wr) + 20.0 * grain + 60.0 * wr + 66.0 * sin(p.x * 0.21 + p.y * 0.13 + seed * 9.0) + 48.0 * sin(p.x * 0.09 - p.y * 0.33 + seed * 5.0);
}
vec3 wlFilmCol(float opd){
  float h = opd / 170.0;
  vec3 c = mix(vec3(0.66, 0.54, 1.0), vec3(0.42, 0.86, 1.0), 0.5 + 0.5 * cos(6.2831853 * h));
  float g = 0.5 + 0.5 * cos(6.2831853 * (h * 0.5 + 0.21));
  return mix(c, vec3(1.0, 0.82, 0.52), g * g * g * 0.7);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vP;
varying vec3 vEdge;
varying vec2 vWing;
varying vec3 vW;
varying vec3 vTx;
varying vec3 vTy;
varying float vSeed;
uniform sampler2D tVein, tNoise;
uniform vec3 uMoonDir, uMoonCol;
uniform vec4 uSheen;      // the film's flash, its steady glow, the ember, the pearl of the bar
uniform vec4 uRim;        // the silver line round the margin: how bright, how many pixels wide at least; the far-off line (see hero.js); single scales
uniform vec4 uLamp;
${hash}
${atlasGLSL}
${pigmentGLSL}
${FILM_GLSL}
void main(){
  float px = max(length(dFdx(vP)), length(dFdy(vP)));            // millimetres per pixel
  float inside = smoothstep(-0.7 * px, 0.7 * px, vEdge.x);
  if (inside < 0.004) discard;
  vec3 V = normalize(cameraPosition - vW);
  vec3 N0 = normalize(cross(vTx, vTy));
  if (dot(N0, V) < 0.0) N0 = -N0;
  float ndv0 = dot(N0, V);
  vec4 vf = texture2D(tVein, bfAtlasUV(vP, vWing.y));
  vec4 n1 = texture2D(tNoise, vP * 0.047 + vWing.yx * 0.37 + vSeed);
  // the film is not flat: wrinkles fan out from the hinge, and it rises a little to every vein
  float th = atan(vP.y, vP.x + 3.0);
  float wr = texture2D(tNoise, vec2(th * 2.7 + vSeed, length(vP + vec2(3.0, 0.0)) * 0.011)).g;
  vec2 bump = (n1.rg - 0.5) * 0.09 + vec2(-sin(th), cos(th)) * (wr - 0.5) * 0.15 + (vf.g - 0.3) * vec2(0.05, -0.04);
  vec3 N = normalize(N0 + vTx * bump.x + vTy * bump.y);
  float NdV = abs(dot(N, V));
  vec3 R = reflect(-V, N);
  vec4 band;
  vec4 pg = bfPigmentBand(vP, vEdge, vWing.y, vf, px, 0.0, band);
  float mem = (1.0 - pg.x) * (1.0 - pg.y);
  // the moon, and under the horizon the same again: its road on the water
  float mr = max(dot(vec3(R.x, abs(R.y), R.z), uMoonDir), 0.0);
  float flash = pow(mr, 22.0);
  float glow = pow(mr, 3.0);
  float back = max(dot(-V, uMoonDir), 0.0);
  float back3 = back * back * back;

  // ---- the membrane: the film's own colours where it is half turned, silver where it is edge-on
  vec3 film = wlFilmCol(wlFilm(vP, vf.g, wr, n1.r, vSeed) * sqrt(1.0 - (1.0 - NdV * NdV) / 2.25));
  vec3 tint = mix(vec3(1.0), film * 1.35, 0.9 * mix(0.25, 1.0, smoothstep(0.05, 0.36, NdV)));
  float graze = 0.35 + 0.65 * pow(1.0 - NdV, 2.0);
  // (the steady glow is the sky round the moon, mirrored: it takes the cool half of the film only, at full strength,
  // and it lies in the sweeps the film's thickness makes — a wing with an even glow over it is a dusty wing)
  float lum = dot(film, vec3(0.3, 0.5, 0.2));
  vec3 cool = max(mix(vec3(lum), film * vec3(0.8, 1.0, 1.25), 1.7), 0.0);
  // (from far off the sweeps have run together, and a wing of one colour is a tinted wing: there it is silver)
  cool = mix(cool, vec3(lum) * vec3(0.86, 0.96, 1.12), smoothstep(0.14, 0.45, px));
  float sweep = smoothstep(0.25, 0.85, 0.5 + 0.5 * sin(vP.x * 0.21 + vP.y * 0.13 + vSeed * 9.0 + 3.0 * wr));
  vec3 c = uMoonCol * (tint * flash * uSheen.x + cool * glow * uSheen.y * (0.25 + 1.5 * sweep)) * mem * graze;
  // …and near the end, a little of the lamp
  vec3 tl = normalize(uLamp.xyz - vW);
  c += vec3(1.0, 0.5, 0.17) * uLamp.w * pow(max(dot(vec3(R.x, abs(R.y), R.z), tl), 0.0), 30.0) * 0.5 * mem;

  // ---- the ember: scales pass light. Seen against the moon the band is stained glass, and only the band
  float eK = band.x * smoothstep(0.03, 0.26, ndv0);
  vec3 emberT = mix(vec3(1.0, 0.5, 0.07), vec3(0.6, 0.035, 0.012), band.y);
  c += uMoonCol * emberT * eK * uSheen.z * (0.12 + 0.88 * back3);

  // ---- the white bar and the dots of the margin: pearl. Milk glass with the moon behind it, and the first thing
  // on the wing to throw the moon back
  c += uMoonCol * vec3(1.0, 0.95, 0.88) * pg.z * uSheen.w * (0.1 + 0.6 * back3 + 0.9 * pow(mr, 5.0));

  // ---- single scales on the border: every one lies a little differently, and the few that face the moon flash
  if (pg.y > 0.004 && uRim.w > 0.0) {
    float cs = max(0.17, 1.6 * px);
    vec2 cq = vP / cs;
    vec2 ci = floor(cq);
    vec2 hs = hash22(ci + vSeed * 17.0 + vWing * 7.0);
    vec3 Ns = normalize(N0 + (vTx * (hs.x - 0.5) + vTy * (hs.y - 0.5)) * 1.3);
    // (the moon is taken on whichever side of the wing the lens is: a scale stands proud of both faces)
    vec3 Lm = uMoonDir - 2.0 * min(dot(N0, uMoonDir), 0.0) * N0;
    float spot = smoothstep(0.36, 0.08, length(fract(cq) - 0.5)) * step(0.62, hash12(ci * 1.37 + 3.1));
    vec3 sparkC = mix(mix(vec3(0.55, 0.7, 1.0), vec3(1.0, 0.66, 0.26), eK), vec3(1.0, 0.97, 0.9), pg.z);
    c += uMoonCol * sparkC * spot * pg.y * uRim.w * pow(abs(dot(Ns, normalize(Lm + V))), mix(700.0, 150.0, smoothstep(0.1, 0.4, px))) * 3.0;
  }
  // (a wing seen exactly edge-on is a hairline, and a faint one)
  c *= 0.2 + 0.8 * smoothstep(0.0, 0.14, ndv0);

  // ---- the margin: the fringe of the last row of scales scatters the moon forward. A hairline of silver all the
  // way round the wing, which is what draws its shape where the border is black on a black sea. A tenth of a
  // millimetre of it: drawn no thinner than uRim.y pixels, and as faint as it is thin
  {
    float w = max(0.1, px * uRim.y);
    float line = 1.0 - smoothstep(0.3 * w, w, vEdge.x);
    c += uMoonCol * vec3(0.86, 0.93, 1.0) * uRim.x * line * clamp(0.1 / w, 0.3, 1.0) * (0.14 + 0.86 * back * back);
  }
  // far off, against the glitter, the wing is a dark shape (see hero.js) and this is what draws it: the moon caught
  // all the way round its edge. The line is kept a pixel or two wide however small the wing is in the frame.
  if (uRim.z > 0.0) {
    float w = max(px * 1.6, 0.12);
    c += uMoonCol * uRim.z * (1.0 - smoothstep(0.35 * w, w, vEdge.x));
  }
  gl_FragColor = vec4(c * inside, 0.0);
}`;

// What the film does to light that comes THROUGH it. The colours a film throws back are missing from what it lets
// past, so against something bright — the moon's disc, its road — a clear wing is not white: it is the faintest
// stained glass, in the same sweeps as its sheen. This pass is that and nothing else: the four wings once more,
// multiplying what is already in the picture behind them (never more than a seventh of any colour, and nothing at all
// where there is pigment). Over dark water it does nothing that can be seen.
const FILTER_FRAG = /* glsl */ `
precision highp float;
varying vec2 vP;
varying vec3 vEdge;
varying vec2 vWing;
varying vec3 vW;
varying vec3 vTx;
varying vec3 vTy;
varying float vSeed;
uniform sampler2D tVein, tNoise;
uniform float uFilter;
${hash}
${atlasGLSL}
${pigmentGLSL}
${FILM_GLSL}
void main(){
  float px = max(length(dFdx(vP)), length(dFdy(vP)));
  float inside = smoothstep(-0.7 * px, 0.7 * px, vEdge.x);
  if (inside < 0.004) discard;
  vec3 V = normalize(cameraPosition - vW);
  vec3 N0 = normalize(cross(vTx, vTy));
  float NdV = abs(dot(N0, V));
  vec4 vf = texture2D(tVein, bfAtlasUV(vP, vWing.y));
  vec4 n1 = texture2D(tNoise, vP * 0.047 + vWing.yx * 0.37 + vSeed);
  float th = atan(vP.y, vP.x + 3.0);
  float wr = texture2D(tNoise, vec2(th * 2.7 + vSeed, length(vP + vec2(3.0, 0.0)) * 0.011)).g;
  vec4 pg = bfPigment(vP, vEdge, vWing.y, vf, px);
  float mem = (1.0 - pg.x) * (1.0 - pg.y);
  vec3 film = wlFilmCol(wlFilm(vP, vf.g, wr, n1.r, vSeed) * sqrt(1.0 - (1.0 - NdV * NdV) / 2.25));
  film /= max(film.r, max(film.g, film.b));
  // (most where the film is half turned from the eye; edge-on next to none)
  float k = uFilter * (0.45 + 0.55 * smoothstep(1.0, 0.6, NdV)) * smoothstep(0.03, 0.3, NdV) * mem * inside;
  gl_FragColor = vec4(1.0 - k * (1.0 - film), 1.0);
}`;

/** The film as a filter on what is behind the wing (see FILTER_FRAG). amount: { value } 0 … 1; pose as for the sheen. */
export function makeFilterMaterial(ctx, kit, amount, pose) {
  return ctx.track(
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FILTER_FRAG,
      uniforms: { tVein: { value: kit.atlas.veins }, tNoise: { value: kit.noise }, uFilter: amount, ...pose },
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    }),
  );
}

/**
 * @param U      the world's uniform bag (uMoonDir, uMoonCol, uLamp)
 * @param kit    the butterfly kit (its vein atlas and its noise)
 * @param sheen  Vector4: the film's flash, its glow, the ember, the pearl
 * @param pose   poseUniforms-style uniforms for a single animal ({ uPose, uShape, uLook }); omit for an InstancedMesh
 * @param rim    Vector4: the silver line round the margin (brightness, least width in pixels), the far-off line, single scales
 */
export function makeSheenMaterial(ctx, U, kit, sheen, pose = null, rim = null) {
  return ctx.track(
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { tVein: { value: kit.atlas.veins }, tNoise: { value: kit.noise }, uMoonDir: U.uMoonDir, uMoonCol: U.uMoonCol, uLamp: U.uLamp, uSheen: { value: sheen }, uRim: { value: rim || new THREE.Vector4(0.5, 1.3, 0, 1) }, ...(pose || {}) },
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    }),
  );
}

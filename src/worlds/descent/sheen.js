// Lamplight in a clear wing, and the rig that lights the kit's own materials at night.
//
// A glasswing's membrane gives back almost nothing face-on, and the kit's own wing draws that: clear glass, a black
// border, an ember inside it, a white bar. What a lamp does to such a wing, the kit's one key light cannot say alone.
// This is that light and nothing else: an additive pass over the kit's wings (same geometry, same rig, same markings
// — it asks the kit's own bfPigmentBand where the pigment is), drawn after the kit's own materials.
//   with the light BEHIND the wing it is a window of stained glass: the ember band inside the outer margins glows
//       amber at its core and crimson on its shoulders, the black either side of it stays black, the white bar and
//       the dots of the margin are milk glass, a hairline of light runs round the margin (the fringe of the last row
//       of scales) and along every vein, and the clear cells hold only a breath of warm haze near the flame
//   with the light on the LENS'S SIDE the film throws it back for an instant each stroke, in its own two colours and
//       a thread of a third, and single scales on the border flash
//   and under the night sky alone the film has a cold sheen where it is turned, and a silver line round its margin,
//       which is what there is to see of a clear wing over dark ground.
// On the hero it is the glow in the wing; on the others it is most of what there is to see of them.

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
  gl_Position = projectionMatrix * viewMatrix * wp;
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
uniform vec4 uLamp;        // xyz, how bright 0..1
uniform vec3 uLampCol, uSunDir, uSunCol, uSkyUp, uKeyDir, uKeyCol;
uniform vec4 uSheen;       // the film's flash, the haze in the cells, the ember, the pearl of the bar
uniform vec4 uMore;        // the line of light round the margin, the veins' line, single scales, the night sky in the film
uniform float uGain;
${hash}
${atlasGLSL}
${pigmentGLSL}
// (the film, as the kit's own wing has it: the same thickness and the same colours — cyan, violet, a thread of gold)
float wlFilm(vec2 p, float g, float wr, float grain, float seed){
  return 244.0 + 64.0 * (1.0 - g) * (0.62 + 0.38 * wr) + 20.0 * grain + 60.0 * wr + 66.0 * sin(p.x * 0.21 + p.y * 0.13 + seed * 9.0) + 48.0 * sin(p.x * 0.09 - p.y * 0.33 + seed * 5.0);
}
vec3 wlFilmCol(float opd){
  float h = opd / 170.0;
  vec3 c = mix(vec3(0.66, 0.54, 1.0), vec3(0.42, 0.86, 1.0), 0.5 + 0.5 * cos(6.2831853 * h));
  float g = 0.5 + 0.5 * cos(6.2831853 * (h * 0.5 + 0.21));
  return mix(c, vec3(1.0, 0.82, 0.52), g * g * g * 0.7);
}
// what the wing is made of at this pixel, worked out once and used for every light
struct Wing {
  vec3 N0, N, V, R;
  float NdV, ndv0, mem, vein, ember, heat, white, scaled, line, graze, dust, px;
  vec3 tint, spark, Ns;
  float spot;
};
// one light on one point of the wing: E its colour there, L the way to it
vec3 lit(vec3 E, vec3 L, Wing w){
  float nl = dot(w.N0, L);
  float behind = smoothstep(0.04, -0.04, nl);                // the light is on the far side of the wing
  float thru = max(dot(-w.V, L), 0.0);
  float t2 = thru * thru, t3 = t2 * thru;
  float mr = max(dot(w.R, L), 0.0);
  float fl = pow(mr, 30.0);
  // ---- the membrane: the film throws the light back, in its own colours…
  vec3 c = E * w.tint * (fl + 0.03 * pow(mr, 3.0)) * uSheen.x * w.mem * w.graze * (1.0 - behind);
  // …or lets it through: clear, but for a breath of warm haze where the line of sight passes near the light
  c += E * behind * w.mem * uSheen.y * (0.004 + 0.02 * w.dust) * (0.25 + 4.0 * t3 * t3);
  // a vein is a glass tube: with the light behind it, it carries a thread of it
  c += E * behind * w.vein * uMore.y * (0.03 + 0.3 * t3);
  // ---- the ember: stained glass. (The light is taken a little whiter than the flame: an amber pane in front of an
  // orange lamp is amber, and a crimson one crimson; with the flame's own colour both would only be red.)
  vec3 Ew = mix(E, vec3(dot(E, vec3(0.3, 0.5, 0.2))) * vec3(1.0, 0.9, 0.72), 0.45);
  vec3 emberT = mix(vec3(1.0, 0.56, 0.1), vec3(0.62, 0.04, 0.012), w.heat);
  c += Ew * emberT * w.ember * uSheen.z * (0.03 + behind * (0.2 + 1.3 * t3));
  // ---- the white bar and the dots of the margin: milk glass from behind, pearl from in front
  c += Ew * vec3(1.0, 0.95, 0.86) * w.white * uSheen.w * (behind * (0.16 + 0.9 * t3) + (1.0 - behind) * (0.05 + 0.8 * pow(mr, 5.0)));
  // ---- the margin: the fringe of the last row of scales scatters light forward — a hairline of it round the wing
  c += Ew * w.line * uMore.x * (0.05 + 0.95 * t2) * (0.3 + 0.7 * behind);
  // ---- single scales: every one lies a little differently, and the few that face the light just so, flash
  vec3 Lm = L - 2.0 * min(nl, 0.0) * w.N0;
  c += Ew * w.spark * w.spot * uMore.z * pow(abs(dot(w.Ns, normalize(Lm + w.V))), mix(600.0, 140.0, smoothstep(0.1, 0.4, w.px))) * 3.5;
  return c;
}
void main(){
  Wing w;
  float px = max(length(dFdx(vP)), length(dFdy(vP)));            // millimetres per pixel
  float inside = smoothstep(-0.7 * px, 0.7 * px, vEdge.x);
  if (inside < 0.004) discard;
  w.px = px;
  w.V = normalize(cameraPosition - vW);
  w.N0 = normalize(cross(vTx, vTy));
  if (dot(w.N0, w.V) < 0.0) w.N0 = -w.N0;
  w.ndv0 = dot(w.N0, w.V);
  vec4 vf = texture2D(tVein, bfAtlasUV(vP, vWing.y));
  vec4 n1 = texture2D(tNoise, vP * 0.047 + vWing.yx * 0.37 + vSeed);
  // the film is not flat: wrinkles fan out from the hinge, and it rises a little to every vein
  float th = atan(vP.y, vP.x + 3.0);
  float wr = texture2D(tNoise, vec2(th * 2.7 + vSeed, length(vP + vec2(3.0, 0.0)) * 0.011)).g;
  vec2 bump = (n1.rg - 0.5) * 0.09 + vec2(-sin(th), cos(th)) * (wr - 0.5) * 0.15 + (vf.g - 0.3) * vec2(0.05, -0.04);
  w.N = normalize(w.N0 + vTx * bump.x + vTy * bump.y);
  w.NdV = abs(dot(w.N, w.V));
  w.R = reflect(-w.V, w.N);
  vec4 band;
  vec4 pg = bfPigmentBand(vP, vEdge, vWing.y, vf, px, 0.0, band);
  w.vein = pg.x * (1.0 - pg.y);
  w.scaled = pg.y;
  w.mem = (1.0 - pg.x) * (1.0 - pg.y);
  // (edge-on, the band is a dark line: light does not come through a scale along its length)
  w.ember = band.x * smoothstep(0.03, 0.26, w.ndv0);
  w.heat = band.y;
  w.white = pg.z;
  vec3 film = wlFilmCol(wlFilm(vP, vf.g, wr, n1.r, vSeed) * sqrt(1.0 - (1.0 - w.NdV * w.NdV) / 2.25));
  w.tint = mix(vec3(1.0), film * 1.35, 0.9 * mix(0.25, 1.0, smoothstep(0.05, 0.36, w.NdV)));
  w.graze = 0.3 + 0.7 * pow(1.0 - w.NdV, 2.0);
  w.dust = n1.g * (0.4 + 0.6 * wr);
  // (a tenth of a millimetre of fringe: drawn no thinner than a pixel and a bit, and as faint as it is thin)
  float lw = max(0.1, px * 1.3);
  w.line = (1.0 - smoothstep(0.3 * lw, lw, vEdge.x)) * clamp(0.1 / lw, 0.3, 1.0);
  float cs = max(0.17, 1.6 * px);
  vec2 cq = vP / cs;
  vec2 ci = floor(cq);
  vec2 hs = hash22(ci + vSeed * 17.0 + vWing * 7.0);
  w.Ns = normalize(w.N0 + (vTx * (hs.x - 0.5) + vTy * (hs.y - 0.5)) * 1.3);
  w.spot = smoothstep(0.36, 0.08, length(fract(cq) - 0.5)) * step(0.6, hash12(ci * 1.37 + 3.1)) * pg.y;
  w.spark = mix(mix(vec3(0.5, 0.62, 1.0), vec3(1.0, 0.7, 0.3), w.ember), vec3(1.0, 0.97, 0.9), pg.z) * (0.25 + 0.75 * max(w.ember, pg.z));

  vec3 tl = uLamp.xyz - vW;
  float r2 = dot(tl, tl);
  // (each light only where there is any of it: the lamp is nothing from the far hill, and there is no sun at night)
  vec3 c = vec3(0.0);
  float lampK = uLamp.w / (1.0 + r2 * 0.3);
  if (lampK > 0.004) c += lit(uLampCol * lampK, tl * inversesqrt(r2), w);
  if (uSunCol.r > 0.002) c += lit(uSunCol * 0.16, uSunDir, w);
  // ---- the night itself: the light the land is seen by, in the film (a cold flash once a stroke), and the sky
  // in it where it is turned from the eye — silver, and never a sheet: face-on the film gives the sky nothing back
  float mk = max(dot(w.R, uKeyDir), 0.0);
  vec3 cool = mix(vec3(dot(film, vec3(0.3, 0.5, 0.2))), film * vec3(0.8, 1.0, 1.25), 1.5);
  cool = mix(max(cool, 0.0), vec3(0.9, 0.97, 1.1), smoothstep(0.14, 0.45, px));
  // (the paler side of the sky is a broad light and the film gives back a hundredth of it: a glint where a wrinkle
  // of the film turns just so, and a breath round it. A wing lit evenly by it was a white wing, and a moth's)
  c += uKeyCol * cool * (pow(mk, 70.0) * 0.13 + pow(mk, 6.0) * 0.012) * uMore.w * w.mem * w.graze;
  c += uSkyUp * cool * pow(1.0 - w.NdV, 4.0) * 0.1 * uMore.w * w.mem;
  c += uKeyCol * vec3(1.0, 0.95, 0.88) * w.white * uMore.w * (0.25 + 1.2 * pow(mk, 5.0));
  // (a wing seen exactly edge-on is a hairline, and a faint one)
  c *= 0.2 + 0.8 * smoothstep(0.0, 0.14, w.ndv0);
  // …and the silver line round its margin
  c += uSkyUp * vec3(0.9, 0.97, 1.08) * w.line * uMore.x * uMore.w * 0.55;
  gl_FragColor = vec4(c * inside * uGain, 0.0);
}`;

/**
 * @param U      the world's uniform bag (uLamp, uLampCol, uSunDir, uSunCol, uSkyUp, uKeyDir, uKeyCol)
 * @param kit    the butterfly kit (its vein atlas and its noise)
 * @param sheen  Vector4: the film's flash, the haze in the cells, the ember, the pearl
 * @param more   Vector4: the line round the margin, the veins' line, single scales, how much of the night sky is in the film
 * @param pose   poseUniforms-style uniforms for a single animal ({ uPose, uShape, uLook }); omit for an InstancedMesh
 */
export function makeSheenMaterial(ctx, U, kit, sheen, more, gain, pose = null) {
  return ctx.track(
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { tVein: { value: kit.atlas.veins }, tNoise: { value: kit.noise }, uLamp: U.uLamp, uLampCol: U.uLampCol, uSunDir: U.uSunDir, uSunCol: U.uSunCol, uSkyUp: U.uSkyUp, uKeyDir: U.uKeyDir, uKeyCol: U.uKeyCol, uSheen: { value: sheen }, uMore: { value: more }, uGain: gain, ...(pose || {}) },
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

/**
 * The light a night with one lamp in it gives an insect, as a rig for the kit's materials (contract:
 * shared/butterfly/light.js). The key is whatever is brightest where the animal is — the lamp, close to it; the
 * morning, later — and the world says which (sunDir, sunColor). Besides that: the sky above, the ground below, and the
 * lamp as a point, for what the key does not cover.
 * Handles: sunDir, sunColor, sky, ground (Vector3), lamp (Vector4 xyz + gain), lampColor (Vector3), eye (Vector3: the
 * light a dark eye holds as one small catch-light — the flame, when it is near one).
 */
export function makeNightRig() {
  const h = {
    sunDir: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Vector3(0, 0, 0),
    sky: new THREE.Vector3(0.05, 0.07, 0.12),
    ground: new THREE.Vector3(0.02, 0.03, 0.05),
    lamp: new THREE.Vector4(0, -1e3, 0, 0),
    lampColor: new THREE.Vector3(0, 0, 0),
    eye: new THREE.Vector3(0, 0, 0),
  };
  const uniforms = {
    uBfEyeK: { value: h.eye },
    uBfSunDir: { value: h.sunDir },
    uBfSunCol: { value: h.sunColor },
    uBfSky: { value: h.sky },
    uBfGround: { value: h.ground },
    uBfLamp: { value: h.lamp },
    uBfLampCol: { value: h.lampColor },
  };
  const common = /* glsl */ `
uniform vec3 uBfSunDir, uBfSunCol;
#define BF_SUN_DIR uBfSunDir
#define BF_SUN_COL uBfSunCol
`;
  const vertex = /* glsl */ `
float bfSunVisV(vec3 P){ return 1.0; }
`;
  const fragment = /* glsl */ `
uniform vec3 uBfSky, uBfGround, uBfLampCol, uBfEyeK;
uniform vec4 uBfLamp;
vec3 bfLampAt(vec3 P, vec3 N, float lobe){
  vec3 d = uBfLamp.xyz - P;
  float r2 = dot(d, d);
  float c = max(dot(N, d) * inversesqrt(r2 + 1e-9), 0.0);
  return uBfLampCol * (uBfLamp.w / (1.0 + r2 * 0.3)) * mix(0.3 + 0.7 * c, pow(c, 50.0) * 6.0, lobe);
}
vec3 bfAmb(vec3 P, vec3 N){ return mix(uBfGround, uBfSky, 0.5 + 0.5 * N.y) + bfLampAt(P, N, 0.0); }
vec3 bfEnv(vec3 P, vec3 R, float soft){
  vec3 e = mix(uBfGround * 0.8, uBfSky * 1.5, smoothstep(-0.25 - soft, 0.5 + soft, R.y));
  e += BF_SUN_COL * 0.06 * pow(max(dot(R, BF_SUN_DIR), 0.0), mix(900.0, 12.0, soft));
  return e + bfLampAt(P, R, 1.0);
}
vec3 bfEyeKey(){ return uBfSky * 1.4 + BF_SUN_COL * 0.02 + uBfEyeK; }
vec4 bfFinish(vec3 col, float a, vec3 P){ return vec4(col, a); }
`;
  return { ...h, uniforms, common, vertex, fragment };
}

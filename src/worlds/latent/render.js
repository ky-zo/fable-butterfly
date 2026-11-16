// Drawing the field: a million points through one lens (lens.js), and the air they hang in.
//
// What is particular to this world is decided here, per point, from what the simulation hands over:
//   · the marks on the flowers that only an eye that sees ultraviolet can see come up from the middle outward
//   · where the butterfly's feet are down, a ring of light runs out through the form it is standing on
//   · the sun compass: every form is a shade brighter on the side toward one fixed direction, and the loose dust
//     is not round — each mote is a short needle that points at it, so the whole air has one vanishing point
// then one fullscreen pass adds the half-resolution bokeh layer and a breath of haze.

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { hash, noise } from '../../core/glsl.js';
import { NS, ST, PAL, N_PAL, WHITE, SUN, END, WINK, paletteUniform } from './config.js';
import { HASH42, TOUCH_GLSL } from './sim.js';
import { LENS_VERT, lensMaterial } from './lens.js';

const VERT = /* glsl */ `
precision highp float;
precision highp int;
#define NS ${NS}
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform ivec4 uRows;
uniform int uTexW;
uniform float uTime;
uniform vec4 uLum;        // forms, dust, web, sparkle
uniform vec4 uSize;       // world radius: forms, dust, web ; w = far boost distance
uniform float uStLum[NS]; // each region's own light
uniform float uStSize[NS];// …and how large its points are drawn (a thing seen from far off is drawn in bigger points)
uniform float uPlumeLum;
uniform vec3 uCenter[NS];
uniform vec3 uPal[${N_PAL * 3}];
uniform vec3 uWhite;
uniform vec3 uBoxCenter;
uniform float uBoxSize;
uniform vec3 uSun;
uniform vec4 uUV;         // how lit the ultraviolet marks are, how far out from the middle they have come, -, -
uniform vec3 uEndO;       // where the last lens stands
uniform vec3 uColdSize;   // the cold region is seen from far off: its points grow with their distance from there (z: …or, for the water, from where the lens is now)
uniform float uNeedle;    // length of a dust needle, world units
uniform float uMoonGain;  // the disc keeps its brightness as it swells: its points carry less light while it is small
uniform vec4 uShade;      // the animal down on the flower: the middle of it (xyz), how much it takes from what it is seen against (w)
uniform vec3 uShadeR, uShadeF; // across its wings and along its body, each divided by how far it reaches that way
uniform vec4 uWink;       // the rest going dark, region by region: progress, when the first goes, over how long, the flare as one goes
${LENS_VERT}
${TOUCH_GLSL}
${HASH42}

// How much of the animal lies over this point as the lens sees them (0 none … 1 squarely under or over it). Where it is
// down on a flower every point there is light added to light, and the animal is lost in what it stands on; so the
// flower is taken down where the animal is, the way its own shadow would take it down, and a little way round it.
float under(vec3 P){
  vec3 v = uShade.xyz - cameraPosition;
  float dh = length(v);
  v /= dh;
  vec3 c = P - cameraPosition;
  float dc = dot(c, v);
  if (dc < 0.5) return 0.0;
  vec3 q = cameraPosition + c * (dh / dc) - uShade.xyz;   // where the line of sight to this point passes the animal
  float a = dot(q, uShadeR), b = dot(q, uShadeF);
  return 1.0 - smoothstep(0.55, 1.4, sqrt(a * a + b * b));
}

void main(){
  int id = gl_VertexID;
  ivec2 tc = ivec2(id % uTexW, id / uTexW);
  vec4 P = texelFetch(tPos, tc, 0);
  vec4 V = texelFetch(tVel, tc, 0);
  vec4 mv = viewMatrix * vec4(P.xyz, 1.0);
  float d = -mv.z;
  lensHide();
  if (d < 0.12) return;
  vec4 clip = projectionMatrix * mv;
  vec2 ndc = clip.xy / clip.w;
  if (abs(ndc.x) > 1.15 || abs(ndc.y) > 1.2) return;

  vec4 rnd = hash42(vec2(tc) + 0.5);
  int plume0 = uRows.x;
  int dust0 = plume0 + uRows.y;
  int cls = tc.y < plume0 ? 0 : (tc.y < dust0 ? 3 : (tc.y < dust0 + uRows.z ? 1 : 2));

  // colour
  float pk = V.w;
  float palf = floor(pk / 4096.0);
  float rem = pk - palf * 4096.0;
  float tq = floor(rem / 64.0);
  float tint = tq / 63.0;
  float sat = (rem - tq * 64.0) / 63.0;
  int pal = int(palf);
  int pi = pal * 3;
  vec3 ramp = tint < 0.5 ? mix(uPal[pi], uPal[pi + 1], tint * 2.0) : mix(uPal[pi + 1], uPal[pi + 2], tint * 2.0 - 1.0);
  vec3 col = mix(uWhite, ramp, sat);

  // luminance: mostly even, with a heavy tail so a few points sparkle
  float lum = P.w * (0.6 + 0.5 * rnd.y + (cls == 0 ? uLum.w * pow(rnd.x, 26.0) : 0.0));
  lum *= 1.0 + 0.2 * sin(uTime * (0.5 + 2.4 * rnd.z) + rnd.w * 6.2831853);
  float Rw;
  float fade = 1.0;
  float far = uSize.w;
  if (cls == 0) {
    int st = pal / 4;
    lum *= uLum.x * uStLum[st];
    Rw = uSize.x * uStSize[st];
    // the compass: the side of a thing that faces the fixed direction is a shade brighter
    vec3 rel = P.xyz - uCenter[st];
    lum *= 0.82 + 0.3 * dot(rel / (length(rel) + 1.0), uSun);
    if (pal == ${PAL.UV}) {
      // marks that are only there for an eye that sees ultraviolet: they come up from the middle outward
      float on = uUV.x * smoothstep(uUV.y, uUV.y - 0.1, tint);
      lum *= on * (1.0 + 0.5 * sin(uTime * 2.2 - tint * 14.0));
      Rw *= 1.15;
    } else if (pal == ${ST.FOOD * 4}) {
      // …and as they do, the yellow that anyone can see falls back
      lum *= 1.0 - 0.4 * uUV.x;
    }
    if (st == ${ST.COLD}) {
      // (every point of it is made the same size in the last picture. The water that picture does not show is given
      // that size as the lens of the moment sees it, and the rest is met half way, so that on the way there the road
      // is as bright under the animal as it is under the disc; at the end the two lenses are the same one)
      float dO = distance(P.xyz, uEndO);
      if (pal == ${PAL.NEAR}) dO = d;
      else if (pal != ${PAL.MOON}) dO *= mix(1.0, pow(max(d, 1.0) / max(dO, 1.0), 0.3), uColdSize.z);
      Rw = uColdSize.x * (1.0 + dO * uColdSize.y);
      far = 1e6;
      if (pal == ${PAL.MOON}) lum *= uMoonGain;
      // glitter: the road flashes, each point in its own time
      if (pal == ${PAL.ROAD} || (pal == ${PAL.NEAR} && tint > 0.4)) lum *= 0.55 + 1.7 * pow(0.5 + 0.5 * sin(uTime * (1.6 + 5.0 * rnd.z) + rnd.w * 6.2831853), 6.0);
    }
    if (st == ${ST.FOOD} && uShade.w > 0.0) lum *= 1.0 - uShade.w * under(P.xyz);
    // a ring of light runs out from where its feet are
    vec3 tdir;
    float tw = touchWave(P.xyz, tdir);
    float tg = tw * (st == ${ST.PANE} ? uTouchK[1].w : uTouchK[0].w);
    lum *= 1.0 + tg;
    if (st != ${ST.PANE}) Rw *= 1.0 + min(0.12 * tg, 0.6);
    col = mix(col, uWhite, min(0.7 * tw, 0.75));
  } else if (cls == 3) {
    lum *= uPlumeLum;
    if (uShade.w > 0.0) lum *= 1.0 - uShade.w * under(P.xyz);
    Rw = uSize.x * 1.15;
  } else if (cls == 1) {
    lum *= uLum.y;
    Rw = uSize.y;
    // the dust box slides with the camera: fade toward its faces so wrapping is never seen
    vec3 q = abs(P.xyz - uBoxCenter) / (0.5 * uBoxSize);
    fade = 1.0 - smoothstep(0.78, 0.98, max(q.x, max(q.y, q.z)));
  } else {
    lum *= uLum.z;
    Rw = uSize.z;
    // web points are drawn large so that they carry at a distance; right beside the lens they would be lanterns
    fade = smoothstep(8.0, 26.0, d);
    // at the end the rest of the map does not dim: it goes out, one region after another, each with a last brightening.
    // A region is a cell some fifty units across with a bent wall; a point near a wall may go with either side.
    if (uWink.x > uWink.y - 0.04) {
      vec3 g = P.xyz * 0.021 + 0.33 * sin(P.yzx * 0.047 + vec3(0.0, 2.1, 4.2)) + 0.08 * (rnd.xyz - 0.5);
      vec3 cell = floor(g);
      float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      float thr = uWink.y + uWink.z * h;
      float gone = smoothstep(thr, thr + 0.011, uWink.x);
      float last = smoothstep(thr - 0.035, thr, uWink.x) * (1.0 - gone);
      lum *= (1.0 + uWink.w * last) * (1.0 - gone);
    }
  }
  Rw *= 0.75 + 0.5 * rnd.y;
  if (lum * fade <= 0.0) return;

  // image of the point: geometric radius ⊕ circle of confusion (all in full-resolution pixels)
  float boost = pow(1.0 + d / far, 0.5);
  float rgeo = Rw * uFocalPx / d * boost;
  if (!lensEmit(clip, d, rgeo, col * (lum * fade))) return;
  if (cls == 3) {
    // scent: each point is a short stroke along its filament, so a packet reads as a thread and not a row of dots
    vec4 c2 = projectionMatrix * (mv + vec4(mat3(viewMatrix) * V.xyz * 0.05, 0.0));
    vec2 dv = (c2.xy / max(c2.w, 1e-3) - ndc) * vec2(uFocalPx / projectionMatrix[0][0], uFocalPx / projectionMatrix[1][1]);
    float len = length(dv);
    if (len > 1e-4) lensNeedle(dv / len, len);
  } else if (cls == 1 && uNeedle > 0.0) {
    // the mote as a needle on the compass: its far end is where the same mote would be, moved toward the sun
    vec4 c2 = projectionMatrix * (mv + vec4(mat3(viewMatrix) * uSun * uNeedle, 0.0));
    vec2 dv = (c2.xy / max(c2.w, 1e-3) - ndc) * vec2(uFocalPx / projectionMatrix[0][0], uFocalPx / projectionMatrix[1][1]);
    float len = length(dv);
    if (len > 1e-4) lensNeedle(dv / len, len * (0.5 + rnd.x));
  }
}`;

const COMPOSE = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tBokeh;
uniform vec3 uCamR, uCamU, uCamF;
uniform vec2 uTan;
uniform float uTime, uGlow;
uniform vec3 uGlowDir;
uniform vec3 uGlowCol;
uniform vec3 uHaze;
${hash}
${noise}
void main(){
  vec3 c = texture2D(tBokeh, vUv).rgb;
  // the air: barely there, with slow structure, and warm toward the one direction everything in here leans on
  vec2 p = (vUv * 2.0 - 1.0) * uTan;
  vec3 dir = normalize(uCamF + uCamR * p.x + uCamU * p.y);
  float n = vnoise(dir * 2.3 + vec3(0.0, uTime * 0.01, 0.0)) * 0.6 + vnoise(dir * 5.1 + 7.0) * 0.4;
  float g = max(dot(dir, uGlowDir), 0.0);
  vec3 haze = uHaze * (0.35 + 0.9 * n * n);
  haze += uGlowCol * (uGlow * (pow(g, 8.0) * 0.008 + pow(g, 60.0) * 0.035 + pow(g, 700.0) * 0.22 + pow(g, 9000.0) * 1.6));
  c += haze;
  gl_FragColor = vec4(c, 1.0);
}`;

export class PointRenderer {
  constructor(ctx, L, sim, lens) {
    this.ctx = ctx;
    this.L = L;
    this.sim = sim;
    this.lens = lens;
    const gl = ctx.renderer.getContext();
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    this.maxPoint = Math.min(range ? range[1] : 64, 160);
    lens.uMaxSize.value = this.maxPoint;

    const geo = (this.geometry = ctx.track(new THREE.BufferGeometry()));
    geo.setAttribute('position', new THREE.BufferAttribute(new Uint8Array(L.N), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    // fewer points on the lower tiers: each carries more light and is drawn a little larger, so the picture keeps its weight
    const comp = (this.comp = Math.pow(1024 / L.W, 1.45));
    const grow = (this.grow = Math.pow(1024 / L.W, 0.4));
    this.uniforms = {
      ...lens,
      tPos: { value: null },
      tVel: { value: null },
      uRows: { value: new THREE.Vector4(L.Hf, L.Hp, L.Hd, L.Hw) },
      uTexW: { value: L.W },
      uTime: { value: 0 },
      uLum: { value: new THREE.Vector4(0.5 * comp, 0.3 * comp, 0.55 * comp, 4.0) },
      uSize: { value: new THREE.Vector4(0.0031 * grow, 0.004 * grow, 0.022 * grow, 30) },
      uStLum: { value: new Array(NS).fill(1) },
      uStSize: { value: [1.5, 1.15, 3.4, 2.1, 1] },
      uPlumeLum: { value: 0.5 * comp },
      uCenter: sim.uniforms.uCenter,
      uPal: { value: paletteUniform() },
      uWhite: { value: new THREE.Vector3(...WHITE) },
      uBoxCenter: sim.uniforms.uBoxCenter,
      uBoxSize: sim.uniforms.uBoxSize,
      uSun: { value: SUN.clone() },
      uUV: { value: new THREE.Vector4(0, 0, 0, 0) },
      uEndO: { value: END.o.clone() },
      uColdSize: { value: new THREE.Vector3(0.0034 * grow, 0.145, 0) },
      uNeedle: { value: 0.02 },
      uMoonGain: { value: 1 },
      uWink: { value: new THREE.Vector4(0, WINK[0], WINK[1], 1.6) },
      uTouch: sim.uniforms.uTouch,
      uTouchK: sim.uniforms.uTouchK,
      uTouchN: sim.uniforms.uTouchN,
      uTouchS: sim.uniforms.uTouchS,
      uShade: { value: new THREE.Vector4(0, 0, 0, 0) },
      uShadeR: { value: new THREE.Vector3(1, 0, 0) },
      uShadeF: { value: new THREE.Vector3(0, 1, 0) },
    };
    this.sharp = new THREE.Points(geo, lensMaterial(ctx, VERT, this.uniforms, {}));
    this.bokeh = new THREE.Points(geo, lensMaterial(ctx, VERT, this.uniforms, { BOKEH: 1 }));
    this.sharp.frustumCulled = this.bokeh.frustumCulled = false;
    this.sharp.matrixAutoUpdate = this.bokeh.matrixAutoUpdate = false;
    // everything that is seen through the lens goes into one of these two scenes (the butterfly adds itself)
    this.sharpScene = new THREE.Scene();
    this.bokehScene = new THREE.Scene();
    this.sharpScene.add(this.sharp);
    this.bokehScene.add(this.bokeh);
    this.sharpScene.matrixWorldAutoUpdate = this.bokehScene.matrixWorldAutoUpdate = false;
    /** drawn over the sharp layer, before the air (the mosaic) */
    this.over = null;

    this.bokehRT = ctx.createTarget({ scale: 0.5 });
    this.compose = new FSPass(
      COMPOSE,
      {
        tBokeh: { value: this.bokehRT.texture },
        uCamR: { value: new THREE.Vector3() },
        uCamU: { value: new THREE.Vector3() },
        uCamF: { value: new THREE.Vector3() },
        uTan: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uGlow: { value: 1 },
        uGlowDir: { value: SUN.clone() },
        uGlowCol: { value: new THREE.Vector3(1.0, 0.74, 0.36) },
        uHaze: { value: new THREE.Vector3(0.0035, 0.0052, 0.0105) },
      },
      { blending: THREE.AdditiveBlending, transparent: true },
    );
  }

  /** Compile every shader without holding the main thread. */
  async compile(camera) {
    const r = this.ctx.renderer;
    await r.compileAsync(this.sharpScene, camera);
    await r.compileAsync(this.bokehScene, camera);
    await this.compose.compile(r);
  }

  /** Draws into `target` (cleared first). Leaves renderer state as it found it. */
  render(target, camera, frame) {
    const r = this.ctx.renderer;
    const u = this.uniforms;
    u.tPos.value = this.sim.pos;
    u.tVel.value = this.sim.vel;
    const H = target.height;
    u.uFocalPx.value = (0.5 * H) / Math.tan((camera.fov * Math.PI) / 360);
    u.uPx.value = H / 1080;
    u.uTime.value = frame.time;
    u.uAspect.value.set(camera.aspect > 1 ? 1 : camera.aspect, camera.aspect > 1 ? 1 / camera.aspect : 1);

    const cu = this.compose.uniforms;
    const e = camera.matrixWorld.elements;
    cu.uCamR.value.set(e[0], e[1], e[2]);
    cu.uCamU.value.set(e[4], e[5], e[6]);
    cu.uCamF.value.set(-e[8], -e[9], -e[10]);
    const th = Math.tan((camera.fov * Math.PI) / 360);
    cu.uTan.value.set(th * camera.aspect, th);
    cu.uTime.value = frame.time;

    const prevAuto = r.autoClear;
    const prevColor = r.getClearColor(_c).getHex();
    const prevAlpha = r.getClearAlpha();
    r.autoClear = false;
    r.setClearColor(0x000000, 1);

    r.setRenderTarget(this.bokehRT);
    r.clear(true, false, false);
    r.render(this.bokehScene, camera);

    r.setRenderTarget(target);
    r.clear(true, false, false);
    r.render(this.sharpScene, camera);
    if (this.over && this.over.visible) r.render(this.over, camera);
    this.compose.render(r, target);

    r.setClearColor(prevColor, prevAlpha);
    r.autoClear = prevAuto;
  }

  dispose() {
    this.compose.dispose();
  }
}

const _c = new THREE.Color();

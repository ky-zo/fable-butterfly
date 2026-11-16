// The way in. World 01 ends pushed into the compound eye; this world opens on what that eye delivers: a mosaic.
//
// Several thousand hexagonal facets edge to edge. A facet of a compound eye is a lens, and each lens forms its own
// small image of the garden, a little different from its neighbours' — here every facet holds its own slightly
// shifted view of one picture (green, the blue of the roof glass, the low gold sun, the dark glazing bars), and the
// whole wall of them adds up to that same picture again. The dark patch is the pseudopupil: the facets that happen
// to look straight back along the line of sight show the dark inside of the eye, with six fainter ones round it. It
// follows the viewer, as it does on a real eye, and so it always lies behind the butterfly.
//
// Then the facets let go, from the butterfly outward: they unseat, tilt, drift apart in depth (toward the lens they
// swell into soft six-sided discs, since they pass through the same depth of field as everything else), shrink, and
// each one resolves into a single point of light. All of it is a pure function of progress, plus a slow tumble.

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { hash, noise, fbm } from '../../core/glsl.js';
import { LENS_VERT } from './lens.js';

export const WALL = { c: new THREE.Vector3(0.5, 0, -22.6), w: 44, h: 42, pitch: 0.44 };

// The one picture every facet holds: the garden as it lies on the far side of the glass.
const GARDEN = /* glsl */ `
precision highp float;
varying vec2 vUv;
${hash}
${noise}
${fbm}
void main(){
  vec2 uv = vUv;
  // the roof glass and the sky through it: pale where the fog is, blue where it has cleared
  float f0 = fbm(uv * 2.4 + 5.3, 4);
  vec3 sky = mix(vec3(0.3, 0.38, 0.38), vec3(0.08, 0.17, 0.4), smoothstep(0.3, 0.75, f0 + 0.45 * (uv.y - 0.6)));
  // leaf: big masses, then finer ones, lit from low on the right
  float f1 = fbm(uv * vec2(3.0, 2.4) + 1.7, 4);
  float f2 = fbm(uv * 8.0 + 4.1, 4);
  float canopy = smoothstep(0.4, 0.56, f1 + (0.6 - uv.y) * 0.8);
  float litSide = smoothstep(-0.1, 1.0, uv.x + 0.5 * (f1 - 0.5));
  vec3 green = mix(vec3(0.006, 0.026, 0.008), vec3(0.13, 0.25, 0.025), smoothstep(0.32, 0.7, f2) * (0.3 + 0.7 * litSide));
  vec3 col = mix(sky, green, canopy);
  // the sun, low: gold over everything on that side
  vec2 sd = (uv - vec2(0.86, 0.24)) * vec2(1.0, 1.3);
  float s = exp(-dot(sd, sd) * 6.5);
  col = col * (1.0 + 1.2 * s) + vec3(1.0, 0.46, 0.05) * (0.42 * s + 1.1 * s * s * s);
  // glazing bars
  float bar = smoothstep(0.012, 0.004, abs(fract(uv.x * 3.0 + 0.18) - 0.5) * 0.3333) + smoothstep(0.009, 0.003, abs(uv.y - 0.72));
  col *= 1.0 - 0.85 * min(bar, 1.0);
  gl_FragColor = vec4(col, 1.0);
}`;

const VERT = /* glsl */ `
precision highp float;
attribute vec2 aGrid;     // where this facet sits in the wall
attribute vec4 aRnd;
uniform float uLoosen, uTime, uFade;
uniform vec3 uWall;       // centre of the wall
uniform vec4 uDim;        // width, height, pitch, how domed it is
uniform vec3 uPupil;      // the pseudopupil: where on the wall (xy), its radius
uniform vec2 uOrigin;     // where the letting-go starts from
${LENS_VERT}
varying vec2 vLocal;      // across the facet, in facet radii
varying vec4 vFacet;      // wall uv (xy), how free it is 0..1, blur in facet radii
varying vec4 vShade;      // darkness of the pseudopupil, light, flake seed, edge softness in radii
varying vec3 vN;

mat3 axisAngle(vec3 a, float t){
  float c = cos(t), s = sin(t), o = 1.0 - c;
  return mat3(o * a.x * a.x + c, o * a.x * a.y + a.z * s, o * a.z * a.x - a.y * s,
              o * a.x * a.y - a.z * s, o * a.y * a.y + c, o * a.y * a.z + a.x * s,
              o * a.z * a.x + a.y * s, o * a.y * a.z - a.x * s, o * a.z * a.z + c);
}
void main(){
  // when this facet lets go: a front that runs out from the butterfly, ragged
  float dist = length(aGrid - uOrigin);
  float delay = 0.62 * clamp(dist / 24.0, 0.0, 1.0) + 0.22 * aRnd.x;
  float t = clamp((uLoosen - delay) / 0.42, 0.0, 1.0);
  float e = t * t * (3.0 - 2.0 * t);
  float free = smoothstep(0.08, 0.5, t);

  vec3 home = uWall + vec3(aGrid, -uDim.w * dot(aGrid, aGrid));
  // apart in depth: most go away from the lens, some come at it and past it; and a little sideways
  float dz = mix(-44.0, 30.0, pow(aRnd.y, 1.5));
  vec3 drift = vec3((aRnd.z - 0.5) * 7.0, (aRnd.w - 0.5) * 5.0, dz) * pow(e, 1.6);
  vec3 q = home * 0.13 + uTime * 0.03;
  vec3 curl = vec3(sin(q.y * 3.1 + aRnd.x * 6.0) + sin(q.z * 2.3), sin(q.z * 2.7 + aRnd.y * 6.0) + sin(q.x * 3.3), sin(q.x * 2.9 + aRnd.z * 6.0)) * (0.55 * e);
  vec3 c = home + drift + curl;

  // unseated: it tilts, then tumbles slowly
  vec3 ax = normalize(aRnd.yzw - 0.5 + vec3(0.0, 0.0, 0.15));
  mat3 R = axisAngle(ax, e * (1.2 + 5.0 * aRnd.x) + uTime * (0.25 + 0.5 * aRnd.z) * free + 0.05 * sin(uTime * 0.7 + aRnd.w * 6.28) * smoothstep(0.0, 0.1, uLoosen));
  float R0 = 0.5 * uDim.z;
  float Rh = R0 * mix(0.965, 0.13, smoothstep(0.12, 1.0, t)) * (1.0 - 0.05 * smoothstep(0.0, 0.08, uLoosen) * (1.0 - free));

  vec4 mvc = viewMatrix * vec4(c, 1.0);
  float d = -mvc.z;
  lensHide();
  vLocal = vec2(0.0); vFacet = vec4(0.0); vShade = vec4(0.0); vN = vec3(0.0, 0.0, 1.0);
  if (d < 0.25 || uFade <= 0.0) return;
  float cocW = min(lensCoc(d), 46.0 * uPx) * d / uFocalPx;       // blur, in world units at this depth
  float aaW = 0.75 * d / uFocalPx;
  float soft = max(cocW, aaW);
  float ext = Rh * 1.16 + soft * 1.6;
  vec3 wp = c + R * (vec3(position.xy, 0.0) * ext);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  gl_PointSize = 1.0;
  vLocal = position.xy * ext / Rh;
  vN = R * vec3(0.0, 0.0, 1.0);
  vFacet = vec4(aGrid / uDim.xy + 0.5, free, cocW / Rh);

  // the pseudopupil, by whole facets: the main one, and six fainter round it
  vec2 pd = (aGrid - uPupil.xy) * vec2(1.0, 1.12);
  float pr = length(pd) / uPupil.z;
  float dark = smoothstep(1.2, 0.45, pr + 0.22 * (aRnd.x - 0.5));
  for (int k = 0; k < 6; k++) {
    float a = 0.5236 + 1.0472 * float(k);
    vec2 sc = uPupil.xy + vec2(cos(a), sin(a) / 1.12) * uPupil.z * 2.75;
    dark = max(dark, 0.42 * smoothstep(0.62, 0.22, length((aGrid - sc) * vec2(1.0, 1.12)) / uPupil.z + 0.1 * (aRnd.y - 0.5)));
  }
  // light: as a facet shrinks to a point it keeps most of its light, so it ends as a spark, not a speck
  float gather = pow(R0 / Rh, 1.25);
  float blur = soft / Rh;
  vShade = vec4(dark * (1.0 - free), uFade * mix(0.62, 0.2 * gather, free) / (1.0 + 1.3 * blur * blur), aRnd.w, max(soft / Rh, 0.02));
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tGarden;
uniform vec3 uKey;        // which way the facets' highlights lean (xy), strength
varying vec2 vLocal;
varying vec4 vFacet;
varying vec4 vShade;
varying vec3 vN;
void main(){
  vec2 p = vLocal;
  vec2 ap = abs(p);
  // a hexagon with a corner up; far out of focus it is the lens' disc, not the facet's shape, that shows
  float hex = max(ap.x, dot(ap, vec2(0.5, 0.8660254)));
  float hd = mix(hex, length(p) * 0.93, smoothstep(0.8, 2.6, vFacet.w));
  float sft = vShade.w;
  float a = 1.0 - smoothstep(max(1.0 - sft, 0.0), 1.0 + sft, hd);
  if (a <= 0.002) discard;
  float free = vFacet.z;

  // its own small view: the whole picture again, turned over as a lens turns it, and shifted a little by where
  // this facet sits. Together the facets add up to the same picture once more.
  vec2 uvw = vFacet.xy;
  vec3 macro = textureLod(tGarden, uvw, 2.5).rgb;
  vec2 muv = vec2(0.5) + (uvw - 0.5) * 0.5 - p * (0.46 + 0.2 * free);
  vec3 micro = textureLod(tGarden, clamp(muv, 0.0, 1.0), 0.5 + 5.0 * free).rgb;
  vec3 col = mix(macro * (0.3 + 2.6 * micro / (0.12 + dot(macro, vec3(0.3, 0.5, 0.2)))) + 0.3 * micro, macro * 1.5, free);

  // the lens itself: domed, brighter toward the middle, a hard glint where it faces the light, dark in the joint
  vec3 n = normalize(vec3(p * 0.82, 1.0));
  float dome = 0.42 + 0.58 * (1.0 - hd * hd);
  float glint = pow(max(dot(n, normalize(vec3(uKey.xy, 0.7))), 0.0), 40.0);
  float joint = 1.0 - 0.85 * smoothstep(0.72, 1.0, hd) * (1.0 - free);
  float lit = smoothstep(0.0, 1.0, dot(uvw - 0.5, uKey.xy) + 0.42);
  col = col * mix(dome * joint, 1.0, free) + (vec3(1.0, 0.8, 0.5) * (0.1 + 3.4 * lit * lit) + macro * 2.0) * glint * uKey.z * (1.0 - free);
  // the pseudopupil: these facets look straight back into the eye
  col = mix(col, vec3(0.004, 0.007, 0.012) * (0.5 + 1.5 * dome) + vec3(0.12, 0.17, 0.26) * glint, vShade.x);
  col = mix(vec3(dot(col, vec3(0.25, 0.6, 0.15))), col, mix(0.84, 1.1, free)) * mix(0.86, 1.0, free);
  // a free facet turns in the light: bright face-on, a line edge-on
  col *= mix(1.0, 0.35 + 1.3 * abs(vN.z) * abs(vN.z), free);
  gl_FragColor = vec4(col * (a * vShade.y), 1.0);
}`;

export class Mosaic {
  constructor(ctx, lens) {
    this.ctx = ctx;
    const rnd = ctx.rng(606);
    const { w, h, pitch } = WALL;
    const rowH = pitch * 0.8660254;
    const cols = Math.ceil(w / pitch), rows = Math.ceil(h / rowH);
    const n = cols * rows;
    const grid = new Float32Array(n * 2);
    const rand = new Float32Array(n * 4);
    let k = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++, k++) {
        grid[k * 2] = (i + (j & 1 ? 0.5 : 0) - cols / 2) * pitch;
        grid[k * 2 + 1] = (j - rows / 2) * rowH;
        rand[k * 4] = rnd();
        rand[k * 4 + 1] = rnd();
        rand[k * 4 + 2] = rnd();
        rand[k * 4 + 3] = rnd();
      }
    }
    const geo = (this.geometry = ctx.track(new THREE.InstancedBufferGeometry()));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aGrid', new THREE.InstancedBufferAttribute(grid, 2));
    geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rand, 4));
    geo.instanceCount = n;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.count = n;

    this.gardenRT = ctx.createTarget({ size: [256, 256], mipmaps: true, wrap: THREE.ClampToEdgeWrapping });
    this.gardenPass = new FSPass(GARDEN, {});
    this.uniforms = {
      ...lens,
      tGarden: { value: this.gardenRT.texture },
      uLoosen: { value: 0 },
      uTime: { value: 0 },
      uFade: { value: 1 },
      uWall: { value: WALL.c.clone() },
      uDim: { value: new THREE.Vector4(w, h, pitch, 0.0035) },
      uPupil: { value: new THREE.Vector3(-4, -1.8, 5.6) },
      uOrigin: { value: new THREE.Vector2(-4, -1.8) },
      uKey: { value: new THREE.Vector3(0.62, 0.5, 1.0) },
    };
    this.material = ctx.track(
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: this.uniforms,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.baked = false;
  }

  async compile(camera) {
    const r = this.ctx.renderer;
    await this.gardenPass.compile(r);
    this.bake();
    await r.compileAsync(this.mesh, camera);
  }

  /** Draw the one picture (once). */
  bake() {
    if (this.baked) return;
    this.gardenPass.render(this.ctx.renderer, this.gardenRT);
    this.baked = true;
  }

  /**
   * @param loosen 0 seated … 1.25 all let go      @param fade 1 … 0
   * @param eye the lens' position   @param hero the butterfly's: the pseudopupil lies on the wall behind it
   */
  update(time, loosen, fade, eye, hero) {
    const u = this.uniforms;
    u.uLoosen.value = loosen;
    u.uTime.value = time;
    u.uFade.value = fade;
    this.mesh.visible = fade > 0.001;
    const wz = WALL.c.z;
    const s = (wz - eye.z) / Math.min(-1e-3, hero.z - eye.z);
    const x = eye.x + (hero.x - eye.x) * s - WALL.c.x;
    const y = eye.y + (hero.y - eye.y) * s - WALL.c.y;
    u.uPupil.value.x = x;
    u.uPupil.value.y = y;
    u.uOrigin.value.set(x, y);
  }

  dispose() {
    this.gardenPass.dispose();
  }
}

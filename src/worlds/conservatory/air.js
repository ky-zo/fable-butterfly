// Humid air. Two things live in it:
//   shafts : the low sun that makes it through steel, fog and leaves, scattered on its way across the corridor
//            (a short ray-march at reduced resolution, added over the frame by a quad that sits in the corridor scene), and
//   motes  : slow dust and spores that only exist where a shaft finds them. Each is drawn as its own circle of
//            confusion, so the ones near the lens are large soft discs and the ones in focus are sparks.

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { hash } from '../../core/glsl.js';
import { layoutGLSL, HW, ZE, ZB } from './layout.js';
import { sunGLSL } from './sun.js';

const MARCH_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform mat4 uInvViewProj;
uniform vec3 uCam;
uniform float uTime, uDensity, uClear, uCorr;
uniform sampler2D tNoise;
uniform sampler2D tSunWall;   // the sun arriving on the sunlit wall, in wall space (already soft, already swaying)
uniform sampler2D tGarden;    // rgb + q, for how far the garden reaches behind the end pane
uniform vec4 uGS;
uniform vec3 uGlow[7];
${hash}
${layoutGLSL}
${sunGLSL}
// How much direct sun reaches a point of the corridor: the steel frame, the fog on the pane it came through (a wiped
// streak lets a whole shaft in), and the leaves outside.
float beamAt(vec3 P){
  int idx;
  float t = hullExit(P, SUN_DIR, 5, idx);
  vec3 Q = P + SUN_DIR * t;
  float open = frameOpen(idx, Q, 0.02 + t * 0.008);
  if (idx == 0) {
    vec2 uv = vec2(ZB - Q.z, Q.y - Y0) / vec2(WALL_LEN, WALL_H);
    vec4 fs = texture2D(tFogL, uv);
    float fog = fs.r * fs.a;
    return open * mix(1.0, uFogBeam, fog * fog) * texture2D(tSunWall, uv).r;
  }
  return open * mix(1.0, uFogBeam, 0.8) * shadow1(P);
}
void main(){
  vec4 h = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(h.xyz / h.w - uCam);
  int idx;
  float tHull = hullExit(uCam, rd, 7, idx);
  float tMax = min(tHull, 18.0);
  float dt = tMax / float(STEPS);
  float jit = ign(gl_FragCoord.xy);
  float beam = 0.0, fogLen = 0.0;
  // the damp is not even: it hangs in slow wisps (two lookups along the ray are enough to carry them), thicker toward the floor
  vec3 Pa = uCam + rd * tMax * 0.3, Pb = uCam + rd * tMax * 0.75;
  float wa = texture2D(tNoise, Pa.xz * 0.11 + vec2(uTime * 0.004, Pa.y * 0.07 - uTime * 0.003)).r;
  float wb = texture2D(tNoise, Pb.xz * 0.11 + vec2(uTime * 0.004, Pb.y * 0.07 - uTime * 0.003)).r;
  for (int i = 0; i < STEPS; i++) {
    if (uCorr < 0.5) break;                         // (the lens is against a pane: there is no air in front of it to light)
    float k = (float(i) + jit) / float(STEPS);
    vec3 P = uCam + rd * (k * tMax);
    float d = (0.55 + 0.9 * mix(wa, wb, k)) * mix(1.25, 0.8, clamp(P.y / EAVE, 0.0, 1.0));
    beam += beamAt(P) * d;
    fogLen += d;
  }
  float cosT = max(dot(rd, SUN_DIR), 0.0);
  // forward-peaked: shafts are brightest when you look up along them
  float phase = 0.32 + 0.5 * cosT * cosT + 1.1 * pow(cosT, 12.0);
  vec3 col = SUN_COL * beam * dt * uDensity * phase;
  // and the ambient haze: far steel sinks into pale, slightly green air
  vec3 hazeC = (uGlow[0] + uGlow[1] + uGlow[3]) * 0.22;
  col += hazeC * (1.0 - exp(-fogLen * dt * uDensity * 1.3));
  // and beyond the glass: the same sun in the garden's own air, as far as the nearest leaf. Kept apart (alpha): it
  // belongs BEHIND the pane, so the pane shader adds it to what it sees through itself, under the fog.
  float shaft = 0.0;
  if (idx >= 0 && idx < 5) {
    vec3 X = uCam + rd * tHull;
    float q = texture2D(tGarden, min(vUv * uGS.xy, uGS.zw)).a;
    float far = min(tHull * q / max(1.0 - q, 1e-3), 9.0);
    float ds = far / 5.0, g = 0.0;
    for (int i = 0; i < 5; i++) g += shadow1(X + rd * ((float(i) + jit) * ds));
    shaft = g * ds * 0.0042 * (0.3 + 0.6 * cosT * cosT + 1.6 * pow(cosT, 10.0));
  }
  gl_FragColor = vec4(col, shaft);
}`;

const COMP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tAir;
uniform vec2 uTexel;
void main(){
  vec3 c = texture2D(tAir, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tAir, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture2D(tAir, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tAir, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

const MOTE_VERT = /* glsl */ `
attribute vec4 aMote;     // xyz home position, w seed
uniform float uTime;
uniform vec2 uRes;
uniform vec3 uDof;        // focus distance, aperture, max blur in px
varying vec2 vLocal;
varying float vLight;
varying float vSoft;
${layoutGLSL}
${sunGLSL}
void main(){
  float s = aMote.w;
  vec3 P = aMote.xyz;
  // slow convection: a lazy loop sideways, a rise of a centimetre a second, wrapped under the roof
  P.x += sin(uTime * 0.07 + s * 37.0) * 0.16 + sin(uTime * 0.23 + s * 91.0) * 0.03;
  P.z += cos(uTime * 0.05 + s * 53.0) * 0.22;
  P.y = 0.12 + mod(P.y + uTime * (0.006 + 0.012 * fract(s * 7.3)) + sin(uTime * 0.31 + s * 17.0) * 0.02, 2.9);
  P.x = clamp(P.x, -HW + 0.06, HW - 0.06);
  vec4 vp = viewMatrix * vec4(P, 1.0);
  float d = max(-vp.z, 0.06);
  float light = sunInto(P, 0.015) * shadow1(P);
  float focal = projectionMatrix[1][1] * 0.5 * uRes.y;
  float size = mix(0.0006, 0.0016, fract(s * 13.7));               // metres
  float rGeo = size * focal / d;                                     // px
  float coc = abs(clamp((d - uDof.x) / d * uDof.y, -1.0, 1.0)) * uDof.z;
  float r = max(max(rGeo, coc), 0.9);
  vLocal = position.xy;
  // a point of light spread over its disc: the energy stays, the brightness goes
  float twinkle = 0.6 + 0.4 * sin(uTime * (1.3 + fract(s * 3.1) * 2.0) + s * 61.0);
  vLight = light * twinkle * (0.5 + fract(s * 29.0)) * min(1.0, rGeo * rGeo + 0.12) / (r * r) * smoothstep(0.08, 0.3, d);
  vSoft = r;
  vec4 clip = projectionMatrix * vp;
  clip.xy += position.xy * (r + 1.0) * 2.0 / uRes * clip.w;
  gl_Position = light > 0.002 ? clip : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const MOTE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vLocal;
varying float vLight;
varying float vSoft;
void main(){
  float rr = length(vLocal) * (vSoft + 1.0);
  float a = smoothstep(vSoft + 0.6, vSoft - 0.6, rr);
  // a faint brighter rim, like a real out-of-focus highlight
  a *= 0.8 + 0.35 * smoothstep(vSoft * 0.55, vSoft, rr) * step(3.0, vSoft);
  gl_FragColor = vec4(vec3(16.0, 10.6, 6.0) * vLight * a * MOTE_GAIN, 1.0);
}`;

export class Air {
  /** sunWall: texture holding the sun on the sunlit wall (wall space). */
  constructor(ctx, shared, sunWall) {
    const lvl = ctx.quality.level;
    this.rt = ctx.createTarget({ scale: lvl >= 2 ? 0.3 : lvl === 1 ? 0.25 : 0.2 });
    /** rgb: the corridor's lit air (added over the frame). a: the garden's shafts (the panes add it behind their fog). */
    this.texture = this.rt.texture;
    this.invVP = new THREE.Matrix4();
    this.march = new FSPass(
      MARCH_FRAG,
      { ...shared, tSunWall: { value: sunWall }, uInvViewProj: { value: this.invVP }, uCam: { value: new THREE.Vector3() }, uDensity: { value: 0.011 }, uCorr: { value: 1 } },
      { defines: { STEPS: lvl >= 2 ? 7 : lvl === 1 ? 6 : 5 } },
    );
    this.comp = new FSPass(COMP_FRAG, { tAir: { value: this.rt.texture }, uTexel: { value: new THREE.Vector2() } }, { transparent: true, blending: THREE.AdditiveBlending });
    this.comp.mesh.renderOrder = 50;

    const n = lvl >= 2 ? 1400 : lvl === 1 ? 900 : 500;
    const rnd = ctx.rng(404);
    const data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      data[i * 4] = (rnd() * 2 - 1) * (HW - 0.12);
      data[i * 4 + 1] = rnd() * 2.9;
      data[i * 4 + 2] = ZE + 0.2 + rnd() * (ZB + 1.5 - ZE);
      data[i * 4 + 3] = rnd();
    }
    const geo = (this.geo = new THREE.InstancedBufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aMote', new THREE.InstancedBufferAttribute(data, 4));
    geo.instanceCount = n;
    this.dof = new THREE.Vector3(4, 1, 12);
    this.moteMat = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      uniforms: { ...shared, uDof: { value: this.dof } },
      defines: { MOTE_GAIN: '0.65' },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    this.motes = new THREE.Mesh(geo, this.moteMat);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 60;
  }

  /** The shafts and the motes are drawn with the corridor, after everything opaque. */
  addTo(scene) {
    scene.add(this.comp.mesh, this.motes);
  }

  /** March the shafts for this camera (into the air's own small target). Call before the corridor is drawn. */
  /** corridor: false when the lens is so close to a pane that the corridor's own air is not worth marching. */
  update(renderer, camera, dof, height, corridor = true, amount = 1) {
    this.march.uniforms.uCorr.value = corridor ? 1 : 0;
    this.march.uniforms.uDensity.value = 0.011 * amount;
    this.invVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    this.march.uniforms.uCam.value.copy(camera.position);
    this.march.render(renderer, this.rt, true);
    this.comp.uniforms.uTexel.value.set(1 / this.rt.width, 1 / this.rt.height);
    this.dof.set(dof.focus, dof.aperture, dof.maxBlur * (height / 1080));
  }

  dispose() {
    this.march.dispose();
    this.comp.dispose();
    this.geo.dispose();
    this.moteMat.dispose();
  }
}

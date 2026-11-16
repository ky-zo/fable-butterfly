// Small things that move in the garden's air and catch the low sun:
//   pollen   drifting slowly, visible only where a shaft finds it
//   insects  midges that dance in the shafts: quick, erratic, bright from behind
//   drips    water gathering at a leaf tip, hanging, letting go, falling
// and one thing that does not move: a spider's web strung across the outside of the landing pane's upper corner,
// beaded with dew.
//
// The moving things are one instanced mesh of additive sprites. They are added to the garden image but leave its
// alpha (q) alone, so the frost blurs each of them like whatever stands behind it.

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { layoutGLSL, HW, ZB, ZE, WALLS } from './layout.js';
import { sunGLSL } from './sun.js';
import { POOL } from './gardenEnv.js';

const VERT = /* glsl */ `
attribute vec4 aHome;     // xyz home, w seed
attribute vec4 aKind;     // kind (0 pollen, 1 insect, 2 drip), size (m), range (m), period (s)
uniform float uTime;
uniform vec2 uRes;
varying vec2 vLocal;
varying vec3 vCol;
varying float vKind;
${layoutGLSL}
${sunGLSL}
void main(){
  float s = aHome.w;
  vec3 P = aHome.xyz;
  float kind = aKind.x;
  float stretch = 1.0;
  float bright = 1.0;
  if (kind < 0.5) {
    // pollen: a lazy loop, a slow fall, wrapped
    P.x += sin(uTime * 0.11 + s * 37.0) * aKind.z + sin(uTime * 0.31 + s * 91.0) * 0.04;
    P.z += cos(uTime * 0.09 + s * 53.0) * aKind.z;
    P.y = 0.15 + mod(P.y - uTime * (0.008 + 0.014 * fract(s * 7.3)) + sin(uTime * 0.27 + s * 17.0) * 0.03, 3.4);
    bright = 0.6 + 0.4 * sin(uTime * (1.1 + fract(s * 3.1) * 2.0) + s * 61.0);
  } else if (kind < 1.5) {
    // a midge: three incommensurate turns at speed, never leaving its patch of light
    float t = uTime * (1.6 + 2.2 * fract(s * 5.7));
    P += vec3(sin(t + s * 40.0) + 0.5 * sin(2.7 * t + s * 11.0), 0.7 * sin(1.3 * t + s * 23.0) + 0.4 * sin(3.1 * t), cos(0.9 * t + s * 31.0) + 0.5 * cos(2.3 * t + s * 7.0)) * aKind.z;
    bright = 0.75 + 0.5 * sin(uTime * 37.0 + s * 90.0);          // wings
  } else {
    // a drip: for most of its period it hangs and swells at the leaf tip; then it lets go
    float ph = fract(uTime / aKind.w + s);
    float fall = max(ph - 0.84, 0.0) * aKind.w;                 // seconds since it let go
    float drop = 0.5 * 4.2 * fall * fall;
    P.y -= drop;
    stretch = 1.0 + 26.0 * fall;
    bright = (ph < 0.84 ? 0.35 + 0.65 * ph : 1.0) * step(0.02, P.y);
  }
  vec4 vp = viewMatrix * vec4(P, 1.0);
  float d = max(-vp.z, 0.05);
  float focal = projectionMatrix[1][1] * 0.5 * uRes.y;
  float r = max(aKind.y * focal / d, 0.8);
  float light = shadow1(P) * bright * min(1.0, (aKind.y * focal / d) * (aKind.y * focal / d) + 0.1);
  // seen against the light they are sparks; with the light they are almost nothing
  float back = max(dot(normalize(P - cameraPosition), SUN_DIR), 0.0);
  vec3 tint = kind < 0.5 ? vec3(1.0, 0.72, 0.4) : kind < 1.5 ? vec3(1.0, 0.86, 0.6) : vec3(1.0, 0.9, 0.72);
  vCol = tint * light * (0.25 + 2.2 * back * back) * (kind > 1.5 ? 1.3 : kind > 0.5 ? 1.8 : 0.9);
  vLocal = position.xy;
  vKind = kind;
  vec4 clip = projectionMatrix * vp;
  clip.xy += position.xy * vec2(r + 1.0, (r + 1.0) * stretch) * 2.0 / uRes * clip.w;
  gl_Position = light > 0.003 ? clip : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vLocal;
varying vec3 vCol;
varying float vKind;
void main(){
  float d = length(vLocal);
  float a = smoothstep(1.0, 0.35, d);
  if (vKind > 1.5) a *= 0.6 + 0.8 * smoothstep(0.5, 0.0, abs(vLocal.x + 0.25));       // a drop is lit along one side
  gl_FragColor = vec4(vCol * a, 0.0);
}`;

// ---- the web
const WEB_VERT = /* glsl */ `
varying vec2 vP;
varying vec3 vWorld;
void main(){
  vP = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const WEB_FRAG = /* glsl */ `
precision highp float;
varying vec2 vP;        // metres from the hub
varying vec3 vWorld;
uniform sampler2D tNoise;
uniform float uTime;
uniform vec3 uSky, uHaze;
${hash}
${layoutGLSL}
${sunGLSL}
float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
void main(){
  vec2 p = vP;
  float px = max(fwidth(p.x), fwidth(p.y));
  float r = length(p), th = atan(p.y, p.x);
  const float N = 23.0;
  float sec = th / 6.2831853 * N;
  float si = floor(sec + 0.5);
  vec2 hs = hash22(vec2(si, 3.0));
  // radii: each a little off its angle, each ending where it found something to hold on to
  float rj = (hs.x - 0.5) * 0.35;
  float reach = 0.2 + 0.08 * hs.y + 0.06 * sin(si * 1.7);
  float dRad = abs(sec - si - rj) / N * 6.2831853 * r;
  float w = 0.00011;
  float thread = smoothstep(w + px, w, dRad) * step(r, reach) * step(0.004, r) * (1.0 - 0.0);
  // the capture spiral: straight chords from radius to radius, sagging; a few are broken
  float sj = floor(sec);
  float phi = (fract(sec) - 0.5) / N * 6.2831853;
  float k = r * cos(phi) / cos(3.14159265 / N);
  float pitch = 0.0068;
  float fs = fract(sec) * 2.0 - 1.0;
  float ring = k / pitch + hash12(vec2(sj, 9.0)) * 0.45 + 0.22 * (1.0 - fs * fs);        // (each chord sags a little toward the hub)
  float ri = floor(ring + 0.5);
  float dRing = abs(ring - ri) * pitch;
  // (a web is never whole: single chords have gone, and a wedge of it was torn out by something that flew through)
  float torn = smoothstep(0.5, 0.9, sin(th * 1.0 + 2.2)) * step(0.085, r);
  float alive = step(0.16, hash12(vec2(sj, ri))) * step(5.5, ri) * step(ri * pitch, min(reach, 0.17 + 0.07 * hash12(vec2(sj, 1.0)))) * (1.0 - torn);
  thread = max(thread, smoothstep(w + px, w, dRing) * alive);
  // the hub: a tight tangle
  thread = max(thread, smoothstep(w + px, w, abs(fract(r / 0.0017) - 0.5) * 0.0017) * step(r, 0.012) * step(0.0015, r));
  // dew: beads strung along the spiral, fat ones where threads cross
  float along = fract(sec) * 37.0 + ri * 3.7;
  float bd = length(vec2((fract(along) - 0.5) / 37.0 / N * 6.2831853 * r, dRing));
  float br = mix(0.00035, 0.0008, hash12(vec2(floor(along), ri + sj)));
  float bead = smoothstep(br + px, br - px * 0.5, bd) * alive * step(0.5, hash12(vec2(floor(along) + 5.0, ri)));
  float cov = max(thread * min(1.0, 2.0 * w / px + 0.2), bead);
  if (cov < ign(gl_FragCoord.xy) * 0.9 + 0.05) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  float vis = shadowHard(vWorld + SUN_DIR * 0.02);
  float back = max(dot(-V, SUN_DIR), 0.0);
  // silk scatters forward: against the sun a web is drawn in light. Each bead is a lens with the sun in it.
  vec3 pale = vec3(0.34, 0.34, 0.3);
  vec3 col = pale * 0.7 + SUN_COL * vis * (0.04 + 0.4 * pow(back, 3.0));
  float tw = 0.5 + 0.5 * sin(hash12(vec2(floor(along), ri)) * 40.0 + dot(V, vec3(31.0, 17.0, 23.0)) * 6.0 + uTime * 0.7);
  col = mix(col, pale + SUN_COL * vis * (0.25 + 3.0 * tw * tw * tw), bead);
  gl_FragColor = vec4(col, paneQ(cameraPosition, vWorld));
}`;

export class GardenLife {
  constructor(ctx, shared) {
    const lvl = ctx.quality.level;
    const r = ctx.rng(611);
    const nPollen = lvl >= 2 ? 700 : lvl === 1 ? 420 : 220;
    const nInsect = lvl >= 2 ? 70 : lvl === 1 ? 44 : 24;
    const nDrip = lvl >= 2 ? 46 : lvl === 1 ? 30 : 16;
    const n = nPollen + nInsect + nDrip;
    const home = new Float32Array(n * 4);
    const kind = new Float32Array(n * 4);
    let i = 0;
    const put = (x, y, z, k, size, range, period) => {
      home.set([x, y, z, r()], i * 4);
      kind.set([k, size, range, period], i * 4);
      i++;
    };
    // where the air is: beside the sunlit wall, beyond the end pane, a little on the shade side
    const where = () => {
      const t = r();
      if (t < 0.5) return [-HW - 0.25 - r() * 3.2, r() * 3.4, ZB - r() * (ZB - ZE)];
      if (t < 0.9) return [-3.2 + r() * 6.4, r() * 3.4, ZE - 0.3 - r() * 8];
      return [HW + 0.25 + r() * 1.5, r() * 3.4, ZB - r() * (ZB - ZE)];
    };
    for (let k = 0; k < nPollen; k++) put(...where(), 0, 0.0009 + r() * 0.0014, 0.1 + r() * 0.25, 0);
    // swarms: a dozen midges to a shaft
    const swarms = [[-HW - 0.9, 1.7, -5.3], [-HW - 0.7, 1.3, -8.6], [-HW - 1.3, 2.1, -11.5], [0.9, 1.6, ZE - 1.8], [-0.4, 1.2, ZE - 3.2], [POOL.x - 0.3, 0.9, POOL.z + 0.2], [-1.6, 2.2, ZE - 5.5]];
    for (let k = 0; k < nInsect; k++) {
      const s = swarms[k % swarms.length];
      put(s[0] + (r() - 0.5) * 0.5, s[1] + (r() - 0.5) * 0.5, s[2] + (r() - 0.5) * 0.5, 1, 0.0013 + r() * 0.0009, 0.07 + r() * 0.11, 0);
    }
    // drips: from leaf tips a hand to an arm behind the panes
    for (let k = 0; k < nDrip; k++) {
      const t = r();
      const y = 0.8 + r() * 1.5;
      if (t < 0.55) put(-HW - 0.05 - r() * 0.7, y, ZB - 1 - r() * (ZB - ZE - 1.5), 2, 0.0016 + r() * 0.0008, 0, 3.5 + r() * 7);
      else if (t < 0.8) put(HW + 0.05 + r() * 0.6, y, ZB - 1 - r() * (ZB - ZE - 1.5), 2, 0.0016 + r() * 0.0008, 0, 3.5 + r() * 7);
      else put(-1.0 + r() * 2.0, y, ZE - 0.06 - r() * 0.9, 2, 0.0016 + r() * 0.0008, 0, 3.5 + r() * 7);
    }
    const geo = (this.geo = new THREE.InstancedBufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aHome', new THREE.InstancedBufferAttribute(home, 4));
    geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 4));
    geo.instanceCount = n;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: shared,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20000; // after the sky

    // ---- the web: outside the landing pane, in its upper corner by the mullion
    const w = WALLS[0];
    const hub = new THREE.Vector3().copy(w.origin).addScaledVector(w.u, 8.27).addScaledVector(w.v, 1.7).addScaledVector(w.n, -0.004);
    const R = 0.3;
    const g = (this.webGeo = new THREE.BufferGeometry());
    const c = (du, dv) => [hub.x + w.u.x * du, hub.y + dv, hub.z + w.u.z * du];
    g.setAttribute('position', new THREE.Float32BufferAttribute([...c(-R, -R), ...c(R, -R), ...c(R, R), ...c(-R, R)], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([-R, -R, R, -R, R, R, -R, R], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.webMat = new THREE.ShaderMaterial({ vertexShader: WEB_VERT, fragmentShader: WEB_FRAG, uniforms: shared, side: THREE.DoubleSide });
    this.web = new THREE.Mesh(g, this.webMat);
    this.web.frustumCulled = false;
    this.web.renderOrder = -30;
  }

  addTo(scene) {
    scene.add(this.mesh, this.web);
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.webGeo.dispose();
    this.webMat.dispose();
  }
}

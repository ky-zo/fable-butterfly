// The others: everything else that is making the same crossing tonight. A thin river of them along the line of flight,
// from a few wingbeats away to the horizon. The near ones are animals (the kit's flock); from there on each is only
// what the moon makes of it — a faint point that flares once a stroke, when its wings pass the angle that throws the
// moon back — and there are fewer of them the further the crossing goes.
//
// Where each one is, is a pure function of time and of where the hero is: scrub the journey and the river comes along.

import * as THREE from 'three';
import { flap, flightBasis } from '../../shared/butterfly/index.js';
import { SEA_GLSL, seaHeight } from './waves.js';
import { NOISE_GLSL } from './shared.js';
import { SIZE, SHORE_Z } from './shots.js';
import { makeSheenMaterial } from './sheen.js';

const NEAR0 = 14; // metres ahead where the points begin
const FAR = 520;

const VERT = /* glsl */ `
precision highp float;
attribute vec4 aS;    // lane (m to one side), height over the water (m), metres ahead of the hero, how much the lane widens with distance
attribute vec4 aR;    // seed, rank (the higher, the sooner it is gone), size, unused
uniform vec4 uRiver;  // hero x, hero z, how many are still flying 0..1, unused
uniform vec3 uMoonCol;
uniform vec4 uLens;    // focus (m), aperture, largest blur (px), -
uniform float uTime, uPpm;
varying vec3 vQ;
varying vec3 vCol;
${NOISE_GLSL}
${SEA_GLSL}
void main(){
  vQ = vec3(position.xy * 2.0, 0.0);
  vCol = vec3(0.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  float alive = smoothstep(aR.y, aR.y + 0.07, uRiver.z * 1.07);
  if (alive <= 0.0) return;
  float seed = aR.x;
  float s = aS.z * (1.0 + 0.02 * sin(uTime * 0.11 + seed * 31.0));
  vec2 b = vec2(uRiver.x + aS.x + 0.5 * sin(uTime * 0.27 + seed * 40.0), uRiver.y - s);
  // it rides the long swell like everything else out here
  float h = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 w = WV[i];
    h += w.w * uSteep * cos(w.z * dot(w.xy, b) - WT[i].x * uTime + WT[i].y);
  }
  vec3 P = vec3(b.x, aS.y + h + 0.06 * sin(uTime * 0.9 + seed * 50.0), b.y);
  float shore = smoothstep(${(SHORE_Z - 2).toFixed(1)}, ${(SHORE_Z + 14).toFixed(1)}, P.z);
  vec4 vp = viewMatrix * vec4(P, 1.0);
  float dist = max(-vp.z, 0.05);
  // bursts of beats and short glides; once a stroke the wings pass the angle that throws the moon at the lens
  float env = smoothstep(-0.25, 0.35, sin(uTime * (1.1 + seed * 0.5) + seed * 40.0));
  float ph = fract(uTime * (4.6 + seed) + seed * 17.0);
  float flash = exp(-pow((ph - 0.3) / 0.075, 2.0)) * env + 0.25 * (1.0 - env) * (0.5 + 0.5 * sin(uTime * 2.3 + seed * 70.0));
  float I = 0.16 + 1.0 * flash * (0.4 + 0.6 * fract(seed * 7.7));
  float wpx = 0.035 * ${SIZE.toFixed(2)} * aR.z * uPpm / dist;      // a third of a wingspan, in pixels
  float size = clamp(wpx * 0.6, 1.0, 5.0);
  I *= pow(min(1.0, wpx / 1.0), 1.25) * 3.0;
  I *= alive * shore * smoothstep(7.0, 15.0, dist);
  if (I < 0.002) return;
  // out of focus it is a disc of its own (the lens's blur would make a ragged thing of a point this small)
  float coc = clamp(abs(dist - uLens.x) / dist * uLens.y, 0.0, 1.0) * uLens.z * 0.75;
  float big = sqrt(size * size + coc * coc);
  I *= size * size / (big * big);
  vQ.z = smoothstep(1.5, 5.0, coc);
  size = big;
  vp.xy += position.xy * 2.0 * size * 1.6 * dist / uPpm;
  gl_Position = projectionMatrix * vp;
  vCol = uMoonCol * I;
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vQ;
varying vec3 vCol;
void main(){
  float r2 = dot(vQ.xy, vQ.xy);
  float a = mix(exp(-r2 * 5.5) + 0.06 * exp(-r2 * 1.4), (1.0 - smoothstep(0.28, 0.42, r2)) * 0.45 * (0.8 + 0.2 * r2 / 0.4), vQ.z);
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * a, 0.0);
}`;

const NEAR_VERT = /* glsl */ `
precision highp float;
attribute vec4 aG;    // world position, brightness
uniform vec3 uMoonCol;
uniform float uPpm;
varying vec3 vQ;
varying vec3 vCol;
void main(){
  vQ = vec3(position.xy * 2.0, 0.0);
  vec4 vp = viewMatrix * vec4(aG.xyz, 1.0);
  float dist = max(-vp.z, 0.05);
  float wpx = 0.02 * ${SIZE.toFixed(2)} * uPpm / dist;
  float size = clamp(wpx, 1.5, 7.0);
  float I = aG.w * min(1.0, wpx / 1.5) * min(1.0, 36.0 / (wpx * wpx));
  vp.xy += position.xy * 2.0 * size * 2.2 * dist / uPpm;
  gl_Position = I > 0.002 ? projectionMatrix * vp : vec4(2.0, 2.0, 2.0, 1.0);
  vCol = uMoonCol * I;
}`;

const _p = new THREE.Vector3();
const _h = new THREE.Vector3();
const _R = new THREE.Vector3();
const _F = new THREE.Vector3();
const _U = new THREE.Vector3();
const _w = { fore: 0, hind: 0, flex: 0, env: 0 };

export class River {
  /** @param count points   @param near how many are animals */
  constructor(ctx, kit, U, light, { count = 600, near = 16 } = {}) {
    this.U = U;
    const rnd = ctx.rng(47);
    // ---- the far ones: points
    const aS = new Float32Array(count * 4);
    const aR = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      // (evenly spaced as the lens sees them — which is uniform in 1/distance — and so thinning toward the horizon)
      const s = 1 / (1 / NEAR0 - Math.pow(rnd(), 0.8) * (1 / NEAR0 - 1 / FAR));
      aS[i * 4] = rnd.gauss() * (0.35 + 0.0022 * s);
      aS[i * 4 + 1] = 0.25 + 0.55 * rnd() + 0.0006 * s * rnd();
      aS[i * 4 + 2] = s;
      aS[i * 4 + 3] = 0;
      aR[i * 4] = rnd();
      aR[i * 4 + 1] = rnd();
      aR[i * 4 + 2] = 0.8 + 0.4 * rnd();
      aR[i * 4 + 3] = 0;
    }
    const quad = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
    const geo = ctx.track(new THREE.InstancedBufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 4));
    geo.setAttribute('aR', new THREE.InstancedBufferAttribute(aR, 4));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const add = { transparent: true, depthTest: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
    const mat = ctx.track(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: U, ...add }));
    this.points = new THREE.Mesh(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;

    // ---- the near ones: animals, and the same flare on each
    this.near = near;
    this.flock = kit.flock(near, { light });
    this.who = [];
    for (let i = 0; i < near; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      // (never on the hero's own line: none of them may come between it and the lens)
      this.who.push({ lane: side * (0.5 + 1.5 * rnd() * rnd()), alt: 0.2 + 0.9 * rnd(), s: i < 2 ? -3 - 6 * rnd() : 2.2 + 44 * Math.pow((i - 1) / near, 1.5) + rnd() * 1.5, seed: rnd(), rank: (i * 0.618034 + 0.31) % 1, size: SIZE * (0.9 + 0.16 * rnd()) });
      this.flock.look(i, 0, 0, rnd(), 0.3 + 0.5 * rnd());
    }
    this.glint = new Float32Array(near * 4);
    const ngeo = ctx.track(new THREE.InstancedBufferGeometry());
    ngeo.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    ngeo.setIndex([0, 1, 2, 0, 2, 3]);
    this.gAttr = new THREE.InstancedBufferAttribute(this.glint, 4).setUsage(THREE.DynamicDrawUsage);
    ngeo.setAttribute('aG', this.gAttr);
    ngeo.instanceCount = near;
    ngeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const nmat = ctx.track(new THREE.ShaderMaterial({ vertexShader: NEAR_VERT, fragmentShader: FRAG, uniforms: { uMoonCol: U.uMoonCol, uPpm: U.uPpm }, ...add }));
    this.nearPoints = new THREE.Mesh(ngeo, nmat);
    this.nearPoints.frustumCulled = false;
    this.nearPoints.renderOrder = 5;

    // (and the moon in their wings: over dark water it is most of what can be seen of them)
    const sheen = new THREE.InstancedMesh(this.flock.wingGeo, makeSheenMaterial(ctx, U, kit, new THREE.Vector4(1.8, 0.3, 0.5, 1.2), null, new THREE.Vector4(0.9, 1.2, 0, 1)), near);
    sheen.instanceMatrix = this.flock.wings.instanceMatrix;
    sheen.frustumCulled = false;
    sheen.renderOrder = 4.5;

    this.group = new THREE.Group();
    this.group.add(this.points, this.flock.group, sheen, this.nearPoints);
  }

  /** @param hero its position on its line (the river is laid out from there)   @param alive 0..1 how many still fly   @param yaw how far the wind has their bodies turned off the line (rad) */
  update(t, hero, steep, alive, yaw = 0) {
    this.U.uRiver.value.set(hero.x, hero.z, alive, 0);
    const G = this.glint;
    for (let i = 0; i < this.near; i++) {
      const b = this.who[i];
      const on = Math.min(1, Math.max(0, (alive * 1.07 - b.rank) / 0.07));
      const z = hero.z - b.s - 0.7 * Math.sin(t * 0.13 + b.seed * 9);
      const x = hero.x + b.lane + 0.3 * Math.sin(t * 0.21 + b.seed * 30);
      const shore = Math.min(1, Math.max(0, (z - (SHORE_Z + 4)) / 14));
      flap(t, b.seed, 4.8 + b.seed, _w);
      const y = b.alt + seaHeight(x, z, t, steep, 3) + 0.035 * Math.sin(t * 1.1 + b.seed * 50) + 0.02 * _w.env;
      _p.set(x, y, z);
      // (the same wind has all of them: each turns into it by about as much, a moment sooner or later)
      const yw = yaw * (0.7 + 0.3 * b.seed);
      _h.set(0.3 * 0.21 * Math.cos(t * 0.21 + b.seed * 30) * 0.4 - Math.sin(yw), 0, -Math.cos(yw)).normalize();
      flightBasis(_h, 0.5, 0.12 * Math.sin(t * 0.9 + b.seed * 20), _R, _F, _U);
      this.flock.set(i, _p, _R, _F, _U, b.size * on * shore, _w.fore, _w.hind, _w.flex);
      const flash = Math.exp(-Math.pow((_w.fore - 0.42) / 0.2, 2)) * _w.env;
      G[i * 4] = x;
      G[i * 4 + 1] = y + 0.01;
      G[i * 4 + 2] = z;
      G[i * 4 + 3] = (0.1 + 1.6 * flash) * on * shore;
    }
    this.flock.commit();
    this.gAttr.needsUpdate = true;
  }
}

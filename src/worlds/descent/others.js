// The others: the ones the lamp already has. Each flies its own ring round it — some wide and flat, some tight and
// tipped right over — and none of the rings closes, so that the lines they leave fill in a nest around the flame.
// The animals are the kit's flock; over each goes the lamp in its wings (sheen.js), without which there is almost
// nothing to see of them at night; behind each, the stretch of its ring it has just flown.
//
// Where each one is, is a pure function of time. When the day comes the rings open and they are gone one by one.

import * as THREE from 'three';
import { flap } from '../../shared/butterfly/index.js';
import { makeSheenMaterial } from './sheen.js';
import { SIZE } from './shots.js';

// one ring, the same on the CPU and in the vertex shader:
//   o1 = (radius, how far out of round, how fast the bulge goes round, where the bulge is)
//   o2 = (height over the lamp, how far it is tipped, where it is highest, rank: the higher, the sooner it leaves)
const ORBIT_GLSL = /* glsl */ `
vec3 orbitAt(vec4 o1, vec4 o2, float th, float open, vec3 lamp){
  float out_ = open * (1.2 + 5.0 * o2.w) * (1.0 + 0.6 * o1.x);
  float r = o1.x * (1.0 + o1.y * sin(o1.z * th + o1.w)) + out_;
  float y = o2.x + o2.y * o1.x * sin(th + o2.z) + open * open * (0.4 + 2.2 * o2.w);
  return lamp + vec3(r * cos(th), y, r * sin(th));
}`;
function orbitAt(b, th, open, lamp, out) {
  const out_ = open * (1.2 + 5.0 * b.rank) * (1.0 + 0.6 * b.r);
  const r = b.r * (1.0 + b.e * Math.sin(b.k * th + b.f)) + out_;
  const y = b.h + b.a * b.r * Math.sin(th + b.g) + open * open * (0.4 + 2.2 * b.rank);
  return out.set(lamp.x + r * Math.cos(th), lamp.y + y, lamp.z + r * Math.sin(th));
}

const VERT = /* glsl */ `
precision highp float;
attribute vec4 aO1, aO2, aO3;     // aO3 = (where on its ring it starts, how fast it goes round (rad/s), how much of the ring its line covers (rad), seed)
uniform vec3 uLampPos;
uniform vec2 uRes;
uniform float uTime, uOpen, uPpm, uGain;
varying vec3 vCol;
varying vec2 vEdge;
${ORBIT_GLSL}
void main(){
  float u = position.x;
  float dirn = sign(aO3.y);
  float head = aO3.x + aO3.y * uTime;
  float th = head - dirn * aO3.z * u;
  vec3 P = orbitAt(aO1, aO2, th, uOpen, uLampPos);
  vec3 Q = orbitAt(aO1, aO2, th + dirn * 0.02, uOpen, uLampPos);
  vec4 v0 = viewMatrix * vec4(P, 1.0), v1 = viewMatrix * vec4(Q, 1.0);
  float d = -v0.z;
  vec4 c0 = projectionMatrix * v0;
  gl_Position = c0;
  vCol = vec3(0.0); vEdge = vec2(0.0, 1.0);
  float alive = 1.0 - smoothstep(0.55, 1.0, uOpen * (0.7 + 0.9 * aO2.w));
  if (d < 0.06 || alive <= 0.0 || -v1.z < 0.06) return;
  vec4 c1 = projectionMatrix * v1;
  vec2 dir = normalize((c1.xy / c1.w - c0.xy / c0.w) * uRes + 1e-6);
  vec2 nrm = vec2(-dir.y, dir.x);
  float truePx = 0.008 * uPpm / d * (1.0 + 1.2 * exp(-u * 60.0));
  float rs = uRes.y / 1080.0;
  float wpx = clamp(truePx, 0.7 * rs, 1.6 * rs);
  float a = pow(1.0 - u, 1.7) * pow(min(truePx / wpx, 1.0), 0.45) * alive * (1.0 - 0.8 * uOpen);
  vec3 hue = mix(vec3(1.0, 0.36, 0.1), vec3(1.0, 0.72, 0.4), pow(1.0 - u, 4.0));
  vCol = hue * (a * uGain * (0.55 + 0.6 * fract(aO3.w * 7.3)));
  float half_ = wpx * 2.4 + 0.75 * rs;
  vEdge = vec2(position.y * half_, wpx);
  gl_Position.z -= 0.0004 * c0.w;
  gl_Position.xy += nrm * vEdge.x * 2.0 / uRes * c0.w;
}`;
const FRAG = /* glsl */ `
precision highp float;
varying vec3 vCol;
varying vec2 vEdge;
void main(){
  float x = abs(vEdge.x) / vEdge.y;
  gl_FragColor = vec4(vCol * (exp(-x * x * 2.2) + 0.07 * exp(-x * 1.1)), 0.0);
}`;

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _R = new THREE.Vector3();
const _F = new THREE.Vector3();
const _U = new THREE.Vector3();
const _t = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _w = { fore: 0, hind: 0, flex: 0, env: 0 };

export class Others {
  constructor(ctx, kit, U, light, plan, { count = 30, segs = 56 } = {}) {
    this.plan = plan;
    this.count = count;
    const rnd = ctx.rng(63);
    this.who = [];
    const o1 = new Float32Array(count * 4), o2 = new Float32Array(count * 4), o3 = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const r = 0.45 + 2.9 * Math.pow(rnd(), 1.7);
      const sp = (1.3 + 1.2 * rnd()) / r; // rad/s: all of them fly at much the same speed
      const b = {
        r,
        e: 0.06 + 0.22 * rnd(),
        k: 0.55 + 0.9 * rnd(),
        f: rnd() * 6.28,
        h: -0.25 + 0.75 * rnd() * (0.5 + 0.2 * r),
        a: 0.08 + 0.5 * rnd() * rnd(),
        g: rnd() * 6.28,
        rank: (i * 0.618034 + 0.17) % 1,
        th0: rnd() * 6.28,
        w: sp * (rnd() < 0.72 ? 1 : -1),
        len: (1.6 + 3.4 * rnd()) * Math.min(1.6, 0.6 + 0.5 / r),
        seed: rnd(),
        size: SIZE * (0.8 + 0.3 * rnd()),
      };
      this.who.push(b);
      o1.set([b.r, b.e, b.k, b.f], i * 4);
      o2.set([b.h, b.a, b.g, b.rank], i * 4);
      o3.set([b.th0, b.w, b.len, b.seed], i * 4);
    }
    // ---- the animals
    this.flock = kit.flock(count, { light });
    for (let i = 0; i < count; i++) this.flock.look(i, 0, 0, this.who[i].seed, 0.3 + 0.5 * rnd());
    this.sheenGain = { value: 1 };
    const sheen = new THREE.InstancedMesh(this.flock.wingGeo, makeSheenMaterial(ctx, U, kit, new THREE.Vector4(1.6, 3.5, 1.2, 1.2), (this.more = new THREE.Vector4(1.1, 1.0, 1.0, 1.0)), this.sheenGain), count);
    sheen.instanceMatrix = this.flock.wings.instanceMatrix;
    sheen.frustumCulled = false;
    sheen.renderOrder = 24;
    // ---- their lines
    const strip = ctx.track(new THREE.InstancedBufferGeometry());
    const sp = new Float32Array((segs + 1) * 2 * 3);
    const si = [];
    for (let j = 0; j <= segs; j++) {
      const u = Math.pow(j / segs, 1.5); // more of the cross-sections near the head, where the line is brightest
      sp.set([u, -1, 0, u, 1, 0], j * 6);
      if (j < segs) {
        const a = j * 2;
        si.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    strip.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    strip.setIndex(si);
    strip.setAttribute('aO1', new THREE.InstancedBufferAttribute(o1, 4));
    strip.setAttribute('aO2', new THREE.InstancedBufferAttribute(o2, 4));
    strip.setAttribute('aO3', new THREE.InstancedBufferAttribute(o3, 4));
    strip.instanceCount = count;
    strip.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = { uLampPos: { value: plan.LAMP }, uRes: U.uRes, uPpm: U.uPpm, uTime: { value: 0 }, uOpen: { value: 0 }, uGain: { value: 1 } };
    const mat = ctx.track(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }));
    this.lines = new THREE.Mesh(strip, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 28;
    this.group = new THREE.Group();
    this.group.add(this.flock.group, sheen, this.lines);
  }

  /** @param open 0 a nest … 1 all gone   @param gain how bright their lines are */
  update(t, open, gain) {
    const lamp = this.plan.LAMP;
    this.uniforms.uTime.value = t;
    this.uniforms.uOpen.value = open;
    this.uniforms.uGain.value = gain;
    const dors = 0.85 * (1 - Math.min(1, open * 1.6));
    for (let i = 0; i < this.count; i++) {
      const b = this.who[i];
      const th = b.th0 + b.w * t;
      const dirn = Math.sign(b.w);
      orbitAt(b, th, open, lamp, _p);
      orbitAt(b, th + dirn * 0.02, open, lamp, _q);
      _t.copy(_q).sub(_p).normalize();
      const alive = 1 - Math.min(1, Math.max(0, (open * (0.7 + 0.9 * b.rank) - 0.55) / 0.45));
      // nose up a little, and its back turned to the light
      _F.copy(_t).addScaledVector(UP, 0.45).normalize();
      _R.crossVectors(_F, UP).normalize();
      _U.crossVectors(_R, _F);
      _q.copy(lamp).sub(_p);
      _q.addScaledVector(_F, -_q.dot(_F)).normalize();
      const bank = Math.atan2(_q.dot(_R), _q.dot(_U)) * dors;
      _R.applyAxisAngle(_F, bank);
      _U.applyAxisAngle(_F, bank);
      flap(t, b.seed, 4.6 + b.seed, _w);
      this.flock.set(i, _p, _R, _F, _U, b.size * alive, _w.fore, _w.hind, _w.flex);
    }
    this.flock.commit();
  }
}

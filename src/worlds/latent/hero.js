// The animal here: a constellation. The same glasswing as everywhere else — the kit's outline, veins and wingbeat —
// drawn as some twenty thousand points sampled from its geometry and seen through this world's lens.
//
//   veins     hair-fine and pale: the drawing of the wing, dark where it runs under the scales
//   border    the band of scales laid open: violet velvet, and along the outer margins the ember — amber at its core,
//             crimson on its shoulders — with a row of small white stars in its rim
//   bar       the white bar of the forewing: the brightest cluster it has
//   membrane  the clear cells: almost nothing, and what there is is the colour of the film (cyan, violet, a thread of
//             gold), which slides as the wing turns; a point here and there catching light
//   body      slender and dark, drawn by its white spots; antennae hair-fine, each ending in an ember knot
//   glow      one point in ten of the ember and of the bar is a soft lamp many times the size of the others
//   trail     on every downstroke the outer margins shed a few points of their ember, which hang where they were left and go out
//
// Progress says where along its line of flight it is and whether it is down (config.js). Time gives it life on top of
// that: the wingbeat, bursts and glides, a wandering course; at rest the slow fanning of the wings. None of this ever
// reaches the camera.

import * as THREE from 'three';
import { smoothstep } from '../../core/util.js';
import { pointVertexGLSL, wingCells, wingOutline, wingPoint, makePose, poseUniforms, flightPose, restPose, bodyMatrix, SPAN, CLUB } from '../../shared/butterfly/index.js';
import { buildConstellation } from './constellation.js';
import { SIZE, ST, STATIONS, PERCH, STAND, airborne, perchAt, pathAt, inStation } from './config.js';
import { LENS_VERT, lensMaterial } from './lens.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q = new THREE.Quaternion();

const VERT = /* glsl */ `
precision highp float;
${pointVertexGLSL}
attribute float aCell;
attribute vec4 aTone;     // ember, its heat, white, across the border (constellation.js)
uniform float uTime;
uniform vec4 uHero;       // world radius of a point, light, how far it has come apart (0 whole … 1 scattered), glow
uniform vec4 uPart;       // light of: the veins, the membrane, the border, the body
uniform float uCool;      // 0 itself … 1 the other one, seen through the glass: the same markings, colder and paler
uniform float uScatter;   // how far its points lie from it when it has come apart
uniform vec4 uCold;       // toward the cold light, in the world (xyz); how much of that light is on it (w)
uniform vec3 uColdTint;
${LENS_VERT}
float h11(float n){ return fract(sin(n * 91.7 + 13.1) * 43758.5453); }
// The colour of the film a clear wing is made of, for an optical path in nanometres: the kit's (wingMaterial.js) —
// not the whole rainbow: cyan and violet, and a thread of pale gold between them. The cool half of the palette,
// against the ember of the border.
vec3 filmCol(float opd){
  float h = opd / 170.0;
  vec3 c = mix(vec3(0.74, 0.5, 1.0) * 1.25, vec3(0.3, 0.84, 1.0), 0.5 + 0.5 * cos(6.2831853 * h));
  float g = 0.5 + 0.5 * cos(6.2831853 * (h * 0.5 + 0.21));
  return mix(c, vec3(1.0, 0.8, 0.46), g * g * g * 0.75);
}
void main(){
  vec3 b = bfPoint();
  vec4 wp = modelMatrix * vec4(b, 1.0);
  // which side of it this point is on, as the cold light sees it: −1 the far side … +1 the side it falls on
  float lit = clamp(dot(wp.xyz - modelMatrix[3].xyz, uCold.xyz) / 0.5, -1.0, 1.0);
  vec3 V = normalize(cameraPosition - wp.xyz);
  float light = 1.0;
  if (uHero.z > 0.0) {
    // come apart: each point leaves in its own time, the wingtips first
    float late = 0.55 * aRand + 0.45 * (1.0 - clamp(length(b.xy) / 30.0, 0.0, 1.0));
    float s = smoothstep(0.0, 1.0, clamp((uHero.z * 1.6 - late * 0.6), 0.0, 1.0));
    vec3 r3 = vec3(h11(aRand * 17.0), h11(aRand * 29.0 + 0.3), h11(aRand * 41.0 + 0.7)) - 0.5;
    r3 += 0.25 * sin(uTime * 0.3 + r3.yzx * 20.0);
    wp.xyz += r3 * uScatter * s;
    light = 1.0 - 0.85 * s;
  }
  vec4 mv = viewMatrix * wp;
  float d = -mv.z;
  lensHide();
  if (d < 0.1) return;
  vec4 clip = projectionMatrix * mv;
  float vein = aKind.x, border = aKind.y, mem = aKind.z, body = aKind.w;
  float ember = aTone.x, heat = aTone.y, white = aTone.z;
  // every point has its own slow twinkle; a few of them, now and then, a flash
  float tw = pow(0.5 + 0.5 * sin(uTime * (2.0 + 5.0 * aRand) + aRand * 40.0), 10.0);
  const vec3 PEARL = vec3(1.0, 0.95, 0.86);
  vec3 col;
  float sz = 0.8 + 0.5 * aRand;
  bool lamp = false;
  if (aWing.x != 0.0) {
    // how the wing this point is on is turned to the lens (the wing as a flat plate, raised by its stroke)
    float phi = mix(uPose.x, uPose.y, aWing.y);
    vec3 N = normalize(mat3(modelMatrix) * vec3(-sin(phi) * aWing.x, 0.0, cos(phi)));
    float ndv = abs(dot(N, V));
    if (mem > 0.5) {
      // the clear cells: almost nothing, and what there is is the film's colour. Its thickness changes slowly across a
      // cell and from cell to cell, so the colour lies in sweeps; it slides as the wing turns, and breathes a little
      float th = 250.0 + 80.0 * h11(aCell * 3.7 + aWing.y * 11.0) + 66.0 * sin(position.x * 0.21 + position.y * 0.13 + 3.3) + 48.0 * sin(position.x * 0.09 - position.y * 0.33 + 1.9)
               + 30.0 * sin(uTime * 0.37 + aCell * 1.7 + position.x * 0.11);
      vec3 film = filmCol(th * sqrt(1.0 - (1.0 - ndv * ndv) / 2.25));
      // (a film mirrors more the more it is turned away; face-on a cell is all but empty)
      float sheen = 0.5 + 1.4 * pow(1.0 - ndv, 2.0);
      col = film * uPart.y * sheen * (0.4 + 0.5 * aRand + 6.0 * tw);
      sz *= 0.9;
    } else if (vein > 0.5) {
      // the veins: hair-fine, pale, the drawing of the wing — and dark where they run under the scales of the border
      col = mix(vec3(1.0, 0.9, 0.74), vec3(0.8, 0.9, 1.0), 0.35 * (1.0 - ndv)) * uPart.x * (0.55 + 0.7 * aRand) * (0.22 + 0.78 * aTone.w);
      sz *= 0.92;
      lamp = aRand > 0.962;
    } else if (white > 0.0) {
      // the white bar (and the row of small stars in the rim of the margin): the brightest thing it has
      col = PEARL * uPart.z * white * (0.3 + 0.34 * aRand + 1.2 * tw * aTone.w) * (1.0 + 2.4 * (1.0 - aTone.w));
      sz *= mix(0.8, 1.12, aTone.w);
      lamp = aRand > 0.9 && white > 0.9;
    } else {
      // the band of scales. Velvet: a deep violet, nearly nothing. In it, along the outer margins, the ember: amber
      // at its core, crimson on both shoulders; single scales of it flash copper as the wing turns
      vec3 emb = mix(vec3(1.0, 0.36, 0.05), vec3(0.9, 0.05, 0.03), heat);
      vec3 vel = vec3(0.2, 0.16, 0.5) * (0.11 + 0.1 * (1.0 - ndv));
      col = mix(vel, emb * (0.48 + 0.55 * aRand), ember) + vec3(1.0, 0.55, 0.2) * ember * tw * 1.6;
      col *= uPart.z;
      sz *= 0.9 + 0.2 * ember;
      lamp = aRand > 0.84 && ember > 0.4;
    }
  } else {
    float id = aPart.x, u = aPart.y;
    if (id > 5.5 && id < 6.5) {
      // an antenna: a hair, ending in a knot the colour of the ember
      float club = smoothstep(${CLUB.toFixed(2)} - 0.03, ${CLUB.toFixed(2)} + 0.09, u);
      col = mix(vec3(0.72, 0.7, 0.86) * 0.34, vec3(1.0, 0.56, 0.2) * 1.5, club) * (0.6 + 0.8 * aRand);
      sz = mix(0.5, 0.95, club);
    } else if (id > 6.5) {
      // legs: wire
      col = vec3(0.6, 0.6, 0.8) * 0.2 * (0.5 + aRand);
      sz = 0.5;
    } else {
      // the body: dark velvet, slender, drawn by a few points along its flank and by its white spots
      float taper = id > 0.5 && id < 1.5 ? 1.0 - 0.45 * u : 1.0;
      col = vec3(0.5, 0.47, 0.78) * 0.26 * (0.4 + aRand) * taper;
      sz *= 0.85;
      if (white > 0.0) { col = PEARL * white * (1.2 + 0.8 * aRand + 1.5 * tw); sz = 0.7 + 0.4 * white; }
    }
    col *= uPart.w;
  }
  // (the other one is behind the glass: the same markings, their colour half gone into the cold of the pane)
  col = mix(col, dot(col, vec3(0.3, 0.55, 0.15)) * vec3(0.74, 0.9, 1.0) * 1.1, uCool);
  if (uCold.w > 0.0) {
    // lit cold on the side toward the one light that is not like the rest; the other side keeps the warmth of what it
    // is leaving, a shade deeper for the contrast
    float c = smoothstep(-0.25, 0.7, lit) * uCold.w;
    float w = (1.0 - smoothstep(-0.7, 0.2, lit)) * uCold.w;
    float y = dot(col, vec3(0.3, 0.55, 0.15));
    col = mix(col, uColdTint * y * 1.5, c * (1.0 - 0.45 * max(ember, white)));
    col *= mix(vec3(1.0), vec3(1.08, 0.78, 0.5), w);
  }
  float Rw = uHero.x * sz;
  float rgeo = Rw * uFocalPx / d;
  // (close to the lens its points lie over one another: each carries a little less, so the markings stay drawn and do not burn out)
  col *= uHero.y * light * clamp(d / 9.0, 0.5, 1.2);
  // a soft lamp in one point of ten of the ember and of the bar, and in a few of the veins: this is what makes it glow
  // rather than glitter, and the glow has the colour of the thing that gives it
  if (lamp) {
    rgeo *= 6.0;
    col *= uHero.w;
  }
  lensEmit(clip, d, rgeo, col);
}`;

const TRAIL_VERT = /* glsl */ `
precision highp float;
attribute vec3 aVel;
attribute vec2 aBirth;    // when it was shed, a random number
uniform float uTime;
uniform vec4 uTrail;      // world radius, light, how long it lasts, -
uniform vec3 uTint;
${LENS_VERT}
void main(){
  float age = uTime - aBirth.x;
  float life = uTrail.z * (0.45 + 0.9 * aBirth.y);
  lensHide();
  if (age < 0.0 || age > life) return;
  float k = age / life;
  // left behind: it keeps a little of the wing's motion, and loses it
  vec3 p = position + aVel * (age * (1.0 - 0.5 * k));
  p += 0.05 * sin(vec3(7.0, 9.0, 8.0) * (age + aBirth.y * 9.0) + aBirth.y * vec3(30.0, 50.0, 70.0)) * k;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  if (d < 0.1) return;
  float lum = uTrail.y * (1.0 - k) * (1.0 - k) * (0.3 + 1.4 * aBirth.y * aBirth.y);
  // (shed from the ember of the margin: it leaves the wing amber and goes out through crimson, as an ember does)
  lensEmit(projectionMatrix * mv, d, uTrail.x * (1.0 - 0.4 * k) * uFocalPx / d, uTint * mix(vec3(1.0), vec3(1.0, 0.36, 0.2), smoothstep(0.1, 0.9, k)) * lum);
}`;

/** Slow wandering off its line, in units of its own wingspan or so: pure in time. */
function wander(t, out) {
  return out.set(
    (Math.sin(t * 0.83) + 0.5 * Math.sin(t * 1.97 + 1.3) + 0.22 * Math.sin(t * 4.3 + 0.7)) * 0.2,
    (Math.sin(t * 0.71 + 2.1) + 0.5 * Math.sin(t * 1.63 + 0.4) + 0.2 * Math.sin(t * 5.1)) * 0.13,
    (Math.cos(t * 0.67 + 0.9) + 0.5 * Math.sin(t * 2.23 + 2.0) + 0.22 * Math.sin(t * 3.7 + 1.1)) * 0.2,
  );
}

const TRAIL_N = 2048;

export class Hero {
  constructor(ctx, lens, level) {
    this.ctx = ctx;
    this.lens = lens;
    this.level = level;
    this.count = [9000, 15000, 24000][level];
    this.position = new THREE.Vector3();
    this.base = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.heading = new THREE.Vector3(0, 0, -1);
    this.R = new THREE.Vector3(1, 0, 0);
    this.F = new THREE.Vector3(0, 0, -1);
    this.U = new THREE.Vector3(0, 1, 0);
    this.matrix = new THREE.Matrix4();
    this.prevMatrix = new THREE.Matrix4();
    this.pose = makePose();
    this.poseF = makePose();
    this.poseR = makePose();
    this.prevPose = makePose();
    this.matePose = makePose();
    this.beat = null;
    this.air = 1;
    this.stroke = 0; // 0..1 how hard the wings are coming down right now
    this.lastTime = -1;
    this.head = 0;
    this.emitAcc = 0;
    this.reduced = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    this._seed = 1;
  }

  async init() {
    const { ctx, lens } = this;
    const pause = () => ctx.yield();
    const cells = [await wingCells(0, { pause }), await wingCells(1, { pause })];
    await ctx.yield();
    const geo = (this.geometry = ctx.track(await buildConstellation(ctx, this.count, cells, pause)));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    // fewer points on the lower tiers, each a little larger and brighter
    const k = 24000 / this.count;
    const mk = (pose, look, cool, scatter, light) => {
      const uniforms = {
        ...lens,
        ...poseUniforms(pose),
        uTime: { value: 0 },
        uHero: { value: new THREE.Vector4(0.004 * Math.pow(k, 0.3), light * Math.pow(k, 0.8), 0, 0.02) },
        uPart: { value: new THREE.Vector4(...look) },
        uCool: { value: cool },
        uScatter: { value: scatter },
        uCold: { value: new THREE.Vector4(-1, 0, 0, 0) },
        uColdTint: { value: new THREE.Vector3(0.6, 0.78, 1.0) },
      };
      const sharp = new THREE.Points(geo, lensMaterial(ctx, VERT, uniforms, {}));
      const bokeh = new THREE.Points(geo, lensMaterial(ctx, VERT, uniforms, { BOKEH: 1 }));
      for (const o of [sharp, bokeh]) {
        o.frustumCulled = false;
        o.matrixAutoUpdate = false;
        o.matrixWorldAutoUpdate = false;
      }
      return { uniforms, sharp, bokeh };
    };
    // itself. The other one, behind the glass: the same animal, cooler and further off
    this.self = mk(this.pose, [0.7, 0.42, 1.0, 1.0], 0, 5, 0.44);
    this.light = this.self.uniforms.uHero.value.y;
    this.radius = this.self.uniforms.uHero.value.x;
    this.mate = mk(this.matePose, [0.7, 0.42, 1.0, 1.0], 0.62, 9, 0.15);

    // what the wingtips shed
    const tg = (this.trailGeo = ctx.track(new THREE.BufferGeometry()));
    this.tPos = new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tVel = new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tBirth = new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2).fill(-1e6), 2).setUsage(THREE.DynamicDrawUsage);
    tg.setAttribute('position', this.tPos);
    tg.setAttribute('aVel', this.tVel);
    tg.setAttribute('aBirth', this.tBirth);
    tg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const tu = (this.trailUniforms = { ...lens, uTime: { value: 0 }, uTrail: { value: new THREE.Vector4(0.0052, 2.0, 0.85, 0) }, uTint: { value: new THREE.Vector3(1.0, 0.76, 0.48) } });
    this.trail = { sharp: new THREE.Points(tg, lensMaterial(ctx, TRAIL_VERT, tu, {})), bokeh: new THREE.Points(tg, lensMaterial(ctx, TRAIL_VERT, tu, { BOKEH: 1 })) };
    for (const o of [this.trail.sharp, this.trail.bokeh]) {
      o.frustumCulled = false;
      o.matrixAutoUpdate = false;
    }
    // where on the wings the trail leaves from: the outer margin, tip to tornus (flat wing frame, mm)
    this.tips = [];
    for (const hind of [0, 1]) for (const p of wingOutline(hind, 96)) if (p[0] > SPAN[hind] * (hind ? 0.72 : 0.6)) this.tips.push([p[0], p[1], hind]);
    await ctx.yield();

    // the other one stands on the far side of the glass, a little above, head down: head to head with ours
    const g = STATIONS[ST.PANE];
    const at = PERCH[1].at;
    this.matePos = inStation(ST.PANE, at[0] + 0.12, at[1] + 1.32, -STAND);
    this.mateR = g.r.clone();
    this.mateF = g.u.clone().multiplyScalar(-1).addScaledVector(g.r, -0.1).normalize();
    this.mateU = g.n.clone().multiplyScalar(-1);
    this.mateR.crossVectors(this.mateF, this.mateU);
  }

  addTo(points) {
    for (const x of [this.self, this.mate, this.trail]) {
      points.sharpScene.add(x.sharp);
      points.bokehScene.add(x.bokeh);
    }
  }

  _rnd() {
    // (a small private generator: what the tips shed need not be reproducible point for point, but must not use Math.random)
    let t = (this._seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * @param frame the core's frame      @param tl the timeline at this progress (config.js)
   */
  update(frame, tl) {
    const { progress: p, time: t, dt } = frame;
    const calm = this.reduced ? 0.3 : 1;
    const air = (this.air = airborne(p));
    const k = perchAt(p);
    const e = air * air * (3 - 2 * air);
    pathAt(p, this.base);

    // ---- pose: beating in the air, fanning at rest
    // (toward the very end it eases into a shallower beat, nearer a glide: wings held where they can be seen from behind)
    const wb = (this.beat = flightPose(this.poseF, t, this.reduced ? 0.45 : 1 - 0.5 * tl.fin));
    restPose(this.poseR, t, 0.2 + k * 0.37, 1);
    {
      // down, it basks: wings held open, closing part of the way and opening again
      const fan = 0.5 - 0.5 * Math.cos(t * 0.74 + k * 2.0);
      const fore = 0.3 + 0.62 * fan * fan * (0.6 + 0.4 * Math.sin(t * 0.31 + k));
      this.poseR.wings.set(fore, fore - 0.07 - 0.05 * fan, 0, 0);
    }
    const pose = this.pose;
    this.prevPose.wings.copy(pose.wings);
    pose.wings.copy(this.poseR.wings).lerp(this.poseF.wings, e);
    pose.limbs.copy(this.poseR.limbs).lerp(this.poseF.limbs, e);
    pose.limbs.x = smoothstep(0.1, 0.65, air);
    pose.twitch.copy(this.poseR.twitch).multiplyScalar(1 - e);
    this.stroke = wb.beating * (wb.phase < 0.44 ? Math.sin((Math.PI * wb.phase) / 0.44) : 0) * e * (this.reduced ? 0.4 : 1);

    // ---- where: its line, and the life time adds to it (less of that at the very end, where the picture is exact)
    const pos = this.position;
    _c.copy(pos);
    const loose = (1 - 0.75 * tl.fin) * calm * e;
    wander(t, _a).multiplyScalar(loose);
    pos.copy(this.base).add(_a);
    pos.y += wb.lift * SIZE * e * calm * (1 - 0.8 * tl.fin);
    if (dt > 0 && this.lastTime >= 0) this.velocity.copy(pos).sub(_c).multiplyScalar(1 / dt).clampLength(0, 30);
    else this.velocity.set(0, 0, 0);

    // ---- which way: along the line of flight
    pathAt(Math.min(1, p + 0.004), _a).sub(pathAt(Math.max(0, p - 0.004), _b));
    _a.y *= 0.25;
    if (_a.lengthSq() > 1e-10) _a.normalize();
    else _a.copy(this.heading);
    wander(t + 0.12, _b).sub(wander(t - 0.12, _c)).multiplyScalar(1.6 * loose);
    _a.add(_b);
    _a.y = 0;
    if (_a.lengthSq() < 1e-8) _a.set(0, 0, -1);
    _a.normalize();
    if (dt > 0 && air > 0.02 && this.lastTime >= 0) this.heading.lerp(_a, 1 - Math.exp(-5 * dt)).normalize();
    else this.heading.copy(_a);
    const pitch = 0.42 + wb.pitch * calm;
    _f.copy(this.heading).multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch));
    _r.crossVectors(this.heading, UP).normalize();
    const roll = (0.1 * Math.sin(t * 1.3 + 0.4) + 0.06 * Math.sin(t * 2.9)) * calm * (1 - 0.7 * tl.fin);
    _u.crossVectors(_r, _f);
    _r.applyAxisAngle(_f, roll);
    _u.applyAxisAngle(_f, roll);
    _q1.setFromRotationMatrix(_m.makeBasis(_r, _f, _u));
    // at rest: its back to the surface's normal
    const pc = PERCH[k];
    _u.copy(pc.n);
    _f.copy(pc.head).addScaledVector(_u, -pc.head.dot(_u)).normalize().applyAxisAngle(_u, 0.05 * Math.sin(t * 0.23 + k) * calm);
    _r.crossVectors(_f, _u);
    _q0.setFromRotationMatrix(_m.makeBasis(_r, _f, _u));
    _q.copy(_q0).slerp(_q1, e);
    this.R.set(1, 0, 0).applyQuaternion(_q);
    this.F.set(0, 1, 0).applyQuaternion(_q);
    this.U.set(0, 0, 1).applyQuaternion(_q);
    this.prevMatrix.copy(this.matrix);
    bodyMatrix(this.matrix, pos, this.R, this.F, this.U, SIZE);
    for (const o of [this.self.sharp, this.self.bokeh]) {
      o.matrix.copy(this.matrix);
      o.matrixWorld.copy(this.matrix);
    }
    this.self.uniforms.uTime.value = t;

    // ---- the other one
    const mateOn = tl.mate > 0.002;
    this.mate.sharp.visible = this.mate.bokeh.visible = mateOn;
    if (mateOn) {
      restPose(this.matePose, t + 3.1, 0.71, 1);
      {
        const fan = 0.5 - 0.5 * Math.cos(t * 0.61 + 1.3);
        const fore = 0.42 + 0.7 * fan * fan;
        this.matePose.wings.set(fore, fore - 0.08, 0, 0);
      }
      bodyMatrix(_m, this.matePos, this.mateR, this.mateF, this.mateU, SIZE);
      for (const o of [this.mate.sharp, this.mate.bokeh]) {
        o.matrix.copy(_m);
        o.matrixWorld.copy(_m);
      }
      this.mate.uniforms.uTime.value = t;
      this.mate.uniforms.uHero.value.z = 1 - tl.mate;
    }

    // ---- the trail: on the way down, the outer edge of each wing sheds points where it is
    const tu = this.trailUniforms;
    tu.uTime.value = t;
    if (t < this.lastTime - 1e-4) this.tBirth.array.fill(-1e6), (this.tBirth.needsUpdate = true);
    if (dt > 0 && this.lastTime >= 0 && this.stroke > 0.05) {
      this.emitAcc += dt * 3200 * this.stroke;
      const n = Math.min(96, Math.floor(this.emitAcc));
      this.emitAcc -= n;
      const P = this.tPos.array, V = this.tVel.array, B = this.tBirth.array;
      for (let i = 0; i < n; i++) {
        const tip = this.tips[(this._rnd() * this.tips.length) | 0];
        const side = this._rnd() < 0.5 ? -1 : 1;
        wingPoint(_a, tip[0], tip[1], side, tip[2], pose).applyMatrix4(this.matrix);
        wingPoint(_b, tip[0], tip[1], side, tip[2], this.prevPose).applyMatrix4(this.prevMatrix);
        // it keeps a fifth of the wing's own speed and none of the body's
        _b.subVectors(_a, _b).multiplyScalar(0.2 / dt).clampLength(0, 4);
        const o = this.head * 3;
        P[o] = _a.x;
        P[o + 1] = _a.y;
        P[o + 2] = _a.z;
        V[o] = _b.x + (this._rnd() - 0.5) * 0.3;
        V[o + 1] = _b.y + (this._rnd() - 0.5) * 0.3 - 0.15;
        V[o + 2] = _b.z + (this._rnd() - 0.5) * 0.3;
        B[this.head * 2] = t - this._rnd() * dt;
        B[this.head * 2 + 1] = this._rnd();
        this.head = (this.head + 1) % TRAIL_N;
      }
      if (n > 0) this.tPos.needsUpdate = this.tVel.needsUpdate = this.tBirth.needsUpdate = true;
    }
    this.lastTime = t;
  }
}

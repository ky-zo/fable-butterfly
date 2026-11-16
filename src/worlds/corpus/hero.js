// The one that is making the crossing: where its body is and how it is held, every frame.
//
// Progress says where along its line it is, how high it flies and how much of the swell it follows (shots.js). Time
// gives it life on top of that: the wingbeat, bursts and glides, a wandering course, the body nodding against each
// stroke, the rise and fall of the water under it. None of this ever reaches the camera.
//
// It also owns what it does to the water: the drops its wingtips knock off a crest, and the place under it where the
// words that were left for it come up warm (uWake, read by the letters).

import * as THREE from 'three';
import { clamp, smoothstep } from '../../core/util.js';
import { wingbeat, wingPoint, setShadow, wingVertexGLSL, FLEX } from '../../shared/butterfly/index.js';
import { seaHeight, seaInvert } from './waves.js';
import { makeSheenMaterial, makeFilterMaterial } from './sheen.js';
import { SIZE, key, pathAt, K_ALT, K_RIDE, K_WANDER, K_PITCH, K_STEEP, K_BEAT, K_YAW, K_SLICK } from './shots.js';

const UP = new THREE.Vector3(0, 1, 0);
const GLIDE = 0.6;
/** the moon in its wings (sheen.js), mid-crossing: the film's flash, its steady glow, the ember, the pearl of the bar */
const SHEEN = [1.3, 0.16, 0.6, 1.0];
/** …and the silver line round the margin */
const RIM = 0.7;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _d = new THREE.Vector3();
const _base = { x: 0, z: 0 };

/** A limit with no wall in it: x is passed through unchanged up to a, then eased toward b, which it never reaches. */
const ease = (x, a, b) => {
  const m = Math.abs(x);
  return m <= a ? x : Math.sign(x) * (a + (b - a) * Math.tanh((m - a) / (b - a)));
};

/** A slow wandering in three axes: metres off the line of flight at time t (for an animal of life size). */
function wander(t, out) {
  return out.set(
    (Math.sin(t * 0.83) + 0.5 * Math.sin(t * 1.97 + 1.3) + 0.22 * Math.sin(t * 4.3 + 0.7)) * 0.042,
    (Math.sin(t * 0.71 + 2.1) + 0.5 * Math.sin(t * 1.63 + 0.4) + 0.2 * Math.sin(t * 5.1)) * 0.02,
    (Math.cos(t * 0.67 + 0.9) + 0.5 * Math.sin(t * 2.23 + 2.0) + 0.22 * Math.sin(t * 3.7 + 1.1)) * 0.03,
  );
}

/**
 * The light a moonlit sea gives an insect, as a rig for the kit's materials (contract: shared/butterfly/light.js).
 * The moon is the key — low, and nearly always behind the animal as the lens sees it. Besides the sky above and the
 * water below there is the moon's own wide glow: whatever faces it is lit by that as well as by the disc, which is
 * what comes through the scales of a wing seen from behind. One warm lamp, far off, for the last of the crossing.
 * Handles: sunDir, sunColor, sky, ground, glow (Vector3), lamp (Vector4 xyz + reach), lampColor (Vector3).
 */
export function makeMoonRig({ mirror = false } = {}) {
  const h = {
    sunDir: new THREE.Vector3(0, 0.05, -1).normalize(),
    sunColor: new THREE.Vector3(1, 1, 1),
    sky: new THREE.Vector3(0.05, 0.07, 0.12),
    ground: new THREE.Vector3(0.02, 0.03, 0.05),
    glow: new THREE.Vector3(1, 1, 1),
    lamp: new THREE.Vector4(0, -1e3, 0, 200),
    lampColor: new THREE.Vector3(0, 0, 0),
  };
  if (mirror) h.mirror = new THREE.Vector4(0, 0, 0, 0);
  const uniforms = {
    ...(mirror ? { uBfMirror: { value: h.mirror } } : {}),
    uBfSunDir: { value: h.sunDir },
    uBfSunCol: { value: h.sunColor },
    uBfSky: { value: h.sky },
    uBfGround: { value: h.ground },
    uBfGlow: { value: h.glow },
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
uniform vec3 uBfSky, uBfGround, uBfGlow, uBfLampCol;
uniform vec4 uBfLamp;
vec3 bfLampAt(vec3 P, vec3 N, float lobe){
  vec3 d = uBfLamp.xyz - P;
  float r2 = dot(d, d);
  float fall = 1.0 / (1.0 + r2 / (uBfLamp.w * uBfLamp.w * 0.04));
  return uBfLampCol * fall * mix(0.35 + 0.65 * max(dot(N, d) * inversesqrt(r2 + 1e-9), 0.0), pow(max(dot(N, d) * inversesqrt(r2 + 1e-9), 0.0), 60.0) * 6.0, lobe);
}
vec3 bfAmb(vec3 P, vec3 N){
  vec3 a = mix(uBfGround, uBfSky, 0.5 + 0.5 * N.y);
  float w = 0.5 + 0.5 * dot(N, BF_SUN_DIR);
  a += uBfGlow * w * w * w;                         // the moon's glow: a broad light from where the moon is
  return a + bfLampAt(P, N, 0.0);
}
vec3 bfEnv(vec3 P, vec3 R, float soft){
  vec3 e = mix(uBfGround * 0.8, uBfSky * 1.5, smoothstep(-0.25 - soft, 0.5 + soft, R.y));
  float m = max(dot(R, BF_SUN_DIR), 0.0);
  // the disc itself and the haze around it — and, below the horizon, the same again: the road of light on the water.
  // A wing that turns its face that way throws it at the lens for a moment: that is the sheen in it at night.
  float mr = max(dot(vec3(R.x, abs(R.y), R.z), BF_SUN_DIR), 0.0);
  // (kept low: the kit's black velvet has a blue-violet sheen in whatever it mirrors, and with the whole of the road
  // in it the border of the wing was royal blue, not black. The moon in the membrane is sheen.js's.)
  e += BF_SUN_COL * 0.06 * pow(m, mix(900.0, 12.0, soft)) + uBfGlow * (1.1 * pow(mr, 9.0) + 0.2 * pow(mr, 2.5));
  return e + bfLampAt(P, R, 1.0);
}
vec3 bfEyeKey(){ return uBfSky * 1.4 + BF_SUN_COL * 0.02; }
${
  mirror
    ? /* glsl */ `
// This rig is for its image in flat water: the same animal upside down under the surface. Water at this angle gives
// back about half of what stands over it, a shade bluer; and what ripple is left on a slick runs across the image in
// thin bands that travel.
uniform vec4 uBfMirror;   // height of the water under it (m), how much of an image the water gives (0: none), time, -
vec4 bfFinish(vec3 col, float a, vec3 P){
  float under = uBfMirror.x - P.y;                      // how far under the surface this point of the image is
  float band = 0.5 + 0.5 * sin(under * 330.0 - uBfMirror.z * 2.6 + 2.2 * sin(P.x * 23.0 + P.z * 17.0 + uBfMirror.z * 0.7));
  float k = uBfMirror.y * (0.74 + 0.26 * band) * smoothstep(-0.004, 0.012, under);
  return vec4(col * vec3(0.84, 0.92, 1.0) * k, a * k);
}`
    : /* glsl */ `vec4 bfFinish(vec3 col, float a, vec3 P){ return vec4(col, a); }`
}
`;
  return { ...h, uniforms, common, vertex, fragment };
}

// Far off and against the moon's road a clear wing is nothing: bright water seen through it, and veins a pixel wide.
// What a lens does see of an insect there is its shape, dark, because at that size the wing's whole film — veins,
// scales, the haze of the membrane itself — averages to a shadow. This pass is that: the four wings again, taking
// light away from whatever is behind them. It is only there at the two ends of the crossing, where the animal is small.
const SHADE_VERT = /* glsl */ `
${wingVertexGLSL}
varying vec3 vEdge;
void main(){
  vec3 b, tx, ty;
  bfWingFrame(b, tx, ty);
  vEdge = aEdge;
  gl_Position = projectionMatrix * viewMatrix * (bfModel() * vec4(b, 1.0));
}`;
const SHADE_FRAG = /* glsl */ `
precision highp float;
varying vec3 vEdge;
uniform float uDark;
void main(){
  if (vEdge.x < 0.0) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, uDark * smoothstep(0.0, 0.2, vEdge.x));
}`;

const NDROP = 72;
const DROP_VERT = /* glsl */ `
precision highp float;
attribute vec4 aD;     // world position, radius (m; 0 = not in the air)
attribute vec3 aV;     // velocity (the drop is drawn stretched along it)
uniform float uPpm;
varying vec2 vQ;
varying vec2 vS;
void main(){
  vQ = position.xy * 2.0;
  vec4 vp = viewMatrix * vec4(aD.xyz, 1.0);
  vec3 vv = mat3(viewMatrix) * aV;
  float sp = length(vv.xy);
  vec2 ax = sp > 1e-4 ? vv.xy / sp : vec2(0.0, 1.0);
  float st = 1.0 + min(sp * 0.035 / max(aD.w, 1e-4), 1.6);        // a falling drop is drawn out a little
  float r = aD.w;
  float px = r * uPpm / max(-vp.z, 0.02);
  float grow = max(1.0, 0.9 / max(px, 1e-3));
  vS = vec2(st, 1.0 / (grow * grow));
  vp.xy += (ax * vQ.y * st + vec2(-ax.y, ax.x) * vQ.x) * r * grow;
  gl_Position = aD.w > 0.0 ? projectionMatrix * vp : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const DROP_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uMoonCol;
varying vec2 vQ;
varying vec2 vS;
void main(){
  float r2 = dot(vQ, vQ);
  if (r2 > 1.0) discard;
  // a bead of water with the moon behind it. It is a lens: the whole of it is filled with the moon's light, brightest
  // through the middle, and its edge is a thin dark line with a crescent on the side the light comes in
  float rim = smoothstep(0.6, 1.0, r2) * smoothstep(-0.9, 0.7, vQ.y);
  float core = exp(-r2 * 2.6);
  vec3 c = uMoonCol * (0.05 + 0.5 * rim + 7.0 * core) * (1.0 - 0.7 * smoothstep(0.78, 1.0, r2) * (1.0 - rim)) * vS.y;
  gl_FragColor = vec4(c, 1.0);
}`;

export class Hero {
  /**
   * @param kit   the butterfly kit
   * @param U     the world's uniform bag (the shadow uniforms and uWake live in it)
   * @param light the rig (makeMoonRig)
   * @param opts  { detail, scene, fur }
   */
  constructor(ctx, kit, U, light, { detail = 'high', scene = true, fur = null } = {}) {
    this.U = U;
    this.light = light;
    this.gw = kit.glasswing({ light, detail, scene, fur, uniforms: scene ? { uBfRes: U.uRes, tBfScene: U.tScene, uBfLens: U.uLens } : { uBfRes: U.uRes } });
    this.scene = new THREE.Scene();
    this.scene.add(this.gw.group);
    // the moon in its wings (sheen.js): the same four wings again, light only
    const gu = this.gw.uniforms;
    // (the film's flash, its glow, the ember, the pearl; and the silver line round the margin, its least width in
    // pixels, the far-off line, single scales)
    this.sheen = new THREE.Vector4(SHEEN[0], SHEEN[1], SHEEN[2], SHEEN[3]);
    this.rim = new THREE.Vector4(RIM, 1.3, 0, 1);
    const sheenMat = makeSheenMaterial(ctx, U, kit, this.sheen, { uPose: gu.uPose, uShape: gu.uShape, uLook: gu.uLook }, this.rim);
    this.dark = { value: 0 };
    const shadeMat = ctx.track(
      new THREE.ShaderMaterial({ vertexShader: SHADE_VERT, fragmentShader: SHADE_FRAG, uniforms: { uDark: this.dark, uPose: gu.uPose, uShape: gu.uShape, uLook: gu.uLook }, side: THREE.DoubleSide, transparent: true, depthTest: true, depthWrite: false }),
    );
    this.shades = [];
    // …and the film as a filter on what is seen through it (sheen.js): after the kit's own out-of-focus picture of what
    // is behind each wing (order + 1), before the wings themselves (order + 10 …)
    this.filter = { value: 0.42 };
    const filterMat = scene ? makeFilterMaterial(ctx, kit, this.filter, { uPose: gu.uPose, uShape: gu.uShape, uLook: gu.uLook }) : null;
    for (const g of this.gw.geos) {
      if (filterMat) {
        const f = new THREE.Mesh(g, filterMat);
        f.frustumCulled = false;
        f.renderOrder = 8;
        this.gw.group.add(f);
      }
      const m = new THREE.Mesh(g, sheenMat);
      m.frustumCulled = false;
      m.renderOrder = 40;
      this.gw.group.add(m);
      const d = new THREE.Mesh(g, shadeMat);
      d.frustumCulled = false;
      d.renderOrder = -2;
      this.gw.group.add(d);
      this.shades.push(d);
    }
    // its image in the water, for the stretch where the water goes flat: a second animal sharing this one's pose, placed
    // upside down under the surface (the kit's own way of making a reflection) and drawn only where the water is in
    // front of it. Lit by a rig of its own, in which up is down.
    this.twinLight = makeMoonRig({ mirror: true });
    this.twin = kit.glasswing({ light: this.twinLight, detail: detail === 'high' ? 'mid' : 'low', pose: this.gw.pose, uniforms: { uBfRes: U.uRes }, order: -30 });
    for (const m of this.twin.mats) {
      m.depthFunc = THREE.GreaterDepth;
      m.depthWrite = false;
      m.transparent = true;
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation;
      m.blendSrc = THREE.OneFactor;
      m.blendDst = THREE.OneMinusSrcAlphaFactor;
    }
    this.scene.add(this.twin.group);
    this.position = new THREE.Vector3();
    this.base = new THREE.Vector3();
    this.heading = new THREE.Vector3(0, 0, -1);
    this.R = new THREE.Vector3(1, 0, 0);
    this.F = new THREE.Vector3(0, 0, -1);
    this.Uv = new THREE.Vector3(0, 1, 0);
    this.beat = { fore: 1, hind: 1, flex: 0, twist: 0, lift: 0, pitch: 0, beating: 0, index: -1, phase: 0 };
    this.surface = 0;
    this.reduced = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    /** called with (x, z, strength) when a wingtip meets the water */
    this.onTouch = null;
    this.lastTouch = -9;
    /** how many times a wingtip has met the water (for whoever wants to hear it) */
    this.touches = 0;
    this.lastT = -1;

    // ---- drops
    this.dropD = new Float32Array(NDROP * 4);
    this.dropV = new Float32Array(NDROP * 3);
    this.dropLife = new Float32Array(NDROP);
    this.dropFloor = new Float32Array(NDROP);
    this.dropI = 0;
    this.rnd = ctx.rng(91);
    const geo = ctx.track(new THREE.InstancedBufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.dAttr = new THREE.InstancedBufferAttribute(this.dropD, 4).setUsage(THREE.DynamicDrawUsage);
    this.vAttr = new THREE.InstancedBufferAttribute(this.dropV, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aD', this.dAttr);
    geo.setAttribute('aV', this.vAttr);
    geo.instanceCount = NDROP;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const mat = ctx.track(new THREE.ShaderMaterial({ vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, uniforms: { uPpm: U.uPpm, uMoonCol: U.uMoonCol }, depthTest: true, depthWrite: true, side: THREE.DoubleSide }));
    // (DoubleSide: the quad is laid out along the drop's velocity with its two axes in mirror order, which turned every
    // one of them away from the lens. Until this was set no drop had ever been drawn.)
    this.drops = new THREE.Mesh(geo, mat);
    this.drops.frustumCulled = false;
    this.drops.renderOrder = -5;
    this.scene.add(this.drops);
  }

  _spawn(x, y, z, vx, vz, strength) {
    const n = 6 + Math.floor(this.rnd() * 7 * strength);
    for (let k = 0; k < n; k++) {
      const i = this.dropI;
      this.dropI = (i + 1) % NDROP;
      const a = this.rnd() * Math.PI * 2;
      const s = 0.12 + this.rnd() * 0.3;
      this.dropD[i * 4] = x + Math.cos(a) * 0.006 * SIZE;
      this.dropD[i * 4 + 1] = y + 0.002;
      this.dropD[i * 4 + 2] = z + Math.sin(a) * 0.006 * SIZE;
      this.dropD[i * 4 + 3] = (0.0002 + 0.00045 * this.rnd() * this.rnd()) * SIZE;
      this.dropV[i * 3] = vx * 0.5 + Math.cos(a) * s;
      this.dropV[i * 3 + 1] = 0.35 + this.rnd() * 0.75 * (0.5 + 0.5 * strength);
      this.dropV[i * 3 + 2] = vz * 0.5 + Math.sin(a) * s;
      this.dropLife[i] = 0;
      this.dropFloor[i] = y - 0.004;
    }
  }

  _drops(dt) {
    const D = this.dropD;
    const V = this.dropV;
    // (the sea runs in slight slow motion, and so does what falls back into it)
    const g = 9.81 * 0.42;
    for (let i = 0; i < NDROP; i++) {
      if (D[i * 4 + 3] <= 0) continue;
      this.dropLife[i] += dt;
      V[i * 3 + 1] -= g * dt;
      const drag = Math.exp(-1.6 * dt);
      V[i * 3] *= drag;
      V[i * 3 + 2] *= drag;
      D[i * 4] += V[i * 3] * dt;
      D[i * 4 + 1] += V[i * 3 + 1] * dt;
      D[i * 4 + 2] += V[i * 3 + 2] * dt;
      if ((D[i * 4 + 1] < this.dropFloor[i] && V[i * 3 + 1] < 0) || this.dropLife[i] > 1.6) D[i * 4 + 3] = 0;
    }
    this.dAttr.needsUpdate = true;
    this.vAttr.needsUpdate = true;
  }

  /**
   * @param frame  the core's frame
   * @param camera the camera this frame is drawn with (already placed)
   * @param lens   is the lens open (is anything out of focus)?
   * @param sky    { moon: Vector3 (unit), moonCol: Vector3, veil, lamp: Vector4 }
   */
  update(frame, camera, lens, sky) {
    const { progress: p, time: t, dt } = frame;
    const calm = this.reduced ? 0.3 : 1;
    const steep = key(K_STEEP, p);
    // far off at the two ends of the crossing it is a few pixels of wing: let the moon catch it harder there, so the
    // opening and closing frames still hold a butterfly
    // (handed in, it is against the road of light itself: there it is a dark shape with the moon round its edge, and
    // the film is not made to glow, or it would be bright on bright. Handed on, it is against a dark sky and a dark
    // hill: there the film and the veins carry it, as before, and the line round the edge helps)
    const far0 = 1 - clamp((p - 0.015) / 0.075, 0, 1);
    const far1 = clamp((p - 0.955) / 0.04, 0, 1) * 0.7;
    this.sheen.set(SHEEN[0] + 0.8 * far0 + 3.2 * far1, SHEEN[1] + 0.3 * far1, SHEEN[2] + 0.35 * far0 + 0.9 * far1, SHEEN[3] + 0.9 * far0 + 2.6 * far1);
    this.rim.x = RIM * (1 - far0);
    this.rim.z = 2.6 * far0 + 1.6 * far1;
    this.dark.value = 0.86 * far0;
    for (const d of this.shades) d.visible = far0 > 0.004;
    const wb = wingbeat(t, this.beat);
    if (t < this.lastT - 1e-4 || t - this.lastT > 1) for (let i = 0; i < NDROP; i++) this.dropD[i * 4 + 3] = 0;
    this.lastT = t;

    // ---- where: on its line, carried by the swell, never in the water
    pathAt(p, this.base);
    const pos = this.position.copy(this.base);
    const loose = key(K_WANDER, p) * calm;
    wander(t, _a).multiplyScalar(SIZE * loose);
    pos.add(_a);
    const ride = key(K_RIDE, p);
    const long = seaHeight(pos.x, pos.z, t, steep, 3);
    const surf = (this.surface = seaHeight(pos.x, pos.z, t, steep));
    pos.y += long * ride + (wb.lift - 0.008) * SIZE * calm * (0.3 + 0.7 * loose);
    // (whatever the keys say, it clears the water under it by two fingers: a soft floor, so that it lifts over a crest)
    const floor = surf + 0.012 * SIZE;
    const d = pos.y - floor;
    pos.y = floor + 0.5 * (d + Math.sqrt(d * d + 0.0002));

    // …and never out of the picture: it is eased back toward the middle of the frame (the camera does not chase it)
    _a.copy(pos).project(camera);
    const nx = ease(_a.x, 0.42, 0.7);
    const ny = ease(_a.y, 0.5, 0.74);
    if (nx !== _a.x || ny !== _a.y) {
      _a.x = nx;
      _a.y = ny;
      _a.unproject(camera);
      pos.x = _a.x;
      pos.z = _a.z;
      pos.y = Math.max(_a.y, floor);
    }

    // ---- which way: along its line, leaning into its own wandering; at the very end it turns for the light
    wander(t + 0.12, _b).sub(wander(t - 0.12, _c)).multiplyScalar(2.6 * calm * loose);
    // (and where the wind takes it from the side, its body is turned into the wind while its line holds: shots.js)
    const yaw = key(K_YAW, p);
    _a.set(-Math.sin(yaw), 0, -Math.cos(yaw)).add(_b);
    _a.y = 0;
    _a.normalize();
    if (dt > 0) this.heading.lerp(_a, 1 - Math.exp(-6 * dt)).normalize();
    else this.heading.copy(_a);
    const climb = (key(K_ALT, Math.min(1, p + 0.01)) - key(K_ALT, Math.max(0, p - 0.01))) * 0.9;
    const pitch = key(K_PITCH, p) + wb.pitch * calm + clamp(climb, -0.2, 0.3);
    _f.copy(this.heading).multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch));
    _r.crossVectors(this.heading, UP).normalize();
    // (it banks into a turn: left wing down as its nose comes round to the left)
    const turning = (key(K_YAW, Math.min(1, p + 0.004)) - key(K_YAW, Math.max(0, p - 0.004))) / 0.008;
    const roll = (0.09 * Math.sin(t * 1.3 + 0.4) + 0.05 * Math.sin(t * 2.9)) * calm * (0.35 + 0.65 * loose) + clamp(_b.x * 0.6, -0.3, 0.3) - clamp(turning * 0.005, -0.28, 0.28);
    _u.crossVectors(_r, _f);
    _r.applyAxisAngle(_f, roll);
    _u.applyAxisAngle(_f, roll);
    this.R.copy(_r);
    this.F.copy(_f);
    this.Uv.copy(_u);
    const gw = this.gw;
    gw.place(pos, _r, _f, _u, SIZE);

    // ---- wings and limbs: beating (they bend and cup: FLEX), the abdomen countering the stroke
    const fold = (this.reduced ? 0.45 : 1) * key(K_BEAT, p);
    // (the lens is nearly always behind it, where wings clapped shut over the back are a single line: the top of the
    // stroke is held a little open, a V and never a blade)
    const open = (a) => (a > 0.95 ? 0.95 + (a - 0.95) * 0.42 : a);
    gw.pose.wings.set(open(wb.fore * fold + GLIDE * (1 - fold)), open(wb.hind * fold + (GLIDE - 0.06) * (1 - fold)), wb.twist * fold, wb.flex * fold * FLEX);
    // (legs folded tight under the thorax, the abdomen all but in line with it, antennae a narrow V straight ahead)
    gw.pose.limbs.set(1, 0.12 - 0.4 * wb.pitch, 0.22, 0);
    gw.pose.twitch.set(0.03 * Math.sin(t * 1.1), 0.03 * Math.sin(t * 1.1 + 2), 0, 0);

    // ---- the tips of the forewings at the bottom of the stroke: where one meets the water it knocks a few drops off
    if (dt > 0) {
      for (const side of [1, -1]) {
        wingPoint(_a, 27.5, -1.5, side, 0, gw.pose).applyMatrix4(gw.group.matrix);
        const h = seaHeight(_a.x, _a.z, t, steep);
        // (not every stroke: about one in two that comes low enough)
        const lucky = Math.sin(wb.index * 91.7 + side * 3.1) > -0.1;
        if (_a.y < h + 0.014 * SIZE && wb.fore < 0.0 && lucky && t - this.lastTouch > 0.17) {
          this.lastTouch = t;
          this.touches++;
          const strength = clamp((h + 0.014 * SIZE - _a.y) / (0.012 * SIZE), 0.25, 1);
          this._spawn(_a.x, h, _a.z, 0, 0.5, strength);
          if (this.onTouch) this.onTouch(_a.x, _a.z, strength);
        }
      }
      this._drops(dt);
    }

    // ---- its light: the moon, its glow, and what the sky and the lit water give back
    const L = this.light;
    L.sunDir.copy(sky.moon);
    // (a seventh of what it was: the kit's black velvet has a blue sheen in the key's highlight, and at 3.4 the border
    // of the wing was royal blue against a sea this dark, not black. What the moon does to the ember, the bar and
    // the film is added by sheen.js; the body's rim comes from the glow)
    L.sunColor.copy(sky.moonCol).multiplyScalar(0.5);
    const m = sky.moonCol.z;
    L.glow.copy(sky.moonCol).multiplyScalar(1.5);
    L.sky.set(0.03 + 0.03 * m, 0.045 + 0.045 * m, 0.075 + 0.07 * m);
    L.ground.set(0.012 + 0.03 * m, 0.018 + 0.04 * m, 0.03 + 0.055 * m);
    L.lamp.set(sky.lamp.x, sky.lamp.y, sky.lamp.z, 260);
    const lamp = sky.lamp.w * smoothstep(0.86, 1, p);
    L.lampColor.set(0.5 * lamp, 0.24 * lamp, 0.07 * lamp);

    // ---- its image, where the water is flat enough to hold one: the same animal, mirrored in the surface under it
    const flat = key(K_SLICK, p);
    const twin = this.twin;
    twin.group.visible = flat > 0.01;
    if (twin.group.visible) {
      const T = this.twinLight;
      T.sunDir.set(L.sunDir.x, -L.sunDir.y, L.sunDir.z);
      T.sunColor.copy(L.sunColor);
      T.glow.copy(L.glow);
      T.sky.copy(L.ground);
      T.ground.copy(L.sky);
      T.lamp.set(L.lamp.x, -L.lamp.y, L.lamp.z, L.lamp.w);
      T.lampColor.copy(L.lampColor);
      T.mirror.set(surf, 0.9 * flat, t, 0);
      _a.set(pos.x, 2 * surf - pos.y, pos.z);
      _b.set(this.R.x, -this.R.y, this.R.z);
      _c.set(this.F.x, -this.F.y, this.F.z);
      _d.set(this.Uv.x, -this.Uv.y, this.Uv.z);
      twin.place(_a, _b, _c, _d, SIZE);
      twin.setSize(frame.size.width, frame.size.height);
      twin.sort(camera, false);
    }
    // ---- what it hides of the sky the water mirrors (the water reads this)
    setShadow(this.U, gw, 1, dt);
    // …and the lines that come up warm for it: the ones the lens sees it against. Where the line of sight through the
    // animal meets the water, the words that were left for it are being read.
    _a.copy(pos).sub(camera.position);
    const down = -_a.y / Math.max(_a.length(), 1e-6);
    let k = 0;
    if (down > 0.03) {
      const s2 = Math.min((pos.y - surf) / (down * _a.length()), 3.5 / Math.max(_a.length(), 1e-6));
      _b.copy(pos).addScaledVector(_a, s2);
      seaInvert(_b.x, _b.z, t, steep, 8, _base);
      k = smoothstep(0.03, 0.12, down) * (1 - smoothstep(0.6, 1.5, pos.y - surf));
    }
    // (over the flat water it is its image that is to be seen, and the words come up fainter)
    this.U.uWake.value.set(_base.x, _base.z, clamp(0.1 / Math.max(down, 0.08), 0.14, 0.3), k * smoothstep(0.03, 0.12, p) * (1 - 0.6 * key(K_SLICK, p)));
    gw.sort(camera, lens);
  }
}

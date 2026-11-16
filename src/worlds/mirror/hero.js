// Mirror — the animal, once there is one. The kit's glasswing with wings dense enough to crumple, lit by this world's
// glasshouse (a rig of its own, in the manner of world 01's), and held, as a function of progress:
//
//   out    it comes out of the split head first, swings up under the shell and holds on (it is smaller and softer
//          than it will be: it fills as it comes)
//   emerge the kit's hatching number: the wings a wet crumpled third of their size, pumped flat from the base
//          outward, then dry
//   flight it lets go of the shell, rights itself, and comes down on its wings to the flange of the mullion, head up:
//          where world 01 finds it
//
// Time only gives it life on top of that (a shiver while it pumps, a breath, an antenna, the feet stepping).

import * as THREE from 'three';
import { smoothstep } from '../../core/util.js';
import { emergePose, fanning, wingbeat, flightBasis, FLEX, Feet, FEET, wingVertexGLSL, poseUniforms, atlasGLSL } from '../../shared/butterfly/index.js';
import { houseGLSL } from './house.glsl.js';
import { key, K_OUT, K_EMERGE, K_WALK, K_DRY, WALK, HANG, HANG_PITCH, HANG_FEET, heroPos, SIZE, MM, perchBasis } from './story.js';

/** The light rig the kit's materials ask for: the walls are the lamps, the key is the sun as the fogged pane hands it on. */
export function houseLight(U) {
  return {
    uniforms: U,
    common: /* glsl */ `
${houseGLSL}
uniform vec4 uBfKeyL;          // rgb: the sun; a: how much of it reaches the animal through the fog
#define BF_SUN_DIR H_SUN
#define BF_SUN_COL uBfKeyL.rgb
`,
    vertex: /* glsl */ `
float bfSunVisV(vec3 P){ return uBfKeyL.a; }
`,
    fragment: /* glsl */ `
vec3 bfAmb(vec3 P, vec3 N){
  vec3 a = hIrr(P, N);
  vec3 toLens = normalize(cameraPosition - P);
  a += (uGlow[3] + uGlow[4]) * 0.125 * (0.5 + 0.5 * dot(N, toLens));
  return a;
}
vec3 bfEnv(vec3 P, vec3 R, float soft){ return hGlowAt(P, R, 0.03 + soft * 0.3); }
vec3 bfEyeKey(){ return (uGlow[3] + uGlow[4]) * 1.6; }
vec4 bfFinish(vec3 col, float a, vec3 P){ return vec4(col, a); }
`,
  };
}

// What a wing is for the first minutes: wet. A film of the fluid it was pumped flat with lies on it, milky where it
// pools and where the wing is not yet filled, and it catches the light unevenly until it has dried clear. Drawn over
// the kit's own wings, on the kit's own meshes and rig.
//
// And as it dries it does what any film of liquid does when it thins to less than a wavelength of light: it takes
// colour. The film goes first from the open glass near the base and last from the veins (its channels), the margin
// (scales hold water) and the tip (the wing hangs: it drains that way), so a front of colour crosses each wing from
// the hinge outward and leaves it clear behind. The colours are the kit's own (wingMaterial.js: bfFilmCol — cyan,
// violet, a thread of pale gold): the last of the fluid is the first sight of the iridescence the wing keeps.
//
// Two draws: one multiplies what is behind by the film's tint (so that it colours the far wing and the room alike and
// never lays a veil over anything dark), one adds what the film scatters and mirrors.
const WET_VERT = /* glsl */ `
${wingVertexGLSL}
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vEdge;
varying vec4 vP;
void main(){
  vec3 b, tx, ty;
  bfWingFrame(b, tx, ty);
  vec4 wp = bfModel() * vec4(b, 1.0);
  vN = normalize(mat3(bfModel()) * cross(tx, ty));
  vWorld = wp.xyz;
  vEdge = aEdge;
  vP = vec4(position.xy, aWing);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const WET_COMMON = /* glsl */ `
precision highp float;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vEdge;
varying vec4 vP;
${houseGLSL}
${atlasGLSL}
uniform sampler2D tVein;
uniform vec4 uWet;             // how wet 0..1, how far the wings are pumped 0..1, time, how far the drying has gone 0..1
// The colour a film of this thickness (nm) lends: from the dry edge inward a thread of gold, then violet, then cyan,
// and paler turns of the two until it is too thick to have any. The kit's three (wingMaterial.js: bfFilmCol), deeper:
// this is water, and there is far more of it than of the wing's own film.
vec4 wetFilmCol(float nm){
  vec3 c = mix(vec3(0.6, 0.43, 1.0), vec3(0.27, 0.84, 1.0), 0.5 - 0.5 * cos(6.2831853 * (nm - 150.0) / 420.0));
  float g = exp(-(nm - 95.0) * (nm - 95.0) / 3600.0);
  c = mix(c, vec3(1.0, 0.76, 0.36), g * 0.85);
  return vec4(c, smoothstep(15.0, 95.0, nm) * exp(-max(nm - 330.0, 0.0) / 420.0));
}
// The film of fluid at this point of the wing: x = its thickness (nm; 0 = dry), y = how much it pools here 0..1,
// z = how much of the wing is filled here 0..1, w = how near a vein or the margin this is 0..1 (where the last of it sits)
vec4 wetFilm(out vec4 n1, out vec4 n2){
  vec2 q = vP.xy + vP.zw * 7.3;
  n1 = texture2D(tHN, q * 0.043 + uWet.z * 0.002);
  n2 = texture2D(tHN, q * 0.19 + 0.31);
  float span = vP.w > 0.5 ? 20.0 : 29.5;
  float along = vP.x / span;
  vec2 vf = texture2D(tVein, bfAtlasUV(vP.xy, vP.w)).rg;
  // (it is pumped from the base outward: what is not yet filled is soft, and clouded)
  float filled = smoothstep(-0.2, 0.25, uWet.y * 1.35 - along);
  // the film pools: in patches, along the veins, and against the margin
  float margin = smoothstep(1.6, 0.0, vEdge.x);
  float pool = smoothstep(0.38, 0.7, n1.r * 0.7 + n2.g * 0.3) + 0.5 * margin;
  // when each place dries: outward from the hinge, the open glass before the veins, the border last. Slow changes
  // only: the colours are sweeps across a wing, not a mottle
  vec4 n0 = texture2D(tHN, q * 0.011 + 0.17);
  float inBorder = 1.0 - smoothstep(0.0, 1.0, vEdge.x / max(vEdge.y, 0.2));
  float late = 0.6 * along + 0.2 * vf.g * vf.g + 0.34 * (n0.g - 0.5) + 0.07 * (n1.g - 0.5) + 0.1 * margin + 0.1 * inBorder;
  float gone = clamp((uWet.w * 1.95 - 0.16 - late) * 1.45, 0.0, 1.0);
  float nm = uWet.w > 0.001 ? 1500.0 * (1.0 - gone) * (1.0 - gone) : 4000.0;
  return vec4(nm, pool, filled, max(vf.g, margin));
}
`;
// what is behind, through the film: multiplied
const WET_TINT = /* glsl */ `
${WET_COMMON}
void main(){
  if (vEdge.x < 0.0 || uWet.w <= 0.001) discard;
  vec4 n1, n2;
  vec4 f = wetFilm(n1, n2);
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float NdV = abs(dot(N, V));
  // (the path through the film is longer where the wing is turned away: the bands slide as it moves)
  vec4 c = wetFilmCol(f.x / sqrt(1.0 - (1.0 - NdV * NdV) / 1.77));
  float k = c.a * (0.62 + 0.2 * (1.0 - NdV)) * smoothstep(0.0, 0.4, vEdge.x);
  if (k < 0.004) discard;
  // (a little over white in the colour it favours: a film gives as well as takes)
  gl_FragColor = vec4(mix(vec3(1.0), c.rgb * 1.14, k), 1.0);
}`;
// what the film itself gives: milk where it is thick, the room in pieces, colour where it mirrors, and the sun in
// the beads it leaves along the veins
const WET_FRAG = /* glsl */ `
${WET_COMMON}
void main(){
  if (vEdge.x < 0.0 || uWet.x <= 0.001) discard;
  vec4 n1, n2;
  vec4 f = wetFilm(n1, n2);
  float here = smoothstep(0.0, 260.0, f.x);                           // how much film is left here
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float pool = f.y, filled = f.z;
  float wet = uWet.x * (0.6 + 0.4 * (1.0 - filled));
  float milk = clamp(wet * (0.04 + 0.2 * pool + 0.2 * (1.0 - filled)), 0.0, 0.5) * smoothstep(300.0, 1300.0, f.x) * (1.0 - 0.8 * filled * (1.0 - smoothstep(0.0, 1.0, vEdge.x / max(vEdge.y, 0.2))));
  // …and where it lies, the surface is its own: it gives back the room in pieces
  vec3 Np = normalize(N + (vec3(n2.r, n2.a, n1.g) - 0.5) * 0.7 * wet * here);
  float NdV = abs(dot(Np, V));
  vec3 R = reflect(-V, Np);
  float F = 0.03 + 0.97 * pow(1.0 - NdV, 4.0);
  vec3 env = hGlowAt(vWorld + N * 0.002, R, 0.05) * F * 1.2 + uSun.rgb * 4.0 * pow(max(dot(R, H_SUN), 0.0), 60.0);
  // (thin, what it mirrors is coloured)
  vec4 c = wetFilmCol(f.x / sqrt(1.0 - (1.0 - NdV * NdV) / 1.77));
  vec3 spec = env * mix(vec3(1.0), c.rgb * 2.2, c.a) * max(wet, 0.6 * c.a) * (0.3 + 0.7 * pool) * here;
  // Beads. What does not run off stays as drops strung along the veins and the margin, each a lens: toward the sun
  // every one of them holds it. They are the last of the water to go.
  float px = max(length(dFdx(vP.xy)), length(dFdy(vP.xy)));
  vec2 g = (vP.xy + vP.zw * 3.1) / 0.9;
  vec2 gi = floor(g);
  vec3 hb = hash32(gi + 7.0);
  float rad = 0.045 + 0.09 * hb.z * hb.z * 11.0;
  float bd = length((g - gi - 0.25 - 0.5 * hb.xy) * 0.9);
  float bead = smoothstep(rad + px, rad - px, bd) * step(hb.z, 0.3) * smoothstep(0.55, 0.85, f.w) * (rad / (rad + px));
  // (each has its own facet: they light one after another as the wing swings — most of them, most of the time, are
  //  only a small clear lens with a dark edge)
  vec3 toSun = normalize(H_SUN + (vec3(hb.xy, fract(hb.z * 7.3)) - 0.5) * 0.7);
  float lens = pow(max(dot(-V, toSun), 0.0), 14.0);
  float beadsLeft = uWet.x * filled * (1.0 - smoothstep(0.8, 0.97, uWet.w + 0.14 * (hb.x - 0.5)));
  float edge = smoothstep(0.35, 1.0, bd / rad);
  vec3 glint = (uSun.rgb * 11.0 * lens * (1.0 - edge) + hIrr(vWorld, -N) * 0.42 * (1.0 - edge)) * bead * beadsLeft;
  vec3 scatter = (hIrr(vWorld, -N) * 0.8 + hIrr(vWorld, N) * 0.3) * vec3(0.98, 0.9, 0.76);
  gl_FragColor = vec4(scatter * milk + spec + glint, max(milk, (0.25 + 0.5 * edge) * bead * beadsLeft));
}`;

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const quat = (F, U) => {
  const f = F.clone().normalize();
  const u = U.clone().addScaledVector(f, -U.dot(f)).normalize();
  const r = new THREE.Vector3().crossVectors(f, u);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, f, u));
};

// ---- coming out: head down inside the shell, belly to the split → swung up under it, back down and out
const A35 = HANG_PITCH;
const Q_IN = quat(V3(0, -1, 0), V3(0, 0, 1));
const Q_MID = quat(V3(0, -0.8, -0.6), V3(0, -0.6, 0.8));
const Q_HANG = quat(V3(0, Math.sin(A35), -Math.cos(A35)), V3(0, -Math.cos(A35), -Math.sin(A35)));
// ---- the flight
const _r = new THREE.Vector3();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
perchBasis(0, 0, _r, _f, _u);
const Q_REST = quat(_f, _u);
// In the air it faces the glass, half turned from the lens and well up on its tail (a butterfly coming down slowly
// hangs nearly upright under its wings): the lens, behind it and to one side, sees its back and both wings whole. Its
// body is never along the line of sight: from dead astern or head on, wings are four lines.
const flying = (yaw, pitch) => {
  flightBasis(V3(-Math.sin(yaw), 0, -Math.cos(yaw)), pitch, 0, _r, _f, _u);
  return quat(_f, _u);
};
// how it is turned along the flight: [w, attitude]
const TURN = [
  [0, Q_HANG],
  [0.16, flying(0.3, 0.8)],
  [0.5, flying(0.55, 0.95)],
  [0.74, flying(0.75, 1.15)],
  [1, Q_REST],
];

// where each foot holds the empty shell, in the world
const HOLD = FEET.map((f, i) => {
  const r = V3(1, 0, 0).applyQuaternion(Q_HANG);
  const fw = V3(0, 1, 0).applyQuaternion(Q_HANG);
  const up = V3(0, 0, 1).applyQuaternion(Q_HANG);
  const o = HANG_FEET[i];
  return HANG.clone().addScaledVector(r, (f[0] + o[0]) * MM).addScaledVector(fw, (f[1] + o[1]) * MM).addScaledVector(up, (f[2] + o[2]) * MM);
});

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _fan = { fore: 0, hind: 0 };
const X = V3(1, 0, 0);
const hash1 = (n) => {
  const s = Math.sin(n * 91.7 + 13.1) * 43758.5453;
  return s - Math.floor(s);
};
const ss = (x) => x * x * (3 - 2 * x);

/**
 * How world 01 holds it on this perch at time t of its own clock (conservatory/hero.js, at rest on perch 0): the
 * fanning of the wings, the breath, the two antennae, the slow turn on its feet. Written here once so that the two
 * worlds cannot disagree; `out` = { fore, hind, breath, tw0, tw1, yaw }.
 */
function rest01(t, calm, out) {
  fanning(t, 0.1, _fan);
  out.fore = _fan.fore;
  out.hind = _fan.hind;
  out.breath = 0.6 + 0.4 * Math.sin(t * 1.9);
  out.yaw = 0.04 * Math.sin(t * 0.23) * calm;
  for (let s = 0; s < 2; s++) {
    const n = t / 2.3 + s * 0.41;
    const ph = n - Math.floor(n);
    const v = Math.exp(-Math.pow((ph - 0.3) / 0.04, 2)) * (hash1(Math.floor(n) + s * 7) - 0.3) * 0.5 * calm + 0.03 * Math.sin(t * 1.1 + s * 2) + (s === 0 ? 0.13 : -0.1);
    if (s === 0) out.tw0 = v;
    else out.tw1 = v;
  }
  return out;
}
const _ra = { fore: 0, hind: 0, breath: 0, tw0: 0, tw1: 0, yaw: 0 };
const _rb = { fore: 0, hind: 0, breath: 0, tw0: 0, tw1: 0, yaw: 0 };

export class Hero {
  constructor(ctx, kit, U) {
    this.U = U;
    const light = houseLight(U);
    const dense = kit.buildWings({ spokes: 96, rings: 14 });
    this.gw = kit.glasswing({ light, scene: true, wings: dense, uniforms: { uBfRes: U.uBfRes, tBfScene: U.tBfScene, uBfLens: U.uBfLens } });
    this.scene = new THREE.Scene();
    this.scene.add(this.gw.group);
    // the wet on the wings: what the film takes from what is behind it, then what it gives
    this.wetU = { ...U, ...poseUniforms(this.gw.pose), uWet: { value: new THREE.Vector4(0, 0, 0, 0) }, tVein: { value: kit.atlas.veins } };
    const wetOpts = { uniforms: this.wetU, vertexShader: WET_VERT, side: THREE.DoubleSide, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation };
    const tintMat = ctx.track(new THREE.ShaderMaterial({ ...wetOpts, fragmentShader: WET_TINT, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor }));
    const wetMat = ctx.track(new THREE.ShaderMaterial({ ...wetOpts, fragmentShader: WET_FRAG, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    this.wet = new THREE.Group();
    this.wet.matrixAutoUpdate = false;
    this.tint = [];
    for (const hind of [0, 1]) {
      for (const geo of [dense[hind].geometry, kit.mirror(dense[hind], hind)]) {
        const t = new THREE.Mesh(geo, tintMat);
        t.renderOrder = 39;
        this.tint.push(t);
        const m = new THREE.Mesh(geo, wetMat);
        m.renderOrder = 40;
        this.wet.add(t, m);
      }
    }
    for (const m of this.wet.children) m.frustumCulled = false;
    this.scene.add(this.wet);
    this.position = HANG.clone();
    this.R = new THREE.Vector3();
    this.F = new THREE.Vector3();
    this.Up = new THREE.Vector3();
    this.feet = new Feet();
    this.visible = false;
    this.steps = 0; // wingbeats of its first flight (for the sound)
    this.beat = { fore: 1, hind: 1, flex: 0, twist: 0, lift: 0, pitch: 0, beating: 0, index: -1, phase: 0 };
    this._beat = -1;
    this.tRest = 0; // seconds since it settled on the mullion
    this.tOut = 0; // seconds since the next world began to show through this one
    this._tap = -1;
    this.reduced = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  }

  /** (for warming its programs before it is ever seen) */
  show(on, part = null) {
    const gw = this.gw;
    gw.group.visible = on && part !== 'wet';
    this.wet.visible = on && (!part || part === 'wet');
    for (const m of gw.group.children) m.visible = !part || (gw.wings.includes(m) || (gw.pre && gw.pre.includes(m)) ? part === 'wings' : part === 'body');
    for (const m of this.wet.children) m.visible = true;
  }

  /** Where it is and how it is turned at progress p (no clock). Writes this.position and returns the quaternion. */
  place(p, q) {
    heroPos(p, this.position);
    const out = key(K_OUT, p);
    const w = key(K_WALK, p);
    if (w > 0) {
      let i = 0;
      while (i < TURN.length - 2 && w > TURN[i + 1][0]) i++;
      const f = ss(Math.min(1, Math.max(0, (w - TURN[i][0]) / (TURN[i + 1][0] - TURN[i][0]))));
      return q.copy(TURN[i][1]).slerp(TURN[i + 1][1], f);
    }
    if (out < 0.55) return q.copy(Q_IN).slerp(Q_MID, ss(out / 0.55));
    return q.copy(Q_MID).slerp(Q_HANG, ss((out - 0.55) / 0.45));
  }

  update(frame, camera, lensOpen) {
    const { progress: p, time: t, dt, size } = frame;
    const gw = this.gw;
    const out = key(K_OUT, p);
    this.visible = out > 0.1;
    gw.group.visible = this.visible;
    this.wet.visible = false;
    if (!this.visible) return;
    const calm = this.reduced ? 0.3 : 1;
    const u = key(K_EMERGE, p);
    const w = key(K_WALK, p);
    const rest = smoothstep(0.8, 1, w);

    // ---- settled, it is world 01's animal on world 01's clock. That clock starts when it comes to rest here; and
    //      again, at nought, when world 01 begins to show through this one (its own clock starts then), so that through
    //      the whole dissolve the two are one animal in one pose.
    this.tRest = w >= 1 && dt > 0 ? this.tRest + dt : w >= 1 ? this.tRest : 0;
    const leaving = w >= 1 && frame.presence < 1;
    this.tOut = leaving ? this.tOut + dt : 0;
    const ra = rest01(this.tRest, calm, _ra);
    if (leaving) {
      const rb = rest01(this.tOut, calm, _rb);
      const k = smoothstep(0, 0.3, 1 - frame.presence);
      for (const n in ra) ra[n] += (rb[n] - ra[n]) * k;
    }

    // ---- in the air: the kit's own wingbeat (bursts, and a glide between them), on the clock
    const fly = smoothstep(0.03, 0.13, w) * (1 - smoothstep(0.74, 0.9, w));
    const wb = wingbeat(t, this.beat);
    const fold = this.reduced ? 0.45 : 1;

    // ---- where
    this.place(p, _q);
    // hanging, it turns a little on its grip: the weight of the wings as they fill
    const hang = smoothstep(0.8, 1, out) * (1 - smoothstep(0, 0.12, w));
    if (hang > 0) {
      const sw = (0.035 * Math.sin(t * 0.9) + 0.02 * Math.sin(t * 2.3 + 1)) * hang * calm;
      _q2.setFromAxisAngle(_u.set(1, 0, 0), sw);
      _q.premultiply(_q2);
    }
    if (rest > 0) _q.premultiply(_q2.setFromAxisAngle(X, ra.yaw * rest));
    if (fly > 0) {
      // (it is carried up on each stroke, nods against it, and never holds quite level)
      this.position.y += wb.lift * fly * calm * 0.7;
      _q.multiply(_q2.setFromAxisAngle(X, wb.pitch * fly * calm));
      _q.multiply(_q2.setFromAxisAngle(_u.set(0, 1, 0), (0.09 * Math.sin(t * 1.3 + 0.4) + 0.05 * Math.sin(t * 2.9)) * fly * calm));
    }
    this.R.set(1, 0, 0).applyQuaternion(_q);
    this.F.set(0, 1, 0).applyQuaternion(_q);
    this.Up.set(0, 0, 1).applyQuaternion(_q);
    // (soft and small as it comes out: it fills)
    const grow = SIZE * (0.45 + 0.55 * smoothstep(0.1, 0.95, out));
    gw.place(this.position, this.R, this.F, this.Up, grow);

    // ---- how it is held
    const pose = gw.pose;
    emergePose(pose, u, t * calm);
    // (while it is still inside there is no room for wings at all)
    const tuck = 1 - smoothstep(0.3, 0.9, out);
    pose.wings.x += 0.04 * tuck;
    pose.shape.y = Math.max(pose.shape.y, 0.8 * tuck);
    pose.limbs.x = 0.85 * (1 - smoothstep(0.35, 0.8, out));
    // (hung by its feet with its back down, the abdomen sags the other way from the one the kit calls droop; and it is
    //  still heavy with what has not yet gone into the wings)
    pose.limbs.y += (-0.16 - pose.limbs.y) * hang;
    pose.limbs.w = Math.min(1, pose.limbs.w + 0.5 * (1 - smoothstep(0.5, 1, u)));
    if (fly > 0) {
      // (wings that bend and cup, legs drawn up tight, the abdomen in line, antennae ahead: the kit's flight)
      const g = 0.6;
      const fore = g + (wb.fore - g) * fold;
      const hind = g - 0.1 + (wb.hind - g + 0.1) * fold;
      pose.wings.set(pose.wings.x + (fore - pose.wings.x) * fly, pose.wings.y + (hind - pose.wings.y) * fly, wb.twist * fold * fly, pose.wings.w * (1 - fly) + wb.flex * fold * FLEX * fly);
      pose.limbs.x = Math.max(pose.limbs.x, smoothstep(0.1, 0.65, fly));
      pose.limbs.y += (0.04 - 0.4 * wb.pitch - pose.limbs.y) * fly;
      pose.limbs.z += (0.22 - pose.limbs.z) * fly;
      if (wb.index !== this._beat && wb.index >= 0 && dt > 0) this.steps++;
      this._beat = wb.index;
    }
    if (rest > 0) {
      // settled: as world 01 finds it — wings up over its back, a breath, an antenna
      pose.wings.set(pose.wings.x + (ra.fore - pose.wings.x) * rest, pose.wings.y + (ra.hind - pose.wings.y) * rest, pose.wings.z * (1 - rest), pose.wings.w * (1 - rest));
      pose.limbs.set(pose.limbs.x * (1 - rest), pose.limbs.y + (0.1 - pose.limbs.y) * rest, pose.limbs.z * (1 - rest), pose.limbs.w + (ra.breath - pose.limbs.w) * rest);
      pose.twitch.x += (ra.tw0 - pose.twitch.x) * rest;
      pose.twitch.y += (ra.tw1 - pose.twitch.y) * rest;
    }
    // feet. Hanging, each holds its own place on the empty shell while the body swings under them; walking and
    // settled they are planted, and step after the body
    const hold = smoothstep(0.55, 0.95, out) * (1 - smoothstep(0, 0.05, w));
    if (out >= 1 && w > 0.9) {
      if (w >= 1) {
        const n = Math.floor(t / 1.7);
        if (n !== this._tap && hash1(n * 3.1) < 0.22 * calm) this.feet.tap((n * 3) % 4);
        this._tap = n;
      }
      this.feet.update(pose, gw.group.matrix, dt, w < 1 ? 2.4 : 1);
    } else {
      this.feet.reset();
      for (let i = 0; i < 4; i++) pose.feet[i].set(0, 0, 0);
    }
    if (hold > 0) {
      _m.copy(gw.group.matrix).invert();
      for (let i = 0; i < 4; i++) {
        _p.copy(HOLD[i]).applyMatrix4(_m);
        _p.set(_p.x - FEET[i][0], _p.y - FEET[i][1], _p.z - FEET[i][2]);
        // (a leg is only so long: on the way out it reaches for its hold before it has it)
        const l = _p.length();
        if (l > 4.2) _p.multiplyScalar(4.2 / l);
        pose.feet[i].lerp(_p, hold);
      }
    }
    gw.setSize(size.width, size.height);
    gw.sort(camera, lensOpen);
    // wet from the moment it is out; the film thins and goes, in colour, once the wings are flat
    const wetness = smoothstep(0.3, 0.8, out) * (1 - smoothstep(0.7, 0.99, u));
    const dry = key(K_DRY, p);
    this.wet.visible = wetness > 0.002 || (dry > 0 && dry < 1);
    if (this.wet.visible) {
      this.wet.matrix.copy(gw.group.matrix);
      this.wet.matrixWorldNeedsUpdate = true;
      this.wetU.uWet.value.set(wetness, pose.shape.x, t, dry);
      for (const m of this.tint) m.visible = dry > 0 && dry < 1;
    }
  }
}

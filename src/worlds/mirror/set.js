// Mirror — what is outside the chrysalis: the room (one triangle over everything: house.glsl.js), the steel that is
// close enough to be looked at (the mullion world 01 begins on, the angle bar bolted across it), the pad of silk under
// the bar's lip, the stalk the chrysalis hangs by, and the chrysalis itself (chrysalis.js).

import * as THREE from 'three';
import { Y0, EAVE, HW } from '../conservatory/layout.js';
import { houseGLSL } from './house.glsl.js';
import { buildChrysalis } from './chrysalis.js';
import { BAR_Y, LIP, LEG, PAD, CH_C, CH_H, FLANGE_X, MULLION_Z } from './story.js';

const f = (x) => Number(x).toFixed(4);

const SOLID_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Old gloss paint over steel, as world 01 paints it; rust where the paint has let go; the lip of the bar sweats.
const STEEL_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vN;
${houseGLSL}
uniform float uPadGlow;
uniform float uSweat;           // the cold of the night still on the steel: 1 … 0 by the time the sun is on it
uniform float uDull;            // the bar goes dull: 0 … 1 where the lens stands as world 01's will
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 an = abs(N);
  vec2 tp = an.x > an.y && an.x > an.z ? vWorld.zy : (an.y > an.z ? vWorld.xz : vWorld.xy);
  vec4 n1 = texture2D(tHN, tp * 1.3 + 0.37);
  vec4 n2 = texture2D(tHN, tp * 9.0);
  vec4 n3 = texture2D(tHN, tp * 57.0);
  vec3 alb = hSteelAlb() * (0.6 + 0.8 * n1.g);
  float rough = 0.42 + 0.25 * n2.g;
  // rust blooms out of the joint with the bar and runs down from it
  float joint = smoothstep(0.12, 0.0, abs(vWorld.y - ${f(BAR_Y)})) * smoothstep(0.1, 0.0, abs(vWorld.z - ${f(MULLION_Z)}));
  float run = texture2D(tHN, vec2(tp.x * 11.0, tp.y * 1.1)).g;
  float bloom = smoothstep(0.66, 0.86, n1.r * 0.5 + n2.g * 0.3 + joint * 0.28 + run * 0.12);
  float chip = smoothstep(0.78, 0.9, n2.r * 0.6 + n3.g * 0.4);
  float rust = clamp(max(chip * 0.7, bloom), 0.0, 1.0);
  alb = mix(alb, mix(vec3(0.07, 0.03, 0.014), vec3(0.03, 0.016, 0.01), n3.g), rust);
  rough = mix(rough, 0.92, rust);
  N = normalize(N + (vec3(n3.r, n3.g, n3.a) - 0.5) * (0.07 + 0.5 * rust));
  vec3 E = hIrr(vWorld, N);
  // the sun, as the fogged pane beside it hands it on
  E += uSun.rgb * 0.5 * max(dot(N, H_SUN), 0.0);
  // …and before there is a sun, the moon through the roof
  E += uMoon.rgb * 0.3 * max(dot(N, H_MOON), 0.0);
  // (before dawn painted steel has no colour of its own: it is a shape, darker than the glass)
  vec3 col = alb * E * mix(vec3(1.0), vec3(0.3, 0.42, 0.62), uMoon.a);
  float NdV = max(dot(N, V), 0.0);
  vec3 R = reflect(-V, N);
  float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  vec3 env = hGlowAt(vWorld + N * 0.003, R, 0.03 + rough * 0.5);
  float gl = (1.0 - rough * 0.75);
  // (gloss paint is never evenly glossy: it has run, and been wiped, in streaks down the steel)
  float streak = texture2D(tHN, vec2(tp.x * 34.0, tp.y * 1.3) + 0.11).g;
  // (the bar is this world's own: world 01 has none, so by the time the lens stands where world 01 will it has gone dull, a dark shape out of focus)
  float barDull = 1.0 - 0.88 * uDull * step(${f(BAR_Y - 0.0005)}, vWorld.y);
  col += mix(env, vec3(dot(env, vec3(0.3, 0.5, 0.2))), 0.45) * F * gl * gl * mix(0.42, 0.2 + 0.5 * streak, uSweat) * barDull;
  // (dry and in full day, the paint is a dull grey-green in the light the room gives back: as world 01 has it)
  col += uGlow[0] * 0.019 * (1.0 - uSweat) * (0.5 + n2.g) * (1.0 - rust);
  // cold steel sweats: beads of water, each a point of whatever light there is
  vec2 bq = tp / 0.0019;
  float bfw = length(fwidth(bq));
  if (bfw < 0.7 && uSweat > 0.0) {
    vec2 bi = floor(bq);
    vec3 bh = hash32(bi + 3.0);
    if (bh.z < 0.22 + 0.3 * n1.r) {
      float br = 0.14 + 0.24 * bh.x * bh.x;
      vec2 bd = (fract(bq) - (0.3 + 0.4 * bh.xy)) / br;
      float bl = dot(bd, bd);
      if (bl < 1.0) {
        vec3 skyL = uGlow[3] + uGlow[1] + uGlow[0] * 0.6 + uMoon.rgb * 0.08;
        float hl = smoothstep(0.3, 0.0, length(bd - vec2(-0.15, 0.4)));
        float fade = smoothstep(0.7, 0.3, bfw) * (1.0 - rust) * uSweat;
        col = mix(col, col * (0.55 + 0.5 * bl) + skyL * (0.9 * hl + 0.05 * smoothstep(0.4, 1.0, bl) * step(bd.y, 0.0)), fade);
      }
    }
  }
  // the arrises of the flange catch the pane behind them: a line of light down each edge
  float ez = 0.026 - abs(vWorld.z - ${f(MULLION_Z)});
  float onFlange = step(0.5, an.x) * step(abs(vWorld.x - ${f(FLANGE_X)}), 0.0015);
  col += (uGlow[0] * 1.1 + uSun.rgb * 0.5 + uDawn.rgb * 0.6) * onFlange * exp(-max(ez, 0.0) / 0.0007) * (0.6 + 0.8 * n2.g) * uSweat;
  // the lower arris of the lip: beads of water, each holding the light
  float edge = smoothstep(${f(BAR_Y + 0.0012)}, ${f(BAR_Y + 0.0001)}, vWorld.y) * step(${f(LIP.x1 - 0.0005)}, vWorld.x);
  float cellz = vWorld.z * 700.0;
  float bead = step(0.9, hash11(floor(cellz))) * smoothstep(0.5, 0.0, abs(fract(cellz) - 0.5));
  col += (uGlow[3] * 0.5 + uGlow[1] + uDawn.rgb * 2.0) * edge * (0.3 + 2.4 * bead) / (1.0 + 30.0 * dot(cameraPosition - vWorld, cameraPosition - vWorld));
  // the silk under the lip is the brightest thing here before the sun is up
  vec3 dp = vWorld - vec3(${f(PAD.x)}, ${f(PAD.y)}, ${f(PAD.z)});
  col += vec3(0.55, 0.5, 0.42) * uPadGlow * exp(-dot(dp, dp) / 0.00002) * (0.4 + 0.6 * max(-N.y, 0.0));
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

// Silk. The pad is laid down as figures of eight on one spot, turned a little each time; from it threads are drawn down
// and twisted together into the stalk the cremaster hooks into. Every filament is its own ribbon, turned to the lens,
// never thinner than a pixel (and dimmer by as much as it is drawn too wide), lit as a fibre is: a line of light along
// it wherever its direction is right for the light.
const SILK_VERT = /* glsl */ `
attribute vec3 aTan;
attribute vec2 aSide;          // which edge of the ribbon (-1 | 1), a number of its own
uniform vec2 uSilkRes;
varying vec3 vWorld;
varying vec3 vT;
varying vec3 vE;               // across the ribbon in pixels, its half width in pixels, how much dimmer
varying float vSeed;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vT = aTan;
  vSeed = aSide.y;
  vec4 c = projectionMatrix * viewMatrix * w;
  vec4 c2 = projectionMatrix * viewMatrix * vec4(w.xyz + aTan * 2e-4, 1.0);
  vec2 d = (c2.xy / c2.w - c.xy / c.w) * uSilkRes;
  d = normalize(d + vec2(1e-5, 0.0));
  float wpx = 0.000022 * projectionMatrix[1][1] / c.w * uSilkRes.y * 0.5;     // a filament is some 40 µm across
  float hw = max(wpx, 0.62);
  vE = vec3(aSide.x * (hw + 0.75), hw, wpx / hw);
  c.xy += vec2(-d.y, d.x) * aSide.x * (hw + 0.75) / uSilkRes * 2.0 * c.w;
  gl_Position = c;
}`;
const SILK_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vT;
varying vec3 vE;
varying float vSeed;
${houseGLSL}
uniform float uPadGlow;
float fibre(vec3 T, vec3 L, vec3 V, float n){
  vec3 H = normalize(L + V);
  float th = dot(T, H);
  return pow(max(1.0 - th * th, 0.0), n);
}
void main(){
  float a = clamp(vE.y + 0.5 - abs(vE.x), 0.0, 1.0) * mix(vE.z, 1.0, 0.35);
  if (a < 0.02) discard;
  vec3 T = normalize(vT);
  vec3 V = normalize(cameraPosition - vWorld);
  // a fibre gives back what crosses it
  vec3 N = normalize(V - T * dot(V, T));
  vec3 E = hIrr(vWorld, N) * 0.55 + hIrr(vWorld, -N) * 0.45;
  vec3 col = vec3(0.86, 0.84, 0.78) * E * (0.75 + 0.5 * vSeed);
  // …and a line of light where it lies right for the pane behind, for the sun in it, for the moon in the roof
  col += (uGlow[0] * 1.6 + uSun.rgb * 1.3) * fibre(T, vec3(-1.0, 0.0, 0.0), V, 40.0);
  col += uSun.rgb * 2.4 * fibre(T, H_SUN, V, 120.0);
  col += (uMoon.rgb * 0.5 + uGlow[3] * 1.2) * fibre(T, H_MOON, V, 60.0);
  col += vec3(0.5, 0.47, 0.42) * uPadGlow * (0.5 + 0.7 * vSeed);
  gl_FragColor = vec4(col * a, a);
}`;

/** The filaments: every strand a polyline in the world (metres). */
function silkStrands(rnd, top) {
  const mm = 0.001;
  const out = [];
  // the pad: figures of eight, flat under the lip
  for (let k = 0; k < 34; k++) {
    const a = (1.3 + 2.4 * rnd()) * mm;
    const phi = rnd() * Math.PI;
    const sq = 0.5 + 0.4 * rnd();
    const y = PAD.y - (0.015 + 0.3 * rnd() * rnd()) * mm;
    const cx = (rnd() - 0.5) * 0.7 * mm;
    const cz = (rnd() - 0.5) * 0.7 * mm;
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const th = (i / 60) * Math.PI * 2;
      const den = 1 + Math.sin(th) ** 2;
      const u = (a * Math.cos(th)) / den;
      const v = (a * sq * 2 * Math.sin(th) * Math.cos(th)) / den;
      pts.push([PAD.x + cx + u * Math.cos(phi) - v * Math.sin(phi), y - 0.04 * mm * Math.sin(3 * th + k), PAD.z + cz + u * Math.sin(phi) + v * Math.cos(phi)]);
    }
    out.push(pts);
  }
  // drawn down out of the pad, gathered, and twisted together into the stalk
  const drop = PAD.y - top;
  const sm = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let k = 0; k < 22; k++) {
    const a0 = rnd() * Math.PI * 2;
    const r0 = (0.9 + 2.6 * rnd()) * mm;
    const rs = (0.07 + 0.2 * rnd()) * mm;
    const turns = (1.5 + 1.2 * rnd()) * (rnd() < 0.5 ? 1 : -0.4);
    const gather = 0.26 + 0.2 * rnd();
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const g = Math.pow(1 - sm(0, gather, t), 2.4);
      const r = rs * (1 + 0.25 * Math.sin(t * 19 + k)) + (r0 - rs) * g;
      const ang = a0 + turns * Math.PI * 2 * sm(gather * 0.5, 1, t);
      pts.push([PAD.x + r * Math.cos(ang), PAD.y - drop * t, PAD.z + r * Math.sin(ang)]);
    }
    out.push(pts);
  }
  return out;
}
function silkGeometry(strands, rnd) {
  const pos = [];
  const tan = [];
  const side = [];
  const idx = [];
  for (const pts of strands) {
    const seed = rnd();
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
      for (const sd of [-1, 1]) {
        pos.push(pts[i][0], pts[i][1], pts[i][2]);
        tan.push((b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l);
        side.push(sd, seed);
      }
      if (i + 1 < pts.length) idx.push(base + 2 * i, base + 2 * i + 1, base + 2 * i + 2, base + 2 * i + 1, base + 2 * i + 3, base + 2 * i + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 2));
  g.setIndex(idx);
  return g;
}

const BG_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
${houseGLSL}
uniform float uBgBlur;
void main(){
  gl_FragColor = vec4(houseEnv(cameraPosition, normalize(vDir), uBgBlur, 1.0), 1.0);
}`;

function boxes(list) {
  const pos = [];
  const nrm = [];
  const idx = [];
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (const g of list) {
    const base = pos.length / 3;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

export function buildSet(ctx, house, kit) {
  const scene = new THREE.Scene();

  // ---- the room: it is never in focus, so it is drawn at half size into a target of its own (room, roomRT), and the
  //      picture takes it from there: one triangle at the far plane, drawn after everything solid
  const tri = ctx.track(new THREE.BufferGeometry());
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const bgU = { ...house, uInvVP: { value: new THREE.Matrix4() }, uBgBlur: { value: 0.02 } };
  const room = new THREE.Mesh(
    tri,
    ctx.track(
      new THREE.ShaderMaterial({
        uniforms: bgU,
        vertexShader: /* glsl */ `
          uniform mat4 uInvVP;
          varying vec3 vDir;
          void main(){
            vec4 w = uInvVP * vec4(position.xy, 1.0, 1.0);
            vDir = w.xyz / w.w - cameraPosition;
            gl_Position = vec4(position.xy, 1.0, 1.0);
          }`,
        fragmentShader: BG_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    ),
  );
  room.frustumCulled = false;
  const roomRT = ctx.createTarget({ scale: 0.5 });
  const copyU = { tRoom: { value: roomRT.texture }, uInvRes: { value: new THREE.Vector2(1, 1) } };
  const bg = new THREE.Mesh(
    tri,
    ctx.track(
      new THREE.ShaderMaterial({
        uniforms: copyU,
        vertexShader: /* glsl */ `void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }`,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform sampler2D tRoom;
          uniform vec2 uInvRes;
          void main(){ gl_FragColor = vec4(texture2D(tRoom, gl_FragCoord.xy * uInvRes).rgb, 1.0); }`,
        depthWrite: false,
        depthFunc: THREE.LessEqualDepth,
      }),
    ),
  );
  bg.frustumCulled = false;
  bg.renderOrder = 50;
  scene.add(bg);

  // ---- steel: the mullion (a T: web against the glass, flange to the corridor) and the angle bar across it
  const H = EAVE - Y0;
  const yMid = (EAVE + Y0) / 2;
  const L = 17.8;
  const zMid = -4.95;
  const parts = [
    box(0.04, H, 0.012, -HW + 0.02, yMid, MULLION_Z),
    box(0.008, H, 0.052, -HW + 0.044, yMid, MULLION_Z),
    box(LEG.x1 - LEG.x0, LEG.h, L, (LEG.x0 + LEG.x1) / 2, BAR_Y + LEG.h / 2, zMid),
    box(LIP.x1 - LIP.x0, LIP.t, L, (LIP.x0 + LIP.x1) / 2, BAR_Y + LIP.t / 2, zMid),
  ];
  // two bolts hold the bar to the flange
  for (const dz of [-0.014, 0.014]) {
    const b = new THREE.CylinderGeometry(0.0042, 0.0042, 0.003, 6).rotateZ(Math.PI / 2).translate(LEG.x1 + 0.0015, BAR_Y + 0.02, MULLION_Z + dz);
    parts.push(b.index ? b : b.toNonIndexed());
  }
  const steelU = { ...house, uPadGlow: { value: 0 }, uSweat: { value: 1 }, uDull: { value: 0 } };
  const steel = new THREE.Mesh(ctx.track(boxes(parts)), ctx.track(new THREE.ShaderMaterial({ uniforms: steelU, vertexShader: SOLID_VERT, fragmentShader: STEEL_FRAG })));
  steel.frustumCulled = false;
  scene.add(steel);

  // ---- silk: the pad under the lip, drawn out into the stalk
  const top = CH_C.y + CH_H * 0.5 - 0.0006; // where the cremaster takes over
  const rnd = ctx.rng(41);
  const silkU = { ...steelU, uSilkRes: { value: new THREE.Vector2(1, 1) } };
  const silk = new THREE.Mesh(
    ctx.track(silkGeometry(silkStrands(rnd, top), rnd)),
    ctx.track(new THREE.ShaderMaterial({ uniforms: silkU, vertexShader: SILK_VERT, fragmentShader: SILK_FRAG, side: THREE.DoubleSide, transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation })),
  );
  silk.frustumCulled = false;
  silk.renderOrder = 60;
  scene.add(silk);

  // ---- the chrysalis
  const chrys = buildChrysalis(ctx, house, kit);
  scene.add(chrys.full);

  const _vp = new THREE.Matrix4();
  return {
    scene,
    room,
    bgU,
    steelU,
    chrys,
    /** Draw the room for this camera, and get the picture ready to take it at w × h pixels. */
    drawRoom(renderer, cam, w, h) {
      _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      bgU.uInvVP.value.copy(_vp).invert();
      renderer.setRenderTarget(roomRT);
      renderer.render(room, cam);
      copyU.uInvRes.value.set(1 / w, 1 / h);
      silkU.uSilkRes.value.set(w, h);
    },
  };
}

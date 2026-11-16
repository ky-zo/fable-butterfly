// Everything that is silk and is not the animal:
//
//   strands   hanks of filaments from the animal to the things it can turn to (leaf, drop, light, pane, pad), the one
//             strand everything hangs from, slack ones between the things themselves, a few loose ends
//   polys     the leaf (a few strands), trails laid in figures of eight, the pad, the winding of the chrysalis, its stalk

import * as THREE from 'three';
import { silkMaterial, stripGeometry, PolyBag } from './silk.js';
import { hash } from '../../core/glsl.js';
import { G, PG, PAD, DROP, GLOW, PANE_Z, PANE_AT, BAR_Y, STRAND_BOTTOM, CHRYS_H, CHRYS_C, REST } from './story.js';

// ---------------------------------------------------------------- the leaf
const STEM = [-0.62, 0.235, -0.16];
const TIP = [0.15, 0.118, 0.05];
const ACROSS = new THREE.Vector3(0.18, -0.74, 0.62).normalize();
/** A point of the leaf: u 0 stem … 1 tip along the midrib, v -1 … 1 across the blade. */
export function leafPoint(u, v, out = []) {
  const w = 0.105 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.9) * (1 - 0.25 * u);
  const droop = Math.sin(Math.PI * u) * 0.075;
  const curl = v * v * 0.03;
  out[0] = STEM[0] + (TIP[0] - STEM[0]) * u + ACROSS.x * v * w;
  out[1] = STEM[1] + (TIP[1] - STEM[1]) * u + droop + ACROSS.y * v * w + curl * 0.3;
  out[2] = STEM[2] + (TIP[2] - STEM[2]) * u + ACROSS.z * v * w - curl;
  return out;
}

// ---------------------------------------------------------------- the chrysalis
const CH_R = 0.0195;
/** A point of its surface: s 0 (the stalk) … 1 (the blunt end), th around; `lift` metres off the surface. */
export function chrysPoint(s, th, lift = 0, out = []) {
  const prof = Math.pow(Math.max(Math.sin(Math.PI * Math.pow(s, 1.1)), 0), 0.52) * (0.36 + 0.64 * Math.min(1, Math.pow(s / 0.45, 1.3))) * (0.93 + 0.07 * Math.sin(s * 5.2 - 0.2));
  const c = Math.cos(th);
  // the wing cases swell the front of it; the abdomen, above, is ringed
  const r = CH_R * prof * (1 + 0.3 * Math.exp(-Math.pow((s - 0.6) / 0.2, 2)) * Math.max(c, 0) + 0.04 * Math.sin(s * 52) * (1 - Math.min(1, s / 0.45))) + lift + 0.0011 * (1 - s);
  // it hangs bent, like a comma
  const ax = CHRYS_H * 0.2 * Math.sin(Math.PI * Math.pow(s, 0.75)) * (1 - 0.3 * s) - 0.0085;
  out[0] = CHRYS_C.x + ax + r * c * 0.92;
  out[1] = CHRYS_C.y + CHRYS_H / 2 - s * CHRYS_H;
  out[2] = CHRYS_C.z + r * Math.sin(th);
  return out;
}

export function buildWeb(ctx, shared) {
  const rnd = ctx.rng(51);
  const level = ctx.quality.level;
  const SEGS = level >= 1 ? 20 : 14;
  const dens = [0.55, 0.8, 1][level];
  const list = [];
  const beads = []; // { A, B, P } of strands that carry dew, with how much
  const hank = (A, ai, B, g, n, r, slack = 1, dew = 0) => {
    const order = rnd();
    const m = Math.max(1, Math.round(n * dens));
    for (let c = 0; c < m; c++) {
      const j = () => (rnd() - 0.5) * 0.008;
      const it = { A: [A[0], A[1], A[2], ai], B: [B[0] + j(), B[1] + j(), B[2] + j(), g], P: [rnd(), r * (0.6 + 0.8 * rnd() * rnd()), slack * (0.7 + 0.6 * rnd()), Math.min(1, order + 0.08 * rnd())] };
      list.push(it);
      if (dew > 0 && c === 0) beads.push({ it, dew });
    }
  };
  const tie = () => (rnd() < 0.45 ? Math.floor(rnd() * 4) : 4 + Math.floor(rnd() * 8));

  // ---- the one strand everything hangs from
  const main = { A: [PAD.x, PAD.y, PAD.z, -1], B: [0, STRAND_BOTTOM, 0, G.MAIN], P: [0.371, 0.00046, 0, 0] };
  list.push(main);
  beads.push({ it: main, dew: 3 });

  // ---- what it can turn to
  const leafPts = [];
  for (let i = 0; i < 26; i++) leafPts.push(leafPoint(0.25 + 0.7 * rnd(), rnd() < 0.4 ? 0 : (rnd() < 0.5 ? -1 : 1) * (0.5 + 0.5 * rnd())));
  for (const q of leafPts.slice(0, 16)) hank([0, 0, 0], tie(), q, G.LEAF, 3, 0.00042, 1, rnd() < 0.5 ? 1 : 0);
  for (let i = 0; i < 7; i++) hank([0, 0, 0], tie(), [DROP.x + (rnd() - 0.5) * 0.004, DROP.y + 0.013 + rnd() * 0.05, DROP.z], G.DROP, 3, 0.0004, 1, 1);
  for (let i = 0; i < 4; i++) hank([0, 0, 0], tie(), [DROP.x, DROP.y - 0.014 - rnd() * 0.04, DROP.z], G.DROP, 2, 0.0004, 1, 1);
  const lightPts = [];
  for (let i = 0; i < 22; i++) {
    const a = rnd() * 6.283;
    const rr = 0.08 + 0.5 * Math.sqrt(rnd());
    lightPts.push([GLOW.x + Math.cos(a) * rr, GLOW.y + Math.sin(a) * rr * 0.7 + 0.1, PANE_Z + 0.04]);
  }
  for (const q of lightPts) hank([0, 0, 0], tie(), q, G.LIGHT, 3, 0.0004, 1, rnd() < 0.3 ? 1 : 0);
  const panePts = [];
  for (let i = 0; i < 24; i++) {
    // along the glazing bars
    const onV = rnd() < 0.5;
    const gx = Math.round((PANE_AT.x + (rnd() - 0.5) * 2.2) / 0.9 - 0.5) + 0.5;
    const gy = Math.round((PANE_AT.y + (rnd() - 0.5) * 1.6 - 0.25) / 1.25);
    panePts.push(onV ? [gx * 0.9, PANE_AT.y + (rnd() - 0.5) * 1.9, PANE_Z + 0.04] : [PANE_AT.x + (rnd() - 0.5) * 2.4, gy * 1.25 + 0.25, PANE_Z + 0.04]);
  }
  for (const q of panePts) hank([0, 0, 0], tie(), q, G.PANE, 3, 0.0004, 1, rnd() < 0.3 ? 1 : 0);
  for (let i = 0; i < 9; i++) hank([0, 0, 0], tie(), [PAD.x + (rnd() - 0.5) * 0.03, PAD.y, PAD.z + (rnd() - 0.5) * 0.03], G.PAD, 3, 0.00045, 0.6, i < 4 ? 1 : 0);

  // ---- slack ones between the things themselves: depth, and soft bands across the foreground
  const far = () => [(rnd() - 0.5) * 5.5, -0.9 + rnd() * 3.0, PANE_Z + 0.04];
  const bar = () => [(rnd() - 0.5) * 4.5, BAR_Y, (rnd() - 0.5) * 0.04];
  const low = () => [(rnd() - 0.5) * 3.5, -1.7 - rnd() * 0.6, -1.5 + rnd() * 2.6];
  const fore = () => [(rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 1.6), -0.6 + rnd() * 2.6, 0.7 + rnd() * 1.6];
  const onMain = () => [0, -1.2 + rnd() * 2.9, 0];
  const pick = [() => leafPts[Math.floor(rnd() * leafPts.length)], far, bar, low, fore, onMain];
  for (let i = 0; i < 120; i++) {
    const a = Math.floor(rnd() * pick.length);
    let b = Math.floor(rnd() * pick.length);
    if (b === a) b = (a + 1 + Math.floor(rnd() * (pick.length - 1))) % pick.length;
    const A = pick[a]();
    const B = pick[b]();
    // (nothing may cross the frame of the hand-over just in front of the animal)
    hank(A, -1, B, G.AMBIENT, 2 + Math.floor(rnd() * 2.5), 0.0004, 1, rnd() < 0.22 ? 1 : 0);
  }
  // ---- a few loose ends under the bar
  for (let i = 0; i < 7; i++) {
    const x = (rnd() < 0.5 ? -1 : 1) * (0.02 + rnd() * rnd() * 0.3);
    const len = 0.04 + rnd() * 0.16;
    list.push({ A: [x, BAR_Y, (rnd() - 0.5) * 0.03, -1], B: [x + (rnd() - 0.5) * 0.12, BAR_Y - len * (0.3 + 0.7 * rnd()), (rnd() - 0.5) * 0.1, G.LOOSE], P: [rnd(), 0.00022, 1.6 + rnd() * 2.0, rnd()] });
  }

  const n = list.length;
  const inst = { A: new Float32Array(n * 4), B: new Float32Array(n * 4), P: new Float32Array(n * 4) };
  list.forEach((it, k) => {
    it.index = k;
    inst.A.set(it.A, k * 4);
    inst.B.set(it.B, k * 4);
    inst.P.set(it.P, k * 4);
  });
  const g = new THREE.InstancedBufferGeometry();
  const { pos, idx } = stripGeometry(SEGS);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(inst.A, 4));
  g.setAttribute('iB', new THREE.InstancedBufferAttribute(inst.B, 4));
  g.setAttribute('iP', new THREE.InstancedBufferAttribute(inst.P, 4));
  g.instanceCount = n;
  ctx.track(g);
  const mesh = (geo, mat) => {
    const o = new THREE.Mesh(geo, mat);
    o.frustumCulled = false;
    o.matrixAutoUpdate = false;
    return o;
  };
  const strands = [0, 1, 2, 3].map((pass) => mesh(g, silkMaterial(ctx, shared, 'strand', pass, {}, SEGS)));

  // ================================================================ polys
  const bag = new PolyBag(false);
  // ---- the leaf: its two edges, its midrib, a few side veins
  const line = (f, m = 40) => Array.from({ length: m + 1 }, (_, i) => f(i / m));
  bag.add(line((t) => leafPoint(t, 0)), { kind: 3, radius: 0.0011, group: PG.LEAF, rand: rnd() });
  for (const sv of [-1, 1]) {
    bag.add(line((t) => leafPoint(t, sv), 56), { kind: 3, radius: 0.0006, group: PG.LEAF, rand: rnd() });
    for (let k = 0; k < 7; k++) {
      const u0 = 0.1 + k * 0.115;
      bag.add(line((t) => leafPoint(u0 + t * (0.1 + 0.05 * (1 - u0)), sv * Math.pow(t, 0.8) * 0.985), 16), { kind: 3, radius: 0.00042, group: PG.LEAF, rand: rnd() });
    }
  }
  // the stem, out of frame
  bag.add([leafPoint(0, 0), [STEM[0] - 0.4, STEM[1] + 0.35, STEM[2] - 0.2]], { kind: 3, radius: 0.0012, group: PG.LEAF, rand: rnd() });

  // ---- trails: silk is not poured, it is laid down by a point swinging in a figure of eight
  const trails = [
    // from, to, how many eights, width, when (0..1 of the laying)
    [[0.0, 0.05, 0.0], [-0.17, 0.3, -0.05], 13, 0.03, 0.0],
    [[0.0, -0.02, 0.0], [0.0, -0.19, 0.0], 9, 0.022, 0.1],
    [[0.01, 0.0, 0.0], [0.62, -0.2, -0.5], 19, 0.04, 0.2],
    [[-0.01, 0.03, 0.0], [-0.55, 0.42, -0.6], 19, 0.04, 0.32],
    [[0.0, 0.1, 0.0], [0.03, 0.85, 0.02], 22, 0.03, 0.44],
    [[0.02, -0.03, 0.02], [0.5, -0.5, 0.45], 16, 0.04, 0.56],
    [[-0.02, 0.0, 0.02], [-0.6, -0.25, 0.3], 16, 0.04, 0.66],
  ];
  const up = new THREE.Vector3(0, 1, 0);
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const e3 = new THREE.Vector3();
  const TRAIL_SPAN = 0.34;
  const hd = { A: [], E1: [], E2: [], E3: [] };
  for (const [a, b, eights, wid, when] of trails) {
    e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = e1.length();
    e1.normalize();
    e2.crossVectors(e1, Math.abs(e1.y) > 0.9 ? e3.set(1, 0, 0) : up).normalize();
    e3.crossVectors(e1, e2);
    hd.A.push(a[0], a[1], a[2], len);
    hd.E1.push(e1.x, e1.y, e1.z, eights);
    hd.E2.push(e2.x, e2.y, e2.z, wid);
    hd.E3.push(e3.x, e3.y, e3.z, when);
    const m = eights * 26;
    const pts = [];
    for (let i = 0; i <= m; i++) {
      const t = i / m;
      const ph = t * eights * Math.PI * 2;
      const w = wid * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * (1 + 0.25 * Math.sin(t * 17));
      // a lemniscate that drifts: across by sin, along by sin of twice the angle
      const ox = Math.sin(ph) * w;
      const oy = Math.sin(2 * ph) * w * 0.42;
      const oz = Math.cos(ph) * w * 0.25;
      const sag = -Math.sin(Math.PI * t) * len * 0.05;
      pts.push([a[0] + e1.x * (t * len + oy) + e2.x * ox + e3.x * oz, a[1] + e1.y * (t * len + oy) + e2.y * ox + e3.y * oz + sag, a[2] + e1.z * (t * len + oy) + e2.z * ox + e3.z * oz]);
    }
    bag.add(pts, { kind: 5, radius: 0.00034, group: PG.TRAIL, start: when, span: TRAIL_SPAN, rand: rnd() });
  }

  // ---- where a strand meets the glass it is not simply stuck on: it is tied down with a small pad, the same
  // figure of eight laid twice across itself
  const hold = (q, group) => {
    const rot = rnd() * Math.PI;
    const wid = 0.006 + 0.005 * rnd();
    for (let k = 0; k < 2; k++) {
      const pts = [];
      const c = Math.cos(rot + k * 1.45), sn = Math.sin(rot + k * 1.45);
      for (let i = 0; i <= 28; i++) {
        const ph = (i / 28) * Math.PI * 2;
        const x = Math.sin(ph) * wid, y = Math.sin(2 * ph) * wid * 0.5;
        pts.push([q[0] + x * c - y * sn, q[1] + x * sn + y * c, q[2] - 0.004 + 0.003 * Math.cos(ph)]);
      }
      bag.add(pts, { kind: 5, radius: 0.0003, group, start: 0, span: 0.001, rand: rnd() });
    }
  };
  for (const q of lightPts) hold(q, PG.HOLD_LIGHT);
  for (const q of panePts) hold(q, PG.HOLD_PANE);

  // ---- the pad: the same figure of eight, over and over on one spot, under the bar
  for (let k = 0; k < 16; k++) {
    const rot = rnd() * Math.PI;
    const wid = 0.006 + 0.008 * rnd();
    const pts = [];
    const eights = 3;
    const m = eights * 30;
    for (let i = 0; i <= m; i++) {
      const ph = (i / m) * eights * Math.PI * 2;
      const x = Math.sin(ph) * wid * (1 + 0.15 * Math.sin(ph * 0.31 + k));
      const z = Math.sin(2 * ph) * wid * 0.5;
      const cx = x * Math.cos(rot + i * 0.004) - z * Math.sin(rot + i * 0.004);
      const cz = x * Math.sin(rot + i * 0.004) + z * Math.cos(rot + i * 0.004);
      const rr = Math.hypot(cx, cz) / 0.014;
      // (a button, thickest in the middle, pulled down a little by what hangs from it)
      pts.push([PAD.x + cx, PAD.y - 0.006 * Math.exp(-rr * rr * 2.2) - 0.0004 * (k % 5), PAD.z + cz * 0.8]);
    }
    bag.add(pts, { kind: 5, radius: 0.0003, group: PG.PAD, start: (k / 16) * 0.8, span: 0.2, rand: rnd() });
  }
  // ---- the stalk: a twist of filaments from the pad to the top of the chrysalis
  const top = chrysPoint(0, 0);
  for (let k = 0; k < 9; k++) {
    const a0 = rnd() * 6.283;
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const r = 0.008 * Math.pow(1 - t, 2.2) * (0.4 + 0.6 * rnd()) + 0.0008;
      const a = a0 + t * 5.0;
      pts.push([PAD.x + (top[0] - PAD.x) * t + Math.cos(a) * r, PAD.y - 0.004 * Math.min(1, t * 6) + (top[1] - PAD.y + 0.004) * t, PAD.z + Math.sin(a) * r * 0.8]);
    }
    bag.add(pts, { kind: 5, radius: 0.00032, group: PG.STALK, start: 0, span: 1, rand: rnd() });
  }
  // ---- the winding
  let at = 0;
  const winds = [
    [96, 1, 0.0, 0.00025, 0.0003],
    [71, -1, 1.7, 0.00021, 0.0005],
    [37, 1, 3.1, 0.0002, 0.0007],
    [11, -1, 0.6, 0.0003, 0.0009],
  ];
  const totalTurns = winds.reduce((s, w) => s + w[0], 0);
  for (const [turns, dir, ph, rad, lift] of winds) {
    const m = turns * 22;
    const pts = [];
    for (let i = 0; i <= m; i++) {
      const t = i / m;
      const s = 0.012 + 0.985 * (dir > 0 ? t : 1 - t);
      pts.push(chrysPoint(s, dir * t * turns * Math.PI * 2 + ph + 0.4 * Math.sin(t * 31 + ph), lift + 0.0002 * Math.sin(t * 190 + ph)));
    }
    bag.add(pts, { kind: 4, radius: rad, group: PG.WIND, start: at, span: turns / totalTurns, rand: rnd() });
    at += turns / totalTurns;
  }
  const pg = bag.geometry(ctx);
  const polys = [0, 1, 2, 3].map((pass) => mesh(pg, silkMaterial(ctx, shared, 'poly', pass)));

  // ---- the points that write the trails. Silk is spun by a head swinging in a figure of eight, so each trail has
  // one: a bright point at the place the thread has reached (progress says where), going round its eight (time)
  const hg = new THREE.InstancedBufferGeometry();
  hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
  hg.setIndex([0, 1, 2, 2, 1, 3]);
  for (const k of ['A', 'E1', 'E2', 'E3']) hg.setAttribute('i' + k, new THREE.InstancedBufferAttribute(new Float32Array(hd[k]), 4));
  hg.instanceCount = trails.length;
  ctx.track(hg);
  const heads = mesh(
    hg,
    ctx.track(
      new THREE.ShaderMaterial({
        uniforms: { uTime: shared.uTime, uFocus: shared.uFocus, uK: shared.uK, uMaxCoc: shared.uMaxCoc, uPxPerM: shared.uPxPerM, uNearClip: shared.uNearClip, uTrail: { value: shared.uPoly.value[PG.TRAIL] } },
        vertexShader: /* glsl */ `
          precision highp float;
          attribute vec4 iA;      // where the trail starts, its length
          attribute vec4 iE1;     // the way it runs, how many eights
          attribute vec4 iE2;     // across, how wide
          attribute vec4 iE3;     // the third axis, when it is laid
          uniform float uTime, uFocus, uK, uMaxCoc, uPxPerM, uNearClip;
          uniform vec4 uTrail;    // x how much of the trails is laid
          varying vec2 vQ;
          varying vec3 vL;        // core radius px, whole radius px, light
          ${hash}
          void main(){
            float gT = clamp((uTrail.x - iE3.w) / ${TRAIL_SPAN.toFixed(3)}, 0.0, 1.0);
            float on = smoothstep(0.0, 0.04, gT) * (1.0 - smoothstep(0.955, 1.0, gT));
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            if (on < 0.002) return;
            float seed = hash11(iE3.w * 37.0 + 1.7);
            // the eight it is laying now, and where on it the head is
            float w = iE2.w * (0.45 + 0.55 * sin(3.14159265 * min(1.0, gT * 1.15))) * (1.0 + 0.25 * sin(gT * 17.0)) * 1.12;
            float ph = 6.2831853 * (gT * iE1.w + uTime * (0.5 + 0.16 * seed) + seed);
            vec3 P = iA.xyz + iE1.xyz * (gT * iA.w + sin(2.0 * ph) * w * 0.42) + iE2.xyz * (sin(ph) * w) + iE3.xyz * (cos(ph) * w * 0.25);
            P.y -= sin(3.14159265 * gT) * iA.w * 0.05;
            vec4 vp = viewMatrix * vec4(P, 1.0);
            float d = -vp.z;
            if (d < uNearClip * 2.0) return;
            float coc = min(uK * abs(1.0 - uFocus / d), uMaxCoc);
            float core = clamp(0.0015 * uPxPerM / d, 1.9, 8.0) * clamp(uPxPerM / 1650.0, 0.62, 1.0);
            float R = core * 5.0 + coc;
            vQ = position.xy;
            vL = vec3(core + coc * 0.6, R, on * (core * core) / ((core + coc * 0.6) * (core + coc * 0.6)));
            vp.xy += position.xy * (R + 1.0) * d / uPxPerM;
            gl_Position = projectionMatrix * vp;
          }`,
        fragmentShader: /* glsl */ `
          precision highp float;
          varying vec2 vQ;
          varying vec3 vL;
          void main(){
            float r = length(vQ) * (vL.y + 1.0);
            float core = exp(-r * r / (vL.x * vL.x));
            float halo = exp(-r / (vL.x * 1.5)) * (1.0 - smoothstep(vL.y * 0.6, vL.y, r));
            vec3 col = (vec3(1.0, 0.9, 0.7) * core * 12.0 + vec3(1.0, 0.62, 0.3) * halo * 1.2) * vL.z;
            if (dot(col, vec3(1.0)) < 0.003) discard;
            gl_FragColor = vec4(col, 1.0);
          }`,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        depthTest: true,
        depthWrite: false,
        transparent: true,
      }),
    ),
  );

  return { strands, polys, heads, list, beads, count: n, segs: SEGS, polySegments: bag.idx.length / 6 };
}
export { REST };

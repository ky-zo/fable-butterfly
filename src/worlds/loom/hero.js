// The animal here: drawn in thread. The kit's own curves, posed by the kit's own rig, so it is the same glasswing and
// beats its wings the same way as in every other world:
//
//   warp    every vein and both margins of each wing (wingVeins, wingOutline): silver-white, hair-fine
//   ember   along the outer margins, inside the silver one, four threads dyed the colours of its border: amber at the
//           core of the band, crimson on its shoulders (borderAt says where, and how wide); a row of small loops of
//           white in the rim outside them
//   bar     the white bar of the forewing: a spindle of the brightest threads it has, drawn to a point (BAR)
//   weft    what the loom adds: fine filaments across the clear cells, concentric about the hinge, laid by one point of
//           light per wing that shuttles out from the body, and taken up again the same way
//   body    thorax, abdomen and head wound in an open lattice round the kit's own sections, plus their outlines: slender,
//           fine thread, with its white spots as small knots of the bright thread
//   limbs   legs, antennae, palps, tongue (bodyCurves); each antenna a single hair ending in a knot of ember thread
//
// Progress says where it is, how it is turned and how much of it is woven (story.js). Time gives it life on top of
// that — the wingbeat, a little wander, the fanning of its wings at rest — and none of that ever reaches the camera.

import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { wingOutline, wingVeins, bodyCurves, thoraxAt, abdomenAt, headAt, borderAt, antennaPath, antennaRad, BAR, SPOTS, CLUB, FEET, PART, SPAN, makePose, poseUniforms, wingPoint, flightPose, restPose, flightBasis, bodyMatrix } from '../../shared/butterfly/index.js';
import { PolyBag, silkMaterial } from './silk.js';
import { SIZE, MM, DEG, key, pathAt, K_AIR, K_OPEN, K_BEAT, K_WEFT, K_WARP, K_LIMB, K_SHORT, K_BODY, K_HERO } from './story.js';

function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

const sstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** which way it is headed in the air, degrees about the vertical: 0 away from the lens's side of the room, 90 to the right */
const K_YAW = [[0, 100], [0.3, 100], [0.375, -42], [0.45, -105], [0.53, 24], [0.61, -60], [0.69, 60], [1, 60]];
const K_PITCH = [[0, 0.5], [0.6, 0.5], [0.68, 0.7], [0.75, 0.9], [1, 0.9]];
/** banked toward the lens where it is seen from the side and far off, so that its wings show their faces */
const K_ROLL = [[0, 0.75], [0.3, 0.75], [0.37, 0], [0.63, 0], [0.7, -0.25], [1, -0.25]];
const K_WANDER = [[0, 0], [0.24, 0], [0.3, 1], [0.36, 0.5], [0.66, 0.5], [0.7, 0.8], [0.77, 0], [1, 0]];

// points of the animal that strands are tied to: [x, y, side, hind] on a wing (mm, wing frame) or [x, y, z] on the body
// (the last of the body's is the tip of the abdomen, which ends at y = −11.45)
const ATTACH = [
  [0, 0.5, 0.6], [0, 4.6, 0.3], [0, -6, 0.2], [0, -10.9, -0.5],
  [9, 1.6, 1, 0], [9, 1.6, -1, 0], [10, -1.9, 1, 0], [10, -1.9, -1, 0],
  [6.5, 1.8, 1, 1], [6.5, 1.8, -1, 1], [7.5, -1.9, 1, 1], [7.5, -1.9, -1, 1],
];
export const ATTACH_N = 16;

const _a = new THREE.Vector3();
const _h = new THREE.Vector3();
const _R = new THREE.Vector3();
const _F = new THREE.Vector3();
const _U = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const lerpV4 = (o, a, b, t) => o.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, a.w + (b.w - a.w) * t);

export async function buildHero(ctx, shared) {
  const rnd = ctx.rng(205);
  const bag = new PolyBag(true);
  const wingX = (side, hind) => () => ({ wing: [side, hind], part: [-1, 0, 0, -1] });

  // ---- warp: margins and veins
  for (const hind of [0, 1]) {
    const margin = wingOutline(hind, 96);
    const veins = wingVeins(hind, 4);
    // (each line knows how far from the hinge it begins and ends, so that the wing can be drawn in toward the body)
    const Lw = Math.max(...margin.map((p) => Math.hypot(p[0], p[1]))) * 1.01;
    let far = 0;
    margin.forEach((p, i) => {
      if (Math.hypot(p[0], p[1]) > Math.hypot(margin[far][0], margin[far][1])) far = i;
    });
    const lead = margin.slice(0, far + 1).map((p) => [p[0], p[1], 0]);
    const trail = [margin[0], ...margin.slice(far).reverse()].map((p) => [p[0], p[1], 0]);
    for (const side of [1, -1]) {
      bag.add(lead, { kind: 1, radius: 0.055 * MM, rand: rnd(), extra: wingX(side, hind) });
      bag.add(trail, { kind: 1, radius: 0.055 * MM, rand: rnd(), extra: wingX(side, hind) });
      for (const v of veins) {
        const pts = [];
        for (const p of v.points) {
          if (pts.length > 1 && !inside(p, margin)) break;
          pts.push([p[0], p[1], 0]);
        }
        if (pts.length < 2) continue;
        const radii = pts.map((_, i) => (v.r0 + ((v.r1 - v.r0) * i) / (pts.length - 1)) * MM * 0.56);
        const r0 = Math.hypot(pts[0][0], pts[0][1]) / Lw;
        const r1 = Math.hypot(pts[pts.length - 1][0], pts[pts.length - 1][1]) / Lw;
        bag.add(pts, { kind: 1, radii, rand: rnd(), start: Math.min(r0, r1), span: Math.max(0.03, Math.abs(r1 - r0)), extra: wingX(side, hind) });
      }
    }
    // ---- the border, in thread. Along the outer margins the band of scales has an ember in it: four threads laid
    // inside the margin, where the kit's band is (borderAt: its width, and how much of it is ember), dyed from the
    // amber of its core to the crimson of its shoulders. Where the ember thins they thin with it, and stop.
    const N = margin.length;
    const rad = (p) => Math.hypot(p[0], p[1]) / Lw;
    const at = margin.map((p, i) => {
      const a = margin[(i + N - 1) % N];
      const b = margin[(i + 1) % N];
      const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const [bw, rust] = borderAt(hind, p[0], p[1]);
      const rim = Math.min(0.4, 0.32 * bw);
      // (inward is to the right of the way round: the outline goes out along the leading edge first)
      // (in thread the ember keeps to the margin: at the broad dark tip the band is wider than the tip is round, and
      // threads laid that far in would cross one another)
      return { p, n: [(b[1] - a[1]) / tl, -(b[0] - a[0]) / tl], rim, ew: Math.min(0.62, (bw - rim) * 0.6 * rust), k: sstep(0.12, 0.55, rust) * sstep(1.2, 4.0, Math.hypot(p[0], p[1])) };
    });
    // (where the ember begins it begins slowly: the threads leave the rim one by one and part over a few millimetres)
    for (const f of ['ew', 'k']) {
      const v = at.map((q) => q[f]);
      at.forEach((q, i) => {
        let sum = 0;
        for (let j = -4; j <= 4; j++) sum += v[(i + j + N) % N] * (5 - Math.abs(j));
        q[f] = Math.min(v[i] > 0 ? 1 : 0, sum / 25);
      });
    }
    // [where across the ember, its heat 0 amber … 1 crimson, thickness]
    const EMBER = [[0.1, 0.5, 0.03], [0.34, 0.0, 0.042], [0.62, 0.45, 0.034], [0.9, 1.0, 0.028]];
    // (each run of the margin that has ember in it, in two pieces: out along the leading edge, back along the trailing
    // one — each from its end nearer the hinge, so that it is drawn in toward the body with the margin it lies beside)
    const pieces = [];
    for (const [i0, i1, step] of [[1, far, 1], [N - 1, far, -1]]) {
      let run = [];
      for (let i = i0; step > 0 ? i <= i1 : i >= i1; i += step) {
        if (at[i].k > 0.02) run.push({ ...at[i], i });
        else if (run.length) pieces.push(run), (run = []);
      }
      if (run.length) pieces.push(run);
    }
    for (const side of [1, -1]) {
      for (const run of pieces) {
        if (run.length < 3) continue;
        const r0 = rad(run[0].p);
        const r1 = rad(run[run.length - 1].p);
        // (a run ends in a point, except where it is only cut in two at the tip of the wing)
        const M = run.length - 1;
        run.forEach((q, j) => (q.t = Math.min(run[0].i === far ? 1 : sstep(0, 1, j / Math.min(6, M)), run[M].i === far ? 1 : sstep(0, 1, (M - j) / Math.min(6, M)))));
        for (const [f, heat, r] of EMBER) {
          const pts = run.map((q) => [q.p[0] + q.n[0] * (q.rim + q.ew * f), q.p[1] + q.n[1] * (q.rim + q.ew * f), 0]);
          bag.add(pts, { kind: 8 + 0.4 * heat, radii: run.map((q) => r * Math.max(0.02, q.k * q.t) * MM), rand: rnd(), start: Math.min(r0, r1), span: Math.max(0.03, Math.abs(r1 - r0)), extra: wingX(side, hind) });
        }
      }
      // the dots of the margin: a row of very small stitches of white in the rim, a millimetre and a half apart
      for (let i = 1; i < N; i++) {
        const a = at[i - 1], b = at[i];
        const sOf = (p) => (hind ? Math.atan2(p[1] + 1.4, p[0] - 8.2) * 11.6 : p[0] * 1.13) / 1.5;
        const sa = sOf(a.p), sb = sOf(b.p);
        if (Math.abs(sb - sa) > 0.5) continue;
        const n = Math.floor(Math.max(sa, sb) - 0.5) + 0.5;
        if (n < Math.min(sa, sb)) continue;
        const g = (n - sa) / (sb - sa || 1);
        const x = a.p[0] + (b.p[0] - a.p[0]) * g, y = a.p[1] + (b.p[1] - a.p[1]) * g;
        if (borderAt(hind, x, y)[0] < 1.05 || (!hind && y > -1.2)) continue;
        const r = rad([x, y]);
        // (a stitch: one small loop of the white thread, a fifth of a millimetre across)
        const ring = [];
        for (let j = 0; j <= 10; j++) {
          const an = (j / 10) * Math.PI * 2;
          ring.push([x + b.n[0] * 0.22 + Math.cos(an) * 0.085, y + b.n[1] * 0.22 + Math.sin(an) * 0.085, 0]);
        }
        bag.add(ring, { kind: 9, radius: 0.03 * MM, rand: rnd(), start: r - 0.01, span: 0.03, extra: wingX(side, hind) });
      }
      if (!hind) {
        // the white bar: a spindle of threads from the leading edge, drawn to a point
        const ex = BAR.b[0] - BAR.a[0], ey = BAR.b[1] - BAR.a[1];
        const el = Math.hypot(ex, ey);
        const M = 9;
        for (let j = 0; j < M; j++) {
          const o = ((j + 0.5) / M) * 2 - 1;
          const pts = [];
          for (let i = 0; i <= 14; i++) {
            const al = 0.02 + 0.97 * (i / 14);
            const w = BAR.w * (0.55 + 0.45 * sstep(0, 0.22, al)) * (1 - 0.8 * al * Math.sqrt(al)) * 0.92;
            const q = [BAR.a[0] + ex * al + (ey / el) * o * w, BAR.a[1] + ey * al - (ex / el) * o * w, 0];
            if (inside(q, margin)) pts.push(q);
          }
          if (pts.length < 3) continue;
          const r0 = rad(pts[0]), r1 = rad(pts[pts.length - 1]);
          bag.add(pts, { kind: 9, radius: (0.027 + 0.011 * (1 - Math.abs(o))) * MM, rand: rnd(), start: Math.min(r0, r1), span: Math.max(0.03, Math.abs(r1 - r0)), extra: wingX(side, hind) });
        }
      }
    }
    await ctx.yield();
  }

  // ---- weft: arcs about the hinge, cut by the margin; one continuous path per wing, there and back like a shuttle
  const dense = ctx.quality.level >= 1;
  for (const hind of [0, 1]) {
    const margin = wingOutline(hind, 64);
    const L = SPAN[hind];
    const dr = dense ? 0.4 : 0.62;
    const runs = [];
    let total = 0;
    let flip = false;
    for (let r = 1.6; r < L + 1.5; r += dr * (0.82 + 0.36 * rnd())) {
      const dth = 0.55 / r;
      let run = [];
      const flush = () => {
        if (run.length > 2) {
          if (flip) run.reverse();
          let len = 0;
          for (let i = 1; i < run.length; i++) len += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
          runs.push({ pts: run, len, at: total });
          total += len;
        }
        run = [];
      };
      const wob = rnd() * 6.28;
      for (let th = -1.35; th <= 1.1; th += dth) {
        const rr = r + 0.12 * Math.sin(th * 9 + wob);
        const p = [rr * Math.cos(th), rr * Math.sin(th), 0];
        if (inside(p, margin)) run.push(p);
        else flush();
      }
      flush();
      flip = !flip;
    }
    for (const side of [1, -1]) for (const q of runs) bag.add(q.pts, { kind: 2, radius: 0.028 * MM, start: q.at / total, span: q.len / total, rand: rnd(), extra: wingX(side, hind) });
    await ctx.yield();
  }

  // ---- body: wound round the kit's sections, and outlined
  // (slender: fine thread wound open, one way and back the other, so that the turns cross in a lattice — a sleeve of lace, not a
  // rod and not the rings of a grub)
  const tubes = [
    [PART.THORAX, thoraxAt, 9],
    [PART.ABDOMEN, abdomenAt, 11],
    [PART.HEAD, headAt, 5],
  ];
  for (const [id, fn, turns] of tubes) {
    for (const dir of [1, -1]) {
      const pts = [];
      const ex = [];
      const n = turns * 18;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const s = fn(t);
        const a = dir * t * turns * Math.PI * 2 + (dir > 0 ? 0 : 1.3);
        pts.push([Math.cos(a) * s.rx, s.y, s.z + Math.sin(a) * s.rz]);
        ex.push({ wing: [0, 0], part: [id, t, (a / (Math.PI * 2)) % 1, -1] });
      }
      bag.add(pts, { kind: 6, radius: (dir > 0 ? 0.034 : 0.024) * MM, rand: rnd(), extra: (i) => ex[i] });
      if (id === PART.HEAD) break;
    }
  }
  const ids = { thorax: PART.THORAX, abdomen: PART.ABDOMEN, head: PART.HEAD, antenna: PART.ANTENNA, palp: PART.PALP, tongue: PART.TONGUE, leg: PART.LEG, brush: PART.LEG };
  for (const c of bodyCurves(14)) {
    const n = c.points.length;
    if (c.rings) {
      for (const [ax, sign] of [[0, 1], [0, -1], [2, 1], [2, -1]]) {
        const pts = c.rings.map((s) => (ax === 0 ? [s.rx * sign, s.y, s.z] : [0, s.y, s.z + s.rz * sign]));
        bag.add(pts, { kind: 6, radius: 0.045 * MM, rand: rnd(), extra: (i) => ({ wing: [0, 0], part: [ids[c.part], i / (n - 1), ax === 0 ? (sign > 0 ? 0 : 0.5) : sign > 0 ? 0.25 : 0.75, -1] }) });
      }
    } else {
      const leg = c.part === 'antenna' ? (c.side > 0 ? 10 : 11) : c.part === 'brush' ? -2 : c.leg;
      const along = (i) => (c.part === 'leg' ? [0, 0.1, 0.4, 0.72, 1][i] : i / (n - 1));
      // (an antenna is a single hair, as fine as the kit makes it, thickening into its club; legs are wire)
      const fine = c.part === 'antenna' ? (r) => Math.max(0.02, r * 0.85) : (r) => Math.max(0.028, r * 0.6);
      bag.add(c.points, { kind: 7, radii: c.radius.map((r) => fine(r) * MM), rand: rnd(), extra: (i) => ({ wing: [0, 0], alt: c.alt ? c.alt[i] : c.points[i], part: [ids[c.part], along(i), 0, leg] }) });
    }
  }
  // the club of each antenna: a knot — a few turns of ember thread wound round the end of the hair
  for (const sx of [1, -1]) {
    const path = antennaPath(sx);
    const pts = [];
    const ex = [];
    const turns = 5;
    for (let i = 0; i <= turns * 10; i++) {
      const f = i / (turns * 10);
      const t = CLUB + 0.02 + (0.975 - CLUB) * f;
      const c = path(t);
      const a = f * turns * Math.PI * 2;
      const r = antennaRad(t) * 1.25 + 0.02;
      pts.push([c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r]);
      ex.push({ wing: [0, 0], part: [PART.ANTENNA, t, 0, sx > 0 ? 10 : 11] });
    }
    bag.add(pts, { kind: 8.08, radius: 0.03 * MM, rand: rnd(), extra: (i) => ex[i] });
  }
  // the white spots of the body: each a small ring of the bright thread, lying on the skin
  for (const sp of SPOTS) {
    for (const sx of sp[0] === 0 ? [1] : [1, -1]) {
      const c = [sp[0] * sx, sp[1], sp[2]];
      const nl = Math.hypot(c[0], c[2] - 0.2) || 1;
      const nx = c[0] / nl, nz = (c[2] - 0.2) / nl; // out of the skin
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const u = Math.cos(a) * sp[3] * 0.5, v = Math.sin(a) * sp[3] * 0.5;
        pts.push([c[0] + nz * u + nx * 0.03, c[1] + v, c[2] - nx * u + nz * 0.03]);
      }
      bag.add(pts, { kind: 9, radius: 0.045 * MM, rand: rnd(), extra: () => ({ wing: [0, 0], part: [PART.THORAX, 0.5, 0, -1] }) });
    }
  }
  await ctx.yield();

  const geometry = bag.geometry(ctx);
  const pose = makePose();
  // what it holds is a single strand, under the middle of it: its four feet come in to that (they stand a narrow
  // stance apart on a flat thing; the kit's leg follows its foot)
  FEET.forEach((f, i) => pose.feet[i].set(-Math.sign(f[0]) * (Math.abs(f[0]) - 0.3), 0, -0.4));
  const poseR = makePose();
  const poseF = makePose();
  const uniforms = {
    ...poseUniforms(pose),
    uHero: { value: new THREE.Vector4(1, 1, 1, 1) },
    uHeroB: { value: new THREE.Vector4(0, 1.4, 0.5, 0.6) },
    uHeroC: { value: new THREE.Vector4(1, 0, 0, 0) },
    uUnit: { value: MM },
  };
  const matrix = new THREE.Matrix4();
  const meshes = [0, 1, 2, 3].map((pass) => {
    const m = new THREE.Mesh(geometry, silkMaterial(ctx, shared, 'rig', pass, uniforms));
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    m.matrix = matrix;
    m.matrixWorld = matrix;
    m.matrixWorldAutoUpdate = false;
    return m;
  });

  const attach = new Float32Array(ATTACH_N * 4);
  const attachTex = shared.tAttach.value;
  const position = new THREE.Vector3();
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // the rest attitude: head up, back to the left, seen from its right side
  _m.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0));
  const restQ = new THREE.Quaternion().setFromRotationMatrix(_m);

  return {
    meshes,
    pose,
    uniforms,
    matrix,
    position,
    segments: bag.idx.length / 6,
    /** @param p progress  @param t seconds  @param turn extra yaw the pointer asks for (rad) */
    update(p, t, turn = 0, far = 1) {
      const air = key(K_AIR, p);
      const open = key(K_OPEN, p);
      restPose(poseR, t, 0.37, open);
      const beat = flightPose(poseF, t, key(K_BEAT, p) * (reduced ? 0.45 : 1));
      lerpV4(pose.wings, poseR.wings, poseF.wings, air);
      lerpV4(pose.limbs, poseR.limbs, poseF.limbs, air);
      lerpV4(pose.twitch, poseR.twitch, poseF.twitch, air);
      // going back: wings drawn over one another, limbs drawn in
      const short = key(K_SHORT, p);
      pose.shape.set(1, 0.5 * short, 0, 0);

      pathAt(p, position);
      // (as it goes back it lets go of the strand and hangs where the chrysalis will)
      position.x += short * 0.018;
      position.y -= short * 0.004;
      const w = key(K_WANDER, p) * air * (reduced ? 0.4 : 1);
      position.x += (Math.sin(t * 0.83) + 0.5 * Math.sin(t * 1.97 + 1.3)) * 0.022 * w;
      position.y += (Math.sin(t * 0.71 + 2.1) + 0.5 * Math.sin(t * 1.63 + 0.4)) * 0.016 * w + beat.lift * SIZE * 0.5 * air;
      position.z += (Math.cos(t * 0.67 + 0.9) + 0.5 * Math.sin(t * 2.23 + 2.0)) * 0.022 * w;

      const yaw = key(K_YAW, p) * DEG + turn + 0.12 * Math.sin(t * 0.5) * w;
      _h.set(Math.sin(yaw), 0, -Math.cos(yaw));
      flightBasis(_h, key(K_PITCH, p) + beat.pitch * 0.6, key(K_ROLL, p) + 0.1 * Math.sin(t * 0.9 + 1) * w, _R, _F, _U);
      _m.makeBasis(_R, _F, _U);
      _q1.setFromRotationMatrix(_m);
      _q0.copy(restQ).slerp(_q1, air);
      matrix.compose(position, _q0, _one.setScalar(MM));

      const u = uniforms;
      u.uHero.value.set(key(K_WARP, p), key(K_WEFT, p), key(K_BODY, p), key(K_LIMB, p));
      u.uHeroB.value.set(short, key(K_HERO, p) * far, 0.42, 0.7);
      u.uHeroC.value.x = far;

      // where strands are tied to it
      for (let i = 0; i < ATTACH.length; i++) {
        const q = ATTACH[i];
        if (q.length === 4) wingPoint(_a, q[0], q[1], q[2], q[3], pose);
        else _a.set(q[0], q[1], q[2]);
        _a.applyMatrix4(matrix);
        attach[i * 4] = _a.x;
        attach[i * 4 + 1] = _a.y;
        attach[i * 4 + 2] = _a.z;
        attach[i * 4 + 3] = 1;
      }
      attachTex.image.data.set(attach);
      attachTex.needsUpdate = true;
      return clamp(air, 0, 1);
    },
  };
}

export function makeAttachTexture(ctx) {
  const tex = new THREE.DataTexture(new Float32Array(ATTACH_N * 4), ATTACH_N, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return ctx.track(tex);
}
export { bodyMatrix };

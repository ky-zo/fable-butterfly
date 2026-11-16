// The five uses of the butterfly kit, each as small as it can be made. These functions are the examples printed in
// docs/BUTTERFLY.md: change one, change the other. Each returns { update(t, dt, camera, size, progress) } and puts what
// it makes at `at` (a THREE.Vector3 the board moves when the frame's shape changes).
//
// Here the animals are pinned to a board like specimens: right = +X, head = +Y, back toward the lens = +Z.

import * as THREE from 'three';
import {
  standardLight, flightPose, restPose, emergePose, flightBasis, flap, makePose, poseUniforms, bodyMatrix, wingPoint, wingOutline, wingCells,
  samplePoints, threadLines, pointVertexGLSL, wingVertexGLSL, bodyVertexGLSL, shadowUniforms, shadowGLSL, setShadow,
} from '../../shared/butterfly/index.js';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------- 1 · realistic hero
// The animal in its own materials, lit by a rig; its shadow on a surface of ours; its mirror image.
export function realisticHero(ctx, kit, scene, light, at, shadow) {
  const gw = kit.glasswing({ light }); // detail 'high', mode 'blend': draw it after the opaque scene
  scene.add(gw.group);
  // a mirror image is a second animal that shares the first one's pose, placed with reflected axes
  const dim = standardLight();
  dim.sunColor.copy(light.sunColor).multiplyScalar(0.35);
  dim.sky.copy(light.sky).multiplyScalar(0.35);
  dim.ground.copy(light.ground).multiplyScalar(0.35);
  dim.sunDir.copy(light.sunDir);
  const twin = kit.glasswing({ light: dim, detail: 'mid', pose: gw.pose });
  scene.add(twin.group);
  const down = new THREE.Vector3(0, -1, 0);
  return {
    gw,
    twin,
    update(t, dt, camera, size) {
      const beat = flightPose(gw.pose, t); // wings, legs, abdomen for time t; returns lift (m) and pitch (rad)
      _p.copy(at).addScaledVector(Y, 0.014 + beat.lift).addScaledVector(Z, 0.004);
      gw.place(_p, X, Y, Z, 1);
      gw.setSize(size.width, size.height);
      gw.sort(camera);
      setShadow(shadow, gw, 1, dt); // the board's material reads these uniforms (shadowGLSL)
      _p.y = at.y - 0.03 - (_p.y - at.y - 0.012) * 0.5;
      twin.place(_p, X, down, Z, 0.5);
      twin.setSize(size.width, size.height);
      twin.sort(camera);
    },
  };
}

// ------------------------------------------------------------------------------- 2 · your own material + the rig chunk
// The kit's meshes, a material of our own. The vertex shader includes the rig preamble and asks it where the vertex is.
export function ownMaterial(ctx, kit, scene, at) {
  const pose = makePose();
  const uniforms = { ...poseUniforms(pose), uTime: { value: 0 } };
  const wingMat = ctx.track(
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        ${wingVertexGLSL}
        varying vec3 vN; varying vec3 vWorld; varying vec3 vEdge;
        void main(){
          vec3 b, tx, ty;
          bfWingFrame(b, tx, ty);                       // this vertex in the body frame (mm) + the sheet's two tangents
          vec4 wp = bfModel() * vec4(b, 1.0);
          vN = normalize(mat3(bfModel()) * cross(tx, ty));
          vWorld = wp.xyz; vEdge = aEdge;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vN; varying vec3 vWorld; varying vec3 vEdge;
        void main(){
          if (vEdge.x < 0.0) discard;                   // the skirt outside the margin
          vec3 N = normalize(vN), V = normalize(cameraPosition - vWorld);
          vec3 R = reflect(-V, N * sign(dot(N, V)));
          // quicksilver: a bright sky above, a dark floor below, one window
          vec3 c = mix(vec3(0.03, 0.035, 0.04), vec3(0.75, 0.8, 0.85), smoothstep(-0.3, 0.5, R.y));
          c += vec3(2.2, 2.0, 1.7) * smoothstep(0.93, 0.97, dot(R, normalize(vec3(-0.4, 0.5, 0.75))));
          c *= mix(0.55, 1.0, smoothstep(0.0, vEdge.y, vEdge.x));          // darker along the border band
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  const bodyMat = ctx.track(
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        ${bodyVertexGLSL}
        varying vec3 vN; varying vec3 vWorld;
        void main(){
          vec4 wp = bfModel() * vec4(bfBody(), 1.0);    // this vertex in the body frame (mm), posed
          vN = normalize(mat3(bfModel()) * normal); vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vN; varying vec3 vWorld;
        void main(){
          vec3 R = reflect(normalize(vWorld - cameraPosition), normalize(vN));
          gl_FragColor = vec4(mix(vec3(0.03, 0.035, 0.04), vec3(0.75, 0.8, 0.85), smoothstep(-0.3, 0.5, R.y)), 1.0);
        }`,
    }),
  );
  // wings that are to crumple need rings to crumple along: build a dense pair (14 rings instead of 5)
  const dense = kit.buildWings({ spokes: 96, rings: 14 });
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  for (const hind of [0, 1]) {
    group.add(new THREE.Mesh(dense[hind].geometry, wingMat)); // right
    group.add(new THREE.Mesh(kit.mirror(dense[hind], hind), wingMat)); // left: same buffers, aWing.x = -1
  }
  group.add(new THREE.Mesh(kit.parts('mid').body, bodyMat));
  for (const m of group.children) m.frustumCulled = false; // (positions are wing-frame millimetres: the bounds mean nothing)

  // the CPU twin of the rig: the margin of each wing worked out in JavaScript, drawn as dots. They must sit on the mesh.
  const margins = [wingOutline(0, 28), wingOutline(1, 28)];
  const dots = new Float32Array(4 * 28 * 3);
  const dotGeo = ctx.track(new THREE.BufferGeometry());
  dotGeo.setAttribute('position', new THREE.BufferAttribute(dots, 3));
  const dotMesh = new THREE.Points(dotGeo, ctx.track(new THREE.PointsMaterial({ color: 0xff5a2a, size: 3.5, sizeAttenuation: false })));
  dotMesh.frustumCulled = false;
  group.add(dotMesh);
  scene.add(group);
  return {
    pose,
    dense,
    update(t, dt, camera, size, progress) {
      // hatching: progress scrubs it; left alone it loops
      const u = progress > 0.001 ? progress : 0.5 - 0.5 * Math.cos(t * 0.5);
      emergePose(pose, u, t);
      pose.wings.x = pose.wings.y = 0.35; // (spread on the board, so that the crumpling can be seen from above)
      bodyMatrix(group.matrix, _p.copy(at).addScaledVector(Z, 0.004), X, Y, Z, 1);
      group.matrixWorldNeedsUpdate = true;
      let k = 0;
      for (const hind of [0, 1])
        for (const side of [1, -1])
          for (const [x, y] of margins[hind]) {
            wingPoint(_p, x, y, side, hind, pose);
            dots[k++] = _p.x;
            dots[k++] = _p.y;
            dots[k++] = _p.z + 0.15;
          }
      dotGeo.attributes.position.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------------------------------------ 3 · point cloud
// Thousands of points sampled on veins, border, membrane and body; they follow the same rig on the GPU.
export async function pointCloud(ctx, kit, scene, at) {
  const cells = [await wingCells(0, { pause: () => ctx.yield() }), await wingCells(1, { pause: () => ctx.yield() })];
  const geo = ctx.track(await samplePoints(14000, { rnd: ctx.rng(11), cells, pause: () => ctx.yield() }));
  const pose = makePose();
  const mat = ctx.track(
    new THREE.ShaderMaterial({
      uniforms: { ...poseUniforms(pose), uSize: { value: 2 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        ${pointVertexGLSL}
        attribute float aCell;
        uniform float uSize;
        varying vec3 vCol;
        void main(){
          vec4 wp = modelMatrix * vec4(bfPoint(), 1.0);       // this point in the body frame (mm), posed
          vec3 vein = vec3(1.0, 0.82, 0.55), border = vec3(1.0, 0.45, 0.2), body = vec3(0.6, 0.75, 1.0);
          // membrane: each clear cell of the wing its own tint
          vec3 membrane = 0.35 + 0.3 * cos(6.2832 * (aCell * 0.131 + vec3(0.0, 0.33, 0.67)));
          vCol = (vein * aKind.x + border * aKind.y + membrane * aKind.z * 0.6 + body * aKind.w) * (0.35 + 0.65 * aRand);
          gl_Position = projectionMatrix * viewMatrix * wp;
          gl_PointSize = uSize * (0.6 + aRand);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vCol;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vCol * smoothstep(0.5, 0.1, d), 1.0);
        }`,
    }),
  );
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.matrixAutoUpdate = false;
  scene.add(pts);
  return {
    points: pts,
    update(t, dt, camera, size) {
      const beat = flightPose(pose, t + 0.7);
      bodyMatrix(pts.matrix, _p.copy(at).addScaledVector(Y, beat.lift).addScaledVector(Z, 0.004), X, Y, Z, 1);
      pts.matrixWorldNeedsUpdate = true;
      mat.uniforms.uSize.value = 2.2 * (size.height / 1080);
    },
  };
}

// ---------------------------------------------------------------------------------------------------- 4 · threads
// Every vein, both margins and the body's curves as line segments (aLine = id, mm along, length): strands to lay.
export function threads(ctx, kit, scene, at) {
  const geo = ctx.track(threadLines({ rnd: ctx.rng(12) }));
  const pose = makePose();
  const mat = ctx.track(
    new THREE.ShaderMaterial({
      uniforms: { ...poseUniforms(pose), uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        ${pointVertexGLSL}
        attribute vec3 aLine;                                 // which line, millimetres along it, its whole length
        varying vec3 vLine; varying vec4 vKind; varying float vRand;
        void main(){
          vLine = aLine; vKind = aKind; vRand = aRand;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(bfPoint(), 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime;
        varying vec3 vLine; varying vec4 vKind; varying float vRand;
        void main(){
          // each strand is drawn from its root to its tip, over and over, each at its own pace
          float grown = fract(uTime * (0.08 + 0.05 * vRand) + vRand) * 1.6;
          if (vLine.y / vLine.z > grown) discard;
          vec3 c = mix(vec3(0.95, 0.9, 0.8), vec3(1.0, 0.6, 0.3), vKind.y);    // veins pale, margins amber
          c = mix(c, vec3(0.6, 0.72, 0.9), vKind.w);                           // body cool
          float head = smoothstep(0.08, 0.0, grown - vLine.y / vLine.z);       // the travelling end is brighter
          gl_FragColor = vec4(c * (0.55 + 1.6 * head), 1.0);
        }`,
    }),
  );
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.matrixAutoUpdate = false;
  scene.add(lines);
  return {
    mesh: lines,
    update(t) {
      restPose(pose, t, 0.2);
      pose.wings.x = 0.25 + 0.2 * Math.sin(t * 0.8); // (basking: opened flat against the board)
      pose.wings.y = pose.wings.x - 0.05;
      mat.uniforms.uTime.value = t;
      bodyMatrix(lines.matrix, _p.copy(at).addScaledVector(Z, 0.004), X, Y, Z, 1);
      lines.matrixWorldNeedsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------------------------------------------ 5 · flock
// Many small ones in two instanced draws.
export function flockOf(ctx, kit, scene, light, at, count = 14) {
  const flock = kit.flock(count, { light });
  scene.add(flock.group);
  const rnd = ctx.rng(13);
  const who = Array.from({ length: count }, (_, i) => ({ seed: rnd(), r: 0.008 + 0.014 * rnd(), w: (0.5 + rnd()) * (rnd() < 0.5 ? -1 : 1), z: 0.004 + 0.02 * rnd(), species: i % 5 === 3 ? 1 : i % 7 === 5 ? 2 : 0 }));
  who.forEach((b, i) => flock.look(i, b.species, 0, b.seed));
  const R = new THREE.Vector3();
  const F = new THREE.Vector3();
  const U = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const wing = { fore: 0, hind: 0, flex: 0, env: 0 };
  return {
    flock,
    update(t) {
      who.forEach((b, i) => {
        const a = b.seed * 40 + t * b.w;
        _p.set(at.x + Math.cos(a) * b.r * 1.4, at.y + Math.sin(a * 1.3 + b.seed) * b.r, at.z + b.z + 0.012 * Math.sin(a));
        heading.set(-Math.sin(a) * Math.sign(b.w), 0, Math.cos(a) * 0.5 * Math.sign(b.w)).normalize();
        flightBasis(heading, 0.45, 0, R, F, U); // nose up 0.45 rad, like every butterfly in flight
        flap(t, b.seed, b.species === 1 ? 5.5 : 7.5, wing);
        flock.set(i, _p, R, F, U, [0.3, 0.4, 0.25][b.species], wing.fore, wing.hind, wing.flex);
      });
      flock.commit();
    },
  };
}

// ============================================================================================== the board itself
const CW = 0.08; // a cell of the board (m)
const CH = 0.1;
const LABELS = [
  '1 realistic · shadow · mirror', '2 own material + rig · CPU twin', '3 points', '4 threads', '5 flock',
  'unfurl 0.05', 'unfurl 0.35', 'unfurl 0.65', 'unfurl 1.0', "detail 'mid' · 'low', point light",
  'at rest · lit from behind', 'a dim key: moonlight', 'a lamp and nothing else', "mode 'cutout'", '120 px · 80 px across',
];
const BACK = new THREE.Vector3(0, 0, -1);

function label(ctx, text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 40;
  const g = c.getContext('2d');
  g.fillStyle = '#c9c4b8';
  g.font = '500 22px "Geist Mono Variable", ui-monospace, monospace';
  g.textAlign = 'center';
  g.fillText(text, 256, 27);
  const tex = ctx.track(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(ctx.track(new THREE.PlaneGeometry(0.082, 0.0064)), ctx.track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })));
  m.renderOrder = -5;
  return m;
}

/** Everything on the board. Returns { update(frame, camera, wide) }. */
export async function buildBoard(ctx, kit, scene) {
  try {
    await document.fonts.load('500 22px "Geist Mono Variable"');
  } catch {}
  const light = standardLight({ points: 1 });
  light.sunDir.set(-0.45, 0.55, 0.7).normalize();
  light.sunColor.set(4.4, 3.9, 3.1);
  light.sky.set(0.34, 0.4, 0.5);
  light.ground.set(0.16, 0.15, 0.13);

  // the board: a neutral ground that takes the first animal's shadow
  const shadow = shadowUniforms();
  shadow.tShade.value = kit.atlas.shade;
  const board = new THREE.Mesh(
    ctx.track(new THREE.PlaneGeometry(2, 2)),
    ctx.track(
      new THREE.ShaderMaterial({
        uniforms: { ...shadow, uSun: light.uniforms.uBfSunDir, uWide: { value: 1 } },
        vertexShader: 'varying vec3 vWorld; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform vec3 uSun;
          uniform float uWide;
          varying vec3 vWorld;
          ${shadowGLSL('uSun')}
          void main(){
            float lit = bfShadow(vWorld);                 // 1 = the light reaches this point past the butterfly
            vec2 g = abs(fract(vWorld.xy / vec2(${CW.toFixed(3)}, ${CH.toFixed(3)}) + 0.5) - 0.5);    // (an odd number of cells each way)
            float line = smoothstep(0.494, 0.499, max(g.x, g.y));
            gl_FragColor = vec4(vec3(0.115, 0.112, 0.105) * (0.4 + 0.6 * lit) * (1.0 - 0.35 * line), 1.0);
          }`,
      }),
    ),
  );
  board.position.z = -0.012;
  scene.add(board);

  const at = LABELS.map(() => new THREE.Vector3());
  const labels = LABELS.map((t) => label(ctx, t));
  for (const l of labels) scene.add(l);

  const hero = realisticHero(ctx, kit, scene, light, at[0], shadow);
  await ctx.yield();
  const own = ownMaterial(ctx, kit, scene, at[1]);
  await ctx.yield();
  const cloud = await pointCloud(ctx, kit, scene, at[2]);
  const thread = threads(ctx, kit, scene, at[3]);
  await ctx.yield();
  const many = flockOf(ctx, kit, scene, light, at[4]);

  // bottom row: hatching in the realistic materials (dense wings), and the two cheaper detail levels by a lamp
  const stages = [0.05, 0.35, 0.65, 1].map((u) => {
    const gw = kit.glasswing({ light, detail: 'mid', wings: own.dense, seed: 0.2 + u });
    scene.add(gw.group);
    return { gw, u };
  });
  const mid = kit.glasswing({ light, detail: 'mid' });
  const low = kit.glasswing({ light, detail: 'low' });
  scene.add(mid.group, low.group);
  light.points[0].color.set(9, 4.2, 1.2);
  light.points[0].reach = 0.12;

  // third row: what the realistic animal must do under any light, and at any size
  // · at rest, wings up, seen from the side with the light behind it: the border is stained glass, the film takes colour
  const behind = standardLight();
  behind.sunDir.set(-0.55, 0.3, -0.78).normalize();
  behind.sunColor.set(5.5, 4.6, 3.4);
  behind.sky.set(0.52, 0.5, 0.45);
  behind.ground.set(0.2, 0.19, 0.17);
  const resting = kit.glasswing({ light: behind, seed: 0.52 });
  // · a dim key and almost no sky (a moon): it must not be a black shape
  const moon = standardLight();
  moon.sunDir.set(-0.4, 0.5, 0.77).normalize();
  moon.sunColor.set(0.42, 0.5, 0.66);
  moon.sky.set(0.02, 0.028, 0.045);
  moon.ground.set(0.006, 0.007, 0.008);
  const byMoon = kit.glasswing({ light: moon, detail: 'mid', seed: 0.61 });
  // · no key at all: one warm lamp
  const lamp = standardLight({ points: 1 });
  lamp.sunColor.set(0, 0, 0);
  lamp.sky.set(0.012, 0.014, 0.02);
  lamp.ground.set(0.004, 0.004, 0.004);
  lamp.points[0].color.set(7, 3.4, 1.1);
  lamp.points[0].reach = 0.14;
  const byLamp = kit.glasswing({ light: lamp, detail: 'mid', seed: 0.33 });
  // · drawn into an opaque scene (alpha-tested, the film's sheen over it)
  const cut = kit.glasswing({ light, detail: 'mid', mode: 'cutout', seed: 0.44 });
  // · as small as it is on a phone
  const small = [kit.glasswing({ light, detail: 'low', seed: 0.7 }), kit.glasswing({ light, detail: 'low', seed: 0.8 })];
  for (const g of [resting, byMoon, byLamp, cut, ...small]) scene.add(g.group);
  // (night behind the two that are lit like night)
  const night = [11, 12].map(() => {
    const m = new THREE.Mesh(ctx.track(new THREE.PlaneGeometry(CW * 0.96, CH * 0.84)), ctx.track(new THREE.MeshBasicMaterial({ color: 0x030405 })));
    m.renderOrder = -6;
    scene.add(m);
    return m;
  });

  let laid = null;
  return {
    /** what is on the board, by name (shot.mjs --probe hides them one at a time to see what each costs) */
    groups: { high: [hero.gw.group], mirror: [hero.twin.group], points: [cloud.points], threads: [thread.mesh], flock: [many.flock.group], hatching: stages.map((s) => s.gw.group), mid: [mid.group], low: [low.group], resting: [resting.group], night: [byMoon.group, byLamp.group], cutout: [cut.group], small: small.map((g) => g.group) },
    update(frame, camera, wide) {
      const { time: t, dt, size, progress } = frame;
      if (laid !== wide) {
        laid = wide;
        board.material.uniforms.uWide.value = wide ? 1 : 0;
        at.forEach((v, i) => {
          const col = wide ? i % 5 : Math.floor(i / 5);
          const row = wide ? Math.floor(i / 5) : i % 5;
          v.set((col - (wide ? 2 : 1)) * CW, ((wide ? 1 : 2) - row) * CH + 0.006, 0);
          labels[i].position.set(v.x, v.y - 0.051, -0.011);
          labels[i].scale.setScalar(CW / 0.09);
        });
        night.forEach((m, i) => m.position.set(at[11 + i].x, at[11 + i].y - 0.002, -0.0118));
      }
      hero.update(t, dt, camera, size);
      own.update(t, dt, camera, size, progress);
      cloud.update(t, dt, camera, size);
      thread.update(t);
      many.update(t);
      for (const s of stages) {
        emergePose(s.gw.pose, s.u, t);
        s.gw.pose.wings.x = s.gw.pose.wings.y = 0.35; // (spread on the board, so that the wings can be compared)
        s.gw.place(_p.copy(at[5 + stages.indexOf(s)]).addScaledVector(Z, 0.004), X, Y, Z, 1);
        s.gw.setSize(size.width, size.height);
        s.gw.sort(camera);
      }
      const c = at[9];
      restPose(mid.pose, t, 0.6);
      restPose(low.pose, t, 0.8);
      mid.pose.wings.set(0.4, 0.35, 0, 0);
      low.pose.wings.set(0.4, 0.35, 0, 0);
      mid.place(_p.set(c.x - 0.02, c.y + 0.004, 0.004), X, Y, Z, 0.55);
      low.place(_p.set(c.x + 0.022, c.y - 0.012, 0.004), X, Y, Z, 0.4);
      for (const g of [mid, low]) {
        g.setSize(size.width, size.height);
        g.sort(camera);
      }
      light.points[0].position.set(c.x + 0.005, c.y + 0.02 + 0.004 * Math.sin(t), 0.03);
      light.update();

      // at rest, side-on: its back to the right, its left side to the lens
      restPose(resting.pose, t, 0.1);
      resting.place(_p.copy(at[10]).add(_q.set(-0.02, -0.012, 0.008)), BACK, Y, X, 1.25);
      // basking, flat to the board
      for (const [g, k, seed] of [[byMoon, 11, 0.3], [byLamp, 12, 0.5], [cut, 13, 0.7]]) {
        restPose(g.pose, t, seed);
        g.pose.wings.set(0.34 + 0.1 * Math.sin(t * 0.7 + k), 0.3 + 0.1 * Math.sin(t * 0.7 + k), 0, 0);
        g.place(_p.copy(at[k]).addScaledVector(Z, 0.004), X, Y, Z, 1);
      }
      lamp.points[0].position.set(at[12].x + 0.012, at[12].y + 0.016 + 0.004 * Math.sin(t * 0.8), 0.028);
      lamp.update();
      // 120 and 80 pixels from wingtip to wingtip, whatever the frame (a spread glasswing is 59 mm across)
      const pxPerM = size.height / (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z);
      small.forEach((g, i) => {
        flightPose(g.pose, t + i * 0.7, 0.6);
        g.pose.wings.x = Math.max(0.1, g.pose.wings.x * 0.5);
        g.pose.wings.y = g.pose.wings.x - 0.06;
        g.place(_p.copy(at[14]).add(_q.set(i ? 0.018 : -0.014, i ? -0.014 : 0.01, 0.004)), X, Y, Z, [120, 80][i] / (0.059 * pxPerM));
      });
      for (const g of [resting, byMoon, byLamp, cut, ...small]) {
        g.setSize(size.width, size.height);
        g.sort(camera);
      }
    },
  };
}

// Reference world. Small on purpose: it exists to show the contract every world follows.
// Read docs/WORLD_GUIDE.md alongside this file.

import * as THREE from 'three';
import { Rail } from '../../core/Rail.js';
import { FSPass } from '../../core/Pass.js';
import { hash, noise, fbm, color } from '../../core/glsl.js';
import { band, damp } from '../../core/util.js';
import { midi } from '../../core/Audio.js';

export const meta = {
  duration: 60, // seconds for an idle drift from progress 0 → 1
  scroll: 6500, // wheel pixels for the same distance
  hint: 'Move the cursor',
  captions: [
    { from: 0.04, to: 0.3, text: 'A placeholder world. It only proves the plumbing works.' },
    { from: 0.55, to: 0.9, text: 'Depth of field, bloom, grading and grain all come from the shared lens.' },
  ],
};

export default class TemplateWorld {
  constructor(ctx) {
    this.ctx = ctx;
    // Live post settings. The core reads this object every frame; mutate it freely in update().
    this.post = {
      dof: { focus: 6, aperture: 2.2, maxBlur: 14 },
      bloom: { strength: 0.6, radius: 0.82, threshold: 1.0, knee: 0.7 },
      exposure: 1.0,
      contrast: 1.04,
      saturation: 1.0,
      vignette: 0.32,
      grain: 0.035,
    };
  }

  async init() {
    const { ctx } = this;
    const rnd = ctx.rng(7);

    // The world's final image goes into a target it owns. depth:true gives it a depthTexture (needed for core DOF);
    // samples:4 = MSAA on geometry edges.
    this.target = ctx.createTarget({ depth: true, samples: 4 });

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x030405);
    scene.fog = new THREE.FogExp2(0x030405, 0.045);
    this.camera = new THREE.PerspectiveCamera(40, ctx.size.aspect, 0.1, 80);

    const floor = new THREE.Mesh(
      ctx.track(new THREE.PlaneGeometry(60, 60)),
      ctx.track(new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.35, metalness: 0.6 })),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // a few hundred instanced slabs
    const N = 420;
    const geo = ctx.track(new THREE.BoxGeometry(0.16, 1, 0.16));
    const mat = ctx.track(new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.5, metalness: 0.2 }));
    const slabs = (this.slabs = new THREE.InstancedMesh(geo, mat, N));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 2.2 + Math.pow(rnd(), 0.7) * 11;
      const h = 0.3 + Math.pow(rnd(), 3) * 4.5;
      p.set(Math.cos(a) * r, h / 2, Math.sin(a) * r - 4);
      s.set(1 + rnd() * 1.5, h, 1 + rnd() * 1.5);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * Math.PI);
      slabs.setMatrixAt(i, m.compose(p, q, s));
    }
    scene.add(slabs);

    // emissive orbs: values above 1.0 are HDR and feed the bloom
    this.orbs = [];
    const orbGeo = ctx.track(new THREE.IcosahedronGeometry(0.22, 5));
    const hues = [0.08, 0.55, 0.62, 0.02, 0.48];
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Color().setHSL(hues[i], 0.75, 0.55);
      const orbMat = ctx.track(new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(6) }));
      const orb = new THREE.Mesh(orbGeo, orbMat);
      const light = new THREE.PointLight(c, 14, 9, 2);
      orb.add(light);
      orb.userData = { a: (i / 5) * Math.PI * 2, r: 1.4 + i * 0.5, y: 0.9 + rnd() * 1.6, w: 0.12 + rnd() * 0.12 };
      scene.add(orb);
      this.orbs.push(orb);
    }
    scene.add(new THREE.HemisphereLight(0x25324a, 0x050505, 0.6));

    // a fullscreen pass layered on top of the 3D render: soft procedural haze (shows FSPass + shared GLSL chunks)
    this.haze = new FSPass(
      /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime, uAmount;
      uniform vec2 uPointer;
      ${hash}
      ${noise}
      ${fbm}
      ${color}
      void main(){
        vec2 p = vUv * vec2(2.4, 1.4);
        float n = fbm(vec3(p * 1.6, uTime * 0.05), 4);
        float d = smoothstep(0.55, 0.0, distance(vUv, uPointer));
        vec3 c = vec3(0.10, 0.16, 0.26) * n * n * 0.35 + vec3(0.5, 0.35, 0.2) * d * d * 0.08;
        gl_FragColor = vec4(c * uAmount, 1.0);
      }`,
      { uTime: { value: 0 }, uAmount: { value: 1 }, uPointer: { value: new THREE.Vector2(0.5, 0.5) } },
      { blending: THREE.AdditiveBlending, transparent: true },
    );

    this.rail = new Rail({
      points: [
        [0, 1.5, 11],
        [1.6, 1.3, 6],
        [-1.2, 1.1, 2.4],
        [0.2, 1.6, -0.5],
      ],
      targets: [
        [0, 1.2, 0],
        [0, 1.3, -1],
        [0.4, 1.4, -3],
        [0, 1.8, -6],
      ],
      fov: [38, 36, 42, 50],
      look: { yaw: 0.25, pitch: 0.14 },
      parallax: 0.12,
    });

    this.focus = 6;
    await ctx.yield();
  }

  // frame: { dt, time, progress, velocity, pointer, presence, size, index, still }
  update(frame) {
    const { time, progress, pointer, dt } = frame;
    for (const orb of this.orbs) {
      const u = orb.userData;
      const a = u.a + time * u.w;
      orb.position.set(Math.cos(a) * u.r, u.y + Math.sin(time * 0.4 + u.a) * 0.25, Math.sin(a) * u.r - 4);
    }
    if (this.camera.aspect !== frame.size.aspect) {
      this.camera.aspect = frame.size.aspect;
      this.camera.updateProjectionMatrix();
    }
    this.rail.apply(this.camera, frame);

    // focus pull: follow the distance to the rail's look target
    const want = this.rail.position.distanceTo(this.rail.target);
    this.focus = dt > 0 ? damp(this.focus, want, 2.5, dt) : want;
    this.post.dof.focus = this.focus;
    this.post.exposure = 1.0 + 0.25 * band(progress, 0.6, 0.8, 0.9, 1.0);

    this.haze.uniforms.uTime.value = time;
    this.haze.uniforms.uPointer.value.set(pointer.u, pointer.v);
  }

  // Must return a WebGLRenderTarget holding LINEAR HDR colour (plus depthTexture if core DOF is on).
  render(frame) {
    const r = this.ctx.renderer;
    r.setRenderTarget(this.target);
    r.render(this.scene, this.camera);
    this.haze.render(r, this.target); // additive, on top
    return this.target;
  }

  // Optional. Called once sound is switched on. Use the Bus helpers; keep everything quiet.
  createAudio(bus) {
    const pad = bus.drone({ freqs: [midi(38), midi(45), midi(50)], gain: 0.045, filter: 500 });
    const air = bus.noise({ color: 'pink', gain: 0.012, freq: 900, q: 0.5 });
    const scale = [62, 65, 69, 72, 74, 77];
    bus.every(4, 11, () => bus.bell({ freq: midi(scale[Math.floor(Math.random() * scale.length)]), gain: 0.035, decay: 5, pan: Math.random() * 1.4 - 0.7 }));
    return {
      update: (frame) => {
        pad.filter.frequency.value = 400 + frame.progress * 700;
        air.filter.frequency.value = 700 + Math.abs(frame.velocity) * 30000;
      },
    };
  }

  // Geometries/materials/textures registered with ctx.track() and targets from ctx.createTarget() are disposed for you.
  dispose() {
    this.haze.dispose();
    this.slabs.dispose();
  }
}

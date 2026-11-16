// One whole glasswing in its realistic materials: four wings, a body, its fur. Made by kit.glasswing(options).
//
//   const gw = kit.glasswing({ light });          scene.add(gw.group)
//   restPose(gw.pose, time)                       // or flightPose, emergePose, or set the numbers yourself (rig.js)
//   gw.place(position, right, fwd, up, size)      // the body frame in the world
//   gw.setSize(width, height)                     // pixels of the target it is drawn into (fur is sized in pixels)
//   gw.sort(camera)                               // after place() and after the camera has moved: far wings first
//
// Two ways to draw it (option `mode`):
//   'blend'   (default) premultiplied and blended over whatever is already in the target. Draw it LAST, after the
//             opaque scene. The clear membrane really is clear: you see what was drawn before it. Writes depth.
//   'cutout'  for drawing it INTO an opaque scene (one that is blurred or fogged afterwards as a whole): veins, scales
//             and body alpha-tested, then the membrane's sheen blended over at `sheenOrder`.

import * as THREE from 'three';
import { makeWingMaterial } from './wingMaterial.js';
import { makeBodyMaterial, makeFurMaterial } from './bodyMaterial.js';
import { makePose, poseUniforms, wingFrame, bodyMatrix } from './rig.js';

const SIDES = [
  [1, 0],
  [1, 1],
  [-1, 0],
  [-1, 1],
];
const _o = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _ay = new THREE.Vector3();
const _c = new THREE.Vector3();

export class Glasswing {
  /**
   * @param kit      from createButterflyKit
   * @param o.light  a light rig (light.js). Required.
   * @param o.detail 'high' (a lens can go right up to it: 128-spoke wings, 17 000-triangle body, 9 000 hairs),
   *                 'mid' (64-spoke wings, 900-triangle body, no fur), 'low' (all four wings in one draw, no single
   *                 scales: for one that is small in frame)
   * @param o.mode   'blend' | 'cutout' (see above)
   * @param o.scene  true: what is seen through a wing is drawn out of focus by the wing itself (the lens's own depth
   *                 of field cannot: to it the wing is one sharp surface). Needs uniforms tBfScene (the scene without
   *                 the insect, mipmapped, a = distance from the lens) and uBfLens. Without it: plain transparency.
   * @param o.eyeMap true: the eyes can hold a picture (uniforms tBfEye, uBfEye)
   * @param o.fur    default: only at 'high' in 'blend' mode
   * @param o.wings  [fore, hind] from kit.buildWings(…) to use instead of the detail level's (dense ones that crumple)
   * @param o.seed, o.wear  0..1 which individual this is; how worn its scales are
   * @param o.pose   another Glasswing's pose to share (its mirror image, its double)
   * @param o.species  0 glasswing, 1 an orange longwing, 2 a small white (the same animal, fully scaled)
   * @param o.order  renderOrder of the body; pre-pass +1, fur +5, antennae and legs +6, wings +10…+13 ('blend'); wings +1 ('cutout')
   * @param o.sheenOrder  renderOrder of the membrane's sheen in 'cutout' mode
   * @param o.uniforms  any of the kit's uniforms you would rather own, as shared { value } objects:
   *                 uBfRes, tBfScene, uBfLens, tBfEye, uBfEye, tNoise
   */
  constructor(kit, { light, detail = 'high', mode = 'blend', scene = false, eyeMap = false, fur = null, wings = null, seed = 0.37, wear = 0.6, species = 0, order = 0, sheenOrder = order + 20, pose = null, uniforms = {} } = {}) {
    if (!light) throw new Error('Glasswing: a light rig is required (see light.js: standardLight())');
    const parts = kit.parts(detail);
    const cutout = (this.cutout = mode === 'cutout');
    const low = detail === 'low';
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    /** the pose: wings (fore, hind, twist, flex), shape (unfurl, sweep), limbs, twitch, feet[4] — see rig.js */
    this.pose = pose || makePose();
    this.look = new THREE.Vector4(species, cutout ? 1 : 0, seed, wear);
    /** pixels of the target it is drawn into */
    this.res = new THREE.Vector2(1920, 1080);
    /** scene option: focus distance, aperture, largest blur (px), how far behind itself a wing is tested (world units) */
    this.lens = new THREE.Vector4(1, 0, 0, 0.075);
    const u = (this.uniforms = {
      tVein: { value: kit.atlas.veins },
      tNoise: { value: kit.noise },
      ...poseUniforms(this.pose, this.look),
      uBfRes: { value: this.res },
      tBfScene: { value: null },
      uBfLens: { value: this.lens },
      /** scene option: how much of its disc of taps the pre-pass takes (1 all six … 0.34 two, softer; see wingMaterial.js pass 4) */
      uBfPre: { value: 1 },
      tBfEye: { value: null },
      uBfEye: { value: 0 },
      ...uniforms,
    });
    this.mats = [];
    const mat = (pass) => {
      const m = makeWingMaterial({ pass, lod: low, scene: scene && !cutout, light, uniforms: u });
      this.mats.push(m);
      return m;
    };
    const add = (geo, material, ro) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = ro;
      this.group.add(mesh);
      return mesh;
    };
    this.order = order;
    // (blended over the scene, its antennae and legs are a second draw of the same mesh: soft hairlines, not staircases)
    // (the two share the body's buffers and differ only in their index: see splitBody)
    const split = cutout ? null : kit.split(detail);
    this.body = add(cutout ? parts.body : split.trunk, makeBodyMaterial({ light, eyeMap, limbs: cutout ? null : 'none', uniforms: u }), order);
    this.mats.push(this.body.material);
    this.limbs = null;
    if (!cutout) {
      this.limbs = add(split.limbs, makeBodyMaterial({ light, limbs: 'only', uniforms: u }), order + 6);
      this.mats.push(this.limbs.material);
    }
    // four wings, each its own mesh (so that they can be drawn far to near) — or one mesh at 'low'
    if (low && !wings) this.geos = [parts.four];
    else {
      const w = wings || parts.wings;
      const left = wings ? wings.map((x, hind) => kit.mirror(x, hind)) : parts.left;
      this.geos = SIDES.map(([side, hind]) => (side > 0 ? w[hind].geometry : left[hind]));
    }
    this.pre = null;
    this.fur = null;
    this.sheen = null;
    if (cutout) {
      const opaque = mat(1);
      const sheen = mat(2);
      this.wings = this.geos.map((g) => add(g, opaque, order + 1));
      this.sheen = this.geos.map((g) => add(g, sheen, sheenOrder));
    } else {
      /** what is behind each wing, out of focus (only drawn while the lens is open) */
      if (scene) {
        const pre = mat(4);
        this.pre = this.geos.map((g) => add(g, pre, order + 1));
      }
      const all = mat(0);
      this.wings = this.geos.map((g) => add(g, all, order + 10));
    }
    if (fur ?? (!cutout && detail === 'high')) {
      this.fur = add(kit.parts('high').fur, makeFurMaterial({ light, uniforms: u }), order + 5);
      this.mats.push(this.fur.material);
    }
    this._d = [0, 0, 0, 0];
    kit.ctx.track(this);
  }

  /**
   * @param pos thorax centre   @param right, fwd, up  unit axes of the body (fwd = toward the head, up = out of the back)
   * @param size 1 = life size when the world's unit is a metre (the model is in millimetres: a 59 mm wingspan)
   * A mirror image — its reflection in water — is the same call with pos and the three axes reflected.
   */
  place(pos, right, fwd, up, size = 1) {
    bodyMatrix(this.group.matrix, pos, right, fwd, up, size);
    this.group.matrixWorldNeedsUpdate = true;
  }

  setSize(width, height) {
    this.res.set(width, height);
  }

  /**
   * Far wings first: they are seen through the near ones. Call after place() and after the camera has moved.
   * @param showPre  draw the defocused scene behind the wings this frame? (pass false while the lens is closed)
   */
  sort(camera, showPre = true) {
    if (this.pre) for (const m of this.pre) m.visible = showPre;
    const m = this.group.matrix;
    if (this.fur && camera.isPerspectiveCamera) {
      // (the coat is 8 000 hairs, each with the rig's light worked out at its root: where a hair would be under two
      // pixels long — 5 px to the millimetre, an animal 300 px across — it has faded out, and is not drawn)
      const e = m.elements;
      const c = camera.matrixWorld.elements;
      const dist = Math.hypot(e[12] - c[12], e[13] - c[13], e[14] - c[14]);
      this.fur.visible = (camera.projectionMatrix.elements[5] * 0.5 * this.uniforms.uBfRes.value.y * Math.hypot(e[0], e[1], e[2])) / Math.max(dist, 1e-6) > 5.0;
    }
    if (this.cutout || this.wings.length < 4) return;
    const d = this._d;
    const w = this.pose.wings;
    for (let i = 0; i < 4; i++) {
      const [side, hind] = SIDES[i];
      wingFrame(side, hind, hind ? w.y : w.x, _o, _ax, _ay, this.pose.shape.y);
      _c.copy(_o).addScaledVector(_ax, hind ? 9 : 13).applyMatrix4(m);
      d[i] = _c.distanceToSquared(camera.position);
    }
    for (let i = 0; i < 4; i++) {
      let rank = 0;
      for (let j = 0; j < 4; j++) if (d[j] > d[i] || (d[j] === d[i] && j < i)) rank++;
      this.wings[i].renderOrder = this.order + 10 + rank;
    }
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.mats.length = 0;
  }
}

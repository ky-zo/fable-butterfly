// FLOCK · many small butterflies in two instanced draws (all the wings, all the bodies): a few hundred triangles each,
// no single scales, no fur. Made by kit.flock(count, options). Opaque (alpha-tested), so they sort themselves.
//
//   const flock = kit.flock(40, { light });      scene.add(flock.group)
//   flock.look(i, species, landed, seed)         // once per instance
//   flock.set(i, pos, right, fwd, up, size, fore, hind, flex)   // every frame, for each
//   flock.commit()                               // then once

import * as THREE from 'three';
import { makeWingMaterial } from './wingMaterial.js';
import { makeBodyMaterial } from './bodyMaterial.js';
import { bodyMatrix } from './rig.js';

const _m = new THREE.Matrix4();

export class Flock {
  /**
   * @param kit    from createButterflyKit         @param count  how many
   * @param o.light  a light rig (light.js). Required.
   * @param o.order  renderOrder of both meshes
   */
  constructor(kit, count, { light, order = 0 } = {}) {
    if (!light) throw new Error('Flock: a light rig is required (see light.js: standardLight())');
    const parts = kit.parts('low');
    this.count = count;
    const wg = (this.wingGeo = new THREE.InstancedBufferGeometry());
    for (const k of Object.keys(parts.four.attributes)) wg.setAttribute(k, parts.four.attributes[k]);
    wg.setIndex(parts.four.index);
    this.pose = new Float32Array(count * 4);
    this.looks = new Float32Array(count * 4);
    this.poseAttr = new THREE.InstancedBufferAttribute(this.pose, 4).setUsage(THREE.DynamicDrawUsage);
    this.lookAttr = new THREE.InstancedBufferAttribute(this.looks, 4).setUsage(THREE.DynamicDrawUsage);
    wg.setAttribute('aPose', this.poseAttr);
    wg.setAttribute('aLook', this.lookAttr);
    /** pixels of the target it is drawn into (antennae and legs are kept a pixel wide): setSize() */
    this.res = new THREE.Vector2(1920, 1080);
    const uniforms = { tVein: { value: kit.atlas.veins }, tNoise: { value: kit.noise }, uBfRes: { value: this.res } };
    this.wingMat = makeWingMaterial({ pass: 1, lod: true, light, uniforms });
    this.wings = new THREE.InstancedMesh(wg, this.wingMat, count);
    const bg = (this.bodyGeo = new THREE.InstancedBufferGeometry());
    for (const k of Object.keys(parts.body.attributes)) bg.setAttribute(k, parts.body.attributes[k]);
    bg.setIndex(parts.body.index);
    bg.setAttribute('aLook', this.lookAttr);
    this.bodyMat = makeBodyMaterial({ light, uniforms });
    this.bodies = new THREE.InstancedMesh(bg, this.bodyMat, count);
    this.bodies.instanceMatrix = this.wings.instanceMatrix;
    this.group = new THREE.Group();
    for (const m of [this.wings, this.bodies]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.renderOrder = order;
      this.group.add(m);
    }
    for (let i = 0; i < count; i++) this.look(i, 0, 0, (i * 0.618034) % 1);
    kit.ctx.track(this);
  }

  /**
   * Who instance i is. species: 0 glasswing, 1 orange longwing, 2 small white. landed: 1 = legs down, 0 = tucked
   * (flying). seed 0..1: which individual. wear 0..1.
   */
  look(i, species = 0, landed = 0, seed = 0.5, wear = 0.5) {
    this.looks.set([species, landed, seed, wear], i * 4);
    this.lookAttr.needsUpdate = true;
  }

  /**
   * Where instance i is and how its wings are. pos = thorax centre; right, fwd (toward the head), up (out of the
   * back) = unit axes; size 1 = life size (millimetre model in a metre world); fore, hind = stroke angles (rad,
   * 0 spread flat … 1.5 shut); flex = bend along the span. No allocation.
   */
  set(i, pos, right, fwd, up, size, fore, hind, flex = 0, twist = 0) {
    this.wings.setMatrixAt(i, bodyMatrix(_m, pos, right, fwd, up, size));
    const p = this.pose;
    p[i * 4] = fore;
    p[i * 4 + 1] = hind;
    p[i * 4 + 2] = twist;
    p[i * 4 + 3] = flex;
  }

  /** Pixels of the target the flock is drawn into. Optional: without it 1920 × 1080 is assumed. */
  setSize(width, height) {
    this.res.set(width, height);
  }

  /** Send this frame's set() calls to the GPU. */
  commit() {
    this.wings.instanceMatrix.needsUpdate = true;
    this.poseAttr.needsUpdate = true;
  }

  dispose() {
    this.wingGeo.dispose();
    this.bodyGeo.dispose();
    this.wingMat.dispose();
    this.bodyMat.dispose();
  }
}

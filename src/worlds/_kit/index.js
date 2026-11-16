// KIT SELF-TEST — not a world of the journey and not in the registry. It draws every use of the shared butterfly
// (src/shared/butterfly, docs/BUTTERFLY.md) side by side on a neutral board, so that a change to the kit can be judged
// in one picture:
//     node src/worlds/_kit/shot.mjs --out shots/_kit/kit.png          (see shot.mjs for options)
//
//   top row      1 realistic, flying, with its shadow on the board and its mirror image under it
//                2 the kit's meshes with a material of our own and the rig chunk; dots = the CPU twin of the rig
//                3 the same animal as 14 000 points       4 as threads       5 a flock of small ones
//   middle row   the realistic one hatching (unfurl 0.05, 0.35, 0.65, 1), then detail 'mid' and 'low' by a warm lamp
//   bottom row   the realistic one where it is hardest: at rest with the light behind it, by a moon, by one lamp, in
//                'cutout' mode, and 120 and 80 pixels across
// Progress scrubs the hatching of the second animal; time moves everything else.
// The five examples themselves are in examples.js, and are the code printed in docs/BUTTERFLY.md.

import * as THREE from 'three';
import { createButterflyKit } from '../../shared/butterfly/index.js';
import { buildBoard } from './examples.js';

export const meta = { duration: 30, scroll: 3000, hint: '', captions: [] };

export default class KitTest {
  constructor(ctx) {
    this.ctx = ctx;
    this.post = { dof: null, bloom: { strength: 0.25, radius: 0.7, threshold: 1.6, knee: 0.6 }, exposure: 1, contrast: 1.02, saturation: 1, vignette: 0.1, grain: 0.012, ca: 0 };
    this.camera = new THREE.PerspectiveCamera(24, ctx.size.aspect, 0.05, 10);
  }

  async init() {
    const { ctx } = this;
    this.kit = await createButterflyKit(ctx, { detail: ['high', 'mid', 'low'] });
    this.rt = ctx.createTarget({ depth: true, samples: 4 });
    this.scene = new THREE.Scene();
    this.board = await buildBoard(ctx, this.kit, this.scene);
    await this.kit.compile(this.scene, this.camera);
  }

  update(frame) {
    const { size } = frame;
    const cam = this.camera;
    // 5 × 3 cells in a wide frame, 3 × 5 in an upright one; the lens stands square to the board
    const wide = size.aspect > 1;
    const w = wide ? 0.4 : 0.24;
    const h = wide ? 0.3 : 0.5;
    const tan = Math.tan((cam.fov * Math.PI) / 360);
    cam.aspect = size.aspect;
    cam.position.set(0, 0, Math.max(h / 2 / tan, w / 2 / (tan * size.aspect)));
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.board.update(frame, cam, wide);
  }

  render() {
    const r = this.ctx.renderer;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    return this.rt;
  }
}

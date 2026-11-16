// Bakes the designed height function into float textures and keeps a CPU mirror of it for the camera, the butterfly
// and the pointer ray. Nothing here holds the main thread: shaders are compiled off it, the big draws are cut into
// bands, and the one read-back is asynchronous.

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { HALF, FAR, D_HALF, D_FAR, LAND } from './chunks.js';
import { BASIN, PLATEAU, bakeUniformData, macroFrag, detailFrag, deriveFrag } from './landBake.js';

export class Land {
  constructor(ctx) {
    this.ctx = ctx;
    const lvl = ctx.quality.level;
    this.res = lvl >= 1 ? 2048 : 1024;
    this.farRes = lvl >= 1 ? 1024 : 512;
    this.cpuRes = 512;
    /** Uniforms every consumer of the LAND chunk needs. Share these objects, do not copy them. */
    this.uniforms = {
      tLand: { value: null },
      tLandFar: { value: null },
      uLandInfo: { value: new THREE.Vector4(this.res, 1 / (2 * HALF), this.farRes, 1 / (2 * FAR)) },
    };
  }

  async bake() {
    const { ctx } = this;
    const r = ctx.renderer;
    const data = bakeUniformData();
    const NCH = data.nodes.length, NRG = data.ridges.length, NPIT = data.pits.length;
    const v4 = (a) => a.map((n) => new THREE.Vector4(n[0], n[1], n[2], n[3]));
    const rect = new THREE.Vector4();
    const macro = new FSPass(macroFrag(NCH, NRG, NPIT), {
      uRect: { value: rect },
      uNodes: { value: v4(data.nodes) },
      uRidges: { value: v4(data.ridges) },
      uPits: { value: v4(data.pits) },
      uBasin: { value: new THREE.Vector4(BASIN.x, BASIN.z, BASIN.floor, BASIN.flat) },
      uPlateau: { value: new THREE.Vector4(PLATEAU.x, PLATEAU.z, PLATEAU.h, PLATEAU.r) },
    });
    const detail = new FSPass(detailFrag, {
      tMacro: { value: null },
      uMacroRes: { value: 1 },
      uRect: { value: rect },
      uSS: { value: 1 },
      uTexelW: { value: new THREE.Vector2() },
      uDetail: { value: 1 },
    });
    const derive = new FSPass(deriveFrag, {
      tH: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uTexelWorld: { value: 1 },
      uAoScale: { value: 1 },
    });
    const copy = new FSPass(
      /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      ${LAND}
      void main(){ gl_FragColor = landNear((vUv * 2.0 - 1.0) * HALF); }`,
      { ...this.uniforms },
    );
    for (const p of [macro, detail, derive, copy]) {
      await p.compile(r);
      await ctx.yield();
    }
    const tmpOpts = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false };
    const linOpts = { ...tmpOpts, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const gl = r.getContext();
    // draw a pass in horizontal bands, and let the GPU finish each before the next, so that no single draw is long
    // enough to stall the page (or whoever is on screen while this world loads)
    const banded = async (pass, rt, bands) => {
      rt.scissorTest = true;
      for (let b = 0; b < bands; b++) {
        rt.scissor.set(0, Math.floor((b * rt.height) / bands), rt.width, Math.ceil(rt.height / bands));
        pass.render(r, rt);
        gl.flush();
        await ctx.yield();
      }
      rt.scissorTest = false;
      rt.scissor.set(0, 0, rt.width, rt.height);
    };

    const run = async (res, half, ss, aoScale, detailK) => {
      const out = ctx.createTarget({ size: [res, res], type: THREE.FloatType, mipmaps: true });
      out.texture.anisotropy = 8;
      rect.set(0, 0, half, half);
      // 1. macro relief, half resolution
      const mres = res / 2;
      const mrt = new THREE.WebGLRenderTarget(mres, mres, linOpts);
      await banded(macro, mrt, 16);
      // 2. erosion + roughness
      const tmp = new THREE.WebGLRenderTarget(res, res, linOpts);
      detail.uniforms.tMacro.value = mrt.texture;
      detail.uniforms.uMacroRes.value = mres;
      detail.uniforms.uSS.value = ss;
      detail.uniforms.uTexelW.value.set((2 * half) / res, (2 * half) / res);
      detail.uniforms.uDetail.value = detailK;
      await banded(detail, tmp, 12);
      mrt.dispose();
      // 3. gradient + sky visibility (the mip chain is built once, after the last band)
      derive.uniforms.tH.value = tmp.texture;
      derive.uniforms.uTexel.value.set(1 / res, 1 / res);
      derive.uniforms.uTexelWorld.value = (2 * half) / res;
      derive.uniforms.uAoScale.value = aoScale;
      out.texture.generateMipmaps = false;
      await banded(derive, out, 11);
      out.texture.generateMipmaps = true;
      out.scissorTest = true;
      out.scissor.set(0, 0, res, 1);
      derive.render(r, out);
      out.scissorTest = false;
      out.scissor.set(0, 0, res, res);
      gl.flush();
      await ctx.yield();
      tmp.dispose();
      return out;
    };

    this.near = await run(this.res, D_HALF, 1, 1, 1);
    await ctx.yield();
    this.far = await run(this.farRes, D_FAR, 2, 7, 0.6);
    this.uniforms.tLand.value = this.near.texture;
    this.uniforms.tLandFar.value = this.far.texture;

    // CPU mirror: resample the baked near texture exactly as the shaders see it
    const n = this.cpuRes;
    const small = new THREE.WebGLRenderTarget(n, n, tmpOpts);
    copy.render(r, small);
    gl.flush();
    await ctx.yield();
    this.cpu = new Float32Array(n * n * 4);
    await r.readRenderTargetPixelsAsync(small, 0, 0, n, n, this.cpu);
    r.setRenderTarget(null);
    small.dispose();
    for (const p of [macro, detail, derive, copy]) p.dispose();
  }

  // ---- CPU queries (bilinear on the mirror)

  _fetch(x, z, c) {
    const n = this.cpuRes;
    const fx = Math.min(n - 1.001, Math.max(0, ((x / HALF) * 0.5 + 0.5) * n - 0.5));
    const fz = Math.min(n - 1.001, Math.max(0, ((z / HALF) * 0.5 + 0.5) * n - 0.5));
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const d = this.cpu;
    const i00 = (iz * n + ix) * 4 + c, i10 = i00 + 4, i01 = i00 + n * 4, i11 = i01 + 4;
    return (d[i00] * (1 - tx) + d[i10] * tx) * (1 - tz) + (d[i01] * (1 - tx) + d[i11] * tx) * tz;
  }

  height(x, z) {
    return this._fetch(x, z, 0);
  }

  gradient(x, z, out) {
    out.x = this._fetch(x, z, 1);
    out.y = this._fetch(x, z, 2);
    return out;
  }

  /** March a ray against the land. Returns distance along the ray or -1. */
  raycast(o, d, maxT = 140) {
    let t = 0.02, prevT = 0;
    if (o.y - this.height(o.x, o.z) < 0) return 0;
    for (let i = 0; i < 160 && t < maxT; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (Math.abs(x) > HALF || Math.abs(z) > HALF) return -1;
      const dd = y - this.height(x, z);
      if (dd < 0) {
        let a = prevT, b = t;
        for (let k = 0; k < 8; k++) {
          const m = 0.5 * (a + b);
          if (o.y + d.y * m - this.height(o.x + d.x * m, o.z + d.z * m) < 0) b = m;
          else a = m;
        }
        return 0.5 * (a + b);
      }
      prevT = t;
      t += Math.max(0.04, dd * 0.4);
    }
    return -1;
  }
}

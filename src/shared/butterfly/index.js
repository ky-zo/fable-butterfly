// THE BUTTERFLY KIT · one glasswing (Greta oto), for every world. Read docs/BUTTERFLY.md first.
//
//   const kit = await createButterflyKit(ctx);            // in init(); chunked, disposes with the world
//   kit.glasswing({ light })     the realistic animal     kit.flock(n, { light })   many small ones
//   kit.parts('high'|'mid'|'low')  the meshes, for your own material (rig.js gives the vertex shader its pose)
//   kit.atlas.veins / .shade     vein field and wing opacity, as textures
//   samplePoints(…), threadLines(…), wingOutline(…), wingVeins(…), bodyCurves(…)   the same animal as data
//
// Layers, each usable without the ones after it:
//   data      wingData.js  bodyData.js             numbers and curves, no three.js objects
//   geometry  wingGeo.js   bodyGeo.js  sample.js   meshes, points, lines — any material
//   rig       rig.js       motion.js               one pose model, CPU and GLSL; pose values from time
//   look      light.js  wingMaterial.js  bodyMaterial.js  atlas.js  glasswing.js  flock.js  shadow.js

import { buildWing, mirrorWing, fourWings } from './wingGeo.js';
import { buildBody, buildFur, splitBody } from './bodyGeo.js';
import { bakeWingAtlas } from './atlas.js';
import { makeWingMaterial } from './wingMaterial.js';
import { makeNoiseTexture } from './noise.js';
import { Glasswing } from './glasswing.js';
import { Flock } from './flock.js';

export * from './wingData.js';
export * from './bodyData.js';
export * from './rig.js';
export * from './motion.js';
export { buildWing, mirrorWing, fourWings, sideAttr } from './wingGeo.js';
export { buildBody, buildFur, splitBody } from './bodyGeo.js';
export { samplePoints, threadLines, pointVertexGLSL } from './sample.js';
export { standardLight } from './light.js';
export { makeWingMaterial, pigmentGLSL } from './wingMaterial.js';
export { makeBodyMaterial, makeFurMaterial } from './bodyMaterial.js';
export { atlasGLSL, RG, WIDE } from './atlas.js';
export { shadowUniforms, shadowGLSL, setShadow } from './shadow.js';
export { makeNoiseTexture } from './noise.js';
export { Glasswing, Flock };

/** The three detail levels: points of each wing's margin, which body, fur or not. Costs: docs/BUTTERFLY.md. */
export const DETAIL = {
  high: { spokes: 128, body: 1, fur: true },
  mid: { spokes: 64, body: 0, fur: false },
  low: { spokes: 28, body: 0, fur: false },
};

/**
 * Build the kit. Call once in init() and await it: CPU work is cut into slices with ctx.yield() between them, the two
 * atlas textures are drawn on the GPU (two small draws), and everything made here — and every Glasswing or Flock made
 * from it — is disposed with the world (ctx.track).
 * @param ctx        the world's ctx
 * @param o.detail   levels to build now, in slices: ['high'] by default. Any other level is built on first use
 *                   (kit.parts(level)), in one block of 1–8 ms.
 * @param o.noise    a 256² RGBA tiling noise texture to share (makeNoiseTexture); the kit makes its own otherwise
 * @param o.seed     which individual: the wear on its wing margins, the lie of its fur
 */
export async function createButterflyKit(ctx, { detail = ['high'], noise = null, seed = 31 } = {}) {
  const track = (x) => ctx.track(x);
  const levels = {};
  const kit = {
    ctx,
    noise: noise || track(makeNoiseTexture(256)),
    atlas: null,
    /** [fore, hind] right wings as { geometry, outline, veins, centre } at your own resolution (see buildWing). */
    buildWings(opts = {}, wingSeed = seed) {
      const w = [buildWing(false, { ...opts, rnd: ctx.rng(wingSeed) }), buildWing(true, { ...opts, rnd: ctx.rng(wingSeed + 1) })];
      for (const x of w) track(x.geometry);
      return w;
    },
    /** The left twin of a right wing (shares its buffers). */
    mirror: (wing, hind) => track(mirrorWing(wing.geometry, hind)),
    /**
     * The meshes of a detail level: { wings: [fore, hind] (right side; .geometry), left: [fore, hind] geometries,
     * four: all four wings as one geometry, body, fur (high only) }. Cached; built on first use.
     */
    parts(level = 'high') {
      if (levels[level]) return levels[level];
      const d = DETAIL[level];
      if (!d) throw new Error(`butterfly kit: unknown detail '${level}' (high | mid | low)`);
      const wings = level === 'high' ? high : kit.buildWings({ spokes: d.spokes });
      // (mid and low share the one small body)
      const small = levels.mid || levels.low;
      const body = d.body === 0 && small ? small.body : track(buildBody(d.body));
      const fur = d.fur ? track(buildFur(ctx.rng(seed + 2))) : null;
      return (levels[level] = { wings, left: wings.map((w, hind) => kit.mirror(w, hind)), four: track(fourWings(wings)), body, fur });
    },
    /** A level's body as { trunk, limbs }: two geometries over its buffers (see splitBody). Cached; a block of about a millisecond. */
    split(level = 'high') {
      const p = kit.parts(level);
      if (!p.split) {
        p.split = splitBody(p.body);
        track(p.split.trunk);
        track(p.split.limbs);
      }
      return p.split;
    },
    glasswing: (opts) => new Glasswing(kit, opts),
    flock: (count, opts) => new Flock(kit, count, opts),
    /** Compile everything under `object` for `camera` without blocking (await it at the end of init). */
    compile: (object, camera) => ctx.renderer.compileAsync(object, camera),
  };
  // the atlas is drawn from the full-detail wings, so those are always built
  const high = kit.buildWings({ spokes: 128 });
  await ctx.yield();
  kit.atlas = track(bakeWingAtlas(ctx.renderer, high, (hind, veins) => makeWingMaterial({ pass: 3, uniforms: { tVein: { value: veins }, tNoise: { value: kit.noise } } })));
  await ctx.yield();
  for (const level of detail) {
    if (level === 'high') {
      // (the two heavy pieces, each in its own slice)
      const p = (levels.high = { wings: high, left: high.map((w, hind) => kit.mirror(w, hind)), four: track(fourWings(high)), body: null, fur: null });
      await ctx.yield();
      p.body = track(buildBody(1));
      await ctx.yield();
      p.fur = track(buildFur(ctx.rng(seed + 2)));
    } else kit.parts(level);
    await ctx.yield();
  }
  return kit;
}

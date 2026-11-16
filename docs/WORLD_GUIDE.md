# Hidden Layers — world builder guide

Hidden Layers is a collection of six small 3D worlds ("layers") about one glasswing butterfly, each world one layer
deeper into it (the story is in `docs/ARC.md`; the titles keep their double meaning, the captions never explain it).
The visitor scrolls through one world on a camera path that is a pure function of progress, then the next world
denoises into view. A shared
engine (the "core") owns the renderer, input, the journey, the lens (DOF, bloom, tonemap, grade, grain) and the
transitions. **A world owns everything inside its own folder and nothing else.**

Stack: three.js r187 (WebGL2), Vite, plain ES modules, no framework. Everything is procedural: no downloaded
models, textures, HDRIs or audio files, no network requests, no new npm dependencies.

Reference implementation of everything below: `src/worlds/_template/index.js` (read it first, it is short).
The story contract for every world is `docs/ARC.md`; the butterfly itself is `docs/BUTTERFLY.md`. (`docs/briefs/` holds the
original briefs from before the butterfly and is kept only as history.) Most worlds no longer use `Rail`: they key the
camera in a `shots.js` or `story.js` as a pure function of progress, which is the pattern to copy.

---

## 1. The contract

A world is `src/worlds/<id>/index.js` (split into as many sibling files as you like) with:

```js
export const meta = {
  duration: 75,        // seconds an idle auto-drift takes to go progress 0 → 1
  scroll: 7000,        // wheel pixels for the same distance
  hint: 'Wipe the glass',                       // shown bottom-right for the first seconds
  captions: [{ from: 0.05, to: 0.22, text: '…' }, …],   // one short line at a time, by progress range
};

export default class MyWorld {
  constructor(ctx) {}          // cheap. keep ctx.
  async init() {}              // build everything. `await ctx.yield()` between heavy chunks so the page stays alive
  update(frame) {}             // advance simulation + camera
  render(frame) { return rt; } // draw. MUST return a THREE.WebGLRenderTarget holding LINEAR HDR colour
  post = { … };                // lens settings, read by the core every frame (see §3). Mutate freely.
  camera;                      // the PerspectiveCamera you render with (the core needs near/far for DOF)
  resize(size) {}              // optional. targets made with ctx.createTarget resize themselves
  createAudio(bus, engine) {}  // optional. see §6
  dispose() {}                 // free what ctx.track()/ctx.createTarget() doesn't already cover
}
```

### `ctx` (constructor argument)

| field | what |
| --- | --- |
| `ctx.renderer` | the shared `THREE.WebGLRenderer`. `toneMapping` is `NoToneMapping`; render targets receive linear values. |
| `ctx.size` | live object `{ width, height, cssWidth, cssHeight, dpr, aspect }` in drawing-buffer pixels. Changes over time (adaptive resolution!). |
| `ctx.quality` | `{ tier: 'low'|'medium'|'high', level: 0|1|2, mobile }`. Scale particle counts, taps, resolution with `level`. |
| `ctx.createTarget(opts)` | auto-resized render target, disposed with the world. opts: `scale` (fraction of canvas, default 1), `depth` (attach a `depthTexture`), `samples` (MSAA, 0 or 4), `type` (default `HalfFloatType`; use `FloatType` for simulation state), `format`, `filter` (default Linear; use `NearestFilter` for data), `mipmaps`, `wrap`, `size: [w,h]` (fixed size, not tied to the canvas — simulation textures), `count` (MRT). |
| `ctx.rng(seed)` | deterministic PRNG: `const r = ctx.rng(3); r(); r.range(a,b); r.int(a,b); r.pick(arr); r.gauss(); r.sign()`. **Use this, not `Math.random()`, for anything visual** so screenshots are reproducible. |
| `ctx.track(x)` | register a geometry/material/texture (anything with `.dispose()`) for automatic cleanup; returns `x`. |
| `ctx.yield()` | `await` it to give the browser a breath during long init. |
| `ctx.glsl`, `ctx.util`, `ctx.FSPass`, `ctx.Rail`, `ctx.THREE` | the shared helpers (also importable directly, see §4). |
| `ctx.still` | true when driven by the screenshot tool. |
| `ctx.params` | the page's `URLSearchParams`. |

### `frame` (argument of `update` and `render`)

| field | what |
| --- | --- |
| `frame.dt` | seconds since last frame, clamped to ≤ 0.05. **Can be 0** (prewarm, first screenshot frame): never divide by it unguarded. |
| `frame.time` | seconds this world has been alive (resets to 0 each time the world becomes active). |
| `frame.progress` | 0..1 position along the journey through this world, already smoothed. **Not monotonic** — visitors scroll backwards and jump. Anything keyed to progress must be a pure function of it (or of time), never "fire once when p passes 0.4". |
| `frame.velocity` | d(progress)/dt, smoothed. |
| `frame.pointer` | `{ x, y }` raw NDC (-1..1, +y up), `{ sx, sy }` smoothed (use for camera look), `{ u, v }` 0..1 (matches `vUv` of a fullscreen pass), `{ vx, vy, speed }` NDC/sec, `down`, `idle` (seconds since it last moved), `inside` (false until the visitor first moves; false between touches on phones). |
| `frame.presence` | 0..1 how visible this world is (ramps during transitions). |
| `frame.size` | same object as `ctx.size`. |
| `frame.still` | screenshot mode. |

### Rules of the road

- **Stay in your folder.** Only create/edit files under `src/worlds/<id>/`. Do not touch `src/core`, `src/ui`, other worlds,
  `registry.js`, `package.json`, `vite.config.js`, `index.html` or `tools/`. If the core has a bug or is missing something you
  need, work around it inside your world and report it in your final answer.
- **Two worlds render in the same frame during transitions**, sharing one renderer. Leave renderer state as you found it at the end of
  `render()`: `autoClear`, clear colour/alpha, viewport/scissor, `shadowMap.autoUpdate/needsUpdate/type`, `localClippingEnabled`, `sortObjects`.
  Never call `renderer.setSize`, `setPixelRatio`, `setAnimationLoop`, or render to the screen (`setRenderTarget(null)` + draw).
- **Return linear HDR.** Bright things should exceed 1.0 (emissive 2–20) so the shared bloom has something to work with. Do not tonemap,
  gamma-encode, vignette or add film grain yourself; the lens does it for every world.
- **The visitor may never touch the mouse** (auto-drift is the default). The world must be alive and its signature interaction must
  still be *seen*: when `pointer.inside` is false or `pointer.idle` is more than ~5 s, drive the interaction with a gentle autonomous
  "ghost" (a slow invisible hand), and hand control back the moment the real pointer moves.
- **`init()` runs while the previous world is on screen** (the core preloads the next layer a few seconds after the visitor
  settles into the current one). Every stretch of `init` that holds the main thread for longer than a frame is a visible hitch in
  someone else's world. Split CPU work into slices of a few milliseconds with `await ctx.yield()` between them (generation loops,
  canvas/atlas baking, simulation pre-roll), and precompile shaders off the main thread at the end of init:
  `await ctx.renderer.compileAsync(scene, camera)` for scenes and `await pass.compile(ctx.renderer)` for an `FSPass`.
  Measure with `node tools/shot.mjs <id> --initcost`: no block over ~50 ms, ideally none over ~20 ms.
- Handle `dt === 0`, resize at any time, `dispose()` then re-`init()` of a fresh instance (worlds are unloaded and reloaded as the
  visitor moves around), and `progress` jumping anywhere.
- No `console.log` spam, no `alert`, no DOM outside what you need for canvases used as textures, no global event listeners that
  outlive `dispose()` (use `frame.pointer` instead of your own mouse listeners).

---

## 2. Rendering pipeline

```
world.render(frame) ──► your RT (linear HDR, + depthTexture if you want core DOF)
        core: half-res bokeh DOF (optional) ─► 7-level bloom ─► combine
        core: transition blend with the other world ─► chromatic aberration ─► vignette ─► exposure/white balance
              ─► AgX tonemap ─► sRGB ─► contrast/saturation/lift-gamma-gain ─► grain + dither ─► screen
```

You may run any number of your own passes before returning (prepasses, blurs, simulation, half-res raymarch + upsample …).
The only requirement is the returned target.

Costs measured on the target machine (Apple M2, 1920×1080): core combine+finish ≈ 1.0 ms, bloom ≈ 0.6 ms, core DOF ≈ 1.5 ms,
**`samples: 4` on a full-res HalfFloat target ≈ 1.9 ms** (use MSAA only where geometric edges matter; consider rendering thin geometry
with analytic/shader anti-aliasing instead).

## 3. `post` — the lens

```js
this.post = {
  dof: { focus: 4.0, aperture: 2.0, maxBlur: 14 },  // or null. focus = sharp distance in world units; blur reaches maxBlur (px @1080p)
                                                    // when |d - focus| / d = 1 / aperture. Needs your RT to have depth: true.
  bloom: { strength: 0.45, radius: 0.8, threshold: 0.9, knee: 0.6 },   // threshold in linear HDR units; 0 = everything glows
  exposure: 1.0,
  tonemap: 'agx',          // 'agx' | 'aces' | 'none'
  contrast: 1.0, saturation: 1.0,
  temperature: 0.0, tint: 0.0,            // -1..1
  lift: [0,0,0], gamma: [1,1,1], gain: [1,1,1],   // display-space colour wheels
  vignette: 0.28, grain: 0.035, ca: 0.0012,
};
```

Animate these with progress for focus pulls, exposure breaths, colour shifts. Core DOF reads your depth buffer, so things that do not
write depth (additive particles, alpha-blended sprites, raymarched pixels unless you write `gl_FragDepth`) will be blurred like whatever
is behind them. For particle or line worlds, turn core DOF off (`dof: null`) and do per-sprite bokeh yourself (grow the sprite with its
circle of confusion and divide its brightness by its area) — it looks far better anyway.

## 4. Shared helpers

```js
import * as THREE from 'three';
import { Rail, keyframe } from '../../core/Rail.js';
import { FSPass, FS_VERT } from '../../core/Pass.js';
import { constants, hash, noise, simplex, fbm, curl, voronoi, color, depth, ALL } from '../../core/glsl.js';
import { clamp, lerp, saturate, smoothstep, smootherstep, remap, remapClamped, damp, band, easeInOutCubic, easeOutCubic, easeInOutSine, mulberry32 } from '../../core/util.js';
import { midi } from '../../core/Audio.js';
```

- **`Rail`** — camera on a spline: `new Rail({ points, targets, fov, roll, look: {yaw, pitch}, parallax, sway })`, then
  `rail.apply(camera, frame)` each frame. Key *i* of `points` is reached at progress *i/(n-1)*; `targets` are spread evenly over progress.
  `rail.position` / `rail.target` hold the last sampled values (handy for focus pulls). You are free to drive the camera yourself instead.
- **`FSPass`** — fullscreen shader pass: `new FSPass(fragmentShader, uniforms, materialOpts)`, `pass.render(renderer, targetOrNull)`.
  Fragment shader gets `varying vec2 vUv`.
- **`glsl.js`** — string chunks to interpolate into shaders: `hash` (hash11/12/13/21/22/23/31/32/33, `ign` dither), `noise` (`vnoise` 2D/3D,
  0..1), `simplex` (`snoise` 2D/3D, −1..1), `fbm` (`fbm(p, octaves)`, `ridged`), `curl` (`curlNoise(vec3)`, needs simplex), `voronoi`
  (`voronoi(p)` → F1, F2, id), `color` (`luma`, `toLinear`, `toSRGB`, `palette`, `blackbody(K)`, `spectrum(nm)`, `thinFilm`, `rot2`, `sat`),
  `depth` (`linearDepth(z, near, far)`). They are include-guarded, so order only matters for dependencies (hash → noise → fbm; simplex → curl).
- **`util.js`** — `damp(current, target, rate, dt)` for frame-rate-independent smoothing, `band(x, a, b, c, d)` for progress-gated windows, easings, `mulberry32`.

### three.js r187 notes

- `ShaderMaterial` compiles as GLSL ES 3.00 with compatibility defines: write `varying` / `texture2D` / `gl_FragColor` as usual, and you can
  also use `textureLod`, `texelFetch`, `isnan`, integer ops, `gl_VertexID` / `gl_InstanceID`, `dFdx/fwidth` freely. With `InstancedMesh`,
  `instanceMatrix` is declared for you (`#ifdef USE_INSTANCING`). For per-instance data use `InstancedBufferAttribute`.
- Colour: hex / CSS colours on materials are converted sRGB → linear. Multiply a colour by a scalar > 1 for HDR emissive. Canvas textures that
  hold *colour* need `tex.colorSpace = THREE.SRGBColorSpace`; data textures (SDF, masks, noise, simulation) stay `NoColorSpace`.
- Float render targets (`FloatType`, `HalfFloatType`) are renderable and linearly filterable on the target hardware. MRT: `ctx.createTarget({ count: 2 })` → `rt.textures[i]`,
  written with `layout(location = n) out` under `glslVersion: THREE.GLSL3`.
- `MeshPhysicalMaterial.transmission` triggers a hidden full-scene re-render per frame; do not use it. Write the refraction you need yourself.
- `renderer.shadowMap.enabled` is already true. Shadow maps cost a scene re-render per light; one small well-fitted shadow light is usually enough.
- `GPUComputationRenderer` is at `three/examples/jsm/misc/GPUComputationRenderer.js`; a ping-pong pair of `ctx.createTarget({ size, type: THREE.FloatType, filter: THREE.NearestFilter })` driven by `FSPass` is just as easy and gives you full control.
- Fonts for canvas-rendered glyph atlases: `'Geist Variable'`, `'Geist Mono Variable'`, `'Newsreader Variable'` (upright + italic) are bundled.
  Before drawing: `await document.fonts.load('400 64px "Newsreader Variable"')`.

## 5. Tools — look at your work constantly

A dev server is already running on `http://127.0.0.1:5199` (do not start or stop it; the tools find it, and start a private one if it is gone).
All commands run from the project root.

```bash
# one frame. Writes a PNG and prints renderer stats + every console error/warning from the page (shader compile logs included).
node tools/shot.mjs <id> --p 0.35 --out shots/<id>/a.png
#   --frames 90          frames simulated at 60 fps before capture (default 90; use 300–900 to let simulations settle)
#   --drift 0.0005       move progress by this much per simulated frame (camera in motion → motion-dependent effects)
#   --pointer 0.2,-0.1   pointer in NDC      --down   hold it
#   --size 1920x1080     viewport (default 1280x720)     --dpr 2
#   --clip x,y,w,h       crop (CSS px) — render 1920x1080 and crop a 960x540 region to inspect micro-detail at 1:1
#   --q low|medium|high  quality tier
#   --hud                show the HUD (captions etc.)
#   --eval "<js>"        scripted interaction before capture, e.g. a pointer stroke across the frame:
#                        --eval "for(let i=0;i<90;i++){__hl.set({pointer:[-0.6+i*0.013,0.15]});__hl.step(1)}"

# contact sheets — the fastest way to judge the whole journey or an animation
node tools/shot.mjs <id> --sheet --out shots/<id>/sheet.png               # 9 tiles, progress 0 → 1
node tools/shot.mjs <id> --sheet-p 0.4,0.45,0.5,0.55 --out …              # explicit progress values
node tools/shot.mjs <id> --p 0.3 --times 0.5,2,5,10 --out …               # same view at different times (is it alive?)

# cost. Budget: ≤ 10 ms/frame at 1920x1080 including the core lens (≈ 3 ms with DOF + bloom).
node tools/shot.mjs <id> --perf
node tools/shot.mjs <id> --sweep                 # the same at p = 0, 0.1 … 1 (use this before you call a world done)
node tools/shot.mjs <id> --perf-p 0.03,0.36      # …or at explicit progress values
# sheets honour --size, so a phone can be reviewed in one image:
node tools/shot.mjs <id> --sheet --size 390x844
node tools/shot.mjs <id> --still                 # proves the camera does not move with time (owner's rule); must print OK
node tools/shot.mjs <id> --transition <prev> --mix 0.5   # the dissolve from <prev>'s LAST frame into this world's first
node tools/shot.mjs <id> --reduced …             # any capture with prefers-reduced-motion: reduce

# how long init() blocks the main thread on a cold load (it runs while the previous world is on screen)
node tools/shot.mjs <id> --initcost

# the real thing: intro → enter → scroll → transitions, real requestAnimationFrame timing, error report
node tools/live.mjs --only <id> --dwell 4
```

`window.__hl` in the page: `set({p, pointer:[x,y], down, time})`, `step(n, dt, dp)`, `perf(n)`, `info()`, `goto(id)`, `errors`, `app`
(`__hl.app.cur.world` is your world instance — poke at it from `--eval` to A/B a parameter without editing files).

Use the Read tool on the PNGs. **Actually look.** A world that compiles is not a world that is beautiful. Other builders are running GPU
jobs at the same time as you: `--perf` numbers are inflated and noisy while that is happening — run it two or three times and trust the minimum.

## 6. Sound (optional but wanted)

`createAudio(bus, engine)` is called once the visitor has sound on. Build a quiet generative bed from the bus helpers and return
`{ update(frame) {}, dispose() {} }` (both optional). Nobody can listen while building this, so stay conservative: sines and filtered noise,
long attacks, low gains, nothing percussive or bright. The core fades the bus with `presence` and tears everything down on unload.

```js
bus.drone({ freqs: [midi(38), midi(45)], type: 'sine', gain: 0.04, detune: 6, attack: 6, filter: 700, lfoRate: 0.06, lfoDepth: 0.35, pan })  // → { gain, filter, oscs }
bus.noise({ color: 'pink'|'brown'|'white', gain: 0.02, type: 'bandpass', freq: 600, q: 0.7, lfoRate, lfoDepth, pan })                       // → { gain, filter, source }
bus.bell({ freq: midi(74), gain: 0.04, decay: 5, pan: -0.3, partials: [1, 2.76, 5.4] })   // one-shot
bus.every(4, 11, () => { … })     // random-interval scheduler, stops with the bus
bus.ramp(audioParam, value, seconds)
bus.input                          // GainNode: connect your own nodes here.   bus.ctx = AudioContext
```

Gain guide (linear): drones 0.03–0.06, noise beds 0.008–0.03, bells 0.02–0.06. `Math.random()` is fine in audio code.

## 7. The bar

This project exists to show what is possible. "Fine" is a failure.

- **Detail at every scale.** The wide shot must compose; the close-up must reward. Nothing may look like a default primitive with a default
  material. Every surface needs breakup: micro-normal variation, edge wear, dust, stains, anisotropy, imperfection. Every edge needs a reason.
- **Light is the subject.** Motivate it, shape it, let it fall off into darkness. Use real HDR ranges. Air has depth: haze, shafts, motes.
- **One palette per world**, two or three hues at most, most of the frame dark or quiet so the accents sing. No rainbow gradients, no neon-on-black
  cliché, no lens flares for their own sake.
- **Everything breathes.** Nothing in the world is perfectly still: slow drift, flicker, settle. But calm — this is a contemplative piece, not a demo reel.
- **The camera never shakes** (owner's rule). The camera is a smooth function of progress plus at most slow damped pointer parallax: no `sway`, no bob, no impact jolts, no time-based camera motion. Life belongs to the subject, not the lens.
- **Third person, one animal.** Every world follows `docs/ARC.md` (the story and the hand-offs between worlds) and uses the shared butterfly kit described in `docs/BUTTERFLY.md`.
- **Compose the rail.** Each caption beat is a shot: decide what the viewer looks at, what is in focus, what the foreground does. Vary scale:
  wide establishing → medium → macro → release.
- **One signature effect per world that nobody expects**, executed completely, visible without interaction and better with it.
- **It must run.** ≤ 10 ms/frame at 1080p on an M2 (the canvas is usually larger than that; the core scales resolution down if you blow the
  budget, and the picture gets soft). Honour `ctx.quality.level`.
- **Voice.** Captions are first person (the butterfly speaking; see docs/ARC.md for the words that are never used), plain, short (under ~90 characters), unsentimental, never hype, never claims of
  feeling stated as fact. Three or four per world, with silence between them. No emoji, no exclamation marks.

Ship only what you have looked at.

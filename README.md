# Hidden Layers

**Live: https://butterfly.kyzo.io**

Six small real-time 3D worlds and one animal: a glasswing butterfly that cannot get out of a glasshouse. Each world
goes one layer deeper into it, and the end of the sixth is the start of the first.

| | Layer | Theme | What it is |
| --- | --- | --- | --- |
| 01 | Conservatory | Perception | The fogged glasshouse. The garden is on the other side of the glass. |
| 02 | Latent | Meaning | Inside its mind: the garden as points of light, clustered by what things mean to it. |
| 03 | Corpus | Memory | A night crossing over open water, steered by the moon. A journey it never made. |
| 04 | Descent | Learning | Following scent, warmth and light downhill, and getting caught circling a lamp. |
| 05 | Loom | Attention | Silk: the thread it once spun to hang itself from. |
| 06 | Mirror | Self | The chrysalis, mirror-silver. It hatches, and the first thing it sees is glass. |

Everything is procedural: no models, textures, HDRIs or audio files. Built with three.js and Vite, written by Claude
(Anthropic's coding agent) from the prompts in [PROMPTS.md](PROMPTS.md).

## Controls

- **Scroll** (wheel, trackpad, or swipe up on a phone) flies the butterfly forwards; scroll back to go back.
  There is a top speed. Keep scrolling at the end of a world to begin the next.
- **Move the mouse** (or drag sideways on a phone) to steer.
- **Arrows / Space** step · **1–6** jump to a layer · **A** watch it play itself · **M** sound · **H** hide the
  interface · **F** fullscreen

Deep links: `/#latent`, or `/?world=corpus&p=0.4` (skips the intro). `?play` is an earlier hold-to-fly version of the
controls. `?debug` shows frame stats, `?q=low|medium|high` forces a quality tier, `?scale=1` pins the render resolution.

## Run

```bash
npm install
npm run dev        # http://127.0.0.1:5199
npm run build      # static site in dist/
```

## Structure

```
src/core/      engine: App (loop, journey, loading), Play, Input, Post (DOF, bloom, tonemap, grade, transition),
               Rail (camera), Audio, shared GLSL
src/shared/    the butterfly every world renders in its own material
src/ui/        HUD
src/worlds/    one folder per layer + _template
tools/         headless checks: shot.mjs (screenshots, contact sheets, frame cost), scroll.mjs and play.mjs
               (real wheel and touch input), live.mjs, og.mjs (share image and video)
docs/          ARC.md (the story), WORLD_GUIDE.md (the contract every world follows), BUTTERFLY.md, PLAY.md
```

The tools need Google Chrome installed and the dev server running.

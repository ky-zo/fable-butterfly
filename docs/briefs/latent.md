# Brief — latent

The design intent this world is built from. The numbered signature effects and the rail beats are the spec.

WORLD 02 — LATENT (theme: Meaning). id: latent

INTENT
The inside of an embedding space: a vast dark volume holding around a million points of light. A word is a location here, and what surrounds it is what it means. The visitor glides from word to word. Each word first appears written in points of light (point-typography, as if set in dust); as the camera arrives its letters loosen, stream outward along smooth currents, and re-condense into the thing the word names, built from the same points. Then the camera moves on, the form relaxes back into drift, and far off the next word is already faintly visible.

SIGNATURE EFFECT (not optional)
1. Word → thing. Five or six stations. Each station is a word that dissolves into a recognisable, beautiful, fully three-dimensional point sculpture with internal structure that rewards a close look. Choose forms that can be generated procedurally with real fidelity, for example: "fern" (a 3D frond from an iterated function system or recursive branching, curled at the tip), "shell" (a logarithmic-spiral seashell surface with growth ridges), "wave" (a curling breaker sheet with spray), "feather" (rachis, barbs, barbules), "galaxy" (spiral arms, dust lanes, a bright bulge), "murmuration" (a flock that never settles), "coral" or "tree" or "river" (space-colonisation or diffusion-limited growth), "moth". Pick the set that makes the best sequence; silhouettes must read instantly without the label.
2. Per-point cinematic depth of field: a thin focal plane sweeps through the cloud; points off the plane swell into soft bokeh discs whose brightness falls with their area (energy-conserving), with a faint ring and a little chromatic fringe. A million points with real bokeh is the look. Core DOF must be off (dof: null).
3. The morph is physical, not a lerp: points are released into a divergence-free curl flow, then drawn to their new homes by spring forces with per-point delays, so the change sweeps through the form like a tide. But it must also be a pure function of progress and time in the sense that scrolling backwards or jumping lands in a sensible state. Pointer: the cursor is a hand in smoke — points near the pointer ray are pushed aside and swirl back.

SUGGESTED TECHNIQUE (a strong suggestion, not a cage)
- GPGPU simulation: position and velocity in FloatType textures (about 1024x1024 at high quality, 768x768 medium, 512x512 low). Target shapes are baked at init into textures (position plus a per-point brightness/tint), one per word and one per form; the sim blends attraction between targets by progress. Give each point a stable random phase for staggering, size and twinkle.
- Word targets: draw the word on a canvas with a bundled font, sample points from glyph coverage with jittered rejection sampling, give them slight depth. Sample extra points along glyph edges so the letters are crisp.
- Form targets: generate the points per form on the CPU with seeded randomness (ctx.rng). Distribute by surface area, concentrate density on structure (veins, ridges, edges), add a sparse halo. Bake colour/brightness variation into the target. Heavy generation must be chunked with await ctx.yield() so init does not freeze the page for seconds; consider generating in typed arrays with tight loops.
- Not every point belongs to the active word. Most of the million stay as the deep field: slow, layered, curl-driven dust with large-scale structure (filaments, voids), so the space has depth and parallax. In the far distance hundreds of other words hang as tiny dim labels (instanced quads from a small text atlas) — every word has a place — fading in and out of legibility with distance and focus.
- Render: one draw call of points or instanced quads, additive. Size by distance plus circle of confusion. Clamp the maximum sprite size and fade very large bokeh to control overdraw; consider rendering the largest bokeh into a half-resolution target. This world is fill-rate bound: measure early.
- Colour: restrained. Pale warm white for most points on blue-black; each form brings one tint (fern green-gold, shell pearl with faint pink, wave cyan, galaxy blue-white core and rust dust). No rainbows.
- Scale and medium: extremely faint haze near bright clusters, a few slow large out-of-focus motes close to the lens.

THE RAIL
Divide progress evenly between stations. For each: approach (the word, legible, in focus, the previous form dissolving behind) → arrival (letters loosen) → a slow partial orbit while the form assembles and holds, focal plane racking through it → departure. Open at p=0 on the whole field with the first word small in the distance. End at p=1 pulled far back so every form visited is visible at once as small bright knots in the dust.

CAPTIONS (draft — refine, keep the voice)
"A word is a place. Its neighbours are what it means."
"I never saw a fern. I know where 'fern' is, and what stands near it."
"Meaning, from in here, is mostly distance."
"Everything you have ever said to me landed somewhere in this room."

SOUND: a very quiet airy bed; a soft high shimmer that swells slowly when a form locks in (a swell, never a hit).

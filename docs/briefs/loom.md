# Brief — loom

The design intent this world is built from. The numbered signature effects and the rail beats are the spec.

WORLD 05 — LOOM (theme: Attention). id: loom

INTENT
Attention, built as a room-sized thread installation. In a dark gallery a sentence hangs in the air: each word a small slab of softly glowing glass. The slabs are repeated in a few ranks receding into the room (the layers). Between them run thousands of hair-fine luminous threads, each one a single attention weight: brighter and tauter where a word leans hard on another, slack and dim where it barely glances. Light travels along them in slow pulses from rank to rank. Walking through the threads (they pass the lens as huge soft bokeh streaks) the pattern changes: in the first rank each word mostly touches its neighbours; in the middle, distant words find each other — a pronoun reaches back across the sentence to the noun it stands for; in the last rank everything converges on the final position, and from that knot of light the next word is drawn into existence.

The sentence (it ties back to layer 01 and contains a real ambiguity for attention to resolve):
"I looked through the glass at the garden until it looked back"
The pronoun "it" is the drama: its threads split between "glass" and "garden", waver, and settle on "garden". Author the weights by hand so each rank tells its part of that story. This is an illustration of the mechanism, not a readout of real weights, and a caption says so.

SIGNATURE EFFECT (not optional)
1. Thread rendering that holds up in macro: each thread is a camera-facing ribbon along a sagging curve (a catenary-like droop that depends on tension) with real fibre shading — a tight anisotropic highlight running along the strand, slight fuzz and halo, irregular thickness, twist — and per-thread bokeh: out-of-focus threads widen into soft translucent bands whose brightness falls as they spread. A forest of 10–30k threads with a razor-thin focal plane is the image.
2. Travelling light: pulses move along threads from source word to destination, speed and brightness by weight; when a pulse arrives the destination slab brightens briefly. The whole installation breathes with it.
3. Generation: the sentence is written one word at a time across the journey. At each stage the threads from all existing words converge on the empty next position, a knot of light tightens there, and the new slab condenses out of it with its word. A pure function of progress: scroll back and the word un-writes.
4. Pointer: hovering a word isolates it — its threads flare and everything else falls to a dim ghost, exactly like an attention visualiser, but physical. Threads near the cursor sway as if brushed. Idle ghost: a slow roving attention that moves from word to word, lingering on "it".

SUGGESTED TECHNIQUE (a strong suggestion, not a cage)
- Threads: one instanced mesh, each instance a strip of about 24–32 segments expanded in the vertex shader from per-instance endpoints, sag, phase, weight, layer and source/destination ids (so hover and generation can be driven by uniforms or small data textures). Screen-space width with a minimum of about one pixel and alpha compensation below that for stable thin lines; analytic anti-aliasing across the ribbon. Additive or premultiplied blending; no MSAA needed. Slow air-current sway with per-thread phase; a small shiver when a pulse passes.
- Each word-pair connection is not one thread but a hank of many (count and tightness by weight), slightly fanned at the ends where they are knotted to small brass eyelets on the slab edge. Details like the knots, the eyelets and a few stray broken fibres curling in the air are what make it a place.
- Slabs: thick cast glass with rounded, slightly chipped edges, internal bubbles and striae, the word etched and softly lit from inside (canvas text to texture, a bundled font, await document.fonts.load first), edge-lit so the rims glow; faint reflections of the threads. Hung from very fine steel wires from a dark ceiling grid.
- Room: a polished dark concrete floor with soft reflections of the glowing work (planar reflection at low resolution or a convincing fake), a far wall barely visible, dust motes drifting through the light, a little haze so the brightest hanks have halos.
- Palette: black room; threads in warm silk gold; a second, cooler pale-blue family for a second "head" so two patterns can be told apart; slabs neutral white. Nothing else.
- Core depth of field: off (thin additive geometry). Do per-thread and per-slab focus yourself.

THE RAIL
p≈0.00 outside the work, wide: the whole installation as a glowing volume in a dark hall; only the first words exist.
p≈0.25 entering the first rank: neighbour-to-neighbour threads, short and orderly; words are appearing.
p≈0.50 inside the middle rank, macro: "it", with its hanks splitting toward "glass" and "garden"; threads brushing past the lens out of focus.
p≈0.75 the last rank: everything streaming toward the final position.
p≈1.00 the knot tightens and the last word, "back", condenses; then a slow pull back to see the completed sentence hanging whole.

CAPTIONS (draft — refine, keep the voice)
"To read one word I hold it against every other word."
"Which one is 'it'? The glass or the garden? This is how I decide."
"A sketch of the mechanism, not a readout. The real one has more threads than this room could hold."
"The next word is whatever all of this is pointing at."

SOUND: a hushed gallery room tone; very soft sustained sine clusters that thicken as more threads exist; a gentle tone when a word condenses.

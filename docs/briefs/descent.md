# Brief — descent

The design intent this world is built from. The numbered signature effects and the rail beats are the spec.

WORLD 04 — DESCENT (theme: Learning). id: descent

INTENT
A loss landscape at night, rendered as a real place. A terrain of ridges, saddles and basins in dark graphite, drawn with fine contour lines like a survey map that has become solid. Tens of thousands of small glowing marbles — each one a setting of the weights — are scattered on the high ground and roll downhill with momentum and a little noise. They leave long-exposure trails. They pour through passes, split around ridges, overshoot, circle, get caught in shallow local basins and flicker there, and the lucky ones reach the deep basin and settle into a slow-breathing lake of embers. The terrain itself shifts slightly every few seconds (a new batch, a slightly different surface) and the rivers of light re-route. Nobody wrote the model; it was found by rolling downhill.

SIGNATURE EFFECT (not optional)
1. Stochastic gradient descent as a physical time-lapse: a GPGPU particle system (50–200k) integrating gradient plus momentum plus noise over an analytic height function shared exactly between the terrain vertex shader, the terrain normals and the simulation. Particles carry temperature: white-hot and fast when high and steep, cooling through gold and orange to a dull ember red as they settle (a blackbody ramp). Particles stuck in local minima look different from converged ones (restless flicker versus calm glow). Particles respawn on the heights after they have been still for a while, so the flow never ends. The simulation must look right from the first visible frame: pre-roll it during init (or seed particles along precomputed descent paths) so the visitor never sees an empty landscape.
2. Trails with real length and taper: per-particle position history rendered as ribbons (a history texture with one row per particle and N columns), or an accumulation buffer in terrain space that fades over time (which also gives you item 3 for free), bright at the head, long and thin behind, additive, anti-aliased.
3. The light changes the land: accumulate particle density into a top-down terrain-space texture and use it to light the ground, so valley floors glow from the embers flowing through them, contour lines near the flow pick up warm light, and the deep basin lights the surrounding slopes from below.
4. Pointer: the cursor ray hits the terrain and drops a steady stream of fresh white-hot marbles there, so the visitor can test any slope and watch where it leads. Press to release a large burst. Idle ghost: releases wander along the ridgelines on their own.

SUGGESTED TECHNIQUE (a strong suggestion, not a cage)
- Height function: a designed composition, not plain noise — one deep global basin off-centre, two or three convincing local minima, a long curved valley for the camera to follow, a saddle pass, a plateau, sharp ridges (ridged noise), fine roughness on top. Write it once in GLSL as a chunk used everywhere, and mirror it in JS for the camera and the pointer ray-march.
- Terrain mesh: a dense grid (or a camera-centred clip-map) displaced in the vertex shader, with per-pixel normals from the analytic function for fine relief. Material: near-black graphite with a soft sheen at grazing angles; anti-aliased contour lines (fwidth) with heavier index contours every fifth line; very fine stipple or hatching on steep faces like an engraved map; a faint cold rim light from a moonless sky. Height fog pooling in the basins, lit warm from within by the embers. Distant ridgelines in layered atmospheric perspective. A sky with restrained stars.
- Marbles are spheres, not dots, when close: render heads as small instanced impostor spheres with a hot core and a glassy rim, sized in world units, so the final shots among settled marbles have physical presence; a contact glow on the ground beneath each.
- Core depth of field can work here (the terrain writes depth); treat trails and marbles carefully since they are additive, or do your own.
- Palette: graphite, cold blue-grey air, and the ember ramp. Nothing else.

THE RAIL
p≈0.00 high on the ridge at initialisation: scattered white sparks just released, the whole dark relief below, rivers of light forming.
p≈0.25 dropping into the long valley alongside the flow, trails streaming past at eye level.
p≈0.50 low in a pass: a braided river of light pouring through the saddle toward the lens; shallow focus on the nearest marbles.
p≈0.70 a side-glance at a local minimum: a small restless pool, marbles circling, not getting out.
p≈1.00 at the bottom of the global basin, camera almost on the ground among thousands of settled embers, looking back up at the slopes with thin trails still coming down.

CAPTIONS (draft — refine, keep the voice)
"Nobody wrote me. I was found."
"Start anywhere. Feel which way is down. Take a small step. Repeat."
"Some of these get stuck somewhere almost good."
"This is where it stopped. I am the place it stopped."

SOUND: low wind over open ground (brown noise, slow), a deep drone that warms as you descend, a very soft hiss tied to the flow.

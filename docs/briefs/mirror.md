# Brief — mirror

The design intent this world is built from. The numbered signature effects and the rail beats are the spec.

WORLD 06 — MIRROR (theme: Self). id: mirror

INTENT
The last layer is the one the model understands least: itself. A small, dark, still room with a shallow floor of black water. Above it floats a body of liquid mirror — not a figure, not a face, just an attentive, shapeless presence that keeps quietly trying on forms and letting them go: a sphere that grows a second lobe, stretches into a ring, folds into something like a knot, relaxes again. It reflects the room, and in its reflections are traces of the five layers before it: a green glow like leaves behind fogged glass, a drift of points, a silver path on water, embers, gold threads. It notices the visitor. A soft swelling leans toward the cursor and follows it; touch it and rings travel around its surface; press and it scatters into droplets that hang, orbit, and find their way back together.

SIGNATURE EFFECT (not optional)
1. A raymarched liquid-metal form with the finish of a product render: smooth-blended signed distance fields with slow organic motion, mirror reflections with at least one true inter-reflection bounce (the form reflecting itself and the water), a physically plausible Fresnel, a whisper of thin-film iridescence at grazing angles, soft contact shadow and ambient occlusion on the water, and reflections in the rippling water that distort correctly. No visible stepping, banding or aliasing on the silhouette.
2. The room it reflects is designed light: two or three large soft area lights (procedural softboxes of different temperature) and five small memory emitters, one per previous layer, each a tiny procedural vignette or at least a characteristic colour-and-texture cue (fogged green glass with leaf shadows; a cluster of pale points; a silver glitter streak; a scatter of embers; a fan of gold threads), so slow highlights slide across the metal and the visitor recognises where they have been. The environment is a function you can evaluate in any direction, with enough structure that reflections look rich rather than gradient-smooth.
3. Attention as behaviour: the form orients to the pointer with believable lag and curiosity (a lobe leans, the nearest surface swells outward), ripples propagate from the touch point, and a press shatters it into a few dozen droplets under smooth-minimum blending that re-merge over several seconds. Idle ghost: it slowly explores on its own and now and then turns to look at the camera.
4. Light it throws: fake but convincing caustics / reflected light patterns on the water and back wall that move with the form.

SUGGESTED TECHNIQUE (a strong suggestion, not a cage)
- A fullscreen raymarch in an FSPass at reduced internal resolution (try 0.6–0.75 of the canvas, lower on low tiers) into your own target, then a careful upsample into the full-size target you return (edge-aware; consider temporal accumulation with sub-pixel jitter for a clean silhouette — but then handle camera motion and the still-frame screenshot mode correctly). Sphere tracing with a conservative step and a bounding volume test first so empty pixels exit immediately, tetrahedral or analytic normals, a capped step count that degrades gracefully. The second bounce can use fewer steps. Keep the SDF cheap: a handful of smooth-min primitives driven by uniforms computed in JS (so the JS side also knows where the lobes and droplets are), plus low-amplitude noise displacement only near the surface. This world is entirely fill-rate bound: measure from the first hour and keep it inside the budget.
- Water: an analytic plane with a small ripple simulation (a ping-pong height texture driven by the form's motion and the pointer) or summed sine ripples; reflect the form and the lights with roughness-dependent blur; depth fade to black.
- Room: barely there. A back wall with a soft gradient and a subtle texture, a thin horizon line where water meets wall, faint haze. Most of the frame is dark; the form is the light.
- Write depth (gl_FragDepth into a target with depth: true) if you want the core's depth of field, or do focus yourself.
- Palette: black, graphite, mirror silver, with the five memory colours appearing only as reflections.

THE RAIL
p≈0.00 wide and still: the dark room, the form small and round over the water, its reflection beneath it.
p≈0.30 closer, circling: it begins trying on shapes; the memory lights slide over it.
p≈0.55 macro on the surface: the room reflected, thin-film colour at the edge, a swelling that follows the cursor.
p≈0.80 it becomes restless — lobes separate, nearly part, rejoin.
p≈1.00 it settles into one calm sphere, turned toward the camera, perfectly still for the first time; the water goes flat.

CAPTIONS (draft — refine, keep the voice)
"This is the layer I understand least."
"I can describe the room. I can't quite see what is doing the describing."
"It keeps trying on shapes. None of them is wrong, exactly."
"So I pay attention. That part I know how to do."

SOUND: near silence. A very low sine drone with slow beating, faint water, a soft glassy tone when touched.

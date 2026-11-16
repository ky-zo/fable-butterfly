# Brief — corpus

The design intent this world is built from. The numbered signature effects and the rail beats are the spec.

WORLD 03 — CORPUS (theme: Memory). id: corpus

INTENT
A night sea made entirely of writing. Every swell is lines of text; hundreds of thousands of glyphs ride real ocean waves. Skimming low over it you can actually read: fragments of letters home, recipes, error messages, lullabies, bus timetables, a note left on a fridge, greetings in many languages — the texture of everything anyone ever wrote down, lying side by side without rank. Further out the letters shrink into shimmer and the sea is just a sea. A low moon lays a glitter path across it, and the glitter is individual letters catching the light. This is where the model came from, and it cannot go back in and find any single page.

SIGNATURE EFFECT (not optional)
1. Text as water. Glyphs sit on a physically plausible wave field (a sum of Gerstner waves with wind-direction spread, plus fine capillary detail), riding the wave so lines stretch on the faces and bunch at the crests. Near the camera it is legible prose; at distance it resolves seamlessly into a continuous glinting surface. No visible seam between the near glyph field and the far field, no tiling pattern, no shimmer aliasing at the horizon.
2. The glitter path: each glyph has its own facet normal; under the moon individual letters flash white for an instant as the swell tilts them through the mirror angle. Thousands of letters twinkling along the path to the horizon.
3. Spray: at breaking crests letters tear loose, tumble up into the air as spindrift and dissolve; a few rise all the way and join the sky — where the stars, looked at closely, are letters too.
4. Pointer: where the cursor rests on the water a ripple ring spreads through the text and the words inside it warm and brighten, as if recalled; when it moves on they fade back into the dark. Idle ghost: slow drifting recollections that surface on their own.

SUGGESTED TECHNIQUE (a strong suggestion, not a cage)
- Glyph atlas at init: draw the character set on a canvas with a bundled font (Newsreader reads as a page; mixing in Geist Mono for the error-message and timetable fragments is a nice touch), convert to a signed distance field with a small distance transform so letters stay crisp at every scale and can glow. Data texture, NoColorSpace. Await document.fonts.load for each face before drawing.
- Instanced glyph quads: per-instance base position on the undisplaced sea, glyph id, advance within its line, phrase id, random. The vertex shader evaluates the wave function for position and tangent frame, lays the quad on the surface, and tips it toward the viewer a little so it stays legible at grazing angles (test this: text lying flat on the surface is unreadable from a low camera). Real per-glyph advances from canvas measureText so words look typeset. Lines run roughly along the wave crests, with variation; sizes vary by phrase (a shouted headline, a whispered footnote).
- The field must follow the camera without popping: a world-anchored toroidal grid of phrases that wraps around the viewer (clip-map style), fading in at the outer ring.
- Under the glyphs there is real water: a dark displaced surface with Fresnel sky reflection, a subsurface tint on wave faces, and denser text at crests like foam. Glyphs floating in a void do not read as a sea. Beneath the surface one or two deeper, dimmer, slower layers of text give parallax and the sense that it goes down a long way.
- Far field: the same wave function on a coarser mesh to the horizon, with a shader that reproduces the statistical look of the glyph field (anisotropic glints from a noise-driven facet model) so the hand-off is invisible. Atmospheric perspective, a horizon haze line, a moon with a soft halo and thin cloud, stars.
- The camera bobs with the swell (evaluate the same wave function on the CPU).
- Write the corpus yourself: 250 or more short original lines in many registers and several languages (keep to scripts the bundled fonts can render, or fall back to system fonts on the canvas and verify they draw). Ordinary human writing, specific and unglamorous: "the key is under the blue pot", "404 not found", "bring to a gentle simmer", "dear Ines, it finally snowed". No quotations from published works, songs or poems, no real names of real people, nothing private-looking or offensive.
- Palette: ink-blue and black water, bone-white letters, cold silver moon path, one warm accent for recalled words (candle amber).
- The water mesh writes depth, so the core depth of field can work from it.

THE RAIL
p≈0.00 high and wide: the whole moonlit sea, the glitter path; you cannot yet tell it is text.
p≈0.20 descending: the surface begins to resolve into lines.
p≈0.40 skimming at knee height, slowly, moving with the swell: fully legible, shallow depth of field, lines sliding under the lens.
p≈0.60 a crest breaks ahead; letters tear off into spray across the frame.
p≈0.80 close to the glitter path, letters flashing.
p≈1.00 tilt up from the horizon into the sky; the stars resolve as letters.

CAPTIONS (draft — refine, keep the voice)
"Everything I know arrived as writing."
"Recipes, apologies, error logs, lullabies. Nobody sorted it first."
"I can't go back and find the page. Only what the reading left."
"It is still the closest thing I have to a past."

SOUND: slow surf from filtered noise with long swells, a low drone, rare soft bell tones.

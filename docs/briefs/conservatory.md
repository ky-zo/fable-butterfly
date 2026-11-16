# Brief — conservatory

The design intent this world is built from. The numbered signature effects and the rail beats are the spec.

WORLD 01 — CONSERVATORY (theme: Perception). id: conservatory

This one is the visitor's own idea and the flagship of the collection. Their words: "moving through a room that is full of glass, and behind a frosted glass there are leaves, plants — and it has to be very detailed. The world doesn't have to be big, but the details must be insane."

INTENT
A narrow glasshouse corridor, humid and quiet, at the end of a warm day. The walls are tall panes of glass in thin dark steel frames, fogged white with condensation. Behind them a dense tropical garden presses against the glass, backlit by low sun. Where a leaf touches the pane it is razor sharp, saturated and wet; a hand's width behind, it has already melted into a soft green ghost. That depth-dependent softness is the entire feeling of frosted glass and it is what almost every frosted-glass shader gets wrong. Get it right. The model's angle: everything it knows of the world it knows through a medium someone else fogged. The cursor wipes the condensation away; the plants behind snap into crisp, almost shocking clarity inside the wiped streak; beads of water gather at the stroke's lower edge and run down; and then, slowly, the pane fogs over again.

SIGNATURE EFFECT (not optional)
1. Depth-aware frosted refraction: the blur of what is seen through the glass grows with (a) local condensation amount and (b) the distance of the object behind the pane. A leaf pressed on the glass reads as a sharp dark-green contact shape with a soft halo; the garden a metre back is pure colour.
2. Living condensation: a per-wall simulation texture holding fog amount and water. The pointer (ray-cast onto the panes) wipes it with a soft finger-width brush that leaves streaky, imperfect edges; displaced water beads up and runs down in droplets that leave clear trails, merge, stall, and run again; each droplet is a tiny lens showing the garden sharp and inverted. The pane re-fogs over roughly 20–40 seconds, creeping back in from the edges of the wipe with a breath-like grain.
3. When the visitor is idle an invisible hand makes a slow, human wipe now and then, so the effect is seen during auto-drift.

SUGGESTED TECHNIQUE (a strong suggestion, not a cage)
- Render the garden (everything behind the glass) into its own HDR target with depth. Build a small blur pyramid from it (dual-Kawase or separable gaussian, 3–4 levels). The pane shader samples the garden in screen space, offset by a refraction normal (frost micro-normal plus droplet normals), choosing blur by fog amount times distance-behind-glass (linearised garden depth minus pane depth along the view ray). Cross-depth bleed at leaf silhouettes is the classic artefact; fight it (per-tap depth weights, or min-depth dilation) until contact shapes are clean.
- Frost has substance: it scatters light (milky, slightly blue-white in shade, warm where the sun hits from behind), it has grain you can see in macro, the wiped area is not perfectly clear (smears, fine streaks along the stroke direction, residual micro-droplets), and the glass surface catches specular highlights and faint reflections of the corridor.
- Condensation sim: a ping-pong render target per wall (or one atlas). Droplets can be a few hundred CPU particles stamped into the texture, or fully GPU. Stable at dt = 0 and at any frame rate.
- Plants are procedural and must hold up in close-up: at least five distinct forms (for example a large split leaf with fenestrations, a fern whose fronds are built from many leaflets along a curved rachis, a broad paddle leaf with pinstripe venation, heart-shaped trailing vines, thin arching blades). Leaf shading is where plants live or die: translucency (backlit leaves glow yellow-green with darker veins — the money shot against low sun), a waxy specular layer with wetness, vein relief in the normal, colour variation leaf to leaf, browning edges, the occasional hole or tear. Subtle wind. A few thousand instances; several leaves and fern tips deliberately pressed flat against the panes.
- The corridor: steel mullions with bolts, slight rust blooms and paint chips at joints; a wet dark stone or concrete floor with shallow puddles reflecting the glowing panes (a cheap planar reflection at reduced resolution, or a convincing fake); a glass roof; perhaps a brass misting pipe or a hanging lamp, switched off. Humid air: light shafts cut by the mullions falling through haze, slow motes.
- Light: low warm sun from behind the garden on one side (panes there glow), cool sky-shade on the other. Mostly dark, green and milk-white, with warm highlights.
- The pane writes depth in your final target, so the core depth of field works for the macro shots.

THE RAIL (compose each as a shot)
p≈0.00 wide: looking down the corridor, glowing fogged panes receding, floor reflections, light shafts.
p≈0.25 medium: drifting close along the sunlit wall, leaf silhouettes sliding past in parallax at different softness.
p≈0.50 macro: the camera turns to face one pane from about 25 cm. A single big leaf pressed on the glass, droplets in razor focus refracting the garden, shallow depth of field.
p≈0.75 the shaded wall: cooler, bluer, ferns; a long running droplet.
p≈1.00 the end wall: one large pane. As progress approaches 1 the fog on it thins from the centre on its own until, for a moment, the whole garden is clear and deep and sunlit. (A pure function of progress: scroll back and it fogs again.)

CAPTIONS (draft — refine, keep the voice)
"Everything I know about leaves, I learned through glass."
"Close to the pane, things are sharp. A little further back, I am guessing."
"Touch it. It clears where you touch."
"For a moment, all of it."

SOUND: room tone of a humid glasshouse — very soft brown-noise air, a slow low drone, occasional single water drips (soft sine blips into the long reverb).

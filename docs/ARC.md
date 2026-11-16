# Hidden Layers: the arc

Six small worlds, one animal. The owner approved world 01 in this form and asked for the rest to follow it.
Read this before touching any world. `docs/WORLD_GUIDE.md` is the technical contract; this is the story contract.

## The story

A glasswing butterfly (Greta oto) is inside a fogged glasshouse and cannot get out. The garden is on the other
side of the glass. Each later world goes one layer deeper into it: what it sees, what it thinks, what it
remembers, how it learned, how it was made. The deepest layer is the chrysalis, and the chrysalis hung inside
the glasshouse. It was born in there. It has never been outside. Everything it "remembers" of the open world was
handed down to it.

That is also the situation of a language model: it knows the world only through a medium it cannot pass, and
its memories are inherited from others. Never say this. No world may use the words model, AI, network,
training, data, token or neuron in a caption. Let the pictures carry it.

The six worlds loop: the end of 06 is the start of 01.

| # | id | theme | what it is now |
|---|----|-------|----------------|
| 01 | conservatory | Perception | The glasshouse. It searches the panes, meets its shadow, lands opposite a free one, and the garden clears while it stays inside. Ends pushing into its faceted eye. |
| 02 | latent | Meaning | Inside its mind. The garden as the animal holds it: not pictures but points of light, clustered by what things mean to it. |
| 03 | corpus | Memory | The night crossing over open water, steered by the moon. A journey it never made; it was handed down. |
| 04 | descent | Learning | Following gradients: scent, warmth, light, always downhill toward the brightest thing. Getting caught circling a lamp. Dawn. |
| 05 | loom | Attention | Silk. The thread it once spun to hang itself from, when it was something else. Everything connected to everything by a strand. |
| 06 | mirror | Self | The chrysalis. A glasswing chrysalis really is mirror-silver. Inside, the body is liquid and tries shapes until it becomes this one. It hatches, and the first thing it sees is glass. |

## Rules every world follows

1. **Third person. The butterfly is the subject.** The owner's words: "it should be third person to show the
   beauty of the butterfly". The hero is in frame, readable and well placed for almost all of the journey, in
   landscape and in phone portrait (390x844). Each world opens on a composed image that contains it.
2. **The camera never shakes.** The owner's words: "The camera should not shake". The camera is a smooth
   function of scroll progress, plus at most slow damped pointer parallax. No sway, no bob, no handheld noise,
   no impact jolts, no time-based camera motion at all. Set `sway` to zero on every Rail. All life is in the
   subject and the world, never in the lens.
3. **One animal, six materials.** Use the shared kit in `src/shared/butterfly/` (see `docs/BUTTERFLY.md`) so
   the silhouette, venation and wingbeat are identical everywhere. Each world renders it in its own substance
   (listed below). It must always be recognisably the same butterfly.
4. **Detail over size.** Small worlds, absurd detail, real optics and real natural history. Every world needs
   at least one effect a viewer would not have thought to ask for, grounded in something true about the animal.
5. **Keep what works.** Each world already exists and the owner called the set "very impressive". Build on the
   existing signature effects; re-aim them at the story. Do not start over.
6. **Hand-offs.** Each world's first frame must accept the previous world's last frame, and its last frame must
   set up the next (table below). The engine cross-dissolves through a noise transition; make the two frames
   rhyme in shape, brightness and where the subject sits.
7. **Captions.** First person, the butterfly speaking. Plain, short, unsentimental. Three or four per world with
   silence between. Each must read true for the animal on its face.
8. **Phone first.** The owner reviews on a phone. Check portrait framing at many progress values, keep text
   clear of the subject, and make the low and medium tiers look intentional.
9. **Budget.** At most 10 ms/frame at 1920x1080 on high at every progress value; init never blocks the main
   thread for more than about 50 ms at a time.

## World by world

### 02 Latent: inside its mind
- **Hand-in:** 01 ends with the compound eye filling the frame, hexagonal facets, garden reflected. Open on the
  garden seen through that eye: a mosaic of thousands of hexagonal facets, each a slightly different view,
  which loosens and comes apart into points of light.
- **The animal here:** a constellation. The same butterfly drawn as thousands of points sampled from the kit's
  geometry, wingbeat intact, flying through its own thoughts.
- **True things to use:** butterflies see ultraviolet, so flowers carry nectar-guide patterns we cannot see
  (bullseyes and runway lines glowing on petals); they taste with their feet; they navigate by a sun compass
  and by scent plumes that arrive as broken filaments on the wind. The mind's map is organised by meaning
  (food, danger, mate, light), not by where things are.
- **Hand-off:** one cluster is different from the rest: cold, blue-white, a disc of light over dark ripples. It
  grows until it is the moon on water.

### 03 Corpus: the night crossing
- **Hand-in:** a moon and its road of light on black water.
- **The animal here:** the real glasswing by moonlight, low over the swell, wings catching glitter, its
  reflection broken in the water beneath it. Far ahead and behind, a thin river of others making the same
  crossing, each a faint light.
- **True things to use:** migrations take several generations, so no single butterfly knows the route; it is
  inherited. Keep this world's existing signature (the writing): the sea is made of it, lines of script in the
  swell, legible in the moon road and nowhere else. A crossing remembered in other voices.
- **Hand-off:** a dark shore, a slope, and one warm light low on it.

### 04 Descent: toward the light
- **Hand-in:** a dark hillside at night with one warm light at the bottom.
- **The animal here:** the real glasswing, small against terrain, drawing a thin luminous trail of where it has
  been, so its path down the slope is visible as a line.
- **True things to use:** it follows gradients it can sense (scent, warmth, humidity, light) and each wingbeat
  is a small correction downhill. Insects do not fly at lamps on purpose: they keep their backs turned to the
  brightest thing, so a lamp bends their path into an orbit they cannot leave. Show that: the trail winding
  into a tightening spiral around a lamp, with others already circling. Then dawn, a far bigger light, and the
  spiral opens. Fix the existing lava-field look: this is a cool night landscape with warm points, not red.
- **Hand-off:** it comes down under a leaf at first light. Dew on a single thread of silk, catching the sun.

### 05 Loom: silk
- **Hand-in:** one bright strand of silk with dew on it.
- **The animal here:** drawn in thread. Its wing veins are the warp; the loom weaves the wings between them and
  unweaves them again. It should feel like a memory of a body from before there was one.
- **True things to use:** a caterpillar lays down a pad of silk and hangs from it by a single anchor before it
  changes; silk is spun, not secreted as a sheet, in a figure-of-eight motion of the head. Keep this world's
  existing signature (strands that pull tight toward whatever is being attended to, words riding on them).
- **Hand-off:** the strands draw together into one small silk pad on the underside of a steel glazing bar, with
  something bright and curved hanging from it.

### 06 Mirror: the chrysalis
- **Hand-in:** a mirror-silver chrysalis hanging from a silk pad, reflecting the room around it.
- **The animal here:** not yet. A real Greta oto chrysalis is chrome: show the glasshouse (fogged panes, green
  beyond, steel bars) bent in its surface, so the viewer slowly recognises where this is. Inside it, liquid
  tries shapes (this world's existing signature) and each attempt is closer to a glasswing.
- **True things to use:** in the chrysalis the caterpillar's body mostly dissolves and is rebuilt from small
  clusters of cells that were waiting the whole time. The wings come out wet, small and crumpled, and are
  pumped flat with fluid; a new butterfly hangs still while they dry.
- **Hand-off (the loop):** it hatches onto the steel bar and its wings slowly open, backlit, the corridor
  visible through them. That is the first frame of 01: the glasswing at rest on a mullion, side-on, on the
  left third, fogged panes bright behind.

# Hidden Layers: play

The contract for turning the piece from something scrolled into something played. Read `docs/ARC.md` (story),
`docs/WORLD_GUIDE.md` (world contract, tools) and `docs/BUTTERFLY.md` (the animal) first; this file sits on top of them.

This round builds ONE SLICE: the core play layer, the HUD, and world 01 made fully playable. Worlds 02 to 06 keep
working as "hold to fly and steer" with no gates and no finds. The owner judges the slice before the other five are done.

Two rules do not move: the piece stays **third person**, and **the camera does not shake**. Every camera stays a pure
function of progress and aspect ratio. Play decides *when* progress moves and what the animal does; it never touches a lens.

Numbers marked *(tune)* are starting values to be settled on a real phone. When one changes, change it here too.

---

## 1. The game in five sentences

1. Hold anywhere and the glasswing beats its wings and the journey moves; let go and it glides to a hover, or settles, and everything stops.
2. Drag while you hold and it leans that way, and if you lean it at glass it flies at the glass.
3. Three times in each world the journey waits until you do what the animal would do there.
4. Each of those lights one cell of a small wing in the corner, with one soft note and the line the butterfly has just earned: 18 cells for six worlds and a 19th for flying the loop shut.
5. Nothing can be failed: a waiting moment first shows a cue inside the world, then the butterfly does it by itself and the journey goes on, but that cell stays dark until you come back.

World 01 teaches the three things a thumb can do, one per find, without a word: **drag** (the shadow), **drag and keep
holding** (the glass), **let go** (the other one).

---

## 2. Controls

All pixel numbers are CSS px at 390x844 portrait.

### Hold (every input)

| what | value |
| --- | --- |
| Sources | first finger on the picture (anything that is not `[data-ui]`); left mouse button on the picture; Space (key repeat ignored) |
| Effort `fly`, 0..1 | rises at 9/s while held (90 % after 0.26 s); after release falls at 1.6/s less 0.16 a second, so it is exactly 0 after 1.5 s *(tune)* |
| Progress | `pTarget += fly * pace(p) * dt / meta.duration`. The existing `damp(p, pTarget, 3.2)` stays, so starts and stops are eased |
| Coast after release | about 0.5 s of flight (about 0.006 of progress at pace 1). Progress is exactly still about 2 s after letting go |
| Taps | no special rule. A 100 ms tap comes out of the same smoothing as about 0.3 s of flight, so tappers still move |
| Reverse | none. There is no way back by play; the layer list and keys 1 to 6 still jump |
| Always a release, never a jump | `pointercancel`, `lostpointercapture`, window `blur`, `visibilitychange` hidden, `pagehide`, resize, rotation |

### Touch: steering is a trackpad

The finger never has to cover the animal. Dragging moves a virtual aim point; the aim starts where the butterfly is.

| what | value |
| --- | --- |
| Anchor | where the animal's path point is on screen, in NDC. The world publishes it (`world.anchor`); default is the centre |
| Offset | starts from its current value at touch-down (zero once it has eased home), so the aim never jumps. A finger that comes back while the offset is still more than 2 px out is steering at once |
| Dead zone | 6 px of finger travel, subtracted. A plain hold does not steer |
| Gain | 1.8 aim px per finger px, both axes *(tune)* |
| Limit | a circle of radius `0.40 * min(W, H)` around the anchor: 156 px, reached after 93 px of thumb travel. Hard limit, so reversing answers on the first pixel. The aim is also kept inside ±0.96 NDC |
| `aim.active` | true once the drag passes the dead zone; stays true 0.35 s after the finger lifts; then the offset eases home at 3/s |
| Second finger | never steers. The hold lasts while any finger is down. If the steering finger lifts first, the other takes over with its deltas rebased |
| Edges | a touch that starts within 20 px of the left or right edge is a hold only; its drag is ignored (system back swipes start there) |
| Cursor | none is drawn. The animal is the cursor |

### Mouse

Left button held is flight. The cursor is the aim, absolute. `aim.active` while the cursor is over the page and (the
button is held or the mouse moved in the last 5 s). The pointer is captured on press. The wheel does nothing to the
journey; it only brings back the hint "Hold to fly" for 4 s (at most once per 10 s), for people with a scroll habit.

### Keyboard

| key | does |
| --- | --- |
| Space (held) | fly |
| Arrow keys | move the aim offset at 1.4 NDC/s inside the same circle; it recentres at 2/s when they are up |
| A | Watch on / off |
| 1 to 6, M, H, F | as today (layer, sound, hide the interface, full screen) |

Space or Enter on a focused HUD button still belongs to the button (already true in `hud.js`).

### Browser gestures

Already there: `touch-action: none` on `#stage`, `overscroll-behavior: none` on the page. Added: `touch-action: none`,
`-webkit-touch-callout: none` and `user-select: none` on `html` and `body` (and `touch-action: none` on the HUD's
buttons, which still take their taps); `maximum-scale=1, user-scalable=no` in the viewport meta; `preventDefault` on
`contextmenu`, `gesturestart`, `gesturechange`, `selectstart` and `dragstart`; a non-passive `touchstart` and
`touchmove` `preventDefault` on the canvas; `setPointerCapture` on press. Pointers are tracked in a Map by `pointerId`
(before, any `pointerup` cleared `pointer.down`, whichever finger it was; under hold-to-fly that would drop the flight).

### Reduced motion

Hold-to-fly is unchanged (the motion is the player's own). The wingbeat keeps today's reduced amount (0.45), cue
movements are scaled by 0.3, a lit cell fades in without the pulse, and Watch never starts by itself.

---

## 3. The core contract

New: `src/core/Play.js` (effort, gates, finds, storage). Changed: `Input.js` (hold sources, pointer map, aim),
`App.js` (`_updateJourney`, `_renderSlot`, the HUD block of `frame()`, `go()`, `_exposeApi`), `src/ui/hud.js`, `hud.css`.
The tooling object is `window.__hl` (the existing one; there is no `window.hl`).

### Modes

| mode | when | journey | worlds must |
| --- | --- | --- | --- |
| `play` | default | hold to fly, gates, finds | run their play behaviour |
| `watch` | the Watch toggle, or `?watch` | advances by `dt / duration` as Drift does today; gates skipped; no cells | look exactly as today (idle ghosts on) |
| `scroll` | `?scroll` (development only) | today's wheel, drag and arrow scrubbing; gates off | look exactly as today |
| `still` | `?still` (the tools) | set directly by `__hl.set` / `__hl.step` | look exactly as today |

**The one rule for world code: anything new branches on `frame.play.mode === 'play'`.** Outside play, a world runs the
code path it runs today, so `tools/shot.mjs --still`, `--sheet` and `--sweep` do not change.

### `frame.play` (always present, including the prewarm frame)

```js
frame.play = {
  mode,                 // 'play' | 'watch' | 'scroll' | 'still'
  held,                 // a fly source is down now
  fly,                  // 0..1 smoothed effort. Fixed at 1 outside play mode
  pressed, released,    // true for one frame
  heldFor, restFor,     // seconds of this hold / seconds since the last release
  first,                // no hold of 0.4 s yet since the page loaded (false outside play mode)
  aim: { x, y, dx, dy, active },   // NDC; dx, dy = offset from the anchor
  gate,                 // null, or { id, kind, stage, t } while the journey is waiting at a gate
                        //   stage 0 quiet, 1 cue, 2 the butterfly does it itself; t = engaged seconds at the gate
  has(id),              // is this world's find lit (stored)
  find(id),             // the player did it: light the cell, sound the note, show the line, open the gate.
                        //   Returns true the first time ever. A no-op returning false outside play mode
  pass(id),             // the animal did it by itself: show the line and open the gate. No cell
  reduced,              // prefers-reduced-motion
};
```

In still mode it is one constant, frozen object (`held: false`, `fly: 1`, `first: false`, `gate: null`, `has` and `find`
return false). During a dissolve, and on the hidden frame a world is warmed up with, a world gets `held: false` and
`gate: null`. A world keeps the same `frame.play` object for as long as it is loaded; `aim` and `gate` are single
objects that are mutated in place, so nothing here allocates per frame.

### `frame.pointer` (same object and fields as today)

In play mode it carries the aim: `x, y, u, v` (and the velocity fields derived from them) are the aim; `inside` is
`aim.active`; `idle` is seconds since the player last moved the aim (the anchor drifting under a still thumb does not
count). **`sx` and `sy` rest at 0 in play mode**: they are what a lens leans on (`latent/index.js` turns its camera by
them), and play never moves a lens. **`down` is always false in play mode**: a hold now
means fly, and `mirror/form.js` and `mirror/index.js` scatter the liquid on `down`, which a hold would do for a whole
world. A world that wants the hold reads `play.held`. In watch, scroll and still modes the pointer is exactly today's.

### World meta and live fields

```js
export const meta = {
  duration, scroll, hint, captions,          // unchanged; `captions` still drive watch, scroll and still
  play: {
    pace:   [[0, 3], [0.084, 1], …],         // [from, k]: k multiplies 1/duration from that progress until the next entry
    commit: [[0.084, 0.104], …],             // ramps that finish by themselves (see below)
    finds:  [{ id, says }, { id, says }, { id, says }],   // exactly three, in cell order; `says` is the line
    gates:  [{ id, at, kind, cue: 5, auto: 12 }],         // id = the find it waits for; kind 'steer' | 'beat' | 'rest'
    lines:  [{ from, to, text }],            // progress-keyed lines shown in play mode (lines not tied to a find)
  },
};
```

- `world.anchor = { x, y }` (optional, live): the animal's path point in NDC, never its steered position (that would feed back).
- `world.playState()` (optional): a small plain object for the harness (meters, counters).
- No `meta.play` means pace 1, no commits, no gates, no finds, and `meta.captions` shown by progress as today.

### What the core does each frame (play mode)

1. Update `held`, `fly`, the aim.
2. `drive = inside a commit range ? max(fly, 0.7) : fly`.
3. `gate` = the first gate at or ahead of `pTarget` that is not open. A gate is open if its find is lit, or it was passed on this visit to the world (visit flags reset each time the world becomes current).
4. `pTarget = min(pTarget + drive * pace * dt / duration, gate ? gate.at : 1)`. A gate only clamps the target, so the camera eases to rest through the existing damp. A gate never adds motion.
5. `p = damp(p, pTarget, 3.2, dt)`, unchanged.
6. When `p` is within 0.002 of `gate.at`, `play.gate` is set and its clock runs.

**Commit ranges** are the one bend in "release stops the journey". Landing and lift-off poses are blended on progress
(`airborne()` in world 01), so stopping inside one freezes a half-landed animal. Inside a commit range progress runs on
at 70 % pace without a hold until the range ends. Each is about two seconds. The camera is still a pure function of progress.

### Gates and escalation

- The world may call `play.find(id)` at any progress, before the gate too. A player who has already done the thing is never stopped.
- The gate clock counts **engaged** seconds: held, or within 4 s of the last input. A phone put down on a table just idles.
- `cue` (default 5 s) *(tune)*: stage 1. The world shows its cue, inside the picture, never as chrome.
- `auto` (default 12 s) *(tune)*: stage 2. The world plays it out itself, then calls `play.pass(id)`.
- If the world has not called `pass` 6 s into stage 2, the core passes the gate itself. Nobody can get stuck.
- On `find` and on `pass` the line (`says`) shows for 6 s. The story is never withheld; only the cell is. A gate that is already open because its cell was lit on an earlier visit says its line as the journey passes it, so a second lap is quicker but not silent.
- After a `pass`, a `find` of the same thing on the same visit does nothing: the cell stays dark until the player comes back.
- `__hl.set({ p })` past a gate marks every earlier gate as passed, so tools that jump are not held.
- A world's own meters must survive `progress` jumping: reset them when `p` goes backwards or jumps more than 0.02 in a frame.

### Watch

The old Drift toggle, relabelled, **off by default**. On: the piece plays itself as it does today (worlds get
`mode: 'watch'` and behave exactly as now, lines appear by `meta.captions`, the next world begins 3 s after the end).
No cells light. A hold on the picture turns Watch off and takes over from where the film is. The HUD event stays `'auto'`.
`?noauto` is accepted and ignored.

### End of a world

At `p >= 0.995`, 1.0 s of continuous hold starts the next world (the meter drains at 2/s when released). During the
2.8 s dissolve neither world's progress moves, and a hold that began before the dissolve ended does not count until it
is released and pressed again: every world opens on its composed first image, and the first hold is felt.
Preloading the next world moves from "4 s after arrival" to `p >= 0.5` in play mode, so `init()` does not land on the first holds.

### Persistence

One `localStorage` key, `hidden-layers.wing.v1`: `{ "v": 1, "c": "0000000000000000000", "lap": 0 }` (`c` is 19
characters, one per cell). Every read and write is in `try/catch` with an in-memory copy as the fallback; the page must
run without storage. Written only on a find and on closing the loop. Never read or written in still mode or with `?fresh`.

### What worlds 02 to 06 get without changing a line

Hold to fly at pace 1 (their authored Drift speed); the aim through `frame.pointer` (a plain hold leaves `inside`
false, so their idle ghosts run as today; a drag moves their pointer effect around the centre of the picture instead of
under the thumb); `pointer.down` false; captions by progress; "Keep flying" at the end; Watch. No gates, no finds, their
six cells stay dark. They must be looked at once each on a phone under the new input (check 14).

### Flags and `__hl`

Flags: `?scroll`, `?watch`, `?fresh` (ignore storage), `?still` (as today).
Existing `__hl.set / step / perf / info / goto / transition / errors / app` are unchanged. New:

| hook | does |
| --- | --- |
| `__hl.play()` | snapshot: `{ mode, world, p, pTarget, held, fly, aim, gate, cells, lap, end, state }` (`world` is the id, `end` the 0..1 hold meter at the end, `state` is `world.playState?.()`) |
| `__hl.hold(on)` | press or release the hold as if by hand |
| `__hl.aim(x, y)` / `__hl.aim(null)` | set the aim in NDC and make it active / let it go |
| `__hl.log` | array of events `{ t, p, type, id }`: `press`, `release`, `gate`, `cue`, `auto`, `find`, `pass`, `end`, `world`, `loop` |
| `__hl.resetWing()` | clear the cells and the lap (and what is stored) |
| `__hl.wing()` / `__hl.wing(i)` / `__hl.wing(i, false)` | debug: the 19 cells as a string / light cell `i` as a find would (fill, swell, note, stored) / clear it |
| `__hl.set({ play: true })` | in still mode, make `__hl.step` run the play journey on its virtual clock (deterministic runs) |

---

## 4. The HUD

### The wing

A small right forewing and hindwing, spread, drawn in the HUD's one ink: veins as hairlines, 19 clear cells between
them. An unlit cell is empty. A lit cell is filled. The current world's three cells have a slightly stronger outline.

- **Baked, not computed.** `tools/bake-wing.mjs` runs the kit's `wingOutline`, `wingVeins` and `wingCells` once and writes `src/ui/wingGlyph.js` (outline path, vein paths, 19 cell paths). `wingCells` costs about 100 ms a wing, so it never runs at boot. Run it again when the kit's wings change.
- **Two things the bake does to the kit's wing so that it reads at 44 px.** On the animal the front third of the hindwing lies under the forewing, which would hide three cells, so the hindwing is swept back on its own hinge by the smallest angle that clears it (0.55 rad, found by the bake). And the kit's cells are the clear membrane only, stopping short of the veins and of the scaled border; each is grown out to meet its neighbours and the margin and then drawn in by 0.2 mm, so a lit cell sits flush between the hairlines.
- **Which cell is which.** Deeper worlds sit nearer the body.

| cells | wing | world | finds, in order |
| --- | --- | --- | --- |
| 0, 1, 2 | forewing, nearest the tip | 01 Conservatory | shadow, glass, other |
| 3, 4, 5 | forewing | 02 Latent | (later) |
| 6, 7, 8 | forewing, nearest the body | 03 Corpus | (later) |
| 9, 10, 11 | hindwing, outer margin | 04 Descent | (later) |
| 12, 13, 14 | hindwing | 05 Loom | (later) |
| 15, 16, 17 | hindwing, nearest the body | 06 Mirror | (later) |
| 18 | forewing discal cell, the largest | the loop | flying from 06 into 01 |

  Bake order: the nine forewing cells other than the discal cell (kit id 0) sorted by centroid x, largest first, are
  cells 0 to 8; the nine hindwing cells sorted the same way are 9 to 17. So cell index = `worldIndex * 3 + findIndex`.
- **On a find:** the cell fills over 600 ms, the whole glyph swells to 1.6x and back over 1.4 s (from its top-left corner), and one soft bell sounds from a core-owned audio bus: a fixed pitch per cell, rising over the 19 (`bus.bell`, gain about 0.04).
- **Tapping the wing** opens the layer list: six numbers and names, the current one marked (the same dropdown pattern as Keys). This is how a phone jumps between layers.

### Where things sit at 390x844 (no notch; a home bar lifts the bottom rows by its inset)

| y | what | notes |
| --- | --- | --- |
| 20 to 36 | "Hidden Layers" left; "Watch off", "Sound off" right | as today (Keys is already hidden on touch) |
| 46 to 90 | the wing, 48 x 44 px at x 20 (57 x 52 px on a desktop); one tap target with the wordmark, about 110 x 94 px | no thumb rests here; `pointer-events` only on this target |
| 250 to 610 | the butterfly | nothing is ever placed in this band |
| 646 to 692 | the caption, centred, two lines at most | as today |
| 750 to 802 | layer label left; the hint slot right | as today |
| 798 to 842 | the six-segment index | **display only on touch** (`pointer-events: none`), so a resting thumb is a hold and never a jump. On desktop it stays clickable on the right edge |

In play mode in an upright frame, world 01's "keep it in the picture" easing becomes lopsided so the animal never sinks
into the caption or under the thumb: up 0.50 soft / 0.62 hard NDC (211 / 262 px), down 0.24 / 0.34 (101 / 143 px).

### Every word that can appear

- Intro card, the three how-to lines: "Hold to fly", "Drag to steer", "Or press Watch".
- Hint slot: "Hold to fly", from arrival until the first hold of 0.4 s, and again for 4 s after a wheel event. Nothing else is ever a hint.
- Hint slot at the end of a world (`p > 0.985`): "Keep flying", the arrow, the next layer's number and name (on two lines at 400 px and under). While the hold is given a rule grows under the words; when it reaches their end the next layer begins. With Watch on it reads "Next".
- Toggles: "Watch", "Sound". Loading and error lines as today.
- Keys panel (desktop): Space Fly; Arrows Steer; 1 – 6 Go to a layer; A Watch; M Sound; H Hide the interface; F Full screen.
- The butterfly's lines. No "found", no counts, no score.

### Removed from today's HUD

"Drift"; every per-world `meta.hint` ("Point it at glass" and the rest: not shown in play or Watch); "Keep scrolling /
Keep dragging → next layer" and `END_HINT`; the intro lines about scrolling and drifting; "↑ ↓ Move" and "A Drift" in
Keys; tapping the index strip on touch.

### HUD methods added

`setWing(cells, worldIndex)`, `lightCell(i)`, `say(text, seconds)`, `setEnd(on, k)` (k = 0..1 of the hold meter),
`update(dt)` (once a frame: the clock of a line that was said runs on frame time, so stepped runs are deterministic).
`setAuto` keeps its name and shows "Watch". `setIdle` now dims the chrome while a hold has lasted more than 1.2 s or
nothing has been touched for 4 s; the wing is exempt for 2 s after a find.

---

## 5. World 01, beat by beat

`meta.duration` is 84 s, so pace 1 is 0.0119 of progress per second. About 72 s of holding plus the gates: 80 to 90 s in all.
Finds run in the order the approved line of flight meets them: shadow, glass, the other. (Before the shaft of sun the
walls are 0.25 m or more from the path and steering reaches 0.16 m, so the glass cannot come first without moving the path.)

```js
play: {
  pace:   [[0, 3], [0.084, 1], [0.104, 1.1], [0.192, 0.7], [0.232, 1.1], [0.49, 2], [0.548, 1], [0.568, 1.3], [0.87, 1], [0.89, 0.8]],
  commit: [[0.084, 0.104], [0.458, 0.49], [0.548, 0.568], [0.87, 0.89]],
  finds:  [{ id: 'shadow', says: 'There is a shape on the wall. It moves when I move.' },
           { id: 'glass',  says: 'Everything I know about leaves, I learned through glass.' },
           { id: 'other',  says: 'One of them rests where I rest. I can count its legs.' }],
  gates:  [{ id: 'shadow', at: 0.232, kind: 'steer' }, { id: 'glass', at: 0.445, kind: 'beat' }, { id: 'other', at: 0.49, kind: 'rest' }],
  lines:  [{ from: 0.9, to: 0.95, text: 'Now I can see all of it. I am still inside.' }],
}
```

The four lines are the four the world has today. In play the first three are earned; the opening is silent.

| progress | the player | the animal | gate and condition | cue (5 s) | by itself (12 s) | find, cell |
| --- | --- | --- | --- | --- | --- | --- |
| 0 to 0.084, at rest on the glazing bar (macro) | holds for about 2.4 s | wings open from shut toward 0.9 rad and shiver (±0.2 rad at 11 Hz, times `fly`); let go early and they fold in 0.5 s. With no hold for 6 s it shivers for 0.5 s every 4 s: the invitation | none | | | |
| 0.084 to 0.104, lift-off | nothing needed (commit) | lifts off; the lens lets it go | | | | |
| 0.104 to 0.192, the corridor | holds, drags to lean | flies; walls are out of reach, so this is where leaning is learned with nothing to hit | none | | | |
| 0.192 to 0.232, the shaft of sun | holds | slows (pace 0.7); its shadow converges on the fogged wall beside it | steered travel counts from 0.20 | | | |
| **0.232 gate "shadow"** (wall 0.10 m away, lens almost fixed) | drags, any way | a plain hold hovers in the beam, turned to the wall. Dragged, it leaves its line and the shadow goes with it; aimed at the wall it flies into its own shadow and leaves a wing print | the steered offset has travelled 0.15 m in total (one flight into the wall does it) | its own wander grows to ±10 cm for 2 s in every 5, so the shadow swings on the wall | its steer target is driven round a 0.12 m circle for 2.5 s | shadow, cell 0 |
| 0.232 to 0.445, along the sunlit wall | holds, drags | free flight; flying at the glass bumps it and leaves marks that stay | beats on wall 0 count from 0.352 | | | |
| **0.445 gate "glass"** (over the big leaf pressed to the pane; wall 0.13 m away) | drags, and keeps holding | hovers facing the pane. Dragged, it is on the glass in about 0.5 s; while held there, every second downstroke (0.4 s) lays both wings on the fog: a mark, beads shaken loose, a soft tap | 5 such beats | a heavy drop lets go above the leaf every 4 s and its trail wipes a clear line through the fog | the existing idle hand (`Steer._plan`) hops it up the pane, bumping | glass, cell 1 |
| 0.445 to 0.49, the landing (commit from 0.458) | holds, or nothing | comes down on the pane, wings open; the lens closes to the two-shot | | | | |
| **0.49 gate "other"** (macro; the pane, and the garden behind it) | lets go | held, it flutters on the pane and the free one hangs back in the garden, a blur (`meet` 0.55). With no hold, `meet` rises to 1 over 2.5 s: it comes down head to head, feet sharp through the fog | `meet` reaches 1 with no hold | the free one comes in to 0.9 and shies back at every beat | ours tires: its wings fold for 4 s whatever the thumb does, and the other settles | other, cell 2 |
| 0.49 to 0.548 | holds (2.4 s) | shivers, gathers | none | | | |
| 0.548 to 0.568, lift-off | nothing needed (commit) | lifts; the other stays a moment, then leaves into the garden (by progress, as today). Ours cannot follow | | | | |
| 0.568 to 0.87, across to the ferns | holds, drags (19.5 s) | one long free flight; the end wall clears by progress, as today | none | | | |
| 0.87 to 0.89, landing | nothing needed (commit) | comes down at the foot of the clear pane | | | | |
| 0.89 to 0.955 | holds | the verb fails: it beats against glass with nothing left to brush. A dull tap every 0.5 s, beads let go, no mark. From 0.925 it stops trying (the existing `calm`). The fourth line shows at 0.9 to 0.95 | none | | | |
| 0.955 to 1, the eye | holds (4.7 s) | still. The hold now moves only the lens, inward; release stops the push | at 0.995, 1.0 s more of hold begins world 02 | | | |

### What changes in `src/worlds/conservatory/` (play mode only)

- **`index.js`**: `meta.play`; publish `this.anchor` (`hero.base` projected); the travel meter, the beat counter and `meet`; call `play.find` / `play.pass`; `playState()`.
- **`hero.js`**: a beat clock of its own. Held: continuous 5 Hz beats with a 0.15 s gap every 6, the body carried up to 3 cm above its line (the kit's `lift` resets every 1.9 s cycle, so it is rebuilt as a per-beat bob plus a damped climb). The frame a press lands: the stroke restarts at the top and `offsetVel.y` gets +0.25 m/s. Released: finish the stroke, hold the 0.6 rad V (`GLIDE`) for 0.6 s, sink 2.5 cm, then today's idle bursts, so a hovering animal looks like today's. Perch shiver. The lopsided portrait easing.
- **`steer.js`**: `real` is `play.aim.active` (today a thumb held still for 5 s counts as nobody). The idle ghost runs only at gate stage 2. Perch yaw reads the aim offset, not `pointer.sx`. While held within 0.03 m of a pane, every second downstroke lays a mark (strength 0.9, length 0.07 *(tune)*) and reports a beat with its wall index; today a steady aim marks once and then leans on the pane (measured: 0 to 3 bumps in 6 s). At the glass gate, reach toward that wall is the wall distance plus 0.05 m. Spring 40 / 10 instead of 26 / 7.5.
- **`butterflies.js`**: `update(time, progress, meet)`. With `meet` undefined it is today's pure function of progress. In play, before the gate `u = min(arrive(p), 0.55)`; after the find or pass it is 1 until the authored leave.
- **`sound.js`**: nothing new to build; taps already follow `world.taps`.
- **Untouched**: `shots.js`, `heroPath.js`, every material and pass. No new draw calls, no new render targets.

With a mouse the cursor is always an aim, so pointing while holding earns the first two finds with little effort. That
is accepted for this slice; the phone is what is being judged.

---

## 6. The play harness: `tools/play.mjs`

Drives the real page (not still mode) in headless Chrome with real touch events (CDP `Input.dispatchTouchEvent`,
`hasTouch`, `isMobile`), a real mouse, or keys. It loads with `?fresh` unless `--persist` is given, and with `scale=1`
so the canvas is never resized under the camera check. With CDP, every touch move must list the full set of active
points, or Chrome releases the missing ones (the harness uses exactly that to lift one finger of two).

```bash
node tools/play.mjs conservatory --bot perfect     # plays like someone who gets it: must end with 3 finds
node tools/play.mjs conservatory --bot lazy        # only ever holds: must reach world 02 with 0 finds (nobody gets stuck)
node tools/play.mjs conservatory --bot idle --seconds 30    # never touches: p must stay 0, the hint must be showing
node tools/play.mjs conservatory --bot masher      # random taps, drags, second fingers, cancels, blurs
node tools/play.mjs conservatory --script "hold 3; drag 60,-40 0.5; wait gate; release 3; shot rest"
node tools/play.mjs mirror --bot lazy --from 0.97  # the hand-over into the next world (here, the loop)
node tools/play.mjs <id> --bot smoke               # any world, 25 s: hold (progress rises), let go (it stops), then from 0.97
                                                   # keep flying (the next world begins; the carried hold does not fly it)
#   --input touch|mouse|key (touch)   --size 390x844 (1280x720 for mouse and key)   --dpr 2   --q medium   --out shots/play/<run>
#   --every 2 (seconds between frames)   --from <p>   --timeout 300   --seconds <n>   --reduced   --watch
#   --stepped   use __hl.hold / __hl.aim / __hl.step on a virtual clock instead of real input (deterministic; loads ?still)
#   --persist   no ?fresh: the wing is read from and written to localStorage (with the `reload` verb)
#   --break-storage   window.localStorage throws, as with storage blocked
#   --meta '<json>'   replace the world's meta.play for the run (exercises gates on a world that has none)
```

Script verbs: `hold <s>`, `release <s>`, `tap`, `drag <dx>,<dy> <s>` (CSS px, while holding), `key <name> <s>`,
`wait gate|cue|auto|find|pass|end|world|loop|p><x>|<seconds>`, `shot <name>`; and for the edges: `second <s>` (a second
finger), `lift <s>` (the first finger up while the second stays), `cancel`, `blur`, `set p=<x>`, `eval <js>`,
`expect <js>` (FAIL unless truthy), `reload`. Bots read `play.gate.kind`: `perfect` drags for `steer`, drags and keeps
holding for `beat`, lets go for `rest`. If the world's `playState()` has `aim: [x, y]` (NDC, the way a player who gets
it would lean), `perfect` leans that way first; otherwise it tries right, left, up, down in turn.

It writes, under `--out`:

- to the terminal, a timeline from `__hl.log` (`t=31.2 p=0.232 gate shadow`, `t=32.0 find shadow cell 0`, …) and a PASS / FAIL line per assertion; exit code 1 on any FAIL;
- `state.jsonl`: `__hl.play()` sampled every 100 ms;
- one PNG at every event and every `--every` seconds, and `sheet.png`, a contact sheet of them in order.

Assertions, every run: the bot's expected end state is reached inside the timeout; progress never decreases; `held` is
false within a frame of every release, cancel and blur (the blur is a synthetic `blur` event: a headless page has no
window to lose focus to); no page errors and `__hl.errors` is empty; and the still-camera proof, in two parts. An
in-page recorder wraps `app.frame`, reads the camera pose after every frame and counts the frames on which the pose
changed although progress had not (which includes every second spent at a gate or hovering). And each world, as it is
left and at the end of the run, has up to 24 of the poses recorded during play replayed: progress is put back to the
recorded value, one frame is drawn with `dt = 0`, and the pose must match (position 1e-5, quaternion 1e-8, lens angle
2e-4 of a degree: worlds 04 and 05 only rewrite their lens angle when it has changed by more than 1e-4).

`tools/live.mjs` and `tools/hud-shot.mjs` are updated to hold instead of wheel, and to the new labels.

---

## 7. Worlds 02 to 06 (not built in this slice)

Sketches only, from each world's existing signature and lines. Each reuses the three things world 01 taught: drag, drag
and keep holding, let go. None is designed beat by beat, and none has been tried.

**02 Latent (not built in this slice).** Hold flies the constellation animal through its own thoughts; where it passes,
loose points gather into the thing they stand for. Finds: (1) drag up the broken scent filaments into the flower until
the marks only it can see come up ("The flower has marks on it that only eyes like mine can see."); (2) at the bird's
eye, stop beating until it looks away: a thing known by keeping still; (3) fly along the flat sheet and touch it, and it
lights from edge to edge ("The flat part is the glass. I know it from edge to edge.").

**03 Corpus (not built in this slice).** Hold flies low over the swell; dragging moves it on or off the moon's road,
the only place the writing can be read. Finds: (1) stay on the road until one whole line warms under it ("The ones who
crossed left the way written down."); (2) drag out to the thin river of others and fly in their line; (3) when the moon
goes down, turn to the one other light on the shore.

**04 Descent (not built in this slice).** Each held wingbeat is a small correction downhill and the drag is the lean;
the trail draws what the thumb did. Finds: (1) lean with the fall of the ground until the trail runs clean; (2) the
lamp: holding is circling, and trying harder only winds the circle tighter. The way out is to let go and let the day
come, world 01's third lesson turned over, under the line "I am doing everything right."; (3) at dawn, lean away from
the lamp to the bigger light ("It was not the sun.").

**05 Loom (not built in this slice).** The aim is attention: whatever it rests on pulls tight, as today. Finds:
(1) before there are wings, hold to spin and drag side to side to lay the thread in its figure of eight; (2) hold the
aim on one thing until it is taut, then turn to another and watch the first let go ("Whatever I turn to pulls tight.
The rest lets go."); (3) follow the strands back to the pad and let go, so it hangs from one point.

**06 Mirror (not built in this slice).** No flight until the end, so a hold is effort from inside. Finds: (1) short
presses wriggle the chrysalis until the beads fall and the glasshouse is sharp on its skin; (2) inside, drag to stir the
liquid apart, then keep still: it comes back round the same few lights; (3) pump the wet wings flat with slow holds,
then keep the thumb off while they dry. The first real flight is the hand's width down to the steel bar, which is world
01's first frame. This world needs progress to move on press edges and without a hold; the core has no hook for that yet.

---

## 8. The ending

**Built in this slice, because it is one rule in the core:** when world 01 becomes current and the player got there by
holding through the end of world 06 (not by Watch, a key or the layer list), cell 18 lights with its note, `lap` goes
up by one, and `__hl.log` gets a `loop` event. The first hold of the second lap is the same first hold: shiver, then lift.
On any lap, gates wait only for cells that are still dark, so a second pass is quicker and stops exactly where something was missed.

**Not built in this slice:**

- The glass remembers. World 01 saves where the player's wings met the pane and replays those marks in its existing pre-roll (the `HISTORY` loop in `index.js`), so on the next lap the fog is half closed over the visitor's own marks. No words; the condensation already keeps every attempt.
- A full wing. With all 19 lit the glyph's outline takes the ember colour of the wing's edge and stays that way. No count, no end screen, nobody gets out. The piece goes on as free flight.
- A visible "start over" on a phone. Until then: `?fresh` and `__hl.resetWing()`.

---

## 9. Acceptance checks

Run from the project root, with nothing else using the GPU for the cost checks. Captures go under `shots/play/`.

1. `node tools/shot.mjs conservatory --still` and `… --still --size 390x844` both print OK. (Today's baseline: OK at 390x844.)
2. `node tools/shot.mjs <id> --sheet --size 390x844` for all six worlds matches a sheet taken before the change (still mode must not have moved).
3. `node tools/shot.mjs conservatory --sweep`, run alone, three times: the minimum is at most 10 ms at every progress value. Then `--perf-p 0.232,0.445,0.49`, the three places a player waits.
4. `node tools/play.mjs conservatory --bot idle --seconds 30`: progress stays 0, the hint reads "Hold to fly", the animal shivers on its bar, Watch is off.
5. `node tools/play.mjs conservatory --bot lazy`: reaches world 02 with 0 finds; the log shows `gate`, `cue`, `auto`, `pass` for all three gates; all assertions PASS.
6. `node tools/play.mjs conservatory --bot perfect`: 3 finds, cells 0, 1, 2; each `find` comes before its `cue`; all assertions PASS.
7. Run 6 again with `--input mouse` and with `--input key`.
8. `node tools/play.mjs conservatory --bot masher --timeout 240`: no page errors, progress never decreases, never left holding after a cancel.
9. In the sheets from 5 and 6, at every gate frame: the butterfly is whole and in the picture, the caption does not touch it, the wing glyph is clear of it, and the lit cell is the right one.
10. `--script "hold 2.6; release 5; shot a"`: releasing during lift-off ends with the animal fully airborne at 0.104, not half off its perch. The same for the landing (0.458) and the last landing (0.87).
11. `--script "hold 4; release 4; shot hover"`: within 2 s of release progress has stopped and the camera pose is constant while the animal still moves.
12. Storage: after run 6 without `?fresh`, reload: cells 0 to 2 are lit and no gate stops the journey. With `localStorage` made to throw (private mode), the page loads, plays, and lights cells for the session.
13. Watch: toggle it on at p 0. World 01 plays to the end and world 02 begins, no cell lights, no gate waits, and the idle ghost bumps the glass as it does in today's Drift. A hold turns it off.
14. `node tools/play.mjs <id> --bot lazy` for latent, corpus, descent, loom and mirror at 390x844: each reaches the next world with no errors. Look at the sheets: nothing looks broken, and world 06 does not scatter for the whole hold.
15. `node tools/play.mjs mirror --bot lazy --from 0.97`: arrives in world 01, `loop` is logged, cell 18 is lit.
16. `?scroll`: wheel and drag scrub as today, no gates. `?still` tools never touch `localStorage`.
17. `node tools/shot.mjs conservatory --initcost`: no block over 50 ms. `node tools/hud-shot.mjs --only live-m,end-m,intro-m`: the new words and the wing are in place at 390x844, nothing overlaps.
18. On a real phone (cannot be done by the tools; say so if it was not done): a long press brings up no callout or selection; a thumb resting on the bottom strip flies and never jumps layers; an incoming call or a swipe to the home screen ends in a glide, not a stuck hold; sound starts after Enter.
19. Captions, hints and labels contain none of: model, AI, network, training, data, token, neuron.

---

## 10. As built (the core play layer, the HUD, the tools)

Sections 2, 3, 4 and 6 are built as written above; the text of those sections has been corrected in place where the
build had to differ. What differs from the first draft of this contract, and why:

- **`pointer.sx`, `pointer.sy` rest at 0 in play mode** (the draft had them follow the aim). World 02 turns its camera
  by them, so an aim that moved them would have moved a lens. Nothing else of worlds 02 to 06 reads them; world 01
  reads `sx` for the perch yaw, which section 5 already moves to the aim offset.
- **Letting go ends exactly.** Effort falls at 1.6/s less 0.16 a second (zero after 1.5 s; about 0.5 s of coast, not
  0.6), and the smoothed progress walks the last of its way at 3e-4 a second on top of the damp. Without both, progress
  was still creeping four seconds after release and check 11 could not hold. Measured: progress is bit-for-bit still
  between 2.5 s and 4 s after release in all six worlds.
- **A world opens with no effort left over** (`fly` is zeroed when a world becomes current), so a new world's first
  frame does not creep by the tail of the last world's flight.
- **The wing is 48 x 44 px on a phone, not 56 x 40**, the hindwing is swept back 0.55 rad in the glyph, and each cell is
  grown to its veins (section 4). At the kit's own pose three hindwing cells sit under the forewing, and the kit's
  cells for world 01 are 2 to 11 mm² islands that came out as specks.
- **Lines.** An open gate whose cell is already lit says its line as the journey passes it. A `find` after a `pass` on
  the same visit does nothing. `__hl.set({ p })` and `?p=` mark earlier gates passed without saying their lines.
- **The end hint has no rule at rest**; the rule only exists while the hold is being given. Under it sits the index
  strip, and two hairlines 12 px apart read as a mistake.
- **"Or press Watch" on the intro card is a button**: it enters with Watch on. As a plain line it named a control the
  card does not have.
- **The layer list under the wing stays open** until a layer is chosen, something else is pressed, or Escape. It is
  not closed by the idle timer, which on a phone would close it while it is being read.
- **Space that was used to leave the intro does not fly.** The key has to come up and go down again (key repeat is
  never a press).
- **No per-world hint in any mode**, still mode included (`--hud` captures no longer show "Point it at glass").
- **Extra hooks and tool options**: `__hl.wing(i, on)`; `tools/play.mjs --bot smoke`, `--persist`, `--break-storage`,
  `--meta`, and the verbs listed in section 6; `tools/hud-shot.mjs --size`, and the scenes `first`, `wing*`, `layers`,
  `end-hold`, `flying-m`, `strip-find` (each with `-m`); `tools/live.mjs` holds the mouse button to fly while it
  measures (`--watch` for the film); `tools/bake-wing.mjs --check`.
- **`frame.play.first` is false outside play mode**, so a world that forgets to branch on `mode` does not start an
  invitation in a screenshot.

- **The per-frame path creates nothing**: indexed loops in `Play.advance` and the caption lookup, one `frame.play`
  object per world, one gate object, one aim object. Measured in the page: about 0.1 microseconds a frame for
  `input.update`, `play.tick`, `play.advance`, `play.fill` and the six HUD setters together.

Not done here, by design: nothing in `src/worlds/` or `src/shared/` was touched. `README.md` and
`docs/WORLD_GUIDE.md` still describe scrolling and Drift.

Not yet exercised against world 01: when the core was built world 01 had no `meta.play`, so `--bot perfect`, the
order `gate, cue, auto, pass`, finds, the stored wing and the rescue after 6 s were run against stand-in rules put on
world 05 with `--meta` (and, for `perfect`, a page-side rule that answers as section 3 says a world would). Checks 5 to
10 of section 9 remain to be run once section 5 is built. Check 18 (a real phone) has not been done by anybody.

## 11. Added after the owner's first play (2026-11-14)

- **Surge: swipe to go faster.** A quick stroke up or down (a finger moving faster than 650 px/s, mostly vertical)
  does not lean the animal; it adds to `input.surge` (0..1; a swipe of 22 % of the screen height fills it), which
  falls back to exactly zero about 1.5 s after the last swipe. The journey runs at up to 1 + 2.2 x surge times the
  world's pace. Gates and commit ranges are untouched: a surge reaches a gate sooner, it never passes one.
  On desktop the wheel does the same and counts as a hold for 0.35 s after its last notch (so scrolling flies), and
  Shift held with Space is a full surge. Worlds can read `frame.play.surge`. Tools: `__hl.push(k)`.
- **The coach replaces the "Hold to fly" hint.** One control at a time, as a drawn mark and three or four words in the
  caption's place (`hud.setCoach('hold' | 'steer' | 'faster' | '')`): "Hold to fly" until the first hold and again
  whenever the animal has hovered untouched for 3.5 s away from a gate; "Drag to steer" from 3.2 s of flight until
  the player has leaned it; "Swipe up to go faster" after that until the first surge. It gives way to any line
  being said. Mouse wording: "Move to steer", "Scroll to go faster".
- **The intro card is one line** ("One butterfly behind glass. Six small worlds."), Enter, Sound, the same three
  marks with their words, and "or just watch".

## 12. Speed: gears the player chooses (2026-11-15)

The owner: "make it more obvious how to speed up ... some elements are kind of slow, I want the user to be able to
move through the game". This replaces the swipe surge of section 11 (the wheel and Shift still surge).

- **Gears.** `play.gear` is an index into `GEARS = [1, 2, 4]` (Play.js). It stays until the player changes it, across
  worlds, and is not stored. `play.speed` is the multiplier in force (the gear, or 1 + 3 x surge if that is more),
  eased at 5/s; the journey's pace is multiplied by it in play and in Watch. Worlds can read `frame.play.speed`.
- **Three ways to change it.** A quick swipe up is one gear faster, a swipe down one slower (a stroke faster than
  750 px/s, mostly vertical, at least 11 % of the screen height; 350 ms before the next step; it does not lean the
  animal). The speed button, bottom right, is one gear up per tap and round again from the top; it answers on
  pointerdown so a second finger can tap it while the first keeps flying. Key S does the same; Shift is a sprint
  while held.
- **Gates give way sooner.** A gate's clock runs at `min(4, speed)` times: at 4x the cue comes after 1.25 s and the
  animal does it by itself after 3 s. Finds are still possible, there is just less time for them.
- **The HUD says it.** The button shows the gear as a number and as lit chevrons (`hud.setSpeed(gear, on)`). After
  every request the new speed is written large in the caption's place for 1.3 s and the button swells
  (`hud.flashSpeed()`). The coach's "Swipe up to go faster" (mouse: "Press S to go faster") now comes whether or
  not the player ever steered: after 6 s of flight (9 s if they never leaned), for about 9 s, and again for 4 s in
  each new world until they have changed speed once; while it is up the button's chevrons run upwards.
- **Tools.** `__hl.gear()` reads the gear, `__hl.gear(n)` sets it; `__hl.play()` has `gear` and `speed`; the log has
  `gear` events. Measured in world 01 with a player who only holds: 125 s at 1x, about 40 s at 4x.

## 13. Scrolling is the main interaction (2026-11-15)

The owner, after playing the hold-to-fly build: "Make the main interaction actually scroll and make it easier to
understand." Scroll is now the default; everything in sections 1 to 12 describes the earlier game, which is kept
behind `?play` and is what `tools/play.mjs` tests.

- **How it moves.** The wheel or trackpad (1.25 scroll px per wheel px), a drag on touch (3.2 scroll px per finger px,
  finger up = forward, with momentum after a flick; a finger put down stops it), and the arrow keys, Space and
  Page Up / Down. Forwards and back. A world is `meta.scroll` px long. Scrolling on past the end (520 px, counted
  only once the picture has arrived at the end, so momentum never skips an ending) begins the next world; scrolling
  back past the start goes to the end of the one before.
- **What the visitor is told.** One instruction: "Scroll to fly" (touch: "Swipe up to fly"), on the intro card and
  in the caption's place until they have scrolled 300 px, and again after 9 s without scrolling. At the end of a
  world: "Keep scrolling" (touch: "Keep swiping") and the next layer, with the rule filling as they scroll on.
- **The wing.** No gates and no finds. A world's three cells light as the visitor (not Watch) scrolls forward past
  25 %, 55 % and 90 % of it; scrolling world 06 shut into world 01 lights the 19th. Captions run by progress
  (`meta.captions`).
- **Watch** is unchanged (the film plays itself and resumes 1.6 s after a scroll); the speed button and key S are
  offered only while Watch is on.
- **Test:** `node tools/scroll.mjs [world] --input wheel|touch`.

## 14. Scrolling has a top speed (2026-11-15)

Kamil: "add like a max scroll speed or sth because currently it's easy to just run through this whole thing like crazy".

- The journey moves at most `SCROLL_MAX_PACE` (4) times the film's own pace, so a world takes at least a quarter of its
  `duration` (21 s for 01, 32 s for 02), however hard the visitor scrolls. Slower scrolling still tracks the hand.
- A scroll may only ask for `SCROLL_LEAD` (0.9 s) of flight ahead of where the butterfly is. The rest of a hard scroll
  or a long fling is dropped, not queued, so the butterfly stops soon after the hand does.
- Top speed is reached over `SCROLL_RAMP` (0.4 s) from rest. Only speeding up is limited, so nothing overshoots.
- The same limits hold going back. `?play` and the tools (`__hl.set`) are not limited.
- `tools/scroll.mjs` checks it: "a hard scroll cannot outrun the top speed".

## 15. Steering and finds on scroll (2026-11-16)

One piece of play back on top of scroll, in the core and in world 01 only. Scroll is still the throttle and nothing
about it changed (gains, top speed, overscroll, the end). There are no holds and no gates: scrolling alone still goes
all the way through world 01 and into world 02, with its three cells unlit. This replaces "The wing" in section 13
for a world that has finds; worlds without `meta.play.finds` (02 to 06) still light their cells at 25 %, 55 %, 90 %.

- **Steering.** In scroll mode the core keeps `frame.play.aim` (`Input._updateAim(dt, true)`); `frame.pointer` stays
  the raw pointer, so worlds 02 to 06 get exactly what they got. With a mouse the aim is the cursor, live for 5 s
  after the mouse was last moved on purpose (10 px or more in one movement, so a hand resting on a wheel does not
  steer). On touch only the sideways part of a drag moves the aim, from the animal's anchor, 1.8 to 1 inside the same
  circle as in play; it starts once the finger is 14 px to the side of where it came down and that is at least half
  of how far it has gone up or down (a swipe that drifts is a scroll). The vertical part of the same drag goes on
  scrolling. The lean is kept 0.9 s after the finger lifts, then eases home. The butterfly moves, never the camera.
- **World 01** (`steer.js`, branch `play.mode === 'scroll'`): with the hand on it the animal goes for the aim as it
  does in play (spring 40 / 10, a pane nearer than 0.22 m is within reach, and an aim less than a finger's width from
  the animal is not pointing at glass). With no hand on it, it is the film: today's idle flutter, today's spring.
- **Finds** (`index.js`, `_scroll`). The same three as in play, in the same cells, made by steering. A meter counts
  seconds while the visitor's hand (`aim.active`) has the animal at the find, inside the find's progress window:

  | find, cell | window | the hand has… | for |
  | --- | --- | --- | --- |
  | shadow, 0 | 0.192 to 0.30 | flown it at the shade wall in the shaft of sun until it meets its shadow there: within 0.055 m of that pane, at least 0.03 m of it by the hand's offset (not its own wandering) | 0.15 s |
  | glass, 1 | 0.352 to 0.47 | flown it at the sunlit wall and kept it there: within 0.045 m of that pane, 0.03 m by the hand | 0.4 s |
  | other, 2 | 0.488 to 0.553, down on the pane | leaned it at least 60 % of the way across the picture (in x) toward the one that has settled opposite; it turns that way | 0.4 s |

  The world then calls `play.find(id)`, which in scroll mode lights the cell (swell, bell, stored) and logs `find`,
  and neither says a line (captions run by progress) nor opens anything. Not while Watch is on. The idle flutter
  bumping a pane, or the animal's own wander, never counts: every condition needs the hand.
- **The one extra instruction.** `world.steerHint` (optional, live) asks the HUD for the coach `side`: "Move to
  steer" with a mouse, "Drag sideways to steer" on touch. World 01 raises it on the way in to a find that is still
  unlit (from 0.075 of progress before its window to 0.03 into it; for the first, that is the corridor from 0.117),
  until the hand has carried the animal 0.12 m in all; after that it never comes back on that visit. It gives way to
  "Scroll to fly", to captions and to the end hint. The intro still says one thing.
- **Tools.** `__hl.play().state.finds` is `[{ id, from, to, at: [x, y] }]`: where on screen (NDC) a hand would point
  for each find now; `state.scroll` has the meters. `node tools/scroll.mjs conservatory --input wheel|touch` checks
  that scrolling alone lights nothing and reaches world 02, that steering onto each find while scrolling (real mouse
  moves; the sideways part of a real touch drag) lights its cell, that the hint is said before the first find and
  goes, and that the camera at one progress is identical with and without a hand on the butterfly.
- **Not done.** No find lines are said on scroll, nothing in worlds 02 to 06, no keyboard steering in scroll mode
  (the arrows step the journey). With a mouse the cursor is absolute, so anybody who moves it near the animal in the
  first two windows makes those finds with little effort, as in play (section 5). Not tried on a real phone.

## 16. The hand on the glass, and the corners (2026-11-16)

- **Wiping the fog is back.** In world 01, where the cursor moves (or a finger drags) across a pane the fog is wiped
  and grows back on its own (`Conservatory._wipe` → `Condensation.wipe`). Only a moving hand wipes: a cursor at rest
  while the journey scrolls leaves no line. Not in `?play`, where the pointer is the aim.
- **No leaf wraps a corner.** The leaf shader lays whatever pokes into the corridor flat on the nearest pane, vertex by
  vertex, so a leaf reaching in at a corner was pulled into straight green lines from one pane to the other. Such
  leaves (about twenty) are no longer planted (`wrapsCorner` in `garden.js`); leaves composed onto a pane by hand stay.

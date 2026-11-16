# The butterfly kit

One glasswing (*Greta oto*) for all six worlds: `src/shared/butterfly/`. World 01 draws it in its own materials;
the other five draw the same animal in another substance. Same outline, same veins, same wingbeat everywhere,
because every world takes them from here.

```js
import { createButterflyKit, standardLight, flightPose /* … */ } from '../../shared/butterfly/index.js';
const kit = await createButterflyKit(ctx);          // in init()
```

The self-test `src/worlds/_kit/` draws every use below side by side. It is not in the registry (the app only loads
registered worlds), so it has its own driver:

```bash
node src/worlds/_kit/shot.mjs --out shots/_kit/kit.png            # 1920x1080; --size 390x844 --dpr 2 for a phone
node src/worlds/_kit/shot.mjs --p 0.5                              # progress scrubs the hatching of animal 2
node src/worlds/_kit/shot.mjs --probe                              # ms each thing on the board costs
```

The board has three rows: the five uses; hatching and the cheaper detail levels; and the realistic animal where it is
hardest (at rest with the light behind it, by a moon, by one lamp, in `'cutout'` mode, and 120 and 80 pixels across).

Every code block in this file is taken from `src/worlds/_kit/examples.js` and runs there. Change one, change the other.

The animal was redesigned (it read as a moth), in two passes. What changed, value by value, and what a world that uses
the kit has to look at again, is at the end: **Redesign (what changed)** and **Redesign, second pass (what changed)**.
Read the second first: it is the newer, and where it disagrees with the first it wins.

## What is in it

| layer | files | gives you |
| --- | --- | --- |
| data | `wingData.js` `bodyData.js` | outlines, veins, cells, border bands, body and leg curves. Plain arrays, no three.js |
| geometry | `wingGeo.js` `bodyGeo.js` `sample.js` | meshes at three detail levels, a point sampler, line segments. Any material |
| rig | `rig.js` `motion.js` | one pose model on the CPU and as a GLSL chunk; pose values from time; planted feet |
| look | `light.js` `wingMaterial.js` `bodyMaterial.js` `atlas.js` `glasswing.js` `flock.js` `shadow.js` | the realistic animal, lit by inputs you supply; a flock; its shadow |

Each layer works without the ones below it in the table. A world that draws in thread needs only data and rig.

## Units and axes

- **Wing frame**: millimetres, flat. Origin at the hinge, `+x` out along the wing toward the tip, `+y` toward the
  leading edge. Forewing 29.5 mm long and 11.6 mm deep, hindwing 20 mm long. Wings are described for the right side;
  the rig mirrors them.
- **Body frame**: millimetres. `+X` right, `+Y` toward the head, `+Z` out of the back. Origin in the middle of the
  thorax. Head at `y ≈ +5`, tip of the abdomen at `y ≈ −11.5` (`ABDOMEN`), feet at `z = −4` (`STAND`).
- **World**: `gw.place(pos, right, fwd, up, size)` puts the body frame in your world. One model millimetre is
  `0.001 × size` world units, so `size = 1` is life size (59 mm across the open forewings) when your unit is a metre.
  `fwd` points at the head, `up` out of the back. A butterfly flying level has its nose up about 0.42 rad:
  use `flightBasis(heading, 0.42, roll, R, F, U)`.
- Angles are radians. Colours are linear HDR.

## The pose

`makePose()` returns the whole pose. `gw.pose` is one. Set the numbers yourself or use the helpers in `motion.js`.

| field | range | meaning |
| --- | --- | --- |
| `wings.x` fore | −0.5 … 1.56 | stroke angle of the forewings above the body's plane. 0 spread flat, 1.56 clapped together, 1.53 shut at rest (`REST`), −0.5 bottom of the downstroke |
| `wings.y` hind | −0.45 … 1.48 | the same for the hindwings; in flight it follows the forewing by 0.045 of a beat (the two beat as one sheet) |
| `wings.z` twist | −0.3 … 0.3 | feathering about the wing's own axis |
| `wings.w` flex | −0.25 … 0.25 | bend along the span (fraction of wing length): the tip trails the root, and the membrane behind the leading edge trails with it (the wing cups). 0 = the flat wing |
| `shape.x` unfurl | 0 … 1 | 1 the finished wing. 0 as it leaves the chrysalis: a third of its size, pleated, limp. It is pumped flat from the base outward |
| `shape.y` sweep | 0 … 1 | forewing drawn back over the hindwing (asleep, or newly hatched) |
| `limbs.x` legs | 0 … 1 | 0 standing, 1 folded for flight |
| `limbs.y` droop | 0 … 1 | abdomen hung down (0.1 at rest, 0.08–0.16 in flight: all but in line with the thorax) |
| `limbs.z` | 0 … 1 | antennae swept back (0.22 in flight: a narrow V straight ahead) |
| `limbs.w` breath | 0 … 1 | abdomen swelling |
| `twitch.x`, `.y` | −0.3 … 0.3 | right, left antenna flicked |
| `feet[0..3]` | mm, body frame | how far each foot is from where it stands: mid right, mid left, hind right, hind left. The leg follows |

Helpers (`motion.js`), all pure functions of their arguments, no allocation, `dt` may be 0:

| call | does |
| --- | --- |
| `wingbeat(t, out)` | fore, hind, flex, twist, lift (m), pitch (rad), beating, index, phase. Bursts of 4–6 beats at 5 Hz, then a long glide; a 1.9 s cycle. Multiply `flex` by `FLEX` (0.55) before putting it in `wings.w` |
| `fanning(t, seed, out)` | fore, hind for one at rest: shut and upright over the back (1.53), opening to bask (down to 0.73) every few breaths |
| `flap(t, seed, hz, out)` | a cheaper sine beat for a flock |
| `flightPose(pose, t, amount = 1)` | whole pose in flight (wings that bend and cup, legs tight under the thorax, abdomen in line, antennae ahead); returns the beat, so add `lift` to the height. `amount` 0.45 is the reduced-motion beat |
| `restPose(pose, t, seed, open = 1)` | whole pose at rest |
| `emergePose(pose, u, t)` | hatching as one number: 0 crumpled and hanging, 0.75 pumped flat, 1 dry and opening |
| `flightBasis(heading, pitch, roll, R, F, U)` | the body's axes for one flying along `heading` |
| `new Feet()` | `.update(pose, gw.group.matrix, dt)` every frame it stands: feet stay planted in the world and step (lift, swing, place) when dragged 1.6 mm. `.reset()` when it takes off. `.tap(i)` lifts one foot and sets it down |

CPU twins of the shader rig: `wingPoint(out, x, y, side, hind, pose)` (wing frame → body frame) and
`wingFrame(side, hind, phi, origin, axisX, axisY, sweep)` (a wing as a flat plate). The self-test draws
`wingPoint` as orange dots on the margin of animal 2 while its wings unfurl: they sit on the GPU mesh.

## 1. The realistic animal

```js
const light = standardLight({ points: 1 });
light.sunDir.set(-0.45, 0.55, 0.7).normalize();
light.sunColor.set(4.4, 3.9, 3.1);

const gw = kit.glasswing({ light });                 // detail 'high', mode 'blend': draw it after the opaque scene
scene.add(gw.group);

// every frame
const beat = flightPose(gw.pose, t);                 // wings, legs, abdomen for time t
_p.copy(at).addScaledVector(Y, 0.014 + beat.lift).addScaledVector(Z, 0.004);
gw.place(_p, X, Y, Z, 1);                            // thorax centre, right, toward the head, out of the back, size
gw.setSize(size.width, size.height);                 // pixels of the target (fur, antennae and legs are sized in pixels)
gw.sort(camera);                                     // far wings first: they are seen through the near ones (and the coat is dropped when it is too small to see)
```

`kit.glasswing(options)`:

| option | default | |
| --- | --- | --- |
| `light` | required | a light rig, see below |
| `detail` | `'high'` | `'high'` `'mid'` `'low'`, see Cost |
| `mode` | `'blend'` | `'blend'`: premultiplied over what is already in the target, draw it last, the membrane really is clear. `'cutout'`: veins, scales and body alpha-tested into an opaque scene, then the membrane's sheen at `sheenOrder` |
| `scene` | `false` | what is seen through a wing takes a breath of the film's colour (always), is drawn out of focus and bent while `showPre` (the lens is open), and translucent scales are tinted by it. Needs `tBfScene` |
| `eyeMap` | `false` | the eyes hold a picture (`tBfEye`, `uBfEye`) |
| `fur` | high + blend only | hair quads over the skin |
| `wings` | the level's | `[fore, hind]` from `kit.buildWings({ spokes, rings })`: dense wings for hatching |
| `pose` | its own | another Glasswing's pose to share (a mirror image, a double) |
| `seed`, `wear` | 0.37, 0.6 | which individual; how worn its scales are |
| `species` | 0 | 0 glasswing, 1 orange longwing, 2 small white |
| `order`, `sheenOrder` | 0, order+20 | renderOrder of the body; pre-pass +1, fur +5, antennae and legs +6, wings +10…+13 |
| `uniforms` | `{}` | kit uniforms you would rather own, as shared `{ value }` objects |

Uniforms it reads (all set for you unless you pass your own):

| uniform | |
| --- | --- |
| `tVein`, `tNoise` | the vein atlas (r, g: the vein field; b, a: which way the nearest vein runs, `bfVeinDir`); a 256² tiling noise (`kit.noise`) |
| `uPose` `uShape` `uLimbs` `uTwitch` `uFeet[4]` `uLook` | the pose (bound to `gw.pose` by reference) and `(species, landed, seed, wear)` |
| `uBfRes` | vec2, pixels of the target. `gw.setSize()`. Fur is sized by it (and not drawn under 5 px to the millimetre), and antennae, legs and claws are never drawn thinner than a pixel and a half |
| `tBfScene`, `uBfLens` | with `scene`: your scene without the insect, mipmapped, `a` = distance from the lens. Lens = (focus distance, aperture, largest blur px, how far behind itself a wing is depth-tested). Same convention as the core's `post.dof` |
| `uBfPre` | with `scene`: how much of its disc of taps the out-of-focus picture behind a wing takes. 1 (the default): all six. Less: fewer, each wider and softer (0.34 = two), for a moment when the wings are most of the frame and the budget is gone; under a sixth it fades out. `gw.uniforms.uBfPre.value` |
| `tBfEye`, `uBfEye` | with `eyeMap`: any picture, and how much of it the eyes hold 0…1 |

What it is made of (`'blend'` mode): `gw.body` (thorax, abdomen, head, eyes, palps, tongue: opaque), `gw.fur`, `gw.limbs`
(antennae, legs, claws: the same buffers under another index, blended, so that a hair is a soft line), `gw.pre` (with
`scene`), `gw.wings[4]`. `gw.mats` lists every material. In `'cutout'` mode the body is one opaque mesh and `gw.limbs` is null.

### Lighting: the rig

The materials contain no lights. A rig supplies six GLSL functions. `standardLight({ points })` is the general one:

| handle | |
| --- | --- |
| `sunDir`, `sunColor` | key light: unit vector toward it, linear HDR colour (4–8 a sun, 0.3–1 a moon) |
| `sky`, `ground` | ambient from above and below |
| `bounce` | extra fill from below and beside |
| `fog` | Vector4: rgb, density per world unit |
| `envGain` | brightness of reflections |
| `points[i]` | `{ position, color, reach }`, up to 4. Call `light.update()` after changing them |

A world that knows its light better writes its own rig: `{ uniforms, common, vertex, fragment }` (contract at the top
of `light.js`). World 01 does (`src/worlds/conservatory/bfLight.js`): its walls are its lamps, its key is the sun as
fogged glass hands it on, and a third rig returns alpha 0 so that a second animal becomes a reflection in a pane.

**Mirror image** (03 Corpus): a second animal sharing the first one's pose, placed with reflected axes. three.js flips
the winding for you because the matrix is mirrored.

```js
const twin = kit.glasswing({ light: dim, detail: 'mid', pose: gw.pose });
const down = new THREE.Vector3(0, -1, 0);            // `fwd` reflected in a horizontal plane
twin.place(_p, X, down, Z, 0.5);
```

**Its shadow** on a surface of yours, without a shadow map (the wing opacity atlas, read along the ray to the light):

```js
const shadow = shadowUniforms();
shadow.tShade.value = kit.atlas.shade;
// receiver material: uniforms: { ...shadow, uSun: light.uniforms.uBfSunDir }
//   ${shadowGLSL('uSun')}
//   float lit = bfShadow(vWorld);                   // 1 = the light reaches this point past the butterfly
setShadow(shadow, gw, 1, dt);                        // every frame, after place() and the pose
```

`dt > 0` smears the shadow over the stroke since the last frame (three positions), so it does not strobe.
`kit.atlas.shade` is also what a reflection or a decal is made of: `atlasGLSL` gives `bfAtlasUV(p_mm, hind)`.

## 2. Your own material on the kit's meshes

Include the rig preamble in your vertex shader and ask it where the vertex is.

```js
const pose = makePose();
const uniforms = { ...poseUniforms(pose), uTime: { value: 0 } };
const wingMat = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.DoubleSide,
  vertexShader: `
    ${wingVertexGLSL}
    varying vec3 vN; varying vec3 vWorld; varying vec3 vEdge;
    void main(){
      vec3 b, tx, ty;
      bfWingFrame(b, tx, ty);                       // this vertex in the body frame (mm) + the sheet's two tangents
      vec4 wp = bfModel() * vec4(b, 1.0);
      vN = normalize(mat3(bfModel()) * cross(tx, ty));
      vWorld = wp.xyz; vEdge = aEdge;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `… if (vEdge.x < 0.0) discard; …`,   // the skirt outside the margin
});
// body: ${bodyVertexGLSL}  →  vec4 wp = bfModel() * vec4(bfBody(), 1.0);

const dense = kit.buildWings({ spokes: 96, rings: 14 });     // wings that crumple need rings to crumple along
const group = new THREE.Group();
group.matrixAutoUpdate = false;
for (const hind of [0, 1]) {
  group.add(new THREE.Mesh(dense[hind].geometry, wingMat));             // right
  group.add(new THREE.Mesh(kit.mirror(dense[hind], hind), wingMat));    // left: same buffers, aWing.x = -1
}
group.add(new THREE.Mesh(kit.parts('mid').body, bodyMat));
for (const m of group.children) m.frustumCulled = false;

// every frame
emergePose(pose, u, t);                              // u 0 … 1 through hatching
bodyMatrix(group.matrix, position, X, Y, Z, 1);
group.matrixWorldNeedsUpdate = true;
```

Mesh attributes:

| mesh | attribute | |
| --- | --- | --- |
| wing | `position` vec3 | `(x, y, 0)` mm in the wing frame. Not a world position |
| | `aEdge` vec3 | mm inside the margin (negative on the skirt), width of the scaled border there (mm), rust 0…1 (how much of the border is the ember band) |
| | `aWing` vec2 | side (+1 right, −1 left), 0 fore or 1 hind |
| body | `position`, `normal` | body frame, mm, standing. `kit.split(level)` gives the same buffers as two geometries, `{ trunk, limbs }` |
| | `aRad` float | half-width of the part at this vertex (mm) |
| | `aAlt` vec3 | the same vertex with legs folded |
| | `aPart` vec4 | part id (`PART`), 0…1 along it, 0…1 around it, leg 0…3 (−2 front brushes, 10 and 11 the antennae, else −1) |
| fur | `position`, `aTip`, `aHair` | root, root→tip (mm), (0 root…1 tip, ±1 across, random, white) |

`pigmentGLSL` (from `wingMaterial.js`) gives `bfPigment(p, aEdge, hind, texture2D(tVein, bfAtlasUV(p, hind)), mmPerPixel)`
→ (vein, scaled, white, rust), if your material wants the real markings: `vein` is coverage (a hair-fine vein is at most
0.065 mm of a pixel: 1 up close, 0.25 at a quarter of a millimetre to the pixel; `#define BF_VEIN_SOLID` before the chunk
for the old never-thinner-than-a-pixel vein, which an alpha test needs); `scaled` is the border, the dark band over the
end of the cell and the frame of the white bar; `white` the bar and the dots of the margin. `bfPigmentBand(…, jitter, out band)`
is the same with the border laid open: `band` = (ember 0…1, its heat 0 amber core … 1 crimson inner shoulder, the white
bar alone, across the border 0 margin … 1 inner contour). `atlasGLSL` gives `bfVeinDir(texel)`: the unit direction of the nearest
vein in the wing frame (turn it into the world with the two tangents from `bfWingFrame`).

## 3. Points

```js
const cells = [await wingCells(0, { pause: () => ctx.yield() }), await wingCells(1, { pause: () => ctx.yield() })];
const geo = await samplePoints(14000, { rnd: ctx.rng(11), cells, pause: () => ctx.yield() });
const pose = makePose();
const mat = new THREE.ShaderMaterial({
  uniforms: { ...poseUniforms(pose), uSize: { value: 2 } },
  vertexShader: `
    ${pointVertexGLSL}
    attribute float aCell;
    uniform float uSize;
    varying vec3 vCol;
    void main(){
      vec4 wp = modelMatrix * vec4(bfPoint(), 1.0);  // this point in the body frame (mm), posed
      vec3 vein = vec3(1.0, 0.82, 0.55), border = vec3(1.0, 0.45, 0.2), body = vec3(0.6, 0.75, 1.0);
      // membrane: each clear cell of the wing its own tint
      vec3 membrane = 0.35 + 0.3 * cos(6.2832 * (aCell * 0.131 + vec3(0.0, 0.33, 0.67)));
      vCol = (vein * aKind.x + border * aKind.y + membrane * aKind.z * 0.6 + body * aKind.w) * (0.35 + 0.65 * aRand);
      gl_Position = projectionMatrix * viewMatrix * wp;
      gl_PointSize = uSize * (0.6 + aRand);
    }`,
  fragmentShader: `…`,
});
const pts = new THREE.Points(geo, mat);
pts.frustumCulled = false;
pts.matrixAutoUpdate = false;
// every frame
flightPose(pose, t);
bodyMatrix(pts.matrix, position, X, Y, Z, 1);
pts.matrixWorldNeedsUpdate = true;
```

`samplePoints(n, { rnd, share, cells, pause })`. `share` divides the points: `{ veins: 0.34, border: 0.3, membrane: 0.2, body: 0.16 }`.
It costs about 9 µs a point on the CPU (20 000 points: 190 ms), so pass `pause` and it runs in slices of 2000.

| attribute | |
| --- | --- |
| `position` | wings: wing frame mm. Body: body frame mm |
| `aWing` vec2 | side (0 = a point of the body), fore or hind |
| `aUv` vec2 | wings: 0…1 across the wing's bounding box (`BOUNDS`). Body: (along the part, around it) |
| `aKind` vec4 | vein, scaled border, clear membrane, body |
| `aAlt`, `aPart` | for body points, as on the body mesh |
| `aRand` | 0…1 |
| `aCell` | with `cells`: which clear cell of its wing a membrane point is in (0 = the largest, the discal cell), else −1 |

## 4. Threads

```js
const geo = threadLines({ rnd: ctx.rng(12) });       // every vein, both margins, the body's curves
// material: ${pointVertexGLSL} + attribute vec3 aLine;   gl_Position = … * vec4(bfPoint(), 1.0);
const lines = new THREE.LineSegments(geo, mat);
geo.userData.lines;                                  // [{ id, kind: 'margin'|'vein'|'body', name, side, hind, length }]
```

`aLine` is (line id, millimetres along it, its whole length): enough to grow a strand from root to tip
(`if (aLine.y / aLine.z > grown) discard;`) or run something along it. 93 lines, 1 372 segments.

The same curves as plain data, to lay your own geometry along:

| call | returns |
| --- | --- |
| `wingOutline(hind, n, rnd?)` | closed polyline of the margin, from the hinge round by the leading edge. `rnd` adds wear |
| `wingVeins(hind, step)` | `[{ name, points, r0, r1 }]`. Names in `VEIN_NAMES`: C, Sc, R, R1…R5, M1…M3, dc1, dc2, rec, Cu, CuA1, CuA2, 1A+2A, 3A. Ends overrun the margin: cut them |
| `veinSegments(hind)` | the same as `[{ a, b, ra, rb }]` |
| `borderAt(hind, x, y)` | `[width mm, rust]` of the band of scales at a point of the margin (rust = how much of it is ember) |
| `BAR` | the white bar of the forewing and the dark band over the end of the cell: `{ a, b, w, dc, dcw }` (mm) |
| `pigmentAt(hind, x, y, outline, segs)` | `{ inside, veinDist, vein, border, white, membrane, edge }` |
| `wingCells(hind, { pause })` | `{ cells: [{ id, x, y, area }], at(x, y), grid }`: 10 cells in the forewing, 9 in the hindwing. About 100 ms each, so pass `pause` |
| `bodyCurves(n)` | thorax, abdomen, head (centre line + `rings` of half-widths), antennae, palps, tongue, legs (with `alt` folded), brushes |
| `thoraxAt(t)` `legPath(k, sx, folded)` `antennaPath(sx)` … | the curves themselves, as functions |

## 5. A flock

```js
const flock = kit.flock(14, { light });
scene.add(flock.group);
who.forEach((b, i) => flock.look(i, b.species, 0, b.seed));          // species, landed, seed

// every frame
flightBasis(heading, 0.45, 0, R, F, U);
flap(t, b.seed, 7.5, wing);
flock.set(i, _p, R, F, U, 0.3, wing.fore, wing.hind, wing.flex);     // position, axes, size, pose
flock.commit();
```

Two instanced draws for any number. Opaque (alpha-tested), so it sorts itself and can go into a scene that is fogged or
blurred afterwards. `landed = 1` puts the legs down. `flock.setSize(width, height)` (optional; 1920 × 1080 is assumed)
tells it the target's size, so that antennae and legs stay a pixel wide.

## Cost

Triangles and GPU time at 1920×1080 on the target machine (Apple M2). Time depends on how much of the frame it covers.

| | triangles | draws | covers | ms |
| --- | --- | --- | --- | --- |
| `'high'` | 53 100 (wings 6 700, body 34 300, fur 12 100) | 7 (6 when the coat is too small to draw), +4 with `scene` while `showPre` | 6 % of the frame | 0.1 |
| | | | a quarter of the frame, with `scene` | 0.5 |
| | | | wings across the whole frame | 0.9 |
| `'mid'` | 4 300 (wings 3 300, body 1 000) | 6 | 3 % | 0.05 |
| `'low'` | 1 800 (wings 800, body 1 000) | 2 | 1 % | 0.05 |
| flock | 1 800 each | 2 in all | 14 small ones | 0.1 |
| 14 000 points | | 1 | | 0.05 |
| threads | 1 372 segments in 93 lines | 1 | | under 0.05 |

`createButterflyKit(ctx)` blocks the main thread for at most 28 ms at a time (the high body; then fur 20 ms, wings 7 ms),
each in its own slice. `detail: ['high', 'low']` builds both now. `kit.parts('mid')` on first use is one block of 3 ms.
World 01's whole init with the kit: longest block 19 ms.

Everything made through the kit is registered with `ctx.track` and goes with the world.
`await kit.compile(scene, camera)` at the end of init compiles its shaders without blocking.

## Pitfalls

- **Wing positions are not world positions.** `position` on a wing mesh is millimetres in the wing frame, so its
  bounding sphere means nothing: set `frustumCulled = false`, and never put a stock three.js material on it.
- **Draw the blended animal last**, after everything opaque, and call `gw.sort(camera)` after the camera moves.
  Without the sort the far wing draws over the near one.
- **Fur is sized in pixels**, and so is the least width of an antenna or a leg. Forget `gw.setSize(width, height)` after a resize and the coat is too thick or gone.
  The canvas changes size on its own (adaptive resolution): set it every frame. `gw.sort(camera)` is also what stops
  the coat being drawn when the animal is under about 300 px across: call it every frame.
- **One rig object, kept.** Shaders are cached per rig. Make the rig once in init, not per frame or per animal.
- **`scene: true` needs a current picture.** `tBfScene` must be this frame's scene without the insect, with mipmaps,
  distance in alpha. World 01 let it go stale when the lens was closed and the scales were tinted by another shot.
- **Unfurl needs dense wings.** The default wing has 5 rings and cannot pleat. Use `kit.buildWings({ spokes: 96, rings: 14 })`.
  At `shape.x = 1` the dense and the default wing are the same shape.
- **A reflection is a second animal, not a second camera.** A mirrored camera flips the winding and three.js will not
  know; a mirrored placement is handled for you. Share the pose (`pose: gw.pose`) so the two never disagree.
- **Feet.** `Feet.update` wants `gw.group.matrix` after `place()`. Call `reset()` when it leaves the surface, or the
  first frame back down drags all four feet from where they last stood.
- **The key light can be zero.** The old fixed minimum of sun is gone. If your world has no direct light where the
  animal is, give the rig an ambient worth having (`sky`, `ground`, `bounce`, a point light) or it is a silhouette.
  The border's glow and the film's sheen answer to `bfAmb` and `bfEnv` as well as to the key, but they cannot make
  light: under a moon of 0.5 with a sky of 0.03 the animal is a dim orange outline with a pale bar (board, bottom row).
- **The film's colour through the wing needs `scene: true`**, and a `tBfScene` that is this frame's picture without the
  insect. The sheen (what the film reflects) is in every mode, but a glasswing's membrane reflects 1 % face-on: against a
  bright background almost all of the film you see is the colour it lends to what is behind it, and without `scene` there
  is none of that. (It no longer needs `showPre`: the wing adds it itself.)
- **`gw.mats`, not `gw.body.material`.** The body is two meshes in `'blend'` mode (`gw.body`, `gw.limbs`). Whatever you
  do to the body's material — a depth-test switch for a reflection, a stencil — do to every entry of `gw.mats`.
- **A reflection or a ghost of the animal is brighter than it used to be** wherever light comes through the border:
  if you add a second animal to the picture (alpha 0), turn its gain down. World 01's went from 4 to 1.3.
- **Editing a shared file while a shot is loading** makes that one shot fail (the dev server reloads the page
  under it). Run it again.
- **Not in the kit:** the glasshouse sun, the fogged-pane key, the pane reflection and the garden in the eye are
  world 01's and live in `src/worlds/conservatory/` (`bfLight.js`, `hero.js`).

## Redesign (what changed)

*(The first pass. Several of its values were changed again by the second pass, below: the film, the membrane's
reflectance, the veins, the ember, the abdomen, the legs and feet, the hindwing's inner margin, the hindwing's phase in
flight. For any of those, the second pass's tables are the current ones.)*

The first animal read as a moth: a long pale banded abdomen hanging out behind, a furry thorax, thick antennae without
clubs, fuzzy brown borders, everything one sepia. It is now a butterfly, and a glasswing with one licence: light. Before
and after, the board and world 01 in both sizes: `shots/butterfly/redesign/before/` and `…/after/`.

No exported name, option, uniform or attribute was removed or changed its meaning. Values changed; a few things were added.

### Wings (`wingData.js`)

| | was | is |
| --- | --- | --- |
| forewing outline | 29.4 × 11.9 mm, outer margin bulging (y = −6.3 at x = 23) | 29.6 × 11.6 mm, outer margin straight to slightly hollow (y = −4.7 at x = 23), tip drawn out; leading edge 0.3 mm lower (max y 3.99, was 4.25) |
| hindwing outline | x 0 … 20.1, y −9.3 … 5.8 | y −9.9 … 5.0: 0.8 mm narrower in front; the inner margin now runs back beside the abdomen (about 1 mm from it) to y = −9.85 at x = 5 … 8 |
| `BOUNDS` | `[0, −7.7, 29.5, 4.3]`, `[0, −9.4, 20.2, 5.9]` | `[0, −7.7, 29.7, 4.1]`, `[0, −10.0, 20.2, 5.1]` (so `aUv` of sampled points moves a little) |
| `SPAN`, `CENTRES`, `ATLAS`, hinges, `SIG_F`, `SIG_H` | | unchanged |
| vein radii (`wingVeins().r0, r1`, `veinSegments().ra, rb`) | 0.21 … 0.04 mm | about 0.56 × that: 0.12 … 0.02 mm (hair-fine). A world that lays strands along them and wants its old thickness multiplies by 1.8 |
| vein routes | | same 19 + 14 veins, same names and order. Forewing M1, M2, M3, CuA1, CuA2, 1A+2A end on the new outer margin (their last two points moved up by 0.5 … 1.6 mm); the leading-edge veins follow the lower costa; hindwing Sc+R1, Rs, M1 follow the narrower front, CuA2, 1A+2A and 3A (now 5 points) run on to the new inner margin |
| `NICKS` | two and three, up to 1.15 mm deep | one each, 0.16 and 0.2 mm: a fresh animal |
| `borderAt` width | fore 0.42 … 2.9 mm, hind 0.57 … 1.44 | fore 0.38 (leading edge) · 0.8 (past the cell) · 0.52 (trailing edge) · 1.3 (outer margin) · 2.6 (tip); hind 0.42 (front) · 0.46 (inner margin) · 1.3 (outside) |
| `borderAt` rust | "turns to rust at the edge", 0.3 … 0.95 | how much of the border is the ember band: 0.14 on leading edges, 0.4 along the forewing's trailing edge, 0.96 on the outer margins |
| `pigmentAt` | soft border (from 0.62 to 1.1 of its width), smoky frame round the bar | a clean inner contour (± 0.05 mm), the new bar and band; `white` is the bar only (the dots of the margin are not in the CPU twin) |
| `wingCells` | 11 + 9 | 10 + 9 (one small cell under the leading edge is now scaled) |
| new | | `BAR` (the white bar: from `[21.5, 3.9]` to `[25.1, −1.5]`, half-width 0.92; the band over the end of the cell) |

### Body (`bodyData.js`, `bodyGeo.js`, `rig.js`)

| | was | is |
| --- | --- | --- |
| thorax (`thoraxAt`) | half-widths up to 1.70 × 1.80 mm | 1.52 × 1.62, widest at the wing bases and drawn in toward the waist. Same length and position (y 3.05 … −3.25) |
| abdomen (`abdomenAt`) | y −2.9 … −16.3, half-width up to 1.2, 9 segments | y −2.45 … −11.45 (`ABDOMEN = { y0, length, segments }`), half-width up to 0.82 tapering to 0.3, 8 segments. It begins inside the back of the thorax (no waist) and ends short of the back of the hindwings |
| head, `EYE`, `EYE_R`, `FEET`, `STAND`, tongue | | unchanged |
| `SPOTS` | 10, hand-placed (several were under the skin) | 12, worked out from the body's curves so that each lies on the skin; same `[|x|, y, z, r]` format |
| antennae (`antennaRad`) | 0.07 → 0.05 mm, a slight swelling to 0.15 | 0.034 → 0.023 mm, a distinct club of 0.093 over the last fifth (`CLUB = 0.8`). Same path |
| legs (`legRad`, `LEGS`) | femur 0.15, tibia 0.1, tarsus 0.066 … 0.04 | 0.092, 0.06, 0.04 … 0.026; hips 0.15 mm higher (z −1.2) and 0.05 nearer the midline; folded for flight they lie 0.3 … 0.75 mm closer under the slimmer body. Where the feet stand is unchanged |
| palps, brushes, claws | radius 0.2, 0.15, 0.04 | 0.135, 0.1, 0.026 |
| fur (`buildFur`) | 9 000 hairs, up to 0.62 mm on the thorax | 8 100 hairs, 0.34 mm on the thorax, 0.2 on the head, lying further back: velvet, and the body keeps its outline |
| abdomen droop (`rigGLSL`, `limbs.y`) | 5.0 mm at the tip per unit | 3.2 mm (the same angle on the shorter abdomen) |
| new | | body attribute `aRad` (float: half-width of the part at the vertex); exports `ABDOMEN`, `CLUB` |

### Geometry and atlas

- Default wing rings: 6 fine / 3 coarse (were 5 / 2). Triangles of the four wings: 6 656 / 3 328 / 784 (were 5 632 / 2 816 / 560).
- `kit.atlas.veins` b and a now hold the direction of the nearest vein, `(cos 2θ, sin 2θ) · 0.5 + 0.5`; r and g are as
  they were. (a used to be 1 wherever a vein was near: nothing read it.) `atlasGLSL` gained `bfVeinDir`.
- `kit.atlas.shade` follows the new markings by itself.
- `shadowGLSL`: the body's two capsules follow the new body (thorax radius 1.55 mm, abdomen to y = −11.3), the hindwing's
  bounds reach y = −10.4.

### The look (`wingMaterial.js`, `bodyMaterial.js`)

- **Membrane.** Reflects 2.2 % face-on (was 0.3 %) rising to a third at grazing, of `bfEnv` plus a little `bfAmb`,
  tinted by a thin film whose thickness (232 … 470 nm) follows the cells: bands of violet, cyan and gold that slide as
  the wing turns. Dust and the veins' cast shadows are gone (clean glass). The key's mirror flash is a quarter of what
  it was. With `scene: true` the pre-pass (pass 4) bends what is behind more (most where the film rises to a vein) and
  lends it the film's colour, 4 % face-on to 45 % edge-on, and now draws wherever there is a wing while it is shown.
- **Veins.** Near black, thinner; a highlight of the key runs along each vein as the wing turns (it needs the atlas's
  b, a channels and the key; with the light behind the wing it is the mirrored light that is used).
- **Border.** From the margin inward: black rim (0.4 mm) with a row of white dots every 1.5 mm on the outer margins,
  the ember band (orange to crimson; albedo 0.42 … 0.2, and it passes up to 100 % of what is behind it in the red), black
  velvet, a clean inner contour made of whole scales up close. Sparks: single scales (single pixels from far off) flash
  in the key, and faintly in the ambient. From far off the border is the blend of the band (so it reads as orange-edged
  black at 80 px).
- **White bar.** Larger, a clean lozenge in a hairline frame, albedo 0.6 (was 0.4), opal (a fifth of film colour per scale).
- **Body.** Black, not brown (albedo 0.0105); white dots 0.62 (were 0.42) with a crisp edge; abdomen black above, grey
  beneath, a fine pale line down each flank, hairline joints; eyes get one clean catch-light when the facets are too
  small to tell apart; antennae end in a pale orange club that light comes through; antennae and legs lose their gloss
  when they are thinner than a pixel, and are never drawn thinner than about a pixel (`uBfRes`).
- Species 1 and 2 (the orange longwing, the white) use the same outline, veins and body and are otherwise as they were.

### Motion (`motion.js`)

- `fanning` and `restPose`: shut is 1.53 / 1.48 (was 1.47 / 1.37), the widest bask 0.73 / 0.54 (was 0.75 / 0.53). New export `REST = 1.53`.
- `wingbeat`: 4 … 6 beats to a burst (were 5 … 7): the same 5 Hz and 1.9 s cycle, a longer glide. `index` and `phase` mean what they did.
- `Flock` has `res` and `setSize(width, height)`; its materials have a `uBfRes` uniform.

### What a world using the kit may need to adjust

- **Anything placed by the old outline or the old abdomen**: wingtip trails (the tip is at about `[29.6, −0.75]`, was
  `[29.4, 0.3]`), anything hung on the tail (y = −11.45, was −16.3), a body proxy built from `abdomenAt` (shorter and
  thinner by a third). Hinges, feet, eyes, antenna paths and the size of the animal did not move.
- **Strand and point worlds**: vein radii are 0.56 × the old; the forewing has 10 cells; `aUv` is over the new `BOUNDS`.
- **Worlds that light the realistic animal**: it is darker where it was brown (body, veins, velvet) and much brighter
  where light comes through it (the ember passes 0.5 × what is behind it; it used to pass 0.1). In direct sun of 16
  the border is 3 × brighter than before. Check exposure and bloom on it, and any additive copy (reflection, afterimage).
- **Worlds with their own wing material over the kit's atlas**: r and g are unchanged, but veins are thinner
  (`smoothstep` thresholds on `vf.r` still mark the vein's edge at 0.5).
- **Rest poses**: wings shut are nearer together (1.53); a pose that was set to 1.47 by hand still works.
- **Flight**: one beat fewer per burst. Anything keyed to `beat.index` or `beating` follows by itself.

## Redesign, second pass (what changed)

Two judges looked at the redesign on a phone. It was a butterfly, and at rest it was close; in flight its wings were grey
plastic or foil, in the brightest frame it washed out, up close its markings were enamel, and the one outside the glass
was still a moth. This pass is the answer. Frames: `shots/butterfly/pass2/base/` (before) and `…/final/` (after), `d-*`
at 1920 × 1080, `m-*` at 390 × 844 @2x, `kit*.png` the board.

Again no exported name, option, uniform or attribute was removed or changed its meaning. What follows changed value or
was added.

### Wings (`wingData.js`, `rig.js`)

| | was (first pass) | is |
| --- | --- | --- |
| hindwing inner margin | ran back 1 … 2 mm from the abdomen: `[5, −9.75] [2.7, −8.7] [1.55, −6.3] [0.85, −3.4] [0.35, −1.4]` | lies along the abdomen, a quarter of a millimetre from it, to y ≈ −7 and then curves away: `[5.2, −9.8] [2.9, −9.45] [1.3, −8.4] [0.52, −6.3] [0.25, −3.6] [0.26, −1.75]` (the outline has 20 control points, was 19). Spread, the hindwings cradle the abdomen; shut, the fold stands beside it. `BOUNDS` unchanged; hindwing area 241 mm² (was 234) |
| hindwing vein 3A | `[0, −0.5] [1.0, −2.6] [2.0, −5.0] [3.2, −7.6] [4.1, −10.1]` | `[0, −0.5] [0.55, −2.6] [1.0, −5.0] [1.6, −7.4] [2.5, −9.7]`: along the new fold. All other veins unchanged |
| `wingCells` | 10 + 9 | 10 + 9 (the anal cell of the hindwing is 17.9 mm², was about 10: ids of hindwing cells, which go by area, have shifted) |
| `borderAt` rust (`aEdge.z`) | 0.14 leading edges, 0.4 all along the forewing's trailing edge, 0.22 … 1 hindwing | the ember belongs to the outer margins: forewing 0.04 on the leading edge and on the inner half of the trailing edge (x < 9), rising to 0.31 at its outer end, 0.96 on the outer margin, 0.19 … 0.7 round the tip; hindwing 0.03 in front and along the abdomen, 0.98 round the outside. Widths (`aEdge.y`) unchanged |
| the flat wing with `wings.w` ≠ 0 | bent along the span only | also cupped: `z += w · 0.075 · t² · (0.35 + 0.65 x/L)`, `t = clamp(4 − y, 0, 14)` mm behind the leading edge. In `rigGLSL` and in `wingPoint`. Nothing changes at `w = 0` |

### Body (`bodyData.js`, `bodyGeo.js`)

| | was | is |
| --- | --- | --- |
| `FEET` | `[±7.2, 5.4]`, `[±6.6, −7.2]` | `[±5.7, 4.5]`, `[±5.3, −5.9]` (z = −`STAND`, unchanged): a narrow stance |
| `LEGS[k].stand` | knees `[3.5, 2.7, −0.2]` `[3.3, −2.7, −0.1]`, heels `[5.5, 4.2, −3.7]` `[5.3, −5.0, −3.7]` | knees `[3.0, 2.4, 0.05]` `[2.8, −2.5, 0.1]` (carried high), heels `[4.5, 3.6, −3.45]` `[4.2, −4.6, −3.45]` |
| `LEGS[k].fold` | trailed back under the abdomen to y = −4.8 and −6.8 | a flat Z against the underside of the thorax: `[0.8, 1.0, −1.2] [0.9, 0.9, −1.42] [0.95, −1.7, −0.98] [0.75, 1.7, −1.22] [0.65, 0.1, −1.34]` and `[0.8, −0.9, −1.2] [0.88, −1.1, −1.38] [0.85, −3.5, −0.72] [0.48, 0.3, −1.4] [0.42, −1.3, −1.3]` |
| `palpPath`, `palpRad` | curled up over the head to z = 0.48, radius 0.135 | close in front of the face, ending at `[0.27, 5.4, 0.08]`, radius 0.11; their fur 240 hairs of 0.13 mm, pale only underneath |
| `brushPath` (the front pair) | hung 1.5 mm under the chest | lies along the chest: `[0.5, 2.2, −1.0] [0.56, 2.7, −0.95] [0.5, 3.1, −0.72] [0.44, 3.4, −0.58]` |
| `antennaRad` club | 0.093 mm | 0.12 mm |
| `SPOTS` radii | 0.11 … 0.27, even | graded: collar 0.2, shoulders 0.17, then 0.12, 0.105, 0.09 toward the waist; flanks 0.22, 0.16; chest 0.22, 0.18. Positions unchanged |
| new | | `splitBody(geometry)` → `{ trunk, limbs }`, `kit.split(level)` (cached) |

### Motion (`motion.js`, `rig.js`)

| | was | is |
| --- | --- | --- |
| `wingbeat` hind | 0.09 of a beat behind, top 1.42, bottom −0.42; glide `fore − 0.1` | 0.045 behind, top 1.48, bottom −0.48; glide `fore − 0.06`. `fore`, `flex`, `twist`, `lift`, `pitch`, `index`, `phase` unchanged |
| `flightPose` → `wings.w` | `flex × 0.3` (±0.126) | `flex × FLEX`, new export `FLEX = 0.55` (±0.23): with the cupping above, a wing in flight is never a flat plate |
| `flightPose` → `limbs` | droop `0.32 − 1.2 pitch`, antennae 0.75 | droop `0.12 − 0.4 pitch`, antennae 0.22 |
| flock, flying (`bodyVertexGLSL` under instancing) | droop 0.3, antennae 0.5 | 0.12, 0.22 |
| `restPose`, `fanning`, `emergePose`, `flap`, `Feet`, `flightBasis` | | unchanged (`Feet` plants at the new `FEET`) |

### The look (`wingMaterial.js`)

- **The membrane is clear.** It takes 2 % of what is behind it face-on and 17 % edge-on (was up to 13 % plus whatever
  the veins covered), and reflects 1.1 % face-on rising as `(1 − N·V)^4.5` to a third at grazing (was 2.2 % rising as
  the power 2.4; and no ambient is added to the mirror image any more). Against a dark background a face-on wing is no
  longer a grey sheet.
- **Veins are coverage.** In passes 0 and 2 a vein covers at most 0.065 mm of a pixel (`bfPigment().x`: 1 up close,
  0.26 at 0.25 mm per pixel, never under 0.1). It used to be a pixel of solid black at any size, which is what smoked
  the wings of a small animal. Pass 1 (`'cutout'`, the flock) keeps the solid vein, because an alpha test cannot be faint.
- **The film is two colours and a thread of a third**: cyan, violet, pale gold (`bfFilmCol`), not the spectrum of
  `thinFilm`. Its thickness changes slowly across whole cells (`bfFilm`: 244 nm + 64 toward the middle of a cell + two
  slow waves of 66 and 48 + the wrinkle and grain), so the colours are sweeps, not a fringe on every vein. Reflected, its
  colour is full when the wing is half turned and a quarter of that edge-on (silver, not foil).
- **The colour it lends to what is behind** is now added by the wing itself (pass 0, with `scene: true`), not by the
  pre-pass: what is behind is multiplied by `1 + ta (c − 1)`, `c` the film's colour at the brightness of white, `ta` 0.17
  face-on, 0.53 half turned, 0.04 edge-on, less on a small animal (× 0.55 beyond 0.4 mm per pixel) and none where the
  animal's own body is behind the wing. It never darkens. Pass 4 (the pre-pass) only defocuses and bends, and draws
  nothing where the room behind is in focus.
- **The far pair seen through the near pair** (wings shut over the back, the lens square to them) is held back: half its
  pigment and veins, a fifth of its sheen. Per vertex: `smoothstep(0.55, 0.9, cos between the line of sight and the body's right axis) × smoothstep(0.8, 1.25, stroke angle)`.
  From any other side, or with the wings open, nothing is held back.
- **A wing seen edge-on** is a faint hairline: everything × 0.2 at `N·V = 0`, full from 0.14; the ember goes dark below
  `N·V` 0.26.
- **The border.** The ember is 60 % of the border inside the rim (was 56 %), with an amber core a third of the way in
  that falls to crimson on both shoulders and from crimson into the black: no hard line. Front-lit albedo 0.25 … 0.1 (was
  0.42 … 0.2): a deep burnt orange; it passes 0.68 × its colour of what is behind (was 0.5). However hard it is lit it is
  held under 1.4, so that it deepens and does not bleach. There is none within 1.2 … 4 mm of the hinge. From far off the
  border is the blend at 0.45 × rust (was 0.6): a small animal has a darker edge with orange in it, not an orange outline.
- **Scales.** Two distances now: under 0.1 mm per pixel a scale shows as grain (no two the same value), under 0.028 it
  has relief and contours are made of whole scales (it used to be whole scales from 0.085, which at three pixels a scale
  was a staircase). Velvet is never one value at any distance (the noise texture).
- **Sparks** are fewer (three scales in ten can), brighter (× 4), copper-gold and almost all on the ember; a tenth as many,
  cold blue, on the black; white on the white.
- **A cold note.** The black of the border has a structural blue-violet sheen in the key's highlight
  (`sun × (N·H)^26 × 0.22`) and faintly in whatever it mirrors (`bfEnv × 0.1`), `(0.045, 0.07, 0.19)`.
- **The white bar** is warm pearl, one hue, albedo 0.66, and passes 0.86 of what is behind it (was 0.62): with the light
  behind it, it glows like milk glass and is not a dark wedge. Its dark frame is 0.13 mm (was 0.22).
- **Vein highlight**: a third of what it was (0.085), a wider lobe (240, was 1100), none beyond 0.3 mm per pixel. The
  membrane's own flash of the key: core × 3 (was × 4), bloom 0.3 (was 0.45).
- New varyings in the wing shaders: `vFar`, `vBodyO`, `vBodyF`. New GLSL: `bfFilmCol(opd)`; `bfFilm` kept, new numbers.

### The look (`bodyMaterial.js`, `glasswing.js`)

- **Antennae, legs and claws** are a second, blended draw in `'blend'` mode (`gw.limbs`, renderOrder +6, writes depth):
  at least 1.6 px wide with an edge that fades over a pixel, and as faint as they are thin (never under 0.34). They were
  opaque and a pixel wide, which is a staircase or a row of beads. `makeBodyMaterial({ limbs: 'none' | 'only' })`.
- **Abdomen**: black above; underneath a soft dark grey-buff (albedo 0.03) that comes up over the flank with no line;
  one faint paler line low on each flank (0.085); joints 22 % darker hairlines; matt (gloss 0.02, was 0.3), little pile.
  It was a cream plank beside a black stick.
- **Rim.** The velvet's rim is 0.05 (was 0.017) × light from beside that is not also coming from the lens's side
  (`max(beside − 0.8 bfAmb(P, V), 0) + 0.2 beside`): it draws a black body off a black background, and is absent in a
  room that is bright all round.
- **Dots** have a soft, ragged edge (± 0.06 mm). **Palps** are dark with a little pale underneath, no stripes.
  **Fur** albedo 0.015 (was 0.022). **Eyes**: from too far off to tell the facets, the dark spot is a soft round shadow.
- **The coat is dropped when it cannot be seen**: it fades between 8 and 5 px per millimetre (was 1.2 and 0.25) and
  `gw.sort(camera)` does not draw it below 5 (an animal under about 300 px across).

### What a world using the kit has to look at again

- **Anything placed at the feet** (`FEET` moved in by a fifth) or along a leg (`bodyCurves()` legs: `points` and `alt`
  are both new). Folded legs no longer trail under the abdomen.
- **Anything along the hindwing's inner margin or vein 3A** (threads, points, a trail): both moved toward the body by up
  to 1.4 mm. Hindwing cell ids from `wingCells` have shifted (the anal cell is larger).
- **Anything driven by `flightPose` or `wingbeat().hind`**: hindwings beat almost with the forewings; wings bend twice as
  far and cup; the abdomen hangs a third as much; antennae point ahead. A world that sets `wings.w` itself from
  `wingbeat().flex` should multiply by `FLEX`, not 0.3.
- **A world that relied on dark veins to draw a small animal**: in `'blend'` mode veins are now faint at a distance, and
  a small glasswing is its border, its white bar and its body, on clear glass. `'cutout'` and the flock are as before.
- **A world that relied on the membrane's sheen** (a wing as a pale sheet against the dark): face-on there is half of it,
  half turned a fifth of it; edge-on the same as before. Light it from the side the lens is on, or use `scene: true`.
- **Worlds with `scene: true`**: the film's colour through the wing is there with the lens closed too (it needed
  `showPre`). `tBfScene` must be current every frame the animal is drawn.
- **A side-on close-up with the wings shut**: the far pair is now a ghost of the near pair. From the back, the front,
  above or below nothing changes.
- **Worlds lighting it hard**: the ember no longer clips to peach; its albedo is lower, so front-lit it is a deeper
  orange. Blacks are blacker (fur, rim). If the animal has gone too dark where it used to be brown, give the rig more
  light from beside it: the rim answers to that.
- **`gw.mats` has one more material and the group one more mesh** in `'blend'` mode. Code that loops over `gw.mats`
  (a reflection, a ghost) needs nothing. Code that reaches for `gw.body.material` must do the same to `gw.limbs.material`.
- **Small animals have no coat** (under 5 px to the millimetre), and `gw.sort(camera)` must be called every frame for
  that to follow the camera.
- **Flocks**: straighter antennae, less droop, the new border; nothing to call.
- **Your own wing material over the kit's atlas or `pigmentGLSL`**: `bfPigment().x` is now a coverage that falls with
  distance; define `BF_VEIN_SOLID` before the chunk if you alpha-test it. `band.y` is 0 at the amber core, 1 on the
  inner shoulder and 0.55 on the outer lip (it was a ramp from the outer side to the inner).

### World 01 in the second pass

- **Landing (p 0.48 … 0.55)**: on the pane the animal basks, wings open and all but flat (0.2 … 0.34 rad, half shut for a
  moment every half minute): the open-wing frame. The one outside is spread flatter against the glass (0.14 … 0.31 rad),
  and the garden toward the sun is brighter behind it (`outsideLight`: `bfEnv` + 0.16 × sun in a wide lobe), so its
  border comes through the fog as orange. In an upright frame the lens aims between the two and opens until both are whole.
- **Flight**: the animal is never flown straight along the line of sight (its heading is turned up to 0.52 rad off it,
  the side kept until it is clearly on the other; body 0.2 rad more upright when seen from astern): from dead astern a
  butterfly is two lines. Flex × `FLEX`, droop `0.02 − 0.4 pitch`, antennae 0.22.
- **The shaft of sun (p 0.19 … 0.24)**: the animal takes a quarter of the whole beam (`bfLight.js`: `beam = min(beam, 0.2 + 0.08 beam)`),
  and the lens's bloom is 0.2 there (0.5 elsewhere; `K_BLOOM` in `shots.js`): black stays black in the brightest frame.
- **Upright frames**: in the air the body is kept far enough in from the sides for the whole animal and a finger's width
  beside it to be in the picture.
- Camera keys, perches and the line of flight did not change. `node tools/shot.mjs conservatory --still` prints OK at
  1280 × 720 and 390 × 844.
- Frame cost at 1920 × 1080 on high, minimum of three sweeps: 9.56 ms at p = 0, 9.52 at 0.1, 8.68 at 0.5, 9.80 at 0.8,
  9.82 at 1 (the first pass reported 9.58, 9.41, 8.35, 9.74, 9.66). The landing costs 0.3 ms more (open wings fill more
  of the frame); the flight frames and the last one about 0.1 more, which was not won back. Longest block of init: 19 ms.

### World 01 after the final check

- **The last push (p 0.966 … 0.99)**: the out-of-focus picture behind the wings used to stop at p = 0.975, on the
  grounds that the wings were out of focus themselves by then. They are not: until about 0.985 the wings beside the
  head are sharp, and the sill behind them showed sharp inside them and soft everywhere else. It is now drawn until
  0.9865, with two taps instead of six from 0.976 (`uBfPre` 1 → 0.34 over p 0.966 … 0.976, then to 0 over
  0.9835 … 0.9865; `hero.js`). That costs 0.1 … 0.2 ms between 0.976 and 0.986 (9.06 ms at 0.976, 9.57 at 0.985). It
  cannot run to 0.99: the frame without it is already 9.8 … 10.0 ms from 0.987 to 0.99 (10.02 at 0.99 in some phases
  of the fanning, which `--sweep` does not sample), so from 0.9865 to about 0.99 the sill is still sharp inside wings
  that are by then going soft.

### World 01 in the first pass

The reflection of the animal in the pane it stands on is 1.3 × Fresnel (was 4); at rest its antennae are held a little
apart (a narrow V from the side). Camera keys, perches and the path did not change. Frame cost at 1920 × 1080 on high
(minimum of three sweeps): 9.58 ms at p = 0 (was 9.35), 8.35 at 0.5 (was 8.16), 9.74 at 0.8 (was 9.72), 9.66 at 1 (was 9.68).

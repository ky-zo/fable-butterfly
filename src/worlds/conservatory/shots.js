// The camera. It is not the butterfly any more: it is a lens that watches one.
//
// Everything here is a pure function of progress — the lens never bobs with a wingbeat, never jolts when the insect
// hits the glass, never sways on its own. Hold progress still and the picture holds still; only the animal moves.
// Each key is a composed shot: where the lens stands, what it looks at (chosen with the butterfly's line of flight in
// mind, so that it is in frame all the way), how long the lens is. Between keys the camera glides.
//
//   0.00  macro: at rest on a glazing bar, backlit, the corridor seen through its wings
//   0.09  it lifts off; the lens lets it go and the glasshouse opens up around it
//   0.19  the one shaft of sun: the animal, and its shadow on the fogged pane
//   0.30  alongside it down the sunlit wall, past the reeded and the etched glass
//   0.48  macro: down on the pane, another on the far side of it
//   0.60  across to the ferns, wider, quieter
//   0.89  the end pane clears; it is down at the foot of all that garden, a hand above the sill
//   0.95  a slow push in to its head, until the eye is the whole picture: facets edge to edge, the garden in each

import * as THREE from 'three';
import { clamp, smoothstep } from '../../core/util.js';
import { PERCH, MM, SHADOW_SPOT, LANDING, OPPOSITE, pathAt, perchBasis, airborne, perchAt } from './heroPath.js';
import { SUN_DIR, WALLS } from './layout.js';
import { EYE as EYE_MM } from '../../shared/butterfly/index.js';

const P0 = PERCH[0].pos;
const P1 = PERCH[1].pos;
const P2 = PERCH[2].pos;
const rel = (o, x, y, z) => [o.x + x, o.y + y, o.z + z];
/** the eye the last shot ends on (the butterfly is head-up on the end pane: its right eye looks along +x) */
export const EYE = new THREE.Vector3();
{
  const R = new THREE.Vector3();
  const F = new THREE.Vector3();
  const U = new THREE.Vector3();
  perchBasis(2, 0, R, F, U);
  EYE.copy(P2).addScaledVector(R, EYE_MM[0] * MM).addScaledVector(F, EYE_MM[1] * MM).addScaledVector(U, EYE_MM[2] * MM);
}

/** from the one inside on the landing pane to half-way to the one outside (an upright frame is aimed between the two) */
const PAIR = new THREE.Vector3().addScaledVector(WALLS[LANDING.wall].u, (OPPOSITE.s - LANDING.s) * 0.5).addScaledVector(WALLS[LANDING.wall].v, (OPPOSITE.t - LANDING.t) * 0.5);

const _h = new THREE.Vector3();
/** A key given from the butterfly's own place on its line at p: lens = there + off, look-at = there + lead. */
const by = (p, off, lead, fov) => {
  pathAt(p, _h);
  return [p, [_h.x + off[0], _h.y + off[1], _h.z + off[2]], [_h.x + lead[0], _h.y + lead[1], _h.z + lead[2]], fov];
};
// the shadow: the lens stands up the shaft of sun, a little to one side, and looks down it at the shade wall
const SHAFT = [SHADOW_SPOT.x + SUN_DIR.x * 0.74 - 0.02, SHADOW_SPOT.y + SUN_DIR.y * 0.74 + 0.03, SHADOW_SPOT.z + SUN_DIR.z * 0.74 + 0.2];
const SHAFT_AT = [SHADOW_SPOT.x - 0.07, SHADOW_SPOT.y + 0.05, SHADOW_SPOT.z - 0.06];

/** [progress, lens position, look-at, vertical field of view] */
const KEYS = [
  [0.0, rel(P0, 0.04, 0.0, 0.28), rel(P0, 0.031, 0.001, 0.0), 12],
  [0.07, rel(P0, 0.056, 0.004, 0.27), rel(P0, 0.03, 0.002, 0.0), 12],
  by(0.104, [0.08, 0.02, 0.4], [0.02, 0.0, -0.1], 30),
  by(0.128, [-0.1, 0.03, 0.74], [0.04, -0.03, -0.2], 34),
  by(0.152, [-0.28, 0.05, 0.46], [0.06, -0.02, -0.08], 33),
  by(0.174, [-0.36, 0.09, 0.08], [0.08, -0.03, 0.0], 32),
  [0.192, SHAFT, SHAFT_AT, 30],
  [0.24, [SHAFT[0] + 0.02, SHAFT[1], SHAFT[2] + 0.04], SHAFT_AT, 30],
  by(0.264, [-0.3, 0.14, 0.34], [0.0, 0.0, -0.04], 32),
  by(0.29, [0.1, 0.04, 0.38], [-0.05, 0.0, -0.08], 33),
  // (along the reeded and the etched glass the lens keeps close: the animal is a quarter of the frame, the glass the rest)
  by(0.32, [0.24, 0.02, 0.2], [-0.05, -0.01, -0.05], 32),
  by(0.352, [0.19, 0.015, 0.13], [-0.035, -0.005, -0.03], 31),
  by(0.386, [0.19, 0.015, 0.13], [-0.035, -0.005, -0.03], 31),
  by(0.42, [0.2, 0.0, 0.14], [-0.035, 0.0, -0.03], 30),
  by(0.452, [0.22, 0.015, 0.15], [-0.04, 0.0, -0.03], 29),
  [0.484, rel(P1, 0.19, -0.004, 0.058), rel(P1, 0.0, 0.014, 0.016), 25],
  [0.544, rel(P1, 0.18, 0.006, 0.04), rel(P1, 0.0, 0.014, 0.016), 24.5],
  by(0.57, [0.3, 0.03, 0.22], [-0.04, 0.0, -0.04], 30),
  by(0.604, [0.24, 0.04, 0.34], [-0.04, -0.01, -0.05], 32),
  by(0.632, [0.02, 0.07, 0.4], [0.0, -0.01, -0.06], 33), // (the lens crosses behind it here: straight astern, so it stays in the middle)
  // (across to the shade wall and along it: nearer than before — it is the subject, the ferns are where it is)
  by(0.66, [-0.2, 0.05, 0.27], [0.03, -0.01, -0.04], 32),
  by(0.71, [-0.21, 0.035, 0.22], [0.04, -0.01, -0.03], 31),
  by(0.758, [-0.22, 0.015, 0.19], [0.04, 0.0, -0.03], 31),
  by(0.8, [-0.17, 0.02, 0.27], [0.02, -0.01, -0.05], 32),
  by(0.84, [-0.08, 0.07, 0.34], [0.0, -0.02, -0.06], 34),
  by(0.866, [0.02, 0.08, 0.36], [-0.01, 0.0, -0.08], 36),
  // down at the foot of the end pane, a hand above the steel sill: the lens low and to one side, so that the sill, the
  // beads on the glass, its feet and what the glass gives back of it are all in the picture — and all that garden
  [0.9, rel(P2, 0.2, 0.035, 0.34), rel(P2, -0.07, 0.06, 0), 36],
  [0.94, rel(P2, 0.16, 0.025, 0.25), rel(P2, -0.045, 0.03, 0), 32],
  [0.966, rel(P2, 0.14, 0.06, 0.2), rel(EYE, -0.02, 0.012, 0), 28],
  [0.984, rel(EYE, 0.11, 0.03, 0.1), rel(EYE, 0, 0.003, 0), 14],
  [1.0, rel(EYE, 0.04, 0.004, 0.01), rel(EYE, 0, 0.0001, -0.00005), 2.05], // the eye is the frame: facets from edge to edge (what world 02 opens on)
];

/** Piecewise-smooth lookup: keys = [[progress, value], …]. */
export function key(keys, p) {
  if (p <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const f = (p - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * f * f * (3 - 2 * f);
    }
  }
  return keys[keys.length - 1][1];
}

// The lens along the way. Aperture 0 = the core's depth of field is not run at all.
export const K_APERTURE = [[0, 1.7], [0.075, 1.7], [0.094, 0], [0.18, 0], [0.192, 1.2], [0.24, 1.2], [0.258, 0], [0.57, 0], [0.6, 1.1], [0.77, 1.2], [0.81, 0], [0.885, 0], [0.9, 1.0], [0.945, 1.1], [0.962, 1.6], [0.985, 3.0], [1, 8.0]];
export const K_BLUR = [[0, 14], [0.09, 12], [0.13, 8], [0.44, 8], [0.48, 12], [0.545, 12], [0.58, 8], [0.95, 8], [0.975, 16], [1, 26]];
export const K_EXPOSURE = [[0, 0.84], [0.08, 0.84], [0.13, 0.88], [0.19, 1.0], [0.24, 1.02], [0.28, 0.86], [0.4, 0.82], [0.48, 0.8], [0.55, 0.8], [0.62, 0.9], [0.75, 1.0], [0.875, 0.84], [1, 0.8]];
/** bloom: less where the frame is one sunlit fogged pane from edge to edge (the shaft): there its veil is over everything, and a black animal in front of it goes to milk */
export const K_BLOOM = [[0, 0.5], [0.17, 0.5], [0.195, 0.2], [0.242, 0.2], [0.27, 0.5], [1, 0.5]];
export const K_TEMP = [[0, 0.05], [0.12, 0.04], [0.19, -0.05], [0.235, -0.07], [0.28, 0.05], [0.44, 0.08], [0.55, 0.08], [0.62, 0.0], [0.75, -0.12], [0.875, 0.04], [1, 0.08]];
export const K_NEAR = [[0, 0.012], [0.96, 0.012], [0.99, 0.004], [1, 0.004]];
/** px of extra defocus per unit of "how far behind the pane": with the lens this close to an animal on the glass, what is behind the pane goes soft with its distance behind (the landing), or is only colour (the last shot) */
export const K_BEHIND = [[0, 0], [0.46, 0], [0.484, 9], [0.544, 9], [0.565, 0], [0.955, 0], [1, 90]];

const N = KEYS.length;
const KP = KEYS.map((k) => k[0]);
function hermite(i, f, get) {
  const i0 = Math.max(0, i - 1);
  const i3 = Math.min(N - 1, i + 2);
  const h = KP[i + 1] - KP[i];
  const p1 = get(i);
  const p2 = get(i + 1);
  const m1 = ((p2 - get(i0)) / (KP[i + 1] - KP[i0])) * h;
  const m2 = ((get(i3) - p1) / (KP[i3] - KP[i])) * h;
  const f2 = f * f;
  const f3 = f2 * f;
  return (2 * f3 - 3 * f2 + 1) * p1 + (f3 - 2 * f2 + f) * m1 + (-2 * f3 + 3 * f2) * p2 + (f3 - f2) * m2;
}

const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _hero = new THREE.Vector3();

/**
 * Place the camera for progress p. In an upright frame (a phone) the lens is widened and turned toward the insect,
 * so that it is still in the picture and still large in it.
 */
export function placeCamera(camera, p, aspect) {
  p = clamp(p, 0, 1);
  let i = 0;
  while (i < N - 2 && p > KP[i + 1]) i++;
  const f = clamp((p - KP[i]) / (KP[i + 1] - KP[i]), 0, 1);
  for (let c = 0; c < 3; c++) {
    _pos.setComponent(c, hermite(i, f, (k) => KEYS[k][1][c]));
    _tgt.setComponent(c, hermite(i, f, (k) => KEYS[k][2][c]));
  }
  const s = f * f * (3 - 2 * f);
  let fov = KEYS[i][3] + (KEYS[i + 1][3] - KEYS[i][3]) * s;
  const tall = clamp((1.25 - aspect) / 0.7, 0, 1);
  if (tall > 0) {
    // an upright frame: turn toward the animal (the middle of its wings when it is down, not its feet) and open the
    // lens, most where the wings would otherwise run out of the sides of the picture
    const air = airborne(p);
    const k = perchAt(p);
    pathAt(p, _hero).addScaledVector(PERCH[k].n, 0.013 * (1 - air));
    const two = k === 1 ? 1 - air : 0; // (the landing: there are two of them in the shot — aim between them, and open until both are whole)
    _hero.addScaledVector(PAIR, two);
    const turn = (0.7 + 0.22 * two) * (1 - smoothstep(0.95, 0.965, p));
    _tgt.lerp(_hero, turn * tall);
    // (not at the very end: there the eye fills an upright frame as it fills a wide one)
    const open = (0.55 + (k === 0 ? 0.5 : 0.15) * (1 - air) + 0.95 * two) * (1 - smoothstep(0.972, 1, p));
    fov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (1 + open * tall)) * 180) / Math.PI;
  }
  camera.position.copy(_pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(_tgt);
  const near = key(K_NEAR, p);
  if (Math.abs(camera.fov - fov) > 1e-4 || camera.near !== near) {
    camera.fov = fov;
    camera.near = near;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
}

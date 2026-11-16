// The camera. A lens that watches the butterfly; never the butterfly's own eyes, and never alive on its own account.
//
// Everything here is a pure function of progress: the lens does not bob with a wingbeat, sway, breathe or drift in
// time. Hold progress still and the picture holds still; only the animal and the points move. Each key is a composed
// shot: where the lens stands, what it looks at (chosen with the line of flight in mind, so the animal is in frame
// all the way), how long the lens is. Between keys it glides.
//
//   0.00  the mosaic: facets edge to edge, the butterfly in front of the dark patch in them
//   0.10  the facets have let go; over its shoulder into the field, the fern coming together on the left
//   0.22  alongside it, flying upwind through the filaments of scent; the cold disc small and far beyond it
//   0.32  the flowers; the marks only it can see come up
//   0.37  macro: down on the big flower, the runway lines under its feet
//   0.53  the eye: the butterfly small against it
//   0.60  the glass, square on, drawing itself outward
//   0.70  on the glass, the sheet running away to the left, the other one behind it, the cold disc at its far end
//   0.83  along the glass and out, toward the cold
//   1.00  the last picture: disc, road of glitter, the butterfly from behind. World 03 opens on this.

import * as THREE from 'three';
import { clamp, smoothstep } from '../../core/util.js';
import { ST, STATIONS, PERCH, END, END_FOV, CAM_END_LOOK, MOON_WORLD, pathAt, inStation, makeTrack, airborne, perchAt } from './config.js';

const _h = new THREE.Vector3();
/** A key given from the butterfly's own place on its line at p: lens = there + off, look-at = there + lead. */
const by = (p, off, lead, fov, turn = 0.7, open = 0.5, hold = 0) => {
  pathAt(p, _h);
  return [p, _h.x + off[0], _h.y + off[1], _h.z + off[2], _h.x + lead[0], _h.y + lead[1], _h.z + lead[2], fov, turn, open, hold];
};
/** A key given in a region's own frame (x right, y up, z out of its face). */
const at = (p, st, pos, look, fov, turn = 0.7, open = 0.5, hold = 0) => {
  const a = inStation(st, ...pos);
  const b = inStation(st, ...look);
  return [p, a.x, a.y, a.z, b.x, b.y, b.z, fov, turn, open, hold];
};
const abs = (p, pos, look, fov, turn = 0.7, open = 0.5, hold = 0) => [p, ...pos, ...look, fov, turn, open, hold];

const eyeC = STATIONS[ST.EYE].c;
/** A key for the eye: `back` behind the butterfly on the line to the eye, `side` to the right of it, `up` above. */
/** (`reach`: the same view, with its look-at point given that far from the lens instead of at the eye. On the way from
 * one shot to another a look-at point glides too, and one that has ten units to go turns the lens more gently than one
 * that has fifty.) */
const eyeShot = (p, back, side, up, lookSide, lookUp, fov, reach = 0) => {
  pathAt(p, _h);
  const d = eyeC.clone().sub(_h).normalize();
  const r = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
  const c = _h.clone().addScaledVector(d, -back).addScaledVector(r, side);
  c.y += up;
  const l = eyeC.clone().addScaledVector(r, lookSide);
  l.y += lookUp;
  if (reach > 0) l.sub(c).setLength(reach).add(c);
  return [p, c.x, c.y, c.z, l.x, l.y, l.z, fov, 0.6, 0.6, 0];
};

const F = PERCH[0].at;
const G = PERCH[1].at;

/**
 * [progress, lens xyz, look-at xyz, vertical field of view, turn, open, hold]
 * turn / open are for an upright screen: how far the lens turns toward the animal, and how much wider it gets.
 */
const KEYS = [
  by(0.0, [1.75, 0.8, 7.4], [1.5, 0.08, 0], 34, 1, 0.36, 1),
  by(0.04, [1.7, 0.85, 7.2], [1.4, 0.1, 0], 34, 1, 0.36),
  by(0.1, [2.3, 1.2, 6.9], [-0.9, 0.0, -8], 35, 0.8, 0.5),
  by(0.16, [2.2, 1.1, 6.6], [-2.6, -0.5, -7], 35, 0.75, 0.55),
  by(0.2, [5.6, 0.9, 3.4], [-1.0, 0.0, -4], 34, 0.8, 0.6),
  by(0.235, [6.8, 0.5, -0.4], [0, 0.15, -1.4], 33, 0.85, 0.75),
  by(0.275, [6.2, 0.7, 1.6], [0, 0.3, -2.6], 33, 0.85, 0.75),
  by(0.315, [2.4, 2.0, 7.0], [0.2, -1.0, -6], 34, 0.6, 0.6),
  at(0.345, ST.FOOD, [1.4, 2.8, 10.6], [0.25, 0.0, 0], 31, 0.5, 0.55),
  at(0.372, ST.FOOD, [F[0] - 2.6, F[1] + 1.6, 8.6], [F[0] - 0.25, F[1] - 0.1, 0], 30, 0.6, 0.5),
  at(0.425, ST.FOOD, [F[0] - 1.6, F[1] + 2.0, 6.4], [F[0] - 0.15, F[1] - 0.05, 0], 29, 0.6, 0.5),
  eyeShot(0.45, 6.4, 2.2, 0.9, -11.0, -6.5, 33, 9),
  eyeShot(0.468, 7.8, 3.2, 1.2, -8.5, -2.6, 36, 14),
  eyeShot(0.485, 8.6, 2.8, 1.0, -7.5, -1.4, 37),
  // the eye: the lens stands behind the butterfly and to one side of the line from it to the eye, so that the animal
  // is low on the left, against the dark, and the eye is the rest of the picture
  eyeShot(0.505, 7.4, 2.0, 0.9, -5.5, -1.2, 38),
  eyeShot(0.535, 6.2, 2.6, 0.7, -5.0, -0.9, 38),
  eyeShot(0.562, 6.6, 3.2, 0.5, -4.5, -0.6, 38),
  by(0.59, [5.0, 0.6, 8.6], [1.8, -0.8, -9], 36, 0.7, 0.5),
  by(0.635, [-1.0, 0.8, 9.5], [1.0, -0.6, -8], 35, 0.7, 0.5),
  at(0.675, ST.PANE, [G[0] + 5.2, G[1] + 0.5, 4.3], [G[0] - 4.2, G[1] + 0.35, 0], 33, 0.8, 0.7),
  at(0.745, ST.PANE, [G[0] + 5.9, G[1] + 0.7, 3.6], [G[0] - 4.6, G[1] + 0.4, 0], 32, 0.8, 0.7),
  // out along the glass: behind it and off to one side, so that its wings are seen and the cold disc is ahead of it
  by(0.79, [7.0, 1.6, 4.0], [-12, -0.4, -2.5], 34, 0.9, 0.5),
  by(0.845, [8.0, 1.6, 4.5], [-30, -2.5, -5.5], 34, 0.85, 0.4),
  by(0.925, [13, 2.2, 3.4], [-60, -4.5, -6], 34, 0.6, 0.2),
  abs(1.0, END.o.toArray(), CAM_END_LOOK.toArray(), END_FOV, 0, 0, 1),
];
const track = makeTrack(KEYS.map((k) => [...k.slice(0, 10), k[10]]), 9);

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

// The lens along the way.
/** aperture: nearly shut on the mosaic (every facet sharp), open in the field, shut down again for the last picture */
export const K_APERTURE = [[0, 1.2], [0.02, 1.6], [0.1, 15], [0.17, 17], [0.21, 9], [0.28, 9], [0.31, 18], [0.34, 18], [0.37, 15], [0.43, 15], [0.47, 18], [0.5, 12], [0.57, 12], [0.6, 18], [0.64, 16], [0.67, 5.5], [0.76, 5.5], [0.8, 12], [0.86, 6], [0.92, 3.5], [0.97, 2.2], [1, 1.6]];
export const K_EXPOSURE = [[0, 0.92], [0.06, 0.96], [0.14, 1.0], [0.34, 1.0], [0.38, 1.05], [0.44, 1.0], [0.8, 1.0], [1, 1.02]];
export const K_TEMP = [[0, 0.07], [0.1, 0.05], [0.3, 0.02], [0.5, -0.02], [0.7, -0.05], [0.85, -0.1], [1, -0.16]];
export const K_BLOOM = [[0, 0.34], [0.08, 0.42], [0.16, 0.5], [0.9, 0.5], [1, 0.56]];

const _v = new Array(9).fill(0);
const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _hero = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * Place the camera for progress p. In an upright frame (a phone) the lens is turned toward the animal and opened, so
 * that it is still in the picture and still large in it — except in the last shot, which is the same lens on any
 * screen. Returns the distance along the lens' axis to the butterfly's place on its line (for focus).
 */
export function placeCamera(camera, p, aspect) {
  p = clamp(p, 0, 1);
  track(p, _v);
  _pos.set(_v[0], _v[1], _v[2]);
  _tgt.set(_v[3], _v[4], _v[5]);
  let fov = _v[6];
  pathAt(p, _hero);
  const tall = clamp((1.25 - aspect) / 0.7, 0, 1);
  if (tall > 0) {
    // (when it is down, look at the middle of its wings, not its feet)
    const k = perchAt(p);
    _h.copy(_hero).addScaledVector(PERCH[k].n, 0.35 * (1 - airborne(p)));
    // keep it a little above the middle of an upright frame: the caption sits low
    _h.y -= 0.035 * _pos.distanceTo(_hero) * (1 - smoothstep(0.9, 1, p));
    _tgt.lerp(_h, clamp(_v[7], 0, 1) * tall);
    fov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (1 + Math.max(0, _v[8]) * tall)) * 180) / Math.PI;
  }
  if (tall > 0) {
    // The way out, in an upright frame. Off to one side of the animal, as the wide frame has it, the cold disc is far
    // outside a narrow picture. So the lens is brought in toward the line from the disc through the animal and aimed
    // between the two: disc above and to the left, the animal below it, the road of light coming down between them.
    // (Still nothing but progress and the shape of the frame; and it is over before the last picture, which is the
    // same lens on every screen.)
    const w = tall * smoothstep(0.752, 0.805, p) * (1 - smoothstep(0.93, 0.995, p));
    if (w > 0) {
      _a.copy(_hero).sub(MOON_WORLD).setY(0).normalize(); // from the disc toward the animal, level
      _b.copy(_pos).sub(_hero);
      const back = _b.dot(_a);
      const up = _b.y;
      _b.addScaledVector(_a, -back).setY(0); // what is left: how far to one side the lens stands
      _c.copy(_hero).addScaledVector(_a, back * 1.12).addScaledVector(_b, 0.36);
      _c.y += up + 0.6;
      _pos.lerp(_c, w);
      // aim: between the animal and the disc, a little nearer the animal
      _a.copy(_hero).sub(_pos).normalize();
      _b.copy(MOON_WORLD).sub(_pos).normalize();
      _a.lerp(_b, 0.47 * smoothstep(0.775, 0.835, p)).normalize();
      _c.copy(_pos).addScaledVector(_a, 20);
      _tgt.lerp(_c, w);
    }
  }
  camera.position.copy(_pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(_tgt);
  if (Math.abs(camera.fov - fov) > 1e-4 || camera.aspect !== aspect) {
    camera.fov = fov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  _tgt.sub(_pos).normalize();
  return Math.max(1.5, _h.copy(_hero).sub(_pos).dot(_tgt));
}

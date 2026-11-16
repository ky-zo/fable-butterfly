// The planting that is composed rather than grown: leaves laid against particular panes for particular shots, and
// the gaps cut through the garden so that the low sun can find them.
//
// A pressed leaf: [wall, s, t, type, size, angle, options]
//   wall 0 left (sunlit) / 1 right (shade) / 2 end; (s, t) = where the base of the blade touches, in wall metres;
//   angle = direction of the blade in the plane of the pane (0 = up, + = toward +s);
//   tilt  = how much the tip leans away from the glass (it melts into the fog as it goes); back = show the underside.

export const PRESSED = [
  // --- first bays, for the wide shot: big readable shapes on both sides
  [0, 1.55, 0.95, 'monstera', 0.34, 0.5, { tilt: 0.1, roll: 0.2 }],
  [0, 2.6, 1.5, 'paddle', 0.5, -0.4, { tilt: 0.05 }],
  [0, 3.4, 0.5, 'fern', 0.75, 0.25, { back: true }],
  [0, 4.55, 1.25, 'monstera', 0.3, -0.7, { tilt: 0.16, back: true }],
  [1, 1.5, 0.7, 'fern', 0.8, -0.3, { back: true }],
  [1, 2.45, 1.35, 'monstera', 0.32, 0.6, { tilt: 0.12 }],
  [1, 3.12, 0.3, 'fern', 0.7, -0.25, { back: true }],
  [1, 4.4, 1.6, 'paddle', 0.46, 2.6, { tilt: 0.08 }],

  // --- the medium shot along the sunlit wall (panes s = 5 … 8): leaves at every distance from the glass
  [0, 5.45, 0.9, 'paddle', 0.55, 0.2, { tilt: 0.03, roll: 0.3 }],
  [0, 5.7, 1.75, 'fern', 0.6, 2.2, { tilt: 0.1 }],
  [0, 6.5, 1.15, 'monstera', 0.36, -0.35, { tilt: 0.05, roll: -0.15 }],
  [0, 6.62, 0.3, 'fern', 0.85, 0.1, { back: true }],
  [0, 7.4, 1.6, 'paddle', 0.42, 2.4, { tilt: 0.14 }],
  [0, 7.55, 0.55, 'monstera', 0.3, 0.9, { tilt: 0.22, back: true }],

  // --- the macro pane (s = 8 … 9): one big leaf flat on the glass, a frond and a second leaf leaning away behind it
  [0, 8.346, 1.146, 'monstera', 0.29, 0.9, { tilt: 0.0, hero: 2, sen: 0.1, hue: 0.3, value: 0.85 }],
  [0, 8.84, 0.98, 'fern', 0.52, -0.3, { tilt: 0.05, out: 0.03, loose: true }],
  [0, 8.3, 0.4, 'fern', 0.7, 0.3, { tilt: 0.05 }],

  // --- past the macro, still sunlit
  [0, 9.5, 1.3, 'paddle', 0.5, -0.2, { tilt: 0.06 }],
  [0, 10.6, 0.8, 'monstera', 0.38, 0.4, { tilt: 0.1 }],
  [0, 11.5, 1.5, 'fern', 0.7, 2.7, { tilt: 0.08 }],
  [0, 12.5, 0.9, 'monstera', 0.33, -0.5, { tilt: 0.12, back: true }],
  [0, 13.4, 1.4, 'paddle', 0.5, 0.3, { tilt: 0.05 }],

  // --- the shade wall beat (panes s = 10 … 12): ferns laid out like pressed specimens, cool and blue.
  // `back` fronds arch INTO the glass and lie completely flat; the others lift away toward their tips.
  [1, 10.42, 0.42, 'fern', 0.8, 0.3, { back: true }],
  [1, 10.8, 0.5, 'fern', 0.6, -0.35, { tilt: 0.05 }],
  [1, 10.5, 1.62, 'fern', 0.6, 2.5, { tilt: 0.1, out: 0.01 }],
  [1, 11.42, 0.72, 'fern', 0.62, 0.38, { back: true, hero: 2 }],
  [1, 11.95, 0.78, 'fern', 0.5, -0.55, { back: true }],
  [1, 11.3, 0.7, 'fern', 0.55, -0.8, { tilt: 0.1, out: 0.02, loose: true }],
  [1, 11.72, 1.9, 'monstera', 0.3, 2.9, { tilt: 0.2, out: 0.02 }],
  [1, 12.4, 1.1, 'paddle', 0.5, -0.25, { tilt: 0.06 }],
  [1, 9.4, 1.2, 'monstera', 0.36, 0.5, { tilt: 0.08 }],
  [1, 8.5, 0.6, 'fern', 0.9, -0.2, { back: true }],
  [1, 7.5, 1.4, 'paddle', 0.5, 2.8, { tilt: 0.1 }],
  [1, 6.4, 0.8, 'fern', 0.85, 0.4, { tilt: 0.04 }],
  [1, 5.5, 1.5, 'monstera', 0.3, -0.6, { tilt: 0.15, back: true }],
  [1, 13.3, 0.7, 'fern', 0.9, 0.2, { back: true }],

  // --- the end pane: a few leaves on the glass that stay sharp while everything else is still fog
  [2, 0.42, 0.75, 'monstera', 0.36, 0.5, { tilt: 0.06 }],
  [2, 1.95, 0.4, 'fern', 0.8, -0.35, { tilt: 0.05 }],
  [2, 1.75, 1.75, 'paddle', 0.42, 2.7, { tilt: 0.12 }],
];

/** Sun gaps: [wall, s, t, radius, length] — a tunnel cut through the foliage from that point on the pane toward the sun. */
export const CLEARINGS = [
  [0, 8.7, 1.3, 0.3, 13],
  [0, 6.55, 1.35, 0.22, 13],
  [0, 6.5, 2.45, 0.44, 14], // the sun gate: one clear upper pane lets a whole shaft across the corridor
  [0, 2.05, 1.38, 0.42, 16], // the first rest: the low sun finds the pane behind it, and the fog hands it on as a soft key
  [2, 1.15, 1.6, 0.36, 13],
  [2, 2.08, 0.15, 0.34, 14], // the last rest: sun on the foot of the end pane, to put its shadow on the sill
  // (wall -1: a gap that begins in the garden itself — the sun has to reach the pool and the first stones of the path)
  [-1, [1.2, 0.3, -20.0], 0, 1.3, 15],
  [-1, [-0.4, 0.3, -16.6], 0, 0.8, 15],
];

/**
 * Panes kept quiet: [wall, s0, s1, t0, t1, depth] — nothing grows on its own within `depth` metres behind that
 * rectangle of glass, so the composed leaves there stand against open garden.
 */
export const QUIET = [
  [0, 8.03, 8.97, 0.7, 1.85, 0.5],
  [1, 10.03, 11.97, 0.25, 2.0, 0.3],
  [1, 3.35, 4.0, 0.4, 1.6, 0.4], // the screen for the visitor's shadow
];

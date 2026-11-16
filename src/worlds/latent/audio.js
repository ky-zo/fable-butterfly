// LATENT — sound. A very quiet airy bed, a low room tone, and a high shimmer that swells slowly (a swell, never a
// hit) each time a region of the map comes together into a thing. Nothing here is triggered: every level is a
// function of where the visitor is on the journey, so scrolling backwards un-swells it. At the end the air closes
// down and one cold tone is left: the disc.

import { midi } from '../../core/Audio.js';
import { NS, ST, timeline } from './config.js';

// one pale triad per region, all from the same pentatonic set, so that moving on never jars
const CHORDS = [
  [79, 86, 91], // fern
  [81, 88, 93], // food
  [76, 82, 91], // the eye: the one chord with a note out of the set
  [84, 88, 93], // the glass
  [76, 83, 88], // cold
];

export function createLatentAudio(bus) {
  const ctx = bus.ctx;
  const air = bus.noise({ color: 'pink', gain: 0.011, type: 'bandpass', freq: 1100, q: 0.45, attack: 6, lfoRate: 0.043, lfoDepth: 0.35 });
  const hiss = bus.noise({ color: 'white', gain: 0.0022, type: 'highpass', freq: 5200, q: 0.3, attack: 8, lfoRate: 0.071, lfoDepth: 0.5, pan: 0.2 });
  const room = bus.drone({ freqs: [midi(43), midi(50)], type: 'sine', gain: 0.03, detune: 4, attack: 9, filter: 420, lfoRate: 0.05, lfoDepth: 0.3 });
  const shimmer = bus.drone({ freqs: CHORDS[0].map(midi), type: 'sine', gain: 0.0001, detune: 7, attack: 2, filter: 5200, q: 0.2, lfoRate: 0.23, lfoDepth: 0 });
  const cold = bus.drone({ freqs: [midi(64), midi(71)], type: 'sine', gain: 0.0001, detune: 3, attack: 4, filter: 1800, lfoRate: 0.031, lfoDepth: 0.2 });
  const tl = timeline(0);
  let chord = 0;
  let acc = 1;

  return {
    update(frame) {
      // a few times a second is plenty; the params glide
      acc += frame.dt;
      if (acc < 0.12) return;
      acc = 0;
      const t = ctx.currentTime;
      timeline(frame.progress, tl);
      // which region is nearest to being a thing, and how much it is changing
      let best = 0;
      let crest = 0;
      let hold = 0;
      for (let i = 0; i < NS - 1; i++) {
        const c = tl.cond[i];
        if (c > tl.cond[best]) best = i;
        crest = Math.max(crest, 4 * c * (1 - c));
        hold = Math.max(hold, c);
      }
      const level = 0.0165 * (0.55 * crest * hold + 0.3 * hold + 0.35 * tl.uv) * (1 - tl.fin);
      shimmer.gain.gain.setTargetAtTime(level, t, 0.9);
      // retune only while the shimmer is nearly silent (between regions)
      if (best !== chord && level < 0.004) {
        chord = best;
        shimmer.oscs.forEach((o, k) => o.frequency.setTargetAtTime(midi(CHORDS[best][k >> 1]), t, 0.6));
      }
      // following scent: the air moves a little more, and opens up; at the end it closes down
      air.gain.gain.setTargetAtTime((0.011 + 0.007 * tl.plume) * (1 - 0.6 * tl.fin), t, 1.2);
      air.filter.frequency.setTargetAtTime(1100 + 600 * tl.plume - 500 * tl.fin, t, 1.5);
      hiss.gain.gain.setTargetAtTime((0.0022 + 0.0014 * tl.plume) * (1 - 0.8 * tl.fin), t, 1.5);
      room.gain.gain.setTargetAtTime(0.03 - 0.006 * tl.plume, t, 2.0);
      cold.gain.gain.setTargetAtTime(0.012 * tl.fin + 0.004 * tl.cond[ST.COLD], t, 2.0);
    },
  };
}

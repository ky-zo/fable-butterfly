// Sound: the air of a glasshouse before the sun is on it, one low tone for the strand everything hangs from, and a
// string for whatever is pulled tight (a pitch per thing; it is struck as the strands to it tighten, and rings).

import { midi } from '../../core/Audio.js';
import { clamp, smoothstep } from '../../core/util.js';

// leaf, water, light, glass, the pad
const NOTES = [69, 64, 72, 76, 57];
const PAN = [-0.4, 0.0, 0.45, -0.3, 0.0];

export function buildAudio(bus, world) {
  bus.noise({ color: 'brown', gain: 0.018, type: 'lowpass', freq: 160, q: 0.3, lfoRate: 0.05, lfoDepth: 0.25 });
  const air = bus.noise({ color: 'pink', gain: 0.004, type: 'bandpass', freq: 1500, q: 0.5, lfoRate: 0.07, lfoDepth: 0.3 });
  const layer = (notes, filter, pan) => bus.drone({ freqs: notes.map((n) => midi(n)), type: 'sine', gain: 0.0001, detune: 4, attack: 4, filter, lfoDepth: 0, pan });
  const low = layer([45, 52], 480, 0);
  const strings = NOTES.map((n, i) => layer([n, n + 7], 1500, PAN[i]));
  const was = NOTES.map(() => 0);
  let lastBell = -10;

  return {
    update(frame) {
      const now = bus.ctx.currentTime;
      const p = frame.progress;
      const set = (d, v) => d.gain.gain.setTargetAtTime(Math.max(0.0001, v), now, 0.5);
      // the one strand: there from the start, alone at the end
      set(low, 0.028 * (0.6 + 0.4 * smoothstep(0.7, 0.95, p)));
      for (let i = 0; i < NOTES.length; i++) {
        const a = world.att ? world.att[i] : 0;
        set(strings[i], 0.012 * a);
        // struck as it pulls tight
        if (frame.dt > 0 && was[i] < 0.5 && a >= 0.5 && now - lastBell > 0.4) {
          lastBell = now;
          bus.bell({ freq: midi(NOTES[i]), gain: 0.03, decay: 5, pan: PAN[i], partials: [1, 2.0, 3.01] });
        }
        was[i] = a;
      }
      air.filter.frequency.setTargetAtTime(1300 + 500 * clamp(world.iso || 0) + Math.min(1, Math.abs(frame.velocity) * 20) * 500, now, 0.4);
    },
  };
}

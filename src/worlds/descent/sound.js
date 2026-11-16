// Sound for DESCENT: night air over open ground, a low tone that warms as the lamp comes near, the faint dry flutter
// of the others round it, and at first light the air opening out.

import { midi } from '../../core/Audio.js';
import { smoothstep } from '../../core/util.js';
import { key, K_DAWN, K_OPEN } from './shots.js';

export function createDescentAudio(bus, world) {
  const windLow = bus.noise({ color: 'brown', gain: 0.028, type: 'lowpass', freq: 210, q: 0.5, attack: 5, lfoRate: 0.045, lfoDepth: 0.5, pan: -0.25 });
  const windHigh = bus.noise({ color: 'pink', gain: 0.005, type: 'bandpass', freq: 520, q: 0.6, attack: 7, lfoRate: 0.031, lfoDepth: 0.6, pan: 0.3 });
  const deep = bus.drone({ freqs: [midi(26), midi(33)], type: 'sine', gain: 0.04, detune: 5, attack: 8, filter: 240, lfoRate: 0.05, lfoDepth: 0.3 });
  // the lamp: a warm voice that is only there near it
  const warm = bus.drone({ freqs: [midi(38), midi(45), midi(50)], type: 'triangle', gain: 0.0001, detune: 7, attack: 10, filter: 320, lfoRate: 0.07, lfoDepth: 0.0, pan: 0.1 });
  // wings round the flame: very soft, very dry
  const flutter = bus.noise({ color: 'white', gain: 0.0001, type: 'bandpass', freq: 3600, q: 1.4, attack: 3, lfoRate: 5.3, lfoDepth: 0.5, pan: -0.1 });
  // morning: a high clear tone, far off
  const day = bus.drone({ freqs: [midi(69), midi(76)], type: 'sine', gain: 0.0001, detune: 4, attack: 12, filter: 1800, lfoRate: 0.04, lfoDepth: 0.2, pan: 0.2 });
  return {
    update(frame) {
      const p = frame.progress;
      const lamp = world.plan ? world.plan.LAMP : null;
      const near = lamp && world.hero ? 1 / (1 + world.hero.position.distanceToSquared(lamp) * 0.06) : 0;
      const dawn = key(K_DAWN, p);
      const open = key(K_OPEN, p);
      bus.ramp(warm.gain.gain, 0.001 + 0.032 * near * (1 - 0.6 * dawn), 1.5);
      bus.ramp(warm.filter.frequency, 260 + 520 * near, 1.5);
      bus.ramp(flutter.gain.gain, 0.0001 + 0.006 * near * near * (1 - open), 1.0);
      bus.ramp(day.gain.gain, 0.0001 + 0.012 * dawn * dawn, 2.0);
      bus.ramp(deep.filter.frequency, 220 + 160 * smoothstep(0.1, 0.5, p), 1.5);
      bus.ramp(windLow.gain.gain, 0.028 - 0.01 * near, 1.5);
      bus.ramp(windHigh.gain.gain, 0.005 + 0.004 * dawn, 1.5);
    },
  };
}

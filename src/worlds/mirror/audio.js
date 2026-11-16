// Mirror — sound. Near silence: a very low pair of sines beating slowly against each other, a little air, glass when
// the liquid is touched, and the smallest tick for each foot it sets down on the steel. Everything is driven by
// counters the picture keeps (touch / shatter / merge / steps), so the sound can never drift away from what is on screen.

import { midi } from '../../core/Audio.js';

export function createMirrorAudio(bus, world) {
  const form = world.form;
  const hero = world.hero;
  const low = bus.drone({ freqs: [46.25], type: 'sine', gain: 0.05, detune: 5, attack: 8, filter: 220, lfoRate: 0.031, lfoDepth: 0.3 });
  const fifth = bus.drone({ freqs: [69.3, 92.5], type: 'sine', gain: 0.014, detune: 3, attack: 12, filter: 300, lfoRate: 0.047, lfoDepth: 0.5, pan: 0.15 });
  const air = bus.noise({ color: 'pink', gain: 0.004, type: 'bandpass', freq: 1800, q: 0.8, attack: 10, lfoRate: 0.021, lfoDepth: 0.6 });

  const seen = { ...form.events, steps: hero.steps, touches: world.touches };
  let sinceTouch = 9;
  let wasScattered = false;
  const scale = [0, 3, 7, 10, 14];
  const pick = () => scale[Math.floor(Math.random() * scale.length)];
  const glass = [1, 2.004, 3.01, 4.23];

  return {
    update(frame) {
      const ev = form.events;
      const inside = world.inside || 0;
      sinceTouch += frame.dt;
      if (ev.touch !== seen.touch) {
        if (sinceTouch > 0.16 && inside > 0.5) {
          bus.bell({ freq: midi(78 + pick()), gain: 0.024, decay: 3.6, pan: Math.random() * 0.8 - 0.4, partials: glass });
          sinceTouch = 0;
        }
        seen.touch = ev.touch;
      }
      if (ev.shatter !== seen.shatter) {
        for (let i = 0; i < 6; i++) bus.bell({ freq: midi(86 + pick() + (i % 2) * 12), gain: 0.015, decay: 2.2 + Math.random() * 2, pan: Math.random() * 1.6 - 0.8, partials: glass, when: i * 0.045 + Math.random() * 0.05 });
        seen.shatter = ev.shatter;
      }
      if (ev.merge !== seen.merge) {
        if (Math.random() < 0.3) bus.bell({ freq: midi(66 + pick()), gain: 0.012, decay: 2.4, pan: Math.random() * 1.2 - 0.6, partials: [1, 2.0, 3.0] });
        seen.merge = ev.merge;
      }
      if (wasScattered && !form.scattered) bus.bell({ freq: midi(54), gain: 0.028, decay: 7, pan: 0, partials: [1, 2.0, 3.0] });
      wasScattered = form.scattered;
      if (world.touches !== seen.touches) {
        // the shell, touched: dry, small
        bus.bell({ freq: midi(70 + pick()), gain: 0.012, decay: 0.7, pan: 0.1, partials: [1, 2.4] });
        seen.touches = world.touches;
      }
      if (hero.steps !== seen.steps) {
        bus.bell({ freq: midi(96 + pick()), gain: 0.006, decay: 0.25, pan: -0.2, partials: [1, 1.5] });
        seen.steps = hero.steps;
      }
      // inside, the low tone opens a little; outside there is more air than tone
      low.filter.frequency.value = 190 + 200 * form.restless * inside;
      bus.ramp(low.gain.gain, 0.03 + 0.02 * inside, 1.5);
      bus.ramp(fifth.gain.gain, 0.006 + 0.012 * inside * (0.5 + 0.8 * form.restless), 1.5);
      bus.ramp(air.gain.gain, 0.004 * (1 - 0.6 * inside), 2);
    },
  };
}

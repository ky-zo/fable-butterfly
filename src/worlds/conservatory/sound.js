// Room tone of a humid glasshouse: slow air, a low drone, single drops falling somewhere into a long room — and, very
// quietly, the one who is flying in it: the papery flutter of each wingbeat that is seen (silent in the glide, silent
// when it is down), nearer or farther and to one side or the other as the butterfly is in the picture; the small dull
// tap of a body against glass; the whisper of a wing brushed through the fog.
// Nothing here is bright; the tap is the only thing with an edge, and it is soft.

import { midi } from '../../core/Audio.js';

export function createSound(bus, world) {
  const ctx = bus.ctx;
  // the air itself, and the finer hiss of leaves moving outside the glass
  bus.noise({ color: 'brown', gain: 0.024, type: 'lowpass', freq: 380, q: 0.4, attack: 5, lfoRate: 0.045, lfoDepth: 0.3 });
  bus.noise({ color: 'pink', gain: 0.0042, type: 'bandpass', freq: 2500, q: 0.6, attack: 8, lfoRate: 0.07, lfoDepth: 0.5, pan: -0.3 });
  const drone = bus.drone({ freqs: [midi(38), midi(45), midi(52)], type: 'sine', gain: 0.034, detune: 5, attack: 9, filter: 420, lfoRate: 0.04, lfoDepth: 0.3 });

  // drips: soft sine blips, sometimes followed by a second, smaller one
  const notes = [79, 81, 84, 86, 88, 91];
  bus.every(2.8, 8.5, () => {
    const n = notes[Math.floor(Math.random() * notes.length)];
    const pan = (Math.random() * 2 - 1) * 0.7;
    bus.bell({ freq: midi(n) * (1 + (Math.random() - 0.5) * 0.02), gain: 0.012 + Math.random() * 0.014, decay: 0.5 + Math.random() * 0.5, pan, partials: [1, 2.02] });
    if (Math.random() < 0.3) bus.bell({ freq: midi(n - 5), gain: 0.008, decay: 0.45, pan, partials: [1], when: 0.11 + Math.random() * 0.12 });
  });

  // a wing on wet glass: band-passed noise that follows how fast the fog is being brushed
  const rub = bus.noise({ color: 'pink', gain: 0, type: 'bandpass', freq: 1100, q: 1.4, attack: 0.3, lfoDepth: 0 });
  // wingbeats: two bands of noise, shut except for a few hundredths of a second on each downstroke; a panner each,
  // so that the flutter comes from where the butterfly is
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const flutLo = bus.noise({ color: 'pink', gain: 0, type: 'bandpass', freq: 780, q: 0.8, attack: 0.05, lfoDepth: 0 });
  const flutHi = bus.noise({ color: 'white', gain: 0, type: 'bandpass', freq: 2900, q: 0.7, attack: 0.05, lfoDepth: 0 });
  if (pan) {
    for (const n of [flutLo, flutHi]) {
      try {
        n.gain.disconnect();
        n.gain.connect(pan);
      } catch {
        /* (left where the bus put it) */
      }
    }
    pan.connect(bus.input);
  }
  const ndc = { x: 0, y: 0, z: 0 };
  let open = -1;
  let lastBeat = -1;
  let lastTap = world.taps || 0;
  /** where the butterfly is for the ear: -1..1 across the picture, and 0..1 how near the lens */
  const place = () => {
    const h = world.hero;
    const cam = world.camera;
    const e = cam.matrixWorldInverse.elements;
    const p = h.position;
    const x = e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12];
    const z = -(e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14]);
    ndc.x = Math.max(-1, Math.min(1, (x / Math.max(z, 0.05)) * 1.6));
    ndc.z = Math.max(0.25, Math.min(1, 0.35 / Math.max(z, 0.1)));
    return ndc;
  };
  return {
    dispose() {
      if (pan) pan.disconnect();
    },
    update() {
      const t = ctx.currentTime;
      const r = world.steer ? world.steer.rub : 0;
      rub.gain.gain.setTargetAtTime(0.006 * r, t, 0.09);
      rub.filter.frequency.setTargetAtTime(800 + 700 * r, t, 0.2);

      // one soft puff per downstroke of the wings that are on screen
      const h = world.hero;
      if (h) {
        const b = h.beat;
        const at = place();
        if (pan) pan.pan.setTargetAtTime(at.x * 0.7, t, 0.08);
        if (b.index >= 0 && b.index !== lastBeat && b.beating > 0.1 && h.air > 0.5 && !h.reduced) {
          const k = b.beating * h.air * at.z;
          const jit = 0.8 + Math.random() * 0.4;
          flutLo.gain.gain.cancelScheduledValues(t);
          flutLo.gain.gain.setTargetAtTime(0.0052 * k * jit, t, 0.014);
          flutLo.gain.gain.setTargetAtTime(0, t + 0.045, 0.04);
          flutHi.gain.gain.cancelScheduledValues(t);
          flutHi.gain.gain.setTargetAtTime(0.0016 * k * jit, t + 0.006, 0.01);
          flutHi.gain.gain.setTargetAtTime(0, t + 0.035, 0.028);
          flutLo.filter.frequency.setTargetAtTime(700 + Math.random() * 180, t, 0.02);
        }
        lastBeat = b.index;
      }

      // the tap: a low, short, round knock (and nothing above it), from where the glass was hit
      if (world.taps !== lastTap) {
        lastTap = world.taps;
        const at = place();
        const s = Math.min(1, world.tapStrength || 0.5) * at.z;
        bus.bell({ freq: 128 + Math.random() * 26, gain: 0.03 * s, decay: 0.13, pan: at.x * 0.6, partials: [1, 1.52] });
        bus.bell({ freq: 410 + Math.random() * 60, gain: 0.006 * s, decay: 0.05, pan: at.x * 0.6, partials: [1] });
      }

      // when the end wall lets go of its fog the room opens a little
      const clear = Math.round(world.U.uClear.value * 20) / 20;
      if (clear !== open) {
        open = clear;
        drone.filter.frequency.setTargetAtTime(420 + 480 * clear, t, 0.8);
      }
    },
  };
}

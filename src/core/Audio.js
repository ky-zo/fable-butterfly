// Procedural ambient audio. No samples: everything is synthesised with WebAudio.
// Deliberately conservative: soft sines, filtered noise, long reverb, low gains, a limiter on the master.

export const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

function makeImpulse(ctx, seconds = 5.5, decay = 2.4) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // darker tail over time: one-pole lowpass whose cutoff falls as the tail decays
      const a = 0.55 - 0.45 * t;
      lp += (rnd() - lp) * a;
      const pre = Math.min(1, i / (rate * 0.012));
      d[i] = lp * Math.pow(1 - t, decay) * pre;
    }
  }
  return buf;
}

function makeNoise(ctx, seconds, color) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      } else if (color === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      } else d[i] = w * 0.6;
    }
    // crossfade the loop seam
    const x = Math.floor(ctx.sampleRate * 0.25);
    for (let i = 0; i < x; i++) {
      const t = i / x;
      d[i] = d[i] * t + d[len - x + i] * (1 - t);
    }
  }
  return buf;
}

/**
 * A world's private mixer channel. Everything created through it is tracked and torn down on dispose().
 * All gains here are LINEAR and should stay small: a drone at 0.03–0.06, noise beds 0.01–0.04, bells 0.03–0.08.
 */
export class Bus {
  constructor(engine) {
    this.engine = engine;
    const ctx = (this.ctx = engine.ctx);
    this.input = ctx.createGain(); // connect custom nodes here
    this.level = ctx.createGain(); // faded by the core with world presence
    this.level.gain.value = 0;
    this.send = ctx.createGain(); // reverb send
    this.send.gain.value = 0.55;
    this.input.connect(this.level);
    this.level.connect(engine.master);
    this.level.connect(this.send);
    this.send.connect(engine.reverb);
    this._nodes = [];
    this._timers = new Set();
    this.disposed = false;
  }

  /** Smoothly move an AudioParam. */
  ramp(param, value, seconds = 0.5) {
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setTargetAtTime(value, t, Math.max(0.005, seconds / 3));
  }

  _pan(node, pan) {
    if (pan == null || !this.ctx.createStereoPanner) return node;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    return p;
  }

  /**
   * Sustained pad: a stack of slightly detuned oscillators through a lowpass, breathing on a slow LFO.
   * @returns {{gain: GainNode, filter: BiquadFilterNode, oscs: OscillatorNode[]}}
   */
  drone({ freqs = [110, 165], type = 'sine', gain = 0.04, detune = 6, attack = 6, filter = 900, q = 0.4, lfoRate = 0.06, lfoDepth = 0.35, pan = null } = {}) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(gain, ctx.currentTime, attack / 3);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    f.Q.value = q;
    const oscs = [];
    freqs.forEach((hz, i) => {
      for (const sgn of [-1, 1]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz;
        o.detune.value = sgn * detune * (0.6 + 0.4 * ((i * 7) % 3));
        const g = ctx.createGain();
        g.gain.value = 0.5 / Math.sqrt(freqs.length);
        o.connect(g).connect(f);
        o.start();
        oscs.push(o);
        this._nodes.push(o);
      }
    });
    if (lfoDepth > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      const lg = ctx.createGain();
      lg.gain.value = gain * lfoDepth;
      lfo.connect(lg).connect(out.gain);
      lfo.start();
      this._nodes.push(lfo);
    }
    f.connect(out);
    this._pan(out, pan).connect(this.input);
    return { gain: out, filter: f, oscs };
  }

  /** Looping filtered noise: wind, room tone, rain hiss, surf. */
  noise({ color = 'pink', gain = 0.02, type = 'bandpass', freq = 600, q = 0.7, attack = 4, lfoRate = 0.08, lfoDepth = 0.4, pan = null } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.engine.noiseBuffer(color);
    src.loop = true;
    src.loopStart = Math.random() * 2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(gain, ctx.currentTime, attack / 3);
    if (lfoDepth > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      const lg = ctx.createGain();
      lg.gain.value = gain * lfoDepth;
      lfo.connect(lg).connect(out.gain);
      lfo.start();
      this._nodes.push(lfo);
    }
    src.connect(f).connect(out);
    this._pan(out, pan).connect(this.input);
    src.start();
    this._nodes.push(src);
    return { gain: out, filter: f, source: src };
  }

  /** One-shot soft bell / glass ping (a few inharmonic sine partials with exponential decay). */
  bell({ freq = 660, gain = 0.05, decay = 4, pan = 0, partials = [1, 2.76, 5.4, 8.93], when = 0 } = {}) {
    if (this.disposed) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const out = ctx.createGain();
    out.gain.value = 1;
    partials.forEach((m, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * m;
      const g = ctx.createGain();
      const a = gain / (1 + i * 1.6);
      const d = decay / (1 + i * 0.9);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(a, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + d + 0.1);
    });
    const p = this._pan(out, pan);
    p.connect(this.input);
    const kill = setTimeout(() => {
      try {
        p.disconnect();
        out.disconnect();
      } catch {}
      this._timers.delete(kill);
    }, (when + decay + 0.5) * 1000);
    this._timers.add(kill);
  }

  /** Call fn() at random intervals between min and max seconds until the bus is disposed. */
  every(min, max, fn) {
    const tick = () => {
      if (this.disposed) return;
      const id = setTimeout(() => {
        this._timers.delete(id);
        if (this.disposed) return;
        if (this.engine.enabled && this.level.gain.value > 0.02) {
          try {
            fn();
          } catch (e) {
            console.warn('[audio]', e);
          }
        }
        tick();
      }, (min + Math.random() * (max - min)) * 1000);
      this._timers.add(id);
    };
    tick();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    const t = this.ctx.currentTime;
    this.level.gain.cancelScheduledValues(t);
    this.level.gain.setTargetAtTime(0, t, 0.15);
    setTimeout(() => {
      for (const n of this._nodes) {
        try {
          n.stop();
        } catch {}
        try {
          n.disconnect();
        } catch {}
      }
      try {
        this.input.disconnect();
        this.level.disconnect();
        this.send.disconnect();
      } catch {}
    }, 900);
  }
}

const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** A short silent WAV, built in memory (the site ships no audio files). */
function silentWavUrl(seconds = 0.5, rate = 8000) {
  const n = Math.floor(seconds * rate);
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true); // 8-bit: 128 is silence
  str(36, 'data');
  v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this._noise = {};
    this._carrier = null;
    // iOS parks the context ('interrupted') on lock, app switch or a call; the next touch brings it back
    const wake = () => this.enabled && this.ctx && this.ctx.state !== 'running' && this._wake();
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('touchend', wake, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        this._carrier?.pause();
        this.ctx.suspend().catch(() => {});
      } else if (this.enabled) this._wake();
    });
  }

  /**
   * iOS plays Web Audio in the 'ambient' session, which the ring/silent switch mutes. Ask for 'playback' so the
   * sound behaves like media once the visitor has turned it on; older iOS needs a silent <audio> element playing.
   */
  _playbackSession() {
    try {
      if (navigator.audioSession) {
        navigator.audioSession.type = 'playback';
        return;
      }
    } catch {}
    if (!IOS) return;
    if (!this._carrier) {
      const el = (this._carrier = document.createElement('audio'));
      el.src = silentWavUrl();
      el.loop = true;
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      el.setAttribute('x-webkit-airplay', 'deny');
    }
    this._carrier.play().catch(() => {});
  }

  /** Resume inside a gesture, and push one silent sample through (older iOS only opens output after a start()). */
  _wake() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    this._playbackSession();
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch {}
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (this.ctx) {
      this._wake();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this._playbackSession();
    const ctx = (this.ctx = new AC({ latencyHint: 'playback' }));
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -16;
    lim.knee.value = 14;
    lim.ratio.value = 8;
    lim.attack.value = 0.01;
    lim.release.value = 0.5;
    this.master.connect(lim).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    this.reverb.connect(wet).connect(this.master);
    this._wake();
    return true;
  }

  noiseBuffer(color = 'pink') {
    if (!this._noise[color]) this._noise[color] = makeNoise(this.ctx, 6, color);
    return this._noise[color];
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.ctx) return;
    clearTimeout(this._sleep);
    if (on && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.85 : 0, t, on ? 0.6 : 0.12);
    if (!on) {
      // once faded, let go of the device so the visitor's own music (or the mute switch) takes over again
      this._sleep = setTimeout(() => {
        if (this.enabled) return;
        this._carrier?.pause();
        try {
          if (navigator.audioSession) navigator.audioSession.type = 'auto';
        } catch {}
        this.ctx.suspend().catch(() => {});
      }, 700);
    }
  }

  createBus() {
    return this.ctx ? new Bus(this) : null;
  }
}

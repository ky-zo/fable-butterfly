import * as THREE from 'three';
import { WORLDS } from '../worlds/registry.js';
import { Input } from './Input.js';
import { PostChain, Finisher, resolvePost } from './Post.js';
import { FSPass } from './Pass.js';
import { Rail } from './Rail.js';
import { AudioEngine, midi } from './Audio.js';
import { Play, SAY_SECONDS, WING_CELLS } from './Play.js';
import * as glsl from './glsl.js';
import * as util from './util.js';
import { Hud } from '../ui/hud.js';

const { clamp, damp, mulberry32, easeInOutCubic } = util;

const TRANSITION_SECONDS = 2.8;
const OVERSCROLL_PX = 520; // extra scroll past the end of a world that begins the next one
const DEFAULT_SCROLL_PX = 7000; // scroll distance to traverse one world
const SCROLL_MAX_PACE = 4; // scroll: the fastest the journey moves, as a multiple of the film's own pace (a world's `duration`)
const SCROLL_LEAD = 0.9; // seconds of flight at that pace a scroll may ask for ahead; the rest of a hard scroll is dropped, not queued
const SCROLL_RAMP = 0.4; // seconds from rest to that top speed
const CELL_AT = [0.25, 0.55, 0.9]; // scroll: in a world with nothing to find, its three cells of the wing light as the visitor scrolls past these
const DEFAULT_DURATION = 75; // seconds one world takes at pace 1 (held all the way, or watched)
const SETTLE = 3e-4; // progress per second: the constant part of how the smoothed progress closes on its target
const PRELOAD_AT = 0.5; // play: the next world starts loading here, so its init() does not land on the first holds
// one soft note per cell, rising over the 19: three steps of a major scale for each world, from the G below middle C
const SCALE = [0, 2, 4, 5, 7, 9, 11];
const cellNote = (i) => 55 + 12 * Math.floor(i / 7) + SCALE[i % 7];
const SCALE_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

class Slot {
  constructor(def, index) {
    this.def = def;
    this.index = index;
    this.meta = { ...def };
    this.world = null;
    this.ready = false;
    this.failed = null;
    this.promise = null;
    this.targets = []; // { rt, scale, fixed }
    this.disposables = [];
    this.out = null;
    this.time = 0;
    this.p = 0;
    this.pTarget = 0;
    this.v = 0;
    this.post = resolvePost(null, {});
    this.bus = null;
    this.audio = null;
    this.errored = false;
    this.rules = null; // meta.play as the journey reads it (Play.bind)
    this.playView = null; // this world's frame.play, one object for its lifetime
    this.frame = { dt: 0, time: 0, progress: 0, velocity: 0, pointer: null, play: null, presence: 1, size: null, index: 0, still: false };
  }
}

export class App {
  constructor({ canvas, hudRoot, params }) {
    this.canvas = canvas;
    this.params = params;
    this.still = params.has('still');
    this.debug = params.has('debug');
    this.errors = [];

    const renderer = (this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: this.still,
    }));
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 1);
    renderer.shadowMap.enabled = true;
    renderer.info.autoReset = false;

    // ---- quality
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const forced = params.get('q');
    const tier = ['low', 'medium', 'high'].includes(forced) ? forced : coarse || (navigator.deviceMemory && navigator.deviceMemory <= 4) ? 'medium' : 'high';
    this.quality = { tier, level: { low: 0, medium: 1, high: 2 }[tier], mobile: !!coarse };
    this.dprOverride = params.has('dpr') ? parseFloat(params.get('dpr')) : null;
    this.fixedScale = params.has('scale') ? parseFloat(params.get('scale')) : null;
    this.scaleIdx = (window.devicePixelRatio || 1) >= 1.75 ? 3 : 5;
    this.scaleCeil = SCALE_STEPS.length - 1;
    this.perf = { ema: 16.7, sinceChange: 0, sinceEval: 0, ceilCooldown: 0 };

    this.size = { width: 1, height: 1, cssWidth: 1, cssHeight: 1, dpr: 1, aspect: 1 };
    this.input = new Input(canvas);
    this.post = new PostChain(renderer, this.quality);
    this.finisher = new Finisher(renderer);
    this.audio = new AudioEngine();
    this.hud = new Hud(hudRoot, { worlds: WORLDS, hidden: params.has('nohud'), scroll: !params.has('play') && !params.has('still') });
    this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // the cells are never read from or written to storage by the tools (?still) or with ?fresh
    this.play = new Play({ input: this.input, persist: !this.still && !params.has('fresh'), reduced: this.reduced });
    this.play.onSay = (text) => this.hud.say(text, SAY_SECONDS);
    this.play.onLight = (cell) => {
      this.hud.lightCell(cell);
      this._bell(cell);
    };
    // Scrolling is how the journey moves: the wheel, a drag on touch, the arrow keys. ?play brings back the earlier
    // hold-to-fly game (docs/PLAY.md), which the play harness still tests.
    this.scrollMode = !params.has('play') && !this.still;
    this.scrolled = 0; // px the visitor has scrolled so far
    this.sinceScroll = 0; // seconds since they last did
    this.cellP = 0; // last frame's progress, for the cells of the wing
    this.playStep = false; // still mode: __hl.set({ play: true }) runs the play journey on the stepped clock
    this.uiBus = null;

    this.slots = new Map();
    this.cur = null;
    this.inc = null;
    this.mix = 0;
    this.transT = 0;
    this.auto = params.has('watch') && !this.still; // Watch: the piece plays itself. Off unless asked for (?noauto is accepted and ignored)
    this.started = false;
    this.fade = 0;
    this.fadeTarget = 0.42;
    this.over = 0;
    this.idleScroll = 99;
    this.endHold = 0;
    this.sinceActive = 0;
    this.preloadRequested = false;
    this.globalTime = 0;
    this.frameIndex = 0;
    this.pending = null;
    this.arrival = null; // how the pending world was asked for: { byPlay, from }
    this.pressSeen = 0;
    this.gearSeen = 0;
    this.coachFaster = 0; // seconds the "go faster" coach has been up

    this._tick = this._tick.bind(this);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this._bindUi();
    this._exposeApi();
  }

  // ------------------------------------------------------------------ setup

  _bindUi() {
    const { hud, input } = this;
    hud.setAuto(this.auto);
    hud.on('jump', (i) => this.go(i));
    hud.setWing(this.play.cellString(), -1);
    hud.on('auto', (on) => this.setWatch(on));
    hud.on('sound', (on) => this.setSound(on));
    hud.on('speed', () => this.play.cycleGear());
    // (Space and the arrows never get here in play or Watch: the Input keeps them, as the hold and the steering)
    input.onKey((e) => {
      if (!this.started) return false;
      const k = e.key;
      if (this.scrollMode) {
        if (k === 'ArrowDown' || k === 'ArrowRight' || k === ' ' || k === 'PageDown') return input.nudge(620), true;
        if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'PageUp') return input.nudge(-620), true;
      }
      if (k >= '1' && k <= String(WORLDS.length)) return this.go(parseInt(k, 10) - 1), true;
      if (k === 'a' || k === 'A') return hud._emit('auto', !this.auto), true;
      if (k === 'm' || k === 'M') return this.setSound(!this.audio.enabled), true;
      if (k === 's' || k === 'S') return this.play.cycleGear(), true;
      if (k === 'h' || k === 'H') return hud.toggleHidden(), true;
      if (k === 'f' || k === 'F') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
        return true;
      }
      return false;
    });
  }

  /** 'play' | 'watch' | 'scroll' | 'still': what moves the journey, and what worlds are told (frame.play.mode). */
  get mode() {
    if (this.still) return this.playStep ? 'play' : 'still';
    return this.scrollMode ? 'scroll' : this.auto ? 'watch' : 'play';
  }

  /** Watch: the piece plays itself, like a film. A hold on the picture turns it off again. */
  setWatch(on) {
    this.auto = !!on;
    this.hud.setAuto(this.auto);
    if (on) this.idleScroll = 99;
  }

  /** One soft note for a cell that has just been lit (only when the visitor has sound on). */
  _bell(cell) {
    if (!this.audio.enabled || !this.audio.ctx) return;
    try {
      if (!this.uiBus) {
        this.uiBus = this.audio.createBus();
        this.uiBus.level.gain.value = 1;
      }
      this.uiBus.bell({ freq: midi(cellNote(cell)), gain: 0.04, decay: 5, pan: -0.15, partials: [1, 2.76, 5.4] });
    } catch {}
  }

  setSound(on) {
    if (on && !this.audio.unlock()) on = false;
    this.audio.setEnabled(on);
    this.hud.setSound(on);
    if (on) for (const s of this.slots.values()) this._ensureAudio(s);
  }

  _ensureAudio(slot) {
    if (!this.audio.ctx || !slot.ready || slot.bus || !slot.world.createAudio) return;
    try {
      slot.bus = this.audio.createBus();
      slot.audio = slot.world.createAudio(slot.bus, this.audio) || null;
    } catch (e) {
      this._report(`[world:${slot.def.id}] createAudio failed`, e);
    }
  }

  _report(msg, err) {
    console.error(msg, err);
    this.errors.push(`${msg}: ${err && (err.stack || err.message || err)}`);
    if (this.debug) this.hud.error(`${msg}: ${err && err.message}`);
  }

  // ------------------------------------------------------------------ sizing

  pixelRatio() {
    if (this.still) return this.dprOverride || 1;
    const dpr = Math.min(this.dprOverride || window.devicePixelRatio || 1, 2);
    const scale = this.fixedScale ?? SCALE_STEPS[this.scaleIdx];
    return Math.max(0.5, dpr * scale);
  }

  resize() {
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(cssW, cssH, false);
    const w = Math.max(2, Math.floor(cssW * pr));
    const h = Math.max(2, Math.floor(cssH * pr));
    const s = this.size;
    if (s.width === w && s.height === h) return;
    s.width = w;
    s.height = h;
    s.cssWidth = cssW;
    s.cssHeight = cssH;
    s.dpr = pr;
    s.aspect = w / h;
    this.post.resize(w, h);
    for (const slot of this.slots.values()) {
      for (const t of slot.targets) this._sizeTarget(t);
      if (slot.world && slot.world.resize) {
        try {
          slot.world.resize(s);
        } catch (e) {
          this._report(`[world:${slot.def.id}] resize failed`, e);
        }
      }
    }
  }

  _sizeTarget(t) {
    if (t.fixed) return;
    const w = Math.max(2, Math.round(this.size.width * t.scale));
    const h = Math.max(2, Math.round(this.size.height * t.scale));
    if (t.rt.width !== w || t.rt.height !== h) t.rt.setSize(w, h);
  }

  /**
   * Render target that follows the canvas size. See WORLD_GUIDE.md.
   */
  createTarget(slot, o = {}) {
    const {
      scale = 1,
      depth = false,
      samples = 0,
      type = THREE.HalfFloatType,
      format = THREE.RGBAFormat,
      filter = THREE.LinearFilter,
      mipmaps = false,
      wrap = THREE.ClampToEdgeWrapping,
      size = null, // [w, h] fixed size (not resized with the canvas)
      count = 1, // MRT attachments
    } = o;
    const w = size ? size[0] : Math.max(2, Math.round(this.size.width * scale));
    const h = size ? size[1] : Math.max(2, Math.round(this.size.height * scale));
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type,
      format,
      minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : filter,
      magFilter: filter,
      wrapS: wrap,
      wrapT: wrap,
      generateMipmaps: mipmaps,
      depthBuffer: !!depth,
      stencilBuffer: false,
      samples,
      count,
    });
    if (depth) {
      rt.depthTexture = new THREE.DepthTexture(w, h);
      rt.depthTexture.type = THREE.UnsignedIntType;
      rt.depthTexture.minFilter = THREE.NearestFilter;
      rt.depthTexture.magFilter = THREE.NearestFilter;
    }
    slot.targets.push({ rt, scale, fixed: !!size });
    return rt;
  }

  _makeCtx(slot) {
    const app = this;
    return {
      THREE,
      renderer: app.renderer,
      canvas: app.canvas,
      size: app.size,
      quality: app.quality,
      params: app.params,
      still: app.still,
      glsl,
      util,
      FSPass,
      Rail,
      createTarget: (o) => app.createTarget(slot, o),
      rng: (seed = 1) => mulberry32(seed),
      /** Let the browser breathe during heavy init: `await ctx.yield()` between big chunks. */
      yield: () => new Promise((r) => setTimeout(r, 0)),
      /** Register anything with .dispose() to be cleaned up when the world unloads. Returns its argument. */
      track: (d) => {
        slot.disposables.push(d);
        return d;
      },
    };
  }

  // ------------------------------------------------------------------ loading

  load(index) {
    const def = WORLDS[index];
    let slot = this.slots.get(def.id);
    if (slot) return slot.promise;
    slot = new Slot(def, index);
    this.slots.set(def.id, slot);
    slot.promise = (async () => {
      const mod = await def.load();
      slot.meta = { ...def, ...(mod.meta || {}), id: def.id, number: def.number };
      this.play.bind(slot);
      slot.playView = this.play.view(slot);
      const World = mod.default;
      slot.world = new World(this._makeCtx(slot));
      if (slot.world.init) await slot.world.init();
      slot.out = this.createTarget(slot, {});
      slot.ready = true;
      // prewarm: one hidden frame compiles shaders and uploads textures before the world is ever shown
      this._renderSlot(slot, 0, 0);
      if (this.audio.enabled) this._ensureAudio(slot);
      return slot;
    })().catch((err) => {
      slot.failed = err;
      this._report(`[world:${def.id}] failed to load`, err);
      throw err;
    });
    return slot.promise;
  }

  unload(slot) {
    if (!slot || !this.slots.has(slot.def.id)) return;
    this.slots.delete(slot.def.id);
    try {
      slot.audio?.dispose?.();
      slot.bus?.dispose();
      slot.world?.dispose?.();
    } catch (e) {
      this._report(`[world:${slot.def.id}] dispose failed`, e);
    }
    for (const t of slot.targets) {
      t.rt.depthTexture?.dispose();
      t.rt.dispose();
    }
    for (const d of slot.disposables) {
      try {
        d.dispose?.();
      } catch {}
    }
    slot.targets.length = 0;
    slot.disposables.length = 0;
  }

  /** Move to another world with the transition. */
  async go(index, { fromEnd = false, instant = false, byPlay = false } = {}) {
    index = ((index % WORLDS.length) + WORLDS.length) % WORLDS.length;
    if (this.inc || this.pending === index) return;
    if (this.cur && this.cur.index === index) return;
    this.pending = index;
    // (byPlay: the player held through the end of the world before. Flying 06 shut into 01 closes the loop)
    const arrival = { byPlay, from: this.cur ? this.cur.index : -1 };
    const t = setTimeout(() => this.hud.setLoading(true), 250);
    let slot;
    try {
      slot = await this.load(index);
    } catch {
      clearTimeout(t);
      this.hud.setLoading(false);
      this.pending = null;
      const bad = this.slots.get(WORLDS[index].id);
      if (bad) this.slots.delete(bad.def.id);
      this.hud.error(`Layer ${WORLDS[index].number} failed to load. See console.`);
      return;
    }
    clearTimeout(t);
    this.hud.setLoading(false);
    this.hud.error('');
    this.pending = null;
    slot.p = slot.pTarget = fromEnd ? 1 : 0;
    slot.v = 0;
    slot.sp = 0;
    slot.time = 0;
    this.arrival = arrival;
    this.over = 0;
    this.endHold = 0;
    this.idleScroll = 99;
    this.input.stopScroll();
    if (!this.cur || instant) {
      const old = this.cur;
      this.cur = slot;
      this.inc = null;
      this.mix = 0;
      if (old && old !== slot) this.unload(old);
      this._activated(slot);
    } else {
      this.inc = slot;
      this.mix = 0;
      this.transT = 0;
      this._labelSwapped = false;
    }
  }

  _activated(slot) {
    this.sinceActive = 0;
    this.sinceScroll = 0;
    this.cellP = slot.p;
    // somebody who has never changed the speed is shown how once more in each new world
    if (!this.play.sped) this.coachFaster = Math.min(this.coachFaster, 5);
    this.preloadRequested = false;
    this.hud.setWorld(slot.index, slot.meta);
    const play = this.play;
    play.begin(slot);
    if (slot.p > 0) play.markPassed(slot, slot.p);
    const a = this.arrival;
    this.arrival = null;
    if (a && a.byPlay && slot.index === 0 && a.from === WORLDS.length - 1 && (this.mode === 'play' || this.mode === 'scroll')) play.closeLoop();
    this.hud.setWing(play.cellString(), slot.index);
    // keep at most: the current world + the one preloading next
    const keep = (slot.index + 1) % WORLDS.length;
    for (const other of [...this.slots.values()]) {
      if (other !== slot && other.ready && other.index !== keep) this.unload(other);
    }
    try {
      history.replaceState(null, '', `#${slot.def.id}`);
    } catch {}
  }

  // ------------------------------------------------------------------ journey

  _updateJourney(dt) {
    const s = this.cur;
    if (!s) return;
    const mode = this.mode;
    const scroll = this.input.consumeScroll();
    const len = s.meta.scroll || DEFAULT_SCROLL_PX;
    const dur = s.meta.duration || DEFAULT_DURATION;

    if (this.inc) {
      // --- in transition. In play neither world's progress moves: every world opens on its composed first image
      this.transT += dt / TRANSITION_SECONDS;
      this.mix = easeInOutCubic(clamp(this.transT));
      const n = this.inc;
      if (mode === 'scroll' && scroll !== 0) {
        const leadN = (SCROLL_MAX_PACE / (n.meta.duration || DEFAULT_DURATION)) * SCROLL_LEAD;
        n.pTarget = clamp(clamp(n.pTarget + scroll / (n.meta.scroll || DEFAULT_SCROLL_PX), n.p - leadN, n.p + leadN));
      }
      else if (mode !== 'play' && this.auto && this.started) n.pTarget = clamp(n.pTarget + (dt * this.play.speed) / (n.meta.duration || DEFAULT_DURATION));
      if (!this._labelSwapped && this.mix > 0.5) {
        this._labelSwapped = true;
        this.hud.setWorld(n.index, n.meta);
        this.hud.setWing(this.play.cellString(), n.index);
        this.hud.setCaption(null);
        this.hud.setHint('');
        this.hud.setEnd(false, 0);
      }
      if (this.transT >= 1) {
        const old = this.cur;
        this.cur = n;
        this.inc = null;
        this.mix = 0;
        this.unload(old);
        this._activated(n);
      }
    } else if (this.started) {
      if (mode === 'scroll') {
        // --- scroll: the wheel, a drag and the arrows move the journey, forwards and back
        this.sinceScroll += dt;
        if (scroll !== 0) {
          this.idleScroll = 0;
          this.sinceScroll = 0;
          this.scrolled += Math.abs(scroll);
          const t = s.pTarget + scroll / len;
          // (scroll past an end only counts once the picture has arrived there: momentum never skips an ending)
          if (t > 1) {
            if (s.p > 0.985) this.over += (t - 1) * len;
          } else if (t < 0) {
            if (s.p < 0.015) this.over += t * len;
          } else this.over = 0;
          // a top speed: scroll may only ask for a short way ahead of where the butterfly is, so a hard scroll or a
          // long fling flies at the top speed while it lasts and stops soon after, instead of racing through a world
          const lead = (SCROLL_MAX_PACE / dur) * SCROLL_LEAD;
          s.pTarget = clamp(clamp(t, s.p - lead, s.p + lead));
        } else {
          this.idleScroll += dt;
          this.over = damp(this.over, 0, 1.2, dt);
          if (this.auto && this.idleScroll > 1.6) s.pTarget = clamp(s.pTarget + (dt * this.play.speed) / dur);
        }
        // (byPlay: the visitor scrolled on through the end. Scrolling 06 shut into 01 closes the loop)
        if (this.over > OVERSCROLL_PX) this.go(s.index + 1, { byPlay: true });
        else if (this.over < -OVERSCROLL_PX && s.index > 0) this.go(s.index - 1, { fromEnd: true });
        if (this.auto && s.p > 0.992 && this.idleScroll > 1.6) {
          this.endHold += dt * Math.min(2, this.play.speed);
          if (this.endHold > 3.0) this.go(s.index + 1);
        } else this.endHold = 0;
        // the wing fills as they go: three cells a world. Where a world has things to find, a cell is lit when the
        // visitor steers the butterfly to one (the world calls play.find); scrolling past lights nothing there.
        // Everywhere else they light as the visitor (not the film) scrolls forward past three marks
        if (!this.auto && !(s.rules && s.rules.finds.length)) {
          for (let k = 0; k < 3; k++) {
            const cell = s.index * 3 + k;
            if (this.cellP < CELL_AT[k] && s.p >= CELL_AT[k] && !this.play.cells[cell]) this.play.setCell(cell, true);
          }
        }
        this.cellP = s.p;
      } else if (mode === 'watch') {
        // --- Watch: the piece plays itself, at the speed that was chosen. No gates, no cells; the next world begins
        //     3 s after the end
        this.idleScroll += dt;
        if (this.idleScroll > 1.6) s.pTarget = clamp(s.pTarget + (dt * this.play.speed) / dur);
        if (s.p > 0.992) {
          this.endHold += dt * Math.min(2, this.play.speed);
          if (this.endHold > 3.0) this.go(s.index + 1);
        } else this.endHold = 0;
      } else if (this.play.advance(s, dt, dur)) {
        // --- play: held through the end, so the next world begins
        this.go(s.index + 1, { byPlay: true });
      }

      // preload the next layer: a few seconds after settling in, or (in play) once the player is half way through
      this.sinceActive += dt;
      if (!this.preloadRequested && WORLDS.length > 1 && (mode === 'play' ? s.p >= PRELOAD_AT : this.sinceActive > 4)) {
        this.preloadRequested = true;
        this.load((s.index + 1) % WORLDS.length).catch(() => {});
      }
    }

    const capped = mode === 'scroll';
    this._ease(this.cur, dt, capped ? SCROLL_MAX_PACE / (this.cur.meta.duration || DEFAULT_DURATION) : Infinity);
    if (this.inc) this._ease(this.inc, dt, capped ? SCROLL_MAX_PACE / (this.inc.meta.duration || DEFAULT_DURATION) : Infinity);
  }

  /** Smoothed progress follows its target. This is the only place progress (and so any lens) moves. */
  _ease(slot, dt, vmax = Infinity) {
    const prev = slot.p;
    slot.p = damp(slot.p, slot.pTarget, 3.2, dt);
    // an exponential never arrives, so the last of the way is walked: let go, and about two seconds later the
    // journey (and with it the lens) is exactly still
    const gap = slot.pTarget - slot.p;
    const walk = SETTLE * dt;
    if (Math.abs(gap) <= Math.max(walk, 1e-5)) slot.p = slot.pTarget;
    else slot.p += gap > 0 ? walk : -walk;
    if (vmax < Infinity && dt > 0) {
      // (scroll) a top speed, reached over a short ramp from rest. Only speeding up is limited, so nothing overshoots
      const dir = Math.sign(slot.p - prev);
      const sp = slot.sp || 0;
      const was = dir * sp > 0 ? Math.abs(sp) : 0;
      const top = Math.min(vmax, was + (vmax / SCROLL_RAMP) * dt);
      slot.p = prev + dir * Math.min(Math.abs(slot.p - prev), top * dt);
      slot.sp = (slot.p - prev) / dt;
    }
    slot.v = dt > 0 ? damp(slot.v, (slot.p - prev) / dt, 8, dt) : 0;
  }

  // ------------------------------------------------------------------ frame

  _renderSlot(slot, dt, presence) {
    const world = slot.world;
    const f = slot.frame;
    slot.time += dt;
    f.dt = dt;
    f.time = slot.time;
    f.progress = slot.p;
    f.velocity = slot.v;
    f.pointer = this.input.pointer;
    f.play = this.still && !this.playStep ? this.play.STILL : this.play.fill(slot.playView, slot === this.cur && !this.inc);
    f.presence = presence;
    f.size = this.size;
    f.index = this.frameIndex;
    f.still = this.still;
    let rt = null;
    try {
      world.update?.(f);
      rt = world.render(f);
      if (slot === this.cur) {
        // where the animal's path point is on screen: the trackpad aim starts from there (default: the centre)
        const a = world.anchor;
        const ok = a && Number.isFinite(a.x) && Number.isFinite(a.y);
        this.input.anchorX = ok ? a.x : 0;
        this.input.anchorY = ok ? a.y : 0;
      }
    } catch (e) {
      if (!slot.errored) {
        slot.errored = true;
        this._report(`[world:${slot.def.id}] frame error`, e);
      }
    }
    if (!rt || !rt.isWebGLRenderTarget) {
      if (!slot.errored) {
        slot.errored = true;
        this._report(`[world:${slot.def.id}] render() must return a WebGLRenderTarget`, new Error('bad return'));
      }
      return;
    }
    resolvePost(world.post, slot.post);
    this.post.process(rt, slot.post, world.camera || null, slot.out);
    if (slot.audio && slot.audio.update) {
      try {
        slot.audio.update(f);
      } catch {}
    }
    if (slot.bus) {
      const g = slot.bus.level.gain;
      g.setTargetAtTime(presence * (this.started ? 1 : 0), this.audio.ctx.currentTime, 0.25);
    }
  }

  frame(dt) {
    const r = this.renderer;
    const input = this.input;
    const play = this.play;
    const hud = this.hud;
    r.info.reset();
    this.globalTime += dt;
    this.frameIndex++;
    // a hold on the picture takes over from the film
    if (input.pressN !== this.pressSeen) {
      this.pressSeen = input.pressN;
      if (this.auto && this.started && !this.scrollMode && !this.still) hud._emit('auto', false);
    }
    const mode = this.mode;
    input.mode = mode;
    input.live = this.started;
    play.mode = mode;
    play.scrollFinds = !this.auto;
    input.update(dt);
    if (!this.still || this.playStep) {
      play.tick(dt, this.started, !!this.inc);
      this._updateJourney(dt);
    }
    this.fade = damp(this.fade, this.fadeTarget, this.started ? 1.6 : 2.5, dt);
    if (this.still) this.fade = 1;

    const a = this.cur;
    const b = this.inc;
    if (!a || !a.ready) {
      r.setRenderTarget(null);
      r.clear();
      return;
    }
    this._renderSlot(a, dt, b ? 1 - this.mix : 1);
    if (b && b.ready) this._renderSlot(b, dt, this.mix);
    this.finisher.render(a.out.texture, b ? b.out.texture : null, this.mix, a.post, b ? b.post : null, this.globalTime, this.fade, this.size.width, this.size.height);

    // ---- HUD (every call below only touches the DOM when its value has changed)
    const shown = b && this.mix > 0.5 ? b : a;
    hud.update(dt);
    hud.setProgress(shown.p);
    if (this.started && !b) {
      // in play a world that has finds earns its lines (hud.say) and shows only its unearned ones by progress;
      // everywhere else the captions run by progress, as they always have
      const lines = mode === 'play' && shown.rules && shown.rules.lines ? shown.rules.lines : shown.meta.captions;
      let cap = null;
      if (lines) {
        for (let i = 0; i < lines.length; i++) {
          const c = lines[i];
          if (shown.p >= c.from && shown.p <= c.to) cap = c.text;
        }
      }
      hud.setCaption(cap);
      const atEnd = shown.p > 0.985;
      // the coach: one control at a time, shown until the player has done it, and "hold" again whenever the animal
      // has been left hovering with nothing being asked of it
      let coach = '';
      // scroll: the one thing to know, until they have done it, and again if they have stopped for a while
      if (mode === 'scroll' && !atEnd && !this.auto && (this.scrolled < 300 || this.sinceScroll > 9)) coach = 'scroll';
      // …and one more where it matters: how to steer, while something to find is close and they have not steered yet
      // (the world says when: `world.steerHint`)
      else if (mode === 'scroll' && !atEnd && !this.auto && shown.world && shown.world.steerHint) coach = 'side';
      if (mode === 'play' && !atEnd) {
        if (play.first) coach = 'hold';
        else if (!play.gateOn && !cap) {
          if (!play.held) coach = play.restFor > 3.5 ? 'hold' : '';
          else if (play.leaned < 0.4 && play.flown > 3.2 && play.flown < 9) coach = 'steer';
          // "go faster" comes whether or not they ever steered, stays about 9 s, and returns for 4 s in each new world
          else if (!play.sped && play.flown > 6 && this.sinceActive > 4 && this.coachFaster < 9) coach = 'faster';
        }
      }
      hud.setHint('');
      if (hud.setCoach(coach) === 'faster') this.coachFaster += dt;
      if (play.gearN !== this.gearSeen) {
        this.gearSeen = play.gearN;
        hud.flashSpeed();
      }
      hud.setSpeed(play.gear, mode === 'play' || mode === 'watch' || this.auto);
      hud.setEnd(atEnd, mode === 'play' ? play.end : mode === 'scroll' ? clamp(this.over / OVERSCROLL_PX) : 0);
      hud.setIdle((play.held && play.heldFor > 1.2) || input.sinceInput > 4);
    }
  }

  _adaptResolution(dtMs) {
    if (this.fixedScale != null || this.still || document.hidden) return;
    const p = this.perf;
    p.ema += (Math.min(dtMs, 100) - p.ema) * 0.06;
    p.sinceChange += dtMs;
    p.sinceEval += dtMs;
    p.ceilCooldown -= dtMs;
    if (this.inc || p.sinceChange < 2500 || p.sinceEval < 800) return;
    p.sinceEval = 0;
    if (p.ceilCooldown <= 0) this.scaleCeil = SCALE_STEPS.length - 1;
    let idx = this.scaleIdx;
    if (p.ema > 21.5 && idx > 0) {
      idx--;
      if (p.sinceChange < 9000) {
        // we just stepped up and it didn't hold — don't try again for a while
        this.scaleCeil = idx;
        p.ceilCooldown = 45000;
      }
    } else if (p.ema < 17.4 && idx < this.scaleCeil && p.sinceChange > 6000) idx++;
    if (idx !== this.scaleIdx) {
      this.scaleIdx = idx;
      p.sinceChange = 0;
      p.ema = 16.7;
      this.resize();
    }
  }

  _tick(now) {
    requestAnimationFrame(this._tick);
    const dtMs = now - (this._last ?? now);
    this._last = now;
    if (dtMs <= 0) return;
    this._adaptResolution(dtMs);
    this.frame(Math.min(dtMs / 1000, 1 / 20));
    if (this.debug && this.frameIndex % 20 === 0) {
      const i = this.renderer.info;
      this.hud.debug(
        `${(1000 / this.perf.ema).toFixed(0)} fps  ${this.perf.ema.toFixed(1)} ms\n${this.size.width}×${this.size.height}  dpr ${this.size.dpr.toFixed(2)}\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k  pts ${(i.render.points / 1000).toFixed(0)}k\ngeo ${i.memory.geometries}  tex ${i.memory.textures}  prog ${i.programs?.length ?? '?'}\np ${this.cur ? this.cur.p.toFixed(3) : '-'}`,
      );
    }
  }

  // ------------------------------------------------------------------ boot

  async start() {
    const { params } = this;
    const hash = location.hash.replace('#', '');
    const want = params.get('world') || hash;
    let index = Math.max(0, WORLDS.findIndex((w) => w.id === want));
    const p0 = params.has('p') ? clamp(parseFloat(params.get('p')) || 0) : 0;

    this.hud.setLoading(true);
    this._readyResolve = null;
    const ready = new Promise((res) => (this._readyResolve = res));
    window.__hl.ready = ready;

    if (!this.still) requestAnimationFrame(this._tick);

    if (want === 'none') {
      // tooling: boot the engine with no world loaded (used to measure a world's cold init cost)
      this.hud.setLoading(false);
      this.started = true;
      this._readyResolve(true);
      return;
    }

    try {
      await this.go(index, { instant: true });
    } finally {
      this.hud.setLoading(false);
    }
    if (this.cur) {
      this.cur.p = this.cur.pTarget = p0;
      this.play.markPassed(this.cur, p0);
    }

    if (this.still) {
      this.started = true;
      this.hud.live();
      this.frame(0);
      this._readyResolve(true);
      return;
    }
    this._readyResolve(true);

    if (params.has('skipintro') || params.has('world')) {
      this.started = true;
      this.fadeTarget = 1;
      this.hud.live();
      // sound needs a gesture: arm it on the first interaction
      return;
    }
    await this.hud.intro(({ sound, watch }) => {
      if (sound) this.setSound(true);
      if (watch) this.setWatch(true);
    });
    this.started = true;
    this.fadeTarget = 1;
    this.idleScroll = 0; // (Watch, ?scroll) a short beat before the film begins
  }

  // ------------------------------------------------------------------ tooling API (screenshots, tests, console poking)

  _exposeApi() {
    const app = this;
    window.__hl = {
      app,
      ready: null,
      get errors() {
        return app.errors;
      },
      worlds: WORLDS.map((w) => w.id),
      /** Set journey state directly. { p, pointer:[x,y], down, time, play } (play: still mode only, see docs/PLAY.md) */
      set(o = {}) {
        if (o.play != null && app.still) app.playStep = !!o.play;
        const s = app.cur;
        if (!s) return;
        if (o.p != null) {
          s.p = s.pTarget = clamp(o.p);
          app.play.markPassed(s, s.p); // tools that jump are not held at a gate
        }
        if (o.time != null) s.time = o.time;
        if (o.pointer) app.input.set(o.pointer[0], o.pointer[1], !!o.down);
        else if (o.down != null) app.input.pointer.down = !!o.down;
      },
      /** Advance n frames of dt seconds, optionally moving progress by dp per frame. Renders each frame. */
      step(n = 1, dt = 1 / 60, dp = 0) {
        for (let i = 0; i < n; i++) {
          if (dp && app.cur) {
            const s = app.cur;
            const prev = s.p;
            s.p = s.pTarget = clamp(s.p + dp);
            s.v = (s.p - prev) / dt;
          } else if (app.cur && app.still && !app.playStep) app.cur.v = 0;
          app.frame(dt);
        }
      },
      /** Jump straight to another world (no transition). */
      async goto(id) {
        const i = WORLDS.findIndex((w) => w.id === id);
        if (i < 0) throw new Error(`unknown world ${id}`);
        await app.go(i, { instant: true });
        app.frame(0);
      },
      /** Preview the transition into another world at a given mix (still mode). */
      async transition(id, mix = 0.5) {
        const i = WORLDS.findIndex((w) => w.id === id);
        const slot = await app.load(i);
        app.inc = slot;
        app.mix = mix;
        app.frame(1 / 60);
      },
      /** Rough GPU cost: render n frames back-to-back, force a sync, return average ms per frame. */
      perf(n = 60, dt = 1 / 60) {
        const gl = app.renderer.getContext();
        const px = new Uint8Array(4);
        app.frame(dt);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t0 = performance.now();
        for (let i = 0; i < n; i++) app.frame(dt);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return (performance.now() - t0) / n;
      },
      // ---- play (docs/PLAY.md, "Flags and __hl")
      /** Snapshot: { mode, world, p, pTarget, held, fly, aim, gate, cells, lap, end, state } */
      play() {
        return app.play.snapshot(app);
      },
      /** Press or release the hold as if by hand. */
      hold(on = true) {
        app.input.hold(on);
      },
      /** Urge it on as the wheel would (0..1). */
      push(k = 1) {
        app.input.push(k);
      },
      /** gear() → the current gear (0, 1, 2 = 1x, 2x, 4x); gear(n) chooses one, as the speed button or a swipe would. */
      gear(n) {
        if (n != null) app.play.setGear(n);
        return app.play.gear;
      },
      /** Put the aim at (x, y) NDC and make it active; aim(null) lets it go. */
      aim(x, y) {
        app.input.setAim(x, y);
      },
      /** Events so far: { t, p, type, id } with type press | release | gate | cue | auto | find | pass | end | world | loop */
      get log() {
        return app.play.log;
      },
      /** Clear the wing's cells and the lap (and what is stored). */
      resetWing() {
        app.play.reset();
        app.hud.setWing(app.play.cellString(), app.cur ? app.cur.index : -1);
      },
      /** Debug: wing() → the 19 cells as a string; wing(i) lights cell i as a find would; wing(i, false) clears it. */
      wing(i, on = true) {
        if (i != null && i >= 0 && i < WING_CELLS) {
          app.play.setCell(i | 0, on);
          app.hud.setWing(app.play.cellString(), app.cur ? app.cur.index : -1);
        }
        return app.play.cellString();
      },
      info() {
        const i = app.renderer.info;
        return {
          calls: i.render.calls,
          triangles: i.render.triangles,
          points: i.render.points,
          lines: i.render.lines,
          geometries: i.memory.geometries,
          textures: i.memory.textures,
          programs: i.programs ? i.programs.length : null,
          width: app.size.width,
          height: app.size.height,
        };
      },
    };
  }
}

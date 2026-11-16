import { damp } from './util.js';

// The play layer: effort, gates, finds, the wing's 19 cells and where they are kept. See docs/PLAY.md, section 3.
//
// Play decides WHEN progress moves and what the animal is told. It never touches a camera: a gate only clamps the
// journey's target, and the lens comes to rest through the same damp that has always carried it.
//
// Nothing here allocates per frame. Every world gets one `frame.play` object for its lifetime (view()), refilled in
// place (fill()); the gate and the aim are single objects that are mutated.

export const WING_CELLS = 19;
export const LOOP_CELL = 18;
const STORE_KEY = 'hidden-layers.wing.v1';

const RISE = 9; // 1/s: effort while held (90 % after 0.26 s)
const FALL = 1.6; // 1/s: effort after release…
const FALL_FLOOR = 0.16; // …less this much a second, so it is exactly zero 1.5 s after letting go (about 0.5 s of coasting flight)
const FIRST_HOLD = 0.4; // s: the hold that retires the "Hold to fly" hint
const COMMIT_DRIVE = 0.7; // inside a commit range the journey runs on at this much pace without a hold
const ENGAGED = 4; // s since the last input during which a gate's clock still runs
const CUE = 5; // s at a gate before the world shows its cue (default)
const AUTO = 12; // s at a gate before the animal does it by itself (default)
const RESCUE = 6; // s into stage 2 after which the core opens the gate itself
export const SAY_SECONDS = 6;
const AT_GATE = 0.002; // progress: this close to a gate is "at" it
const END_AT = 0.995;
const END_HOLD = 1.0; // s of continuous hold at the end that starts the next world
const END_DRAIN = 2; // 1/s
const LOG_MAX = 4000;
const SURGE_PACE = 3; // a full surge (the wheel, Shift) flies at 1 + this times the world's pace
export const GEARS = [1, 2, 4]; // the speeds the player can choose: the journey runs this many times the world's pace
const SPEED_EASE = 5; // 1/s: how quickly the pace follows a change of gear
const GATE_SPEED = 4; // a gate's clock runs at most this many times faster in a high gear (at 4x: cue after 1.25 s, auto after 3 s)

const NO_AIM = Object.freeze({ x: 0, y: 0, dx: 0, dy: 0, active: false });
const no = () => false;
const nothing = () => {};

export class Play {
  /**
   * @param input    the Input (its `aim` object is handed to worlds as play.aim)
   * @param persist  false in still mode and with ?fresh: the cells then live in memory only
   * @param reduced  prefers-reduced-motion
   */
  constructor({ input, persist = true, reduced = false }) {
    this.input = input;
    this.persist = persist;
    this.reduced = reduced;
    this.mode = 'play';
    /** scroll: finds may be lit (by steering the animal to them). The App clears it while the film plays itself. */
    this.scrollFinds = true;

    this.held = false;
    this.fly = 0;
    this.pressed = false;
    this.released = false;
    this.heldFor = 0;
    this.restFor = 99;
    this.first = true;
    /** 0..1: the player is urging it on for a moment (the wheel, Shift). */
    this.surge = 0;
    /** The gear the player has chosen (an index into GEARS). It stays until they change it, across worlds. */
    this.gear = 0;
    /** Times the gear was asked to change (also when it was already at the end of its range): the HUD answers each one. */
    this.gearN = 0;
    /** What the journey's pace is multiplied by right now: the gear or the surge, whichever is more, eased. */
    this.speed = 1;
    /** What the player has shown they know, for the HUD's coach: seconds flown, seconds leaned, whether they ever sped up. */
    this.flown = 0;
    this.leaned = 0;
    this.sped = false;
    /** A hold that began before a world opened does not count until it is let go and pressed again. */
    this.latch = false;
    this.dissolve = false;
    this.end = 0;
    this.clock = 0;

    this.cells = new Uint8Array(WING_CELLS);
    this.lap = 0;
    this._cellString = null;
    this.log = [];

    this.slot = null; // the world that is current
    this.gate = { id: '', kind: '', stage: 0, t: 0 }; // the one gate object worlds ever see
    this.gateOn = false;
    this._gateRule = null;

    /** (cell) a cell has just been lit for the first time   (text) a line has been earned */
    this.onLight = nothing;
    this.onSay = nothing;

    /** frame.play in still mode: one constant object. */
    this.STILL = Object.freeze({
      mode: 'still',
      held: false,
      fly: 1,
      pressed: false,
      released: false,
      heldFor: 0,
      restFor: 0,
      first: false,
      surge: 0,
      speed: 1,
      aim: NO_AIM,
      gate: null,
      has: no,
      find: no,
      pass: nothing,
      reduced,
    });

    this._load();
  }

  // ------------------------------------------------------------------ storage (the page must work without it)

  _load() {
    if (!this.persist) return;
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (!o || o.v !== 1 || typeof o.c !== 'string') return;
      for (let i = 0; i < WING_CELLS; i++) this.cells[i] = o.c[i] === '1' ? 1 : 0;
      this.lap = Math.max(0, o.lap | 0);
    } catch {}
  }

  _save() {
    this._cellString = null;
    if (!this.persist) return;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, c: this.cellString(), lap: this.lap }));
    } catch {}
  }

  /** The 19 cells as a string of 0 and 1 (cached: only rebuilt when a cell changes). */
  cellString() {
    if (this._cellString == null) this._cellString = Array.from(this.cells, (c) => (c ? '1' : '0')).join('');
    return this._cellString;
  }

  /** Debug: light or clear one cell, as a find would (no line, no gate). */
  setCell(i, on = true) {
    if (!(i >= 0 && i < WING_CELLS)) return;
    const was = this.cells[i];
    this.cells[i] = on ? 1 : 0;
    this._save();
    this._refreshGates();
    if (on && !was) this.onLight(i);
  }

  /** Clear the cells and the lap. */
  reset() {
    this.cells.fill(0);
    this.lap = 0;
    this._cellString = null;
    if (this.persist) {
      try {
        window.localStorage.removeItem(STORE_KEY);
      } catch {}
    }
    this._refreshGates();
  }

  _refreshGates() {
    const r = this.slot && this.slot.rules;
    if (!r) return;
    for (const g of r.gates) if (g.find) g.open = g.passed || this.cells[g.find.cell] === 1;
  }

  _log(type, id, cell) {
    const s = this.slot;
    if (this.log.length >= LOG_MAX) this.log.splice(0, LOG_MAX / 4);
    const e = { t: +this.clock.toFixed(3), p: s ? +s.p.toFixed(4) : 0, type, id: id ?? null };
    if (cell != null) e.cell = cell;
    this.log.push(e);
  }

  // ------------------------------------------------------------------ worlds

  /** Read a world's `meta.play` into the shape the journey uses. Called when it loads and each time it becomes current. */
  bind(slot) {
    const mp = slot.meta.play || null;
    const finds = ((mp && mp.finds) || []).slice(0, 3).map((f, i) => ({ id: f.id, says: f.says || '', cell: slot.index * 3 + i, done: false }));
    const gates = ((mp && mp.gates) || [])
      .map((g) => {
        const find = finds.find((f) => f.id === g.id) || null;
        return { id: g.id, at: +g.at, kind: g.kind || 'steer', cue: g.cue ?? CUE, auto: g.auto ?? AUTO, find, passed: false, open: !!find && this.cells[find.cell] === 1, said: false };
      })
      .sort((a, b) => a.at - b.at);
    slot.rules = {
      pace: (mp && mp.pace) || [],
      commit: (mp && mp.commit) || [],
      finds,
      gates,
      // lines shown by progress in play. A world with no meta.play keeps its captions
      lines: mp ? mp.lines || [] : null,
    };
  }

  /** A world has become the current one: its visit starts clean. */
  begin(slot) {
    this.slot = slot;
    this.bind(slot);
    this.gateOn = false;
    this._gateRule = null;
    this.end = 0;
    // every world opens on its composed first image: no leftover effort, and a hold carried over does not count
    this.fly = 0;
    this.latch = this.input.held;
    this._log('world', slot.def.id);
  }

  /** Progress was set from outside (a tool, ?p=): every gate before it counts as passed, so nothing jumps back. */
  markPassed(slot, p) {
    if (!slot.rules) return;
    for (const g of slot.rules.gates) {
      if (g.at < p - 1e-9) {
        g.passed = true;
        g.open = true;
        g.said = true; // (a jump is not a journey: it owes no lines)
      }
    }
  }

  /** The player flew world 06 shut into world 01. */
  closeLoop() {
    this.lap++;
    const fresh = !this.cells[LOOP_CELL];
    this.cells[LOOP_CELL] = 1;
    this._save();
    this._log('loop', null, LOOP_CELL);
    if (fresh) this.onLight(LOOP_CELL);
  }

  /** The object a world receives as frame.play for as long as it is loaded. */
  view(slot) {
    const play = this;
    return {
      mode: 'play',
      held: false,
      fly: 1,
      pressed: false,
      released: false,
      heldFor: 0,
      restFor: 0,
      first: true,
      surge: 0,
      speed: 1,
      aim: this.input.aim,
      gate: null,
      has: (id) => play._has(slot, id),
      find: (id) => play._find(slot, id),
      pass: (id) => play._pass(slot, id),
      reduced: this.reduced,
    };
  }

  /** Refill a world's frame.play for this frame. `current`: it is the current world and nothing is dissolving. */
  fill(v, current) {
    const mode = this.mode;
    v.mode = mode;
    if (mode !== 'play') {
      v.held = v.pressed = v.released = v.first = false;
      v.surge = 0;
      v.speed = mode === 'watch' ? this.speed : 1;
      v.fly = 1;
      v.heldFor = v.restFor = 0;
      v.gate = null;
    } else if (current) {
      v.held = this.held;
      v.fly = this.fly;
      v.pressed = this.pressed;
      v.released = this.released;
      v.heldFor = this.heldFor;
      v.restFor = this.restFor;
      v.first = this.first;
      v.surge = this.surge;
      v.speed = this.speed;
      v.gate = this.gateOn ? this.gate : null;
    } else {
      // a dissolve (or the hidden frame a world is warmed up with): nobody is flying, nothing is waiting
      v.held = v.pressed = false;
      v.released = this.released;
      v.fly = this.fly;
      v.heldFor = 0;
      v.restFor = this.restFor;
      v.first = this.first;
      v.surge = 0;
      v.speed = 1;
      v.gate = null;
    }
    return v;
  }

  _live(slot) {
    return this.mode === 'play' && slot === this.slot && !this.dissolve && !!slot.rules;
  }

  _has(slot, id) {
    const r = slot.rules;
    if (!r) return false;
    for (const f of r.finds) if (f.id === id) return this.cells[f.cell] === 1;
    return false;
  }

  /** The player did it. Lights the cell (once ever), says the line (once a visit), opens the gate. */
  _find(slot, id) {
    // (scroll: the same finds, lit when the visitor steers the animal to them. Nothing waits for them and the lines
    // run by progress as captions, so there is no gate to open and no line to say)
    const scroll = this.mode === 'scroll';
    if (scroll ? !(this.scrollFinds && slot === this.slot && !this.dissolve && slot.rules) : !this._live(slot)) return false;
    let f = null;
    for (const x of slot.rules.finds) if (x.id === id) f = x;
    if (!f) return false;
    for (const g of slot.rules.gates) if (g.id === id) g.open = true;
    if (f.done) return false;
    f.done = true;
    const fresh = this.cells[f.cell] !== 1;
    if (fresh) {
      this.cells[f.cell] = 1;
      this._save();
    }
    this._log('find', id, f.cell);
    if (!scroll) this._say(slot, id, f.says);
    if (fresh) this.onLight(f.cell);
    return fresh;
  }

  /** The animal did it by itself. Says the line and opens the gate; the cell stays as it was for this visit. */
  _pass(slot, id) {
    if (!this._live(slot)) return;
    let f = null;
    let hit = false;
    for (const x of slot.rules.finds) if (x.id === id) f = x;
    for (const g of slot.rules.gates) {
      if (g.id === id && !g.passed) {
        g.passed = g.open = true;
        hit = true;
      }
    }
    if (f) {
      if (f.done) return;
      f.done = true;
    } else if (!hit) return;
    this._log('pass', id);
    this._say(slot, id, f ? f.says : '');
  }

  _say(slot, id, text) {
    for (const g of slot.rules.gates) if (g.id === id) g.said = true;
    if (text) this.onSay(text);
  }

  // ------------------------------------------------------------------ speed

  /** Choose a gear (clamped to the range). Counts as a request even when nothing changes, so the HUD can answer. */
  setGear(g) {
    g = Math.max(0, Math.min(GEARS.length - 1, g | 0));
    this.gearN++;
    if (g === this.gear) return;
    this.gear = g;
    if (g > 0) this.sped = true;
    this._log('gear', String(GEARS[g]));
  }

  /** The button: one gear up, and round again from the top. */
  cycleGear() {
    this.setGear((this.gear + 1) % GEARS.length);
  }

  // ------------------------------------------------------------------ every frame

  /**
   * Effort and edges. `live`: the journey has begun. `dissolve`: one world is giving way to the next.
   */
  tick(dt, live, dissolve) {
    const input = this.input;
    this.clock += dt;
    this.dissolve = dissolve;
    if (this.latch && !input.held) this.latch = false;
    const held = this.mode === 'play' && live && !dissolve && !this.latch && input.held;
    this.pressed = held && !this.held;
    this.released = !held && this.held;
    this.held = held;
    if (this.pressed) {
      this.heldFor = 0;
      this._log('press');
    }
    if (this.released) {
      this.restFor = 0;
      this._log('release');
    }
    if (held) {
      this.heldFor += dt;
      if (this.heldFor >= FIRST_HOLD) this.first = false;
      this.flown += dt;
      if (input.aim.active) this.leaned += dt;
    } else this.restFor += dt;
    this.surge = this.mode === 'play' && live && !dissolve ? input.surge : 0;
    if (this.surge > 0.3 && held) this.sped = true;
    const step = input.takeGear();
    if (step && live && this.mode === 'play') this.setGear(this.gear + step);
    const moving = this.mode !== 'still';
    const want = moving ? Math.max(GEARS[this.gear], 1 + SURGE_PACE * this.surge) : 1;
    this.speed = damp(this.speed, want, SPEED_EASE, dt);
    if (Math.abs(this.speed - want) < 0.01) this.speed = want;
    this.fly = damp(this.fly, held ? 1 : 0, held ? RISE : FALL, dt);
    // (an exponential never arrives: the floor makes "let go and everything stops" literally true)
    if (!held) this.fly = Math.max(0, this.fly - FALL_FLOOR * dt);
  }

  /**
   * Move the current world's journey for one frame of play. Returns true when the player has held through the end
   * and the next world should begin.
   */
  advance(s, dt, duration) {
    const r = s.rules;
    const pt = s.pTarget;
    let k = 1;
    let drive = this.fly;
    let g = null;
    if (r) {
      // (indexed loops: this runs every frame and must not create so much as an iterator)
      const pace = r.pace;
      for (let i = 0; i < pace.length; i++) {
        if (pt >= pace[i][0]) k = pace[i][1];
        else break;
      }
      const commit = r.commit;
      for (let i = 0; i < commit.length; i++) {
        if (pt >= commit[i][0] && pt < commit[i][1]) {
          if (drive < COMMIT_DRIVE) drive = COMMIT_DRIVE;
          break;
        }
      }
      const gates = r.gates;
      for (let i = 0; i < gates.length; i++) {
        const x = gates[i];
        if (x.open) {
          // an open gate still owes its line: a second lap is quicker, never silent
          if (!x.said && x.find && s.p >= x.at) {
            x.said = true;
            if (!x.find.done) this.onSay(x.find.says);
          }
          continue;
        }
        if (x.at >= pt - 1e-9) {
          g = x;
          break;
        }
      }
    }
    const lim = g ? g.at : 1;
    const next = pt + (drive * k * this.speed * dt) / duration;
    s.pTarget = next < lim ? next : lim;

    // ---- the gate the journey is waiting at, and how long it has waited
    if (g && s.pTarget >= g.at - 1e-9 && Math.abs(s.p - g.at) < AT_GATE) {
      const gate = this.gate;
      if (this._gateRule !== g) {
        this._gateRule = g;
        this.gateOn = true;
        gate.id = g.id;
        gate.kind = g.kind;
        gate.stage = 0;
        gate.t = 0;
        this._log('gate', g.id);
      }
      // (engaged seconds: a phone put down on a table just idles)
      // (in a high gear the wait is shorter too: somebody in a hurry is not kept)
      if (this.held || this.input.sinceInput < ENGAGED) gate.t += dt * Math.min(GATE_SPEED, this.speed);
      if (gate.stage === 0 && gate.t >= g.cue) {
        gate.stage = 1;
        this._log('cue', g.id);
      }
      if (gate.stage === 1 && gate.t >= g.auto) {
        gate.stage = 2;
        this._log('auto', g.id);
      }
      // nobody can get stuck: a world that never answers is answered for
      if (gate.stage === 2 && gate.t >= g.auto + RESCUE) this._pass(s, g.id);
    } else if (this._gateRule) {
      this._gateRule = null;
      this.gateOn = false;
    }

    // ---- the end: keep flying and the next world begins
    if (s.p >= END_AT && this.held) {
      this.end += dt / END_HOLD;
      if (this.end >= 1) {
        if (this.end - dt / END_HOLD < 1) this._log('end', s.def.id);
        this.end = 1;
        return true;
      }
    } else if (this.end > 0) {
      this.end -= END_DRAIN * dt;
      if (this.end < 0) this.end = 0;
    }
    return false;
  }

  /** What a tool sees (allocates: not for the frame loop). */
  snapshot(app) {
    const s = app.cur;
    const a = this.input.aim;
    let state = null;
    try {
      state = s && s.world && s.world.playState ? s.world.playState() : null;
    } catch {}
    return {
      mode: this.mode,
      world: s ? s.def.id : null,
      p: s ? s.p : 0,
      pTarget: s ? s.pTarget : 0,
      held: this.held,
      fly: this.fly,
      surge: this.surge,
      gear: this.gear,
      speed: this.speed,
      aim: { x: a.x, y: a.y, dx: a.dx, dy: a.dy, active: a.active },
      gate: this.gateOn ? { ...this.gate } : null,
      cells: this.cellString(),
      lap: this.lap,
      end: this.end,
      state,
    };
  }
}

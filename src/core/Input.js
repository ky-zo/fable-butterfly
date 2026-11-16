import { damp } from './util.js';

/**
 * Pointer, hold, aim, keys. See docs/PLAY.md, section 2.
 *
 * One shared `pointer` object is handed to every world each frame (as frame.pointer):
 *   x, y    position, -1..1, +y is UP (NDC-style)
 *   sx, sy  smoothed position
 *   u, v    position 0..1, v up (screen UV: matches vUv of a fullscreen pass)
 *   vx, vy  smoothed velocity in NDC units / second
 *   speed   |velocity|
 *   down    primary button / finger is held
 *   idle    seconds since it last moved
 *   inside  it is over the picture and somebody is behind it
 *
 * What it means depends on `mode`, which the App sets:
 *   'watch' | 'scroll' | 'still'   the raw pointer, exactly as before play existed.
 *                                  In 'scroll' the `aim` object is kept as well (it is what a world steers its animal
 *                                  by, frame.play.aim): with a mouse it is the cursor, for a few seconds after the
 *                                  mouse was last moved on purpose; on touch only the SIDEWAYS part of a drag moves
 *                                  it, from the anchor, and the vertical part is the scroll. The pointer is untouched.
 *   'play'                         the AIM: where the player wants the animal to lean. With a mouse that is the cursor.
 *                                  On touch it is a trackpad: a drag moves the aim by the drag, starting from the
 *                                  animal (the anchor the world publishes), so the thumb never has to cover it.
 *                                  `inside` is aim.active, `down` is always false (a hold means fly: read play.held),
 *                                  and sx, sy rest at 0 so that no world's lens can lean on the aim.
 *
 * Independently of the mode it tracks the HOLD: a finger on the picture, the left mouse button, Space, or the
 * tooling hook. Pointers are kept in a Map by id, so lifting one finger of two never drops the flight.
 */

const DEAD = 6; // px of finger travel before a touch steers
const GAIN = 1.8; // aim px per finger px
const REACH = 0.4; // radius of the aim circle, as a fraction of min(W, H)
const EDGE = 20; // px: a touch that starts this close to the left or right edge is a hold only
const LINGER = 0.35; // seconds the aim stays active after the steering finger lifts
const HOME_TOUCH = 3; // 1/s: how fast the offset eases home after a touch
const HOME_KEYS = 2; // …and after the arrow keys
const KEY_SPEED = 1.4; // NDC / second
const LIMIT = 0.96; // the aim never leaves this much of the picture
const MOUSE_AWAKE = 5; // seconds a resting cursor still counts as an aim
// ---- steering while scrolling (docs/PLAY.md, section 15)
const SIDE_DEAD = 14; // px a finger must have gone sideways from where it came down before it steers…
const SIDE_RATIO = 0.5; // …and that must be at least this much of how far it has gone up or down: a swipe that drifts is a scroll
const SIDE_LINGER = 0.9; // seconds the lean is kept after the finger lifts (the flick is still carrying the journey)
const MOUSE_MEANT = 10; // px the mouse must travel in one movement to count as steering (a hand resting on a wheel does not)
// ---- speed: a quick swipe up is one gear faster and a swipe down one slower (the Play layer keeps the gear);
//      the wheel and Shift urge it on for a moment (the surge)
const FLICK = 750; // px / s: a finger moving this fast, mostly up or down, is a swipe and not a lean
const FLICK_STEP = 0.11; // of the screen height: a swipe this long is one gear (a lean never needs to travel this far)
const FLICK_COOL = 350; // ms before another gear can follow, so one long stroke is one step
const WHEEL_FULL = 420; // wheel px that fill it
const WHEEL_HOLD = 0.35; // s: a turning wheel counts as a hold for this long after its last notch
const SURGE_FALL = 1.1; // 1/s …
const SURGE_FLOOR = 0.22; // …less this much a second, so it is exactly zero soon after the last swipe
// ---- scroll (the main way to move): the wheel, and on touch a drag with momentum
const WHEEL_GAIN = 1.25; // scroll px per wheel px
const TOUCH_GAIN = 3.2; // scroll px per finger px (a phone screen is short and a world is long)
const FLING_MIN = 500; // scroll px / s below which a lifted finger just stops
const FLING_MAX = 14000;
const FLING_FALL = 2.6; // 1/s: how fast the momentum dies

export class Input {
  constructor(el) {
    this.el = el;
    this.pointer = { x: 0, y: 0, sx: 0, sy: 0, u: 0.5, v: 0.5, vx: 0, vy: 0, speed: 0, down: false, idle: 99, inside: false };
    /** Where the player is leaning, NDC. dx, dy = offset from the anchor. Same object for the whole session. */
    this.aim = { x: 0, y: 0, dx: 0, dy: 0, active: false };
    this.mode = 'play';
    /** The journey has begun (the intro is gone). Until then Space belongs to the intro. */
    this.live = false;
    /** A fly source is down right now. */
    this.held = false;
    /** Counters of press and release edges, so nothing between two frames is lost. */
    this.pressN = 0;
    this.releaseN = 0;
    /** Wheel events seen (in play they move nothing: the App answers with the hint). */
    this.wheelN = 0;
    /** 0..1: how hard the player is urging it on (the wheel, Shift). The Play layer turns it into pace. */
    this.surge = 0;
    /** Wheel notches and Shift presses seen. */
    this.surgeN = 0;
    /** Gears asked for by swipes since the Play layer last looked: +1 a swipe up, -1 a swipe down. */
    this.gearStep = 0;
    this._gearAt = -1e9;
    this._wheelT = 0;
    /** Seconds since anybody did anything at all. */
    this.sinceInput = 99;
    /** The animal's path point on screen, NDC. The App copies the world's `anchor` here every frame. */
    this.anchorX = 0;
    this.anchorY = 0;

    this._px = 0;
    this._py = 0;
    this._scroll = 0;
    this._touchY = null;
    this._touchT = 0;
    this._touchV = 0; // px / s of scroll the finger is giving (smoothed)
    this._fling = 0; // px / s of scroll still running after the finger lifted
    this.keyHandlers = [];
    this.anyInput = false;

    this._ptrs = new Map(); // pointerId → { id, x, y, edge, dead }   (touch and pen)
    this._steer = null; // id of the finger that steers
    this._dragging = false; // this touch has passed the dead zone
    this._linger = 0;
    this._offX = 0; // the trackpad offset, CSS px, +y DOWN
    this._offY = 0;
    this._homeRate = HOME_TOUCH;
    // (meant: seconds since the mouse was last moved on purpose; px, py, run, at: the movement that is being measured)
    this._mouse = { x: 0, y: 0, over: false, down: false, moved: 99, meant: 99, px: 0, py: 0, run: 0, at: 0 };
    this._keys = { space: false, left: false, right: false, up: false, down: false, shift: false };
    this._api = { hold: false, aim: false, x: 0, y: 0 };
    this._src = 'touch'; // who owns the aim: 'touch' (also the keys) | 'mouse' | 'api'
    this._aimIdle = 99;
    this._w = Math.max(1, window.innerWidth);
    this._h = Math.max(1, window.innerHeight);

    const isUi = (e) => !!(e.target && e.target.closest && e.target.closest('[data-ui]'));

    // ---- the raw pointer, for the modes that are not play (unchanged from before)
    const setFromEvent = (e) => {
      if (this.mode === 'play') return;
      const r = el.getBoundingClientRect();
      const p = this.pointer;
      p.u = (e.clientX - r.left) / Math.max(1, r.width);
      p.v = 1 - (e.clientY - r.top) / Math.max(1, r.height);
      p.x = p.u * 2 - 1;
      p.y = p.v * 2 - 1;
      p.idle = 0;
      p.inside = true;
      this.anyInput = true;
    };

    window.addEventListener(
      'pointermove',
      (e) => {
        setFromEvent(e);
        if (e.pointerType === 'mouse') {
          const m = this._mouse;
          m.x = (e.clientX / this._w) * 2 - 1;
          m.y = 1 - (e.clientY / this._h) * 2;
          m.over = true;
          m.moved = 0;
          // (scroll: a movement of a few pixels or more is steering; a tremor is not)
          // (the first event after a pause only says where the cursor is: it may have come in from anywhere)
          if (!m.at || e.timeStamp - m.at > 350) m.run = 0;
          else m.run += Math.hypot(e.clientX - m.px, e.clientY - m.py);
          m.px = e.clientX;
          m.py = e.clientY;
          m.at = e.timeStamp;
          if (m.run >= MOUSE_MEANT) m.meant = 0;
          if (!this._ptrs.size) this._src = 'mouse';
          this.sinceInput = 0;
          return;
        }
        const rec = this._ptrs.get(e.pointerId);
        if (!rec) return;
        const dx = e.clientX - rec.x;
        const dy = e.clientY - rec.y;
        const ms = e.timeStamp - rec.t;
        rec.x = e.clientX;
        rec.y = e.clientY;
        rec.t = e.timeStamp;
        this.sinceInput = 0;
        if (this.mode === 'scroll') {
          // scroll: only the sideways part of a drag steers, and only once the finger has plainly gone sideways
          if (!rec.side) {
            const side = Math.abs(e.clientX - rec.x0);
            if (side > SIDE_DEAD && side > SIDE_RATIO * Math.abs(e.clientY - rec.y0)) {
              rec.side = true;
              rec.dead = 0;
            }
          } else if (e.pointerId === this._steer) this._drag(rec, dx, 0);
          return;
        }
        // a quick stroke up or down is a swipe: it changes the gear and does not lean the animal
        const ady = Math.abs(dy);
        if (this.mode === 'play' && ms > 0 && ms < 120 && ady > Math.abs(dx) * 1.4 && (ady / ms) * 1000 > FLICK) {
          const dir = dy < 0 ? 1 : -1;
          if (rec.fdir !== dir) {
            rec.fdir = dir;
            rec.facc = 0;
          }
          rec.facc += ady;
          if (rec.facc >= FLICK_STEP * this._h && e.timeStamp - this._gearAt > FLICK_COOL) {
            this._gearAt = e.timeStamp;
            rec.facc = 0;
            this.gearStep += dir;
          }
          return;
        }
        rec.fdir = 0;
        if (e.pointerId === this._steer) this._drag(rec, dx, dy);
      },
      { passive: true },
    );

    window.addEventListener('pointerdown', (e) => {
      if (isUi(e)) return;
      setFromEvent(e);
      if (this.mode !== 'play') this.pointer.down = true;
      if (e.pointerType === 'mouse') {
        if (e.button !== 0) return;
        this._mouse.down = true;
        this._mouse.over = true;
        this._mouse.moved = 0;
        if (!this._ptrs.size) this._src = 'mouse';
      } else {
        const edge = e.clientX < EDGE || e.clientX > this._w - EDGE;
        this._ptrs.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, side: false, t: e.timeStamp, edge, dead: DEAD, fdir: 0, facc: 0 });
        this._src = 'touch';
        if (this._steer == null && !edge) this._takeOver(e.pointerId);
      }
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
      this._sync();
    });

    const up = (e) => {
      if (this.mode !== 'play' && e.type !== 'lostpointercapture') this.pointer.down = false;
      if (e.pointerType === 'mouse') {
        if (e.type === 'pointerup' && e.button !== 0) return;
        this._mouse.down = false;
      } else if (this._ptrs.delete(e.pointerId)) {
        if (e.pointerId === this._steer) {
          this._steer = null;
          // the next finger still down takes over, from where it is now
          for (const r of this._ptrs.values()) {
            if (!r.edge) {
              r.dead = DEAD;
              this._steer = r.id;
              break;
            }
          }
          if (this._steer == null) {
            this._linger = this._dragging ? (this.mode === 'scroll' ? SIDE_LINGER : LINGER) : 0;
            this._dragging = false;
            this._homeRate = HOME_TOUCH;
          }
        }
      }
      this._sync();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('lostpointercapture', up);
    document.addEventListener('pointerleave', () => {
      if (this.mode !== 'play') this.pointer.inside = false;
      this._mouse.over = false;
    });

    // ---- always a release, never a jump
    const drop = () => this.releaseAll();
    window.addEventListener('blur', drop);
    window.addEventListener('pagehide', drop);
    window.addEventListener('orientationchange', drop);
    document.addEventListener('visibilitychange', () => document.hidden && drop());
    window.addEventListener('resize', () => {
      this._w = Math.max(1, window.innerWidth);
      this._h = Math.max(1, window.innerHeight);
      drop();
    });

    // ---- the browser's own gestures must not fight the hold (the HUD's controls are [data-ui] and keep theirs)
    const stop = (e) => {
      if (!(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) e.preventDefault();
    };
    window.addEventListener('contextmenu', stop);
    window.addEventListener('dragstart', stop);
    window.addEventListener('selectstart', stop);
    window.addEventListener('gesturestart', stop);
    window.addEventListener('gesturechange', stop);
    // no long-press callout, no double-tap zoom, no pull to refresh, no compatibility mouse events on the picture
    el.addEventListener('touchstart', (e) => e.cancelable && e.preventDefault(), { passive: false });
    el.addEventListener('touchmove', (e) => e.cancelable && e.preventDefault(), { passive: false });

    window.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey) return;
        e.preventDefault();
        this.wheelN++;
        this.anyInput = true;
        let d = e.deltaY + e.deltaX * 0.5;
        if (e.deltaMode === 1) d *= 18;
        else if (e.deltaMode === 2) d *= 400;
        if (this.mode === 'play' && this.live) {
          // the wheel flies: each notch is a short hold and a push
          if (this.surge < 0.25) this.surgeN++;
          this.surge = Math.min(1, this.surge + Math.min(160, Math.abs(d)) / WHEEL_FULL);
          this._wheelT = WHEEL_HOLD;
          this._sync();
          return;
        }
        if (this.mode !== 'scroll') return;
        this._scroll += Math.max(-160, Math.min(160, d)) * WHEEL_GAIN;
        this._fling = 0;
        this.sinceInput = 0;
      },
      { passive: false },
    );

    // scroll on touch: a finger moving up the screen scrolls forward, like a page, and a flick carries on by itself
    window.addEventListener(
      'touchstart',
      (e) => {
        if (this.mode !== 'scroll' || isUi(e)) return;
        this._touchY = e.touches[0].clientY;
        this._touchT = e.timeStamp;
        this._touchV = 0;
        this._fling = 0; // a finger put down stops it, as it does a page
        this.sinceInput = 0;
      },
      { passive: true },
    );
    window.addEventListener(
      'touchmove',
      (e) => {
        if (this._touchY == null || this.mode !== 'scroll') return;
        const y = e.touches[0].clientY;
        const d = (this._touchY - y) * TOUCH_GAIN;
        const ms = Math.max(1, e.timeStamp - this._touchT);
        this._scroll += d;
        this._touchV += ((d / ms) * 1000 - this._touchV) * Math.min(1, ms / 60);
        this._touchY = y;
        this._touchT = e.timeStamp;
        this.anyInput = true;
        this.sinceInput = 0;
      },
      { passive: true },
    );
    const touchEnd = (e) => {
      if (this._touchY != null && this.mode === 'scroll' && e.type === 'touchend') {
        // (a finger that stopped before lifting gives nothing)
        const v = e.timeStamp - this._touchT < 90 ? this._touchV : 0;
        this._fling = Math.abs(v) > FLING_MIN ? Math.max(-FLING_MAX, Math.min(FLING_MAX, v)) : 0;
      }
      this._touchY = null;
      if (this.mode !== 'play') this.pointer.inside = false;
    };
    window.addEventListener('touchend', touchEnd);
    window.addEventListener('touchcancel', touchEnd);

    const flyKey = (e, on) => {
      const k = this._keys;
      switch (e.key) {
        case ' ':
          k.space = on;
          return true;
        case 'Shift':
          if (on && !k.shift) this.surgeN++;
          k.shift = on;
          return true;
        case 'ArrowLeft':
          k.left = on;
          break;
        case 'ArrowRight':
          k.right = on;
          break;
        case 'ArrowUp':
          k.up = on;
          break;
        case 'ArrowDown':
          k.down = on;
          break;
        default:
          return false;
      }
      if (on) {
        this._src = 'touch';
        this._homeRate = HOME_KEYS;
      }
      return true;
    };
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      // Space is the hold and the arrows steer (key repeat is not a second press)
      if (this.live && (this.mode === 'play' || this.mode === 'watch') && flyKey(e, true)) {
        e.preventDefault();
        if (!e.repeat) this._sync();
        return;
      }
      for (const h of this.keyHandlers) if (h(e) === true) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      if (flyKey(e, false)) this._sync();
    });
  }

  onKey(fn) {
    this.keyHandlers.push(fn);
  }

  // ------------------------------------------------------------------ hold and aim

  _takeOver(id) {
    this._steer = id;
    // a finger that comes back while the aim is still out picks it up where it is; once it has eased home, a plain
    // hold does not steer
    this._dragging = Math.hypot(this._offX, this._offY) > 2;
    this._linger = 0;
  }

  _clampOffset() {
    const R = REACH * Math.min(this._w, this._h);
    const d = Math.hypot(this._offX, this._offY);
    if (d > R) {
      this._offX *= R / d;
      this._offY *= R / d;
    }
    // …and the aim stays in the picture (the anchor is not always at the centre)
    const hw = this._w / 2;
    const hh = this._h / 2;
    this._offX = Math.max((-LIMIT - this.anchorX) * hw, Math.min((LIMIT - this.anchorX) * hw, this._offX));
    this._offY = Math.max((this.anchorY - LIMIT) * hh, Math.min((this.anchorY + LIMIT) * hh, this._offY));
  }

  _drag(rec, dx, dy) {
    const d = Math.hypot(dx, dy);
    if (d === 0) return;
    if (rec.dead > 0) {
      const use = d - rec.dead;
      rec.dead = Math.max(0, rec.dead - d);
      if (use <= 0) return;
      dx *= use / d;
      dy *= use / d;
    }
    this._dragging = true;
    this._homeRate = HOME_TOUCH;
    this._offX += dx * GAIN;
    this._offY += dy * GAIN;
    this._clampOffset();
    this._aimIdle = 0;
  }

  /** Recompute `held` after anything that could have changed it. */
  _sync() {
    const held = this._ptrs.size > 0 || this._mouse.down || this._keys.space || this._api.hold || this._wheelT > 0;
    if (held !== this.held) {
      this.held = held;
      if (held) this.pressN++;
      else this.releaseN++;
    }
    this.sinceInput = 0;
    this.anyInput = true;
  }

  /** Let go of everything (blur, hidden tab, rotation, a call coming in). The flight ends in a glide, not a jump. */
  releaseAll() {
    if (this._steer != null && this._dragging) this._linger = LINGER;
    this._ptrs.clear();
    this._steer = null;
    this._dragging = false;
    this._mouse.down = false;
    const k = this._keys;
    k.space = k.left = k.right = k.up = k.down = k.shift = false;
    this._api.hold = false;
    this._wheelT = 0;
    if (this.mode !== 'play') this.pointer.down = false;
    // (losing focus is not something the player did: it does not count as input unless it ended a hold)
    const was = this.held;
    const since = this.sinceInput;
    this._sync();
    if (!was) this.sinceInput = since;
  }

  /** Tooling: press or release the hold as if by hand. */
  hold(on) {
    this._api.hold = !!on;
    this._sync();
  }

  /** The gears swipes have asked for since the last call (the Play layer calls this once a frame). */
  takeGear() {
    const g = this.gearStep;
    this.gearStep = 0;
    return g;
  }

  /** Tooling: urge it on as the wheel would (0..1). */
  push(k = 1) {
    if (this.surge < 0.25) this.surgeN++;
    this.surge = Math.min(1, this.surge + k);
    this.sinceInput = 0;
  }

  /** Tooling: put the aim at (x, y) NDC and make it active; `null` lets it go. */
  setAim(x, y) {
    const a = this._api;
    if (x == null) {
      a.aim = false;
      if (this._src === 'api') this._src = 'touch';
    } else {
      a.aim = true;
      a.x = x;
      a.y = y;
      this._src = 'api';
    }
    this.sinceInput = 0;
  }

  /** Programmatic scroll (keyboard steps in ?scroll). */
  nudge(px) {
    this._scroll += px;
  }

  consumeScroll() {
    const s = this._scroll;
    this._scroll = 0;
    return s;
  }

  /** Stop any scroll still running (a world has changed under it). */
  stopScroll() {
    this._scroll = 0;
    this._fling = 0;
  }

  /** Force the raw pointer (screenshot tool / tests). */
  set(x, y, down = false) {
    const p = this.pointer;
    p.x = p.sx = x;
    p.y = p.sy = y;
    p.u = x * 0.5 + 0.5;
    p.v = y * 0.5 + 0.5;
    p.down = down;
    p.inside = true;
    p.idle = 0;
    this._px = x;
    this._py = y;
  }

  /** The aim for this frame. `scroll`: only the aim is written (the pointer stays raw), and a mouse steers only when moved on purpose. */
  _updateAim(dt, scroll = false) {
    const a = this.aim;
    const ax = this.anchorX;
    const ay = this.anchorY;
    const hw = this._w / 2;
    const hh = this._h / 2;
    let x, y, active;
    if (this._src === 'api' && this._api.aim) {
      x = this._api.x;
      y = this._api.y;
      active = true;
      this._aimIdle = 0;
    } else if (this._src === 'mouse') {
      const m = this._mouse;
      x = m.x;
      y = m.y;
      active = scroll ? m.over && m.meant < MOUSE_AWAKE : m.over && (m.down || m.moved < MOUSE_AWAKE);
      this._aimIdle = m.moved;
      if (scroll) m.meant += dt;
      else m.moved += dt;
    } else {
      const k = this._keys;
      const kx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      const ky = (k.up ? 1 : 0) - (k.down ? 1 : 0);
      if (kx || ky) {
        this._offX += kx * KEY_SPEED * hw * dt;
        this._offY -= ky * KEY_SPEED * hh * dt;
        this._linger = LINGER;
        this._aimIdle = 0;
      }
      if ((this._steer != null && this._dragging) || kx || ky) active = true;
      else if (this._linger > 0) {
        this._linger -= dt;
        active = true;
      } else {
        active = false;
        if (this._steer == null && (this._offX !== 0 || this._offY !== 0)) {
          this._offX = damp(this._offX, 0, this._homeRate, dt);
          this._offY = damp(this._offY, 0, this._homeRate, dt);
          if (Math.abs(this._offX) + Math.abs(this._offY) < 0.25) this._offX = this._offY = 0;
        }
      }
      this._clampOffset();
      x = ax + this._offX / hw;
      y = ay - this._offY / hh;
      this._aimIdle += dt;
    }
    a.x = x;
    a.y = y;
    a.dx = x - ax;
    a.dy = y - ay;
    a.active = active;
    if (scroll) return;
    const p = this.pointer;
    p.x = x;
    p.y = y;
    p.u = x * 0.5 + 0.5;
    p.v = y * 0.5 + 0.5;
    p.inside = active;
    p.down = false;
    p.idle = this._aimIdle;
  }

  update(dt) {
    const p = this.pointer;
    if (dt <= 0) return;
    this.sinceInput += dt;
    if (this._wheelT > 0) {
      this._wheelT -= dt;
      if (this._wheelT <= 0) {
        this._wheelT = 0;
        const since = this.sinceInput;
        this._sync();
        this.sinceInput = since;
      }
    }
    if (this._fling !== 0) {
      if (this.mode !== 'scroll') this._fling = 0;
      else {
        this._scroll += this._fling * dt;
        this._fling = damp(this._fling, 0, FLING_FALL, dt);
        if (Math.abs(this._fling) < 40) this._fling = 0;
        this.sinceInput = 0;
      }
    }
    if (this._keys.shift) this.surge = 1;
    else if (this.surge > 0) this.surge = Math.max(0, damp(this.surge, 0, SURGE_FALL, dt) - SURGE_FLOOR * dt);
    const play = this.mode === 'play';
    if (play) this._updateAim(dt);
    else if (this.mode === 'scroll') this._updateAim(dt, true);
    const ivx = (p.x - this._px) / dt;
    const ivy = (p.y - this._py) / dt;
    this._px = p.x;
    this._py = p.y;
    p.vx = damp(p.vx, ivx, 12, dt);
    p.vy = damp(p.vy, ivy, 12, dt);
    p.speed = Math.hypot(p.vx, p.vy);
    // (in play the smoothed position rests at the centre: it is what a lens would lean on, and play never moves a lens)
    p.sx = damp(p.sx, play ? 0 : p.x, 4.5, dt);
    p.sy = damp(p.sy, play ? 0 : p.y, 4.5, dt);
    if (!play) p.idle += dt;
  }
}

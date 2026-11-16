// Heads-up display: intro, the wing, layer index, layer label, captions, toggles, hints, loading.
// The App talks to it only through the public methods below — keep their names and semantics stable.
// Every setter remembers what it last showed and touches the DOM only when that changes: most of them are
// called once a frame.
//
// The HUD is the wall text, never the picture: one ink, set straight onto the image with no boxes.
// Because the worlds run from near-black to milky white, every zone picks light or dark ink from the
// pixels underneath it (see tone.js).

import { Tone } from './tone.js';
import { WING_GLYPH } from './wingGlyph.js';
import { GEARS } from '../core/Play.js';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const media = (q) => typeof matchMedia === 'function' && matchMedia(q).matches;

const ICON_RETURN =
  '<svg class="hl-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M12.5 3.5v4.25a1.75 1.75 0 0 1-1.75 1.75H3.75"/><path d="M6.5 6.75 3.75 9.5l2.75 2.75"/></svg>';
const ICON_DOWN =
  '<svg class="hl-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M6 1.5v8.5"/><path d="M2.75 6.75 6 10l3.25-3.25"/></svg>';

// The three controls, drawn: a finger that stays down, one that slides, one that flicks. The same marks are on the
// intro card and in the coach, so a control is met twice with the same face.
const ICO = (k, body) => `<svg class="hl-ico hl-ico-${k}" viewBox="0 0 44 44" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON_HOLD = ICO('hold', '<circle class="a" cx="22" cy="22" r="9"/><circle class="b" cx="22" cy="22" r="9"/><circle class="d" cx="22" cy="22" r="5"/>');
const ICON_STEER = ICO('steer', '<path d="M9.5 17 4.5 22l5 5M34.5 17l5 5-5 5"/><circle class="d" cx="22" cy="22" r="5"/>');
const ICON_FASTER = ICO('faster', '<path d="M16 12.5 22 6.5l6 6M16 19.5l6-6 6 6"/><circle class="d" cx="22" cy="32" r="5"/>');
// The speed: a stack of chevrons, as many lit as the gear (data-gear on the svg or on anything above it). It is the
// "faster" mark without the finger, so the button, the coach and the intro all show the same thing.
const ICON_SPEED = '<svg class="hl-speed-i" viewBox="0 0 24 28" aria-hidden="true" focusable="false"><path class="c1" d="M5 25.5l7-7 7 7"/><path class="c2" d="M5 17.5l7-7 7 7"/><path class="c3" d="M5 9.5l7-7 7 7"/></svg>';
// scroll, drawn twice: a mouse whose wheel turns, and (on touch) a finger that slides up the screen
const ICON_WHEEL = ICO('wheel', '<rect x="13" y="6" width="18" height="32" rx="9"/><circle class="d" cx="22" cy="15" r="2.3"/>');
const ICON_SWIPE = ICO('swipe', '<path d="M16 13 22 7l6 6"/><circle class="d" cx="22" cy="31" r="5"/>');
const COARSE = media('(pointer: coarse)');
const COACH = {
  // [icon, touch, mouse]
  scroll: [COARSE ? ICON_SWIPE : ICON_WHEEL, 'Swipe up to fly', 'Scroll to fly'],
  hold: [ICON_HOLD, 'Hold to fly', 'Hold to fly'],
  steer: [ICON_STEER, 'Drag to steer', 'Move to steer'],
  side: [ICON_STEER, 'Drag sideways to steer', 'Move to steer'], // scroll: up and down is the journey
  faster: [ICON_FASTER, 'Swipe up to go faster', 'Press S to go faster'],
};
const SPEED_FLASH = 1.3; // seconds the new speed is written large after a change

const KEYS_SCROLL = [
  ['Scroll', 'Fly'],
  ['Arrows', 'Step'],
  ['1 – 6', 'Go to a layer'],
  ['A', 'Watch'],
  ['S', 'Watch speed'],
  ['M', 'Sound'],
  ['H', 'Hide the interface'],
  ['F', 'Full screen'],
];
const KEYS = [
  ['Space', 'Fly'],
  ['Arrows', 'Steer'],
  ['S', 'Speed'],
  ['Shift', 'Sprint'],
  ['1 – 6', 'Go to a layer'],
  ['A', 'Watch'],
  ['M', 'Sound'],
  ['H', 'Hide the interface'],
  ['F', 'Full screen'],
];

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {{worlds: Array<{id,number,title,theme}>, hidden?: boolean}} opts
   */
  constructor(root, { worlds, hidden = false, scroll = false }) {
    this.root = root;
    /** Scrolling moves the journey (the default); false with ?play, where a hold does. */
    this.scroll = !!scroll;
    this.worlds = worlds;
    this.handlers = { jump: [], sound: [], auto: [], speed: [] };
    this.sound = false;
    this.auto = false;
    this.hidden = !!hidden;
    this._caption = null;
    this._capWant = null;
    this._sayText = null;
    this._sayLeft = 0;
    this._hint = null;
    this._coach = null;
    this._gear = -1;
    this._speedOn = null;
    this._nudge = false;
    this._flashLeft = 0;
    this._end = false;
    this._endK = -1;
    this._cells = null;
    this._here = -1;
    this._foundLeft = 0;
    this._current = -1;
    this._p = -1;
    this._worldTitle = null;
    // Screenshot mode steps frames by hand, so nothing may depend on timers or transitions there.
    this.still = new URLSearchParams(location.search).has('still');
    this.coarse = media('(pointer: coarse)');
    this.calm = media('(prefers-reduced-motion: reduce)');

    root.classList.add('hl-hud');
    root.classList.toggle('is-hidden', this.hidden);
    root.classList.toggle('is-still', this.still);
    root.dataset.state = 'boot';
    root.innerHTML = '';

    const layer = (this.layer = h('div', 'hl-layer'));
    const total = String(worlds.length).padStart(2, '0');

    // ---- top row: wordmark, toggles
    const top = (this.top = h('header', 'hl-top'));
    // the wordmark and the wing under it are one tap target: it opens the list of layers (how a phone jumps)
    const G = WING_GLYPH;
    this.home = h('div', 'hl-home hl-tone');
    this.home.dataset.ui = '';
    this.homeBtn = h(
      'button',
      'hl-home-btn',
      `<span class="hl-mark">Hidden Layers</span>` +
        `<svg class="hl-wing" viewBox="0 0 ${G.w} ${G.h}" aria-hidden="true" focusable="false">` +
        `<g class="hl-wing-cells">${G.cells.map((d) => `<path class="hl-cell" d="${d}"/>`).join('')}</g>` +
        `<path class="hl-wing-veins" d="${G.veins.join('')}"/>` +
        `<path class="hl-wing-edge" d="${G.outline.join('')}"/></svg>`,
    );
    this.homeBtn.type = 'button';
    this.homeBtn.setAttribute('aria-label', 'Hidden Layers: go to a layer');
    this.homeBtn.setAttribute('aria-expanded', 'false');
    this.homeBtn.setAttribute('aria-controls', 'hl-layers');
    this.mark = this.homeBtn.firstChild;
    this.wing = this.homeBtn.querySelector('.hl-wing');
    this.cellEls = [...this.wing.querySelectorAll('.hl-cell')];
    this.layers = h('ol', 'hl-layers');
    this.layers.id = 'hl-layers';
    this.layerBtns = worlds.map((w, i) => {
      const li = h('li');
      const b = h('button', 'hl-layers-item', `<span class="hl-num">${esc(w.number)}</span><span>${esc(w.title)}</span>`);
      b.type = 'button';
      b.setAttribute('aria-label', `Layer ${w.number}, ${w.title}: ${w.theme}`);
      b.addEventListener('click', () => {
        this._setLayers(false);
        this._emit('jump', i);
      });
      li.append(b);
      this.layers.append(li);
      return b;
    });
    this.layers.inert = true;
    this.home.append(this.homeBtn, this.layers);
    const controls = (this.controls = h('div', 'hl-controls hl-tone'));
    controls.dataset.ui = '';
    const toggle = (label, name, key) => {
      const b = h('button', 'hl-toggle', `<span>${label}</span><i aria-hidden="true">off</i>`);
      b.type = 'button';
      b.setAttribute('aria-label', name);
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-keyshortcuts', key);
      return b;
    };
    this.autoBtn = toggle('Watch', 'Watch: let it play by itself', 'A');
    this.soundBtn = toggle('Sound', 'Sound', 'M');
    this.keysBtn = h('button', 'hl-toggle hl-keys-btn', '<span>Keys</span>');
    this.keysBtn.type = 'button';
    this.keysBtn.setAttribute('aria-expanded', 'false');
    this.keysBtn.setAttribute('aria-controls', 'hl-keys');
    this.keys = h('dl', 'hl-keys', (this.scroll ? KEYS_SCROLL : KEYS).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join(''));
    this.keys.id = 'hl-keys';
    controls.append(this.autoBtn, this.soundBtn, this.keysBtn, this.keys);
    top.append(this.home, controls);

    // ---- layer index: six segments, the current one carries the progress
    this.index = h('nav', 'hl-index hl-tone');
    this.index.dataset.ui = '';
    this.index.setAttribute('aria-label', 'Layers');
    this.indexBtns = worlds.map((w, i) => {
      const b = h(
        'button',
        'hl-index-item',
        `<span class="hl-index-label"><span class="hl-index-t">${esc(w.title)}</span><span class="hl-index-th">${esc(w.theme)}</span></span>` +
          `<span class="hl-index-n">${esc(w.number)}</span><span class="hl-index-seg"><b></b></span>`,
      );
      b.type = 'button';
      b.setAttribute('aria-label', `Layer ${w.number}, ${w.title}: ${w.theme}`);
      if (i < 9) b.setAttribute('aria-keyshortcuts', String(i + 1));
      b.addEventListener('click', () => this._emit('jump', i));
      this.index.append(b);
      return b;
    });
    this.fills = this.indexBtns.map((b) => b.querySelector('b'));
    // the titles that appear beside the index share one right-aligned column, as wide as the longest of them
    const fit = () => {
      let w = 0;
      for (const b of this.indexBtns) {
        const t = b.querySelector('.hl-index-t');
        t.style.minWidth = '0';
        w = Math.max(w, t.getBoundingClientRect().width);
        t.style.minWidth = '';
      }
      if (w > 0) this.index.style.setProperty('--hl-tw', `${Math.ceil(w)}px`);
    };
    this.index.addEventListener('pointerenter', fit);
    this.index.addEventListener('focusin', fit);

    // ---- current layer label
    this.world = h('div', 'hl-world hl-tone');
    this.worldIn = h('div', 'hl-world-in');
    this.title = h('h2', 'hl-title');
    this.meta = h('p', 'hl-meta', `<span class="hl-meta-n"></span><span class="hl-meta-of">/ ${total}</span><span class="hl-meta-theme"></span>`);
    this.metaN = this.meta.querySelector('.hl-meta-n');
    this.metaTheme = this.meta.querySelector('.hl-meta-theme');
    this.worldIn.append(this.title, this.meta);
    this.world.append(this.worldIn);

    // ---- caption (the visual line is built word by word; a plain copy goes to the live region)
    this.caption = h('p', 'hl-caption hl-tone', '<span class="hl-caption-in"></span>');
    this.caption.setAttribute('aria-hidden', 'true');
    this.captionIn = this.caption.firstChild;
    this.spoken = h('div', 'hl-sr');
    this.spoken.setAttribute('role', 'status');
    this.spoken.setAttribute('aria-live', 'polite');
    this.spoken.setAttribute('aria-atomic', 'true');

    // ---- bottom-right slot: one short message at a time (hint, loading line, or what went wrong)
    this.aside = h('div', 'hl-aside hl-tone');
    this.hint = h('div', 'hl-hint');
    this.endEl = h('div', 'hl-hint hl-end', `<span class="hl-end-verb"></span>${ICON_DOWN}<span class="hl-hint-next"><span class="hl-num"></span><span class="hl-end-name"></span></span>`);
    this.endVerb = this.endEl.querySelector('.hl-end-verb');
    this.endNum = this.endEl.querySelector('.hl-num');
    this.endName = this.endEl.querySelector('.hl-end-name');
    this.loading = h('div', 'hl-loading', '<span class="hl-loading-t"></span><i class="hl-loading-bar"></i>');
    this.loading.setAttribute('role', 'status');
    this.loadingText = this.loading.firstChild;
    this.errorEl = h('div', 'hl-error');
    this.errorEl.setAttribute('role', 'alert');
    this.aside.append(this.hint, this.endEl, this.loading, this.errorEl);

    // ---- the coach: one control at a time, in the caption's place (they are never up together)
    this.coach = h('div', 'hl-coach hl-tone', '<span class="hl-coach-i"></span><span class="hl-coach-t"></span>');
    this.coach.setAttribute('aria-hidden', 'true');
    this.coachIcon = this.coach.firstChild;
    this.coachText = this.coach.lastChild;

    // ---- the speed: always in reach while the journey runs. A tap is one gear up (and round again); a swipe up or
    //      down on the picture does the same without letting go
    this.speedBtn = h('button', 'hl-speed hl-tone', `<span class="hl-speed-x"></span>${ICON_SPEED}`);
    this.speedBtn.type = 'button';
    this.speedBtn.dataset.ui = '';
    this.speedBtn.setAttribute('aria-keyshortcuts', 'S');
    this.speedX = this.speedBtn.firstChild;

    this.debugEl = h('pre', 'hl-debug hl-tone');

    // ---- intro
    const c = this.coarse ? 1 : 2;
    const how = (this.scroll ? ['scroll'] : ['hold', 'steer', 'faster']).map((k) => `<li>${COACH[k][0]}<span>${COACH[k][c]}</span></li>`);
    this.introEl = h('section', 'hl-intro');
    this.introEl.dataset.ui = '';
    this.introEl.setAttribute('aria-labelledby', 'hl-intro-title');
    this.introEl.innerHTML = `
      <div class="hl-intro-body">
        <h1 class="hl-intro-title" id="hl-intro-title">Hidden Layers</h1>
        <p class="hl-intro-lede">One butterfly behind glass. Six small worlds.</p>
        <div class="hl-intro-actions">
          <button type="button" class="hl-enter" data-act="enter"><span>Enter</span>${ICON_RETURN}</button>
          <button type="button" class="hl-toggle" data-act="intro-sound" aria-label="Sound" aria-pressed="true"><span>Sound</span><i aria-hidden="true">on</i></button>
        </div>
        <ul class="hl-intro-how">${how.join('')}</ul>
        <p class="hl-intro-alt">or <button type="button" class="hl-how-watch" data-act="watch">just watch</button></p>
      </div>`;

    layer.append(top, this.index, this.world, this.caption, this.coach, this.spoken, this.aside, this.speedBtn, this.debugEl, this.introEl);

    // shown for a moment after H hides everything, so the way back is never a secret
    this.note = h('div', 'hl-note hl-tone', 'Interface hidden. Press <kbd>H</kbd> to bring it back.');
    this.note.setAttribute('role', 'status');
    root.append(layer, this.note);

    // ---- events
    this.homeBtn.addEventListener('click', () => this._setLayers(!this._layersOpen));
    this.autoBtn.addEventListener('click', () => this._emit('auto', !this.auto));
    this.soundBtn.addEventListener('click', () => this._emit('sound', !this.sound));
    this.keysBtn.addEventListener('click', () => this._setKeys(!this._keysOpen));
    // (pointerdown, not click: a second finger must be able to tap it while the first one keeps flying, and a browser
    // makes no click out of that. A click with no pointer behind it is the keyboard.)
    this.speedBtn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      this._emit('speed');
    });
    this.speedBtn.addEventListener('click', (e) => e.detail === 0 && this._emit('speed'));
    // A button that keeps focus after a mouse click would swallow the next Space; let go of it.
    root.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (b && e.detail > 0) b.blur();
    });
    // Enter / Space on a focused button belong to that button, not to the journey.
    root.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && e.target.closest && e.target.closest('button')) e.stopPropagation();
    });
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || root.dataset.state !== 'live') return;
      if (e.key === '?') this._setKeys(!this._keysOpen);
      else if (e.key === 'Escape') {
        if (this._keysOpen) this._setKeys(false);
        if (this._layersOpen) this._setLayers(false);
      }
    });
    window.addEventListener('pointerdown', (e) => {
      if (this._keysOpen && !(e.target.closest && e.target.closest('.hl-controls'))) this._setKeys(false);
      if (this._layersOpen && !(e.target.closest && e.target.closest('.hl-home'))) this._setLayers(false);
    });

    // ---- adaptive ink
    this.tone = null;
    if (!this.hidden || !this.still) {
      const canvas = document.getElementById('stage') || document.querySelector('canvas');
      const tone = (this.tone = new Tone(canvas, { sync: this.still }));
      const isLive = () => root.dataset.state === 'live';
      for (const el of [this.home, this.controls, this.index, this.world, this.caption, this.coach, this.aside, this.speedBtn]) tone.add(el, { active: isLive });
      tone.add(this.debugEl, { active: () => this.debugEl.classList.contains('is-in') });
      // the intro keeps its light ink and deepens its scrim instead when the picture behind it is bright
      tone.add(this.introEl.firstElementChild, { target: this.introEl, hi: 0.3, lo: 0.24, active: () => root.dataset.state === 'intro' });
      if (!this.still) {
        // Started here, before the core starts its own loop, so this callback runs first in every frame.
        const pre = (t) => {
          requestAnimationFrame(pre);
          tone.collect(t);
        };
        requestAnimationFrame(pre);
      }
    }

    this._setState('boot');
    this.setAuto(false);
    this.setSound(false);
  }

  on(evt, fn) {
    this.handlers[evt].push(fn);
  }
  _emit(evt, v) {
    for (const fn of this.handlers[evt]) fn(v);
  }

  _setState(state) {
    const root = this.root;
    const was = root.dataset.state;
    root.dataset.state = state;
    const live = state === 'live';
    this.top.inert = !live;
    this.index.inert = !live;
    this.introEl.inert = state !== 'intro';
    if (live && was !== 'live' && !this.still) {
      // the chrome arrives a beat after the picture, one piece at a time
      root.classList.add('is-arriving');
      clearTimeout(this._arriveT);
      this._arriveT = setTimeout(() => root.classList.remove('is-arriving'), 3200);
    }
  }

  _setKeys(open) {
    this._keysOpen = !!open;
    this.keys.classList.toggle('is-open', this._keysOpen);
    this.keysBtn.setAttribute('aria-expanded', String(this._keysOpen));
  }

  /** The list of layers under the wing: six numbers and names, the current one marked. */
  _setLayers(open) {
    this._layersOpen = !!open;
    this.layers.classList.toggle('is-open', this._layersOpen);
    this.layers.inert = !this._layersOpen;
    this.homeBtn.setAttribute('aria-expanded', String(this._layersOpen));
  }

  /**
   * Show the intro card. Resolves when the visitor enters. onEnter({sound}) runs synchronously inside the
   * click/keypress, which is where iOS allows audio to start.
   */
  intro(onEnter) {
    this._setState('intro');
    let sound = true;
    const sBtn = this.introEl.querySelector('[data-act="intro-sound"]');
    sBtn.addEventListener('click', () => {
      sound = !sound;
      sBtn.setAttribute('aria-pressed', String(sound));
      sBtn.querySelector('i').textContent = sound ? 'on' : 'off';
    });
    return new Promise((resolve) => {
      let done = false;
      let watch = false;
      const go = () => {
        if (done) return;
        done = true;
        window.removeEventListener('keydown', onKey);
        const a = document.activeElement;
        if (a && this.introEl.contains(a)) a.blur();
        this._setState('live');
        onEnter?.({ sound, watch });
        resolve({ sound, watch });
      };
      const onKey = (e) => {
        if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      };
      window.addEventListener('keydown', onKey);
      this.introEl.querySelector('[data-act="enter"]').addEventListener('click', go, { once: true });
      // "Or press Watch": the same door, with the film already running
      this.introEl.querySelector('[data-act="watch"]').addEventListener('click', () => {
        watch = true;
        go();
      });
    });
  }

  /** Skip the intro (deep links, screenshots). */
  live() {
    this._setState('live');
  }

  setWorld(i, meta) {
    this._current = i;
    this._p = -1;
    for (const list of [this.indexBtns, this.layerBtns]) {
      list.forEach((b, j) => {
        b.classList.toggle('is-current', j === i);
        if (j === i) b.setAttribute('aria-current', 'step');
        else b.removeAttribute('aria-current');
      });
    }
    this._renderEnd();
    if (meta.title === this._worldTitle) return;
    const first = this._worldTitle == null;
    this._worldTitle = meta.title;
    const swap = () => {
      this.title.textContent = meta.title || '';
      this.metaN.textContent = meta.number || '';
      this.metaTheme.textContent = meta.theme || '';
      this.world.classList.remove('is-out');
    };
    clearTimeout(this._swapT);
    if (first || this.still) swap();
    else {
      // the old label dissolves, the new one resolves: the same move the picture is making
      this.world.classList.add('is-out');
      this._swapT = setTimeout(swap, this.calm ? 160 : 460);
    }
  }

  setProgress(p) {
    if (this.hidden) return;
    p = Math.max(0, Math.min(1, +p || 0));
    if (this._current >= 0 && Math.abs(p - this._p) > 0.0004) {
      this._p = p;
      this.fills[this._current].style.setProperty('--hl-p', p.toFixed(4));
    }
    // setProgress is the one call that arrives every frame, right after the frame is drawn
    const tone = this.tone;
    if (!tone || this.root.dataset.state === 'boot') return;
    if (!this.still) tone.tick(performance.now());
    else if (!this._toneQueued) {
      this._toneQueued = true;
      queueMicrotask(() => {
        this._toneQueued = false;
        tone.tick(performance.now());
      });
    }
  }

  /** Called once a frame with the frame's seconds: runs the clock of a line that was said (see say()). */
  update(dt) {
    if (this._sayLeft > 0) {
      this._sayLeft -= dt;
      if (this._sayLeft <= 0) this._showCaption(this._capWant);
    }
    if (this._foundLeft > 0) {
      this._foundLeft -= dt;
      if (this._foundLeft <= 0) this.root.classList.remove('is-found');
    }
    if (this._flashLeft > 0) this._flashLeft -= dt;
  }

  /** Say a line now and keep it up for `seconds`, whatever the progress captions want meanwhile. */
  say(text, seconds = 6) {
    this._sayText = text || null;
    this._sayLeft = text ? seconds : 0;
    this._showCaption(this._sayText || this._capWant);
  }

  /** The line that belongs to this progress (null for none). A line that was said holds the floor until its time is up. */
  setCaption(text) {
    text = text || null;
    this._capWant = text;
    if (this._sayLeft > 0) return;
    this._showCaption(text);
  }

  _showCaption(text) {
    text = text || null;
    if (text === this._caption) return;
    this._caption = text;
    clearTimeout(this._capT);
    const el = this.caption;
    const now = performance.now();
    if (el.classList.contains('is-in')) {
      el.classList.remove('is-in');
      this._capOut = now;
    }
    // never swap the words while the previous line is still dissolving
    const wait = Math.max(text ? 60 : 0, 620 - (now - (this._capOut ?? -1e9)));
    const show = () => {
      if (!text) {
        this.captionIn.textContent = '';
        this.spoken.textContent = '';
        return;
      }
      const words = text.trim().split(/\s+/);
      const step = Math.min(46, 900 / words.length);
      const frag = document.createDocumentFragment();
      words.forEach((w, i) => {
        const s = document.createElement('span');
        s.textContent = w;
        s.style.setProperty('--hl-wd', `${Math.round(i * step)}ms`);
        frag.append(s, i < words.length - 1 ? ' ' : '');
      });
      this.captionIn.replaceChildren(frag);
      void el.offsetWidth; // commit the hidden state so the words have somewhere to arrive from
      el.classList.add('is-in');
      this.spoken.textContent = text;
    };
    if (this.still) show();
    else this._capT = setTimeout(show, wait);
  }

  /**
   * Which control to show: 'scroll' | 'side' | 'hold' | 'steer' | 'faster' | '' (none). It gives way to any line that is being said, and to
   * the speed for a moment after it changes. Returns what is showing ('speed' for that moment, null for nothing).
   */
  setCoach(kind) {
    const free = this._sayLeft <= 0 && !this._caption;
    kind = !free ? null : this._flashLeft > 0 ? 'speed' : kind || null;
    const nudge = kind === 'faster';
    if (nudge !== this._nudge) {
      this._nudge = nudge;
      this.speedBtn.classList.toggle('is-nudge', nudge);
    }
    const key = kind === 'speed' ? `speed${this._gear}` : kind;
    if (key === this._coach) return kind;
    this._coach = key;
    if (kind === 'speed') {
      this.coachIcon.innerHTML = ICON_SPEED;
      this.coachText.textContent = `${GEARS[this._gear]}× speed`;
    } else if (kind) {
      const c = COACH[kind];
      this.coachIcon.innerHTML = c[0];
      this.coachText.textContent = c[this.coarse ? 1 : 2];
    }
    this.coach.dataset.gear = String(this._gear);
    this.coach.classList.toggle('is-quick', kind === 'speed');
    this.coach.classList.toggle('is-in', !!kind);
    return kind;
  }

  /** The gear (an index into GEARS) and whether the control is offered at all (it is not while scrubbing). */
  setSpeed(gear, on = true) {
    on = !!on;
    if (on !== this._speedOn) {
      this._speedOn = on;
      this.speedBtn.classList.toggle('is-on', on);
      this.speedBtn.inert = !on;
    }
    if (gear === this._gear) return;
    this._gear = gear;
    const n = GEARS[gear];
    this.speedBtn.dataset.gear = String(gear);
    this.speedX.textContent = `${n}×`;
    this.speedBtn.setAttribute('aria-label', `Speed: ${n} times. Tap to change`);
  }

  /** The speed was just asked to change: write it large for a moment (the button answers too). */
  flashSpeed() {
    if (this.still) return;
    this._flashLeft = SPEED_FLASH;
    const b = this.speedBtn;
    b.classList.remove('is-bump');
    void b.offsetWidth;
    b.classList.add('is-bump');
  }

  setHint(text) {
    text = text || null;
    if (text === this._hint) return;
    this._hint = text;
    if (text) this.hint.textContent = text;
    this.hint.classList.toggle('is-in', !!text);
  }

  _renderEnd() {
    if (this._current < 0) return;
    const next = this.worlds[(this._current + 1) % this.worlds.length];
    // with Watch on the journey carries on by itself, so nobody is asked to do anything
    const verb = this.auto ? 'Next' : !this.scroll ? 'Keep flying' : this.coarse ? 'Keep swiping' : 'Keep scrolling';
    const key = `${verb}|${next.number}`;
    if (key === this._endKey) return;
    this._endKey = key;
    this.endVerb.textContent = verb;
    this.endNum.textContent = next.number;
    this.endName.textContent = next.title;
  }

  /**
   * The end of a world: "Keep flying", the arrow, the next layer. `k` (0..1) is how much of the hold that begins the
   * next world has been given; it fills the rule under the words.
   */
  setEnd(on, k = 0) {
    on = !!on;
    if (on !== this._end) {
      this._end = on;
      if (on) this._renderEnd();
      this.endEl.classList.toggle('is-in', on);
    }
    k = on ? Math.round(Math.max(0, Math.min(1, +k || 0)) * 100) / 100 : 0;
    if (k !== this._endK) {
      this._endK = k;
      this.endEl.style.setProperty('--hl-k', String(k));
    }
  }

  /**
   * The wing. `cells`: 19 characters, '1' = lit. `worldIndex`: the layer whose three cells are in play (-1: none).
   */
  setWing(cells, worldIndex = this._here) {
    if (cells !== this._cells) {
      const was = this._cells;
      this._cells = cells;
      for (let i = 0; i < this.cellEls.length; i++) {
        const on = cells[i] === '1';
        if (!was || (was[i] === '1') !== on) this.cellEls[i].classList.toggle('is-lit', on);
      }
    }
    if (worldIndex !== this._here) {
      this._here = worldIndex;
      for (let i = 0; i < this.cellEls.length; i++) this.cellEls[i].classList.toggle('is-here', worldIndex >= 0 && i >= worldIndex * 3 && i < worldIndex * 3 + 3);
    }
  }

  /** A cell has just been found: it fills, and the whole wing swells once (it only fades in under reduced motion). */
  lightCell(i) {
    const el = this.cellEls[i];
    if (!el) return;
    if (this._cells) this._cells = this._cells.slice(0, i) + '1' + this._cells.slice(i + 1);
    el.classList.add('is-lit');
    // the wing does not recede with the rest of the chrome for a moment
    this._foundLeft = 2;
    this.root.classList.add('is-found');
    if (this.calm || this.still) return;
    for (const c of this.cellEls) c.classList.remove('is-new');
    this.wing.classList.remove('is-pulse');
    void this.wing.getBoundingClientRect(); // restart the animation if one is still running
    el.classList.add('is-new');
    this.wing.classList.add('is-pulse');
  }

  setLoading(on) {
    on = !!on;
    if (on) {
      // before the first layer exists the screen is empty, so the line sits in the middle of it;
      // after that it takes the hint's place and leaves the picture alone
      const boot = this.root.dataset.state === 'boot';
      this.loading.classList.toggle('is-center', boot);
      this.loadingText.textContent = boot ? 'Rendering layer' : 'Rendering next layer';
    }
    this.loading.classList.toggle('is-in', on);
    this.root.classList.toggle('is-loading', on);
    // leave the words in place while the line fades, then take them out of the reading order
    clearTimeout(this._loadT);
    if (!on) this._loadT = setTimeout(() => (this.loadingText.textContent = ''), this.still ? 0 : 700);
  }

  setSound(on) {
    this.sound = !!on;
    this.soundBtn.querySelector('i').textContent = on ? 'on' : 'off';
    this.soundBtn.setAttribute('aria-pressed', String(!!on));
  }

  setAuto(on) {
    this.auto = !!on;
    this.autoBtn.querySelector('i').textContent = on ? 'on' : 'off';
    this.autoBtn.setAttribute('aria-pressed', String(!!on));
    this._renderEnd();
  }

  /** Dim the chrome while the visitor is just watching. */
  setIdle(on) {
    on = !!on;
    if (on === this._idle) return;
    this._idle = on;
    this.root.classList.toggle('is-idle', on);
    if (on && this._keysOpen && document.activeElement !== this.keysBtn) this._setKeys(false);
  }

  toggleHidden() {
    this.hidden = this.root.classList.toggle('is-hidden');
    clearTimeout(this._noteT);
    // the note sits where the layer label was, so it borrows that zone's ink
    if (this.world.dataset.ink) this.note.dataset.ink = this.world.dataset.ink;
    this.note.toggleAttribute('data-mid', this.world.hasAttribute('data-mid'));
    this.note.classList.toggle('is-in', this.hidden && !this.still);
    if (this.hidden) this._noteT = setTimeout(() => this.note.classList.remove('is-in'), 2800);
  }

  debug(text) {
    this.debugEl.textContent = text;
    this.debugEl.classList.add('is-in');
  }

  error(text) {
    this.errorEl.textContent = text || '';
    this.errorEl.classList.toggle('is-center', this.root.dataset.state !== 'live');
    this.errorEl.classList.toggle('is-in', !!text);
  }
}

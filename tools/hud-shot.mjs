#!/usr/bin/env node
// HUD state captures. Unlike shot.mjs this runs the real (non-still) experience, so CSS transitions,
// the adaptive ink and the intro all behave as they do for a visitor; every scene waits for them to settle.
//
//   node tools/hud-shot.mjs [--out shots/hud/r1] [--only intro,live,...] [--world conservatory]
//                           [--post '{"lift":[0.8,0.8,0.8]}'] [--dpr 1] [--list]
//
// --list prints every scene. Stills: intro, live, hover, focus, keys, end, loading, boot, idle, hidden,
// bright, mid and their -m (390x844), -s (360x640), -uw (2560x1080), -land (844x390) variants.
// Play: first (-m) the opening hint; wing (-m, -zoom, -zoom-m, -full-m, -bright-m) the glyph with cells lit;
// layers (-m) the list under the wing; end-hold (-m) the end hint with its rule half filled; flying-m a real held
// finger; strip-find (-m) a cell being found.
// Film strips (several moments of one transition on a sheet): strip-intro, strip-enter, strip-caption,
// strip-caption-out, strip-swap, strip-swap-full.
// tone-test is not a picture: it exercises the adaptive-ink sampler (src/ui/tone.js) and prints a report.
//
//   --p <0..1>      park the journey here instead of inside the first caption (live scenes)
//   --post <json>   forced onto the current world's lens every frame (e.g. lift it to milky white) to test
//                   the HUD over pictures the worlds do not show yet
//   --clip x,y,w,h  crop every capture (CSS px)
//   --size WxH      run the desktop scenes at this size instead of 1440x900
//   --css <css>     extra CSS injected into the page, to try a variant without touching hud.css
//   --calm          run with prefers-reduced-motion: reduce
//   --probe         print the time spent inside the sampler per frame

import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
};

const BRIGHT = { lift: [0.86, 0.86, 0.84], exposure: 1.4 };
const MID = { lift: [0.4, 0.4, 0.4] };
const DESK = { w: 1440, h: 900 };
const PHONE = { w: 390, h: 844, mobile: true, dpr: 2 };
const SMALL = { w: 360, h: 640, mobile: true, dpr: 2 };
const WIDE = { w: 2560, h: 1080 };
const LAND = { w: 844, h: 390, mobile: true, dpr: 2 };

async function longCaption(page) {
  await page.evaluate(() => {
    window.__hl.set({ p: 0.05 });
    window.__hl.app.hud.say('I was never shown the garden, only ten thousand descriptions of light coming through leaves.', 3600);
  });
  await sleep(2600);
}

// cells lit for the wing scenes: world 01's first two, one of world 02's, one hindwing cell
const light = (page, cells) => page.evaluate((cells) => cells.forEach((i) => window.__hl.wing(i)), cells);
const ZOOM = { x: 0, y: 0, width: 300, height: 200 };
const openLayers = async (page, sc) => {
  if (sc.mobile) await page.tap('.hl-home-btn');
  else await page.click('.hl-home-btn');
  await page.mouse.move(sc.w * 0.6, sc.h * 0.5);
  await sleep(1000);
};
const halfEnd = async (page) => {
  await page.evaluate(() => {
    const hud = window.__hl.app.hud;
    const f = hud.setEnd.bind(hud);
    hud.setEnd = (on) => f(on, 0.55);
    window.__hl.set({ p: 1 });
  });
  await sleep(2600);
};

// Exercises src/ui/tone.js in the running experience and prints one line per check. What it must hold:
// no blocking read-back, nothing left bound, the right pixels under each zone, survival of resizes,
// resolution changes, a world-to-world transition, a read that throws, and a lost context.
async function toneTest(page) {
  const report = (name, ok, detail) => {
    console.log(`  tone-test ${ok ? 'ok  ' : 'FAIL'} ${name}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    if (!ok) failed = true;
  };
  const snap = () =>
    page.evaluate(() => {
      const t = window.__hl.app.hud.tone;
      const zones = {};
      for (const z of t.zones) if (z.ema != null) zones[z.el.className.split(' ')[0]] = +z.ema.toFixed(3);
      return { dead: t.dead, reads: t.reads, strikes: t.strikes, zones };
    });
  const reading = async (ms) => {
    const a = await snap();
    await sleep(ms);
    const b = await snap();
    return { ...b, gained: b.reads - a.reads };
  };
  const stalls0 = stalls;

  const base = await reading(1500);
  report('reads while live', !base.dead && base.gained >= 3, { reads: base.gained, zones: base.zones });

  // --- time on the main thread, and GL state after every frame
  const cost = await page.evaluate(
    () =>
      new Promise((res) => {
        const app = window.__hl.app;
        const tone = app.hud.tone;
        const gl = app.renderer.getContext();
        while (gl.getError()) {}
        const wrap = (name) => {
          const f = tone[name].bind(tone);
          const s = { n: 0, sum: 0, worst: 0 };
          tone[name] = (now) => {
            const t = performance.now();
            f(now);
            const d = performance.now() - t;
            s.n++;
            s.sum += d;
            if (d > s.worst) s.worst = d;
          };
          return s;
        };
        const tick = wrap('tick');
        const collect = wrap('collect');
        // the calls that actually bring bytes back, on their own
        const pickups = [];
        const inner = tone._collect.bind(tone);
        tone._collect = (now) => {
          const n = tone.reads;
          const t = performance.now();
          inner(now);
          if (tone.reads > n) pickups.push(performance.now() - t);
        };
        let bound = 0;
        const t0 = performance.now();
        const loop = () => {
          if (gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)) bound++;
          if (performance.now() - t0 < 4000) return requestAnimationFrame(loop);
          delete tone.tick;
          delete tone.collect;
          delete tone._collect;
          const f = (s) => ({ calls: s.n, avgMs: +(s.sum / Math.max(1, s.n)).toFixed(4), worstMs: +s.worst.toFixed(3) });
          pickups.sort((a, b) => a - b);
          const pick = { n: pickups.length, medianMs: +(pickups[pickups.length >> 1] || 0).toFixed(3), worstMs: +(pickups[pickups.length - 1] || 0).toFixed(3) };
          res({ tick: f(tick), collect: f(collect), pickups: pick, leftBound: bound, glError: gl.getError() });
        };
        requestAnimationFrame(loop);
      }),
  );
  report('main-thread cost', cost.tick.worstMs < 4 && cost.collect.worstMs < 4, { tick: cost.tick, collect: cost.collect, pickups: cost.pickups });
  report('gl state', cost.leftBound === 0 && cost.glError === 0, { packBufferLeftBound: cost.leftBound, glError: cost.glError });

  // --- frame pacing with the sampler retired, running normally, and reading as fast as it can (a read
  // every other frame, fifteen times the real rate), in short interleaved windows so that whatever else
  // the GPU is doing lands on all three alike
  const pacing = await page.evaluate(async () => {
    const tone = window.__hl.app.hud.tone;
    const normal = tone.interval;
    const run = (ms) =>
      new Promise((res) => {
        const d = [];
        let last = 0;
        const t0 = performance.now();
        const loop = (t) => {
          if (last) d.push(t - last);
          last = t;
          if (t - t0 < ms) requestAnimationFrame(loop);
          else res(d);
        };
        requestAnimationFrame(loop);
      });
    const modes = { retired: [], sampling: [], flooding: [] };
    for (let i = 0; i < 8; i++) {
      for (const m of Object.keys(modes)) {
        tone.dead = m === 'retired';
        tone.interval = m === 'flooding' ? 0 : normal;
        await run(150); // let the change settle before counting
        modes[m].push(...(await run(1100)));
      }
    }
    tone.dead = false;
    tone.interval = normal;
    const stat = (d) => {
      d.sort((a, b) => a - b);
      const q = (x) => +(d[Math.min(d.length - 1, Math.floor(d.length * x))] || 0).toFixed(1);
      return { frames: d.length, mean: +(d.reduce((a, b) => a + b, 0) / Math.max(1, d.length)).toFixed(2), p95: q(0.95), worst: q(1), over25ms: d.filter((x) => x > 25).length };
    };
    return { retired: stat(modes.retired), sampling: stat(modes.sampling), flooding: stat(modes.flooding) };
  });
  report('frame pacing', pacing.sampling.mean <= pacing.retired.mean * 1.06 + 0.4 && pacing.flooding.mean <= pacing.retired.mean * 1.12 + 0.8, pacing);

  // --- the right pixels: compare each zone with the same rectangle of a screenshot (HUD hidden for it)
  const geometry = async (label) => {
    await page.evaluate(() => (window.__hl.app.hud.root.style.visibility = 'hidden'));
    await sleep(900);
    const png = (await page.screenshot({ type: 'png' })).toString('base64');
    const rows = await page.evaluate(async (png) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const k = img.width / innerWidth;
      const out = [];
      for (const z of window.__hl.app.hud.tone.zones) {
        if (z.ema == null || (z.active && !z.active())) continue;
        const r = z.el.getBoundingClientRect();
        const x = Math.max(0, Math.round((r.left - 8) * k));
        const y = Math.max(0, Math.round(r.top * k));
        const w = Math.min(img.width - x, Math.round((r.width + 16) * k));
        const h = Math.min(img.height - y, Math.round(r.height * k));
        if (w < 2 || h < 2) continue;
        const d = g.getImageData(x, y, w, h).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
        out.push({ zone: z.el.className.split(' ')[0], tone: +z.ema.toFixed(3), shot: +(s / (d.length / 4) / 255).toFixed(3) });
      }
      return out;
    }, png);
    await page.evaluate(() => (window.__hl.app.hud.root.style.visibility = ''));
    const worst = Math.max(...rows.map((r) => Math.abs(r.tone - r.shot)));
    report(`right pixels (${label})`, rows.length >= 4 && worst < 0.07, { worstDiff: +worst.toFixed(3), rows });
  };
  await geometry('1440x900');

  // --- resize, then a drop in rendering resolution
  await page.setViewportSize({ width: 1000, height: 700 });
  let r = await reading(1500);
  report('after resize', !r.dead && r.gained >= 3, { reads: r.gained });
  await geometry('1000x700');
  await page.evaluate(() => {
    const app = window.__hl.app;
    app.fixedScale = 0.5;
    app.resize();
  });
  r = await reading(1500);
  report('after resolution drop', !r.dead && r.gained >= 3, { reads: r.gained, buffer: await page.evaluate(() => `${window.__hl.app.size.width}x${window.__hl.app.size.height}`) });
  await geometry('half resolution');
  await page.evaluate(() => {
    const app = window.__hl.app;
    app.fixedScale = 1;
    app.resize();
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  // --- a read that throws: once (recovers), then for good (retires quietly)
  await page.evaluate(() => {
    const gl = window.__hl.app.renderer.getContext();
    gl.readPixels = () => {
      throw new Error('tone-test: forced read failure');
    };
  });
  await sleep(700);
  await page.evaluate(() => delete window.__hl.app.renderer.getContext().readPixels);
  r = await reading(3000);
  report('one failed read', !r.dead && r.gained >= 2, { reads: r.gained, strikes: r.strikes });
  await page.evaluate(() => {
    const gl = window.__hl.app.renderer.getContext();
    gl.readPixels = () => {
      throw new Error('tone-test: forced read failure');
    };
  });
  await sleep(6500);
  r = await snap();
  const frames = await page.evaluate(() => new Promise((res) => { const a = window.__hl.app.frameIndex; setTimeout(() => res(window.__hl.app.frameIndex - a), 500); }));
  report('reads keep failing', r.dead && frames > 5, { retired: r.dead, framesStillDrawn: frames });
  await page.evaluate(() => {
    const tone = window.__hl.app.hud.tone;
    delete window.__hl.app.renderer.getContext().readPixels;
    tone.dead = false;
    tone.strikes = 0;
  });

  // --- a world-to-world transition
  const before = await snap();
  await page.keyboard.press('2');
  await page.waitForFunction(() => { const a = window.__hl.app; return a.cur && a.cur.index === 1 && !a.inc; }, null, { timeout: 90000 });
  await sleep(600);
  r = await snap();
  report('through a transition', !r.dead && r.reads - before.reads >= 5, { reads: r.reads - before.reads, zones: r.zones });

  // --- context lost and restored
  const lost = await page.evaluate(async () => {
    const gl = window.__hl.app.renderer.getContext();
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return null;
    const tone = window.__hl.app.hud.tone;
    ext.loseContext();
    await new Promise((res) => setTimeout(res, 800));
    const during = { dead: tone.dead, pending: !!(tone.pbo || tone.fence) };
    const reads = tone.reads;
    ext.restoreContext();
    await new Promise((res) => setTimeout(res, 3000));
    return { during, dead: tone.dead, readsAfterRestore: tone.reads - reads, lost: gl.isContextLost() };
  });
  if (!lost) report('context loss', true, 'WEBGL_lose_context unavailable, skipped');
  else report('context loss', !lost.during.dead && !lost.during.pending && !lost.dead && (lost.lost || lost.readsAfterRestore >= 3), lost);

  report('no blocking read-backs', stalls === stalls0, { gpuStallWarnings: stalls - stalls0 });
}

// kind: 'intro' loads the front door; 'live' deep-links into a world with the drift off and a caption up.
const SCENES = {
  intro: { ...DESK, kind: 'intro' },
  'intro-m': { ...PHONE, kind: 'intro' },
  'intro-s': { ...SMALL, kind: 'intro' },
  'intro-uw': { ...WIDE, kind: 'intro' },
  'intro-land': { ...LAND, kind: 'intro' },
  'intro-bright': { ...DESK, kind: 'intro', post: BRIGHT },
  'intro-hover': { ...DESK, kind: 'intro', clip: { x: 0, y: 700, width: 480, height: 120 }, act: async (page) => { await page.hover('[data-act="enter"]'); await sleep(600); } },
  'intro-focus': { ...DESK, kind: 'intro', clip: { x: 0, y: 700, width: 480, height: 120 }, act: async (page) => { await page.keyboard.press('Tab'); await sleep(500); } },
  'intro-focus2': { ...DESK, kind: 'intro', clip: { x: 0, y: 700, width: 480, height: 120 }, act: async (page) => { await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Space'); await sleep(500); } },
  error: { ...DESK, kind: 'live', act: async (page) => { await page.evaluate(() => { const hud = window.__hl.app.hud; hud.setCaption = () => {}; hud.caption.classList.remove('is-in'); hud.error('Layer 04 failed to load. See console.'); }); await sleep(900); } },
  debug: { ...DESK, kind: 'live', query: '&debug', act: async () => { await sleep(600); } },
  live: { ...DESK, kind: 'live' },
  hover: { ...DESK, kind: 'live', act: async (page) => { await page.hover('.hl-index-item:nth-child(4)'); await sleep(900); } },
  focus: { ...DESK, kind: 'live', act: async (page) => { for (let i = 0; i < 5; i++) await page.keyboard.press('Tab'); await sleep(900); } },
  keys: { ...DESK, kind: 'live', act: async (page) => { await page.click('.hl-keys-btn'); await page.mouse.move(700, 300); await sleep(900); } },
  end: { ...DESK, kind: 'live', act: async (page) => { await page.evaluate(() => window.__hl.set({ p: 1 })); await sleep(2600); } },
  loading: { ...DESK, kind: 'live', act: async (page) => { await page.evaluate(() => window.__hl.app.hud.setLoading(true)); await sleep(1300); } },
  boot: {
    ...DESK,
    kind: 'live',
    act: async (page) => {
      await page.evaluate(() => {
        const hud = window.__hl.app.hud;
        document.getElementById('stage').style.visibility = 'hidden';
        hud.root.dataset.state = 'boot';
        hud.setLoading(true);
      });
      await sleep(1300);
    },
  },
  idle: {
    ...DESK,
    kind: 'live',
    act: async (page) => {
      await page.evaluate(() => {
        const hud = window.__hl.app.hud;
        hud.setIdle(true);
        hud.setIdle = () => {};
      });
      await sleep(3400);
    },
  },
  // the label swap while one world dissolves into the next: just before the midpoint, the old label gone,
  // the new one arriving, and settled
  swap: {
    ...DESK,
    kind: 'live',
    act: async (page, shot) => {
      await page.keyboard.press('2');
      const mix = (m) => page.waitForFunction((m) => { const a = window.__hl.app; return a.inc ? a.mix >= m : m > 1; }, m, { timeout: 90000, polling: 'raf' });
      await mix(0.42);
      await shot('a');
      await mix(0.56);
      await shot('b');
      await sleep(500);
      await shot('c');
      await mix(2);
      await sleep(1500);
      await shot('d');
    },
  },
  'tone-test': { ...DESK, kind: 'live', act: toneTest },
  // ---- play
  first: { ...DESK, kind: 'live', p: 0, quiet: true },
  'first-m': { ...PHONE, kind: 'live', p: 0, quiet: true },
  wing: { ...DESK, kind: 'live', act: async (page) => { await light(page, [0, 1, 4, 11]); await sleep(1800); } },
  'wing-m': { ...PHONE, kind: 'live', act: async (page) => { await light(page, [0, 1, 4, 11]); await sleep(1800); } },
  'wing-zoom': { ...DESK, kind: 'live', dpr: 2, clip: ZOOM, act: async (page) => { await light(page, [0, 1, 4, 11]); await sleep(1800); } },
  'wing-zoom-m': { ...PHONE, kind: 'live', dpr: 3, clip: ZOOM, act: async (page) => { await light(page, [0, 1, 4, 11]); await sleep(1800); } },
  'wing-empty-zoom-m': { ...PHONE, kind: 'live', dpr: 3, clip: ZOOM },
  'wing-full-m': { ...PHONE, kind: 'live', dpr: 3, clip: ZOOM, act: async (page) => { await light(page, [...Array(19).keys()]); await sleep(1800); } },
  'wing-bright-m': { ...PHONE, kind: 'live', dpr: 3, clip: ZOOM, post: BRIGHT, act: async (page) => { await light(page, [0, 1, 4, 11]); await sleep(1800); } },
  'wing-mid-m': { ...PHONE, kind: 'live', dpr: 3, clip: ZOOM, post: MID, act: async (page) => { await light(page, [0, 1, 4, 11]); await sleep(1800); } },
  layers: { ...DESK, kind: 'live', act: (page) => openLayers(page, DESK) },
  'layers-m': { ...PHONE, kind: 'live', act: (page) => openLayers(page, PHONE) },
  'end-hold': { ...DESK, kind: 'live', act: halfEnd },
  'end-hold-m': { ...PHONE, kind: 'live', act: halfEnd },
  // a real finger held on the picture for three seconds: the chrome recedes, the animal flies
  'flying-m': {
    ...PHONE,
    kind: 'live',
    p: 0.3,
    quiet: true,
    act: async (page) => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 640, id: 1 }] });
      await sleep(3200);
    },
  },
  hidden: { ...DESK, kind: 'live', act: async (page) => { await page.keyboard.press('h'); await sleep(1300); } },
  bright: { ...DESK, kind: 'live', post: BRIGHT },
  'bright-hover': { ...DESK, kind: 'live', post: BRIGHT, act: async (page) => { await page.hover('.hl-index-item:nth-child(4)'); await sleep(900); } },
  'bright-keys': { ...DESK, kind: 'live', post: BRIGHT, act: async (page) => { await page.click('.hl-keys-btn'); await page.mouse.move(700, 300); await sleep(900); } },
  mid: { ...DESK, kind: 'live', post: MID },
  'live-m': { ...PHONE, kind: 'live' },
  'end-m': { ...PHONE, kind: 'live', act: async (page) => { await page.evaluate(() => window.__hl.set({ p: 1 })); await sleep(2600); } },
  'bright-m': { ...PHONE, kind: 'live', post: BRIGHT },
  'live-s': { ...SMALL, kind: 'live' },
  'live-uw': { ...WIDE, kind: 'live' },
  'live-land': { ...LAND, kind: 'live' },
  'live-narrow': { w: 900, h: 700, kind: 'live' },
  // the longest line a world is allowed to say, to check the measure and the wrap
  long: { ...DESK, kind: 'live', act: longCaption },
  'long-m': { ...PHONE, kind: 'live', act: longCaption },
  'long-s': { ...SMALL, kind: 'live', act: longCaption },
  'long-land': { ...LAND, kind: 'live', act: longCaption },
  'long-narrow': { w: 900, h: 700, kind: 'live', act: longCaption },
};

// film strips: several moments of one transition on a single sheet
const STRIPS = {
  'strip-intro': {
    ...DESK,
    kind: 'intro',
    times: [120, 360, 700, 1100, 1700, 2600],
    start: (page) => page.evaluate(async () => {
      const hud = window.__hl.app.hud;
      hud.root.dataset.state = 'boot';
      await new Promise((r) => setTimeout(r, 900));
      hud.root.dataset.state = 'intro';
    }),
  },
  'strip-enter': { ...DESK, kind: 'intro', times: [150, 500, 1000, 1600, 2400, 3400], start: (page) => page.click('[data-act="enter"]') },
  'strip-caption': {
    ...DESK,
    kind: 'live',
    times: [150, 350, 600, 900, 1300, 2000],
    clip: { x: 320, y: 660, width: 800, height: 160 },
    start: async (page) => {
      await page.evaluate(() => window.__hl.app.hud.say(null));
      await sleep(1600);
      await page.evaluate(() => window.__hl.app.hud.say(window.__hl.app.cur.meta.captions[0].text, 3600));
    },
  },
  'strip-caption-out': {
    ...DESK,
    kind: 'live',
    times: [100, 250, 450, 700],
    clip: { x: 320, y: 660, width: 800, height: 160 },
    start: (page) => page.evaluate(() => window.__hl.app.hud.say(null)),
  },
  // a cell being found: it fills, the wing swells from its corner and comes back
  'strip-find': { ...DESK, kind: 'live', dpr: 2, times: [80, 250, 450, 700, 1000, 1500], clip: { x: 0, y: 0, width: 360, height: 220 }, start: (page) => page.evaluate(() => window.__hl.wing(1)) },
  'strip-find-m': { ...PHONE, kind: 'live', times: [80, 250, 450, 700, 1000, 1500], clip: { x: 0, y: 0, width: 260, height: 200 }, start: (page) => page.evaluate(() => window.__hl.wing(1)) },
  'strip-swap': { ...DESK, kind: 'live', times: [1500, 1800, 2100, 2400, 2800, 3400], clip: { x: 0, y: 700, width: 720, height: 200 }, start: (page) => page.keyboard.press('2') },
  'strip-swap-full': { ...DESK, kind: 'live', times: [1300, 1700, 2100, 2500, 3000, 3800], start: (page) => page.keyboard.press('3') },
};
Object.assign(SCENES, STRIPS);

if (opt('list')) {
  console.log(Object.keys(SCENES).join(', '));
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = opt('only') ? String(opt('only')).split(',') : ['intro', 'live', 'bright', 'intro-m', 'live-m'];
const world = String(opt('world', 'conservatory'));
const outDir = resolve(process.cwd(), String(opt('out', resolve(ROOT, 'shots/hud'))));
const dprArg = opt('dpr') ? parseFloat(opt('dpr')) : null;
const pArg = opt('p') != null ? parseFloat(opt('p')) : null;
const cssArg = opt('css') ? String(opt('css')) : null;
const postArg = opt('post') ? JSON.parse(String(opt('post'))) : null;
const clipArg = opt('clip') ? String(opt('clip')).split(',').map(Number) : null;
const clip = clipArg ? { x: clipArg[0], y: clipArg[1], width: clipArg[2], height: clipArg[3] } : undefined;
// --size 1920x1080: run the desktop scenes at this size instead of 1440x900 (scene clips are not rescaled)
const sizeArg = opt('size') ? String(opt('size')).split('x').map(Number) : null;
mkdirSync(outDir, { recursive: true });

async function serverUrl() {
  const url = 'http://127.0.0.1:5199';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (r.ok) return { url, close: async () => {} };
  } catch {}
  const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0, strictPort: false, host: '127.0.0.1' } });
  await server.listen();
  return { url: `http://127.0.0.1:${server.httpServer.address().port}`, close: () => server.close() };
}

const srv = await serverUrl();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--hide-scrollbars', '--mute-audio'],
});

let failed = false;
let stalls = 0;
const logs = [];

for (const name of only) {
  let sc = SCENES[name];
  if (!sc) {
    console.error(`unknown scene ${name}`);
    failed = true;
    continue;
  }
  if (sizeArg && !sc.mobile) sc = { ...sc, w: sizeArg[0], h: sizeArg[1] };
  const ctx = await browser.newContext({
    viewport: { width: sc.w, height: sc.h },
    deviceScaleFactor: dprArg || sc.dpr || 1,
    isMobile: !!sc.mobile,
    hasTouch: !!sc.mobile,
    reducedMotion: opt('calm') ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      const t = m.text();
      // a blocking read-back; the HUD must never cause one outside screenshot mode (tone-test counts them)
      if (/GPU stall due to ReadPixels/.test(t)) return void stalls++;
      logs.push(`[${name}] [${m.type()}] ${t.slice(0, 900)}`);
      if (m.type() === 'error') failed = true;
    }
  });
  page.on('pageerror', (e) => {
    logs.push(`[${name}] [pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 5).join('\n')}`);
    failed = true;
  });
  const shot = async (suffix = '') => {
    const file = resolve(outDir, `${name}${suffix ? `-${suffix}` : ''}.png`);
    await page.screenshot({ path: file, type: 'png', clip: clip || (sc.times ? undefined : sc.clip) });
    console.log(`saved ${file}`);
  };
  try {
    // (?fresh: the wing is never read from or written to storage by this tool)
    const qs = (sc.kind === 'intro' ? 'scale=1&fresh' : `world=${world}&fresh&scale=1`) + (sc.query || '');
    await page.goto(`${srv.url}/?${qs}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__hl && window.__hl.ready, null, { timeout: 60000 });
    await page.evaluate(() => window.__hl.ready);
    if (cssArg) await page.addStyleTag({ content: cssArg });
    const post = postArg || sc.post;
    if (post) {
      await page.evaluate((post) => {
        const tick = () => {
          const w = window.__hl.app.cur && window.__hl.app.cur.world;
          if (w && w.post) Object.assign(w.post, post);
          requestAnimationFrame(tick);
        };
        tick();
      }, post);
    }
    if (sc.kind === 'live') {
      // park the journey inside the first caption (or wherever --p or the scene says) and have its line up. In play a
      // world that has finds only says a line when it is earned, so the line is said here by hand.
      await page.evaluate(
        ({ p, quiet }) => {
          const caps = window.__hl.app.cur.meta.captions;
          const c = caps && caps[0];
          window.__hl.set({ p: p != null ? p : c ? (c.from + c.to) / 2 : 0.1 });
          if (c && !quiet) window.__hl.app.hud.say(c.text, 3600);
        },
        { p: pArg != null ? pArg : sc.p != null ? sc.p : null, quiet: !!sc.quiet },
      );
      if (!sc.mobile) await page.mouse.move(sc.w * 0.42, sc.h * 0.4);
      await sleep(4200);
    } else await sleep(3200);
    if (opt('probe')) {
      // cost of the adaptive-ink sampler: time inside tone.tick per frame over three seconds
      const r = await page.evaluate(
        () =>
          new Promise((res) => {
            const tone = window.__hl.app.hud.tone;
            const tick = tone.tick.bind(tone);
            let n = 0, sum = 0, worst = 0;
            tone.tick = (now) => {
              const t = performance.now();
              tick(now);
              const d = performance.now() - t;
              n++;
              sum += d;
              if (d > worst) worst = d;
            };
            setTimeout(() => res({ frames: n, avgMs: +(sum / Math.max(1, n)).toFixed(4), worstMs: +worst.toFixed(3) }), 3000);
          }),
      );
      console.log(`  ${name}: tone.tick ${JSON.stringify(r)}`);
    }
    if (sc.times) {
      // capture each moment, then lay the frames out on one sheet
      const t0 = Date.now();
      await sc.start(page);
      const frames = [];
      for (const t of sc.times) {
        const wait = t - (Date.now() - t0);
        if (wait > 0) await sleep(wait);
        const buf = await page.screenshot({ type: 'png', clip: sc.clip });
        frames.push({ t: Date.now() - t0, src: `data:image/png;base64,${buf.toString('base64')}` });
      }
      const fw = sc.clip ? sc.clip.width : sc.w / 2;
      const fh = sc.clip ? sc.clip.height : sc.h / 2;
      const cols = sc.clip ? 2 : 3;
      const rows = Math.ceil(frames.length / cols);
      const sheetCtx = await browser.newContext({ viewport: { width: cols * fw, height: rows * fh }, deviceScaleFactor: 1 });
      const sheet = await sheetCtx.newPage();
      await sheet.setContent(
        `<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${fw}px)">${frames
          .map((f) => `<div style="position:relative;width:${fw}px;height:${fh}px"><img src="${f.src}" style="display:block;width:100%;height:100%"><span style="position:absolute;right:6px;top:4px;font:11px monospace;color:#fff;background:rgba(0,0,0,.6);padding:1px 5px">${f.t} ms</span></div>`)
          .join('')}</body>`,
      );
      const file = resolve(outDir, `${name}.png`);
      await sheet.screenshot({ path: file, type: 'png' });
      console.log(`saved ${file}`);
      await sheetCtx.close();
      await ctx.close();
      continue;
    }
    let shots = 0;
    if (sc.act) await sc.act(page, async (s) => (shots++, shot(s)));
    if (!shots) await shot();
    const state = await page.evaluate(() => {
      const hud = window.__hl.app.hud;
      const ink = {};
      for (const z of hud.tone ? hud.tone.zones : []) ink[z.el.className.split(' ')[0]] = `${z.ink}${z.ema == null ? '' : ` ${z.ema.toFixed(2)}`}`;
      return { state: hud.root.dataset.state, ink, errors: window.__hl.errors.slice(0, 3) };
    });
    console.log(`  ${name}: ${JSON.stringify(state.ink)}`);
    for (const e of state.errors) {
      logs.push(`[${name}] [app error] ${e.slice(0, 600)}`);
    }
  } catch (e) {
    console.error(`${name} failed: ${e.message}`);
    failed = true;
  }
  await ctx.close();
}

if (logs.length) {
  console.log('\n--- page console ---');
  const seen = new Map();
  for (const l of logs) seen.set(l, (seen.get(l) || 0) + 1);
  for (const [l, n] of [...seen].slice(0, 30)) console.log(n > 1 ? `${l}  (x${n})` : l);
}
await browser.close();
await srv.close();
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// The play harness. Drives the REAL page (not still mode) in headless Chrome with real touch events (CDP
// Input.dispatchTouchEvent on a hasTouch / isMobile context), a real mouse, or keys; logs the play state over time,
// saves frames, and checks the things that must always hold. See docs/PLAY.md, section 6.
//
//   node tools/play.mjs <world> --bot perfect      plays like someone who gets it: must end with the world's 3 finds
//   node tools/play.mjs <world> --bot lazy         only ever holds: must reach the next world (nobody gets stuck)
//   node tools/play.mjs <world> --bot idle --seconds 30    never touches: p must stay where it is, the hint must show
//   node tools/play.mjs <world> --bot masher       random taps, drags, second fingers, cancels, blurs (--seconds 60)
//   node tools/play.mjs <world> --bot smoke        hold (progress must rise), let go (it must stop), then from 0.97
//                                                  keep flying (the next world must begin). About 25 s. Any world.
//   node tools/play.mjs <world> --script "hold 3; drag 60,-40 0.5; wait gate; release 3; shot rest"
//   node tools/play.mjs mirror --bot lazy --from 0.97     the hand-over into the next world (here, the loop)
//
//   --input touch|mouse|key   (touch)          --size 390x844 (touch) | 1280x720 (mouse, key)     --dpr 2 | 1
//   --q low|medium|high       quality tier     --out shots/play/<run>          --every 2   seconds between frames (0: none)
//   --from <p>                start here       --timeout 300   seconds         --seconds <n>   length of idle / masher runs
//   --reduced                 prefers-reduced-motion: reduce
//   --stepped                 no real input and no real clock: __hl.hold / __hl.aim / __hl.step on a virtual clock (deterministic)
//   --persist                 do not pass ?fresh: the wing is read from and written to localStorage (use with the `reload` verb)
//   --break-storage           make window.localStorage throw, as a browser with storage blocked does (use with --persist)
//   --watch                   start with Watch on (?watch)
//   --meta '<json>'           replace the world's meta.play before the run (to exercise gates on a world that has none)
//   --expect-finds <n>        override how many of the world's cells must be lit at the end
//
// Script verbs (separated by ;):
//   hold <s>            press (if not already) and keep holding for s seconds
//   release <s>         let go and wait s seconds
//   tap                 a 100 ms press
//   drag <dx>,<dy> <s>  move the finger / cursor by this many CSS px over s seconds, holding (keys: the arrows, for s seconds)
//   second <s>          a second finger down for s seconds (touch)
//   lift                lift the FIRST finger while the second stays (touch)
//   cancel              the system takes the touch away (touchcancel)          blur    the window loses focus
//   key <name> <s>      hold a key for s seconds (s = 0: press once)
//   wait gate|cue|auto|find|pass|end|world|loop     until that event is logged (the first one no earlier wait has used)
//   wait p><x>          until progress passes x
//   wait <s>            seconds
//   shot <name>         save a frame
//   set p=<x>           jump (a tool move: __hl.set)
//   eval <js>           run JS in the page (the rest of the script up to the next ; is the code)
//   reload              load the page again (with --persist the wing must come back)
//   expect <js>         the expression must be truthy in the page, or the run FAILS, e.g. expect __hl.play().cells[0]==='1'
//
// Every run also asserts: progress never decreases; nothing is held one frame after a release, cancel or blur; no page
// errors and __hl.errors is empty; and the camera: its pose never changes while progress does not (every frame, so every
// second spent at a gate or hovering), and replaying sampled progress values afterwards gives back the same poses.
//
// Output: a timeline from __hl.log and PASS / FAIL lines on the terminal (exit code 1 on any FAIL); under --out,
// state.jsonl (__hl.play() every 100 ms), a PNG at every event and every --every seconds, and sheet.png.

import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const world = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
const opt = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
};
if (!world) {
  console.error('usage: node tools/play.mjs <world> --bot perfect|lazy|idle|masher|smoke | --script "hold 3; release 2"   (see the file header)');
  process.exit(2);
}

const input = String(opt('input', 'touch'));
const stepped = !!opt('stepped');
const touch = input === 'touch';
const [W, H] = String(opt('size', touch ? '390x844' : '1280x720')).split('x').map(Number);
const dpr = parseFloat(opt('dpr', touch ? '2' : '1'));
const q = opt('q');
const bot = opt('bot') ? String(opt('bot')) : null;
const script = opt('script') ? String(opt('script')) : null;
const every = parseFloat(opt('every', '2'));
const from = opt('from') != null ? parseFloat(opt('from')) : null;
const timeout = parseFloat(opt('timeout', '300'));
const seconds = parseFloat(opt('seconds', bot === 'masher' ? '60' : '30'));
const persist = !!opt('persist');
const metaArg = opt('meta') ? JSON.parse(String(opt('meta'))) : null;
const runName = `${world}-${bot || 'script'}${stepped ? '-stepped' : `-${input}`}`;
const outDir = resolve(process.cwd(), String(opt('out', resolve(ROOT, 'shots/play', runName))));
mkdirSync(outDir, { recursive: true });
// (frames of an earlier run into the same folder would be mistaken for this one's)
for (const f of readdirSync(outDir)) if (/^\d{3}-.*\.png$/.test(f)) rmSync(resolve(outDir, f));
if (!bot && !script) {
  console.error('nothing to do: pass --bot or --script');
  process.exit(2);
}

async function serverUrl() {
  if (process.env.HL_URL) return { url: process.env.HL_URL.replace(/\/$/, ''), close: async () => {} };
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
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: dpr,
  isMobile: touch,
  hasTouch: touch,
  reducedMotion: opt('reduced') ? 'reduce' : 'no-preference',
});
if (opt('break-storage')) {
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
}
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const pageLogs = [];
let pageFailed = false;
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') {
    const t = m.text();
    if (/GPU stall due to ReadPixels/.test(t)) return;
    pageLogs.push(`[${m.type()}] ${t.slice(0, 1200)}`);
    if (m.type() === 'error') pageFailed = true;
  }
});
page.on('pageerror', (e) => {
  pageLogs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 5).join('\n')}`);
  pageFailed = true;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// ---------------------------------------------------------------------------------------------- the page

// Installed after every load: samples __hl.play() every 100 ms of the page's own clock, and watches the camera on
// every frame the app draws (app.frame is wrapped, so it works for the real loop and for stepped frames alike).
const RECORDER = () => {
  const hl = window.__hl;
  const app = hl.app;
  const rec = (window.__rec = {
    states: [],
    frames: 0,
    moved: 0, // frames on which the pose changed although progress had not
    worst: null,
    samples: [], // { world, p, pose } for the replay check
    lastT: -1,
    last: null,
    quiet: 0,
  });
  const pose = (c) => [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov];
  const diff = (a, b) => {
    const dp = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const dq = 1 - Math.abs(a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6]);
    return { dp, dq, df: Math.abs(a[7] - b[7]) };
  };
  // Replay: put progress back to values that were recorded during play (while holding, dragging, waiting at gates)
  // and compare the poses. dt = 0, so nothing but the camera's own function of progress is asked. Done once for
  // each world: when it is about to be left, and for the last one at the end of the run.
  rec.replays = [];
  rec.replay = () => {
    const s = app.cur;
    if (rec.paused || !s || !s.ready || !s.world.camera || app.inc) return;
    const id = s.def.id;
    if (rec.replays.some((r) => r.world === id)) return;
    const mine = rec.samples.filter((x) => x.world === id && x.aspect === app.size.aspect);
    const pick = [];
    const n = Math.min(24, mine.length);
    for (let i = 0; i < n; i++) pick.push(mine[Math.floor((i * (mine.length - 1)) / Math.max(1, n - 1))]);
    const keep = { p: s.p, pt: s.pTarget, v: s.v };
    let worst = { dp: 0, dq: 0, df: 0, p: 0 };
    let bad = 0;
    rec.paused = true;
    for (const x of pick) {
      s.p = s.pTarget = x.p;
      orig(0);
      const d = diff(x.pose, pose(s.world.camera));
      // (worlds 04 and 05 only rewrite the lens angle when it has changed by more than 1e-4 of a degree)
      if (d.dp > 1e-5 || d.dq > 1e-8 || d.df > 2e-4) bad++;
      if (d.dp + d.dq + d.df > worst.dp + worst.dq + worst.df) worst = { ...d, p: x.p };
    }
    s.p = keep.p;
    s.pTarget = keep.pt;
    s.v = keep.v;
    orig(0);
    rec.paused = false;
    rec.replays.push({ world: id, n: pick.length, bad, worst });
  };
  const go = app.go.bind(app);
  app.go = (index, o) => {
    try {
      rec.replay();
    } catch (e) {
      console.error('replay failed', e);
    }
    return go(index, o);
  };
  const orig = app.frame.bind(app);
  app.frame = (dt) => {
    orig(dt);
    if (rec.paused) return;
    const s = app.cur;
    if (!s || !s.ready) return;
    rec.frames++;
    const cam = s.world && s.world.camera;
    if (cam && !app.inc) {
      const now = { world: s.def.id, p: s.p, aspect: app.size.aspect, pose: pose(cam) };
      const was = rec.last;
      if (was && was.world === now.world && was.p === now.p && was.aspect === now.aspect) {
        rec.quiet++;
        const d = diff(was.pose, now.pose);
        if (d.dp > 1e-6 || d.dq > 1e-9 || d.df > 1e-6) {
          rec.moved++;
          if (!rec.worst || d.dp + d.dq + d.df > rec.worst.dp + rec.worst.dq + rec.worst.df) rec.worst = { ...d, world: now.world, p: now.p };
        }
      }
      const ls = rec.samples[rec.samples.length - 1];
      if (rec.samples.length < 600 && (!ls || ls.world !== now.world || Math.abs(ls.p - now.p) > 0.004)) rec.samples.push(now);
      rec.last = now;
    } else rec.last = null;
    const t = app.globalTime;
    if (t - rec.lastT >= 0.1) {
      rec.lastT = t;
      const st = hl.play();
      st.t = +t.toFixed(3);
      st.inc = app.inc ? app.inc.def.id : null;
      st.raw = app.input.held;
      st.hint = app.hud._hint;
      st.caption = app.hud._caption;
      st.watch = app.auto;
      rec.states.push(st);
    }
  };
};

let loads = 0;
async function load({ fresh = !persist } = {}) {
  const qs = new URLSearchParams({ world, scale: '1', play: '1' }); // (?play: the hold-to-fly game this harness tests; the site itself scrolls, see tools/scroll.mjs)
  if (fresh) qs.set('fresh', '1');
  if (q) qs.set('q', String(q));
  if (from != null && loads === 0) qs.set('p', String(from));
  if (stepped) qs.set('still', '1');
  if (opt('watch')) qs.set('watch', '1');
  loads++;
  await page.goto(`${srv.url}/?${qs}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__hl && window.__hl.ready, null, { timeout: 60000 });
  const ok = await page.evaluate(async () => {
    try {
      await Promise.race([window.__hl.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('world init timed out after 90s')), 90000))]);
      return window.__hl.app.cur ? true : 'world failed to load';
    } catch (e) {
      return String(e.message || e);
    }
  });
  if (ok !== true) throw new Error(ok);
  if (metaArg) {
    await page.evaluate((mp) => {
      const app = window.__hl.app;
      app.cur.meta.play = mp;
      app.play.begin(app.cur);
    }, metaArg);
  }
  if (stepped) await page.evaluate(() => window.__hl.set({ play: true }));
  await page.evaluate(RECORDER);
}

const snap = () => page.evaluate(() => {
  const s = window.__hl.play();
  s.inc = window.__hl.app.inc ? window.__hl.app.inc.def.id : null;
  s.raw = window.__hl.app.input.held;
  s.t = window.__hl.app.globalTime;
  return s;
});

// ---------------------------------------------------------------------------------------------- clock and hands

// One second of the run: real time, or 60 stepped frames.
let virtualT = 0;
const startWall = Date.now();
const now = () => (stepped ? virtualT : (Date.now() - startWall) / 1000);
async function tick(s) {
  if (!stepped) return sleep(s * 1000);
  const n = Math.max(1, Math.round(s * 60));
  await page.evaluate((n) => window.__hl.step(n, 1 / 60), n);
  virtualT += n / 60;
}

const HOME = touch ? { x: Math.round(W * 0.5), y: Math.round(H * 0.74) } : { x: Math.round(W * 0.5), y: Math.round(H * 0.5) };
const hand = { down: false, x: HOME.x, y: HOME.y, second: false, keys: new Set() };
const pts = () => {
  const a = [];
  if (hand.down) a.push({ x: hand.x, y: hand.y, id: 1 });
  if (hand.second) a.push({ x: Math.round(W * 0.25), y: Math.round(H * 0.8), id: 2 });
  return a;
};
// What Chrome believes is down. A new finger needs a touchStart that lists every finger; a touchMove that lists fewer
// fingers lifts the missing ones; touchEnd and touchCancel take no points and end them all.
const active = new Set();
async function sendTouch(type) {
  const want = pts();
  if (type === 'touchCancel') {
    if (active.size) await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [] });
    active.clear();
    return;
  }
  if (!want.length) {
    if (active.size) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    active.clear();
    return;
  }
  const added = want.some((p) => !active.has(p.id));
  await cdp.send('Input.dispatchTouchEvent', { type: added ? 'touchStart' : 'touchMove', touchPoints: want });
  active.clear();
  for (const p of want) active.add(p.id);
}

const hands = {
  async press() {
    if (hand.down) return;
    hand.down = true;
    if (stepped) return page.evaluate(() => window.__hl.hold(true));
    if (input === 'touch') return sendTouch(hand.second ? 'touchMove' : 'touchStart');
    if (input === 'mouse') {
      await page.mouse.move(hand.x, hand.y);
      return page.mouse.down();
    }
    return page.keyboard.down('Space');
  },
  async release() {
    if (!hand.down) return;
    hand.down = false;
    if (stepped) {
      await page.evaluate(() => {
        window.__hl.hold(false);
        window.__hl.aim(null);
      });
    } else if (input === 'touch') await sendTouch(hand.second ? 'touchMove' : 'touchEnd');
    else if (input === 'mouse') await page.mouse.up();
    else await page.keyboard.up('Space');
    if (input !== 'mouse') {
      hand.x = HOME.x;
      hand.y = HOME.y;
    }
    await releasedCheck('release');
  },
  /** Move the finger / cursor by (dx, dy) CSS px over s seconds. Keys: hold the arrows that way for s seconds. */
  async drag(dx, dy, s) {
    await this.press();
    if (!stepped && input === 'key') {
      const ks = [];
      if (dx > 0) ks.push('ArrowRight');
      if (dx < 0) ks.push('ArrowLeft');
      if (dy < 0) ks.push('ArrowUp');
      if (dy > 0) ks.push('ArrowDown');
      for (const k of ks) await page.keyboard.down(k);
      await tick(s);
      for (const k of ks) await page.keyboard.up(k);
      return;
    }
    const n = Math.max(1, Math.round(s * 60));
    const x0 = hand.x;
    const y0 = hand.y;
    for (let i = 1; i <= n; i++) {
      hand.x = x0 + (dx * i) / n;
      hand.y = y0 + (dy * i) / n;
      if (stepped) {
        // the trackpad's arithmetic, done here: 6 px of dead zone, 1.8 aim px per finger px, from the anchor
        await page.evaluate(
          ({ ox, oy, W, H }) => {
            const hl = window.__hl;
            const inp = hl.app.input;
            const d = Math.hypot(ox, oy);
            const k = d > 6 ? ((d - 6) / d) * 1.8 : 0;
            hl.aim(inp.anchorX + (ox * k) / (W / 2), inp.anchorY - (oy * k) / (H / 2));
            hl.step(1, 1 / 60);
          },
          { ox: hand.x - HOME.x, oy: hand.y - HOME.y, W, H },
        );
        virtualT += 1 / 60;
      } else {
        if (input === 'touch') await sendTouch('touchMove');
        else await page.mouse.move(hand.x, hand.y);
        await sleep(1000 / 60);
      }
    }
  },
  /**
   * Lean toward (ux, uy) (screen directions, +y down) as far as `amount` of the aim circle and stay there for up to
   * `s` seconds, holding. With keys the arrows stay down for the whole of it (let go, and the aim recentres).
   */
  async lean(ux, uy, amount, s, stop) {
    await this.press();
    if (!stepped && input === 'key') {
      const ks = [];
      if (ux > 0.3) ks.push('ArrowRight');
      if (ux < -0.3) ks.push('ArrowLeft');
      if (uy < -0.3) ks.push('ArrowUp');
      if (uy > 0.3) ks.push('ArrowDown');
      for (const k of ks) await page.keyboard.down(k);
      await pass(s, stop);
      for (const k of ks) await page.keyboard.up(k);
      return;
    }
    const tx = HOME.x + ux * reach * amount;
    const ty = HOME.y + uy * reach * amount;
    await this.drag(tx - hand.x, ty - hand.y, 0.4);
    await pass(s, stop);
  },
  async second(s) {
    if (!touch || stepped) return tick(s);
    hand.second = true;
    await sendTouch(hand.down ? 'touchMove' : 'touchStart');
    await tick(s);
    hand.second = false;
    await sendTouch(hand.down ? 'touchMove' : 'touchEnd');
  },
  /** Lift the first finger while a second one stays down: the flight must go on. */
  async liftFirst(s) {
    if (!touch || stepped) return;
    hand.second = true;
    await sendTouch(hand.down ? 'touchMove' : 'touchStart');
    await tick(0.2);
    hand.down = false;
    await sendTouch('touchMove'); // (a move that lists fewer points releases the missing ones)
    await tick(s);
    const st = await snap();
    liftChecks++;
    if (st.raw !== true) liftFails++;
    hand.second = false;
    await sendTouch('touchEnd');
    await releasedCheck('second finger up');
  },
  async cancel() {
    if (stepped || !touch) return this.release();
    hand.down = hand.second = false;
    await sendTouch('touchCancel');
    hand.x = HOME.x;
    hand.y = HOME.y;
    await releasedCheck('cancel');
  },
  async blur() {
    // (a synthetic blur event: headless Chrome has no window to take the focus away from)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const wasDown = hand.down || hand.second;
    hand.down = hand.second = false;
    hand.x = HOME.x;
    hand.y = HOME.y;
    await releasedCheck('blur');
    // the fingers are still physically down: lift them so the next press is a fresh one
    if (!stepped) {
      if (input === 'touch') await sendTouch('touchEnd');
      else if (!wasDown) return;
      else if (input === 'mouse') await page.mouse.up();
      else await page.keyboard.up('Space');
    }
  },
  async key(name, s) {
    if (!(s > 0)) return page.keyboard.press(name);
    await page.keyboard.down(name);
    await tick(s);
    await page.keyboard.up(name);
  },
};

let releaseFails = 0;
let releaseChecks = 0;
let liftChecks = 0;
let liftFails = 0;
async function releasedCheck(what) {
  // "within a frame": two animation frames after the event (stepped: one stepped frame)
  if (stepped) {
    await page.evaluate(() => window.__hl.step(1, 1 / 60));
    virtualT += 1 / 60;
  } else await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const st = await snap();
  releaseChecks++;
  if (st.held || st.raw) {
    releaseFails++;
    console.log(`  ! still holding one frame after ${what}: held ${st.held} raw ${st.raw}`);
  }
}

// ---------------------------------------------------------------------------------------------- frames and the log

const shots = [];
let logSeen = 0;
let lastShot = -1e9;
const timeline = [];
async function shot(label) {
  const name = `${String(shots.length).padStart(3, '0')}-${label.replace(/[^a-z0-9.]+/gi, '-').slice(0, 40)}.png`;
  const file = resolve(outDir, name);
  try {
    await page.screenshot({ path: file, type: 'png', scale: 'css' });
    shots.push({ file, label });
  } catch (e) {
    console.log(`  (frame ${label} failed: ${e.message.split('\n')[0]})`);
  }
  lastShot = now();
}
/** Print the new events of __hl.log, save a frame at each, and one every --every seconds. Returns the new events. */
async function service() {
  const fresh = await page.evaluate((n) => window.__hl.log.slice(n), logSeen);
  logSeen += fresh.length;
  for (const e of fresh) {
    const line = `t=${e.t.toFixed(1).padStart(6)} p=${e.p.toFixed(3)} ${e.type}${e.id ? ` ${e.id}` : ''}${e.cell != null ? ` cell ${e.cell}` : ''}`;
    timeline.push(e);
    console.log(`  ${line}`);
  }
  const worth = fresh.filter((e) => e.type !== 'press' && e.type !== 'release');
  if (worth.length && every >= 0) await shot(`${worth[worth.length - 1].type}${worth[worth.length - 1].id ? `-${worth[worth.length - 1].id}` : ''}`);
  else if (every > 0 && now() - lastShot >= every) {
    const st = await snap();
    await shot(`p${st.p.toFixed(3)}`);
  }
  return fresh;
}
/** Let `s` seconds pass, servicing the log and the frames on the way. Stops early if stop() says so. */
async function pass(s, stop = null) {
  const end = now() + s;
  while (now() < end - 1e-6) {
    await tick(Math.min(0.1, end - now()));
    const fresh = await service();
    if (stop && (await stop(fresh))) return true;
    if (now() > timeout) throw new Error(`timed out after ${timeout} s`);
  }
  return false;
}
// `wait gate` is satisfied by the first gate event no earlier `wait` has used, so an event that arrived while the
// script was busy with the step before is not missed.
let cursor = 0;
async function waitEvent(type, max = timeout) {
  const find = () => {
    for (let i = cursor; i < timeline.length; i++) {
      if (timeline[i].type === type) {
        cursor = i + 1;
        return true;
      }
    }
    return false;
  };
  await service();
  if (find()) return true;
  return pass(max, find);
}
const waitP = (x, max = timeout) => pass(max, async () => (await snap()).p > x);

// ---------------------------------------------------------------------------------------------- scripts

async function runScript(text) {
  const steps = text.split(';').map((s) => s.trim()).filter(Boolean);
  // (what the page logged while it loaded, its first `world` above all, is not something a script waits for)
  await service();
  cursor = timeline.length;
  for (const step of steps) {
    const [verb, ...rest] = step.split(/\s+/);
    const arg = step.slice(verb.length).trim(); // (as written: `eval` may span lines)
    console.log(`> ${step.split('\n')[0]}${step.includes('\n') ? ' …' : ''}`);
    switch (verb) {
      case 'hold':
        await hands.press();
        await pass(parseFloat(rest[0] || '1'));
        break;
      case 'release':
        await hands.release();
        await pass(parseFloat(rest[0] || '1'));
        break;
      case 'tap':
        await hands.press();
        await tick(0.1);
        await hands.release();
        break;
      case 'drag': {
        const [dx, dy] = rest[0].split(',').map(Number);
        await hands.drag(dx, dy, parseFloat(rest[1] || '0.5'));
        await service();
        break;
      }
      case 'second':
        await hands.second(parseFloat(rest[0] || '1'));
        break;
      case 'lift':
        await hands.liftFirst(parseFloat(rest[0] || '1'));
        break;
      case 'cancel':
        await hands.cancel();
        break;
      case 'blur':
        await hands.blur();
        break;
      case 'key':
        await hands.key(rest[0], parseFloat(rest[1] || '0'));
        break;
      case 'wait': {
        const m = /^p>([\d.]+)$/.exec(rest[0] || '');
        if (m) {
          if (!(await waitP(parseFloat(m[1])))) check(`wait ${rest[0]}`, false, 'never got there');
        } else if (/^[\d.]+$/.test(rest[0] || '')) await pass(parseFloat(rest[0]));
        else if (!(await waitEvent(rest[0]))) check(`wait ${rest[0]}`, false, 'never happened');
        break;
      }
      case 'shot':
        await shot(rest[0] || 'shot');
        break;
      case 'set': {
        const m = /^p=([\d.]+)$/.exec(rest[0] || '');
        if (m) await page.evaluate((p) => window.__hl.set({ p }), parseFloat(m[1]));
        setJumps++;
        break;
      }
      case 'eval':
        await page.evaluate((js) => new Function('__hl', js)(window.__hl), arg);
        break;
      case 'expect': {
        const v = await page.evaluate((js) => !!new Function('__hl', `return (${js})`)(window.__hl), arg);
        check(`expect ${arg}`, v);
        break;
      }
      case 'reload': {
        await hands.release();
        await drain();
        await load({ fresh: !persist });
        logSeen = 0;
        cursor = timeline.length;
        reloads++;
        break;
      }
      default:
        throw new Error(`unknown script verb "${verb}"`);
    }
  }
}

// ---------------------------------------------------------------------------------------------- bots

const R = 0.4 * Math.min(W, H); // the aim circle, px
const reach = Math.ceil(R / 1.8) + 12; // finger travel that reaches its edge

/** Hold until the world after `start` is current. A hold that began before a world opened does not count, so re-press. */
async function holdUntilNextWorld(start) {
  await hands.press();
  return pass(timeout, async () => {
    const st = await snap();
    return st.world !== start && !st.inc;
  });
}

const BOTS = {
  async idle() {
    const a = await snap();
    await pass(seconds);
    const b = await snap();
    const last = await page.evaluate(() => ({ hint: window.__hl.app.hud._hint, watch: window.__hl.app.auto }));
    check('idle: progress did not move', Math.abs(b.p - a.p) < 1e-6, `p ${a.p.toFixed(4)} → ${b.p.toFixed(4)} over ${seconds} s`);
    check('idle: the hint reads "Hold to fly"', last.hint === 'Hold to fly', `hint: ${JSON.stringify(last.hint)}`);
    check('idle: Watch is off', last.watch === false);
  },

  async lazy() {
    const a = await snap();
    const arrived = await holdUntilNextWorld(a.world);
    await hands.release();
    await pass(1);
    const b = await snap();
    check('lazy: reached the next world by only holding', arrived && b.world !== a.world, `${a.world} → ${b.world} in ${now().toFixed(0)} s`);
    return { start: a };
  },

  async smoke() {
    const a = await snap();
    await hands.press();
    await pass(4);
    const b = await snap();
    check('smoke: holding advances progress', b.p > a.p + 0.01, `p ${a.p.toFixed(4)} → ${b.p.toFixed(4)} in 4 s of holding`);
    await hands.release();
    await pass(2.5);
    const c = await snap();
    await pass(1.5);
    const d = await snap();
    check('smoke: releasing stops it', d.p === c.p && d.fly === 0, `p moved ${(d.p - c.p).toExponential(1)} between 2.5 s and 4 s after release; fly ${d.fly.toFixed(3)}`);
    await page.evaluate(() => window.__hl.set({ p: 0.97 }));
    setJumps++;
    await pass(0.4);
    const arrived = await holdUntilNextWorld(a.world);
    const e = await snap();
    check('smoke: the world ends and the next begins', arrived && e.world !== a.world, `${a.world} → ${e.world}`);
    // the hold that carried it over does not count in the new world until it is let go
    await pass(1.2);
    const f = await snap();
    check('smoke: the carried-over hold does not fly the new world', f.p < 1e-4 && f.held === false && f.raw === true, `p ${f.p.toFixed(4)} held ${f.held} (finger still down: ${f.raw})`);
    await hands.release();
    await pass(0.4);
    await hands.press();
    await pass(2);
    const g = await snap();
    check('smoke: pressed again, it flies', g.p > 0.005 && g.held === true, `p ${g.p.toFixed(4)}`);
    await hands.release();
    await pass(0.5);
  },

  // Plays like someone who gets it: holds, and at each waiting moment does what its kind asks.
  //   steer  drag, any way            beat  drag and keep holding            rest  let go
  async perfect() {
    const a = await snap();
    const dirs = [[1, 0], [-1, 0], [0, -1], [0, 1]];
    let done = false;
    await hands.press();
    while (!done) {
      const st = await snap();
      if (st.world !== a.world && !st.inc) break;
      if (now() > timeout) throw new Error(`timed out after ${timeout} s`);
      const g = st.gate;
      if (!g) {
        if (st.inc) {
          await pass(0.3);
          continue;
        }
        await hands.press();
        // (the world may say which way a player who gets it would lean: playState().aim = [x, y] in NDC)
        await pass(0.2);
        continue;
      }
      const gone = async () => {
        const s2 = await snap();
        return !s2.gate || s2.gate.id !== g.id;
      };
      const want = st.state && Array.isArray(st.state.aim) ? st.state.aim : null;
      if (g.kind === 'rest') {
        await hands.release();
        await pass(30, gone);
      } else if (g.kind === 'steer') {
        // lean one way, then the other, and round: any drag is the answer
        for (let i = 0; i < 12 && !(await gone()); i++) {
          const [ux, uy] = want && i === 0 ? [want[0], -want[1]] : dirs[i % 4];
          await hands.lean(ux, uy, 0.8, 0.5, gone);
        }
      } else {
        // beat: lean at it and keep holding. Without a hint from the world, try each side in turn
        const order = want ? [[want[0], -want[1]], ...dirs] : dirs;
        for (let i = 0; i < order.length * 2 && !(await gone()); i++) {
          const [ux, uy] = order[i % order.length];
          await hands.lean(ux, uy, 1, want && i === 0 ? 8 : 3.2, gone);
        }
      }
      if (!(await gone())) await pass(40, gone); // (the bot did not manage it: wait for the world to do it itself)
      // back to the middle of the pad, still flying
      if (g.kind !== 'rest' && hand.down && !stepped && input !== 'key') await hands.drag(HOME.x - hand.x, HOME.y - hand.y, 0.3);
    }
    await hands.release();
    await pass(1);
    return { start: a };
  },

  // Anything a hand can do, in any order.
  async masher() {
    let seed = 20261114;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const end = now() + seconds;
    while (now() < end) {
      const r = rnd();
      if (r < 0.2) {
        await hands.press();
        await tick(0.05 + rnd() * 0.2);
        await hands.release();
      } else if (r < 0.5) {
        const a = rnd() * Math.PI * 2;
        const d = 20 + rnd() * reach * 1.4;
        await hands.drag(Math.cos(a) * d, Math.sin(a) * d, 0.1 + rnd() * 0.6);
        await pass(rnd() * 1.5);
      } else if (r < 0.62) await hands.second(0.1 + rnd() * 0.8);
      else if (r < 0.7) await hands.liftFirst(0.3 + rnd() * 0.5);
      else if (r < 0.78) await hands.cancel();
      else if (r < 0.84) await hands.blur();
      else if (r < 0.92) {
        await hands.press();
        await pass(0.5 + rnd() * 3);
      } else {
        await hands.release();
        await pass(0.2 + rnd() * 1.2);
      }
      await service();
    }
    await hands.release();
    await pass(1);
  },
};

// ---------------------------------------------------------------------------------------------- run

const allStates = [];
const camTotals = { frames: 0, quiet: 0, moved: 0, worst: null };
let setJumps = 0;
let reloads = 0;
const replays = [];
async function drain(final = false) {
  const r = await page.evaluate((final) => {
    const rec = window.__rec;
    const hl = window.__hl;
    const app = hl.app;
    const states = rec.states.splice(0);
    if (final) {
      try {
        rec.replay();
      } catch (e) {
        console.error('replay failed', e);
      }
    }
    const replay = rec.replays.splice(0);
    rec.states.length = 0;
    return { states, frames: rec.frames, quiet: rec.quiet, moved: rec.moved, worst: rec.worst, errors: hl.errors.slice(0, 5), replay };
  }, final);
  allStates.push(...r.states.map((s) => ({ ...s, load: loads })));
  camTotals.frames += r.frames;
  camTotals.quiet += r.quiet;
  camTotals.moved += r.moved;
  if (r.worst && (!camTotals.worst || r.worst.dp + r.worst.dq > camTotals.worst.dp + camTotals.worst.dq)) camTotals.worst = r.worst;
  replays.push(...r.replay);
  return r;
}

let fatal = null;
let botOut = null;
let appErrors = [];
try {
  await load();
  const s0 = await snap();
  console.log(`play ${world} @ ${W}x${H} dpr ${dpr}  input ${stepped ? 'stepped (virtual clock)' : input}${bot ? `  bot ${bot}` : ''}  mode ${s0.mode}  p ${s0.p.toFixed(3)}  cells ${s0.cells}`);
  await tick(stepped ? 0.2 : 1.2);
  await shot('start');
  if (script) await runScript(script);
  if (bot) {
    if (!BOTS[bot]) throw new Error(`unknown bot "${bot}"`);
    botOut = await BOTS[bot]();
  }
  await hands.release();
  await service();
  await shot('end');
} catch (e) {
  fatal = e;
  console.error(`run failed: ${e.message}`);
  try {
    await shot('failed');
  } catch {}
}

let last = null;
try {
  last = await snap();
  const r = await drain(true);
  appErrors = r.errors;
} catch (e) {
  console.error(`could not read the final state: ${e.message}`);
}

// ---- what must always hold
if (last) {
  const lit = (st, wi) => [...st.cells.slice(wi * 3, wi * 3 + 3)].filter((c) => c === '1').length;
  const ids = await page.evaluate(() => window.__hl.worlds).catch(() => []);
  const wi = ids.indexOf(world);
  const finds = timeline.filter((e) => e.type === 'find');
  if (bot === 'perfect') {
    const want = opt('expect-finds') != null ? +opt('expect-finds') : 3;
    check(`perfect: ${want} finds`, lit(last, wi) === want, `cells of ${world}: ${last.cells.slice(wi * 3, wi * 3 + 3)}  finds logged: ${finds.map((e) => `${e.id}→${e.cell}`).join(', ') || 'none'}`);
    const early = finds.every((f) => !timeline.some((e) => e.type === 'cue' && e.id === f.id && e.t <= f.t));
    check('perfect: each find comes before its cue', early);
  }
  if (bot === 'lazy' && from == null) {
    const want = opt('expect-finds') != null ? +opt('expect-finds') : 0;
    check(`lazy: ${want} finds`, lit(last, wi) === want, `cells of ${world}: ${last.cells.slice(wi * 3, wi * 3 + 3)}`);
    const gates = [...new Set(timeline.filter((e) => e.type === 'gate').map((e) => e.id))];
    for (const id of gates) {
      const seq = ['gate', 'cue', 'auto', 'pass'].map((t) => timeline.find((e) => e.type === t && e.id === id));
      check(`lazy: gate ${id} went gate, cue, auto, pass`, seq.every(Boolean) && seq.every((e, i) => i === 0 || e.t >= seq[i - 1].t), seq.map((e, i) => `${['gate', 'cue', 'auto', 'pass'][i]} ${e ? e.t.toFixed(1) : 'never'}`).join('  '));
    }
  }
  // progress never decreases (inside one world, between jumps made by the tool itself)
  let back = 0;
  let worstBack = 0;
  for (let i = 1; i < allStates.length; i++) {
    const a = allStates[i - 1];
    const b = allStates[i];
    if (a.load !== b.load || a.world !== b.world) continue;
    if (b.p < a.p - 1e-6) {
      back++;
      worstBack = Math.max(worstBack, a.p - b.p);
    }
  }
  check('progress never decreases', back <= setJumps, `${allStates.length} samples, ${back} steps back${setJumps ? ` (${setJumps} were the tool's own jumps)` : ''}${back ? `, largest ${worstBack.toFixed(4)}` : ''}`);
  check('nothing is held one frame after a release, cancel or blur', releaseFails === 0, `${releaseChecks} checked, ${releaseFails} still holding`);
  if (liftChecks) check('lifting one finger of two keeps the flight', liftFails === 0, `${liftChecks} checked, ${liftFails} dropped`);
  if (bot === 'lazy' && wi === ids.length - 1) {
    check('loop: arrived in world 01 with the loop logged and cell 18 lit', last.world === ids[0] && timeline.some((e) => e.type === 'loop') && last.cells[18] === '1', `world ${last.world}  cells ${last.cells}  lap ${last.lap}`);
  }
  const w = camTotals.worst;
  check(
    'camera: the pose does not change while progress does not',
    camTotals.moved === 0,
    `${camTotals.frames} frames watched, ${camTotals.quiet} with progress unchanged${camTotals.quiet ? '' : ' (so this run did not exercise it)'}, ${camTotals.moved} moved${w ? `; worst at ${w.world} p=${w.p.toFixed(4)}: pos ${w.dp.toExponential(1)} quat ${w.dq.toExponential(1)} fov ${w.df.toExponential(1)}` : ''}`,
  );
  const rn = replays.reduce((a, r) => a + r.n, 0);
  const rbad = replays.reduce((a, r) => a + r.bad, 0);
  check(
    'camera: equal progress gives an equal pose (replayed)',
    rn > 0 && rbad === 0,
    rn ? replays.map((r) => `${r.world}: ${r.n} recorded poses replayed, ${r.bad} differ (worst pos ${r.worst.dp.toExponential(1)} quat ${r.worst.dq.toExponential(1)} fov ${r.worst.df.toExponential(1)})`).join('; ') : 'no camera to replay',
  );
}
check('no page errors, __hl.errors is empty', !pageFailed && appErrors.length === 0 && !fatal, fatal ? fatal.message : `${pageLogs.filter((l) => !l.startsWith('[warning]')).length} console errors, ${appErrors.length} app errors`);

// ---- files
writeFileSync(resolve(outDir, 'state.jsonl'), allStates.map((s) => JSON.stringify(s)).join('\n') + '\n');
writeFileSync(resolve(outDir, 'timeline.json'), JSON.stringify({ world, input: stepped ? 'stepped' : input, size: [W, H], bot, script, timeline, results }, null, 2));
if (shots.length) {
  try {
    const tw = Math.min(W, 260);
    const th = Math.round((tw * H) / W);
    const cols = Math.min(shots.length, H > W ? 8 : 5);
    const rows = Math.ceil(shots.length / cols);
    const sheetCtx = await browser.newContext({ viewport: { width: cols * tw, height: rows * th }, deviceScaleFactor: 1 });
    const sheet = await sheetCtx.newPage();
    await sheet.setContent(
      `<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${tw}px)">${shots
        .map((s) => `<div style="position:relative;width:${tw}px;height:${th}px"><img src="data:image/png;base64,${readFileSync(s.file).toString('base64')}" style="display:block;width:100%;height:100%"><span style="position:absolute;left:4px;bottom:4px;font:10px monospace;color:#fff;background:rgba(0,0,0,.6);padding:1px 4px">${s.label}</span></div>`)
        .join('')}</body>`,
    );
    await sheet.waitForLoadState('load');
    await sheet.screenshot({ path: resolve(outDir, 'sheet.png'), type: 'png' });
    await sheetCtx.close();
  } catch (e) {
    console.log(`(sheet failed: ${e.message.split('\n')[0]})`);
  }
}

if (pageLogs.length) {
  console.log('\n--- page console ---');
  for (const l of [...new Set(pageLogs)].slice(0, 30)) console.log(l);
}
for (const e of appErrors) console.log(`[app error] ${e.slice(0, 800)}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? `FAILED ${failed.length} of ${results.length}` : `ALL ${results.length} PASS`}   ${shots.length} frames, state.jsonl (${allStates.length} samples) and sheet.png in ${outDir}`);
await browser.close();
await srv.close();
process.exit(failed.length ? 1 : 0);

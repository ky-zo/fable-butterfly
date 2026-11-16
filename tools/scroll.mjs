#!/usr/bin/env node
// Checks the main interaction, scrolling, on the REAL page with real wheel or touch events.
//
//   node tools/scroll.mjs [world] [--input wheel|touch] [--out shots/scroll]
//
// It must hold that: nothing moves until the visitor scrolls and the instruction is on screen; scrolling forward moves
// the journey and it comes to rest; a hard scroll cannot outrun the top speed; scrolling back moves it back; scrolling on past the end begins the next world; the
// wing's cells light on the way; no page errors. Needs the dev server (the shared one on 5199, or HL_URL).
//
// In a world that has things to find (docs/PLAY.md, section 15) the cells are not lit by scrolling: it must also hold
// that scrolling alone goes all the way through and into the next world with no cell lit; that steering the butterfly
// onto each find while scrolling (real mouse moves, or the sideways part of a real touch drag) lights its cell; and
// that the camera at a given progress is the same with and without steering.

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const world = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'conservatory';
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const input = opt('input', 'wheel');
const touch = input === 'touch';
const out = resolve(ROOT, opt('out', `shots/scroll-${input}`));
const URL0 = (process.env.HL_URL || 'http://127.0.0.1:5199').replace(/\/$/, '');
const [W, H] = touch ? [390, 844] : [1280, 720];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const st = () =>
  page.evaluate(() => {
    const p = window.__hl.play();
    const c = document.querySelector('.hl-coach');
    const e = document.querySelector('.hl-end');
    return { world: p.world, p: p.p, mode: p.mode, cells: p.cells, coach: c.classList.contains('is-in') ? c.textContent : '', end: e.classList.contains('is-in') ? e.textContent : '' };
  });
/** Scroll by about `px` of wheel, or the same on touch (finger travel px / 3.2), in strokes like a hand makes. */
async function scroll(px) {
  if (!touch) {
    // (the cursor is left where it is: a wheel turning is not a hand steering)
    const n = Math.max(1, Math.round(Math.abs(px) / 100));
    for (let i = 0; i < n; i++) {
      await page.mouse.wheel(0, px / n);
      await wait(16);
    }
    return;
  }
  let left = Math.abs(px) / 3.2;
  const dir = px > 0 ? -1 : 1; // forward = the finger moves up
  while (left > 1) {
    const d = Math.min(left, 380);
    const y0 = H / 2 - (dir * d) / 2;
    // (a thumb never goes straight up: the stroke drifts sideways, as far as 24 px over a long one. That is not steering)
    const drift = (24 * d) / 380;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W / 2, y: y0, id: 1 }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: W / 2 + (drift * i) / 8, y: y0 + (dir * d * i) / 8, id: 1 }] });
      await wait(16);
    }
    await wait(120); // (the finger rests before lifting: no momentum, so the distances here are exact)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(60);
    left -= d;
  }
}

/** Keep scrolling (far harder than the top speed needs) for about `seconds`. */
async function fly(seconds, dir = 1) {
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) await scroll(dir * 1200);
}

// ---- the intro says two things: how to fly, and how to move left and right
await page.goto(`${URL0}/?fresh=1&scale=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__hl && window.__hl.ready, null, { timeout: 60000 });
await page.evaluate(() => window.__hl.ready);
await wait(1500);
const how = await page.evaluate(() => [...document.querySelectorAll('.hl-intro-how li')].map((li) => li.textContent.trim()));
check('the intro says how to fly and how to move left and right', how.length === 2 && /fly/.test(how[0]) && /left or right/.test(how[1]), how.join(' | '));
await page.screenshot({ path: resolve(out, '0-intro.png') });

// ---- the journey
await page.goto(`${URL0}/?world=${world}&fresh=1&scale=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__hl && window.__hl.ready, null, { timeout: 60000 });
await page.evaluate(() => window.__hl.ready);
if (!touch) await page.mouse.move(W / 2, H / 2, { steps: 4 }); // the cursor comes to rest in the picture, and stays
await wait(2500);
let a = await st();
// a world with things to find lights its cells when the butterfly is steered to them, not by scrolling
const hasFinds = await page.evaluate(() => ((window.__hl.app.cur.rules && window.__hl.app.cur.rules.finds) || []).length > 0);
const finds = () => page.evaluate(() => window.__hl.log.filter((e) => e.type === 'find').map((e) => e.id));
check('scroll is the mode', a.mode === 'scroll', a.mode);
check('nothing moves until the visitor scrolls', a.p === 0, `p ${a.p}`);
check('the instruction is on screen', /fly/.test(a.coach), a.coach);
await page.screenshot({ path: resolve(out, '1-start.png') });

// (the top speed is 4x the film's pace, and a scroll may only ask for 0.9 s of that ahead: App.js SCROLL_MAX_PACE, SCROLL_LEAD)
const dur = await page.evaluate(() => window.__hl.app.cur.meta.duration);
const top = 4 / dur;
const h0 = Date.now();
await scroll(6000);
const hs = (Date.now() - h0) / 1000;
await wait(3000);
let hard = await st();
check('a hard scroll cannot outrun the top speed', hard.p > 0.01 && hard.p <= top * (hs + 0.9) + 0.004, `p ${hard.p.toFixed(3)} after ${hs.toFixed(1)} s of hard scrolling, limit ${(top * (hs + 0.9)).toFixed(3)}`);
await fly((0.3 * dur) / 4);
await wait(2600);
let b = await st();
check('scrolling forward moves the journey', b.p > 0.25, `p ${b.p.toFixed(3)}`);
// (in a world with things to find, the one other instruction, how to steer, may be up instead: see below)
check('the instruction goes once they have scrolled', hasFinds ? !/fly/.test(b.coach) : b.coach === '', b.coach);
await wait(1500);
let c = await st();
check('it comes to rest', c.p === b.p, `p ${b.p.toFixed(4)} then ${c.p.toFixed(4)}`);
if (hasFinds) check('scrolling past a find lights no cell', !/1/.test(c.cells), c.cells);
else check('the first cell of the wing is lit on the way', c.cells[c.cells.search(/1/)] === '1' && c.cells.indexOf('1') % 3 === 0, c.cells);
await page.screenshot({ path: resolve(out, '2-scrolled.png') });

await fly(2.5, -1);
await wait(2600);
let d = await st();
check('scrolling back moves it back', d.p < c.p - 0.05 && d.p > 0, `p ${c.p.toFixed(3)} then ${d.p.toFixed(3)}`);

// ---- momentum on touch: a flick carries on after the finger lifts, and a finger put down stops it
if (touch) {
  const y0 = H * 0.7;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W / 2, y: y0, id: 1 }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: W / 2, y: y0 - i * 40, id: 1 }] });
    await wait(12);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const t0 = await page.evaluate(() => window.__hl.app.cur.pTarget);
  await wait(900);
  const t1 = await page.evaluate(() => window.__hl.app.cur.pTarget);
  check('a flick carries on after the finger lifts', t1 > t0 + 0.01, `target ${t0.toFixed(3)} then ${t1.toFixed(3)}`);
  await wait(4000);
}

// ---- the end: the words, then scrolling on begins the next world
if (hasFinds) {
  // nothing holds the journey: scrolling alone, with no steering, goes all the way through
  const t0 = Date.now();
  let s = await st();
  while (s.p < 0.93 && Date.now() - t0 < 90000) {
    await scroll(1200);
    s = await st();
  }
  while (s.p <= 0.986 && Date.now() - t0 < 120000) {
    await scroll(150);
    await wait(400);
    s = await st();
  }
  const found = await finds();
  check('scrolling alone reaches the end, and no find is made without steering', s.p > 0.985 && s.world === world && !/1/.test(s.cells) && found.length === 0, `p ${s.p.toFixed(3)} after ${((Date.now() - t0) / 1000).toFixed(0)} s, cells ${s.cells}, finds [${found}]`);
} else {
  await page.evaluate(() => window.__hl.set({ p: 0.985 }));
  await scroll(300);
}
await wait(3000);
let e = await st();
check('at the end it says to keep going', /Keep (scrolling|swiping)/.test(e.end) && e.world === world, e.end.replace(/\s+/g, ' '));
await page.screenshot({ path: resolve(out, '3-end.png') });
await scroll(1500);
await page.waitForFunction((w) => window.__hl.play().world !== w, world, { timeout: 30000 }).catch(() => {});
await wait(3500);
let f = await st();
check('scrolling on past the end begins the next world', f.world !== world && f.p < 0.2, `${f.world} p ${f.p.toFixed(3)}`);
await page.screenshot({ path: resolve(out, '4-next.png') });
if (hasFinds) check('…with the cells of the world that was only scrolled through still unlit', !/1/.test(f.cells), f.cells);

// ---- steering (a world with things to find): the same journey with a hand on it
let appErrors = await page.evaluate(() => (window.__hl.errors || []).length);
if (hasFinds) {
  await page.goto(`${URL0}/?world=${world}&fresh=1&scale=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__hl && window.__hl.ready, null, { timeout: 60000 });
  await page.evaluate(() => window.__hl.ready);
  await wait(2000);
  const X = (x) => (x * 0.5 + 0.5) * W;
  const Y = (y) => (0.5 - y * 0.5) * H;
  /** p, the cells, the aim, the anchor, where each find is on screen now (the world says: playState().finds), the lens, how far the animal is off its line. */
  const info = () =>
    page.evaluate(() => {
      const hl = window.__hl;
      const p = hl.play();
      const w = hl.app.cur.world;
      const c = w.camera;
      const co = document.querySelector('.hl-coach');
      return {
        world: p.world,
        p: p.p,
        cells: p.cells,
        aim: p.aim,
        anchor: [hl.app.input.anchorX, hl.app.input.anchorY],
        finds: (p.state && p.state.finds) || [],
        cam: [...c.position.toArray(), ...c.quaternion.toArray(), c.fov, c.aspect],
        off: w.hero ? w.hero.offset.length() : 0,
        real: w.steer ? w.steer.real : null,
        coach: co.classList.contains('is-in') ? co.textContent : '',
      };
    });
  let finger = null; // touch: where the finger is while it is down
  const lift = async () => {
    if (finger) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    finger = null;
  };
  /**
   * One small step of a hand that steers toward (x, y) NDC while it scrolls on by about `px` scroll px: a real mouse
   * move and a wheel notch, or a finger that goes up the screen and sideways (only its sideways part steers).
   */
  async function steerStep(s, x, y, px) {
    if (!touch) {
      await page.mouse.move(X(x), Y(y), { steps: 3 });
      if (px) await page.mouse.wheel(0, px / 1.25);
      return;
    }
    if (!finger) {
      finger = { x: W / 2, y: H * 0.8 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...finger, id: 1 }] });
    }
    // (until it has plainly gone sideways it does not steer; after that the aim follows the finger 1.8 to 1)
    const want = ((x - s.aim.x) * (W / 2)) / 1.8;
    finger.x += s.aim.active ? Math.max(-6, Math.min(6, want)) : Math.sign(x - s.anchor[0]) * 8;
    finger.y -= px / 3.2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...finger, id: 1 }] });
  }

  let hinted = '';
  let cam = null;
  let s = await info();
  const list = s.finds;
  check('the world says where its finds are', list.length === 3, list.map((x) => x.id).join(' '));
  for (let i = 0; i < list.length; i++) {
    const id = list[i].id;
    // scroll on, with no hand on it, to just before the find can be made…
    const t0 = Date.now();
    while (s.p < list[i].from - 0.03 && Date.now() - t0 < 60000) {
      await scroll(300);
      s = await info();
      if (/left or right/.test(s.coach)) hinted = s.coach;
    }
    if (i === 0) check('how to steer is said once, before the first find', /left or right/.test(hinted) && s.cells[0] === '0', hinted);
    // …then go on slowly and steer the butterfly onto it
    const t1 = Date.now();
    let lit = false;
    while (Date.now() - t1 < 25000) {
      s = await info();
      lit = s.cells[i] === '1';
      const f = s.finds[i];
      if (lit || s.p > f.to) break;
      await steerStep(s, f.at[0], f.at[1], 6);
      await wait(30);
    }
    await page.screenshot({ path: resolve(out, `5-find-${id}.png`) });
    await lift();
    const made = await finds();
    check(`steering onto "${id}" while scrolling lights its cell`, lit && made[made.length - 1] === id && s.cells.slice(0, i + 1) === '1'.repeat(i + 1), `p ${s.p.toFixed(3)}, cells ${s.cells}, finds [${made}]`);

    if (i === 1) {
      // ---- the lens: at one place in the journey, the same picture with a hand on the butterfly and without
      await wait(6500); // (the journey comes to rest, and the hand that steered is forgotten)
      const a0 = await info();
      const g = a0.finds[i].at;
      if (touch) {
        // a drag that is sideways only: it steers and scrolls nothing
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W / 2, y: H * 0.7, id: 1 }] });
        for (let k = 1; k <= 10; k++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: W / 2 + Math.sign(g[0] - a0.anchor[0]) * 7 * k, y: H * 0.7, id: 1 }] });
          await wait(16);
        }
        finger = { x: 0, y: 0 };
      } else {
        // (a movement that is meant: the cursor may be resting on that very spot)
        await page.mouse.move(X(g[0]) + 80, Y(g[1]), { steps: 4 });
        await page.mouse.move(X(g[0]), Y(g[1]), { steps: 4 });
      }
      await wait(1200);
      const a1 = await info();
      await lift();
      cam = { same: a0.cam.every((v, k) => v === a1.cam[k]), p0: a0.p, p1: a1.p, off1: a1.off, was: a0.aim.active || a0.real, is: a1.aim.active && a1.real };
      check(
        'the camera is the same with and without steering',
        cam.same && cam.p0 === cam.p1 && !cam.was && cam.is && cam.off1 > 0.03,
        `p ${cam.p0.toFixed(4)}, camera ${cam.same ? 'identical' : 'MOVED'}, hand ${cam.was ? 'on' : 'off'} then ${cam.is ? 'on' : 'off'}, butterfly steered ${(cam.off1 * 100).toFixed(1)} cm off its line`,
      );
      s = a1;
    }
  }
  s = await info();
  check('the instruction to steer is gone once they have', !/left or right/.test(s.coach), s.coach);
}
appErrors += await page.evaluate(() => (window.__hl.errors || []).length);
check('no page errors', errors.length === 0 && appErrors === 0, errors.concat(appErrors ? [`${appErrors} app errors`] : []).join('; '));

await browser.close();
const bad = results.filter((r) => !r).length;
console.log(bad ? `\nFAILED ${bad} of ${results.length}` : `\nALL ${results.length} PASS   frames in ${out}`);
process.exit(bad ? 1 : 0);

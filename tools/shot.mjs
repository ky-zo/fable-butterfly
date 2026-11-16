#!/usr/bin/env node
// Headless screenshot / perf tool. Renders a world on the real GPU (ANGLE Metal) with deterministic stepping.
//
//   node tools/shot.mjs <world> [options]
//
//   --p 0.35              progress along the rail (0..1)                       default 0
//   --frames 90           frames to simulate (at 60 fps) before the capture    default 90
//   --drift 0.0005        progress added per simulated frame (camera in motion)
//   --pointer 0.2,-0.1    pointer position in NDC (-1..1, +y up)
//   --down                hold the pointer down
//   --size 1280x720       viewport                                              default 1280x720
//   --dpr 1               device pixel ratio                                    default 1
//   --q high|medium|low   quality tier                                          default high
//   --out path.png        output file                                           default shots/<world>-p<p>.png
//   --hud                 keep the HUD visible (hidden by default)
//   --clip x,y,w,h        crop the capture to a region in CSS px (render big with --size 1920x1080, then crop to inspect detail)
//   --eval "<js>"         run JS in the page after the frames and before the capture. __hl.set/step are available,
//                         e.g. --eval "for(let i=0;i<80;i++){__hl.set({pointer:[-0.6+i*0.015,0.1]});__hl.step(1)}"
//
//   --sheet               contact sheet: 9 progress values (0..1) in one image
//   --sheet-p 0,0.2,0.5   …or explicit progress values
//   --times 0,2,4,8       contact sheet over TIME at fixed --p (seconds simulated before each tile)
//   --perf                print average ms/frame at p = 0.1, 0.5, 0.9 (1920x1080 unless --size given)
//   --sweep               …at p = 0, 0.1 … 1;  --perf-p 0.03,0.36,0.75  …at explicit values
//   (--sheet / --sheet-p / --times honour --size: e.g. --size 390x844 gives a row of portrait tiles)
//   --transition <world>  capture the transition from <world> (held at its last frame; --from-p to change) into the given world at --mix (default 0.5)
//   --reduced             emulate prefers-reduced-motion: reduce
//   --still               check that the camera does not move with time at 17 fixed progress values
//   --initcost            cold-load the world into an empty engine and report how long init() blocks the main thread.
//                         init runs while the PREVIOUS world is on screen, so every block longer than a frame is a visible hitch.
//
// Console errors/warnings from the page (including shader compile logs) are printed. Exit code 1 on page errors.

import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
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
  console.error('usage: node tools/shot.mjs <world> [--p 0.3] [--frames 90] [--sheet] [--perf] … (see file header)');
  process.exit(2);
}

const PORT = 5199;
async function serverUrl() {
  // HL_URL=https://… points the run at any deployed copy instead of the local dev server
  if (process.env.HL_URL) return { url: process.env.HL_URL.replace(/\/$/, ''), close: async () => {} };
  const url = `http://127.0.0.1:${PORT}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (r.ok) return { url, close: async () => {} };
  } catch {}
  // no shared dev server running → start a private one on a free port
  const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0, strictPort: false, host: '127.0.0.1' } });
  await server.listen();
  const addr = server.httpServer.address();
  return { url: `http://127.0.0.1:${addr.port}`, close: () => server.close() };
}

const perfMode = !!opt('perf') || !!opt('perf-p') || !!opt('sweep');
const perfPs = opt('perf-p') ? String(opt('perf-p')).split(',').map(Number) : opt('sweep') ? [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] : [0.1, 0.5, 0.9];
const [W, H] = String(opt('size', perfMode ? '1920x1080' : '1280x720')).split('x').map(Number);
const dpr = parseFloat(opt('dpr', '1'));
const q = opt('q', 'high');
const frames = parseInt(opt('frames', '90'), 10);
const drift = parseFloat(opt('drift', '0'));
const p = parseFloat(opt('p', '0'));
const pointer = opt('pointer') ? String(opt('pointer')).split(',').map(Number) : null;
const down = !!opt('down');
const evalJs = opt('eval');
const sheet = !!opt('sheet') || !!opt('sheet-p');
const times = opt('times') ? String(opt('times')).split(',').map(Number) : null;
const transitionFrom = opt('transition');
const clipArg = opt('clip') ? String(opt('clip')).split(',').map(Number) : null;
const clip = clipArg ? { x: clipArg[0], y: clipArg[1], width: clipArg[2], height: clipArg[3] } : undefined;
const mixv = parseFloat(opt('mix', '0.5'));
const outDefault = resolve(ROOT, 'shots', `${world}${sheet ? '-sheet' : times ? '-times' : transitionFrom ? '-transition' : `-p${p}`}.png`);
const out = resolve(process.cwd(), String(opt('out', outDefault)));

const srv = await serverUrl();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--hide-scrollbars', '--mute-audio'],
});

let failed = false;
const logs = [];
async function openPage(w, h, startWorld = world) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, reducedMotion: opt('reduced') ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') {
      const text = m.text();
      if (/Download the Vue Devtools|GPU stall due to ReadPixels/.test(text)) return;
      logs.push(`[${t}] ${text.slice(0, 2400)}`);
      if (t === 'error') failed = true;
    }
  });
  page.on('pageerror', (e) => {
    logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`);
    failed = true;
  });
  const qs = new URLSearchParams({ world: startWorld, still: '1', q, dpr: String(dpr) });
  if (!opt('hud')) qs.set('nohud', '1');
  await page.goto(`${srv.url}/?${qs}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__hl && window.__hl.ready, null, { timeout: 60000 });
  const ok = await page.evaluate(async () => {
    try {
      await Promise.race([window.__hl.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('world init timed out after 90s')), 90000))]);
      return window.__hl.app.cur || new URLSearchParams(location.search).get('world') === 'none' ? true : 'world failed to load (see errors above)';
    } catch (e) {
      return String(e.message || e);
    }
  });
  if (ok !== true) {
    logs.push(`[fatal] ${ok}`);
    failed = true;
  }
  return page;
}

const simulate = (page, o) =>
  page.evaluate(({ p, frames, drift, pointer, down, evalJs }) => {
    const hl = window.__hl;
    hl.set({ p, pointer: pointer || undefined, down });
    // simulate in chunks so a slow frame doesn't trip watchdogs
    hl.step(frames, 1 / 60, drift);
    if (evalJs) new Function('__hl', evalJs)(hl);
    return { info: hl.info(), errors: hl.errors.slice(0, 5) };
  }, o);

function finish(code = 0) {
  if (logs.length) {
    console.log('\n--- page console ---');
    for (const l of [...new Set(logs)].slice(0, 40)) console.log(l);
  }
  return browser.close().then(() => srv.close()).then(() => process.exit(code || (failed ? 1 : 0)));
}

try {
  mkdirSync(dirname(out), { recursive: true });

  if (opt('initcost')) {
    const page = await openPage(W, H, 'none');
    const res = await page.evaluate(async (id) => {
      const hl = window.__hl;
      const i = hl.worlds.indexOf(id);
      if (i < 0) throw new Error('unknown world ' + id);
      // a message-channel ping loop: every gap between pings is time the main thread was not available
      let last = performance.now(), run = true;
      const gaps = [];
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        const t = performance.now();
        if (t - last > 8) gaps.push(t - last);
        last = t;
        if (run) ch.port2.postMessage(0);
      };
      ch.port2.postMessage(0);
      await new Promise((r) => setTimeout(r, 50));
      gaps.length = 0;
      const t0 = performance.now();
      let error = null;
      try {
        await hl.app.load(i);
      } catch (e) {
        error = String((e && e.message) || e);
      }
      const total = performance.now() - t0;
      run = false;
      gaps.sort((a, b) => b - a);
      return { total, error, longest: gaps[0] || 0, top: gaps.slice(0, 6).map((g) => Math.round(g)), over16: gaps.filter((g) => g > 16.7).length, over50: gaps.filter((g) => g > 50).length, blocked: gaps.filter((g) => g > 16.7).reduce((a, b) => a + b, 0) };
    }, world);
    console.log(`init cost ${world} (cold load into an empty engine, q=${q})`);
    console.log(`  total ${res.total.toFixed(0)} ms   longest main-thread block ${res.longest.toFixed(0)} ms   blocks >16.7ms: ${res.over16}   blocks >50ms: ${res.over50}   time blocked ${res.blocked.toFixed(0)} ms`);
    console.log(`  largest blocks (ms): ${res.top.join(', ')}`);
    console.log('  target: no block over ~50 ms, ideally none over ~20 ms. Chunk CPU work with await ctx.yield(); precompile shaders with renderer.compileAsync / pass.compile.');
    if (res.error) {
      failed = true;
      logs.push(`[fatal] ${res.error}`);
    }
    await finish();
  } else if (opt('still')) {
    // the owner's rule: at fixed progress, with time running, the camera does not move at all
    const page = await openPage(W, H);
    const res = await page.evaluate(() => {
      const hl = window.__hl;
      const rows = [];
      for (let k = 0; k <= 16; k++) {
        const p = k / 16;
        hl.set({ p, pointer: [0.2, 0.1] });
        hl.step(90);
        const cam = hl.app.cur.world.camera;
        if (!cam) return null;
        const p0 = cam.position.clone(), q0 = cam.quaternion.clone(), f0 = cam.fov;
        let dp = 0, dq = 0, df = 0;
        for (let i = 0; i < 240; i++) {
          hl.step(1, i % 2 ? 1 / 60 : 1 / 30);
          dp = Math.max(dp, cam.position.distanceTo(p0));
          dq = Math.max(dq, 1 - Math.abs(cam.quaternion.dot(q0)));
          df = Math.max(df, Math.abs(cam.fov - f0));
        }
        rows.push({ p, dp, dq, df });
      }
      return rows;
    });
    if (!res) console.log(`still ${world}: world exposes no camera`);
    else {
      const worst = res.reduce((a, r) => (r.dp + r.dq + r.df > a.dp + a.dq + a.df ? r : a));
      const ok = res.every((r) => r.dp < 1e-6 && r.dq < 1e-9 && r.df < 1e-6);
      console.log(`still ${world} @ ${W}x${H}: ${ok ? 'OK, camera does not move with time' : 'CAMERA MOVES'}  (17 progress values x 240 frames; worst at p=${worst.p}: pos ${worst.dp.toExponential(1)} quat ${worst.dq.toExponential(1)} fov ${worst.df.toExponential(1)})`);
      if (!ok) { failed = true; for (const r of res) if (r.dp >= 1e-6 || r.dq >= 1e-9 || r.df >= 1e-6) console.log(`  p=${r.p}  pos ${r.dp.toExponential(2)}  quat ${r.dq.toExponential(2)}  fov ${r.df.toExponential(2)}`); }
    }
    await finish();
  } else if (perfMode) {
    const page = await openPage(W, H);
    const res = await page.evaluate(async ({ evalJs, perfPs }) => {
      const hl = window.__hl;
      if (evalJs) new Function('__hl', evalJs)(hl);
      const rows = [];
      for (const p of perfPs) {
        hl.set({ p, pointer: [0.2, 0.1] });
        hl.step(20);
        const ms = Math.min(hl.perf(40), hl.perf(40));
        rows.push({ p, ms: +ms.toFixed(2), ...hl.info() });
      }
      return rows;
    }, { evalJs, perfPs });
    console.log(`perf ${world} @ ${W}x${H} dpr ${dpr} q=${q}  (budget: ≤ 10 ms/frame; numbers inflate when other GPU jobs run concurrently)`);
    for (const r of res) console.log(`  p=${r.p}  ${r.ms} ms/frame   calls ${r.calls}  tris ${r.triangles}  points ${r.points}  textures ${r.textures}  programs ${r.programs}`);
    await finish();
  } else if (sheet || times) {
    const tiles = times
      ? times.map((t) => ({ p, frames: Math.max(1, Math.round(t * 60)), label: `p ${p}  t ${t}s` }))
      : (opt('sheet-p') ? String(opt('sheet-p')).split(',').map(Number) : [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]).map((pp) => ({ p: pp, frames, label: `p ${pp}` }));
    // tiles follow --size when given (so portrait and ultrawide can be reviewed as a sheet), else 640x360
    const sized = !!opt('size');
    const portrait = sized && H > W;
    const tw = !sized ? 640 : Math.min(W, 640);
    const th = !sized ? 360 : Math.round((tw * H) / W);
    const page = await openPage(tw, th);
    const shots = [];
    let last = null;
    for (const t of tiles) {
      last = await simulate(page, { p: t.p, frames: t.frames, drift: 0, pointer, down, evalJs });
      const buf = await page.screenshot({ type: 'png' });
      shots.push({ label: t.label, src: `data:image/png;base64,${buf.toString('base64')}` });
    }
    const cols = portrait ? Math.min(tiles.length, 6) : tiles.length <= 4 ? 2 : 3;
    const rows = Math.ceil(tiles.length / cols);
    const ctx2 = await browser.newContext({ viewport: { width: cols * tw, height: rows * th }, deviceScaleFactor: 1 });
    const grid = await ctx2.newPage();
    await grid.setContent(
      `<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${tw}px)">${shots
        .map((s) => `<div style="position:relative;width:${tw}px;height:${th}px"><img src="${s.src}" style="display:block;width:100%;height:100%"><span style="position:absolute;left:6px;top:4px;font:11px monospace;color:#fff;background:rgba(0,0,0,.55);padding:1px 5px">${s.label}</span></div>`)
        .join('')}</body>`,
    );
    await grid.waitForLoadState('load');
    await grid.screenshot({ path: out, type: 'png' });
    console.log(`saved ${out}  (${cols}x${rows} tiles of ${tw}x${th})`);
    if (last) console.log(`info: ${JSON.stringify(last.info)}`);
    await finish();
  } else if (transitionFrom) {
    const page = await openPage(W, H, String(transitionFrom));
    await simulate(page, { p: opt('from-p') != null ? +opt('from-p') : 1, frames: 30, drift: 0, pointer, down, evalJs: null });
    await page.evaluate(async ({ world, mixv }) => {
      await window.__hl.transition(world, mixv);
      window.__hl.app.inc.p = 0;
      for (let i = 0; i < 20; i++) window.__hl.app.frame(1 / 60);
    }, { world, mixv });
    await page.screenshot({ path: out, type: 'png' });
    console.log(`saved ${out}`);
    await finish();
  } else {
    const page = await openPage(W, H);
    const res = await simulate(page, { p, frames, drift, pointer, down, evalJs });
    await page.screenshot({ path: out, type: 'png', clip });
    console.log(`saved ${out}  (${W}x${H} @${dpr}x, p=${p}, ${frames} frames)`);
    console.log(`info: ${JSON.stringify(res.info)}`);
    if (res.errors.length) {
      failed = true;
      for (const e of res.errors) logs.push(`[app error] ${e.slice(0, 1500)}`);
    }
    await finish();
  }
} catch (e) {
  console.error('shot failed:', e.message);
  await finish(1);
}

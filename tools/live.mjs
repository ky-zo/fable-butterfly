#!/usr/bin/env node
// End-to-end smoke test of the real (non-still) experience: intro → enter → visit every world with real
// transitions, flying each one for a while (the left mouse button held, the cursor steering) while the frame times
// are measured. Reports frame times and console errors, and saves a screenshot per world.
//
//   node tools/live.mjs [--size 1440x900] [--dpr 1] [--dwell 4] [--out shots/live] [--only id1,id2] [--watch]
//
//   --watch   press "Watch" instead of holding: the piece plays itself while it is measured

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
const [W, H] = String(opt('size', '1440x900')).split('x').map(Number);
const dpr = parseFloat(opt('dpr', '1'));
const dwell = parseFloat(opt('dwell', '4'));
const outDir = resolve(process.cwd(), String(opt('out', resolve(ROOT, 'shots/live'))));
const only = opt('only') ? String(opt('only')).split(',') : null;
const watch = !!opt('watch');
mkdirSync(outDir, { recursive: true });

async function serverUrl() {
  // HL_URL=https://… points the run at any deployed copy instead of the local dev server
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
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
const logs = [];
let failed = false;
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') {
    const t = m.text();
    if (/GPU stall due to ReadPixels/.test(t)) return;
    logs.push(`[${m.type()}] ${t.slice(0, 1600)}`);
    if (m.type() === 'error') failed = true;
  }
});
page.on('pageerror', (e) => {
  logs.push(`[pageerror] ${e.message}`);
  failed = true;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// measure real requestAnimationFrame cadence for `seconds`
const measure = (seconds) =>
  page.evaluate(
    (seconds) =>
      new Promise((res) => {
        const ts = [];
        const t0 = performance.now();
        const tick = (t) => {
          ts.push(t);
          if (t - t0 < seconds * 1000) requestAnimationFrame(tick);
          else {
            const d = [];
            for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
            d.sort((a, b) => a - b);
            const avg = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
            res({ fps: +(1000 / avg).toFixed(1), avg: +avg.toFixed(2), p95: +(d[Math.floor(d.length * 0.95)] || 0).toFixed(2), worst: +(d[d.length - 1] || 0).toFixed(2), size: `${window.__hl.app.size.width}x${window.__hl.app.size.height}` });
          }
        };
        requestAnimationFrame(tick);
      }),
    seconds,
  );

try {
  await page.goto(`${srv.url}/?scale=1&fresh`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__hl && window.__hl.ready, null, { timeout: 60000 });
  await page.evaluate(() => window.__hl.ready);
  await sleep(1200);
  await page.screenshot({ path: resolve(outDir, '00-intro.png') });
  await page.click('[data-act="enter"]');
  await sleep(1500);
  if (watch) await page.keyboard.press('a');
  const ids = await page.evaluate(() => window.__hl.worlds);
  console.log(`live run @ ${W}x${H} dpr ${dpr}  (${watch ? 'Watch on' : 'holding to fly'})`);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (only && !only.includes(id)) continue;
    if (i > 0 || only) {
      await page.keyboard.press(String(i + 1));
      // wait for load + transition to finish
      await page.waitForFunction((id) => window.__hl.app.cur && window.__hl.app.cur.def.id === id && !window.__hl.app.inc, id, { timeout: 90000 }).catch(() => {
        logs.push(`[fatal] never arrived at ${id}`);
        failed = true;
      });
    }
    await page.mouse.move(W * 0.35, H * 0.45);
    await sleep(300);
    // hold to fly, and steer a little while holding
    if (!watch) await page.mouse.down();
    for (let s = 0; s < 6; s++) {
      await page.mouse.move(W * (0.35 + s * 0.05), H * (0.45 + Math.sin(s) * 0.08));
      await sleep(90);
    }
    const m = await measure(dwell);
    const state = await page.evaluate(() => ({ p: +window.__hl.app.cur.p.toFixed(3), mode: window.__hl.play().mode, held: window.__hl.play().held, loaded: [...window.__hl.app.slots.keys()], ...window.__hl.info() }));
    await page.screenshot({ path: resolve(outDir, `${String(i + 1).padStart(2, '0')}-${id}.png`) });
    if (!watch) await page.mouse.up();
    if (!(state.p > 0.005)) {
      logs.push(`[fatal] ${id}: progress did not move (${state.mode}, held ${state.held}, p ${state.p})`);
      failed = true;
    }
    console.log(`  ${id.padEnd(13)} ${String(m.fps).padStart(5)} fps  avg ${m.avg} ms  p95 ${m.p95}  worst ${m.worst}  | ${m.size} ${state.mode} p=${state.p} calls ${state.calls} tris ${state.triangles} pts ${state.points} tex ${state.textures} geo ${state.geometries} | loaded: ${state.loaded.join(',')}`);
  }
  const appErrors = await page.evaluate(() => window.__hl.errors);
  for (const e of appErrors) {
    logs.push(`[app error] ${e.slice(0, 1200)}`);
    failed = true;
  }
} catch (e) {
  console.error('live run failed:', e.message);
  failed = true;
}
if (logs.length) {
  console.log('\n--- page console ---');
  for (const l of [...new Set(logs)].slice(0, 40)) console.log(l);
}
console.log(`screenshots in ${outDir}`);
await browser.close();
await srv.close();
process.exit(failed ? 1 : 0);

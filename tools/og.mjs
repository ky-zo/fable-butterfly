#!/usr/bin/env node
// Bakes the share assets into public/: og.mp4 (a short silent film cut from the six worlds), og.jpg (the card image),
// favicon.svg and apple-touch-icon.png (the HUD's wing glyph). Needs ffmpeg on the PATH and a dev server (the shared one
// on 5199, or HL_URL). Everything is rendered in still mode on a stepped clock, so the film is the same every run.
//
//   node tools/og.mjs            everything
//   node tools/og.mjs --only image|video|icons
//   node tools/og.mjs --keep     keep the frame folders (shots/og/) after encoding

import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WING_GLYPH } from '../src/ui/wingGlyph.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = resolve(ROOT, 'public');
const TMP = resolve(ROOT, 'shots/og');
const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const keep = argv.includes('--keep');
const want = (k) => !only || only === k;
const URL0 = (process.env.HL_URL || 'http://127.0.0.1:5199').replace(/\/$/, '');

const W = 1200;
const H = 630;
const FPS = 30;
const FADE = 0.5; // seconds of cross-dissolve between shots
// world, progress from → to, seconds. The last shot ends on the first one's picture, so the film loops.
const SHOTS = [
  ['conservatory', 0.0, 0.006, 2.8],
  ['conservatory', 0.492, 0.528, 2.6],
  ['latent', 0.355, 0.4, 2.4],
  ['corpus', 0.225, 0.27, 2.4],
  ['descent', 0.6, 0.645, 2.4],
  ['loom', 0.105, 0.14, 2.4],
  ['mirror', 0.36, 0.395, 2.2],
  ['mirror', 0.972, 1.0, 3.0],
];

mkdirSync(PUB, { recursive: true });
mkdirSync(TMP, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--hide-scrollbars', '--mute-audio'],
});

async function open(world, w = W, h = H, dpr = 1) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  const qs = new URLSearchParams({ world, still: '1', q: 'high', dpr: String(dpr), nohud: '1' });
  await page.goto(`${URL0}/?${qs}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__hl && window.__hl.ready, null, { timeout: 60000 });
  await page.evaluate(() => window.__hl.ready);
  return { page, ctx };
}

const smooth = (t) => t * t * (3 - 2 * t);

// ------------------------------------------------------------------ the film
if (want('video')) {
  const dirs = [];
  for (let i = 0; i < SHOTS.length; i++) {
    const [world, p0, p1, sec] = SHOTS[i];
    const dir = resolve(TMP, `shot${i}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
    const { page, ctx } = await open(world);
    const n = Math.round(sec * FPS);
    // let the world settle at the first picture, then walk: a slow ease, never a stop
    await page.evaluate(({ p0 }) => {
      window.__hl.set({ p: p0 });
      window.__hl.step(120, 1 / 60, 0);
    }, { p0 });
    for (let f = 0; f < n; f++) {
      const t = f / (n - 1);
      const p = p0 + (p1 - p0) * (0.25 * t + 0.75 * smooth(t));
      await page.evaluate(({ p }) => {
        window.__hl.set({ p });
        window.__hl.step(1, 1 / 30, 0);
      }, { p });
      await page.screenshot({ path: resolve(dir, `${String(f).padStart(4, '0')}.png`) });
    }
    await ctx.close();
    console.log(`shot ${i}  ${world}  p ${p0} → ${p1}  ${n} frames`);
  }
  // cross-dissolve chain
  const args = ['-y', '-loglevel', 'error'];
  for (const d of dirs) args.push('-framerate', String(FPS), '-i', resolve(d, '%04d.png'));
  let filter = '';
  let last = '[0:v]';
  let at = 0;
  for (let i = 1; i < SHOTS.length; i++) {
    at += SHOTS[i - 1][3] - FADE;
    const out = i === SHOTS.length - 1 ? '[x]' : `[v${i}]`;
    filter += `${last}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${at.toFixed(3)}${out};`;
    last = out;
  }
  const total = at + SHOTS[SHOTS.length - 1][3];
  filter += `[x]fade=t=in:st=0:d=0.4,fade=t=out:st=${(total - 0.5).toFixed(3)}:d=0.5,format=yuv420p[o]`;
  args.push('-filter_complex', filter, '-map', '[o]', '-an', '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0', '-preset', 'slow', '-crf', '23', '-maxrate', '2400k', '-bufsize', '4800k', '-r', String(FPS), '-movflags', '+faststart', resolve(PUB, 'og.mp4'));
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  console.log(`public/og.mp4  ${total.toFixed(1)} s  ${(statSync(resolve(PUB, 'og.mp4')).size / 1e6).toFixed(2)} MB`);
  if (!keep) for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

// ------------------------------------------------------------------ the card
if (want('image')) {
  const { page, ctx } = await open('conservatory', W, H, 2);
  await page.evaluate(() => {
    window.__hl.set({ p: 0 });
    window.__hl.step(120, 1 / 60, 0);
  });
  const shot = await page.screenshot({ type: 'png' });
  await ctx.close();
  const font = readFileSync(resolve(ROOT, 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')).toString('base64');
  const c2 = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const card = await c2.newPage();
  await card.setContent(`<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: G; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 900; }
    html, body { margin: 0; width: ${W}px; height: ${H}px; background: #050607; overflow: hidden; }
    img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(5,6,7,0) 34%, rgba(5,6,7,.34) 62%, rgba(5,6,7,.5) 100%); }
    .t { position: absolute; right: 72px; bottom: 76px; text-align: right; font-family: G, sans-serif; color: #f1eee7; }
    h1 { margin: 0; font-weight: 400; font-size: 84px; letter-spacing: -0.035em; line-height: 1; }
    p { margin: 18px 0 0; font-weight: 400; font-size: 27px; letter-spacing: -0.01em; color: rgba(241,238,231,.8); }
  </style><img src="data:image/png;base64,${shot.toString('base64')}"><div class="shade"></div>
  <div class="t"><h1>Hidden Layers</h1><p>Six small worlds and one butterfly. Hold to fly.</p></div>`);
  await card.evaluate(() => document.fonts.ready);
  await card.screenshot({ path: resolve(PUB, 'og.jpg'), type: 'jpeg', quality: 88 });
  await c2.close();
  console.log(`public/og.jpg  ${(statSync(resolve(PUB, 'og.jpg')).size / 1e3).toFixed(0)} kB`);
}

// ------------------------------------------------------------------ the icons: the HUD's wing
if (want('icons')) {
  const g = WING_GLYPH;
  const S = 64;
  const k = (S * 0.66) / Math.max(g.w, g.h);
  const tx = (S - g.w * k) / 2;
  const ty = (S - g.h * k) / 2;
  const wing = (stroke, sw) =>
    `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(4)})" fill="none" stroke="${stroke}" stroke-linejoin="round" stroke-linecap="round">` +
    `<path d="${g.cells[18]} ${g.cells[0]} ${g.cells[9]}" fill="${stroke}" fill-opacity=".9" stroke="none"/>` +
    `<path d="${g.veins.join(' ')}" stroke-width="${(sw * 0.5) / k}" opacity=".7"/>` +
    `<path d="${g.outline.join(' ')}" stroke-width="${sw / k}"/></g>`;
  const svg = (r) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"><rect width="${S}" height="${S}" rx="${r}" fill="#050607"/>${wing('#f1eee7', 1.25)}</svg>`;
  writeFileSync(resolve(PUB, 'favicon.svg'), svg(14));
  const c3 = await browser.newContext({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 });
  const ip = await c3.newPage();
  for (const [name, px] of [['apple-touch-icon.png', 180], ['icon-512.png', 512]]) {
    await ip.setViewportSize({ width: px, height: px });
    await ip.setContent(`<!doctype html><style>html,body{margin:0;background:#050607}svg{display:block;width:${px}px;height:${px}px}</style>${svg(0)}`);
    await ip.screenshot({ path: resolve(PUB, name) });
  }
  await c3.close();
  console.log('public/favicon.svg, apple-touch-icon.png, icon-512.png');
}

await browser.close();

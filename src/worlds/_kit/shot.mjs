#!/usr/bin/env node
// Screenshot of the kit self-test (src/worlds/_kit). The app only loads worlds that are in the registry and `_kit` is
// deliberately not one, so this boots the engine empty (?world=none), adds `_kit` to the registry of that one page,
// and drives it the way tools/shot.mjs does. Uses the dev server on :5199 (or HL_URL).
//
//   node src/worlds/_kit/shot.mjs [--out shots/_kit/kit.png] [--size 1920x1080] [--dpr 1] [--p 0] [--frames 90] [--q high] [--perf] [--probe]

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? def : argv[i + 1] == null || argv[i + 1].startsWith('--') ? true : argv[i + 1];
};
const [W, H] = String(opt('size', '1920x1080')).split('x').map(Number);
const dpr = parseFloat(opt('dpr', '1'));
const out = resolve(process.cwd(), String(opt('out', 'shots/_kit/kit.png')));
const url = (process.env.HL_URL || 'http://127.0.0.1:5199').replace(/\/$/, '');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr })).newPage();
const logs = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/GPU stall/.test(m.text()) && logs.push(`[${m.type()}] ${m.text().slice(0, 2000)}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${url}/?world=none&still=1&nohud=1&q=${opt('q', 'high')}&dpr=${dpr}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__hl && window.__hl.ready);
const res = await page.evaluate(
  async ({ p, frames, perf, probe }) => {
    const hl = window.__hl;
    await hl.ready;
    const { WORLDS } = await import('/src/worlds/registry.js');
    if (!WORLDS.some((w) => w.id === '_kit')) WORLDS.push({ id: '_kit', number: '00', title: 'Kit', theme: 'Self-test', load: () => import('/src/worlds/_kit/index.js') });
    const t0 = performance.now();
    await hl.app.go(WORLDS.length - 1, { instant: true });
    const init = performance.now() - t0;
    if (!hl.app.cur) return { error: 'the self-test failed to load', errors: hl.errors.slice(0, 5) };
    hl.set({ p });
    hl.step(frames, 1 / 60);
    const ms = () => +Math.min(hl.perf(40), hl.perf(40), hl.perf(40)).toFixed(2);
    let cost = null;
    if (probe) {
      // what each thing on the board costs: the frame with everything, minus the frame without it
      const groups = hl.app.cur.world.board.groups;
      const all = ms();
      cost = { all };
      for (const [name, list] of Object.entries(groups)) {
        for (const g of list) g.visible = false;
        cost[name] = +(all - ms()).toFixed(2);
        for (const g of list) g.visible = true;
      }
    }
    return { init, ms: perf ? ms() : null, cost, info: hl.info(), errors: hl.errors.slice(0, 5) };
  },
  { p: parseFloat(opt('p', '0')), frames: parseInt(opt('frames', '90'), 10), perf: !!opt('perf', false), probe: !!opt('probe', false) },
);
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out, type: 'png' });
console.log(`saved ${out}  (${W}x${H} @${dpr}x)`);
console.log(JSON.stringify(res));
for (const l of [...new Set(logs)].slice(0, 30)) console.log(l);
await browser.close();
process.exit(res.error || res.errors?.length || logs.some((l) => !l.startsWith('[warning]')) ? 1 : 0);

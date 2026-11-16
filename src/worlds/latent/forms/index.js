// The things the regions of the map condense into. One generator per region, in the order they are visited.
// Every generator is a function* that yields every thousand points or so; `fill` runs one in slices of a few
// milliseconds so that init never holds the main thread (this world loads while the one before it is on screen).

import { Cloud } from './cloud.js';
import { fern } from './fern.js';
import { food } from './flower.js';
import { eye } from './eye.js';
import { pane } from './pane.js';
import { cold } from './cold.js';

export { Cloud };
export const GENERATORS = { fern, food, eye, pane, cold };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Drive a generator to its end, giving the page a breath whenever `budget` ms have gone by. */
export async function slice(gen, pause, budget = 5) {
  let t0 = now();
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    if (now() - t0 > budget) {
      await pause();
      t0 = now();
    }
  }
}

/** Runs one generator into a fresh, shuffled cloud of n points. */
export async function generateForm(name, n, rnd, pause, ...args) {
  const cloud = new Cloud(n);
  await slice(GENERATORS[name](cloud, rnd, ...args), pause);
  cloud.pad(rnd);
  await pause();
  cloud.shuffle(rnd);
  await pause();
  return cloud;
}

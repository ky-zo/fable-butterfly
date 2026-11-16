// The six layers, in order. Each world lives in its own folder and is loaded lazily, so one world's
// code (or bug) never blocks another. A world module may export `meta` to add captions, duration, hint…

export const WORLDS = [
  { id: 'conservatory', number: '01', title: 'Conservatory', theme: 'Perception', load: () => import('./conservatory/index.js') },
  { id: 'latent', number: '02', title: 'Latent', theme: 'Meaning', load: () => import('./latent/index.js') },
  { id: 'corpus', number: '03', title: 'Corpus', theme: 'Memory', load: () => import('./corpus/index.js') },
  { id: 'descent', number: '04', title: 'Descent', theme: 'Learning', load: () => import('./descent/index.js') },
  { id: 'loom', number: '05', title: 'Loom', theme: 'Attention', load: () => import('./loom/index.js') },
  { id: 'mirror', number: '06', title: 'Mirror', theme: 'Self', load: () => import('./mirror/index.js') },
];

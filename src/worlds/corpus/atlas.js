// Glyph atlas: every character the corpus uses, per face, drawn once on a 2D canvas and converted to a signed
// distance field (Felzenszwalb/Huttenlocher EDT with the anti-aliased edge trick), so letters stay crisp from
// a few pixels to half the screen and can be eroded, glowed and blurred in the shader.

import * as THREE from 'three';

export const CELL = 80; // atlas cell, px
export const FONT_PX = 52; // em size drawn into the cell
export const SPREAD = 10; // distance range encoded on each side of the outline, px
export const BASELINE = 0.69; // baseline position inside the cell, fraction from the top
export const CELL_EM = CELL / FONT_PX; // world size of a cell quad for a 1-unit em

const CJK_STACK = '"Hiragino Mincho ProN", "Yu Mincho", "Songti SC", "Noto Serif CJK JP", "Apple SD Gothic Neo", "Malgun Gothic", Georgia, "Times New Roman", serif';

export const FACES = {
  r: { css: `400 ${FONT_PX}px "Newsreader Variable"`, load: '400 52px "Newsreader Variable"' },
  i: { css: `italic 400 ${FONT_PX}px "Newsreader Variable"`, load: 'italic 400 52px "Newsreader Variable"' },
  m: { css: `400 ${FONT_PX * 0.86}px "Geist Mono Variable"`, load: '400 52px "Geist Mono Variable"', scale: 0.86 },
  s: { css: `420 ${FONT_PX * 0.9}px "Geist Variable"`, load: '420 52px "Geist Variable"', scale: 0.9 },
  x: { css: `400 ${FONT_PX * 0.86}px ${CJK_STACK}`, load: null, scale: 0.86 },
};

const INF = 1e20;

function edt1d(grid, offset, stride, length, f, v, z) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}

function edt(grid, size, f, v, z) {
  for (let x = 0; x < size; x++) edt1d(grid, x, size, size, f, v, z);
  for (let y = 0; y < size; y++) edt1d(grid, y * size, 1, size, f, v, z);
}

/**
 * @param {{face:string,text:string}[]} lines
 * @param {string} extra  additional characters to include for face 'r' and 'i' (stars)
 * @returns {Promise<{texture:THREE.DataTexture, cols:number, rows:number, size:[number,number], lookup:(face:string,ch:string)=>({index:number, adv:number}|null), measure:(face:string,text:string)=>{x:Float32Array,w:number}}>}
 */
export async function buildAtlas(ctx, lines, extra = '') {
  // ---- collect the character set per face
  const sets = {};
  for (const k of Object.keys(FACES)) sets[k] = new Set();
  for (const l of lines) for (const ch of l.text) if (ch.trim()) sets[l.face].add(ch);
  for (const ch of extra) {
    sets.r.add(ch);
    sets.i.add(ch);
  }

  // ---- make sure the bundled faces (and every unicode-range subset they need) are in before drawing
  await Promise.all(
    Object.entries(FACES).map(([k, f]) => {
      if (!f.load || !document.fonts || !document.fonts.load) return null;
      return document.fonts.load(f.load, [...sets[k]].join('')).catch(() => null);
    }),
  );

  const list = [];
  for (const k of Object.keys(FACES)) for (const ch of sets[k]) list.push({ face: k, ch });
  const cols = Math.ceil(Math.sqrt(list.length));
  const rows = Math.ceil(list.length / cols);
  const W = cols * CELL;
  const H = rows * CELL;
  const data = new Uint8Array(W * H);

  const canvas = document.createElement('canvas');
  canvas.width = CELL;
  canvas.height = CELL;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillStyle = '#fff';

  const n = CELL * CELL;
  const outer = new Float64Array(n);
  const inner = new Float64Array(n);
  const f = new Float64Array(CELL);
  const v = new Uint16Array(CELL);
  const z = new Float64Array(CELL + 1);
  const map = new Map();
  const base = Math.round(CELL * BASELINE);

  let since = performance.now();
  for (let gi = 0; gi < list.length; gi++) {
    const { face, ch } = list[gi];
    g.font = FACES[face].css;
    const adv = g.measureText(ch).width;
    g.clearRect(0, 0, CELL, CELL);
    g.fillText(ch, CELL / 2 - adv / 2, base);
    const img = g.getImageData(0, 0, CELL, CELL).data;
    let any = false;
    for (let p = 0; p < n; p++) {
      const a = img[p * 4 + 3] / 255;
      if (a > 0) any = true;
      outer[p] = a >= 1 ? 0 : a <= 0 ? INF : Math.pow(Math.max(0, 0.5 - a), 2);
      inner[p] = a >= 1 ? INF : a <= 0 ? 0 : Math.pow(Math.max(0, a - 0.5), 2);
    }
    map.set(face + ch, { index: any ? gi : -1, adv: adv / FONT_PX });
    if (any) {
      edt(outer, CELL, f, v, z);
      edt(inner, CELL, f, v, z);
      const cx = (gi % cols) * CELL;
      const cy = Math.floor(gi / cols) * CELL;
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          const p = y * CELL + x;
          const d = Math.sqrt(outer[p]) - Math.sqrt(inner[p]);
          const val = 255 * (0.5 - d / (2 * SPREAD));
          data[(cy + y) * W + cx + x] = val < 0 ? 0 : val > 255 ? 255 : val;
        }
      }
    }
    if (performance.now() - since > 7) {
      await ctx.yield();
      since = performance.now();
    }
  }

  const texture = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  texture.unpackAlignment = 1;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  ctx.track(texture);

  const spaceAdv = {};
  const measureCache = new Map();
  return {
    texture,
    cols,
    rows,
    size: [W, H],
    count: list.length,
    lookup(face, ch) {
      return map.get(face + ch) || null;
    },
    /** Typeset one line with the canvas (real advances + kerning). Returns pen x of every character, in em. */
    measure(face, text) {
      const key = face + '\u0000' + text;
      let m = measureCache.get(key);
      if (m) return m;
      g.font = FACES[face].css;
      const chars = [...text];
      const x = new Float32Array(chars.length);
      let prefix = '';
      for (let c = 0; c < chars.length; c++) {
        x[c] = g.measureText(prefix).width / FONT_PX;
        prefix += chars[c];
      }
      if (spaceAdv[face] == null) spaceAdv[face] = g.measureText(' ').width / FONT_PX;
      m = { chars, x, w: g.measureText(text).width / FONT_PX };
      measureCache.set(key, m);
      return m;
    },
  };
}

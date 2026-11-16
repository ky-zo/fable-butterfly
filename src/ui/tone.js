// Adaptive ink for the HUD.
//
// The worlds range from near-black to milky white, and the HUD sets type straight onto the image with no
// boxes behind it. So each HUD zone measures the picture underneath itself a few times a second and flips
// between a light ink and a dark ink (`data-ink="light" | "dark"` on the zone element), and raises
// `data-mid` where neither ink has much to push against: over mid-greys, or where a good share of the
// zone sits at the ink's own end of the scale (bright lettering passing under a light caption).
// hud.css does the rest.
//
// How it reads the picture without costing a frame: a handful of one-pixel-high rows are read from the
// finished canvas into a pixel-pack buffer (asynchronous, nothing waits on the GPU), guarded by a fence.
// `collect()` picks the bytes up at the start of a later frame, once the fence has signalled. Screenshot
// mode (`sync: true`) reads the same rows directly instead, so a still capture always shows settled tones.
//
// Contract with the renderer:
// - `tick()` must only be called right after a frame has been drawn to the canvas (the HUD calls it from
//   setProgress, which the core calls at the end of every frame). Nothing here creates the WebGL context.
// - No GL state is left behind: the only binding touched is PIXEL_PACK_BUFFER, and it is put back to
//   whatever it was. Nothing is read unless the default framebuffer is the one bound for reading.
// - Rows are planned against the live drawing-buffer size on every read, so resizes and adaptive
//   resolution need no bookkeeping. A lost context just drops the read in flight.
// - Nothing in here throws. A read that fails is abandoned and retried later; after three in a row the
//   sampler retires and the HUD keeps the ink it has.

const MAX_ROW = 1536; // px per sampled row
const MAX_BYTES = 1 << 18;
const GIVE_UP_MS = 2000; // a fence that has not signalled by now never will
const STRIKES = 3;
const HOT = 0.65 * 255; // a pixel this bright swallows light ink
const COLD = 0.32 * 255; // a pixel this dark swallows dark ink
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export class Tone {
  /**
   * @param {HTMLCanvasElement|null} canvas  the stage canvas (WebGL2)
   * @param {{sync?: boolean, interval?: number}} opts
   */
  constructor(canvas, { sync = false, interval = 220 } = {}) {
    this.canvas = canvas;
    this.sync = sync;
    this.interval = sync ? 0 : interval;
    this.zones = [];
    this.rows = [];
    this.gl = null;
    this.dead = !canvas;
    this.pbo = null;
    this.fence = null;
    this.bytes = null;
    this.used = 0;
    this.last = -1e9;
    this.issued = 0;
    this.strikes = 0;
    this.reads = 0; // completed measurements, for tools
    // the buffer and the fence die with the context; there is nothing left to delete
    if (canvas) canvas.addEventListener('webglcontextlost', () => (this.pbo = this.fence = null));
  }

  /**
   * Watch an element. `hi` / `lo` are the mean-luma thresholds (0..1, display-encoded) with hysteresis:
   * above `hi` the zone switches to dark ink, below `lo` back to light ink. They sit above the middle on
   * purpose: light ink with a soft shade behind it holds up over busy mid-tones far better than dark ink
   * does. `active()` gates the measurement, `target` is the element that receives the attributes
   * (defaults to the measured element).
   */
  add(el, { hi = 0.56, lo = 0.45, active = null, target = el } = {}) {
    const z = { el, target, hi, lo, active, ema: null, hot: 0, cold: 0, ink: 'light', mid: false, sum: 0, cnt: 0, nHot: 0, nCold: 0 };
    this.zones.push(z);
    return z;
  }

  _context() {
    let gl = null;
    try {
      gl = this.canvas.getContext('webgl2');
    } catch {}
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.dead = true;
      return null;
    }
    return (this.gl = gl);
  }

  /** Call once per rendered frame, after the frame is on the canvas. */
  tick(now) {
    if (this.dead) return;
    try {
      const gl = this.gl || this._context();
      if (!gl || gl.isContextLost()) return;
      if (this.fence) {
        // normally collect() has already picked the bytes up before this frame was drawn
        if (now - this.issued > 150) this._collect(now);
        return;
      }
      if (now - this.last < this.interval) return;
      this.last = now;
      if (!this._plan()) return;
      if (this.sync) this._readNow();
      else this._issue(now);
    } catch {
      this._fail(now);
    }
  }

  /**
   * Pick up a finished read. Call at the very start of a frame, before anything is drawn: the read-back
   * then finds the GPU channel empty instead of queueing behind a frame's worth of draw calls.
   */
  collect(now) {
    if (this.dead || !this.fence || !this.gl) return;
    try {
      if (!this.gl.isContextLost()) this._collect(now);
    } catch {
      this._fail(now);
    }
  }

  // A measurement must never take the frame loop down: drop what is in flight, wait a little, try again.
  _fail(now) {
    const gl = this.gl;
    const { pbo, fence } = this;
    this.pbo = this.fence = null;
    try {
      if (gl && !gl.isContextLost()) {
        if (fence) gl.deleteSync(fence);
        if (pbo) gl.deleteBuffer(pbo);
      }
    } catch {}
    this.last = now + 1500;
    if (++this.strikes >= STRIKES) this.dead = true;
  }

  // Lay out the rows to read: a few horizontal lines through every zone, in drawing-buffer pixels.
  _plan() {
    const gl = this.gl;
    const cr = this.canvas.getBoundingClientRect();
    const bw = gl.drawingBufferWidth;
    const bh = gl.drawingBufferHeight;
    if (cr.width < 2 || cr.height < 2 || bw < 2 || bh < 2) return false;
    const sx = bw / cr.width;
    const sy = bh / cr.height;
    const rows = this.rows;
    rows.length = 0;
    let off = 0;
    for (const z of this.zones) {
      if (z.active && !z.active()) continue;
      const r = z.el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const x0 = clamp(Math.floor((r.left - cr.left - 8) * sx), 0, bw - 2);
      const x1 = clamp(Math.ceil((r.right - cr.left + 8) * sx), x0 + 1, bw);
      const w = Math.min(x1 - x0, MAX_ROW);
      const x = x0 + ((x1 - x0 - w) >> 1);
      const n = clamp(Math.round(r.height / 20), 2, 5);
      for (let k = 0; k < n; k++) {
        if (off + w * 4 > MAX_BYTES) break;
        const yCss = r.top - cr.top + ((k + 0.5) / n) * r.height;
        const y = bh - 1 - clamp(Math.floor(yCss * sy), 0, bh - 1);
        rows.push({ z, x, y, w, off });
        off += w * 4;
      }
    }
    this.used = off;
    return off > 0;
  }

  _issue(now) {
    const gl = this.gl;
    // the frame was just drawn to the screen, so the default framebuffer is bound; if it is not, try later
    if (gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)) return;
    // a fresh buffer per read: the browser keeps a shadow copy of a fenced pack buffer, and writing into
    // one it has not handed back yet throws that copy away (and warns about it)
    const pbo = gl.createBuffer();
    if (!pbo) return;
    const prev = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    try {
      gl.bufferData(gl.PIXEL_PACK_BUFFER, this.used, gl.STREAM_READ);
      for (const r of this.rows) gl.readPixels(r.x, r.y, r.w, 1, gl.RGBA, gl.UNSIGNED_BYTE, r.off);
    } finally {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prev);
    }
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) {
      gl.deleteBuffer(pbo);
      return;
    }
    gl.flush();
    this.pbo = pbo;
    this.fence = fence;
    this.issued = now;
  }

  _collect(now) {
    const gl = this.gl;
    const s = gl.clientWaitSync(this.fence, 0, 0);
    if (s === gl.TIMEOUT_EXPIRED && now - this.issued < GIVE_UP_MS) return;
    const ok = s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED;
    const { pbo, fence } = this;
    this.pbo = this.fence = null;
    try {
      gl.deleteSync(fence);
      if (ok) {
        this._room();
        const prev = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        try {
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.bytes, 0, this.used);
        } finally {
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prev);
        }
      }
    } finally {
      gl.deleteBuffer(pbo);
    }
    if (ok) this._resolve(0.6);
  }

  // Screenshot mode only: a direct, blocking read of the same few rows.
  _readNow() {
    const gl = this.gl;
    if (gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)) return;
    this._room();
    const prev = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    if (prev) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    try {
      for (const r of this.rows) gl.readPixels(r.x, r.y, r.w, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.bytes, r.off);
    } finally {
      if (prev) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prev);
    }
    this._resolve(1);
  }

  _room() {
    if (!this.bytes || this.bytes.length < this.used) this.bytes = new Uint8Array(Math.max(this.used, 1 << 16));
  }

  _resolve(k) {
    const d = this.bytes;
    for (const z of this.zones) z.sum = z.cnt = z.nHot = z.nCold = 0;
    for (const r of this.rows) {
      const z = r.z;
      const step = r.w > 96 ? 12 : 4; // every third pixel is plenty on long rows
      for (let i = r.off, end = r.off + r.w * 4; i < end; i += step) {
        const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
        z.sum += l;
        if (l > HOT) z.nHot++;
        else if (l < COLD) z.nCold++;
        z.cnt++;
      }
    }
    for (const z of this.zones) {
      if (!z.cnt) continue;
      const L = z.sum / (z.cnt * 255);
      const first = z.ema == null;
      z.ema = first ? L : z.ema + (L - z.ema) * k;
      z.hot = first ? z.nHot / z.cnt : z.hot + (z.nHot / z.cnt - z.hot) * k;
      z.cold = first ? z.nCold / z.cnt : z.cold + (z.nCold / z.cnt - z.cold) * k;
      const next = z.ink === 'light' ? (z.ema > z.hi ? 'dark' : 'light') : z.ema < z.lo ? 'light' : 'dark';
      if (next !== z.ink) {
        z.ink = next;
        z.target.dataset.ink = next;
      }
      // Where the ink has little to push against, the dimmer tints firm up and the shade deepens:
      // over mid-greys, and where part of the zone is as light (or as dark) as the ink itself.
      const clash = z.ink === 'light' ? z.hot : z.cold;
      const mid = z.mid ? (z.ema > 0.17 && z.ema < 0.8) || clash > 0.04 : (z.ema > 0.23 && z.ema < 0.74) || clash > 0.08;
      if (mid !== z.mid) {
        z.mid = mid;
        z.target.toggleAttribute('data-mid', mid);
      }
    }
    this.strikes = 0;
    this.reads++;
  }
}

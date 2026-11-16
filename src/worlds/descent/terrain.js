// The land at night: a camera-centred geometry clip-map displaced by the shared LAND function and shaded as what it
// is — turf, bare soil, rock, loose stones, dew — under a moonless sky, with still water wherever it stands below
// the waterline. Warm only where the lamp reaches. On top of that, and only near the butterfly, the field it feels:
// the land's contour lines, seeds of scent running down the fall line, and near the lamp the rings of equal light.

import * as THREE from 'three';
import { LAND, LAND_FS, AIR, SKY } from './chunks.js';

const VERT = /* glsl */ `
${LAND}
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float s = length(modelMatrix[0].xyz);
  float lod = max(log2(s * uLandInfo.x * uLandInfo.y) - 1.0, 0.0);
  vec4 L;
  if (lod < 0.01) L = land(wp.xz);
  else {
    float e = max(abs(wp.x), abs(wp.z));
    vec4 n = textureLod(tLand, wp.xz * uLandInfo.y + 0.5, lod);
    vec4 f = textureLod(tLandFar, wp.xz * uLandInfo.w + 0.5, max(lod - 4.0, 0.0));
    L = mix(n, f, smoothstep(NEAR_IN, NEAR_OUT, e)) * LSC;
  }
  wp.y = max(L.x, WATER);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
uniform sampler2D tGrain;       // tiling micro relief: rg = gradient, b = height, a = white noise
uniform vec3 uSkyUp;            // what the sky gives the ground
uniform vec3 uKeyDir, uKeyCol;  // the paler side of the night sky, as a light
uniform vec4 uHero;             // where the butterfly is (xyz), and how far around it the field shows (m)
uniform vec4 uField;            // contours, rings of light, running seeds, the pulse of its wingbeat
uniform vec4 uProbe;            // the pointer on the ground: xz, radius, strength
uniform float uPixelAngle;
uniform float uThatch;
uniform vec3 uGrass;            // where the blades of turf are being drawn: xz, how far out
${LAND}
${LAND_FS}
${AIR}

float aaLine(float coord, float fw, float width) {
  float d = abs(fract(coord - 0.5) - 0.5) / max(fw, 1e-5);
  return clamp(width * 0.5 + 0.5 - d, 0.0, 1.0);
}
// how much of a light along dir reaches P over the land (soft)
float landShadow(vec3 P, vec3 dir, float maxT, float t, float ratio) {
  float s = 1.0;
  for (int i = 0; i < SHADOW_STEPS; i++) {
    if (t > maxT) break;
    vec3 q = P + dir * t;
    s = min(s, (q.y - landSoft(q.xz, 1.0 + 0.6 * float(i))) / t * 7.0 + 0.55);
    t *= ratio;
  }
  return clamp(s, 0.0, 1.0);
}

void main() {
  vec2 p = vWorld.xz;
  vec4 L = landShade(p);
  float h = L.x; vec2 g = L.yz; float ao = L.w;
  float wd = WATER - h;                                  // depth of water over this point
  float wet = smoothstep(0.0, 0.1, wd);                  // 1 = this is the water's surface
  vec3 wpos = vec3(p.x, max(h, WATER), p.y);
  vec3 toCam = uCam - wpos;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float slope = length(g);
  vec3 tl = uLamp.xyz - wpos;
  float lr2 = dot(tl, tl), lr = sqrt(lr2);
  vec3 Ld = tl / lr;
  vec3 lampI = uLampCol * (uLamp.w / (1.0 + lr2 * 0.3));
  vec3 col = vec3(0.0);
  float sunSh = 1.0;

  if (wet < 0.999) {
    // ------------------------------------------------------------------------------------------ the ground
    float nearK = 1.0 - smoothstep(4.0, 26.0, dist);
    float macroK = 1.0 - smoothstep(1.5, 9.0, dist);
    vec4 gA = texture2D(tGrain, p * 0.11 + 0.3);
    vec4 gB = texture2D(tGrain, p * 0.47);
    vec4 gC = texture2D(tGrain, p * 1.93 + 0.37);
    vec4 gD = texture2D(tGrain, p * 8.3 + 0.11);
    // (a steep face is not its plan: there the grain is laid on by height, or it would be drawn out into streaks)
    float steep = smoothstep(0.55, 1.1, slope);
    if (steep > 0.0) {
      // (laid on by height and by whichever of x and z runs along the face: one fixed diagonal would leave every
      // face that looks along it in level bands)
      float wx = g.x * g.x / max(slope * slope, 1e-6);
      vec2 pa = vec2(p.x, h * 0.9), pb = vec2(p.y + 3.1, h * 0.9);
      gC = mix(gC, mix(texture2D(tGrain, pa * 1.93 + 0.37), texture2D(tGrain, pb * 1.93 + 0.37), wx), steep);
      gD = mix(gD, mix(texture2D(tGrain, pa * 8.3 + 0.11), texture2D(tGrain, pb * 8.3 + 0.11), wx), steep);
    }
    float rock = smoothstep(0.75, 1.2, slope + (gB.z - 0.5) * 0.7);
    float turf = (1.0 - rock) * smoothstep(0.22, 0.4, gA.z + (gB.z - 0.5) * 0.4);
    float shore = 1.0 - smoothstep(0.0, 0.45, h - WATER);       // the wet band above the waterline
    vec2 mg = ((gB.xy - 0.5) * 0.7 + (gC.xy - 0.5) * 1.1) * nearK + (gD.xy - 0.5) * 1.8 * macroK;
    vec3 N = normalize(vec3(-g.x - mg.x, 1.0, -g.y - mg.y));
    // loose stones: more of them on bare ground and along the water
    float stone = 0.0;
#ifdef STONES
    if (dist < 12.0 && slope < 0.62) {
      vec2 q = p * 6.0;
      vec2 ip = floor(q), fp = q - ip;
      float best = 1e9, brad = 1.0; vec2 bo = vec2(0.0);
      float thr = mix(0.93, 0.5, max(shore, 1.0 - turf));
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 c = vec2(float(i), float(j));
        vec2 hh = hash22(ip + c);
        float rr = hash12(ip + c + 7.7);
        if (rr < thr) continue;
        float rad = 0.08 + 0.26 * (rr - thr) / (1.0 - thr) * (0.5 + hh.y);
        vec2 o = fp - c - hh;
        float d = length(o * vec2(1.0, 1.0 + 0.6 * hh.x)) - rad;
        if (d < best) { best = d; bo = o; brad = rad; }
      }
      float sk = (1.0 - smoothstep(6.0, 12.0, dist)) * (1.0 - smoothstep(0.4, 0.62, slope));
      stone = (1.0 - smoothstep(-0.03, 0.02, best)) * sk;
      N = normalize(N + vec3(bo.x, 0.0, bo.y) * (stone * 1.5 / brad));
      // (each stone sits in a little shade of its own)
      ao *= 1.0 - 0.45 * sk * (1.0 - smoothstep(0.0, 0.12, best)) * (1.0 - stone);
    }
#endif
    vec3 soil = vec3(0.06, 0.056, 0.053) * (0.6 + 0.8 * gC.z);
    // (under the blades it is thatch and shadow: the turf's colour is in the blades, when they are there to be seen)
    float blades = uThatch * (1.0 - smoothstep(uGrass.z * 0.62, uGrass.z, length(p - uGrass.xy)));
    vec3 grass = vec3(0.034, 0.054, 0.036) * (0.5 + 1.0 * mix(gC.z, gD.z, macroK)) * mix(1.0, 0.42, blades);
    vec3 rockC = vec3(0.085, 0.09, 0.1) * (0.5 + 1.0 * gC.z);
    vec3 alb = mix(mix(soil, grass, turf), rockC, rock);
    alb = mix(alb, vec3(0.085, 0.088, 0.096) * (0.55 + 0.9 * gD.z), stone);
    alb *= mix(1.0, 0.5, shore);
    float gloss = max(max(shore * 0.85, stone * 0.5), rock * 0.22);
    float NoV = max(dot(N, V), 0.0);
    float fres = 0.03 + 0.97 * pow(1.0 - NoV, 5.0);
    vec3 R = reflect(-V, N);
    float ao2 = ao * ao;
    col = alb * uSkyUp * (0.4 + 0.6 * N.y) * ao2;
    float nk = max(dot(N, uKeyDir), 0.0);
    col += alb * uKeyCol * nk * ao;
    col += uKeyCol * pow(max(dot(N, normalize(uKeyDir + V)), 0.0), 30.0) * gloss * 0.25 * ao;
    col += skyBase(vec3(R.x, abs(R.y), R.z)) * fres * gloss * ao;
    // dew: points of water on the turf, each catching whatever light there is
    vec4 d1 = texture2D(tGrain, p * 1.31 + 0.7);
    vec4 d2 = texture2D(tGrain, p * 4.3 + 0.2);
    float dew = (smoothstep(0.955, 1.0, d1.a) * (1.0 - smoothstep(5.0, 16.0, dist)) + smoothstep(0.975, 1.0, d2.a) * (1.0 - smoothstep(1.5, 5.0, dist))) * (0.3 + 0.7 * turf);
    vec3 dn = normalize(vec3((d2.xy - 0.5) * 2.4 + (d1.xy - 0.5) * 1.6, 0.75).xzy);
    col += uSkyUp * dew * 0.5 * ao;
    // the lamp
    if (uLamp.w > 0.001 && lr < 70.0) {
      float sh = landShadow(wpos + vec3(0.0, 0.05, 0.0), Ld, lr, 0.3, 1.8);
      float ndl = max(dot(N, Ld), 0.0);
      col += alb * lampI * (ndl * (1.0 - 0.3 * turf) + 0.12 * turf) * sh * 5.0;
      vec3 H = normalize(Ld + V);
      col += lampI * sh * (pow(max(dot(N, H), 0.0), 60.0) * gloss * 1.2 + dew * pow(max(dot(dn, H), 0.0), 9.0) * 9.0);
    }
    // the sun, once it is up
    if (uSunCol.r > 0.0005) {
      sunSh = landShadow(wpos + vec3(0.0, 0.05, 0.0), uSunDir, 400.0, 0.8, 2.4);
      float ndl = max(dot(N, uSunDir), 0.0);
      vec3 H = normalize(uSunDir + V);
      col += uSunCol * sunSh * (alb * ndl + pow(max(dot(N, H), 0.0), 60.0) * gloss * 0.6 + dew * pow(max(dot(dn, H), 0.0), 7.0) * 7.0);
    }
    // a little of its own light under it
    vec3 th = uHero.xyz - wpos;
    col += alb * vec3(1.0, 0.6, 0.3) * (uField.w * 0.05 / (0.05 + dot(th, th)));
  }
  if (wet > 0.001) {
    // ------------------------------------------------------------------------------------------ still water
    vec3 Pw = vec3(p.x, WATER, p.y);
    vec2 r1 = texture2D(tGrain, p * 0.19 + vec2(uTime * 0.006, uTime * 0.004)).xy - 0.5;
    vec2 r2 = texture2D(tGrain, p * 0.77 - vec2(uTime * 0.011, -uTime * 0.008)).xy - 0.5;
    vec2 rip = (r1 * 0.07 + r2 * 0.05) * (1.0 - smoothstep(60.0, 220.0, dist));
    vec3 Nw = normalize(vec3(rip.x, 1.0, rip.y));
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(Nw, V), 0.0), 5.0);
    vec3 Rw = reflect(-V, Nw);
    Rw.y = abs(Rw.y) + 0.003;
    Rw = normalize(Rw);
    vec3 refl = skyBase(Rw) + starField(Rw, uPixelAngle * 1.2) * 0.3;
    // the land's mirror image: is there ground above the reflected ray anywhere along it?
    float cover = 0.0, t = 1.2;
    for (int i = 0; i < MIRROR_STEPS; i++) {
      vec3 q = Pw + Rw * t;
      cover = max(cover, (landSoft(q.xz, 1.5 + 0.5 * float(i)) - q.y) / t * 9.0);
      t *= MIRROR_RATIO;
    }
    cover = clamp(cover, 0.0, 1.0);
    refl = mix(refl, uSkyUp * 0.012, cover);
    vec3 wcol = mix(vec3(0.0012, 0.0026, 0.0055) + uSkyUp * 0.01, refl, F);
    // the lamp in the water: a broken column of it, and its glow
    // (a point of light on water that is not quite flat is a column of separate glints, longest toward the eye)
    vec2 r3 = texture2D(tGrain, p * 2.3 + vec2(uTime * 0.021, -uTime * 0.016)).xy - 0.5;
    vec3 Ng = normalize(vec3(rip.x + r3.x * 0.06, 1.0, rip.y + r3.y * 0.06));
    vec3 Rg = reflect(-V, Ng);
    float sp = max(dot(Rg, normalize(uLamp.xyz - Pw)), 0.0);
    wcol += uLampCol * uLamp.w * (0.3 + 0.7 * F) * (pow(sp, 3000.0) * 45.0 + pow(sp, 400.0) * 0.25 + pow(sp, 20.0) * 0.004) / (1.0 + lr2 * 0.0012);
    float ss = max(dot(Rw, uSunDir), 0.0);
    wcol += uSunCol * F * (pow(ss, 900.0) * 30.0 + pow(ss, 60.0) * 0.6);
    col = mix(col * 0.75, wcol, wet);
  }

  // ---------------------------------------------------------------------------------------------- the field it feels
  vec2 dh = p - uHero.xz;
  float near = exp(-dot(dh, dh) / (uHero.w * uHero.w));
  vec2 dp = p - uProbe.xy;
  near = max(near, uProbe.w * exp(-dot(dp, dp) / (uProbe.z * uProbe.z)));
  if (near > 0.004) {
    float dry = 1.0 - wet;
    float hc = (h + (texture2D(tGrain, p * 0.9).z - 0.5) * 0.05) * 5.0;   // a line every 20 cm of height, as the ground really lies
    float fw = fwidth(hc);
    float fine = aaLine(hc, fw, 1.0) * (1.0 - smoothstep(0.25, 0.6, fw));
    float idx = aaLine(hc * 0.2, fw * 0.2, 1.7) * (1.0 - smoothstep(0.25, 0.6, fw * 0.2));
    float lines = max(fine * 0.4, idx) * dry;
    // seeds of scent running to low ground: small points of it, each with a short tail, rolling down the fall line
    // (three fixed lattice directions; the one nearest the fall line carries them)
    float flow = 0.0;
    float sl = smoothstep(0.05, 0.25, slope) * (1.0 - smoothstep(0.75, 1.3, slope)) * dry;
    if (sl > 0.0 && uField.z > 0.0) {
      vec2 fall = g / max(slope, 1e-4);                   // (this way is up)
      float fwp = max(fwidth(p.x), fwidth(p.y));
      float r = 0.007 + fwp * 0.7;
      float acc = 0.0, wsum = 0.0;
      for (int i = 0; i < 3; i++) {
        float an = float(i) * 1.0471976 + 0.31;
        vec2 dir = vec2(cos(an), sin(an));
        float df = dot(dir, fall);
        float w = pow(abs(df), 6.0);
        float c = dot(p, vec2(-dir.y, dir.x)) / 0.12;
        float lane = floor(c);
        vec2 rn = hash22(vec2(lane * 1.37 + float(i) * 31.0, 3.1));
        float L = 0.6 + 1.0 * rn.y;
        float ph = (dot(p, dir) * sign(df) + uTime * (0.16 + 0.3 * rn.x)) / L + rn.x * 7.0;
        float fs = fract(ph) * L;                         // metres uphill of the nearest seed's head
        float dx = (c - lane - 0.5) * 0.12;
        float dh = min(fs, L - fs);
        float head = exp(-(dx * dx + dh * dh) / (r * r));
        float tail = exp(-dx * dx / (r * r * 0.6)) * exp(-fs / 0.03) * 0.3;
        acc += (head + tail) * step(0.3, rn.y) * min(1.0, 0.007 / r) * w;
        wsum += w;
      }
      flow = acc / max(wsum, 1e-4) * sl;
    }
    // near a lamp the field is the light: rings of equal brightness around it
    float rc = log(max(length(p - uLamp.xz), 0.05)) * 5.5;
    float frc = fwidth(rc);
    float ring = aaLine(rc, frc, 1.3) * (1.0 - smoothstep(0.3, 0.7, frc));
    vec3 field = vec3(0.4, 0.62, 1.0) * (lines * uField.x * 0.3 + flow * uField.z * 3.0) + vec3(1.0, 0.6, 0.28) * ring * uField.y * 0.5;
    col += field * near * 0.2;
  }

  col = applyAir(col, -V, dist);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Tiling fractal noise with its own gradient, so the micro relief costs two fetches instead of a page of hashing.
function grainTexture(rnd) {
  const n = 256;
  const h = new Float32Array(n * n);
  let amp = 1;
  for (let cells = 8; cells <= 64; cells *= 2, amp *= 0.55) {
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * cells, fy = (y / n) * cells;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        let tx = fx - ix, ty = fy - iy;
        tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
        ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
        const x1 = (ix + 1) % cells, y1 = (iy + 1) % cells;
        const a = lat[iy * cells + ix], b = lat[iy * cells + x1], c = lat[y1 * cells + ix], d = lat[y1 * cells + x1];
        h[y * n + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
  }
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < h.length; i++) {
    lo = Math.min(lo, h[i]);
    hi = Math.max(hi, h[i]);
  }
  const data = new Uint8Array(n * n * 4);
  const at = (x, y) => (h[((y + n) % n) * n + ((x + n) % n)] - lo) / (hi - lo);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      data[i] = Math.max(0, Math.min(255, 127.5 + (at(x + 1, y) - at(x - 1, y)) * 900));
      data[i + 1] = Math.max(0, Math.min(255, 127.5 + (at(x, y + 1) - at(x, y - 1)) * 900));
      data[i + 2] = at(x, y) * 255;
      data[i + 3] = rnd() * 255;
    }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function clipGrid(M, hole) {
  const n = M + 1;
  const pos = new Float32Array(n * n * 3);
  let k = 0;
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      pos[k++] = x - M / 2;
      pos[k++] = 0;
      pos[k++] = z - M / 2;
    }
  const idx = [];
  for (let z = 0; z < M; z++)
    for (let x = 0; x < M; x++) {
      const x0 = x - M / 2, z0 = z - M / 2;
      if (hole && x0 >= -hole && x0 + 1 <= hole && z0 >= -hole && z0 + 1 <= hole) continue;
      const a = z * n + x, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return geo;
}

export class Terrain {
  constructor(ctx, land, env) {
    const lvl = ctx.quality.level;
    const M = (this.M = lvl >= 2 ? 160 : lvl === 1 ? 144 : 112);
    this.s0 = lvl >= 2 ? 0.05 : lvl === 1 ? 0.06 : 0.075;
    this.levels = 9;
    this.scene = new THREE.Scene();
    const full = ctx.track(clipGrid(M, 0));
    const ring = ctx.track(clipGrid(M, M / 4 - 2));
    this.uniforms = {
      ...land.uniforms,
      ...env,
      tGrain: { value: ctx.track(grainTexture(ctx.rng(29))) },
      uSkyUp: { value: new THREE.Color(0.1, 0.155, 0.26) },
      uKeyDir: { value: new THREE.Vector3(0.6, 0.45, 0.6).normalize() },
      uKeyCol: { value: new THREE.Color(0.2, 0.31, 0.5) },
      uHero: { value: new THREE.Vector4(0, 0, 0, 3) },
      uField: { value: new THREE.Vector4(1, 0, 1, 0) },
      uProbe: { value: new THREE.Vector4(0, 0, 2, 0) },
      uPixelAngle: { value: 0.001 },
      uThatch: { value: lvl > 0 ? 1 : 0 },
      uGrass: { value: new THREE.Vector3(0, 0, 6) },
    };
    const defines = { SHADOW_STEPS: lvl >= 1 ? 7 : 5, MIRROR_STEPS: lvl >= 2 ? 14 : 10, MIRROR_RATIO: lvl >= 2 ? '1.6' : '1.95' };
    if (lvl >= 1) defines.STONES = 1;
    this.material = ctx.track(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, defines }));
    this.meshes = [];
    for (let l = 0; l < this.levels; l++) {
      const m = new THREE.Mesh(l === 0 ? full : ring, this.material);
      m.frustumCulled = false;
      m.renderOrder = l;
      m.scale.set(this.s0 * 2 ** l, 1, this.s0 * 2 ** l);
      this.scene.add(m);
      this.meshes.push(m);
    }
    this._f = new THREE.Vector3();
  }

  update(camera) {
    const f = camera.getWorldDirection(this._f);
    const fl = Math.hypot(f.x, f.z) || 1;
    const cx = camera.position.x + (f.x / fl) * 1.2, cz = camera.position.z + (f.z / fl) * 1.2;
    for (let l = 0; l < this.levels; l++) {
      const s = this.s0 * 2 ** l;
      const m = this.meshes[l];
      m.position.set(Math.round(cx / (2 * s)) * 2 * s, 0, Math.round(cz / (2 * s)) * 2 * s);
      m.updateMatrixWorld();
    }
  }
}

// ---- sky: drawn after the terrain at the far plane, so it only costs where the land does not cover it
export const SKY_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }
`;
export const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform mat4 uInvVP;
uniform float uPixelAngle;
uniform vec3 uSkyUp;
uniform float uSunDisc;
${LAND}
${AIR}
void main() {
  vec4 f = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(f.xyz / f.w - uCam);
  vec3 col;
  float t = 40.0;
  if (rd.y < 0.0) {
    // beyond the last of the mesh: open water to the horizon
    vec3 R = vec3(rd.x, -rd.y + 0.002, rd.z);
    float F = 0.02 + 0.98 * pow(1.0 - min(-rd.y, 1.0), 5.0);
    col = mix(vec3(0.0012, 0.0026, 0.0055) + uSkyUp * 0.01, skyBase(R), F);
    t = min((uCam.y - WATER) / max(-rd.y, 1e-4), 2500.0);
  } else {
    col = skyBase(rd) + starField(rd, uPixelAngle);
    float sd = dot(rd, normalize(uSunDir));
    col += vec3(1.0, 0.5, 0.2) * uSunDisc * smoothstep(0.99996, 0.99998, sd);
  }
  col = applyAir(col, rd, t);
  gl_FragColor = vec4(col, 1.0);
}
`;

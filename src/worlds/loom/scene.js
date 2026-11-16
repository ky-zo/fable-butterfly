// What is solid, and what is behind everything:
//
//   backdrop   the fogged glass at dawn, out of focus: a cool green-grey band of garden, a low warm glow, the soft
//              shadows of glazing bars, beads of condensation as discs of light. One function of a ray (also what the
//              dew and the chrysalis hold in themselves).
//   bar        the steel glazing bar the pad is spun under
//   chrysalis  the solid thing under the winding: dark at first, mirror-bright at the end

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { PANE_Z, GLOW, BAR_Y, CHRYS_C } from './story.js';
import { chrysPoint } from './web.js';

const f = (x) => Number(x).toFixed(4);

/** vec3 backdrop(vec3 ro, vec3 rd): the light arriving along a ray. uDawn = (garden, cool panes, warm glow, -). */
export const BACKDROP_GLSL = /* glsl */ `
uniform vec4 uDawn;
vec3 backdropAt(vec2 h, out vec3 lit){
  // fog on glass: nothing behind it has an edge
  float n1 = sin(h.x * 1.3 + 1.7 * sin(h.y * 0.9)) * sin(h.y * 1.7 + 0.5 + 1.3 * sin(h.x * 0.7));
  float n2 = sin(h.x * 3.1 + 2.0 + 0.8 * sin(h.y * 2.1)) * sin(h.y * 2.3 + 1.0);
  // the garden beyond: a cool green-grey band
  float bandY = exp(-pow((h.y + 0.15) / 1.05, 2.0));
  vec3 green = vec3(0.021, 0.035, 0.03) * (0.72 + 0.4 * n1 + 0.18 * n2) * bandY;
  // dawn: low and warm
  vec2 dg = (h - vec2(${f(GLOW.x)}, ${f(GLOW.y)})) * vec2(1.0, 1.3);
  float r2 = dot(dg, dg);
  vec3 warm = vec3(1.0, 0.47, 0.17) * (0.2 * exp(-r2 / 0.1) + 0.085 * exp(-r2 / 0.6) + 0.022 * exp(-r2 / 3.5));
  // the panes higher up hold only the sky
  vec3 cool = vec3(0.016, 0.025, 0.031) * smoothstep(0.1, 2.0, h.y) * (0.8 + 0.25 * n1);
  lit = green * uDawn.x + warm * uDawn.z + cool * uDawn.y;
  // glazing bars, as soft as everything else
  vec2 gf = abs(fract(vec2(h.x / 0.9, (h.y - 0.25) / 1.25)) - 0.5);
  float bars = (1.0 - 0.4 * smoothstep(0.38, 0.5, gf.x)) * (1.0 - 0.32 * smoothstep(0.41, 0.5, gf.y));
  float ends = (1.0 - 0.85 * smoothstep(2.6, 6.0, abs(h.x))) * (1.0 - 0.9 * smoothstep(2.3, 4.2, h.y)) * (1.0 - 0.9 * smoothstep(-1.3, -3.2, h.y));
  lit *= ends;
  return lit * bars;
}
vec3 backdrop(vec3 ro, vec3 rd){
  float tz = (${f(PANE_Z)} - ro.z) / min(rd.z, -1e-3);
  vec3 lit;
  vec3 c = backdropAt(ro.xy + rd.xy * tz, lit);
  return vec3(0.004, 0.007, 0.007) + c * smoothstep(0.02, 0.3, -rd.z);
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
${hash}
${BACKDROP_GLSL}
void main(){
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vDir);
  vec3 col = backdrop(ro, rd);
  // condensation on the pane, far out of focus: discs of whatever light is behind them
  float tz = (${f(PANE_Z)} - ro.z) / min(rd.z, -1e-3);
  vec2 h = ro.xy + rd.xy * tz;
  float facing = smoothstep(0.02, 0.3, -rd.z);
  for (int k = 0; k < 2; k++) {
    float cell = k == 0 ? 0.3 : 0.17;
    vec2 q = h / cell + float(k) * 13.7;
    vec2 id = floor(q);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = id + vec2(float(i), float(j));
      vec3 r = hash32(g + 7.3);
      if (r.z > 0.36) continue;
      vec2 c = (g + 0.15 + 0.7 * r.xy) * cell;
      float rad = cell * (0.2 + 0.5 * hash12(g + 3.1));
      float d = length(h - float(k) * 13.7 * cell - c) / rad;
      if (d >= 1.0) continue;
      vec3 lit;
      backdropAt(c, lit);
      float disc = smoothstep(1.0, 0.8, d) * (0.75 + 0.35 * smoothstep(0.5, 0.95, d));
      col += lit * disc * (0.2 + 5.0 * r.z * r.z) * facing * (k == 0 ? 0.5 : 0.36);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const SOLID_VERT = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vLocal = position;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BAR_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vN;
${hash}
${BACKDROP_GLSL}
uniform float uPadGlow;
float vn(vec2 p){ vec2 i = floor(p), fr = fract(p); fr = fr * fr * (3.0 - 2.0 * fr);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), fr.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), fr.x), fr.y); }
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  vec2 p = vWorld.xy * vec2(1.0, 4.0) + vWorld.z * 3.0;
  float n = vn(p * 26.0) * 0.6 + vn(p * 90.0) * 0.4;
  float big = vn(p * 3.0 + 4.0);
  // old paint over steel; rust where the paint has let go, mostly along the lower edge where the water gathers
  float low = smoothstep(${f(BAR_Y + 0.02)}, ${f(BAR_Y)}, vWorld.y);
  float rust = smoothstep(0.58, 0.8, big * 0.6 + n * 0.4 + low * 0.28);
  vec3 paint = vec3(0.03, 0.04, 0.038) * (0.7 + 0.6 * n);
  vec3 alb = mix(paint, vec3(0.04, 0.03, 0.024) * (0.5 + n), rust * 0.6);
  float rough = mix(0.35, 0.85, rust);
  // light: the cool panes behind and above, the warm low glow from below, both soft
  vec3 R = reflect(-V, normalize(N + (vec3(n, big, n) - 0.5) * 0.25));
  vec3 env = backdrop(vWorld, normalize(vec3(R.xy, -abs(R.z) - 0.25)));
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 amb = vec3(0.05, 0.075, 0.085) * (0.5 + 0.5 * N.y) * uDawn.y + vec3(0.07, 0.05, 0.035) * max(-N.y, 0.0) * uDawn.z + vec3(0.03, 0.04, 0.04) * max(N.z, 0.0);
  vec3 col = alb * amb * 7.0 + env * fres * (1.0 - rough) * 3.5;
  // the lower arris catches what light there is; it sweats
  float edge = smoothstep(${f(BAR_Y + 0.0022)}, ${f(BAR_Y + 0.0002)}, vWorld.y) * max(N.z, 0.0);
  float bead = step(0.93, hash12(floor(vWorld.xx * vec2(410.0, 61.0)))) * smoothstep(0.5, 0.0, abs(fract(vWorld.x * 410.0) - 0.5));
  col += (vec3(0.05, 0.075, 0.08) * uDawn.y + vec3(0.1, 0.05, 0.02) * uDawn.z) * edge * (0.35 + 1.6 * bead);
  // and the silk under it glows on the steel
  float dp = length(vWorld.xz) ;
  col += vec3(0.5, 0.42, 0.3) * uPadGlow * exp(-dp * dp / 0.004) * (0.3 + 0.7 * max(-N.y, 0.0) + 0.3 * max(N.z, 0.0)) * (0.6 + 0.4 * n);
  gl_FragColor = vec4(col, 1.0);
}`;

const CHRYS_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vN;
${hash}
${BACKDROP_GLSL}
uniform vec4 uChrys;   // x there, y chrome, z how far down the winding has come, w -
void main(){
  float sAt = (${f(CHRYS_C.y + 0.0375)} - vWorld.y) / 0.075;
  if (uChrys.x < 0.5 || sAt > uChrys.z) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, N);
  // a mirror: the panes, the garden's band and the low glow, bent round it. What faces the lens reflects the dark
  // room behind the lens, so the picture is a bright rim round a dark middle — as chrome is.
  vec3 env = backdrop(vWorld, normalize(vec3(R.xy, -abs(R.z) - 0.02))) * (R.z < 0.0 ? 1.0 : 0.22);
  env += vec3(0.05, 0.08, 0.09) * pow(max(R.y, 0.0), 2.0) * uDawn.y + vec3(0.9, 0.5, 0.2) * pow(max(dot(R, normalize(vec3(0.5, -0.45, -0.75))), 0.0), 24.0) * uDawn.z;
  float fres = 0.6 + 0.4 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 col = vec3(0.004, 0.005, 0.005) + env * fres * vec3(0.95, 0.98, 1.0) * 5.5 * uChrys.y;
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildScene(ctx) {
  const uDawn = { value: new THREE.Vector4(1, 0.6, 1, 0) };
  const scene = new THREE.Scene();

  // ---- backdrop: one triangle over everything, at the far plane
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  ctx.track(tri);
  const skyU = { uDawn, uInvVP: { value: new THREE.Matrix4() } };
  const sky = new THREE.Mesh(
    tri,
    ctx.track(
      new THREE.ShaderMaterial({
        uniforms: skyU,
        vertexShader: /* glsl */ `
          uniform mat4 uInvVP;
          varying vec3 vDir;
          void main(){
            vec4 w = uInvVP * vec4(position.xy, 1.0, 1.0);
            vDir = w.xyz / w.w - cameraPosition;
            gl_Position = vec4(position.xy, 1.0, 1.0);
          }`,
        fragmentShader: SKY_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    ),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  // ---- the glazing bar: a T, the flange underneath
  const barU = { uDawn, uPadGlow: { value: 0 } };
  const barMat = ctx.track(new THREE.ShaderMaterial({ uniforms: barU, vertexShader: SOLID_VERT, fragmentShader: BAR_FRAG }));
  const web = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(12, 0.07, 0.012)), barMat);
  web.position.set(0, BAR_Y + 0.008 + 0.035, 0);
  const flange = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(12, 0.008, 0.05)), barMat);
  flange.position.set(0, BAR_Y + 0.004, 0);
  scene.add(web, flange);

  // ---- the chrysalis under the winding
  const NS = 56;
  const NT = 36;
  const pos = new Float32Array((NS + 1) * (NT + 1) * 3);
  const idx = [];
  const p = [];
  for (let i = 0; i <= NS; i++)
    for (let j = 0; j <= NT; j++) {
      chrysPoint(Math.pow(i / NS, 0.9) * 0.999 + 0.0005, (j / NT) * Math.PI * 2, 0, p);
      pos.set(p, (i * (NT + 1) + j) * 3);
      if (i < NS && j < NT) {
        const a = i * (NT + 1) + j;
        idx.push(a, a + 1, a + NT + 1, a + 1, a + NT + 2, a + NT + 1);
      }
    }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  cg.setIndex(idx);
  cg.computeVertexNormals();
  ctx.track(cg);
  const chrysU = { uDawn, uChrys: { value: new THREE.Vector4(0, 0, 0, 0) } };
  const chrys = new THREE.Mesh(cg, ctx.track(new THREE.ShaderMaterial({ uniforms: chrysU, vertexShader: SOLID_VERT, fragmentShader: CHRYS_FRAG, side: THREE.DoubleSide })));
  chrys.frustumCulled = false;
  scene.add(chrys);

  const _vp = new THREE.Matrix4();
  return {
    scene,
    uDawn,
    barU,
    chrysU,
    chrys,
    setCamera(cam) {
      _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      skyU.uInvVP.value.copy(_vp).invert();
    },
  };
}
export { CHRYS_C };

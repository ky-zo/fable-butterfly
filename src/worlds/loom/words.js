// Words riding on the strands (this world's signature, kept): on whatever is pulled tight, the animal's own plain word
// for the thing at the far end slides along the strand toward it. Small, set along the thread, and only there while the
// strand is attended to.

import * as THREE from 'three';
import { hash } from '../../core/glsl.js';
import { STRAND_GLSL } from './silk.js';
import { G } from './story.js';

const WORDS = ['leaf', 'water', 'light', 'glass', 'before'];
const ROW_H = 96;
const ROW_W = 512;

const VERT = /* glsl */ `
precision highp float;
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iP;
attribute vec4 iW;               // word, where it starts along the strand, speed, width / height of its row used
${hash}
${STRAND_GLSL}
uniform float uFocus, uK, uMaxCoc, uPxPerM, uNearClip, uAspect, uShow;
uniform float uAtt[5];
varying vec2 vUv;
varying float vA;
void main(){
  int gi = int(iB.w + 0.5);
  vec4 g = uGroup[gi];
  float att = uAtt[gi] * uShow;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (att < 0.02) return;
  Strand s = strandOf(iA, iB, iP);
  // toward the animal, and round again
  float f = fract(iW.y - uTime * iW.z);
  float t = mix(0.86, 0.1, f);
  vec3 T;
  vec3 P = strandPoint(s, t, T);
  vec4 c0 = projectionMatrix * viewMatrix * vec4(P, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(P + normalize(T) * 0.01, 1.0);
  if (c0.w < uNearClip * 2.0) return;
  vec2 dir = (c1.xy / c1.w - c0.xy / c0.w) * vec2(uAspect, 1.0);
  dir = normalize(dir + vec2(1e-6, 0.0));
  if (dir.x < 0.0) dir = -dir;
  vec2 nrm = vec2(-dir.y, dir.x);
  float d = c0.w;
  float coc = min(uK * abs(1.0 - uFocus / d), uMaxCoc);
  float hpx = 0.0105 * uPxPerM / d;          // half the height of the row, px
  // (too small to read, or too soft: it is not there)
  float a = att * smoothstep(0.0, 0.12, f) * (1.0 - smoothstep(0.82, 1.0, f)) * smoothstep(5.0, 9.0, hpx) * (1.0 - smoothstep(26.0, 40.0, hpx)) / (1.0 + coc * coc * 0.12);
  if (a < 0.01) return;
  vec2 off = dir * position.x * hpx * iW.w + nrm * (position.y * hpx + hpx * 1.25);
  c0.xy += off * vec2(1.0 / uAspect, 1.0) * projectionMatrix[1][1] / uPxPerM * c0.w;
  gl_Position = c0;
  vUv = vec2((position.x * 0.5 + 0.5) * iW.w * ${(ROW_H / ROW_W).toFixed(5)}, 1.0 - (iW.x + 0.5 - position.y * 0.5) / ${WORDS.length}.0);
  vA = a * (0.6 + 0.4 * s.tau);
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tWords;
varying vec2 vUv;
varying float vA;
void main(){
  float m = texture2D(tWords, vUv).r;
  if (m * vA < 0.004) discard;
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.66) * m * vA * 1.5, 1.0);
}`;

export async function buildWords(ctx, shared, web) {
  const font = `italic 400 ${Math.round(ROW_H * 0.66)}px "Newsreader Variable", Georgia, serif`;
  try {
    await document.fonts.load(font);
  } catch {}
  const cv = document.createElement('canvas');
  cv.width = ROW_W;
  cv.height = ROW_H * WORDS.length;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#fff';
  g.font = font;
  g.textBaseline = 'middle';
  const widths = WORDS.map((w, i) => {
    g.fillText(w, 8, i * ROW_H + ROW_H * 0.52);
    return g.measureText(w).width + 16;
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  ctx.track(tex);
  await ctx.yield();

  const rnd = ctx.rng(88);
  const A = [];
  const B = [];
  const P = [];
  const W = [];
  const per = [0, 0, 0, 0, 0];
  const want = [5, 3, 6, 6, 3];
  for (const it of web.list) {
    const gi = it.B[3];
    if (gi > G.PAD || per[gi] >= want[gi] || rnd() < 0.72) continue;
    per[gi]++;
    A.push(...it.A);
    B.push(...it.B);
    P.push(...it.P);
    W.push(gi, rnd(), 0.018 + 0.014 * rnd(), widths[gi] / ROW_H);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(A), 4));
  geo.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(B), 4));
  geo.setAttribute('iP', new THREE.InstancedBufferAttribute(new Float32Array(P), 4));
  geo.setAttribute('iW', new THREE.InstancedBufferAttribute(new Float32Array(W), 4));
  geo.instanceCount = W.length / 4;
  ctx.track(geo);
  const uniforms = { ...shared, tWords: { value: tex }, uAtt: { value: [0, 0, 0, 0, 0] }, uAspect: { value: 1 }, uShow: { value: 1 } };
  const mesh = new THREE.Mesh(
    geo,
    ctx.track(
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        depthTest: true,
        depthWrite: false,
        transparent: true,
      }),
    ),
  );
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return {
    mesh,
    update(att, show, cam) {
      for (let i = 0; i < 5; i++) uniforms.uAtt.value[i] = att[i];
      uniforms.uAspect.value = cam.aspect;
      uniforms.uShow.value = show;
    },
  };
}

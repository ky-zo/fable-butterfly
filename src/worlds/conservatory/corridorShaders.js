// Shading for everything opaque inside the corridor: painted steel, brass, the stone curb.
// There are no three.js lights here. The corridor is lit by its own glass: each wall is a big soft area light whose
// colour is passed in as uGlow[], plus whatever direct sun makes it through the frame, the fog and the leaves.

import { hash } from '../../core/glsl.js';
import { layoutGLSL } from './layout.js';
import { sunGLSL } from './sun.js';
import { shadowGLSL } from '../../shared/butterfly/shadow.js';

/** Lighting shared by steel, floor, props. Needs layout + sun chunks before it. */
export const corridorLightGLSL = /* glsl */ `
${shadowGLSL('SUN_DIR')}
uniform vec3 uGlow[7];
vec3 paneIrradiance(vec3 P, vec3 N){
  // each glass plane as a half-space light: form factor (1 + cos) / 2
  float endW = 0.35 * clamp(6.0 / max(P.z - ZE, 1.0), 0.0, 1.0);
  return uGlow[0] * (0.5 - 0.5 * N.x) + uGlow[1] * (0.5 + 0.5 * N.x)
       + (uGlow[3] + uGlow[4]) * 0.5 * (0.5 + 0.5 * N.y)
       + uGlow[2] * (0.5 - 0.5 * N.z) * endW
       + uGlow[5] * (0.5 - 0.5 * N.y);
}
vec3 envRefl(vec3 P, vec3 R, float soft){
  int ri;
  float rt = hullExit(P, R, 7, ri);
  vec3 rp = P + R * rt;
  vec3 c = uGlow[ri];
  if (ri < 5) c *= 0.18 + 0.82 * frameOpen(ri, rp, soft);
  return c;
}
float sunAt(vec3 P){ return sunInto(P, 0.01) * shadowHard(P) * bfShadow(P); }
// The same, for surfaces the visitor can fly right up to (the steel): four lookups a texel apart, so that the edge of a
// leaf's shadow on a mullion is a soft line and not the sun map's own staircase.
float sunAtSoft(vec3 P){
  vec3 a = normalize(cross(SUN_DIR, vec3(0.0, 1.0, 0.0))) * 0.008;
  vec3 b = cross(SUN_DIR, a);
  float s = 0.25 * (shadowHard(P + a + b * 0.5) + shadowHard(P - a - b * 0.5) + shadowHard(P + b - a * 0.5) + shadowHard(P - b + a * 0.5));
  return sunInto(P, 0.012) * s * bfShadow(P);
}
`;

export const SOLID_VERT = /* glsl */ `
attribute vec2 aDim;      // physical size of the face this vertex belongs to (m)
attribute float aKind;    // material id
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec2 vDim;
varying float vKind;
void main(){
  vUv = uv; vDim = aDim; vKind = aKind;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const SOLID_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec2 vDim;
varying float vKind;
uniform sampler2D tNoise;
uniform float uTime;
${hash}
${layoutGLSL}
${sunGLSL}
${corridorLightGLSL}
void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  // triplanar noise lookups in world space
  vec3 an = abs(N);
  vec2 tp = an.x > an.y && an.x > an.z ? vWorld.zy : (an.y > an.z ? vWorld.xz : vWorld.xy);
  vec4 n1 = texture2D(tNoise, tp * 0.7);
  vec4 n2 = texture2D(tNoise, tp * 5.3);
  vec4 n3 = texture2D(tNoise, tp * 31.0);
  // distance to the nearest edge of this face, in metres
  vec2 ed = min(vUv, 1.0 - vUv) * vDim;
  float edge = min(ed.x, ed.y);

  vec3 alb; float rough, metal;
  int kind = int(vKind + 0.5);
  if (kind == 0) {
    // old gloss paint over steel: chips at the arrises, rust blooming out of the joints and running down
    alb = vec3(0.028, 0.055, 0.045) * (0.6 + 0.8 * n1.g);
    rough = 0.42 + 0.25 * n2.g; metal = 0.0;
    float jy = min(min(abs(vWorld.y - TRANSOM), abs(vWorld.y - Y0)), abs(vWorld.y - EAVE));
    float joint = smoothstep(0.16, 0.0, jy);
    float run = texture2D(tNoise, vec2(tp.x * 9.0, tp.y * 0.9)).g;                 // streaks follow gravity
    float chipW = min(0.004 + 0.007 * n2.r, 0.22 * min(vDim.x, vDim.y));
    float chip = smoothstep(chipW, 0.0, edge) * smoothstep(0.56, 0.72, n2.g + n3.g * 0.3);
    float bloom = smoothstep(0.7, 0.86, n1.r * 0.5 + n2.g * 0.3 + joint * 0.3 + run * 0.1);
    float rust = clamp(max(chip * 0.85, bloom * (0.35 + 0.65 * joint)), 0.0, 1.0);
    vec3 rustC = mix(vec3(0.07, 0.03, 0.014), vec3(0.03, 0.016, 0.01), n3.g);
    alb = mix(alb, rustC, rust);
    rough = mix(rough, 0.92, rust);
    // paint blisters around the rust
    N = normalize(N + (vec3(n3.r, n3.g, n3.a) - 0.5) * (0.06 + 0.5 * rust));
  } else if (kind == 1) {
    // brass gone dull, bright where hands or water keep it clean
    alb = mix(vec3(0.55, 0.36, 0.12), vec3(0.16, 0.2, 0.12), smoothstep(0.35, 0.75, n1.g + n2.g * 0.4));
    rough = 0.28 + 0.35 * n2.r; metal = 1.0;
    N = normalize(N + (vec3(n3.r, n3.g, n3.a) - 0.5) * 0.08);
  } else if (kind == 2) {
    // stone curb, damp, algae in the pores
    alb = mix(vec3(0.055, 0.052, 0.048), vec3(0.1, 0.095, 0.085), n2.g) * (0.6 + 0.6 * n1.r);
    alb = mix(alb, vec3(0.02, 0.05, 0.018), smoothstep(0.5, 0.8, n1.g + n2.r * 0.3) * 0.7);
    rough = 0.6 + 0.3 * n2.g; metal = 0.0;
    N = normalize(N + (vec3(n3.r, n3.g, n3.a) - 0.5) * 0.35);
  } else {
    // enamel, glass of the dead lamp
    alb = vec3(0.02, 0.03, 0.028) * (0.7 + 0.6 * n1.g);
    rough = 0.18 + 0.2 * n2.g; metal = 0.0;
  }

  vec3 E = paneIrradiance(vWorld, N);
  // (the soft lookup only where the lens is close enough to see the difference)
  float sv = dot(cameraPosition - vWorld, cameraPosition - vWorld) < 1.7 ? sunAtSoft(vWorld + N * 0.01) : sunAt(vWorld + N * 0.01);
  vec3 sun = SUN_COL * sv * max(dot(N, SUN_DIR), 0.0);
  // contact darkening in the corner where a bar meets the glass
  float ao = mix(0.55, 1.0, smoothstep(0.0, 0.03, edge));
  vec3 col = alb * (1.0 - metal) * (E * ao + sun * 0.5);
  vec3 R = reflect(-V, N);
  float NdV = max(dot(N, V), 0.0);
  vec3 F0 = mix(vec3(0.04), alb, metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
  vec3 env = envRefl(vWorld + N * 0.003, R, 0.03 + rough * 0.5);
  col += mix(env, vec3(dot(env, vec3(0.3, 0.5, 0.2))), 0.45) * F * (1.0 - rough * 0.75) * (1.0 - rough * 0.75) * ao * (kind == 0 ? 0.4 : 0.7);
  // sun glint
  vec3 H = normalize(SUN_DIR + V);
  float a2 = pow(max(rough, 0.08), 4.0);
  float nh = max(dot(N, H), 0.0);
  float dd = nh * nh * (a2 - 1.0) + 1.0;
  col += SUN_COL * sv * F * (a2 / (3.14159 * dd * dd)) * max(dot(N, SUN_DIR), 0.0) * 0.25;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

export const FLOOR_VERT = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Wet stone. The reflection is exact for what it reflects: the floor is flat and the corridor is a box, so the mirrored
// ray's hit point on the glass is known analytically — project it back to the screen and read what was drawn there
// (one frame ago, so that the floor can be drawn in the same pass as the walls it mirrors).
export const FLOOR_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
uniform sampler2D tNoise;
uniform sampler2D tScene;      // the corridor as it stood a frame ago, at half resolution, with its mip chain
uniform mat4 uViewProj;
uniform float uTime;
${hash}
${layoutGLSL}
${sunGLSL}
${corridorLightGLSL}
float height(vec2 p, out float joint, out vec2 cellId){
  // flagstones: long slabs across the corridor, staggered
  vec2 g = vec2(p.x / 0.575 + 2.0, p.y / 0.86);
  g.x += mod(floor(g.y), 2.0) * 0.5;
  cellId = floor(g);
  vec2 f = fract(g);
  vec2 e = min(f, 1.0 - f) * vec2(0.575, 0.86);
  float d = min(e.x, e.y);
  joint = smoothstep(0.012, 0.003, d);
  float tilt = (hash12(cellId) - 0.5) * 0.004 + dot(f - 0.5, hash22(cellId + 3.0) - 0.5) * 0.006;
  return tilt - joint * 0.006;
}
void main(){
  vec2 p = vWorld.xz;
  vec4 n1 = texture2D(tNoise, p * 0.13);
  vec4 n2 = texture2D(tNoise, p * 1.1);
  vec4 n3 = texture2D(tNoise, p * 7.0);
  float joint; vec2 cid;
  float h = height(p, joint, cid) + (n1.r - 0.5) * 0.014 + (n2.g - 0.5) * 0.0025;
  // standing water where the stone is low
  float level = 0.0006;
  float puddle = smoothstep(level + 0.0007, level - 0.0005, h);
  float wet = clamp(puddle + 0.45 + 0.55 * n1.g, 0.0, 1.0);
  vec3 stone = mix(vec3(0.02, 0.022, 0.023), vec3(0.055, 0.053, 0.048), n2.g * 0.7 + n3.g * 0.3) * (0.6 + 0.8 * hash12(cid + 9.0));
  stone = mix(stone, vec3(0.014, 0.022, 0.012), joint * 0.8 + smoothstep(0.55, 0.8, n1.b * 0.3 + n2.r) * 0.3);
  stone *= mix(1.0, 0.45, wet);                                      // wet stone is darker
  vec3 N = normalize(vec3((n3.r - 0.5) * 0.1 + (n2.r - 0.5) * 0.08, 1.0, (n3.a - 0.5) * 0.1 + (n2.a - 0.5) * 0.08));
  // puddles are flat, with a slow tremor
  vec2 rip = vec2(sin(p.y * 31.0 + uTime * 0.7 + n2.r * 6.0), cos(p.x * 27.0 - uTime * 0.6 + n2.g * 6.0)) * 0.004;
  N = normalize(mix(N, vec3(rip.x, 1.0, rip.y), puddle));
  float rough = mix(0.45 + 0.3 * n3.g, 0.02, puddle) * mix(1.0, 0.5, wet);

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 E = paneIrradiance(vWorld, N);
  float sv = sunAt(vWorld + vec3(0.0, 0.01, 0.0));
  vec3 col = stone * (E + SUN_COL * sv * max(dot(N, SUN_DIR), 0.0) * 0.6);

  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 1e-3;
  int ri; float rt = hullExit(vWorld + vec3(0.0, 0.002, 0.0), R, 7, ri);
  vec3 rp = vWorld + R * rt;
  vec4 cp = uViewProj * vec4(rp, 1.0);
  vec2 suv = cp.xy / cp.w * 0.5 + 0.5;
  float onScreen = step(0.0, cp.w) * smoothstep(0.0, 0.06, suv.x) * smoothstep(1.0, 0.94, suv.x) * smoothstep(0.0, 0.06, suv.y) * smoothstep(1.0, 0.94, suv.y);
  float blur = clamp(rough * rt * 1.6, 0.0, 1.0);
  vec3 refl = textureLod(tScene, suv, blur).rgb;
  vec3 fallback = envRefl(vWorld + vec3(0.0, 0.002, 0.0), R, 0.03 + rough * 0.4);
  refl = mix(fallback, refl, onScreen);
  float NdV = max(dot(N, V), 0.0);
  float F = 0.025 + 0.975 * pow(1.0 - NdV, 5.0);
  col = mix(col, refl, F * mix(0.5, 1.0, puddle) * (1.0 - rough * 0.6));
  // the rim of a puddle: a thin dark line where the stone is soaked, a bright one where the meniscus catches the panes
  float rim = smoothstep(0.0, 0.5, puddle) * smoothstep(1.0, 0.5, puddle);
  col *= 1.0 - 0.35 * rim;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

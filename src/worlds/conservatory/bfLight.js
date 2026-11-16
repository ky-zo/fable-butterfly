// How this world lights the butterfly (the kit's materials ask a "light rig" for it: see shared/butterfly/light.js).
// Two rigs, because there are two kinds of light here:
//   inside   the corridor: the walls are the lamps (uGlow), plus whatever sun gets in past frame, fog and leaves
//   outside  the garden: the sun, the sky, the ground — and like every garden surface it reports q (how far behind
//            the pane it is) in alpha

import { hash } from '../../core/glsl.js';
import { layoutGLSL } from './layout.js';
import { sunGLSL } from './sun.js';
import { corridorLightGLSL } from './corridorShaders.js';

const common = /* glsl */ `
${hash}
${layoutGLSL}
${sunGLSL}
#define BF_SUN_DIR SUN_DIR
#define BF_SUN_COL SUN_COL
`;

/** @param U the world's uniform bag */
export function insideLight(U) {
  return {
    uniforms: U,
    common,
    vertex: /* glsl */ `
// The key. Two parts of the same sun: the beam that gets through frame, fog and leaves whole — and, for anything close
// to a fogged pane, the far larger part the fog took out of the beam, which leaves the glass again as a broad soft lobe
// about the sun's direction. A bar a hand wide does not stop that, the shadow of a leaf lying on the pane does, and a
// few hand-widths into the room it has become the plain glow of the wall (which paneIrradiance already counts).
uniform sampler2D tBfPane0, tBfPane2;     // how much sun lands on the fog of the sunlit wall, of the end wall (sun.js: FrostScreen)
float bfSunVisV(vec3 P){
  float beam = sunInto(P, 0.02) * shadowHard(P);
  // (the picture is exposed for fogged glass, and the one whole shaft of sun is sixteen times that: full on the animal
  // it lifts black velvet to brown and bleaches the ember to peach. So the animal takes a quarter of it — what a
  // colourist would do with a flag — and stays itself in the brightest frame of the piece)
  beam = min(beam, 0.2 + 0.08 * beam);
  int idx;
  float t = hullExit(P, SUN_DIR, 5, idx);
  if (idx != 0 && idx != 2) return beam;
  vec3 Q = P + SUN_DIR * t;
  vec2 uv = wallST(idx, Q) / wallSize(idx);
  float fog = 0.9;
  if (idx == 0) { vec4 fs = texture2D(tFogL, uv); fog = fs.r * fs.a; }
  // (the lobe gathers from a patch of pane a hand wide: five taps)
  vec2 e = vec2(0.07) / wallSize(idx);
  float lit = 0.0;
  if (idx == 0) lit = texture2D(tBfPane0, uv).r * 0.4 + 0.15 * (texture2D(tBfPane0, uv + e).r + texture2D(tBfPane0, uv - e).r + texture2D(tBfPane0, uv + e * vec2(1.0, -1.0)).r + texture2D(tBfPane0, uv - e * vec2(1.0, -1.0)).r);
  else lit = texture2D(tBfPane2, uv).r * 0.4 + 0.15 * (texture2D(tBfPane2, uv + e).r + texture2D(tBfPane2, uv - e).r + texture2D(tBfPane2, uv + e * vec2(1.0, -1.0)).r + texture2D(tBfPane2, uv - e * vec2(1.0, -1.0)).r);
  // (where a leaf's shadow lies on the pane the fog there is still lit by the haze and the sky around the sun: a third)
  float lobe = frameOpen(idx, Q, 0.03 + t * 0.4) * mix(0.45, 1.0, fog * fog) * (1.0 - uFogBeam) * 0.5 * mix(0.33, 1.0, lit) / (1.0 + t * t * 14.0);
  return max(beam, lobe);
}
`,
    fragment: /* glsl */ `
${corridorLightGLSL}
uniform vec4 uBfBounce;        // rgb: green thrown back by leaves that touch the glass nearby (hero.js); a: which side they are on (-1 left … +1 right)
uniform vec3 uBfKey;           // fill from the pale room behind the lens; gain on the glow of the panes; on reflections
vec3 bfAmb(vec3 P, vec3 N){
  vec3 a = paneIrradiance(P, N) + uBfBounce.rgb * (0.5 + 0.5 * N.x * uBfBounce.a);
  // (fill: this is a white room full of fog — the floor, the far wall and the roof behind the lens all give a little back)
  vec3 toLens = normalize(cameraPosition - P);
  a += (uGlow[3] + uGlow[4]) * 0.5 * uBfKey.x * (0.5 + 0.5 * dot(N, toLens));
  return a * uBfKey.y;
}
vec3 bfEnv(vec3 P, vec3 R, float soft){ return envRefl(P, R, soft) * uBfKey.z; }
vec3 bfEyeKey(){ return (uGlow[3] + uGlow[4]) * 1.6; }
vec4 bfFinish(vec3 col, float a, vec3 P){ return vec4(col, a); }
`,
  };
}

/**
 * What a pane gives back of it: the same light, added to the picture (alpha 0) at the strength glass reflects at that
 * angle. For the mirror image the hero keeps behind the pane it stands on (hero.js).
 */
export function mirrorLight(U) {
  const inside = insideLight(U);
  return {
    ...inside,
    fragment: inside.fragment.replace('vec4 bfFinish(vec3 col, float a, vec3 P){ return vec4(col, a); }', /* glsl */ `
uniform vec4 uBfMirror;        // xyz: the pane's normal, w: how much of the reflection there is
vec4 bfFinish(vec3 col, float a, vec3 P){
  float c = abs(dot(normalize(cameraPosition - P), uBfMirror.xyz));
  return vec4(col * (0.08 + 0.92 * pow(1.0 - c, 5.0)) * uBfMirror.w, 0.0);
}`),
  };
}

export function outsideLight(U) {
  return {
    uniforms: U,
    common,
    vertex: /* glsl */ `
float bfSunVisV(vec3 P){ return shadow1(P + SUN_DIR * 0.03); }
`,
    fragment: /* glsl */ `
uniform vec3 uSky, uBounce, uHaze;
uniform float uHazeDensity;
vec3 bfAmb(vec3 P, vec3 N){ return mix(uBounce, uSky, 0.5 + 0.5 * N.y) + vec3(0.1, 0.09, 0.07) * step(abs(P.x), HW + 0.02) ; }
// (toward the sun the garden and the haze over it are far brighter than the sky's average: what is seen from inside
// against that — the border of one that has settled on the pane — has light coming through it)
vec3 bfEnv(vec3 P, vec3 R, float soft){ return mix(uBounce * 0.6, uSky * 1.5, smoothstep(-0.2, 0.6, R.y)) + SUN_COL * 0.16 * pow(max(dot(R, SUN_DIR), 0.0), 3.0); }
vec3 bfEyeKey(){ return uSky * 1.4; }
vec4 bfFinish(vec3 col, float a, vec3 P){
  vec3 ray = P - cameraPosition;
  float q = paneQ(cameraPosition, P);
  float hz = 1.0 - exp(-length(ray) * q * uHazeDensity);
  return vec4(mix(col, hazeColor(normalize(ray), uHaze), hz), q);
}
`,
  };
}

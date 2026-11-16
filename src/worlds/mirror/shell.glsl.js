// Mirror — the inside of the shell: a room. `shellEnv(ro, rd, blur)` is the light arriving along a ray from the wall
// of the chrysalis seen from within: thin cuticle with the day coming through it.
//
// The sunlit pane is a hand's width behind one side, so that side is gold, and where the sun itself stands behind the
// wall there is a small hot place; the roof and the corridor are above and on the other side, so those are cool, and
// much less of it; underneath is dark. What is seen is the wall's own thickness, held against that light:
//   · the rings of the abdomen overhead, each segment thin in its middle and dark in its suture
//   · low on either side of the front, the wing cases, where the venation of the wings to come is already pressed
//     into the shell (the kit's own veins and margin: plate.glsl.js bakes them). The mould is there before the metal
//     is poured
//   · a tuft of air tubes from the spiracle of each segment, silver, as air under cuticle is
// `blur` is the angular footprint of the ray: everything is pre-filtered by it, so the same function draws the room
// behind the liquid out of focus, and the room bent small in the liquid without a sparkle.

import * as THREE from 'three';
import { fieldGLSL } from './plate.glsl.js';

export function shellUniforms() {
  return {
    uShWarm: { value: new THREE.Vector3(2.4, 1.6, 0.8) },
    uShCool: { value: new THREE.Vector3(0.2, 0.3, 0.36) },
    tShN: { value: null }, // tileable noise (noiseTex.js)
    tWF: { value: null }, // the wings' field (plate.glsl.js)
  };
}

export const shellGLSL = /* glsl */ `
#ifndef MR_SHELL
#define MR_SHELL
uniform vec3 uShWarm, uShCool;
uniform sampler2D tShN, tWF;
${fieldGLSL}
const vec3 SH_C = vec3(0.0, 0.5, 0.0);
const vec3 SH_R = vec3(3.9, 5.6, 3.9);
const vec3 SH_SUN = vec3(0.4965, 0.1192, -0.8598);     // the low sun, in the chrysalis's own axes
const vec3 SH_SKY = vec3(-0.3363, 0.7206, 0.6063);
vec3 shellEnv(vec3 ro, vec3 rd, float blur){
  blur = clamp(blur, 0.0, 0.5);
  vec3 o = (ro - SH_C) / SH_R, d = rd / SH_R;
  float a = dot(d, d), b = dot(o, d), c = dot(o, o) - 1.0;
  float t = (-b + sqrt(max(b * b - a * c, 0.0))) / a;
  vec3 Q = ro + rd * t;
  vec3 n = normalize((Q - SH_C) / (SH_R * SH_R));
  float w = max(blur * t, 0.003);
  float s = 0.5 - (Q.y - SH_C.y) / (2.0 * SH_R.y);                // 0 the top … 1 the bottom
  float ang = atan(Q.z, Q.x);
  float am = ang + 1.5708;                                         // round from the front, where the wing cases meet
  am = am > 3.14159 ? am - 6.28318 : am;
  float aa = abs(am);

  // ---- the day outside, as thin cuticle lets it through
  float sun = dot(n, SH_SUN), sp = max(sun, 0.0);
  float sig = 0.003 + 0.03 * w * w;
  float hot = 9.0 * exp(-(1.0 - sun) / sig) * (0.003 / sig) + 1.15 * exp(-(1.0 - sun) / (0.035 + sig));
  float sp2 = sp * sp;
  vec3 warm = uShWarm * (0.008 + 0.035 * sp + 0.4 * sp2 * sp2 * sp2 * sp2 + hot);
  float sk = max(dot(n, SH_SKY), 0.0);
  float sk2 = sk * sk;
  vec3 cool = uShCool * (0.09 + 1.5 * sk2 + 3.2 * sk2 * sk2 * sk2);

  // ---- the wall: how much of that it passes
  vec2 uv = vec2(ang * 0.62, s * 3.6);
  vec4 n1 = textureLod(tShN, uv * 0.21, log2(max(w * 14.0, 1.0)));
  float tr = 0.6 + 0.8 * n1.r;
  // rings of the abdomen: thin in the middle of a segment, a dark suture between two
  float fw = w * 0.8;
  float fr = abs(fract(s * 9.0 + 0.05 * sin(ang * 3.0) + 0.03 * n1.g) - 0.5);
  float seg = (0.66 + 0.34 * cos(6.28318 * fr)) * (1.0 - 0.28 * smoothstep(0.36 - fw, 0.5, fr) * (0.14 / (0.14 + fw)));
  float rib = smoothstep(0.42, 0.3, s) * smoothstep(0.0, 0.06, s);
  tr *= mix(1.0, mix(seg, 0.62, smoothstep(0.12, 0.5, fw)) * 1.3, rib);
  // the wing cases: the venation is in the shell already. Their roots are low, by the thorax; they reach up the front
  vec2 mm = vec2((0.84 - s) * 62.0, aa * 16.0 - 10.3);
  float inW = 0.0;
  if (mm.x > -1.4 && mm.x < 30.4 && mm.y > -8.9 && mm.y < 4.9) {
    vec2 f = textureLod(tWF, wfUV(mm, 0.0), 0.0).rg;
    float pw = w * 4.5;                                            // the footprint, in millimetres of wing
    inW = smoothstep(-0.2 - pw, 0.2 + pw, f.r);
    float vein = smoothstep(0.16 + pw, -0.1 - 0.3 * pw, f.g) * (0.6 / (0.6 + pw));
    float band = smoothstep(1.1 + pw, 0.0, f.r) * (1.0 / (1.0 + pw));
    tr *= mix(1.0, (1.75 - 1.5 * vein) * (1.0 - 0.6 * band), inW);
  }
  tr *= 0.62 + 0.38 * inW;
  vec3 col = (warm + cool) * tr;
  // air tubes: two trunks down each flank, and a twig off them into every segment. Silver, as air under cuticle is
  float sgx = s * 9.0 + 0.3;
  float tk = min(abs(aa - 1.5 - 0.05 * sin(s * 17.0)), abs(aa - 2.25 - 0.07 * sin(s * 12.0 + 1.0))) * 3.6;
  float tw = 0.026;
  float fade = smoothstep(0.08, 0.02, w) * smoothstep(0.03, 0.12, s) * smoothstep(0.97, 0.8, s);
  float tube = smoothstep(tw + w, tw * 0.3, tk) * (tw / (tw + 2.0 * w));
  float twl = (aa - 1.5) * 3.6;                                    // along a twig, from the first trunk forward
  float twig = smoothstep(0.012 + w, 0.003, abs(fract(sgx) - 0.5 - 0.12 * twl * twl) * 1.24) * smoothstep(-1.5, -0.2, twl) * step(twl, 0.0) * (0.012 / (0.012 + 2.0 * w));
  tube = max(tube, twig) * fade;
  col = col * (1.0 - 0.3 * tube) + (uShCool * 1.5 + uShWarm * (0.1 + 0.5 * sp2)) * 0.5 * tube;
  // what is underneath gives nothing, and the stalk end is black
  col *= (0.28 + 0.72 * smoothstep(1.02, 0.55, s)) * (0.35 + 0.65 * smoothstep(0.0, 0.09, s));
  // the fluid between is not quite clear
  vec3 fluid = uShWarm * 0.02 + uShCool * 0.03;
  return mix(fluid, col, exp(-t * 0.045));
}
#endif
`;

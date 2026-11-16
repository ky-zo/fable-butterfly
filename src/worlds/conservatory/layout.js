// Conservatory — shared dimensions, the corridor hull, the sun, and the GLSL that every shader in this world agrees on.
//
// The corridor runs along -Z. x = ±HW are the two glass walls (left = sunlit, right = shade), z = ZE is the end pane,
// the roof is two pitched planes meeting at the ridge. Everything that is "garden" lives OUTSIDE this convex hull,
// everything that is "corridor" lives inside it.

import * as THREE from 'three';

export const HW = 1.15; // half width
export const Y0 = 0.14; // top of the curb = bottom edge of the glass
export const EAVE = 2.95;
export const RIDGE = 3.72;
export const ZB = 1.0; // start of the simulated walls (behind the first camera position)
export const ZE = -14.0; // end wall
export const ZBACK = 4.0; // where the corridor is closed behind the visitor
export const BAY = 1.0; // mullion spacing
export const TRANSOM = 2.24; // height of the horizontal glazing bar

export const WALL_LEN = ZB - ZE; // 15 m
export const WALL_H = EAVE - Y0; // 2.81 m
export const END_W = HW * 2;

// direction TO the sun (low, ahead and to the left)
export const SUN_DIR = new THREE.Vector3(-0.6, 0.4, -0.69).normalize();
export const SUN_COLOR = new THREE.Vector3(1.0, 0.66, 0.36); // warm, late
export const SUN_POWER = 16.0;

const rl = Math.hypot(RIDGE - EAVE, HW);
const rnx = (RIDGE - EAVE) / rl;
const rny = HW / rl;

/** Hull planes as [nx, ny, nz, h] with n·X <= h inside. Order matters: 0 left, 1 right, 2 end, 3 roofL, 4 roofR, 5 floor, 6 back. */
export const HULL = [
  [-1, 0, 0, HW],
  [1, 0, 0, HW],
  [0, 0, -1, -ZE],
  [-rnx, rny, 0, rny * RIDGE],
  [rnx, rny, 0, rny * RIDGE],
  [0, -1, 0, 0],
  [0, 0, 1, ZBACK],
];

/** The three simulated walls. A wall point = origin + u * s + v * t (metres). */
export const WALLS = [
  { id: 0, name: 'left', origin: new THREE.Vector3(-HW, Y0, ZB), u: new THREE.Vector3(0, 0, -1), v: new THREE.Vector3(0, 1, 0), n: new THREE.Vector3(1, 0, 0), w: WALL_LEN, h: WALL_H },
  { id: 1, name: 'right', origin: new THREE.Vector3(HW, Y0, ZB), u: new THREE.Vector3(0, 0, -1), v: new THREE.Vector3(0, 1, 0), n: new THREE.Vector3(-1, 0, 0), w: WALL_LEN, h: WALL_H },
  { id: 2, name: 'end', origin: new THREE.Vector3(-HW, Y0, ZE), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0), n: new THREE.Vector3(0, 0, 1), w: END_W, h: WALL_H },
];

const f = (x) => {
  const s = Number(x).toFixed(6);
  return s.includes('.') ? s : `${s}.0`;
};

/** GLSL: constants + hull + wall mapping + the analytic steel frame. Include-guarded. */
export const layoutGLSL = /* glsl */ `
#ifndef CV_LAYOUT
#define CV_LAYOUT
#define HW ${f(HW)}
#define Y0 ${f(Y0)}
#define EAVE ${f(EAVE)}
#define RIDGE ${f(RIDGE)}
#define ZB ${f(ZB)}
#define ZE ${f(ZE)}
#define BAY ${f(BAY)}
#define TRANSOM ${f(TRANSOM)}
#define WALL_LEN ${f(WALL_LEN)}
#define WALL_H ${f(WALL_H)}
#define END_W ${f(END_W)}
const vec3 SUN_DIR = vec3(${f(SUN_DIR.x)}, ${f(SUN_DIR.y)}, ${f(SUN_DIR.z)});
const vec3 SUN_COL = vec3(${f(SUN_COLOR.x)}, ${f(SUN_COLOR.y)}, ${f(SUN_COLOR.z)}) * ${f(SUN_POWER)};
const vec4 HULL[7] = vec4[7](
${HULL.map((p) => `  vec4(${p.map(f).join(', ')})`).join(',\n')}
);

// Distance along (o + d t) at which a ray that starts inside the corridor leaves it; idx = the plane it leaves through.
// n = how many planes to consider (5 = glass only, 7 = with floor and back wall).
float hullExit(vec3 o, vec3 d, int n, out int idx){
  float tmin = 1e9; idx = -1;
  for (int i = 0; i < 7; i++) {
    if (i >= n) break;
    float dn = dot(HULL[i].xyz, d);
    if (dn > 1e-6) {
      float t = (HULL[i].w - dot(HULL[i].xyz, o)) / dn;
      if (t < tmin) { tmin = t; idx = i; }
    }
  }
  return tmin;
}

// Fraction of the camera→P segment that lies BEHIND the glass (0 = on the pane, →1 = infinitely far behind it).
// This single number is what the frosted blur and the camera defocus of everything seen through glass are built on.
float paneQ(vec3 cam, vec3 P){
  vec3 d = P - cam;
  float tmin = 1.0;
  for (int i = 0; i < 5; i++) {
    float dn = dot(HULL[i].xyz, d);
    if (dn > 1e-6) tmin = min(tmin, (HULL[i].w - dot(HULL[i].xyz, cam)) / dn);
  }
  return clamp(1.0 - tmin, 0.0, 1.0);
}

// wall coordinates in metres for a point on wall idx (0 left, 1 right, 2 end)
vec2 wallST(int idx, vec3 P){
  return idx == 2 ? vec2(P.x + HW, P.y - Y0) : vec2(ZB - P.z, P.y - Y0);
}
vec2 wallSize(int idx){ return idx == 2 ? vec2(END_W, WALL_H) : vec2(WALL_LEN, WALL_H); }

// Analytic steel: 1 = open glass, 0 = behind a bar. soft = edge softness in metres. Planes 0..4.
float frameOpen(int idx, vec3 P, float soft){
  float m = 1.0;
  if (idx <= 1) {
    float s = ZB - P.z;
    float ds = abs(fract(s / BAY + 0.5) - 0.5) * BAY;
    m *= smoothstep(0.026 - soft, 0.026 + soft, ds);
    m *= smoothstep(0.022 - soft, 0.022 + soft, abs(P.y - TRANSOM));
    m *= smoothstep(Y0 - soft, Y0 + soft, P.y);
  } else if (idx == 2) {
    m *= smoothstep(0.05 - soft, 0.05 + soft, HW - abs(P.x));
    m *= smoothstep(Y0 - soft, Y0 + soft, P.y);
    m *= smoothstep(0.03 - soft, 0.03 + soft, abs(P.y - EAVE));
  } else {
    float s = ZB - P.z;
    float ds = abs(fract(s / BAY + 0.5) - 0.5) * BAY;
    m *= smoothstep(0.022 - soft, 0.022 + soft, ds);
    m *= smoothstep(0.03 - soft, 0.03 + soft, abs(abs(P.x) - 0.58));
    m *= smoothstep(0.04 - soft, 0.04 + soft, abs(P.x));
  }
  return m;
}
#endif
`;

/** CPU twin of hullExit. Returns { t, idx } for a ray starting inside the hull. */
export function hullExit(o, d, n = 5) {
  let tmin = Infinity;
  let idx = -1;
  for (let i = 0; i < n; i++) {
    const p = HULL[i];
    const dn = p[0] * d.x + p[1] * d.y + p[2] * d.z;
    if (dn > 1e-6) {
      const t = (p[3] - (p[0] * o.x + p[1] * o.y + p[2] * o.z)) / dn;
      if (t < tmin) {
        tmin = t;
        idx = i;
      }
    }
  }
  return { t: tmin, idx };
}

/** World point → wall (s, t) in metres. */
export function wallST(idx, P, out) {
  if (idx === 2) out.set(P.x + HW, P.y - Y0);
  else out.set(ZB - P.z, P.y - Y0);
  return out;
}

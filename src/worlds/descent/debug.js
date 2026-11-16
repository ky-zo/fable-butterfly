// Development aid: a top-down survey view of the land with marks on it (the lamp, the flight line, the lens).
// Enable from the tools with:  --eval "__hl.app.cur.world.debugTop = 1; __hl.step(1)"   (2 = wider, 3 = with the far ranges)

import * as THREE from 'three';
import { FSPass } from '../../core/Pass.js';
import { LAND } from './chunks.js';

export function makeDebugTop(land) {
  const pass = new FSPass(
    /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform float uAspect, uExtent;
    uniform vec2 uCentre;
    uniform vec3 uMarks[96];
    ${LAND}
    void main(){
      vec2 p = uCentre + vec2((vUv.x * 2.0 - 1.0) * uAspect, -(vUv.y * 2.0 - 1.0)) * uExtent;   // north (-z) up
      vec4 L = land(p);
      vec3 n = normalize(vec3(-L.y, 1.0, -L.z));
      float sh = clamp(dot(n, normalize(vec3(-0.5, 0.7, -0.5))), 0.0, 1.0);
      vec3 c = vec3(0.04 + 0.5 * sh * sh) * L.w * L.w;
      c *= 0.55 + 0.45 * smoothstep(0.0, 14.0, L.x);
      float hc = L.x / 3.0;
      float fw = fwidth(hc);
      float line = 1.0 - smoothstep(0.0, 1.5, abs(fract(hc - 0.5) - 0.5) / fw);
      float idx = 1.0 - smoothstep(0.0, 1.5, abs(fract(hc / 5.0 - 0.5) - 0.5) / (fw / 5.0));
      c = mix(c, vec3(0.5, 0.6, 0.75), 0.3 * line + 0.5 * idx);
      if (L.x < WATER) c = vec3(0.02, 0.07, 0.16) + 0.05 * (L.x + 2.0);
      // a 5 m grid, heavier every 10
      vec2 gq = abs(fract(p / 15.0 - 0.5) - 0.5) / fwidth(p / 15.0);
      vec2 g10 = abs(fract(p / 30.0 - 0.5) - 0.5) / fwidth(p / 30.0);
      c += vec3(0.1) * (1.0 - smoothstep(0.0, 1.0, min(gq.x, gq.y))) + vec3(0.2, 0.1, 0.0) * (1.0 - smoothstep(0.0, 1.2, min(g10.x, g10.y)));
      c += vec3(0.5, 0.0, 0.0) * (1.0 - smoothstep(0.0, 1.5, min(abs(p.x), abs(p.y)) / fwidth(p.x)));
      for (int i = 0; i < 96; i++) {
        float d = length(p - uMarks[i].xy);
        float r = abs(uMarks[i].z);
        c = mix(c, uMarks[i].z > 0.5 ? vec3(1.0, 0.8, 0.2) : vec3(0.3, 1.0, 0.5), smoothstep(r * 0.4 + 0.1, r * 0.4, d) * step(0.001, r));
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
    {
      ...land.uniforms,
      uAspect: { value: 1 },
      uExtent: { value: 36 },
      uCentre: { value: new THREE.Vector2(0, 0) },
      uMarks: { value: Array.from({ length: 96 }, () => new THREE.Vector3()) },
    },
  );
  return {
    pass,
    centre: pass.uniforms.uCentre.value,
    extent: 0,
    setMarks(points) {
      const m = pass.uniforms.uMarks.value;
      for (let i = 0; i < 96; i++) {
        const q = points[i];
        if (q) m[i].set(q[0], q[1], q[2] ?? 0.2);
        else m[i].set(0, 0, 0);
      }
    },
    render(renderer, target, mode, aspect) {
      pass.uniforms.uAspect.value = aspect;
      pass.uniforms.uExtent.value = this.extent || (mode > 2.5 ? 450 : mode > 1.5 ? 114 : 60);
      pass.render(renderer, target);
    },
    dispose() {
      pass.dispose();
    },
  };
}

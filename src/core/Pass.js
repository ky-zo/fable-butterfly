import * as THREE from 'three';

// One oversized triangle covers the screen with no diagonal seam.
const TRI = new THREE.BufferGeometry();
TRI.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
TRI.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
const CAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * Fullscreen shader pass.
 *
 *   const pass = new FSPass(fragmentShader, { tSrc: { value: null }, uTime: { value: 0 } });
 *   pass.uniforms.tSrc.value = someTarget.texture;
 *   pass.render(renderer, destTarget);           // destTarget = null → screen
 *
 * The fragment shader gets `varying vec2 vUv` (0..1, origin bottom-left). Write to gl_FragColor.
 * Extra ShaderMaterial options (blending, transparent, defines, glslVersion …) go in `opts`.
 */
export class FSPass {
  constructor(fragmentShader, uniforms = {}, opts = {}) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: opts.vertexShader || FS_VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      ...opts,
    });
    this.uniforms = this.material.uniforms;
    this.mesh = new THREE.Mesh(TRI, this.material);
    this.mesh.frustumCulled = false;
  }

  /** @param clear pass true to clear the destination first (only matters when the pass blends). */
  render(renderer, target = null, clear = false) {
    const prevAuto = renderer.autoClear;
    renderer.autoClear = clear;
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, CAM);
    renderer.autoClear = prevAuto;
  }

  /** Compile this pass's shader without blocking the main thread: `await pass.compile(ctx.renderer)` in init(). */
  compile(renderer) {
    return renderer.compileAsync(this.mesh, CAM);
  }

  dispose() {
    this.material.dispose();
  }
}

import * as THREE from 'three';
import { clamp } from './util.js';

const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

const toV3 = (p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]));

function keyframe(keys, t) {
  if (typeof keys === 'number') return keys;
  if (!keys || keys.length === 0) return 0;
  if (keys.length === 1) return keys[0];
  const x = clamp(t, 0, 1) * (keys.length - 1);
  const i = Math.min(keys.length - 2, Math.floor(x));
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return keys[i] + (keys[i + 1] - keys[i]) * s;
}

/**
 * A camera rail: the camera glides along a spline as `frame.progress` goes 0 → 1, looking at a second spline,
 * while the pointer turns the head a little and a slow sway keeps it alive.
 *
 *   this.rail = new Rail({
 *     points:  [[0,1.6,8], [0.5,1.5,4], [-0.4,1.4,0.5]],   // camera positions; key i is reached at progress i/(n-1)
 *     targets: [[0,1.4,0], [0,1.3,-2], [0.6,1.2,-4]],       // look-at points, spread evenly over progress
 *     fov: [38, 34, 42],                                     // optional keyframes (vertical degrees) or a number
 *     roll: [0, 0.02, 0],                                    // optional keyframes (radians)
 *     look: { yaw: 0.22, pitch: 0.12 },                      // how far the pointer can turn the camera (radians)
 *     parallax: 0.15,                                        // pointer also slides the camera sideways (world units)
 *     sway: { amp: 0.012, freq: 0.11 },                      // handheld breathing
 *   });
 *   // each frame:
 *   this.rail.apply(this.camera, frame);
 */
export class Rail {
  constructor(o = {}) {
    const pts = (o.points || [[0, 0, 5], [0, 0, 0]]).map(toV3);
    this.pos = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    this.tgt = o.targets && o.targets.length > 1 ? new THREE.CatmullRomCurve3(o.targets.map(toV3), false, 'centripetal', 0.5) : null;
    this.fixedTarget = o.targets && o.targets.length === 1 ? toV3(o.targets[0]) : null;
    this.fov = o.fov ?? null;
    this.roll = o.roll ?? null;
    this.look = { yaw: 0.2, pitch: 0.12, ...(o.look || {}) };
    this.parallax = o.parallax ?? 0.0;
    this.sway = { amp: 0.01, freq: 0.12, ...(o.sway || {}) };
    this.ease = o.ease || null;
    /** Results of the last apply(), handy for focus pulls etc. */
    this.position = new THREE.Vector3();
    this.target = new THREE.Vector3();
  }

  /** Sample the un-offset rail. */
  sample(p, outPos = _pos, outTarget = _tgt) {
    let t = clamp(p, 0, 1);
    if (this.ease) t = this.ease(t);
    this.pos.getPoint(t, outPos);
    if (this.tgt) this.tgt.getPoint(t, outTarget);
    else if (this.fixedTarget) outTarget.copy(this.fixedTarget);
    else {
      this.pos.getTangent(t, outTarget).add(outPos);
    }
    return outPos;
  }

  apply(camera, frame) {
    const p = frame.progress;
    const t = frame.time;
    this.sample(p, _pos, _tgt);
    this.position.copy(_pos);
    this.target.copy(_tgt);

    camera.position.copy(_pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(_tgt);

    const px = frame.pointer ? frame.pointer.sx : 0;
    const py = frame.pointer ? frame.pointer.sy : 0;
    const f = this.sway.freq * Math.PI * 2;
    const sx = (Math.sin(t * f) + 0.5 * Math.sin(t * f * 2.31 + 1.7)) * this.sway.amp;
    const sy = (Math.sin(t * f * 0.83 + 4.1) + 0.5 * Math.sin(t * f * 1.93 + 0.3)) * this.sway.amp;

    _e.set(py * this.look.pitch + sy, -px * this.look.yaw + sx, keyframe(this.roll, p) + sx * 0.25);
    _q.setFromEuler(_e);
    camera.quaternion.multiply(_q);

    if (this.parallax) {
      _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(_right, px * this.parallax).addScaledVector(_up, py * this.parallax * 0.6);
    }

    if (this.fov != null && camera.isPerspectiveCamera) {
      const fov = keyframe(this.fov, p);
      if (Math.abs(camera.fov - fov) > 1e-4) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    }
    camera.updateMatrixWorld(true);
  }
}

export { keyframe };

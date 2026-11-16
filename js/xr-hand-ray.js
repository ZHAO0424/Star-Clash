// 手部射线:每只手一根,起点和方向取 runtime 给的 targetRaySpace(aim,不用 grip),过 One Euro 滤波。
// 只负责"射线在哪、画出来";什么时候显示、两只手谁来指、点到什么,由 xr.js 决定。
//
//   const ray = new HandRay(scene);
//   每帧 ray.update(controller, dt) → THREE.Ray | null(没追踪到);ray.show(hitDistance | null)

import * as THREE from 'three';

// ── One Euro 滤波(Casiez 2012):慢动时强去抖,快动时几乎不加延迟 ──
// 搬自 D:\viture\webxr\extension\xr\oneeuro.js(WebXR 空间网页插件,参数为那边的建议起始值,上机再调)。
// 2.2m 外手腕 0.5° 的抖动就是 2cm,不滤的话指小按钮时命中来回跳。
// 调法:先 beta = 0 调 minCutoff 到慢动不抖,再加大 beta 到快动不拖。
class OneEuro {
  constructor({ minCutoff = 1.0, beta = 0.0, dCutoff = 1.0 } = {}) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.x = null; this.dx = 0;
  }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  reset() { this.x = null; this.dx = 0; }
  filter(v, dt) {
    if (this.x == null || !(dt > 0)) { this.x = v; this.dx = 0; return v; }
    const dv = (v - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dv - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

// THREE.Vector3 逐分量滤波;normalize = true 时滤完重新归一(方向向量用)
class OneEuro3 {
  constructor(opts, normalize = false) {
    this.f = [new OneEuro(opts), new OneEuro(opts), new OneEuro(opts)];
    this.normalize = normalize;
  }
  reset() { for (const f of this.f) f.reset(); }
  filter(v, dt, out) {
    out.set(this.f[0].filter(v.x, dt), this.f[1].filter(v.y, dt), this.f[2].filter(v.z, dt));
    return this.normalize ? out.normalize() : out;
  }
}

const RAY_FILTER = {
  origin: { minCutoff: 1.0, beta: 5.0, dCutoff: 1.0 },
  dir: { minCutoff: 1.0, beta: 3.0, dCutoff: 1.0 },
  resetAfterS: 0.2,   // 手丢了超过 0.2s 再出现:从头滤,免得从旧位置"滑过来"
};
const COLOR = 0x5ac8ff;

export class HandRay {
  constructor(scene) {
    this.origin = new OneEuro3(RAY_FILTER.origin);
    this.dir = new OneEuro3(RAY_FILTER.dir, true);
    this.ray = new THREE.Ray();
    this.lost = Infinity;
    this.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: COLOR, transparent: true, opacity: 0.85 })
    );
    this.line.renderOrder = 30;
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.004, 0.0065, 24),
      new THREE.MeshBasicMaterial({ color: COLOR, depthTest: false, transparent: true, side: THREE.DoubleSide })
    );
    this.cursor.renderOrder = 31;
    this.cursor.visible = false;
    scene.add(this.line, this.cursor);
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._d = new THREE.Vector3();
  }

  // controller = renderer.xr.getController(i)(手部追踪时就是 targetRaySpace)
  update(controller, dt) {
    if (!controller.visible) {
      this.lost += dt;
      return null;
    }
    if (this.lost > RAY_FILTER.resetAfterS) { this.origin.reset(); this.dir.reset(); }
    this.lost = 0;
    controller.getWorldPosition(this._p);
    controller.getWorldQuaternion(this._q);
    this._d.set(0, 0, -1).applyQuaternion(this._q);
    this.origin.filter(this._p, dt, this.ray.origin);
    this.dir.filter(this._d, dt, this.ray.direction);
    return this.ray;
  }

  // distance:射线命中面板的距离;null = 不显示
  show(distance) {
    const visible = distance != null;
    this.line.visible = this.cursor.visible = visible;
    if (!visible) return;
    this.line.position.copy(this.ray.origin);
    this.line.quaternion.setFromUnitVectors(this._d.set(0, 0, -1), this.ray.direction);
    this.line.scale.set(1, 1, distance);
    this.ray.at(distance, this.cursor.position);
    this.cursor.quaternion.copy(this.line.quaternion);
  }
}

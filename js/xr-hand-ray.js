// 手部射线:每只手一根,起点和方向取 runtime 给的 targetRaySpace(aim,不用 grip)。
// 指针手感照搬 WebXR 空间网页插件(xr-pointer.js):射线稳定(5° / 5cm)、光标贴上面板的脉冲、深度变化限速、
// 「来回晃找光标」。第四轮起光标圈和射线只在指着可点目标(或正在找光标)时显示,空指时都隐藏。
// 只负责"射线在哪、画出来";两只手谁来指(HandArbiter)、点到什么,由 xr.js 决定。
//
//   const ray = new HandRay(scene);
//   每帧 ray.aim(controller, dt) → THREE.Ray | null(没追踪到)
//        ray.present({ active, hitDistance, headQ, now, dt, pinched })   // 算光标、找光标、画

import * as THREE from 'three';
import { Stabilizer, SeekDetector, CursorFx, seekAlpha } from './xr-pointer.js';

const COLOR = 0x5ac8ff;
const RESET_AFTER_S = 0.2;   // 手丢了超过 0.2s 再出现:从头来,免得从旧位置"滑过来"
const RING_REF_M = 0.5;      // 光标圈在 0.5m 处是原始大小,按距离缩放,看上去一样大

export class HandRay {
  constructor(scene) {
    this.ray = new THREE.Ray();
    this.lost = Infinity;
    this.reset();
    this.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: COLOR, transparent: true, opacity: 0 })
    );
    this.line.renderOrder = 30;
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.004, 0.0065, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, side: THREE.DoubleSide })
    );
    this.cursor.renderOrder = 31;
    this.cursor.visible = false;
    scene.add(this.line, this.cursor);
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._d = new THREE.Vector3();
  }

  reset() {
    this.stab = new Stabilizer();
    this.seek = new SeekDetector();
    this.cur = new CursorFx();
    this.seekA = 0;
    this.end = null;   // 上一帧射线的末端(命中点或光标所在处),射线稳定要用
  }

  // controller = renderer.xr.getController(i)(手部追踪时就是 targetRaySpace)
  aim(controller, dt) {
    if (!controller.visible) {
      this.lost += dt;
      return null;
    }
    if (this.lost > RESET_AFTER_S) this.reset();
    this.lost = 0;
    controller.getWorldPosition(this._p);
    controller.getWorldQuaternion(this._q);
    this._d.set(0, 0, -1).applyQuaternion(this._q);
    const o = { x: this._p.x, y: this._p.y, z: this._p.z }, d = { x: this._d.x, y: this._d.y, z: this._d.z };
    const end = this.end ?? { x: o.x + d.x * 2.5, y: o.y + d.y * 2.5, z: o.z + d.z * 2.5 };
    const s = this.stab.update(o, d, end, dt);
    this.ray.origin.set(s.o.x, s.o.y, s.o.z);
    this.ray.direction.set(s.d.x, s.d.y, s.d.z).normalize();
    return this.ray;
  }

  // active:这只手是当前在指的那只(不在近手操作);hitDistance:射线命中面板 / 战场的距离(没命中 null);
  // headQ:头的朝向;now 毫秒、dt 秒;pinched:捏着时光标变蓝
  present({ active, hitDistance = null, headQ, now, dt, pinched = false }) {
    if (!active) {
      this.line.visible = this.cursor.visible = false;
      this.seekA = 0;
      return;
    }
    const fx = this.cur.update(hitDistance, now, dt);
    const dist = hitDistance ?? fx.dist;
    this.ray.at(dist, this.cursor.position);
    this.end = { x: this.cursor.position.x, y: this.cursor.position.y, z: this.cursor.position.z };
    this.seek.update(this.ray.direction, headQ, now / 1000, dt);
    this.seekA = seekAlpha(this.seekA, this.seek.seeking(now / 1000) || fx.attached, dt);

    const facing = this._q.setFromUnitVectors(this._d.set(0, 0, -1), this.ray.direction);
    this.cursor.quaternion.copy(facing);
    this.cursor.scale.setScalar(Math.max(dist, 0.05) / RING_REF_M * fx.scale);
    this.cursor.material.color.setHex(pinched ? COLOR : 0xffffff);
    this.cursor.visible = fx.attached || this.seek.seeking(now / 1000);

    this.line.visible = this.seekA > 0.01;
    this.line.material.opacity = 0.85 * this.seekA;
    this.line.position.copy(this.ray.origin);
    this.line.quaternion.copy(facing);
    this.line.scale.set(1, 1, dist);
  }
}

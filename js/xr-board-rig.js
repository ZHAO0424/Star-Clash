// 双手操控战场:两手空捏保持 0.4s 后,旋转 / 升降 / 推拉战场(头显里不动相机,只动战场和挂在一起的整套 UI)。
// 场景层级:anchor → boardRig(本模块的 node)→ scene.world + uiPivot(手牌 / HUD / 大厅 / 设置等面板,见 xr.js 的 UI 换边)。
// node 默认是单位变换,所以不操控时一切和以前一样。
// 手势到偏移的换算、限幅、橡皮筋都在 xr-math.js(gestureRig / limitRig),这里只管状态和施加到节点上。
//
//   const rig = new BoardRig(anchor, () => world.position, saved, onSave);
//   rig.begin(left, right, forward) / rig.update(left, right) / rig.end()   // 参数都是 anchor 坐标
//   每帧 rig.tick(dt)(松手后越界部分弹回);rig.reset() 视角复位;rig.apply() 棋盘尺寸变了之后重新施加

import * as THREE from 'three';
import { ZERO_RIG, gestureRig, limitRig, sanitizeRig } from './xr-math.js';

const SPRING = 12;   // 松手后弹回边界的速度(1/s)
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class BoardRig {
  // getPivot():战场中心在 anchor 坐标里的位置(就是 world.position,随棋盘尺寸变);onSave(rig):持久化
  constructor(anchor, getPivot, saved, onSave) {
    this.node = new THREE.Group();
    this.node.name = 'xr:board-rig';
    anchor.add(this.node);
    this.getPivot = getPivot;
    this.onSave = onSave;
    this.rig = sanitizeRig(saved);
    this.target = null;   // 松手后弹回的目标
    this.start = null;    // 正在操控:抓取开始那一刻的快照
  }

  get active() { return Boolean(this.start); }

  base() {
    const pivot = this.getPivot();
    return { y: pivot.y, z: pivot.z };
  }

  begin(left, right, forward) {
    this.target = null;
    this.start = { rig: { ...this.rig }, left: left.clone(), right: right.clone(), forward: forward.clone() };
  }

  update(left, right) {
    if (!this.start) return;
    this.rig = limitRig(gestureRig(this.start, { left, right }), this.base(), true);
    this.apply();
  }

  end() {
    if (!this.start) return;
    this.start = null;
    this.target = limitRig(this.rig, this.base());
    this.onSave?.(this.target);
  }

  tick(dt) {
    if (!this.target) return;
    const k = 1 - Math.exp(-dt * SPRING);
    for (const key of ['yaw', 'x', 'y', 'z']) this.rig[key] += (this.target[key] - this.rig[key]) * k;
    if (['x', 'y', 'z'].every(key => Math.abs(this.target[key] - this.rig[key]) < 1e-4)) {
      this.rig = { ...this.target };
      this.target = null;
    }
    this.apply();
  }

  reset() {
    this.start = this.target = null;
    this.rig = { ...ZERO_RIG };
    this.onSave?.(this.rig);
    this.apply();
  }

  // 绕战场中心 P 转 yaw、再平移 (x, y, z):node.position = P + offset − R·P
  apply() {
    if (!this.start && !this.target) this.rig = limitRig(this.rig, this.base());
    const pivot = this.getPivot().clone();
    this.node.quaternion.setFromAxisAngle(Y_AXIS, this.rig.yaw);
    const rotated = pivot.clone().applyQuaternion(this.node.quaternion);
    this.node.position.copy(pivot).add(new THREE.Vector3(this.rig.x, this.rig.y, this.rig.z)).sub(rotated);
    this.node.updateMatrixWorld(true);
  }
}

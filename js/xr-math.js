// XR 手部交互的纯函数(不依赖 three.js,Node 里能直接测:node --test tests/)
// 向量一律是 { x, y, z },WebXR 坐标(右手系,y 朝上,-z 朝前),单位米。
//
//   手心菜单:palmNormal / handOpenness / hysteresis + PALM 阈值
//   双手操控:gestureRig(抓取开始的快照 + 当前双手 → 战场偏移)/ limitRig(限幅 + 橡皮筋)+ RIG 参数

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = a => Math.hypot(a.x, a.y, a.z);
const norm = a => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── 手心菜单 ──
// 掌心朝头的点积带回差(出现要更正对,消失要翻得更多);张开度阈值来自 weather-palm 的合成手标定
export const PALM = { FACE_ON: 0.55, FACE_OFF: 0.25, OPEN_ON: 1.55, OPEN_OFF: 1.42 };

// 掌心法线:(腕→食指掌骨)×(腕→小指掌骨)。右手这样算出来指向掌心,左手指向手背,要取反
export function palmNormal(wrist, indexMeta, pinkyMeta, side) {
  const n = norm(cross(sub(indexMeta, wrist), sub(pinkyMeta, wrist)));
  return side === 'left' ? { x: -n.x, y: -n.y, z: -n.z } : n;
}

// 张开度 = 四指尖到腕的平均距离 ÷ 腕到中指根(近节指骨)的距离;平摊约 1.9,握拳约 1.1。
// joints:关节名 → 位置;缺关节返回 0(当作没张开)
const TIPS = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
export function handOpenness(joints) {
  const wrist = joints.wrist, knuckle = joints['middle-finger-phalanx-proximal'];
  if (!wrist || !knuckle) return 0;
  const size = len(sub(knuckle, wrist));
  if (size < 1e-4) return 0;
  let sum = 0;
  for (const name of TIPS) {
    if (!joints[name]) return 0;
    sum += len(sub(joints[name], wrist));
  }
  return sum / TIPS.length / size;
}

// 回差开关:没开时超过 on 才开,开着时低于 off 才关(on > off)
export function hysteresis(active, value, on, off) {
  return active ? value > off : value > on;
}

// ── 双手操控战场 ──
// 战场偏移 rig = { yaw, x, y, z }:yaw 绕战场中心转,x/y/z 是战场中心在 anchor 坐标里的平移。
// base = { y, z }:不偏移时战场中心在 anchor 坐标里的高度和前后位置(z 为负,随棋盘尺寸变)
export const RIG = {
  HOLD: 0.4,                    // 两手空捏保持多久进入操控
  GAIN_DEPTH: 1.5,              // 手前后能动的距离只有横向的一半,深度给大增益
  GAIN_LATERAL: 0.5,
  GAIN_HEIGHT: 1,
  HEIGHT: [0.2, 0.8],           // 战场中心在头下 0.2–0.8m
  DISTANCE: [0.45, 1.1],        // 战场中心离头的水平距离
  LATERAL: 0.3,                 // 左右最多偏 30cm
  GIVE: 0.06,                   // 越界时最多再拉出 6cm(橡皮筋),松手弹回
};
export const ZERO_RIG = Object.freeze({ yaw: 0, x: 0, y: 0, z: 0 });

export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// 水平向量的朝向角:绕 +Y 转 θ 后角度加 θ(与 three 的 rotation.y 同号)
export function horizontalYaw(v) {
  return Math.atan2(-v.z, v.x);
}

// 观察者水平坐标系:f = 水平前方,r = 水平右方;forward 几乎竖直时退回 -z
export function viewerFrame(forward) {
  const h = Math.hypot(forward.x, forward.z);
  const f = h < 1e-4 ? { x: 0, y: 0, z: -1 } : { x: forward.x / h, y: 0, z: forward.z / h };
  return { f, r: { x: -f.z, y: 0, z: f.x } };
}

// start = { rig, left, right, forward }(抓取开始那一刻的偏移、双手位置、观察者朝向,都在 anchor 坐标里)
// now = { left, right } → 新的 rig(未限幅)
// 旋转 = 两手连线水平转角;平移 = 两手中点位移拆到观察者坐标系:深度 ×1.5、横向 ×0.5、高度 ×1
export function gestureRig(start, now) {
  const { f, r } = viewerFrame(start.forward);
  const d = sub(mid(now.left, now.right), mid(start.left, start.right));
  const depth = (d.x * f.x + d.z * f.z) * RIG.GAIN_DEPTH;
  const lateral = (d.x * r.x + d.z * r.z) * RIG.GAIN_LATERAL;
  const turn = wrapAngle(horizontalYaw(sub(now.right, now.left)) - horizontalYaw(sub(start.right, start.left)));
  return {
    yaw: wrapAngle(start.rig.yaw + turn),
    x: start.rig.x + f.x * depth + r.x * lateral,
    y: start.rig.y + d.y * RIG.GAIN_HEIGHT,
    z: start.rig.z + f.z * depth + r.z * lateral,
  };
}

// 橡皮筋:区间内原样;越界部分按 give 渐近压缩(永远拉不出 give)
export function rubber(v, lo, hi, give) {
  if (v > hi) { const e = v - hi; return hi + give * e / (e + give); }
  if (v < lo) { const e = lo - v; return lo - give * e / (e + give); }
  return v;
}

// 限幅:soft = true(操控中)用橡皮筋,false(松手后)硬夹到边界
export function limitRig(rig, base, soft = false) {
  const band = (v, lo, hi) => (soft ? rubber(v, lo, hi, RIG.GIVE) : clamp(v, lo, hi));
  const x = band(rig.x, -RIG.LATERAL, RIG.LATERAL);
  const centerY = band(base.y + rig.y, -RIG.HEIGHT[1], -RIG.HEIGHT[0]);
  let cx = x, cz = base.z + rig.z;
  const distance = Math.hypot(cx, cz);
  const limited = band(distance, RIG.DISTANCE[0], RIG.DISTANCE[1]);
  if (distance > 1e-6) { cx *= limited / distance; cz *= limited / distance; }
  else cz = -limited;
  return { yaw: wrapAngle(rig.yaw), x: cx, y: centerY - base.y, z: cz - base.z };
}

// 持久化读回的偏移做一次校验,坏数据当零
export function sanitizeRig(value) {
  if (!value || typeof value !== 'object') return { ...ZERO_RIG };
  const out = {};
  for (const k of ['yaw', 'x', 'y', 'z']) out[k] = Number.isFinite(value[k]) ? value[k] : 0;
  return out;
}

// ── 手部射线的"举手区"(第四轮)──
// 手(射线起点)在头部坐标里:高度在头下 0.55m 到头上 0.1m、前方 0.1–0.65m 之间才算"举起来在指";
// 垂在身侧、放在腿上、贴着脸都不出射线。范围取自 xr-pointer.js 的 FLEX 梯形区外沿
export const POINT_ZONE = { Y: [-0.55, 0.1], FORWARD: [0.1, 0.65] };
// local:手相对头的位置(已转到头部坐标,-z 朝前)
export function inPointingZone(local) {
  const forward = -local.z;
  return local.y >= POINT_ZONE.Y[0] && local.y <= POINT_ZONE.Y[1]
    && forward >= POINT_ZONE.FORWARD[0] && forward <= POINT_ZONE.FORWARD[1];
}

// ── UI 换边(第三轮)──
// 棋盘转过一定角度后,手牌 / HUD 等整套 UI 绕战场中心按 90° 吸附到面向用户的那条边。
// phi = wrap(头部水平朝向 − 棋盘朝向);current = 当前扇区(0..3,UI 绕战场中心转 current × 90°)。
// 离当前扇区中心超过 45° + hysteresis 才换到新扇区(默认 10°,即过 55° 才换),返回新扇区 0..3
export const UI_SIDE = { HYSTERESIS: Math.PI / 18, ANIM_S: 0.35 };
export function uiSector(phi, current, hysteresis = UI_SIDE.HYSTERESIS) {
  const d = wrapAngle(phi - current * Math.PI / 2);
  if (Math.abs(d) <= Math.PI / 4 + hysteresis) return current;
  return ((Math.round(phi / (Math.PI / 2)) % 4) + 4) % 4;
}

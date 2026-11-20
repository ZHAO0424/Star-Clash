// xr-math.js 单测:node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PALM, RIG, ZERO_RIG, palmNormal, handOpenness, hysteresis, wrapAngle, horizontalYaw, viewerFrame,
  gestureRig, rubber, limitRig, sanitizeRig,
} from '../js/xr-math.js';

const v = (x, y, z) => ({ x, y, z });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const nearV = (a, b, eps = 1e-9) => { near(a.x, b.x, eps); near(a.y, b.y, eps); near(a.z, b.z, eps); };

test('palmNormal:掌心朝上时左右手都指向 +y', () => {
  const wrist = v(0, 0, 0);
  // 左手掌心朝上:拇指在左(-x),食指根在左、小指根在右
  nearV(palmNormal(wrist, v(-0.02, 0, -0.08), v(0.02, 0, -0.08), 'left'), v(0, 1, 0));
  // 右手掌心朝上:食指根在右
  nearV(palmNormal(wrist, v(0.02, 0, -0.08), v(-0.02, 0, -0.08), 'right'), v(0, 1, 0));
  // 左手翻过来(掌心朝下)
  nearV(palmNormal(wrist, v(0.02, 0, -0.08), v(-0.02, 0, -0.08), 'left'), v(0, -1, 0));
});

test('handOpenness:平摊 > 阈值,握拳 < 阈值,缺关节为 0', () => {
  const base = { wrist: v(0, 0, 0), 'middle-finger-phalanx-proximal': v(0, 0, -0.09) };
  const tips = d => ({ 'index-finger-tip': v(0, 0, -d), 'middle-finger-tip': v(0, 0, -d), 'ring-finger-tip': v(0, 0, -d), 'pinky-finger-tip': v(0, 0, -d) });
  assert.ok(handOpenness({ ...base, ...tips(0.17) }) > PALM.OPEN_ON);
  assert.ok(handOpenness({ ...base, ...tips(0.10) }) < PALM.OPEN_OFF);
  assert.equal(handOpenness({ ...base }), 0);
});

test('hysteresis:开要过 on,关要过 off', () => {
  assert.equal(hysteresis(false, 0.5, PALM.FACE_ON, PALM.FACE_OFF), false);
  assert.equal(hysteresis(false, 0.6, PALM.FACE_ON, PALM.FACE_OFF), true);
  assert.equal(hysteresis(true, 0.3, PALM.FACE_ON, PALM.FACE_OFF), true);
  assert.equal(hysteresis(true, 0.2, PALM.FACE_ON, PALM.FACE_OFF), false);
});

test('wrapAngle / horizontalYaw / viewerFrame', () => {
  near(wrapAngle(3 * Math.PI / 2), -Math.PI / 2);
  near(horizontalYaw(v(1, 0, 0)), 0);
  // 绕 +Y 转 90°:(1,0,0) → (0,0,-1),角度 +90°,与 three rotation.y 同号
  near(horizontalYaw(v(0, 0, -1)), Math.PI / 2);
  const { f, r } = viewerFrame(v(0, -0.7, -0.7));
  nearV(f, v(0, 0, -1));
  nearV(r, v(1, 0, 0));
  nearV(viewerFrame(v(0, -1, 0)).f, v(0, 0, -1));   // 竖直往下看时退回 -z
});

const start = { rig: { ...ZERO_RIG }, left: v(-0.15, -0.3, -0.4), right: v(0.15, -0.3, -0.4), forward: v(0, 0, -1) };

test('gestureRig:双手往前推 10cm → 战场远离 15cm', () => {
  const rig = gestureRig(start, { left: v(-0.15, -0.3, -0.5), right: v(0.15, -0.3, -0.5) });
  nearV(rig, { yaw: 0, x: 0, y: 0, z: -0.15 }, 1e-9);
  near(rig.yaw, 0);
});

test('gestureRig:横移 10cm → 战场横移 5cm;抬高 10cm → 升 10cm', () => {
  const side = gestureRig(start, { left: v(-0.05, -0.3, -0.4), right: v(0.25, -0.3, -0.4) });
  near(side.x, 0.05); near(side.z, 0); near(side.yaw, 0);
  const up = gestureRig(start, { left: v(-0.15, -0.2, -0.4), right: v(0.15, -0.2, -0.4) });
  near(up.y, 0.1);
});

test('gestureRig:观察者朝右时,手往右前推按观察者的前方算深度', () => {
  const s = { ...start, forward: v(1, 0, 0), left: v(0.4, -0.3, 0.15), right: v(0.4, -0.3, -0.15) };
  const rig = gestureRig(s, { left: v(0.5, -0.3, 0.15), right: v(0.5, -0.3, -0.15) });
  near(rig.x, 0.15); near(rig.z, 0);
});

test('gestureRig:右手往前、左手往后 → 两手连线逆时针(俯视)转,yaw 为正', () => {
  // 连线从 (1,0,0) 转到 (0,0,-1):俯视逆时针 90°
  const rig = gestureRig(start, { left: v(0, -0.3, -0.25), right: v(0, -0.3, -0.55) });
  near(rig.yaw, Math.PI / 2);
  near(rig.x, 0); near(rig.z, 0);   // 中点没动
});

test('rubber:区间内不变,越界渐近不超过 give', () => {
  near(rubber(0.5, 0, 1, 0.06), 0.5);
  assert.ok(rubber(1.5, 0, 1, 0.06) < 1.06 && rubber(1.5, 0, 1, 0.06) > 1);
  assert.ok(rubber(-9, 0, 1, 0.06) > -0.06);
});

test('limitRig:高度、距离、横向硬限幅', () => {
  const base = { y: -0.5, z: -0.72 };
  near(limitRig({ yaw: 0, x: 0, y: 0.5, z: 0 }, base).y, 0.2);     // 头下 0.3m 封顶
  near(limitRig({ yaw: 0, x: 0, y: -0.5, z: 0 }, base).y, -0.3);   // 头下 0.8m 封底
  near(limitRig({ yaw: 0, x: 0, y: 0, z: -1 }, base).z, -0.38);    // 最远 1.1m
  near(limitRig({ yaw: 0, x: 0, y: 0, z: 0.5 }, base).z, 0.27);    // 最近 0.45m
  near(limitRig({ yaw: 0, x: 0.5, y: 0, z: 0 }, base).x, RIG.LATERAL);
  const same = limitRig({ yaw: 0.3, x: 0.1, y: 0.1, z: -0.1 }, base);   // 区间内不变
  nearV(same, { x: 0.1, y: 0.1, z: -0.1 });
  near(same.yaw, 0.3);
});

test('limitRig soft:越界只拉出不到 GIVE', () => {
  const base = { y: -0.5, z: -0.72 };
  const y = limitRig({ yaw: 0, x: 0, y: 0.5, z: 0 }, base, true).y;
  assert.ok(y > 0.2 && y < 0.2 + RIG.GIVE);
});

test('sanitizeRig:坏数据当零', () => {
  assert.deepEqual(sanitizeRig(null), { ...ZERO_RIG });
  assert.deepEqual(sanitizeRig({ yaw: 'a', x: 1, y: NaN }), { yaw: 0, x: 1, y: 0, z: 0 });
});

test('uiSector:过 55° 才换边,换完 40° 不回,四个扇区都能到', async () => {
  const { uiSector } = await import('../js/xr-math.js');
  const deg = d => d * Math.PI / 180;
  assert.equal(uiSector(deg(44), 0), 0);
  assert.equal(uiSector(deg(54), 0), 0);
  assert.equal(uiSector(deg(56), 0), 1);
  assert.equal(uiSector(deg(40), 1), 1);     // 刚换到 1(中心 90°),回到 40° 仍在 55° 以内
  assert.equal(uiSector(deg(34), 1), 0);     // 离 90° 超过 55° 才换回
  assert.equal(uiSector(deg(-60), 0), 3);    // 负方向 = 扇区 3
  assert.equal(uiSector(deg(178), 0), 2);
  assert.equal(uiSector(deg(-134), 2), 2);   // 跨 ±180° 也按最短角度算
});

test('inPointingZone:手举在头前才算在指', async () => {
  const { inPointingZone } = await import('../js/xr-math.js');
  assert.equal(inPointingZone({ x: 0.1, y: -0.3, z: -0.35 }), true);    // 胸前
  assert.equal(inPointingZone({ x: 0.2, y: -0.7, z: -0.2 }), false);    // 垂在腿上
  assert.equal(inPointingZone({ x: 0, y: -0.1, z: -0.05 }), false);     // 贴着脸
  assert.equal(inPointingZone({ x: 0, y: 0.2, z: -0.4 }), false);       // 举过头顶
});

// 手牌行(第七轮):上沿在"眼 → 近边"视线下方 2°–6°,对三档棋盘、多种头高、双手挪 / 转过的棋盘都成立。
// 几何和 xr.js 一致:棋盘中心头下 0.60m、前 0.85m,大档后推保持标准档近边;近边含边框余量(台面 + 0.3 单位)
const ARENA = { hx: 7.1, hz: 9.4, top: -0.32, rim: 0.42 }, RIM_ALLOWANCE = 0.3;
const SCALES = { small: 0.038, standard: 0.046, large: 0.054 };
const ROW = { top: 0.05 * 0.8, bottom: 0.127 * 0.8 };
function rowCase(size, { eyeY = 0, eyeZ = 0, rig = { y: 0, z: 0 }, sideways = false } = {}) {
  const scale = SCALES[size];
  const shift = Math.max(0, (scale - SCALES.standard) * (ARENA.hz + ARENA.rim));
  // 棋盘偏移 / 旋转都挂在 boardRig 下,UI 跟着一起动:在 UI 坐标里近边永远在中心 +half 处;
  // 转过 55° 换边后面对的是侧边(half 用 hx)。rig.y / rig.z 等价于眼睛反向移动
  const half = (sideways ? ARENA.hx : ARENA.hz) + ARENA.rim;
  const wy = -0.6 + rig.y, wz = -0.85 - shift + rig.z;
  const edge = { y: wy + (ARENA.top + RIM_ALLOWANCE) * scale, z: wz + half * scale };
  return { eye: { y: eyeY, z: eyeZ }, edge };
}

test('cardRowPose:上沿在近边视线下方 2°–6°,正对眼睛,在眼睛和近边之间', async () => {
  const { cardRowPose, sightAngle } = await import('../js/xr-math.js');
  const deg = 180 / Math.PI;
  const cases = [];
  for (const size of ['small', 'standard', 'large']) {
    for (const eyeY of [-0.12, 0, 0.1]) {                          // 坐低 / 原位 / 坐直
      for (const eyeZ of [0.08, 0, -0.06]) cases.push([size, { eyeY, eyeZ }]);   // 往后靠 / 原位 / 前倾
    }
    for (const rig of [{ y: 0.2, z: 0 }, { y: -0.2, z: 0 }, { y: 0, z: -0.25 }, { y: 0.1, z: 0.25 }]) cases.push([size, { rig }]);
    cases.push([size, { sideways: true }], [size, { sideways: true, rig: { y: -0.1, z: 0.1 } }]);   // 转过 90° 换到侧边
  }
  for (const [size, opt] of cases) {
    const { eye, edge } = rowCase(size, opt);
    const p = cardRowPose(eye, edge, ROW);
    const tag = `${size} ${JSON.stringify(opt)}`;
    // 实际上沿点(行平面绕 x 轴倾 tilt,上沿沿本地 +y 偏 top)的视线角,独立于函数内部推导再算一遍
    const c = Math.cos(p.tilt), s = Math.sin(-p.tilt);
    const topPt = { y: p.y + ROW.top * c, z: p.z - ROW.top * s };
    const gap = (sightAngle(eye, topPt) - sightAngle(eye, edge)) * deg;
    assert.ok(gap >= 2 - 1e-9 && gap <= 6, `上沿角缝 ${gap.toFixed(2)}° @${tag}`);
    // 法线正对眼睛:行中心 → 眼睛的方向角 = −tilt
    near(-p.tilt, sightAngle(eye, p), 1e-9);
    // 在眼睛和近边之间:离眼 ≤ DIST,且水平上比近边更靠近眼睛
    near(Math.hypot(eye.y - p.y, eye.z - p.z), p.dist, 1e-9);
    assert.ok(p.dist <= 0.38 + 1e-9 && p.dist >= 0.3, `离眼 ${p.dist} @${tag}`);
    assert.ok(p.z > edge.z && topPt.z > edge.z, `在近边前面 @${tag}`);
  }
});

test('cardRowPose:近边在脚下时上沿封顶 80°(约束让位),离眼不超过近边距离的 0.8', async () => {
  const { cardRowPose, CARD_ROW } = await import('../js/xr-math.js');
  const p = cardRowPose({ y: 0, z: 0 }, { y: -0.4, z: 0.05 }, ROW);   // 近边在眼睛后下方
  near(p.topAngle, CARD_ROW.MAX_TOP);
  assert.ok(p.dist <= 0.8 * Math.hypot(0.4, 0.05) + 1e-9);
});

test('nearestWithin:12cm 内取最近的牌,超出取不到,null 跳过', async () => {
  const { nearestWithin, GRAB_RADIUS } = await import('../js/xr-math.js');
  assert.equal(GRAB_RADIUS, 0.12);
  const centers = [v(-0.066, 0, 0), v(0, 0, 0), v(0.066, 0, 0)];
  assert.equal(nearestWithin(centers, v(0.04, 0.03, 0)), 2);        // 捏在两张之间偏右
  assert.equal(nearestWithin(centers, v(0, 0.11, 0)), 1);           // 牌上方 11cm:磁吸到
  assert.equal(nearestWithin(centers, v(0, 0.125, 0)), -1);         // 12.5cm:谁都够不着
  assert.equal(nearestWithin(centers, v(0.2, 0, 0)), -1);
  assert.equal(nearestWithin([null, v(0, 0, 0)], v(-0.05, 0, 0)), 1);
});

test('chooseDrop:当前合法 / 150ms 内的旧合法点 / 超时退回 / 追踪丢失 / 射线捏紧快照', async () => {
  const { chooseDrop, DROP } = await import('../js/xr-math.js');
  const A = { id: 'a' }, B = { id: 'b' }, C = { id: 'c' };
  // 当前合法:用当前
  assert.deepEqual(chooseDrop({ current: { hit: A, valid: true }, lastValid: { hit: B, at: 990 }, now: 1000 }), { hit: A, from: 'current' });
  // 当前出界(手指张开那一帧抖出去),150ms 内有合法点:用它
  assert.deepEqual(chooseDrop({ current: null, lastValid: { hit: B, at: 1000 - DROP.GRACE_MS }, now: 1000 }), { hit: B, from: 'recent' });
  // 当前落点不合法(抖进石头 / 敌方半场),旧合法点还新鲜:用旧的
  assert.deepEqual(chooseDrop({ current: { hit: C, valid: false }, lastValid: { hit: B, at: 900 }, now: 1000 }), { hit: B, from: 'recent' });
  // 旧合法点超过 150ms:退回,区分"有落点但不合法"和"出界"
  assert.deepEqual(chooseDrop({ current: { hit: C, valid: false }, lastValid: { hit: B, at: 849 }, now: 1000 }), { hit: C, from: 'blocked' });
  assert.deepEqual(chooseDrop({ current: null, lastValid: { hit: B, at: 849 }, now: 1000 }), { hit: null, from: 'outside' });
  assert.deepEqual(chooseDrop({ now: 1000 }), { hit: null, from: 'outside' });
  // 追踪丢失 = 没有当前落点:150ms 内有合法点就出,否则退回
  assert.equal(chooseDrop({ current: null, lastValid: { hit: B, at: 880 }, now: 1000 }).from, 'recent');
  assert.equal(chooseDrop({ current: null, lastValid: { hit: B, at: 800 }, now: 1000 }).from, 'outside');
  // 射线:张开手指前(捏紧时)的落点优先于跳过后的当前落点;快照太旧(一直松捏着拖)就用当前
  assert.deepEqual(chooseDrop({ firm: { hit: A, valid: true, at: 900 }, current: { hit: C, valid: true }, now: 1000 }), { hit: A, from: 'firm' });
  assert.deepEqual(chooseDrop({ firm: { hit: A, valid: true, at: 1000 - DROP.FIRM_MS - 1 }, current: { hit: C, valid: true }, now: 1000 }), { hit: C, from: 'current' });
  assert.deepEqual(chooseDrop({ firm: { hit: A, valid: false, at: 990 }, current: { hit: C, valid: true }, now: 1000 }), { hit: C, from: 'current' });
});

test('forwardLean:贴台面不偏,越高越靠前偏,封顶 0.12m,方向沿眼→手', async () => {
  const { forwardLean, LEAN } = await import('../js/xr-math.js');
  const eye = { x: 0, y: 0, z: 0 }, boardY = -0.5;
  const at = h => forwardLean(eye, { x: 0, y: boardY + h, z: -0.35 }, boardY);
  assert.deepEqual(at(0), { x: 0, z: 0 });
  assert.ok(at(0.05).z < 0 && at(0.1).z < at(0.05).z);          // 往前(−z)偏,越高越多
  assert.ok(Math.abs(at(0.3).z) <= LEAN.CAP + 1e-9);
  const side = forwardLean(eye, { x: 0.3, y: -0.4, z: -0.3 }, boardY);
  assert.ok(Math.abs(side.x - side.z * -1) < 1e-9);               // 45° 方向:x 与 −z 等量
});

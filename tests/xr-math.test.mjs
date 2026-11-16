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
  near(limitRig({ yaw: 0, x: 0, y: 0.5, z: 0 }, base).y, 0.3);     // 头下 0.2m 封顶
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
  assert.ok(y > 0.3 && y < 0.3 + RIG.GIVE);
});

test('sanitizeRig:坏数据当零', () => {
  assert.deepEqual(sanitizeRig(null), { ...ZERO_RIG });
  assert.deepEqual(sanitizeRig({ yaw: 'a', x: 1, y: NaN }), { yaw: 0, x: 1, y: 0, z: 0 });
});

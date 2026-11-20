// xr-drop.js 单测(第十轮:手位选牌 + 抬起确认 + 落点跟手)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HAND_BAND, LIFT, DROP_GAIN, dropZone, inHandBand, pickCardByHand, liftAmount, liftProgress,
  viewToField, dropStart, dropFromHand,
} from '../js/xr-drop.js';

const v = (x, y, z) => ({ x, y, z });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const XS = [-0.164, -0.082, 0, 0.082, 0.164];   // 手牌行 5 张牌的中心(CARD_GAP 8.2cm)

test('inHandBand / pickCardByHand:手牌带外不选,带内取左右最近', () => {
  assert.equal(pickCardByHand(v(0, 0, 0), XS), 2);
  assert.equal(pickCardByHand(v(0.07, 0.05, -0.08), XS), 3);
  assert.equal(pickCardByHand(v(0, HAND_BAND.HEIGHT + 0.005, 0), XS), -1);       // 太高
  assert.equal(pickCardByHand(v(0, -HAND_BAND.HEIGHT - 0.005, 0), XS), -1);      // 太低
  assert.equal(pickCardByHand(v(0, 0, HAND_BAND.DEPTH + 0.005), XS), -1);        // 太靠近身体
  assert.equal(pickCardByHand(v(0, 0, -HAND_BAND.DEPTH - 0.005), XS), -1);       // 伸进棋盘
  assert.equal(pickCardByHand(v(0.164 + HAND_BAND.SIDE - 0.005, 0, 0), XS), 4);  // 右端外 5.5cm 还在带内
  assert.equal(pickCardByHand(v(0.164 + HAND_BAND.SIDE + 0.005, 0, 0), XS), -1);
  assert.equal(inHandBand(v(0, 0, 0), [null, null]), false);                      // 没有可选的牌
  // 不可选的牌(null)跳过,带宽按可选的牌算
  assert.equal(pickCardByHand(v(-0.05, 0, 0), [null, null, 0, 0.082, null]), 2);
  assert.equal(pickCardByHand(v(-0.07, 0, 0), [null, null, 0, 0.082, null]), -1);
});

test('pickCardByHand:相邻切换有 1.2cm 滞回', () => {
  const mid = 0.041;   // 牌 2 和牌 3 的交界
  assert.equal(pickCardByHand(v(mid + 0.004, 0, 0), XS, 2), 2);    // 越过交界 0.4cm(差 0.8cm < 1.2cm):不换
  assert.equal(pickCardByHand(v(mid + 0.007, 0, 0), XS, 2), 3);    // 越过 0.7cm(差 1.4cm):换
  assert.equal(pickCardByHand(v(mid - 0.004, 0, 0), XS, 3), 3);    // 往回也一样
  assert.equal(pickCardByHand(v(mid + 0.004, 0, 0), XS, -1), 3);   // 没有上一张时不加滞回
  assert.equal(pickCardByHand(v(mid + 0.004, 0, 0), XS, 0), 3);    // 上一张离得远:直接换到最近
});

test('liftProgress:往前 / 往上合成 7cm 确认;往后、往下不算', () => {
  const h0 = v(0, 0, 0);
  near(liftProgress(h0, v(0, 0.035, 0)), 0.5);
  assert.ok(liftProgress(h0, v(0, 0.069, 0)) < 1);
  assert.equal(liftProgress(h0, v(0, 0.07, 0)), 1);
  assert.equal(liftProgress(h0, v(0, 0, -0.07)), 1);                     // 往前
  assert.equal(liftProgress(h0, v(0, 0.05, -0.05)), 1);                  // 斜上前 7.07cm
  assert.ok(liftProgress(h0, v(0, 0.04, -0.04)) < 1);                    // 5.66cm
  assert.equal(liftProgress(h0, v(0.3, 0, 0)), 0);                       // 左右不算
  assert.equal(liftProgress(h0, v(0, -0.1, 0.1)), 0);                    // 往下、往后不算
  near(liftAmount(h0, v(0.2, 0.03, -0.04)), 0.05);
});

test('viewToField / dropStart:没换边时 u = x、v = -z;换到侧边时转 90°', () => {
  const f = viewToField(1, -7, 0);
  near(f.x, 1); near(f.z, 7);
  const s = viewToField(1, -4.2, Math.PI / 2);   // UI 转到 +x 侧(three rotation.y = +90°):玩家站在 +x 侧往 -x 看
  near(s.x, 4.2); near(s.z, -1);
  const a = dropStart(0, 0);
  near(a.x0, 0); near(a.d0, -7.6 + DROP_GAIN.EDGE);
  near(dropStart(0.1, 0).x0, 3.2);                               // 手在行中心右 10cm → 棋盘 x = 3.2
  near(dropStart(0, Math.PI / 2).d0, -4.8 + DROP_GAIN.EDGE);     // 侧边:半宽
});

const UNIT = dropZone(true), SPELL = dropZone(false);
const aim = (h, zone = UNIT, extra = {}) => {
  const grab = v(0, 0, 0), h0 = v(0, 0.07, 0);     // 抓起后往上抬 7cm 确认
  return dropFromHand({ grab, h0, h, ...dropStart(h0.x), zone, ...extra });
};

test('dropZone:单位夹在己方部署区,法术全场', () => {
  assert.deepEqual(UNIT, { x: [-4.8, 4.8], z: [2.4, 7.6] });
  assert.deepEqual(SPELL, { x: [-4.8, 4.8], z: [-7.6, 7.6] });
});

test('dropFromHand:确认时落点在近边;左右 GX、前 / 上 GD(上 ×0.8)', () => {
  const p0 = aim(v(0, 0.07, 0));
  near(p0.x, 0); near(p0.z, 7.0); assert.equal(p0.cancel, false);
  const r = aim(v(0.05, 0.07, 0));                  // 右 5cm → x + 1.6
  near(r.x, 1.6); near(r.z, 7.0);
  const f = aim(v(0, 0.07, -0.1));                  // 前 10cm → 深 2.6 格
  near(f.z, 7.0 - 2.6);
  const u = aim(v(0, 0.17, 0));                     // 上 10cm → 深 2.08 格
  near(u.z, 7.0 - 2.08);
  const back = aim(v(0, 0.07, 0.03));               // 往回拉:落点拉回,但夹在近边
  near(back.z, 7.6);
});

test('dropFromHand:单位夹在部署区,法术能推到对面半场', () => {
  const far = aim(v(0.3, 0.07, -0.4));              // 右 30cm、前 40cm
  near(far.x, 4.8); near(far.z, 2.4);               // 单位:夹在部署线
  const left = aim(v(-0.3, 0.07, 0));
  near(left.x, -4.8);
  const spell = aim(v(0, 0.07, -0.4), SPELL);       // 法术同增益:7.0 − 10.4 = −3.4(敌方半场)
  near(spell.z, 7.0 - 0.4 * DROP_GAIN.GD);
  assert.ok(spell.z < 0);
  near(aim(v(0, 0.07, -1), SPELL).z, -7.6);         // 法术也夹在场内
});

test('dropFromHand:退回确认线以内 = cancel(带 1cm 滞回)', () => {
  assert.equal(aim(v(0, 0.065, 0)).cancel, false);  // 6.5cm:还在确认线外的滞回带
  assert.equal(aim(v(0, 0.055, 0)).cancel, true);   // 5.5cm < LIFT.CANCEL
  assert.equal(aim(v(0.2, 0.02, 0)).cancel, true);  // 只往旁边挪不算抬起
  assert.equal(aim(v(0, 0.02, -0.08)).cancel, false); // 往前推出去了
  assert.ok(LIFT.CANCEL < LIFT.CONFIRM);
});

test('dropFromHand:UI 换到侧边时按 yaw 转回战场坐标再夹紧', () => {
  const yaw = Math.PI / 2;
  const grab = v(0, 0, 0), h0 = v(0, 0, -0.07);
  const start = dropStart(0, yaw);
  const p = dropFromHand({ grab, h0, h: h0, ...start, zone: SPELL, yaw });
  near(p.x, 4.2); near(p.z, 0);                     // 侧边(+x)近边往里 0.6 格
  const q = dropFromHand({ grab, h0, h: v(0, 0, -0.17), ...start, zone: SPELL, yaw });
  near(q.x, 4.2 - 2.6);                             // 往前 = 朝 -x 推
});

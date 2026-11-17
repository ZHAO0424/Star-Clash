// 循环动作首尾对齐 + 去毛刺(anim-loop.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeLoopTrack, despikeTrack } from '../js/anim-loop.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const qz = deg => [0, 0, Math.sin(deg * Math.PI / 360), Math.cos(deg * Math.PI / 360)];   // 绕 z 轴转 deg 度
const angleZ = (v, k) => 2 * Math.atan2(v[k * 4 + 2], v[k * 4 + 3]) * 180 / Math.PI;

test('位移轨道:末帧对齐到首帧,首帧不变,中间按时间线性摊', () => {
  const times = [0, 0.5, 1];
  const v = new Float32Array([0, 0, 0, 1, 2, 0, 0, 4, 0]);   // 首尾 y 差 4
  closeLoopTrack(times, v, 3);
  assert.deepEqual([...v.slice(0, 3)], [0, 0, 0]);
  near(v[4], 0);        // 中间帧 y:2 + (0 − 4) × 0.5
  near(v[7], 0);        // 末帧 = 首帧
});

test('四元数轨道:首尾差 24° 的片段,末帧对齐首帧,中间帧均匀分摊', () => {
  // 0°、12°、24°(末帧本该回到 0°)→ 校正后 0°、0°、0°
  const v = new Float32Array([...qz(0), ...qz(12), ...qz(24)]);
  closeLoopTrack([0, 1, 2], v, 4);
  near(angleZ(v, 0), 0, 1e-4); near(angleZ(v, 1), 0, 1e-4); near(angleZ(v, 2), 0, 1e-4);
});

test('四元数轨道:已经首尾相同的片段不变;结果保持单位长度', () => {
  const v = new Float32Array([...qz(10), ...qz(40), ...qz(10)]);
  const before = [...v];
  closeLoopTrack([0, 0.3, 0.6], v, 4);
  before.forEach((x, i) => near(v[i], x, 1e-6));
  const w = new Float32Array([...qz(0), ...qz(90), ...qz(-170)]);
  closeLoopTrack([0, 1, 2], w, 4);
  for (let k = 0; k < 3; k++) near(Math.hypot(...w.slice(k * 4, k * 4 + 4)), 1, 1e-5);
  near(angleZ(w, 2), 0, 1e-3);
});

test('去毛刺:跳走 24° 又在两帧内跳回的关键帧被前后插值替换;连续的大动作不动', () => {
  // 0,1,2,3,[27],[20],4,5,6,7 度:第 4、5 帧是毛刺
  const deg = [0, 1, 2, 3, 27, 20, 4, 5, 6, 7];
  const v = new Float32Array(deg.flatMap(qz));
  const times = deg.map((_, i) => i);
  assert.equal(despikeTrack(times, v, 4), 2);
  near(angleZ(v, 4), 3 + 1 / 3, 1e-3); near(angleZ(v, 5), 3 + 2 / 3, 1e-3);
  near(angleZ(v, 6), 4, 1e-4);
  // 一路转过去不回头的大动作(每帧 30°)不算毛刺
  const big = [0, 1, 2, 32, 62, 92, 93, 94];
  const w = new Float32Array(big.flatMap(qz));
  assert.equal(despikeTrack(big.map((_, i) => i), w, 4), 0);
});

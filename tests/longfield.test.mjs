// 场地拉长(半长 6.8 → 7.6)+ 塔 / 核心后移:射程够不到星核占领圈,布局都在战场里、棋盘外框不变
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapForScene, stretchFieldZ, unstretchFieldZ, FIELD_STRETCH, wallGap } from '../js/map.js';
import { ARENA } from '../js/arena-dims.js';

const IDS = ['starcore', 'glacier', 'volcano'];
const UNIT_R = 0.22;   // 地面单位半径(飞行 0.18 更小,地面是最坏情况)

test('塔 / 核心的射程边缘到星核占领圈边缘的距离 > 0.2(打不到祭坛上的单位)', () => {
  for (const id of IDS) {
    const m = mapForScene(id), N = m.node;
    for (const s of [...m.towers, m.base]) {
      const margin = Math.hypot(s.x - N.x, s.z - N.z) - N.r - (s.range + s.radius + UNIT_R);
      assert.ok(margin > 0.2, `${id} ${s.kind} 余量 ${margin.toFixed(2)}`);
    }
  }
});

test('塔 / 核心在战场里,核心后沿不出底边;战场仍在黄线内框里', () => {
  for (const id of IDS) {
    const m = mapForScene(id);
    assert.equal(m.HALF, FIELD_STRETCH.to);
    for (const s of [...m.towers, m.base]) assert.ok(Math.abs(s.z) + s.radius <= m.HALF, `${id} ${s.kind}`);
    assert.ok(m.HALF < ARENA.frame.z - 0.8, '战场外还要留出台沿 / 台地');
  }
});

test('岩脊 / 岩石 / 裂隙按 7.6/6.8 等比平移,形状半径不变;都离开塔', () => {
  const k = FIELD_STRETCH.to / FIELD_STRETCH.from, m = mapForScene('starcore');
  assert.ok(Math.abs(m.walls[1].pts[0][1] - 1.15 * k) < 1e-9);
  assert.equal(m.walls[1].r, 0.285);
  assert.ok(Math.abs(m.obstacles[0].z - 2.1 * k) < 1e-9);
  for (const id of IDS) {
    const g = mapForScene(id);
    for (const s of [...g.towers, g.base]) assert.ok(wallGap(s.x, s.z, g) > s.radius, `${id} ${s.kind} 压在岩脊上`);
  }
});

test('地形拉伸映射:战场边 6.8 → 7.6,黄线外不动,可逆且单调', () => {
  assert.ok(Math.abs(stretchFieldZ(6.8) - 7.6) < 1e-9 && Math.abs(stretchFieldZ(-6.8) + 7.6) < 1e-9);
  assert.equal(stretchFieldZ(9.5), 9.5);
  let prev = -Infinity;
  for (let z = -10; z <= 10; z += 0.01) {
    const s = stretchFieldZ(z);
    assert.ok(s > prev, '单调');
    assert.ok(Math.abs(unstretchFieldZ(s) - z) < 1e-9, '可逆');
    prev = s;
  }
});

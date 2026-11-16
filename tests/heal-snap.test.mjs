// heal-snap.js 单测:范围治疗的自动吸附
import test from 'node:test';
import assert from 'node:assert/strict';
import { HEAL_SNAP, healSnap, autoTargets } from '../js/heal-snap.js';

const card = { effect: 'heal_area', radius: 2.2 };
const unit = (id, x, z, hp = 50, extra = {}) => ({ id, side: 'p', x, z, hp, maxHp: 100, radius: 0.22, ...extra });

test('autoTargets:只有 heal_area 走吸附', () => {
  assert.equal(autoTargets(card), true);
  assert.equal(autoTargets({ effect: 'buff_atk' }), false);
});

test('吸到最近的受伤己方单位,满血 / 敌方 / 建筑 / 死亡不算', () => {
  const units = [unit(1, 1, 0), unit(2, 2, 0), unit(3, 0.2, 0, 100), unit(4, 0.1, 0, 10, { side: 'e' }),
    unit(5, 0.1, 0.1, 10, { building: true }), unit(6, 0, 0.3, 10, { dead: true })];
  const s = healSnap(units, 'p', card, 0, 0);
  assert.equal(s.target.id, 1);
  assert.deepEqual([s.x, s.z], [1, 0]);
  assert.deepEqual(s.others.map(u => u.id), [2]);   // 2 离吸附点 1 格,在 2.2 半径内
});

test('超出吸附范围不吸,释放点 = 原落点', () => {
  const s = healSnap([unit(1, HEAL_SNAP.RANGE + 0.5, 0)], 'p', card, 0, 0);
  assert.equal(s.target, null);
  assert.deepEqual([s.x, s.z], [0, 0]);
});

test('滞回:新目标没有近出 0.6 格就不换', () => {
  const units = [unit(1, 1.0, 0), unit(2, -1.3, 0)];
  assert.equal(healSnap(units, 'p', card, 0, 0, 2).target.id, 2);     // 1 只近 0.3 格,保持 2
  assert.equal(healSnap(units, 'p', card, 0.5, 0, 2).target.id, 1);   // 1 近了 1.3 格,换
});

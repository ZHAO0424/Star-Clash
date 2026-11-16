// 冰封裂谷 · 冰路:斜插三路的带状冰面,地面单位 ×0.5,飞行不受影响;不进部署区、不压祭坛;不参与寻路
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { CARDS, PRESET_DECKS } from '../js/cards.js';
import { mapForScene, onIce } from '../js/map.js';

const G = mapForScene('glacier');
const game = (sceneId = 'glacier') => new Game('steel', 'swarm', { p: PRESET_DECKS.steel, e: PRESET_DECKS.swarm }, { sceneId, autoPick: [] });
// 让单位朝 +x 走一小步,返回实际位移(冻住目标:空场里单位会走向敌方建筑,这里直接比较同一单位两处的速度)
function stepSpeed(g, u, x, z) {
  u.x = x; u.z = z; u.path = null; u.status.stun = 0;
  const x0 = u.x, z0 = u.z;
  g.tick(0.1); g.drainEvents();
  return Math.hypot(u.x - x0, u.z - z0) / 0.1;
}

test('原来的两个圆形冰缝已替换:冰封裂谷没有裂隙,有两条冰路', () => {
  assert.equal(G.rifts.length, 0);
  assert.equal(G.ice.paths.length, 2);
  assert.equal(G.ice.slow, 0.5);
});

test('冰路绕星核旋转 180° 对称,三条路都被冰面跨过', () => {
  for (let x = -4.8; x <= 4.8; x += 0.1) for (let z = -3; z <= 3; z += 0.1) assert.equal(onIce(G, x, z), onIce(G, -x, -z));
  for (const [x0, x1] of [[-4.8, -2.3], [-1.9, 1.9], [2.3, 4.8]]) {
    let hit = false;
    for (let x = x0; x <= x1 && !hit; x += 0.05) for (let z = -2.5; z <= 2.5 && !hit; z += 0.05) hit = onIce(G, x, z);
    assert.ok(hit, `路 ${x0}..${x1} 没有冰面`);
  }
});

test('冰面不进部署区、不压祭坛占领圈,只在冰封裂谷', () => {
  for (let x = -4.8; x <= 4.8; x += 0.05) for (let z = -7.6; z <= 7.6; z += 0.05) {
    if (!onIce(G, x, z)) continue;
    assert.ok(Math.abs(z) + 0.22 < G.DEPLOY_LINE, `进了部署区 ${x},${z}`);
    assert.ok(Math.hypot(x, z) >= G.node.r, '压了祭坛');
  }
  for (const id of ['starcore', 'volcano']) assert.ok(!mapForScene(id).ice);
});

test('地面单位在冰面上减速一半,飞行单位不受影响', () => {
  const g = game();
  const ground = g.spawnUnit('p', CARDS.steel_tank, 0, 4, 1)[0], air = g.spawnUnit('p', CARDS.mecha_drone, 0, 4, 1)[0];
  const [ix, iz] = [0.3, -1.75];   // 冰路上一点(祭坛南侧)
  assert.ok(onIce(G, ix, iz));
  const vIce = stepSpeed(g, ground, ix, iz), vDry = stepSpeed(g, ground, 0.3, 0.9);
  assert.ok(Math.abs(vIce / vDry - 0.5) < 0.05, `地面 ${vIce.toFixed(3)} / ${vDry.toFixed(3)}`);
  const aIce = stepSpeed(g, air, ix, iz), aDry = stepSpeed(g, air, 0.3, 0.9);
  assert.ok(Math.abs(aIce / aDry - 1) < 0.05, `飞行 ${aIce.toFixed(3)} / ${aDry.toFixed(3)}`);
});

test('冰面不参与寻路:寻路网格没有冰面代价', () => {
  const g = game();
  const k = g.nav.idx(0.3, -1.75);
  assert.equal(g.nav.costMul[k], 1);
});

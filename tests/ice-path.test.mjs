// 冰封裂谷 · 冰川裂隙:锯齿 / 宽窄不一 / 分叉断续的裂缝网斜插三路,地面单位 × ice.slow,飞行不受影响;
//   不进部署区、不压祭坛;不参与寻路,单位转向 / AI 也不避冰
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { CARDS, PRESET_DECKS } from '../js/cards.js';
import { mapForScene, onIce, inPolygon } from '../js/map.js';

const G = mapForScene('glacier');
const game = (sceneId = 'glacier') => new Game('steel', 'swarm', { p: PRESET_DECKS.steel, e: PRESET_DECKS.swarm }, { sceneId, autoPick: [], prep: 0 });
// 让单位朝 +x 走一小步,返回实际位移(冻住目标:空场里单位会走向敌方建筑,这里直接比较同一单位两处的速度)
function stepSpeed(g, u, x, z) {
  u.x = x; u.z = z; u.path = null; u.status.stun = 0;
  const x0 = u.x, z0 = u.z;
  g.tick(0.1); g.drainEvents();
  return Math.hypot(u.x - x0, u.z - z0) / 0.1;
}
const area = () => {
  let n = 0; const s = 0.02;
  for (let x = -4.8; x <= 4.8; x += s) for (let z = -3; z <= 3; z += s) if (onIce(G, x, z)) n++;
  return n * s * s;
};

test('冰封裂谷没有圆形裂隙,冰面是 12 条裂隙多边形(每方 3 主 + 3 支),减速倍率是参数 ice.slow', () => {
  assert.equal(G.rifts.length, 0);
  assert.equal(G.ice.cracks.length, 12);
  assert.ok(G.ice.slow > 0 && G.ice.slow < 1);
});

test('总减速面积和第五轮冰路(13.3)相当,±20% 以内', () => {
  const a = area();
  assert.ok(a > 13.3 * 0.8 && a < 13.3 * 1.2, `面积 ${a.toFixed(2)}`);
});

test('形状不规则:宽窄不一、末端收尖,多边形不自交', () => {
  const cross = (a, b, c, d) => {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (const c of G.ice.cracks) {
    const w = c.left.map((l, i) => Math.hypot(l[0] - c.right[i][0], l[1] - c.right[i][1]));
    assert.ok(w.at(-1) < 0.01 && (c.left.length < 20 || w[0] < 0.01), '收尖(支缝只有末端,起点接在主缝里)');
    if (c.left.length > 20) assert.ok(Math.max(...w) > 2 * w.slice(1, -1).reduce((a, b) => Math.min(a, b)), '宽窄不一');
    const P = c.poly;
    for (let i = 0; i < P.length; i++) for (let j = i + 2; j < P.length; j++) {
      if (i === 0 && j === P.length - 1) continue;
      assert.ok(!cross(P[i], P[(i + 1) % P.length], P[j], P[(j + 1) % P.length]), '自交');
    }
  }
});

test('判定 = 渲染形状:onIce 就是落在裂隙多边形里(祭坛圈除外)', () => {
  for (let x = -4.8; x <= 4.8; x += 0.07) for (let z = -2.5; z <= 2.5; z += 0.07) {
    assert.equal(onIce(G, x, z), G.ice.cracks.some(c => inPolygon(c.poly, x, z)));
  }
});

test('冰面绕星核旋转 180° 对称,三条路都被冰面跨过', () => {
  for (let x = -4.8; x <= 4.8; x += 0.1) for (let z = -3; z <= 3; z += 0.1) assert.equal(onIce(G, x, z), onIce(G, -x, -z));
  for (const [x0, x1] of [[-4.8, -2.3], [-1.9, 1.9], [2.3, 4.8]]) {
    let hit = false;
    for (let x = x0; x <= x1 && !hit; x += 0.05) for (let z = -2.5; z <= 2.5 && !hit; z += 0.05) hit = onIce(G, x, z);
    assert.ok(hit, `路 ${x0}..${x1} 没有冰面`);
  }
});

test('冰面不进部署区、不压祭坛占领圈(顶点离圈 ≥ 0.15),只在冰封裂谷', () => {
  for (const c of G.ice.cracks) for (const [x, z] of c.poly) {
    assert.ok(Math.abs(z) + 0.22 < G.DEPLOY_LINE, `进了部署区 ${x},${z}`);
    assert.ok(Math.hypot(x - G.node.x, z - G.node.z) >= G.node.r + 0.15, `压了祭坛 ${x},${z}`);
  }
  for (const id of ['starcore', 'volcano']) assert.ok(!mapForScene(id).ice);
});

test('地面单位在冰面上按 ice.slow 减速,飞行单位不受影响', () => {
  const g = game();
  const ground = g.spawnUnit('p', CARDS.steel_tank, 0, 4, 1)[0], air = g.spawnUnit('p', CARDS.mecha_drone, 0, 4, 1)[0];
  const [ix, iz] = [0.15, -1.76];   // 中路主缝脊线上一点(祭坛南侧)
  assert.ok(onIce(G, ix, iz));
  const vIce = stepSpeed(g, ground, ix, iz), vDry = stepSpeed(g, ground, 0.3, 0.9);
  assert.ok(Math.abs(vIce / vDry - G.ice.slow) < 0.05, `地面 ${vIce.toFixed(3)} / ${vDry.toFixed(3)}`);
  const aIce = stepSpeed(g, air, ix, iz), aDry = stepSpeed(g, air, 0.3, 0.9);
  assert.ok(Math.abs(aIce / aDry - 1) < 0.05, `飞行 ${aIce.toFixed(3)} / ${aDry.toFixed(3)}`);
});

test('不避冰:寻路网格没有冰面代价,转向不因冰面偏转', () => {
  const g = game();
  for (const c of G.ice.cracks) {
    const [x, z] = c.left[Math.floor(c.left.length / 2)].map((v, i) => (v + c.right[Math.floor(c.left.length / 2)][i]) / 2);
    assert.equal(g.nav.costMul[g.nav.idx(x, z)], 1);
  }
  // 站在冰缝前、正对冰缝走:转向结果就是原方向(steer 只绕岩石)
  const u = g.spawnUnit('p', CARDS.steel_infantry, 3.75, 0.9, 1)[0];   // 东路主缝北侧,附近没有岩石
  assert.deepEqual(g.steer(u, 0, -1, 3).map(v => +v.toFixed(9)), [0, -1]);
});

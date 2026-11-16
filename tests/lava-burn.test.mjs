// 熔岩锻炉 · 横贯熔岩河的烧灼规则(第三轮)
//   · 地面单位在河里每 0.5 秒受 dps × 0.5 伤害,离开后余烬再烧 1 秒;飞行单位、建筑不受影响
//   · 只有星核祭坛(占领圈内)不烧灼,祭坛照常可占;没有岩桥
//   · 河道在双方部署区之外;只有熔岩锻炉有熔岩,其它图不变
//   · 熔岩不参与寻路:侧路单位没有目标时按自己的路线直接蹚过去;视野里出现敌人才追过去
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { CARDS, PRESET_DECKS } from '../js/cards.js';
import { mapForScene, inLava, lavaCenterZ } from '../js/map.js';

const VOLCANO = mapForScene('volcano'), L = VOLCANO.lava;
const game = (sceneId = 'volcano') => new Game('steel', 'swarm', { p: PRESET_DECKS.steel, e: PRESET_DECKS.swarm }, { sceneId, autoPick: [] });
const zc = x => lavaCenterZ(L, VOLCANO.W, x);
// 直接摆一个单位(不走出牌流程,不受部署线限制)
const place = (g, id, x, z, side = 'p') => g.spawnUnit(side, CARDS[id], x, z, 1)[0];
// 只跑烧灼结算:单位位置固定
const burnFor = (g, u, sec, dt = 0.05) => { for (let t = 0; t < sec - 1e-9; t += dt) if (g.burn(u, dt)) break; };

test('地面单位在熔岩里每 0.5 秒烧 4 点,离开后余烬再烧 1 秒', () => {
  const g = game(), u = place(g, 'steel_tank', -2.4, zc(-2.4));
  assert.ok(inLava(VOLCANO, u.x, u.z));
  const hp0 = u.hp;
  burnFor(g, u, 2.0);
  assert.equal(hp0 - u.hp, L.dps * 2.0, '2 秒 = 4 跳 × 4');
  const ev = g.drainEvents().filter(e => e.type === 'hit' && e.unit === u);
  assert.equal(ev.length, 4);
  assert.ok(ev.every(e => e.burn === true), '烧灼伤害事件带 burn 标记(渲染层用它出伤害数字)');
  u.z = 3;   // 离开熔岩
  const hp1 = u.hp;
  burnFor(g, u, 3.0);
  assert.equal(hp1 - u.hp, L.dps * L.ember, '余烬 1 秒 = 2 跳');
  assert.equal(u.status.burn <= 0, true);
});

test('飞行单位、建筑不烧灼', () => {
  const g = game();
  const air = place(g, 'swarm_flyer', 2.4, zc(2.4), 'e');
  const b = g.makeUnit('p', CARDS.steel_bunker ?? Object.values(CARDS).find(c => c.type === 'building'), -2.4, zc(-2.4));
  const a0 = air.hp, b0 = b.hp;
  burnFor(g, air, 3); burnFor(g, b, 3);
  assert.equal(air.hp, a0);
  assert.equal(b.hp, b0);
});

test('星核祭坛下方不烧灼,祭坛照常可占', () => {
  const g = game();
  assert.equal(inLava(VOLCANO, 0, 0), false);
  for (let a = 0; a < Math.PI * 2; a += 0.1) {   // 占领圈内整圈都安全
    const r = VOLCANO.node.r - 0.01;
    assert.equal(inLava(VOLCANO, Math.cos(a) * r, Math.sin(a) * r), false);
  }
  const u = place(g, 'steel_tank', 0.3, 0.6);   // 在占领圈内,又在敌方前哨塔射程外
  u.status.stun = 99;   // 站着不动
  const hp0 = u.hp;
  for (let i = 0; i < 40; i++) g.tick(0.1);
  assert.equal(u.hp, hp0, '祭坛上不掉血');
  assert.ok(g.node.progress > 0, `占领进度 ${g.node.progress}`);
});

test('没有岩桥:祭坛以外整条河都烧灼', () => {
  assert.equal(L.bridges.length, 0);
  for (let x = -VOLCANO.W + 0.01; x < VOLCANO.W; x += 0.05) {
    if (Math.abs(x) < VOLCANO.node.r + 0.05) continue;
    assert.equal(inLava(VOLCANO, x, zc(x)), true, `x=${x.toFixed(2)}`);
  }
});

test('河道在双方部署区之外,绕星核旋转 180° 对称', () => {
  for (let x = -VOLCANO.W; x <= VOLCANO.W; x += 0.01) {
    assert.ok(Math.abs(zc(x)) + L.half < VOLCANO.DEPLOY_LINE, `x=${x.toFixed(2)}`);
    for (const dz of [-0.3, 0, 0.3]) assert.equal(inLava(VOLCANO, x, zc(x) + dz), inLava(VOLCANO, -x, -zc(x) - dz));
  }
});

test('只有熔岩锻炉有熔岩:星核荒原同一位置不烧灼', () => {
  const g = game('starcore'), u = place(g, 'steel_tank', -2.4, zc(-2.4));
  for (let i = 0; i < 20; i++) g.tick(0.1);
  assert.ok(!g.map.lava);
  assert.equal(u.status.burn, 0);
  assert.ok(g.drainEvents().every(e => !e.burn));
});

// 让单位跑一段:返回它第一次进入河道 z 段时的 x
function crossX(g, u, maxT = 40) {
  for (let s = 0; s < maxT / 0.1 && !u.dead; s++) {
    g.tick(0.1); g.drainEvents();
    if (Math.abs(u.z - zc(u.x)) < L.half) return u.x;
  }
  return null;
}

test('侧路单位视野里没有敌人时,按自己的路线直接蹚熔岩过河(不绕去祭坛)', () => {
  for (const id of ['swarm_worker', 'steel_tank', 'steel_infantry']) {   // 脆皮和坦克都一样
    const g = game(), u = place(g, id, -3.6, 2.4);
    const x = crossX(g, u);
    assert.ok(x !== null && x < -(VOLCANO.node.r + 0.1), `${id} 过河位置 x=${x}`);   // 不经过祭坛(占领圈)
    assert.ok(inLava(VOLCANO, u.x, u.z) || u.status.burn > 0, `${id} 过河时在烧`);
  }
});

test('中间有敌人进入视野时,侧路单位转向追击', () => {
  const g = game(), u = place(g, 'steel_infantry', -3.4, 1.9);
  const foe = place(g, 'swarm_warrior', -0.5, 0.2, 'e');   // 站在祭坛上(不烧),离侧路单位约 3.3 格 < 视野 3.5
  foe.status.stun = 99;
  for (let i = 0; i < 10; i++) { g.tick(0.1); g.drainEvents(); }
  assert.equal(u.target, foe, '目标切到中间的敌人');
  assert.ok(u.x > -3.2, `往中间走 x=${u.x.toFixed(2)}`);
});

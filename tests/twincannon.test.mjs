// 中路前哨炮 × 2(原中路一座前哨塔):交叉火力、中路留通道、两座可以分别摧毁(皇冠 / 塔计数 / 联机快照)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { PRESET_DECKS, CARDS } from '../js/cards.js';
import { mapForScene, wallGap } from '../js/map.js';
import { makeSnapshot, applySnapshot } from '../js/net.js';

const OLD = { hp: 400, atk: 28, interval: 1.0 };
const game = (sceneId = 'starcore') => new Game('steel', 'swarm', { p: PRESET_DECKS.steel, e: PRESET_DECKS.swarm }, { sceneId, autoPick: [], prep: 0 });

test('每方两座前哨炮,左右对称;单座血 / 攻是原来的 55–60%,两座合计每秒火力略低于原来', () => {
  for (const id of ['starcore', 'glacier', 'volcano']) {
    const c = mapForScene(id).towers.filter(t => t.kind === 'outpost');
    assert.equal(c.length, 2, id);
    assert.equal(c[0].x, -c[1].x); assert.equal(c[0].z, c[1].z);
    for (const t of c) {
      assert.ok(t.hp / OLD.hp >= 0.55 && t.hp / OLD.hp <= 0.6);
      assert.ok(t.atk / OLD.atk >= 0.55 && t.atk / OLD.atk <= 0.6);
    }
    const dps = c.reduce((a, t) => a + t.atk / t.interval, 0);
    assert.ok(dps < OLD.atk / OLD.interval && dps > OLD.atk / OLD.interval * 0.85, `合计每秒 ${dps.toFixed(1)}`);
  }
});

test('中路留通道,前哨炮不压岩脊;比侧翼塔小一档', () => {
  const m = mapForScene('starcore'), [a, b] = m.towers.filter(t => t.kind === 'outpost'), py = m.towers.find(t => t.kind === 'pylon');
  assert.ok(Math.abs(a.x - b.x) - a.radius - b.radius >= 1.2, '中间通道 ≥ 1.2');
  for (const id of ['starcore', 'glacier', 'volcano']) for (const t of mapForScene(id).towers) assert.ok(wallGap(t.x, t.z, mapForScene(id)) > t.radius, `${id} ${t.kind} 压岩脊`);
  assert.ok(a.radius < py.radius);
});

test('两座前哨炮可以分别被摧毁:皇冠逐个计数,另一座照常开火', () => {
  const g = game();
  const [c1, c2] = g.structures.filter(s => s.side === 'e' && s.kind === 'outpost');
  g.damage(c1, 9999);
  assert.ok(c1.dead && !c2.dead);
  assert.equal(g.crowns('p'), 1);
  const u = g.spawnUnit('p', CARDS.steel_tank, c2.x, c2.z + 1.0, 1)[0];
  u.status.stun = 99;
  const hp0 = u.hp;
  for (let i = 0; i < 30; i++) g.tick(0.1);
  assert.ok(u.hp < hp0, '剩下那座还在打');
  g.damage(c2, 9999);
  assert.equal(g.crowns('p'), 2);
});

test('联机快照:两座前哨炮各自同步,客户端镜像能分清', () => {
  const srv = game(), cli = game();
  const [c1] = srv.structures.filter(s => s.side === 'e' && s.kind === 'outpost');
  srv.damage(c1, 100);
  applySnapshot(cli, makeSnapshot(srv, 'p', []));
  const mirror = cli.structures.filter(s => s.side === 'e' && s.kind === 'outpost').sort((a, b) => a.x - b.x);
  const real = srv.structures.filter(s => s.side === 'e' && s.kind === 'outpost').sort((a, b) => a.x - b.x);
  assert.deepEqual(mirror.map(s => s.hp), real.map(s => s.hp));
  assert.notEqual(mirror[0].hp, mirror[1].hp);
});

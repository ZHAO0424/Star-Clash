// 星核荒原 · 陨星坠落:预警 → 砸下(双方地面 + 飞行受伤,建筑免疫)→ 星石 +1 法力;落点对称、合法、按种子可复现
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { CARDS, PRESET_DECKS } from '../js/cards.js';
import { mapForScene, wallGap } from '../js/map.js';
import { makeSnapshot, applySnapshot } from '../js/net.js';

const M = mapForScene('starcore'), C = M.meteor;
const game = (seed = 7) => new Game('steel', 'swarm', { p: PRESET_DECKS.steel, e: PRESET_DECKS.swarm }, { sceneId: 'starcore', autoPick: [], seed, prep: 0 });
const run = (g, sec) => { for (let t = 0; t < sec - 1e-9; t += 0.05) g.tick(0.05); };
const toWarn = g => { g.time = C.first - 0.01; g.tick(0.05); };

test('只有星核荒原有陨星', () => {
  assert.ok(game().meteor);
  for (const id of ['glacier', 'volcano', 'hive']) assert.ok(!mapForScene(id).meteor, id);
});

test('预警成对出现、绕星核旋转 180° 对称', () => {
  const g = game();
  toWarn(g);
  const [a, b] = g.meteor.warns;
  assert.equal(g.meteor.warns.length, 2);
  assert.ok(Math.abs(a.x + b.x) < 1e-9 && Math.abs(a.z + b.z) < 1e-9);
  assert.ok(g.drainEvents().filter(e => e.type === 'meteor_warn').length === 2);
});

test('砸下:圈内双方地面 / 飞行单位各受 120,建筑免疫', () => {
  const g = game();
  toWarn(g);
  const [a, b] = g.meteor.warns;
  const mk = (side, id, w) => { const u = g.spawnUnit(side, CARDS[id], w.x, w.z, 1)[0]; u.status.stun = 99; return u; };   // 瘫痪:站着不躲
  const pg = mk('p', 'steel_tank', a), pa = mk('p', 'mecha_drone', a), eg = mk('e', 'steel_tank', b);
  const hp = [pg.hp, pa.hp, eg.hp], towers = g.structures.map(s => s.hp);
  run(g, C.warn + 0.1);
  assert.deepEqual([hp[0] - pg.hp, eg.hp >= 0 ? hp[2] - eg.hp : 0], [C.damage, C.damage]);
  assert.ok(pa.dead || hp[1] - pa.hp === C.damage, '飞行单位也受伤');
  assert.deepEqual(g.structures.map(s => s.hp), towers, '建筑不受影响');
  const ev = g.drainEvents();
  assert.equal(ev.filter(e => e.type === 'meteor_hit').length, 2);
  assert.ok(ev.some(e => e.type === 'hit' && e.meteor));
  assert.equal(g.meteor.shards.length + ev.filter(e => e.type === 'shard_pick').length, 2, '两块星石(站在落点的单位当场捡走)');
});

test('预警圈里能动的单位会躲出去', () => {
  // 挑一个落点不在裂隙(减速)里的种子:步兵从圈心走出 1.2 格要 1.9 秒 < 3 秒预警
  let seed = 1;
  while (M.rifts.some(r => { const [x, z] = game(seed).meteor.pickSite(); return Math.hypot(x - r.x, z - r.z) < r.r + 1.3 || Math.hypot(-x - r.x, -z - r.z) < r.r + 1.3; })) seed++;
  const g = game(seed);
  toWarn(g);
  const w = g.meteor.warns[0];
  const u = g.spawnUnit('p', CARDS.steel_infantry, w.x, w.z, 1)[0];
  const hp0 = u.hp;
  run(g, C.warn + 0.1);
  assert.equal(u.hp, hp0, '躲开了');
  assert.ok(Math.hypot(u.x - w.x, u.z - w.z) > C.radius + u.radius);
});

test('星石:单位碰到给该方 +1 法力,星石消失;15 秒没人捡就消失', () => {
  const g = game();
  toWarn(g); run(g, C.warn + 0.1); g.drainEvents();
  const s = g.meteor.shards[0];
  g.p.mana = 3;
  const u = g.spawnUnit('p', CARDS.steel_tank, s.x, s.z, 1)[0]; u.status.stun = 99;
  g.tick(0.05);
  assert.ok(Math.abs(g.p.mana - 3 - 1) < 0.1, `法力 ${g.p.mana}`);
  assert.ok(!g.meteor.shards.some(x => x.id === s.id));
  assert.ok(g.drainEvents().some(e => e.type === 'shard_pick' && e.who === 'p'));
  run(g, C.shardLife + 0.5);
  assert.equal(g.meteor.shards.length, 0);
});

test('落点合法:不进部署区、不压祭坛圈、不在岩脊 / 岩石里(多种子)', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const g = game(seed), [x, z] = g.meteor.pickSite();
    for (const [px, pz] of [[x, z], [-x, -z]]) {
      assert.ok(Math.abs(pz) <= M.DEPLOY_LINE - C.clearDeploy + 1e-9, `部署区 ${seed}`);
      assert.ok(Math.hypot(px, pz) >= M.node.r + C.clearNode - 1e-9, `祭坛 ${seed}`);
      assert.ok(wallGap(px, pz, M) >= C.clearWall - 1e-9, `岩脊 ${seed}`);
      assert.ok(M.obstacles.every(o => Math.hypot(px - o.x, pz - o.z) >= o.r + C.clearWall - 1e-9), `岩石 ${seed}`);
    }
  }
});

test('同一种子落点序列相同,不同种子不同;快照能恢复预警 / 星石', () => {
  const seq = seed => { const g = game(seed); return Array.from({ length: 5 }, () => g.meteor.pickSite().map(v => +v.toFixed(6))); };
  assert.deepEqual(seq(42), seq(42));
  assert.notDeepEqual(seq(42), seq(43));
  const srv = game(5), cli = game(99);
  toWarn(srv);
  applySnapshot(cli, makeSnapshot(srv, 'e', []));   // e 方视角:坐标镜像
  assert.equal(cli.meteor.warns.length, 2);
  const mine = cli.meteor.warns.map(w => [w.x, w.z]).sort(), real = srv.meteor.warns.map(w => [-w.x, -w.z].map(v => Math.round(v * 100) / 100)).sort();
  assert.deepEqual(mine, real);
});

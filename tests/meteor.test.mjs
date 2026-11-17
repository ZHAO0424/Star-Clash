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

test('单位不自动躲预警圈:圈里交战的双方站着挨砸', () => {
  const g = game();
  toWarn(g);
  const w = g.meteor.warns[0];
  const a = g.spawnUnit('p', CARDS.steel_tank, w.x, w.z, 1)[0], b = g.spawnUnit('e', CARDS.steel_tank, w.x + 0.3, w.z, 1)[0];
  run(g, C.warn + 0.1);
  const hits = g.drainEvents().filter(e => e.type === 'hit' && e.meteor).map(e => e.unit);
  assert.ok(hits.includes(a) && hits.includes(b), '双方都被砸到');
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

// ── 第六轮(2026-11-17):眩晕、陨坑、去掉两侧裂隙 ──
const toImpact = g => { toWarn(g); run(g, C.warn + 0.05); };

test('星核荒原没有两侧圆形裂隙(其它未开放地图仍用 MAP 默认的两个)', () => {
  assert.equal(M.rifts.length, 0);
  assert.equal(mapForScene('hive').rifts.length, 2);
});

test('砸中的单位额外瘫痪 1.5 秒;免控的混沌构造体只吃伤害', () => {
  const g = game();
  toWarn(g);
  const [a, b] = g.meteor.warns;
  run(g, C.warn - 0.1);   // 临砸下前才放单位(飞得快的无人机 3 秒能飞出圈)
  const tank = g.spawnUnit('p', CARDS.steel_tank, a.x, a.z, 1)[0], drone = g.spawnUnit('p', CARDS.mecha_drone, a.x, a.z, 1)[0];
  const cons = g.spawnUnit('e', CARDS.chaos_construct, b.x, b.z, 1)[0];
  const hp = cons.hp;
  run(g, 0.2);
  assert.ok(Math.abs(tank.status.stun - C.stun) < 0.25, `坦克瘫痪 ${tank.status.stun}`);
  assert.ok(drone.dead || drone.status.stun > C.stun - 0.25, '飞行单位也被砸晕');
  assert.equal(cons.status.stun, 0, '构造体免疫瘫痪');
  assert.equal(hp - cons.hp, C.damage, '构造体照样受伤');
});

test('陨坑:坑内地面单位被拉向坑心(自身步速 × pull);飞行单位、坑外单位不受影响;坑不叠加伤害', () => {
  const g = game();
  toImpact(g); g.drainEvents();
  const cr = g.meteor.craters[0];
  assert.equal(g.meteor.craters.length, 2);
  const mk = (id, dx) => { const u = g.spawnUnit('p', CARDS[id], cr.x + dx, cr.z, 1)[0]; u.status.stun = 99; return u; };   // 瘫痪:站着不动,只看吸力
  const ground = mk('steel_tank', 0.7), air = mk('mecha_drone', -0.7), ax = air.x, gx = ground.x - cr.x;
  const out = g.spawnUnit('p', CARDS.steel_tank, cr.x, cr.z + C.craterR + 0.3, 1)[0]; out.status.stun = 99;
  const hp = ground.hp, z0 = out.z;
  run(g, 1);
  assert.ok(Math.abs(gx - (ground.x - cr.x) - C.pull * ground.speed) < 0.02, `拉近 ${(gx - (ground.x - cr.x)).toFixed(3)}`);
  assert.equal(air.x, ax, '飞行单位不被拉');
  assert.ok(Math.abs(out.z - z0) < 1e-9, '坑外不被拉');
  assert.equal(ground.hp, hp, '坑不叠加伤害');
  run(g, 6 / C.pull);
  assert.ok(g.meteor.craters.length === 0 || Math.hypot(ground.x - cr.x, ground.z - cr.z) < 1e-6, '最多拉到坑心,不越过');
});

test('陨坑吸不死人:最慢的地面单位从坑心也能往外走', () => {
  const g = game();
  toImpact(g);
  const cr = g.meteor.craters[0];
  g.meteor.shards = [];   // 不让它先去捡坑心的星石
  const u = g.spawnUnit('p', CARDS.steel_artillery, cr.x, cr.z, 1)[0];
  u.status.stun = 0;
  assert.ok(C.pull < 0.5, `吸力占步速 ${C.pull}`);   // 按百分比:任何单位净速度都 ≥ 一半
  // 炮兵在坑心正常行军(朝敌方建筑),4 秒后离坑心更远
  run(g, 4);
  const d = Math.hypot(u.x - cr.x, u.z - cr.z);
  assert.ok(d > 0.3, `4 秒走出 ${d.toFixed(2)}`);
});

test('陨坑 8 秒后消失;快照能恢复陨坑(e 方视角镜像)', () => {
  const srv = game(5), cli = game(99);
  toImpact(srv);
  applySnapshot(cli, makeSnapshot(srv, 'e', []));
  const mine = cli.meteor.craters.map(c => [c.x, c.z]).sort(), real = srv.meteor.craters.map(c => [-c.x, -c.z].map(v => Math.round(v * 100) / 100)).sort();
  assert.deepEqual(mine, real);
  assert.ok(Math.abs(cli.meteor.craters[0].left - C.craterLife) < 0.2);
  run(srv, C.craterLife + 0.1);
  assert.equal(srv.meteor.craters.length, 0);
  applySnapshot(cli, makeSnapshot(srv, 'p', []));
  assert.equal(cli.meteor.craters.length, 0);
});

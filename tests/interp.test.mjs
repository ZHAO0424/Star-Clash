// 抖动缓冲插值:快照迟到 0~150ms 随机,渲染位置仍应平滑前进、不长时间冻结
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolate, playoutDelay, makeSnapshot, applySnapshot } from '../js/net.js';
import { Game } from '../js/game.js';
import { PRESET_DECKS } from '../js/cards.js';

// 直接构造 applySnapshot 写下的状态(_clk + 单位样本),避免依赖整局 Game
function feed(mirror, st, arrive, x) {
  const sample = st - arrive;
  const clk = mirror._clk ??= { off: sample, jit: 20 };
  if (sample > clk.off) clk.off += (sample - clk.off) * 0.2;
  else { clk.jit += (clk.off - sample - clk.jit) * 0.1; clk.off += (sample - clk.off) * 0.002; }
  const u = mirror.units[0];
  u._s.push([st, x, 0]);
  if (u._s.length > 6) u._s.shift();
}

function run(maxLate, seed = 1) {
  let r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const mirror = { units: [{ x: 0, z: 0, _s: [] }] };
  const SPEED = 1 / 1000;              // 每 ms 走 0.001
  const snaps = [];
  // WebSocket 走 TCP,快照按发送顺序到达:迟到的那条会把后面的一起堵住,然后成串到达
  let last = 0;
  for (let st = 0; st <= 6000; st += 60) {
    last = Math.max(last, st + 40 + rand() * maxLate);
    snaps.push({ st, arrive: last, x: st * SPEED });
  }
  const xs = [];
  let si = 0;
  for (let now = 0; now <= 6200; now += 16) {
    while (si < snaps.length && snaps[si].arrive <= now) { const s = snaps[si++]; feed(mirror, s.st, s.arrive, s.x); }
    interpolate(mirror, now);
    if (mirror._clk) xs.push(mirror.units[0].x);
  }
  return { xs, mirror };
}

test('快照迟到 0~150ms(TCP 成串到达)时单位位置不倒退、不跳、不冻结', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const steady = run(150, seed).xs.slice(30);   // 跳过开头缓冲建立
    let frozen = 0, maxFrozen = 0;
    for (let i = 1; i < steady.length; i++) {
      const d = steady[i] - steady[i - 1];
      assert.ok(d > -1e-9, `seed ${seed} 第 ${i} 帧倒退 ${d}`);
      assert.ok(d < 0.016 * 3, `seed ${seed} 第 ${i} 帧跳跃 ${d}`);
      frozen = d < 1e-6 ? frozen + 1 : 0;
      maxFrozen = Math.max(maxFrozen, frozen);
    }
    assert.ok(maxFrozen <= 2, `seed ${seed} 连续冻结 ${maxFrozen} 帧`);
  }
});

test('网络越抖缓冲越大,但有上限', () => {
  const calm = run(10).mirror._clk, rough = run(150).mirror._clk;
  assert.ok(playoutDelay(rough) > playoutDelay(calm));
  assert.ok(playoutDelay(rough) <= 300 && playoutDelay(calm) >= 100);
});

test('真实快照链路:服务器时钟字段不和其他字段撞名,客户端缓冲状态是有限数', () => {
  const server = new Game('steel', 'swarm', { p: PRESET_DECKS.steel, e: PRESET_DECKS.swarm }, { sceneId: 'starcore', prep: 0 });
  const client = new Game('steel', 'swarm', {}, { autoPick: [], sceneId: 'starcore' });
  server.p.mana = 10;
  assert.ok(server.playCard('p', 0, 0, 4) || server.playCard('p', 1, 0, 4));
  for (let i = 0; i < 5; i++) {
    server.tick(0.05);
    const snap = makeSnapshot(server, 'p', []);
    assert.ok(Number.isFinite(snap.sc) && Array.isArray(snap.st));
    applySnapshot(client, snap);
  }
  interpolate(client);
  for (const k of ['off', 'jit', 'd']) assert.ok(Number.isFinite(client._clk[k]), k);
  for (const u of client.units) assert.ok(Number.isFinite(u.x) && Number.isFinite(u.z));
});

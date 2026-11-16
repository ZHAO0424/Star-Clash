// 开局准备阶段:5 秒内不回蓝、不能出牌 / 弃牌、单位不行动、计时器不走;之后进入 battle。新手引导传 prep: 0 直接开战
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, PREP_TIME } from '../js/game.js';
import { PRESET_DECKS } from '../js/cards.js';
import { makeSnapshot, applySnapshot } from '../js/net.js';

const game = opts => new Game('steel', 'swarm', { p: PRESET_DECKS.steel, e: PRESET_DECKS.swarm }, { sceneId: 'starcore', ...opts });

test('准备阶段:不回蓝、不能出牌 / 弃牌、计时器不走,5 秒后开战', () => {
  const g = game();
  assert.equal(PREP_TIME, 5);
  assert.equal(g.phase, 'prep');
  const mana = g.p.mana;
  for (let i = 0; i < 45; i++) g.tick(0.1);   // 4.5 秒
  assert.equal(g.phase, 'prep');
  assert.equal(g.p.mana, mana);
  assert.equal(g.time, 0);
  assert.equal(g.canPlay('p', 0), false);
  assert.equal(g.playCard('p', 0, 0, 4), false);
  assert.equal(g.canDiscard('p', 0), false);
  for (let i = 0; i < 6; i++) g.tick(0.1);
  assert.equal(g.phase, 'battle');
  assert.ok(g.drainEvents().some(ev => ev.type === 'battle_start'));
  g.tick(1);
  assert.ok(g.p.mana > mana && g.time > 0);
});

test('prep: 0 直接开战(新手引导)', () => {
  assert.equal(game({ prep: 0 }).phase, 'battle');
});

test('快照带剩余准备时间(联机 / 断线重连)', () => {
  const server = game();
  server.tick(1.2);
  const client = new Game('steel', 'swarm', {}, { autoPick: [], sceneId: 'starcore' });
  applySnapshot(client, makeSnapshot(server, 'p', []));
  assert.equal(client.phase, 'prep');
  assert.ok(Math.abs(client.prepLeft - 3.8) < 0.02);
});

// 分路:侧路出生的单位没看到敌人时只打本路侧翼塔,不会因为中路前哨炮更近斜穿祭坛;中路单位打前哨炮;本路塔倒了打核心
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { CARDS, PRESET_DECKS } from '../js/cards.js';

const game = sceneId => new Game('steel', 'chaos', { p: PRESET_DECKS.steel, e: PRESET_DECKS.chaos }, { sceneId, autoPick: [], prep: 0 });

for (const sceneId of ['volcano', 'starcore', 'glacier']) {
  test(`${sceneId}:侧路单位打本路侧翼塔,中路单位打前哨炮`, () => {
    const g = game(sceneId);
    for (const [x, kind, sign] of [[3.3, 'pylon', 1], [-3.3, 'pylon', -1], [0.3, 'outpost', null]]) {
      for (const id of ['steel_infantry', 'steel_siege']) {
        const u = g.spawnUnit('p', CARDS[id], x, 3.0, 1)[0];
        const t = g.pickTarget(u);
        assert.equal(t.kind, kind, `${id} @x=${x}`);
        if (sign) assert.equal(Math.sign(t.x), sign);
        g.kill(u);
      }
    }
  });
}

test('本路侧翼塔倒了就打核心,不换去别的路', () => {
  const g = game('volcano');
  for (const s of g.structures) if (s.side === 'e' && s.kind === 'pylon' && s.x > 0) s.dead = true;
  const u = g.spawnUnit('p', CARDS.steel_infantry, 3.3, 3.0, 1)[0];
  assert.equal(g.pickTarget(u).kind, 'base');
});

test('侧路单位行军时不穿过祭坛占领圈', () => {
  const g = game('volcano');
  g.e.hand = []; g.p.hand = [];
  const u = g.spawnUnit('p', CARDS.steel_tank, 3.3, 3.0, 1)[0];
  let minX = Infinity;
  for (let t = 0; t < 40 && !u.dead; t += 0.05) { g.tick(0.05); minX = Math.min(minX, Math.abs(u.x)); if (u.target && !u.target.kind) break; }
  assert.ok(minX > g.map.node.r + 0.3, `最靠中 |x| = ${minX.toFixed(2)}`);
});

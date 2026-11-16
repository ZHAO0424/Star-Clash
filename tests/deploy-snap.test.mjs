// game.nearestDeploySpot:被岩石 / 墙 / 建筑挡住时就近找空位(结果必须过同一个 deployBlockReason)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, DEPLOY_LINE, FIELD_HALF } from '../js/game.js';
import { CARDS, PRESET_DECKS } from '../js/cards.js';

const game = () => new Game('steel', 'swarm', { p: PRESET_DECKS.steel, e: PRESET_DECKS.swarm }, { sceneId: 'starcore' });
const unit = CARDS.steel_infantry;

test('合法落点原样返回', () => {
  const g = game();
  assert.deepEqual(g.nearestDeploySpot('p', unit, 0, 4), { x: 0, z: 4 });
});

test('压在岩石上:1 格内找到合法空位', () => {
  const g = game();
  const rock = g.map.obstacles.find(o => o.z >= DEPLOY_LINE && o.z < FIELD_HALF - 0.5 && o.r <= 0.7);   // 部署线 2.0 后,中路岩石(z = 2.1)正好压在线后
  assert.ok(rock, '己方半场应有岩石');
  assert.equal(g.deployBlockReason('p', unit, rock.x, rock.z), 'deployRock');
  const spot = g.nearestDeploySpot('p', unit, rock.x, rock.z);
  assert.ok(spot, '应找到空位');
  assert.equal(g.deployBlockReason('p', unit, spot.x, spot.z), null);
  assert.ok(Math.hypot(spot.x - rock.x, spot.z - rock.z) <= 1.0 + 1e-9);
});

test('越过部署线 / 出界不吸附', () => {
  const g = game();
  assert.equal(g.nearestDeploySpot('p', unit, 0, DEPLOY_LINE - 0.5), null);
  assert.equal(g.nearestDeploySpot('p', unit, 0, FIELD_HALF + 1), null);
});

test('部署区:离中线 2.0 以外,纵深占半场约 71%;熔岩河整条在部署区外', async () => {
  const { mapForScene, lavaCenterZ } = await import('../js/map.js');
  assert.equal(DEPLOY_LINE, 2.0);
  assert.ok(Math.abs((FIELD_HALF - DEPLOY_LINE) / FIELD_HALF - 0.71) < 0.01);
  const g = game();
  assert.equal(g.deployBlockReason('p', unit, 0.5, DEPLOY_LINE - 0.01), 'deploySide');
  assert.equal(g.deployBlockReason('p', unit, 0.5, DEPLOY_LINE + 0.01), null);
  assert.equal(g.deployBlockReason('e', unit, 0.5, -DEPLOY_LINE + 0.01), 'deploySide');
  for (const id of ['starcore', 'glacier', 'volcano']) assert.equal(mapForScene(id).DEPLOY_LINE, DEPLOY_LINE, id);
  const V = mapForScene('volcano');
  for (let x = -V.W; x <= V.W; x += 0.05) assert.ok(Math.abs(lavaCenterZ(V.lava, V.W, x)) + V.lava.half + 0.22 < DEPLOY_LINE);
});

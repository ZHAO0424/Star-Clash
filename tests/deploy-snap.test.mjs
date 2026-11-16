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
  const rock = g.map.obstacles.find(o => o.z > DEPLOY_LINE + 0.5 && o.z < FIELD_HALF - 0.5 && o.r <= 0.7);
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

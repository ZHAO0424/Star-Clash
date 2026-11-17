// 单位显示尺寸的体型分档(unit-size.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS } from '../js/cards.js';
import { sizeClassOf, unitDisplaySize, SIZE_CLASSES } from '../js/unit-size.js';

const rigOf = id => (/infantry|shield|banner|walker|arc|sniper|warrior|wraith|construct|zealot|berserker|soulreaver/.test(id) ? 'biped' : 'rigid');
const units = Object.values(CARDS).filter(c => c.type === 'unit');

test('每个单位都归到一个体型档', () => {
  for (const c of units) assert.ok(SIZE_CLASSES[sizeClassOf(c, rigOf(c.id))], c.id);
});

test('坦克和攻城车同档(重型载具),占地上限一致', () => {
  assert.equal(sizeClassOf(CARDS.steel_tank, 'rigid'), 'heavy');
  assert.equal(sizeClassOf(CARDS.steel_siege, 'rigid'), 'heavy');
  assert.equal(unitDisplaySize(CARDS.steel_tank, 'rigid').foot, unitDisplaySize(CARDS.steel_siege, 'rigid').foot);
});

test('体型档相对第一轮整体缩小:步兵 / 载具都比第一轮 1.3 倍时小', () => {
  // 第一轮:模型高 = (0.75 + 0.1·min(费用, 6)) × 0.85 × 1.3;非人形占地上限 = 0.22·2·2.4·1.3 = 1.37
  const old = c => (0.75 + 0.1 * Math.min(c.cost, 6)) * ((c.count || 1) > 1 || c.token ? 0.72 : 1) * 0.85 * 1.3;
  for (const c of units) {
    const s = unitDisplaySize(c, rigOf(c.id));
    assert.ok(s.h < old(c), `${c.id} ${s.h} ≥ ${old(c).toFixed(2)}`);
    assert.ok(s.foot < 1.37 + 0.1, c.id);
  }
  assert.ok(SIZE_CLASSES.swarm.h < SIZE_CLASSES.infantry.h && SIZE_CLASSES.infantry.h < SIZE_CLASSES.medium.h && SIZE_CLASSES.medium.h < SIZE_CLASSES.giant.h);
});

test('第二轮整体再缩约 15%:各档高度和占地都按同一比例缩,档间关系不变', () => {
  // 第一轮分档(2026-11-16)的值
  const prev = { swarm: [0.6, 0.68], infantry: [0.9, 1.0], medium: [1.06, 1.12], heavy: [0.86, 1.12], giant: [1.28, 1.45], air: [0.78, 1.12] };
  for (const [cls, [h, foot]] of Object.entries(prev)) {
    assert.ok(Math.abs(SIZE_CLASSES[cls].h / h - 0.85) < 0.01, `${cls} h`);
    assert.ok(Math.abs(SIZE_CLASSES[cls].foot / foot - 0.85) < 0.01, `${cls} foot`);
  }
});

test('飞行单位(含一次出多只的)按飞行档,不缩成虫群小兵', () => {
  for (const c of units.filter(c => c.air)) assert.equal(sizeClassOf(c, 'rigid'), 'air', c.id);
});

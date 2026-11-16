// 单位显示尺寸:按体型分档(纯数据,不依赖 three;scene.js 渲染与单测共用)
//   第一轮把所有非建筑单位统一放大 1.3 倍,高度再按费用涨 → 坦克 / 攻城车被占地上限顶到 1.37、步兵 1.05–1.11 高,整体偏大。
//   现在每个单位先归到一个体型档,档内统一目标高度 h 和占地上限 foot(格):
//     · 模型按高度缩放到 h,再用 foot 限占地(人形 T 字静止姿势会把宽度算大,所以人形不限占地)
//     · 扁宽的载具(坦克、攻城车)实际由 foot 决定大小 → 同一档的两辆车占地一样、体型接近
//   只改渲染缩放:碰撞半径、射程、底环、部署特效档位(cards.deployFxRadius)都不动;血条高度跟着实际模型高度走
export const SIZE_CLASSES = {
  swarm:    { h: 0.6,  foot: 0.68, label: '虫群小兵(一次出多只 / 衍生物)' },
  infantry: { h: 0.9,  foot: 1.0,  label: '步兵' },
  medium:   { h: 1.06, foot: 1.12, label: '中型(机甲 / 精英 / 炮台)' },
  heavy:    { h: 0.86, foot: 1.12, label: '重型载具(坦克 / 攻城车 / 吞噬者)' },
  giant:    { h: 1.28, foot: 1.45, label: '巨型' },
  air:      { h: 0.78, foot: 1.12, label: '飞行' },
};
// 规则判不准的个别单位直接指定(目前没有;旗手按步兵档,旗杆自然比人高)
const OVERRIDE = {};

// rig:模型元数据里的骨架类型('biped' / 'hexapod' / 'rigid' …);没有模型时不传
export function sizeClassOf(card, rig) {
  if (OVERRIDE[card.id]) return OVERRIDE[card.id];
  if (card.air) return 'air';   // 飞行在前:一次出 2–3 只的蝙蝠 / 蜂群无人机也按飞行档,不缩成虫群小兵
  if ((card.count || 1) > 1 || card.token) return 'swarm';
  if (card.cost >= 6) return 'giant';
  if (rig !== 'biped' && card.hp >= 300) return 'heavy';
  if (card.cost >= 4) return 'medium';
  return 'infantry';
}

export function unitDisplaySize(card, rig) {
  const cls = sizeClassOf(card, rig);
  return { cls, ...SIZE_CLASSES[cls] };
}

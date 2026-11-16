// 「装甲维修」这类范围治疗法术的自动吸附(纯函数,桌面版 / XR / 测试共用,不依赖 three):
// 拖牌时落点吸到离手最近的受伤己方单位身上(吸附范围 RANGE 格,滞回 HYSTERESIS 格防止两个目标之间来回跳),
// 松手时就在那个单位的位置释放;范围内其余受伤单位一并列出(画小标记)。附近没有受伤单位时不吸附、照常可放。

export const HEAL_SNAP = { RANGE: 3.0, HYSTERESIS: 0.6 };

// 哪些牌走自动吸附
export const autoTargets = card => card?.effect === 'heal_area';

// units:game.units;who:'p' | 'e';card:法术牌(用 card.radius);(x, z):当前落点(战场坐标);
// prevId:上一帧吸附的单位 id(滞回用)。返回 { target(单位或 null), x, z(释放点), others(范围内其余受伤单位) }
export function healSnap(units, who, card, x, z, prevId = null) {
  const injured = units.filter(u => u.side === who && !u.dead && !u.building && u.hp < u.maxHp);
  const dist = u => Math.hypot(u.x - x, u.z - z);
  let target = null;
  for (const u of injured) if (dist(u) <= HEAL_SNAP.RANGE && (!target || dist(u) < dist(target))) target = u;
  const prev = prevId == null ? null : injured.find(u => u.id === prevId && dist(u) <= HEAL_SNAP.RANGE + HEAL_SNAP.HYSTERESIS);
  if (prev && (!target || dist(prev) <= dist(target) + HEAL_SNAP.HYSTERESIS)) target = prev;
  const cx = target ? target.x : x, cz = target ? target.z : z;
  const others = injured.filter(u => u !== target && Math.hypot(u.x - cx, u.z - cz) <= card.radius + (u.radius ?? 0));
  return { target, x: cx, z: cz, others };
}

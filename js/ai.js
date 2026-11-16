// AI — 双方通用(who = 'p' | 'e'),用于对手 AI 和平衡模拟
//
// level:
//   'smart'(默认)战略 AI:每 ~1 秒评估一次局势,按优先级选择行动
//       1. 法术:有足够收益的目标才放(含用炮击收掉残血塔)
//       2. 防守:有威胁时按威胁构成挑应对牌,部署在威胁与己方基地之间
//       3. 补援:刚发起的进攻,在坦克后方补远程/范围支援
//       4. 反击:防守成功后,给推进中的幸存单位补兵
//       5. 星核:星核不归自己且己方在场兵力不占优时,派耐打的单位去占
//       6. 进攻:法力攒够才发起(坦克/攻城打头),挑防守最薄的塔,避开裂隙
//       7. 法力将满时不浪费:出性价比最高的牌
//   'normal' 战略 AI 的减速版:每 ~2 秒评估一次,25% 概率随手出牌(普通难度)
//   'basic' 旧版:每 2.5~4 秒出一张牌,只按费用挑牌(简单难度,也是强度对照)

import { CARDS } from './cards.js';
import { dist2, FIELD_W, FIELD_HALF } from './game.js';
import { wallGap } from './map.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const value = u => u.hp + u.atk * 3 + (u.shield || 0);
const AREA_DAMAGE = new Set(['stun_area', 'dot_area', 'strike', 'curse', 'parasite', 'chain']);
const isRanged = c => c.range > 1.2 && c.atk > 0;
const isSupport = c => isRanged(c) || c.splash || c.chain || c.aura || (c.count || 1) > 1 || c.air;

export class SimpleAI {
  constructor(game, who = 'e', { level = 'smart' } = {}) {
    this.game = game;
    this.who = who;
    this.level = level;
    this.foe = who === 'p' ? 'e' : 'p';
    this.dir = who === 'p' ? 1 : -1;     // 己方半场 z 的符号
    this.timer = 2.0;
    this.push = null;                    // 进行中的进攻 { unit, t }
  }

  // 敌方单位已压进我方一侧(越过中线 1 格以内也算)
  // 建筑卡不会移动:只有放进我方半场的才算威胁(对方贴着中线放的炮台不该骗 AI 连出防守牌)
  threatening(u) { return u.building ? u.z * this.dir > 0 : u.z * this.dir > -1.0; }
  // 单位离中线的"己方深度"(己方半场为正)
  depthOf(u) { return u.z * this.dir; }

  // 己方半场坐标:depth = 离中线的距离;落在岩石里则螺旋搜索最近的合法点
  own(x, depth) {
    const x0 = clamp(x, -FIELD_W + 0.3, FIELD_W - 0.3);
    const d0 = clamp(depth, this.game.map.DEPLOY_LINE + 0.1, FIELD_HALF - 1.0);
    for (let k = 0; k < 48; k++) {
      const r = 0.15 * Math.ceil(k / 8) * 2;
      const a = (k % 8) / 8 * Math.PI * 2;
      const px = clamp(x0 + Math.cos(a) * r, -FIELD_W + 0.3, FIELD_W - 0.3);
      const pd = clamp(d0 + Math.sin(a) * r, this.game.map.DEPLOY_LINE + 0.1, FIELD_HALF - 0.5);
      const pz = this.dir * pd;
      if (this.game.canDeployAt(this.who, CARDS.steel_infantry, px, pz) && wallGap(px, pz, this.game.map) >= 0.5) return { x: px, z: pz };
    }
    return { x: 0, z: this.dir * (FIELD_HALF - 1.5) };
  }

  bestCluster(units, centers, r) {
    let best = null, bv = 0, bn = 0;
    for (const c of centers) {
      const inR = units.filter(o => dist2(o, c) <= r + o.radius);
      const v = inR.reduce((a, o) => a + value(o), 0);
      if (v > bv) { bv = v; best = c; bn = inR.length; }
    }
    return { pt: best, value: bv, count: bn };
  }

  // 混沌 · 血祭:核心生命充足(> 60%)且只差 1~2 点法力时才肯用核心生命补(简单 AI 不会)
  willBleed(card) {
    const g = this.game, s = g.side(this.who);
    if (this.level === 'basic' || g.bloodCost(this.who, card) === null) return false;
    return s.baseHP > s.baseHPMax * 0.6 && card.cost - s.mana <= 2;
  }

  // ── 局势分析 ──
  analyze() {
    const g = this.game, s = g.side(this.who);
    const foes = g.units.filter(u => u.side === this.foe);
    const mine = g.units.filter(u => u.side === this.who);
    let threat = null, threatVal = 0;
    for (const u of foes) {
      if (!this.threatening(u)) continue;
      const v = foes.filter(o => dist2(o, u) < 1.8).reduce((a, o) => a + value(o), 0);
      if (v > threatVal) { threatVal = v; threat = u; }
    }
    return {
      g, s, foes, mine, mobile: mine.filter(u => !u.building), threat, threatVal,
      affordable: s.hand.map((card, idx) => ({ card, idx })).filter(x => s.mana >= x.card.cost || this.willBleed(x.card)),
    };
  }

  // ── 法术(两种难度共用)──
  trySpells(ctx) {
    const { g, foes, mobile, threat, threatVal } = ctx;
    for (const sp of ctx.affordable.filter(x => x.card.type === 'spell')) {
      const c = sp.card, e = c.effect;
      const play = (x, z) => g.playCard(this.who, sp.idx, x, z);

      if (e === 'strike' && this.level === 'smart') {
        // 收残血塔:炮击对建筑的伤害足以摧毁
        const t = g.structures.find(t => t.side === this.foe && !t.dead && t.hp <= c.damage * c.structFactor);
        if (t && play(t.x, t.z)) return true;
      }
      if (AREA_DAMAGE.has(e)) {
        let targets = e === 'parasite' ? foes.filter(u => !u.building) : foes;
        // 诅咒本身不造成伤害:只对正在和己方单位 / 塔交火的敌人放
        if (e === 'curse') targets = targets.filter(f => mobile.some(u => dist2(u, f) < 2.2) ||
          g.structures.some(s => s.side === this.who && !s.dead && dist2(s, f) < s.range + s.radius));
        const cl = this.bestCluster(targets, targets, c.radius);
        if (cl.pt && (cl.count >= 2 || cl.value >= 500) && cl.value >= c.cost * 90) {
          if (play(cl.pt.x, cl.pt.z)) return true;
        }
        continue;
      }
      if (e === 'hack') {
        const t = foes.filter(u => !u.building && !u.card.unstoppable && u.card.cost >= 4).sort((a, b) => value(b) - value(a))[0];
        if (t && this.threatening(t) && play(t.x, t.z)) return true;
        continue;
      }
      if (e === 'shield_area' || e === 'sacrifice') {
        const engaged = mobile.filter(u => foes.some(f => dist2(f, u) < 1.8));
        if (e === 'shield_area') {
          const cl = this.bestCluster(engaged, engaged, c.radius);
          if (cl.count >= 2 && play(cl.pt.x, cl.pt.z)) return true;
        } else {
          // 献祭:按"炸掉的敌方价值 - 牺牲的己方价值"挑落点(施法范围内的己方单位全部爆裂)
          let best = null, bv = 0;
          for (const u of engaged) {
            const victims = mobile.filter(m => dist2(m, u) <= c.radius + m.radius);
            const lost = victims.reduce((a, m) => a + value(m), 0);
            let gain = 0;
            for (const f of foes) {
              const dmg = victims.filter(m => dist2(m, f) <= c.burstRadius).reduce((a, m) => a + m.hp * c.factor, 0);
              if (dmg > 0) gain += value(f) * Math.min(1, dmg / Math.max(1, f.hp));
            }
            // 价值按当前生命算,快死的单位本来就不值钱;损失全额计入,不做亏本交换
            const net = gain - lost;
            if (net > bv) { bv = net; best = u; }
          }
          if (best && bv >= 150 && play(best.x, best.z)) return true;
        }
        continue;
      }
      if (e === 'spawn') {
        const pos = threat ? this.own(threat.x, Math.max(0, this.depthOf(threat)) + 1) : null;
        if (pos && threatVal > 150 && play(pos.x, pos.z)) return true;
        continue;
      }
      if (e === 'convert') {
        // 按法术的真实选目标规则(费用不超过上限的敌人中生命最低的)预判,值得才放
        const t = foes.filter(u => !u.building && u.card.cost <= (c.maxCost ?? 99)).sort((a, b) => a.hp - b.hp)[0];
        if (t && t.card.cost >= 3 && value(t) >= 250 && play()) return true;
        continue;
      }
      if (e === 'mimic') {
        // 按真实选目标规则预判:找能复制到最贵单位的落点(以敌人位置为候选),3 费以上才值得
        let best = null;
        for (const u of foes) {
          const t = g.mimicTarget(g.other(this.who), u, c);
          if (t && (!best || t.card.cost > best.t.card.cost)) best = { t, x: u.x, z: u.z };
        }
        if (best && best.t.card.cost >= 4 && play(best.x, best.z)) return true;
        continue;
      }
      if (e === 'heal_area') {
        // 装甲维修:以受伤的己方单位为候选落点,按范围内实际能回的血量(每个单位封顶 value)估收益,值得才放
        let best = null, healed = 0;
        for (const center of mobile.filter(u => u.hp < u.maxHp)) {
          const v = mobile.filter(m => dist2(m, center) <= c.radius + m.radius).reduce((a, m) => a + Math.min(c.value, m.maxHp - m.hp), 0);
          if (v > healed) { healed = v; best = center; }
        }
        if (best && healed >= c.cost * 80 && play(best.x, best.z)) return true;
        continue;
      }
      if ((e === 'buff_atk' || e === 'evolve') && mobile.length >= 3) {
        if (play()) return true;
      }
      // 灵魂抽取:有值得打的目标(高攻)或核心受伤明显时才用,避免刷小怪浪费法力
      if (e === 'drain' && (foes.some(u => !u.building && u.atk >= 30) || g.side(this.who).baseHP <= g.side(this.who).baseHPMax - 200)) {
        if (play()) return true;
      }
    }
    return false;
  }

  // 卡手:没有能部署的牌且法力快满 → 弃掉最贵的法术
  tryDiscard(ctx) {
    const { g, s } = ctx;
    if (s.mana < s.manaMax - 1.5) return false;
    const spells = s.hand.map((c, i) => ({ c, i })).filter(x => x.c.type === 'spell');
    spells.sort((a, b) => b.c.cost - a.c.cost);
    return spells.length ? g.discard(this.who, spells[0].i) : false;
  }

  // 防守应对分
  defenseScore(c, comp) {
    let s = 1 + c.cost * 0.5;
    const hitsAir = c.hitsAir ?? c.range > 1.2;
    const area = c.splash || c.chain || c.pulse || (c.count || 1) > 1 || c.deathSpawn;
    if (c.siege || c.kamikaze) s *= 0.15;
    if (comp.air > 0.4) s *= hitsAir || c.pulse ? 2.5 : 0.25;
    if (comp.swarm >= 3 && area) s *= 2.2;
    if (comp.big && c.atk / Math.max(0.5, c.interval) >= 30) s *= 1.6;
    if (c.type === 'building' && !c.spawn) s *= 1.4;
    return s;
  }

  tick(dt) {
    if (this.game.phase !== 'battle') return;
    if (this.level === 'basic') return this.basicTick(dt);
    this.timer -= dt;
    if (this.timer > 0) return;
    const normal = this.level === 'normal';
    this.timer = normal ? 1.8 + Math.random() * 0.8 : 0.8 + Math.random() * 0.5;
    if (normal && Math.random() < 0.25) return this.basicTick(999);   // 随手出一张

    const ctx = this.analyze();
    const { g, s, foes, mobile, threat, threatVal } = ctx;
    if (!ctx.affordable.length) return;
    if (this.trySpells(ctx)) return;

    const deploy = ctx.affordable.filter(x => x.card.type !== 'spell');
    if (!deploy.length) { this.tryDiscard(ctx); return; }
    const place = (pick, pos) => g.playCard(this.who, pick.idx, pos.x, pos.z);
    const best = (list, score) => list.map(x => ({ x, v: score(x.card) })).sort((a, b) => b.v - a.v)[0]?.x;

    // 2. 防守
    if (threatVal > 150 && threat) {
      const group = foes.filter(o => dist2(o, threat) < 1.8);
      const comp = {
        air: group.filter(o => o.air).reduce((a, o) => a + value(o), 0) / Math.max(1, threatVal),
        swarm: group.filter(o => o.maxHp < 130).length,
        big: group.some(o => o.maxHp >= 350),
      };
      // 威胁不大时不必出最贵的牌:费用超过威胁价值很多的牌降权
      const pick = best(deploy, c => this.defenseScore(c, comp) * (c.cost * 110 > threatVal * 1.6 ? 0.6 : 1));
      const c = pick.card;
      const back = c.type === 'building' ? 1.6 : isRanged(c) ? 1.8 : 0.9;
      place(pick, this.own(threat.x * (c.type === 'building' ? 0.6 : 1), Math.max(0, this.depthOf(threat)) + back));
      return;
    }

    // 3. 补援:进攻发起后 4 秒内,在打头单位后方补支援
    if (this.push) {
      const p = this.push;
      if (p.unit.dead || g.time - p.t > 4) this.push = null;
      else {
        const sup = best(deploy.filter(x => isSupport(x.card) && x.card.type === 'unit'), c => c.cost + (isRanged(c) ? 2 : 0));
        if (sup) {
          place(sup, this.own(p.unit.x, Math.max(this.depthOf(p.unit), this.game.map.DEPLOY_LINE) + 1.2));
          this.push = null;
          return;
        }
      }
    }

    // 4. 反击:己方有推进中的部队(在中线附近或已过中线)且价值足够 → 在其后方补兵
    const advancing = mobile.filter(u => this.depthOf(u) < 1.5);
    const advVal = advancing.reduce((a, u) => a + value(u), 0);
    if (advVal > 350 && s.mana >= 4) {
      const cx = advancing.reduce((a, u) => a + u.x, 0) / advancing.length;
      const pick = best(deploy.filter(x => x.card.type === 'unit' && !x.card.kamikaze), c => (isSupport(c) ? 2 : 1) * c.cost);
      if (pick && s.mana >= pick.card.cost + 1) {
        place(pick, this.own(cx, this.game.map.DEPLOY_LINE + 0.4));
        return;
      }
    }

    // 5. 星核:不归自己,且己方在星核附近的兵力不占优 → 派耐打的单位去占
    const N = this.game.map.node;
    const near = (list) => list.filter(u => !u.building && Math.hypot(u.x - N.x, u.z - N.z) < N.r + 1.5)
      .reduce((a, u) => a + value(u), 0);
    if (g.node.owner !== this.who && near(mobile) <= near(foes) && s.mana >= 3) {
      const pick = best(deploy.filter(x => x.card.type === 'unit' && !x.card.siege && !x.card.kamikaze && x.card.cost <= 5),
        c => c.hp * (c.count || 1) / c.cost);
      if (pick) {
        place(pick, this.own(N.x + (Math.random() - 0.5) * 0.8, this.game.map.DEPLOY_LINE + 0.4));
        return;
      }
    }

    // 6. 进攻:法力攒到 8(或满)才发起,坦克/攻城打头
    const full = s.mana >= s.manaMax - 0.5;
    if (s.mana >= Math.min(8, s.manaMax) || full) {
      const lead = best(deploy.filter(x => x.card.type === 'unit'), c => c.hp * (c.siege ? 1.3 : 1) * (c.count || 1) + (c.kamikaze ? 150 : 0));
      if (lead) {
        const x = this.laneX();
        const u = place(lead, this.own(x, isRanged(lead.card) ? FIELD_HALF * 0.55 : 2.4)) &&
          g.units.filter(o => o.side === this.who).slice(-1)[0];
        if (u) this.push = { unit: u, t: g.time };
        return;
      }
      // 只剩建筑:产兵建筑放后场
      const b = best(deploy, c => (c.spawn ? 2 : 1) * c.cost);
      if (b) place(b, this.own((Math.random() - 0.5) * 2, FIELD_HALF * 0.6));
    }
  }

  // 进攻方向:防守最薄的敌方塔(塔血量 + 附近敌军价值),x 收向中路以避开两侧裂隙
  laneX() {
    const g = this.game;
    const towers = g.structures.filter(t => t.side === this.foe && !t.dead && t.kind !== 'base');
    if (!towers.length) return 0;
    const weak = towers.map(t => ({ t, v: t.hp + g.units.filter(u => u.side === this.foe && dist2(u, t) < 3).reduce((a, u) => a + value(u), 0) }))
      .sort((a, b) => a.v - b.v)[0].t;
    return clamp(weak.x * 0.5, -1.7, 1.7) + (Math.random() - 0.5) * 0.6;
  }

  // ── 旧版 AI(basic)──
  basicTick(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 2.5 + Math.random() * 1.5;
    const ctx = this.analyze();
    const { g, s, threat, threatVal } = ctx;
    if (!ctx.affordable.length) return;
    if (this.trySpells(ctx)) return;
    const deployables = ctx.affordable.filter(x => x.card.type !== 'spell');
    if (!deployables.length) { this.tryDiscard(ctx); return; }

    const hasBig = s.hand.some(c => c.type !== 'spell' && c.cost > s.mana);
    if (threatVal < 150 && hasBig && s.mana < s.manaMax - 1 && Math.random() < 0.6) return;

    let pool = deployables;
    if (threatVal > 150) {
      const def = deployables.filter(x => !x.card.siege);
      if (def.length) pool = def;
    }
    pool.sort((a, b) => b.card.cost - a.card.cost);
    const pick = Math.random() < 0.7 ? pool[0] : pool[Math.floor(Math.random() * pool.length)];
    const c = pick.card;
    const ranged = c.range > 1.2;
    let pos;
    if (c.type === 'building') {
      pos = this.own(threat ? threat.x * 0.6 : (Math.random() - 0.5) * 2, 2.4);
    } else if (threatVal > 150 && threat && !c.siege) {
      pos = this.own(threat.x + (Math.random() - 0.5) * 0.6, Math.max(0, this.depthOf(threat)) + (ranged ? 1.8 : 0.9));
    } else {
      const towers = g.structures.filter(t => t.side === this.foe && t.kind !== 'base' && !t.dead);
      const tgt = towers.sort((a, b) => a.hp - b.hp)[0];
      const x = tgt ? tgt.x : (Math.random() - 0.5) * 4;
      const contestNode = g.node.owner !== this.who && !ranged && Math.random() < 0.45;
      const px = contestNode ? (Math.random() - 0.5) * 1.2 : x + (Math.random() - 0.5) * 0.8;
      pos = this.own(px, ranged ? FIELD_HALF * 0.55 : 1.4 + Math.random() * 1.6);
    }
    g.playCard(this.who, pick.idx, pos.x, pos.z);
  }
}

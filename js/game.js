// 核心游戏逻辑 — 纯数据层,不依赖渲染(Node 可直接跑,见 tools/)
//
// 开放战场(皇室战争式,无路线):x ∈ [-FIELD_W, FIELD_W],z ∈ [-FIELD_HALF, FIELD_HALF]
// 玩家(p)在 z>0 一侧,敌方(e)在 z<0 一侧;中线 z=0
// 每方:2 座副塔(自动射击、对空)+ 1 座主基地(被摧毁即输)
// 单位:视野半径 SIGHT 内发现可攻击的敌人 → 追击;进入攻击半径 → 攻击;否则走向最近的敌方建筑
// 机制字段说明见 cards.js 顶部

import { CARDS, PRESET_DECKS, validateDeck, rollUpgrades, shuffle } from './cards.js';
import { MAP, ROCK_CLEARANCE, mapForScene, wallGap, pushOutOfWalls, blockingWall, detour } from './map.js';
import { NavGrid } from './nav.js';

export const FIELD_W = MAP.W;           // 半宽
export const FIELD_HALF = MAP.HALF;     // 半长
export const DEPLOY_LINE = MAP.DEPLOY_LINE;
export const SIGHT = 3.5;               // 单位视野半径
export const DISCARD_COST = 1;
export const SURGE_TIME = 120;          // 开局 2 分钟后进入能量涌潮:法力恢复 ×2(打破僵局)
export const REGULATION = 180;          // 常规时间 3 分钟:结束时摧毁副塔多的一方获胜
export const OVERTIME = 60;             // 打平进入 1 分钟加时赛:先摧毁任意建筑者胜;仍打平比剩余建筑血量
const UNIT_RADIUS = 0.22;
const AIR_RADIUS = 0.18;
const BUILDING_RADIUS = 0.42;
const HAND_SIZE = 5;
// ── 整体节奏(玩家反馈"太快"后放慢):回蓝、攻击间隔、移动速度的全局系数 ──
export const PACE = { mana: 0.7, attack: 1.4, move: 0.85 };

// ── 势力招牌机制 ──
export const VET_TIME = 10, VET_MAX = 3, VET_BONUS = 0.2;      // 钢铁 · 老兵军衔
export const LINK_RANGE = 2.6, LINK_SHARE = 0.4, LINK_HASTE = 0.35;   // 玛雅 · 战术网络
export const BLOOD_PER_MANA = 100, BLOOD_FLOOR = 300, BLOOD_COOLDOWN = 12;            // 混沌 · 血祭

export const UPGRADE_EVERY = 20;        // 双方合计每出 20 张牌触发一次强化暂停
export const UPGRADE_LIMIT = 3;
export const UPGRADE_TIMEOUT = 12;      // 强化选择超时(秒),未选的一方自动随机
const CHAIN_RANGE = 1.6;
const AURA_CAP = 1.6;

// 建筑布局(以玩家侧为准,敌方镜像)

let nextId = 1;

// deckIds 缺省或不合法时用推荐卡组;牌库按随机顺序排队,手牌 5 张,打出/弃掉的牌回到队尾(循环抽牌)
function makeSide(factionId, deckIds) {
  const ids = deckIds && !validateDeck(factionId, deckIds) ? deckIds : PRESET_DECKS[factionId];
  const deck = ids.map(id => CARDS[id]);
  return {
    faction: factionId,
    deck,
    queue: shuffle(deck),
    hand: [],
    mana: 5,
    manaMax: 10,
    manaRegen: PACE.mana,
    baseHP: 1000,
    baseHPMax: 1000,
    played: 0, chosenUpgrades: [],
    atkMul: 1, hpMul: 1, speedMul: 1, intervalMul: 1,
  };
}

export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const isPlaced = c => c.type === 'unit' || c.type === 'building' || c.ownHalf;

export class Game {
  // decks: { p: [卡牌 id × 8], e: [...] },缺省用推荐卡组
  // opts.autoPick: 强化暂停时自动选择的一方(单机下是 AI 一方 'e';联机时为空,双方都由玩家选)
  constructor(playerFaction, enemyFaction, decks = {}, opts = {}) {
    this.map = mapForScene(opts.sceneId);
    this.autoPick = opts.autoPick ?? ['e'];
    this.p = makeSide(playerFaction, decks.p);
    this.e = makeSide(enemyFaction, decks.e);
    this.units = [];
    this.structures = [];
    this.pending = [];          // 延迟生效的效果(轨道炮击等){ t, run }
    this.time = 0;
    this.phase = 'battle';      // battle | upgrade | end
    this.winner = null;
    this.upgrade = null;        // 强化暂停中:{ options: {p, e}, picked: {p, e}, timer }
    this.upgradeCount = 0;
    this.events = [];           // 渲染层每帧消费
    this.log = { p: [], e: [] };// 出牌记录(平衡分析用)
    this.node = { owner: null, progress: 0, contested: false, capturing: null };   // 星核:progress ∈ [-1, 1],+1 = 玩家占满,-1 = 敌方占满
    this.buildStructures();
    this.nav = new NavGrid(this.map);   // 地面寻路网格(静态障碍建一次,塔 / 建筑卡变化时更新动态层)
    this.drawHand(this.p);
    this.drawHand(this.e);
  }

  buildStructures() {
    for (const who of ['p', 'e']) {
      const m = who === 'p' ? 1 : -1;
      for (const t of this.map.towers) {
        this.structures.push({ ...t, id: nextId++, side: who, z: t.z * m, hitsAir: true, maxHp: t.hp, cooldown: 0 });
      }
      const s = this.side(who);
      const base = { ...this.map.base, id: nextId++, side: who, z: this.map.base.z * m, hitsAir: true, cooldown: 0 };
      Object.defineProperty(base, 'hp', { get: () => s.baseHP, set: v => { s.baseHP = v; } });
      Object.defineProperty(base, 'maxHp', { get: () => s.baseHPMax });
      s.baseStruct = base;
      this.structures.push(base);
    }
  }

  side(who) { return who === 'p' ? this.p : this.e; }
  foe(who)  { return who === 'p' ? this.e : this.p; }
  other(who) { return who === 'p' ? 'e' : 'p'; }

  // 从牌库队首补满手牌
  drawHand(side) {
    while (side.hand.length < HAND_SIZE && side.queue.length) side.hand.push(side.queue.shift());
  }

  // 下一张将要抽到的牌
  nextCard(who) { return this.side(who).queue[0] || null; }

  // ── 出牌 ──
  canDeployAt(who, card, x, z) {
    return this.deployBlockReason(who, card, x, z) === null;
  }

  deployBlockReason(who, card, x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > FIELD_W || Math.abs(z) > FIELD_HALF) return 'deployOutside';
    if (!isPlaced(card)) return null;
    if (who === 'p' ? z < DEPLOY_LINE : z > -DEPLOY_LINE) return 'deploySide';
    const isB = card.type === 'building';
    // 不能放进岩石;建筑按自身半径检查,且不能与塔/核心/其他建筑卡重叠
    const margin = isB ? BUILDING_RADIUS : 0.15;
    const rockMargin = card.type === 'unit' && !card.air ? UNIT_RADIUS + ROCK_CLEARANCE : margin;
    if (this.map.obstacles.some(o => Math.hypot(x - o.x, z - o.z) < o.r + rockMargin)) return 'deployRock';
    if (wallGap(x, z, this.map) < margin) return 'deployWall';   // 分路长墙上不能部署
    if (isB) {
      if (this.structures.some(s => !s.dead && Math.hypot(x - s.x, z - s.z) < s.radius + BUILDING_RADIUS)) return 'deployOccupied';
      if (this.units.some(u => u.building && !u.dead && Math.hypot(x - u.x, z - u.z) < BUILDING_RADIUS * 2)) return 'deployOccupied';
    }
    return null;
  }

  canPlay(who, idx) {
    const s = this.side(who);
    const card = s.hand[idx];
    return !!card && this.phase === 'battle' && (s.mana >= card.cost || this.bloodCost(who, card) !== null);
  }

  // 混沌 · 血祭:法力不够时补差价要扣的核心生命;不是混沌、法力够、或扣完核心会低于底线时返回 null
  bloodCost(who, card) {
    const s = this.side(who);
    if (s.faction !== 'chaos' || !card || s.mana >= card.cost || this.time < (s.bloodReadyAt ?? 0)) return null;
    const hp = Math.ceil(card.cost - s.mana - 1e-9) * (s.bloodPrice ?? BLOOD_PER_MANA);
    return s.baseHP - hp >= BLOOD_FLOOR ? hp : null;
  }

  playCard(who, idx, x = 0, z = who === 'p' ? 2.5 : -2.5) {
    if (!this.canPlay(who, idx)) return false;
    const s = this.side(who);
    const card = s.hand[idx];
    if ((isPlaced(card) || card.needTarget) && !this.canDeployAt(who, card, x, z)) return false;
    if (s.mana < card.cost) {   // 血祭:差的法力用核心生命补齐(补整数点,零头留作法力)
      const hp = this.bloodCost(who, card);
      const n = hp / (s.bloodPrice ?? BLOOD_PER_MANA);
      s.baseHP -= hp;
      s.mana += n;
      s.bloodReadyAt = this.time + (s.bloodCooldown ?? BLOOD_COOLDOWN);   // 冷却:血祭是关键时刻的爆发,不是第二个法力池
      this.events.push({ type: 'blood_price', who, amount: hp, core: s.baseStruct });
    }
    s.mana -= card.cost;
    s.hand.splice(idx, 1);
    s.queue.push(card);       // 打出的牌回到队尾
    this.drawHand(s);
    s.played++;
    this.log[who].push(card.id);

    if (card.type === 'spell') this.castSpell(who, card, x, z);
    else this.spawnUnit(who, card, x, z, card.count || 1, who);

    // 法术/亡语可能在出牌瞬间摧毁核心:先判胜负,结束了就不再进入强化暂停(否则可借暂停"复活"核心)
    this.checkEnd();
    if (this.phase === 'battle' && this.upgradeCount < UPGRADE_LIMIT && this.totalPlayed() % UPGRADE_EVERY === 0) this.startUpgrade();
    return true;
  }

  // 弃牌:花 1 点法力换一张新牌,不计入强化进度
  canDiscard(who, idx) {
    const s = this.side(who);
    return !!s.hand[idx] && this.phase === 'battle' && s.mana >= DISCARD_COST;
  }

  discard(who, idx) {
    if (!this.canDiscard(who, idx)) return false;
    const s = this.side(who);
    s.mana -= DISCARD_COST;
    const [card] = s.hand.splice(idx, 1);
    s.queue.push(card);
    this.drawHand(s);
    this.events.push({ type: 'discard', who, card });
    return true;
  }

  // ── 单位 ──
  makeUnit(who, card, x, z) {
    const s = this.side(who);
    const isB = card.type === 'building';
    const maxHp = card.hp * s.hpMul * (card.cocoon ? s.cocoonHp ?? 1 : 1);
    const u = {
      id: nextId++, side: who, card, x, z,
      hp: maxHp, maxHp,
      atk: card.atk * s.atkMul,
      speed: card.speed * s.speedMul * PACE.move,
      interval: card.interval * s.intervalMul * PACE.attack,
      range: card.range,
      radius: isB ? BUILDING_RADIUS : card.air ? AIR_RADIUS : UNIT_RADIUS,
      air: !!card.air,
      hitsAir: card.hitsAir ?? card.range > 1.2,
      building: isB,
      decay: isB ? maxHp / card.lifetime : 0,
      shield: card.shield || 0, maxShield: card.shield || 0,
      cooldown: 0.4, target: null, age: 0, auraMul: 1, auraSpeed: 1, rank: 0, links: null,
      spawnTimer: card.spawn ? card.spawn.interval * 0.5 : 0,
      pulseTimer: card.pulse ? card.pulse.interval * PACE.attack : 0,
      status: { stun: 0, slow: 0, dot: 0, dotDps: 0, hack: 0, curse: 0, curseMul: 1, parasite: 0 },
    };
    this.units.push(u);
    this.events.push({ type: 'spawn', unit: u });
    return u;
  }

  // 按 count 在落点周围散开部署;deployFor 不为空时(玩家出牌)散开后夹回该方的部署区,不越过部署线
  spawnUnit(who, card, x, z, count = card.count || 1, deployFor = null) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.4;
      const r = count > 1 ? 0.32 : 0;
      let px = Math.max(-FIELD_W, Math.min(FIELD_W, x + Math.cos(a) * r));
      let pz = Math.max(-FIELD_HALF, Math.min(FIELD_HALF, z + Math.sin(a) * r));
      if (deployFor === 'p') pz = Math.max(DEPLOY_LINE, pz);
      else if (deployFor === 'e') pz = Math.min(-DEPLOY_LINE, pz);
      if (!card.air) {
        const q = pushOutOfWalls(px, pz, UNIT_RADIUS, this.map); if (q) { px = q.x; pz = q.z; }
        for (const o of this.map.obstacles) {   // 也别生成在岩石里
          const d = Math.hypot(px - o.x, pz - o.z), min = o.r + (card.type === 'building' ? BUILDING_RADIUS : UNIT_RADIUS + ROCK_CLEARANCE);
          if (d < min) { const k = d > 1e-4 ? min / d : 0; px = d > 1e-4 ? o.x + (px - o.x) * k : o.x + min; pz = d > 1e-4 ? o.z + (pz - o.z) * k : pz; }
        }
      }
      out.push(this.makeUnit(who, card, px, pz));
    }
    return out;
  }

  // 存活一段时间后进化:按"当前值 / 卡面值"的比例换算,保留强化倍率、群体进化、全员强化等已获得的加成,
  // 也不会因为进化时恰好被黑而套用对方的倍率
  evolve(u) {
    const prev = u.card, next = CARDS[u.card.evolveInto];
    const ratio = u.hp / u.maxHp;
    const k = (cur, base) => (base > 0 ? cur / base : 1);
    const hpK = k(u.maxHp, prev.hp), atkK = k(u.atk, prev.atk), spK = k(u.speed, prev.speed), ivK = k(u.interval, prev.interval);
    u.card = next;
    u.maxHp = next.hp * hpK;
    u.hp = u.maxHp * ratio;
    u.atk = next.atk * atkK;
    u.speed = next.speed * spK;
    u.interval = next.interval * ivK;
    u.range = next.range;
    u.air = !!next.air;
    u.hitsAir = next.hitsAir ?? next.range > 1.2;
    this.events.push({ type: 'evolve', unit: u });
  }

  // ── 法术 ──
  // 基因拟态会复制的目标(AI 预判和实际结算共用同一个规则)
  mimicTarget(foeWho, pt, card) {
    return this.units.filter(u => u.side === foeWho && !u.dead && !u.building && !u.card.cocoon && !u.card.token
      && u.card.cost <= card.maxCost && dist2(u, pt) <= card.radius + u.radius)
      .sort((a, b) => b.card.cost - a.card.cost || dist2(a, pt) - dist2(b, pt))[0] ?? null;
  }

  castSpell(who, card, x, z) {
    const s = this.side(who);
    const foeWho = this.other(who);
    const pt = { x, z };
    const mine = this.units.filter(u => u.side === who && !u.building);
    const foes = this.units.filter(u => u.side === foeWho);
    const inArea = card.needTarget ? foes.filter(u => dist2(u, pt) <= card.radius + u.radius) : [];

    switch (card.effect) {
      case 'buff_atk':
        mine.forEach(u => { u.atk += card.value; });
        break;
      case 'heal_area':   // 装甲维修:落点半径内的己方单位(不含建筑)
        mine.filter(u => dist2(u, pt) <= card.radius + u.radius).forEach(u => { u.hp = Math.min(u.maxHp, u.hp + card.value); });
        break;
      case 'stun_area':
        inArea.forEach(u => {
          if (!u.card.unstoppable) u.status.stun = Math.max(u.status.stun, card.value);   // 免控单位只吃伤害
          if (card.damage) this.damage(u, card.damage);
        });
        break;
      case 'hack': {
        const target = inArea.filter(u => !u.building && !u.card.unstoppable)
          .sort((a, b) => b.hp + b.atk * 3 - (a.hp + a.atk * 3))[0];
        if (target && target.status.hack > 0) {
          // 目标本来就是被黑过来的:再黑一次等于物归原主(不能覆盖原主记录,否则倒戈结束后会归错一方)
          target.side = target.hackOwner; target.target = null; target.status.hack = 0;
          this.events.push({ type: 'unhack', unit: target });
        } else if (target) {
          target.side = who; target.target = null;
          target.status.hack = card.value; target.hackOwner = foeWho;
          this.events.push({ type: 'convert', unit: target, temporary: true });
        }
        break;
      }
      case 'convert': {
        const target = foes.filter(u => !u.building && u.card.cost <= (card.maxCost ?? 99))
          .sort((a, b) => a.hp - b.hp)[0];
        if (target) {
          target.side = who; target.target = null; target.status.hack = 0;
          this.events.push({ type: 'convert', unit: target });
        }
        break;
      }
      case 'mimic': {
        // 基因拟态:复制落点附近费用最高的敌方单位(不含建筑 / 虫茧,费用 ≤ maxCost),复制体站在原单位身边,生命按比例
        const t = this.mimicTarget(foeWho, pt, card);
        if (t) {
          const back = who === 'p' ? 0.35 : -0.35;   // 往己方一侧挪半个身位,别和原单位重叠
          const [clone] = this.spawnUnit(who, t.card, t.x, t.z + back, 1);
          if (clone) {
            clone.maxHp *= card.hpFactor;
            clone.hp = clone.maxHp;
            clone.mimic = true;
            this.events.push({ type: 'mimic', from: t, unit: clone });
          }
        }
        break;
      }
      case 'evolve':
        mine.forEach(u => {
          const gain = u.maxHp * card.value;
          u.maxHp += gain;
          u.hp = Math.min(u.maxHp, u.hp + gain);
        });
        break;
      case 'dot_area':
        inArea.forEach(u => { u.status.dot = card.duration; u.status.dotDps = card.value; });
        break;
      case 'drain': {
        const target = foes.filter(u => !u.building).sort((a, b) => b.atk - a.atk)[0];
        if (target) {
          this.damage(target, card.value);
          s.baseHP = Math.min(s.baseHPMax, s.baseHP + card.value);
        }
        break;
      }
      case 'strike':
        this.events.push({ type: 'strike_warn', x, z, radius: card.radius, delay: card.delay });
        this.pending.push({ t: card.delay, run: () => {
          this.areaDamage(who, x, z, card.radius, card.damage, { structFactor: card.structFactor });
          this.events.push({ type: 'explode', x, z, radius: card.radius, color: 0xffb040 });
        } });
        break;
      case 'shield_area':
        this.units.filter(u => u.side === who && dist2(u, pt) <= card.radius + u.radius).forEach(u => {
          u.shield += card.value;
          u.maxShield = Math.max(u.maxShield, u.shield);
        });
        break;
      case 'chain': {
        const first = foes.filter(u => dist2(u, pt) <= card.radius + u.radius)
          .sort((a, b) => dist2(a, pt) - dist2(b, pt))[0];
        if (first) {
          const hit = [first];
          for (let i = 0; i < card.jumps; i++) {
            const last = hit[hit.length - 1];
            const next = foes.filter(o => !o.dead && !hit.includes(o) && dist2(o, last) <= CHAIN_RANGE)
              .sort((a, b) => dist2(a, last) - dist2(b, last))[0];
            if (!next) break;
            hit.push(next);
          }
          hit.forEach(u => this.damage(u, card.damage));
          this.events.push({ type: 'chain', points: hit.map(u => ({ x: u.x, z: u.z, air: u.air })), color: 0x8af0ff });
        }
        break;
      }
      case 'spawn':
        this.spawnUnit(who, CARDS[card.card], x, z, card.count);
        break;
      case 'parasite':
        inArea.filter(u => !u.building).forEach(u => {
          u.status.parasite = card.duration;
          u.parasiteBy = who;
          u.parasiteCard = card.spawnCard;
          u.parasiteCount = card.spawnCount;
          u.status.dot = card.duration;
          u.status.dotDps = card.dps;
        });
        break;
      case 'sacrifice': {
        const victims = mine.filter(u => dist2(u, pt) <= card.radius + u.radius);
        for (const u of victims) {
          const dmg = u.hp * card.factor;
          this.events.push({ type: 'explode', x: u.x, z: u.z, radius: card.burstRadius, color: 0x30d060 });
          this.kill(u);
          this.areaDamage(who, u.x, u.z, card.burstRadius, dmg, { structFactor: 0.5 });
        }
        break;
      }
      case 'curse':
        inArea.forEach(u => { u.status.curse = card.duration; u.status.curseMul = card.value; });
        break;
    }
    this.events.push({ type: 'spell', who, card, x, z });
  }

  // ── 肉鸽强化暂停 ──
  totalPlayed() { return this.p.played + this.e.played; }
  playsToUpgrade() { return this.upgradeCount >= UPGRADE_LIMIT ? 0 : UPGRADE_EVERY - (this.totalPlayed() % UPGRADE_EVERY); }

  // 兼容单机写法:玩家的三个选项
  get upgradeOptions() { return this.upgrade ? this.upgrade.options.p : null; }

  startUpgrade() {
    this.phase = 'upgrade';
    this.upgrade = { options: { p: rollUpgrades(3, this.p.faction, this.p.chosenUpgrades), e: rollUpgrades(3, this.e.faction, this.e.chosenUpgrades) }, picked: { p: null, e: null }, timer: UPGRADE_TIMEOUT };
    this.events.push({ type: 'upgrade_pause' });
    for (const who of this.autoPick) this.chooseUpgrade(this.upgrade.options[who][Math.floor(Math.random() * 3)], who);
  }

  // who 方选择强化;upgrade 可以是选项对象或下标。双方都选完后恢复战斗
  chooseUpgrade(upgrade, who = 'p') {
    const U = this.upgrade;
    if (this.phase !== 'upgrade' || !U || U.picked[who]) return false;
    if (typeof upgrade === 'number') upgrade = U.options[who][upgrade];
    if (!upgrade || !U.options[who].includes(upgrade)) return false;
    const s = this.side(who);
    const before = { atk: s.atkMul, hp: s.hpMul, speed: s.speedMul, interval: s.intervalMul };
    const beforeCocoonHp = s.cocoonHp ?? 1;
    upgrade.apply(s);
    s.chosenUpgrades.push(upgrade.id);
    // 描述写的是"所有单位":倍率变化同步到该方已在场的单位(被黑走的单位按原主算)
    const r = { atk: s.atkMul / before.atk, hp: s.hpMul / before.hp, speed: s.speedMul / before.speed, interval: s.intervalMul / before.interval };
    for (const u of this.units) {
      const owner = u.status.hack > 0 ? u.hackOwner : u.side;
      if (u.dead || owner !== who) continue;
      u.atk *= r.atk; u.maxHp *= r.hp; u.hp *= r.hp; u.decay *= r.hp;
      u.speed *= r.speed; u.interval *= r.interval;
      if (u.card.cocoon) {
        const k = (s.cocoonHp ?? 1) / beforeCocoonHp;
        u.maxHp *= k; u.hp *= k; u.decay *= k;
      }
    }
    U.picked[who] = upgrade;
    this.events.push({ type: 'upgrade_pick', who, upgrade });
    if (U.picked.p && U.picked.e) {
      this.upgradeCount++;
      this.upgrade = null;
      this.phase = 'battle';
      this.events.push({ type: 'upgrade_done', picks: { ...U.picked } });
    }
    return true;
  }

  // ── 伤害结算 ──
  canHit(attacker, target) {
    return !(target.air && !attacker.hitsAir);
  }

  // 返回实际造成的伤害(实际扣掉的生命 + 被护盾吸收的部分,不含溢出),供吸血使用
  damage(target, amount, source, { noShare = false } = {}) {
    if (target.dead || !(amount > 0)) return 0;
    if (target.card?.ethereal && source && Math.random() < 0.3) {
      this.events.push({ type: 'dodge', unit: target });
      return 0;
    }
    if (target.rank > 0 && target.card?.faction === 'steel') amount *= this.side(target.status.hack > 0 ? target.hackOwner : target.side).veteranArmor ?? 1;
    if (target.status?.curse > 0) amount *= target.status.curseMul;
    // 玛雅 · 战术网络:伤害的一部分由网络里的同伴平摊
    if (!noShare && target.links?.length) {
      const mates = target.links.filter(m => !m.dead);
      if (mates.length) {
        const share = this.side(target.side).linkShare ?? LINK_SHARE;
        const part = amount * share / mates.length;
        for (const m of mates) this.damage(m, part, source, { noShare: true });
        amount *= 1 - share;
      }
    }
    const total = amount;
    let absorbed = 0;
    if (target.shield > 0) {
      absorbed = Math.min(target.shield, amount);
      target.shield -= absorbed;
      amount -= absorbed;
    }
    const lost = Math.min(amount, Math.max(0, target.hp));
    const shieldBreak = absorbed > 0 && target.shield <= 0;
    if (target.kind) {   // 塔 / 核心
      target.hp -= amount;
      this.events.push({ type: 'struct_hit', struct: target, amount, lost, absorbed, shieldBreak });
      if (target.hp <= 0) {
        // 核心也标记摧毁:之后任何回血都不能让它"复活"(胜负在本帧/本次出牌结束时判定)
        target.dead = true;
        this.events.push({ type: 'struct_destroyed', struct: target });
      }
      return lost;   // 与单位一致:护盾吸收的部分不计入吸血
    }
    target.hp -= amount;
    this.events.push({ type: 'hit', unit: target, amount: total, lost, absorbed, shieldBreak });
    if (target.hp <= 0) this.kill(target, source);
    // 返回值只用于吸血:能量护盾隔绝吸魂,护盾吸收的部分不计入(钢铁靠护盾抗混沌的吸血续航)
    return lost;
  }

  kill(u, source) {
    if (u.dead) return;
    u.dead = true;
    u.hp = Math.min(u.hp, 0);
    this.events.push({ type: 'death', unit: u });
    const c = u.card;
    if (c.deathBurst) {
      this.areaDamage(u.side, u.x, u.z, c.deathBurst.radius, c.deathBurst.damage, { structFactor: 1 });
      this.events.push({ type: 'explode', x: u.x, z: u.z, radius: c.deathBurst.radius, color: 0xff6030 });
    }
    if (c.deathSpawn) this.spawnUnit(u.side, CARDS[c.deathSpawn.card], u.x, u.z, c.deathSpawn.count);
    if (u.status.parasite > 0 && u.parasiteBy) {
      this.spawnUnit(u.parasiteBy, CARDS[u.parasiteCard], u.x, u.z, u.parasiteCount);
      this.events.push({ type: 'parasite_burst', x: u.x, z: u.z });
    }
    // 虫群 · 同化:虫群单位击杀的敌方单位化为虫茧(建筑、虫茧本身除外)
    // 只同化地面单位:飞行单位被击落后不结茧
    if (source?.card && !source.kind && source.card.faction === 'swarm' && !u.building && !u.air && source.side !== u.side) {
      const cocoon = this.makeUnit(source.side, CARDS.swarm_cocoon, u.x, u.z);
      // 混沌腐化的躯体只能结出半残的虫茧(生命减半):虫群对混沌原来 60 : 40,单位全部被同化是主因
      if (u.card.faction === 'chaos') { cocoon.maxHp *= 0.5; cocoon.hp = cocoon.maxHp; cocoon.decay *= 0.5; }
      this.events.push({ type: 'assimilate', x: u.x, z: u.z, side: source.side });
    }
    if (source?.card?.devour && !source.dead) {
      source.hp = Math.min(source.maxHp, source.hp + u.maxHp * 0.3);
      this.events.push({ type: 'devour', unit: source });
    }
  }

  // 以 side 的立场对敌方造成范围伤害(含空中);structFactor 为对塔/基地的伤害系数
  areaDamage(side, x, z, r, dmg, { structFactor = 1, source } = {}) {
    const pt = { x, z };
    for (const u of [...this.units]) {
      if (!u.dead && u.side !== side && dist2(u, pt) <= r + u.radius) this.damage(u, dmg, source);
    }
    if (structFactor > 0) {
      for (const s of this.structures) {
        if (!s.dead && s.side !== side && dist2(s, pt) <= r + s.radius) this.damage(s, dmg * structFactor, source);
      }
    }
  }

  gap(a, b) { return dist2(a, b) - (a.radius || 0) - (b.radius || 0); }

  // 地面单位到目标的"实际距离":直线被分路长墙挡住时,按绕到墙尽头的路程算。
  // 远程单位在射程内可以隔墙射击,不用绕;飞行单位不受墙影响
  pathGap(u, o) {
    const g = this.gap(u, o);
    if (u.air || u.building) return g;
    if (!blockingWall(u.x, u.z, o.x, o.z, 0, this.map)) return g;
    if (u.range > 1.2 && g <= u.range) return g;
    const d = detour(u.x, u.z, o.x, o.z, u.radius, this.map);
    return d ? d.len - (u.radius || 0) - (o.radius || 0) : g;
  }

  // 地面单位下一步要走向的点:按需重算 A* 路径(目标变了 / 目标走远了 / 到了刷新间隔 / 卡住),沿路径前进并做视线平滑
  navAim(u, target) {
    const melee = u.range <= 1.2;
    const reach = u.range + (target.radius || 0) + u.radius - 0.05;   // 站在离目标中心这么近的地方就能打到
    const moved = u.pathFor && Math.hypot(u.pathFor.x - target.x, u.pathFor.z - target.z) > 0.6;
    // 卡住检测:1 秒内几乎没前进就强制重算
    if (!u.progress || this.time - u.progress.t > 1) {
      if (u.progress && Math.hypot(u.x - u.progress.x, u.z - u.progress.z) < 0.08) u.pathRefresh = 0;
      u.progress = { x: u.x, z: u.z, t: this.time };
    }
    if (!u.path || u.pathTarget !== target || moved || this.time >= u.pathRefresh) {
      u.path = this.nav.findPath(u.x, u.z, target.x, target.z, reach, melee);
      u.pathTarget = target;
      u.pathFor = { x: target.x, z: target.z };
      u.pathRefresh = this.time + (target.kind || target.building ? 1.5 : 0.6) + (u.id % 7) * 0.05;   // 错开刷新,避免同一帧扎堆
      u.pathIdx = 0;
    }
    const p = u.path;
    if (!p) return detour(u.x, u.z, target.x, target.z, u.radius, this.map) || target;   // 没有可达路径:退回绕墙 / 直线
    if (!p.length || u.pathIdx >= p.length) return target;                    // 已经站在能打到的位置
    while (u.pathIdx < p.length - 1 && Math.hypot(p[u.pathIdx].x - u.x, p[u.pathIdx].z - u.z) < 0.25) u.pathIdx++;
    for (let j = Math.min(p.length - 1, u.pathIdx + 8); j > u.pathIdx; j--) {   // 视线平滑:能直接看到更远的点就跳过去
      if (this.nav.clearLine(u.x, u.z, p[j].x, p[j].z)) { u.pathIdx = j; break; }
    }
    const w = p[u.pathIdx];
    if (u.pathIdx === p.length - 1 && Math.hypot(w.x - u.x, w.z - u.z) < 0.25) return target;
    return w;
  }

  // 路径预览(用于预计是否经过减速区):从落点走向它会去打的敌方建筑,返回前 maxLen 格的路线点(含落点);法术 / 建筑 / 飞行返回 null
  previewPath(who, card, x, z, maxLen = 3.5) {
    if (!card || card.type !== 'unit' || card.air) return null;
    const foe = who === 'p' ? 'e' : 'p';
    const probe = { x, z, radius: UNIT_RADIUS, range: card.range, air: false, building: false };
    let target = null, bd = Infinity;
    for (const s of this.structures) {
      if (s.dead || s.side !== foe) continue;
      const d = this.pathGap(probe, s);
      if (d < bd) { bd = d; target = s; }
    }
    if (!target) return null;
    this.nav.updateDynamic(this.structures, this.units);
    const reach = card.range + target.radius + UNIT_RADIUS - 0.05;
    const p = this.nav.findPath(x, z, target.x, target.z, reach, card.range <= 1.2);
    if (!p) return null;
    const out = [{ x, z }];
    let len = 0;
    for (const q of p) {
      const last = out[out.length - 1], d = Math.hypot(q.x - last.x, q.z - last.z);
      if (len + d > maxLen) {
        const t = (maxLen - len) / d;
        out.push({ x: last.x + (q.x - last.x) * t, z: last.z + (q.z - last.z) * t });
        break;
      }
      len += d;
      out.push(q);
    }
    return out;
  }

  // 近战单位隔着墙打不到(远程可以)
  wallBlocksMelee(u, t) {
    return !u.air && u.range <= 1.2 && !!blockingWall(u.x, u.z, t.x, t.z, 0, this.map);
  }

  // 选目标:
  //  攻城单位 → 最近的敌方建筑(塔/基地/建筑卡)
  //  普通单位 → 保持正在追的单位 → 视野内最近可攻击的敌方单位 → 最近的敌方塔/基地
  //  建筑卡   → 射程内最近可攻击的敌方单位
  pickTarget(u) {
    if (u.building) {
      let best = null, bd = u.range;
      for (const o of this.units) {
        if (o.dead || o.side === u.side || !this.canHit(u, o)) continue;
        const d = this.gap(u, o);
        if (d <= bd) { bd = d; best = o; }
      }
      return best;
    }
    if (u.card.siege) {
      let best = null, bd = Infinity;
      for (const o of [...this.structures, ...this.units.filter(x => x.building)]) {
        if (o.dead || o.side === u.side) continue;
        const d = this.pathGap(u, o);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }
    const t = u.target;
    if (t && !t.kind && !t.dead && t.side !== u.side && this.canHit(u, t) && this.pathGap(u, t) <= SIGHT * 1.2) return t;
    let best = null, bestD = SIGHT;
    for (const o of this.units) {
      if (o.dead || o.side === u.side || !this.canHit(u, o)) continue;
      const d = this.pathGap(u, o);
      if (d < bestD) { bestD = d; best = o; }
    }
    if (best) return best;
    let bs = null, bsd = Infinity;
    for (const s of this.structures) {
      if (s.dead || s.side === u.side) continue;
      const d = this.pathGap(u, s);
      if (d < bsd) { bsd = d; bs = s; }
    }
    return bs;
  }

  attack(u, target) {
    const c = u.card;
    if (c.kamikaze) { this.kill(u); return; }
    const dmg = u.atk * u.auraMul;
    this.events.push({ type: 'attack', from: u, to: target, ranged: u.range > 1.2 });
    let dealt = this.damage(target, dmg, u);
    if (c.splash) {
      for (const o of [...this.units]) {
        if (o === target || o.dead || o.side === u.side || !this.canHit(u, o)) continue;
        if (dist2(o, target) <= c.splash + o.radius) dealt += this.damage(o, dmg, u);
      }
      this.events.push({ type: 'splash', x: target.x, z: target.z, radius: c.splash });
    }
    if (c.chain) {
      const hit = [target];
      for (let i = 0; i < c.chain; i++) {
        const last = hit[hit.length - 1];
        const next = this.units.filter(o => !o.dead && o.side !== u.side && !hit.includes(o) &&
          this.canHit(u, o) && dist2(o, last) <= CHAIN_RANGE)
          .sort((a, b) => dist2(a, last) - dist2(b, last))[0];
        if (!next) break;
        hit.push(next);
        dealt += this.damage(next, dmg * 0.6, u);
      }
      if (hit.length > 1) {
        this.events.push({ type: 'chain', points: [u, ...hit].map(o => ({ x: o.x, z: o.z, air: o.air })), color: 0x5af0ff });
      }
    }
    if (c.lifesteal && !u.dead) u.hp = Math.min(u.maxHp, u.hp + dealt * c.lifesteal);
  }

  // ── 每帧 ──
  tick(dt) {
    if (this.phase === 'upgrade' && this.upgrade) {
      // 超时:没选的一方自动随机
      this.upgrade.timer -= dt;
      if (this.upgrade.timer <= 0) {
        for (const who of ['p', 'e']) {
          if (this.upgrade && !this.upgrade.picked[who]) this.chooseUpgrade(Math.floor(Math.random() * 3), who);
        }
      }
      return;
    }
    if (this.phase !== 'battle') return;
    this.time += dt;

    const surge = this.time >= SURGE_TIME;
    if (surge && !this.surge) { this.surge = true; this.events.push({ type: 'surge' }); }
    this.updateNode(dt);
    for (const who of ['p', 'e']) {
      const s = this.side(who);
      const nodeBonus = !this.node.contested && this.node.owner === who ? 1 + this.map.node.bonus : 1;
      s.mana = Math.min(s.manaMax, s.mana + s.manaRegen * (surge ? 2 : 1) * nodeBonus * dt);
    }

    // 延迟效果
    for (const p of this.pending) { p.t -= dt; if (p.t <= 0) p.run(); }
    this.pending = this.pending.filter(p => p.t > 0);

    // 光环
    const auras = this.units.filter(u => !u.dead && u.card.aura);
    for (const u of this.units) {
      let m = 1, sp = 1;
      for (const a of auras) {
        if (a !== u && a.side === u.side && dist2(a, u) <= a.card.aura.radius) {
          m += a.card.aura.atk;
          sp = Math.max(sp, 1 + (a.card.aura.speed || 0));   // 移速加成不叠加,取最高
        }
      }
      u.auraMul = Math.min(AURA_CAP, m);
      u.auraSpeed = sp;
    }

    this.updateLinks();
    this.nav.updateDynamic(this.structures, this.units);

    for (const u of this.units) {
      if (u.dead) continue;
      const st = u.status, c = u.card;
      u.age += dt;

      // 钢铁 · 老兵军衔:存活每 VET_TIME 秒升一级,生命(含当前生命)和攻击按比例提升
      if (c.faction === 'steel' && !u.building && u.rank < VET_MAX && u.age >= (u.rank + 1) * (this.side(st.hack > 0 ? u.hackOwner : u.side).veteranTime ?? VET_TIME)) {
        u.rank++;
        const k = (1 + VET_BONUS * u.rank) / (1 + VET_BONUS * (u.rank - 1));
        u.maxHp *= k; u.hp *= k; u.atk *= k;
        this.events.push({ type: 'rank_up', unit: u, rank: u.rank });
      }
      // 虫茧到时间孵化
      if (c.cocoon) u.hatchProgress = Math.min(1, u.age / (c.cocoon.time * (this.side(u.side).cocoonTime ?? 1)));
      if (c.cocoon && u.hatchProgress >= 1) {
        u.dead = true;
        this.spawnUnit(u.side, CARDS[c.cocoon.card], u.x, u.z, 1);
        this.events.push({ type: 'hatch', x: u.x, z: u.z });
        continue;
      }

      if (st.hack > 0) {
        st.hack -= dt;
        if (st.hack <= 0) { u.side = u.hackOwner; u.target = null; this.events.push({ type: 'unhack', unit: u }); }
      }
      if (st.curse > 0) st.curse -= dt;
      if (st.parasite > 0) st.parasite -= dt;
      if (st.dot > 0) {
        st.dot -= dt;
        this.damage(u, st.dotDps * dt);
        if (u.dead) continue;
      }
      if (c.evolveInto && u.age >= c.evolveTime) this.evolve(u);

      if (u.building) {
        u.hp -= u.decay * dt;                    // 寿命流失不受瘫痪影响
        if (u.hp <= 0) { this.kill(u); continue; }
      }
      if (st.stun > 0) { st.stun -= dt; continue; }   // 瘫痪:单位停止行动,建筑暂停产兵/脉冲/射击

      if (u.building) {
        if (c.spawn) {
          u.spawnTimer -= dt;
          if (u.spawnTimer <= 0) {
            u.spawnTimer = c.spawn.interval;
            const dz = u.side === 'p' ? -0.55 : 0.55;
            this.spawnUnit(u.side, CARDS[c.spawn.card], u.x, u.z + dz, 1);
          }
        }
        if (c.pulse) {
          u.pulseTimer -= dt;
          if (u.pulseTimer <= 0) {
            u.pulseTimer = c.pulse.interval * PACE.attack;
            this.areaDamage(u.side, u.x, u.z, c.pulse.radius, c.pulse.damage, { structFactor: 0 });
            this.events.push({ type: 'pulse', x: u.x, z: u.z, radius: c.pulse.radius });
          }
        }
      }

      if (st.slow > 0) st.slow -= dt;
      u.cooldown -= dt;
      if (u.building && u.atk <= 0) continue;

      const raging = c.berserk && u.hp < u.maxHp * 0.5;
      const target = this.pickTarget(u);
      u.target = target;
      if (!target) continue;
      const d = this.gap(u, target);
      if (d <= u.range && !this.wallBlocksMelee(u, target)) {
        if (u.cooldown <= 0) {
          u.cooldown = u.interval * (raging ? 0.5 : 1) / (u.links?.length ? 1 + (this.side(u.side).linkHaste ?? LINK_HASTE) : 1);
          this.attack(u, target);
        }
      } else if (!u.building) {
        let speed = u.speed * u.auraSpeed * (st.slow > 0 ? 0.5 : 1) * (raging ? 1.3 : 1);
        // 地面单位按 A* 路径走(绕岩脊、岩石、塔,权衡裂隙减速);飞行单位直线
        const aim = u.air ? target : this.navAim(u, target);
        const len = dist2(u, aim) || 1;
        let dx = (aim.x - u.x) / len, dz = (aim.z - u.z) / len;
        if (!u.air) {
          [dx, dz] = this.steer(u, dx, dz, len);
          for (const r of this.map.rifts) if (Math.hypot(u.x - r.x, u.z - r.z) < r.r) speed *= r.slow;
        }
        u.x += dx * speed * dt;
        u.z += dz * speed * dt;
      }
    }

    this.separate();
    this.structuresFire(dt);

    this.units = this.units.filter(u => !u.dead);

    this.checkEnd();
  }

  // 玛雅 · 战术网络:同一方、彼此距离 ≤ LINK_RANGE 的玛雅单位互相连接(客户端按同样规则画光链)
  updateLinks() {
    const net = this.units.filter(u => !u.dead && u.card.faction === 'mecha');
    for (const u of net) u.links = [];
    for (let i = 0; i < net.length; i++) {
      for (let j = i + 1; j < net.length; j++) {
        const a = net[i], b = net[j];
        if (a.side === b.side && dist2(a, b) <= LINK_RANGE) { a.links.push(b); b.links.push(a); }
      }
    }
  }

  // 摧毁的敌方副塔数(皇冠)
  crowns(who) {
    return this.structures.filter(s => s.side !== who && s.kind !== 'base' && s.dead).length;
  }

  // 剩余建筑血量比例
  structureHpRatio(who) {
    const mine = this.structures.filter(s => s.side === who);
    return mine.reduce((a, s) => a + Math.max(0, s.hp), 0) / mine.reduce((a, s) => a + s.maxHp, 0);
  }

  timeLeft() {
    return Math.max(0, (this.overtime ? REGULATION + OVERTIME : REGULATION) - this.time);
  }

  finish(winner, reason) {
    if (this.phase === 'end') return;
    this.phase = 'end';
    this.winner = winner;            // 'p' | 'e' | null(平局)
    this.endReason = reason;
    this.events.push({ type: 'end', winner, reason });
  }

  checkEnd() {
    if (this.phase === 'end') return;
    // 核心一旦被标记摧毁就算倒下,之后的回血(灵魂抽取、基地加固)不能让它复活
    const down = s => s.baseHP <= 0 || !!s.baseStruct?.dead;
    const pDown = down(this.p), eDown = down(this.e);
    if (pDown && eDown) return this.finish(null, 'mutual');   // 同一帧双方核心都被摧毁:平局(不偏向任何一方)
    if (eDown) return this.finish('p', 'base');
    if (pDown) return this.finish('e', 'base');
    const cp = this.crowns('p'), ce = this.crowns('e');
    if (!this.overtime) {
      if (this.time < REGULATION) return;
      if (cp !== ce) return this.finish(cp > ce ? 'p' : 'e', 'crowns');
      this.overtime = true;
      this.otCrowns = cp;
      this.events.push({ type: 'overtime' });
      return;
    }
    // 加时赛:先多拆一座的赢
    if (cp !== ce) return this.finish(cp > ce ? 'p' : 'e', 'overtime');
    if (this.time < REGULATION + OVERTIME) return;
    const hp = this.structureHpRatio('p'), he = this.structureHpRatio('e');
    if (Math.abs(hp - he) < 1e-6) return this.finish(null, 'draw');
    this.finish(hp > he ? 'p' : 'e', 'hp');
  }

  // 绕开前方的岩石:障碍在前方且比目标近时,沿切向偏转
  steer(u, dx, dz, distToTarget) {
    let sx = dx, sz = dz;
    for (const o of this.map.obstacles) {
      const ox = o.x - u.x, oz = o.z - u.z;
      const d = Math.hypot(ox, oz);
      const R = o.r + u.radius + 0.12;
      if (d < 1e-6 || d > R + 1.4 || d > distToTarget + o.r) continue;   // d=0:正好在岩石中心,交给 separate 推出去(否则除零得到 NaN)
      const ahead = (ox * dx + oz * dz) / d;          // 障碍在正前方的程度
      if (ahead <= 0.2) continue;
      // 偏转方向:障碍在左就往右,在右就往左
      const side = (dx * oz - dz * ox) > 0 ? -1 : 1;
      const w = Math.min(1.6, (R + 1.4 - d) / 1.4 * 1.6) * ahead;
      sx += -dz * side * w;
      sz += dx * side * w;
    }
    const n = Math.hypot(sx, sz) || 1;
    return [sx / n, sz / n];
  }

  // 星核占领:半径内只有一方(非建筑)单位时推进进度;满格获得归属,对方把进度推过 0 则失去归属
  updateNode(dt) {
    const N = this.map.node, node = this.node;
    let p = 0, e = 0;
    for (const u of this.units) {
      if (u.dead || u.building || Math.hypot(u.x - N.x, u.z - N.z) > N.r + u.radius) continue;
      if (u.side === 'p') p++; else e++;
    }
    node.contested = p > 0 && e > 0;
    const before = node.owner;
    if (p > 0 && e === 0) node.progress = Math.min(1, node.progress + dt / N.captureTime);
    else if (e > 0 && p === 0) node.progress = Math.max(-1, node.progress - dt / N.captureTime);
    if (node.progress >= 1) node.owner = 'p';
    else if (node.progress <= -1) node.owner = 'e';
    else if ((node.owner === 'p' && node.progress <= 0) || (node.owner === 'e' && node.progress >= 0)) node.owner = null;
    node.capturing = p > 0 && e === 0 && node.progress < 1 ? 'p'
      : e > 0 && p === 0 && node.progress > -1 ? 'e' : null;
    if (node.owner !== before) this.events.push({ type: 'node', owner: node.owner, prev: before });
  }

  // 单位互相推开(空中与地面分层;建筑卡不动)
  separate() {
    const alive = this.units.filter(u => !u.dead);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        if (a.air !== b.air) continue;
        if (a.building && b.building) continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d >= min) continue;
        if (d < 1e-4) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; d = Math.hypot(dx, dz); }
        const push = min - d;
        const ka = a.building ? 0 : b.building ? 1 : 0.5;
        const kb = 1 - ka;
        a.x -= dx / d * push * ka; a.z -= dz / d * push * ka;
        b.x += dx / d * push * kb; b.z += dz / d * push * kb;
      }
    }
    for (const u of alive) {
      if (!u.air) {
        const q = pushOutOfWalls(u.x, u.z, u.radius, this.map);
        if (q) { u.x = q.x; u.z = q.z; }
        for (const o of this.map.obstacles) {
          const d = Math.hypot(u.x - o.x, u.z - o.z), min = u.radius + o.r + (u.building ? 0 : ROCK_CLEARANCE);
          if (d < min) {
            if (d <= 1e-4) { u.x = o.x + min; continue; }   // 正好在中心:随便选个方向推出去
            u.x = o.x + (u.x - o.x) / d * min;
            u.z = o.z + (u.z - o.z) / d * min;
          }
        }
      }
      if (!u.air && !u.building) {
        for (const s of this.structures) {
          if (s.dead) continue;
          const d = dist2(u, s), min = u.radius + s.radius;
          if (d < min && d > 1e-4) {
            u.x = s.x + (u.x - s.x) / d * min;
            u.z = s.z + (u.z - s.z) / d * min;
          }
        }
      }
      u.x = Math.max(-FIELD_W, Math.min(FIELD_W, u.x));
      u.z = Math.max(-FIELD_HALF, Math.min(FIELD_HALF, u.z));
    }
  }

  // 塔和基地射击射程内最近的敌方单位(对空)
  structuresFire(dt) {
    for (const s of this.structures) {
      if (s.dead) continue;
      s.cooldown -= dt;
      if (s.cooldown > 0) continue;
      let best = null, bestD = s.range;
      for (const u of this.units) {
        if (u.dead || u.side === s.side) continue;
        const d = this.gap(s, u);
        if (d < bestD) { bestD = d; best = u; }
      }
      if (best) {
        s.cooldown = s.interval * PACE.attack;
        this.events.push({ type: 'attack', from: s, to: best, ranged: true });
        this.damage(best, s.atk, s);
      }
    }
  }

  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }
}

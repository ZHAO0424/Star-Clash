// 卡牌与势力数据
// 4 大势力:玩法差异平衡,无克制关系(设计见规划文档)
//
// ── 单位/建筑字段 ──
//   cost 法力 · hp · atk · speed 格/秒 · range 攻击半径 · interval 攻击间隔(秒)
//   所有单位视野半径统一为 SIGHT(game.js),视野内发现敌人会转向追击
// ── 机制字段(可组合)──
//   air          飞行:只有"对空"单位/建筑能打到它;不与地面单位碰撞
//   hitsAir      对空:能攻击飞行单位(远程单位默认对空,近战默认不对空)
//   count        一张牌部署多个单位
//   splash       溅射半径:攻击伤害波及目标周围
//   chain        连锁:攻击额外弹射到 N 个附近敌人(伤害 ×0.6)
//   siege        攻城:只攻击建筑(塔、基地、建筑卡)
//   shield       护盾:优先吸收伤害,不可回复
//   aura         光环:{ atk 攻击加成比例, radius } 附近友军
//   lifesteal    吸血:造成伤害的比例回复自身
//   unstoppable  免控:不会被瘫痪(EMP 等)和黑客入侵倒戈(伤害照常)
//   berserk      狂暴:生命低于一半时攻速 ×2、移速 ×1.3
//   evolveInto / evolveTime   存活 N 秒后进化为另一张卡(保留生命比例)
//   deathSpawn   亡语召唤:{ card, count }
//   deathBurst   亡语爆炸:{ damage, radius }
//   kamikaze     自爆:接触目标即触发亡语爆炸
//   devour       吞噬:击杀后回复被击杀者 30% 最大生命
//   ethereal     虚体:30% 闪避
// ── 建筑卡(type: 'building')──
//   lifetime 持续秒数(生命随时间流失) · spawn { card, interval } 定时产兵 · pulse { damage, radius, interval } 范围脉冲
// ── 法术卡 ──
//   needTarget 需要指定落点 · radius 作用半径 · ownHalf 只能放在己方半场
// token: true 的卡只由其他牌召唤,不进卡组

export const FACTIONS = {
  steel: { id: 'steel', name: '钢铁联盟', desc: '军衔成长 · 护盾光环 · 阵地推进', color: 0xd4a017, accent: 0x2255cc, shape: 'box',
    passive: { name: '老兵军衔', desc: '单位每存活10秒升1级军衔（最高3级），每级生命、攻击+20%' } },
  mecha: { id: 'mecha', name: '玛雅智械', desc: '空中编队 · 入侵控制 · 自动产兵', color: 0x00c8d4, accent: 0xcc3333, shape: 'octa',
    passive: { name: '战术网络', desc: '相邻单位自动组网：所受伤害40%由同伴分摊，攻速+35%' } },
  swarm: { id: 'swarm', name: '虫群同化', desc: '孵化扩张 · 进化变异 · 寄生同化', color: 0x7a30c9, accent: 0x3fae4a, shape: 'blob',
    passive: { name: '同化', desc: '虫群击杀的地面敌人化为虫茧，3秒后孵出1只幼虫（虫茧可被摧毁）' } },
  chaos: { id: 'chaos', name: '混沌腐化', desc: '献祭自爆 · 吸血狂暴 · 诅咒腐蚀', color: 0x30d060, accent: 0x8020a0, shape: 'spike',
    passive: { name: '血祭', desc: '法力不足时以核心生命补费：每点110生命（核心保底300，冷却13秒）' } },
};

const unit = (id, faction, name, cost, hp, atk, speed, range, interval, desc, extra = {}) =>
  ({ id, faction, type: 'unit', name, cost, hp, atk, speed, range, interval, desc, ...extra });
const building = (id, faction, name, cost, hp, atk, range, interval, lifetime, desc, extra = {}) =>
  ({ id, faction, type: 'building', name, cost, hp, atk, speed: 0, range, interval, lifetime, desc, ...extra });
const spell = (id, faction, name, cost, effect, desc, extra = {}) =>
  ({ id, faction, type: 'spell', name, cost, effect, desc, ...extra });

const LIST = [
  // ── 钢铁联盟:强化 · 护盾 · 据点 ──
  unit('steel_infantry', 'steel', '联盟步兵', 2, 115, 21, 0.9, 0.7, 1.0, '可对空的主力步兵', { hitsAir: true }),
  unit('steel_tank', 'steel', '重装坦克', 5, 390, 34, 0.5, 0.7, 1.2, '重甲前排，推进缓慢'),
  unit('steel_artillery', 'steel', '火炮哨站', 4, 160, 28, 0.35, 2.8, 1.5, '远程炮击，溅射伤害', { splash: 0.15 }),
  unit('steel_shield', 'steel', '护盾兵', 3, 170, 15, 0.8, 0.7, 1.0, '自带200护盾，前排抗伤', { shield: 200 }),
  unit('steel_banner', 'steel', '军旗手', 3, 180, 11, 0.8, 0.7, 1.0, '光环：周围友军攻击+40%、移速+20%', { aura: { atk: 0.4, speed: 0.2, radius: 1.8 } }),
  unit('steel_siege', 'steel', '攻城战车', 5, 463, 62, 0.55, 0.8, 1.6, '只打建筑与塔，专职拆塔', { siege: true }),
  building('steel_turret', 'steel', '防御炮台', 4, 424, 28, 2.6, 0.9, 35, '防守炮台，可对空', { hitsAir: true }),
  spell('steel_buff_atk', 'steel', '全员强化', 2, 'buff_atk', '场上友军攻击永久+10', { value: 10 }),
  spell('steel_repair', 'steel', '装甲维修', 2, 'heal_area', '范围友军回复150生命',
    { value: 150, radius: 2.2, needTarget: true }),   // 第三轮:全图回 120 → 半径 2.2 内回 150(拖牌时自动吸附受伤单位,见 heal-snap.js)
  spell('steel_strike', 'steel', '轨道炮击', 4, 'strike', '1.2秒后范围伤害200（建筑40%）',
    { damage: 200, radius: 1.3, delay: 1.2, structFactor: 0.4, needTarget: true }),
  spell('steel_barrier', 'steel', '紧急护盾', 3, 'shield_area', '范围友军获得150护盾',
    { value: 150, radius: 2.0, needTarget: true }),

  // ── 玛雅智械:空中 · 控制 · 自动化 ──
  unit('mecha_drone', 'mecha', '侦察无人机', 2, 74, 15, 1.4, 1.5, 0.8, '高速飞行，骚扰牵制', { air: true, hitsAir: true }),
  unit('mecha_sentry', 'mecha', '哨戒炮', 3, 130, 25, 0.6, 2.5, 1.2, '远程火力平台，移动缓慢'),
  unit('mecha_walker', 'mecha', '战术机甲', 5, 340, 36, 0.7, 0.8, 1.1, '攻守均衡的主战机甲'),
  unit('mecha_swarmdrone', 'mecha', '蜂群无人机', 3, 33, 9, 1.3, 1.3, 0.7, '部署3架飞行无人机',
    { air: true, hitsAir: true, count: 3 }),
  unit('mecha_arc', 'mecha', '电弧兵', 4, 210, 28, 0.7, 1.8, 1.2, '攻击连锁3个额外敌人', { chain: 3 }),
  unit('mecha_sniper', 'mecha', '狙击单元', 4, 113, 60, 0.5, 3.0, 2.4, '超远射程，单发高伤'),
  building('mecha_factory', 'mecha', '无人机工厂', 5, 382, 0, 0, 1, 30, '每9秒产出1架侦察无人机',
    { spawn: { card: 'mecha_drone', interval: 9 } }),
  spell('mecha_emp', 'mecha', 'EMP脉冲', 2, 'stun_area', '范围伤害45，眩晕2.5秒',
    { value: 2.5, damage: 45, radius: 1.6, needTarget: true }),
  spell('mecha_hack', 'mecha', '黑客入侵', 3, 'hack', '范围内最强敌人倒戈3秒',
    { value: 3, radius: 1.2, needTarget: true }),
  spell('mecha_chain', 'mecha', '连锁闪电', 3, 'chain', '闪电连锁4次，每次110伤害',
    { damage: 110, jumps: 4, radius: 1.5, needTarget: true }),
  spell('mecha_airdrop', 'mecha', '无人机空投', 4, 'spawn', '我方半场空投2架侦察无人机',
    { card: 'mecha_drone', count: 2, radius: 0.6, needTarget: true, ownHalf: true }),

  // ── 虫群同化:孵化 · 进化 · 寄生 ──
  unit('swarm_worker', 'swarm', '工兵虫', 1, 80, 16, 1.1, 0.6, 0.9, '存活15秒进化为战斗虫',
    { evolveInto: 'swarm_warrior', evolveTime: 15 }),
  unit('swarm_warrior', 'swarm', '战斗虫', 3, 245, 31, 1.0, 0.6, 1.0, '虫群主力近战'),
  unit('swarm_devourer', 'swarm', '吞噬者', 5, 311, 40, 0.8, 0.7, 1.1, '击杀时回复目标30%最大生命', { devour: true }),
  unit('swarm_brood', 'swarm', '幼虫群', 2, 50, 9, 1.3, 0.5, 0.8, '孵出4只幼虫', { count: 4 }),
  unit('swarm_mother', 'swarm', '孵化母虫', 4, 264, 18, 0.6, 0.7, 1.2, '亡语：孵出4只幼虫',
    { deathSpawn: { card: 'swarm_larva', count: 4 } }),
  unit('swarm_spitter', 'swarm', '酸液喷吐者', 3, 121, 21, 0.8, 2.2, 1.3, '远程酸液，溅射伤害', { splash: 0.6 }),
  unit('swarm_flyer', 'swarm', '飞翼虫', 3, 111, 22, 1.3, 0.7, 0.9, '飞行，可与空中单位缠斗', { air: true, hitsAir: true }),
  building('swarm_hive', 'swarm', '孵化巢', 4, 295, 0, 0, 1, 30, '每6秒孵出1只工兵虫',
    { spawn: { card: 'swarm_worker', interval: 6 } }),
  spell('swarm_convert', 'swarm', '同化孢子', 5, 'convert', '永久同化1个≤4费敌军（优先残血）', { maxCost: 4 }),
  // 原「群体进化」(胜率 44%,全场最弱)改为基因拟态;id 保持不变,已保存的卡组和卡面图不受影响
  spell('swarm_evolve', 'swarm', '基因拟态', 3, 'mimic', '复制范围内最贵敌军（≤5费），生命70%',
    { radius: 1.6, maxCost: 5, hpFactor: 0.7, needTarget: true }),
  spell('swarm_parasite', 'swarm', '寄生', 3, 'parasite', '范围敌军中毒8秒，期间阵亡化为2只幼虫',
    { radius: 1.5, duration: 8, dps: 6, spawnCard: 'swarm_larva', spawnCount: 2, needTarget: true }),
  { ...unit('swarm_larva', 'swarm', '幼虫', 1, 38, 9, 1.3, 0.5, 0.8, '虫群衍生幼体'), token: true },
  // 同化(虫群招牌机制)留下的虫茧:不会自己衰减,到时间孵出幼虫;被敌人打掉就没了
  { ...building('swarm_cocoon', 'swarm', '虫茧', 0, 70, 0, 0, 1, 999, '3秒后孵出幼虫', { cocoon: { card: 'swarm_larva', time: 3 } }), token: true },

  // ── 混沌腐化:献祭 · 吸魂 · 诅咒 ──
  unit('chaos_warrior', 'chaos', '扭曲战士', 2, 123, 30, 1.0, 0.7, 1.0, '低费近战，攻击凶猛'),
  unit('chaos_wraith', 'chaos', '灵魂体', 3, 101, 41, 1.2, 0.7, 0.9, '虚体：30%闪避攻击', { ethereal: true }),
  unit('chaos_construct', 'chaos', '恶魔构造体', 6, 400, 52, 0.55, 0.8, 1.3, '重型巨像，免疫眩晕与入侵', { unstoppable: true }),
  unit('chaos_zealot', 'chaos', '自爆邪徒', 2, 96, 0, 1.4, 0.4, 1.0, '冲向塔与建筑自爆，范围伤害135',
    { siege: true, kamikaze: true, deathBurst: { damage: 135, radius: 1.2 } }),
  unit('chaos_berserker', 'chaos', '狂战士', 3, 190, 31, 1.0, 0.7, 1.0, '半血以下狂暴：攻速×2', { berserk: true }),
  unit('chaos_soulreaver', 'chaos', '吸魂者', 4, 225, 33, 0.8, 1.4, 1.1, '远程攻击，吸血32%',
    { lifesteal: 0.32, hitsAir: true }),
  unit('chaos_bats', 'chaos', '虚空蝠', 3, 68, 17, 1.4, 0.7, 0.8, '2只飞行蝙蝠，吸血20%',
    { air: true, hitsAir: true, count: 2, lifesteal: 0.2 }),
  building('chaos_obelisk', 'chaos', '腐化方尖碑', 4, 328, 0, 0, 1, 30, '周围2.2格每秒26腐蚀（含空中）',
    { pulse: { damage: 26, radius: 2.2, interval: 1 } }),
  spell('chaos_rain', 'chaos', '腐化之雨', 3, 'dot_area', '范围每秒22腐蚀，持续4秒',
    { value: 22, duration: 4, radius: 1.8, needTarget: true }),
  spell('chaos_drain', 'chaos', '灵魂抽取', 2, 'drain', '最强敌军受125伤害，核心回复125', { value: 125 }),
  spell('chaos_sacrifice', 'chaos', '献祭', 2, 'sacrifice', '引爆范围友军，造成其剩余生命120%伤害',
    { radius: 1.4, factor: 1.2, burstRadius: 1.8, needTarget: true }),
  spell('chaos_curse', 'chaos', '诅咒', 3, 'curse', '范围敌军受到伤害+60%，持续7秒',
    { radius: 1.8, duration: 7, value: 1.6, needTarget: true }),
];

export const CARDS = Object.fromEntries(LIST.map(c => [c.id, c]));

// 势力全部可用牌(卡组构筑的候选池)
export function factionPool(factionId) {
  return Object.values(CARDS).filter(c => c.faction === factionId && !c.token);
}

// ── 卡组 ──
export const DECK_SIZE = 8;
export const MIN_DEPLOYABLES = 4;   // 至少 4 张单位/建筑,防止全法术卡组

// 每个势力的推荐卡组
export const PRESET_DECKS = {
  steel: ['steel_infantry', 'steel_tank', 'steel_artillery', 'steel_shield', 'steel_banner', 'steel_siege', 'steel_repair', 'steel_strike'],
  mecha: ['mecha_drone', 'mecha_sentry', 'mecha_walker', 'mecha_swarmdrone', 'mecha_arc', 'mecha_sniper', 'mecha_emp', 'mecha_chain'],
  swarm: ['swarm_worker', 'swarm_warrior', 'swarm_devourer', 'swarm_brood', 'swarm_mother', 'swarm_spitter', 'swarm_flyer', 'swarm_parasite'],
  chaos: ['chaos_warrior', 'chaos_wraith', 'chaos_construct', 'chaos_zealot', 'chaos_berserker', 'chaos_soulreaver', 'chaos_bats', 'chaos_rain'],
};

// 卡组问题:合法返回 null,否则 { code: 'size' | 'dup' | 'faction' | 'deploy', card? }(界面按语言翻译)
export function deckProblem(factionId, ids) {
  if (!Array.isArray(ids) || ids.length !== DECK_SIZE) return { code: 'size' };
  if (new Set(ids).size !== ids.length) return { code: 'dup' };
  for (const id of ids) {
    const c = Object.hasOwn(CARDS, id) ? CARDS[id] : null;
    if (!c || c.token || c.faction !== factionId) return { code: 'faction', card: c ? c.id : String(id) };
  }
  if (ids.filter(id => CARDS[id].type !== 'spell').length < MIN_DEPLOYABLES) return { code: 'deploy' };
  return null;
}

// 校验卡组:返回错误信息(中文,日志 / 服务器用),合法返回 null
export function validateDeck(factionId, ids) {
  const p = deckProblem(factionId, ids);
  if (!p) return null;
  return {
    size: `卡组须为${DECK_SIZE}张`, dup: '不可携带重复卡牌',
    faction: `${CARDS[p.card]?.name ?? p.card}不属于本势力`, deploy: `至少携带${MIN_DEPLOYABLES}张单位/建筑`,
  }[p.code];
}

// Fisher-Yates 洗牌(返回新数组)。sort(() => random-0.5) 分布不均:首张牌排到队首的概率会偏高到 22%
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 随机合法卡组(平衡模拟用)
export function randomDeck(factionId) {
  const pool = factionPool(factionId).map(c => c.id);
  for (;;) {
    const ids = shuffle(pool).slice(0, DECK_SIZE);
    if (!validateDeck(factionId, ids)) return ids;
  }
}

// 卡面关键词标签(桌面卡牌和 XR 卡牌共用)
export function cardTags(c) {
  const t = [];
  if (c.type === 'building') t.push(`建筑${c.lifetime}秒`);
  if (c.air) t.push('飞行');
  if (c.hitsAir ?? (c.type !== 'spell' && c.range > 1.2)) t.push('对空');
  if (c.count > 1) t.push(`×${c.count}`);
  if (c.siege) t.push('攻城');
  if (c.splash) t.push('溅射');
  if (c.chain) t.push('连锁');
  if (c.shield) t.push('护盾');
  if (c.aura) t.push('光环');
  if (c.lifesteal) t.push('吸血');
  if (c.unstoppable) t.push('免控');
  if (c.berserk) t.push('狂暴');
  if (c.evolveInto) t.push('进化');
  if (c.deathSpawn) t.push('亡语');
  if (c.kamikaze) t.push('自爆');
  if (c.devour) t.push('吞噬');
  if (c.ethereal) t.push('闪避');
  if (c.type !== 'spell' && c.range > 1.2) t.push('远程');
  return t;
}

// 部署特效(锁定法阵 / 降临)按体型分 3 档(第四轮):建筑 1.0;一张牌出多只的群兵 0.55;5 费以上或空中单位 0.75;其余 0.55。
// 以前法阵直接用 previewRadius(含攻击射程),远程单位的法阵能占半个战场
export function deployFxRadius(c) {
  if (c.type === 'building') return 1.0;
  if (c.count > 2) return 0.55;
  return c.cost >= 5 || c.air ? 0.75 : 0.55;
}
// 降临序列(冲击环 / 闪光 / 光柱)按同一档缩放:小 0.75、中 1、大 1.2
export const deployFxScale = c => ({ 0.55: 0.75, 0.75: 1, 1: 1.2 })[deployFxRadius(c)];

// 落点预览圈半径:单位 = 攻击范围;建筑 = 攻击/脉冲/光环范围;范围法术 = 作用半径
export function previewRadius(c) {
  if (c.type === 'spell') return c.radius || 0.3;
  const body = c.type === 'building' ? 0.42 : 0.22;
  if (c.pulse) return c.pulse.radius;
  if (c.aura) return c.aura.radius;
  return c.atk > 0 ? c.range + body : body;
}

// 肉鸽强化选项池
export const UPGRADES = [
  { id: 'up_atk',    name: '攻击强化', desc: '全体单位攻击+15%',     apply: s => { s.atkMul *= 1.15; } },
  { id: 'up_hp',     name: '装甲强化', desc: '全体单位生命+20%',     apply: s => { s.hpMul *= 1.20; } },
  { id: 'up_mana',   name: '法力涌动', desc: '法力回复+25%',     apply: s => { s.manaRegen *= 1.25; } },
  { id: 'up_speed',  name: '快速部署', desc: '全体单位移速+15%',     apply: s => { s.speedMul *= 1.15; } },
  { id: 'up_maxmana',name: '法力扩容', desc: '法力上限+2',           apply: s => { s.manaMax += 2; } },
  { id: 'up_frenzy', name: '战争狂热', desc: '全体攻击间隔-15%',         apply: s => { s.intervalMul *= 0.85; } },
  { id: 'up_basehp', name: '核心加固', desc: '核心回复200生命',     apply: s => { s.baseHP = Math.min(s.baseHPMax, s.baseHP + 200); } },
];

const FACTION_UPGRADES = [
  { id: 'up_steel_armor', icon: 'up_hp', faction: 'steel', name: '老兵防护', desc: '有军衔的钢铁单位受伤-12%', apply: s => { s.veteranArmor = 0.88; } },
  { id: 'up_steel_rank', icon: 'up_atk', faction: 'steel', name: '战地晋升', desc: '升衔间隔缩短至8秒', apply: s => { s.veteranTime = 8; } },
  { id: 'up_swarm_hatch', icon: 'up_speed', faction: 'swarm', name: '快速孵化', desc: '虫茧孵化缩短至2.25秒', apply: s => { s.cocoonTime = 0.75; } },
  { id: 'up_swarm_shell', icon: 'up_hp', faction: 'swarm', name: '硬壳虫茧', desc: '虫茧生命+35%', apply: s => { s.cocoonHp = 1.35; } },
  { id: 'up_mecha_share', icon: 'up_hp', faction: 'mecha', name: '防御网络', desc: '网络分摊伤害提至50%', apply: s => { s.linkShare = 0.50; } },
  { id: 'up_mecha_haste', icon: 'up_frenzy', faction: 'mecha', name: '突击网络', desc: '网络攻速加成提至50%', apply: s => { s.linkHaste = 0.5; } },
  { id: 'up_chaos_price', icon: 'up_maxmana', faction: 'chaos', name: '血契', desc: '血祭每点法力仅耗90核心生命', apply: s => { s.bloodPrice = 90; } },
  { id: 'up_chaos_cooldown', icon: 'up_speed', faction: 'chaos', name: '再祭', desc: '血祭冷却缩短至10秒', apply: s => { s.bloodCooldown = 10; } },
];

export const ALL_UPGRADES = [...UPGRADES, ...FACTION_UPGRADES];

export function rollUpgrades(n = 3, faction, picked = []) {
  const pool = [...UPGRADES];
  const out = FACTION_UPGRADES.filter(u => u.faction === faction && !picked.includes(u.id)).slice(0, n);
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

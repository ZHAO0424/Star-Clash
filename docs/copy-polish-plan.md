# 星轨对决 · 全游戏文案精炼方案（copy polish plan）

> 状态：**已落地**（2026-11-17，用户批准「按推荐落地」；第 5 节一律取默认建议，第 3 节改名全部不采纳）。落地偏离与未做项见第 6 节；英文版专项审查见第 7 节。
> 日期：2026-11-17 · 分支：main
> 目标：用户原话「游戏整体的文字是不是可以专业化游戏化，精炼一点」。
> 原则：**只改字面，不改数值、不改玩法、不改 i18n 键名**。数值全部对照 `js/cards.js` / `js/game.js` 核过。

---

## 0. 盘点结果

| 出处 | 玩家可见文本条数 | 说明 |
|---|---|---|
| `js/i18n.js` `UI.zh`（行 24–92） | 253 键（其中 **8 键已无人引用**） | 英文同键在 `UI.en`，行号 = 中文行号 + 71 |
| `js/i18n.js` 英文对照表 | PASSIVE_EN 4 · FACTION_EN 4 · CARD_EN 47 · TAG_EN 17 · UPGRADE_EN 15 | 共 87 组（名+描述） |
| `js/cards.js` | 势力 4×4=16 · 卡牌 47×2=94 · 卡面关键词 18 · 强化 15×2=30 | 合计 158 条；`validateDeck` 4 条只进日志/服务器，不算 |
| `js/scenes.js` | 已开放 3 张图 × (名/英文名/描述/英文描述)=12 | 另 5 张未开放图（菌毯巢地等）只在开发对比页出现，低优先 |
| `index.html` | 75 个 `data-i18n*` 节点 + 6 处未打键的中文 | 都是首帧兜底文本，`applyStaticText()` 后被 i18n 覆盖 |
| `server/server.mjs` | 9 条（直接发给客户端显示的报错 + 游客名） | **没走 i18n**，英文玩家也看到中文 |
| `js/main.js` / `xr.js` / `xr-palm-menu.js` 等 | 0 条硬编码玩家文本 | 全部走 `t()`；`main.js:1383–1401` 是开发对比页，`unit-size.js`、`map.js` 塔名是内部标签，均不在范围 |

**全量约 520 条**（中文 ≈ 430，英文 ≈ 340，有重叠）。下面改写表覆盖全部；无需改动的条目在每节末尾「保持不变」里列出键名。

---

## 1. 术语表（统一后的关键词）

| # | 概念 | 旧（混用现状） | 新（统一） | 英文 | 理由 |
|---|---|---|---|---|---|
| T1 | 出牌资源 | 法力 / 能量（能量涌潮、能量涌动、能量扩容）/ 回能 / 回蓝 / 补费 | **法力** | Mana | 代码字段、卡面费用圈、HUD 都叫法力；「能量 / 回蓝」是同一资源的第二、三个名字。⚠ 见拍板点 D1 |
| T2 | 玩家主基地 | 核心 / 基地（基地加固、基地回复） | **核心** | Core | HUD、结算都叫核心；「基地」只剩强化卡里两处 |
| T3 | 中央占领点 | 星核 / 中央星核 / 星核祭坛 / 中央金圈 | **星核** | Starcore（一个词） | 与「核心」只差一字，必须永远写全「星核」，绝不单写「核心」；英文用 Starcore 拼成一个词，避免和 Core 混 |
| T4 | 塔 | 塔 / 敌方塔 / 建筑（加时规则里）/ 前哨塔 | **防御塔**（总称，口语可简称「塔」）= 前哨炮 + 侧翼塔；核心不算塔 | Tower | `game.crowns()` 只数非核心的塔；加时文案写「任意一座建筑」会让人以为建筑卡也算——**这是误导**（`game.js:904`） |
| T5 | 建筑 | 建筑卡 + 塔 都叫建筑 | **建筑 = 只指建筑卡**（炮台、工厂、孵化巢、方尖碑） | Building | 与 T4 分开 |
| T6 | 出牌动作 | 出牌 / 部署 / 出兵 / 施放 | **出牌**=打出任何牌（通用提示）；**部署**=单位/建筑落地；**施放**=法术 | Play / Deploy / Cast | 炉石用「使用」，皇室战争用「部署」；三词各管一层，不再混用「出兵」 |
| T7 | 控制效果 | 瘫痪（EMP、免控说明）/ 眩晕（陨星） | **眩晕** | Stun | 两处是同一个 `status.stun`；英文已经是 Stun。⚠ 拍板点 D3 |
| T8 | 倒戈控制 | 黑客入侵 / 入侵 / 倒戈 | 卡名「黑客入侵」不动；关键词 **入侵**，效果动词 **倒戈** | Hack / turn | 免控说明里写「免疫眩晕与入侵」 |
| T9 | 钢铁被动成长 | 升一级军衔 / 升阶 / 升一阶 / 已升阶 | **军衔**（「升衔」「有军衔的」） | Rank | 被动叫「老兵军衔」，强化卡却写「升阶」 |
| T10 | 生命 | 生命 / 血量 / 血 | **生命** | HP | 加时结算里「建筑血量」→「生命」 |
| T11 | 属性缩写 | 攻击 / 攻击力 / 攻击速度 / 移动速度 | **攻击、攻速、移速、射程** | ATK / attack speed / speed / range | 卡面空间小 |
| T12 | 阵营指代 | 己方 / 我方 / 你的 / 蓝方 | **我方 / 敌方**；单位层面用 **友军 / 敌军** | You / Enemy · allies / enemies | `index.html:420` 写「己方核心」而 i18n 写「我方核心」，同一位置两种写法 |
| T13 | 范围 | 范围内 / 落点附近 / 周围 | **范围**（范围伤害 X、范围友军…） | in area | 句式统一 |
| T14 | 持续伤害 | 腐蚀 / 中毒 / 烧灼 | 保留三种风味（混沌=腐蚀，虫群=中毒，熔岩=**灼烧**），句式统一「每秒X腐蚀」 | corrosion / poison / burn | 「烧灼」→「灼烧」更常用 |
| T15 | 加时 | 加时赛 | **加时** | Overtime / OT | 省字 |
| T16 | 人机 | 人机 / AI（「简单 AI」） | 中文统一 **人机**，英文统一 **AI** | AI | |
| T17 | 地图 | 战场 / 棋盘（XR 设置）/ 场景 | **战场** | Arena | 「棋盘尺寸」和「战场位置已复位」说的是同一个桌面沙盘 |
| T18 | 两个大厅 | 空间大厅（XR）/ 大厅（联机结算「回到大厅」） | **空间大厅** vs **联机大厅** | XR Lobby / Online Lobby | 现在两个都叫「大厅」 |
| T19 | 弹射 | 连锁（关键词）/ 弹射（描述） | 关键词保留「连锁」，描述统一「连锁N个敌人」 | Chain | |
| T20 | 卡面句式 | — | 「范围伤害X」「每秒X」「持续X秒」「眩晕X秒」「X秒后…」「每X秒产出…」 | `X area damage` · `X/s` · `for Xs` | 同类效果同一句式 |

**排版规则**

- 中文一律全角标点（，：；！（）「」），现在大量混用半角 `,` `:` `(` `!`。
- 中文与数字之间**不加空格**（卡面省宽度）：`攻击+15%`、`持续4秒`、`3秒后`。
- 分隔符统一 ` · `（前后各一个空格）。
- 删除靠空格做的字距：`联 机 对 战`、`⚡ 强 化 阶 段`——CSS 已有 `letter-spacing`（`index.html:34,130`）。XR 画布里的 `胜 利` 见落地注意 L9。
- 英文：句首大写、短句可省句号；数值用 `s`、`/s`、`+15%`；卡名 Title Case。

---

## 2. 改写表

字数目标：按钮 ≤4 字、toast ≤12 字、卡牌描述 ≤20 字。超出处在备注标 **⚠超**。

### 2.1 卡牌描述（`js/cards.js` + `js/i18n.js` CARD_EN）

卡名默认不改，改名见第 3 节。括号内为改写后字数（按字符计，数字和标点各算 1）。

| 位置 | 原文 | 改写 | 英文改写 | 备注 |
|---|---|---|---|---|
| cards.js:51 联盟步兵 | 持枪步兵,能对空射击 | 可对空的主力步兵（8） | Frontline rifleman. Hits air. | |
| cards.js:52 重装坦克 | 厚重装甲,缓慢推进 | 重甲前排，推进缓慢（9） | Heavy armor, slow advance. | |
| cards.js:53 火炮哨站 | 远程炮击,溅射伤害 | 远程炮击，溅射伤害（9） | Long-range splash shelling. | 只改标点 |
| cards.js:54 护盾兵 | 展开能量盾,替队友吃伤害 | 自带200护盾，前排抗伤（12） | Starts with a 200 shield. Frontline tank. | **原文与机制不符**：代码只有自身 `shield: 200`，没有替队友承伤逻辑。⚠ 拍板点 D8 |
| cards.js:55 军旗手 | 附近友军攻击 +40%、移速 +20% | 光环：周围友军攻击+40%、移速+20%（20） | Aura: nearby allies +40% ATK, +20% speed. | |
| cards.js:56 攻城战车 | 只攻击建筑,拆塔利器 | 只打建筑与塔，专职拆塔（11） | Targets buildings and towers only. | siege 只打塔/核心/建筑卡，原文「建筑」不含塔，按 T4/T5 补全 |
| cards.js:57 防御炮台 | 据点炮台,可对空 | 防守炮台，可对空（8） | Defensive turret. Hits air. | 持续35秒已在关键词「建筑35秒」 |
| cards.js:58 全员强化 | 己方所有单位 攻击+10(永久) | 场上友军攻击永久+10（11） | Allies on the field gain +10 ATK permanently. | 代码只加给**当前在场**单位（`game.js:315`），原文「所有单位」会让人以为之后出的也加 |
| cards.js:59 装甲维修 | 范围内己方单位 回复150生命 | 范围友军回复150生命（11） | Heal allies in area for 150. | |
| cards.js:61 轨道炮击 | 1.2秒后落下:范围200伤害(对建筑40%) | 1.2秒后范围伤害200（建筑40%）（19） | After 1.2s: 200 area damage (40% to structures). | 原 22 字 |
| cards.js:63 紧急护盾 | 范围内友军 获得150护盾 | 范围友军获得150护盾（11） | Allies in area gain a 150 shield. | |
| cards.js:67 侦察无人机 | 飞行,快速骚扰 | 高速飞行，骚扰牵制（9） | Fast flying harasser. | |
| cards.js:68 哨戒炮 | 移动缓慢的远程平台 | 远程火力平台，移动缓慢（11） | Slow-moving ranged platform. | |
| cards.js:69 战术机甲 | 均衡的主战单位 | 攻守均衡的主战机甲（9） | Balanced main battle mech. | |
| cards.js:70 蜂群无人机 | 一次部署3架飞行无人机 | 部署3架飞行无人机（9） | Deploys 3 flying drones. | |
| cards.js:72 电弧兵 | 攻击连锁弹射3个敌人 | 攻击连锁3个额外敌人（10） | Attacks chain to 3 more enemies. | 可选补「(60%伤害)」，见 D7 |
| cards.js:73 狙击单元 | 超远射程,高单发伤害 | 超远射程，单发高伤（9） | Extreme range, heavy single shots. | |
| cards.js:74 无人机工厂 | 每9秒生产一架侦察无人机 | 每9秒产出1架侦察无人机（12） | Builds a Scout Drone every 9s. | |
| cards.js:76 EMP脉冲 | 范围内敌军 受45伤害并瘫痪2.5秒 | 范围伤害45，眩晕2.5秒（13） | 45 area damage, stun 2.5s. | 瘫痪→眩晕（T7） |
| cards.js:78 黑客入侵 | 范围内最强的敌人 倒戈为你作战3秒 | 范围内最强敌人倒戈3秒（11） | Turns the strongest enemy in area for 3s. | |
| cards.js:80 连锁闪电 | 击中落点附近敌人并弹射4次,各110伤害 | 闪电连锁4次，每次110伤害（14） | Lightning chains 4 times, 110 each. | |
| cards.js:82 无人机空投 | 在己方半场空投2架侦察无人机 | 我方半场空投2架侦察无人机（13） | Drops 2 Scout Drones on your half. | |
| cards.js:86 工兵虫 | 存活15秒后进化为战斗虫 | 存活15秒进化为战斗虫（11） | Evolves into a Warrior Bug after 15s. | |
| cards.js:88 战斗虫 | 虫群的主力战士 | 虫群主力近战（6） | Core swarm melee. | |
| cards.js:89 吞噬者 | 击杀敌人后吞噬恢复生命 | 击杀时回复目标30%最大生命（14） | On kill: heal 30% of the victim's max HP. | 补数值 30%（`game.js:564`），见 D7 |
| cards.js:90 幼虫群 | 一次孵化4只幼虫 | 孵出4只幼虫（6） | Hatches 4 Larvae. | |
| cards.js:91 孵化母虫 | 死亡时孵化4只幼虫 | 亡语：孵出4只幼虫（9） | On death: 4 Larvae. | |
| cards.js:93 酸液喷吐者 | 远程酸液,溅射 | 远程酸液，溅射伤害（9） | Ranged acid splash. | |
| cards.js:94 飞翼虫 | 飞行,可在空中缠斗 | 飞行，可与空中单位缠斗（11） | Flying dogfighter. | |
| cards.js:95 孵化巢 | 每6秒孵化一只工兵虫 | 每6秒孵出1只工兵虫（10） | Hatches a Worker Bug every 6s. | |
| cards.js:97 同化孢子 | 永久同化一个费用≤4的敌方单位(优先生命最低) | 永久同化1个≤4费敌军（优先残血）（17） | Permanently convert an enemy (cost ≤4), lowest HP first. | 原 22 字 |
| cards.js:99 基因拟态 | 复制落点附近费用最高的敌方单位(费用≤5)为你作战,复制体生命70% | 复制范围内最贵敌军（≤5费），生命70%（20） | Copy the costliest enemy in area (cost ≤5) at 70% HP. | 原 34 字，全游戏最长 |
| cards.js:101 寄生 | 范围敌军中毒8秒;寄生期间死亡会变成2只你的幼虫 | 范围敌军中毒8秒，期间阵亡化为2只幼虫（19） | Poison enemies in area for 8s; any that die become 2 Larvae. | 可选补「每秒6」，见 D7 |
| cards.js:103 幼虫（衍生） | 孵化出的幼虫 | 虫群衍生幼体（6） | Hatched swarm spawn. | |
| cards.js:105 虫茧（衍生） | 3 秒后孵出幼虫 | 3秒后孵出幼虫（7） | Hatches a Larva in 3s. | |
| cards.js:108 扭曲战士 | 被混沌扭曲的战士 | 低费近战，攻击凶猛（9） | Cheap, hard-hitting melee. | 2费30攻，同费步兵21攻，「凶猛」有数据支撑 |
| cards.js:109 灵魂体 | 虚体:30%概率闪避攻击 | 虚体：30%闪避攻击（10） | Ethereal: 30% dodge. | |
| cards.js:110 恶魔构造体 | 毁灭性的重型单位,免疫瘫痪和黑客入侵 | 重型巨像，免疫眩晕与入侵（12） | Heavy juggernaut. Immune to stun and hack. | |
| cards.js:111 自爆邪徒 | 冲向建筑自爆,范围135伤害 | 冲向塔与建筑自爆，范围伤害135（16） | Charges structures and explodes for 135 area damage. | siege 目标含塔 |
| cards.js:113 狂战士 | 生命低于一半时狂暴:攻速翻倍 | 半血以下狂暴：攻速×2（11） | Below 50% HP: attack speed ×2. | 代码还有移速×1.3（`game.js:863`），见 D7 |
| cards.js:114 吸魂者 | 远程吸魂,伤害的32%回复自身 | 远程攻击，吸血32%（10） | Ranged. 32% lifesteal. | |
| cards.js:116 虚空蝠 | 2只飞行吸血蝙蝠 | 2只飞行蝙蝠，吸血20%（12） | 2 flying bats, 20% lifesteal. | 补数值 20%（cards.js:117） |
| cards.js:118 腐化方尖碑 | 每秒对周围2.2格敌人造成26腐蚀(含空中) | 周围2.2格每秒26腐蚀（含空中）（17） | 26 corrosion/s within 2.2 tiles, incl. air. | 原 21 字 |
| cards.js:120 腐化之雨 | 范围内敌军 每秒22点腐蚀 持续4秒 | 范围每秒22腐蚀，持续4秒（13） | 22 corrosion/s in area for 4s. | |
| cards.js:122 灵魂抽取 | 对敌方最强单位造成125伤害,己方核心回复125 | 最强敌军受125伤害，核心回复125（18） | Deal 125 to the strongest enemy; heal your Core 125. | 原 21 字 |
| cards.js:123 献祭 | 范围内己方单位爆裂:按其剩余生命的120%伤害周围敌人 | 引爆范围友军，造成其剩余生命120%伤害（20） | Detonate allies in area for 120% of their remaining HP. | 原 27 字 |
| cards.js:125 诅咒 | 范围内敌军 7秒内受到的伤害 +60% | 范围敌军受到伤害+60%，持续7秒（17） | Enemies in area take +60% damage for 7s. | |

### 2.2 卡面关键词（`cards.js:190–211` + `i18n.js:238–242` TAG_EN）

| 位置 | 原文 | 改写 | 英文改写 | 备注 |
|---|---|---|---|---|
| cards.js:192 | 建筑{n}秒 | 不变 | Building {n}s | ⚠ 被 `i18n.js:267` 正则 `^建筑(\d+)秒$` 匹配，改了要同步（L2） |
| cards.js:205 | 亡语 | 不变 | **On Death**（原 Deathrattle） | Deathrattle 是炉石专有关键词，自家英文建议用通用说法 |
| cards.js:206 | 自爆 | 不变 | **Self-Destruct**（原 Explode） | Explode 是动词，作关键词不顺 |
| cards.js:202 | 免控 | 不变 | Unstoppable | 卡描述同步写「免疫眩晕与入侵」 |
| 其余 14 个 | 飞行/对空/×N/攻城/溅射/连锁/护盾/光环/吸血/狂暴/进化/吞噬/闪避/远程 | 不变 | 不变 | 已经够短、够标准 |

### 2.3 势力与被动（`cards.js:31–40` + `i18n.js:173–186`）

| 位置 | 原文 | 改写 | 英文改写 | 备注 |
|---|---|---|---|---|
| cards.js:32 钢铁 desc | 单位强化 · 护盾光环 · 据点推进 | 军衔成长 · 护盾光环 · 阵地推进 | Veterancy · Shields & auras · Steady push | 「单位强化」不点题，招牌机制是军衔 |
| cards.js:33 老兵军衔 | 单位每存活 10 秒升一级军衔(最多 3 级),每级生命和攻击 +20% | 单位每存活10秒升1级军衔（最高3级），每级生命、攻击+20% | Units rank up every 10s alive (max 3). +20% HP and ATK per rank. | |
| cards.js:34 玛雅 desc | 空中编队 · 黑客控制 · 自动化工厂 | 空中编队 · 入侵控制 · 自动产兵 | Air squadrons · Hacking · Auto-production | |
| cards.js:35 战术网络 | 彼此靠近的单位自动连成网络:受到的伤害由同伴分摊 40%,攻速 +35% | 相邻单位自动组网：所受伤害40%由同伴分摊，攻速+35% | Nearby units link up: 40% of damage taken is shared, +35% attack speed. | |
| cards.js:36 虫群 desc | 孵化扩张 · 进化转化 · 寄生同化 | 孵化扩张 · 进化变异 · 寄生同化 | Hatching · Evolution · Assimilation | |
| cards.js:37 同化 | 被虫群单位击杀的地面敌人化为虫茧,3 秒后孵出一只幼虫(虫茧可以被打掉) | 虫群击杀的地面敌人化为虫茧，3秒后孵出1只幼虫（虫茧可被摧毁） | Ground enemies slain by the Swarm become cocoons that hatch a Larva in 3s. Cocoons can be destroyed. | |
| cards.js:38 混沌 desc | 献祭自爆 · 吸魂狂暴 · 诅咒扭曲 | 献祭自爆 · 吸血狂暴 · 诅咒腐蚀 | Sacrifice · Lifesteal & rage · Curses & blight | 「扭曲」无对应机制 |
| cards.js:39 血祭 | 法力不够时可以用核心生命补:每缺 1 点法力扣 110 生命(核心至少保留 300,冷却 13 秒) | 法力不足时以核心生命补费：每点110生命（核心保底300，冷却13秒） | Short on Mana? Pay 110 Core HP per missing Mana (Core keeps 300; 13s cooldown). | |

### 2.4 强化（`cards.js:233–252` + `i18n.js:244–257` UPGRADE_EN）

| 位置 | 原文（名 / 描述） | 改写（名 / 描述） | 英文改写 | 备注 |
|---|---|---|---|---|
| cards.js:234 up_atk | 攻击强化 / 所有单位 攻击+15% | 攻击强化 / 全体单位攻击+15% | Attack Boost / All units +15% ATK | |
| cards.js:235 up_hp | 装甲强化 / 所有单位 生命+20% | 装甲强化 / 全体单位生命+20% | Armor Boost / All units +20% HP | |
| cards.js:236 up_mana | 能量涌动 / 法力恢复速度 +25% | **法力涌动** / 法力回复+25% | Mana Flow / Mana regen +25% | T1 |
| cards.js:237 up_speed | 快速部署 / 单位移动速度 +15% | **急行军** / 全体单位移速+15% | Forced March / All units +15% speed | **名不副实**：效果是移速，与部署无关 |
| cards.js:238 up_maxmana | 能量扩容 / 法力上限 +2 | **法力扩容** / 法力上限+2 | Mana Capacity / Max Mana +2 | T1 |
| cards.js:239 up_frenzy | 战争狂热 / 攻击间隔 -15% | 战争狂热 / 全体攻击间隔-15% | War Frenzy / Attack interval -15% | 不换算成「攻速+17.6%」，避免改数值 |
| cards.js:240 up_basehp | 基地加固 / 基地回复 200 生命 | **核心加固** / 核心回复200生命 | Fortify Core / Core heals 200 | T2 |
| cards.js:244 up_steel_armor | 老兵防护 / 已升阶的钢铁单位受到伤害 −12% | 老兵防护 / 有军衔的钢铁单位受伤-12% | Veteran Armor / Ranked Steel units take 12% less damage | T9 |
| cards.js:245 up_steel_rank | 战地晋升 / 钢铁单位每 8 秒升一阶 | 战地晋升 / 升衔间隔缩短至8秒 | Field Promotion / Rank up every 8s | T9 |
| cards.js:246 up_swarm_hatch | 快速孵化 / 同化虫茧孵化缩短至 2.25 秒 | 快速孵化 / 虫茧孵化缩短至2.25秒 | Fast Hatch / Cocoons hatch in 2.25s | |
| cards.js:247 up_swarm_shell | 硬壳虫茧 / 同化虫茧生命 +35% | 硬壳虫茧 / 虫茧生命+35% | Hardened Shell / Cocoons +35% HP | |
| cards.js:248 up_mecha_share | 防御网络 / 战术网络分摊伤害提高至 50% | 防御网络 / 网络分摊伤害提至50% | Defense Network / Network damage share 50% | |
| cards.js:249 up_mecha_haste | 突击网络 / 战术网络攻速加成提高至 50% | 突击网络 / 网络攻速加成提至50% | Assault Network / Network attack speed +50% | |
| cards.js:250 up_chaos_price | 血契 / 血祭补费时，每点只消耗 90 核心生命 | 血契 / 血祭每点法力仅耗90核心生命 | Blood Pact / Blood Price: 90 Core HP per Mana | |
| cards.js:251 up_chaos_cooldown | 再祭 / 血祭冷却缩短至 10 秒 | 再祭 / 血祭冷却缩短至10秒 | Second Offering / Blood Price cooldown 10s | |

### 2.5 地图（`js/scenes.js`，仅已开放 3 张）

| 位置 | 原文 | 改写 | 英文改写 | 备注 |
|---|---|---|---|---|
| scenes.js:10 星核荒原 | 外星岩石高原。每隔一阵会有陨星坠落:先亮预警圈,砸中双方单位并眩晕,落点砸出短暂的陨坑(会把地面单位轻轻吸向坑心),坑心留下可拾取的星石(+1 法力)。 | 陨星周期坠落：预警圈亮起后砸中双方并眩晕，陨坑短暂牵引地面单位，坑心留下星石（+1法力）。 | Meteors fall periodically: a warning ring, then an impact that stuns both sides. The crater briefly pulls ground units in and leaves a Star Shard (+1 Mana). | 原 80 字 → 44 字；描述区不受 20 字约束 |
| scenes.js:25 冰封裂谷 | 两侧转线口前后错开，两条冰路斜插过三路，地面单位踏上冰面会减速。 | 两侧转线口错开；两条冰路斜穿三路，地面单位踏冰减速。 | Staggered lane crossings. Two ice paths cut across all lanes and slow ground units. | |
| scenes.js:41 熔岩锻炉 | 一条熔岩河横贯三路，地面单位蹚过会被烧灼;只有星核祭坛能安全通过。 | 熔岩河横贯三路，地面单位涉水会被灼烧；仅星核可安全通过。 | A lava river crosses all three lanes and burns ground units. Only the Starcore is safe. | T3 / T14 |
| 地图名 | 星核荒原 / 冰封裂谷 / 熔岩锻炉 | 不变 | Starcore Plateau / Frozen Rift / Lava Forge 不变 | 已经很好 |
| scenes.js:56,70,84,98,112 | 5 张未开放地图描述 | 本轮不改 | — | 只在开发对比页可见；开放时按同一规则处理 |

### 2.6 界面文本（`js/i18n.js` UI，按功能分组）

行号为中文行；英文行 = 中文行 + 71。

#### 2.6.1 首页 / 标题 / 导航

| 位置 | 键 | 原文 | 改写 | 英文改写 | 备注 |
|---|---|---|---|---|---|
| i18n.js:24 | firstMatchHome | 首次开局会带你完成第一次部署。 | 首局附带出牌教学 | First match includes a quick tutorial. | |
| i18n.js:60 | quickBattle | 快速开局 | 快速开战 | Quick Battle | |
| i18n.js:60 | battleSetup | 对战准备 | 备战 | Battle Setup | 按钮/标题共用 |
| i18n.js:60 | quickConfig | {scene} · {difficulty}人机 · {n} 张牌 | {scene} · {difficulty}人机 · {n}张 | {scene} · {difficulty} AI · {n} cards | |
| i18n.js:61 | pickFaction | 选择你的势力 | 选择势力 | Choose Faction | |
| i18n.js:61 | difficulty | 人机难度 | 难度 | Difficulty | |
| i18n.js:73 | backMenu | 返回菜单 | 返回主页 | Home | `index.html:282,299` 兜底写的是「返回主页」，统一到它 |
| i18n.js:73 | backLobby | 回到大厅 | 联机大厅 | Online Lobby | T18 |
| i18n.js:63 | stats | 战绩 {w} 胜 {l} 负{d} · 胜率 {r}% · 最高连胜 {b} | 战绩 {w}胜{l}负{d} · 胜率{r}% · 最高{b}连胜 | {w}W {l}L{d} · {r}% · Best streak {b} | 和 draws 拼接，见 L4 |
| i18n.js:63 | draws | ␣{d} 平 | {d}平 | ␣{d}D | 改后前面不需要空格 |
| i18n.js:64 | fstat | {w} 胜 {l} 负 · {r}% | {w}胜{l}负 · {r}% | {w}W {l}L · {r}% | |
| i18n.js:64 | deckSummary | {f} · {kind}({n} 张) | {f} · {kind} | {f} · {kind} | 卡组永远 8 张，信息冗余 |
| i18n.js:78 | passive | 招牌机制 | **势力特性** | Faction Trait | ⚠ 拍板点 D6 |
| i18n.js:78 | randomScene | 随机 | 随机战场 | Random | |
| i18n.js:43 | randomFieldHelp | 开战时随机选择一张已开放战场。 | 开战时随机抽取战场 | Arena picked at random. | |

#### 2.6.2 卡组 / 图鉴

| 位置 | 键 | 原文 | 改写 | 英文改写 | 备注 |
|---|---|---|---|---|---|
| i18n.js:36 | filterType | 卡牌类型 | 类型 | Type | |
| i18n.js:36 | allTypes | 全部类型 | 全部 | All | |
| i18n.js:37 | cardHealth / cardAttack | 生命 / 攻击 | 不变 | **HP / ATK**（原 Health / Attack） | T10 T11 |
| i18n.js:37 | cardRadius | 作用半径 | 范围 | Radius | |
| i18n.js:37 | cardLifetime | 持续时间 | 持续 | Duration | |
| i18n.js:38 | gridUnits / seconds | {n} 格 / {n} 秒 | {n}格 / {n}秒 | {n} tiles / {n}s | |
| i18n.js:38 | viewModel | 查看 3D 模型 | 3D 模型 | 3D Model | 链接的 `viewer.html` 仓库里不存在，见 L12 |
| i18n.js:40 | deckErr_size | 卡组需要正好 {n} 张 | 卡组须为{n}张 | Deck needs exactly {n} cards | `cards.js:165` 服务器日志版同步 |
| i18n.js:40 | deckErr_dup | 卡组不能有重复的牌 | 不可携带重复卡牌 | No duplicates | |
| i18n.js:40 | deckErr_faction | {c} 不属于该势力 | {c}不属于本势力 | {c} isn't in this faction | |
| i18n.js:40 | deckErr_deploy | 至少需要 {n} 张单位或建筑 | 至少携带{n}张单位/建筑 | Needs {n}+ units/buildings | |
| i18n.js:44 | deckFull | 卡组已满，先移除一张牌。 | 卡组已满，请先移除 | Deck full. Remove a card. | |
| i18n.js:65 | deckCount | 已选 {n}/{max} · 平均费用 {avg} · 点击卡牌选入/移出 | {n}/{max} · 平均{avg}费 · 点卡增删 | {n}/{max} · Avg {avg} · Tap to add/remove | |
| i18n.js:66 | preset | 推荐卡组 | 推荐 | Preset | 按钮 ≤4 |
| i18n.js:66 | saveBack | 保存并返回 | 保存 | Save | 原 5 字 |

#### 2.6.3 对战 HUD / 出牌提示 / 部署报错

| 位置 | 键 | 原文 | 改写 | 英文改写 | 备注 |
|---|---|---|---|---|---|
| i18n.js:41 | battleCardHelp | 拖动卡牌，或点选卡牌后点战场。 | 拖牌出牌，或点牌再点战场 | Drag a card, or tap it then the arena. | |
| i18n.js:41 | aimBattleCard | 已选「{name}」 · 点战场部署 | 「{name}」· 点战场出牌 | {name} · Tap the arena | T6（法术也走这里） |
| i18n.js:41 | selectBattleCard | 选中{name}，费用 {cost} | {name}，{cost}费 | {name}, cost {cost} | 读屏用 |
| i18n.js:50 | deployOutside | 落点不在战场内 | 超出战场 | Out of bounds | |
| i18n.js:50 | deploySide | 越过己方部署线 | 超出部署区 | Outside your zone | |
| i18n.js:51 | deployOccupied | 与建筑重叠 | 位置被占 | Spot occupied | 重叠对象含塔，不只建筑 |
| i18n.js:52 | coreContested | 星核争夺中 · 回能暂停 | 星核争夺中 · 加速暂停 | Starcore contested · bonus paused | T1 T3 |
| i18n.js:53–54 | coreCaptureBlue / Red, coreBlue / Red | 蓝方占领中 / 红方占领中 / 蓝方控制星核 / 红方控制星核 | 我方占领中 / 敌方占领中 / 我方控制星核 / 敌方控制星核 | Capturing / Enemy capturing / You hold the Starcore / Enemy holds the Starcore | `'p'` 永远是本地玩家，蓝红是颜色不是身份。⚠ 拍板点 D4 |
| i18n.js:52 | coreNeutral | 星核未占领 | 不变 | Starcore unclaimed | |
| i18n.js:71 | myBase | 我方核心 | 不变 | Your Core | `index.html:420` 兜底改成同字 |
| i18n.js:71 | quit | 退出对局 | 不变 | Leave | |
| i18n.js:76 | vs | {a} VS {b} · 对手:{op} | {a} VS {b} · {op} | {a} VS {b} · {op} | |
| i18n.js:76 | nextCard | 下一张:{c} | 下张：{c} | Next: {c} | |
| i18n.js:76 | upgradesComplete | 强化已完成 | 强化已满 | Upgrades maxed | |
| i18n.js:76 | toUpgrade | 强化还需 {n} 张牌(双方合计) | 再出{n}张牌强化（双方合计） | Upgrade in {n} plays (both) | |
| i18n.js:76 | riftSlowHere | 地面减速 {n}% | 减速{n}% | Slow {n}% | |
| i18n.js:76 | riftSlowAhead | 可能经过减速区 −{n}% | 途经减速区 −{n}% | Route slowed −{n}% | |
| i18n.js:76 | lavaBurnAhead | 途经熔岩 · 烧灼 {n}/秒 | 途经熔岩 · 每秒灼烧{n} | Crosses lava · burn {n}/s | T14 |
| i18n.js:76 | lavaZone | 熔岩 · 会烧灼 | 熔岩 · 灼烧 | Lava · burns | |
| i18n.js:76 | iceSlowAhead | 途经冰面 · 减速 {n}% | 途经冰面 · 减速{n}% | Crosses ice · slow {n}% | |
| i18n.js:76 | manaGain | +{n} 法力 | +{n}法力 | +{n} Mana | |
| i18n.js:77 | surgeTag | 能量涌潮 ×2 | 法力涌潮×2 | Mana Surge ×2 | T1 |
| i18n.js:77 | otTag | 加时赛 · 先拆塔者胜 | 加时 · 先拆塔者胜 | OT · First tower wins | |
| i18n.js:78 | bloodTip | 法力不足:血祭 {n} 核心生命 | 血祭：消耗{n}核心生命 | Blood Price: {n} Core HP | |
| i18n.js:78 | tBlood | 血祭:核心 -{n} | 血祭 · 核心-{n} | Blood Price · Core -{n} | |
| i18n.js:86 | discardTip | 弃置换牌({n} 法力) | 弃牌换新（{n}法力） | Discard & redraw ({n} Mana) | |
| i18n.js:92 | trash | 弃牌 -1法力 | 弃牌 -1 | Discard -1 | **硬编码 1**，应改成 `{n}` 传 `DISCARD_COST`（L7） |
| i18n.js:87 | ot / surge | 加时赛 / 涌潮×2 | 加时 / 涌潮×2 | OT / Surge×2 | |

#### 2.6.4 Toast（目标 ≤12 字）

| 位置 | 键 | 原文 | 改写 | 英文改写 | 备注 |
|---|---|---|---|---|---|
| i18n.js:48 | tPrep | 准备中，倒计时结束后才能出牌 | 倒计时结束后可出牌（9） | Wait for the countdown | |
| i18n.js:48 | healNoTarget | 附近没有受伤的单位 | 附近无受伤友军（7） | No injured allies nearby | |
| i18n.js:48 | tGameResumed | 已继续 | 战斗继续（4） | Resumed | |
| i18n.js:48 | tViewReset | 战场位置已复位 | 战场已复位（5） | Arena reset | |
| i18n.js:79 | tSurge | ⚡ 能量涌潮:法力恢复速度 ×2 | 法力涌潮：回复×2（9） | Mana Surge: regen ×2 | emoji 见 D5 |
| i18n.js:79 | tOvertime | ⏱ 加时赛!先摧毁任意一座建筑的一方获胜 | 加时！先拆一塔者胜（9） | Overtime! First tower wins | **原文误导**（T4） |
| i18n.js:80 | tNodeMine | ✦ 占领星核:法力恢复加速 | 星核已占领：回复加速（10） | Starcore taken: faster Mana | |
| i18n.js:80 | tNodeEnemy | ✦ 敌方占领了星核 | 敌方占领星核（6） | Enemy took the Starcore | |
| i18n.js:80 | tNodeLost | 星核被夺走了 | 星核失守（4） | Starcore lost | |
| i18n.js:81 | tTowerEnemy | 摧毁了一座敌方塔! | 击毁敌方防御塔！（8） | Enemy tower down! | |
| i18n.js:81 | tTowerMine | 我方塔被摧毁 | 我方防御塔被毁（7） | Tower lost | |
| i18n.js:81 | tPicks | 你选择了「{a}」,对手获得「{b}」 | 我方「{a}」· 对手「{b}」 | You: {a} · Foe: {b} | |
| i18n.js:82 | tDiscardCost | 弃牌需要 {n} 点法力 | 弃牌需{n}法力（6） | Discard costs {n} Mana | |
| i18n.js:83 | tLeave | 退出联机对局会判负。3 秒内再选一次确认。 | 退出判负，3秒内再点确认（12） | Leaving = loss. Tap again within 3s. | |
| i18n.js:83 | tConnLost | 与服务器的连接已断开 | 与服务器断开（6） | Disconnected | |
| i18n.js:83 | tOpDc | 对手掉线,{s} 秒内未重连判我方胜 | 对手掉线，{s}秒未回判胜（≈11） | Opponent dropped · {s}s to return | |
| i18n.js:83 | tResumed | 已重新连上 | 已重连（3） | Reconnected | |
| i18n.js:84 | tStart | 对局开始!对手:{op}({f}) | 开战！对手 {op} · {f} | Battle! vs {op} · {f} | 昵称变长时超 12，可接受 |
| i18n.js:84 | tNoXR | 此浏览器不支持 WebXR | 浏览器不支持 WebXR | WebXR not supported | |
| i18n.js:84 | tXRFail | 无法进入 XR: {e} | 进入 XR 失败：{e} | XR failed: {e} | |
| i18n.js:91 | tTimeout | 连接服务器超时 | 连接超时（4） | Connection timed out | |
| i18n.js:91 | tCantConnect | 无法连接联机服务器 | 无法连接服务器（7） | Can't reach server | |
| i18n.js:92 | tRecentered | 已重新居中 | 已居中（3） | Recentered | |
| i18n.js:42 | connectionCancelled | 已取消连接。 | 已取消连接（5） | Cancelled | |
| i18n.js:43 | roomCopyManually | 已选中房间码，可手动复制。 | 已选中，请手动复制（9） | Selected — copy manually | |
| i18n.js:44 | battleUnavailable | 无法打开战场，请确认浏览器已启用 WebGL 后重试。 | 战场加载失败，请开启 WebGL 后重试 | Arena failed to load. Enable WebGL and retry. | ⚠超（约19），错误说明可接受 |
| i18n.js:45 | xrBoardChanged | 棋盘尺寸：{size} | 战场尺寸：{size} | Arena size: {size} | T17 |
| i18n.js:59 | xrSoundOn / Off | 音效已开启 / 音效已关闭 | 音效：开 / 音效：关 | Sound on / off | |
| i18n.js:78 | tLoadingField | 正在加载战场… | 战场加载中… | Loading arena… | |

#### 2.6.5 强化 / 结算

| 位置 | 键 | 原文 | 改写 | 英文改写 | 备注 |
|---|---|---|---|---|---|
| i18n.js:72 | upgradeTitle | ⚡ 强 化 阶 段 | 强化阶段 | UPGRADE | 去 emoji 与空格字距 |
| i18n.js:72 | upgradeSub | 选择一项强化(对手也会同时获得强化) | 三选一 · 对手同步强化 | Pick 1 of 3 · Opponent upgrades too | |
| i18n.js:72 | upgradeWait | 已选择,等待对手… | 等待对手选择… | Waiting for opponent… | |
| i18n.js:29 | upgradeTimeout | 超时将自动选择 | 超时自动选择 | Auto-picks on timeout | |
| i18n.js:29 | upgradeRemaining | 剩余 {n} 秒 | {n}秒 | {n}s | |
| i18n.js:74 | win / lose / draw | 🏆 胜利! / 💀 战败 / 🤝 平局 | 胜利 / 失败 / 平局 | Victory / Defeat / Draw | 已有 `#end-badge` 徽章图，emoji 重复。D5 |
| i18n.js:75 | endStats | 总战绩 {w} 胜 {l} 负 · 胜率 {r}% | 生涯 {w}胜{l}负 · 胜率{r}% | Career {w}W {l}L · {r}% | |
| i18n.js:75 | streak | ␣· {s} 连胜! | ␣· {s}连胜！ | ␣· {s} win streak! | |
| i18n.js:30 | matchScore | 本局比分 | 比分 | Score | |
| i18n.js:30 | matchCores | 己方 / 敌方核心 | 核心（我/敌） | Cores (You/Foe) | T12 |
| i18n.js:30 | matchTime | 对局用时 | 用时 | Time | |
| i18n.js:31 | reason_coreWon / Lost | 敌方核心被摧毁 / 己方核心被摧毁 | 敌方核心被毁 / 我方核心被毁 | Enemy Core destroyed / Your Core destroyed | |
| i18n.js:88 | reason_base | 摧毁了核心 | 核心被毁 | Core destroyed | |
| i18n.js:88 | reason_crowns | 常规时间结束 · 摧毁的塔更多 | 时间到 · 拆塔数领先 | Time up · More towers | |
| i18n.js:88 | reason_overtime | 加时赛 · 率先摧毁建筑 | 加时 · 率先拆塔 | OT · First tower | T4 |
| i18n.js:89 | reason_hp | 加时赛结束 · 剩余建筑血量更高 | 加时结束 · 防线生命领先 | OT over · Higher tower HP | 比较的是塔+核心总生命比例（`game.js:909`），用「防线」概括 |
| i18n.js:89 | reason_draw | 加时赛结束 · 双方建筑血量相同 | 加时结束 · 防线生命持平 | OT over · Equal HP | |
| i18n.js:89 | reason_forfeit | 对手离开,判定胜负 | 对手退出 | Opponent left | |
| i18n.js:89 | reason_mutual | 双方核心同时被摧毁 | 双方核心同时被毁 | Both Cores fell | |
| i18n.js:87 | xrWin / xrLose / xrDraw | 胜 利 / 战 败 / 平 局 | 胜利 / 失败 / 平局 | VICTORY / DEFEAT / DRAW | 画布字距见 L9 |
| i18n.js:87 | xrAgain | 捏合此面板 再来一局 | 捏合此处 · 再来一局 | Pinch to play again | |
| i18n.js:90 | aiEasy / aiNormal / aiHard | 简单 AI / 普通 AI / 困难 AI | 简单人机 / 普通人机 / 困难人机 | Easy AI / Normal AI / Hard AI | T16 |

#### 2.6.6 联机大厅

| 位置 | 键 | 原文 | 改写 | 英文改写 | 备注 |
|---|---|---|---|---|---|
| i18n.js:67 | onlineTitle | 联 机 对 战 | 联机对战 | ONLINE | 去空格字距 |
| i18n.js:67 | createHint | 创建房间,把房间码告诉对手 | 建房后把房间码发给对手 | Create a room, share the code | |
| i18n.js:68 | waiting | 等待对手加入… | 等待对手… | Waiting for opponent… | |
| i18n.js:68 | joinHint | 输入对手的房间码 | 输入房间码 | Enter room code | |
| i18n.js:68 | leaderboard | 排行榜(Elo) | 排行榜 · Elo | Leaderboard · Elo | |
| i18n.js:69 | noRecords | 还没有对局记录 | 暂无战绩 | No matches yet | |
| i18n.js:69 | noServer | 未连接联机服务器。请用 node server/server.mjs 启动并通过它打开页面 | 未连接服务器（请用 node server/server.mjs 启动） | Offline. Run node server/server.mjs | 开发向文本，只压缩 |
| i18n.js:69 | staticNoOnline | 网页试玩版只支持人机对战;联机对战需要在本地用 node server/server.mjs 启动 | 网页版仅支持人机对战 | Web demo is vs-AI only | 旁边已有「前往联机版」按钮，命令行说明对玩家无用 |
| i18n.js:70 | codeLen | 房间码是 4 位 | 房间码为4位 | Room code is 4 characters | |
| i18n.js:70 | needServer | (需要用 node server/server.mjs 启动) | （需 node server/server.mjs） | (needs node server/server.mjs) | 开发向 |
| i18n.js:34 | roomIdentity | 当前昵称：{name} | 昵称：{name} | Name: {name} | |
| i18n.js:34 | guestPlaceholder | 留空会分配游客名 | 留空则随机命名 | Blank = guest name | |
| i18n.js:43 | copyRoom | 复制房间码 | 复制房号 | Copy Code | 原 5 字 |
| i18n.js:42 | connecting | 正在连接… | 连接中… | Connecting… | |
| i18n.js:78 | netOk / netLag | ● 联机中 / ● 网络卡顿 {ms}ms | ● 已连接 / ● 延迟 {ms}ms | ● Online / ● Lag {ms}ms | |

#### 2.6.7 XR / 设置 / 引导

| 位置 | 键 | 原文 | 改写 | 英文改写 | 备注 |
|---|---|---|---|---|---|
| i18n.js:25 | firstDeployXRText | 捏住亮边卡牌，移到蓝区再松手。用手柄时，按住扳机瞄准蓝区后松开。 | 捏住发光卡牌，移到蓝区松手。手柄：按住扳机瞄准蓝区再松开。 | Pinch the glowing card, move it over blue ground, release. Controller: hold trigger, aim, release. | |
| i18n.js:26 | firstDeployTitle | 先部署一张单位牌 | 部署一个单位 | Deploy a unit | **也被当作部署报错**（`main.js:926`），见 L5 |
| i18n.js:26 | firstDeployText | 选中下方亮边的牌，再点蓝色高亮区域。 | 选中发光卡牌，再点蓝色区域。 | Select the glowing card, then tap the blue zone. | |
| i18n.js:27 | firstWatchTitle | 单位会自动推进 | 单位自动推进 | Units advance on their own | |
| i18n.js:27 | firstWatchText | 出牌后，单位会自己移动和攻击。 | 部署后，单位自动行军、攻击。 | Deployed units move and fight automatically. | |
| i18n.js:28 | firstCoreTitle | 争夺中央星核 | 抢占星核 | Take the Starcore | |
| i18n.js:28 | firstCoreText | 站住中央金圈可以加快回蓝。两侧亮色裂隙会减慢地面单位。 | 占住中央金圈，法力回复加快。发光裂隙会减速地面单位。 | Hold the golden ring for faster Mana. Glowing rifts slow ground units. | 在熔岩图上「裂隙」实为熔岩，教学文本是通用的，暂不分图 |
| i18n.js:24 | firstMatchGo | 开始对局 | 开战 | Start | |
| i18n.js:32 | xrMode | XR 显示模式 | XR 模式 | XR Mode | |
| i18n.js:33 | xrChecking | 正在检查 XR 支持… | 检测 XR 设备… | Checking XR… | |
| i18n.js:33 | xrCompatible | 可进入沉浸式空间大厅 | 支持 XR 空间大厅 | XR Lobby ready | |
| i18n.js:33 | xrUnavailable | 当前设备无法进入沉浸式 XR，可在设置中查看指南。 | 此设备不支持 XR，指南见「设置」 | XR unavailable. See Settings for help. | |
| i18n.js:45 | xrBoardSize | 棋盘尺寸 | 战场尺寸 | Arena Size | T17 |
| i18n.js:47 | xrPausedHint | 张开左手掌心，在手心菜单里点「继续」 | 摊开左掌，点「继续」 | Open left palm, tap Resume | |
| i18n.js:48 | loopError | 出错了，已跳过这一帧：{e} | 帧错误已跳过：{e} | Frame skipped: {e} | |
| i18n.js:48 | xrConfirmLeaveShort | 确认离开？ | 确认退出？ | Leave? | 与「退出对局」同词 |
| i18n.js:48 | xrLeavePenaltyShort | 联机离场判负 | 联机退出判负 | Counts as a loss | |
| i18n.js:48 | xrPalmHint | 张开左手掌心朝向自己 → 菜单（棋盘尺寸在 设置 里） | 左掌朝向自己 → 菜单（尺寸在「设置」） | Turn left palm toward you → Menu | |
| i18n.js:48 | xrErrorTitle | 出错了（已跳过这一帧，画面继续）· 请截图反馈 | 出错已跳过 · 请截图反馈 | Error skipped · Please screenshot | |
| i18n.js:48 | xrViewReset | 视角复位 | 复位战场 | Reset Arena | 实际复位的是战场位置（tViewReset） |
| i18n.js:48 | pausedResume | 已暂停 · 点击继续 | 不变 | Paused · Click to resume | |
| i18n.js:48 | xrHandOpacity | 手模型 | 手部显示 | Hands | |
| i18n.js:55 | xrGuide | XR 操作指南 | XR 操作 | XR Controls | 按钮/对话框标题共用 |
| i18n.js:56 | guideDesc_pinch | 拇指和食指靠近卡牌，捏住后保持手势。 | 拇指、食指在卡牌上捏住并保持。 | Pinch a card with thumb and index, and hold. | |
| i18n.js:57 | guide_release | 松手部署 | 松手出牌 | Release to play | 法术也松手 |
| i18n.js:57 | guideDesc_release | 把牌移到蓝色己方区域的空地，看到有效落点后松手。 | 移到蓝色空地，落点亮起后松手。 | Move over open blue ground; release when the marker lights up. | |
| i18n.js:58 | guideDesc_recenter | 张开左手掌心朝向自己，点手心菜单里的「重新居中」；双手空捏 0.4 秒后拖动可旋转、升降、推拉战场。 | 左掌朝向自己，点菜单「重新居中」。双手捏住0.4秒后拖动，可旋转、升降、推拉战场。 | Turn left palm toward you, tap Recenter. Pinch both hands 0.4s, then drag to rotate, raise or move the arena. | |
| i18n.js:59 | xrLobbyHint | 捏合按钮，或用手柄射线选择 | 捏合或射线选择 | Pinch or point to select | |
| i18n.js:59 | xrArena | 切换战场 | 不变 | Next Arena | |
| i18n.js:85 | tXRHelp | 捏住手牌拖到己方半场任意位置出兵;拖到右侧回收区弃牌;左手掌心菜单里重新居中;双手空捏 0.4 秒拖动调整战场 | 捏牌拖到我方半场出牌 · 拖到右侧回收区弃牌 · 左掌菜单重新居中 · 双手捏住0.4秒拖动战场 | Drag a card to your half to play · Drop on the bin to discard · Recenter from the left palm · Pinch both hands 0.4s to move the arena | 「出兵」→「出牌」（T6） |
| i18n.js:86 | recenter | 左手掌心菜单里重新居中 | 左掌菜单 → 重新居中 | Left palm → Recenter | |

#### 2.6.8 已无人引用的 8 个键（建议删除，不改写）

`xrConfirmLeave`、`xrLeavePrompt`、`xrLeavePenalty`、`xrContinueBattle`（i18n.js:46,49 —— `docs/xr-hands-plan.md:299` 已记录 T3 后失效）、`tBadSpellDrop`（:42）、`tBadDrop`（:82）、`tUnitHalf`（:92）、`nicknamePh`（:67）。全仓 grep 无引用。删除放单独提交。

#### 2.6.9 保持不变的键（已够短够准）

`firstMatchSkip` `xrAuto` `xrImmersiveVR` `xrImmersiveAR` `codex` `codexTitle` `settings` `language` `filterFaction` `unit` `building` `cardRange` `codexEdit` `nextLabel` `docTitle` `loading` `muteTip` `cancelConnection` `roomCopied` `xrBoard_small/standard/large` `xrSound` `xrOn` `xrOff` `xrLeftField` `xrPause` `xrResume` `xrPaused` `prepGo` `xrHand_low/mid/high` `deployWall` `deployRock` `close` `guidePrev` `guideNext` `guideDone` `guide_pinch` `guide_recenter` `xrHome` `xrExit` `xrCenter` `xrFaction` `enterGame` `title` `editDeck` `easy` `normal` `hard` `solo` `online` `presetDeck` `customDeck` `deckTitle` `cancel` `nickname` `create` `join` `goOnline` `back` `enemyBase` `enterXR` `again` `iceZone` `netClosed` `netReconnect` `battlefield` `tOppLeft` `tOpBack` `spell` `pinch` `tNoMana` `mana`。英文侧这些键也不动（仅 `cardHealth/cardAttack` 改 HP/ATK，已列）。

### 2.7 `index.html` 兜底文本

规则：所有 `data-i18n*` 节点的兜底中文 = 落地后 `UI.zh` 的新值（避免首帧闪旧文案）。下面只列**本身就和 i18n 不一致**或**没打键**的：

| 位置 | 原文 | 改写 | 备注 |
|---|---|---|---|
| index.html:282, 299 | 返回主页 | 返回主页 | i18n `backMenu` 改成同值后一致（现在 i18n 是「返回菜单」） |
| index.html:420 | 己方核心 | 我方核心 | 与 `myBase` 不一致 |
| index.html:332 | 选择你的势力（无键） | 选择势力 | JS 会覆盖，兜底跟 `pickFaction` |
| index.html:368 | 卡组构筑（无键） | 不变 | JS 用 `deckTitle` 覆盖 |
| index.html:483 | 再来一局（`#btn-again` 无键） | 不变 | `main.js:1125` 按联机/人机设 `backLobby`/`again` |
| index.html:483 | 返回菜单（`backMenu`） | 返回主页 | |
| index.html:386, 465, 466 | 联 机 对 战 / ⚡ 强 化 阶 段 / 选择一项强化(…) | 跟随 2.6.5/2.6.6 | |
| index.html:303, 330 | 中文 / English / EN | 不变 | 语言名不翻译 |
| 其余 70 个 `data-i18n` 节点 | — | 跟随 2.6 对应键 | |

### 2.8 服务器报错（`server/server.mjs`，未走 i18n）

| 位置 | 原文 | 改写 | 英文改写 | 备注 |
|---|---|---|---|---|
| server.mjs:189 | 服务器模拟出错,本局已终止 | 服务器异常，本局终止 | Server error. Match ended. | |
| server.mjs:281 | '玩家' + 随机数 | 不变 | Player#### | 游客名会被对手看到 |
| server.mjs:301, 303 | 服务器房间已满,请稍后再试 | 服务器已满，请稍后再试 | Server full. Try again later. | |
| server.mjs:305, 316 | 这个昵称已被其他设备使用,请换一个 | 昵称已被占用，请更换 | Name taken. Pick another. | |
| server.mjs:313 | 房间不存在 | 不变 | Room not found | |
| server.mjs:314 | 房间已满 | 不变 | Room full | |
| server.mjs:323 | 无法重连:对局已结束 | 对局已结束，无法重连 | Match over. Can't rejoin. | |
| server.mjs:347 | 等待超时,房间已关闭 | 等待超时，房间已关闭 | Timed out. Room closed. | |

⚠ 英文玩家现在看到的是中文。要显示英文需要改协议（发错误码、客户端 `t()` 翻译），属代码改动，见 L8。

---

## 3. 改名建议（可选，默认不改）

### 3.1 势力名

| 现名 | 建议 | 英文 | 理由 |
|---|---|---|---|
| 虫群同化 | **同化虫群** / 噬星虫群 | Assimilation Swarm（不变）/ Star-Eater Swarm | 「虫群同化」读起来是主谓短语，不像阵营名；其他三个都是名词 |
| 混沌腐化 | **腐化教团** / 混沌军团 | Chaos Blight（不变）/ Blight Cult | 同上 |
| 玛雅智械 | 不变（或「智械神庙」） | Maya Synthetics | 有辨识度，可留 |
| 钢铁联盟 | 不变 | Iron Alliance | |

### 3.2 卡名 / 强化名

| 现名 | 建议 | 英文 | 理由 |
|---|---|---|---|
| 火炮哨站 | **自行火炮** | Mobile Artillery | 它是会走的单位（speed 0.35），「哨站」像建筑；且与塔「前哨炮」撞字 |
| 哨戒炮 | 哨戒机兵 | Sentry Walker | 同样是移动单位，三个「炮」（哨戒炮/前哨炮/防御炮台）太近 |
| 狙击单元 | 狙击机兵 | Sniper Walker | 「单元」生硬 |
| EMP脉冲 | **电磁脉冲** | EMP | EMP 本身就是「电磁脉冲」，现名重复 |
| 全员强化 | **战地动员** | Rally（不变） | 与英文 Rally 对齐，和强化卡「攻击强化」区分 |
| 装甲维修 | 战地维修 | Field Repair（不变） | 与英文对齐 |
| 恶魔构造体 | 恶魔巨像 | Demon Colossus | 5 字→4 字，更像重单位 |
| 灵魂体 | 怨灵 | Wraith（不变） | 与英文对齐 |
| 飞翼虫 | 不变 | **Skywing**（原 Wing Bug） | 英文更像名字 |
| 快速部署（强化） | **急行军** | Forced March | 效果是移速（已在 2.4 标注，建议必改） |
| 再祭（强化） | 不变 | Second Offering | |

### 3.3 卡名长度现状

中文卡名全部 ≤5 字，桌面手牌名字区约 78px/13px ≈ 6 字，安全。英文名 `Assimilation Spores`、`Emergency Shield`、`Alliance Rifleman` 在 108px 卡宽下会换行或溢出，建议落地时实测（L6）。

---

## 4. 落地注意

| # | 注意点 | 位置 | 处理 |
|---|---|---|---|
| L1 | **i18n 键名一律不动**，只改值。键被 `data-i18n` 属性、`t()` 动态拼接（`t(page+'Title')`、`t('reason_'+reason)`、`t('guide_'+id)`、`t(card.type)`）引用 | index.html、main.js:843、xr.js:813,1649,1801 | 改键名会静默回退成显示键名 |
| L2 | **卡面关键词是用中文原文当键的**：`TAG_EN` 以中文为 key；`tagName()` 用正则 `^建筑(\d+)秒$` 解析 | i18n.js:238–270、cards.js:190–211 | 本方案不改中文关键词，只改 3 个英文值；若将来改中文，三处同改（更好的做法是关键词改成 id，单独一次重构） |
| L3 | 卡牌/势力/强化的**中文原文在 cards.js，英文在 i18n.js**，英文缺译时回退中文 | i18n.js:260–271 | 两边同一提交改 |
| L4 | `stats` + `draws` + `streak` 是字符串拼接，前导空格属于格式 | main.js:77–78, 1124 | 改值时保留/去掉空格要一起看 |
| L5 | `firstDeployTitle` 同时是教学标题和「教学期间出了非单位牌」的部署报错 | main.js:926 | 改值要两处都读得通（「部署一个单位」两处都通） |
| L6 | **布局长度**：手牌卡宽 108px、描述 10px 字（约 10 字/行）；≤820px 高屏时描述改成悬浮框 190px；竖屏手机隐藏描述和关键词；HUD 核心标签宽 64px | index.html:93–113, 189–237 | 卡描述 ≤20 字 ≈ 2 行；英文名需实测 |
| L7 | `trash` 把 `-1` 写死在文案里，而 `discardTip` 用 `{n}` | i18n.js:92、xr.js:497、game.js:23 `DISCARD_COST = 1` | 落地时改成 `t('trash', { n: DISCARD_COST })`（1 行代码） |
| L8 | 服务器报错不走 i18n，英文玩家看中文 | server.mjs、main.js 联机错误显示 | 本轮只改中文措辞；要双语需协议改错误码，另立任务 |
| L9 | XR 面板用 canvas `fillText(text, x, y, maxWidth)`：**超宽会横向压扁而不是换行**。`胜 利` 的空格是画布上唯一的字距手段 | xr.js:1751–1761（HUD 两列各 444px）、1798（结算标题） | 文案变短本身缓解压扁；字距可改用 `ctx.letterSpacing`（Quest/Chrome 支持）或保留空格——**这一处默认保留空格** |
| L10 | XR 强化卡描述最多折 2 行（34px 字、宽 ≈452px ≈ 13 中文字/行） | xr.js:1778 | 强化描述 ≤26 字，本方案全部满足 |
| L11 | `index.html` 兜底文本要和新 `UI.zh` 一致，否则首帧闪旧文案 | index.html 全部 data-i18n 节点 | 落地脚本可从 i18n 生成核对 |
| L12 | 图鉴「查看 3D 模型」链接到 `viewer.html`，仓库里没有这个文件（服务器白名单里有） | main.js:268、server.mjs:355 | 与文案无关的旁支发现，只提醒 |
| L13 | 数值一致性：卡描述里的数字全部是手写的，和 `cards.js` 字段没有绑定，也没有测试 | tests/ | 建议落地时加一个小测试：描述里出现的数字必须能在该卡字段里找到（防止以后调平衡忘改文案） |
| L14 | 本方案发现的**文案与机制不符**：护盾兵「替队友吃伤害」、全员强化「所有单位」、加时「任意一座建筑」、强化「快速部署」名不副实 | 见 2.1 / 2.4 / 2.6.4 | 只改文案对齐机制，不改机制 |
| L15 | 建议落地顺序：① 术语 & 标点（纯值替换）→ ② 卡牌/势力/强化 → ③ UI toast/按钮 → ④ 删 8 个死键 → ⑤ `trash` 参数化 → ⑥ 浏览器 + XR 截图核对长度。每步一个提交 | | 按 CLAUDE.md「小步快跑」 |

---

## 5. 需要用户拍板

| # | 问题 | 默认建议 |
|---|---|---|
| D1 | 资源叫 **法力** 还是 **能量**？科幻题材「能量」更贴，但要连英文 Mana→Energy、HUD、图标一起换 | **法力**（改动最小，代码字段同名） |
| D2 | 主基地 / 中央点的命名：「核心 + 星核」（英文 Core + Starcore），还是把主基地改成「主堡」彻底拉开 | **核心 + 星核**，靠永远写全「星核」区分 |
| D3 | 「瘫痪」统一成「眩晕」？ | **是**（同一个状态，英文已是 Stun） |
| D4 | 星核状态用「我方/敌方」还是保留「蓝方/红方」 | **我方/敌方**（与核心、塔的说法一致） |
| D5 | 去掉标题/toast 里的 emoji（🏆💀🤝⚡⏱✦）？结算已有徽章图 | **去掉** |
| D6 | 「招牌机制」改成「势力特性」还是「被动」 | **势力特性**（Faction Trait） |
| D7 | 是否给描述补上现在没写的数值：吞噬 30%、虚空蝠吸血 20%、狂战士移速+30%、寄生每秒6、电弧连锁 60% 伤害 | **补前两个**（已写入表），后三个会让描述超长，放图鉴详情 |
| D8 | 护盾兵描述按机制改成「自带200护盾」，还是保留原意、以后给它做真正的嘲讽/替伤机制 | **改文案**（不动玩法） |
| D9 | 英文关键词 Deathrattle → On Death、Explode → Self-Destruct | **改** |
| D10 | 第 3 节改名清单哪些要采纳（尤其「快速部署→急行军」「EMP脉冲→电磁脉冲」「火炮哨站→自行火炮」） | 「急行军」建议必改，其余看口味 |
| D11 | 服务器报错是否这轮就做双语（需要改协议） | **另立任务** |

---

## 6. 落地记录（2026-11-17）

### 6.1 改动

| 文件 | 改动 | 说明 |
|---|---|---|
| `js/i18n.js` | 363 处取值 | UI 中文 ~150 键、英文 ~140 键；PASSIVE_EN / FACTION_EN / CARD_EN / TAG_EN / UPGRADE_EN 69 处。**键名零改动** |
| `js/cards.js` | 72 处 | 势力 8、卡牌描述 47、强化 15、`validateDeck` 日志文案 2（与 `deckErr_*` 同步） |
| `js/scenes.js` | 6 处 | 已开放 3 张图的中英描述 |
| `index.html` | 28 处 | `data-i18n*` 兜底文本对齐新中文值 + `#stats-line` |
| `js/xr.js` | 2 行 | L7：`t('trash', { n: DISCARD_COST })`，并从 game.js 引入 `DISCARD_COST` |
| `tools/shot.mjs` | 2 行 | 新增 `--lang=zh|en` 选项（写 `sg.lang`），截中英两套图用 |

验证：`npm test` 101/101 通过；截图 `docs/graphics/copy-{lobby,hud,upgrade,end}-{zh,en}.png`（1600×900，`?debug`，本地 8795 端口）。

### 6.2 与方案的偏离

- **强化名**：「快速部署」按「不改名」保留（英文仍 Rapid Deploy），只改描述「全体单位移速+15%」。「能量涌动→法力涌动」「能量扩容→法力扩容」「基地加固→核心加固」属于 T1/T2 术语统一（D1/D2 已批），照改；英文 Energy Flow / Energy Capacity → Mana Flow / Mana Capacity。
- **XR 结算标题**：按 L9 保留空格字距，只把「战 败」改成「失 败」（与网页「失败」一致）。
- **英文补丁**（截图/宽度检查时发现）：`enemyBase` 'Enemy core' → 'Enemy Core'（与 Your Core 大小写一致）；`coreContested` 英文从方案的 'Starcore contested · bonus paused' 缩成 'Contested · bonus paused'——XR 顶栏目标格 `fillText(…, 444)`、30px 粗体，原句估算 ≈540px 会被横向压扁（旧文案本来也超）。
- 第 2.6.9 节里 `enemyBase` 原列为「不变」，实际改了英文大小写。

### 6.3 宽度检查（XR 画布无法截图）

用旧/新文案对比 XR 画布上所有 `fillText` 键的估算宽度（CJK 1em、拉丁 0.55em）。变宽的只有 6 个，全部在预算内：

| 键 | 画布位置 / 预算 | 新文案估算 |
|---|---|---|
| `xrHandOpacity` 手部显示 | 设置按钮，无图标，48px，424px | 192px |
| `xrViewReset` Reset Arena | 设置按钮，有图标，48px，333px | ≈306px（最紧的一处） |
| `myBase` Your Core | 顶栏队伍标签，33px，210px | ≈163px |
| `coreRed` Enemy holds the Starcore | 顶栏目标格，30px，444px | ≈400px |
| `coreCaptureRed` Enemy capturing | 同上 | ≈250px |
| `xrAgain` 捏合此处 · 再来一局 | 结算面板 | 与旧同宽 |

其余 XR 键都变短，压扁只会更少。

### 6.4 截图核对结论

- 中文：大厅、HUD+手牌（选中卡显示描述）、强化三选一、结算均无溢出、截断。强化卡「有军衔的钢铁单位受伤-12%」在 170px 卡宽折成两行（「伤-12%」落第二行），可读，未处理。
- 英文：卡名 Shield Trooper / Alliance Rifleman / Standard Bearer 在手牌里折两行，没截断（方案 3.3 预期之内）；势力描述 'Air squadrons · Hacking · Auto-production' 折行，正常。
- 1600×900 下手牌是紧凑卡，不显示描述；描述在选中后的 `#play-card-detail` 和图鉴里显示。

### 6.5 未做（后续任务）

- **服务器报错双语化**（2.8 / L8 / D11）：本轮服务器文案一条没改，仍是中文、半角标点。
- **8 个无用键**（2.6.8）：只列出，未删除。
- **第 3 节改名清单**：全部未采纳。
- **5 张未开放地图描述**：未改。
- **L13 描述数值一致性测试**：未加。
- **L12 `viewer.html` 缺失**：未处理。
- XR 内实机截图：无头浏览器进不了 XR，以 6.3 的宽度推算代替；首次进眼镜时建议看一眼顶栏和设置按钮。

---

## 7. 英文版审查（2026-11-17）

> 用户原话「修改检测英文版本」。目标：英文像母语游戏文案——准确、地道、统一、简短。
> 规则不变：**只改英文值和必要的 i18n 接线；中文文本、i18n 键名、数值一律不动**。中文键（`TAG_EN` 的中文 key、`^建筑(\d+)秒$` 正则）不动。

### 7.1 英文文案规则（本轮定下，之后新增文案照此写）

| 类别 | 规则 | 例 |
|---|---|---|
| 按钮 / 标题 / 面板名 / 教程步骤标题 | Title Case | Quick Battle、Edit Deck、Play Again、Skip Tutorial、Pinch to Grab |
| 提示 / toast / 状态行 | Sentence case，短语不加句号；两句以上的说明才加句号 | Wait for the countdown；Leaving counts as a loss. Tap again within 3s. |
| `·` 分段 | 每段首字母大写 | Overtime · First tower wins、Contested · Bonus paused |
| 卡牌描述 | 完整句、第三人称现在时、句号结尾 | Deals 45 area damage and stuns for 2.5s. |
| 强化描述 | 数值行，不加句号 | All units +15% ATK |
| 地形标签 | `<地形> · <效果>` | Lava · Burn 6/s、Ice · Slow 15%、Rift · Slow 50% |
| 单复数 | 有 `{n}` 的键可加 `键_one`，`t()` 在 n = 1 时自动取用 | 1 tile / 1.5 tiles；Upgrade in 1 card |
| 秒 / 每秒 / 百分比 | `{n}s`、`{n}/s`、`+15%`，数字与单位不空格 | Lasts 35s、26 corrosion/s |

**术语（英文）**：Mana · Core（主基地）· Starcore（中央点，永远一个词）· Tower（前哨炮 + 侧翼塔，不含 Core）· Building（建筑卡）· **Structures**（= Tower + Core + Building，攻城 / 轨道炮击 / 自爆邪徒统一用它）· Deploy / Cast / Play · Stun · Hack · Rank（钢铁军衔）· Arena（战场，替换残留的 Battlefield）· **XR Lobby**（替换 Spatial lobby，与 Online Lobby 成对）· Overtime（HUD 和结算不再缩写 OT）· Opponent（指人）/ Enemy（指阵营、单位），不再用 Foe。
侧翼塔 / 前哨炮的英文名在游戏里**没有任何地方显示**（`map.js` 的 `name` 只是内部标签），所以没给 Pylon 定英文名；玩家只看到 Tower。

### 7.2 问题清单

共改 155 条英文值（界面 98 键、卡名 15、卡牌描述 30、势力副标题 3、强化 8、关键词 1）+ 1 处代码缺陷；每条按主要原因只计入一类。

| 类 | 条数 | 说明 |
|---|---|---|
| A 漏翻 / 英文模式下出现中文 | 0（客户端） | Grep `js/` + `index.html` 所有中文字面量：客户端玩家可见的都走 `t()`；`index.html` 的中文只是首帧兜底，`applyStaticText()` 会覆盖；无头浏览器逐屏扫可见文字 + `title/placeholder/aria-label`，只剩语言切换按钮「中文」（故意）。**剩下的中文全部来自服务器**，见 7.5 |
| B 语法 / 大小写 / 标点 / 单复数 | 54 | 按钮大小写混用（Edit deck / Create room / Play again…）；`·` 后段首大小写不一；`{n} s` 多空格；单复数：图鉴「Range 1 tiles」、HUD「Upgrade in 1 plays」；卡牌描述祈使句与第三人称混用（Heal / Deals）；逗号连句（Open left palm, tap Resume）；Swarm 作为势力名未大写 |
| C 术语不统一 | 21 | Spatial lobby vs XR Lobby；Battlefield vs Arena；Foe vs Enemy / Opponent；OT vs Overtime；mana vs Mana；Core 被用作形容词（Core swarm melee 与主基地 Core 撞词）；Frontline tank（护盾兵）与 Heavy Tank 撞词；攻城目标写成 buildings and towers（漏了 Core） |
| D 不准确 / 不地道 | 51 | 「Upgrade in 20 plays (both)」；「Rapid Deploy」实际效果是移速（只改英文为 Forced March，中文名不动）；「Turns the strongest enemy」意思不明；「Lightning chains 4 times」没说首个目标；「Leaving = loss」；「Blank = guest name」；「Artillery Post」是会走的单位却叫 Post；「Sniper Unit / Tactical Mech」生硬 |
| E 长度 / 折行 / 压扁 | 29 | 势力副标题折行 2 条（Maya / Chaos，钢铁 235/236px 擦边）；手牌卡名折两行 16 个（13px 粗体、88px 宽）→ 现 3 个；XR 卡名被压扁 9 个（4–40%，Assimilation Spores 最重）→ 0；XR 卡面「Building · Building 35s」重复且压扁 21%；XR 板面标签 `Crosses lava · burn 6/s` / `Crosses ice · slow 15%` 压扁 41–42%（中文同处也超 18–23%）；XR 落点提示 `No injured allies nearby` 超 10%；XR 引导「重新居中」3 行被截；联机昵称占位符被截断；强化卡孤字换行（8s / -15% / 10s / damage） |
| F 代码层英文缺陷 | 1 | **XR 画布 `wrapText` 逐字符折行**：英文单词会被从中间截断（教程、强化描述、卡牌详情、引导都受影响）。改成中文逐字、英文按词折行（`js/xr.js`） |

数值：69 条英文描述（47 张卡 + 4 势力特性 + 15 强化 + 3 地图）用脚本逐条比对中文原文的数字集合（中文上一轮已对过 `cards.js` / `game.js`）：**无不一致**。6 处脚本报差异均为表述等价：「1 只 / 一架」写成 a / an（4 处），狂战士「半血 / ×2」写成 Below 50% HP / double（`game.js:852` 阈值 0.5、攻速 ×0.5 间隔）。

### 7.3 改动表（原英文 → 新英文）

#### 界面（`UI.en`，98 键）

| 键 | 原英文 | 新英文 |
|---|---|---|
| `firstMatchHome` | First match includes a quick tutorial. | Your first match includes a quick tutorial. |
| `firstMatchSkip` | Skip guide | Skip Tutorial |
| `firstDeployXRText` | Pinch the glowing card, move it over blue ground, release. Controller: hold trigger, aim, release. | Pinch the glowing card and release it over the blue zone. Controller: hold the trigger, aim, release. |
| `firstDeployTitle` | Deploy a unit | Deploy a Unit |
| `firstWatchTitle` | Units advance on their own | Units Fight on Their Own |
| `firstWatchText` | Deployed units move and fight automatically. | Deployed units march and attack automatically. |
| `firstCoreText` | Hold the golden ring for faster Mana. Glowing rifts slow ground units. | Hold the golden ring to regen Mana faster. Glowing rifts slow ground units. |
| `upgradeTimeout` | Auto-picks on timeout | Auto-picks when time's up |
| `matchCores` | Cores (You/Foe) | Cores (You / Enemy) |
| `xrAuto` | Automatic | Auto |
| `xrCompatible` | XR Lobby ready | XR Lobby available |
| `xrUnavailable` | XR unavailable. See Settings for help. | XR not available on this device. See Settings. |
| `roomIdentity` | Name: {name} | Playing as {name} |
| `guestPlaceholder` | Blank = guest name | Guest if blank |
| `gridUnits_one` | （新增，n=1 时用） | {n} tile |
| `seconds` | {n} s | {n}s |
| `codexEdit` | Edit {f} deck | Edit {f} Deck |
| `muteTip` | Sound on/off | Toggle sound |
| `deckErr_size` | Deck needs exactly {n} cards | A deck needs exactly {n} cards |
| `deckErr_dup` | No duplicates | No duplicate cards |
| `deckErr_deploy` | Needs {n}+ units/buildings | Include at least {n} units or buildings |
| `battleCardHelp` | Drag a card, or tap it then the arena. | Drag a card to play, or tap it, then tap the arena |
| `selectBattleCard` | Select {name}, cost {cost} | {name}, {cost} Mana |
| `cancelConnection` | Cancel connection | Cancel |
| `connectionCancelled` | Cancelled | Connection cancelled |
| `roomCopyManually` | Selected — copy manually | Code selected. Copy it manually. |
| `randomFieldHelp` | Arena picked at random. | A random arena each battle. |
| `deckFull` | Deck full. Remove a card. | Deck is full. Remove a card first. |
| `battleUnavailable` | Couldn't load the arena. Enable WebGL and retry. | Couldn't load the arena. Enable WebGL and try again. |
| `xrLeftField` | Returned to the spatial lobby | Back in the XR Lobby |
| `xrPausedHint` | Open left palm, tap Resume | Open your left palm and tap Resume |
| `xrPalmHint` | Turn left palm toward you → Menu | Look at left palm → Menu |
| `healNoTarget` | No injured allies nearby | No injured allies here |
| `xrErrorTitle` | Error skipped · Please screenshot | Error skipped · Please send a screenshot |
| `pausedResume` | Paused · click to resume | Paused · Click to resume |
| `deployOccupied` | Spot occupied | Spot taken |
| `coreContested` | Contested · bonus paused | Contested · Bonus paused |
| `coreCaptureBlue` | Capturing | Capturing Starcore |
| `coreCaptureRed` | Enemy capturing | Enemy capturing Starcore |
| `guidePrev` | Previous | Back |
| `guide_pinch` | Pinch to pick | Pinch to Grab |
| `guideDesc_pinch` | Pinch a card with thumb and index, and hold. | Pinch a card with your thumb and index finger, and hold. |
| `guide_release` | Release to play | Release to Play |
| `guideDesc_release` | Move over open blue ground; release when the marker lights up. | Move it over open blue ground. Release when the marker lights up. |
| `guideDesc_recenter` | Turn left palm toward you, tap Recenter. Pinch both hands 0.4s, then drag to rotate, raise or move the arena. | Left palm → Recenter. Pinch both hands for 0.4s, then drag to rotate, lift or move the arena. |
| `xrHome` | Spatial lobby | XR Lobby |
| `xrFaction` | Next faction | Next Faction |
| `xrSoundOn` | Sound on | Sound On |
| `xrSoundOff` | Sound off | Sound Off |
| `enterGame` | Enter game | Enter Game |
| `pickFaction` | Choose Faction | Choose Your Faction |
| `editDeck` | Edit deck | Edit Deck |
| `stats` | {w}W {l}L{d} · {r}% · Best streak {b} | {w}W {l}L{d} · Win rate {r}% · Best streak {b} |
| `presetDeck` | Recommended deck | Preset Deck |
| `customDeck` | Custom deck | Custom Deck |
| `deckTitle` | {f} · Deck builder | {f} · Deck Builder |
| `deckCount` | {n}/{max} · Avg {avg} · Tap to add/remove | {n}/{max} · Avg cost {avg} · Tap cards to add or remove |
| `preset` | Preset | Load Preset |
| `createHint` | Create a room, share the code | Create a room and share the code |
| `create` | Create room | Create Room |
| `joinHint` | Enter room code | Enter a room code |
| `noServer` | Offline. Run node server/server.mjs | Can't reach the server (run node server/server.mjs) |
| `staticNoOnline` | Web demo is vs-AI only | The web demo is vs AI only |
| `goOnline` | Open the online version | Open Online Version |
| `codeLen` | Room code is 4 characters | Room codes are 4 characters |
| `needServer` |  (needs node server/server.mjs) |  (start it with node server/server.mjs) |
| `upgradeSub` | Pick 1 of 3 · Opponent upgrades too | Pick 1 of 3 · Your opponent picks too |
| `again` | Play again | Play Again |
| `streak` |  · {s} win streak! |  · {s}-win streak! |
| `riftSlowAhead` | Route slowed −{n}% | Rift · Slow {n}% |
| `lavaBurnAhead` | Crosses lava · burn {n}/s | Lava · Burn {n}/s |
| `lavaZone` | Lava · burns | Lava · Burns |
| `iceZone` | Ice · slows | Ice · Slows |
| `iceSlowAhead` | Crosses ice · slow {n}% | Ice · Slow {n}% |
| `toUpgrade` | Upgrade in {n} plays (both) | Upgrade in {n} cards (both sides) |
| `toUpgrade_one` | （新增，n=1 时用） | Upgrade in {n} card (both sides) |
| `otTag` | OT · First tower wins | Overtime · First tower wins |
| `battlefield` | Battlefield | Arena |
| `tSurge` | Mana Surge: regen ×2 | Mana Surge! Regen ×2 |
| `tNodeMine` | Starcore taken: faster Mana | Starcore taken · Faster Mana |
| `tNodeEnemy` | Enemy took the Starcore | Enemy captured the Starcore |
| `tPicks` | You: {a} · Foe: {b} | You: {a} · Opponent: {b} |
| `tDiscardCost` | Discard costs {n} Mana | Discarding costs {n} Mana |
| `tLeave` | Leaving = loss. Tap again within 3s. | Leaving counts as a loss. Tap again within 3s. |
| `tConnLost` | Disconnected | Disconnected from server |
| `tOpDc` | Opponent dropped · {s}s to return | Opponent disconnected · {s}s to return |
| `tStart` | Battle! vs {op} · {f} | Fight! vs {op} · {f} |
| `tNoXR` | WebXR not supported | This browser doesn't support WebXR |
| `tXRFail` | XR failed: {e} | Couldn't enter XR: {e} |
| `tXRHelp` | Drag a card to your half to play · Drop on the bin to discard · Recenter from the left palm · Pinch both hands 0.4s to move the arena | Drag a card to your half to play · Drop it on the bin to discard · Recenter from your left palm · Pinch with both hands for 0.4s to move the arena |
| `pinch` | Pinch to pick | Pinch to choose |
| `reason_crowns` | Time up · More towers | Time's up · More towers destroyed |
| `reason_overtime` | OT · First tower | Overtime · First tower destroyed |
| `reason_hp` | OT over · Higher tower HP | Overtime over · More defense HP left |
| `reason_draw` | OT over · Equal HP | Overtime over · Defense HP tied |
| `reason_mutual` | Both Cores fell | Both Cores destroyed |
| `tCantConnect` | Can't reach server | Can't reach the server |
| `tNoMana` | Not enough mana | Not enough Mana |

#### 卡牌（`CARD_EN`，名 15 改 / 描述 30 改）

不能缩短、在 88px 手牌里仍折两行（按词折，不截断）的：**Drone Swarm、Drone Factory、Brood Mother**——都是两词通用名，缩成一词会丢信息。

| 中文名 | 英文名 | 英文描述 |
|---|---|---|
| 联盟步兵 | Alliance Rifleman → **Rifleman** | Frontline rifleman. Hits air. → Standard infantry. Hits air. |
| 重装坦克 | Heavy Tank | Heavy armor, slow advance. → Heavy armor. Slow to advance. |
| 火炮哨站 | Artillery Post → **Artillery** | （不变） |
| 护盾兵 | Shield Trooper → **Shieldbearer** | Starts with a 200 shield. Frontline tank. → Starts with a 200 shield. Holds the front line. |
| 军旗手 | Standard Bearer → **Bannerman** | Aura: nearby allies +40% ATK, +20% speed. → Aura: nearby allies get +40% ATK and +20% speed. |
| 攻城战车 | Siege Engine | Targets buildings and towers only. → Only attacks structures. Built to break towers. |
| 防御炮台 | Defense Turret → **Gun Turret** | Defensive turret. Hits air. → Stationary defense. Hits air. |
| 装甲维修 | Field Repair | Heal allies in area for 150. → Heals allies in the area for 150. |
| 轨道炮击 | Orbital Strike | After 1.2s: 200 area damage (40% to structures). → After 1.2s, deals 200 area damage (40% to structures). |
| 紧急护盾 | Emergency Shield → **Barrier** | Allies in area gain a 150 shield. → Gives allies in the area a 150 shield. |
| 战术机甲 | Tactical Mech → **Battle Mech** | Balanced main battle mech. → Balanced main battle unit. |
| 狙击单元 | Sniper Unit → **Sniper** | Extreme range, heavy single shots. → Extreme range. Heavy single shots. |
| 无人机工厂 | Drone Factory | Builds a Scout Drone every 9s. → Produces a Scout Drone every 9s. |
| EMP脉冲 | EMP Pulse | 45 area damage, stun 2.5s. → Deals 45 area damage and stuns for 2.5s. |
| 黑客入侵 | Hack | Turns the strongest enemy in area for 3s. → The strongest enemy in the area fights for you for 3s. |
| 连锁闪电 | Chain Lightning → **Chain Bolt** | Lightning chains 4 times, 110 each. → Hits an enemy, then chains to 4 more. 110 damage each. |
| 无人机空投 | Drone Airdrop → **Airdrop** | （不变） |
| 战斗虫 | Warrior Bug | Core swarm melee. → Main Swarm melee fighter. |
| 吞噬者 | Devourer | On kill: heal 30% of the victim's max HP. → On kill: heals 30% of the victim's max HP. |
| 孵化母虫 | Brood Mother | On death: 4 Larvae. → On death: hatches 4 Larvae. |
| 同化孢子 | Assimilation Spores → **Assimilate** | Permanently convert an enemy (cost ≤4), lowest HP first. → Permanently converts an enemy costing 4 or less, lowest HP first. |
| 基因拟态 | Gene Mimicry → **Mimicry** | Copy the costliest enemy in area (cost ≤5) at 70% HP. → Copies the costliest enemy in the area (cost 5 or less) at 70% HP. |
| 寄生 | Parasite | Poison enemies in area for 8s; any that die become 2 Larvae. → Poisons enemies in the area for 8s. Each one that dies becomes 2 Larvae. |
| 幼虫 | Larva | Hatched swarm spawn. → Hatched Swarm spawn. |
| 扭曲战士 | Twisted Warrior → **Twisted One** | （不变） |
| 灵魂体 | Wraith | Ethereal: 30% dodge. → Ethereal: 30% chance to dodge attacks. |
| 恶魔构造体 | Demon Construct → **Colossus** | （不变） |
| 狂战士 | Berserker | Below 50% HP: attack speed ×2. → Below 50% HP: double attack speed. |
| 虚空蝠 | Void Bats | 2 flying bats, 20% lifesteal. → 2 flying bats with 20% lifesteal. |
| 腐化方尖碑 | Blight Obelisk → **Obelisk** | 26 corrosion/s within 2.2 tiles, incl. air. → Deals 26 corrosion/s to enemies within 2.2 tiles, air included. |
| 腐化之雨 | Blight Rain | 22 corrosion/s in area for 4s. → Deals 22 corrosion/s in the area for 4s. |
| 灵魂抽取 | Soul Drain | Deal 125 to the strongest enemy; heal your Core 125. → Deals 125 damage to the strongest enemy and heals your Core for 125. |
| 献祭 | Sacrifice | Detonate allies in area for 120% of their remaining HP. → Detonates allies in the area for 120% of their remaining HP. |
| 诅咒 | Curse | Enemies in area take +60% damage for 7s. → Enemies in the area take 60% more damage for 7s. |

#### 势力副标题（`FACTION_EN`，12px 字、236px 宽内一行）

| 位置 | 原英文 | 新英文 |
|---|---|---|
| 钢铁联盟 副标题 | Veterancy · Shields & auras · Steady push | Veteran ranks · Shields · Auras |
| 玛雅智械 副标题 | Air squadrons · Hacking · Auto-production | Air power · Hacking · Factories |
| 混沌腐化 副标题 | Sacrifice · Lifesteal & rage · Curses & blight | Sacrifice · Lifesteal · Curses |

#### 强化（`UPGRADE_EN`）

| 中文名 | 原 名 / 描述 | 新 名 / 描述 |
|---|---|---|
| 快速部署 | Rapid Deploy / All units +15% speed | Forced March / All units +15% speed |
| 战争狂热 | War Frenzy / Attack interval -15% | War Frenzy / All attack intervals -15% |
| 核心加固 | Fortify Core / Core heals 200 | Fortify Core / Restores 200 Core HP |
| 战地晋升 | Field Promotion / Rank up every 8s | Field Promotion / Units rank up every 8s |
| 防御网络 | Defense Network / Network damage share 50% | Defense Network / Network: shared damage 50% |
| 突击网络 | Assault Network / Network attack speed +50% | Assault Network / Network: attack speed +50% |
| 血契 | Blood Pact / Blood Price: 90 Core HP per Mana | Blood Pact / Blood Price costs 90 Core HP per Mana |
| 再祭 | Second Offering / Blood Price cooldown 10s | Second Offering / Blood Price every 10s |

#### 卡面关键词

| 中文 | 原英文 | 新英文 |
|---|---|---|
| 建筑N秒 | Building 35s | Lasts 35s |

#### 代码接线（2 处）

| 文件 | 改动 |
|---|---|
| `js/i18n.js` `t()` | 支持 `键_one`：`vars.n === 1` 且当前语言有该键时取单数形式。新增 `gridUnits_one`、`toUpgrade_one` 两个英文键（中文不需要） |
| `js/i18n.js` `tagName()` | 「建筑N秒」英文 `Building Ns` → `Lasts Ns`（卡面类型行已有 Building，原来显示成 Building · Building 35s） |
| `js/xr.js` `wrapText()` | 英文按词折行，中文仍逐字；行尾空格去掉 |

### 7.4 验证

- `npm test`：101/101 通过。
- **XR 画布宽度**（截不到图，用无头 Chrome 的 canvas `measureText` 按实际字体实测 347 条：XR 卡名、卡面类型行、卡牌详情两行、HUD 队伍 / 目标格 / 提示条、落点提示、板面标签、大厅 / 设置 / 引导 / 教程按钮、强化卡、结算、暂停、手心菜单）：

  | | 修改前英文 | 修改后英文 | 中文（对照） |
  |---|---|---|---|
  | 超宽被压扁 / 超行截断 | 25 | 12 | 5 |

  剩余 12 条：XR 卡面类型行 `Building · Lasts 30s` 等 5 条压 4–5%、`Unit · Unstoppable` 压 4%（肉眼难辨）；HUD 目标格 `Upgrade in 20 cards (both sides)` 压 6%（选了通顺优先，见 7.5）；其余 5 条只在**联机且网络状态行同时显示**、提示条被一分为二（每格 439px）时才会压扁，中文同样超（tPicks / tStart 中文也是 1.5–1.7 倍）。其中 `tLeave`（1.17→1.50）、`tOpDc`（1.17→1.33）因改得更完整而变长，单格（896px）时都放得下；`tLeave` 只由桌面「Leave」按钮触发，XR 里走手心菜单的两段确认，基本不会出现在 XR 提示条。
- **截图**（1600×900，`?debug`，本地 8796 端口，语言 en）：`docs/graphics/en-{home,lobby,codex,deck,settings,online,hud,upgrade,end}.png`。逐张看过：无中文残留（只有语言切换按钮「中文」），势力副标题一行，手牌 5 张卡名一行，强化卡无孤字换行，联机昵称占位符完整显示。

### 7.5 未做 / 遗留

- **服务器文案仍只有中文**（协议没改）：英文玩家会直接看到——`server.mjs:189` 服务器模拟出错,本局已终止；`:301/:303` 服务器房间已满,请稍后再试；`:305/:316` 这个昵称已被其他设备使用,请换一个；`:313` 房间不存在；`:314` 房间已满；`:323` 无法重连:对局已结束；`:347` 等待超时,房间已关闭；`:281` 游客名「玩家123」（对手名、`Playing as …`、开局 toast 都会显示）。这些错误显示在联机大厅 `#online-err`（`main.js:444`）。要双语需服务器改发错误码，另立任务。
- **英文名与中文名不再逐字对应**：15 个英文卡名（Chain Bolt、Bannerman、Colossus…）和强化名 Forced March为了一行放下或名实相符做了调整，中文名未动。如需中英一致，下一轮改中文名（见第 3 节）。
- `toUpgrade` 在 XR 顶栏压 6%：更短的说法（Upgrade: 20 cards…）读起来像标签，保留通顺版本。
- 首页「XR Lobby」按钮与旁边的「XR Lobby available」重复一个词，可读，未处理。
- 卡组页最后一行卡被底栏挡住一半（布局问题，与文案无关）。
- 已无人引用的 10 个键（2.6.8 的 8 个 + `ot` / `surge`）英文值未改。
- 截图只覆盖 1600×900；矮屏 / 竖屏手机布局未逐一截图。

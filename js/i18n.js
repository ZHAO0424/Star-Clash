// 本地化 — 中文(默认)/ English
//   t(key, vars)      界面文字
//   cardName(card) / cardDesc(card) / factionName(id) / factionDesc(id) / tagName(zh) / upgradeText(up)
// 卡牌与势力的中文原文在 cards.js;这里只放英文译文,缺译时回退中文
let lang = 'zh';
try { lang = localStorage.getItem('sg.lang') || (navigator.language?.startsWith('zh') ? 'zh' : 'en'); } catch { /* */ }

export const getLang = () => lang;
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'zh';
  try { localStorage.setItem('sg.lang', lang); } catch { /* */ }
  applyStaticText();
}

export function coreStatus(node) {
  if (node.contested) return t('coreContested');
  if (node.capturing) return t(node.capturing === 'p' ? 'coreCaptureBlue' : 'coreCaptureRed');
  if (node.owner) return t(node.owner === 'p' ? 'coreBlue' : 'coreRed');
  return t('coreNeutral');
}

const UI = {
  zh: {
    firstMatchHome: '首局附带出牌教学', firstMatchSkip: '跳过引导', firstMatchGo: '开战',
    firstDeployXRText: '捏住发光卡牌，移到蓝区松手。手柄：按住扳机瞄准蓝区再松开。',
    firstDeployTitle: '部署一个单位', firstDeployText: '选中发光卡牌，再点蓝色区域。',
    firstWatchTitle: '单位自动推进', firstWatchText: '部署后，单位自动行军、攻击。',
    firstCoreTitle: '抢占星核', firstCoreText: '占住中央金圈，法力回复加快。发光裂隙会减速地面单位。',
    upgradeTimeout: '超时自动选择', upgradeRemaining: '{n}秒',
    matchScore: '比分', matchCores: '核心（我/敌）', matchTime: '用时',
    reason_coreWon: '敌方核心被毁', reason_coreLost: '我方核心被毁',
    xrMode: 'XR 模式', xrAuto: '自动', xrImmersiveVR: '沉浸式 VR', xrImmersiveAR: '透视 AR',
    xrChecking: '检测 XR 设备…', xrCompatible: '支持 XR 空间大厅', xrUnavailable: '此设备不支持 XR，指南见「设置」',
    roomIdentity: '昵称：{name}', guestPlaceholder: '留空则随机命名',
    codex: '图鉴', codexTitle: '卡牌图鉴', settings: '设置', language: '语言',
    filterFaction: '势力', filterType: '类型', allTypes: '全部', unit: '单位', building: '建筑',
    cardHealth: '生命', cardAttack: '攻击', cardRange: '射程', cardRadius: '范围', cardLifetime: '持续',
    gridUnits: '{n}格', seconds: '{n}秒', viewModel: '3D 模型', codexEdit: '编辑{f}卡组', nextLabel: '下一张',
    docTitle: '星轨对决', loading: '加载中…', muteTip: '音效开关',
    deckErr_size: '卡组须为{n}张', deckErr_dup: '不可携带重复卡牌', deckErr_faction: '{c}不属于本势力', deckErr_deploy: '至少携带{n}张单位/建筑',
    battleCardHelp: '拖牌出牌，或点牌再点战场', aimBattleCard: '「{name}」· 点战场出牌', selectBattleCard: '{name}，{cost}费',
    connecting: '连接中…', cancelConnection: '取消连接', connectionCancelled: '已取消连接', tBadSpellDrop: '这个位置无法施放该法术。',
    copyRoom: '复制房号', roomCopied: '房间码已复制', roomCopyManually: '已选中，请手动复制', randomFieldHelp: '开战时随机抽取战场',
    deckFull: '卡组已满，请先移除', battleUnavailable: '战场加载失败，请开启 WebGL 后重试',
    xrBoardSize: '战场尺寸', xrBoard_small: '小', xrBoard_standard: '中', xrBoard_large: '大', xrSound: '音效', xrOn: '开', xrOff: '关', xrBoardChanged: '战场尺寸：{size}', xrLeftField: '已返回空间大厅',
    xrConfirmLeave: '确认离场', xrLeavePrompt: '离开当前对局？',
    xrPause: '暂停', xrResume: '继续', xrPaused: '已暂停', xrPausedHint: '摊开左掌，点「继续」',
    tGameResumed: '战斗继续', loopError: '帧错误已跳过：{e}', xrConfirmLeaveShort: '确认退出？', xrLeavePenaltyShort: '联机退出判负', xrPalmHint: '左掌朝向自己 → 菜单（尺寸在「设置」）', healNoTarget: '附近无受伤友军', tPrep: '倒计时结束后可出牌', prepGo: '开战！', xrErrorTitle: '出错已跳过 · 请截图反馈', xrViewReset: '复位战场', tViewReset: '战场已复位', pausedResume: '已暂停 · 点击继续', xrHandOpacity: '手部显示', xrHand_low: '淡', xrHand_mid: '中', xrHand_high: '浓',
    xrLeavePenalty: '联机离场将判负', xrContinueBattle: '继续对局',
    deployOutside: '超出战场', deploySide: '超出部署区', deployWall: '岩脊阻挡',
    deployRock: '岩石阻挡', deployOccupied: '位置被占',
    coreNeutral: '星核未占领', coreContested: '星核争夺中 · 加速暂停',
    coreCaptureBlue: '我方占领中', coreCaptureRed: '敌方占领中',
    coreBlue: '我方控制星核', coreRed: '敌方控制星核',
    xrGuide: 'XR 操作', close: '关闭', guidePrev: '上一步', guideNext: '下一步', guideDone: '完成',
    guide_pinch: '捏合取牌', guideDesc_pinch: '拇指、食指在卡牌上捏住并保持。',
    guide_release: '松手出牌', guideDesc_release: '移到蓝色空地，落点亮起后松手。',
    guide_recenter: '重新居中', guideDesc_recenter: '左掌朝向自己，点菜单「重新居中」。双手捏住0.4秒后拖动，可旋转、升降、推拉战场。',
    xrHome: '空间大厅', xrExit: '退出 XR', xrCenter: '重新居中', xrLobbyHint: '捏合或射线选择', xrFaction: '切换势力', xrArena: '切换战场', xrSoundOn: '音效：开', xrSoundOff: '音效：关',
    enterGame: '进入游戏', quickBattle: '快速开战', battleSetup: '备战', quickConfig: '{scene} · {difficulty}人机 · {n}张',
    title: '星轨对决', pickFaction: '选择势力', editDeck: '编辑卡组', difficulty: '难度',
    easy: '简单', normal: '普通', hard: '困难', solo: '人机对战', online: '联机对战',
    stats: '战绩 {w}胜{l}负{d} · 胜率{r}% · 最高{b}连胜', draws: '{d}平',
    fstat: '{w}胜{l}负 · {r}%', deckSummary: '{f} · {kind}', presetDeck: '推荐卡组', customDeck: '自定义卡组',
    deckTitle: '{f} · 卡组构筑', deckCount: '{n}/{max} · 平均{avg}费 · 点卡增删',
    preset: '推荐', saveBack: '保存', cancel: '取消',
    onlineTitle: '联机对战', nickname: '昵称', nicknamePh: '输入昵称', createHint: '建房后把房间码发给对手',
    create: '创建房间', waiting: '等待对手…', joinHint: '输入房间码', join: '加入', leaderboard: '排行榜 · Elo',
    noRecords: '暂无战绩', noServer: '未连接服务器（请用 node server/server.mjs 启动）', staticNoOnline: '网页版仅支持人机对战', goOnline: '前往联机版',
    back: '返回', codeLen: '房间码为4位', needServer: '（需 node server/server.mjs）',
    enemyBase: '敌方核心', myBase: '我方核心', enterXR: '进入 XR', quit: '退出对局',
    upgradeTitle: '强化阶段', upgradeSub: '三选一 · 对手同步强化', upgradeWait: '等待对手选择…',
    again: '再来一局', backMenu: '返回主页', backLobby: '联机大厅',
    win: '胜利', lose: '失败', draw: '平局',
    endStats: '生涯 {w}胜{l}负 · 胜率{r}%', streak: ' · {s}连胜！',
    vs: '{a} VS {b} · {op}', nextCard: '下张：{c}', upgradesComplete: '强化已满', riftSlowHere: '减速{n}%', riftSlowAhead: '途经减速区 −{n}%', lavaBurnAhead: '途经熔岩 · 每秒灼烧{n}', lavaZone: '熔岩 · 灼烧', iceZone: '冰面 · 减速', iceSlowAhead: '途经冰面 · 减速{n}%', manaGain: '+{n}法力', toUpgrade: '再出{n}张牌强化（双方合计）',
    surgeTag: '法力涌潮×2', otTag: '加时 · 先拆塔者胜',
    netOk: '● 已连接', netLag: '● 延迟 {ms}ms', netClosed: '● 已断开', netReconnect: '● 重连中…', passive: '势力特性', battlefield: '战场', randomScene: '随机战场', tLoadingField: '战场加载中…', bloodTip: '血祭：消耗{n}核心生命', tBlood: '血祭 · 核心-{n}',
    tSurge: '法力涌潮：回复×2', tOvertime: '加时！先拆一塔者胜',
    tNodeMine: '星核已占领：回复加速', tNodeEnemy: '敌方占领星核', tNodeLost: '星核失守',
    tTowerEnemy: '击毁敌方防御塔！', tTowerMine: '我方防御塔被毁', tPicks: '我方「{a}」· 对手「{b}」',
    tDiscardCost: '弃牌需{n}法力', tBadDrop: '请在蓝色己方区域内的空地部署，避开障碍物和建筑。',
    tLeave: '退出判负，3秒内再点确认', tOppLeft: '对手已离开', tConnLost: '与服务器断开', tOpDc: '对手掉线，{s}秒未回判胜', tOpBack: '对手已重连', tResumed: '已重连',
    tStart: '开战！对手 {op} · {f}', tNoXR: '浏览器不支持 WebXR', tXRFail: '进入 XR 失败：{e}',
    tXRHelp: '捏牌拖到我方半场出牌 · 拖到右侧回收区弃牌 · 左掌菜单重新居中 · 双手捏住0.4秒拖动战场',
    spell: '法术', discardTip: '弃牌换新（{n}法力）', recenter: '左掌菜单 → 重新居中', pinch: '捏合选择',
    xrWin: '胜 利', xrLose: '失 败', xrDraw: '平 局', xrAgain: '捏合此处 · 再来一局', ot: '加时', surge: '涌潮×2',
    reason_base: '核心被毁', reason_crowns: '时间到 · 拆塔数领先', reason_overtime: '加时 · 率先拆塔',
    reason_hp: '加时结束 · 防线生命领先', reason_draw: '加时结束 · 防线生命持平', reason_forfeit: '对手退出', reason_mutual: '双方核心同时被毁',
    aiEasy: '简单人机', aiNormal: '普通人机', aiHard: '困难人机',
    tTimeout: '连接超时', tCantConnect: '无法连接服务器', tNoMana: '法力不足',
    tUnitHalf: '单位只能部署在己方半场', tRecentered: '已居中', mana: '法力', trash: '弃牌 -{n}',
  },
  en: {
    firstMatchHome: 'First match includes a quick tutorial.', firstMatchSkip: 'Skip guide', firstMatchGo: 'Start',
    firstDeployXRText: 'Pinch the glowing card, move it over blue ground, release. Controller: hold trigger, aim, release.',
    firstDeployTitle: 'Deploy a unit', firstDeployText: 'Select the glowing card, then tap the blue zone.',
    firstWatchTitle: 'Units advance on their own', firstWatchText: 'Deployed units move and fight automatically.',
    firstCoreTitle: 'Take the Starcore', firstCoreText: 'Hold the golden ring for faster Mana. Glowing rifts slow ground units.',
    upgradeTimeout: 'Auto-picks on timeout', upgradeRemaining: '{n}s',
    matchScore: 'Score', matchCores: 'Cores (You/Foe)', matchTime: 'Time',
    reason_coreWon: 'Enemy Core destroyed', reason_coreLost: 'Your Core destroyed',
    xrMode: 'XR Mode', xrAuto: 'Automatic', xrImmersiveVR: 'Immersive VR', xrImmersiveAR: 'Passthrough AR',
    xrChecking: 'Checking XR…', xrCompatible: 'XR Lobby ready', xrUnavailable: 'XR unavailable. See Settings for help.',
    roomIdentity: 'Name: {name}', guestPlaceholder: 'Blank = guest name',
    codex: 'Codex', codexTitle: 'Card Codex', settings: 'Settings', language: 'Language',
    filterFaction: 'Faction', filterType: 'Type', allTypes: 'All', unit: 'Unit', building: 'Building',
    cardHealth: 'HP', cardAttack: 'ATK', cardRange: 'Range', cardRadius: 'Radius', cardLifetime: 'Duration',
    gridUnits: '{n} tiles', seconds: '{n} s', viewModel: '3D Model', codexEdit: 'Edit {f} deck', nextLabel: 'Next',
    docTitle: 'Star Clash', loading: 'Loading…', muteTip: 'Sound on/off',
    deckErr_size: 'Deck needs exactly {n} cards', deckErr_dup: 'No duplicates', deckErr_faction: "{c} isn't in this faction", deckErr_deploy: 'Needs {n}+ units/buildings',
    battleCardHelp: 'Drag a card, or tap it then the arena.', aimBattleCard: '{name} · Tap the arena', selectBattleCard: 'Select {name}, cost {cost}',
    connecting: 'Connecting…', cancelConnection: 'Cancel connection', connectionCancelled: 'Cancelled', tBadSpellDrop: 'This spell cannot be cast at that location.',
    copyRoom: 'Copy Code', roomCopied: 'Room code copied', roomCopyManually: 'Selected — copy manually', randomFieldHelp: 'Arena picked at random.',
    deckFull: 'Deck full. Remove a card.', battleUnavailable: "Couldn't load the arena. Enable WebGL and retry.",
    xrBoardSize: 'Arena Size', xrBoard_small: 'Small', xrBoard_standard: 'Medium', xrBoard_large: 'Large', xrSound: 'Sound', xrOn: 'On', xrOff: 'Off', xrBoardChanged: 'Arena size: {size}', xrLeftField: 'Returned to the spatial lobby',
    xrConfirmLeave: 'Confirm leave', xrLeavePrompt: 'Leave this match?',
    xrPause: 'Pause', xrResume: 'Resume', xrPaused: 'Paused', xrPausedHint: 'Open left palm, tap Resume',
    tGameResumed: 'Resumed', loopError: 'Frame skipped: {e}', xrConfirmLeaveShort: 'Leave?', xrLeavePenaltyShort: 'Counts as a loss', xrPalmHint: 'Turn left palm toward you → Menu', healNoTarget: 'No injured allies nearby', tPrep: 'Wait for the countdown', prepGo: 'Fight!', xrErrorTitle: 'Error skipped · Please screenshot', xrViewReset: 'Reset Arena', tViewReset: 'Arena reset', pausedResume: 'Paused · click to resume', xrHandOpacity: 'Hands', xrHand_low: 'Faint', xrHand_mid: 'Medium', xrHand_high: 'Solid',
    xrLeavePenalty: 'Leaving forfeits the online match', xrContinueBattle: 'Keep playing',
    deployOutside: 'Out of bounds', deploySide: 'Outside your zone', deployWall: 'Blocked by a ridge',
    deployRock: 'Blocked by a rock', deployOccupied: 'Spot occupied',
    coreNeutral: 'Starcore unclaimed', coreContested: 'Contested · bonus paused',
    coreCaptureBlue: 'Capturing', coreCaptureRed: 'Enemy capturing',
    coreBlue: 'You hold the Starcore', coreRed: 'Enemy holds the Starcore',
    xrGuide: 'XR Controls', close: 'Close', guidePrev: 'Previous', guideNext: 'Next', guideDone: 'Done',
    guide_pinch: 'Pinch to pick', guideDesc_pinch: 'Pinch a card with thumb and index, and hold.',
    guide_release: 'Release to play', guideDesc_release: 'Move over open blue ground; release when the marker lights up.',
    guide_recenter: 'Recenter', guideDesc_recenter: 'Turn left palm toward you, tap Recenter. Pinch both hands 0.4s, then drag to rotate, raise or move the arena.',
    xrHome: 'Spatial lobby', xrExit: 'Exit XR', xrCenter: 'Recenter', xrLobbyHint: 'Pinch or point to select', xrFaction: 'Next faction', xrArena: 'Next Arena', xrSoundOn: 'Sound on', xrSoundOff: 'Sound off',
    enterGame: 'Enter game', quickBattle: 'Quick Battle', battleSetup: 'Battle Setup', quickConfig: '{scene} · {difficulty} AI · {n} cards',
    title: 'STAR CLASH', pickFaction: 'Choose Faction', editDeck: 'Edit deck', difficulty: 'Difficulty',
    easy: 'Easy', normal: 'Normal', hard: 'Hard', solo: 'vs AI', online: 'Online',
    stats: '{w}W {l}L{d} · {r}% · Best streak {b}', draws: ' {d}D',
    fstat: '{w}W {l}L · {r}%', deckSummary: '{f} · {kind}', presetDeck: 'Recommended deck', customDeck: 'Custom deck',
    deckTitle: '{f} · Deck builder', deckCount: '{n}/{max} · Avg {avg} · Tap to add/remove',
    preset: 'Preset', saveBack: 'Save', cancel: 'Cancel',
    onlineTitle: 'ONLINE', nickname: 'Name', nicknamePh: 'Your name', createHint: 'Create a room, share the code',
    create: 'Create room', waiting: 'Waiting for opponent…', joinHint: 'Enter room code', join: 'Join', leaderboard: 'Leaderboard · Elo',
    noRecords: 'No matches yet', noServer: 'Offline. Run node server/server.mjs', staticNoOnline: 'Web demo is vs-AI only', goOnline: 'Open the online version',
    back: 'Back', codeLen: 'Room code is 4 characters', needServer: ' (needs node server/server.mjs)',
    enemyBase: 'Enemy Core', myBase: 'Your Core', enterXR: 'Enter XR', quit: 'Leave',
    upgradeTitle: 'UPGRADE', upgradeSub: 'Pick 1 of 3 · Opponent upgrades too', upgradeWait: 'Waiting for opponent…',
    again: 'Play again', backMenu: 'Home', backLobby: 'Online Lobby',
    win: 'Victory', lose: 'Defeat', draw: 'Draw',
    endStats: 'Career {w}W {l}L · {r}%', streak: ' · {s} win streak!',
    vs: '{a} VS {b} · {op}', nextCard: 'Next: {c}', upgradesComplete: 'Upgrades maxed', riftSlowHere: 'Slow {n}%', riftSlowAhead: 'Route slowed −{n}%', lavaBurnAhead: 'Crosses lava · burn {n}/s', lavaZone: 'Lava · burns', iceZone: 'Ice · slows', iceSlowAhead: 'Crosses ice · slow {n}%', manaGain: '+{n} Mana', toUpgrade: 'Upgrade in {n} plays (both)',
    surgeTag: 'Mana Surge ×2', otTag: 'OT · First tower wins',
    netOk: '● Online', netLag: '● Lag {ms}ms', netClosed: '● Disconnected', netReconnect: '● Reconnecting…', passive: 'Faction Trait', battlefield: 'Battlefield', randomScene: 'Random', tLoadingField: 'Loading arena…', bloodTip: 'Blood Price: {n} Core HP', tBlood: 'Blood Price · Core -{n}',
    tSurge: 'Mana Surge: regen ×2', tOvertime: 'Overtime! First tower wins',
    tNodeMine: 'Starcore taken: faster Mana', tNodeEnemy: 'Enemy took the Starcore', tNodeLost: 'Starcore lost',
    tTowerEnemy: 'Enemy tower down!', tTowerMine: 'Tower lost', tPicks: 'You: {a} · Foe: {b}',
    tDiscardCost: 'Discard costs {n} Mana', tBadDrop: 'Deploy on open ground on your blue half, clear of obstacles and structures.',
    tLeave: 'Leaving = loss. Tap again within 3s.', tOppLeft: 'Opponent left', tConnLost: 'Disconnected', tOpDc: 'Opponent dropped · {s}s to return', tOpBack: 'Opponent reconnected', tResumed: 'Reconnected',
    tStart: 'Battle! vs {op} · {f}', tNoXR: 'WebXR not supported', tXRFail: 'XR failed: {e}',
    tXRHelp: 'Drag a card to your half to play · Drop on the bin to discard · Recenter from the left palm · Pinch both hands 0.4s to move the arena',
    spell: 'Spell', discardTip: 'Discard & redraw ({n} Mana)', recenter: 'Left palm → Recenter', pinch: 'Pinch to pick',
    xrWin: 'VICTORY', xrLose: 'DEFEAT', xrDraw: 'DRAW', xrAgain: 'Pinch to play again', ot: 'OT', surge: 'Surge×2',
    reason_base: 'Core destroyed', reason_crowns: 'Time up · More towers', reason_overtime: 'OT · First tower',
    reason_hp: 'OT over · Higher tower HP', reason_draw: 'OT over · Equal HP', reason_forfeit: 'Opponent left', reason_mutual: 'Both Cores fell',
    aiEasy: 'Easy AI', aiNormal: 'Normal AI', aiHard: 'Hard AI',
    tTimeout: 'Connection timed out', tCantConnect: "Can't reach server", tNoMana: 'Not enough mana',
    tUnitHalf: 'Units deploy on your half only', tRecentered: 'Recentered', mana: 'Mana', trash: 'Discard -{n}',
  },
};

export function t(key, vars = {}) {
  const s = UI[lang][key] ?? UI.zh[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// 势力招牌机制(英文)
const PASSIVE_EN = {
  steel: ['Veteran Ranks', 'Units rank up every 10s alive (max 3). +20% HP and ATK per rank.'],
  mecha: ['Tactical Network', 'Nearby units link up: 40% of damage taken is shared, +35% attack speed.'],
  swarm: ['Assimilation', 'Ground enemies slain by the Swarm become cocoons that hatch a Larva in 3s. Cocoons can be destroyed.'],
  chaos: ['Blood Price', 'Short on Mana? Pay 110 Core HP per missing Mana (Core keeps 300; 13s cooldown).'],
};
export const passiveText = (id, p) => (en() && PASSIVE_EN[id] ? { name: PASSIVE_EN[id][0], desc: PASSIVE_EN[id][1] } : p);

const FACTION_EN = {
  steel: ['Iron Alliance', 'Veterancy · Shields & auras · Steady push'],
  mecha: ['Maya Synthetics', 'Air squadrons · Hacking · Auto-production'],
  swarm: ['Assimilation Swarm', 'Hatching · Evolution · Assimilation'],
  chaos: ['Chaos Blight', 'Sacrifice · Lifesteal & rage · Curses & blight'],
};

const CARD_EN = {
  steel_infantry: ['Alliance Rifleman', 'Frontline rifleman. Hits air.'],
  steel_tank: ['Heavy Tank', 'Heavy armor, slow advance.'],
  steel_artillery: ['Artillery Post', 'Long-range splash shelling.'],
  steel_shield: ['Shield Trooper', 'Starts with a 200 shield. Frontline tank.'],
  steel_banner: ['Standard Bearer', 'Aura: nearby allies +40% ATK, +20% speed.'],
  steel_siege: ['Siege Engine', 'Targets buildings and towers only.'],
  steel_turret: ['Defense Turret', 'Defensive turret. Hits air.'],
  steel_buff_atk: ['Rally', 'Allies on the field gain +10 ATK permanently.'],
  steel_repair: ['Field Repair', 'Heal allies in area for 150.'],
  steel_strike: ['Orbital Strike', 'After 1.2s: 200 area damage (40% to structures).'],
  steel_barrier: ['Emergency Shield', 'Allies in area gain a 150 shield.'],
  mecha_drone: ['Scout Drone', 'Fast flying harasser.'],
  mecha_sentry: ['Sentry Gun', 'Slow-moving ranged platform.'],
  mecha_walker: ['Tactical Mech', 'Balanced main battle mech.'],
  mecha_swarmdrone: ['Drone Swarm', 'Deploys 3 flying drones.'],
  mecha_arc: ['Arc Trooper', 'Attacks chain to 3 more enemies.'],
  mecha_sniper: ['Sniper Unit', 'Extreme range, heavy single shots.'],
  mecha_factory: ['Drone Factory', 'Builds a Scout Drone every 9s.'],
  mecha_emp: ['EMP Pulse', '45 area damage, stun 2.5s.'],
  mecha_hack: ['Hack', 'Turns the strongest enemy in area for 3s.'],
  mecha_chain: ['Chain Lightning', 'Lightning chains 4 times, 110 each.'],
  mecha_airdrop: ['Drone Airdrop', 'Drops 2 Scout Drones on your half.'],
  swarm_worker: ['Worker Bug', 'Evolves into a Warrior Bug after 15s.'],
  swarm_warrior: ['Warrior Bug', 'Core swarm melee.'],
  swarm_devourer: ['Devourer', "On kill: heal 30% of the victim's max HP."],
  swarm_brood: ['Larva Brood', 'Hatches 4 Larvae.'],
  swarm_mother: ['Brood Mother', 'On death: 4 Larvae.'],
  swarm_spitter: ['Acid Spitter', 'Ranged acid splash.'],
  swarm_flyer: ['Wing Bug', 'Flying dogfighter.'],
  swarm_hive: ['Hive', 'Hatches a Worker Bug every 6s.'],
  swarm_convert: ['Assimilation Spores', 'Permanently convert an enemy (cost ≤4), lowest HP first.'],
  swarm_evolve: ['Gene Mimicry', 'Copy the costliest enemy in area (cost ≤5) at 70% HP.'],
  swarm_parasite: ['Parasite', 'Poison enemies in area for 8s; any that die become 2 Larvae.'],
  swarm_larva: ['Larva', 'Hatched swarm spawn.'],
  swarm_cocoon: ['Cocoon', 'Hatches a Larva in 3s.'],
  chaos_warrior: ['Twisted Warrior', 'Cheap, hard-hitting melee.'],
  chaos_wraith: ['Wraith', 'Ethereal: 30% dodge.'],
  chaos_construct: ['Demon Construct', 'Heavy juggernaut. Immune to stun and hack.'],
  chaos_zealot: ['Bomb Zealot', 'Charges structures and explodes for 135 area damage.'],
  chaos_berserker: ['Berserker', 'Below 50% HP: attack speed ×2.'],
  chaos_soulreaver: ['Soul Reaver', 'Ranged. 32% lifesteal.'],
  chaos_bats: ['Void Bats', '2 flying bats, 20% lifesteal.'],
  chaos_obelisk: ['Blight Obelisk', '26 corrosion/s within 2.2 tiles, incl. air.'],
  chaos_rain: ['Blight Rain', '22 corrosion/s in area for 4s.'],
  chaos_drain: ['Soul Drain', 'Deal 125 to the strongest enemy; heal your Core 125.'],
  chaos_sacrifice: ['Sacrifice', 'Detonate allies in area for 120% of their remaining HP.'],
  chaos_curse: ['Curse', 'Enemies in area take +60% damage for 7s.'],
};

const TAG_EN = {
  建筑: 'Building', 飞行: 'Flying', 对空: 'Anti-air', 攻城: 'Siege', 免控: 'Unstoppable', 溅射: 'Splash', 连锁: 'Chain', 护盾: 'Shield',
  光环: 'Aura', 吸血: 'Lifesteal', 狂暴: 'Berserk', 进化: 'Evolve', 亡语: 'On Death', 自爆: 'Self-Destruct',
  吞噬: 'Devour', 闪避: 'Dodge', 远程: 'Ranged',
};

const UPGRADE_EN = {
  up_steel_armor: ['Veteran Armor', 'Ranked Steel units take 12% less damage'],
  up_steel_rank: ['Field Promotion', 'Rank up every 8s'],
  up_swarm_hatch: ['Fast Hatch', 'Cocoons hatch in 2.25s'],
  up_swarm_shell: ['Hardened Shell', 'Cocoons +35% HP'],
  up_mecha_share: ['Defense Network', 'Network damage share 50%'],
  up_mecha_haste: ['Assault Network', 'Network attack speed +50%'],
  up_chaos_price: ['Blood Pact', 'Blood Price: 90 Core HP per Mana'],
  up_chaos_cooldown: ['Second Offering', 'Blood Price cooldown 10s'],
  up_atk: ['Attack Boost', 'All units +15% ATK'], up_hp: ['Armor Boost', 'All units +20% HP'],
  up_mana: ['Mana Flow', 'Mana regen +25%'], up_speed: ['Rapid Deploy', 'All units +15% speed'],
  up_maxmana: ['Mana Capacity', 'Max Mana +2'], up_frenzy: ['War Frenzy', 'Attack interval -15%'],
  up_basehp: ['Fortify Core', 'Core heals 200'],
};

const en = () => lang === 'en';
export const cardName = c => (en() && CARD_EN[c.id] ? CARD_EN[c.id][0] : c.name);
export const cardDesc = c => (en() && CARD_EN[c.id] ? CARD_EN[c.id][1] : c.desc);
export const factionName = (id, zh) => (en() && FACTION_EN[id] ? FACTION_EN[id][0] : zh);
export const factionDesc = (id, zh) => (en() && FACTION_EN[id] ? FACTION_EN[id][1] : zh);
// 标签形如 "建筑30秒" / "×3":拆出中文词再翻译
export function tagName(tag) {
  if (!en()) return tag;
  const m = tag.match(/^建筑(\d+)秒$/);
  if (m) return `Building ${m[1]}s`;
  return TAG_EN[tag] ?? tag;
}
export const upgradeText = up => (en() && UPGRADE_EN[up.id] ? { name: UPGRADE_EN[up.id][0], desc: UPGRADE_EN[up.id][1] } : { name: up.name, desc: up.desc });

// 带 data-i18n / data-i18n-ph 属性的静态元素
export function applyStaticText() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh';
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  document.title = t('docTitle');
}

// 完整性检查(测试用):所有卡牌都有英文
export function missingTranslations(cards) {
  return Object.values(cards).filter(c => !CARD_EN[c.id]).map(c => c.id);
}

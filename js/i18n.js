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
    firstMatchHome: '首次开局会带你完成第一次部署。', firstMatchSkip: '跳过引导', firstMatchGo: '开始对局',
    firstDeployXRText: '捏住亮边卡牌，移到蓝区再松手。用手柄时，按住扳机瞄准蓝区后松开。',
    firstDeployTitle: '先部署一张单位牌', firstDeployText: '选中下方亮边的牌，再点蓝色高亮区域。',
    firstWatchTitle: '单位会自动推进', firstWatchText: '出牌后，单位会自己移动和攻击。',
    firstCoreTitle: '争夺中央星核', firstCoreText: '站住中央金圈可以加快回蓝。两侧亮色裂隙会减慢地面单位。',
    upgradeTimeout: '超时将自动选择', upgradeRemaining: '剩余 {n} 秒',
    matchScore: '本局比分', matchCores: '己方 / 敌方核心', matchTime: '对局用时',
    reason_coreWon: '敌方核心被摧毁', reason_coreLost: '己方核心被摧毁',
    xrMode: 'XR 显示模式', xrAuto: '自动', xrImmersiveVR: '沉浸式 VR', xrImmersiveAR: '透视 AR',
    xrChecking: '正在检查 XR 支持…', xrCompatible: '可进入沉浸式空间大厅', xrUnavailable: '当前设备无法进入沉浸式 XR，可在设置中查看指南。',
    roomIdentity: '当前昵称：{name}', guestPlaceholder: '留空会分配游客名',
    codex: '图鉴', codexTitle: '卡牌图鉴', settings: '设置', language: '语言',
    filterFaction: '势力', filterType: '卡牌类型', allTypes: '全部类型', unit: '单位', building: '建筑',
    cardHealth: '生命', cardAttack: '攻击', cardRange: '射程', cardRadius: '作用半径', cardLifetime: '持续时间',
    gridUnits: '{n} 格', seconds: '{n} 秒', viewModel: '查看 3D 模型', codexEdit: '编辑{f}卡组', nextLabel: '下一张',
    docTitle: '星轨对决', loading: '加载中…', muteTip: '音效开关',
    deckErr_size: '卡组需要正好 {n} 张', deckErr_dup: '卡组不能有重复的牌', deckErr_faction: '{c} 不属于该势力', deckErr_deploy: '至少需要 {n} 张单位或建筑',
    battleCardHelp: '拖动卡牌，或点选卡牌后点战场。', aimBattleCard: '已选「{name}」 · 点战场部署', selectBattleCard: '选中{name}，费用 {cost}',
    connecting: '正在连接…', cancelConnection: '取消连接', connectionCancelled: '已取消连接。', tBadSpellDrop: '这个位置无法施放该法术。',
    copyRoom: '复制房间码', roomCopied: '房间码已复制', roomCopyManually: '已选中房间码，可手动复制。', randomFieldHelp: '开战时随机选择一张已开放战场。',
    deckFull: '卡组已满，先移除一张牌。', battleUnavailable: '无法打开战场，请确认浏览器已启用 WebGL 后重试。',
    xrBoardSize: '棋盘尺寸', xrBoard_small: '小', xrBoard_standard: '中', xrBoard_large: '大', xrSound: '音效', xrOn: '开', xrOff: '关', xrBoardChanged: '棋盘尺寸：{size}', xrLeftField: '已返回空间大厅',
    xrConfirmLeave: '确认离场', xrLeavePrompt: '离开当前对局？',
    xrPause: '暂停', xrResume: '继续', xrPaused: '已暂停', xrPausedHint: '张开左手掌心，在手心菜单里点「继续」',
    tGameResumed: '已继续', loopError: '出错了，已跳过这一帧：{e}', xrConfirmLeaveShort: '确认离开？', xrLeavePenaltyShort: '联机离场判负', xrPalmHint: '张开左手掌心朝向自己 → 菜单', xrErrorTitle: '出错了（已跳过这一帧，画面继续）· 请截图反馈', xrViewReset: '视角复位', tViewReset: '战场位置已复位', pausedResume: '已暂停 · 点击继续', xrHandOpacity: '手模型', xrHand_low: '淡', xrHand_mid: '中', xrHand_high: '浓',
    xrLeavePenalty: '联机离场将判负', xrContinueBattle: '继续对局',
    deployOutside: '落点不在战场内', deploySide: '越过己方部署线', deployWall: '岩脊阻挡',
    deployRock: '岩石阻挡', deployOccupied: '与建筑重叠',
    coreNeutral: '星核未占领', coreContested: '星核争夺中 · 回能暂停',
    coreCaptureBlue: '蓝方占领中', coreCaptureRed: '红方占领中',
    coreBlue: '蓝方控制星核', coreRed: '红方控制星核',
    xrGuide: 'XR 操作指南', close: '关闭', guidePrev: '上一步', guideNext: '下一步', guideDone: '完成',
    guide_pinch: '捏合取牌', guideDesc_pinch: '拇指和食指靠近卡牌，捏住后保持手势。',
    guide_release: '松手部署', guideDesc_release: '把牌移到蓝色己方区域的空地，看到有效落点后松手。',
    guide_recenter: '重新居中', guideDesc_recenter: '张开左手掌心朝向自己，点手心菜单里的「重新居中」；双手空捏 0.4 秒后拖动可旋转、升降、推拉战场。',
    xrHome: '空间大厅', xrExit: '退出 XR', xrCenter: '重新居中', xrLobbyHint: '捏合按钮，或用手柄射线选择', xrFaction: '切换势力', xrArena: '切换战场', xrSoundOn: '音效已开启', xrSoundOff: '音效已关闭',
    enterGame: '进入游戏', quickBattle: '快速开局', battleSetup: '对战准备', quickConfig: '{scene} · {difficulty}人机 · {n} 张牌',
    title: '星轨对决', pickFaction: '选择你的势力', editDeck: '编辑卡组', difficulty: '人机难度',
    easy: '简单', normal: '普通', hard: '困难', solo: '人机对战', online: '联机对战',
    stats: '战绩 {w} 胜 {l} 负{d} · 胜率 {r}% · 最高连胜 {b}', draws: ' {d} 平',
    fstat: '{w} 胜 {l} 负 · {r}%', deckSummary: '{f} · {kind}({n} 张)', presetDeck: '推荐卡组', customDeck: '自定义卡组',
    deckTitle: '{f} · 卡组构筑', deckCount: '已选 {n}/{max} · 平均费用 {avg} · 点击卡牌选入/移出',
    preset: '推荐卡组', saveBack: '保存并返回', cancel: '取消',
    onlineTitle: '联 机 对 战', nickname: '昵称', nicknamePh: '输入昵称', createHint: '创建房间,把房间码告诉对手',
    create: '创建房间', waiting: '等待对手加入…', joinHint: '输入对手的房间码', join: '加入', leaderboard: '排行榜(Elo)',
    noRecords: '还没有对局记录', noServer: '未连接联机服务器。请用 node server/server.mjs 启动并通过它打开页面', staticNoOnline: '网页试玩版只支持人机对战;联机对战需要在本地用 node server/server.mjs 启动', goOnline: '前往联机版',
    back: '返回', codeLen: '房间码是 4 位', needServer: '(需要用 node server/server.mjs 启动)',
    enemyBase: '敌方核心', myBase: '我方核心', enterXR: '进入 XR', quit: '退出对局',
    upgradeTitle: '⚡ 强 化 阶 段', upgradeSub: '选择一项强化(对手也会同时获得强化)', upgradeWait: '已选择,等待对手…',
    again: '再来一局', backMenu: '返回菜单', backLobby: '回到大厅',
    win: '🏆 胜利!', lose: '💀 战败', draw: '🤝 平局',
    endStats: '总战绩 {w} 胜 {l} 负 · 胜率 {r}%', streak: ' · {s} 连胜!',
    vs: '{a} VS {b} · 对手:{op}', nextCard: '下一张:{c}', upgradesComplete: '强化已完成', riftSlowHere: '地面减速 {n}%', riftSlowAhead: '可能经过减速区 −{n}%', toUpgrade: '强化还需 {n} 张牌(双方合计)',
    surgeTag: '能量涌潮 ×2', otTag: '加时赛 · 先拆塔者胜',
    netOk: '● 联机中', netLag: '● 网络卡顿 {ms}ms', netClosed: '● 已断开', netReconnect: '● 重连中…', passive: '招牌机制', battlefield: '战场', randomScene: '随机', tLoadingField: '正在加载战场…', bloodTip: '法力不足:血祭 {n} 核心生命', tBlood: '血祭:核心 -{n}',
    tSurge: '⚡ 能量涌潮:法力恢复速度 ×2', tOvertime: '⏱ 加时赛!先摧毁任意一座建筑的一方获胜',
    tNodeMine: '✦ 占领星核:法力恢复加速', tNodeEnemy: '✦ 敌方占领了星核', tNodeLost: '星核被夺走了',
    tTowerEnemy: '摧毁了一座敌方塔!', tTowerMine: '我方塔被摧毁', tPicks: '你选择了「{a}」,对手获得「{b}」',
    tDiscardCost: '弃牌需要 {n} 点法力', tBadDrop: '请在蓝色己方区域内的空地部署，避开障碍物和建筑。',
    tLeave: '退出联机对局会判负。3 秒内再选一次确认。', tOppLeft: '对手已离开', tConnLost: '与服务器的连接已断开', tOpDc: '对手掉线,{s} 秒内未重连判我方胜', tOpBack: '对手已重连', tResumed: '已重新连上',
    tStart: '对局开始!对手:{op}({f})', tNoXR: '此浏览器不支持 WebXR', tXRFail: '无法进入 XR: {e}',
    tXRHelp: '捏住手牌拖到己方半场任意位置出兵;拖到右侧回收区弃牌;左手掌心菜单里重新居中;双手空捏 0.4 秒拖动调整战场',
    spell: '法术', discardTip: '弃置换牌({n} 法力)', recenter: '左手掌心菜单里重新居中', pinch: '捏合选择',
    xrWin: '胜 利', xrLose: '战 败', xrDraw: '平 局', xrAgain: '捏合此面板 再来一局', ot: '加时赛', surge: '涌潮×2',
    reason_base: '摧毁了核心', reason_crowns: '常规时间结束 · 摧毁的塔更多', reason_overtime: '加时赛 · 率先摧毁建筑',
    reason_hp: '加时赛结束 · 剩余建筑血量更高', reason_draw: '加时赛结束 · 双方建筑血量相同', reason_forfeit: '对手离开,判定胜负', reason_mutual: '双方核心同时被摧毁',
    aiEasy: '简单 AI', aiNormal: '普通 AI', aiHard: '困难 AI',
    tTimeout: '连接服务器超时', tCantConnect: '无法连接联机服务器', tNoMana: '法力不足',
    tUnitHalf: '单位只能部署在己方半场', tRecentered: '已重新居中', mana: '法力', trash: '弃牌 -1法力',
  },
  en: {
    firstMatchHome: 'Your first match starts with a short deployment guide.', firstMatchSkip: 'Skip guide', firstMatchGo: 'Start match',
    firstDeployXRText: 'Pinch the highlighted card and release it over blue ground. With a controller, hold the trigger, aim, then release.',
    firstDeployTitle: 'Deploy a unit', firstDeployText: 'Select the highlighted card, then tap the blue deployment area.',
    firstWatchTitle: 'Units advance on their own', firstWatchText: 'Once deployed, units move and attack automatically.',
    firstCoreTitle: 'Capture the star core', firstCoreText: 'Hold the golden center ring to gain mana faster. Bright rifts slow ground units.',
    upgradeTimeout: 'An upgrade is chosen automatically when time runs out', upgradeRemaining: '{n}s remaining',
    matchScore: 'Match score', matchCores: 'My core / Enemy core', matchTime: 'Match time',
    reason_coreWon: 'Enemy core destroyed', reason_coreLost: 'Your core was destroyed',
    xrMode: 'XR display mode', xrAuto: 'Automatic', xrImmersiveVR: 'Immersive VR', xrImmersiveAR: 'Passthrough AR',
    xrChecking: 'Checking XR support…', xrCompatible: 'Immersive XR lobby available', xrUnavailable: 'Immersive XR is unavailable on this device. The guide is in Settings.',
    roomIdentity: 'Playing as {name}', guestPlaceholder: 'Leave blank for a guest name',
    codex: 'Codex', codexTitle: 'Card Codex', settings: 'Settings', language: 'Language',
    filterFaction: 'Faction', filterType: 'Card type', allTypes: 'All types', unit: 'Unit', building: 'Building',
    cardHealth: 'Health', cardAttack: 'Attack', cardRange: 'Range', cardRadius: 'Area radius', cardLifetime: 'Lifetime',
    gridUnits: '{n} tiles', seconds: '{n} s', viewModel: 'View 3D model', codexEdit: 'Edit {f} deck', nextLabel: 'Next',
    docTitle: 'Star Clash', loading: 'Loading…', muteTip: 'Sound on/off',
    deckErr_size: 'A deck needs exactly {n} cards', deckErr_dup: 'No duplicate cards', deckErr_faction: '{c} is not from this faction', deckErr_deploy: 'Needs at least {n} units or buildings',
    battleCardHelp: 'Drag a card or select it, then tap the field.', aimBattleCard: '{name} selected · Tap the field to play', selectBattleCard: 'Select {name}, cost {cost}',
    connecting: 'Connecting…', cancelConnection: 'Cancel connection', connectionCancelled: 'Connection cancelled.', tBadSpellDrop: 'This spell cannot be cast at that location.',
    copyRoom: 'Copy room code', roomCopied: 'Room code copied', roomCopyManually: 'Room code selected. Copy it manually.', randomFieldHelp: 'A battlefield is chosen at random from the available maps.',
    deckFull: 'Deck full. Remove a card first.', battleUnavailable: 'Could not open the battlefield. Check that WebGL is enabled and try again.',
    xrBoardSize: 'Board size', xrBoard_small: 'Small', xrBoard_standard: 'Medium', xrBoard_large: 'Large', xrSound: 'Sound', xrOn: 'On', xrOff: 'Off', xrBoardChanged: 'Board size: {size}', xrLeftField: 'Returned to the spatial lobby',
    xrConfirmLeave: 'Confirm leave', xrLeavePrompt: 'Leave this match?',
    xrPause: 'Pause', xrResume: 'Resume', xrPaused: 'Paused', xrPausedHint: 'Open your left palm and tap Resume in the palm menu',
    tGameResumed: 'Resumed', loopError: 'Something went wrong, frame skipped: {e}', xrConfirmLeaveShort: 'Leave?', xrLeavePenaltyShort: 'Counts as a loss', xrPalmHint: 'Open your left palm toward you → menu', xrErrorTitle: 'Error (frame skipped, still running) · please screenshot', xrViewReset: 'Reset view', tViewReset: 'Board position reset', pausedResume: 'Paused · click to resume', xrHandOpacity: 'Hand model', xrHand_low: 'Faint', xrHand_mid: 'Medium', xrHand_high: 'Solid',
    xrLeavePenalty: 'Leaving forfeits the online match', xrContinueBattle: 'Keep playing',
    deployOutside: 'Outside the battlefield', deploySide: 'Beyond your deployment line', deployWall: 'Blocked by a ridge',
    deployRock: 'Blocked by a rock', deployOccupied: 'Overlaps a structure',
    coreNeutral: 'Star core unclaimed', coreContested: 'Core contested · mana bonus paused',
    coreCaptureBlue: 'Blue capturing', coreCaptureRed: 'Red capturing',
    coreBlue: 'Blue controls the core', coreRed: 'Red controls the core',
    xrGuide: 'XR controls', close: 'Close', guidePrev: 'Previous', guideNext: 'Next', guideDone: 'Done',
    guide_pinch: 'Pinch to pick', guideDesc_pinch: 'Bring your thumb and index finger to the card and hold the pinch.',
    guide_release: 'Release to deploy', guideDesc_release: 'Move the card over open ground on your blue half. Release when the marker shows a valid spot.',
    guide_recenter: 'Recenter', guideDesc_recenter: 'Open your left palm toward you and tap Recenter in the palm menu. Pinch both hands for 0.4s, then drag to rotate, raise or move the board.',
    xrHome: 'Spatial lobby', xrExit: 'Exit XR', xrCenter: 'Recenter', xrLobbyHint: 'Pinch a button or use the controller ray', xrFaction: 'Next faction', xrArena: 'Next arena', xrSoundOn: 'Sound on', xrSoundOff: 'Sound off',
    enterGame: 'Enter game', quickBattle: 'Quick battle', battleSetup: 'Battle setup', quickConfig: '{scene} · {difficulty} AI · {n} cards',
    title: 'STAR CLASH', pickFaction: 'Choose your faction', editDeck: 'Edit deck', difficulty: 'AI level',
    easy: 'Easy', normal: 'Normal', hard: 'Hard', solo: 'vs AI', online: 'Online',
    stats: 'Record {w}W {l}L{d} · {r}% · best streak {b}', draws: ' {d}D',
    fstat: '{w}W {l}L · {r}%', deckSummary: '{f} · {kind} ({n} cards)', presetDeck: 'Recommended deck', customDeck: 'Custom deck',
    deckTitle: '{f} · Deck builder', deckCount: '{n}/{max} picked · avg cost {avg} · click a card to add/remove',
    preset: 'Recommended', saveBack: 'Save & back', cancel: 'Cancel',
    onlineTitle: 'ONLINE', nickname: 'Name', nicknamePh: 'Your name', createHint: 'Create a room and share the code',
    create: 'Create room', waiting: 'Waiting for opponent…', joinHint: "Enter your opponent's code", join: 'Join', leaderboard: 'Leaderboard (Elo)',
    noRecords: 'No matches yet', noServer: 'Not connected. Start with node server/server.mjs and open the page through it', staticNoOnline: 'The web demo supports vs-AI only; online play needs a local server (node server/server.mjs)', goOnline: 'Open the online version',
    back: 'Back', codeLen: 'Room codes have 4 characters', needServer: ' (start it with node server/server.mjs)',
    enemyBase: 'Enemy core', myBase: 'My core', enterXR: 'Enter XR', quit: 'Leave match',
    upgradeTitle: '⚡ UPGRADE', upgradeSub: 'Pick one upgrade (your opponent gets one too)', upgradeWait: 'Picked — waiting for opponent…',
    again: 'Play again', backMenu: 'Main menu', backLobby: 'Back to lobby',
    win: '🏆 Victory!', lose: '💀 Defeat', draw: '🤝 Draw',
    endStats: 'Record {w}W {l}L · {r}%', streak: ' · {s} win streak!',
    vs: '{a} VS {b} · Opponent: {op}', nextCard: 'Next: {c}', upgradesComplete: 'Upgrades complete', riftSlowHere: 'Ground slow {n}%', riftSlowAhead: 'Possible route slowdown −{n}%', toUpgrade: 'Upgrade in {n} plays (both sides)',
    surgeTag: 'Energy surge ×2', otTag: 'Overtime · first tower wins',
    netOk: '● Online', netLag: '● Lag {ms}ms', netClosed: '● Disconnected', netReconnect: '● Reconnecting…', passive: 'Signature', battlefield: 'Battlefield', randomScene: 'Random', tLoadingField: 'Loading battlefield…', bloodTip: 'Not enough mana: costs {n} core HP', tBlood: 'Blood price: core -{n}',
    tSurge: '⚡ Energy surge: mana regen ×2', tOvertime: '⏱ Overtime! First to destroy any building wins',
    tNodeMine: '✦ Star core captured: faster mana', tNodeEnemy: '✦ Enemy captured the star core', tNodeLost: 'Star core lost',
    tTowerEnemy: 'Enemy tower destroyed!', tTowerMine: 'We lost a tower', tPicks: 'You picked "{a}", opponent got "{b}"',
    tDiscardCost: 'Discarding costs {n} mana', tBadDrop: 'Deploy on open ground on your blue half, clear of obstacles and structures.',
    tLeave: 'Leaving counts as a loss. Select again within 3s to confirm.', tOppLeft: 'Opponent left', tConnLost: 'Connection to server lost', tOpDc: 'Opponent dropped — they lose if not back within {s}s', tOpBack: 'Opponent reconnected', tResumed: 'Reconnected',
    tStart: 'Match started! Opponent: {op} ({f})', tNoXR: 'This browser does not support WebXR', tXRFail: 'Cannot enter XR: {e}',
    tXRHelp: 'Pinch a card and drag it onto your half; drop on the bin to discard; recenter from the left palm menu; pinch both hands for 0.4s and drag to adjust the board',
    spell: 'Spell', discardTip: 'Discard ({n} mana)', recenter: 'Recenter from the left palm menu', pinch: 'Pinch to pick',
    xrWin: 'VICTORY', xrLose: 'DEFEAT', xrDraw: 'DRAW', xrAgain: 'Pinch here to play again', ot: 'OT', surge: 'Surge×2',
    reason_base: 'Core destroyed', reason_crowns: 'Time up · more towers destroyed', reason_overtime: 'Overtime · first building destroyed',
    reason_hp: 'Overtime over · more building HP left', reason_draw: 'Overtime over · equal building HP', reason_forfeit: 'Opponent left', reason_mutual: 'Both cores destroyed at once',
    aiEasy: 'Easy AI', aiNormal: 'Normal AI', aiHard: 'Hard AI',
    tTimeout: 'Server connection timed out', tCantConnect: 'Cannot reach the online server', tNoMana: 'Not enough mana',
    tUnitHalf: 'Units deploy on your half only', tRecentered: 'Recentered', mana: 'Mana', trash: 'Discard -1',
  },
};

export function t(key, vars = {}) {
  const s = UI[lang][key] ?? UI.zh[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// 势力招牌机制(英文)
const PASSIVE_EN = {
  steel: ['Veteran Ranks', 'Units rank up every 10s alive (up to 3 ranks), +20% HP and attack per rank'],
  mecha: ['Tactical Network', 'Nearby units link up: linked allies absorb 40% of the damage taken, +35% attack speed'],
  swarm: ['Assimilation', 'Ground enemies killed by swarm units become cocoons that hatch a larva after 3s (cocoons can be destroyed)'],
  chaos: ['Blood Price', 'Short on mana? Pay with your core: 100 HP per missing mana (core keeps at least 300, 12s cooldown)'],
};
export const passiveText = (id, p) => (en() && PASSIVE_EN[id] ? { name: PASSIVE_EN[id][0], desc: PASSIVE_EN[id][1] } : p);

const FACTION_EN = {
  steel: ['Iron Alliance', 'Buffs · shields & auras · steady push'],
  mecha: ['Maya Synthetics', 'Air squadrons · hacking · automated factories'],
  swarm: ['Assimilation Swarm', 'Hatching · evolution · parasitic assimilation'],
  chaos: ['Chaos Blight', 'Sacrifice & bombs · soul drain & rage · curses'],
};

const CARD_EN = {
  steel_infantry: ['Alliance Rifleman', 'Rifle infantry that can shoot air'],
  steel_tank: ['Heavy Tank', 'Thick armor, slow push'],
  steel_artillery: ['Artillery Post', 'Long-range splash bombardment'],
  steel_shield: ['Shield Trooper', 'Energy shield that soaks damage'],
  steel_banner: ['Standard Bearer', 'Nearby allies +50% attack and +20% speed'],
  steel_siege: ['Siege Engine', 'Only attacks buildings — a tower breaker'],
  steel_turret: ['Defense Turret', 'Fortified turret, hits air'],
  steel_buff_atk: ['Rally', 'All your units +10 attack (permanent)'],
  steel_repair: ['Field Repair', 'Your units in the area heal 150'],
  steel_strike: ['Orbital Strike', 'Lands after 1.2s: 200 area damage (40% to buildings)'],
  steel_barrier: ['Emergency Shield', 'Allies in area gain a 150 shield'],
  mecha_drone: ['Scout Drone', 'Flying, fast harassment'],
  mecha_sentry: ['Sentry Gun', 'Slow ranged platform'],
  mecha_walker: ['Tactical Mech', 'Well-rounded main battle unit'],
  mecha_swarmdrone: ['Drone Swarm', 'Deploys 3 flying drones'],
  mecha_arc: ['Arc Trooper', 'Attacks chain to 2 more enemies'],
  mecha_sniper: ['Sniper Unit', 'Very long range, heavy single shots'],
  mecha_factory: ['Drone Factory', 'Builds a scout drone every 9s'],
  mecha_emp: ['EMP Pulse', 'Enemies in area take 45 and are stunned 2.5s'],
  mecha_hack: ['Hack', 'Strongest enemy in area fights for you for 3s'],
  mecha_chain: ['Chain Lightning', 'Hits the enemy near the target and jumps 4 times, 110 each'],
  mecha_airdrop: ['Drone Airdrop', 'Drops 2 scout drones on your half'],
  swarm_worker: ['Worker Bug', 'Evolves into a Warrior Bug after 15s'],
  swarm_warrior: ['Warrior Bug', 'The backbone of the swarm'],
  swarm_devourer: ['Devourer', 'Heals by devouring enemies it kills'],
  swarm_brood: ['Larva Brood', 'Hatches 4 larvae at once'],
  swarm_mother: ['Brood Mother', 'Releases 4 larvae when she dies'],
  swarm_spitter: ['Acid Spitter', 'Ranged acid with splash'],
  swarm_flyer: ['Wing Bug', 'Flying, dogfights in the air'],
  swarm_hive: ['Hive', 'Hatches a worker bug every 6s'],
  swarm_convert: ['Assimilation Spores', 'Permanently convert an enemy unit costing ≤4 (lowest HP first)'],
  swarm_evolve: ['Gene Mimicry', 'Copies the highest-cost enemy unit (cost ≤ 5) near the target to fight for you; the copy has 70% HP'],
  swarm_parasite: ['Parasite', 'Poisons enemies for 8s; if they die meanwhile, they become 2 of your larvae'],
  swarm_larva: ['Larva', 'A freshly hatched larva'],
  swarm_cocoon: ['Cocoon', 'Hatches a larva after 3s'],
  chaos_warrior: ['Twisted Warrior', 'A warrior warped by chaos'],
  chaos_wraith: ['Wraith', 'Ethereal: 30% chance to dodge attacks'],
  chaos_construct: ['Demon Construct', 'Devastating heavy unit, immune to stun and hacking'],
  chaos_zealot: ['Bomb Zealot', 'Charges buildings and explodes for 140 area damage'],
  chaos_berserker: ['Berserker', 'Below half HP: attack speed doubles'],
  chaos_soulreaver: ['Soul Reaver', 'Ranged soul drain, heals 35% of damage dealt'],
  chaos_bats: ['Void Bats', '2 flying life-stealing bats'],
  chaos_obelisk: ['Blight Obelisk', 'Deals 26 corrosion per second to enemies within 2.2 (incl. air)'],
  chaos_rain: ['Blight Rain', 'Enemies in area take 22 corrosion per second for 4s'],
  chaos_drain: ['Soul Drain', '125 damage to the strongest enemy; your core heals 125'],
  chaos_sacrifice: ['Sacrifice', 'Your units in area burst, dealing 120% of their HP to nearby enemies'],
  chaos_curse: ['Curse', 'Enemies in area take +60% damage for 7s'],
};

const TAG_EN = {
  建筑: 'Building', 飞行: 'Flying', 对空: 'Anti-air', 攻城: 'Siege', 免控: 'Unstoppable', 溅射: 'Splash', 连锁: 'Chain', 护盾: 'Shield',
  光环: 'Aura', 吸血: 'Lifesteal', 狂暴: 'Berserk', 进化: 'Evolve', 亡语: 'Deathrattle', 自爆: 'Explode',
  吞噬: 'Devour', 闪避: 'Dodge', 远程: 'Ranged',
};

const UPGRADE_EN = {
  up_steel_armor: ['Veteran Armor', 'Ranked Steel units take 12% less damage'],
  up_steel_rank: ['Field Promotion', 'Steel units gain a rank every 8 seconds'],
  up_swarm_hatch: ['Fast Hatch', 'Assimilation cocoons hatch in 2.25 seconds'],
  up_swarm_shell: ['Hardened Shell', 'Assimilation cocoons gain 35% health'],
  up_mecha_share: ['Defense Network', 'Networked units share 50% of incoming damage'],
  up_mecha_haste: ['Assault Network', 'Networked units gain 50% attack speed'],
  up_chaos_price: ['Blood Pact', 'Blood Price costs 80 core health per missing mana'],
  up_chaos_cooldown: ['Second Offering', 'Blood Price cooldown drops to 9 seconds'],
  up_atk: ['Attack Boost', 'All units +15% attack'], up_hp: ['Armor Boost', 'All units +20% HP'],
  up_mana: ['Energy Flow', 'Mana regen +25%'], up_speed: ['Rapid Deploy', 'Unit move speed +15%'],
  up_maxmana: ['Energy Capacity', 'Max mana +2'], up_frenzy: ['War Frenzy', 'Attack interval -15%'],
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

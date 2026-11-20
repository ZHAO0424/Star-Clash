// XR 交互层 — 手部追踪 Pinch 选牌 + 拖拽落位;手柄射线作为兜底
// 设计约束(见 plan):只用 Pinch + 拖拽,不依赖手势速度、巧合或空间深度
//
// 空间布局(anchor = 进入 XR 时用户头部位置 + 朝向):
//   战场  :头下 60cm、前方 85cm(第七轮),「小」档约 0.54m × 0.75m 的桌面
//   手牌  :眼睛和棋盘近边之间、离眼 38cm,上沿紧贴"眼 → 近边"视线下方 2.5°(绝不挡棋盘),正对眼睛(cardRowPose);
//           一排 5 张,整行 0.8 倍;能量条在手牌下面
//   HUD   :战场远端上方
//   强化/结束面板:手牌上方,需要时出现
// 重新居中在左手手心菜单里;双手同时空捏保持 0.4 秒 → 拖动旋转 / 升降 / 推拉战场(xr-board-rig.js)

import * as THREE from 'three';
import { FACTIONS, cardTags, previewRadius } from './cards.js';
import { cardArt, uiArt, XR_GUIDE, loadXRGuideArt, loadXRControlArt } from './assets.js';
import { isPlaced, DISCARD_COST } from './game.js';
import { ARENA } from './arena.js';
import { XR_POSE_INTERVAL, XR_POSE_TIMEOUT, xrPartInSeat } from './net.js';
import { XROpponentAvatar } from './xr-avatar.js';
import { createHandVisual } from './xr-hand-visual.js';
import { autoTargets, healSnap } from './heal-snap.js';
import { HandRay } from './xr-hand-ray.js';
import { HandArbiter } from './xr-pointer.js';
import { PalmMenu } from './xr-palm-menu.js';
import { BoardRig } from './xr-board-rig.js';
import { RIG, UI_SIDE, uiSector, wrapAngle, inPointingZone, cardRowPose, forwardLean, nearestWithin, GRAB_RADIUS, chooseDrop } from './xr-math.js';
import { coreStatus, t, getLang, cardName, cardDesc, factionName, tagName, upgradeText } from './i18n.js';

const PINCH_ON = 0.022;      // 指尖距离 < 2.2cm 视为捏合
const PINCH_OFF = 0.038;     // > 3.8cm 视为松开(滞回,防抖)
// GRAB_RADIUS(xr-math.js):捏合点 12cm 内磁吸最近的牌,悬停高亮同一半径(第七轮,原 6cm / 高亮 7.8cm)
const UPGRADE_PICK_RADIUS = 0.09;   // 强化面板近手点选半径(沿用原 6cm × 1.5)
const DROP_MAX_HEIGHT = 0.45;// 捏合点离战场面 45cm 内才算落在战场上(第七轮:手牌行抬高到台面上方约 28cm,原 25cm)
const OUT_HINT_DELAY_MS = 300;  // 拖着牌连续 0.3s 没落点才显示「超出战场」
const PUT_BACK_RADIUS = 0.06;// 松手时牌(近手)/ 射线离它原来的槽位 6cm 内 = 放回去,静默退回,不提示
const CARD_W = 0.072, CARD_H = 0.1, CARD_GAP = 0.082;
const BOARD_SCALES = { small: 0.038, standard: 0.046, large: 0.054 };   // 第七轮:原 0.044 / 0.052 / 0.060
const BOARD_CENTER_DISTANCE = 0.85;   // 战场中心离头的水平距离(第七轮:原 0.72)
const BOARD_DROP = 0.60;              // 战场中心在头下多少(第七轮:原 0.50)
const HUD_BASE_DISTANCE = 1.33;       // 标准档 HUD 距离,在远边(0.85 + 0.452)之外约 3cm
const POSTER_WIDTH = 0.56;
const POSTER_HEIGHT = POSTER_WIDTH * 16 / 9;
const POSTER_GAP = 0.30;
const RETURN_SECONDS = 0.18;
const TRASH_RADIUS = 0.06;   // 拖到回收区 6cm 内松开 = 弃牌
const CARD_FADE_S = 0.15;    // 抓起一张牌时其余手牌渐隐 / 松手后渐显的时长
const RIM_ALLOWANCE = 0.3;   // 台面以上边框 / 装饰的高度余量(战场单位):近边视线瞄的是它的上沿
const CARD_ROW_SCALE = 0.8;  // 手牌行整体缩放(牌、间距、下一张、回收区、能量条、说明条;Canvas 分辨率不变)
// 手牌行中心到上沿 / 下沿(说明条底边)的距离,米,已含缩放
const CARD_ROW_EXTENT = { top: 0.05 * CARD_ROW_SCALE, bottom: 0.127 * CARD_ROW_SCALE };
const CARD_ROW_SMOOTH = 0.2; // 手牌行自适应位置 / 倾角的平滑时间常数(秒)
const HAND_OPACITY = { low: 0.2, mid: 0.35, high: 0.55 };
const RAY_NEAR = 0.15;       // 手离按钮 15cm 内进入近手戳(手牌改用 GRAB_RADIUS 磁吸,第七轮)
const RAY_FAR = 0.22;        // 离开 22cm 才回到射线(回差,手在边界晃动时不来回跳)
const RAY_DWELL = 0.12;      // 射线在按钮上悬停满 0.12s,捏合才算点击(扫过按钮时顺手一捏不算);抓手牌不需要(第七轮)

const hex = c => '#' + c.toString(16).padStart(6, '0');

// ── Canvas 贴图面板 ──
// 面板写深度(透明圆角靠 alphaTest 丢掉):半透明的手在 renderOrder 之后画、读深度,
// 手在面板后面就被挡住、在前面就盖住面板,不再"谁先画谁被盖"
const PANEL_ALPHA_TEST = 0.05;
function makePanel(wM, hM, wPx, hPx) {
  const canvas = document.createElement('canvas');
  canvas.width = wPx; canvas.height = hPx;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(wM, hM),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, alphaTest: PANEL_ALPHA_TEST })
  );
  mesh.renderOrder = 20;
  return { mesh, ctx, tex, canvas };
}

// 中文逐字折行;英文按词折行(原来逐字折,英文单词会被从中间截断)
const WRAP_TOKEN = /[⺀-鿿＀-￯]|[^\s⺀-鿿＀-￯]+\s*|\s+/g;
function wrapText(ctx, text, x, y, maxW, lineH, maxLines = 3) {
  let line = '', lines = 0;
  for (const tok of text.match(WRAP_TOKEN) ?? []) {
    if (ctx.measureText((line + tok).trimEnd()).width > maxW && line) {
      ctx.fillText(line.trimEnd(), x, y); y += lineH; line = tok.trimStart();
      if (++lines >= maxLines) return;
    } else line += tok;
  }
  if (line) ctx.fillText(line.trimEnd(), x, y);
}

function drawCard(panel, card, affordable, hover, blood = null) {
  const { ctx, canvas: c, tex } = panel;
  const W = c.width, H = c.height;
  const fc = hex(FACTIONS[card.faction].color);
  ctx.clearRect(0, 0, W, H);
  ctx.globalAlpha = affordable ? 1 : 0.4;
  // 底
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(102,85,115,0.45)'); g.addColorStop(1, 'rgba(54,42,67,0.45)');   // 半透明底:透出后面的战场
  ctx.fillStyle = g;
  ctx.beginPath();
  if (card.type === 'spell') {
    ctx.moveTo(W / 2, 6); ctx.lineTo(W - 6, 52); ctx.lineTo(W - 6, H - 52);
    ctx.lineTo(W / 2, H - 6); ctx.lineTo(6, H - 52); ctx.lineTo(6, 52); ctx.closePath();
  } else if (card.type === 'building') {
    ctx.moveTo(30, 6); ctx.lineTo(W - 30, 6); ctx.lineTo(W - 6, 30);
    ctx.lineTo(W - 6, H - 6); ctx.lineTo(6, H - 6); ctx.lineTo(6, 30); ctx.closePath();
  } else {
    ctx.roundRect(6, 6, W - 12, H - 12, 18);
  }
  ctx.fill();
  ctx.lineWidth = hover ? 10 : 5;
  ctx.strokeStyle = hover ? '#ffe1a0' : fc;
  ctx.stroke();
  // 费用
  const mana = uiArt('mana-crystal');
  if (mana && blood === null) ctx.drawImage(mana.img, 12, 10, 50, 50);
  else {
    ctx.fillStyle = blood === null ? '#784cad' : '#c0283c';
    ctx.beginPath(); ctx.arc(37, 35, 23, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = blood === null ? '#eed0ff' : '#ffc0bc';
    ctx.lineWidth = 3; ctx.stroke();
  }
  ctx.fillStyle = '#fff'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(card.cost, 37, 47);
  if (blood !== null) {   // 混沌血祭:右上角红色扣血标签
    ctx.fillStyle = '#c0283c'; ctx.beginPath(); ctx.roundRect(W - 120, 12, 106, 40, 14); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`-${blood}`, W - 67, 42);
  }
  const art = cardArt(card);
  if (art) {
    const size = 197;
    ctx.save();
    if (art.glow) ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(art.img, (W - size) / 2, 51, size, size);
    ctx.restore();
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff4d8'; ctx.font = 'bold 33px sans-serif';
  ctx.fillText(cardName(card), W / 2, 268, W - 28);
  const tag = cardTags(card)[0];
  ctx.fillStyle = '#efd4df'; ctx.font = '24px sans-serif';
  ctx.fillText([t(card.type), tag && tagName(tag)].filter(Boolean).join(' · '), W / 2, 302, W - 38);
  ctx.globalAlpha = 1;
  tex.needsUpdate = true;
}

export class XRControls {
  // cb: { getGame(), onPlay(idx, x, z), onDiscard(idx), onUpgrade(i), onRestart(), onToast(msg) }
  constructor(bs, cb) {
    this.bs = bs;
    this.renderer = bs.renderer;
    this.cb = cb;
    this.active = false;
    this.inputResumeFrames = 0;

    this.anchor = new THREE.Group();
    bs.scene.add(this.anchor);
    // 战场和整套 UI(手牌、HUD、大厅 / 教学、设置、暂停提示、立牌)都挂在 boardRig 下,相对位置固定,双手操控时一起动
    this.boardRig = new BoardRig(this.anchor, () => bs.world.position, cb.getBoardRig?.(), rig => cb.setBoardRig?.(rig));
    // UI 换边(第三轮):整套 UI 挂在 uiPivot → uiInner 下。uiPivot 放在战场中心、uiInner 反向平移回来,
    // 所以 uiPivot 不转时和直接挂在 boardRig 下完全一样;棋盘转过 55° 后 uiPivot 绕战场中心按 90° 吸附到面向用户的一边
    this.uiPivot = new THREE.Group();
    this.uiInner = new THREE.Group();
    this.uiPivot.add(this.uiInner);
    this.boardRig.node.add(this.uiPivot);
    this.uiSide = { sector: 0, angle: 0, from: 0, to: 0, t: 1 };
    this.poster = new THREE.Group();
    this.poster.name = 'vr:standing-poster';
    this.poster.visible = false;
    this.uiInner.add(this.poster);
    this.ui = new THREE.Group();
    this.ui.visible = false;
    this.uiInner.add(this.ui);
    // 双手操控时的提示:两手之间一条连线 + 战场外框发光
    this.rigLink = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.9 }));
    this.rigLink.frustumCulled = false;
    this.rigLink.visible = false;
    bs.scene.add(this.rigLink);
    const edgeX = ARENA.hx + ARENA.rim, edgeZ = ARENA.hz + ARENA.rim, edgeY = ARENA.top + 0.05;
    this.rigOutline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-edgeX, edgeY, -edgeZ), new THREE.Vector3(edgeX, edgeY, -edgeZ),
      new THREE.Vector3(edgeX, edgeY, edgeZ), new THREE.Vector3(-edgeX, edgeY, edgeZ),
    ]), new THREE.LineBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.95, depthTest: false }));
    this.rigOutline.renderOrder = 25;
    // 近手拖牌时,手里的牌到前倾后的落点画一条细虚线:看得出"会落在那里"
    this.dropLink = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineDashedMaterial({ color: 0xbfefff, dashSize: 0.006, gapSize: 0.005, transparent: true, opacity: 0.8, depthTest: false }));
    this.dropLink.renderOrder = 26;
    this.dropLink.frustumCulled = false;
    this.dropLink.visible = false;
    bs.scene.add(this.dropLink);
    this.rigOutline.visible = false;
    bs.world.add(this.rigOutline);

    // 手牌
    this.cardRow = new THREE.Group();
    // 初始位置;进 XR 后每帧由 updateCardRow 按棋盘近边和眼睛的相对位置重算(第四轮)
    this.cardRow.position.set(0, -0.42, -0.24);
    this.cardRow.rotation.x = -0.60;
    this.cardRow.scale.setScalar(CARD_ROW_SCALE);
    this.ui.add(this.cardRow);
    this.cards = [];
    for (let i = 0; i < 5; i++) {
      const p = makePanel(CARD_W, CARD_H, 256, 356);
      p.home = new THREE.Vector3((i - 2) * CARD_GAP, 0, 0);
      p.mesh.position.copy(p.home);
      p.mesh.userData.idx = i;
      this.cardRow.add(p.mesh);
      this.cards.push(p);
    }
    this.cardSig = '';
    this.cardBacksReady = false;

    this.nextCardPanel = makePanel(0.054, 0.071, 184, 240);
    this.nextCardPanel.mesh.position.set(-3 * CARD_GAP, 0, 0);
    this.cardRow.add(this.nextCardPanel.mesh);
    this.manaPanel = makePanel(0.28, 0.034, 736, 104);
    this.manaPanel.mesh.position.set(0, -0.072, 0);   // 能量条在手牌下面
    this.cardRow.add(this.manaPanel.mesh);
    this.cardDetailPanel = makePanel(0.32, 0.034, 840, 100);
    this.cardDetailPanel.mesh.position.set(0, -0.11, 0);
    this.cardRow.add(this.cardDetailPanel.mesh);

    // 回收区(弃牌):手牌右侧
    this.trash = makePanel(0.07, 0.07, 256, 256);
    this.trash.mesh.position.set(3 * CARD_GAP + 0.01, 0, 0);
    this.cardRow.add(this.trash.mesh);
    this.drawTrash();
    this.cardRowNoDepthTest();

    // HUD
    this.hud = makePanel(0.42, 0.105, 1024, 256);
    this.hud.mesh.position.set(0, -0.3, -1.25);
    this.ui.add(this.hud.mesh);
    this.hudTimer = 0;

    this.placementHint = makePanel(0.20, 0.036, 640, 115);
    this.placementHint.mesh.visible = false;
    this.ui.add(this.placementHint.mesh);
    this.firstMatchControls = new THREE.Group();
    this.firstMatchControls.position.set(0, -0.20, -0.74);
    this.firstMatchControls.visible = false;
    this.ui.add(this.firstMatchControls);
    this.firstMatchPrompt = makePanel(0.40, 0.079, 1040, 210);
    this.firstMatchControls.add(this.firstMatchPrompt.mesh);
    this.firstMatchButtons = ['skip', 'start', 'center', 'home'].map((action, index) => {
      const button = makePanel(0.145, 0.043, 464, 138);
      button.action = action;
      button.mesh.position.set(index % 2 ? 0.084 : -0.084, -0.068 - Math.floor(index / 2) * 0.054, 0);
      this.firstMatchControls.add(button.mesh);
      return button;
    });

    this.notice = null;
    // 原来前方 57cm 的一排战斗按钮(重新居中 / 棋盘尺寸 / 音效 / 离开)已并进左手手心菜单(第三轮)
    this.palmHintUntil = 0;   // 开局提示「张开左手掌心 → 菜单」

    // 强化面板
    this.upgradeGroup = new THREE.Group();
    this.upgradeGroup.position.set(0, -0.24, -0.5);
    this.ui.add(this.upgradeGroup);
    this.upgrades = [];
    for (let i = 0; i < 3; i++) {
      const p = makePanel(0.17, 0.11, 512, 332);
      p.mesh.position.set((i - 1) * 0.19, 0, 0);
      p.mesh.userData.idx = i;
      this.upgradeGroup.add(p.mesh);
      this.upgrades.push(p);
    }
    this.upgradeWait = makePanel(0.29, 0.056, 720, 140);
    this.upgradeWait.mesh.visible = false;
    this.upgradeGroup.add(this.upgradeWait.mesh);
    this.upgradeClock = makePanel(0.30, 0.049, 720, 128);
    this.upgradeClock.mesh.position.y = 0.093;
    this.upgradeGroup.add(this.upgradeClock.mesh);
    this.upgradeFor = null;

    // 结束面板
    this.endPanel = makePanel(0.3, 0.12, 768, 308);
    this.endPanel.mesh.position.set(0, -0.24, -0.5);
    this.ui.add(this.endPanel.mesh);
    this.endFor = null;

    // 首页按需重画 Canvas。
    this.lobby = new THREE.Group();
    // 大厅(含教学)离头 1.0m、整组放大 2.0 倍(相对最早的 0.46m):视角大小基本不变,靠射线点(第五轮)
    this.lobby.position.set(0, -0.31, -1.0);
    this.lobby.scale.setScalar(2.0);
    this.lobby.visible = false;
    this.uiInner.add(this.lobby);
    this.lobbyHeader = makePanel(0.34, 0.087, 1024, 262);
    this.lobbyHeader.mesh.position.y = 0.112;
    this.lobby.add(this.lobbyHeader.mesh);
    const actions = ['quick', 'faction', 'arena', 'sound', 'center', 'guide', 'exit'];
    this.lobbyButtons = actions.map((action, i) => {
      const button = makePanel(i === 0 ? 0.34 : 0.162, 0.052, i === 0 ? 1024 : 512, 164);
      button.action = action;
      button.mesh.position.set(i === 0 ? 0 : i % 2 ? -0.089 : 0.089, i === 0 ? 0.038 : -0.025 - Math.floor((i - 1) / 2) * 0.063, 0);
      this.lobby.add(button.mesh);
      return button;
    });
    this.guideIndex = -1;
    this.guideGroup = new THREE.Group();
    this.guideGroup.visible = false;
    this.lobby.add(this.guideGroup);
    this.guidePanel = makePanel(0.34, 0.244, 1020, 732);
    this.guidePanel.mesh.position.y = 0.03;
    this.guideGroup.add(this.guidePanel.mesh);
    this.guideButtons = ['previous', 'close', 'next'].map((action, i) => {
      const button = makePanel(0.10, 0.049, 320, 156);
      button.action = action;
      button.mesh.position.set((i - 1) * 0.113, -0.125, 0);
      this.guideGroup.add(button.mesh);
      return button;
    });
    this.lobbyReturn = makePanel(0.17, 0.044, 512, 132);
    this.lobbyReturn.action = 'home';
    this.lobbyReturn.mesh.position.set(0, -0.34, -0.5);
    this.lobbyReturn.mesh.visible = false;
    this.ui.add(this.lobbyReturn.mesh);
    this.lobbySignature = '';
    this.drawLobbyButton(this.lobbyReturn, t('xrHome'));

    // 主循环出错提示(main.js 的 loop 兜底):挂在 anchor 下、视线正前方偏上,方便用户截图
    this.errorPanel = makePanel(0.36, 0.09, 1152, 288);
    this.errorPanel.mesh.material.depthTest = false;
    this.errorPanel.mesh.renderOrder = 998;
    this.errorPanel.mesh.position.set(0, 0.10, -0.6);
    this.errorPanel.mesh.visible = false;
    this.anchor.add(this.errorPanel.mesh);
    this.errorUntil = 0;

    // 开局倒计时:战场上方、面向用户,比手牌高(不会被手牌挡住);准备阶段显示 5…1,开战后「开战！」1 秒
    this.countdownPanel = makePanel(0.22, 0.11, 704, 352);
    this.countdownPanel.mesh.position.set(0, -0.30, -0.70);
    this.countdownPanel.mesh.rotation.x = -0.25;
    this.countdownPanel.mesh.visible = false;
    this.ui.add(this.countdownPanel.mesh);
    this.goUntil = 0;

    // 暂停提示:战场上方
    this.pausedPanel = makePanel(0.26, 0.07, 832, 224);
    this.pausedPanel.mesh.position.set(0, -0.36, -0.68);
    this.pausedPanel.mesh.rotation.x = -0.35;
    this.pausedPanel.mesh.visible = false;
    this.ui.add(this.pausedPanel.mesh);

    // XR 设置面板(手心菜单「设置」打开):大厅和对局里都能用;放在战斗按钮、手牌行上方,和其它面板不相交
    this.settingsOpen = false;
    this.settings = new THREE.Group();
    this.settings.position.set(0, 0.06, -0.5);
    this.settings.visible = false;
    this.uiInner.add(this.settings);
    this.settingsHeader = makePanel(0.30, 0.04, 960, 128);
    this.settingsHeader.mesh.position.y = 0.075;
    this.settings.add(this.settingsHeader.mesh);
    this.settingsButtons = ['size', 'sound', 'hand', 'view', 'close'].map(action => {
      const button = makePanel(0.145, 0.046, 464, 148);
      button.action = action;
      this.settings.add(button.mesh);
      return button;
    });
    this.layoutSettings();
    this.settingsSignature = '';

    // 左手手心菜单
    this.palmMenu = new PalmMenu(bs.scene, [
      { id: 'center', icon: () => 'center', label: () => t('xrCenter') },
      { id: 'pause', icon: () => (this.cb.isPaused?.() ? 'resume' : 'pause'),
        label: () => t(this.cb.isPaused?.() ? 'xrResume' : 'xrPause'), disabled: () => !this.cb.canPause?.() },
      { id: 'settings', icon: () => 'settings', label: () => t('settings') },
      // 退出 XR:只结束 XR 会话,对局不停,回到电脑画面接着打(随时可以再点「进入 XR」回来)
      { id: 'exitxr', icon: () => 'exitxr', label: () => t('xrExit') },
      // 退出对局:原地两段确认,第一次点变成红色「确认离开？」,3 秒内再点才离开;联机加「判负」小字
      { id: 'leave', icon: () => 'leave', label: () => t(this.leaveArmed() ? 'xrConfirmLeaveShort' : 'quit'),
        detail: () => (this.leaveArmed() && this.cb.getBattleControls().online ? t('xrLeavePenaltyShort') : ''),
        danger: () => this.leaveArmed(), disabled: () => !this.cb.getGame() },
    ]);
    this.leaveArmedAt = -Infinity;
    this.leaveArmedGame = null;

    // 输入源
    this.raycaster = new THREE.Raycaster();
    this.inputs = [];
    for (let i = 0; i < 2; i++) {
      const hand = this.renderer.xr.getHand(i);
      const visual = createHandVisual(hand);
      hand.add(visual.object);
      bs.scene.add(hand);

      const ctrl = this.renderer.xr.getController(i);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0x5ac8ff })
      );
      line.scale.z = 2;
      ctrl.add(line);
      bs.scene.add(ctrl);

      const st = { i, hand, visual, ctrl, line, isHand: false, connected: false,
                   pinched: false, grab: null, hover: -1, point: new THREE.Vector3(),
                   handRay: new HandRay(bs.scene), ray: null, rayActive: false, rayTarget: false,
                   tracked: false, pinchDist: Infinity, pinchPoint: new THREE.Vector3(), pressRay: new THREE.Ray() };
      ctrl.addEventListener('connected', e => {
        st.connected = true;
        st.isHand = !!e.data.hand;
        st.side = e.data.handedness;
        line.visible = !st.isHand;
      });
      ctrl.addEventListener('disconnected', () => {
        st.connected = false;
        this.loseHandTracking(st);
      });
      // 手部追踪时系统也会把捏合转成 select,这里只处理真正的手柄
      ctrl.addEventListener('selectstart', () => { if (!st.isHand) this.press(st, null, this.ctrlRay(st)); });
      ctrl.addEventListener('selectend', () => {
        if (st.isHand || !st.grab) return;
        const cancel = !this.canUseInput() || !st.connected || !st.ctrl.visible;
        if (!cancel) this.dragRay(st, this.ctrlRay(st));
        this.release(st, cancel);
      });
      this.inputs.push(st);
    }
    this.bothPinchTime = 0;
    this.arbiter = new HandArbiter();   // 两只手都在时只有一只在指,另一只捏一下抢过来
  }

  // ── 会话生命周期 ──
  enter(isAR) {
    this.active = true;
    this.isAR = isAR;
    if (!isAR) this.loadStandingPoster();
    this.bs.enterXRLayout(this.boardRig.node, isAR);
    if (!isAR) this.bs.scene.background = this.immersiveBackground();
    this.nextPoseAt = 0;
    loadXRControlArt().then(() => this.applyControlArt());
    this.applyBoardSize();
    this.applyHandOpacity();
    this.clearNotice();
    this.settingsOpen = false;
    this.settingsSignature = '';
    this.leaveArmedAt = -Infinity;
    this.lobbySignature = '';
    this.guideIndex = -1;
    this.calibFrames = 3;   // 等头部姿态就绪后再显示固定面板
    this.cardRowPlaced = false;
    this.updateLayout(this.cb.getGame());
    this.cardSig = ''; this.upgradeFor = null; this.endFor = null;
  }

  exit() {
    this.active = false;
    this.cb.onXRPose?.(null);
    this.poster.visible = false;
    this.errorPanel.mesh.visible = false;
    this.clearNotice();
    for (const st of this.inputs) {
      this.release(st, true);
      st.pinched = false;
      st.waitForOpen = false;
      st.handPoint = null;
      st.tracked = false;
      st.rayActive = st.rayTarget = false;
      st.handRay.present({ active: false });
    }
    this.arbiter = new HandArbiter();
    this.palmMenu.hide();
    this.settingsOpen = false;
    this.settings.visible = false;
    this.endBoardGesture();
    this.bothPinchTime = 0;
    this.bs.world.visible = true;
    this.lobby.visible = false;
    this.bs.exitXRLayout();
    this.bs.showPlacement(null);
    this.placementHint.mesh.visible = false;
    this.resetReturningCards();
    this.ui.visible = false;
    this.anchor.position.set(0, 0, 0);
    this.anchor.rotation.set(0, 0, 0);
  }

  // 以当前头部位置 + 水平朝向放置 anchor
  recenter(headPos, headDir) {
    this.pauseInput();
    if (!headPos) {
      const cam = this.renderer.xr.getCamera();
      headPos = cam.getWorldPosition(new THREE.Vector3());
      headDir = cam.getWorldDirection(new THREE.Vector3());
    }
    this.anchor.position.copy(headPos);
    this.anchor.rotation.set(0, Math.atan2(-headDir.x, -headDir.z), 0);
    this.anchor.updateMatrixWorld(true);
  }

  // ── 每帧 ──
  // 回收区文字随语言切换重画
  drawTrash() {
    const { ctx, tex } = this.trash;
    this.trashLang = getLang();
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(60,20,24,.85)';
    ctx.beginPath(); ctx.arc(128, 128, 118, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ff6a5a'; ctx.lineWidth = 8; ctx.setLineDash([18, 12]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffb4aa'; ctx.textAlign = 'center';
    const art = uiArt('ui_discard');
    if (art) ctx.drawImage(art.img, 83, 39, 90, 90);
    else { ctx.font = 'bold 56px sans-serif'; ctx.fillText('✕', 128, 125); }
    ctx.font = '30px sans-serif'; ctx.fillText(t('trash', { n: DISCARD_COST }), 128, 180);
    tex.needsUpdate = true;
  }

  applyControlArt() {
    this.lobbySignature = '';
    this.drawTrash();
    const art = uiArt('xr-control-back');
    if (this.cardBacksReady || !art) return;
    this.cardBacksReady = true;

    const texture = new THREE.Texture(art.img);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: PANEL_ALPHA_TEST });
    for (const { mesh } of this.cards) {
      const frontMaterial = mesh.material.clone();
      frontMaterial.side = THREE.FrontSide;
      const front = new THREE.Mesh(mesh.geometry, frontMaterial);
      front.renderOrder = mesh.renderOrder;
      mesh.add(front);
      mesh.material.colorWrite = false;
      const back = new THREE.Mesh(mesh.geometry, material.clone());   // 每张牌一份(渐隐要单独改透明度,贴图共用)
      back.rotation.y = Math.PI;
      back.position.z = -0.001;
      back.renderOrder = mesh.renderOrder;
      mesh.add(back);
    }
    this.cardRowNoDepthTest();
  }

  // 手牌行的面板不做深度测试(仍写深度):凹凸的棋盘边框 / 地形 / 装饰挡不住手牌;
  // 半透明手在面板之后画、读深度,手和牌的前后遮挡不受影响
  cardRowNoDepthTest() {
    this.cardRow.traverse(o => { if (o.material) o.material.depthTest = false; });
  }

  immersiveBackground() {
    if (this.immersiveSky) return this.immersiveSky;
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const colors = ctx.createLinearGradient(0, 0, 0, canvas.height);
    colors.addColorStop(0, '#110e24');
    colors.addColorStop(0.47, '#241830');
    colors.addColorStop(0.72, '#181120');
    colors.addColorStop(1, '#100d18');
    ctx.fillStyle = colors;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let seed = 316;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 410; i++) {
      const x = 2 + random() * (canvas.width - 4), y = 40 + random() * 345;
      ctx.fillStyle = `rgba(211,184,245,${0.12 + random() * 0.45})`;
      ctx.fillRect(x, y, random() < .91 ? 1 : 2, 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    this.immersiveSky = texture;
    return texture;
  }

  loadStandingPoster() {
    if (this.posterRequested) return;
    this.posterRequested = true;
    new THREE.TextureLoader().load('assets/ui/brand/title-portrait.webp', texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const print = new THREE.Mesh(new THREE.PlaneGeometry(POSTER_WIDTH, POSTER_HEIGHT),
        new THREE.MeshBasicMaterial({ map: texture, color: 0xc5becf, toneMapped: false }));
      print.position.z = 0.006;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(POSTER_WIDTH + 0.025, POSTER_HEIGHT + 0.025, 0.009),
        new THREE.MeshBasicMaterial({ color: 0x51405e }));
      this.poster.add(frame, print);
    }, undefined, () => { this.posterRequested = false; });
  }

  applyBoardSize() {
    if (!this.active) return;
    const scale = BOARD_SCALES[this.cb.getBoardSize?.()] ?? BOARD_SCALES.standard;
    const halfDepth = ARENA.hz + ARENA.rim;
    const shift = Math.max(0, (scale - BOARD_SCALES.standard) * halfDepth);
    this.bs.world.scale.setScalar(scale);
    // 大档保持中档的近边位置，HUD 随远边后移，手牌与回收区留在原来的触及距离。
    this.bs.world.position.y = -BOARD_DROP;
    this.bs.world.position.z = -BOARD_CENTER_DISTANCE - shift;
    this.hud.mesh.position.z = -HUD_BASE_DISTANCE - shift - (scale - BOARD_SCALES.standard) * halfDepth;
    this.poster.position.set(0, -0.055, this.hud.mesh.position.z - POSTER_GAP);
    this.boardRig.apply();
    this.uiPivot.position.copy(this.bs.world.position);
    this.uiInner.position.copy(this.bs.world.position).negate();
    this.bs.world.updateMatrixWorld(true);
  }

  applyHandOpacity() {
    const opacity = HAND_OPACITY[this.cb.getBattleControls().handOpacity] ?? HAND_OPACITY.mid;
    for (const st of this.inputs) st.visual.setOpacity(opacity);
  }

  // 设置按钮两列排;按钮数为奇数时最后一个(关闭)居中放最下面
  layoutSettings() {
    this.settingsButtons.forEach((button, i) => {
      const last = i === this.settingsButtons.length - 1 && i % 2 === 0;
      button.mesh.position.set(last ? 0 : i % 2 ? 0.078 : -0.078, 0.025 - Math.floor(i / 2) * 0.056, 0);
    });
  }

  refreshSettings() {
    if (!this.settings.visible) return;
    const { muted, boardSize, handOpacity } = this.cb.getBattleControls();
    const hovered = this.hoverActions(this.settingsButtons);
    const signature = JSON.stringify([getLang(), muted, boardSize, handOpacity, [...hovered]]);
    if (signature === this.settingsSignature) return;
    this.settingsSignature = signature;
    this.drawLobbyButton(this.settingsHeader, t('settings'));
    const labels = {
      size: [t('xrBoardSize'), t('xrBoard_' + boardSize)],
      sound: [t('xrSound'), t(muted ? 'xrOff' : 'xrOn')],
      hand: [t('xrHandOpacity'), t('xrHand_' + handOpacity)],
      view: [t('xrViewReset')],
      close: [t('close')],
    };
    const icons = { size: 'size', sound: 'sound', view: 'center' };
    for (const button of this.settingsButtons) {
      const [label, detail] = labels[button.action];
      this.drawLobbyButton(button, label, detail, hovered.has(button.action), icons[button.action] ?? null);
    }
  }

  settingsAction(action) {
    if (action === 'close') this.settingsOpen = false;
    else if (action === 'view') {
      this.boardRig.reset();
      this.cb.onToast?.(t('tViewReset'));
    } else this.cb.onBattleAction(action);   // size / sound / hand
    this.settingsSignature = '';
  }

  // 手心菜单按钮
  palmAction(id) {
    const game = this.cb.getGame();
    if (id === 'center') {
      this.recenter();
      this.cb.onToast?.(t('tRecentered'));
    } else if (id === 'pause') this.cb.onPause?.(!this.cb.isPaused?.());
    else if (id === 'settings') {
      this.settingsOpen = !this.settingsOpen;
      this.settingsSignature = '';
    } else if (id === 'exitxr') this.cb.onBattleAction('exitxr');
    else if (id === 'leave' && game) this.requestLeave(game);
  }

  // 退出对局(手心菜单):结算阶段直接回大厅;其它阶段两段确认——第一次点按钮变红,3 秒内再点才离开(联机离开 = 判负)
  requestLeave(game) {
    if (game.phase === 'end') { this.cb.onLobbyAction('home'); return; }
    if (!this.leaveArmed()) {
      this.leaveArmedAt = performance.now();
      this.leaveArmedGame = game;
      return;
    }
    this.leaveArmedAt = -Infinity;
    this.cb.onBattleAction('leave');
  }

  leaveArmed() {
    return this.leaveArmedGame === this.cb.getGame() && performance.now() - this.leaveArmedAt < 3000;
  }

  // 主循环某一帧出错:显示 15 秒(错误信息 + 出错位置),用户截图带回
  showError(message, where = '') {
    const { ctx, canvas, tex } = this.errorPanel;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(64,20,28,0.95)';
    ctx.beginPath(); ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 24); ctx.fill();
    ctx.strokeStyle = '#ff8b7f'; ctx.lineWidth = 6; ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffe9e3'; ctx.font = 'bold 40px sans-serif';
    ctx.fillText(t('xrErrorTitle'), 32, 62, canvas.width - 64);
    ctx.font = '32px monospace';
    wrapText(ctx, message, 32, 116, canvas.width - 64, 40, 2);
    ctx.fillStyle = '#ffb9b2'; ctx.font = '26px monospace';
    ctx.fillText(where.slice(0, 90), 32, 250, canvas.width - 64);
    tex.needsUpdate = true;
    this.errorUntil = performance.now() + 15000;
  }

  notify(text) {
    this.notice = { text, until: performance.now() + 3200 };
    this.hudTimer = 0;
  }

  clearNotice() {
    this.notice = null;
    this.hudTimer = 0;
  }

  hoverActions(panels) {
    const hovered = new Set();
    for (const st of this.inputs) {
      if (!st.connected || st.grab) continue;
      const ray = st.isHand ? (st.rayActive ? st.ray : null) : this.ctrlRay(st);
      const target = this.lobbyTarget(panels, ray ? null : st.handPoint, ray);
      if (target) hovered.add(target.action);
    }
    return hovered;
  }

  updateLayout(game) {
    const ready = this.calibFrames === 0;
    this.lobby.visible = ready && !game && !this.settingsOpen;
    this.settings.visible = ready && this.settingsOpen;
    this.ui.visible = ready && Boolean(game);
    this.bs.world.visible = ready && Boolean(game);
    this.poster.visible = this.active && ready && !this.isAR && Boolean(game) && this.poster.children.length > 0;
    if (game && this.cb.hasOnlineOpponent?.()) {
      this.poster.position.x = -0.49;
      this.poster.position.z = Math.min(this.hud.mesh.position.z - POSTER_GAP, 2 * this.bs.world.position.z - 0.48);
    } else {
      this.poster.position.x = 0;
      this.poster.position.z = this.hud.mesh.position.z - POSTER_GAP;
    }
  }

  drawLobbyButton(panel, label, detail = '', hovered = false, icon = null) {
    const { ctx, canvas, tex, action } = panel;
    const { width: w, height: h } = canvas;
    const primary = action === 'quick';
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, primary ? '#ffe6a1' : hovered ? '#826b9d' : '#67567f');
    gradient.addColorStop(1, primary ? '#e39c3e' : '#382d50');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(5, 5, w - 10, h - 10, 26);
    ctx.fill();
    ctx.strokeStyle = hovered ? '#ffffff' : '#e5b573';
    ctx.lineWidth = hovered ? 10 : 5;
    ctx.stroke();
    const art = icon && uiArt('xr-control-' + icon);
    const iconSize = Math.min(h * 0.52, w * 0.21);
    const textCenter = art ? (w + iconSize + 14) / 2 : w / 2;
    const textWidth = w - 40 - (art ? iconSize + 14 : 0);
    if (art) ctx.drawImage(art.img, 16, (h - iconSize) / 2, iconSize, iconSize);
    ctx.fillStyle = primary ? '#2a1729' : '#fff3de';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 48px sans-serif';
    ctx.fillText(label, textCenter, detail ? h * 0.37 : h / 2, textWidth);
    if (detail) {
      ctx.font = '36px sans-serif';
      ctx.fillText(detail, textCenter, h * 0.73, textWidth);
    }
    tex.needsUpdate = true;
  }

  canUseInput() {
    return this.active && this.calibFrames === 0 && this.inputResumeFrames === 0;
  }

  pauseInput() {
    this.inputResumeFrames = 2;
    for (const st of this.inputs) this.loseHandTracking(st);
  }

  isVisibleForInput(mesh) {
    for (let object = mesh; object; object = object.parent) {
      if (!object.visible) return false;
    }
    return true;
  }

  lobbyTarget(panels, point, ray) {
    if (!ray && !point) return;
    let nearest;
    let distance = Infinity;
    for (const panel of panels) {
      const { mesh } = panel;
      if (!this.isVisibleForInput(mesh)) continue;
      const local = mesh.worldToLocal((ray ? ray.origin : point).clone());
      let depth = Math.abs(local.z);
      if (ray) {
        const next = mesh.worldToLocal(ray.at(1, new THREE.Vector3()));
        const direction = next.sub(local);
        if (Math.abs(direction.z) < 1e-6) continue;
        depth = -local.z / direction.z;
        if (depth < 0) continue;
        local.addScaledVector(direction, depth);
      } else if (depth > 0.048) continue;
      const { width, height } = mesh.geometry.parameters;
      if (Math.abs(local.x) <= width / 2 && Math.abs(local.y) <= height / 2 && depth < distance) {
        nearest = panel;
        distance = depth;
      }
    }
    return nearest;
  }

  refreshGuide() {
    const step = XR_GUIDE[this.guideIndex];
    this.guideButtons[0].mesh.visible = this.guideIndex > 0;
    const hovered = this.hoverActions(this.guideButtons);
    const art = uiArt('guide-' + step.id);
    const signature = JSON.stringify(['guide', getLang(), this.guideIndex, Boolean(art), [...hovered]]);
    if (signature === this.lobbySignature) return;
    this.lobbySignature = signature;
    if (!art) loadXRGuideArt(step);
    const { ctx, tex } = this.guidePanel;
    ctx.clearRect(0, 0, 1020, 732);
    ctx.fillStyle = '#41344f';
    ctx.beginPath(); ctx.roundRect(4, 4, 1012, 724, 24); ctx.fill();
    ctx.strokeStyle = '#e5b573'; ctx.lineWidth = 5; ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff1c0';
    ctx.font = 'bold 52px sans-serif';
    ctx.fillText(`${this.guideIndex + 1}/${XR_GUIDE.length} · ${t('guide_' + step.id)}`, 510, 73, 940);
    if (art) ctx.drawImage(art.img, 173, 100, 674, 449);
    ctx.fillStyle = '#fff3de';
    ctx.font = '40px sans-serif';
    wrapText(ctx, t('guideDesc_' + step.id), 510, 603, 900, 48, 2);
    tex.needsUpdate = true;
    const labels = ['guidePrev', 'close', this.guideIndex === XR_GUIDE.length - 1 ? 'guideDone' : 'guideNext'];
    this.guideButtons.forEach((button, i) => this.drawLobbyButton(button, t(labels[i]), '', hovered.has(button.action)));
  }

  refreshLobby() {
    const guiding = this.guideIndex >= 0;
    this.guideGroup.visible = guiding;
    this.lobbyHeader.mesh.visible = !guiding;
    this.lobbyButtons.forEach(button => { button.mesh.visible = !guiding; });
    if (guiding) { this.refreshGuide(); return; }
    const state = this.cb.getLobby();
    const hovered = this.hoverActions(this.lobbyButtons);
    const signature = JSON.stringify([getLang(), state, [...hovered], this.notice?.text]);
    if (signature === this.lobbySignature) return;
    this.lobbySignature = signature;
    const { ctx, tex } = this.lobbyHeader;
    ctx.clearRect(0, 0, 1024, 262);
    ctx.fillStyle = '#41344f';
    ctx.beginPath();
    ctx.roundRect(4, 4, 1016, 254, 24);
    ctx.fill();
    ctx.strokeStyle = '#e5b573';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff1c0';
    ctx.font = 'bold 88px sans-serif';
    ctx.fillText(t('title'), 512, 118, 940);
    ctx.font = '44px sans-serif';
    ctx.fillText(this.notice?.text || t(state.loading ? 'tLoadingField' : 'xrLobbyHint'), 512, 198, 940);
    tex.needsUpdate = true;
    const labels = [
      [t(state.loading ? 'tLoadingField' : 'quickBattle')],
      [t('xrFaction'), state.faction],
      [t('xrArena'), state.field],
      [t(state.muted ? 'xrSoundOff' : 'xrSoundOn')],
      [t('xrCenter')],
      [t('xrGuide')],
      [t('xrExit')],
    ];
    this.lobbyButtons.forEach((button, i) => {
      const [label, detail] = labels[i];
      this.drawLobbyButton(button, label, detail, hovered.has(button.action), button.action === 'exit' ? 'leave' : button.action);
    });
  }

  update(dt) {
    if (!this.active) return;
    this.errorPanel.mesh.visible = performance.now() < this.errorUntil;
    if (this.notice && performance.now() >= this.notice.until) this.clearNotice();
    if (this.trashLang !== getLang()) this.drawTrash();
    if (this.calibFrames > 0 && --this.calibFrames === 0) this.recenter();

    const game = this.cb.getGame();
    if (this.returnGame !== game || !['battle', 'prep'].includes(game?.phase)) {
      this.resetReturningCards();
      this.returnGame = game;
    }
    // 换局 / 换阶段时清掉进行中的输入;准备 → 开战不清(准备阶段拖着的牌开战后可以直接放下)
    const prepToBattle = this.inputGame === game && this.inputPhase === 'prep' && game?.phase === 'battle';
    if (this.inputGame !== game || (this.inputPhase !== game?.phase && !prepToBattle)) {
      if (game && game !== this.inputGame && game.phase === 'battle') this.palmHintUntil = performance.now() + 20000;
      this.inputGame = game;
      this.inputPhase = game?.phase;
      this.pauseInput();
    }
    this.updateLayout(game);
    if (this.calibFrames > 0) return;
    const inputReady = this.inputResumeFrames === 0;
    if (!inputReady) this.inputResumeFrames--;

    for (const st of this.inputs) this.updateHandVisual(st, game);
    for (const st of inputReady ? this.inputs : []) {
      if (st.isHand) this.readHand(st, dt);
      else {
        if (!st.connected) continue;
        const ray = this.ctrlRay(st);
        if (st.grab) this.dragRay(st, ray);
        else st.hover = ['battle', 'prep'].includes(game?.phase) ? this.pick(this.cards, null, ray) : -1;
      }
    }
    if (inputReady) {
      this.updatePointers(dt, game);
      for (const st of this.inputs) {
        if (!st.isHand || !st.tracked) continue;
        this.handInput(st, st.pinchDist, st.pinchPoint);
        // 捏合瞬间射线会跳:点击用上一帧(还没捏上时)的射线
        if (st.rayActive && !st.pinched && st.ray) { st.pressRay.copy(st.ray); st.pressDwell = st.dwell; }
      }
    }
    this.updateBoardGesture(dt);
    this.updateUiSide(dt);
    this.updateCardRow(dt);
    this.updatePalmMenu(dt, inputReady);
    this.refreshSettings();
    if (!game) { this.refreshLobby(); return; }
    this.refreshPanels(game, dt);
    if (game.phase !== 'end') this.sendLocalPose();
    this.animateReturningCards(dt);
    this.placementHint.mesh.visible = false;

    // 落点预览(攻击/作用范围圈)跟随当前拖拽
    const grab = this.inputs.find(s => s.grab)?.grab;
    this.trash.mesh.material.opacity = grab ? (grab.trash ? 1 : 0.75) : 0.35;
    const card = grab && game.p.hand.find(c => c.id === grab.id);
    this.dropLink.visible = Boolean(card && grab.hit && grab.from && !grab.viaRay);
    if (this.dropLink.visible) {
      const link = this.dropLink.geometry.attributes.position;
      link.setXYZ(0, grab.from.x, grab.from.y, grab.from.z);
      link.setXYZ(1, grab.hit.point.x, grab.hit.point.y, grab.hit.point.z);
      link.needsUpdate = true;
      this.dropLink.computeLineDistances();
    }
    if (card && !grab.trash) {
      const hit = grab.hit;
      const reason = hit ? game.deployBlockReason('p', card, hit.x, hit.z) : null;
      this.bs.showPlacement({
        ...hit, game, card, showDeployZone: isPlaced(card), isUnit: card.type !== 'spell',
        radius: previewRadius(card), valid: !reason,
      });
      if (reason) this.showPlacementHint(reason, hit.point);
      // 没有落点(出界 / 太高 / 射线没打到台面):拖离原槽位、连续 0.3s 没落点后提示「超出战场」,不再静默(批注 P2-4);
      // 等 0.3s 是为了从手牌行伸向棋盘的途中不闪红字
      const out = !hit && !this.nearHome(grab);
      grab.outSince = out ? grab.outSince ?? performance.now() : null;
      if (out && performance.now() - grab.outSince > OUT_HINT_DELAY_MS) {
        this.showPlacementHint('xrOutOfArena', this.cards[grab.idx].mesh.getWorldPosition(new THREE.Vector3()));
      }
    } else {
      const guide = this.cb.getFirstMatch?.();
      const starter = guide?.step === 'deploy' && game.p.hand.find(card => card.id === guide.cardId);
      this.bs.showPlacement(starter ? { game, card: starter, showDeployZone: true } : null);
    }
  }

  updatePalmMenu(dt, inputReady) {
    const hand = side => this.inputs.find(s => s.isHand && s.connected && s.side === side);
    const left = hand('left'), right = hand('right');
    const tipJoint = right?.hand.joints?.['index-finger-tip'];
    const tip = right && !right.grab && right.handPoint && tipJoint && tipJoint.visible !== false
      ? tipJoint.getWorldPosition(new THREE.Vector3()) : null;
    const poked = this.palmMenu.update(dt, {
      hand: left?.hand,
      head: this.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3()),
      allowed: inputReady && !this.inputs.some(s => s.grab) && !this.boardRig.active,
      tip,
      hoverRay: right?.rayActive ? right.ray : null,
    });
    if (poked && this.canUseInput()) this.palmAction(poked);
  }

  sendLocalPose() {
    if (!this.renderer.xr.isPresenting || !this.cb.hasOnlineOpponent?.()) return;
    const now = performance.now();
    if (now < this.nextPoseAt) return;
    this.nextPoseAt = now + XR_POSE_INTERVAL;
    const camera = this.renderer.xr.getCamera();
    // 姿态在 boardRig 坐标里算(没操控时就是 anchor 坐标):双手挪过战场后,对手看到的手仍落在同一格上
    const rig = this.boardRig.node;
    const invAnchor = rig.getWorldQuaternion(new THREE.Quaternion()).invert();
    const ratio = BOARD_SCALES.standard / this.bs.world.scale.x;
    const boardZ = this.bs.world.position.z;
    const pack = (point, rotation, grip = false) => {
      const local = rig.worldToLocal(point);
      // Normalize the table coordinates so both players can point at the same cell at different tabletop sizes.
      local.x *= ratio;
      local.z = (local.z - boardZ) * ratio - BOARD_CENTER_DISTANCE;
      return [...local.toArray(), ...invAnchor.clone().multiply(rotation).normalize().toArray(), grip ? 1 : 0]
        .map(value => Math.round(value * 1000) / 1000);
    };
    const pose = [pack(camera.getWorldPosition(new THREE.Vector3()), camera.getWorldQuaternion(new THREE.Quaternion())), null, null];
    for (const st of this.inputs) {
      if (!st.connected) continue;
      // 姿态固定 3 格:头 / 左手 / 右手。不分左右的输入(handedness 为 none)填空着的那格,两格都占了就跳过,
      // 不能写到 pose[3](数组变长会被 validXRPose 整包拒掉)
      const slot = st.side === 'left' ? 1 : st.side === 'right' ? 2 : !pose[1] ? 1 : !pose[2] ? 2 : 0;
      if (!slot) continue;
      if (st.isHand) {
        const wrist = st.hand.joints?.wrist;
        if (!st.handPoint || !wrist || wrist.visible === false) continue;
        const point = wrist.getWorldPosition(new THREE.Vector3());
        const rotation = this.handFacing(st, point) ?? wrist.getWorldQuaternion(new THREE.Quaternion());
        pose[slot] = pack(point, rotation, st.pinched);
      } else if (st.ctrl.visible) {
        pose[slot] = pack(st.ctrl.getWorldPosition(new THREE.Vector3()), st.ctrl.getWorldQuaternion(new THREE.Quaternion()), Boolean(st.grab));
      }
    }
    const inSeat = pose.map((part, index) => xrPartInSeat(part, index) ? part : null);
    this.cb.onXRPose?.(inSeat.some(Boolean) ? inSeat : null);
  }

  handFacing(st, wrist) {
    const world = name => {
      const joint = st.hand.joints?.[name];
      return joint && joint.visible !== false ? joint.getWorldPosition(new THREE.Vector3()) : null;
    };
    const mid = world('middle-finger-phalanx-proximal');
    const index = world('index-finger-phalanx-proximal');
    const pinky = world('pinky-finger-phalanx-proximal');
    if (!mid || !index || !pinky) return null;
    const z = wrist.clone().sub(mid);
    const x = (st.side === 'left' ? pinky.sub(index) : index.sub(pinky));
    if (z.lengthSq() < 1e-6 || x.lengthSq() < 1e-6) return null;
    z.normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    if (y.lengthSq() < 1e-6) return null;
    y.normalize();
    x.crossVectors(y, z).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }

  receiveRemotePose(pose) {
    this.remotePose = pose ? { pose, at: performance.now() } : null;
  }

  updateRemoteAvatar(dt, game) {
    if (this.remotePose && performance.now() - this.remotePose.at >= XR_POSE_TIMEOUT) this.remotePose = null;
    if (!game) { this.opponentAvatar?.hide(); return; }
    const visible = this.cb.hasOnlineOpponent?.() && game.phase !== 'end' && this.remotePose
      && (!this.active || this.calibFrames === 0);
    if (!visible) { this.opponentAvatar?.update(null, dt); return; }
    this.opponentAvatar ??= new XROpponentAvatar();
    const { root } = this.opponentAvatar;
    const parent = this.active ? this.boardRig.node : this.bs.world;   // 对手跟着战场走
    if (root.parent !== parent) parent.add(root);
    if (this.active) {
      root.position.set(0, 0, 2 * this.bs.world.position.z);
      root.scale.setScalar(1);
    } else {
      root.position.set(0, 1.95, -ARENA.hz + 0.7);
      root.scale.setScalar(4.5);
    }
    root.rotation.y = Math.PI;
    const ratio = this.active ? this.bs.world.scale.x / BOARD_SCALES.standard : 1;
    const seatOffset = this.active ? BOARD_CENTER_DISTANCE * ratio + this.bs.world.position.z : 0;
    const eye = this.renderer.xr.isPresenting
      ? this.boardRig.node.worldToLocal(this.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3()))
      : new THREE.Vector3();
    const hud = this.hud.mesh.position;   // HUD 和对手都在 boardRig 坐标里
    const mayShow = (point, index) => {
      if (!this.active) return point.z >= -.91;
      const z = root.position.z - point.z;
      const depthMargin = index === 0 ? .12 : .08;
      if (z + depthMargin > this.bs.world.position.z) return false;
      if (!this.hud.mesh.visible || z + depthMargin < hud.z || eye.z <= hud.z + .05) return true;
      const projection = Math.max(0, (eye.z - z) / (eye.z - hud.z));
      const centerX = eye.x + (hud.x - eye.x) * projection;
      const height = eye.y + (hud.y - eye.y) * projection;
      const radius = index === 0 ? .09 : .035;
      return Math.abs(-point.x - centerX) > .21 * projection + radius
        || Math.abs(point.y - height) > .0525 * projection + radius;
    };
    this.opponentAvatar.update(this.remotePose.pose, dt, ratio, seatOffset, mayShow);
  }

  // 半透明手:glb 到了换材质;捏合边缘变亮、抓着牌换势力色
  updateHandVisual(st, game) {
    st.visual.update();
    const card = st.grab && game?.p.hand.find(c => c.id === st.grab.id);
    st.visual.setState(st.grab ? 'grab' : st.pinched ? 'pinch' : 'idle', card ? FACTIONS[card.faction].color : null);
  }

  loseHandTracking(st) {
    st.waitForOpen ||= st.pinched || Boolean(st.grab);
    this.release(st, false, true);   // 不直接取消:150ms 内有合法落点就照出(第七轮,批注 P2-2)
    st.pinched = false;
    st.hover = -1;
    st.handPoint = null;
    st.tracked = false;
    st.ray = null;
    st.rayActive = st.rayTarget = false;
    st.handRay.present({ active: false });
  }

  readHand(st, dt) {
    const tip = st.hand.joints?.['index-finger-tip'];
    const thumb = st.hand.joints?.['thumb-tip'];
    if (!tip || !thumb || !st.connected || st.hand.visible === false || tip.visible === false || thumb.visible === false) {
      this.loseHandTracking(st);
      return;
    }
    const a = tip.getWorldPosition(new THREE.Vector3());
    const b = thumb.getWorldPosition(new THREE.Vector3());
    st.tracked = true;
    st.pinchDist = a.distanceTo(b);
    st.pinchPoint.copy(a.add(b).multiplyScalar(0.5));
    st.ray = st.handRay.aim(st.ctrl, dt);
  }

  // ── 手部射线 ──
  // 射线能点的面板:大厅 / 教学按钮、战斗按钮、首局引导、强化、结算、设置、手牌(射线可以抓牌拖到战场)
  rayPanels(game) {
    const settings = this.settingsOpen ? this.settingsButtons : [];
    if (!game) return [...(this.guideIndex >= 0 ? this.guideButtons : this.lobbyButtons), ...settings];
    if (game.phase === 'upgrade') return [...this.upgrades, ...settings];
    if (game.phase === 'end') return [this.endPanel, this.lobbyReturn, ...settings];
    return [...this.firstMatchButtons, ...this.cards, ...settings];
  }


  // 每帧给两只手分配指针:近手(离按钮面板 15cm 内,离开 22cm 才算远;或捏合点 12cm 内有手牌可磁吸)、
  // 近手抓着牌、手没举到头前区域的不指(射线指着手牌时例外:手牌任意距离都能用射线选,第七轮);
  // 剩下的交给 HandArbiter 选一只。只有可点的目标(rayPanels + 手心菜单)才让光标贴上、射线淡入,
  // 信息面板(HUD、提示、说明条)不吸射线;空指时光标圈和射线都隐藏(来回晃"找光标"时例外)
  updatePointers(dt, game) {
    const panels = this.rayPanels(game);
    const close = panels.filter(p => !this.cards.includes(p));   // 手牌不走 15/22cm 近手区,改用磁吸半径
    const menuOpen = this.palmMenu.open;
    const camera = this.renderer.xr.getCamera();
    const head = { pos: camera.getWorldPosition(new THREE.Vector3()), q: camera.getWorldQuaternion(new THREE.Quaternion()) };
    const hands = this.inputs.filter(st => st.isHand && st.tracked);
    const candidates = {};
    for (const st of hands) {
      const menuNear = menuOpen && st.side !== 'left' && st.handPoint
        && this.palmMenu.mesh.position.distanceTo(st.handPoint) < RAY_NEAR;
      const margin = st.near ? RAY_FAR : RAY_NEAR;
      const magnet = Boolean(st.handPoint) && this.pick(this.cards, st.handPoint) >= 0;   // 磁吸优先于射线
      st.near = st.grab ? !st.grab.viaRay
        : Boolean(st.handPoint && (magnet || this.nearPanels(st.handPoint, close, margin) || menuNear));
      const side = st.side === 'left' || st.side === 'right' ? st.side : st.i ? 'right' : 'left';
      const raised = st.ray && (st.grab?.viaRay || this.pick(this.cards, null, st.ray) >= 0
        || inPointingZone(st.ray.origin.clone().sub(head.pos).applyQuaternion(head.q.clone().invert())));
      if (st.ray && raised && !st.near && !this.rayBlocked(st)) {
        const { x, y, z } = st.ray.origin;   // 拷一份:ray 是每帧原地更新的,arbiter 要存上一帧的位置
        candidates[side] = { st, palm: { x, y, z }, pinch: st.pinchDist < PINCH_ON, interacting: st.rayTarget || Boolean(st.grab) };
      }
    }
    const result = this.arbiter.update(candidates, head, dt);
    const now = performance.now();
    for (const st of hands) {
      const mine = Object.entries(candidates).find(([, c]) => c.st === st);
      st.rayActive = Boolean(mine) && mine[0] === result.active;
      if (st.rayActive && result.stole) st.waitForOpen = true;   // 捏一下抢过来:这一下不算点击
      let hit = null;
      st.rayTarget = false;
      if (st.rayActive && st.grab?.viaRay) {
        hit = st.grab.hit ? { distance: st.grab.hit.point.distanceTo(st.ray.origin) } : null;
      } else if (st.rayActive) {
        hit = this.rayPanelHit(panels, st.ray);
        const menuHit = menuOpen && st.side !== 'left' && this.palmMenu.rayHit(st.ray);
        if (menuHit && (!hit || menuHit.distance < hit.distance)) hit = menuHit;
        st.rayTarget = Boolean(hit);
      }
      // 悬停计时:同一个目标上连续指着才累计,换目标 / 没指着清零
      const object = st.rayTarget ? hit.object : null;
      st.dwell = object && object === st.dwellObject ? st.dwell + dt : 0;
      st.dwellObject = object;
      st.handRay.present({ active: st.rayActive, hitDistance: hit?.distance ?? null, headQ: head.q, now, dt, pinched: st.pinched });
    }
  }

  rayPanelHit(panels, ray) {
    const meshes = panels.map(p => p.mesh).filter(mesh => this.isVisibleForInput(mesh));
    this.raycaster.set(ray.origin, ray.direction);
    return this.raycaster.intersectObjects(meshes, false)[0] ?? null;
  }

  // 点是否在任一可见面板的 margin 范围内(面板本地坐标里的盒子)
  nearPanels(point, panels, margin) {
    return panels.some(({ mesh }) => {
      if (!this.isVisibleForInput(mesh)) return false;
      const local = mesh.worldToLocal(point.clone());
      const { width, height } = mesh.geometry.parameters;
      return Math.abs(local.z) < margin && Math.abs(local.x) < width / 2 + margin && Math.abs(local.y) < height / 2 + margin;
    });
  }

  // 手心菜单出现时左手射线隐藏
  rayBlocked(st) {
    return st.side === 'left' && this.palmMenu.open;
  }

  // 手部输入核心(与设备解耦,便于桌面端模拟测试)
  handInput(st, dist, point) {
    if (!Number.isFinite(dist) || !Number.isFinite(point.x + point.y + point.z)) {
      this.loseHandTracking(st);
      return;
    }
    st.point.copy(point);
    st.handPoint = st.point;
    if (st.waitForOpen) {
      if (dist > PINCH_OFF) st.waitForOpen = false;
    } else if (!st.pinched && dist < PINCH_ON) {
      st.pinched = true;
      if (st.rayActive) {
        // 按钮要悬停满 RAY_DWELL;射线指着手牌直接抓(第七轮),用捏合前一帧的射线快照
        if (st.pressDwell >= RAY_DWELL) this.press(st, null, st.pressRay, true);
        else if (this.pick(this.cards, null, st.pressRay) >= 0) this.press(st, null, st.pressRay, true, true);
      }
      else this.press(st, point, null);
    } else if (st.pinched && dist > PINCH_OFF) {
      st.pinched = false;
      const ready = this.canUseInput();
      if (st.grab && ready) this.dragHand(st, point);
      this.release(st, !ready);
    } else if (st.pinched && st.grab) {
      this.dragHand(st, point);
      // 射线拖牌:手指还捏紧时记下落点;开始张开(进入 2.2–3.8cm 回差带)后射线会跳,松手优先用这个(批注 P2-3)
      const g = st.grab;
      if (g?.viaRay && dist < PINCH_ON) g.firm = { hit: g.hit, valid: g.valid, at: performance.now() };
    }
    if (!st.pinched) {
      const game = this.cb.getGame();
      st.hover = !['battle', 'prep'].includes(game?.phase) ? -1
        : st.rayActive && st.ray ? this.pick(this.cards, null, st.ray)
        : this.pick(this.cards, point, null, GRAB_RADIUS);   // 与抓取同半径:亮了就抓得起
    }
  }

  // 射线抓的牌跟着射线在战场平面上的落点走;近手抓的牌跟着捏合点走
  dragHand(st, point) {
    if (!st.grab.viaRay) this.dragPoint(st, point);
    else if (st.ray) this.dragRay(st, st.ray);
  }

  // 在一组面板中挑中目标:点模式取最近中心,射线模式取射线命中
  pick(panels, point, ray, radius = GRAB_RADIUS) {
    const meshes = panels.map(p => p.mesh).filter(mesh => this.isVisibleForInput(mesh));
    if (ray) {
      this.raycaster.set(ray.origin, ray.direction);
      const hit = this.raycaster.intersectObjects(meshes, false)[0];
      return hit ? hit.object.userData.idx : -1;
    }
    const best = nearestWithin(meshes.map(m => m.getWorldPosition(new THREE.Vector3())), point, radius);
    return best < 0 ? -1 : meshes[best].userData.idx;
  }

  // fromHandRay:手部射线点的(抓到的牌之后跟着射线拖);cardsOnly:只抓手牌,不点按钮(射线没悬停够时)
  press(st, point, ray, fromHandRay = false, cardsOnly = false) {
    if (!this.canUseInput()) return;
    if (st.isHand && st.side === 'left' && this.palmMenu.open) return;   // 菜单出现时左手捏合被菜单吃掉
    if (fromHandRay && !cardsOnly) {
      const id = this.palmMenu.pick(ray);
      if (id !== null) { if (id) this.palmAction(id); return; }
    }
    if (this.settings.visible && !cardsOnly) {
      const target = this.lobbyTarget(this.settingsButtons, point, ray);
      if (target) { this.settingsAction(target.action); return; }
    }
    const game = this.cb.getGame();
    if (game && !this.ui.visible) return;
    if (!game) {
      if (!this.lobby.visible || cardsOnly) return;
      if (this.guideIndex >= 0) {
        const action = this.lobbyTarget(this.guideButtons, point, ray)?.action;
        if (action === 'previous' && this.guideIndex > 0) this.guideIndex--;
        if (action === 'next') this.guideIndex = this.guideIndex < XR_GUIDE.length - 1 ? this.guideIndex + 1 : -1;
        if (action === 'close') this.guideIndex = -1;
        return;
      }
      const target = this.lobbyTarget(this.lobbyButtons, point, ray);
      if (target?.action === 'guide') { this.guideIndex = 0; return; }
      if (target?.action === 'center') { this.recenter(); this.cb.onToast?.(t('tRecentered')); }
      else if (target && (!this.cb.getLobby().loading || target.action === 'exit')) this.cb.onLobbyAction(target.action);
      return;
    }
    if (game.phase === 'upgrade') {
      if (game.upgrade?.picked?.p || cardsOnly) return;
      const i = this.pick(this.upgrades, point, ray, UPGRADE_PICK_RADIUS);
      if (i >= 0) this.cb.onUpgrade(i);
      return;
    }
    if (game.phase === 'end') {
      if (cardsOnly) return;
      if (this.lobbyReturn.mesh.visible && this.lobbyTarget([this.lobbyReturn], point, ray)) {
        this.cb.onLobbyAction('home');
        return;
      }
      const hit = ray
        ? this.rayHits(this.endPanel.mesh, ray)
        : this.endPanel.mesh.getWorldPosition(new THREE.Vector3()).distanceTo(point) < 0.14;
      if (hit) this.cb.onRestart();
      return;
    }
    const guide = this.cb.getFirstMatch?.();
    if (guide && this.firstMatchControls.visible) {
      const action = cardsOnly ? null : this.lobbyTarget(this.firstMatchButtons, point, ray)?.action;
      if (action === 'skip' || (action === 'start' && guide.step === 'core')) {
        this.pauseInput();
        this.cb.onFirstMatchDone?.();
        return;
      }
      if (action === 'center') {
        this.recenter();
        this.cb.onToast?.(t('tRecentered'));
        return;
      }
      if (action === 'home') {
        this.pauseInput();
        this.cb.onLobbyAction?.('home');
        return;
      }
      if (guide.step !== 'deploy') return;
    }
    const idx = this.pick(this.cards, point, ray);
    if (idx < 0 || (guide && game.p.hand[idx]?.type !== 'unit')) return;
    if (this.inputs.some(o => o !== st && o.grab && o.grab.idx === idx)) return;
    // 买不起的牌也能拿起来比划,落下时 release 再提示「法力不足」并退回(第七轮,批注 C)
    this.cards[idx].returning = null;
    st.grab = { idx, id: game.p.hand[idx].id, game, hit: null, viaRay: fromHandRay };   // 记住所属对局:换局后松手不能在新局里出牌   // 记住卡牌 id:捏住期间手牌可能被快照校正而换位
  }

  rayHits(mesh, ray) {
    if (!this.isVisibleForInput(mesh)) return false;
    this.raycaster.set(ray.origin, ray.direction);
    return this.raycaster.intersectObject(mesh, false).length > 0;
  }

  dragPoint(st, point) {
    const g = st.grab;
    const mesh = this.cards[g.idx].mesh;
    mesh.position.copy(this.cardRow.worldToLocal(point.clone()));
    const boardY = this.bs.world.getWorldPosition(new THREE.Vector3()).y;
    const h = point.y - boardY;
    g.trash = this.trash.mesh.visible && this.trash.mesh.getWorldPosition(new THREE.Vector3()).distanceTo(point) < TRASH_RADIUS;
    // 落点前倾:沿"眼睛 → 手"的水平方向前推(forwardLean),每次调用平滑一点,牌本身仍跟着手
    const lean = forwardLean(this.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3()), point, boardY);
    g.lean ??= new THREE.Vector3();
    g.lean.lerp(new THREE.Vector3(lean.x, 0, lean.z), 0.35);
    g.from = point.clone();
    const aim = point.clone().add(g.lean);
    g.hit = this.snapPlacement(g, (!g.trash && h > -0.05 && h < DROP_MAX_HEIGHT) ? this.bs.worldPointToField(aim) : null);
    this.trackDrop(g);
  }

  // 记录落点是否合法(在战场内且 deployBlockReason 为空;法力不算),合法就刷新"最后合法落点"(批注 P2-1)
  trackDrop(g) {
    const game = this.cb.getGame();
    const card = game?.p.hand.find(c => c.id === g.id);
    g.valid = Boolean(g.hit && card && !game.deployBlockReason('p', card, g.hit.x, g.hit.z));
    if (g.valid) g.lastValid = { hit: g.hit, at: performance.now() };
  }

  // 牌是不是被放回了原来的槽位附近(近手看牌的位置,射线看射线离槽位多近):是就当"不出了",静默退回
  nearHome(g) {
    const p = this.cards[g.idx];
    const home = this.cardRow.localToWorld(p.home.clone());
    const at = g.lastRay   // 射线 / 手柄拖过的牌有 lastRay
      ? g.lastRay.closestPointToPoint(home, new THREE.Vector3())
      : p.mesh.getWorldPosition(new THREE.Vector3());
    return at.distanceTo(home) < PUT_BACK_RADIUS;
  }

  // 落点吸附:单位 / 建筑被岩石、墙、建筑挡住时就近找空位(game.nearestDeploySpot);装甲维修吸附受伤单位
  snapPlacement(g, hit) {
    const game = this.cb.getGame();
    const card = game?.p.hand.find(c => c.id === g.id);
    if (hit && card && isPlaced(card)) {
      const spot = game.nearestDeploySpot('p', card, hit.x, hit.z);
      if (spot) hit = { ...hit, x: spot.x, z: spot.z };
    }
    return this.snapHeal(g, hit);
  }

  // 装甲维修:落点吸附到最近的受伤己方单位(heal-snap.js),松手就在它身上释放;
  // hit.point 仍是手 / 射线的实际落点(牌和光标跟着它走),hit.x / z 换成吸附点
  snapHeal(g, hit) {
    const game = this.cb.getGame();
    const card = game?.p.hand.find(c => c.id === g.id);
    if (!hit || !autoTargets(card)) return hit;
    const heal = healSnap(game.units, 'p', card, hit.x, hit.z, g.healId);
    g.healId = heal.target?.id ?? null;
    return { ...hit, x: heal.x, z: heal.z, heal };
  }

  dragRay(st, ray) {
    const g = st.grab;
    const mesh = this.cards[g.idx].mesh;
    g.trash = this.trash.mesh.visible && this.rayHits(this.trash.mesh, ray);
    g.hit = g.trash ? null : this.snapPlacement(g, this.bs.rayToField(ray));
    g.lastRay = ray.clone();
    this.trackDrop(g);
    const target = g.hit
      ? g.hit.point.clone().add(new THREE.Vector3(0, 0.03, 0))
      : ray.origin.clone().addScaledVector(ray.direction, 0.4);
    mesh.position.copy(this.cardRow.worldToLocal(target));
  }

  ctrlRay(st) {
    const origin = st.ctrl.getWorldPosition(new THREE.Vector3());
    const rotation = st.ctrl.getWorldQuaternion(new THREE.Quaternion());
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation).normalize();
    return new THREE.Ray(origin, direction);
  }

  // lost:手部追踪丢失(手指张开时关节常短暂丢失)——不当取消,按 chooseDrop 的宽限规则决定出不出
  release(st, cancel = false, lost = false) {
    const g = st.grab;
    if (!g) return;
    st.grab = null;
    const p = this.cards[g.idx];
    const game = this.cb.getGame();
    const back = key => {   // 牌飞回手牌行;不出牌一定说明原因(放回原槽位除外)
      p.returning = { from: p.mesh.position.clone(), elapsed: 0 };
      if (key) this.cb.onToast?.(t(key));
    };
    if (!cancel && this.canUseInput() && game === g.game && game?.phase === 'prep') {   // 准备阶段:松手不出牌,牌飞回并提示
      back(g.hit ? 'tPrep' : lost ? 'tHandLost' : this.nearHome(g) ? null : 'tOutOfArena');
      return;
    }
    if (cancel || !this.canUseInput() || game !== g.game || game?.phase !== 'battle') {
      p.mesh.position.copy(p.home);
      return;
    }
    const idx = game.p.hand.findIndex(c => c.id === g.id);   // 按 id 重新定位;牌已不在手里就取消
    const card = game.p.hand[idx];
    if (card && g.trash && lost) { back('tHandLost'); return; }   // 追踪丢失时不弃牌(弃牌要花费)
    if (!card || g.trash) {
      p.mesh.position.copy(p.home);
      if (card) this.cb.onDiscard?.(idx);
      this.cardSig = '';
      return;
    }
    // 松手用哪个落点:射线捏紧快照 → 当前合法 → 150ms 内最后合法 → 不出(xr-math.js chooseDrop,批注 P2)
    const drop = chooseDrop({ current: lost ? null : { hit: g.hit, valid: g.valid }, firm: g.firm, lastValid: g.lastValid, now: performance.now() });
    const hit = drop.hit;
    if (!hit) {   // 落在战场外 = 取消出牌:牌飞回手牌行
      back(lost ? 'tHandLost' : this.nearHome(g) ? null : 'tOutOfArena');
      return;
    }
    const reason = !game.canPlay('p', idx) ? 'tNoMana' : game.deployBlockReason('p', card, hit.x, hit.z);
    if (reason || drop.from === 'blocked' || !this.cb.onPlay(idx, hit.x, hit.z)) {
      back(reason ?? (drop.from === 'blocked' ? 'tOutOfArena' : null));
      return;
    }
    p.mesh.position.copy(p.home);
    this.cardSig = '';                           // 手牌变了,强制重绘
  }

  showPlacementHint(reason, point) {
    const p = this.placementHint;
    const label = t(reason);
    if (p.label !== label) {
      p.label = label;
      const { ctx, canvas, tex } = p;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#40212c';
      ctx.beginPath(); ctx.roundRect(3, 3, canvas.width - 6, canvas.height - 6, 22); ctx.fill();
      ctx.strokeStyle = '#ff8b7f'; ctx.lineWidth = 6; ctx.stroke();
      ctx.font = 'bold 56px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffe9e3'; ctx.fillText(label, canvas.width / 2, canvas.height / 2, canvas.width - 46);
      tex.needsUpdate = true;
    }
    p.mesh.position.copy(this.ui.worldToLocal(point.clone()));
    p.mesh.position.y += 0.062;
    p.mesh.position.z += 0.025;
    p.mesh.visible = true;
  }

  animateReturningCards(dt) {
    for (const p of this.cards) {
      if (!p.returning) continue;
      p.returning.elapsed += dt;
      const fraction = Math.min(1, p.returning.elapsed / RETURN_SECONDS);
      p.mesh.position.lerpVectors(p.returning.from, p.home, 1 - (1 - fraction) ** 3);
      if (fraction === 1) p.returning = null;
    }
  }

  resetReturningCards() {
    for (const p of this.cards) {
      if (!p.returning) continue;
      p.returning = null;
      p.mesh.position.copy(p.home);
    }
  }

  // 双手空捏(没抓牌、没在用射线点按钮)保持 0.4s → 操控战场;松开任一只手结束,越界部分弹回边界
  updateBoardGesture(dt) {
    this.boardRig.tick(dt);
    const hands = this.inputs.filter(s => s.isHand && s.connected && s.handPoint);
    const both = hands.length === 2 && hands.every(s => s.pinched && !s.grab && !s.rayTarget)
      && Boolean(this.cb.getGame()) && this.ui.visible && !this.palmMenu.open;
    if (!this.boardRig.active) {
      this.bothPinchTime = both ? this.bothPinchTime + dt : 0;
      if (this.bothPinchTime < RIG.HOLD) return;
      this.bothPinchTime = 0;
      const [left, right] = this.handPair(hands);
      const camera = this.renderer.xr.getCamera();
      const forward = camera.getWorldDirection(new THREE.Vector3())
        .applyQuaternion(this.anchor.getWorldQuaternion(new THREE.Quaternion()).invert());
      this.boardRig.begin(left, right, forward);
      this.rigLink.visible = this.rigOutline.visible = true;
    } else if (!both) {
      this.endBoardGesture();
      return;
    }
    const [left, right] = this.handPair(hands);
    this.boardRig.update(left, right);
    const link = this.rigLink.geometry.attributes.position;
    link.setXYZ(0, hands[0].handPoint.x, hands[0].handPoint.y, hands[0].handPoint.z);
    link.setXYZ(1, hands[1].handPoint.x, hands[1].handPoint.y, hands[1].handPoint.z);
    link.needsUpdate = true;
  }

  // UI 换边:头部水平朝向相对棋盘朝向分 4 个 90° 扇区,滞回 10°(过 55° 才换);
  // 抓着牌、双手操控中、手心菜单打开时不换(免得牌在手里跳走);换边 0.35s 缓出动画,绕战场中心转
  updateUiSide(dt) {
    const side = this.uiSide;
    const forward = this.renderer.xr.getCamera().getWorldDirection(new THREE.Vector3());
    const frozen = this.inputs.some(s => s.grab) || this.boardRig.active || this.palmMenu.open;
    if (!frozen && Math.hypot(forward.x, forward.z) > 0.2) {   // 几乎竖直往下看时朝向不可靠,不判断
      const headYaw = Math.atan2(-forward.x, -forward.z);
      const boardYaw = this.anchor.rotation.y + this.boardRig.rig.yaw;
      const sector = uiSector(wrapAngle(headYaw - boardYaw), side.sector);
      if (sector !== side.sector) {
        side.sector = sector;
        side.from = side.angle;
        side.to = side.angle + wrapAngle(sector * Math.PI / 2 - side.angle);
        side.t = 0;
      }
    }
    if (side.t < 1) {
      side.t = Math.min(1, side.t + dt / UI_SIDE.ANIM_S);
      side.angle = side.from + (side.to - side.from) * (1 - (1 - side.t) ** 3);
      this.uiPivot.rotation.y = side.angle;
      this.uiPivot.updateMatrixWorld(true);
    }
  }

  // 两只手的捏合点(anchor 坐标),按左右排;分不出左右时按输入顺序
  handPair(hands) {
    const sorted = [...hands].sort((a, b) => (a.side === 'right') - (b.side === 'right'));
    return sorted.map(s => this.anchor.worldToLocal(s.handPoint.clone()));
  }

  endBoardGesture() {
    this.boardRig.end();
    this.rigLink.visible = this.rigOutline.visible = false;
  }

  // ── 面板重绘 ──
  refreshPanels(game, dt) {
    const battle = game.phase === 'battle' || game.phase === 'prep';   // 准备阶段手牌照常显示、可以拖着预览
    const guide = battle && this.cb.getFirstMatch?.();
    this.refreshFirstMatch(guide);
    this.cardRow.visible = battle;
    this.trash.mesh.visible = !guide;
    this.hud.mesh.visible = !guide;
    this.upgradeGroup.visible = game.phase === 'upgrade';
    const waiting = this.upgradeGroup.visible && Boolean(game.upgrade?.picked?.p);
    this.upgrades.forEach(panel => { panel.mesh.visible = !waiting; });
    if (waiting && !this.upgradeWait.mesh.visible) this.drawLobbyButton(this.upgradeWait, t('upgradeWait'));
    this.upgradeWait.mesh.visible = waiting;
    this.upgradeClock.mesh.visible = this.upgradeGroup.visible && Boolean(game.upgrade);
    if (this.upgradeClock.mesh.visible) {
      const seconds = Math.max(0, Math.ceil(game.upgrade.timer));
      const key = getLang() + seconds;
      if (this.upgradeClock.key !== key) {
        this.upgradeClock.key = key;
        this.drawLobbyButton(this.upgradeClock, t('upgradeRemaining', { n: seconds }), t('upgradeTimeout'));
      }
    }
    this.endPanel.mesh.visible = game.phase === 'end';
    this.lobbyReturn.mesh.visible = this.endPanel.mesh.visible;
    this.refreshPaused(game);
    this.refreshCountdown(game);

    if (battle) {
      const hover = this.inputs.find(s => s.hover >= 0 && !s.grab)?.hover ?? -1;
      const guidedId = guide?.step === 'deploy' ? guide.cardId : '';
      const sig = [getLang(), guide?.step, guidedId, hover].join(':') + ':' + game.p.hand.map((c, i) =>
        c.id + (game.p.mana >= c.cost ? '1' : game.canPlay('p', i) ? 'b' : '0') + (i === hover ? 'h' : '')).join('|');
      if (sig !== this.cardSig) {
        this.cardSig = sig;
        game.p.hand.forEach((card, i) => drawCard(this.cards[i], card,
          game.canPlay('p', i) && (!guide || (guide.step === 'deploy' && card.type === 'unit')),
          i === hover || card.id === guidedId,
          game.p.mana < card.cost ? game.bloodCost('p', card) : null));
      }
      const grabbedCards = this.inputs.flatMap(input => input.grab ? [input.grab] : []);
      const grabbed = grabbedCards[0];
      const aimingAtBoard = grabbedCards.some(grab => grab.hit);
      this.fadeCards(game, grabbedCards, dt);
      this.refreshHandPanels(game, grabbed ? game.p.hand.find(card => card.id === grabbed.id) : game.p.hand[hover]);
      this.manaPanel.mesh.visible = !aimingAtBoard;
      if (aimingAtBoard) {
        this.nextCardPanel.mesh.visible = false;
        this.cardDetailPanel.mesh.visible = false;
      }
    }

    if (game.phase === 'upgrade' && this.upgradeFor !== game.upgradeOptions) {
      this.upgradeFor = game.upgradeOptions;
      game.upgradeOptions.forEach((up, i) => this.drawUpgrade(this.upgrades[i], up));
    }

    if (game.phase === 'end' && this.endFor !== game) {
      this.endFor = game;
      this.drawEnd(game);
      this.drawLobbyButton(this.lobbyReturn, t('xrHome'));
    }

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.15; this.drawHUD(game); }
  }

  refreshCountdown(game) {
    const panel = this.countdownPanel;
    if (this.countdownGame !== game) { this.countdownGame = game; this.sawPrep = false; this.goUntil = 0; }
    if (game.phase === 'prep') this.sawPrep = true;
    else if (this.sawPrep && game.phase === 'battle' && !this.goUntil) this.goUntil = performance.now() + 1000;
    const go = performance.now() < this.goUntil;
    const text = game.phase === 'prep' ? String(Math.max(1, Math.ceil(game.prepLeft))) : go ? t('prepGo') : '';
    panel.mesh.visible = Boolean(text);
    if (!text || panel.key === getLang() + text) return;
    panel.key = getLang() + text;
    const { ctx, canvas, tex } = panel;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(38, 28, 48, 0.85)';
    ctx.beginPath(); ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 48); ctx.fill();
    ctx.strokeStyle = '#e5b573'; ctx.lineWidth = 8; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = go ? '#ffd24a' : '#fff3de';
    ctx.font = `900 ${go ? 150 : 230}px sans-serif`;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 8, canvas.width - 60);
    tex.needsUpdate = true;
  }

  refreshPaused(game) {
    const panel = this.pausedPanel;
    panel.mesh.visible = Boolean(this.cb.isPaused?.()) && game.phase !== 'end';
    if (!panel.mesh.visible || panel.key === getLang()) return;
    panel.key = getLang();
    this.drawLobbyButton(panel, t('xrPaused'), t('xrPausedHint'), false, 'pause');
  }

  // 抓起一张牌后,其余手牌 0.15s 渐隐(不挡视线);松手后渐显。透明度乘在牌面 / 牌背 / 深度占位三份材质上
  fadeCards(game, grabbedCards, dt) {
    const step = dt / CARD_FADE_S;
    this.cards.forEach((card, idx) => {
      const held = grabbedCards.some(grab => grab.idx === idx);
      const target = grabbedCards.length && !held ? 0 : 1;
      const fade = card.fade ?? 1;
      card.fade = target > fade ? Math.min(target, fade + step) : Math.max(target, fade - step);
      if (card.fade !== fade || card.fadeApplied !== card.fade) {
        card.fadeApplied = card.fade;
        card.mesh.traverse(o => { if (o.material) o.material.opacity = card.fade; });
      }
      card.mesh.visible = Boolean(game.p.hand[idx]) && card.fade > 0.01;
    });
  }

  // 手牌行(cardRowPose):在 uiInner 坐标(换边之后)里算近边和眼睛,上沿贴着近边视线下方;抓着牌时冻结
  updateCardRow(dt) {
    if (this.inputs.some(s => s.grab)) return;
    const world = this.bs.world, scale = world.scale.x;
    const half = (this.uiSide.sector % 2 ? ARENA.hx : ARENA.hz) + ARENA.rim;   // 换到侧边时面对的是棋盘侧边
    const edge = { y: world.position.y + (ARENA.top + RIM_ALLOWANCE) * scale, z: world.position.z + half * scale };
    const eye = this.uiInner.worldToLocal(this.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3()));
    const pose = cardRowPose({ y: eye.y, z: eye.z }, edge, CARD_ROW_EXTENT);
    const k = this.cardRowPlaced ? 1 - Math.exp(-dt / CARD_ROW_SMOOTH) : 1;
    this.cardRowPlaced = true;
    this.cardRow.position.y += (pose.y - this.cardRow.position.y) * k;
    this.cardRow.position.z += (pose.z - this.cardRow.position.z) * k;
    this.cardRow.rotation.x += (pose.tilt - this.cardRow.rotation.x) * k;
  }

  refreshFirstMatch(guide) {
    this.firstMatchControls.visible = Boolean(guide);
    if (!guide) return;
    this.firstMatchButtons[1].mesh.visible = guide.step === 'core';
    const hovered = this.hoverActions(this.firstMatchButtons);
    const signature = [getLang(), guide.step, ...hovered].join(':');
    if (signature === this.firstMatchSignature) return;
    this.firstMatchSignature = signature;
    const panel = this.firstMatchPrompt;
    const page = { deploy: 'firstDeploy', watch: 'firstWatch', core: 'firstCore' }[guide.step];
    this.drawLobbyButton(panel, '');
    const { ctx, canvas, tex } = panel;
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffe4ac'; ctx.font = 'bold 45px sans-serif';
    ctx.fillText(t(page + 'Title'), canvas.width / 2, 55);
    ctx.fillStyle = '#f0e0ee'; ctx.font = '34px sans-serif';
    wrapText(ctx, t(guide.step === 'deploy' ? 'firstDeployXRText' : page + 'Text'),
      canvas.width / 2, 116, canvas.width - 78, 43, 2);
    tex.needsUpdate = true;
    const labels = { skip: 'firstMatchSkip', start: 'firstMatchGo', center: 'xrCenter', home: 'xrHome' };
    for (const button of this.firstMatchButtons) {
      this.drawLobbyButton(button, t(labels[button.action]), '', hovered.has(button.action), button.action === 'center' ? 'center' : null);
    }
  }

  refreshHandPanels(game, focused) {
    const next = game.nextCard('p');
    const key = next ? getLang() + next.id : '';
    const panel = this.nextCardPanel;
    panel.mesh.visible = Boolean(next);
    if (next && panel.key !== key) {
      panel.key = key;
      const { ctx, canvas, tex } = panel;
      this.drawLobbyButton(panel, '');
      const art = cardArt(next);
      if (art) {
        ctx.save();
        if (art.glow) ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(art.img, 24, 58, 136, 136);
        ctx.restore();
      }
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff0d6'; ctx.font = 'bold 27px sans-serif';
      ctx.fillText(t('nextLabel'), canvas.width / 2, 37);
      ctx.fillStyle = '#e6bdff'; ctx.fillText(next.cost, 27, 198);
      tex.needsUpdate = true;
    }

    const mana = this.manaPanel;
    const step = Math.floor(game.p.mana), max = game.p.manaMax;
    const manaKey = getLang() + step + '/' + max;
    if (mana.key !== manaKey) {
      mana.key = manaKey;
      const { ctx, canvas, tex } = mana;
      this.drawLobbyButton(mana, '');
      ctx.textAlign = 'center'; ctx.fillStyle = '#f0d6ff'; ctx.font = 'bold 39px sans-serif';
      ctx.fillText(`${t('mana')} ${step}/${max}`, 151, canvas.height / 2, 220);
      const span = 415 / max;
      for (let i = 0; i < max; i++) {
        ctx.fillStyle = i < step ? '#ba8cf0' : '#524061';
        ctx.fillRect(280 + i * span, 42, span - 3, 20);
      }
      tex.needsUpdate = true;
    }

    const detail = this.cardDetailPanel;
    detail.mesh.visible = Boolean(focused);
    if (!focused) return;
    const text = cardDesc(focused);
    if (detail.key === text) return;
    detail.key = text;
    this.drawLobbyButton(detail, '');
    const { ctx, canvas, tex } = detail;
    ctx.textAlign = 'center'; ctx.font = 'bold 29px sans-serif';
    wrapText(ctx, text, canvas.width / 2, 29, canvas.width - 42, 37, 2);
    tex.needsUpdate = true;
  }

  drawHUD(game) {
    const { ctx, canvas, tex } = this.hud;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';
    const box = (x, y, width, height, fill) => {
      ctx.fillStyle = fill; ctx.strokeStyle = '#af9164'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.roundRect(x, y, width, height, 20); ctx.fill(); ctx.stroke();
    };
    const team = (x, label, side, color) => {
      box(x, 6, 356, 118, '#261c30');
      ctx.fillStyle = '#f6e7d8'; ctx.font = 'bold 33px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(label, x + 22, 51, 210);
      ctx.textAlign = 'right';
      ctx.fillText(Math.max(0, Math.round(side.baseHP)), x + 334, 51, 95);
      const pct = THREE.MathUtils.clamp(side.baseHP / side.baseHPMax, 0, 1);
      ctx.fillStyle = '#a08054'; ctx.fillRect(x + 22, 77, 312, 22);
      ctx.fillStyle = '#201822'; ctx.fillRect(x + 25, 80, 306, 16);
      ctx.fillStyle = pct <= 0.25 ? '#ff9669' : '#f0d69f';
      ctx.fillRect(x + 38, 82, 280 * pct, 12);
      ctx.fillStyle = color;
      ctx.fillRect(x + 27, 82, 8, 12); ctx.fillRect(x + 321, 82, 8, 12);
    };
    team(4, t('myBase'), game.p, '#62c9ff');
    team(664, t('enemyBase'), game.e, '#ff796c');
    box(371, 6, 282, 118, '#35243c');
    const secs = Math.ceil(game.timeLeft());
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    ctx.textAlign = 'center'; ctx.font = 'bold 52px sans-serif';
    ctx.fillStyle = game.overtime ? '#ffb49a' : game.surge ? '#d6bfff' : '#fff0da';
    ctx.fillText(clock, W / 2, 64);
    ctx.font = 'bold 31px sans-serif'; ctx.fillStyle = '#f3d39f';
    ctx.fillText(`${game.crowns('p')}  ◆  ${game.crowns('e')}`, W / 2, 105);
    const objective = coreStatus(game.node);
    const mode = game.overtime ? t('otTag') : game.surge ? t('surgeTag') : '';
    box(24, 136, 480, 49, '#261c30');
    box(520, 136, 480, 49, '#261c30');
    ctx.font = 'bold 30px sans-serif';
    ctx.fillStyle = '#ffe0a2';
    ctx.fillText(objective, 264, 171, 444);
    ctx.fillStyle = mode ? '#ffd4ad' : '#e6d2e4';
    ctx.fillText(mode || (game.playsToUpgrade() ? t('toUpgrade', { n: game.playsToUpgrade() }) : t('upgradesComplete')), 760, 171, 444);
    const network = this.cb.getNetworkStatus?.();
    const palmHint = performance.now() < this.palmHintUntil && !this.cb.getFirstMatch?.() ? t('xrPalmHint') : '';
    const alert = [network, this.notice?.text || palmHint].filter(Boolean);
    if (alert.length) {
      box(42, 196, W - 84, 48, '#261c30');
      ctx.fillStyle = network ? '#ffb9b2' : '#ffe0a2';
      const width = (W - 110) / alert.length;
      alert.forEach((text, index) => ctx.fillText(text, 55 + (index + .5) * width, 230, width - 18));
    }
    tex.needsUpdate = true;
  }

  drawUpgrade(panel, up) {
    const { ctx, canvas: c, tex } = panel;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#40334f';
    ctx.beginPath(); ctx.roundRect(6, 6, c.width - 12, c.height - 12, 24); ctx.fill();
    ctx.strokeStyle = '#c89fe9'; ctx.lineWidth = 6; ctx.stroke();
    ctx.fillStyle = '#c8b4ff'; ctx.font = 'bold 48px sans-serif'; ctx.textAlign = 'center';
    const u = upgradeText(up);
    const icon = uiArt(up.icon ?? up.id);
    if (icon) ctx.drawImage(icon.img, (c.width - 68) / 2, 15, 68, 68);   // 界面图已是真透明
    ctx.fillText(u.name, c.width / 2, 128, c.width - 48);
    ctx.fillStyle = '#dde4f0'; ctx.font = '34px sans-serif';
    wrapText(ctx, u.desc, c.width / 2, 180, c.width - 60, 44, 2);
    ctx.fillStyle = 'rgba(221,228,240,.5)'; ctx.font = '26px sans-serif';
    ctx.fillText(t('pinch'), c.width / 2, 290);
    tex.needsUpdate = true;
  }

  drawEnd(game) {
    const { winner } = game;
    const { ctx, canvas: c, tex } = this.endPanel;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#352c40';
    ctx.beginPath(); ctx.roundRect(6, 6, c.width - 12, c.height - 12, 28); ctx.fill();
    ctx.strokeStyle = winner === 'p' ? '#ffdb83' : winner === 'e' ? '#ff8a7a' : '#c89fe9'; ctx.lineWidth = 6; ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = winner === 'p' ? '#ffd24a' : '#ff8a7a'; ctx.font = 'bold 84px sans-serif';
    const badge = uiArt(winner === 'p' ? 'end_victory' : winner === 'e' ? 'end_defeat' : 'end_draw');
    if (badge) {
      ctx.drawImage(badge.img, 45, 24, 105, 105);
      ctx.drawImage(badge.img, c.width - 150, 24, 105, 105);
    }
    ctx.fillText(t(winner === 'p' ? 'xrWin' : winner === 'e' ? 'xrLose' : 'xrDraw'), c.width / 2, 104, c.width - 290);
    ctx.fillStyle = '#f0e3f0'; ctx.font = '30px sans-serif';
    const reason = game.endReason === 'base' && winner ? (winner === 'p' ? 'coreWon' : 'coreLost') : game.endReason;
    if (reason) ctx.fillText(t('reason_' + reason), c.width / 2, 150, c.width - 50);
    const seconds = Math.floor(game.time);
    const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const cores = [game.p, game.e].map(side => Math.max(0, Math.round(side.baseHP))).join(' / ');
    ctx.fillText(`${t('matchScore')} ${game.crowns('p')} : ${game.crowns('e')}   ·   ${duration}`, c.width / 2, 194, c.width - 50);
    ctx.fillText(`${t('matchCores')} ${cores}`, c.width / 2, 230, c.width - 50);
    ctx.fillStyle = '#d5bcd4'; ctx.font = '24px sans-serif';
    ctx.fillText(t('xrAgain'), c.width / 2, 278);
    tex.needsUpdate = true;
  }
}

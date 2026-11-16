// XR 交互层 — 手部追踪 Pinch 选牌 + 拖拽落位;手柄射线作为兜底
// 设计约束(见 plan):只用 Pinch + 拖拽,不依赖手势速度、巧合或空间深度
//
// 空间布局(anchor = 进入 XR 时用户头部位置 + 朝向):
//   战场  :头下 50cm、前方 72cm,约 0.55m × 0.75m 的桌面;己方半场在 44~76cm,坐姿可及
//   手牌  :头下 40cm、前方 20cm,一排 5 张,向后倾斜面向用户
//   HUD   :战场远端上方
//   强化/结束面板:手牌上方,需要时出现
// 双手同时捏合(空捏)保持 1 秒 → 以当前头部重新居中

import * as THREE from 'three';
import { FACTIONS, cardTags, previewRadius } from './cards.js';
import { cardArt, uiArt, XR_GUIDE, loadXRGuideArt, loadXRControlArt } from './assets.js';
import { isPlaced } from './game.js';
import { ARENA } from './arena.js';
import { XR_POSE_INTERVAL, XR_POSE_TIMEOUT, xrPartInSeat } from './net.js';
import { XROpponentAvatar } from './xr-avatar.js';
import { createHandVisual } from './xr-hand-visual.js';
import { coreStatus, t, getLang, cardName, cardDesc, factionName, tagName, upgradeText } from './i18n.js';

const PINCH_ON = 0.022;      // 指尖距离 < 2.2cm 视为捏合
const PINCH_OFF = 0.038;     // > 3.8cm 视为松开(滞回,防抖)
const GRAB_RADIUS = 0.06;    // 捏合点离卡牌中心 6cm 内可抓取
const DROP_MAX_HEIGHT = 0.25;// 捏合点离战场面 25cm 内才算落在战场上
const CARD_W = 0.072, CARD_H = 0.1, CARD_GAP = 0.082;
const RECENTER_HOLD = 1.0;
const BOARD_SCALES = { small: 0.044, standard: 0.052, large: 0.060 };
const BOARD_CENTER_DISTANCE = 0.72;
const HUD_BASE_DISTANCE = 1.25;
const POSTER_WIDTH = 0.56;
const POSTER_HEIGHT = POSTER_WIDTH * 16 / 9;
const POSTER_GAP = 0.30;
const RETURN_SECONDS = 0.18;
const TRASH_RADIUS = 0.06;   // 拖到回收区 6cm 内松开 = 弃牌

const hex = c => '#' + c.toString(16).padStart(6, '0');

// ── Canvas 贴图面板 ──
function makePanel(wM, hM, wPx, hPx) {
  const canvas = document.createElement('canvas');
  canvas.width = wPx; canvas.height = hPx;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(wM, hM),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  );
  mesh.renderOrder = 20;
  return { mesh, ctx, tex, canvas };
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines = 3) {
  let line = '', lines = 0;
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      ctx.fillText(line, x, y); y += lineH; line = ch;
      if (++lines >= maxLines) return;
    } else line += ch;
  }
  if (line) ctx.fillText(line, x, y);
}

function drawCard(panel, card, affordable, hover, blood = null) {
  const { ctx, canvas: c, tex } = panel;
  const W = c.width, H = c.height;
  const fc = hex(FACTIONS[card.faction].color);
  ctx.clearRect(0, 0, W, H);
  ctx.globalAlpha = affordable ? 1 : 0.4;
  // 底
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#665573'); g.addColorStop(1, '#362a43');
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
    this.poster = new THREE.Group();
    this.poster.name = 'vr:standing-poster';
    this.poster.visible = false;
    this.anchor.add(this.poster);
    this.ui = new THREE.Group();
    this.ui.visible = false;
    this.anchor.add(this.ui);

    // 手牌
    this.cardRow = new THREE.Group();
    this.cardRow.position.set(0, -0.345, -0.265);
    this.cardRow.rotation.x = -0.50;
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
    this.manaPanel.mesh.position.set(0, 0.071, 0);
    this.cardRow.add(this.manaPanel.mesh);
    this.cardDetailPanel = makePanel(0.32, 0.034, 840, 100);
    this.cardDetailPanel.mesh.position.set(0, -0.072, 0);
    this.cardRow.add(this.cardDetailPanel.mesh);

    // 回收区(弃牌):手牌右侧
    this.trash = makePanel(0.07, 0.07, 256, 256);
    this.trash.mesh.position.set(3 * CARD_GAP + 0.01, 0, 0);
    this.cardRow.add(this.trash.mesh);
    this.drawTrash();

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
    this.battleControls = new THREE.Group();
    this.battleControls.position.set(0, -0.18, -0.57);
    this.battleControls.visible = false;
    this.ui.add(this.battleControls);
    this.battleButtons = ['center', 'size', 'sound', 'leave'].map((action, i) => {
      const button = makePanel(0.101, 0.049, 352, 170);
      button.action = action;
      button.mesh.position.x = (i - 1.5) * 0.114;
      this.battleControls.add(button.mesh);
      return button;
    });
    this.leavePrompt = makePanel(0.29, 0.058, 768, 154);
    this.leavePrompt.mesh.position.y = 0.063;
    this.leavePrompt.mesh.visible = false;
    this.battleControls.add(this.leavePrompt.mesh);
    this.battleControlsSignature = '';

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

    // 首页在头部下方、手能触及的位置固定，按需重画 Canvas。
    this.lobby = new THREE.Group();
    this.lobby.position.set(0, -0.145, -0.46);
    this.lobby.visible = false;
    this.anchor.add(this.lobby);
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

      const cursor = new THREE.Mesh(
        new THREE.SphereGeometry(0.007, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
      );
      cursor.renderOrder = 30;
      cursor.visible = false;
      bs.scene.add(cursor);

      const st = { i, hand, visual, ctrl, line, cursor, isHand: false, connected: false,
                   pinched: false, grab: null, hover: -1, point: new THREE.Vector3() };
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
  }

  // ── 会话生命周期 ──
  enter(isAR) {
    this.active = true;
    this.isAR = isAR;
    if (!isAR) this.loadStandingPoster();
    this.bs.enterXRLayout(this.anchor, isAR);
    if (!isAR) this.bs.scene.background = this.immersiveBackground();
    this.nextPoseAt = 0;
    loadXRControlArt().then(() => this.applyControlArt());
    this.applyBoardSize();
    this.clearNotice();
    this.battleControlsSignature = '';
    this.confirmLeaveGame = null;
    this.lobbySignature = '';
    this.guideIndex = -1;
    this.calibFrames = 3;   // 等头部姿态就绪后再显示固定面板
    this.updateLayout(this.cb.getGame());
    this.cardSig = ''; this.upgradeFor = null; this.endFor = null;
  }

  exit() {
    this.active = false;
    this.cb.onXRPose?.(null);
    this.poster.visible = false;
    this.clearNotice();
    for (const st of this.inputs) {
      this.release(st, true);
      st.pinched = false;
      st.waitForOpen = false;
      st.handPoint = null;
      st.cursor.visible = false;
    }
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
    ctx.font = '30px sans-serif'; ctx.fillText(t('trash'), 128, 180);
    tex.needsUpdate = true;
  }

  applyControlArt() {
    this.battleControlsSignature = '';
    this.lobbySignature = '';
    this.drawTrash();
    const art = uiArt('xr-control-back');
    if (this.cardBacksReady || !art) return;
    this.cardBacksReady = true;

    const texture = new THREE.Texture(art.img);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    for (const { mesh } of this.cards) {
      const frontMaterial = mesh.material.clone();
      frontMaterial.side = THREE.FrontSide;
      const front = new THREE.Mesh(mesh.geometry, frontMaterial);
      front.renderOrder = mesh.renderOrder;
      mesh.add(front);
      mesh.material.colorWrite = false;
      const back = new THREE.Mesh(mesh.geometry, material);
      back.rotation.y = Math.PI;
      back.position.z = -0.001;
      back.renderOrder = mesh.renderOrder;
      mesh.add(back);
    }
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
    this.bs.world.position.z = -BOARD_CENTER_DISTANCE - shift;
    this.hud.mesh.position.z = -HUD_BASE_DISTANCE - shift - (scale - BOARD_SCALES.standard) * halfDepth;
    this.poster.position.set(0, -0.055, this.hud.mesh.position.z - POSTER_GAP);
    this.bs.world.updateMatrixWorld(true);
  }

  notify(text) {
    this.notice = { text, until: performance.now() + 3200 };
    this.hudTimer = 0;
  }

  clearNotice() {
    this.notice = null;
    this.hudTimer = 0;
  }

  refreshBattleControls() {
    const { muted, boardSize, online } = this.cb.getBattleControls();
    const hovered = this.hoverActions(this.battleButtons);
    const confirming = Boolean(this.confirmLeaveGame);
    const signature = JSON.stringify([getLang(), muted, boardSize, online, confirming, [...hovered]]);
    if (signature === this.battleControlsSignature) return;
    this.battleControlsSignature = signature;
    this.leavePrompt.mesh.visible = confirming;
    if (confirming) this.drawLobbyButton(this.leavePrompt, t('xrLeavePrompt'), online ? t('xrLeavePenalty') : '');
    const labels = confirming ? [
      [t('xrConfirmLeave')], [], [], [t('xrContinueBattle')],
    ] : [
      [t('xrCenter')],
      [t('xrBoardSize'), t('xrBoard_' + boardSize)],
      [t('xrSound'), t(muted ? 'xrOff' : 'xrOn')],
      [t('quit')],
    ];
    for (const [i, panel] of this.battleButtons.entries()) {
      panel.mesh.visible = labels[i].length > 0;
      if (panel.mesh.visible) this.drawLobbyButton(panel, labels[i][0], labels[i][1], hovered.has(panel.action), confirming ? null : panel.action);
    }
  }

  hoverActions(panels) {
    const hovered = new Set();
    for (const st of this.inputs) {
      if (!st.connected || st.grab) continue;
      const target = this.lobbyTarget(panels, st.handPoint, st.isHand ? null : this.ctrlRay(st));
      if (target) hovered.add(target.action);
    }
    return hovered;
  }

  updateLayout(game) {
    const ready = this.calibFrames === 0;
    this.lobby.visible = ready && !game;
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
    if (this.notice && performance.now() >= this.notice.until) this.clearNotice();
    if (this.trashLang !== getLang()) this.drawTrash();
    if (this.calibFrames > 0 && --this.calibFrames === 0) this.recenter();

    const game = this.cb.getGame();
    if (this.returnGame !== game || game?.phase !== 'battle') {
      this.resetReturningCards();
      this.returnGame = game;
    }
    if (this.inputGame !== game || this.inputPhase !== game?.phase) {
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
      if (st.isHand) this.readHand(st);
      else {
        st.cursor.visible = false;
        if (!st.connected) continue;
        const ray = this.ctrlRay(st);
        if (st.grab) this.dragRay(st, ray);
        else st.hover = game?.phase === 'battle' ? this.pick(this.cards, null, ray) : -1;
      }
    }
    this.checkRecenter(dt);
    if (this.confirmLeaveGame !== game || game?.phase !== 'battle') this.confirmLeaveGame = null;
    if (!game) { this.refreshLobby(); return; }
    this.refreshPanels(game, dt);
    if (game.phase !== 'end') this.sendLocalPose();
    if (this.battleControls.visible) this.refreshBattleControls();
    this.animateReturningCards(dt);
    this.placementHint.mesh.visible = false;

    // 落点预览(攻击/作用范围圈)跟随当前拖拽
    const grab = this.inputs.find(s => s.grab)?.grab;
    this.trash.mesh.material.opacity = grab ? (grab.trash ? 1 : 0.75) : 0.35;
    const card = grab && game.p.hand.find(c => c.id === grab.id);
    if (card && !grab.trash) {
      const hit = grab.hit;
      const reason = hit ? game.deployBlockReason('p', card, hit.x, hit.z) : null;
      this.bs.showPlacement({
        ...hit, game, card, showDeployZone: isPlaced(card), isUnit: card.type !== 'spell',
        radius: previewRadius(card), valid: !reason,
      });
      if (reason) this.showPlacementHint(reason, hit.point);
    } else {
      const guide = this.cb.getFirstMatch?.();
      const starter = guide?.step === 'deploy' && game.p.hand.find(card => card.id === guide.cardId);
      this.bs.showPlacement(starter ? { game, card: starter, showDeployZone: true } : null);
    }
  }

  sendLocalPose() {
    if (!this.renderer.xr.isPresenting || !this.cb.hasOnlineOpponent?.()) return;
    const now = performance.now();
    if (now < this.nextPoseAt) return;
    this.nextPoseAt = now + XR_POSE_INTERVAL;
    const camera = this.renderer.xr.getCamera();
    const invAnchor = this.anchor.getWorldQuaternion(new THREE.Quaternion()).invert();
    const ratio = BOARD_SCALES.standard / this.bs.world.scale.x;
    const boardZ = this.bs.world.position.z;
    const pack = (point, rotation, grip = false) => {
      const local = this.anchor.worldToLocal(point);
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
    const parent = this.active ? this.anchor : this.bs.world;
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
      ? this.anchor.worldToLocal(this.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3()))
      : new THREE.Vector3();
    const mayShow = (point, index) => {
      if (!this.active) return point.z >= -.91;
      const z = root.position.z - point.z;
      const depthMargin = index === 0 ? .12 : .08;
      if (z + depthMargin > this.bs.world.position.z) return false;
      const hud = this.hud.mesh.position;
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
    this.release(st, true);
    st.pinched = false;
    st.hover = -1;
    st.handPoint = null;
    st.cursor.visible = false;
  }

  readHand(st) {
    const tip = st.hand.joints?.['index-finger-tip'];
    const thumb = st.hand.joints?.['thumb-tip'];
    if (!tip || !thumb || !st.connected || st.hand.visible === false || tip.visible === false || thumb.visible === false) {
      this.loseHandTracking(st);
      return;
    }
    const a = tip.getWorldPosition(new THREE.Vector3());
    const b = thumb.getWorldPosition(new THREE.Vector3());
    this.handInput(st, a.distanceTo(b), a.add(b).multiplyScalar(0.5));
  }

  // 手部输入核心(与设备解耦,便于桌面端模拟测试)
  handInput(st, dist, point) {
    if (!Number.isFinite(dist) || !Number.isFinite(point.x + point.y + point.z)) {
      this.loseHandTracking(st);
      return;
    }
    st.point.copy(point);
    st.handPoint = st.point;
    st.cursor.visible = true;
    st.cursor.position.copy(point);
    if (st.waitForOpen) {
      if (dist > PINCH_OFF) st.waitForOpen = false;
    } else if (!st.pinched && dist < PINCH_ON) {
      st.pinched = true;
      this.press(st, point, null);
    } else if (st.pinched && dist > PINCH_OFF) {
      st.pinched = false;
      const ready = this.canUseInput();
      if (st.grab && ready) this.dragPoint(st, point);
      this.release(st, !ready);
    } else if (st.pinched && st.grab) {
      this.dragPoint(st, point);
    }
    if (!st.pinched) {
      const game = this.cb.getGame();
      st.hover = game && game.phase === 'battle' ? this.pick(this.cards, point, null, GRAB_RADIUS * 1.3) : -1;
    }
    st.cursor.material.color.setHex(st.pinched ? 0x5ac8ff : 0xffffff);
  }

  // 在一组面板中挑中目标:点模式取最近中心,射线模式取射线命中
  pick(panels, point, ray, radius = GRAB_RADIUS) {
    const meshes = panels.map(p => p.mesh).filter(mesh => this.isVisibleForInput(mesh));
    if (ray) {
      this.raycaster.set(ray.origin, ray.direction);
      const hit = this.raycaster.intersectObjects(meshes, false)[0];
      return hit ? hit.object.userData.idx : -1;
    }
    let best = -1, bestD = radius;
    for (const m of meshes) {
      const d = m.getWorldPosition(new THREE.Vector3()).distanceTo(point);
      if (d < bestD) { bestD = d; best = m.userData.idx; }
    }
    return best;
  }

  press(st, point, ray) {
    if (!this.canUseInput()) return;
    const game = this.cb.getGame();
    if (game && !this.ui.visible) return;
    if (!game) {
      if (!this.lobby.visible) return;
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
      if (game.upgrade?.picked?.p) return;
      const i = this.pick(this.upgrades, point, ray, GRAB_RADIUS * 1.5);
      if (i >= 0) this.cb.onUpgrade(i);
      return;
    }
    if (game.phase === 'end') {
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
    if (this.battleControls.visible && !this.inputs.some(input => input.grab)) {
      const target = this.lobbyTarget(this.battleButtons, point, ray);
      if (this.confirmLeaveGame === game) {
        if (target?.action === 'leave') {
          this.confirmLeaveGame = null;
          this.refreshBattleControls();
        }
        if (target?.action === 'center') {
          this.confirmLeaveGame = null;
          this.cb.onBattleAction('leave');
        }
        return;
      }
      if (target) {
        if (target.action === 'leave') {
          this.confirmLeaveGame = game;
          this.refreshBattleControls();
          this.clearNotice();
        } else if (target.action === 'center') {
          this.recenter();
          this.cb.onToast?.(t('tRecentered'));
        } else this.cb.onBattleAction(target.action);
        return;
      }
    }
    const guide = this.cb.getFirstMatch?.();
    if (guide && this.firstMatchControls.visible) {
      const action = this.lobbyTarget(this.firstMatchButtons, point, ray)?.action;
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
    if (!game.canPlay('p', idx)) { this.cb.onToast?.(t('tNoMana')); return; }
    this.cards[idx].returning = null;
    st.grab = { idx, id: game.p.hand[idx].id, game, hit: null };   // 记住所属对局:换局后松手不能在新局里出牌   // 记住卡牌 id:捏住期间手牌可能被快照校正而换位
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
    g.hit = (!g.trash && h > -0.05 && h < DROP_MAX_HEIGHT) ? this.bs.worldPointToField(point) : null;
  }

  dragRay(st, ray) {
    const g = st.grab;
    const mesh = this.cards[g.idx].mesh;
    g.trash = this.trash.mesh.visible && this.rayHits(this.trash.mesh, ray);
    g.hit = g.trash ? null : this.bs.rayToField(ray);
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

  release(st, cancel = false) {
    const g = st.grab;
    if (!g) return;
    st.grab = null;
    const p = this.cards[g.idx];
    const game = this.cb.getGame();
    if (cancel || !this.canUseInput() || game !== g.game || game?.phase !== 'battle') {
      p.mesh.position.copy(p.home);
      return;
    }
    const idx = game.p.hand.findIndex(c => c.id === g.id);   // 按 id 重新定位;牌已不在手里就取消
    const card = game.p.hand[idx];
    if (!card || g.trash) {
      p.mesh.position.copy(p.home);
      if (card) this.cb.onDiscard?.(idx);
      this.cardSig = '';
      return;
    }
    const reason = !game.canPlay('p', idx) ? 'tNoMana'
      : g.hit ? game.deployBlockReason('p', card, g.hit.x, g.hit.z) : 'deployOutside';
    if (reason || !this.cb.onPlay(idx, g.hit.x, g.hit.z)) {
      p.returning = { from: p.mesh.position.clone(), elapsed: 0 };
      if (reason) this.cb.onToast?.(t(reason));
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

  checkRecenter(dt) {
    const both = this.inputs.every(s => s.isHand && s.pinched && !s.grab);
    this.bothPinchTime = both ? this.bothPinchTime + dt : 0;
    if (this.bothPinchTime >= RECENTER_HOLD) {
      this.bothPinchTime = -999;                 // 本次捏合只触发一次
      this.recenter();
      this.cb.onToast?.(t('tRecentered'));
    }
  }

  // ── 面板重绘 ──
  refreshPanels(game, dt) {
    const battle = game.phase === 'battle';
    const guide = battle && this.cb.getFirstMatch?.();
    this.refreshFirstMatch(guide);
    this.cardRow.visible = battle;
    this.trash.mesh.visible = !guide;
    this.hud.mesh.visible = !guide;
    this.upgradeGroup.visible = game.phase === 'upgrade';
    this.battleControls.visible = battle && !guide;
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
      this.cards.forEach((card, idx) => {
        card.mesh.visible = Boolean(game.p.hand[idx]) && (!aimingAtBoard || grabbedCards.some(grab => grab.idx === idx));
      });
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
    const alert = [network, this.notice?.text].filter(Boolean);
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

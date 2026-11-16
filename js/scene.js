// 渲染层 — Three.js 场景:开放战场、建筑、单位、攻击/部署范围圈、弹道、粒子
import * as THREE from 'three';
import { FACTIONS } from './cards.js';
import { FIELD_W, FIELD_HALF, DEPLOY_LINE } from './game.js';
import { t } from './i18n.js';
import { mapForScene, wallSegments } from './map.js';
import { unitTexture, structTexture, unitModel, structModel } from './assets.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { VFX } from './vfx.js';
import { DeployMarker } from './deploy-fx.js';
import { attachWeapon } from './weapons.js';
import { loadKit, layoutProps, buildProps as buildProps3d } from './props3d.js';
import { buildArena, animateArena, ARENA } from './arena.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const TMP_COLOR = new THREE.Color();
const easeOutBack = t => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
// Tripo 动画片段名 → 状态机用的键
function clipKey(name) {
  const n = (name || '').toLowerCase();
  if (/idle/.test(n)) return 'idle';
  if (/walk|march/.test(n)) return 'walk';
  if (/run/.test(n)) return 'run';
  if (/shoot/.test(n)) return 'shoot';
  if (/slash|attack|punch|bite/.test(n)) return 'attack';
  if (/hurt|hit/.test(n)) return 'hurt';
  if (/fall|die|death/.test(n)) return 'die';
  return null;
}

const SIDE_COLOR = { p: 0x4aa8ff, e: 0xff5a4a };
const SHAKE_T = 0.1, SHAKE_AMP = 0.06;   // 部署降临的桌面震屏:时长(秒)/ 幅度(相机位移,XR 里不震)
const SHAKE_OFF = new THREE.Vector3();
const UNIT_R = 0.22;

// 扁平圆环(范围圈)
function ringMesh(radius, color, opacity, width = 0.05) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(0.01, radius - width), radius, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

function boardLabel(style = 'plate') {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
  sprite.scale.set(1.52, 0.38, 1);
  sprite.renderOrder = 16;
  sprite.userData.ownedTexture = texture;
  sprite.userData.setText = (label, color) => {
    if (sprite.userData.label === label) return;
    sprite.userData.label = label;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    if (style === 'plate') {
      ctx.fillStyle = '#171323';
      ctx.fillRect(6, 5, 244, 54);
      ctx.fillStyle = color;
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(label, 128, 34, 228);
    } else {
      const blood = style === 'blood';
      ctx.font = '900 42px Georgia, serif';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#211520';
      ctx.strokeText(label, blood ? 144 : 128, 34, 205);
      ctx.fillText(label, blood ? 144 : 128, 34, 205);
      if (blood) {
        const x = 128 - ctx.measureText(label).width / 2;
        ctx.beginPath();
        ctx.moveTo(x - 14, 17);
        ctx.quadraticCurveTo(x + 7, 47, x - 14, 49);
        ctx.quadraticCurveTo(x - 35, 47, x - 14, 17);
        ctx.stroke(); ctx.fill();
      }
    }
    texture.needsUpdate = true;
  };
  return sprite;
}

const HEALTH_FILL = 0xf0d69f;
const HEALTH_LOW = 0xff9669;
const HEALTH_TRAIL_MS = 260;
const HEALTH_PARENT_ROTATION = new THREE.Quaternion();
const HEALTH_OFFSET = new THREE.Vector3();

function plaqueShape(width, height) {
  const half = width / 2, edge = height / 2, cut = height * 0.34;
  const shape = new THREE.Shape();
  shape.moveTo(-half + cut, -edge);
  shape.lineTo(half - cut, -edge);
  shape.lineTo(half, 0);
  shape.lineTo(half - cut, edge);
  shape.lineTo(-half + cut, edge);
  shape.lineTo(-half, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function hpBar(width, y, kind = 'unit', side) {
  const root = new THREE.Group();
  root.position.y = y;
  const height = kind === 'base' ? 0.17 : kind === 'unit' ? 0.125 : 0.14;
  const add = (geo, color, order, x = 0, y = 0) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }));
    mesh.position.set(x, y, (order - 10) * 0.005);
    mesh.renderOrder = order;
    root.add(mesh);
    return mesh;
  };
  add(plaqueShape(width, height), 0xa08054, 10);
  add(plaqueShape(width - 0.034, height - 0.026), 0x201822, 11);
  const track = width - (kind === 'base' ? 0.18 : 0.13);
  if (side) {
    add(plaqueShape(0.075, height * 0.65), SIDE_COLOR[side], 12, -width / 2 + 0.048);
    if (kind === 'base') add(plaqueShape(0.075, height * 0.65), SIDE_COLOR[side], 12, width / 2 - 0.048);
  }
  const ghost = add(new THREE.PlaneGeometry(track, height * 0.56), 0xe26e32, 12);
  const fill = add(new THREE.PlaneGeometry(track, height * 0.56), HEALTH_FILL, 13);
  const notch = add(new THREE.PlaneGeometry(0.012, height * 0.52), 0x2f1824, 14);
  const shield = kind === 'unit'
    ? add(new THREE.PlaneGeometry(track, 0.025), 0x91eaff, 14, 0, height * 0.46) : null;
  const number = kind === 'base' ? boardLabel('number') : null;
  if (number) {
    number.position.y = height + 0.07;
    number.scale.set(0.92, 0.23, 1);
    root.add(number);
  }
  return { root, fill, ghost, notch, shield, number, track, y, lift: kind === 'unit' ? 0.23 : side === 'p' ? 0.42 : 0.29, pct: null };
}

function fillBar(mesh, track, pct) {
  mesh.visible = pct > 0;
  mesh.scale.x = pct;
  mesh.position.x = track * (pct - 1) / 2;
}

function setBar(bar, hp, maxHp, viewRotation, now, { visible = true, shield = 0 } = {}) {
  const pct = THREE.MathUtils.clamp(hp / maxHp, 0, 1);
  const before = bar.pct ?? pct;
  const remaining = bar.ghostAt == null ? 0 : Math.max(0, 1 - (now - bar.ghostAt) / HEALTH_TRAIL_MS);
  let trailing = remaining > 0 ? before + (bar.ghostFrom - before) * remaining : before;
  if (pct < before - 0.0001) {
    bar.ghostFrom = trailing;
    bar.ghostAt = now;
  } else if (pct > before || !remaining) {
    trailing = pct;
    bar.ghostAt = null;
  }
  bar.pct = pct;
  bar.root.visible = visible;
  if (!visible) return;
  bar.root.parent.getWorldQuaternion(HEALTH_PARENT_ROTATION).invert();
  bar.root.quaternion.copy(HEALTH_PARENT_ROTATION).multiply(viewRotation);
  HEALTH_OFFSET.set(0, bar.lift, 0).applyQuaternion(bar.root.quaternion);
  bar.root.position.set(0, bar.y, 0).add(HEALTH_OFFSET);
  fillBar(bar.fill, bar.track, pct);
  fillBar(bar.ghost, bar.track, trailing);
  bar.ghost.visible = trailing > pct + 0.002;
  bar.fill.material.color.setHex(pct <= 0.25 ? HEALTH_LOW : HEALTH_FILL);
  bar.notch.visible = pct > 0.06 && pct <= 0.25;
  bar.notch.position.x = bar.track * (pct * 0.65 - 0.5);
  if (bar.shield) fillBar(bar.shield, bar.track, shield);
  bar.number?.userData.setText(String(Math.max(0, Math.round(hp))), pct <= 0.25 ? '#ffad87' : '#ffe6b5');
}

const DEFAULT_VIEW = Object.freeze({ yaw: 0, pitch: 0, zoom: 1, panX: 0, panZ: 0 });

export class BattleScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.localClippingEnabled = true;   // 地形岛埋进棋盘底座的部分要切掉
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    // 另外 4 个侧面:地形不越出台面上的黄线内框(ARENA.frame)
    this.sideClips = [0, 1, 2, 3].map(() => new THREE.Plane());

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e1a);
    this.scene.fog = new THREE.Fog(0x0a0e1a, 14, 30);

    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 100);
    // 偏俯视、视点略靠己方:己方塔和基地要露在底部手牌 UI 之上
    this.camera.position.set(0, 15.5, 10.2);
    this.camera.lookAt(0, 0, 1.5);

    // 战场根节点:桌面端为单位变换;XR 端被挂到用户前方并缩小成桌面尺寸
    this.world = new THREE.Group();
    this.scene.add(this.world);

    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(4, 10, 6);
    this.scene.add(dir);

    this.terrain = null;             // 当前场景的地形(assets.loadScene 的结果;null = 平面战场)
    this.hm = null;
    this.board = new THREE.Group();  // 地形 + 贴地的覆盖物,换场景时整体重建
    this.world.add(this.board);

    this.unitMeshes = new Map();     // unitId -> group
    this.structMeshes = new Map();   // structId -> group
    this.particles = [];
    this.flashes = [];               // 范围法术闪光 {mesh, life, maxLife}
    this.projectiles = [];           // {mesh, from, to, t, dur}
    this.lunges = new Map();         // unitId -> 剩余时间
    this.damageBursts = new Map();
    this.fx = [];                    // 通用定时特效 {objs, life, maxLife, update}
    this.corpses = [];               // 正在播倒地 / 下沉的单位
    this.dropIns = new Set();        // 刚「降临」的单位 id:出场弹出时从上方 0.3 格落下
    this.previewDescents = [];       // 联机乐观更新已经放过降临的落点 {x, z, cardId, at}(服务器确认的 spawn 不再重复放)
    this.shakeT = 0;
    this.vfx = new VFX(this.world, (x, z) => this.heightAt(x, z));   // 粒子 / 弹道 / 法术特效

    this.view = { ...DEFAULT_VIEW };   // 桌面端视角(右键旋转 / 滚轮缩放 / 中键平移),默认 = 固定俯视角
    this.setBattlefield(null);

    this.insets = { top: 0, bottom: 0, left: 0, right: 0 };
    this.enableMouseView();
    addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight);
      this.fitCamera();
    });
    this.fitCamera();

    this.raycaster = new THREE.Raycaster();
  }

  // 地形高度(战场本地坐标);没有地形时为 0
  heightAt(x, z) {
    const h = this.hm;
    if (!h) return 0;
    const fx = Math.max(0, Math.min(h.nx - 1.001, (x - h.x0) / h.step));
    const fz = Math.max(0, Math.min(h.nz - 1.001, (z - h.z0) / h.step));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const d = h.data, n = h.nx;
    const a = d[j * n + i], b = d[j * n + i + 1], c = d[(j + 1) * n + i], e = d[(j + 1) * n + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
  }

  // 把一个水平的平面网格(圆环 / 圆盘 / 平面)逐顶点贴到地形上。
  // cx, cz:网格中心在战场上的坐标;lift:离地高度;parentY:父节点已有的高度(网格挂在已抬高的组下时)
  drape(mesh, cx, cz, lift = 0.03, parentY = 0) {
    if (!this.hm) return;
    const geo = mesh.geometry, ud = mesh.userData;
    if (ud.drapeGeo !== geo.uuid) {   // 第一次(或几何体被替换):把"躺平"的旋转烘进几何体,记下水平坐标
      if (Math.abs(mesh.rotation.x + Math.PI / 2) < 1e-3) { geo.rotateX(-Math.PI / 2); mesh.rotation.x = 0; }
      ud.drapeBase = Float32Array.from(geo.attributes.position.array);
      ud.drapeGeo = geo.uuid;
    }
    const base = ud.drapeBase, pos = geo.attributes.position, s = mesh.scale.x || 1;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3], bz = base[i * 3 + 2];
      pos.setY(i, (this.heightAt(cx + bx * s, cz + bz * s) + lift - parentY) / (mesh.scale.y || 1));
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
    mesh.position.y = 0;
  }

  // 换战场:t = assets.loadScene() 的结果(null = 平面战场)。地形模型是缓存的共享资源,只摘下不释放
  setBattlefield(t, map = mapForScene(t?.id)) {
    this.map = map;
    this.activeLinks?.clear();
    this.damageBursts.clear();
    this.dropIns.clear();
    for (const fx of this.fx) fx.objs.forEach(o => this.drop(o));
    this.fx.length = 0;
    this.linkLines?.geometry.setDrawRange(0, 0);
    if (this.terrain?.scene) this.board.remove(this.terrain.scene);
    for (const c of [...this.board.children]) this.drop(c);
    this.arena = null;
    this.view = { ...DEFAULT_VIEW };   // 新的一局 / 换场景:桌面视角恢复默认
    this.terrain = t;
    this.hm = t?.hm ?? null;
    this.buildBoard();
    this.setSky(t?.sky ?? null);
    if (this.insets) this.fitCamera();
  }

  // 桌面端背景图(场景的 sky);XR 里不用
  setSky(url) {
    this.skyUrl = url;
    const el = this.renderer.domElement;
    if (url && !this.renderer.xr.isPresenting) {
      el.style.background = `#0a0e1a url("${url}") center / cover no-repeat`;
      this.scene.background = null;
    } else {
      el.style.background = '';
      if (!this.renderer.xr.isPresenting) this.scene.background = new THREE.Color(0x0a0e1a);
    }
  }

  buildBoard() {
    const W = FIELD_W * 2 + 0.6, L = FIELD_HALF * 2 + 0.6;
    if (this.terrain) {
      this.board.add(this.terrain.scene);
      // 地图放在红蓝棋盘底座上:悬浮岛的岩石底部埋在底座里,切掉台面以下的部分
      this.arena = buildArena(this.getModelEnv());
      this.board.add(this.arena);
      this.terrain.scene.traverse(o => {
        if (!o.isMesh) return;
        for (const m of [].concat(o.material)) { m.clippingPlanes = [this.clipPlane, ...this.sideClips]; m.clipShadows = true; }
      });
      this.updateClipPlanes();
      this.buildProps();
    } else this.buildFlatBoard(W, L);

    this.buildTerrain();
    this.buildOverlays();
  }

  buildFlatBoard(W, L) {
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(W, 0.3, L),
      new THREE.MeshStandardMaterial({ color: 0x1c2640, roughness: 0.85 })
    );
    board.position.y = -0.15;
    this.board.add(board);

    // 双方半场轻微染色,一眼分清敌我
    for (const [z, c] of [[L / 4, 0x22355a], [-L / 4, 0x3a2430]]) {
      const half = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, L / 2 - 0.05),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45 }));
      half.rotation.x = -Math.PI / 2;
      half.position.set(0, 0.005, z);
      this.board.add(half);
    }
    // 中线
    const mid = new THREE.Mesh(new THREE.BoxGeometry(W, 0.02, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x6a7aa0 }));
    mid.position.y = 0.02;
    this.board.add(mid);
    // 边框
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x3a4a6e });
    for (const [w, l, x, z] of [[W, 0.06, 0, L / 2], [W, 0.06, 0, -L / 2], [0.06, L, W / 2, 0], [0.06, L, -W / 2, 0]]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, l), edgeMat);
      e.position.set(x, 0.02, z);
      this.board.add(e);
    }
  }

  buildOverlays() {
    // 部署区提示(拖单位牌时显示:己方半场中线 DEPLOY_LINE 以外);有地形时细分后贴地
    const dz = FIELD_HALF - DEPLOY_LINE;
    const deployCanvas = document.createElement('canvas');
    deployCanvas.width = 128;
    deployCanvas.height = 80;
    this.deployMask = deployCanvas.getContext('2d');
    this.deployMaskKey = null;
    this.deployMaskGame = null;
    this.deployZone = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W * 2, dz, this.hm ? 48 : 1, this.hm ? 30 : 1),
      new THREE.MeshBasicMaterial({ color: 0x5ac8ff, map: new THREE.CanvasTexture(deployCanvas), transparent: true, opacity: 0, depthWrite: false }));
    this.deployZone.rotation.x = -Math.PI / 2;
    this.deployZone.position.set(0, 0.012, DEPLOY_LINE + dz / 2);
    this.board.add(this.deployZone);
    this.drape(this.deployZone, 0, DEPLOY_LINE + dz / 2, 0.035);

    // 落点预览:攻击/作用范围圈 + 中心点
    this.placeRing = ringMesh(1, 0x5ac8ff, 0.9, 0.06);
    this.placeRing.position.y = 0.03;
    this.placeRing.visible = false;
    this.board.add(this.placeRing);
    this.placeArea = new THREE.Mesh(new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({ color: 0x5ac8ff, transparent: true, opacity: 0.12, depthWrite: false }));
    this.placeArea.rotation.x = -Math.PI / 2;
    this.placeArea.position.y = 0.025;
    this.placeArea.visible = false;
    this.board.add(this.placeArea);
    this.placeDot = new THREE.Mesh(new THREE.CircleGeometry(UNIT_R, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
    this.placeDot.rotation.x = -Math.PI / 2;
    this.placeDot.position.y = 0.035;
    this.placeDot.visible = false;
    this.board.add(this.placeDot);
    // 单位 / 建筑牌的落点:「锁定」法阵 + 天空锁定光束(法术牌仍用上面的范围圈)
    this.deployMarker = new DeployMarker((m, x, z, lift) => this.drape(m, x, z, lift), (x, z) => this.heightAt(x, z));
    this.board.add(this.deployMarker.group);
  }

  // ── 地形:岩石 / 裂隙 / 星核 ──
  buildTerrain() {
    if (this.terrain) return this.buildTerrainOverlays();
    // 分路长墙(平面战场兜底时用方块表示)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a4f66, roughness: 0.9, flatShading: true });
    for (const wall of this.map.walls) for (const w of wallSegments(wall)) {
      const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(wall.r * 2, 0.5, len + wall.r), wallMat);
      m.position.set((w.x1 + w.x2) / 2, 0.25, (w.z1 + w.z2) / 2);
      m.rotation.y = Math.atan2(w.x2 - w.x1, w.z2 - w.z1);
      this.board.add(m);
    }
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a4f66, roughness: 0.9, flatShading: true });
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x8a7aff, emissive: 0x5a3aff, emissiveIntensity: 0.6, roughness: 0.3 });
    for (const o of this.map.obstacles) {
      const g = new THREE.Group();
      // 主岩 + 几块碎岩 + 一根发光晶簇
      const main = new THREE.Mesh(new THREE.DodecahedronGeometry(o.r * 0.75, 0), rockMat);
      main.scale.set(1, 0.7, 1);
      main.position.y = o.r * 0.45;
      g.add(main);
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + o.x;
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(o.r * 0.20, 0), rockMat);
        r.position.set(Math.cos(a) * o.r * 0.55, o.r * 0.12, Math.sin(a) * o.r * 0.55);
        r.rotation.set(a, a * 2, 0);
        g.add(r);
      }
      const cr = new THREE.Mesh(new THREE.ConeGeometry(o.r * 0.16, o.r * 0.75, 5), crystalMat);
      cr.position.set(o.r * 0.2, o.r * 0.67, -o.r * 0.1);
      cr.rotation.z = -0.25;
      g.add(cr);
      g.position.set(o.x, 0, o.z);
      this.board.add(g);
    }
    // 裂隙判定边界
    this.buildRiftOverlays();
    // 星核:六边形平台 + 占领进度环 + 归属光柱
    const N = this.map.node;
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(N.r, N.r * 1.05, 0.1, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a3456, roughness: 0.5, metalness: 0.4 }));
    plat.position.set(N.x, 0.05, N.z);
    this.board.add(plat);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), coreMat);
    core.position.set(N.x, 0.55, N.z);
    this.board.add(core);
    const progBg = ringMesh(N.r, 0xffcf83, 0.42, 0.045);
    progBg.position.set(N.x, 0.11, N.z);
    this.board.add(progBg);
    const prog = new THREE.Mesh(new THREE.RingGeometry(N.r * 0.82, N.r * 0.92, 64, 1, 0, 0.001),
      new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    prog.rotation.x = -Math.PI / 2;
    prog.position.set(N.x, 0.115, N.z);
    this.board.add(prog);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(N.x, 1.3, N.z);
    this.board.add(beam);
    this.nodeVis = { core, coreMat, prog, progBg, beam, lastP: null };
  }

  // 外圈装饰物:图像 AI 交付的装饰物精灵,摆在 Blender 导出的位置上(没有装饰物图就不放)
  buildProps() {
    const t = this.terrain;
    // 有 3D 配景包(assets/props/<scene>/kit.json)就用 3D 配景;加载是异步的,先放立绘,到了再替换
    const sprites = this.buildPropSprites();
    if (!t?.propKit) return;
    loadKit(t.id).then(kit => {
      if (!kit || this.terrain !== t) return;   // 期间换了场景:丢弃
      sprites.forEach(sp => { this.board.remove(sp); sp.material.dispose(); });
      this.board.add(buildProps3d(kit, layoutProps(kit, t.id), (x, z) => this.heightAt(x, z), this.getModelEnv()));
    });
  }

  // 单位模型 / 配景共用的室内环境反射(只有平行光 + 环境光时模型偏暗发灰)
  getModelEnv() {
    if (!this.modelEnv) this.modelEnv = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    return this.modelEnv;
  }

  buildPropSprites() {
    const t = this.terrain, props = t?.propTextures ?? [], made = [];
    if (!props.length) return made;
    const add = (tex, x, z, y, size) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.08, depthWrite: true }));
      sp.scale.set(size, size, 1);
      sp.center.set(0.5, 0.06);
      sp.position.set(x, y, z);
      this.board.add(sp);
      made.push(sp);
    };
    // 大型地标(按概念图):远半区两侧各两个放大的装饰物。放在相机视野里画面两侧的空白处;
    // 都在战场外、远半区,只会挡住更远处战场外的地方,不挡战场
    const W = FIELD_W;
    const marks = [[-(W + 0.95), -4.8, 0, 2.8], [W + 0.95, -4.8, 1 % props.length, 2.6],
      [-(W + 1.0), -1.4, 2 % props.length, 2.2], [W + 1.0, -1.8, 0, 2.1]];
    for (const [x, z, pi, size] of marks) add(props[pi], x, z, -0.08, size);
    // 其余位置散布普通大小的装饰物,避开地标
    (t.spots ?? []).forEach(([x, z, h, k], i) => {
      if (marks.some(([mx, mz, , ms]) => Math.hypot(x - mx, z - mz) < ms * 0.55)) return;
      add(props[i % props.length], x, z, h - 0.03, 1.1 * k);
    });
    return made;
  }

  buildRiftOverlays() {
    this.riftHint = null;
    this.riftPreview = null;
    for (const rift of this.map.rifts) {
      const edge = ringMesh(rift.r, 0xc4a1ed, 0.65, 0.045);
      const hatching = new THREE.Mesh(new THREE.RingGeometry(rift.r * 0.82, rift.r * 0.96, 48),
        new THREE.MeshBasicMaterial({ color: 0x73568f, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
      hatching.rotation.x = -Math.PI / 2;
      for (const mesh of [edge, hatching]) {
        mesh.position.set(rift.x, 0.025, rift.z);
        this.board.add(mesh);
        this.drape(mesh, rift.x, rift.z, 0.035);
      }
    }
  }

  // 有真实地形时:岩石、盆地、台地都在模型里,这里只加游戏信息层
  buildTerrainOverlays() {
    this.buildRiftOverlays();
    const N = this.map.node, hN = this.heightAt(N.x, N.z);
    this.nodeY = hN;
    this.addAltar(N, hN);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), coreMat);
    core.position.set(N.x, hN + 0.55, N.z);
    this.board.add(core);
    const progBg = ringMesh(N.r, 0xffcf83, 0.42, 0.045);
    progBg.position.set(N.x, 0, N.z);
    this.board.add(progBg);
    this.drape(progBg, N.x, N.z, 0.04);
    const prog = new THREE.Mesh(new THREE.RingGeometry(N.r * 0.82, N.r * 0.92, 64, 1, 0, 0.001),
      new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    prog.rotation.x = -Math.PI / 2;
    prog.position.set(N.x, 0, N.z);
    this.board.add(prog);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(N.x, hN + 1.3, N.z);
    this.board.add(beam);
    this.nodeVis = { core, coreMat, prog, progBg, beam, lastP: null };
  }

  // 中线星核放在悬浮祭坛上(assets/arena/altar.glb);祭坛到位后隐藏程序化的八面体内核,进度环和光柱保留
  addAltar(N, y) {
    const t = this.terrain;
    new GLTFLoader().load('assets/arena/altar.glb', g => {
      if (this.terrain !== t || !this.nodeVis) return;   // 期间换了场景:丢弃
      const m = g.scene, box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
      const k = (N.r * 1.7) / Math.max(size.x, size.z);   // 祭坛直径 ≈ 占领圈直径的 85%
      m.scale.setScalar(k);
      // 台面(最宽处大约在模型高度的 55%)对齐地面,悬浮的岩石底部埋进地里
      m.position.set(N.x - (box.min.x + box.max.x) / 2 * k, y - (box.min.y + size.y * 0.5) * k, N.z - (box.min.z + box.max.z) / 2 * k);
      m.traverse(o => { if (o.isMesh) for (const mt of [].concat(o.material)) if (mt.isMeshStandardMaterial) { mt.envMap = this.getModelEnv(); mt.envMapIntensity = 0.8; } });
      m.name = 'altar';
      this.board.add(m);
      this.nodeVis.core.visible = false;
    }, undefined, () => { /* 没有祭坛模型:保留程序化内核 */ });
  }

  // 星核进度/归属表现
  syncNode(node) {
    const v = this.nodeVis, N = this.map.node;
    const p = node.progress;
    if (Math.abs((v.lastP ?? 9) - p) > 0.004) {
      v.lastP = p;
      v.prog.geometry.dispose();
      v.prog.geometry = new THREE.RingGeometry(N.r * 0.82, N.r * 0.92, 64, 1, Math.PI / 2, Math.max(0.001, Math.abs(p) * Math.PI * 2));
      if (this.hm) { v.prog.rotation.x = -Math.PI / 2; this.drape(v.prog, N.x, N.z, 0.045); }
      v.prog.material.color.setHex(p >= 0 ? SIDE_COLOR.p : SIDE_COLOR.e);
    }
    const col = node.owner ? SIDE_COLOR[node.owner] : 0xffcf83;
    const boosted = node.owner && !node.contested;
    v.prog.material.opacity = node.contested ? 0.5 : 0.98;
    v.progBg.material.color.setHex(node.contested ? 0xffd65c : node.owner ? col : 0xffcf83);
    v.progBg.material.opacity = node.contested ? 0.85 : 0.48;
    v.coreMat.color.setHex(0xffbc58);
    v.coreMat.emissive.setHex(0xff8c30);
    v.beam.material.color.setHex(col);
    v.beam.material.opacity = boosted ? 0.16 : 0;
    const t = performance.now() / 1000;
    v.core.rotation.y = t * (node.owner ? 1.6 : 0.5);
    v.core.position.y = (this.nodeY ?? 0) + 0.55 + Math.sin(t * 2) * 0.06;
    v.coreMat.emissiveIntensity = 0.45;
  }

  // ── 落点预览 ──
  updateDeployMask(game, card) {
    const blockers = card.type === 'building'
      ? [...game.structures, ...game.units.filter(unit => unit.building)]
          .filter(unit => !unit.dead).map(unit => [unit.x, unit.z, unit.radius])
      : [];
    const key = JSON.stringify([card.type, blockers]);
    if (this.deployMaskGame === game && this.deployMaskKey === key) return;
    this.deployMaskGame = game;
    this.deployMaskKey = key;
    const ctx = this.deployMask;
    const { width, height } = ctx.canvas;
    const mask = ctx.createImageData(width, height);
    for (let row = 0; row < height; row++) {
      const z = DEPLOY_LINE + (row + 0.5) / height * (FIELD_HALF - DEPLOY_LINE);
      for (let col = 0; col < width; col++) {
        const x = ((col + 0.5) / width * 2 - 1) * FIELD_W;
        const i = (row * width + col) * 4;
        mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = 255;
        mask.data[i + 3] = game.canDeployAt('p', card, x, z) ? 255 : 0;
      }
    }
    ctx.putImageData(mask, 0, 0);
    this.deployZone.material.map.needsUpdate = true;
  }

  // 传 null 隐藏部署与落点提示。
  riftAlongPreview(opts) {
    const { x, z, card, game } = opts;
    const near = this.map.rifts.filter(r => Math.hypot(x - r.x, z - r.z) < r.r + 3.5);
    if (!near.length) return null;
    const now = performance.now();
    const prev = this.riftPreview;
    if (prev && prev.card === card && now - prev.at < 120) return near.includes(prev.rift) ? prev.rift : null;
    const path = game.previewPath('p', card, x, z);
    const rift = near.find(r => path?.some((end, i) => {
      if (!i) return false;
      const start = path[i - 1], dx = end.x - start.x, dz = end.z - start.z;
      const len2 = dx * dx + dz * dz;
      if (!len2) return false;
      const p = Math.max(0, Math.min(1, ((r.x - start.x) * dx + (r.z - start.z) * dz) / len2));
      return Math.hypot(start.x + dx * p - r.x, start.z + dz * p - r.z) < r.r;
    })) ?? null;
    this.riftPreview = { card, at: now, rift };
    return rift;
  }

  showPlacement(opts) {
    const show = Number.isFinite(opts?.x) && Number.isFinite(opts?.z);
    const marker = show && opts.isUnit;   // 单位 / 建筑:锁定法阵;法术:范围圈
    this.placeRing.visible = this.placeArea.visible = show && !marker;
    this.placeDot.visible = false;
    if (!marker) this.deployMarker.hide();
    const showZone = opts?.showDeployZone;
    this.deployZone.material.opacity = showZone ? 0.18 : 0;
    if (showZone) this.updateDeployMask(opts.game, opts.card);
    const ground = show && opts.valid && opts.card?.type === 'unit' && !opts.card.air;
    if (!ground) this.riftPreview = null;
    const here = ground ? this.map.rifts.find(r => Math.hypot(opts.x - r.x, opts.z - r.z) < r.r) : null;
    const rift = here || (ground && opts.game ? this.riftAlongPreview(opts) : null);
    if (rift && !this.riftHint) {
      this.riftHint = boardLabel();
      this.board.add(this.riftHint);
    }
    if (this.riftHint) this.riftHint.visible = !!rift;
    if (!show) return;
    if (rift) {
      this.riftHint.position.set(rift.x, this.heightAt(rift.x, rift.z) + 0.52, rift.z);
      const key = here ? 'riftSlowHere' : 'riftSlowAhead';
      this.riftHint.userData.setText(t(key, { n: Math.round((1 - rift.slow) * 100) }), '#ead7ff');
    }
    if (marker) {
      const f = opts.card?.faction;
      this.deployMarker.set({ x: opts.x, z: opts.z, radius: opts.radius, faction: f, color: FACTIONS[f]?.color,
        state: !opts.valid ? 'bad' : here ? 'rift' : 'ok' });
      return;
    }
    const color = opts.valid ? (here ? 0xd1a6ff : 0x5ac8ff) : 0xff4444;
    for (const m of [this.placeRing, this.placeArea, this.placeDot]) {
      m.position.x = opts.x; m.position.z = opts.z;
    }
    const r = Math.max(0.3, opts.radius);
    this.placeRing.scale.setScalar(r);
    this.placeArea.scale.setScalar(r);
    if (this.hm) {
      this.drape(this.placeRing, opts.x, opts.z, 0.06);
      this.drape(this.placeArea, opts.x, opts.z, 0.05);
      this.drape(this.placeDot, opts.x, opts.z, 0.07);
    }
    this.placeRing.material.color.setHex(color);
    this.placeArea.material.color.setHex(color);
    this.placeRing.material.opacity = opts.valid ? 0.9 : 1;
  }

  // 双方势力:塔和核心按势力换立绘(没有立绘时用几何体)
  setFactions(p, e) {
    if (this.factions?.p === p && this.factions?.e === e) return;
    this.factions = { p, e };
    this.clearStructures();
  }

  // ── 建筑 ──
  makeStructMesh(s) {
    const mdl = structModel(this.factions?.[s.side], s.kind);
    if (mdl?.ready) return this.makeStructModel(s, mdl);
    const tex = structTexture(this.factions?.[s.side], s.kind);
    if (tex) return this.makeStructSprite(s, tex);
    const color = s.side === 'p' ? 0x3a6ea5 : 0xa53a3a;
    const group = new THREE.Group();
    const isBase = s.kind === 'base';
    // 核心:粗八棱柱;前哨塔:矮宽六棱堡;侧翼塔:细高四棱塔
    const h = isBase ? 1.2 : s.kind === 'outpost' ? 0.75 : 1.15;
    const body = new THREE.Mesh(
      isBase ? new THREE.CylinderGeometry(s.radius * 0.9, s.radius * 1.1, h, 8)
        : s.kind === 'outpost' ? new THREE.CylinderGeometry(s.radius * 0.95, s.radius * 1.1, h, 6)
        : new THREE.CylinderGeometry(s.radius * 0.55, s.radius * 0.85, h, 4),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.45 })
    );
    body.position.y = h / 2;
    group.add(body);
    // 塔顶
    const top = new THREE.Mesh(isBase ? new THREE.OctahedronGeometry(s.radius * 0.45)
        : new THREE.ConeGeometry(s.radius * (s.kind === 'pylon' ? 0.5 : 0.8), 0.35, s.kind === 'pylon' ? 4 : 6),
      new THREE.MeshStandardMaterial({ color: 0xd8c27a, roughness: 0.5 }));
    top.position.y = h + 0.17;
    group.add(top);
    // 射程圈(常驻淡显示)
    const range = ringMesh(s.range + s.radius, SIDE_COLOR[s.side], 0.18, 0.03);
    range.position.y = 0.015;
    group.add(range);
    const bar = hpBar(isBase ? 1.28 : 0.93, h + 0.42, s.kind, s.side);
    group.add(bar.root);
    const gy = this.heightAt(s.x, s.z);
    group.position.set(s.x, gy, s.z);
    this.drape(range, s.x, s.z, 0.03, gy);
    group.userData = { body, top, bar, range, h };
    this.world.add(group);
    return group;
  }

  // 立绘版塔 / 核心:正对镜头的精灵 + 脚下一圈阵营色底座(敌我靠底座颜色区分)
  makeStructSprite(s, tex) {
    const group = new THREE.Group();
    const h = s.kind === 'base' ? 2.1 : s.kind === 'pylon' ? 1.7 : 1.45;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.08, depthWrite: true }));
    sprite.scale.set(h, h, 1);
    sprite.center.set(0.5, 0.05);
    group.add(sprite);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(s.radius * 1.05, 32),
      new THREE.MeshBasicMaterial({ color: SIDE_COLOR[s.side], transparent: true, opacity: 0.35 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.012;
    group.add(pad);
    const range = ringMesh(s.range + s.radius, SIDE_COLOR[s.side], 0.18, 0.03);
    range.position.y = 0.015;
    group.add(range);
    const bar = hpBar(s.kind === 'base' ? 1.28 : 0.93, h * 0.95 + 0.15, s.kind, s.side);
    group.add(bar.root);
    const gy = this.heightAt(s.x, s.z);
    group.position.set(s.x, gy, s.z);
    this.drape(pad, s.x, s.z, 0.02, gy);
    this.drape(range, s.x, s.z, 0.03, gy);
    group.userData = { sprite, pad, bar, range, h };
    this.world.add(group);
    return group;
  }

  // 3D 塔与核心受高度和占地双重约束。材质逐个克隆用于受击与摧毁反馈。
  makeStructModel(s, entry) {
    const group = new THREE.Group();
    const targetHeight = s.kind === 'base' ? 1.9 : s.kind === 'pylon' ? 1.6 : 1.35;
    const root = entry.scene.clone(true);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    const maxFootprint = s.radius * (s.kind === 'base' ? 2.8 : 2.65);
    const k = Math.min(targetHeight / Math.max(size.y, 1e-3),
      maxFootprint / Math.max(size.x, size.z, 1e-3));
    const h = size.y * k;
    root.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const model = new THREE.Group();
    model.add(root);
    model.scale.setScalar(k);
    // Tripo 导出正面朝 +X:先转到 +Z,己方(+Z 半场)的建筑再转 180° 朝向敌方
    model.rotation.y = -Math.PI / 2 + (s.side === 'p' ? Math.PI : 0);
    const mats = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      o.userData.sharedGeo = true;
      o.material = [].concat(o.material).map(m => { const c = m.clone(); if (c.isMeshStandardMaterial) { c.envMap = this.getModelEnv(); c.envMapIntensity = 0.85; } mats.push(c); return c; });
      if (o.material.length === 1) o.material = o.material[0];
    });
    group.add(model);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(s.radius * 1.05, 32),
      new THREE.MeshBasicMaterial({ color: SIDE_COLOR[s.side], transparent: true, opacity: 0.35 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.012;
    group.add(pad);
    const range = ringMesh(s.range + s.radius, SIDE_COLOR[s.side], 0.18, 0.03);
    range.position.y = 0.015;
    group.add(range);
    const bar = hpBar(s.kind === 'base' ? 1.28 : 0.93, h + 0.2, s.kind, s.side);
    group.add(bar.root);
    const gy = this.heightAt(s.x, s.z);
    group.position.set(s.x, gy, s.z);
    this.drape(pad, s.x, s.z, 0.02, gy);
    this.drape(range, s.x, s.z, 0.03, gy);
    const emission = mats.filter(mat => mat.emissive).map(mat => {
      const base = mat.emissive.clone().multiplyScalar(mat.emissiveIntensity);
      mat.emissiveIntensity = 1;
      return { mat, base };
    });
    group.userData = { model, mats, emission, pad, bar, range, h };
    this.world.add(group);
    return group;
  }

  syncStructures(structures, camera) {
    const viewRotation = camera.getWorldQuaternion(new THREE.Quaternion());
    const now = performance.now();
    for (const s of structures) {
      let g = this.structMeshes.get(s.id);
      // 模型下载完成:从立绘 / 几何体换成模型
      if (g && !g.userData.model && structModel(this.factions?.[s.side], s.kind)?.ready) { this.drop(g); g = null; }
      if (!g) { g = this.makeStructMesh(s); this.structMeshes.set(s.id, g); }
      const ud = g.userData;
      if (ud.model) {
        // 受击:轻微抖动 + 闪白
        const f = Math.max(0, 1 - (now - (ud.hitAt || 0)) / 160);
        ud.model.position.x = f ? Math.sin(now / 18) * 0.035 * f : 0;
        if (!ud.ruined && ud.lastFlash !== f) {
          ud.lastFlash = f;
          for (const { mat, base } of ud.emission) {
            const flash = f * 0.6;
            mat.emissive.setRGB(base.r + flash, base.g + flash, base.b + flash);
          }
        }
      }
      if (s.dead) {
        if (!ud.ruined && ud.model) {   // 模型版:塌成矮废墟、变暗
          ud.ruined = true;
          ud.model.scale.y *= 0.32;
          for (const m of ud.mats) { m.color?.multiplyScalar(0.35); if (m.emissive) m.emissive.setScalar(0); }
          ud.pad.visible = ud.range.visible = ud.bar.root.visible = false;
        } else if (!ud.ruined && ud.sprite) {   // 立绘版:压扁变暗当废墟
          ud.ruined = true;
          ud.sprite.scale.y = ud.h * 0.35;
          ud.sprite.material.color.setHex(0x3a3f4c);
          ud.pad.visible = ud.range.visible = ud.bar.root.visible = false;
        } else if (!ud.ruined) {   // 摧毁 → 变成矮小的废墟
          ud.ruined = true;
          ud.body.scale.set(1.1, 0.25, 1.1);
          ud.body.position.y = ud.h * 0.12;
          ud.body.material.color.setHex(0x333844);
          ud.body.material.emissiveIntensity = 0;
          ud.top.visible = ud.range.visible = ud.bar.root.visible = false;
        }
        continue;
      }
      setBar(ud.bar, s.hp, s.maxHp, viewRotation, now);
    }
  }

  // 从场景移除并释放 GPU 资源(几何体、材质;贴图是共享缓存,不释放)
  drop(obj) {
    obj.parent?.remove(obj);
    obj.traverse(o => {
      o.userData.ownedTexture?.dispose();
      if (!o.userData.sharedGeo) o.geometry?.dispose();   // 模型实例共用几何体,不能释放
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m?.dispose();
    });
  }

  clearStructures() {
    for (const g of this.structMeshes.values()) this.drop(g);
    this.structMeshes.clear();
  }

  // ── 单位 / 建筑卡 ──
  makeUnitMesh(unit) {
    const card = unit.card;
    const fac = FACTIONS[card.faction];
    const color = fac.color;
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.3,
    });
    const group = new THREE.Group();
    let body, barY, lift = 0, sprite = null;
    const tex = unitTexture(card.id);
    const mdl = unitModel(card.id);
    let model = null;
    const role = card.cocoon ? null : card.spawn || card.deathSpawn || card.aura ? 'support'
      : card.hp + (card.shield || 0) >= 260 && !unit.building ? 'tank'
      : card.atk > 0 && card.range > 1.2 ? 'ranged' : null;
    const stance = role === 'tank' ? 0.9 : role === 'support' && !unit.building ? 1.06 : 1;

    if (mdl?.ready) {
      // 3D 模型(Tripo 生成):高度和立绘一致,略矮一点(立绘图里有留白)
      const small = (card.count || 1) > 1 || card.token;
      let h = unit.building ? 1.1 : (0.75 + 0.1 * Math.min(card.cost, 6)) * (small ? 0.72 : 1) * 0.85;
      lift = unit.air ? 0.75 : 0;
      // 扁宽的静态模型(战车、巢穴、无人机)按高度缩放会占地过大:再按碰撞直径限一个占地上限(人形不限,T 字静止姿势会把宽度算大)
      const maxFoot = mdl.meta.rig === 'biped' ? 0 : unit.radius * 2 * (unit.building ? 1.8 : unit.air ? 3.0 : 2.4);
      body = this.buildModel(mdl, h, maxFoot);
      body.scale.y *= stance;
      h = body.userData.height * stance;
      body.position.y = lift;
      body.rotation.y = unit.side === 'p' ? Math.PI : 0;   // 先朝向敌方
      model = body.userData.model;
      barY = h * 1.12 + lift;
    } else if (tex) {
      // 立绘公告板:始终正对镜头的 2D 精灵(美术资源到位后自动启用)
      const small = (card.count || 1) > 1 || card.token;
      const h = unit.building ? 1.25 : (0.75 + 0.1 * Math.min(card.cost, 6)) * (small ? 0.72 : 1);
      lift = unit.air ? 0.75 : 0;
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.08, depthWrite: true }));
      sprite.scale.set(h, h * stance, 1);
      sprite.center.set(0.5, 0.06);           // 锚点在脚底附近
      sprite.position.y = lift;
      body = sprite;
      barY = h * stance * 0.98 + lift;
    } else if (unit.building) {
      // 建筑卡:深色底座 + 势力形状的顶
      body = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.22, 0.78),
        new THREE.MeshStandardMaterial({ color: 0x2a3148, roughness: 0.7 }));
      pad.position.y = 0.11;
      body.add(pad);
      const top = this.factionShape(fac.shape, 0.26, mat);
      top.position.y = 0.5;
      body.add(top);
      if (card.spawn) {   // 产兵建筑:门洞朝向敌方
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.05), new THREE.MeshBasicMaterial({ color: 0x111111 }));
        door.position.set(0, 0.1, unit.side === 'p' ? -0.4 : 0.4);
        body.add(door);
      }
      barY = 1.05;
    } else {
      const small = (card.count || 1) > 1 || card.token;
      const scale = (0.24 + 0.05 * Math.min(card.cost, 6)) * (small ? 0.72 : 1);
      body = this.factionShape(fac.shape, scale, mat);
      lift = unit.air ? 0.85 : (fac.shape === 'octa' ? 0.15 : 0);
      body.position.y = scale * 1.05 + lift;
      barY = scale * 2.3 + 0.15 + lift;
      if (card.siege) {   // 攻城:前方撞角
        const ram = new THREE.Mesh(new THREE.ConeGeometry(scale * 0.35, scale * 0.9, 6), mat);
        ram.rotation.x = Math.PI / 2;
        ram.position.z = scale * 0.9;
        body.add(ram);
      }
      if (card.shield) {  // 护盾兵:前方盾牌
        const sh = new THREE.Mesh(new THREE.BoxGeometry(scale * 1.6, scale * 1.4, 0.05),
          new THREE.MeshStandardMaterial({ color: 0x66ddff, emissive: 0x2299cc, emissiveIntensity: 0.5, transparent: true, opacity: 0.75 }));
        sh.position.z = scale * 0.85;
        body.add(sh);
      }
    }
    group.add(body);

    // 飞行单位的地面影子
    let shadow = null;
    if (unit.air || model) {
      shadow = new THREE.Mesh(new THREE.CircleGeometry(model && !unit.air ? 0.26 : 0.2, 20),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.02;
      group.add(shadow);
    }

    // 阵营底环(蓝=玩家 红=敌方)
    const ring = ringMesh(unit.radius + 0.10, SIDE_COLOR[unit.side], 0.92, 0.055);
    if (unit.side === 'e') {
      const r = unit.radius + 0.10;
      ring.geometry.dispose();
      ring.geometry = new THREE.RingGeometry(r - 0.055, r, 4, 1, Math.PI / 4);
    }
    if (role) {
      const geometry = role === 'tank' ? new THREE.PlaneGeometry(0.16, 0.12)
        : new THREE.CircleGeometry(0.085, role === 'support' ? 6 : 3);
      const pip = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xf8ead4, side: THREE.DoubleSide }));
      pip.position.set(0, -unit.radius - 0.15, 0.015);
      ring.add(pip);
    }
    ring.position.y = 0.03;
    group.add(ring);

    // 范围圈:远程攻击范围 / 光环(金)/ 脉冲
    let rangeRing = null;
    const ud0 = {};
    if (unit.range > 1.2 && unit.atk > 0) {
      rangeRing = ringMesh(unit.range + unit.radius, SIDE_COLOR[unit.side], 0.16, 0.025);
      rangeRing.position.y = 0.02;
      group.add(rangeRing);
    }
    const auraR = card.aura?.radius ?? card.pulse?.radius;
    if (auraR) {
      const ar = ringMesh(auraR, card.aura ? 0xffd24a : fac.color, 0.28, 0.04);
      ar.position.y = 0.022;
      group.add(ar);
      ud0.ar = ar;
    }

    const bar = hpBar(unit.building ? 0.83 : 0.64, barY);
    group.add(bar.root);
    let hatch = null;
    if (card.cocoon) {
      const radius = unit.radius + 0.20;
      hatch = ringMesh(radius, 0xe2b4ff, 0.96, 0.065);
      hatch.geometry.rotateZ(Math.PI / 2);
      hatch.position.y = 0.062;
      hatch.geometry.setDrawRange(0, 64 * 6);
      group.add(hatch);
    }
    group.userData = { ...ud0, body, bar, hatch, ring, rangeRing, baseY: body.position.y, side: unit.side,
      cardId: card.id, tint: null, mat, sprite, model, shadow, facing: unit.side === 'p' ? 1 : -1,
      wantModel: !!mdl && !mdl.ready, born: performance.now(),
      hover: unit.air || (!sprite && !model && fac.shape === 'octa') };
    this.world.add(group);
    return group;
  }

  factionShape(shape, scale, mat) {
    switch (shape) {
      case 'box':   return new THREE.Mesh(new THREE.BoxGeometry(scale * 1.3, scale * 1.5, scale * 1.3), mat);
      case 'octa':  return new THREE.Mesh(new THREE.OctahedronGeometry(scale * 1.05), mat);
      case 'blob':  return new THREE.Mesh(new THREE.IcosahedronGeometry(scale, 0), mat);
      case 'spike': return new THREE.Mesh(new THREE.ConeGeometry(scale * 0.85, scale * 2.1, 5), mat);
      default:      return new THREE.Mesh(new THREE.SphereGeometry(scale), mat);
    }
  }

  updateRiftMarker(unit, group, now) {
    const ud = group.userData;
    const inside = !unit.air && !unit.building && !unit.dead
      && this.map.rifts.some(rift => Math.hypot(unit.x - rift.x, unit.z - rift.z) < rift.r);
    if (inside && !ud.inRift) {
      if (!this.riftMarkerTexture) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 96;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#2c1e46';
        ctx.beginPath(); ctx.arc(48, 48, 40, 0, Math.PI * 2); ctx.fill();
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.strokeStyle = '#e3c0ff'; ctx.lineWidth = 7;
        for (const y of [32, 51]) {
          ctx.beginPath(); ctx.moveTo(31, y); ctx.lineTo(48, y + 12); ctx.lineTo(65, y); ctx.stroke();
        }
        this.riftMarkerTexture = new THREE.CanvasTexture(canvas);
        this.riftMarkerTexture.colorSpace = THREE.SRGBColorSpace;
      }
      if (!ud.riftMarker) {
        ud.riftMarker = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.riftMarkerTexture, transparent: true, depthWrite: false,
        }));
        ud.riftMarker.scale.set(0.44, 0.44, 1);
        group.add(ud.riftMarker);
      }
      ud.riftMarkerUntil = now + 650;
    }
    ud.inRift = inside;
    const marker = ud.riftMarker;
    if (!marker) return;
    const remaining = (ud.riftMarkerUntil - now) / 650;
    marker.visible = remaining > 0;
    if (!marker.visible) return;
    marker.position.y = ud.bar.y + 0.34 + (1 - remaining) * 0.25;
    marker.material.opacity = Math.min(1, remaining * 2.5);
  }

  syncUnits(units, camera) {
    this.lastUnits = units;
    const alive = new Set();
    this.lastCam = camera;
    const viewRotation = camera.getWorldQuaternion(new THREE.Quaternion());
    const now = performance.now();
    for (const u of units) {
      alive.add(u.id);
      let g = this.unitMeshes.get(u.id);
      // 进化后卡牌变了 → 重建;模型下载完成 → 从立绘换成模型
      if (g && (g.userData.cardId !== u.card.id || (g.userData.wantModel && unitModel(u.card.id)?.ready))) {
        const { born, inRift } = g.userData, keep = g.userData.cardId === u.card.id;
        this.drop(g); g = null;
        g = this.makeUnitMesh(u);
        g.userData.inRift = inRift;
        if (keep) g.userData.born = born - 1000;   // 换模型不重播出场动画
        this.unitMeshes.set(u.id, g);
      }
      if (!g) { g = this.makeUnitMesh(u); this.unitMeshes.set(u.id, g); }
      const gy = this.heightAt(u.x, u.z);
      const ud = g.userData;
      const dtF = Math.min(0.05, Math.max(0, (now - (ud.lastT || now)) / 1000));
      ud.lastT = now;
      // 实际移动速度(平滑):决定走 / 站的动画
      if (ud.prev && dtF > 0) {
        const v = Math.hypot(u.x - ud.prev.x, u.z - ud.prev.z) / dtF;
        ud.vel = (ud.vel || 0) * 0.8 + v * 0.2;
        if (v > 0.02) ud.moveDir = Math.atan2(u.x - ud.prev.x, u.z - ud.prev.z);
      }
      ud.prev = { x: u.x, z: u.z };
      const moving = !u.building && (ud.vel || 0) > 0.08 && u.status.stun <= 0;
      g.position.set(u.x, gy, u.z);
      this.updateRiftMarker(u, g, now);
      // 出场:弹出(带一点回弹)
      const age = (now - ud.born) / 1000;
      if (age < 0.35) {
        g.scale.setScalar(easeOutBack(Math.max(0.05, age / 0.35)));
        if (this.dropIns.has(u.id)) g.position.y += 0.3 * (1 - (age / 0.35) ** 2);   // 降临:加速落到冲击中心
      } else {
        if (g.scale.x !== 1) g.scale.setScalar(1);
        this.dropIns.delete(u.id);
      }
      // 大范围圈在起伏地形上会穿模:单位移动超过 0.08 时重新贴地(小的阵营底环不用)
      if (this.hm && (ud.rangeRing || ud.ar) && (!ud.draped || Math.abs(ud.draped.x - u.x) + Math.abs(ud.draped.z - u.z) > 0.08)) {
        ud.draped = { x: u.x, z: u.z };
        if (ud.rangeRing) this.drape(ud.rangeRing, u.x, u.z, 0.025, gy);
        if (ud.ar) this.drape(ud.ar, u.x, u.z, 0.028, gy);
      }

      if (!u.building) {
        if (ud.sprite) {
          if (u.target) {
            const dx = u.target.x - u.x;
            if (Math.abs(dx) > 0.15) {
              const f = dx > 0 ? 1 : -1;
              if (f !== ud.facing) { ud.facing = f; ud.sprite.scale.x = Math.abs(ud.sprite.scale.x) * f; }
            }
          }
        } else {
          // 模型 / 几何体:移动时朝前进方向,站定时朝目标
          const yaw = moving && ud.moveDir != null && !(u.target && Math.hypot(u.target.x - u.x, u.target.z - u.z) < u.range + 0.6)
            ? ud.moveDir : u.target ? Math.atan2(u.target.x - u.x, u.target.z - u.z) : null;
          if (yaw != null) {
            let d = yaw - ud.body.rotation.y;
            d = Math.atan2(Math.sin(d), Math.cos(d));   // 取最短转向
            ud.body.rotation.y += d * Math.min(1, dtF * 10);
          }
        }
        const lunge = this.lunges.get(u.id) || 0;
        if (lunge > 0 && u.target) {
          const k = Math.sin(lunge / 0.18 * Math.PI) * 0.12;
          const dx = u.target.x - u.x, dz = u.target.z - u.z, len = Math.hypot(dx, dz) || 1;
          ud.body.position.x = dx / len * k;
          ud.body.position.z = dz / len * k;
        } else { ud.body.position.x = ud.body.position.z = 0; }
        // 程序化步伐:没有骨骼动画的(立绘 / 刚体模型)走路时上下颠 + 左右摆
        if (moving) ud.walkPhase = (ud.walkPhase || 0) + dtF * (8 + (ud.vel || 0) * 6);
        const procedural = !ud.model?.mixer;
        const step = moving && procedural && !u.air ? Math.abs(Math.sin(ud.walkPhase)) * 0.05 : 0;
        const hover = ud.hover && u.status.stun <= 0 ? Math.sin(now / 300 + u.id) * 0.05 : 0;
        ud.body.position.y = ud.baseY + step + hover;
        const sway = moving && procedural ? Math.sin(ud.walkPhase) * 0.07 : 0;
        if (ud.sprite) ud.sprite.material.rotation = sway * ud.facing;
        else if (ud.model) ud.model.inner.rotation.z = sway * 0.6;
      }
      if (ud.model?.mixer) this.animateModel(ud, u, moving, dtF, now);

      const nearPlacement = this.placeRing.visible
        && Math.hypot(u.x - this.placeRing.position.x, u.z - this.placeRing.position.z) < 0.75;
      setBar(ud.bar, u.hp, u.maxHp, viewRotation, now, {
        visible: u.hp <= u.maxHp * 0.25 || u.shield > 0 || now - (ud.hitAt ?? -Infinity) < 950 || nearPlacement,
        shield: THREE.MathUtils.clamp(u.shield / Math.max(u.maxShield, 1), 0, 1),
      });
      if (ud.hatch) {
        if (this.hm && !ud.hatch.userData.drapeGeo) this.drape(ud.hatch, u.x, u.z, 0.062, gy);
        ud.hatch.geometry.setDrawRange(0, Math.ceil(64 * (1 - (u.hatchProgress ?? 0))) * 6);
      }
      // 钢铁 · 老兵军衔:血条上方的金色星标
      if ((u.rank || 0) !== (ud.rank || 0)) this.setRankPips(g, ud, u.rank || 0);
      if (ud.pips) ud.pips.quaternion.copy(camera.quaternion);

      if (ud.side !== u.side) {
        ud.side = u.side;
        ud.ring.material.color.setHex(SIDE_COLOR[u.side]);
        ud.rangeRing?.material.color.setHex(SIDE_COLOR[u.side]);
      }
      ud.ring.material.opacity = u.status.hack > 0 ? 0.4 + 0.45 * Math.abs(Math.sin(now / 120)) : 0.85;

      // 状态染色:诅咒紫 / 寄生绿 / 狂暴红 / 眩晕暗;受击时白闪 0.14 秒
      const raging = u.card.berserk && u.hp < u.maxHp * 0.5;
      const tint = u.status.curse > 0 ? 0x9a30ff : u.status.parasite > 0 ? 0x40ff60 : raging ? 0xff3020 : u.mimic ? 0xb070ff : null;
      const flash = Math.max(0, 1 - (now - (ud.hitAt || 0)) / 140);
      if (ud.sprite) {
        const c = u.status.stun > 0 ? 0x777777 : tint === 0x9a30ff ? 0xd6a0ff : tint === 0x40ff60 ? 0xa8ffb0 : tint === 0xff3020 ? 0xff9a8a : 0xffffff;
        ud.sprite.material.color.setHex(c).multiplyScalar(1 + flash * 1.6);
        ud.tint = tint;
      } else if (ud.model) {
        const e = TMP_COLOR.setHex(tint ?? 0x000000).multiplyScalar(tint ? 0.45 : 0);
        e.r += flash * 0.9; e.g += flash * 0.9; e.b += flash * 0.9;
        for (const m of ud.model.mats) if (m.emissive && !m.userData.keepEmissive) m.emissive.copy(e);   // 自发光道具(能量球)不参与染色
      } else {
        if (tint !== ud.tint) {
          ud.tint = tint;
          ud.mat.emissive.setHex(tint ?? FACTIONS[u.card.faction].color);
        }
        ud.mat.emissiveIntensity = u.status.stun > 0 ? 0.05 : flash > 0 ? 0.35 + flash * 1.5 : tint ? 0.7 : 0.35;
      }
    }
    for (const [id, g] of this.unitMeshes) {
      if (!alive.has(id)) { this.makeCorpse(g); this.unitMeshes.delete(id); this.lunges.delete(id); }
    }
    this.syncLinks(units, now);
  }

  // ── 3D 模型 ──
  // 克隆一份 Tripo 模型(带骨骼的用 SkeletonUtils),按目标高度缩放、脚底对齐原点;材质逐个克隆(受击白闪 / 死亡淡出各自独立)
  buildModel(entry, h, maxFoot = 0) {
    const root = cloneSkinned(entry.gltf.scene);
    // 尺寸按蒙皮后的真实顶点算(Tripo 的骨架节点常带缩放,直接取几何体包围盒会大几十倍);每个模型只算一次
    if (!entry.box) {
      root.updateMatrixWorld(true);
      entry.box = new THREE.Box3().setFromObject(root, true);
    }
    const box = entry.box;
    const size = box.getSize(new THREE.Vector3());
    root.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const inner = new THREE.Group();
    inner.add(root);
    let k = h / Math.max(size.y, 1e-3);
    const foot = Math.max(size.x, size.z);
    if (maxFoot && foot * k > maxFoot) k = maxFoot / foot;
    inner.scale.setScalar(k);
    inner.rotation.y = entry.meta.yaw || 0;
    const outer = new THREE.Group();
    outer.add(inner);
    const mats = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.push(m);
      o.userData.sharedGeo = true;
      if (o.isSkinnedMesh) o.frustumCulled = false;   // 骨骼动画会让包围盒失真,别被误裁掉
    });
    // 单位模型单独加一层室内环境反射:只有平行光 + 环境光时模型偏暗发灰(地形不受影响)
    this.getModelEnv();
    for (const m of mats) if (m.isMeshStandardMaterial) { m.envMap = this.modelEnv; m.envMapIntensity = 0.9; m.needsUpdate = true; }
    // 武器挂到手骨上(跟着动作挥动);材质并进 mats,受击白闪 / 死亡淡出一起处理
    for (const w of entry.weapons || []) {
      const mount = attachWeapon(root, size.y, w.spec, w.scene);
      if (mount) {
        for (const m of mount.userData.mats) if (m.isMeshStandardMaterial) { m.envMap = this.modelEnv; m.envMapIntensity = 0.9; }
        mats.push(...mount.userData.mats);
      }
    }
    let mixer = null;
    const actions = {};
    if (entry.gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(root);
      for (const clip of entry.gltf.animations) {
        const key = clipKey(clip.name);
        if (key && !actions[key]) actions[key] = mixer.clipAction(clip);
      }
      if (!actions.walk && actions.run) actions.walk = actions.run;
      if (!actions.attack && actions.shoot) actions.attack = actions.shoot;
    }
    outer.userData.model = { mixer, actions, mats, inner, cur: null, busyUntil: 0 };
    outer.userData.height = size.y * k;   // 实际高度(占地受限时比目标矮),血条按它摆
    return outer;
  }

  // 骨骼动画状态机:站立 / 行走循环;攻击、受击是一次性动作,播完自动回到循环;眩晕时冻结
  animateModel(ud, u, moving, dt, now) {
    const m = ud.model;
    m.mixer.timeScale = u.status.stun > 0 ? 0 : 1;
    if (now >= m.busyUntil) {
      const want = moving ? (m.actions.walk || m.actions.idle) : (m.actions.idle || m.actions.walk);
      if (want && want !== m.cur) {
        want.reset().setLoop(THREE.LoopRepeat).fadeIn(0.2).play();
        m.cur?.fadeOut(0.2);
        m.cur = want;
      }
      if (want && want === m.actions.walk) want.timeScale = Math.max(0.6, Math.min(1.8, (ud.vel || 0) * 1.8));
    }
    m.mixer.update(dt);
  }

  // fit:希望在多少秒内播完(攻击动作按单位攻击间隔加速,最多 2.5 倍)
  playOnce(ud, key, priority = 1, fit = 0) {
    const m = ud.model;
    const a = m?.actions[key];
    if (!a || (performance.now() < m.busyUntil && priority <= (m.busyPri || 0))) return false;
    a.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.06).play();
    const dur = a.getClip().duration;
    a.timeScale = fit > 0 ? Math.min(2.5, Math.max(1, dur / fit)) : 1;
    a.clampWhenFinished = key === 'die';
    if (m.cur && m.cur !== a) m.cur.fadeOut(0.06);
    m.cur = a;
    m.busyPri = priority;
    m.busyUntil = performance.now() + a.getClip().duration / a.timeScale * 1000 - 80;
    return true;
  }

  // 死亡:模型留下来播倒地动作(有骨骼的播 die/fall,没有的就倾倒),然后沉进地里淡出
  makeCorpse(g) {
    const ud = g.userData;
    for (const o of [ud.bar.root, ud.hatch, ud.ring, ud.rangeRing, ud.ar, ud.pips, ud.shadow]) {
      if (o) { g.remove(o); this.drop(o); }
    }
    let dur = 0.9;
    if (ud.model?.mixer && this.playOnce(ud, 'die', 9)) dur = Math.min(2.2, ud.model.actions.die.getClip().duration + 0.5);
    const mats = ud.sprite ? [ud.sprite.material] : ud.model ? ud.model.mats : [];
    g.traverse(o => { if (o.isMesh && !ud.model && o.material) mats.push(o.material); });
    for (const m of mats) { m.transparent = true; m.depthWrite = !!ud.sprite; }
    const dir = Math.random() < 0.5 ? -1 : 1;
    this.corpses.push({ g, ud, t: 0, dur, dir, mats, y0: g.position.y });
  }

  updateCorpses(dt) {
    for (const c of this.corpses) {
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      const { ud, g } = c;
      if (ud.model?.mixer) {
        ud.model.mixer.update(dt);
        if (!ud.model.actions.die) ud.body.rotation.z = c.dir * Math.min(1, k * 2.5) * 1.35;
      } else if (ud.sprite) {
        ud.sprite.material.rotation = (ud.facing || 1) * -Math.min(1, k * 2.8) * 1.4;   // 立绘向后倒
      } else {
        ud.body.rotation.z = c.dir * Math.min(1, k * 2.5) * 1.35;
      }
      const sink = Math.max(0, (k - 0.55) / 0.45);
      g.position.y = c.y0 - sink * 0.35;
      for (const m of c.mats) m.opacity = 1 - sink;
      if (c.t >= c.dur) this.drop(g);
    }
    this.corpses = this.corpses.filter(c => c.t < c.dur);
  }

  setRankPips(g, ud, rank) {
    if (ud.pips) { this.drop(ud.pips); ud.pips = null; }
    ud.rank = rank;
    if (!rank) return;
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd24a, depthTest: false });
    for (let i = 0; i < rank; i++) {
      const star = new THREE.Mesh(new THREE.CircleGeometry(0.06, 5), mat);   // 五边形当星标
      star.position.x = (i - (rank - 1) / 2) * 0.14;
      star.renderOrder = 12;
      grp.add(star);
    }
    grp.position.y = ud.bar.y + 0.31;
    g.add(grp);
    ud.pips = grp;
  }

  // 玛雅 · 战术网络:同一方、距离 ≤ LINK_RANGE 的玛雅单位之间画青色光链(规则与引擎相同,联机客户端自己算)
  syncLinks(units, now) {
    const net = units.filter(u => !u.dead && u.card.faction === 'mecha');
    const pts = [];
    const byId = new Map(net.map(u => [u.id, u]));
    const active = new Map();
    this.activeLinks ??= new Map();
    for (const a of net) {
      const ids = a.linkIds ?? a.links?.map(u => u.id) ?? [];
      for (const id of ids) {
        const b = byId.get(id);
        if (!b || a.id >= b.id || a.side !== b.side) continue;
        const ya = this.heightAt(a.x, a.z) + (a.air ? 1.0 : 0.4), yb = this.heightAt(b.x, b.z) + (b.air ? 1.0 : 0.4);
        pts.push(a.x, ya, a.z, b.x, yb, b.z);
        active.set(`${a.id}:${b.id}`, [a, b]);
      }
    }
    for (const [id, [a, b]] of this.activeLinks) {
      if (!active.has(id) && byId.has(a.id) && byId.has(b.id)) {
        const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
        this.vfx?.sparks(x, this.heightAt(x, z) + 0.55, z, 0x9ceaff, 3, 0.7, 0.08);
      }
    }
    this.activeLinks = active;
    if (!this.linkLines) {
      this.linkLines = new THREE.LineSegments(new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0x5af0ff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.linkLines.frustumCulled = false;
      this.world.add(this.linkLines);
    }
    let geo = this.linkLines.geometry;
    if (!geo.attributes.position || geo.attributes.position.array.length < pts.length) {
      geo.dispose();
      geo = this.linkLines.geometry = new THREE.BufferGeometry();
      const positions = new THREE.BufferAttribute(new Float32Array(Math.max(96, pts.length * 2)), 3);
      geo.setAttribute('position', positions.setUsage(THREE.DynamicDrawUsage));
    }
    const positions = geo.attributes.position;
    positions.array.set(pts);
    positions.needsUpdate = true;
    geo.setDrawRange(0, pts.length / 3);
    this.linkLines.material.opacity = 0.45 + 0.3 * Math.abs(Math.sin(now / 260));
  }

  combatNumber(position, amount, style = 'damage') {
    const value = Math.round(amount);
    if (value <= 0) return;
    if (style !== 'blood' && this.fx.filter(f => f.combatNumber).length >= 8) return;
    const sprite = boardLabel(style);
    sprite.material.depthTest = true;
    sprite.scale.set(style === 'blood' ? 1.42 : 1.18, style === 'blood' ? 0.355 : 0.295, 1);
    const color = style === 'blood' ? '#ff8cab' : style === 'shield' ? '#a1ecff' : '#ffdc94';
    sprite.userData.setText(`−${value}`, color);
    sprite.position.copy(position);
    const baseY = position.y;
    this.addFx([sprite], style === 'blood' ? 0.82 : 0.62, k => {
      sprite.position.y = baseY + (1 - k) * 0.28;
      sprite.material.opacity = Math.min(1, k * 3);
    });
    this.fx.at(-1).combatNumber = true;
  }

  recordDamage(event, target, mesh, now) {
    const lost = event.lost ?? event.amount;
    const absorbed = event.absorbed ?? 0;
    if (!(lost > 0 || absorbed > 0)) return;
    const position = new THREE.Vector3(target.x,
      (mesh?.position.y ?? this.heightAt(target.x, target.z)) + (mesh?.userData.bar?.y ?? 1.05) + (target.kind === 'base' ? 0.46 : 0.30),
      target.z);
    if (event.shieldBreak) {
      const y = position.y - 0.30;
      this.vfx.sparks(position.x, y, position.z, 0x9feaff, 7, 1.6, 0.09, 0.32);
      position.y += 0.22;
      this.combatNumber(position, absorbed, 'shield');
      position.y -= 0.22;
    }
    if (lost <= 0) return;
    let burst = this.damageBursts.get(target.id);
    if (!burst) {
      if (this.damageBursts.size >= 32) return;
      burst = { at: now, total: 0, strongest: 0, threshold: target.kind === 'base' ? 36 : 60 };
      this.damageBursts.set(target.id, burst);
    }
    burst.position = position;
    burst.total += lost;
    burst.strongest = Math.max(burst.strongest, event.amount);
  }

  flushDamageNumbers(now) {
    for (const [id, burst] of this.damageBursts) {
      if (now - burst.at < 115) continue;
      this.damageBursts.delete(id);
      if (burst.total >= burst.threshold || burst.strongest >= burst.threshold) {
        this.combatNumber(burst.position, burst.total);
      }
    }
  }

  // 通用定时特效:objs 加进场景,update(k) 中 k 从 1 衰减到 0,结束后移除
  addFx(objs, life, update) {
    objs.forEach(o => this.world.add(o));
    this.fx.push({ objs, life, maxLife: life, update });
  }

  // 闪电:折线穿过各点,带随机抖动
  lightning(points, color) {
    const pts = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const y = p.air ? 1.2 : 0.45;
      if (i > 0) {
        const q = points[i - 1];
        const qy = q.air ? 1.2 : 0.45;
        for (let k = 1; k < 4; k++) {
          const t = k / 4;
          pts.push(new THREE.Vector3(
            q.x + (p.x - q.x) * t + (Math.random() - 0.5) * 0.25,
            qy + (y - qy) * t + (Math.random() - 0.5) * 0.2,
            q.z + (p.z - q.z) * t + (Math.random() - 0.5) * 0.25));
        }
      }
      pts.push(new THREE.Vector3(p.x, y, p.z));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
    this.addFx([line], 0.3, k => { line.material.opacity = k; });
  }

  // 由小到大扩散的环
  wave(x, z, radius, color, life = 0.5) {
    const r = ringMesh(1, color, 0.8, 0.06);
    r.position.set(x, this.heightAt(x, z) + 0.1, z);
    r.scale.setScalar(radius * 0.2);
    this.addFx([r], life, k => { r.scale.setScalar(Math.max(0.05, radius * (1 - k * 0.8))); r.material.opacity = k * 0.8; });
  }

  // 固定伤害边界，内圈倒计时，落地时清除。
  strikeWarn(x, z, radius, delay) {
    const r = ringMesh(radius, 0xff6955, 0.95, 0.08);
    const timer = ringMesh(radius * 0.82, 0xffd1a8, 0.94, 0.045);
    timer.geometry.rotateZ(Math.PI / 2);
    timer.position.set(x, 0.075, z);
    r.position.set(x, 0.06, z);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 40),
      new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.15, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(x, 0.045, z);
    this.drape(r, x, z, 0.07);
    this.drape(timer, x, z, 0.075);
    this.drape(fill, x, z, 0.055);
    this.addFx([r, timer, fill], delay, k => {
      timer.geometry.setDrawRange(0, Math.ceil(64 * k) * 6);
      fill.material.opacity = 0.09 + (1 - k) * 0.13;
    });
  }

  // ── 特效 ──
  burst(pos, color, count = 18, speed = 2.2) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y + 0.4 + this.heightAt(pos.x, pos.z); positions[i * 3 + 2] = pos.z;
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI;
      const sp = speed * (0.4 + Math.random() * 0.6);
      vel.push(new THREE.Vector3(Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp, Math.sin(ph) * Math.sin(th) * sp));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.09 * this.world.scale.x, transparent: true, opacity: 1 }));
    this.world.add(points);
    this.particles.push({ points, vel, life: 0.8, maxLife: 0.8 });
  }

  areaFlash(x, z, radius, color) {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.04, z);
    this.world.add(mesh);
    const ring = ringMesh(radius, color, 0.9, 0.08);
    ring.position.set(x, 0.05, z);
    this.world.add(ring);
    this.drape(mesh, x, z, 0.05);
    this.drape(ring, x, z, 0.06);
    this.flashes.push({ mesh, ring, life: 0.7, maxLife: 0.7 });
  }

  projectile(from, to, color) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color }));
    const a = new THREE.Vector3(from.x, (from.kind ? 1.1 : from.air ? 1.2 : 0.45) + this.heightAt(from.x, from.z), from.z);
    const b = new THREE.Vector3(to.x, (to.kind ? 0.6 : to.air ? 1.15 : 0.35) + this.heightAt(to.x, to.z), to.z);
    mesh.position.copy(a);
    this.world.add(mesh);
    this.projectiles.push({ mesh, a, b, t: 0, dur: Math.min(0.35, 0.08 + a.distanceTo(b) * 0.06) });
  }

  // ── 坐标拾取 ──
  pickField(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.rayToField(this.raycaster.ray);
  }

  worldBoardPlane() {
    const y = this.world.getWorldPosition(new THREE.Vector3()).y;
    return new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
  }

  rayToField(ray) {
    const pt = new THREE.Vector3();
    const plane = this.worldBoardPlane();
    if (!ray.intersectPlane(plane, pt)) return null;
    if (this.hm) {   // 起伏地形:按交点处的高度抬高平面再求一次,迭代两次足够准
      const base = plane.constant, sy = this.world.getWorldScale(new THREE.Vector3()).y;
      for (let k = 0; k < 2; k++) {
        const local = this.world.worldToLocal(pt.clone());
        plane.constant = base - this.heightAt(local.x, local.z) * sy;
        if (!ray.intersectPlane(plane, pt)) return null;
      }
    }
    return this.worldPointToField(pt);
  }

  // 世界坐标点(垂直投影到战场)→ {x, z(战场本地), point(世界坐标落点)};场外返回 null
  worldPointToField(worldPt) {
    const local = this.world.worldToLocal(worldPt.clone());
    if (Math.abs(local.x) > FIELD_W + 0.2 || Math.abs(local.z) > FIELD_HALF + 0.2) return null;
    const x = Math.max(-FIELD_W, Math.min(FIELD_W, local.x));
    const z = Math.max(-FIELD_HALF, Math.min(FIELD_HALF, local.z));
    return { x, z, point: this.world.localToWorld(new THREE.Vector3(x, this.heightAt(x, z), z)) };
  }

  // 桌面端:屏幕上下被 HUD 占掉 top / bottom 像素,相机自动拉远并平移,让整块战场落在中间的空白区域里
  // (窄屏 / 矮屏时手牌栏不会挡住己方部署区)
  setInsets(ins) {
    if (['top', 'bottom', 'left', 'right'].every(k => Math.abs((ins[k] || 0) - this.insets[k]) < 1)) return;
    this.insets = { top: 0, bottom: 0, left: 0, right: 0, ...ins };
    this.fitCamera();
  }

  // 地形裁剪面在世界坐标里:跟着战场根节点走(XR 里战场被缩放、平移)。建棋盘时和每帧都要刷新,
  // 否则在第一次 update 之前渲染(场景对比页就是这样)会用到默认平面,切掉半边地形
  updateClipPlanes() {
    this.world.updateMatrixWorld();
    this.clipPlane.set(new THREE.Vector3(0, 1, 0), -(ARENA.top - 0.01)).applyMatrix4(this.world.matrixWorld);
    const F = ARENA.frame, e = 0.005;   // 保留 x ∈ [-F.x, F.x]、z ∈ [-F.z, F.z]
    [[1, 0, F.x], [-1, 0, F.x], [0, 1, F.z], [0, -1, F.z]].forEach(([nx, nz, d], i) =>
      this.sideClips[i].set(new THREE.Vector3(nx, 0, nz), d + e).applyMatrix4(this.world.matrixWorld));
  }

  // 桌面端视角:yaw 绕竖直轴旋转、pitch 调俯仰、zoom 远近;默认值就是原来的固定俯视角
  viewDir() {
    const L = Math.hypot(15.5, 8.7), elev0 = Math.atan2(15.5, 8.7);
    const elev = Math.max(0.62, Math.min(1.45, elev0 + this.view.pitch));
    const h = L * Math.cos(elev);
    return new THREE.Vector3(Math.sin(this.view.yaw) * h, L * Math.sin(elev), Math.cos(this.view.yaw) * h);
  }

  // 鼠标:右键拖动旋转视角(左右转 / 上下调俯仰),滚轮缩放,中键拖动平移(中键单击不动 = 复位)。
  // 左键仍用于拖牌、点牌出牌;触屏不走这里(只认 pointerType === 'mouse')
  enableMouseView() {
    const el = this.renderer.domElement;
    let orbit = null, pan = null, pending = false;
    // 高回报率鼠标一帧会来几十个事件:只记下视角参数,下一帧合并成一次取景
    const refit = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; this.fitCamera(); });
    };
    el.addEventListener('contextmenu', e => e.preventDefault());
    // 中键按下时浏览器会进入自动滚动:pointerdown 里拦不住,mousedown 也要拦
    el.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
    el.addEventListener('pointerdown', e => {
      if (this.renderer.xr.isPresenting || e.pointerType !== 'mouse') return;
      if (e.button === 1) {
        e.preventDefault();
        pan = { id: e.pointerId, x: e.clientX, y: e.clientY, panX: this.view.panX, panZ: this.view.panZ, moved: false };
        el.setPointerCapture(e.pointerId);
        el.style.cursor = 'move';
        return;
      }
      if (e.button !== 2) return;
      orbit = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: this.view.yaw, pitch: this.view.pitch };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    });
    el.addEventListener('pointermove', e => {
      if (pan && e.pointerId === pan.id) {
        const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
        if (!pan.moved && Math.hypot(dx, dy) < 4) return;   // 4px 以内当单击(松手复位)
        pan.moved = true;
        // 战场跟着光标走:按相机到注视点的距离换算每像素对应的地面长度,竖直方向再除以俯角的 sin
        const dir = this.viewDir();
        const meters = 2 * this.camera.position.distanceTo(this.viewTarget()) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / innerHeight;
        const h = Math.hypot(dir.x, dir.z), sinElev = dir.y / dir.length();
        const fx = -dir.x / h, fz = -dir.z / h;   // 水平前方
        const rx = -fz, rz = fx;                  // 水平右方
        const ahead = dy * meters / sinElev, side = -dx * meters;
        this.view.panX = Math.max(-FIELD_W, Math.min(FIELD_W, pan.panX + rx * side + fx * ahead));
        this.view.panZ = Math.max(-FIELD_HALF, Math.min(FIELD_HALF, pan.panZ + rz * side + fz * ahead));
        refit();
        return;
      }
      if (!orbit || e.pointerId !== orbit.id) return;
      this.view.yaw = Math.max(-1.3, Math.min(1.3, orbit.yaw - (e.clientX - orbit.x) * 0.006));
      this.view.pitch = Math.max(-0.45, Math.min(0.4, orbit.pitch + (e.clientY - orbit.y) * 0.004));
      refit();
    });
    const end = e => {
      if (pan && e.pointerId === pan.id) {
        if (!pan.moved && e.type === 'pointerup') this.resetView();
        pan = null;
        el.style.cursor = '';
        return;
      }
      if (!orbit || e.pointerId !== orbit.id) return;
      orbit = null;
      el.style.cursor = '';
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', e => {
      if (this.renderer.xr.isPresenting) return;
      e.preventDefault();
      this.view.zoom = Math.max(0.55, Math.min(1.6, this.view.zoom * Math.exp(e.deltaY * 0.0012)));
      refit();
    }, { passive: false });
  }

  resetView() {
    this.view = { ...DEFAULT_VIEW };
    this.fitCamera();
  }

  // 中键平移后的注视点(地面上,战场坐标)
  viewTarget() {
    return new THREE.Vector3(this.view.panX, 0, this.view.panZ);
  }

  fitCamera(W = innerWidth, H = innerHeight) {   // 传入尺寸时按该尺寸适配(场景对比页按 16:9 截图)
    const cam = this.camera;
    cam.aspect = W / H;
    if (this.renderer.xr.isPresenting) { cam.clearViewOffset(); cam.updateProjectionMatrix(); return; }
    const M = 10;   // 边距像素
    const cap = (v, n) => Math.min(v, n * 0.45);
    const top = cap(this.insets.top, H), bottom = cap(this.insets.bottom, H);
    const left = cap(this.insets.left, W), right = cap(this.insets.right, W);
    const freeH = H - top - bottom - M * 2, freeMid = top + M + freeH / 2;
    const freeW = W - left - right - M * 2, freeMidX = left + M + freeW / 2;
    const dir = this.viewDir();    // 默认俯视角;桌面端可用右键拖动旋转、滚轮缩放(见 enableMouseView)
    const signs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    const corners = signs.map(([sx, sz]) => new THREE.Vector3(sx * FIELD_W, 0, sz * FIELD_HALF));
    const trim = this.arena ? signs.map(([sx, sz]) =>
      new THREE.Vector3(sx * (ARENA.hx + ARENA.rim), ARENA.top, sz * (ARENA.hz + ARENA.rim))) : [];
    if (this.arena) for (const side of [-1, 1]) {
      trim.push(new THREE.Vector3(0, ARENA.top + 2.12, side * (ARENA.hz + ARENA.rim)));
    }
    const v = new THREE.Vector3();
    let best = null;
    for (let k = 0.55; k <= 3; k += 0.01) {
      cam.position.copy(dir).multiplyScalar(k);
      cam.lookAt(0, 0, 0);
      cam.clearViewOffset();
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
      for (const c of corners) {
        v.copy(c).project(cam);
        if (v.z <= -1 || v.z >= 1) behind = true;   // 在相机后面 / 近裁剪面外:投影会翻转,这个距离不能用
        const px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      best = { k, shift: (y0 + y1) / 2 - freeMid, shiftX: (x0 + x1) / 2 - freeMidX };
      if (behind || y1 - y0 > freeH || x1 - x0 > freeW) continue;
      const frameFits = trim.every(c => {
        v.copy(c).project(cam);
        const x = (v.x + 1) / 2 * W - best.shiftX;
        const y = (1 - v.y) / 2 * H - best.shift;
        return v.z > -1 && v.z < 1 && x >= 4 && y >= 4 && x <= W - 4 && y <= H - 4;
      });
      if (frameFits) break;
    }
    cam.position.copy(dir).multiplyScalar(best.k * this.view.zoom);
    cam.lookAt(0, 0, 0);
    if (this.view.zoom !== 1) {   // 缩放后战场投影变了:按新距离重新算平移
      cam.clearViewOffset(); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        v.copy(c).project(cam);
        const px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      best.shift = (y0 + y1) / 2 - freeMid; best.shiftX = (x0 + x1) / 2 - freeMidX;
    }
    // 平移画面:战场投影的中心对准空白区域的中心
    cam.setViewOffset(W, H, best.shiftX, best.shift, W, H);
    // 中键平移:取景算完后整体平移相机和注视点(不参与上面的取景,否则又被居中抵消)
    cam.position.add(this.viewTarget());
    cam.lookAt(this.viewTarget());
    // 雾跟着相机距离走:只让远处的外圈山体淡出,战场本身不能泡在雾里(否则整体发暗)
    if (this.scene.fog) {
      const dist = cam.position.distanceTo(this.viewTarget());
      this.scene.fog.near = dist * 1.05;
      this.scene.fog.far = dist * 2.4;
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  // XR:战场缩成桌面尺寸,挂到 anchor(用户前方)下
  enterXRLayout(anchor, isAR) {
    anchor.add(this.world);
    this.world.position.set(0, -0.5, -0.72);   // 头部下方 50cm,前方 72cm
    this.world.scale.setScalar(0.052);          // 10.2×14.2 → 约 0.53m×0.74m 桌面
    this.renderer.domElement.style.background = '';
    if (isAR) { this.scene.background = null; this.scene.fog = null; }
  }

  exitXRLayout() {
    this.scene.add(this.world);
    this.world.position.set(0, 0, 0);
    this.world.scale.setScalar(1);
    this.scene.background = new THREE.Color(0x0a0e1a);
    this.scene.fog = new THREE.Fog(0x0a0e1a, 14, 30);
    this.setSky(this.skyUrl);
    this.fitCamera();
  }

  // ── 每帧 ──
  update(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      const pos = p.points.geometry.attributes.position;
      for (let i = 0; i < p.vel.length; i++) {
        p.vel[i].y -= 4.5 * dt;
        pos.array[i * 3] += p.vel[i].x * dt;
        pos.array[i * 3 + 1] += p.vel[i].y * dt;
        pos.array[i * 3 + 2] += p.vel[i].z * dt;
      }
      pos.needsUpdate = true;
      p.points.material.opacity = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) this.drop(p.points);
    }
    this.particles = this.particles.filter(p => p.life > 0);

    for (const f of this.flashes) {
      f.life -= dt;
      const k = Math.max(0, f.life / f.maxLife);
      f.mesh.material.opacity = k * 0.45;
      f.ring.material.opacity = k * 0.9;
      if (f.life <= 0) { this.drop(f.mesh); this.drop(f.ring); }
    }
    this.flashes = this.flashes.filter(f => f.life > 0);

    for (const pr of this.projectiles) {
      pr.t += dt;
      const k = Math.min(1, pr.t / pr.dur);
      pr.mesh.position.lerpVectors(pr.a, pr.b, k);
      pr.mesh.position.y += Math.sin(k * Math.PI) * 0.4;   // 抛物线
      if (k >= 1) this.drop(pr.mesh);
    }
    this.projectiles = this.projectiles.filter(pr => pr.t < pr.dur);

    for (const [id, t] of this.lunges) this.lunges.set(id, t - dt);

    for (const f of this.fx) {
      f.life -= dt;
      f.update(Math.max(0, f.life / f.maxLife));
      if (f.life <= 0) f.objs.forEach(o => this.drop(o));
    }
    this.fx = this.fx.filter(f => f.life > 0);
    this.flushDamageNumbers(performance.now());
    this.updateCorpses(dt);
    if (this.arena) {
      animateArena(this.arena, performance.now() / 1000);
      // 裁剪面在世界坐标里:跟着战场根节点走(XR 里战场被缩放、平移)
      this.updateClipPlanes();
    }
    this.deployMarker?.update(dt);
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.vfx.update(dt, this.lastCam || this.camera, this.renderer);
  }

  // 单位身体中心的高度(特效 / 弹道的出发点)
  bodyY(o) {
    if (o.kind) return this.heightAt(o.x, o.z) + 1.0;   // 塔
    const g = this.unitMeshes.get(o.id);
    const h = g ? g.userData.bar.y : 0.8;
    return this.heightAt(o.x, o.z) + (o.air ? Math.max(0.95, h * 0.75) : h * 0.5);
  }
  bodyPos(o) { return new THREE.Vector3(o.x, this.bodyY(o), o.z); }
  // 某一方场上的单位(法术对全体生效时用)
  sideUnits(side) {
    const out = [];
    for (const g of this.unitMeshes.values()) if (g.userData.side === side) out.push(g);
    return out;
  }

  // 法术特效:按效果类型各有一套
  spellFx(ev) {
    const { card, x, z, who } = ev;
    const fac = FACTIONS[card.faction];
    const v = this.vfx;
    const R = card.radius || 1;
    if (card.needTarget && !['strike', 'hack', 'chain'].includes(card.effect)) this.areaFlash(x, z, R, fac.color);
    switch (card.effect) {
      case 'buff_atk':     // 全员强化:金色光点从每个友军脚下升起
        for (const g of this.sideUnits(who)) {
          v.rise(g.position.x, g.position.z, 0xffc840, 10, 0.3, 1.1);
          v.ring(g.position.x, g.position.z, 0.1, 0.5, 0xffc840, 0.5);
        }
        break;
      case 'heal_area':    // 维修:范围内的己方单位冒绿色光点 + 十字闪(范围圈由上面的 areaFlash 画)
        for (const g of this.sideUnits(who)) {
          if (Math.hypot(g.position.x - x, g.position.z - z) > R + 0.3) continue;
          v.rise(g.position.x, g.position.z, 0x60ff90, 12, 0.3, 0.8, 0.1);
          v.flash(g.position.x, g.position.y + 0.6, g.position.z, 0x60ff90, 0.5, 0.3);
        }
        break;
      case 'strike':       // 轨道炮击:预警期间天上先落一束细光瞄准
        v.beam(x, z, 0xff5030, card.delay || 1.2, 7, 0.05);
        break;
      case 'shield_area':
        v.dome(x, z, R, 0x66ddff, 1.4);
        v.rise(x, z, 0x9ef0ff, 18, R * 0.8, 0.6);
        break;
      case 'stun_area':    // EMP:快速扩散的冲击环 + 范围内乱窜的电弧
        v.ring(x, z, 0.1, R * 1.1, 0x7ff6ff, 0.45, 1);
        v.flash(x, this.heightAt(x, z) + 0.4, z, 0xbffaff, R * 1.4, 0.2);
        v.repeat(5, 0.08, () => {
          const a = Math.random() * Math.PI * 2, b = a + 1 + Math.random() * 2, y = this.heightAt(x, z) + 0.3;
          v.bolt([{ x: x + Math.cos(a) * R * 0.8, y, z: z + Math.sin(a) * R * 0.8 }, { x, y: y + 0.3, z },
            { x: x + Math.cos(b) * R * 0.8, y, z: z + Math.sin(b) * R * 0.8 }], 0x7ff6ff, 0.15);
        });
        break;
      case 'hack':         // 黑客入侵:红色法阵 + 故障方块(由 convert 事件补目标身上的效果)
        v.sigil(x, z, Math.min(R, 0.9), 0xff3a50, 1.2, 3);
        v.sparks(x, this.heightAt(x, z) + 0.3, z, 0xff3a50, 16, 1.5, 0.1);
        break;
      case 'chain':
        v.flash(x, this.heightAt(x, z) + 0.6, z, 0x8af0ff, 0.9, 0.15);
        break;
      case 'spawn': {      // 空投:两道光柱 + 落地扬尘
        v.beam(x, z, fac.color, 0.8, 6, 0.3);
        v.later(0.15, () => { v.ring(x, z, 0.2, 1.0, fac.color, 0.5); v.puff(x, this.heightAt(x, z), z, 0xc0c8d0, 6, 0.4, 0.9); });
        break;
      }
      case 'convert':      // 同化孢子:紫色孢子云(目标身上的效果在 convert 事件里)
        v.rise(x, z, 0xb070ff, 22, R * 0.8, 0.5, 0.15);
        break;
      case 'evolve':
        for (const g of this.sideUnits(who)) v.spiral(g.position.x, g.position.z, 0xc070ff, 1.0, 1.5, 14, 0.3);
        break;
      case 'mimic':      // 基因拟态:落点一圈紫绿基因法阵
        v.sigil(x, z, Math.min(R, 1.2), 0xc070ff, 1.0, 1.6);
        v.rise(x, z, 0x6aff9a, 12, R * 0.6, 0.5, 0.1);
        break;
      case 'parasite': {   // 寄生:飘散的绿色孢子 + 一团毒雾
        const y = this.heightAt(x, z);
        v.puff(x, y, z, 0x5a9a3a, 8, R * 0.7, 1.6, 0.25);
        v.repeat(8, 0.1, () => {
          const a = Math.random() * Math.PI * 2, r = R * Math.sqrt(Math.random());
          v.glow.emit(x + Math.cos(a) * r, y + 0.2, z + Math.sin(a) * r, 0, 0.35, 0, TMP_COLOR.setHex(0x80ff50), 0.12, 1.2, { drag: 0.5 });
        });
        break;
      }
      case 'dot_area': {   // 腐化之雨:持续 2 秒从天上落下的绿色雨滴,落地溅起
        v.sigil(x, z, R, 0x40ff70, 2.4, 0.4);
        const y0 = this.heightAt(x, z);
        v.repeat(40, 0.05, () => {
          const a = Math.random() * Math.PI * 2, r = R * Math.sqrt(Math.random());
          const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          v.glow.emit(px, y0 + 2.2, pz, 0, -5, 0, TMP_COLOR.setHex(0x60ff80), 0.09, 0.42);
          v.later(0.42, () => v.sparks(px, this.heightAt(px, pz) + 0.05, pz, 0x60ff80, 3, 0.8, 0.06, 0.25));
        });
        break;
      }
      case 'drain': {      // 灵魂抽取:一串红色灵魂从敌方半场流向己方核心
        const tz = who === 'p' ? 6.0 : -6.0, sz = who === 'p' ? -2.5 : 2.5;
        v.repeat(24, 0.03, () => {
          const t0 = Math.random() * 0.3, sx = (Math.random() - 0.5) * 2;
          v.glow.emit(sx, 1.0, sz, -sx * 0.6, 0.8, (tz - sz) / 1.1, TMP_COLOR.setHex(0xff3050), 0.16, 1.1 - t0, { drag: 0.2 });
        });
        v.later(0.9, () => { v.ring(0, tz, 0.3, 1.4, 0xff3050, 0.5); v.rise(0, tz, 0xff6080, 16, 0.6, 1.0); });
        break;
      }
      case 'sacrifice':
        v.sigil(x, z, R, 0xff2040, 0.9, 2);
        break;
      case 'curse':        // 诅咒:紫色法阵慢慢旋转 + 黑紫雾
        v.sigil(x, z, R, 0xa040ff, 1.8, 0.8);
        v.puff(x, this.heightAt(x, z), z, 0x301040, 6, R * 0.6, 1.4, 0.2);
        v.rise(x, z, 0xc070ff, 16, R * 0.8, 0.6);
        break;
      default:
        if (!card.needTarget) v.ring(0, who === 'p' ? 2 : -2, 0.3, 3, fac.accent, 0.6);
    }
  }

  // 部署降临(见 vfx.descend):多只的小兵(一张牌 >2 只,或别的牌召唤出来的 token)只出冲击波,不砸光柱。
  // 己方完整降临时桌面版轻微震屏。返回 'descend' / 'lite'(音效据此选)
  descendFx(x, z, card, side) {
    const lite = !!card.token || card.count > 2;
    this.vfx.descend(x, z, { color: FACTIONS[card.faction].color, faction: card.faction, air: !!card.air,
      building: card.type === 'building', lite, r: card.type === 'building' ? 1.0 : 0.7 });
    if (!lite && side === 'p') this.vfx.later(0.12, () => { this.shakeT = SHAKE_T; });
    return lite ? 'lite' : 'descend';
  }

  // 产兵建筑出兵:无人机工厂 = 青色传送门 + 上升火花;孵化巢 = 绿色黏液迸溅 + 卵壳碎片
  produceFx(maker, u) {
    const v = this.vfx, y = this.heightAt(u.x, u.z);
    if (maker.card.faction === 'mecha') {
      v.ring(maker.x, maker.z, 0.5, 0.15, 0x5af0ff, 0.4);
      v.beam(u.x, u.z, 0x5af0ff, 0.3, 1.4, 0.12);
      v.sparks(u.x, y + 0.5, u.z, 0x8af8ff, 10, 1.6, 0.08, 0.35);
    } else {
      v.debris(u.x, y + 0.3, u.z, 0x8a6aa0, 8, 1.6);
      v.sparks(u.x, y + 0.3, u.z, 0x9cff4a, 8, 1.4, 0.09, 0.35);
      v.puff(u.x, y, u.z, 0x405a30, 3, 0.3, 0.8, 0.3);
    }
  }

  // 死亡特效:按势力不同 —— 机械碎片 / 虫族浆液 / 混沌灵魂
  deathFx(unit) {
    const v = this.vfx, p = this.bodyPos(unit), f = unit.card.faction, col = FACTIONS[f].color;
    const big = unit.building || unit.card.cost >= 5;
    v.flash(p.x, p.y, p.z, col, big ? 1.2 : 0.7, 0.18);
    if (f === 'steel') {
      v.sparks(p.x, p.y, p.z, 0xffb040, big ? 22 : 12, 2.6, 0.1);
      v.debris(p.x, p.y, p.z, 0x50545c, big ? 14 : 7, 2.6);
      v.puff(p.x, p.y - 0.2, p.z, 0x5a5650, big ? 7 : 4, 0.4, 1.1);
    } else if (f === 'mecha') {
      v.sparks(p.x, p.y, p.z, 0x9af7ff, big ? 14 : 8, 2.3, 0.09);
      v.debris(p.x, p.y, p.z, 0x527d94, big ? 10 : 5, 2.2);
      v.rise(p.x, p.z, 0x5af0ff, big ? 10 : 6, 0.35, 0.55);
      v.ring(p.x, p.z, 0.55, 0.12, 0x83efff, 0.28);
    } else if (f === 'swarm') {
      v.debris(p.x, p.y, p.z, 0x5ac040, big ? 14 : 8, 2.2);
      v.sparks(p.x, p.y, p.z, 0x9cff4a, 8, 1.4, 0.1);
      v.puff(p.x, p.y - 0.2, p.z, 0x405a30, 3, 0.35, 0.9);
    } else {
      v.sparks(p.x, p.y, p.z, col, 10, 1.8, 0.12);
      for (let i = 0; i < 6; i++) v.glow.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.3, 1.2 + Math.random(), (Math.random() - 0.5) * 0.3, TMP_COLOR.setHex(0x80ffb0), 0.2, 1.2, { drag: 0.8 });
    }
    if (big) v.ring(p.x, p.z, 0.2, 1.2, col, 0.5);
  }

  handleEvents(events) {
    const v = this.vfx, now = performance.now();
    for (const ev of events) {
      switch (ev.type) {
        case 'attack': {
          const g = ev.from.kind ? null : this.unitMeshes.get(ev.from.id);
          if (g?.userData.model) this.playOnce(g.userData, ev.ranged ? (g.userData.model.actions.shoot ? 'shoot' : 'attack') : 'attack', 1, (ev.from.interval || 1.4) * 0.9);
          if (ev.ranged) v.projectile(ev.from, ev.to, this.bodyPos(ev.from), this.bodyPos(ev.to), this.factions?.[ev.from.side]);
          else {
            this.lunges.set(ev.from.id, 0.18);
            const to = ev.to, dx = to.x - ev.from.x, dz = to.z - ev.from.z, len = Math.hypot(dx, dz) || 1;
            const r = (to.radius || 0.2) * 0.7;
            const pos = new THREE.Vector3(to.x - dx / len * r, this.bodyY(to), to.z - dz / len * r);
            const card = ev.from.card;
            v.later(0.08, () => v.melee(card, pos, { x: dx / len, z: dz / len }));
          }
          break;
        }
        case 'hit': {
          const g = this.unitMeshes.get(ev.unit.id);
          this.recordDamage(ev, ev.unit, g, now);
          if (!g) break;
          g.userData.hitAt = now;
          if (ev.amount > 60 && g.userData.model) this.playOnce(g.userData, 'hurt', 0);
          break;
        }
        case 'death':
          this.deathFx(ev.unit);
          break;
        case 'spawn': {   // 出场:「降临」—— 落雷 + 着陆冲击 + 法阵飘散(ev.fx 标记给音效用)
          const u = ev.unit;
          // 产兵建筑(无人机工厂 / 孵化巢)生出来的:旁边 1 格内有己方建筑且产的正是这种单位
          const maker = this.unitMeshes.size && this.lastUnits?.find(b => b.building && !b.dead && b.side === u.side
            && b.card.spawn?.card === u.card.id && Math.hypot(b.x - u.x, b.z - u.z) < 1.0);
          if (maker) { this.produceFx(maker, u); ev.fx = 'produce'; break; }
          this.dropIns.add(u.id);
          // 联机:出牌瞬间已经在这里放过降临了,服务器确认后只让单位落下
          this.previewDescents = this.previewDescents.filter(d => now - d.at < 1500);
          if (u.side === 'p' && this.previewDescents.some(d => d.cardId === u.card.id && Math.hypot(d.x - u.x, d.z - u.z) < 1.5)) { ev.fx = 'echo'; break; }
          ev.fx = this.descendFx(u.x, u.z, u.card, u.side);
          break;
        }
        case 'spell':
          this.spellFx(ev);
          break;
        case 'convert':
        case 'unhack': {
          const u = ev.unit, col = ev.type === 'unhack' ? 0xffffff : u.card.faction === 'mecha' || ev.temporary ? 0xff3a50 : 0xb070ff;
          v.spiral(u.x, u.z, col, 1.2, 2, 20, 0.35);
          v.ring(u.x, u.z, 0.6, 0.1, col, 0.45);
          break;
        }
        case 'struct_hit': {
          const sg = this.structMeshes.get(ev.struct.id);
          if (sg) sg.userData.hitAt = now;
          this.recordDamage(ev, ev.struct, sg, now);
          if (ev.amount > 2) {
            const p = this.bodyPos(ev.struct);
            v.sparks(p.x + (Math.random() - 0.5) * 0.4, p.y - 0.3 + Math.random() * 0.4, p.z, 0xffb050, 5, 1.6, 0.09, 0.3);
          }
          break;
        }
        case 'struct_destroyed': {   // 塔倒:连环爆炸 + 碎石 + 浓烟 + 冲击波
          const s = ev.struct, y = this.heightAt(s.x, s.z);
          v.flash(s.x, y + 1, s.z, 0xffd080, 2.2, 0.3);
          v.ring(s.x, s.z, 0.3, 2.4, 0xffa040, 0.7);
          v.repeat(6, 0.12, () => {
            const px = s.x + (Math.random() - 0.5) * 0.8, pz = s.z + (Math.random() - 0.5) * 0.8, py = y + 0.3 + Math.random() * 1.0;
            v.flash(px, py, pz, 0xff8030, 1.0, 0.2);
            v.sparks(px, py, pz, 0xffb040, 14, 3, 0.12);
          });
          v.debris(s.x, y + 0.8, s.z, 0x4a4844, 26, 3.6);
          v.repeat(5, 0.25, () => v.puff(s.x, y + 0.3, s.z, 0x3a3634, 5, 0.8, 2.2, 0.8));
          break;
        }
        case 'spawn_preview':   // 联机乐观更新:出牌瞬间在落点先放特效,不等服务器确认
          if (ev.card.type === 'spell') { v.ring(ev.x, ev.z, 0.1, 0.6, FACTIONS[ev.card.faction].color, 0.4); break; }
          ev.fx = this.descendFx(ev.x, ev.z, ev.card, 'p');
          this.previewDescents.push({ x: ev.x, z: ev.z, cardId: ev.card.id, at: now });
          break;
        case 'splash':
          v.ring(ev.x, ev.z, 0.1, ev.radius + 0.2, 0xffb060, 0.35);
          break;
        case 'chain': {
          const pts = ev.points.map(p => ({ x: p.x, y: this.heightAt(p.x, p.z) + (p.air ? 1.1 : 0.45), z: p.z }));
          v.bolt(pts, ev.color, 0.3);
          for (const p of pts) v.sparks(p.x, p.y, p.z, ev.color, 6, 1.5, 0.08, 0.3);
          break;
        }
        case 'explode': {
          const y = this.heightAt(ev.x, ev.z), R = ev.radius;
          const strike = ev.color === 0xffb040;
          if (strike) { v.beam(ev.x, ev.z, 0xffe0a0, 0.5, 8, R * 0.45); v.flash(ev.x, y + 0.5, ev.z, 0xffffff, R * 2.5, 0.25); }
          v.flash(ev.x, y + 0.3, ev.z, ev.color, R * 1.6, 0.25);
          v.ring(ev.x, ev.z, R * 0.2, R * 1.15, ev.color, 0.5);
          v.sparks(ev.x, y + 0.2, ev.z, ev.color, 26, 3.4, 0.13, 0.55);
          v.puff(ev.x, y + 0.1, ev.z, 0x4a4440, strike ? 10 : 6, R * 0.55, 1.4, 0.7);
          if (strike) v.debris(ev.x, y + 0.2, ev.z, 0x5a5048, 16, 3.2);
          break;
        }
        case 'strike_warn':
          this.strikeWarn(ev.x, ev.z, ev.radius, ev.delay);
          break;
        case 'pulse': {   // 腐化方尖碑:绿色腐蚀波 + 紫色内环 + 上升的腐蚀光点
          v.ring(ev.x, ev.z, 0.2, ev.radius, 0x40ff70, 0.6, 0.75);
          v.ring(ev.x, ev.z, 0.1, ev.radius * 0.55, 0xa040ff, 0.45, 0.6);
          v.rise(ev.x, ev.z, 0x6aff9a, 10, ev.radius * 0.8, 0.7, 0.1);
          break;
        }
        case 'mimic': {   // 基因拟态:一道螺旋基因链从原单位流向复制体
          const a = this.bodyPos(ev.from), b = this.bodyPos(ev.unit);
          for (let i = 0; i < 24; i++) {
            const t = i / 24;
            v.later(t * 0.45, () => {
              for (const ph of [0, Math.PI]) {
                const q = a.clone().lerp(b, t), ang = t * Math.PI * 6 + ph;
                q.x += Math.cos(ang) * 0.12; q.y += Math.sin(ang) * 0.12 + Math.sin(t * Math.PI) * 0.35;
                v.glow.emit(q.x, q.y, q.z, 0, 0.1, 0, TMP_COLOR.setHex(ph ? 0x6aff9a : 0xc070ff), 0.11, 0.5);
              }
            });
          }
          v.later(0.45, () => {
            v.flash(b.x, b.y, b.z, 0xd0a0ff, 0.9, 0.25);
            v.ring(ev.unit.x, ev.unit.z, 0.6, 0.1, 0xc070ff, 0.5);
            v.spiral(ev.unit.x, ev.unit.z, 0xc070ff, 1.0, 1.5, 14, 0.3);
          });
          v.sparks(a.x, a.y, a.z, 0xc070ff, 6, 1.2, 0.08, 0.3);
          break;
        }
        case 'parasite_burst':
          v.debris(ev.x, this.heightAt(ev.x, ev.z) + 0.4, ev.z, 0x60d040, 14, 2.4);
          v.sparks(ev.x, this.heightAt(ev.x, ev.z) + 0.4, ev.z, 0x80ff50, 12, 1.8, 0.1);
          break;
        case 'evolve': {   // 进化:紫色螺旋光带包住单位
          const u = ev.unit;
          v.spiral(u.x, u.z, 0xc070ff, 1.5, 2.5, 30, 0.4);
          v.ring(u.x, u.z, 0.1, 0.9, 0xc070ff, 0.5);
          v.flash(u.x, this.bodyY(u), u.z, 0xe0b0ff, 1.0, 0.3);
          break;
        }
        case 'dodge': {
          const p = this.bodyPos(ev.unit);
          v.flash(p.x, p.y, p.z, 0xffffff, 0.5, 0.12);
          v.puff(p.x, p.y - 0.2, p.z, 0xc0d0e0, 3, 0.3, 0.5, 0.3);
          break;
        }
        case 'rank_up': {   // 钢铁军衔提升:金色螺旋 + 闪光
          const u = ev.unit;
          v.spiral(u.x, u.z, 0xffd24a, 1.3, 2, 22, 0.32);
          v.later(0.45, () => v.flash(u.x, this.bodyY(u) + 0.6, u.z, 0xffe080, 0.8, 0.3));
          break;
        }
        case 'assimilate':   // 虫群同化:孢子向内收拢,裹成虫茧
          v.ring(ev.x, ev.z, 0.9, 0.1, 0x9a4aff, 0.5);
          v.rise(ev.x, ev.z, 0x9a4aff, 16, 0.5, 0.6);
          v.puff(ev.x, this.heightAt(ev.x, ev.z), ev.z, 0x403050, 4, 0.35, 1.0, 0.3);
          break;
        case 'hatch':
          v.debris(ev.x, this.heightAt(ev.x, ev.z) + 0.3, ev.z, 0x8a6aa0, 12, 2);
          v.sparks(ev.x, this.heightAt(ev.x, ev.z) + 0.3, ev.z, 0x3fae4a, 10, 1.6, 0.1);
          break;
        case 'blood_price': {   // 混沌血祭:己方核心喷出血雾
          const { x, z } = this.map.base;
          const coreZ = ev.who === 'p' ? z : -z, y = this.heightAt(x, coreZ);
          const core = ev.core && this.structMeshes.get(ev.core.id);
          const labelY = y + (core?.userData.bar.y ?? 1.32) + 0.50;
          this.combatNumber(new THREE.Vector3(x, labelY, coreZ), ev.amount, 'blood');
          v.ring(x, coreZ, 0.3, 1.6, 0xff2040, 0.6);
          v.repeat(10, 0.05, () => v.glow.emit(x + (Math.random() - 0.5) * 0.6, y + 0.8, coreZ + (Math.random() - 0.5) * 0.6,
            (Math.random() - 0.5) * 1.5, 2 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5, TMP_COLOR.setHex(0xff2040), 0.18, 0.9, { grav: 4 }));
          v.puff(x, y + 0.5, coreZ, 0x601020, 6, 0.6, 1.4, 0.5);
          break;
        }
        case 'devour': {
          const u = ev.unit;
          v.spiral(u.x, u.z, 0x3fae4a, 1.0, 1.5, 16, 0.5);
          v.flash(u.x, this.bodyY(u), u.z, 0x60ff60, 0.8, 0.25);
          break;
        }
      }
    }
  }

  render() {
    // 降临震屏:只在桌面版、只在这一帧渲染时把相机挪一下,渲染完放回(不影响视角状态)
    const k = this.shakeT > 0 && !this.renderer.xr.isPresenting ? this.shakeT / SHAKE_T : 0;
    if (k) this.camera.position.add(SHAKE_OFF.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * SHAKE_AMP * k));
    this.renderer.render(this.scene, this.camera);
    if (k) this.camera.position.sub(SHAKE_OFF);
  }
}

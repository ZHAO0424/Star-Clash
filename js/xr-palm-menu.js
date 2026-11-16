// 左手手心菜单:左手张开、掌心朝向头部时,在小指一侧浮出一排图标按钮。
// 判定与摆放参考 jelly-harbor 的手心菜单(D:\webxr-todo\jelly-harbor\index.html)+ weather-palm 的张开度(防误触,
// 相当于 MRTK 的"要求平摊手掌")。纯几何判定在 xr-math.js。
//
//   const menu = new PalmMenu(scene, items);   // items: [{ id, icon, label(), disabled() }]
//   每帧 const poked = menu.update(dt, { hand, head, allowed, tip });   // 右手食指尖戳中按钮 → 返回按钮 id
//   右手射线 + 捏合:menu.rayHit(ray) 拿距离,捏合时 menu.pick(ray) → 按钮 id
//   menu.open:菜单当前是否展开(展开时左手射线隐藏、左手捏合被吃掉)

import * as THREE from 'three';
import { uiArt } from './assets.js';
import { getLang } from './i18n.js';
import { PALM, palmNormal, handOpenness, hysteresis } from './xr-math.js';

const W = 1024, H = 300;
const PANEL_W = 0.17, PANEL_H = PANEL_W * H / W;   // 每个按钮约 4cm 宽、图标约 3cm
const OFFSET_PALM = 0.05, OFFSET_UP = 0.07, OFFSET_PINKY = 0.03;
const FOLLOW = 18;            // 跟手平滑(1/s)
const POKE_DEPTH = 0.02;      // 指尖离面板 2cm 内算戳中
const JOINTS = ['wrist', 'index-finger-metacarpal', 'middle-finger-metacarpal', 'pinky-finger-metacarpal',
  'middle-finger-phalanx-proximal', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
const UP = new THREE.Vector3(0, 1, 0);

export class PalmMenu {
  constructor(scene, items) {
    this.items = items;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), this.material);
    this.mesh.renderOrder = 999;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.raycaster = new THREE.Raycaster();
    this.want = false;
    this.facing = false;
    this.opened = false;
    this.shown = 0;
    this.placed = false;
    this.hover = null;
    this.poking = false;
    this.signature = '';
    this.target = new THREE.Vector3();
    this.joints = {};
    for (const name of JOINTS) this.joints[name] = new THREE.Vector3();
  }

  get open() { return this.shown > 0.5; }

  hide() {
    this.want = this.facing = this.opened = this.placed = this.poking = false;
    this.shown = 0;
    this.hover = null;
    this.material.opacity = 0;
    this.mesh.visible = false;
  }

  // hand:左手 XRHand(three 的 renderer.xr.getHand);head:头的世界坐标;allowed:当前允许出现(没抓牌、没在双手操控);
  // tip:右手食指尖世界坐标(没追踪到给 null);hoverRay:右手射线(没有给 null)。返回这一帧戳中的按钮 id
  update(dt, { hand, head, allowed, tip = null, hoverRay = null }) {
    this.want = allowed && this.readPalm(hand, head);
    const k = 1 - Math.exp(-dt * FOLLOW);
    if (!this.placed) { this.mesh.position.copy(this.target); this.placed = true; }
    else this.mesh.position.lerp(this.target, k);
    this.mesh.lookAt(head);
    this.shown = THREE.MathUtils.damp(this.shown, this.want ? 1 : 0, 12, dt);
    if (!this.want && this.shown < 0.02) this.shown = 0;
    this.material.opacity = this.shown;
    this.mesh.visible = this.shown > 0.02;
    this.mesh.updateMatrixWorld();

    let poked = null;
    const touch = this.open && tip ? this.buttonAtPoint(tip) : null;
    if (touch !== null) {
      if (!this.poking && touch) poked = touch.disabled?.() ? null : touch.id;
      this.poking = true;
    } else this.poking = false;
    this.hover = touch || (this.open && hoverRay ? this.buttonAtRay(hoverRay) : null) || null;
    this.redraw();
    return poked;
  }

  // 掌心朝头(带回差)且手掌张开 → true;同时算好菜单目标位置。左手没追踪到 → false
  readPalm(hand, head) {
    const J = hand?.joints;
    if (!J) return false;
    for (const name of JOINTS) {
      const joint = J[name];
      if (!joint || joint.visible === false) return false;
      joint.getWorldPosition(this.joints[name]);
    }
    const j = this.joints;
    const palm = new THREE.Vector3().copy(palmNormal(j.wrist, j['index-finger-metacarpal'], j['pinky-finger-metacarpal'], 'left'));
    const toHead = head.clone().sub(j['middle-finger-metacarpal']).normalize();
    this.facing = hysteresis(this.facing, palm.dot(toHead), PALM.FACE_ON, PALM.FACE_OFF);
    this.opened = hysteresis(this.opened, handOpenness(j), PALM.OPEN_ON, PALM.OPEN_OFF);
    const pinkySide = j['pinky-finger-metacarpal'].clone().sub(j['index-finger-metacarpal']).normalize();
    this.target.copy(j['middle-finger-metacarpal'])
      .addScaledVector(palm, OFFSET_PALM).addScaledVector(UP, OFFSET_UP).addScaledVector(pinkySide, OFFSET_PINKY);
    return this.facing && this.opened;
  }

  // 面板本地坐标 → 按钮;不在面板上返回 null,在面板上但不在按钮上返回 undefined
  buttonAtLocal(local) {
    if (Math.abs(local.x) > PANEL_W / 2 || Math.abs(local.y) > PANEL_H / 2) return null;
    const index = Math.floor((local.x / PANEL_W + 0.5) * this.items.length);
    return this.items[THREE.MathUtils.clamp(index, 0, this.items.length - 1)];
  }

  // 戳:指尖在面板前后 2cm 内、落在按钮格里
  buttonAtPoint(point) {
    const local = this.mesh.worldToLocal(point.clone());
    if (Math.abs(local.z) > POKE_DEPTH) return null;
    return this.buttonAtLocal(local);
  }

  rayHit(ray) {
    if (!this.open) return null;
    this.raycaster.set(ray.origin, ray.direction);
    return this.raycaster.intersectObject(this.mesh, false)[0] ?? null;
  }

  buttonAtRay(ray) {
    const hit = this.rayHit(ray);
    return hit ? this.buttonAtLocal(this.mesh.worldToLocal(hit.point.clone())) : null;
  }

  // 射线 + 捏合:ray 用上一帧(还没捏上时)的射线。命中可用按钮 → id;命中面板但按钮置灰 → ''(吃掉这次捏合);没命中 → null
  pick(ray) {
    if (!this.open) return null;
    const item = this.buttonAtRay(ray);
    if (!item) return this.rayHit(ray) ? '' : null;
    return item.disabled?.() ? '' : item.id;
  }

  // 签名不变就不重画
  redraw() {
    if (!this.mesh.visible) return;
    const states = this.items.map(item => [item.icon(), item.label(), Boolean(item.disabled?.())]);
    const signature = JSON.stringify([getLang(), this.hover?.id, states]);
    if (signature === this.signature) return;
    this.signature = signature;
    const { ctx } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(38, 28, 48, 0.92)';
    ctx.beginPath(); ctx.roundRect(6, 6, W - 12, H - 12, 40); ctx.fill();
    ctx.strokeStyle = '#e5b573'; ctx.lineWidth = 5; ctx.stroke();
    const cell = W / this.items.length;
    this.items.forEach((item, i) => {
      const [icon, label, disabled] = states[i];
      const x = i * cell;
      ctx.globalAlpha = disabled ? 0.35 : 1;
      if (this.hover === item && !disabled) {
        ctx.fillStyle = '#826b9d';
        ctx.beginPath(); ctx.roundRect(x + 16, 20, cell - 32, H - 40, 28); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.stroke();
      }
      const art = uiArt('xr-control-' + icon);
      const size = 150;
      if (art) ctx.drawImage(art.img, x + (cell - size) / 2, 36, size, size);
      ctx.fillStyle = '#fff3de';
      ctx.font = 'bold 44px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + cell / 2, 238, cell - 24);
      ctx.globalAlpha = 1;
    });
    this.tex.needsUpdate = true;
  }
}

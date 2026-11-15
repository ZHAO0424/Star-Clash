// 棋盘底座 — 整个地图放在一块红蓝对阵的棋盘底座上(参考 assets/model-references/red-blue-board-versus.png)
//   · 台面:蓝方半场(+Z,己方)/ 红方半场(-Z,敌方),金色分界线、两端半圆、内框线
//   · 金色倒角边框;四角发光晶体石柱、两端中门塔、长边宝石嵌板(红在敌方那头、蓝在己方)
//   · 每个部件是一个"槽":assets/arena/parts/<槽名>.glb 存在就用模型(GPT 部件图 → Tripo 生成),否则用程序化几何体
//     槽名:rim_straight / rim_corner / pylon_red / pylon_blue / gate_red / gate_blue / plaque_red / plaque_blue
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { ARENA } from './arena-dims.js';   // 底座尺寸(含黄线内框)的唯一来源,Blender 地形脚本也读它
export { ARENA };
const RED = 0xe0304a, BLUE = 0x3a8cff;
const loader = new GLTFLoader();
const PART_SIZE = {
  pylon: [0.64, 1.45, 0.64],
  gate: [1.83, 2.0, 0.63],
  plaque: [0.28, 0.2, 1.1],
};
const PART_ROTATION = { gate: -Math.PI / 2, plaque: Math.PI / 2 };

// 用套壳保留 GLB 自身的节点变换，按棋盘坐标归一化后再对齐各轴。
function fitPart(model, dimensions, angle = 0, decorative = false) {
  const axis = new THREE.Group();
  axis.rotation.y = angle;
  axis.add(model);
  const box = new THREE.Box3().setFromObject(axis, true);
  const size = box.getSize(new THREE.Vector3());
  if (size.toArray().some(value => !Number.isFinite(value) || value < 1e-3)) return null;
  const part = new THREE.Group();
  part.add(axis);
  part.scale.set(dimensions[0] / size.x, dimensions[1] / size.y, dimensions[2] / size.z);
  const center = box.getCenter(new THREE.Vector3());
  axis.position.set(-center.x, -box.min.y, -center.z);
  if (decorative) {
    model.traverse(object => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material?.isMeshStandardMaterial) continue;
        material.color.multiplyScalar(0.70);
        material.emissiveIntensity *= 0.20;
      }
    });
  }
  return part;
}

function loadPart(slot) {
  return loader.loadAsync(`assets/arena/parts/${slot}.glb`).then(gltf => gltf.scene);
}

async function replaceRim(root, fallback) {
  const [straight, corner] = await Promise.all([loadPart('rim_straight'), loadPart('rim_corner')]);
  const rim = new THREE.Group();
  rim.name = 'slot:rim:assembled';
  const maxX = ARENA.hx + ARENA.rim, maxZ = ARENA.hz + ARENA.rim;
  const leg = 1.2, width = ARENA.rim, height = 0.30;
  const y = ARENA.top - 0.11;
  const add = (model, dimensions, x, z, angle) => {
    const part = fitPart(model.clone(true), dimensions);
    if (!part) return false;
    part.position.set(x, y, z);
    part.rotation.y = angle;
    rim.add(part);
    return true;
  };
  for (const [sx, sz, angle] of [
    [-1, -1, 0], [1, -1, -Math.PI / 2], [1, 1, Math.PI], [-1, 1, Math.PI / 2],
  ]) {
    if (!add(corner, [leg, height, leg], sx * (maxX - leg / 2), sz * (maxZ - leg / 2), angle)) return;
  }
  for (const longSide of [false, true]) {
    const extent = longSide ? maxZ : maxX;
    const run = 2 * (extent - leg);
    const count = Math.ceil(run / 2);
    const length = run / count;
    const offset = (longSide ? maxX : maxZ) - width / 2;
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        const along = -run / 2 + (i + 0.5) * length;
        const x = longSide ? side * offset : along;
        const z = longSide ? along : side * offset;
        const angle = longSide ? side * Math.PI / 2 : side < 0 ? Math.PI : 0;
        if (!add(straight, [length, height, width], x, z, angle)) return;
      }
    }
  }
  root.add(rim);
  fallback.visible = false;
}

function surfaceTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round(512 * ARENA.hz / ARENA.hx);
  const g = c.getContext('2d'), W = c.width, H = c.height;
  const grad = (y0, y1, a, b) => { const l = g.createLinearGradient(0, y0, 0, y1); l.addColorStop(0, a); l.addColorStop(1, b); return l; };
  g.fillStyle = grad(0, H / 2, '#7a1626', '#a8243a'); g.fillRect(0, 0, W, H / 2);       // 红方(上 = -Z)
  g.fillStyle = grad(H / 2, H, '#24489a', '#1a3478'); g.fillRect(0, H / 2, W, H / 2);   // 蓝方(下 = +Z)
  for (let i = 0; i < 2600; i++) {   // 布纹 / 石纹的细微颗粒
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 3, 1 + Math.random() * 2);
  }
  g.strokeStyle = '#e8b85a'; g.lineCap = 'round';
  g.lineWidth = 5; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();   // 分界线
  g.lineWidth = 3;
  const m = W * ARENA.frameMargin / (2 * ARENA.hx); g.strokeRect(m, m, W - 2 * m, H - 2 * m);   // 黄线内框 = 地形岛轮廓
  for (const [y, dir] of [[m, 1], [H - m, -1]]) {                                         // 两端半圆
    g.beginPath(); g.arc(W / 2, y, W * 0.24, dir > 0 ? 0 : Math.PI, dir > 0 ? Math.PI : Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(W / 2, y + dir * H * 0.06, W * 0.42, dir > 0 ? 0.25 : Math.PI + 0.25, dir > 0 ? Math.PI - 0.25 : Math.PI * 2 - 0.25); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 倒角矩形轮廓
function chamferRect(hx, hz, ch) {
  const s = new THREE.Shape();
  s.moveTo(-hx + ch, -hz); s.lineTo(hx - ch, -hz); s.lineTo(hx, -hz + ch); s.lineTo(hx, hz - ch);
  s.lineTo(hx - ch, hz); s.lineTo(-hx + ch, hz); s.lineTo(-hx, hz - ch); s.lineTo(-hx, -hz + ch); s.closePath();
  return s;
}

const gold = env => new THREE.MeshStandardMaterial({ color: 0xd9a03c, metalness: 0.65, roughness: 0.32, envMap: env, envMapIntensity: 1.0 });
const stone = env => new THREE.MeshStandardMaterial({ color: 0x8a6f5a, roughness: 0.85, envMap: env, envMapIntensity: 0.6 });
const crystal = color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.2, transparent: true, opacity: 0.92 });

// 程序化部件(GPT 部件模型到位前的占位)
const PROC = {
  pylon(color, env) {   // 方石柱 + 金顶 + 发光晶体
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.5), stone(env)); body.position.y = 0.375; g.add(body);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.62), gold(env)); cap.position.y = 0.8; g.add(cap);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.12, 0.64), gold(env)); base.position.y = 0.06; g.add(base);
    const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), crystal(color)); cr.scale.y = 1.5; cr.position.y = 1.15; g.add(cr);
    g.userData.crystal = cr;
    return g;
  },
  gate(color, env) {    // 中门塔:石墙 + 尖顶 + 金饰 + 正面嵌晶
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 0.5), stone(env)); wall.position.y = 0.5; g.add(wall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.75, 4), gold(env)); roof.position.y = 1.37; roof.rotation.y = Math.PI / 4; g.add(roof);
    for (const sx of [-1, 1]) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 4), gold(env)); sp.position.set(sx * 0.48, 1.22, 0); g.add(sp);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.55), gold(env)); wing.position.set(sx * 0.62, 0.17, 0); g.add(wing);
    }
    const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.17), crystal(color)); cr.scale.set(0.8, 2.0, 0.5); cr.position.set(0, 0.6, 0.27); g.add(cr);
    g.userData.crystal = cr;
    return g;
  },
  plaque(color, env) {  // 边框上的宝石嵌板
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 1.1), gold(env)); frame.position.y = 0.1; g.add(frame);
    const gem = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.8), crystal(color)); gem.position.set(0.14, 0.1, 0); g.add(gem);
    return g;
  },
};

export function buildArena(env) {
  const A = ARENA, root = new THREE.Group();
  root.name = 'arena';
  // 底座(深色石台)+ 台面
  const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(chamferRect(A.hx + A.rim, A.hz + A.rim, 0.9), { depth: A.thick, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.9, envMap: env, envMapIntensity: 0.4 }));
  slab.rotation.x = Math.PI / 2; slab.position.y = A.top - 0.02;
  root.add(slab);
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(2 * A.hx, 2 * A.hz), new THREE.MeshStandardMaterial({ map: surfaceTexture(), roughness: 0.75, envMap: env, envMapIntensity: 0.5 }));
  surf.rotation.x = -Math.PI / 2; surf.position.y = A.top;
  root.add(surf);
  // 金色边框:外轮廓减内轮廓,带倒角
  const ring = chamferRect(A.hx + A.rim, A.hz + A.rim, 0.9);
  const hole = chamferRect(A.hx, A.hz, 0.6);
  ring.holes.push(new THREE.Path(hole.getPoints().reverse()));
  const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 }), gold(env));
  rim.rotation.x = -Math.PI / 2; rim.position.y = A.top - 0.05;
  rim.name = 'slot:rim';
  root.add(rim);
  // 部件
  const slots = [];
  const place = (slot, kind, color, x, z, rotY) => {
    const g = PROC[kind](color, env);
    g.position.set(x, A.top + 0.12, z); g.rotation.y = rotY;
    g.name = 'slot:' + slot;
    root.add(g);
    slots.push({ slot, kind, obj: g });
  };
  const cx = A.hx + A.rim * 0.5, cz = A.hz + A.rim * 0.5;
  for (const sx of [-1, 1]) {
    place('pylon_red', 'pylon', RED, sx * (cx - 0.15), -(cz - 0.15), 0);
    place('pylon_blue', 'pylon', BLUE, sx * (cx - 0.15), cz - 0.15, 0);
    place('plaque_red', 'plaque', RED, sx * cx, -A.hz * 0.45, sx > 0 ? 0 : Math.PI);
    place('plaque_blue', 'plaque', BLUE, sx * cx, A.hz * 0.45, sx > 0 ? 0 : Math.PI);
  }
  place('gate_red', 'gate', RED, 0, -cz, 0);
  place('gate_blue', 'gate', BLUE, 0, cz, Math.PI);
  root.userData.slots = slots;
  // 有部件模型的槽:异步替换(assets/arena/parts/parts.json 列出已有的部件,没有清单就全用程序化)
  fetch('assets/arena/parts/parts.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : [])).then(have => {
    if (!Array.isArray(have)) return;
    for (const { slot, kind, obj } of slots) {
      if (!have.includes(slot)) continue;
      loadPart(slot).then(model => {
        const part = fitPart(model, PART_SIZE[kind], PART_ROTATION[kind], true);
        if (!part) return;
        obj.clear();
        delete obj.userData.crystal;
        obj.add(part);
      }).catch(() => { /* 保留程序化部件 */ });
    }
    if (have.includes('rim_straight') && have.includes('rim_corner')) {
      replaceRim(root, rim).catch(() => { /* 两种部件均可用时才替换整圈 */ });
    }
  }).catch(() => { /* 无清单时使用程序化底座 */ });
  return root;
}

// 晶体呼吸光
export function animateArena(root, t) {
  for (const s of root.userData.slots || []) {
    const cr = s.obj.userData.crystal;
    if (cr) { cr.material.emissiveIntensity = 0.12 + 0.04 * Math.sin(t * 2 + s.obj.position.x); cr.rotation.y = t * 0.6; }
  }
}

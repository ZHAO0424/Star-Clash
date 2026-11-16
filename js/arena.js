// 棋盘底座 — 整个地图放在一块红蓝对阵的棋盘底座上(参考 assets/model-references/red-blue-board-versus.png)
//   · 台面:受光石板(铺砖 + 凹凸),阵营色只作细镶边(己方 +Z 蓝 / 敌方 -Z 红),金色内框线
//   · 边框:倒角石材 + 内侧金属包边 + 顶面阵营色发光嵌线(第一轮画面提升 C:不再铺大面积纯红纯蓝)
//   · 四角发光晶体石柱、两端中门塔、长边宝石嵌板(红在敌方那头、蓝在己方)
//   · 部件"槽":assets/arena/parts/<槽名>.glb 存在就用模型(GPT 部件图 → Tripo 生成),否则用程序化几何体
//     槽名:pylon_red / pylon_blue / gate_red / gate_blue / plaque_red / plaque_blue
//     (rim_straight / rim_corner 两个边框模型只是纯色方块且要 30+ 次 draw call,已改用程序化石材边框)
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

// 固定种子的随机数:台面花纹每次一样(双方看到的也一样)
function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

// 台面:暖灰石板铺砖 + 风化斑点;返回 { map, bump }(bump 是缩小一半的灰度高度图,砖缝凹下去)
//   画面上只露出地形岛外的一圈(约 0.7 格宽),所以花纹以"砖缝 + 细镶边"为主,不画大面积阵营色
function surfaceTexture() {
  const W = 768, H = Math.round(W * ARENA.hz / ARENA.hx), ppu = W / (2 * ARENA.hx);   // ppu = 每格像素
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const h = document.createElement('canvas'); h.width = W / 2; h.height = H / 2;
  const g = c.getContext('2d'), gh = h.getContext('2d');
  const R = seeded(20251116);
  g.fillStyle = '#8a8077'; g.fillRect(0, 0, W, H);
  gh.fillStyle = '#444'; gh.fillRect(0, 0, W / 2, H / 2);
  // 石板:错缝铺砖,每块颜色略有差异
  const tile = 0.78 * ppu;
  for (let row = 0, y = 0; y < H; row++, y += tile) {
    const off = (row % 2) * tile * 0.5;
    for (let x = -off; x < W; x += tile) {
      const v = 118 + R() * 26, warm = R() * 10;
      g.fillStyle = `rgb(${v + warm | 0},${v + warm * 0.4 | 0},${v - 6 | 0})`;
      g.fillRect(x + 2, y + 2, tile - 4, tile - 4);
      const hv = 170 + R() * 50 | 0;
      gh.fillStyle = `rgb(${hv},${hv},${hv})`;
      gh.fillRect((x + 3) / 2, (y + 3) / 2, (tile - 6) / 2, (tile - 6) / 2);
    }
  }
  // 风化:细颗粒 + 少量深色污渍
  for (let i = 0; i < 9000; i++) {
    const a = R() * 0.08;
    g.fillStyle = R() < 0.5 ? `rgba(255,245,230,${a})` : `rgba(30,20,15,${a})`;
    g.fillRect(R() * W, R() * H, 1 + R() * 2, 1 + R() * 2);
  }
  for (let i = 0; i < 40; i++) {
    const x = R() * W, y = R() * H, r = 10 + R() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(40,30,25,0.18)'); gr.addColorStop(1, 'rgba(40,30,25,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // 黄线内框 = 地形岛轮廓:金色线;外侧一圈阵营色细镶边(上半 -Z 红 / 下半 +Z 蓝),中线金色分界
  const m = ppu * ARENA.frameMargin;
  for (const [y0, y1, col] of [[0, H / 2, '#d0485c'], [H / 2, H, '#4a8cf0']]) {
    g.save(); g.beginPath(); g.rect(0, y0, W, y1 - y0); g.clip();
    g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(m * 0.45, m * 0.45, W - m * 0.9, H - m * 0.9);
    g.restore();
  }
  g.strokeStyle = '#e2b25e'; g.lineWidth = 3; g.strokeRect(m, m, W - 2 * m, H - 2 * m);
  g.lineWidth = 5; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return { map, bump: new THREE.CanvasTexture(h) };
}

// 边框石材:可平铺的小块噪声贴图(ExtrudeGeometry 顶面 UV = 形状坐标,即战场单位)
function rimTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), R = seeded(7);
  g.fillStyle = '#80766c'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 1400; i++) {
    const a = R() * 0.12;
    g.fillStyle = R() < 0.5 ? `rgba(255,240,220,${a})` : `rgba(25,18,12,${a})`;
    g.fillRect(R() * S, R() * S, 1 + R() * 3, 1 + R() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.8, 0.8);
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
  const tex = surfaceTexture();
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(2 * A.hx, 2 * A.hz), new THREE.MeshStandardMaterial({
    map: tex.map, bumpMap: tex.bump, bumpScale: 2.0, roughness: 0.82, metalness: 0.05, envMap: env, envMapIntensity: 0.45 }));
  surf.rotation.x = -Math.PI / 2; surf.position.y = A.top;
  root.add(surf);
  // 边框:倒角石材(外轮廓减内轮廓)+ 内侧金属包边 + 顶面阵营色嵌线
  const band = (outX, outZ, outCh, inX, inZ, inCh, depth, bevel) => {
    const ring = chamferRect(outX, outZ, outCh);
    ring.holes.push(new THREE.Path(chamferRect(inX, inZ, inCh).getPoints().reverse()));
    const geo = new THREE.ExtrudeGeometry(ring, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
    geo.rotateX(-Math.PI / 2);
    return geo;
  };
  const rim = new THREE.Mesh(band(A.hx + A.rim, A.hz + A.rim, 0.9, A.hx + 0.06, A.hz + 0.06, 0.62, 0.18, 0.06),
    new THREE.MeshStandardMaterial({ map: rimTexture(), color: 0xc8beb2, roughness: 0.72, metalness: 0.08, envMap: env, envMapIntensity: 0.5 }));
  rim.position.y = A.top - 0.05;
  rim.name = 'slot:rim';
  root.add(rim);
  const lip = new THREE.Mesh(band(A.hx + 0.1, A.hz + 0.1, 0.64, A.hx - 0.02, A.hz - 0.02, 0.58, 0.2, 0.02), gold(env));
  lip.position.y = A.top - 0.02;
  lip.name = 'rimTrim';
  root.add(lip);
  // 阵营色嵌线:长边顶面各半段一条细发光槽(敌方 -Z 红 / 己方 +Z 蓝),只作镶边
  const inlayY = A.top + 0.2, inlayX = A.hx + A.rim * 0.55, inlayLen = A.hz - 0.9;
  for (const [col, sz] of [[RED, -1], [BLUE, 1]]) {
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.55, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, inlayLen), mat);
      strip.position.set(sx * inlayX, inlayY, sz * (inlayLen / 2 + 0.25));
      root.add(strip);
    }
  }
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

// 场景 3D 配景 — 读 assets/props/<scene>/kit.json(tools/gen-props.mjs 用 Tripo 生成),按区域规则摆放
//   · 纯装饰,不参与碰撞;只放在不影响走位的地方:岩脊上、战场外圈、裂隙靠边的半圈、远处地标
//   · 摆放用固定种子(按场景 id),双方看到的布局一致
//   · 同一种配景用 InstancedMesh 批量绘制:每种配景只占几次 draw call
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mapForScene, wallSegments } from './map.js';
import { ARENA } from './arena-dims.js';

const loader = new GLTFLoader();
const kitCache = new Map();

// 加载配景包:{ name: { meshes: [{ geometry, material }], size, zone } };没有配景包返回 null
export function loadKit(sceneId) {
  if (!kitCache.has(sceneId)) kitCache.set(sceneId, (async () => {
    let index;
    try {
      const res = await fetch(`assets/props/${sceneId}/kit.json`, { cache: 'no-cache' });
      if (!res.ok) return null;
      index = await res.json();
    } catch { return null; }
    const kit = {};
    await Promise.all(Object.entries(index).map(([name, meta]) => new Promise(res => {
      loader.load(`assets/props/${sceneId}/${meta.file}`, g => { kit[name] = { ...meta, ...flatten(g.scene, meta.size) }; res(); },
        undefined, () => { console.warn('配景加载失败', sceneId, name); res(); });
    })));
    return Object.keys(kit).length ? kit : null;
  })());
  return kitCache.get(sceneId);
}

// 把模型里所有网格烘成"以底面中心为原点、高度 = size"的几何体(InstancedMesh 只吃单个几何体)
function flatten(root, size) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const h = Math.max(1e-3, box.max.y - box.min.y), s = size / h;
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const fix = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz));
  // 1 倍缩放下的占地半径(水平包围盒对角线的一半:任意旋转都不会低估),摆放时用来保证不越出黄线
  const radius = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2 * s;
  const out = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(fix, o.matrixWorld));
    out.push({ geometry, material: o.material });
  });
  return { meshes: out, radius };
}

// 固定种子的随机数(mulberry32)
function rng(seedStr) {
  let a = [...seedStr].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 1779033703);
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// 按区域规则生成摆放列表 [{ name, x, z, rot, k }](k = 缩放倍数)
export function layoutProps(kit, sceneId) {
  const R = rng(sceneId), out = [];
  const pick = zone => Object.keys(kit).filter(n => kit[n].zone === zone);
  const jit = (v, a) => v + (R() - 0.5) * a;
  const taken = [];
  const free = (x, z, r) => taken.every(t => Math.hypot(t.x - x, t.z - z) > t.r + r);
  const put = (name, x, z, rot, k, r) => { out.push({ name, x, z, rot, k }); taken.push({ x, z, r }); };
  const map = mapForScene(sceneId);
  const W = map.W, H = map.HALF;

  // 1. 岩脊:沿折线铺矮岩墙段(顺着走向),中间夹碎石 —— 视觉和碰撞对上,一眼看出这里过不去
  const ridge = pick('ridge');
  const wallPiece = ridge.find(n => /wall/.test(n)) || ridge[0], smalls = ridge.filter(n => n !== wallPiece);
  if (wallPiece) for (const w of map.walls) for (const s of wallSegments(w)) {
    const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1), n = Math.max(1, Math.round(len / 0.42));
    const yaw = Math.atan2(s.x2 - s.x1, s.z2 - s.z1);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, x = s.x1 + (s.x2 - s.x1) * t, z = s.z1 + (s.z2 - s.z1) * t;
      const usePiece = !smalls.length || i % 3 !== 1;
      put(usePiece ? wallPiece : smalls[(i / 3 | 0) % smalls.length], jit(x, 0.06), jit(z, 0.06),
        usePiece ? yaw + Math.PI / 2 + (R() - 0.5) * 0.5 : R() * Math.PI * 2, 0.85 + R() * 0.35, 0.18);
    }
  }
  // 2. 裂隙:只装饰靠地图边缘的那半圈(朝战场内的一侧留空,不挡视线)
  const riftP = pick('rift');
  if (riftP.length) for (const rf of map.rifts) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * Math.PI * 0.9 + (rf.x > 0 ? 0 : Math.PI), r = rf.r + 0.12 + R() * 0.12;
      const x = rf.x + Math.cos(a) * r, z = rf.z + Math.sin(a) * r;
      if (Math.abs(x) > W + 0.35) continue;
      put(riftP[i % riftP.length], x, z, R() * Math.PI * 2, 0.35 + R() * 0.3, 0.12);   // 比单位矮,不挡裂隙里的单位
    }
  }
  // 3. 大地标:每侧一大一小,坐在岛的顶面上(地图放上棋盘底座后,外圈只剩窄边,原来的远景尺寸会挤在一起、插进悬崖)
  //    两种地标交替:每侧各一块,不会一侧全是同一种
  const marks = pick('landmark');
  [[-(W + 0.75), -4.2, 0.62], [W + 0.75, -3.6, 0.62], [-(W + 0.75), 1.9, 0.5], [W + 0.75, 2.5, 0.5]]
    .forEach(([x, z, k], i) => marks.length && put(marks[(Math.floor(i / 2) + i) % marks.length], x, z, R() * Math.PI * 2, k * (0.92 + R() * 0.16), 1.0 * k));
  // 4. 村落小景:两侧外圈各两处(小屋 + 货箱 + 路灯 + 矿钻),是"有人住"的生活气息
  const camp = pick('camp');
  const hut = camp.find(n => /hut/.test(n)), extras = camp.filter(n => n !== hut);
  [[-(W + 0.45), 4.4], [W + 0.45, -4.2], [-(W + 0.5), -3.2], [W + 0.5, 1.2]].forEach(([cx, cz], ci) => {
    if (hut) put(hut, cx, cz, (cx > 0 ? -1 : 1) * Math.PI / 2 + (R() - 0.5) * 0.6, 0.9 + R() * 0.2, 0.32);
    extras.forEach((n, i) => {
      for (let tries = 0; tries < 8; tries++) {
        const a = R() * Math.PI * 2, d = 0.32 + R() * 0.25, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (Math.abs(x) < W + 0.05 || !free(x, z, 0.12)) continue;
        put(n, x, z, R() * Math.PI * 2, 0.85 + R() * 0.3, 0.12);
        break;
      }
    });
  });
  // 5. 外圈:战场两侧和两端的边带里稀疏散布(泊松式最小间距)
  const rim = pick('rim');
  if (rim.length) for (let i = 0; i < 260; i++) {
    const side = R();
    let x, z;
    if (side < 0.8) { x = (R() < 0.5 ? -1 : 1) * (W + 0.08 + R() * 0.75); z = (R() - 0.5) * 2 * (H + 0.3); }
    else { x = (R() - 0.5) * 2 * (W + 0.6); z = (R() < 0.5 ? -1 : 1) * (H + 0.08 + R() * 0.35); }
    const name = rim[Math.floor(R() * rim.length)], big = kit[name].size > 0.7, r = big ? 0.3 : 0.12;
    if (!free(x, z, r)) continue;
    put(name, x, z, R() * Math.PI * 2, 0.7 + R() * 0.5, r);
  }
  // 配景是 InstancedMesh,不受地形的侧面裁剪:外沿越过台面黄线内框的,缩小到刚好贴线
  const F = ARENA.frame, pad = 0.03;
  for (const p of out) {
    const r1 = kit[p.name].radius;
    if (!r1) continue;
    const room = Math.min(F.x - Math.abs(p.x), F.z - Math.abs(p.z)) - pad;
    if (r1 * p.k > room) p.k = Math.max(0.15, room / r1);
  }
  return out;
}

// 生成配景组:每种配景的每个网格一个 InstancedMesh
export function buildProps(kit, layout, heightAt, envMap) {
  const group = new THREE.Group();
  group.name = 'props3d';
  const byName = {};
  for (const p of layout) (byName[p.name] ||= []).push(p);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const [name, list] of Object.entries(byName)) {
    for (const { geometry, material } of kit[name].meshes) {
      const mat = material.clone();
      if (envMap && mat.isMeshStandardMaterial) { mat.envMap = envMap; mat.envMapIntensity = 0.7; }
      const inst = new THREE.InstancedMesh(geometry, mat, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        m.compose(new THREE.Vector3(p.x, heightAt(p.x, p.z) - 0.02, p.z), q, new THREE.Vector3(p.k, p.k, p.k));
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      group.add(inst);
    }
  }
  return group;
}

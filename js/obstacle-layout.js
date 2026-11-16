// 障碍套件的摆放数据(熔岩锻炉样板)— 纯数据,不依赖 three:渲染(obstacle-kit.js)和 Node 测试共用这一份
//   · 一切都是"玄武岩六棱柱":墙、熔渣堆、池沿岩壳、边缘石柱只是同一种柱子的不同排布 → 全图柱子 1 次 draw call
//   · 墙 = 直段 + 拐角接头 + 两端收头,沿 map.js 的碰撞折线排出来,外观贴合碰撞胶囊(偏差 ≤ ENVELOPE_TOL,墙高 ≤ WALL_MAX_H)
//   · 分层:L0 玩法层(墙 / 熔渣堆 / 池沿)在战场内;L1 边缘装饰(熔岩河、矿车轨道、铁砧、火盆、石柱群)全在战场外;
//     L2 地标(大锻炉)在敌方后方台面边缘。交战区不放任何装饰
//   · 摆放用固定种子,双方看到的布局一致
//   柱子:{ x, z, R(外接圆半径), h(露出地面的高度), rot(xz 平面里的数学角:第一个顶点方向 = (cos rot, sin rot);three 里 rotation.y = -rot), tilt: [tx, tz](绕 X / Z 的小倾斜,弧度), heat(0..1 顶面熔光), layer }
import { wallSegments } from './map.js';
import { ARENA } from './arena-dims.js';

export const ENVELOPE_TOL = 0.08;   // 外观包络与碰撞胶囊的允许偏差
export const WALL_MAX_H = 0.5;      // 墙 / 熔渣堆最高(比单位矮,俯视不挡人)
export const NEAR_END_MAX_H = 0.6;  // 靠镜头一端(+Z)的边缘装饰限高

const COL_R = 0.1;     // 墙柱外接圆半径
const ROW = 0.17;      // 两侧柱列离折线的距离(外缘约 0.27,柱间凹口约 0.22,都在胶囊 0.285 ± 0.08 内)
const STEP = 0.155;    // 沿折线的柱距上限(< 六边形对边距,柱子挨着,中列错开半格补缝)

function rng(seedStr) {   // mulberry32,同 props3d.js
  let a = [...seedStr].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 1779033703);
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── L0:墙 ──
// 一道墙 = 每段一个直段(三列错位柱,中列高、两侧低)+ 每个内拐点一个接头(拐角外侧补一圈柱 + 中心高柱)+ 两端收头(柱子渐低)
function wallColumns(wall, R, out) {
  const segs = wallSegments(wall);
  const add = (x, z, h, rot, heat = 0, r0 = COL_R) => out.push({ x, z, R: r0 * (0.94 + R() * 0.08), h, rot: rot + Math.PI / 6 + (R() - 0.5) * 0.1,   // 尖角朝外:侧面是平的柱面,外缘更齐
    tilt: [(R() - 0.5) * 0.08, (R() - 0.5) * 0.08], heat, layer: 'wall' });
  const hot = () => (R() < 0.22 ? 0.6 + R() * 0.4 : 0);   // 约两成柱子顶面露出熔芯
  // 直段
  segs.forEach(s => {
    const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    const yaw = Math.atan2(uz, ux), N = Math.max(2, Math.ceil(L / STEP));
    for (let i = 0; i <= N; i++) for (const side of [-1, 1]) {   // 两侧柱列(含端点)
      const t = i / N * L, h = 0.22 + R() * 0.12;
      add(s.x1 + ux * t + nx * ROW * side, s.z1 + uz * t + nz * ROW * side, h, yaw, hot());
    }
    for (let i = 0; i < N; i++) {   // 中列错开半格,更高:墙的脊线
      const t = (i + 0.5) / N * L, h = 0.36 + R() * 0.12;
      add(s.x1 + ux * t, s.z1 + uz * t, h, yaw, hot() * 0.7);
    }
  });
  // 拐角接头:中心一根高柱 + 外侧沿 ROW 半径的圆弧补柱(两段的侧列在外侧会张开一个楔形缺口)
  for (let k = 1; k < wall.pts.length - 1; k++) {
    const [vx, vz] = wall.pts[k], a = segs[k - 1], b = segs[k];
    const a1 = Math.atan2(a.z2 - a.z1, a.x2 - a.x1), a2 = Math.atan2(b.z2 - b.z1, b.x2 - b.x1);
    let turn = a2 - a1;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    add(vx, vz, 0.44 + R() * 0.05, a1, 0);
    // 外侧:左转(turn>0)时外侧在右手边(法线 -1)
    const n0 = a1 + (turn > 0 ? -Math.PI / 2 : Math.PI / 2), steps = Math.max(1, Math.ceil(Math.abs(turn) * ROW / STEP));
    for (let i = 1; i < steps; i++) {
      const ang = n0 + turn * i / steps;
      add(vx + Math.cos(ang) * ROW, vz + Math.sin(ang) * ROW, 0.3 + R() * 0.08, ang);
    }
    // 内侧:两段侧列在拐点内侧的交点补一根(否则内角有个三角缺口)
    const inA = n0 + Math.PI + turn / 2, inD = ROW / Math.cos(turn / 2);
    add(vx + Math.cos(inA) * inD, vz + Math.sin(inA) * inD, 0.26 + R() * 0.08, inA);
  }
  // 收头:端点一根 + 外侧半圆上 5 根(半径 0.14,略粗),越往外越低
  for (const [p, q] of [[wall.pts[0], wall.pts[1]], [wall.pts.at(-1), wall.pts.at(-2)]]) {
    const ua = Math.atan2(p[1] - q[1], p[0] - q[0]);
    add(p[0], p[1], 0.3 + R() * 0.05, ua);
    for (const k of [-2, -1, 0, 1, 2]) {
      const a = ua + k * 0.2 * Math.PI;
      add(p[0] + Math.cos(a) * 0.14, p[1] + Math.sin(a) * 0.14, 0.13 + R() * 0.07 + Math.abs(k) * 0.03, a, k === 0 ? 0.8 : 0, 0.11);
    }
  }
}

// ── L0:熔渣堆(圆形岩石障碍)= 中心高柱 + 一圈 9 根外倾的断柱 ──
function rockColumns(o, R, out) {
  const ringR = o.r - 0.12, Rc = 0.11;
  out.push({ x: o.x, z: o.z, R: 0.12, h: 0.42 + R() * 0.06, rot: R() * Math.PI, tilt: [0, 0], heat: 0.9, layer: 'rock' });
  for (let i = 0; i < 9; i++) {
    const a = (i + 0.5 * (o.x > 0)) / 9 * Math.PI * 2, h = 0.2 + R() * 0.14, lean = 0.1 + R() * 0.08;
    out.push({ x: o.x + Math.cos(a) * ringR, z: o.z + Math.sin(a) * ringR, R: Rc, h, rot: a + Math.PI / 6,
      tilt: [Math.sin(a) * lean, -Math.cos(a) * lean], heat: R() < 0.25 ? 0.7 : 0, layer: 'rock' });
  }
}

// 柱子倾斜后顶面的水平位移(包络检查要算进去)
export const leanOf = c => Math.hypot(c.tilt[0], c.tilt[1]) * c.h;

// ── L0:熔岩池的冷却岩壳边 = 池沿一圈扁平六边形岩板(很矮,读成地面不读成墙)──
function crustColumns(rf, R, out) {
  const n = Math.round(rf.r * 2 * Math.PI / 0.11);
  for (let i = 0; i < n; i++) for (let ring = 0; ring < 2; ring++) {
    const a = (i + ring * 0.5 + (R() - 0.5) * 0.4) / n * Math.PI * 2;
    const d = rf.r * (ring ? 1.06 : 0.93) + (R() - 0.5) * 0.06;
    out.push({ x: rf.x + Math.cos(a) * d, z: rf.z + Math.sin(a) * d, R: 0.065 + R() * 0.035, h: 0.025 + R() * 0.035,
      rot: R() * Math.PI, tilt: [(R() - 0.5) * 0.1, (R() - 0.5) * 0.1], heat: ring ? 0 : 0.45 + R() * 0.4, layer: 'crust' });
  }
}

// ── L1:边缘 ──
// 熔岩河:从锻炉两侧流出,沿远端台面边缘拐到两条长边,一直流到近端。只给控制点,渲染时再做平滑
export const FORGE = { x: 0, z: -8.0, scale: 1.3 };
export function riverPaths() {
  const right = [[0.95, -7.72], [2.4, -7.86], [3.9, -7.68], [5.15, -7.5], [5.8, -6.9], [5.88, -5.2], [5.82, -2.6],
    [5.9, 0], [5.84, 2.6], [5.9, 5.2], [5.86, 8.3]];
  return [right, right.map(([x, z]) => [-x, z])];
}
const RIVER_W = 0.3;

function edgeLayout(map, R, cols, props, rails) {
  const W = map.W, H = map.HALF, F = ARENA.frame;
  const col = (x, z, Rr, h, heat = 0) => cols.push({ x, z, R: Rr, h, rot: R() * Math.PI, tilt: [(R() - 0.5) * 0.12, (R() - 0.5) * 0.12], heat, layer: 'edge' });
  // 河岸岩壳:沿两条河两侧密排扁岩板
  for (const path of riverPaths()) {
    for (let i = 0; i < path.length - 1; i++) {
      const [x1, z1] = path[i], [x2, z2] = path[i + 1], L = Math.hypot(x2 - x1, z2 - z1), nx = -(z2 - z1) / L, nz = (x2 - x1) / L;
      for (let t = 0; t < L; t += 0.13) for (const sd of [-1, 1]) {
        const off = RIVER_W / 2 + 0.05 + R() * 0.06, x = x1 + (x2 - x1) * t / L + nx * off * sd, z = z1 + (z2 - z1) * t / L + nz * off * sd;
        if (Math.abs(x) > F.x - 0.1 || Math.abs(z) > F.z - 0.1) continue;
        col(x, z, 0.06 + R() * 0.04, 0.03 + R() * 0.04, R() < 0.3 ? 0.5 : 0);
      }
    }
  }
  // 长边外沿(河外侧)石柱群:每 0.55 一簇 2–4 根,高低错落
  for (const sx of [-1, 1]) for (let z = -6.6; z <= 8.2; z += 0.5 + R() * 0.5) {
    if (R() < 0.2) continue;   // 留几处空当,不排成栅栏
    const n = 1 + Math.floor(R() * 4), cx = sx * (6.1 + R() * 0.04), cz = z + (R() - 0.5) * 0.25;
    const cap = z > H ? NEAR_END_MAX_H : 0.75;
    for (let i = 0; i < n; i++) col(cx + (R() - 0.5) * 0.16, cz + (R() - 0.5) * 0.3, 0.07 + R() * 0.04, cap * (0.35 + R() * 0.65), R() < 0.15 ? 0.6 : 0);
  }
  // 近端(+Z,靠镜头)横带:低矮石柱群 + 岩板,限高 NEAR_END_MAX_H
  for (let x = -5.6; x <= 5.6; x += 0.5) {
    const cz = H + 1.0 + R() * 0.55, n = 1 + Math.floor(R() * 2), tall = R() < 0.3;
    for (let i = 0; i < n; i++) col(x + (R() - 0.5) * 0.3, cz + (R() - 0.5) * 0.3, 0.07 + R() * 0.04, NEAR_END_MAX_H * (tall ? 0.45 + R() * 0.4 : 0.06 + R() * 0.1), R() < 0.2 ? 0.6 : 0);
  }
  // 远端(-Z)锻炉两侧:河外侧的高石柱群,把锻炉"框"起来
  for (const sx of [-1, 1]) for (let x = 2.0; x <= 5.0; x += 0.4 + R() * 0.4) {
    if (R() < 0.25) continue;
    const cz = -(F.z - 0.3) + R() * 0.08, n = 1 + Math.floor(R() * 3), near = 1 - (x - 2.0) / 3.0;   // 越靠锻炉越高
    for (let i = 0; i < n; i++) col(sx * (x + (R() - 0.5) * 0.2), cz + (R() - 0.5) * 0.12, 0.08 + R() * 0.04, 0.25 + R() * 0.3 + near * 0.35, R() < 0.2 ? 0.7 : 0);
  }
  // 矿车轨道:长边中段、路缘石和河之间
  for (const sx of [-1, 1]) rails.push({ x: sx * 5.42, z1: -2.3, z2: 2.3 });
  // Tripo 配景(按 footprint 入库):铁砧 / 火盆 / 矿车 / 远端角上一座小火山锥
  const put = (name, x, z, rot, k = 1) => props.push({ name, x, z, rot, k });
  put('minecart', 5.42, -1.1, Math.PI / 2); put('minecart', 5.42, 1.3, Math.PI / 2); put('minecart', -5.42, 0.3, Math.PI / 2);
  put('anvil', 1.45, -7.32, 0.3); put('anvil', -1.5, -7.3, -0.2); put('anvil', 5.4, -3.6, 1.2); put('anvil', -5.4, 3.4, 2.0);
  put('brazier', 0.78, -7.28, 0, 0.75); put('brazier', -0.78, -7.28, 0, 0.75);
  for (const z of [-5.6, -3.0, 3.0, 5.6]) for (const sx of [-1, 1]) put('brazier', sx * 5.33, z + sx * 0.2, R() * Math.PI, 0.7);
  put('brazier', 3.2, H + 1.0, 0, 0.6); put('brazier', -3.2, H + 1.0, 0, 0.6);
  put('cone', 5.35, -8.0, 0.6, 0.42);
}

// 全部布局:{ columns, props, rails, rivers, forge }
export function volcanoLayout(map) {
  const R = rng('volcano-kit'), columns = [], props = [], rails = [];
  for (const w of map.walls) wallColumns(w, R, columns);
  for (const o of map.obstacles) rockColumns(o, R, columns);
  for (const rf of map.rifts) crustColumns(rf, R, columns);
  edgeLayout(map, R, columns, props, rails);
  return { columns: dedupe(columns), props, rails, rivers: riverPaths(), riverWidth: RIVER_W, forge: FORGE };
}

// 去重:圆心距 < 0.35R(几乎重合)的墙柱只留先放的
function dedupe(cols) {
  const out = [];
  for (const c of cols) {
    if (c.layer !== 'wall' || !out.some(o => o.layer === 'wall' && Math.hypot(o.x - c.x, o.z - c.z) < 0.35 * Math.min(o.R, c.R))) out.push(c);
  }
  return out;
}

// ── 几何检查(测试与调试共用)──
// 六边形顶点:外接圆半径 R、旋转 rot;倾斜带来的顶面位移按最坏方向加到半径上
export function hexVertices(c, extra = 0) {
  const r = c.R + extra;
  return Array.from({ length: 6 }, (_, k) => {
    const a = c.rot + k * Math.PI / 3;
    return [c.x + Math.cos(a) * r, c.z + Math.sin(a) * r];
  });
}
export function insideHex(c, px, pz) {
  const v = hexVertices(c);
  for (let k = 0; k < 6; k++) {
    const [ax, az] = v[k], [bx, bz] = v[(k + 1) % 6];
    if ((bx - ax) * (pz - az) - (bz - az) * (px - ax) < -1e-9) return false;
  }
  return true;
}

// 障碍套件的摆放数据(熔岩锻炉样板)— 纯数据,不依赖 three:渲染(obstacle-kit.js)和 Node 测试共用这一份
//   · 一切都是"玄武岩六棱柱":墙、熔渣堆、池沿岩壳、边缘石柱只是同一种柱子的不同排布 → 全图柱子 1 次 draw call
//   · 墙 = 直段 + 拐角接头 + 两端收头,沿 map.js 的碰撞折线排出来,外观贴合碰撞胶囊(偏差 ≤ ENVELOPE_TOL,墙高 ≤ WALL_MAX_H)
//   · 分层:L0 玩法层(墙 / 熔渣堆 / 池沿)在战场内;L1 边缘装饰(熔岩河、矿车轨道、铁砧、火盆、石柱群)全在战场外;
//     L2 地标(大锻炉)在敌方后方台面边缘。交战区不放任何装饰
//   · 摆放用固定种子,双方看到的布局一致
//   柱子:{ x, z, R(外接圆半径), h(露出地面的高度), rot(xz 平面里的数学角:第一个顶点方向 = (cos rot, sin rot);three 里 rotation.y = -rot), tilt: [tx, tz](绕 X / Z 的小倾斜,弧度), heat(0..1 顶面熔光), layer }
import { wallSegments, lavaCenterZ } from './map.js';
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
  const ROW_W = ROW + (wall.r - 0.285);   // 侧列离折线的距离随胶囊半径走(冰川的岩脊 r = 0.30)
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
      add(s.x1 + ux * t + nx * ROW_W * side, s.z1 + uz * t + nz * ROW_W * side, h, yaw, hot());
    }
    for (let i = 0; i < N; i++) {   // 中列错开半格,更高:墙的脊线
      const t = (i + 0.5) / N * L, h = 0.36 + R() * 0.12;
      add(s.x1 + ux * t, s.z1 + uz * t, h, yaw, hot() * 0.7);
    }
  });
  // 拐角接头:中心一根高柱 + 外侧沿 ROW_W 半径的圆弧补柱(两段的侧列在外侧会张开一个楔形缺口)
  for (let k = 1; k < wall.pts.length - 1; k++) {
    const [vx, vz] = wall.pts[k], a = segs[k - 1], b = segs[k];
    const a1 = Math.atan2(a.z2 - a.z1, a.x2 - a.x1), a2 = Math.atan2(b.z2 - b.z1, b.x2 - b.x1);
    let turn = a2 - a1;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    add(vx, vz, 0.44 + R() * 0.05, a1, 0);
    // 外侧:左转(turn>0)时外侧在右手边(法线 -1)
    const n0 = a1 + (turn > 0 ? -Math.PI / 2 : Math.PI / 2), steps = Math.max(1, Math.ceil(Math.abs(turn) * ROW_W / STEP));
    for (let i = 1; i < steps; i++) {
      const ang = n0 + turn * i / steps;
      add(vx + Math.cos(ang) * ROW_W, vz + Math.sin(ang) * ROW_W, 0.3 + R() * 0.08, ang);
    }
    // 内侧:两段侧列在拐点内侧的交点补一根(否则内角有个三角缺口)
    const inA = n0 + Math.PI + turn / 2, inD = ROW_W / Math.cos(turn / 2);
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

// ── 地形:玩法区压平 + 外圈台地(第二轮:两侧地形;第三轮:切割六棱柱 + 熔岩河)──
// 地形 GLB 的 Island 网格在战场外圈(战场边 → 黄线)是 build_terrain.py 按 relief 风格生成的起伏(熔岩 = 'cones',
// 最高 1.68),再被外框裁剪面切断 → 两条长边一排排随意鼓包。熔岩图改成:
//   · 玩法区(|x| ≤ W、|z| ≤ HALF)= 平地 FLOOR,只有有意的形体:星核祭坛台、横贯的熔岩河道(map.lava)
//   · 战场外 = 玄武岩台地,三级高差。第三轮起台地不再是一块挤出体,而是**一整片六棱柱阵列被边界平面切开**:
//     每块台地(凸多边形)把全局蜂窝格的每个六边形按自己的边界裁切(Sutherland–Hodgman),
//     边界上的柱子留下平整的切面 → 外缘是一条直线 / 直角,切面露出柱截面;台地之间的崖壁、熔岩河两岸同理
//   · Island 网格战场外的部分整体压到台沿下面(被台地盖住),heightAt 的高度图同步压平
export const FLOOR = 0.03;
export const TIER = { apron: 0.05, ledge: 0.12, step: 0.22, bench: 0.34, plateau: 0.54 };
const RIM_INSET = 0.05;   // 台地外缘离黄线内缩一点:黄线贴着崖脚露出来,像模型摆在托盘上
const BENCH_X = 5.62;     // 长边石台内缘(台沿 = 战场边 → 这里)
// 场地拉长(map.js FIELD_STRETCH,半长 6.8 → 7.6)后,战场外到黄线只剩约 1.04 格:各级台地按新纵深重排
const PLATEAU_Z = 8.0;    // 远端锻炉台前缘(|z|)(原 7.45)
const BENCH_END = 6.2;    // 石台在近端这里降一级(台阶)(原 5.4)
const STEP_END = 7.3;     // 台阶再降回台沿(原 6.5)
const APRON_Z = 7.95;     // 近端(靠镜头)台沿再降一级成矮台(apron),熔岩河在这里最后落一次(原 7.6)
const APRON_IN = 0.3;     // 矮台块往里伸到 APRON_Z − APRON_IN(被台沿盖住),不能伸进战场
const RIVER_W = 0.3;
const RIVER_X = 5.27;     // 长边熔岩河中心线(台沿上,战场边与石台之间)
const BED_LO = RIVER_X - RIVER_W / 2 - 0.04, BED_HI = RIVER_X + RIVER_W / 2 + 0.04;   // 河床(台沿上切出的槽)
const LEDGE_BED = TIER.ledge - 0.045, APRON_BED = TIER.apron - 0.03, APRON_BED_END = 8.55;
const HEX_T = 0.14;       // 台地柱外接圆半径(柱顶对边宽约 0.24)
const HEX_F = 0.085;      // 场内(河岸 / 岩桥 / 祭坛台)柱子更细

// 场内熔岩河(第三轮)
export const LAVA_SURFACE = FLOOR - 0.05;   // 熔岩面
const CHANNEL = 0.11;                        // 河道比平地低多少(地形)
const BANK_W = 0.2;                          // 两岸切割柱带宽
const BANK_TOP = FLOOR + 0.045;              // 岸柱顶(比平地高一点,读成一道岩沿)
export const PLAT_R = 1.25;                  // 祭坛台半径(≥ 占领圈 1.2,熔岩从台下流过)
export const PLAT_TOP = FLOOR + 0.21;
const FIELD_BOTTOM = FLOOR - CHANNEL - 0.02;
const DECK_TOP = FLOOR + 0.012;              // 冷却岩桥桥面(几乎与地面齐平,单位走上去不跳)

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const onBridge = (L, x, pad = 0) => L.bridges.some(b => Math.abs(x - b.x) < b.half + pad);

// 玩法区地面高度
//   有熔岩(第三轮):平地 + 河道(低 CHANNEL,岩桥处不挖)+ 祭坛台(半径 PLAT_R 的平台,熔岩从下面过)
//   没有熔岩(老布局):平地 + 星核圆台(顶 ≈ FLOOR+0.21)+ 熔岩池浅盆(底 ≈ FLOOR−0.28)
export function fieldHeight(map, x, z) {
  const N = map.node, L = map.lava;
  if (L) {
    if (Math.hypot(x - N.x, z - N.z) < PLAT_R) return PLAT_TOP;
    if (onBridge(L, x)) return FLOOR;
    const d = Math.abs(z - lavaCenterZ(L, map.W, x));
    return FLOOR - CHANNEL * (1 - smooth(L.half - 0.03, L.half + 0.03, d));
  }
  let y = FLOOR + 0.21 * (1 - smooth(N.r + 0.25, N.r + 1.2, Math.hypot(x - N.x, z - N.z)));
  for (const r of map.rifts) y -= 0.28 * (1 - smooth(r.r * 0.3, r.r * 1.02, Math.hypot(x - r.x, z - r.z)));
  return y;
}

// ── 凸多边形工具(xz 平面,逆时针:内部在每条边的左侧)──
const rectPoly = (x1, z1, x2, z2) => [[x1, z1], [x2, z1], [x2, z2], [x1, z2]];
function chamferPoly(x1, z1, x2, z2, c) {
  return [[x1 + c, z1], [x2 - c, z1], [x2, z1 + c], [x2, z2 - c], [x2 - c, z2], [x1 + c, z2], [x1, z2 - c], [x1, z1 + c]];
}
function edgeSide(a, b, p) {   // 点 p 在有向边 a→b 左侧的距离(左正)
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  return (dx * (p[1] - a[1]) - dz * (p[0] - a[0])) / l;
}
export function inConvex(poly, x, z, eps = 1e-9) {
  for (let i = 0; i < poly.length; i++) if (edgeSide(poly[i], poly[(i + 1) % poly.length], [x, z]) < -eps) return false;
  return true;
}
// Sutherland–Hodgman:poly 被凸多边形 clip 裁剪
function clipPoly(poly, clip) {
  let out = poly;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], inp = out;
    out = [];
    for (let k = 0; k < inp.length; k++) {
      const p = inp[k], q = inp[(k + 1) % inp.length], sp = edgeSide(a, b, p), sq = edgeSide(a, b, q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
  }
  return out.filter((p, i) => Math.hypot(p[0] - out[(i + 1) % out.length][0], p[1] - out[(i + 1) % out.length][1]) > 1e-6);
}
export function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return a / 2;
}
const ccw = p => (polyArea(p) < 0 ? [...p].reverse() : p);
// 矩形减矩形(轴对齐),返回剩下的矩形列表 [x1, z1, x2, z2]
function subtractRect(rects, h) {
  const out = [];
  for (const r of rects) {
    const [x1, z1, x2, z2] = r;
    if (h[0] >= x2 || h[2] <= x1 || h[1] >= z2 || h[3] <= z1) { out.push(r); continue; }
    if (h[1] > z1) out.push([x1, z1, x2, h[1]]);
    if (h[3] < z2) out.push([x1, h[3], x2, z2]);
    const zz1 = Math.max(z1, h[1]), zz2 = Math.min(z2, h[3]);
    if (h[0] > x1) out.push([x1, zz1, h[0], zz2]);
    if (h[2] < x2) out.push([h[2], zz1, x2, zz2]);
  }
  return out;
}

// 台地块:{ name, top, polys: [凸多边形...](取交集), lattice: 'T' };块与块可以重叠,重叠处高的盖住低的
//   台沿(ledge)= 外框矩形 − 战场 − 河床 − 落水口,切成若干矩形;河床、落水口是台沿上低一级的块
// opt.beds:台沿上切出边河河床(只有熔岩锻炉有边河;星核 / 冰川的台沿是整块)
export function terraceBlocks(map, { beds: withBeds = true } = {}) {
  const F = ARENA.frame, X = F.x - RIM_INSET, Z = F.z - RIM_INSET, W = map.W, H = map.HALF;
  const blocks = [];
  const add = (name, top, ...polys) => blocks.push({ name, top, polys });   // 河床块(name = 'bed')渲染时不抖高度、再压低一点,柱顶不会冒出熔岩面
  // 河床:长边台沿上的槽(左河从锻炉落下处开始,右河从锻炉台前缘开始)+ 锻炉瀑布穿过外侧窄条的缺口 + 场内熔岩河的两个出水口
  const beds = [];
  if (withBeds) for (const sx of [-1, 1]) {
    const [a, b] = sx > 0 ? [BED_LO, BED_HI] : [-BED_HI, -BED_LO];
    beds.push([a, sx < 0 ? FORGE.z - 0.3 : -PLATEAU_Z, b, APRON_Z]);
    if (map.lava) {   // 出水口:河道中心线在边线处的 z(= 0)
      const zm = lavaCenterZ(map.lava, W, sx * W);
      beds.push(sx > 0 ? [W, zm - 0.2, BED_LO, zm + 0.2] : [-BED_LO, zm - 0.2, -W, zm + 0.2]);
    }
  }
  if (withBeds) beds.push([-BENCH_X, FORGE.z - 0.3, -BED_HI, FORGE.z + 0.3]);
  let ledge = subtractRect([[-X, -Z, X, APRON_Z]], [-W, -H, W, H]);
  for (const b of beds) ledge = subtractRect(ledge, b);
  for (const r of ledge) add('ledge', TIER.ledge, rectPoly(...r));
  for (const b of beds) add('bed', LEDGE_BED, rectPoly(...b));
  // 矮台(近端,带倒角)中间也切出两条河床
  const apronOct = chamferPoly(-X, APRON_Z - APRON_IN, X, Z, 0.45);
  let apron = [[-X, APRON_Z - APRON_IN, X, Z]];
  if (withBeds) for (const sx of [-1, 1]) apron = subtractRect(apron, sx > 0 ? [BED_LO, APRON_Z, BED_HI, APRON_BED_END] : [-BED_HI, APRON_Z, -BED_LO, APRON_BED_END]);
  for (const r of apron) add('apron', TIER.apron, rectPoly(...r), apronOct);
  if (withBeds) for (const sx of [-1, 1]) add('bed', APRON_BED, rectPoly(...(sx > 0 ? [BED_LO, APRON_Z, BED_HI, APRON_BED_END] : [-BED_HI, APRON_Z, -BED_LO, APRON_BED_END])));
  for (const sx of [-1, 1]) {
    const [a, b] = sx > 0 ? [BENCH_X, X] : [-X, -BENCH_X];
    add('bench', TIER.bench, chamferPoly(a, -Z, b, BENCH_END, 0.14));
    const [sa, sb] = sx > 0 ? [a + 0.12, b] : [a, b - 0.12];   // 台阶内缘比石台再退一点,读成一级一级往下
    add('step', TIER.step, chamferPoly(sa, BENCH_END - 0.2, sb, STEP_END, 0.14));
  }
  add('plateau', TIER.plateau, chamferPoly(-X, -Z, X, -PLATEAU_Z, 0.3));
  return blocks;
}

const inBlock = (b, x, z) => b.polys.every(p => inConvex(p, x, z));
// 战场外某点的台地顶高(重叠处取最高);在战场内返回 null(交给地形高度图)
export function terraceTop(map, blocks, x, z) {
  if (Math.abs(x) <= map.W && Math.abs(z) <= map.HALF) return null;
  let top = null;
  for (const b of blocks) if (inBlock(b, x, z)) top = Math.max(top ?? -Infinity, b.top);
  return top ?? FLOOR;
}

// 熔岩面高度:场内河道 / 台沿河床里返回熔岩面 y,否则 null(切面朝向熔岩的柱子底部发红用)
function lavaSurfaceAt(map, x, z) {
  const L = map.lava;
  if (L && Math.abs(x) <= map.W && Math.abs(z) <= map.HALF) {
    if (Math.hypot(x - map.node.x, z - map.node.z) < PLAT_R || onBridge(L, x)) return null;
    return Math.abs(z - lavaCenterZ(L, map.W, x)) < L.half + 0.02 ? LAVA_SURFACE : null;
  }
  const ax = Math.abs(x);
  if (L && ax > BED_LO && ax < BED_HI && z > (x < 0 ? FORGE.z - 0.3 : -PLATEAU_Z) && z < APRON_BED_END) return (z < APRON_Z ? LEDGE_BED : APRON_BED) + 0.008;
  return null;
}

// ── 切割六棱柱 ──
// 柱子:{ poly(裁切后的凸多边形), cut[](每条边是不是切面), glow[](切面外侧是熔岩:熔岩面 y,否则 null),
//   cx, cz, R(原六边形格心 / 外接圆半径,柱顶画格缝用), top, bottom, kind, heat(柱顶熔光 0..1)}
const hash2 = (i, j, s) => { let h = Math.imul(i * 73856093 ^ j * 19349663 ^ s * 83492791, 0x9E3779B1); h ^= h >>> 15; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
function hexAt(cx, cz, R) { return Array.from({ length: 6 }, (_, k) => [cx + Math.cos(k * Math.PI / 3) * R, cz + Math.sin(k * Math.PI / 3) * R]); }
// 蜂窝格:平顶朝 x(第一个顶点 +X),列距 1.5R,行距 √3R,奇数列错半格
function latticeCells(polys, R, fn) {
  const xs = polys.flatMap(p => p.map(q => q[0])), zs = polys.flatMap(p => p.map(q => q[1]));
  const i0 = Math.floor(Math.min(...xs) / (1.5 * R)) - 1, i1 = Math.ceil(Math.max(...xs) / (1.5 * R)) + 1;
  const dz = Math.sqrt(3) * R;
  const j0 = Math.floor(Math.min(...zs) / dz) - 1, j1 = Math.ceil(Math.max(...zs) / dz) + 1;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(i, j, i * 1.5 * R, j * dz + (i & 1 ? dz / 2 : 0));
}
function cutColumns(polys, { R, top, bottom, kind, seed, jitter = 0.01, skip, heat, raise, raiseHeat = 0, map }, out) {
  latticeCells(polys, R, (i, j, cx, cz) => {
    let poly = hexAt(cx, cz, R);
    for (const p of polys) poly = clipPoly(poly, p);
    if (poly.length < 3 || polyArea(poly) < R * R * 0.03) return;
    if (skip?.(poly)) return;
    const n = poly.length, cut = [], glow = [];
    for (let k = 0; k < n; k++) {
      const a = poly[k], b = poly[(k + 1) % n];
      const isCut = polys.some(p => p.some((c, m) => Math.abs(edgeSide(c, p[(m + 1) % p.length], a)) < 1e-6 && Math.abs(edgeSide(c, p[(m + 1) % p.length], b)) < 1e-6));
      cut.push(isCut);
      let g = null;
      if (isCut) {   // 切面外侧 0.06 处是熔岩 → 底部发红
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ox = (b[1] - a[1]) / L, oz = -(b[0] - a[0]) / L;
        g = lavaSurfaceAt(map, (a[0] + b[0]) / 2 + ox * 0.06, (a[1] + b[1]) / 2 + oz * 0.06);
      }
      glow.push(g);
    }
    const full = n === 6 && !cut.some(Boolean);
    const h = hash2(i, j, seed);
    const up = raise ? raise(cx, cz, full, i, j) : 0;
    const t = top + (h - 0.5) * 2 * jitter + up;
    out.push({ poly, cut, glow, cx, cz, R, top: t, bottom, kind, heat: heat ? heat(cx, cz, h) : up > 0 ? raiseHeat : 0 });
  });
}

// 台地 + 场内(河岸 / 岩桥 / 祭坛台)的全部切割柱
// opt.raiseHeat:抬高的石柱群柱顶发光强度(星核:晶簇;熔岩 / 冰川:0)
export function cutColumnsLayout(map, blocks, keepOut, { raiseHeat = 0 } = {}) {
  const out = [], base = ARENA.top - 0.004, F = ARENA.frame, X = F.x - RIM_INSET, Z = F.z - RIM_INSET;
  // 台地:被更高的块整个盖住的格子不生成(省三角形);部分盖住的照常生成(多出的部分藏在高块里面)
  // 石柱群:只在外圈、离边界至少一格的完整格子上抬高(不碰切面,外缘那条线保持干净);避开配景 / 轨道 / 锻炉
  const lowNoise = (x, z) => 0.5 + 0.25 * Math.sin(x * 1.7 + 0.6) * Math.cos(z * 1.3 - 0.4) + 0.25 * Math.sin(x * 0.7 - z * 1.1);
  const clear = (x, z, r) => keepOut.every(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) > kr + r);
  const raiseFor = name => (cx, cz, full, i, j) => {
    if (!full || !clear(cx, cz, HEX_T)) return 0;
    const ax = Math.abs(cx), h = hash2(i, j, 91);
    if (name === 'bench' && ax > X - 0.62 && ax < X - 0.2 && cz < BENCH_END - 0.5 && lowNoise(cx, cz) > 0.6 && h < 0.55) return 0.06 + h * 0.4;
    if (name === 'plateau' && cz < -Z + 0.62 && cz > -Z + 0.2 && ax < X - 0.2 && lowNoise(cx, cz) > 0.58 && h < 0.6) return 0.08 + h * 0.5;
    if (name === 'apron' && cz > Z - 0.62 && cz < Z - 0.2 && ax < X - 0.2 && lowNoise(cx, cz) > 0.62 && h < 0.5) return Math.min(NEAR_END_MAX_H - TIER.apron - 0.012, 0.04 + h * 0.5);
    return 0;
  };
  for (const b of blocks) {
    const higher = blocks.filter(o => o.top > b.top);
    const bed = b.name === 'bed';
    cutColumns(b.polys, { R: HEX_T, top: b.top - (bed ? 0.015 : 0), jitter: bed ? 0 : 0.01, bottom: base, kind: b.name, seed: 7, map,
      skip: poly => higher.some(o => poly.every(([x, z]) => inBlock(o, x, z))),
      raise: ['bench', 'plateau', 'apron'].includes(b.name) ? raiseFor(b.name) : null, raiseHeat }, out);
  }
  const L = map.lava;
  if (!L) return out;
  // 河岸:两岸各一条 BANK_W 宽的带子,沿中心线每 0.3 一段四边形;在岩桥、祭坛台处断开(祭坛台下面藏一点)
  const zc = x => lavaCenterZ(L, map.W, x);
  const spans = [];
  let x0 = -map.W;
  const cuts = [...L.bridges.map(b => [b.x - b.half, b.x + b.half]), [-0.95, 0.95]].sort((a, b) => a[0] - b[0]);
  for (const [a, b] of cuts) { spans.push([x0, a]); x0 = b; }
  spans.push([x0, map.W]);
  for (const [a, b] of spans) {
    const n = Math.max(1, Math.ceil((b - a) / 0.3));
    for (let k = 0; k < n; k++) {
      const xa = a + (b - a) * k / n, xb = a + (b - a) * (k + 1) / n;
      for (const s of [-1, 1]) {
        const q = ccw([[xa, zc(xa) + s * L.half], [xb, zc(xb) + s * L.half], [xb, zc(xb) + s * (L.half + BANK_W)], [xa, zc(xa) + s * (L.half + BANK_W)]]);
        cutColumns([q], { R: HEX_F, top: BANK_TOP, bottom: FIELD_BOTTOM, kind: 'bank', seed: 11, jitter: 0.012, map,
          heat: (cx, cz, h) => (h < 0.12 ? 0.7 : 0) }, out);
      }
    }
  }
  // 冷却岩桥:河道上一块与地面齐平的玄武岩桥面(顶面带暗红裂纹)
  for (const b of L.bridges) {
    const za = Math.min(zc(b.x - b.half), zc(b.x + b.half)) - L.half - 0.05, zb = Math.max(zc(b.x - b.half), zc(b.x + b.half)) + L.half + 0.05;
    cutColumns([rectPoly(b.x - b.half, za, b.x + b.half, zb)], { R: HEX_F, top: DECK_TOP, bottom: FIELD_BOTTOM, kind: 'bridge', seed: 13, jitter: 0.004, map,
      heat: (cx, cz, h) => (h < 0.2 ? 0.4 + h : 0) }, out);
  }
  // 祭坛台:圆形柱阵(28 边形裁切),熔岩从台下穿过;祭坛模型压在台面上
  const N = map.node, circle = Array.from({ length: 28 }, (_, k) => [N.x + Math.cos(k / 28 * Math.PI * 2) * PLAT_R, N.z + Math.sin(k / 28 * Math.PI * 2) * PLAT_R]);
  cutColumns([circle], { R: HEX_F, top: PLAT_TOP, bottom: FIELD_BOTTOM, kind: 'altar', seed: 17, jitter: 0.006, map }, out);
  return out;
}

// ── L1:边缘 ──
// 锻炉:左长边石台靠远端的一段,炉口朝战场(上一轮在远端正中,桌面视角下被顶部 HUD 和敌方核心挡住;
//   放到远端台地左后角也还是顶到 HUD,所以落在石台上、往镜头方向挪,桌面默认视角能看到完整轮廓)
export const FORGE = { x: -5.98, z: -6.3, scale: 0.68, rot: Math.PI / 2 };   // z 原 −5.55,随场地拉长后移
// 熔岩河:三维控制点 [x, z, y, 宽?],渲染时平滑。
//   左:锻炉炉口 → 越过石台边落进河床(熔岩瀑布)→ 左长边河床 → 近端落到矮台河床
//   右:远端右角火山锥脚下 → 越过锻炉台前缘落进河床 → 右长边河床 → 近端
//   瀑布 = 唇口(台顶)+ 外挑一点 + 崖脚(河床),几个点挨得很近,平滑后仍是一道陡帘
export function riverPaths() {
  const B = TIER.bench + 0.012, P = TIER.plateau + 0.012, LB = LEDGE_BED + 0.008, fz = -PLATEAU_Z;
  const AB = APRON_BED + 0.008;
  const side = (sx, z0) => [[sx * RIVER_X, z0, LB], [sx * RIVER_X, -3.2, LB], [sx * RIVER_X, 0, LB], [sx * RIVER_X, 3.2, LB], [sx * RIVER_X, 6.4, LB],
    [sx * RIVER_X, APRON_Z - 0.08, LB], [sx * RIVER_X, APRON_Z + 0.02, LB - 0.03], [sx * RIVER_X, APRON_Z + 0.1, AB], [sx * RIVER_X, APRON_BED_END - 0.12, AB]];
  const fx = -BENCH_X, fzf = FORGE.z;
  const left = [[fx - 0.12, fzf, B], [fx - 0.02, fzf + 0.01, B], [fx + 0.1, fzf + 0.02, B - 0.13], [fx + 0.18, fzf + 0.05, LB],
    [-RIVER_X, fzf + 0.4, LB], ...side(-1, -4.6)];
  const right = [[5.42, fz - 0.37, P], [5.3, fz - 0.17, P], [5.3, fz - 0.06, P], [5.29, fz + 0.04, P - 0.12], [5.28, fz + 0.12, LB],
    [RIVER_X, fz + 0.45, LB], ...side(1, -6.3)];
  return [left, right];
}
// 场内熔岩河(第三轮):从两条边河在 z≈0 处分出一股,穿过台沿的出水口落进河道,沿中心线流向星核,钻到祭坛台下面。
//   左右两股绕星核旋转 180° 对称;第 4 个分量是河宽
export function fieldRiverPaths(map) {
  const L = map.lava;
  if (!L) return [];
  const LB = LEDGE_BED + 0.008, zc = x => lavaCenterZ(L, map.W, x), wide = 2 * L.half + 0.12;
  const W = map.W, z0 = zc(-W);
  const left = [[-RIVER_X, z0, LB, RIVER_W], [-5.05, z0, LB, RIVER_W], [-W - 0.06, z0, LB - 0.004, RIVER_W + 0.04], [-W + 0.01, z0, LAVA_SURFACE + 0.05, 0.5],
    [-W + 0.08, zc(-W + 0.08), LAVA_SURFACE, wide * 0.85]];
  for (let x = -W + 0.3; x <= -0.9 + 1e-9; x += 0.3) left.push([x, zc(x), LAVA_SURFACE, wide]);
  return [left, left.map(([x, z, y, w]) => [-x, -z, y, w])];
}

function edgeLayout(map, props, rails) {
  const H = map.HALF, F = ARENA.frame;
  // 河岸、长边 / 远端石柱群、近端矮岩板:第三轮全部并进切割柱台地(河床两岸是切面,石柱群是抬高的整格柱)
  // 矿车轨道:长边石台中段
  const X = F.x - RIM_INSET, railX = (BENCH_X + X) / 2 - 0.06;
  for (const sx of [-1, 1]) rails.push({ x: sx * railX, z1: -2.3, z2: 2.3, y: TIER.bench });
  // Tripo 配景(按 footprint 入库):铁砧 / 火盆 / 矿车在石台和锻炉台上;远端右角一座小火山锥
  const put = (name, x, z, rot, k = 1) => props.push({ name, x, z, rot, k });
  put('minecart', railX, -1.1, Math.PI / 2); put('minecart', railX, 1.3, Math.PI / 2); put('minecart', -railX, 0.3, Math.PI / 2);
  put('anvil', -railX, -4.15, 0.3); put('anvil', 2.6, -8.3, -0.2); put('anvil', railX, -3.7, 1.2); put('anvil', -railX, 3.5, 2.0);
  put('brazier', 1.25, -8.3, 0, 0.75); put('brazier', -1.25, -8.3, 0, 0.75);
  for (const [x, z] of [[railX, -5.4], [railX, -2.8], [-railX, -3.2], [railX, 3.2], [-railX, 2.8]]) put('brazier', x, z, 0.4 + x * z, 0.7);
  put('brazier', 3.2, APRON_Z + 0.35, 0, 0.6); put('brazier', -3.2, APRON_Z + 0.35, 0, 0.6);
  put('cone', 5.5, -8.3, 0.6, 0.38);
  // 石柱群避让:配景、轨道两端之间、锻炉、火山锥
  const keepOut = props.map(p => [p.x, p.z, p.name === 'cone' ? 0.75 : 0.35]);
  for (const r of rails) for (let z = r.z1; z <= r.z2; z += 0.3) keepOut.push([r.x, z, 0.2]);
  keepOut.push([FORGE.x, FORGE.z, 1.15]);
  return keepOut;
}

// 全部布局:{ columns(实例化柱:墙 / 熔渣堆), cutColumns(切割柱:台地 / 河岸 / 岩桥 / 祭坛台), props, rails, rivers, fieldRivers, forge, terraces }
export function volcanoLayout(map) {
  const R = rng('volcano-kit'), columns = [], props = [], rails = [];
  for (const w of map.walls) wallColumns(w, R, columns);
  for (const o of map.obstacles) rockColumns(o, R, columns);
  for (const rf of map.rifts) crustColumns(rf, R, columns);
  const keepOut = edgeLayout(map, props, rails);
  const terraces = terraceBlocks(map);
  return { columns: dedupe(columns), cutColumns: cutColumnsLayout(map, terraces, keepOut), props, rails,
    rivers: riverPaths(), fieldRivers: fieldRiverPaths(map), riverWidth: RIVER_W, riverRibbon: BED_HI - BED_LO - 0.03, forge: FORGE, terraces };
}

// ── 星核荒原 / 冰封裂谷(2026-11-16,熔岩样板推广):同一套切割柱台地 + 墙柱套件,只换主题;没有边河 / 锻炉 ──
//   星核:「星石台地」——砂岩色台地,外圈抬高的整格柱是发紫光的晶簇;地标 = 远端台地上的平顶山 + 方尖碑,石台上的钻机 / 货箱 / 信标
//   冰川:「冰崖台地」——冰层色台地(浅冰蓝顶、深蓝切面),墙是深色岩芯柱带冰晶顶;地标 = 远端冰峰 + 方尖碑,石台上的雪橇 / 信标 / 雪松
//   配景用各图已有的 Tripo 套件(按名字摆放),交战区零装饰;玩法元素(裂隙 / 冰路)不动
const BX = (BENCH_X + ARENA.frame.x - RIM_INSET) / 2;   // 长边石台中线
function themedLayout(map, seedStr, props, opts) {
  const R = rng(seedStr), columns = [];
  for (const w of map.walls) wallColumns(w, R, columns);
  for (const o of map.obstacles) rockColumns(o, R, columns);
  for (const rf of map.rifts) crustColumns(rf, R, columns);
  const keepOut = props.map(p => [p.x, p.z, p.keep ?? 0.4]);
  const terraces = terraceBlocks(map, { beds: false });
  return { columns: dedupe(columns), cutColumns: cutColumnsLayout(map, terraces, keepOut, opts), props, rails: [], rivers: [], fieldRivers: [],
    riverWidth: RIVER_W, forge: null, terraces, ice: map.ice ?? null };
}
const P = (name, x, z, rot, k, keep) => ({ name, x, z, rot, k, keep });
export const starcoreLayout = map => themedLayout(map, 'starcore-kit', [
  P('mesa', BX, -6.3, 0.4, 0.26, 0.8), P('monolith', -BX, -6.3, 0.2, 0.5, 0.5),   // 地标从远端两角挪到长边石台远段(远角被顶部 HUD 挡,同熔岩锻炉)
  P('drill', BX, -2.4, Math.PI / 2, 0.62, 0.5), P('crates', BX, -1.5, 0.3, 0.9), P('beacon', -BX, -4.6, 0, 0.8), P('beacon', BX, 3.2, 0, 0.8),
  P('crates', -BX, 2.2, 1.1, 0.9), P('drill', -BX, 0.2, -Math.PI / 2, 0.62, 0.5),
], { raiseHeat: 0.85 });
export const glacierLayout = map => themedLayout(map, 'glacier-kit', [
  P('icepeak', BX, -6.3, 0.5, 0.27, 0.8), P('obelisk', -BX, -6.3, 0.1, 0.5, 0.5),   // 同上
  P('sled', -BX, -2.0, Math.PI / 2, 0.95), P('beacon', BX, 3.2, 0, 0.8), P('beacon', -BX, -4.6, 0, 0.8),
  P('pine', BX, -4.3, 0, 0.5), P('pine', -BX, 4.6, 1.3, 0.45), P('hut', BX, -0.6, -Math.PI / 2, 0.55, 0.5),
], { raiseHeat: 0 });

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

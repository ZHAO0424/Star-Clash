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

// ── 地形:玩法区压平 + 外圈台地(第二轮:两侧地形)──
// 地形 GLB 的 Island 网格在战场外圈(战场边 → 黄线)是 build_terrain.py 按 relief 风格生成的起伏(熔岩 = 'cones',
// 最高 1.68),再被外框裁剪面切断 → 两条长边一排排随意鼓包。熔岩图改成:
//   · 玩法区(|x| ≤ W、|z| ≤ HALF)= 平地 FLOOR,只保留两个有意的形体:星核圆台、熔岩池浅盆(都是平滑解析形状)
//   · 战场外 = 程序化玄武岩台地,三级高差、每级是平顶 + 倒角崖壁:
//       台沿(ledge)环绕战场一圈,低;长边外侧是石台(bench),在近端前一级台阶收住;远端是最高的锻炉台(plateau)
//   · Island 网格战场外的部分整体压到台沿下面(被台地盖住),heightAt 的高度图同步压平
export const FLOOR = 0.03;
export const TIER = { apron: 0.05, ledge: 0.12, step: 0.22, bench: 0.34, plateau: 0.54 };
const RIM_INSET = 0.05;   // 台地外缘离黄线内缩一点:黄线贴着崖脚露出来,像模型摆在托盘上
const BENCH_X = 5.62;     // 长边石台内缘(台沿 = 战场边 → 这里)
const PLATEAU_Z = 7.45;   // 远端锻炉台前缘(|z|)
const BENCH_END = 5.4;    // 石台在近端这里降一级(台阶)
const STEP_END = 6.5;     // 台阶再降回台沿
const APRON_Z = 7.6;      // 近端(靠镜头)台沿再降一级成矮台(apron),熔岩河在这里最后落一次

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 玩法区地面高度:平地 + 星核圆台(顶 ≈ FLOOR+0.21)+ 熔岩池浅盆(底 ≈ FLOOR−0.28)
export function fieldHeight(map, x, z) {
  const N = map.node;
  let y = FLOOR + 0.21 * (1 - smooth(N.r + 0.25, N.r + 1.2, Math.hypot(x - N.x, z - N.z)));
  for (const r of map.rifts) y -= 0.28 * (1 - smooth(r.r * 0.3, r.r * 1.02, Math.hypot(x - r.x, z - r.z)));
  return y;
}

// 台地块:{ name, top, rect: [x1, z1, x2, z2], chamfer(四角倒角), hole?: rect(挖空,只有台沿用)}
export function terraceBlocks(map) {
  const F = ARENA.frame, X = F.x - RIM_INSET, Z = F.z - RIM_INSET;
  const blocks = [{ name: 'ledge', top: TIER.ledge, rect: [-X, -Z, X, APRON_Z], chamfer: 0.45, hole: [-map.W, -map.HALF, map.W, map.HALF] },
    { name: 'apron', top: TIER.apron, rect: [-X, APRON_Z - 0.4, X, Z], chamfer: 0.45 }];
  for (const sx of [-1, 1]) {
    const [a, b] = sx > 0 ? [BENCH_X, X] : [-X, -BENCH_X];
    blocks.push({ name: 'bench', top: TIER.bench, rect: [a, -Z, b, BENCH_END], chamfer: 0.14 });
    const [sa, sb] = sx > 0 ? [a + 0.12, b] : [a, b - 0.12];   // 台阶内缘比石台再退一点,读成一级一级往下
    blocks.push({ name: 'step', top: TIER.step, rect: [sa, BENCH_END - 0.2, sb, STEP_END], chamfer: 0.14 });
  }
  blocks.push({ name: 'plateau', top: TIER.plateau, rect: [-X, -Z, X, -PLATEAU_Z], chamfer: 0.3 });
  return blocks;
}

// 战场外某点的台地顶高;在战场内返回 null(交给地形高度图)
export function terraceTop(map, blocks, x, z) {
  if (Math.abs(x) <= map.W && Math.abs(z) <= map.HALF) return null;
  let top = FLOOR;
  for (const b of blocks) {
    const [x1, z1, x2, z2] = b.rect;
    if (x >= x1 && x <= x2 && z >= z1 && z <= z2) top = Math.max(top, b.top);
  }
  return top;
}

// ── L1:边缘 ──
// 锻炉:左长边石台靠远端的一段,炉口朝战场(上一轮在远端正中,桌面视角下被顶部 HUD 和敌方核心挡住;
//   放到远端台地左后角也还是顶到 HUD,所以落在石台上、往镜头方向挪,桌面默认视角能看到完整轮廓)
export const FORGE = { x: -5.98, z: -5.55, scale: 0.68, rot: Math.PI / 2 };
const RIVER_W = 0.3;
const RIVER_X = 5.27;     // 长边熔岩河中心线(台沿上,战场边与石台之间;离战场边 ≥ 0.3 + 半河宽)
// 熔岩河:三维控制点 [x, z, y],渲染时平滑。
//   左:锻炉炉口 → 越过石台边落下(熔岩瀑布)→ 左长边台沿 → 近端
//   右:远端右角火山锥脚下 → 越过锻炉台前缘落下(熔岩瀑布)→ 右长边台沿 → 近端
//   瀑布 = 唇口(台顶)+ 外挑一点 + 崖脚(台沿),几个点挨得很近,平滑后仍是一道陡帘
export function riverPaths() {
  const B = TIER.bench + 0.012, P = TIER.plateau + 0.012, L = TIER.ledge + 0.008, fz = -PLATEAU_Z;
  const A = TIER.apron + 0.008;
  // 长边 → 近端:在台沿尽头再落一小级到矮台(apron)上收尾
  const side = (sx, z0) => [[sx * RIVER_X, z0, L], [sx * RIVER_X, -3.2, L], [sx * RIVER_X, 0, L], [sx * RIVER_X, 3.2, L], [sx * RIVER_X, 6.4, L],
    [sx * RIVER_X, APRON_Z - 0.08, L], [sx * RIVER_X, APRON_Z + 0.02, L - 0.03], [sx * RIVER_X, APRON_Z + 0.1, A], [sx * RIVER_X, 8.3, A]];
  const fx = -BENCH_X, fzf = FORGE.z;
  const left = [[fx - 0.12, fzf, B], [fx - 0.02, fzf + 0.01, B], [fx + 0.1, fzf + 0.02, B - 0.11], [fx + 0.18, fzf + 0.05, L],
    [-RIVER_X, fzf + 0.4, L], ...side(-1, -4.6)];
  const right = [[5.42, -7.82, P], [5.3, -7.62, P], [5.22, fz - 0.06, P], [5.21, fz + 0.04, P - 0.12], [5.22, fz + 0.12, L],
    [RIVER_X, fz + 0.45, L], ...side(1, -6.3)];
  return [left, right];
}

function edgeLayout(map, R, cols, props, rails) {
  const H = map.HALF, F = ARENA.frame, X = F.x - RIM_INSET;
  const col = (x, z, Rr, h, heat = 0) => cols.push({ x, z, R: Rr, h, rot: R() * Math.PI, tilt: [(R() - 0.5) * 0.12, (R() - 0.5) * 0.12], heat, layer: 'edge' });
  // 河岸岩壳:沿两条河两侧密排扁岩板(瀑布段跳过)
  for (const path of riverPaths()) {
    for (let i = 0; i < path.length - 1; i++) {
      const [x1, z1, y1] = path[i], [x2, z2, y2] = path[i + 1], L = Math.hypot(x2 - x1, z2 - z1), nx = -(z2 - z1) / L, nz = (x2 - x1) / L;
      if (Math.abs(y2 - y1) > 0.01 || Math.abs(z1 - APRON_Z) < 0.2) continue;
      for (let t = 0; t < L; t += 0.13) for (const sd of [-1, 1]) {
        const off = RIVER_W / 2 + 0.05 + R() * 0.05, x = x1 + (x2 - x1) * t / L + nx * off * sd, z = z1 + (z2 - z1) * t / L + nz * off * sd;
        if (Math.abs(x) > X - 0.1 || Math.abs(z) > F.z - 0.15) continue;
        if (Math.abs(x) > BENCH_X - 0.06 && Math.abs(x) < BENCH_X + 0.06) continue;   // 不压在石台崖边上
        if (Math.abs(x) <= map.W + 0.3 && Math.abs(z) <= H + 0.3) continue;            // 拐角内侧:离战场太近
        col(x, z, 0.06 + R() * 0.035, 0.025 + R() * 0.035, R() < 0.3 ? 0.5 : 0);
      }
    }
  }
  // 瀑布落点:崖脚一小圈发红的岩壳(溅落池)
  const splash = [[-5.38, FORGE.z - 0.22], [-5.45, FORGE.z - 0.38], [-5.15, FORGE.z - 0.3],
    [4.95, -7.32], [5.05, -7.4], [5.48, -7.34], [5.52, -7.18]];
  for (const [x, z] of splash) col(x, z, 0.055 + R() * 0.02, 0.025 + R() * 0.02, 0.8);
  // 长边石台外沿石柱群:簇状、留空当,高度随石台走(石台在近端前降级,柱子也跟着矮);锻炉那段让开
  for (const sx of [-1, 1]) for (let z = -6.9; z <= BENCH_END - 0.3; z += 0.55 + R() * 0.5) {
    if (R() < 0.25) continue;   // 留几处空当,不排成栅栏
    if (sx < 0 && Math.abs(z - FORGE.z) < 1.15) continue;
    const n = 1 + Math.floor(R() * 3), cx = sx * (X - 0.2), cz = z + (R() - 0.5) * 0.25;
    for (let i = 0; i < n; i++) col(cx + (R() - 0.5) * 0.12, cz + (R() - 0.5) * 0.28, 0.065 + R() * 0.035, 0.12 + R() * 0.32, R() < 0.15 ? 0.6 : 0);
  }
  // 近端(+Z,靠镜头)矮台:低矮岩板 + 偶尔一根矮柱;离地总高(矮台 + 柱)≤ NEAR_END_MAX_H
  for (let x = -5.6; x <= 5.6; x += 0.5) {
    const cz = H + 1.0 + R() * 0.55, n = 1 + Math.floor(R() * 2), tall = R() < 0.3;
    const cap = NEAR_END_MAX_H - TIER.apron;
    for (let i = 0; i < n; i++) {
      const px = x + (R() - 0.5) * 0.3, pz = cz + (R() - 0.5) * 0.3, h = cap * (tall ? 0.45 + R() * 0.4 : 0.06 + R() * 0.1), heat = R() < 0.2 ? 0.6 : 0;
      if (Math.abs(Math.abs(px) - RIVER_X) > 0.28) col(px, pz, 0.07 + R() * 0.04, h, heat);   // 让开熔岩河的末段
    }
  }
  // 远端锻炉台后沿:几簇高低错落的石柱群(簇间留大空当,不排成栅栏;右角让给火山锥),当舞台背板
  for (let x = -5.7; x <= 4.2; x += 0.9 + R() * 0.7) {
    if (R() < 0.3) continue;
    const n = 2 + Math.floor(R() * 3), cz = -(F.z - 0.4) + R() * 0.08, peak = 0.22 + R() * 0.32;
    for (let i = 0; i < n; i++) col(x + (R() - 0.5) * 0.36, cz + (R() - 0.5) * 0.22, 0.075 + R() * 0.04, peak * (0.45 + 0.55 * R()), R() < 0.2 ? 0.7 : 0);
  }
  // 矿车轨道:长边石台中段
  const railX = (BENCH_X + X) / 2 - 0.06;
  for (const sx of [-1, 1]) rails.push({ x: sx * railX, z1: -2.3, z2: 2.3, y: TIER.bench });
  // Tripo 配景(按 footprint 入库):铁砧 / 火盆 / 矿车在石台和锻炉台上;远端右角一座小火山锥
  const put = (name, x, z, rot, k = 1) => props.push({ name, x, z, rot, k });
  put('minecart', railX, -1.1, Math.PI / 2); put('minecart', railX, 1.3, Math.PI / 2); put('minecart', -railX, 0.3, Math.PI / 2);
  put('anvil', -railX, -4.15, 0.3); put('anvil', 2.6, -7.75, -0.2); put('anvil', railX, -3.7, 1.2); put('anvil', -railX, 3.5, 2.0);
  put('brazier', 1.25, -7.68, 0, 0.75); put('brazier', -1.25, -7.68, 0, 0.75);
  for (const [x, z] of [[railX, -5.4], [railX, -2.8], [-railX, -3.2], [railX, 3.2], [-railX, 2.8]]) put('brazier', x, z, R() * Math.PI, 0.7);
  put('brazier', 3.2, H + 1.0, 0, 0.6); put('brazier', -3.2, H + 1.0, 0, 0.6);
  put('cone', 5.45, -8.1, 0.6, 0.42);
}

// 全部布局:{ columns, props, rails, rivers, forge, terraces }
export function volcanoLayout(map) {
  const R = rng('volcano-kit'), columns = [], props = [], rails = [];
  for (const w of map.walls) wallColumns(w, R, columns);
  for (const o of map.obstacles) rockColumns(o, R, columns);
  for (const rf of map.rifts) crustColumns(rf, R, columns);
  edgeLayout(map, R, columns, props, rails);
  return { columns: dedupe(columns), props, rails, rivers: riverPaths(), riverWidth: RIVER_W, forge: FORGE, terraces: terraceBlocks(map) };
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

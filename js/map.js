// 地图配置 — 「星核战场」
//   · 三条路 + 转线缺口:每侧两段低岩脊把战场分成左 / 中 / 右三路,中线附近(星核两侧)留出转线缺口,
//     三路在双方基地前汇合;地面单位按网格 A* 寻路(js/nav.js),飞行单位越过岩脊,远程单位可以隔岩脊射击
//   · 塔位:每方 1 座前哨塔(守中路)+ 2 座侧翼塔(守三路汇合口)+ 核心
//   · 中央星核节点(在中路):独占可占领,占领方法力恢复加成
//   · 裂隙地带:两侧边路中段减速地面单位,偷塔有代价
// 所有坐标以玩家(p,z>0 一侧)为准,敌方关于 z=0 镜像

export const ROCK_CLEARANCE = 0.10;

export const MAP = {
  W: 4.8,               // 半宽
  HALF: 6.8,            // 半长
  DEPLOY_LINE: 0.8,     // 单位/建筑只能部署在离中线 0.8 以外的己方半场

  // 防御塔(都对空)
  towers: [
    { kind: 'outpost', name: '前哨塔', x: 0,    z: 3.4, hp: 400, atk: 28, range: 2.8, interval: 1.0, radius: 0.5 },
    { kind: 'pylon',   name: '侧翼塔', x: -3.3, z: 4.9, hp: 480, atk: 22, range: 2.6, interval: 1.0, radius: 0.45 },
    { kind: 'pylon',   name: '侧翼塔', x: 3.3,  z: 4.9, hp: 480, atk: 22, range: 2.6, interval: 1.0, radius: 0.45 },
  ],
  base: { kind: 'base', name: '核心', x: 0, z: 6.0, atk: 26, range: 2.5, interval: 1.1, radius: 0.75 },

  // 分路岩脊:蜿蜒的折线 + 半径(胶囊体),阻挡地面单位与部署,不阻挡飞行单位和弹道。
  // 每侧两段,中线附近留出转线缺口(|z| < 1.15);右侧是左侧绕中心旋转 180°(双方对称)
  walls: [
    { pts: [[-1.85, -3.95], [-2.25, -3.0], [-1.95, -2.05], [-2.2, -1.15]], r: 0.285 },
    { pts: [[-2.2, 1.15], [-1.95, 2.1], [-2.3, 3.0], [-1.85, 3.95]], r: 0.285 },
    { pts: [[1.85, -3.95], [2.3, -3.0], [1.95, -2.1], [2.2, -1.15]], r: 0.285 },
    { pts: [[2.2, 1.15], [1.95, 2.05], [2.25, 3.0], [1.85, 3.95]], r: 0.285 },
  ],
  // 中路的小岩石(圆形障碍):星核前后各两块,关于中心对称
  obstacles: [
    { x: 1.12, z: 2.1, r: 0.30 }, { x: -1.12, z: -2.1, r: 0.30 },
    { x: -1.12, z: 2.1, r: 0.30 }, { x: 1.12, z: -2.1, r: 0.30 },
  ],


  // 裂隙(地面单位移速 ×slow)
  rifts: [
    { x: -3.72, z: 0, r: 1.08, slow: 0.5 },
    { x: 3.72, z: 0, r: 1.08, slow: 0.5 },
  ],

  // 星核节点:半径内只有一方单位时推进占领进度,captureTime 秒占满;占领方法力恢复 ×(1+bonus)
  node: { x: 0, z: 0, r: 1.2, captureTime: 4, bonus: 0.35 },
};

// 冰封裂谷的斜向转线口位于两侧不同深度，整张地图绕星核旋转 180° 对称。
const glacierRidges = [
  { pts: [[-2.4, 3.9], [-2.65, 3.05], [-2.85, 2.0], [-2.85, 0.85]], r: 0.30 },
  { pts: [[1.95, 4.05], [1.75, 3.2], [1.45, 2.65]], r: 0.30 },   // 去掉末段(原到 1.30, 2.0):和岩石之间的通道拓宽,虫群大批小单位不再堵成一团吃溅射
];
const glacierRocks = [
  { x: -1.02, z: 2.5, r: 0.30 }, { x: 0.9, z: 1.30, r: 0.25 },
];
const glacierRift = { x: 3.65, z: 0.75, r: 1.0, slow: 0.5 };
const mirrorPoint = point => ({ ...point, x: -point.x, z: -point.z });
const GLACIER = {
  ...MAP,
  walls: [...glacierRidges, ...glacierRidges.map(wall => ({
    ...wall, pts: wall.pts.map(([x, z]) => [-x, -z]),
  }))],
  obstacles: [...glacierRocks, ...glacierRocks.map(mirrorPoint)],
  rifts: [mirrorPoint(glacierRift), glacierRift],
};
export const mapForScene = id => id === 'glacier' ? GLACIER : MAP;

// ── 墙的几何工具(引擎、AI、渲染、Blender 共用)──
// 每道墙是一条折线;把它拆成线段处理
export const wallSegments = w => w.pts.slice(1).map((p, i) => ({ x1: w.pts[i][0], z1: w.pts[i][1], x2: p[0], z2: p[1] }));
const segmentsByMap = new WeakMap();
function mapSegments(map) {
  if (!segmentsByMap.has(map)) {
    segmentsByMap.set(map, map.walls.flatMap(w => wallSegments(w).map(s => ({ ...s, r: w.r }))));
  }
  return segmentsByMap.get(map);
}

// 点到线段的最近点
function closest(px, pz, w) {
  const vx = w.x2 - w.x1, vz = w.z2 - w.z1;
  const t = Math.max(0, Math.min(1, ((px - w.x1) * vx + (pz - w.z1) * vz) / (vx * vx + vz * vz || 1)));
  return { x: w.x1 + vx * t, z: w.z1 + vz * t };
}

// 点到最近一道墙表面的距离(在墙里为负)
export function wallGap(x, z, map = MAP) {
  let best = Infinity;
  for (const w of mapSegments(map)) {
    const c = closest(x, z, w);
    best = Math.min(best, Math.hypot(x - c.x, z - c.z) - w.r);
  }
  return best;
}

// 把点推出墙外(至少离墙表面 pad);返回新坐标,没在墙里返回 null
export function pushOutOfWalls(x, z, pad, map = MAP) {
  let moved = null;
  for (let iter = 0; iter < 3; iter++) {   // 折线拐角处可能同时贴着两段,推几次
    let any = false;
    for (const w of mapSegments(map)) {
      const c = closest(x, z, w);
      const d = Math.hypot(x - c.x, z - c.z), min = w.r + pad;
      if (d < min) {
        if (d < 1e-6) x = c.x + (x < c.x ? -min : min);
        else { x = c.x + (x - c.x) / d * min; z = c.z + (z - c.z) / d * min; }
        any = true; moved = { x, z };
      }
    }
    if (!any) break;
  }
  return moved;
}

// 两条线段是否相交(严格相交)
function segCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// 墙两端沿首尾线段方向加长 e(避免贴着墙角穿过去)
function extendedEnds(w, e) {
  const p = w.pts, n = p.length;
  const ext = (a, b) => { const l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; return [a[0] + (a[0] - b[0]) / l * e, a[1] + (a[1] - b[1]) / l * e]; };
  return [ext(p[0], p[1]), ext(p[n - 1], p[n - 2])];
}

// 从 A 到 B 的直线会不会被某道墙挡住(返回挡路的墙,或 null)
export function blockingWall(ax, az, bx, bz, pad = 0, map = MAP) {
  for (const w of map.walls) {
    const [e0, e1] = extendedEnds(w, w.r + pad);
    const pts = [e0, ...w.pts, e1];
    for (let i = 1; i < pts.length; i++) {
      if (segCross(ax, az, bx, bz, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])) return w;
    }
  }
  return null;
}

// 绕墙:被墙挡住时,先走到离路程更短的那个墙端外侧。返回 { x, z, len(绕行总路程) },不挡路返回 null
export function detour(ax, az, bx, bz, pad, map = MAP) {
  const w = blockingWall(ax, az, bx, bz, pad, map);
  if (!w) return null;
  let best = null;
  for (const [px, pz] of extendedEnds(w, w.r + pad + 0.25)) {
    const l = Math.hypot(px - ax, pz - az) + Math.hypot(bx - px, bz - pz);
    if (!best || l < best.len) best = { x: px, z: pz, len: l };
  }
  return best;
}

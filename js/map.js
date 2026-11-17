// 地图配置 — 「星核战场」
//   · 三条路 + 转线缺口:每侧两段低岩脊把战场分成左 / 中 / 右三路,中线附近(星核两侧)留出转线缺口,
//     三路在双方基地前汇合;地面单位按网格 A* 寻路(js/nav.js),飞行单位越过岩脊,远程单位可以隔岩脊射击
//   · 塔位:每方 2 座前哨炮(中路左右两侧交叉火力,中路正中留通道)+ 2 座侧翼塔(守三路汇合口)+ 核心
//   · 中央星核节点(在中路):独占可占领,占领方法力恢复加成
//   · 裂隙地带:两侧边路中段减速地面单位,偷塔有代价
// 所有坐标以玩家(p,z>0 一侧)为准,敌方关于 z=0 镜像

export const ROCK_CLEARANCE = 0.10;

// 场地纵向拉长(2026-11-16):基地后面到黄线内框原来空着约 1.9 格,战场半长 6.8 → 7.6 吃掉其中 0.8。
//   棋盘底座 / 外框(arena-dims.js)不变,XR 棋盘尺寸、桌面取景都不用改;岩脊 / 岩石 / 裂隙按 z × (7.6 / 6.8) 等比平移
//   (形状、半径不变);地形 GLB 用 stretchFieldZ 同样拉伸(战场内等比,战场外到黄线那圈压缩),高度图同步重采样
export const FIELD_STRETCH = { from: 6.8, to: 7.6, outer: 8.99 };   // outer:黄线内框外 0.3,再往外不动
export function stretchFieldZ(z) {
  const { from, to, outer } = FIELD_STRETCH, a = Math.abs(z), s = Math.sign(z);
  if (a <= from) return z * to / from;
  if (a >= outer) return z;
  return s * (to + (a - from) * (outer - to) / (outer - from));
}
export function unstretchFieldZ(z) {
  const { from, to, outer } = FIELD_STRETCH, a = Math.abs(z), s = Math.sign(z);
  if (a <= to) return z * from / to;
  if (a >= outer) return z;
  return s * (from + (a - to) * (outer - from) / (outer - to));
}
const K = FIELD_STRETCH.to / FIELD_STRETCH.from;
const stretchLayout = m => {
  for (const w of m.walls) w.pts = w.pts.map(([x, z]) => [x, z * K]);
  for (const o of [...m.obstacles, ...m.rifts]) o.z *= K;
  return m;
};

export const MAP = {
  W: 4.8,               // 半宽
  HALF: 7.6,            // 半长(原 6.8,见 FIELD_STRETCH)
  // 单位/建筑只能部署在离中线 DEPLOY_LINE 以外的己方半场。2026-11-16 两次调整:
  //   ① 0.8 → 2.0:部署区纵深 6.0 → 4.8(−20%),占半场 88% → 71%
  //   ② 场地拉长后 2.0 → 2.4(= 2.0 × 7.6/6.8 ≈ 2.24,取整到 2.4):纵深 5.2,占半场 68%,仍比最初的 6.0 / 88% 小;
  //      起点落在拉长后的转线缺口(|z| < 1.29,加岩脊半径 + 单位半径 ≈ 1.8)之后,中路岩石(z = 2.35)压在线上
  DEPLOY_LINE: 2.4,

  // 防御塔(都对空)。场地拉长后整体后移,要求:塔 / 核心的射程够不到星核占领圈里的地面单位
  //   (塔心到圈心距离 − 圈半径 1.2 > 射程 + 塔半径 + 单位半径 0.22;见 tests/longfield.test.mjs)
  //   前哨塔 3.4 → 5.0(余量 0.28;原来能打到圈心外 0.1 处)、侧翼塔 4.9 → 5.7、核心 6.0 → 6.4
  //   核心曾放到 6.8,模型后半截(占地上限 = 半径 × 2.8,实测最宽的混沌核心后沿到 7.75)伸出地板 7.6、压到台沿;
  //   6.4 时按占地上限算后沿 ≤ 7.45,离地板后缘留 0.15;射程到占领圈仍有 1.73 余量(tests/longfield.test.mjs)
  towers: [
    // 前哨炮 × 2(2026-11-16,原中路正中一座前哨塔 z 5.0 / 400 血 / 28 攻 / 半径 0.5):中路左右两侧各一座小炮,
    //   每座血 230(57.5%)、每发 16(57%)、射速 1.2 秒一发(原 1.0):单座每秒 13.3,两座合计 26.7 < 原来 28,总火力略低;
    //   射程不变 2.8,半径 0.38(比侧翼塔小一档)。
    //   x = ±1.1:中间留出 1.44 宽的通道,外侧离岩脊末端 ≥ 0.1;z = 4.7:射程边缘到占领圈余量 0.23
    { kind: 'outpost', name: '前哨炮', x: -1.1, z: 4.7, hp: 230, atk: 16, range: 2.8, interval: 1.2, radius: 0.38 },
    { kind: 'outpost', name: '前哨炮', x: 1.1,  z: 4.7, hp: 230, atk: 16, range: 2.8, interval: 1.2, radius: 0.38 },
    { kind: 'pylon',   name: '侧翼塔', x: -3.3, z: 5.7, hp: 480, atk: 22, range: 2.6, interval: 1.0, radius: 0.45 },
    { kind: 'pylon',   name: '侧翼塔', x: 3.3,  z: 5.7, hp: 480, atk: 22, range: 2.6, interval: 1.0, radius: 0.45 },
  ],
  base: { kind: 'base', name: '核心', x: 0, z: 6.4, atk: 26, range: 2.5, interval: 1.1, radius: 0.75 },

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
stretchLayout(MAP);   // 上面岩脊 / 岩石 / 裂隙的坐标按原 6.8 半长设计,这里等比拉到 7.6

// 冰封裂谷的斜向转线口位于两侧不同深度，整张地图绕星核旋转 180° 对称。
const glacierRidges = [
  { pts: [[-2.4, 3.9], [-2.65, 3.05], [-2.85, 2.0], [-2.85, 0.85]], r: 0.30 },
  { pts: [[1.95, 4.05], [1.75, 3.2], [1.45, 2.65]], r: 0.30 },   // 去掉末段(原到 1.30, 2.0):和岩石之间的通道拓宽,虫群大批小单位不再堵成一团吃溅射
];
const glacierRocks = [
  { x: -1.02, z: 2.5, r: 0.30 }, { x: 0.9, z: 1.30, r: 0.25 },
];
const mirrorPoint = point => ({ ...point, x: -point.x, z: -point.z });
const GLACIER = stretchLayout({
  ...MAP,
  walls: [...glacierRidges, ...glacierRidges.map(wall => ({
    ...wall, pts: wall.pts.map(([x, z]) => [-x, -z]),
  }))],
  obstacles: [...glacierRocks, ...glacierRocks.map(mirrorPoint)],
  rifts: [],   // 原来两侧各一个圆形冰缝(半径 1.0,地面 ×0.5);2026-11-16 换成下面斜插的冰路
});
// 冰封裂谷 · 冰川裂隙(2026-11-17,替换第五轮两条等宽平滑冰路):像真实冰川裂隙那样的裂缝网——
//   锯齿边、宽窄不一、两头收尖、主缝断成三截(边路 / 中路 / 边路)、主缝上岔出细支缝。整体仍斜插过三条进攻路线,
//   一方 6 条(3 主 + 3 支),和另一方的 6 条互为绕星核旋转 180° 的镜像(p / e 公平),在两侧边路交错成网。
//   · 「露出的部分」= 裂隙在地面上露出的冰面:每条裂隙是一个多边形(左沿 + 右沿),判定(onIce)和渲染用同一份顶点
//   · 地面单位在冰面上移速 ×0.5,飞行不受影响;总面积约 13(第五轮冰路 13.3,±20% 内)
//   · 冰面不进部署区(|z| + 单位半径 < 部署线)、不压祭坛占领圈(冰面顶点离圈 ≥ 0.15)
//   · 冰面只是代价、不参与寻路(和熔岩一样):nav 不读它,单位转向 / AI 出兵也不看它——单位照常走,不会刻意找冰少的路
// 脊线控制点 [x, z, 左半宽, 右半宽](左 = 沿脊线前进方向的左手边);半宽 0 = 尖头
const CREVASSE_STEP = 0.16;   // 沿脊线每 0.16 格一个截面,每个截面左右沿各自抖动 → 锯齿边
const CREVASSE_WIDEN = 1.4;   // 控制点半宽的统一放大(调总面积用)
const crevasseSpines = [
  // 西路主缝:从左边线斜下到左侧岩脊末端
  [[-4.78, 1.9, 0, 0], [-4.35, 1.6, 0.24, 0.3], [-3.85, 1.3, 0.4, 0.32], [-3.3, 0.95, 0.32, 0.46], [-2.85, 0.55, 0.36, 0.28], [-2.5, 0.15, 0.22, 0.26], [-2.2, -0.2, 0, 0]],
  // 西路支缝:从主缝向南岔出
  [[-3.78, 1.22, 0.08, 0.08], [-3.95, 0.75, 0.17, 0.14], [-4.1, 0.35, 0.1, 0.12], [-4.22, 0.0, 0, 0]],
  // 中路主缝:绕过祭坛南侧
  [[-1.85, -0.98, 0, 0], [-1.5, -1.32, 0.15, 0.18], [-1.05, -1.6, 0.26, 0.24], [-0.45, -1.74, 0.2, 0.2], [0.15, -1.76, 0.2, 0.2], [0.75, -1.7, 0.22, 0.2], [1.3, -1.5, 0.22, 0.2], [1.75, -1.12, 0.13, 0.15], [2.0, -0.82, 0, 0]],
  // 中路支缝:朝祭坛方向的一小截
  [[0.45, -1.62, 0.08, 0.08], [0.72, -1.4, 0.11, 0.1], [0.95, -1.15, 0, 0]],
  // 东路主缝
  [[2.3, -0.65, 0, 0], [2.7, -0.3, 0.18, 0.16], [3.2, 0.05, 0.36, 0.32], [3.75, 0.25, 0.32, 0.44], [4.25, 0.2, 0.38, 0.28], [4.78, 0.32, 0, 0]],
  // 东路支缝:向南岔出
  [[3.22, 0.0, 0.1, 0.1], [3.1, -0.45, 0.15, 0.13], [2.96, -0.95, 0, 0]],
];
// 确定性哈希(整数运算,浏览器 / Node 结果一致)→ [0, 1)
function hash01(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ h >>> 15, 0x2c1b3c6d); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
// 一条裂隙:脊线按 CREVASSE_STEP 细分,每个截面沿法线向左右各推出(插值半宽 × 抖动 0.6–1.3)。
//   返回 { left, right }(同长的两条边),多边形 = left + 反向 right
function crevasse(ctrl, seed) {
  const S = [];
  for (let i = 1; i < ctrl.length; i++) {
    const a = ctrl[i - 1], b = ctrl[i], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / CREVASSE_STEP));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) S.push(a.map((v, j) => v + (b[j] - v) * k / n));
  }
  const left = [], right = [];
  S.forEach(([x, z, hl, hr], i) => {
    const p = S[Math.max(0, i - 1)], q = S[Math.min(S.length - 1, i + 1)];
    const tl = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, nx = -(q[1] - p[1]) / tl, nz = (q[0] - p[0]) / tl;
    const jl = CREVASSE_WIDEN * (0.6 + 0.7 * hash01(seed, i * 2)), jr = CREVASSE_WIDEN * (0.6 + 0.7 * hash01(seed, i * 2 + 1));
    left.push([x + nx * hl * jl, z + nz * hl * jl]);
    right.push([x - nx * hr * jr, z - nz * hr * jr]);
  });
  return { left, right };
}
const crevassesA = crevasseSpines.map((c, i) => crevasse(c, i + 1));
const rot180 = pts => pts.map(([x, z]) => [-x, -z]);
GLACIER.ice = {
  slow: 0.5,
  cracks: [...crevassesA, ...crevassesA.map(c => ({ left: rot180(c.left), right: rot180(c.right) }))].map(c => {
    const poly = [...c.left, ...[...c.right].reverse()].filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-6);   // 尖头左右沿重合,去掉重复点
    if (Math.hypot(poly[0][0] - poly.at(-1)[0], poly[0][1] - poly.at(-1)[1]) <= 1e-6) poly.pop();
    const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
    return { ...c, poly, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
  }),
};
// 熔岩锻炉(第三轮):两侧的圆形熔岩池(裂隙,地面减速 50%)换成一条横贯战场的熔岩河。
//   · 河道中心线 z = amp · sin(π x / W):左右两端在边线中点落进来,绕星核旋转 180° 对称(奇函数)
//   · 地面单位(非建筑)站在河里 → 烧灼:每 0.5 秒结算一次 dps × 0.5;离开后余烬再烧 ember 秒。飞行单位不受影响
//   · 不烧灼的地方:只有星核祭坛(半径 = 占领圈 node.r,熔岩从祭坛下面流过)。
//     第三轮曾有两座冷却岩桥(x = ±3.55),按用户反馈去掉:边路过河必须蹚熔岩;bridges 字段保留为空,渲染 / 寻路仍支持
//   · 河道最宽处 |z| ≤ amp + half = 0.67 < 部署线:河在双方部署区之外,不影响部署
const VOLCANO = {
  ...MAP,
  rifts: [],
  lava: {
    amp: 0.25, half: 0.42,
    dps: 8, tick: 0.5, ember: 1.0,
    bridges: [],
  },
};
// 星核荒原 · 陨星坠落(2026-11-16,逻辑在 meteor.js):
//   · 第 40 秒起每 40 秒一次,一对中心对称的落点先亮预警圈 3 秒,再砸下:半径 0.9 内双方地面 + 飞行单位各 120 伤害,建筑免疫
//     120:一发清掉一团步兵级单位(步兵 115 / 幼虫 38),坦克(360)掉三分之一;3 秒预警足够走出 0.9 的圈(最慢单位约 0.25 格/秒
//     要 3.6 秒才能从圈心走出,所以慢速重装躲不掉,是有意的代价)
//   · 星石 15 秒,任一方单位碰到(0.4 内)+1 法力
//   · 落点:|z| ≤ 部署线 − 0.4、离祭坛圈 ≥ 0.5、离岩脊 / 岩石 ≥ 0.35
//   · 2026-11-17(第六轮):砸中的单位额外瘫痪 stun 1.5 秒(免控单位免疫);落点留下陨坑 craterLife 8 秒,
//     半径 craterR 1.1 内的地面单位每秒被拉向坑心「自身步速 × pull 30%」格(按百分比,再慢的单位也走得出去;飞行单位也吃眩晕)
//   · 两侧圆形裂隙去掉(rifts 置空;MAP 本体给未开放地图共用,不动)
const STARCORE = {
  ...MAP,
  rifts: [],
  meteor: { first: 40, interval: 40, warn: 3, radius: 0.9, damage: 120, shardLife: 15, pickR: 0.4, mana: 1,
    stun: 1.5, craterLife: 8, craterR: 1.1, pull: 0.3,
    clearDeploy: 0.4, clearNode: 0.5, clearWall: 0.35 },
};
export const mapForScene = id => id === 'glacier' ? GLACIER : id === 'volcano' ? VOLCANO : id === 'starcore' ? STARCORE : MAP;

// 熔岩河中心线的 z
export const lavaCenterZ = (lava, W, x) => lava.amp * Math.sin(Math.PI * x / W);
// 点在不在多边形里(射线法)
export function inPolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// 冰封裂谷:这一点在不在露出的冰面上(地面单位的中心)
export function onIce(map, x, z) {
  const I = map.ice;
  if (!I || Math.abs(x) > map.W) return false;
  if (Math.hypot(x - map.node.x, z - map.node.z) < map.node.r) return false;
  return I.cracks.some(c => x >= c.box[0] && z >= c.box[1] && x <= c.box[2] && z <= c.box[3] && inPolygon(c.poly, x, z));
}

// 这一点会不会被烧灼(地面单位的中心落在河道里、又不在祭坛 / 岩桥上)
export function inLava(map, x, z) {
  const L = map.lava;
  if (!L || Math.abs(x) > map.W) return false;
  if (Math.abs(z - lavaCenterZ(L, map.W, x)) >= L.half) return false;
  if (Math.hypot(x - map.node.x, z - map.node.z) < map.node.r) return false;
  return !L.bridges.some(b => Math.abs(x - b.x) < b.half);
}

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

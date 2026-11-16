// obstacle-layout.js 单测:熔岩锻炉障碍套件的外观必须贴合碰撞形状、交战区不放装饰
//   · 外沿:每根墙柱 / 熔渣柱的六边形顶点(含倾斜位移)离碰撞折线 / 圆心的距离 ≤ 胶囊半径 + ENVELOPE_TOL
//   · 内沿:胶囊内缩 ENVELOPE_TOL 的边界上每隔 0.01 取点,都要落在某根柱子的六边形里(墙看起来不比碰撞窄)
//   · 高度:墙 / 熔渣柱露出地面 ≤ WALL_MAX_H;近端(+Z)边缘装饰 ≤ NEAR_END_MAX_H
//   · 交战区:L1 边缘装饰、Tripo 配景、轨道、熔岩河全部在战场矩形外,并且在黄线内框里
//   · 切割柱(第三轮):台地外缘 / 台沿内缘是一条直线、没有缺口、不越过黄线;河岸贴着河道边、祭坛台盖住占领圈
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapForScene, wallSegments, lavaCenterZ } from '../js/map.js';
import { ARENA } from '../js/arena-dims.js';
import { volcanoLayout, hexVertices, insideHex, leanOf, ENVELOPE_TOL, WALL_MAX_H, NEAR_END_MAX_H,
  fieldHeight, terraceTop, FLOOR, TIER, inConvex, PLAT_R, PLAT_TOP, LAVA_SURFACE } from '../js/obstacle-layout.js';

const MAP = mapForScene('volcano');   // 熔岩锻炉自己的布局(第三轮起没有裂隙、多了 lava)
const L = volcanoLayout(MAP);
const walls = L.columns.filter(c => c.layer === 'wall');
const rocks = L.columns.filter(c => c.layer === 'rock');

function distToSeg(px, pz, s) {
  const vx = s.x2 - s.x1, vz = s.z2 - s.z1;
  const t = Math.max(0, Math.min(1, ((px - s.x1) * vx + (pz - s.z1) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - s.x1 - vx * t, pz - s.z1 - vz * t);
}
const distToWall = (px, pz, w) => Math.min(...wallSegments(w).map(s => distToSeg(px, pz, s)));

// 胶囊内缩 d 后的边界采样点:各段两侧的平移线 + 各顶点的整圆,只留"到折线距离恰好 = d"的点
function insetBoundary(w, d) {
  const pts = [];
  for (const s of wallSegments(w)) {
    const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1), nx = -(s.z2 - s.z1) / len, nz = (s.x2 - s.x1) / len;
    for (let t = 0; t <= len; t += 0.01) for (const sd of [-1, 1]) {
      pts.push([s.x1 + (s.x2 - s.x1) * t / len + nx * d * sd, s.z1 + (s.z2 - s.z1) * t / len + nz * d * sd]);
    }
  }
  for (const [vx, vz] of w.pts) for (let a = 0; a < Math.PI * 2; a += 0.01 / d) pts.push([vx + Math.cos(a) * d, vz + Math.sin(a) * d]);
  return pts.filter(([x, z]) => distToWall(x, z, w) >= d - 1e-6);
}

test('墙柱外沿不超出碰撞胶囊 + 0.08', () => {
  let worst = 0;
  for (const c of walls) {
    const w = MAP.walls.reduce((best, w) => (distToWall(c.x, c.z, w) < distToWall(c.x, c.z, best) ? w : best));
    for (const [x, z] of hexVertices(c, leanOf(c))) worst = Math.max(worst, distToWall(x, z, w) - w.r);
  }
  assert.ok(worst <= ENVELOPE_TOL, `最大外凸 ${worst.toFixed(3)}`);
});

test('墙柱内沿覆盖到碰撞胶囊 − 0.08(墙不比碰撞窄)', () => {
  for (const w of MAP.walls) {
    const miss = insetBoundary(w, w.r - ENVELOPE_TOL).filter(([x, z]) => !walls.some(c => insideHex(c, x, z)));
    assert.equal(miss.length, 0, `未覆盖 ${miss.length} 点,如 ${JSON.stringify(miss.slice(0, 3).map(p => p.map(v => +v.toFixed(3))))}`);
  }
});

test('熔渣堆贴合圆形岩石障碍(±0.08)', () => {
  for (const o of MAP.obstacles) {
    const mine = rocks.filter(c => Math.hypot(c.x - o.x, c.z - o.z) < o.r);
    assert.ok(mine.length >= 9);
    for (const c of mine) for (const [x, z] of hexVertices(c, leanOf(c))) {
      assert.ok(Math.hypot(x - o.x, z - o.z) <= o.r + ENVELOPE_TOL + 1e-9, '熔渣柱超出');
    }
    const d = o.r - ENVELOPE_TOL;
    for (let a = 0; a < Math.PI * 2; a += 0.01) {
      const x = o.x + Math.cos(a) * d, z = o.z + Math.sin(a) * d;
      assert.ok(mine.some(c => insideHex(c, x, z)), `熔渣堆内沿缺口 @${a.toFixed(2)}`);
    }
  }
});

test('墙 / 熔渣柱高度 ≤ 0.5,近端装饰 ≤ 0.6', () => {
  for (const c of [...walls, ...rocks]) assert.ok(c.h <= WALL_MAX_H, `柱高 ${c.h}`);
  for (const c of L.cutColumns.filter(c => c.kind === 'apron')) {
    assert.ok(c.top <= NEAR_END_MAX_H + 1e-9, `近端矮台柱离地 ${c.top}`);
  }
});

test('交战区零装饰:边缘装饰全在战场外、黄线内框里', () => {
  const F = ARENA.frame, out = (x, z, pad) => Math.abs(x) > MAP.W + pad || Math.abs(z) > MAP.HALF + pad;
  const inFrame = (x, z, r) => Math.abs(x) + r <= F.x && Math.abs(z) + r <= F.z;
  assert.equal(L.columns.filter(c => c.layer === 'edge').length, 0, '边缘石柱群已并进切割柱台地');
  for (const p of L.props) assert.ok(out(p.x, p.z, 0.3), `配景进了战场 ${p.name}`);
  for (const r of L.rails) assert.ok(Math.abs(r.x) > MAP.W + 0.3);
  for (const path of L.rivers) for (const [x, z] of path) {
    assert.ok(out(x, z, 0.3 + L.riverWidth / 2), `熔岩河进了战场 ${x},${z}`);
    assert.ok(inFrame(x, z, L.riverWidth / 2 - 1e-9) || Math.abs(z) > F.z - 0.5, '熔岩河越过黄线');
  }
});

test('布局是确定的(双方一致)', () => {
  assert.deepEqual(volcanoLayout(MAP), L);
});

// ── 第二轮:两侧地形(玩法区压平 + 台地)──
test('玩法区平整:祭坛台和熔岩河道以外全是 FLOOR;岩桥上不挖河道', () => {
  const N = MAP.node, Lv = MAP.lava;
  let flat = 0;
  for (let x = -MAP.W; x <= MAP.W + 1e-9; x += 0.05) for (let z = -MAP.HALF; z <= MAP.HALF + 1e-9; z += 0.05) {
    const y = fieldHeight(MAP, x, z), dN = Math.hypot(x - N.x, z - N.z), dz = Math.abs(z - lavaCenterZ(Lv, MAP.W, x));
    assert.ok(y >= FLOOR - 0.12 && y <= PLAT_TOP + 1e-9, `高度越界 ${y}`);
    if (dN < PLAT_R) assert.equal(y, PLAT_TOP);
    else if (Lv.bridges.some(b => Math.abs(x - b.x) < b.half)) assert.equal(y, FLOOR, '岩桥与地面齐平');
    else if (dz > Lv.half + 0.03) { assert.equal(y, FLOOR, `(${x.toFixed(2)},${z.toFixed(2)}) 不平`); flat++; }
    else if (dz < Lv.half - 0.03) assert.ok(y < LAVA_SURFACE, '河道底低于熔岩面(单位蹚在熔岩里)');
  }
  assert.ok(flat > 20000);
});

test('台地:全在黄线内框里、高于玩法区,战场内不算台地', () => {
  const F = ARENA.frame;
  for (const b of L.terraces) {
    for (const [x, z] of b.polys.flat()) assert.ok(Math.abs(x) <= F.x && Math.abs(z) <= F.z, `${b.name} 越过黄线`);
    assert.ok(b.top > (b.name === 'bed' ? 0 : FLOOR) && b.top <= TIER.plateau, `${b.name} 高度 ${b.top}`);   // 河床可以比玩法区低
  }
  assert.equal(terraceTop(MAP, L.terraces, 0, 0), null);
  assert.equal(terraceTop(MAP, L.terraces, MAP.W - 0.01, MAP.HALF - 0.01), null);
  // 每一段战场边外侧都有台沿(没有缺口让地形 GLB 露出来)
  for (let t = -1; t <= 1; t += 0.01) {
    for (const [x, z] of [[MAP.W + 0.02, t * MAP.HALF], [-MAP.W - 0.02, t * MAP.HALF], [t * MAP.W, MAP.HALF + 0.02], [t * MAP.W, -MAP.HALF - 0.02]]) {
      assert.ok(terraceTop(MAP, L.terraces, x, z) >= TIER.apron, `台沿缺口 ${x.toFixed(2)},${z.toFixed(2)}`);
    }
  }
});

test('熔岩河贴着台面流,只在瀑布段离开台面', () => {
  for (const path of L.rivers) {
    let falls = 0;
    path.forEach(([x, z, y], i) => {
      const top = terraceTop(MAP, L.terraces, x, z);
      if (Math.abs(y - top) < 0.02) return;
      // 不贴台面的点必须夹在两个高度不同的点之间(瀑布中段)
      const prev = path[i - 1], next = path[i + 1];
      assert.ok(prev && next && prev[2] > y && y > next[2], `熔岩河悬空 ${x},${z},${y}(台面 ${top})`);
      falls++;
    });
    assert.ok(falls >= 2, '每条河至少一道瀑布(源头 + 近端)');
  }
});

// ── 第三轮:切割六棱柱 + 熔岩河 ──
const cut = L.cutColumns;
const covered = (list, x, z) => list.some(c => inConvex(c.poly, x, z, 1e-7));
test('切割柱:台地柱全在外框内、没有跑进战场;外缘和台沿内缘是直线且没有缺口', () => {
  const F = ARENA.frame, X = F.x - 0.05, Z = F.z - 0.05;
  const ter = cut.filter(c => !['bank', 'bridge', 'altar'].includes(c.kind));
  for (const c of ter) for (const [x, z] of c.poly) {
    assert.ok(Math.abs(x) <= X + 1e-6 && Math.abs(z) <= Z + 1e-6, `台地柱越过外缘 ${x},${z}`);
    assert.ok(Math.abs(x) >= MAP.W - 1e-6 || Math.abs(z) >= MAP.HALF - 1e-6, `台地柱跑进战场 ${x},${z}`);
  }
  // 外缘(内缩 0.01)每 0.02 取点:除了倒角,都要被某根柱子盖住 → 没有锯齿缺口
  const inChamfer = (x, z) => L.terraces.every(b => !b.polys.every(p => inConvex(p, x, z)));
  let n = 0;
  for (let s = -1; s <= 1; s += 0.002) {
    for (const [x, z] of [[X - 0.01, s * Z], [-X + 0.01, s * Z], [s * X, Z - 0.01], [s * X, -Z + 0.01]]) {
      if (inChamfer(x, z)) continue;
      assert.ok(covered(ter, x, z), `外缘缺口 ${x.toFixed(2)},${z.toFixed(2)}`); n++;
    }
    // 台沿内缘(战场边外 0.01)
    for (const [x, z] of [[MAP.W + 0.01, s * MAP.HALF], [-MAP.W - 0.01, s * MAP.HALF], [s * MAP.W, MAP.HALF + 0.01], [s * MAP.W, -MAP.HALF - 0.01]]) {
      assert.ok(covered(ter, x, z), `台沿内缘缺口 ${x.toFixed(2)},${z.toFixed(2)}`); n++;
    }
  }
  assert.ok(n > 6000);
  // 切面:每根被裁的柱子至少一条边落在边界上;外框线上的边都是切面
  const onRim = cut.filter(c => c.poly.some(([x]) => Math.abs(Math.abs(x) - X) < 1e-6));
  assert.ok(onRim.length > 50 && onRim.every(c => c.cut.some(Boolean)));
});

test('切割柱:河岸贴着河道边,祭坛台盖住整个占领圈,岩桥盖住桥面', () => {
  const Lv = MAP.lava, zc = x => lavaCenterZ(Lv, MAP.W, x);
  const banks = cut.filter(c => c.kind === 'bank'), altar = cut.filter(c => c.kind === 'altar'), bridges = cut.filter(c => c.kind === 'bridge');
  for (const c of banks) for (const [x, z] of c.poly) {
    const d = Math.abs(z - zc(x));
    assert.ok(d >= Lv.half - 0.004 && d <= Lv.half + 0.2 + 0.004, `岸柱离河道 ${d.toFixed(3)}`);   // 0.004:正弦按 0.3 一段折线逼近的弦高
  }
  // 河道边外 0.02 每 0.02 取点:岩桥 / 祭坛以外都有岸柱(没有缺口)
  for (let x = -MAP.W + 0.02; x <= MAP.W - 0.02; x += 0.02) {
    if (Lv.bridges.some(b => Math.abs(x - b.x) < b.half + 0.02) || Math.abs(x) < 1.1) continue;
    for (const s of [-1, 1]) assert.ok(covered(banks, x, zc(x) + s * (Lv.half + 0.02)), `河岸缺口 x=${x.toFixed(2)}`);
  }
  for (let a = 0; a < Math.PI * 2; a += 0.02) assert.ok(covered(altar, Math.cos(a) * MAP.node.r, Math.sin(a) * MAP.node.r), '祭坛台没盖住占领圈');
  for (const b of Lv.bridges) for (let dz = -Lv.half; dz <= Lv.half; dz += 0.05) assert.ok(covered(bridges, b.x, zc(b.x) + dz), '桥面缺口');
});

test('场内熔岩河:贴着熔岩面,在战场内,左右两股绕星核旋转 180° 对称', () => {
  assert.equal(L.fieldRivers.length, 2);
  const [a, b] = L.fieldRivers;
  a.forEach(([x, z, y, w], i) => {
    assert.deepEqual([b[i][0], b[i][1], b[i][2], b[i][3]].map(v => +v.toFixed(9)), [-x, -z, y, w].map(v => +v.toFixed(9)));
    if (Math.abs(x) < MAP.W - 0.05) assert.equal(y, LAVA_SURFACE);   // 边线上是落水口(瀑布),往里都贴熔岩面
  });
  assert.ok(a.at(-1)[0] > -PLAT_R && a.at(-1)[0] < 0, '一直流到祭坛台下面');
});

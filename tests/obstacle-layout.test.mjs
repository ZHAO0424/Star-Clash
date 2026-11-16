// obstacle-layout.js 单测:熔岩锻炉障碍套件的外观必须贴合碰撞形状、交战区不放装饰
//   · 外沿:每根墙柱 / 熔渣柱的六边形顶点(含倾斜位移)离碰撞折线 / 圆心的距离 ≤ 胶囊半径 + ENVELOPE_TOL
//   · 内沿:胶囊内缩 ENVELOPE_TOL 的边界上每隔 0.01 取点,都要落在某根柱子的六边形里(墙看起来不比碰撞窄)
//   · 高度:墙 / 熔渣柱露出地面 ≤ WALL_MAX_H;近端(+Z)边缘装饰 ≤ NEAR_END_MAX_H
//   · 交战区:L1 边缘装饰、Tripo 配景、轨道、熔岩河全部在战场矩形外,并且在黄线内框里
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP, wallSegments } from '../js/map.js';
import { ARENA } from '../js/arena-dims.js';
import { volcanoLayout, hexVertices, insideHex, leanOf, ENVELOPE_TOL, WALL_MAX_H, NEAR_END_MAX_H,
  fieldHeight, terraceTop, FLOOR, TIER } from '../js/obstacle-layout.js';

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
  for (const c of L.columns.filter(c => c.layer === 'edge' && c.z > MAP.HALF)) {
    assert.ok(c.h + terraceTop(MAP, L.terraces, c.x, c.z) <= NEAR_END_MAX_H + 1e-9, `近端装饰离地 ${c.h}`);   // 算上所在台面
  }
});

test('交战区零装饰:边缘装饰全在战场外、黄线内框里', () => {
  const F = ARENA.frame, out = (x, z, pad) => Math.abs(x) > MAP.W + pad || Math.abs(z) > MAP.HALF + pad;
  const inFrame = (x, z, r) => Math.abs(x) + r <= F.x && Math.abs(z) + r <= F.z;
  for (const c of L.columns.filter(c => c.layer === 'edge')) {
    assert.ok(out(c.x, c.z, 0.3), `装饰柱进了战场 ${c.x.toFixed(2)},${c.z.toFixed(2)}`);
    assert.ok(inFrame(c.x, c.z, c.R), '装饰柱越过黄线');
  }
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
test('玩法区平整:星核圆台和熔岩池浅盆以外全是 FLOOR', () => {
  const N = MAP.node;
  let flat = 0;
  for (let x = -MAP.W; x <= MAP.W + 1e-9; x += 0.05) for (let z = -MAP.HALF; z <= MAP.HALF + 1e-9; z += 0.05) {
    const y = fieldHeight(MAP, x, z);
    assert.ok(y >= FLOOR - 0.28 - 1e-9 && y <= FLOOR + 0.21 + 1e-9, `高度越界 ${y}`);
    const nearNode = Math.hypot(x - N.x, z - N.z) < N.r + 1.2, nearRift = MAP.rifts.some(r => Math.hypot(x - r.x, z - r.z) < r.r * 1.02);
    if (!nearNode && !nearRift) { assert.equal(y, FLOOR, `(${x.toFixed(2)},${z.toFixed(2)}) 不平`); flat++; }
  }
  assert.ok(flat > 20000);
});

test('台地:全在黄线内框里、高于玩法区,战场内不算台地', () => {
  const F = ARENA.frame;
  for (const b of L.terraces) {
    const [x1, z1, x2, z2] = b.rect;
    assert.ok(x1 >= -F.x && x2 <= F.x && z1 >= -F.z && z2 <= F.z, `${b.name} 越过黄线`);
    assert.ok(b.top > FLOOR && b.top <= TIER.plateau);
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

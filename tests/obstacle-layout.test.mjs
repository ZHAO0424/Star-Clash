// obstacle-layout.js 单测:熔岩锻炉障碍套件的外观必须贴合碰撞形状、交战区不放装饰
//   · 外沿:每根墙柱 / 熔渣柱的六边形顶点(含倾斜位移)离碰撞折线 / 圆心的距离 ≤ 胶囊半径 + ENVELOPE_TOL
//   · 内沿:胶囊内缩 ENVELOPE_TOL 的边界上每隔 0.01 取点,都要落在某根柱子的六边形里(墙看起来不比碰撞窄)
//   · 高度:墙 / 熔渣柱露出地面 ≤ WALL_MAX_H;近端(+Z)边缘装饰 ≤ NEAR_END_MAX_H
//   · 交战区:L1 边缘装饰、Tripo 配景、轨道、熔岩河全部在战场矩形外,并且在黄线内框里
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP, wallSegments } from '../js/map.js';
import { ARENA } from '../js/arena-dims.js';
import { volcanoLayout, hexVertices, insideHex, leanOf, ENVELOPE_TOL, WALL_MAX_H, NEAR_END_MAX_H } from '../js/obstacle-layout.js';

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
  for (const c of L.columns.filter(c => c.layer === 'edge' && c.z > MAP.HALF)) assert.ok(c.h <= NEAR_END_MAX_H);
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

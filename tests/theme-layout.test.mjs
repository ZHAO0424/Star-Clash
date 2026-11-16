// 星核荒原 / 冰封裂谷的程序化套件(熔岩样板推广):墙柱贴合碰撞、台地直线收边无缺口、交战区零装饰、玩法元素不变
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapForScene, wallSegments } from '../js/map.js';
import { ARENA } from '../js/arena-dims.js';
import { starcoreLayout, glacierLayout, hexVertices, insideHex, leanOf, inConvex, ENVELOPE_TOL, WALL_MAX_H, NEAR_END_MAX_H } from '../js/obstacle-layout.js';

const CASES = [['starcore', starcoreLayout], ['glacier', glacierLayout]];
const distToSeg = (px, pz, s) => {
  const vx = s.x2 - s.x1, vz = s.z2 - s.z1, t = Math.max(0, Math.min(1, ((px - s.x1) * vx + (pz - s.z1) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - s.x1 - vx * t, pz - s.z1 - vz * t);
};
const distToWall = (px, pz, w) => Math.min(...wallSegments(w).map(s => distToSeg(px, pz, s)));

for (const [id, layout] of CASES) {
  const M = mapForScene(id), L = layout(M);
  const walls = L.columns.filter(c => c.layer === 'wall');

  test(`${id}:墙柱外沿 ≤ 胶囊 + 0.08、内沿覆盖到胶囊 − 0.08、高 ≤ 0.5`, () => {
    for (const c of walls) {
      const w = M.walls.reduce((b, w) => (distToWall(c.x, c.z, w) < distToWall(c.x, c.z, b) ? w : b));
      for (const [x, z] of hexVertices(c, leanOf(c))) assert.ok(distToWall(x, z, w) - w.r <= ENVELOPE_TOL + 1e-9, `${id} 外凸`);
      assert.ok(c.h <= WALL_MAX_H);
    }
    for (const w of M.walls) for (const s of wallSegments(w)) {
      const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1), nx = -(s.z2 - s.z1) / len, nz = (s.x2 - s.x1) / len, d = w.r - ENVELOPE_TOL;
      for (let t = 0; t <= len; t += 0.02) for (const sd of [-1, 1]) {
        const x = s.x1 + (s.x2 - s.x1) * t / len + nx * d * sd, z = s.z1 + (s.z2 - s.z1) * t / len + nz * d * sd;
        if (distToWall(x, z, w) < d - 1e-6) continue;
        assert.ok(walls.some(c => insideHex(c, x, z)), `${id} 墙内沿缺口 ${x.toFixed(2)},${z.toFixed(2)}`);
      }
    }
  });

  test(`${id}:台地外缘 / 台沿内缘直线无缺口,不越过外框,不进战场;近端 ≤ 0.6`, () => {
    const F = ARENA.frame, X = F.x - 0.05, Z = F.z - 0.05;
    for (const c of L.cutColumns) for (const [x, z] of c.poly) {
      assert.ok(Math.abs(x) <= X + 1e-6 && Math.abs(z) <= Z + 1e-6, '越过外缘');
      assert.ok(Math.abs(x) >= M.W - 1e-6 || Math.abs(z) >= M.HALF - 1e-6, '进了战场');
    }
    const covered = (x, z) => L.cutColumns.some(c => inConvex(c.poly, x, z, 1e-7));
    const inChamfer = (x, z) => L.terraces.every(b => !b.polys.every(p => inConvex(p, x, z)));
    for (let s = -1; s <= 1; s += 0.004) {
      for (const [x, z] of [[X - 0.01, s * Z], [-X + 0.01, s * Z], [s * X, Z - 0.01], [s * X, -Z + 0.01],
        [M.W + 0.01, s * M.HALF], [-M.W - 0.01, s * M.HALF], [s * M.W, M.HALF + 0.01], [s * M.W, -M.HALF - 0.01]]) {
        if (inChamfer(x, z)) continue;
        assert.ok(covered(x, z), `${id} 缺口 ${x.toFixed(2)},${z.toFixed(2)}`);
      }
    }
    for (const c of L.cutColumns.filter(c => c.kind === 'apron')) assert.ok(c.top <= NEAR_END_MAX_H + 1e-9);
  });

  test(`${id}:配景全在战场外、黄线内;没有边河 / 锻炉;玩法元素不变`, () => {
    for (const p of L.props) {
      assert.ok(Math.abs(p.x) > M.W + 0.3 || Math.abs(p.z) > M.HALF + 0.3, `${id} 配景进了战场 ${p.name}`);
      assert.ok(Math.abs(p.x) < ARENA.frame.x && Math.abs(p.z) < ARENA.frame.z);
    }
    assert.equal(L.rivers.length + L.fieldRivers.length, 0);
    assert.equal(L.forge, null);
    if (id === 'glacier') assert.ok(L.ice && L.ice.paths.length === 2);
    if (id === 'starcore') assert.equal(M.rifts.length, 2, '星核保留两个裂隙');
  });

  test(`${id}:布局确定(双方一致)`, () => assert.deepEqual(layout(M), L));
}

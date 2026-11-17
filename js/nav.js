// 地面寻路 — 网格 A*(纯数据,浏览器和 Node 共用)
//   · 网格步长 0.2,覆盖整个战场;岩脊、岩石、塔体、建筑卡按地面单位半径留出空隙
//   · 斜向移动不能切墙角(两个相邻直角格都要通行)
//   · 边成本 = 距离 × 两端逆速度倍率的平均值:裂隙里速度 ×0.5 → 成本 ×2,所以会权衡绕开还是穿过
//   · 终点不是目标中心,而是"站在这里就能打到目标"的格子(目标在塔中心也能找到落脚点)
//   · 静态障碍建一次;塔被摧毁、建筑卡出现 / 消失时只重建动态层
import { MAP, ROCK_CLEARANCE, wallGap, blockingWall } from './map.js';

const STEP = 0.2;
const CLEAR = 0.24;   // 留空:地面单位半径 0.22 + 一点余量

export class NavGrid {
  constructor(map = MAP) {
    this.map = map;
    this.x0 = -map.W; this.z0 = -map.HALF;
    this.cols = Math.round(2 * map.W / STEP) + 1;
    this.rows = Math.round(2 * map.HALF / STEP) + 1;
    const n = this.cols * this.rows;
    this.staticBlock = new Uint8Array(n);
    this.dynBlock = new Uint8Array(n);
    this.costMul = new Float32Array(n);
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const k = j * this.cols + i, x = this.x0 + i * STEP, z = this.z0 + j * STEP;
        const blocked = wallGap(x, z, map) < CLEAR || map.obstacles.some(o => Math.hypot(x - o.x, z - o.z) < o.r + CLEAR + ROCK_CLEARANCE);
        this.staticBlock[k] = blocked ? 1 : 0;
        this.costMul[k] = 1;   // 减速区(裂隙 / 冰面 / 熔岩)不进寻路代价:用户规则 2026-11-17,只是走过去的代价
      }
    }
    this.dynKey = '';
    // A* 用的缓冲区(复用,避免每次分配)
    this.g = new Float32Array(n);
    this.prev = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.run = 0;
    this.heap = new Int32Array(n * 2);
    this.heapF = new Float32Array(n * 2);
  }

  idx(x, z) {
    const i = Math.round((x - this.x0) / STEP), j = Math.round((z - this.z0) / STEP);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return -1;
    return j * this.cols + i;
  }
  px(k) { return this.x0 + (k % this.cols) * STEP; }
  pz(k) { return this.z0 + Math.floor(k / this.cols) * STEP; }
  blocked(k) { return k < 0 || this.staticBlock[k] === 1 || this.dynBlock[k] === 1; }

  // 动态障碍:还活着的塔 / 核心、场上的建筑卡。列表没变就不重建
  updateDynamic(structures, units) {
    const list = [...structures.filter(s => !s.dead), ...units.filter(u => u.building && !u.dead)];
    const key = list.map(o => o.id).join(',');
    if (key === this.dynKey) return;
    this.dynKey = key;
    this.dynBlock.fill(0);
    for (const o of list) {
      const R = (o.radius || 0.4) + CLEAR;
      const i0 = Math.max(0, Math.floor((o.x - R - this.x0) / STEP)), i1 = Math.min(this.cols - 1, Math.ceil((o.x + R - this.x0) / STEP));
      const j0 = Math.max(0, Math.floor((o.z - R - this.z0) / STEP)), j1 = Math.min(this.rows - 1, Math.ceil((o.z + R - this.z0) / STEP));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (Math.hypot(this.x0 + i * STEP - o.x, this.z0 + j * STEP - o.z) < R) this.dynBlock[j * this.cols + i] = 1;
      }
    }
  }

  // 离 (x, z) 最近的可通行格(起点贴着墙 / 被挤进障碍边缘时用)
  nearestFree(x, z) {
    const k0 = this.idx(Math.max(this.x0, Math.min(-this.x0, x)), Math.max(this.z0, Math.min(-this.z0, z)));
    if (k0 >= 0 && !this.blocked(k0)) return k0;
    let best = -1, bd = Infinity;
    const ci = Math.round((x - this.x0) / STEP), cj = Math.round((z - this.z0) / STEP);
    for (let r = 1; r <= 6 && best < 0; r++) {
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) continue;
        const k = j * this.cols + i;
        if (this.blocked(k)) continue;
        const d = Math.hypot(this.px(k) - x, this.pz(k) - z);
        if (d < bd) { bd = d; best = k; }
      }
    }
    return best;
  }

  // 从 (sx, sz) 走到"能打到目标"的位置:离目标中心 ≤ reach;melee 时还要求中间没有岩脊挡着。
  // 返回路径点数组 [{x, z}, ...](不含起点),或 null(没有可达路径)
  findPath(sx, sz, tx, tz, reach, melee) {
    const start = this.nearestFree(sx, sz);
    if (start < 0) return null;
    const goalOk = k => {
      const x = this.px(k), z = this.pz(k);
      return Math.hypot(x - tx, z - tz) <= reach && (!melee || !blockingWall(x, z, tx, tz, 0, this.map));
    };
    const h = k => Math.max(0, Math.hypot(this.px(k) - tx, this.pz(k) - tz) - reach);
    const run = ++this.run;
    const { g, prev, stamp, closed, heap, heapF, cols, rows } = this;
    let size = 0;
    const push = (k, f) => {   // 二叉小顶堆
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= f) break;
        heap[i] = heap[p]; heapF[i] = heapF[p]; i = p;
      }
      heap[i] = k; heapF[i] = f;
    };
    const pop = () => {
      const top = heap[0], lk = heap[--size], lf = heapF[size];
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= size) break;
        if (c + 1 < size && heapF[c + 1] < heapF[c]) c++;
        if (heapF[c] >= lf) break;
        heap[i] = heap[c]; heapF[i] = heapF[c]; i = c;
      }
      heap[i] = lk; heapF[i] = lf;
      return top;
    };
    stamp[start] = run; g[start] = 0; prev[start] = -1;
    push(start, h(start));
    let found = -1, iter = 0;
    while (size > 0 && iter++ < 6000) {
      const k = pop();
      if (closed[k] === run) continue;
      closed[k] = run;
      if (goalOk(k)) { found = k; break; }
      const ci = k % cols, cj = (k / cols) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const nk = nj * cols + ni;
        if (this.blocked(nk) || closed[nk] === run) continue;
        if (di && dj && (this.blocked(k + di) || this.blocked(k + dj * cols))) continue;   // 斜向不切墙角
        const ng = g[k] + STEP * (di && dj ? Math.SQRT2 : 1) * (this.costMul[k] + this.costMul[nk]) / 2;
        if (stamp[nk] === run && ng >= g[nk]) continue;
        stamp[nk] = run; g[nk] = ng; prev[nk] = k;
        push(nk, ng + h(nk));
      }
    }
    if (found < 0) return null;
    const pts = [];
    for (let k = found; k !== -1 && k !== start; k = prev[k]) pts.push({ x: this.px(k), z: this.pz(k) });
    pts.reverse();
    pts.cost = g[found];
    return pts;
  }

  // 两点之间的直线是否都能通行(按 STEP/2 采样);用于路径平滑:能直接看到更远的路径点就跳过中间的
  clearLine(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / (STEP * 0.5)));
    for (let s = 1; s <= n; s++) {
      const t = s / n, k = this.idx(ax + (bx - ax) * t, az + (bz - az) * t);
      if (this.blocked(k)) return false;
    }
    return true;
  }
}

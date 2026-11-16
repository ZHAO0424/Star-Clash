// 手势射线指针:移植自 WebXR 空间网页插件 D:\viture\webxr\extension\xr\pointer.js(72c700c,0.6.0.65)。
// 那份又是从 VITURE Liquid 搬过来的(unity/vitureglasseslink webxr-host/webspace/pointer.js,027b9ba,
// 设计稿 docs/webxr-hand-pointer.md),对齐颈环 launcher 3.0 的做法。这里只取四件:
//   Stabilizer   XRI 远端射线稳定(角度 5°、位置 5 cm,带射线末端)
//   SeekDetector 「找光标」:来回晃 / 画圈才把射线淡入(平时只有光标圈)
//   HandArbiter  自适应单射线:两只手都在时只有一只手在指,另一只手捏一下可以抢过来
//   CursorFx     光标圈:贴上 / 离开面板的脉冲、空瞄时停在上次的距离、深度变化限速
// 原文是挂到 globalThis 的普通脚本,这里改成 ES 模块导出,逻辑和常量逐字未改(不依赖 three,Node 里能测)。
// 向量都是 { x, y, z },WebXR 坐标(右手系,-z 朝前)。

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angle = (a, b) => Math.acos(clamp(dot(norm(a), norm(b)), -1, 1));   // 弧度
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
function slerp(a, b, t) {   // 两个单位向量之间
  const th = angle(a, b);
  if (th < 1e-5) return norm(lerp(a, b, t));
  const s = Math.sin(th);
  return norm(add(mul(a, Math.sin((1 - t) * th) / s), mul(b, Math.sin(t * th) / s)));
}
// 四元数的逆旋转（把世界向量转到这个姿态的局部坐标）
function rotInv(q, v) {
  const x = -q.x, y = -q.y, z = -q.z, w = q.w;
  const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
  return { x: v.x + w * tx + (y * tz - z * ty), y: v.y + w * ty + (z * tx - x * tz), z: v.z + w * tz + (x * ty - y * tx) };
}
const moveTowards = (cur, target, step) => (Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step);

// ---------------------------------------------------------------- 射线稳定
// XRI 3.x XRTransformStabilizer.ProcessStabilization（带 aim target）逐行移植。误差越小跟得越慢（按「误差 / 阈值」
// 插值，近似平方），大动作几乎不拖。角度取两种跟法里离目标更近的那一种：直接转向目标，或者「起点挪了、
// 射线末端不动」的那个朝向 —— 手平移时命中点不跟着漂。射线越长角度阈值放得越宽（×1..3）。
const K_90FPS = 1 / 90;
function stabilizedLerp(distance, timeSlice) {
  if (distance >= 1) return 1;
  if (distance <= 0) return 0;
  const dbl = distance - distance * distance, tri = dbl * dbl, t = timeSlice / K_90FPS;
  return distance * clamp(t, 0, 1) + dbl * clamp(t - 1, 0, 1) + tri * clamp(t - 2, 0, 1);
}
class Stabilizer {
  constructor({ positionM = 0.05, angleDeg = 5 } = {}) { this.pos = positionM; this.ang = angleDeg * Math.PI / 180; this.cur = null; }
  reset() { this.cur = null; }
  // o / d = 这一帧 runtime 给的射线；rayEnd = 上一帧射线的末端（命中点或光标所在处）
  update(o, d, rayEnd, dt) {
    d = norm(d);
    if (!this.cur || !(dt > 0)) { this.cur = { o, d }; return this.cur; }
    const c = this.cur;
    const po = this.pos > 0 ? lerp(c.o, o, stabilizedLerp(len(sub(o, c.o)) / this.pos, dt)) : o;
    const rayLen = len(sub(rayEnd, c.o));
    const anti = norm(sub(add(c.o, mul(c.d, rayLen)), po));
    const scale = 1 + Math.log(Math.max(rayLen, 1));
    const antiAng = this.ang * clamp(scale, 1, 3);
    const rot = angle(d, c.d) / this.ang, alt = angle(d, anti) / antiAng;
    const nd = alt < rot ? slerp(anti, d, stabilizedLerp(alt, dt * scale)) : slerp(c.d, d, stabilizedLerp(rot, dt * scale));
    this.cur = { o: po, d: nd };
    return this.cur;
  }
}

// ---------------------------------------------------------------- 找光标
// launcher CursorSeekDetector 原样移植：射线方向在头的坐标里的 yaw / pitch 当成光标轨迹，1 秒内方向折返 3 次
// （来回晃是 180° 折返，画圈是方向连续转过 110°）就算在找；单向挥手、大范围移动都不算。
const SEEK = { MIN_SPEED: 35, REVERSAL_DOT: -0.34, MIN_TRAVEL: 1.75, MAX_TRAVEL: 18, WINDOW: 1, COUNT: 3, HOLD: 1.1, SMOOTH: 30, IDLE_RESET: 0.35 };
class SeekDetector {
  constructor() { this.reset(); }
  reset() {
    this.has = false; this.vel = { x: 0, y: 0 }; this.stroke = null; this.travel = 0; this.idle = 0;
    this.rev = new Array(SEEK.COUNT).fill(-Infinity); this.head = 0; this.until = -Infinity;
  }
  seeking(now) { return now <= this.until; }
  // d = 射线方向，headQ = 头的朝向，now / dt 秒
  update(d, headQ, now, dt) {
    if (!(dt > 0)) return;
    const l = rotInv(headQ, d);
    const yaw = Math.atan2(l.x, -l.z) * 180 / Math.PI, pitch = Math.asin(clamp(l.y, -1, 1)) * 180 / Math.PI;
    if (!this.has) { this.has = true; this.yaw = yaw; this.pitch = pitch; return; }
    let dy = yaw - this.yaw; dy = ((dy + 540) % 360) - 180;
    const delta = { x: dy, y: pitch - this.pitch };
    this.yaw = yaw; this.pitch = pitch;
    const k = 1 - Math.exp(-SEEK.SMOOTH * dt);
    this.vel = { x: this.vel.x + (delta.x / dt - this.vel.x) * k, y: this.vel.y + (delta.y / dt - this.vel.y) * k };
    const speed = Math.hypot(this.vel.x, this.vel.y);
    if (speed < SEEK.MIN_SPEED) { this.idle += dt; if (this.idle >= SEEK.IDLE_RESET) this.stroke = null; return; }
    this.idle = 0;
    const dir = { x: this.vel.x / speed, y: this.vel.y / speed };
    if (!this.stroke) { this.stroke = dir; this.travel = 0; }
    else if (dir.x * this.stroke.x + dir.y * this.stroke.y <= SEEK.REVERSAL_DOT) {
      if (this.travel > SEEK.MAX_TRAVEL) { this.rev.fill(-Infinity); this.head = 0; }   // 一次有目的的大移动：清掉攒下的
      else if (this.travel >= SEEK.MIN_TRAVEL) {
        this.rev[this.head] = now; this.head = (this.head + 1) % SEEK.COUNT;
        if (now - this.rev[this.head] <= SEEK.WINDOW) this.until = now + SEEK.HOLD;
      }
      this.stroke = dir; this.travel = 0;
    }
    this.travel += Math.hypot(delta.x, delta.y);
  }
}
// 射线线条的透明度：进快出慢（找的人要立刻看到线；结束时不能一下消失像闪烁）
const seekAlpha = (a, seeking, dt) => moveTowards(a, seeking ? 1 : 0, Math.min(dt, 0.05) / (seeking ? 0.12 : 0.35));

// ---------------------------------------------------------------- 自适应单射线
// launcher HandRayModeController 的 Flexible 模式原样移植（常量照抄）。
const FLEX = {
  ZONE_H: [-0.55, -0.4, -0.05, 0.1], ZONE_F: [0.1, 0.2, 0.45, 0.6],   // 头坐标里的梯形区（米）：高度、前方距离
  W_ZONE: 0.7, W_MOVE: 0.3, STICKY: 0.15, RIGHT_BONUS: 0.01,
  VEL_SMOOTH: 8, VEL_FULL: 0.5,
  MOVE_WINDOW: 0.25, MOVE_DIST: 0.01,                                  // 静止判据：0.25 s 内净位移 < 1 cm
  DWELL_PINCH: 0.15, DWELL_SCORE: 0.4, COOLDOWN: 0.72, CONE_DEG: 50,
};
const trapezoid = (v, [a, b, c, d]) => (v <= a || v >= d ? 0 : v < b ? (v - a) / (b - a) : v > c ? (d - v) / (d - c) : 1);
class HandArbiter {
  constructor() { this.active = 'right'; this.cool = 0; this.s = { left: this.blank(), right: this.blank() }; }
  blank() { return { tracked: false, prev: null, vel: 0, anchor: null, age: 0, stable: 0 }; }
  // hands: { left?, right? }，每只 { palm, pinch, interacting }（interacting = 这只手正指着 / 按着东西）；
  // head: { pos, q }。返回 { active, stole }：stole = 这一帧被另一只手捏一下抢走了（那一下捏合别当点击）
  update(hands, head, dt) {
    const inFov = (p) => {
      if (!p) return true;
      const v = sub(p, head.pos);
      if (len(v) < 1e-3) return true;
      const f = rotInv({ x: -head.q.x, y: -head.q.y, z: -head.q.z, w: head.q.w }, { x: 0, y: 0, z: -1 });   // 头的前方
      return angle(f, v) * 180 / Math.PI <= FLEX.CONE_DEG;
    };
    for (const k of ['left', 'right']) {
      const h = hands[k], st = this.s[k];
      if (!h) { st.tracked = false; st.stable = 0; st.age = 0; st.vel += (0 - st.vel) * Math.min(1, FLEX.VEL_SMOOTH * dt); continue; }
      if (!st.tracked) { st.tracked = true; st.prev = h.palm; st.anchor = h.palm; st.vel = 0; st.stable = 0; st.age = 0; }
      st.vel += (len(sub(h.palm, st.prev)) / Math.max(dt, 1e-3) - st.vel) * Math.min(1, FLEX.VEL_SMOOTH * dt);
      st.prev = h.palm;
      st.age += dt; st.stable += dt;
      if (len(sub(h.palm, st.anchor)) >= FLEX.MOVE_DIST) { st.stable = 0; st.anchor = h.palm; st.age = 0; }
      else if (st.age >= FLEX.MOVE_WINDOW) { st.anchor = h.palm; st.age = 0; }
    }
    if (this.cool > 0) this.cool -= dt;
    const L = hands.left, R = hands.right;
    if (!L && !R) return { active: null, stole: false };
    if (L && !R) { this.active = 'left'; return { active: 'left', stole: false }; }
    if (!L && R) { this.active = 'right'; return { active: 'right', stole: false }; }
    const act = hands[this.active], other = this.active === 'left' ? 'right' : 'left', oth = hands[other];
    if (act.interacting || act.pinch) return { active: this.active, stole: false };   // 正指着 / 按着东西、正捏着：不换
    const settled = (dwell) => !inFov(act.palm) || this.s[this.active].stable >= dwell;
    if (oth.pinch && inFov(oth.palm) && settled(FLEX.DWELL_PINCH)) { this.active = other; return { active: other, stole: true }; }
    if (this.cool > 0 || !settled(FLEX.DWELL_SCORE)) return { active: this.active, stole: false };
    const score = (k) => {
      const h = hands[k];
      if (!inFov(h.palm)) return 0;
      const l = rotInv(head.q, sub(h.palm, head.pos));
      const zone = trapezoid(l.y, FLEX.ZONE_H) * trapezoid(-l.z, FLEX.ZONE_F);
      return zone * FLEX.W_ZONE + clamp(this.s[k].vel / FLEX.VEL_FULL, 0, 1) * FLEX.W_MOVE
           + (k === this.active ? FLEX.STICKY : 0) + (k === 'right' ? FLEX.RIGHT_BONUS : 0);
    };
    const ls = score('left'), rs = score('right'), win = rs >= ls ? 'right' : 'left';
    if (win !== this.active && Math.max(ls, rs) > 0) { this.active = win; this.cool = FLEX.COOLDOWN; }
    return { active: this.active, stole: false };
  }
}

// ---------------------------------------------------------------- 光标圈
// launcher CursorAnimator 里和网页相关的部分：贴上面板 0.9→1、离开 1.03→1 的脉冲（0.12 s）；离开面板 0.12 s 内
// 还按贴着算（边缘命中闪烁）；空瞄时停在上次命中的距离（一开始 2.5 m）；深度变化 0.08 s 平滑并限制辐辏
// 变化 ≤ 8°/s（固定焦面，深度一跳就重影）。大小按距离走，看上去一样大。
const CUR = { FREE_M: 2.5, GRACE: 0.12, PULSE: 0.12, ATTACH_FROM: 0.9, DETACH_FROM: 1.03, DEPTH_T: 0.08, VERGE: 8 * Math.PI / 180, HALF_IPD: 0.0315 };
function smoothDepth(cur, target, dt) {
  let next = cur + (target - cur) * (1 - Math.exp(-dt / CUR.DEPTH_T));
  const v0 = 2 * Math.atan(CUR.HALF_IPD / Math.max(cur, 0.05)), v1 = 2 * Math.atan(CUR.HALF_IPD / Math.max(next, 0.05)), max = CUR.VERGE * dt;
  if (Math.abs(v1 - v0) > max) next = CUR.HALF_IPD / Math.tan((v0 + Math.sign(v1 - v0) * max) / 2);
  return next;
}
class CursorFx {
  constructor() { this.target = CUR.FREE_M; this.dist = CUR.FREE_M; this.attached = false; this.lastHit = -Infinity; this.pulseFrom = 1; this.pulseT = -Infinity; }
  // hitDist = 这一帧命中的距离（没命中 null）；now 毫秒、dt 秒。返回 { dist, attached, scale }：
  // 光标画在射线上 dist 处（没命中时停在上次命中的距离），scale 是贴上 / 离开时的脉冲
  update(hitDist, now, dt) {
    if (hitDist != null) { this.lastHit = now; this.target = hitDist; }
    const attached = hitDist != null || now - this.lastHit < CUR.GRACE * 1000;
    if (attached !== this.attached) { this.attached = attached; this.pulseFrom = attached ? CUR.ATTACH_FROM : CUR.DETACH_FROM; this.pulseT = now; }
    this.dist = dt > 0 ? smoothDepth(this.dist, this.target, dt) : this.target;
    const k = Math.min(1, (now - this.pulseT) / (CUR.PULSE * 1000)), e = 1 - (1 - k) ** 3;
    return { dist: this.dist, attached, scale: this.pulseFrom + (1 - this.pulseFrom) * e };
  }
}

export { Stabilizer, SeekDetector, HandArbiter, CursorFx, seekAlpha };
export const FREE_AIM_M = CUR.FREE_M;

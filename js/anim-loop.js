// 循环动作首尾对齐(纯数据,不依赖 three;scene.js 加载模型时用,单测直接测)
//   Tripo 生成的行走片段首尾两帧并不相同(六足 walk 的头 / 脊椎差 24°,蛇形 march 的脊椎差 18°,
//   人形 walk 腿部差约 10°)。LoopRepeat 每圈从末帧跳回首帧时,这个差值在一帧里补完 → 每圈「卡」一下。
//   做法:把首尾差按时间线性摊到整段(漂移校正):第 k 帧叠加 w = (t_k - t_0) / (t_N - t_0) 份的修正,
//   首帧不变、末帧正好等于首帧,中间整体平滑偏一点,看不出来。
//   values 原地修改;itemSize = 4 视为四元数(xyzw),其余按分量线性处理(位移 / 缩放)

export function closeLoopTrack(times, values, itemSize) {
  const n = times.length;
  if (n < 2) return;
  const span = times[n - 1] - times[0];
  if (!(span > 0)) return;
  const last = (n - 1) * itemSize;
  if (itemSize !== 4) {
    const delta = [];
    for (let c = 0; c < itemSize; c++) delta.push(values[c] - values[last + c]);
    for (let k = 1; k < n; k++) {
      const w = (times[k] - times[0]) / span;
      for (let c = 0; c < itemSize; c++) values[k * itemSize + c] += delta[c] * w;
    }
    return;
  }
  // 四元数:d = q0 · qN⁻¹(取短弧),q_k' = slerp(单位四元数, d, w) · q_k
  const q0 = values.slice(0, 4), qN = values.slice(last, last + 4);
  if (dot(q0, qN) < 0) for (let c = 0; c < 4; c++) qN[c] = -qN[c];
  const d = mul(q0, [-qN[0], -qN[1], -qN[2], qN[3]]);
  for (let k = 1; k < n; k++) {
    const w = (times[k] - times[0]) / span;
    const q = mul(powUnit(d, w), Array.from(values.slice(k * 4, k * 4 + 4)));
    for (let c = 0; c < 4; c++) values[k * 4 + c] = q[c];
  }
}

// 去毛刺:Tripo 的六足 walk 预设是 3 个 0.83 秒的步态拼起来的,每段开头那 1–2 帧头 / 脊椎是另一个姿势
//   (跳 24–32°,下一帧又跳回来)→ 每 0.83 秒抽一下。找出「突然跳走、1–3 帧内又跳回原处」的关键帧,
//   用前后好帧插值替换。判据:这一步 > 6 倍中位步长(旋转另要 > 5°),且之后 3 帧内能回到跳之前的值附近。
//   正常的大幅动作(挥砍)不会「跳走又跳回」,不受影响。返回修掉的关键帧数
export function despikeTrack(times, values, itemSize) {
  const n = times.length, quat = itemSize === 4;
  if (n < 4) return 0;
  const at = k => Array.from(values.slice(k * itemSize, (k + 1) * itemSize));
  const dist = (a, b) => quat ? 2 * Math.acos(Math.min(1, Math.abs(dot(a, b)))) : Math.hypot(...a.map((v, i) => v - b[i]));
  const steps = [];
  for (let k = 1; k < n; k++) steps.push(dist(at(k - 1), at(k)));
  const med = [...steps].sort((a, b) => a - b)[steps.length >> 1];
  if (!(med > 1e-6)) return 0;   // 静止轨道(或只有个别跳变的开关轨道):不动
  const jump = Math.max(6 * med, quat ? 5 * Math.PI / 180 : 0);
  let fixed = 0;
  // 首帧:跳离第二帧、而第二到第三帧平稳 → 首帧换成第二帧
  if (steps[0] > jump && steps[1] < jump / 3) { set(values, 0, at(1), itemSize); fixed++; }
  for (let k = 1; k < n - 1; k++) {
    if (dist(at(k - 1), at(k)) <= jump) continue;
    const base = at(k - 1);
    let j = k + 1;
    while (j < n && j <= k + 3 && dist(base, at(j)) > jump / 2) j++;
    if (j >= n || j > k + 3) continue;   // 没跳回来:是真动作,不动
    const end = at(j);
    for (let m = k; m < j; m++) {
      const w = (times[m] - times[k - 1]) / (times[j] - times[k - 1]);
      set(values, m, quat ? mul(powUnit(short(mul(end, inv(base))), w), base) : base.map((v, i) => v + (end[i] - v) * w), itemSize);
      fixed++;
    }
    k = j - 1;
  }
  return fixed;
}
function set(values, k, v, itemSize) { for (let c = 0; c < itemSize; c++) values[k * itemSize + c] = v[c]; }
const inv = q => [-q[0], -q[1], -q[2], q[3]];
const short = q => q[3] < 0 ? q.map(v => -v) : q;   // 同一旋转取短弧那一侧

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
function mul(a, b) {   // 四元数乘法 a·b(xyzw)
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
// slerp(单位四元数, d, w):把 d 的转角乘 w
function powUnit(d, w) {
  const s = Math.hypot(d[0], d[1], d[2]);
  if (s < 1e-9) return [0, 0, 0, 1];
  const half = Math.atan2(s, d[3]) * w, k = Math.sin(half) / s;
  return [d[0] * k, d[1] * k, d[2] * k, Math.cos(half)];
}

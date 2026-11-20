// XR 出牌第十轮:手位选牌 + 抬起确认 + 落点跟手("虚拟触控板")的纯函数(不依赖 three.js,Node 里直接测)
// 方案见 docs/xr-relative-drop-plan.md。
//
// 两套坐标:
//   视图坐标(view):uiInner 本地坐标,单位米。UI 换边后它跟着转,所以永远是"玩家视角":
//                    x = 右,y = 上,-z = 远离玩家。手位、手牌行都在这里比较。
//   战场坐标(field):scene.world 本地坐标,单位格。玩家(p)在 +z 一侧,部署区 z ∈ [DEPLOY_LINE, HALF]。
// 落点先在"视图对齐的战场坐标"(u = 左右,v = 纵深,远离玩家为正,原点在战场中心)里算,再按 UI 换边角 yaw 转回战场坐标、夹紧。
//
// 流程(xr.js 的手部状态机 idle → select → held → aiming):
//   select:捏合点进入手牌带(pickCardByHand),左右位置最近的牌被选中(带滞回)
//   held  :捏合 = 抓起选中的牌;liftProgress ≥ 1(往前 / 往上合成位移 ≥ 7cm)= 确认
//   aiming:dropStart 定初始落点(近边,x 跟手),dropFromHand 每帧相对确认时的手位映射落点;退回确认线以内 cancel = true

import { MAP } from './map.js';

// 手牌带:相对手牌行中心,前后 ±12cm、上下 ±10cm、左右超出两端 6cm 以内;相邻切换 1.2cm 滞回
// 第十一轮实测:手自然垂在牌下方也要能选 → 向下放宽到 35cm、朝身体一侧放宽到 25cm(上方仍 10cm,往棋盘方向仍 12cm)
export const HAND_BAND = { DEPTH: 0.12, TOWARD: 0.25, HEIGHT: 0.10, BELOW: 0.35, SIDE: 0.06, HYSTERESIS: 0.012 };
// 抬起确认 7cm;确认后退回到 6cm 以内算"退回确认线"(1cm 滞回,确认线上手抖不会来回切取消)
export const LIFT = { CONFIRM: 0.05, CANCEL: 0.04 };   // 第十一轮实测:7cm 太远 → 5cm(取消线仍低 1cm 防抖)
// GX:手左右 ±15cm 覆盖场地半宽 4.8 格 → 32 格/米;GD:手前 / 上 20cm 推过部署区纵深 5.2 格 → 26 格/米;
// UP:往上的位移按 0.8 计入纵深;EDGE:初始落点在近边往里 0.6 格;TAU:落点平滑时间常数(秒)
export const DROP_GAIN = { GX: 32, GD: 26, UP: 0.8, EDGE: 0.6, TAU: 0.06 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 夹紧范围(战场坐标):单位 / 建筑 / 只能放己方半场的法术 → 己方部署区;其余法术 → 全场
export function dropZone(placed, { W = MAP.W, HALF = MAP.HALF, LINE = MAP.DEPLOY_LINE } = {}) {
  return { x: [-W, W], z: placed ? [LINE, HALF] : [-HALF, HALF] };
}

// hand:手(捏合点)相对手牌行中心的视图坐标;cardXs:各牌中心的 x(不可选的牌传 null)
export function inHandBand(hand, cardXs) {
  const xs = cardXs.filter(x => x != null);
  if (!xs.length) return false;
  // 视图坐标:y 向上,+z 朝玩家(身体一侧),-z 朝棋盘
  return hand.y <= HAND_BAND.HEIGHT && hand.y >= -HAND_BAND.BELOW && hand.z >= -HAND_BAND.DEPTH && hand.z <= HAND_BAND.TOWARD
    && hand.x >= Math.min(...xs) - HAND_BAND.SIDE && hand.x <= Math.max(...xs) + HAND_BAND.SIDE;
}

// 手牌带里左右最近的牌;current:上一帧选中的下标,离它不比最近的那张远出 HYSTERESIS 就保持不变。带外返回 -1
export function pickCardByHand(hand, cardXs, current = -1) {
  if (!inHandBand(hand, cardXs)) return -1;
  let best = -1, bestD = Infinity;
  cardXs.forEach((x, i) => {
    if (x == null) return;
    const d = Math.abs(hand.x - x);
    if (d < bestD) { bestD = d; best = i; }
  });
  if (current >= 0 && cardXs[current] != null && Math.abs(hand.x - cardXs[current]) <= bestD + HAND_BAND.HYSTERESIS) return current;
  return best;
}

// 从抓起点 h0 往前(-z)/ 往上(+y)的合成位移(米);往后、往下不算
export function liftAmount(h0, h) {
  return Math.hypot(Math.max(0, h0.z - h.z), Math.max(0, h.y - h0.y));
}

// 抬起进度 0..1,≥ 1 即确认
export function liftProgress(h0, h) {
  return clamp(liftAmount(h0, h) / LIFT.CONFIRM, 0, 1);
}

// 视图对齐的战场坐标 (u, v) → 战场坐标 (x, z)。yaw = UI 绕战场中心转过的角(uiPivot.rotation.y,three 的 rotation.y 同号)
export function viewToField(u, v, yaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: u * c - v * s, z: -u * s - v * c };
}

// 确认瞬间的初始落点(视图对齐坐标):u = 手相对手牌行中心的左右位置 × GX(手在行中间 = 棋盘中线),
// v = 玩家这一侧的近边往里 EDGE 格(换到侧边时面对的是战场侧边,半长换成半宽)
export function dropStart(handX, yaw = 0, { W = MAP.W, HALF = MAP.HALF } = {}, gains = DROP_GAIN) {
  const half = Math.abs(Math.sin(yaw)) > 0.5 ? W : HALF;
  return { x0: handX * gains.GX, d0: -half + gains.EDGE };
}

// 落点:grab = 抓起时手位(判断是否退回确认线),h0 = 确认时手位,h = 当前手位(都是视图坐标);
// x0 / d0 = dropStart 的结果;zone = dropZone 的结果。返回战场坐标 { x, z }(已夹紧)和 cancel(退回确认线以内)
export function dropFromHand({ grab, h0, h, x0, d0, zone, yaw = 0, gains = DROP_GAIN }) {
  const u = x0 + (h.x - h0.x) * gains.GX;
  const v = d0 + ((h0.z - h.z) + (h.y - h0.y) * gains.UP) * gains.GD;
  const f = viewToField(u, v, yaw);
  return {
    x: clamp(f.x, zone.x[0], zone.x[1]),
    z: clamp(f.z, zone.z[0], zone.z[1]),
    cancel: liftAmount(grab ?? h0, h) < LIFT.CANCEL,
  };
}

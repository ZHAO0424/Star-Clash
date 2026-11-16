// 联机协议 — 服务器与客户端共用的快照序列化
//
// 服务器权威:游戏只在服务器上模拟;每 50ms 给每个客户端发一份「从他的视角看」的快照。
// 视角转换:发给 e 方的快照把阵营对调(e↔p)、坐标镜像(x→-x, z→-z),
// 于是每个客户端看到的永远是「自己 = p,在 z>0 一侧」,界面/渲染/XR 代码不需要区分先后手。
// 客户端发来的坐标同样按其视角镜像回服务器坐标。
//
// 快照只包含该玩家应该知道的信息:对手的手牌只给数量。

import { CARDS, ALL_UPGRADES } from './cards.js';

export const SNAPSHOT_MS = 50;
export const XR_POSE_INTERVAL = 90;
export const XR_POSE_TIMEOUT = 1400;

// Poses use the standard table's seat as origin. Each body part has its own motion envelope.
export function xrPartInSeat(part, index) {
  if (!Array.isArray(part) || part.length !== 8 || !part.every(Number.isFinite)) return false;
  const [x, y, z] = part;
  if (index === 0) {
    if (Math.abs(x) > .55 || y < -.45 || y > .55 || z < -.50 || z > .56) return false;
  } else if (Math.abs(x) > .95 || y < -.98 || y > .36 || z < -1.10 || z > .45) {
    return false;
  }
  const norm = Math.hypot(...part.slice(3, 7));
  return norm > 0.8 && norm < 1.2 && (part[7] === 0 || part[7] === 1);
}

export function validXRPose(pose) {
  if (pose === null) return true;
  return Array.isArray(pose) && pose.length === 3 && pose.some(part => part !== null)
    && [0, 1, 2].every(index => pose[index] === null || xrPartInSeat(pose[index], index));
}
const UP = Object.fromEntries(ALL_UPGRADES.map(u => [u.id, u]));
const r2 = v => Math.round(v * 100) / 100;

// 视角映射工具
export function view(forWho) {
  const sw = forWho === 'e';
  return {
    sw,
    side: s => (sw && s ? (s === 'p' ? 'e' : s === 'e' ? 'p' : s) : s),
    x: v => (sw ? -v : v),
    z: v => (sw ? -v : v),
  };
}

// ── 服务器端:生成快照 ──
export function makeSnapshot(game, forWho, events, ack = 0) {
  const V = view(forWho);
  const other = forWho === 'p' ? 'e' : 'p';
  const me = game.side(forWho), op = game.side(other);
  const U = game.upgrade;
  return {
    time: r2(game.time), ph: game.phase, pl: r2(game.prepLeft ?? 0), w: V.side(game.winner), er: game.endReason || null,
    su: !!game.surge, ot: !!game.overtime, uc: game.upgradeCount, ack,
    me: { f: me.faction, m: r2(me.mana), mm: me.manaMax, hp: Math.round(me.baseHP), hpm: me.baseHPMax,
      pl: me.played, hand: me.hand.map(c => c.id), q: me.queue.map(c => c.id),
      bp: me.bloodPrice, br: r2(Math.max(0, (me.bloodReadyAt ?? 0) - game.time)) },   // 混沌血祭剩余冷却
    op: { f: op.faction, m: r2(op.mana), mm: op.manaMax, hp: Math.round(op.baseHP), hpm: op.baseHPMax,
      pl: op.played, hn: op.hand.length },
    node: { o: V.side(game.node.owner), p: r2(V.sw ? -game.node.progress : game.node.progress), c: !!game.node.contested, a: V.side(game.node.capturing) },
    st: game.structures.map(s => [s.kind, V.side(s.side), r2(V.x(s.x)), r2(V.z(s.z)), Math.round(s.hp), s.dead ? 1 : 0]),
    u: game.units.map(u => {
      const st = u.status;
      const flags = (st.stun > 0 ? 1 : 0) | (st.hack > 0 ? 2 : 0) | (st.curse > 0 ? 4 : 0) | (st.parasite > 0 ? 8 : 0) | (u.mimic ? 16 : 0);   // 16 = 基因拟态复制体
      const t = u.target;
      return [u.id, V.side(u.side), u.card.id, r2(V.x(u.x)), r2(V.z(u.z)), Math.round(u.hp), Math.round(u.maxHp),
        Math.round(u.shield), Math.round(u.maxShield), flags, t ? r2(V.x(t.x)) : null, t ? r2(V.z(t.z)) : null, u.rank || 0, u.card.cocoon ? r2(u.hatchProgress ?? 0) : null, u.links?.length ? u.links.map(m => m.id) : null];
    }),
    up: U ? { o: U.options[forWho].map(u => u.id), pk: !!U.picked[forWho], po: !!U.picked[other], tm: r2(U.timer) } : null,
    ev: events.map(e => serializeEvent(e, V)),
  };
}

// 事件里的对象引用(单位/建筑/卡牌/强化)转成可传输的形式
function serializeEvent(ev, V) {
  const out = {};
  for (const [k, v] of Object.entries(ev)) {
    if (v === null || v === undefined) { out[k] = v; continue; }
    if (k === 'owner' || k === 'prev' || k === 'winner' || k === 'who' || k === 'side') out[k] = V.side(v);
    else if (k === 'x') out[k] = r2(V.x(v));
    else if (k === 'z') out[k] = r2(V.z(v));
    else if (k === 'card') out[k] = v.id;
    else if (k === 'upgrade') out[k] = v.id;
    else if (k === 'picks') out[k] = { p: V.sw ? v.e?.id : v.p?.id, e: V.sw ? v.p?.id : v.e?.id };
    else if (k === 'points') out[k] = v.map(p => ({ x: r2(V.x(p.x)), z: r2(V.z(p.z)), air: !!p.air }));
    else if (typeof v === 'object' && v.kind) out[k] = { _s: 1, k: v.kind, s: V.side(v.side), x: r2(V.x(v.x)), z: r2(V.z(v.z)) };
    else if (typeof v === 'object' && v.card) out[k] = { _u: 1, id: v.id, c: v.card.id, s: V.side(v.side), x: r2(V.x(v.x)), z: r2(V.z(v.z)), a: !!v.air };
    else out[k] = v;
  }
  return out;
}

// ── 客户端:把快照写进本地的「镜像 Game」──
// mirror 是客户端用同样参数构造的 Game 实例,只用来承载状态和复用只读方法(canPlay、canDeployAt、crowns…),从不 tick
export function applySnapshot(mirror, snap, { keepHand = false, pendingCost = 0 } = {}) {
  const g = mirror;
  g.time = snap.time; g.phase = snap.ph; g.prepLeft = snap.pl ?? 0; g.winner = snap.w; g.endReason = snap.er;
  g.surge = snap.su; g.overtime = snap.ot; g.upgradeCount = snap.uc;

  const me = g.p, op = g.e;
  me.mana = Math.max(0, snap.me.m - pendingCost); me.manaMax = snap.me.mm;
  me.baseHP = snap.me.hp; me.baseHPMax = snap.me.hpm; me.played = snap.me.pl;
  me.bloodPrice = snap.me.bp;
  me.bloodReadyAt = snap.time + (snap.me.br || 0);
  if (!keepHand) {
    me.hand = snap.me.hand.map(id => CARDS[id]);
    me.queue = snap.me.q.map(id => CARDS[id]);
  }
  op.mana = snap.op.m; op.manaMax = snap.op.mm; op.baseHP = snap.op.hp; op.baseHPMax = snap.op.hpm; op.played = snap.op.pl;
  op.hand = new Array(snap.op.hn).fill(null);

  g.node.owner = snap.node.o; g.node.progress = snap.node.p; g.node.contested = snap.node.c; g.node.capturing = snap.node.a ?? null;

  // 建筑:按(阵营 + 位置)匹配本地镜像里的建筑
  for (const [kind, side, x, z, hp, dead] of snap.st) {
    const s = findStructure(g, kind, side, x, z);
    if (!s) continue;
    if (s.kind !== 'base') s.hp = hp;          // 核心血量来自 side.baseHP
    s.dead = !!dead;
  }

  // 单位:按 id 增量更新,记录插值起止点
  const now = performance.now();
  const byId = new Map(g.units.map(u => [u.id, u]));
  const next = [];
  for (const [id, side, cid, x, z, hp, maxHp, sh, msh, flags, tx, tz, rank, hatchProgress, linkIds] of snap.u) {
    let u = byId.get(id);
    const card = CARDS[cid];
    if (!u) {
      u = { id, card, x, z, status: {}, radius: card.type === 'building' ? 0.42 : card.air ? 0.18 : 0.22 };
      u._ax = x; u._az = z;
    } else {
      u._ax = u.x; u._az = u.z;              // 从当前渲染位置插值到新位置
    }
    u._bx = x; u._bz = z; u._t0 = now;
    u.side = side; u.card = card; u.hp = hp; u.maxHp = maxHp; u.shield = sh; u.maxShield = msh;
    u.air = !!card.air; u.building = card.type === 'building'; u.range = card.range; u.atk = card.atk;
    u.status.stun = flags & 1 ? 1 : 0; u.status.hack = flags & 2 ? 1 : 0;
    u.status.curse = flags & 4 ? 1 : 0; u.status.parasite = flags & 8 ? 1 : 0;
    u.mimic = Boolean(flags & 16);
    u.target = tx === null ? null : { x: tx, z: tz };
    u.rank = rank || 0;
    u.hatchProgress = hatchProgress ?? 0;
    u.linkIds = linkIds ?? [];
    next.push(u);
  }
  g.units = next;

  g.upgrade = snap.up ? {
    options: { p: snap.up.o.map(id => UP[id]), e: [] },
    picked: { p: snap.up.pk ? true : null, e: snap.up.po ? true : null },
    timer: snap.up.tm,
  } : null;

  // 事件还原成渲染层认识的形状
  const live = new Map(g.units.map(u => [u.id, u]));
  for (const e of snap.ev) g.events.push(deserializeEvent(e, g, live));
}

function findStructure(g, kind, side, x, z) {
  let best = null, bd = 0.5;
  for (const s of g.structures) {
    if (s.kind !== kind || s.side !== side) continue;
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function deserializeEvent(e, g, live) {
  const out = {};
  for (const [k, v] of Object.entries(e)) {
    if (v && typeof v === 'object' && v._u) {
      out[k] = live.get(v.id) || { id: v.id, card: CARDS[v.c], side: v.s, x: v.x, z: v.z, air: v.a, status: {} };
    } else if (v && typeof v === 'object' && v._s) {
      out[k] = findStructure(g, v.k, v.s, v.x, v.z) || { kind: v.k, side: v.s, x: v.x, z: v.z };
    } else if (k === 'card') out[k] = CARDS[v];
    else if (k === 'upgrade') out[k] = UP[v];
    else if (k === 'picks') out[k] = { p: UP[v.p], e: UP[v.e] };
    else out[k] = v;
  }
  return out;
}

// 客户端每帧:单位位置在两次快照之间线性插值
export function interpolate(mirror, now = performance.now()) {
  for (const u of mirror.units) {
    if (u._t0 === undefined) continue;
    const k = Math.min(1, (now - u._t0) / SNAPSHOT_MS);
    u.x = u._ax + (u._bx - u._ax) * k;
    u.z = u._az + (u._bz - u._az) * k;
  }
}

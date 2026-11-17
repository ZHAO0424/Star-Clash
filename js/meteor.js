// 星核荒原 · 陨星坠落(纯逻辑,浏览器与 Node 服务器共用;服务器权威,客户端只渲染快照里的状态)
//   · 每 interval 秒,在一对绕星核旋转 180° 对称的位置(双方各一处)先亮预警圈,warn 秒后陨星砸下:
//     圈内双方地面 + 飞行单位各受 damage 点伤害;建筑免疫(落点不在部署区,本来也砸不到建筑,免疫让规则好记)
//   · 落点留下一块星石,持续 shardLife 秒;任一方单位先碰到(中心距 ≤ pickR)就为该方 +1 法力,星石消失
//   · 落点:不进部署区、不压祭坛占领圈、不落在岩脊 / 岩石里;用对局种子(mulberry32)生成 → 联机由服务器决定,
//     重连靠快照,平衡模拟替换 Math.random 后可复现
//   · 单位行为(双方一致,属于引擎规则):单位不自动躲预警圈(躲不躲靠玩家判断);视野里没有敌方单位时,1.4 格内有星石就去捡
import { wallGap } from './map.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export class MeteorShower {
  constructor(game, cfg, seed) {
    this.g = game;
    this.cfg = cfg;
    this.rand = mulberry32(seed);
    this.next = cfg.first;
    this.warns = [];    // { x, z, left }(left = 离砸下还有几秒)
    this.shards = [];   // { id, x, z, left }
    this.nextId = 1;
  }

  // 一对落点:先在 p 方半场挑一个合法点,另一处是它绕星核旋转 180° 的镜像
  pickSite() {
    const m = this.g.map, c = this.cfg, N = m.node;
    const ok = (x, z) => Math.abs(z) <= m.DEPLOY_LINE - c.clearDeploy && Math.hypot(x - N.x, z - N.z) >= N.r + c.clearNode
      && wallGap(x, z, m) >= c.clearWall && m.obstacles.every(o => Math.hypot(x - o.x, z - o.z) >= o.r + c.clearWall);
    for (let i = 0; i < 64; i++) {
      const x = (this.rand() * 2 - 1) * (m.W - 0.6), z = 0.2 + this.rand() * (m.DEPLOY_LINE - c.clearDeploy - 0.2);
      if (ok(x, z) && ok(-x, -z)) return [x, z];
    }
    return [m.W - 1.0, 0.2];   // 兜底(按当前地图不会走到这里)
  }

  tick(dt) {
    const g = this.g, c = this.cfg;
    if (g.time >= this.next) {
      this.next += c.interval;
      const [x, z] = this.pickSite();
      for (const [px, pz] of [[x, z], [-x, -z]]) {
        this.warns.push({ x: px, z: pz, left: c.warn });
        g.events.push({ type: 'meteor_warn', x: px, z: pz, r: c.radius, t: c.warn });
      }
    }
    for (const w of this.warns) {
      w.left -= dt;
      if (w.left > 0) continue;
      for (const u of [...g.units]) {
        if (!u.dead && !u.building && Math.hypot(u.x - w.x, u.z - w.z) <= c.radius + u.radius) g.damage(u, c.damage, null, { meteor: true });
      }
      this.shards.push({ id: this.nextId++, x: w.x, z: w.z, left: c.shardLife });
      g.events.push({ type: 'meteor_hit', x: w.x, z: w.z, r: c.radius });
    }
    this.warns = this.warns.filter(w => w.left > 0);
    // 星石:最近的单位先捡到(同一帧两方都碰到时按距离裁决,结果确定)
    for (const s of this.shards) {
      s.left -= dt;
      let best = null, bd = c.pickR;
      for (const u of g.units) {
        if (u.dead || u.building) continue;
        const d = Math.hypot(u.x - s.x, u.z - s.z);
        if (d <= bd) { bd = d; best = u; }
      }
      if (best) {
        const side = g.side(best.side);
        side.mana = Math.min(side.manaMax, side.mana + c.mana);
        s.left = 0; s.picked = true;
        g.events.push({ type: 'shard_pick', x: s.x, z: s.z, who: best.side, amount: c.mana });
      } else if (s.left <= 0) g.events.push({ type: 'shard_fade', x: s.x, z: s.z });
    }
    this.shards = this.shards.filter(s => s.left > 0);
  }

  // 视野里没有敌方单位时,附近的星石
  nearShard(u, range = 1.4) {
    let best = null, bd = range;
    for (const s of this.shards) {
      const d = Math.hypot(u.x - s.x, u.z - s.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // 联机快照(视角映射 V:x / z 镜像)
  snapshot(V, r2) {
    return { w: this.warns.map(w => [r2(V.x(w.x)), r2(V.z(w.z)), r2(w.left)]), s: this.shards.map(s => [s.id, r2(V.x(s.x)), r2(V.z(s.z)), r2(s.left)]), n: r2(this.next) };
  }
  applySnapshot(mt) {
    this.warns = mt.w.map(([x, z, left]) => ({ x, z, left }));
    this.shards = mt.s.map(([id, x, z, left]) => ({ id, x, z, left }));
    this.next = mt.n;
  }
}

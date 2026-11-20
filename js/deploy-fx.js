// 部署特效「天降神兵」— 法阵贴图 + 瞄准时的「锁定」预览(降临序列在 vfx.js 的 descend)
//   · 贴图全是白色线稿(canvas 现画,启动时各画一次、之后复用),颜色靠材质 color 染:同一张图能变势力色 / 红 / 紫
//   · 4 个势力各一张符文纹样:钢铁 = 齿轮刻度 + 盾徽、智械 = 电路 + 六边形、虫群 = 有机脉络 + 孢囊、混沌 = 尖刺 + 破碎符文
//   · 光学透视眼镜里黑 = 透明:全部加法混合的亮色,不用暗部做效果
import * as THREE from 'three';

const TAU = Math.PI * 2;

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.translate(size / 2, size / 2);   // 原点放在中心,半径单位 = size / 2
  draw(g, size / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.center.set(0.5, 0.5);            // 转贴图(而不是转网格)实现旋转:网格贴地后几何体已烘死
  return t;
}
// 固定种子的伪随机:纹样每次启动都长一样
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const polar = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
function circle(g, r, w) { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
function poly(g, n, r, rot = 0) {
  g.beginPath();
  for (let i = 0; i <= n; i++) g.lineTo(...polar(rot + i / n * TAU, r));
  g.stroke();
}

// ── 势力符文(内圈,反向慢转)──
const RUNES = {
  steel(g, R) {   // 齿轮外廓 + 刻度 + 四个盾徽
    g.lineWidth = 5; g.beginPath();
    const teeth = 16;
    for (let i = 0; i < teeth; i++) {
      const a = i / teeth * TAU, w = TAU / teeth;
      g.arc(0, 0, R * 0.86, a, a + w * 0.5);
      g.arc(0, 0, R * 0.96, a + w * 0.58, a + w * 0.92);
    }
    g.closePath(); g.stroke();
    circle(g, R * 0.74, 3);
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * TAU, l = i % 4 ? 0.05 : 0.1;
      g.lineWidth = i % 4 ? 2 : 4;
      g.beginPath(); g.moveTo(...polar(a, R * 0.74)); g.lineTo(...polar(a, R * (0.74 - l))); g.stroke();
    }
    for (let i = 0; i < 4; i++) {   // 盾徽:盾形轮廓 + 内部 V 形军衔
      g.save(); g.rotate(i / 4 * TAU + TAU / 8); g.translate(0, -R * 0.5);
      const s = R * 0.12;
      g.lineWidth = 4; g.beginPath();
      g.moveTo(-s, -s); g.lineTo(s, -s); g.lineTo(s, 0); g.quadraticCurveTo(s * 0.9, s * 0.9, 0, s * 1.4);
      g.quadraticCurveTo(-s * 0.9, s * 0.9, -s, 0); g.closePath(); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.moveTo(-s * 0.55, -s * 0.2); g.lineTo(0, s * 0.35); g.lineTo(s * 0.55, -s * 0.2); g.stroke();
      g.restore();
    }
  },
  mecha(g, R) {   // 外六边形 + 电路走线(径向出线、拐角、端点焊盘)+ 顶点小六边形
    g.lineWidth = 5; poly(g, 6, R * 0.94, TAU / 12);
    g.lineWidth = 2.5; poly(g, 6, R * 0.82, TAU / 12);
    for (let i = 0; i < 6; i++) {   // 顶点小六边形
      const [x, y] = polar(TAU / 12 + i / 6 * TAU, R * 0.94);
      g.save(); g.translate(x, y); g.lineWidth = 3; poly(g, 6, R * 0.06); g.restore();
    }
    const rnd = seeded(7);
    g.lineWidth = 3;
    for (let i = 0; i < 18; i++) {   // 电路:从内圈径向出发,走一段后转 45°,末端一个焊盘
      const a = i / 18 * TAU + rnd() * 0.1, r0 = R * 0.36, r1 = R * (0.52 + rnd() * 0.16), turn = (rnd() < 0.5 ? -1 : 1) * 0.18;
      const p1 = polar(a, r1), p2 = polar(a + turn, r1 + R * 0.12);
      g.beginPath(); g.moveTo(...polar(a, r0)); g.lineTo(...p1); g.lineTo(...p2); g.stroke();
      g.beginPath(); g.arc(p2[0], p2[1], R * 0.025, 0, TAU); g.fill();
    }
    circle(g, R * 0.36, 3);
  },
  swarm(g, R) {   // 起伏的膜状外环 + 分叉的有机脉络 + 末端孢囊
    g.lineWidth = 5; g.beginPath();
    for (let i = 0; i <= 96; i++) { const a = i / 96 * TAU; g.lineTo(...polar(a, R * (0.88 + Math.sin(a * 7) * 0.035 + Math.sin(a * 13) * 0.02))); }
    g.stroke();
    const rnd = seeded(23);
    const vein = (a, r, len, w, depth) => {   // 递归分叉:每段微微弯曲,越分越细
      const a2 = a + (rnd() - 0.5) * 0.5, r2 = r + len;
      const [cx, cy] = polar(a + (rnd() - 0.5) * 0.4, r + len * 0.5), [ex, ey] = polar(a2, r2);
      g.lineWidth = w; g.beginPath(); g.moveTo(...polar(a, r)); g.quadraticCurveTo(cx, cy, ex, ey); g.stroke();
      if (depth > 0 && r2 < R * 0.78) { vein(a2 - 0.12, r2, len * 0.75, w * 0.7, depth - 1); vein(a2 + 0.12, r2, len * 0.75, w * 0.7, depth - 1); }
      else {   // 孢囊:实心核 + 外膜
        const s = R * (0.03 + rnd() * 0.03);
        g.beginPath(); g.arc(ex, ey, s, 0, TAU); g.fill();
        g.lineWidth = 2; g.beginPath(); g.arc(ex, ey, s * 1.8, 0, TAU); g.stroke();
      }
    };
    for (let i = 0; i < 7; i++) vein(i / 7 * TAU, R * 0.3, R * 0.2, 4.5, 2);
    g.lineWidth = 3; g.beginPath();
    for (let i = 0; i <= 64; i++) { const a = i / 64 * TAU; g.lineTo(...polar(a, R * (0.3 + Math.sin(a * 5) * 0.02))); }
    g.stroke();
  },
  chaos(g, R) {   // 十二芒尖刺星 + 断裂的外环 + 散落的破碎符文
    g.lineWidth = 4; g.beginPath();
    for (let i = 0; i <= 24; i++) g.lineTo(...polar(i / 24 * TAU, R * (i % 2 ? 0.42 : i % 4 ? 0.72 : 0.62)));
    g.stroke();
    const rnd = seeded(41);
    g.lineWidth = 5;
    for (let a = 0; a < TAU - 0.2;) {   // 断环:长短不一的弧段,中间留缺口
      const len = 0.3 + rnd() * 0.7;
      g.beginPath(); g.arc(0, 0, R * 0.92, a, Math.min(TAU - 0.05, a + len)); g.stroke();
      a += len + 0.08 + rnd() * 0.12;
    }
    g.lineWidth = 3;
    for (let i = 0; i < 14; i++) {   // 破碎符文:2~3 笔随机折线,像被打碎的字
      const a = i / 14 * TAU, [x, y] = polar(a, R * 0.81), s = R * 0.05;
      g.save(); g.translate(x, y); g.rotate(a + rnd() * 0.6);
      g.beginPath(); g.moveTo(-s, -s * (rnd() * 2 - 1));
      for (let k = 0; k < 2 + (rnd() < 0.5); k++) g.lineTo(s * (rnd() * 2 - 1), s * (rnd() * 2 - 1));
      g.stroke(); g.restore();
    }
  },
};

let TEX = null;
// 全部法阵贴图:第一次调用时画好,之后复用(XR 里每帧调用 showPlacement 也不会新建)
export function deployTextures() {
  if (TEX) return TEX;
  TEX = {
    runes: Object.fromEntries(Object.entries(RUNES).map(([k, draw]) => [k, canvasTex(256, (g, R) => {
      g.strokeStyle = g.fillStyle = '#fff'; g.lineCap = g.lineJoin = 'round';
      draw(g, R);
    })])),
    base: canvasTex(256, (g, R) => {   // 外圈:淡淡的底盘 + 粗边环 + 刻度环 + 四角瞄准括号
      const f = g.createRadialGradient(0, 0, 0, 0, 0, R);
      f.addColorStop(0, 'rgba(255,255,255,0.05)'); f.addColorStop(0.85, 'rgba(255,255,255,0.14)'); f.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = f; g.fillRect(-R, -R, R * 2, R * 2);
      g.strokeStyle = '#fff'; g.lineCap = 'round';
      circle(g, R * 0.95, 6);
      for (let i = 0; i < 72; i++) {
        const a = i / 72 * TAU, long = i % 6 === 0;
        g.lineWidth = long ? 4 : 2;
        g.beginPath(); g.moveTo(...polar(a, R * 0.88)); g.lineTo(...polar(a, R * (long ? 0.78 : 0.84))); g.stroke();
      }
      g.lineWidth = 5;
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; g.beginPath(); g.arc(0, 0, R * 0.99, a - 0.18, a + 0.18); g.stroke(); }
    }),
    cross: canvasTex(128, (g, R) => {   // 中心十字准星:中间留空的四根短线 + 小圈
      g.strokeStyle = '#fff'; g.lineCap = 'round';
      circle(g, R * 0.32, 5);
      g.lineWidth = 6;
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; g.beginPath(); g.moveTo(...polar(a, R * 0.5)); g.lineTo(...polar(a, R * 0.92)); g.stroke(); }
      g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, R * 0.08, 0, TAU); g.fill();
    }),
    pulse: canvasTex(128, (g, R) => {   // 收缩脉冲:靠外的一道软边细环
      const r = g.createRadialGradient(0, 0, R * 0.8, 0, 0, R);
      r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.6, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(-R, -R, R * 2, R * 2);
    }),
    crack: canvasTex(256, (g, R) => {   // 着陆裂纹:从中心向外分叉的锯齿裂缝,越外越细越淡
      const rnd = seeded(97);
      g.strokeStyle = '#fff'; g.lineCap = 'round';
      const crack = (a, r, w) => {
        let x = Math.cos(a) * r, y = Math.sin(a) * r;
        while (r < R * 0.92 && w > 0.6) {
          const step = R * (0.06 + rnd() * 0.06);
          a += (rnd() - 0.5) * 0.6; r += step;
          const nx = Math.cos(a) * r, ny = Math.sin(a) * r;
          g.globalAlpha = Math.max(0.15, 1 - r / R);
          g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
          x = nx; y = ny; w *= 0.86;
          if (rnd() < 0.22) crack(a + (rnd() < 0.5 ? -0.5 : 0.5), r, w * 0.7);
        }
      };
      for (let i = 0; i < 9; i++) crack(i / 9 * TAU + rnd() * 0.4, R * 0.08, 7);
      g.globalAlpha = 1;
      const c = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.22);   // 中心压出来的亮坑
      c.addColorStop(0, 'rgba(255,255,255,0.8)'); c.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = c; g.fillRect(-R, -R, R * 2, R * 2);
    }),
    beam: (() => {   // 锁定光束:竖直方向上实下虚(圆柱 UV 的 v:底 0 → 顶 1)
      const c = document.createElement('canvas');
      c.width = 4; c.height = 64;
      const g = c.getContext('2d'), r = g.createLinearGradient(0, 0, 0, 64);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.55, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, 4, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })(),
  };
  return TEX;
}

const LOCK_H = 3;            // 锁定光束从落点上方多高垂下(格)
const PULSE_PERIOD = 0.8;    // 收缩脉冲周期(秒)
const BAD = 0xff4444, RIFT = 0xd1a6ff, SNAP = 0xffc95a, WHITE = new THREE.Color(0xffffff);

function groundPlane(map, order, segs = 16) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, segs, segs), new THREE.MeshBasicMaterial({ map, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = order;
  return m;
}

// 「锁定」预览:拖牌瞄准时常驻在落点的一组网格。只改变换和颜色,不新建对象
//   drape(mesh, x, z, lift):scene 的贴地函数(平面战场时什么也不做);heightAt(x, z):地形高度
export class DeployMarker {
  constructor(drape, heightAt) {
    const T = deployTextures();
    this.drape = drape;
    this.heightAt = heightAt;
    this.beamColor = new THREE.Color();
    this.group = new THREE.Group();
    this.group.visible = false;
    this.base = groundPlane(T.base.clone(), 5);
    this.runes = groundPlane(T.runes.steel.clone(), 5);
    this.cross = groundPlane(T.cross, 6, 1);
    this.pulse = groundPlane(T.pulse, 5);
    const bg = new THREE.CylinderGeometry(0.035, 0.035, LOCK_H, 8, 1, true);
    bg.translate(0, LOCK_H / 2, 0);
    this.beam = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ map: T.beam, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.cross, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glint.position.y = LOCK_H;
    this.glint.scale.setScalar(0.28);
    this.beam.add(this.glint);
    this.beam.renderOrder = 6;
    this.group.add(this.base, this.runes, this.cross, this.pulse, this.beam);
    this.time = 0;
    this.state = null;
    this.at = { x: NaN, z: NaN, r: 0 };   // 上次贴地时的位置 / 半径
  }

  // x, z 落点;radius 部署半径;faction 势力 id;color 势力色;state:'ok' 合法 / 'snap' 合法且被吸附到附近空位 / 'rift' 裂隙内 / 'bad' 不合法
  set({ x, z, radius, faction, color = 0x5ac8ff, state }) {
    this.group.visible = true;
    this.state = state;
    const f = RUNES[faction] ? faction : 'steel', T = deployTextures();
    if (this.runes.material.map.source !== T.runes[f].source) {   // 换了势力:换一张符文贴图(克隆只共享图像,不重新上传)
      this.runes.material.map = T.runes[f].clone();
      this.runes.material.needsUpdate = true;
    }
    const col = state === 'bad' ? BAD : state === 'rift' ? RIFT : state === 'snap' ? SNAP : null;
    this.base.material.color.setHex(col ?? 0xbfefff);
    this.runes.material.color.setHex(col ?? color);
    this.cross.material.color.setHex(col ?? 0xffffff);
    this.pulse.material.color.setHex(col ?? color);
    if (col) this.beam.material.color.setHex(col);
    else this.beam.material.color.copy(this.beamColor.setHex(color).lerp(WHITE, 0.5));   // 光束偏白:势力色太深时在眼镜里看不清
    this.glint.material.color.copy(this.beam.material.color);
    this.base.material.opacity = state === 'bad' ? 1 : 0.85;
    this.beam.visible = this.pulse.visible = state !== 'bad';
    const r = Math.max(0.3, radius);
    this.base.scale.setScalar(r);
    this.runes.scale.setScalar(r * 0.82);
    this.cross.scale.setScalar(0.28);
    for (const m of [this.base, this.runes, this.cross, this.pulse, this.beam]) { m.position.x = x; m.position.z = z; }
    // 贴地:平面战场时只抬一点高度;起伏地形逐顶点贴(位置 / 半径变了才重算)
    const moved = this.at.x !== x || this.at.z !== z || this.at.r !== r;
    this.at = { x, z, r };
    if (moved) {
      this.base.position.y = 0.03; this.runes.position.y = 0.035; this.cross.position.y = 0.04;
      this.drape(this.base, x, z, 0.06);
      this.drape(this.runes, x, z, 0.065);
      this.drape(this.cross, x, z, 0.07);
      this.beam.position.y = this.heightAt(x, z);
    }
  }

  hide() { this.group.visible = false; }

  // 每帧:外圈慢转、符文反转、脉冲收缩、光束呼吸。不合法时符文停转
  update(dt) {
    if (!this.group.visible) return;
    this.time += dt;
    const ok = this.state !== 'bad';
    this.base.material.map.rotation += dt * 0.25;
    if (ok) this.runes.material.map.rotation -= dt * 0.6;
    if (ok) {
      const k = (this.time % PULSE_PERIOD) / PULSE_PERIOD, r = this.at.r * (1.12 - 0.72 * k);
      this.pulse.scale.setScalar(Math.max(0.05, r));
      this.pulse.material.opacity = Math.sin(k * Math.PI) * 0.9;
      this.pulse.position.y = 0.045;
      this.drape(this.pulse, this.at.x, this.at.z, 0.075);
      const breath = 0.55 + 0.25 * Math.sin(this.time * 7) + 0.1 * Math.sin(this.time * 23);
      this.beam.material.opacity = breath;
      this.glint.material.opacity = breath;
      this.glint.material.rotation = this.time * 1.5;
    }
  }
}

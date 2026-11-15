// 特效系统 — 粒子池 + 效果元件 + 弹道(纯渲染层,不影响对局逻辑)
//   · 粒子:发光粒子(加法混合,AR 眼镜里更亮)和烟尘(普通混合)各一个大缓冲,每种只占一次绘制;总量有上限
//   · 元件:扩散环、光柱、护盾罩、刀光、闪光、闪电、地面法阵 —— 都挂在战场根节点下,随战场缩放(XR 里也正确)
//   · 贴图全部用 canvas 现画,不需要额外美术资源
import * as THREE from 'three';

const MAX_GLOW = 2400, MAX_SMOKE = 600;

// ── 现画的贴图 ──
function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let TEX = null;
function textures() {
  if (TEX) return TEX;
  TEX = {
    glow: canvasTex(64, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.75)');
      r.addColorStop(0.6, 'rgba(255,255,255,0.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, s, s);
    }),
    smoke: canvasTex(64, (g, s) => {
      for (let i = 0; i < 7; i++) {   // 几团叠起来的软圆,边缘不规则
        const x = s / 2 + (Math.random() - 0.5) * s * 0.3, y = s / 2 + (Math.random() - 0.5) * s * 0.3;
        const r = g.createRadialGradient(x, y, 0, x, y, s * 0.32);
        r.addColorStop(0, 'rgba(255,255,255,0.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = r; g.fillRect(0, 0, s, s);
      }
    }),
    ring: canvasTex(128, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, s * 0.36, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.55, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, s, s);
    }),
    slash: canvasTex(128, (g, s) => {   // 一道月牙形刀光
      g.translate(s / 2, s / 2);
      for (let i = 0; i < 14; i++) {
        g.strokeStyle = `rgba(255,255,255,${0.08 + i * 0.06})`;
        g.lineWidth = 14 - i * 0.9;
        g.beginPath(); g.arc(0, 0, s * 0.36, -2.3 + i * 0.03, -0.5 - i * 0.02); g.stroke();
      }
    }),
    sigil: canvasTex(256, (g, s) => {   // 地面法阵:两圈 + 星形 + 刻度
      g.translate(s / 2, s / 2);
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 6; g.beginPath(); g.arc(0, 0, s * 0.46, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.arc(0, 0, s * 0.36, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 4; g.beginPath();
      for (let i = 0; i <= 5; i++) { const a = i * Math.PI * 4 / 5 - Math.PI / 2; g.lineTo(Math.cos(a) * s * 0.34, Math.sin(a) * s * 0.34); }
      g.stroke();
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2;
        g.beginPath(); g.moveTo(Math.cos(a) * s * 0.4, Math.sin(a) * s * 0.4); g.lineTo(Math.cos(a) * s * 0.45, Math.sin(a) * s * 0.45); g.stroke();
      }
    }),
  };
  return TEX;
}

// ── 粒子池 ──
class ParticlePool {
  constructor(max, tex, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('color', this.aCol);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.setDrawRange(0, 0);
    this.uniforms = { map: { value: tex }, uScale: { value: 400 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 color;
        varying vec3 vCol; varying float vA; uniform float uScale;
        void main() { vCol = color; vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.001, -mv.z);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vCol; varying float vA;
        void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vCol * t.rgb, t.a * vA); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 7 : 6;
  }

  emit(x, y, z, vx, vy, vz, color, size, life, { grav = 0, drag = 0, grow = 0, alpha = 1 } = {}) {
    if (this.n >= this.max) return;   // 满了直接丢弃(宁可少几颗,也不掉帧)
    const i = this.n++, i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow; this.alpha0[i] = alpha; this.alpha[i] = alpha;
  }

  update(dt) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      const i3 = i * 3, o3 = w * 3, k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= k; this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt; this.vel[i3 + 2] *= k;
      this.pos[o3] = this.pos[i3] + this.vel[i3] * dt;
      this.pos[o3 + 1] = this.pos[i3 + 1] + this.vel[i3 + 1] * dt;
      this.pos[o3 + 2] = this.pos[i3 + 2] + this.vel[i3 + 2] * dt;
      if (w !== i) {   // 压缩:把活着的粒子往前挪
        this.vel[o3] = this.vel[i3]; this.vel[o3 + 1] = this.vel[i3 + 1]; this.vel[o3 + 2] = this.vel[i3 + 2];
        this.col[o3] = this.col[i3]; this.col[o3 + 1] = this.col[i3 + 1]; this.col[o3 + 2] = this.col[i3 + 2];
        this.maxLife[w] = this.maxLife[i]; this.grav[w] = this.grav[i]; this.drag[w] = this.drag[i];
        this.grow[w] = this.grow[i]; this.alpha0[w] = this.alpha0[i]; this.size[w] = this.size[i];
      }
      this.life[w] = life;
      this.size[w] += this.grow[w] * dt;
      const t = life / this.maxLife[w];
      this.alpha[w] = this.alpha0[w] * Math.min(1, t * 2.2);   // 后半段淡出
      w++;
    }
    this.n = w;
    this.points.geometry.setDrawRange(0, w);
    for (const a of [this.aPos, this.aCol, this.aSize, this.aAlpha]) { a.needsUpdate = true; a.addUpdateRange?.(0, w * a.itemSize); }
  }
}

const C = c => (c instanceof THREE.Color ? c : new THREE.Color(c));
const rnd = (a, b) => a + Math.random() * (b - a);

// 弹道样式:按发射单位逐个定制(和角色的武器对应);塔按所属势力
//   kind:shell 炮弹 / tracer 曳光 / laser 瞬间激光 / needle 光针 / plasma 等离子 / arc 闪电 / rail 轨道炮 / acid 酸液 / soul 魂火 / fel 魔焰
//   impact:命中效果(blast 爆炸 / spark 火花 / acid 酸液飞溅 / soul 魂火 + 吸血回流 / fel 魔焰爆燃)
const UNIT_SHOTS = {
  steel_artillery: { kind: 'shell', color: 0xffa040, speed: 6, size: 0.3, arc: 0.9, impact: 'blast' },
  steel_turret: { kind: 'tracer', color: 0xffc060, speed: 15, size: 0.14, twin: true, impact: 'spark' },
  mecha_drone: { kind: 'laser', color: 0x5af0ff, width: 0.025, impact: 'spark' },
  mecha_swarmdrone: { kind: 'needle', color: 0x8af8ff, speed: 16, size: 0.09, twin: true, impact: 'spark' },
  mecha_sentry: { kind: 'plasma', color: 0x5af0ff, speed: 10, size: 0.22, impact: 'spark' },
  mecha_arc: { kind: 'arc', color: 0x8af0ff, impact: 'spark' },
  mecha_sniper: { kind: 'rail', color: 0x5af0ff, impact: 'spark' },
  swarm_spitter: { kind: 'acid', color: 0x9cff4a, speed: 6.5, size: 0.28, arc: 0.6, impact: 'acid' },
  chaos_soulreaver: { kind: 'soul', color: 0x6affb0, speed: 7, size: 0.26, arc: 0.15, impact: 'soul' },
};
const TOWER_SHOTS = {
  steel: { kind: 'tracer', color: 0xffc060, speed: 14, size: 0.2, impact: 'spark' },
  mecha: { kind: 'laser', color: 0x5af0ff, width: 0.05, impact: 'spark' },
  swarm: { kind: 'acid', color: 0x9cff4a, speed: 7, size: 0.3, arc: 0.5, impact: 'acid' },
  chaos: { kind: 'fel', color: 0x6aff6a, speed: 7.5, size: 0.3, arc: 0.25, impact: 'fel' },
};
function projectileStyle(from, faction) {
  const c = from.card;
  if (!c) return TOWER_SHOTS[faction] ?? { kind: 'tracer', color: 0xffe08a, speed: 12, size: 0.2, impact: 'spark' };
  if (UNIT_SHOTS[c.id]) return UNIT_SHOTS[c.id];
  switch (c.faction) {   // 没单独定制的远程单位:按势力兜底
    case 'steel': return { kind: 'tracer', color: 0xffb050, speed: 14, size: 0.16, impact: 'spark' };
    case 'mecha': return { kind: 'plasma', color: 0x5af0ff, speed: 11, size: 0.2, impact: 'spark' };
    case 'swarm': return { kind: 'acid', color: 0x9cff4a, speed: 7, size: 0.24, arc: 0.45, impact: 'acid' };
    default: return { kind: 'soul', color: 0x5aff9a, speed: 7.5, size: 0.26, arc: 0.2, impact: 'soul' };
  }
}

// 近战:按单位 / 势力区分。heavy 重击(碎石 + 冲击环)、claw 三道爪痕、bite 咬合、slash 刀光
const MELEE = {
  steel: { color: 0xfff0c0, style: 'slash' }, mecha: { color: 0x5af0ff, style: 'slash' },
  swarm: { color: 0xc8ff6a, style: 'claw' }, chaos: { color: 0xb070ff, style: 'slash', wisps: 0x6affb0 },
};
const MELEE_UNIT = {
  steel_tank: { color: 0xffc060, style: 'heavy' }, steel_siege: { color: 0xffa040, style: 'heavy' },
  mecha_walker: { color: 0x5af0ff, style: 'heavy' },
  swarm_devourer: { color: 0xc070ff, style: 'bite' },
  chaos_construct: { color: 0x9a5aff, style: 'heavy', wisps: 0x6affb0 },
};

export class VFX {
  constructor(world, heightAt) {
    this.world = world;
    this.heightAt = heightAt;
    const T = textures();
    this.glow = new ParticlePool(MAX_GLOW, T.glow, true);
    this.smoke = new ParticlePool(MAX_SMOKE, T.smoke, false);
    world.add(this.glow.points, this.smoke.points);
    this.items = [];        // 元件:{ obj, life, maxLife, update(k, dt) }
    this.projectiles = [];
    this.timers = [];       // 延迟 / 持续发射:{ t, every, left, fn }
  }

  // 每帧:像素缩放跟着相机和战场缩放走(XR 里战场缩小,粒子也要一起缩)
  update(dt, camera, renderer) {
    const h = renderer.getSize(new THREE.Vector2()).y || 600;
    const fov = camera.isPerspectiveCamera ? camera.fov : 55;
    // ×1.7:俯视桌面距离下粒子太小看不清,整体放大(XR 里战场缩小后同样按比例)
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)) * this.world.scale.x * 1.7;
    this.glow.uniforms.uScale.value = this.smoke.uniforms.uScale.value = scale;

    for (const t of this.timers) {
      t.t -= dt;
      while (t.t <= 0 && t.left > 0) { t.fn(); t.left--; t.t += t.every; }
    }
    this.timers = this.timers.filter(t => t.left > 0);

    for (const p of this.projectiles) this.stepProjectile(p, dt);
    this.projectiles = this.projectiles.filter(p => !p.done);

    for (const it of this.items) {
      it.life -= dt;
      it.update(Math.max(0, it.life / it.maxLife), dt);
      if (it.life <= 0) { it.obj.parent?.remove(it.obj); it.obj.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
    }
    this.items = this.items.filter(it => it.life > 0);
    this.glow.update(dt);
    this.smoke.update(dt);
  }

  // 定时重复:every 秒一次,共 times 次(第一次在 delay 之后)
  repeat(times, every, fn, delay = 0) { this.timers.push({ t: delay, every, left: times, fn }); }
  later(delay, fn) { this.repeat(1, 0, fn, delay); }
  gy(x, z) { return this.heightAt(x, z); }

  // ── 粒子组合 ──
  sparks(x, y, z, color, n = 14, speed = 2.4, size = 0.12, life = 0.45) {
    const c = C(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = rnd(0.1, 1), s = speed * rnd(0.4, 1);
      this.glow.emit(x, y, z, Math.cos(a) * s * (1 - e * 0.5), e * s, Math.sin(a) * s * (1 - e * 0.5), c, size * rnd(0.6, 1.2), life * rnd(0.6, 1.2), { grav: 5, drag: 1.5 });
    }
  }
  puff(x, y, z, color = 0xb8b4ae, n = 6, size = 0.45, life = 1.0, rise = 0.6) {
    const c = C(color);
    for (let i = 0; i < n; i++) {
      this.smoke.emit(x + rnd(-0.15, 0.15), y + rnd(0, 0.15), z + rnd(-0.15, 0.15), rnd(-0.25, 0.25), rise * rnd(0.5, 1), rnd(-0.25, 0.25),
        c, size * rnd(0.6, 1.1), life * rnd(0.7, 1.2), { drag: 1.2, grow: size * 0.9, alpha: 0.55 });
    }
  }
  rise(x, z, color, n = 16, radius = 0.4, height = 0.9, size = 0.13) {   // 从地面往上飘的光点(治疗 / 强化 / 进化)
    const c = C(color), y0 = this.gy(x, z);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = radius * Math.sqrt(Math.random());
      this.glow.emit(x + Math.cos(a) * r, y0 + rnd(0, 0.3), z + Math.sin(a) * r, 0, height * rnd(0.8, 1.4), 0, c, size * rnd(0.7, 1.2), rnd(0.6, 1.0), { drag: 0.6 });
    }
  }
  spiral(x, z, color, height = 1.4, turns = 2, n = 30, radius = 0.45) {   // 盘旋上升的光带
    const c = C(color), y0 = this.gy(x, z);
    for (let i = 0; i < n; i++) {
      const t = i / n, a = t * turns * Math.PI * 2;
      this.later(t * 0.5, () => this.glow.emit(x + Math.cos(a) * radius, y0 + t * height, z + Math.sin(a) * radius, 0, 0.3, 0, c, 0.16, 0.6));
    }
  }
  debris(x, y, z, color, n = 10, speed = 3) {   // 飞溅的碎块(普通混合,有重力)
    const c = C(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * rnd(0.5, 1);
      this.smoke.emit(x, y, z, Math.cos(a) * s * 0.6, s * rnd(0.6, 1.2), Math.sin(a) * s * 0.6, c, rnd(0.08, 0.16), rnd(0.7, 1.1), { grav: 9, alpha: 1 });
    }
  }

  // ── 元件 ──
  add(obj, life, update) { this.world.add(obj); this.items.push({ obj, life, maxLife: life, update }); return obj; }

  ring(x, z, r0, r1, color, life = 0.5, opacity = 0.9, lift = 0.06) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: textures().ring, color: C(color),
      transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, this.gy(x, z) + lift, z);
    return this.add(m, life, k => { const r = r1 + (r0 - r1) * k; m.scale.setScalar(Math.max(0.01, r)); m.material.opacity = opacity * k; });
  }
  flash(x, y, z, color, size = 0.6, life = 0.15) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures().glow, color: C(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.set(x, y, z);
    return this.add(s, life, k => { s.scale.setScalar(size * (0.6 + 0.6 * (1 - k))); s.material.opacity = k; });
  }
  beam(x, z, color, life = 0.6, height = 6, width = 0.35, y0 = null) {   // 竖直光柱(轨道炮击 / 出场 / 空投)
    const g = new THREE.CylinderGeometry(width, width * 0.6, height, 12, 1, true);
    g.translate(0, height / 2, 0);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: C(color), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.position.set(x, y0 ?? this.gy(x, z), z);
    return this.add(m, life, k => { m.material.opacity = 0.8 * k; m.scale.set(0.4 + 0.6 * k, 1, 0.4 + 0.6 * k); });
  }
  dome(x, z, r, color, life = 1.2) {   // 护盾罩
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: C(color), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, wireframe: false }));
    m.position.set(x, this.gy(x, z), z);
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshBasicMaterial({ color: C(color), wireframe: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    wire.scale.y = 1; m.add(wire);
    return this.add(m, life, k => {
      const grow = Math.min(1, (1 - k) * 6);
      m.scale.setScalar(0.3 + 0.7 * grow);
      m.material.opacity = 0.35 * Math.min(1, k * 3);
      wire.material.opacity = 0.5 * Math.min(1, k * 3);
      wire.rotation.y += 0.02;
    });
  }
  slash(x, y, z, color, size = 0.8) {   // 近战刀光
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures().slash, color: C(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, rotation: Math.random() * Math.PI * 2 }));
    s.position.set(x, y, z);
    return this.add(s, 0.18, k => { s.scale.setScalar(size * (0.7 + 0.5 * (1 - k))); s.material.opacity = k; });
  }
  sigil(x, z, r, color, life = 2, spin = 0.6) {   // 地面法阵(诅咒 / 黑客)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, 2 * r), new THREE.MeshBasicMaterial({ map: textures().sigil, color: C(color),
      transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, this.gy(x, z) + 0.07, z);
    return this.add(m, life, (k, dt) => { m.rotation.z += spin * dt; m.material.opacity = 0.85 * Math.min(1, k * 4, (1 - k) * 8 + 0.2); });
  }
  bolt(points, color, life = 0.25) {   // 闪电:多条抖动的折线叠在一起 + 节点闪光
    const grp = new THREE.Group(), c = C(color);
    for (let layer = 0; layer < 3; layer++) {
      const pts = [];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        for (let s = 0; s < 6; s++) {
          const t = s / 6, j = s === 0 ? 0 : 0.12;
          pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t + rnd(-j, j), a.y + (b.y - a.y) * t + rnd(-j, j), a.z + (b.z - a.z) * t + rnd(-j, j)));
        }
      }
      const last = points[points.length - 1];
      pts.push(new THREE.Vector3(last.x, last.y, last.z));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: layer ? c : 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
      grp.add(line);
    }
    for (const p of points) this.flash(p.x, p.y, p.z, c, 0.45, life);
    return this.add(grp, life, k => grp.children.forEach(l => { l.material.opacity = k; }));
  }

  // ── 弹道 ──
  // faction:发射方势力(塔没有卡牌,按势力选样式)
  projectile(from, to, fromPos, toPos, faction) {
    const st = projectileStyle(from, faction);
    const c = C(st.color);
    if (st.kind === 'rail') {   // 轨道炮:瞬间一道光 + 残留的细光痕
      this.bolt([fromPos, toPos], st.color, 0.18);
      this.beamLine(fromPos, toPos, st.color, 0.35, 0.03);
      this.flash(fromPos.x, fromPos.y, fromPos.z, st.color, 0.55, 0.1);
      this.impact(toPos, st, from, fromPos);
      return;
    }
    if (st.kind === 'laser') {  // 激光:瞬间命中的光束
      this.beamLine(fromPos, toPos, st.color, 0.14, st.width);
      this.flash(fromPos.x, fromPos.y, fromPos.z, st.color, 0.3, 0.08);
      this.impact(toPos, st, from, fromPos);
      return;
    }
    if (st.kind === 'arc') {    // 电弧:锯齿闪电从发射者劈到目标
      const mid = fromPos.clone().lerp(toPos, 0.5); mid.y += 0.25;
      this.bolt([fromPos, mid, toPos], st.color, 0.2);
      this.sparks(fromPos.x, fromPos.y, fromPos.z, st.color, 4, 1.2, 0.07, 0.2);
      this.impact(toPos, st, from, fromPos);
      return;
    }
    const shots = st.twin ? [-1, 1] : [0];   // 双联:左右两发,稍微错开
    const side = new THREE.Vector3().subVectors(toPos, fromPos).cross(new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.1);
    shots.forEach((k, i) => {
      const a = fromPos.clone().addScaledVector(side, k), b = toPos.clone().addScaledVector(side, k * 0.4);
      this.flash(a.x, a.y, a.z, st.color, st.kind === 'shell' ? 0.7 : 0.4, 0.08);   // 枪口火光
      if (st.kind === 'shell') this.puff(a.x, a.y, a.z, 0xc8c0b8, 2, 0.25, 0.5, 0.3);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures().glow, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      core.scale.setScalar(st.size * (st.kind === 'plasma' ? 2.8 : 2.2));
      core.visible = false;
      this.world.add(core);
      this.projectiles.push({ core, a, b, t: -i * 0.06, dur: Math.max(0.08, a.distanceTo(b) / st.speed), st, from, fromPos: a, done: false, last: a.clone() });
    });
  }
  stepProjectile(p, dt) {
    p.t += dt;
    if (p.t < 0) return;   // 双联的第二发还没出膛
    p.core.visible = true;
    const k = Math.min(1, p.t / p.dur), st = p.st, c = C(st.color);
    const pos = new THREE.Vector3().lerpVectors(p.a, p.b, k);
    pos.y += Math.sin(k * Math.PI) * (st.arc || 0) * p.a.distanceTo(p.b) * 0.35;
    if (st.kind === 'soul') { const a = p.t * 18; pos.x += Math.cos(a) * 0.08; pos.z += Math.sin(a) * 0.08; pos.y += Math.sin(a * 0.7) * 0.04; }   // 魂火螺旋着飞
    p.core.position.copy(pos);
    switch (st.kind) {   // 拖尾:按弹种区分
      case 'tracer': case 'needle':   // 曳光 / 光针:沿飞行方向拉出一串亮点
        for (let i = 1; i <= 3; i++) {
          const q = p.last.clone().lerp(pos, i / 3);
          this.glow.emit(q.x, q.y, q.z, 0, 0, 0, c, st.size * (0.5 + i * 0.15), 0.08);
        }
        break;
      case 'shell':
        this.glow.emit(pos.x, pos.y, pos.z, rnd(-0.2, 0.2), rnd(-0.1, 0.2), rnd(-0.2, 0.2), c, st.size * 0.7, 0.2, { drag: 3 });
        if (Math.random() < 0.6) this.smoke.emit(pos.x, pos.y, pos.z, 0, 0.2, 0, C(0xc8c0b8), 0.18, 0.7, { grow: 0.35, alpha: 0.45 });
        break;
      case 'acid':
        this.glow.emit(pos.x, pos.y, pos.z, rnd(-0.1, 0.1), 0, rnd(-0.1, 0.1), c, st.size * 0.6, 0.22, { drag: 3 });
        if (Math.random() < 0.45) this.glow.emit(pos.x, pos.y, pos.z, 0, -0.4, 0, c, 0.08, 0.45, { grav: 6 });   // 滴落
        break;
      case 'soul':
        this.glow.emit(pos.x, pos.y, pos.z, rnd(-0.15, 0.15), rnd(0, 0.3), rnd(-0.15, 0.15), Math.random() < 0.5 ? c : C(0xb070ff), st.size * 0.6, 0.35, { drag: 2 });
        break;
      case 'fel':
        this.glow.emit(pos.x, pos.y, pos.z, rnd(-0.2, 0.2), rnd(0, 0.4), rnd(-0.2, 0.2), c, st.size * 0.8, 0.3, { drag: 2 });
        if (Math.random() < 0.5) this.smoke.emit(pos.x, pos.y, pos.z, 0, 0.3, 0, C(0x4a2060), 0.2, 0.6, { grow: 0.3, alpha: 0.5 });
        break;
      default:   // plasma
        this.glow.emit(pos.x, pos.y, pos.z, rnd(-0.15, 0.15), rnd(-0.1, 0.15), rnd(-0.15, 0.15), c, st.size * 0.8, 0.22, { drag: 3 });
    }
    p.last.copy(pos);
    if (k >= 1) {
      p.done = true;
      p.core.parent?.remove(p.core); p.core.material.dispose();
      this.impact(p.b, st, p.from, p.fromPos);
    }
  }
  // 命中效果:和弹种对应
  impact(pos, st, from, fromPos) {
    const color = st.color;
    switch (st.impact) {
      case 'blast':   // 炮弹:爆炸 + 碎石 + 烟尘 + 冲击环
        this.flash(pos.x, pos.y, pos.z, 0xffd080, 1.1, 0.22);
        this.sparks(pos.x, pos.y, pos.z, color, 20, 2.8, 0.11, 0.4);
        this.debris(pos.x, pos.y, pos.z, 0x5a5048, 8, 2.4);
        this.ring(pos.x, pos.z, 0.2, 1.0, color, 0.4);
        this.puff(pos.x, pos.y, pos.z, 0x8a8078, 5, 0.45, 1.0, 0.6);
        break;
      case 'acid':    // 酸液:飞溅 + 地上一小摊
        this.flash(pos.x, pos.y, pos.z, color, 0.6, 0.15);
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2, sp = rnd(0.6, 1.6);
          this.glow.emit(pos.x, pos.y, pos.z, Math.cos(a) * sp, rnd(0.8, 1.8), Math.sin(a) * sp, C(color), 0.09, 0.5, { grav: 7 });
        }
        this.ring(pos.x, pos.z, 0.15, 0.55, color, 0.9, 0.5);
        break;
      case 'soul': {  // 魂火:绿紫闪光 + 灵魂光点飞回发射者(表现吸血)
        this.flash(pos.x, pos.y, pos.z, color, 0.6, 0.15);
        this.sparks(pos.x, pos.y, pos.z, 0xb070ff, 6, 1.2, 0.09, 0.3);
        if (from?.card?.lifesteal && fromPos) {
          const back = new THREE.Vector3().subVectors(fromPos, pos);
          for (let i = 0; i < 6; i++) {
            const life = rnd(0.35, 0.5);
            this.glow.emit(pos.x + rnd(-0.1, 0.1), pos.y + rnd(-0.1, 0.1), pos.z + rnd(-0.1, 0.1), back.x / life, back.y / life + 0.3, back.z / life, C(0xff6a9a), 0.1, life);
          }
        }
        break;
      }
      case 'fel':     // 魔焰:绿色爆燃 + 紫烟
        this.flash(pos.x, pos.y, pos.z, color, 0.9, 0.2);
        this.sparks(pos.x, pos.y, pos.z, color, 14, 2.2, 0.12, 0.4);
        this.puff(pos.x, pos.y, pos.z, 0x4a2060, 4, 0.35, 0.9, 0.5);
        break;
      default:        // 火花
        this.flash(pos.x, pos.y, pos.z, color, 0.45, 0.12);
        this.sparks(pos.x, pos.y, pos.z, color, 8, 1.8, 0.09, 0.32);
    }
  }
  // 细光束(激光 / 轨道炮残痕):加法混合的细圆柱,快速淡出
  beamLine(a, b, color, life = 0.14, width = 0.03) {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(width, width, len, 6, 1, true),
      new THREE.MeshBasicMaterial({ color: C(color), transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
    return this.add(m, life, k => { m.material.opacity = 0.95 * k; m.scale.set(0.5 + 0.5 * k, 1, 0.5 + 0.5 * k); });
  }
  // 近战命中:刀光 / 爪痕 / 咬合 / 重击,按单位和势力区分;dir 是攻击方向(单位向量)
  melee(card, pos, dir) {
    const m = MELEE_UNIT[card?.id] ?? MELEE[card?.faction] ?? MELEE.steel;
    const { x, y, z } = pos;
    switch (m.style) {
      case 'claw':   // 三道并排的爪痕
        for (let i = -1; i <= 1; i++) {
          const ox = -dir.z * i * 0.12, oz = dir.x * i * 0.12;
          this.later(0.03 * (i + 1), () => this.slash(x + ox, y + i * 0.05, z + oz, m.color, 0.55));
        }
        this.sparks(x, y, z, m.color, 4, 1.2, 0.07, 0.25);
        break;
      case 'bite':   // 咬合:紫色闪光 + 绿色体液
        this.flash(x, y, z, m.color, 0.8, 0.16);
        this.debris(x, y, z, 0x60d040, 6, 1.6);
        break;
      case 'heavy':  // 重击:闪光 + 碎石 + 地面冲击环
        this.flash(x, y, z, m.color, 0.9, 0.18);
        this.debris(x, y - 0.2, z, 0x5a5048, 7, 2.2);
        this.ring(x, z, 0.1, 0.8, m.color, 0.35);
        this.sparks(x, y, z, m.color, 8, 2.0, 0.1, 0.3);
        break;
      default:       // 刀光
        this.slash(x, y, z, m.color, 0.75);
        this.sparks(x, y, z, m.color, 5, 1.6, 0.08, 0.25);
    }
    if (m.wisps) for (let i = 0; i < 4; i++) this.glow.emit(x, y, z, rnd(-0.2, 0.2), rnd(0.5, 1.0), rnd(-0.2, 0.2), C(m.wisps), 0.12, 0.6, { drag: 1 });
  }
}

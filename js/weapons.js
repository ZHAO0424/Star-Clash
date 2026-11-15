// 武器挂载 — 把单独生成的武器模型挂到角色的手骨上(游戏 scene.js 和预览页 viewer.html 共用)
// 挂载参数在 assets/models/models.json 各单位的 weapons 字段:
//   { id: 'steel_rifle', hand: 'R' | 'L', len: 0.55, pos: [x, y, z], rot: [x, y, z] }
//   · len:武器最长边 = 角色身高 × len
//   · pos:相对手骨的偏移,单位是"角色身高"(0.1 = 身高的 10%)
//   · rot:相对手骨的旋转(角度);不同骨架的手骨朝向不同,所以每个单位单独调
import * as THREE from 'three';

const HAND = {
  R: /^(r_hand|righthand|hand_r|right_hand|mixamorig:?righthand)$/i,   // Tripo: R_Hand;Meshy: RightHand
  L: /^(l_hand|lefthand|hand_l|left_hand|mixamorig:?lefthand)$/i,
};

export function findHand(root, side) {
  let found = null;
  root.traverse(o => { if (!found && HAND[side === 'L' ? 'L' : 'R'].test(o.name)) found = o; });
  return found;
}

const DEG = Math.PI / 180;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

// 生成一把挂好的武器(返回挂点 Group;材质是克隆的,便于受击白闪 / 死亡淡出)
// root:角色模型根节点;charH:角色在 root 空间里的身高;src:武器 glTF 的 scene
export function attachWeapon(root, charH, spec, src) {
  const bone = findHand(root, spec.hand);
  if (spec.fx === 'orb' && !src) src = makeOrb(spec.color ?? 0x60ff70);   // 程序化道具:发光能量球(自爆邪徒的爆弹)
  if (!bone || !src) return null;
  const w = src.clone(true);
  w.updateMatrixWorld(true);
  // 先按顶点分布的主轴把武器"转正"(生成的模型常是斜放的,斜放时包围盒的长边不是杆子方向)
  const axes = principalAxes(w);
  if (axes) { w.quaternion.premultiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(...axes).transpose())); w.updateMatrixWorld(true); }
  const box = new THREE.Box3().setFromObject(w);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  w.position.sub(center);   // 以武器中心为挂点,握持位置靠 pos 调
  const mats = [];
  w.traverse(o => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
    for (const m of [].concat(o.material)) mats.push(m);
    o.userData.sharedGeo = true;
  });
  const mount = new THREE.Group();
  mount.name = 'weapon:' + spec.id;
  mount.add(w);
  // 手骨相对角色根节点的缩放(Tripo 骨架常带 0.01 之类的缩放),换算成角色空间里的真实尺寸
  root.updateMatrixWorld(true);
  _m.copy(root.matrixWorld).invert().multiply(bone.matrixWorld).decompose(_p, _q, _s);
  const bs = _s.x || 1;
  mount.userData = { spec, charH, bs, longest: Math.max(size.x, size.y, size.z) || 1, size: size.clone(), mats, order: axes ? [0, 1, 2] : null };   // 转正后 x/y/z 就是主 / 次 / 第三轴
  applySpec(mount, spec);
  bone.add(mount);
  return mount;
}

// 按参数重新摆放(预览页调滑块时实时调用)
export function applySpec(mount, spec) {
  const { charH, bs, longest } = mount.userData;
  mount.userData.spec = spec;
  mount.scale.setScalar((spec.len ?? 0.5) * charH / longest / bs);
  mount.position.fromArray(spec.pos || [0, 0, 0]).multiplyScalar(charH / bs);
  mount.rotation.set(...(spec.rot || [0, 0, 0]).map(d => d * DEG));
}

// 发光能量球:实心内核 + 半透明外壳 + 加法混合的光晕(不需要模型文件,写 { id, fx: 'orb', color } 即可)
let glowTex = null;
function makeOrb(color) {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
  }
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 2), Object.assign(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, roughness: 0.4 }), { userData: { keepEmissive: true } })));
  grp.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending })));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(2.2);
  grp.add(glow);
  return grp;
}

// 自动摆正:在角色当前姿势下,算出让武器朝向合理的 rot(角度)。aim:
//   'up'      长轴竖直朝上,次轴朝角色前方(法杖 / 旗杆 / 镰刀)
//   'forward' 长轴朝角色前方,次轴朝上(枪)
//   'shield'  最薄的轴朝前(盾面向外),长轴朝上
// flip=true 时绕次轴转 180°(枪口 / 刀刃方向反了用)
export function autoAim(mount, charForward, aim = 'up', flip = false) {
  const bone = mount.parent;
  bone.updateWorldMatrix(true, false);
  const qInv = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
  const toLocal = v => v.clone().applyQuaternion(qInv).normalize();
  const up = toLocal(new THREE.Vector3(0, 1, 0)), fwd = toLocal(charForward);
  const sz = mount.userData.size.toArray();
  const order = mount.userData.order || [0, 1, 2].sort((a, b) => sz[b] - sz[a]);   // 长 / 中 / 短轴的索引
  let t1, t2, i1, i2;
  if (aim === 'shield') { i1 = order[2]; t1 = fwd; i2 = order[0]; t2 = up; }
  else if (aim === 'forward') { i1 = order[0]; t1 = fwd; i2 = order[1]; t2 = up; }
  else { i1 = order[0]; t1 = up; i2 = order[1]; t2 = fwd; }
  if (flip) t1 = t1.clone().negate();
  t2 = t2.clone().sub(t1.clone().multiplyScalar(t2.dot(t1))).normalize();   // 正交化
  const t3 = new THREE.Vector3().crossVectors(t1, t2);
  const cols = [null, null, null];
  cols[i1] = t1; cols[i2] = t2;
  const i3 = 3 - i1 - i2;
  // 保证右手系:第三轴 = 前两轴按索引顺序叉乘
  const e = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const sign = new THREE.Vector3().crossVectors(e[i1], e[i2]).dot(e[i3]);
  cols[i3] = t3.multiplyScalar(sign);
  const m = new THREE.Matrix4().makeBasis(cols[0], cols[1], cols[2]);
  const r = new THREE.Euler().setFromRotationMatrix(m);
  return [r.x, r.y, r.z].map(v => Math.round(v / DEG));
}

// 顶点主轴(PCA):返回按方差从大到小排列的三个正交单位向量(右手系),失败返回 null
function principalAxes(obj) {
  const pts = [], v = new THREE.Vector3();
  obj.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 3000));
    for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).clone());
  });
  if (pts.length < 10) return null;
  const c = new THREE.Vector3();
  pts.forEach(p => c.add(p)); c.divideScalar(pts.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j];
  }
  // 对称矩阵的 Jacobi 特征分解
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(C[p][q]) < 1e-12) continue;
      const th = 0.5 * Math.atan2(2 * C[p][q], C[q][q] - C[p][p]), cs = Math.cos(th), sn = Math.sin(th);
      for (let k = 0; k < 3; k++) {   // C = J^T C J
        const a = C[k][p], b = C[k][q];
        C[k][p] = cs * a - sn * b; C[k][q] = sn * a + cs * b;
      }
      for (let k = 0; k < 3; k++) {
        const a = C[p][k], b = C[q][k];
        C[p][k] = cs * a - sn * b; C[q][k] = sn * a + cs * b;
      }
      for (let k = 0; k < 3; k++) {
        const a = V[k][p], b = V[k][q];
        V[k][p] = cs * a - sn * b; V[k][q] = sn * a + cs * b;
      }
    }
  }
  const ev = [0, 1, 2].map(i => ({ val: C[i][i], vec: new THREE.Vector3(V[0][i], V[1][i], V[2][i]).normalize() })).sort((a, b) => b.val - a.val);
  const [a1, a2] = [ev[0].vec, ev[1].vec];
  return [a1, a2, new THREE.Vector3().crossVectors(a1, a2).normalize()];
}

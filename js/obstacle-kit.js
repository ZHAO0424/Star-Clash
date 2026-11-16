// 障碍套件渲染(地图大改样板:熔岩锻炉)— 把 obstacle-layout.js 的摆放数据变成网格
//   · 玄武岩六棱柱:全图所有柱子(墙 / 熔渣堆 / 池沿岩壳 / 边缘石柱群)一个 InstancedMesh,1 次 draw call;
//     顶面倒角 + 顶亮侧暗的顶点色,约两成柱子顶面露出熔芯(按实例 aHeat 自发光,缓慢呼吸)
//   · 熔岩河:沿控制点做平滑带状网格,流动着色器(热核 + 漂移的冷却壳 + 两岸变暗),1 次 draw call
//   · 矿车轨道:铁轨 + 枕木一个 InstancedMesh(实例色区分材质)
//   · 地标大锻炉:程序化,石 / 铁 / 熔光三种材质各合并成一个网格 + 两根烟囱的烟(Points,着色器驱动)
//   · Tripo 配景(铁砧 / 火盆 / 矿车 / 火山锥)只给摆放列表,仍由 props3d.buildProps 按入库规范实例化
//   · 眼镜是光学透视的:黑 = 透明。玄武岩用中灰(不压成黑),熔光是主要的亮部
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { volcanoLayout } from './obstacle-layout.js';
import { LOOK, applyEnv } from './render-look.js';

// 有程序化套件的场景;这些场景不再用 props3d 的区域摆放,地形 GLB 里的 Rocks / Crystals 网格也隐藏(套件替代)
const DRESSINGS = { volcano: volcanoLayout };
export const hasDressing = id => !!DRESSINGS[id];
export const HIDDEN_TERRAIN_MESHES = /^(Rocks|Crystals)/;

const SINK = 0.08;   // 柱子埋进地面的深度(地形起伏时底部不悬空)
const LAVA = new THREE.Color(1.0, 0.3, 0.05);

// 六棱柱:LatheGeometry 6 段,顶面带一圈倒角;y ∈ [0,1]、外接圆半径 1,第一个顶点在 +X
//   顶点色:顶面亮、侧面上亮下暗(假 AO,地面交界不是一刀切)
function hexColumnGeometry() {
  const prof = [[1, 0], [1, 0.95], [0.88, 1], [0, 1]].map(   // 自下而上(反过来面会朝内被剔除)
    ([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(prof, 6, Math.PI / 2).toNonIndexed();
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), top = y > 0.999;
    const k = top ? 1.22 : 0.6 + 0.4 * Math.min(1, y / 0.95);
    col.set([k, k, k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// 共享时间 uniform:熔芯呼吸、熔岩河流动、烟
function timeUniform(group) {
  const uTime = { value: 0 };
  group.userData.uTime = uTime;
  return uTime;
}

function columnsMesh(cols, heightAt, envMap, uTime) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.06, flatShading: true });
  applyEnv(mat, envMap, LOOK.propEnvIntensity);
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uLava = { value: LAVA };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHeat; varying float vHeat; varying float vTop;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = aHeat; vTop = step(0.999, position.y) * (1.0 - length(position.xz) / 0.88);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uLava; varying float vHeat; varying float vTop;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float hot = vHeat * smoothstep(0.05, 0.75, vTop);
totalEmissiveRadiance += uLava * hot * 1.35 * (0.82 + 0.18 * sin(uTime * 1.7 + vHeat * 23.0));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.1, 0.03), hot * 0.8);`);
  };
  mat.customProgramCacheKey = () => 'hexColumn1';
  const geo = hexColumnGeometry();
  const inst = new THREE.InstancedMesh(geo, mat, cols.length);
  const heat = new Float32Array(cols.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  cols.forEach((col, i) => {
    e.set(col.tilt[0], -col.rot, col.tilt[1], 'YXZ');
    q.setFromEuler(e);
    p.set(col.x, heightAt(col.x, col.z) - SINK, col.z);
    s.set(col.R, col.h + SINK, col.R);
    inst.setMatrixAt(i, m.compose(p, q, s));
    // 玄武岩:中灰偏暖,逐根轻微明暗 / 色相抖动;池沿岩壳更暖更暗(刚冷却)
    const v = 0.86 + ((i * 7919) % 97) / 97 * 0.28;
    if (col.layer === 'crust') c.setRGB(0.36 * v, 0.27 * v, 0.24 * v, THREE.SRGBColorSpace);
    else c.setRGB(0.38 * v, 0.35 * v, 0.34 * v, THREE.SRGBColorSpace);
    inst.setColorAt(i, c);
    heat[i] = col.heat;
  });
  geo.setAttribute('aHeat', new THREE.InstancedBufferAttribute(heat, 1));
  inst.instanceMatrix.needsUpdate = true;
  inst.instanceColor.needsUpdate = true;
  inst.computeBoundingSphere();
  inst.castShadow = inst.receiveShadow = true;
  inst.name = 'hexColumns';
  return inst;
}

// ── 熔岩河 ──
const LAVA_GLSL = /* glsl */`
float lHash(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float lNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lHash(i), lHash(i + vec2(1, 0)), u.x), mix(lHash(i + vec2(0, 1)), lHash(i + vec2(1, 1)), u.x), u.y);
}
float lFbm(vec2 p) { return lNoise(p) * 0.55 + lNoise(p * 2.1 + 3.3) * 0.3 + lNoise(p * 4.3 + 7.7) * 0.15; }
`;
function riverMesh(paths, width, uTime) {
  const geos = paths.map(path => {
    const curve = new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const N = 260, len = curve.getLength(), pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, p = curve.getPointAt(t), d = curve.getTangentAt(t);
      const taper = Math.min(1, t / 0.06) * 0.85 + 0.15, w = width / 2 * taper * (0.85 + 0.15 * Math.sin(t * 37.0));
      for (const sd of [-1, 1]) {
        pos.push(p.x - d.z * w * sd, -0.032, p.z + d.x * w * sd);
        uv.push(t * len / width, sd < 0 ? 0 : 1);
      }
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime },
    vertexShader: /* glsl */`varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime; varying vec2 vUv;
${LAVA_GLSL}
void main() {
  vec2 p = vec2(vUv.x * 0.9 - uTime * 0.35, vUv.y * 1.6);
  float n = lFbm(p * vec2(1.0, 1.4));
  float crust = smoothstep(0.56, 0.72, lFbm(vec2(vUv.x * 0.55 - uTime * 0.22, vUv.y * 2.2 + 4.0)));
  float bank = smoothstep(0.0, 0.32, vUv.y) * smoothstep(1.0, 0.68, vUv.y);
  vec3 hot = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.78, 0.32), smoothstep(0.45, 0.8, n));
  vec3 crustC = vec3(0.32, 0.1, 0.05);
  vec3 c = mix(crustC, hot * 1.6, bank * (1.0 - crust * 0.85));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
  mesh.name = 'lavaRiver';
  mesh.frustumCulled = false;   // 它负责每帧推进共享时间,不能被裁掉
  mesh.onBeforeRender = () => { uTime.value = performance.now() / 1000; };
  return mesh;
}

// ── 矿车轨道:两根铁轨 + 枕木 ──
function railsMesh(rails, envMap) {
  const boxes = [];
  for (const r of rails) {
    const len = r.z2 - r.z1, cz = (r.z1 + r.z2) / 2;
    for (const sd of [-1, 1]) boxes.push({ x: r.x + sd * 0.065, z: cz, sx: 0.022, sy: 0.03, sz: len, y: -0.02, metal: true });
    for (let z = r.z1 + 0.05; z < r.z2; z += 0.13) boxes.push({ x: r.x, z, sx: 0.2, sy: 0.022, sz: 0.045, y: -0.045, metal: false });
  }
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.35 });
  applyEnv(mat, envMap, LOOK.propEnvIntensity);
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, boxes.length);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  boxes.forEach((b, i) => {
    inst.setMatrixAt(i, m.makeScale(b.sx, b.sy, b.sz).setPosition(b.x, b.y, b.z));
    inst.setColorAt(i, b.metal ? c.setRGB(0.62, 0.6, 0.58, THREE.SRGBColorSpace) : c.setRGB(0.42, 0.3, 0.22, THREE.SRGBColorSpace));
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.instanceColor.needsUpdate = true;
  inst.computeBoundingSphere();
  inst.receiveShadow = true;
  inst.name = 'rails';
  return inst;
}

// ── 地标:大锻炉(敌方后方台面边缘,炉口朝向战场)──
//   八角收分炉身 + 炉罩 + 两侧六角窑 + 两根烟囱 + 铁箍;炉口、窑口、烟囱口发光;烟由 Points 着色器驱动
function forgeGroup(f, heightAt, envMap, uTime) {
  const g = new THREE.Group();
  g.name = 'forge';
  const stone = [], metal = [], glow = [];
  const at = (geo, x, y, z, ry = 0) => geo.rotateY(ry).translate(x, y, z);
  // 台基两级 + 炉身 + 炉罩
  stone.push(at(new THREE.BoxGeometry(2.5, 0.14, 1.1), 0, 0.07, 0));
  stone.push(at(new THREE.BoxGeometry(1.9, 0.1, 0.9), 0, 0.19, -0.04));
  stone.push(at(new THREE.CylinderGeometry(0.44, 0.62, 0.86, 8), 0, 0.67, -0.08, Math.PI / 8));
  stone.push(at(new THREE.CylinderGeometry(0.26, 0.46, 0.2, 8), 0, 1.2, -0.08, Math.PI / 8));
  stone.push(at(new THREE.CylinderGeometry(0.16, 0.2, 0.28, 6), 0, 1.44, -0.08));
  // 两侧六角窑(和墙的六棱柱同一语言)+ 烟囱
  for (const sx of [-1, 1]) {
    stone.push(at(new THREE.CylinderGeometry(0.27, 0.33, 0.5, 6), sx * 0.86, 0.49, -0.05));
    stone.push(at(new THREE.CylinderGeometry(0.2, 0.28, 0.12, 6), sx * 0.86, 0.8, -0.05));
    stone.push(at(new THREE.CylinderGeometry(0.085, 0.12, 0.95, 6), sx * 0.86, 1.3, -0.12));
    metal.push(at(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 6), sx * 0.86, 1.76, -0.12));
    glow.push(at(new THREE.CircleGeometry(0.075, 6).rotateX(-Math.PI / 2), sx * 0.86, 1.792, -0.12));
    glow.push(at(new THREE.PlaneGeometry(0.2, 0.16), sx * 0.86, 0.42, 0.275));   // 窑口
    metal.push(at(new THREE.BoxGeometry(0.22, 0.03, 0.04), sx * 0.86, 0.5, 0.28));
  }
  // 铁箍
  for (const [y, r] of [[0.4, 0.6], [0.92, 0.5]]) metal.push(at(new THREE.TorusGeometry(r, 0.028, 4, 8).rotateX(Math.PI / 2), 0, y, -0.08, Math.PI / 8));
  // 炉口:拱形铁框 + 发光内壁 + 熔岩舌(流向前方的熔岩河)
  metal.push(at(new THREE.TorusGeometry(0.27, 0.045, 4, 10, Math.PI), 0, 0.52, 0.5));
  glow.push(at(new THREE.CircleGeometry(0.26, 10, 0, Math.PI), 0, 0.52, 0.485));
  glow.push(at(new THREE.PlaneGeometry(0.52, 0.28), 0, 0.38, 0.485));
  glow.push(at(new THREE.PlaneGeometry(0.34, 0.6).rotateX(-Math.PI / 2), 0, 0.21, 0.78));
  // 炉身熔缝:两圈发光细环 + 炉罩下沿一圈,炉子"烧着"的读感
  for (const [y, r] of [[0.66, 0.555], [1.1, 0.462]]) glow.push(at(new THREE.TorusGeometry(r, 0.014, 3, 8).rotateX(Math.PI / 2), 0, y, -0.08, Math.PI / 8));
  const stoneMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.4, 0.34, 0.31, THREE.SRGBColorSpace), roughness: 0.9, flatShading: true });
  const metalMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.5, 0.46, 0.43, THREE.SRGBColorSpace), roughness: 0.42, metalness: 0.75 });
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.16).multiplyScalar(1.6), side: THREE.DoubleSide });
  applyEnv(stoneMat, envMap, LOOK.propEnvIntensity);
  applyEnv(metalMat, envMap, LOOK.envIntensity);
  for (const [list, mat, shadow] of [[stone, stoneMat, true], [metal, metalMat, true], [glow, glowMat, false]]) {
    const mesh = new THREE.Mesh(mergeGeometries(list), mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    g.add(mesh);
  }
  g.add(smokePoints([[-0.86, 1.8, -0.12], [0.86, 1.8, -0.12], [0, 1.6, -0.08]], uTime));
  g.position.set(f.x, Math.min(heightAt(f.x, f.z), -0.05), f.z);
  g.scale.setScalar(f.scale ?? 1);
  return g;
}

// 烟:每个烟口 14 个粒子,位置 / 大小 / 透明度全在着色器里按时间算(不占 CPU)
function smokePoints(vents, uTime) {
  const pos = [], seed = [];
  vents.forEach(([x, y, z], vi) => {
    for (let i = 0; i < 14; i++) { pos.push(x, y, z); seed.push(i / 14 + vi * 0.37); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime, uScale: { value: 420 } },
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`attribute float aSeed; uniform float uTime; uniform float uScale; varying float vA;
void main() {
  float t = fract(uTime * 0.12 + aSeed);
  vec3 p = position + vec3(sin(aSeed * 40.0 + t * 3.0) * 0.12 * t, t * 1.1, -0.35 * t * t);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.12 + t * 0.42) * uScale / -mv.z;
  vA = smoothstep(0.0, 0.12, t) * (1.0 - t) * 0.42;
}`,
    fragmentShader: /* glsl */`varying float vA;
void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vec3(0.62, 0.56, 0.54), vA * (1.0 - d * 2.0)); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.name = 'forgeSmoke';
  return pts;
}

// 入口:返回 { group(柱子 / 熔岩河 / 轨道 / 锻炉), props(交给 props3d.buildProps 的 Tripo 配景摆放列表) }
export function buildDressing(sceneId, { map, heightAt, envMap }) {
  const layout = DRESSINGS[sceneId](map);
  const group = new THREE.Group();
  group.name = 'obstacleKit';
  const uTime = timeUniform(group);
  group.add(columnsMesh(layout.columns, heightAt, envMap, uTime));
  group.add(riverMesh(layout.rivers, layout.riverWidth, uTime));
  group.add(railsMesh(layout.rails, envMap));
  group.add(forgeGroup(layout.forge, heightAt, envMap, uTime));
  return { group, props: layout.props };
}

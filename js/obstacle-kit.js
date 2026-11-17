// 障碍套件渲染(地图大改样板:熔岩锻炉)— 把 obstacle-layout.js 的摆放数据变成网格
//   · 玄武岩六棱柱(墙 / 熔渣堆)一个 InstancedMesh,1 次 draw call;
//     顶面倒角 + 顶亮侧暗的顶点色,约两成柱子顶面露出熔芯(按实例 aHeat 自发光,缓慢呼吸)
//   · 切割六棱柱(第三轮):台地、河床、场内熔岩河两岸、冷却岩桥、祭坛台 = 一整片蜂窝柱被边界平面切开,合并成 1 个网格
//   · 熔岩河:边河 + 场内横贯河,沿控制点做平滑带状网格,流动着色器(流向 + 亮核 + 漂移的冷却壳 + 两岸变暗),1 次 draw call;
//     场内河道上方一层加色热光(热浪)+ 沿河上升的火星(Points),各 1 次 draw call
//   · 矿车轨道:铁轨 + 枕木一个 InstancedMesh(实例色区分材质)
//   · 地标大锻炉:程序化,石 / 铁 / 熔光三种材质各合并成一个网格 + 两根烟囱的烟(Points,着色器驱动)
//   · Tripo 配景(铁砧 / 火盆 / 矿车 / 火山锥)只给摆放列表,仍由 props3d.buildProps 按入库规范实例化
//   · 眼镜是光学透视的:黑 = 透明。玄武岩用中灰(不压成黑),熔光是主要的亮部
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { volcanoLayout, starcoreLayout, glacierLayout, terraceTop, fieldHeight, FLOOR } from './obstacle-layout.js';
import { ARENA } from './arena-dims.js';
import { LOOK, applyEnv } from './render-look.js';

// 有程序化套件的场景;这些场景不再用 props3d 的区域摆放,地形 GLB 里的 Rocks / Crystals 网格也隐藏(套件替代)
const DRESSINGS = { volcano: volcanoLayout, starcore: starcoreLayout, glacier: glacierLayout };
export const hasDressing = id => !!DRESSINGS[id];
export const HIDDEN_TERRAIN_MESHES = /^(Rocks|Crystals)/;

const SINK = 0.08;   // 柱子埋进地面的深度(地形起伏时底部不悬空)
const LAVA = new THREE.Color(1.0, 0.3, 0.05);
// 主题配色(sRGB 基色;眼镜里黑 = 透明,台地和墙都保持中高亮度):
//   wall / crust:墙柱 / 池沿柱;glow:柱顶熔光 / 晶光 / 冰光的颜色(线性);hotBase:发光柱顶的底色;
//   kinds:切割柱各级台地的柱顶色;cut / side:切面 / 原生柱面相对柱顶的色调
const THEME_LOOK = {
  volcano: { wall: [0.38, 0.35, 0.34], crust: [0.36, 0.27, 0.24], glow: [1.0, 0.3, 0.05], hotBase: [0.45, 0.1, 0.03], cut: [1.05, 1.0, 0.96], side: [0.93, 0.92, 0.95],
    kinds: { ledge: [0.4, 0.35, 0.32], apron: [0.39, 0.34, 0.31], step: [0.42, 0.37, 0.34], bench: [0.44, 0.39, 0.35], plateau: [0.47, 0.41, 0.37],
      bed: [0.3, 0.2, 0.16], bank: [0.36, 0.29, 0.26], bridge: [0.31, 0.25, 0.22], altar: [0.45, 0.4, 0.38] } },
  // 星核 · 星石台地:暖砂岩色,越高越亮;墙柱 = 砂岩柱,约两成柱顶嵌紫色星晶;裂隙池沿 = 紫晶岩壳
  starcore: { wall: [0.6, 0.47, 0.38], crust: [0.5, 0.42, 0.55], glow: [0.62, 0.25, 1.0], hotBase: [0.42, 0.22, 0.6], cut: [1.06, 0.98, 0.92], side: [0.9, 0.86, 0.86],
    kinds: { ledge: [0.58, 0.46, 0.37], apron: [0.56, 0.45, 0.36], step: [0.6, 0.48, 0.39], bench: [0.63, 0.5, 0.4], plateau: [0.66, 0.53, 0.42] } },
  // 冰川 · 冰崖台地:浅冰蓝柱顶、深蓝切面(冰层截面);墙柱 = 深色岩芯 + 冰晶顶(解决「白墙配白地」)
  glacier: { wall: [0.36, 0.4, 0.5], crust: [0.55, 0.68, 0.82], glow: [0.35, 0.8, 1.0], hotBase: [0.55, 0.8, 0.95], cut: [0.82, 0.92, 1.08], side: [0.86, 0.92, 1.02],
    kinds: { ledge: [0.76, 0.85, 0.93], apron: [0.78, 0.87, 0.95], step: [0.74, 0.84, 0.93], bench: [0.72, 0.83, 0.93], plateau: [0.82, 0.9, 0.97] } },
};
const lin = a => new THREE.Color().setRGB(...a, THREE.SRGBColorSpace);

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

function columnsMesh(cols, heightAt, envMap, uTime, look = THEME_LOOK.volcano) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.06, flatShading: true });
  applyEnv(mat, envMap, LOOK.propEnvIntensity);
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uLava = { value: new THREE.Color(...look.glow) };
    sh.uniforms.uHotBase = { value: lin(look.hotBase) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHeat; varying float vHeat; varying float vTop;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = aHeat; vTop = step(0.999, position.y) * (1.0 - length(position.xz) / 0.88);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uLava; uniform vec3 uHotBase; varying float vHeat; varying float vTop;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float hot = vHeat * smoothstep(0.05, 0.75, vTop);
totalEmissiveRadiance += uLava * hot * 1.35 * (0.82 + 0.18 * sin(uTime * 1.7 + vHeat * 23.0));
diffuseColor.rgb = mix(diffuseColor.rgb, uHotBase, hot * 0.8);`);
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
    const b = col.layer === 'crust' ? look.crust : look.wall;
    c.setRGB(b[0] * v, b[1] * v, b[2] * v, THREE.SRGBColorSpace);
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
const RIVER_UNIT = 0.3;   // 流动纹理的尺度单位(= 边河宽);宽河道按这个单位铺,不会被横向拉伸
// 带子网格:控制点 [x, z, y, 宽?] 平滑成曲线;横向只用切线的水平分量(瀑布段不会把带子压成一条线)。
//   uv.x = 沿流向的弧长 / RIVER_UNIT(着色器按它往下游流),uv.y = 0..1 横向,aW = 本地宽度 / RIVER_UNIT
function ribbonGeometry(path, defWidth, { y = 0, widthK = 1, taperIn = 0.02 } = {}) {
  const curve = new THREE.CatmullRomCurve3(path.map(([x, z, py]) => new THREE.Vector3(x, py + y, z)), false, 'centripetal');
  const chord = [0];
  for (let i = 1; i < path.length; i++) chord.push(chord[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]));
  const widthAt = t => {   // 控制点宽度按弦长比例线性插值
    const s = t * chord.at(-1);
    let i = 1;
    while (i < chord.length - 1 && chord[i] < s) i++;
    const k = (s - chord[i - 1]) / ((chord[i] - chord[i - 1]) || 1);
    const w0 = path[i - 1][3] ?? defWidth, w1 = path[i][3] ?? defWidth;
    return w0 + (w1 - w0) * Math.max(0, Math.min(1, k));
  };
  const len = curve.getLength(), N = Math.max(60, Math.round(len / 0.035)), pos = [], uv = [], aw = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = curve.getPointAt(t), d = curve.getTangentAt(t), hl = Math.hypot(d.x, d.z) || 1;
    const taper = Math.min(1, t / taperIn, (1 - t) / 0.03) * 0.85 + 0.15, full = widthAt(t) * widthK;
    const w = full / 2 * taper * (0.92 + 0.08 * Math.sin(t * len * 9.0));
    for (const sd of [-1, 1]) {
      pos.push(p.x - d.z / hl * w * sd, p.y, p.z + d.x / hl * w * sd);
      uv.push(t * len / RIVER_UNIT, sd < 0 ? 0 : 1);
      aw.push(full * taper / RIVER_UNIT);
    }
    if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(aw, 1));
  g.setIndex(idx);
  return g;
}
// 熔岩:流向(沿 uv.x 往下游漂)、亮核(河心更亮更黄)、暗壳(随流漂移的冷却壳,壳缝发亮)、两岸压暗;眼镜里黑 = 透明,主体保持亮色
function riverMesh(paths, width, uTime) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime },
    vertexShader: /* glsl */`attribute float aW; varying vec2 vUv; varying float vW;
void main() { vUv = uv; vW = aW; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime; varying vec2 vUv; varying float vW;
${LAVA_GLSL}
void main() {
  float across = (vUv.y - 0.5) * vW, flow = vUv.x;
  float n = lFbm(vec2(flow * 0.9 - uTime * 0.35, across * 1.6));
  float cr = lFbm(vec2(flow * 0.55 - uTime * 0.22, across * 1.1 + 4.0));
  float crust = smoothstep(0.55, 0.7, cr);
  float seam = smoothstep(0.035, 0.0, abs(cr - 0.6));                      // 壳缝:暗壳边上一圈亮线
  float edgeD = min(vUv.y, 1.0 - vUv.y) * vW;
  float bank = smoothstep(0.02, 0.3, edgeD);
  float core = smoothstep(0.0, 1.0, 1.0 - abs(vUv.y - 0.5) * 2.0);
  // 颜色按线性空间写(输出时转 sRGB):熔岩主体 sRGB≈(1, 0.45, 0.08) 的饱和橙,河心偏黄;暗壳 sRGB≈(0.45, 0.12, 0.05) 不压成黑
  vec3 hot = mix(vec3(1.0, 0.17, 0.008), vec3(1.0, 0.5, 0.07), smoothstep(0.42, 0.8, n) * (0.4 + 0.6 * core));
  vec3 c = mix(vec3(0.17, 0.013, 0.004), hot * (1.0 + 0.35 * core), bank * (1.0 - crust * 0.8));
  float streak = smoothstep(0.72, 0.95, lNoise(vec2(flow * 2.2 - uTime * 1.0, across * 5.0)));   // 顺流的细亮纹
  c += vec3(1.0, 0.35, 0.03) * (seam * 0.7 + streak * 0.3 * (1.0 - crust)) * bank;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const mesh = new THREE.Mesh(mergeGeometries(paths.map(p => ribbonGeometry(p, width))), mat);
  mesh.name = 'lavaRiver';
  mesh.frustumCulled = false;   // 它负责每帧推进共享时间,不能被裁掉
  mesh.onBeforeRender = () => { uTime.value = performance.now() / 1000; };
  return mesh;
}

// 热浪:场内河道上方一层加色的热光(比河道宽,漫到两岸柱顶),缓慢起伏的噪声让光"抖"起来
function heatSheet(paths, uTime) {
  const geo = mergeGeometries(paths.map(p => ribbonGeometry(p, 1, { y: 0.12, widthK: 1.7, taperIn: 0.12 })));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime; varying vec2 vUv;
${LAVA_GLSL}
void main() {
  float a = pow(1.0 - abs(vUv.y - 0.5) * 2.0, 1.6);
  float s = lFbm(vec2(vUv.x * 0.5 + uTime * 0.12, vUv.y * 3.0 - uTime * 0.6));
  gl_FragColor = vec4(vec3(1.0, 0.16, 0.01) * a * (0.05 + 0.1 * s), 1.0);
}`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'lavaHeat';
  mesh.renderOrder = 2;
  return mesh;
}

// 火星:沿所有熔岩河撒点,着色器里按时间上升、闪烁、淡出(不占 CPU)
function emberPoints(paths, uTime) {
  const pos = [], seed = [];
  let s = 0;
  for (const path of paths) for (let i = 0; i < path.length - 1; i++) {
    const [x1, z1, y1] = path[i], [x2, z2, y2] = path[i + 1], n = Math.max(1, Math.round(Math.hypot(x2 - x1, z2 - z1) / 0.22));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, w = ((path[i][3] ?? 0.3) * 0.4) * Math.sin(s * 12.9898);
      pos.push(x1 + (x2 - x1) * t, Math.min(y1, y2), z1 + (z2 - z1) * t + w);
      seed.push((s++ * 0.6180339) % 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime, uScale: { value: 420 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`attribute float aSeed; uniform float uTime; uniform float uScale; varying float vA;
void main() {
  float t = fract(uTime * (0.22 + aSeed * 0.18) + aSeed * 7.0);
  vec3 p = position + vec3(sin(aSeed * 50.0 + t * 4.0) * 0.06, t * 0.55, cos(aSeed * 31.0 + t * 3.0) * 0.06);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.05 * (1.0 - t) + 0.015) * uScale / -mv.z;
  vA = smoothstep(0.0, 0.08, t) * (1.0 - t) * (0.6 + 0.4 * sin(uTime * 23.0 + aSeed * 90.0));
}`,
    fragmentShader: /* glsl */`varying float vA;
void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vec3(1.0, 0.35, 0.05) * vA * (1.0 - d * 2.0), 1.0); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.name = 'lavaEmbers';
  return pts;
}

// ── 冰封裂谷 · 冰川裂隙:每条裂隙按左右沿(和 onIce 判定同一份顶点)铺成带子,逐顶点贴地;
//   着色 = 浅冰边缘(霜白锯齿沿 + 随视角游走的反光)→ 往里加深成深蓝裂口(不用黑:眼镜里黑 = 透明)+ 沿裂隙方向的细裂纹 ──
const ICE_GLSL = /* glsl */`
float iHash(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float iNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(iHash(i), iHash(i + vec2(1, 0)), u.x), mix(iHash(i + vec2(0, 1)), iHash(i + vec2(1, 1)), u.x), u.y);
}`;
function iceMesh(ice, heightAt, uTime) {
  const geos = ice.cracks.map(({ left, right }) => {
    const pos = [], uv = [], idx = [], n = left.length;
    let len = 0;
    for (let i = 0; i < n; i++) {
      const [lx, lz] = left[i], [rx, rz] = right[i];
      if (i) len += Math.hypot((lx + rx - left[i - 1][0] - right[i - 1][0]) / 2, (lz + rz - left[i - 1][1] - right[i - 1][1]) / 2);
      // 每个截面 3 个顶点(左沿 / 中线 / 右沿),中线也贴地
      for (const [x, z, v] of [[lx, lz, 0], [(lx + rx) / 2, (lz + rz) / 2, 0.5], [rx, rz, 1]]) {
        pos.push(x, heightAt(x, z) + 0.012, z);
        uv.push(len, v);
      }
      if (i < n - 1) for (const k of [0, 1]) {
        const a = i * 3 + k, b = a + 3;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vW; varying vec3 vV;
void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = position; vV = cameraPosition - wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`uniform float uTime; varying vec2 vUv; varying vec3 vW; varying vec3 vV;
${ICE_GLSL}
void main() {
  float e = 1.0 - abs(vUv.y - 0.5) * 2.0;                          // 0 = 裂隙边沿,1 = 中线
  float n = iNoise(vW.xz * 7.0), n2 = iNoise(vW.xz * 19.0 + 3.1);
  float deep = smoothstep(0.28 + 0.22 * n, 0.72 + 0.18 * n2, e);   // 裂口:内边界随噪声抖动 → 锯齿
  vec3 rim = vec3(0.62, 0.84, 1.0) * (0.92 + 0.12 * n2);           // 浅冰边缘(线性色)
  vec3 v = normalize(vV);
  float sheen = pow(max(0.0, 1.0 - abs(fract(dot(vW.xz, vec2(0.6, 0.8)) * 0.5 + v.x * 0.6 + v.z * 0.4 + uTime * 0.03) * 2.0 - 1.0)), 8.0);
  rim += vec3(0.35, 0.4, 0.45) * sheen * (1.0 - deep);
  vec3 gap = mix(vec3(0.05, 0.22, 0.62), vec3(0.02, 0.09, 0.36), smoothstep(0.75, 1.0, e));   // 深蓝裂口,中线最深(不到黑)
  vec3 c = mix(rim, gap, deep);
  float streak = smoothstep(0.86, 1.0, iNoise(vec2(vUv.x * 9.0, vUv.y * 2.5 + 1.7)));          // 沿裂隙方向的细裂纹
  c = mix(c, vec3(0.1, 0.32, 0.72), streak * 0.5 * (1.0 - deep));
  c = mix(c, vec3(0.92, 0.97, 1.0), smoothstep(0.1, 0.0, e) * 0.85);                           // 霜白锯齿沿:在雪地上读出边界
  gl_FragColor = vec4(c, smoothstep(0.0, 0.04, e) * 0.96);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
  mesh.name = 'iceCracks';
  mesh.renderOrder = 1;
  return mesh;
}

// ── 矿车轨道:两根铁轨 + 枕木 ──
function railsMesh(rails, envMap) {
  const boxes = [];
  for (const r of rails) {
    const len = r.z2 - r.z1, cz = (r.z1 + r.z2) / 2;
    const y0 = r.y ?? 0;   // 轨道所在台面的高度
    for (const sd of [-1, 1]) boxes.push({ x: r.x + sd * 0.065, z: cz, sx: 0.022, sy: 0.03, sz: len, y: y0 + 0.02, metal: true });
    for (let z = r.z1 + 0.05; z < r.z2; z += 0.13) boxes.push({ x: r.x, z, sx: 0.2, sy: 0.022, sz: 0.045, y: y0 + 0.004, metal: false });
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
  glow.push(at(new THREE.PlaneGeometry(0.34, 0.3).rotateX(-Math.PI / 2), 0, 0.21, 0.63));   // 只到台基前沿,后面接熔岩瀑布
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
  g.position.set(f.x, heightAt(f.x, f.z), f.z);
  g.rotation.y = f.rot ?? 0;
  g.scale.setScalar(f.scale ?? 1);
  return g;
}

// ── 切割六棱柱(第三轮:台地 / 河床 / 河岸 / 岩桥 / 祭坛台)──
//   obstacle-layout.cutColumnsLayout 给每根柱子裁切后的凸多边形;这里把它们挤成柱子,全部合并成 1 个网格(1 次 draw call)。
//   柱顶:扇形三角化,顶点带"到原六边形格心的六边形距离"(rim),着色器据此画格缝 → 被切开的半根柱子顶面不会多出一条缝。
//   侧面:原生柱面 = 暗一点的竖纹;切面(落在裁切边界上的面)= 更亮、细颗粒、柱与柱之间的缝更深 —— 像切开的玄武岩柱露出截面。
//   切面外侧是熔岩时,底部按离熔岩面的高度发红(两岸、河床壁、祭坛台边)。
//   不用贴图:颜色走顶点色 + 着色器
const KIND_COLOR = {   // sRGB 基色(柱顶);侧面 / 切面在着色器里再调
  ledge: [0.4, 0.35, 0.32], apron: [0.39, 0.34, 0.31], step: [0.42, 0.37, 0.34], bench: [0.44, 0.39, 0.35], plateau: [0.47, 0.41, 0.37],
  bed: [0.3, 0.2, 0.16], bank: [0.36, 0.29, 0.26], bridge: [0.31, 0.25, 0.22], altar: [0.45, 0.4, 0.38],
};
const RIM_K = { bridge: 0.86, bank: 0.94, altar: 0.94 };
const CUT_GLSL = /* glsl */`
float cHash(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float cNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1, 0)), u.x), mix(cHash(i + vec2(0, 1)), cHash(i + vec2(1, 1)), u.x), u.y);
}`;
function cutColumnsMesh(cols, envMap, uTime, look = THEME_LOOK.volcano) {
  let nv = 0;
  for (const c of cols) nv += c.poly.length * 3 + c.poly.length * 6;
  const P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), C = new Float32Array(nv * 3), I = new Float32Array(nv * 4), Hh = new Float32Array(nv * 2);
  let v = 0;
  const col = new THREE.Color();
  const put = (x, y, z, nx, ny, nz, info, h0, h1) => {
    P.set([x, y, z], v * 3); Nn.set([nx, ny, nz], v * 3); C.set([col.r, col.g, col.b], v * 3); I.set(info, v * 4); Hh.set([h0, h1], v * 2); v++;
  };
  const A = Math.sqrt(3) / 2;
  cols.forEach((c, ci) => {
    const base = look.kinds[c.kind] ?? KIND_COLOR[c.kind] ?? look.kinds.ledge, k = 0.88 + ((ci * 7919) % 97) / 97 * 0.24;
    const lift = c.kind === 'bench' || c.kind === 'plateau' || c.kind === 'apron' ? Math.min(1.15, 1 + Math.max(0, c.top - ({ bench: 0.34, plateau: 0.54, apron: 0.05 })[c.kind]) * 0.4) : 1;   // 抬高的石柱群略亮
    col.setRGB(base[0] * k * lift, base[1] * k * lift, base[2] * k * lift, THREE.SRGBColorSpace);
    const rimK = RIM_K[c.kind] ?? 1;   // 细柱(场内)柱缝收窄,岩桥读成一整块桥面而不是格栅
    const rim = (x, z) => {   // 到格心的六边形距离 / 边心距(格边 = 1)
      const dx = x - c.cx, dz = z - c.cz;
      return rimK * Math.max(Math.abs(dx * A + dz * 0.5), Math.abs(dz), Math.abs(dx * A - dz * 0.5)) / (c.R * A);
    };
    const poly = c.poly, n = poly.length;
    // 柱顶:格心在多边形里就从格心扇形三角化,否则用质心
    let ox = c.cx, oz = c.cz;
    if (n !== 6 || c.cut.some(Boolean)) {
      let inside = true;
      for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; if ((b[0] - a[0]) * (oz - a[1]) - (b[1] - a[1]) * (ox - a[0]) < 0) inside = false; }
      if (!inside) { ox = poly.reduce((s, p) => s + p[0], 0) / n; oz = poly.reduce((s, p) => s + p[1], 0) / n; }
    }
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      put(ox, c.top, oz, 0, 1, 0, [rim(ox, oz), 0, 0, 0], 1, c.heat);
      put(b[0], c.top, b[1], 0, 1, 0, [rim(b[0], b[1]), 0, 0, 0], 1, c.heat);
      put(a[0], c.top, a[1], 0, 1, 0, [rim(a[0], a[1]), 0, 0, 0], 1, c.heat);
    }
    // 侧面:外法线 = (dz, −dx)(多边形逆时针,内部在左)
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L, cut = c.cut[i] ? 1 : 0, glow = c.glow[i] == null ? 0 : c.glow[i] + 1;
      const q = [[a, c.bottom, 0, 0], [b, c.bottom, 1, 0], [b, c.top, 1, 1], [a, c.top, 0, 1]];
      for (const j of [0, 2, 1, 0, 3, 2]) {   // 朝外的绕序
        const [p, y, u, hf] = q[j];
        put(p[0], y, p[1], nx, 0, nz, [-1, cut, u, glow], hf, 0);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(I, 4));
  g.setAttribute('aH', new THREE.BufferAttribute(Hh, 2));
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.03 });
  applyEnv(mat, envMap, LOOK.propEnvIntensity);
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uLava = { value: new THREE.Color(...look.glow) };
    sh.uniforms.uCutTint = { value: new THREE.Vector3(...look.cut) };
    sh.uniforms.uSideTint = { value: new THREE.Vector3(...look.side) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aInfo; attribute vec2 aH; varying vec4 vInfo; varying vec2 vH; varying vec3 vCP; varying vec3 vCN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInfo = aInfo; vH = aH; vCP = position; vCN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; uniform vec3 uLava; uniform vec3 uCutTint; uniform vec3 uSideTint; varying vec4 vInfo; varying vec2 vH; varying vec3 vCP; varying vec3 vCN;\n${CUT_GLSL}`)
      .replace('#include <map_fragment>', `
float isTop = step(0.6, normalize(vCN).y);
float rim = vInfo.x, cutF = vInfo.y, u = vInfo.z;
float n1 = cNoise(vCP.xz * 7.0 + vCP.y * 3.0);
// 柱顶:靠格边一圈压暗 = 柱缝;中间略亮(柱顶微凸的读感)
float seamT = smoothstep(0.8, 0.98, rim);
float kTop = (0.9 + 0.14 * n1) * (1.0 - 0.45 * seamT) * (1.0 + 0.06 * (1.0 - rim));
// 侧面:柱面竖纹 + 棱边压暗;切面:更亮、细颗粒、柱与柱的缝更深(切开的柱截面),顶上一道亮边
float edgeS = smoothstep(0.0, 0.07, u) * smoothstep(1.0, 0.93, u);
float grain = cNoise(vec2((vCP.x + vCP.z) * 26.0, vCP.y * 5.0));
float kSide = 0.72 * (0.86 + 0.2 * grain) * (0.62 + 0.38 * edgeS);
float speck = cNoise(vec2(vCP.x + vCP.z, vCP.y) * 60.0);
float kCut = 1.05 * (0.86 + 0.2 * speck) * (0.42 + 0.58 * edgeS) * (1.0 + 0.22 * smoothstep(0.94, 1.0, vH.x));
float ao = mix(0.5, 1.0, smoothstep(0.0, 0.5, vH.x));
float kk = isTop > 0.5 ? kTop : mix(kSide, kCut, cutF) * ao;
vec3 tint = isTop > 0.5 ? vec3(1.0) : mix(uSideTint, uCutTint, cutF);
diffuseColor.rgb *= kk * tint;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// 切面外侧是熔岩:越靠近熔岩面越红(熔岩光打在崖壁 / 岸壁上)
float lavaGlow = vInfo.w > 0.5 ? exp(-max(0.0, vCP.y - (vInfo.w - 1.0)) / 0.05) : 0.0;
float flick = 0.85 + 0.15 * sin(uTime * 2.1 + vCP.x * 3.0 + vCP.z * 2.3);
// 柱顶熔光(岸柱零星几根 / 岩桥):沿柱缝发亮的裂纹
float crack = isTop * vH.y * smoothstep(0.55, 0.95, rim + 0.25 * n1);
totalEmissiveRadiance += uLava * (lavaGlow * 1.2 * flick + crack * 1.1 * flick);`);
  };
  mat.customProgramCacheKey = () => 'cutColumns1';
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'cutColumns';
  return mesh;
}

// 地形 GLB + 高度图的整形(有套件的场景,加载时做一次;结果在缓存里共享):
//   玩法区 = layout 给的 fieldHeight(平地 + 星核圆台 + 熔岩池浅盆);战场外 = 压到台沿下面(台地网格盖住)
export function shapeTerrain(sceneId, root, hm, map) {
  if (!DRESSINGS[sceneId]) return;
  const F = ARENA.frame, under = FLOOR - 0.06;
  const inField = (x, z) => Math.abs(x) <= map.W && Math.abs(z) <= map.HALF;
  root.traverse(o => {
    if (!o.isMesh || !/^Island/.test(o.name)) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (inField(x, z)) pos.setY(i, fieldHeight(map, x, z));
      else if (y > under && Math.abs(x) <= F.x + 0.2 && Math.abs(z) <= F.z + 0.2) pos.setY(i, under);
    }
    pos.needsUpdate = true;
    o.geometry.computeVertexNormals();
    o.geometry.computeBoundingBox();
    o.geometry.computeBoundingSphere();
  });
  for (let j = 0; j < hm.nz; j++) for (let i = 0; i < hm.nx; i++) {
    const x = hm.x0 + i * hm.step, z = hm.z0 + j * hm.step;
    hm.data[j * hm.nx + i] = inField(x, z) ? fieldHeight(map, x, z) : FLOOR;
  }
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

// 入口:返回 { group(切割柱台地 / 墙柱 / 熔岩河 + 热浪 + 火星 / 轨道 / 锻炉), props(交给 props3d.buildProps 的 Tripo 配景摆放列表),
//   surfaceAt(战场内 = 地形高度,战场外 = 台地顶高;配景按它落地)}
export function buildDressing(sceneId, { map, heightAt, envMap }) {
  const layout = DRESSINGS[sceneId](map);
  const blocks = layout.terraces ?? [];
  const surfaceAt = (x, z) => terraceTop(map, blocks, x, z) ?? heightAt(x, z);
  const group = new THREE.Group();
  group.name = 'obstacleKit';
  const uTime = timeUniform(group);
  const look = THEME_LOOK[sceneId] ?? THEME_LOOK.volcano;
  group.add(cutColumnsMesh(layout.cutColumns, envMap, uTime, look));
  const cols = columnsMesh(layout.columns, surfaceAt, envMap, uTime, look);
  cols.onBeforeRender = () => { uTime.value = performance.now() / 1000; };   // 没有熔岩河的图也要推进共享时间
  group.add(cols);
  const rivers = [...layout.rivers, ...layout.fieldRivers];
  if (rivers.length) {
    group.add(riverMesh(rivers, layout.riverRibbon ?? layout.riverWidth, uTime));
    group.add(emberPoints(rivers, uTime));
  }
  if (layout.fieldRivers.length) group.add(heatSheet(layout.fieldRivers, uTime));
  if (layout.ice) group.add(iceMesh(layout.ice, heightAt, uTime));
  if (layout.rails.length) group.add(railsMesh(layout.rails, envMap));
  if (layout.forge) group.add(forgeGroup(layout.forge, surfaceAt, envMap, uTime));
  return { group, props: layout.props, surfaceAt };
}

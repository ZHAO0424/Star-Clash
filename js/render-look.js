// 画面基调 — 色调映射、灯光组、贴地圆影、实时阴影开关(第一轮画面提升)
//   · 只管"怎么照亮 / 怎么出图",不碰玩法;scene.js 在构造时调用 setupLook()、每帧调用 look.update()
//   · 眼镜是光学透视的:黑 = 透明。不要靠压暗营造气氛,暗部用冷色补光托住,曝光略高于常规
//   · 实时阴影只在桌面开(一盏主光、1024 阴影贴图、只投单位和建筑);XR 下关掉,只留圆影
import * as THREE from 'three';

export const LOOK = {
  exposure: 1.0,        // 桌面曝光(ACES 会压暗中间调,略抬)
  exposureXR: 1.12,      // XR 曝光:光学透视下暗部会被吃掉,再抬一点
  envIntensity: 0.85,    // 所有 Tripo 模型 / 配景统一的环境反射强度
  propEnvIntensity: 0.7, // 外圈配景略低,不和单位抢
  shadowMapSize: 1024,
};

// 渲染器:sRGB 输出 + ACES 色调映射 + 软阴影(阴影贴图常开,XR 里靠 key.castShadow=false 跳过阴影 pass)
function setupRenderer(renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

// 灯光组:天光(半球)+ 暖主光(投影)+ 冷补光 + 背后轮廓光
//   主光从玩家左前上方照下,影子落向右后方;轮廓光从敌方一侧打过来,把单位从地面上"抠"出来
function buildLights(scene) {
  const hemi = new THREE.HemisphereLight(0xc4d4ff, 0x5a4a40, 0.8);
  const key = new THREE.DirectionalLight(0xffdcb4, 2.0);
  key.position.set(-5.5, 11, 6.5);
  key.castShadow = true;
  const s = key.shadow;
  s.mapSize.set(LOOK.shadowMapSize, LOOK.shadowMapSize);
  // 正交阴影相机只罩住棋盘(含金框):±7.6 × ±9.9,斜射光再放宽一点
  Object.assign(s.camera, { left: -9.5, right: 9.5, top: 11.5, bottom: -11.5, near: 2, far: 30 });
  s.camera.updateProjectionMatrix();
  s.bias = -0.0006;
  s.normalBias = 0.025;
  s.radius = 3;
  const fill = new THREE.DirectionalLight(0x8fb0ff, 0.45);
  fill.position.set(7, 5, 4);
  const rim = new THREE.DirectionalLight(0xd8e6ff, 1.1);
  rim.position.set(2, 6, -10);
  scene.add(hemi, key, key.target, fill, rim);
  return { hemi, key, fill, rim };
}

// ── 贴地圆影:径向渐变贴图 + 共用材质,所有单位 / 建筑脚下都有(XR 也开,很便宜)──
let blobTex = null;
const blobMats = new Map();
const blobGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}
// 圆影网格:radius = 半径,opacity = 中心浓度。几何体 / 材质共用(drop 时不能释放 → userData.shared)
export function blobShadow(radius, opacity = 0.5) {
  const key = Math.round(opacity * 20);
  if (!blobMats.has(key)) {
    blobMats.set(key, new THREE.MeshBasicMaterial({
      map: blobTexture(), color: 0x000000, transparent: true, opacity: key / 20, depthWrite: false,
      toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
  }
  const m = new THREE.Mesh(blobGeo, blobMats.get(key));
  m.scale.setScalar(radius);
  m.position.y = 0.015;
  m.renderOrder = 1;
  m.userData.sharedGeo = true;
  m.userData.sharedMat = true;
  m.name = 'blobShadow';
  return m;
}

// 模型投影:单位 / 建筑的网格投实时阴影(只在桌面主光 castShadow 时生效)
export function castShadows(root) {
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
}
// 地形 / 台面接收阴影
export function receiveShadows(root) {
  root.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
}

// 把模型材质的环境反射统一到一个强度
export function applyEnv(material, envMap, intensity = LOOK.envIntensity) {
  if (!material?.isMeshStandardMaterial) return;
  material.envMap = envMap;
  material.envMapIntensity = intensity;
}

// 入口:返回 { lights, update(xrPresenting) }
export function setupLook(renderer, scene) {
  setupRenderer(renderer);
  const lights = buildLights(scene);
  let wasXR = null;
  return {
    lights,
    // 每帧调用:XR 中关实时阴影、抬曝光;只在切换时改状态(切换会触发一次着色器重编译)
    update(xr) {
      if (xr === wasXR) return;
      wasXR = xr;
      lights.key.castShadow = !xr;
      renderer.toneMappingExposure = xr ? LOOK.exposureXR : LOOK.exposure;
    },
  };
}

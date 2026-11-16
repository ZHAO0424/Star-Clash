// 美术资源加载 — 读取 assets/manifest.json(由 tools/process_art.py 生成),预加载立绘/图标
// 缺失的资源返回 null,调用方回退到程序化几何体 / 纯文字卡面
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mapForScene } from './map.js';
import { drawXRIcon, XR_VECTOR_ICONS } from './xr-icons.js';

export const XR_GUIDE = [
  { id: 'pinch', url: 'assets/ui/guide/pinch.webp' },
  { id: 'release', url: 'assets/ui/guide/release.webp' },
  { id: 'recenter', url: 'assets/ui/guide/recenter.webp' },
];

const manifest = { units: [], spells: [], emblems: [], structures: [], ui: [], scenes: {} };
const textures = new Map();   // unit id / struct_<faction>_<kind> → THREE.Texture
const images = new Map();     // key → HTMLImageElement(卡面 canvas 绘制用)

// 召唤物没有单独立绘时借用同系卡牌的图
const FALLBACK = { swarm_larva: 'swarm_brood' };

function loadImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const guideRequests = new Map();
export function loadXRGuideArt(step) {
  if (!guideRequests.has(step.id)) {
    guideRequests.set(step.id, loadImage(step.url).then(img => {
      if (img) images.set('ui:guide-' + step.id, img);
    }));
  }
  return guideRequests.get(step.id);
}

const XR_CONTROLS = {
  center: 'xr/xr-recenter.png',
  size: 'xr/xr-board-size.png',
  sound: 'xr/xr-sound.png',
  leave: 'xr/xr-exit.png',
  back: 'card-back.png',
};
let xrControlArtRequest;

export function loadXRControlArt() {
  // 暂停 / 继续 / 设置还没有位图,先用 canvas 矢量图标顶上
  for (const name of XR_VECTOR_ICONS) {
    if (!images.has('ui:xr-control-' + name)) images.set('ui:xr-control-' + name, drawXRIcon(name));
  }
  xrControlArtRequest ??= Promise.all(Object.entries(XR_CONTROLS).map(async ([action, path]) => {
    const img = await loadImage('assets/ui/' + path);
    if (img) images.set('ui:xr-control-' + action, img);
  }));
  return xrControlArtRequest;
}

// ── 战场场景(js/scenes.js):地形由 tools/build_terrain.py 用 Blender 生成,贴图 / 装饰物 / 背景由图像 AI 交付 ──
// loadScene(id) → { id, scene(地形模型), hm(高度图), spots(装饰物位置), propTextures, sky, concept, textured } ;失败返回 null(平面战场)
const sceneCache = new Map();
const texLoader = new THREE.TextureLoader();
const loadTex = url => new Promise(res => texLoader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, () => res(null)));

export function sceneArt(id) {
  const have = new Set(manifest.scenes?.[id] ?? []);
  const url = k => (have.has(k) ? `assets/scenes/${id}/${k}.${k.startsWith('prop') ? 'png' : 'jpg'}` : null);
  return { concept: url('concept'), sky: url('sky'), ground: url('ground'), cliff: url('cliff'), hazard: url('hazard'),
    props: ['prop1', 'prop2', 'prop3'].map(url).filter(Boolean) };
}

export function loadScene(id) {
  if (!sceneCache.has(id)) sceneCache.set(id, buildScene(id));
  return sceneCache.get(id);
}

async function buildScene(id) {
  try {
    const base = `assets/terrain/${id}/`;
    const res = await fetch(base + 'heightmap.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const hm = await res.json();
    const spots = await fetch(base + 'props.json').then(r => (r.ok ? r.json() : { spots: [] })).then(j => j.spots).catch(() => []);
    const art = sceneArt(id);
    const [gltf, ground, cliff, hazard, ...propTextures] = await Promise.all([
      new GLTFLoader().loadAsync(base + 'battlefield.glb'),
      art.ground && loadTex(art.ground), art.cliff && loadTex(art.cliff), art.hazard && loadTex(art.hazard),
      ...art.props.map(loadTex),
    ]);
    const textured = !!(ground && cliff);
    const map = mapForScene(id);
    const { SCENES } = await import('./scenes.js');
    const cfg = SCENES.find(s => s.id === id);
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();   // GLTF 里岛和岩石共用同一个材质对象:各自复制一份,否则后设置的会覆盖先设置的
      const isRock = o.name.startsWith('Rocks');
      if (o.material.emissive && o.material.emissive.getHex() !== 0) {   // 晶簇:压住发光强度(太亮会发白),颜色用场景配色
        const c = new THREE.Color().setRGB(...cfg.palette.crystal);
        o.material.color.copy(c);
        o.material.emissive.copy(c).multiplyScalar(0.8);
        o.material.emissiveIntensity = 0.75;
        return;
      }
      if (isRock) o.material.flatShading = true;
      if (textured) applyTerrainTextures(o.material, { ground, cliff, hazard: hazard || ground, isRock, cfg, map });
      else o.material.vertexColors = !!o.geometry.attributes.color;
    });
    return { id, scene: gltf.scene, hm, spots, propKit: cfg.propKit, propTextures: propTextures.filter(Boolean), sky: art.sky, concept: art.concept, textured };
  } catch (e) {
    console.warn(`场景 ${id} 加载失败,使用平面战场`, e);
    return null;
  }
}

// 贴图模式的地形着色:平地用地面贴图、陡坡和岩石用岩壁贴图(三向投影,陡坡不拉伸)、裂隙用裂隙贴图并发光;
// 乘上 Blender 烘焙的环境光遮蔽(存在 UV 的 u 里)。贴图坐标直接用战场坐标,每 2.5 格重复一次
function applyTerrainTextures(mat, { ground, cliff, hazard, isRock, cfg, map }) {
  for (const t of [ground, cliff, hazard]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  const rifts = map.rifts.map(r => new THREE.Vector3(r.x, r.z, r.r));
  mat.vertexColors = false;
  mat.color.set(0xffffff);
  mat.onBeforeCompile = sh => {
    mat.userData.shader = sh;   // 调试用:可在控制台查看 / 修改 uniform
    sh.uniforms.tGround = { value: ground };
    sh.uniforms.tCliff = { value: cliff };
    sh.uniforms.tHazard = { value: hazard };
    sh.uniforms.uRock = { value: isRock ? 1 : 0 };
    sh.uniforms.uRifts = { value: rifts };
    sh.uniforms.uGlow = { value: new THREE.Color().setRGB(...cfg.palette.hazardCore).multiplyScalar(0.09) };
    sh.uniforms.uField = { value: new THREE.Vector2(map.W, map.HALF) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTPos; varying vec3 vTNrm; varying float vTAO;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTPos = position; vTNrm = normal; vTAO = uv.x;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tGround; uniform sampler2D tCliff; uniform sampler2D tHazard;
uniform float uRock; uniform vec3 uRifts[2]; uniform vec3 uGlow; uniform vec2 uField;
varying vec3 vTPos; varying vec3 vTNrm; varying float vTAO;
float tHazardW; vec3 tHzGlow;`)
      .replace('#include <map_fragment>', `
vec3 tN = normalize(vTNrm);
vec3 tw = pow(abs(tN), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
const float S = 0.3;
vec3 tCl = texture2D(tCliff, vTPos.zy * S).rgb * tw.x + texture2D(tCliff, vTPos.xz * S).rgb * tw.y + texture2D(tCliff, vTPos.xy * S).rgb * tw.z;
vec3 tGr = texture2D(tGround, vTPos.xz * S).rgb;
float cliffW = max(uRock, 1.0 - smoothstep(0.62, 0.84, tN.y));
// 战场外沿的矮墙(离战场边 0~0.42):固定用岩壁贴图,和地面区分开
vec2 tOut = max(abs(vTPos.xz) - uField, 0.0);
float tDo = length(tOut);
float curbW = (1.0 - uRock) * smoothstep(0.0, 0.03, tDo) * (1.0 - smoothstep(0.36, 0.44, tDo));
cliffW = max(cliffW, curbW);
tHazardW = 0.0;
float tRim = 0.0;
for (int i = 0; i < 2; i++) {
  float d = distance(vTPos.xz, uRifts[i].xy);
  tHazardW = max(tHazardW, 1.0 - smoothstep(uRifts[i].z * 0.72, uRifts[i].z + 0.1, d));
  tRim = max(tRim, exp(-pow((d - uRifts[i].z * 0.86) / (uRifts[i].z * 0.12), 2.0)));   // 池边一圈加深,有凹陷感
}
tHazardW *= (1.0 - uRock);
tRim *= (1.0 - uRock);
vec3 tHz = texture2D(tHazard, vTPos.xz * S * 0.8).rgb;
tHzGlow = tHz;   // 裂隙按贴图本身的颜色自发光(熔岩是橙色、冰缝是青色),不会被冲白
vec3 tCol = mix(mix(tGr, tCl, cliffW), tHz, tHazardW) * (1.0 - 0.45 * tRim);
diffuseColor.rgb *= tCol * (0.5 + 0.5 * vTAO);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += (tHzGlow * 0.45 + uGlow) * tHazardW;');
  };
  mat.customProgramCacheKey = () => 'terrainTex' + (isRock ? 'R' : 'G');
  mat.needsUpdate = true;
}
export const ready = (async () => {
  try {
    const res = await fetch('assets/manifest.json', { cache: 'no-cache' });
    if (res.ok) Object.assign(manifest, await res.json());
  } catch { /* 没有清单 = 没有美术资源 */ }
  const jobs = [
    loadImage('assets/ui/materials/mana-crystal.webp').then(img => {
      if (img) images.set('ui:mana-crystal', img);
    }),
  ];
  for (const id of manifest.units) {
    jobs.push(loadImage(`assets/units/${id}.png`).then(img => {
      if (!img) return;
      images.set('unit:' + id, img);
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      textures.set(id, tex);
    }));
  }
  for (const id of manifest.structures) {
    jobs.push(loadImage(`assets/structures/${id}.png`).then(img => {
      if (!img) return;
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      textures.set(id, tex);
    }));
  }
  for (const id of manifest.ui) {
    const url = id === 'bg_menu' ? 'assets/ui/bg_menu.jpg' : `assets/ui/${id}.png`;
    jobs.push(loadImage(url).then(img => img && images.set('ui:' + id, img)));
  }
  for (const id of manifest.spells) {
    jobs.push(loadImage(`assets/spells/${id}.png`).then(img => img && images.set('spell:' + id, img)));
  }
  for (const id of manifest.emblems) {
    jobs.push(loadImage(`assets/emblems/${id}.png`).then(img => img && images.set('emblem:' + id.replace('emblem_', ''), img)));
  }
  // 首屏进度:网络慢时(如国内访问 github.io)让玩家看到在加载、加载到哪了
  let done = 0;
  const report = () => globalThis.dispatchEvent?.(new CustomEvent('bg-assets-progress', { detail: { done, total: jobs.length } }));
  jobs.forEach(j => j.finally(() => { done++; report(); }));
  report();
  await Promise.all(jobs);
  return { units: textures.size, spells: manifest.spells.length, emblems: manifest.emblems.length };
})();

const resolve = id => (textures.has(id) ? id : FALLBACK[id] && textures.has(FALLBACK[id]) ? FALLBACK[id] : null);

// 单位/建筑立绘贴图(公告板精灵用)
export function unitTexture(id) {
  const key = resolve(id);
  return key ? textures.get(key) : null;
}

// 卡面插图:{ url, img, glow }——glow=true 表示黑底发光图(需要加法/滤色混合去黑)
export function cardArt(card) {
  if (card.type === 'spell') {
    const img = images.get('spell:' + card.id);
    return img ? { url: img.src, img, glow: true } : null;
  }
  const key = resolve(card.id);
  const img = key && images.get('unit:' + key);
  return img ? { url: img.src, img, glow: false } : null;
}

export function emblem(faction) {
  const img = images.get('emblem:' + faction);
  return img ? { url: img.src, img, glow: true } : null;
}

// 塔 / 核心立绘(kind = outpost | pylon | base),没有返回 null(回退到几何体)
export function structTexture(faction, kind) {
  return textures.get(`struct_${faction}_${kind}`) ?? null;
}

// 界面图:up_<id> / ui_<name> / end_<result> / bg_menu;没有返回 null
export function uiArt(id) {
  const img = images.get('ui:' + id);
  return img ? { url: img.src, img, glow: false } : null;   // 处理脚本已把黑底转成透明
}

// ── 3D 单位模型(tools/gen-models.mjs 用 Tripo 生成,清单在 assets/models/models.json)──
// models.json: { "<cardId>": { file, clips: [...], rig, yaw } } ;yaw = 模型正面相对 +Z 的偏转(弧度)
// 懒加载:第一次请求时开始下载,下载完之前调用方先用立绘精灵,完成后再换成模型
const modelIndex = (async () => {
  try {
    const res = await fetch('assets/models/models.json', { cache: 'no-cache' });
    return res.ok ? await res.json() : {};
  } catch { return {}; }
})();
let modelMeta = {};
modelIndex.then(m => { modelMeta = m || {}; });
const modelCache = new Map();   // id → { ready, failed, gltf, meta }
const gltfLoader = new GLTFLoader();

// 返回 null(这张卡没有模型)或 { ready, gltf, meta };ready=false 表示还在下载
export function unitModel(id) {
  const meta = modelMeta[id];
  if (!meta) return null;
  let e = modelCache.get(id);
  if (!e) {
    e = { ready: false, failed: false, gltf: null, meta };
    modelCache.set(id, e);
    // 角色和它的武器(assets/models/weapons/)都下载完才算就绪;武器缺失不影响角色
    const load = url => new Promise((res, rej) => gltfLoader.load(url, res, undefined, rej));
    Promise.all([
      load(`assets/models/${meta.file || id + '.glb'}`),
      ...(meta.weapons || []).map(w => (w.fx ? null : weaponScene(w.id))),   // fx 道具(如能量球)由代码生成,不下载
    ]).then(([g, ...ws]) => {
      e.gltf = g;
      e.weapons = (meta.weapons || []).map((spec, i) => ({ spec, scene: ws[i] })).filter(w => w.scene || w.spec.fx);
      e.ready = true;
    }).catch(err => { e.failed = true; console.warn('模型加载失败', id, err); });
  }
  return e.failed ? null : e;
}
export const modelsReady = modelIndex;

const weaponCache = new Map();   // 武器 id → Promise<scene | null>(同一把武器多个单位共用)
export function weaponScene(id) {
  if (!weaponCache.has(id)) {
    weaponCache.set(id, new Promise(res => gltfLoader.load(`assets/models/weapons/${id}.glb`, g => res(g.scene), undefined,
      () => { console.warn('武器加载失败', id); res(null); })));
  }
  return weaponCache.get(id);
}

// ── 塔 / 核心的 3D 模型(tools/gen-model-image.mjs 由立绘生成,清单 assets/models/structures/index.json)──
// structModel(势力, kind) → null(没有模型)或 { ready, scene };下载完之前调用方先用立绘,完成后再替换
let structIndex = [];
fetch('assets/models/structures/index.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : [])).then(v => { structIndex = Array.isArray(v) ? v : []; }).catch(() => {});
const structCache = new Map();
export function structModel(faction, kind) {
  const id = `struct_${faction}_${kind}`;
  if (!structIndex.includes(id)) return null;
  let e = structCache.get(id);
  if (!e) {
    e = { ready: false, failed: false, scene: null };
    structCache.set(id, e);
    gltfLoader.load(`assets/models/structures/${id}.glb`, g => { e.scene = g.scene; e.ready = true; }, undefined,
      () => { e.failed = true; console.warn('建筑模型加载失败', id); });
  }
  return e.failed ? null : e;
}

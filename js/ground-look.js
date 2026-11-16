// 战场地面的主题着色(第一轮画面提升 B)— 注入 assets.js 的地形着色器,零额外贴图、零额外 draw call
//   · 问题:AI 生成的地面贴图几乎是平涂(星核荒原亮度标准差只有 1.7/255),整块地面像灰色塑料板
//   · 做法:贴图围绕自身均值做对比度拉伸 → 叠低频色块(苔藓 / 尘土)→ 细节噪声 → 路面磨损 → 岩脚苔藓(用烘焙 AO)
//           → 边缘暗角 → 中线 / 部署线柔和标识(阵营色只做细线,不铺大面积红蓝)
//   · 眼镜是光学透视的:黑 = 透明,所有变暗都有下限(最暗约 ×0.8),主题色保持中高亮度
import * as THREE from 'three';
import { MAP } from './map.js';

// 颜色都是 sRGB 0..1;contrast = 贴图细节对比度放大倍数(贴图越平越大)
//   moss:低频色块里的"生长"色(苔 / 冰 / 熔壳 / 菌斑);dust:另一端的"尘土"色;path:被踩实的路面
const THEMES = {
  starcore: { contrast: 3.2, moss: [0.36, 0.58, 0.54], dust: [0.76, 0.62, 0.50], path: [0.80, 0.76, 0.72], amount: 0.75 },
  glacier:  { contrast: 1.8, moss: [0.40, 0.58, 0.84], dust: [0.86, 0.90, 0.97], path: [0.70, 0.77, 0.86], amount: 0.65 },
  volcano:  { contrast: 1.6, moss: [0.42, 0.26, 0.22], dust: [0.72, 0.56, 0.48], path: [0.62, 0.46, 0.38], amount: 0.65 },
  hive:     { contrast: 2.0, moss: [0.58, 0.78, 0.34], dust: [0.66, 0.46, 0.70], path: [0.54, 0.40, 0.56], amount: 0.6 },
  jungle:   { contrast: 1.3, moss: [0.32, 0.54, 0.24], dust: [0.60, 0.50, 0.36], path: [0.70, 0.68, 0.62], amount: 0.6 },
  fortress: { contrast: 1.5, moss: [0.56, 0.46, 0.38], dust: [0.86, 0.84, 0.80], path: [0.64, 0.66, 0.70], amount: 0.5 },
  abyss:    { contrast: 2.2, moss: [0.44, 0.64, 0.46], dust: [0.88, 0.80, 0.70], path: [0.72, 0.64, 0.60], amount: 0.6 },
  desert:   { contrast: 2.4, moss: [0.72, 0.54, 0.34], dust: [0.96, 0.86, 0.68], path: [0.82, 0.68, 0.50], amount: 0.65 },
};

const lin = rgb => new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);

// 贴图平均色(线性空间):画到 8×8 画布上取平均;取不到时用中灰
function meanColor(tex) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(tex.image, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4 * 255;
    return lin([r / n, gr / n, b / n]);
  } catch { return lin([0.5, 0.5, 0.5]); }
}

// 主题 uniform;sceneId 不认识时用星核荒原
export function groundUniforms(sceneId, groundTex) {
  const th = THEMES[sceneId] || THEMES.starcore;
  return {
    gMean: { value: meanColor(groundTex) },
    gContrast: { value: th.contrast },
    gMoss: { value: lin(th.moss) },
    gDust: { value: lin(th.dust) },
    gPath: { value: lin(th.path) },
    gAmount: { value: th.amount },
    gDeploy: { value: MAP.DEPLOY_LINE },
  };
}

// 片元着色器公共段:uniform + 噪声 + groundLook()
//   p = 战场坐标 xz;ao = Blender 烘焙的遮蔽(0 暗 1 亮);field = 战场半宽 / 半长
export const GROUND_GLSL = /* glsl */`
uniform vec3 gMean; uniform float gContrast; uniform vec3 gMoss; uniform vec3 gDust; uniform vec3 gPath;
uniform float gAmount; uniform float gDeploy;
float gHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
}
float gFbm(vec2 p) { return gNoise(p) * 0.55 + gNoise(p * 2.03 + 7.1) * 0.3 + gNoise(p * 4.1 + 3.7) * 0.15; }
vec3 groundLook(vec3 tex, vec2 p, float ao, vec2 field) {
  // 1. 贴图细节对比度拉伸(围绕均值,保留色相)
  vec3 c = max(gMean + (tex - gMean) * gContrast, gMean * 0.35);
  // 2. 低频色块:一端长苔 / 冰 / 熔壳,一端是浮土
  float m = gFbm(p * 0.33 + 11.0);
  float mossW = smoothstep(0.47, 0.66, m) * gAmount;
  float dustW = (1.0 - smoothstep(0.30, 0.47, m)) * gAmount;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, gMoss * (0.65 + 0.7 * lum / max(dot(gMean, vec3(0.299, 0.587, 0.114)), 0.05)) * 0.9, mossW);
  c = mix(c, gDust, dustW * 0.7);
  // 3. 细节噪声:碎石 / 颗粒的明暗
  c *= 0.9 + 0.2 * gFbm(p * 3.1);
  // 4. 路面:中路 + 两条边路,被踩实、颜色发浅;噪声打断,不是画出来的直线
  float wob = (gNoise(vec2(p.y * 0.6, 3.0)) - 0.5) * 0.5;
  float dMid = abs(p.x - wob);
  float dSide = abs(abs(p.x) - 3.35 - wob * 0.6);
  float path = max(1.0 - smoothstep(0.18, 0.6, dMid), (1.0 - smoothstep(0.14, 0.5, dSide)) * 0.8);
  path *= smoothstep(0.25, 0.6, gFbm(p * 1.4 + 5.0)) * (1.0 - smoothstep(field.y - 0.3, field.y + 0.2, abs(p.y)));
  c = mix(c, gPath * (0.85 + 0.3 * gNoise(p * 6.0)), path * 0.7);
  // 5. 岩脚 / 坑边苔藓:烘焙 AO 暗的地方长苔(岩石和地面的交界不再是一刀切)
  float crev = 1.0 - smoothstep(0.35, 0.8, ao);
  c = mix(c, gMoss * 0.8, crev * 0.55 * smoothstep(0.3, 0.6, gNoise(p * 2.5 + 1.3)));
  // 6. 边缘暗角:靠近战场边的一圈稍暗(下限 ×0.82,眼镜里不会变透明)
  vec2 e = max(abs(p) - (field - 1.1), 0.0) / 1.1;
  c *= 1.0 - 0.18 * clamp(length(e), 0.0, 1.0);
  return c;
}
// 中线 / 部署线标识(加到 diffuse 之后的自发光里,很淡):中线一条暖金细带;部署线是阵营色虚线
vec3 groundMarks(vec2 p, vec2 field) {
  float inside = 1.0 - smoothstep(field.x - 0.4, field.x, abs(p.x));
  float mid = exp(-pow(p.y / 0.05, 2.0)) * 0.10;
  float dash = step(0.45, fract(p.x * 1.6));
  float dep = exp(-pow((abs(p.y) - gDeploy) / 0.03, 2.0)) * dash * 0.07;
  vec3 side = p.y > 0.0 ? vec3(0.25, 0.55, 1.0) : vec3(1.0, 0.35, 0.3);
  return (vec3(1.0, 0.78, 0.4) * mid + side * dep) * inside;
}
`;

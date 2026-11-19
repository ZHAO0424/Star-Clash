# 首屏加载提速计划（2026-11-19）

## 现状（Research）

- 首屏 `js/assets.js` `ready` 预加载 80 张图：单位 6.7MB、法术 3.0MB、建筑 2.6MB、界面 4.2MB、徽章 0.26MB，合计约 17MB，全部 PNG/JPG。
  `main.js` 的 `assetsReady.then(...)` 等全部下完才离开「加载中 x%」。
- 实测下载速度（本机）：Render 约 166KB/s（17MB ≈ 100s），GitHub Pages 约 17KB/s（≈ 17 分钟）。
- `loadImage` 没有超时：任一请求挂住，进度永远停在某个百分比。
- 服务器静态文件只发 `cache-control: no-cache`，没有 ETag/Last-Modified，也不处理 `If-None-Match`
  → 浏览器每次刷新都整份重下，「第二次打开会快」实际不成立。
- three.js 从 unpkg 取（three.module.js 1.27MB，本机 11s），在进度条出现之前就要等。

## 方案（Plan）

1. **图片转 WebP**（Pillow，质量 85，带透明的保留 alpha）：`assets/units|structures|spells|emblems/*.png`、
   `assets/ui/*.png`、`bg_menu.jpg` 转为同名 `.webp`，代码里路径改成 `.webp`，原 PNG/JPG 删除（git 历史里有）。
   转换脚本 `tools/to_webp.py` 可重跑。
2. **首屏分两段**：界面图 + 徽章（菜单要用的，几百 KB）到位就进标题/主页；单位、建筑、法术图在后台继续。
   `ready` 语义不变（全部完成）；新增 `menuReady`。「卡组 / 快速开局 / 人机 / 联机 / 图鉴」按钮保持禁用直到 `ready`，
   按钮上不加新文字（避免多语言文案变动），主页显示加载进度小字。
3. **单张图超时 15s**：超时按缺失处理（返回 null → 已有的几何体/纯文字回退）。
4. **服务器支持协商缓存**：按 mtime+size 生成弱 ETag，命中 `If-None-Match` 回 304。仍保留 `no-cache`，部署后立即生效。
5. **three.js 本地化**：`vendor/three@0.160.0/` 放 `build/three.module.js` 和用到的 `examples/jsm` 文件；
   import map 改指本地；服务器 `PUBLIC_DIRS` 加 `vendor`。

## 验收

- `npm test` 全过。
- 本地截图：标题页、主页、对战 HUD、卡面插图正常（与改前一致）。
- 资源总量与首屏字节数改前改后对比写进本文档末尾。
- 推送部署后 curl 线上：webp 200、ETag 304、three 本地路径 200。

## 风险

- 图片画质：WebP q85 对立绘肉眼无差，截图抽查。
- XR 画布用 `img` 绘制卡面：WebP 在 Quest / 眼镜浏览器均支持。
- vendor 里 three 的 addons 互相 import（相对路径），需要整树拷贝用到的文件及其依赖。

## 落地结果（2026-11-19）

| 项 | 改前 | 改后 |
|-|-|-|
| 首屏预加载图片 | 80 张 PNG/JPG，17.2MB，全部下完才进菜单 | 80 张 WebP，3.1MB；菜单只等界面图+徽章，立绘后台加载 |
| 单张图卡住 | 永远卡在某个百分比 | 15s 超时按缺失处理 |
| 再次打开 | 每次整份重下（无 ETag） | 弱 ETag，文件没变回 304 |
| three.js | unpkg three.module.js 1.27MB | 本站 vendor/three，min 版 + 7 个 addon 共 824KB |

- 菜单出现后「快速开战」按钮上显示立绘下载进度，下完才开放快速开战 / 人机 / 联机 / 卡组 / 图鉴（图鉴原来不等，现在也等）。
- 方案 2 里「主页显示加载进度小字」改为直接写在主按钮上，没有新增文案键。
- `npm test` 101 项全过；本地 304 实测通过；对战截图 `docs/graphics/load-speed-hud.png` 卡面、费用图标正常。
- 没改：XR 控制图标（`assets/ui/xr/*.png`，进 XR 才加载）、每张地图进场时的地形与场景贴图（每张约 5–6MB，「正在加载战场」阶段）、单位 GLB 模型。若进对局也慢，下一步压这三块。

## 第二轮：开局「加载战场」卡住（2026-11-19）

- 现象：GitHub Pages 版开局一直停在「战场加载中」。`main.js beginBattle` 等 `loadScene()`，每张图要下地形 GLB 约 2–3MB + 贴图约 1.4MB，Pages 本机实测约 17KB/s ≈ 4 分钟，且没有超时。
- 地形 GLB 用 gltf-transform Draco 压缩：8 张图 17MB → 1.6MB（单张 ~200KB）；解码器 `vendor/three/addons/libs/draco/gltf/`（wasm 192KB，首次一次）。
  Draco 解码出来是普通 Float32 顶点，`stretchTerrain` 直接改顶点不受影响。
- 战场贴图（地面 / 岩壁 / 裂隙 / 天空 / 概念图 / 装饰立绘）与冰川菜单预览图转 WebP：20.4MB → 9.1MB；`sceneArt()` 统一 `.webp`。
- `loadScene` 加 25s 超时：超时先用平面战场开局，后台继续下载，下一局用上；失败的结果不缓存。
- 服务器 MIME 加 `.wasm`。验证：`npm test` 104 过；星核 / 熔岩 / 冰川 / 蜂巢截图 `docs/graphics/draco-*.png` 与改前一致；浏览器确认 Draco 解码器加载、沙漠场景 textured=true、无报错。
- 单张图开局下载量：约 4MB → 约 0.65MB（另有一次性解码器 0.25MB）。单位 GLB 模型（共 16MB）仍是开局后按需懒加载，没有压。

## 第三轮：进对局后单位全是立绘（2026-11-19）

- 原因：单位 / 塔 GLB 共 20.6MB（单个 0.4–1.2MB，主要是网格和骨骼动画数据），开局后懒加载；GitHub Pages 国内约 17KB/s，一局 10+ 种单位要好几分钟才换成模型。
- `gltf-transform resample`（去冗余关键帧）+ `meshopt`：20.6MB → 8.9MB；GLTFLoader 挂 `MeshoptDecoder`（`vendor/three/addons/libs/meshopt_decoder.module.js`）。
  meshopt 输出配合 gzip 效果最好：Pages 本来就 gzip；Node 服务器新增 gzip（html/js/css/json/md/glb/wasm，按 etag 缓存）。传输量合计约 6.6MB（原 ~11MB+）。例：swarm_warrior 1.19MB → 233KB。
- 验证：32 个单位 + 12 个塔模型全部加载成功、动画片段与原文件逐个同名同数；对战截图 `docs/graphics/meshopt-units.png`。武器 GLB 未动。
- 坑：用 Python 改服务器时 `\b` 被写成退格符，正则永远不匹配、gzip 静默失效，已修。

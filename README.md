# 星轨对决

WebXR 实时对战卡牌游戏:桌面鼠标、手机触屏都能玩,支持 WebXR 的设备可进 XR。

- **GitHub Pages(静态)**:打开即可人机对战。联机和排行榜需要服务器,在这里不可用,联机版在 https://star-clash.onrender.com。
- **联机版**:部署到任意 Node 20+ 平台,启动命令 `npm start`(零依赖,不需要 npm install),端口读 `PORT` 环境变量;
  在反向代理后面建议设 `TRUST_PROXY=1`。仓库附带 `render.yaml`,可在 Render 一键创建免费 Web Service。
- 本地运行:`node server/server.mjs`,浏览器打开 http://localhost:8788。

本仓库由源项目的 `tools/build-pages.mjs` 自动生成,请勿手改。

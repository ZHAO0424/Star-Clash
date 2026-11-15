// 棋盘底座尺寸(纯数据,不依赖 three):js/arena.js、js/props3d.js、js/scene.js 和 tools/build_terrain.py 共用这一份
//   hx / hz:台面半宽 / 半长;top:台面高度;thick:底座厚度;rim:金色边框宽
//   frame:台面上的黄线内框(离台面边缘 frameMargin),地形岛的轮廓正好落在这条线上
export const ARENA = { hx: 7.1, hz: 9.4, top: -0.32, thick: 0.55, rim: 0.42, frameMargin: 0.71 };
ARENA.frame = { x: ARENA.hx - ARENA.frameMargin, z: ARENA.hz - ARENA.frameMargin };   // ±6.39 × ±8.69

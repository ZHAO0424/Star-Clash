// 截图 + 渲染计数:无头 Chrome + CDP(只用 Node 自带的 WebSocket / fetch,不依赖 puppeteer)
// 用法:node tools/shot.mjs <out.png> [scene=starcore] [选项]
//   --view=yaw,pitch,zoom,panX,panZ   桌面视角(默认 = 固定俯视;特写示例 --view=0,0.15,0.55,-2.1,2.4)
//   --scale=0.6                        输出缩放(控制 png 大小)
//   --units=0                          不放单位(看地形 / 墙体)
//   --js="..."                         截图前在页面里执行的额外 JS
//   --lang=zh|en                       界面语言(默认跟随浏览器)
//   PORT=8790(默认)
// 进人机局 → 冻结模拟 → 双方各放 5 个单位 → 等模型下载 → 读 renderer.info(含关掉主光阴影的 XR 口径)→ 截图
// 输出一行 JSON:{ calls, triangles, geometries, textures, noShadow: {...} }
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pos = process.argv.slice(2).filter(a => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const i = a.indexOf('=');
  return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)];
}));
const [out, sceneId = 'starcore'] = pos;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9333 + Math.floor(Math.random() * 300);
const prof = mkdtempSync(join(tmpdir(), 'sc-chrome-'));
const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, '--headless=new', `--user-data-dir=${prof}`,
  '--window-size=1600,900', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pend = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const pg = list.find(t => t.type === 'page');
      if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r); break; }
    } catch {}
    await sleep(200);
  }
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.error('[page]', m.params.args.map(a => a.value ?? a.description).join(' '));
    else if (m.method === 'Runtime.exceptionThrown') console.error('[exc]', m.params.exceptionDetails.exception?.description);
  };
}
const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};
try {
  await connect();
  await cmd('Runtime.enable'); await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  // 固定随机种子 + 预置偏好,保证改前改后同一画面
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{let a=12345;window.__seed=n=>{a=n};Math.random=()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
    try{localStorage.setItem('sg.scene',JSON.stringify('${sceneId}'));localStorage.setItem('sg.faction',JSON.stringify('steel'));localStorage.setItem('sg.firstMatchSeen','true');${opt.lang ? `localStorage.setItem('sg.lang','${opt.lang}');` : ''}}catch{}})();` });
  await cmd('Page.navigate', { url: `http://localhost:${process.env.PORT || 8790}/?debug` });
  await sleep(4000);
  await ev(`window.__seed(777); document.querySelector('#btn-fight').click(); true`);
  for (let i = 0; i < 60 && !(await ev(`!!window.__bg?.session`)); i++) {
    if (i % 10 === 9) await ev(`document.querySelector('#btn-fight').click(); true`);
    await sleep(500);
  }
  await sleep(1500);
  const info = await ev(`(async () => {
    const { CARDS } = await import('/js/cards.js');
    const s = window.__bg.session; const g = s.game;
    s.tick = () => {};   // 冻结模拟,画面照常渲染
    if (${opt.units === '0'}) return { enemy: g.e.faction };
    const P = ['steel_infantry','steel_tank','steel_shield','steel_artillery','steel_infantry'];
    const E = Object.keys(CARDS).filter(k => k.startsWith(g.e.faction + '_') && CARDS[k].type === 'unit' && !CARDS[k].token).slice(0, 5);
    const pts = [[-2.2, 2.6], [-1.0, 3.2], [1.2, 2.4], [2.4, 3.4], [0.2, 1.4]];
    P.forEach((id, i) => g.spawnUnit('p', CARDS[id], pts[i][0], pts[i][1], 1));
    E.forEach((id, i) => g.spawnUnit('e', CARDS[id], pts[i][0] * 0.9, -pts[i][1] + 0.3, 1));
    return { enemy: g.e.faction, E };
  })()`);
  await sleep(9000);   // 等模型下载、动画走几帧
  if (opt.view) {
    const [yaw, pitch, zoom, panX, panZ] = opt.view.split(',').map(Number);
    await ev(`(() => { const sc = window.__bg.scene; Object.assign(sc.view, { yaw: ${yaw}, pitch: ${pitch}, zoom: ${zoom}, panX: ${panX}, panZ: ${panZ} }); sc.fitCamera(); true })()`);
  }
  if (opt.js) await ev(opt.js);
  await sleep(600);
  const stats = await ev(`(() => { const sc = window.__bg.scene, r = sc.renderer; r.info.autoReset = false;
    const m = () => { r.info.reset(); sc.render?.(); const i = r.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length }; };
    const o = m(); const key = sc.look?.lights.key; let xr = null;
    if (key) { key.castShadow = false; m(); xr = m(); key.castShadow = true; m(); }
    r.info.autoReset = true; return { ...o, noShadow: xr }; })()`);
  const scale = Number(opt.scale || 1);
  const shot = await cmd('Page.captureScreenshot', { format: 'png', ...(scale !== 1 ? { clip: { x: 0, y: 0, width: 1600, height: 900, scale } } : {}) });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log(JSON.stringify({ scene: sceneId, ...info, ...stats }));
} finally { try { ws?.close(); } catch {} proc.kill(); }

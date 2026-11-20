// 菜单界面审计截图:无头 Chrome 依次打开主页 / 人机设置 / 联机设置 / 图鉴 / 设置,
// 每屏在桌面(1600×900)和手机(390×844)各截一张(文件名带语言),并统计该屏实际渲染出来的字号 / 字重 / 字体
// 以及这次页面加载实际下载的 woff2 字节数
// 用法:PORT=8788 node tools/menu-shots.mjs <输出目录> [--lang=zh|en]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = process.argv[2] || 'docs/graphics/ui-v1';
const lang = (process.argv.find(a => a.startsWith('--lang=')) || '').slice(7) || 'zh';
mkdirSync(outDir, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9333 + Math.floor(Math.random() * 300);
const prof = mkdtempSync(join(tmpdir(), 'sc-menu-'));
const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, '--headless=new', `--user-data-dir=${prof}`,
  '--window-size=1600,900', '--enable-gpu', '--use-angle=d3d11', 'about:blank'], { stdio: 'ignore' });
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
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
}
const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

// 每屏:进入方式(在主页上执行的 JS)
const SCREENS = [
  ['home', null],
  ['setup-ai', `document.querySelector('#btn-start').click()`],
  ['setup-online', `document.querySelector('#btn-home-online').click()`],
  ['codex', `document.querySelector('#btn-codex').click()`],
  ['settings', `document.querySelector('#btn-settings').click()`],
];
// 当前菜单屏有没有横向溢出(手机上不允许横向滚动)
const OVERFLOW_X = `[...document.querySelectorAll('.menu-screen')].some(s => s.style.display !== 'none' && s.scrollWidth > s.clientWidth + 1)`;
// 这次页面加载实际下载的字体字节(woff2 切片)
const FONT_BYTES = `performance.getEntriesByType('resource').filter(e => e.name.endsWith('.woff2')).reduce((a, e) => a + (e.encodedBodySize || e.transferSize), 0)`;
// 统计当前可见文字的字号分布
const TYPE_AUDIT = `(() => {
  const sizes = {}, fams = new Set(), weights = {};
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode, el = n.parentElement;
    if (!n.textContent.trim() || !el || !el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const r = el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const s = Math.round(parseFloat(cs.fontSize)); sizes[s] = (sizes[s] || 0) + 1;
    weights[cs.fontWeight] = (weights[cs.fontWeight] || 0) + 1; fams.add(cs.fontFamily.split(',')[0]);
  }
  return { sizes, weights, fams: [...fams] };
})()`;

const report = {};
try {
  await connect();
  await cmd('Runtime.enable'); await cmd('Page.enable');
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('sg.lang','${lang}');localStorage.setItem('sg.firstMatchSeen','true');}catch{}` });
  // 预热:第一次冷加载立绘较慢,先完整加载一遍再截图
  await cmd('Page.navigate', { url: `http://localhost:${process.env.PORT || 8788}/` });
  for (let i = 0; i < 480 && !(await ev(`!document.querySelector('#btn-codex')?.disabled`)); i++) await sleep(250);
  for (const [vw, vh, mobile, tag] of [[1600, 900, false, 'desktop'], [390, 844, true, 'mobile']]) {
    await cmd('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile });
    for (const [name, open] of SCREENS) {
      await cmd('Page.navigate', { url: `http://localhost:${process.env.PORT || 8788}/` });
      for (let i = 0; i < 160 && !(await ev(`!document.querySelector('#btn-codex')?.disabled`)); i++) await sleep(250);
      await sleep(800);
      if (open) { await ev(open); await sleep(1200); }
      await ev('document.fonts.ready.then(() => true)');
      const shot = await cmd('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, `${tag}-${name}-${lang}.png`), Buffer.from(shot.result.data, 'base64'));
      report[`${tag}-${name}`] = { ...await ev(TYPE_AUDIT), fontBytes: await ev(FONT_BYTES), overflowX: await ev(OVERFLOW_X) };
    }
  }
  writeFileSync(join(outDir, `type-audit-${lang}.json`), JSON.stringify(report, null, 1));
  console.log(Object.entries(report).map(([k, v]) => `${k}: ${Object.keys(v.sizes).length} sizes [${Object.keys(v.sizes).join(',')}] fonts=${v.fams.join('|')} woff2=${v.fontBytes}B${v.overflowX ? ' OVERFLOW-X' : ''}`).join('\n'));
} finally { try { ws?.close(); } catch {} proc.kill(); }

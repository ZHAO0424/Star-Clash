// 菜单界面审计截图:无头 Chrome 依次打开标题 / 主页 / 备战 / 卡组 / 联机 / 图鉴 / 设置,
// 每屏在桌面(1600×900)和手机(390×844)各截一张,并统计该屏实际渲染出来的字号 / 字重 / 字体
// 用法:PORT=8788 node tools/menu-shots.mjs <输出目录> [--lang=zh|en]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = process.argv[2] || 'docs/graphics/ui-audit';
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
  ['title', null],
  ['home', `document.querySelector('#btn-enter-game')?.click()`],
  ['prepare', `document.querySelector('#btn-prepare').click()`],
  ['deck', `document.querySelector('#btn-home-deck').click()`],
  ['online', `document.querySelector('#btn-prepare').click(); setTimeout(()=>document.querySelector('#btn-online').click(), 300)`],
  ['codex', `document.querySelector('#btn-codex').click()`],
  ['settings', `document.querySelector('#btn-settings').click()`],
];
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
  for (const [vw, vh, mobile, tag] of [[1600, 900, false, 'desktop'], [390, 844, true, 'mobile']]) {
    await cmd('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile });
    for (const [name, open] of SCREENS) {
      await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('sg.lang','${lang}');localStorage.setItem('sg.firstMatchSeen','true');localStorage.setItem('sg.entered', ${name === 'title' ? "'false'" : "'true'"});}catch{}` });
      await cmd('Page.navigate', { url: `http://localhost:${process.env.PORT || 8788}/` });
      for (let i = 0; i < 40 && !(await ev(`!document.querySelector('#btn-quick')?.disabled || getComputedStyle(document.querySelector('#title-screen')).display !== 'none'`)); i++) await sleep(250);
      await sleep(800);
      if (open) { await ev(open); await sleep(1200); }
      const shot = await cmd('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, `${tag}-${name}.png`), Buffer.from(shot.result.data, 'base64'));
      report[`${tag}-${name}`] = await ev(TYPE_AUDIT);
    }
  }
  writeFileSync(join(outDir, 'type-audit.json'), JSON.stringify(report, null, 1));
  console.log(Object.entries(report).map(([k, v]) => `${k}: ${Object.keys(v.sizes).length} sizes [${Object.keys(v.sizes).join(',')}] fonts=${v.fams.join('|')}`).join('\n'));
} finally { try { ws?.close(); } catch {} proc.kill(); }

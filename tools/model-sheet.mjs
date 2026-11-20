// 模型检查页的截图驱动:无头 Chrome 打开 tools/model-sheet.html,等标题变成 READY 再截图,并打印标题(自动摆正的 rot)和页面报错
// 用法:node tools/model-sheet.mjs <out.png> "<query 串,如 ids=a,b&clip=attack&t=0.45>"
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [out, query = ''] = process.argv.slice(2);
const ids = (new URLSearchParams(query).get('ids') || '').split(',').filter(Boolean);
const W = 300 * Math.max(1, ids.length), H = 360;
const port = 9500 + Math.floor(Math.random() * 300);
const proc = spawn(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [`--remote-debugging-port=${port}`, '--headless=new',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ms-'))}`, '--allow-file-access-from-files', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pend = new Map(); const errors = [];
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = l.find(t => t.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r); } } catch {}
  await sleep(200);
}
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
};
const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
try {
  await cmd('Runtime.enable'); await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const url = pathToFileURL(resolve('tools/model-sheet.html')).href + '?' + query;
  await cmd('Page.navigate', { url });
  let title = '';
  for (let i = 0; i < 60 && !title.startsWith('READY'); i++) { await sleep(250); title = (await cmd('Runtime.evaluate', { expression: 'document.title', returnByValue: true })).result.result.value || ''; }
  await sleep(300);
  const shot = await cmd('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log(title || '(not ready)');
  if (errors.length) console.log('ERRORS', errors.join(' | '));
} finally { try { ws?.close(); } catch {} proc.kill(); }

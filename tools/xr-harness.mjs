// XR 出牌交互线束(第七轮):无头 Chrome + CDP,不进真正的 WebXR,直接调 XRControls 的输入核心验证
//   手牌行几何(近边视线角 / 上沿角 / 角缝 / 离眼距离 / 卡牌尺寸,三档棋盘)、磁吸半径、松手落点选择
//   (150ms 宽限 / 超时退回 / 追踪丢失 / 射线捏紧快照)、「超出战场」提示、放回静默、买不起可拿起。
// 先跑一段不进 XR 的桌面对局,最后打印控制台错误。需要 ?debug 暴露的 window.__bg.xr。
// 用法:先 node server/server.mjs 8796,再 node tools/xr-harness.mjs [scene=starcore](PORT 环境变量改端口)
// 只是证据收集,不是断言测试;真机手势(追踪抖动、射线跳动的真实幅度)仍要眼镜实测。
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pos = process.argv.slice(2).filter(a => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const i = a.indexOf('=');
  return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)];
}));
const sceneId = pos[0] || 'starcore';
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
  await cmd('Page.navigate', { url: `http://localhost:${process.env.PORT || 8796}/?debug` });
  await sleep(4000);

  const errors = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  });
  await ev(`document.querySelector('#btn-fight').click(); true`);
  for (let i = 0; i < 60 && !(await ev(`!!window.__bg?.session`)); i++) {
    if (i % 10 === 9) await ev(`document.querySelector('#btn-fight').click(); true`);
    await sleep(500);
  }
  // ── desktop battle (no XR): wait for battle, run 8 s ──
  for (let i = 0; i < 40 && (await ev(`window.__bg.game.phase`)) !== 'battle'; i++) await sleep(500);
  const snap = `(() => { const g = window.__bg.game; return { phase: g.phase, time: g.time, units: g.units.length, hand: g.p.hand.map(c => c.id).join(','), mana: g.p.mana, eMana: g.e.mana }; })()`;
  const d0 = await ev(snap);
  await sleep(8000);
  const d1 = await ev(snap);
  console.log('desktop', JSON.stringify({ d0, d1 }));

  const r = await ev(`(async () => {
    const { ARENA } = await import('/js/arena-dims.js');
    const { t } = await import('/js/i18n.js');
    const B = window.__bg, xr = B.xr, sc = B.scene;
    const V = xr.cardRow.position.constructor, Ray = xr.inputs[0].pressRay.constructor;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const step = n => { for (let i = 0; i < n; i++) xr.update(1 / 60); };
    xr.enter(false); step(8);
    const out = {};
    const deg = p => Math.atan2(-p.y, -p.z) * 180 / Math.PI;
    const edge = sc.world.localToWorld(new V(0, ARENA.top + 0.3, ARENA.hz + ARENA.rim));
    const top = xr.cardRow.localToWorld(new V(0, 0.05, 0)), bot = xr.cardRow.localToWorld(new V(0, -0.127, 0));
    const ctr = xr.cardRow.getWorldPosition(new V());
    const size = new V(); xr.cards[0].mesh.getWorldScale(size);
    out.geom = { boardSize: localStorage.getItem('sg.xrBoardSize'), scale: sc.world.scale.x, worldPos: sc.world.position.toArray(),
      edgeDeg: deg(edge), topDeg: deg(top), bottomDeg: deg(bot), gapDeg: deg(top) - deg(edge), rowDist: ctr.length(),
      cardCm: [0.072 * size.x * 100, 0.1 * size.y * 100], hudZ: xr.hud.mesh.position.z,
      farEdgeZ: sc.world.localToWorld(new V(0, 0, -(ARENA.hz + ARENA.rim))).z };
    const st = xr.inputs[0];
    const g = () => B.game;
    const cardPos = i => xr.cards[i].mesh.getWorldPosition(new V());
    const field = (x, z, up = 0.05) => sc.world.localToWorld(new V(x, ARENA.top, z)).add(new V(0, up, 0));
    const toast = () => document.querySelector('#toast').textContent;
    const clearToast = () => { document.querySelector('#toast').textContent = ''; };
    const handIds = () => g().p.hand.map(c => c.id).join(',');
    const grabNear = idx => { st.rayActive = false; st.ray = null; const p = cardPos(idx).add(new V(0, 0.09, 0.03)); xr.handInput(st, 0.05, p); xr.handInput(st, 0.01, p); return st.grab?.idx; };
    const open = p => xr.handInput(st, 0.05, p);
    const playable = () => g().p.hand.findIndex((c, i) => g().canPlay('p', i) && c.type === 'unit');
    const ok = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message; } };
    // 1) magnetic hover / grab radius
    g().p.mana = g().p.manaMax;
    xr.handInput(st, 0.05, cardPos(1).add(new V(0, 0.09, 0.03))); out.hoverAt9_5cm = st.hover;
    xr.handInput(st, 0.05, cardPos(1).add(new V(0, 0.125, 0))); out.hoverAt12_5cm = st.hover;
    // 2) release frame jumps out of arena, valid hit < 150 ms old -> plays
    let i = playable(); let before = handIds();
    out.magnetGrab = grabNear(i);
    xr.handInput(st, 0.01, field(0, 5)); xr.handInput(st, 0.01, field(0, 5));
    out.dragValid = st.grab?.valid;
    open(field(0, 5, 0.9));
    out.playedRecent = handIds() !== before;
    // 3) valid hit older than 150 ms -> returns + toast
    step(2); g().p.mana = g().p.manaMax; clearToast();
    i = playable(); before = handIds(); grabNear(i);
    xr.handInput(st, 0.01, field(-1, 5));
    xr.handInput(st, 0.01, field(-1, 5, 0.9));
    await sleep(220);
    open(field(-1, 5, 0.9));
    out.staleReturned = handIds() === before; out.staleToast = toast(); out.tOutOfArena = t('tOutOfArena');
    // 4) tracking lost, valid hit < 150 ms -> plays
    step(2); g().p.mana = g().p.manaMax;
    i = playable(); before = handIds(); grabNear(i);
    xr.handInput(st, 0.01, field(1, 5));
    xr.loseHandTracking(st);
    out.lostPlayed = handIds() !== before;
    open(field(1, 5, 0.9)); st.waitForOpen = false;
    // 5) tracking lost, valid hit > 150 ms -> returns + toast
    step(2); g().p.mana = g().p.manaMax; clearToast();
    i = playable(); before = handIds(); grabNear(i);
    xr.handInput(st, 0.01, field(1, 4));
    await sleep(220);
    xr.loseHandTracking(st);
    out.lostLateReturned = handIds() === before; out.lostToast = toast();
    open(field(1, 5, 0.9)); st.waitForOpen = false;
    // 6) out-of-arena hint after 0.3 s; put-back is silent
    step(2); g().p.mana = g().p.manaMax;
    i = playable(); grabNear(i);
    const off = cardPos(i).add(new V(0.15, 0.1, 0));
    xr.handInput(st, 0.01, off); step(1); out.hintEarly = xr.placementHint.mesh.visible;
    await sleep(350); xr.handInput(st, 0.01, off); step(1);
    out.hintLate = xr.placementHint.mesh.visible && xr.placementHint.label;
    clearToast(); const home = xr.cardRow.localToWorld(xr.cards[i].home.clone());
    xr.handInput(st, 0.01, home); open(home);
    out.putBackToast = toast(); out.putBackGrabCleared = !st.grab;
    // 7) ray: grab without dwell; ray jumps while fingers open -> firm snapshot plays
    step(2); g().p.mana = g().p.manaMax;
    i = playable(); before = handIds();
    const origin = new V(0.15, -0.25, -0.05);
    const aim = p => new Ray(origin.clone(), p.clone().sub(origin).normalize());
    st.rayActive = true; st.ray = aim(cardPos(i)); st.pressRay.copy(st.ray); st.pressDwell = 0;
    xr.handInput(st, 0.05, origin); xr.handInput(st, 0.01, origin);
    out.rayGrab = st.grab ? { idx: st.grab.idx, want: i, viaRay: st.grab.viaRay } : null;
    st.ray = aim(field(0.5, 6, 0)); xr.handInput(st, 0.01, origin);
    out.rayFirm = Boolean(st.grab?.firm?.valid);
    st.ray = new Ray(origin.clone(), new V(0, 1, 0)); xr.handInput(st, 0.03, origin);
    out.rayCurrentAfterJump = st.grab ? st.grab.hit : 'released';
    open(origin);
    out.rayPlayed = handIds() !== before;
    st.rayActive = false; st.ray = null;
    // 8) unaffordable card can be picked up; valid drop -> no-mana toast + return
    step(2); clearToast();
    g().p.mana = 0; i = g().p.hand.findIndex(c => c.cost > 0 && c.type === 'unit'); before = handIds();
    out.poorGrab = grabNear(i);
    xr.handInput(st, 0.01, field(0, 5)); open(field(0, 5));
    out.poorReturned = handIds() === before; out.poorToast = toast(); out.tNoMana = t('tNoMana');
    step(3);
    // other board sizes
    out.sizes = {};
    for (const s of ['standard', 'large', 'small']) {
      localStorage.setItem('sg.xrBoardSize', JSON.stringify(s)); xr.applyBoardSize(); xr.cardRowPlaced = false; step(2);
      const e = sc.world.localToWorld(new V(0, ARENA.top + 0.3, ARENA.hz + ARENA.rim));
      const tp = xr.cardRow.localToWorld(new V(0, 0.05, 0));
      out.sizes[s] = { scale: sc.world.scale.x, edgeDeg: deg(e), topDeg: deg(tp), gap: deg(tp) - deg(e), hudZ: xr.hud.mesh.position.z,
        farEdgeZ: sc.world.localToWorld(new V(0, 0, -(ARENA.hz + ARENA.rim))).z, nearEdgeZ: e.z };
    }
    localStorage.removeItem('sg.xrBoardSize');
    xr.exit();
    return out;
  })()`);
  console.log('xr', JSON.stringify(r, null, 1));
  await sleep(1500);
  console.log('after-exit', JSON.stringify(await ev(snap)));
  console.log('console errors', JSON.stringify(errors));
} finally { try { ws?.close(); } catch {} proc.kill(); }

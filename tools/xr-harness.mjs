// XR 出牌交互线束(第七轮建,第十轮改):无头 Chrome + CDP,不进真正的 WebXR,直接调 XRControls 的输入核心验证
//   手牌行几何(近边视线角 / 上沿角 / 角缝 / 离眼距离 / 卡牌尺寸,三档棋盘);
//   第十轮手部出牌(模拟逐帧手位):手牌带外不选、左右扫选牌顺序与滞回、抬起不够放回、抬起确认后落点近边起步并跟手、
//   松手在落点出牌、单位夹在部署区、退回确认线取消、法术推到敌方半场、回收区弃牌、追踪丢失 150ms 兜底、
//   买不起提示、UI 换边后的映射;手柄射线抓放。每项打印 PASS / FAIL 和数值。
// 先跑一段不进 XR 的桌面对局,最后打印控制台错误。需要 ?debug 暴露的 window.__bg.xr。
// 用法:先 node server/server.mjs 8796,再 node tools/xr-harness.mjs [scene=starcore](PORT 环境变量改端口)
// 真机手势(追踪抖动的真实幅度、增益 / 阈值手感)仍要眼镜实测。
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
    const field = (x, z, up = 0.05) => sc.world.localToWorld(new V(x, ARENA.top, z)).add(new V(0, up, 0));
    const toast = () => document.querySelector('#toast').textContent;
    const clearToast = () => { document.querySelector('#toast').textContent = ''; };
    const handIds = () => g().p.hand.map(c => c.id).join(',');
    const ok = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message; } };
    const r2 = v => Math.round(v * 100) / 100;
    const checks = [];
    const check = (name, pass, data) => { checks.push({ name, pass: Boolean(pass), ...data }); };
    // ── 第十轮:手位选牌 + 抬起确认 + 落点跟手。手位一律用"视图坐标里相对手牌行中心的偏移"给出(米)──
    let played = null, discarded = null;
    const origPlay = xr.cb.onPlay, origDiscard = xr.cb.onDiscard;
    xr.cb.onPlay = (i, x, z) => { const r = origPlay(i, x, z); played = { i, x, z, ok: r }; return r; };
    xr.cb.onDiscard = i => { discarded = { i }; return origDiscard?.(i); };
    const rowC = () => xr.viewPoint(xr.cardRow.getWorldPosition(new V()));
    const at = o => xr.uiInner.localToWorld(rowC().add(new V(o[0], o[1], o[2])));
    const cardX = i => xr.viewPoint(xr.cardRow.localToWorld(xr.cards[i].home.clone())).x - rowC().x;
    let hand = [0, 0, 0];
    const moveTo = (o, n = 1, pinch = 0.01) => {   // n 帧线性移过去,每帧 1/60s
      const a = hand.slice();
      for (let k = 1; k <= n; k++) xr.handInput(st, pinch, at(a.map((v, j) => v + (o[j] - v) * k / n)), 1 / 60);
      hand = o.slice();
    };
    const hold = n => moveTo(hand, n);
    const openHand = () => { xr.handInput(st, 0.05, at(hand), 1 / 60); };
    const reset = () => { step(3); g().p.mana = g().p.manaMax; clearToast(); played = discarded = null; st.waitForOpen = false; st.pinched = false; st.hover = -1; };
    const unitIdx = () => g().p.hand.findIndex(c => c.type === 'unit');
    const marker = () => st.grab?.hit ? { x: r2(st.grab.hit.x), z: r2(st.grab.hit.z) } : null;
    st.rayActive = false; st.ray = null;
    // 1) 手牌带外不选
    reset();
    const outs = { above: [0, 0.12, 0], below: [0, -0.12, 0], body: [0, 0.03, 0.14], board: [0, 0.03, -0.14], side: [cardX(4) + 0.07, 0.03, 0] };
    const outHover = {};
    for (const [k, o] of Object.entries(outs)) { hand = o; openHand(); outHover[k] = st.hover; }
    hand = [0, 0.03, 0]; openHand(); outHover.center = st.hover;
    check('wrong band → no selection', Object.entries(outHover).every(([k, h]) => (k === 'center' ? h === 2 : h === -1)), { hover: outHover });
    // 2) 左右扫过:按顺序选中 0..4,切换点在交界外约 0.6cm(滞回)
    const seq = [], switches = [];
    for (let x = -0.25; x <= 0.2501; x += 0.002) {
      hand = [x, 0.03, 0.02]; openHand();
      if (seq[seq.length - 1] !== st.hover) { seq.push(st.hover); switches.push(r2(x * 100)); }
    }
    check('lateral sweep selects cards in order', seq.join(',') === '-1,0,1,2,3,4,-1', { seq: seq.join(','), switchAtCm: switches.join(','), cardXcm: [0, 1, 2, 3, 4].map(i => r2(cardX(i) * 100)).join(',') });
    // 3) 捏住抬 <7cm 松手:放回、不出牌、不提示
    reset();
    let i = unitIdx(); let before = handIds();
    hand = [cardX(i), 0.03, 0]; openHand(); moveTo(hand, 1);
    const grabbedShort = st.grab ? { idx: st.grab.idx, want: i, stage: st.grab.stage } : null;
    moveTo([cardX(i), 0.03 + 0.04, -0.02], 10);
    const shortStage = st.grab?.stage, shortLift = r2(st.grab?.lift ?? -1);
    step(1);   // 跑一帧 update 看反馈(手部输入是直接喂的,update 不会动这只"手")
    const heldVisuals = { liftHint: xr.liftHint.mesh.visible, ghost: xr.dropGhost.visible, marker: sc.deployMarker.group.visible };
    openHand();
    check('pinch + lift <7cm + release → returns, no play', grabbedShort?.idx === i && shortStage === 'held' && heldVisuals.liftHint && !heldVisuals.ghost && !played && handIds() === before && !toast() && xr.cards[i].returning,
      { grabbed: grabbedShort, liftProgress: shortLift, heldVisuals, toast: toast() });
    // 4) 捏住抬 ≥7cm 确认 → 落点在近边;右移 5cm、前推 5cm → 落点向右、向深;松手在落点出牌
    reset();
    i = unitIdx(); before = handIds();
    hand = [cardX(i), 0.03, 0]; openHand(); moveTo(hand, 1);
    moveTo([cardX(i), 0.03 + 0.06, -0.04], 12);
    const stage4 = st.grab?.stage; hold(15);
    const m0 = marker();
    moveTo([cardX(i) + 0.05, 0.09, -0.09], 30); hold(30);
    const m1 = marker(), hit1 = { x: st.grab?.hit?.x, z: st.grab?.hit?.z }, snapped1 = st.grab?.snapped;
    step(12);   // 牌影 0.15s 飞到落点
    const gp = xr.viewPoint(xr.dropGhost.position.clone()), hp = xr.viewPoint(st.grab.hit.point.clone());
    const visuals = { ghost: xr.dropGhost.visible, ghostAboveMarkerCm: r2((gp.y - hp.y) * 100), arc: xr.dropLink.visible, liftHint: xr.liftHint.mesh.visible,
      heldScale: xr.cards[i].mesh.scale.x, marker: sc.deployMarker.group.visible && sc.deployMarker.state };
    openHand();
    check('lift ≥7cm confirms; marker starts at near edge', stage4 === 'aiming' && m0 && Math.abs(m0.z - 7.0) < 0.35,
      { m0, expectX: r2(Math.max(-4.8, Math.min(4.8, cardX(i) * 32))) });
    check('move right/forward → marker right/deeper', m0 && m1 && m1.x > m0.x + 1 && m1.z < m0.z - 1 && visuals.ghost && visuals.arc && !visuals.liftHint, { m0, m1, expectDelta: { x: 1.6, z: -1.3 }, snapped: snapped1, visuals });
    check('release → played at marker', played?.ok && Math.abs(played.x - hit1.x) < 1e-6 && Math.abs(played.z - hit1.z) < 1e-6 && handIds() !== before,
      { played: played && { x: r2(played.x), z: r2(played.z) } });
    // 5) 单位夹在己方部署区;退回确认线 = 取消(不出、不提示)
    reset();
    i = unitIdx(); before = handIds();
    hand = [cardX(i), 0.03, 0]; openHand(); moveTo(hand, 1);
    moveTo([cardX(i), 0.10, -0.02], 10);
    moveTo([cardX(i) + 0.4, 0.12, -0.45], 30); hold(30);
    step(1);
    const far = marker(), farState = { snapped: st.grab?.snapped, markerState: sc.deployMarker.state };
    moveTo([cardX(i) - 0.3, 0.12, -0.45], 30); hold(30);
    const farL = marker();
    moveTo([cardX(i), 0.03 + 0.03, 0], 20); hold(5); step(1);
    const back = { stage: st.grab?.stage, cancel: st.grab?.cancel, marker: marker(), ghost: xr.dropGhost.visible };
    openHand();
    check('unit drop clamped inside own deploy zone', far && far.x <= 4.8 && far.z >= 2.4 && farL && farL.x >= -4.8 && farL.z >= 2.4, { farRight: far, farState, farLeft: farL, zone: 'x∈[-4.8,4.8] z∈[2.4,7.6]' });
    check('pull back behind confirm line → cancel, no play', back.cancel === true && !back.marker && !played && handIds() === before && !toast(), { back, toast: toast() });
    // 5b) 瞄到石头上:吸附到最近空位,标记变色(snap)
    reset();
    const rock = g().map.obstacles.filter(o => o.z > 2 && o.z < 6.8 && Math.abs(o.x) < 4).sort((a, b) => b.r - a.r)[0];
    i = unitIdx(); before = handIds();
    if (rock) {
      hand = [cardX(i), 0.03, 0]; openHand(); moveTo(hand, 1);
      moveTo([cardX(i), 0.11, -0.01], 10);
      const G = st.grab, h0 = G.confirm;
      const target = new V(h0.x + (rock.x - G.origin.x0) / 32, h0.y, h0.z - (-rock.z - G.origin.d0) / 26);
      for (let k = 0; k < 40; k++) xr.handInput(st, 0.01, xr.uiInner.localToWorld(target.clone()), 1 / 60);
      step(1);
      const snap = { rock: { x: r2(rock.x), z: r2(rock.z), r: rock.r }, aim: { x: r2(G.aim.x), z: r2(G.aim.z) }, marker: marker(), snapped: G.snapped, markerState: sc.deployMarker.state,
        rawReason: g().deployBlockReason('p', g().p.hand[i], G.aim.x, G.aim.z) };
      hand = [cardX(i), 0.04, 0]; moveTo(hand, 1); openHand();   // 退回取消
      check('blocked aim snaps to free spot, marker turns snap colour', snap.snapped && snap.markerState === 'snap' && snap.rawReason === 'deployRock' && !played, snap);
    } else check('blocked aim snaps to free spot, marker turns snap colour', false, { note: 'no rock in own zone' });
    // 6) 法术牌能推到敌方半场
    reset();
    let si = g().p.hand.findIndex(c => c.type === 'spell' && !c.ownHalf && c.effect !== 'heal_area');
    if (si < 0) {   // 手里没有:从牌库换一张进来(只为测试)
      const q = g().p.queue.findIndex(c => c.type === 'spell' && !c.ownHalf && c.effect !== 'heal_area');
      if (q >= 0) { si = 0; [g().p.hand[0], g().p.queue[q]] = [g().p.queue[q], g().p.hand[0]]; xr.cardSig = ''; step(2); g().p.mana = g().p.manaMax; }
    }
    if (si >= 0) {
      const spell = g().p.hand[si].id; before = handIds();
      hand = [cardX(si), 0.03, 0]; openHand(); moveTo(hand, 1);
      moveTo([cardX(si), 0.10, -0.02], 10);
      moveTo([cardX(si), 0.10, -0.34], 30); hold(30);
      const sm = marker(); const sh = { x: st.grab?.hit?.x, z: st.grab?.hit?.z };
      openHand();
      check('spell can reach enemy half', sm && sm.z < 0 && played?.ok && Math.abs(played.z - sh.z) < 1e-6, { spell, marker: sm, expectZ: r2(7.0 - 0.32 * 26), played: played && { x: r2(played.x), z: r2(played.z) } });
    } else check('spell can reach enemy half', false, { note: 'no spell in deck' });
    // 7) 回收区:没确认前把牌移到回收图标上松手 = 弃牌
    reset();
    i = unitIdx(); before = handIds();
    hand = [cardX(i), 0.03, 0]; openHand(); moveTo(hand, 1);
    const trashV = xr.viewPoint(xr.trash.mesh.getWorldPosition(new V())).sub(rowC());
    moveTo([trashV.x, trashV.y, trashV.z], 15);
    const trashState = { stage: st.grab?.stage, trash: st.grab?.trash };
    openHand();
    check('trash before confirm → discard', trashState.stage === 'held' && trashState.trash && discarded && handIds() !== before, { trashState, discarded });
    // 8) 瞄准中追踪丢失:150ms 内有合法落点就照出
    reset();
    i = unitIdx(); before = handIds();
    hand = [cardX(i), 0.03, 0]; openHand(); moveTo(hand, 1);
    moveTo([cardX(i), 0.10, -0.04], 10); hold(10);
    xr.loseHandTracking(st);
    check('tracking lost while aiming (<150ms) → plays', played?.ok && handIds() !== before, { played: played && { x: r2(played.x), z: r2(played.z) } });
    // 9) 买不起:能拿起、确认、瞄准;松手提示法力不足并退回
    reset();
    g().p.mana = 0; i = g().p.hand.findIndex(c => c.cost > 0 && c.type === 'unit'); before = handIds();
    hand = [cardX(i), 0.03, 0]; openHand(); moveTo(hand, 1);
    moveTo([cardX(i), 0.10, -0.04], 10); hold(10);
    const poorAim = st.grab?.stage;
    openHand();
    check('unaffordable → no-mana toast + return', poorAim === 'aiming' && handIds() === before && toast() === t('tNoMana'), { toast: toast() });
    // 10) UI 换到侧边(sector 1):落点在玩家这一侧近边,前推 = 视图里变远,左移 = 视图里向左
    reset();
    xr.uiSide = { sector: 1, angle: Math.PI / 2, from: Math.PI / 2, to: Math.PI / 2, t: 1 };
    xr.uiPivot.rotation.y = Math.PI / 2; xr.uiPivot.updateMatrixWorld(true);
    const fieldCenterV = xr.viewPoint(sc.world.getWorldPosition(new V()));
    const mv = () => st.grab?.hit ? xr.viewPoint(st.grab.hit.point.clone()).sub(fieldCenterV) : null;
    i = unitIdx(); before = handIds();
    hand = [cardX(i), 0.03, 0]; openHand(); moveTo(hand, 1);
    moveTo([-0.10, 0.10, -0.03], 10); hold(30);   // 手在行中心左 10cm 确认:u = -3.2 → 战场 z = 3.2(部署区内,不被夹)
    const s0 = mv(), f0 = marker();
    moveTo([-0.15, 0.10, -0.03], 20); hold(30);
    const s1 = mv();
    moveTo([-0.15, 0.10, -0.08], 20); hold(30);
    const s2 = mv(), f2 = marker();
    moveTo([cardX(i), 0.03, 0], 20); openHand();   // 退回取消
    xr.uiSide = { sector: 0, angle: 0, from: 0, to: 0, t: 1 };
    xr.uiPivot.rotation.y = 0; xr.uiPivot.updateMatrixWorld(true);
    const v3 = p => p && { x: r2(p.x / sc.world.scale.x), z: r2(p.z / sc.world.scale.x) };
    check('UI side 1: near side + view-consistent motion', s0 && s1 && s2 && s0.z > 0 && s1.x < s0.x && s2.z < s1.z && f0.x > 3,
      { fieldStart: f0, fieldAfterForward: f2, viewCells: { start: v3(s0), left: v3(s1), forward: v3(s2) } });
    // 11) 手柄射线:抓牌 → 指向战场 → 松开出牌(原逻辑)
    reset();
    const stC = xr.inputs[1];
    stC.isHand = false;
    i = unitIdx(); before = handIds();
    const origin = new V(0.15, -0.25, -0.05);
    const aim = p => new Ray(origin.clone(), p.clone().sub(origin).normalize());
    const cardPos = k => xr.cards[k].mesh.getWorldPosition(new V());
    xr.press(stC, null, aim(cardPos(i)));
    const ctrlGrab = stC.grab ? { idx: stC.grab.idx, hand: stC.grab.hand } : null;
    xr.dragRay(stC, aim(field(0.5, 5, 0)));
    const ctrlHit = stC.grab?.hit ? { x: r2(stC.grab.hit.x), z: r2(stC.grab.hit.z) } : null;
    xr.release(stC);
    check('controller ray path still plays', ctrlGrab?.idx === i && !ctrlGrab.hand && played?.ok && handIds() !== before, { ctrlGrab, ctrlHit, played: played && { x: r2(played.x), z: r2(played.z) } });
    xr.cb.onPlay = origPlay; xr.cb.onDiscard = origDiscard;
    out.checks = checks;
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
  const { checks, ...rest } = r;
  for (const c of checks ?? []) {
    const { name, pass, ...data } = c;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(data)}`);
  }
  console.log('xr', JSON.stringify(rest, null, 1));
  await sleep(1500);
  console.log('after-exit', JSON.stringify(await ev(snap)));
  console.log('console errors', JSON.stringify(errors));
} finally { try { ws?.close(); } catch {} proc.kill(); }

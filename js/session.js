// 对局会话 — 界面层只和会话打交道,不关心对局在本地还是在服务器上跑
//   session.game          只读状态(Game 实例;本地会话是真实对局,联机会话是快照镜像)
//   session.tick(dt)      每帧调用
//   session.play(idx,x,z) / discard(idx) / pickUpgrade(i) / leave()
// 两种会话里,本地玩家永远是 'p'、在 z>0 一侧(联机视角转换见 net.js)

import { Game, DISCARD_COST } from './game.js';
import { SimpleAI } from './ai.js';
import { applySnapshot, interpolate, validXRPose } from './net.js';
import { t } from './i18n.js';
import { nameToken, saveNameToken } from './storage.js';

const RECONNECT_MS = 15000, RECONNECT_EVERY = 1500;

export class LocalSession {
  // prep:开局准备秒数(新手引导传 0);不进 config,再来一局时恢复默认
  constructor({ faction, deck, enemyFaction, enemyDeck, difficulty = 'normal', sceneId = 'starcore', prep }) {
    this.online = false;
    this.sceneId = sceneId;
    this.config = { faction, deck, enemyFaction, enemyDeck, difficulty, sceneId };
    this.game = new Game(faction, enemyFaction, { p: deck, e: enemyDeck }, { sceneId, prep });
    this.ai = new SimpleAI(this.game, 'e', { level: difficulty });
    this.opName = t({ basic: 'aiEasy', normal: 'aiNormal', smart: 'aiHard' }[difficulty] || 'aiNormal');
  }
  tick(dt) { this.game.tick(dt); this.ai.tick(dt); }
  play(idx, x, z) { return this.game.playCard('p', idx, x, z); }
  discard(idx) { return this.game.discard('p', idx); }
  pickUpgrade(i) { return this.game.chooseUpgrade(i, 'p'); }
  leave() {}
}

export class NetSession {
  // ws:已连接并收到 start 消息的 WebSocket;start:{ you, me, op }
  constructor(ws, start, cb = {}) {
    this.online = true;
    this.cb = cb;
    this.url = cb.url;
    this.resume = { code: start.code, key: start.key };   // 断线重连凭证
    this.seq = 0;
    this.pending = [];      // 已发出、服务器尚未确认的输入 { seq, cost }
    this.opName = start.op.name;
    this.sceneId = start.scene || 'starcore';
    this.game = new Game(start.me.faction, start.op.faction, {}, { autoPick: [], sceneId: this.sceneId });
    this.game.events = [];
    this.lastSnapAt = performance.now();
    this.attach(ws);
  }

  attach(ws) {
    this.ws = ws;
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'snap') this.onSnap(m);
      else if (m.t === 'xr_pose' && validXRPose(m.pose)) this.cb.onXRPose?.(m.pose);
      else if (m.t === 'left') { this.cb.onXRPose?.(null); this.cb.onLeft?.(); }
      else if (m.t === 'opdc') { this.cb.onXRPose?.(null); this.cb.onOpDc?.(m.s); }
      else if (m.t === 'opback') this.cb.onOpBack?.();
    };
    ws.onclose = () => this.onDrop(ws);
  }

  // 连接断了:对局还在进行就在宽限期内自动重连(眼镜休眠、Wi-Fi 切换),否则结束
  onDrop(ws) {
    if (ws !== this.ws) return;
    this.cb.onXRPose?.(null);
    if (this.leaving || this.game.phase === 'end' || !this.url || !this.resume.key) return this.markClosed();
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.dropAt = performance.now();
    this.tryReconnect();
  }
  markClosed() {
    if (this.closed) return;
    this.closed = true; this.reconnecting = false;
    this.cb.onClose?.();
  }
  tryReconnect() {
    if (this.leaving || this.closed) return;
    if (performance.now() - this.dropAt > RECONNECT_MS) return this.markClosed();
    const retry = () => setTimeout(() => this.tryReconnect(), RECONNECT_EVERY);
    let ws;
    try { ws = new WebSocket(this.url); } catch { retry(); return; }
    let done = false;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'rejoin', ...this.resume }));
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'start' && m.resumed) {
        done = true;
        this.reconnecting = false;
        this.pending = [];             // 断线期间的输入服务器没收到:以服务器状态为准
        this.lastSnapAt = performance.now();
        this.attach(ws);
        this.cb.onResumed?.();
      } else if (m.t === 'error') {    // 对局已经结束 / 凭证无效:不再重试
        done = true;
        ws.onclose = null; try { ws.close(); } catch { /* */ }
        this.markClosed();
      }
    };
    ws.onclose = () => { if (!done) retry(); };
  }

  onSnap(s) {
    this.lastSnapAt = performance.now();
    this.pending = this.pending.filter(p => p.seq > s.ack);
    // 还有未确认的输入时保留本地预测的手牌,法力扣掉未确认的花费,避免手牌闪回
    applySnapshot(this.game, s, {
      keepHand: this.pending.length > 0,
      pendingCost: this.pending.reduce((a, p) => a + p.cost, 0),
    });
  }

  tick() { interpolate(this.game); }

  // 与服务器相同的循环抽牌规则做本地预测
  predictCycle(idx) {
    const s = this.game.p;
    const [card] = s.hand.splice(idx, 1);
    s.queue.push(card);
    if (s.queue.length) s.hand.push(s.queue.shift());
    return card;
  }

  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

  sendXRPose(pose) {
    if (this.connected && this.ws.bufferedAmount < 12000 && validXRPose(pose)) this.send({ t: 'xr_pose', pose });
  }

  // 断线 / 重连中不接受操作(否则会乐观扣法力、换手牌,但服务器根本没收到)
  get connected() { return !this.closed && !this.reconnecting && this.ws?.readyState === 1; }

  play(idx, x, z) {
    const g = this.game, card = g.p.hand[idx];
    if (!this.connected || !card || !g.canPlay('p', idx)) return false;
    if ((card.type !== 'spell' || card.needTarget) && !g.canDeployAt('p', card, x, z)) return false;
    const seq = ++this.seq;
    this.send({ t: 'play', seq, idx, x, z });
    // 乐观更新:立即扣法力、换手牌、播放落点特效,不等服务器往返
    // 混沌血祭:法力不够的部分用核心生命补,本地只扣得起的那部分法力
    const paid = Math.min(card.cost, g.p.mana);
    if (g.p.mana < card.cost) g.p.baseHP -= g.bloodCost('p', card) ?? 0;
    g.p.mana -= paid;
    this.predictCycle(idx);
    this.pending.push({ seq, cost: paid });
    g.events.push({ type: 'spawn_preview', x, z, card });
    return true;
  }

  discard(idx) {
    const g = this.game;
    if (!this.connected || !g.p.hand[idx] || g.p.mana < DISCARD_COST || g.phase !== 'battle') return false;
    const seq = ++this.seq;
    this.send({ t: 'discard', seq, idx });
    g.p.mana -= DISCARD_COST;
    this.predictCycle(idx);
    this.pending.push({ seq, cost: DISCARD_COST });
    return true;
  }

  pickUpgrade(i) {
    if (!this.connected || !this.game.upgrade || this.game.upgrade.picked.p) return false;
    this.send({ t: 'upgrade', i });
    this.game.upgrade.picked.p = true;
    return true;
  }

  // 网络延迟估计:距上一份快照的时间(快照每 50ms 一份)
  staleMs() { return performance.now() - this.lastSnapAt; }

  leave() {
    this.leaving = true;
    this.send({ t: 'leave' });
    try { this.ws.close(); } catch { /* 已关闭 */ }
  }
}

// 连接服务器并完成建房/加房,resolve 时返回 { ws, start }
// onRoom(code, name):建房成功、等待对手时回调;onSocket(ws):拿到连接,调用 ws.cancel() 可放弃等待
export function connectOnline(url, msg, { onRoom, onSocket } = {}) {
  return new Promise((resolve, reject) => {
    let ws, settled = false;
    try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
    const fail = (text, code) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const e = new Error(text); e.code = code; reject(e);
      ws.onclose = ws.onmessage = ws.onerror = null;
      try { ws.close(); } catch { /* */ }
    };
    ws.cancel = () => fail('cancel', 'cancel');
    const timer = setTimeout(() => fail(t('tTimeout'), 'noconn'), 5000);
    onSocket?.(ws);
    // 带上这个昵称在本机保存的认领凭证
    const hello = { ...msg, token: msg.name ? nameToken(msg.name) : undefined };
    ws.onopen = () => ws.send(JSON.stringify(hello));
    ws.onerror = () => fail(t('tCantConnect'), 'noconn');
    ws.onclose = () => fail(t('tConnLost'), 'noconn');   // 服务器在开局前关闭连接(等待超时等)
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'room') { clearTimeout(timer); onRoom?.(m.code, m.name); }
      else if (m.t === 'token') saveNameToken(m.name, m.token);
      else if (m.t === 'error') fail(m.msg);
      else if (m.t === 'start' && !settled) {
        settled = true;
        clearTimeout(timer);
        ws.onmessage = ws.onerror = ws.onclose = null;
        resolve({ ws, start: m });
      }
    };
  });
}

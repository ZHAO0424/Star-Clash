// 联机服务器 — 零依赖(只用 Node 内置模块)
//   · 静态文件:直接托管游戏页面(一条命令启动全部)
//   · WebSocket /ws:房间、权威模拟、快照下发
// 用法: node server/server.mjs [端口=8788] [--cert cert.pem --key key.pem]
//   提供证书(或放在 server/certs/cert.pem + key.pem)时以 HTTPS/WSS 启动 —— 眼镜通过局域网 IP 进 WebXR 必须用 HTTPS
//
// 协议(JSON 文本帧):
//   客户端 → 服务器
//     { t:'create', faction, deck, name, scene }   创建房间(scene:场景 id 或 'random'),返回 { t:'room', code }
//     { t:'join', code, faction, deck, name }      加入房间,双方收到 { t:'start', you, me, op }
//     { t:'play', seq, idx, x, z }                 出牌(坐标为该客户端自己的视角)
//     { t:'discard', seq, idx }                    弃牌
//     { t:'upgrade', i }                           选择强化(0..2)
//     { t:'rejoin', code, key }                    断线后重连(key 在 start 消息里下发)
//     { t:'leave' }                                离开房间(主动离开立即判负;断线有 15 秒重连宽限)
//   服务器 → 客户端
//     { t:'snap', ...makeSnapshot }                每 50ms 一份,含 ack = 已处理的最后一个输入序号
//     { t:'error', msg } / { t:'left' }(对手离开) / { t:'opdc', s } / { t:'opback' }(对手掉线 / 重连)
//     { t:'token', name, token }                   首次使用昵称时发放的认领凭证

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Game } from '../js/game.js';
import { FACTIONS, validateDeck, PRESET_DECKS } from '../js/cards.js';
import { makeSnapshot, view, SNAPSHOT_MS, validXRPose, XR_POSE_INTERVAL } from '../js/net.js';
import { SCENE_IDS, randomScene } from '../js/scenes.js';
import { recordResult, leaderboard, claimName } from './ranking.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

// ── 限额 ──
const MAX_FRAME = 64 * 1024;          // 单帧上限:客户端消息都是几十字节的 JSON
const MAX_OUTBUF = 1 << 20;           // 发送缓冲积压超过 1MB(对端不读)就断开
const MAX_CONNS = 400, MAX_CONNS_PER_IP = 8;
const MAX_ROOMS = 200;
const WAITING_ROOM_MS = 5 * 60 * 1000;   // 等待对手超过 5 分钟的房间自动关闭
const HEARTBEAT_MS = 10000, IDLE_MS = 30000;
const GRACE_MS = 15000;               // 对局中掉线的重连宽限期
const MAX_BAD_JOINS = 5;              // 连续输错房间码几次就断开(防枚举)
const MIN_RANKED_FORFEIT = 20;        // 开局不到 20 秒的判负局不计入排名(防快速刷分)

// ── 最小 WebSocket 实现(RFC 6455,只支持未分片的文本帧)──
function acceptKey(key) {
  return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}

function frame(op, payload) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n])
    : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([head, payload]);
}

const conns = new Set();
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

class WsConn {
  constructor(socket, head, ip) {
    this.socket = socket;
    this.ip = ip;
    this.buf = Buffer.alloc(0);
    this.onmessage = null;
    this.onclose = null;
    this.open = true;
    this.lastSeen = Date.now();
    conns.add(this);
    socket.on('data', d => this.feed(d));
    socket.on('close', () => this.close());
    socket.on('error', () => this.close());
    if (head?.length) this.feed(head);   // 和握手请求同一个 TCP 包到达的首帧
  }
  feed(d) {
    if (!this.open) return;
    this.lastSeen = Date.now();
    // 缓冲区最多一帧(≤ MAX_FRAME),concat 的代价有上限
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    let pos = 0;
    const b = this.buf;
    while (this.open && b.length - pos >= 2) {
      const fin = b[pos] & 0x80, op = b[pos] & 0x0f, masked = b[pos + 1] & 0x80;
      let len = b[pos + 1] & 0x7f, off = pos + 2;
      if (len === 126) { if (b.length < off + 2) break; len = b.readUInt16BE(off); off += 2; }
      else if (len === 127) {
        if (b.length < off + 8) break;
        const big = b.readBigUInt64BE(off); off += 8;
        len = big > BigInt(MAX_FRAME) ? Infinity : Number(big);
      }
      // 客户端帧必须带掩码;不支持分片;控制帧不超过 125 字节;单帧不超过上限
      if (!masked) return this.close(1002);
      if (len > MAX_FRAME) return this.close(1009);
      if (op >= 0x8 ? len > 125 : !fin) return this.close(op >= 0x8 ? 1002 : 1003);
      if (b.length < off + 4 + len) break;
      const mask = b.subarray(off, off + 4); off += 4;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = b[off + i] ^ mask[i & 3];
      pos = off + len;
      if (op === 0x8) return this.close();
      if (op === 0x9) { this.raw(frame(0xA, payload)); continue; }
      if (op === 0xA) continue;   // pong:lastSeen 已更新
      if (op !== 0x1) return this.close(1003);
      this.deliver(payload);
    }
    this.buf = pos >= b.length ? Buffer.alloc(0) : b.subarray(pos);
  }
  deliver(payload) {
    let msg;
    try { msg = JSON.parse(payload.toString('utf8')); } catch { return; }
    if (!isPlainObject(msg) || !this.onmessage) return;
    try { this.onmessage(msg); } catch (e) { console.error('[连接] 处理消息出错:', e); }
  }
  raw(buf) {
    if (!this.open) return;
    if (this.socket.writableLength > MAX_OUTBUF) return this.close(1008);   // 对端不读数据,别让缓冲无限增长
    this.socket.write(buf);
  }
  send(obj) { this.raw(frame(0x1, Buffer.from(JSON.stringify(obj)))); }
  ping() { this.raw(frame(0x9, Buffer.alloc(0))); }
  close(code = 1000) {
    if (!this.open) return;
    this.open = false;
    conns.delete(this);
    try { this.socket.end(frame(0x8, Buffer.from([code >> 8, code & 255]))); } catch { /* 已断开 */ }
    setTimeout(() => this.socket.destroy(), 1000).unref();
    const cb = this.onclose; this.onclose = null;
    try { cb?.(); } catch (e) { console.error('[连接] 关闭回调出错:', e); }
  }
}

// ── 房间 ──
const rooms = new Map();   // code → Room
export const _rooms = rooms;   // 仅供测试读取

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 200; i++) {
    const c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join('');
    if (!rooms.has(c)) return c;
  }
  return null;
}

const OTHER = { p: 'e', e: 'p' };

class Room {
  constructor(code) {
    this.code = code;
    this.players = { p: null, e: null };   // { conn, faction, deck, name, ranked, key, seq, dcAt }
    this.game = null;
    this.loop = null;
    this.createdAt = Date.now();
  }
  startMsg(who) {
    const me = this.players[who], op = this.players[OTHER[who]];
    return { t: 'start', you: who, code: this.code, key: me.key, scene: this.scene,
      me: { faction: me.faction, name: me.name }, op: { faction: op.faction, name: op.name } };
  }
  start() {
    const P = this.players.p, E = this.players.e;
    this.game = new Game(P.faction, E.faction, { p: P.deck, e: E.deck }, { autoPick: [], sceneId: this.scene });
    this.names = { p: P.name, e: E.name };   // 开局时记下,玩家离开后结算排名仍可用
    this.ranked = P.ranked && E.ranked;
    for (const who of ['p', 'e']) {
      const pl = this.players[who];
      pl.seq = 0;
      pl.key = crypto.randomBytes(12).toString('base64url');   // 断线重连凭证
      pl.conn.send(this.startMsg(who));
    }
    this.loop = setInterval(() => {
      try { this.step(); } catch (e) {   // 单个房间出错不能拖垮整个服务器:结束该局并通知双方
        console.error(`[房间 ${this.code}] 模拟出错,已结束该局:`, e);
        this.abort();
      }
    }, SNAPSHOT_MS);
  }
  abort() {
    clearInterval(this.loop); this.loop = null;
    this.recorded = true;   // 出错的对局不计排名
    for (const who of ['p', 'e']) {
      const c = this.players[who]?.conn;
      if (c?.open) { c.send({ t: 'error', msg: '服务器模拟出错,本局已终止' }); c.close(); }
    }
    rooms.delete(this.code);
  }
  step() {
    const g = this.game;
    // 掉线超过宽限期:判负
    for (const who of ['p', 'e']) {
      const pl = this.players[who];
      if (pl && !pl.conn && Date.now() - pl.dcAt > GRACE_MS) { this.forfeit(who); return; }
    }
    g.tick(SNAPSHOT_MS / 1000);
    this.broadcast(g.drainEvents());
    if (g.phase === 'end') this.finish();
  }
  broadcast(events) {
    for (const who of ['p', 'e']) {
      const pl = this.players[who];
      if (pl?.conn?.open) pl.conn.send({ t: 'snap', ...makeSnapshot(this.game, who, events, pl.seq) });
    }
  }
  finish() {
    clearInterval(this.loop);
    this.loop = null;
    const g = this.game;
    if (this.recorded) return;
    this.recorded = true;
    if (!this.ranked) return;
    if (g.endReason === 'forfeit' && g.time < MIN_RANKED_FORFEIT) return;
    try { recordResult(this.names.p, this.names.e, g.winner); } catch (e) { console.error('[排名] 记录失败:', e); }
  }
  input(who, msg) {
    const g = this.game, pl = this.players[who];
    if (!g || !pl || g.phase === 'end') return;
    if (msg.t === 'xr_pose') {
      if (!validXRPose(msg.pose)) return;
      const now = Date.now();
      if (msg.pose === null ? !pl.xrPresent : now - (pl.xrPoseAt || 0) < XR_POSE_INTERVAL - 12) return;
      pl.xrPoseAt = now;
      pl.xrPresent = msg.pose !== null;
      const peer = this.players[OTHER[who]]?.conn;
      if (peer?.open) peer.send({ t: 'xr_pose', pose: msg.pose });
      return;
    }
    const V = view(who);
    if (Number.isSafeInteger(msg.seq) && msg.seq > 0) pl.seq = Math.max(pl.seq, msg.seq);
    if (msg.t === 'play') g.playCard(who, msg.idx | 0, V.x(+msg.x || 0), V.z(+msg.z || 0));
    else if (msg.t === 'discard') g.discard(who, msg.idx | 0);
    else if (msg.t === 'upgrade') g.chooseUpgrade(msg.i | 0, who);
  }
  // 连接断开:对局进行中且不是主动离开 → 进入宽限期等重连;否则直接离开
  disconnect(who, conn, explicit) {
    const pl = this.players[who];
    if (!pl || pl.conn !== conn) return;
    if (this.game && this.game.phase !== 'end' && !explicit) {
      pl.conn = null;
      pl.dcAt = Date.now();
      this.players[OTHER[who]]?.conn?.send({ t: 'opdc', s: GRACE_MS / 1000 });
      return;
    }
    this.forfeit(who);
  }
  rejoin(who, conn) {
    const pl = this.players[who];
    const old = pl.conn;
    if (old) { old.onclose = null; old.close(); }   // 旧连接可能是半开的:新连接接管
    pl.conn = conn; pl.dcAt = 0;
    conn.send({ ...this.startMsg(who), resumed: true });
    this.players[OTHER[who]]?.conn?.send({ t: 'opback' });
  }
  forfeit(who) {
    const g = this.game, other = OTHER[who];
    this.players[who] = null;
    if (!g) { rooms.delete(this.code); return; }   // 还在等对手的房间:直接关闭
    if (g.phase !== 'end') {
      g.finish(other, 'forfeit');
      this.broadcast(g.drainEvents());
      this.finish();
    }
    this.players[other]?.conn?.send({ t: 'left' });
    if (!this.players.p?.conn?.open && !this.players.e?.conn?.open) {
      clearInterval(this.loop); this.loop = null;
      rooms.delete(this.code);
    }
  }
}

function sanitizePlayer(msg) {
  const faction = typeof msg.faction === 'string' && Object.hasOwn(FACTIONS, msg.faction) ? msg.faction : 'steel';
  const deck = Array.isArray(msg.deck) && msg.deck.length < 32 && !validateDeck(faction, msg.deck) ? [...msg.deck] : PRESET_DECKS[faction];
  // 去掉控制字符;昵称为空时随机起名,这种匿名对局不计入排名
  const name = String(msg.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  return { faction, deck, name: name || '玩家' + crypto.randomInt(1000), ranked: !!name };
}

// 返回 null 表示昵称被别人认领了
function admit(conn, msg) {
  const pl = sanitizePlayer(msg);
  if (pl.ranked) {
    const c = claimName(pl.name, msg.token);
    if (!c.ok) return null;
    if (c.token) conn.send({ t: 'token', name: pl.name, token: c.token });
  }
  return { conn, ...pl, seq: 0, dcAt: 0 };
}

function handleConn(conn) {
  let room = null, who = null, badJoins = 0, leaving = false;
  const err = text => conn.send({ t: 'error', msg: text });
  const badJoin = text => { err(text); if (++badJoins >= MAX_BAD_JOINS) conn.close(1008); };
  conn.onmessage = msg => {
    if (msg.t === 'create' && !room) {
      if (rooms.size >= MAX_ROOMS) return err('服务器房间已满,请稍后再试');
      const code = newCode();
      if (!code) return err('服务器房间已满,请稍后再试');
      const pl = admit(conn, msg);
      if (!pl) return err('这个昵称已被其他设备使用,请换一个');
      room = new Room(code); who = 'p';
      room.scene = typeof msg.scene === 'string' && SCENE_IDS.includes(msg.scene) ? msg.scene : randomScene();
      rooms.set(code, room);
      room.players.p = pl;
      conn.send({ t: 'room', code, name: pl.name });
    } else if (msg.t === 'join' && !room) {
      const r = rooms.get(String(msg.code ?? '').toUpperCase());
      if (!r) return badJoin('房间不存在');
      if (r.players.e || r.game || !r.players.p) return badJoin('房间已满');
      const pl = admit(conn, msg);
      if (!pl) return err('这个昵称已被其他设备使用,请换一个');
      room = r; who = 'e';
      room.players.e = pl;
      room.start();
    } else if (msg.t === 'rejoin' && !room) {
      const r = rooms.get(String(msg.code ?? '').toUpperCase());
      const seat = r?.game && r.game.phase !== 'end' && ['p', 'e'].find(w => r.players[w] && r.players[w].key === msg.key);
      if (!seat) return badJoin('无法重连:对局已结束');
      room = r; who = seat;
      room.rejoin(who, conn);
    } else if (msg.t === 'leave') {
      leaving = true;
      conn.close();
    } else if (room && who) {
      room.input(who, msg);
    }
  };
  conn.onclose = () => { if (room && who) room.disconnect(who, conn, leaving); };
}

// 心跳 + 清理:超时无响应的连接断开;等待太久的房间关闭
function housekeeping() {
  const now = Date.now();
  for (const c of conns) {
    if (now - c.lastSeen > IDLE_MS) c.close(1001);
    else c.ping();
  }
  for (const r of rooms.values()) {
    if (!r.game && now - r.createdAt > WAITING_ROOM_MS) {
      const c = r.players.p?.conn;
      rooms.delete(r.code);
      if (c?.open) { c.send({ t: 'error', msg: '等待超时,房间已关闭' }); c.close(); }
    }
  }
}

// ── HTTP:静态文件(白名单)+ 排行榜 + WebSocket 升级 ──
// 只公开游戏页面需要的文件;server/(含 TLS 私钥和排行榜数据)、tools/、README 等一律不对外
const PUBLIC_DIRS = new Set(['js', 'assets']);
const PUBLIC_ROOT_FILES = new Set(['index.html', 'viewer.html', 'game.css']);   // 根目录只公开页面本身(新增根目录文件要加进这里)
function publicFile(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return { status: 400 }; }
  if (rel.includes('\0')) return { status: 400 };
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(ROOT, '.' + rel);
  const r = path.relative(ROOT, file);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return { status: 403 };
  const parts = r.split(path.sep);
  const ok = (parts.length === 1 && PUBLIC_ROOT_FILES.has(parts[0].toLowerCase())) ||
    (parts.length > 1 && PUBLIC_DIRS.has(parts[0].toLowerCase()));
  if (!ok || parts.some(p => p.startsWith('.'))) return { status: 403 };
  return { file };
}

export function startServer(port = 8788, { cert, key } = {}) {
  const handler = (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/leaderboard') {
        res.writeHead(200, { 'content-type': MIME['.json'] });
        return res.end(JSON.stringify(leaderboard()));
      }
      const { file, status } = publicFile(url.pathname);
      if (!file) { res.writeHead(status); return res.end(); }
      fs.realpath(file, (err, real) => {
        // 跟随符号链接后仍须在根目录内
        const r = real && path.relative(ROOT, real);
        if (err || !r || r.startsWith('..') || path.isAbsolute(r)) { res.writeHead(404); return res.end('not found'); }
        fs.readFile(real, (err2, data) => {
          if (err2) { res.writeHead(404); return res.end('not found'); }
          res.writeHead(200, { 'content-type': MIME[path.extname(real).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
          res.end(data);
        });
      });
    } catch (e) {
      console.error('[HTTP] 处理请求出错:', e);
      try { res.writeHead(500); res.end(); } catch { /* */ }
    }
  };
  const server = cert && key
    ? https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, handler)
    : http.createServer(handler);
  server.secure = !!(cert && key);
  server.on('upgrade', (req, socket, head) => {
    try {
      if (new URL(req.url, 'http://x').pathname !== '/ws' || !req.headers['sec-websocket-key']) return socket.destroy();
      // 浏览器会带 Origin:只接受同源页面,别的网站里的脚本不能连进来
      const origin = req.headers.origin;
      if (origin) {
        let host = null; try { host = new URL(origin).host; } catch { /* */ }
        if (host !== req.headers.host) return socket.destroy();
      }
      // 部署在反向代理后面(Render 等云平台)时设 TRUST_PROXY=1,按代理转发的真实客户端 IP 限流;否则所有人都算成代理的同一个 IP
      const fwd = process.env.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const ip = fwd || socket.remoteAddress;
      let n = 0; for (const c of conns) if (c.ip === ip) n++;
      if (conns.size >= MAX_CONNS || n >= MAX_CONNS_PER_IP) return socket.destroy();
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey(req.headers['sec-websocket-key'])}\r\n\r\n`);
      socket.setNoDelay(true);
      handleConn(new WsConn(socket, head, ip));
    } catch (e) {
      console.error('[WS] 握手出错:', e);
      socket.destroy();
    }
  });
  const hk = setInterval(housekeeping, HEARTBEAT_MS);
  hk.unref();
  server.on('close', () => clearInterval(hk));
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const port = +args.find(a => /^\d+$/.test(a)) || +process.env.PORT || 8788;   // 云平台用 PORT 环境变量指定端口
  const certDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'certs');
  let cert = opt('--cert'), key = opt('--key');
  if (!cert && fs.existsSync(path.join(certDir, 'cert.pem')) && fs.existsSync(path.join(certDir, 'key.pem'))) {
    cert = path.join(certDir, 'cert.pem'); key = path.join(certDir, 'key.pem');
  }
  startServer(port, { cert, key }).then(srv => {
    const proto = srv.secure ? 'https' : 'http';
    const ips = Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
    console.log(`星轨对决服务器已启动: ${proto}://localhost:${port}`);
    for (const ip of ips) console.log(`  局域网: ${proto}://${ip}:${port}`);
    if (!srv.secure) console.log('  提示:眼镜通过局域网 IP 进入 WebXR 需要 HTTPS,生成证书见 README');
  });
}

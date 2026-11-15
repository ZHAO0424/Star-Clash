// 排名系统初版 — 联机对局的 Elo 积分,持久化到 server/data/ranking.json
//   初始 1000 分,K = 32;平局双方各得 0.5
//   昵称认领:第一次用某个昵称联机时服务器发一个 token(客户端存在本地),之后用这个昵称必须带同一个 token,
//   防止别人冒用你的昵称故意输掉来扣你的分。没有账号体系,换设备 / 清浏览器数据会丢失认领。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const FILE = process.env.RANKING_FILE ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'ranking.json');
const START = 1000, K = 32;

// 内存里用 Map(昵称是用户输入,普通对象会被 "__proto__" 之类的键污染原型)
let db = null;
function load() {
  if (db) return db;
  db = new Map();
  let text = null;
  try { text = fs.readFileSync(FILE, 'utf8'); } catch { return db; }   // 文件不存在:空库
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [name, r] of Object.entries(obj)) {
        if (r && typeof r === 'object' && Number.isFinite(r.rating)) db.set(name, r);
      }
    }
  } catch (e) {
    // 文件损坏:先备份再当空库,不能下一局结算时把原文件静默覆盖掉
    const bak = `${FILE}.corrupt-${Date.now()}`;
    try { fs.renameSync(FILE, bak); } catch { /* */ }
    console.error(`[排名] ${FILE} 解析失败,已备份到 ${bak}:`, e.message);
  }
  return db;
}
function save() {
  // 写盘失败(云平台只读盘、目录无权限)只记日志:积分仍保留在内存里,不能因此拦住建房和结算
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(load()), null, 1));
    fs.renameSync(tmp, FILE);   // 原子替换:写到一半崩溃也不会留下半截文件
  } catch (e) {
    console.error(`[排名] 写入 ${FILE} 失败,本次只保存在内存:`, e.message);
  }
}

const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const entry = name => {
  const d = load();
  if (!d.has(name)) d.set(name, { rating: START, wins: 0, losses: 0, draws: 0 });
  return d.get(name);
};

// 认领 / 校验昵称。返回 { ok, token }:token 不为空表示新发放的,客户端要保存
export function claimName(name, token) {
  const d = load();
  const r = d.get(name);
  if (r?.tokenHash) return { ok: typeof token === 'string' && hash(token) === r.tokenHash, token: null };
  const fresh = crypto.randomBytes(18).toString('base64url');
  entry(name).tokenHash = hash(fresh);
  save();
  return { ok: true, token: fresh };
}

// winner: 'p' | 'e' | null(平局)
export function recordResult(pName, eName, winner) {
  if (!pName || !eName || pName === eName) return null;
  const a = entry(pName), b = entry(eName);
  const ea = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
  const sa = winner === 'p' ? 1 : winner === 'e' ? 0 : 0.5;
  const delta = Math.round(K * (sa - ea));
  a.rating += delta; b.rating -= delta;
  if (winner === 'p') { a.wins++; b.losses++; }
  else if (winner === 'e') { b.wins++; a.losses++; }
  else { a.draws++; b.draws++; }
  save();
  return delta;
}

export function leaderboard(limit = 20) {
  return [...load()]
    .filter(([, r]) => r.wins + r.losses + r.draws > 0)
    .map(([name, r]) => ({ name, rating: r.rating, wins: r.wins, losses: r.losses, draws: r.draws }))
    .sort((x, y) => y.rating - x.rating)
    .slice(0, limit);
}

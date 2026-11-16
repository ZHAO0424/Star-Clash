// 本地持久化(localStorage)— 卡组、偏好设置、战绩
// 所有读写都包在 try 里:隐私模式 / 禁用存储时退化为只在内存里生效
import { PRESET_DECKS, validateDeck, FACTIONS } from './cards.js';

const mem = {};
function get(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? (key in mem ? mem[key] : fallback) : JSON.parse(v);
  } catch { return key in mem ? mem[key] : fallback; }
}
function set(key, value) {
  mem[key] = value;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 仅内存 */ }
}

// ── 卡组 ──
export function loadDeck(faction) {
  if (!Object.hasOwn(PRESET_DECKS, faction)) faction = 'steel';
  const d = get(`sg.deck.${faction}`, null);
  return d && !validateDeck(faction, d) ? d : [...PRESET_DECKS[faction]];
}
export function saveDeck(faction, ids) {
  if (validateDeck(faction, ids)) return false;
  set(`sg.deck.${faction}`, ids);
  return true;
}
export function isPresetDeck(faction, ids) {
  const p = PRESET_DECKS[faction];
  return ids.length === p.length && ids.every(id => p.includes(id));
}

// ── 偏好 ──
export const prefs = {
  get boardSize() {
    const value = get('sg.xrBoardSize', 'standard');
    return ['small', 'standard', 'large'].includes(value) ? value : 'standard';
  },
  set boardSize(value) { set('sg.xrBoardSize', value); },
  get xrMode() {
    const value = get('sg.xrMode', 'auto');
    return ['immersive-ar', 'immersive-vr'].includes(value) ? value : 'auto';
  },
  set xrMode(value) { set('sg.xrMode', value); },
  get xrHandOpacity() {
    const value = get('sg.xrHandOpacity', 'mid');
    return ['low', 'mid', 'high'].includes(value) ? value : 'mid';
  },
  set xrHandOpacity(value) { set('sg.xrHandOpacity', value); },
  // 双手操控过的战场偏移 { yaw, x, y, z }(xr-board-rig.js);重新居中时保留,「视角复位」才清零
  get xrBoardRig() { return get('sg.xrBoardRig', null); },
  set xrBoardRig(value) { set('sg.xrBoardRig', value); },
  get firstMatchSeen() { return get('sg.firstMatchSeen', false) === true; },
  set firstMatchSeen(value) { set('sg.firstMatchSeen', Boolean(value)); },
  get entered() { return get('sg.entered', false) === true; },
  set entered(value) { set('sg.entered', Boolean(value)); },
  get faction() { const f = get('sg.faction', 'steel'); return typeof f === 'string' && Object.hasOwn(FACTIONS, f) ? f : 'steel'; },
  set faction(v) { set('sg.faction', v); },
  get scene() { const v = get('sg.scene', 'random'); return typeof v === 'string' ? v : 'random'; },
  set scene(v) { set('sg.scene', v); },
  get difficulty() { const d = get('sg.difficulty', 'normal'); return ['basic', 'normal', 'smart'].includes(d) ? d : 'normal'; },
  set difficulty(v) { set('sg.difficulty', v); },
  get name() { const n = get('sg.name', ''); return typeof n === 'string' ? n : ''; },
  set name(v) { set('sg.name', String(v).slice(0, 16)); },
};

// ── 战绩 ──
// { total: {w,l,d}, byFaction: { steel: {w,l,d}, ... }, online: {w,l,d}, streak, best }
export function loadStats() {
  // 存储里的值可能被手改 / 被旧版本写坏:逐字段校验,不合法的重置,不能让菜单白屏
  const raw = get('sg.stats', null);
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const num = v => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const rec = v => { const o = obj(v); return { w: num(o.w), l: num(o.l), d: num(o.d) }; };
  const src = obj(raw), bf = obj(src.byFaction);
  const s = { total: rec(src.total), online: rec(src.online), byFaction: {}, streak: num(src.streak), best: num(src.best) };
  for (const f of Object.keys(FACTIONS)) s.byFaction[f] = rec(bf[f]);
  return s;
}

// winner: 'p'(本地玩家胜)| 'e' | null(平局)
export function recordGame(faction, winner, online) {
  const s = loadStats();
  const k = winner === 'p' ? 'w' : winner === 'e' ? 'l' : 'd';
  s.total[k]++; s.byFaction[faction][k]++;
  if (online) s.online[k]++;
  s.streak = winner === 'p' ? s.streak + 1 : 0;
  s.best = Math.max(s.best, s.streak);
  set('sg.stats', s);
  return s;
}

// ── 昵称认领凭证(联机排行榜用,服务器首次见到昵称时发放)──
export function nameToken(name) {
  const m = get('sg.nameTokens', {});
  return m && typeof m === 'object' && typeof m[name] === 'string' ? m[name] : undefined;
}
export function saveNameToken(name, token) {
  const m = get('sg.nameTokens', {});
  const out = m && typeof m === 'object' && !Array.isArray(m) ? { ...m } : {};
  out[name] = token;
  set('sg.nameTokens', out);
}

export const winRate = r => (r.w + r.l + r.d ? Math.round(r.w / (r.w + r.l + r.d) * 100) : 0);

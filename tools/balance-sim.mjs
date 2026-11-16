// 平衡模拟:AI 对 AI 跑若干局,统计钢铁对其它三个势力的胜率,以及「装甲维修」的施放次数和实际回血量。
// 用法:node tools/balance-sim.mjs <每个对阵的局数> [仓库路径,默认本仓库]
// 双方都是 smart AI,双方位置交替(一半钢铁在 p,一半在 e),场景固定 starcore。
const N = Number(process.argv[2] ?? 20);
// 第二个参数给另一份仓库(比如改前版本的 git worktree)就测那一份,用来对比改前改后
const ROOT = process.argv[3] ? 'file:///' + process.argv[3].replace(/\\/g, '/') + '/js/' : new URL('../js/', import.meta.url).href;
const { Game } = await import(ROOT + 'game.js');
const { SimpleAI } = await import(ROOT + 'ai.js');
const { PRESET_DECKS, FACTIONS } = await import(ROOT + 'cards.js');

// 简单可复现的随机:替换 Math.random,保证改前改后跑的是同一组随机序列
let seed = 12345;
Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

const DT = 0.1, MAX_T = 600;
function match(pf, ef) {
  const g = new Game(pf, ef, { p: PRESET_DECKS[pf], e: PRESET_DECKS[ef] }, { sceneId: 'starcore' });
  const ais = { p: new SimpleAI(g, 'p', { level: 'smart' }), e: new SimpleAI(g, 'e', { level: 'smart' }) };
  const repair = { casts: 0, healed: 0 };
  for (const who of ['p', 'e']) {
    const side = g.side(who);
    if (side.faction !== 'steel') continue;
    const orig = g.playCard.bind(g);
    g.playCard = (w, idx, x, z) => {
      const card = g.side(w).hand[idx];
      const isRepair = w === who && card?.id === 'steel_repair';
      const before = isRepair ? g.units.filter(u => u.side === w && !u.dead).reduce((a, u) => a + u.hp, 0) : 0;
      const ok = orig(w, idx, x, z);
      if (ok && isRepair) {
        repair.casts++;
        repair.healed += g.units.filter(u => u.side === w && !u.dead).reduce((a, u) => a + u.hp, 0) - before;
      }
      return ok;
    };
  }
  while (g.phase !== 'end' && g.time < MAX_T) {
    if (g.phase === 'upgrade') for (const w of ['p', 'e']) if (g.upgrade && !g.upgrade.picked[w]) g.chooseUpgrade(0, w);
    g.tick(DT);
    ais.p.tick(DT); ais.e.tick(DT);
    g.drainEvents();
  }
  return { winner: g.winner, repair };
}

const out = {};
let casts = 0, healed = 0;
for (const foe of Object.keys(FACTIONS).filter(f => f !== 'steel')) {
  let w = 0, l = 0, d = 0;
  for (let i = 0; i < N; i++) {
    const steelIsP = i % 2 === 0;
    const r = steelIsP ? match('steel', foe) : match(foe, 'steel');
    const steelWon = r.winner === (steelIsP ? 'p' : 'e');
    if (!r.winner) d++; else if (steelWon) w++; else l++;
    casts += r.repair.casts; healed += r.repair.healed;
  }
  out[foe] = { w, l, d, rate: (w / N * 100).toFixed(0) + '%' };
}
console.log(JSON.stringify({ N, vs: out, repairCastsPerGame: (casts / (N * 3)).toFixed(2), healPerCast: casts ? (healed / casts).toFixed(0) : '-' }));

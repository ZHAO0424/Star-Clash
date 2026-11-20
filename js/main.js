// 入口 — UI 粘合层:菜单(主页 / 对局设置 / 图鉴组卡 / 设置)/ 战斗 HUD / 手牌拖拽 / 强化 / 结算 / 游戏循环
// 对局逻辑都在 session(本地人机或联机)里;这里只读 session.game、调用 session 的操作方法
import { FACTIONS, CARDS, cardTags, previewRadius, factionPool, PRESET_DECKS, deckProblem, DECK_SIZE, MIN_DEPLOYABLES } from './cards.js';
import { DISCARD_COST, Game, isPlaced } from './game.js';
import { autoTargets, healSnap } from './heal-snap.js';
import { BattleScene } from './scene.js';
import { XRControls } from './xr.js';
import { ready as assetsReady, menuReady, cardArt, emblem, uiArt, loadScene, sceneArt, XR_GUIDE } from './assets.js';
import { SCENES as ALL_SCENES, PLAYABLE_IDS as SCENE_IDS, sceneById, randomScene } from './scenes.js';
const SCENES = ALL_SCENES.filter(s => SCENE_IDS.includes(s.id));   // 大厅显示已开放的场景

// 界面小图标:有美术图用图(黑底发光图,滤色混合去黑),没有就用文字符号
function ico(name, fallback) {
  const a = uiArt(name);
  return a ? `<img class="ico" src="${a.url}" alt="${fallback}" draggable="false">` : fallback;
}
import { LocalSession, NetSession, connectOnline } from './session.js';
import { sfx, sfxForEvent, setMuted, isMuted } from './sfx.js';
import { loadDeck, saveDeck, prefs, loadStats, recordGame, winRate } from './storage.js';
import { coreStatus, t, getLang, setLang, applyStaticText, cardName, cardDesc, factionName, factionDesc, tagName, upgradeText, passiveText } from './i18n.js';

const $ = sel => document.querySelector(sel);
const hex = c => '#' + c.toString(16).padStart(6, '0');

let session = null, scene = null, xr = null;
let pendingBattle = null;   // 正在加载场景、还没开始的对局
let lastT = 0;
let selectedCard = null;
let drag = null;   // {id, card, hit, pointerId}
let selFaction = prefs.faction;
let firstMatch = null;
let paused = false;   // 本地人机对局暂停:loop 里跳过 session.tick(联机由服务器推进,不能暂停)

const game = () => session?.game;
// 调试:地址带 ?debug 时把场景 / 对局挂到 window 上,方便在控制台里看特效、模型
if (new URLSearchParams(location.search).has('debug')) window.__bg = { get scene() { return scene; }, get game() { return game(); }, get session() { return session; } };
const SCREENS = ['#front-loading', '#home-screen', '#setup-screen', '#codex-screen', '#settings-screen'];
let activeScreen = '#front-loading';
// sel = 菜单屏选择器;null = 进入对局(显示 HUD)
function showScreen(sel) {
  activeScreen = sel;
  for (const s of SCREENS) $(s).style.display = s === sel ? '' : 'none';
  $('#hud').style.display = sel ? 'none' : '';
  document.body.classList.toggle('in-battle', !sel);
  $('#hud').inert = false;
}

// ── 卡牌 DOM(对局手牌用;非 compact 分支原供旧卡组构筑页,现无调用方)──
function cardElement(card, { discard = false, compact = false } = {}) {
  const div = document.createElement('div');
  div.className = `card ${card.type}${compact ? ' compact-card' : ''}`;
  div.style.setProperty('--fc', hex(FACTIONS[card.faction].color));
  const stats = card.type === 'spell'
    ? `<span class="stat spell-tag">${t('spell')}</span>`
    : (card.atk > 0 ? `<span class="stat">${ico('ui_atk', '⚔')}${Math.round(card.atk)}</span>` : '') + `<span class="stat">${ico('ui_hp', '♥')}${Math.round(card.hp)}</span>`;
  const firstTag = cardTags(card)[0];
  const tags = compact ? '' : cardTags(card).map(x => `<span class="tag">${tagName(x)}</span>`).join('');
  const art = cardArt(card);
  div.innerHTML = `
    <div class="cost">${card.cost}</div>
    ${art ? `<img class="art${art.glow ? ' glow' : ''}" src="${art.url}" alt="" draggable="false">` : ''}
    <div class="cname">${cardName(card)}</div>
    ${compact ? `<div class="compact-role">${t(card.type)}${firstTag ? ' · ' + tagName(firstTag) : ''}</div>` : `
    <div class="stats">${stats}</div>
    <div class="info">${tags ? `<div class="tags">${tags}</div>` : ''}<div class="cdesc">${cardDesc(card)}</div></div>`}
    ${discard ? `<button type="button" class="discard" title="${t('discardTip', { n: DISCARD_COST })}" aria-label="${t('discardTip', { n: DISCARD_COST })}">${ico('ui_discard', '✕')}</button>` : ''}`;
  return div;
}

// ── 菜单通用 ──
const fname = id => factionName(id, FACTIONS[id].name);
const isEn = () => getLang() === 'en';
const sceneName = s => (isEn() ? s.en : s.name);
const deckAverage = ids => (ids.length ? (ids.reduce((a, id) => a + CARDS[id].cost, 0) / ids.length).toFixed(1) : '–');
const deckProblemText = prob => t('deckErr_' + prob.code, {
  n: prob.code === 'deploy' ? MIN_DEPLOYABLES : DECK_SIZE,
  c: prob.card ? cardName(CARDS[prob.card] ?? { id: prob.card, name: prob.card }) : '',
});
// 分段控件 / 选项组:按 data-v 标出选中项
function markGroup(group, value) {
  for (const b of group.querySelectorAll('[data-v]')) {
    const on = b.dataset.v === value;
    b.classList.toggle('sel', on);
    b.setAttribute('aria-pressed', String(on));
  }
}
function refreshWordmarks() {
  const src = `assets/ui/brand/logo-${isEn() ? 'en' : 'zh'}.webp`;
  for (const image of document.querySelectorAll('.brand-wordmark')) {
    if (image.getAttribute('src') === src) continue;
    image.hidden = true;
    image.onload = () => { image.hidden = false; };
    image.onerror = () => { image.hidden = true; };
    image.src = src;
  }
}

let guideStep = 0;
function renderXRGuide() {
  const step = XR_GUIDE[guideStep];
  const art = $('#guide-art');
  art.hidden = false;
  art.src = step.url;
  $('#guide-step').textContent = t('guide_' + step.id);
  $('#guide-description').textContent = t('guideDesc_' + step.id);
  $('#guide-progress').textContent = `${guideStep + 1} / ${XR_GUIDE.length}`;
  $('#btn-guide-prev').disabled = guideStep === 0;
  $('#btn-guide-next').textContent = t(guideStep === XR_GUIDE.length - 1 ? 'guideDone' : 'guideNext');
}
$('#guide-art').onerror = () => { $('#guide-art').hidden = true; };
$('#btn-xr-guide').onclick = () => {
  guideStep = 0;
  renderXRGuide();
  $('#xr-guide').showModal();
};
$('#btn-guide-close').onclick = () => $('#xr-guide').close();
$('#btn-guide-prev').onclick = () => { if (guideStep > 0) { guideStep--; renderXRGuide(); } };
$('#btn-guide-next').onclick = () => {
  if (guideStep === XR_GUIDE.length - 1) $('#xr-guide').close();
  else { guideStep++; renderXRGuide(); }
};

function shouldGuideFirstMatch() {
  const { w, l, d } = loadStats().total;
  return !prefs.firstMatchSeen && w + l + d === 0;
}

// ── 主页 ──
function openHome() {
  applyStaticText();
  refreshWordmarks();
  refreshMuteButton();
  updateXREntry();
  showScreen('#home-screen');
  $('#home-title').focus({ preventScroll: true });
}
$('#btn-start').onclick = () => { sfx('click'); openSetup('ai'); };
$('#btn-home-online').onclick = () => { sfx('click'); openSetup('online'); };
$('#btn-codex').onclick = () => { sfx('click'); openCodex(); };
$('#btn-settings').onclick = () => { sfx('click'); openSettings(); };

// ── 对局设置(人机 / 联机共用,模式由主页入口决定)──
let setupMode = 'ai';   // 'ai' | 'online'
function openSetup(mode = setupMode) {
  setupMode = mode;
  renderSetup();
  showScreen('#setup-screen');
  $('#setup-title').focus({ preventScroll: true });
  if (mode === 'online') openOnline();
}
function renderSetup() {
  applyStaticText();
  refreshMuteButton();
  const online = setupMode === 'online';
  $('#setup-title').textContent = t(online ? 'setupOnline' : 'setupAI');
  $('#opp-title').textContent = t(online ? 'oppFriend' : 'oppAI');
  $('#difficulty').hidden = online;
  $('#online-form').hidden = !online;
  $('#leaderboard-panel').hidden = !online;
  markGroup($('#difficulty'), prefs.difficulty);
  renderFactions();
  buildSceneList();
  refreshFightButton();
}
// 右下主按钮:立绘没下载完时显示进度;联机模式下是「创建房间」
let artLoaded = false, loadingText = '';
function refreshFightButton() {
  const online = setupMode === 'online';
  const button = $('#btn-fight');
  button.textContent = artLoaded ? t(online ? 'create' : 'fight') : loadingText || t('loading');
  button.disabled = !artLoaded || Boolean(pendingBattle) || (online && (window.BG_STATIC || Boolean(pendingConnection)));
  $('#btn-join').disabled = !artLoaded || window.BG_STATIC || Boolean(pendingConnection);
  $('#btn-edit-deck').disabled = !artLoaded || Boolean(pendingConnection);
}

function renderFactions() {
  $('#faction-list').replaceChildren(...Object.values(FACTIONS).map(fac => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice' + (fac.id === selFaction ? ' sel' : '');
    button.dataset.faction = fac.id;
    button.setAttribute('aria-pressed', String(fac.id === selFaction));
    button.style.setProperty('--fc', hex(fac.color));
    const em = emblem(fac.id);
    button.innerHTML = `<img class="art" src="assets/ui/factions/${fac.id}.webp" width="900" height="600" alt="" decoding="async" draggable="false">
      <span class="name">${em ? `<img src="${em.url}" alt="" draggable="false">` : ''}<span class="label">${fname(fac.id)}</span></span>`;
    button.onclick = () => {
      sfx('click');
      selFaction = prefs.faction = fac.id;
      renderFactions();
      $(`[data-faction=${fac.id}]`).focus({ preventScroll: true });
    };
    return button;
  }));
  const selected = FACTIONS[selFaction];
  const passive = passiveText(selFaction, selected.passive);
  $('#faction-passive').style.setProperty('--fc', hex(selected.color));
  $('#faction-passive-name').textContent = `${t('passive')} · ${passive.name}`;
  $('#faction-passive-desc').textContent = passive.desc;
  $('#deck-summary').textContent = t('deckLine', { avg: deckAverage(loadDeck(selFaction)) });
}

for (const b of $('#difficulty').querySelectorAll('[data-v]')) {
  b.onclick = () => { sfx('click'); prefs.difficulty = b.dataset.v; markGroup($('#difficulty'), prefs.difficulty); };
}
$('#btn-edit-deck').onclick = () => { sfx('click'); openCodex({ faction: selFaction, from: '#setup-screen' }); };
$('#btn-setup-back').onclick = () => {
  cancelPending();
  openHome();
  $(setupMode === 'online' ? '#btn-home-online' : '#btn-start').focus();
};
$('#btn-fight').onclick = () => {
  sfx('click');
  if (setupMode === 'online') goOnline(onlineHello('create'));
  else startLocal({ guided: shouldGuideFirstMatch() });
};

// 战场选择:随机或已开放场景;大预览显示选中战场的名字和说明
const sceneImage = field => {
  if (!field) return uiArt('bg_menu')?.url || 'assets/ui/bg_menu.webp';
  const art = sceneArt(field.id);
  return field.menuPreview || art.concept || art.sky || '';
};
function buildSceneList() {
  const cur = SCENE_IDS.includes(prefs.scene) ? prefs.scene : 'random';
  const field = cur === 'random' ? null : sceneById(cur);
  $('#arena-img').src = sceneImage(field);
  $('#arena-name').textContent = field ? sceneName(field) : t('randomScene');
  $('#arena-description').textContent = field ? (isEn() ? field.descEn : field.desc) : t('randomFieldHelp');
  $('#scene-list').replaceChildren(...[null, ...SCENES].map(s => {
    const id = s?.id ?? 'random';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice' + (cur === id ? ' sel' : '');
    button.dataset.scene = id;
    button.setAttribute('aria-pressed', String(cur === id));
    button.innerHTML = `<img class="art" src="${sceneImage(s)}" alt="" draggable="false"><span class="name">${escapeHtml(s ? sceneName(s) : t('randomScene'))}</span>`;
    button.onclick = () => { sfx('click'); prefs.scene = id; buildSceneList(); $(`[data-scene=${id}]`).focus({ preventScroll: true }); };
    return button;
  }));
}
const pickScene = () => (SCENE_IDS.includes(prefs.scene) ? prefs.scene : randomScene());

// ── 图鉴(含组卡):按势力浏览全部卡牌,右侧详情 + 出战卡组;保存后回到打开它的那一页 ──
let codexFaction = null, codexCard = null, codexReturn = '#home-screen';
let deckDrafts = {};   // 各势力未保存的卡组草稿(切换页签不丢)
function openCodex({ faction = codexFaction ?? selFaction, from = '#home-screen' } = {}) {
  codexReturn = from;
  codexFaction = faction;
  codexCard = null;
  deckDrafts = Object.fromEntries(Object.keys(FACTIONS).map(f => [f, [...loadDeck(f)]]));
  applyStaticText();
  refreshMuteButton();
  renderCodex();
  showScreen('#codex-screen');
  $('#codex-title').focus({ preventScroll: true });
}
function closeCodex() {
  if (codexReturn === '#setup-screen') { openSetup(); $('#btn-edit-deck').focus(); }
  else { openHome(); $('#btn-codex').focus(); }
}
function renderCodex() {
  const deck = deckDrafts[codexFaction];
  const cards = factionPool(codexFaction);
  if (!cards.some(card => card.id === codexCard)) codexCard = cards[0]?.id ?? null;
  $('#codex-tabs').replaceChildren(...Object.values(FACTIONS).map(fac => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'g-btn g-ink g-sm' + (fac.id === codexFaction ? ' sel' : '');
    button.dataset.tab = fac.id;
    button.setAttribute('aria-pressed', String(fac.id === codexFaction));
    const em = emblem(fac.id);
    button.innerHTML = `${em ? `<img src="${em.url}" alt="" draggable="false">` : ''}${fname(fac.id)}`;
    button.onclick = () => {
      sfx('click');
      codexFaction = fac.id;
      codexCard = null;
      renderCodex();
      $(`[data-tab=${fac.id}]`).focus({ preventScroll: true });
    };
    return button;
  }));
  $('#codex-grid').replaceChildren(...cards.map(card => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cx-card' + (deck.includes(card.id) ? ' in' : '') + (card.id === codexCard ? ' view' : '');
    button.dataset.card = card.id;
    button.setAttribute('aria-pressed', String(card.id === codexCard));
    const art = cardArt(card);
    button.innerHTML = `${art ? `<img class="${art.glow ? 'glow' : ''}" src="${art.url}" alt="" draggable="false">` : ''}
      <span class="cost-badge">${card.cost}</span><span class="tick" aria-hidden="true">✓</span><span class="cname">${cardName(card)}</span>`;
    button.onclick = () => viewCodexCard(card.id, button);
    return button;
  }));
  renderCodexDetail();
  renderRoster();
}
// 点卡 / 点卡组格:查看这张卡;窄屏上详情在网格上方,滚过去
function viewCodexCard(id, source) {
  sfx('click');
  codexCard = id;
  const fromSlot = source?.classList.contains('dslot');
  renderCodex();
  if (!fromSlot) $(`#codex-grid [data-card=${id}]`)?.focus({ preventScroll: true });
  if (matchMedia('(max-width: 720px)').matches) $('#codex-detail').scrollIntoView({ block: 'nearest' });
}
function renderCodexDetail() {
  const panel = $('#codex-detail');
  const card = CARDS[codexCard];
  if (!card) { panel.replaceChildren(); return; }
  const deck = deckDrafts[codexFaction];
  const inDeck = deck.includes(card.id), full = deck.length >= DECK_SIZE;
  const art = cardArt(card);
  const chips = card.type === 'spell' ? [] : [
    [t('cardHealth'), Math.round(card.hp)],
    card.atk > 0 && [t('cardAttack'), Math.round(card.atk)],
    card.range > 0 && [t('cardRange'), card.range],
  ].filter(Boolean);
  panel.innerHTML = `<div class="art-wrap">${art ? `<img class="art${art.glow ? ' glow' : ''}" src="${art.url}" alt="" draggable="false">` : '<div class="art"></div>'}<span class="cost-badge">${card.cost}</span></div>
    <span class="type">${[t(card.type), ...cardTags(card).map(tagName)].join(' · ')}</span>
    <h3 id="codex-card-title">${cardName(card)}</h3>
    ${chips.length ? `<div class="chips">${chips.map(([label, value]) => `<span class="chip">${label}<b>${value}</b></span>`).join('')}</div>` : ''}
    <p class="desc">${cardDesc(card)}</p>
    <div class="acts">
      <button class="g-btn ${inDeck ? 'g-ink' : 'g-gold'} g-sm" type="button" id="btn-deck-toggle"${!inDeck && full ? ' disabled' : ''}>${t(inDeck ? 'removeFromDeck' : full ? 'deckFullBtn' : 'addToDeck')}</button>
    </div>`;
  $('#btn-deck-toggle').onclick = () => {
    sfx('click');
    const draft = deckDrafts[codexFaction];
    deckDrafts[codexFaction] = draft.includes(card.id) ? draft.filter(id => id !== card.id) : [...draft, card.id];
    renderCodex();
    $('#btn-deck-toggle').focus({ preventScroll: true });
  };
}
function renderRoster() {
  const deck = deckDrafts[codexFaction];
  const sorted = deck.map(id => CARDS[id]).sort((a, b) => a.cost - b.cost);
  $('#deck-slots').replaceChildren(...Array.from({ length: DECK_SIZE }, (_, i) => {
    const card = sorted[i];
    if (!card) {
      const slot = document.createElement('span');
      slot.className = 'dslot empty';
      return slot;
    }
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'dslot';
    slot.title = cardName(card);
    slot.setAttribute("aria-label", cardName(card));
    const art = cardArt(card);
    slot.innerHTML = `${art ? `<img class="${art.glow ? 'glow' : ''}" src="${art.url}" alt="" draggable="false">` : ''}<span class="cost-badge">${card.cost}</span>`;
    slot.onclick = () => viewCodexCard(card.id, slot);
    return slot;
  }));
  $('#deck-count').textContent = `${deck.length}/${DECK_SIZE}`;
  $('#deck-avg').textContent = deckAverage(deck);
  const problem = deckProblem(codexFaction, deck);
  $('#deck-err').textContent = problem ? deckProblemText(problem) : '';
}
$('#btn-deck-preset').onclick = () => {
  sfx('click');
  deckDrafts[codexFaction] = [...PRESET_DECKS[codexFaction]];
  renderCodex();
};
// 保存:任何势力的草稿不合法就切过去显示原因,一张都不存;只写改动过的卡组
$('#btn-deck-save').onclick = () => {
  const bad = Object.keys(deckDrafts).find(f => deckProblem(f, deckDrafts[f]));
  if (bad) {
    codexFaction = bad;
    renderCodex();
    return;
  }
  for (const [faction, ids] of Object.entries(deckDrafts)) {
    if (ids.join() !== loadDeck(faction).join()) saveDeck(faction, ids);
  }
  sfx('click');
  closeCodex();
};
$('#btn-codex-back').onclick = () => { sfx('click'); closeCodex(); };

// ── 设置 ──
function openSettings() {
  renderSettings();
  showScreen('#settings-screen');
  $('#settings-title').focus({ preventScroll: true });
}
function renderSettings() {
  applyStaticText();
  markGroup($('#settings-language'), getLang());
  markGroup($('#settings-sound'), isMuted() ? 'off' : 'on');
  markGroup($('#settings-size'), prefs.boardSize);
  updateXREntry();
}
const onSegment = (selector, apply) => {
  for (const b of $(selector).querySelectorAll('[data-v]')) b.onclick = () => { apply(b.dataset.v); sfx('click'); renderSettings(); };
};
onSegment('#settings-language', value => { setLang(value); refreshWordmarks(); refreshMuteButton(); });
onSegment('#settings-sound', value => { setMuted(value === 'off'); refreshMuteButton(); });
onSegment('#settings-size', value => { prefs.boardSize = value; xr?.applyBoardSize(); });
onSegment('#settings-xr-mode', value => { prefs.xrMode = value; });
$('#btn-settings-back').onclick = () => { sfx('click'); openHome(); $('#btn-settings').focus(); };

// ── 联机(对局设置页的联机模式)──
const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
let pendingConnection = null;
function openOnline() {
  if (pendingConnection) return;   // 建房等待中:保持现状
  $('#player-name').value = prefs.name;
  $('#online-err').textContent = '';
  showConnectionProgress('');
  // 静态网页版(GitHub Pages)没有联机服务器:只说明原因,不去连
  if (window.BG_STATIC) {
    $('#online-err').textContent = t('staticNoOnline');
    const online = window.BG_ONLINE_URL;   // 联机版地址(同一份代码跑在 Node 服务器上)
    $('#leaderboard').innerHTML = online && /^https:\/\//.test(online)
      ? `<a class="g-btn g-teal g-sm" href="${escapeHtml(online)}">${t('goOnline')}</a>`
      : `<span class="lb-note">${t('staticNoOnline')}</span>`;
    return;
  }
  $('#leaderboard').textContent = t('loading');
  fetch('api/leaderboard').then(r => (r.ok ? r.json() : Promise.reject())).then(rows => {
    $('#leaderboard').innerHTML = rows.length
      ? rows.map((r, i) => `<div class="lb-row"><b>${i + 1}. ${escapeHtml(r.name)}</b><span>${r.rating} · ${t('fstat', { w: r.wins, l: r.losses, r: winRate({ w: r.wins, l: r.losses, d: r.draws || 0 }) })}</span></div>`).join('')
      : `<span class="lb-note">${t('noRecords')}</span>`;
  }).catch(() => {
    $('#leaderboard').innerHTML = `<span class="err">${t('noServer')}</span>`;
  });
}
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function onlineHello(t, extra = {}) {
  prefs.name = $('#player-name').value.trim();
  return { t, faction: selFaction, deck: loadDeck(selFaction), name: prefs.name, scene: prefs.scene, ...extra };
}
// 连接中 / 等房:锁住会改变这一局的输入(势力、战场、卡组、昵称、房号)
function showConnectionProgress(key) {
  const busy = Boolean(key);
  for (const id of ['#player-name', '#join-code']) $(id).disabled = busy;
  $('#faction-list').inert = $('#scene-list').inert = busy;
  $('#online-state').hidden = !busy;
  $('#room-wait').hidden = key !== 'waiting';
  $('#online-progress').textContent = key ? t(key) : '';
  $('#btn-cancel-connection').hidden = !busy;
  refreshFightButton();
}

async function goOnline(msg) {
  if (pendingConnection) return;
  const request = { socket: null };
  pendingConnection = request;
  $('#online-err').textContent = '';
  showConnectionProgress('connecting');
  $('#btn-cancel-connection').focus();
  try {
    const connect = () => connectOnline(wsUrl(), msg, {
      onSocket: socket => { request.socket = socket; },
      onRoom: (code, name) => {
        if (pendingConnection !== request) return;
        $('#room-code').textContent = code;
        $('#room-identity').textContent = name || msg.name ? t('roomIdentity', { name: name || msg.name }) : '';
        showConnectionProgress('waiting');
        $('#btn-copy-room').focus();
      },
    });
    // 还没连上就失败的自动重试 2 次(跨境网络握手偶发超时),玩家不用自己反复点
    let result;
    for (let attempt = 1; ; attempt++) {
      try { result = await connect(); break; } catch (e) {
        if (!e.retryable || attempt >= 3 || pendingConnection !== request) throw e;
      }
    }
    const { ws, start } = result;
    if (pendingConnection !== request) { ws.close(); return; }
    showConnectionProgress('');
    startOnline(ws, start);
  } catch (e) {
    if (pendingConnection === request && e.code !== 'cancel') {
      const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);   // 本地开发才提示启动服务器,线上提示网络重试
      $('#online-err').textContent = e.message + (e.code !== 'noconn' ? '' : local ? t('needServer') : t('netRetry'));
    }
  } finally {
    if (pendingConnection === request) {
      pendingConnection = null;
      showConnectionProgress('');
      if (activeScreen === '#setup-screen' && !pendingBattle) $('#btn-fight').focus();
    }
  }
}
function cancelPending() {
  const request = pendingConnection;
  pendingConnection = null;
  request?.socket?.cancel();
  showConnectionProgress('');
}
$('#btn-cancel-connection').onclick = () => {
  cancelPending();
  $('#online-state').hidden = false;
  $('#online-progress').textContent = t('connectionCancelled');
  $('#btn-fight').focus();
};
$('#btn-copy-room').onclick = async () => {
  const code = $('#room-code');
  try {
    await navigator.clipboard.writeText(code.textContent);
    toast(t('roomCopied'));
  } catch {
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    toast(t('roomCopyManually'));
  }
};
$('#btn-join').onclick = () => {
  sfx('click');
  const code = $('#join-code').value.trim().toUpperCase();
  if (code.length !== 4) { $('#online-err').textContent = t('codeLen'); return; }
  goOnline(onlineHello('join', { code }));
};
$('#join-code').onkeydown = event => {
  if (event.key === 'Enter') $('#btn-join').click();
};

// ── 开局 ──
function ensureScene() {
  if (scene) return;
  scene = new BattleScene($('#gl'));
  xr = new XRControls(scene, {
    getGame: () => game(),
    getFirstMatch: () => firstMatch,
    onFirstMatchDone: () => closeFirstMatch(true),
    hasOnlineOpponent: () => Boolean(session?.online && session.connected),
    onXRPose: pose => session?.sendXRPose?.(pose),
    getLobby: () => {
      const field = SCENE_IDS.includes(prefs.scene) ? sceneById(prefs.scene) : null;
      return {
        faction: fname(selFaction),
        field: field ? (getLang() === 'en' ? field.en : field.name) : t('randomScene'),
        muted: isMuted(),
        loading: Boolean(pendingBattle),
      };
    },
    onLobbyAction: handleXRHomeAction,
    getBattleControls: () => ({ muted: isMuted(), boardSize: prefs.boardSize, online: Boolean(session?.online), handOpacity: prefs.xrHandOpacity }),
    canPause,
    isPaused: () => paused,
    onPause: value => setPaused(value),
    onBattleAction: handleXRBattleAction,
    getNetworkStatus: () => networkStatus({ problemsOnly: true }),
    getBoardSize: () => prefs.boardSize,
    getBoardRig: () => prefs.xrBoardRig,
    setBoardRig: rig => { prefs.xrBoardRig = rig; },
    onPlay: (idx, x, z) => {
      if (paused) { toast(t('xrPaused')); return false; }
      if (game().phase === 'prep') { toast(t('tPrep')); return false; }
      if (!canPlayDuringGuide(game().p.hand[idx])) return false;
      const played = session.play(idx, x, z);
      if (played) { firstDeploymentPlayed(); renderHand(); }
      else if (session.online && !session.connected) toast(networkStatus());
      return played;
    },
    onDiscard: idx => {
      if (firstMatch) return;
      if (paused) { toast(t('xrPaused')); return; }
      if (game().phase === 'prep') { toast(t('tPrep')); return; }
      if (session.discard(idx)) renderHand();
      else toast(game().canDiscard('p', idx) ? networkStatus() : t('tDiscardCost', { n: DISCARD_COST }));
    },
    onUpgrade: i => pickUpgrade(i),
    onRestart: () => playAgain(),
    onToast: msg => toast(msg),
  });
  scene.renderer.setAnimationLoop(loop);
}

async function beginBattle(s, { guided = false } = {}) {
  pendingBattle?.leave();
  pendingBattle = s;
  $('#btn-again').disabled = true;
  refreshFightButton();   // 场景加载期间主按钮不可再点
  const loading = setTimeout(() => toast(t('tLoadingField')), 250);
  let field;
  try {
    ensureScene();
    field = await loadScene(s.sceneId || 'starcore');
  } catch (error) {
    console.error(error);
    s.leave();
    if (pendingBattle === s) {
      pendingBattle = null;
      $('#btn-again').disabled = false;
      refreshFightButton();
      toast(t('battleUnavailable'));
    }
    return;
  } finally {
    clearTimeout(loading);
    if (pendingBattle === s) $('#btn-again').disabled = false;
  }
  if (pendingBattle !== s) return;
  pendingBattle = null;
  refreshFightButton();
  session?.leave();
  session = s;
  setPaused(false, { silent: true });
  leaveArmed = -Infinity;
  xr.clearNotice();
  xr.receiveRemotePose(null);
  scene.setBattlefield(field, s.game.map);
  scene.setFactions(s.game.p.faction, s.game.e.faction);   // 塔和核心按双方势力换立绘
  crownCache.p = crownCache.e = -1;
  scene.clearStructures();
  for (const g of scene.unitMeshes.values()) scene.drop(g);
  scene.unitMeshes.clear();
  showScreen(null);
  $('#end-screen').style.display = 'none';
  $('#upgrade-screen').style.display = 'none';
  const g = game();
  $('#vs-line').textContent = t('vs', { a: fname(g.p.faction), b: fname(g.e.faction), op: session.opName });
  $('#net-status').textContent = '';
  selectCard(null);
  const starter = guided && g.p.hand.find((card, index) => card.type === 'unit' && g.canPlay('p', index));
  firstMatch = starter ? { step: 'deploy', cardId: starter.id, elapsed: 0 } : null;
  renderFirstMatch();
  renderHand();
  refreshHUD();
  // 调试句柄(控制台/自动化测试用)
  window.dbg = {
    get session() { return session; }, get game() { return game(); }, get ai() { return session.ai; },
    get scene() { return scene; }, get xr() { return xr; },
    play(idx, x, z) { return session.play(idx, x, z); }, renderHand, hudInsets,
  };
}

function startLocal({ guided = false } = {}) {
  const others = Object.keys(FACTIONS).filter(f => f !== selFaction);
  const enemyFaction = others[Math.floor(Math.random() * others.length)];
  beginBattle(new LocalSession({
    faction: selFaction, deck: guided ? PRESET_DECKS[selFaction] : loadDeck(selFaction),
    enemyFaction, enemyDeck: PRESET_DECKS[enemyFaction], difficulty: prefs.difficulty, sceneId: pickScene(),
    prep: guided ? 0 : undefined,   // 首局新手引导不加开局倒计时
  }), { guided });
}

function startOnline(ws, start) {
  const s = new NetSession(ws, start, {
    url: wsUrl(),
    onXRPose: pose => { if (session === s) xr?.receiveRemotePose(pose); },
    onLeft: () => toast(t('tOppLeft')),
    onClose: () => { if (session === s && game().phase !== 'end') toast(t('tConnLost')); },
    onOpDc: sec => { if (session === s) toast(t('tOpDc', { s: sec })); },
    onOpBack: () => { if (session === s) toast(t('tOpBack')); },
    onResumed: () => { if (session === s) { toast(t('tResumed')); renderHand(); } },
  });
  beginBattle(s);
  toast(t('tStart', { op: start.op.name, f: fname(start.op.faction) }));
}

function playAgain() {
  if (!session) return;
  if (session.online) {
    // 大厅是 DOM 界面,XR 里看不到:先退出 XR,否则眼镜里会停在旧画面
    scene?.renderer.xr.getSession?.()?.end().catch(() => {});
    backToMenu(() => openSetup('online')); return;
  }
  const c = session.config;
  beginBattle(new LocalSession({ ...c, deck: loadDeck(c.faction), sceneId: SCENE_IDS.includes(prefs.scene) ? prefs.scene : randomScene() }));
}

// open:回到哪个菜单屏(默认主页)
function backToMenu(open = openHome) {
  closeFirstMatch(false);
  countdownShown = '';
  showCountdown('');
  xr?.receiveRemotePose(null);
  xr?.updateRemoteAvatar(0, null);
  endDrag();
  selectCard(null);
  cancelPending();
  pendingBattle?.leave();
  pendingBattle = null;
  $('#btn-again').disabled = false;
  session?.leave();
  session = null;
  setPaused(false, { silent: true });
  $('#end-screen').style.display = 'none';
  $('#upgrade-screen').style.display = 'none';
  open();
}

function leaveBattle(confirmed = false) {
  if (confirmed !== true && session?.online && game().phase !== 'end' && !confirmLeave()) return false;
  backToMenu();
  leaveArmed = -Infinity;
  return true;
}
$('#btn-menu').onclick = leaveBattle;
// 联机中退出等于认输:按钮第一次点击只提示
let leaveArmed = -Infinity;
function confirmLeave() {
  if (performance.now() - leaveArmed < 3000) return true;
  leaveArmed = performance.now();
  toast(t('tLeave'));
  return false;
}
$('#btn-again').onclick = () => playAgain();
$('#btn-restart').onclick = () => backToMenu();
// 音效开关:对局里的 #btn-mute + 各菜单页右上角的圆形音效键
const muteButtons = [$('#btn-mute'), ...document.querySelectorAll('.sound-toggle')];
function refreshMuteButton() {
  const muted = isMuted();
  for (const button of muteButtons) {
    button.textContent = muted ? '🔇' : '🔊';
    button.setAttribute('aria-pressed', String(muted));
    button.setAttribute('aria-label', t('muteTip'));
    button.title = t('muteTip');
  }
}
for (const button of muteButtons) button.onclick = () => { setMuted(!isMuted()); refreshMuteButton(); sfx('click'); };
refreshMuteButton();

// ── 暂停(XR 手心菜单发起;桌面上显示「已暂停」按钮,点一下继续)──
function canPause() {
  return Boolean(session && !session.online && !firstMatch && game().phase !== 'end');
}
function setPaused(value, { silent = false } = {}) {
  const next = Boolean(value) && canPause();
  if (next === paused) return;
  paused = next;
  const badge = $('#pause-badge');
  badge.hidden = !paused;
  badge.textContent = t('pausedResume');
  if (!silent) toast(t(paused ? 'xrPaused' : 'tGameResumed'));
}
$('#pause-badge').onclick = () => { sfx('click'); setPaused(false); };

// ── 手牌 ──
function renderHand() {
  const g = game();
  const wrap = $('#hand');
  const focused = wrap.contains(document.activeElement) ? document.activeElement : null;
  const focusedCard = focused?.closest('.card')?.dataset.cardId;
  const focusedAction = focused?.classList.contains('discard') ? '.discard' : '.card-select';
  wrap.innerHTML = '';
  if (selectedCard && !g.p.hand.some(card => card.id === selectedCard.id)) selectCard(null);
  g.p.hand.forEach((card, idx) => {
    const div = cardElement(card, { discard: true, compact: true });
    div.dataset.idx = idx;
    div.dataset.cardId = card.id;
    const picker = document.createElement('button');
    picker.type = 'button';
    picker.className = 'card-select';
    picker.setAttribute('aria-label', t('selectBattleCard', { name: cardName(card), cost: card.cost }));
    picker.addEventListener('click', event => {
      if (event.detail === 0) chooseCard(card);
    });
    div.append(picker);
    markPlayable(div, g, idx, card);
    div.addEventListener('pointerdown', e => beginDrag(e, card));
    const dBtn = div.querySelector('.discard');
    dBtn.addEventListener('pointerdown', e => e.stopPropagation());
    dBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (paused) { toast(t('xrPaused')); return; }
      if (game().phase === 'prep') { toast(t('tPrep')); return; }
      if (session.discard(idx)) renderHand();
      else toast(t('tDiscardCost', { n: DISCARD_COST }));
    });
    wrap.appendChild(div);
  });
  wrap.dataset.sig = handSig();
  if (focusedCard) {
    const previous = wrap.querySelector(`[data-card-id=${focusedCard}] ${focusedAction}:not(:disabled)`);
    (previous || wrap.querySelector('.card-select'))?.focus({ preventScroll: true });
  }
}
// 可出 / 不可出 / 要血祭(混沌法力不够时用核心生命补,卡牌标红并显示要扣多少)
function markPlayable(div, g, idx, card) {
  const blood = g.p.mana < card.cost ? g.bloodCost('p', card) : null;
  const guideBlocked = !canPlayDuringGuide(card);
  div.classList.toggle('disabled', Boolean(guideBlocked) || (g.p.mana < card.cost && blood === null));
  div.querySelector('.card-select').disabled = Boolean(guideBlocked);
  div.classList.toggle('blood', blood !== null);
  div.classList.toggle('guide-card', firstMatch?.step === 'deploy' && firstMatch.cardId === card.id);
  markSelected(div, selectedCard?.id === card.id);
  const discard = div.querySelector('.discard');
  if (discard) discard.disabled = Boolean(firstMatch) || !g.canDiscard('p', idx);
  const tag = div.querySelector('.blood-tag');
  if (blood !== null) {
    if (!tag) div.insertAdjacentHTML('beforeend', `<div class="blood-tag" title="${t('bloodTip', { n: blood })}">-${blood}</div>`);
    else tag.textContent = `-${blood}`;
  } else tag?.remove();
}
const handSig = () => game().p.hand.map(c => c?.id).join('|');

function markSelected(card, active) {
  if (card.classList.contains('aiming') === active && card.querySelector('.card-select').hasAttribute('aria-pressed')) return;
  card.classList.toggle('aiming', active);
  card.querySelector('.card-select').setAttribute('aria-pressed', String(active));
}

function selectCard(card) {
  selectedCard = card ? { id: card.id, card } : null;
  for (const el of $('#hand').children) markSelected(el, el.dataset.cardId === card?.id);
  $('#play-instruction').textContent = t(card ? 'aimBattleCard' : 'battleCardHelp', card ? { name: cardName(card) } : {});
  $('#btn-cancel-card').hidden = !card;
  const detail = $('#play-card-detail');
  detail.hidden = !card;
  detail.textContent = card ? cardDesc(card) : '';
  clearPlacementError();
  if (card && scene && ['battle', 'prep'].includes(game()?.phase)) showCardPlacement(selectedCard, null);
  else scene?.showPlacement(null);
}

function chooseCard(card) {
  if (selectedCard?.id === card.id) { selectCard(null); return; }
  const g = game();
  const idx = g?.p.hand.findIndex(c => c.id === card.id) ?? -1;
  if (!['battle', 'prep'].includes(g?.phase) || idx < 0) return;   // 准备阶段可以选牌预览,出牌时再拦
  if (g.phase === 'battle' && !g.canPlay('p', idx)) { toast(t('tNoMana')); return; }
  selectCard(card);
}
$('#btn-cancel-card').onclick = () => selectCard(null);

function beginDrag(e, card) {
  if (drag || e.button !== 0 || !canPlayDuringGuide(card)) return;
  const idx = game().p.hand.indexOf(card);
  if (idx < 0 || !['battle', 'prep'].includes(game().phase)) return;   // 准备阶段可以拖牌预览,松手时提示「准备中」
  if (game().phase === 'battle' && !game().canPlay('p', idx)) { toast(t('tNoMana')); return; }
  e.preventDefault();
  drag = { id: card.id, card, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false, source: e.currentTarget };
}

function canPlayDuringGuide(card) {
  return !firstMatch || (firstMatch.step === 'deploy' && card?.type === 'unit');
}
function firstDeploymentPlayed() {
  if (!firstMatch || firstMatch.step !== 'deploy') return;
  firstMatch.step = 'watch';
  renderFirstMatch();
}

function renderFirstMatch() {
  $('#first-match-guide').hidden = !firstMatch;
  document.body.classList.toggle('in-first-match', Boolean(firstMatch));
  if (!firstMatch) return;
  const page = { deploy: 'firstDeploy', watch: 'firstWatch', core: 'firstCore' }[firstMatch.step];
  $('#first-match-title').textContent = t(page + 'Title');
  $('#first-match-text').textContent = t(page + 'Text');
  $('#btn-first-match-go').hidden = firstMatch.step !== 'core';
}
function closeFirstMatch(completed) {
  if (!firstMatch) return;
  const returnFocus = completed && $('#first-match-guide').contains(document.activeElement);
  if (completed) prefs.firstMatchSeen = true;
  firstMatch = null;
  renderFirstMatch();
  if (completed && game()?.phase === 'battle') {
    renderHand();
    if (returnFocus) $('#hand .card-select:not(:disabled)')?.focus();
  }
}
$('#btn-first-match-skip').onclick = () => closeFirstMatch(true);
$('#btn-first-match-go').onclick = () => closeFirstMatch(true);

let placementErrorTimer;
function clearPlacementError() {
  clearTimeout(placementErrorTimer);
  $('#placement-error').hidden = true;
}
function showPlacementError(key, pointer) {
  if (!pointer) { toast(t(key)); return; }
  const el = $('#placement-error');
  el.textContent = t(key);
  el.style.left = Math.max(101, Math.min(innerWidth - 101, pointer.clientX)) + 'px';
  el.style.top = Math.max(48, pointer.clientY) + 'px';
  el.hidden = false;
  clearTimeout(placementErrorTimer);
  placementErrorTimer = setTimeout(clearPlacementError, 2200);
}

function showGhost(x, y, card, reason) {
  const ghost = $('#drag-ghost');
  ghost.textContent = reason ? t(reason) : cardName(card);
  ghost.dataset.invalid = Boolean(reason);
  ghost.style.display = 'block';
  ghost.style.left = x + 'px';
  ghost.style.top = y + 'px';
}

function fieldHit(x, y) {
  return document.elementFromPoint(x, y) === $('#gl') ? scene.pickField(x, y) : null;
}

// 装甲维修:落点吸附到最近的受伤己方单位(heal-snap.js,与 XR 共用),预览和出牌都用吸附后的点
let healSnapId = null;   // 上一帧吸附的单位(滞回用)
function snapHeal(card, hit) {
  if (!hit || !autoTargets(card)) return hit;
  const heal = healSnap(game().units, 'p', card, hit.x, hit.z, healSnapId);
  healSnapId = heal.target?.id ?? null;
  return { ...hit, x: heal.x, z: heal.z, heal };
}

// 单位 / 建筑被岩石、墙、建筑挡住时就近找空位(game.nearestDeploySpot,与 XR 共用、服务器同一判定复核)
function snapDeploy(card, hit) {
  if (!hit || !isPlaced(card)) return hit;
  const spot = game().nearestDeploySpot('p', card, hit.x, hit.z);
  return spot ? { ...hit, x: spot.x, z: spot.z } : hit;
}

function showCardPlacement(placement, hit) {
  const { card } = placement;
  hit = snapHeal(card, snapDeploy(card, hit));
  const g = game();
  const reason = hit ? g.deployBlockReason('p', card, hit.x, hit.z) : null;
  scene.showPlacement({ ...hit, game: g, card, showDeployZone: isPlaced(card), radius: previewRadius(card), valid: !reason, isUnit: card.type !== 'spell' });
  return reason;
}

function playAt(placement, hit, pointer) {
  const g = game();
  if (g?.phase === 'prep') { toast(t('tPrep')); return false; }
  if (g?.phase !== 'battle' || (firstMatch && firstMatch.step !== 'deploy')) return false;
  if (!hit) { showPlacementError('deployOutside', pointer); return false; }
  if (paused) { toast(t('xrPaused')); return false; }
  hit = snapHeal(placement.card, snapDeploy(placement.card, hit));
  const idx = g.p.hand.findIndex(card => card.id === placement.id);
  if (idx < 0) return false;
  const card = g.p.hand[idx];
  if (!g.canPlay('p', idx)) { toast(t('tNoMana')); return false; }
  if (firstMatch && card.type !== 'unit') { showPlacementError('firstDeployTitle', pointer); return false; }
  const reason = g.deployBlockReason('p', card, hit.x, hit.z);
  if (reason) {
    // 点选模式(牌仍选中)才留着预览圈;拖拽松手时预览已在 endDrag 收起,不能再画出来(否则圈卡在场上不消失)
    if (placement === selectedCard) showCardPlacement(placement, hit);
    showPlacementError(reason, pointer);
    return false;
  }
  if (!session.play(idx, hit.x, hit.z)) return false;
  firstDeploymentPlayed();
  selectCard(null);
  renderHand();
  return true;
}

addEventListener('pointermove', e => {
  if (drag) {
    if (e.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
      selectCard(null);
      drag.moved = true;
      drag.source.classList.add('dragging');
    }
    const reason = showCardPlacement(drag, fieldHit(e.clientX, e.clientY));
    showGhost(e.clientX, e.clientY, drag.card, reason);
  } else if (selectedCard && e.pointerType !== 'touch' && ['battle', 'prep'].includes(game()?.phase)) {
    showCardPlacement(selectedCard, fieldHit(e.clientX, e.clientY));
  }
});

function endDrag() {
  if (!drag) return;
  drag.source.classList.remove('dragging');
  drag = null;
  $('#drag-ghost').style.display = 'none';
  scene?.showPlacement(null);
}
addEventListener('blur', () => { endDrag(); if (selectedCard) selectCard(null); });
addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.pointerId) endDrag(); });
addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const ended = drag;
  endDrag();
  if (ended.moved) playAt(ended, fieldHit(e.clientX, e.clientY), e);
  else if (ended.source.contains(document.elementFromPoint(e.clientX, e.clientY))) chooseCard(ended.card);
});
$('#gl').addEventListener('click', e => {
  if (selectedCard && !drag) playAt(selectedCard, fieldHit(e.clientX, e.clientY), e);
});

// ── HUD ──
function fmtTime(t) {
  const s = Math.ceil(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// 顶栏 / 手牌栏占掉的屏幕边距:横跨大半个屏幕宽的算上下边,窄的(横屏时的侧栏)算左右边
function hudInsets() {
  const W = innerWidth, H = innerHeight, ins = { top: 0, bottom: 0, left: 0, right: 0 };
  for (const el of [$('#top-bar'), $('#bottom')]) {
    const r = el.getBoundingClientRect();
    if (r.width >= W * 0.6) {
      if (r.top < H / 2) ins.top = Math.max(ins.top, r.bottom); else ins.bottom = Math.max(ins.bottom, H - r.top);
    } else if (r.left < W / 2) ins.left = Math.max(ins.left, r.right);
    else ins.right = Math.max(ins.right, W - r.left);
  }
  return ins;
}

const crownCache = { p: -1, e: -1 };
function networkStatus({ problemsOnly = false } = {}) {
  if (!session?.online || game()?.phase === 'end') return '';
  if (session.closed) return t('netClosed');
  if (session.reconnecting) return t('netReconnect');
  const stale = session.staleMs();
  return stale > 500 ? t('netLag', { ms: Math.round(stale) }) : problemsOnly ? '' : t('netOk');
}

function refreshHUD() {
  // 顶栏和手牌栏占掉的高度交给相机,战场完整显示在中间的空白区域
  if (!scene.renderer.xr.isPresenting) scene.setInsets(hudInsets());
  const g = game(), p = g.p, en = g.e;
  if (g.phase === 'upgrade' && g.upgrade) {
    const n = Math.max(0, Math.ceil(g.upgrade.timer));
    const label = $('#upgrade-time');
    if (label.dataset.seconds !== String(n)) {
      label.dataset.seconds = n;
      label.textContent = t('upgradeRemaining', { n });
      label.parentElement.classList.toggle('urgent', n <= 5);
      $('#upgrade-timer').value = n;
    }
  }
  const timer = $('#timer'), tag = $('#phase-tag');
  timer.textContent = fmtTime(g.timeLeft());
  const mode = g.overtime ? 'ot' : g.surge ? 'surge' : '';
  timer.className = tag.className = mode;
  tag.textContent = g.overtime ? t('otTag') : g.surge ? t('surgeTag') : '';
  const cp = g.crowns('p'), ce = g.crowns('e');
  if (cp !== crownCache.p || ce !== crownCache.e) {   // 只在变化时改 DOM(图标是 <img>)
    crownCache.p = cp; crownCache.e = ce;
    $('#crowns-p').innerHTML = `${ico('ui_crown', '♛')} ${cp}`;
    $('#crowns-e').innerHTML = `${ce} ${ico('ui_crown', '♛')}`;
  }
  for (const [id, side] of [['p', p], ['e', en]]) {
    const pct = Math.max(0, side.baseHP / side.baseHPMax);
    const bar = $(`#${id}-base`);
    bar.style.width = (pct * 100) + '%';
    bar.parentElement.classList.toggle('low', pct <= 0.25);
  }
  $('#p-base-num').textContent = Math.max(0, Math.round(p.baseHP));
  $('#e-base-num').textContent = Math.max(0, Math.round(en.baseHP));
  $('#mana-num').textContent = Math.floor(p.mana) + '/' + p.manaMax;
  $('#mana-fill').style.width = (p.mana / p.manaMax * 100) + '%';
  $('#mana-bar').style.setProperty('--mana-steps', p.manaMax);
  $('#upgrade-progress').textContent = g.playsToUpgrade() ? t('toUpgrade', { n: g.playsToUpgrade() }) : t('upgradesComplete');
  const core = $('#core-status');
  core.hidden = !g.node.contested && !g.node.capturing;
  if (!core.hidden) core.textContent = coreStatus(g.node);
  const next = g.nextCard('p'), preview = $('#next-card');
  const nextKey = next ? next.id + ':' + getLang() : '';
  if (preview.dataset.card !== nextKey) {
    preview.dataset.card = nextKey;
    preview.hidden = !next;
    const art = next && cardArt(next);
    preview.title = next ? t('nextCard', { c: cardName(next) }) : '';
    preview.innerHTML = next ? `<span>${t('nextLabel')}</span>${art ? `<img class="next-art${art.glow ? ' glow' : ''}" src="${art.url}" alt="">` : ''}<b>${next.cost}</b><span class="sr-only">${cardName(next)}</span>` : '';
  }
  const network = $('#net-status');
  const status = networkStatus();
  if (network.textContent !== status) network.textContent = status;
  network.classList.toggle('attention', Boolean(session.online && (session.closed || session.reconnecting)));
  // 手牌变化(联机快照校正 / 本地 AI 无关)时重建,否则只刷新可用状态
  if ($('#hand').dataset.sig !== handSig()) renderHand();
  document.querySelectorAll('#hand .card').forEach(div => {
    const card = g.p.hand[+div.dataset.idx];
    if (card) markPlayable(div, g, +div.dataset.idx, card);
  });
}

// ── 强化 ──
function showUpgrades() {
  endDrag();
  selectCard(null);
  const g = game();
  if (!g.upgradeOptions) return;
  const wrap = $('#upgrade-list');
  wrap.innerHTML = '';
  g.upgradeOptions.forEach((up, i) => {
    const div = document.createElement('button');
    div.type = 'button';
    div.className = 'upgrade-card';
    const u = upgradeText(up);
    const art = uiArt(up.icon ?? up.id);
    div.innerHTML = `${art ? `<img class="up-icon" src="${art.url}" alt="" draggable="false">` : ''}<span class="upgrade-name">${u.name}</span><span class="upgrade-desc">${u.desc}</span>`;
    div.onclick = () => pickUpgrade(i);
    wrap.appendChild(div);
  });
  $('#upgrade-wait').textContent = '';
  const countdown = $('#upgrade-time');
  countdown.dataset.seconds = '';
  $('#upgrade-timer').max = Math.max(1, Math.ceil(g.upgrade?.timer ?? 1));
  $('#upgrade-timer').setAttribute('aria-label', t('upgradeTimeout'));
  $('#upgrade-screen').style.display = 'flex';
  $('#hud').inert = true;
  wrap.firstElementChild?.focus({ preventScroll: true });
}

function pickUpgrade(i) {
  const g = game();
  if (g.phase !== 'upgrade') return;
  if (!session.pickUpgrade(i)) return;
  sfx('click');
  if (game().phase === 'upgrade') {
    $('#upgrade-list').innerHTML = '';
    $('#upgrade-wait').textContent = t('upgradeWait');
    $('#upgrade-wait').focus();
  } else {
    $('#upgrade-screen').style.display = 'none';
    $('#hud').inert = false;
  }
}

// ── 结算 ──
function showEnd(winner) {
  endDrag();
  selectCard(null);
  const g = game();
  $('#end-title').textContent = t(winner === 'p' ? 'win' : winner === 'e' ? 'lose' : 'draw');
  const badge = uiArt(winner === 'p' ? 'end_victory' : winner === 'e' ? 'end_defeat' : 'end_draw');
  $('#end-badge').hidden = !badge;
  if (badge) $('#end-badge').src = badge.url;
  const reason = g.endReason === 'base' && winner ? (winner === 'p' ? 'coreWon' : 'coreLost') : g.endReason;
  $('#end-reason').textContent = reason ? t('reason_' + reason) : '';
  $('#end-score').textContent = `${g.crowns('p')} : ${g.crowns('e')}`;
  $('#end-cores').textContent = [g.p, g.e].map(side => Math.max(0, Math.round(side.baseHP))).join(' / ');
  $('#end-duration').textContent = fmtTime(g.time);
  const s = recordGame(g.p.faction, winner, session.online);
  $('#end-stats').textContent = t('endStats', { w: s.total.w, l: s.total.l, r: winRate(s.total) }) + (s.streak > 1 ? t('streak', { s: s.streak }) : '');
  $('#btn-again').textContent = t(session.online ? 'backLobby' : 'again');
  $('#upgrade-screen').style.display = 'none';
  $('#end-screen').style.display = 'flex';
  $('#hud').inert = true;
  $('#btn-again').focus({ preventScroll: true });
}

addEventListener('keydown', event => {
  if (event.key === 'Escape' && (drag || selectedCard)) { endDrag(); selectCard(null); return; }
  if (event.key !== 'Tab') return;
  const dialog = ['#end-screen', '#upgrade-screen'].map($).find(el => el.style.display === 'flex');
  if (!dialog) return;
  const buttons = [...dialog.querySelectorAll('button:not(:disabled)')];
  if (!buttons.length) { event.preventDefault(); return; }
  const first = buttons[0], last = buttons.at(-1);
  if (!dialog.contains(document.activeElement) || event.shiftKey && document.activeElement === first
      || !event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  }
});

// ── 主循环 ──
// three 的动画循环是"先调回调、再请求下一帧":回调里任何一帧抛错,循环就永久停住(XR 里画面冻结)。
// 所以每帧包一层 try/catch:出错只记一次日志(同一个错误不重复刷),在 XR 里 / 桌面上提示出来,照常渲染
const loggedLoopErrors = new Set();
function loop(now) {
  try {
    frame(now);
  } catch (error) {
    const key = String(error?.stack ?? error).split('\n').slice(0, 2).join(' ');
    if (!loggedLoopErrors.has(key)) {
      loggedLoopErrors.add(key);
      console.error('[主循环] 这一帧出错,已跳过:', error);
      const text = `${error?.name ?? 'Error'}: ${error?.message ?? error}`;
      xr?.showError?.(text, String(error?.stack ?? '').split('\n')[1]?.trim() ?? '');
      toast(t('loopError', { e: text }));
    }
    try { scene.render(); } catch { /* 渲染本身坏了就只能等下一帧 */ }
  }
}

function frame(now) {   // 参数不能叫 t:会遮住翻译函数 t()
  const dt = lastT ? Math.max(0, Math.min((now - lastT) / 1000, 0.05)) : 0;
  lastT = now;
  if (!session) {
    if (scene.renderer.xr.isPresenting) xr.update(dt);
    scene.render();
    return;
  }
  const g = game();

  if (!firstMatch) { if (!paused) session.tick(dt); }
  else if (firstMatch.step === 'watch') {
    g.tick(dt);
    firstMatch.elapsed += dt;
    if (firstMatch.elapsed >= 2.5) {
      firstMatch.step = 'core';
      renderFirstMatch();
    }
  }
  const events = g.drainEvents();
  scene.handleEvents(events);
  for (const ev of events) {
    sfxForEvent(ev);
    if (ev.type === 'surge') toast(t('tSurge'));
    if (ev.type === 'overtime') toast(t('tOvertime'));
    if (ev.type === 'blood_price' && ev.who === 'p') toast(t('tBlood', { n: ev.amount }));
    if (ev.type === 'node') {
      if (ev.owner === 'p') toast(t('tNodeMine'));
      else if (ev.owner === 'e') toast(t('tNodeEnemy'));
      else if (ev.prev === 'p') toast(t('tNodeLost'));
    }
    if (ev.type === 'struct_destroyed') toast(t(ev.struct.side === 'e' ? 'tTowerEnemy' : 'tTowerMine'));
    if (ev.type === 'upgrade_pause') showUpgrades();
    if (ev.type === 'upgrade_done') {
      $('#upgrade-screen').style.display = 'none';
      $('#hud').inert = g.phase === 'end';
      if (ev.picks?.p && ev.picks?.e) toast(t('tPicks', { a: upgradeText(ev.picks.p).name, b: upgradeText(ev.picks.e).name }));
    }
    if (ev.type === 'end') showEnd(ev.winner);
  }

  refreshCountdown(g);
  const presenting = scene.renderer.xr.isPresenting;
  if (presenting) xr.update(dt);
  xr.updateRemoteAvatar(dt, g);
  const cam = presenting ? scene.renderer.xr.getCamera() : scene.camera;
  scene.syncUnits(g.units, cam);
  scene.syncStructures(g.structures, cam);
  scene.syncNode(g.node);
  scene.syncMeteor(g);   // 星核荒原 · 陨星(其它图没有 meteor,只清空)
  scene.update(dt);
  refreshHUD();
  scene.render();
}

// ── 开局倒计时(桌面):5、4、3、2、1(每秒一声),开战时显示「开战！」1 秒。XR 里由 xr.js 画在战场上方 ──
let countdownShown = '', countdownTimer = null;
function showCountdown(text) {
  const el = $('#prep-countdown');
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('go', text === t('prepGo'));
  clearTimeout(countdownTimer);
  if (text === t('prepGo')) countdownTimer = setTimeout(() => { el.hidden = true; countdownShown = ''; }, 1000);
}
function refreshCountdown(g) {
  if (g.phase !== 'prep') {   // 准备 → 开战:显示「开战！」1 秒(联机时客户端只看快照里的阶段变化,这里统一处理)
    if (countdownShown && countdownShown !== 'go') { countdownShown = 'go'; sfx('upgrade'); showCountdown(t('prepGo')); }
    return;
  }
  const n = String(Math.max(1, Math.ceil(g.prepLeft)));
  if (n === countdownShown) return;
  countdownShown = n;
  sfx('click');
  showCountdown(n);
}

let toastTimer = null;
function toast(msg) {
  if (!msg) return;
  if (scene?.renderer.xr.isPresenting) xr.notify(msg);
  const el = $('#toast');
  el.textContent = msg;
  el.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = 0; }, 3000);
}

// ── WebXR ──
// 一律优先 immersive-vr(全景背景 + 立牌,第五轮),只有不支持 VR 时才退回 immersive-ar;设置里手动选了模式时按设置
function handleXRHomeAction(action) {
  if (action === 'quick') {
    if (!pendingBattle) startLocal({ guided: shouldGuideFirstMatch() });
  } else if (action === 'faction') {
    const ids = Object.keys(FACTIONS);
    prefs.faction = selFaction = ids[(ids.indexOf(selFaction) + 1) % ids.length];
  } else if (action === 'arena') {
    const ids = ['random', ...SCENE_IDS];
    prefs.scene = ids[(ids.indexOf(prefs.scene) + 1) % ids.length];
  } else if (action === 'sound') {
    setMuted(!isMuted());
    refreshMuteButton();
  } else if (action === 'exit') {
    scene.renderer.xr.getSession()?.end().catch(error => toast(t('tXRFail', { e: error.message })));
  } else if (action === 'home') {
    backToMenu();
  }
}

function handleXRBattleAction(action) {
  if (action === 'sound') handleXRHomeAction('sound');
  else if (action === 'size') {
    const sizes = ['small', 'standard', 'large'];
    prefs.boardSize = sizes[(sizes.indexOf(prefs.boardSize) + 1) % sizes.length];
    xr.applyBoardSize();
    toast(t('xrBoardChanged', { size: t('xrBoard_' + prefs.boardSize) }));
  } else if (action === 'hand') {
    const levels = ['low', 'mid', 'high'];
    prefs.xrHandOpacity = levels[(levels.indexOf(prefs.xrHandOpacity) + 1) % levels.length];
    xr.applyHandOpacity();
  } else if (action === 'leave' && leaveBattle(true)) {
    toast(t('xrLeftField'));
  }
  else if (action === 'exitxr') {   // 对局中退出 XR:对局继续,结束会话后 xs 的 end 事件负责还原电脑画面
    scene.renderer.xr.getSession()?.end().then(() => { if (session) toast(t('tXRBackToPC')); })
      .catch(error => toast(t('tXRFail', { e: error.message })));
  }
}

let openingXR = false;
let xrMode = null;
const xrEntryButtons = ['#btn-xr', '#btn-home-xr'].map($);
let checkingXR = false, xrCheckId = 0, supportedXRModes = [];
function updateXREntry() {
  xrMode = supportedXRModes.includes(prefs.xrMode) ? prefs.xrMode : supportedXRModes[0] ?? null;
  xrEntryButtons.forEach(button => { button.disabled = !xrMode; });
  $('#btn-xr').hidden = !xrMode;
  const availability = t(checkingXR ? 'xrChecking' : xrMode ? 'xrCompatible' : 'xrUnavailable');
  $('#xr-availability').textContent = availability;
  $('#btn-home-xr').title = availability;
  $('#btn-home-xr').setAttribute('aria-label', t('xrHome'));
  const modes = $('#settings-xr-mode');
  for (const b of modes.querySelectorAll('[data-v]')) b.disabled = !supportedXRModes.length || (b.dataset.v !== 'auto' && !supportedXRModes.includes(b.dataset.v));
  markGroup(modes, supportedXRModes.includes(prefs.xrMode) ? prefs.xrMode : 'auto');
}
async function checkXRAvailability() {
  const checkId = ++xrCheckId;
  checkingXR = Boolean(navigator.xr);
  updateXREntry();
  const modes = ['immersive-vr', 'immersive-ar'];   // 顺序 = 「自动」时的优先级
  const results = await Promise.all(modes.map(mode => navigator.xr?.isSessionSupported(mode).catch(() => false)));
  if (checkId !== xrCheckId) return;
  supportedXRModes = modes.filter((_, index) => results[index]);
  checkingXR = false;
  updateXREntry();
}
navigator.xr?.addEventListener('devicechange', checkXRAvailability);
checkXRAvailability();

async function openXR() {
  if (!xrMode) { toast(t('tNoXR')); return; }
  if (openingXR || scene?.renderer.xr.isPresenting) return;
  openingXR = true;
  let xs;
  try {
    const mode = xrMode;
    xs = await navigator.xr.requestSession(mode, {
      optionalFeatures: ['hand-tracking', 'local-floor'],
    });
    ensureScene();
    scene.renderer.xr.setReferenceSpaceType('local-floor');
    await scene.renderer.xr.setSession(xs);
    lastT = 0;
    endDrag();
    selectCard(null);
    xr.enter(mode === 'immersive-ar');
    xs.addEventListener('end', () => {
      xr.exit();
      lastT = 0;
      if (!session && activeScreen === '#home-screen') openHome();
    }, { once: true });
    if (session) toast(t('tXRHelp'));
  } catch (err) {
    if (xs) await xs.end().catch(() => {});
    toast(t('tXRFail', { e: err.message }));
  } finally {
    openingXR = false;
  }
}
$('#btn-xr').onclick = openXR;
$('#btn-home-xr').onclick = openXR;

addEventListener('bg-assets-progress', e => {
  const { done, total } = e.detail;
  if (!total) return;
  loadingText = `${t('loading')} ${Math.round(done / total * 100)}%`;
  if (activeScreen === '#front-loading') $('#front-loading .front-loading-text').textContent = loadingText;
  else if (!artLoaded) refreshFightButton();   // 菜单已进、立绘还在后台下载:主按钮上显示进度
});
// 立绘全部到位(或超时放弃)后才开放要用卡面的入口(开战、建房、图鉴、编辑卡组)
assetsReady.then(() => {
  artLoaded = true;
  $('#btn-codex').disabled = false;
  refreshFightButton();
});
// 界面图 + 徽章到位就直接进主页(不再有标题页;主页上任何一次点击都算解锁音频的用户手势)
menuReady.then(() => {
  const mana = uiArt('ui_mana');
  if (mana) $('#mana-icon').innerHTML = ico('ui_mana', '');
  if (location.hash === '#compare') { assetsReady.then(runCompare); return; }
  openHome();
});

// ── 场景对比页(#compare):左边是图像 AI 画的概念图,右边是引擎按同一视角实时渲染的 Blender 场景 ──
async function runCompare() {
  showScreen(null);
  ensureScene();
  scene.setInsets({ top: 0, bottom: 0, left: 0, right: 0 });
  const g = new Game('steel', 'mecha', {}, { autoPick: [] });   // 只用来摆出双方的塔和核心
  const page = document.createElement('div');
  page.id = 'compare-page';
  page.innerHTML = `<h2>${t('battlefield')} · 概念图 vs Blender</h2><p class="muted-text">左:scene_&lt;id&gt;_concept(图像 AI)· 右:引擎实时渲染(贴图到位后显示贴图版)</p>`;
  document.body.appendChild(page);
  for (const s of SCENES) {
    const field = await loadScene(s.id);
    scene.setBattlefield(field);
    scene.setFactions(g.p.faction, g.e.faction);
    scene.syncStructures(g.structures, scene.camera);
    scene.syncNode(g.node);
    scene.renderer.setSize(1600, 900, false);   // 按概念图的 16:9 渲染
    scene.fitCamera(1600, 900);
    scene.renderer.render(scene.scene, scene.camera);
    const shot = scene.renderer.domElement.toDataURL('image/jpeg', 0.85);   // 同一个任务里读回,绘制缓冲还在
    scene.renderer.setSize(innerWidth, innerHeight);
    scene.fitCamera();
    const art = sceneArt(s.id);
    const row = document.createElement('div');
    row.className = 'compare-row';
    row.innerHTML = `<h3>${s.name} <span class="muted-text">${s.id} · ${s.desc} · ${field?.textured ? '贴图版' : '顶点色版(贴图未到)'}</span></h3>
      <div class="pair">${art.concept ? `<img src="${art.concept}">` : `<div class="ph">还没有概念图<br>scene_${s.id}_concept.png</div>`}<img src="${shot}"></div>`;
    page.appendChild(row);
  }
}

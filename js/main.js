// 入口 — UI 粘合层:主菜单 / 卡组构筑 / 联机大厅 / 战斗 HUD / 手牌拖拽 / 强化 / 结算 / 游戏循环
// 对局逻辑都在 session(本地人机或联机)里;这里只读 session.game、调用 session 的操作方法
import { FACTIONS, CARDS, cardTags, previewRadius, factionPool, PRESET_DECKS, deckProblem, DECK_SIZE, MIN_DEPLOYABLES } from './cards.js';
import { DISCARD_COST, Game, isPlaced } from './game.js';
import { BattleScene } from './scene.js';
import { XRControls } from './xr.js';
import { ready as assetsReady, cardArt, emblem, uiArt, loadScene, sceneArt, XR_GUIDE } from './assets.js';
import { SCENES as ALL_SCENES, PLAYABLE_IDS as SCENE_IDS, sceneById, randomScene } from './scenes.js';
const SCENES = ALL_SCENES.filter(s => SCENE_IDS.includes(s.id));   // 大厅显示已开放的场景

// 界面小图标:有美术图用图(黑底发光图,滤色混合去黑),没有就用文字符号
function ico(name, fallback) {
  const a = uiArt(name);
  return a ? `<img class="ico" src="${a.url}" alt="${fallback}" draggable="false">` : fallback;
}
import { LocalSession, NetSession, connectOnline } from './session.js';
import { sfx, sfxForEvent, setMuted, isMuted } from './sfx.js';
import { loadDeck, saveDeck, isPresetDeck, prefs, loadStats, recordGame, winRate } from './storage.js';
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

const game = () => session?.game;
// 调试:地址带 ?debug 时把场景 / 对局挂到 window 上,方便在控制台里看特效、模型
if (new URLSearchParams(location.search).has('debug')) window.__bg = { get scene() { return scene; }, get game() { return game(); }, get session() { return session; } };
const SCREENS = ['#title-screen', '#home-screen', '#select-screen', '#deck-screen', '#online-screen', '#codex-screen', '#settings-screen'];
let activeScreen = '#front-loading';
function showScreen(sel) {
  activeScreen = sel;
  $('#front-loading').style.display = 'none';
  for (const s of SCREENS) $(s).style.display = s === sel ? 'flex' : 'none';
  $('#hud').style.display = sel ? 'none' : '';
  document.body.classList.toggle('in-battle', !sel);
  $('#hud').inert = false;
}

// ── 卡牌 DOM(手牌与卡组构筑共用)──
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

// ── 主菜单 ──
const factionPortraits = {
  steel: 'steel_infantry',
  mecha: 'mecha_walker',
  swarm: 'swarm_warrior',
  chaos: 'chaos_construct',
};

function buildMenu() {
  const stats = loadStats();
  const tot = stats.total;
  applyStaticText();
  refreshWordmarks();
  refreshMuteButton();
  $('#stats-line').textContent = tot.w + tot.l + tot.d
    ? t('stats', { w: tot.w, l: tot.l, d: tot.d ? t('draws', { d: tot.d }) : '', r: winRate(tot), b: stats.best })
    : t('pickFaction');
  const selected = FACTIONS[selFaction];
  const passive = passiveText(selFaction, selected.passive);
  const detail = $('#faction-detail');
  detail.hidden = false;
  detail.style.setProperty('--fc', hex(selected.color));
  $('#faction-passive-name').textContent = `${t('passive')} · ${passive.name}`;
  $('#faction-passive-desc').textContent = passive.desc;
  const wrap = $('#faction-list');
  wrap.innerHTML = '';
  for (const fac of Object.values(FACTIONS)) {
    const div = document.createElement('button');
    div.type = 'button';
    div.dataset.faction = fac.id;
    div.setAttribute('aria-pressed', String(fac.id === selFaction));
    div.className = 'faction-card' + (fac.id === selFaction ? ' selected' : '');
    div.style.setProperty('--fc', hex(fac.color));
    const em = emblem(fac.id);
    const fs = stats.byFaction[fac.id];
    const portrait = cardArt(CARDS[factionPortraits[fac.id]]);
    div.innerHTML = `<span class="faction-portrait">
      ${portrait ? `<img class="faction-unit" src="${portrait.url}" alt="">` : ''}
      ${em ? `<img class="emblem" src="${em.url}" alt="">` : ''}
    </span>
    <span class="faction-name">${factionName(fac.id, fac.name)}</span>
    <span class="faction-desc">${factionDesc(fac.id, fac.desc)}</span>
    ${fs.w + fs.l + fs.d ? `<span class="fstat">${t('fstat', { w: fs.w, l: fs.l, r: winRate(fs) })}</span>` : ''}`;
    div.onclick = () => {
      sfx('click');
      selFaction = fac.id;
      prefs.faction = fac.id;
      buildMenu();
      $(`[data-faction=${fac.id}]`).focus({ preventScroll: true });
    };
    wrap.appendChild(div);
  }
  const deck = loadDeck(selFaction);
  $('#deck-summary').textContent = t('deckSummary', { f: fname(selFaction), kind: t(isPresetDeck(selFaction, deck) ? 'presetDeck' : 'customDeck'), n: deck.length });
  for (const [group, value] of [['#difficulty', prefs.difficulty], ['#lang', getLang()]]) {
    for (const button of $(group).querySelectorAll('button')) {
      const active = button.dataset.v === value;
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
  buildSceneList();
  const field = SCENE_IDS.includes(prefs.scene) ? sceneById(prefs.scene) : null;
  const difficulty = { basic: 'easy', normal: 'normal', smart: 'hard' }[prefs.difficulty];
  $('#home-faction').textContent = fname(selFaction);
  $('#home-config').textContent = t('quickConfig', {
    scene: field ? (getLang() === 'en' ? field.en : field.name) : t('randomScene'),
    difficulty: t(difficulty),
    n: deck.length,
  });
  const portrait = cardArt(CARDS[factionPortraits[selFaction]]);
  $('#home-portrait').hidden = !portrait;
  if (portrait) $('#home-portrait').src = portrait.url;
  $('.home-quick').style.setProperty('--fc', hex(selected.color));
}

for (const b of document.querySelectorAll('#difficulty button')) {
  b.onclick = () => { sfx('click'); prefs.difficulty = b.dataset.v; buildMenu(); };
}
for (const b of document.querySelectorAll('#lang button')) {
  b.onclick = () => { sfx('click'); setLang(b.dataset.v); buildMenu(); updateXREntry(); };
}
const fname = id => factionName(id, FACTIONS[id].name);
function refreshWordmarks() {
  const src = `assets/ui/brand/logo-${getLang() === 'en' ? 'en' : 'zh'}.webp`;
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

function openHome() {
  buildMenu();
  $('#first-match-home').hidden = !shouldGuideFirstMatch();
  updateXREntry();
  showScreen('#home-screen');
  $('#home-title').focus({ preventScroll: true });
}
$('#btn-enter-game').onclick = () => {
  prefs.entered = true;
  sfx('click');
  openHome();
};
$('#btn-prepare').onclick = () => {
  sfx('click');
  buildMenu();
  showScreen('#select-screen');
  $('#prepare-title').focus({ preventScroll: true });
};
$('#btn-prepare-back').onclick = () => { openHome(); $('#btn-prepare').focus(); };
$('#btn-quick').onclick = () => { sfx('click'); startLocal({ guided: shouldGuideFirstMatch() }); };
$('#btn-home-deck').onclick = () => { sfx('click'); openDeckBuilder(); };
$('#btn-solo').onclick = () => { sfx('click'); startLocal(); };
$('#btn-online').onclick = () => { sfx('click'); openOnline(); };
$('#btn-deck').onclick = () => { sfx('click'); openDeckBuilder(); };

let codexFaction = null, codexType = '', codexCard = null;
function openCodex() {
  codexFaction ??= selFaction;
  $('#codex-faction').replaceChildren(...Object.values(FACTIONS).map(faction => new Option(fname(faction.id), faction.id)));
  $('#codex-type').replaceChildren(...['', 'unit', 'building', 'spell'].map(type => new Option(t(type || 'allTypes'), type)));
  $('#codex-faction').value = codexFaction;
  $('#codex-type').value = codexType;
  renderCodex();
  showScreen('#codex-screen');
  $('#codex-title').focus();
}

function renderCodex() {
  const cards = factionPool(codexFaction).filter(card => !codexType || card.type === codexType);
  if (!cards.some(card => card.id === codexCard)) codexCard = cards[0]?.id ?? null;
  const grid = $('#codex-grid');
  grid.replaceChildren();
  for (const card of cards) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'codex-pick';
    button.dataset.card = card.id;
    button.setAttribute('aria-pressed', String(card.id === codexCard));
    button.append(cardElement(card, { compact: true }));
    button.onclick = () => {
      codexCard = card.id;
      for (const item of grid.children) item.setAttribute('aria-pressed', String(item === button));
      renderCodexDetail(card);
      if (matchMedia('(max-width: 740px)').matches) {
        $('#codex-card-title').focus({ preventScroll: true });
        $('#codex-detail').scrollIntoView({ block: 'nearest' });
      }
    };
    grid.append(button);
  }
  renderCodexDetail(CARDS[codexCard]);
}

function renderCodexDetail(card) {
  const panel = $('#codex-detail');
  if (!card) { panel.replaceChildren(); return; }
  const art = cardArt(card), mark = emblem(card.faction), faction = fname(card.faction);
  const stats = [];
  if (card.hp != null) stats.push([t('cardHealth'), card.hp]);
  if (card.atk > 0) stats.push([t('cardAttack'), card.atk]);
  if (card.range > 0) stats.push([t('cardRange'), t('gridUnits', { n: card.range })]);
  if (card.radius > 0) stats.push([t('cardRadius'), t('gridUnits', { n: card.radius })]);
  if (card.lifetime > 0) stats.push([t('cardLifetime'), t('seconds', { n: card.lifetime })]);
  const tags = cardTags(card).map(tagName);
  panel.style.setProperty('--fc', hex(FACTIONS[card.faction].color));
  panel.innerHTML = `<div class="codex-hero">
    <span class="codex-identity">${mark ? `<img src="${mark.url}" alt="">` : ''}${faction} · ${t(card.type)}</span>
    ${art ? `<img class="codex-art${art.glow ? ' glow' : ''}" src="${art.url}" alt="">` : ''}
  </div>
  <div class="codex-body">
    <div class="codex-card-heading"><b class="codex-cost">${card.cost}</b><h2 id="codex-card-title" tabindex="-1">${cardName(card)}</h2></div>
    ${tags.length ? `<p class="codex-tags">${tags.join(' · ')}</p>` : ''}
    ${stats.length ? `<div class="codex-stats">${stats.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>` : ''}
    <p class="codex-description">${cardDesc(card)}</p>
    <div class="codex-actions">
      ${card.type !== 'spell' ? `<a class="btn" href="viewer.html?id=${encodeURIComponent(card.id)}" target="_blank" rel="noopener">${t('viewModel')}</a>` : ''}
      <button class="btn primary" type="button" id="btn-codex-deck">${t('codexEdit', { f: faction })}</button>
    </div>
  </div>`;
  $('#btn-codex-deck').onclick = () => openDeckBuilder(card.faction);
}

$('#btn-codex').onclick = openCodex;
$('#btn-codex-back').onclick = () => { openHome(); $('#btn-codex').focus(); };
$('#codex-faction').onchange = event => { codexFaction = event.target.value; renderCodex(); };
$('#codex-type').onchange = event => { codexType = event.target.value; renderCodex(); };

function openSettings() {
  applyStaticText();
  $('#settings-language').value = getLang();
  $('#settings-sound').value = isMuted() ? 'off' : 'on';
  $('#settings-size').value = prefs.boardSize;
  updateXREntry();
  showScreen('#settings-screen');
  $('#settings-title').focus();
}
$('#btn-settings').onclick = openSettings;
$('#btn-settings-back').onclick = () => { openHome(); $('#btn-settings').focus(); };
$('#settings-language').onchange = event => { setLang(event.target.value); refreshMuteButton(); updateXREntry(); };
$('#settings-sound').onchange = event => { setMuted(event.target.value === 'off'); refreshMuteButton(); };
$('#settings-size').onchange = event => { prefs.boardSize = event.target.value; xr?.applyBoardSize(); };
$('#settings-xr-mode').onchange = event => { prefs.xrMode = event.target.value; updateXREntry(); };

// ── 卡组构筑 ──
let deckDraft = [];
let deckReturn = '#home-screen';
let deckFaction = selFaction;
function openDeckBuilder(faction = selFaction) {
  deckReturn = ['#select-screen', '#codex-screen'].includes(activeScreen) ? activeScreen : '#home-screen';
  deckFaction = faction;
  deckDraft = [...loadDeck(deckFaction)];
  $('#deck-title').textContent = t('deckTitle', { f: fname(deckFaction) });
  renderDeck();
  showScreen('#deck-screen');
  $('#deck-grid .card')?.focus({ preventScroll: true });
}
function renderDeck() {
  const grid = $('#deck-grid');
  grid.innerHTML = '';
  for (const card of factionPool(deckFaction)) {
    const el = cardElement(card);
    const picked = deckDraft.includes(card.id);
    el.classList.toggle('picked', picked);
    el.dataset.deckCard = card.id;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-pressed', String(picked));
    el.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      el.click();
    };
    el.onclick = () => {
      sfx('click');
      if (deckDraft.includes(card.id)) deckDraft = deckDraft.filter(id => id !== card.id);
      else if (deckDraft.length < DECK_SIZE) deckDraft.push(card.id);
      else {
        $('#deck-err').textContent = t('deckFull');
        return;
      }
      renderDeck();
      $(`[data-deck-card=${card.id}]`).focus({ preventScroll: true });
    };
    grid.appendChild(el);
  }
  $('#deck-slots').replaceChildren(...Array.from({ length: DECK_SIZE }, (_, i) => {
    const slot = document.createElement('span');
    slot.className = 'deck-slot';
    const card = CARDS[deckDraft[i]];
    if (!card) return slot;
    slot.classList.add('filled');
    const art = cardArt(card);
    if (art) {
      const img = document.createElement('img');
      img.src = art.url;
      img.alt = '';
      if (art.glow) img.className = 'glow';
      slot.append(img);
    }
    const cost = document.createElement('b');
    cost.textContent = card.cost;
    slot.append(cost);
    return slot;
  }));
  const prob = deckProblem(deckFaction, deckDraft);
  const err = prob && t('deckErr_' + prob.code, { n: prob.code === 'deploy' ? MIN_DEPLOYABLES : DECK_SIZE, c: prob.card ? cardName(CARDS[prob.card] ?? { id: prob.card, name: prob.card }) : '' });
  const avg = deckDraft.length ? (deckDraft.reduce((a, id) => a + CARDS[id].cost, 0) / deckDraft.length).toFixed(1) : '0';
  $('#deck-count').textContent = t('deckCount', { n: deckDraft.length, max: DECK_SIZE, avg });
  $('#deck-err').textContent = err || '';
  $('#btn-deck-save').disabled = !!err;
}
$('#btn-deck-preset').onclick = () => { deckDraft = [...PRESET_DECKS[deckFaction]]; renderDeck(); };
function closeDeckBuilder() {
  if (deckReturn === '#codex-screen') { openCodex(); $('#btn-codex-deck')?.focus(); return; }
  buildMenu();
  showScreen(deckReturn);
  $(deckReturn === '#select-screen' ? '#btn-deck' : '#btn-home-deck').focus();
}
$('#btn-deck-save').onclick = () => { if (saveDeck(deckFaction, deckDraft)) { sfx('click'); closeDeckBuilder(); } };
$('#btn-deck-cancel').onclick = closeDeckBuilder;

// ── 联机大厅 ──
const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
let pendingConnection = null;
function openOnline() {
  $('#player-name').value = prefs.name;
  $('#online-err').textContent = '';
  $('#room-wait').style.display = 'none';
  showScreen('#online-screen');
  $('#player-name').focus({ preventScroll: true });
  // 静态网页版(GitHub Pages,由 tools/build-pages.mjs 打包)没有联机服务器:只说明原因,不去连
  if (window.BG_STATIC) {
    $('#online-err').textContent = t('staticNoOnline');
    $('#btn-create').disabled = $('#btn-join').disabled = true;
    const online = window.BG_ONLINE_URL;   // 打包时可写入联机版地址(同一份代码跑在 Node 服务器上)
    $('#leaderboard').innerHTML = online && /^https:\/\//.test(online)
      ? `<a class="btn primary" href="${escapeHtml(online)}">${t('goOnline')}</a>`
      : `<span class="muted-text">${t('staticNoOnline')}</span>`;
    return;
  }
  $('#leaderboard').textContent = t('loading');
  fetch('api/leaderboard').then(r => (r.ok ? r.json() : Promise.reject())).then(rows => {
    $('#leaderboard').innerHTML = rows.length
      ? rows.map((r, i) => `<div><span>${i + 1}. ${escapeHtml(r.name)}</span><span>${r.rating} · ${t('fstat', { w: r.wins, l: r.losses, r: winRate({ w: r.wins, l: r.losses, d: r.draws || 0 }) })}</span></div>`).join('')
      : `<span class="muted-text">${t('noRecords')}</span>`;
  }).catch(() => {
    $('#leaderboard').innerHTML = `<span class="err">${t('noServer')}</span>`;
  });
}
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function onlineHello(t, extra = {}) {
  prefs.name = $('#player-name').value.trim();
  return { t, faction: selFaction, deck: loadDeck(selFaction), name: prefs.name, scene: prefs.scene, ...extra };
}
function showConnectionProgress(key) {
  const busy = Boolean(key);
  for (const id of ['#btn-create', '#btn-join', '#player-name', '#join-code']) $(id).disabled = busy;
  $('#online-state').hidden = !busy;
  $('#online-screen').classList.toggle('room-active', key === 'waiting');
  $('#room-wait').hidden = key !== 'waiting';
  $('#online-progress').textContent = key ? t(key) : '';
  $('#btn-cancel-connection').hidden = !busy;
}

async function goOnline(msg) {
  if (pendingConnection) return;
  const request = { socket: null };
  pendingConnection = request;
  $('#online-err').textContent = '';
  showConnectionProgress('connecting');
  $('#btn-cancel-connection').focus();
  try {
    const { ws, start } = await connectOnline(wsUrl(), msg, {
      onSocket: socket => { request.socket = socket; },
      onRoom: (code, name) => {
        if (pendingConnection !== request) return;
        $('#room-code').textContent = code;
        const identity = $('#room-identity');
        identity.hidden = !(name || msg.name);
        identity.textContent = name || msg.name ? t('roomIdentity', { name: name || msg.name }) : '';
        showConnectionProgress('waiting');
        $('#btn-copy-room').focus();
      },
    });
    if (pendingConnection !== request) { ws.close(); return; }
    showConnectionProgress('');
    startOnline(ws, start);
  } catch (e) {
    if (pendingConnection === request && e.code !== 'cancel') {
      $('#online-err').textContent = e.message + (e.code === 'noconn' ? t('needServer') : '');
    }
  } finally {
    if (pendingConnection === request) {
      pendingConnection = null;
      showConnectionProgress('');
      if ($('#online-screen').style.display === 'flex' && !pendingBattle) $('#btn-create').focus();
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
  $('#btn-create').focus();
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
$('#btn-create').onclick = () => { sfx('click'); goOnline(onlineHello('create')); };
$('#btn-join').onclick = () => {
  sfx('click');
  const code = $('#join-code').value.trim().toUpperCase();
  if (code.length !== 4) { $('#online-err').textContent = t('codeLen'); return; }
  goOnline(onlineHello('join', { code }));
};
$('#join-code').onkeydown = event => {
  if (event.key === 'Enter') $('#btn-join').click();
};
$('#btn-online-back').onclick = () => { backToMenu('#select-screen'); $('#btn-online').focus(); };

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
    getBattleControls: () => ({ muted: isMuted(), boardSize: prefs.boardSize, online: Boolean(session?.online) }),
    onBattleAction: handleXRBattleAction,
    getNetworkStatus: () => networkStatus({ problemsOnly: true }),
    getBoardSize: () => prefs.boardSize,
    onPlay: (idx, x, z) => {
      if (!canPlayDuringGuide(game().p.hand[idx])) return false;
      const played = session.play(idx, x, z);
      if (played) { firstDeploymentPlayed(); renderHand(); }
      else if (session.online && !session.connected) toast(networkStatus());
      return played;
    },
    onDiscard: idx => {
      if (firstMatch) return;
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
  const controls = ['#btn-quick', '#btn-solo', '#btn-online', '#btn-again'].map($);
  controls.forEach(button => { button.disabled = true; });
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
      controls.forEach(button => { button.disabled = false; });
      toast(t('battleUnavailable'));
    }
    return;
  } finally {
    clearTimeout(loading);
    if (pendingBattle === s) controls.forEach(button => { button.disabled = false; });
  }
  if (pendingBattle !== s) return;
  pendingBattle = null;
  session?.leave();
  session = s;
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

// 主菜单的战场选择：随机或已开放场景。
function buildSceneList() {
  const wrap = $('#scene-list');
  wrap.innerHTML = '';
  const cur = prefs.scene;
  const field = SCENE_IDS.includes(cur) ? sceneById(cur) : null;
  const art = field && sceneArt(field.id);
  const image = field?.menuPreview || art?.concept || art?.sky;
  $('#arena-preview').style.setProperty('--arena-art', image ? `url("${image}")` : 'none');
  $('#arena-name').textContent = field ? (getLang() === 'en' ? field.en : field.name) : t('randomScene');
  $('#arena-description').textContent = field ? (getLang() === 'en' ? field.descEn : field.desc) : t('randomFieldHelp');
  const chip = (id, label, bg) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.scene = id;
    el.setAttribute('aria-pressed', String(cur === id));
    el.className = 'scene-chip' + (cur === id ? ' on' : '');
    el.innerHTML = `<span class="thumb" style="${bg}"></span>${escapeHtml(label)}`;
    el.title = id === 'random' ? '' : (getLang() === 'en' ? sceneById(id).descEn : sceneById(id).desc);
    el.onclick = () => { sfx('click'); prefs.scene = id; buildSceneList(); $(`[data-scene=${id}]`).focus({ preventScroll: true }); };
    wrap.appendChild(el);
  };
  chip('random', t('randomScene'), 'background: linear-gradient(135deg, #3a2a6a, #1a4a5a, #5a3a2a)');
  const rgb = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
  for (const s of SCENES) {
    const art = sceneArt(s.id);
    const img = s.menuPreview || art.concept || art.sky;
    const bg = img ? `background-image: url('${img}')` : `background: linear-gradient(160deg, ${rgb(s.palette.rim)}, ${rgb(s.palette.near)} 60%, ${rgb(s.palette.hazard)})`;
    chip(s.id, getLang() === 'en' ? s.en : s.name, bg);
  }
}
const pickScene = () => (SCENE_IDS.includes(prefs.scene) ? prefs.scene : randomScene());

function startLocal({ guided = false } = {}) {
  const others = Object.keys(FACTIONS).filter(f => f !== selFaction);
  const enemyFaction = others[Math.floor(Math.random() * others.length)];
  beginBattle(new LocalSession({
    faction: selFaction, deck: guided ? PRESET_DECKS[selFaction] : loadDeck(selFaction),
    enemyFaction, enemyDeck: PRESET_DECKS[enemyFaction], difficulty: prefs.difficulty, sceneId: pickScene(),
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
    backToMenu(); openOnline(); return;
  }
  const c = session.config;
  beginBattle(new LocalSession({ ...c, deck: loadDeck(c.faction), sceneId: SCENE_IDS.includes(prefs.scene) ? prefs.scene : randomScene() }));
}

function backToMenu(destination = '#home-screen') {
  closeFirstMatch(false);
  xr?.receiveRemotePose(null);
  xr?.updateRemoteAvatar(0, null);
  endDrag();
  selectCard(null);
  cancelPending();
  pendingBattle?.leave();
  pendingBattle = null;
  for (const selector of ['#btn-quick', '#btn-solo', '#btn-online', '#btn-again']) $(selector).disabled = false;
  session?.leave();
  session = null;
  $('#end-screen').style.display = 'none';
  $('#upgrade-screen').style.display = 'none';
  if (destination === '#home-screen') openHome();
  else { buildMenu(); showScreen(destination); }
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
const muteButton = $('#btn-mute');
function refreshMuteButton() {
  const muted = isMuted();
  muteButton.textContent = muted ? '🔇' : '🔊';
  muteButton.setAttribute('aria-pressed', String(muted));
  muteButton.setAttribute('aria-label', t('muteTip'));
}
muteButton.onclick = () => { setMuted(!isMuted()); refreshMuteButton(); };
refreshMuteButton();

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
  if (card && scene && game()?.phase === 'battle') showCardPlacement(selectedCard, null);
  else scene?.showPlacement(null);
}

function chooseCard(card) {
  if (selectedCard?.id === card.id) { selectCard(null); return; }
  const g = game();
  const idx = g?.p.hand.findIndex(c => c.id === card.id) ?? -1;
  if (g?.phase !== 'battle' || idx < 0) return;
  if (!g.canPlay('p', idx)) { toast(t('tNoMana')); return; }
  selectCard(card);
}
$('#btn-cancel-card').onclick = () => selectCard(null);

function beginDrag(e, card) {
  if (drag || e.button !== 0 || !canPlayDuringGuide(card)) return;
  const idx = game().p.hand.indexOf(card);
  if (idx < 0 || game().phase !== 'battle') return;
  if (!game().canPlay('p', idx)) { toast(t('tNoMana')); return; }
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

function showCardPlacement(placement, hit) {
  const { card } = placement;
  const g = game();
  const reason = hit ? g.deployBlockReason('p', card, hit.x, hit.z) : null;
  scene.showPlacement({ ...hit, game: g, card, showDeployZone: isPlaced(card), radius: previewRadius(card), valid: !reason, isUnit: card.type !== 'spell' });
  return reason;
}

function playAt(placement, hit, pointer) {
  const g = game();
  if (g?.phase !== 'battle' || (firstMatch && firstMatch.step !== 'deploy')) return false;
  if (!hit) { showPlacementError('deployOutside', pointer); return false; }
  const idx = g.p.hand.findIndex(card => card.id === placement.id);
  if (idx < 0) return false;
  const card = g.p.hand[idx];
  if (!g.canPlay('p', idx)) { toast(t('tNoMana')); return false; }
  if (firstMatch && card.type !== 'unit') { showPlacementError('firstDeployTitle', pointer); return false; }
  const reason = g.deployBlockReason('p', card, hit.x, hit.z);
  if (reason) { showCardPlacement(placement, hit); showPlacementError(reason, pointer); return false; }
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
  } else if (selectedCard && e.pointerType !== 'touch' && game()?.phase === 'battle') {
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
function loop(now) {   // 参数不能叫 t:会遮住翻译函数 t()
  const dt = lastT ? Math.max(0, Math.min((now - lastT) / 1000, 0.05)) : 0;
  lastT = now;
  if (!session) {
    if (scene.renderer.xr.isPresenting) xr.update(dt);
    scene.render();
    return;
  }
  const g = game();

  if (!firstMatch) session.tick(dt);
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

  const presenting = scene.renderer.xr.isPresenting;
  if (presenting) xr.update(dt);
  xr.updateRemoteAvatar(dt, g);
  const cam = presenting ? scene.renderer.xr.getCamera() : scene.camera;
  scene.syncUnits(g.units, cam);
  scene.syncStructures(g.structures, cam);
  scene.syncNode(g.node);
  scene.update(dt);
  refreshHUD();
  scene.render();
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
// 优先 immersive-ar(VITURE 等透视眼镜,真实桌面上看战场),不支持时退回 immersive-vr
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
  } else if (action === 'leave' && leaveBattle(true)) {
    toast(t('xrLeftField'));
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
  $('#xr-availability').textContent = t(checkingXR ? 'xrChecking' : xrMode ? 'xrCompatible' : 'xrUnavailable');
  const selector = $('#settings-xr-mode');
  for (const option of selector.options) option.disabled = option.value !== 'auto' && !supportedXRModes.includes(option.value);
  selector.value = supportedXRModes.includes(prefs.xrMode) ? prefs.xrMode : 'auto';
  selector.disabled = !supportedXRModes.length;
}
async function checkXRAvailability() {
  const checkId = ++xrCheckId;
  checkingXR = Boolean(navigator.xr);
  updateXREntry();
  const modes = ['immersive-ar', 'immersive-vr'];
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

assetsReady.then(() => {
  // 主菜单背景图(只用在浏览器菜单里,不进眼镜)
  const bg = uiArt('bg_menu');
  if (bg) document.documentElement.style.setProperty('--menu-bg', `url("${bg.url}")`);
  const mana = uiArt('ui_mana');
  if (mana) $('#mana-icon').innerHTML = ico('ui_mana', '');
  for (const selector of ['#btn-deck', '#btn-quick', '#btn-solo', '#btn-online']) $(selector).disabled = false;
  if (location.hash === '#compare') { runCompare(); return; }
  if (prefs.entered) openHome();
  else {
    applyStaticText();
    refreshWordmarks();
    refreshMuteButton();
    showScreen('#title-screen');
    $('#btn-enter-game').focus({ preventScroll: true });
  }
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

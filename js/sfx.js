// 音效 — 全部用 WebAudio 实时合成,不需要音频文件
// 同类音效 80ms 内只播一次(大混战时不至于吵成一片);浏览器要求首次交互后才能出声
let ctx = null, master = null, muted = false;
const lastAt = {};

try { muted = localStorage.getItem('sg.muted') === '1'; } catch { /* 隐私模式 */ }

function ensure() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// 首次点击/触摸时解锁音频
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => ensure(), { once: true });

function tone(freq, dur, { type = 'sine', vol = 0.5, slide = 0, delay = 0 } = {}) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.4, freq = 1200, q = 0.8, delay = 0 } = {}) {
  const t = ctx.currentTime + delay;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = buf;
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

const SOUNDS = {
  deploy:    () => { tone(320, 0.12, { type: 'triangle', vol: 0.35, slide: 1.8 }); },
  // 部署降临:0.12 秒着陆时低频「咚」+ 一道高频「嗡」
  descend:   () => { tone(320, 0.1, { type: 'triangle', vol: 0.2, slide: 1.8 }); tone(85, 0.32, { vol: 0.5, slide: 0.45, delay: 0.12 }); noise(0.18, { vol: 0.25, freq: 300, q: 0.6, delay: 0.12 }); tone(1320, 0.4, { vol: 0.08, slide: 0.85, delay: 0.12 }); },
  spell:     () => { tone(660, 0.25, { type: 'sine', vol: 0.3, slide: 1.5 }); tone(990, 0.3, { vol: 0.2, delay: 0.05 }); },
  hit:       () => { noise(0.05, { vol: 0.12, freq: 2400 }); },
  shot:      () => { tone(900, 0.06, { type: 'square', vol: 0.06, slide: 0.5 }); },
  death:     () => { tone(180, 0.18, { type: 'sawtooth', vol: 0.15, slide: 0.4 }); },
  mechaOff:  () => { tone(580, 0.13, { type: 'triangle', vol: 0.14, slide: 0.32 }); tone(270, 0.14, { vol: 0.09, slide: 0.65, delay: 0.07 }); },
  explode:   () => { noise(0.4, { vol: 0.5, freq: 400, q: 0.5 }); tone(90, 0.35, { vol: 0.4, slide: 0.5 }); },
  tower:     () => { noise(0.9, { vol: 0.6, freq: 250, q: 0.4 }); tone(70, 0.8, { vol: 0.5, slide: 0.4 }); },
  node:      () => { [523, 659, 784].forEach((f, i) => tone(f, 0.22, { vol: 0.25, delay: i * 0.08 })); },
  upgrade:   () => { [440, 554, 659, 880].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.25, delay: i * 0.07 })); },
  win:       () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.4, { type: 'triangle', vol: 0.35, delay: i * 0.13 })); },
  draw:      () => { [440, 587, 554].forEach((f, i) => tone(f, 0.28, { type: 'triangle', vol: 0.22, delay: i * 0.12 })); },
  lose:      () => { [392, 330, 262].forEach((f, i) => tone(f, 0.45, { type: 'sine', vol: 0.3, delay: i * 0.18 })); },
  warn:      () => { tone(880, 0.1, { type: 'square', vol: 0.12 }); tone(880, 0.1, { type: 'square', vol: 0.12, delay: 0.16 }); },
  click:     () => { tone(1200, 0.04, { type: 'sine', vol: 0.15 }); },
};

export function sfx(name) {
  if (muted || !SOUNDS[name] || !ensure()) return;
  const now = performance.now();
  if (now - (lastAt[name] || 0) < 80) return;
  lastAt[name] = now;
  try { SOUNDS[name](); } catch { /* 音频上下文异常时静默 */ }
}

export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('sg.muted', m ? '1' : '0'); } catch { /* */ }
}
export const isMuted = () => muted;

// 把游戏事件映射成音效(本地玩家视角:winner === 'p' 为胜)
export function sfxForEvent(ev) {
  switch (ev.type) {
    case 'spawn': case 'spawn_preview':   // ev.fx 由 scene.handleEvents 标记:echo = 联机确认,出牌时已经响过
      return ev.fx === 'echo' ? null : sfx(ev.fx === 'descend' ? 'descend' : 'deploy');
    case 'spell': return sfx('spell');
    case 'attack': return sfx(ev.ranged ? 'shot' : 'hit');
    case 'death': return sfx(ev.unit?.card?.faction === 'mecha' ? 'mechaOff' : 'death');
    case 'rank_up': return sfx('upgrade');
    case 'assimilate': case 'hatch': return sfx('deploy');
    case 'blood_price': return sfx('explode');
    case 'explode': return sfx('explode');
    case 'strike_warn': return sfx('warn');
    case 'struct_destroyed': return sfx('tower');
    case 'node': return ev.owner ? sfx('node') : null;
    case 'upgrade_pause': return sfx('upgrade');
    case 'end': return sfx(ev.winner === 'p' ? 'win' : ev.winner === 'e' ? 'lose' : 'draw');
  }
}

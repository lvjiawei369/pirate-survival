// 极简 WebAudio 合成音效：不依赖音频文件。首次用户交互后才创建 AudioContext。
let ctx = null, master = null, waves = null, rainGain = null, fallGain = null;

export function initAudio() {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  // 海浪底噪：粉噪 → 低通，LFO 调制音量
  const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), d = buf.getChannelData(0);
  let b = 0; for (let i = 0; i < d.length; i++) { b = 0.98 * b + 0.02 * (Math.random() * 2 - 1); d[i] = b * 3; }
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
  waves = ctx.createGain(); waves.gain.value = 0.25;
  const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
  lfo.frequency.value = 0.12; lfoGain.gain.value = 0.12; lfo.connect(lfoGain).connect(waves.gain);
  src.connect(lp).connect(waves).connect(master); src.start(); lfo.start();
  // 雨声：白噪声 → 高通，音量随雨量
  const rb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), rd = rb.getChannelData(0);
  for (let i = 0; i < rd.length; i++) rd[i] = Math.random() * 2 - 1;
  const rs = ctx.createBufferSource(); rs.buffer = rb; rs.loop = true;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
  rainGain = ctx.createGain(); rainGain.gain.value = 0;
  rs.connect(hp).connect(rainGain).connect(master); rs.start();
  // 瀑布声：低沉的噪声，音量随距离
  const fs = ctx.createBufferSource(); fs.buffer = buf; fs.loop = true;
  const flp = ctx.createBiquadFilter(); flp.type = 'lowpass'; flp.frequency.value = 900;
  fallGain = ctx.createGain(); fallGain.gain.value = 0;
  fs.connect(flp).connect(fallGain).connect(master); fs.start();
}

function tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, { freq = 1200, vol = 0.3, q = 1, delay = 0, type = 'bandpass' } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + delay, len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(master); s.start(t);
}

export const sfx = {
  pickup: () => { tone(660, 0.12, { type: 'triangle', vol: 0.25 }); tone(990, 0.15, { type: 'triangle', vol: 0.2, delay: 0.07 }); },
  chop: () => { noise(0.12, { freq: 900, vol: 0.5, q: 2 }); tone(180, 0.1, { type: 'square', vol: 0.08, slide: -80 }); },
  swing: () => noise(0.14, { freq: 2400, vol: 0.18, q: 0.7 }),
  hit: () => { noise(0.1, { freq: 600, vol: 0.6, q: 1 }); tone(240, 0.12, { type: 'square', vol: 0.12, slide: -140 }); },
  hurt: () => { tone(330, 0.25, { type: 'sawtooth', vol: 0.15, slide: -180 }); },
  crabPop: () => { noise(0.25, { freq: 2600, vol: 0.4, q: 3 }); tone(520, 0.2, { type: 'triangle', vol: 0.2, slide: 400 }); },
  craft: () => [523, 659, 784].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.2, delay: i * 0.08 })),
  tide: () => { noise(2.2, { freq: 400, vol: 0.5, q: 0.5, type: 'lowpass' }); tone(196, 1.2, { vol: 0.12, slide: 60 }); },
  warn: () => { tone(880, 0.1, { type: 'triangle', vol: 0.15 }); tone(880, 0.1, { type: 'triangle', vol: 0.15, delay: 0.18 }); },
  dodge: () => noise(0.18, { freq: 700, vol: 0.2, q: 0.5 }),
  eat: () => { tone(300, 0.08, { type: 'square', vol: 0.08 }); tone(360, 0.08, { type: 'square', vol: 0.08, delay: 0.1 }); },
  telegraph: () => tone(1200, 0.18, { type: 'square', vol: 0.06, slide: 600 }),
  chest: () => [392, 523, 659, 1046].forEach((f, i) => tone(f, 0.4, { type: 'triangle', vol: 0.22, delay: i * 0.1 })),
  sail: () => [392, 494, 587, 784, 988].forEach((f, i) => tone(f, 0.6, { type: 'triangle', vol: 0.22, delay: i * 0.14 })),
  setRain: (v) => { if (rainGain) rainGain.gain.value = v * 0.16; },
  setFall: (v) => { if (fallGain) fallGain.gain.value = v * 0.5; },
  gull: () => { tone(1500, 0.22, { type: 'sawtooth', vol: 0.05, slide: -500 }); tone(1350, 0.3, { type: 'sawtooth', vol: 0.05, slide: -600, delay: 0.25 }); },
  cricket: () => { for (let i = 0; i < 3; i++) tone(4200 + Math.random() * 300, 0.03, { type: 'square', vol: 0.012, delay: i * 0.06 }); },
  splash: () => { noise(0.3, { freq: 1100, vol: 0.35, q: 0.8 }); },
  bite: () => { tone(900, 0.08, { type: 'triangle', vol: 0.25 }); tone(1300, 0.12, { type: 'triangle', vol: 0.25, delay: 0.08 }); },
  cast: () => noise(0.35, { freq: 3000, vol: 0.15, q: 0.6 }),
  grip: () => tone(260 + Math.random() * 60, 0.06, { type: 'triangle', vol: 0.06 }),
  pant: () => { noise(0.18, { freq: 1600, vol: 0.12, q: 1.5 }); noise(0.2, { freq: 1300, vol: 0.1, q: 1.5, delay: 0.32 }); },
  sleep: () => [523, 440, 392, 330].forEach((f, i) => tone(f, 0.5, { type: 'sine', vol: 0.15, delay: i * 0.25 })),
  sizzle: () => noise(0.5, { freq: 5000, vol: 0.06, q: 0.5 }),
  parrot: () => { tone(1800, 0.06, { type: 'square', vol: 0.05, slide: 600 }); tone(2200, 0.06, { type: 'square', vol: 0.05, delay: 0.08, slide: -500 }); }
};

// ─── 背景音乐（CC0 电子乐，来源见 public/music/CREDITS.md）───
// gain 按实测平均响度对齐到约 -20 dB，切歌时 1.2 秒交叉淡入淡出
export const TRACKS = [
  { file: 'catchy.mp3', name: 'Catchy', by: 'Spring Spring', gain: 1.0 },
  { file: 'synthwave.mp3', name: 'Space Synth Wave', by: 'Pro Sensory', gain: 0.6 },
  { file: 'electronic-synth.mp3', name: 'Electronic Synth', by: 'Pro Sensory', gain: 0.58 },
  { file: 'tropical-loop.mp3', name: 'Tropical Loop', by: 'wipics', gain: 0.45 }
];
const BGM_VOL = 0.32;
let bgmBus = null, cur = null, trackIdx = +(localStorage.getItem('piaodao-bgm') ?? 0) % TRACKS.length, muted = localStorage.getItem('piaodao-bgm-mute') === '1';
function playTrack(i) {
  if (!ctx) return;
  if (!bgmBus) { bgmBus = ctx.createGain(); bgmBus.gain.value = muted ? 0 : 1; bgmBus.connect(master); }
  const t = ctx.currentTime, old = cur;
  if (old) { old.g.gain.cancelScheduledValues(t); old.g.gain.setValueAtTime(old.g.gain.value, t); old.g.gain.linearRampToValueAtTime(0, t + 1.2); setTimeout(() => old.el.pause(), 1300); }
  const el = new Audio(`${import.meta.env.BASE_URL}music/${TRACKS[i].file}`);
  el.loop = true; el.crossOrigin = 'anonymous';
  const g = ctx.createGain(); g.gain.value = 0;
  ctx.createMediaElementSource(el).connect(g).connect(bgmBus);
  el.play().catch(() => {});
  g.gain.linearRampToValueAtTime(BGM_VOL * TRACKS[i].gain, t + 1.2);
  cur = { el, g };
  trackIdx = i; localStorage.setItem('piaodao-bgm', i);
}
export const bgm = {
  start: () => { if (!cur) playTrack(trackIdx); },
  next: () => playTrack((trackIdx + 1) % TRACKS.length),
  toggleMute: () => {
    muted = !muted; localStorage.setItem('piaodao-bgm-mute', muted ? '1' : '0');
    if (bgmBus) bgmBus.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.15);
    return muted;
  },
  current: () => TRACKS[trackIdx], muted: () => muted, el: () => cur?.el
};

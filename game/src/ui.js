// DOM 界面：HUD、交互提示、背包/制作面板、提示条。只读游戏状态，操作通过回调交还给 main。
import { ITEMS, RECIPES, STATIONS } from './data.js';
import { ICONS } from './icons.js';

const $ = (s) => document.querySelector(s);
const HOTBAR = ['wood', 'stone', 'leaf', 'rope', 'coconut', 'fish', 'shell', 'plank', 'sail', 'tentkit', 'shard'];
const TOOLS = ['sword', 'axe', 'rod', 'hoe', 'can'];
let lastCounts = {};
export const icon = (k) => ICONS[k] ? `<img class="ic" src="${ICONS[k]}" alt="">` : '';
const bigIcon = (k) => ICONS[k] ? `<img src="${ICONS[k]}" alt="">` : '';
export function setAvatar() { $('#avatar').src = ICONS.avatar; }

export function setBar(id, v, low = 0.25) {
  const el = $(`#stat-${id}`);
  el.querySelector('i').style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
  const t = String(Math.round(v * 100)); const em = el.querySelector('em'); if (em.textContent !== t) em.textContent = t;
  el.classList.toggle('low', v < low);
}

export function renderHotbar(state) {
  const bar = $('#hotbar');
  if (!bar.children.length) {
    for (const t of TOOLS) bar.insertAdjacentHTML('beforeend', `<div class="slot tool" data-k="${t}">${bigIcon(t)}<span class="lbl">${ITEMS[t].name}</span></div>`);
    bar.insertAdjacentHTML('beforeend', '<div class="sep"></div>');
    for (const k of HOTBAR) bar.insertAdjacentHTML('beforeend', `<div class="slot" data-k="${k}">${bigIcon(k)}<span class="lbl">${ITEMS[k].name}</span><b></b></div>`);
  }
  for (const el of bar.children) {
    const k = el.dataset.k;
    if (!k) continue;
    if (ITEMS[k].tool) { el.classList.toggle('empty', !state.tools[k]); continue; }
    const n = state.inv[k] || 0;
    el.classList.toggle('empty', n === 0);
    el.querySelector('b').textContent = n || '';
    if (lastCounts[k] !== undefined && n > lastCounts[k]) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    lastCounts[k] = n;
  }
}

export function setTide(isLow, secondsLeft, warn, level01) {
  $('#tide-label').textContent = isLow ? '退潮' : '高潮';
  $('#tide-time').textContent = warn ? '潮水要变了！' : `${isLow ? '沙洲露出' : '沙洲淹没'} · ${Math.ceil(secondsLeft)}s`;
  $('#tide-water').style.height = `${20 + level01 * 60}%`;
  $('#tide').classList.toggle('warn', warn);
}

export function setQuest(steps) {
  const list = $('#quest-list');
  const html = steps.map(s => `<li class="${s.state}">${s.text}${s.sub && s.state === 'now' ? `<small>${s.sub}</small>` : ''}</li>`).join('');
  if (list.innerHTML !== html) list.innerHTML = html;
}

export function setPrompt(text, x, y, blocked) {
  const p = $('#prompt');
  if (!text) { p.hidden = true; return; }
  p.hidden = false; p.innerHTML = text; p.style.left = `${x}px`; p.style.top = `${y}px`;
  p.classList.toggle('blocked', !!blocked);
}

export function setArrow(show, x, y, angle) {
  const a = $('#arrow');
  a.hidden = !show;
  if (show) { a.style.left = `${x - 15}px`; a.style.top = `${y - 18}px`; a.style.transform = `rotate(${angle}rad)`; }
}

let bannerTimer = 0;
export function banner(text, ms = 2600) {
  const b = $('#banner');
  b.textContent = text; b.hidden = false;
  b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => (b.hidden = true), ms);
}

export function toast(text) {
  const box = $('#toasts');
  const d = document.createElement('div'); d.textContent = text; box.append(d);
  setTimeout(() => (d.style.opacity = 0), 2600); setTimeout(() => d.remove(), 3200);
  while (box.children.length > 5) box.firstChild.remove();
}

export function floatText(text, x, y, color) {
  const s = document.createElement('span');
  s.innerHTML = text; s.style.left = `${x}px`; s.style.top = `${y}px`;
  if (color) s.style.color = color;
  $('#floats').append(s); setTimeout(() => s.remove(), 1150);
}

export function hurtFlash(v) { $('#vignette-hurt').style.opacity = v; }
export function fade(on) { $('#fade').style.opacity = on ? 1 : 0; }

// ─── 面板 ───
export const panelOpen = () => !$('#panel').hidden;
export function togglePanel(force) {
  const p = $('#panel'); p.hidden = force === undefined ? !p.hidden : !force;
}
const FOODS = new Set(['coconut', 'fish', 'roast', 'grilledFish', 'grilledClaw', 'soup', 'tomato', 'watermelon', 'sweetPotato', 'roastPotato']);
export function renderPanel(state, near, canCraft, onCraft, onEat) {
  const inv = $('#inv-grid');
  const keys = Object.keys(ITEMS).filter(k => !ITEMS[k].tool && (state.inv[k] || 0) > 0);
  inv.innerHTML = keys.map(k => `<div class="cell ${FOODS.has(k) ? 'food' : ''}" data-k="${k}">${bigIcon(k)}<small>${ITEMS[k].name}</small><b>${state.inv[k]}</b></div>`).join('')
    + Object.keys(state.tools).filter(t => state.tools[t]).map(t => `<div class="cell">${bigIcon(t)}<small>${ITEMS[t].name}</small></div>`).join('')
    || '<p class="hint">空空如也。去海滩上捡点东西吧。</p>';
  inv.querySelectorAll('.food').forEach(el => el.addEventListener('click', () => onEat(el.dataset.k)));
  $('#station-note').textContent = near.bench || near.fire ? `· 你在${[near.bench && '工作台', near.fire && '营火'].filter(Boolean).join('、')}旁边` : '· 走到工作台/营火旁可解锁更多';
  const box = $('#recipes');
  box.innerHTML = RECIPES.map(r => {
    const done = r.once && state.tools[r.out];
    const cost = Object.entries(r.cost).map(([k, n]) => {
      const have = state.inv[k] || 0;
      return `<span class="${have < n ? 'miss' : ''}">${icon(k)}${ITEMS[k].name} ${have}/${n}</span>`;
    }).join('');
    const ok = canCraft(r);
    return `<div class="recipe ${done ? 'done' : ''}">
      <div class="big">${bigIcon(r.out)}</div>
      <div><div class="name">${ITEMS[r.out].name}${r.n > 1 ? ` ×${r.n}` : ''}</div><div class="desc">${r.desc}</div>
      <div class="cost">${cost}</div>${r.station ? `<div class="station">需要：${STATIONS[r.station]}${near[r.station] ? ' ✓' : ''}</div>` : '<div class="station">随身制作</div>'}</div>
      <button type="button" data-r="${r.id}" ${ok && !done ? '' : 'disabled'}>${done ? '已拥有' : r.cook ? (state.cook ? '烹饪中' : `烤 ${r.cook}s`) : '制作'}</button></div>`;
  }).join('');
  box.querySelectorAll('button[data-r]').forEach(b => b.addEventListener('click', () => onCraft(b.dataset.r)));
}

export function showEnd(stats) {
  $('#end-stats').innerHTML = stats.map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('');
  $('#ending').hidden = false;
}

let saveTimer = 0;
export function saveBadge() {
  const b = $('#save-badge'); b.classList.add('on');
  clearTimeout(saveTimer); saveTimer = setTimeout(() => b.classList.remove('on'), 1400);
}

// 时间段图标（SVG，和 UI 描边风格一致）
const PHASE_SVG = {
  sun: '<svg class="svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="#fff" stroke="#13294b" stroke-width="2"/><g stroke="#13294b" stroke-width="2.2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g></svg>',
  moon: '<svg class="svg" viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="#fff6b0" stroke="#13294b" stroke-width="2" stroke-linejoin="round"/></svg>',
  dusk: '<svg class="svg" viewBox="0 0 24 24"><path d="M5 16a7 7 0 0 1 14 0z" fill="#ff8a4a" stroke="#13294b" stroke-width="2"/><path d="M2 19.5h20" stroke="#13294b" stroke-width="2.2" stroke-linecap="round"/></svg>',
  cloud: '<svg class="svg" viewBox="0 0 24 24"><path d="M7 18h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z" fill="#fff" stroke="#13294b" stroke-width="2" stroke-linejoin="round"/></svg>',
  rain: '<svg class="svg" viewBox="0 0 24 24"><path d="M7 14h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 14z" fill="#dfe9f7" stroke="#13294b" stroke-width="2" stroke-linejoin="round"/><path d="M8 17l-1 3M12.5 17l-1 3M17 17l-1 3" stroke="#1f7fe6" stroke-width="2.2" stroke-linecap="round"/></svg>'
};
const PHASE_BG = { sun: '#ffd23a', moon: '#3b5aa8', dusk: '#ffb07a', cloud: '#9fc4e8', rain: '#6f96c8' };
let lastPhase = '';
export function setClock(time, phase, sub, day) {
  $('#clock-time').textContent = time; $('#clock-sub').textContent = sub;
  if (phase !== lastPhase) { $('#clock-icon').innerHTML = PHASE_SVG[phase]; $('#clock-icon').style.background = PHASE_BG[phase]; lastPhase = phase; }
  const d = `第 ${day} 天`; if ($('#pday').textContent !== d) $('#pday').textContent = d;
}
let lastStatus = '';
export function setStatus(list) {
  const html = list.map(([, t, c]) => `<span class="st-${c}">${t}</span>`).join('');
  if (html !== lastStatus) { $('#status').innerHTML = html; lastStatus = html; }
}
export function setCookBar(at, k, label) {
  const b = $('#cookbar');
  if (!at) { b.hidden = true; return; }
  b.hidden = false; b.style.left = `${at.x}px`; b.style.top = `${at.y}px`;
  b.querySelector('i').style.width = `${k * 100}%`; b.querySelector('span').textContent = label;
}

export function setCamMode(free) {
  const b = $('#cam-toggle');
  b.querySelector('b').textContent = free ? '自由视角' : '固定视角';
  b.classList.toggle('on', free);
}

export function setHD(on) { const b = $('#hd-toggle'); b.classList.toggle('on', on); }

export function setMusic(t, muted) {
  const b = $('#music');
  b.querySelector('b').textContent = muted ? '音乐已关' : t.name;
  b.classList.toggle('off', muted);
}

// ─── 敌人血条 ───
const enemyBars = new Map();
export function setEnemyBar(id, at, frac, lag, st = {}) {
  let el = enemyBars.get(id);
  if (!at) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('div'); el.className = 'ebar';
    el.innerHTML = '<span>椰壳蟹</span><div class="ebar-track"><i class="lag"></i><i class="hp"></i></div>';
    $('#enemy-bars').append(el); enemyBars.set(id, el);
  }
  el.hidden = false;
  el.style.left = `${at.x}px`; el.style.top = `${at.y}px`;
  el.querySelector('.hp').style.width = `${frac * 100}%`;
  el.querySelector('.lag').style.width = `${lag * 100}%`;
  el.classList.toggle('alert', !!st.alert); el.classList.toggle('windup', !!st.windup);
  el.classList.toggle('far', !st.near);
  if (st.hit) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
}

export function setToon(on) { $('#toon-toggle').classList.toggle('on', on); }

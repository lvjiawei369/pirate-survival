// 耕种：锄头开垦 → 播种（Q 换种子）→ 浇水（下雨自动浇）→ 按游戏时间生长 → 收获。
// 田块按 1.4 米网格对齐；庄稼只在“当天浇过水”时生长，每天早上 6 点土变干。
import * as THREE from 'three';
import { terrainHeight, groundHeight, onDock, waterLevelAt } from './terrain.js';
import { CROPS, ITEMS } from './data.js';
import * as M from './models.js';

const GRID = 1.4;
const SEEDS = ['seedPotato', 'seedTomato', 'seedMelon'];

export function createFarming(ctx) {
  const { S, env, scene, colliders, UI, sfx, add, burst, toScreen, saveGame } = ctx;
  const plots = new Map();   // key "i,j" → { i, j, x, z, obj, crop, stage, grow, watered, cropObj }
  let seedIdx = 0, lastHour = env.hour;
  const key = (i, j) => `${i},${j}`;
  const cell = (x, z) => [Math.round(x / GRID), Math.round(z / GRID)];

  function tillable(x, z) {
    if (onDock(x, z)) return false;
    let lo = Infinity, hi = -Infinity;
    for (const [dx, dz] of [[0, 0], [0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]]) { const h = terrainHeight(x + dx, z + dz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (lo < 0.9 || hi - lo > 0.35) return false;
    if (waterLevelAt(x, z, ctx.tideLevel()) > lo - 0.1) return false;
    return colliders.every(c => Math.hypot(c.x - x, c.z - z) > c.r + 0.7);
  }
  function makePlot(i, j, fromSave) {
    const x = i * GRID, z = j * GRID;
    const obj = M.buildPlot(); obj.position.set(x, groundHeight(x, z) - 0.04, z); scene.add(obj);
    const p = { i, j, x, z, obj, crop: null, stage: 0, grow: 0, watered: false, cropObj: null };
    plots.set(key(i, j), p);
    clearGrass(x, z);
    if (!fromSave) burst(obj.position.clone().setY(obj.position.y + 0.2), 10, ['#7a5436', '#5a3d26', '#9a7050'], { box: true, speed: 2, up: 2.5, life: 0.6 });
    return p;
  }
  // 田里不长草：把落在田块上的草实例缩成 0
  const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function clearGrass(x, z) { ctx.grass?.clearAt(x, z); }
  function setCrop(p, crop, stage) {
    if (p.cropObj) scene.remove(p.cropObj);
    p.crop = crop; p.stage = stage; p.cropObj = null;
    if (!crop) return;
    p.cropObj = M.buildCrop(crop, stage);
    p.cropObj.position.x += p.x; p.cropObj.position.z += p.z; p.cropObj.position.y += p.obj.position.y;
    p.cropObj.rotation.y = (p.i * 7 + p.j * 3) % 6;
    scene.add(p.cropObj);
  }
  function setWet(p, wet) {
    p.watered = wet;
    p.obj.userData.soil.color.set(wet ? '#4a3222' : '#7a5436');
  }

  // 玩家面前的那一格
  function target() {
    const fx = S.pos.x + Math.sin(S.facing) * 1.3, fz = S.pos.z + Math.cos(S.facing) * 1.3;
    const [i, j] = cell(fx, fz);
    return { i, j, x: i * GRID, z: j * GRID, plot: plots.get(key(i, j)) };
  }
  const haveSeeds = () => SEEDS.filter(s => (S.inv[s] || 0) > 0);
  const seedName = () => { const h = haveSeeds(); return h.length ? h[seedIdx % h.length] : null; };

  // 返回交互项（优先级低于其它东西：只有附近没别的可互动时才出现）
  function interactable() {
    if (S.mode !== 'walk' || S.inTent) return null;
    const t = target();
    if (t.plot) return { kind: 'farm', t, x: t.x, z: t.z, rad: 2.2 };
    if (S.tools.hoe && tillable(t.x, t.z)) return { kind: 'farm', t, x: t.x, z: t.z, rad: 2.2, farmOnly: true };
    return null;
  }
  function promptFor(it) {
    const K = '<kbd>E</kbd>', p = it.t.plot;
    if (!p) return [`${K}用锄头开垦一块田`];
    if (!p.crop) {
      const sd = seedName();
      return sd ? [`${K}种下 ${UI.icon(sd)}${ITEMS[sd].name}　<kbd>Q</kbd>换种子`] : ['没有种子了（灌木丛里偶尔能找到）', true];
    }
    const c = CROPS[p.crop];
    if (p.stage >= 3) return [`${K}收获${c.name}`];
    const pct = Math.floor(p.grow / c.hours * 100);
    if (!p.watered) return S.tools.can ? [`${K}浇水　${c.name} ${pct}%`] : [`${c.name}缺水了 · 需要水壶`, true];
    return [`${c.name}正在长 ${pct}%（已浇水）`, true];
  }
  function interact(it) {
    const t = it.t; let p = t.plot;
    S.facing = Math.atan2(t.x - S.pos.x, t.z - S.pos.z);
    if (!p) {
      if (!S.tools.hoe || !tillable(t.x, t.z)) return;
      makePlot(t.i, t.j); sfx.chop(); S.act = { type: 'chop', t: 0, dur: 0.42, fired: true };
      saveGame('farm'); return;
    }
    if (!p.crop) {
      const sd = seedName(); if (!sd) return;
      if (!S.test) S.inv[sd]--;
      setCrop(p, ITEMS[sd].seed, 0); p.grow = 0; sfx.pickup();
      burst(new THREE.Vector3(p.x, p.obj.position.y + 0.3, p.z), 5, ['#c8a060', '#5aa84e'], { speed: 1, up: 2, life: 0.5 });
      S.act = { type: 'pick', t: 0, dur: 0.35, fired: true };
      saveGame('farm'); return;
    }
    if (p.stage >= 3) {
      const c = CROPS[p.crop];
      const n = c.yield[0] + Math.floor(Math.random() * (c.yield[1] - c.yield[0] + 1));
      add(c.out, n, new THREE.Vector3(p.x, p.obj.position.y, p.z));
      if (Math.random() < 0.7) setTimeout(() => add(c.seed, 1 + (Math.random() < 0.3 ? 1 : 0), new THREE.Vector3(p.x, p.obj.position.y, p.z)), 250);
      burst(new THREE.Vector3(p.x, p.obj.position.y + 0.5, p.z), 12, ['#5aa84e', '#3f8a3f', '#ffe08a'], { box: true, speed: 2.5, up: 3, life: 0.8 });
      setCrop(p, null, 0); setWet(p, p.watered); sfx.craft();
      S.act = { type: 'pick', t: 0, dur: 0.35, fired: true };
      saveGame('farm'); return;
    }
    if (!p.watered && S.tools.can) { water(p); S.act = { type: 'pick', t: 0, dur: 0.35, fired: true }; }
  }
  function water(p) {
    setWet(p, true); sfx.splash();
    burst(new THREE.Vector3(p.x, p.obj.position.y + 0.8, p.z), 12, ['#8fd8ff', '#ffffff'], { speed: 1, up: 0.5, life: 0.6 });
  }

  function update(dt, pressedQ) {
    if (pressedQ && haveSeeds().length > 1) { seedIdx++; sfx.grip(); }
    // 游戏时间推进：浇过水的庄稼按小时生长；早上 6 点土变干；下雨自动浇
    let dh = env.hour - lastHour; if (dh < -12) dh += 24; lastHour = env.hour;
    if (dh <= 0 || dh > 12) return;
    const dawn = (env.hour >= 6 && env.hour - dh < 6);
    for (const p of plots.values()) {
      if (env.rain > 0.5 && !p.watered) setWet(p, true);
      if (p.crop && p.watered && p.stage < 3) {
        const c = CROPS[p.crop];
        p.grow = Math.min(c.hours, p.grow + dh * (env.rain > 0.5 ? 1.25 : 1));
        const st = p.grow >= c.hours ? 3 : p.grow >= c.hours * 0.5 ? 2 : p.grow >= c.hours * 0.12 ? 1 : 0;
        if (st !== p.stage) { setCrop(p, p.crop, st); if (st === 3) burst(new THREE.Vector3(p.x, p.obj.position.y + 0.6, p.z), 8, ['#ffe08a', '#ffffff'], { speed: 1, up: 2, life: 0.8, gravity: 1 }); }
      }
      if (dawn && env.rain < 0.5) setWet(p, false);
    }
  }
  // 睡觉/跳时间时：一次性推进（在 skipTo 之后调用）
  function catchUp() { lastHour = env.hour; }

  function serialize() {
    return [...plots.values()].map(p => [p.i, p.j, p.crop, p.stage, +p.grow.toFixed(2), p.watered ? 1 : 0]);
  }
  function load(list) {
    if (!list) return;
    for (const [i, j, crop, stage, grow, wet] of list) { const p = makePlot(i, j, true); setCrop(p, crop, stage); p.grow = grow; setWet(p, !!wet); }
    lastHour = env.hour;
  }
  // 营地旁边送一小块现成的田（2×3），新手不用自己找地方
  function starterField() {
    // 在营地附近找一块能放下 3×2 田的空地
    for (let r = 4; r < 20; r += 1.4) for (let a = 0; a < Math.PI * 2; a += 0.5) {
      const [i0, j0] = cell(-4 + Math.cos(a) * r, 8.5 + Math.sin(a) * r);
      const cells = [];
      for (let a2 = 0; a2 < 3; a2++) for (let b = 0; b < 2; b++) cells.push([i0 + a2, j0 + b]);
      if (cells.every(([i, j]) => !plots.has(key(i, j)) && tillable(i * GRID, j * GRID))) { cells.forEach(([i, j]) => makePlot(i, j, true)); return; }
    }
  }
  return { update, interactable, promptFor, interact, serialize, load, starterField, catchUp, seedName };
}

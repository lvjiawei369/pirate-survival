// 生活系统：烤火/着凉、营火烹饪、钓鱼、搭帐篷睡觉。
// 都通过 ctx 读写游戏状态，main.js 只负责把它们挂进主循环和交互列表。
import * as THREE from 'three';
import { terrainHeight, groundHeight, onDock, waterLevelAt, LAYOUT, POND, TIDE } from './terrain.js';
import { ITEMS } from './data.js';
import * as M from './models.js';

export function createSystems(ctx) {
  const { S, env, scene, props, colliders, UI, sfx, add, burst, toScreen, fadeAction, saveGame, hero, HP } = ctx;
  S.cold = 0; S.buffs = {}; S.cook = null; S.fish = null; S.place = null; S.playerTent = null; S.inTent = null;
  // 火堆：营地一堆；自己搭的帐篷门口也会生一堆小火
  const fires = [new THREE.Vector3(LAYOUT.campfire.x, groundHeight(LAYOUT.campfire.x, LAYOUT.campfire.z), LAYOUT.campfire.z)];
  const fire = () => fires.reduce((a, b) => (a.distanceTo(S.pos) < b.distanceTo(S.pos) ? a : b)).clone();

  // ─────────── 烤火 / 着凉 ───────────
  const nearFire = () => fire().distanceTo(S.pos) < (S.inTent ? 4.5 : 3.6);
  let sparkT = 0;
  function updateWarmth(dt) {
    for (const k of Object.keys(S.buffs)) if ((S.buffs[k] -= dt) <= 0) delete S.buffs[k];
    const chill = Math.min(1, env.nightness * 0.7 + env.rain * 0.9) * (S.inTent ? 0.1 : 1);   // 帐篷里挡风挡雨
    if (nearFire()) {
      S.cold = Math.max(0, S.cold - dt * 0.3);
      if (S.hp < 100) S.hp = Math.min(100, S.hp + dt * 3);
      if ((sparkT -= dt) <= 0) { sparkT = 0.35; burst(fire().setY(fire().y + 0.9), 2, ['#ffd24a', '#ff9a3c'], { speed: 0.6, up: 2.5, life: 0.9, gravity: -1, size: 0.6 }); }
    } else if (S.buffs.warm) S.cold = Math.max(0, S.cold - dt * 0.1);
    else S.cold = Math.min(1, S.cold + dt * chill * 0.012 - dt * (1 - chill) * 0.02);
    S.cold = Math.max(0, S.cold);
  }
  const staminaMul = () => (S.cold > 0.5 ? 0.6 : 1) * (S.buffs.strong ? 1.6 : 1) * (S.hunger > 25 ? 1 : 0.6) * (nearFire() ? 1.5 : 1);
  const hungerMul = () => (S.cold > 0.5 ? 1.5 : 1);
  function statuses() {
    const out = [];
    if (S.inTent) out.push(['', nearFire() ? '在帐篷里烤火 · 暖和' : '在帐篷里 · 挡风挡雨', 'warm']);
    else if (nearFire()) out.push(['🔥', '烤火中 · 回血', 'warm']);
    else if (S.cold > 0.5) out.push(['🥶', '着凉了 · 体力恢复变慢', 'cold']);
    else if (S.cold > 0.2) out.push(['🌬️', '有点冷', 'cool']);
    if (S.buffs.warm) out.push(['🍲', `暖身 ${Math.ceil(S.buffs.warm)}s`, 'buff']);
    if (S.buffs.strong) out.push(['💪', `精力 ${Math.ceil(S.buffs.strong)}s`, 'buff']);
    if (S.exhausted) out.push(['💦', '累瘫了', 'cold']);
    if (S.hunger < 25) out.push(['🍽️', '饿了', 'cool']);
    return out;
  }

  // ─────────── 烹饪 ───────────
  const skewers = {};
  function skewerFor(id) {
    if (!skewers[id]) {
      const s = M.buildSkewer(id); s.visible = false;
      scene.add(s); skewers[id] = s;
    }
    return skewers[id];
  }
  function startCook(r) {
    if (S.cook) return false;
    const at = fire();
    S.cook = { id: r.id, out: r.out, t: 0, dur: r.cook, at };
    const sk = skewerFor(r.id); sk.position.set(at.x, at.y + 1.0, at.z); sk.visible = true; sfx.sizzle();
    return true;
  }
  function updateCook(dt) {
    if (!S.cook) { UI.setCookBar(null); return; }
    const c = S.cook; c.t += dt;
    const sk = skewerFor(c.id);
    sk.userData.parts.food.rotation.x += dt * 3;
    const k = Math.min(1, c.t / c.dur);
    const cf = () => c.at.clone();
    if (Math.random() < dt * 3) { burst(cf().setY(c.at.y + 1.2), 1, ['#ffffff'], { speed: 0.3, up: 1.5, life: 1.2, gravity: -0.5, size: 0.8 }); }
    if (Math.random() < dt * 0.8) sfx.sizzle();
    const s = toScreen(c.at, 2.1); UI.setCookBar(s, k, ITEMS[c.out].name);
    if (c.t >= c.dur) {
      sk.visible = false; S.cook = null; sfx.craft();
      add(c.out, 1, c.at);
      burst(cf().setY(c.at.y + 1.2), 10, ['#ffffff', '#ffe08a'], { speed: 1.2, up: 3, life: 1, gravity: 1 });
      if (S.pos.distanceTo(c.at) > 10) UI.toast(`${ITEMS[c.out].name}烤好了，已经放进背包`);
      saveGame('cook');
    }
  }

  // ─────────── 钓鱼 ───────────
  const spots = [];
  function addSpot(x, z, kind) {
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.35, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#0b3a42', transparent: true, opacity: 0.45, depthWrite: false }));
    shadow.scale.set(0.6, 1, 1.5); shadow.renderOrder = 3;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }));
    ring.renderOrder = 3;
    scene.add(shadow, ring);
    spots.push({ x, z, kind, shadow, ring, cooldown: 0, ph: Math.random() * 6 });
  }
  // 海里的鱼群点：离岸 2–4 米、足够深的地方
  for (const [x, z] of [[-12.2, 34.2], [16.5, 16.5], [-20, 17], [-40, 0], [8, -34], [31, 19], [-22, -20]]) {
    let best = null;
    for (let i = 0; i < 40 && !best; i++) {
      const a = i * 0.7, r = i * 0.25, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (terrainHeight(px, pz) < -1.0) best = [px, pz];
    }
    if (best) addSpot(best[0], best[1], 'sea');
  }
  addSpot(POND.x + 0.6, POND.z + 0.4, 'pond');
  const level = (sp) => sp.kind === 'pond' ? POND.y : ctx.tideLevel();
  function nearestSpot() {
    let best = null, bd = 5.2;
    for (const sp of spots) {
      if (sp.cooldown > 0) continue;
      const d = Math.hypot(sp.x - S.pos.x, sp.z - S.pos.z);
      if (d < bd) { bd = d; best = sp; }
    }
    // 人得站在岸上/码头上
    const dep = waterLevelAt(S.pos.x, S.pos.z, ctx.tideLevel()) - groundHeight(S.pos.x, S.pos.z);
    return best && dep < 0.25 && S.mode === 'walk' ? best : null;
  }
  const bobber = M.buildBobber(); bobber.visible = false; scene.add(bobber);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#fbf3e2' })); line.visible = false; line.frustumCulled = false; scene.add(line);
  const rod = M.buildRod(); rod.visible = false;
  rod.position.set(0.035, -0.31, 0.02); rod.rotation.x = 0.9; HP.arms[1].sh.add(rod);
  const caughtFish = M.buildFish('#f2994a'); caughtFish.visible = false; scene.add(caughtFish);
  const tipPos = new THREE.Vector3();

  function startFishing(sp) {
    S.fish = { phase: 'cast', t: 0, sp, wait: (2.5 + Math.random() * 3.5) * (1 - env.rain * 0.4) * (env.isNight() ? 0.8 : 1), nibble: 0 };
    S.facing = Math.atan2(sp.x - S.pos.x, sp.z - S.pos.z);
    sfx.cast();
  }
  function stopFishing(msg) {
    S.fish = null; bobber.visible = false; line.visible = false;
    if (msg) UI.toast(msg);
  }
  function fishingInput() { // 返回 true 表示按键被钓鱼吃掉了
    const f = S.fish;
    if (!f) return false;
    if (f.phase === 'bite') {
      f.phase = 'catch'; f.t = 0; sfx.splash();
      burst(bobber.position.clone(), 10, ['#ffffff', '#bff3ef'], { speed: 2, up: 3, life: 0.6 });
      caughtFish.visible = true;
      return true;
    }
    if (f.phase === 'wait' || f.phase === 'cast') { stopFishing(f.phase === 'wait' ? '收竿了' : null); return true; }
    return true;
  }
  function updateFishing(dt, inputMag) {
    for (const sp of spots) {
      sp.cooldown = Math.max(0, sp.cooldown - dt);
      const on = sp.cooldown <= 0;
      const y = level(sp) - 0.12, t = S.time + sp.ph;
      sp.shadow.visible = sp.ring.visible = on;
      sp.shadow.position.set(sp.x + Math.cos(t * 0.8) * 0.5, y, sp.z + Math.sin(t * 0.8) * 0.5);
      sp.shadow.rotation.y = -t * 0.8;
      const rk = (t * 0.5) % 1;
      sp.ring.position.set(sp.x, y + 0.14, sp.z); sp.ring.scale.setScalar(0.6 + rk * 1.4); sp.ring.material.opacity = 0.5 * (1 - rk);
    }
    rod.visible = !!S.fish;
    if (!S.fish) return;
    const f = S.fish, sp = f.sp;
    if (inputMag > 0.3 || S.mode !== 'walk') return stopFishing();
    f.t += dt;
    HP.arms[1].sh.rotation.set(-1.1 + (f.phase === 'cast' ? Math.sin(Math.min(1, f.t / 0.5) * Math.PI) * -1.4 : 0) + (f.phase === 'catch' ? -1.2 : 0), 0, 0.1);
    HP.arms[0].sh.rotation.set(-0.9, 0, -0.2);
    S.facing = Math.atan2(sp.x - S.pos.x, sp.z - S.pos.z);
    rod.userData.parts.tip.getWorldPosition(tipPos);
    const water = new THREE.Vector3(sp.x, level(sp), sp.z);
    if (f.phase === 'cast') {
      const k = Math.min(1, f.t / 0.55);
      bobber.visible = true;
      bobber.position.copy(tipPos).lerp(water, k); bobber.position.y += Math.sin(k * Math.PI) * 1.6;
      if (k >= 1) { f.phase = 'wait'; f.t = 0; sfx.splash(); burst(water.clone(), 6, ['#ffffff', '#bff3ef'], { speed: 1.2, up: 2, life: 0.5 }); }
    } else if (f.phase === 'wait') {
      bobber.position.copy(water); bobber.position.y += Math.sin(S.time * 3) * 0.03;
      if ((f.nibble -= dt) <= 0) { f.nibble = 0.6 + Math.random(); if (Math.random() < 0.5) bobber.position.y -= 0.05; }
      if (f.t > f.wait) {
        f.phase = 'bite'; f.t = 0; sfx.bite();
        const s = toScreen(water, 0.8); UI.floatText('！', s.x, s.y, '#ffe08a');
        UI.banner('咬钩了！快按 E！', 900);
      }
    } else if (f.phase === 'bite') {
      bobber.position.copy(water); bobber.position.y -= 0.14 + Math.sin(S.time * 30) * 0.04;
      if (Math.random() < dt * 20) burst(water.clone(), 1, ['#ffffff'], { speed: 0.8, up: 1.5, life: 0.4 });
      if (f.t > 0.9) { sp.cooldown = 6; stopFishing('鱼跑了……下次早点按'); }
    } else if (f.phase === 'catch') {
      const k = Math.min(1, f.t / 0.6);
      const head = S.pos.clone().setY(S.pos.y + 1.6);
      caughtFish.position.copy(water).lerp(head, k); caughtFish.position.y += Math.sin(k * Math.PI) * 2;
      caughtFish.rotation.x += dt * 18;
      bobber.position.copy(caughtFish.position);
      if (k >= 1) {
        caughtFish.visible = false;
        const n = sp.kind === 'sea' && Math.random() < 0.25 ? 2 : 1;
        add('fish', n, S.pos); sfx.pickup(); S.stats.fish = (S.stats.fish || 0) + n;
        sp.cooldown = 25; stopFishing(); saveGame('fish');
      }
    }
    line.visible = bobber.visible;
    const pa = lineGeo.attributes.position;
    pa.setXYZ(0, tipPos.x, tipPos.y, tipPos.z); pa.setXYZ(1, bobber.position.x, bobber.position.y + 0.2, bobber.position.z); pa.needsUpdate = true;
  }

  // ─────────── 搭帐篷 / 睡觉 ───────────
  const ghost = M.buildPlayerTent(true); ghost.visible = false; scene.add(ghost);
  let tentObj = null, tentCollider = null, tentFire = null, tentFireCol = null;
  function tentValid(x, z) {
    if (onDock(x, z)) return false;
    let lo = Infinity, hi = -Infinity;
    for (const [dx, dz] of [[0, 0], [1.1, 1], [-1.1, 1], [1.1, -1], [-1.1, -1]]) {
      const h = terrainHeight(x + dx, z + dz); lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (lo < TIDE.high + 0.2 || hi - lo > 0.45) return false;
    return colliders.every(c => c === tentCollider || Math.hypot(c.x - x, c.z - z) > c.r + 1.3);
  }
  function togglePlace() {
    if (S.place) { S.place = null; ghost.visible = false; return; }
    if (!S.inv.tentkit) { UI.toast('先在工作台做一个帐篷包（木材 4 · 叶片 6 · 绳子 2）'); return; }
    S.place = { x: 0, z: 0, ok: false }; ghost.visible = true;
  }
  function updatePlace() {
    if (!S.place) return;
    const x = S.pos.x + Math.sin(S.facing) * 2.6, z = S.pos.z + Math.cos(S.facing) * 2.6;
    const ok = tentValid(x, z);
    Object.assign(S.place, { x, z, ok });
    ghost.position.set(x, groundHeight(x, z), z); ghost.rotation.y = S.facing;
    ghost.userData.parts.clothMat.color.set(ok ? '#6de7e2' : '#e85d4a');
    const s = toScreen(ghost.position, 2.2);
    UI.setPrompt(ok ? '<kbd>E</kbd>在这里搭帐篷　<kbd>B</kbd>取消' : '这里太斜、离水太近或被挡住了　<kbd>B</kbd>取消', s.x, s.y, !ok);
  }
  function buildTentAt(x, z, ry, fromSave) {
    if (tentObj) {
      scene.remove(tentObj, tentFire); colliders.splice(colliders.indexOf(tentCollider), 1); colliders.splice(colliders.indexOf(tentFireCol), 1); fires.pop();
    }
    tentObj = M.buildPlayerTent(); tentObj.position.set(x, groundHeight(x, z), z); tentObj.rotation.y = ry; scene.add(tentObj);
    tentObj.userData.fadeMats = [];
    tentObj.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); tentObj.userData.fadeMats.push(o.material); } });
    tentCollider = { x, z, r: 1.1 }; colliders.push(tentCollider);
    // 门口一小堆篝火（离帐篷 2.3 米）
    const fx = x + Math.sin(ry) * 2.3, fz = z + Math.cos(ry) * 2.3;
    tentFire = M.buildCampfire(); tentFire.scale.setScalar(0.75); tentFire.position.set(fx, groundHeight(fx, fz), fz); scene.add(tentFire);
    tentFireCol = { x: fx, z: fz, r: 0.55 }; colliders.push(tentFireCol);
    fires.push(new THREE.Vector3(fx, groundHeight(fx, fz), fz));
    S.playerTent = { x, z, ry };
    if (!fromSave) burst(tentObj.position.clone().setY(tentObj.position.y + 0.5), 16, ['#2f8f8a', '#d9c08a', '#ffffff'], { box: true, speed: 2.5, up: 3, life: 0.9 });
  }
  function confirmPlace() {
    if (!S.place?.ok) { sfx.telegraph(); return; }
    buildTentAt(S.place.x, S.place.z, S.facing);
    S.inv.tentkit--; S.place = null; ghost.visible = false; sfx.craft();
    UI.banner('帐篷搭好了！可以在这里睡觉，倒下也会在这里醒来', 3200);
    saveGame('tent');
  }
  // 钻进帐篷：走到帐篷中间坐下，面朝门口；动一下方向键就出来
  function enterTent(t) {
    S.inTent = { ...t, t: 0, from: S.pos.clone() };
    S.fish = null; S.mode = 'walk'; S.vel.set(0, 0, 0);
  }
  function exitTent() {
    const t = S.inTent; S.inTent = null;
    S.pos.set(t.x + Math.sin(t.ry) * 1.5, 0, t.z + Math.cos(t.ry) * 1.5); S.pos.y = groundHeight(S.pos.x, S.pos.z);
  }
  // 人在里面时帐篷布变半透明，俯视镜头也看得见
  let tentFade = 1;
  function fadeTents(dt) {
    const target = S.inTent ? 0.32 : 1;
    if (tentFade === target) return;
    tentFade += (target - tentFade) * Math.min(1, dt * 6); if (Math.abs(tentFade - target) < 0.01) tentFade = target;
    for (const obj of [props.tent, tentObj]) for (const m of obj?.userData.fadeMats || []) { m.transparent = tentFade < 1; m.opacity = tentFade; m.depthWrite = tentFade >= 1; }
  }
  function updateTent(dt, inputMag, jump) {
    fadeTents(dt);
    const t = S.inTent;
    if (!t) return false;
    t.t += dt;
    const k = Math.min(1, t.t / 0.7);
    const inside = new THREE.Vector3(t.x + Math.sin(t.ry) * 0.15, groundHeight(t.x, t.z) + 0.12, t.z + Math.cos(t.ry) * 0.15);
    S.pos.copy(t.from).lerp(inside, k * k * (3 - 2 * k));
    S.facing = t.ry;
    S.hp = Math.min(100, S.hp + dt * 1.5);
    if (t.t > 0.8 && (inputMag > 0.3 || jump)) exitTent();
    return true;
  }
  // 坐姿：盘腿坐、手搭膝盖，偶尔点头打盹
  function tentPose() {
    if (!S.inTent) return;
    const P = HP;
    P.body.position.y = -0.7 - 0.32;
    P.legs[0].rotation.set(-1.45, 0, 0.35); P.legs[1].rotation.set(-1.45, 0, -0.35);
    P.arms[0].sh.rotation.set(-0.7, 0, -0.1); P.arms[1].sh.rotation.set(-0.7, 0, 0.1);
    P.torso.rotation.set(0.05, 0, 0);
    P.head.rotation.set(0.12 + Math.max(0, Math.sin(S.time * 0.7)) * 0.15, Math.sin(S.time * 0.3) * 0.2, 0);
  }
  const tentAt = (kind) => kind === 'mytent' ? S.playerTent : { x: LAYOUT.tent.x, z: LAYOUT.tent.z, ry: LAYOUT.tent.ry };
  function sleep() {
    const night = env.hour >= 18.5 || env.hour < 5;
    fadeAction(() => {
      if (night) {
        env.skipTo(6.5); S.hp = 100; S.st = 100; S.hunger = Math.max(0, S.hunger - 20); S.cold = 0;
        UI.toast(`一觉睡到天亮 · 第 ${env.day} 天（饱腹 -20）`);
      } else {
        env.skipTo((env.hour + 2) % 24); S.hp = Math.min(100, S.hp + 40); S.st = 100; S.hunger = Math.max(0, S.hunger - 8); S.cold = Math.max(0, S.cold - 0.5);
        UI.toast('小睡了两个小时（饱腹 -8）');
      }
      sfx.sleep(); saveGame('sleep');
    });
  }
  const respawnPoint = () => S.playerTent ? new THREE.Vector3(S.playerTent.x + Math.sin(S.playerTent.ry) * 2, 0, S.playerTent.z + Math.cos(S.playerTent.ry) * 2) : null;

  // ─────────── 交互项 ───────────
  function interactables(list) {
    if (S.inTent) { list.length = 0; list.push({ kind: 'sleep', x: S.pos.x, z: S.pos.z, rad: 5 }); return true; }
    const sp = !S.fish && nearestSpot();
    // 按到鱼点的距离参与排序：码头上离船更近时优先修船
    if (sp) list.push({ kind: 'fish', sp, x: sp.x, z: sp.z, rad: 5.3 });
    if (S.playerTent) list.push({ kind: 'mytent', x: S.playerTent.x, z: S.playerTent.z, rad: 2.6, bias: 1.2 });
    if (!S.flags.summit) list.push({ kind: 'summit', x: props.summit.x, z: props.summit.z, rad: 1.8 });
    if (!S.flags.bigSummit) list.push({ kind: 'bigSummit', x: props.bigSummit.x, z: props.bigSummit.z, rad: 2 });
  }
  function promptFor(it) {
    const K = '<kbd>E</kbd>';
    if (it.kind === 'fish') return S.tools.rod ? [`${K}${it.sp.kind === 'pond' ? '在水潭' : ''}钓鱼`] : ['需要钓竿（工作台）', true];
    if (it.kind === 'mytent' || it.kind === 'tent') return [`${K}钻进帐篷`];
    if (it.kind === 'sleep') return [`${K}${env.hour >= 18.5 || env.hour < 5 ? '睡到天亮' : '小睡两小时'}　<kbd>WASD</kbd>出来`];
    if (it.kind === 'summit') return [`${K}打开山顶宝箱`];
    if (it.kind === 'bigSummit') return [`${K}打开风冠山顶的宝箱`];
    return null;
  }
  function interact(it) {
    if (it.kind === 'fish') { if (S.tools.rod) startFishing(it.sp); return true; }
    if (it.kind === 'mytent' || it.kind === 'tent') { enterTent(tentAt(it.kind)); return true; }
    if (it.kind === 'sleep') { sleep(); return true; }
    if (it.kind === 'bigSummit') {
      S.flags.bigSummit = true; sfx.chest();
      const at = props.bigSummit.clone();
      burst(at.clone().setY(at.y + 1), 26, ['#ffe08a', '#6de7e2', '#ffffff'], { speed: 3, up: 6, life: 1.5, gravity: 4 });
      props.bigSummitChest.userData.parts.lid.rotation.x = -1.9;
      add('shell', 8, at); setTimeout(() => add('soup', 2, at), 200);
      UI.banner('登上风冠山！跳下去展开滑翔翼吧', 3600);
      saveGame('summit');
      return true;
    }
    if (it.kind === 'summit') {
      S.flags.summit = true; sfx.chest();
      const at = props.summit.clone();
      burst(at.clone().setY(at.y + 1), 20, ['#ffe08a', '#6de7e2', '#ffffff'], { speed: 2.5, up: 5, life: 1.3, gravity: 4 });
      props.summitChest.userData.parts.lid.rotation.x = -1.9;
      add('rope', 3, at); setTimeout(() => add('shell', 3, at), 200); setTimeout(() => add('grilledFish', 2, at), 400);
      UI.banner('登顶！整个晴帆岛都在脚下', 3200);
      saveGame('summit');
      return true;
    }
    return false;
  }

  function update(dt, inputMag) {
    updateWarmth(dt); updateCook(dt); updateFishing(dt, inputMag); updatePlace();
  }
  function serialize() { return { cold: S.cold, buffs: S.buffs, tent: S.playerTent }; }
  function load(d) {
    if (!d) return;
    S.cold = d.cold || 0; S.buffs = d.buffs || {};
    if (d.tent) buildTentAt(d.tent.x, d.tent.z, d.tent.ry, true);
    if (S.flags.summit) props.summitChest.userData.parts.lid.rotation.x = -1.9;
    if (S.flags.bigSummit) props.bigSummitChest.userData.parts.lid.rotation.x = -1.9;
  }
  return { update, statuses, staminaMul, hungerMul, startCook, interactables, promptFor, interact, fishingInput,
    togglePlace, confirmPlace, respawnPoint, serialize, load, nearFire, updateTent, tentPose, inTent: () => !!S.inTent, isFishing: () => !!S.fish, isPlacing: () => !!S.place };
}

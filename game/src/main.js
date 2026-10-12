// 《漂岛奇航》晴帆岛可玩原型：渲染、输入、玩家、敌人、潮汐、交互与任务推进。
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, TiltShiftEffect, BloomEffect, ToneMappingEffect,
  ToneMappingMode, VignetteEffect, HueSaturationEffect, BrightnessContrastEffect, KernelSize,
  PixelationEffect, DepthOfFieldEffect, NoiseEffect, ChromaticAberrationEffect, BlendFunction } from 'postprocessing';
import { buildTerrain, groundHeight, terrainHeight, onDock, nearBoat, waterLevelAt, LAYOUT, TIDE, POND, MOUNT, MAP } from './terrain.js';
import { buildWater } from './water.js';
import { buildWorld } from './world.js';
import * as M from './models.js';
import * as UI from './ui.js';
import { ITEMS, RECIPES, FOOD, BOAT_STAGES, EAT_ORDER } from './data.js';
import { createEnvironment } from './environment.js';
import { createMovement, gradAt } from './movement.js';
import { createSystems } from './systems.js';
import { createFarming } from './farming.js';
import { createGrass } from './grass.js';
import { attachHeroModel } from './heroModel.js';
import { ToonEffect } from './toon.js';
import { SanitizeEffect } from './sanitize.js';
import { waterLight } from './water.js';
import { initAudio, sfx, bgm } from './audio.js';
import { renderIcons } from './icons.js';
import { createCombatFX } from './combatfx.js';
import { createGliderTrails } from './trails.js';
import { createMinimap } from './minimap.js';
import { createFish } from './fish.js';
import { loadParrot } from './propModels.js';
renderIcons();

// ─────────────── 渲染 ───────────────
const canvas = document.querySelector('#world');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));   // 高分屏上 2× 太吃 GPU（后期效果按像素算）
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2f8f96');
scene.fog = new THREE.Fog('#5fb8bb', 70, 150);
const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 1200);

const hemi = new THREE.HemisphereLight('#dff4ff', '#b89a70', 0.95); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff0d4', 2.3);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 110 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 4;
scene.add(sun, sun.target);

const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new EffectPass(camera, new SanitizeEffect()));   // 先清掉 NaN/Inf，泛光才不会炸出黑块
// HD-2D（像素化 + 景深虚化 + 强泛光 + 暖色调 + 颗粒），H 键开关；默认是微缩玩具风
const pixel = new PixelationEffect(6);
const dof = new DepthOfFieldEffect(camera, { focusDistance: 20, focusRange: 7, bokehScale: 5, resolutionScale: 0.5 });
const hdFocus = new THREE.Vector3(); dof.target = hdFocus;
const hdPix = new EffectPass(camera, pixel), hdDof = new EffectPass(camera, dof);
composer.addPass(hdPix); composer.addPass(hdDof);
// 微缩感：宽一点的清晰带（玩法可读性优先），上下边缘渐糊；饱和度在色调映射之后再抬
const tilt = new TiltShiftEffect({ offset: 0.04, focusArea: 0.74, feather: 0.26, kernelSize: KernelSize.SMALL });
const bloom = new BloomEffect({ luminanceThreshold: 0.9, luminanceSmoothing: 0.15, intensity: 0.5, mipmapBlur: false, kernelSize: KernelSize.LARGE });
composer.addPass(new EffectPass(camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));
// 三渲二：放在色调映射之后（量化的是最终看到的亮度）
const toon = new ToonEffect();
const toonPass = new EffectPass(camera, toon); toonPass.enabled = false;
composer.addPass(toonPass);
// 调色：夕照插画感——饱和度抬高、对比略强、四角压暗
const toyPost = new EffectPass(camera, tilt,
  new HueSaturationEffect({ saturation: 0.2 }),
  new BrightnessContrastEffect({ brightness: 0.02, contrast: 0.08 }),
  new VignetteEffect({ darkness: 0.32, offset: 0.3 }));
composer.addPass(toyPost);
const hdGrade = new BrightnessContrastEffect({ brightness: 0.04, contrast: 0.04 });
const hdPost = new EffectPass(camera,
  new HueSaturationEffect({ saturation: -0.04, hue: -0.02 }), hdGrade,
  new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0009, 0.0006), radialModulation: true, modulationOffset: 0.35 }),
  new VignetteEffect({ darkness: 0.38, offset: 0.28 }),
  new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false }));
hdPost.effects.at(-1).blendMode.opacity.value = 0.18;
composer.addPass(hdPost);
const hd = { on: false };
function setToon(on) {
  toonPass.enabled = on;
  UI.setToon?.(on);
  UI.toast(on ? '三渲二：描边 + 色阶' : '普通渲染');
}
function setHD(on) {
  hd.on = on;
  hdPix.enabled = hdPost.enabled = on; toyPost.enabled = !on;
  hdDof.enabled = true;   // 景深两种画面都开：平时很轻，专注做事时加大
  // 只有最后一个启用的 pass 输出到屏幕（否则关掉的 pass 会“吞掉”整帧画面）
  toyPost.renderToScreen = !on; hdPost.renderToScreen = on;
  bloom.intensity = on ? 1.1 : 0.5; bloom.luminanceMaterial.threshold = on ? 0.72 : 0.9;
  pixel.granularity = Math.round(3 * Math.min(devicePixelRatio, 2));
  if (!cam.free) { cam.pitchTarget = THREE.MathUtils.degToRad(on ? 33 : 45); cam.dist = on ? 21 : 25; }
  motes.visible = on;
  UI.setHD?.(on);
}

// ─────────────── 世界 ───────────────
const { mesh: terrainMesh, heightTex, material: terrainMaterial } = buildTerrain(); scene.add(terrainMesh);
const water = buildWater(heightTex); scene.add(water.mesh);
const world = buildWorld(scene, heightTex);
const minimap = createMinimap(heightTex);
const { colliders, resources, props } = world;
const env = createEnvironment({ scene, hemi, sun, sfx, renderer, terrainMaterial });
env.waterLevel = (x, z) => waterLevelAt(x, z, tide.level);
// 路灯：离主角最近的 6 盏配真实点光源（地面湿了会映出光斑），其余靠自发光 + 泛光
const lampLights = Array.from({ length: 6 }, () => { const l = new THREE.PointLight('#ffb65c', 0, 13, 1.4); scene.add(l); return l; });
env.onWeather = (type) => UI.banner({ rain: '下雨了 · 找个地方烤火，别着凉', cloudy: '云多起来了', clear: '天晴了' }[type]);

// 玩家：root → roller（翻滚枢轴，在腰部） → body
const hero = M.buildHero();
hero.scale.setScalar(1.15);   // 主角略放大：俯视镜头下更醒目（碰撞半径不变）
const HP = hero.userData.parts;
const roller = new THREE.Group(); roller.position.y = 0.7; hero.add(roller);
hero.remove(HP.body); roller.add(HP.body); HP.body.position.y = -0.7;
scene.add(hero);
// 主角外观：GLB 模型（加载完成前先显示程序化模型）
let heroModel = null;
attachHeroModel(hero, HP, `${import.meta.env.BASE_URL}models/pirate-boy-anim.glb`)
  .then((m) => { heroModel = m; })
  .catch((e) => console.warn('主角模型加载失败，继续使用程序化模型', e));
const heroLamp = new THREE.PointLight('#ffc27a', 0, 9, 1.6); heroLamp.position.set(0, 2.2, 0.4); hero.add(heroLamp);
const parrot = M.buildParrot(); parrot.scale.setScalar(0.9); scene.add(parrot);
// 鹦鹉换成 GLB 模型（跟班那只 + 营地木桩上那只）；翅膀扇动走 uFlap
const parrotFlap = { value: 0 }, perchFlap = { value: 0 };
{
  const url = `${import.meta.env.BASE_URL}models/parrot.glb`;
  loadParrot(url, 0.95, parrotFlap).then((m) => {
    parrot.children.slice().forEach((c) => { if (c.isMesh) parrot.remove(c); else c.visible = false; });
    parrot.add(m);
  }).catch((e) => console.warn('鹦鹉模型加载失败', e));
  loadParrot(url, 0.7, perchFlap, { flat: false }).then((m) => {   // 木桩上那只是站着的，保持立姿
    scene.traverse((o) => { if (o.userData.parrotSlot) { const c = m.clone(); o.add(c); } });
  });
}
const ring = M.buildPlayerRing(); ring.visible = false; scene.add(ring);
// HD-2D 的空气里漂浮的光尘
const MOTES = 140, moteGeo = new THREE.BufferGeometry(), motePos = new Float32Array(MOTES * 3);
const moteSeed = Array.from({ length: MOTES }, () => [Math.random() * 40 - 20, Math.random() * 7, Math.random() * 40 - 20, Math.random() * 6]);
moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: new THREE.Color(2.2, 1.9, 1.3), size: 0.12, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
motes.frustumCulled = false; motes.visible = false; scene.add(motes);
function updateMotes() {
  if (!motes.visible) return;
  const t = S.time;
  for (let i = 0; i < MOTES; i++) {
    const [x, y, z, p] = moteSeed[i];
    motePos[i * 3] = cam.target.x + x + Math.sin(t * 0.2 + p) * 1.5;
    motePos[i * 3 + 1] = cam.target.y + 0.5 + ((y + t * 0.25) % 7);
    motePos[i * 3 + 2] = cam.target.z + z + Math.cos(t * 0.17 + p) * 1.5;
  }
  moteGeo.attributes.position.needsUpdate = true;
  motes.material.color.setRGB(2.2, 1.9, 1.3).multiplyScalar(env.nightness > 0.5 ? 0.35 : 1);
}
const RING_C = { cream: new THREE.Color('#fff6e0'), magic: new THREE.Color('#6de7e2'), coral: new THREE.Color('#e85d4a'), white: new THREE.Color('#ffffff') };
let ringPulse = 0;

// 目标标记：黄铜环 + 青色光核（任务物品配色）
const marker = M.buildShard(); marker.scale.setScalar(1.2); scene.add(marker);
marker.traverse(o => { if (o.isMesh) o.castShadow = false; });
const shardProp = M.buildShard(); shardProp.visible = false; scene.add(shardProp);

// ─────────────── 游戏状态 ───────────────
const S = {
  running: false, paused: false, ended: false, sailing: 0,
  pos: LAYOUT.spawn.clone(), vel: new THREE.Vector3(), facing: 0,
  hp: 100, st: 100, hunger: 85, stDelay: 0,
  inv: { wood: 0, stone: 0, leaf: 0, rope: 0, coconut: 1, roast: 0, shell: 0, plank: 0, sail: 0, shard: 0 },
  tools: { sword: false, axe: false },
  boatStage: 0, flags: {},
  attack: null, combo: 0, comboWindow: 0, dodge: null, act: null, invuln: 0, hurt: 0, knock: new THREE.Vector3(),
  drown: 0, hitstop: 0, shake: 0, walkPhase: 0, time: 0,
  stats: { crabs: 0, gathered: 0, deaths: 0, start: 0, fish: 0 }
};
const tide = { low: false, timer: 75, phase: 75, level: TIDE.high, from: TIDE.high, to: TIDE.high, t: 1, warned: false };
const fishes = createFish(scene, { tideLevel: () => tide.level, center: LAYOUT.camp });
const cam = { yaw: 0, yawTarget: 0, dist: 25, target: S.pos.clone(), pitch: THREE.MathUtils.degToRad(45), pitchTarget: THREE.MathUtils.degToRad(45), free: false };

// ─────────────── 椰壳蟹 ───────────────
const CRAB_SPAWNS = [
  { x: 8, z: 14, aggro: 3.5 }, { x: 15, z: 9, aggro: 3.5 },
  { x: 41, z: -1.5, aggro: 7 }, { x: 46.5, z: -5.5, aggro: 7 }, { x: 42.5, z: -8.5, aggro: 7 }
];
const crabs = CRAB_SPAWNS.map((sp, i) => {
  const obj = M.buildCrab(); scene.add(obj);
  const c = { obj, P: obj.userData.parts, home: new THREE.Vector3(sp.x, 0, sp.z), aggro: sp.aggro, i,
    pos: new THREE.Vector3(sp.x, 0, sp.z), dir: new THREE.Vector3(1, 0, 0), state: 'wander', t: 0, hp: 4, maxHp: 4, hpLag: 4, hitT: 0,
    wanderTo: new THREE.Vector3(sp.x, 0, sp.z), flash: 0, respawn: 0, angered: false, face: 0 };
  return c;
});

// ─────────────── 移动/攀爬 + 生活系统 ───────────────
let inputMag = 0;
const mv = createMovement({ S, colliders, scene, hero, HP, roller, sfx, UI, toScreen, burst, tideLevel: () => tide.level,
  inputMag: () => inputMag, hurt: (d) => fallDamage(d), drown: () => washAshore() });
// 游泳没力气：冲到最近的岸边
function washAshore() {
  fadeAction(() => {
    for (let r = 2; r < 80; r += 2) for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const x = S.pos.x + Math.cos(a) * r, z = S.pos.z + Math.sin(a) * r;
      if (depthAt(x, z) < -0.2 && gradAt(x, z).length() < 0.8) {
        S.pos.set(x, groundHeight(x, z), z); S.mode = 'walk'; S.hp = Math.max(10, S.hp - 10);
        UI.toast('游不动了，被浪冲回了岸边（生命 -10）'); return;
      }
    }
  });
}
const sys = createSystems({ S, env, scene, props, colliders, UI, sfx, add, burst, toScreen, fadeAction: (fn) => fadeAction(fn),
  saveGame: (r) => saveGame(r), hero, HP, tideLevel: () => tide.level });

const grass = createGrass(scene);
grass.warm(LAYOUT.spawn);
const farm = createFarming({ S, env, scene, colliders, UI, sfx, add, burst, toScreen, grass, saveGame: (r) => saveGame(r), tideLevel: () => tide.level });

// ─────────────── 粒子 ───────────────
const particles = [];
const vfx = createCombatFX(scene, groundHeight);
const gliderTrails = createGliderTrails(scene);
const pGeo = new THREE.SphereGeometry(0.09, 10, 8), pBox = new THREE.BoxGeometry(0.14, 0.05, 0.08);
function burst(pos, n, colors, { speed = 3, up = 3, life = 0.8, size = 1, box = false, gravity = 9 } = {}) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(box ? pBox : pGeo, M.mat(colors[i % colors.length], { rough: 0.7 }));
    m.position.copy(pos); m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
    m.castShadow = false;
    const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
    particles.push({ m, v: new THREE.Vector3(Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s), life, max: life, gravity,
      spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0) });
    scene.add(m);
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life -= dt;
    p.v.y -= p.gravity * dt; p.m.position.addScaledVector(p.v, dt);
    p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt;
    const g = groundHeight(p.m.position.x, p.m.position.z);
    if (p.m.position.y < g + 0.05) { p.m.position.y = g + 0.05; p.v.multiplyScalar(0.4); p.v.y = Math.abs(p.v.y) * 0.3; }
    p.m.scale.multiplyScalar(p.life < 0.25 ? 0.9 : 1);
    if (p.life <= 0) { scene.remove(p.m); particles.splice(i, 1); }
  }
}

// ─────────────── 输入 ───────────────
const keys = new Set();
const pressed = new Set();
addEventListener('keydown', (e) => {
  if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('wheel', (e) => { cam.dist = THREE.MathUtils.clamp(cam.dist + e.deltaY * 0.02, cam.free ? 4 : 20, cam.free ? 48 : 42); e.preventDefault(); }, { passive: false });
// 鼠标：固定视角下左键 = 攻击；自由视角下按住任意键拖拽 = 360° 转视角，左键不拖直接松开才算攻击
let mouseDown = -1, dragDist = 0;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  canvas.focus();
  mouseDown = e.button; dragDist = 0;
  if (e.button === 0 && !cam.free) pressed.add('Mouse0');
});
addEventListener('mouseup', (e) => {
  if (e.button === 0 && cam.free && mouseDown === 0 && dragDist < 6) pressed.add('Mouse0');
  mouseDown = -1;
});
addEventListener('mousemove', (e) => {
  if (mouseDown < 0 || !cam.free) return;
  dragDist += Math.abs(e.movementX) + Math.abs(e.movementY);
  cam.yawTarget -= e.movementX * 0.006;
  cam.pitchTarget = THREE.MathUtils.clamp(cam.pitchTarget + e.movementY * 0.005, -0.45, 1.53);
});
canvas.style.cursor = 'default';
function setCamMode(free, quiet) {
  cam.free = free;
  const wrap = (a) => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  canvas.style.cursor = free ? 'grab' : 'default';
  if (!free) { cam.yaw = wrap(cam.yaw); cam.yawTarget = THREE.MathUtils.clamp(wrap(cam.yawTarget), -Math.PI / 3, Math.PI / 3); cam.pitchTarget = THREE.MathUtils.degToRad(45); cam.dist = THREE.MathUtils.clamp(cam.dist, 20, 42); }
  else { cam.pitchTarget = THREE.MathUtils.degToRad(28); cam.dist = 14; }
  tilt.blendMode.opacity.value = free ? 0 : 1;
  env.viewFar = free ? 2.4 : 1;
  UI.setCamMode(free);
  if (!quiet) UI.toast(free ? '自由视角：按住鼠标拖拽 360° 转视角，滚轮缩放' : '固定俯视视角');
}
document.querySelector('#cam-toggle').addEventListener('click', () => setCamMode(!cam.free));
document.querySelector('#music').addEventListener('click', () => { bgm.next(); UI.setMusic(bgm.current(), bgm.muted()); });
addEventListener('keydown', (e) => {
  if (!S.running) return;
  if (e.code === 'KeyM') { UI.setMusic(bgm.current(), bgm.toggleMute()); UI.toast(bgm.muted() ? '音乐已关闭（M 打开）' : '音乐已打开'); }
  if (e.code === 'KeyN') { bgm.next(); UI.setMusic(bgm.current(), bgm.muted()); UI.toast(`正在播放：${bgm.current().name} — ${bgm.current().by}`); }
});
document.querySelector('#hd-toggle').addEventListener('click', () => setHD(!hd.on));
document.querySelector('#toon-toggle').addEventListener('click', () => setToon(!toonPass.enabled));
let padPrev = [], padRun = false;
function pollPad() {
  const pad = navigator.getGamepads?.()[0];
  if (!pad) return { x: 0, y: 0 };
  const map = { 0: 'Space', 1: 'KeyK', 2: 'KeyJ', 3: 'KeyE', 9: 'Tab', 4: 'KeyZ', 5: 'KeyC' };
  padRun = !!pad.buttons[7]?.pressed || !!pad.buttons[10]?.pressed;
  pad.buttons.forEach((b, i) => { if (b.pressed && !padPrev[i] && map[i]) pressed.add(map[i]); padPrev[i] = b.pressed; });
  const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
  return { x: dz(pad.axes[0]), y: -dz(pad.axes[1]) };
}
const hit = (code) => pressed.has(code);

// ─────────────── 工具函数 ───────────────
const V = new THREE.Vector3();
let canvasRect = null;   // 每帧只读一次布局（getBoundingClientRect 会强制排版，很贵）
function toScreen(p, dy = 0) {
  V.set(p.x, p.y + dy, p.z).project(camera);
  const r = canvasRect || (canvasRect = canvas.getBoundingClientRect());
  return { x: (V.x * 0.5 + 0.5) * r.width, y: (-V.y * 0.5 + 0.5) * r.height, behind: V.z > 1 };
}
function add(item, n, at) {
  S.inv[item] = (S.inv[item] || 0) + n;
  if (at) { const s = toScreen(at, 1.4); UI.floatText(`+${n} ${UI.icon(item)} ${ITEMS[item].name}`, s.x, s.y); }
}
function has(cost) { return Object.entries(cost).every(([k, n]) => (S.inv[k] || 0) >= n); }
function pay(cost) { for (const [k, n] of Object.entries(cost)) S.inv[k] -= n; }
const depthAt = (x, z) => waterLevelAt(x, z, tide.level) - groundHeight(x, z);

function walkable(x, z, curDepth, maxDepth = 0.42) {
  if (onDock(x, z)) return true;
  const h = terrainHeight(x, z);
  if (nearBoat(x, z)) return false;
  const d = waterLevelAt(x, z, tide.level) - h;
  return d < maxDepth || d < curDepth - 0.002;
}
function pushOut(p, r) {
  for (const c of colliders) {
    if (c.palm && c.res && !c.res.alive) continue;
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
    if (d < min && d > 1e-4) { p.x = c.x + dx / d * min; p.z = c.z + dz / d * min; }
  }
}
for (const r of resources) if (r.type === 'palm') { const c = colliders.find(c => c.palm && c.x === r.x && c.z === r.z); if (c) c.res = r; }
// 敌人移动：不会爬陡坡
function moveEntity(p, dx, dz, r, maxDepth) {
  const cur = depthAt(p.x, p.z);
  const ok = (x, z) => walkable(x, z, cur, maxDepth) && !(gradAt(x, z).length() > 1.0 && terrainHeight(x, z) > terrainHeight(p.x, p.z));
  if (ok(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; }
  else if (ok(p.x + dx, p.z)) p.x += dx;
  else if (ok(p.x, p.z + dz)) p.z += dz;
  pushOut(p, r);
}
const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// ─────────────── 潮汐 ───────────────
function setTide(low) {
  tide.low = low; tide.from = tide.level; tide.to = low ? TIDE.low : TIDE.high; tide.t = 0;
  tide.timer = tide.phase; tide.warned = false;
  sfx.tide();
  UI.banner(low ? '退潮了 · 东边的沙洲露出来了' : '涨潮了 · 沙洲被淹没');
  // 漂浮物抬升 / 下沉的粒子提示：沿岸冒泡
  for (let i = 0; i < 6; i++) burst(new THREE.Vector3(22 + i * 2.4, tide.level + 0.1, -0.2 - i * 0.3), 4, ['#ffffff', '#bff3ef'], { speed: 1, up: 2.5, life: 0.9, gravity: 5 });
}
function updateTide(dt) {
  tide.timer -= dt;
  if (!tide.warned && tide.timer < 8) { tide.warned = true; sfx.warn(); UI.banner(tide.low ? '针针：嘎！潮水要涨回来了！' : '针针：嘎！潮水快退了！'); }
  if (tide.timer <= 0) setTide(!tide.low);
  if (tide.t < 1) { tide.t = Math.min(1, tide.t + dt / 5); const k = tide.t * tide.t * (3 - 2 * tide.t); tide.level = tide.from + (tide.to - tide.from) * k; }
  water.uniforms.uLevel.value = tide.level;
  water.uniforms.uPulse.value = tide.timer < 8 ? 1 - tide.timer / 8 : Math.max(0, 1 - tide.t * 2) * 0.6;
  UI.setTide(tide.low, tide.timer, tide.timer < 8, (tide.level - TIDE.low) / (TIDE.high - TIDE.low));
}

// ─────────────── 交互 ───────────────
const RES_TEXT = { drift: '捡起漂流木', bush: '采集叶片', stone: '捡起石块', shell: '捡贝壳' };
function interactables() {
  const list = [];
  // 攀爬中：只有爬到棕榈树顶时能摘椰子
  if (S.mode !== 'walk') {
    const c = S.climb?.c;
    if (c?.res && S.pos.y >= c.top - 0.1) list.push({ kind: 'palmtop', r: c.res, x: S.pos.x, z: S.pos.z, rad: 1 });
    return list;
  }
  if (sys.interactables(list)) return list;
  for (const r of resources) {
    if (!r.alive) {
      if (r.type === 'palm' && r.nuts) {} else continue;
    }
    if (r.type === 'shell' && depthAt(r.x, r.z) > 0.12) continue; // 被潮水淹没
    list.push({ kind: 'res', r, x: r.x, z: r.z, rad: r.type === 'palm' ? 1.9 : 1.6 });
  }
  const push = (kind, p, rad, extra) => list.push({ kind, x: p.x, z: p.z, rad, ...extra });
  push('bench', LAYOUT.workbench, 2.2); push('fire', LAYOUT.campfire, 2.0); push('tent', LAYOUT.tent, 2.8, { bias: 1.2 });
  push('shrine', LAYOUT.shrine, 2.6); push('totem', LAYOUT.totem, 1.9);
  if (!S.flags.chest) push('chest', LAYOUT.chest, 2.0);
  // 出过海之后船不一定停在码头：交互点跟着船走
  if (S.flags.sailed) push('boat', props.boat.position, 4.2); else push('boat', LAYOUT.boatSpot, 2.6);
  return list;
}
function nearest() {
  let best = null, bd = Infinity;
  for (const it of interactables()) {
    const d = Math.hypot(S.pos.x - it.x, S.pos.z - it.z);
    if (d < it.rad && d - (it.bias || 0) < bd) { best = it; bd = d - (it.bias || 0); }
  }
  // 田地优先级最低：身边没有别的可互动东西时才轮到它
  const f = farm.interactable();
  if (f && (!best || (f.t.plot && bd > 0.9))) best = f;
  return best;
}
function promptFor(it) {
  const K = '<kbd>E</kbd>';
  if (it.kind === 'farm') return farm.promptFor(it);
  const sp = sys.promptFor(it); if (sp) return sp;
  if (it.kind === 'palmtop') return it.r.nuts ? [`${K}摘椰子`] : ['树顶的风真大（往外推跳下去）', true];
  switch (it.kind) {
    case 'res': {
      const r = it.r;
      if (r.type === 'palm') {
        if (S.tools.axe && r.alive) return [`${K}砍棕榈树 ${r.hits}/3`];
        if (r.nuts) return [`${K}摇一摇棕榈树`];
        return [`${UI.icon('axe')} 需要石斧才能砍树`, true];
      }
      return [K + RES_TEXT[r.type]];
    }
    case 'bench': return [`${K}工作台 · 制作`];
    case 'fire': return [`${K}营火 · 烹饪${sys.nearFire() ? '（正在烤火）' : ''}`];
    case 'shrine': case 'totem':
      return tide.t < 1 || tide.timer < 3.5 ? ['潮水正在变化…', true] : [`${K}推动潮汐 → ${tide.low ? '涨潮' : '退潮'}`];
    case 'chest': return [`${K}打开宝箱`];
    case 'boat': {
      if (S.boatStage >= BOAT_STAGES.length) return [S.flags.sailed ? `${K}上船` : `${K}出航！`];
      const st = BOAT_STAGES[S.boatStage];
      const need = Object.entries(st.cost).map(([k, n]) => `${UI.icon(k)}${Math.min(S.inv[k] || 0, n)}/${n}`).join(' ');
      return [`${has(st.cost) ? K : ''}${st.name}　${need}`, !has(st.cost)];
    }
  }
  return [''];
}
function interact(it) {
  const at = new THREE.Vector3(it.x, groundHeight(it.x, it.z), it.z);
  if (it.kind === 'palmtop') {
    if (it.r.nuts) { it.r.nuts = false; it.r.nutTimer = 60; it.r.obj.userData.parts.nuts.visible = false; add('coconut', 2, S.pos); sfx.pickup(); }
    return;
  }
  if (it.kind === 'farm') return farm.interact(it);
  if (sys.interact(it)) return;
  S.facing = Math.atan2(it.x - S.pos.x, it.z - S.pos.z);
  switch (it.kind) {
    case 'res': return gather(it.r, at);
    case 'bench': case 'fire': openPanel(); return;
    case 'shrine': case 'totem':
      if (tide.t < 1 || tide.timer < 3.5) return;
      tide.timer = 3; tide.warned = true; sfx.warn();
      UI.banner('潮汐神龛亮了起来……');
      burst(at.clone().setY(at.y + 1.6), 14, ['#6de7e2', '#ffffff'], { speed: 2, up: 3, life: 1.1, gravity: 1 });
      return;
    case 'chest': return openChest(at);
    case 'boat': return boatAction();
  }
}
function gather(r, at) {
  if (S.act) return;
  if (r.type === 'palm') {
    if (S.tools.axe && r.alive) {
      S.act = { type: 'chop', t: 0, dur: 0.42, fired: false, r };
    } else if (r.nuts) {
      S.act = { type: 'shake', t: 0, dur: 0.5, fired: false, r };
    } else return;
    return;
  }
  S.act = { type: 'pick', t: 0, dur: 0.35, fired: false, r };
}
function resolveAct(a) {
  const r = a.r, at = new THREE.Vector3(r.x, groundHeight(r.x, r.z), r.z);
  S.stats.gathered++;
  if (a.type === 'chop') {
    r.hits++; r.shakeT = 0.4; sfx.chop();
    burst(at.clone().setY(at.y + 1), 6, ['#c9a06a', '#86603a'], { box: true, speed: 2.5, up: 3, life: 0.7 });
    if (r.hits >= 3) {
      r.alive = false; r.hits = 0; r.respawn = 70; r.obj.visible = false; r.stump.visible = true;
      add('wood', 3, at); setTimeout(() => add('leaf', 2, at), 180);
      if (r.nuts) { r.nuts = false; setTimeout(() => add('coconut', 1, at), 360); }
      burst(at.clone().setY(at.y + 2), 14, ['#4f9a55', '#6fb45a', '#86603a'], { box: true, speed: 3.5, up: 4, life: 1 });
      sfx.pickup();
    }
    return;
  }
  if (a.type === 'shake') {
    r.shakeT = 0.6; r.nuts = false; r.nutTimer = 60; r.obj.userData.parts.nuts.visible = false; sfx.chop();
    add('coconut', 1, at); sfx.pickup();
    burst(at.clone().setY(at.y + 4), 6, ['#4f9a55', '#6fb45a'], { box: true, speed: 1.5, up: 1, life: 1.2, gravity: 4 });
    return;
  }
  const give = { drift: ['wood', 2], bush: ['leaf', 3], stone: ['stone', 1], shell: ['shell', 1] }[r.type];
  add(give[0], give[1], at); sfx.pickup();
  if (r.type === 'bush' && Math.random() < 0.35) { const sd = ['seedPotato', 'seedTomato', 'seedMelon'][Math.floor(Math.random() * 3)]; setTimeout(() => add(sd, 1, at), 250); }
  if (r.type === 'bush') { r.respawn = 40; burst(at.clone().setY(at.y + 0.6), 8, ['#4f9a55', '#79c06a'], { box: true, speed: 2, up: 2.5, life: 0.8 }); r.obj.scale.multiplyScalar(0.55); }
  else { r.respawn = r.type === 'shell' ? 50 : 45; r.obj.visible = false; burst(at.clone().setY(at.y + 0.2), 5, ['#eacb8f', '#ffffff'], { speed: 1.5, up: 2, life: 0.5 }); }
  r.alive = false;
}
function updateResources(dt) {
  for (const t of props.roundTrees) fadePalm(t, dt);
  for (const r of resources) {
    if (r.shakeT > 0) { r.shakeT -= dt; r.obj.rotation.z = Math.sin(r.shakeT * 40) * 0.05 * r.shakeT; }
    if (r.type === 'palm') {
      r.obj.userData.parts.crown.rotation.z = Math.sin(S.time * 0.9 + r.sway) * 0.04;
      fadePalm(r, dt);
      if (!r.nuts && r.alive && (r.nutTimer -= dt) <= 0) { r.nuts = true; r.obj.userData.parts.nuts.visible = true; }
    }
    if (r.type === 'shell') r.obj.visible = r.alive; // 水下的贝壳依然看得见，只是捡不到
    if (r.alive) continue;
    if ((r.respawn -= dt) <= 0) {
      r.alive = true;
      if (r.type === 'palm') { r.obj.visible = true; r.stump.visible = false; r.nuts = true; r.obj.userData.parts.nuts.visible = true; r.obj.scale.multiplyScalar(1); }
      else if (r.type === 'bush') r.obj.scale.divideScalar(0.55);
      else r.obj.visible = true;
    }
  }
}
// 树冠挡住主角（在镜头与主角之间、屏幕上重叠）时淡出
const crownPos = new THREE.Vector3();
function fadePalm(r, dt) {
  let target = 1;
  const far = r.obj.position.distanceToSquared(S.pos) > 22 * 22;
  if (far && r.fade === 1) return;
  if (r.alive !== false && !far) {
    r.obj.userData.parts.crown.getWorldPosition(crownPos);
    if (crownPos.distanceTo(camera.position) < S.pos.distanceTo(camera.position)) {
      const a = toScreen(crownPos), b = toScreen(S.pos, 0.9);
      if (Math.hypot(a.x - b.x, a.y - b.y) < innerHeight * 0.14) target = 0.28;
    }
  }
  if (Math.abs(r.fade - target) < 0.01 && r.fade === target) return;
  r.fade += (target - r.fade) * Math.min(1, dt * 8 + 0.02);
  if (Math.abs(r.fade - target) < 0.01) r.fade = target;
  for (const m of r.fadeMats) { m.opacity = r.fade; m.transparent = r.fade < 0.99; m.depthWrite = r.fade >= 0.99; }
}
function openChest(at) {
  const guards = S.test ? [] : crabs.filter(c => c.i >= 2 && c.state !== 'dead' && c.pos.distanceTo(at) < 9);
  if (guards.length) { UI.toast(`还有 ${guards.length} 只椰壳蟹守着宝箱！`); sfx.telegraph(); guards.forEach(c => (c.angered = true)); return; }
  S.flags.chest = true; sfx.chest();
  const P = props.chest.userData.parts;
  P.glow.intensity = 6; S.chestAnim = 0;
  shardProp.visible = true; shardProp.position.set(at.x, at.y + 0.8, at.z);
  UI.banner('找到了罗盘碎片！黄铜环里有青光在转');
  setTimeout(() => emote('heart_pose'), 1500);
  burst(at.clone().setY(at.y + 1), 22, ['#6de7e2', '#c7923e', '#ffffff'], { speed: 2.5, up: 5, life: 1.4, gravity: 4 });
  setTimeout(() => { add('shard', 1, at); add('shell', 2, at); shardProp.visible = false; saveGame('chest'); }, 1400);
}
function boatAction() {
  if (S.boatStage >= BOAT_STAGES.length) return startSailing();
  const st = BOAT_STAGES[S.boatStage];
  if (!has(st.cost)) { UI.toast(`${st.name}还缺材料`); return; }
  pay(st.cost); S.boatStage++; sfx.craft();
  applyBoatStage(); saveGame('boat');
  const bp = props.boat.position;
  burst(new THREE.Vector3(bp.x, bp.y + 1, bp.z), 20, ['#c9a06a', '#ffffff', '#6de7e2'], { box: true, speed: 3, up: 4, life: 1.2 });
  setTimeout(() => emote('heart_pose'), 300);
  UI.banner(['船壳补好了！不再进水', '桅杆和补丁帆竖起来了！', '罗盘装好了，指针在转……可以出航了！'][S.boatStage - 1], 3200);
}
function applyBoatStage() {
  const P = props.boat.userData.parts;
  P.hole.visible = S.boatStage < 1; P.patches.visible = S.boatStage >= 1;
  P.brokenMast.visible = S.boatStage < 2; P.rig.visible = S.boatStage >= 2;
  P.compass.visible = S.boatStage >= 3;
}
function startSailing() {
  if (S.sailing) return;
  S.sailing = 0.001; sfx.sail(); UI.setPrompt(null); boatV.speed = 0;
  S.attack = null; S.act = null; S.mode = 'walk';
  UI.banner(S.flags.sailed ? '上船！WASD 掌舵，Shift 满帆' : '起锚，扬帆！', 3000);
}

// ─────────────── 制作 ───────────────
function nearStations() {
  return { bench: S.pos.distanceTo(V.set(LAYOUT.workbench.x, S.pos.y, LAYOUT.workbench.z)) < 3.6,
    fire: sys.nearFire() };
}
// 测试模式：不看工作站、不扣材料
const canCraft = (r) => (S.test || ((!r.station || nearStations()[r.station]) && has(r.cost))) && !(r.once && S.tools[r.out]) && !(r.cook && S.cook);
function grantAll() {
  for (const k of Object.keys(ITEMS)) { if (ITEMS[k].tool) S.tools[k] = true; else S.inv[k] = k === 'shard' ? 1 : 99; }
}
function craft(id) {
  const r = RECIPES.find(x => x.id === id);
  if (!canCraft(r)) return;
  if (r.cook) { if (!S.test) pay(r.cost); sys.startCook(r); UI.toast(`${ITEMS[r.out].name}架上火了，${r.cook} 秒后烤好`); renderPanel(true); return; }
  if (!S.test) pay(r.cost);
  sfx.craft();
  if (ITEMS[r.out].tool) { S.tools[r.out] = true; UI.banner(`做好了 ${ITEMS[r.out].name}！`); }
  else add(r.out, r.n, S.pos);
  saveGame('craft');
  renderPanel();
}
function eat(k) {
  if (!S.inv[k] || !FOOD[k]) return;
  S.inv[k]--; S.hunger = Math.min(100, S.hunger + FOOD[k].hunger); S.hp = Math.min(100, S.hp + FOOD[k].hp);
  const stGain = FOOD[k].st ?? Math.round(FOOD[k].hunger * 0.8);
  S.st = Math.min(100, S.st + stGain); if (S.st >= 35) S.exhausted = false;
  if (FOOD[k].buff) { const [b, t] = FOOD[k].buff; S.buffs[b] = t; if (b === 'warm') S.cold = 0; }
  sfx.eat(); const s = toScreen(S.pos, 2); UI.floatText(`${UI.icon(k)} 饱腹 +${FOOD[k].hunger} · 体力 +${stGain}`, s.x, s.y, '#ffe08a');
  if (UI.panelOpen()) renderPanel();
}
// 只在背包或附近工作站变化时重绘，避免点击途中 DOM 被替换
let panelSig = '';
function renderPanel(force) {
  const near = nearStations(), sig = JSON.stringify([S.inv, S.tools, near, !!S.cook]);
  if (!force && sig === panelSig) return;
  panelSig = sig; UI.renderPanel(S, near, canCraft, craft, eat);
}
function openPanel() { UI.togglePanel(true); renderPanel(true); }

// ─────────────── 任务 ───────────────
function questSteps() {
  const f = S.flags, inv = S.inv;
  if (inv.wood >= 3 && inv.leaf >= 3) f.s1 = true;
  if (S.pos.x > 36) f.islet = true;
  const nearestRes = (types) => {
    let best = null, bd = Infinity;
    for (const r of resources) if (r.alive && types.includes(r.type)) { const d = Math.hypot(r.x - S.pos.x, r.z - S.pos.z); if (d < bd) { bd = d; best = r; } }
    return best;
  };
  const bench = LAYOUT.workbench, boat = LAYOUT.boatSpot;
  return [
    { done: f.s1 || S.tools.sword, text: '在海滩收集木材和叶片', sub: `🪵 ${inv.wood}/3　🍃 ${inv.leaf}/3　（叶片来自灌木，木材来自漂流木）`, target: nearestRes(inv.wood < 3 ? ['drift'] : ['bush']) },
    { done: S.tools.sword, text: '在工作台做一把木弯刀', sub: 'Tab 打开制作：先把叶片搓成绳子', target: bench },
    { done: S.tools.axe, text: '捡两块石头，做一把石斧', sub: `🪨 ${inv.stone}/2　石斧能砍棕榈树`, target: inv.stone < 2 ? nearestRes(['stone']) : bench },
    { done: S.boatStage >= 1, text: '做 4 块木板，修补船壳', sub: `🟫 ${inv.plank}/4　➰ ${inv.rope}/1　砍树拿木材，去码头的船边修`, target: inv.plank >= 4 ? boat : (inv.wood >= 3 ? bench : nearestRes(['palm', 'drift'])) },
    { done: f.islet || f.chest, text: '让潮水退去，穿过东边的沙洲', sub: tide.low ? '沙洲露出来了，快过去！' : '去潮汐神龛推动潮汐，或等它自己退', target: tide.low ? LAYOUT.islet : LAYOUT.shrine },
    { done: f.chest, text: '赶走椰壳蟹，打开遗迹里的宝箱', sub: '看到蟹举钳发红就闪避（空格）', target: LAYOUT.chest },
    { done: S.boatStage >= 2, text: '做补丁帆，竖起桅杆', sub: `🐚 ${inv.shell}/2　🍃 ${inv.leaf}/4　➰ ${inv.rope}/2（帆 + 装帆各 1 根）`, target: inv.sail ? boat : (inv.shell < 2 ? nearestRes(['shell']) : bench) },
    { done: S.boatStage >= 3, text: '装上罗盘碎片，出航！', sub: '回到码头', target: boat }
  ];
}
let questTarget = null;
function updateQuest() {
  const steps = questSteps();
  let nowIdx = steps.findIndex(s => !s.done);
  if (S.boatStage >= 3) nowIdx = -1;
  UI.setQuest(steps.map((s, i) => ({ text: s.text, sub: s.sub, state: s.done ? 'done' : i === nowIdx ? 'now' : 'later' }))
    .concat(nowIdx === -1 ? [{ text: '一切就绪，去码头上船出航', state: 'now' }] : []));
  const t = nowIdx === -1 ? LAYOUT.boatSpot : steps[nowIdx].target;
  questTarget = t ? new THREE.Vector3(t.x, groundHeight(t.x, t.z), t.z) : null;
}

// ─────────────── 玩家 ───────────────
function fallDamage(dmg) {
  S.hp -= dmg; S.hurt = 0.5; S.shake = 0.3; sfx.hurt();
  const s = toScreen(S.pos, 2); UI.floatText(`-${dmg}`, s.x, s.y, '#ff8a7a');
  if (S.hp <= 0) die();
}
function hurtPlayer(dmg, from) {
  if (S.invuln > 0 || S.dodge) return;
  if (S.mode === 'climb') mv.startFall();
  S.hp -= dmg; S.invuln = 0.9; S.hurt = 0.5; S.shake = 0.35; S.hitstop = 0.07;
  vfx.hurt(S.pos.clone().setY(S.pos.y + 1));
  S.knock.set(S.pos.x - from.x, 0, S.pos.z - from.z).normalize().multiplyScalar(9);
  S.attack = null; S.act = null;
  sfx.hurt();
  const s = toScreen(S.pos, 2); UI.floatText(`-${dmg}`, s.x, s.y, '#ff8a7a');
  if (S.hp <= 0) die();
}
function die() {
  S.stats.deaths++;
  fadeAction(() => {
    const lost = [];
    for (const k of ['wood', 'stone', 'leaf', 'coconut']) { const n = Math.floor(S.inv[k] / 2); if (n) { S.inv[k] -= n; lost.push(`${ITEMS[k].name}×${n}`); } }
    S.hp = 70; S.st = 100; S.pos.copy(sys.respawnPoint() || LAYOUT.spawn); S.pos.y = groundHeight(S.pos.x, S.pos.z); S.vel.set(0, 0, 0);
    S.mode = 'walk'; S.exhausted = false; S.onTop = null;
    UI.toast(`洛可在营地醒来。${lost.length ? '丢了 ' + lost.join('、') : '什么也没丢'}`);
  });
}
let fading = false;
function fadeAction(fn) {
  if (fading) return; fading = true; UI.fade(true);
  setTimeout(() => { fn(); UI.fade(false); setTimeout(() => (fading = false), 600); }, 650);
}

function updatePlayer(dt, move) {
  const P = HP;
  S.invuln = Math.max(0, S.invuln - dt); S.hurt = Math.max(0, S.hurt - dt);
  S.comboWindow = Math.max(0, S.comboWindow - dt);
  // 状态衰减（着凉：饿得快、体力回得慢；蟹钳：体力回得快）
  S.hunger = Math.max(0, S.hunger - dt * 100 / 480 * sys.hungerMul());
  S.stDelay -= dt;
  // 体力自然恢复：只要没在消耗（跑、爬、滑翔、游动）就回；站着不动回得快，帐篷里最快
  const idle = inputMag < 0.05;
  const draining = S.sprint || S.mode === 'climb' || S.mode === 'glide' || (S.mode === 'swim' && !idle) || S.dodge;
  if (S.stDelay <= 0 && !draining) {
    const rate = S.inTent ? 45 : idle ? 20 : 12;
    S.st = Math.min(100, S.st + dt * rate * sys.staminaMul());
  }

  // 输入 → 世界方向（相对镜头）
  const fwd = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  const want = new THREE.Vector3().addScaledVector(right, move.x).addScaledVector(fwd, move.y);
  if (want.lengthSq() > 1) want.normalize();

  // 攻击
  const busy = S.mode !== 'walk' || S.fish || S.place;
  if ((hit('KeyJ') || hit('Mouse0')) && !S.dodge && !S.act && !busy) {
    if (!S.attack && S.st >= 6) startAttack();
    else if (S.attack && S.attack.t > S.attack.dur * 0.45) S.attack.queued = true;
  }
  if ((hit('KeyK') || hit('ControlLeft')) && !S.dodge && S.st >= 20 && !S.exhausted && S.mode === 'walk') {
    const dir = want.lengthSq() > 0.01 ? want.clone().normalize() : new THREE.Vector3(Math.sin(S.facing), 0, Math.cos(S.facing));
    S.dodge = { t: 0, dur: 0.42, dir }; S.attack = null; S.act = null; S.st -= 14; S.stDelay = 0.5;
    S.facing = Math.atan2(dir.x, dir.z); sfx.dodge();
    burst(S.pos.clone().setY(S.pos.y + 0.1), 5, ['#f3dcaa', '#ffffff'], { speed: 1.5, up: 1, life: 0.5 });
  }

  let speed = 1;
  if (S.attack) speed *= 0.25;
  if (S.act || S.fish) speed = 0;
  // 翻滚/击退作为额外位移交给移动系统（它负责走路、攀爬、下落）
  const extra = new THREE.Vector3();
  if (S.dodge) {
    S.dodge.t += dt;
    const k = 1 - S.dodge.t / S.dodge.dur;
    extra.copy(S.dodge.dir).multiplyScalar(13 * Math.max(0.2, k) * dt);
    if (S.dodge.t >= S.dodge.dur) { S.dodge = null; S.invuln = Math.max(S.invuln, 0.1); }
  }
  extra.addScaledVector(S.knock, dt); S.knock.multiplyScalar(Math.exp(-dt * 9));
  const jump = hit('Space') && !S.fish && !S.place && !S.dodge;
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight') || padRun;
  const inTent = sys.updateTent(dt, inputMag, hit('Space'));
  const planarClimb = inTent ? 0 : mv.update(dt, S.dodge ? new THREE.Vector3() : want, { jump, run }, speed, extra);

  // 朝向
  const planar = S.inTent ? 0 : S.mode === 'walk' ? Math.hypot(S.vel.x, S.vel.z) : planarClimb;
  if (planar > 0.4 && !S.attack && !S.dodge && S.mode === 'walk') S.facing = angleLerp(S.facing, Math.atan2(S.vel.x, S.vel.z), 1 - Math.exp(-dt * 14));
  // 游泳：身体也转向游动方向（比走路转得慢一点，有划水转身的感觉）
  if (planar > 0.3 && S.mode === 'swim') S.facing = angleLerp(S.facing, Math.atan2(S.vel.x, S.vel.z), 1 - Math.exp(-dt * 6));

  // 动作：采集 / 砍树 / 摇树
  if (S.act) {
    S.act.t += dt;
    if (!S.act.fired && S.act.t > S.act.dur * 0.55) { S.act.fired = true; resolveAct(S.act); }
    if (S.act.t >= S.act.dur) S.act = null;
  }
  // 攻击推进
  if (S.attack) {
    const a = S.attack; a.t += dt;
    if (!a.fx && a.t > a.dur * 0.33) {
      a.fx = true;
      vfx.slash(S.pos.clone().setY(S.pos.y + (a.step === 1 ? 0.95 : 1.05)), S.facing, { vertical: a.step !== 1, heavy: a.step === 2, dir: -1, tilt: a.step === 2 ? -0.5 : 0.75 });
    }
    if (!a.hitDone && a.t > a.dur * 0.42) { a.hitDone = true; resolveHit(a); }
    if (a.t >= a.dur) {
      S.attack = null; S.comboWindow = 0.35;
      if (a.queued && S.st >= 6) startAttack();
    }
  }

  // ── 动画 ──
  hero.position.copy(S.pos);
  hero.rotation.y = S.facing;
  // 跑步：步频更高、摆腿摆臂更大、身体前倾、起伏更明显（runK 0→1 平滑过渡）
  S.runK = (S.runK || 0) + (((S.sprint && S.mode === 'walk' && planar > 4) ? 1 : 0) - (S.runK || 0)) * Math.min(1, dt * 8);
  const runK = S.runK;
  S.walkPhase += dt * planar * (2.3 - runK * 0.35);
  const sw = Math.sin(S.walkPhase), moving = Math.min(1, planar / 4);
  // 模型自带的走/跑动作：地面上移动、没在干别的事时接管全身；其余时候交回木偶驱动
  const locoOk = S.mode === 'walk' && !S.attack && !S.act && !S.dodge && !S.inTent && !S.fish && !S.exhausted && S.hp > 0;
  const locoT = locoOk ? THREE.MathUtils.smoothstep(planar, 0.3, 1.6) : 0;
  S.locoW = (S.locoW || 0) + (locoT - (S.locoW || 0)) * Math.min(1, dt * (locoT > (S.locoW || 0) ? 10 : 14));
  S.planar = planar;
  const legAmp = 0.7 + runK * 0.45;
  // 整个旋转都重设：帐篷里的盘腿坐姿会给腿加侧向旋转（z），只设 x 的话出帐篷后两只脚会并到中间
  P.legs[0].rotation.set(sw * legAmp * moving, 0, 0); P.legs[1].rotation.set(-sw * legAmp * moving, 0, 0);
  const noLoco = 1 - S.locoW;   // 动作片段自己有起伏，木偶的弹跳和挤压就淡掉
  P.body.position.y = -0.7 + Math.abs(Math.cos(S.walkPhase)) * (0.07 + runK * 0.09) * moving * noLoco + Math.sin(S.time * 2.2) * 0.008;
  const squash = 1 + Math.sin(S.walkPhase * 2) * 0.03 * moving * noLoco;
  P.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
  P.torso.rotation.set(moving * (0.12 + runK * 0.28), Math.sin(S.walkPhase) * 0.12 * runK, 0);
  P.head.rotation.set(-moving * 0.05, 0, Math.sin(S.walkPhase) * 0.05 * moving);
  P.tails.forEach((t, i) => (t.rotation.x = 0.35 + moving * 0.5 + Math.sin(S.time * 7 + i) * 0.1 * (0.3 + moving)));
  const [L, R] = P.arms;
  const armAmp = 0.6 + runK * 0.55;
  L.sh.rotation.set(-sw * armAmp * moving - runK * 0.25, 0, -0.1 - runK * 0.12); R.sh.rotation.set(sw * armAmp * moving - runK * 0.25, 0, 0.1 + runK * 0.12);
  // 眨眼
  const blink = (S.time % 3.7) < 0.12 ? 0.15 : 1; P.eyes.forEach(e => (e.scale.y = 1.05 * blink));
  roller.rotation.set(0, 0, 0);
  // 战斗状态：挥刀、受伤、附近有蟹在追/蓄力/扑咬时拔刀；脱离战斗 2 秒后收刀
  const threat = crabs.some(c => c.state !== 'dead' && ['chase', 'windup', 'lunge', 'recover'].includes(c.state) && c.pos.distanceTo(S.pos) < 10);
  if (S.attack || S.hurt > 0 || threat) S.combatT = 2;
  S.combatT = Math.max(0, (S.combatT || 0) - dt);
  P.sword.visible = S.tools.sword && S.combatT > 0 && !(S.act?.type === 'chop') && !S.inTent && S.mode === 'walk';
  P.axe.visible = S.act?.type === 'chop';
  if (S.attack || S.act?.type === 'chop') {
    const a = S.attack || S.act, p = a.t / a.dur, step2 = S.attack?.step === 1;
    const wind = p < 0.35 ? p / 0.35 : 1, swing = p < 0.35 ? 0 : Math.min(1, (p - 0.35) / 0.25);
    const ease = 1 - Math.pow(1 - swing, 3);
    if (step2) { // 横扫
      R.sh.rotation.set(-1.5, 0, 0.1); R.sh.rotation.y = 1.3 * wind - 2.6 * ease;
      P.torso.rotation.y = 0.5 * wind - 1.0 * ease;
    } else { // 下劈（第三击更大）
      const big = S.attack?.step === 2 ? 1.25 : 1;
      R.sh.rotation.x = -2.8 * wind * big + 2.9 * ease * big; P.torso.rotation.x = -0.2 * wind + 0.45 * ease;
      P.body.scale.set(1 + 0.08 * ease, 1 - 0.08 * ease, 1 + 0.08 * ease);
    }
  } else if (S.act) {
    const p = S.act.t / S.act.dur, k = Math.sin(p * Math.PI);
    P.torso.rotation.x = 0.55 * k; P.head.rotation.x = 0.3 * k;
    R.sh.rotation.x = -1.3 * k; L.sh.rotation.x = -1.1 * k;
    if (S.act.type === 'shake') { R.sh.rotation.x = -2.6 * k; L.sh.rotation.x = -2.6 * k; P.torso.rotation.x = -0.1; }
  }
  if (S.dodge) { roller.rotation.x = (S.dodge.t / S.dodge.dur) * Math.PI * 2; P.body.scale.set(1.1, 0.85, 1.1); }
  mv.animate(dt);
  sys.tentPose();
  // 着凉发抖
  if (S.cold > 0.5 && S.mode === 'walk' && !sys.nearFire()) P.body.position.x = Math.sin(S.time * 45) * 0.012 * S.cold;
  // 受伤闪烁
  hero.visible = !(S.invuln > 0 && S.hurt > 0 && Math.floor(S.time * 20) % 2 === 0);
  UI.hurtFlash(S.hurt * 1.6 + (S.hp < 30 ? 0.25 + Math.sin(S.time * 4) * 0.1 : 0));
}

// ─────────────── 模型动作片段（覆盖层）───────────────
// 游泳 / 翻滚 / 帐篷里坐着 / 船上坐着（第一次出航挥手告别）/ 比心（庆祝、站久了、G 键）
// 选中的片段权重淡入，木偶那边对应的整体翻转（游泳前倾、翻滚打圈）按权重淡出，免得转两次。
const CLIP_BODY_Y = { sit: -0.35, wave_goodbye_01: -0.35, swim: 0.33 };   // 坐下时身体整体下沉（米）
function emote(name = 'heart_pose') {
  if (!heroModel?.has(name) || S.sailing || S.mode !== 'walk' || S.attack || S.dodge || S.inTent) return;
  S.emote = { name, t: 0 };
}
let idleT = 0;
function updateHeroClips(dt) {
  const moving = (S.planar || 0) > 0.3 || inputMag > 0.05;
  if (S.emote && (moving || S.attack || S.dodge || S.act || S.mode !== 'walk' || S.emote.t > heroModel.duration(S.emote.name) - 0.2)) S.emote = null;
  idleT = S.running && !S.sailing && S.mode === 'walk' && !moving && !S.attack && !S.act && !S.inTent && !S.fish ? idleT + dt : 0;
  if (idleT > 14) { idleT = -6; emote('heart_pose'); }   // 站久了自己比个心

  let want = null, time = 0;
  S.clipT ||= {};
  const loop = (n, rate = 1) => { S.clipT[n] = ((S.clipT[n] || 0) + dt * rate) % heroModel.duration(n); return S.clipT[n]; };
    if (S.sailing) {
    const wave = !S.flags.sailed && inputMag < 0.05;
    want = wave ? 'wave_goodbye_01' : 'sit'; time = loop(want);
  } else if (S.inTent) { want = 'sit'; time = loop('sit'); }
  else if (S.dodge) {   // 翻滚：取 dive 里“扑出去 → 前滚 → 起身”那一段，按翻滚进度播放
    want = 'dive'; time = heroModel.duration('dive') * (0.40 + 0.43 * Math.min(1, S.dodge.t / S.dodge.dur));
  } else if (S.mode === 'climb' && S.climb?.kind === 'terrain' && heroModel.has('run_upstairs')) {
    // 爬山：用上楼梯的高抬腿动作，停下时定格；爬树 / 爬石头还是原来的攀爬动作
    want = 'run_upstairs'; time = loop('run_upstairs', inputMag > 0.05 ? (S.sprint ? 1.6 : 1.1) : 0);
  } else if (S.mode === 'swim') { want = 'swim'; time = loop('swim', 0.45 + Math.min(1, (S.planar || 0) / 3) * (S.sprint ? 1.3 : 0.9)); }
  else if (S.emote) { S.emote.t += dt; want = S.emote.name; time = S.emote.t; }
  if (want && !heroModel.has(want)) want = null;

  // 权重：翻滚要立刻接管，其余 0.2 秒左右淡入淡出
  const tgt = want ? 1 : 0, rate = want === 'dive' ? 30 : 7;
  if (want) S.over = { name: want, time, w: S.over?.name === want ? S.over.w : 0 };
  if (S.over) {
    S.over.w += (tgt - S.over.w) * Math.min(1, dt * rate);
    if (!want && S.over.w < 0.01) S.over = null;
  }
  const w = S.over?.w || 0, name = S.over?.name;
  // 木偶的整体翻转/下沉淡出，换成片段自己的姿势
  if (name === 'swim' || name === 'dive') { roller.rotation.x *= 1 - w; HP.body.scale.lerp(V.set(1, 1, 1), w); }
  // 爬山时身体只保留一点贴坡的前倾（动作本身已经前倾），汗珠抖动之类的位移清掉
  if (name === 'run_upstairs') { roller.rotation.x *= 1 - w * 0.75; HP.body.position.x *= 1 - w; }
  // 船上坐在船尾的横板上（比甲板高一截），不然船舷会把人挡住
  if (name in CLIP_BODY_Y) HP.body.position.y = THREE.MathUtils.lerp(HP.body.position.y, -0.7 + (S.sailing ? 0.05 : S.inTent ? -0.08 : CLIP_BODY_Y[name]), w);   // 帐篷里坐在床沿，双脚踩地

  // 上坡：地面上跑动、沿着移动方向地势抬升时，换成上楼梯那种高抬腿的跑法
  let upT = 0;
  if (S.mode === 'walk' && (S.planar || 0) > 2.5) {
    const vx = S.vel.x / S.planar, vz = S.vel.z / S.planar;
    const rise = (groundHeight(S.pos.x + vx * 0.8, S.pos.z + vz * 0.8) - groundHeight(S.pos.x, S.pos.z)) / 0.8;
    upT = THREE.MathUtils.smoothstep(rise, 0.18, 0.4);
  }
  S.upK = (S.upK || 0) + (upT - (S.upK || 0)) * Math.min(1, dt * 6);
}

function startAttack() {
  const step = S.comboWindow > 0 ? (S.combo + 1) % 3 : 0;
  S.combo = step; S.st -= 4; S.stDelay = 0.4;
  S.attack = { t: 0, dur: step === 2 ? 0.46 : 0.3, step, hitDone: false, queued: false };
  // 自动朝向最近的敌人（俯视角辅助瞄准）
  let best = null, bd = 3.2;
  for (const c of crabs) if (c.state !== 'dead') { const d = c.pos.distanceTo(S.pos); if (d < bd) { bd = d; best = c; } }
  if (best) S.facing = Math.atan2(best.pos.x - S.pos.x, best.pos.z - S.pos.z);
  sfx.swing();
}
function resolveHit(a) {
  const range = S.tools.sword ? 1.9 : 1.25, dmg = (S.tools.sword ? 1 : 0.5) * (a.step === 2 ? 2 : 1);
  const fx = Math.sin(S.facing), fz = Math.cos(S.facing);
  let landed = false;
  for (const c of crabs) {
    if (c.state === 'dead') continue;
    const dx = c.pos.x - S.pos.x, dz = c.pos.z - S.pos.z, d = Math.hypot(dx, dz);
    if (d > range + 0.5 || (dx * fx + dz * fz) / (d || 1) < 0.25) continue;
    landed = true;
    c.hp -= dmg; c.flash = 1; c.angered = true; c.hitT = 4;
    const k = a.step === 2 ? 7 : 4; c.knock = new THREE.Vector3(dx / d * k, 0, dz / d * k);
    if (c.state === 'windup') { c.state = 'recover'; c.t = 0; vfx.cancelWarn(c.warnFx); } // 打断蓄力
    const hp = c.pos.clone().setY(c.pos.y + 0.6);
    vfx.hit(hp, a.step === 2);
    burst(hp, 7, ['#ffffff', '#efe0bf', '#7a4b2a'], { speed: 3, up: 3, life: 0.5 });
    if (a.step === 2) { const s = toScreen(hp, 0.6); UI.floatText('重击！', s.x, s.y, '#fff'); }
    if (c.hp <= 0) killCrab(c);
  }
  if (landed) { ringPulse = 1; sfx.hit(); S.hitstop = a.step === 2 ? 0.1 : 0.06; S.shake = a.step === 2 ? 0.25 : 0.12; }
}
function killCrab(c) {
  c.state = 'dead'; c.t = 0; c.respawn = 75; S.stats.crabs++; vfx.cancelWarn(c.warnFx);
  sfx.crabPop();
  const p = c.pos.clone().setY(c.pos.y + 0.5);
  vfx.kill(p);
  burst(p, 16, ['#7a4b2a', '#5c3820', '#efe0bf', '#d9432f'], { box: true, speed: 4, up: 5, life: 1.1 });
  burst(p, 10, ['#ffffff', '#dff7f5'], { speed: 2, up: 3, life: 0.8, gravity: 2 });
  add('shell', 1, c.pos);
  if (Math.random() < 0.6) setTimeout(() => add('claw', 1, c.pos), 200);
}

// ─────────────── 椰壳蟹 AI ───────────────
function updateCrabs(dt) {
  for (const c of crabs) {
    const P = c.P;
    c.flash = Math.max(0, c.flash - dt * 5);
    for (const m of P.flashMats) { m.emissive.setRGB(c.flash, c.flash, c.flash); m.emissiveIntensity = 1; }
    if (c.state === 'dead') {
      c.t += dt;
      const k = Math.max(0, 1 - c.t * 4); c.obj.scale.setScalar(k * (1 + (1 - k) * 0.6));
      c.obj.visible = k > 0.01;
      if ((c.respawn -= dt) <= 0 && c.pos.distanceTo(S.pos) > 12) {
        c.state = 'wander'; c.hp = 4; c.hpLag = 4; c.pos.copy(c.home); c.obj.visible = true; c.obj.scale.setScalar(1); c.angered = false;
      }
      continue;
    }
    c.t += dt;
    const toP = new THREE.Vector3(S.pos.x - c.pos.x, 0, S.pos.z - c.pos.z), dist = toP.length();
    const fromHome = Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.z);
    let vx = 0, vz = 0, speed = 0;
    const alert = (dist < c.aggro || c.angered) && S.hp > 0 && !S.sailing;
    if (c.state === 'wander') {
      if (c.t > 3 + (c.i % 3)) { c.t = 0; const a = Math.random() * Math.PI * 2; c.wanderTo.set(c.home.x + Math.cos(a) * 3, 0, c.home.z + Math.sin(a) * 3); }
      const d = new THREE.Vector3(c.wanderTo.x - c.pos.x, 0, c.wanderTo.z - c.pos.z);
      if (d.length() > 0.3) { d.normalize(); vx = d.x; vz = d.z; speed = 1.3; }
      if (alert) { c.state = 'chase'; c.t = 0; sfx.telegraph(); }
    } else if (c.state === 'chase') {
      toP.normalize(); vx = toP.x; vz = toP.z; speed = 2.7;
      if (dist < 1.9) { c.state = 'windup'; c.t = 0; c.lunge = toP.clone(); sfx.telegraph(); c.warnFx = vfx.warn(c.pos, 0.85); }
      if (fromHome > 13 || (!alert && dist > c.aggro + 4)) { c.state = 'return'; c.angered = false; }
    } else if (c.state === 'windup') {
      c.face = Math.atan2(toP.x, toP.z);
      if (c.t > 0.85) { c.state = 'lunge'; c.t = 0; c.lunge = toP.normalize(); c.hitDone = false; }
    } else if (c.state === 'lunge') {
      vx = c.lunge.x; vz = c.lunge.z; speed = 8.5;
      if (!c.hitDone && dist < 1.15) { c.hitDone = true; hurtPlayer(15, c.pos); }
      if (c.t > 0.26) { c.state = 'recover'; c.t = 0; }
    } else if (c.state === 'recover') {
      if (c.t > 0.95) { c.state = alert ? 'chase' : 'return'; c.t = 0; }
    } else if (c.state === 'return') {
      const d = new THREE.Vector3(c.home.x - c.pos.x, 0, c.home.z - c.pos.z);
      if (d.length() < 0.5) { c.state = 'wander'; c.t = 0; } else { d.normalize(); vx = d.x; vz = d.z; speed = 2.2; }
      if (dist < c.aggro * 0.7) c.state = 'chase';
    }
    let sx = vx * speed * dt, sz = vz * speed * dt;
    if (c.knock) { sx += c.knock.x * dt; sz += c.knock.z * dt; c.knock.multiplyScalar(Math.exp(-dt * 8)); if (c.knock.length() < 0.05) c.knock = null; }
    moveEntity(c.pos, sx, sz, 0.55, 0.3);
    // 蟹之间互相推开，也不和玩家重叠
    for (const o of crabs) if (o !== c && o.state !== 'dead') {
      const dx = c.pos.x - o.pos.x, dz = c.pos.z - o.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.1 && d > 0.01) { c.pos.x += dx / d * (1.1 - d) * 0.5; c.pos.z += dz / d * (1.1 - d) * 0.5; }
    }
    c.pos.y = groundHeight(c.pos.x, c.pos.z);
    // 动画：横着走（身体朝向垂直于移动方向），蓄力时举钳变红
    if (speed > 0 && c.state !== 'lunge') c.face = angleLerp(c.face, Math.atan2(vx, vz) + (c.state === 'chase' ? 0 : Math.PI / 2), 1 - Math.exp(-dt * 6));
    if (c.state === 'chase') c.face = angleLerp(c.face, Math.atan2(toP.x, toP.z), 1 - Math.exp(-dt * 8));
    c.obj.position.copy(c.pos);
    c.obj.rotation.y = c.face;
    const scuttle = speed > 0 ? S.time * speed * 9 : 0;
    P.legs.forEach((l, i) => (l.rotation.x = Math.sin(scuttle + i * 1.7) * 0.5));
    P.body.position.y = 0.42 + Math.abs(Math.sin(scuttle)) * 0.04;
    const wind = c.state === 'windup' ? Math.min(1, c.t / 0.5) : 0;
    const shakeW = c.state === 'windup' ? Math.sin(c.t * 50) * 0.03 * wind : 0;
    P.claws.forEach(({ arm, top }, i) => {
      arm.rotation.x = -wind * 0.9 + (c.state === 'lunge' ? 0.6 : 0);
      arm.rotation.z = (i ? 1 : -1) * (wind * 0.3 + Math.sin(S.time * 3 + c.i) * 0.05);
      top.rotation.x = 1.3 - 0.4 * Math.abs(Math.sin(S.time * (c.state === 'windup' ? 14 : 3)));
    });
    P.body.rotation.x = -wind * 0.25 + (c.state === 'lunge' ? 0.2 : 0);
    P.body.position.x = shakeW;
    const recover = c.state === 'recover' ? Math.sin(c.t * 18) * 0.2 : 0;
    P.eyes.forEach(e => (e.rotation.z = recover));
    // 危险色提示：珊瑚橙→红
    if (wind > 0) { const m = P.flashMats[1]; m.emissive.setRGB(0.9 * wind, 0.15 * wind, 0.05 * wind); m.emissiveIntensity = 1 + Math.sin(c.t * 30) * 0.5; }
  }
}

// ─────────────── 鹦鹉 ───────────────
const pState = { pos: new THREE.Vector3(), guide: 0, next: 6, said: 0 };
pState.pos.copy(S.pos).add(new THREE.Vector3(0, 3, 0));
function updateParrot(dt) {
  pState.next -= dt;
  const far = questTarget && questTarget.distanceTo(S.pos) > 9;
  if (pState.next <= 0 && far && !S.sailing) { pState.guide = 2.8; pState.next = 13; sfx.parrot(); }
  let goal;
  if (S.sailing) goal = props.boat.position.clone().add(new THREE.Vector3(0.2, 4.3, 0.3));
  else if (pState.guide > 0 && questTarget) {
    pState.guide -= dt;
    const dir = questTarget.clone().sub(S.pos).setY(0).normalize();
    goal = S.pos.clone().addScaledVector(dir, 6).setY(S.pos.y + 3.4);
  } else {
    const a = S.time * 0.8;
    goal = S.pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.4, 2.9 + Math.sin(S.time * 2) * 0.2, Math.sin(a) * 1.4));
  }
  const prev = pState.pos.clone();
  pState.pos.lerp(goal, 1 - Math.exp(-dt * (pState.guide > 0 ? 3 : 2.2)));
  parrot.position.copy(pState.pos);
  const v = pState.pos.clone().sub(prev);
  if (v.lengthSq() > 1e-6) parrot.rotation.y = angleLerp(parrot.rotation.y, Math.atan2(v.x, v.z), 0.2);
  const flap = Math.sin(S.time * (pState.guide > 0 ? 26 : 18)) * 0.8;
  parrot.userData.parts.wings[0].rotation.z = flap; parrot.userData.parts.wings[1].rotation.z = -flap;
  parrotFlap.value = flap * 0.9;
  if (S.parrotPin) { parrot.position.copy(S.parrotPin); parrot.rotation.y = S.parrotPin.ry; }   // 调试：定住鹦鹉
}

// ─────────────── 镜头 ───────────────
function updateCamera(dt) {
  if (hit('KeyV')) setCamMode(!cam.free);
  if (hit('KeyT')) setToon(!toonPass.enabled);
  if (hit('KeyH')) { setHD(!hd.on); UI.toast(hd.on ? 'HD-2D 画面：像素 + 景深 + 光晕' : '微缩玩具画面'); }
  if (hit('KeyZ')) cam.yawTarget -= Math.PI / 6;
  if (hit('KeyC')) cam.yawTarget += Math.PI / 6;
  const pad = navigator.getGamepads?.()[0];
  if (pad && cam.free) {
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    cam.yawTarget -= dz(pad.axes[2]) * dt * 2.5;
    cam.pitchTarget = THREE.MathUtils.clamp(cam.pitchTarget + dz(pad.axes[3]) * dt * 1.8, -0.45, 1.53);
  }
  if (!cam.free) cam.yawTarget = THREE.MathUtils.clamp(cam.yawTarget, -Math.PI / 3, Math.PI / 3);
  cam.yaw += (cam.yawTarget - cam.yaw) * (1 - Math.exp(-dt * (cam.free ? 14 : 6)));
  cam.pitch += (cam.pitchTarget - cam.pitch) * (1 - Math.exp(-dt * (cam.free ? 14 : 5)));
  const follow = S.sailing ? props.boat.position : S.pos;
  // 地标处拉远：靠近神龛 / 小岛 / 船时镜头稍远
  const landmark = [LAYOUT.shrine, LAYOUT.islet, LAYOUT.boat, props.summit, props.bigSummit].some(l => Math.hypot(l.x - follow.x, l.z - follow.z) < 8) || follow.y > 4;
  const dist = (cam.focusPush ?? 1) * (S.inTent && !cam.free ? 13 : cam.dist) * (landmark && !cam.free ? 1.12 : 1) * (S.sailing ? 1 + Math.min(1, S.sailing / 4) * 0.8 : 1);
  cam.target.lerp(new THREE.Vector3(follow.x, Math.max(0, follow.y), follow.z), 1 - Math.exp(-dt * 5));
  cam.curDist = cam.curDist ? cam.curDist + (dist - cam.curDist) * (1 - Math.exp(-dt * 2)) : dist;
  const p = cam.pitch;
  // 低机位（俯角 ≲ 26°）时切到“风景构图”：镜头推近一些、视角放宽，主角在画面中央，
  // 左边码头和船、右边营地和崖洞、上沿一条海平线和夕阳天空（营地主画面）
  const scenic = cam.scenic = cam.free ? 0 : 1 - THREE.MathUtils.smoothstep(p, 0.46, 0.56);
  const d = cam.curDist * (1 - 0.26 * scenic);
  const fov = 30 + 20 * scenic;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  tilt.blendMode.opacity.value = cam.free ? 0 : 1 - 0.8 * scenic;   // 风景构图下远景要清楚，微缩虚化减弱
  if (!cam.free) env.viewFar = 1 + 0.5 * scenic;                     // 远处的石柱、山影再清楚一点
  camera.position.set(cam.target.x + Math.sin(cam.yaw) * Math.cos(p) * d, cam.target.y + Math.sin(p) * d, cam.target.z + Math.cos(cam.yaw) * Math.cos(p) * d);
  // 自由视角时镜头不钻进地里/水里
  const floor = Math.max(groundHeight(camera.position.x, camera.position.z), tide.level + 0.2) + 0.8;
  if (camera.position.y < floor) camera.position.y = floor;
  if (S.shake > 0) { S.shake = Math.max(0, S.shake - dt); camera.position.x += (Math.random() - 0.5) * S.shake; camera.position.y += (Math.random() - 0.5) * S.shake; }
  camera.lookAt(cam.target.x, cam.target.y + (cam.free ? 1.3 : 0.6) + scenic * d * 0.095, cam.target.z);
  gliderTrails.update(dt, mv.gliderTips(), camera);
  fishes.update(dt, cam.target, S.sailing ? props.boat.position : S.pos, S.mode === 'swim' || !!S.sailing);
  hdFocus.set(S.pos.x, S.pos.y + 0.9, S.pos.z);
  updateFocusDOF(dt);
  // 阴影范围：风景构图下看得更远，阴影框放大并往镜头前方挪
  const sh = 24 + 12 * scenic;
  if (sun.shadow.camera.right !== sh) { Object.assign(sun.shadow.camera, { left: -sh, right: sh, top: sh, bottom: -sh }); sun.shadow.camera.updateProjectionMatrix(); }
  shadowC.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)).multiplyScalar(12 * scenic).add(cam.target);
  sun.position.copy(shadowC).addScaledVector(env.sunDir, 50); sun.target.position.copy(shadowC);
}

const shadowC = new THREE.Vector3();
// ─────────────── 专注景深 ───────────────
// 平时：轻微景深（HD-2D 稍强）。专注场景（帐篷里休息、火边烤火/做饭、钓鱼、开着制作面板）：
// 光圈开大、焦平面变窄，镜头略推近，背景和前景明显虚化；离开时 1 秒左右缓回。
let focusAmt = 0;
function focusScene() {
  if (S.inTent) return 1;
  if (S.fish) return 0.85;
  if (S.cook && sys.nearFire()) return 1;
  if (sys.nearFire() && inputMag < 0.05) return 0.8;
  if (UI.panelOpen()) return 0.9;
  return 0;
}
function updateFocusDOF(dt) {
  const want = S.running ? focusScene() : 0;
  focusAmt += (want - focusAmt) * (1 - Math.exp(-dt * (want > focusAmt ? 2.2 : 3)));
  const base = hd.on ? { bokeh: 2.2, range: 7 } : { bokeh: 0.6, range: 12 };
  dof.bokehScale = base.bokeh + (7.5 - base.bokeh) * focusAmt;
  dof.cocMaterial.focusRange = base.range + (2.2 - base.range) * focusAmt;
  cam.focusPush = 1 - 0.28 * focusAmt;
  hdDof.enabled = hd.on || focusAmt > 0.02;   // 平时不做景深，省一整个全屏 pass
}

// ─────────────── HUD ───────────────
// 敌人血条：在镜头里且离主角 24 米内显示；受伤后红条立刻减少，白色“残影”慢慢追上
function updateEnemyBars(dt) {
  for (const c of crabs) {
    c.hitT = Math.max(0, c.hitT - dt);
    c.hpLag += (Math.max(0, c.hp) - c.hpLag) * (c.hpLag > c.hp ? Math.min(1, dt * 2.5) : 1);
    const dist = c.pos.distanceTo(S.pos);
    const show = c.state !== 'dead' && c.obj.visible && dist < 24 && !S.sailing;
    if (!show) { UI.setEnemyBar(c.i, null); continue; }
    const s = toScreen(c.pos, 1.15);
    const alert = c.angered || ['chase', 'windup', 'lunge', 'recover'].includes(c.state);
    UI.setEnemyBar(c.i, s.behind ? null : s, Math.max(0, c.hp) / c.maxHp, c.hpLag / c.maxHp, {
      alert, windup: c.state === 'windup', hit: c.hitT > 3.8, near: dist < 10 || c.hitT > 0 || alert
    });
  }
}
function updateHUD() {
  UI.setBar('hp', S.hp / 100, 0.3); UI.setBar('st', S.st / 100, 0.2); UI.setBar('hu', S.hunger / 100, 0.25);
  UI.renderHotbar(S);
  UI.setClock(env.clockText(), env.phaseIcon(), env.weatherName(), env.day);
  UI.setStatus(sys.statuses());
  updateQuest();
  {
    const b = props.boat, f = S.sailing ? b.position : S.pos;
    minimap.update(1 / 60, { pos: f, facing: S.sailing ? b.rotation.y : S.facing, camYaw: cam.yaw, sailing: !!S.sailing, time: S.time,
      boat: { x: b.position.x, z: b.position.z, ry: b.rotation.y }, target: questTarget,
      crabs: crabs.filter(c => c.state !== 'dead' && Math.hypot(c.pos.x - f.x, c.pos.z - f.z) < 70).map(c => c.pos) });
  }
  // 交互提示
  const it = !S.sailing && !UI.panelOpen() && !S.place && !S.fish ? nearest() : null;
  if (S.place) {} else if (it) {
    const [text, blocked] = promptFor(it);
    const s = toScreen(new THREE.Vector3(it.x, groundHeight(it.x, it.z), it.z), it.kind === 'res' && it.r.type === 'palm' ? 1.5 : 2.2);
    UI.setPrompt(text, s.x, s.y, blocked);
  } else if (S.sailing && boatV.prompt) {
    const s = toScreen(props.boat.position, 3.2);
    UI.setPrompt(boatV.prompt[0], s.x, s.y, boatV.prompt[1]);
  } else UI.setPrompt(null);
  // 目标方向箭头：目标离屏时贴屏幕边缘
  if (questTarget && !S.sailing) {
    const s = toScreen(questTarget, 1.5), r = canvas.getBoundingClientRect();
    const off = s.behind || s.x < 40 || s.y < 90 || s.x > r.width - 40 || s.y > r.height - 110;
    if (off) {
      const c = toScreen(S.pos, 1), ang = Math.atan2(s.y - c.y, s.x - c.x) * (s.behind ? -1 : 1);
      const R = Math.min(r.width, r.height) * 0.36;
      UI.setArrow(true, c.x + Math.cos(ang) * R, c.y + Math.sin(ang) * R, ang);
    } else UI.setArrow(false);
    marker.visible = !off || questTarget.distanceTo(S.pos) < 30;
    marker.position.set(questTarget.x, questTarget.y + 2.6 + Math.sin(S.time * 2.5) * 0.2, questTarget.z);
    marker.rotation.y = S.time * 1.6;
  } else { UI.setArrow(false); marker.visible = false; }
}

// ─────────────── 主循环 ───────────────
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

let last = performance.now();
applyBoatStage();
updateCamera(1);
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.min(0.05, (now - last) / 1000); last = now;
  S.time += rawDt;
  if (S.running && hit('Tab')) { if (UI.panelOpen()) UI.togglePanel(false); else openPanel(); }
  if (hit('Escape')) UI.togglePanel(false);
  const paused = !S.running || UI.panelOpen() || S.ended;
  let dt = paused ? 0 : rawDt;
  if (S.hitstop > 0) { S.hitstop -= rawDt; dt *= 0.05; }
  const move = { x: 0, y: 0 };
  const pad = pollPad();
  if (keys.has('KeyW') || keys.has('ArrowUp')) move.y += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) move.y -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) move.x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) move.x += 1;
  move.x += pad.x; move.y += pad.y;
  inputMag = Math.min(1, Math.hypot(move.x, move.y));

  if (!paused) {
    if (S.sailing) updateSailing(dt, move, hit('KeyE'));
    else {
      if (hit('KeyE') && !S.attack && !S.dodge) {
        if (sys.isPlacing()) sys.confirmPlace();
        else if (!sys.fishingInput()) { const it = nearest(); if (it) interact(it); }
      }
      if (hit('KeyB') && S.mode === 'walk') sys.togglePlace();
      if (hit('KeyG')) emote('heart_pose');
      if (hit('Escape') && sys.isPlacing()) sys.togglePlace();
      if (hit('KeyF')) { const k = EAT_ORDER.find(k => S.inv[k] > 0); if (k) eat(k); }
      updatePlayer(dt, fading ? { x: 0, y: 0 } : move);
    }
    updateTide(dt);
    env.update(dt, cam.target);
    if (!S.sailing) sys.update(dt, inputMag);
    farm.update(dt, hit('KeyQ'));
    updateCrabs(dt);
    updateResources(dt);
  }
  if (UI.panelOpen()) renderPanel();
  updateParticles(rawDt);
  vfx.update(dt);   // 跟游戏时间走：顿帧时特效也定格
  updateParrot(paused ? rawDt * 0.3 : rawDt);
  animateProps(rawDt);
  water.uniforms.uTime.value = S.time;
  updateMotes();
  water.follow(cam.target);
  grass.uniforms.uWet.value = env.wet;
  grass.uniforms.uWind.value = 1 + env.rain * 0.6 + env.cloud * 0.2;
  grass.update(rawDt, cam.target, S.pos, { far: cam.free ? 1.6 : 1 });
  props.waterfall.update(rawDt, S.pos.distanceTo(props.fallBase) < 70);
  updateCamera(rawDt);
  if (S.running) { updateHUD(); updateRing(rawDt); updateEnemyBars(rawDt); }
  if (heroModel) {
    updateHeroClips(paused ? 0 : dt);
    heroModel.update(S.runK || 0, { w: S.locoW || 0, speed: S.planar || 0, dt: S.running && !S.sailing ? rawDt : 0, up: S.upK || 0 }, S.overDbg || S.over);
  }
  pressed.clear();
  canvasRect = null;
  composer.render(rawDt);
}

// 脚下光标圆环：可互动时变青，受伤/低血变珊瑚红，命中时脉冲，外圈显示体力
function updateRing(dt) {
  ring.visible = !S.sailing && S.mode === 'walk' && !S.inTent;
  if (!ring.visible) return;
  const P = ring.userData.parts;
  ring.position.set(S.pos.x, Math.max(groundHeight(S.pos.x, S.pos.z), tide.level) + 0.05, S.pos.z);
  const near = !UI.panelOpen() && nearest();
  const danger = S.hurt > 0 || S.hp < 30;
  ringPulse = Math.max(0, ringPulse - dt * 4);
  P.innerMat.color.set('#ffffff');   // 光环固定纯白
  P.innerMat.opacity = 0.8 + (S.hp < 30 ? Math.sin(S.time * 8) * 0.2 : 0);
  P.arrow.rotation.y = S.facing;
  P.arrowMat.opacity = S.attack || S.dodge ? 1 : 0.85;
  const scale = 1 + ringPulse * 0.18 + (S.dodge ? 0.15 : 0) + (near ? Math.sin(S.time * 5) * 0.03 : 0);
  ring.scale.setScalar(scale);
  const stamina = S.st < 99.5;
  P.stamBack.visible = P.stamina.visible = stamina;
  if (stamina) { M.setRingStamina(ring, S.st / 100); P.stamMat.color.set(S.st < 20 ? '#e85d4a' : '#f0b43a'); }
}

// 远处的静态布景直接隐藏（镜头看不到那么远，还能省掉阴影和视锥检测）
let cullT = 0;
function cullFar(dt) {
  if ((cullT -= dt) > 0) return; cullT = 0.35;
  const R = cam.free ? 190 : hd.on ? 120 : 95 + 60 * (cam.scenic || 0), c = cam.target;
  for (const o of props.cull) { const dx = o.position.x - c.x, dz = o.position.z - c.z; o.visible = dx * dx + dz * dz < R * R; }
}
let mistT = 0;
function animateProps(dt) {
  cullFar(dt);
  heroLamp.intensity = env.nightness * 5;
  // 天黑或下雨都点灯
  const lampOn = Math.max(env.nightness, env.rain * 0.7, env.hour > 18 || env.hour < 6.5 ? 0.5 : 0);
  props.lanterns[0].userData.parts.lamp.material.emissiveIntensity = lampOn * 7;
  const nearLamps = props.lanterns.map(l => [l, l.position.distanceToSquared(S.pos)]).sort((a, b) => a[1] - b[1]);
  lampLights.forEach((L, i) => {
    const e = nearLamps[i];
    if (!e) { L.intensity = 0; return; }
    e[0].userData.parts.lamp.getWorldPosition(L.position);
    L.intensity = lampOn * (14 + Math.sin(S.time * 9 + i) * 0.8);
  });
  const fd = S.pos.distanceTo(props.fallBase);
  sfx.setFall(Math.max(0, 1 - fd / 26));

  const fire = props.campfire.userData.parts;
  fire.flame.scale.set(1 + Math.sin(S.time * 13) * 0.08, 1 + Math.sin(S.time * 9) * 0.15, 1 + Math.cos(S.time * 11) * 0.08);
  fire.light.intensity = 5 + Math.sin(S.time * 17) * 1.2;
  for (const p of [props.shrine, props.totem]) {
    const o = p.userData.parts.orb;
    o.position.y = (p === props.shrine ? 1.5 : 2.0) + Math.sin(S.time * 2) * 0.08;
    const glow = tide.timer < 8 || tide.t < 1 ? 3.5 : 1.4;
    o.material.emissiveIntensity += (glow - o.material.emissiveIntensity) * 0.1;
  }
  props.shrine.userData.parts.ring.rotation.set(S.time * 0.7, S.time, 0);
  // 船随潮位浮动
  if (!S.sailing) {
    const b = props.boat;
    b.position.y = tide.level - 0.12 + Math.sin(S.time * 1.3) * 0.05;
    b.rotation.z = Math.sin(S.time * 1.1) * 0.03 + (S.boatStage < 1 ? 0.08 : 0);
    b.rotation.x = Math.sin(S.time * 0.8) * 0.015;
  }
  const bp = props.boat.userData.parts;
  bp.needle.rotation.y = Math.sin(S.time * 0.9) * 0.5 + S.time * (S.sailing ? 0 : 0.3);
  bp.sail.scale.z = 1 + Math.sin(S.time * 2) * 0.08;
  for (const f of props.foamRings) { f.mesh.position.y = tide.level + 0.03; f.mesh.visible = tide.level > f.base + 0.05; }
  for (const d of props.debris) { d.position.y = tide.level - 0.25 + Math.sin(S.time + d.position.x) * 0.08; d.rotation.z = Math.sin(S.time * 0.7 + d.position.z) * 0.15; }
  if (S.chestAnim !== undefined && S.chestAnim < 1) {
    S.chestAnim = Math.min(1, S.chestAnim + dt * 2);
    props.chest.userData.parts.lid.rotation.x = -1.9 * (1 - Math.pow(1 - S.chestAnim, 3));
  }
  if (shardProp.visible) { shardProp.position.y += dt * 0.6; shardProp.rotation.y += dt * 4; }
  const P = props.chest.userData.parts; if (P.glow.intensity > 0) P.glow.intensity = Math.max(0, P.glow.intensity - dt * 2);
}

// 航海：WASD（相对镜头）掌舵，船头慢慢转向输入方向；Shift 满帆；撞到浅滩会停住；
// 靠近岸边按 E 下船，船就停在那里，走回去按 E 再上船。第一次出航 7 秒后出结算，可以选择继续航海。
const boatV = { speed: 0 };
function boatBlocked(x, z) {
  const half = MAP.size / 2 - 12;
  return Math.abs(x) > half || Math.abs(z) > half || terrainHeight(x, z) > tide.level - 0.45;
}
function landingSpot() {
  // 船两侧 / 船头 3~5 米内找一块露出水面、不太陡的地
  const b = props.boat;
  for (const r of [3, 4, 5]) for (const a of [Math.PI / 2, -Math.PI / 2, 0, Math.PI / 4, -Math.PI / 4]) {
    const x = b.position.x + Math.sin(b.rotation.y + a) * r, z = b.position.z + Math.cos(b.rotation.y + a) * r;
    const h = groundHeight(x, z);
    if (onDock(x, z) || (h > tide.level + 0.15 && terrainHeight(x + 0.6, z) - terrainHeight(x - 0.6, z) < 0.8)) return new THREE.Vector3(x, h, z);
  }
  return null;
}
function updateSailing(dt, move, pressE) {
  S.sailing += dt;
  const b = props.boat, t = S.sailing;
  const fwd = V.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  const wx = Math.cos(cam.yaw) * move.x + fwd.x * move.y, wz = -Math.sin(cam.yaw) * move.x + fwd.z * move.y;
  const input = Math.min(1, Math.hypot(wx, wz));
  const auto = !S.flags.sailed && input < 0.05;   // 第一次出航、还没碰键盘：自动驶离码头
  let target = 0;
  if (input > 0.05) {
    const want = Math.atan2(wx, wz);
    b.rotation.y += Math.atan2(Math.sin(want - b.rotation.y), Math.cos(want - b.rotation.y)) * Math.min(1, dt * (0.9 + 0.6 * (1 - boatV.speed / 9)));
    target = input * (S.sprint ? 9 : 5.5);
  } else if (auto) {
    b.rotation.y += Math.atan2(Math.sin(0.6 - b.rotation.y), Math.cos(0.6 - b.rotation.y)) * dt * 0.4;
    target = Math.min(5, t * 1.2);
  }
  boatV.speed += (target - boatV.speed) * Math.min(1, dt * (target > boatV.speed ? 0.8 : 0.5));
  const nx = b.position.x + Math.sin(b.rotation.y) * boatV.speed * dt, nz = b.position.z + Math.cos(b.rotation.y) * boatV.speed * dt;
  const bowX = nx + Math.sin(b.rotation.y) * 2.6, bowZ = nz + Math.cos(b.rotation.y) * 2.6;
  if (boatBlocked(bowX, bowZ)) {
    if (boatV.speed > 2.5) { S.shake = 0.2; sfx.chop(); burst(new THREE.Vector3(bowX, tide.level + 0.2, bowZ), 10, ['#ffffff', '#bff3ef'], { speed: 2, up: 2.5, life: 0.6 }); }
    boatV.speed = 0;
  } else { b.position.x = nx; b.position.z = nz; }
  // 起伏：速度越快，船头越翘、侧倾越明显
  b.position.y = tide.level - 0.1 + Math.sin(S.time * 1.8) * 0.08;
  b.rotation.z = Math.sin(S.time * 1.4) * 0.05;
  b.rotation.x = -boatV.speed * 0.006 + Math.sin(S.time * 1.1) * 0.02;
  hero.position.set(b.position.x, b.position.y + 0.35 * b.scale.y + 0.05, b.position.z).add(new THREE.Vector3(0, 0, -0.9).applyEuler(b.rotation));
  hero.rotation.y = b.rotation.y;
  if (auto) HP.arms[1].sh.rotation.x = -2.6 + Math.sin(S.time * 8) * 0.4; // 挥手
  // 船尾浪花 + 船头破浪
  const wake = boatV.speed / 5;
  if (Math.random() < dt * 14 * wake) burst(b.position.clone().add(new THREE.Vector3(Math.sin(b.rotation.y + 2.6) * 2.6, 0.1, Math.cos(b.rotation.y + 2.6) * 2.6)), 1, ['#ffffff'], { speed: 0.6, up: 1, life: 0.8, gravity: 3 });
  if (Math.random() < dt * 14 * wake) burst(b.position.clone().add(new THREE.Vector3(Math.sin(b.rotation.y - 2.6) * 2.6, 0.1, Math.cos(b.rotation.y - 2.6) * 2.6)), 1, ['#ffffff'], { speed: 0.6, up: 1, life: 0.8, gravity: 3 });
  if (Math.random() < dt * 10 * Math.max(0, wake - 0.3)) burst(b.position.clone().add(new THREE.Vector3(Math.sin(b.rotation.y) * 2.8, 0.15, Math.cos(b.rotation.y) * 2.8)), 2, ['#ffffff', '#dff7f5'], { speed: 1.4, up: 1.6, life: 0.6, gravity: 5 });
  // 下船
  const land = t > 1 && boatV.speed < 2.5 ? landingSpot() : null;
  boatV.prompt = land ? ['<kbd>E</kbd>靠岸下船', false] : t > 1 ? ['WASD 掌舵 · Shift 满帆', true] : null;
  if (land && pressE) {
    S.sailing = 0; boatV.speed = 0; S.flags.sailed = true;
    S.pos.copy(land); S.vel.set(0, 0, 0); S.mode = 'walk';
    hero.rotation.y = S.facing = Math.atan2(land.x - b.position.x, land.z - b.position.z);
    UI.setPrompt(null); sfx.splash();
    return;
  }
  if (t > 7 && !S.ended && !S.flags.sailed) {
    S.ended = true; S.flags.sailed = true;
    const mins = Math.floor((performance.now() - S.stats.start) / 60000), secs = Math.floor((performance.now() - S.stats.start) / 1000) % 60;
    UI.showEnd([['用时', `${mins}:${String(secs).padStart(2, '0')}`], ['击退椰壳蟹', S.stats.crabs], ['采集次数', S.stats.gathered], ['昏倒次数', S.stats.deaths]]);
  }
}

// ─────────────── 存档（localStorage 自动存档）───────────────
const SAVE_KEY = 'piaodao-save-v1';
function saveGame(reason) {
  if (!S.running || S.sailing || S.ended || fading || S.mode !== 'walk') return;
  const data = {
    v: 2, savedAt: Date.now(), env: env.serialize(), sys: sys.serialize(), farm: farm.serialize(),
    pos: [S.pos.x, S.pos.z], facing: S.facing, hp: S.hp, st: S.st, hunger: S.hunger,
    inv: S.inv, tools: S.tools, boatStage: S.boatStage, flags: S.flags,
    stats: { ...S.stats, elapsed: performance.now() - S.stats.start },
    tide: { low: tide.low, timer: tide.timer },
    boat: [props.boat.position.x, props.boat.position.z, props.boat.rotation.y]
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { return; }
  if (reason) UI.saveBadge();
}
function readSave() {
  try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); return d?.v === 1 || d?.v === 2 ? d : null; } catch { return null; }
}
function loadGame(d) {
  Object.assign(S.inv, d.inv); Object.assign(S.tools, d.tools); S.flags = d.flags || {};
  S.hp = d.hp; S.st = d.st; S.hunger = d.hunger; S.facing = d.facing; S.boatStage = d.boatStage;
  S.pos.set(d.pos[0], 0, d.pos[1]);
  // 存档点被潮水淹了或落在不可走的地方：回营地
  if (!walkable(S.pos.x, S.pos.z, 0)) S.pos.copy(LAYOUT.spawn);
  S.pos.y = groundHeight(S.pos.x, S.pos.z);
  Object.assign(S.stats, d.stats); S.stats.start = performance.now() - (d.stats.elapsed || 0);
  tide.low = d.tide.low; tide.timer = d.tide.timer; tide.level = tide.from = tide.to = tide.low ? TIDE.low : TIDE.high; tide.t = 1;
  applyBoatStage();
  if (S.flags.chest) { S.chestAnim = 1; props.chest.userData.parts.lid.rotation.x = -1.9; }
  if (S.flags.sailed && d.boat) { props.boat.position.x = d.boat[0]; props.boat.position.z = d.boat[1]; props.boat.rotation.y = d.boat[2]; }
  env.load(d.env); sys.load(d.sys);
  if (d.farm) farm.load(d.farm); else farm.starterField();
  cam.target.copy(S.pos);
}
setInterval(() => saveGame(), 15000);
addEventListener('pagehide', () => saveGame());
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });

// ─────────────── 开始 / 重开 ───────────────
function begin(save) {
  initAudio(); bgm.start(); UI.setMusic(bgm.current(), bgm.muted());
  document.querySelector('#title').hidden = true;
  document.querySelector('#hud').hidden = false;
  S.running = true; S.stats.start = performance.now();
  S.test = document.querySelector('#testmode').checked;
  if (save) loadGame(save); else farm.starterField();
  if (S.test) { grantAll(); UI.toast('测试模式：所有工具和材料已解锁'); }
  canvas.focus();
  if (save) UI.banner('针针：嘎！接着上次的航程！', 3000);
  else { saveGame(); UI.banner('针针：嘎！船撞坏了！先去海滩捡点木头！', 3500); }
}
const existing = readSave();
if (existing) {
  const cont = document.querySelector('#continue');
  cont.hidden = false;
  const mins = Math.floor((existing.stats.elapsed || 0) / 60000);
  cont.querySelector('small').textContent = `已玩 ${mins} 分钟 · 船只修复 ${existing.boatStage}/3`;
  cont.addEventListener('click', () => begin(existing));
  document.querySelector('#start').textContent = '新的航程'; document.querySelector('#start').classList.add('secondary');
}
document.querySelector('#start').addEventListener('click', () => {
  if (existing && !confirm('开始新的航程会覆盖现有存档，确定吗？')) return;
  localStorage.removeItem(SAVE_KEY);
  begin(null);
});
document.querySelector('#keep-sailing').addEventListener('click', () => { document.querySelector('#ending').hidden = true; S.ended = false; saveGame(); UI.banner('自由航海：WASD 掌舵，Shift 满帆，靠岸按 E 下船', 4000); });
document.querySelector('#restart').addEventListener('click', () => { localStorage.removeItem(SAVE_KEY); location.reload(); });
document.querySelector('#panel-close').addEventListener('click', () => UI.togglePanel(false));
document.querySelector('#viewport').setAttribute('aria-busy', 'false');
UI.setAvatar();

// 调试/自动测试入口：?debug 时暴露状态
if (new URLSearchParams(location.search).has('debug')) window.__game = { composer, renderer, setToon, heroModel: () => heroModel, grass, bgm, setHD, S, env, sys, mv, farm, nearest, props, hero, camera, scene, THREE, colliders, tide, setTide, saveGame, readSave, crabs, cam, craft, add, boatAction, resources, vfx, landingSpot, fishes, LAYOUT, emote, parrot, parrotFlap };
setHD(false);
setCamMode(true, true);   // 默认自由视角
window.__sceneReady = true;
requestAnimationFrame(frame);

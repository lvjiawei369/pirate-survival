// WebGPU 预览：同一座晴帆岛，用 three.js WebGPURenderer + TSL（节点着色器）+ compute shader。
// 展示 WebGL 版做不到的量级：
//   1. 海面：按海浪谱采样的 128 组波，每帧在 compute shader 里给 14 万个顶点叠加一遍（算位移、法线、雅可比→浪尖白沫）
//   2. 雨：8 万颗雨滴的位置和速度全在 GPU 上更新，CPU 不碰
//   3. 草：20 万根草，每根在顶点着色器里被风吹弯
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, instanceIndex, instancedArray, attributeArray, Loop, If,
  sin, cos, sqrt, dot, normalize, mix, smoothstep, clamp, max, min, pow, abs, fract, exp,
  positionLocal, positionWorld, cameraPosition, time, hash, attribute, normalWorld, screenUV,
  mx_noise_float, pass, transformNormalToView, varying, vertexIndex
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTerrain, terrainHeight, MAP, LAYOUT, POND } from '../terrain.js';
import * as M from '../models.js';

const $ = (s) => document.querySelector(s);
const status = (t) => ($('#loading span').textContent = t);
const next = () => new Promise((r) => setTimeout(r, 30));

// ─────────────── 渲染器 ───────────────
const canvas = $('#world');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
await renderer.init();
const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2（浏览器不支持 WebGPU，已自动回退）';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.3, 1200);
camera.position.set(-38, 26, 60);
const controls = new OrbitControls(camera, canvas);
controls.target.set(-2, 1.5, 6); controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48; controls.minDistance = 4; controls.maxDistance = 220;

// 天空：屏幕纵向渐变 + 地平线雾色
scene.backgroundNode = mix(vec3(0.62, 0.84, 0.9), vec3(0.2, 0.47, 0.82), pow(screenUV.y.oneMinus(), 1.4));
scene.fog = new THREE.Fog('#9fd6e0', 140, 520);

const hemi = new THREE.HemisphereLight('#dff4ff', '#b89a70', 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff0d4', 2.6);
sun.position.set(40, 60, 30); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
scene.add(sun);
const SUN_DIR = sun.position.clone().normalize();

// ─────────────── 地形（同一个高度函数，材质换成 TSL 节点）───────────────
status('生成地形…'); await next();
const { mesh: terrain, heightTex } = buildTerrain();
const H = heightTex.image.data, HN = heightTex.image.width, HS = MAP.size / (HN - 1);
const hAt = (x, z) => {   // 从高度网格双线性采样（比解析函数快几十倍）
  const gx = (x + MAP.size / 2) / HS, gz = (z + MAP.size / 2) / HS;
  const i = Math.max(0, Math.min(HN - 2, Math.floor(gx))), j = Math.max(0, Math.min(HN - 2, Math.floor(gz)));
  const fx = gx - i, fz = gz - j;
  return (H[j * HN + i] * (1 - fx) + H[j * HN + i + 1] * fx) * (1 - fz) + (H[(j + 1) * HN + i] * (1 - fx) + H[(j + 1) * HN + i + 1] * fx) * fz;
};
const terrainMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
terrainMat.colorNode = Fn(() => {
  const base = attribute('color', 'vec3').toVar();
  const p = positionWorld;
  const n1 = mx_noise_float(vec3(p.xz.mul(0.9), 0)).mul(0.5).add(0.5);
  base.mulAssign(float(0.9).add(n1.mul(3).floor().div(3).mul(0.16)));        // 三档手绘色块
  const steep = smoothstep(0.8, 0.5, normalWorld.y);                           // 陡坡：岩层条纹
  const band = fract(p.y.mul(1.25).add(mx_noise_float(vec3(p.xz.mul(0.5), p.y.mul(0.2))).mul(0.35)));
  const rock = mix(vec3(0.2, 0.19, 0.16), vec3(0.34, 0.32, 0.27), smoothstep(0.4, 0.5, fract(p.y.mul(0.62))))
    .mul(float(0.72).add(smoothstep(0, 0.1, band).mul(smoothstep(1, 0.9, band)).mul(0.28)));
  return mix(base, rock, steep);
})();
terrain.traverse((o) => { if (o.isMesh) { o.material = terrainMat; o.castShadow = false; o.receiveShadow = true; } });
scene.add(terrain);

// 几件布景：主角、营地、棕榈（直接复用游戏里的模型）
const hero = M.buildHero(); hero.position.set(LAYOUT.spawn.x, hAt(LAYOUT.spawn.x, LAYOUT.spawn.z), LAYOUT.spawn.z); hero.rotation.y = 0.5; scene.add(hero);
hero.userData.parts.sword.visible = true;
const tent = M.buildTent(); tent.position.set(LAYOUT.tent.x, hAt(LAYOUT.tent.x, LAYOUT.tent.z), LAYOUT.tent.z); tent.rotation.y = 0.5; scene.add(tent);
const fire = M.buildCampfire(); fire.position.set(LAYOUT.campfire.x, hAt(LAYOUT.campfire.x, LAYOUT.campfire.z), LAYOUT.campfire.z); scene.add(fire);
const boat = M.buildBoat(); boat.position.set(LAYOUT.boat.x, 0, LAYOUT.boat.z); scene.add(boat);
for (const k of ['patches', 'rig']) boat.userData.parts[k].visible = true;
boat.userData.parts.hole.visible = boat.userData.parts.brokenMast.visible = false;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let n = 0, t = 0; n < 40 && t < 3000; t++) {
  const x = -45 + rnd() * 90, z = -30 + rnd() * 60, h = hAt(x, z);
  if (h < 0.7 || h > 1.8 || Math.hypot(x - LAYOUT.camp.x, z - LAYOUT.camp.z) < 6 || Math.hypot(x - POND.x, z - POND.z) < 5) continue;
  const p = M.buildPalm(n); p.position.set(x, h - 0.05, z); p.scale.setScalar(0.85 + rnd() * 0.4); scene.add(p); n++;
}

// ─────────────── 1. 海面：compute shader 叠加 128 组谱波 ───────────────
status('生成海浪谱…'); await next();
const OCEAN = { N: 384, L: 360 }, OV = OCEAN.N * OCEAN.N, WAVES = 128;
// 用简化的 Phillips 谱采样：波长 1.5–70 米对数分布，主风向 ±60° 余弦平方分布，振幅 ∝ 波长（陡度大致一致）
const waveA = new Float32Array(WAVES * 4), waveB = new Float32Array(WAVES * 4);
const WIND = Math.atan2(0.6, 0.8);
for (let i = 0; i < WAVES; i++) {
  const L = 1.5 * Math.pow(70 / 1.5, rnd()), k = 2 * Math.PI / L;
  let a; do { a = (rnd() - 0.5) * Math.PI * 1.4; } while (rnd() > Math.pow(Math.cos(a), 2));
  const dir = WIND + a, amp = L * 0.0065 * (0.5 + rnd()) * Math.pow(Math.cos(a), 2);
  waveA.set([Math.cos(dir), Math.sin(dir), k, amp], i * 4);
  waveB.set([Math.sqrt(9.8 * k), rnd() * Math.PI * 2, 0.75 / (k * amp * WAVES), 0], i * 4);
}
const waveBufA = attributeArray(waveA, 'vec4'), waveBufB = attributeArray(waveB, 'vec4');
// 每个海面顶点下面的水深（CPU 采样一次，常驻显存）
const groundArr = new Float32Array(OV);
for (let j = 0; j < OCEAN.N; j++) for (let i = 0; i < OCEAN.N; i++)
  groundArr[j * OCEAN.N + i] = hAt(-OCEAN.L / 2 + i * OCEAN.L / (OCEAN.N - 1), -OCEAN.L / 2 + j * OCEAN.L / (OCEAN.N - 1));
const groundBuf = attributeArray(groundArr, 'float');
const dispBuf = attributeArray(OV, 'vec4');   // 位移 xyz + 雅可比
const nrmBuf = attributeArray(OV, 'vec4');    // 法线 xyz + 水深
const uWaveScale = uniform(1), uChop = uniform(1), uT = uniform(0), uRain = uniform(0);

const oceanCompute = Fn(() => {
  const idx = instanceIndex;
  const fi = idx.mod(OCEAN.N).toFloat(), fj = idx.div(OCEAN.N).toFloat();
  const p = vec2(fi.mul(OCEAN.L / (OCEAN.N - 1)).sub(OCEAN.L / 2), fj.mul(OCEAN.L / (OCEAN.N - 1)).sub(OCEAN.L / 2));
  const depth = groundBuf.element(idx).negate();
  const damp = smoothstep(0.1, 4.0, depth).mul(uWaveScale);
  const disp = vec3(0).toVar(), nrm = vec3(0, 1, 0).toVar();
  const jxx = float(1).toVar(), jzz = float(1).toVar(), jxz = float(0).toVar();
  Loop(WAVES, ({ i }) => {
    const a = waveBufA.element(i), b = waveBufB.element(i);
    // 陡度总和必须 < 1，否则水面会自己折叠翻面（三角形反向被剔除，露出海底）
    const d = a.xy, k = a.z, A = a.w.mul(damp), Q = b.z.mul(min(uChop, float(1.25).div(max(uWaveScale, 0.3))));
    const ph = k.mul(dot(d, p)).sub(b.x.mul(uT)).add(b.y);
    const s = sin(ph), c = cos(ph), kA = k.mul(A);
    disp.addAssign(vec3(Q.mul(A).mul(d.x).mul(c), A.mul(s), Q.mul(A).mul(d.y).mul(c)));
    nrm.subAssign(vec3(d.x.mul(kA).mul(c), Q.mul(kA).mul(s), d.y.mul(kA).mul(c)));
    jxx.subAssign(Q.mul(kA).mul(d.x).mul(d.x).mul(s));
    jzz.subAssign(Q.mul(kA).mul(d.y).mul(d.y).mul(s));
    jxz.subAssign(Q.mul(kA).mul(d.x).mul(d.y).mul(s));
  });
  // 波谷不能低于海底，否则不透明的海床会盖住水面（风暴时出现“破洞”）
  disp.y.assign(max(disp.y, depth.negate().add(0.25)));
  dispBuf.element(idx).assign(vec4(disp, jxx.mul(jzz).sub(jxz.mul(jxz))));
  nrmBuf.element(idx).assign(vec4(normalize(nrm), depth));
})().compute(OV);

const oceanGeo = new THREE.PlaneGeometry(OCEAN.L, OCEAN.L, OCEAN.N - 1, OCEAN.N - 1).rotateX(-Math.PI / 2);
const oceanMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
// 顶点着色器按顶点编号直接读 compute 写好的存储缓冲区，再用 varying 传给片元
const dispV = dispBuf.element(vertexIndex), nrmV = nrmBuf.element(vertexIndex);
const vDisp = varying(dispV, 'vDisp'), vNrm = varying(nrmV, 'vNrm');
oceanMat.positionNode = positionLocal.add(dispV.xyz);
oceanMat.colorNode = Fn(() => {
  const n = normalize(vNrm.xyz), depth = vNrm.w, jac = vDisp.w, h = vDisp.y;
  const L = vec3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z);
  const v = normalize(cameraPosition.sub(positionWorld));
  // 基色：浅滩青绿 → 海蓝 → 深海
  const col = mix(vec3(0.38, 0.86, 0.83), vec3(0.1, 0.6, 0.74), smoothstep(0.05, 1.2, depth)).toVar();
  col.assign(mix(col, vec3(0.03, 0.28, 0.46), smoothstep(1.5, 6.0, depth)));
  // 浪的明暗（风格化）：太阳高时朗伯项变化太小，改用“相对平面的偏转”放大明暗；
  // 迎光坡亮、背光坡和陡坡暗，浪峰透青绿，波谷压暗
  const tiltToSun = dot(n, L).sub(L.y);                                          // 平面为 0，迎光为正
  col.mulAssign(float(1).add(clamp(tiltToSun.mul(3.2), -0.45, 0.4)));
  col.mulAssign(mix(0.72, 1.0, smoothstep(0.86, 0.99, n.y)));
  col.addAssign(vec3(0.03, 0.22, 0.2).mul(smoothstep(0.1, 1.0, h)).mul(smoothstep(0.8, 2.5, depth)));
  col.mulAssign(float(1).sub(smoothstep(0, -1.0, h).mul(0.3)));
  // 菲涅尔：掠射角反射天空
  const fres = pow(float(1).sub(max(dot(n, v), 0)), 5);
  col.assign(mix(col, vec3(0.62, 0.82, 0.95), fres.mul(0.65)));
  // 白沫：浪尖被挤压处（雅可比）+ 岸边泡沫带
  const q = positionWorld.xz;
  const lace = mx_noise_float(vec3(q.mul(1.4), uT.mul(0.15))).mul(0.5).add(0.5);
  const fold = max(smoothstep(0.96, 0.78, jac), smoothstep(0.9, 1.6, h.div(uWaveScale.max(0.3))).mul(0.8)).mul(smoothstep(0.35, 0.6, lace)).mul(smoothstep(1, 3, depth));
  const shore = smoothstep(0.35, 0.05, depth).mul(smoothstep(0.35, 0.55, lace.add(smoothstep(0.3, 0, depth).mul(0.3))));
  const foam = max(fold, shore);
  // 雨点涟漪
  // 每格一个随机位置、随机相位、只有 40% 的格子有雨点，避免看出网格
  const cell = q.mul(1.4).floor();
  const r = fract(uT.mul(1.3).add(hash(cell)));
  const off = vec2(hash(cell.add(3.1)), hash(cell.add(7.7))).sub(0.5).mul(0.6);
  const cellP = fract(q.mul(1.4)).sub(0.5).sub(off);
  const rip = smoothstep(0.04, 0, abs(cellP.length().sub(r.mul(0.35)))).mul(r.oneMinus()).mul(uRain).mul(hash(cell.add(1.3)).greaterThan(0.6).select(1, 0));
  col.assign(mix(col, vec3(0.97, 0.99, 1), max(foam, rip.mul(0.6))));
  // 太阳高光
  // 碎金高光：半角向量高光 + 阈值，像卡通水面上的闪光
  const spec = pow(max(dot(n, normalize(v.add(L))), 0), 90);
  col.addAssign(smoothstep(0.35, 0.6, spec).mul(1.4).mul(float(1).sub(uRain.mul(0.7))));
  return col;
})();
oceanMat.opacityNode = max(mix(0.55, 0.95, smoothstep(0.05, 2.5, vNrm.w)), 0);
const ocean = new THREE.Mesh(oceanGeo, oceanMat);
ocean.frustumCulled = false; ocean.renderOrder = 2;
scene.add(ocean);
// 远处的海：一圈平的深色水面，接到雾里
const farSea = new THREE.Mesh(new THREE.RingGeometry(175, 900, 96, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicNodeMaterial({ color: '#12608a' }));
farSea.position.y = -0.05; scene.add(farSea);

// ─────────────── 2. 雨：8 万颗，GPU 更新 ───────────────
const RAIN = 80000;
const rainPos = instancedArray(RAIN, 'vec4');
const uCenter = uniform(new THREE.Vector3()), uDt = uniform(0);
const rainInit = Fn(() => {
  const i = instanceIndex.toFloat();
  rainPos.element(instanceIndex).assign(vec4(hash(i).sub(0.5).mul(90), hash(i.add(7.3)).mul(30), hash(i.add(3.1)).sub(0.5).mul(90), hash(i.add(9.9)).mul(8).add(20)));
})().compute(RAIN);
const rainUpdate = Fn(() => {
  const p = rainPos.element(instanceIndex);
  p.y.subAssign(p.w.mul(uDt));
  p.x.addAssign(uDt.mul(3));
  If(p.y.lessThan(0), () => {
    const s = instanceIndex.toFloat().add(uT.mul(37.1));
    p.assign(vec4(hash(s).sub(0.5).mul(90).add(uCenter.x), float(28).add(hash(s.add(1.7)).mul(4)), hash(s.add(5.3)).sub(0.5).mul(90).add(uCenter.z), p.w));
  });
})().compute(RAIN);
const rainMat = new THREE.MeshBasicNodeMaterial({ color: '#d6ecff', transparent: true, opacity: 0.45, depthWrite: false });
rainMat.positionNode = positionLocal.add(rainPos.toAttribute().xyz);
const rain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.5, 0.018), rainMat, RAIN);
rain.frustumCulled = false; rain.visible = false; scene.add(rain);

// ─────────────── 3. 草：20 万根，顶点着色器里被风吹 ───────────────
status('铺草…'); await next();
const GRASS_MAX = 200000;
const gArr = new Float32Array(GRASS_MAX * 4);
let gCount = 0;
for (let t = 0; t < GRASS_MAX * 6 && gCount < GRASS_MAX; t++) {
  const x = -52 + rnd() * 100, z = -40 + rnd() * 80, h = hAt(x, z);
  if (h < 1.05 || h > 12) continue;
  const slope = Math.abs(hAt(x + 0.5, z) - h) + Math.abs(hAt(x, z + 0.5) - h);
  if (slope > 0.35 || Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.8) continue;
  if (Math.hypot(x - LAYOUT.camp.x, z - LAYOUT.camp.z) < 4.5) continue;
  gArr.set([x, h - 0.02, z, rnd()], gCount * 4); gCount++;
}
const bladeGeo = (() => {   // 一根草：三段收尖的片
  const pos = [], idx = [];
  for (let s = 0; s <= 3; s++) { const y = s / 3, w = 0.05 * (1 - y * 0.85); pos.push(-w, y, 0, w, y, 0); }
  pos.push(0, 1.12, 0);
  for (let s = 0; s < 3; s++) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  idx.push(6, 7, 8);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
})();
const grassBuf = instancedArray(gArr.subarray(0, gCount * 4), 'vec4');
const uWind = uniform(1);
const grassMat = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
const gI = grassBuf.toAttribute();
grassMat.positionNode = Fn(() => {
  const r = gI.w, lp = positionLocal;
  const hgt = r.mul(0.35).add(0.28);
  const ang = r.mul(40);
  const x = lp.x.mul(cos(ang)), z = lp.x.mul(sin(ang));
  const y = lp.y.mul(hgt);
  // 风：两层波（大阵风沿风向推过草地 + 小抖动），越靠顶越弯
  const gust = sin(gI.x.mul(0.25).add(gI.z.mul(0.18)).sub(uT.mul(1.6))).mul(0.5).add(0.5);
  const flutter = sin(uT.mul(7).add(r.mul(30))).mul(0.12);
  const bend = lp.y.mul(lp.y).mul(gust.mul(0.35).add(flutter).add(0.08)).mul(uWind).mul(hgt);
  return vec3(gI.x.add(x).add(bend.mul(0.8)), gI.y.add(y).sub(bend.mul(bend).mul(0.4)), gI.z.add(z).add(bend.mul(0.6)));
})();
// 草的法线统一朝上（略向风向倾斜），光照才一致；颜色从根部深绿到草尖黄绿
grassMat.normalNode = transformNormalToView(normalize(vec3(0.25, 1, 0.15)));
grassMat.colorNode = Fn(() => {
  const r = gI.w, t = positionLocal.y;
  const base = mix(vec3(0.035, 0.14, 0.03), vec3(0.06, 0.2, 0.04), r);
  const tip = mix(vec3(0.16, 0.42, 0.07), vec3(0.3, 0.5, 0.08), r.mul(r));
  return mix(base, tip, pow(t, 0.8));
})();
const grass = new THREE.InstancedMesh(bladeGeo, grassMat, gCount);
grass.frustumCulled = false; grass.receiveShadow = true; scene.add(grass);

// ─────────────── 后期：泛光 ───────────────
const post = new THREE.PostProcessing(renderer);
const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode('output');
post.outputNode = sceneColor.add(bloom(sceneColor, 0.3, 0.5, 0.9));

// ─────────────── 界面 ───────────────
$('#stats-backend').textContent = backend;
$('#stats-grass').textContent = gCount.toLocaleString();
$('#stats-ocean').textContent = `${WAVES} 组波 × ${OV.toLocaleString()} 顶点`;
$('#stats-rain').textContent = RAIN.toLocaleString();
const state = { rain: false, sea: 1 };
$('#btn-rain').onclick = () => {
  state.rain = !state.rain; rain.visible = state.rain;
  $('#btn-rain').classList.toggle('on', state.rain); $('#btn-rain b').textContent = state.rain ? '停雨' : '下雨';
};
const SEAS = [['平静', 0.45, 0.6, 0.6], ['普通', 1, 1, 1], ['风暴', 1.9, 1.8, 2.6]];
$('#btn-sea').onclick = () => {
  state.sea = (state.sea + 1) % 3; const [name] = SEAS[state.sea];
  $('#btn-sea b').textContent = `海况：${name}`;
};
$('#btn-grass').onclick = () => { grass.visible = !grass.visible; $('#btn-grass').classList.toggle('on', grass.visible); };

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
renderer.setSize(innerWidth, innerHeight);

status('编译着色器…'); await next();
await renderer.computeAsync(rainInit);

let last = performance.now(), frames = 0, fpsT = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  uT.value += dt; uDt.value = dt;
  const [, waveTarget, windTarget, chopTarget] = SEAS[state.sea];
  uChop.value += (chopTarget - uChop.value) * Math.min(1, dt * 1.5);
  uWaveScale.value += (waveTarget - uWaveScale.value) * Math.min(1, dt * 1.5);
  uWind.value += (windTarget - uWind.value) * Math.min(1, dt * 1.5);
  uRain.value += ((state.rain ? 1 : 0) - uRain.value) * Math.min(1, dt * 2);
  uCenter.value.copy(controls.target);
  renderer.compute(oceanCompute);
  if (rain.visible) renderer.compute(rainUpdate);
  boat.position.y = Math.sin(uT.value * 1.2) * 0.08 * uWaveScale.value - 0.1;
  boat.rotation.z = Math.sin(uT.value) * 0.04 * uWaveScale.value;
  fire.userData.parts.flame.scale.y = 1 + Math.sin(uT.value * 9) * 0.15;
  controls.update();
  post.render();
  frames++; fpsT += dt;
  if (fpsT > 0.5) { $('#stats-fps').textContent = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  requestAnimationFrame(frame);
}
$('#loading').hidden = true;
requestAnimationFrame(frame);
window.__wgpu = { renderer, camera, controls, state, uWaveScale, backend, gCount, dispBuf, nrmBuf };

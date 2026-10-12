// 时间与天气：昼夜光照、晴/多云/雨的自动切换、雨丝、萤火虫、海鸥。
// 所有“环境读数”（几点、是不是夜里、雨多大）都从这里取，玩法系统不自己算。
import * as THREE from 'three';
import { terrainUniforms, groundHeight } from './terrain.js';
import { waterLight, HORIZON_GLSL } from './water.js';
import { buildGull } from './models.js';

export const DAY_SECONDS = 720; // 现实 12 分钟 = 游戏一天（1 小时 = 30 秒）
const WEATHER = {
  clear: { name: '晴', icon: 'sun', cloud: 0, rain: 0, dur: [300, 520] },
  cloudy: { name: '多云', icon: 'cloud', cloud: 0.6, rain: 0, dur: [70, 130] },
  rain: { name: '下雨', icon: 'rain', cloud: 1, rain: 1, dur: [60, 100] }
};
// 多云之后 25% 概率下雨，其余转晴 → 实测约 10% 的时间在下雨
const NEXT = { clear: ['cloudy'], cloudy: ['rain', 'clear', 'clear', 'clear'], rain: ['cloudy'] };

// 一天中的光照关键帧（小时 → 颜色/强度）；amb 是水面、瀑布等自发光材质的整体染色
const NIGHT = { sun: '#a4b4f0', si: 0.7, sky: '#6274a8', gnd: '#343b52', hi: 1.0, fog: '#2a3f5a', amb: '#8093c0' };
const DAY = { sun: '#fff4e2', si: 2.7, sky: '#e8f6ff', gnd: '#c4ab88', hi: 1.35, fog: '#8ccbd0', amb: '#ffffff' };
const KEYS = [
  { h: 0, ...NIGHT }, { h: 4.8, ...NIGHT },
  { h: 6.0, sun: '#ffc09a', si: 1.8, sky: '#d8c8e4', gnd: '#857888', hi: 1.0, fog: '#eab8a0', amb: '#f0d0c4' },
  { h: 7.5, ...DAY }, { h: 16.0, ...DAY },
  // 黄金时刻：低角度的暖金色主光 + 偏蓝紫的天光补光（阴影发冷），雾/地平线是桃橙色
  { h: 17.2, sun: '#ffc27c', si: 3.1, sky: '#a8c4ee', gnd: '#b08a68', hi: 0.95, fog: '#f2c49a', amb: '#ffe4c8' },
  { h: 18.3, sun: '#ff9858', si: 2.4, sky: '#b0a0d0', gnd: '#7a5a58', hi: 0.85, fog: '#f0a47c', amb: '#ffd0b4' },
  { h: 19.3, sun: '#e8a494', si: 1.1, sky: '#9a92c4', gnd: '#5a5270', hi: 1.0, fog: '#6a6690', amb: '#b0a4d0' },
  { h: 20.5, ...NIGHT }, { h: 24, ...NIGHT }
].map(k => ({ ...k, sun: new THREE.Color(k.sun), sky: new THREE.Color(k.sky), gnd: new THREE.Color(k.gnd), fog: new THREE.Color(k.fog), amb: new THREE.Color(k.amb) }));
const GREY = new THREE.Color('#8e9aa4'), RAIN_FOG = new THREE.Color('#6f8490');

export function createEnvironment({ scene, hemi, sun, sfx, renderer, terrainMaterial }) {
  const env = {
    hour: 8.5, day: 1,
    weather: 'clear', wTimer: 180, cloud: 0, rain: 0, wet: 0,
    nightness: 0, sunDir: new THREE.Vector3(0.55, 0.85, 0.4).normalize()
  };
  const tmp = { sun: new THREE.Color(), sky: new THREE.Color(), gnd: new THREE.Color(), fog: new THREE.Color(), amb: new THREE.Color() };
  env.viewFar = 1; env.golden = 0;
  const discLow = new THREE.Vector3();

  // ─── 天空穹顶（自由视角能看到地平线）：地平线 = 雾色，天顶更深，带太阳/月亮光晕 ───
  // 天空：地平线颜色随方位变化（太阳一侧橙黄、背面淡紫），天顶两侧冷暖不同；
  // 云是投影到高空平面上的分形噪声：朝太阳的一面染成金橙/粉色，背光的一侧是压着的暗紫色积雨云，偶尔有闪电
  const skyU = { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSun: { value: env.sunDir }, uSunCol: { value: new THREE.Color() }, uNight: { value: 0 },
    uDisc: waterLight.uDisc, uGolden: waterLight.uGolden, uTime: { value: 0 }, uCloud: { value: 0 }, uStorm: { value: 0 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(360, 48, 24), new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uTop, uHorizon, uSunCol, uSun, uDisc; uniform float uNight, uGolden, uTime, uCloud, uStorm; varying vec3 vDir;
      float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + 1.0), f.x), f.y); }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n2(p); p = p * 2.07 + 13.1; a *= 0.5; } return v; }
      ${HORIZON_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        vec2 dh = normalize(d.xz + 1e-5), sh = normalize(uDisc.xz + 1e-5);
        float az = clamp(dot(dh, sh) * 0.5 + 0.5, 0.0, 1.0), sunSide = pow(az, 2.5) * uGolden, away = pow(1.0 - az, 1.3) * uGolden;
        vec3 hor = skyHorizon(d, uHorizon, uDisc, uGolden);
        vec3 top = mix(uTop, vec3(0.62, 0.3, 0.2), sunSide * 0.6);
        top = mix(top, vec3(0.05, 0.07, 0.2), away * 0.75);
        vec3 col = mix(hor, top, pow(y, 0.45));
        float sd = max(dot(d, normalize(uDisc)), 0.0);
        vec3 sunC = uSunCol * (1.0 + uGolden * 0.4);
        col += sunC * (pow(sd, 1400.0) * 8.0 + pow(sd, 90.0) * 0.9 * (0.3 + uGolden) + pow(sd, 8.0) * 0.35 * uGolden);
        // 云
        vec2 uv = d.xz / (max(d.y, 0.0) + 0.1) * 0.9 + vec2(uTime * 0.006, uTime * 0.003);
        float cn = fbm(uv * 1.1) * 0.7 + fbm(uv * 3.3 + 7.0) * 0.3;
        // 积雨云压在画面右侧（离太阳方位角约 40° 以外），越往背光一侧越浓
        float storm = smoothstep(0.86, 0.6, az) * uStorm;
        col = mix(col, vec3(0.13, 0.11, 0.26), storm * 0.55 * smoothstep(0.0, 0.12, d.y));
        float cov = mix(0.58, 0.4, max(storm, uCloud));
        float c = smoothstep(cov, cov + 0.22, cn) * smoothstep(-0.005, 0.035, d.y);
        float thick = smoothstep(cov + 0.05, cov + 0.4, cn);
        vec3 cDay = mix(vec3(1.0), uTop * 1.3, 0.15) * (1.0 - thick * 0.25);
        vec3 cLit = mix(vec3(0.85, 0.36, 0.34), vec3(1.25, 0.62, 0.26), sunSide / max(uGolden, 0.01));
        vec3 cDark = vec3(0.12, 0.1, 0.22) * (1.0 - thick * 0.35);
        vec3 cGold = mix(cLit, cDark, smoothstep(0.35, 0.95, 1.0 - az) * (0.5 + thick * 0.5));
        cGold = mix(cGold, cDark * (1.0 + (1.0 - thick) * 1.4) + vec3(0.1, 0.05, 0.12) * (1.0 - thick), storm * 0.9);
        vec3 cc = mix(cDay, cGold, uGolden);
        cc += sunC * pow(sd, 10.0) * (1.0 - thick) * 1.2;                       // 太阳附近云边透光
        cc = mix(cc, vec3(0.45, 0.48, 0.52), uCloud * 0.5) * (1.0 - uNight * 0.85);
        col = mix(col, cc, c * (1.0 - uNight * 0.4));
        // 闪电：背光一侧的积雨云里偶尔劈一道
        float slot = floor(uTime * 0.45), rnd = fract(sin(slot * 91.7) * 43758.5), ft = fract(uTime * 0.45) / 0.45;
        float on = step(0.3, rnd) * (step(ft, 0.12) + step(0.2, ft) * step(ft, 0.38)) * uStorm;
        if (on > 0.0) {
          float ang = atan(d.x, -d.z), a0 = 0.3 + rnd * 0.22;
          float jag = (n2(vec2(d.y * 60.0, slot)) - 0.5) * 0.05 + (n2(vec2(d.y * 220.0, slot + 3.0)) - 0.5) * 0.014;
          float bolt = (1.0 - smoothstep(0.0, 0.0026, abs(ang - a0 - jag))) * smoothstep(0.01, 0.03, d.y) * (1.0 - smoothstep(0.14, 0.17, d.y));
          col += vec3(1.3, 1.2, 1.8) * bolt * on + vec3(0.25, 0.22, 0.4) * c * storm * on * (1.0 - smoothstep(0.0, 0.25, abs(ang - a0)));
        }
        float star = step(0.9975, h(floor(vDir * 420.0))) * smoothstep(0.1, 0.4, y) * uNight;
        col += vec3(star);
        // 保证输出有限值：NaN/Inf 会被泛光扩散成整块黑屏
        col = clamp(col, 0.0, 64.0);
        if (col.r != col.r || col.g != col.g || col.b != col.b) col = uHorizon;
        gl_FragColor = vec4(col, 1.0);
      }`
  }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  env.sky = sky;

  // ─── 湿地反射：定期把天空烘成环境贴图，只给地面用（雨越大反射越强）───
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), sky.material); envScene.add(envSky);
  let envRT = null, envTimer = 0;
  function bakeEnv() {
    const old = envRT; envRT = pmrem.fromScene(envScene, 0, 0.1, 100);
    terrainMaterial.envMap = envRT.texture; terrainMaterial.needsUpdate = !old;
    old?.dispose();
  }

  // ─── 雨滴落地溅起的小水花（地面上的小皇冠）───
  const SPL = 260;
  const crownGeo = new THREE.CylinderGeometry(0.1, 0.035, 0.1, 9, 1, true); crownGeo.translate(0, 0.05, 0);
  const splash = new THREE.InstancedMesh(crownGeo, new THREE.MeshBasicMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }), SPL);
  splash.frustumCulled = false; splash.count = 0; scene.add(splash);
  const dropGeo = new THREE.SphereGeometry(0.03, 5, 4);
  const hops = new THREE.InstancedMesh(dropGeo, splash.material, SPL); hops.frustumCulled = false; hops.count = 0; scene.add(hops);
  const splashes = Array.from({ length: SPL }, () => ({ x: 0, y: 0, z: 0, t: Math.random() * 0.4, life: 0.4 }));
  const so = new THREE.Object3D();

  // ─── 雨丝 ───
  const RAIN_N = 1600, RAIN_BOX = 26;
  const rainMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.45, 0.018),
    new THREE.MeshBasicMaterial({ color: '#d6ecff', transparent: true, opacity: 0.5, depthWrite: false }), RAIN_N);
  rainMesh.frustumCulled = false; rainMesh.count = 0; scene.add(rainMesh);
  const drops = Array.from({ length: RAIN_N }, () => new THREE.Vector3((Math.random() - 0.5) * 2 * RAIN_BOX, Math.random() * 10, (Math.random() - 0.5) * 2 * RAIN_BOX));
  const dm = new THREE.Object3D(); dm.rotation.z = 0.12;

  // ─── 萤火虫 ───
  const FF = 90;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(FF * 3), ffSeed = Array.from({ length: FF }, () => [Math.random() * 60 - 30, Math.random() * 60 - 30, Math.random() * 10]);
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  const ffMat = new THREE.PointsMaterial({ color: new THREE.Color(3.2, 3.4, 1.4), size: 0.22, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const fireflies = new THREE.Points(ffGeo, ffMat); fireflies.frustumCulled = false; scene.add(fireflies);

  // ─── 随风飘的花瓣和落叶：在镜头周围一个盒子里循环，顺风飘、上下起伏、翻转 ───
  const DRIFT = 150, DBOX = 22;
  const petalGeo = (() => {   // 樱花瓣：底部尖、顶端带一个小缺口，略微卷曲
    const sh = new THREE.Shape(); sh.moveTo(0, -0.07);
    sh.bezierCurveTo(0.06, -0.03, 0.065, 0.04, 0.03, 0.07); sh.lineTo(0, 0.05); sh.lineTo(-0.03, 0.07);
    sh.bezierCurveTo(-0.065, 0.04, -0.06, -0.03, 0, -0.07);
    const g = new THREE.ShapeGeometry(sh, 4); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getX(i) * p.getX(i) * 4);
    g.computeVertexNormals(); return g;
  })();
  const drift = new THREE.InstancedMesh(petalGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, emissive: '#ff9ac4', emissiveIntensity: 0.55 }), DRIFT);
  drift.frustumCulled = false; scene.add(drift);
  const DCOLS = ['#ffd6e6', '#ffc2da', '#ffb0cf', '#ffe6f0', '#f9a6c8', '#ffffff'].map(c => new THREE.Color(c));
  const dp = Array.from({ length: DRIFT }, (_, i) => ({
    x: (Math.random() - 0.5) * 2 * DBOX, y: Math.random() * 7, z: (Math.random() - 0.5) * 2 * DBOX,
    ph: Math.random() * 6.28, spin: 1 + Math.random() * 2.5, s: i % 3 === 0 ? 1.5 : 0.8 + Math.random() * 0.5, sink: 0.25 + Math.random() * 0.35
  }));
  dp.forEach((d, i) => { drift.setColorAt(i, DCOLS[i % DCOLS.length]); d.s = 1.3 + Math.random() * 0.6; });
  const dO = new THREE.Object3D(), WIND = new THREE.Vector2(0.85, 0.5).normalize();
  function updateDrift(dt, target) {
    const t = performance.now() / 1000, wind = 1.4 + env.cloud * 0.8;
    drift.visible = env.rain < 0.5;
    if (!drift.visible) return;
    for (let i = 0; i < DRIFT; i++) {
      const d = dp[i];
      d.x += (WIND.x * wind + Math.sin(t * 0.7 + d.ph) * 0.6) * dt;
      d.z += (WIND.y * wind + Math.cos(t * 0.5 + d.ph) * 0.6) * dt;
      d.y -= d.sink * dt; d.y += Math.sin(t * 1.3 + d.ph) * 0.4 * dt;
      // 出了盒子就从另一边补回来
      if (d.x > DBOX) d.x -= 2 * DBOX; if (d.x < -DBOX) d.x += 2 * DBOX;
      if (d.z > DBOX) d.z -= 2 * DBOX; if (d.z < -DBOX) d.z += 2 * DBOX;
      if (d.y < 0) d.y += 7;
      const gx = target.x + d.x, gz = target.z + d.z;
      dO.position.set(gx, Math.max(groundHeight(gx, gz), 0) + 0.3 + d.y, gz);
      dO.rotation.set(t * d.spin + d.ph, t * d.spin * 0.7, Math.sin(t * 2 + d.ph) * 0.8);
      dO.scale.setScalar(d.s); dO.updateMatrix();
      drift.setMatrixAt(i, dO.matrix);
    }
    drift.instanceMatrix.needsUpdate = true;
  }

  // ─── 海鸥 ───
  const gulls = Array.from({ length: 4 }, () => { const o = buildGull(); o.visible = false; scene.add(o); return { o, active: false }; });
  let gullTimer = 4;
  function spawnGull(target) {
    const g = gulls.find(g => !g.active); if (!g) return;
    const a = Math.random() * Math.PI * 2, dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((Math.random() - 0.5) * 14);
    // 俯视镜头下高处的东西会投到画面外：飞低一点，航线往镜头一侧（+z）偏，好让它们穿过画面
    g.h = 5.8 + Math.random() * 1.8;
    side.z += g.h * 1.05;
    g.from = target.clone().addScaledVector(dir, -48).add(side); g.to = target.clone().addScaledVector(dir, 48).add(side); g.t = 0; g.dur = 96 / (5 + Math.random() * 3); g.bend = (Math.random() - 0.5) * 16;
    g.active = true; g.o.visible = true; g.cried = false; g.phase = Math.random() * 6;
    // 偶尔成群：带一只跟班
    if (Math.random() < 0.4) {
      const f = gulls.find(x => !x.active);
      if (f) Object.assign(f, { from: g.from.clone().add(new THREE.Vector3(1.5, 0, -2)), to: g.to.clone().add(new THREE.Vector3(1.5, 0, -2)),
        h: g.h + 0.8, t: -0.02, dur: g.dur, bend: g.bend, active: true, cried: true, phase: g.phase + 1.3 }), f.o.visible = true;
    }
  }
  function updateGulls(dt, target) {
    const canFly = env.nightness < 0.5 && env.rain < 0.6;
    if (canFly && (gullTimer -= dt) <= 0) { spawnGull(target); gullTimer = 7 + Math.random() * 14; }
    for (const g of gulls) {
      if (!g.active) continue;
      g.t += dt / g.dur;
      if (g.t >= 1) { g.active = false; g.o.visible = false; continue; }
      const t = Math.max(0, g.t);
      const p = g.from.clone().lerp(g.to, t);
      const perp = new THREE.Vector3(-(g.to.z - g.from.z), 0, g.to.x - g.from.x).normalize();
      p.addScaledVector(perp, Math.sin(t * Math.PI) * g.bend);
      p.y = Math.max(g.h, groundHeight(p.x, p.z) + 2.5) + Math.sin(t * 9 + g.phase) * 0.3;
      const prev = g.o.position.clone();
      g.o.position.copy(p);
      const v = p.clone().sub(prev);
      if (v.lengthSq() > 1e-6) { g.o.rotation.y = Math.atan2(v.x, v.z); g.o.rotation.z = -perpBank(g, t) ; }
      // 扑翅 1.4 秒 / 滑翔 2 秒循环
      const cyc = (g.t * g.dur + g.phase) % 3.4, flap = cyc < 1.4;
      const w = flap ? Math.sin(cyc * 11) : 0;
      for (const { inner, outer, sx } of g.o.userData.parts.wings) {
        inner.rotation.z = sx * (flap ? w * 0.55 : 0.08);
        outer.rotation.z = sx * (flap ? Math.sin(cyc * 11 - 0.9) * 0.45 : -0.12);
      }
      if (!g.cried && t > 0.4 && p.distanceTo(target) < 22) { g.cried = true; if (Math.random() < 0.7) sfx.gull(); }
    }
  }
  const perpBank = (g, t) => Math.cos(t * Math.PI) * Math.sign(g.bend) * 0.25;

  // ─── 天气状态机 ───
  function setWeather(type, announce) {
    env.weather = type;
    const d = WEATHER[type].dur;
    env.wTimer = d[0] + Math.random() * (d[1] - d[0]);
    if (announce) env.onWeather?.(type);
  }

  function updateLight() {
    const h = env.hour;
    let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
    const a = KEYS[i], b = KEYS[i + 1], k = (h - a.h) / (b.h - a.h || 1);
    for (const key of ['sun', 'sky', 'gnd', 'fog', 'amb']) tmp[key].copy(a[key]).lerp(b[key], k);
    let si = a.si + (b.si - a.si) * k, hi = a.hi + (b.hi - a.hi) * k;
    // 云和雨：压暗、偏灰、雾拉近
    const c = env.cloud;
    si *= 1 - 0.6 * c; hi *= 1 - 0.12 * c;
    tmp.sky.lerp(GREY, 0.45 * c); tmp.sun.lerp(GREY, 0.3 * c);
    tmp.fog.lerp(RAIN_FOG, 0.55 * env.rain * (1 - env.nightness * 0.6));
    tmp.amb.multiplyScalar(1 - 0.18 * c);
    sun.color.copy(tmp.sun); sun.intensity = si;
    hemi.color.copy(tmp.sky); hemi.groundColor.copy(tmp.gnd); hemi.intensity = hi;
    scene.fog.color.copy(tmp.fog); scene.background.copy(tmp.fog).multiplyScalar(0.55);
    scene.fog.near = (70 - 30 * env.rain) * env.viewFar; scene.fog.far = (150 - 45 * env.rain) * env.viewFar;
    skyU.uHorizon.value.copy(tmp.fog); skyU.uTop.value.copy(tmp.sky).lerp(new THREE.Color('#1a4f9a'), 0.45).multiplyScalar(0.75 + 0.25 * (1 - env.nightness));
    skyU.uSunCol.value.copy(tmp.sun).multiplyScalar(1 - env.cloud * 0.8); skyU.uNight.value = env.nightness * (1 - env.cloud);
    // 太阳东升（+x）、正午偏南、西落（-x）；傍晚压得很低，影子拉长。夜里换成月亮（固定在西北高空）
    const day = THREE.MathUtils.clamp((h - 5.5) / 14, 0, 1), arc = Math.sin(day * Math.PI);
    const sunV = new THREE.Vector3(Math.cos(day * Math.PI), arc * 1.05 + 0.02, arc * 0.7).normalize();
    const moonV = new THREE.Vector3(-0.45, 0.85, -0.3).normalize();
    env.sunDir.copy(sunV).lerp(moonV, env.nightness).normalize();
    // 黄金时刻强度；天空里画出来的太阳贴着地平线、落在固定镜头看得见的北侧天空
    const ss = THREE.MathUtils.smoothstep;
    env.golden = (ss(h, 15.8, 17.3) * (1 - ss(h, 19.5, 20.4)) + ss(h, 4.9, 5.7) * (1 - ss(h, 7.0, 8.2))) * (1 - env.cloud * 0.7);
    discLow.set(sunV.x * 0.82, 0.05 + Math.max(0, sunV.y - 0.3) * 0.1, -0.76).normalize();
    waterLight.uDisc.value.copy(env.sunDir).lerp(discLow, env.golden).normalize();
    waterLight.uGolden.value = env.golden;
    skyU.uCloud.value = env.cloud; skyU.uStorm.value = Math.max(env.golden * 0.9, env.rain) * (1 - env.nightness);
    waterLight.uSunDir.value.copy(env.sunDir);
    waterLight.uSunCol.value.copy(tmp.sun);
    waterLight.uAmb.value.copy(tmp.amb);
    waterLight.uRain.value = env.rain;
    waterLight.uFogCol.value.copy(scene.fog.color); waterLight.uFogNear.value = scene.fog.near; waterLight.uFogFar.value = scene.fog.far;
  }

  env.update = (dt, target) => {
    sky.position.copy(target);
    skyU.uTime.value += dt;
    env.hour += dt * 24 / DAY_SECONDS;
    if (env.hour >= 24) { env.hour -= 24; env.day++; }
    const h = env.hour;
    const nightT = h >= 20.5 || h < 4.8 ? 1 : h > 19.3 ? (h - 19.3) / 1.2 : h < 6 ? 1 - (h - 4.8) / 1.2 : 0;
    env.nightness = THREE.MathUtils.clamp(nightT, 0, 1);
    if (!(env.wTimer <= WEATHER[env.weather].dur[1])) env.wTimer = WEATHER[env.weather].dur[1];   // 计时器异常（NaN/过大）时兜底
    if ((env.wTimer -= dt) <= 0) { const opts = NEXT[env.weather]; setWeather(opts[Math.floor(Math.random() * opts.length)], true); }
    const W = WEATHER[env.weather];
    env.cloud += (W.cloud - env.cloud) * Math.min(1, dt / 8);
    env.rain += (W.rain - env.rain) * Math.min(1, dt / 6);
    env.wet = Math.max(env.rain, env.wet - dt / 90);
    terrainUniforms.uWet.value = env.wet;
    updateLight();

    // 雨丝跟着镜头目标
    const n = Math.floor(RAIN_N * env.rain);
    rainMesh.count = n;
    for (let i = 0; i < n; i++) {
      const d = drops[i];
      d.y -= dt * 22; d.x += dt * 2.6;
      if (d.y < -1) { d.y += 11; d.x = (Math.random() - 0.5) * 2 * RAIN_BOX; d.z = (Math.random() - 0.5) * 2 * RAIN_BOX; }
      dm.position.set(target.x + d.x, target.y + d.y, target.z + d.z); dm.updateMatrix();
      rainMesh.setMatrixAt(i, dm.matrix);
    }
    if (n) rainMesh.instanceMatrix.needsUpdate = true;
    // 地面水花：只在陆地上（水面已有涟漪），以镜头目标为中心
    const sn = Math.floor(SPL * env.rain);
    splash.count = hops.count = sn;
    for (let i = 0; i < sn; i++) {
      const o = splashes[i]; o.t += dt;
      if (o.t >= o.life) {
        for (let k = 0; k < 4; k++) {
          o.x = target.x + (Math.random() - 0.5) * 34; o.z = target.z + (Math.random() - 0.5) * 26;
          o.y = groundHeight(o.x, o.z); if (o.y > env.waterLevel(o.x, o.z) + 0.02) break;
        }
        o.t = 0; o.life = 0.22 + Math.random() * 0.18;
      }
      const k = o.t / o.life;
      so.position.set(o.x, o.y + 0.01, o.z); so.rotation.set(0, 0, 0);
      so.scale.set(0.4 + k * 1.3, (1 - k) * 1.1, 0.4 + k * 1.3); so.updateMatrix(); splash.setMatrixAt(i, so.matrix);
      so.position.set(o.x + Math.sin(i) * 0.08 * k, o.y + Math.sin(k * Math.PI) * 0.16, o.z + Math.cos(i) * 0.08 * k); so.scale.setScalar(1 - k * 0.6); so.updateMatrix();
      hops.setMatrixAt(i, so.matrix);
    }
    if (sn) { splash.instanceMatrix.needsUpdate = true; hops.instanceMatrix.needsUpdate = true; }
    // 环境贴图每 4 秒重烘一次（只在地面湿的时候才需要）
    if (env.wet > 0.02 && (envTimer -= dt) <= 0) { envTimer = 4; envSky.position.set(0, 0, 0); bakeEnv(); }
    terrainMaterial.envMapIntensity = env.wet;
    sfx.setRain?.(env.rain);

    // 萤火虫：夜里、地面上、不下雨时出现
    const ffOn = env.nightness * (1 - env.rain);
    ffMat.opacity = ffOn;
    if (ffOn > 0.01) {
      const t = performance.now() / 1000;
      for (let i = 0; i < FF; i++) {
        const [sx, sz, ph] = ffSeed[i];
        const x = target.x + sx + Math.sin(t * 0.3 + ph) * 2, z = target.z + sz + Math.cos(t * 0.25 + ph * 1.3) * 2;
        ffPos[i * 3] = x; ffPos[i * 3 + 1] = Math.max(groundHeight(x, z), 0.3) + 0.6 + Math.sin(t * 1.3 + ph) * 0.4; ffPos[i * 3 + 2] = z;
      }
      ffGeo.attributes.position.needsUpdate = true;
      ffMat.size = 0.18 + Math.sin(t * 5) * 0.04;
    }
    if (env.nightness > 0.6 && env.rain < 0.3 && Math.random() < dt * 1.5) sfx.cricket?.();
    updateGulls(dt, target);
    updateDrift(dt, target);
  };

  env.isNight = () => env.nightness > 0.5;
  env.clockText = () => {
    const hh = Math.floor(env.hour), mm = Math.floor((env.hour - hh) * 60 / 10) * 10;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  env.phaseIcon = () => env.weather === 'rain' ? 'rain' : env.nightness > 0.5 ? 'moon' : (env.hour < 7.5 || env.hour > 17.5) ? 'dusk' : WEATHER[env.weather].icon;
  env.weatherName = () => WEATHER[env.weather].name;
  env.skipTo = (hour) => { if (hour <= env.hour) env.day++; env.hour = hour; };
  env.serialize = () => ({ hour: env.hour, day: env.day, weather: env.weather, wTimer: env.wTimer });
  env.load = (d) => {
    if (!d) return;
    // 读档时天气一律从晴天重新开始（不继承存档时的雨），计时器也重新抽
    Object.assign(env, { hour: d.hour, day: d.day });
    setWeather('clear');
    env.cloud = env.rain = env.wet = 0;
  };
  env.setWeather = setWeather;
  env.waterLevel = () => 0;
  env._gulls = gulls;
  updateLight();
  return env;
}

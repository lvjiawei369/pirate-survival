// 荒野之息式草地：
//  · 以镜头为中心按 12 米一块的地块生成，每块几千根细长草叶（远处的块自动减半）
//  · 风：大尺度的阵风一波波推过草地——草被压弯的同时颜色变亮，能看到“风的形状”
//  · 草叶颜色从根部深绿到草尖黄绿，每根有细微色差
//  · 主角走过时草向两边分开
//  · 法线统一朝上：整片草像一张柔软的毯子被太阳照亮，而不是一根根杂乱的反光
import * as THREE from 'three';
import { terrainHeight, onDock, waterLevelAt, TIDE, dirtAt, sandAt } from './terrain.js';

const TILE = 12, DENSITY = 20, RADIUS = 50, LOD_NEAR = 16, FLOWERS = 1.2;   // 每平方米小花数（只长在花丛区）

function bladeGeometry() {
  // 5 段、带一点前倾弧度、向上收尖的草叶；y 为 0..1（实际高度由实例缩放决定）
  const SEG = 4, pos = [], idx = [], nor = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG, w = 0.075 * Math.pow(1 - t, 0.8) + 0.004, z = t * t * 0.22;
    pos.push(-w, t, z, w, t, z);
    nor.push(0, 1, 0, 0, 1, 0);
    if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export function createGrass(scene, { blocked = () => false } = {}) {
  const uniforms = { uTime: { value: 0 }, uWind: { value: 1 }, uPlayer: { value: new THREE.Vector3(0, -99, 0) }, uWet: { value: 0 } };
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uWind; uniform vec3 uPlayer;
        attribute float aRand;
        varying float vH; varying float vGust; varying float vRand; varying vec2 vXZ;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + 1.0), f.x), f.y); }`)
      .replace('#include <project_vertex>', `
        vec4 root = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 ip = instanceMatrix * vec4(transformed, 1.0);
        float t = position.y, hgt = length(instanceMatrix[1].xyz);
        // 阵风：沿风向推进的宽波 + 噪声打散 → 一片一片被压倒
        vec2 wdir = normalize(vec2(0.85, 0.5));
        float along = dot(root.xz, wdir);
        float gust = sin(along * 0.16 - uTime * 1.9 + gNoise(root.xz * 0.05) * 3.0) * 0.5 + 0.5;
        gust = smoothstep(0.35, 1.0, gust) * (0.6 + 0.4 * gNoise(root.xz * 0.08 + uTime * 0.15));
        float flutter = sin(uTime * 5.5 + aRand * 40.0) * 0.06 + sin(uTime * 9.0 + aRand * 17.0) * 0.03;
        vec2 bend = wdir * (0.12 + gust * 0.75 + flutter) * uWind;
        // 主角走过：草向外分开
        vec2 away = root.xz - uPlayer.xz;
        float d = length(away);
        float push = (1.0 - smoothstep(0.35, 1.4, d)) * step(abs(root.y - uPlayer.y), 1.5);
        bend += (away / max(d, 0.001)) * push * 1.3;
        float k = t * t;
        ip.xz += bend * k * hgt;
        ip.y -= dot(bend, bend) * k * hgt * 0.35;
        vH = t; vGust = gust * uWind; vRand = aRand; vXZ = root.xz;
        vec4 mvPosition = modelViewMatrix * ip;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader
      // 草叶正反两面都用“朝天”的法线：否则双面材质会把背面法线翻向地面，背面整片发黑
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`)
      .replace('#include <common>', `#include <common>
        uniform float uWet;
        varying float vH; varying float vGust; varying float vRand; varying vec2 vXZ;
        float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float fNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(fHash(i), fHash(i + vec2(1, 0)), f.x), mix(fHash(i + vec2(0, 1)), fHash(i + 1.0), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // 大片的色块：有的草场偏青、有的偏黄（线性色值）
          float patchv = fNoise(vXZ * 0.045) * 0.7 + fNoise(vXZ * 0.13) * 0.3;
          // 纯绿色系：根部中绿、草尖亮绿，色块只在绿色里变深浅，不往黄偏
          // 暖色阳光和色调映射会把绿推向黄，所以基色略偏蓝绿来抵消
          // 和地面草地同一套绿（地面 #3f9a50 / #52b062 的线性值），草尖稍亮一点，看起来是地面长出来的
          // 夕照下的草：根部橄榄绿，草尖黄绿（和地面 #58a53f / #78bb46 衔接）
          vec3 root = mix(vec3(0.07, 0.28, 0.035), vec3(0.11, 0.36, 0.05), patchv);
          vec3 tip = mix(vec3(0.16, 0.44, 0.06), vec3(0.27, 0.55, 0.09), patchv * 0.8 + vRand * 0.25);
          vec3 c = mix(root, tip, smoothstep(0.0, 1.0, pow(vH, 0.85)));
          c *= 0.94 + vRand * 0.12;
          // 阵风压过的草叶反光更亮（荒野之息里那种一道道亮波）
          c += vec3(0.03, 0.09, 0.04) * vGust * vH;
          c *= 1.0 - uWet * 0.25;
          diffuseColor.rgb = c;
        }`);
  };

  const geo = bladeGeometry();
  const tiles = new Map();
  const dummy = new THREE.Object3D();
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  function buildTile(ti, tj) {
    const x0 = ti * TILE, z0 = tj * TILE;
    // 1 米网格上先算高度和“能不能长草”，草叶再在格子里插值
    const N = TILE + 1, H = new Float32Array(N * N), ok = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = x0 + i, z = z0 + j, h = terrainHeight(x, z);
      H[j * N + i] = h;
      ok[j * N + i] = h > 1.02 && h < 26 && !onDock(x, z) && waterLevelAt(x, z, TIDE.high) < h - 0.08 && dirtAt(x, z) < 0.45 && sandAt(x, z) < 0.35 ? 1 : 0;
    }
    const pts = [];
    seed = (ti * 73856093) ^ (tj * 19349663) | 1; seed = Math.abs(seed) % 2147483646 + 1;
    const want = TILE * TILE * DENSITY;
    for (let n = 0; n < want; n++) {
      const fx = rnd() * TILE, fz = rnd() * TILE, i = Math.min(TILE - 1, fx | 0), j = Math.min(TILE - 1, fz | 0);
      const a = j * N + i;
      if (!(ok[a] && ok[a + 1] && ok[a + N] && ok[a + N + 1])) { rnd(); rnd(); rnd(); continue; }
      const u = fx - i, v = fz - j;
      const h = (H[a] * (1 - u) + H[a + 1] * u) * (1 - v) + (H[a + N] * (1 - u) + H[a + N + 1] * u) * v;
      const slope = Math.abs(H[a + 1] - H[a]) + Math.abs(H[a + N] - H[a]);
      const r = rnd(), r2 = rnd(), r3 = rnd();
      if (slope > 0.55) continue;
      const x = x0 + fx, z = z0 + fz;
      if (blocked(x, z)) continue;
      // 高草丛和矮草地交错：低频噪声决定这一片的草有多高
      const tall = 0.5 + 0.5 * Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) * Math.cos(z * 0.09 - x * 0.03);
      const hgt = (0.1 + tall * 0.14) * (0.75 + r * 0.5) * (1 - slope * 0.6);   // 短草坪：到脚踝
      pts.push(x, h - 0.03, z, hgt, r2 * Math.PI * 2, r3);
    }
    const count = pts.length / 6;
    const flowers = buildFlowers(x0, z0, N, H, ok);
    if (!count) { tiles.set(`${ti},${tj}`, { mesh: null, pts, count: 0, flowers }); return; }
    // 打乱顺序：远处只画前一半时也是均匀变稀
    for (let k = count - 1; k > 0; k--) {
      const m = Math.floor(rnd() * (k + 1));
      for (let q = 0; q < 6; q++) { const t = pts[k * 6 + q]; pts[k * 6 + q] = pts[m * 6 + q]; pts[m * 6 + q] = t; }
    }
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const rand = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      const [x, y, z, hgt, ry, r] = pts.slice(k * 6, k * 6 + 6);
      dummy.position.set(x, y, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(1, hgt, 1); dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix); rand[k] = r;
    }
    mesh.geometry = geo.clone(); mesh.geometry.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 1));
    mesh.receiveShadow = true; mesh.castShadow = false; mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = true;
    mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + TILE / 2, pts[1], z0 + TILE / 2), TILE * 0.75 + 3);
    mesh.computeBoundingSphere = () => {};
    mesh.boundingSphere = mesh.geometry.boundingSphere;
    scene.add(mesh);
    tiles.set(`${ti},${tj}`, { mesh, pts, count, flowers });
  }

  // ─── 草丛里的小花：4 种花形，粉色为主（70%）、白色 20%、黄色 10%，成丛出现 ───
  function flowerGeometry(shape) {
    const g = new THREE.BufferGeometry(), pos = [], col = [], idx = [];
    const petal = [1, 1, 1], ctr = [1, 0.85, 0.3];
    const P = (x, y, z, c) => { pos.push(x, y, z); col.push(...c); return pos.length / 3 - 1; };
    const center = P(0, 0.014, 0, ctr);
    // 圆润的花瓣：每片是一个从花心伸出的椭圆（经过花心），用扇形三角化，没有尖角
    const petalAt = (a, len, wid, lift, up = 0) => {
      const ca = Math.cos(a), sa = Math.sin(a), SEG = 14, first = pos.length / 3;
      for (let k = 1; k < SEG; k++) {
        const t = k / SEG * Math.PI * 2;
        const r = len * 0.5 * (1 - Math.cos(t)), w = wid * Math.sin(t);   // 沿花瓣方向 r、横向 w
        const f = r / len;
        P(ca * r - sa * w, lift * f + up * f * f, sa * r + ca * w, petal);
      }
      const last = pos.length / 3;
      for (let v = first; v < last - 1; v++) idx.push(center, v, v + 1);
    };
    const ring = (n, len, wid, lift, up = 0) => { for (let k = 0; k < n; k++) petalAt(k / n * Math.PI * 2, len, wid, lift, up); };
    if (shape === 0) ring(5, 0.062, 0.028, 0.008);             // 五瓣圆花（樱草）
    else if (shape === 1) ring(4, 0.066, 0.034, 0.01);         // 四瓣
    else if (shape === 2) ring(10, 0.072, 0.012, 0.004);       // 雏菊：细长圆头花瓣
    else ring(6, 0.05, 0.024, 0.02, 0.05);                     // 小杯形：花瓣向上卷
    const stem = [0.35, 0.8, 0.4];   // 乘上实例色后仍偏绿
    const sb = pos.length / 3; P(-0.004, -0.2, 0, stem); P(0.004, -0.2, 0, stem); P(0.004, 0, 0, stem); P(-0.004, 0, 0, stem);
    idx.push(sb, sb + 1, sb + 2, sb, sb + 2, sb + 3);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    return g;
  }
  const FLOWER_SHAPES = [0, 1, 2, 3].map(flowerGeometry);
  // 背面 Lambert 会发暗，加一点白色自发光把花瓣整体提亮
  const flowerMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0.35 });
  const PINKS = ['#ff9cc4', '#ffb3d1', '#ff85b5', '#ffc4dc', '#f77fb0'].map(c => new THREE.Color(c));
  const WHITES = ['#ffffff', '#fff6f0'].map(c => new THREE.Color(c));
  const YELLOWS = ['#ffd23a', '#ffe45a'].map(c => new THREE.Color(c));
  const cellHash = (x, z, s) => { const v = Math.sin(Math.floor(x / 3) * 12.9898 + Math.floor(z / 3) * 78.233 + s) * 43758.5453; return v - Math.floor(v); };
  function buildFlowers(x0, z0, N, H, ok) {
    const lists = [[], [], [], []];
    const want = TILE * TILE * FLOWERS * 2.5;
    for (let n = 0; n < want; n++) {
      const fx = rnd() * TILE, fz = rnd() * TILE, x = x0 + fx, z = z0 + fz;
      // 花丛区：低频噪声高的地方才有花；同一丛（3 米格）花形和色系相同
      const patchv = Math.sin(x * 0.19 + Math.sin(z * 0.13) * 2.3) * Math.cos(z * 0.17 - x * 0.05);
      if (patchv < 0.15 || rnd() > (patchv - 0.15) * 1.6) continue;
      const i = Math.min(TILE - 1, fx | 0), j = Math.min(TILE - 1, fz | 0), a = j * N + i;
      if (!(ok[a] && ok[a + 1] && ok[a + N] && ok[a + N + 1]) || blocked(x, z)) continue;
      const u = fx - i, v = fz - j;
      const h = (H[a] * (1 - u) + H[a + 1] * u) * (1 - v) + (H[a + N] * (1 - u) + H[a + N + 1] * u) * v;
      const shape = Math.floor(cellHash(x, z, 1.7) * 4);
      const c = cellHash(x, z, 5.3), pick = rnd();
      const color = c < 0.7 ? PINKS[Math.floor(pick * PINKS.length)] : c < 0.9 ? WHITES[Math.floor(pick * WHITES.length)] : YELLOWS[Math.floor(pick * YELLOWS.length)];
      lists[shape].push([x, h + 0.2 + rnd() * 0.1, z, rnd() * 6, 0.8 + rnd() * 0.6, color]);
    }
    const group = new THREE.Group();
    lists.forEach((list, shape) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(FLOWER_SHAPES[shape], flowerMat, list.length);
      list.forEach(([x, y, z, ry, sc, color], k) => {
        dummy.position.set(x, y, z); dummy.rotation.set(0.5 + (rnd() - 0.5) * 0.4, ry, (rnd() - 0.5) * 0.4); dummy.scale.setScalar(sc * 1.8); dummy.updateMatrix();
        m.setMatrixAt(k, dummy.matrix); m.setColorAt(k, color);
      });
      m.matrixAutoUpdate = false; m.receiveShadow = true; m.frustumCulled = false;
      group.add(m);
    });
    if (!group.children.length) return null;
    group.userData.center = new THREE.Vector3(x0 + TILE / 2, 0, z0 + TILE / 2);
    scene.add(group);
    return group;
  }

  // 每帧：生成缺的地块（每帧最多 2 块，避免卡顿）、隐藏远处的、按距离降密度
  let lastKey = '';
  function update(dt, center, player, { far = 1 } = {}) {
    uniforms.uTime.value += dt;
    uniforms.uPlayer.value.copy(player);
    const R = RADIUS * Math.min(far, 1.25), ci = Math.floor(center.x / TILE), cj = Math.floor(center.z / TILE), rt = Math.ceil(R / TILE);
    let built = 0;
    for (let dj = -rt; dj <= rt; dj++) for (let di = -rt; di <= rt; di++) {
      const ti = ci + di, tj = cj + dj, key = `${ti},${tj}`;
      const d = Math.hypot((ti + 0.5) * TILE - center.x, (tj + 0.5) * TILE - center.z);
      if (d > R + TILE) continue;
      if (!tiles.has(key)) { if (built < 2 || key === lastKey) { buildTile(ti, tj); built++; } else continue; }
    }
    for (const [, t] of tiles) {
      if (t.flowers) { const c = t.flowers.userData.center; t.flowers.visible = Math.hypot(c.x - center.x, c.z - center.z) < R * 0.8; }
      if (!t.mesh) continue;
      const c = t.mesh.boundingSphere.center, d = Math.hypot(c.x - center.x, c.z - center.z);
      t.mesh.visible = d < R + TILE * 0.5;
      if (t.mesh.visible) t.mesh.count = Math.ceil(t.count * (d < LOD_NEAR ? 1 : d < LOD_NEAR + 14 ? 0.45 : d < LOD_NEAR + 28 ? 0.2 : 0.09));
    }
  }
  // 预生成主角周围的地块（开局不闪）
  function warm(center) {
    const ci = Math.floor(center.x / TILE), cj = Math.floor(center.z / TILE);
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) if (!tiles.has(`${ci + di},${cj + dj}`)) buildTile(ci + di, cj + dj);
  }
  // 开垦田地：把田块范围内的草藏起来
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function clearAt(x, z, r = 0.8) {
    const t = tiles.get(`${Math.floor(x / TILE)},${Math.floor(z / TILE)}`);
    if (!t?.mesh) return;
    for (let k = 0; k < t.count; k++) {
      const px = t.pts[k * 6], pz = t.pts[k * 6 + 2];
      if (Math.abs(px - x) < r && Math.abs(pz - z) < r) t.mesh.setMatrixAt(k, zero);
    }
    t.mesh.instanceMatrix.needsUpdate = true;
  }
  return { update, warm, clearAt, uniforms, stats: () => [...tiles.values()].reduce((a, t) => a + (t.mesh?.visible ? t.mesh.count : 0), 0) };
}

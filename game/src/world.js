// 场景搭建：静态布景、可采集资源点、交互物和碰撞圆。所有位置落在 groundHeight 上。
// 碰撞圆带 top（顶面高度）和 climb 类型，攀爬系统用它们判断能不能爬、爬到多高。
import * as THREE from 'three';
import { terrainHeight, groundHeight, sandAt, MAP, LAYOUT, STACKS, TIDE, LOBES, POND, FALL_X, MOUNT, MASSIF, WEST, EAST, SOUTH, LAKES, RIVER, riverAt, inPond, fbm } from './terrain.js';
import { buildPond, buildWaterfall, buildRiver, waterLight } from './water.js';
import * as M from './models.js';
import * as D from './dressing.js';

function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function slopeAt(x, z) {
  const h = terrainHeight(x, z);
  return Math.max(Math.abs(terrainHeight(x + 0.6, z) - h), Math.abs(terrainHeight(x, z + 0.6) - h),
    Math.abs(terrainHeight(x - 0.6, z) - h), Math.abs(terrainHeight(x, z - 0.6) - h)) / 0.6;
}

export function buildWorld(scene, heightTex) {
  const colliders = [], resources = [], props = {};
  const placed = [];
  const place = (obj, x, z, ry = 0, dy = 0) => {
    obj.position.set(x, groundHeight(x, z) + dy, z); obj.rotation.y = ry; scene.add(obj); placed.push(obj); return obj;
  };
  const keep = [LAYOUT.spawn, LAYOUT.camp, LAYOUT.workbench, LAYOUT.campfire, LAYOUT.tent, LAYOUT.shrine, LAYOUT.chest, LAYOUT.totem,
    new THREE.Vector3(-12, 0, 15), new THREE.Vector3(-4, 0, 3), new THREE.Vector3(POND.x, 0, POND.z), new THREE.Vector3(FALL_X, 0, -11),
    new THREE.Vector3(LOBES.cove.x + 2, 0, LOBES.cove.z - 6),
    // 营地主画面的布景位：码头口、晒鱼架、桌子、洞口、宝藏、潮池、鹦鹉桩、山顶遗迹
    new THREE.Vector3(-14.6, 0, 10.6), new THREE.Vector3(-19.4, 0, 7.1), new THREE.Vector3(10.4, 0, 5.2), new THREE.Vector3(8.6, 0, 2.8), new THREE.Vector3(16.2, 0, -3.8),
    new THREE.Vector3(-4.6, 0, 20.1), new THREE.Vector3(9.5, 0, 17.5), new THREE.Vector3(-9.8, 0, -5.2), new THREE.Vector3(-6.5, 0, -19),
    LAYOUT.boat, new THREE.Vector3(-18.2, 0, 12.1), new THREE.Vector3(-24.9, 0, 15.5)];
  const inRiver = (x, z, pad) => Math.abs(x + 27) < 28 && Math.abs(z + 3) < 14 && riverAt(x, z).d < riverAt(x, z).w + pad;
  const clear = (x, z, r) => keep.every(k => Math.hypot(k.x - x, k.z - z) > r) && !inPond(x, z, 1.5) && !inRiver(x, z, 1.5) && !LAKES.some(L => Math.hypot(x - L.x, z - L.z) < L.r + 2);
  const taken = [];
  const free = (x, z, r) => taken.every(t => Math.hypot(t[0] - x, t[1] - z) > r + t[2]);
  const AREA = [-46, 32, -38, 30];                 // 起始岛
  const WORLD = [-230, 230, -210, 230];            // 全图
  function scatter(n, seed, test, minGap, area = AREA) {
    const out = [], rnd = rng(seed);
    for (let tries = 0; out.length < n && tries < 40000; tries++) {
      const x = area[0] + rnd() * (area[1] - area[0]), z = area[2] + rnd() * (area[3] - area[2]);
      const h = terrainHeight(x, z);
      if (!test(h, x, z) || !free(x, z, minGap)) continue;
      taken.push([x, z, minGap * 0.5]); out.push([x, z, rnd()]);
    }
    return out;
  }
  const flatEnough = (x, z, s = 0.5) => slopeAt(x, z) < s;

  // 石头贴合地形：取占地范围内最低点落座并略微埋入，坡太陡就不放（避免一边悬空一边穿模）
  function placeRock(seed, x, z, size, { collide = true, maxSpan = 1.0 } = {}) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2, h = terrainHeight(x + Math.cos(a) * size * 0.8, z + Math.sin(a) * size * 0.8);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    lo = Math.min(lo, terrainHeight(x, z));
    if (hi - lo > size * maxSpan) return null;
    const rock = M.buildBoulder(seed, size);
    rock.position.set(x, lo - size * 0.18, z); rock.rotation.y = seed * 1.3;
    scene.add(rock); placed.push(rock);
    if (collide) colliders.push({ x, z, r: size * 0.85, top: lo - size * 0.18 + size * 1.02, climb: 'rock' });
    taken.push([x, z, size]);
    return rock;
  }

  // ─── 营地 ───
  props.workbench = place(M.buildWorkbench(), LAYOUT.workbench.x, LAYOUT.workbench.z, -0.2);
  colliders.push({ x: LAYOUT.workbench.x, z: LAYOUT.workbench.z, r: 1.0 });
  props.campfire = place(M.buildCampfire(), LAYOUT.campfire.x, LAYOUT.campfire.z);
  colliders.push({ x: LAYOUT.campfire.x, z: LAYOUT.campfire.z, r: 0.7 });
  props.tent = place(M.buildTent(), LAYOUT.tent.x, LAYOUT.tent.z, LAYOUT.tent.ry);
  props.tent.scale.setScalar(1.22);   // 凉棚做大一点：营地主画面里它是右半边的视觉中心
  props.tent.userData.fadeMats = M.cloneMaterials(props.tent);
  colliders.push({ x: LAYOUT.tent.x, z: LAYOUT.tent.z, r: 1.7 });
  place(M.buildCrate(), 3.7, 2.0, 0.3); colliders.push({ x: 3.7, z: 2.0, r: 0.5 });
  place(M.buildCrate(), 3.8, 2.05, 1.1, 0.6).scale.setScalar(0.75);
  for (const [x, z] of [[2.8, 1.6], [10.9, 2.6], [11.6, 3.3], [11.1, 3.9]]) { place(M.buildBarrel(), x, z, x); colliders.push({ x, z, r: 0.4 }); }
  // 篝火边：两根坐凳圆木、晒鱼架、桌子
  for (const [x, z, ry] of [[6.1, 7.0, 1.0], [9.1, 7.2, -0.8]]) { place(D.buildLogSeat(), x, z, ry); colliders.push({ x, z, r: 0.45 }); }
  place(D.buildFishRack(), 10.4, 5.2, -0.4); colliders.push({ x: 10.4, z: 5.2, r: 0.9 });
  place(D.buildTable(), 8.6, 2.8, -0.2); colliders.push({ x: 8.6, z: 2.8, r: 0.85 });
  // 东崖洞口
  place(D.buildCaveMouth(), 16.2, -4.6, -0.1);
  colliders.push({ x: 16.2, z: -4.9, r: 1.6 }, { x: 18.1, z: -3.8, r: 0.6 }, { x: 14.3, z: -3.7, r: 0.5 });
  // 崖顶的棕榈和灌木（剪影），崖脚几丛蕨
  for (const [x, z, sc, i] of [[16.2, -9.4, 1.25, 3], [20.8, -7.2, 1.1, 6], [23.6, -10.2, 1.35, 1], [18.6, -11.6, 1.0, 4]]) {
    const pm = place(M.buildPalm(i), x, z, i); pm.scale.setScalar(sc); colliders.push({ x, z, r: 0.4 });
  }
  for (const [x, z, i] of [[14.8, -7.6, 1], [22.4, -6.2, 2], [19.2, -9.8, 3], [25.2, -8.4, 4]]) place(M.buildBush(i), x, z, i).scale.setScalar(1.3);
  for (const [x, z, i] of [[13.6, -4.2, 0], [18.9, -3.4, 1], [12.6, -2.8, 2], [20.4, -2.6, 3]]) { const f = place(M.buildFern(i), x, z, i); f.scale.setScalar(1.6); f.userData.kind = 'fern'; }
  // 沙滩上半埋的宝藏、山路口停着鹦鹉的木桩
  place(D.buildTreasure(), -4.6, 20.1, 0.3, -0.1).scale.setScalar(1.5); colliders.push({ x: -4.6, z: 20.1, r: 1.3 });
  place(D.buildParrotPerch(), -9.8, -5.2, 0.5).scale.setScalar(1.3); colliders.push({ x: -9.8, z: -5.2, r: 0.3 });
  for (const [x, z] of [[-6.5, 11.8], [-2, 12.8]]) { const l = M.buildDriftwood(x); place(l, x, z, x); l.scale.setScalar(1.3); }
  // 营地围栏与路灯：路灯夜里点亮
  place(M.buildFence(3), 0.4, 2.4, 1.3); place(M.buildFence(3), 12.4, 5.4, 0.2);
  props.lanterns = [];
  const DK = LAYOUT.dock, du = DK.b.clone().sub(DK.a).normalize(), dn = new THREE.Vector2(-du.y, du.x);
  const dockPt = (t, side) => DK.a.clone().lerp(DK.b, t).addScaledVector(dn, side * 0.85);
  const dockLamps = [dockPt(0.06, 1), dockPt(0.06, -1), dockPt(0.97, -1)].map(p => [p.x, p.y, Math.atan2(du.x, du.y) + Math.PI / 2]);
  for (const [x, z, ry] of [...dockLamps, [4.3, 8.0, -0.3], [9.5, 3.5, 0], [16, 2.2, 0.3], [-6.6, -4.2, 1.2], [-16, 5, 3.4], [-20, -2.5, 3.1], [-14, -11.5, 1.5], [-30, -13.5, 1.4], [-3.5, 3, 0.8], [-10, 11.5, 2.5]]) {
    const l = place(M.buildLantern(), x, z, ry); props.lanterns.push(l);
    colliders.push({ x, z, r: 0.2 });
  }
  const sign = place(M.buildSign(), 20.5, 4.2, -0.4); colliders.push({ x: 20.5, z: 4.2, r: 0.2 });

  // ─── 码头与船 ───
  // 码头斜着从沙滩（a）伸进海里（b）
  const dockLen = DK.a.distanceTo(DK.b);
  const dock = M.buildDock(dockLen - 0.2);
  dock.position.set(DK.a.x + du.x * 0.3, DK.y - 0.06, DK.a.y + du.y * 0.3);
  dock.rotation.y = Math.atan2(du.x, du.y);
  scene.add(dock); placed.push(dock);
  props.boat = M.buildBoat();
  props.boat.position.set(LAYOUT.boat.x, TIDE.high, LAYOUT.boat.z);
  props.boat.rotation.y = LAYOUT.boat.ry;   // 船头朝西南（外海），船尾靠着码头
  props.boat.scale.setScalar(1.6);
  // 船尾到码头桩的缆绳
  { const s = LAYOUT.boat, back = new THREE.Vector3(s.x - Math.sin(s.ry) * 3.6, 1.35, s.z - Math.cos(s.ry) * 3.6);
    const post = dockPt(0.42, -1); const P = new THREE.Vector3(post.x, DK.y + 0.3, post.y);
    const mid = back.clone().lerp(P, 0.5); mid.y -= 0.5;
    const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([back, mid, P]), 12, 0.03, 5), M.mat('#d9c08a', { rough: 0.9 }));
    scene.add(rope); }
  scene.add(props.boat);

  // ─── 潮汐神龛、小岛图腾、宝箱遗迹 ───
  props.shrine = place(M.buildShrine(), LAYOUT.shrine.x, LAYOUT.shrine.z, -Math.PI / 2 + 0.3);
  colliders.push({ x: LAYOUT.shrine.x, z: LAYOUT.shrine.z, r: 1.4 });
  props.totem = place(M.buildTotem(), LAYOUT.totem.x, LAYOUT.totem.z, 0.4);
  colliders.push({ x: LAYOUT.totem.x, z: LAYOUT.totem.z, r: 0.6 });
  props.chest = place(M.buildChest(), LAYOUT.chest.x, LAYOUT.chest.z, -Math.PI / 2 - 0.4);
  colliders.push({ x: LAYOUT.chest.x, z: LAYOUT.chest.z, r: 0.75 });
  for (let i = 0; i < 7; i++) {
    if (i === 5) continue; // 缺口朝向沙洲
    const a = i / 7 * Math.PI * 2 + 0.2, x = LAYOUT.chest.x + Math.cos(a) * 4.2, z = LAYOUT.chest.z + Math.sin(a) * 4.2;
    const col = new THREE.Group();
    const h = 1.6 + (i % 3) * 0.7;
    M.part(M.roundedBox(0.7, h, 0.7, 0.12), M.mat('#b3ad9b', { rough: 0.95 }), [0, h / 2, 0], [0, a, 0], [1, 1, 1], col);
    if (i % 2 === 0) M.part(new THREE.SphereGeometry(0.4, 10, 8), M.mat('#5a9a52'), [0, h + 0.05, 0], [0, 0, 0], [1.1, 0.35, 1.1], col);
    place(col, x, z);
    colliders.push({ x, z, r: 0.55, top: groundHeight(x, z) + h, climb: 'rock' });
  }

  // ─── 小高山：瀑布、水潭、山顶宝箱 ───
  scene.add(buildPond(heightTex, POND));
  for (const L of LAKES) scene.add(buildPond(heightTex, L));
  // 瀑布路径：水面永远在地形之上。
  // 1) 每个采样点取“整条水带宽度内”的最高地面，并同时考虑渲染网格的插值（网格比解析地形粗，棱角会鼓出来）
  // 2) 从下往上取 max：水只会往下流，遇到凹坑就被“填平”成小水潭，不会钻进山体
  const GS = MAP.size / MAP.res;
  const meshH = (x, z) => {
    const gx = (x + MAP.size / 2) / GS, gz = (z + MAP.size / 2) / GS, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const h = (a, b) => terrainHeight(-MAP.size / 2 + a * GS, -MAP.size / 2 + b * GS);
    return (h(i, j) * (1 - fx) + h(i + 1, j) * fx) * (1 - fz) + (h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx) * fz;
  };
  const FALL_W = 1.2, zs = [];
  for (let z = MOUNT.z + 1.6; z <= POND.z - POND.r + 0.6; z += 0.15) zs.push(z);
  const floorAt = (z) => {
    let h = POND.y;
    for (let dx = -FALL_W / 2; dx <= FALL_W / 2 + 1e-6; dx += FALL_W / 4) for (const dz of [-0.2, 0, 0.2])
      h = Math.max(h, terrainHeight(FALL_X + dx, z + dz), meshH(FALL_X + dx, z + dz));
    return h;
  };
  const ys = zs.map(z => floorAt(z) + 0.28);
  for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.max(ys[i], ys[i + 1]);
  const fallPts = zs.map((z, i) => new THREE.Vector3(FALL_X, ys[i], z));
  props.waterfall = buildWaterfall(fallPts, FALL_W); scene.add(props.waterfall.mesh);
  props.fallBase = props.waterfall.base.clone();
  // 河：从水潭西侧流出，沿河床一路流进大海
  const riverPts = [];
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i], b = RIVER[i + 1], n = Math.ceil(a.distanceTo(b) / 0.8);
    for (let k = 0; k < n; k++) { const x = a.x + (b.x - a.x) * k / n, z = a.y + (b.y - a.y) * k / n; riverPts.push(new THREE.Vector3(x, riverAt(x, z).surface, z)); }
  }
  const end = RIVER[RIVER.length - 1];
  riverPts.push(new THREE.Vector3(end.x, riverAt(end.x, end.y).surface, end.y));
  props.river = buildRiver(riverPts, (t) => (1.5 + t * 1.3) * 1.05); scene.add(props.river);
  // 瀑布口的石头
  for (const [dx, s] of [[-1.3, 0.8], [1.3, 0.9]]) placeRock(40 + s * 10, FALL_X + dx, MOUNT.z + 1.8, s, { maxSpan: 3 });
  // 山顶宝箱：攀爬的奖励
  const topX = MOUNT.x + 1.6, topZ = MOUNT.z - 1.2;
  props.summitChest = place(M.buildChest(), topX, topZ, 0.3);
  props.summitChest.scale.setScalar(0.8);
  colliders.push({ x: topX, z: topZ, r: 0.6 });
  props.summit = new THREE.Vector3(topX, groundHeight(topX, topZ), topZ);
  // 山顶遗迹：拱门朝南（朝营地）
  { const rx = -6.5, rz = -20.3, ry = 8.3;
    const ruins = D.buildRuins(); ruins.position.set(rx, ry, rz); scene.add(ruins); placed.push(ruins);
    for (const sx of [-1, 1]) colliders.push({ x: rx + sx * 1.55, z: rz + 0.2, r: 0.7, top: ry + 7, climb: 'rock' });
    colliders.push({ x: rx + 2.4, z: rz - 1.3, r: 1.5, top: ry + 6.9, climb: 'rock' }, { x: rx - 2.5, z: rz - 1.2, r: 0.5, top: ry + 2.3, climb: 'rock' });
    taken.push([rx, rz, 4]); }
  // 风冠山顶：全图最高点的宝箱（从这里可以一路滑翔下去）
  let bx = MASSIF.x, bz = MASSIF.z, bh = -1;
  for (let i = -30; i <= 30; i += 2) for (let j = -24; j <= 24; j += 2) { const h = terrainHeight(MASSIF.x + i, MASSIF.z + j); if (h > bh && Math.abs(terrainHeight(MASSIF.x + i + 1, MASSIF.z + j) - h) < 0.4) { bh = h; bx = MASSIF.x + i; bz = MASSIF.z + j; } }
  props.bigSummitChest = place(M.buildChest(), bx, bz, 0.3);
  colliders.push({ x: bx, z: bz, r: 0.75 });
  props.bigSummit = new THREE.Vector3(bx, groundHeight(bx, bz), bz);
  const flag = place(M.buildSign(), bx + 1.8, bz + 0.5, 0.8); flag.scale.setScalar(1.6);
  // 山坡上的岩块（可攀爬）
  const rockRnd = rng(7);
  for (let i = 0, n = 0; i < 400 && n < 16; i++) {
    const a = rockRnd() * Math.PI * 2, r = 4 + rockRnd() * 9;
    const x = MOUNT.x + Math.cos(a) * r, z = MOUNT.z + Math.sin(a) * r;
    if (Math.abs(x - FALL_X) < 2.2 && z > MOUNT.z) continue;
    if (!clear(x, z, 3) || !free(x, z, 1.5)) continue;
    if (placeRock(i, x, z, 0.8 + rockRnd() * 1.1, { maxSpan: 1.1 })) n++;
  }

  // 北部大山上的岩块
  const mRnd = rng(71);
  for (let i = 0, n = 0; i < 1500 && n < 45; i++) {
    const x = MASSIF.x + (mRnd() - 0.5) * MASSIF.rx * 1.8, z = MASSIF.z + (mRnd() - 0.5) * MASSIF.rz * 1.8, h = terrainHeight(x, z);
    if (h < 2.2 || !free(x, z, 3)) continue;
    if (placeRock(300 + i, x, z, 1 + mRnd() * 2.2, { maxSpan: 1.2 })) n++;
  }

  // ─── 东北沉船湾 ───
  const wreck = M.buildShipwreck();
  const wx = LOBES.cove.x + 2, wz = LOBES.cove.z - 6.5;
  wreck.position.set(wx, terrainHeight(wx, wz) + 0.2, wz); wreck.rotation.set(0, 0.7, 0.35);
  scene.add(wreck); placed.push(wreck);
  colliders.push({ x: wx, z: wz, r: 2.2, top: wreck.position.y + 2.4, climb: 'rock' }, { x: wx + 2.6, z: wz - 2.4, r: 1.3 }, { x: wx - 2.4, z: wz + 2.6, r: 1.3 });

  // ─── 远景海蚀柱 + 漂浮物 ───
  for (const [sx, sz, sr] of STACKS) {
    const cap = M.buildStackCap(sr); cap.position.set(sx, terrainHeight(sx, sz) - 0.05, sz); scene.add(cap);
    if (sr > 3.2) { const p = M.buildPalm(sx | 0); p.scale.setScalar(0.8); p.position.copy(cap.position); scene.add(p); }
  }
  props.debris = [];
  for (const [x, z, s] of [[-30, 32, 1], [14, 33, 2], [42, 12, 3], [-50, -6, 4], [30, -40, 5]]) {
    const d = M.buildFloatingDebris(s); d.position.set(x, 0, z); scene.add(d); props.debris.push(d);
  }

  // 远海石柱群（西北海面上，夕阳一侧的剪影）：不参与远处隐藏，自己合并网格
  for (const [x, z, h, arch, palms] of [[-48, -58, 14, false, 2], [-66, -42, 9, false, 1], [-62, -86, 15, true, 2], [-86, -74, 11, false, 1], [-57, -73, 7, false, 0], [-100, -46, 6, false, 1]]) {
    const sp = D.buildSpire(Math.abs(x + z) | 0, h, { arch, palms });
    sp.position.set(x, -1.2, z); sp.rotation.y = x * 0.37; scene.add(sp);
    M.bake(sp, { shadow: false }); sp.updateMatrixWorld(true); sp.matrixAutoUpdate = false;
    colliders.push({ x, z, r: arch ? 4.5 : 2.8 });
  }
  // 营地主画面前景：水里、沙滩上成组的大圆石，潮池一圈石头和海星；立在水里的石头脚下有一圈白沫
  props.foamRings = [];
  for (const [x, z, s] of [[-16, 23, 2.1], [-19.5, 21, 1.4], [-13, 25.8, 1.6], [-22, 25.5, 1.8], [-10, 27, 1.2], [-8.6, 24.2, 1.3], [-1, 25.2, 1.9], [2.2, 22.2, 1.5],
    [6.2, 16.4, 1.2], [10.6, 15.6, 1.0], [11.6, 21.0, 1.5], [8.2, 21.2, 1.0], [5.0, 19.6, 0.8], [16.8, 10.8, 1.4], [16.6, 6.6, 1.1], [13.2, 12.2, 0.9],
    [-14.6, 21.6, 1.8], [-17.2, 24.4, 2.4], [-7.6, 23.6, 1.6], [-0.4, 23.2, 1.7], [1.8, 17.8, 0.9], [7.6, 17.0, 1.1], [10.9, 13.2, 1.3], [-27.5, 18.5, 1.6]]) {
    const rock = placeRock(Math.floor(x * 13 + z * 7), x, z, s, { maxSpan: 4 });
    if (!rock) continue;
    // 画面两侧的大石头顶上长一丛大叶蕨 / 红花灌木，给主画面做前景框
    if (s >= 1.4 && (x < -13 || x > 10.5)) {
      const f = M.buildFern(Math.floor(x * 3)); f.position.set(x + 0.2, rock.position.y + s * 0.92, z); f.rotation.y = x; f.scale.setScalar(s * 1.5);
      f.userData.kind = 'fern'; scene.add(f); placed.push(f);
      if (s >= 1.7) { const fb = M.buildFlowerBush(Math.floor(z)); fb.position.set(x - s * 0.3, rock.position.y + s * 0.85, z - s * 0.2); fb.scale.setScalar(s * 0.6); scene.add(fb); placed.push(fb); }
    }
    const ring = D.buildFoamRing(s * 1.25, waterLight.uTime); ring.position.set(x, TIDE.high + 0.03, z);
    scene.add(ring); props.foamRings.push({ mesh: ring, base: rock.position.y });
  }
  for (const [x, z, i] of [[8.4, 18.2, 0], [11.2, 17.2, 1], [7.9, 16.2, 2], [-2.2, 21.4, 1], [-5.6, 20.6, 0]]) {
    const sf = place(M.buildStarfish(i), x, z, i * 2, 0.01); sf.scale.setScalar(1.6); sf.userData.kind = 'star';
  }

  // 海岸礁石（贴地、可攀爬）
  for (const [x, z, s] of scatter(26, 11, (h, x, z) => h > -0.6 && h < 0.6 && clear(x, z, 4), 2.6, [-48, 56, -40, 30]).concat(scatter(70, 12, (h, x, z) => h > -0.6 && h < 0.6 && clear(x, z, 4), 4, WORLD))) {
    placeRock(Math.floor(s * 100), x, z, 0.6 + s * 1.1);
  }
  // 东南礁石小岛：潮池 + 海星
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2, x = LOBES.reef.x + Math.cos(a) * 3.2, z = LOBES.reef.z + Math.sin(a) * 2.6;
    placeRock(90 + i, x, z, 0.5 + (i % 3) * 0.25, { maxSpan: 2 });
  }
  const starRnd = rng(33);
  for (let i = 0; i < 16; i++) {
    const [x, z] = scatter(1, 200 + i, (h, x, z) => h > 0.15 && h < 0.7 && clear(x, z, 2), 1, [-48, 56, -40, 30])[0] || [];
    if (x === undefined) continue;
    const sf = place(M.buildStarfish(i), x, z, starRnd() * 6, 0.01); sf.scale.setScalar(1.4); sf.userData.kind = 'star';
  }

  // ─── 资源点 ───
  const addRes = (type, obj, x, z, extra = {}) => {
    const r = { type, obj, x, z, alive: true, respawn: 0, hits: 0, ...extra };
    resources.push(r); return r;
  };
  const notForest = (x, z) => Math.hypot(x - LOBES.forest.x, z - LOBES.forest.z) > 12;
  const palmSpots = scatter(20, 3, (h, x, z) => h > 0.65 && h < 1.9 && flatEnough(x, z) && notForest(x, z) && clear(x, z, 3.2), 4.2)
    .concat(scatter(55, 31, (h, x, z) => h > 0.65 && h < 2.2 && flatEnough(x, z) && clear(x, z, 3.2) && Math.hypot(x, z) > 60, 5, WORLD))
    .concat([[40.5, -6, 0.2], [46, -0.5, 0.6], [45.5, -8, 0.9], [LOBES.reef.x, LOBES.reef.z, 0.5]]);
  palmSpots.forEach(([x, z, s], i) => {
    const palm = M.buildPalm(i); palm.scale.setScalar(0.85 + s * 0.35);
    place(palm, x, z, 0, -0.05);
    const stump = M.buildStump(); place(stump, x, z); stump.visible = false;
    const trunkTop = groundHeight(x, z) + 4.2 * (0.85 + s * 0.35);
    const res = addRes('palm', palm, x, z, { stump, nuts: true, sway: s * 6, fade: 1 });
    colliders.push({ x, z, r: 0.45, palm: true, res, top: trunkTop, climb: 'tree' });
    // 每棵树独立材质，挡住主角时可以单独变透明
    res.fadeMats = M.cloneMaterials(palm);
  });
  // 西侧树林：阔叶树 + 蕨 + 蘑菇
  const F = LOBES.forest, forestArea = [F.x - 14, F.x + 12, F.z - 13, F.z + 13];
  props.roundTrees = [];
  const westArea = [WEST.x - WEST.r, WEST.x + WEST.r, WEST.z - WEST.r, WEST.z + WEST.r];
  const massifArea = [MASSIF.x - MASSIF.rx, MASSIF.x + MASSIF.rx, MASSIF.z - MASSIF.rz, MASSIF.z + MASSIF.rz];
  scatter(16, 41, (h, x, z) => h > 1.0 && flatEnough(x, z) && clear(x, z, 3), 3.2, forestArea)
    .concat(scatter(70, 42, (h, x, z) => h > 1.2 && flatEnough(x, z, 0.6) && clear(x, z, 3), 4, westArea))
    .concat(scatter(35, 44, (h, x, z) => h > 2 && h < 14 && flatEnough(x, z, 0.45) && clear(x, z, 3), 5, massifArea))
    .concat(scatter(16, 45, (h, x, z) => h > 1.8 && flatEnough(x, z, 0.5) && clear(x, z, 3), 5, [EAST.x - EAST.r, EAST.x + EAST.r, EAST.z - EAST.r, EAST.z + EAST.r]))
    .forEach(([x, z, s], i) => {
    const t = M.buildRoundTree(i); t.scale.setScalar(0.9 + s * 0.4); place(t, x, z, s * 6);
    const fadeMats = M.cloneMaterials(t);
    const tr = { obj: t, fadeMats, fade: 1, crown: t.userData.parts.crown };
    props.roundTrees.push(tr);
    colliders.push({ x, z, r: 0.4, top: groundHeight(x, z) + (2.2 + (i % 3) * 0.4) * (0.9 + s * 0.4), climb: 'tree' });
  });
  scatter(40, 43, (h, x, z) => h > 1.0 && flatEnough(x, z, 0.7) && clear(x, z, 2), 1.1, [-46, 20, -30, 26]).concat(scatter(90, 46, (h, x, z) => h > 1.2 && flatEnough(x, z, 0.7) && clear(x, z, 2), 2, westArea)).forEach(([x, z, s], i) => {
    const f = place(M.buildFern(i), x, z, s * 6); f.scale.setScalar(0.9 + s * 0.8); f.userData.kind = 'fern';
  });
  scatter(14, 47, (h, x, z) => h > 1.0 && flatEnough(x, z) && clear(x, z, 2), 1.5, forestArea).concat(scatter(25, 48, (h, x, z) => h > 1.2 && flatEnough(x, z) && clear(x, z, 2), 3, westArea)).forEach(([x, z, s], i) => { place(M.buildMushrooms(i), x, z, s * 6).userData.kind = 'mush'; });
  scatter(12, 49, (h, x, z) => h > 1.05 && h < 2 && flatEnough(x, z) && clear(x, z, 2.5), 2.2).concat(scatter(25, 50, (h, x, z) => h > 1.1 && h < 6 && flatEnough(x, z) && clear(x, z, 2.5), 4, WORLD)).forEach(([x, z, s], i) => {
    place(M.buildFlowerBush(i), x, z, s * 6).scale.setScalar(0.8 + s * 0.3);
  });

  scatter(20, 5, (h, x, z) => h > 1.05 && h < 2.4 && flatEnough(x, z) && clear(x, z, 2.5), 2.2).concat(scatter(35, 6, (h, x, z) => h > 1.1 && h < 8 && flatEnough(x, z) && clear(x, z, 2.5), 4, WORLD)).forEach(([x, z, s], i) => {
    const b = M.buildBush(i); b.scale.setScalar(0.9 + s * 0.4); place(b, x, z);
    addRes('bush', b, x, z);
  });
  scatter(12, 9, (h, x, z) => h > 0.4 && h < 0.85 && clear(x, z, 2.5), 3, [-48, 56, -40, 30]).concat(scatter(25, 10, (h, x, z) => h > 0.4 && h < 0.85 && clear(x, z, 2.5), 5, WORLD)).forEach(([x, z, s]) => {
    addRes('drift', place(M.buildDriftwood(s * 6), x, z, 0, 0.02), x, z);
  });
  // 两处教学用石堆固定在营地附近，其余散布
  [[3.5, 10.5, 0.2], [-9, 12.5, 0.7]].concat(scatter(9, 13, (h, x, z) => h > 0.5 && h < 2 && flatEnough(x, z) && clear(x, z, 2.5), 3)).forEach(([x, z, s]) => {
    const st = place(M.buildStones(Math.floor(s * 50)), x, z); st.userData.kind = 'stone'; addRes('stone', st, x, z);
  });
  // 贝壳只出现在潮间带：退潮露出，涨潮被淹没（不可拾取）
  const shellSpots = [[7.5, 17.8], [9, 18.5], [12.5, 17], [14.5, 19], [25, 0.8], [29, -0.6], [32.5, -2.1], [27.5, -2.5]];
  shellSpots.forEach(([x, z], i) => {
    const s = M.buildShell(); s.scale.setScalar(1.3); place(s, x, z, i * 1.7);
    addRes('shell', s, x, z);
  });

  // ─── 草丛与小花（实例化，纯装饰；台地上也长草）───
  const GRASS = 0;   // 草由 grass.js 按地块生成，这里只撒花
  const grassGeo = new THREE.ConeGeometry(0.06, 0.38, 4); grassGeo.translate(0, 0.19, 0);
  const grass = new THREE.InstancedMesh(grassGeo, M.mat('#5fae5c', { rough: 0.9 }), GRASS);
  const flowerGeo = new THREE.SphereGeometry(0.07, 6, 5);
  const flowers = new THREE.InstancedMesh(flowerGeo, M.mat('#ffffff', { rough: 0.7 }), 1500);
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  const r2 = rng(21); let gi = 0, fi = 0;
  for (let t = 0; t < 400000 && fi < 1500; t++) {
    const home = t % 3 === 0;
    const A = home ? AREA : WORLD;
    const x = A[0] + r2() * (A[1] - A[0] + (home ? 22 : 0)), z = A[2] + r2() * (A[3] - A[2]), h = terrainHeight(x, z);
    if (h < 1.02 || h > 24 || sandAt(x, z) > 0.3 || inRiver(x, z, 0.6) || fbm(x * 0.25, z * 0.25) < 0.4 || slopeAt(x, z) > 0.45 || inPond(x, z, 0.8)) continue;
    for (let k = 0; k < 5 && gi < GRASS; k++) {
      const gx = x + (r2() - 0.5) * 0.5, gz = z + (r2() - 0.5) * 0.5;
      dummy.position.set(gx, terrainHeight(gx, gz) - 0.02, gz);
      dummy.rotation.set((r2() - 0.5) * 0.5, r2() * 6, (r2() - 0.5) * 0.5);
      dummy.scale.setScalar(0.7 + r2() * 0.7); dummy.updateMatrix();
      grass.setMatrixAt(gi++, dummy.matrix);
    }
    if (fi < 1500 && r2() < 0.12) {
      dummy.position.set(x, h + 0.3, z); dummy.scale.setScalar(1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      flowers.setMatrixAt(fi, dummy.matrix);
      flowers.setColorAt(fi++, col.set(['#e85d4a', '#f2c14e', '#ffffff', '#f39ac0'][fi % 4]));
    }
  }
  grass.count = gi; flowers.count = fi;
  grass.receiveShadow = true; flowers.castShadow = true;
  // 旧的球形小花换成 grass.js 里的五瓣小花丛

  // ─── 性能：合并零件、关小物件阴影、静态物体不再每帧算矩阵 ───
  const dynamic = new Set([props.boat, ...props.debris, ...resources.filter(r => r.type === 'palm' || r.type === 'bush').map(r => r.obj)]);
  const NO_SHADOW = new Set(['fern', 'mush', 'stone', 'star', 'shell', 'drift', 'flower']);
  const cull = [];
  for (const obj of placed) {
    const parts = obj.userData.parts || {};
    const keep = Object.entries(parts).filter(([k, v]) => v?.isObject3D && !(k === 'crown' && !obj.userData.parts.nuts)).map(([, v]) => v);
    M.bake(obj, { keep, shadow: !NO_SHADOW.has(obj.userData.kind) });
    if (parts.crown && parts.nuts) { M.bake(parts.crown, { keep: [parts.nuts] }); M.bake(parts.trunk, { keep: [parts.crown] }); }
    if (!dynamic.has(obj)) { obj.updateMatrix(); obj.matrixAutoUpdate = false; obj.traverse(o => { if (o !== obj && !keep.includes(o)) { o.updateMatrix(); o.matrixAutoUpdate = false; } }); }
    if (!resources.some(r => r.obj === obj)) cull.push(obj);
  }
  props.cull = cull;
  return { colliders, resources, props };
}

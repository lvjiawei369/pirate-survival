// 晴帆岛地形：一个解析高度函数同时驱动网格、水面着色和碰撞，保证“看到的岸线 = 能走的岸线”。
import * as THREE from 'three';

export const TIDE = { high: 0.35, low: -0.75 };
export const MAP = { size: 520, res: 640, chunks: 8 };

// 岛屿布局（米）。主岛在原点，东侧沙洲只在退潮时露出，通往小岛上的神殿遗迹。
export const LAYOUT = {
  spawn: new THREE.Vector3(-3, 0, 12),
  // 营地在沙滩东北侧的空地上：红布凉棚（帐篷）、篝火、工作台、晒鱼架，背靠东边的崖壁
  camp: new THREE.Vector3(6, 0, 4.8),
  workbench: new THREE.Vector3(2.4, 0, 5.6),
  campfire: new THREE.Vector3(7.6, 0, 6.0),     // 紧挨凉棚门口
  tent: Object.assign(new THREE.Vector3(6.0, 0, 3.2), { ry: -0.35 }),   // ry：凉棚开口朝向
  shrine: new THREE.Vector3(19.5, 0, 1.5),
  islet: new THREE.Vector3(43, 0, -3),
  chest: new THREE.Vector3(44, 0, -4.5),
  totem: new THREE.Vector3(39.5, 0, 0.5),
  // 码头从营地西侧沙滩斜着伸进海里（a = 岸上一端，b = 海里一端，w = 宽度）；船停在码头南侧，船头朝西南
  dock: { a: new THREE.Vector2(-11.8, 12.3), b: new THREE.Vector2(-23.5, 3.8), w: 2.1, y: 1.05 },
  boat: Object.assign(new THREE.Vector3(-21.5, 0, 13.8), { ry: Math.atan2(-0.9, 0.44), half: 4.1 }),   // ry：船头朝向；half：半船长
  boatSpot: new THREE.Vector3(-16.4, 0, 10.0),   // 修船 / 上船的站位（码头上，离船尾最近处）
  sandbar: [new THREE.Vector2(21, 0.5), new THREE.Vector2(36, -2)]
};
// 北侧小高山：南坡陡（瀑布沿南坡的沟槽泻下），北坡缓；山脚是一汪淡水潭
export const LOBES = { forest: { x: -34, z: -12 }, cove: { x: 15, z: -25 }, reef: { x: 27, z: 23 } };
export const MOUNT = { x: -6, z: -17, r: 12.5, h: 8.8 };
export const POND = { x: -5.5, z: -8.4, r: 2.8, y: 1.22 };
export const FALL_X = -5.5;
// 营地背后的东崖：陡峭岩壁 + 平顶，南面开一个洞口
export const CLIFF = { x: 19.5, z: -8.6, rx: 8.5, rz: 5.2, h: 7.2 };
// 沙滩到营地、再到山脚的土路（折线）
export const PATHS = [
  [[-11.2, 12.4], [-7, 13.5], [-3, 11], [1.5, 7.8], [5, 6.2]],
  [[-3, 11], [-4.5, 5], [-5, -1], [-5.5, -5]]
].map(l => l.map(([x, z]) => new THREE.Vector2(x, z)));
// ─── 扩展大地图 ───
export const MASSIF = { x: 5, z: -122, rx: 82, rz: 60, h: 27 };                 // 北部“风冠山”
export const PEAKS = [[-38, -130, 12, 15], [44, -104, 10, 17], [8, -150, 9, 9]];  // 次峰 [x, z, 半径, 高]
export const WEST = { x: -150, z: 12, r: 60 };                                   // 西部雨林岛
export const EAST = { x: 150, z: 28, r: 48, mesa: { x: 156, z: 24, r: 19, h: 17 } }; // 东部断崖岛
export const SOUTH = [[48, 126, 18], [-58, 146, 14], [98, 172, 12], [-12, 206, 10], [150, -128, 20]];
export const LAKES = [{ x: -158, z: 2, r: 11, y: 2.4 }];
// 河道：从瀑布下的水潭往西蜿蜒，穿过树林半岛流进大海
export const RIVER = [[-7.9, -8.2], [-12, -7.9], [-17, -7.4], [-22, -8.0], [-27, -9.6], [-32, -9.2], [-37, -10.2], [-42, -12.0], [-49, -13.2]]
  .map(([x, z]) => new THREE.Vector2(x, z));
const RIVER_TOP = 1.2, RIVER_END = 0.28;

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) {
  return vnoise(x, z) * 0.6 + vnoise(x * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, z * 4.3) * 0.1;
}
const smooth = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

// 岛屿剖面：平台 → 草坡 → 白沙滩 → 浅滩 → 深海。d 是归一化半径。
function profile(d, top) {
  if (d < 0.55) return top;
  if (d < 0.78) return top + (0.75 - top) * smooth(0.55, 0.78, d);
  if (d < 1.0) return 0.75 - 0.95 * smooth(0.78, 1.0, d);
  return -0.2 - 2.8 * smooth(1.0, 1.4, d);
}

function island(x, z, cx, cz, r, top, wobble) {
  const dx = x - cx, dz = z - cz;
  const ang = Math.atan2(dz, dx);
  const rr = r * (1 + wobble * (Math.sin(ang * 3 + 1.3) * 0.5 + Math.sin(ang * 5 - 0.7) * 0.3 + (fbm(x * 0.08, z * 0.08) - 0.5)));
  return profile(Math.hypot(dx, dz) / rr, top);
}

function segDist(x, z, a, b) {
  const abx = b.x - a.x, abz = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.y) * abz) / (abx * abx + abz * abz)));
  return Math.hypot(x - (a.x + abx * t), z - (a.y + abz * t));
}

export function terrainHeight(x, z) {
  let h = -3;
  h = Math.max(h, island(x, z, 0, 0, 23, 1.5, 0.18));
  h = Math.max(h, island(x, z, LOBES.forest.x, LOBES.forest.z, 15, 1.7, 0.16));   // 西侧树林半岛
  h = Math.max(h, island(x, z, -18, -7.5, 9, 1.6, 0.12));                           // 树林半岛与主岛之间的河岸
  h = Math.max(h, island(x, z, LOBES.cove.x, LOBES.cove.z, 11.5, 1.3, 0.2));     // 东北沉船湾
  h = Math.max(h, island(x, z, LOBES.reef.x, LOBES.reef.z, 6.5, 0.85, 0.25));    // 东南礁石小岛
  h = Math.max(h, island(x, z, LAYOUT.islet.x, LAYOUT.islet.z, 8.5, 1.1, 0.1));
  h = Math.max(h, mountain(x, z));
  h = Math.max(h, cliff(x, z));
  h = Math.max(h, island(x, z, 0, -58, 30, 1.6, 0.15));                            // 通往北山的陆桥
  h = Math.max(h, massif(x, z));
  h = Math.max(h, westIsland(x, z));
  h = Math.max(h, eastIsland(x, z));
  for (const [sx, sz, sr] of SOUTH) h = Math.max(h, island(x, z, sx, sz, sr, 1.2, 0.2));
  // 山脚水潭：碗形凹陷
  const pd = Math.hypot(x - POND.x, z - POND.z) / POND.r;
  if (pd < 1.5) h = Math.min(h, 0.45 + 1.1 * smooth(0.55, 1.45, pd) + (h - 1.55) * smooth(1.2, 1.5, pd));
  // 沙洲：退潮（-0.75）时露出，高潮（0.35）时水深约 0.7 m 不可通行
  const sb = segDist(x, z, LAYOUT.sandbar[0], LAYOUT.sandbar[1]);
  const bar = -0.38 + 0.08 * Math.sin(x * 0.7) - 2.6 * smooth(1.6, 4.5, sb);
  h = Math.max(h, bar);
  // 潮间带浅滩：退潮时露出贝壳的滩涂
  const flat = Math.hypot((x - 10) / 9, (z - 17) / 4);
  if (flat < 1.4) h = Math.max(h, -0.45 - 2.5 * smooth(0.8, 1.4, flat));
  // 船泊位：船身底下挖深，涨落潮船都浮得起来
  const bd = boatDist(x, z);
  if (bd < 4.4) h = Math.min(h, -1.35 + 1.65 * smooth(1.5, 4.4, bd));
  // 河床
  const rv = riverAt(x, z);
  if (rv.d < rv.w * 2.2) {
    const bed = rv.surface - 0.75 * (1 - smooth(0.4, 1.0, rv.d / rv.w));
    h = Math.min(h, bed + (h - bed) * smooth(rv.w * 0.8, rv.w * 2.2, rv.d));
  }
  // 湖
  for (const L of LAKES) {
    const ld = Math.hypot(x - L.x, z - L.z) / L.r;
    if (ld < 1.5) h = Math.min(h, L.y - 1.3 + 1.8 * smooth(0.5, 1.4, ld) + Math.max(0, h - L.y - 0.5) * smooth(1.2, 1.5, ld));
  }
  // 远处海蚀柱
  for (const [sx, sz, sr] of STACKS) {
    const d = Math.hypot(x - sx, z - sz) / sr;
    if (d < 1.2) h = Math.max(h, 3.8 * (1 - smooth(0.55, 1.0, d)) + (-3) * smooth(0.9, 1.2, d));
  }
  return h + (fbm(x * 0.35, z * 0.35) - 0.5) * 0.12;
}
// 阶梯状的小山：三层台地 + 岩壁，南坡压缩成陡崖，沿瀑布线刻一条沟
function mountain(x, z) {
  const dx = x - MOUNT.x, dz = z - MOUNT.z;
  const md = Math.hypot(dx, dz * (dz > 0 ? 1.45 : 1.0)) / MOUNT.r;
  if (md > 1.2) return -3;
  let m = Math.pow(1 - smooth(0.0, 1.0, md), 0.85) * MOUNT.h * (0.9 + 0.2 * fbm(x * 0.2, z * 0.2));
  const step = 2.4, q = Math.floor(m / step), f = m / step - q;
  m = (q + smooth(0.45, 0.9, f)) * step * 0.7 + m * 0.3;
  // 瀑布沟：只在南坡
  const groove = dz > 0 ? (1 - smooth(0.0, 1.3, Math.abs(x - FALL_X))) * smooth(0, 3, dz) * 0.55 : 0;
  return 1.35 + m - groove;
}
// 东崖：椭圆平顶台地，四周几乎垂直，崖脚一圈碎石坡
function cliff(x, z) {
  const dx = (x - CLIFF.x) / CLIFF.rx, dz = (z - CLIFF.z) / CLIFF.rz;
  const ang = Math.atan2(dz, dx);
  const d = Math.hypot(dx, dz) / (1 + 0.1 * Math.sin(ang * 5 + 0.8) + 0.08 * (fbm(x * 0.2, z * 0.2) - 0.5));
  if (d > 1.15) return -3;
  const top = CLIFF.h + fbm(x * 0.15, z * 0.15) * 1.2;
  return 1.0 + (top - 1.0) * (1 - smooth(0.72, 0.9, d)) + 0.5 * (1 - smooth(0.9, 1.15, d));
}
// 土路 / 营地空地 / 草地里零星的裸土：0 = 草，1 = 土
export function dirtAt(x, z) {
  if (x * x + z * z > 900) return 0;
  let pd = Infinity;
  for (const L of PATHS) for (let i = 0; i < L.length - 1; i++) pd = Math.min(pd, segDist(x, z, L[i], L[i + 1]));
  const wob = (fbm(x * 0.4, z * 0.4) - 0.5) * 0.9;
  let d = 1 - smooth(0.9, 1.7, pd + wob);
  d = Math.max(d, 1 - smooth(4.2, 6.2, Math.hypot(x - LAYOUT.camp.x, (z - LAYOUT.camp.z) * 1.2) + wob * 2));
  if (Math.hypot(x, z) < 22) d = Math.max(d, smooth(0.6, 0.68, fbm(x * 0.11 + 5.3, z * 0.11 - 2.1)));
  return d;
}
// 北部大山：椭圆底座 + 阶梯台地主峰 + 几座次峰，山脊用噪声打散
function massif(x, z) {
  const dx = (x - MASSIF.x) / MASSIF.rx, dz = (z - MASSIF.z) / MASSIF.rz;
  const ang = Math.atan2(dz, dx);
  const md = Math.hypot(dx, dz) / (1 + 0.12 * Math.sin(ang * 4 + 0.6) + 0.1 * (fbm(x * 0.03, z * 0.03) - 0.5));
  let h = profile(md, 1.8);
  if (md < 0.9) {
    let m = Math.pow(1 - smooth(0.0, 0.9, md), 1.1) * MASSIF.h * (0.75 + 0.5 * fbm(x * 0.05, z * 0.05));
    for (const [px, pz, pr, ph] of PEAKS) {
      const pd = Math.hypot(x - px, z - pz) / pr;
      if (pd < 1.6) m = Math.max(m, ph * Math.pow(1 - smooth(0, 1.6, pd), 1.3) * (0.85 + 0.3 * fbm(x * 0.2, z * 0.2)));
    }
    const step = 3.2, q = Math.floor(m / step), f = m / step - q;
    m = (q + smooth(0.4, 0.88, f)) * step * 0.72 + m * 0.28;
    h = Math.max(h, 1.8 + m);
  }
  return h;
}
function westIsland(x, z) {
  const d = Math.hypot(x - WEST.x, z - WEST.z);
  const ang = Math.atan2(z - WEST.z, x - WEST.x);
  const md = d / (WEST.r * (1 + 0.16 * Math.sin(ang * 3 + 2) + 0.12 * (fbm(x * 0.04, z * 0.04) - 0.5)));
  let h = profile(md, 2.0);
  if (md < 0.7) h += Math.pow(1 - md / 0.7, 1.2) * 7 * fbm(x * 0.045 + 3, z * 0.045);
  return h;
}
function eastIsland(x, z) {
  let h = island(x, z, EAST.x, EAST.z, EAST.r, 1.6, 0.18);
  const M = EAST.mesa, d = Math.hypot(x - M.x, z - M.z) / (M.r * (1 + 0.1 * Math.sin(Math.atan2(z - M.z, x - M.x) * 5)));
  if (d < 1.15) h = Math.max(h, 1.6 + M.h * (1 - smooth(0.82, 1.05, d)) + fbm(x * 0.3, z * 0.3) * 0.4);
  return h;
}
// 河：到折线最近距离、沿河进度、水面高度、河宽
export function riverAt(x, z) {
  let best = Infinity, bt = 0, acc = 0, total = 0;
  for (let i = 0; i < RIVER.length - 1; i++) total += RIVER[i].distanceTo(RIVER[i + 1]);
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i], b = RIVER[i + 1], len = a.distanceTo(b);
    const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (z - a.y) * (b.y - a.y)) / (len * len)));
    const d = Math.hypot(x - (a.x + (b.x - a.x) * t), z - (a.y + (b.y - a.y) * t));
    if (d < best) { best = d; bt = (acc + t * len) / total; }
    acc += len;
  }
  return { d: best, t: bt, w: 1.5 + bt * 1.3, surface: RIVER_TOP + (RIVER_END - RIVER_TOP) * bt };
}
export function inPond(x, z, pad = 0) { return Math.hypot(x - POND.x, z - POND.z) < POND.r + pad; }
// 某点的水面高度：海水随潮位；水潭、湖、河各有自己的水面
export function waterLevelAt(x, z, tideLevel) {
  let w = tideLevel;
  if (inPond(x, z, 0.6)) w = Math.max(w, POND.y);
  for (const L of LAKES) if (Math.hypot(x - L.x, z - L.z) < L.r * 1.1) w = Math.max(w, L.y);
  if (Math.abs(x + 27) < 25 && Math.abs(z + 3) < 12) { const rv = riverAt(x, z); if (rv.d < rv.w * 1.05) w = Math.max(w, rv.surface); }
  return w;
}

export const STACKS = [[-62, -28, 4.2], [70, -50, 3.4], [-70, 40, 3], [80, 10, 3.6], [-30, 64, 2.8], [12, 70, 3.2], [-90, -60, 4.6], [100, 100, 3.8], [-110, 90, 3.4], [210, -40, 4], [-220, -90, 4.4], [60, -200, 5]];

// 到码头中线的距离 + 沿码头的进度（0 = 岸边一端，1 = 海里一端）
export function dockCoord(x, z) {
  const { a, b } = LAYOUT.dock;
  const abx = b.x - a.x, abz = b.y - a.y, len2 = abx * abx + abz * abz;
  const t = ((x - a.x) * abx + (z - a.y) * abz) / len2;
  return { t, d: Math.abs((x - a.x) * abz - (z - a.y) * abx) / Math.sqrt(len2) };
}
export function onDock(x, z) {
  const c = dockCoord(x, z);
  return c.t > 0 && c.t < 1 && c.d < LAYOUT.dock.w / 2;
}
// 船身占地（沿船身中轴的胶囊）：到中轴线段的距离
function boatDist(x, z) {
  const B = LAYOUT.boat, dx = Math.sin(B.ry) * B.half, dz = Math.cos(B.ry) * B.half;
  return segDist(x, z, { x: B.x - dx, y: B.z - dz }, { x: B.x + dx, y: B.z + dz });
}
export const nearBoat = (x, z, r = 1.9) => boatDist(x, z) < r;
// 营地南边的大沙滩：主角站的这片是白沙（不长草），往北才是草地和营地的土
export function sandAt(x, z) {
  if (Math.abs(x + 2) > 24 || z < 6 || z > 30) return 0;
  const wob = (fbm(x * 0.3 + 11.0, z * 0.3) - 0.5) * 2.4;
  return smooth(9.8, 11.6, z + wob + Math.max(0, x - 3) * 0.12);
}
export function groundHeight(x, z) {
  const h = terrainHeight(x, z);
  return onDock(x, z) ? Math.max(h, LAYOUT.dock.y) : h;
}

const C = {
  deep: new THREE.Color('#4f9c94'), wet: new THREE.Color('#c79a66'), sand: new THREE.Color('#edc792'),
  sandLight: new THREE.Color('#f6dbae'), grass: new THREE.Color('#58a53f'), grassLight: new THREE.Color('#78bb46'),
  dirt: new THREE.Color('#c9995f'), dirtDark: new THREE.Color('#a87a4a'),
  rock: new THREE.Color('#8b8a84'), rockDark: new THREE.Color('#686a6c')
};

export function buildTerrain() {
  const { size, res, chunks } = MAP;
  const N = res + 1, step = size / res;
  // 一次性算出整张高度网格：网格、法线、颜色、水面高度贴图都从它来
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = terrainHeight(-size / 2 + i * step, -size / 2 + j * step);
  const at = (i, j) => H[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  const group = new THREE.Group();
  const tmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  addTerrainDetail(tmat);
  const c = new THREE.Color(), nrm = new THREE.Vector3();
  const per = res / chunks;
  for (let cj = 0; cj < chunks; cj++) for (let ci = 0; ci < chunks; ci++) {
    const verts = (per + 1) * (per + 1);
    const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), col = new Float32Array(verts * 3);
    let k = 0;
    for (let j = 0; j <= per; j++) for (let i = 0; i <= per; i++, k++) {
      const gi = ci * per + i, gj = cj * per + j;
      const x = -size / 2 + gi * step, z = -size / 2 + gj * step, h = at(gi, gj);
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const dx = (at(gi + 1, gj) - at(gi - 1, gj)) / (2 * step), dz = (at(gi, gj + 1) - at(gi, gj - 1)) / (2 * step);
      nrm.set(-dx, 1, -dz).normalize(); nor.set([nrm.x, nrm.y, nrm.z], k * 3);
      const slope = Math.hypot(dx, dz), n = fbm(x * 0.5, z * 0.5);
      if (h < -0.9) c.copy(C.deep).lerp(C.wet, smooth(-2.5, -0.9, h));
      else if (h < 0.45) c.copy(C.wet).lerp(C.sand, smooth(-0.3, 0.45, h));
      else if (h < 0.95) c.copy(C.sand).lerp(C.sandLight, n * 0.6);
      else {
        const beach = sandAt(x, z);
        c.copy(C.sand).lerp(C.sandLight, n * 0.6).lerp(n > 0.5 ? C.grassLight : C.grass, smooth(0.95, 1.12, h) * (1 - beach));
        const dirt = dirtAt(x, z) * smooth(0.9, 1.1, h) * (1 - beach * 0.75);
        if (dirt > 0) c.lerp(n > 0.55 ? C.dirtDark : C.dirt, dirt * 0.92);
      }
      if (slope > 0.7 || h > 22) c.lerp(n > 0.5 ? C.rock : C.rockDark, Math.min(1, smooth(0.7, 1.3, slope) + smooth(22, 26, h)));
      c.multiplyScalar(0.95 + hash(x * 3.1, z * 3.1) * 0.08);
      col.set([c.r, c.g, c.b], k * 3);
    }
    const idx = [];
    for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) {
      const a = j * (per + 1) + i, b = a + 1, d = a + per + 1, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, tmat);
    mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  const heightTex = new THREE.DataTexture(H, N, N, THREE.RedFormat, THREE.FloatType);
  heightTex.magFilter = heightTex.minFilter = THREE.LinearFilter;
  heightTex.needsUpdate = true;
  return { mesh: group, heightTex, material: tmat };
}

// 程序化细节：不依赖顶点密度，近看也清晰。
// 陡坡画岩层条纹 + 裂缝；平地画三色调的手绘色块；湿沙在雨天变暗（uWet）。
export const terrainUniforms = { uWet: { value: 0 }, uTime: { value: 0 } };
function addTerrainDetail(material) {
  material.onBeforeCompile = (sh) => {
    // 反射只在水洼里强：把环境反射按水洼遮罩缩放
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      iblIrradiance *= 0.35; radiance *= mix(0.12, 1.4, gPuddle);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.6, uWet * 0.8);
      roughnessFactor = mix(roughnessFactor, 0.04, gPuddle);`);
    sh.uniforms.uWet = terrainUniforms.uWet; sh.uniforms.uTime = terrainUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; uniform float uWet; uniform float uTime; float gPuddle = 0.0;
        float th(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(th(i), th(i + vec2(1, 0)), f.x), mix(th(i + vec2(0, 1)), th(i + 1.0), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float n1 = tn(vWPos.xz * 0.9), n2 = tn(vWPos.xz * 3.7), n3 = tn(vWPos.xz * 11.0);
          vec3 col = diffuseColor.rgb;
          // 平地：量化成三档的色块 + 细颗粒
          float patchv = floor((n1 * 0.7 + n2 * 0.3) * 3.0) / 3.0;
          col *= 0.9 + patchv * 0.16 + (n3 - 0.5) * 0.06;
          // 陡坡：岩层条纹、深色缝、竖向裂纹
          float steep = 1.0 - smoothstep(0.5, 0.8, vWNrm.y);
          float warp = tn(vWPos.xz * 0.5 + vWPos.y * 0.2) * 0.7;
          float band = fract(vWPos.y * 1.25 + warp);
          vec3 rockA = vec3(0.16, 0.165, 0.17), rockB = vec3(0.33, 0.32, 0.30);
          vec3 rock = mix(rockA, rockB, step(0.45, fract(vWPos.y * 0.62 + warp * 0.5)));
          rock *= 0.72 + 0.28 * smoothstep(0.0, 0.1, band) * (1.0 - smoothstep(0.9, 1.0, band));
          float crack = smoothstep(0.93, 0.98, tn(vec2(vWPos.x + vWPos.z, vWPos.y * 0.35) * 2.3));
          rock *= 1.0 - crack * 0.35;
          rock *= 0.9 + n3 * 0.2;
          col = mix(col, rock, steep);
          // 台地边缘一圈亮草唇，让层次清楚
          float lip = smoothstep(0.78, 0.86, vWNrm.y) * (1.0 - smoothstep(0.9, 0.97, vWNrm.y)) * step(1.7, vWPos.y);
          col = mix(col, col * 1.25, lip);
          // 雨天：整体变暗变湿，平地上积出水洼（水洼更暗、几乎镜面）
          float flatG = smoothstep(0.9, 0.97, vWNrm.y);
          gPuddle = smoothstep(0.52, 0.58, tn(vWPos.xz * 0.22 + 7.0) * 0.7 + tn(vWPos.xz * 0.9) * 0.3) * flatG * smoothstep(0.3, 0.8, uWet);
          col *= 1.0 - uWet * 0.3;
          col = mix(col, col * 0.45 + vec3(0.02, 0.03, 0.05), gPuddle);
          diffuseColor.rgb = col;
        }`);
  };
}

export { fbm, hash, smooth };

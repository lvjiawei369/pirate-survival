// 营地主画面的布景：山顶遗迹拱门、远海的石柱群、东崖洞口、晒鱼架、桌子、坐凳圆木、
// 半埋的宝藏箱、潮池。全部程序化，放进世界后和其它静态物件一样被合并成少量网格。
import * as THREE from 'three';
import { part, mat, woodMat, rockMat, paintRock, rockGeometry, roundedBox, buildPalm, buildFish, buildBarrel, buildCrate, buildLantern } from './models.js';

const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const stoneTone = '#aaa699';
function stoneGeo(geo, seed, moss = 0.35) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  return paintRock(geo, seed, { moss, tone: stoneTone });
}

// ─── 山顶遗迹：台基 + 双柱拱门 + 半塌的圆塔 + 石阶，顶上长草 ───
export function buildRuins() {
  const g = new THREE.Group();
  const moss = mat('#5f9a3a', { rough: 0.9 });
  part(stoneGeo(roundedBox(6.2, 0.7, 4.2, 0.15), 1, 0.2), rockMat, [0, 0.35, 0], [0, 0, 0], [1, 1, 1], g);
  for (let i = 0; i < 4; i++) part(stoneGeo(roundedBox(2.6 - i * 0.1, 0.28, 0.6, 0.06), 2 + i, 0.1), rockMat, [0, 0.14 + i * 0.0, 2.3 + (3 - i) * 0.55], [0, 0, 0], [1, 1 + i * 0.9, 1], g);
  // 拱门
  for (const sx of [-1, 1]) {
    part(stoneGeo(roundedBox(1.0, 4.2, 1.0, 0.1), 7 + sx, 0.25), rockMat, [sx * 1.55, 2.8, 0.2], [0, 0, 0], [1, 1, 1], g);
    part(stoneGeo(roundedBox(1.25, 0.35, 1.25, 0.08), 9 + sx, 0.2), rockMat, [sx * 1.55, 0.85, 0.2], [0, 0, 0], [1, 1, 1], g);
  }
  part(stoneGeo(new THREE.TorusGeometry(1.55, 0.5, 8, 18, Math.PI), 12, 0.6), rockMat, [0, 4.85, 0.2], [0, 0, 0], [1, 1, 0.95], g);
  part(stoneGeo(roundedBox(4.6, 0.7, 1.2, 0.12), 13, 0.8), rockMat, [0, 6.55, 0.2], [0, 0, 0.03], [1, 1, 1], g);
  // 拱门背后的塔：圆柱 + 小穹顶，顶上一圈缺口
  part(stoneGeo(cyl(1.35, 1.5, 5.6, 14), 14, 0.3), rockMat, [2.4, 3.5, -1.3], [0, 0, 0], [1, 1, 1], g);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; if (i === 2) continue;
    part(stoneGeo(roundedBox(0.55, 0.7, 0.4, 0.08), 20 + i, 0.4), rockMat, [2.4 + Math.cos(a) * 1.2, 6.6, -1.3 + Math.sin(a) * 1.2], [0, -a, 0], [1, 1, 1], g); }
  part(sph(1.1, 14, 8), moss, [2.4, 6.3, -1.3], [0, 0, 0], [1.05, 0.35, 1.05], g);
  // 塌下来的石块、断柱
  part(stoneGeo(cyl(0.45, 0.45, 2.2, 10), 30, 0.4), rockMat, [-2.6, 0.95, 1.4], [0, 0.5, Math.PI / 2], [1, 1, 1], g);
  part(stoneGeo(cyl(0.45, 0.5, 1.6, 10), 31, 0.5), rockMat, [-2.5, 1.5, -1.2], [0, 0, 0], [1, 1, 1], g);
  for (const [x, z, s] of [[-3.3, 2.6, 0.5], [3.5, 1.8, 0.6], [-1.2, 2.9, 0.35]]) part(paintRock(rockGeometry(x * 7, 1), x), rockMat, [x, 0.5, z], [0, x, 0], [s, s, s], g);
  // 垂下来的藤蔓和草
  for (const [x, y, z, sx, sy] of [[-1.55, 5.0, 0.72, 0.55, 1.6], [1.2, 6.2, 0.82, 0.8, 0.7], [0.3, 6.9, 0.2, 1.6, 0.3], [3.4, 5.5, -0.7, 0.5, 1.4]])
    part(sph(0.5, 10, 8), moss, [x, y, z], [0, 0, 0], [sx, sy, 0.35], g);
  return g;
}

// ─── 远海石柱：一截截叠起来、越往上越细的岩柱，顶上长草、插两棵棕榈；arch=true 时是两条腿撑起的石拱 ───
export function buildSpire(seed = 1, h = 12, { arch = false, palms = 2 } = {}) {
  const g = new THREE.Group();
  const legs = arch ? [[-2.2, 0.75], [2.2, 0.6]] : [[0, 1]];
  for (const [lx, k] of legs) {
    const H = h * k;
    let y = -1.5;
    for (let i = 0; y < H; i++) {
      const t = y / H, r = (3.2 - t * 1.3) * (arch ? 0.65 : 1) * (0.9 + ((seed * 7 + i * 3) % 5) * 0.05);
      const seg = 2.2 + ((seed + i) % 3) * 0.6;
      part(paintRock(rockGeometry(seed * 10 + i, 2), seed + i, { moss: 0.25, tone: i % 2 ? '#7d858b' : '#8c8e8c' }), rockMat,
        [lx + Math.sin(i * 1.7 + seed) * 0.35, y + seg * 0.5, Math.cos(i * 1.3 + seed) * 0.35], [0, i * 1.9 + seed, 0], [r, seg * 0.95, r * 0.92], g);
      y += seg * 0.72;
    }
  }
  const top = arch ? h * 0.78 : h;
  if (arch) part(paintRock(rockGeometry(seed + 50, 2), seed, { moss: 0.7 }), rockMat, [0, top, 0], [0, 0, 0.08], [4.6, 1.6, 2.2], g);
  part(sph(1, 14, 8), mat('#5b9a3c', { rough: 0.9 }), [0, top + 0.9, 0], [0, 0, 0], [arch ? 3.8 : 2.6, 0.7, arch ? 2 : 2.4], g);
  for (let i = 0; i < palms; i++) {
    const p = buildPalm(seed + i * 3); p.scale.setScalar(1.3 + i * 0.25);
    p.position.set((i - 0.5) * 1.4, top + 1.1, (i % 2) * 0.8 - 0.4); g.add(p);
  }
  return g;
}

// ─── 东崖洞口：岩石门框 + 木梁支架 + 深处暖光 + 门口两盏灯 + 木桶 ───
export function buildCaveMouth() {
  const g = new THREE.Group();
  // 洞内：黑色的深洞 + 里面透出的一点暖光
  const hole = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: '#150d08' }));
  hole.scale.set(1.9, 2.3, 1); hole.position.set(0, 1.9, -0.25); g.add(hole);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: '#ff9a45', transparent: true, opacity: 0.45, depthWrite: false }));
  glow.scale.set(0.9, 0.8, 1); glow.position.set(0.35, 1.0, -0.2); g.add(glow);
  // 门框：一圈大石头
  for (let i = 0; i <= 8; i++) {
    const a = i / 8 * Math.PI, s = 0.75 + (i % 3) * 0.2;
    part(paintRock(rockGeometry(60 + i, 1), i, { moss: 0.5 }), rockMat, [Math.cos(a) * 2.2, 0.2 + Math.sin(a) * 2.9, 0.1], [i, i * 2, 0], [s, s * 1.1, s * 0.8], g);
  }
  // 木梁支架（矿洞式）
  const beam = woodMat('#5e3d24', 0.9);
  for (const sx of [-1, 1]) part(roundedBox(0.28, 3.3, 0.28, 0.05), beam, [sx * 1.35, 1.65, 0.25], [0, 0, sx * -0.04], [1, 1, 1], g);
  part(roundedBox(3.2, 0.3, 0.32, 0.05), beam, [0, 3.35, 0.25], [0, 0, 0.02], [1, 1, 1], g);
  const lamp = part(roundedBox(0.26, 0.32, 0.26, 0.05), mat('#ffd98a', { emissive: '#ffb347', ei: 2.4 }), [0.6, 2.85, 0.4], [0, 0, 0], [1, 1, 1], g);
  lamp.castShadow = false;
  for (const [x, z] of [[-2.6, 1.2], [2.8, 1.4]]) { const l = buildLantern(); l.position.set(x, 0, z); l.rotation.y = x < 0 ? 0.3 : 2.8; l.userData.parts.lamp.material = mat('#ffd98a', { emissive: '#ffb347', ei: 2.2 }); g.add(l); }
  const b1 = buildBarrel(); b1.position.set(1.9, 0, 1.0); g.add(b1);
  const b2 = buildBarrel(); b2.position.set(2.5, 0, 0.4); b2.rotation.set(Math.PI / 2, 0.4, 0); b2.position.y = 0.36; g.add(b2);
  const c = buildCrate(); c.position.set(-1.9, 0, 0.9); c.rotation.y = 0.4; g.add(c);
  return g;
}

// ─── 晒鱼架：两副 A 字架 + 横杆，挂一排鱼 ───
export function buildFishRack() {
  const g = new THREE.Group();
  const w = woodMat('#6f4a2a', 0.9);
  for (const x of [-1.1, 1.1]) for (const sz of [-1, 1]) part(cyl(0.05, 0.06, 2.2, 7), w, [x, 1.0, sz * 0.35], [sz * 0.32, 0, 0], [1, 1, 1], g);
  part(cyl(0.045, 0.045, 2.6, 7), w, [0, 1.95, 0], [0, 0, Math.PI / 2], [1, 1, 1], g);
  const cols = ['#b8c4c8', '#d8a060', '#9fb0b8', '#c98f58'];
  for (let i = 0; i < 5; i++) {
    const f = buildFish(cols[i % 4]); f.scale.setScalar(1.6); f.rotation.set(-Math.PI / 2, i * 0.3, 0);
    f.position.set(-0.8 + i * 0.4, 1.55, 0); g.add(f);
    part(cyl(0.008, 0.008, 0.2, 3), mat('#d9c08a'), [-0.8 + i * 0.4, 1.85, 0], [0, 0, 0], [1, 1, 1], g);
  }
  return g;
}

// ─── 桌子：粗木桌面 + 酒瓶、杯子、摊开的地图 ───
export function buildTable() {
  const g = new THREE.Group();
  part(roundedBox(1.7, 0.12, 0.95, 0.04), woodMat('#9c6a3c'), [0, 0.82, 0], [0, 0, 0], [1, 1, 1], g);
  for (const [x, z] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]]) part(roundedBox(0.12, 0.78, 0.12, 0.03), woodMat('#6f4a2a'), [x, 0.39, z], [0, 0, 0], [1, 1, 1], g);
  part(cyl(0.07, 0.08, 0.3, 10), mat('#3d6b3a', { rough: 0.25 }), [-0.5, 1.03, 0.1], [0, 0, 0], [1, 1, 1], g);
  part(cyl(0.03, 0.04, 0.12, 8), mat('#3d6b3a', { rough: 0.25 }), [-0.5, 1.23, 0.1], [0, 0, 0], [1, 1, 1], g);
  part(cyl(0.07, 0.06, 0.14, 10), woodMat('#8a5a34'), [-0.2, 0.95, -0.2], [0, 0, 0], [1, 1, 1], g);
  part(roundedBox(0.7, 0.01, 0.5, 0.005), mat('#e6d3a8'), [0.35, 0.89, 0.05], [0, 0.25, 0], [1, 1, 1], g);
  part(cyl(0.04, 0.04, 0.55, 8), mat('#d9c08a'), [0.35, 0.92, -0.22], [0, 0.25, Math.PI / 2], [1, 1, 1], g);
  return g;
}

// ─── 篝火边的坐凳圆木 ───
export function buildLogSeat(len = 1.6) {
  const g = new THREE.Group();
  part(cyl(0.22, 0.24, len, 12), woodMat('#7a5230', 0.95), [0, 0.22, 0], [0, 0, Math.PI / 2], [1, 1, 1], g);
  for (const sx of [-1, 1]) part(cyl(0.2, 0.2, 0.02, 12), mat('#d9b27a'), [sx * len / 2, 0.22, 0], [0, 0, Math.PI / 2], [1, 1, 1], g);
  return g;
}

// ─── 半埋在沙里的宝藏：散架的木箱、金币堆、船舵、金杯 ───
export function buildTreasure() {
  const g = new THREE.Group();
  const w = woodMat('#8a5a34'), wd = woodMat('#5e3d24', 0.9);
  const gold = mat('#f2b632', { rough: 0.32, metal: 0.55, emissive: '#6b4a08', ei: 0.35 });
  part(roundedBox(1.5, 0.18, 1.0, 0.03), w, [0, 0.09, 0], [0, 0, 0], [1, 1, 1], g);
  part(roundedBox(1.5, 0.7, 0.1, 0.03), w, [0, 0.4, -0.48], [-0.12, 0, 0], [1, 1, 1], g);
  part(roundedBox(0.1, 0.62, 1.0, 0.03), w, [-0.72, 0.35, 0], [0, 0, 0.15], [1, 1, 1], g);
  part(roundedBox(1.6, 0.1, 0.12, 0.03), wd, [0.1, 0.72, -0.45], [0, 0.1, 0.25], [1, 1, 1], g);   // 断掉的箱板
  part(roundedBox(0.12, 0.08, 1.2, 0.03), wd, [0.9, 0.1, 0.45], [0, 0.7, 0], [1, 1, 1], g);
  // 金币堆 + 散落的金币
  part(sph(0.65, 16, 8), gold, [0, 0.18, 0], [0, 0, 0], [1.05, 0.5, 0.72], g);
  let s = 3; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const coin = cyl(0.09, 0.09, 0.025, 12);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = 0.35 + r() * 1.1;
    part(coin, gold, [Math.cos(a) * d, 0.03 + (d < 0.7 ? 0.25 : 0), Math.sin(a) * d * 0.8], [r() * 0.6, 0, r() * 0.6], [1, 1, 1], g);
  }
  // 斜靠着的船舵
  const wheel = new THREE.Group(); wheel.position.set(0.55, 0.55, 0.25); wheel.rotation.set(-0.35, -0.5, 0.2); g.add(wheel);
  part(new THREE.TorusGeometry(0.42, 0.045, 8, 24), wd, [0, 0, 0], [0, 0, 0], [1, 1, 1], wheel);
  part(cyl(0.1, 0.1, 0.12, 12), gold, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 1], wheel);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2;
    part(cyl(0.025, 0.035, 0.62, 6), wd, [Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0], [0, 0, a - Math.PI / 2], [1, 1, 1], wheel); }
  // 金杯
  part(cyl(0.09, 0.05, 0.14, 12), gold, [-0.35, 0.47, 0.2], [0, 0, 0], [1, 1, 1], g);
  part(cyl(0.02, 0.02, 0.1, 6), gold, [-0.35, 0.35, 0.2], [0, 0, 0], [1, 1, 1], g);
  part(cyl(0.07, 0.07, 0.02, 10), gold, [-0.35, 0.3, 0.2], [0, 0, 0], [1, 1, 1], g);
  return g;
}

// ─── 停在木桩上的鹦鹉（布景，不是跟班那只）───
export function buildParrotPerch() {
  const g = new THREE.Group();
  part(cyl(0.12, 0.15, 2.6, 8), woodMat('#6f4a2a', 0.9), [0, 1.3, 0], [0, 0, 0.03], [1, 1, 1], g);
  part(cyl(0.05, 0.05, 0.9, 6), woodMat('#6f4a2a', 0.9), [0, 2.35, 0], [0, 0, Math.PI / 2], [1, 1, 1], g);
  // 鹦鹉本身是 GLB，加载后挂到这个空节点上（布景合并时空节点会保留）
  const p = new THREE.Group(); p.userData.parrotSlot = true; p.position.set(0.18, 2.4, 0); p.rotation.y = 0.6; g.add(p);
  return g;
}

// ─── 石头脚下的白沫圈（石头立在水里时用）───
let foamMat = null;
export function buildFoamRing(r = 1.2, uTime) {
  foamMat ||= new THREE.ShaderMaterial({
    uniforms: { uTime }, transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.0),f.x),f.y); }
      void main(){ vec2 c = vUv - 0.5; float r = length(c) * 2.0, a = atan(c.y, c.x);
        float k = n(vec2(a * 3.0, r * 6.0 - uTime * 0.8)) * 0.6 + n(vec2(a * 7.0 + 3.0, r * 12.0 + uTime * 0.5)) * 0.4;
        float band = smoothstep(0.55, 0.62, r + k * 0.25) * (1.0 - smoothstep(0.78, 1.0, r + k * 0.1));
        gl_FragColor = vec4(vec3(0.97, 0.99, 1.0), band * smoothstep(0.35, 0.6, k) * 0.85); }`
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 28).rotateX(-Math.PI / 2), foamMat);
  m.renderOrder = 4;
  return m;
}

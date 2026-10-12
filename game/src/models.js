// 程序化“软陶手办”模型：所有体块倒圆、哑光、主材 ≤3 种。
// 每个构建函数返回 THREE.Group，动画需要的关节挂在 group.userData.parts 上。
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const matCache = new Map();
export function mat(color, { rough = 0.85, metal = 0, emissive = null, ei = 0, opacity = 1 } = {}) {
  const key = `${color}|${rough}|${metal}|${emissive}|${ei}|${opacity}`;
  if (!matCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = ei; }
    if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
    matCache.set(key, m);
  }
  return matCache.get(key);
}
// 需要单独闪白/变色的实例用独立材质
export const uniqueMat = (color, o) => { const m = mat(color, o).clone(); return m; };

export function part(geo, material, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], parent) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...p); m.rotation.set(...r); m.scale.set(...s);
  m.castShadow = true; m.receiveShadow = true;
  parent?.add(m);
  return m;
}
// ─── 画布贴图：木纹、帆布（程序化生成，灰度纹理 × 材质颜色）───
export function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  t.anisotropy = 4;
  return t;
}
let _woodTex = null;
export function woodTexture() {
  if (_woodTex) return _woodTex;
  _woodTex = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#e8e8e8'; x.fillRect(0, 0, w, h);
    let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    // 木板缝 + 顺纹：纹理的 u 方向是木纹方向
    for (let i = 0; i < 90; i++) {
      const y = r() * h, a = 0.05 + r() * 0.12;
      x.strokeStyle = `rgba(60,40,25,${a})`; x.lineWidth = 0.6 + r() * 1.6;
      x.beginPath(); x.moveTo(0, y);
      for (let k = 0; k <= 8; k++) x.lineTo(k * w / 8, y + Math.sin(k * 0.9 + i) * (1 + r() * 2));
      x.stroke();
    }
    for (let i = 0; i < 6; i++) { const cx = r() * w, cy = r() * h; x.fillStyle = 'rgba(70,45,25,0.22)'; x.beginPath(); x.ellipse(cx, cy, 5 + r() * 5, 2 + r() * 2, 0, 0, 7); x.fill(); }
    x.fillStyle = 'rgba(40,25,15,0.45)'; x.fillRect(0, 0, w, 3); x.fillRect(0, h / 2, w, 2);
  });
  return _woodTex;
}
const woodCache = new Map();
export function woodMat(color, rough = 0.85) {
  const k = color + rough;
  if (!woodCache.has(k)) woodCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, map: woodTexture() }));
  return woodCache.get(k);
}
// 岩石：顶面长苔、底部偏暗、带冷暖色斑（顶点色）
export const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93 });
const _rc = { base: new THREE.Color(), moss: new THREE.Color('#5f9a3a'), mossLight: new THREE.Color('#8cc050'), dark: new THREE.Color('#3f4448'), tmp: new THREE.Color() };
export function paintRock(g, seed = 1, { moss = 0.5, tone = '#8f9396' } = {}) {
  const p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < p.count; i++) { minY = Math.min(minY, p.getY(i)); maxY = Math.max(maxY, p.getY(i)); }
  _rc.base.set(tone);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = n.getY(i);
    const t = (y - minY) / (maxY - minY || 1);
    const nz = Math.sin(x * 5.1 + seed) * Math.cos(z * 4.3 - seed) * 0.5 + 0.5;
    const c = _rc.tmp.copy(_rc.base).multiplyScalar(0.72 + 0.42 * t + (nz - 0.5) * 0.16);
    c.lerp(_rc.dark, (1 - t) * 0.35);
    const m = THREE.MathUtils.smoothstep(ny + (nz - 0.5) * 0.5, 0.45, 0.8) * moss;
    c.lerp(nz > 0.5 ? _rc.mossLight : _rc.moss, m);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const sph = (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h);
const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 14);
const cyl = (rt, rb, h, s = 16) => new THREE.CylinderGeometry(rt, rb, h, s);

function roundedBox(w, h, d, r = 0.08) {
  const g = new THREE.BoxGeometry(w, h, d, 6, 6, 6);
  const p = g.attributes.position, v = new THREE.Vector3();
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const c = new THREE.Vector3(Math.max(-hw, Math.min(hw, v.x)), Math.max(-hh, Math.min(hh, v.y)), Math.max(-hd, Math.min(hd, v.z)));
    v.sub(c).normalize().multiplyScalar(r).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
export { roundedBox };

// ───────────────────────── 主角 洛可 ─────────────────────────
export function buildHero() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const skin = mat('#f4c9a3', { rough: 0.7 }), coat = mat('#237a78'), coatDark = mat('#1b5f5d');
  const red = mat('#d8413a', { rough: 0.8 }), hair = mat('#4a2c1d', { rough: 0.75 });
  const pants = mat('#3b3a45'), boot = mat('#6b4428', { rough: 0.7 }), brass = mat('#c7923e', { rough: 0.35, metal: 0.6 });
  const shirt = mat('#efe3c8');

  // 腿与靴
  const legs = [];
  for (const sx of [-0.13, 0.13]) {
    const hip = new THREE.Group(); hip.position.set(sx, 0.46, 0); body.add(hip);
    part(cap(0.085, 0.2), pants, [0, -0.17, 0], [0, 0, 0], [1, 1, 1], hip);
    part(cap(0.1, 0.1), boot, [0, -0.37, 0.04], [Math.PI / 2, 0, 0], [1, 1, 0.9], hip);
    part(cyl(0.11, 0.11, 0.05), mat('#8a5a34'), [0, -0.25, 0], [0, 0, 0], [1, 1, 1], hip);
    legs.push(hip);
  }
  // 身体：衬衣 + 敞开的旧外套（下摆外张）
  const torso = new THREE.Group(); torso.position.y = 0.5; body.add(torso);
  part(cap(0.21, 0.2), shirt, [0, 0.2, 0.01], [0, 0, 0], [1, 1, 0.85], torso);
  part(cyl(0.2, 0.3, 0.34, 18), coat, [0, 0.1, 0], [0, 0, 0], [1, 1, 0.85], torso);
  part(cyl(0.225, 0.2, 0.24, 18), coat, [0, 0.34, -0.02], [0, 0, 0], [1, 1, 0.82], torso);
  // 外套前襟开口：用衬衣色竖条盖在前面
  part(roundedBox(0.12, 0.44, 0.05, 0.02), shirt, [0, 0.2, 0.19], [0.05, 0, 0], [1, 1, 1], torso);
  part(roundedBox(0.035, 0.46, 0.05, 0.015), coatDark, [-0.075, 0.2, 0.2], [0.05, 0, 0], [1, 1, 1], torso);
  part(roundedBox(0.035, 0.46, 0.05, 0.015), coatDark, [0.075, 0.2, 0.2], [0.05, 0, 0], [1, 1, 1], torso);
  // 腰带 + 黄铜扣
  part(cyl(0.23, 0.23, 0.07, 20), mat('#5a3a22'), [0, 0.04, 0], [0, 0, 0], [1, 1, 0.86], torso);
  part(roundedBox(0.09, 0.07, 0.03, 0.012), brass, [0, 0.04, 0.2], [0, 0, 0], [1, 1, 1], torso);
  // 红色领巾
  part(new THREE.TorusGeometry(0.15, 0.055, 10, 20), red, [0, 0.47, 0], [Math.PI / 2, 0, 0], [1, 0.9, 1], torso);
  part(new THREE.ConeGeometry(0.07, 0.14, 10), red, [0.02, 0.38, 0.17], [2.9, 0, 0.2], [1, 1, 0.6], torso);
  // 贝壳挂件
  part(new THREE.ConeGeometry(0.04, 0.06, 8), mat('#fbf1e4', { rough: 0.5 }), [-0.09, 0.3, 0.205], [Math.PI, 0, 0], [1, 1, 0.5], torso);
  // 小背包
  part(roundedBox(0.3, 0.3, 0.14, 0.05), mat('#8a6a44'), [0, 0.22, -0.22], [0.08, 0, 0], [1, 1, 1], torso);
  part(roundedBox(0.3, 0.08, 0.16, 0.03), mat('#6f5335'), [0, 0.33, -0.23], [0.08, 0, 0], [1, 1, 1], torso);

  // 手臂（肩部为关节）
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sx * 0.25, 0.42, 0); torso.add(sh);
    part(cap(0.075, 0.17), coat, [0, -0.13, 0], [0, 0, sx * 0.12], [1, 1, 1], sh);
    part(cyl(0.085, 0.085, 0.05), coatDark, [sx * 0.03, -0.24, 0], [0, 0, sx * 0.12], [1, 1, 1], sh);
    const hand = part(sph(0.075), skin, [sx * 0.035, -0.31, 0], [0, 0, 0], [1, 1, 1], sh);
    arms.push({ sh, hand });
  }
  // 木弯刀挂在右手（默认隐藏，制作后显示）
  const sword = new THREE.Group(); sword.position.set(0.035, -0.31, 0.02); arms[1].sh.add(sword);
  const blade = new THREE.Shape();
  blade.moveTo(-0.04, 0); blade.lineTo(0.04, 0); blade.quadraticCurveTo(0.08, 0.3, 0.02, 0.58);
  blade.quadraticCurveTo(-0.02, 0.4, -0.04, 0);
  const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 });
  bladeGeo.translate(0, 0.08, -0.017);
  part(bladeGeo, mat('#c8a06a', { rough: 0.6 }), [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 1], sword);
  part(roundedBox(0.18, 0.035, 0.05, 0.015), mat('#7a4f2c'), [0, 0, 0.06], [0, 0, 0], [1, 1, 1], sword);
  part(cyl(0.028, 0.028, 0.12, 8), mat('#237a78'), [0, 0, -0.01], [Math.PI / 2, 0, 0], [1, 1, 1], sword);
  sword.visible = false;
  // 石斧（和刀共用右手，二选一显示）
  const axe = new THREE.Group(); axe.position.copy(sword.position); arms[1].sh.add(axe);
  part(cyl(0.025, 0.03, 0.55, 8), mat('#8a5a34'), [0, 0, 0.2], [Math.PI / 2, 0, 0], [1, 1, 1], axe);
  part(new THREE.DodecahedronGeometry(0.1, 0), mat('#9a978c', { rough: 0.9 }), [0.07, 0, 0.42], [0.3, 0.5, 0], [1.4, 0.6, 1], axe);
  part(new THREE.TorusGeometry(0.035, 0.014, 6, 10), mat('#237a78'), [0.0, 0, 0.36], [0, Math.PI / 2, 0], [1, 1, 1], axe);
  axe.visible = false;

  // 头：大头 1:2.5
  const head = new THREE.Group(); head.position.y = 1.28; body.add(head);
  part(sph(0.33, 28, 20), skin, [0, 0, 0], [0, 0, 0], [1, 0.95, 0.95], head);
  // 头发：后脑 + 刘海簇 + 鬓角
  part(sph(0.345, 24, 18), hair, [0, 0.03, -0.05], [0, 0, 0], [1, 0.95, 0.92], head);
  for (const [x, y, z, rz, s] of [[-0.17, 0.08, 0.25, 0.6, 1], [-0.05, 0.1, 0.29, 0.2, 1.1], [0.09, 0.1, 0.28, -0.3, 1], [0.21, 0.05, 0.22, -0.7, 0.9], [-0.28, -0.08, 0.1, 0.3, 0.9], [0.28, -0.08, 0.1, -0.3, 0.9]])
    part(new THREE.ConeGeometry(0.075 * s, 0.2 * s, 8), hair, [x, y, z], [2.6, 0, rz], [1, 1, 0.7], head);
  // 红头巾：盖住头顶的球冠 + 脑后结 + 两条飘带
  part(new THREE.SphereGeometry(0.36, 26, 14, 0, Math.PI * 2, 0, 1.25), red, [0, 0.02, -0.02], [-0.25, 0, 0], [1, 0.95, 0.98], head);
  part(sph(0.08), red, [0.02, 0.08, -0.35], [0, 0, 0], [1, 0.9, 0.9], head);
  const tails = [];
  for (const sx of [-1, 1]) {
    const t = part(roundedBox(0.09, 0.26, 0.03, 0.012), red, [0.06 * sx, -0.05, -0.38], [0.35, 0, sx * 0.35], [1, 1, 1], head);
    tails.push(t);
  }
  // 脸：极简豆豆眼 + 高光 + 腮红
  const eyeMat = mat('#1d1a1f', { rough: 0.25 }), white = mat('#ffffff', { rough: 0.2 });
  const eyes = [];
  for (const sx of [-1, 1]) {
    const e = part(sph(0.055, 14, 10), eyeMat, [sx * 0.12, -0.02, 0.29], [0, 0, 0], [0.8, 1.05, 0.5], head);
    part(sph(0.018, 8, 6), white, [sx * 0.012 + 0.015, 0.03, 0.035], [0, 0, 0], [1, 1, 1], e);
    part(sph(0.045, 10, 8), mat('#f39a8a', { rough: 0.9 }), [sx * 0.2, -0.1, 0.25], [0, 0, 0], [1, 0.6, 0.35], head);
    eyes.push(e);
  }
  part(sph(0.03, 8, 6), mat('#e8ac86'), [0, -0.07, 0.32], [0, 0, 0], [1, 0.8, 0.8], head);
  part(new THREE.TorusGeometry(0.035, 0.009, 6, 12, Math.PI), mat('#8a3b30'), [0, -0.14, 0.3], [0, 0, Math.PI], [1, 1, 1], head);

  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  root.userData.parts = { body, torso, head, legs, arms, sword, axe, tails, eyes };
  return root;
}

// ───────────────────────── 鹦鹉 针针 ─────────────────────────
export function buildParrot() {
  const root = new THREE.Group();
  const red = mat('#e85d4a', { rough: 0.7 }), blue = mat('#2d8fd0', { rough: 0.7 }), teal = mat('#27b7c7', { rough: 0.7 });
  const yellow = mat('#f2c14e', { rough: 0.7 });
  part(sph(0.2), red, [0, 0, 0], [0.3, 0, 0], [0.9, 0.9, 1.25], root);
  part(sph(0.13), yellow, [0, -0.05, 0.12], [0, 0, 0], [1, 0.9, 0.9], root);
  const head = part(sph(0.15), red, [0, 0.16, 0.18], [0, 0, 0], [1, 1, 1], root);
  part(new THREE.ConeGeometry(0.06, 0.14, 10), mat('#3a3a3a', { rough: 0.4 }), [0, -0.03, 0.15], [1.9, 0, 0], [1, 1, 1], head);
  for (const sx of [-1, 1]) {
    part(sph(0.04, 10, 8), mat('#ffffff'), [sx * 0.08, 0.03, 0.1], [0, 0, 0], [1, 1, 0.6], head);
    part(sph(0.022, 8, 6), mat('#111111', { rough: 0.2 }), [sx * 0.095, 0.035, 0.125], [0, 0, 0], [1, 1, 1], head);
  }
  const wings = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(sx * 0.15, 0.05, 0); root.add(w);
    part(sph(0.18, 14, 10), blue, [sx * 0.16, 0, -0.03], [0, 0, 0], [1.2, 0.25, 0.7], w);
    part(sph(0.12, 12, 8), teal, [sx * 0.3, 0, -0.08], [0, 0, 0], [1.1, 0.2, 0.6], w);
    wings.push(w);
  }
  for (const [x, c] of [[-0.05, blue], [0.05, teal], [0, red]])
    part(roundedBox(0.07, 0.03, 0.34, 0.015), c, [x, -0.05, -0.33], [-0.4, x * 3, 0], [1, 1, 1], root);
  // 黄铜罗盘吊坠
  part(cyl(0.045, 0.045, 0.02, 14), mat('#c7923e', { rough: 0.3, metal: 0.7 }), [0, -0.12, 0.2], [1.3, 0, 0], [1, 1, 1], root);
  root.userData.parts = { wings, head };
  return root;
}

// ───────────────────────── 椰壳蟹 ─────────────────────────
export function buildCrab() {
  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 0.42; root.add(body);
  const shellMat = uniqueMat('#7a4b2a', { rough: 0.9 });
  const clawMat = uniqueMat('#d9432f', { rough: 0.6 });
  const rope = mat('#d9c08a', { rough: 0.9 });
  const shell = part(sph(0.5, 22, 16), shellMat, [0, 0.08, 0], [0, 0, 0], [1, 0.82, 0.95], body);
  // 椰壳纤维斑点
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4, y = 0.15 + (i % 3) * 0.12;
    part(sph(0.07, 6, 5), mat('#5c3820', { rough: 1 }), [Math.cos(a) * 0.4, y, Math.sin(a) * 0.36], [a, a, 0], [1, 0.4, 1], body);
  }
  // 椰壳切口：下沿浅色边
  part(new THREE.TorusGeometry(0.47, 0.05, 8, 26), mat('#efe0bf', { rough: 0.9 }), [0, -0.08, 0], [Math.PI / 2, 0, 0], [1, 0.95, 1], body);
  // 绳结武装：交叉的绳
  part(new THREE.TorusGeometry(0.46, 0.03, 6, 24), rope, [0, 0.12, 0], [0, 0, 0.5], [1, 0.86, 1], body);
  part(new THREE.TorusGeometry(0.46, 0.03, 6, 24), rope, [0, 0.12, 0], [0, 0, -0.5], [1, 0.86, 1], body);
  // 眼睛（眼柄）
  const eyes = [];
  for (const sx of [-1, 1]) {
    part(cyl(0.03, 0.035, 0.22, 8), clawMat, [sx * 0.14, 0.32, 0.3], [0.3, 0, sx * -0.2], [1, 1, 1], body);
    const e = part(sph(0.1, 14, 10), mat('#ffffff', { rough: 0.3 }), [sx * 0.17, 0.46, 0.33], [0, 0, 0], [1, 1, 1], body);
    part(sph(0.055, 10, 8), mat('#161616', { rough: 0.2 }), [0, 0.0, 0.07], [0, 0, 0], [1, 1, 0.6], e);
    eyes.push(e);
  }
  // 大钳
  const claws = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(sx * 0.42, 0.02, 0.2); body.add(arm);
    part(cap(0.07, 0.25), clawMat, [sx * 0.12, 0.05, 0.1], [0.8, 0, sx * -0.9], [1, 1, 1], arm);
    const pincer = new THREE.Group(); pincer.position.set(sx * 0.26, 0.18, 0.28); arm.add(pincer);
    part(sph(0.17, 16, 12), clawMat, [0, 0, 0], [0, 0, 0], [0.85, 0.75, 1.1], pincer);
    const top = part(new THREE.ConeGeometry(0.09, 0.3, 10), clawMat, [0, 0.07, 0.2], [1.3, 0, 0], [1, 1, 0.7], pincer);
    const bot = part(new THREE.ConeGeometry(0.07, 0.22, 10), clawMat, [0, -0.06, 0.17], [1.75, 0, 0], [1, 1, 0.7], pincer);
    claws.push({ arm, pincer, top, bot });
  }
  // 腿
  const legs = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const g = new THREE.Group(); g.position.set(sx * 0.38, -0.05, -0.15 + i * 0.16); body.add(g);
    part(cyl(0.035, 0.025, 0.42, 6), clawMat, [sx * 0.15, -0.14, 0], [0, 0, sx * 0.9], [1, 1, 1], g);
    legs.push(g);
  }
  root.userData.parts = { body, shell, claws, legs, eyes, flashMats: [shellMat, clawMat] };
  return root;
}

// ───────────────────────── 棕榈树 ─────────────────────────
function frondGeometry(len = 2.4, width = 0.55) {
  const segs = 10;
  const g = new THREE.BufferGeometry();
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = width * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.35);
    const z = t * len, y = -t * t * len * 0.55;
    pos.push(-w, y - w * 0.25, z, 0, y + 0.04, z, w, y - w * 0.25, z);
    if (i < segs) {
      const a = i * 3;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const FROND = frondGeometry();
export function buildPalm(seed = 0) {
  const root = new THREE.Group();
  const trunk = new THREE.Group(); root.add(trunk);
  const lean = 0.25 + (seed % 3) * 0.08, dir = seed * 1.7;
  const segs = 7, segH = 0.62;
  let p = new THREE.Vector3(), ang = 0;
  for (let i = 0; i < segs; i++) {
    ang = lean * (i / segs) * 1.2;
    const r = 0.26 - i * 0.018;
    const m = part(cyl(r * 0.92, r, segH * 1.02, 12), mat(i % 2 ? '#9c7248' : '#86603a', { rough: 0.95 }), [0, 0, 0], [ang, 0, 0], [1, 1, 1], trunk);
    const step = new THREE.Vector3(0, segH, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), ang);
    m.position.copy(p).addScaledVector(step, 0.5);
    p.add(step);
  }
  trunk.rotation.y = dir;
  const crown = new THREE.Group(); crown.position.copy(p); trunk.add(crown);
  const greens = ['#4f9a55', '#5aa85a', '#438a4c'];
  for (let i = 0; i < 8; i++) {
    const f = part(FROND, mat(greens[i % 3], { rough: 0.8 }), [0, 0.05, 0], [-0.25 - (i % 2) * 0.2, i * (Math.PI * 2 / 8) + seed, 0], [1, 1, 0.9 + (i % 3) * 0.1], crown);
    f.material.side = THREE.DoubleSide;
  }
  const nuts = new THREE.Group(); crown.add(nuts);
  for (let i = 0; i < 3; i++) part(sph(0.15, 12, 10), mat('#6b4a2a', { rough: 0.8 }), [Math.cos(i * 2.1) * 0.18, -0.15, Math.sin(i * 2.1) * 0.18], [0, 0, 0], [1, 1, 1], nuts);
  root.userData.parts = { trunk, crown, nuts };
  return root;
}

export function buildStump() {
  const g = new THREE.Group();
  part(cyl(0.24, 0.3, 0.3, 12), mat('#86603a', { rough: 0.95 }), [0, 0.15, 0], [0, 0, 0], [1, 1, 1], g);
  part(cyl(0.22, 0.22, 0.02, 12), mat('#d9b27a', { rough: 0.9 }), [0, 0.31, 0], [0, 0, 0], [1, 1, 1], g);
  return g;
}

// ───────────────────────── 岩石 / 灌木 / 漂流木 / 石块 ─────────────────────────
export function rockGeometry(seed = 1, detail = 2) {
  // Icosahedron 是非索引几何（每个面独立顶点），直接算法线会一面一面的“低多边形”；
  // 先合并顶点再算法线，并多细分一级 → 圆润的鹅卵石
  let g = new THREE.IcosahedronGeometry(1, detail + 1);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 3.1 + seed) * Math.cos(v.z * 2.7 + seed * 1.3) * 0.12 + Math.sin(v.y * 4 + seed * 2) * 0.06;
    v.multiplyScalar(1 + n);
    v.y = v.y > 0 ? v.y * 0.75 : v.y * 0.5;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
const ROCK_TONES = ['#8d9296', '#9a9a94', '#7f878d', '#a09c92'];
export function buildBoulder(seed, size = 1) {
  const g = new THREE.Group();
  // 圆润的大石头：顶上长苔（顶点色），偶尔旁边再挨一块小的
  const geo = paintRock(rockGeometry(seed), seed, { moss: seed % 3 === 0 ? 0.95 : 0.55, tone: ROCK_TONES[Math.abs(seed | 0) % 4] });
  part(geo, rockMat, [0, size * 0.35, 0], [0, seed, 0], [size, size * 1.05, size * 0.9], g);
  if (seed % 2 === 0 && size > 0.7) part(paintRock(rockGeometry(seed + 5, 1), seed + 5), rockMat, [size * 0.85, size * 0.12, size * 0.3], [0, seed * 2, 0], [size * 0.42, size * 0.4, size * 0.38], g);
  return g;
}
export function buildBush(seed = 0) {
  const g = new THREE.Group();
  const greens = ['#4f9a55', '#5eae5d', '#3f8448'];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3 + seed;
    part(sph(0.45 - i * 0.03, 14, 10), mat(greens[i % 3], { rough: 0.85 }), [Math.cos(a) * 0.35, 0.35 + (i % 2) * 0.18, Math.sin(a) * 0.3], [0, 0, 0], [1, 0.85, 1], g);
  }
  // 可采集提示：浅色大叶片
  for (let i = 0; i < 3; i++)
    part(FROND, mat('#79c06a', { rough: 0.8 }), [0, 0.6, 0], [-0.9, i * 2.1 + seed, 0], [0.35, 0.35, 0.35], g).material.side = THREE.DoubleSide;
  const berries = new THREE.Group(); g.add(berries);
  return g;
}
export function buildDriftwood(seed = 0) {
  const g = new THREE.Group();
  part(cap(0.12, 1.0), mat('#b89a74', { rough: 0.95 }), [0, 0.1, 0], [0, 0, Math.PI / 2], [1, 1, 1], g);
  part(cap(0.07, 0.35), mat('#a8896a', { rough: 0.95 }), [0.2, 0.15, 0.18], [0.3, 0.8, Math.PI / 2.4], [1, 1, 1], g);
  g.rotation.y = seed;
  return g;
}
export function buildStones(seed = 0) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++)
    part(rockGeometry(seed + i, 1), mat(i % 2 ? '#9d988c' : '#b3ad9f', { rough: 0.9 }), [Math.cos(i * 2.2) * 0.22, 0.1, Math.sin(i * 2.2) * 0.2], [0, i, 0], [0.2 - i * 0.03, 0.18, 0.2], g);
  return g;
}
export function buildShell() {
  const g = new THREE.Group();
  const m = mat('#f7d9c4', { rough: 0.55 });
  const s = part(new THREE.SphereGeometry(0.18, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m, [0, 0.02, 0], [0, 0, 0], [1, 0.45, 1.1], g);
  for (let i = -2; i <= 2; i++) part(roundedBox(0.02, 0.02, 0.36, 0.008), mat('#e8b29a'), [i * 0.06, 0.07, 0], [0, i * 0.18, 0], [1, 1, 1], g);
  s.castShadow = true;
  return g;
}

// ───────────────────────── 营地设施 ─────────────────────────
export function buildWorkbench() {
  const g = new THREE.Group();
  const wood = mat('#a8763f', { rough: 0.8 }), dark = mat('#7a5230');
  part(roundedBox(1.9, 0.14, 0.9, 0.04), wood, [0, 0.85, 0], [0, 0, 0], [1, 1, 1], g);
  for (const [x, z] of [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]])
    part(roundedBox(0.12, 0.8, 0.12, 0.03), dark, [x, 0.4, z], [0, 0, 0], [1, 1, 1], g);
  part(roundedBox(1.7, 0.08, 0.7, 0.03), dark, [0, 0.25, 0], [0, 0, 0], [1, 1, 1], g);
  // 台面上的工具：锤子、锯、青绿布卷
  part(cyl(0.03, 0.03, 0.4, 8), mat('#8a5a34'), [-0.4, 0.95, 0.1], [0, 0, Math.PI / 2], [1, 1, 1], g);
  part(roundedBox(0.12, 0.1, 0.1, 0.02), mat('#8e8a7c', { rough: 0.5, metal: 0.4 }), [-0.2, 0.96, 0.1], [0, 0, 0], [1, 1, 1], g);
  part(cyl(0.1, 0.1, 0.35, 12), mat('#237a78'), [0.5, 0.97, -0.15], [0, 0, Math.PI / 2], [1, 1, 1], g);
  part(roundedBox(0.5, 0.04, 0.25, 0.01), mat('#e6d3a8'), [0.1, 0.93, -0.2], [0, 0.3, 0], [1, 1, 1], g);
  return g;
}
export function buildCampfire() {
  const g = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    part(rockGeometry(i, 1), mat('#8e8a7c', { rough: 0.95 }), [Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55], [0, a, 0], [0.18, 0.15, 0.18], g);
  }
  for (let i = 0; i < 4; i++) part(cap(0.07, 0.6), mat('#6b4428'), [0, 0.22, 0], [1.1, i * 0.8, 0], [1, 1, 1], g);
  const flame = new THREE.Group(); flame.position.y = 0.3; g.add(flame);
  const f1 = part(new THREE.ConeGeometry(0.28, 0.7, 10), mat('#ff9a3c', { emissive: '#ff7a1a', ei: 2.2 }), [0, 0.3, 0], [0, 0, 0], [1, 1, 1], flame);
  const f2 = part(new THREE.ConeGeometry(0.16, 0.45, 8), mat('#ffe27a', { emissive: '#ffd24a', ei: 3 }), [0, 0.22, 0], [0, 0, 0], [1, 1, 1], flame);
  f1.castShadow = f2.castShadow = false;
  const light = new THREE.PointLight('#ffa050', 6, 7, 1.6); light.position.y = 0.8; g.add(light);
  // 烤鱼架
  part(cyl(0.025, 0.025, 1.2, 6), mat('#6b4428'), [-0.5, 0.55, 0], [0, 0, 0.2], [1, 1, 1], g);
  part(cyl(0.025, 0.025, 1.2, 6), mat('#6b4428'), [0.5, 0.55, 0], [0, 0, -0.2], [1, 1, 1], g);
  part(cyl(0.02, 0.02, 1.2, 6), mat('#6b4428'), [0, 1.08, 0], [0, 0, Math.PI / 2], [1, 1, 1], g);
  g.userData.parts = { flame, light };
  return g;
}
// 营地凉棚：四根木桩撑起一块下垂的红帆布（前高后低），前沿一排三角垂边，布上画白色交叉骨头
let _clothTex = null;
function clothTexture() {
  if (_clothTex) return _clothTex;
  _clothTex = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 3) { x.fillStyle = `rgba(0,0,0,${0.03 + (i % 9 === 0 ? 0.04 : 0)})`; x.fillRect(i, 0, 1, h); x.fillRect(0, i, w, 1); }
    // 缝线补丁
    x.fillStyle = 'rgba(80,20,10,0.25)'; x.fillRect(w * 0.08, h * 0.62, w * 0.22, h * 0.2);
    x.strokeStyle = 'rgba(255,240,220,0.5)'; x.setLineDash([4, 4]); x.lineWidth = 2; x.strokeRect(w * 0.08, h * 0.62, w * 0.22, h * 0.2); x.setLineDash([]);
    // 交叉骨头 + 圆头
    x.save(); x.translate(w * 0.55, h * 0.45); x.strokeStyle = '#f4ead8'; x.lineCap = 'round'; x.lineWidth = 16;
    for (const a of [0.75, -0.75]) { x.save(); x.rotate(a); x.beginPath(); x.moveTo(-48, 0); x.lineTo(48, 0); x.stroke();
      x.fillStyle = '#f4ead8'; for (const e of [-52, 52]) for (const o of [-8, 8]) { x.beginPath(); x.arc(e, o, 10, 0, 7); x.fill(); } x.restore(); }
    x.fillStyle = '#f4ead8'; x.beginPath(); x.arc(0, -8, 26, 0, 7); x.fill(); x.fillRect(-14, 8, 28, 16);
    x.fillStyle = '#8a1d18'; for (const o of [-10, 10]) { x.beginPath(); x.arc(o, -8, 7, 0, 7); x.fill(); }
    x.restore();
  });
  return _clothTex;
}
// 帐篷里的矮床：木框 + 四条腿 + 床垫 + 枕头。主角坐在床的前沿（z = front），双脚踩地。
// 高度按坐姿动作实测：坐姿时臀部离地约 0.42 米
const BED_H = 0.42;
function buildCot(g, { x = 0, front = 0.35, len = 1.6, w = 0.95, cloth = '#d9c08a' }) {
  const zc = front - len / 2, wood = woodMat('#8a5a34');
  part(roundedBox(w, 0.1, len, 0.03), wood, [x, BED_H - 0.17, zc], [0, 0, 0], [1, 1, 1], g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    part(roundedBox(0.08, BED_H - 0.17, 0.08, 0.02), wood, [x + sx * (w / 2 - 0.06), (BED_H - 0.17) / 2, zc + sz * (len / 2 - 0.06)], [0, 0, 0], [1, 1, 1], g);
  part(roundedBox(w - 0.06, 0.13, len - 0.06, 0.05), mat(cloth), [x, BED_H - 0.065, zc], [0, 0, 0], [1, 1, 1], g);
  part(roundedBox(w * 0.7, 0.12, 0.3, 0.05), mat('#f3ead6'), [x, BED_H + 0.05, zc - len / 2 + 0.22], [0, 0, 0], [1, 1, 1], g);
}

export function buildTent() {
  const g = new THREE.Group();
  const post = woodMat('#6a4428'), W = 3.9, D = 3.3;
  const cloth = new THREE.MeshStandardMaterial({ color: '#b7302a', roughness: 0.92, map: clothTexture(), side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(W, D, 14, 12);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const sag = (1 - Math.pow(Math.abs(x) / (W / 2), 2)) * (1 - Math.pow(Math.abs(y) / (D / 2), 2));
    p.setZ(i, -sag * 0.32 + Math.sin(x * 3.1) * 0.02);
  }
  geo.computeVertexNormals();
  // 布面：前沿（+z）2.45 m 高，后沿 1.75 m
  const tilt = Math.atan2(2.45 - 1.75, D);
  part(geo, cloth, [0, 2.1, 0], [-Math.PI / 2 + tilt, 0, 0], [1, 1, 1], g);
  // 前沿三角垂边
  const flap = new THREE.BufferGeometry();
  const fp = [];
  for (let i = 0; i < 9; i++) { const x0 = -W / 2 + i * W / 9, x1 = x0 + W / 9; fp.push(x0, 0, 0, x1, 0, 0, (x0 + x1) / 2, -0.32, 0); }
  flap.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); flap.computeVertexNormals();
  part(flap, mat('#9c2621', { rough: 0.9 }), [0, 2.44, D / 2 - 0.04], [0, 0, 0], [1, 1, 1], g).material.side = THREE.DoubleSide;
  for (const [x, z, h] of [[-W / 2 + 0.15, D / 2 - 0.1, 2.6], [W / 2 - 0.15, D / 2 - 0.1, 2.6], [-W / 2 + 0.15, -D / 2 + 0.1, 1.9], [W / 2 - 0.15, -D / 2 + 0.1, 1.9]]) {
    part(cyl(0.07, 0.09, h, 8), post, [x, h / 2, z], [0, 0, 0], [1, 1, 1], g);
    part(cyl(0.012, 0.012, 1.5, 4), mat('#d9c08a'), [x * 1.18, h * 0.62, z + Math.sign(z) * 0.5], [Math.sign(z) * 0.75, 0, -Math.sign(x) * 0.45], [1, 1, 1], g);
  }
  // 棚下：铺盖卷、小木箱、挂着的油灯
  buildCot(g, { x: 0, front: 0.35, len: 1.7 });
  part(cyl(0.2, 0.2, 1.3, 12), mat('#8a6e4e'), [-1.2, 0.2, -1.0], [0, 0, Math.PI / 2], [1, 1, 1], g);
  part(roundedBox(0.7, 0.5, 0.5, 0.04), woodMat('#9c6a3c'), [1.1, 0.25, -0.9], [0, -0.2, 0], [1, 1, 1], g);
  part(roundedBox(0.18, 0.24, 0.18, 0.04), mat('#ffd98a', { emissive: '#ffb347', ei: 1.6 }), [0.2, 1.85, 0.6], [0, 0, 0], [1, 1, 1], g);
  return g;
}
export function buildCrate() {
  const g = new THREE.Group();
  part(roundedBox(0.8, 0.6, 0.6, 0.05), woodMat('#b07c44'), [0, 0.3, 0], [0, 0, 0], [1, 1, 1], g);
  for (const y of [0.12, 0.48]) part(roundedBox(0.84, 0.06, 0.64, 0.02), woodMat('#6f4a2a'), [0, y, 0], [0, 0, 0], [1, 1, 1], g);
  return g;
}
export function buildBarrel() {
  const g = new THREE.Group();
  const lathe = new THREE.LatheGeometry([0, 0.28, 0.33, 0.36, 0.33, 0.28, 0].map((r, i) => new THREE.Vector2(r || 0.001, i * 0.13)), 16);
  part(lathe, mat('#9c6a3c'), [0, 0, 0], [0, 0, 0], [1, 1, 1], g);
  for (const y of [0.14, 0.64]) part(new THREE.TorusGeometry(0.34, 0.02, 6, 20), mat('#c7923e', { rough: 0.4, metal: 0.6 }), [0, y, 0], [Math.PI / 2, 0, 0], [1, 1, 1], g);
  return g;
}

// ───────────────────────── 潮汐神龛 / 图腾 / 宝箱 ─────────────────────────
export function buildShrine() {
  const g = new THREE.Group();
  const stone = mat('#a9a493', { rough: 0.95 }), moss = mat('#5a9a52');
  part(cyl(1.3, 1.5, 0.35, 8), stone, [0, 0.17, 0], [0, Math.PI / 8, 0], [1, 1, 1], g);
  part(cyl(1.0, 1.1, 0.25, 8), stone, [0, 0.47, 0], [0, Math.PI / 8, 0], [1, 1, 1], g);
  for (const sx of [-1, 1]) {
    part(roundedBox(0.4, 2.0, 0.4, 0.08), stone, [sx * 0.75, 1.5, 0], [0, 0, 0], [1, 1, 1], g);
    part(sph(0.28, 10, 8), moss, [sx * 0.75, 2.5, 0], [0, 0, 0], [1.2, 0.4, 1.2], g);
  }
  part(roundedBox(2.0, 0.3, 0.5, 0.08), stone, [0, 2.6, 0], [0, 0, 0], [1, 1, 1], g);
  // 潮汐符号：原创的“水滴 + 两道弧”
  const orb = part(sph(0.3, 20, 14), mat('#6de7e2', { emissive: '#3fd7d2', ei: 1.4, rough: 0.2 }), [0, 1.5, 0], [0, 0, 0], [1, 1.25, 1], g);
  const ring = part(new THREE.TorusGeometry(0.5, 0.04, 8, 32), mat('#c7923e', { rough: 0.35, metal: 0.6 }), [0, 1.5, 0], [0, 0, 0], [1, 1, 1], g);
  const light = new THREE.PointLight('#6de7e2', 3, 5, 2); light.position.y = 1.5; g.add(light);
  g.userData.parts = { orb, ring, light };
  return g;
}
export function buildTotem() {
  const g = new THREE.Group();
  const stone = mat('#a9a493', { rough: 0.95 });
  part(cyl(0.5, 0.6, 0.3, 8), stone, [0, 0.15, 0], [0, 0, 0], [1, 1, 1], g);
  part(roundedBox(0.45, 1.5, 0.45, 0.1), stone, [0, 1.0, 0], [0, 0.4, 0], [1, 1, 1], g);
  const orb = part(sph(0.2, 16, 12), mat('#6de7e2', { emissive: '#3fd7d2', ei: 1.4, rough: 0.2 }), [0, 2.0, 0], [0, 0, 0], [1, 1.25, 1], g);
  g.userData.parts = { orb };
  return g;
}
export function buildChest() {
  const g = new THREE.Group();
  const wood = mat('#8a5a34'), brass = mat('#c7923e', { rough: 0.35, metal: 0.65 });
  part(roundedBox(1.1, 0.6, 0.7, 0.06), wood, [0, 0.3, 0], [0, 0, 0], [1, 1, 1], g);
  const lid = new THREE.Group(); lid.position.set(0, 0.6, -0.35); g.add(lid);
  part(new THREE.CylinderGeometry(0.35, 0.35, 1.1, 16, 1, false, 0, Math.PI), wood, [0, 0, 0.35], [0, 0, Math.PI / 2], [1, 1, 1], lid);
  for (const x of [-0.4, 0.4]) {
    part(roundedBox(0.1, 0.62, 0.74, 0.02), brass, [x, 0.3, 0], [0, 0, 0], [1, 1, 1], g);
    part(new THREE.CylinderGeometry(0.37, 0.37, 0.1, 16, 1, false, 0, Math.PI), brass, [x, 0, 0.35], [0, 0, Math.PI / 2], [1, 1, 1], lid);
  }
  part(new THREE.TorusGeometry(0.09, 0.03, 8, 16), brass, [0, 0.45, 0.37], [0, 0, 0], [1, 1, 1], g);
  const glow = new THREE.PointLight('#6de7e2', 0, 4, 2); glow.position.set(0, 1, 0); g.add(glow);
  g.userData.parts = { lid, glow };
  return g;
}
// 罗盘碎片：黄铜圆环 + 青色内发光（任务物品 = 黄铜环；魔法 = 青光）
export function buildShard() {
  const g = new THREE.Group();
  part(new THREE.TorusGeometry(0.28, 0.06, 10, 28, Math.PI * 1.3), mat('#c7923e', { rough: 0.3, metal: 0.7 }), [0, 0, 0], [0, 0, 0], [1, 1, 1], g);
  part(new THREE.OctahedronGeometry(0.16, 0), mat('#6de7e2', { emissive: '#3fd7d2', ei: 2 }), [0, 0, 0], [0, 0, 0], [1, 1.4, 0.5], g);
  return g;
}

// 帆布：米白底 + 棕色旋涡纹 + 补丁 + 缝线
let _sailTex = null;
function sailTexture() {
  if (_sailTex) return _sailTex;
  _sailTex = canvasTex(256, 256, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#e6dccb');
    x.fillStyle = gr; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(120,90,60,0.25)'; x.lineWidth = 1.5;
    for (let i = 1; i < 5; i++) { x.beginPath(); x.moveTo(0, i * h / 5); x.lineTo(w, i * h / 5 + 4); x.stroke(); }
    x.fillStyle = 'rgba(150,110,70,0.18)'; x.fillRect(w * 0.68, h * 0.08, w * 0.22, h * 0.18);
    x.save(); x.translate(w / 2, h * 0.5); x.strokeStyle = '#6b3f22'; x.lineCap = 'round';
    x.lineWidth = 11; x.beginPath();
    for (let t = 0; t < 4.2 * Math.PI; t += 0.1) { const r = 6 + t * 5.2; const px = Math.cos(t) * r, py = Math.sin(t) * r; t === 0 ? x.moveTo(px, py) : x.lineTo(px, py); }
    x.stroke();
    x.lineWidth = 6; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; x.beginPath(); x.moveTo(Math.cos(a) * 82, Math.sin(a) * 82); x.lineTo(Math.cos(a) * 100, Math.sin(a) * 100); x.stroke(); }
    x.restore();
  });
  return _sailTex;
}
// 破帆的透明遮罩：几个撕开的破洞 + 下沿撕成一条条的布
let _tornAlpha = null;
function tornAlpha() {
  if (_tornAlpha) return _tornAlpha;
  _tornAlpha = canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#000';
    let s = 11; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (const [cx, cy, rr] of [[30, 40, 11], [92, 70, 9], [60, 96, 7]]) {
      x.beginPath(); for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, q = rr * (0.6 + r() * 0.7); x.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q * 1.4); } x.fill();
    }
    x.beginPath(); x.moveTo(0, h);
    for (let i = 0; i <= 16; i++) x.lineTo(i * w / 16, h - 6 - (i % 2 ? r() * 26 : r() * 6));
    x.lineTo(w, h); x.fill();
  });
  _tornAlpha.colorSpace = THREE.NoColorSpace;
  return _tornAlpha;
}
// ───────────────────────── 船：补丁小艇，三个修复阶段 ─────────────────────────
export function buildBoat() {
  const root = new THREE.Group();
  const hull = new THREE.Group(); root.add(hull);
  const plank = mat('#8f6038', { rough: 0.85 }), plankDark = mat('#6f4629'), plankLight = mat('#b07c4a');
  // 船壳：用放样的截面环拼出圆润船体（长 5.2 m，沿 z 轴）
  const rings = 14, around = 16, pos = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, z = (t - 0.5) * 5.2;
    const bow = t > 0.7 ? Math.pow((t - 0.7) / 0.3, 1.6) : 0, stern = t < 0.12 ? (0.12 - t) / 0.12 * 0.35 : 0;
    const w = 1.05 * (1 - bow * 0.95) * (1 - stern), d = 0.75 * (1 - bow * 0.5);
    const sheer = 0.1 + bow * 0.45 + stern * 0.6;
    for (let j = 0; j <= around; j++) {
      const a = Math.PI * (j / around); // 半圆截面：左舷沿 → 龙骨 → 右舷沿
      pos.push(Math.cos(a) * w, -Math.sin(a) * d + sheer * (1 - Math.sin(a)), z);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < around; j++) {
    const a = i * (around + 1) + j, b = a + around + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hg.setIndex(idx); hg.computeVertexNormals();
  const shell = part(hg, plank, [0, 0.55, 0], [0, 0, 0], [1, 1, 1], hull); shell.material.side = THREE.DoubleSide;
  // 船板纹：几条深色腰线
  for (const y of [0.35, 0.05, -0.12]) part(roundedBox(2.12 * (1 - Math.abs(y) * 0.5), 0.05, 4.2, 0.02), plankDark, [0, 0.55 + y, -0.2], [0, 0, 0], [1, 1, 1], hull);
  part(roundedBox(1.7, 0.08, 3.6, 0.03), plankLight, [0, 0.35, -0.2], [0, 0, 0], [1, 1, 1], hull); // 甲板
  part(roundedBox(0.12, 0.1, 5.0, 0.03), plankDark, [1.03, 0.67, 0], [0, 0, 0], [1, 1, 1], hull);
  part(roundedBox(0.12, 0.1, 5.0, 0.03), plankDark, [-1.03, 0.67, 0], [0, 0, 0], [1, 1, 1], hull);
  part(roundedBox(1.0, 0.3, 0.12, 0.04), plankDark, [0, 0.6, 2.0], [0.2, 0, 0], [1, 1, 1], hull);
  // 破洞（第一阶段修补后隐藏）
  const hole = new THREE.Group(); hull.add(hole);
  part(sph(0.35, 12, 8), mat('#2a1a10', { rough: 1 }), [1.0, 0.45, 0.3], [0, 0, 0], [0.2, 0.8, 1.3], hole);
  for (let i = 0; i < 4; i++) part(roundedBox(0.3, 0.06, 0.08, 0.01), plankLight, [1.08, 0.5 + (i - 1.5) * 0.18, 0.3 + (i % 2) * 0.3 - 0.15], [0, 0, 0.3 * (i - 1.5)], [1, 1, 1], hole);
  // 补丁木板（第一阶段）
  const patches = new THREE.Group(); patches.visible = false; hull.add(patches);
  for (const [z, y] of [[0.1, 0.5], [0.55, 0.42], [-1.2, 0.5], [1.4, 0.35]])
    part(roundedBox(0.08, 0.28, 0.75, 0.03), plankLight, [1.07, y, z], [0, 0, -0.18], [1, 1, 1], patches);
  for (const [z, y] of [[0.8, 0.45], [-0.5, 0.4]])
    part(roundedBox(0.08, 0.28, 0.75, 0.03), plankLight, [-1.07, y, z], [0, 0, 0.18], [1, 1, 1], patches);
  // 桅帆：修好之前是破帆（帆面有破洞、下沿撕成布条，松垮地挂着），第二阶段换成补好的新帆
  const sailGeoOf = (w, h, belly) => {
    const g = new THREE.PlaneGeometry(w, h, 10, 10), sp = g.attributes.position;
    for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), y = sp.getY(i); sp.setZ(i, belly * Math.cos(x / (w / 2) * Math.PI / 2) * (0.6 + 0.4 * Math.cos(y / (h / 2) * Math.PI / 2))); }
    g.computeVertexNormals(); return g;
  };
  const mastParts = (grp) => {
    part(cyl(0.09, 0.12, 5.4, 10), plankDark, [0, 3.0, 0.3], [0, 0, 0], [1, 1, 1], grp);
    part(cyl(0.055, 0.055, 3.4, 8), plankDark, [0, 5.05, 0.3], [0, 1.2, Math.PI / 2], [1, 1, 1], grp);   // 帆斜着张开（侧面也看得见帆面）
    part(sph(0.13, 10, 8), plankLight, [0, 5.75, 0.3], [0, 0, 0], [1, 1, 1], grp);
    for (const [a, b] of [[[0, 5.6, 0.3], [0, 0.8, 2.45]], [[0, 5.6, 0.3], [0, 0.8, -2.4]], [[0, 5.6, 0.3], [0.95, 0.72, 0.3]], [[0, 5.6, 0.3], [-0.95, 0.72, 0.3]]]) {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), mid = A.clone().add(B).multiplyScalar(0.5);
      const r = part(cyl(0.012, 0.012, A.distanceTo(B), 4), mat('#d9c08a'), mid.toArray(), [0, 0, 0], [1, 1, 1], grp);
      r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    }
  };
  const brokenMast = new THREE.Group(); hull.add(brokenMast);
  mastParts(brokenMast);
  const tornGeo = sailGeoOf(3.1, 3.3, 0.16);
  { const tp = tornGeo.attributes.position; for (let i = 0; i < tp.count; i++) { const x = tp.getX(i), y = tp.getY(i); if (y < -1.2) tp.setZ(i, tp.getZ(i) + Math.sin(x * 5) * 0.12); } tornGeo.computeVertexNormals(); }
  part(tornGeo, new THREE.MeshStandardMaterial({ color: '#e2d4b6', roughness: 0.95, map: sailTexture(), alphaMap: tornAlpha(), alphaTest: 0.5, side: THREE.DoubleSide }), [0, 3.3, 0.3], [0, 1.2, 0.04], [1, 1, 1], brokenMast);
  const rig = new THREE.Group(); rig.visible = false; hull.add(rig);
  mastParts(rig);
  const sail = part(sailGeoOf(3.2, 3.5, 0.5), new THREE.MeshStandardMaterial({ color: '#f3e6cc', roughness: 0.9, map: sailTexture(), side: THREE.DoubleSide }), [0, 3.25, 0.3], [0, 1.2, 0], [1, 1, 1], rig);
  // 船首像 + 罗盘台（第三阶段）
  const compass = new THREE.Group(); compass.visible = false; hull.add(compass);
  part(cyl(0.12, 0.16, 0.7, 10), plankDark, [0, 0.7, -1.3], [0, 0, 0], [1, 1, 1], compass);
  part(cyl(0.28, 0.28, 0.1, 20), mat('#c7923e', { rough: 0.3, metal: 0.7 }), [0, 1.08, -1.3], [0, 0, 0], [1, 1, 1], compass);
  const needle = part(new THREE.OctahedronGeometry(0.12, 0), mat('#6de7e2', { emissive: '#3fd7d2', ei: 2 }), [0, 1.2, -1.3], [0, 0, 0], [0.6, 0.6, 2], compass);
  // 舵
  part(roundedBox(0.1, 0.9, 0.5, 0.03), plankDark, [0, 0.35, -2.55], [0, 0, 0], [1, 1, 1], hull);
  root.userData.parts = { hull, hole, patches, brokenMast, rig, sail, compass, needle };
  return root;
}

export function buildDock(len = 16) {
  const g = new THREE.Group();
  const tops = [woodMat('#b27c45'), woodMat('#9f6b3a'), woodMat('#bf8a52')], post = woodMat('#5e3d24', 0.9);
  const n = Math.round(len / 0.8);
  for (let i = 0; i < n; i++)
    part(roundedBox(2.1 + (i % 3 === 1 ? 0.12 : 0), 0.12, 0.72, 0.03), tops[(i * 7) % 3], [(i % 2 ? 0.04 : -0.04), 0, i * 0.8], [0, (i % 4 - 1.5) * 0.02, (i % 2 ? 1 : -1) * 0.015], [1, 1, 1], g);
  // 两侧纵梁
  for (const x of [-1.0, 1.0]) part(roundedBox(0.16, 0.18, len, 0.04), post, [x, -0.14, len / 2 - 0.4], [0, 0, 0], [1, 1, 1], g);
  // 高出桥面的粗木桩 + 桩间垂绳
  const rope = mat('#d9c08a', { rough: 0.9 });
  for (let i = 0; i * 2.6 < len; i++) for (const x of [-1.05, 1.05]) {
    const z = i * 2.6 + 0.2, tall = i % 2 === 0;
    part(cyl(0.15, 0.17, tall ? 5.2 : 4.4, 10), post, [x, tall ? -1.5 : -1.9, z], [0, 0, 0], [1, 1, 1], g);
    if (tall) part(cyl(0.16, 0.16, 0.04, 10), mat('#8a6a4a'), [x, 1.1, z], [0, 0, 0], [1, 1, 1], g);
    if (tall && (i + 2) * 2.6 < len) {
      const sag = new THREE.CatmullRomCurve3([new THREE.Vector3(x, 0.95, z), new THREE.Vector3(x, 0.55, z + 2.6), new THREE.Vector3(x, 0.95, z + 5.2)]);
      part(new THREE.TubeGeometry(sag, 10, 0.025, 4), rope, [0, 0, 0], [0, 0, 0], [1, 1, 1], g);
    }
  }
  for (const x of [-1.0, 1.0]) part(cap(0.14, 0.05), post, [x, 0.35, (n - 1) * 0.8], [0, 0, 0], [1, 1, 1], g);
  return g;
}

// 远景海蚀柱上的草帽
export function buildStackCap(r) {
  const g = new THREE.Group();
  part(sph(r * 0.55, 16, 10), mat('#4f9a55'), [0, 0, 0], [0, 0, 0], [1, 0.3, 1], g);
  return g;
}

// 可选：一只只在白天沙滩上溜达的小装饰海鸥不做；远处漂流木桶做环境叙事
export function buildFloatingDebris(seed) {
  const g = new THREE.Group();
  if (seed % 2) g.add(buildBarrel()); else g.add(buildCrate());
  g.rotation.set(0.3, seed, 0.2);
  return g;
}

// ───────────────────────── 主角脚下的光标圆环 ─────────────────────────
// 平贴地面的 HUD：单圈光环 + 朝向箭头 + 体力弧。不受光照，始终清晰。
export function buildPlayerRing() {
  const root = new THREE.Group();
  const flat = (geo) => geo.rotateX(-Math.PI / 2);
  const basic = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  const add = (geo, m, parent = root) => { const mesh = new THREE.Mesh(flat(geo), m); mesh.renderOrder = 3; parent.add(mesh); return mesh; };

  const innerMat = basic('#fff6e0', 0.85);
  const inner = add(new THREE.RingGeometry(0.62, 0.7, 48), innerMat);
  // 朝向箭头（+z 为前方）
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, 0.24); arrowShape.lineTo(0.17, 0); arrowShape.lineTo(0, 0.07); arrowShape.lineTo(-0.17, 0);
  const arrowGeo = new THREE.ShapeGeometry(arrowShape);
  arrowGeo.rotateX(Math.PI / 2); arrowGeo.translate(0, 0, 0.96); // 平放，尖端指向 +z
  const arrowMat = basic('#e85d4a', 0.95);
  const arrow = new THREE.Mesh(arrowGeo, arrowMat); arrow.renderOrder = 3; root.add(arrow);
  // 体力弧：只在体力不满时出现
  const stamMat = basic('#f0b43a', 0.95);
  const stamina = new THREE.Mesh(new THREE.BufferGeometry(), stamMat); stamina.renderOrder = 3; root.add(stamina);
  const stamBack = add(new THREE.RingGeometry(0.72, 0.8, 48), basic('#2b2118', 0.25));
  root.userData.parts = { inner, innerMat, arrow, arrowMat, stamina, stamMat, stamBack, stamLast: -1 };
  return root;
}
export function setRingStamina(ring, v) {
  const P = ring.userData.parts;
  const q = Math.round(v * 60) / 60;
  if (q === P.stamLast) return;
  P.stamLast = q;
  P.stamina.geometry.dispose();
  P.stamina.geometry = q > 0.001 ? new THREE.RingGeometry(0.72, 0.8, 48, 1, -Math.PI / 2, q * Math.PI * 2).rotateX(-Math.PI / 2) : new THREE.BufferGeometry();
}

// ───────────────────────── 丰富场景用的小件 ─────────────────────────
export function buildRoundTree(seed = 0) {
  const g = new THREE.Group();
  const h = 2.2 + (seed % 3) * 0.4;
  part(cyl(0.2, 0.32, h, 10), mat('#7a5230', { rough: 0.95 }), [0, h / 2, 0], [0, 0, (seed % 2 ? 0.06 : -0.05)], [1, 1, 1], g);
  part(cyl(0.08, 0.1, 0.9, 6), mat('#7a5230'), [0.3, h * 0.7, 0], [0, 0, -0.9], [1, 1, 1], g);
  const greens = ['#3f8a4a', '#4f9a55', '#5fae5c', '#468f4f'];
  const crown = new THREE.Group(); crown.position.y = h + 0.6; g.add(crown);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1 + seed, r = i === 0 ? 0 : 0.75;
    part(sph(1.0 - (i ? 0.25 : 0), 18, 12), mat(greens[(i + seed) % 4], { rough: 0.85 }),
      [Math.cos(a) * r, (i ? -0.1 : 0.35) + (i % 2) * 0.3, Math.sin(a) * r], [a, a, 0], [1, 0.85, 1], crown);
  }
  g.userData.parts = { crown };
  return g;
}
export function buildFern(seed = 0) {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++)
    part(FROND, mat(i % 2 ? '#3f8a4a' : '#57a458', { rough: 0.8 }), [0, 0.05, 0], [-0.5 - (i % 3) * 0.15, i * 1.05 + seed, 0], [0.32, 0.4, 0.38], g).material.side = THREE.DoubleSide;
  return g;
}
export function buildMushrooms(seed = 0) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const s = 0.7 + (i === 0 ? 0.5 : 0), a = i * 2.2 + seed, x = Math.cos(a) * 0.2 * i, z = Math.sin(a) * 0.2 * i;
    part(cyl(0.05 * s, 0.07 * s, 0.22 * s, 8), mat('#f3e6cf'), [x, 0.11 * s, z], [0, 0, 0], [1, 1, 1], g);
    const capM = part(new THREE.SphereGeometry(0.16 * s, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#e85d4a', { rough: 0.6 }), [x, 0.2 * s, z], [0, 0, 0], [1, 0.8, 1], g);
    for (let k = 0; k < 3; k++) part(sph(0.025 * s, 6, 5), mat('#fff6e0'), [Math.cos(k * 2.1) * 0.08 * s, 0.1 * s, Math.sin(k * 2.1) * 0.08 * s], [0, 0, 0], [1, 0.5, 1], capM);
  }
  return g;
}
export function buildFlowerBush(seed = 0) {
  const g = buildBush(seed);
  const petal = ['#e85d4a', '#f39ac0', '#f2c14e'][seed % 3];
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + seed, y = 0.45 + (i % 3) * 0.18;
    const f = part(sph(0.09, 8, 6), mat(petal, { rough: 0.6 }), [Math.cos(a) * 0.5, y, Math.sin(a) * 0.45], [0, 0, 0], [1, 0.6, 1], g);
    part(sph(0.035, 6, 5), mat('#fff3b0'), [0, 0.05, 0], [0, 0, 0], [1, 1, 1], f);
  }
  return g;
}
export function buildLantern() {
  const g = new THREE.Group();
  part(cyl(0.06, 0.08, 1.8, 8), mat('#6f4629'), [0, 0.9, 0], [0, 0, 0], [1, 1, 1], g);
  part(cyl(0.04, 0.04, 0.5, 6), mat('#6f4629'), [0.2, 1.75, 0], [0, 0, Math.PI / 2], [1, 1, 1], g);
  const lamp = part(roundedBox(0.24, 0.3, 0.24, 0.05), mat('#ffd98a', { emissive: '#ffb347', ei: 0 }), [0.42, 1.52, 0], [0, 0, 0], [1, 1, 1], g);
  part(new THREE.ConeGeometry(0.2, 0.14, 4), mat('#3b3a45'), [0.42, 1.74, 0], [0, Math.PI / 4, 0], [1, 1, 1], g);
  g.userData.parts = { lamp };
  return g;
}
export function buildFence(len = 3) {
  const g = new THREE.Group();
  const n = Math.max(2, Math.round(len / 1.2) + 1);
  for (let i = 0; i < n; i++) part(cyl(0.06, 0.07, 0.8, 7), mat('#8a5a34'), [0, 0.4, (i / (n - 1) - 0.5) * len], [0, 0, (i % 2 ? 0.05 : -0.04)], [1, 1, 1], g);
  for (const y of [0.55, 0.3]) part(cyl(0.02, 0.02, len, 5), mat('#d9c08a'), [0, y, 0], [Math.PI / 2, 0, 0], [1, 1, 1], g);
  return g;
}
export function buildStarfish(seed = 0) {
  const g = new THREE.Group();
  const c = ['#e85d4a', '#f2994a', '#f39ac0'][seed % 3];
  for (let i = 0; i < 5; i++) part(new THREE.ConeGeometry(0.06, 0.2, 6), mat(c, { rough: 0.7 }), [Math.cos(i * 1.2566) * 0.09, 0.03, Math.sin(i * 1.2566) * 0.09], [Math.PI / 2, 0, -Math.PI / 2 + i * 1.2566], [1, 1, 0.45], g).rotation.order = 'YXZ';
  part(sph(0.06, 8, 6), mat(c), [0, 0.03, 0], [0, 0, 0], [1, 0.45, 1], g);
  return g;
}
export function buildSign(text = '') {
  const g = new THREE.Group();
  part(cyl(0.06, 0.07, 1.3, 7), mat('#6f4629'), [0, 0.65, 0], [0, 0, 0], [1, 1, 1], g);
  part(roundedBox(0.9, 0.36, 0.07, 0.03), mat('#b07c4a'), [0.2, 1.15, 0], [0, 0, -0.06], [1, 1, 1], g);
  part(new THREE.ConeGeometry(0.1, 0.18, 3), mat('#237a78'), [0.72, 1.15, 0.05], [0, 0, -Math.PI / 2], [1, 1, 0.3], g);
  return g;
}
// 半埋在沙里的大沉船：侧倒的船身 + 露出的肋骨 + 断桅
export function buildShipwreck() {
  const g = new THREE.Group();
  const wood = mat('#6f4629', { rough: 0.9 }), dark = mat('#4e3120', { rough: 0.95 }), light = mat('#9c6a3c');
  for (let i = 0; i < 9; i++) {
    const z = (i - 4) * 0.9, r = 2.3 - Math.abs(i - 4) * 0.18;
    const rib = part(new THREE.TorusGeometry(r, 0.13, 6, 16, Math.PI * (i % 3 === 0 ? 0.55 : 0.8)), i % 2 ? wood : dark, [0, 0, z], [0, 0, Math.PI * 1.05], [1, 1.2, 1], g);
    rib.rotation.z = Math.PI + 0.25;
  }
  for (let k = 0; k < 4; k++) part(roundedBox(0.3, 0.12, 7.5 - k * 0.8, 0.04), k % 2 ? light : wood, [-1.9 + k * 0.28, 1.0 + k * 0.5, -0.3], [0, 0, 0.9 - k * 0.2], [1, 1, 1], g);
  part(roundedBox(0.3, 0.1, 8.2, 0.04), dark, [0, -0.2, 0], [0, 0, 0], [1, 1, 1], g);
  part(cyl(0.16, 0.2, 5.5, 10), wood, [2.6, 0.7, 1.4], [0.2, 0, 1.25], [1, 1, 1], g);
  part(roundedBox(1.6, 1.2, 0.08, 0.02), mat('#e6d3a8', { rough: 0.95 }), [4.2, 0.4, 1.8], [0.3, 0.4, 1.1], [1, 1, 1], g);
  const box = buildCrate(); box.position.set(-1.2, -0.1, 2.6); box.rotation.set(0.2, 0.6, 0.15); g.add(box);
  const bar = buildBarrel(); bar.position.set(1.4, -0.1, -3.2); bar.rotation.set(1.3, 0.3, 0); g.add(bar);
  return g;
}

// ───────────────────────── 海鸥 / 鱼 / 钓具 ─────────────────────────
export function buildGull() {
  const root = new THREE.Group();
  const white = mat('#fbfbf6', { rough: 0.7 }), grey = mat('#b9c0c4', { rough: 0.7 }), black = mat('#2b2b2b');
  part(sph(0.18, 12, 10), white, [0, 0, 0], [0, 0, 0], [0.8, 0.75, 1.7], root);
  part(sph(0.12, 10, 8), white, [0, 0.08, 0.3], [0, 0, 0], [1, 1, 1], root);
  part(new THREE.ConeGeometry(0.035, 0.14, 6), mat('#f2c14e'), [0, 0.06, 0.46], [Math.PI / 2, 0, 0], [1, 1, 1], root);
  part(new THREE.ConeGeometry(0.1, 0.22, 6), white, [0, 0.02, -0.36], [-Math.PI / 2, 0, 0], [1, 0.4, 1], root);
  const wings = [];
  for (const sx of [-1, 1]) {
    const inner = new THREE.Group(); inner.position.set(sx * 0.1, 0.05, 0.05); root.add(inner);
    part(roundedBox(0.5, 0.03, 0.26, 0.012), grey, [sx * 0.25, 0, 0], [0, 0, 0], [1, 1, 1], inner);
    const outer = new THREE.Group(); outer.position.set(sx * 0.5, 0, 0); inner.add(outer);
    part(roundedBox(0.46, 0.025, 0.2, 0.01), grey, [sx * 0.22, 0, -0.03], [0, sx * 0.25, 0], [1, 1, 1], outer);
    part(roundedBox(0.14, 0.027, 0.16, 0.01), black, [sx * 0.4, 0, -0.08], [0, sx * 0.25, 0], [1, 1, 1], outer);
    wings.push({ inner, outer, sx });
  }
  root.userData.parts = { wings };
  return root;
}
export function buildFish(color = '#f2994a') {
  const g = new THREE.Group();
  part(sph(0.14, 12, 8), mat(color, { rough: 0.5 }), [0, 0, 0], [0, 0, 0], [0.55, 0.9, 1.4], g);
  part(new THREE.ConeGeometry(0.12, 0.18, 4), mat(color, { rough: 0.5 }), [0, 0, -0.24], [-Math.PI / 2, 0, 0], [0.3, 1, 1.2], g);
  for (const sx of [-1, 1]) part(sph(0.03, 6, 5), mat('#1d1a1f'), [sx * 0.07, 0.04, 0.12], [0, 0, 0], [1, 1, 1], g);
  return g;
}
export function buildRod() {
  const g = new THREE.Group();
  part(cyl(0.018, 0.028, 1.5, 6), mat('#b07c4a'), [0, 0, 0.7], [Math.PI / 2, 0, 0], [1, 1, 1], g);
  part(new THREE.TorusGeometry(0.05, 0.015, 6, 12), mat('#237a78'), [0.04, 0, 0.12], [0, Math.PI / 2, 0], [1, 1, 1], g);
  const tip = new THREE.Object3D(); tip.position.set(0, 0, 1.45); g.add(tip);
  g.userData.parts = { tip };
  return g;
}
export function buildBobber() {
  const g = new THREE.Group();
  part(sph(0.1, 12, 8), mat('#e85d4a', { rough: 0.4 }), [0, 0.05, 0], [0, 0, 0], [1, 1, 1], g);
  part(new THREE.SphereGeometry(0.101, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat('#ffffff', { rough: 0.4 }), [0, 0.05, 0], [0, 0, 0], [1, 1, 1], g);
  part(cyl(0.012, 0.012, 0.14, 5), mat('#2b2118'), [0, 0.2, 0], [0, 0, 0], [1, 1, 1], g);
  return g;
}
// 玩家自己搭的小帐篷：青绿布 + 补丁 + 小旗
export function buildPlayerTent(ghost = false) {
  const g = new THREE.Group();
  const cloth = new THREE.Shape();
  cloth.moveTo(-1.2, 0); cloth.lineTo(0, 1.45); cloth.lineTo(1.2, 0); cloth.lineTo(1.08, 0); cloth.lineTo(0, 1.32); cloth.lineTo(-1.08, 0);
  const geo = new THREE.ExtrudeGeometry(cloth, { depth: 1.9, bevelEnabled: false }); geo.translate(0, 0, -0.95);
  const clothMat = ghost ? new THREE.MeshBasicMaterial({ color: '#6de7e2', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }) : mat('#2f8f8a', { rough: 0.9 });
  const c = part(geo, clothMat, [0, 0, 0], [0, 0, 0], [1, 1, 1], g); if (!ghost) c.material.side = THREE.DoubleSide;
  if (!ghost) {
    part(roundedBox(0.4, 0.35, 0.03, 0.01), mat('#e6d3a8'), [0.55, 0.7, 0.5], [0, 0, -0.88], [1, 1, 1], g);
    for (const z of [-1.0, 1.0]) part(cyl(0.04, 0.05, 1.6, 7), mat('#7a5230'), [0, 0.8, z], [0, 0, 0], [1, 1, 1], g);
    part(roundedBox(0.3, 0.18, 0.02, 0.01), mat('#e85d4a'), [0.17, 1.55, 1.0], [0, 0, 0], [1, 1, 1], g);
    part(cyl(0.02, 0.02, 0.5, 5), mat('#7a5230'), [0, 1.55, 1.0], [0, 0, 0], [1, 1, 1], g);
    buildCot(g, { x: 0, front: 0.35, len: 1.25, w: 0.8 });
  }
  g.userData.parts = { clothMat };
  return g;
}
// 营火上的烤串（烹饪中显示）
export function buildSkewer(kind) {
  const g = new THREE.Group();
  part(cyl(0.015, 0.015, 1.1, 5), mat('#8a5a34'), [0, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1], g);
  const food = new THREE.Group(); g.add(food);
  if (kind === 'grilledFish' || kind === 'soup') { const f = buildFish('#e0a070'); f.rotation.y = Math.PI / 2; f.scale.setScalar(1.3); food.add(f); }
  else if (kind === 'grilledClaw') part(new THREE.ConeGeometry(0.12, 0.35, 8), mat('#d9432f'), [0, 0, 0], [0, 0, Math.PI / 2], [1, 1, 0.7], food);
  else for (let i = -1; i <= 1; i++) part(roundedBox(0.14, 0.14, 0.14, 0.04), mat('#f3ead6'), [i * 0.2, 0, 0], [0.3, i, 0], [1, 1, 1], food);
  g.userData.parts = { food };
  return g;
}
// 汗滴：可爱的水滴形
export const SWEAT_GEO = (() => {
  const g = new THREE.SphereGeometry(0.06, 10, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0) { const k = y / 0.06; p.setX(i, p.getX(i) * (1 - k * 0.85)); p.setZ(i, p.getZ(i) * (1 - k * 0.85)); p.setY(i, y * 1.8); } }
  g.computeVertexNormals();
  return g;
})();
export const sweatMat = new THREE.MeshStandardMaterial({ color: '#8fd8ff', roughness: 0.15, emissive: '#3aa0d8', emissiveIntensity: 0.3 });

// 滑翔翼：拱形布翼（青绿 + 珊瑚条纹补丁）+ 两根木握杆 + 吊绳
export function buildGlider() {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(2.8, 1.7, 16, 6);   // 翼弦加宽，低机位从后面也看得到布面
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, p.getY(i)); p.setY(i, 0.55 * Math.cos(x / 1.3 * Math.PI / 2) - Math.abs(x) * 0.05); }
  geo.computeVertexNormals();
  const cloth = part(geo, mat('#2f9f97', { rough: 0.8 }), [0, 0, 0], [0, 0, 0], [1, 1, 1], g); cloth.material.side = THREE.DoubleSide;
  for (const x of [-0.75, 0.75]) {
    const sg = new THREE.PlaneGeometry(0.28, 1.72, 1, 6); const sp = sg.attributes.position;
    for (let i = 0; i < sp.count; i++) { const lx = sp.getX(i) + x; sp.setZ(i, sp.getY(i)); sp.setY(i, 0.55 * Math.cos(lx / 1.3 * Math.PI / 2) - Math.abs(lx) * 0.05 + 0.012); sp.setX(i, lx); }
    sg.computeVertexNormals();
    part(sg, mat('#e85d4a', { rough: 0.8 }), [0, 0, 0], [0, 0, 0], [1, 1, 1], g).material.side = THREE.DoubleSide;
  }
  part(roundedBox(0.36, 0.02, 0.3, 0.01), mat('#f2c14e'), [0.35, 0.53, 0.1], [0, 0.3, 0], [1, 1, 1], g);
  for (const x of [-0.32, 0.32]) {
    part(cyl(0.025, 0.025, 1.0, 6), mat('#8a5a34'), [x, -0.35, 0], [0, 0, x > 0 ? -0.25 : 0.25], [1, 1, 1], g);
  }
  const lineMat = new THREE.LineBasicMaterial({ color: '#f5f0e0' });
  const pts = [];
  for (const [ax, bx] of [[-1.2, -0.45], [-0.6, -0.4], [0.6, 0.4], [1.2, 0.45]]) pts.push(new THREE.Vector3(ax, 0.55 * Math.cos(ax / 1.3 * Math.PI / 2) - Math.abs(ax) * 0.05, 0), new THREE.Vector3(bx, -0.8, 0));
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  return g;
}

// ───────────────────────── 耕种 ─────────────────────────
// 一块田：深色土垄（湿了更深）
export function buildPlot() {
  const g = new THREE.Group();
  const soil = uniqueMat('#7a5436', { rough: 1 });
  part(roundedBox(1.25, 0.14, 1.25, 0.06), soil, [0, 0.03, 0], [0, 0, 0], [1, 1, 1], g);
  for (const x of [-0.3, 0.3]) part(roundedBox(0.34, 0.1, 1.15, 0.05), soil, [x, 0.12, 0], [0, 0, 0], [1, 1, 1], g);
  g.userData.soil = soil;
  return g;
}
// 作物四个阶段：0 种子/小土包，1 发芽，2 长大，3 成熟
export function buildCrop(kind, stage) {
  const g = new THREE.Group();
  const leaf = mat('#5aa84e', { rough: 0.8 }), leafD = mat('#3f8a3f', { rough: 0.8 });
  const sprout = (s, n = 2) => { for (let i = 0; i < n; i++) part(new THREE.SphereGeometry(0.08 * s, 8, 6), i % 2 ? leaf : leafD, [Math.cos(i * 2.4) * 0.07 * s, 0.14 * s, Math.sin(i * 2.4) * 0.07 * s], [0, i, 0.4], [1.5, 0.35, 0.8], g); part(new THREE.CylinderGeometry(0.012 * s, 0.015 * s, 0.14 * s, 5), leafD, [0, 0.07 * s, 0], [0, 0, 0], [1, 1, 1], g); };
  if (stage === 0) { part(new THREE.SphereGeometry(0.06, 6, 5), mat('#c8a060'), [0, 0.18, 0], [0, 0, 0], [1, 0.6, 1], g); return g; }
  if (stage === 1) { sprout(1.6, 2); g.position.y = 0.15; return g; }
  g.position.y = 0.15;
  if (kind === 'potato') {
    for (let i = 0; i < 7; i++) part(new THREE.SphereGeometry(0.13, 8, 6), i % 2 ? leaf : leafD, [Math.cos(i * 0.9) * 0.28, 0.15 + (i % 3) * 0.06, Math.sin(i * 0.9) * 0.28], [0, i, 0], [1.3, 0.5, 1], g);
    if (stage === 3) for (let i = 0; i < 3; i++) part(new THREE.SphereGeometry(0.1, 10, 8), mat('#a0466a', { rough: 0.7 }), [Math.cos(i * 2.1) * 0.22, 0.04, Math.sin(i * 2.1) * 0.22], [0, i, 0.5], [1.5, 0.8, 1], g);
  } else if (kind === 'tomato') {
    part(new THREE.CylinderGeometry(0.02, 0.02, stage === 3 ? 0.95 : 0.6, 5), mat('#8a5a34'), [0.06, stage === 3 ? 0.47 : 0.3, 0], [0, 0, 0], [1, 1, 1], g);
    const h = stage === 3 ? 0.85 : 0.55;
    for (let i = 0; i < 8; i++) part(new THREE.SphereGeometry(0.09, 8, 6), i % 2 ? leaf : leafD, [Math.cos(i * 1.7) * 0.14, 0.12 + (i / 8) * h, Math.sin(i * 1.7) * 0.14], [0, i, 0], [1.4, 0.5, 1], g);
    if (stage === 3) for (let i = 0; i < 5; i++) part(new THREE.SphereGeometry(0.075, 10, 8), mat('#e8412f', { rough: 0.35 }), [Math.cos(i * 1.3) * 0.17, 0.3 + (i % 3) * 0.17, Math.sin(i * 1.3) * 0.17], [0, 0, 0], [1, 0.9, 1], g);
  } else {
    for (let i = 0; i < 6; i++) part(new THREE.SphereGeometry(0.12, 8, 6), i % 2 ? leaf : leafD, [Math.cos(i * 1.05) * 0.4, 0.06, Math.sin(i * 1.05) * 0.4], [0, i, 0], [1.4, 0.35, 1], g);
    if (stage === 3) {
      const melon = part(new THREE.SphereGeometry(0.3, 18, 14), mat('#2f7a3a', { rough: 0.5 }), [0, 0.22, 0], [0, 0.4, 0], [1.2, 0.95, 1], g);
      for (let i = 0; i < 6; i++) part(new THREE.SphereGeometry(0.302, 18, 14, i * Math.PI / 3, 0.18), mat('#6fbf5a', { rough: 0.5 }), [0, 0, 0], [0, 0, 0], [1, 1, 1], melon);
    } else part(new THREE.SphereGeometry(0.12, 12, 10), mat('#4a9a48', { rough: 0.5 }), [0, 0.1, 0], [0, 0, 0], [1.2, 0.95, 1], g);
  }
  return g;
}
// 工具：锄头、水壶
export function buildHoe() {
  const g = new THREE.Group();
  part(cyl(0.025, 0.03, 1.2, 8), mat('#8a5a34'), [0, 0, 0.5], [Math.PI / 2, 0, 0], [1, 1, 1], g);
  part(roundedBox(0.32, 0.05, 0.16, 0.02), mat('#9a978c', { rough: 0.5, metal: 0.3 }), [0, -0.1, 1.08], [0.4, 0, 0], [1, 1, 1], g);
  part(new THREE.TorusGeometry(0.035, 0.014, 6, 10), mat('#237a78'), [0, 0, 0.95], [0, Math.PI / 2, 0], [1, 1, 1], g);
  return g;
}
export function buildCan() {
  const g = new THREE.Group();
  part(cyl(0.2, 0.24, 0.36, 16), mat('#2f8fd0', { rough: 0.4, metal: 0.2 }), [0, 0.18, 0], [0, 0, 0], [1, 1, 1], g);
  part(cyl(0.035, 0.05, 0.4, 8), mat('#2f8fd0', { rough: 0.4 }), [0, 0.3, 0.3], [1.0, 0, 0], [1, 1, 1], g);
  part(cyl(0.07, 0.04, 0.05, 10), mat('#c7923e', { metal: 0.6, rough: 0.3 }), [0, 0.45, 0.47], [1.0, 0, 0], [1, 1, 1], g);
  part(new THREE.TorusGeometry(0.14, 0.025, 6, 16, Math.PI), mat('#1f6fa8'), [0, 0.38, -0.05], [0, Math.PI / 2, 0], [1, 1, 1], g);
  return g;
}
export function buildSeedBag(color) {
  const g = new THREE.Group();
  part(new THREE.SphereGeometry(0.3, 14, 10), mat('#d9c08a', { rough: 0.95 }), [0, 0.3, 0], [0, 0, 0], [1, 1.1, 0.9], g);
  part(new THREE.CylinderGeometry(0.1, 0.18, 0.12, 12), mat('#d9c08a'), [0, 0.62, 0], [0, 0, 0], [1, 1, 1], g);
  part(new THREE.TorusGeometry(0.1, 0.025, 6, 14), mat('#e85d4a'), [0, 0.58, 0], [Math.PI / 2, 0, 0], [1, 1, 1], g);
  part(new THREE.SphereGeometry(0.11, 10, 8), mat(color), [0, 0.32, 0.27], [0, 0, 0], [1, 1, 0.4], g);
  return g;
}

// ─── 性能：把一个模型里的零件按材质合并成少数几个网格（每个材质一次绘制）───
// keep 里的子节点（会动/会单独显隐的零件）原样保留。
const _m = new THREE.Matrix4();
export function bake(root, { keep = [], shadow = true } = {}) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const isKept = (o) => { for (let p = o; p && p !== root; p = p.parent) if (keep.includes(p)) return true; return false; };
  const groups = new Map(), gone = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.visible || isKept(o)) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', o.geometry.attributes.position.clone());
    g.setAttribute('normal', (o.geometry.attributes.normal || o.geometry.computeVertexNormals() || o.geometry.attributes.normal).clone());
    // 贴图材质保留 uv，顶点色材质保留 color（其余丢掉，保证同材质的几何属性一致、能合并）
    if (o.material.map) g.setAttribute('uv', o.geometry.attributes.uv ? o.geometry.attributes.uv.clone() : new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count * 2), 2));
    if (o.material.vertexColors) g.setAttribute('color', o.geometry.attributes.color ? o.geometry.attributes.color.clone() : new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count * 3).fill(1), 3));
    g.setIndex(o.geometry.index ? o.geometry.index.clone() : [...Array(o.geometry.attributes.position.count).keys()]);
    g.applyMatrix4(_m.multiplyMatrices(inv, o.matrixWorld));
    if (!groups.has(o.material)) groups.set(o.material, { gs: [], cast: false });
    const e = groups.get(o.material); e.gs.push(g); e.cast ||= o.castShadow;
    gone.push(o);
  });
  if (gone.length < 2) return root;
  gone.forEach((o) => o.parent.remove(o));
  for (const [mat, { gs, cast }] of groups) {
    const mesh = new THREE.Mesh(mergeGeometries(gs), mat);
    mesh.castShadow = shadow && cast; mesh.receiveShadow = true;
    root.add(mesh);
    gs.forEach((g) => g.dispose());
  }
  return root;
}
// 同一个模型里的材质：每个原始材质只克隆一次（淡出用），避免合并后仍然一零件一材质
export function cloneMaterials(root) {
  const map = new Map();
  root.traverse((o) => { if (o.isMesh) { if (!map.has(o.material)) map.set(o.material, o.material.clone()); o.material = map.get(o.material); } });
  return [...map.values()];
}

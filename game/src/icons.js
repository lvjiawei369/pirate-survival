// 道具图标：用游戏里的同一批程序化模型，离屏渲染成透明底 PNG。
// 这样图标和场景是同一种“软陶手办”质感，而不是系统 emoji。
import * as THREE from 'three';
import * as M from './models.js';

const SIZE = 128;
export const ICONS = {};

function coil() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) M.part(new THREE.TorusGeometry(0.34 - i * 0.02, 0.07, 10, 28), M.mat('#d9b877'), [0, i * 0.11, 0], [Math.PI / 2, 0, 0], [1, 1, 1], g);
  M.part(new THREE.CapsuleGeometry(0.07, 0.35, 4, 8), M.mat('#d9b877'), [0.38, 0.1, 0.12], [0.3, 0, 1.2], [1, 1, 1], g);
  return g;
}
function leaves() {
  const g = M.buildFern(2); g.scale.setScalar(1.3); return g;
}
function coconut() {
  const g = new THREE.Group();
  M.part(new THREE.SphereGeometry(0.4, 20, 16), M.mat('#6b4a2a', { rough: 0.9 }), [0, 0.4, 0], [0, 0, 0], [1, 0.95, 1], g);
  for (const [x, z] of [[0.08, 0.3], [-0.1, 0.3], [0, 0.36]]) M.part(new THREE.SphereGeometry(0.05, 8, 6), M.mat('#3e2a18'), [x, 0.62, z], [0, 0, 0], [1, 1, 1], g);
  return g;
}
function planks() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) M.part(M.roundedBox(1.4, 0.12, 0.34, 0.03), M.mat(i % 2 ? '#b07c4a' : '#9c6a3c'), [0, i * 0.13, (i - 1) * 0.06], [0, (i - 1) * 0.12, 0], [1, 1, 1], g);
  return g;
}
function sail() {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1, 1.1, 6, 6);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, 0.15 * Math.cos(p.getX(i) * 1.5));
  geo.computeVertexNormals();
  M.part(geo, M.mat('#efe3c8'), [0, 0.6, 0], [0, 0, 0], [1, 1, 1], g).material.side = THREE.DoubleSide;
  M.part(new THREE.TorusGeometry(0.22, 0.045, 8, 20, Math.PI * 1.5), M.mat('#237a78'), [0, 0.6, 0.17], [0, 0, 0.6], [1, 1, 1], g);
  M.part(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8), M.mat('#6f4629'), [0, 0.6, -0.05], [0, 0, 0], [1, 1, 1], g);
  return g;
}
function tentkit() {
  const g = new THREE.Group();
  M.part(new THREE.CylinderGeometry(0.28, 0.28, 1.1, 16), M.mat('#2f8f8a'), [0, 0.3, 0], [0, 0, Math.PI / 2], [1, 1, 1], g);
  for (const x of [-0.3, 0.3]) M.part(new THREE.TorusGeometry(0.29, 0.035, 6, 20), M.mat('#d9c08a'), [x, 0.3, 0], [0, Math.PI / 2, 0], [1, 1, 1], g);
  for (const z of [-0.12, 0.12]) M.part(new THREE.CylinderGeometry(0.035, 0.035, 1.4, 6), M.mat('#7a5230'), [0.05, 0.62, z], [0, 0, Math.PI / 2 - 0.1], [1, 1, 1], g);
  return g;
}
function soup() {
  const g = new THREE.Group();
  const bowl = new THREE.LatheGeometry([[0, 0], [0.3, 0.02], [0.45, 0.15], [0.5, 0.35], [0.46, 0.36]].map(([x, y]) => new THREE.Vector2(x, y)), 24);
  M.part(bowl, M.mat('#6b4a2a'), [0, 0, 0], [0, 0, 0], [1, 1, 1], g).material.side = THREE.DoubleSide;
  M.part(new THREE.CylinderGeometry(0.44, 0.44, 0.04, 24), M.mat('#f6ecd2', { rough: 0.4 }), [0, 0.3, 0], [0, 0, 0], [1, 1, 1], g);
  const f = M.buildFish('#e0a070'); f.position.set(0, 0.36, 0); f.rotation.set(0.2, 1, 0); f.scale.setScalar(1.2); g.add(f);
  M.part(new THREE.SphereGeometry(0.05, 8, 6), M.mat('#4f9a55'), [0.2, 0.34, 0.12], [0, 0, 0], [1, 0.4, 1], g);
  return g;
}
function claw() {
  const g = new THREE.Group();
  const c = M.mat('#d9432f', { rough: 0.6 });
  M.part(new THREE.SphereGeometry(0.28, 16, 12), c, [0, 0.3, 0], [0, 0, 0], [0.85, 0.75, 1.1], g);
  M.part(new THREE.ConeGeometry(0.15, 0.5, 10), c, [0, 0.42, 0.34], [1.3, 0, 0], [1, 1, 0.7], g);
  M.part(new THREE.ConeGeometry(0.11, 0.36, 10), c, [0, 0.22, 0.3], [1.75, 0, 0], [1, 1, 0.7], g);
  return g;
}
function fromHero(name) {
  const hero = M.buildHero();
  const part = hero.userData.parts[name];
  part.visible = true; part.parent.remove(part);
  part.position.set(0, 0, 0);
  const g = new THREE.Group(); g.add(part);
  return g;
}

const BUILDERS = {
  wood: () => { const g = M.buildDriftwood(0.4); g.scale.setScalar(1.3); return g; },
  stone: () => M.buildStones(3),
  leaf: leaves,
  rope: coil,
  coconut,
  fish: () => M.buildFish('#5aa6d8'),
  claw,
  roast: () => M.buildSkewer('roast'),
  grilledFish: () => M.buildSkewer('grilledFish'),
  grilledClaw: () => M.buildSkewer('grilledClaw'),
  soup,
  shell: () => M.buildShell(),
  plank: planks,
  sail,
  tentkit,
  shard: () => M.buildShard(),
  sword: () => fromHero('sword'),
  axe: () => fromHero('axe'),
  rod: () => M.buildRod(),
  hoe: () => M.buildHoe(),
  can: () => M.buildCan(),
  seedPotato: () => M.buildSeedBag('#a0466a'),
  seedTomato: () => M.buildSeedBag('#e8412f'),
  seedMelon: () => M.buildSeedBag('#2f7a3a'),
  sweetPotato: () => { const g = new THREE.Group(); M.part(new THREE.SphereGeometry(0.3, 14, 10), M.mat('#a0466a'), [0, 0.3, 0], [0, 0, 0.4], [1.6, 0.85, 0.9], g); return g; },
  tomato: () => { const g = new THREE.Group(); M.part(new THREE.SphereGeometry(0.32, 16, 12), M.mat('#e8412f', { rough: 0.35 }), [0, 0.3, 0], [0, 0, 0], [1, 0.85, 1], g); M.part(new THREE.ConeGeometry(0.12, 0.08, 5), M.mat('#3f8a3f'), [0, 0.6, 0], [0, 0, 0], [1, 1, 1], g); return g; },
  watermelon: () => { const c = M.buildCrop('melon', 3); c.position.y = 0; return c; },
  roastPotato: () => { const g = new THREE.Group(); M.part(new THREE.SphereGeometry(0.3, 14, 10), M.mat('#6a3a2a', { rough: 0.9 }), [0, 0.3, 0], [0, 0, 0.4], [1.6, 0.85, 0.9], g); M.part(new THREE.SphereGeometry(0.2, 12, 8), M.mat('#f2b440'), [0.12, 0.42, 0.1], [0, 0, 0], [1.2, 0.35, 1], g); return g; }
};
// 每种物品的摆拍角度（让长条形的东西斜着放，更好认）
const POSE = {
  wood: [0.5, 0.6, 0], fish: [0.3, 1.2, 0], sword: [0.3, 0.9, 0.9], axe: [0.3, 0.9, 0.9], rod: [0.4, 0.9, 0.7],
  roast: [0.6, 0.5, 0.35], grilledFish: [0.6, 0.5, 0.35], grilledClaw: [0.6, 0.5, 0.35], shard: [0.2, 0.3, 0],
  plank: [0.6, 0.6, 0], hoe: [0.3, 0.9, 0.9], can: [0.3, -0.6, 0], sail: [0.2, -0.5, 0], tentkit: [0.5, 0.6, 0], shell: [0.9, 0.3, 0], claw: [0.4, -0.8, 0]
};

export function renderIcons() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE); renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#8aa0c0', 1.6));
  const key = new THREE.DirectionalLight('#fff4e0', 2.6); key.position.set(2, 4, 3); scene.add(key);
  const rim = new THREE.DirectionalLight('#9fd8ff', 1.4); rim.position.set(-3, 2, -2); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const box = new THREE.Box3(), sphere = new THREE.Sphere();
  for (const [k, build] of Object.entries(BUILDERS)) {
    const obj = build();
    const [rx, ry, rz] = POSE[k] || [0.35, 0.7, 0];
    const holder = new THREE.Group(); holder.add(obj); holder.rotation.set(rx, ry, rz);
    scene.add(holder);
    holder.updateMatrixWorld(true);
    box.setFromObject(holder); box.getBoundingSphere(sphere);
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(14)) * 1.02;
    camera.position.set(sphere.center.x, sphere.center.y + dist * 0.25, sphere.center.z + dist * 0.97);
    camera.lookAt(sphere.center);
    renderer.render(scene, camera);
    ICONS[k] = renderer.domElement.toDataURL('image/png');
    scene.remove(holder);
  }
  // 主角头像：只拍头
  const hero = M.buildHero(); scene.add(hero);
  hero.rotation.y = 0.35;
  camera.position.set(0.25, 1.35, 1.9); camera.lookAt(0, 1.25, 0);
  renderer.render(scene, camera);
  ICONS.avatar = renderer.domElement.toDataURL('image/png');
  renderer.dispose(); renderer.forceContextLoss();
}

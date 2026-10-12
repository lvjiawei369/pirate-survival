// 水里的鱼：浅海里一群群的小鱼（沿岸巡游、主角游过来会四散），湖里几条锦鲤慢慢绕圈。
// 全部用一个 InstancedMesh 画；摆尾在顶点着色器里做，CPU 每帧只更新位置和朝向。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundHeight, waterLevelAt, POND } from './terrain.js';

function fishGeometry() {
  // 身体：拉长的球（头在 +z），尾巴：扁的三角扇；z 越小越靠尾，摆动幅度越大
  const body = new THREE.SphereGeometry(1, 14, 10).scale(0.055, 0.075, 0.2);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.16, 0, 0.09, -0.32, 0, -0.09, -0.32, 0, 0.09, -0.32, 0, 0, -0.16, 0, -0.09, -0.32], 3));
  tail.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0], 3));
  const fin = new THREE.BufferGeometry();
  fin.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.06, 0.06, 0, 0.13, -0.04, 0, 0.06, -0.08, 0, 0.13, -0.04, 0, 0.06, 0.06, 0, 0.06, -0.08], 3));
  fin.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0], 3));
  body.deleteAttribute('uv');
  const g = mergeGeometries([body.toNonIndexed(), tail, fin]);
  // 背深腹浅
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const k = THREE.MathUtils.smoothstep(p.getY(i), -0.06, 0.06); col.set([0.55 + 0.45 * (1 - k), 0.55 + 0.45 * (1 - k), 0.55 + 0.45 * (1 - k)], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const SEA_COLORS = ['#4fb0e0', '#f2c14e', '#6fd6c8', '#ff8a5c', '#9fb8d8'];
const KOI = ['#ff7a3a', '#ffffff', '#ffb04a', '#f25a3a'];

export function createFish(scene, { tideLevel, center }) {
  const uTime = { value: 0 };
  // 在水面之后画（水不写深度，地形仍能正确遮挡）：自己按“离水面多深”混入水色，看起来像在水面下游，但颜色认得出
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    // 隔着水面颜色会被压暗、偏青：用实例色做一点自发光，保住鱼的颜色
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.3;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.1, 0.5, 0.62), 0.35);`);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; attribute float aPhase; attribute float aSpeed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float tailK = smoothstep(0.1, -0.32, position.z);
        transformed.x += sin(uTime * (8.0 + aSpeed * 10.0) + aPhase - position.z * 9.0) * (0.012 + 0.05 * tailK) * (0.6 + aSpeed);`);
  };
  const geo = fishGeometry();
  const MAX = 220;
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  const phase = new Float32Array(MAX), speedAttr = new Float32Array(MAX);
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speedAttr, 1).setUsage(THREE.DynamicDrawUsage));
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 5;
  scene.add(mesh);

  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const depthAt = (x, z) => waterLevelAt(x, z, tideLevel()) - groundHeight(x, z);
  const fish = [];   // { school, off, pos, vel, heading, scale, i }
  const schools = [];

  // 海里：在主岛周边找水深 0.8~3.5 米的浅海放鱼群（每群 7~12 条）
  for (let tries = 0; schools.length < 14 && tries < 4000; tries++) {
    const a = rnd() * Math.PI * 2, r = 20 + rnd() * 110;
    const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r, d = depthAt(x, z);
    if (d < 1.0 || d > 3.2 || schools.some(s => Math.hypot(s.pos.x - x, s.pos.z - z) < 14)) continue;
    schools.push({ pos: new THREE.Vector3(x, 0, z), home: new THREE.Vector3(x, 0, z), dir: rnd() * Math.PI * 2, t: 0, scare: 0, sea: true,
      color: new THREE.Color(SEA_COLORS[schools.length % SEA_COLORS.length]), n: 7 + Math.floor(rnd() * 6) });
  }
  // 湖：锦鲤
  schools.push({ pos: new THREE.Vector3(POND.x, 0, POND.z), home: new THREE.Vector3(POND.x, 0, POND.z), dir: 0, t: 0, scare: 0, pond: true, n: 5 });
  for (const s of schools) {
    for (let k = 0; k < s.n && fish.length < MAX; k++) {
      const i = fish.length;
      const f = { s, i, off: new THREE.Vector3((rnd() - 0.5) * 2.4, 0, (rnd() - 0.5) * 2.4), pos: s.pos.clone(), vel: new THREE.Vector3(), heading: rnd() * 6,
        scale: s.pond ? 1.5 + rnd() * 0.4 : 1.5 + rnd() * 0.7, depth: 0.12 + rnd() * 0.18, orbit: rnd() * 6 };
      f.pos.add(f.off);
      phase[i] = rnd() * 20;
      const c = s.pond ? new THREE.Color(KOI[k % KOI.length]) : s.color.clone().offsetHSL((rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.1);
      mesh.setColorAt(i, c);
      fish.push(f);
    }
  }
  mesh.count = fish.length;
  mesh.instanceColor.needsUpdate = true;

  const dummy = new THREE.Object3D(), tmp = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  // player: 主角位置；swimming: 是否在水里（在水里靠近才会惊走）
  function update(dt, camPos, player, swimming) {
    uTime.value += dt;
    for (const s of schools) {
      s.active = Math.hypot(s.pos.x - camPos.x, s.pos.z - camPos.z) < 110;
      if (!s.active) continue;
      s.t += dt;
      if (s.pond) {   // 锦鲤：绕湖心慢慢转圈
        s.dir += dt * 0.25;
        s.pos.set(POND.x + Math.cos(s.dir) * POND.r * 0.35, 0, POND.z + Math.sin(s.dir) * POND.r * 0.35);
        continue;
      }
      // 鱼群中心：慢慢游动，快到浅滩/深海/离家太远就转向
      const pd = Math.hypot(player.x - s.pos.x, player.z - s.pos.z);
      if (pd < 5 && (swimming || pd < 2.5)) { s.scare = 1.5; s.dir = Math.atan2(s.pos.z - player.z, s.pos.x - player.x); }
      s.scare = Math.max(0, s.scare - dt);
      const spd = 0.9 + s.scare * 3;
      s.dir += Math.sin(s.t * 0.5 + s.home.x) * dt * 0.4;
      const nx = s.pos.x + Math.cos(s.dir) * spd * dt, nz = s.pos.z + Math.sin(s.dir) * spd * dt, d = depthAt(nx, nz);
      if (d < 0.8 || d > 4.5 || Math.hypot(nx - s.home.x, nz - s.home.z) > 22) s.dir += dt * 2.5 * (s.scare > 0 ? 3 : 1);
      else { s.pos.x = nx; s.pos.z = nz; }
    }
    const tl = tideLevel();
    for (const f of fish) {
      const s = f.s;
      if (!s.active) { mesh.setMatrixAt(f.i, zero); continue; }
      // 每条鱼在群中心附近绕自己的小圈，散开时间隔变大
      f.orbit += dt * (0.6 + f.scale * 0.2);
      const spread = 1 + s.scare * 1.2;
      tmp.set(s.pos.x + f.off.x * spread + Math.cos(f.orbit) * 0.5, 0, s.pos.z + f.off.z * spread + Math.sin(f.orbit * 1.3) * 0.5);
      const d = s.pond ? 1 : depthAt(tmp.x, tmp.z);
      const water = s.pond ? POND.y : waterLevelAt(tmp.x, tmp.z, tl);
      tmp.y = water - Math.min(f.depth, Math.max(0.1, d - 0.2));
      f.vel.copy(tmp).sub(f.pos);
      const len = f.vel.length();
      f.pos.lerp(tmp, Math.min(1, dt * (2 + s.scare * 4)));
      if (len > 0.02) { const want = Math.atan2(f.vel.x, f.vel.z); f.heading += Math.atan2(Math.sin(want - f.heading), Math.cos(want - f.heading)) * Math.min(1, dt * 6); }
      speedAttr[f.i] = Math.min(1, len * 1.5);
      dummy.position.copy(f.pos); dummy.rotation.set(0, f.heading, 0); dummy.scale.setScalar(f.scale); dummy.updateMatrix();
      mesh.setMatrixAt(f.i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    geo.attributes.aSpeed.needsUpdate = true;
  }
  return { update, mesh, count: fish.length };
}

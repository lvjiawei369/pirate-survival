// 主角 GLB 模型接入。
// 做法：原来的程序化主角（“木偶”）继续负责所有动作逻辑（走、跑、爬、游、滑翔、砍、坐……），
// 但把它的网格隐藏；每帧把木偶关节相对静止姿势的旋转，拷贝到 GLB 的 Mixamo 骨骼上。
// 注意：这个 GLB（Tripo 导出）骨骼节点没有写位置，全部在原点，这里先用逆绑定矩阵还原骨骼的真实静止姿势。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const HEIGHT = 1.62;                           // 与木偶身高一致
const ARM_DOWN = THREE.MathUtils.degToRad(72);  // T-pose → 手臂自然下垂

export async function attachHeroModel(hero, HP, url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  let skinned = null;
  model.traverse((o) => { if (o.isSkinnedMesh) skinned = o; if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  const skel = skinned.skeleton;

  // 1) 还原骨骼静止姿势：bindWorld_i = inverse(boneInverse_i)，local = inverse(parentBindWorld) * bindWorld
  const bindWorld = new Map();
  skel.bones.forEach((b, i) => bindWorld.set(b, skel.boneInverses[i].clone().invert()));
  const fix = (b) => {
    const pw = bindWorld.get(b.parent);
    const local = pw ? pw.clone().invert().multiply(bindWorld.get(b)) : bindWorld.get(b).clone();
    local.decompose(b.position, b.quaternion, b.scale);
    b.children.forEach((c) => c.isBone && fix(c));
  };
  skel.bones.filter((b) => !b.parent?.isBone).forEach(fix);
  model.updateMatrixWorld(true);

  // 2) 缩放到木偶身高，挂在木偶 body 下（这样身体起伏、压缩、翻滚、游泳前倾都自动继承）
  const box = new THREE.Box3().setFromObject(model, true), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const k = HEIGHT / size.y;
  model.scale.setScalar(k);
  // 脚底对齐地面、身体居中（重新绑骨后的模型原点不在脚底）
  model.position.set(-ctr.x * k, -box.min.y * k, -ctr.z * k);
  HP.body.add(model);

  // 3) 隐藏木偶自己的网格（之后才加上去的：汗珠、钓竿、刀斧等工具仍然显示）
  const tools = new Set([HP.sword, HP.axe]);
  // 标了 userData.keep 的（滑翔翼、汗珠等附件）也保留显示
  const inTool = (o) => { for (let p = o; p; p = p.parent) if (tools.has(p) || p.userData?.keep) return true; return false; };
  hero.traverse((o) => { if (o.isMesh && !inTool(o) && !model.getObjectById(o.id)) o.visible = false; });

  const bone = (n) => skel.bones.find((b) => b.name.replace(/[:]/g, '').endsWith(n));
  const B = {
    spine: bone('Spine1'), head: bone('Head'), neck: bone('Neck'),
    lArm: bone('LeftArm'), rArm: bone('RightArm'), lFore: bone('LeftForeArm'), rFore: bone('RightForeArm'),
    lLeg: bone('LeftUpLeg'), rLeg: bone('RightUpLeg'), lKnee: bone('LeftLeg'), rKnee: bone('RightLeg'), lHand: bone('LeftHand')
  };
  // 模型空间（相对模型根节点）的旋转
  const mq = (o) => { const q = new THREE.Quaternion(); o.getWorldQuaternion(q); return q.premultiply(rootInv); };
  const rootInv = new THREE.Quaternion();
  const refreshRoot = () => { model.updateWorldMatrix(true, false); model.getWorldQuaternion(rootInv); rootInv.invert(); };
  hero.updateMatrixWorld(true);   // 挂到主角身上后骨骼的世界矩阵要重算，否则静止姿势是旧的
  refreshRoot();
  const rest = {};
  for (const [k, b] of Object.entries(B)) rest[k] = mq(b);
  // 静止姿势里手臂放下（木偶的 0 姿势就是手臂下垂）
  rest.lArm.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ARM_DOWN));
  rest.rArm.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ARM_DOWN));
  rest.lFore.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ARM_DOWN));
  rest.rFore.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ARM_DOWN));

  // 木偶关节：按 x 正负对应左右（面朝 +z 时 +x 是角色的左边）
  const pArmL = HP.arms.find((a) => a.sh.position.x > 0).sh, pArmR = HP.arms.find((a) => a.sh.position.x < 0).sh;
  const pLegL = HP.legs.find((l) => l.position.x > 0), pLegR = HP.legs.find((l) => l.position.x < 0);
  const bodyInv = new THREE.Quaternion();
  const pq = (o) => { const q = new THREE.Quaternion(); o.getWorldQuaternion(q); return q.premultiply(bodyInv); };
  const saveRot = (o) => o.rotation.clone();
  // 木偶的静止姿势（所有关节归零时）
  const pRest = {};
  {
    const saved = [HP.torso, HP.head, pArmL, pArmR, pLegL, pLegR].map((o) => [o, saveRot(o)]);
    saved.forEach(([o]) => o.rotation.set(0, 0, 0));
    hero.updateMatrixWorld(true);
    HP.body.getWorldQuaternion(bodyInv); bodyInv.invert();
    Object.assign(pRest, { torso: pq(HP.torso), head: pq(HP.head), armL: pq(pArmL), armR: pq(pArmR), legL: pq(pLegL), legR: pq(pLegR) });
    saved.forEach(([o, r]) => o.rotation.copy(r));
  }

  const tmp = new THREE.Quaternion(), tmp2 = new THREE.Quaternion();
  // 让骨骼 b 在模型空间里的旋转 = delta * restQ
  function drive(b, delta, restQ) {
    const target = tmp.copy(delta).multiply(restQ);
    b.parent.updateWorldMatrix(true, false);
    const parentQ = mq(b.parent);
    b.quaternion.copy(parentQ.invert().multiply(target));
    b.updateMatrixWorld(true);
  }
  const delta = (p, r) => pq(p).multiply(tmp2.copy(r).invert());
  const kneeQ = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0);
  const handPt = new THREE.Vector3(0.035, -0.31, 0), wHand = new THREE.Vector3(), wPup = new THREE.Vector3(), v = new THREE.Vector3();
  const basePos = new Map([[pArmL, pArmL.position.clone()], [pArmR, pArmR.position.clone()]]);

  // 4) 模型自带的动作片段（Tripo 导出，mixamo 骨骼）：walk / run / run_upstairs / swim / dive / sit / wave_goodbye_01 / heart_pose。
  //    去掉根运动（位置由游戏控制）：髋骨水平位移归零；循环片段里一路往上走的高度也减掉（上楼梯）。
  //    两层混合：先是木偶驱动的姿势，其上叠“移动层”（走/跑/上坡，按步幅同步相位），再叠“覆盖层”（任意一段，调用方给时间和权重）。
  const bones = skel.bones;
  const restP = bones.map((b) => b.position.clone()), restQ = bones.map((b) => b.quaternion.clone());
  // 不用 AnimationMixer：它会缓存上次写入的值、值不变就不再写，而这里每帧都先把骨骼复位，定格的姿势会丢。
  // 直接对每条轨道做插值采样。
  const boneIdx = new Map(bones.map((b, i) => [b.name, i]));
  const clips = {}, strides = {};
  const LOOP_CLIMB = new Set(['run_upstairs']);
  for (const clip of gltf.animations) {
    const hips = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
    if (hips) {
      const v = hips.values, n = v.length / 3, dy = LOOP_CLIMB.has(clip.name) ? v[(n - 1) * 3 + 1] - v[1] : 0;
      strides[clip.name] = Math.hypot(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 2] - v[2]) * k;   // 一个循环走多远（米，已按模型缩放）
      for (let i = 0; i < n; i++) { v[i * 3] = v[0]; v[i * 3 + 2] = v[2]; v[i * 3 + 1] -= dy * i / (n - 1); }
    }
    const per = bones.map(() => ({ p: null, q: null }));
    for (const t of clip.tracks) {
      const [node, prop] = t.name.split('.'), i = boneIdx.get(node);
      if (i === undefined) continue;
      if (prop === 'position') per[i].p = t.createInterpolant();
      else if (prop === 'quaternion') per[i].q = t.createInterpolant();
    }
    clips[clip.name] = { per, duration: clip.duration };
  }
  const has = (n) => !!clips[n];
  const hasLoco = has('walk') && has('run');
  let phase = 0;
  const dur = (n) => clips[n]?.duration || 1;
  const sp = new THREE.Vector3(), sq = new THREE.Quaternion(), tp = new THREE.Vector3(), tq = new THREE.Quaternion();
  // 把当前骨骼姿势和 set（[片段, 时间, 权重]…）采样混合出的姿势按 w 混合
  function layer(set, w) {
    if (w <= 0.001) return;
    set = set.filter((e) => e[2] > 0.001);
    if (!set.length) return;
    for (let i = 0; i < bones.length; i++) {
      let tw = 0;
      for (const [n, t, cw] of set) {
        const c = clips[n].per[i];
        if (c.p) sp.fromArray(c.p.evaluate(t)); else sp.copy(restP[i]);
        if (c.q) sq.fromArray(c.q.evaluate(t)); else sq.copy(restQ[i]);
        if (tw === 0) { tp.copy(sp); tq.copy(sq); } else { const f = cw / (tw + cw); tp.lerp(sp, f); tq.slerp(sq, f); }
        tw += cw;
      }
      bones[i].position.lerp(tp, w);
      bones[i].quaternion.slerp(tq, w);
    }
  }

  const elbow = new THREE.Quaternion();
  // loco: { w: 0..1 走跑动作的权重, speed: 水平速度 m/s, dt }
  function update(runK = 0, loco = null, over = null) {
    // 木偶的肩膀位置每帧先复原（下面会为了对齐手而挪动它）
    for (const [o, p] of basePos) o.position.copy(p);
    // 没被木偶驱动的骨骼（手指、脚、髋）先回到静止姿势，免得残留上一帧的动作
    for (let i = 0; i < bones.length; i++) { bones[i].position.copy(restP[i]); bones[i].quaternion.copy(restQ[i]); }
    hero.updateMatrixWorld(true);
    HP.body.getWorldQuaternion(bodyInv); bodyInv.invert();
    refreshRoot();
    const dTorso = delta(HP.torso, pRest.torso);
    drive(B.spine, dTorso, rest.spine);
    drive(B.head, delta(HP.head, pRest.head), rest.head);
    const dL = delta(pArmL, pRest.armL), dR = delta(pArmR, pRest.armR);
    drive(B.lArm, dL, rest.lArm); drive(B.rArm, dR, rest.rArm);
    // 跑步时手肘弯曲约 80°（前臂向前抬）
    elbow.setFromAxisAngle(X, -1.4 * runK);
    drive(B.lFore, tmp2.copy(dL).multiply(elbow), rest.lFore);
    drive(B.rFore, kneeQ.copy(dR).multiply(elbow), rest.rFore);
    // 腿：髋关节跟木偶；膝盖在腿往后摆、抬腿、坐下时弯曲
    for (const [pl, hip, knee, rh, rk] of [[pLegL, B.lLeg, B.lKnee, rest.lLeg, rest.lKnee], [pLegR, B.rLeg, B.rKnee, rest.rLeg, rest.rKnee]]) {
      const d = delta(pl, pl === pLegL ? pRest.legL : pRest.legR);
      drive(hip, d, rh);
      const x = pl.rotation.x;
      const bend = 0.1 + Math.max(0, x) * 0.9 + Math.max(0, -x - 0.25) * 1.3;
      kneeQ.copy(d).multiply(tmp2.setFromAxisAngle(X, bend));
      drive(knee, kneeQ, rk);
    }
    // 移动层：走 ↔ 跑按 runK 混合，上坡时换成上楼梯的跑法
    if (hasLoco && loco && loco.w > 0.001) {
      const up = has('run_upstairs') ? (loco.up || 0) : 0;
      const stride = strides.walk + (strides.run - strides.walk) * runK;
      // 游戏里的移动速度比真人快很多，完全按步幅对脚会迈成碎步：步频封顶（走 1.3、跑 1.75 循环/秒），宁可脚下略滑
      const rate = Math.min(Math.max(0.35, loco.speed) / stride, 1.3 + 0.45 * runK);
      phase = (phase + loco.dt * rate * 0.7) % 1;   // 整体放慢到 70%
      const flat = 1 - up;
      layer([['walk', phase * dur('walk'), (1 - runK) * flat], ['run', phase * dur('run'), runK * flat],
        ...(up > 0 ? [['run_upstairs', (phase * 2 % 1) * dur('run_upstairs'), up]] : [])], loco.w);
    }
    // 覆盖层：游泳、坐、挥手、比心、跳水……
    if (over && has(over.name) && over.w > 0.001) layer([[over.name, over.time, 1]], over.w);
    model.updateMatrixWorld(true);
    // 工具（刀/斧/钓竿）挂在木偶左肩下：把木偶的肩膀平移到让“手”对齐模型的手
    B.lHand.getWorldPosition(wHand);
    pArmL.updateWorldMatrix(true, false);
    wPup.copy(handPt).applyMatrix4(pArmL.matrixWorld);
    v.copy(wHand).sub(wPup);
    const parentInv = new THREE.Matrix4().copy(pArmL.parent.matrixWorld).invert();
    const local = v.clone().transformDirection(parentInv).multiplyScalar(v.length() / pArmL.parent.getWorldScale(new THREE.Vector3()).x);
    pArmL.position.add(local);
  }
  return { model, update, bones: B, strides, has, duration: dur };
}

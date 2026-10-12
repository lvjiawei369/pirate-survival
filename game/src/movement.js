// 移动（塞尔达式）：走/跑 · 跳 · 攀爬（陡坡/树/石头）· 滑翔翼 · 游泳。
// 跑、爬、滑翔、游泳都耗体力；体力见底：攀爬会松手、滑翔会收伞、游泳会被冲回岸边，然后“累瘫”到 35%。
// 冒汗：吃力时从头上甩出水滴，体力低时头边挂一颗漫画汗珠。
import * as THREE from 'three';
import { terrainHeight, groundHeight, onDock, nearBoat, waterLevelAt } from './terrain.js';
import { SWEAT_GEO, sweatMat, buildGlider } from './models.js';
import { loadProp } from './propModels.js';
const GLIDER_Y = -0.1;   // 放平后的滑翔翼中心相对挂点的高度

const CLIMB_SLOPE = 1.05;    // 坡度（高/水平）超过这个就走不上去，要爬
const WALK_BACK = 0.8;       // 爬到坡度低于这个就站起来走
const SWIM_DEPTH = 0.85;     // 水深超过这个开始游泳
const WALK = 5.4, RUN = 8.6, SWIM = 3.2, SWIM_FAST = 4.6, GLIDE = 7.5, AIR = 5.4;
const DRAIN = { climbMove: 6, climbHold: 2, run: 5, swim: 1.5, swimFast: 6, glide: 3 };   // 每秒消耗

export function gradAt(x, z) {
  const e = 0.35;
  return new THREE.Vector2((terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e), (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e));
}

export function createMovement(ctx) {
  const { S, colliders, scene, hero, HP, sfx, UI, toScreen, burst, tideLevel } = ctx;
  Object.assign(S, { mode: 'walk', vy: 0, onTop: null, climb: null, exhausted: false, fallFrom: 0, pushT: 0, sprint: false });

  // ─── 滑翔翼 ───
  const glider = buildGlider(); glider.visible = false; glider.scale.setScalar(0.01); glider.userData.keep = true;
  glider.position.set(0, 2.25, -0.05); hero.add(glider);
  // 换成 GLB 滑翔翼（蒸汽朋克）：加载好后把程序化的布翼藏起来
  loadProp(`${import.meta.env.BASE_URL}models/glider.glb`, 2.9, { shadow: true, rotX: Math.PI / 2, center: true }).then((m) => {
    glider.children.forEach((c) => (c.visible = false));
    m.position.y = GLIDER_Y; glider.add(m);
    glider.traverse((o) => (o.userData.keep = true));
    ctx.gliderModel = m;
    glider.position.set(0, 1.83, 0.48);   // 让模型的两根握把正好落在举起的手里（实测对齐）
  }).catch((e) => console.warn('滑翔翼模型加载失败', e));
  let gliderOpen = 0;

  // ─── 汗 ───
  const drops = [];
  function sweat(n = 1) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(SWEAT_GEO, sweatMat);
      const side = Math.random() < 0.5 ? -1 : 1;
      m.position.copy(new THREE.Vector3(side * 0.3, 1.45, 0.05).applyMatrix4(hero.matrixWorld));
      const out = new THREE.Vector3(side * (1.2 + Math.random()), 2.2 + Math.random() * 1.2, (Math.random() - 0.5)).applyAxisAngle(new THREE.Vector3(0, 1, 0), S.facing);
      drops.push({ m, v: out, life: 0.7 });
      m.scale.setScalar(0.01);
      scene.add(m);
    }
  }
  const mark = new THREE.Mesh(SWEAT_GEO, sweatMat);
  mark.scale.setScalar(2.2); mark.visible = false; mark.userData.keep = true; HP.head.add(mark);
  let sweatTimer = 0, pantTimer = 0, splashT = 0;
  function updateSweat(dt) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.life -= dt;
      d.v.y -= 9 * dt; d.m.position.addScaledVector(d.v, dt);
      const k = d.life > 0.55 ? (0.7 - d.life) / 0.15 : Math.min(1, d.life / 0.2);
      d.m.scale.setScalar(Math.max(0.01, k) * 1.3);
      d.m.rotation.z = Math.atan2(-d.v.x, d.v.y) * 0.6;
      if (d.life <= 0) { scene.remove(d.m); drops.splice(i, 1); }
    }
    const tired = S.st < 35 || S.exhausted;
    const effort = S.mode === 'climb' || S.mode === 'glide' || (S.sprint && S.mode === 'walk');
    const rate = S.mode === 'swim' ? 0 : S.exhausted ? 6 : effort ? (S.st < 35 ? 5 : 2.2) : tired ? 1.5 : 0;
    if (rate && (sweatTimer -= dt) <= 0) { sweat(1); sweatTimer = 1 / rate; }
    mark.visible = tired && S.mode !== 'swim';
    if (mark.visible) {
      const t = (S.time * 0.8) % 1;
      mark.position.set(0.3, 0.2 - t * 0.18, 0.12);
      mark.scale.setScalar(2.2 * (t < 0.1 ? t / 0.1 : 1));
    }
    if (S.exhausted && (pantTimer -= dt) <= 0) { sfx.pant(); pantTimer = 1.1; }
  }

  // ─── 地面 / 水 ───
  function surfaceAt(x, z, y) {
    let h = groundHeight(x, z);
    for (const c of colliders) {
      if (!c.top || c.climb !== 'rock') continue;
      if (Math.hypot(x - c.x, z - c.z) < c.r * 0.95 && y >= c.top - 0.4) h = Math.max(h, c.top);
    }
    return h;
  }
  const waterAt = (x, z) => waterLevelAt(x, z, tideLevel());
  const depthAt = (x, z) => waterAt(x, z) - groundHeight(x, z);
  function steepUphill(x, z, nx, nz) {
    if (onDock(nx, nz)) return false;
    return gradAt(nx, nz).length() > CLIMB_SLOPE && terrainHeight(nx, nz) - terrainHeight(x, z) > 0.001;
  }
  const hitsBoat = (x, z) => nearBoat(x, z);
  function pushOut(p, r) {
    let contact = null;
    for (const c of colliders) {
      if (c.palm && c.res && !c.res.alive) continue;
      if (c.top && p.y >= c.top - 0.15) continue; // 已经在它上面（或飞在它上面）
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
      if (d < min && d > 1e-4) { p.x = c.x + dx / d * min; p.z = c.z + dz / d * min; if (c.climb) contact = c; }
    }
    return contact;
  }

  // ─── 状态切换 ───
  function toAir(vy = 0) { S.mode = 'air'; S.vy = vy; S.fallFrom = S.pos.y; S.climb = null; S.onTop = null; }
  function toClimb(target) {
    S.mode = 'climb'; S.climb = target; S.pushT = 0; S.vy = 0; sfx.grip();
    if (target.kind === 'object') target.a = Math.atan2(S.pos.x - target.c.x, S.pos.z - target.c.z);
  }
  function exhaust() {
    S.exhausted = true; sweat(6); sfx.pant();
    const s = toScreen(S.pos, 2.2); UI.floatText('没力气了…', s.x, s.y, '#8fd8ff');
  }
  function drain(dt, rate) {
    S.st -= dt * rate; S.stDelay = 0.8;
    if (S.st <= 0) { S.st = 0; exhaust(); return true; }
    return false;
  }
  function land(p) {
    const drop = S.fallFrom - p.y;
    S.vy = 0;
    if (depthAt(p.x, p.z) > SWIM_DEPTH) { S.mode = 'swim'; splash(p, 14); return; }
    S.mode = 'walk'; S.vel.multiplyScalar(0.4);
    if (drop > 6) ctx.hurt(Math.min(40, Math.round((drop - 6) * 6)));
    if (drop > 1) burst(p.clone().setY(p.y + 0.1), 6, ['#f3dcaa', '#ffffff'], { speed: 2, up: 1.2, life: 0.5 });
    hop();
  }
  function splash(p, n = 6) {
    burst(new THREE.Vector3(p.x, waterAt(p.x, p.z) + 0.05, p.z), n, ['#ffffff', '#bff3ef', '#8fd8ff'], { speed: 2, up: 3, life: 0.6 });
    sfx.splash();
  }
  // 试探是否要抓住墙（陡坡或可攀爬物）
  function grabCheck(want, res, contact, dt) {
    const pushing = want.lengthSq() > 0.3;
    let t = null;
    if (pushing && res === 'steep') t = { kind: 'terrain' };
    if (pushing && contact && contact.top - S.pos.y > 0.6) {
      const toC = new THREE.Vector2(contact.x - S.pos.x, contact.z - S.pos.z).normalize();
      if (toC.dot(new THREE.Vector2(want.x, want.z).normalize()) > 0.55) t = { kind: 'object', c: contact };
    }
    S.pushT = t ? S.pushT + dt : 0;
    return t;
  }

  // ─── 每帧 ───
  // want: 世界空间输入方向（0..1）；input: { jump, run }；speedMul: 攻击/采集时的减速
  function update(dt, want, input, speedMul, extraStep) {
    const p = S.pos;
    if (S.exhausted && S.st >= 35) S.exhausted = false;
    let planar = 0;
    const moving = want.lengthSq() > 0.05;
    S.sprint = input.run && moving && !S.exhausted && S.st > 1;

    if (S.mode === 'walk') {
      const speed = (S.sprint ? RUN : WALK) * speedMul * (S.exhausted ? 0.55 : 1) * (depthAt(p.x, p.z) > 0.1 ? 0.7 : 1);
      S.vel.lerp(want.clone().multiplyScalar(speed), 1 - Math.exp(-dt * 14));
      const step = S.vel.clone().multiplyScalar(dt).add(extraStep);
      const tryMove = (dx, dz) => {
        const nx = p.x + dx, nz = p.z + dz;
        if (hitsBoat(nx, nz)) return 'boat';
        if (!S.onTop && steepUphill(p.x, p.z, nx, nz)) return 'steep';
        p.x = nx; p.z = nz; return 'ok';
      };
      const res = tryMove(step.x, step.z);
      if (res !== 'ok' && tryMove(step.x, 0) !== 'ok') tryMove(0, step.z);
      const contact = pushOut(p, 0.38);
      planar = Math.hypot(S.vel.x, S.vel.z);
      if (S.sprint) drain(dt, DRAIN.run);
      const grab = grabCheck(want, res, contact, dt);
      if (grab && S.pushT > 0.18 && !S.exhausted && S.st > 4 && !S.attack && !S.act) toClimb(grab);
      else if (grab && S.exhausted && S.pushT > 0.2) { S.pushT = -1; const s = toScreen(p, 2.2); UI.floatText('太累了，爬不动', s.x, s.y, '#8fd8ff'); }
      if (S.onTop && Math.hypot(p.x - S.onTop.x, p.z - S.onTop.z) > S.onTop.r * 0.95) S.onTop = null;
      const g = surfaceAt(p.x, p.z, p.y);
      if (input.jump && !S.exhausted && S.mode === 'walk') { toAir(7.4); sfx.dodge(); }
      else if (g < p.y - 0.55) toAir(0);
      else p.y += (g - p.y) * Math.min(1, dt * 18);
      if (S.mode === 'walk' && depthAt(p.x, p.z) > SWIM_DEPTH) { S.mode = 'swim'; splash(p); }
    }

    else if (S.mode === 'air' || S.mode === 'glide') {
      const gliding = S.mode === 'glide';
      if (gliding) {
        // 滑翔：慢慢下降，按方向转向；没输入就沿着朝向继续飞
        const dir = moving ? want.clone().normalize() : new THREE.Vector3(Math.sin(S.facing), 0, Math.cos(S.facing));
        S.facing = angleLerp(S.facing, Math.atan2(dir.x, dir.z), 1 - Math.exp(-dt * 3));
        const fwd = new THREE.Vector3(Math.sin(S.facing), 0, Math.cos(S.facing));
        S.vel.lerp(fwd.multiplyScalar(moving ? GLIDE : GLIDE * 0.8), 1 - Math.exp(-dt * 2.5));
        S.vy += (-2.1 - S.vy) * Math.min(1, dt * 4);
        if (input.jump || drain(dt, DRAIN.glide)) { S.mode = 'air'; S.fallFrom = p.y; }
      } else {
        S.vy -= 22 * dt;
        S.vel.lerp(want.clone().multiplyScalar(S.sprint ? RUN : AIR), 1 - Math.exp(-dt * 3));
        const clearance = p.y - surfaceAt(p.x, p.z, p.y);
        if (input.jump && clearance > 1.4 && !S.exhausted && S.st > 1) { S.mode = 'glide'; S.fallFrom = p.y; sfx.cast(); }
      }
      const nx = p.x + (S.vel.x + extraStep.x / Math.max(dt, 1e-4)) * dt, nz = p.z + (S.vel.z + extraStep.z / Math.max(dt, 1e-4)) * dt;
      if (!hitsBoat(nx, nz)) {
        // 撞到比自己高的陡壁：停下，推着就抓墙
        const wallAhead = terrainHeight(nx, nz) > p.y + 0.3 && gradAt(nx, nz).length() > CLIMB_SLOPE;
        if (!wallAhead) { p.x = nx; p.z = nz; }
        else if (moving && S.st > 4 && !S.exhausted) toClimb({ kind: 'terrain' });
      }
      p.y += S.vy * dt;
      const contact = pushOut(p, 0.38);
      if (contact && moving && S.st > 4 && !S.exhausted && contact.top - p.y > 0.4 && S.mode !== 'climb') toClimb({ kind: 'object', c: contact });
      planar = Math.hypot(S.vel.x, S.vel.z);
      const floor = surfaceAt(p.x, p.z, p.y), water = waterAt(p.x, p.z);
      if (S.mode !== 'climb') {
        if (water > floor + SWIM_DEPTH && p.y <= water - 0.6) { p.y = water - 0.75; S.mode = 'swim'; S.vy = 0; splash(p, 16); }
        else if (p.y <= floor) { p.y = floor; if (gliding) S.fallFrom = p.y; land(p); }
      }
    }

    else if (S.mode === 'swim') {
      const fast = S.sprint;
      S.vel.lerp(want.clone().multiplyScalar(fast ? SWIM_FAST : SWIM), 1 - Math.exp(-dt * 4));
      const nx = p.x + (S.vel.x + extraStep.x / Math.max(dt, 1e-4)) * dt, nz = p.z + (S.vel.z + extraStep.z / Math.max(dt, 1e-4)) * dt;
      if (!hitsBoat(nx, nz)) { p.x = nx; p.z = nz; }
      pushOut(p, 0.38);
      planar = Math.hypot(S.vel.x, S.vel.z);
      const water = waterAt(p.x, p.z), ground = groundHeight(p.x, p.z);
      p.y += (Math.max(water - 0.75, ground) - p.y) * Math.min(1, dt * 8);
      if (moving && drain(dt, fast ? DRAIN.swimFast : DRAIN.swim)) ctx.drown();
      if (moving && (splashT -= dt) <= 0) { splashT = fast ? 0.18 : 0.35; burst(new THREE.Vector3(p.x, water + 0.05, p.z), 2, ['#ffffff', '#bff3ef'], { speed: 1, up: 1.6, life: 0.4 }); }
      if (water - ground < SWIM_DEPTH - 0.1) { S.mode = 'walk'; hop(); }
      // 游到陡岸边：推着就爬上去
      const grabT = moving && gradAt(p.x + want.x * 0.6, p.z + want.z * 0.6).length() > CLIMB_SLOPE && terrainHeight(p.x + want.x * 0.6, p.z + want.z * 0.6) > water;
      if (grabT && S.st > 4 && !S.exhausted) toClimb({ kind: 'terrain' });
    }

    else if (S.mode === 'climb') {
      const mv = want.lengthSq() > 0.05;
      if (input.jump) { toAir(3); S.vel.set(-Math.sin(S.facing) * 3, 0, -Math.cos(S.facing) * 3); drain(0.2, 20); }
      else if (S.climb.kind === 'terrain') {
        const g = gradAt(p.x, p.z);
        const step = want.clone().multiplyScalar((S.sprint ? 2.8 : 1.9) * dt);
        p.x += step.x; p.z += step.z;
        pushOut(p, 0.38);
        p.y = Math.max(groundHeight(p.x, p.z), waterAt(p.x, p.z) - 0.75);
        if (g.length() > 0.1) S.facing = Math.atan2(g.x, g.y);
        planar = mv ? 1.9 : 0;
        if (gradAt(p.x, p.z).length() < WALK_BACK) { S.mode = depthAt(p.x, p.z) > SWIM_DEPTH ? 'swim' : 'walk'; S.vel.set(0, 0, 0); hop(); }
        else if (drain(dt, mv ? DRAIN.climbMove * (S.sprint ? 1.8 : 1) : DRAIN.climbHold)) toAir(0);
      } else {
        const c = S.climb.c;
        const toC = new THREE.Vector3(c.x - p.x, 0, c.z - p.z).normalize();
        const tan = new THREE.Vector3(-toC.z, 0, toC.x);
        const up = want.dot(toC), side = want.dot(tan);
        const base = groundHeight(p.x, p.z);
        p.y = Math.min(c.top, p.y + up * 1.7 * dt);
        S.climb.a -= side * 1.6 * dt / Math.max(0.5, c.r);
        p.x = c.x + Math.sin(S.climb.a) * (c.r + 0.3); p.z = c.z + Math.cos(S.climb.a) * (c.r + 0.3);
        S.facing = Math.atan2(c.x - p.x, c.z - p.z);
        planar = mv ? 1.7 : 0;
        if (p.y >= c.top - 0.02) {
          if (c.climb === 'rock') { S.mode = 'walk'; S.onTop = c; p.x += toC.x * 0.6; p.z += toC.z * 0.6; p.y = c.top; hop(); }
          else if (up < -0.3) toAir(0);
        }
        if (S.mode === 'climb') {
          if (p.y <= base + 0.02 && up < -0.2) { S.mode = 'walk'; p.y = base; S.climb = null; }
          else if (drain(dt, mv ? DRAIN.climbMove : DRAIN.climbHold * (p.y >= c.top - 0.05 ? 0.5 : 1))) toAir(0);
        }
      }
    }

    // 滑翔翼开合动画
    const want01 = S.mode === 'glide' ? 1 : 0;
    gliderOpen += (want01 - gliderOpen) * Math.min(1, dt * 10);
    glider.visible = gliderOpen > 0.02;
    glider.scale.set(Math.max(0.01, gliderOpen), Math.max(0.01, gliderOpen * (1.2 - 0.2 * gliderOpen)), Math.max(0.01, gliderOpen));
    // 前缘抬起约 25°，让后方镜头看到伞面底部
    if (glider.visible) { glider.rotation.z = Math.sin(S.time * 2) * 0.05; glider.rotation.x = -0.45; }

    updateSweat(dt);
    return planar;
  }
  const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
  let hopT = 0;
  function hop() { hopT = 0.25; }

  // 姿势动画（覆盖走路动画）
  function animate(dt) {
    const P = HP, [L, R] = P.arms;
    hopT = Math.max(0, hopT - dt);
    if (hopT > 0) { const k = Math.sin(hopT / 0.25 * Math.PI); P.body.position.y += k * 0.15; P.body.scale.set(1 - 0.06 * k, 1 + 0.1 * k, 1 - 0.06 * k); }
    P.body.position.x = 0;
    if (S.mode === 'climb') {
      const ph = S.time * (S.sprint ? 12 : 8), m = ctx.inputMag() > 0.05 ? 1 : 0.15;
      L.sh.rotation.set(-2.7 + Math.sin(ph) * 0.45 * m, 0, -0.25);
      R.sh.rotation.set(-2.7 - Math.sin(ph) * 0.45 * m, 0, 0.25);
      P.legs[0].rotation.x = -0.5 + Math.sin(ph) * 0.5 * m; P.legs[1].rotation.x = -0.5 - Math.sin(ph) * 0.5 * m;
      P.torso.rotation.set(-0.25, 0, Math.sin(ph) * 0.06 * m);
      P.head.rotation.set(-0.35, 0, 0);
      P.body.position.y = -0.7 + Math.abs(Math.sin(ph)) * 0.04 * m;
      if (S.st < 25) P.body.position.x = Math.sin(S.time * 60) * 0.015;
      // 身体贴着攀爬面：沿坡面切线方向前倾（坡越缓，越趴在坡上）
      let lean = 0.12;
      if (S.climb?.kind === 'terrain') {
        const g = gradAt(S.pos.x, S.pos.z).length();
        lean = Math.max(0, Math.PI / 2 - Math.atan(g)) * 0.95;
      }
      S.climbLean = (S.climbLean ?? lean) + (lean - (S.climbLean ?? lean)) * Math.min(1, dt * 8);
      ctx.roller.rotation.x = S.climbLean;
    } else if (S.mode === 'glide' || S.mode === 'air') {
      // 空中：主动画还按水平速度跑走路循环（滑翔很快 → 身体上下高频弹跳），这里把身体钉住
      P.body.position.y = -0.7; P.body.scale.set(1, 1, 1);
    }
    if (S.mode === 'glide') {
      // 双手举过头握住滑翔翼，腿微微晃
      L.sh.rotation.set(-3.0, 0, -0.35); R.sh.rotation.set(-3.0, 0, 0.35);
      P.legs[0].rotation.x = 0.25 + Math.sin(S.time * 3) * 0.2; P.legs[1].rotation.x = 0.1 - Math.sin(S.time * 3) * 0.2;
      P.torso.rotation.set(0.15, 0, 0); P.head.rotation.set(0.1, 0, 0);
    } else if (S.mode === 'air') {
      const up = S.vy > 0;
      L.sh.rotation.set(up ? -2.2 : -2.8, 0, -0.7); R.sh.rotation.set(up ? -2.2 : -2.8, 0, 0.7);
      P.legs[0].rotation.x = up ? -0.9 : 0.4; P.legs[1].rotation.x = up ? 0.3 : -0.2;
      P.torso.rotation.set(up ? 0.1 : -0.1, 0, 0);
    } else if (S.mode === 'swim') {
      // 身体前倾趴在水面，蛙泳划手 + 蹬腿
      const ph = S.time * (S.sprint ? 9 : 5.5), m = ctx.inputMag() > 0.05 ? 1 : 0.3;
      ctx.roller.rotation.x = 1.15;
      L.sh.rotation.set(-2.6 + Math.cos(ph) * 0.5 * m, 0, -0.6 - Math.sin(ph) * 0.8 * m);
      R.sh.rotation.set(-2.6 + Math.cos(ph) * 0.5 * m, 0, 0.6 + Math.sin(ph) * 0.8 * m);
      P.legs[0].rotation.x = 0.2 + Math.sin(ph + 1) * 0.5 * m; P.legs[1].rotation.x = 0.2 + Math.sin(ph + 1) * 0.5 * m;
      P.head.rotation.set(-1.0, 0, 0);
      P.body.position.y = -0.7 + Math.sin(ph * 2) * 0.03;
    } else if (S.sprint && S.mode === 'walk') {
      P.head.rotation.x = -0.18;   // 跑步时抬头看前方（前倾和摆臂在主动画里）
    }
    if (S.exhausted && S.mode === 'walk') {
      P.eyes.forEach(e => (e.scale.y = 0.3));
      P.torso.rotation.x = 0.35 + Math.sin(S.time * 7) * 0.06;
      P.head.rotation.x = 0.2;
      L.sh.rotation.x = 0.4; R.sh.rotation.x = 0.4;
    }
  }
  // 两个翼尖（后缘）的世界坐标，给尾流用；没在滑翔时返回 null
  const tipL = new THREE.Vector3(), tipR = new THREE.Vector3();
  function gliderTips() {
    if (S.mode !== 'glide' || gliderOpen < 0.9) return null;
    glider.updateWorldMatrix(true, false);
    const y = ctx.gliderModel ? GLIDER_Y : -0.05, z = ctx.gliderModel ? -0.5 : -0.8;
    return [glider.localToWorld(tipL.set(1.4, y, z)), glider.localToWorld(tipR.set(-1.4, y, z))];
  }
  return { update, animate, pushOut, surfaceAt, sweat, gliderTips, startFall: () => toAir(0), isGliding: () => S.mode === 'glide' };
}

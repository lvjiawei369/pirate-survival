// 战斗特效：刀光弧、命中火花（星形闪光 + 飞溅光条 + 瞬时点光源）、重击地面冲击波、
// 螃蟹蓄力的红色收缩预警圈、击杀时的光爆和上升的光点。
// 全部是加法混合、不受雾影响的 HDR 颜色（>1），交给后期泛光出光晕。对象都预先建好、循环复用。
import * as THREE from 'three';

const ADD = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false };

// 刀光：沿弧长的 a（0 起点 → 1 刀尖所在的前沿）、沿半径的 r（0 内 → 1 外）
function arcGeometry(inner, outer, span, seg = 28) {
  const pos = [], a = [], r = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, ang = -span / 2 + t * span;
    for (const [rad, rr] of [[inner, 0], [outer, 1]]) { pos.push(Math.sin(ang) * rad, 0, Math.cos(ang) * rad); a.push(t); r.push(rr); }
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aA', new THREE.Float32BufferAttribute(a, 1));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(r, 1));
  g.setIndex(idx);
  return g;
}
// 刀光用预乘混合（ONE, 1-srcAlpha）：本体盖住背景、亮边再往上叠光，在大白天的草地上也看得清；
// 不做深度测试，挥刀时不会被主角自己的身体挡住
const arcMat = () => new THREE.ShaderMaterial({
  ...ADD, side: THREE.DoubleSide, depthTest: false,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  uniforms: { uColor: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() }, uHead: { value: 0 }, uFade: { value: 1 } },
  vertexShader: `attribute float aA; attribute float aR; varying float vA; varying float vR;
    void main() { vA = aA; vR = aR; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 uColor; uniform vec3 uEdge; uniform float uHead; uniform float uFade; varying float vA; varying float vR;
    void main() {
      float behind = uHead - vA;                               // 刀尖之后的拖尾
      if (behind < 0.0) discard;
      float tail = exp(-behind * 3.2);
      float rim = smoothstep(0.35, 0.95, vR) * (1.0 - smoothstep(0.95, 1.0, vR));   // 外沿最亮的锋线
      float body = smoothstep(0.0, 0.7, vR);
      vec3 c = mix(uColor * body * 0.8, uEdge, rim);
      float a = (body * 0.8 + rim * 1.4) * tail * uFade;
      gl_FragColor = vec4(c * a, clamp(a * 0.55, 0.0, 0.85));
    }`
});
// 贴地的柔边圆环（冲击波 / 预警圈）
const ringMat = () => new THREE.ShaderMaterial({
  ...ADD,
  uniforms: { uColor: { value: new THREE.Color() }, uWidth: { value: 0.12 }, uAlpha: { value: 1 }, uFill: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 uColor; uniform float uWidth; uniform float uAlpha; uniform float uFill; varying vec2 vUv;
    void main() {
      float d = length(vUv);
      float ring = smoothstep(1.0 - uWidth, 1.0 - uWidth * 0.35, d) * (1.0 - smoothstep(0.97, 1.0, d));
      float a = (ring + uFill * smoothstep(1.0, 0.0, d) * 0.35) * uAlpha;
      gl_FragColor = vec4(uColor * a, a);
    }`
});
// 命中闪光：四角星 + 圆形光晕，面向镜头
const flashMat = () => new THREE.ShaderMaterial({
  ...ADD,
  uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, uRot: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main() {
      vUv = uv * 2.0 - 1.0;
      vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec2 s = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
      mv.xy += position.xy * s;
      gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uColor; uniform float uAlpha; uniform float uRot; varying vec2 vUv;
    void main() {
      float c = cos(uRot), s = sin(uRot);
      vec2 p = mat2(c, -s, s, c) * vUv;
      float d = length(p);
      float star = max(1.0 - smoothstep(0.0, 0.06, abs(p.x)) , 0.0) * (1.0 - d) + max(1.0 - smoothstep(0.0, 0.06, abs(p.y)), 0.0) * (1.0 - d);
      float glow = exp(-d * 5.0) * 1.2 + exp(-d * 14.0) * 2.0;
      float a = clamp((star * 1.4 + glow) * uAlpha, 0.0, 4.0);
      gl_FragColor = vec4(uColor * a, min(a, 1.0));
    }`
});

export function createCombatFX(scene, groundHeight) {
  const live = [];
  const pools = {};
  const take = (kind, make) => {
    const list = pools[kind] ||= [];
    const o = list.find((m) => !m.visible) || (list.push(make()), scene.add(list[list.length - 1]), list[list.length - 1]);
    o.visible = true; return o;
  };
  const arcGeo = arcGeometry(0.5, 2.0, 2.8), arcBig = arcGeometry(0.6, 2.6, 3.6);
  const quad = new THREE.PlaneGeometry(1, 1), flat = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const streakGeo = new THREE.BoxGeometry(0.035, 0.035, 1).translate(0, 0, -0.5);
  const moteGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const streakMat = new THREE.MeshBasicMaterial({ ...ADD, color: new THREE.Color('#ffe9b0').multiplyScalar(4) });
  const moteMat = new THREE.MeshBasicMaterial({ ...ADD, color: new THREE.Color('#bff8ff').multiplyScalar(3) });
  // 一盏常驻的点光源（数量不变，不会触发材质重编译），命中时闪一下照亮周围
  const light = new THREE.PointLight('#ffd08a', 0, 7, 1.6); scene.add(light);
  let lightT = 0, lightMax = 0;
  const flashLight = (pos, color, power) => { light.position.copy(pos); light.color.set(color); lightMax = power; lightT = 0.18; };

  // 挥刀：vertical=下劈（竖直弧），否则横扫；heavy=第三击（更大、金色）
  function slash(pos, facing, { vertical = true, heavy = false, dir = 1, tilt = 0.7 } = {}) {
    const m = take(heavy ? 'arcBig' : 'arc', () => new THREE.Mesh(heavy ? arcBig : arcGeo, arcMat()));
    m.renderOrder = 20;
    m.position.copy(pos);
    // 弧在 XZ 平面、以前方为中心。竖弧：先绕 Z 转 -90° 立起来（a=0 在头顶、a=1 在身前下方），再转到朝向
    // 横弧：水平扇面，a=0 在 -x、a=1 在 +x（dir=-1 镜像）；稍微前倾一点更好看
    // 竖弧再绕前方轴斜 tilt：斜劈，镜头在正后方也不会是一条线
    if (vertical) m.rotation.set(0, facing, -Math.PI / 2 + tilt, 'YXZ');
    else m.rotation.set(0.12, facing, 0, 'YXZ');
    m.scale.set(dir, 1, 1);
    const u = m.material.uniforms;
    u.uColor.value.set(heavy ? '#ffb347' : '#8fe8ff').multiplyScalar(heavy ? 2.2 : 1.6);
    u.uEdge.value.set(heavy ? '#fff2c0' : '#ffffff').multiplyScalar(heavy ? 5 : 3.5);
    live.push({ m, t: 0, dur: heavy ? 0.42 : 0.32, kind: 'arc' });
  }

  function sparks(pos, n, speed, color) {
    for (let i = 0; i < n; i++) {
      const s = take('streak', () => new THREE.Mesh(streakGeo, streakMat.clone()));
      s.material.color.set(color || '#ffe9b0').multiplyScalar(4);
      s.position.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.8));
      live.push({ m: s, t: 0, dur: 0.22 + Math.random() * 0.18, kind: 'streak', v, len: 0.25 + Math.random() * 0.3 });
    }
  }
  function flash(pos, color, size, dur = 0.16) {
    const f = take('flash', () => new THREE.Mesh(quad, flashMat()));
    f.position.copy(pos); f.renderOrder = 10;
    f.material.uniforms.uColor.value.set(color).multiplyScalar(2.5);
    f.material.uniforms.uRot.value = Math.random() * Math.PI;
    live.push({ m: f, t: 0, dur, kind: 'flash', size });
  }
  function shockwave(pos, color, radius, dur = 0.45, width = 0.16) {
    const r = take('ring', () => new THREE.Mesh(flat, ringMat()));
    r.position.set(pos.x, groundHeight(pos.x, pos.z) + 0.06, pos.z);
    r.material.uniforms.uColor.value.set(color).multiplyScalar(2.5);
    r.material.uniforms.uWidth.value = width; r.material.uniforms.uFill.value = 0.6;
    live.push({ m: r, t: 0, dur, kind: 'shock', radius });
  }
  // 蓄力预警：红圈从大收缩到蟹身，收到底就是扑过来的时刻
  function warn(target, dur) {
    const r = take('ring', () => new THREE.Mesh(flat, ringMat()));
    r.material.uniforms.uColor.value.set('#ff3a22').multiplyScalar(2.2);
    r.material.uniforms.uWidth.value = 0.2; r.material.uniforms.uFill.value = 0.4;
    live.push({ m: r, t: 0, dur, kind: 'warn', target });
    return r;
  }
  function motes(pos, n) {
    for (let i = 0; i < n; i++) {
      const s = take('mote', () => new THREE.Mesh(moteGeo, moteMat));
      s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.4, (Math.random() - 0.5) * 0.8));
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 0.8);
      live.push({ m: s, t: 0, dur: 0.9 + Math.random() * 0.6, kind: 'mote', v, size: 0.7 + Math.random() * 0.8 });
    }
  }

  // 组合好的事件
  const hit = (pos, heavy) => {
    flash(pos, heavy ? '#ffcf6a' : '#ffffff', heavy ? 2.2 : 1.4);
    sparks(pos, heavy ? 16 : 9, heavy ? 9 : 6.5);
    flashLight(pos, heavy ? '#ffb85a' : '#fff0d0', heavy ? 16 : 9);
    if (heavy) shockwave(pos, '#ffc060', 2.6, 0.5);
  };
  const kill = (pos) => {
    flash(pos, '#bff8ff', 3.2, 0.3);
    shockwave(pos, '#9ff2ff', 3.2, 0.6, 0.12);
    sparks(pos, 14, 7, '#bff8ff');
    motes(pos, 14);
    flashLight(pos, '#aef2ff', 22);
  };
  const hurt = (pos) => { flash(pos, '#ff5a45', 1.8, 0.2); sparks(pos, 8, 5, '#ff7a5a'); flashLight(pos, '#ff4a30', 10); };

  const tmp = new THREE.Vector3();
  function update(dt, camera) {
    if (lightT > 0) { lightT -= dt; light.intensity = lightMax * Math.max(0, lightT / 0.18) ** 2; } else light.intensity = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      const e = live[i]; e.t += dt;
      const p = Math.min(1, e.t / e.dur), m = e.m;
      if (e.kind === 'arc') {
        // 刀尖在前 45% 的时间里划完整条弧，之后整条光带淡出
        m.material.uniforms.uHead.value = Math.min(1, p / 0.45);
        m.material.uniforms.uFade.value = 1 - Math.max(0, (p - 0.45) / 0.55) ** 1.5;
      } else if (e.kind === 'streak') {
        e.v.y -= 9 * dt; m.position.addScaledVector(e.v, dt);
        m.lookAt(tmp.copy(m.position).add(e.v));
        m.scale.set(1, 1, e.len * (1 - p));
      } else if (e.kind === 'flash') {
        const k = p < 0.25 ? p / 0.25 : 1;
        m.scale.setScalar(e.size * (0.4 + 0.6 * k) * (1 + p * 0.3));
        m.material.uniforms.uAlpha.value = (1 - p) ** 1.5;
      } else if (e.kind === 'shock') {
        const k = 1 - (1 - p) ** 3;
        m.scale.setScalar(0.3 + e.radius * k);
        m.material.uniforms.uAlpha.value = (1 - p) ** 1.2;
      } else if (e.kind === 'warn') {
        const tp = e.target;
        m.position.set(tp.x, groundHeight(tp.x, tp.z) + 0.07, tp.z);
        m.scale.setScalar(2.2 - 1.5 * p);
        m.material.uniforms.uAlpha.value = Math.min(1, e.t * 6) * (0.6 + 0.4 * Math.sin(e.t * 30));
        if (e.cancel) e.t = e.dur;
      } else if (e.kind === 'mote') {
        m.position.addScaledVector(e.v, dt); e.v.multiplyScalar(1 - dt * 1.2);
        m.scale.setScalar(e.size * Math.sin(p * Math.PI));
      }
      if (e.t >= e.dur) { m.visible = false; live.splice(i, 1); }
    }
  }
  const cancelWarn = (ring) => { const e = live.find((x) => x.m === ring); if (e) e.cancel = true; };
  return { slash, hit, kill, hurt, warn, cancelWarn, shockwave, update };
}

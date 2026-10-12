// 水：海面、水潭/湖、河、瀑布。
// 海面用 Gerstner（摆线）波叠加：浪峰尖、波谷平；由解析导数得到法线和雅可比行列式，
// 雅可比变小的地方是水面被“挤压折叠”的浪尖，白沫只在那里出现（实时海洋渲染常用的物理近似）。
// 岸边白沫用分形噪声做成有破洞的泡沫带，随冲刷进退，不再是等高线式的几何线条。
import * as THREE from 'three';
import { MAP } from './terrain.js';

export const waterLight = {
  uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
  uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
  uAmb: { value: new THREE.Color(1, 1, 1) },
  uRain: { value: 0 },
  uTime: { value: 0 },
  uFogCol: { value: new THREE.Color('#8ccbd0') },
  uFogNear: { value: 70 },
  uFogFar: { value: 150 },
  uDisc: { value: new THREE.Vector3(-0.6, 0.05, -0.8).normalize() },   // 天空里画出来的太阳方向（傍晚贴着地平线）
  uGolden: { value: 0 }                                                // 黄金时刻强度 0..1
};

// 地平线颜色：太阳一侧橙黄、背面淡紫（天空和海面远处的雾共用，保证海天衔接）
export const HORIZON_GLSL = /* glsl */`
  vec3 skyHorizon(vec3 d, vec3 base, vec3 disc, float golden) {
    vec2 dh = normalize(d.xz + 1e-5), sh = normalize(disc.xz + 1e-5);
    float az = clamp(dot(dh, sh) * 0.5 + 0.5, 0.0, 1.0);
    vec3 hor = mix(base, vec3(1.1, 0.66, 0.28), pow(az, 3.0) * golden * 0.9);
    return mix(hor, vec3(0.3, 0.32, 0.55), pow(1.0 - az, 1.4) * golden * 0.6);
  }`;

const NOISE = /* glsl */`
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y); }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return v; }
`;

// 8 组 Gerstner 波：方向角(弧度), 波长, 振幅, 陡度
const WAVES = [
  [0.65, 21, 0.26, 0.55], [0.3, 13, 0.16, 0.6], [1.1, 9, 0.1, 0.6], [-0.4, 6.2, 0.06, 0.55],
  [2.4, 17, 0.14, 0.5], [0.9, 4.1, 0.035, 0.5], [-1.2, 11, 0.08, 0.5], [1.6, 3.1, 0.02, 0.45]
];
const WAVE_GLSL = WAVES.map(([a, l, amp, q]) => `gerstner(p, vec2(${Math.cos(a).toFixed(4)}, ${Math.sin(a).toFixed(4)}), ${l.toFixed(1)}, ${amp.toFixed(3)} * damp, ${q.toFixed(2)}, disp, nrm, jxx, jzz, jxz);`).join('\n        ');

function makeMaterial(heightTex, { level, wave = 1, pulse = null }) {
  const uniforms = {
    ...waterLight,
    uLevel: { value: level },
    uWave: { value: wave },
    uHeight: { value: heightTex },
    uSize: { value: MAP.size },
    uShallow: { value: new THREE.Color('#58e4d4') },
    uMid: { value: new THREE.Color('#16a6be') },
    uDeep: { value: new THREE.Color('#0b5c8e') },
    uPulse: pulse || { value: 0 }
  };
  return new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uLevel; uniform float uWave; uniform float uSize;
      uniform sampler2D uHeight;
      varying vec3 vWorld; varying vec3 vNrm; varying float vJac; varying float vCrest;
      float ground(vec2 xz) {
        vec2 uv = xz / uSize + 0.5;
        return (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? -3.0 : texture2D(uHeight, uv).r;
      }
      void gerstner(vec2 p, vec2 d, float L, float A, float Q, inout vec3 disp, inout vec3 nrm, inout float jxx, inout float jzz, inout float jxz) {
        float k = 6.28318 / L, w = sqrt(9.8 * k), ph = k * dot(d, p) - w * uTime * 0.8;
        float s = sin(ph), c = cos(ph), qa = Q * A;
        disp += vec3(qa * d.x * c, A * s, qa * d.y * c);
        nrm += vec3(-d.x * k * A * c, -Q * k * A * s, -d.y * k * A * c);
        jxx -= Q * k * A * d.x * d.x * s; jzz -= Q * k * A * d.y * d.y * s; jxz -= Q * k * A * d.x * d.y * s;
      }
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vec2 p = w.xz;
        float depth = uLevel - ground(p);
        float damp = smoothstep(0.1, 3.0, depth) * uWave;
        vec3 disp = vec3(0.0), nrm = vec3(0.0, 1.0, 0.0);
        float jxx = 1.0, jzz = 1.0, jxz = 0.0;
        ${WAVE_GLSL}
        // 近岸：进入浅水的涌浪变短变陡
        float shoal = smoothstep(2.5, 0.4, depth) * smoothstep(0.02, 0.3, depth) * uWave;
        disp.y += shoal * 0.06 * sin(0.9 * p.x + 0.45 * p.y - uTime * 1.6);
        disp.y += sin(uTime * 0.9 + p.x * 0.05 + p.y * 0.04) * 0.035 * uWave;   // 冲刷：水线在沙滩上进退
        w.xz += disp.xz; w.y = uLevel + disp.y;
        vWorld = w.xyz;
        vNrm = normalize(nrm);
        vJac = jxx * jzz - jxz * jxz;
        vCrest = disp.y;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uLevel; uniform float uSize; uniform float uPulse; uniform float uRain; uniform float uWave;
      uniform sampler2D uHeight; uniform vec3 uShallow; uniform vec3 uMid; uniform vec3 uDeep;
      uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb;
      uniform vec3 uFogCol; uniform float uFogNear; uniform float uFogFar; uniform vec3 uDisc; uniform float uGolden;
      varying vec3 vWorld; varying vec3 vNrm; varying float vJac; varying float vCrest;
      ${NOISE}
      ${HORIZON_GLSL}
      void main() {
        vec2 uv = vWorld.xz / uSize + 0.5;
        float ground = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? -3.0 : texture2D(uHeight, uv).r;
        float depth = vWorld.y - ground;
        if (depth < -0.02) discard;
        vec2 q = vWorld.xz;
        vec3 n = normalize(vNrm + vec3(noise(q * 1.7 + uTime * 0.7) - 0.5, 0.0, noise(q * 1.9 - uTime * 0.6) - 0.5) * 0.18);
        vec3 v = normalize(cameraPosition - vWorld);
        vec3 col = mix(uShallow, uMid, smoothstep(0.05, 1.0, depth));
        col = mix(col, uDeep, smoothstep(1.4, 4.0, depth));
        col *= 0.82 + 0.3 * smoothstep(-0.2, 0.5, dot(n, uSunDir));
        col += vec3(0.05, 0.22, 0.2) * smoothstep(0.05, 0.35, vCrest) * smoothstep(1.0, 3.0, depth);   // 浪尖透光
        float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
        vec3 rd = reflect(-v, n);
        vec3 skyR = mix(uAmb * vec3(0.75, 0.88, 1.0), skyHorizon(rd, uFogCol, uDisc, uGolden), uGolden * 0.8);
        col = mix(col, skyR, fres * (0.45 + uGolden * 0.2));                                          // 菲涅尔反射天空（傍晚反射出橙紫色的天）
        float cst = noise(q * 0.8 + vec2(uTime * 0.25, uTime * 0.18)) * noise(q * 1.4 - uTime * 0.2);
        col += vec3(0.9, 1.0, 0.95) * smoothstep(0.32, 0.6, cst) * 0.14 * (1.0 - smoothstep(0.2, 1.4, depth));
        // 浅水里的焦散：两层噪声相减取细线，像阳光透过水面在沙底晃
        float ca = abs(noise(q * 1.9 + vec2(uTime * 0.35, uTime * 0.2)) - noise(q * 2.5 - vec2(uTime * 0.28, -uTime * 0.31)));
        col += vec3(0.55, 1.0, 0.9) * (1.0 - smoothstep(0.0, 0.07, ca)) * 0.22 * (1.0 - smoothstep(0.15, 1.8, depth)) * (1.0 - uRain * 0.7);

        // ── 白沫 ──
        float lace = fbm(q * 1.6 + vec2(uTime * 0.12, -uTime * 0.08));
        float lace2 = fbm(q * 3.3 - vec2(uTime * 0.2, uTime * 0.05));
        // 1) 贴岸泡沫：宽度随噪声起伏，内部有破洞
        float bandW = 0.12 + 0.18 * noise(q * 0.25 + uTime * 0.05) + 0.06 * sin(uTime * 0.9 + q.x * 0.05 + q.y * 0.04);
        float shore = (1.0 - smoothstep(bandW * 0.4, bandW, depth)) * smoothstep(0.28, 0.5, lace + 0.25 * (1.0 - depth / max(bandW, 0.01)));
        // 2) 涌向岸边、被打散的碎浪
        float warp = fbm(q * 0.18 + 3.0) * 1.4;
        float surge = fract(depth * 1.1 - uTime * 0.22 + warp);
        float surgeLine = smoothstep(0.0, 0.18, surge) * (1.0 - smoothstep(0.18, 0.5, surge));
        surgeLine *= smoothstep(0.4, 0.62, lace2) * (1.0 - smoothstep(0.35, 1.3, depth)) * smoothstep(0.03, 0.12, depth);
        // 3) 深水浪尖：雅可比变小（水面被挤压）处起沫
        // 晴天只留零星的小白浪（大片白沫只在下雨起风时出现）
        float fold = smoothstep(0.72 + uRain * 0.18, 0.4, vJac) * smoothstep(0.55 - uRain * 0.1, 0.68, lace) * smoothstep(1.2, 2.6, depth);
        float foam = max(max(shore, surgeLine * 0.75), fold * (0.45 + uRain * 0.45)) * smoothstep(0.1, 0.6, uWave + 0.1);
        foam = max(foam, smoothstep(0.64, 0.7, lace2) * (1.0 - smoothstep(0.1, 0.35, depth)) * 0.3);
        if (uRain > 0.01) {
          vec2 cell = floor(q * 1.4), f = fract(q * 1.4) - 0.5;
          float ph = hash(cell), t = fract(uTime * 1.3 + ph);
          float r = length(f - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.5);
          float rip = (1.0 - smoothstep(0.0, 0.05, abs(r - t * 0.4))) * (1.0 - t) * step(0.35, hash(cell + 1.3));
          foam = max(foam, rip * uRain * 0.6);
        }
        col = mix(col, vec3(0.97, 0.99, 1.0), foam);
        float spec = pow(max(dot(reflect(-uSunDir, n), v), 0.0), 120.0);
        col += uSunCol * spec * 1.6 * (1.0 - uRain * 0.7);
        // 夕阳在海面上拉出的一条碎金光带（朝天空里的太阳方向）
        vec3 gn = normalize(n + vec3(noise(q * 3.1 + uTime * 1.2) - 0.5, 0.0, noise(q * 2.7 - uTime) - 0.5) * 0.5);
        float glit = pow(max(dot(reflect(-uDisc, gn), v), 0.0), 90.0) * smoothstep(0.55, 0.8, noise(q * 5.0 + uTime * 2.0));
        col += uSunCol * vec3(1.0, 0.8, 0.5) * glit * 5.0 * uGolden * (1.0 - uRain);
        col *= uAmb;
        col += vec3(0.4, 0.95, 0.9) * uPulse * (1.0 - smoothstep(0.0, 0.5, depth)) * (0.5 + 0.5 * sin(uTime * 8.0));
        float alpha = mix(0.36, 0.94, smoothstep(0.05, 2.2, depth));
        // 雾：远处的海融进地平线（颜色和天空的地平线一致：太阳一侧橙黄、背面淡紫）
        float fogF = smoothstep(uFogNear, uFogFar, length(vWorld.xz - cameraPosition.xz));
        col = mix(col, skyHorizon(-v, uFogCol, uDisc, uGolden), fogF);
        // 最远处让水面淡出，露出后面天空的地平线色（相机裁切处就不会出现一块色块）
        gl_FragColor = vec4(col, max(alpha, foam) * (1.0 - smoothstep(uFogFar * 0.85, uFogFar, length(vWorld.xz - cameraPosition.xz))) + fogF * 0.0);
      }`
  });
}

// 海面网格跟着镜头走（按 2 米对齐，避免波浪“游动”），远处一圈低密度环
export function buildWater(heightTex) {
  const pulse = { value: 0 };
  const mat = makeMaterial(heightTex, { level: 0, wave: 1, pulse });
  const group = new THREE.Group();
  const near = new THREE.Mesh(new THREE.PlaneGeometry(200, 200, 320, 320).rotateX(-Math.PI / 2), mat);
  const far = new THREE.Mesh(new THREE.RingGeometry(99, 900, 96, 6).rotateX(-Math.PI / 2), mat);
  near.renderOrder = far.renderOrder = 2;
  near.frustumCulled = far.frustumCulled = false;
  group.add(near, far);
  const follow = (target) => group.position.set(Math.round(target.x / 2) * 2, 0, Math.round(target.z / 2) * 2);
  return { mesh: group, uniforms: { ...mat.uniforms, uPulse: pulse }, follow };
}

// 水潭 / 湖：同一套着色，几乎无波浪
export function buildPond(heightTex, pond) {
  const mat = makeMaterial(heightTex, { level: pond.y, wave: 0.1 });
  mat.uniforms.uShallow.value.set('#7fe0d0');
  mat.uniforms.uMid.value.set('#2eaecb');
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(pond.r + 1.2, 64).rotateX(-Math.PI / 2), mat);
  mesh.position.set(pond.x, 0, pond.z);
  mesh.renderOrder = 2;
  return mesh;
}

// 流动水体（河、瀑布）：沿路径的水带。uv.y = 沿程长度，uv.x = 横向 0..1
function flowMaterial(fall) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: waterLight.uTime, uAmb: waterLight.uAmb, uLen: { value: 1 }, uFall: { value: fall ? 1 : 0 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uFall; varying vec2 vUv;
      void main() {
        vUv = uv; vec3 p = position;
        if (uFall < 0.5) p.y += sin(uv.y * 2.3 - uTime * 3.0) * 0.02;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uLen; uniform float uFall; uniform vec3 uAmb;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        float x = vUv.x, y = vUv.y, fall = uFall;
        float speed = fall > 0.5 ? 5.5 : 1.3;
        float edgeN = noise(vec2(y * 1.3 - uTime * speed * 0.3, x * 3.0)) * 0.22;
        float edge = smoothstep(0.0, 0.1 + edgeN, x) * smoothstep(1.0, 0.9 - edgeN, x);
        float n1 = fbm(vec2(x * (fall > 0.5 ? 9.0 : 4.0), y * (fall > 0.5 ? 0.9 : 0.7) - uTime * speed));
        float n2 = fbm(vec2(x * 16.0 + 3.0, y * 2.2 - uTime * speed * 1.3));
        vec3 deep = fall > 0.5 ? vec3(0.13, 0.55, 0.82) : vec3(0.1, 0.52, 0.72);
        vec3 light = fall > 0.5 ? vec3(0.45, 0.82, 0.97) : vec3(0.3, 0.78, 0.86);
        vec3 col = mix(deep, light, smoothstep(0.35, 0.7, n1));
        float streak = smoothstep(0.55, 0.78, n2);
        float bank = (1.0 - smoothstep(0.04, 0.2 + edgeN, x)) + (1.0 - smoothstep(0.04, 0.2 + edgeN, 1.0 - x));
        float white = max(streak * (fall > 0.5 ? 0.9 : 0.45), bank * smoothstep(0.4, 0.6, n2) * 0.8);
        if (fall > 0.5) white = max(white, smoothstep(uLen - 1.6, uLen, y) * 0.95);
        else white = max(white, (1.0 - smoothstep(0.0, 2.5, y)) * smoothstep(0.35, 0.6, n1));
        col = mix(col, vec3(0.96, 0.99, 1.0), white);
        col += vec3(1.0) * pow(max(0.0, n1 - 0.5) * 2.0, 6.0) * 0.5;
        float a = edge * (fall > 0.5 ? 0.92 : 0.86);
        if (fall < 0.5) a *= 1.0 - smoothstep(uLen - 5.0, uLen, y);
        gl_FragColor = vec4(col * uAmb, a);
      }`
  });
}

function ribbon(points, widthAt, lift) {
  const pos = [], uv = [], idx = [];
  let len = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) len += points[i].distanceTo(points[i - 1]);
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const w = widthAt(i / (points.length - 1));
    pos.push(points[i].x - side.x * w, points[i].y + lift, points[i].z - side.z * w, points[i].x + side.x * w, points[i].y + lift, points[i].z + side.z * w);
    uv.push(0, len, 1, len);
    if (i < points.length - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return { g, len };
}

export function buildRiver(points, widthAt) {
  const { g, len } = ribbon(points, widthAt, 0.02);
  const mat = flowMaterial(false); mat.uniforms.uLen.value = len;
  const mesh = new THREE.Mesh(g, mat); mesh.renderOrder = 3;
  return mesh;
}

// 瀑布：水帘 + 落点水花飞溅 + 水雾 + 泡沫圈
export function buildWaterfall(points, width = 1.6) {
  const group = new THREE.Group();
  const { g, len } = ribbon(points, (t) => width * (0.85 + 0.15 * t) / 2, 0.02);
  const mat = flowMaterial(true); mat.uniforms.uLen.value = len;
  const sheet = new THREE.Mesh(g, mat); sheet.renderOrder = 3; group.add(sheet);
  const base = points[points.length - 1], lip = points[0];

  const N = 180;
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 6, 4),
    new THREE.MeshBasicMaterial({ color: '#d8f2ff', transparent: true, opacity: 0.8, depthWrite: false }), N);
  drops.frustumCulled = false; group.add(drops);
  const P = Array.from({ length: N }, (_, i) => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, fromLip: i < 30 }));
  const tex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const M = 40, mistGeo = new THREE.BufferGeometry(), mistPos = new Float32Array(M * 3);
  mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
  const mist = new THREE.Points(mistGeo, new THREE.PointsMaterial({ map: tex, size: 2.2, transparent: true, opacity: 0.45, depthWrite: false, color: '#eaf8ff' }));
  mist.frustumCulled = false; group.add(mist);
  const mistP = Array.from({ length: M }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 }));
  const foam = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { uTime: waterLight.uTime }, transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv; ${NOISE}
      void main(){ vec2 c = vUv - 0.5; float r = length(c) * 2.0; float a = atan(c.y, c.x);
        float n = fbm(vec2(a * 2.0, r * 3.0 - uTime * 1.5));
        float f = smoothstep(0.35, 0.55, n + 0.4 * (1.0 - r)) * (1.0 - smoothstep(0.75, 1.0, r));
        gl_FragColor = vec4(vec3(0.97, 0.99, 1.0), f * 0.9); }`
  }));
  foam.position.set(base.x, base.y + 0.03, base.z + 0.3); foam.renderOrder = 4; group.add(foam);

  const d = new THREE.Object3D();
  function respawn(o) {
    const a = Math.random() * Math.PI * 2;
    if (o.fromLip) {
      o.p.set(lip.x + (Math.random() - 0.5) * width, lip.y, lip.z + 0.2);
      o.v.set((Math.random() - 0.5) * 1.5, 1 + Math.random(), 1.5 + Math.random() * 1.5);
      o.max = o.life = 1.2 * Math.random() + 0.3;
    } else {
      o.p.set(base.x + (Math.random() - 0.5) * width, base.y + 0.1, base.z + 0.2);
      o.v.set(Math.cos(a) * (1 + Math.random() * 2.5), 2.5 + Math.random() * 4, Math.sin(a) * (1 + Math.random() * 2.5) + 0.6);
      o.max = o.life = 0.5 + Math.random() * 0.6;
    }
  }
  P.forEach(respawn);
  function update(dt, visible) {
    group.visible = visible;
    if (!visible) return;
    drops.material.color.set('#d8f2ff').multiply(waterLight.uAmb.value);
    for (let i = 0; i < N; i++) {
      const o = P[i]; o.life -= dt;
      o.v.y -= 9.8 * dt; o.p.addScaledVector(o.v, dt);
      if (o.life <= 0 || o.p.y < base.y - 0.1) respawn(o);
      d.position.copy(o.p); d.scale.setScalar(0.6 + (o.life / o.max) * 0.9); d.updateMatrix();
      drops.setMatrixAt(i, d.matrix);
    }
    drops.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < M; i++) {
      const o = mistP[i]; o.life -= dt; o.p.addScaledVector(o.v, dt);
      if (o.life <= 0) {
        o.life = 1.5 + Math.random();
        o.p.set(base.x + (Math.random() - 0.5) * 1.8, base.y + 0.2, base.z + 0.3 + Math.random() * 0.5);
        o.v.set((Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.5, 0.3 + Math.random() * 0.4);
      }
      mistPos.set([o.p.x, o.p.y, o.p.z], i * 3);
    }
    mistGeo.attributes.position.needsUpdate = true;
  }
  return { mesh: group, update, base };
}

// 外部 GLB 道具模型（Tripo 生成、Blender 减面到 ~4 万三角、贴图 1024）：鹦鹉、滑翔翼。
// 加载后按包围盒居中、缩放到指定尺寸；原来的程序化模型先顶着，加载好再换。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();
function load(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).then((g) => g.scene));
  return cache.get(url);
}

// 返回一个包着模型的 Group：模型底部中心在原点，最大水平宽度 = width
export async function loadProp(url, width, { rotY = 0, rotX = 0, shadow = true, center = false } = {}) {
  const src = await load(url);
  const model = src.clone(true);
  // Tripo 生成的模型是“正面立着”的；rotX = π/2 把它向前放倒（头 / 前缘朝 +z 前进方向，正面朝下）
  model.rotation.set(rotX, rotY, 0, 'YXZ');
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = width / Math.max(size.x, size.z);
  const g = new THREE.Group();
  model.position.set(-c.x, center ? -c.y : -box.min.y, -c.z);
  const inner = new THREE.Group(); inner.add(model); inner.scale.setScalar(k); g.add(inner);
  model.traverse((o) => { if (o.isMesh) { o.castShadow = shadow; o.receiveShadow = true; } });
  g.userData.size = size.multiplyScalar(k);
  return g;
}

// 鹦鹉：没有骨骼，翅膀的扇动在顶点着色器里做——离身体中线越远的顶点绕身体两侧的轴上下转
export async function loadParrot(url, width, uFlap, { flat = true } = {}) {
  const g = await loadProp(url, width, { rotX: flat ? Math.PI / 2 : 0, center: flat });
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.onBeforeCompile = (sh) => {
      sh.uniforms.uFlap = uFlap;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uFlap;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            // 模型本地坐标：x 左右（翅膀展开方向），半宽约 0.49；中线附近 0.12 以内是身体不动
            float ax = abs(transformed.x), s = sign(transformed.x);
            float wk = smoothstep(0.1, 0.22, ax);
            float ang = uFlap * wk;
            // 翅膀绕身体两侧、沿头尾方向的轴上下扇：模型本地的 z（正面朝向）放倒后就是竖直方向
            float px = s * 0.1;
            float dx = transformed.x - px;
            transformed.x = px + dx * cos(ang);
            transformed.z -= abs(dx) * sin(ang);
          }`);
    };
  });
  return g;
}

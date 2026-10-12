// 滑翔翼翼尖的白色尾流：每个翼尖记录最近的一串世界坐标点，连成一条始终朝向镜头的飘带，
// 越老越宽、越淡；停止滑翔后已有的尾流继续淡出。
import * as THREE from 'three';

const N = 48, LIFE = 1.3, STEP = 0.18;

function makeRibbon(scene) {
  const pos = new Float32Array(N * 2 * 3), alpha = new Float32Array(N * 2), idx = [];
  for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    vertexShader: `attribute float aAlpha; varying float vA; varying float vS;
      void main() { vA = aAlpha; vS = float(gl_VertexID % 2) * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vA; varying float vS;
      void main() { float edge = 1.0 - vS * vS; gl_FragColor = vec4(vec3(1.6), vA * (0.35 + 0.65 * edge)); }`
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.visible = false;
  scene.add(mesh);
  return { mesh, pts: [] };   // pts: { p: Vector3, age }
}

export function createGliderTrails(scene) {
  const ribbons = [makeRibbon(scene), makeRibbon(scene)];
  const side = new THREE.Vector3(), dir = new THREE.Vector3(), view = new THREE.Vector3();
  // tips: 两个翼尖的世界坐标（不在滑翔时传 null）
  function update(dt, tips, camera) {
    ribbons.forEach((r, k) => {
      for (const q of r.pts) q.age += dt;
      while (r.pts.length && r.pts[r.pts.length - 1].age > LIFE) r.pts.pop();
      if (tips) {
        const head = r.pts[0];
        if (!head || head.p.distanceTo(tips[k]) > STEP) r.pts.unshift({ p: tips[k].clone(), age: 0 });
        else head.p.copy(tips[k]);   // 头部始终贴着翼尖
        if (r.pts.length > N) r.pts.length = N;
      }
      const n = r.pts.length;
      r.mesh.visible = n > 1;
      if (n < 2) return;
      const pos = r.mesh.geometry.attributes.position, al = r.mesh.geometry.attributes.aAlpha;
      for (let i = 0; i < N; i++) {
        const q = r.pts[Math.min(i, n - 1)], t = q.age / LIFE;
        const a = r.pts[Math.max(0, Math.min(i, n - 1) - 1)].p, b = r.pts[Math.min(n - 1, Math.min(i, n - 1) + 1)].p;
        dir.subVectors(b, a); view.subVectors(camera.position, q.p);
        side.crossVectors(dir, view).normalize().multiplyScalar(0.02 + t * 0.09);
        pos.setXYZ(i * 2, q.p.x + side.x, q.p.y + side.y, q.p.z + side.z);
        pos.setXYZ(i * 2 + 1, q.p.x - side.x, q.p.y - side.y, q.p.z - side.z);
        const fadeIn = Math.min(1, i / 3), v = i < n ? (1 - t) * (1 - t) * fadeIn * 0.8 : 0;
        al.setX(i * 2, v); al.setX(i * 2 + 1, v);
      }
      pos.needsUpdate = true; al.needsUpdate = true;
    });
  }
  return { update };
}

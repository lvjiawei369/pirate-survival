// 缩略地图：右上角的圆形小地图（以主角为中心、北朝上，显示约 120 米范围），点击展开整岛大地图。
// 底图从地形高度网格一次性画好（深海 → 浅滩 → 沙 → 草 → 岩 → 山顶），每帧只画图标。
import { MAP, LAYOUT, TIDE } from './terrain.js';

const BASE = 640;   // 底图像素（整张 520 米地图）

function lerpC(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function paintBase(heightTex) {
  const { data: H, width: N } = heightTex.image;
  const c = document.createElement('canvas'); c.width = c.height = BASE;
  const ctx = c.getContext('2d'), img = ctx.createImageData(BASE, BASE), px = img.data;
  const at = (i, j) => H[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  const sea = TIDE.high;
  for (let y = 0; y < BASE; y++) for (let x = 0; x < BASE; x++) {
    const i = Math.round(x / (BASE - 1) * (N - 1)), j = Math.round(y / (BASE - 1) * (N - 1));
    const h = at(i, j);
    let col;
    if (h < sea) {
      const d = sea - h;
      col = lerpC([120, 222, 214], [40, 150, 200], sm(0.1, 2.5, d));
      col = lerpC(col, [22, 92, 158], sm(2.5, 9, d));
      if (d < 0.35) col = lerpC([235, 250, 245], col, sm(0.05, 0.35, d));   // 岸边白浪线
    } else {
      col = lerpC([240, 222, 168], [118, 190, 88], sm(sea + 0.25, sea + 0.9, h));
      col = lerpC(col, [76, 150, 70], sm(4, 14, h));
      col = lerpC(col, [150, 146, 132], sm(16, 30, h));
      col = lerpC(col, [236, 236, 228], sm(38, 50, h));
      // 山体阴影：西北光
      const sh = (at(i - 1, j - 1) - at(i + 1, j + 1)) * 0.9;
      const k = 1 + Math.max(-0.35, Math.min(0.3, sh * 0.25));
      col = [col[0] * k, col[1] * k, col[2] * k];
    }
    const o = (y * BASE + x) * 4;
    px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function createMinimap(heightTex) {
  const base = paintBase(heightTex);
  const wrap = document.createElement('div'); wrap.id = 'minimap';
  wrap.innerHTML = '<canvas></canvas><b class="n">N</b><small>点击展开</small>';
  document.querySelector('#hud').appendChild(wrap);
  const canvas = wrap.querySelector('canvas'), ctx = canvas.getContext('2d');
  let big = false;
  wrap.addEventListener('click', () => { big = !big; wrap.classList.toggle('big', big); });
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && big) { big = false; wrap.classList.remove('big'); } });

  const toBase = (x, z) => [(x / MAP.size + 0.5) * BASE, (z / MAP.size + 0.5) * BASE];
  function tri(x, y, ang, s, fill) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.75, s * 0.8); ctx.lineTo(0, s * 0.4); ctx.lineTo(-s * 0.75, s * 0.8); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#13294b'; ctx.stroke(); ctx.restore();
  }
  function dot(x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#13294b'; ctx.stroke(); }

  // s: { pos, facing, camYaw, boat: {x,z,ry}, sailing, target, crabs: [{x,z}], time }
  let acc = 0;
  function update(dt, s) {
    acc += dt; if (acc < 1 / 30 && !big) return; acc = 0;   // 小地图 30Hz 就够
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    if (canvas.width !== Math.round(cw * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    const W = canvas.width, Hh = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, Hh);
    // 视野：小图 120 米见方以主角为中心；大图整张
    const span = big ? MAP.size * 0.62 : 120;
    const center = big ? [0, 0] : [s.pos.x, s.pos.z];
    const k = W / (span / MAP.size * BASE);   // 底图像素 → 画布像素
    const [cx, cy] = toBase(center[0], center[1]);
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(k, 0, 0, k, W / 2 - cx * k, Hh / 2 - cy * k);
    ctx.drawImage(base, 0, 0);
    // 图标（在底图坐标里画，线宽等按 1/k 换算回屏幕像素）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const P = (x, z) => { const [bx, by] = toBase(x, z); return [W / 2 + (bx - cx) * k, Hh / 2 + (by - cy) * k]; };
    const u = dpr * (big ? 1.2 : 1);
    // 地标
    const [fx, fy] = P(LAYOUT.campfire.x, LAYOUT.campfire.z);
    dot(fx, fy, 4.5 * u, '#ff8a3a');
    for (const c of s.crabs) { const [x, y] = P(c.x, c.z); dot(x, y, 3.2 * u, '#e8412f'); }
    if (s.target) {
      const [x, y] = P(s.target.x, s.target.z), pulse = 1 + Math.sin(s.time * 5) * 0.2;
      ctx.save(); ctx.translate(x, y); ctx.scale(pulse, pulse);
      ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, r = (i % 2 ? 3 : 7) * u; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fillStyle = '#ffd23a'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#13294b'; ctx.stroke(); ctx.restore();
    }
    if (!s.sailing) { const [x, y] = P(s.boat.x, s.boat.z); tri(x, y, Math.PI - s.boat.ry, 6 * u, '#c98a4a'); }
    // 镜头朝向的视锥
    const [px, py] = P(s.pos.x, s.pos.z);
    const va = -s.camYaw - Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, 26 * u, va - 0.55, va + 0.55); ctx.closePath();
    const g = ctx.createRadialGradient(px, py, 0, px, py, 26 * u); g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fill();
    tri(px, py, Math.PI - s.facing, 7.5 * u, s.sailing ? '#c98a4a' : '#ffffff');
  }
  return { update, isBig: () => big };
}

// 三渲二（卡通渲染）后期：
//  · 描边：深度 + 颜色的边缘检测，物体外轮廓和内部结构线画成深色墨线（离得越远线越细）
//  · 色阶：亮度量化成 3 档（亮面 / 中间调 / 暗面），保留原本色相，暗面偏冷、亮面偏暖
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { Uniform, Vector2 } from 'three';

const frag = /* glsl */`
uniform float uBands; uniform float uLine; uniform float uStrength;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  // ── 色阶 ──
  float L = lum(c);
  float q = L * uBands;
  float band = (floor(q) + smoothstep(0.42, 0.58, fract(q))) / uBands;
  band = max(band, 0.08);
  vec3 cel = c * (band / max(L, 1e-4));
  cel = mix(cel * vec3(0.9, 0.95, 1.08), cel * vec3(1.05, 1.0, 0.94), smoothstep(0.3, 0.7, band));  // 暗冷亮暖
  cel = mix(c, cel, uStrength);
  // ── 描边 ──
  vec2 px = texelSize * uLine;
  float dC = getViewZ(depth);
  float dz = 0.0, dc = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = i == 0 ? vec2(px.x, 0.0) : i == 1 ? vec2(-px.x, 0.0) : i == 2 ? vec2(0.0, px.y) : vec2(0.0, -px.y);
    float d = getViewZ(readDepth(uv + o));
    dz = max(dz, abs(d - dC) / max(-dC, 1.0));
    dc = max(dc, length(texture2D(inputBuffer, uv + o).rgb - c));
  }
  // 只描深度突变（物体外轮廓）；草叶之间的小深度差和颜色变化不描，避免满屏噪点
  float edge = smoothstep(0.1, 0.2, dz) * smoothstep(0.08, 0.2, dc + 0.1);
  edge *= 1.0 - smoothstep(60.0, 140.0, -dC);          // 远处不描，免得满屏噪线
  vec3 ink = cel * 0.22 + vec3(0.03, 0.04, 0.07);
  outputColor = vec4(mix(cel, ink, edge * uStrength), inputColor.a);
}`;

export class ToonEffect extends Effect {
  constructor() {
    super('ToonEffect', frag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([['uBands', new Uniform(3)], ['uLine', new Uniform(1.6)], ['uStrength', new Uniform(1)]])
    });
  }
}

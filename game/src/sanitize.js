// 清洗无效像素：任何着色器在个别角度算出 NaN/Inf 时（比如高光、负数开方），
// 泛光的模糊会把它扩散成大块黑斑。在泛光之前把这些像素替换掉、并限制过亮的 HDR 值。
import { Effect } from 'postprocessing';

const frag = /* glsl */`
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  // 按位判断 NaN/Inf（指数位全 1）：Metal/ANGLE 会把 x != x 这种写法优化掉，按位检查不会被优化
  uvec3 bits = floatBitsToUint(c) & uvec3(0x7f800000u);
  bool bad = any(equal(bits, uvec3(0x7f800000u))) || any(greaterThan(abs(c), vec3(1e4)));
  if (bad) {
    // 用周围像素的平均替换
    vec3 s = vec3(0.0); float n = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 o = i == 0 ? vec2(texelSize.x, 0.0) : i == 1 ? vec2(-texelSize.x, 0.0) : i == 2 ? vec2(0.0, texelSize.y) : vec2(0.0, -texelSize.y);
      vec3 t = texture2D(inputBuffer, uv + o * 2.0).rgb;
      uvec3 tb = floatBitsToUint(t) & uvec3(0x7f800000u);
      if (!any(equal(tb, uvec3(0x7f800000u))) && all(lessThan(abs(t), vec3(1e4)))) { s += t; n += 1.0; }
    }
    c = n > 0.0 ? s / n : vec3(0.0);
  }
  outputColor = vec4(clamp(c, 0.0, 40.0), inputColor.a);
}`;
export class SanitizeEffect extends Effect { constructor() { super('SanitizeEffect', frag); } }

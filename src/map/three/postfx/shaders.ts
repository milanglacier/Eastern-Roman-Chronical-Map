/**
 * GLSL for the painted post chain (see pipeline.ts for pass order).
 * All passes read linear-HDR input; only the composite tone-maps, grades
 * and encodes sRGB for the canvas.
 */

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Structure tensor of the colour image (Sobel, RGB-summed), evaluated at
 * paint resolution. Output (E, F, G) = (gx·gx, gx·gy, gy·gy); the
 * Kuwahara pass smooths it before the eigen-analysis.
 */
export const TENSOR_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uStep;
varying vec2 vUv;
vec3 px(vec2 o) {
  vec3 c = max(texture2D(tColor, vUv + o * uStep).rgb, 0.0);
  return c / (1.0 + c);
}
void main() {
  vec3 a = px(vec2(-1.0, -1.0)); vec3 b = px(vec2(0.0, -1.0)); vec3 c = px(vec2(1.0, -1.0));
  vec3 d = px(vec2(-1.0,  0.0));                                vec3 f = px(vec2(1.0,  0.0));
  vec3 g = px(vec2(-1.0,  1.0)); vec3 h = px(vec2(0.0,  1.0)); vec3 i = px(vec2(1.0,  1.0));
  vec3 gx = (-a - 2.0 * d - g + c + 2.0 * f + i) / 4.0;
  vec3 gy = (-a - 2.0 * b - c + g + 2.0 * h + i) / 4.0;
  gl_FragColor = vec4(dot(gx, gx), dot(gx, gy), dot(gy, gy), 1.0);
}
`;

/**
 * Generalized Kuwahara (Papari et al.) with 8 polynomial-weighted sectors;
 * with ANISOTROPIC the circular kernel is squeezed into an ellipse along
 * the local edge tangent from the structure tensor (Kyprianidis et al.),
 * which gives the brush-stroke look. Colours are compressed x/(1+x) while
 * filtering so HDR glints can't dominate the variance, then expanded.
 */
export const KUWAHARA_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tTensor;
uniform vec2 uStep;
uniform float uRadius;
uniform float uHardness;
uniform float uSharpness;
varying vec2 vUv;

const int MAXR = 9;

vec3 compress(vec3 c) { c = max(c, 0.0); return c / (1.0 + c); }
vec3 expand(vec3 c) { c = min(c, vec3(0.995)); return c / (1.0 - c); }

void main() {
  float radius = uRadius;
  vec2 dir = vec2(1.0, 0.0);
  float A = 0.0;
  #ifdef ANISOTROPIC
    // 3x3 tent smoothing of the tensor (linear taps).
    vec3 t = texture2D(tTensor, vUv).xyz * 4.0;
    t += texture2D(tTensor, vUv + vec2(uStep.x, 0.0)).xyz * 2.0;
    t += texture2D(tTensor, vUv - vec2(uStep.x, 0.0)).xyz * 2.0;
    t += texture2D(tTensor, vUv + vec2(0.0, uStep.y)).xyz * 2.0;
    t += texture2D(tTensor, vUv - vec2(0.0, uStep.y)).xyz * 2.0;
    t += texture2D(tTensor, vUv + uStep).xyz;
    t += texture2D(tTensor, vUv - uStep).xyz;
    t += texture2D(tTensor, vUv + vec2(uStep.x, -uStep.y)).xyz;
    t += texture2D(tTensor, vUv + vec2(-uStep.x, uStep.y)).xyz;
    t /= 16.0;
    float E = t.x, F = t.y, G = t.z;
    float disc = sqrt(max((E - G) * (E - G) + 4.0 * F * F, 0.0));
    float l1 = 0.5 * (E + G + disc);
    float l2 = 0.5 * (E + G - disc);
    // (l1 - E, -F) is the eigenvector of the SMALLER eigenvalue: the edge tangent.
    vec2 v0 = vec2(l1 - E, -F);
    dir = dot(v0, v0) > 1e-14 ? normalize(v0) : vec2(1.0, 0.0);
    A = (l1 + l2 > 1e-10) ? (l1 - l2) / (l1 + l2) : 0.0;
  #endif
  vec2 perp = vec2(-dir.y, dir.x);
  float a = radius * clamp(1.0 + A, 0.1, 2.0);
  float b = radius * clamp(1.0 / (1.0 + A), 0.1, 2.0);
  int maxX = int(ceil(sqrt(a * a * dir.x * dir.x + b * b * dir.y * dir.y)));
  int maxY = int(ceil(sqrt(a * a * dir.y * dir.y + b * b * dir.x * dir.x)));

  float zeta = 2.0 / radius;
  float zeroCross = 0.58;
  float sinZ = sin(zeroCross);
  float eta = (zeta + cos(zeroCross)) / (sinZ * sinZ);

  vec4 m[8];
  vec3 s[8];
  for (int k = 0; k < 8; k++) { m[k] = vec4(0.0); s[k] = vec3(0.0); }

  for (int y = -MAXR; y <= MAXR; y++) {
    if (y < -maxY || y > maxY) continue;
    for (int x = -MAXR; x <= MAXR; x++) {
      if (x < -maxX || x > maxX) continue;
      vec2 off = vec2(float(x), float(y));
      // Offset in the ellipse frame, normalized so the kernel is |v| <= 0.5.
      vec2 v = vec2(dot(off, dir) * 0.5 / a, dot(off, perp) * 0.5 / b);
      if (dot(v, v) > 0.25) continue;
      vec3 c = compress(texture2D(tColor, vUv + off * uStep).rgb);
      float w[8];
      float sum = 0.0;
      float vxx = zeta - eta * v.x * v.x;
      float vyy = zeta - eta * v.y * v.y;
      float z;
      z = max(0.0,  v.y + vxx); w[0] = z * z; sum += w[0];
      z = max(0.0, -v.x + vyy); w[2] = z * z; sum += w[2];
      z = max(0.0, -v.y + vxx); w[4] = z * z; sum += w[4];
      z = max(0.0,  v.x + vyy); w[6] = z * z; sum += w[6];
      vec2 r = 0.70710678 * vec2(v.x - v.y, v.x + v.y);
      vxx = zeta - eta * r.x * r.x;
      vyy = zeta - eta * r.y * r.y;
      z = max(0.0,  r.y + vxx); w[1] = z * z; sum += w[1];
      z = max(0.0, -r.x + vyy); w[3] = z * z; sum += w[3];
      z = max(0.0, -r.y + vxx); w[5] = z * z; sum += w[5];
      z = max(0.0,  r.x + vyy); w[7] = z * z; sum += w[7];
      float g = exp(-3.125 * dot(v, v)) / max(sum, 1e-6);
      for (int k = 0; k < 8; k++) {
        float wk = w[k] * g;
        m[k] += vec4(c * wk, wk);
        s[k] += c * c * wk;
      }
    }
  }

  // Sector weights are taken RELATIVE to the calmest sector: with absolute
  // variances, high-contrast spots (snow on rock) underflow every weight
  // and the normalization blows up into black blotches.
  vec3 means[8];
  float sig[8];
  float minSig = 1e9;
  for (int k = 0; k < 8; k++) {
    float wsum = max(m[k].w, 1e-6);
    means[k] = m[k].rgb / wsum;
    vec3 var = abs(s[k] / wsum - means[k] * means[k]);
    sig[k] = var.r + var.g + var.b;
    minSig = min(minSig, sig[k]);
  }
  vec4 outc = vec4(0.0);
  for (int k = 0; k < 8; k++) {
    float rel = uHardness * 1000.0 * (sig[k] - minSig);
    float wk = 1.0 / (1.0 + pow(max(rel, 0.0), 0.5 * uSharpness));
    outc += vec4(means[k] * wk, wk);
  }
  gl_FragColor = vec4(expand(outc.rgb / outc.w), 1.0);
}
`;

/** Bloom prefilter: soft-knee threshold + 2x2 box downsample. */
export const BLOOM_PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv + uTexel * vec2(-0.5, -0.5)).rgb;
  c += texture2D(tColor, vUv + uTexel * vec2(0.5, -0.5)).rgb;
  c += texture2D(tColor, vUv + uTexel * vec2(-0.5, 0.5)).rgb;
  c += texture2D(tColor, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  c = min(c * 0.25, vec3(64.0));
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-5);
  gl_FragColor = vec4(c * contrib, 1.0);
}
`;

/** Dual-Kawase downsample. */
export const BLOOM_DOWN_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 hp = uTexel * 0.5;
  vec3 sum = texture2D(tColor, vUv).rgb * 4.0;
  sum += texture2D(tColor, vUv - hp).rgb;
  sum += texture2D(tColor, vUv + hp).rgb;
  sum += texture2D(tColor, vUv + vec2(hp.x, -hp.y)).rgb;
  sum += texture2D(tColor, vUv - vec2(hp.x, -hp.y)).rgb;
  gl_FragColor = vec4(sum / 8.0, 1.0);
}
`;

/** Dual-Kawase upsample (added onto the next larger mip). */
export const BLOOM_UP_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 hp = uTexel * 0.5;
  vec3 sum = texture2D(tColor, vUv + vec2(-hp.x * 2.0, 0.0)).rgb;
  sum += texture2D(tColor, vUv + vec2(-hp.x, hp.y)).rgb * 2.0;
  sum += texture2D(tColor, vUv + vec2(0.0, hp.y * 2.0)).rgb;
  sum += texture2D(tColor, vUv + vec2(hp.x, hp.y)).rgb * 2.0;
  sum += texture2D(tColor, vUv + vec2(hp.x * 2.0, 0.0)).rgb;
  sum += texture2D(tColor, vUv + vec2(hp.x, -hp.y)).rgb * 2.0;
  sum += texture2D(tColor, vUv + vec2(0.0, -hp.y * 2.0)).rgb;
  sum += texture2D(tColor, vUv + vec2(-hp.x, -hp.y)).rgb * 2.0;
  gl_FragColor = vec4(sum / 12.0, 1.0);
}
`;

/**
 * Final composite → canvas: paint/scene blend, tilt-shift DOF from log
 * depth, depth-crease ink lines, bloom, Khronos-neutral tone mapping
 * (keeps the hand-tuned palette's hues), era grade (saturation, contrast,
 * split tone), paper grain, warm vignette, letterbox, fade.
 */
export const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tPaint;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform vec2 uTexel;
uniform float uFar;
uniform float uPaintMix;
uniform float uFocus;
uniform float uDof;
uniform float uDofMaxPx;
uniform float uInk;
uniform vec3 uInkColor;
uniform float uBloom;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uSplit;
uniform float uGrain;
uniform float uVignette;
uniform float uLetterbox;
uniform float uFade;
uniform vec3 uFadeColor;
varying vec2 vUv;

float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  return pow(uFar + 1.0, d) - 1.0;
}

vec3 base(vec2 uv) {
  vec3 s = texture2D(tScene, uv).rgb;
  #ifdef USE_PAINT
    vec3 p = texture2D(tPaint, uv).rgb;
    return mix(s, p, uPaintMix);
  #else
    return s;
  #endif
}

vec3 neutralToneMap(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

const vec2 POISSON[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);

void main() {
  vec3 col = base(vUv);
  float dC = texture2D(tDepth, vUv).r;

  #ifdef USE_DOF
    // Tilt-shift: blur grows with log distance from the focus depth, so a
    // low camera gets a soft foreground + background (miniature feel) and
    // a top-down view (all at one depth) stays sharp.
    float w = pow(uFar + 1.0, dC) - 1.0;
    float coc = clamp(abs(log((w + 0.01) / (uFocus + 0.01))) * uDof - 0.08, 0.0, 1.0);
    if (coc > 0.01) {
      vec3 acc = col;
      float wsum = 1.0;
      float rpx = coc * uDofMaxPx;
      for (int i = 0; i < 12; i++) {
        vec2 uv = vUv + POISSON[i] * rpx * uTexel;
        acc += base(uv);
        wsum += 1.0;
      }
      col = mix(col, acc / wsum, smoothstep(0.0, 0.35, coc));
    }
  #endif

  // Ink: creases/silhouettes in log depth (Laplacian, so smooth slopes at
  // grazing angles don't ink), drawn in umber.
  float dl = texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).r;
  float dr = texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).r;
  float du = texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).r;
  float dd = texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).r;
  float lap = abs(dl + dr + du + dd - 4.0 * dC);
  // Fade with distance past the focus: far ranges are sub-pixel relief and
  // would ink into black blotches.
  float wC = pow(uFar + 1.0, dC) - 1.0;
  float inkFar = 1.0 - smoothstep(uFocus * 1.3, uFocus * 3.2, wC);
  float ink = smoothstep(0.0016, 0.007, lap) * uInk * inkFar * (1.0 - step(0.9999, dC));
  col = mix(col, col * uInkColor, ink);

  col += texture2D(tBloom, vUv).rgb * uBloom;

  col = neutralToneMap(col * uExposure);

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSaturation);
  col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
  luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  // Split tone shifts hue only: tints are normalized to unit luminance so
  // the grade can't darken shadows or push the whole frame orange.
  vec3 sh = uShadowTint / max(dot(uShadowTint, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  vec3 hi = uHighlightTint / max(dot(uHighlightTint, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  vec3 tint = mix(sh, hi, smoothstep(0.05, 0.85, luma));
  col = mix(col, col * tint, uSplit * 0.35);
  col = clamp(col, 0.0, 1.0);

  vec3 outc = linearToSrgb(col);

  // Paper: static (screen-fixed) fibre + tooth, like pigment on paper.
  vec2 fc = gl_FragCoord.xy;
  float paper = (hash12(fc) - 0.5) * 0.5 + (vnoise(fc / 3.0) - 0.5) * 0.9 + (vnoise(fc / 45.0) - 0.5) * 0.7;
  outc *= 1.0 + paper * uGrain;

  vec2 q = vUv - 0.5;
  float vig = smoothstep(0.35, 0.95, length(q * vec2(1.25, 1.0)));
  outc = mix(outc, outc * vec3(0.62, 0.52, 0.46), vig * uVignette);

  float bar = uLetterbox * 0.11;
  float inBar = max(1.0 - smoothstep(bar - 0.002, bar, vUv.y), smoothstep(1.0 - bar, 1.0 - bar + 0.002, vUv.y));
  outc = mix(outc, vec3(0.035, 0.03, 0.03), inBar * step(0.0001, uLetterbox));

  outc = mix(outc, uFadeColor, uFade);
  gl_FragColor = vec4(outc, 1.0);
}
`;

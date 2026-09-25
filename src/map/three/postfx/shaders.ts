/**
 * GLSL for the post chain (see pipeline.ts for pass order).
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
 * Final composite → canvas: tilt-shift DOF from log depth, depth-crease ink lines, bloom, Khronos-neutral tone mapping
 * (keeps the hand-tuned palette's hues), era grade (saturation, contrast,
 * split tone), paper grain, warm vignette, letterbox, fade.
 */
export const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform vec2 uTexel;
uniform float uFar;
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
  return texture2D(tScene, uv).rgb;
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

/**
 * Painted sky dome: era-mood gradient, sun or moon glow and disc, drifting
 * brushed cloud bands and (at night) stars. It follows the camera and draws
 * first without depth, so it is only ever "behind" the world. Below the
 * horizon it resolves to the haze colour, which is also the fog colour, so
 * the curved world melts into the sky with no seam.
 */
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import type { Mood } from '../../lib/mood';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uHaze;
uniform vec3 uKeyDir;
uniform float uClouds;
uniform float uNight;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += noise(p) * a;
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  #ifdef CHRONICLE
    // Natural sky of the era (the moods), drawn as watercolour: soft
    // gradient, white cloud washes with a greyer pooled edge, a warm
    // horizon glow and a gold-rimmed sun.
    vec3 skyC = mix(uHorizon, uZenith, smoothstep(0.0, 0.45, h));
    skyC = mix(skyC, uHaze, exp(-max(h, 0.0) * 22.0) * 0.5);
    float cosS = dot(d, normalize(uKeyDir));
    skyC += uGlow * (pow(max(cosS, 0.0), 6.0) * 0.18 + pow(max(cosS, 0.0), 40.0) * 0.3);
    if (h > -0.02) {
      vec2 cp = d.xz / (h + 0.22);
      float cn = fbm(cp * vec2(0.7, 1.5) + vec2(uTime * 0.003, 0.0));
      float lo = 0.62 - uClouds * 0.2;
      float fade = smoothstep(-0.01, 0.06, h);
      float cm = smoothstep(lo, lo + 0.08, cn) * fade;
      float cedge = (smoothstep(lo - 0.01, lo + 0.03, cn) - smoothstep(lo + 0.03, lo + 0.1, cn)) * fade;
      vec3 cloudLit = mix(vec3(0.97, 0.96, 0.93), uGlow, 0.25 * pow(max(cosS, 0.0), 2.0));
      cloudLit = mix(cloudLit, mix(uHaze, uZenith, 0.3) * 1.6, uNight * 0.8); // moonlit banks at night
      skyC = mix(skyC, cloudLit, cm * 0.78);
      skyC = mix(skyC, skyC * vec3(0.78, 0.8, 0.86), cedge * 0.5);
    }
    float sunDisc = smoothstep(0.99875, 0.99905, cosS);
    float sunRim = smoothstep(0.99845, 0.99875, cosS) * (1.0 - sunDisc);
    skyC = mix(skyC, uGlow * 1.8, sunDisc);
    skyC = mix(skyC, vec3(0.2, 0.14, 0.08), sunRim * 0.7);
    skyC = mix(skyC, uHaze, 1.0 - smoothstep(-0.04, 0.02, h));
    gl_FragColor = vec4(skyC, 1.0);
    return;
  #endif

  #ifdef CLOCKWORK
    // The dark vault of the hall: warm glow around the astrolabe sun,
    // faint engraved meridians and parallels on the dome.
    vec3 vault = mix(uHaze, uZenith, smoothstep(-0.15, 0.7, h));
    float cosS = max(dot(d, normalize(uKeyDir)), 0.0);
    vault += uGlow * (pow(cosS, 4.0) * 0.18 + pow(cosS, 30.0) * 0.35);
    float lonA = atan(d.z, d.x);
    float latA = asin(clamp(h, -1.0, 1.0));
    float mer = smoothstep(0.992, 1.0, cos(lonA * 24.0));
    float par = smoothstep(0.992, 1.0, cos(latA * 36.0));
    vault += uGlow * 0.035 * (mer + par) * smoothstep(0.0, 0.3, h);
    gl_FragColor = vec4(vault, 1.0);
    return;
  #endif
  float up = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.38));
  // Haze band hugging the horizon; below the horizon, pure haze (= fog).
  col = mix(col, uHaze, exp(-up * 16.0) * 0.75);
  col = mix(col, uHaze, 1.0 - smoothstep(-0.04, 0.02, h));

  float cosA = max(dot(d, normalize(uKeyDir)), 0.0);
  float glow = pow(cosA, 6.0) * 0.35 + pow(cosA, 48.0) * 0.6;
  col += uGlow * glow * (1.0 - 0.45 * uNight);

  // Painted cloud bands: fbm on a cloud "ceiling", stretched along the
  // horizon so they read as brushed strata, lit from the key side.
  if (h > -0.02) {
    vec2 p = d.xz / (h + 0.18);
    float n = fbm(p * vec2(0.7, 2.2) + vec2(uTime * 0.004, 0.0));
    float cover = uClouds;
    float lo = 0.66 - cover * 0.28;
    // Banks sit low on the horizon, where a cinematic frame actually sees sky.
    float c = smoothstep(lo, lo + 0.14, n) * smoothstep(-0.005, 0.025, h) * (1.0 - smoothstep(0.35, 0.7, h));
    vec3 lit = mix(uHorizon * 1.08, uGlow * 1.2, pow(cosA, 2.5) * 0.9);
    vec3 shade = mix(uZenith, uHaze, 0.55) * 0.92;
    vec3 cloudCol = mix(shade, lit, smoothstep(0.35, 0.85, n));
    col = mix(col, cloudCol, c * 0.85);
  }

  // Disc: sun by day, moon by night (bloom picks up the sun).
  float disc = smoothstep(0.99955, 0.99975, cosA);
  col = mix(col, uGlow * mix(7.0, 1.6, uNight), disc);

  if (uNight > 0.01 && h > 0.0) {
    vec2 sp = d.xz / (h + 0.3) * 260.0;
    float star = step(0.9965, hash(floor(sp))) * smoothstep(0.0, 0.25, h);
    float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + hash(floor(sp) + 3.1) * 40.0);
    col += vec3(0.85, 0.9, 1.0) * star * twinkle * uNight * 0.9;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface Sky {
  mesh: Mesh;
  setMood(mood: Mood): void;
  /** Direction toward the light source in the sky (the hall's astrolabe). */
  setKeyDir(dir: Vector3): void;
  /** Keep centred on the camera; call per frame. */
  update(cameraPosition: Vector3, far: number, timeSeconds: number): void;
  dispose(): void;
}

export function createSky(style: 'painted' | 'clockwork' | 'chronicle' = 'painted'): Sky {
  const hall = style === 'clockwork';
  const chronicle = style === 'chronicle';
  // A touch of warm paper in the haze, so the distance reads as drawn;
  // the sky itself leans to a clear watercolour blue.
  const paper = new Color(0xefe3c8);
  const blue = new Color(0x5f8fc0);
  const paleBlue = new Color(0xa9c6de);
  const uniforms = {
    uZenith: { value: new Color() },
    uHorizon: { value: new Color() },
    uGlow: { value: new Color() },
    uHaze: { value: new Color() },
    uKeyDir: { value: new Vector3(0, 1, 0) },
    uClouds: { value: 0.3 },
    uNight: { value: 0 },
    uTime: { value: 0 },
  };
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    defines: hall ? { CLOCKWORK: '' } : chronicle ? { CHRONICLE: '' } : {},
  });
  const geometry = new SphereGeometry(1, 48, 24);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return {
    mesh,
    setMood(mood) {
      if (chronicle) {
        // The era's natural sky, lightly on paper.
        // Night keeps its own sky; by day the blue leads, tinted by the era.
        const day = 1 - mood.night;
        uniforms.uHaze.value.setRGB(...mood.hazeColor).lerp(paleBlue, 0.6 * day).lerp(paper, 0.1);
        uniforms.uZenith.value.setRGB(...mood.skyZenith).lerp(blue, 0.55 * day);
        uniforms.uGlow.value.setRGB(...mood.skyGlow);
        uniforms.uHorizon.value.setRGB(...mood.skyHorizon).lerp(paleBlue, 0.7 * day);
        uniforms.uKeyDir.value.set(...mood.keyDir);
        uniforms.uClouds.value = mood.clouds;
        uniforms.uNight.value = mood.night;
        return;
      }
      // The hall is a dark room lit by the era's colour, not an open sky.
      const k = hall ? 0.1 : 1;
      uniforms.uZenith.value.setRGB(...mood.skyZenith).multiplyScalar(k * 0.6);
      uniforms.uHorizon.value.setRGB(...mood.skyHorizon).multiplyScalar(k);
      uniforms.uGlow.value.setRGB(...mood.skyGlow).multiplyScalar(hall ? 0.5 : 1);
      uniforms.uHaze.value.setRGB(...mood.hazeColor).multiplyScalar(hall ? 0.16 : 1);
      if (!hall) uniforms.uKeyDir.value.set(...mood.keyDir);
      uniforms.uClouds.value = mood.clouds;
      uniforms.uNight.value = mood.night;
    },
    setKeyDir(dir) {
      uniforms.uKeyDir.value.copy(dir);
    },
    update(cameraPosition, far, timeSeconds) {
      mesh.position.copy(cameraPosition);
      mesh.scale.setScalar(far * 0.5);
      mesh.updateMatrixWorld();
      uniforms.uTime.value = timeSeconds;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

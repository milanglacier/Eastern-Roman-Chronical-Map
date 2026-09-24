/**
 * Cinematic post chain: MSAA scene render → subtle bloom (sun glints on the
 * sea, the gold frontier) → tone map + sRGB (OutputPass) → display-space
 * colour grade (gentle S-curve, cool shadows / warm highlights, a touch of
 * saturation) + vignette. Coarse-pointer devices get a lighter chain
 * (no MSAA, no bloom): real phones pay for every full-screen pass.
 */
import {
  Camera,
  HalfFloatType,
  Scene,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GradeShader = {
  name: 'EastRomanGrade',
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.24 },
    uContrast: { value: 0.22 },
    uSaturation: { value: 1.06 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uContrast;
    uniform float uSaturation;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // Gentle S-curve.
      c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
      // Split tone: cool shadows, warm highlights.
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.96, 0.99, 1.05);
      vec3 highTint = vec3(1.025, 1.0, 0.965);
      c *= mix(shadowTint, highTint, smoothstep(0.15, 0.75, l));
      // Saturation.
      l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      // Vignette (elliptical, soft).
      vec2 q = (vUv - 0.5) * vec2(1.0, 0.85);
      c *= 1.0 - uVignette * smoothstep(0.2, 0.75, length(q));
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export interface PostFx {
  render(): void;
  setSize(width: number, height: number): void;
  /** Point the chain at another scene/camera (e.g. the city view). */
  setView(scene: Scene, camera: Camera): void;
  dispose(): void;
}

export function isLowTierDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

export function createPostFx(renderer: WebGLRenderer, scene: Scene, camera: Camera): PostFx {
  const lowTier = isLowTierDevice();
  const size = renderer.getDrawingBufferSize(new Vector2());
  const target = new WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
    type: HalfFloatType,
    samples: lowTier ? 0 : 4,
  });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  let bloom: UnrealBloomPass | null = null;
  if (!lowTier) {
    // Only true HDR highlights (glints, sparkle) cross the threshold.
    bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.28, 0.55, 0.92);
    composer.addPass(bloom);
  }
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  return {
    render() {
      composer.render();
    },
    setSize(width: number, height: number) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
    setView(nextScene: Scene, nextCamera: Camera) {
      renderPass.scene = nextScene;
      renderPass.camera = nextCamera;
    },
    dispose() {
      bloom?.dispose();
      grade.dispose();
      composer.dispose();
    },
  };
}

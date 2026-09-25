/**
 * The render pipeline (no EffectComposer — every pass is explicit so
 * resolutions and variants are under control):
 *
 *   scene ──► sceneRT (HDR, MSAA, depth texture)
 *              ├─► bloom prefilter ─► dual-Kawase mip chain
 *              └─► composite: DOF + ink + bloom + tonemap + grade +
 *                  paper + vignette + letterbox ─► canvas
 *
 * Materials render linear HDR into sceneRT (three disables tone mapping for
 * render targets); the composite owns tone mapping and sRGB encoding.
 */
import {
  AdditiveBlending,
  Camera,
  Color,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  NoBlending,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedIntType,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullScreenQuad } from './fullscreenQuad';
import type { Mood } from '../../../lib/mood';
import type { QualitySettings } from './quality';
import {
  BLOOM_DOWN_FRAG,
  BLOOM_PREFILTER_FRAG,
  BLOOM_UP_FRAG,
  COMPOSITE_FRAG,
  FULLSCREEN_VERT,
} from './shaders';

/** Art-direction knobs the host animates (transitions, cinematics). */
export interface PipelineParams {
  /** Tilt-shift strength (per unit of log-depth distance from focus). */
  dof: number;
  /** View-space distance of the focus plane (the camera target). */
  focus: number;
  ink: number;
  grain: number;
  vignette: number;
  /** 0..1 cinematic bars. */
  letterbox: number;
  /** 0..1 fade to `fadeColor` (dive transitions). */
  fade: number;
  fadeColor: Color;
  /** Extra multiplier on the mood's bloom (fires, flashes). */
  bloomBoost: number;
}

export interface Pipeline {
  readonly params: PipelineParams;
  readonly settings: QualitySettings;
  setSize(width: number, height: number, pixelRatio: number): void;
  setMood(mood: Mood): void;
  setQuality(settings: QualitySettings): void;
  render(scene: Scene, camera: Camera & { far: number }): void;
  dispose(): void;
}

function rt(w: number, h: number, linear = true): WebGLRenderTarget {
  const target = new WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: linear ? LinearFilter : NearestFilter,
    magFilter: linear ? LinearFilter : NearestFilter,
    depthBuffer: false,
  });
  return target;
}

function shader(fragmentShader: string, uniforms: Record<string, { value: unknown }>, defines: Record<string, string> = {}): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  });
}

export function createPipeline(renderer: WebGLRenderer, initial: QualitySettings): Pipeline {
  let settings = initial;
  let width = 1;
  let height = 1;
  let pixelRatio = 1;

  const params: PipelineParams = {
    dof: 0.55,
    focus: 50,
    ink: 0.55,
    grain: 0.05,
    vignette: 0.55,
    letterbox: 0,
    fade: 0,
    fadeColor: new Color(0x0b0b10),
    bloomBoost: 1,
  };

  let sceneRT: WebGLRenderTarget | null = null;
  let bloomMips: WebGLRenderTarget[] = [];

  const quad = new FullScreenQuad();

  const prefilterMat = shader(BLOOM_PREFILTER_FRAG, {
    tColor: { value: null },
    uTexel: { value: new Vector2() },
    uThreshold: { value: 2.2 },
    uKnee: { value: 0.9 },
  });
  const downMat = shader(BLOOM_DOWN_FRAG, { tColor: { value: null }, uTexel: { value: new Vector2() } });
  const upMat = shader(BLOOM_UP_FRAG, { tColor: { value: null }, uTexel: { value: new Vector2() } });
  upMat.blending = AdditiveBlending;

  const compositeUniforms = {
    tScene: { value: null as unknown },
    tDepth: { value: null as unknown },
    tBloom: { value: null as unknown },
    uTexel: { value: new Vector2() },
    uFar: { value: 1500 },
    uFocus: { value: 50 },
    uDof: { value: 0.5 },
    uDofMaxPx: { value: 7 },
    uInk: { value: 0.5 },
    uInkColor: { value: new Color(0.42, 0.3, 0.24) },
    uBloom: { value: 0.3 },
    uExposure: { value: 1 },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uShadowTint: { value: new Color(0.5, 0.5, 0.5) },
    uHighlightTint: { value: new Color(0.5, 0.5, 0.5) },
    uSplit: { value: 0 },
    uGrain: { value: 0.05 },
    uVignette: { value: 0.5 },
    uLetterbox: { value: 0 },
    uFade: { value: 0 },
    uFadeColor: { value: new Color() },
  };
  let compositeMat = makeComposite();
  function makeComposite(): ShaderMaterial {
    const defines: Record<string, string> = {};
    if (settings.dof) defines.USE_DOF = '';
    return shader(COMPOSITE_FRAG, compositeUniforms as Record<string, { value: unknown }>, defines);
  }

  function disposeTargets(): void {
    sceneRT?.depthTexture?.dispose();
    sceneRT?.dispose();
    for (const m of bloomMips) m.dispose();
    sceneRT = null;
    bloomMips = [];
  }

  function buildTargets(): void {
    disposeTargets();
    const w = Math.max(1, Math.round(width * pixelRatio));
    const h = Math.max(1, Math.round(height * pixelRatio));
    sceneRT = new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      format: RGBAFormat,
      samples: settings.msaa,
      depthBuffer: true,
    });
    sceneRT.depthTexture = new DepthTexture(w, h, UnsignedIntType);
    let bw = Math.max(1, w >> 1);
    let bh = Math.max(1, h >> 1);
    for (let i = 0; i < settings.bloomLevels; i++) {
      bloomMips.push(rt(bw, bh));
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
  }

  function pass(material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    quad.material = material;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  }

  return {
    params,
    get settings() {
      return settings;
    },
    setSize(w, h, pr) {
      width = w;
      height = h;
      pixelRatio = pr;
      buildTargets();
    },
    setMood(mood) {
      const u = compositeUniforms;
      u.uExposure.value = mood.exposure;
      u.uSaturation.value = mood.saturation;
      u.uContrast.value = mood.contrast;
      u.uShadowTint.value.setRGB(...mood.shadowTint);
      u.uHighlightTint.value.setRGB(...mood.highlightTint);
      u.uSplit.value = mood.split;
      u.uBloom.value = mood.bloom;
    },
    setQuality(next) {
      settings = next;
      compositeMat.dispose();
      compositeMat = makeComposite();
      buildTargets();
    },
    render(scene, camera) {
      if (!sceneRT) buildTargets();
      const src = sceneRT!;
      renderer.setRenderTarget(src);
      renderer.clear();
      renderer.render(scene, camera);

      // Bloom.
      if (bloomMips.length) {
        prefilterMat.uniforms.tColor.value = src.texture;
        prefilterMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        pass(prefilterMat, bloomMips[0]);
        for (let i = 1; i < bloomMips.length; i++) {
          downMat.uniforms.tColor.value = bloomMips[i - 1].texture;
          downMat.uniforms.uTexel.value.set(1 / bloomMips[i - 1].width, 1 / bloomMips[i - 1].height);
          pass(downMat, bloomMips[i]);
        }
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        for (let i = bloomMips.length - 1; i > 0; i--) {
          upMat.uniforms.tColor.value = bloomMips[i].texture;
          upMat.uniforms.uTexel.value.set(1 / bloomMips[i].width, 1 / bloomMips[i].height);
          pass(upMat, bloomMips[i - 1]);
        }
        renderer.autoClear = autoClear;
      }

      const u = compositeUniforms;
      u.tScene.value = src.texture;
      u.tDepth.value = src.depthTexture;
      u.tBloom.value = bloomMips[0]?.texture ?? null;
      u.uTexel.value.set(1 / src.width, 1 / src.height);
      u.uFar.value = camera.far;
      u.uFocus.value = params.focus;
      u.uDof.value = params.dof;
      u.uDofMaxPx.value = 6 * pixelRatio;
      u.uInk.value = params.ink;
      u.uGrain.value = params.grain;
      u.uVignette.value = params.vignette;
      u.uLetterbox.value = params.letterbox;
      u.uFade.value = params.fade;
      u.uFadeColor.value.copy(params.fadeColor);
      const moodBloom = u.uBloom.value;
      u.uBloom.value = bloomMips.length ? (moodBloom * params.bloomBoost) / Math.max(1, bloomMips.length - 1) : 0;
      pass(compositeMat, null);
      u.uBloom.value = moodBloom;
    },
    dispose() {
      disposeTargets();
      quad.dispose();
      for (const m of [prefilterMat, downMat, upMat, compositeMat]) m.dispose();
    },
  };
}

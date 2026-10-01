/**
 * Performance diagnostics, off unless the URL asks (works in production builds,
 * so it can be opened on the live site):
 *
 *   ?perf        overlay: GPU, tier, render size, frame and GPU time, stalls
 *   ?perf=bench  the overlay, then a fixed benchmark (camera poses, the city
 *                view, timeline sweeps on the map with the aerial tour on and
 *                in the city view) whose JSON is shown, logged and left on
 *                `globalThis.__ercmPerf.result`
 *   &perfsync    wait for the GPU at the end of every frame, so frame times are
 *                the true cost of a frame when the browser runs without vsync
 *
 * `npm run perf` (scripts/perf.mjs) drives the benchmark from the command line.
 * GPU time comes from EXT_disjoint_timer_query_webgl2 around the whole post
 * pipeline (shadow pass, scene, bloom, composite); browsers without it show none.
 */
import type { WebGLRenderer } from 'three';
import { YEAR_MAX, YEAR_MIN } from '../../data/schema';
import { STALL_MS, createRollingWindow, isSoftwareRenderer, summarize, type TimingSummary } from '../../lib/perfStats';
import type { QualityTier } from './postfx/quality';
import type { DronePose } from './droneRig';
import { lonLatToGround } from './geo';
import type { WorldView } from './worldScene';

export type PerfMode = 'off' | 'hud' | 'bench';

export function perfModeFromUrl(): PerfMode {
  if (typeof location === 'undefined') return 'off';
  const params = new URLSearchParams(location.search);
  if (!params.has('perf')) return 'off';
  return params.get('perf') === 'bench' ? 'bench' : 'hud';
}

/** What the monitor needs from the host (MapCanvas). */
export interface PerfHost {
  renderer: WebGLRenderer;
  container: HTMLElement;
  world: WorldView;
  tier(): QualityTier;
  msaa(): number;
  year(): number;
  setYear(year: number): void;
  pause(): void;
  enterCity(view: string): void;
  leaveCity(): void;
}

export interface PerfMonitor {
  /** Bracket the frame's GPU work (the pipeline render). */
  gpuBegin(): void;
  gpuEnd(): void;
  /** Once per frame: wall time since the last frame, and the loop's own CPU time. */
  frame(frameMs: number, cpuMs: number): void;
  /** True while the benchmark runs (the host holds the quality tier still). */
  readonly benchRunning: boolean;
  dispose(): void;
}

export interface BenchSample {
  name: string;
  frame: TimingSummary;
  gpu: TimingSummary | null;
}

export interface BenchResult {
  version: 1;
  date: string;
  userAgent: string;
  gpu: string;
  software: boolean;
  tier: QualityTier;
  devicePixelRatio: number;
  pixelRatio: number;
  renderSize: [number, number];
  msaa: number;
  /** Frames waited for the GPU (`&perfsync`): frame times include all GPU work. */
  gpuSync: boolean;
  views: BenchSample[];
  sweeps: BenchSweep[];
}

export interface BenchSweep extends BenchSample {
  years: [number, number];
  longAnimationFrames: number | null;
}

const DEG = Math.PI / 180;
const at = (lon: number, lat: number, y: number, yawDeg: number, pitchDeg: number): DronePose => {
  const g = lonLatToGround(lon, lat);
  return { x: g.x, y, z: g.z, yaw: yawDeg * DEG, pitch: pitchDeg * DEG };
};

/** Fixed benchmark views on the map, from the whole Empire down to a grazing low pass. */
export const BENCH_VIEWS: Array<{ name: string; pose: DronePose }> = [
  { name: 'empire', pose: at(27, 31, 70, 0, -55) },
  { name: 'aegean-oblique', pose: at(24.6, 35.6, 26, 32, -30) },
  { name: 'dardanelles-low', pose: at(26.4, 40.15, 3.4, 52, -8) },
  { name: 'anatolia-top-down', pose: at(32, 39, 30, 0, -89) },
];
const BENCH_CITY_VIEW = 'marmara-north';
const WARMUP_FRAMES = 30;
const MEASURE_FRAMES = 120;
/** Timeline sweep speed: one year per frame (real playback is 15 a second). */
const SWEEP_YEARS_PER_FRAME = 1;

function gpuName(renderer: WebGLRenderer): string {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return String(name ?? 'unknown');
}

/** Async GPU timer: one TIME_ELAPSED query per frame, results read a few frames later. */
function createGpuTimer(renderer: WebGLRenderer) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;
  return {
    supported: !!ext,
    begin(): void {
      if (!ext || active || pending.length > 8) return;
      active = gl.createQuery();
      if (active) gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    },
    end(): void {
      if (!ext || !active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    /** Finished results since the last poll, in ms. */
    poll(): number[] {
      const out: number[] = [];
      if (!ext) return out;
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift()!;
        // A disjoint event (clock change, context switch) spoils the reading.
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
      return out;
    },
    dispose(): void {
      for (const q of pending) gl.deleteQuery(q);
      pending.length = 0;
    },
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
function roundSummary(s: TimingSummary): TimingSummary {
  return { count: s.count, p50: round1(s.p50), p95: round1(s.p95), max: round1(s.max), mean: round1(s.mean), stalls: s.stalls };
}
const fmt = (s: TimingSummary | null) => (s && s.count ? `p50 ${s.p50.toFixed(1)}  p95 ${s.p95.toFixed(1)}  max ${s.max.toFixed(0)}` : '—');

export function createPerfMonitor(host: PerfHost, mode: Exclude<PerfMode, 'off'>): PerfMonitor {
  const { renderer } = host;
  const gpu = gpuName(renderer);
  const software = isSoftwareRenderer(gpu);
  const timer = createGpuTimer(renderer);
  const gpuSync = new URLSearchParams(location.search).has('perfsync');
  const syncPixel = new Uint8Array(4);
  const frames = createRollingWindow(240);
  const gpuTimes = createRollingWindow(240);
  const cpuTimes = createRollingWindow(240);
  console.info(`[perf] GPU: ${gpu}${software ? ' (SOFTWARE RENDERER)' : ''} · tier ${host.tier()} · dpr ${window.devicePixelRatio}`);

  /* ---------------- overlay ---------------- */
  const hud = document.createElement('div');
  hud.className = 'perf-hud';
  Object.assign(hud.style, {
    position: 'absolute',
    left: '8px',
    bottom: '8px',
    zIndex: '1000',
    maxWidth: 'min(560px, calc(100% - 16px))',
    padding: '6px 8px',
    font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#f2ead8',
    background: 'rgba(12, 10, 8, 0.82)',
    borderRadius: '4px',
    whiteSpace: 'pre-wrap',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  const text = document.createElement('div');
  const warn = document.createElement('div');
  warn.style.color = '#ff8a7a';
  const benchLine = document.createElement('div');
  benchLine.style.color = '#e8c86a';
  hud.append(warn, text, benchLine);
  host.container.appendChild(hud);
  if (software) warn.textContent = 'WebGL is running on a software rasterizer: the map cannot be smooth. Check chrome://gpu.';
  else if (!timer.supported) warn.textContent = 'No GPU timer queries in this browser: GPU time unavailable.';

  const render = () => {
    const f = frames.summary();
    const g = timer.supported ? gpuTimes.summary() : null;
    const c = cpuTimes.summary();
    text.textContent = [
      gpu,
      `tier ${host.tier()} · dpr ${window.devicePixelRatio} · pr ${renderer.getPixelRatio()} · ${renderer.domElement.width}×${renderer.domElement.height} · msaa ${host.msaa()} · ${host.world.mode}`,
      `frame ${fmt(f)} ms · ${f.count ? (1000 / f.mean).toFixed(0) : '—'} fps · stalls>${STALL_MS}ms ${f.stalls}`,
      `gpu   ${fmt(g)} ms`,
      `cpu   ${fmt(c)} ms (loop)`,
    ].join('\n');
  };
  const hudTimer = window.setInterval(render, 250);

  /* ---------------- benchmark ---------------- */
  let benchRunning = false;
  let frameWaiters: Array<() => void> = [];
  const nextFrame = () => new Promise<void>((resolve) => frameWaiters.push(resolve));
  const waitFrames = async (n: number) => {
    for (let i = 0; i < n; i++) await nextFrame();
  };
  let recording: { f: number[]; g: number[] } | null = null;
  /** Frame and GPU times over the next `n` frames. */
  const record = async (n: number, each?: (i: number) => void): Promise<{ frame: number[]; gpu: number[] }> => {
    const f: number[] = [];
    const g: number[] = [];
    recording = { f, g };
    for (let i = 0; i < n; i++) {
      each?.(i);
      await nextFrame();
    }
    // Let the last GPU results arrive.
    await waitFrames(6);
    recording = null;
    return { frame: f.slice(0, n), gpu: g };
  };

  const sample = (name: string, r: { frame: number[]; gpu: number[] }): BenchSample => ({
    name,
    frame: roundSummary(summarize(r.frame)),
    gpu: timer.supported && r.gpu.length ? roundSummary(summarize(r.gpu)) : null,
  });

  async function runBench(): Promise<BenchResult> {
    benchRunning = true;
    const status = (s: string) => (benchLine.textContent = `bench: ${s}`);
    const startYear = host.year();
    const place = (pose: DronePose) => host.world.setView({ ...pose });
    host.pause();
    host.leaveCity();
    const startPose = { ...host.world.rig.drone };
    try {
      status('warming up');
      await waitFrames(90);
      const views: BenchSample[] = [];
      for (const v of BENCH_VIEWS) {
        status(v.name);
        place(v.pose);
        await waitFrames(WARMUP_FRAMES);
        views.push(sample(v.name, await record(MEASURE_FRAMES)));
      }
      /** The timeline played at one year a frame, the way playback drives it. */
      const sweep = async (name: string): Promise<BenchSweep> => {
        status(`${name} ${YEAR_MIN} → ${YEAR_MAX}`);
        host.setYear(YEAR_MIN);
        await waitFrames(WARMUP_FRAMES);
        let longFrames: number | null = null;
        let observer: PerformanceObserver | null = null;
        if (PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) {
          longFrames = 0;
          observer = new PerformanceObserver((list) => (longFrames! += list.getEntries().length));
          observer.observe({ type: 'long-animation-frame' });
        }
        const frameCount = Math.ceil((YEAR_MAX - YEAR_MIN) / SWEEP_YEARS_PER_FRAME);
        const r = await record(frameCount, (i) => host.setYear(Math.min(YEAR_MAX, YEAR_MIN + (i + 1) * SWEEP_YEARS_PER_FRAME)));
        observer?.disconnect();
        return { ...sample(name, r), years: [YEAR_MIN, YEAR_MAX], longAnimationFrames: longFrames };
      };
      const sweeps: BenchSweep[] = [];
      // On the map, with the aerial tour flying as it does during playback.
      place(BENCH_VIEWS[0].pose);
      host.world.setTour(true);
      sweeps.push(await sweep('timeline-sweep'));
      host.world.setTour(false);

      status('city view');
      host.enterCity(BENCH_CITY_VIEW);
      await waitFrames(WARMUP_FRAMES * 2);
      views.push(sample(`city:${BENCH_CITY_VIEW}`, await record(MEASURE_FRAMES)));
      sweeps.push(await sweep('timeline-sweep:city'));
      host.leaveCity();
      await waitFrames(WARMUP_FRAMES);

      const canvas = renderer.domElement;
      const result: BenchResult = {
        version: 1,
        date: new Date().toISOString(),
        userAgent: navigator.userAgent,
        gpu,
        software,
        tier: host.tier(),
        devicePixelRatio: window.devicePixelRatio,
        pixelRatio: renderer.getPixelRatio(),
        renderSize: [canvas.width, canvas.height],
        msaa: host.msaa(),
        gpuSync,
        views,
        sweeps,
      };
      return result;
    } finally {
      host.setYear(startYear);
      place(startPose);
      benchRunning = false;
    }
  }

  const globalHandle: { result: BenchResult | null; error: string | null; run: () => Promise<BenchResult> } = {
    result: null,
    error: null,
    run: async () => {
      const result = await runBench();
      globalHandle.result = result;
      return result;
    },
  };
  (globalThis as Record<string, unknown>).__ercmPerf = globalHandle;

  if (mode === 'bench') {
    void globalHandle
      .run()
      .then((result) => {
        const worst = [...result.views, ...result.sweeps].map((s) => `${s.name}: frame p50 ${s.frame.p50} p95 ${s.frame.p95} max ${s.frame.max}${s.gpu ? ` · gpu p50 ${s.gpu.p50}` : ''}`);
        benchLine.textContent = `bench done\n${worst.join('\n')}`;
        console.info('[perf] benchmark result', result);
        console.info(`[perf] ${JSON.stringify(result)}`);
      })
      .catch((err: unknown) => {
        globalHandle.error = String(err);
        benchLine.textContent = `bench failed: ${String(err)}`;
        console.error('[perf] benchmark failed', err);
      });
  }

  return {
    gpuBegin: () => timer.begin(),
    gpuEnd() {
      timer.end();
      if (gpuSync) {
        // Reading a pixel back blocks until the frame's GPU work is done.
        const gl = renderer.getContext();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel);
      }
    },
    frame(frameMs, cpuMs) {
      frames.push(frameMs);
      cpuTimes.push(cpuMs);
      for (const g of timer.poll()) {
        gpuTimes.push(g);
        recording?.g.push(g);
      }
      recording?.f.push(frameMs);
      const waiters = frameWaiters;
      frameWaiters = [];
      for (const w of waiters) w();
    },
    get benchRunning() {
      return benchRunning;
    },
    dispose() {
      window.clearInterval(hudTimer);
      timer.dispose();
      hud.remove();
      frameWaiters = [];
      delete (globalThis as Record<string, unknown>).__ercmPerf;
    },
  };
}

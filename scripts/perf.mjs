#!/usr/bin/env node
/**
 * `npm run perf`: runs the in-page benchmark (`?perf=bench`, src/map/three/perf.ts)
 * in Chrome and prints the result. No dependencies beyond vite: Chrome is driven
 * over the DevTools protocol with Node's built-in WebSocket.
 *
 *   npm run perf                          dev server + headless Chrome, quality=high
 *   npm run perf -- --headed              a visible window, synced to the display
 *   npm run perf -- --quality medium
 *   npm run perf -- --url https://…/      benchmark an already running site instead
 *   npm run perf -- --out perf.json       also write the JSON result
 *   npm run perf -- --size 1920x1080      window size (default 1600x900)
 *
 * Headless runs uncapped (no vsync, `&perfsync` waits for the GPU each frame):
 * frame times are the real cost of a frame rather than multiples of the
 * refresh interval, and the run does not stall when the display sleeps (macOS
 * stops vsync'd frames then). The GPU is still the real one; the result's `gpu`
 * field says which.
 *
 * Chrome is found via $CHROME_PATH, the usual install locations (Chrome,
 * Chromium, Edge, Brave), or PATH.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const headed = flag('headed');
const quality = option('quality', 'high');
const outPath = option('out', null);
const timeoutS = Number(option('timeout', '300'));
const [width, height] = option('size', '1600x900').split('x').map(Number);

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const known = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of known) if (existsSync(p)) return p;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim();
    } catch {
      /* not on PATH */
    }
  }
  throw new Error('Chrome not found: set CHROME_PATH');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { port: 5299, strictPort: false }, logLevel: 'warn' });
  await server.listen();
  return { url: server.resolvedUrls.local[0], close: () => server.close() };
}

async function launchChrome(url) {
  const profile = mkdtempSync(join(tmpdir(), 'ercm-perf-'));
  const chromeArgs = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--ignore-gpu-blocklist',
    '--enable-gpu',
    // Keep rAF running at full rate when the window is not focused.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--window-size=${width},${height}`,
    ...(headed ? [] : ['--headless=new', '--disable-gpu-vsync', '--disable-frame-rate-limit']),
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
    url,
  ];
  const proc = spawn(findChrome(), chromeArgs, { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error('Chrome did not start (no DevToolsActivePort)');
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  let page = null;
  for (let i = 0; i < 50 && !page; i++) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    page = targets.find((t) => t.type === 'page' && t.url.includes('perf=bench'));
    if (!page) await sleep(100);
  }
  if (!page) throw new Error('benchmark page not found');
  return {
    wsUrl: page.webSocketDebuggerUrl,
    close() {
      proc.kill();
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* Chrome may still hold files */
      }
    },
  };
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  return {
    opened,
    async evaluate(expression) {
      const msgId = ++id;
      const reply = new Promise((resolve) => waiting.set(msgId, resolve));
      ws.send(JSON.stringify({ id: msgId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
      const msg = await reply;
      return msg.result?.result?.value;
    },
    close: () => ws.close(),
  };
}

function printResult(r) {
  const row = (s) => ({
    view: s.name,
    'frame p50': s.frame.p50,
    'frame p95': s.frame.p95,
    'frame max': s.frame.max,
    stalls: s.frame.stalls,
    'gpu p50': s.gpu?.p50 ?? '—',
    'gpu p95': s.gpu?.p95 ?? '—',
  });
  console.log(`\nGPU       ${r.gpu}${r.software ? '   << SOFTWARE RENDERER' : ''}`);
  console.log(`frames    ${r.gpuSync ? 'uncapped, each frame waits for the GPU' : 'vsync'}`);
  console.log(`tier      ${r.tier} · dpr ${r.devicePixelRatio} · pixel ratio ${r.pixelRatio} · ${r.renderSize.join('×')} · msaa ${r.msaa}`);
  console.table([...r.views, ...r.sweeps].map(row));
  for (const s of r.sweeps) {
    if (s.longAnimationFrames !== null) console.log(`long animation frames during ${s.name}: ${s.longAnimationFrames}`);
  }
  if (r.software) console.warn('WebGL ran on a software rasterizer; try --headed for the real GPU.');
}

const server = option('url', null) ? null : await startServer();
const base = option('url', null) ?? server.url;
const url = new URL(base);
url.searchParams.set('perf', 'bench');
url.searchParams.set('quality', quality);
if (!headed) url.searchParams.set('perfsync', '');
console.log(`benchmarking ${url.href}${headed ? ' (headed)' : ''} …`);

let chrome = null;
let cdp = null;
let code = 0;
try {
  chrome = await launchChrome(url.href);
  cdp = connect(chrome.wsUrl);
  await cdp.opened;
  const deadline = Date.now() + timeoutS * 1000;
  let result = null;
  while (!result && Date.now() < deadline) {
    await sleep(1000);
    const state = await cdp.evaluate('JSON.stringify(globalThis.__ercmPerf ? { result: globalThis.__ercmPerf.result, error: globalThis.__ercmPerf.error } : null)');
    const parsed = state ? JSON.parse(state) : null;
    if (parsed?.error) throw new Error(`benchmark failed in the page: ${parsed.error}`);
    result = parsed?.result ?? null;
  }
  if (!result) throw new Error(`no result after ${timeoutS} s`);
  printResult(result);
  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`wrote ${outPath}`);
  }
} catch (err) {
  console.error(String(err?.message ?? err));
  code = 1;
} finally {
  cdp?.close();
  chrome?.close();
  await server?.close();
}
process.exit(code);

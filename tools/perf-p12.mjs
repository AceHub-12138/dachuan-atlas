#!/usr/bin/env node
/**
 * P1.2 动画性能对照（需要真实显示器 / 可见 Chrome）。
 *
 * 运行：HEADFUL=1 node tools/perf-p12.mjs
 *
 * 采样 P1.2 演示模式、真实快照模式、低动态、静态、架构投影和
 * 2560×1440 / 3840×2160。Headless 的 rAF 会被节流，因此本脚本默认要求
 * 非 headless 浏览器；它只读取页面自己的 __ATLAS_METRICS__。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATASET = path.join(ROOT, 'local-data', 'nexus', 'nexus-2026-10-20-2584284.atlas.json');
const SERVER = process.env.ATLAS_SERVER ?? 'http://127.0.0.1:4173';
const CDP_PORT = Number(process.env.ATLAS_CDP_PORT ?? 9338);
const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : 'google-chrome');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
    };
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('Chrome CDP WebSocket 连接失败'));
    });
    return new Cdp(ws);
  }

  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 超时`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(`页面脚本异常：${result.exceptionDetails.text}`);
    return result.result.value;
  }

  async waitFor(expression, timeout = 8000, label = expression) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(expression)) return;
      } catch {
        // Retry.
      }
      await sleep(120);
    }
    throw new Error(`等待超时：${label}`);
  }
}

async function waitForHttp(url, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry.
    }
    await sleep(120);
  }
  throw new Error(`无法访问 ${url}`);
}

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(400);
}

async function enterNexus(cdp) {
  const level = await cdp.evaluate("document.querySelector('.app')?.dataset.level");
  if (level === 'nexus') return;
  if (level === 'module') {
    await cdp.evaluate(
      "[...document.querySelectorAll('.breadcrumb button')].find((button) => button.textContent.includes('NEXUS'))?.click()",
    );
    await cdp.waitFor("document.querySelector('.app')?.dataset.level === 'nexus'", 5000, '返回 NEXUS');
    await sleep(1400);
    return;
  }
  await cdp.evaluate(
    "[...document.querySelectorAll('button')].find((button) => button.textContent.includes('进入 NEXUS 星系'))?.click()",
  );
  await cdp.waitFor("document.querySelector('.app')?.dataset.level === 'nexus'", 6000, '进入 NEXUS');
  await sleep(1600);
}

async function importDataset(cdp) {
  await cdp.evaluate("document.querySelector('.source-badge').click()");
  await cdp.waitFor("!!document.querySelector('.data-dialog')", 4000, '架构数据面板');
  const fileNode = await cdp.send('Runtime.evaluate', {
    expression: "document.querySelector('.data-file input[type=file]')",
    objectGroup: 'file',
  });
  const described = await cdp.send('DOM.describeNode', { objectId: fileNode.result.objectId });
  await cdp.send('DOM.setFileInputFiles', {
    files: [DATASET],
    backendNodeId: described.node.backendNodeId,
  });
  await cdp.waitFor(
    "document.querySelector('.source-badge')?.textContent.includes('本地快照')",
    10000,
    '本地快照导入',
  );
  await sleep(600);
  await cdp.evaluate("document.querySelector('.data-dialog .icon-button').click()");
  await sleep(400);
}

async function setMotion(cdp, label) {
  await cdp.evaluate(`(() => {
    const radio = [...document.querySelectorAll('[role=radio]')].find((node) => node.textContent.includes(${JSON.stringify(label)}));
    radio?.click();
  })()`);
  await sleep(1400);
}

async function sample(cdp, label, times = 4, interval = 1050) {
  const samples = [];
  for (let index = 0; index < times; index += 1) {
    await sleep(interval);
    const value = await cdp.evaluate('window.__ATLAS_METRICS__ ?? null');
    if (value) samples.push(value);
  }
  return summarize(label, samples);
}

async function sampleGraph(cdp, label, times = 4, interval = 1050) {
  const samples = [];
  for (let index = 0; index < times; index += 1) {
    await sleep(interval);
    const value = await cdp.evaluate('window.__ATLAS_GRAPH_METRICS__ ?? null');
    if (value) samples.push(value);
  }
  return summarize(label, samples);
}

function summarize(label, samples) {
  const numeric = (key) => samples.map((sample) => Number(sample[key])).filter((value) => Number.isFinite(value));
  const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const p95 = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  };
  const fps = numeric('fps');
  const frameMs = numeric('frameMs');
  const p95FrameMs = numeric('p95FrameMs');
  return {
    label,
    samples: samples.map((sample) => ({
      fps: sample.fps,
      frameMs: sample.frameMs,
      p95FrameMs: sample.p95FrameMs,
      width: sample.width,
      height: sample.height,
      rafActive: sample.rafActive,
      focused: sample.focused,
      motion: sample.motion,
      stars: sample.stars,
    })),
    fpsAverage: average(fps) === null ? null : Number(average(fps).toFixed(1)),
    frameMsAverage: average(frameMs) === null ? null : Number(average(frameMs).toFixed(2)),
    p95FrameMsAverage: average(p95FrameMs) === null ? null : Number(average(p95FrameMs).toFixed(2)),
    p95FrameMsMax: p95(p95FrameMs) === null ? null : Number(p95(p95FrameMs).toFixed(2)),
    rafActive: samples.every((sample) => sample.rafActive),
  };
}

async function main() {
  if (process.env.HEADFUL !== '1') {
    throw new Error('性能对照需要可见 Chrome；请使用 HEADFUL=1 node tools/perf-p12.mjs。');
  }
  if (!existsSync(DATASET)) throw new Error('缺少 local-data/nexus 快照。');
  if (!existsSync(CHROME)) throw new Error(`找不到独立 Chrome：${CHROME}`);
  await waitForHttp(SERVER);
  await mkdir(path.join(ROOT, 'docs', 'architecture'), { recursive: true });
  const work = await mkdtemp(path.join(tmpdir(), 'atlas-perf-'));
  const profile = path.join(work, 'profile');
  const chrome = spawn(
    CHROME,
    [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=CalculateNativeWinOcclusion',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--window-size=1920,1080',
      '--window-position=0,0',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp;
  const results = {
    environment: {
      platform: process.platform,
      chrome: 'Google Chrome (headful)',
      deviceScaleFactor: 1,
      note: 'FPS 与 frameMs 来自页面 __ATLAS_METRICS__；不是完整 GPU 合成链路分析。',
    },
  };
  try {
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const target = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(SERVER)}`, {
      method: 'PUT',
    }).then((response) => response.json());
    cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Page.bringToFront');
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await setViewport(cdp, 1920, 1080);
    await cdp.waitFor('document.readyState === "complete"', 10000, '页面加载');
    await sleep(900);

    await enterNexus(cdp);
    results.demoFull1920 = await sample(cdp, '演示 · 完整 · 1920×1080');

    await setMotion(cdp, '低动态');
    results.demoLow1920 = await sample(cdp, '演示 · 低动态 · 1920×1080');
    await setMotion(cdp, '静态');
    results.demoStatic1920 = await sample(cdp, '演示 · 静态 · 1920×1080', 3, 500);
    await setMotion(cdp, '完整');

    await importDataset(cdp);
    await enterNexus(cdp);
    results.realFull1920 = await sample(cdp, '真实快照 · 完整 · 1920×1080');

    await cdp.evaluate("document.querySelector('.graph-summary__primary').click()");
    await cdp.waitFor("!!document.querySelector('.graph-dialog')", 5000, '架构投影');
    await sleep(800);
    results.graphFull1920 = await sampleGraph(cdp, '架构投影 · 模块层 · 1920×1080');
    await setMotion(cdp, '静态');
    results.graphStatic1920 = await sampleGraph(cdp, '架构投影 · 静态 · 1920×1080', 3, 500);
    await cdp.evaluate("document.querySelector('.graph-dialog .icon-button').click()");
    await setMotion(cdp, '完整');
    await sleep(500);

    await setViewport(cdp, 2560, 1440);
    await sleep(1200);
    results.realFull2560 = await sample(cdp, '真实快照 · 完整 · 2560×1440');

    await setViewport(cdp, 3840, 2160);
    await sleep(1200);
    results.realFull3840 = await sample(cdp, '真实快照 · 完整 · 3840×2160');

    await writeFile(
      path.join(ROOT, 'docs', 'architecture', 'p1.2-performance.json'),
      `${JSON.stringify(results, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(results, null, 2));
  } finally {
    try {
      cdp?.ws.close();
    } catch {
      // Ignore close errors.
    }
    chrome.kill('SIGTERM');
    await sleep(400);
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[P1.2] 性能对照失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

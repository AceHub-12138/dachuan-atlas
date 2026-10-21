#!/usr/bin/env node
/**
 * P1.2 交互录屏（可见 Chrome + CDP Page.startScreencast）。
 *
 * 运行：node tools/record-p12.mjs
 *
 * 录屏只捕获页面内容，不含桌面；1920 宽屏界面以 1440×810 录制，避免
 * 应用内录屏面板截断右缘。所有操作均为本地页面交互，不上传数据。
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATASET = path.join(ROOT, 'local-data', 'nexus', 'nexus-2026-10-20-2584284.atlas.json');
const RECORDING_DIR = path.join(ROOT, 'docs', 'recording');
const SERVER = process.env.ATLAS_SERVER ?? 'http://127.0.0.1:4173';
const CDP_PORT = Number(process.env.ATLAS_CDP_PORT ?? 9340);
const WIDTH = 1440;
const HEIGHT = 810;
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
    this.events = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      const handlers = this.events.get(message.method) ?? [];
      handlers.forEach((handler) => handler(message.params));
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

  on(method, handler) {
    const handlers = this.events.get(method) ?? [];
    handlers.push(handler);
    this.events.set(method, handlers);
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
      await sleep(100);
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
    await sleep(100);
  }
  throw new Error(`无法访问 ${url}`);
}

function ensureOverlayExpression() {
  return `(() => {
    if (!document.getElementById('__atlas_cursor')) {
      const cursor = document.createElement('div');
      cursor.id = '__atlas_cursor';
      Object.assign(cursor.style, {
        position: 'fixed', left: '50%', top: '50%', width: '13px', height: '13px',
        border: '1px solid #f5a568', borderRadius: '50%',
        boxShadow: '0 0 14px rgba(245, 165, 104, 0.75)',
        background: 'rgba(245, 165, 104, 0.12)',
        zIndex: '9999', pointerEvents: 'none', transform: 'translate(-50%, -50%)',
        transition: 'left 140ms ease, top 140ms ease'
      });
      document.body.append(cursor);
      const caption = document.createElement('div');
      caption.id = '__atlas_caption';
      Object.assign(caption.style, {
        position: 'fixed', left: '50%', bottom: '64px', transform: 'translateX(-50%)',
        padding: '7px 14px', border: '1px solid rgba(238, 125, 44, 0.4)',
        background: 'rgba(4, 8, 11, 0.86)', color: 'rgba(249, 236, 222, 0.92)',
        font: '500 13px "PingFang SC", "Microsoft YaHei UI", sans-serif',
        letterSpacing: '0.04em', zIndex: '9998', pointerEvents: 'none',
        boxShadow: '0 8px 28px rgba(0, 0, 0, 0.45)'
      });
      caption.textContent = 'P1.2 · 真实架构投影';
      document.body.append(caption);
    }
  })()`;
}

async function caption(cdp, text) {
  await cdp.evaluate(`(() => {
    const node = document.getElementById('__atlas_caption');
    if (node) node.textContent = ${JSON.stringify(text)};
  })()`);
}

async function moveTo(cdp, selector) {
  await cdp.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) throw new Error('missing ${selector}');
    node.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = node.getBoundingClientRect();
    const cursor = document.getElementById('__atlas_cursor');
    if (cursor) {
      cursor.style.left = (rect.left + rect.width / 2) + 'px';
      cursor.style.top = (rect.top + rect.height / 2) + 'px';
    }
  })()`);
  await sleep(260);
}

async function click(cdp, selector) {
  await moveTo(cdp, selector);
  await cdp.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) throw new Error('missing ${selector}');
    node.click();
  })()`);
  await sleep(450);
}

async function clickText(cdp, selector, text) {
  await cdp.evaluate(`(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => item.textContent.includes(${JSON.stringify(text)}));
    if (!node) throw new Error('missing text node ${text}');
    node.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = node.getBoundingClientRect();
    const cursor = document.getElementById('__atlas_cursor');
    if (cursor) {
      cursor.style.left = (rect.left + rect.width / 2) + 'px';
      cursor.style.top = (rect.top + rect.height / 2) + 'px';
    }
  })()`);
  await sleep(280);
  await cdp.evaluate(`(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => item.textContent.includes(${JSON.stringify(text)}));
    node?.click();
  })()`);
  await sleep(450);
}

async function typeInto(cdp, selector, text) {
  await moveTo(cdp, selector);
  const rect = await cdp.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(150);
  await cdp.send('Input.insertText', { text });
  await sleep(300);
  const value = await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value ?? ''`);
  if (!value) {
    await cdp.evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(300);
  }
}

async function main() {
  if (!existsSync(DATASET)) throw new Error('缺少 local-data/nexus 快照。');
  if (!existsSync(CHROME)) throw new Error(`找不到独立 Chrome：${CHROME}`);
  await waitForHttp(SERVER);
  await mkdir(RECORDING_DIR, { recursive: true });
  const work = await mkdtemp(path.join(tmpdir(), 'atlas-record-'));
  const profile = path.join(work, 'profile');
  const framesDir = path.join(work, 'frames');
  await mkdir(framesDir, { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=CalculateNativeWinOcclusion',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT + 90}`,
      '--window-position=0,0',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp;
  const frames = [];
  let recordingStarted = false;
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
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.waitFor('document.readyState === "complete"', 10000, '页面加载');
    await sleep(1000);
    await cdp.evaluate(ensureOverlayExpression());
    await caption(cdp, 'P1.2 · 真实架构投影');
    await sleep(700);

    cdp.on('Page.screencastFrame', (params) => {
      frames.push({ data: params.data, timestamp: params.metadata?.timestamp ?? Date.now() / 1000 });
      writeFileSync(path.join(framesDir, `frame-${String(frames.length).padStart(5, '0')}.jpg`), Buffer.from(params.data, 'base64'));
      void cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 88,
      maxWidth: WIDTH,
      maxHeight: HEIGHT,
      everyNthFrame: 1,
    });
    recordingStarted = true;
    await sleep(600);

    // 1. Import local snapshot through the visible data panel.
    await caption(cdp, '1 · 打开本地数据面板');
    await click(cdp, '.source-badge');
    await cdp.waitFor("!!document.querySelector('.data-dialog')", 4000, '数据面板');
    await sleep(1000);
    await caption(cdp, '2 · 导入本地历史快照（仅本机）');
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
    await sleep(1400);
    await caption(cdp, '3 · 1,390 节点 / 3,170 关系；先看模块层');
    await click(cdp, '.data-dialog .icon-button');
    await sleep(500);
    await clickText(cdp, 'button', '进入 NEXUS 星系');
    await cdp.waitFor("document.querySelector('.app')?.dataset.level === 'nexus'", 6000, 'NEXUS');
    await sleep(1800);

    // 2. Show the real module links and the projection workspace.
    await caption(cdp, '4 · 真实跨模块连线：青=提取 · 红点=待核实');
    await sleep(2200);
    await click(cdp, '.graph-summary__primary');
    await cdp.waitFor("!!document.querySelector('.graph-dialog')", 5000, '架构投影');
    await sleep(1600);
    await caption(cdp, '5 · 模块层：3 组模块对 / 48 条关系');
    await sleep(1800);

    const dataDrillClicked = await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('.graph-node-row')].find((node) => node.textContent.includes('经营数据展示'));
      const drill = row?.querySelector('.graph-node-row__drill');
      if (!drill) return false;
      drill.click();
      return true;
    })()`);
    if (!dataDrillClicked) throw new Error('无法进入数据模块文件层级');
    await cdp.waitFor("document.querySelector('.graph-breadcrumb')?.textContent.includes('文件层级')", 5000, '文件层级');
    await sleep(1800);
    await caption(cdp, '6 · 文件层级：只展开与当前模块直接相连的文件');
    await sleep(1500);

    await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('.graph-node-row')].find((node) => node.querySelector('.graph-node-row__drill'));
      row?.querySelector('.graph-node-row__drill')?.click();
      return true;
    })()`);
    await cdp.waitFor("document.querySelector('.graph-breadcrumb')?.textContent.includes('符号层级')", 5000, '符号层级');
    await sleep(1800);
    await caption(cdp, '7 · 符号层级：仍只渲染当前可见节点');
    await sleep(1400);

    await clickText(cdp, '.graph-breadcrumb button', '全部模块');
    await sleep(700);
    await caption(cdp, '8 · 路径查询：已知节点之间的静态关系');
    await typeInto(cdp, '.graph-path__field input', '浏览器麦克风');
    await cdp.waitFor("document.querySelectorAll('.graph-path__suggestions button').length > 0", 4000, '起点建议');
    await click(cdp, '.graph-path__suggestions button');
    await sleep(500);
    await cdp.evaluate(`(() => {
      const input = document.querySelectorAll('.graph-path__field')[1]?.querySelector('input');
      if (input) { input.scrollIntoView({ block: 'center' }); input.focus(); }
    })()`);
    await typeInto(cdp, '.graph-path__field:nth-of-type(2) input', 'PCM 播放器').catch(async () => {
      await cdp.evaluate(`(() => {
        const input = document.querySelectorAll('.graph-path__field')[1]?.querySelector('input');
        if (!input) throw new Error('missing second path input');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'PCM 播放器');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    });
    await cdp.waitFor("document.querySelectorAll('.graph-path__suggestions button').length > 0", 4000, '终点建议');
    await click(cdp, '.graph-path__suggestions button');
    await sleep(400);
    await click(cdp, '.graph-path .graph-primary-action');
    await cdp.waitFor("!!document.querySelector('.graph-path__result')", 5000, '路径结果');
    await sleep(1600);
    await caption(cdp, '9 · 路径只说明静态关联，不宣称运行时顺序');
    await sleep(1600);
    await click(cdp, '.graph-dialog .icon-button');
    await sleep(500);

    // 3. Module explanation and flow with an explicit gap.
    await caption(cdp, '10 · 模块中文解释与已记录关系');
    await clickText(cdp, '.module-row', '语音交互');
    await cdp.waitFor("!!document.querySelector('.module-panel')", 5000, '语音模块');
    await sleep(1000);
    await cdp.evaluate("document.querySelector('.module-links')?.scrollIntoView({ block: 'center' })");
    await sleep(1300);
    await caption(cdp, '11 · 按流程理解：每一步都有源码来源');
    await click(cdp, '.module-flow-link');
    await cdp.waitFor("!!document.querySelector('.flow-dialog')", 5000, '按流程理解');
    await sleep(1400);
    await caption(cdp, '12 · 两个步骤衔接没有图边，明确标为缺口');
    await cdp.evaluate(`(() => {
      const gap = [...document.querySelectorAll('.flow-transition')].find((node) => node.classList.contains('flow-transition--gap'));
      gap?.click();
    })()`);
    await sleep(1800);
    await caption(cdp, '13 · 缺口不补线，也不推断运行时步骤');
    await sleep(1800);
    await click(cdp, '.flow-dialog .icon-button');
    await sleep(500);
    await click(cdp, '.module-panel .voice-panel__header .icon-button');
    await sleep(500);

    // 4. Demo regression.
    await caption(cdp, '14 · 回到演示模式：保留原星系结构');
    await click(cdp, '.source-badge');
    await cdp.waitFor("!!document.querySelector('.data-dialog')", 4000, '数据面板');
    await clickText(cdp, '.source-switch button', '演示数据');
    await sleep(700);
    await click(cdp, '.data-dialog .icon-button');
    await sleep(1200);
    await clickText(cdp, 'button', '进入 NEXUS 星系');
    await cdp.waitFor("document.querySelector('.app')?.dataset.level === 'nexus'", 5000, '演示 NEXUS');
    await sleep(2000);
    await caption(cdp, 'P1.2 · 演示模式与真实投影均可运行');
    await sleep(1800);

    await cdp.send('Page.stopScreencast');
    recordingStarted = false;
    await sleep(500);

    if (frames.length < 30) throw new Error(`录屏帧数过少：${frames.length}`);
    const first = frames[0].timestamp;
    const last = frames[frames.length - 1].timestamp;
    const duration = Math.max(1, last - first);
    const captureFps = frames.length / duration;
    const fps = 30;
    const webm = path.join(RECORDING_DIR, 'dachuan-atlas-p12-demo.webm');
    const mp4 = path.join(RECORDING_DIR, 'dachuan-atlas-p12-demo.mp4');
    const inputPattern = path.join(framesDir, 'frame-%05d.jpg');

    const encode = (args) => {
      const result = spawnSync('ffmpeg', args, { stdio: 'ignore' });
      if (result.status !== 0) throw new Error(`ffmpeg 失败：${args.join(' ')}`);
    };
    encode([
      '-y', '-framerate', captureFps.toFixed(3), '-i', inputPattern,
      '-vf', 'fps=30', '-r', '30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4,
    ]);
    encode([
      '-y', '-framerate', captureFps.toFixed(3), '-i', inputPattern,
      '-vf', 'fps=30', '-r', '30',
      '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', webm,
    ]);

    const metadata = {
      title: 'DACHUAN ATLAS P1.2 真实架构投影演示',
      viewport: `${WIDTH}×${HEIGHT}`,
      frames: frames.length,
      captureFps: Number(captureFps.toFixed(2)),
      outputFps: fps,
      durationSeconds: Number(duration.toFixed(2)),
      mp4: path.relative(ROOT, mp4),
      webm: path.relative(ROOT, webm),
      note: '录屏由 CDP Page.startScreencast 捕获页面内容；光标与底部说明为录制时注入的演示层，不属于产品界面。',
    };
    await writeFile(path.join(RECORDING_DIR, 'P1.2-RECORDING.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(JSON.stringify(metadata, null, 2));
  } finally {
    if (recordingStarted) {
      try {
        await cdp?.send('Page.stopScreencast');
      } catch {
        // Ignore.
      }
    }
    try {
      cdp?.ws.close();
    } catch {
      // Ignore.
    }
    chrome.kill('SIGTERM');
    await sleep(500);
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[P1.2] 录屏失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

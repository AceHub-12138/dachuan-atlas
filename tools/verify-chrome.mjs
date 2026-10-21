#!/usr/bin/env node
/**
 * 独立 Google Chrome 验收脚本（CDP，不依赖内置浏览器）。
 *
 * 前置：npm run build && npm run preview
 * 运行：node tools/verify-chrome.mjs
 *
 * 实际执行：本地 .atlas.json 文件导入 → 四模块详情 → 关系搜索/筛选 →
 * 导出 → 重新导入 → 截图。不会上传任何数据。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATASET = path.join(ROOT, 'local-data', 'nexus', 'nexus-2026-10-20-2584284.atlas.json');
const SCREENSHOTS = path.join(ROOT, 'docs', 'screenshots');
const SERVER = process.env.ATLAS_SERVER ?? 'http://127.0.0.1:4173';
const CDP_PORT = Number(process.env.ATLAS_CDP_PORT ?? 9334);
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

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 超时`));
      }, 10000);
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
    if (result.exceptionDetails) {
      throw new Error(`页面脚本异常：${result.exceptionDetails.text}`);
    }
    return result.result.value;
  }

  async waitFor(expression, timeout = 8000, label = expression) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(expression)) return;
      } catch {
        // Page may be between navigations; retry until deadline.
      }
      await sleep(120);
    }
    throw new Error(`等待超时：${label}`);
  }

  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(file, Buffer.from(data, 'base64'));
  }
}

async function waitForHttp(url, timeout = 8000) {
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

async function main() {
  if (!existsSync(DATASET)) {
    throw new Error('缺少 local-data/nexus 快照；请先运行 npm run import:graphify。');
  }
  if (!existsSync(CHROME)) {
    throw new Error(`找不到独立 Chrome：${CHROME}。可通过 CHROME_PATH 指定。`);
  }
  await waitForHttp(SERVER);
  await mkdir(SCREENSHOTS, { recursive: true });
  const work = await mkdtemp(path.join(tmpdir(), 'atlas-chrome-'));
  const profile = path.join(work, 'profile');
  const downloads = path.join(work, 'downloads');
  await mkdir(downloads, { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp;
  const consoleErrors = [];
  try {
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const target = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(SERVER)}`, {
      method: 'PUT',
    }).then((response) => response.json());
    cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    cdp.on('Runtime.exceptionThrown', (event) => consoleErrors.push(event.exceptionDetails?.text ?? 'exception'));
    cdp.on('Log.entryAdded', (event) => {
      if (event.entry?.level === 'error') consoleErrors.push(event.entry.text);
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloads,
      eventsEnabled: true,
    });
    await cdp.waitFor('document.readyState === "complete"', 10000, '页面加载');
    await sleep(900);

    // 1. Open data panel and import the local file.
    await cdp.evaluate("document.querySelector('.source-badge').click()");
    await cdp.waitFor("!!document.querySelector('.data-dialog')", 4000, '架构数据面板');
    const fileNode = await cdp.send('Runtime.evaluate', {
      expression: "document.querySelector('.data-file input[type=file]')",
      objectGroup: 'file',
    });
    const described = await cdp.send('DOM.describeNode', {
      objectId: fileNode.result.objectId,
    });
    await cdp.send('DOM.setFileInputFiles', {
      files: [DATASET],
      backendNodeId: described.node.backendNodeId,
    });
    await cdp.waitFor(
      "document.querySelector('.source-badge')?.textContent.includes('本地快照')",
      8000,
      '本地快照导入',
    );
    await cdp.waitFor("document.querySelector('.data-summary h3')?.textContent.includes('NEXUS')", 4000, '快照摘要');
    await sleep(700);
    const imported = await cdp.evaluate(`(() => ({
      badge: document.querySelector('.source-badge')?.textContent,
      summary: document.querySelector('.data-summary h3')?.textContent,
      detail: document.querySelector('.data-summary p')?.textContent,
      counts: [...document.querySelectorAll('.data-counts strong')].map((node) => node.textContent),
      reviewLabel: [...document.querySelectorAll('.data-review-provenance dt')].map((node) => node.textContent),
      privacy: document.querySelector('.data-privacy')?.textContent,
      containsHumanClaim: document.body.textContent.includes('人工核实关系'),
      containsAiReview: document.body.textContent.includes('AI 源码复核'),
    }))()`);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.1-01-local-import-1920x1080.png'));

    // 2. Four module details.
    await cdp.evaluate("document.querySelector('.data-dialog .icon-button').click()");
    await sleep(350);
    await cdp.evaluate(
      "[...document.querySelectorAll('button')].find((button) => button.textContent.includes('进入 NEXUS 星系'))?.click()",
    );
    await sleep(1700);

    const moduleNames = ['经营数据展示', '语音交互', '动画调度', 'Canvas 渲染'];
    const moduleShots = [];
    for (const [index, name] of moduleNames.entries()) {
      await cdp.evaluate(
        `[...document.querySelectorAll('.module-row')].find((button) => button.textContent.includes(${JSON.stringify(name)}))?.click()`,
      );
      await cdp.waitFor("!!document.querySelector('.module-panel')", 4000, `${name} 详情`);
      await sleep(650);
      const summary = await cdp.evaluate(`(() => ({
        title: document.querySelector('.module-panel h2')?.textContent,
        what: document.querySelector('.module-panel .voice-purpose')?.textContent,
        components: [...document.querySelectorAll('.module-component__main strong')].map((node) => node.textContent),
        composition: document.querySelector('.module-review-box strong')?.textContent,
        reviewCounts: document.querySelector('.module-review-counts')?.textContent,
        gaps: [...document.querySelectorAll('.module-gaps li')].map((node) => node.textContent),
        hasEvidence: !!document.querySelector('.module-evidence'),
      }))()`);
      const file = path.join(SCREENSHOTS, `P1.1-0${index + 2}-module-${index + 1}-1920x1080.png`);
      await cdp.screenshot(file);
      moduleShots.push({ name, summary, file: path.relative(ROOT, file) });
      await cdp.evaluate("document.querySelector('.module-panel .voice-panel__header .icon-button').click()");
      await sleep(450);
    }

    // 3. Relation explorer: module → file → symbol → relations.
    await cdp.evaluate(
      "[...document.querySelectorAll('.module-row')].find((button) => button.textContent.includes('语音交互'))?.click()",
    );
    await cdp.waitFor("!!document.querySelector('.module-panel')", 4000, '语音详情');
    await cdp.evaluate("document.querySelector('.module-explorer-link').click()");
    await cdp.waitFor("!!document.querySelector('.explorer-dialog')", 4000, '关系探索');
    await sleep(500);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.1-06-relation-files-1920x1080.png'));

    await cdp.evaluate(`(() => {
      const input = document.querySelector('.explorer-search input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '浏览器麦克风');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await cdp.waitFor("document.querySelectorAll('.explorer-row').length > 0", 4000, '中文搜索');
    await sleep(300);
    const searchNames = await cdp.evaluate(
      "[...document.querySelectorAll('.explorer-row strong')].slice(0, 5).map((node) => node.textContent)",
    );
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.1-07-relation-search-1920x1080.png'));

    await cdp.evaluate("document.querySelector('.explorer-row').click()");
    await cdp.waitFor("document.querySelectorAll('.explorer-relation-list > li').length > 0", 4000, '关系列表');
    await sleep(300);
    const relationInfo = await cdp.evaluate(`(() => ({
      rows: document.querySelectorAll('.explorer-relation-list > li').length,
      reviews: [...document.querySelectorAll('.explorer-review')].map((node) => node.textContent),
      evidence: [...document.querySelectorAll('.explorer-relation-meta code')].slice(0, 5).map((node) => node.textContent),
      warning: document.querySelector('.explorer-warning')?.textContent,
    }))()`);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.1-08-relation-list-1920x1080.png'));

    // Pick a symbol with AI-reviewed relations: data module → 大屏舞台 → AI filter.
    await cdp.evaluate(`(() => {
      const moduleSelect = document.querySelector('.explorer-toolbar select');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(moduleSelect, 'data');
      moduleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(350);
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.explorer-search input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '大屏舞台');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await cdp.waitFor("document.querySelectorAll('.explorer-row').length > 0", 4000, '数据模块搜索');
    await cdp.evaluate("document.querySelector('.explorer-row').click()");
    await cdp.waitFor("document.querySelectorAll('.explorer-relation-list > li').length > 0", 4000, '大屏舞台关系');
    await cdp.evaluate(`(() => {
      const label = [...document.querySelectorAll('.explorer-filters label')].find((node) => node.textContent.includes('审核'));
      const select = label.querySelector('select');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'ai');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(400);
    const aiFilter = await cdp.evaluate(`(() => ({
      selected: [...document.querySelectorAll('.explorer-filters select')].map((node) => node.value),
      rows: document.querySelectorAll('.explorer-relation-list > li').length,
      reviews: [...document.querySelectorAll('.explorer-review')].map((node) => node.textContent),
      empty: document.querySelector('.explorer-empty')?.textContent ?? null,
    }))()`);
    if (!aiFilter.rows) throw new Error('AI 复核筛选没有返回关系');
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.1-09-relation-ai-filter-1920x1080.png'));

    // 4. Export and re-import.
    await cdp.evaluate("document.querySelector('.explorer-dialog .icon-button').click()");
    await sleep(300);
    await cdp.evaluate("document.querySelector('.module-panel .voice-panel__header .icon-button').click()");
    await sleep(300);
    await cdp.evaluate("document.querySelector('.source-badge').click()");
    await cdp.waitFor("!!document.querySelector('.data-dialog')", 4000, '数据面板重新打开');
    await cdp.evaluate("document.querySelector('.data-actions button.secondary-action').click()");
    let downloaded = null;
    for (let attempt = 0; attempt < 30 && !downloaded; attempt += 1) {
      const entries = await readdir(downloads);
      downloaded = entries.find((entry) => entry.endsWith('.atlas.json')) ?? null;
      if (!downloaded) await sleep(200);
    }
    if (!downloaded) throw new Error('导出文件未生成');
    const exportedText = await readFile(path.join(downloads, downloaded), 'utf8');
    const exportedCounts = JSON.parse(exportedText);
    const fileNode2 = await cdp.send('Runtime.evaluate', {
      expression: "document.querySelector('.data-file input[type=file]')",
      objectGroup: 'file2',
    });
    const described2 = await cdp.send('DOM.describeNode', { objectId: fileNode2.result.objectId });
    await cdp.send('DOM.setFileInputFiles', {
      files: [path.join(downloads, downloaded)],
      backendNodeId: described2.node.backendNodeId,
    });
    await cdp.waitFor(
      `document.querySelector('.data-notice--import')?.textContent.includes(${JSON.stringify(downloaded)})`,
      8000,
      '导出文件重新导入',
    );
    await sleep(500);
    const reimported = await cdp.evaluate(`(() => ({
      notice: document.querySelector('.data-notice--import')?.textContent,
      summary: document.querySelector('.data-summary h3')?.textContent,
      counts: [...document.querySelectorAll('.data-counts strong')].map((node) => node.textContent),
      review: document.querySelector('.data-review-provenance')?.textContent,
    }))()`);

    const metrics = await cdp.evaluate('window.__ATLAS_METRICS__');
    const resources = await cdp.evaluate(
      "performance.getEntriesByType('resource').filter((entry) => entry.name.includes('.atlas.json')).map((entry) => entry.name)",
    );

    const summary = {
      chrome: 'Google Chrome 155.0.8059.85 (headless, independent)',
      note: 'Headless Chrome FPS is throttled; use it for functional verification, not performance baselines.',
      imported,
      moduleShots,
      searchNames,
      relationInfo,
      aiFilter,
      export: {
        file: downloaded,
        nodes: exportedCounts.nodes?.length,
        relations: exportedCounts.relations?.length,
        schemaVersion: exportedCounts.schemaVersion,
      },
      reimported,
      metrics,
      atlasNetworkRequests: resources,
      consoleErrors,
    };
    await writeFile(path.join(ROOT, 'docs', 'architecture', 'p1.1-chrome-verification.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    try {
      cdp?.ws.close();
    } catch {
      // Ignore close errors.
    }
    chrome.kill('SIGTERM');
    await sleep(300);
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[P1.1] 独立 Chrome 验收失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

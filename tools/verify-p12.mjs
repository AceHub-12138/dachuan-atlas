#!/usr/bin/env node
/**
 * P1.2 独立 Chrome 验收（CDP）。
 *
 * 实际执行：本地 .atlas.json 导入 → 模块真实连线 → 架构投影模块/文件/符号
 * → 关系筛选 → 路径查询 → 按流程理解 → 演示模式回归 → 1440p / 4K → 导出重导入。
 *
 * 前置：npm run build && npm run preview
 * 运行：node tools/verify-p12.mjs
 * 可选：HEADFUL=1 node tools/verify-p12.mjs（用于性能与视觉验收）
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
const CDP_PORT = Number(process.env.ATLAS_CDP_PORT ?? 9336);
const HEADFUL = process.env.HEADFUL === '1';
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
  await sleep(350);
}

async function setInputValue(cdp, selector, value) {
  await cdp.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) throw new Error('missing input ${selector}');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function selectOption(cdp, selector, value) {
  await cdp.evaluate(`(() => {
    const select = document.querySelector(${JSON.stringify(selector)});
    if (!select) throw new Error('missing select ${selector}');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function importDataset(cdp) {
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
    10000,
    '本地快照导入',
  );
  await sleep(600);
  await cdp.evaluate("document.querySelector('.data-dialog .icon-button').click()");
  await sleep(300);
}

async function openNexus(cdp) {
  const level = await cdp.evaluate("document.querySelector('.app')?.dataset.level");
  if (level === 'nexus') return;
  if (level === 'module') {
    await cdp.evaluate(
      "[...document.querySelectorAll('.breadcrumb button')].find((button) => button.textContent.includes('NEXUS'))?.click()",
    );
    await cdp.waitFor(
      "document.querySelector('.app')?.dataset.level === 'nexus'",
      5000,
      '返回 NEXUS 模块星系',
    );
    await sleep(1600);
    return;
  }
  await cdp.evaluate(
    "[...document.querySelectorAll('button')].find((button) => button.textContent.includes('进入 NEXUS 星系'))?.click()",
  );
  await cdp.waitFor(
    "document.querySelector('.app')?.dataset.level === 'nexus'",
    6000,
    '进入 NEXUS 模块星系',
  );
  await sleep(1800);
}

async function main() {
  if (!existsSync(DATASET)) throw new Error('缺少 local-data/nexus 快照。');
  if (!existsSync(CHROME)) throw new Error(`找不到独立 Chrome：${CHROME}`);
  await waitForHttp(SERVER);
  await mkdir(SCREENSHOTS, { recursive: true });
  const work = await mkdtemp(path.join(tmpdir(), 'atlas-p12-'));
  const profile = path.join(work, 'profile');
  const downloads = path.join(work, 'downloads');
  await mkdir(downloads, { recursive: true });

  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=CalculateNativeWinOcclusion',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1920,1080',
    '--window-position=0,0',
  ];
  if (!HEADFUL) args.unshift('--headless=new', '--disable-gpu');
  const chrome = spawn(CHROME, [...args, 'about:blank'], { stdio: 'ignore' });

  let cdp;
  const consoleErrors = [];
  const summary = { headful: HEADFUL };
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
    await cdp.send('Page.bringToFront');
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloads,
      eventsEnabled: true,
    });
    await setViewport(cdp, 1920, 1080);
    await cdp.waitFor('document.readyState === "complete"', 10000, '页面加载');
    await sleep(900);

    // 1. Import local snapshot and enter NEXUS.
    await importDataset(cdp);
    const imported = await cdp.evaluate(`(() => ({
      badge: document.querySelector('.source-badge')?.textContent,
      schemaFlow: null,
    }))()`);
    await openNexus(cdp);
    await cdp.waitFor("!!document.querySelector('.graph-summary')", 6000, '真实投影摘要');
    const summaryText = await cdp.evaluate("document.querySelector('.graph-summary')?.textContent ?? ''");
    const graphSummary = {
      text: summaryText.replace(/\\s+/g, ' ').trim(),
      toggle: await cdp.evaluate("document.querySelector('.graph-summary__toggle')?.getAttribute('aria-pressed')"),
    };
    if (!summaryText.includes('真实关系投影')) throw new Error('NEXUS 没有显示真实关系投影摘要');
    if (!summaryText.includes('48')) throw new Error('投影摘要没有显示 48 条跨模块关系');
    if (!summaryText.includes('待核实')) throw new Error('投影摘要没有待核实提示');
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.2-01-nexus-real-1920x1080.png'));

    // 2. Toggle real links off and back on.
    await cdp.evaluate("document.querySelector('.graph-summary__toggle').click()");
    await sleep(500);
    const toggledOff = await cdp.evaluate("document.querySelector('.graph-summary__toggle')?.getAttribute('aria-pressed')");
    await cdp.evaluate("document.querySelector('.graph-summary__toggle').click()");
    await sleep(400);

    // 3. Open the graph workspace at module level.
    await cdp.evaluate("document.querySelector('.graph-summary__primary').click()");
    await cdp.waitFor("!!document.querySelector('.graph-dialog')", 5000, '架构投影');
    await sleep(1400);
    const moduleLevel = await cdp.evaluate(`(() => {
      const canvas = document.querySelector('.graph-stage__canvas');
      return {
        nodes: canvas?.dataset.nodes,
        edges: canvas?.dataset.edges,
        breadcrumb: document.querySelector('.graph-breadcrumb')?.textContent?.replace(/\\s+/g, ' ').trim(),
        banner: document.querySelector('.graph-stage__banner')?.textContent?.replace(/\\s+/g, ' ').trim(),
        nodeRows: [...document.querySelectorAll('.graph-node-row__main strong')].map((node) => node.textContent),
        legend: document.querySelector('.graph-legend')?.textContent?.replace(/\\s+/g, ' ').trim(),
      };
    })()`);
    if (moduleLevel.nodes !== '4' || moduleLevel.edges !== '3') {
      throw new Error(`模块投影节点/边数量异常：${moduleLevel.nodes}/${moduleLevel.edges}`);
    }
    const moduleGraphMetrics = await cdp.evaluate('window.__ATLAS_GRAPH_METRICS__ ?? null');
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.2-02-graph-modules-1920x1080.png'));

    // 4. Drill into data files, then a file's symbols.
    await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('.graph-node-row')].find((node) => node.textContent.includes('经营数据展示'));
      row?.querySelector('.graph-node-row__drill')?.click();
    })()`);
    await cdp.waitFor(
      "document.querySelector('.graph-breadcrumb')?.textContent.includes('文件层级')",
      5000,
      '文件层级',
    );
    await sleep(1500);
    const fileLevel = await cdp.evaluate(`(() => {
      const canvas = document.querySelector('.graph-stage__canvas');
      return {
        nodes: canvas?.dataset.nodes,
        edges: canvas?.dataset.edges,
        breadcrumb: document.querySelector('.graph-breadcrumb')?.textContent?.replace(/\\s+/g, ' ').trim(),
        omitted: document.querySelector('.graph-stage__omitted')?.textContent ?? null,
      };
    })()`);
    if (Number(fileLevel.nodes) > 9) throw new Error(`文件层级渲染了 ${fileLevel.nodes} 个节点`);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.2-03-graph-files-1920x1080.png'));

    await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('.graph-node-row')].find((node) => node.querySelector('.graph-node-row__drill'));
      row?.querySelector('.graph-node-row__drill')?.click();
    })()`);
    await cdp.waitFor(
      "document.querySelector('.graph-breadcrumb')?.textContent.includes('符号层级')",
      5000,
      '符号层级',
    );
    await sleep(1500);
    const symbolLevel = await cdp.evaluate(`(() => {
      const canvas = document.querySelector('.graph-stage__canvas');
      return {
        nodes: canvas?.dataset.nodes,
        edges: canvas?.dataset.edges,
        breadcrumb: document.querySelector('.graph-breadcrumb')?.textContent?.replace(/\\s+/g, ' ').trim(),
      };
    })()`);
    if (Number(symbolLevel.nodes) > 14) throw new Error(`符号层级渲染了 ${symbolLevel.nodes} 个节点`);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.2-04-graph-symbols-1920x1080.png'));

    // 5. Path query between two known nodes.
    await cdp.evaluate("document.querySelector('.graph-dialog .icon-button').click()");
    await sleep(300);
    await cdp.evaluate("document.querySelector('.graph-summary__primary').click()");
    await cdp.waitFor("!!document.querySelector('.graph-dialog')", 5000, '架构投影重新打开');
    await sleep(800);
    const pathInputs = await cdp.evaluate("document.querySelectorAll('.graph-path__field input').length");
    if (pathInputs !== 2) throw new Error('路径查询输入框数量异常');
    await setInputValue(cdp, '.graph-path__field input', '浏览器麦克风');
    await cdp.waitFor("document.querySelectorAll('.graph-path__suggestions button').length > 0", 4000, '起点建议');
    await cdp.evaluate("document.querySelector('.graph-path__suggestions button').click()");
    await sleep(250);
    await cdp.evaluate(`(() => {
      const input = document.querySelectorAll('.graph-path__field')[1]?.querySelector('input');
      if (!input) throw new Error('missing second path input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'PCM 播放器');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await cdp.waitFor("document.querySelectorAll('.graph-path__suggestions button').length > 0", 4000, '终点建议');
    await cdp.evaluate("document.querySelector('.graph-path__suggestions button').click()");
    await sleep(250);
    await cdp.evaluate("document.querySelector('.graph-path .graph-primary-action').click()");
    await cdp.waitFor(
      "!!document.querySelector('.graph-path__result, .graph-path__empty')",
      5000,
      '路径结果',
    );
    const pathResult = await cdp.evaluate(`(() => ({
      text: document.querySelector('.graph-path__result, .graph-path__empty')?.textContent?.replace(/\\s+/g, ' ').trim(),
      steps: document.querySelectorAll('.graph-path__result li').length,
      note: document.querySelector('.graph-path__result > p')?.textContent ?? null,
    }))()`);
    if (!pathResult.text?.includes('找到')) throw new Error('已知节点之间没有找到路径');
    if (!pathResult.note?.includes('不表示运行时调用顺序')) throw new Error('路径结果缺少静态关系声明');
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.2-05-path-query-1920x1080.png'));

    // 6. No-path message with an impossible filter (no human-reviewed relations).
    const filterSelects = await cdp.evaluate("document.querySelectorAll('.graph-filters select').length");
    if (filterSelects !== 3) throw new Error('关系筛选控件数量异常');
    await cdp.evaluate(`(() => {
      const select = document.querySelectorAll('.graph-filters select')[1];
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'human');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(350);
    await cdp.evaluate("document.querySelector('.graph-path .graph-primary-action').click()");
    await cdp.waitFor(
      "!!document.querySelector('.graph-path__empty')",
      5000,
      '无路径提示',
    );
    const noPath = await cdp.evaluate("document.querySelector('.graph-path__empty')?.textContent?.replace(/\\s+/g, ' ').trim()");
    if (!noPath?.includes('当前图谱未发现关系路径')) throw new Error('没有显示“当前图谱未发现关系路径”');
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.2-06-no-path-1920x1080.png'));

    // 7. Graph metrics and close.
    await cdp.evaluate("document.querySelector('.graph-dialog .icon-button').click()");
    await sleep(350);

    // 8. Voice module real relation section and flow.
    await cdp.evaluate(
      "[...document.querySelectorAll('.module-row')].find((button) => button.textContent.includes('语音交互'))?.click()",
    );
    await cdp.waitFor("!!document.querySelector('.module-panel')", 5000, '语音模块详情');
    await sleep(600);
    const modulePanel = await cdp.evaluate(`(() => ({
      links: document.querySelector('.module-links')?.textContent?.replace(/\\s+/g, ' ').trim(),
      flow: !!document.querySelector('.module-flow-link'),
      graphButton: !!document.querySelector('.module-explorer-link--graph'),
    }))()`);
    if (!modulePanel.links?.includes('与哪些模块有已记录关系')) throw new Error('模块详情缺少跨模块关系');
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.2-07-module-relations-1920x1080.png'));
    await cdp.evaluate("document.querySelector('.module-links')?.scrollIntoView({ block: 'center' })");
    await sleep(450);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.2-07b-module-links-1920x1080.png'));

    await cdp.evaluate("document.querySelector('.module-flow-link').click()");
    await cdp.waitFor("!!document.querySelector('.flow-dialog')", 5000, '按流程理解');
    await sleep(500);
    const flow = await cdp.evaluate(`(() => ({
      steps: document.querySelectorAll('.flow-step').length,
      transitions: [...document.querySelectorAll('.flow-transition')].map((node) => node.textContent.trim()),
      gaps: document.querySelectorAll('.flow-transition--gap').length,
      summary: document.querySelector('.flow-summary')?.textContent?.replace(/\\s+/g, ' ').trim(),
      footer: document.querySelector('.flow-dialog__foot')?.textContent?.replace(/\\s+/g, ' ').trim(),
    }))()`);
    if (flow.steps !== 7) throw new Error(`流程步骤数量异常：${flow.steps}`);
    if (flow.gaps !== 2) throw new Error(`流程缺口数量异常：${flow.gaps}`);
    await cdp.evaluate(`(() => {
      const gap = [...document.querySelectorAll('.flow-transition')].find((node) => node.classList.contains('flow-transition--gap'));
      gap?.click();
    })()`);
    await cdp.waitFor("!!document.querySelector('.flow-gap-note')", 4000, '缺口详情');
    const gapDetail = await cdp.evaluate("document.querySelector('.flow-gap-note')?.textContent?.replace(/\\s+/g, ' ').trim()");
    if (!gapDetail?.includes('明确的图谱缺口')) throw new Error('流程缺口详情缺少明确提示');
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.2-08-flow-gap-1920x1080.png'));

    await cdp.evaluate("document.querySelector('.flow-dialog .icon-button').click()");
    await sleep(300);
    await cdp.evaluate("document.querySelector('.module-panel .voice-panel__header .icon-button').click()");
    await sleep(300);

    // 9. Export and re-import includes flows and Schema 1.2.
    await cdp.evaluate("document.querySelector('.source-badge').click()");
    await cdp.waitFor("!!document.querySelector('.data-dialog')", 4000, '数据面板重新打开');
    await cdp.evaluate("document.querySelector('.data-actions button.secondary-action').click()");
    let downloaded = null;
    for (let attempt = 0; attempt < 40 && !downloaded; attempt += 1) {
      const entries = await readdir(downloads);
      downloaded = entries.find((entry) => entry.endsWith('.atlas.json')) ?? null;
      if (!downloaded) await sleep(200);
    }
    if (!downloaded) throw new Error('导出文件未生成');
    const exported = JSON.parse(await readFile(path.join(downloads, downloaded), 'utf8'));
    const exportInfo = {
      file: downloaded,
      schemaVersion: exported.schemaVersion,
      flows: exported.flows?.length ?? 0,
      steps: exported.flows?.[0]?.steps?.length ?? 0,
      nodes: exported.nodes?.length,
      relations: exported.relations?.length,
    };
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

    // 10. Back to demo for regression.
    await cdp.evaluate(`(() => {
      const tab = [...document.querySelectorAll('.source-switch button')].find((node) => node.textContent.includes('演示数据'));
      tab?.click();
    })()`);
    await sleep(500);
    await cdp.evaluate("document.querySelector('.data-dialog .icon-button').click()");
    await sleep(500);
    await openNexus(cdp);
    await cdp.waitFor("!!document.querySelector('.graph-summary--demo')", 5000, '演示模式回归');
    const demoSummary = await cdp.evaluate("document.querySelector('.graph-summary--demo')?.textContent?.replace(/\\s+/g, ' ').trim()");
    if (!demoSummary?.includes('保留 P0.1 原有星系结构')) throw new Error('演示模式回归摘要异常');
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.2-09-demo-regression-1920x1080.png'));

    // 11. Restore snapshot for responsive screenshots.
    await cdp.evaluate("document.querySelector('.source-badge').click()");
    await cdp.waitFor("!!document.querySelector('.data-dialog')", 4000, '数据面板');
    await cdp.evaluate(`(() => {
      const tab = [...document.querySelectorAll('.source-switch button')].find((node) => node.textContent.includes('本地历史快照'));
      tab?.click();
    })()`);
    await cdp.waitFor(
      "document.querySelector('.source-badge')?.textContent.includes('本地快照')",
      5000,
      '恢复本地快照',
    );
    await sleep(500);
    await cdp.evaluate("document.querySelector('.data-dialog .icon-button').click()");
    await sleep(400);
    await openNexus(cdp);

    await setViewport(cdp, 1440, 810);
    await sleep(900);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.2-10-nexus-real-1440x810.png'));
    const layout1440 = await cdp.evaluate(`(() => {
      const box = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
      };
      return {
        intro: box(document.querySelector('.nexus-intro')),
        summary: box(document.querySelector('.graph-summary')),
        rail: box(document.querySelector('.bottom-rail')),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    })()`);
    await cdp.evaluate("document.querySelector('.graph-summary__primary').click()");
    await cdp.waitFor("!!document.querySelector('.graph-dialog')", 5000, '1440 架构投影');
    await sleep(900);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.2-11-graph-1440x810.png'));
    const graph1440 = await cdp.evaluate(`(() => {
      const rect = document.querySelector('.graph-dialog')?.getBoundingClientRect();
      return {
        dialog: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    })()`);
    await cdp.evaluate("document.querySelector('.graph-dialog .icon-button').click()");
    await sleep(300);

    await setViewport(cdp, 3840, 2160);
    await sleep(1100);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.2-12-nexus-real-3840x2160.png'));
    const metrics4k = await cdp.evaluate('window.__ATLAS_METRICS__ ?? null');

    // 12. Main scene metrics sample (headless numbers are not performance baselines).
    await setViewport(cdp, 1920, 1080);
    await sleep(1600);
    const metrics = await cdp.evaluate('window.__ATLAS_METRICS__ ?? null');

    // 13. Reset to demo for a clean final state.
    await cdp.evaluate("document.querySelector('.source-badge').click()");
    await cdp.waitFor("!!document.querySelector('.data-dialog')", 4000, '最终数据面板');
    await cdp.evaluate(`(() => {
      const tab = [...document.querySelectorAll('.source-switch button')].find((node) => node.textContent.includes('演示数据'));
      tab?.click();
    })()`);
    await sleep(400);
    await cdp.evaluate("document.querySelector('.data-dialog .icon-button').click()");

    summary.imported = imported;
    summary.graphSummary = graphSummary;
    summary.toggledOff = toggledOff;
    summary.moduleLevel = moduleLevel;
    summary.fileLevel = fileLevel;
    summary.symbolLevel = symbolLevel;
    summary.pathResult = pathResult;
    summary.noPath = noPath;
    summary.graphMetrics = moduleGraphMetrics;
    summary.modulePanel = modulePanel;
    summary.flow = flow;
    summary.gapDetail = gapDetail;
    summary.exportInfo = exportInfo;
    summary.demoSummary = demoSummary;
    summary.layout1440 = layout1440;
    summary.graph1440 = graph1440;
    summary.metrics = metrics;
    summary.metrics4k = metrics4k;
    summary.consoleErrors = consoleErrors;
    summary.screenshots = [
      'P1.2-01-nexus-real-1920x1080.png',
      'P1.2-02-graph-modules-1920x1080.png',
      'P1.2-03-graph-files-1920x1080.png',
      'P1.2-04-graph-symbols-1920x1080.png',
      'P1.2-05-path-query-1920x1080.png',
      'P1.2-06-no-path-1920x1080.png',
      'P1.2-07-module-relations-1920x1080.png',
      'P1.2-07b-module-links-1920x1080.png',
      'P1.2-08-flow-gap-1920x1080.png',
      'P1.2-09-demo-regression-1920x1080.png',
      'P1.2-10-nexus-real-1440x810.png',
      'P1.2-11-graph-1440x810.png',
      'P1.2-12-nexus-real-3840x2160.png',
    ];
    await writeFile(
      path.join(ROOT, 'docs', 'architecture', 'p1.2-chrome-verification.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(summary, null, 2));
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
  console.error(`[P1.2] 独立 Chrome 验收失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

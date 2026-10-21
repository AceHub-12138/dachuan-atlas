#!/usr/bin/env node
/**
 * P1.3 独立 Chrome 验收（CDP）。
 *
 * 覆盖：
 * - 语义分层：AI 概念步骤 / 源码静态关联 / 已验证运行时顺序 / 缺口；
 * - 中文解释层：模块 / 文件 / 符号 + 技术细节折叠；
 * - 5 题理解检查；
 * - 仓库与快照登记；
 * - 导出并重新导入 Schema 1.3；
 * - 演示模式回归。
 *
 * 前置：npm run build && npm run preview
 * 运行：node tools/verify-p13.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATASET = path.join(ROOT, 'local-data', 'nexus', 'nexus-2026-10-20-2584284.atlas.json');
const SCREENSHOTS = path.join(ROOT, 'docs', 'screenshots');
const OUT = path.join(ROOT, 'docs', 'architecture', 'p1.3-chrome-verification.json');
const SERVER = process.env.ATLAS_SERVER ?? 'http://127.0.0.1:4173';
const CDP_PORT = Number(process.env.ATLAS_CDP_PORT ?? 9337);
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

async function importDataset(cdp, file = DATASET) {
  await cdp.evaluate("document.querySelector('.source-badge').click()");
  await cdp.waitFor("!!document.querySelector('.data-dialog')", 4000, '架构数据面板');
  const fileNode = await cdp.send('Runtime.evaluate', {
    expression: "document.querySelector('.data-file input[type=file]')",
    objectGroup: 'file',
  });
  const described = await cdp.send('DOM.describeNode', { objectId: fileNode.result.objectId });
  await cdp.send('DOM.setFileInputFiles', {
    files: [file],
    backendNodeId: described.node.backendNodeId,
  });
  await cdp.waitFor(
    "document.querySelector('.source-badge')?.textContent.includes('本地快照')",
    10000,
    '本地快照导入',
  );
  await sleep(600);
}

async function openNexus(cdp) {
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
  await sleep(1700);
}

function textOf(selector) {
  return `document.querySelector(${JSON.stringify(selector)})?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''`;
}

async function main() {
  if (!existsSync(DATASET)) throw new Error('缺少 local-data/nexus 快照。');
  if (!existsSync(CHROME)) throw new Error(`找不到独立 Chrome：${CHROME}`);
  await waitForHttp(SERVER);
  await mkdir(SCREENSHOTS, { recursive: true });
  const work = await mkdtemp(path.join(tmpdir(), 'atlas-p13-'));
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
  const checks = {};
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

    // 1. Import local 1.3 snapshot and enter NEXUS.
    await importDataset(cdp);
    const importedBadge = await cdp.evaluate(textOf('.source-badge'));
    if (!importedBadge.includes('本地快照')) throw new Error(`导入后来源徽标异常：${importedBadge}`);
    await openNexus(cdp);
    await cdp.waitFor("!!document.querySelector('.graph-summary')", 6000, '真实投影摘要');
    const summary = await cdp.evaluate(textOf('.graph-summary'));
    if (!summary.includes('48')) throw new Error('投影摘要没有显示 48 条跨模块关系');
    checks.importAndSummary = { badge: importedBadge, summary: summary.slice(0, 220) };
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.3-01-nexus-real-1920x1080.png'));

    // 2. Repository registry in the data panel.
    await cdp.evaluate("document.querySelector('.source-badge').click()");
    await cdp.waitFor("!!document.querySelector('.data-dialog')", 4000, '架构数据面板');
    await cdp.evaluate(`(() => {
      const section = [...document.querySelectorAll('.data-section')].find((node) => node.textContent.includes('仓库与快照'));
      section?.scrollIntoView({ block: 'center' });
    })()`);
    await sleep(350);
    const repositoryText = await cdp.evaluate(textOf('.data-repositories'));
    if (!repositoryText.includes('nexus@2584284@2026-10-20')) throw new Error('仓库登记缺少快照标识');
    if (!repositoryText.includes('扫描时间')) throw new Error('仓库登记缺少扫描时间说明');
    if (!repositoryText.includes('未记录')) throw new Error('未记录的扫描时间没有如实显示');
    if (!repositoryText.includes('CRM / Electron 尚未导入')) throw new Error('多仓库边界说明缺失');
    checks.repositories = repositoryText.slice(0, 400);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.3-02-repositories-1920x1080.png'));
    await cdp.evaluate("document.querySelector('.data-dialog .icon-button').click()");
    await sleep(400);

    // 3. Voice module plain-language card.
    await cdp.evaluate(
      "[...document.querySelectorAll('.module-row')].find((button) => button.textContent.includes('语音交互'))?.click()",
    );
    await cdp.waitFor("!!document.querySelector('.module-panel')", 5000, '语音模块详情');
    await sleep(500);
    const moduleCard = await cdp.evaluate(textOf('.module-panel .plain-card'));
    for (const needle of ['用中文理解', '它负责什么', '为什么需要它', '和当前对象的关系', '仍需确认']) {
      if (!moduleCard.includes(needle)) throw new Error(`模块解释卡缺少：${needle}`);
    }
    if (!moduleCard.includes('语音是更直接的提问方式')) throw new Error('模块解释没有使用本地 whyNeeded');
    if (await cdp.evaluate("document.querySelectorAll('.module-components code').length")) {
      throw new Error('模块组件默认仍显示源码路径');
    }
    const moduleFlowText = await cdp.evaluate(textOf('.module-flow-link'));
    if (!moduleFlowText.includes('模块协作示意')) throw new Error('模块入口仍使用旧流程名称');
    checks.modulePlain = moduleCard.slice(0, 420);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.3-03-module-plain-1920x1080.png'));

    // 4. Flow semantics dialog.
    await cdp.evaluate("document.querySelector('.module-flow-link').click()");
    await cdp.waitFor("!!document.querySelector('.flow-dialog')", 5000, '模块协作示意');
    await sleep(450);
    const flowTitle = await cdp.evaluate(textOf('#flow-title'));
    const semantics = await cdp.evaluate(textOf('.flow-semantics'));
    const flowCounts = await cdp.evaluate(`(() => ({
      steps: document.querySelectorAll('.flow-step').length,
      gaps: document.querySelectorAll('.flow-transition--gap').length,
      staticTransitions: document.querySelectorAll('.flow-transition--linked').length,
      cards: document.querySelectorAll('.flow-semantics > div').length,
    }))()`);
    if (flowTitle !== '模块协作示意') throw new Error(`流程标题未改名：${flowTitle}`);
    for (const needle of ['AI 概念步骤', '源码静态关联', '已验证运行时顺序', '缺少证据的衔接']) {
      if (!semantics.includes(needle)) throw new Error(`语义分层缺少：${needle}`);
    }
    if (flowCounts.steps !== 7 || flowCounts.gaps !== 2 || flowCounts.staticTransitions !== 4) {
      throw new Error(`流程计数异常：${JSON.stringify(flowCounts)}`);
    }
    if (flowCounts.cards !== 4) throw new Error('语义分层卡片数量不是 4');
    await cdp.evaluate("document.querySelector('.flow-step').click()");
    await sleep(250);
    const stepDetail = await cdp.evaluate(textOf('.flow-detail'));
    if (!stepDetail.includes('AI 概念步骤') || !stepDetail.includes('运行时顺序：未验证')) {
      throw new Error('步骤详情没有区分概念步骤与运行时顺序');
    }
    await cdp.evaluate(`(() => {
      const gap = [...document.querySelectorAll('.flow-transition')].find((node) => node.classList.contains('flow-transition--gap'));
      gap?.click();
    })()`);
    await cdp.waitFor("!!document.querySelector('.flow-gap-note')", 4000, '缺口详情');
    const gapText = await cdp.evaluate(textOf('.flow-gap-note'));
    if (!gapText.includes('明确的图谱缺口')) throw new Error('缺口详情缺少明确提示');
    if (!gapText.includes('不会为缺口补一条线')) throw new Error('缺口详情缺少不补线声明');
    checks.flowSemantics = { title: flowTitle, semantics, counts: flowCounts, gap: gapText.slice(0, 220) };
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.3-04-flow-semantics-1920x1080.png'));

    // 5. Relation explorer plain-language layer.
    await cdp.evaluate("document.querySelector('.flow-dialog .icon-button').click()");
    await sleep(300);
    await cdp.evaluate("document.querySelector('.module-explorer-link').click()");
    await cdp.waitFor("!!document.querySelector('.explorer-dialog')", 5000, '关系探索');
    await sleep(450);
    const moduleExplorerCard = await cdp.evaluate(textOf('.explorer-dialog .plain-card'));
    if (!moduleExplorerCard.includes('为什么需要它')) throw new Error('关系探索默认没有中文解释');
    await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('.explorer-row')].find((node) => node.textContent.includes('microphone.ts'));
      row?.click();
    })()`);
    await sleep(350);
    const fileCard = await cdp.evaluate(textOf('.explorer-dialog .plain-card'));
    if (!fileCard.includes('浏览器麦克风')) throw new Error('文件解释没有引用已核对组件');
    await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('.explorer-row')].find((node) => node.textContent.includes('浏览器麦克风'));
      row?.click();
    })()`);
    await sleep(350);
    const nodeCard = await cdp.evaluate(textOf('.explorer-dialog .plain-card'));
    if (!nodeCard.includes('浏览器麦克风') || !nodeCard.includes('麦克风权限')) {
      throw new Error('符号解释没有使用已核对职责');
    }
    const techClosed = await cdp.evaluate("![...document.querySelectorAll('.explorer-technical')].some((node) => node.open)");
    if (!techClosed) throw new Error('技术细节默认展开，未做到可展开区域');
    await cdp.evaluate("document.querySelector('.explorer-technical > summary').click()");
    await sleep(300);
    const techText = await cdp.evaluate(textOf('.explorer-technical'));
    if (!techText.includes('src/lib/voice/microphone.ts')) throw new Error('技术细节缺少源码路径');
    if (!techText.includes('源码定位')) throw new Error('技术细节缺少源码定位说明');
    checks.plainLayer = { module: moduleExplorerCard.slice(0, 180), file: fileCard.slice(0, 180), node: nodeCard.slice(0, 220) };
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.3-05-explorer-plain-1920x1080.png'));

    // 6. Comprehension check: 5 correct answers, then 5 wrong answers.
    await cdp.evaluate("document.querySelector('.explorer-dialog .icon-button').click()");
    await sleep(300);
    await cdp.evaluate("document.querySelector('.module-panel .voice-panel__header .icon-button').click()");
    await sleep(400);
    await cdp.evaluate("document.querySelector('.graph-summary__quiz').click()");
    await cdp.waitFor("!!document.querySelector('.quiz-dialog')", 4000, '理解检查');
    const quizQuestions = await cdp.evaluate("document.querySelectorAll('.quiz-question').length");
    if (quizQuestions !== 5) throw new Error(`理解检查题目数量异常：${quizQuestions}`);
    await cdp.evaluate(`(() => {
      document.querySelectorAll('.quiz-question').forEach((question) => {
        question.querySelector('.quiz-option input')?.click();
      });
    })()`);
    await sleep(250);
    const submitEnabled = await cdp.evaluate("!document.querySelector('.quiz-dialog .graph-primary-action')?.disabled");
    if (!submitEnabled) throw new Error('答完 5 题后“查看结果”仍不可用');
    await cdp.evaluate("document.querySelector('.quiz-dialog .graph-primary-action').click()");
    await cdp.waitFor("!!document.querySelector('.quiz-score')", 4000, '理解检查结果');
    const score = await cdp.evaluate(textOf('.quiz-score strong'));
    const correctCount = await cdp.evaluate("document.querySelectorAll('.quiz-question.is-correct').length");
    if (score !== '5 / 5' || correctCount !== 5) throw new Error(`满分结果异常：${score}/${correctCount}`);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.3-06-comprehension.png'));
    await cdp.evaluate(`(() => {
      const reset = [...document.querySelectorAll('.quiz-dialog .secondary-action')].find((node) => node.textContent.includes('重新作答'));
      reset?.click();
    })()`);
    await sleep(300);
    await cdp.evaluate(`(() => {
      document.querySelectorAll('.quiz-question').forEach((question) => {
        question.querySelectorAll('.quiz-option input')[1]?.click();
      });
    })()`);
    await sleep(250);
    await cdp.evaluate("document.querySelector('.quiz-dialog .graph-primary-action').click()");
    await cdp.waitFor("!!document.querySelector('.quiz-score')", 4000, '理解检查错误结果');
    const wrongScore = await cdp.evaluate(textOf('.quiz-score strong'));
    const wrongCount = await cdp.evaluate("document.querySelectorAll('.quiz-question.is-wrong').length");
    if (wrongScore !== '0 / 5' || wrongCount !== 5) throw new Error(`零分结果异常：${wrongScore}/${wrongCount}`);
    checks.comprehension = { correct: score, wrong: wrongScore };
    await cdp.evaluate("document.querySelector('.quiz-dialog .icon-button').click()");
    await sleep(300);

    // 7. Graph workspace regression + plain card.
    await cdp.evaluate("document.querySelector('.graph-summary__primary').click()");
    await cdp.waitFor("!!document.querySelector('.graph-dialog')", 5000, '架构投影');
    await sleep(1000);
    const moduleGraph = await cdp.evaluate(`(() => ({
      nodes: document.querySelector('.graph-stage__canvas')?.dataset.nodes,
      edges: document.querySelector('.graph-stage__canvas')?.dataset.edges,
    }))()`);
    if (moduleGraph.nodes !== '4' || moduleGraph.edges !== '3') {
      throw new Error(`模块投影异常：${JSON.stringify(moduleGraph)}`);
    }
    await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('.graph-node-row')].find((node) => node.textContent.includes('语音交互'));
      row?.click();
    })()`);
    await sleep(350);
    const graphPlain = await cdp.evaluate(textOf('.graph-detail .plain-card'));
    if (!graphPlain.includes('它负责什么') || !graphPlain.includes('语音')) {
      throw new Error('架构投影节点详情缺少中文解释');
    }
    checks.graphRegression = moduleGraph;
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.3-07-graph-plain-1920x1080.png'));
    await cdp.evaluate("document.querySelector('.graph-dialog .icon-button').click()");
    await sleep(350);

    // 8. Export and re-import Schema 1.3.
    await cdp.evaluate("document.querySelector('.source-badge').click()");
    await cdp.waitFor("!!document.querySelector('.data-dialog')", 4000, '数据面板');
    await cdp.evaluate("document.querySelector('.data-actions button.secondary-action').click()");
    let downloaded = null;
    for (let attempt = 0; attempt < 40 && !downloaded; attempt += 1) {
      const entries = await readdir(downloads);
      downloaded = entries.find((entry) => entry.endsWith('.atlas.json')) ?? null;
      if (!downloaded) await sleep(200);
    }
    if (!downloaded) throw new Error('导出文件未生成');
    const exported = JSON.parse(await readFile(path.join(downloads, downloaded), 'utf8'));
    if (exported.schemaVersion !== '1.3.0') throw new Error(`导出 Schema 版本异常：${exported.schemaVersion}`);
    if (exported.flows?.[0]?.semantics !== 'module-collaboration') throw new Error('导出流程语义丢失');
    if (exported.flows?.[0]?.runtimeOrder?.verified !== false) throw new Error('导出运行时顺序标记异常');
    if (!exported.modules?.every((module) => module.explanation?.whyNeeded)) throw new Error('导出模块解释丢失');
    if (exported.repositories?.[0]?.snapshots?.[0]?.snapshotKey !== 'nexus@2584284@2026-10-20') {
      throw new Error('导出仓库快照标识异常');
    }
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
    checks.exportImport = {
      schemaVersion: exported.schemaVersion,
      nodes: exported.nodes.length,
      relations: exported.relations.length,
      flows: exported.flows.length,
      steps: exported.flows[0].steps.length,
      explanations: exported.modules.filter((module) => module.explanation?.whyNeeded).length,
    };

    // 9. Demo regression.
    await cdp.evaluate(`(() => {
      const tab = [...document.querySelectorAll('.source-switch button')].find((node) => node.textContent.includes('演示数据'));
      tab?.click();
    })()`);
    await sleep(500);
    await cdp.evaluate("document.querySelector('.data-dialog .icon-button').click()");
    await sleep(450);
    await openNexus(cdp);
    await cdp.waitFor("!!document.querySelector('.graph-summary--demo')", 5000, '演示模式回归');
    const demoText = await cdp.evaluate(textOf('.graph-summary--demo'));
    if (!demoText.includes('保留 P0.1 原有星系结构')) throw new Error('演示模式回归摘要异常');
    checks.demoRegression = demoText.slice(0, 160);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.3-08-demo-regression-1920x1080.png'));

    // 10. Responsive screenshots with real data restored.
    await importDataset(cdp);
    await cdp.evaluate("document.querySelector('.data-dialog .icon-button').click()");
    await sleep(300);
    await openNexus(cdp);
    await setViewport(cdp, 1440, 810);
    await sleep(700);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.3-09-nexus-real-1440x810.png'));
    await setViewport(cdp, 3840, 2160);
    await sleep(900);
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.3-10-nexus-real-3840x2160.png'));

    if (consoleErrors.length) throw new Error(`控制台错误 ${consoleErrors.length} 个：${consoleErrors[0]}`);

    const report = {
      generatedAt: new Date().toISOString(),
      headful: HEADFUL,
      viewport: '1920x1080 / 1440x810 / 3840x2160',
      dataset: path.basename(DATASET),
      checks,
      consoleErrors,
      screenshots: [
        'P1.3-01-nexus-real-1920x1080.png',
        'P1.3-02-repositories-1920x1080.png',
        'P1.3-03-module-plain-1920x1080.png',
        'P1.3-04-flow-semantics-1920x1080.png',
        'P1.3-05-explorer-plain-1920x1080.png',
        'P1.3-06-comprehension.png',
        'P1.3-07-graph-plain-1920x1080.png',
        'P1.3-08-demo-regression-1920x1080.png',
        'P1.3-09-nexus-real-1440x810.png',
        'P1.3-10-nexus-real-3840x2160.png',
      ],
    };
    await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log('[P1.3] 浏览器验收通过');
    console.log(JSON.stringify(report.checks, null, 2).slice(0, 2000));
    console.log(`[P1.3] 报告：${path.relative(ROOT, OUT)}`);
  } catch (error) {
    console.error(`[P1.3] 浏览器验收失败：${error instanceof Error ? error.message : String(error)}`);
    if (consoleErrors.length) console.error(`控制台错误：${consoleErrors.slice(0, 5).join(' | ')}`);
    process.exitCode = 1;
  } finally {
    if (cdp) {
      try {
        await cdp.send('Browser.close');
      } catch {
        // Ignore.
      }
    }
    chrome.kill();
  }
}

main();

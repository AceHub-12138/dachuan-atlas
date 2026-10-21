#!/usr/bin/env node
/**
 * P1.4 独立 Chrome 回归（CDP）。
 *
 * 目的不是视觉施工，而是确认 Schema 1.4 迁移没有改变现有功能：
 * - 1.3 本地快照可导入，界面仍显示 NEXUS 四模块 / 3 组模块对 / 48 条关系；
 * - 模块协作示意仍是 7 步 / 4 个静态关联 / 2 个缺口 / 0 个运行时顺序；
 * - 中文解释层与 5 题理解检查仍可用；
 * - 导出为 Schema 1.4，所有关系都有 repositoryScope / runtimeScope，
 *   旧数据没有运行时边界时 runtimeScope=unknown；
 * - 导出文件可以重新导入；演示模式不回归。
 *
 * 前置：npm run build && npm run preview
 * 运行：node tools/verify-p14.mjs
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
const OUT = path.join(ROOT, 'docs', 'architecture', 'p1.4-chrome-verification.json');
const SERVER = process.env.ATLAS_SERVER ?? 'http://127.0.0.1:4173';
const CDP_PORT = Number(process.env.ATLAS_CDP_PORT ?? 9340);
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
      for (const handler of this.events.get(message.method) ?? []) handler(message.params);
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
        // Retry while the page is between states.
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
  await sleep(500);
  await cdp.evaluate("document.querySelector('.data-dialog .icon-button')?.click()");
  await sleep(400);
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
  const work = await mkdtemp(path.join(tmpdir(), 'atlas-p14-'));
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
    cdp.on('Runtime.exceptionThrown', (event) =>
      consoleErrors.push(event.exceptionDetails?.text ?? 'exception'),
    );
    cdp.on('Log.entryAdded', (event) => {
      if (event.entry?.level === 'error') consoleErrors.push(event.entry.text);
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloads,
      eventsEnabled: true,
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.waitFor('document.readyState === "complete"', 10000, '页面加载');
    await sleep(900);

    // 1. 导入 1.3 真实快照，确认 1.4 迁移后的默认视图完整。
    await importDataset(cdp);
    const badge = await cdp.evaluate(textOf('.source-badge'));
    await openNexus(cdp);
    await cdp.waitFor("!!document.querySelector('.graph-summary')", 6000, '真实投影摘要');
    const summary = await cdp.evaluate(textOf('.graph-summary'));
    if (!summary.includes('48')) throw new Error('投影摘要没有显示 48 条跨模块关系');
    if (!summary.includes('3 组模块对') && !summary.includes('3 组')) {
      throw new Error('投影摘要没有显示 3 组模块对');
    }
    checks.importAndSummary = { badge, summary: summary.slice(0, 260) };
    await cdp.screenshot(path.join(SCREENSHOTS, 'P1.4-01-nexus-real-1920x1080.png'));

    // 2. 模块协作示意语义没有回归。
    await cdp.evaluate(
      "[...document.querySelectorAll('.module-row')].find((button) => button.textContent.includes('语音交互'))?.click()",
    );
    await cdp.waitFor("!!document.querySelector('.module-panel')", 5000, '语音模块详情');
    await sleep(450);
    const moduleCard = await cdp.evaluate(textOf('.module-panel .plain-card'));
    if (!moduleCard.includes('用中文理解') || !moduleCard.includes('为什么需要它')) {
      throw new Error('中文解释卡缺失');
    }
    await cdp.evaluate("document.querySelector('.module-flow-link').click()");
    await cdp.waitFor("!!document.querySelector('.flow-dialog')", 5000, '模块协作示意');
    await sleep(400);
    const flowCounts = await cdp.evaluate(`(() => ({
      steps: document.querySelectorAll('.flow-step').length,
      gaps: document.querySelectorAll('.flow-transition--gap').length,
      staticTransitions: document.querySelectorAll('.flow-transition--linked').length,
      semantics: document.querySelector('.flow-semantics')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
    }))()`);
    if (flowCounts.steps !== 7 || flowCounts.gaps !== 2 || flowCounts.staticTransitions !== 4) {
      throw new Error(`流程计数异常：${JSON.stringify(flowCounts)}`);
    }
    if (!flowCounts.semantics.includes('已验证运行时顺序') || !flowCounts.semantics.includes('0')) {
      throw new Error('静态关系被误标为运行时关联');
    }
    checks.flow = flowCounts;
    await cdp.evaluate("document.querySelector('.flow-dialog .icon-button').click()");
    await sleep(300);

    // 3. 理解检查仍为 5 题。
    await openNexus(cdp);
    await cdp.evaluate("document.querySelector('.graph-summary__quiz')?.click()");
    await cdp.waitFor("!!document.querySelector('.quiz-dialog')", 4000, '理解检查');
    const quizTotal = await cdp.evaluate("document.querySelectorAll('.quiz-question').length");
    if (quizTotal !== 5) throw new Error(`理解检查题目数异常：${quizTotal}`);
    checks.quizQuestions = quizTotal;
    await cdp.evaluate("document.querySelector('.quiz-dialog .icon-button').click()");
    await sleep(250);

    // 4. 导出 Schema 1.4，检查每条关系的双维度字段。
    await cdp.evaluate("document.querySelector('.source-badge').click()");
    await cdp.waitFor("!!document.querySelector('.data-dialog')", 4000, '数据面板');
    await cdp.evaluate("document.querySelector('.data-actions button.secondary-action').click()");
    let downloaded = null;
    for (let attempt = 0; attempt < 50 && !downloaded; attempt += 1) {
      const entries = await readdir(downloads);
      downloaded = entries.find((entry) => entry.endsWith('.atlas.json')) ?? null;
      if (!downloaded) await sleep(200);
    }
    if (!downloaded) throw new Error('导出文件未生成');
    const exported = JSON.parse(await readFile(path.join(downloads, downloaded), 'utf8'));
    if (exported.schemaVersion !== '1.4.0') {
      throw new Error(`导出 Schema 版本异常：${exported.schemaVersion}`);
    }
    if (exported.relations?.length !== 3170) throw new Error('导出关系数量不是 3170');
    const badScopes = exported.relations.filter(
      (relation) =>
        !['intra-repository', 'cross-repository'].includes(relation.repositoryScope) ||
        !['intra-runtime', 'cross-runtime', 'unknown'].includes(relation.runtimeScope) ||
        typeof relation.runtimeVerified !== 'boolean' ||
        !Array.isArray(relation.interfaceEvidence),
    );
    if (badScopes.length) throw new Error(`有 ${badScopes.length} 条关系缺少 1.4 作用域字段`);
    const notUnknown = exported.relations.filter((relation) => relation.runtimeScope !== 'unknown');
    if (notUnknown.length) throw new Error('没有运行时证据的 NEXUS 关系被推断成了已知运行时');
    if (exported.flows?.[0]?.semantics !== 'module-collaboration') throw new Error('流程语义丢失');
    checks.export = {
      schemaVersion: exported.schemaVersion,
      relations: exported.relations.length,
      repositoryScopeCounts: exported.relations.reduce((counts, relation) => {
        counts[relation.repositoryScope] = (counts[relation.repositoryScope] ?? 0) + 1;
        return counts;
      }, {}),
      runtimeScopeUnknown: exported.relations.filter(
        (relation) => relation.runtimeScope === 'unknown',
      ).length,
      runtimeVerified: exported.relations.filter((relation) => relation.runtimeVerified).length,
    };

    // 5. 导出文件重新导入。
    const fileNode = await cdp.send('Runtime.evaluate', {
      expression: "document.querySelector('.data-file input[type=file]')",
      objectGroup: 'file2',
    });
    const described = await cdp.send('DOM.describeNode', { objectId: fileNode.result.objectId });
    await cdp.send('DOM.setFileInputFiles', {
      files: [path.join(downloads, downloaded)],
      backendNodeId: described.node.backendNodeId,
    });
    await cdp.waitFor(
      `document.querySelector('.data-notice--import')?.textContent.includes(${JSON.stringify(downloaded)})`,
      8000,
      '导出文件重新导入',
    );
    checks.reimport = { file: downloaded };

    // 6. 演示模式回归。
    await cdp.evaluate(`(() => {
      const tab = [...document.querySelectorAll('.source-switch button')].find((node) => node.textContent.includes('演示数据'));
      tab?.click();
    })()`);
    await sleep(500);
    await cdp.evaluate("document.querySelector('.data-dialog .icon-button').click()");
    await sleep(400);
    await openNexus(cdp);
    await cdp.waitFor("!!document.querySelector('.graph-summary--demo')", 5000, '演示模式回归');
    const demoText = await cdp.evaluate(textOf('.graph-summary--demo'));
    if (!demoText.includes('保留 P0.1 原有星系结构')) throw new Error('演示模式摘要异常');
    checks.demoRegression = demoText.slice(0, 180);

    if (consoleErrors.length) throw new Error(`控制台错误 ${consoleErrors.length} 个：${consoleErrors[0]}`);

    const report = {
      generatedAt: new Date().toISOString(),
      headful: HEADFUL,
      viewport: '1920x1080',
      dataset: path.basename(DATASET),
      checks,
      consoleErrors,
      screenshots: ['P1.4-01-nexus-real-1920x1080.png'],
      note: '本报告只证明 macOS 本机回归；Windows 实机验收仍待完成。',
    };
    await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log('[P1.4] 浏览器回归通过');
    console.log(JSON.stringify(checks, null, 2).slice(0, 2400));
    console.log(`[P1.4] 报告：${path.relative(ROOT, OUT)}`);
  } catch (error) {
    console.error(`[P1.4] 浏览器回归失败：${error instanceof Error ? error.message : String(error)}`);
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

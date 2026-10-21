#!/usr/bin/env node
/**
 * P1.3 备份 / 恢复审计。
 *
 * 实际执行：
 * 1. 校验 Git bundle 与本地数据副本的 SHA-256；
 * 2. 检查 bundle 是否排除了 local-data、dist、node_modules、快照与构建产物；
 * 3. 在隔离临时目录从 bundle 克隆；
 * 4. 把私有 local-data 副本放回隔离目录；
 * 5. npm ci（或显式的 node_modules 回退）、npm test、npm run build、verify:build；
 * 6. 启动隔离构建的 preview，用独立 Chrome 重新导入真实 .atlas.json；
 * 7. 输出脱敏 JSON 报告。
 *
 * 用法：
 *   node tools/audit-backup.mjs \
 *     --bundle ~/Documents/DACHUAN-ATLAS-private-backups/atlas-p13-final-20261021.bundle \
 *     --data ~/Documents/DACHUAN-ATLAS-private-backups/local-data-p13-final-20261021 \
 *     --out docs/architecture/p1.3-backup-audit.json
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SERVER_PORT = Number(process.env.ATLAS_AUDIT_PORT ?? 4174);
const CDP_PORT = Number(process.env.ATLAS_AUDIT_CDP_PORT ?? 9338);
const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : 'google-chrome');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = value;
      index += 1;
    }
  }
  return options;
}

function expandHome(value) {
  if (value.startsWith('~/')) return path.join(process.env.HOME ?? '', value.slice(2));
  return value;
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, options.timeout ?? 300000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function sha256(file) {
  const buffer = await readFile(file);
  return createHash('sha256').update(buffer).digest('hex');
}

async function walkFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(full, base)));
    else files.push(path.relative(base, full).replaceAll(path.sep, '/'));
  }
  return files.sort();
}

async function fileInfo(file) {
  const info = await stat(file);
  return { name: path.basename(file), bytes: info.size, sha256: await sha256(file) };
}

function sanitize(text) {
  return text
    .replaceAll(ROOT, '<project>')
    .replaceAll(process.env.HOME ?? '/Users', '~')
    .replace(/\d+\.\d+\.\d+\.\d+/g, '<ip>');
}

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
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('CDP 连接失败'));
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  async waitFor(expression, timeout = 10000, label = expression) {
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

async function waitForHttp(url, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry.
    }
    await sleep(150);
  }
  throw new Error(`无法访问 ${url}`);
}

async function browserReimport(datasetPath, serverUrl) {
  if (!existsSync(CHROME)) return { status: 'skipped', reason: '独立 Chrome 不存在' };
  const work = await mkdtemp(path.join(tmpdir(), 'atlas-audit-chrome-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${path.join(work, 'profile')}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let cdp;
  try {
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const target = await fetch(
      `http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(serverUrl)}`,
      { method: 'PUT' },
    ).then((response) => response.json());
    cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.waitFor('document.readyState === "complete"', 10000, '页面加载');
    await sleep(700);
    await cdp.evaluate("document.querySelector('.source-badge').click()");
    await cdp.waitFor("!!document.querySelector('.data-dialog')", 5000, '架构数据面板');
    const fileNode = await cdp.send('Runtime.evaluate', {
      expression: "document.querySelector('.data-file input[type=file]')",
      objectGroup: 'file',
    });
    const described = await cdp.send('DOM.describeNode', { objectId: fileNode.result.objectId });
    await cdp.send('DOM.setFileInputFiles', {
      files: [datasetPath],
      backendNodeId: described.node.backendNodeId,
    });
    await cdp.waitFor(
      "document.querySelector('.source-badge')?.textContent.includes('本地快照')",
      12000,
      '恢复构建中的真实数据导入',
    );
    const badge = await cdp.evaluate(
      "document.querySelector('.source-badge')?.textContent?.replace(/\\s+/g, ' ').trim()",
    );
    await cdp.evaluate("document.querySelector('.data-dialog .icon-button').click()");
    await sleep(500);
    await cdp.evaluate(
      "[...document.querySelectorAll('button')].find((button) => button.textContent.includes('进入 NEXUS 星系'))?.click()",
    );
    await cdp.waitFor("!!document.querySelector('.graph-summary')", 8000, 'NEXUS 投影摘要');
    const summary = await cdp.evaluate(
      "document.querySelector('.graph-summary')?.textContent?.replace(/\\s+/g, ' ').trim()",
    );
    if (!summary.includes('48')) throw new Error('恢复构建没有显示 48 条跨模块关系');
    return { status: 'passed', badge, summary: summary.slice(0, 160) };
  } finally {
    if (cdp) {
      try {
        await cdp.send('Browser.close');
      } catch {
        // Ignore.
      }
    }
    chrome.kill();
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundle = expandHome(
    args.bundle ??
      path.join(
        process.env.HOME ?? '',
        'Documents/DACHUAN-ATLAS-private-backups/atlas-p13-final-20261021.bundle',
      ),
  );
  const dataDir = expandHome(
    args.data ??
      path.join(
        process.env.HOME ?? '',
        'Documents/DACHUAN-ATLAS-private-backups/local-data-p13-final-20261021',
      ),
  );
  const out = args.out ? path.resolve(ROOT, args.out) : path.join(ROOT, 'docs/architecture/p1.3-backup-audit.json');
  const nodeModulesFallback = args['node-modules'] ? path.resolve(expandHome(args['node-modules'])) : null;

  if (!existsSync(bundle)) throw new Error(`bundle 不存在：${path.basename(bundle)}`);
  if (!existsSync(dataDir)) throw new Error(`数据副本目录不存在：${path.basename(dataDir)}`);

  const report = {
    generatedAt: new Date().toISOString(),
    bundle: await fileInfo(bundle),
    data: {
      path: path.basename(dataDir),
      files: [],
    },
    bundleVerification: null,
    exclusions: null,
    restore: null,
    dataReimport: null,
    limitations: [],
  };

  // Data files with hashes.
  const dataFiles = await walkFiles(dataDir);
  report.data.files = [];
  for (const file of dataFiles) {
    const info = await stat(path.join(dataDir, file));
    report.data.files.push({
      file,
      bytes: info.size,
      sha256: await sha256(path.join(dataDir, file)),
    });
  }

  // Bundle verify and refs.
  const verify = await run('git', ['bundle', 'verify', bundle], { cwd: ROOT });
  const heads = await run('git', ['bundle', 'list-heads', bundle], { cwd: ROOT });
  report.bundleVerification = {
    status: verify.code === 0 ? 'passed' : 'failed',
    output: sanitize(`${verify.stdout}\n${verify.stderr}`).trim().slice(0, 1200),
    refs: heads.stdout.trim().split('\n').filter(Boolean),
  };
  if (verify.code !== 0) throw new Error('git bundle verify 失败');

  // List files in bundle without extracting.
  const tree = await run('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: ROOT });
  const treeFiles = tree.stdout.split('\n').filter(Boolean);
  const forbidden = treeFiles.filter(
    (file) =>
      file.startsWith('local-data/') ||
      file.startsWith('dist/') ||
      file.startsWith('node_modules/') ||
      file.endsWith('.atlas.json') ||
      file.endsWith('.tsbuildinfo') ||
      file === '.DS_Store' ||
      file.startsWith('.tools-build/') ||
      file.startsWith('.vite/') ||
      /(^|\/)(\.env|credentials?|secrets?)/i.test(file),
  );
  report.exclusions = {
    totalFiles: treeFiles.length,
    hasLocalData: treeFiles.some((file) => file.startsWith('local-data/')),
    hasDist: treeFiles.some((file) => file.startsWith('dist/')),
    hasNodeModules: treeFiles.some((file) => file.startsWith('node_modules/')),
    hasSnapshot: treeFiles.some((file) => file.endsWith('.atlas.json')),
    forbidden,
    status: forbidden.length ? 'failed' : 'passed',
  };
  if (forbidden.length) throw new Error(`bundle 包含被排除文件：${forbidden.slice(0, 5).join(', ')}`);

  // Isolated restore.
  const restoreRoot = await mkdtemp(path.join(tmpdir(), 'atlas-restore-'));
  const restored = path.join(restoreRoot, 'restored');
  const clone = await run('git', ['clone', '--quiet', bundle, restored], { cwd: restoreRoot });
  if (clone.code !== 0) throw new Error(`bundle 克隆失败：${sanitize(clone.stderr)}`);

  const restoredGitignore = await readFile(path.join(restored, '.gitignore'), 'utf8');
  const ignoreChecks = ['local-data/', 'dist/', 'node_modules/', '*.tsbuildinfo'];
  const missingIgnores = ignoreChecks.filter((entry) => !restoredGitignore.includes(entry));
  if (missingIgnores.length) throw new Error(`恢复后的 .gitignore 缺少：${missingIgnores.join(', ')}`);

  // Copy private data copy into the restored tree (never from public/dist).
  await cp(dataDir, path.join(restored, 'local-data'), { recursive: true });

  // Dependencies.
  const ci = await run(NPM, ['ci', '--prefer-offline', '--no-audit', '--no-fund'], {
    cwd: restored,
    timeout: 600000,
    env: { npm_config_audit: 'false', npm_config_fund: 'false' },
  });
  let dependencyInstall = { mode: 'npm ci', status: ci.code === 0 ? 'passed' : 'failed' };
  if (ci.code !== 0 && nodeModulesFallback) {
    await cp(nodeModulesFallback, path.join(restored, 'node_modules'), { recursive: true });
    dependencyInstall = { mode: 'node_modules fallback copy', status: 'passed', npmCiError: sanitize(ci.stderr).slice(0, 800) };
  }
  if (dependencyInstall.status !== 'passed') {
    throw new Error(`依赖恢复失败：${sanitize(ci.stderr).slice(0, 1200)}`);
  }

  const tests = await run(NPM, ['test'], { cwd: restored, timeout: 600000 });
  const build = await run(NPM, ['run', 'build'], { cwd: restored, timeout: 600000 });
  const verifyBuild = await run(NPM, ['run', 'verify:build'], { cwd: restored, timeout: 300000 });
  const dataImportTest = await run(
    NPM,
    ['test', '--', 'tests/architecture/real-snapshot.test.ts', 'tests/architecture/semantics.test.ts'],
    { cwd: restored, timeout: 600000 },
  );

  report.restore = {
    status:
      tests.code === 0 && build.code === 0 && verifyBuild.code === 0 && dataImportTest.code === 0
        ? 'passed'
        : 'failed',
    dependencyInstall,
    tests: {
      status: tests.code === 0 ? 'passed' : 'failed',
      summary: sanitize(tests.stdout).trim().split('\n').slice(-6).join(' ').slice(0, 500),
    },
    build: {
      status: build.code === 0 ? 'passed' : 'failed',
      summary: sanitize(build.stdout).trim().split('\n').slice(-4).join(' ').slice(0, 400),
    },
    verifyBuild: {
      status: verifyBuild.code === 0 ? 'passed' : 'failed',
      output: sanitize(verifyBuild.stdout).trim().slice(0, 600),
    },
    dataImport: {
      status: dataImportTest.code === 0 ? 'passed' : 'failed',
      summary: sanitize(dataImportTest.stdout).trim().split('\n').slice(-8).join(' ').slice(0, 600),
    },
    restoredFiles: treeFiles.length + dataFiles.length,
  };
  if (report.restore.status !== 'passed') throw new Error('隔离恢复测试失败');

  // Browser re-import from the restored build.
  const preview = spawn(NPM, ['run', 'preview', '--', '--port', String(SERVER_PORT)], {
    cwd: restored,
    stdio: 'ignore',
    env: process.env,
  });
  try {
    await waitForHttp(`http://127.0.0.1:${SERVER_PORT}`);
    const snapshotFiles = (await walkFiles(path.join(restored, 'local-data'))).filter((file) =>
      file.endsWith('.atlas.json'),
    );
    if (!snapshotFiles.length) throw new Error('恢复后的 local-data 没有 .atlas.json');
    const snapshotPath = path.join(restored, 'local-data', snapshotFiles[0]);
    report.dataReimport = await browserReimport(
      snapshotPath,
      `http://127.0.0.1:${SERVER_PORT}`,
    );
    if (report.dataReimport.status !== 'passed') throw new Error('恢复构建中的真实数据导入失败');
  } finally {
    preview.kill('SIGTERM');
  }

  // Limitations: this machine only.
  report.limitations = [
    '本报告只证明本机同一用户的隔离目录恢复；没有异机 / 离线介质恢复证据。',
    '备份仍位于本机 ~/Documents/DACHUAN-ATLAS-private-backups；尚未完成异机备份。',
    'Windows 实机恢复未执行；Windows 迁移步骤见 docs/P1.3-MAC-TO-WINDOWS.md。',
  ];

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log('[P1.3] 备份审计通过');
  console.log(`[P1.3] bundle 文件：${report.bundle.name}（${report.bundle.bytes} bytes）`);
  console.log(`[P1.3] bundle 排除检查：${report.exclusions.status}，共 ${report.exclusions.totalFiles} 个文件`);
  console.log(`[P1.3] 隔离恢复：tests ${report.restore.tests.status} · build ${report.restore.build.status} · verify:build ${report.restore.verifyBuild.status}`);
  console.log(`[P1.3] 真实数据重新导入：${report.dataReimport.status}`);
  console.log(`[P1.3] 报告：${path.relative(ROOT, out)}`);
  await rm(restoreRoot, { recursive: true, force: true }).catch(() => {});
}

main().catch((error) => {
  console.error(`[P1.3] 备份审计失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

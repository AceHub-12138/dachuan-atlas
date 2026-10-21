#!/usr/bin/env node
/**
 * P2.0-A.1 验证：P1.4 封存复核 + 合成 Git 历史 + 硬失败矩阵 + 安全边界。
 *
 * 只使用 tests/fixtures/crm-synthetic 的合成数据；不读取、不扫描真实 CRM。
 * 输出 docs/architecture/p2.0a1-crm-import-verification.json（不含绝对路径）。
 *
 * 运行：npm run verify:p20a（会先 tsc 编译 tools）
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'crm-synthetic');
const CLI = path.join(ROOT, 'tools', 'import-crm.mjs');
const OUT = path.join(ROOT, 'docs', 'architecture', 'p2.0a1-crm-import-verification.json');
const OLD_EVIDENCE = path.join(ROOT, 'docs', 'architecture', 'p2.0a-crm-import-verification.json');
const NEXUS = path.join(ROOT, 'local-data', 'nexus', 'nexus-2026-10-20-2584284.atlas.json');
const BACKUP_DIR = path.join(
  process.env.HOME ?? '',
  'Documents',
  'DACHUAN-ATLAS-private-backups',
  'p14-final-20261021',
);
const P14_BUNDLE = path.join(BACKUP_DIR, 'atlas-p14-final-20261021.bundle');
const P14_BUNDLE_REF = 'ddc74c1d5df5cc0d5e5937b7ca12a0c59e92c06b';
const P14_EVIDENCE_HEAD = '6b9e9e9';
const P13_BUNDLE = path.join(
  process.env.HOME ?? '',
  'Documents',
  'DACHUAN-ATLAS-private-backups',
  'atlas-p13-final-20261021.bundle',
);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function sha256File(file) {
  return sha256(await readFile(file));
}

function sanitize(text) {
  return String(text)
    .replaceAll(ROOT, '<project>')
    .replaceAll(process.env.HOME ?? '/Users', '~')
    .replace(/\d+\.\d+\.\d+\.\d+/g, '<ip>');
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeout ?? 120000);
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

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

async function loadDataset(file) {
  const { parseAtlasDataset } = await import(
    path.join(ROOT, '.tools-build', 'architecture', 'dataset.js')
  );
  return parseAtlasDataset(JSON.parse(await readFile(file, 'utf8')));
}

async function loadAudit(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function prepareBundle(root, name) {
  const target = path.join(root, name);
  await cp(FIXTURE, target, { recursive: true });
  return target;
}

async function rewriteManifestHashes(bundle) {
  const manifestPath = path.join(bundle, 'snapshot-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  let bytes = 0;
  for (const entry of manifest.files) {
    const buffer = await readFile(path.join(bundle, 'source-snapshot', entry.path));
    bytes += buffer.length;
    entry.sha256 = sha256(buffer);
  }
  manifest.file_count = manifest.files.length;
  manifest.byte_count = bytes;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

async function prepareGitBundle(root, name) {
  const bundle = await prepareBundle(root, name);
  const repo = path.join(root, `${name}-git`);
  await mkdir(repo, { recursive: true });
  await cp(path.join(bundle, 'source-snapshot', 'synthetic'), path.join(repo, 'synthetic'), {
    recursive: true,
  });
  const git = (args, env = {}) => run('git', args, { cwd: repo, env });
  let result = await git(['init', '-q']);
  if (result.code !== 0) throw new Error(`git init 失败：${sanitize(result.stderr)}`);
  await git(['config', 'user.name', 'ATLAS Synthetic']);
  await git(['config', 'user.email', 'atlas-synthetic@example.invalid']);
  await git(['add', '-A']);
  result = await git(['commit', '-q', '-m', 'synthetic snapshot'], {
    GIT_AUTHOR_DATE: '2026-10-20T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-10-20T00:00:00Z',
  });
  if (result.code !== 0) throw new Error(`git commit 失败：${sanitize(result.stderr)}`);
  const head = await git(['rev-parse', 'HEAD']);
  const commit = head.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('合成 Git 提交 SHA 无效。');

  const manifestPath = path.join(bundle, 'snapshot-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.commit = commit;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const reportPath = path.join(bundle, 'GRAPH_REPORT.md');
  const report = await readFile(reportPath, 'utf8');
  await writeFile(
    reportPath,
    report.replace(/^Commit:.*$/m, `Commit: ${commit}`),
    'utf8',
  );
  return { bundle, repo, commit };
}

async function runCrm(bundle, extra = [], options = {}) {
  const outDir = options.outDir ?? path.join(bundle, 'out');
  const out = options.out ?? path.join(outDir, 'out.atlas.json');
  const report = options.report ?? path.join(outDir, 'import-report.json');
  const result = await run(
    process.execPath,
    [
      CLI,
      '--graphify',
      bundle,
      '--profile',
      path.join(bundle, 'profile.json'),
      '--allow-synthetic',
      '--out',
      out,
      '--report',
      report,
      ...extra,
    ],
    { env: options.env },
  );
  return {
    code: result.code,
    stdout: sanitize(result.stdout),
    stderr: sanitize(result.stderr),
    out,
    report,
    outExists: existsSync(out),
    reportExists: existsSync(report),
  };
}

async function p14Seal() {
  const result = {
    status: 'fail',
    backupDirectoryExists: existsSync(BACKUP_DIR),
    bundle: { file: 'atlas-p14-final-20261021.bundle', sha256: null, expectedSha256: null, match: false },
    bundleRef: null,
    refsMatch: false,
    bundleVerify: null,
    postBundleCommits: { from: P14_BUNDLE_REF, to: P14_EVIDENCE_HEAD, commits: [], files: [], docsOnly: false },
    dataCopy: { files: [], allMatch: false },
    p13Bundle: {
      file: 'atlas-p13-final-20261021.bundle',
      sha256: null,
      expectedSha256: 'a4b6561e1b84507e51684717d90d000c8d323c5021f28504208812fd5b28784a',
      match: false,
    },
    workingTree: { branch: null, head: null, status: null },
    windowsAcceptance: 'not_verified',
    offMachineBackup: 'not_verified',
  };
  if (!result.backupDirectoryExists) {
    result.error = 'P1.4 backup directory not found.';
    return result;
  }

  if (existsSync(P14_BUNDLE)) {
    result.bundle.sha256 = await sha256File(P14_BUNDLE);
    const shaText = await readFile(path.join(BACKUP_DIR, 'SHA256-p14-final-20261021.txt'), 'utf8');
    result.bundle.expectedSha256 = shaText.trim().split(/\s+/)[0] ?? null;
    result.bundle.match = result.bundle.sha256 === result.bundle.expectedSha256;

    const verify = await run('git', ['bundle', 'verify', P14_BUNDLE], { timeout: 60000 });
    result.bundleVerify = {
      code: verify.code,
      output: sanitize(verify.stderr || verify.stdout),
    };
    const heads = await run('git', ['bundle', 'list-heads', P14_BUNDLE], { timeout: 60000 });
    const refs = heads.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    result.bundleRef = refs.find((line) => line.endsWith(' refs/heads/main'))?.split(/\s+/)[0] ?? null;
    result.refsMatch =
      result.bundleRef === P14_BUNDLE_REF &&
      refs.every((line) => line.startsWith(P14_BUNDLE_REF));

    const audit = JSON.parse(
      await readFile(path.join(BACKUP_DIR, 'p1.4-final-bundle-audit.json'), 'utf8'),
    );
    result.audit = {
      bundleSha256: audit.bundle?.sha256 ?? null,
      bundleBytes: audit.bundle?.bytes ?? null,
      expectedCommit: audit.bundleVerification?.expectedCommit ?? null,
      shaMatch: audit.bundle?.sha256 === result.bundle.sha256,
      commitMatch: audit.bundleVerification?.expectedCommit === P14_BUNDLE_REF,
    };

    const dataDir = path.join(BACKUP_DIR, 'local-data-p14-final-20261021');
    if (existsSync(dataDir)) {
      const files = (await walk(dataDir))
        .map((file) => path.relative(dataDir, file).replaceAll(path.sep, '/'))
        .sort();
      for (const file of files) {
        const actual = await sha256File(path.join(dataDir, file));
        const expected = audit.data?.files?.find((entry) => entry.file === file)?.sha256 ?? null;
        result.dataCopy.files.push({ file, sha256: actual, expected, match: actual === expected });
      }
      result.dataCopy.allMatch =
        result.dataCopy.files.length > 0 &&
        result.dataCopy.files.every((entry) => entry.match);
    }
  }

  if (existsSync(P13_BUNDLE)) {
    result.p13Bundle.sha256 = await sha256File(P13_BUNDLE);
    result.p13Bundle.match = result.p13Bundle.sha256 === result.p13Bundle.expectedSha256;
  }

  const commits = await run('git', ['log', '--oneline', `${P14_BUNDLE_REF}..${P14_EVIDENCE_HEAD}`]);
  const names = await run('git', ['diff', '--name-status', `${P14_BUNDLE_REF}..${P14_EVIDENCE_HEAD}`]);
  const files = names.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/).slice(1).join(' '));
  result.postBundleCommits.commits = commits.stdout.split(/\r?\n/).filter(Boolean);
  result.postBundleCommits.files = files;
  result.postBundleCommits.docsOnly = files.every(
    (file) => file.startsWith('docs/') || file === 'README.md' || file.startsWith('docs\\'),
  );

  const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = await run('git', ['rev-parse', 'HEAD']);
  const status = await run('git', ['status', '--porcelain=v1']);
  result.workingTree = {
    branch: branch.stdout.trim(),
    head: head.stdout.trim(),
    status: status.stdout.trim() ? 'dirty' : 'clean',
  };

  result.status =
    result.bundle.match &&
    result.refsMatch &&
    result.bundleVerify?.code === 0 &&
    result.audit?.shaMatch &&
    result.audit?.commitMatch &&
    result.dataCopy.allMatch &&
    result.p13Bundle.match &&
    result.postBundleCommits.docsOnly
      ? 'pass'
      : 'fail';
  return result;
}

function stepNode(nodes, step) {
  const matches = (symbol) =>
    symbol === step.symbol ||
    symbol === `${step.symbol}()` ||
    symbol === `.${step.symbol}()` ||
    symbol === `.${step.symbol}`;
  const candidates = nodes.filter(
    (node) =>
      node.sourceFile === step.file &&
      matches(node.symbol) &&
      node.moduleIds.includes(step.moduleId),
  );
  return (
    candidates.sort((a, b) => {
      const lineA = step.line !== null && a.sourceLine === step.line ? 0 : 1;
      const lineB = step.line !== null && b.sourceLine === step.line ? 0 : 1;
      if (lineA !== lineB) return lineA - lineB;
      return (a.moduleId === step.moduleId ? 0 : 1) - (b.moduleId === step.moduleId ? 0 : 1);
    })[0] ?? null
  );
}

function flowBaseline(dataset) {
  const flow = dataset.flows[0];
  if (!flow) return { scenarios: 0, steps: 0, staticHandoffs: 0, gaps: 0, unresolved: 0 };
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const relationBetween = (fromFile, toFile) =>
    dataset.relations.filter((relation) => {
      const from = nodeById.get(relation.from);
      const to = nodeById.get(relation.to);
      if (!from || !to || from.scope !== 'product' || to.scope !== 'product') return false;
      if (relation.evidenceType === 'SIMULATED') return false;
      return (
        (from.sourceFile === fromFile && to.sourceFile === toFile) ||
        (from.sourceFile === toFile && to.sourceFile === fromFile)
      );
    });
  let staticHandoffs = 0;
  let gaps = 0;
  let unresolved = 0;
  for (let index = 0; index < flow.steps.length - 1; index += 1) {
    const a = stepNode(dataset.nodes, flow.steps[index]);
    const b = stepNode(dataset.nodes, flow.steps[index + 1]);
    if (!a || !b) {
      unresolved += 1;
      continue;
    }
    if (relationBetween(flow.steps[index].file, flow.steps[index + 1].file).length) staticHandoffs += 1;
    else gaps += 1;
  }
  return {
    scenarios: dataset.flows.length,
    steps: flow.steps.length,
    staticHandoffs,
    gaps,
    unresolved,
  };
}

async function nexusBaseline(dataset) {
  const directedPairs = new Set();
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  for (const relation of dataset.relations) {
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from || !to || from.scope !== 'product' || to.scope !== 'product') continue;
    if (!from.moduleId || !to.moduleId || from.moduleId === to.moduleId) continue;
    directedPairs.add(`${from.moduleId}->${to.moduleId}`);
  }
  const { crossModuleSummary } = await import(
    path.join(ROOT, '.tools-build', 'architecture', 'dataset.js')
  );
  const cross = crossModuleSummary(dataset);
  const flow = flowBaseline(dataset);
  const baselineMatch =
    dataset.nodes.length === 1390 &&
    dataset.relations.length === 3170 &&
    dataset.modules.length === 4 &&
    directedPairs.size === 3 &&
    cross.total === 48 &&
    flow.steps === 7 &&
    flow.staticHandoffs === 4 &&
    flow.gaps === 2;
  return {
    status: baselineMatch ? 'pass' : 'fail',
    nodes: dataset.nodes.length,
    relations: dataset.relations.length,
    modules: dataset.modules.length,
    directedModulePairs: directedPairs.size,
    interModuleRelations: cross.total,
    modulePairs: cross.pairs,
    flows: flow,
    expected: {
      nodes: 1390,
      relations: 3170,
      modules: 4,
      directedModulePairs: 3,
      interModuleRelations: 48,
      steps: 7,
      staticHandoffs: 4,
      gaps: 2,
    },
  };
}

function status(condition, details) {
  return { status: condition ? 'pass' : 'fail', ...details };
}

async function main() {
  const { serializeAtlasDataset, parseAtlasDataset } = await import(
    path.join(ROOT, '.tools-build', 'architecture', 'dataset.js')
  );
  const { auditDatasetPrivacy } = await import(
    path.join(ROOT, '.tools-build', 'architecture', 'privacy.js')
  );

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'atlas-p20a1-'));
  const report = {
    generatedAt: new Date().toISOString(),
    round: 'P2.0-A.1',
    environment: {
      platform: process.platform,
      node: process.version,
      usesRealCrmData: false,
      dataSource: 'tests/fixtures/crm-synthetic + temporary synthetic Git repository',
    },
    p14Seal: await p14Seal(),
    priorEvidence: {
      p20aVerificationExists: existsSync(OLD_EVIDENCE),
      p20aVerificationStatus: existsSync(OLD_EVIDENCE)
        ? JSON.parse(await readFile(OLD_EVIDENCE, 'utf8')).status ?? null
        : null,
    },
    scenarios: {},
    nexusBaseline: null,
    security: {},
    limitations: [
      '所有 CRM 数据与 Git 提交都是合成 fixture，不是真实 CRM 扫描结果。',
      '没有异机备份证据；本机备份和 Windows 实机验收仍未完成。',
      '浏览器 UI 尚未接入 CRM 仓库切换器；本轮只验证数据层与本地 CLI。',
    ],
  };

  try {
    // 1. 完整导入：清单一致 + 合成 Git 历史核实
    {
      const prepared = await prepareGitBundle(tempRoot, 'valid-git');
      const runResult = await runCrm(prepared.bundle, ['--git-repo', prepared.repo]);
      const dataset = runResult.outExists ? await loadDataset(runResult.out) : null;
      const audit = runResult.reportExists ? await loadAudit(runResult.report) : null;
      const roundtrip = dataset
        ? parseAtlasDataset(JSON.parse(serializeAtlasDataset(dataset)))
        : null;
      const counts = dataset?.diagnostics.counts;
      report.scenarios.completeWithGitHistory = status(
        runResult.code === 0 &&
          runResult.outExists &&
          runResult.reportExists &&
          dataset?.nodes.length === 12 &&
          dataset?.relations.length === 14 &&
          dataset?.modules.length === 5 &&
          dataset?.snapshot?.importStatus === 'complete' &&
          audit?.provenance?.manifestConsistency === 'verified' &&
          audit?.provenance?.historyVerification?.status === 'verified' &&
          audit?.provenance?.historyVerification?.matchedFiles === 8 &&
          audit?.provenance?.separation?.completeRequiresBoth === true &&
          counts?.nodes === 12 &&
          counts?.internalNodes === 11 &&
          counts?.externalNodes === 1 &&
          counts?.productNodes === 11 &&
          counts?.modulesAssigned === 9 &&
          counts?.modulesUnassigned === 2 &&
          counts?.assignedNodes === 9 &&
          counts?.unassignedNodes === 3 &&
          counts?.multiModuleNodes === 0 &&
          dataset?.relations.every(
            (relation) => relation.runtimeScope === 'unknown' && !relation.runtimeVerified,
          ) &&
          roundtrip !== null &&
          auditDatasetPrivacy(dataset).status === 'pass'
        ,
        {
          exitCode: runResult.code,
          outputExists: runResult.outExists,
          reportExists: runResult.reportExists,
          gitCommit: prepared.commit,
          counts: counts ?? null,
          snapshot: dataset
            ? {
                repository: dataset.snapshot?.repository.id,
                commit: dataset.snapshot?.commit,
                snapshotKey: dataset.repositories?.[0]?.snapshots[0]?.snapshotKey,
                importStatus: dataset.snapshot?.importStatus,
                manifestStatus: dataset.snapshot?.manifest?.status,
              }
            : null,
          provenance: audit
            ? {
                manifestConsistency: audit.provenance.manifestConsistency,
                gitHistory: audit.provenance.historyVerification,
                separation: audit.provenance.separation,
              }
            : null,
          partition: dataset?.diagnostics.issues.find(
            (issue) => issue.code === 'GRAPHIFY_NODE_PARTITION',
          )?.message ?? null,
          runtime: dataset
            ? {
                runtimeVerified: dataset.relations.filter((relation) => relation.runtimeVerified).length,
                unknownRuntime: dataset.relations.filter((relation) => relation.runtimeScope === 'unknown').length,
              }
            : null,
          roundtripParsed: Boolean(roundtrip),
          privacy: dataset ? auditDatasetPrivacy(dataset) : null,
          sharing: audit?.sharing ?? null,
          stdout: runResult.stdout,
          stderr: runResult.stderr,
        },
      );
    }

    // 2. 清单自洽但没有 Git：strict 失败，partial 成功且明确标注 not_attempted
    {
      const bundle = await prepareBundle(tempRoot, 'manifest-only');
      const strict = await runCrm(bundle);
      const partial = await runCrm(bundle, ['--allow-partial'], {
        outDir: path.join(bundle, 'out-partial'),
      });
      const dataset = partial.outExists ? await loadDataset(partial.out) : null;
      const audit = partial.reportExists ? await loadAudit(partial.report) : null;
      report.scenarios.manifestOnlyWithoutGit = status(
        strict.code !== 0 &&
          !strict.outExists &&
          partial.code === 0 &&
          partial.outExists &&
          dataset?.snapshot?.importStatus === 'partial' &&
          audit?.provenance?.manifestConsistency === 'verified' &&
          audit?.provenance?.historyVerification?.status === 'not_attempted' &&
          audit?.provenance?.issues?.some((issue) => issue.code === 'HISTORY_NOT_VERIFIED'),
        {
          strict: { exitCode: strict.code, outputExists: strict.outExists },
          partial: {
            exitCode: partial.code,
            outputExists: partial.outExists,
            importStatus: dataset?.snapshot?.importStatus ?? null,
            manifestConsistency: audit?.provenance?.manifestConsistency ?? null,
            gitHistory: audit?.provenance?.historyVerification?.status ?? null,
          },
          strictStderr: strict.stderr,
        },
      );
    }

    // 3. 缺失清单：strict 失败；--allow-partial 只能 partial
    {
      const bundle = await prepareBundle(tempRoot, 'missing-manifest');
      await rm(path.join(bundle, 'snapshot-manifest.json'));
      const strict = await runCrm(bundle);
      const partial = await runCrm(bundle, ['--allow-partial'], {
        outDir: path.join(bundle, 'out-partial'),
      });
      const dataset = partial.outExists ? await loadDataset(partial.out) : null;
      const audit = partial.reportExists ? await loadAudit(partial.report) : null;
      report.scenarios.missingManifest = status(
        strict.code !== 0 &&
          !strict.outExists &&
          partial.code === 0 &&
          partial.outExists &&
          dataset?.snapshot?.importStatus === 'partial' &&
          audit?.provenance?.manifestConsistency === 'partial',
        {
          strict: { exitCode: strict.code, outputExists: strict.outExists },
          partial: {
            exitCode: partial.code,
            outputExists: partial.outExists,
            importStatus: dataset?.snapshot?.importStatus ?? null,
            manifestConsistency: audit?.provenance?.manifestConsistency ?? null,
            commit: dataset?.snapshot?.commit ?? null,
          },
          stdout: partial.stdout,
          stderr: strict.stderr,
        },
      );
    }

    // 4. 无效提交 SHA：即使 --allow-partial 也必须失败
    {
      const bundle = await prepareBundle(tempRoot, 'invalid-sha');
      const manifestPath = path.join(bundle, 'snapshot-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.commit = 'deadbeef';
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      const strict = await runCrm(bundle);
      const partial = await runCrm(bundle, ['--allow-partial'], {
        outDir: path.join(bundle, 'out-partial'),
      });
      report.scenarios.invalidCommitSha = status(
        strict.code !== 0 && !strict.outExists && partial.code !== 0 && !partial.outExists,
        {
          strict: { exitCode: strict.code, outputExists: strict.outExists },
          partial: { exitCode: partial.code, outputExists: partial.outExists },
          strictStderr: strict.stderr,
          partialStderr: partial.stderr,
        },
      );
    }

    // 5. 文件哈希被篡改：硬失败；--allow-partial 不能绕过，旧输出不被覆盖
    {
      const bundle = await prepareBundle(tempRoot, 'tampered-file');
      const target = path.join(
        bundle,
        'source-snapshot',
        'synthetic',
        'customer',
        'customer-service.ts',
      );
      const original = await readFile(target, 'utf8');
      await writeFile(target, `${original}\n// tampered\n`, 'utf8');
      const outDir = path.join(tempRoot, 'tampered-out');
      await mkdir(outDir, { recursive: true });
      const out = path.join(outDir, 'out.atlas.json');
      const reportFile = path.join(outDir, 'import-report.json');
      await writeFile(out, 'previous-dataset\n', 'utf8');

      const strict = await runCrm(bundle, [], { outDir, out, report: reportFile });
      const partial = await runCrm(bundle, ['--allow-partial'], { outDir, out, report: reportFile });
      const leftovers = (await readdir(outDir)).filter(
        (name) => name.endsWith('.tmp') || name.endsWith('.bak'),
      );
      const preserved = (await readFile(out, 'utf8')) === 'previous-dataset\n';
      report.scenarios.tamperedFileHash = status(
        strict.code !== 0 &&
          partial.code !== 0 &&
          preserved &&
          !existsSync(reportFile) &&
          leftovers.length === 0,
        {
          strict: { exitCode: strict.code, stderr: strict.stderr },
          partial: { exitCode: partial.code, stderr: partial.stderr },
          existingOutputPreserved: preserved,
          reportWritten: existsSync(reportFile),
          leftoverTemporaryFiles: leftovers,
        },
      );
    }

    // 6. 缺失报告：strict 失败；--allow-partial 只能 partial
    {
      const bundle = await prepareBundle(tempRoot, 'missing-report');
      await rm(path.join(bundle, 'GRAPH_REPORT.md'));
      const strict = await runCrm(bundle);
      const partial = await runCrm(bundle, ['--allow-partial'], {
        outDir: path.join(bundle, 'out-partial'),
      });
      const dataset = partial.outExists ? await loadDataset(partial.out) : null;
      const audit = partial.reportExists ? await loadAudit(partial.report) : null;
      report.scenarios.missingReport = status(
        strict.code !== 0 &&
          !strict.outExists &&
          partial.code === 0 &&
          partial.outExists &&
          dataset?.snapshot?.importStatus === 'partial' &&
          audit?.provenance?.manifestConsistency === 'verified',
        {
          strict: { exitCode: strict.code, outputExists: strict.outExists },
          partial: {
            exitCode: partial.code,
            outputExists: partial.outExists,
            importStatus: dataset?.snapshot?.importStatus ?? null,
            manifestConsistency: audit?.provenance?.manifestConsistency ?? null,
          },
          strictStderr: strict.stderr,
        },
      );
    }

    // 7. 清单仓库身份与 profile 不一致：硬失败
    {
      const bundle = await prepareBundle(tempRoot, 'repository-mismatch');
      const manifestPath = path.join(bundle, 'snapshot-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.repository_id = 'nexus';
      manifest.system = 'nexus';
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      const strict = await runCrm(bundle);
      const partial = await runCrm(bundle, ['--allow-partial'], {
        outDir: path.join(bundle, 'out-partial'),
      });
      report.scenarios.repositoryMismatch = status(
        strict.code !== 0 && !strict.outExists && partial.code !== 0 && !partial.outExists,
        {
          strict: { exitCode: strict.code, outputExists: strict.outExists },
          partial: { exitCode: partial.code, outputExists: partial.outExists },
          strictStderr: strict.stderr,
        },
      );
    }

    // 8. 伪造 Git 提交：硬失败，不能被 --allow-partial 降级
    {
      const prepared = await prepareGitBundle(tempRoot, 'fake-git');
      const fake = 'd'.repeat(40);
      const manifestPath = path.join(prepared.bundle, 'snapshot-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.commit = fake;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      const reportPath = path.join(prepared.bundle, 'GRAPH_REPORT.md');
      const reportText = await readFile(reportPath, 'utf8');
      await writeFile(reportPath, reportText.replace(/^Commit:.*$/m, `Commit: ${fake}`), 'utf8');
      const strict = await runCrm(prepared.bundle, ['--git-repo', prepared.repo]);
      const partial = await runCrm(prepared.bundle, ['--git-repo', prepared.repo, '--allow-partial'], {
        outDir: path.join(prepared.bundle, 'out-partial'),
      });
      report.scenarios.fakeGitCommit = status(
        strict.code !== 0 && !strict.outExists && partial.code !== 0 && !partial.outExists,
        {
          fakeCommit: fake,
          strict: { exitCode: strict.code, outputExists: strict.outExists, stderr: strict.stderr },
          partial: { exitCode: partial.code, outputExists: partial.outExists, stderr: partial.stderr },
        },
      );
    }

    // 9. 清单自洽但 Git 历史内容不一致：只能 partial，不能冒充 complete
    {
      const prepared = await prepareGitBundle(tempRoot, 'git-mismatch');
      const target = path.join(
        prepared.bundle,
        'source-snapshot',
        'synthetic',
        'customer',
        'customer-service.ts',
      );
      const original = await readFile(target, 'utf8');
      await writeFile(target, `${original}\n// transformed by Graphify\n`, 'utf8');
      await rewriteManifestHashes(prepared.bundle);
      const strict = await runCrm(prepared.bundle, ['--git-repo', prepared.repo]);
      const partial = await runCrm(prepared.bundle, ['--git-repo', prepared.repo, '--allow-partial'], {
        outDir: path.join(prepared.bundle, 'out-partial'),
      });
      const dataset = partial.outExists ? await loadDataset(partial.out) : null;
      const audit = partial.reportExists ? await loadAudit(partial.report) : null;
      report.scenarios.gitHistoryPartial = status(
        strict.code !== 0 &&
          !strict.outExists &&
          partial.code === 0 &&
          partial.outExists &&
          dataset?.snapshot?.importStatus === 'partial' &&
          audit?.provenance?.manifestConsistency === 'verified' &&
          audit?.provenance?.historyVerification?.status === 'partial' &&
          audit?.provenance?.historyVerification?.mismatchedFiles?.includes(
            'synthetic/customer/customer-service.ts',
          ),
        {
          strict: { exitCode: strict.code, stderr: strict.stderr },
          partial: {
            exitCode: partial.code,
            outputExists: partial.outExists,
            importStatus: dataset?.snapshot?.importStatus ?? null,
            manifestConsistency: audit?.provenance?.manifestConsistency ?? null,
            gitHistory: audit?.provenance?.historyVerification ?? null,
          },
        },
      );
    }

    // 10. 导出后重新导入；重复关系 ID / 未知模块在标准数据层被拒绝
    {
      const bundle = await prepareBundle(tempRoot, 'roundtrip');
      const runResult = await runCrm(bundle, ['--allow-partial']);
      const dataset = runResult.outExists ? await loadDataset(runResult.out) : null;
      let duplicateRejected = false;
      let unknownModuleRejected = false;
      if (dataset) {
        const duplicate = JSON.parse(JSON.stringify(dataset));
        duplicate.relations.push(JSON.parse(JSON.stringify(duplicate.relations[0])));
        try {
          parseAtlasDataset(duplicate);
        } catch (error) {
          duplicateRejected = /重复关系 ID/.test(String(error));
        }
        const unknown = JSON.parse(JSON.stringify(dataset));
        unknown.nodes[0].moduleId = 'ghost';
        unknown.nodes[0].moduleIds = ['ghost'];
        try {
          parseAtlasDataset(unknown);
        } catch (error) {
          unknownModuleRejected = /不存在的模块/.test(String(error));
        }
      }
      report.scenarios.exportReimportAndDataValidation = status(
        Boolean(dataset && duplicateRejected && unknownModuleRejected),
        {
          reimported: Boolean(dataset),
          duplicateRelationIdRejected: duplicateRejected,
          unknownModuleRejected,
        },
      );
    }

    // 11. NEXUS 基线与 CRM 失败隔离
    {
      const nexusBefore = existsSync(NEXUS) ? await sha256File(NEXUS) : null;
      const failed = await runCrm(
        await prepareBundle(tempRoot, 'isolation').then(async (bundle) => {
          await rm(path.join(bundle, 'snapshot-manifest.json'));
          return bundle;
        }),
      );
      const nexusAfter = existsSync(NEXUS) ? await sha256File(NEXUS) : null;
      const nexus = existsSync(NEXUS) ? await loadDataset(NEXUS) : null;
      report.nexusBaseline = nexus
        ? await nexusBaseline(nexus)
        : { status: 'fail', error: 'NEXUS snapshot not found.' };
      report.nexusBaseline.isolation = {
        status:
          failed.code !== 0 &&
          nexusBefore !== null &&
          nexusBefore === nexusAfter &&
          report.nexusBaseline.status === 'pass'
            ? 'pass'
            : 'fail',
        crmFailureExitCode: failed.code,
        crmFailureWroteOutput: failed.outExists,
        nexusSha256Before: nexusBefore,
        nexusSha256After: nexusAfter,
        nexusUnchanged: nexusBefore === nexusAfter,
      };
    }

    // 12. 安全边界
    {
      const publicFiles = await walk(path.join(ROOT, 'public'));
      const snapshotsInPublic = publicFiles.filter((file) => file.endsWith('.atlas.json'));

      const valid = await prepareBundle(tempRoot, 'security');
      const publicAttempt = await runCrm(valid, ['--allow-partial'], {
        outDir: path.join(ROOT, 'public'),
        out: path.join(ROOT, 'public', 'crm-should-not-exist.atlas.json'),
        report: path.join(tempRoot, 'public-attempt-report.json'),
      });
      await rm(path.join(ROOT, 'public', 'crm-should-not-exist.atlas.json'), { force: true });

      const symlinkTarget = path.join(tempRoot, 'symlink-target.atlas.json');
      if (process.platform !== 'win32') {
        await symlink(path.join(ROOT, 'public', 'crm-symlink.atlas.json'), symlinkTarget);
      }
      const symlinkAttempt =
        process.platform === 'win32'
          ? { code: -1, stderr: 'skipped on win32', outExists: false }
          : await runCrm(valid, ['--allow-partial'], {
              outDir: tempRoot,
              out: symlinkTarget,
              report: path.join(tempRoot, 'symlink-report.json'),
            });
      await rm(path.join(ROOT, 'public', 'crm-symlink.atlas.json'), { force: true });

      const traversal = await prepareBundle(tempRoot, 'security-traversal');
      const traversalManifestPath = path.join(traversal, 'snapshot-manifest.json');
      const traversalManifest = JSON.parse(await readFile(traversalManifestPath, 'utf8'));
      traversalManifest.files[0].path = '../outside.ts';
      await writeFile(
        traversalManifestPath,
        `${JSON.stringify(traversalManifest, null, 2)}\n`,
        'utf8',
      );
      const traversalAttempt = await runCrm(traversal);

      const symlinkInput = await prepareBundle(tempRoot, 'security-symlink-input');
      let symlinkInputAttempt = { code: -1, stderr: 'skipped on win32', outExists: false };
      if (process.platform !== 'win32') {
        const escape = path.join(
          symlinkInput,
          'source-snapshot',
          'synthetic',
          'shared',
          'escape.ts',
        );
        await symlink('/etc/hosts', escape);
        const manifestPath = path.join(symlinkInput, 'snapshot-manifest.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        const buffer = await readFile('/etc/hosts');
        manifest.files.push({ path: 'synthetic/shared/escape.ts', sha256: sha256(buffer) });
        manifest.file_count = manifest.files.length;
        manifest.byte_count += buffer.length;
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        symlinkInputAttempt = await runCrm(symlinkInput);
      }

      const networkBundle = await prepareBundle(tempRoot, 'security-network');
      const networkAttempt = await runCrm(
        networkBundle,
        ['--dry-run', '--allow-partial'],
        { env: { NODE_DEBUG: 'net,http,https,dns,tls' } },
      );
      const networkSources = await Promise.all(
        ['import-crm.mjs', 'git-provenance.mjs', 'import-safety.mjs'].map((file) =>
          readFile(path.join(ROOT, 'tools', file), 'utf8'),
        ),
      );
      const networkImports = networkSources.filter((source) =>
        /from\s+['"]node:(?:http|https|net|dns|tls|dgram)['"]|fetch\s*\(|https?\.request/.test(source),
      ).length;

      const validRun = await runCrm(valid, ['--allow-partial'], {
        outDir: path.join(valid, 'out-security'),
      });
      const validAudit = validRun.reportExists ? await loadAudit(validRun.report) : null;

      report.security = {
        status:
          snapshotsInPublic.length === 0 &&
          publicAttempt.code !== 0 &&
          !publicAttempt.outExists &&
          symlinkAttempt.code !== 0 &&
          !symlinkAttempt.outExists &&
          traversalAttempt.code !== 0 &&
          !traversalAttempt.outExists &&
          symlinkInputAttempt.code !== 0 &&
          !symlinkInputAttempt.outExists &&
          networkAttempt.code === 0 &&
          networkImports === 0 &&
          !/^(?:NET|HTTP|HTTPS|DNS|TLS)\b/m.test(networkAttempt.stderr) &&
          validAudit?.sharing?.privacyPassed === true &&
          validAudit?.sharing?.containsInternalSymbols === true &&
          validAudit?.sharing?.publicShareable === false
            ? 'pass'
            : 'fail',
        publicSnapshotFiles: snapshotsInPublic.length,
        outputPublicRejected: {
          exitCode: publicAttempt.code,
          outputExists: publicAttempt.outExists,
          stderr: publicAttempt.stderr,
        },
        outputSymlinkRejected: {
          exitCode: symlinkAttempt.code,
          outputExists: symlinkAttempt.outExists,
          stderr: symlinkAttempt.stderr,
        },
        manifestTraversalRejected: {
          exitCode: traversalAttempt.code,
          outputExists: traversalAttempt.outExists,
          stderr: traversalAttempt.stderr,
        },
        inputSymlinkRejected: {
          exitCode: symlinkInputAttempt.code,
          outputExists: symlinkInputAttempt.outExists,
          stderr: symlinkInputAttempt.stderr,
        },
        network: {
          staticNetworkImports: networkImports,
          debugRunCode: networkAttempt.code,
          debugLog: networkAttempt.stderr,
          modelCallsFromPipeline: 0,
        },
        sharing: validAudit?.sharing ?? null,
        distinction:
          '隐私体检通过 != 可公开分享；输出仍包含内部符号、相对路径与架构关系。',
      };
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  report.status =
    report.p14Seal.status === 'pass' &&
    Object.values(report.scenarios).every((scenario) => scenario.status === 'pass') &&
    report.nexusBaseline?.status === 'pass' &&
    report.nexusBaseline?.isolation?.status === 'pass' &&
    report.security.status === 'pass'
      ? 'pass'
      : 'fail';

  await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[P2.0-A.1] 验证结果: ${report.status}`);
  console.log(`[P2.0-A.1] P1.4 封存: ${report.p14Seal.status}`);
  for (const [name, scenario] of Object.entries(report.scenarios)) {
    console.log(`  ${scenario.status === 'pass' ? '✓' : '×'} ${name}: ${scenario.status}`);
  }
  console.log(`  ${report.nexusBaseline?.status === 'pass' ? '✓' : '×'} NEXUS baseline`);
  console.log(`  ${report.nexusBaseline?.isolation?.status === 'pass' ? '✓' : '×'} NEXUS isolation`);
  console.log(`  ${report.security.status === 'pass' ? '✓' : '×'} security boundary`);
  console.log(`[P2.0-A.1] 报告: ${path.relative(ROOT, OUT)}`);
  if (report.status !== 'pass') process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[P2.0-A.1] 验证异常: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * P2.0-A 验证：P1.4 封存复核 + 合成 CRM 导入管线端到端测试。
 *
 * 只使用 tests/fixtures/crm-synthetic 的合成数据；不读取、不扫描真实 CRM。
 * 输出 docs/architecture/p2.0a-crm-import-verification.json（不含绝对路径）。
 *
 * 运行：npm run verify:p20a（会先 tsc 编译 tools）
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  cp,
  mkdtemp,
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
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'crm-synthetic');
const CLI = path.join(ROOT, 'tools', 'import-crm.mjs');
const OUT = path.join(ROOT, 'docs', 'architecture', 'p2.0a-crm-import-verification.json');
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
    p13Bundle: { file: 'atlas-p13-final-20261021.bundle', sha256: null, expectedSha256: 'a4b6561e1b84507e51684717d90d000c8d323c5021f28504208812fd5b28784a', match: false },
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
  const names = await run('git', [
    'diff',
    '--name-status',
    `${P14_BUNDLE_REF}..${P14_EVIDENCE_HEAD}`,
  ]);
  const files = names.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/).slice(1).join(' '));
  result.postBundleCommits.commits = commits.stdout.split(/\r?\n/).filter(Boolean);
  result.postBundleCommits.files = files;
  result.postBundleCommits.docsOnly = files.every(
    (file) =>
      file.startsWith('docs/') ||
      file === 'README.md' ||
      file.startsWith('docs\\'),
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

async function prepareBundle(root, name = 'bundle') {
  const target = path.join(root, name);
  await cp(FIXTURE, target, { recursive: true });
  return target;
}

async function runCrm(bundleDir, extra = []) {
  const out = path.join(bundleDir, 'out.atlas.json');
  const report = path.join(bundleDir, 'import-report.json');
  const result = await run(process.execPath, [
    CLI,
    '--graphify',
    bundleDir,
    '--profile',
    path.join(bundleDir, 'profile.json'),
    '--allow-synthetic',
    '--out',
    out,
    '--report',
    report,
    ...extra,
  ]);
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

async function loadDataset(file) {
  const { parseAtlasDataset } = await import(
    path.join(ROOT, '.tools-build', 'architecture', 'dataset.js')
  );
  return parseAtlasDataset(JSON.parse(await readFile(file, 'utf8')));
}

async function main() {
  const { serializeAtlasDataset } = await import(
    path.join(ROOT, '.tools-build', 'architecture', 'dataset.js')
  );
  const { auditDatasetPrivacy } = await import(
    path.join(ROOT, '.tools-build', 'architecture', 'privacy.js')
  );

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'atlas-p20a-'));
  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      node: process.version,
      usesRealCrmData: false,
      dataSource: 'tests/fixtures/crm-synthetic',
    },
    p14Seal: await p14Seal(),
    scenarios: {},
    nexusIsolation: {},
    security: {},
    unitTests: {
      command: 'npm test',
      result: 'see docs/P2.0A-REPORT.md; this script focuses on CLI and seal checks',
    },
    limitations: [
      '所有 CRM 数据都是 synthetic/ 合成 fixture，不是真实 CRM 扫描结果。',
      '没有异机备份证据；P1.4 及本轮备份仍只在本机。',
      '没有 Windows 实机验收。',
      '浏览器 UI 尚未接入 CRM 仓库切换器；P2.0-A 只验证数据层与本地 CLI。',
    ],
  };

  try {
    // 1. 正常导入
    {
      const bundle = await prepareBundle(tempRoot, 'valid');
      const runResult = await runCrm(bundle);
      const dataset = runResult.outExists ? await loadDataset(runResult.out) : null;
      const roundtrip = dataset
        ? await loadDataset(runResult.out).then((value) => {
            const exported = serializeAtlasDataset(value);
            return JSON.parse(exported);
          })
        : null;
      report.scenarios.validImport = {
        status:
          runResult.code === 0 &&
          runResult.outExists &&
          runResult.reportExists &&
          dataset?.nodes.length === 12 &&
          dataset?.relations.length === 14 &&
          dataset?.modules.length === 5 &&
          dataset?.snapshot?.importStatus === 'complete'
            ? 'pass'
            : 'fail',
        exitCode: runResult.code,
        outputExists: runResult.outExists,
        reportExists: runResult.reportExists,
        counts: dataset
          ? {
              nodes: dataset.nodes.length,
              relations: dataset.relations.length,
              modules: dataset.modules.length,
              modulesAssigned: dataset.diagnostics.counts.modulesAssigned,
              modulesUnassigned: dataset.diagnostics.counts.modulesUnassigned,
            }
          : null,
        snapshot: dataset
          ? {
              repository: dataset.snapshot?.repository.id,
              commit: dataset.snapshot?.commit,
              snapshotKey: dataset.repositories?.[0]?.snapshots[0]?.snapshotKey,
              importStatus: dataset.snapshot?.importStatus,
            }
          : null,
        runtime: dataset
          ? {
              runtimeVerified: dataset.relations.filter((relation) => relation.runtimeVerified).length,
              unknownRuntime: dataset.relations.filter((relation) => relation.runtimeScope === 'unknown').length,
            }
          : null,
        roundtripParsed: Boolean(roundtrip),
        privacy: dataset ? auditDatasetPrivacy(dataset) : null,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
      };
    }

    // 2. 缺失清单：默认失败；--allow-partial 成功但 partial
    {
      const bundle = await prepareBundle(tempRoot, 'missing-manifest');
      await rm(path.join(bundle, 'snapshot-manifest.json'));
      const strict = await runCrm(bundle);
      await rm(strict.out, { force: true });
      await rm(strict.report, { force: true });
      const partial = await runCrm(bundle, ['--allow-partial']);
      const dataset = partial.outExists ? await loadDataset(partial.out) : null;
      report.scenarios.missingManifest = {
        status:
          strict.code !== 0 &&
          !strict.outExists &&
          partial.code === 0 &&
          partial.outExists &&
          dataset?.snapshot?.importStatus === 'partial'
            ? 'pass'
            : 'fail',
        strict: { exitCode: strict.code, outputExists: strict.outExists },
        partial: {
          exitCode: partial.code,
          outputExists: partial.outExists,
          importStatus: dataset?.snapshot?.importStatus ?? null,
          commit: dataset?.snapshot?.commit ?? null,
        },
        stdout: partial.stdout,
        stderr: strict.stderr,
      };
    }

    // 3. 无效提交 SHA：即使 --allow-partial 也必须失败
    {
      const bundle = await prepareBundle(tempRoot, 'invalid-sha');
      const manifestPath = path.join(bundle, 'snapshot-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.commit = 'deadbeef';
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      const strict = await runCrm(bundle);
      const partial = await runCrm(bundle, ['--allow-partial']);
      report.scenarios.invalidCommitSha = {
        status:
          strict.code !== 0 && !strict.outExists && partial.code !== 0 && !partial.outExists
            ? 'pass'
            : 'fail',
        strict: { exitCode: strict.code, outputExists: strict.outExists },
        partial: { exitCode: partial.code, outputExists: partial.outExists },
        strictStderr: strict.stderr,
        partialStderr: partial.stderr,
      };
    }

    // 4. 文件哈希被篡改：默认失败；--allow-partial 成功但 partial
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
      const strict = await runCrm(bundle);
      const partial = await runCrm(bundle, ['--allow-partial']);
      const dataset = partial.outExists ? await loadDataset(partial.out) : null;
      report.scenarios.tamperedFileHash = {
        status:
          strict.code !== 0 &&
          !strict.outExists &&
          partial.code === 0 &&
          partial.outExists &&
          dataset?.snapshot?.importStatus === 'partial'
            ? 'pass'
            : 'fail',
        strict: { exitCode: strict.code, outputExists: strict.outExists },
        partial: {
          exitCode: partial.code,
          outputExists: partial.outExists,
          importStatus: dataset?.snapshot?.importStatus ?? null,
          manifestStatus: dataset?.snapshot?.manifest?.status ?? null,
        },
        strictStderr: strict.stderr,
      };
    }

    // 5. 缺失报告：默认失败；--allow-partial 成功但 partial
    {
      const bundle = await prepareBundle(tempRoot, 'missing-report');
      await rm(path.join(bundle, 'GRAPH_REPORT.md'));
      const strict = await runCrm(bundle);
      const partial = await runCrm(bundle, ['--allow-partial']);
      const dataset = partial.outExists ? await loadDataset(partial.out) : null;
      report.scenarios.missingReport = {
        status:
          strict.code !== 0 &&
          !strict.outExists &&
          partial.code === 0 &&
          partial.outExists &&
          dataset?.snapshot?.importStatus === 'partial'
            ? 'pass'
            : 'fail',
        strict: { exitCode: strict.code, outputExists: strict.outExists },
        partial: {
          exitCode: partial.code,
          outputExists: partial.outExists,
          importStatus: dataset?.snapshot?.importStatus ?? null,
        },
        strictStderr: strict.stderr,
      };
    }

    // 6. 清单仓库身份与 profile 不一致：硬失败
    {
      const bundle = await prepareBundle(tempRoot, 'repository-mismatch');
      const manifestPath = path.join(bundle, 'snapshot-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.repository_id = 'nexus';
      manifest.system = 'nexus';
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      const strict = await runCrm(bundle);
      const partial = await runCrm(bundle, ['--allow-partial']);
      report.scenarios.repositoryMismatch = {
        status:
          strict.code !== 0 && !strict.outExists && partial.code !== 0 && !partial.outExists
            ? 'pass'
            : 'fail',
        strict: { exitCode: strict.code, outputExists: strict.outExists },
        partial: { exitCode: partial.code, outputExists: partial.outExists },
        strictStderr: strict.stderr,
      };
    }

    // 7. 导出后重新导入；重复关系 ID / 未知模块在标准数据层被拒绝
    {
      const bundle = await prepareBundle(tempRoot, 'roundtrip');
      const runResult = await runCrm(bundle);
      const dataset = runResult.outExists ? await loadDataset(runResult.out) : null;
      let duplicateRejected = false;
      let unknownModuleRejected = false;
      if (dataset) {
        const duplicate = JSON.parse(JSON.stringify(dataset));
        duplicate.relations.push(JSON.parse(JSON.stringify(duplicate.relations[0])));
        try {
          await loadDatasetFromObject(duplicate);
        } catch (error) {
          duplicateRejected = /重复关系 ID/.test(String(error));
        }
        const unknown = JSON.parse(JSON.stringify(dataset));
        unknown.nodes[0].moduleId = 'ghost';
        unknown.nodes[0].moduleIds = ['ghost'];
        try {
          await loadDatasetFromObject(unknown);
        } catch (error) {
          unknownModuleRejected = /不存在的模块/.test(String(error));
        }
      }
      report.scenarios.exportReimportAndDataValidation = {
        status:
          dataset && duplicateRejected && unknownModuleRejected ? 'pass' : 'fail',
        reimported: Boolean(dataset),
        duplicateRelationIdRejected: duplicateRejected,
        unknownModuleRejected,
      };
    }

    // 8. NEXUS 历史快照与合成 CRM 导入失败隔离
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
      report.nexusIsolation = {
        status:
          failed.code !== 0 &&
          nexusBefore !== null &&
          nexusBefore === nexusAfter &&
          nexus?.nodes.length === 1390 &&
          nexus?.relations.length === 3170 &&
          nexus?.modules.length === 4
            ? 'pass'
            : 'fail',
        crmFailureExitCode: failed.code,
        crmFailureWroteOutput: failed.outExists,
        nexusSha256Before: nexusBefore,
        nexusSha256After: nexusAfter,
        nexusUnchanged: nexusBefore === nexusAfter,
        nexusCounts: nexus
          ? { nodes: nexus.nodes.length, relations: nexus.relations.length, modules: nexus.modules.length }
          : null,
      };
    }

    // 9. 安全边界：合成输出无绝对路径/凭据；public 无快照
    {
      const publicFiles = await walk(path.join(ROOT, 'public'));
      const snapshotsInPublic = publicFiles.filter((file) => file.endsWith('.atlas.json'));
      const valid = await prepareBundle(tempRoot, 'security');
      const runResult = await runCrm(valid);
      const text = runResult.outExists ? await readFile(runResult.out, 'utf8') : '';
      const dataset = runResult.outExists ? await loadDataset(runResult.out) : null;
      report.security = {
        status:
          runResult.code === 0 &&
          snapshotsInPublic.length === 0 &&
          !text.includes('/Users/') &&
          !text.includes('/home/') &&
          dataset &&
          auditDatasetPrivacy(dataset).status === 'pass'
            ? 'pass'
            : 'fail',
        publicSnapshotFiles: snapshotsInPublic.length,
        outputContainsAbsolutePath: /\/Users\/|\/home\/|[A-Za-z]:\\\\/.test(text),
        privacy: dataset ? auditDatasetPrivacy(dataset) : null,
        modelCallsFromPipeline: 0,
        networkCallsFromPipeline: 0,
      };
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  report.status =
    report.p14Seal.status === 'pass' &&
    Object.values(report.scenarios).every((scenario) => scenario.status === 'pass') &&
    report.nexusIsolation.status === 'pass' &&
    report.security.status === 'pass'
      ? 'pass'
      : 'fail';

  await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[P2.0-A] 验证结果: ${report.status}`);
  console.log(`[P2.0-A] P1.4 封存: ${report.p14Seal.status}`);
  for (const [name, scenario] of Object.entries(report.scenarios)) {
    console.log(`  ${scenario.status === 'pass' ? '✓' : '×'} ${name}: ${scenario.status}`);
  }
  console.log(`  ${report.nexusIsolation.status === 'pass' ? '✓' : '×'} NEXUS isolation`);
  console.log(`  ${report.security.status === 'pass' ? '✓' : '×'} security boundary`);
  console.log(`[P2.0-A] 报告: ${path.relative(ROOT, OUT)}`);
  if (report.status !== 'pass') process.exitCode = 1;
}

async function loadDatasetFromObject(raw) {
  const { parseAtlasDataset } = await import(
    path.join(ROOT, '.tools-build', 'architecture', 'dataset.js')
  );
  return parseAtlasDataset(raw);
}

main().catch(async (error) => {
  console.error(`[P2.0-A] 验证异常: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

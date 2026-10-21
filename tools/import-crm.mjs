#!/usr/bin/env node
/**
 * CRM Graphify → ATLAS 本地导入 CLI（P2.0-A）。
 *
 * 只读取用户指定的本地目录：
 *   graph.json / snapshot-manifest.json / GRAPH_REPORT.md / source-snapshot/
 * 以及一个显式的 repository profile。不做网络请求，不上传任何内容。
 *
 * 安全边界：
 * - 真实 CRM（profile.synthetic=false）只能写入 local-data/crm/ 或项目外目录；
 * - 输出先按 ATLAS Schema 重新解析，再检查隐私体检，全部通过才原子写入；
 * - 失败时不覆盖已有文件，也不影响 NEXUS 的 local-data。
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BUILD = path.join(ROOT, '.tools-build', 'architecture');

function usage() {
  console.log(`DACHUAN ATLAS · CRM 本地历史快照导入（P2.0-A）

用法:
  npm run import:crm -- --graphify <目录> --profile <profile.json> [选项]

必填:
  --graphify <path>       Graphify 产物目录（含 graph.json / snapshot-manifest.json / GRAPH_REPORT.md）
  --profile <path>        CRM repository profile（模块定义、路径规则、审核记录）

选项:
  --out <path>            输出 ATLAS 数据集；默认 local-data/crm/crm-<日期>-<提交>.atlas.json
  --report <path>         导入审计报告；默认与输出同目录
  --expect-commit <sha>   校验完整 40 位提交 SHA
  --repository-id <id>    期望仓库 ID（默认 crm；必须与 profile 一致）
  --allow-partial         来源核对未达完整状态时仍导入，并标记 partial
  --allow-synthetic       允许 synthetic profile（只用于管线测试）
  --dry-run               只转换与校验，不写文件
  --help                  显示帮助

示例（合成 fixture，不含真实 CRM 数据）:
  npm run import:crm -- --graphify tests/fixtures/crm-synthetic \\
    --profile tests/fixtures/crm-synthetic/profile.json --allow-synthetic --dry-run
`);
}

function parseArgs(argv) {
  const args = {
    allowPartial: false,
    allowSynthetic: false,
    dryRun: false,
    help: false,
    repositoryId: 'crm',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`参数 ${token} 缺少取值`);
      index += 1;
      return value;
    };
    switch (token) {
      case '--graphify':
        args.graphify = next();
        break;
      case '--profile':
        args.profile = next();
        break;
      case '--out':
        args.out = next();
        break;
      case '--report':
        args.report = next();
        break;
      case '--expect-commit':
        args.expectCommit = next();
        break;
      case '--repository-id':
        args.repositoryId = next();
        break;
      case '--allow-partial':
        args.allowPartial = true;
        break;
      case '--allow-synthetic':
        args.allowSynthetic = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`未知参数 ${token}`);
    }
  }
  return args;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function relDisplay(absolute) {
  const relative = path.relative(ROOT, absolute);
  return relative.startsWith('..') || path.isAbsolute(relative)
    ? path.basename(absolute)
    : relative;
}

async function readTextFile(file, label, required = true) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    if (!required) return null;
    throw new Error(`${label} 不存在或无法读取。`);
  }
}

async function readJsonFile(file, label, required = true) {
  const text = await readTextFile(file, label, required);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} 不是合法 JSON。`);
  }
}

function isInside(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function assertSafeOutput(file, profile, label) {
  const publicDir = path.join(ROOT, 'public');
  const distDir = path.join(ROOT, 'dist');
  if (isInside(publicDir, file) || isInside(distDir, file)) {
    throw new Error(`安全边界：拒绝把 ${label} 写入 public/ 或 dist/。`);
  }
  if (profile.synthetic) return;
  const localCrm = path.join(ROOT, 'local-data', 'crm');
  if (isInside(ROOT, file) && !isInside(localCrm, file)) {
    throw new Error(
      `安全边界：真实 CRM ${label} 只能写入 local-data/crm/ 或项目外目录；拒绝写入仓库其他位置。`,
    );
  }
}

async function verifyManifestFiles(manifest, snapshotRoot) {
  const mismatches = [];
  const missing = [];
  let verifiedFiles = 0;
  let measuredBytes = 0;
  for (const entry of manifest.files) {
    const absolute = path.resolve(snapshotRoot, entry.path);
    const outside = path.relative(snapshotRoot, absolute);
    if (outside.startsWith('..') || path.isAbsolute(outside)) {
      mismatches.push(entry.path);
      continue;
    }
    try {
      const data = await readFile(absolute);
      measuredBytes += data.length;
      if (sha256(data) === entry.sha256) verifiedFiles += 1;
      else mismatches.push(entry.path);
    } catch {
      missing.push(entry.path);
    }
  }
  const declaredFileCount = manifest.fileCount ?? manifest.files.length;
  const countOk = declaredFileCount === manifest.files.length;
  const bytesOk = manifest.byteCount === null || manifest.byteCount === measuredBytes;
  return {
    fileCount: manifest.files.length,
    declaredFileCount,
    declaredByteCount: manifest.byteCount,
    measuredBytes,
    verifiedFiles,
    mismatches,
    missing,
    countOk,
    bytesOk,
    ok:
      mismatches.length === 0 &&
      missing.length === 0 &&
      countOk &&
      bytesOk &&
      verifiedFiles === manifest.files.length,
  };
}

async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rm(file, { force: true });
  await rename(temporary, file);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.graphify) {
    usage();
    throw new Error('缺少 --graphify 参数。');
  }
  if (!args.profile) {
    throw new Error('缺少 --profile 参数；CRM 必须有自己的模块定义，不能复用 NEXUS 四模块。');
  }

  let profileTools;
  let provenanceTools;
  let adapterTools;
  let datasetTools;
  let privacyTools;
  try {
    profileTools = await import(path.join(BUILD, 'repository-profile.js'));
    provenanceTools = await import(path.join(BUILD, 'import-provenance.js'));
    adapterTools = await import(path.join(BUILD, 'graphify-adapter.js'));
    datasetTools = await import(path.join(BUILD, 'dataset.js'));
    privacyTools = await import(path.join(BUILD, 'privacy.js'));
  } catch {
    throw new Error('工具尚未编译。请使用 npm run import:crm（会先运行 tsc）。');
  }

  const graphifyInput = path.resolve(process.cwd(), args.graphify);
  let inputStat;
  try {
    inputStat = await stat(graphifyInput);
  } catch {
    throw new Error(`--graphify 路径不存在：${path.basename(graphifyInput)}。`);
  }
  const graphifyDir = inputStat.isDirectory() ? graphifyInput : path.dirname(graphifyInput);

  const profilePath = path.resolve(process.cwd(), args.profile);
  const profileRaw = await readJsonFile(profilePath, 'CRM profile');
  const profile = profileTools.parseRepositoryProfile(profileRaw, {
    expectedRepositoryId: args.repositoryId,
    expectedSystem: 'crm',
    allowSynthetic: args.allowSynthetic,
  });

  const graphPath = path.join(graphifyDir, 'graph.json');
  const graphText = await readTextFile(graphPath, 'graph.json');
  let graph;
  try {
    graph = JSON.parse(graphText);
  } catch {
    throw new Error('graph.json 不是合法 JSON。');
  }

  const manifestPath = path.join(graphifyDir, 'snapshot-manifest.json');
  const reportPath = path.join(graphifyDir, 'GRAPH_REPORT.md');
  const manifestText = await readTextFile(manifestPath, 'snapshot-manifest.json', false);
  const reportText = await readTextFile(reportPath, 'GRAPH_REPORT.md', false);
  let manifestRaw = null;
  if (manifestText !== null) {
    try {
      manifestRaw = JSON.parse(manifestText);
    } catch {
      throw new Error('snapshot-manifest.json 不是合法 JSON。');
    }
  }
  if (manifestRaw === null && !args.allowPartial) {
    throw new Error(
      '缺少 snapshot-manifest.json。没有清单就无法验证提交与逐文件完整性；如只做结构转换，请加 --allow-partial。',
    );
  }
  if (reportText === null && !args.allowPartial) {
    throw new Error(
      '缺少 GRAPH_REPORT.md。没有报告就无法交叉核对生成时间与扫描记录；如只做结构转换，请加 --allow-partial。',
    );
  }

  const manifest = manifestRaw
    ? provenanceTools.readSnapshotManifest(manifestRaw, {
        expectedRepositoryId: profile.repository.id,
        expectedSystem: profile.repository.system,
      })
    : null;

  let verification = null;
  if (manifest) {
    verification = await verifyManifestFiles(
      manifest,
      path.join(graphifyDir, 'source-snapshot'),
    );
    if (!verification.ok && !args.allowPartial) {
      const details = [
        verification.mismatches.length
          ? `SHA-256 不匹配 ${verification.mismatches.length} 个`
          : null,
        verification.missing.length
          ? `文件缺失 ${verification.missing.length} 个`
          : null,
        !verification.countOk
          ? `file_count 声明 ${verification.declaredFileCount}，实际 ${verification.fileCount}`
          : null,
        !verification.bytesOk
          ? `byte_count 声明 ${verification.declaredByteCount}，实测 ${verification.measuredBytes}`
          : null,
      ].filter(Boolean);
      throw new Error(
        `snapshot-manifest 校验失败：${details.join('；')}。如只做结构转换，请加 --allow-partial。`,
      );
    }
    if (!verification.ok) {
      console.warn('[P2.0-A] 警告：清单未通过逐文件校验，按 partial 导入。');
    }
  }

  const report = provenanceTools.parseGraphReport(reportText);
  const provenance = provenanceTools.evaluateImportProvenance({
    declared: {
      repositoryId: profile.repository.id,
      repositoryName: profile.repository.name,
      system: profile.repository.system,
    },
    manifest,
    report,
    expectedCommit: args.expectCommit,
    manifestVerified: verification?.ok === true,
    reportPresent: reportText !== null,
  });

  for (const issue of provenance.issues) {
    const prefix = issue.severity === 'warning' ? '警告' : '说明';
    console.log(`[P2.0-A] ${prefix}: ${issue.message}`);
  }
  if (!provenance.complete && !args.allowPartial) {
    throw new Error(
      '来源核对未达到完整状态（提交、仓库身份、逐文件清单或报告记录不完整）。如确认只做管线验证，请加 --allow-partial。',
    );
  }

  const importedAt = new Date().toISOString();
  const manifestVerification =
    verification && verification.ok
      ? {
          fileCount: verification.fileCount,
          byteCount: verification.measuredBytes,
          verifiedFiles: verification.verifiedFiles,
          verifiedAt: importedAt,
        }
      : null;

  const dataset = adapterTools.adaptGraphifyWithProfile(
    {
      graph,
      manifest: manifestRaw,
      options: {
        repositoryId: profile.repository.id,
        repositoryName: profile.repository.name,
        expectedRepositoryId: profile.repository.id,
        expectedCommit: args.expectCommit,
        commitOverride: provenance.commit === 'unknown' ? undefined : provenance.commit,
        generatedAt: provenance.generatedAt,
        scannedAt: provenance.scannedAt,
        importedAt,
        manifestVerification,
        importStatusOverride: provenance.complete ? 'complete' : 'partial',
      },
    },
    profile,
  );

  // 写出前立即按标准 Schema 重新解析，确保导出/再导入不会静默丢失字段。
  const serialized = datasetTools.serializeAtlasDataset(dataset);
  const reparsed = datasetTools.parseAtlasDataset(JSON.parse(serialized));
  const privacy = privacyTools.auditDatasetPrivacy(reparsed);
  if (privacy.status === 'fail') {
    throw new Error(
      `隐私体检失败：绝对路径 ${privacy.absolutePathCount} 处，凭据字段 ${privacy.credentialFieldCount} 处；拒绝写入。`,
    );
  }

  const date = (provenance.generatedAt ?? importedAt).slice(0, 10);
  const commitShort = dataset.snapshot?.commitShort ?? 'unknown';
  const defaultOut = path.join(
    ROOT,
    'local-data',
    'crm',
    `crm-${date}-${commitShort}.atlas.json`,
  );
  const outFile = args.out ? path.resolve(process.cwd(), args.out) : defaultOut;
  const reportFile = args.report
    ? path.resolve(process.cwd(), args.report)
    : path.join(path.dirname(outFile), `crm-import-report-${date}-${commitShort}.json`);
  if (outFile === reportFile) throw new Error('--out 与 --report 不能是同一个文件。');
  assertSafeOutput(outFile, profile, '数据集');
  assertSafeOutput(reportFile, profile, '导入报告');

  const inputHashes = {
    graph: { file: 'graph.json', sha256: sha256(Buffer.from(graphText, 'utf8')) },
    manifest:
      manifestText === null
        ? null
        : { file: 'snapshot-manifest.json', sha256: sha256(Buffer.from(manifestText, 'utf8')) },
    report:
      reportText === null
        ? null
        : { file: 'GRAPH_REPORT.md', sha256: sha256(Buffer.from(reportText, 'utf8')) },
    profile: {
      file: path.basename(profilePath),
      sha256: sha256(await readFile(profilePath)),
    },
  };

  const outputBytes = Buffer.byteLength(serialized, 'utf8');
  const outputHash = sha256(Buffer.from(serialized, 'utf8'));
  const audit = {
    generatedAt: importedAt,
    profile: {
      repositoryId: profile.repository.id,
      repositoryName: profile.repository.name,
      system: profile.repository.system,
      synthetic: profile.synthetic,
      modules: profile.modules.map((module) => module.id),
      coverageNotes: profile.coverageNotes,
    },
    provenance: {
      ...provenance,
      inputs: inputHashes,
      manifestVerification: verification
        ? {
            fileCount: verification.fileCount,
            declaredFileCount: verification.declaredFileCount,
            declaredByteCount: verification.declaredByteCount,
            measuredBytes: verification.measuredBytes,
            verifiedFiles: verification.verifiedFiles,
            mismatches: verification.mismatches,
            missing: verification.missing,
            countOk: verification.countOk,
            bytesOk: verification.bytesOk,
            ok: verification.ok,
          }
        : null,
    },
    snapshot: {
      id: dataset.snapshot?.id,
      snapshotKey: dataset.repositories?.[0]?.snapshots?.[0]?.snapshotKey ?? null,
      repository: dataset.snapshot?.repository,
      commit: dataset.snapshot?.commit,
      generatedAt: dataset.snapshot?.generatedAt,
      scannedAt: dataset.repositories?.[0]?.snapshots?.[0]?.scannedAt ?? null,
      graphifyVersion: dataset.snapshot?.graphifyVersion,
      graphifySchemaVersion: dataset.snapshot?.graphifySchemaVersion,
      atlasSchemaVersion: dataset.snapshot?.atlasSchemaVersion,
      importStatus: dataset.snapshot?.importStatus,
      history: dataset.snapshot?.history,
    },
    counts: reparsed.diagnostics.counts,
    relations: {
      total: reparsed.relations.length,
      repositoryScopes: reparsed.relations.reduce(
        (acc, relation) => {
          acc[relation.repositoryScope] += 1;
          return acc;
        },
        { 'intra-repository': 0, 'cross-repository': 0 },
      ),
      runtimeScopes: reparsed.relations.reduce(
        (acc, relation) => {
          acc[relation.runtimeScope] += 1;
          return acc;
        },
        { 'intra-runtime': 0, 'cross-runtime': 0, unknown: 0 },
      ),
      runtimeVerified: reparsed.relations.filter((relation) => relation.runtimeVerified).length,
      aiReviewed: reparsed.diagnostics.reviewCounts.aiReviewed,
      humanReviewed: reparsed.diagnostics.reviewCounts.humanReviewed,
    },
    modules: reparsed.modules.map((module) => ({
      id: module.id,
      name: module.name,
      repository: module.repository,
      system: module.system,
      review: module.review,
      reviewMethod: module.reviewRecord.method,
      ...module.stats,
    })),
    diagnostics: reparsed.diagnostics.issues,
    privacy,
    output: args.dryRun
      ? null
      : {
          file: relDisplay(outFile),
          bytes: outputBytes,
          sha256: outputHash,
        },
  };

  console.log('[P2.0-A] 来源核对');
  console.log(`  仓库: ${profile.repository.id} / ${profile.repository.name}${profile.synthetic ? '（合成验证）' : ''}`);
  console.log(`  提交: ${provenance.commit}（来源 ${provenance.commitSource}）`);
  console.log(`  扫描: ${provenance.scannedAt ?? '未记录'} / 生成: ${provenance.generatedAt ?? '未记录'}`);
  console.log(
    verification
      ? `  清单: ${verification.verifiedFiles}/${verification.fileCount} 文件通过 SHA-256，${verification.measuredBytes} bytes`
      : '  清单: 未提供',
  );
  console.log(`[P2.0-A] 转换结果`);
  console.log(
    `  节点 ${reparsed.diagnostics.counts.nodes} / 关系 ${reparsed.relations.length} / 模块 ${reparsed.modules.length}`,
  );
  console.log(
    `  模块归属 ${reparsed.diagnostics.counts.modulesAssigned} / 未分类 ${reparsed.diagnostics.counts.modulesUnassigned}`,
  );
  console.log(
    `  runtimeVerified ${audit.relations.runtimeVerified} / runtimeScope=unknown ${audit.relations.runtimeScopes.unknown}`,
  );
  console.log(`  导入状态: ${dataset.snapshot?.importStatus ?? 'unknown'}`);
  console.log(`  隐私体检: ${privacy.status}`);

  if (args.dryRun) {
    console.log('[P2.0-A] --dry-run：未写入文件。');
    return;
  }

  await atomicWrite(outFile, serialized);
  await atomicWrite(reportFile, `${JSON.stringify(audit, null, 2)}\n`);

  console.log('[P2.0-A] 输出');
  console.log(`  ${relDisplay(outFile)} (${(outputBytes / 1024).toFixed(1)} KB, sha256 ${outputHash.slice(0, 12)}…)`);
  console.log(`  ${relDisplay(reportFile)}`);
  console.log(`  重新解析校验: 通过（${reparsed.nodes.length} 节点 / ${reparsed.relations.length} 关系）`);
}

main().catch((error) => {
  console.error(`\n[P2.0-A] CRM 导入失败: ${error instanceof Error ? error.message : String(error)}`);
  if (error && typeof error === 'object' && 'details' in error && Array.isArray(error.details)) {
    for (const detail of error.details) console.error(`  - ${detail}`);
  }
  process.exitCode = 1;
});

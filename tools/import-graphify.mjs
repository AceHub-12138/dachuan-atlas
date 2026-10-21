#!/usr/bin/env node
/**
 * Graphify → ATLAS 导入 CLI（跨平台）。
 *
 * 用法：
 *   npm run import:graphify -- --graphify "D:\\graphify-poc"
 *   npm run import:graphify -- --graphify "../graphify-poc" --out "local-data/nexus/nexus.atlas.json"
 *
 * 只读取用户指定目录下的 graph.json / snapshot-manifest.json /
 * source-snapshot / GRAPH_REPORT.md，不访问网络，不写入绝对路径。
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ADAPTER_PATH = path.join(ROOT, '.tools-build', 'architecture', 'graphify-adapter.js');
const DATASET_PATH = path.join(ROOT, '.tools-build', 'architecture', 'dataset.js');

function usage() {
  console.log(`DACHUAN ATLAS · Graphify 历史快照导入

用法:
  npm run import:graphify -- --graphify <目录或 graph.json> [选项]

选项:
  --graphify <path>        Graphify POC 目录（含 graph.json / snapshot-manifest.json）
  --out <path>             输出 ATLAS 数据集路径
  --report <path>          审计报告路径（默认 docs/architecture/nexus-import-report.json）
  --expect-commit <sha>    校验 manifest 提交 SHA
  --repository-name <name> 快照展示名称（默认 NEXUS 可视化大屏）
  --generated-at <date>    覆盖图谱生成时间（默认从 GRAPH_REPORT.md 读取）
  --allow-partial          清单缺失或校验失败时仍继续导入（标记 partial）
  --dry-run                只转换与校验，不写文件
  --help                   显示本帮助

示例:
  npm run import:graphify -- --graphify "../graphify-poc" --expect-commit 2584284e3e7b994d0510d9d53b2a302e3aa740bc
`);
}

function parseArgs(argv) {
  const args = { allowPartial: false, dryRun: false, help: false };
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
      case '--out':
        args.out = next();
        break;
      case '--report':
        args.report = next();
        break;
      case '--expect-commit':
        args.expectCommit = next();
        break;
      case '--repository-name':
        args.repositoryName = next();
        break;
      case '--generated-at':
        args.generatedAt = next();
        break;
      case '--allow-partial':
        args.allowPartial = true;
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
  return relative.startsWith('..') || path.isAbsolute(relative) ? path.basename(absolute) : relative;
}

async function readJsonFile(file, label) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error(`${label} 不存在或无法读取。`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} 不是合法 JSON。`);
  }
}

function reportDate(text) {
  const match = text.match(/\((\d{4}-\d{2}-\d{2})\)/);
  return match ? match[1] : null;
}

async function verifyManifest(manifest, snapshotRoot) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('snapshot-manifest.json 顶层必须是对象。');
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error('snapshot-manifest.json 缺少 files 数组。');
  }
  const mismatches = [];
  const missing = [];
  let verified = 0;
  let measuredBytes = 0;

  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
      mismatches.push('<invalid-entry>');
      continue;
    }
    const relative = entry.path.replace(/\\/g, '/');
    if (relative.startsWith('/') || relative.split('/').includes('..')) {
      mismatches.push('<unsafe-path>');
      continue;
    }
    const absolute = path.resolve(snapshotRoot, relative);
    const outside = path.relative(snapshotRoot, absolute);
    if (outside.startsWith('..') || path.isAbsolute(outside)) {
      mismatches.push('<outside-snapshot>');
      continue;
    }
    try {
      const data = await readFile(absolute);
      measuredBytes += data.length;
      if (sha256(data) !== entry.sha256) mismatches.push(relative);
      else verified += 1;
    } catch {
      missing.push(relative);
    }
  }

  return {
    fileCount: manifest.files.length,
    declaredFileCount: typeof manifest.file_count === 'number' ? manifest.file_count : null,
    declaredByteCount: typeof manifest.byte_count === 'number' ? manifest.byte_count : null,
    measuredBytes,
    verified,
    mismatches,
    missing,
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

  let adapter;
  let datasetTools;
  try {
    adapter = await import(ADAPTER_PATH);
    datasetTools = await import(DATASET_PATH);
  } catch {
    throw new Error('数据适配器尚未编译。请使用 npm run import:graphify（会先运行 tsc）。');
  }

  const input = path.resolve(process.cwd(), args.graphify);
  let inputStat;
  try {
    inputStat = await stat(input);
  } catch {
    throw new Error(`路径不存在或不可访问：${path.basename(input)}。`);
  }
  const graphifyDir = inputStat.isDirectory() ? input : path.dirname(input);

  const graph = await readJsonFile(path.join(graphifyDir, 'graph.json'), 'graph.json');
  const manifestPath = path.join(graphifyDir, 'snapshot-manifest.json');
  const manifest = await readJsonFile(manifestPath, 'snapshot-manifest.json').catch((error) => {
    if (args.allowPartial) return null;
    throw error;
  });

  let verification = null;
  if (manifest) {
    const snapshotRoot = path.join(graphifyDir, 'source-snapshot');
    try {
      const result = await verifyManifest(manifest, snapshotRoot);
      const countOk = result.declaredFileCount === null || result.declaredFileCount === result.fileCount;
      const bytesOk = result.declaredByteCount === null || result.declaredByteCount === result.measuredBytes;
      if (result.mismatches.length || result.missing.length || !countOk || !bytesOk) {
        const details = [
          result.mismatches.length ? `哈希不匹配 ${result.mismatches.length} 个` : null,
          result.missing.length ? `文件缺失 ${result.missing.length} 个` : null,
          !countOk ? `file_count 声明 ${result.declaredFileCount}，实际 ${result.fileCount}` : null,
          !bytesOk ? `byte_count 声明 ${result.declaredByteCount}，实测 ${result.measuredBytes}` : null,
        ].filter(Boolean);
        if (!args.allowPartial) {
          throw new Error(`snapshot-manifest 校验失败：${details.join('；')}。如只需结构转换，请加 --allow-partial。`);
        }
        console.warn(`[P1.1] 警告：清单校验未通过（${details.join('；')}），按 partial 导入。`);
      } else {
        verification = {
          fileCount: result.fileCount,
          byteCount: result.measuredBytes,
          verifiedFiles: result.verified,
          verifiedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      if (!args.allowPartial) throw error;
      console.warn(`[P1.1] 警告：${error.message} 按 partial 导入。`);
    }
  } else {
    console.warn('[P1.1] 警告：未提供 snapshot-manifest.json，提交与完整性无法验证，按 partial 导入。');
  }

  let generatedAt = args.generatedAt ?? null;
  if (!generatedAt) {
    try {
      const report = await readFile(path.join(graphifyDir, 'GRAPH_REPORT.md'), 'utf8');
      generatedAt = reportDate(report);
    } catch {
      generatedAt = null;
    }
  }

  const importedAt = new Date().toISOString();
  const dataset = adapter.adaptGraphify({
    graph,
    manifest,
    options: {
      repositoryId: 'nexus',
      repositoryName: args.repositoryName ?? 'NEXUS 可视化大屏',
      expectedCommit: args.expectCommit,
      generatedAt,
      importedAt,
      manifestVerification: verification,
    },
  });

  // 导出后立即按标准 Schema 重新解析，保证写出的文件可被 ATLAS 再次导入。
  const serialized = datasetTools.serializeAtlasDataset(dataset);
  const reparsed = datasetTools.parseAtlasDataset(JSON.parse(serialized));

  const date = (generatedAt ?? importedAt).slice(0, 10);
  const commitShort = dataset.snapshot?.commitShort ?? 'unknown';
  const defaultOut = path.join(
    ROOT,
    'local-data',
    'nexus',
    `nexus-${date}-${commitShort}.atlas.json`,
  );
  const outFile = args.out ? path.resolve(process.cwd(), args.out) : defaultOut;
  const publicDir = path.join(ROOT, 'public');
  const relativeToPublic = path.relative(publicDir, outFile);
  if (!relativeToPublic.startsWith('..') && !path.isAbsolute(relativeToPublic)) {
    throw new Error('安全边界：拒绝把真实快照写入 public/。请使用默认的 local-data/ 或项目外目录。');
  }
  const reportFile = args.report
    ? path.resolve(process.cwd(), args.report)
    : path.join(ROOT, 'docs', 'architecture', 'nexus-import-report.json');

  const bytes = Buffer.byteLength(serialized, 'utf8');
  const outputHash = sha256(Buffer.from(serialized, 'utf8'));
  let privacyTools;
  try {
    privacyTools = await import(path.join(ROOT, '.tools-build', 'architecture', 'privacy.js'));
  } catch {
    privacyTools = null;
  }
  const privacy = privacyTools ? privacyTools.auditDatasetPrivacy(dataset) : null;

  const audit = {
    generatedAt: importedAt,
    source: {
      graph: 'graph.json',
      manifest: manifest ? 'snapshot-manifest.json' : null,
      report: generatedAt ? 'GRAPH_REPORT.md' : null,
    },
    snapshot: {
      id: dataset.snapshot?.id,
      commit: dataset.snapshot?.commit,
      generatedAt: dataset.snapshot?.generatedAt,
      graphifyVersion: dataset.snapshot?.graphifyVersion,
      graphifySchemaVersion: dataset.snapshot?.graphifySchemaVersion,
      atlasSchemaVersion: dataset.snapshot?.atlasSchemaVersion,
      importStatus: dataset.snapshot?.importStatus,
    },
    manifest: verification
      ? {
          fileCount: verification.fileCount,
          byteCount: verification.byteCount,
          verifiedFiles: verification.verifiedFiles,
          hashAlgorithm: 'sha256',
        }
      : null,
    counts: dataset.diagnostics.counts,
    relations: {
      raw: dataset.snapshot?.stats.relations ?? 0,
      uniquePairs: dataset.snapshot?.stats.uniqueRelationPairs ?? 0,
      extracted: dataset.snapshot?.stats.extractedRelations ?? 0,
      inferred: dataset.snapshot?.stats.inferredRelations ?? 0,
      ambiguous: dataset.snapshot?.stats.ambiguousRelations ?? 0,
      selfReferences: dataset.snapshot?.stats.selfReferences ?? 0,
      duplicateRelationsCollapsed: dataset.snapshot?.stats.duplicateRelationsCollapsed ?? 0,
      danglingRelationsDropped: dataset.snapshot?.stats.danglingRelationsDropped ?? 0,
      aiReviewed: dataset.diagnostics.reviewCounts.aiReviewed,
      humanReviewed: dataset.diagnostics.reviewCounts.humanReviewed,
      unverified: dataset.relations.filter((relation) => relation.review.status !== 'verified').length,
    },
    modules: dataset.modules.map((module) => ({
      id: module.id,
      name: module.name,
      review: module.review,
      ...module.stats,
    })),
    issues: dataset.diagnostics.issues,
    coverageNotes: dataset.diagnostics.coverageNotes,
    privacy,
    output: args.dryRun
      ? null
      : {
          file: relDisplay(outFile),
          bytes,
          sha256: outputHash,
        },
  };

  console.log('[P1.1] Graphify 快照校验');
  console.log(`  提交: ${dataset.snapshot?.commit ?? 'unknown'} (${commitShort})`);
  console.log(`  Graphify: ${dataset.snapshot?.graphifyVersion ?? 'unknown'} / schema ${dataset.snapshot?.graphifySchemaVersion ?? 'unknown'}`);
  console.log(
    verification
      ? `  清单: ${verification.verifiedFiles}/${verification.fileCount} 文件通过 sha256，${verification.byteCount} bytes`
      : '  清单: 未完成逐文件校验（partial）',
  );
  console.log('[P1.1] 转换结果');
  console.log(
    `  节点 ${dataset.diagnostics.counts.nodes} / 关系 ${dataset.diagnostics.counts.relations} / 唯一节点对 ${dataset.snapshot?.stats.uniqueRelationPairs ?? 0}`,
  );
  console.log(
    `  EXTRACTED ${dataset.snapshot?.stats.extractedRelations ?? 0} / INFERRED ${dataset.snapshot?.stats.inferredRelations ?? 0} / AMBIGUOUS ${dataset.snapshot?.stats.ambiguousRelations ?? 0}`,
  );
  console.log(
    `  模块: ${dataset.modules
      .map((module) => `${module.name} ${module.stats.productNodes} 主${module.stats.supportingNodes ? ` + ${module.stats.supportingNodes} 支撑` : ''}`)
      .join(' · ')}`,
  );
  console.log(
    `  中文注释 ${dataset.nodes.filter((node) => node.displayName).length} 个节点 / AI 复核关系 ${audit.relations.aiReviewed} 条 / 独立人工 ${audit.relations.humanReviewed} 条`,
  );
  console.log(
    `  自调用 ${dataset.snapshot?.stats.selfReferences ?? 0} 条已保留 / 悬空关系 ${dataset.snapshot?.stats.danglingRelationsDropped ?? 0} 条已跳过`,
  );
  console.log(
    `  审核来源：AI 复核 ${audit.relations.aiReviewed} 条 / 独立人工 ${audit.relations.humanReviewed} 条 / 其余待核实`,
  );
  console.log(
    privacy
      ? `  隐私体检：${privacy.status}（绝对路径 ${privacy.absolutePathCount} / 凭据字段 ${privacy.credentialFieldCount}）`
      : '  隐私体检：未执行',
  );

  if (args.dryRun) {
    console.log('[P1.1] --dry-run：未写入文件。');
    return;
  }

  await atomicWrite(outFile, serialized);
  await atomicWrite(reportFile, `${JSON.stringify(audit, null, 2)}\n`);

  console.log('[P1.1] 输出');
  console.log(`  ${relDisplay(outFile)} (${(bytes / 1024).toFixed(1)} KB, sha256 ${outputHash.slice(0, 12)}…)`);
  console.log(`  ${relDisplay(reportFile)}`);
  console.log(`  重新解析校验: 通过（${reparsed.nodes.length} 节点 / ${reparsed.relations.length} 关系）`);
}

main().catch((error) => {
  console.error(`\n[P1.1] 导入失败: ${error instanceof Error ? error.message : String(error)}`);
  if (error && typeof error === 'object' && 'details' in error && Array.isArray(error.details)) {
    for (const detail of error.details) console.error(`  - ${detail}`);
  }
  process.exitCode = 1;
});

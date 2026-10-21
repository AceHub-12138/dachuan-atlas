import {
  AtlasDataError,
  isAtlasSystemId,
  type AtlasSystemId,
} from './schema.ts';
import { isCommitSha, normalizeRelativePath, shortCommit } from './paths.ts';

/**
 * Graphify 三件套的来源核对（本地、确定性、不联网）。
 *
 * 目标不是“尽量导入”，而是回答四个问题：
 * 1. 这是哪一个仓库的产物？
 * 2. 对应哪一个完整提交？
 * 3. 扫描时间与生成时间是否有记录？
 * 4. 清单是否逐文件通过 SHA-256？
 *
 * 任何一项缺少可靠证据时，导入状态只能是 partial；提交格式错误、仓库冲突、
 * 清单与报告提交冲突都属于硬错误，不能用 --allow-partial 掩盖。
 */

export interface SnapshotManifestFile {
  path: string;
  sha256: string;
}

export interface SnapshotManifestProvenance {
  commit: string | null;
  repositoryId: string | null;
  repositoryName: string | null;
  system: AtlasSystemId | null;
  scannedAt: string | null;
  generatedAt: string | null;
  fileCount: number | null;
  byteCount: number | null;
  files: SnapshotManifestFile[];
}

export interface GraphReportMetadata {
  commit: string | null;
  repositoryId: string | null;
  repositoryName: string | null;
  scannedAt: string | null;
  generatedAt: string | null;
  notes: string[];
}

export interface ProvenanceIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface ImportProvenance {
  commit: string;
  commitSource: 'manifest' | 'report' | 'unknown';
  generatedAt: string | null;
  scannedAt: string | null;
  repositoryId: string;
  repositoryName: string;
  repositoryIdentitySource: 'manifest' | 'report' | 'declared';
  complete: boolean;
  issues: ProvenanceIssue[];
}

export interface EvaluateProvenanceInput {
  declared: {
    repositoryId: string;
    repositoryName: string;
    system: AtlasSystemId;
  };
  manifest: SnapshotManifestProvenance | null;
  report: GraphReportMetadata | null;
  expectedCommit?: string | null;
  manifestVerified: boolean;
  reportPresent: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function manifestFail(message: string, code: AtlasDataError['code'] = 'GRAPHIFY_MANIFEST_INVALID'): never {
  throw new AtlasDataError(code, message);
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    manifestFail(`${field} 必须是非空时间字符串或 null。`);
  }
  const text = value.trim().replace(/^`|`$/g, '');
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+\-Zz]+)?$/.test(text)) {
    manifestFail(`${field} 不是可识别的日期/时间：${text.slice(0, 40)}。`);
  }
  return text;
}

function optionalCount(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    manifestFail(`${field} 必须是非负整数或 null。`);
  }
  return value;
}

function readRepositoryIdentity(raw: Record<string, unknown>): {
  id: string | null;
  name: string | null;
  system: AtlasSystemId | null;
} {
  let id: string | null =
    typeof raw.repository_id === 'string'
      ? raw.repository_id.trim()
      : typeof raw.repositoryId === 'string'
        ? raw.repositoryId.trim()
        : typeof raw.repo_id === 'string'
          ? raw.repo_id.trim()
          : null;
  let name: string | null =
    typeof raw.repository_name === 'string'
      ? raw.repository_name.trim()
      : typeof raw.repositoryName === 'string'
        ? raw.repositoryName.trim()
        : null;
  let system: AtlasSystemId | null =
    typeof raw.system === 'string' && isAtlasSystemId(raw.system) ? raw.system : null;

  const repository = raw.repository;
  if (typeof repository === 'string') {
    const text = repository.trim();
    if (!text) manifestFail('repository 不能是空字符串。');
    // 没有空格的短标识按 ID 处理；带空格的展示名只作为名称，不冒充 ID。
    if (/^[A-Za-z0-9._-]+$/.test(text) && !name) id = id ?? text;
    else name = name ?? text;
  } else if (repository !== undefined && repository !== null) {
    if (!isRecord(repository)) manifestFail('repository 必须是字符串或对象。');
    if (typeof repository.id === 'string' && repository.id.trim()) {
      const objectId = repository.id.trim();
      if (id !== null && id !== objectId) {
        manifestFail(`repository.id=${objectId} 与 repository_id=${id} 冲突。`);
      }
      id = id ?? objectId;
    }
    if (typeof repository.name === 'string' && repository.name.trim()) name = name ?? repository.name.trim();
    if (repository.system !== undefined) {
      if (!isAtlasSystemId(repository.system)) manifestFail('repository.system 非法。');
      system = system ?? repository.system;
    }
  }

  if (id !== null && !/^[A-Za-z0-9._-]+$/.test(id)) {
    manifestFail('repository id 含非法字符。');
  }
  return { id, name, system };
}

export function readSnapshotManifest(
  raw: unknown,
  options: { expectedRepositoryId?: string; expectedSystem?: AtlasSystemId } = {},
): SnapshotManifestProvenance {
  if (!isRecord(raw)) manifestFail('snapshot-manifest.json 顶层必须是对象。');

  let commit: string | null = null;
  if (raw.commit !== undefined && raw.commit !== null) {
    if (typeof raw.commit !== 'string' || !isCommitSha(raw.commit)) {
      throw new AtlasDataError(
        'GRAPHIFY_COMMIT_INVALID',
        'snapshot-manifest.json 的 commit 必须是完整 40 位十六进制提交 SHA；短 SHA 或任意字符串不能作为历史事实。',
      );
    }
    commit = raw.commit.toLowerCase();
  }

  const identity = readRepositoryIdentity(raw);
  if (options.expectedRepositoryId && identity.id && identity.id !== options.expectedRepositoryId) {
    throw new AtlasDataError(
      'GRAPHIFY_REPOSITORY_MISMATCH',
      `snapshot-manifest 声明仓库 ${identity.id}，期望 ${options.expectedRepositoryId}；拒绝把不同仓库的产物混入。`,
    );
  }
  if (options.expectedSystem && identity.system && identity.system !== options.expectedSystem) {
    throw new AtlasDataError(
      'GRAPHIFY_REPOSITORY_MISMATCH',
      `snapshot-manifest 声明系统 ${identity.system}，期望 ${options.expectedSystem}。`,
    );
  }

  const scannedAt = optionalDate(raw.scanned_at ?? raw.scannedAt, 'scanned_at');
  const generatedAt = optionalDate(raw.generated_at ?? raw.generatedAt, 'generated_at');
  const fileCount = optionalCount(raw.file_count ?? raw.fileCount, 'file_count');
  const byteCount = optionalCount(raw.byte_count ?? raw.byteCount, 'byte_count');

  const filesRaw = raw.files ?? [];
  if (!Array.isArray(filesRaw)) manifestFail('files 必须是数组。');
  const files: SnapshotManifestFile[] = filesRaw.map((entry, index) => {
    if (!isRecord(entry)) manifestFail(`files[${index}] 必须是对象。`);
    if (typeof entry.path !== 'string' || !entry.path.trim()) {
      manifestFail(`files[${index}].path 必须是非空字符串。`);
    }
    const normalized = normalizeRelativePath(entry.path);
    if (!normalized.ok) {
      manifestFail(`files[${index}].path 必须是仓库相对路径（${normalized.reason}）。`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(entry.sha256)) {
      manifestFail(`files[${index}].sha256 必须是 64 位十六进制 SHA-256。`);
    }
    return { path: normalized.path, sha256: entry.sha256.toLowerCase() };
  });

  if (fileCount !== null && fileCount !== files.length) {
    manifestFail(`file_count 声明 ${fileCount}，files 实际 ${files.length}；清单自身不一致。`);
  }

  return {
    commit,
    repositoryId: identity.id,
    repositoryName: identity.name,
    system: identity.system,
    scannedAt,
    generatedAt,
    fileCount,
    byteCount,
    files,
  };
}

function cleanValue(value: string): string {
  return value
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .trim();
}

function parseTimestamp(value: string): string | null {
  const text = cleanValue(value).replace(/[。.]$/, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}[T ][0-9:.+\-Zz]+$/.test(text)) return text;
  return null;
}

/**
 * 只解析明确写成 “Repository ID / Commit / Scanned at / Generated at” 的行。
 * 不从标题或自然语言里猜仓库、提交或扫描时间。
 */
export function parseGraphReport(text: string | null | undefined): GraphReportMetadata | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const notes: string[] = [];

  const commitMatch = text.match(
    /^[ \t>*#-]*(?:commit(?:\s+sha)?|git\s+commit)[ \t]*[:=][ \t]*`?([0-9a-fA-F]{7,40})`?[ \t]*$/im,
  );
  let commit: string | null = null;
  if (commitMatch) {
    if (commitMatch[1].length === 40) commit = commitMatch[1].toLowerCase();
    else notes.push('GRAPH_REPORT.md 中的提交不是完整 40 位 SHA，未作为历史提交采用。');
  }

  const repositoryIdMatch = text.match(
    /^[ \t>*#-]*(?:repository|repo)[ \t]+id[ \t]*[:=][ \t]*`?([A-Za-z0-9._-]+)`?[ \t]*$/im,
  );
  const repositoryNameMatch = text.match(
    /^[ \t>*#-]*repository(?:[ \t]+name)?[ \t]*[:=][ \t]*(.+?)[ \t]*$/im,
  );
  const scannedMatch = text.match(
    /^[ \t>*#-]*(?:scanned(?:\s+at)?|scan\s+completed(?:\s+at)?)[ \t]*[:=][ \t]*(.+?)[ \t]*$/im,
  );
  const generatedMatch = text.match(
    /^[ \t>*#-]*(?:generated(?:\s+at)?|graph\s+generated(?:\s+at)?)[ \t]*[:=][ \t]*(.+?)[ \t]*$/im,
  );
  const parenthesizedDate = text.match(/\((\d{4}-\d{2}-\d{2})\)/);

  const scannedAt = scannedMatch ? parseTimestamp(scannedMatch[1]) : null;
  if (scannedMatch && !scannedAt) notes.push('GRAPH_REPORT.md 的扫描时间无法识别，未采用。');
  const generatedAt = generatedMatch
    ? parseTimestamp(generatedMatch[1])
    : parenthesizedDate
      ? parenthesizedDate[1]
      : null;
  if (generatedMatch && !generatedAt) notes.push('GRAPH_REPORT.md 的生成时间无法识别，未采用。');

  return {
    commit,
    repositoryId: repositoryIdMatch ? repositoryIdMatch[1].trim() : null,
    repositoryName: repositoryNameMatch ? cleanValue(repositoryNameMatch[1]) : null,
    scannedAt,
    generatedAt,
    notes,
  };
}

/**
 * 合并清单与报告，拒绝任何不一致的仓库/提交事实。
 * 完整状态必须同时满足：清单存在、逐文件校验通过、提交来自清单、仓库身份来自清单、
 * 报告存在。任何一项缺失都只返回 partial，由调用方决定是否用 --allow-partial 继续。
 */
export function evaluateImportProvenance(input: EvaluateProvenanceInput): ImportProvenance {
  const issues: ProvenanceIssue[] = [];
  let complete = true;

  let expectedCommit: string | null = null;
  if (input.expectedCommit !== undefined && input.expectedCommit !== null) {
    if (!isCommitSha(input.expectedCommit)) {
      throw new AtlasDataError(
        'GRAPHIFY_COMMIT_INVALID',
        '--expect-commit 必须是完整 40 位十六进制 SHA。',
      );
    }
    expectedCommit = input.expectedCommit.toLowerCase();
  }

  const commits: { source: string; value: string }[] = [];
  if (input.manifest?.commit) commits.push({ source: 'manifest', value: input.manifest.commit });
  if (input.report?.commit) commits.push({ source: 'report', value: input.report.commit });
  if (expectedCommit) commits.push({ source: 'expect-commit', value: expectedCommit });
  const uniqueCommits = [...new Set(commits.map((entry) => entry.value))];
  if (uniqueCommits.length > 1) {
    throw new AtlasDataError(
      'GRAPHIFY_COMMIT_MISMATCH',
      `提交不一致：${commits.map((entry) => `${entry.source}=${shortCommit(entry.value)}`).join(' / ')}；拒绝猜测哪一个是真实快照。`,
    );
  }

  const repositoryIds: { source: string; value: string }[] = [
    { source: 'declared', value: input.declared.repositoryId },
  ];
  if (input.manifest?.repositoryId) {
    repositoryIds.push({ source: 'manifest', value: input.manifest.repositoryId });
  }
  if (input.report?.repositoryId) {
    repositoryIds.push({ source: 'report', value: input.report.repositoryId });
  }
  const uniqueRepositories = [...new Set(repositoryIds.map((entry) => entry.value))];
  if (uniqueRepositories.length > 1) {
    throw new AtlasDataError(
      'GRAPHIFY_REPOSITORY_MISMATCH',
      `仓库身份不一致：${repositoryIds.map((entry) => `${entry.source}=${entry.value}`).join(' / ')}。`,
    );
  }
  if (input.manifest?.system && input.manifest.system !== input.declared.system) {
    throw new AtlasDataError(
      'GRAPHIFY_REPOSITORY_MISMATCH',
      `仓库系统不一致：manifest=${input.manifest.system}，declared=${input.declared.system}。`,
    );
  }

  const commit = input.manifest?.commit ?? input.report?.commit ?? 'unknown';
  const commitSource: ImportProvenance['commitSource'] =
    commit === 'unknown' ? 'unknown' : input.manifest?.commit ? 'manifest' : 'report';
  if (commit === 'unknown') {
    complete = false;
    issues.push({
      code: 'COMMIT_UNKNOWN',
      severity: 'warning',
      message: '清单与报告都没有完整提交 SHA；快照只能标记 unknown/partial。',
    });
  } else if (commitSource === 'report') {
    complete = false;
    issues.push({
      code: 'COMMIT_REPORT_ONLY',
      severity: 'warning',
      message: '提交只出现在 GRAPH_REPORT.md，未与 snapshot-manifest 的哈希绑定；只能 partial。',
    });
  }

  if (!input.manifest) {
    complete = false;
    issues.push({
      code: 'MANIFEST_MISSING',
      severity: 'warning',
      message: '缺少 snapshot-manifest.json；无法验证源文件完整性与清单提交。',
    });
  } else if (!input.manifestVerified) {
    complete = false;
    issues.push({
      code: 'MANIFEST_UNVERIFIED',
      severity: 'warning',
      message: 'snapshot-manifest 未通过逐文件 SHA-256 校验；导入只能 partial。',
    });
  } else if (!input.manifest.files.length) {
    complete = false;
    issues.push({
      code: 'MANIFEST_EMPTY',
      severity: 'warning',
      message: 'snapshot-manifest 没有文件条目；不能把“空清单”当作完整校验。',
    });
  }

  const reportHasMetadata = Boolean(
    input.report &&
      (input.report.commit ||
        input.report.repositoryId ||
        input.report.generatedAt ||
        input.report.scannedAt),
  );
  if (!input.reportPresent || !input.report) {
    complete = false;
    issues.push({
      code: 'REPORT_MISSING',
      severity: 'warning',
      message: '缺少或无法解析 GRAPH_REPORT.md；生成时间与扫描记录无法交叉核对。',
    });
  } else if (!reportHasMetadata) {
    complete = false;
    issues.push({
      code: 'REPORT_NO_METADATA',
      severity: 'warning',
      message: 'GRAPH_REPORT.md 没有可用的仓库、提交、扫描或生成记录；不能作为交叉核对依据。',
    });
  }

  const repositoryIdentitySource: ImportProvenance['repositoryIdentitySource'] =
    input.manifest?.repositoryId
      ? 'manifest'
      : input.report?.repositoryId
        ? 'report'
        : 'declared';
  if (repositoryIdentitySource !== 'manifest') {
    complete = false;
    issues.push({
      code: 'REPOSITORY_IDENTITY_DECLARED_ONLY',
      severity: 'warning',
      message:
        repositoryIdentitySource === 'report'
          ? '仓库身份只出现在 GRAPH_REPORT.md，未与清单绑定；只能 partial。'
          : '仓库身份仅来自命令行声明，清单与报告都没有记录；只能 partial。',
    });
  }

  const generatedAt = input.manifest?.generatedAt ?? input.report?.generatedAt ?? null;
  if (
    input.manifest?.generatedAt &&
    input.report?.generatedAt &&
    input.manifest.generatedAt.slice(0, 10) !== input.report.generatedAt.slice(0, 10)
  ) {
    complete = false;
    issues.push({
      code: 'PROVENANCE_GENERATED_AT_MISMATCH',
      severity: 'warning',
      message: `清单生成时间 ${input.manifest.generatedAt} 与报告 ${input.report.generatedAt} 不一致。`,
    });
  }

  const scannedAt = input.manifest?.scannedAt ?? input.report?.scannedAt ?? null;
  if (
    input.manifest?.scannedAt &&
    input.report?.scannedAt &&
    input.manifest.scannedAt !== input.report.scannedAt
  ) {
    complete = false;
    issues.push({
      code: 'PROVENANCE_SCANNED_AT_MISMATCH',
      severity: 'warning',
      message: `清单扫描时间 ${input.manifest.scannedAt} 与报告 ${input.report.scannedAt} 不一致。`,
    });
  }

  for (const note of input.report?.notes ?? []) {
    issues.push({ code: 'REPORT_NOTE', severity: 'info', message: note });
  }

  return {
    commit,
    commitSource,
    generatedAt,
    scannedAt,
    repositoryId: input.declared.repositoryId,
    repositoryName:
      input.manifest?.repositoryName ?? input.report?.repositoryName ?? input.declared.repositoryName,
    repositoryIdentitySource,
    complete,
    issues,
  };
}

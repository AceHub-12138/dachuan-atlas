import {
  AtlasDataError,
  isAtlasModuleId,
  isAtlasSystemId,
  type AtlasModuleId,
  type AtlasSystemId,
} from './schema.ts';
import type { EvidenceSeed, ModuleDefinition } from './module-map.ts';
import { isRepoFileReference, normalizeRelativePath } from './paths.ts';

/**
 * 仓库导入 profile。
 *
 * Graphify 只描述图，不描述“这个仓库的业务模块是什么”。NEXUS 的模块定义
 * 写在 module-map.ts 里，不能套用到 CRM：CRM 必须提供自己的模块 ID、路径规则
 * 与职责证据。这个 profile 是本地导入配置，不是发布数据，也不会自动上传。
 *
 * 约束：
 * - 模块归类只依据路径或人工写明的职责证据；不读取 Graphify Community；
 * - 没有匹配到任何规则的节点保持未分类（moduleId=null），不强行凑星图；
 * - 模块审核状态必须显式记录；本地 profile 默认只能是 unverified；
 * - 非 NEXUS 仓库不能复用 data / voice / animation / canvas 四个模块 ID。
 */

export const REPOSITORY_PROFILE_SCHEMA = 'atlas.repository-profile';
export const REPOSITORY_PROFILE_VERSION = '1.0.0';
export const NEXUS_RESERVED_MODULE_IDS: AtlasModuleId[] = ['data', 'voice', 'animation', 'canvas'];

const PROFILE_REVIEW_METHODS = ['unverified', 'ai-source-review', 'human-review'] as const;
type ProfileReviewMethod = (typeof PROFILE_REVIEW_METHODS)[number];

export interface RepositoryProfile {
  schema: typeof REPOSITORY_PROFILE_SCHEMA;
  schemaVersion: string;
  synthetic: boolean;
  repository: {
    id: string;
    name: string;
    system: AtlasSystemId;
    workspaceLabel: string;
  };
  sourceLabel: string;
  modules: ModuleDefinition[];
  moduleOrder: AtlasModuleId[];
  coverageNotes: string[];
  snapshotNotes: string[];
}

export interface ParseRepositoryProfileOptions {
  expectedRepositoryId?: string;
  expectedSystem?: AtlasSystemId;
  allowSynthetic?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string, code: AtlasDataError['code'] = 'REPOSITORY_PROFILE_INVALID'): never {
  throw new AtlasDataError(code, message);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} 必须是非空字符串。`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail(`${field} 必须是字符串或 null。`);
  return value.trim() || null;
}

function requireStringArray(value: unknown, field: string, min = 0): string[] {
  if (!Array.isArray(value)) fail(`${field} 必须是数组。`);
  if (value.length < min) fail(`${field} 至少需要 ${min} 项。`);
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) fail(`${field}[${index}] 必须是非空字符串。`);
    return entry.trim();
  });
}

function normalizeFilePath(value: unknown, field: string): string {
  const text = requireString(value, field);
  const normalized = normalizeRelativePath(text);
  if (!normalized.ok) fail(`${field} 不是仓库相对路径（${normalized.reason}）。`);
  if (!isRepoFileReference(normalized.path)) fail(`${field} 不是可识别的源码/文档文件路径。`);
  return normalized.path;
}

/** 模块前缀必须以 / 结尾，避免 src/customer 误匹配 src/customer-service.ts。 */
function normalizePrefix(value: unknown, field: string): string {
  const text = requireString(value, field).replace(/\\/g, '/');
  if (!text.endsWith('/')) fail(`${field} 必须以 / 结尾，避免把同名前缀文件误归入模块。`);
  const normalized = normalizeRelativePath(text);
  if (!normalized.ok) fail(`${field} 不是仓库相对路径（${normalized.reason}）。`);
  return `${normalized.path}/`;
}

function isDateLike(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+\-Zz]+)?$/.test(value);
}

function parseReview(
  raw: Record<string, unknown>,
  index: number,
): {
  review: ModuleDefinition['review'];
  reviewMethod: ProfileReviewMethod;
  reviewActor: string | null;
  reviewedAt: string | null;
  reviewNote: string;
} {
  const field = `modules[${index}]`;
  const review = raw.review;
  if (review !== 'verified' && review !== 'partially_verified' && review !== 'unverified') {
    fail(`${field}.review 必须是 verified / partially_verified / unverified。`);
  }
  const methodValue = raw.reviewMethod ?? 'unverified';
  if (!PROFILE_REVIEW_METHODS.includes(methodValue as ProfileReviewMethod)) {
    fail(
      `${field}.reviewMethod 只能是 ${PROFILE_REVIEW_METHODS.join(' / ')}；Graphify 提取不能作为模块定义复核。`,
    );
  }
  const method = methodValue as ProfileReviewMethod;
  const actor = optionalString(raw.reviewActor, `${field}.reviewActor`);
  const reviewedAt = optionalString(raw.reviewedAt, `${field}.reviewedAt`);
  const reviewNote =
    optionalString(raw.reviewNote, `${field}.reviewNote`) ??
    (method === 'unverified'
      ? '模块定义由本地 profile 提供；没有 AI 或人工独立复核记录。'
      : '模块定义由 profile 提供。');

  if (method === 'unverified' && review !== 'unverified') {
    fail(`${field} 标记为 ${review}，但 reviewMethod=unverified；不能在没有复核记录时声明已核实。`);
  }
  if (method !== 'unverified') {
    if (!actor) fail(`${field}.reviewActor 在 ${method} 时必填。`);
    if (!reviewedAt || !isDateLike(reviewedAt)) {
      fail(`${field}.reviewedAt 在 ${method} 时必须是 YYYY-MM-DD 或 ISO 时间。`);
    }
    if (review === 'unverified') fail(`${field} 声明了 ${method}，但 review=unverified 自相矛盾。`);
    if (!optionalString(raw.reviewNote, `${field}.reviewNote`)) {
      fail(`${field}.reviewNote 在 ${method} 时必填，说明复核范围。`);
    }
  }

  return { review, reviewMethod: method, reviewActor: actor, reviewedAt, reviewNote };
}

function parseEvidence(value: unknown, field: string): EvidenceSeed[] {
  if (!Array.isArray(value)) fail(`${field} 必须是数组。`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`${field}[${index}] 必须是对象。`);
    const line = entry.line;
    if (typeof line !== 'number' || !Number.isInteger(line) || line <= 0) {
      fail(`${field}[${index}].line 必须是正整数。`);
    }
    return {
      file: normalizeFilePath(entry.file, `${field}[${index}].file`),
      line,
      symbol: requireString(entry.symbol, `${field}[${index}].symbol`),
      note: requireString(entry.note, `${field}[${index}].note`),
    };
  });
}

function parseModule(
  value: unknown,
  index: number,
  system: AtlasSystemId,
  seen: Set<string>,
): ModuleDefinition {
  if (!isRecord(value)) fail(`modules[${index}] 必须是对象。`);
  const field = `modules[${index}]`;
  const id = requireString(value.id, `${field}.id`);
  if (!isAtlasModuleId(id)) fail(`${field}.id 不是合法模块 ID（小写字母开头，允许小写字母/数字/连字符）。`);
  if (seen.has(id)) fail(`模块 ID 重复：${id}。`);
  seen.add(id);
  if (system !== 'nexus' && NEXUS_RESERVED_MODULE_IDS.includes(id as AtlasModuleId)) {
    fail(
      `模块 ${id} 是 NEXUS 的模块 ID，${system} 不能复用；请使用该仓库自己的领域模块 ID。`,
    );
  }

  const primaryPrefixes = Array.isArray(value.primaryPrefixes)
    ? value.primaryPrefixes.map((entry, prefixIndex) =>
        normalizePrefix(entry, `${field}.primaryPrefixes[${prefixIndex}]`),
      )
    : [];
  const primaryFiles = Array.isArray(value.primaryFiles)
    ? value.primaryFiles.map((entry, fileIndex) =>
        normalizeFilePath(entry, `${field}.primaryFiles[${fileIndex}]`),
      )
    : [];
  const supportingFiles = Array.isArray(value.supportingFiles)
    ? value.supportingFiles.map((entry, fileIndex) =>
        normalizeFilePath(entry, `${field}.supportingFiles[${fileIndex}]`),
      )
    : [];
  const evidence = parseEvidence(value.evidence ?? [], `${field}.evidence`);
  if (!primaryPrefixes.length && !primaryFiles.length && !supportingFiles.length && !evidence.length) {
    fail(`${field} 没有任何路径或职责证据；未分类节点必须保持未分类，不能用空规则占位。`);
  }

  const review = parseReview(value, index);
  return {
    id,
    index: optionalString(value.index, `${field}.index`) ?? String(index + 1).padStart(2, '0'),
    name: requireString(value.name, `${field}.name`),
    latin: requireString(value.latin, `${field}.latin`),
    review: review.review,
    reviewMethod: review.reviewMethod,
    reviewActor: review.reviewActor,
    reviewedAt: review.reviewedAt,
    reviewNote: review.reviewNote,
    rule: requireString(value.rule, `${field}.rule`),
    description: requireString(value.description, `${field}.description`),
    summary: requireString(value.summary, `${field}.summary`),
    responsibilities: requireStringArray(value.responsibilities, `${field}.responsibilities`, 1),
    gaps: requireStringArray(value.gaps ?? [], `${field}.gaps`),
    notes: requireStringArray(value.notes ?? [], `${field}.notes`),
    primaryPrefixes,
    primaryFiles,
    supportingFiles,
    evidence,
  };
}

export function parseRepositoryProfile(
  raw: unknown,
  options: ParseRepositoryProfileOptions = {},
): RepositoryProfile {
  if (!isRecord(raw)) fail('仓库 profile 顶层必须是对象。');
  if (raw.schema !== REPOSITORY_PROFILE_SCHEMA) {
    fail(`仓库 profile 的 schema 必须是 ${REPOSITORY_PROFILE_SCHEMA}。`);
  }
  const schemaVersion = requireString(raw.schemaVersion, 'schemaVersion');
  if (!/^1\.\d+\.\d+$/.test(schemaVersion)) {
    fail(`仓库 profile schemaVersion=${schemaVersion} 不受支持；本轮支持 1.x。`);
  }

  if (!isRecord(raw.repository)) fail('repository 必须是对象。');
  const id = requireString(raw.repository.id, 'repository.id');
  if (!/^[A-Za-z0-9._-]+$/.test(id)) fail('repository.id 含非法字符。');
  const name = requireString(raw.repository.name, 'repository.name');
  const system = raw.repository.system;
  if (!isAtlasSystemId(system)) fail('repository.system 必须是 crm / nexus / electron。');
  if (options.expectedRepositoryId && id !== options.expectedRepositoryId) {
    fail(
      `仓库 profile 的 repository.id=${id} 与期望的 ${options.expectedRepositoryId} 不一致。`,
      'REPOSITORY_PROFILE_REPOSITORY_MISMATCH',
    );
  }
  if (options.expectedSystem && system !== options.expectedSystem) {
    fail(
      `仓库 profile 的 repository.system=${system} 与期望的 ${options.expectedSystem} 不一致。`,
      'REPOSITORY_PROFILE_REPOSITORY_MISMATCH',
    );
  }

  const synthetic = raw.synthetic === true;
  if (raw.synthetic !== undefined && typeof raw.synthetic !== 'boolean') {
    fail('synthetic 必须是布尔值。');
  }
  if (synthetic && !options.allowSynthetic) {
    fail(
      '该 profile 标记为 synthetic（合成验证）；真实接入必须提供非合成 profile，合成导入需显式 --allow-synthetic。',
      'REPOSITORY_PROFILE_SYNTHETIC_REQUIRED',
    );
  }

  if (!Array.isArray(raw.modules)) fail('modules 必须是数组。');
  const seen = new Set<string>();
  const modules = raw.modules.map((entry, index) => parseModule(entry, index, system, seen));

  const sourceLabel =
    optionalString(raw.sourceLabel, 'sourceLabel') ??
    (synthetic ? `${name}（合成验证）` : `${name} 本地历史快照`);
  if (synthetic && !/(合成|synthetic|fixture)/i.test(sourceLabel)) {
    fail('synthetic profile 的 sourceLabel 必须明确标注“合成 / synthetic / fixture”，避免被当成真实快照。');
  }

  return {
    schema: REPOSITORY_PROFILE_SCHEMA,
    schemaVersion,
    synthetic,
    repository: {
      id,
      name,
      system,
      workspaceLabel:
        optionalString(raw.repository.workspaceLabel, 'repository.workspaceLabel') ??
        (system === 'nexus' ? 'NEXUS' : name),
    },
    sourceLabel,
    modules,
    moduleOrder: modules.map((module) => module.id),
    coverageNotes: Array.isArray(raw.coverageNotes)
      ? requireStringArray(raw.coverageNotes, 'coverageNotes')
      : [],
    snapshotNotes: Array.isArray(raw.snapshotNotes)
      ? requireStringArray(raw.snapshotNotes, 'snapshotNotes')
      : [],
  };
}

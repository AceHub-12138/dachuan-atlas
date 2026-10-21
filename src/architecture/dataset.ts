import {
  ATLAS_SCHEMA_ID,
  ATLAS_SCHEMA_MAJOR,
  ATLAS_SCHEMA_MINOR,
  ATLAS_SCHEMA_VERSION,
  AtlasDataError,
  isAtlasModuleId,
  isAtlasSystemId,
  isReviewed,
  MODULE_ORDER,
  type AtlasDataset,
  type AtlasEvidenceRef,
  type AtlasFlowScenario,
  type AtlasFlowSemantics,
  type AtlasFlowStep,
  type AtlasModuleComponent,
  type AtlasModuleId,
  type AtlasContractEvidenceKind,
  type AtlasContractEvidenceRef,
  type AtlasModuleRecord,
  type AtlasNode,
  type AtlasRelation,
  type AtlasRelationScope,
  type AtlasRepositoryRecord,
  type AtlasRepositoryScope,
  type AtlasReview,
  type AtlasReviewMethod,
  type AtlasReviewStatus,
  type AtlasRuntimeBoundary,
  type AtlasRuntimeEvidenceKind,
  type AtlasRuntimeEvidenceRef,
  type AtlasRuntimeScope,
  type AtlasScopeMigrationSummary,
  type AtlasSourceKind,
} from './schema.ts';
import { normalizeRelativePath } from './paths.ts';

/**
 * ATLAS 标准数据的导入 / 导出 / 交叉校验。
 *
 * 与 Graphify 适配器不同，这里对标准数据是严格的：它已经是 ATLAS 自己的
 * 格式，出现悬空关系、重复节点或绝对路径说明文件损坏或被手工改坏，应
 * 直接给出可读错误，而不是猜测修复。
 */

const REVIEW_VALUES: AtlasReviewStatus[] = ['verified', 'partially_verified', 'unverified'];
const REVIEW_METHODS: AtlasReviewMethod[] = [
  'graphify-extracted',
  'graphify-inferred',
  'ai-source-review',
  'human-review',
  'unverified',
];
const SOURCE_KINDS: AtlasSourceKind[] = ['demo', 'graphify'];
const SYSTEM_ORDER = ['nexus', 'crm', 'electron'];
const FLOW_SEMANTICS: AtlasFlowSemantics[] = ['module-collaboration', 'runtime-verified'];
/** 1.3 及更早的单一 scope；只作为迁移输入。 */
const LEGACY_RELATION_SCOPES: AtlasRelationScope[] = [
  'intra-repository',
  'cross-repository',
  'cross-process',
];
const REPOSITORY_SCOPES: AtlasRepositoryScope[] = ['intra-repository', 'cross-repository'];
const RUNTIME_SCOPES: AtlasRuntimeScope[] = ['intra-runtime', 'cross-runtime', 'unknown'];
const RUNTIME_EVIDENCE_KINDS: AtlasRuntimeEvidenceKind[] = [
  'runtime-trace',
  'runtime-log',
  'protocol-test',
  'integration-test',
  'runtime-observation',
];
const CONTRACT_EVIDENCE_KINDS: AtlasContractEvidenceKind[] = [
  'api-contract',
  'protocol-schema',
  'package-manifest',
  'config-binding',
  'contract-test',
  'integration-test',
];
const RUNTIME_BOUNDARIES: AtlasRuntimeBoundary[] = [
  'browser-renderer',
  'node-service',
  'electron-main',
  'electron-renderer',
  'shared',
  'unknown',
];
const FLOW_BASIS = ['source-responsibility', 'runtime-evidence'];
const LEGACY_FLOW_RUNTIME_NOTE =
  '该流程由 1.2 及更早数据迁移：步骤是概念性协作说明，未记录运行时顺序证据。';
const LEGACY_CANDIDATE_NOTE =
  '旧版跨仓库关系没有 1.4 接口证据分类；保留为未确认候选，不进入已确认跨仓库关系图。';
const LEGACY_AI_REVIEWER = 'P1.0 人工核对';
const AI_ACTOR = 'ZCode + DeepSeek（P1.0 施工 Agent）';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `字段 ${field} 必须是非空字符串。`);
  }
  return value;
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `字段 ${field} 必须是数组。`);
  }
  return value;
}

function parseMajor(version: string): number {
  const match = version.match(/^(\d+)\./);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
}

function parseMinor(version: string): number {
  const match = version.match(/^\d+\.(\d+)\./);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
}

function isFlowSemantics(value: unknown): value is AtlasFlowSemantics {
  return FLOW_SEMANTICS.includes(value as AtlasFlowSemantics);
}

function isRuntimeBoundary(value: unknown): value is AtlasRuntimeBoundary {
  return RUNTIME_BOUNDARIES.includes(value as AtlasRuntimeBoundary);
}

function isLegacyRelationScope(value: unknown): value is AtlasRelationScope {
  return LEGACY_RELATION_SCOPES.includes(value as AtlasRelationScope);
}

function isRepositoryScope(value: unknown): value is AtlasRepositoryScope {
  return REPOSITORY_SCOPES.includes(value as AtlasRepositoryScope);
}

function isRuntimeScope(value: unknown): value is AtlasRuntimeScope {
  return RUNTIME_SCOPES.includes(value as AtlasRuntimeScope);
}

function isRuntimeEvidenceKind(value: unknown): value is AtlasRuntimeEvidenceKind {
  return RUNTIME_EVIDENCE_KINDS.includes(value as AtlasRuntimeEvidenceKind);
}

function isContractEvidenceKind(value: unknown): value is AtlasContractEvidenceKind {
  return CONTRACT_EVIDENCE_KINDS.includes(value as AtlasContractEvidenceKind);
}

function isKnownRuntimeBoundary(
  value: AtlasRuntimeBoundary | null | undefined,
): value is AtlasRuntimeBoundary {
  return !!value && value !== 'unknown' && value !== 'shared';
}

function deriveRuntimeScope(
  fromBoundary: AtlasRuntimeBoundary | null | undefined,
  toBoundary: AtlasRuntimeBoundary | null | undefined,
): AtlasRuntimeScope {
  if (isKnownRuntimeBoundary(fromBoundary) && isKnownRuntimeBoundary(toBoundary)) {
    return fromBoundary === toBoundary ? 'intra-runtime' : 'cross-runtime';
  }
  return 'unknown';
}

function emptyScopeMigration(fromVersion: string): AtlasScopeMigrationSummary {
  return {
    fromSchemaVersion: fromVersion,
    relations: 0,
    repositoryScopes: { intraRepository: 0, crossRepository: 0 },
    runtimeScopes: { intraRuntime: 0, crossRuntime: 0, unknown: 0 },
    legacyScopes: {},
    runtimeVerifiedDowngraded: 0,
    notes: [],
  };
}

function countScopeMigration(
  summary: AtlasScopeMigrationSummary,
  relation: AtlasRelation,
  legacyScope: AtlasRelationScope | null,
  downgraded: boolean,
): void {
  summary.relations += 1;
  if (relation.repositoryScope === 'cross-repository') summary.repositoryScopes.crossRepository += 1;
  else summary.repositoryScopes.intraRepository += 1;
  if (relation.runtimeScope === 'cross-runtime') summary.runtimeScopes.crossRuntime += 1;
  else if (relation.runtimeScope === 'intra-runtime') summary.runtimeScopes.intraRuntime += 1;
  else summary.runtimeScopes.unknown += 1;
  const key = legacyScope ?? 'none';
  summary.legacyScopes[key] = (summary.legacyScopes[key] ?? 0) + 1;
  if (downgraded) summary.runtimeVerifiedDowngraded += 1;
}

function defaultRuntimeOrder(note: string) {
  return { verified: false, note, evidence: [] as AtlasEvidenceRef[] };
}

function validateEvidenceRef(raw: unknown, field: string): AtlasEvidenceRef {
  if (!isRecord(raw)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field} 必须是对象。`);
  }
  requireString(raw.repository, `${field}.repository`);
  requireString(raw.commit, `${field}.commit`);
  const file = requireString(raw.file, `${field}.file`);
  validateRelativeFile(file, `${field}.file`);
  if (raw.line !== null && (typeof raw.line !== 'number' || !Number.isFinite(raw.line) || raw.line <= 0)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field}.line 必须是正数或 null。`);
  }
  if (raw.symbol !== null && typeof raw.symbol !== 'string') {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field}.symbol 必须是字符串或 null。`);
  }
  requireString(raw.locator, `${field}.locator`);
  return raw as unknown as AtlasEvidenceRef;
}

function evidenceCommitMap(repositories: AtlasRepositoryRecord[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const repository of repositories) {
    const commits = map.get(repository.id) ?? new Set<string>();
    for (const snapshot of repository.snapshots) commits.add(snapshot.commit);
    map.set(repository.id, commits);
  }
  return map;
}

/**
 * 证据必须指向已登记仓库，且提交必须属于该仓库已登记的快照之一。
 * 这样不同历史快照不会被误合并，也不会把另一个仓库的文件当成当前证据。
 */
function validateEvidenceBinding(
  evidence: AtlasEvidenceRef,
  commits: Map<string, Set<string>>,
  field: string,
  options: { requireKnownCommit?: boolean } = {},
): void {
  if (!commits.size) return;
  const allowed = commits.get(evidence.repository);
  if (!allowed) {
    throw new AtlasDataError(
      'ATLAS_DATASET_REPOSITORY_INVALID',
      `${field}.repository=${evidence.repository} 不在仓库登记表中。`,
    );
  }
  if (evidence.commit === 'unknown') {
    if (options.requireKnownCommit && [...allowed].some((commit) => commit !== 'unknown')) {
      throw new AtlasDataError(
        'ATLAS_DATASET_REPOSITORY_INVALID',
        `${field} 必须绑定到已登记的提交；不能使用 unknown。`,
      );
    }
    return;
  }
  if (!allowed.has(evidence.commit)) {
    throw new AtlasDataError(
      'ATLAS_DATASET_REPOSITORY_INVALID',
      `${field}.commit=${evidence.commit} 不属于 ${evidence.repository} 的已登记快照。`,
    );
  }
}

function validateRuntimeEvidence(
  raw: unknown,
  field: string,
  commits: Map<string, Set<string>>,
): AtlasRuntimeEvidenceRef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field} 必须是数组。`);
  }
  return raw.map((entry, index) => {
    const ref = validateEvidenceRef(entry, `${field}[${index}]`);
    if (!isRecord(entry)) {
      throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field}[${index}] 结构非法。`);
    }
    if (entry.kind !== undefined && entry.kind !== null && !isRuntimeEvidenceKind(entry.kind)) {
      throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field}[${index}].kind 非法。`);
    }
    if (entry.capturedAt !== undefined && entry.capturedAt !== null && typeof entry.capturedAt !== 'string') {
      throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field}[${index}].capturedAt 必须是字符串或 null。`);
    }
    validateEvidenceBinding(ref, commits, `${field}[${index}]`);
    return entry as unknown as AtlasRuntimeEvidenceRef;
  });
}

function validateContractEvidence(
  raw: unknown,
  field: string,
  commits: Map<string, Set<string>>,
): AtlasContractEvidenceRef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field} 必须是数组。`);
  }
  return raw.map((entry, index) => {
    const ref = validateEvidenceRef(entry, `${field}[${index}]`);
    if (!isRecord(entry) || !isContractEvidenceKind(entry.kind)) {
      throw new AtlasDataError(
        'ATLAS_DATASET_INVALID',
        `${field}[${index}].kind 必须是接口/协议证据类型。`,
      );
    }
    validateEvidenceBinding(ref, commits, `${field}[${index}]`, { requireKnownCommit: true });
    return entry as unknown as AtlasContractEvidenceRef;
  });
}

function snapshotKeyFor(repositoryId: string, commitShort: string, generatedAt: string | null): string {
  return `${repositoryId}@${commitShort}@${generatedAt ?? 'unknown'}`;
}

/**
 * 1.2 及更早的数据没有仓库登记表；从快照推导单仓库记录。
 * 扫描时间未记录时保持 null，不用生成时间冒充扫描时间。
 */
function deriveRepositories(rawSnapshot: unknown): AtlasRepositoryRecord[] {
  if (!isRecord(rawSnapshot) || !isRecord(rawSnapshot.repository)) return [];
  const id = typeof rawSnapshot.repository.id === 'string' ? rawSnapshot.repository.id : '';
  if (!id) return [];
  const name =
    typeof rawSnapshot.repository.name === 'string' ? rawSnapshot.repository.name : id;
  const system = isAtlasSystemId(rawSnapshot.repository.system)
    ? rawSnapshot.repository.system
    : isAtlasSystemId(id)
      ? id
      : 'nexus';
  const commit = typeof rawSnapshot.commit === 'string' ? rawSnapshot.commit : 'unknown';
  const commitShort =
    typeof rawSnapshot.commitShort === 'string' ? rawSnapshot.commitShort : commit.slice(0, 7);
  const generatedAt =
    typeof rawSnapshot.generatedAt === 'string' ? rawSnapshot.generatedAt : null;
  const importedAt =
    typeof rawSnapshot.importedAt === 'string' ? rawSnapshot.importedAt : new Date(0).toISOString();
  const stats = isRecord(rawSnapshot.stats) ? rawSnapshot.stats : {};
  return [
    {
      id,
      name,
      system,
      snapshots: [
        {
          snapshotId: typeof rawSnapshot.id === 'string' ? rawSnapshot.id : `${id}-${commitShort}`,
          snapshotKey: snapshotKeyFor(id, commitShort, generatedAt),
          commit,
          commitShort,
          scannedAt: null,
          generatedAt,
          importedAt,
          graphifyVersion:
            typeof rawSnapshot.graphifyVersion === 'string' ? rawSnapshot.graphifyVersion : 'unknown',
          nodeCount: typeof stats.nodes === 'number' ? stats.nodes : 0,
          relationCount: typeof stats.relations === 'number' ? stats.relations : 0,
          history: true,
        },
      ],
    },
  ];
}

function nodeIdRepositoryPrefix(id: string): string | null {
  const match = id.match(/^([A-Za-z0-9._-]+)(?:@[^:]+)?:/);
  return match ? match[1] : null;
}

/**
 * 1.1 / 1.2 → 1.3：只补可选的语义与登记字段，不改写源码事实。
 */
function normalizeDatasetV13(
  raw: Record<string, unknown>,
  originalVersion: string,
): Record<string, unknown> {
  const modules = Array.isArray(raw.modules)
    ? (raw.modules as Record<string, unknown>[]).map((module) => ({
        ...module,
        explanation:
          module.explanation === undefined || module.explanation === null
            ? null
            : module.explanation,
      }))
    : raw.modules;
  const flows = Array.isArray(raw.flows)
    ? (raw.flows as Record<string, unknown>[]).map((flow) => {
        const semantics = isFlowSemantics(flow.semantics) ? flow.semantics : 'module-collaboration';
        const runtimeOrder = isRecord(flow.runtimeOrder)
          ? flow.runtimeOrder
          : defaultRuntimeOrder(LEGACY_FLOW_RUNTIME_NOTE);
        const steps = Array.isArray(flow.steps)
          ? (flow.steps as Record<string, unknown>[]).map((step) => ({
              ...step,
              basis: FLOW_BASIS.includes(step.basis as string)
                ? step.basis
                : 'source-responsibility',
            }))
          : flow.steps;
        return { ...flow, semantics, runtimeOrder, steps };
      })
    : [];
  const repositories = Array.isArray(raw.repositories)
    ? raw.repositories
    : deriveRepositories(raw.snapshot);
  const snapshot = isRecord(raw.snapshot)
    ? {
        ...raw.snapshot,
        notes: [
          ...(Array.isArray(raw.snapshot.notes) ? raw.snapshot.notes : []),
          `数据集由 ATLAS Schema ${originalVersion} 迁移到 ${ATLAS_SCHEMA_VERSION}；流程语义默认按“模块协作示意”处理，关系作用域按 1.4 双维度规则迁移，未新增运行时结论。`,
        ],
      }
    : raw.snapshot;
  return {
    ...raw,
    schemaVersion: ATLAS_SCHEMA_VERSION,
    schemaMigratedFrom:
      typeof raw.schemaMigratedFrom === 'string' ? raw.schemaMigratedFrom : originalVersion,
    modules,
    flows,
    repositories,
    snapshot,
  };
}

/**
 * 1.3 → 1.4：模块增加仓库归属；关系作用域在 validateRelation 中逐条迁移。
 * 不修改节点、提交、证据或审核记录，只补 1.4 必需的结构字段。
 */
function normalizeDatasetV14(
  raw: Record<string, unknown>,
  originalVersion: string,
): Record<string, unknown> {
  const snapshotRepository =
    isRecord(raw.snapshot) && isRecord(raw.snapshot.repository) &&
    typeof raw.snapshot.repository.id === 'string'
      ? raw.snapshot.repository.id
      : null;
  const registeredRepositories = Array.isArray(raw.repositories)
    ? (raw.repositories as Record<string, unknown>[])
        .map((entry) => (isRecord(entry) && typeof entry.id === 'string' ? entry.id : null))
        .filter((id): id is string => !!id)
    : [];
  const fallbackRepository =
    snapshotRepository ?? registeredRepositories[0] ?? (raw.source && isRecord(raw.source) && raw.source.kind === 'demo' ? 'demo' : 'unknown');
  const modules = Array.isArray(raw.modules)
    ? (raw.modules as Record<string, unknown>[]).map((module) => {
        const repository =
          typeof module.repository === 'string' && module.repository.trim()
            ? module.repository
            : fallbackRepository;
        const system = isAtlasSystemId(module.system)
          ? module.system
          : isAtlasSystemId(repository)
            ? repository
            : 'nexus';
        return { ...module, repository, system };
      })
    : raw.modules;
  const snapshot = isRecord(raw.snapshot)
    ? {
        ...raw.snapshot,
        notes: [
          ...(Array.isArray(raw.snapshot.notes) ? raw.snapshot.notes : []),
          `P1.4 关系作用域迁移：旧版单一 scope 拆分为 repositoryScope / runtimeScope；没有节点运行时边界证据的关系保持 runtimeScope=unknown，不推断为同进程。`,
        ],
      }
    : raw.snapshot;
  return {
    ...raw,
    schemaVersion: ATLAS_SCHEMA_VERSION,
    schemaMigratedFrom:
      typeof raw.schemaMigratedFrom === 'string' ? raw.schemaMigratedFrom : originalVersion,
    modules,
    snapshot,
  };
}

function validateReview(raw: unknown, field: string): AtlasReview {
  if (!isRecord(raw)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field} 必须是对象。`);
  }
  const review = raw as unknown as AtlasReview;
  if (!REVIEW_VALUES.includes(review.status)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field}.status 状态非法。`);
  }
  if (!REVIEW_METHODS.includes(review.method)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field}.method 审核方式非法。`);
  }
  if (review.actor !== null && typeof review.actor !== 'string') {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field}.actor 必须是字符串或 null。`);
  }
  if (!Array.isArray(review.evidence)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field}.evidence 必须是数组。`);
  }
  for (const [index, evidence] of review.evidence.entries()) {
    if (!isRecord(evidence)) {
      throw new AtlasDataError('ATLAS_DATASET_INVALID', `${field}.evidence[${index}] 结构非法。`);
    }
    requireString(evidence.file, `${field}.evidence[${index}].file`);
    validateRelativeFile(evidence.file, `${field}.evidence[${index}].file`);
  }
  return review;
}

function migrateReview(raw: unknown, fallbackMethod: AtlasReviewMethod): AtlasReview {
  if (!isRecord(raw)) {
    return {
      status: 'unverified',
      method: fallbackMethod,
      actor: null,
      reviewer: null,
      reviewedAt: null,
      note: '旧版数据缺少审核记录。',
      evidence: [],
    };
  }
  const legacyStatus = REVIEW_VALUES.includes(raw.status as AtlasReviewStatus)
    ? (raw.status as AtlasReviewStatus)
    : 'unverified';
  let status = legacyStatus;
  let method = REVIEW_METHODS.includes(raw.method as AtlasReviewMethod)
    ? (raw.method as AtlasReviewMethod)
    : fallbackMethod;
  let note = typeof raw.note === 'string' ? raw.note : null;
  let actorOverride: string | null = null;

  if (!REVIEW_METHODS.includes(raw.method as AtlasReviewMethod) && legacyStatus === 'verified') {
    if (raw.reviewer === LEGACY_AI_REVIEWER) {
      method = 'ai-source-review';
      actorOverride = AI_ACTOR;
      note = note ? `${note}（P1.0 实际为 Agent 源码复核，P1.1 修正审核来源）` : 'P1.0 实际为 Agent 源码复核，P1.1 修正审核来源。';
    } else {
      // 旧版没有记录审核方式；不能把它当作独立人工审核。
      status = 'unverified';
      method = 'unverified';
      note = note ? `${note}（旧版未记录审核来源，已降级为待核实）` : '旧版未记录审核来源，已降级为待核实。';
    }
  }

  const actor =
    actorOverride ??
    (typeof raw.actor === 'string'
      ? raw.actor
      : typeof raw.reviewer === 'string'
        ? raw.reviewer
        : method === 'ai-source-review'
          ? AI_ACTOR
          : method.startsWith('graphify-')
            ? 'Graphify'
            : null);

  return {
    status,
    method,
    actor,
    reviewer: typeof raw.reviewer === 'string' ? raw.reviewer : actor,
    reviewedAt: typeof raw.reviewedAt === 'string' ? raw.reviewedAt : null,
    note,
    evidence: Array.isArray(raw.evidence) ? (raw.evidence as AtlasEvidenceRef[]) : [],
  };
}

function reviewCountsFor(relations: AtlasRelation[]) {
  const counts = {
    aiReviewed: relations.filter(
      (relation) => relation.review.method === 'ai-source-review' && relation.review.status !== 'unverified',
    ).length,
    humanReviewed: relations.filter(
      (relation) => relation.review.method === 'human-review' && relation.review.status !== 'unverified',
    ).length,
    graphifyExtractedUnverified: relations.filter(
      (relation) => relation.review.method === 'graphify-extracted' && relation.review.status === 'unverified',
    ).length,
    graphifyInferredUnverified: relations.filter(
      (relation) => relation.review.method === 'graphify-inferred' && relation.review.status === 'unverified',
    ).length,
    unverified: 0,
  };
  counts.unverified =
    relations.length -
    counts.aiReviewed -
    counts.humanReviewed -
    counts.graphifyExtractedUnverified -
    counts.graphifyInferredUnverified;
  return counts;
}

function deriveKeyComponents(nodes: AtlasNode[], moduleId: AtlasModuleId): AtlasModuleComponent[] {
  return nodes
    .filter(
      (node) =>
        node.moduleId === moduleId &&
        node.scope === 'product' &&
        node.displayName !== null &&
        node.responsibility !== null &&
        node.sourceFile !== null,
    )
    .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '', 'zh-CN'))
    .slice(0, 5)
    .map((node) => ({
      symbol: node.symbol,
      file: node.sourceFile as string,
      line: node.sourceLine,
      name: node.displayName as string,
      responsibility: node.responsibility as string,
      review: node.review,
    }));
}

function migrateDatasetV1(raw: Record<string, unknown>): Record<string, unknown> {
  const sourceNodes = Array.isArray(raw.nodes) ? (raw.nodes as Record<string, unknown>[]) : [];
  const nodes = sourceNodes.map((node) => {
    const evidenceType = node.sourceConfidence === 'INFERRED' ? 'graphify-inferred' : 'graphify-extracted';
    return { ...node, review: migrateReview(node.review, evidenceType) };
  });
  const migratedNodes = nodes as unknown as AtlasNode[];

  const relations = (Array.isArray(raw.relations) ? (raw.relations as Record<string, unknown>[]) : []).map(
    (relation) => {
      const evidenceType =
        relation.evidenceType === 'INFERRED'
          ? 'graphify-inferred'
          : relation.evidenceType === 'EXTRACTED'
            ? 'graphify-extracted'
            : 'unverified';
      return { ...relation, review: migrateReview(relation.review, evidenceType) };
    },
  );

  const modules = (Array.isArray(raw.modules) ? (raw.modules as Record<string, unknown>[]) : []).map(
    (module) => {
      const moduleId = module.id as AtlasModuleId;
      const legacyStatus = REVIEW_VALUES.includes(module.review as AtlasReviewStatus)
        ? (module.review as AtlasReviewStatus)
        : 'unverified';
      const reviewRecord = isRecord(module.reviewRecord)
        ? migrateReview(module.reviewRecord, 'ai-source-review')
        : migrateReview(
            {
              status: legacyStatus,
              method: legacyStatus === 'unverified' ? 'unverified' : 'ai-source-review',
              reviewer: legacyStatus === 'unverified' ? null : AI_ACTOR,
              note: 'P1.0 模块组成由施工 Agent 按路径核对，P1.1 修正审核来源。',
            },
            'ai-source-review',
          );
      return {
        ...module,
        summary: typeof module.summary === 'string' ? module.summary : (module.description as string) ?? '',
        responsibilities: Array.isArray(module.responsibilities)
          ? module.responsibilities
          : [module.description],
        gaps: Array.isArray(module.gaps) ? module.gaps : Array.isArray(module.notes) ? module.notes : [],
        keyComponents: Array.isArray(module.keyComponents)
          ? module.keyComponents
          : deriveKeyComponents(migratedNodes, moduleId),
        reviewRecord,
      };
    },
  );

  const migratedRelations = relations as unknown as AtlasRelation[];
  const reviewCounts = {
    aiReviewed: migratedRelations.filter(
      (relation) => relation.review.method === 'ai-source-review' && relation.review.status !== 'unverified',
    ).length,
    humanReviewed: migratedRelations.filter(
      (relation) => relation.review.method === 'human-review' && relation.review.status !== 'unverified',
    ).length,
    graphifyExtractedUnverified: migratedRelations.filter(
      (relation) => relation.review.method === 'graphify-extracted' && relation.review.status === 'unverified',
    ).length,
    graphifyInferredUnverified: migratedRelations.filter(
      (relation) => relation.review.method === 'graphify-inferred' && relation.review.status === 'unverified',
    ).length,
    unverified: 0,
  };
  reviewCounts.unverified =
    migratedRelations.length -
    reviewCounts.aiReviewed -
    reviewCounts.humanReviewed -
    reviewCounts.graphifyExtractedUnverified -
    reviewCounts.graphifyInferredUnverified;
  const diagnostics = isRecord(raw.diagnostics)
    ? {
        ...raw.diagnostics,
        reviewCounts: isRecord(raw.diagnostics.reviewCounts) ? raw.diagnostics.reviewCounts : reviewCounts,
      }
    : raw.diagnostics;

  const snapshot = isRecord(raw.snapshot)
    ? {
        ...raw.snapshot,
        notes: [
          ...(Array.isArray(raw.snapshot.notes) ? raw.snapshot.notes : []),
          `数据集由 ATLAS Schema 1.0.0 迁移到 ${ATLAS_SCHEMA_VERSION}；原始快照字段未改写。`,
        ],
      }
    : raw.snapshot;

  return {
    ...raw,
    schemaVersion: ATLAS_SCHEMA_VERSION,
    schemaMigratedFrom: typeof raw.schemaVersion === 'string' ? raw.schemaVersion : '1.0.0',
    nodes,
    relations,
    modules,
    diagnostics,
    snapshot,
    flows: [],
  };
}

function validateRelativeFile(value: string, field: string): void {
  const normalized = normalizeRelativePath(value);
  if (!normalized.ok) {
    throw new AtlasDataError(
      'ATLAS_DATASET_PATH_LEAK',
      `字段 ${field} 不是仓库相对路径（${normalized.reason}）；标准数据禁止写入绝对路径。`,
    );
  }
}

function validateNode(raw: unknown, index: number): AtlasNode {
  if (!isRecord(raw)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `nodes[${index}] 必须是对象。`);
  }
  const node = raw as unknown as AtlasNode;
  requireString(node.id, `nodes[${index}].id`);
  requireString(node.symbol, `nodes[${index}].symbol`);
  if (!isAtlasModuleId(node.moduleId) && node.moduleId !== null) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `nodes[${index}].moduleId 不是合法模块。`);
  }
  if (!Array.isArray(node.moduleIds) || node.moduleIds.some((id) => !isAtlasModuleId(id))) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `nodes[${index}].moduleIds 含非法模块。`);
  }
  if (node.sourceFile !== null) {
    requireString(node.sourceFile, `nodes[${index}].sourceFile`);
    validateRelativeFile(node.sourceFile, `nodes[${index}].sourceFile`);
  }
  if (
    node.runtimeBoundary !== undefined &&
    node.runtimeBoundary !== null &&
    !isRuntimeBoundary(node.runtimeBoundary)
  ) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `nodes[${index}].runtimeBoundary 非法。`);
  }
  if (!isRecord(node.review) || !REVIEW_VALUES.includes(node.review.status)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `nodes[${index}].review 状态非法。`);
  }
  validateReview(node.review, `nodes[${index}].review`);
  if (!Array.isArray(node.evidence)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `nodes[${index}].evidence 必须是数组。`);
  }
  for (const [evidenceIndex, evidence] of node.evidence.entries()) {
    if (!isRecord(evidence)) {
      throw new AtlasDataError('ATLAS_DATASET_INVALID', `nodes[${index}].evidence[${evidenceIndex}] 结构非法。`);
    }
    requireString(evidence.file, `nodes[${index}].evidence[${evidenceIndex}].file`);
    validateRelativeFile(evidence.file, `nodes[${index}].evidence[${evidenceIndex}].file`);
  }
  return node;
}

/**
 * 1.3 单一 scope → 1.4 双维度。迁移只使用显式旧值、节点边界和已有运行时
 * 证据；没有证据时 runtimeScope=unknown，不把“同仓库”或“同文件”当作
 * 同进程。
 */
function migrateLegacyRelationScopes(
  raw: Record<string, unknown>,
  fromNode: AtlasNode,
  toNode: AtlasNode,
): {
  repositoryScope: AtlasRepositoryScope;
  runtimeScope: AtlasRuntimeScope;
  runtimeVerified: boolean;
  scopeNote: string | null;
  legacyScope: AtlasRelationScope | null;
  downgraded: boolean;
} {
  const legacyScope =
    raw.scope === undefined || raw.scope === null
      ? null
      : isLegacyRelationScope(raw.scope)
        ? raw.scope
        : (() => {
            throw new AtlasDataError('ATLAS_DATASET_INVALID', '旧版 relation.scope 非法。');
          })();
  const crossRepositoryByNodes = fromNode.repository !== toNode.repository;
  if (legacyScope === 'cross-repository' && !crossRepositoryByNodes) {
    throw new AtlasDataError(
      'ATLAS_DATASET_CROSS_REPO_INVALID',
      '旧版关系标记为跨仓库，但两端属于同一仓库。',
    );
  }
  if (legacyScope === 'intra-repository' && crossRepositoryByNodes) {
    throw new AtlasDataError(
      'ATLAS_DATASET_CROSS_REPO_INVALID',
      '旧版关系标记为仓库内，但两端属于不同仓库。',
    );
  }
  const repositoryScope: AtlasRepositoryScope = crossRepositoryByNodes
    ? 'cross-repository'
    : 'intra-repository';
  const derived = deriveRuntimeScope(fromNode.runtimeBoundary, toNode.runtimeBoundary);
  if (legacyScope === 'cross-process' && derived === 'intra-runtime') {
    throw new AtlasDataError(
      'ATLAS_DATASET_CROSS_REPO_INVALID',
      '旧版关系声明 cross-process，但两端节点的 runtimeBoundary 相同；声明与节点事实矛盾。',
    );
  }

  const notes: string[] = [];
  let runtimeScope: AtlasRuntimeScope;
  if (legacyScope === 'cross-process') {
    runtimeScope = 'cross-runtime';
    notes.push('1.3 scope=cross-process 显式声明运行时跨边界，迁移为 runtimeScope=cross-runtime。');
  } else if (derived === 'cross-runtime') {
    runtimeScope = 'cross-runtime';
    notes.push('两端节点都有已知且不同的 runtimeBoundary，迁移为 cross-runtime。');
  } else if (derived === 'intra-runtime') {
    runtimeScope = 'intra-runtime';
    notes.push('两端节点都有已知且相同的 runtimeBoundary，迁移为 intra-runtime。');
  } else {
    runtimeScope = 'unknown';
    if (legacyScope !== null) {
      notes.push('旧 scope 不包含运行时维度，节点也没有足够的运行时边界证据；runtimeScope=unknown。');
    }
  }

  let runtimeVerified = raw.runtimeVerified === true;
  let downgraded = false;
  const runtimeEvidence = Array.isArray(raw.runtimeEvidence) ? raw.runtimeEvidence : [];
  if (runtimeVerified) {
    const typed =
      runtimeEvidence.length > 0 &&
      runtimeEvidence.every((entry) => isRecord(entry) && isRuntimeEvidenceKind(entry.kind));
    const reviewed =
      isRecord(raw.review) &&
      (raw.review.method === 'ai-source-review' || raw.review.method === 'human-review') &&
      raw.review.status !== 'unverified';
    if (!typed || !reviewed || runtimeScope === 'unknown') {
      runtimeVerified = false;
      downgraded = true;
      notes.push(
        '旧版 runtimeVerified=true 缺少带类型的运行时证据、复核或可判定作用域；迁移后保持未验证，原始 runtimeEvidence 保留。',
      );
    }
  }

  return {
    repositoryScope,
    runtimeScope,
    runtimeVerified,
    scopeNote: notes.length ? notes.join(' ') : null,
    legacyScope,
    downgraded,
  };
}

function validateRelation(
  raw: unknown,
  index: number,
  nodeById: Map<string, AtlasNode>,
  options: {
    originalMinor: number;
    repositories: AtlasRepositoryRecord[];
    scopeMigration: AtlasScopeMigrationSummary | null;
  },
): AtlasRelation {
  if (!isRecord(raw)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `relations[${index}] 必须是对象。`);
  }
  const relation = raw as unknown as AtlasRelation;
  requireString(relation.id, `relations[${index}].id`);
  requireString(relation.from, `relations[${index}].from`);
  requireString(relation.to, `relations[${index}].to`);
  const fromNode = nodeById.get(relation.from);
  const toNode = nodeById.get(relation.to);
  if (!fromNode || !toNode) {
    throw new AtlasDataError(
      'ATLAS_DATASET_DANGLING_RELATION',
      `relations[${index}] 指向不存在的节点：${relation.from} -> ${relation.to}。`,
    );
  }
  if (!isRecord(relation.review) || !REVIEW_VALUES.includes(relation.review.status)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `relations[${index}].review 状态非法。`);
  }
  validateReview(relation.review, `relations[${index}].review`);
  if (relation.evidence !== null) {
    if (!isRecord(relation.evidence)) {
      throw new AtlasDataError('ATLAS_DATASET_INVALID', `relations[${index}].evidence 结构非法。`);
    }
    requireString(relation.evidence.file, `relations[${index}].evidence.file`);
    validateRelativeFile(relation.evidence.file, `relations[${index}].evidence.file`);
  }

  const commits = evidenceCommitMap(options.repositories);
  if (relation.evidence) {
    validateEvidenceBinding(relation.evidence, commits, `relations[${index}].evidence`);
  }
  const legacyMigration =
    options.originalMinor < 4 ? migrateLegacyRelationScopes(raw, fromNode, toNode) : null;

  let repositoryScope: AtlasRepositoryScope;
  let runtimeScope: AtlasRuntimeScope;
  let runtimeVerified: boolean;
  let runtimeEvidence: AtlasRuntimeEvidenceRef[];
  let interfaceEvidence: AtlasContractEvidenceRef[];
  let legacyScope: AtlasRelationScope | null = null;
  let scopeNote: string | null = null;

  if (legacyMigration) {
    repositoryScope = legacyMigration.repositoryScope;
    runtimeScope = legacyMigration.runtimeScope;
    runtimeVerified = legacyMigration.runtimeVerified;
    legacyScope = legacyMigration.legacyScope;
    scopeNote = legacyMigration.scopeNote;
  } else {
    if (!isRepositoryScope(relation.repositoryScope)) {
      throw new AtlasDataError(
        'ATLAS_DATASET_INVALID',
        `relations[${index}]（Schema 1.4）必须显式声明 repositoryScope，且不能使用旧的 scope 枚举。`,
      );
    }
    if (!isRuntimeScope(relation.runtimeScope)) {
      throw new AtlasDataError(
        'ATLAS_DATASET_INVALID',
        `relations[${index}]（Schema 1.4）必须显式声明 runtimeScope（intra-runtime / cross-runtime / unknown）。`,
      );
    }
    if (relation.runtimeVerified !== undefined && typeof relation.runtimeVerified !== 'boolean') {
      throw new AtlasDataError('ATLAS_DATASET_INVALID', `relations[${index}].runtimeVerified 必须是布尔值。`);
    }
    repositoryScope = relation.repositoryScope;
    runtimeScope = relation.runtimeScope;
    runtimeVerified = relation.runtimeVerified === true;
    legacyScope = isLegacyRelationScope(relation.legacyScope) ? relation.legacyScope : null;
    scopeNote = typeof relation.scopeNote === 'string' ? relation.scopeNote : null;
  }

  runtimeEvidence = validateRuntimeEvidence(
    raw.runtimeEvidence,
    `relations[${index}].runtimeEvidence`,
    commits,
  );
  interfaceEvidence = validateContractEvidence(
    raw.interfaceEvidence,
    `relations[${index}].interfaceEvidence`,
    commits,
  );

  const crossRepository = fromNode.repository !== toNode.repository;
  if (crossRepository !== (repositoryScope === 'cross-repository')) {
    throw new AtlasDataError(
      'ATLAS_DATASET_CROSS_REPO_INVALID',
      crossRepository
        ? `relations[${index}] 连接不同仓库（${fromNode.repository} → ${toNode.repository}），必须声明 repositoryScope=cross-repository。`
        : `relations[${index}] 声明为跨仓库，但两端属于同一仓库（${fromNode.repository}）。`,
    );
  }

  const derivedRuntime = deriveRuntimeScope(
    fromNode.runtimeBoundary,
    toNode.runtimeBoundary,
  );
  if (derivedRuntime === 'cross-runtime' && runtimeScope !== 'cross-runtime') {
    throw new AtlasDataError(
      'ATLAS_DATASET_CROSS_REPO_INVALID',
      `relations[${index}] 两端位于不同运行时（${fromNode.runtimeBoundary} → ${toNode.runtimeBoundary}），必须声明 runtimeScope=cross-runtime。`,
    );
  }
  if (derivedRuntime === 'intra-runtime' && runtimeScope !== 'intra-runtime') {
    throw new AtlasDataError(
      'ATLAS_DATASET_CROSS_REPO_INVALID',
      `relations[${index}] 两端都有相同的已知运行时边界（${fromNode.runtimeBoundary}），必须声明 runtimeScope=intra-runtime。`,
    );
  }
  if (derivedRuntime === 'unknown' && runtimeScope === 'intra-runtime') {
    throw new AtlasDataError(
      'ATLAS_DATASET_CROSS_REPO_INVALID',
      `relations[${index}] 运行时边界未知，不能推断为 intra-runtime；请使用 runtimeScope=unknown。`,
    );
  }
  if (
    derivedRuntime === 'unknown' &&
    runtimeScope === 'cross-runtime' &&
    options.originalMinor >= 4 &&
    !legacyScope &&
    !runtimeEvidence.length
  ) {
    throw new AtlasDataError(
      'ATLAS_DATASET_CROSS_REPO_INVALID',
      `relations[${index}] 在运行时边界未知时声明 cross-runtime，必须提供带类型的 runtimeEvidence。`,
    );
  }
  if (runtimeScope === 'intra-runtime' && repositoryScope === 'cross-repository') {
    // 跨仓库但同运行时是合法的；这里只保留明确说明，不强制拆分。
    scopeNote = scopeNote ?? '跨仓库但两端运行时边界相同；仓库维度与运行时维度分别记录。';
  }

  if (crossRepository) {
    if (!isReviewed(relation.review)) {
      throw new AtlasDataError(
        'ATLAS_DATASET_CROSS_REPO_INVALID',
        `relations[${index}] 跨仓库候选关系尚未经过 AI 或人工复核，不能进入已确认关系图。`,
      );
    }
    const hasSourceEvidence = relation.evidence !== null || relation.review.evidence.length > 0;
    if (!hasSourceEvidence && !interfaceEvidence.length) {
      throw new AtlasDataError(
        'ATLAS_DATASET_CROSS_REPO_INVALID',
        `relations[${index}] 跨仓库关系必须提供源码定位或接口/协议证据。`,
      );
    }
    if (options.originalMinor >= 4 && !legacyScope && !interfaceEvidence.length) {
      throw new AtlasDataError(
        'ATLAS_DATASET_CROSS_REPO_INVALID',
        `relations[${index}] Schema 1.4 跨仓库关系必须提供 interfaceEvidence（API 契约、协议 schema、包清单、契约/集成测试等）。`,
      );
    }
    if (!interfaceEvidence.length && !(scopeNote ?? '').includes('未确认候选')) {
      scopeNote = [scopeNote, LEGACY_CANDIDATE_NOTE].filter(Boolean).join(' ');
    }
  }

  if (runtimeVerified) {
    if (!isReviewed(relation.review)) {
      throw new AtlasDataError(
        'ATLAS_DATASET_CROSS_REPO_INVALID',
        `relations[${index}] runtimeVerified=true 必须经过 AI 或人工复核；AI 源码复核本身不等于运行时已验证。`,
      );
    }
    if (runtimeScope === 'unknown') {
      throw new AtlasDataError(
        'ATLAS_DATASET_CROSS_REPO_INVALID',
        `relations[${index}] runtimeVerified=true 但 runtimeScope=unknown；必须先用运行时证据确定作用域。`,
      );
    }
    if (!runtimeEvidence.length) {
      throw new AtlasDataError(
        'ATLAS_DATASET_CROSS_REPO_INVALID',
        `relations[${index}] 声称运行时已验证，但没有 runtimeEvidence。`,
      );
    }
    if (runtimeEvidence.some((evidence) => !isRuntimeEvidenceKind(evidence.kind))) {
      throw new AtlasDataError(
        'ATLAS_DATASET_CROSS_REPO_INVALID',
        `relations[${index}] runtimeVerified=true 时，每条 runtimeEvidence 都必须标注证据类型（trace / log / protocol-test 等）。`,
      );
    }
  }

  if (options.scopeMigration && legacyMigration) {
    countScopeMigration(
      options.scopeMigration,
      {
        ...relation,
        repositoryScope,
        runtimeScope,
        runtimeVerified,
        runtimeEvidence,
        interfaceEvidence,
      },
      legacyMigration.legacyScope,
      legacyMigration.downgraded,
    );
  }

  const { scope: _legacyScopeField, ...rest } = raw;
  return {
    ...(rest as unknown as AtlasRelation),
    repositoryScope,
    runtimeScope,
    runtimeVerified,
    runtimeEvidence,
    interfaceEvidence,
    legacyScope,
    scopeNote,
  };
}

function validateModule(raw: unknown, index: number): AtlasModuleRecord {
  if (!isRecord(raw)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `modules[${index}] 必须是对象。`);
  }
  const module = raw as unknown as AtlasModuleRecord;
  if (!isAtlasModuleId(module.id)) {
    throw new AtlasDataError('ATLAS_DATASET_MODULE_INVALID', `modules[${index}].id 不是合法模块。`);
  }
  requireString(module.name, `modules[${index}].name`);
  requireString(module.repository, `modules[${index}].repository`);
  if (!isAtlasSystemId(module.system)) {
    throw new AtlasDataError('ATLAS_DATASET_MODULE_INVALID', `modules[${index}].system 非法。`);
  }
  if (!REVIEW_VALUES.includes(module.review)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `modules[${index}].review 状态非法。`);
  }
  validateReview(module.reviewRecord, `modules[${index}].reviewRecord`);
  requireString(module.summary, `modules[${index}].summary`);
  if (!Array.isArray(module.responsibilities) || !Array.isArray(module.gaps)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `modules[${index}] 缺少 responsibilities 或 gaps。`);
  }
  if (module.explanation !== undefined && module.explanation !== null) {
    if (!isRecord(module.explanation)) {
      throw new AtlasDataError('ATLAS_DATASET_INVALID', `modules[${index}].explanation 必须是对象或 null。`);
    }
    requireString(module.explanation.whyNeeded, `modules[${index}].explanation.whyNeeded`);
    validateReview(module.explanation.review, `modules[${index}].explanation.review`);
  }
  if (!Array.isArray(module.keyComponents)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `modules[${index}].keyComponents 必须是数组。`);
  }
  for (const [componentIndex, component] of module.keyComponents.entries()) {
    requireString(component.symbol, `modules[${index}].keyComponents[${componentIndex}].symbol`);
    requireString(component.name, `modules[${index}].keyComponents[${componentIndex}].name`);
    requireString(component.file, `modules[${index}].keyComponents[${componentIndex}].file`);
    validateRelativeFile(component.file, `modules[${index}].keyComponents[${componentIndex}].file`);
    validateReview(component.review, `modules[${index}].keyComponents[${componentIndex}].review`);
  }
  if (!isRecord(module.stats) || !Array.isArray(module.evidence)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `modules[${index}] 缺少 stats 或 evidence。`);
  }
  return module;
}

/**
 * 模块归属与节点绑定：
 * - 模块 ID 在数据集内唯一；
 * - 模块必须属于已登记仓库，且系统与仓库一致；
 * - 节点的 moduleId/moduleIds 必须引用同一仓库的模块定义。
 * 这阻止把 CRM 节点套进 NEXUS 的四模块，也阻止跨仓库重复使用模块 ID。
 */
function validateModuleBindings(
  modules: AtlasModuleRecord[],
  nodes: AtlasNode[],
  repositories: AtlasRepositoryRecord[],
): void {
  const repositoryById = new Map(repositories.map((repository) => [repository.id, repository]));
  const moduleById = new Map<string, AtlasModuleRecord>();
  for (const [index, module] of modules.entries()) {
    if (moduleById.has(module.id)) {
      throw new AtlasDataError('ATLAS_DATASET_MODULE_INVALID', `模块 ID 重复：${module.id}。`);
    }
    moduleById.set(module.id, module);
    if (repositories.length) {
      const repository = repositoryById.get(module.repository);
      if (!repository) {
        throw new AtlasDataError(
          'ATLAS_DATASET_MODULE_INVALID',
          `modules[${index}].repository=${module.repository} 不在仓库登记表中。`,
        );
      }
      if (module.system !== repository.system) {
        throw new AtlasDataError(
          'ATLAS_DATASET_MODULE_INVALID',
          `modules[${index}].system=${module.system} 与仓库 ${module.repository}（${repository.system}）不一致。`,
        );
      }
    }
  }
  for (const [index, node] of nodes.entries()) {
    const ids = node.moduleIds;
    if (new Set(ids).size !== ids.length) {
      throw new AtlasDataError('ATLAS_DATASET_MODULE_INVALID', `nodes[${index}].moduleIds 含重复模块。`);
    }
    if (node.moduleId !== null && (node.moduleIds[0] !== node.moduleId || !ids.includes(node.moduleId))) {
      throw new AtlasDataError(
        'ATLAS_DATASET_MODULE_INVALID',
        `nodes[${index}].moduleId 必须是 moduleIds 的首项。`,
      );
    }
    for (const moduleId of ids) {
      const module = moduleById.get(moduleId);
      if (!module) {
        throw new AtlasDataError(
          'ATLAS_DATASET_MODULE_INVALID',
          `nodes[${index}] 引用了不存在的模块：${moduleId}。`,
        );
      }
      if (module.repository !== node.repository) {
        throw new AtlasDataError(
          'ATLAS_DATASET_MODULE_INVALID',
          `nodes[${index}]（${node.repository}）不能引用 ${module.repository} 的模块 ${moduleId}。`,
        );
      }
    }
  }
}

function flowSymbolMatches(nodeSymbol: string, stepSymbol: string): boolean {
  return (
    nodeSymbol === stepSymbol ||
    nodeSymbol === `${stepSymbol}()` ||
    nodeSymbol === `.${stepSymbol}()` ||
    nodeSymbol === `.${stepSymbol}`
  );
}

function validateFlowStep(
  raw: unknown,
  flowIndex: number,
  stepIndex: number,
  nodes: AtlasNode[],
): AtlasFlowStep {
  if (!isRecord(raw)) {
    throw new AtlasDataError('ATLAS_DATASET_FLOW_INVALID', `flows[${flowIndex}].steps[${stepIndex}] 必须是对象。`);
  }
  const step = raw as unknown as AtlasFlowStep;
  requireString(step.id, `flows[${flowIndex}].steps[${stepIndex}].id`);
  requireString(step.title, `flows[${flowIndex}].steps[${stepIndex}].title`);
  requireString(step.description, `flows[${flowIndex}].steps[${stepIndex}].description`);
  requireString(step.symbol, `flows[${flowIndex}].steps[${stepIndex}].symbol`);
  requireString(step.note, `flows[${flowIndex}].steps[${stepIndex}].note`);
  requireString(step.file, `flows[${flowIndex}].steps[${stepIndex}].file`);
  validateRelativeFile(step.file, `flows[${flowIndex}].steps[${stepIndex}].file`);
  if (!isAtlasModuleId(step.moduleId)) {
    throw new AtlasDataError('ATLAS_DATASET_FLOW_INVALID', `flows[${flowIndex}].steps[${stepIndex}].moduleId 不是合法模块。`);
  }
  if (step.line !== null && (typeof step.line !== 'number' || !Number.isFinite(step.line) || step.line <= 0)) {
    throw new AtlasDataError('ATLAS_DATASET_FLOW_INVALID', `flows[${flowIndex}].steps[${stepIndex}].line 必须是正数或 null。`);
  }
  if (step.basis !== undefined && !FLOW_BASIS.includes(step.basis)) {
    throw new AtlasDataError('ATLAS_DATASET_FLOW_INVALID', `flows[${flowIndex}].steps[${stepIndex}].basis 非法。`);
  }
  const node = nodes.find(
    (candidate) =>
      candidate.sourceFile === step.file &&
      flowSymbolMatches(candidate.symbol, step.symbol) &&
      candidate.moduleIds.includes(step.moduleId),
  );
  if (!node) {
    throw new AtlasDataError(
      'ATLAS_DATASET_FLOW_INVALID',
      `flows[${flowIndex}].steps[${stepIndex}] 指向当前快照中不存在的源码节点：${step.file}#${step.symbol}。`,
    );
  }
  return step;
}

function validateFlow(raw: unknown, flowIndex: number, nodes: AtlasNode[]): AtlasFlowScenario {
  if (!isRecord(raw)) {
    throw new AtlasDataError('ATLAS_DATASET_FLOW_INVALID', `flows[${flowIndex}] 必须是对象。`);
  }
  const flow = raw as unknown as AtlasFlowScenario;
  requireString(flow.id, `flows[${flowIndex}].id`);
  requireString(flow.title, `flows[${flowIndex}].title`);
  requireString(flow.summary, `flows[${flowIndex}].summary`);
  requireString(flow.disclaimer, `flows[${flowIndex}].disclaimer`);
  if (!isAtlasModuleId(flow.entryModuleId)) {
    throw new AtlasDataError('ATLAS_DATASET_FLOW_INVALID', `flows[${flowIndex}].entryModuleId 不是合法模块。`);
  }
  validateReview(flow.review, `flows[${flowIndex}].review`);
  if (!Array.isArray(flow.steps) || flow.steps.length < 2 || flow.steps.length > 12) {
    throw new AtlasDataError('ATLAS_DATASET_FLOW_INVALID', `flows[${flowIndex}].steps 必须是 2–12 步的数组。`);
  }
  const semantics = flow.semantics ?? 'module-collaboration';
  if (!isFlowSemantics(semantics)) {
    throw new AtlasDataError('ATLAS_DATASET_FLOW_INVALID', `flows[${flowIndex}].semantics 非法。`);
  }
  const runtimeOrder = flow.runtimeOrder ?? defaultRuntimeOrder(LEGACY_FLOW_RUNTIME_NOTE);
  if (!isRecord(runtimeOrder) || typeof runtimeOrder.verified !== 'boolean') {
    throw new AtlasDataError('ATLAS_DATASET_FLOW_INVALID', `flows[${flowIndex}].runtimeOrder.verified 必须是布尔值。`);
  }
  requireString(runtimeOrder.note, `flows[${flowIndex}].runtimeOrder.note`);
  if (!Array.isArray(runtimeOrder.evidence)) {
    throw new AtlasDataError('ATLAS_DATASET_FLOW_INVALID', `flows[${flowIndex}].runtimeOrder.evidence 必须是数组。`);
  }
  runtimeOrder.evidence.forEach((evidence, evidenceIndex) =>
    validateEvidenceRef(evidence, `flows[${flowIndex}].runtimeOrder.evidence[${evidenceIndex}]`),
  );
  if (semantics === 'module-collaboration' && runtimeOrder.verified) {
    throw new AtlasDataError(
      'ATLAS_DATASET_FLOW_INVALID',
      `flows[${flowIndex}] 是模块协作示意，不能声称运行时顺序已验证。`,
    );
  }
  if (semantics === 'runtime-verified') {
    if (!runtimeOrder.verified || !runtimeOrder.evidence.length) {
      throw new AtlasDataError(
        'ATLAS_DATASET_FLOW_INVALID',
        `flows[${flowIndex}] 声称运行时已验证，但没有 verified=true 与非空 runtimeOrder.evidence。`,
      );
    }
  }
  const stepIds = new Set<string>();
  for (const [stepIndex, step] of flow.steps.entries()) {
    const validated = validateFlowStep(step, flowIndex, stepIndex, nodes);
    if (semantics === 'runtime-verified' && validated.basis !== 'runtime-evidence') {
      throw new AtlasDataError(
        'ATLAS_DATASET_FLOW_INVALID',
        `flows[${flowIndex}].steps[${stepIndex}] 是运行时流程，但 basis 不是 runtime-evidence。`,
      );
    }
    if (semantics === 'module-collaboration' && validated.basis === 'runtime-evidence') {
      throw new AtlasDataError(
        'ATLAS_DATASET_FLOW_INVALID',
        `flows[${flowIndex}].steps[${stepIndex}] 标记了运行时证据，但场景是模块协作示意。`,
      );
    }
    if (stepIds.has(validated.id)) {
      throw new AtlasDataError('ATLAS_DATASET_FLOW_INVALID', `flows[${flowIndex}] 步骤 ID 重复：${validated.id}。`);
    }
    stepIds.add(validated.id);
  }
  return flow;
}

function validateRepositories(raw: unknown): AtlasRepositoryRecord[] {
  if (!Array.isArray(raw)) {
    throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', 'repositories 必须是数组。');
  }
  const ids = new Set<string>();
  const snapshotKeys = new Set<string>();
  const snapshotIds = new Set<string>();
  return raw.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', `repositories[${index}] 必须是对象。`);
    }
    const id = requireString(entry.id, `repositories[${index}].id`);
    if (!/^[A-Za-z0-9._-]+$/.test(id)) {
      throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', `repositories[${index}].id 含非法字符。`);
    }
    if (ids.has(id)) {
      throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', `仓库 ID 重复：${id}。`);
    }
    ids.add(id);
    requireString(entry.name, `repositories[${index}].name`);
    if (!isAtlasSystemId(entry.system)) {
      throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', `repositories[${index}].system 非法。`);
    }
    if (!Array.isArray(entry.snapshots) || !entry.snapshots.length) {
      throw new AtlasDataError(
        'ATLAS_DATASET_REPOSITORY_INVALID',
        `repositories[${index}].snapshots 必须是至少包含一个历史快照的数组。`,
      );
    }
    const snapshots = entry.snapshots.map((snapshot, snapshotIndex) => {
      const field = `repositories[${index}].snapshots[${snapshotIndex}]`;
      if (!isRecord(snapshot)) {
        throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', `${field} 必须是对象。`);
      }
      const snapshotId = requireString(snapshot.snapshotId, `${field}.snapshotId`);
      if (snapshotIds.has(snapshotId)) {
        throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', `快照 ID 重复：${snapshotId}。`);
      }
      snapshotIds.add(snapshotId);
      const snapshotKey = requireString(snapshot.snapshotKey, `${field}.snapshotKey`);
      if (snapshotKeys.has(snapshotKey)) {
        throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', `快照标识重复：${snapshotKey}。`);
      }
      if (!snapshotKey.startsWith(`${id}@`)) {
        throw new AtlasDataError(
          'ATLAS_DATASET_REPOSITORY_INVALID',
          `${field}.snapshotKey 必须以仓库 ID（${id}@）开头，避免不同仓库的快照标识冲突。`,
        );
      }
      snapshotKeys.add(snapshotKey);
      requireString(snapshot.commit, `${field}.commit`);
      requireString(snapshot.commitShort, `${field}.commitShort`);
      requireString(snapshot.importedAt, `${field}.importedAt`);
      requireString(snapshot.graphifyVersion, `${field}.graphifyVersion`);
      for (const nullable of ['scannedAt', 'generatedAt']) {
        if (snapshot[nullable] !== null && typeof snapshot[nullable] !== 'string') {
          throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', `${field}.${nullable} 必须是字符串或 null。`);
        }
      }
      if (snapshot.history !== true) {
        throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', `${field}.history 必须为 true。`);
      }
      if (typeof snapshot.nodeCount !== 'number' || typeof snapshot.relationCount !== 'number') {
        throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', `${field} 缺少节点/关系计数。`);
      }
      return snapshot as unknown as AtlasRepositoryRecord['snapshots'][number];
    });
    return {
      id,
      name: entry.name,
      system: entry.system,
      snapshots,
    } as AtlasRepositoryRecord;
  });
}

function validateRepositoryBindings(
  repositories: AtlasRepositoryRecord[],
  snapshot: AtlasDataset['snapshot'],
  nodes: AtlasNode[],
): void {
  const repositoryIds = new Set(repositories.map((repository) => repository.id));
  const commits = evidenceCommitMap(repositories);
  for (const [index, node] of nodes.entries()) {
    requireString(node.repository, `nodes[${index}].repository`);
    if (repositories.length && !repositoryIds.has(node.repository)) {
      throw new AtlasDataError(
        'ATLAS_DATASET_REPOSITORY_INVALID',
        `nodes[${index}].repository=${node.repository} 不在仓库登记表中。`,
      );
    }
    const prefix = nodeIdRepositoryPrefix(node.id);
    if (prefix !== node.repository) {
      throw new AtlasDataError(
        'ATLAS_DATASET_REPOSITORY_INVALID',
        `nodes[${index}].id 的仓库前缀（${prefix ?? '缺失'}）与 repository=${node.repository} 不一致。`,
      );
    }
    node.evidence.forEach((evidence, evidenceIndex) =>
      validateEvidenceBinding(
        evidence,
        commits,
        `nodes[${index}].evidence[${evidenceIndex}]`,
      ),
    );
  }
  if (snapshot) {
    const snapshotRepository = repositories.find(
      (repository) => repository.id === snapshot.repository.id,
    );
    if (!snapshotRepository) {
      throw new AtlasDataError(
        'ATLAS_DATASET_REPOSITORY_INVALID',
        `快照仓库 ${snapshot.repository.id} 不在 repositories 登记表中。`,
      );
    }
    if (
      !snapshotRepository.snapshots.some(
        (entry) => entry.snapshotId === snapshot.id && entry.commit === snapshot.commit,
      )
    ) {
      throw new AtlasDataError(
        'ATLAS_DATASET_REPOSITORY_INVALID',
        `快照 ${snapshot.id} 没有对应的仓库快照记录。`,
      );
    }
  }
}

function validateSnapshot(raw: AtlasDataset): void {
  if (raw.source.kind === 'demo') {
    if (raw.snapshot !== null) {
      throw new AtlasDataError('ATLAS_DATASET_SNAPSHOT_INVALID', '演示数据不应包含真实快照。');
    }
    return;
  }
  if (!isRecord(raw.snapshot)) {
    throw new AtlasDataError('ATLAS_DATASET_SNAPSHOT_INVALID', 'Graphify 数据必须包含 snapshot。');
  }
  const snapshot = raw.snapshot;
  if (snapshot.history !== true) {
    throw new AtlasDataError('ATLAS_DATASET_SNAPSHOT_INVALID', '历史快照必须标记 history=true。');
  }
  requireString(snapshot.commit, 'snapshot.commit');
  requireString(snapshot.graphifyVersion, 'snapshot.graphifyVersion');
  if (typeof snapshot.graphifySchemaVersion !== 'number') {
    throw new AtlasDataError('ATLAS_DATASET_SNAPSHOT_INVALID', 'snapshot.graphifySchemaVersion 必须是数字。');
  }
  if (!isRecord(snapshot.stats)) {
    throw new AtlasDataError('ATLAS_DATASET_SNAPSHOT_INVALID', 'snapshot.stats 缺失。');
  }
}

function canonicalize(dataset: AtlasDataset): AtlasDataset {
  const systemRank = new Map(SYSTEM_ORDER.map((id, index) => [id, index]));
  const moduleRank = new Map(MODULE_ORDER.map((id, index) => [id, index]));
  return {
    ...dataset,
    systems: [...dataset.systems].sort(
      (a, b) => (systemRank.get(a.id) ?? 99) - (systemRank.get(b.id) ?? 99),
    ),
    modules: [...dataset.modules].sort(
      (a, b) => (moduleRank.get(a.id) ?? 99) - (moduleRank.get(b.id) ?? 99),
    ),
    nodes: [...dataset.nodes].sort((a, b) => a.id.localeCompare(b.id, 'en')),
    relations: [...dataset.relations].sort((a, b) => a.id.localeCompare(b.id, 'en')),
    flows: [...(dataset.flows ?? [])].sort((a, b) => a.id.localeCompare(b.id, 'en')),
    repositories: [...(dataset.repositories ?? [])]
      .map((repository) => ({
        ...repository,
        snapshots: [...repository.snapshots].sort((a, b) =>
          a.snapshotKey.localeCompare(b.snapshotKey, 'en'),
        ),
      }))
      .sort((a, b) => a.id.localeCompare(b.id, 'en')),
  };
}

export function parseAtlasDataset(rawInput: unknown): AtlasDataset {
  if (!isRecord(rawInput)) {
    throw new AtlasDataError('ATLAS_NOT_OBJECT', 'ATLAS 数据必须是 JSON 对象。');
  }
  if (rawInput.schemaId !== ATLAS_SCHEMA_ID) {
    throw new AtlasDataError(
      'ATLAS_SCHEMA_ID_UNSUPPORTED',
      `不是 ATLAS 标准数据（schemaId=${String(rawInput.schemaId ?? '缺失')}）。`,
    );
  }
  const version = requireString(rawInput.schemaVersion, 'schemaVersion');
  const major = parseMajor(version);
  const minor = parseMinor(version);
  if (major !== ATLAS_SCHEMA_MAJOR || !Number.isFinite(minor) || minor > ATLAS_SCHEMA_MINOR) {
    throw new AtlasDataError(
      'ATLAS_SCHEMA_VERSION_UNSUPPORTED',
      `ATLAS Schema ${version} 与当前版本 ${ATLAS_SCHEMA_VERSION} 不兼容（支持 1.0.x – ${ATLAS_SCHEMA_MINOR}.x）。`,
    );
  }
  const migrated = minor < 1 ? migrateDatasetV1(rawInput) : rawInput;
  const migratedV13 = minor < 3 ? normalizeDatasetV13(migrated, version) : migrated;
  const raw = minor < 4 ? normalizeDatasetV14(migratedV13, version) : migratedV13;
  if (!isRecord(raw.source) || !SOURCE_KINDS.includes(raw.source.kind as AtlasSourceKind)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', 'source.kind 必须是 demo 或 graphify。');
  }
  if (!Array.isArray(raw.systems) || !Array.isArray(raw.modules)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', 'systems / modules 必须是数组。');
  }
  for (const [index, system] of raw.systems.entries()) {
    if (!isRecord(system) || !isAtlasSystemId(system.id)) {
      throw new AtlasDataError('ATLAS_DATASET_INVALID', `systems[${index}] 不是合法系统。`);
    }
  }

  const rawNodes = requireArray(raw.nodes, 'nodes');
  const rawRelations = requireArray(raw.relations, 'relations');
  const nodes = rawNodes.map((node, index) => validateNode(node, index));
  const nodeIds = new Set<string>();
  const nodeById = new Map<string, AtlasNode>();
  for (const [index, node] of nodes.entries()) {
    if (nodeIds.has(node.id)) {
      throw new AtlasDataError('ATLAS_DATASET_DUPLICATE_NODE', `nodes[${index}] 重复节点 ID：${node.id}。`);
    }
    nodeIds.add(node.id);
    nodeById.set(node.id, node);
  }
  const repositories = validateRepositories(
    raw.repositories ?? deriveRepositories(raw.snapshot),
  );
  if (raw.source.kind === 'graphify' && !repositories.length) {
    throw new AtlasDataError(
      'ATLAS_DATASET_REPOSITORY_INVALID',
      'Graphify 数据必须登记至少一个仓库。',
    );
  }
  validateRepositoryBindings(repositories, (raw.snapshot ?? null) as AtlasDataset['snapshot'], nodes);
  const modules = raw.modules.map((module, index) => validateModule(module, index));
  validateModuleBindings(modules, nodes, repositories);
  const scopeMigration = minor < 4 ? emptyScopeMigration(version) : null;
  const relations = rawRelations.map((relation, index) =>
    validateRelation(relation, index, nodeById, {
      originalMinor: minor,
      repositories,
      scopeMigration,
    }),
  );
  const relationIds = new Set<string>();
  for (const [index, relation] of relations.entries()) {
    if (relationIds.has(relation.id)) {
      throw new AtlasDataError(
        'ATLAS_DATASET_DUPLICATE_RELATION',
        `relations[${index}] 重复关系 ID：${relation.id}。同一快照内关系 ID 必须唯一。`,
      );
    }
    relationIds.add(relation.id);
  }
  const flows = Array.isArray(raw.flows)
    ? raw.flows.map((flow, index) => validateFlow(flow, index, nodes))
    : [];
  if (!isRecord(raw.diagnostics)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', 'diagnostics 缺失。');
  }
  const rawCounts = isRecord(raw.diagnostics.counts) ? raw.diagnostics.counts : {};
  // P2.0-A.1 增加统计分区字段；旧快照不重写，读取时按节点补算缺失维度。
  const diagnostics = {
    ...raw.diagnostics,
    counts: {
      ...rawCounts,
      internalNodes:
        typeof rawCounts.internalNodes === 'number'
          ? rawCounts.internalNodes
          : nodes.filter((node) => node.scope !== 'external').length,
      assignedNodes:
        typeof rawCounts.assignedNodes === 'number'
          ? rawCounts.assignedNodes
          : nodes.filter((node) => node.moduleId !== null).length,
      unassignedNodes:
        typeof rawCounts.unassignedNodes === 'number'
          ? rawCounts.unassignedNodes
          : nodes.filter((node) => node.moduleId === null).length,
      multiModuleNodes:
        typeof rawCounts.multiModuleNodes === 'number'
          ? rawCounts.multiModuleNodes
          : nodes.filter((node) => node.moduleIds.length > 1).length,
    },
    reviewCounts: isRecord(raw.diagnostics.reviewCounts)
      ? raw.diagnostics.reviewCounts
      : reviewCountsFor(relations as AtlasRelation[]),
  };
  validateSnapshot(raw as unknown as AtlasDataset);

  if (scopeMigration) {
    scopeMigration.notes = [
      '旧数据没有节点 runtimeBoundary 时，runtimeScope 一律保持 unknown；同仓库、同文件或同目录都不等于同进程。',
      '旧版 scope=cross-process 只迁移运行时维度；仓库维度由两端 repository 独立计算，二者可以同时成立。',
      `本数据集共迁移 ${relations.length} 条关系；原始 evidence、review、commit 与 legacyScope 均保留。`,
    ];
    if (scopeMigration.runtimeVerifiedDowngraded) {
      scopeMigration.notes.push(
        `有 ${scopeMigration.runtimeVerifiedDowngraded} 条旧 runtimeVerified=true 因缺少带类型运行时证据或复核被降级为 false；原始 runtimeEvidence 未删除。`,
      );
    }
    if (scopeMigration.repositoryScopes.crossRepository) {
      scopeMigration.notes.push(
        '旧版跨仓库关系若没有 1.4 interfaceEvidence，会保留为未确认候选，不进入已确认跨仓库关系图。',
      );
    }
  }

  return canonicalize({
    ...(raw as unknown as AtlasDataset),
    nodes,
    relations,
    modules,
    flows,
    repositories,
    ...(scopeMigration ? { scopeMigration } : {}),
    diagnostics: diagnostics as unknown as AtlasDataset['diagnostics'],
  });
}

export function serializeAtlasDataset(dataset: AtlasDataset): string {
  return JSON.stringify(canonicalize(dataset));
}

export function importAtlasDatasetText(text: string): AtlasDataset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new AtlasDataError('ATLAS_INVALID_JSON', '文件不是合法 JSON，无法导入。');
  }
  return parseAtlasDataset(parsed);
}

export interface ModuleHighlight {
  id: string;
  name: string;
  responsibility: string;
  locator: string;
  review: AtlasReviewStatus;
}

export function moduleHighlights(
  dataset: AtlasDataset,
  moduleId: AtlasModuleId,
  limit = 6,
): ModuleHighlight[] {
  return dataset.nodes
    .filter(
      (node) =>
        node.scope === 'product' &&
        node.moduleIds.includes(moduleId) &&
        node.displayName !== null &&
        node.responsibility !== null,
    )
    .sort((a, b) => {
      const aPrimary = a.moduleId === moduleId ? 0 : 1;
      const bPrimary = b.moduleId === moduleId ? 0 : 1;
      if (aPrimary !== bPrimary) return aPrimary - bPrimary;
      return (a.displayName ?? '').localeCompare(b.displayName ?? '', 'zh-CN');
    })
    .slice(0, limit)
    .map((node) => ({
      id: node.id,
      name: node.displayName ?? node.symbol,
      responsibility: node.responsibility ?? '',
      locator: node.evidence[0]?.locator ?? node.sourceFile ?? 'unknown',
      review: node.review.status,
    }));
}

export function moduleById(dataset: AtlasDataset, moduleId: AtlasModuleId): AtlasModuleRecord | null {
  return dataset.modules.find((module) => module.id === moduleId) ?? null;
}

export function countVerifiedRelations(dataset: AtlasDataset): number {
  return dataset.relations.filter((relation) => relation.review.status === 'verified').length;
}

export interface CrossModulePair {
  from: AtlasModuleId;
  to: AtlasModuleId;
  count: number;
}

export interface CrossModuleSummary {
  total: number;
  pairs: CrossModulePair[];
}

/**
 * 按主模块去重后的跨模块关系。模块卡片里的“跨模块”是成员关系统计，
 * Canvas 支撑文件会在多个模块重复出现；这里给出不重叠的总量。
 */
export function crossModuleSummary(dataset: AtlasDataset): CrossModuleSummary {
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const counts = new Map<string, CrossModulePair>();
  let total = 0;

  for (const relation of dataset.relations) {
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from || !to || from.scope !== 'product' || to.scope !== 'product') continue;
    if (!from.moduleId || !to.moduleId || from.moduleId === to.moduleId) continue;
    const [a, b] = [from.moduleId, to.moduleId].sort();
    const key = `${a}|${b}`;
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { from: a, to: b, count: 1 });
    total += 1;
  }

  return {
    total,
    pairs: [...counts.values()].sort((a, b) => b.count - a.count),
  };
}

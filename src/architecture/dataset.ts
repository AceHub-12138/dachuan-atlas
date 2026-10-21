import {
  ATLAS_SCHEMA_ID,
  ATLAS_SCHEMA_MAJOR,
  ATLAS_SCHEMA_MINOR,
  ATLAS_SCHEMA_VERSION,
  AtlasDataError,
  isAtlasModuleId,
  isAtlasSystemId,
  MODULE_ORDER,
  type AtlasDataset,
  type AtlasEvidenceRef,
  type AtlasFlowScenario,
  type AtlasFlowSemantics,
  type AtlasFlowStep,
  type AtlasModuleComponent,
  type AtlasModuleId,
  type AtlasModuleRecord,
  type AtlasNode,
  type AtlasRelation,
  type AtlasRelationScope,
  type AtlasRepositoryRecord,
  type AtlasReview,
  type AtlasReviewMethod,
  type AtlasReviewStatus,
  type AtlasRuntimeBoundary,
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
const RELATION_SCOPES: AtlasRelationScope[] = [
  'intra-repository',
  'cross-repository',
  'cross-process',
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

function isRelationScope(value: unknown): value is AtlasRelationScope {
  return RELATION_SCOPES.includes(value as AtlasRelationScope);
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
          `数据集由 ATLAS Schema ${originalVersion} 迁移到 ${ATLAS_SCHEMA_VERSION}；流程语义默认按“模块协作示意”处理，未新增运行时结论。`,
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
          '数据集由 ATLAS Schema 1.0.0 迁移到 1.3.0；原始快照字段未改写。',
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

function validateRelation(
  raw: unknown,
  index: number,
  nodeById: Map<string, AtlasNode>,
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

  const scope = relation.scope ?? 'intra-repository';
  if (!isRelationScope(scope)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `relations[${index}].scope 非法。`);
  }
  if (relation.runtimeVerified !== undefined && typeof relation.runtimeVerified !== 'boolean') {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `relations[${index}].runtimeVerified 必须是布尔值。`);
  }
  if (relation.runtimeEvidence !== undefined) {
    if (!Array.isArray(relation.runtimeEvidence)) {
      throw new AtlasDataError('ATLAS_DATASET_INVALID', `relations[${index}].runtimeEvidence 必须是数组。`);
    }
    relation.runtimeEvidence.forEach((evidence, evidenceIndex) =>
      validateEvidenceRef(evidence, `relations[${index}].runtimeEvidence[${evidenceIndex}]`),
    );
  }

  const crossRepository = fromNode.repository !== toNode.repository;
  if (crossRepository && scope !== 'cross-repository') {
    throw new AtlasDataError(
      'ATLAS_DATASET_CROSS_REPO_INVALID',
      `relations[${index}] 连接不同仓库（${fromNode.repository} → ${toNode.repository}），必须标记 scope=cross-repository。`,
    );
  }
  if (!crossRepository && scope === 'cross-repository') {
    throw new AtlasDataError(
      'ATLAS_DATASET_CROSS_REPO_INVALID',
      `relations[${index}] 标记为跨仓库，但两端属于同一仓库。`,
    );
  }
  if (crossRepository) {
    const reviewed =
      (relation.review.method === 'ai-source-review' ||
        relation.review.method === 'human-review') &&
      relation.review.status !== 'unverified';
    const hasEvidence = relation.evidence !== null || relation.review.evidence.length > 0;
    if (!reviewed || !hasEvidence) {
      throw new AtlasDataError(
        'ATLAS_DATASET_CROSS_REPO_INVALID',
        `relations[${index}] 跨仓库关系必须提供接口/协议证据并经过 AI 或人工复核。`,
      );
    }
  }

  const fromBoundary = fromNode.runtimeBoundary ?? null;
  const toBoundary = toNode.runtimeBoundary ?? null;
  const knownBoundary = (value: AtlasRuntimeBoundary | null): value is AtlasRuntimeBoundary =>
    value !== null && value !== 'unknown' && value !== 'shared';
  const crossProcess =
    knownBoundary(fromBoundary) && knownBoundary(toBoundary) && fromBoundary !== toBoundary;
  if (crossProcess && scope !== 'cross-process') {
    if (scope === 'cross-repository') {
      throw new AtlasDataError(
        'ATLAS_DATASET_CROSS_REPO_INVALID',
        `relations[${index}] 同时跨仓库和跨进程；请拆分关系或显式标记 cross-process，不能把两个运行时混在一起。`,
      );
    }
    throw new AtlasDataError(
      'ATLAS_DATASET_CROSS_REPO_INVALID',
      `relations[${index}] 两端位于不同运行时（${fromBoundary} → ${toBoundary}），必须标记 scope=cross-process。`,
    );
  }
  if (!crossProcess && scope === 'cross-process') {
    throw new AtlasDataError(
      'ATLAS_DATASET_CROSS_REPO_INVALID',
      `relations[${index}] 标记为跨进程，但两端没有已知且不同的运行时边界。`,
    );
  }
  if (relation.runtimeVerified === true && !(relation.runtimeEvidence?.length)) {
    throw new AtlasDataError(
      'ATLAS_DATASET_CROSS_REPO_INVALID',
      `relations[${index}] 声称运行时已验证，但没有 runtimeEvidence。`,
    );
  }
  return relation;
}

function validateModule(raw: unknown, index: number): AtlasModuleRecord {
  if (!isRecord(raw)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `modules[${index}] 必须是对象。`);
  }
  const module = raw as unknown as AtlasModuleRecord;
  if (!isAtlasModuleId(module.id)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', `modules[${index}].id 不是合法模块。`);
  }
  requireString(module.name, `modules[${index}].name`);
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
    if (!Array.isArray(entry.snapshots)) {
      throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', `repositories[${index}].snapshots 必须是数组。`);
    }
    const snapshots = entry.snapshots.map((snapshot, snapshotIndex) => {
      const field = `repositories[${index}].snapshots[${snapshotIndex}]`;
      if (!isRecord(snapshot)) {
        throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', `${field} 必须是对象。`);
      }
      requireString(snapshot.snapshotId, `${field}.snapshotId`);
      const snapshotKey = requireString(snapshot.snapshotKey, `${field}.snapshotKey`);
      if (snapshotKeys.has(snapshotKey)) {
        throw new AtlasDataError('ATLAS_DATASET_REPOSITORY_INVALID', `快照标识重复：${snapshotKey}。`);
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
  const raw = minor < 3 ? normalizeDatasetV13(migrated, version) : migrated;
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
  const relations = rawRelations.map((relation, index) =>
    validateRelation(relation, index, nodeById),
  );
  const modules = raw.modules.map((module, index) => validateModule(module, index));
  const flows = Array.isArray(raw.flows)
    ? raw.flows.map((flow, index) => validateFlow(flow, index, nodes))
    : [];
  if (!isRecord(raw.diagnostics)) {
    throw new AtlasDataError('ATLAS_DATASET_INVALID', 'diagnostics 缺失。');
  }
  const diagnostics = {
    ...raw.diagnostics,
    reviewCounts: isRecord(raw.diagnostics.reviewCounts)
      ? raw.diagnostics.reviewCounts
      : reviewCountsFor(relations as AtlasRelation[]),
  };
  validateSnapshot(raw as unknown as AtlasDataset);

  return canonicalize({
    ...(raw as unknown as AtlasDataset),
    nodes,
    relations,
    modules,
    flows,
    repositories,
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

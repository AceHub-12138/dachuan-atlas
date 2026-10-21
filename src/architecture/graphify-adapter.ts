import {
  ATLAS_SCHEMA_VERSION,
  aiReview,
  AtlasDataError,
  emptyReview,
  isAtlasModuleId,
  MODULE_ORDER,
  type AtlasDataset,
  type AtlasDiagnostics,
  type AtlasEvidenceConfidence,
  type AtlasEvidenceRef,
  type AtlasIssue,
  type AtlasManifestStatus,
  type AtlasModuleComponent,
  type AtlasModuleId,
  type AtlasModuleRecord,
  type AtlasModuleStats,
  type AtlasNode,
  type AtlasRelation,
  type AtlasRelationType,
  type AtlasRepositoryRecord,
  type AtlasReview,
  type AtlasReviewMethod,
  type AtlasSnapshot,
  type AtlasSnapshotStats,
  type AtlasSystemRecord,
  type AtlasUnresolvedCall,
} from './schema.ts';
import {
  isRepoFileReference,
  looksLikePathDerivedLabel,
  makeLocator,
  normalizeRelativePath,
  parseSourceLine,
  REDACTED_EXTERNAL_LABEL,
  shortCommit,
  sortBy,
} from './paths.ts';
import {
  baseModuleStats,
  classifyNode,
  MODULE_DEFINITIONS,
  moduleReviewNote,
} from './module-map.ts';
import { annotationFor, labelBase, type DisplayAnnotation } from './display-names.ts';
import { AI_REVIEW_ACTOR, AI_REVIEW_DATE, AI_REVIEWED_RELATION_MAP } from './review-records.ts';
import {
  readSnapshotManifest,
  type SnapshotManifestProvenance,
} from './import-provenance.ts';
import type { RepositoryProfile } from './repository-profile.ts';

/**
 * Graphify → ATLAS 适配器。
 *
 * 只做确定性的结构转换，不做语义补全：
 * - 原始节点/边尽量保留，包括自调用和多重的不同类型关系；
 * - 无法定位的边、重复节点、绝对路径会进入 diagnostics，不静默吞掉；
 * - Community 只保留为原值，不参与模块归类；
 * - 所有关系默认“待核实”，只有 AI 源码复核清单里的关系才是“AI 源码复核”。
 */

export const SUPPORTED_GRAPHIFY_SCHEMA = 1;
export const SUPPORTED_GRAPHIFY_VERSION_PREFIX = '0.9.';
export interface GraphifyManifestVerification {
  fileCount: number;
  byteCount: number;
  verifiedFiles: number;
  verifiedAt: string;
}

export interface AdaptGraphifyOptions {
  repositoryId?: string;
  repositoryName?: string;
  commitOverride?: string;
  expectedCommit?: string;
  expectedRepositoryId?: string;
  generatedAt?: string | null;
  scannedAt?: string | null;
  importedAt?: string;
  manifestVerification?: GraphifyManifestVerification | null;
  /** 调用方完成三件套来源核对后传入；未传时按清单校验结果推导。 */
  importStatusOverride?: 'complete' | 'partial';
}

export interface AdaptGraphifyInput {
  graph: unknown;
  manifest?: unknown;
  options?: AdaptGraphifyOptions;
}

const COVERAGE_NOTES = [
  'Graphify 快照没有 requestAnimationFrame / cancelAnimationFrame 节点；动画调度只能依据 MotionDirector 源码判断。',
  '快照没有 getContext / fillRect / CanvasRenderingContext2D 节点或边；Canvas 调用网络不完整。',
  'snapshot-manifest 包含 2 个 CSS 文件，但 graph.json 没有 CSS 节点；样式对布局与动效的影响未进入关系图。',
  '动态函数调用、React 回调、运行时状态管理大多没有边；metadata.unresolved_calls 记录了部分未能落边的调用。',
  '浏览器与 voice-orchestrator 分属两个进程，Graphify 没有生成跨进程运行时边。',
  'Community 编号只保留为原图字段，不参与业务模块判定。',
  '“没有边”不等于“不存在调用”；本数据集不据此断言关系不存在。',
];

/**
 * NEXUS 的导入 profile。CRM / Electron 必须提供自己的 profile，不能复用
 * 这里的四个模块、中文注释或关系复核清单。
 */
export const NEXUS_REPOSITORY_PROFILE: RepositoryProfile = {
  schema: 'atlas.repository-profile',
  schemaVersion: '1.0.0',
  synthetic: false,
  repository: {
    id: 'nexus',
    name: 'NEXUS 可视化大屏',
    system: 'nexus',
    workspaceLabel: 'NEXUS',
  },
  sourceLabel: 'NEXUS 本地历史快照',
  modules: MODULE_DEFINITIONS,
  moduleOrder: MODULE_ORDER,
  coverageNotes: COVERAGE_NOTES,
  snapshotNotes: [],
};

function moduleRecordReview(
  definition: (typeof MODULE_DEFINITIONS)[number],
  note: string,
  evidence: AtlasEvidenceRef[],
  profile: RepositoryProfile,
): AtlasReview {
  if (profile.repository.system === 'nexus') {
    return aiReview(note, evidence, {
      actor: AI_REVIEW_ACTOR,
      reviewedAt: AI_REVIEW_DATE,
      status: definition.review,
    });
  }
  return {
    status: definition.review,
    method: definition.reviewMethod ?? 'unverified',
    actor: definition.reviewActor ?? null,
    reviewer: definition.reviewActor ?? null,
    reviewedAt: definition.reviewedAt ?? null,
    note: definition.reviewNote ?? note,
    evidence,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function mapRelationType(raw: string): AtlasRelationType {
  const allowed: AtlasRelationType[] = [
    'contains',
    'calls',
    'imports_from',
    'imports',
    'method',
    'indirect_call',
    'references',
    'rationale_for',
    'implements',
    'dynamic_import',
    'cites',
  ];
  return allowed.includes(raw as AtlasRelationType) ? (raw as AtlasRelationType) : 'unknown';
}

function mapEvidenceType(value: unknown): AtlasEvidenceConfidence {
  return value === 'EXTRACTED' || value === 'INFERRED' || value === 'AMBIGUOUS' ? value : 'UNKNOWN';
}

function asConfidence(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function validateEnvelope(graph: unknown): { nodes: unknown[]; links: unknown[]; graphifyVersion: string; graphifySchemaVersion: number } {
  if (!isRecord(graph)) {
    throw new AtlasDataError('GRAPHIFY_NOT_OBJECT', 'Graphify 数据必须是 JSON 对象。');
  }
  const meta = graph.graph;
  if (!isRecord(meta)) {
    throw new AtlasDataError('GRAPHIFY_METADATA_MISSING', '缺少 graph 元数据（schema_version / graphify_version），无法确认数据版本。');
  }
  const schemaVersion = meta.schema_version;
  if (typeof schemaVersion !== 'number') {
    throw new AtlasDataError('GRAPHIFY_METADATA_MISSING', '缺少 graph.schema_version，无法确认数据版本。');
  }
  if (schemaVersion !== SUPPORTED_GRAPHIFY_SCHEMA) {
    throw new AtlasDataError(
      'GRAPHIFY_SCHEMA_UNSUPPORTED',
      `Graphify schema_version=${schemaVersion} 不受支持；本轮只支持 schema_version=${SUPPORTED_GRAPHIFY_SCHEMA}。`,
    );
  }
  const graphifyVersion = typeof meta.graphify_version === 'string' ? meta.graphify_version : '';
  if (!graphifyVersion) {
    throw new AtlasDataError('GRAPHIFY_METADATA_MISSING', '缺少 graph.graphify_version，无法确认 Graphify 版本。');
  }
  if (!graphifyVersion.startsWith(SUPPORTED_GRAPHIFY_VERSION_PREFIX)) {
    throw new AtlasDataError(
      'GRAPHIFY_VERSION_UNSUPPORTED',
      `Graphify ${graphifyVersion} 不受支持；本轮适配 0.9.x（POC-2 为 0.9.92）。`,
    );
  }
  if (!Array.isArray(graph.nodes)) {
    throw new AtlasDataError('GRAPHIFY_NODES_INVALID', 'graph.nodes 必须是数组。');
  }
  if (!Array.isArray(graph.links)) {
    throw new AtlasDataError('GRAPHIFY_LINKS_INVALID', 'graph.links 必须是数组。');
  }
  if (!graph.nodes.length) {
    throw new AtlasDataError('GRAPHIFY_EMPTY', 'graph.nodes 为空，无法构建架构数据。');
  }
  return { nodes: graph.nodes, links: graph.links, graphifyVersion, graphifySchemaVersion: schemaVersion };
}

function buildLogicalId(
  repositoryId: string,
  sourceFile: string | null,
  label: string,
  sourceId: string,
  line: number | null,
  used: Set<string>,
): string {
  const base = `${repositoryId}:${sourceFile ?? 'external'}#${label}`;
  if (!used.has(base)) return base;

  // 同名方法（例如多个类的 constructor）优先用原 ID 中的父级作用域区分。
  if (sourceFile) {
    const withoutExtension = sourceFile.replace(/\.[a-z0-9]+$/i, '');
    const pathSlug = withoutExtension.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
    const labelSlug = labelBase(label).replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
    let rest = sourceId;
    if (rest.startsWith(`${pathSlug}_`)) rest = rest.slice(pathSlug.length + 1);
    if (labelSlug && rest.endsWith(`_${labelSlug}`)) {
      const parent = rest.slice(0, -(labelSlug.length + 1));
      if (parent) {
        const scopedLabel = label.startsWith('.') ? label.slice(1) : label;
        const scoped = `${repositoryId}:${sourceFile}#${parent}.${scopedLabel}`;
        if (!used.has(scoped)) return scoped;
      }
    }
  }
  if (line) {
    const located = `${base}@L${line}`;
    if (!used.has(located)) return located;
  }
  let counter = 2;
  while (used.has(`${base}~${counter}`)) counter += 1;
  return `${base}~${counter}`;
}

function buildEvidence(
  repositoryId: string,
  commit: string,
  file: string | null,
  line: number | null,
  symbol: string | null,
): AtlasEvidenceRef[] {
  if (!file) return [];
  return [
    {
      repository: repositoryId,
      commit,
      file,
      line,
      symbol,
      locator: makeLocator(file, line),
    },
  ];
}

function readUnresolvedCalls(metadata: unknown): AtlasUnresolvedCall[] {
  if (!isRecord(metadata) || !Array.isArray(metadata.unresolved_calls)) return [];
  const calls: AtlasUnresolvedCall[] = [];
  for (const entry of metadata.unresolved_calls) {
    if (!isRecord(entry)) continue;
    const callee = asString(entry.callee);
    if (!callee) continue;
    calls.push({
      callee,
      receiverType: asString(entry.receiver_type),
      line: asString(entry.line),
      language: asString(entry.lang),
    });
  }
  return calls;
}

function reviewMethodForRelation(evidenceType: AtlasEvidenceConfidence): AtlasReviewMethod {
  if (evidenceType === 'EXTRACTED') return 'graphify-extracted';
  if (evidenceType === 'INFERRED') return 'graphify-inferred';
  return 'unverified';
}

/**
 * NEXUS 兼容入口。P1.0–P1.4 的调用方与测试继续使用这个函数，
 * 输出语义不变；CRM / Electron 使用 adaptGraphifyWithProfile。
 */
export function adaptGraphify(input: AdaptGraphifyInput): AtlasDataset {
  return adaptGraphifyWithProfile(input, NEXUS_REPOSITORY_PROFILE);
}

export function adaptGraphifyWithProfile(
  input: AdaptGraphifyInput,
  profile: RepositoryProfile,
): AtlasDataset {
  const options = input.options ?? {};
  const repositoryId = options.repositoryId ?? profile.repository.id;
  if (repositoryId !== profile.repository.id) {
    throw new AtlasDataError(
      'REPOSITORY_PROFILE_REPOSITORY_MISMATCH',
      `适配器仓库 ID=${repositoryId} 与 profile.repository.id=${profile.repository.id} 不一致。`,
    );
  }
  const repositoryName = options.repositoryName ?? profile.repository.name;
  const importedAt = options.importedAt ?? new Date().toISOString();
  const manifest: SnapshotManifestProvenance | null =
    input.manifest === undefined || input.manifest === null
      ? null
      : readSnapshotManifest(input.manifest, {
          // 只有调用方显式声明期望仓库时才强制清单身份；NEXUS 旧导入
          // 保持原有兼容行为，CRM CLI 则必须传入 expectedRepositoryId。
          expectedRepositoryId: options.expectedRepositoryId,
          expectedSystem: options.expectedRepositoryId
            ? profile.repository.system
            : undefined,
        });
  const manifestCommit = manifest?.commit ?? null;

  if (options.expectedCommit && manifestCommit && options.expectedCommit !== manifestCommit) {
    throw new AtlasDataError(
      'GRAPHIFY_COMMIT_MISMATCH',
      `快照提交不一致：manifest 为 ${shortCommit(manifestCommit)}，期望 ${shortCommit(options.expectedCommit)}。`,
    );
  }

  const commit = manifestCommit ?? options.commitOverride ?? 'unknown';
  if (options.expectedCommit && !manifestCommit && commit !== 'unknown' && commit !== options.expectedCommit) {
    throw new AtlasDataError(
      'GRAPHIFY_COMMIT_MISMATCH',
      `快照提交不一致：数据为 ${shortCommit(commit)}，期望 ${shortCommit(options.expectedCommit)}。`,
    );
  }

  const { nodes: rawNodes, links: rawLinks, graphifyVersion, graphifySchemaVersion } = validateEnvelope(input.graph);

  const issues: AtlasIssue[] = [];
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  const counters = new Map<string, number>();
  const count = (key: string) => counters.get(key) ?? 0;

  const nodes: AtlasNode[] = [];
  const nodeIdByRawId = new Map<string, string>();
  const usedLogicalIds = new Set<string>();
  const usedRawIds = new Set<string>();
  const unresolvedByReceiver = new Map<string, number>();
  let unresolvedCalls = 0;
  let nodesWithUnresolvedCalls = 0;
  let redactedLabels = 0;

  rawNodes.forEach((rawNode, index) => {
    if (!isRecord(rawNode)) {
      bump(counters, 'invalidNodes');
      return;
    }
    const rawId = asString(rawNode.id);
    const rawLabel = asString(rawNode.label);
    if (!rawId || !rawLabel) {
      bump(counters, 'invalidNodes');
      return;
    }
    if (usedRawIds.has(rawId)) {
      bump(counters, 'duplicateNodeIds');
      return;
    }
    usedRawIds.add(rawId);

    const rawFile = asString(rawNode.source_file);
    const fileType = asString(rawNode.file_type);
    const explicitlyExternal = asBoolean(rawNode.external) || rawNode.type === 'external';
    let sourceFile: string | null = null;
    let external = explicitlyExternal;

    if (rawFile) {
      const normalized = normalizeRelativePath(rawFile);
      if (!normalized.ok) {
        // 绝对路径不进入数据集，也不在诊断信息中回显。
        bump(counters, 'rejectedPaths');
        return;
      }
      if (isRepoFileReference(normalized.path)) {
        sourceFile = normalized.path;
        external = false;
      } else {
        bump(counters, 'nonFileSources');
        external = true;
      }
    } else {
      external = true;
    }

    const sensitive = looksLikePathDerivedLabel(rawLabel) || looksLikePathDerivedLabel(rawId);
    const label = sensitive ? REDACTED_EXTERNAL_LABEL : rawLabel;
    if (sensitive) {
      redactedLabels += 1;
      bump(counters, 'redactedLabels');
      external = true;
      sourceFile = null;
    }

    const line = parseSourceLine(rawNode.source_location);
    const classification = classifyNode(
      {
        sourceFile,
        external,
        fileType,
        label,
        callable: asBoolean(rawNode._callable),
        callableClass: asBoolean(rawNode._callable_class),
      },
      profile.modules,
    );

    const logicalId = sensitive
      ? `${repositoryId}:external#redacted-${index}`
      : buildLogicalId(repositoryId, sourceFile, label, rawId, line, usedLogicalIds);
    usedLogicalIds.add(logicalId);

    // 中文名称与职责只来自 NEXUS 的人工核对清单；CRM 不做机器翻译或自动补全。
    const annotation: DisplayAnnotation | null =
      profile.repository.system === 'nexus' ? annotationFor(sourceFile, label) : null;
    const nodeEvidence = buildEvidence(repositoryId, commit, sourceFile, line, label);
    const review = annotation
      ? aiReview(`${annotation.name}：${annotation.note}`, nodeEvidence)
      : emptyReview(null, external ? 'unverified' : 'graphify-extracted', [], graphifyVersion);

    const unresolved = readUnresolvedCalls(rawNode.metadata);
    if (unresolved.length) {
      nodesWithUnresolvedCalls += 1;
      unresolvedCalls += unresolved.length;
      for (const call of unresolved) {
        const receiver = call.receiverType ?? 'unknown';
        unresolvedByReceiver.set(receiver, (unresolvedByReceiver.get(receiver) ?? 0) + 1);
      }
    }

    const node: AtlasNode = {
      id: logicalId,
      sourceId: sensitive ? `redacted-${index}` : rawId,
      repository: repositoryId,
      system: profile.repository.system,
      kind: classification.kind,
      symbol: label,
      symbolType: classification.symbolType,
      sourceFile,
      sourceLine: line,
      scope: classification.scope,
      moduleId: classification.moduleId,
      moduleIds: classification.moduleIds,
      displayName: annotation?.name ?? null,
      responsibility: annotation?.responsibility ?? null,
      sourceConfidence:
        mapEvidenceType(rawNode.confidence) === 'UNKNOWN'
          ? sourceFile
            ? 'EXTRACTED'
            : 'UNKNOWN'
          : mapEvidenceType(rawNode.confidence),
      review,
      community: typeof rawNode.community === 'number' ? rawNode.community : null,
      external,
      metadata: unresolved.length ? { unresolvedCalls: unresolved } : {},
      evidence: nodeEvidence,
    };

    nodeIdByRawId.set(rawId, logicalId);
    nodes.push(node);
  });

  if (!nodes.length) {
    throw new AtlasDataError('GRAPHIFY_EMPTY', '没有可用的节点：全部节点都缺少 id/label 或路径不合法。');
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const relations: AtlasRelation[] = [];
  const relationKeys = new Set<string>();
  const relationIdCounts = new Map<string, number>();
  let duplicateRelationsCollapsed = 0;
  let danglingRelationsDropped = 0;
  let unknownRelationTypes = 0;
  let selfReferences = 0;

  rawLinks.forEach((rawLink, index) => {
    if (!isRecord(rawLink)) {
      bump(counters, 'invalidLinks');
      return;
    }
    const sourceRawId = asString(rawLink.source);
    const targetRawId = asString(rawLink.target);
    const from = sourceRawId ? nodeIdByRawId.get(sourceRawId) : undefined;
    const to = targetRawId ? nodeIdByRawId.get(targetRawId) : undefined;
    if (!from || !to) {
      danglingRelationsDropped += 1;
      return;
    }

    const sourceRelation = asString(rawLink.relation) ?? '';
    const type = mapRelationType(sourceRelation);
    if (type === 'unknown') unknownRelationTypes += 1;

    const evidenceType = mapEvidenceType(rawLink.confidence);
    const evidenceFileRaw = asString(rawLink.source_file);
    let evidenceFile: string | null = null;
    if (evidenceFileRaw) {
      const normalized = normalizeRelativePath(evidenceFileRaw);
      if (normalized.ok && isRepoFileReference(normalized.path)) evidenceFile = normalized.path;
    }
    const evidenceLine = parseSourceLine(rawLink.source_location);
    const context = asString(rawLink.context);
    const selfReference = from === to;
    if (selfReference) selfReferences += 1;

    const dedupeKey = [from, to, type, evidenceType, evidenceFile ?? '', evidenceLine ?? '', context ?? ''].join('|');
    if (relationKeys.has(dedupeKey)) {
      duplicateRelationsCollapsed += 1;
      return;
    }
    relationKeys.add(dedupeKey);

    const fromNode = nodeById.get(from);
    const toNode = nodeById.get(to);
    const verifiedKey = `${fromNode?.symbol ?? ''}|${type}|${toNode?.symbol ?? ''}|${evidenceFile ?? ''}`;
    const verificationNote =
      profile.repository.system === 'nexus' ? AI_REVIEWED_RELATION_MAP.get(verifiedKey) : undefined;

    const baseId = `${from}->${to}:${type}`;
    const seen = relationIdCounts.get(baseId) ?? 0;
    relationIdCounts.set(baseId, seen + 1);
    const relationEvidence: AtlasEvidenceRef | null = evidenceFile
      ? {
          repository: repositoryId,
          commit,
          file: evidenceFile,
          line: evidenceLine,
          symbol: fromNode?.symbol ?? null,
          locator: makeLocator(evidenceFile, evidenceLine),
        }
      : null;

    relations.push({
      id: seen === 0 ? baseId : `${baseId}~${seen + 1}`,
      from,
      to,
      type,
      sourceRelation,
      evidenceType,
      confidence: asConfidence(rawLink.confidence_score),
      review: verificationNote
        ? aiReview(verificationNote, relationEvidence ? [relationEvidence] : [])
        : emptyReview(
            null,
            reviewMethodForRelation(evidenceType),
            [],
            graphifyVersion,
          ),
      evidence: relationEvidence,
      selfReference,
      context,
      // Graphify 只做静态提取：同一仓库内，但运行时边界未知；不能推断同进程。
      repositoryScope: 'intra-repository',
      runtimeScope: 'unknown',
      runtimeVerified: false,
      runtimeEvidence: [],
      interfaceEvidence: [],
      legacyScope: null,
      scopeNote: 'Graphify 静态关系；仓库维度由同一 repository 确定，运行时维度未知。',
      flags: {
        deferred: asBoolean(rawLink.deferred),
        typeOnly: asBoolean(rawLink.type_only),
      },
      sourceIndex: index,
    });
  });

  const uniquePairs = new Set(relations.map((relation) => [relation.from, relation.to].sort().join('|')));
  const communities = new Set(nodes.map((node) => node.community).filter((value): value is number => value !== null));
  const extractedRelations = relations.filter((relation) => relation.evidenceType === 'EXTRACTED').length;
  const inferredRelations = relations.filter((relation) => relation.evidenceType === 'INFERRED').length;
  const ambiguousRelations = relations.filter((relation) => relation.evidenceType === 'AMBIGUOUS').length;

  const snapshotStats: AtlasSnapshotStats = {
    files: manifest?.fileCount ?? new Set(nodes.map((node) => node.sourceFile).filter(Boolean)).size,
    nodes: nodes.length,
    relations: relations.length,
    uniqueRelationPairs: uniquePairs.size,
    extractedRelations,
    inferredRelations,
    ambiguousRelations,
    communities: communities.size,
    selfReferences,
    duplicateRelationsCollapsed,
    danglingRelationsDropped,
    nodesWithoutSource: nodes.filter((node) => !node.sourceFile).length,
    redactedLabels,
  };

  const manifestStatus: AtlasManifestStatus | null = manifest
    ? {
        fileCount: manifest.fileCount ?? 0,
        byteCount: manifest.byteCount ?? 0,
        verifiedFiles: options.manifestVerification?.verifiedFiles ?? 0,
        hashAlgorithm: 'sha256',
        verifiedAt: options.manifestVerification?.verifiedAt ?? null,
        status:
          options.manifestVerification &&
          manifest.fileCount !== null &&
          options.manifestVerification.verifiedFiles === manifest.fileCount
            ? 'verified'
            : 'unverified',
      }
    : null;

  const generatedAt = options.generatedAt ?? null;
  const snapshotId = `${repositoryId}-${commit === 'unknown' ? 'unknown' : commit.slice(0, 7)}-${(generatedAt ?? 'undated').slice(0, 10)}`;
  const snapshot: AtlasSnapshot = {
    id: snapshotId,
    repository: { id: repositoryId, name: repositoryName },
    commit,
    commitShort: shortCommit(commit),
    generatedAt,
    importedAt,
    graphifyVersion,
    graphifySchemaVersion,
    atlasSchemaVersion: ATLAS_SCHEMA_VERSION,
    history: true,
    importStatus:
      options.importStatusOverride ??
      (manifestStatus?.status === 'verified' && commit !== 'unknown' ? 'complete' : 'partial'),
    stats: snapshotStats,
    manifest: manifestStatus,
    notes: [
      `历史快照，仅代表提交 ${commit === 'unknown' ? '（未提供）' : commit}；不代表 ${profile.repository.workspaceLabel} 当前工作区。`,
      '关系默认“待核实”；只有列入人工核对清单的关系标记为“已核实”。',
      'Graphify Community 编号只作原图参考，不参与模块判定。',
      manifestStatus?.status === 'verified'
        ? `snapshot-manifest.json 已逐文件校验：${manifestStatus.verifiedFiles}/${manifestStatus.fileCount}。`
        : '未完成 snapshot-manifest.json 逐文件校验；提交与文件完整性仍需复核。',
      ...(profile.synthetic
        ? ['合成数据：仅用于导入管线验证，不代表真实仓库架构或当前工作区。']
        : []),
      ...profile.snapshotNotes,
    ],
  };

  const modules = buildModules(nodes, relations, repositoryId, commit, profile).sort((a, b) => {
    const aIndex = profile.moduleOrder.indexOf(a.id);
    const bIndex = profile.moduleOrder.indexOf(b.id);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });
  const systemNames: Record<'nexus' | 'crm' | 'electron', string> = {
    nexus: 'NEXUS 可视化大屏',
    crm: 'CRM / ERP 管理系统',
    electron: 'Electron 桌面客户端',
  };
  const systems: AtlasSystemRecord[] = (['nexus', 'crm', 'electron'] as const).map((systemId) => {
    if (systemId !== profile.repository.system) {
      return {
        id: systemId,
        name: systemNames[systemId],
        dataStatus: 'not_connected',
        source: 'graphify',
        snapshotId: null,
        note:
          profile.repository.system === 'nexus'
            ? '尚未接入真实架构数据；P1.0 未扫描该仓库。'
            : `尚未接入真实架构数据；本轮只导入 ${profile.repository.name} 的本地历史快照，未扫描该仓库。`,
      };
    }
    let note: string;
    if (profile.repository.system === 'nexus') {
      note =
        commit === 'unknown'
          ? '已导入 Graphify 历史快照；提交信息缺失，不能称为当前实时架构。'
          : `已接入 NEXUS 历史快照 ${shortCommit(commit)}（${generatedAt ?? '生成时间未知'}）；不代表当前工作区。`;
    } else if (profile.synthetic) {
      note = `已接入 ${profile.repository.name} 合成历史快照 ${shortCommit(commit)}（${generatedAt ?? '生成时间未知'}）；仅用于管线验证，不代表真实 ${profile.repository.workspaceLabel} 架构。`;
    } else {
      note = `已接入 ${profile.repository.name} 历史快照 ${shortCommit(commit)}（${generatedAt ?? '生成时间未知'}）；不代表当前工作区。`;
    }
    return {
      id: systemId,
      name: systemNames[systemId],
      dataStatus: 'connected',
      source: 'graphify',
      snapshotId,
      note,
    };
  });

  const productNodes = nodes.filter((node) => node.scope === 'product');
  const modulesAssigned = productNodes.filter((node) => node.moduleId !== null).length;
  const modulesUnassigned = productNodes.length - modulesAssigned;

  if (count('invalidNodes')) {
    issues.push({
      code: 'GRAPHIFY_NODE_INVALID',
      severity: 'warning',
      message: `${count('invalidNodes')} 个节点缺少 id/label 或结构异常，已跳过。`,
      count: count('invalidNodes'),
    });
  }
  if (count('duplicateNodeIds')) {
    issues.push({
      code: 'GRAPHIFY_NODE_DUPLICATE_ID',
      severity: 'warning',
      message: `${count('duplicateNodeIds')} 个重复节点 ID 已跳过，保留首次出现。`,
      count: count('duplicateNodeIds'),
    });
  }
  if (count('rejectedPaths')) {
    issues.push({
      code: 'GRAPHIFY_NODE_PATH_REJECTED',
      severity: 'warning',
      message: `${count('rejectedPaths')} 个节点包含绝对路径或越界路径，已跳过且未回显路径。`,
      count: count('rejectedPaths'),
    });
  }
  if (count('nonFileSources')) {
    issues.push({
      code: 'GRAPHIFY_NODE_NON_FILE_SOURCE',
      severity: 'info',
      message: `${count('nonFileSources')} 个节点引用包名或非文件路径，按外部节点处理。`,
      count: count('nonFileSources'),
    });
  }
  if (redactedLabels) {
    issues.push({
      code: 'GRAPHIFY_NODE_REDACTED',
      severity: 'warning',
      message: `${redactedLabels} 个外部节点标签由本机绝对路径生成，已脱敏。`,
      count: redactedLabels,
    });
  }
  if (count('invalidLinks')) {
    issues.push({
      code: 'GRAPHIFY_LINK_INVALID',
      severity: 'warning',
      message: `${count('invalidLinks')} 条关系结构异常，已跳过。`,
      count: count('invalidLinks'),
    });
  }
  if (danglingRelationsDropped) {
    issues.push({
      code: 'GRAPHIFY_LINK_DANGLING',
      severity: 'warning',
      message: `${danglingRelationsDropped} 条关系指向不存在的节点，已跳过。`,
      count: danglingRelationsDropped,
    });
  }
  if (duplicateRelationsCollapsed) {
    issues.push({
      code: 'GRAPHIFY_RELATION_DUPLICATE',
      severity: 'info',
      message: `${duplicateRelationsCollapsed} 条完全重复的关系已合并；不同类型的关系全部保留。`,
      count: duplicateRelationsCollapsed,
    });
  }
  if (unknownRelationTypes) {
    issues.push({
      code: 'GRAPHIFY_RELATION_UNKNOWN_TYPE',
      severity: 'info',
      message: `${unknownRelationTypes} 条关系使用了未识别类型，已保留为 unknown。`,
      count: unknownRelationTypes,
    });
  }
  if (selfReferences) {
    issues.push({
      code: 'GRAPHIFY_SELF_REFERENCE',
      severity: 'info',
      message: `${selfReferences} 条自调用关系已保留，属于代码递归/自引用，不是无效边。`,
      count: selfReferences,
    });
  }
  if (snapshot.importStatus === 'partial') {
    issues.push({
      code: 'GRAPHIFY_MANIFEST_UNVERIFIED',
      severity: 'warning',
      message: '快照清单未完成逐文件校验或缺少提交信息，导入状态标记为 partial。',
      count: 1,
    });
  }
  const annotatedNodes = nodes.filter((node) => node.displayName !== null).length;
  issues.push({
    code: 'GRAPHIFY_DISPLAY_NAMES_PARTIAL',
    severity: 'info',
    message: `${annotatedNodes} 个节点有中文名称与职责注释；其余保留英文符号名，未做机器翻译。`,
    count: annotatedNodes,
  });
  if (!profile.modules.length) {
    issues.push({
      code: 'GRAPHIFY_MODULE_PROFILE_EMPTY',
      severity: 'warning',
      message: '仓库 profile 没有模块定义；全部节点保持未分类，未为了星图完整而强行归类。',
      count: 1,
    });
  }
  if (profile.synthetic) {
    issues.push({
      code: 'IMPORT_SYNTHETIC_FIXTURE',
      severity: 'info',
      message: '本数据集来自合成验证 profile；不能作为真实仓库架构或生产证据。',
      count: 1,
    });
  }
  issues.push(
    profile.repository.system === 'nexus'
      ? {
          code: 'GRAPHIFY_MODULE_COVERAGE',
          severity: 'info',
          message: `${modulesAssigned} 个产品节点归入模块，${modulesUnassigned} 个产品节点未归类（应用外壳或数据文件）。`,
          count: modulesAssigned,
        }
      : {
          code: 'GRAPHIFY_MODULE_UNCLASSIFIED',
          severity: 'info',
          message: `${modulesAssigned} 个产品节点按 ${profile.repository.name} 的路径/职责规则归类，${modulesUnassigned} 个节点保持未分类（没有足够依据，不强行归类）。`,
          count: modulesAssigned,
        },
  );

  const diagnostics: AtlasDiagnostics = {
    issues,
    counts: {
      rawNodes: rawNodes.length,
      rawRelations: rawLinks.length,
      nodes: nodes.length,
      relations: relations.length,
      productNodes: productNodes.length,
      testNodes: nodes.filter((node) => node.scope === 'test').length,
      toolingNodes: nodes.filter((node) => node.scope === 'tooling').length,
      externalNodes: nodes.filter((node) => node.scope === 'external').length,
      conceptNodes: nodes.filter((node) => node.kind === 'concept').length,
      rationaleNodes: nodes.filter((node) => node.kind === 'rationale').length,
      modulesAssigned,
      modulesUnassigned,
      unresolvedCalls,
      nodesWithUnresolvedCalls,
    },
    unresolvedCallsByReceiver: [...unresolvedByReceiver.entries()]
      .map(([receiver, value]) => ({ receiver, count: value }))
      .sort((a, b) => b.count - a.count || a.receiver.localeCompare(b.receiver)),
    reviewCounts: {
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
      unverified: relations.filter(
        (relation) =>
          relation.review.status === 'unverified' &&
          relation.review.method !== 'graphify-extracted' &&
          relation.review.method !== 'graphify-inferred',
      ).length,
    },
    coverageNotes: profile.coverageNotes,
  };

  const repositories: AtlasRepositoryRecord[] = [
    {
      id: repositoryId,
      name: repositoryName,
      system: profile.repository.system,
      snapshots: [
        {
          snapshotId,
          snapshotKey: `${repositoryId}@${snapshot.commitShort}@${generatedAt ?? 'unknown'}`,
          commit,
          commitShort: snapshot.commitShort,
          scannedAt: options.scannedAt ?? manifest?.scannedAt ?? null,
          generatedAt,
          importedAt,
          graphifyVersion,
          nodeCount: nodes.length,
          relationCount: relations.length,
          history: true,
        },
      ],
    },
  ];

  return {
    schemaId: 'atlas.architecture',
    schemaVersion: ATLAS_SCHEMA_VERSION,
    generatedAt: importedAt,
    source: {
      kind: 'graphify',
      label: `${profile.sourceLabel} · ${shortCommit(commit)}`,
      detail:
        commit === 'unknown'
          ? '本地导入的 Graphify 图谱；提交信息缺失，不代表当前架构。'
          : `本地导入 · 提交 ${shortCommit(commit)} · 生成 ${generatedAt ?? '未知'} · Graphify ${graphifyVersion}`,
      simulated: false,
      snapshotId,
      origin: 'file-import',
    },
    snapshot,
    systems,
    modules,
    nodes: sortBy(nodes, (node) => node.id),
    relations: sortBy(relations, (relation) => relation.id),
    flows: [],
    repositories,
    diagnostics,
  };
}

function buildModules(
  nodes: AtlasNode[],
  relations: AtlasRelation[],
  repositoryId: string,
  commit: string,
  profile: RepositoryProfile,
): AtlasModuleRecord[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const product = nodes.filter((node) => node.scope === 'product');

  return profile.modules.map((definition) => {
    const members = product.filter((node) => node.moduleIds.includes(definition.id));
    const primaryMembers = members.filter((node) => node.moduleId === definition.id);
    const otherModuleIds = new Set<AtlasModuleId>(
      profile.modules.filter((module) => module.id !== definition.id).map((module) => module.id),
    );

    let productRelations = 0;
    let crossModuleRelations = 0;
    let extracted = 0;
    let inferred = 0;
    let ambiguous = 0;
    let verified = 0;

    for (const relation of relations) {
      const from = nodeById.get(relation.from);
      const to = nodeById.get(relation.to);
      if (!from || !to) continue;
      const fromMember = from.scope === 'product' && from.moduleIds.includes(definition.id);
      const toMember = to.scope === 'product' && to.moduleIds.includes(definition.id);
      if (fromMember && toMember) {
        productRelations += 1;
        if (relation.evidenceType === 'EXTRACTED') extracted += 1;
        else if (relation.evidenceType === 'INFERRED') inferred += 1;
        else if (relation.evidenceType === 'AMBIGUOUS') ambiguous += 1;
        if (relation.review.status === 'verified') verified += 1;
        continue;
      }
      if (fromMember || toMember) {
        const other = fromMember ? to : from;
        if (other.moduleId && otherModuleIds.has(other.moduleId)) crossModuleRelations += 1;
      }
    }

    const stats: AtlasModuleStats = {
      ...baseModuleStats(),
      productNodes: primaryMembers.length,
      supportingNodes: members.length - primaryMembers.length,
      productRelations,
      crossModuleRelations,
      extractedRelations: extracted,
      inferredRelations: inferred,
      ambiguousRelations: ambiguous,
      verifiedRelations: verified,
      unverifiedRelations: Math.max(0, productRelations - verified),
      files: new Set(members.map((node) => node.sourceFile).filter(Boolean)).size,
      communities: new Set(
        primaryMembers.map((node) => node.community).filter((value): value is number => value !== null),
      ).size,
    };

    const keyComponents: AtlasModuleComponent[] = definition.evidence.slice(0, 5).map((seed) => {
      const annotation =
        profile.repository.system === 'nexus' ? annotationFor(seed.file, seed.symbol) : null;
      const evidenceRef: AtlasEvidenceRef = {
        repository: repositoryId,
        commit,
        file: seed.file,
        line: seed.line,
        symbol: seed.symbol,
        locator: makeLocator(seed.file, seed.line),
      };
      return {
        symbol: seed.symbol,
        file: seed.file,
        line: seed.line,
        name: annotation?.name ?? seed.symbol,
        responsibility: annotation?.responsibility ?? seed.note,
        review: moduleRecordReview(
          definition,
          annotation?.note ?? seed.note,
          [evidenceRef],
          profile,
        ),
      };
    });

    const compositionEvidence: AtlasEvidenceRef[] = definition.evidence.map((seed) => ({
      repository: repositoryId,
      commit,
      file: seed.file,
      line: seed.line,
      symbol: seed.symbol,
      locator: makeLocator(seed.file, seed.line),
    }));

    return {
      id: definition.id,
      index: definition.index,
      name: definition.name,
      latin: definition.latin,
      repository: repositoryId,
      system: profile.repository.system,
      review: definition.review,
      reviewRecord: moduleRecordReview(
        definition,
        profile.repository.system === 'nexus'
          ? moduleReviewNote(definition)
          : (definition.reviewNote ?? '模块组成来自本地 profile；未提供独立复核记录。'),
        compositionEvidence,
        profile,
      ),
      summary: definition.summary,
      responsibilities: definition.responsibilities,
      keyComponents,
      gaps: definition.gaps,
      rule: definition.rule,
      description: definition.description,
      notes: [
        ...definition.notes,
        profile.repository.system === 'nexus'
          ? moduleReviewNote(definition)
          : (definition.reviewNote ?? '模块组成来自本地 profile；未提供独立复核记录。'),
      ],
      evidence: [
        ...new Set([
          ...definition.evidence.map((seed) => seed.file),
          ...definition.primaryPrefixes,
          ...definition.primaryFiles,
          ...definition.supportingFiles,
        ]),
      ].map((path) => {
        const seed = definition.evidence.find((entry) => entry.file === path);
        const isSupporting = definition.supportingFiles.includes(path);
        return {
          pathPrefix: path,
          role: isSupporting ? ('supporting' as const) : ('primary' as const),
          review: definition.review,
          note: seed ? seed.note : isSupporting ? '人工指定支撑文件' : '路径前缀归类',
          sourceRefs: seed
            ? [
                {
                  repository: repositoryId,
                  commit,
                  file: seed.file,
                  line: seed.line,
                  symbol: seed.symbol,
                  locator: makeLocator(seed.file, seed.line),
                },
              ]
            : [],
        };
      }),
      stats,
    };
  });
}

export function isKnownModuleId(value: unknown): value is AtlasModuleId {
  return isAtlasModuleId(value);
}

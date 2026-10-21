import { RELATION_TYPE_LABELS, relationTypeGroup, type RelationTypeGroup, type ReviewGroup } from './query.ts';
import type {
  AtlasDataset,
  AtlasModuleId,
  AtlasNode,
  AtlasRelation,
  AtlasRelationType,
  AtlasReviewMethod,
  AtlasReviewStatus,
} from './schema.ts';
import { MODULE_ORDER } from './schema.ts';

/**
 * Graph Projection：ATLAS 标准数据集与 Canvas 之间的唯一投影层。
 *
 * 数据流：标准数据集 → 关系筛选与聚合 → 星图布局数据 → Canvas。
 *
 * 设计约束：
 * - 只读取 AtlasDataset，不接触 Graphify 原始 graph.json。
 * - 不在每帧聚合。模块投影按数据集对象缓存一次；文件/符号投影按
 *   导航焦点缓存，切换层级时才重建。
 * - 不添加没有关系证据的边。Canvas 主归属节点为 0 时，不伪造模块连线。
 * - 所有边保留 relation 级证据，路径查询与筛选都能回到源码定位。
 */

export type ProjectionLevel = 'module' | 'file' | 'symbol';

export type EvidenceClass =
  | 'human-reviewed'
  | 'ai-reviewed'
  | 'extracted'
  | 'inferred'
  | 'unverified';

export const EVIDENCE_ORDER: EvidenceClass[] = [
  'human-reviewed',
  'ai-reviewed',
  'extracted',
  'inferred',
  'unverified',
];

export const EVIDENCE_LABELS: Record<EvidenceClass, string> = {
  'human-reviewed': '独立人工审核',
  'ai-reviewed': 'AI 源码复核',
  extracted: 'Graphify 直接提取',
  inferred: 'Graphify 推断',
  unverified: '尚无审核',
};

export const EVIDENCE_SHORT_LABELS: Record<EvidenceClass, string> = {
  'human-reviewed': '人工',
  'ai-reviewed': 'AI 复核',
  extracted: '直接提取',
  inferred: '推断',
  unverified: '未审核',
};

/** 与证据类型对应的画布颜色；真实连线与装饰连线必须能一眼区分。 */
export const EVIDENCE_COLORS: Record<EvidenceClass, string> = {
  'human-reviewed': '#8DE3B0',
  'ai-reviewed': '#B9A7FF',
  extracted: '#7FC8D6',
  inferred: '#E8B56E',
  unverified: '#D98C8C',
};

export const PROJECTION_LIMITS = {
  moduleNodes: 4,
  fileFocusNodes: 6,
  fileCounterpartNodes: 3,
  fileNodes: 9,
  symbolFocusNodes: 10,
  symbolCounterpartNodes: 4,
  symbolNodes: 14,
  edges: 48,
  samples: 5,
} as const;

export interface ProjectionFilter {
  typeGroup: RelationTypeGroup;
  reviewGroup: ReviewGroup;
  evidenceClass: EvidenceClass | 'all';
}

export const DEFAULT_PROJECTION_FILTER: ProjectionFilter = {
  typeGroup: 'all',
  reviewGroup: 'all',
  evidenceClass: 'all',
};

export interface ProjectionRelationFact {
  id: string;
  type: AtlasRelationType;
  typeGroup: Exclude<RelationTypeGroup, 'all'>;
  method: AtlasReviewMethod;
  status: AtlasReviewStatus;
  evidenceClass: EvidenceClass;
  reviewGroup: Exclude<ReviewGroup, 'all'>;
  locator: string | null;
  context: string | null;
  fromNodeId: string;
  toNodeId: string;
  fromLabel: string;
  toLabel: string;
  fromSymbol: string;
  toSymbol: string;
}

export interface ProjectionNode {
  id: string;
  level: ProjectionLevel;
  label: string;
  sublabel: string;
  /** 数据中的一句中文说明；没有时界面回退到构图说明。 */
  description: string;
  moduleId: AtlasModuleId | null;
  /** 模块 ID、文件路径或 ATLAS 节点 ID。 */
  entityId: string;
  review: AtlasReviewStatus;
  reviewMethod: AtlasReviewMethod;
  distributed: boolean;
  /** 当前层级焦点内的节点（本模块文件 / 本文件符号）。 */
  inFocus: boolean;
  nodeCount: number;
  supportingCount: number;
  relationCount: number;
}

export interface ProjectionEdge {
  id: string;
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  count: number;
  evidenceClass: EvidenceClass;
  evidenceCounts: Record<EvidenceClass, number>;
  reviewCounts: { ai: number; human: number; unverified: number };
  reviewStatus: AtlasReviewStatus;
  unverifiedCount: number;
  types: AtlasRelationType[];
  mixed: boolean;
  samples: ProjectionRelationFact[];
  /** 供筛选使用的完整关系引用；不直接绘制。 */
  facts: ProjectionRelationFact[];
}

export interface ProjectionOmitted {
  nodes: number;
  edges: number;
  note: string | null;
}

export interface GraphProjection {
  level: ProjectionLevel;
  focus: {
    moduleId: AtlasModuleId | null;
    file: string | null;
  };
  scopeLabel: string;
  sourceKind: 'demo' | 'graphify';
  sourceLabel: string;
  snapshotShort: string | null;
  simulated: boolean;
  nodes: ProjectionNode[];
  edges: ProjectionEdge[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    relationCount: number;
    extracted: number;
    inferred: number;
    aiReviewed: number;
    humanReviewed: number;
    unverified: number;
  };
  omitted: ProjectionOmitted;
  notes: string[];
  filter: ProjectionFilter;
}

export interface ProjectionPath {
  nodeIds: string[];
  edgeIds: string[];
  nodes: ProjectionNode[];
  edges: ProjectionEdge[];
  /** 路径按无向关联搜索；不承诺运行时方向。 */
  direction: 'undirected' | 'out';
  note: string;
}

export interface DatasetPathStep {
  node: AtlasNode;
  relation: AtlasRelation | null;
  direction: 'out' | 'in' | 'start';
  traversedForward: boolean | null;
}

export interface DatasetPath {
  nodes: AtlasNode[];
  steps: DatasetPathStep[];
  direction: 'undirected';
  note: string;
}

const EVIDENCE_RANK = new Map(EVIDENCE_ORDER.map((value, index) => [value, index]));

function emptyEvidenceCounts(): Record<EvidenceClass, number> {
  return {
    'human-reviewed': 0,
    'ai-reviewed': 0,
    extracted: 0,
    inferred: 0,
    unverified: 0,
  };
}

export function evidenceClassForRelation(relation: AtlasRelation): EvidenceClass {
  if (relation.review.method === 'human-review' && relation.review.status !== 'unverified') {
    return 'human-reviewed';
  }
  if (relation.review.method === 'ai-source-review' && relation.review.status !== 'unverified') {
    return 'ai-reviewed';
  }
  if (relation.review.method === 'graphify-inferred') return 'inferred';
  if (relation.review.method === 'graphify-extracted') return 'extracted';
  return 'unverified';
}

export function reviewGroupForRelation(relation: AtlasRelation): Exclude<ReviewGroup, 'all'> {
  if (relation.review.method === 'human-review' && relation.review.status !== 'unverified') return 'human';
  if (relation.review.method === 'ai-source-review' && relation.review.status !== 'unverified') return 'ai';
  return 'unverified';
}

function nodeLabel(node: AtlasNode): string {
  return node.displayName ?? node.symbol;
}

function fileLabel(file: string): string {
  return file.split('/').pop() ?? file;
}

function factFromRelation(
  relation: AtlasRelation,
  fromNode: AtlasNode,
  toNode: AtlasNode,
): ProjectionRelationFact {
  return {
    id: relation.id,
    type: relation.type,
    typeGroup: relationTypeGroup(relation.type),
    method: relation.review.method,
    status: relation.review.status,
    evidenceClass: evidenceClassForRelation(relation),
    reviewGroup: reviewGroupForRelation(relation),
    locator: relation.evidence?.locator ?? null,
    context: relation.context,
    fromNodeId: relation.from,
    toNodeId: relation.to,
    fromLabel: nodeLabel(fromNode),
    toLabel: nodeLabel(toNode),
    fromSymbol: fromNode.symbol,
    toSymbol: toNode.symbol,
  };
}

function pickEvidenceClass(counts: Record<EvidenceClass, number>): EvidenceClass {
  if (counts['human-reviewed'] > 0) return 'human-reviewed';
  if (counts['ai-reviewed'] > 0) return 'ai-reviewed';
  if (counts.inferred > 0 && counts.extracted === 0) return 'inferred';
  if (counts.extracted > 0) return 'extracted';
  return 'unverified';
}

function summarizeReview(
  facts: ProjectionRelationFact[],
): Pick<ProjectionEdge, 'reviewCounts' | 'reviewStatus' | 'unverifiedCount'> {
  const reviewCounts = { ai: 0, human: 0, unverified: 0 };
  for (const fact of facts) {
    if (fact.reviewGroup === 'ai') reviewCounts.ai += 1;
    else if (fact.reviewGroup === 'human') reviewCounts.human += 1;
    else reviewCounts.unverified += 1;
  }
  const unverifiedCount = reviewCounts.unverified;
  let reviewStatus: AtlasReviewStatus = 'verified';
  if (unverifiedCount > 0) {
    reviewStatus = reviewCounts.ai + reviewCounts.human > 0 ? 'partially_verified' : 'unverified';
  } else if (reviewCounts.ai > 0 && reviewCounts.human === 0) {
    reviewStatus = 'partially_verified';
  }
  return { reviewCounts, reviewStatus, unverifiedCount };
}

function sortFacts(facts: ProjectionRelationFact[]): ProjectionRelationFact[] {
  return [...facts].sort((a, b) => {
    const rankA = EVIDENCE_RANK.get(a.evidenceClass) ?? 99;
    const rankB = EVIDENCE_RANK.get(b.evidenceClass) ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return a.id.localeCompare(b.id, 'en');
  });
}

function makeEdge(
  id: string,
  from: string,
  to: string,
  fromLabel: string,
  toLabel: string,
  rawFacts: ProjectionRelationFact[],
): ProjectionEdge | null {
  const facts = sortFacts(rawFacts);
  if (!facts.length) return null;
  const evidenceCounts = emptyEvidenceCounts();
  const typeSet = new Set<AtlasRelationType>();
  for (const fact of facts) {
    evidenceCounts[fact.evidenceClass] += 1;
    typeSet.add(fact.type);
  }
  const evidenceClass = pickEvidenceClass(evidenceCounts);
  const review = summarizeReview(facts);
  return {
    id,
    from,
    to,
    fromLabel,
    toLabel,
    count: facts.length,
    evidenceClass,
    evidenceCounts,
    ...review,
    types: [...typeSet].sort(
      (a, b) => facts.filter((fact) => fact.type === b).length - facts.filter((fact) => fact.type === a).length,
    ),
    mixed: EVIDENCE_ORDER.filter((value) => evidenceCounts[value] > 0).length > 1,
    samples: facts.slice(0, PROJECTION_LIMITS.samples),
    facts,
  };
}

function statsForEdges(edges: ProjectionEdge[]): GraphProjection['stats'] {
  const stats: GraphProjection['stats'] = {
    nodeCount: 0,
    edgeCount: edges.length,
    relationCount: 0,
    extracted: 0,
    inferred: 0,
    aiReviewed: 0,
    humanReviewed: 0,
    unverified: 0,
  };
  for (const edge of edges) {
    stats.relationCount += edge.count;
    stats.extracted += edge.evidenceCounts.extracted;
    stats.inferred += edge.evidenceCounts.inferred;
    stats.aiReviewed += edge.evidenceCounts['ai-reviewed'];
    stats.humanReviewed += edge.evidenceCounts['human-reviewed'];
    stats.unverified += edge.unverifiedCount;
  }
  return stats;
}

function baseProjection(
  dataset: AtlasDataset,
  level: ProjectionLevel,
  focus: GraphProjection['focus'],
  scopeLabel: string,
  nodes: ProjectionNode[],
  edges: ProjectionEdge[],
  notes: string[],
  omitted: ProjectionOmitted,
): GraphProjection {
  const stats = statsForEdges(edges);
  stats.nodeCount = nodes.length;
  return {
    level,
    focus,
    scopeLabel,
    sourceKind: dataset.source.kind,
    sourceLabel: dataset.source.label,
    snapshotShort: dataset.snapshot?.commitShort ?? null,
    simulated: dataset.source.kind === 'demo',
    nodes,
    edges,
    stats,
    omitted,
    notes,
    filter: DEFAULT_PROJECTION_FILTER,
  };
}

function moduleOrderRank(moduleId: AtlasModuleId | null): number {
  if (!moduleId) return 99;
  const index = MODULE_ORDER.indexOf(moduleId);
  return index < 0 ? 99 : index;
}

/** 数据集的主仓库；模块星图只绘制该仓库的模块，避免多仓库节点混入。 */
export function primaryRepository(dataset: AtlasDataset): string | null {
  return (
    dataset.snapshot?.repository.id ??
    dataset.repositories?.[0]?.id ??
    dataset.modules[0]?.repository ??
    null
  );
}

export function moduleRepository(dataset: AtlasDataset, moduleId: AtlasModuleId): string | null {
  return dataset.modules.find((module) => module.id === moduleId)?.repository ?? null;
}

function makeModuleNodes(dataset: AtlasDataset): ProjectionNode[] {
  const repositoryId = primaryRepository(dataset);
  return dataset.modules
    .filter((module) => !repositoryId || module.repository === repositoryId)
    .slice()
    .sort((a, b) => moduleOrderRank(a.id) - moduleOrderRank(b.id))
    .map((module) => ({
      id: `module:${module.id}`,
      level: 'module',
      label: module.name,
      sublabel: module.latin,
      description: module.summary,
      moduleId: module.id,
      entityId: module.id,
      review: module.review,
      reviewMethod: module.reviewRecord.method,
      distributed: module.id === 'canvas',
      inFocus: true,
      nodeCount: module.stats.productNodes,
      supportingCount: module.stats.supportingNodes,
      relationCount: module.stats.productRelations,
    }));
}

function buildModuleEdges(dataset: AtlasDataset): ProjectionEdge[] {
  if (dataset.source.kind !== 'graphify') return [];
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const moduleNames = new Map(dataset.modules.map((module) => [module.id, module.name]));
  const moduleById = new Map(dataset.modules.map((module) => [module.id, module]));
  const repositoryId = primaryRepository(dataset);
  const groups = new Map<string, { from: AtlasModuleId; to: AtlasModuleId; facts: ProjectionRelationFact[] }>();

  for (const relation of dataset.relations) {
    if (relation.evidenceType === 'SIMULATED') continue;
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from || !to) continue;
    if (from.repository !== to.repository) continue;
    if (repositoryId && from.repository !== repositoryId) continue;
    if (from.scope !== 'product' || to.scope !== 'product') continue;
    if (!from.moduleId || !to.moduleId || from.moduleId === to.moduleId) continue;
    const fromModule = moduleById.get(from.moduleId);
    const toModule = moduleById.get(to.moduleId);
    if (!fromModule || !toModule) continue;
    if (fromModule.repository !== from.repository || toModule.repository !== to.repository) continue;
    const key = `${from.moduleId}>${to.moduleId}`;
    let group = groups.get(key);
    if (!group) {
      group = { from: from.moduleId, to: to.moduleId, facts: [] };
      groups.set(key, group);
    }
    group.facts.push(factFromRelation(relation, from, to));
  }

  return [...groups.values()]
    .map((group) => {
      const fromId = `module:${group.from}`;
      const toId = `module:${group.to}`;
      return makeEdge(
        `module-edge:${group.from}>${group.to}`,
        fromId,
        toId,
        moduleNames.get(group.from) ?? group.from,
        moduleNames.get(group.to) ?? group.to,
        group.facts,
      );
    })
    .filter((edge): edge is ProjectionEdge => edge !== null)
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id, 'en'));
}

const moduleCache = new WeakMap<AtlasDataset, GraphProjection>();

/**
 * 模块级投影只构建一次。Canvas 在初始化或数据源切换时读取它，
 * 渲染循环只消费缓存，不重新遍历 1,390 个节点。
 */
export function moduleProjection(dataset: AtlasDataset): GraphProjection {
  const cached = moduleCache.get(dataset);
  if (cached) return cached;
  const nodes = makeModuleNodes(dataset);
  const edges = buildModuleEdges(dataset);
  const relationCount = edges.reduce((sum, edge) => sum + edge.count, 0);
  const notes = [
    '只统计主模块之间的产品节点关系；Canvas 支撑文件不会重复计为一个模块。',
    '没有连线的模块对表示当前快照没有已记录关系，不代表不存在依赖。',
    '所有真实连线都是静态关系证据，不代表运行时调用顺序。',
  ];
  if (dataset.source.kind === 'demo') {
    notes.unshift('演示模式保留原有星系构图，不生成任何真实跨模块连线。');
  }
  if (nodes.find((node) => node.moduleId === 'canvas')?.nodeCount === 0) {
    notes.push('Canvas 渲染没有主归属节点，因此不绘制“Canvas 模块”的跨模块连线；它只作为分布式能力集合展示。');
  }
  const projection = baseProjection(
    dataset,
    'module',
    { moduleId: null, file: null },
    'NEXUS · 模块层级',
    nodes,
    edges,
    notes,
    {
      nodes: Math.max(0, dataset.modules.length - nodes.length),
      edges: 0,
      note: relationCount
        ? `共 ${relationCount} 条跨模块关系，全部保留；模块对按方向聚合。`
        : dataset.source.kind === 'demo'
          ? '演示数据不提供真实关系。'
          : '当前快照没有可绘制的跨模块关系。',
    },
  );
  moduleCache.set(dataset, projection);
  return projection;
}

interface FileMetric {
  file: string;
  nodeCount: number;
  primaryCount: number;
  supportingCount: number;
  moduleId: AtlasModuleId | null;
  crossDegree: number;
}

function buildFileMetrics(dataset: AtlasDataset, moduleId: AtlasModuleId): Map<string, FileMetric> {
  const repositoryId = moduleRepository(dataset, moduleId);
  const nodes = dataset.nodes.filter(
    (node) =>
      node.scope === 'product' &&
      node.sourceFile &&
      node.moduleIds.includes(moduleId) &&
      (!repositoryId || node.repository === repositoryId),
  );
  const metrics = new Map<string, FileMetric>();
  for (const node of nodes) {
    const file = node.sourceFile as string;
    let metric = metrics.get(file);
    if (!metric) {
      metric = {
        file,
        nodeCount: 0,
        primaryCount: 0,
        supportingCount: 0,
        moduleId: null,
        crossDegree: 0,
      };
      metrics.set(file, metric);
    }
    metric.nodeCount += 1;
    if (node.moduleId === moduleId) metric.primaryCount += 1;
    else metric.supportingCount += 1;
  }
  // The dominant primary module for a support file (Canvas has no primary owner).
  const primaryVotes = new Map<string, Map<AtlasModuleId, number>>();
  for (const node of nodes) {
    if (!node.moduleId || !node.sourceFile) continue;
    const votes = primaryVotes.get(node.sourceFile) ?? new Map<AtlasModuleId, number>();
    votes.set(node.moduleId, (votes.get(node.moduleId) ?? 0) + 1);
    primaryVotes.set(node.sourceFile, votes);
  }
  for (const [file, votes] of primaryVotes) {
    const metric = metrics.get(file);
    if (!metric) continue;
    metric.moduleId = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  return metrics;
}

const focusCache = new WeakMap<AtlasDataset, Map<string, GraphProjection>>();

function cachedFocus(
  dataset: AtlasDataset,
  key: string,
  build: () => GraphProjection,
): GraphProjection {
  let map = focusCache.get(dataset);
  if (!map) {
    map = new Map();
    focusCache.set(dataset, map);
  }
  const cached = map.get(key);
  if (cached) return cached;
  const projection = build();
  map.set(key, projection);
  return projection;
}

export function fileProjection(dataset: AtlasDataset, moduleId: AtlasModuleId): GraphProjection {
  return cachedFocus(dataset, `file:${moduleId}`, () => buildFileProjection(dataset, moduleId));
}

function buildFileProjection(dataset: AtlasDataset, moduleId: AtlasModuleId): GraphProjection {
  const moduleName = dataset.modules.find((module) => module.id === moduleId)?.name ?? moduleId;
  const repositoryId = moduleRepository(dataset, moduleId);
  const metrics = buildFileMetrics(dataset, moduleId);
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const supportOnly = [...metrics.values()].every((metric) => metric.primaryCount === 0);

  // Relations with at least one endpoint in the focus module's membership.
  const relevant: AtlasRelation[] = [];
  for (const relation of dataset.relations) {
    if (relation.evidenceType === 'SIMULATED') continue;
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from || !to || from.scope !== 'product' || to.scope !== 'product') continue;
    if (from.repository !== to.repository) continue;
    if (repositoryId && from.repository !== repositoryId) continue;
    if (!from.sourceFile || !to.sourceFile || from.sourceFile === to.sourceFile) continue;
    if (from.moduleIds.includes(moduleId) || to.moduleIds.includes(moduleId)) relevant.push(relation);
  }

  const crossDegree = new Map<string, number>();
  for (const relation of relevant) {
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from?.sourceFile || !to?.sourceFile) continue;
    if (metrics.has(from.sourceFile)) {
      crossDegree.set(from.sourceFile, (crossDegree.get(from.sourceFile) ?? 0) + 1);
    }
    if (metrics.has(to.sourceFile)) {
      crossDegree.set(to.sourceFile, (crossDegree.get(to.sourceFile) ?? 0) + 1);
    }
  }
  for (const [file, degree] of crossDegree) {
    const metric = metrics.get(file);
    if (metric) metric.crossDegree = degree;
  }

  const focusCandidates = [...metrics.values()].sort(
    (a, b) =>
      b.crossDegree - a.crossDegree ||
      b.nodeCount - a.nodeCount ||
      a.file.localeCompare(b.file, 'en'),
  );
  const selected = new Set(
    focusCandidates.slice(0, PROJECTION_LIMITS.fileFocusNodes).map((metric) => metric.file),
  );

  const counterpartScore = new Map<string, number>();
  for (const relation of relevant) {
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from?.sourceFile || !to?.sourceFile) continue;
    const fromSelected = selected.has(from.sourceFile);
    const toSelected = selected.has(to.sourceFile);
    if (fromSelected && !toSelected) {
      counterpartScore.set(to.sourceFile, (counterpartScore.get(to.sourceFile) ?? 0) + 1);
    } else if (toSelected && !fromSelected) {
      counterpartScore.set(from.sourceFile, (counterpartScore.get(from.sourceFile) ?? 0) + 1);
    }
  }
  const counterparts = [...counterpartScore.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
    .slice(0, PROJECTION_LIMITS.fileCounterpartNodes)
    .map(([file]) => file);
  for (const file of counterparts) selected.add(file);

  const groups = new Map<string, { from: string; to: string; facts: ProjectionRelationFact[] }>();
  for (const relation of relevant) {
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from?.sourceFile || !to?.sourceFile) continue;
    if (!selected.has(from.sourceFile) || !selected.has(to.sourceFile)) continue;
    if (from.sourceFile === to.sourceFile) continue;
    const key = `${from.sourceFile}>${to.sourceFile}`;
    let group = groups.get(key);
    if (!group) {
      group = { from: from.sourceFile, to: to.sourceFile, facts: [] };
      groups.set(key, group);
    }
    group.facts.push(factFromRelation(relation, from, to));
  }

  const allEdges = [...groups.values()]
    .map((group) =>
      makeEdge(
        `file-edge:${group.from}>${group.to}`,
        group.from,
        group.to,
        fileLabel(group.from),
        fileLabel(group.to),
        group.facts,
      ),
    )
    .filter((edge): edge is ProjectionEdge => edge !== null)
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id, 'en'));
  const edges = allEdges.slice(0, PROJECTION_LIMITS.edges);

  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const nodeByIdForProjection = new Map<string, ProjectionNode>();
  for (const [file, metric] of metrics) {
    if (!selected.has(file)) continue;
    const primary = metric.primaryCount > 0;
    nodeByIdForProjection.set(file, {
      id: file,
      level: 'file',
      label: fileLabel(file),
      sublabel: file,
      description: file,
      moduleId: metric.moduleId,
      entityId: file,
      review: primary ? 'verified' : 'partially_verified',
      reviewMethod: primary ? 'ai-source-review' : 'unverified',
      distributed: moduleId === 'canvas',
      inFocus: true,
      nodeCount: metric.nodeCount,
      supportingCount: metric.supportingCount,
      relationCount: degree.get(file) ?? 0,
    });
  }
  for (const file of counterparts) {
    if (nodeByIdForProjection.has(file)) continue;
    const nodesInFile = dataset.nodes.filter(
      (node) =>
        node.sourceFile === file &&
        node.scope === 'product' &&
        (!repositoryId || node.repository === repositoryId),
    );
    const owner = nodesInFile.find((node) => node.moduleId)?.moduleId ?? null;
    nodeByIdForProjection.set(file, {
      id: file,
      level: 'file',
      label: fileLabel(file),
      sublabel: file,
      description: file,
      moduleId: owner,
      entityId: file,
      review: 'unverified',
      reviewMethod: 'unverified',
      distributed: false,
      inFocus: false,
      nodeCount: nodesInFile.length,
      supportingCount: 0,
      relationCount: degree.get(file) ?? 0,
    });
  }

  const nodes = [...nodeByIdForProjection.values()].sort(
    (a, b) =>
      (a.moduleId === moduleId ? 0 : 1) - (b.moduleId === moduleId ? 0 : 1) ||
      b.relationCount - a.relationCount ||
      b.nodeCount - a.nodeCount ||
      a.label.localeCompare(b.label, 'zh-CN'),
  );

  const hiddenFocus = Math.max(0, focusCandidates.length - PROJECTION_LIMITS.fileFocusNodes);
  const hiddenCounterparts = Math.max(0, counterpartScore.size - counterparts.length);
  const omittedEdges = Math.max(0, allEdges.length - edges.length);
  const notes = [
    `只显示与「${moduleName}」直接相连的文件，最多 ${PROJECTION_LIMITS.fileNodes} 个；未显示的文件仍可在关系探索中搜索。`,
    '文件之间的连线是数据集中的静态关系，不代表运行时调用顺序。',
  ];
  if (supportOnly) {
    notes.push('Canvas 只有支撑归属文件；这些连线来自宿主文件中的节点关系，不能据此声称存在一个独立的 Canvas 子系统。');
  }
  if (!edges.length) {
    notes.push('当前快照没有找到可从该模块文件层级绘制的跨文件关系。');
  }

  return baseProjection(
    dataset,
    'file',
    { moduleId, file: null },
    `${moduleName} · 文件层级`,
    nodes,
    edges,
    notes,
    {
      nodes: hiddenFocus + hiddenCounterparts,
      edges: omittedEdges,
      note: omittedEdges
        ? `另有 ${omittedEdges} 个文件对的关系未绘制；当前视图优先显示关系数最多的 ${PROJECTION_LIMITS.edges} 条。`
        : hiddenFocus || hiddenCounterparts
          ? `另有 ${hiddenFocus} 个本模块文件和 ${hiddenCounterparts} 个关联文件未显示。`
          : null,
    },
  );
}

export function symbolProjection(
  dataset: AtlasDataset,
  moduleId: AtlasModuleId,
  file: string,
): GraphProjection {
  return cachedFocus(dataset, `symbol:${moduleId}:${file}`, () =>
    buildSymbolProjection(dataset, moduleId, file),
  );
}

function buildSymbolProjection(
  dataset: AtlasDataset,
  moduleId: AtlasModuleId,
  file: string,
): GraphProjection {
  const moduleName = dataset.modules.find((module) => module.id === moduleId)?.name ?? moduleId;
  const repositoryId = moduleRepository(dataset, moduleId);
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const focusNodes = dataset.nodes.filter(
    (node) =>
      node.scope === 'product' &&
      node.sourceFile === file &&
      (!repositoryId || node.repository === repositoryId),
  );
  const focusIds = new Set(focusNodes.map((node) => node.id));

  const incident: AtlasRelation[] = [];
  for (const relation of dataset.relations) {
    if (relation.evidenceType === 'SIMULATED') continue;
    if (!focusIds.has(relation.from) && !focusIds.has(relation.to)) continue;
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from || !to || from.scope !== 'product' || to.scope !== 'product') continue;
    if (from.repository !== to.repository) continue;
    if (repositoryId && from.repository !== repositoryId) continue;
    if (relation.from === relation.to) continue;
    incident.push(relation);
  }

  const incidentCount = new Map<string, number>();
  for (const relation of incident) {
    incidentCount.set(relation.from, (incidentCount.get(relation.from) ?? 0) + 1);
    incidentCount.set(relation.to, (incidentCount.get(relation.to) ?? 0) + 1);
  }

  const selected = new Set(
    focusNodes
      .slice()
      .sort(
        (a, b) =>
          (incidentCount.get(b.id) ?? 0) - (incidentCount.get(a.id) ?? 0) ||
          (a.sourceLine ?? 0) - (b.sourceLine ?? 0) ||
          a.symbol.localeCompare(b.symbol, 'en'),
      )
      .slice(0, PROJECTION_LIMITS.symbolFocusNodes)
      .map((node) => node.id),
  );

  const counterpartScore = new Map<string, number>();
  for (const relation of incident) {
    const fromIn = selected.has(relation.from);
    const toIn = selected.has(relation.to);
    if (fromIn && !toIn) {
      counterpartScore.set(relation.to, (counterpartScore.get(relation.to) ?? 0) + 1);
    } else if (toIn && !fromIn) {
      counterpartScore.set(relation.from, (counterpartScore.get(relation.from) ?? 0) + 1);
    }
  }
  const counterpartIds = [...counterpartScore.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
    .slice(0, PROJECTION_LIMITS.symbolCounterpartNodes)
    .map(([id]) => id);
  for (const id of counterpartIds) selected.add(id);

  const groups = new Map<string, { from: string; to: string; facts: ProjectionRelationFact[] }>();
  for (const relation of incident) {
    if (!selected.has(relation.from) || !selected.has(relation.to)) continue;
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from || !to) continue;
    const key = `${from.id}>${to.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { from: from.id, to: to.id, facts: [] };
      groups.set(key, group);
    }
    group.facts.push(factFromRelation(relation, from, to));
  }

  const allEdges = [...groups.values()]
    .map((group) => {
      const from = nodeById.get(group.from);
      const to = nodeById.get(group.to);
      if (!from || !to) return null;
      return makeEdge(
        `symbol-edge:${group.from}>${group.to}`,
        group.from,
        group.to,
        nodeLabel(from),
        nodeLabel(to),
        group.facts,
      );
    })
    .filter((edge): edge is ProjectionEdge => edge !== null)
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id, 'en'));
  const edges = allEdges.slice(0, PROJECTION_LIMITS.edges);

  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const nodes: ProjectionNode[] = [...selected]
    .map((id) => nodeById.get(id))
    .filter((node): node is AtlasNode => node !== undefined)
    .map((node) => ({
      id: node.id,
      level: 'symbol' as const,
      label: nodeLabel(node),
      sublabel: node.symbol,
      description: node.responsibility ?? '',
      moduleId: node.moduleId,
      entityId: node.id,
      review: node.review.status,
      reviewMethod: node.review.method,
      distributed: node.moduleIds.includes('canvas') && node.moduleId !== 'canvas',
      inFocus: node.sourceFile === file,
      nodeCount: 1,
      supportingCount: node.moduleIds.length - 1,
      relationCount: degree.get(node.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        (a.moduleId === moduleId ? 0 : 1) - (b.moduleId === moduleId ? 0 : 1) ||
        b.relationCount - a.relationCount ||
        a.label.localeCompare(b.label, 'zh-CN'),
    );

  const hiddenFocus = Math.max(0, focusNodes.length - PROJECTION_LIMITS.symbolFocusNodes);
  const hiddenCounterparts = Math.max(0, counterpartScore.size - counterpartIds.length);
  const omittedEdges = Math.max(0, allEdges.length - edges.length);
  const notes = [
    `符号层级只显示当前文件内关系最多的 ${PROJECTION_LIMITS.symbolFocusNodes} 个符号，以及最多 ${PROJECTION_LIMITS.symbolCounterpartNodes} 个关联符号。`,
    '未显示不等于不存在；可在关系探索中按文件名或符号继续搜索。',
    '符号之间的连线是静态关系，不代表运行时调用顺序。',
  ];
  if (!edges.length) notes.push('当前快照没有找到从这个文件出发的可绘制关系。');

  return baseProjection(
    dataset,
    'symbol',
    { moduleId, file },
    `${moduleName} · ${fileLabel(file)} · 符号层级`,
    nodes,
    edges,
    notes,
    {
      nodes: hiddenFocus + hiddenCounterparts,
      edges: omittedEdges,
      note: omittedEdges
        ? `另有 ${omittedEdges} 个符号对的关系未绘制；当前视图优先显示关系数最多的 ${PROJECTION_LIMITS.edges} 条。`
        : hiddenFocus || hiddenCounterparts
          ? `另有 ${hiddenFocus} 个本文件符号和 ${hiddenCounterparts} 个关联符号未显示。`
          : null,
    },
  );
}

function factMatchesFilter(fact: ProjectionRelationFact, filter: ProjectionFilter): boolean {
  if (filter.typeGroup !== 'all' && fact.typeGroup !== filter.typeGroup) return false;
  if (filter.reviewGroup !== 'all' && fact.reviewGroup !== filter.reviewGroup) return false;
  if (filter.evidenceClass !== 'all' && fact.evidenceClass !== filter.evidenceClass) return false;
  return true;
}

/**
 * 关系级筛选：混合证据的边会重新计算类型、审核和待核实数量，
 * 不会因为一条边被标记为“直接提取”就隐藏其中的 AI 复核关系。
 */
export function applyProjectionFilter(
  projection: GraphProjection,
  filter: ProjectionFilter,
): GraphProjection {
  if (
    filter.typeGroup === 'all' &&
    filter.reviewGroup === 'all' &&
    filter.evidenceClass === 'all'
  ) {
    return projection;
  }
  const edges: ProjectionEdge[] = [];
  for (const edge of projection.edges) {
    const facts = edge.facts.filter((fact) => factMatchesFilter(fact, filter));
    if (!facts.length) continue;
    const next = makeEdge(edge.id, edge.from, edge.to, edge.fromLabel, edge.toLabel, facts);
    if (next) edges.push(next);
  }
  const activeNodeIds = new Set<string>();
  for (const edge of edges) {
    activeNodeIds.add(edge.from);
    activeNodeIds.add(edge.to);
  }
  const nodes = projection.nodes.map((node) => ({
    ...node,
    relationCount: edges.reduce(
      (sum, edge) => sum + (edge.from === node.id || edge.to === node.id ? 1 : 0),
      0,
    ),
  }));
  const stats = statsForEdges(edges);
  stats.nodeCount = nodes.length;
  return {
    ...projection,
    nodes,
    edges,
    stats,
    filter,
    notes: [
      ...projection.notes,
      `筛选后保留 ${edges.length} 条边、${stats.relationCount} 条关系；孤立节点仍保留，避免让筛选看起来像“删除了模块”。`,
    ],
    omitted: {
      ...projection.omitted,
      note: activeNodeIds.size < nodes.length ? '当前筛选下部分节点没有可见关系，但仍显示其存在。' : projection.omitted.note,
    },
  };
}

export interface ProjectionNeighbor {
  node: ProjectionNode;
  edge: ProjectionEdge;
  direction: 'in' | 'out';
}

export function projectionNeighbors(
  projection: GraphProjection,
  nodeId: string,
  direction: 'in' | 'out' | 'all' = 'all',
): ProjectionNeighbor[] {
  const nodeById = new Map(projection.nodes.map((node) => [node.id, node]));
  const neighbors: ProjectionNeighbor[] = [];
  for (const edge of projection.edges) {
    if (direction === 'all' || direction === 'out') {
      if (edge.from === nodeId) {
        const node = nodeById.get(edge.to);
        if (node) neighbors.push({ node, edge, direction: 'out' });
      }
    }
    if (direction === 'all' || direction === 'in') {
      if (edge.to === nodeId) {
        const node = nodeById.get(edge.from);
        if (node) neighbors.push({ node, edge, direction: 'in' });
      }
    }
  }
  return neighbors.sort(
    (a, b) => b.edge.count - a.edge.count || a.node.label.localeCompare(b.node.label, 'zh-CN'),
  );
}

export function findProjectionPath(
  projection: GraphProjection,
  fromId: string,
  toId: string,
  options: { maxDepth?: number; direction?: 'undirected' | 'out' } = {},
): ProjectionPath | null {
  if (fromId === toId) return null;
  const nodeById = new Map(projection.nodes.map((node) => [node.id, node]));
  if (!nodeById.has(fromId) || !nodeById.has(toId)) return null;
  const maxDepth = options.maxDepth ?? 6;
  const direction = options.direction ?? 'undirected';
  const adjacency = new Map<string, { next: string; edge: ProjectionEdge }[]>();
  for (const edge of projection.edges) {
    const forward = adjacency.get(edge.from) ?? [];
    forward.push({ next: edge.to, edge });
    adjacency.set(edge.from, forward);
    if (direction === 'undirected') {
      const backward = adjacency.get(edge.to) ?? [];
      backward.push({ next: edge.from, edge });
      adjacency.set(edge.to, backward);
    }
  }

  const queue: { id: string; nodeIds: string[]; edgeIds: string[] }[] = [
    { id: fromId, nodeIds: [fromId], edgeIds: [] },
  ];
  const visited = new Set<string>([fromId]);
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    if (current.nodeIds.length - 1 >= maxDepth) continue;
    for (const step of adjacency.get(current.id) ?? []) {
      if (visited.has(step.next)) continue;
      const nodeIds = [...current.nodeIds, step.next];
      const edgeIds = [...current.edgeIds, step.edge.id];
      if (step.next === toId) {
        return {
          nodeIds,
          edgeIds,
          nodes: nodeIds.map((id) => nodeById.get(id)).filter((node): node is ProjectionNode => !!node),
          edges: edgeIds
            .map((id) => projection.edges.find((edge) => edge.id === id))
            .filter((edge): edge is ProjectionEdge => !!edge),
          direction,
          note: '路径按静态关系搜索；不表示运行时调用顺序，也不保证这是唯一路径。',
        };
      }
      visited.add(step.next);
      queue.push({ id: step.next, nodeIds, edgeIds });
    }
  }
  return null;
}

/**
 * 全数据集路径查询。它可以在任意两个已知节点之间搜索，不要求节点
 * 同属一个已展开的投影层级。搜索按无向关联进行，返回每一步的真实
 * 关系与方向；没有路径时返回 null，由界面显示“当前图谱未发现关系路径”。
 */
export function findDatasetPath(
  dataset: AtlasDataset,
  fromId: string,
  toId: string,
  options: { maxDepth?: number; filter?: ProjectionFilter } = {},
): DatasetPath | null {
  if (fromId === toId) return null;
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  if (!nodeById.has(fromId) || !nodeById.has(toId)) return null;
  const filter = options.filter ?? DEFAULT_PROJECTION_FILTER;
  const maxDepth = options.maxDepth ?? 6;

  const adjacency = new Map<string, { next: string; relation: AtlasRelation }[]>();
  for (const relation of dataset.relations) {
    if (relation.evidenceType === 'SIMULATED') continue;
    const fromNode = nodeById.get(relation.from);
    const toNode = nodeById.get(relation.to);
    if (!fromNode || !toNode) continue;
    // Path exploration is for product architecture. Test fixtures, tooling
    // scripts and external packages would otherwise create misleading routes.
    if (fromNode.scope !== 'product' || toNode.scope !== 'product') continue;
    if (relation.from === relation.to) continue;
    const fact = factFromRelation(relation, fromNode, toNode);
    if (!factMatchesFilter(fact, filter)) continue;
    const forward = adjacency.get(relation.from) ?? [];
    forward.push({ next: relation.to, relation });
    adjacency.set(relation.from, forward);
    const backward = adjacency.get(relation.to) ?? [];
    backward.push({ next: relation.from, relation });
    adjacency.set(relation.to, backward);
  }

  const queue: { id: string; steps: DatasetPathStep[] }[] = [
    { id: fromId, steps: [{ node: nodeById.get(fromId)!, relation: null, direction: 'start', traversedForward: null }] },
  ];
  const visited = new Set<string>([fromId]);
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    if (current.steps.length - 1 >= maxDepth) continue;
    for (const step of adjacency.get(current.id) ?? []) {
      if (visited.has(step.next)) continue;
      const traversedForward = step.relation.from === current.id;
      const steps: DatasetPathStep[] = [
        ...current.steps,
        {
          node: nodeById.get(step.next)!,
          relation: step.relation,
          direction: traversedForward ? 'out' : 'in',
          traversedForward,
        },
      ];
      if (step.next === toId) {
        return {
          nodes: steps.map((item) => item.node),
          steps,
          direction: 'undirected',
          note: '该路径只说明标准数据集中存在哪些静态关系；不表示运行时调用顺序，也不保证这是唯一路径。',
        };
      }
      visited.add(step.next);
      queue.push({ id: step.next, steps });
    }
  }
  return null;
}

export function projectionRelationLabel(fact: ProjectionRelationFact): string {
  return RELATION_TYPE_LABELS[fact.type] ?? fact.type;
}

export function edgeEvidenceSummary(edge: ProjectionEdge): string {
  const parts = EVIDENCE_ORDER.filter((value) => edge.evidenceCounts[value] > 0).map(
    (value) => `${EVIDENCE_SHORT_LABELS[value]} ${edge.evidenceCounts[value]}`,
  );
  return parts.join(' · ');
}

export function nodeStatusLabel(node: ProjectionNode): string {
  if (node.distributed) return '分布式能力集合';
  if (node.level === 'module') return node.nodeCount > 0 ? `${node.nodeCount} 个主归属节点` : '无主归属节点';
  if (node.level === 'file') return `${node.nodeCount} 个节点`;
  return node.review === 'verified' ? '已核实范围' : '待核实范围';
}

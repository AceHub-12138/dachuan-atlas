import type {
  AtlasDataset,
  AtlasModuleId,
  AtlasNode,
  AtlasRelation,
  AtlasRelationType,
  AtlasReviewMethod,
} from './schema.ts';

/**
 * 关系探索的纯查询层。所有函数只做数组过滤/聚合，不触碰 Canvas，
 * 也不在 rAF 中运行。UI 每次只渲染当前文件或当前符号的关系。
 */

export type RelationTypeGroup = 'all' | 'calls' | 'imports' | 'contains' | 'other';
export type ReviewGroup = 'all' | 'ai' | 'human' | 'unverified';
export type Direction = 'all' | 'in' | 'out';

export interface RelationFilter {
  typeGroup: RelationTypeGroup;
  reviewGroup: ReviewGroup;
  evidenceType: 'all' | 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' | 'SIMULATED' | 'UNKNOWN';
  direction: Direction;
}

export const DEFAULT_RELATION_FILTER: RelationFilter = {
  typeGroup: 'all',
  reviewGroup: 'all',
  evidenceType: 'all',
  direction: 'all',
};

export interface ModuleFileSummary {
  file: string;
  nodeCount: number;
  primaryCount: number;
  supportingCount: number;
  sample: string[];
}

export interface RelationView {
  relation: AtlasRelation;
  direction: 'in' | 'out';
  counterpart: AtlasNode;
  typeLabel: string;
}

export interface ReviewCounts {
  ai: number;
  human: number;
  unverified: number;
  total: number;
}

const TYPE_GROUPS: Record<Exclude<RelationTypeGroup, 'all'>, AtlasRelationType[]> = {
  calls: ['calls', 'indirect_call'],
  imports: ['imports', 'imports_from', 'dynamic_import'],
  contains: ['contains', 'method'],
  other: ['references', 'implements', 'cites', 'rationale_for', 'unknown'],
};

export const RELATION_TYPE_LABELS: Partial<Record<AtlasRelationType, string>> = {
  calls: '调用',
  indirect_call: '间接调用',
  imports: '导入',
  imports_from: '从…导入',
  dynamic_import: '动态导入',
  contains: '包含',
  method: '方法成员',
  references: '引用',
  implements: '实现',
  cites: '引用文档',
  rationale_for: '设计说明',
  unknown: '未知类型',
};

function isProductNode(node: AtlasNode, moduleId?: AtlasModuleId): boolean {
  if (node.scope !== 'product') return false;
  return moduleId ? node.moduleIds.includes(moduleId) : true;
}

export function nodesForModule(dataset: AtlasDataset, moduleId: AtlasModuleId): AtlasNode[] {
  return dataset.nodes.filter((node) => isProductNode(node, moduleId));
}

export function moduleFiles(dataset: AtlasDataset, moduleId: AtlasModuleId): ModuleFileSummary[] {
  const byFile = new Map<string, AtlasNode[]>();
  for (const node of nodesForModule(dataset, moduleId)) {
    if (!node.sourceFile) continue;
    const list = byFile.get(node.sourceFile) ?? [];
    list.push(node);
    byFile.set(node.sourceFile, list);
  }
  return [...byFile.entries()]
    .map(([file, nodes]) => ({
      file,
      nodeCount: nodes.length,
      primaryCount: nodes.filter((node) => node.moduleId === moduleId).length,
      supportingCount: nodes.filter((node) => node.moduleId !== moduleId).length,
      sample: nodes
        .filter((node) => node.displayName)
        .slice(0, 3)
        .map((node) => node.displayName as string),
    }))
    .sort((a, b) => b.nodeCount - a.nodeCount || a.file.localeCompare(b.file, 'en'));
}

export function fileNodes(
  dataset: AtlasDataset,
  moduleId: AtlasModuleId,
  file: string,
): AtlasNode[] {
  return nodesForModule(dataset, moduleId)
    .filter((node) => node.sourceFile === file)
    .sort((a, b) => {
      const aPrimary = a.moduleId === moduleId ? 0 : 1;
      const bPrimary = b.moduleId === moduleId ? 0 : 1;
      if (aPrimary !== bPrimary) return aPrimary - bPrimary;
      return (a.displayName ?? a.symbol).localeCompare(b.displayName ?? b.symbol, 'zh-CN');
    });
}

export function searchModules(dataset: AtlasDataset, query: string): AtlasModuleId[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return dataset.modules
    .filter(
      (module) =>
        module.name.toLowerCase().includes(needle) ||
        module.latin.toLowerCase().includes(needle) ||
        module.id.includes(needle),
    )
    .map((module) => module.id);
}

export function searchNodes(
  dataset: AtlasDataset,
  query: string,
  options: { moduleId?: AtlasModuleId; limit?: number } = {},
): AtlasNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const limit = options.limit ?? 40;
  const matchedModules = new Set(searchModules(dataset, needle));
  const moduleNames = new Map(dataset.modules.map((module) => [module.id, module.name.toLowerCase()]));

  const scored = dataset.nodes
    .filter((node) => node.scope === 'product')
    .filter((node) => (options.moduleId ? node.moduleIds.includes(options.moduleId) : true))
    .filter((node) => {
      if (node.displayName?.toLowerCase().includes(needle)) return true;
      if (node.responsibility?.toLowerCase().includes(needle)) return true;
      if (node.symbol.toLowerCase().includes(needle)) return true;
      if (node.sourceFile?.toLowerCase().includes(needle)) return true;
      if (node.moduleIds.some((id) => matchedModules.has(id))) return true;
      return node.moduleIds.some((id) => (moduleNames.get(id) ?? '').includes(needle));
    })
    .map((node) => {
      const name = node.displayName?.toLowerCase() ?? '';
      const symbol = node.symbol.toLowerCase();
      const file = node.sourceFile?.toLowerCase() ?? '';
      let score = 0;
      if (name === needle) score += 100;
      else if (name.startsWith(needle)) score += 60;
      else if (name.includes(needle)) score += 40;
      if (symbol === needle) score += 80;
      else if (symbol.includes(needle)) score += 30;
      if (file.includes(needle)) score += 20;
      if (node.moduleId === options.moduleId) score += 10;
      return { node, score };
    })
    .sort((a, b) => b.score - a.score || (a.node.displayName ?? a.node.symbol).localeCompare(b.node.displayName ?? b.node.symbol, 'zh-CN'));

  return scored.slice(0, limit).map((entry) => entry.node);
}

export function relationTypeGroup(type: AtlasRelationType): Exclude<RelationTypeGroup, 'all'> {
  for (const [group, types] of Object.entries(TYPE_GROUPS) as [Exclude<RelationTypeGroup, 'all'>, AtlasRelationType[]][]) {
    if (types.includes(type)) return group;
  }
  return 'other';
}

function matchesReview(review: AtlasRelation['review'], group: ReviewGroup): boolean {
  if (group === 'all') return true;
  if (group === 'ai') return review.method === 'ai-source-review' && review.status !== 'unverified';
  if (group === 'human') return review.method === 'human-review' && review.status !== 'unverified';
  return review.status === 'unverified';
}

export function nodeRelations(
  dataset: AtlasDataset,
  nodeId: string,
  filter: RelationFilter = DEFAULT_RELATION_FILTER,
): RelationView[] {
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const views: RelationView[] = [];
  for (const relation of dataset.relations) {
    if (relation.from !== nodeId && relation.to !== nodeId) continue;
    if (filter.direction === 'out' && relation.from !== nodeId) continue;
    if (filter.direction === 'in' && relation.to !== nodeId) continue;
    if (filter.typeGroup !== 'all' && relationTypeGroup(relation.type) !== filter.typeGroup) continue;
    if (filter.evidenceType !== 'all' && relation.evidenceType !== filter.evidenceType) continue;
    if (!matchesReview(relation.review, filter.reviewGroup)) continue;
    const direction = relation.from === nodeId ? 'out' : 'in';
    const counterpart = nodeById.get(direction === 'out' ? relation.to : relation.from);
    if (!counterpart) continue;
    views.push({
      relation,
      direction,
      counterpart,
      typeLabel: RELATION_TYPE_LABELS[relation.type] ?? relation.type,
    });
  }
  return views.sort(
    (a, b) =>
      (a.counterpart.displayName ?? a.counterpart.symbol).localeCompare(
        b.counterpart.displayName ?? b.counterpart.symbol,
        'zh-CN',
      ),
  );
}

export function reviewCounts(relations: AtlasRelation[]): ReviewCounts {
  const counts: ReviewCounts = { ai: 0, human: 0, unverified: 0, total: relations.length };
  for (const relation of relations) {
    if (relation.review.method === 'ai-source-review' && relation.review.status !== 'unverified') counts.ai += 1;
    else if (relation.review.method === 'human-review' && relation.review.status !== 'unverified') counts.human += 1;
    else counts.unverified += 1;
  }
  return counts;
}

export function moduleInternalRelations(dataset: AtlasDataset, moduleId: AtlasModuleId): AtlasRelation[] {
  const memberIds = new Set(nodesForModule(dataset, moduleId).map((node) => node.id));
  return dataset.relations.filter((relation) => memberIds.has(relation.from) && memberIds.has(relation.to));
}

export function moduleReviewCounts(dataset: AtlasDataset, moduleId: AtlasModuleId): ReviewCounts {
  return reviewCounts(moduleInternalRelations(dataset, moduleId));
}

export function reviewMethodCounts(
  dataset: AtlasDataset,
): Record<AtlasReviewMethod, number> {
  const counts: Record<AtlasReviewMethod, number> = {
    'graphify-extracted': 0,
    'graphify-inferred': 0,
    'ai-source-review': 0,
    'human-review': 0,
    unverified: 0,
  };
  for (const relation of dataset.relations) counts[relation.review.method] += 1;
  return counts;
}

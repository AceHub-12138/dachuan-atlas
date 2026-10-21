import type {
  AtlasDataset,
  AtlasEvidenceRef,
  AtlasModuleId,
  AtlasNode,
  AtlasRelation,
  AtlasReview,
} from './schema.ts';
import { RELATION_TYPE_LABELS } from './query.ts';

/**
 * 面向非程序员的中文解释层。
 *
 * 这里只重组数据集中已经存在的事实：
 * - “它负责什么”来自已审核的模块 summary 或节点 responsibility；
 * - “为什么需要它”只在模块解释被收录时显示，否则明确写“未收录”；
 * - “已记录的联系”直接来自标准数据集的关系，并保留审核状态；
 * - “仍需确认”来自模块 gaps、节点审核状态和数据覆盖说明。
 *
 * 不会为没有中文注释的节点自动生成职责，也不会把静态关系写成运行时顺序。
 */

export interface PlainConnection {
  key: string;
  direction: 'out' | 'in' | 'none';
  directionLabel: string;
  counterpart: string;
  relationLabel: string;
  count: number;
  evidenceLabel: string;
  note: string;
}

export interface PlainTechnicalInfo {
  id: string;
  file: string | null;
  line: number | null;
  symbol: string | null;
  modules: string[];
  evidence: AtlasEvidenceRef[];
}

export interface PlainExplanation {
  objectKind: 'module' | 'file' | 'symbol';
  title: string;
  subtitle: string | null;
  what: string;
  why: string;
  connectionSummary: string;
  connections: PlainConnection[];
  uncertain: string[];
  reviewLabel: string;
  reviewNote: string;
  verifiedChinese: boolean;
  technical: PlainTechnicalInfo;
}

export function plainReviewLabel(review: AtlasReview | null): string {
  if (!review) return '未记录审核来源';
  if (review.method === 'human-review' && review.status !== 'unverified') return '已有人工审核';
  if (review.method === 'ai-source-review' && review.status !== 'unverified') return '已有 AI 源码复核';
  if (review.method === 'graphify-extracted' && review.status === 'unverified') {
    return '源码直接提取，尚未复核';
  }
  if (review.method === 'graphify-inferred') return '工具推断，尚未复核';
  return '尚未核实';
}

function relationTypeLabel(relation: AtlasRelation): string {
  return RELATION_TYPE_LABELS[relation.type] ?? relation.type;
}

function moduleName(dataset: AtlasDataset, moduleId: AtlasModuleId | null): string {
  if (!moduleId) return '未归属模块';
  return dataset.modules.find((module) => module.id === moduleId)?.name ?? moduleId;
}

function shortFileName(file: string): string {
  return file.split('/').pop() ?? file;
}

function nodeLabel(node: AtlasNode): string {
  // 默认解释层不展开原始符号；没有经核对中文名的对象用中性描述，
  // 具体符号与路径保留在技术细节折叠区。
  return node.displayName ?? '未收录中文名的组件';
}

function technicalForNode(node: AtlasNode, moduleIds: AtlasModuleId[]): PlainTechnicalInfo {
  return {
    id: node.id,
    file: node.sourceFile,
    line: node.sourceLine,
    symbol: node.symbol,
    modules: moduleIds.map((id) => id),
    evidence: node.evidence,
  };
}

function groupRelations(
  relations: Array<{
    relation: AtlasRelation;
    direction: 'out' | 'in';
    counterpart: string;
    counterpartId: string;
  }>,
): PlainConnection[] {
  const groups = new Map<string, PlainConnection>();
  for (const item of relations) {
    const label = relationTypeLabel(item.relation);
    const key = `${item.direction}|${item.counterpartId}|${label}`;
    const current = groups.get(key);
    const evidence = plainReviewLabel(item.relation.review);
    if (current) {
      current.count += 1;
      if (!current.evidenceLabel.includes(evidence)) {
        current.evidenceLabel = `${current.evidenceLabel} / ${evidence}`;
      }
    } else {
      groups.set(key, {
        key,
        direction: item.direction,
        directionLabel:
          item.direction === 'out' ? '本对象 → 对方' : item.direction === 'in' ? '对方 → 本对象' : '双向',
        counterpart: item.counterpart,
        relationLabel: label,
        count: 1,
        evidenceLabel: evidence,
        note: '静态源码关系，不代表运行时调用顺序。',
      });
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.counterpart.localeCompare(b.counterpart, 'zh-CN'),
  );
}

function unknownWhy(): string {
  return '当前数据没有单独收录「为什么需要它」的中文解释；这里不自动补写。';
}

export function explainModule(dataset: AtlasDataset, moduleId: AtlasModuleId): PlainExplanation | null {
  const module = dataset.modules.find((item) => item.id === moduleId);
  if (!module) return null;
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const groups = new Map<
    string,
    { counterpart: AtlasModuleId; direction: 'out' | 'in'; relations: AtlasRelation[] }
  >();
  for (const relation of dataset.relations) {
    if (relation.evidenceType === 'SIMULATED') continue;
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from || !to || from.scope !== 'product' || to.scope !== 'product') continue;
    if (!from.moduleId || !to.moduleId || from.moduleId === to.moduleId) continue;
    if (from.moduleId !== moduleId && to.moduleId !== moduleId) continue;
    const direction = from.moduleId === moduleId ? 'out' : 'in';
    const counterpart = direction === 'out' ? to.moduleId : from.moduleId;
    const key = `${direction}|${counterpart}`;
    const group = groups.get(key) ?? { counterpart, direction, relations: [] };
    group.relations.push(relation);
    groups.set(key, group);
  }
  const connections: PlainConnection[] = [...groups.values()]
    .map((group) => {
      const evidenceLabels = [
        ...new Set(group.relations.map((relation) => plainReviewLabel(relation.review))),
      ];
      return {
        key: `${group.direction}|${group.counterpart}`,
        direction: group.direction,
        directionLabel: group.direction === 'out' ? '本模块 → 对方模块' : '对方模块 → 本模块',
        counterpart: moduleName(dataset, group.counterpart),
        relationLabel: '跨模块静态关系',
        count: group.relations.length,
        evidenceLabel: evidenceLabels.join(' / '),
        note: '只说明当前快照有记录；不代表运行时调用顺序。',
      };
    })
    .sort((a, b) => b.count - a.count || a.counterpart.localeCompare(b.counterpart, 'zh-CN'));
  const total = connections.reduce((sum, connection) => sum + connection.count, 0);
  const otherModules = connections.length;
  const uncertain = [...module.gaps];
  if (!module.explanation?.whyNeeded) uncertain.unshift('「为什么需要它」尚未收录中文解释。');
  uncertain.push('模块内的关系大多仍待核实；没有连线不代表不存在依赖。');

  return {
    objectKind: 'module',
    title: module.name,
    subtitle: module.latin,
    what: module.summary,
    why: module.explanation?.whyNeeded ?? unknownWhy(),
    connectionSummary: otherModules
      ? `当前快照记录了它与 ${otherModules} 个其他主模块之间的 ${total} 条静态关系；这些关系不等于运行时调用顺序。`
      : '当前快照没有记录它与其他主模块之间的静态关系；未记录不代表不存在依赖。',
    connections,
    uncertain: [...new Set(uncertain)].slice(0, 5),
    reviewLabel: plainReviewLabel(module.reviewRecord),
    reviewNote: module.reviewRecord.note ?? '模块组成与解释分别记录审核来源。',
    verifiedChinese: true,
    technical: {
      id: `module:${module.id}`,
      file: null,
      line: null,
      symbol: null,
      modules: [module.id],
      evidence: module.evidence.flatMap((entry) => entry.sourceRefs),
    },
  };
}

export function explainFile(
  dataset: AtlasDataset,
  moduleId: AtlasModuleId,
  file: string,
): PlainExplanation | null {
  const module = dataset.modules.find((item) => item.id === moduleId);
  if (!module) return null;
  const nodes = dataset.nodes.filter(
    (node) =>
      node.scope === 'product' &&
      node.sourceFile === file &&
      node.moduleIds.includes(moduleId),
  );
  if (!nodes.length) return null;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const annotated = nodes.filter((node) => node.displayName && node.responsibility);
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));

  const incident: Array<{
    relation: AtlasRelation;
    direction: 'out' | 'in';
    counterpart: string;
    counterpartId: string;
  }> = [];
  for (const relation of dataset.relations) {
    if (relation.evidenceType === 'SIMULATED' || relation.from === relation.to) continue;
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from || !to || from.scope !== 'product' || to.scope !== 'product') continue;
    const fromIn = nodeIds.has(relation.from);
    const toIn = nodeIds.has(relation.to);
    if (!fromIn && !toIn) continue;
    if (fromIn && toIn) continue;
    const counterpart = fromIn ? to : from;
    incident.push({
      relation,
      direction: fromIn ? 'out' : 'in',
      counterpart: nodeLabel(counterpart),
      counterpartId: counterpart.id,
    });
  }
  const connections = groupRelations(incident).slice(0, 5);
  const total = incident.length;
  const what = annotated.length
    ? `这是「${module.name}」中的一个文件，包含已核对的中文对象：${annotated
        .slice(0, 3)
        .map((node) => `${node.displayName}（${node.responsibility}）`)
        .join('；')}。`
    : `这是「${module.name}」中的一个源码文件。当前快照没有为它单独收录经核对的中文说明，因此不自动生成职责描述。`;
  const why = module.explanation?.whyNeeded
    ? `它服务于「${module.name}」：${module.explanation.whyNeeded}`
    : unknownWhy();
  const uncertain = [
    ...(annotated.length
      ? []
      : ['这个文件没有经过核对的中文职责说明；需要回到源码或补充注释后才能确认。']),
    ...module.gaps.slice(0, 2),
    '文件内的调用关系可能没有被 Graphify 覆盖；未出现的边不等于不存在。',
  ];

  return {
    objectKind: 'file',
    title: shortFileName(file),
    subtitle: file,
    what,
    why,
    connectionSummary: total
      ? `当前快照记录了这个文件内节点与外部对象的 ${total} 条静态关系，涉及 ${connections.length} 组对方对象。`
      : '当前快照没有记录这个文件与其他文件之间的静态关系；这不等于没有依赖。',
    connections,
    uncertain: [...new Set(uncertain)].slice(0, 5),
    reviewLabel: plainReviewLabel(module.reviewRecord),
    reviewNote: '文件级没有独立的审核记录；这里引用模块组成的审核来源。',
    verifiedChinese: annotated.length > 0,
    technical: {
      id: `file:${file}`,
      file,
      line: null,
      symbol: null,
      modules: [moduleId],
      evidence: annotated.flatMap((node) => node.evidence),
    },
  };
}

export function explainNode(dataset: AtlasDataset, nodeId: string): PlainExplanation | null {
  const node = dataset.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const moduleId = node.moduleId ?? node.moduleIds[0] ?? null;
  const module = moduleId
    ? dataset.modules.find((candidate) => candidate.id === moduleId) ?? null
    : null;
  const annotated = node.displayName !== null && node.responsibility !== null;
  const nodeById = new Map(dataset.nodes.map((candidate) => [candidate.id, candidate]));
  const incident: Array<{
    relation: AtlasRelation;
    direction: 'out' | 'in';
    counterpart: string;
    counterpartId: string;
  }> = [];
  for (const relation of dataset.relations) {
    if (relation.from !== node.id && relation.to !== node.id) continue;
    if (relation.from === relation.to) continue;
    const direction = relation.from === node.id ? 'out' : 'in';
    const counterpart = nodeById.get(direction === 'out' ? relation.to : relation.from);
    if (!counterpart) continue;
    incident.push({
      relation,
      direction,
      counterpart: nodeLabel(counterpart),
      counterpartId: counterpart.id,
    });
  }
  const connections = groupRelations(incident).slice(0, 5);
  const total = incident.length;
  const uncertain: string[] = [];
  if (!annotated) uncertain.push('中文名称与职责尚未经源码核对；这里保留原始符号名。');
  if (node.review.status === 'unverified') uncertain.push('该对象的名称/职责仍为待核实状态。');
  if (incident.some((item) => item.relation.review.status === 'unverified')) {
    uncertain.push('与它相关的关系中包含待核实项，不能当作已确认事实。');
  }
  uncertain.push('没有运行时证据时，不把静态关系描述成执行顺序。');

  return {
    objectKind: 'symbol',
    title: annotated ? (node.displayName as string) : node.symbol,
    subtitle: node.symbol,
    what: annotated
      ? (node.responsibility as string)
      : `当前快照没有为符号 ${node.symbol} 收录经核对的中文职责说明，不自动生成。`,
    why: module?.explanation?.whyNeeded
      ? `它服务于「${module.name}」：${module.explanation.whyNeeded}`
      : unknownWhy(),
    connectionSummary: total
      ? `当前快照记录了 ${total} 条与它直接相连的静态关系，涉及 ${connections.length} 组对方对象。`
      : '当前快照没有记录与它直接相连的静态关系；未记录不代表不存在调用。',
    connections,
    uncertain: [...new Set(uncertain)].slice(0, 5),
    reviewLabel: plainReviewLabel(node.review),
    reviewNote: node.review.note ?? '中文名称与职责的审核记录。',
    verifiedChinese: annotated,
    technical: technicalForNode(node, node.moduleIds),
  };
}

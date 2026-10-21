import { MODULES, SYSTEMS } from '../data/atlas.ts';
import {
  ATLAS_SCHEMA_ID,
  ATLAS_SCHEMA_VERSION,
  emptyReview,
  type AtlasDataset,
  type AtlasModuleId,
  type AtlasModuleRecord,
  type AtlasNode,
  type AtlasRelation,
} from './schema.ts';

/**
 * P0.1 演示数据的 ATLAS 表示。
 *
 * 这里刻意不引用 NEXUS 的模块规则与中文注释：演示数据随前端公开发布，
 * 不能携带任何真实源码路径、符号或审核记录。真实数据只能由用户明确导入。
 */

const DEMO_GENERATED_AT = '2026-10-20T00:00:00.000Z';
const DEMO_REPOSITORY = 'demo';

const DEMO_SUMMARIES: Record<AtlasModuleId, string> = {
  data: '演示：把经营数据组织成合同、回款、客户与发货四类现场视图。',
  voice: '演示：让用户用语音提问，并把答案以语音和卡片返回。',
  animation: '演示：用一个统一的调度器控制大屏的入场、脉冲与降级节奏。',
  canvas: '演示：分布在大屏与语音覆盖层中的 Canvas 绘制能力集合。',
};

const DEMO_GAPS = [
  '演示模式不包含源码证据；导入本地 ATLAS 快照后查看真实模块详情。',
];

function demoNode(
  id: string,
  name: string,
  description: string,
  system: AtlasNode['system'],
  moduleId: AtlasNode['moduleId'],
  latin: string,
): AtlasNode {
  return {
    id,
    sourceId: id,
    repository: DEMO_REPOSITORY,
    system,
    kind: 'symbol',
    symbol: latin,
    symbolType: 'unknown',
    sourceFile: null,
    sourceLine: null,
    scope: 'demo',
    moduleId,
    moduleIds: moduleId ? [moduleId] : [],
    displayName: name,
    responsibility: description,
    sourceConfidence: 'SIMULATED',
    review: emptyReview('P0.1 演示数据，未与源码核对。'),
    community: null,
    external: false,
    metadata: {},
    evidence: [],
  };
}

function demoRelation(from: string, to: string, index: number, type: AtlasRelation['type'] = 'references'): AtlasRelation {
  return {
    id: `demo:${from}->${to}:${type}`,
    from,
    to,
    type,
    sourceRelation: type,
    evidenceType: 'SIMULATED',
    confidence: null,
    review: emptyReview('演示关系，不来自源码。'),
    evidence: null,
    selfReference: from === to,
    context: 'demo',
    flags: { deferred: false, typeOnly: false },
    sourceIndex: index,
  };
}

export function buildDemoDataset(): AtlasDataset {
  const systemNodes = SYSTEMS.map((system) =>
    demoNode(`demo:system:${system.id}`, system.name, system.description, system.id, null, system.latin),
  );
  const moduleNodes = MODULES.map((module) =>
    demoNode(`demo:module:${module.id}`, module.name, module.description, 'nexus', module.id, module.latin),
  );

  let relationIndex = 0;
  const relations: AtlasRelation[] = [];
  for (const module of MODULES) {
    relations.push(demoRelation('demo:system:nexus', `demo:module:${module.id}`, relationIndex, 'contains'));
    relationIndex += 1;
  }
  relations.push(demoRelation('demo:module:voice', 'demo:module:data', relationIndex));
  relationIndex += 1;
  relations.push(demoRelation('demo:module:voice', 'demo:module:animation', relationIndex));
  relationIndex += 1;
  relations.push(demoRelation('demo:module:voice', 'demo:module:canvas', relationIndex));

  const modules: AtlasModuleRecord[] = MODULES.map((module) => ({
    id: module.id,
    index: module.index,
    name: module.name,
    latin: module.latin,
    system: 'nexus',
    review: 'unverified',
    reviewRecord: emptyReview('演示模块，未进行源码复核。'),
    summary: DEMO_SUMMARIES[module.id],
    responsibilities: [module.description],
    keyComponents: [],
    gaps: DEMO_GAPS,
    rule: '演示模块，不进行源码归类。',
    description: module.description,
    notes: ['演示模式不提供真实节点统计；导入本地快照后查看源码证据。'],
    evidence: [],
    stats: {
      productNodes: 0,
      supportingNodes: 0,
      productRelations: 0,
      crossModuleRelations: 0,
      extractedRelations: 0,
      inferredRelations: 0,
      ambiguousRelations: 0,
      verifiedRelations: 0,
      unverifiedRelations: 0,
      files: 0,
      communities: 0,
    },
  }));

  return {
    schemaId: ATLAS_SCHEMA_ID,
    schemaVersion: ATLAS_SCHEMA_VERSION,
    generatedAt: DEMO_GENERATED_AT,
    source: {
      kind: 'demo',
      label: '演示数据',
      detail: 'P0.1 视觉原型模拟数据，不代表真实代码依赖。',
      simulated: true,
      snapshotId: null,
      origin: 'demo',
    },
    snapshot: null,
    systems: [
      ...SYSTEMS.map((system) => ({
        id: system.id,
        name: system.name,
        dataStatus: 'simulated' as const,
        source: 'demo' as const,
        snapshotId: null,
        note: '演示数据；尚未接入真实架构数据。',
      })),
    ].sort((a, b) => {
      const order = ['nexus', 'crm', 'electron'];
      return order.indexOf(a.id) - order.indexOf(b.id);
    }),
    modules,
    nodes: [...systemNodes, ...moduleNodes].sort((a, b) => a.id.localeCompare(b.id, 'en')),
    relations: relations.sort((a, b) => a.id.localeCompare(b.id, 'en')),
    diagnostics: {
      issues: [
        {
          code: 'ATLAS_DEMO_MODE',
          severity: 'info',
          message: '当前为 P0.1 演示数据，所有关系均为模拟，不能作为真实架构证据。',
          count: 1,
        },
      ],
      counts: {
        rawNodes: systemNodes.length + moduleNodes.length,
        rawRelations: relations.length,
        nodes: systemNodes.length + moduleNodes.length,
        relations: relations.length,
        productNodes: 0,
        testNodes: 0,
        toolingNodes: 0,
        externalNodes: 0,
        conceptNodes: 0,
        rationaleNodes: 0,
        modulesAssigned: 0,
        modulesUnassigned: 0,
        unresolvedCalls: 0,
        nodesWithUnresolvedCalls: 0,
      },
      unresolvedCallsByReceiver: [],
      reviewCounts: {
        aiReviewed: 0,
        humanReviewed: 0,
        graphifyExtractedUnverified: 0,
        graphifyInferredUnverified: 0,
        unverified: 0,
      },
      coverageNotes: ['演示数据不包含源码证据；导入本地 ATLAS 快照可查看真实映射。'],
    },
  };
}

import type {
  AtlasDataset,
  AtlasFlowScenario,
  AtlasFlowStep,
  AtlasNode,
  AtlasRelation,
  AtlasReview,
} from './schema.ts';
import { EVIDENCE_ORDER, evidenceClassForRelation } from './projection.ts';

/**
 * 流程场景的只读解释层。
 *
 * 场景本身由本地数据提供，不从关系图自动生成。这里只做两件事：
 * 1. 把每一步解析到快照中的真实节点；
 * 2. 检查相邻步骤的文件之间是否存在已记录的关系。
 *
 * 没有关系的步骤会被标成“缺口”，不会为了让流程看起来完整而补一条边。
 */

export interface FlowStepView {
  step: AtlasFlowStep;
  node: AtlasNode | null;
  resolved: boolean;
  review: AtlasReview | null;
  evidenceLocator: string | null;
}

export interface FlowTransitionView {
  fromStepId: string;
  toStepId: string;
  status: 'linked' | 'gap' | 'unresolved';
  relations: AtlasRelation[];
  direction: 'forward' | 'backward' | 'mixed' | 'none';
  evidenceCounts: Record<string, number>;
  note: string;
}

export interface FlowView {
  scenario: AtlasFlowScenario;
  available: boolean;
  steps: FlowStepView[];
  transitions: FlowTransitionView[];
  linkedCount: number;
  gapCount: number;
  unresolvedCount: number;
  notes: string[];
}

function flowSymbolMatches(nodeSymbol: string, stepSymbol: string): boolean {
  return (
    nodeSymbol === stepSymbol ||
    nodeSymbol === `${stepSymbol}()` ||
    nodeSymbol === `.${stepSymbol}()` ||
    nodeSymbol === `.${stepSymbol}`
  );
}

function resolveStep(dataset: AtlasDataset, step: AtlasFlowStep): AtlasNode | null {
  const candidates = dataset.nodes.filter(
    (node) =>
      node.sourceFile === step.file &&
      flowSymbolMatches(node.symbol, step.symbol) &&
      node.moduleIds.includes(step.moduleId),
  );
  if (!candidates.length) return null;
  return (
    candidates
      .slice()
      .sort((a, b) => {
        const lineA = step.line !== null && a.sourceLine === step.line ? 0 : 1;
        const lineB = step.line !== null && b.sourceLine === step.line ? 0 : 1;
        if (lineA !== lineB) return lineA - lineB;
        const primaryA = a.moduleId === step.moduleId ? 0 : 1;
        const primaryB = b.moduleId === step.moduleId ? 0 : 1;
        return primaryA - primaryB;
      })[0] ?? null
  );
}

function relationsBetweenFiles(dataset: AtlasDataset, fromFile: string, toFile: string): AtlasRelation[] {
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const relations: AtlasRelation[] = [];
  for (const relation of dataset.relations) {
    if (relation.evidenceType === 'SIMULATED') continue;
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from || !to || from.scope !== 'product' || to.scope !== 'product') continue;
    if (!from.sourceFile || !to.sourceFile) continue;
    const forward = from.sourceFile === fromFile && to.sourceFile === toFile;
    const backward = from.sourceFile === toFile && to.sourceFile === fromFile;
    if (forward || backward) relations.push(relation);
  }
  return relations.sort((a, b) => {
    const rankA = EVIDENCE_ORDER.indexOf(evidenceClassForRelation(a));
    const rankB = EVIDENCE_ORDER.indexOf(evidenceClassForRelation(b));
    return rankA - rankB || a.id.localeCompare(b.id, 'en');
  });
}

function transitionFor(
  dataset: AtlasDataset,
  fromStep: FlowStepView,
  toStep: FlowStepView,
): FlowTransitionView {
  if (!fromStep.resolved || !toStep.resolved) {
    return {
      fromStepId: fromStep.step.id,
      toStepId: toStep.step.id,
      status: 'unresolved',
      relations: [],
      direction: 'none',
      evidenceCounts: {},
      note: '当前快照没有找到这一步引用的源码位置，无法检查它与下一步的关系。',
    };
  }

  const relations = relationsBetweenFiles(dataset, fromStep.step.file, toStep.step.file);
  if (!relations.length) {
    return {
      fromStepId: fromStep.step.id,
      toStepId: toStep.step.id,
      status: 'gap',
      relations: [],
      direction: 'none',
      evidenceCounts: {},
      note: '当前图谱未记录这两个文件之间的关系；这可能表示运行时路径未被 Graphify 覆盖，不能据此补全步骤。',
    };
  }

  let forward = 0;
  let backward = 0;
  const evidenceCounts: Record<string, number> = {};
  for (const relation of relations) {
    const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
    const from = nodeById.get(relation.from);
    if (from?.sourceFile === fromStep.step.file) forward += 1;
    else backward += 1;
    const label = evidenceClassForRelation(relation);
    evidenceCounts[label] = (evidenceCounts[label] ?? 0) + 1;
  }
  const direction = forward > 0 && backward > 0 ? 'mixed' : forward > 0 ? 'forward' : 'backward';
  const directionLabel =
    direction === 'forward'
      ? '前一文件 → 后一文件'
      : direction === 'backward'
        ? '后一文件 → 前一文件'
        : '两个方向都有记录';
  return {
    fromStepId: fromStep.step.id,
    toStepId: toStep.step.id,
    status: 'linked',
    relations,
    direction,
    evidenceCounts,
    note: `发现 ${relations.length} 条文件级静态关系（${directionLabel}）；这只说明源码中存在导入 / 引用，不代表运行时调用顺序。`,
  };
}

export function buildFlowView(dataset: AtlasDataset, scenario: AtlasFlowScenario): FlowView {
  const steps: FlowStepView[] = scenario.steps.map((step) => {
    const node = resolveStep(dataset, step);
    return {
      step,
      node,
      resolved: node !== null,
      review: node?.review ?? null,
      evidenceLocator: node?.evidence[0]?.locator ?? node?.sourceFile ?? null,
    };
  });

  const transitions: FlowTransitionView[] = [];
  for (let index = 0; index < steps.length - 1; index += 1) {
    transitions.push(transitionFor(dataset, steps[index], steps[index + 1]));
  }
  const linkedCount = transitions.filter((transition) => transition.status === 'linked').length;
  const gapCount = transitions.filter((transition) => transition.status === 'gap').length;
  const unresolvedCount = transitions.filter((transition) => transition.status === 'unresolved').length;

  return {
    scenario,
    available: steps.some((step) => step.resolved),
    steps,
    transitions,
    linkedCount,
    gapCount,
    unresolvedCount,
    notes: [
      scenario.disclaimer,
      '流程步骤只描述已核对的源码职责；相邻步骤之间的连线来自标准数据集的静态关系。',
      gapCount
        ? `当前有 ${gapCount} 个步骤衔接没有图边，界面会明确标记为缺口。`
        : '当前所有步骤衔接都有静态关系记录；仍不代表运行时顺序已被验证。',
    ],
  };
}

export function flowViewsFor(dataset: AtlasDataset): FlowView[] {
  return dataset.flows.map((scenario) => buildFlowView(dataset, scenario));
}

export function flowForModule(dataset: AtlasDataset, moduleId: string): FlowView | null {
  const scenario = dataset.flows.find((flow) => flow.entryModuleId === moduleId);
  return scenario ? buildFlowView(dataset, scenario) : null;
}

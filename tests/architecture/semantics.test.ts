import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAtlasDataset } from '../../src/architecture/dataset';
import { buildFlowView } from '../../src/architecture/flows';
import { AtlasDataError } from '../../src/architecture/schema';

const DATASET_PATH = join(process.cwd(), 'local-data', 'nexus', 'nexus-2026-10-20-2584284.atlas.json');
const raw = JSON.parse(readFileSync(DATASET_PATH, 'utf8')) as Record<string, unknown>;
const dataset = parseAtlasDataset(raw);

describe('P1.3 流程语义区分', () => {
  it('当前语音场景是模块协作示意，不是运行时流程', () => {
    expect(dataset.flows).toHaveLength(1);
    const scenario = dataset.flows[0];
    expect(scenario.semantics).toBe('module-collaboration');
    expect(scenario.runtimeOrder).toMatchObject({ verified: false, evidence: [] });
    expect(scenario.runtimeOrder?.note).toContain('没有运行时');
    expect(scenario.steps.every((step) => step.basis === 'source-responsibility')).toBe(true);
  });

  it('视图同时给出概念步骤、静态关联、运行时顺序与缺口四类计数', () => {
    const view = buildFlowView(dataset, dataset.flows[0]);
    expect(view.semantics).toMatchObject({
      scenarioSemantics: 'module-collaboration',
      conceptualStepCount: 7,
      staticLinkCount: 4,
      runtimeLinkCount: 0,
      gapCount: 2,
      unresolvedCount: 0,
      runtimeOrderVerified: false,
    });
    expect(view.steps).toHaveLength(7);
    expect(view.steps.every((step) => step.basis === 'ai-conceptual')).toBe(true);
    expect(view.transitions.map((transition) => transition.kind)).toEqual([
      'static-link',
      'static-link',
      'static-link',
      'static-link',
      'gap',
      'gap',
    ]);
    expect(view.transitions.filter((transition) => transition.kind === 'static-link').every((transition) => transition.runtimeVerified === false)).toBe(true);
  });

  it('缺口不补线，也不伪装成运行时步骤', () => {
    const view = buildFlowView(dataset, dataset.flows[0]);
    const gaps = view.transitions.filter((transition) => transition.kind === 'gap');
    expect(gaps).toHaveLength(2);
    for (const gap of gaps) {
      expect(gap.relations).toEqual([]);
      expect(gap.note).toContain('未记录');
      expect(gap.runtimeVerified).toBe(false);
    }
  });

  it('旧版 1.2 流程导入后补上保守语义默认值，不改源码事实', () => {
    const legacy = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    legacy.schemaVersion = '1.2.0';
    const flows = legacy.flows as Record<string, unknown>[];
    delete flows[0].semantics;
    delete flows[0].runtimeOrder;
    for (const step of flows[0].steps as Record<string, unknown>[]) delete step.basis;
    for (const module of legacy.modules as Record<string, unknown>[]) delete module.explanation;
    delete legacy.repositories;

    const migrated = parseAtlasDataset(legacy);
    expect(migrated.schemaVersion).toBe('1.3.0');
    expect(migrated.schemaMigratedFrom).toBe('1.2.0');
    expect(migrated.flows[0].semantics).toBe('module-collaboration');
    expect(migrated.flows[0].runtimeOrder?.verified).toBe(false);
    expect(migrated.flows[0].runtimeOrder?.note).toContain('迁移');
    expect(migrated.flows[0].steps.every((step) => step.basis === 'source-responsibility')).toBe(true);
    expect(migrated.modules.every((module) => module.explanation === null)).toBe(true);
    expect(migrated.repositories).toHaveLength(1);
    expect(migrated.repositories?.[0].snapshots[0].snapshotKey).toBe('nexus@2584284@2026-10-20');
    expect(migrated.nodes).toHaveLength(dataset.nodes.length);
    expect(migrated.relations).toHaveLength(dataset.relations.length);
  });

  it('拒绝声称运行时已验证却没有证据的场景', () => {
    const broken = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    const flow = (broken.flows as Record<string, unknown>[])[0];
    flow.semantics = 'runtime-verified';
    flow.runtimeOrder = {
      verified: true,
      note: '声称已验证',
      evidence: [],
    };
    expect(() => parseAtlasDataset(broken)).toThrowError(AtlasDataError);
    expect(() => parseAtlasDataset(broken)).toThrow(/没有 verified=true 与非空/);
  });

  it('拒绝模块协作示意同时声称运行时已验证', () => {
    const broken = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    const flow = (broken.flows as Record<string, unknown>[])[0];
    flow.semantics = 'module-collaboration';
    flow.runtimeOrder = { verified: true, note: '矛盾', evidence: [] };
    expect(() => parseAtlasDataset(broken)).toThrow(/不能声称运行时顺序已验证/);
  });
});

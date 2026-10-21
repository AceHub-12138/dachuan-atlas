import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '../../src/architecture/demo-dataset';
import {
  importAtlasDatasetText,
  moduleHighlights,
  parseAtlasDataset,
  serializeAtlasDataset,
} from '../../src/architecture/dataset';
import { AtlasDataError } from '../../src/architecture/schema';

function demoJson(): Record<string, unknown> {
  return JSON.parse(serializeAtlasDataset(buildDemoDataset())) as Record<string, unknown>;
}

describe('演示数据', () => {
  it('保持 P0.1 的模拟语义，不包含真实快照', () => {
    const dataset = buildDemoDataset();
    expect(dataset.source.kind).toBe('demo');
    expect(dataset.source.simulated).toBe(true);
    expect(dataset.snapshot).toBeNull();
    expect(dataset.nodes).toHaveLength(7);
    expect(dataset.relations).toHaveLength(7);
    expect(dataset.relations.every((relation) => relation.evidenceType === 'SIMULATED')).toBe(true);
    expect(dataset.systems.find((system) => system.id === 'nexus')?.dataStatus).toBe('simulated');
    expect(dataset.systems.find((system) => system.id === 'crm')?.dataStatus).toBe('simulated');
    expect(dataset.modules).toHaveLength(4);
  });

  it('演示数据可以导出并重新导入', () => {
    const dataset = buildDemoDataset();
    const restored = parseAtlasDataset(JSON.parse(serializeAtlasDataset(dataset)));
    expect(restored).toEqual(dataset);
  });

  it('演示模块不提供真实节点统计', () => {
    const dataset = buildDemoDataset();
    expect(dataset.modules.every((module) => module.stats.productNodes === 0)).toBe(true);
    expect(moduleHighlights(dataset, 'voice')).toEqual([]);
  });

  it('演示模块带有普通用户可读的说明，但不含源码证据', () => {
    const dataset = buildDemoDataset();
    for (const module of dataset.modules) {
      expect(module.summary.length).toBeGreaterThan(10);
      expect(module.responsibilities.length).toBeGreaterThan(0);
      expect(module.gaps.length).toBeGreaterThan(0);
      expect(module.keyComponents).toEqual([]);
      expect(module.reviewRecord.method).toBe('unverified');
    }
    expect(JSON.stringify(dataset)).not.toContain('src/lib/voice/');
  });
});

describe('ATLAS 标准数据校验', () => {
  it('拒绝错误的 schemaId', () => {
    expect(() => parseAtlasDataset({ schemaId: 'other' })).toThrowError(AtlasDataError);
    expect(() => parseAtlasDataset({ schemaId: 'other' })).toThrow(/不是 ATLAS 标准数据/);
  });

  it('拒绝不兼容的主版本与未来次版本', () => {
    const raw = demoJson();
    raw.schemaVersion = '2.0.0';
    expect(() => parseAtlasDataset(raw)).toThrow(/不兼容/);

    const futureMinor = demoJson();
    futureMinor.schemaVersion = '1.5.0';
    expect(() => parseAtlasDataset(futureMinor)).toThrow(/不兼容/);
  });

  it('兼容 1.0 数据并迁移审核元数据，不丢失节点与关系', () => {
    const raw = demoJson();
    raw.schemaVersion = '1.0.0';
    const nodes = raw.nodes as Record<string, unknown>[];
    const relations = raw.relations as Record<string, unknown>[];
    const modules = raw.modules as Record<string, unknown>[];
    for (const node of nodes) node.review = { status: 'unverified', reviewer: null, reviewedAt: null, note: '旧版' };
    for (const relation of relations) {
      relation.review = { status: 'verified', reviewer: 'P1.0 人工核对', reviewedAt: '2026-10-20', note: '旧版' };
    }
    for (const module of modules) {
      delete module.reviewRecord;
      delete module.summary;
      delete module.responsibilities;
      delete module.keyComponents;
      delete module.gaps;
    }
    delete (raw.diagnostics as Record<string, unknown>).reviewCounts;

    const migrated = parseAtlasDataset(raw);
    expect(migrated.schemaVersion).toBe('1.4.0');
    expect(migrated.schemaMigratedFrom).toBe('1.0.0');
    expect(migrated.nodes).toHaveLength(nodes.length);
    expect(migrated.relations).toHaveLength(relations.length);
    expect(migrated.relations[0].review.method).toBe('ai-source-review');
    expect(migrated.relations[0].review.actor).toContain('P1.0');
    expect(migrated.modules[0].summary.length).toBeGreaterThan(0);
    expect(migrated.modules[0].keyComponents).toEqual([]);
    expect(migrated.schemaMigratedFrom).toBe('1.0.0');
    expect(migrated.diagnostics.reviewCounts).toBeDefined();
    expect(migrated.diagnostics.reviewCounts.aiReviewed).toBe(relations.length);
  });

  it('拒绝重复节点 ID', () => {
    const raw = demoJson();
    const nodes = raw.nodes as Record<string, unknown>[];
    nodes.push({ ...nodes[0] });
    expect(() => parseAtlasDataset(raw)).toThrow(/重复节点/);
  });

  it('拒绝悬空关系', () => {
    const raw = demoJson();
    const relations = raw.relations as Record<string, unknown>[];
    relations[0].to = 'demo:missing';
    expect(() => parseAtlasDataset(raw)).toThrow(/不存在的节点/);
  });

  it('拒绝绝对路径证据', () => {
    const raw = demoJson();
    const nodes = raw.nodes as Record<string, unknown>[];
    nodes[0].evidence = [
      {
        repository: 'demo',
        commit: 'unknown',
        file: '/Users/example/secret.ts',
        line: 1,
        symbol: 'x',
        locator: '/Users/example/secret.ts#L1',
      },
    ];
    expect(() => parseAtlasDataset(raw)).toThrow(/不是仓库相对路径/);
  });

  it('拒绝非 JSON 文本', () => {
    expect(() => importAtlasDatasetText('not json')).toThrow(/不是合法 JSON/);
  });

  it('导出 / 重新导入保持节点关系与审核状态一致', () => {
    const raw = demoJson();
    const first = parseAtlasDataset(raw);
    const second = parseAtlasDataset(JSON.parse(serializeAtlasDataset(first)));
    expect(second).toEqual(first);
    expect(second.schemaVersion).toBe(first.schemaVersion);
    expect(second.relations.map((relation) => relation.review.status)).toEqual(
      first.relations.map((relation) => relation.review.status),
    );
  });
});

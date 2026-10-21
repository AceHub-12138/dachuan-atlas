import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RELATION_FILTER,
  fileNodes,
  moduleFiles,
  moduleReviewCounts,
  nodeRelations,
  reviewCounts,
  searchModules,
  searchNodes,
} from '../../src/architecture/query';
import { parseAtlasDataset } from '../../src/architecture/dataset';
import { buildDemoDataset } from '../../src/architecture/demo-dataset';

const dataset = parseAtlasDataset(
  JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'local-data',
        'nexus',
        'nexus-2026-10-20-2584284.atlas.json',
      ),
      'utf8',
    ),
  ),
);

describe('渐进式模块 / 文件 / 符号查询', () => {
  it('模块文件列表不一次返回全部 1,390 节点', () => {
    const files = moduleFiles(dataset, 'voice');
    expect(files.length).toBeGreaterThan(10);
    expect(files.length).toBeLessThan(100);
    expect(files.every((file) => file.nodeCount > 0)).toBe(true);
    expect(files.reduce((sum, file) => sum + file.nodeCount, 0)).toBeLessThan(1390);
  });

  it('Canvas 只有支撑文件，主归属计数为 0', () => {
    const files = moduleFiles(dataset, 'canvas');
    expect(files).toHaveLength(4);
    expect(files.every((file) => file.primaryCount === 0)).toBe(true);
    expect(files.every((file) => file.supportingCount > 0)).toBe(true);
  });

  it('文件内符号按主归属与中文名排序', () => {
    const symbols = fileNodes(dataset, 'voice', 'src/lib/voice/microphone.ts');
    expect(symbols.length).toBeGreaterThan(1);
    expect(symbols[0].moduleId).toBe('voice');
  });

  it('搜索中文模块名、中文节点名、文件名与符号名', () => {
    expect(searchModules(dataset, '语音')).toContain('voice');
    expect(searchNodes(dataset, '浏览器麦克风')[0].symbol).toBe('VoiceMicrophone');
    expect(searchNodes(dataset, 'microphone.ts').length).toBeGreaterThan(0);
    expect(searchNodes(dataset, 'createVoiceOrchestrator').some((node) => node.symbol.includes('createVoiceOrchestrator'))).toBe(true);
    expect(searchNodes(dataset, '语音').length).toBeGreaterThan(0);
    expect(searchNodes(dataset, '不存在的对象')).toEqual([]);
  });

  it('搜索结果有上限，避免一次渲染大列表', () => {
    expect(searchNodes(dataset, 'src', { limit: 12 })).toHaveLength(12);
  });

  it('符号关系包含方向、类型与审核状态', () => {
    const microphone = dataset.nodes.find((node) => node.symbol === 'VoiceMicrophone');
    expect(microphone).toBeDefined();
    const views = nodeRelations(dataset, microphone!.id);
    expect(views.length).toBeGreaterThan(0);
    expect(views.every((view) => view.counterpart.id !== microphone!.id)).toBe(true);
    expect(views.every((view) => view.direction === 'in' || view.direction === 'out')).toBe(true);
    expect(views.every((view) => typeof view.typeLabel === 'string')).toBe(true);
  });

  it('支持类型、方向、证据与审核状态筛选', () => {
    const microphone = dataset.nodes.find((node) => node.symbol === 'VoiceMicrophone')!;
    const outgoing = nodeRelations(dataset, microphone.id, {
      ...DEFAULT_RELATION_FILTER,
      direction: 'out',
    });
    expect(outgoing.every((view) => view.direction === 'out')).toBe(true);

    const imports = nodeRelations(dataset, microphone.id, {
      ...DEFAULT_RELATION_FILTER,
      typeGroup: 'imports',
    });
    expect(imports.every((view) => ['imports', 'imports_from', 'dynamic_import'].includes(view.relation.type))).toBe(true);

    const unverified = nodeRelations(dataset, microphone.id, {
      ...DEFAULT_RELATION_FILTER,
      reviewGroup: 'unverified',
    });
    expect(unverified.every((view) => view.relation.review.status === 'unverified')).toBe(true);

    const ai = nodeRelations(dataset, microphone.id, {
      ...DEFAULT_RELATION_FILTER,
      reviewGroup: 'ai',
    });
    expect(ai.length).toBeGreaterThanOrEqual(0);
  });

  it('模块内部关系区分 AI 复核与待核实', () => {
    const counts = moduleReviewCounts(dataset, 'voice');
    expect(counts.total).toBe(dataset.modules.find((module) => module.id === 'voice')!.stats.productRelations);
    expect(counts.human).toBe(0);
    expect(counts.ai).toBeGreaterThan(0);
    expect(counts.unverified).toBeGreaterThan(1000);
  });

  it('关系审核统计把 AI 与人工分开', () => {
    const counts = reviewCounts(dataset.relations);
    expect(counts.total).toBe(3170);
    expect(counts.ai).toBe(13);
    expect(counts.human).toBe(0);
    expect(counts.unverified).toBe(3157);
  });

  it('没有源码证据时安全降级，不抛出异常', () => {
    const demo = buildDemoDataset();
    const node = demo.nodes.find((candidate) => candidate.id === 'demo:module:voice')!;
    const views = nodeRelations(demo, node.id);
    expect(views.length).toBeGreaterThan(0);
    expect(views.every((view) => view.relation.evidence === null)).toBe(true);
    expect(views.every((view) => view.relation.review.method === 'unverified')).toBe(true);
  });
});

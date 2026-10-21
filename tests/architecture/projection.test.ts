import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '../../src/architecture/demo-dataset';
import { parseAtlasDataset } from '../../src/architecture/dataset';
import {
  applyProjectionFilter,
  DEFAULT_PROJECTION_FILTER,
  fileProjection,
  findDatasetPath,
  findProjectionPath,
  moduleProjection,
  PROJECTION_LIMITS,
  projectionNeighbors,
  symbolProjection,
} from '../../src/architecture/projection';

const DATASET_PATH = join(process.cwd(), 'local-data', 'nexus', 'nexus-2026-10-20-2584284.atlas.json');
const dataset = parseAtlasDataset(JSON.parse(readFileSync(DATASET_PATH, 'utf8')));
const demo = buildDemoDataset();

describe('模块级 Graph Projection', () => {
  it('只生成四个模块节点，并保留每个模块的统计', () => {
    const graph = moduleProjection(dataset);
    expect(graph.level).toBe('module');
    expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes.map((node) => node.moduleId)).toEqual(['data', 'voice', 'animation', 'canvas']);
    expect(graph.nodes.find((node) => node.moduleId === 'canvas')?.distributed).toBe(true);
    expect(graph.nodes.find((node) => node.moduleId === 'voice')?.nodeCount).toBe(530);
  });

  it('跨模块边只来自有证据的关系，合计 48 条', () => {
    const graph = moduleProjection(dataset);
    expect(graph.edges).toHaveLength(3);
    expect(graph.stats.relationCount).toBe(48);
    const voiceData = graph.edges.find((edge) => edge.id === 'module-edge:voice>data');
    const dataVoice = graph.edges.find((edge) => edge.id === 'module-edge:data>voice');
    const dataAnimation = graph.edges.find((edge) => edge.id === 'module-edge:data>animation');
    expect(voiceData?.count).toBe(25);
    expect(dataVoice?.count).toBe(10);
    expect(dataAnimation?.count).toBe(13);
    expect(dataAnimation?.evidenceCounts).toMatchObject({ extracted: 11, inferred: 0, 'ai-reviewed': 2 });
    expect(dataAnimation?.unverifiedCount).toBe(11);
    expect(graph.edges.every((edge) => edge.facts.length === edge.count)).toBe(true);
    expect(
      graph.edges.every((edge) =>
        edge.facts.every((fact) => fact.locator !== null && fact.fromNodeId !== fact.toNodeId),
      ),
    ).toBe(true);
  });

  it('Canvas 没有主归属节点，因此不伪造 Canvas 模块连线', () => {
    const graph = moduleProjection(dataset);
    expect(graph.nodes.find((node) => node.moduleId === 'canvas')?.nodeCount).toBe(0);
    expect(graph.edges.some((edge) => edge.from === 'module:canvas' || edge.to === 'module:canvas')).toBe(false);
    expect(graph.notes.join(' ')).toContain('不绘制');
  });

  it('模块投影按数据集对象缓存，不会在每帧重新聚合', () => {
    expect(moduleProjection(dataset)).toBe(moduleProjection(dataset));
    expect(moduleProjection(demo)).toBe(moduleProjection(demo));
  });

  it('演示模式不生成真实关系，只保留四个模块节点', () => {
    const graph = moduleProjection(demo);
    expect(graph.simulated).toBe(true);
    expect(graph.edges).toEqual([]);
    expect(graph.stats.relationCount).toBe(0);
    expect(graph.nodes).toHaveLength(4);
  });
});

describe('文件与符号层级渐进投影', () => {
  it('文件层级限制节点数，不一次渲染全部文件或 1,390 个节点', () => {
    const graph = fileProjection(dataset, 'voice');
    expect(graph.level).toBe('file');
    expect(graph.nodes.length).toBeLessThanOrEqual(PROJECTION_LIMITS.fileNodes);
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeLessThanOrEqual(PROJECTION_LIMITS.edges);
    expect(graph.nodes.length).toBeLessThan(dataset.nodes.length);
    expect(graph.nodes.every((node) => node.sublabel.includes('/'))).toBe(true);
    expect(graph.notes.join(' ')).toContain('未显示的文件仍可在关系探索中搜索');
  });

  it('文件层级的边保留关系级证据与审核状态', () => {
    const graph = fileProjection(dataset, 'voice');
    expect(graph.edges.length).toBeGreaterThan(0);
    for (const edge of graph.edges) {
      expect(edge.count).toBeGreaterThan(0);
      expect(edge.facts.length).toBe(edge.count);
      expect(edge.samples.length).toBeLessThanOrEqual(PROJECTION_LIMITS.samples);
      expect(edge.facts.some((fact) => fact.locator !== null)).toBe(true);
    }
  });

  it('Canvas 文件层级包含四个支撑文件，并明确是分布式能力集合', () => {
    const graph = fileProjection(dataset, 'canvas');
    expect(graph.nodes.filter((node) => node.distributed)).toHaveLength(4);
    expect(graph.nodes.length).toBeLessThanOrEqual(PROJECTION_LIMITS.fileNodes);
    expect(graph.notes.join(' ')).toContain('不能据此声称存在一个独立的 Canvas 子系统');
  });

  it('符号层级限制节点数，并解析到具体符号', () => {
    const graph = symbolProjection(dataset, 'voice', 'src/lib/voice/microphone.ts');
    expect(graph.level).toBe('symbol');
    expect(graph.nodes.length).toBeLessThanOrEqual(PROJECTION_LIMITS.symbolNodes);
    expect(graph.nodes.some((node) => node.sublabel === 'VoiceMicrophone')).toBe(true);
    expect(graph.nodes.map((node) => node.label)).toContain('浏览器麦克风');
  });

  it('关系级筛选重新计算边，不会隐藏混合证据中的 AI 复核', () => {
    const graph = moduleProjection(dataset);
    const annotated = applyProjectionFilter(graph, {
      ...DEFAULT_PROJECTION_FILTER,
      reviewGroup: 'ai',
    });
    expect(annotated.edges).toHaveLength(1);
    expect(annotated.edges[0].id).toBe('module-edge:data>animation');
    expect(annotated.edges[0].count).toBe(2);
    expect(annotated.edges[0].unverifiedCount).toBe(0);
    expect(annotated.stats.relationCount).toBe(2);

    const inferred = applyProjectionFilter(graph, {
      ...DEFAULT_PROJECTION_FILTER,
      evidenceClass: 'inferred',
    });
    expect(inferred.edges).toEqual([]);
    expect(inferred.nodes).toHaveLength(4);
    expect(inferred.notes.join(' ')).toContain('孤立节点仍保留');
  });

  it('上游 / 下游查询只返回当前投影中的边', () => {
    const graph = moduleProjection(dataset);
    const downstream = projectionNeighbors(graph, 'module:data', 'out');
    const upstream = projectionNeighbors(graph, 'module:data', 'in');
    expect(downstream.map((item) => item.node.id)).toEqual(['module:animation', 'module:voice']);
    expect(upstream.map((item) => item.node.id)).toEqual(['module:voice']);
  });
});

describe('路径查询', () => {
  it('在投影内找到既有路径，并明确不是运行时顺序', () => {
    const graph = moduleProjection(dataset);
    const path = findProjectionPath(graph, 'module:voice', 'module:animation');
    expect(path).not.toBeNull();
    expect(path?.nodeIds).toEqual(['module:voice', 'module:data', 'module:animation']);
    expect(path?.edgeIds).toHaveLength(2);
    expect(path?.note).toContain('不表示运行时调用顺序');
  });

  it('没有边时返回 null，由界面提示“未发现关系路径”', () => {
    const graph = moduleProjection(demo);
    expect(findProjectionPath(graph, 'module:voice', 'module:canvas')).toBeNull();
  });

  it('全数据集路径可跨文件查询，并保留每一步关系', () => {
    const microphone = dataset.nodes.find((node) => node.symbol === 'VoiceMicrophone')!;
    const pcmPlayer = dataset.nodes.find((node) => node.symbol === 'PcmPlayer')!;
    const path = findDatasetPath(dataset, microphone.id, pcmPlayer.id, { maxDepth: 3 });
    expect(path).not.toBeNull();
    expect(path?.nodes[0].id).toBe(microphone.id);
    expect(path?.nodes[path.nodes.length - 1].id).toBe(pcmPlayer.id);
    expect(path?.steps[0].relation).toBeNull();
    expect(path?.steps.slice(1).every((step) => step.relation !== null)).toBe(true);
    expect(path?.note).toContain('不表示运行时调用顺序');
  });

  it('超出深度或不存在节点时安全返回 null', () => {
    const microphone = dataset.nodes.find((node) => node.symbol === 'VoiceMicrophone')!;
    const pcmPlayer = dataset.nodes.find((node) => node.symbol === 'PcmPlayer')!;
    expect(findDatasetPath(dataset, microphone.id, pcmPlayer.id, { maxDepth: 0 })).toBeNull();
    expect(findDatasetPath(dataset, microphone.id, 'missing-node')).toBeNull();
  });
});

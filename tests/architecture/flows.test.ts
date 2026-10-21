import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '../../src/architecture/demo-dataset';
import { parseAtlasDataset } from '../../src/architecture/dataset';
import { buildFlowView, flowForModule, flowViewsFor } from '../../src/architecture/flows';
import { AtlasDataError } from '../../src/architecture/schema';

const DATASET_PATH = join(process.cwd(), 'local-data', 'nexus', 'nexus-2026-10-20-2584284.atlas.json');
const raw = JSON.parse(readFileSync(DATASET_PATH, 'utf8'));
const dataset = parseAtlasDataset(raw);

describe('按流程理解', () => {
  it('流程场景来自本地数据，步骤全部解析到真实节点', () => {
    expect(dataset.flows).toHaveLength(1);
    const view = buildFlowView(dataset, dataset.flows[0]);
    expect(view.steps).toHaveLength(7);
    expect(view.steps.every((step) => step.resolved)).toBe(true);
    expect(view.steps.every((step) => step.review?.method === 'ai-source-review')).toBe(true);
    expect(view.steps.every((step) => step.evidenceLocator !== null)).toBe(true);
    expect(view.steps.map((step) => step.step.title)).toEqual([
      '麦克风采集',
      '会话状态机',
      '协议解析',
      '服务端编排',
      '语音合成缓存',
      'PCM 播放',
      '覆盖层视觉呈现',
    ]);
  });

  it('只把有图边的步骤衔接标为 linked，缺口不自动补全', () => {
    const view = buildFlowView(dataset, dataset.flows[0]);
    expect(view.linkedCount).toBe(4);
    expect(view.gapCount).toBe(2);
    expect(view.unresolvedCount).toBe(0);
    expect(view.transitions.map((transition) => transition.status)).toEqual([
      'linked',
      'linked',
      'linked',
      'linked',
      'gap',
      'gap',
    ]);
    for (const transition of view.transitions) {
      if (transition.status === 'linked') {
        expect(transition.relations.length).toBeGreaterThan(0);
        expect(transition.note).toContain('不代表运行时调用顺序');
      } else {
        expect(transition.relations).toEqual([]);
        expect(transition.note).toContain('未记录');
      }
    }
  });

  it('流程审核记录标明 AI 源码复核，不是人工审核', () => {
    const scenario = dataset.flows[0];
    expect(scenario.review.method).toBe('ai-source-review');
    expect(scenario.review.status).toBe('verified');
    expect(scenario.review.actor).toContain('DeepSeek');
    expect(scenario.review.evidence).toHaveLength(7);
    expect(scenario.disclaimer).toContain('不代表已验证的运行时调用顺序');
  });

  it('演示模式没有本地流程，不自动生成业务流程', () => {
    const demo = buildDemoDataset();
    expect(demo.flows).toEqual([]);
    expect(flowViewsFor(demo)).toEqual([]);
    expect(flowForModule(demo, 'voice')).toBeNull();
  });

  it('引用不存在节点的流程场景会被导入校验拒绝', () => {
    const broken = JSON.parse(JSON.stringify(raw));
    broken.flows[0].steps[0].file = 'src/does-not-exist.ts';
    expect(() => parseAtlasDataset(broken)).toThrowError(AtlasDataError);
    expect(() => parseAtlasDataset(broken)).toThrow(/不存在的源码节点/);
  });

  it('步骤模块与节点归属不一致时也会被拒绝', () => {
    const broken = JSON.parse(JSON.stringify(raw));
    broken.flows[0].steps[0].moduleId = 'canvas';
    expect(() => parseAtlasDataset(broken)).toThrow(/不存在的源码节点/);
  });
});

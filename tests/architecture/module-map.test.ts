import { describe, expect, it } from 'vitest';
import {
  classifyNode,
  classifyScope,
  MODULE_DEFINITIONS,
  primaryModuleFor,
  supportingModulesFor,
} from '../../src/architecture/module-map';

describe('中文模块归类规则', () => {
  it('按路径识别语音与动画模块', () => {
    expect(primaryModuleFor('src\\lib\\voice\\microphone.ts')).toBe('voice');
    expect(primaryModuleFor('services/voice-orchestrator/src/orchestrator.ts')).toBe('voice');
    expect(primaryModuleFor('src/components/screen/motion/MotionDirector.ts')).toBe('animation');
    expect(primaryModuleFor('src/lib/use-reduced-motion.ts')).toBe('animation');
  });

  it('按路径识别经营数据模块', () => {
    expect(primaryModuleFor('src/components/screen/KpiRail.tsx')).toBe('data');
    expect(primaryModuleFor('src/lib/public-screen-payload.ts')).toBe('data');
    expect(primaryModuleFor('src/app/screen/sales/page.tsx')).toBe('data');
  });

  it('Canvas 没有主归属，只做支撑标记', () => {
    expect(primaryModuleFor('src/components/overlay/JarvisCore.tsx')).toBe('voice');
    expect(supportingModulesFor('src/components/overlay/JarvisCore.tsx')).toEqual(['canvas']);
    expect(primaryModuleFor('src/components/screen/ScreenStage.tsx')).toBe('data');
    expect(supportingModulesFor('src/components/screen/ScreenStage.tsx')).toEqual(['canvas']);
    expect(primaryModuleFor('src/lib/voice/params.ts')).toBe('voice');
    expect(supportingModulesFor('src/lib/voice/params.ts')).toContain('canvas');
  });

  it('模块判定不使用 Community 编号', () => {
    const voiceNode = classifyNode({
      sourceFile: 'src/lib/voice/microphone.ts',
      external: false,
      fileType: 'code',
      label: 'VoiceMicrophone',
      callable: true,
      callableClass: true,
    });
    const dataNode = classifyNode({
      sourceFile: 'src/components/screen/KpiRail.tsx',
      external: false,
      fileType: 'code',
      label: 'KpiRail()',
      callable: true,
      callableClass: false,
    });
    expect(voiceNode.moduleId).toBe('voice');
    expect(dataNode.moduleId).toBe('data');
  });

  it('区分产品、测试与工具代码', () => {
    expect(classifyScope('src/lib/voice/microphone.ts')).toBe('product');
    expect(classifyScope('src/lib/voice/microphone.test.ts')).toBe('test');
    expect(classifyScope('e2e/voice-ownership.spec.ts')).toBe('test');
    expect(classifyScope('scripts/p1-5-a/benchmark.mjs')).toBe('tooling');
    expect(classifyScope(null)).toBe('external');
  });

  it('四个模块都有规则、说明与源码证据', () => {
    expect(MODULE_DEFINITIONS).toHaveLength(4);
    for (const module of MODULE_DEFINITIONS) {
      expect(module.rule.length).toBeGreaterThan(10);
      expect(module.description.length).toBeGreaterThan(10);
      expect(module.evidence.length).toBeGreaterThan(0);
      expect(['verified', 'partially_verified', 'unverified']).toContain(module.review);
    }
  });

  it('Canvas 明确标记为部分核实', () => {
    const canvas = MODULE_DEFINITIONS.find((module) => module.id === 'canvas');
    expect(canvas?.review).toBe('partially_verified');
    expect(canvas?.primaryPrefixes).toEqual([]);
    expect(canvas?.supportingFiles).toHaveLength(4);
  });
});

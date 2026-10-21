import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAtlasDataset } from '../../src/architecture/dataset';
import { explainFile, explainModule, explainNode } from '../../src/architecture/plain';

const DATASET_PATH = join(process.cwd(), 'local-data', 'nexus', 'nexus-2026-10-20-2584284.atlas.json');
const dataset = parseAtlasDataset(JSON.parse(readFileSync(DATASET_PATH, 'utf8')));

describe('普通用户中文解释层', () => {
  it('模块解释包含负责什么、为什么需要、已记录联系与待确认', () => {
    const explanation = explainModule(dataset, 'voice');
    expect(explanation).not.toBeNull();
    expect(explanation?.what).toContain('让用户可以用语音提问');
    expect(explanation?.why).toContain('语音是更直接的提问方式');
    expect(explanation?.connectionSummary).toContain('静态关系');
    expect(explanation?.connections.length).toBeGreaterThan(0);
    expect(explanation?.connections.every((connection) => connection.note.includes('不代表运行时'))).toBe(true);
    expect(explanation?.uncertain.length).toBeGreaterThanOrEqual(2);
    expect(explanation?.verifiedChinese).toBe(true);
    expect(explanation?.reviewLabel).toContain('AI 源码复核');
  });

  it('已核对符号的“做什么”来自源码职责，技术标识留在可展开信息中', () => {
    const microphone = dataset.nodes.find((node) => node.symbol === 'VoiceMicrophone');
    expect(microphone).toBeDefined();
    const explanation = explainNode(dataset, microphone!.id);
    expect(explanation?.title).toBe('浏览器麦克风');
    expect(explanation?.what).toContain('麦克风权限');
    expect(explanation?.why).toContain('语音');
    expect(explanation?.verifiedChinese).toBe(true);
    expect(explanation?.technical.file).toBe('src/lib/voice/microphone.ts');
    expect(explanation?.technical.symbol).toBe('VoiceMicrophone');
    expect(explanation?.what).not.toContain('src/lib/voice/');
  });

  it('未收录中文职责的符号不会被自动生成解释', () => {
    const unannotated = dataset.nodes.find(
      (node) => node.displayName === null && node.scope === 'product' && node.kind === 'symbol',
    );
    expect(unannotated).toBeDefined();
    const explanation = explainNode(dataset, unannotated!.id);
    expect(explanation?.verifiedChinese).toBe(false);
    expect(explanation?.what).toContain('不自动生成');
    expect(explanation?.uncertain.some((item) => item.includes('尚未经源码核对'))).toBe(true);
  });

  it('文件解释引用已核对组件，不把文件路径放进默认中文说明', () => {
    const explanation = explainFile(dataset, 'voice', 'src/lib/voice/microphone.ts');
    expect(explanation).not.toBeNull();
    expect(explanation?.what).toContain('浏览器麦克风');
    expect(explanation?.why).toContain('语音');
    expect(explanation?.verifiedChinese).toBe(true);
    expect(explanation?.what).not.toContain('src/lib/voice/');
    expect(explanation?.technical.file).toBe('src/lib/voice/microphone.ts');
  });

  it('没有关系的对象明确说“未记录”，而不是“没有依赖”', () => {
    const explanation = explainNode(dataset, dataset.nodes.find((node) => node.symbol === 'VoiceMicrophone')!.id);
    expect(explanation?.connectionSummary).toMatch(/静态关系|没有记录/);
    expect(explanation?.connectionSummary).not.toContain('没有依赖');
  });
});

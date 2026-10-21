import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crossModuleSummary, parseAtlasDataset, serializeAtlasDataset } from '../../src/architecture/dataset';
import { auditDatasetPrivacy } from '../../src/architecture/privacy';

const DATASET_PATH = join(
  process.cwd(),
  'local-data',
  'nexus',
  'nexus-2026-10-20-2584284.atlas.json',
);

const dataset = parseAtlasDataset(JSON.parse(readFileSync(DATASET_PATH, 'utf8')));

describe('NEXUS 历史快照导入结果（1,390 节点规模）', () => {
  it('保留全部节点与关系，不靠删关系降复杂度', () => {
    expect(dataset.nodes).toHaveLength(1390);
    expect(dataset.relations).toHaveLength(3170);
    expect(dataset.snapshot?.stats.uniqueRelationPairs).toBe(3097);
    expect(dataset.snapshot?.stats.extractedRelations).toBe(3128);
    expect(dataset.snapshot?.stats.inferredRelations).toBe(42);
    expect(dataset.snapshot?.stats.ambiguousRelations).toBe(0);
    expect(dataset.snapshot?.stats.communities).toBe(88);
    expect(dataset.snapshot?.stats.selfReferences).toBe(16);
    expect(dataset.snapshot?.stats.danglingRelationsDropped).toBe(0);
    expect(dataset.snapshot?.stats.files).toBe(204);
  });

  it('记录历史提交、生成时间、Graphify 版本与清单校验', () => {
    expect(dataset.snapshot?.commit).toBe('2584284e3e7b994d0510d9d53b2a302e3aa740bc');
    expect(dataset.snapshot?.commitShort).toBe('2584284');
    expect(dataset.snapshot?.generatedAt).toBe('2026-10-20');
    expect(dataset.snapshot?.graphifyVersion).toBe('0.9.92');
    expect(dataset.snapshot?.graphifySchemaVersion).toBe(1);
    expect(dataset.snapshot?.atlasSchemaVersion).toBe('1.3.0');
    expect(dataset.schemaVersion).toBe('1.3.0');
    expect(dataset.snapshot?.history).toBe(true);
    expect(dataset.snapshot?.importStatus).toBe('complete');
    expect(dataset.snapshot?.manifest).toMatchObject({
      fileCount: 204,
      byteCount: 1414490,
      verifiedFiles: 204,
      status: 'verified',
    });
    expect(dataset.source.origin).toBe('file-import');
  });

  it('四个模块有可核对的主归属节点、普通用户说明与代表组件', () => {
    const modules = Object.fromEntries(dataset.modules.map((module) => [module.id, module]));
    for (const module of Object.values(modules)) {
      expect(module.summary.length).toBeGreaterThan(10);
      expect(module.responsibilities.length).toBeGreaterThanOrEqual(3);
      expect(module.gaps.length).toBeGreaterThanOrEqual(3);
      expect(module.keyComponents.length).toBeGreaterThanOrEqual(3);
      expect(module.keyComponents.length).toBeLessThanOrEqual(5);
      expect(module.reviewRecord.method).toBe('ai-source-review');
      expect(module.keyComponents.every((component) => component.review.method === 'ai-source-review')).toBe(true);
    }
    expect(modules.voice.stats.productNodes).toBe(530);
    expect(modules.voice.stats.productRelations).toBe(1190);
    expect(modules.voice.stats.communities).toBe(43);
    expect(modules.voice.review).toBe('verified');

    expect(modules.animation.stats.productNodes).toBe(68);
    expect(modules.animation.stats.productRelations).toBe(132);
    expect(modules.animation.review).toBe('verified');

    expect(modules.data.stats.productNodes).toBe(211);
    expect(modules.data.stats.productRelations).toBe(322);
    expect(modules.data.review).toBe('verified');

    expect(modules.canvas.stats.productNodes).toBe(0);
    expect(modules.canvas.stats.supportingNodes).toBe(58);
    expect(modules.canvas.review).toBe('partially_verified');
    expect(modules.canvas.summary).toContain('不是一个独立业务子系统');
  });

  it('Community 不参与模块判定：语音模块横跨 43 个 Community', () => {
    const community31 = dataset.nodes.filter((node) => node.community === 31);
    expect(community31.length).toBe(17);
    expect(community31.every((node) => node.moduleId === 'voice')).toBe(true);

    const voiceCommunities = new Set(
      dataset.nodes.filter((node) => node.moduleId === 'voice').map((node) => node.community),
    );
    expect(voiceCommunities.size).toBeGreaterThan(30);
  });

  it('按主模块去重后的跨模块关系为 48 条', () => {
    expect(crossModuleSummary(dataset)).toEqual({
      total: 48,
      pairs: [
        { from: 'data', to: 'voice', count: 35 },
        { from: 'animation', to: 'data', count: 13 },
      ],
    });
  });

  it('保留 EXTRACTED / INFERRED 与未审核状态', () => {
    const inferred = dataset.relations.filter((relation) => relation.evidenceType === 'INFERRED');
    expect(inferred).toHaveLength(42);
    expect(inferred.every((relation) => relation.confidence !== null)).toBe(true);
    const unverified = dataset.relations.filter((relation) => relation.review.status === 'unverified');
    expect(unverified).toHaveLength(3157);
    expect(dataset.relations.filter((relation) => relation.review.status === 'verified')).toHaveLength(13);
    expect(dataset.relations.filter((relation) => relation.review.method === 'ai-source-review')).toHaveLength(13);
    expect(dataset.relations.filter((relation) => relation.review.method === 'human-review')).toHaveLength(0);
    expect(dataset.diagnostics.reviewCounts).toEqual({
      aiReviewed: 13,
      humanReviewed: 0,
      graphifyExtractedUnverified: 3116,
      graphifyInferredUnverified: 41,
      unverified: 0,
    });
    const verifiedInferred = dataset.relations.filter(
      (relation) => relation.evidenceType === 'INFERRED' && relation.review.status === 'verified',
    );
    expect(verifiedInferred.length).toBeGreaterThanOrEqual(1);
    expect(verifiedInferred.every((relation) => relation.review.method === 'ai-source-review')).toBe(true);
  });

  it('中文注释只覆盖人工核对过的节点', () => {
    const annotated = dataset.nodes.filter((node) => node.displayName !== null);
    expect(annotated).toHaveLength(33);
    expect(annotated.every((node) => node.review.status === 'verified')).toBe(true);
    expect(annotated.every((node) => node.review.method === 'ai-source-review')).toBe(true);
    expect(annotated.every((node) => node.review.actor?.includes('DeepSeek'))).toBe(true);
    expect(annotated.every((node) => node.evidence.length === 1)).toBe(true);
    expect(annotated.every((node) => node.review.evidence.length === 1)).toBe(true);
    const mic = dataset.nodes.find((node) => node.symbol === 'VoiceMicrophone');
    expect(mic?.displayName).toBe('浏览器麦克风');
    expect(mic?.evidence[0].locator).toBe('src/lib/voice/microphone.ts#L15');
  });

  it('同名符号逻辑 ID 唯一且不含提交 SHA', () => {
    const ids = new Set(dataset.nodes.map((node) => node.id));
    expect(ids.size).toBe(dataset.nodes.length);
    expect(dataset.nodes.every((node) => !node.id.includes(dataset.snapshot?.commit ?? '---'))).toBe(true);

    const constructors = dataset.nodes.filter(
      (node) => node.sourceFile === 'src/lib/voice/pcm-player.ts' && node.symbol === '.constructor()',
    );
    expect(constructors).toHaveLength(2);
    expect(new Set(constructors.map((node) => node.id)).size).toBe(2);
  });

  it('不包含绝对路径、外部仓库目录或后续新增组件节点', () => {
    const text = JSON.stringify(dataset);
    expect(text).not.toMatch(/\/Users\//);
    expect(text).not.toMatch(/\/home\//);
    expect(text).not.toMatch(/C:\\\\/);
    expect(text).not.toContain('graphify-poc');
    expect(dataset.nodes.some((node) => node.symbol.includes('GsapTickerOwner'))).toBe(false);
    expect(auditDatasetPrivacy(dataset)).toMatchObject({
      status: 'pass',
      absolutePathCount: 0,
      credentialFieldCount: 0,
    });
  });

  it('CRM 与 Electron 明确标记为未接入', () => {
    const crm = dataset.systems.find((system) => system.id === 'crm');
    const electron = dataset.systems.find((system) => system.id === 'electron');
    expect(crm?.dataStatus).toBe('not_connected');
    expect(electron?.dataStatus).toBe('not_connected');
    expect(crm?.note).toMatch(/尚未接入真实架构数据/);
    expect(electron?.note).toMatch(/尚未接入真实架构数据/);
  });

  it('导出后重新导入保持一致', () => {
    const exported = serializeAtlasDataset(dataset);
    const reimported = parseAtlasDataset(JSON.parse(exported));
    expect(reimported).toEqual(dataset);
    expect(reimported.relations).toHaveLength(3170);
  });
});

describe.skipIf(!process.env.GRAPHIFY_POC_DIR)('原始 Graphify 数据重跑', () => {
  it('从 graph.json 重新转换后与已提交数据集一致', async () => {
    const { adaptGraphify } = await import('../../src/architecture/graphify-adapter');
    const root = process.env.GRAPHIFY_POC_DIR as string;
    const graph = JSON.parse(readFileSync(join(root, 'graph.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(root, 'snapshot-manifest.json'), 'utf8'));
    const regenerated = adaptGraphify({
      graph,
      manifest,
      options: {
        generatedAt: '2026-10-20',
        importedAt: dataset.snapshot?.importedAt,
        expectedCommit: dataset.snapshot?.commit,
        manifestVerification: {
          fileCount: 204,
          byteCount: 1414490,
          verifiedFiles: 204,
          verifiedAt: '2026-10-21T00:00:00.000Z',
        },
      },
    });
    expect(regenerated.nodes).toHaveLength(dataset.nodes.length);
    expect(regenerated.relations).toHaveLength(dataset.relations.length);
    expect(regenerated.modules.map((module) => module.stats.productNodes)).toEqual(
      dataset.modules.map((module) => module.stats.productNodes),
    );
    expect(regenerated.snapshot?.commit).toBe(dataset.snapshot?.commit);
  });
});

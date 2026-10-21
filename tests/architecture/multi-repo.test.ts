import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '../../src/architecture/demo-dataset';
import { parseAtlasDataset, serializeAtlasDataset } from '../../src/architecture/dataset';
import {
  crossProcessRelations,
  crossRepositoryRelations,
  isMultiRepository,
  repositorySummaries,
  summarizeDatasetCollection,
} from '../../src/architecture/multi-repo';
import { moduleProjection } from '../../src/architecture/projection';
import {
  aiReview,
  emptyReview,
  type AtlasEvidenceRef,
  type AtlasNode,
  type AtlasRelation,
  type AtlasRepositoryRecord,
} from '../../src/architecture/schema';

const COMMIT_NEXUS = 'a'.repeat(40);
const COMMIT_CRM = 'b'.repeat(40);
const IMPORTED = '2026-10-21T00:00:00.000Z';

function testNode(
  id: string,
  repository: string,
  system: 'nexus' | 'crm' | 'electron',
  file: string,
  runtimeBoundary?: AtlasNode['runtimeBoundary'],
): AtlasNode {
  return {
    id,
    sourceId: id,
    repository,
    system,
    kind: 'symbol',
    symbol: id.split('#')[1] ?? id,
    symbolType: 'function',
    sourceFile: file,
    sourceLine: 1,
    scope: 'product',
    moduleId: null,
    moduleIds: [],
    displayName: null,
    responsibility: null,
    sourceConfidence: 'EXTRACTED',
    review: emptyReview('测试节点', 'graphify-extracted'),
    community: null,
    external: false,
    runtimeBoundary: runtimeBoundary ?? null,
    metadata: {},
    evidence: [],
  };
}

function evidenceFor(repository: string, commit: string, file: string): AtlasEvidenceRef {
  return {
    repository,
    commit,
    file,
    line: 1,
    symbol: 'A',
    locator: `${file}#L1`,
  };
}

function testRelation(
  from: string,
  to: string,
  options: Partial<AtlasRelation> = {},
): AtlasRelation {
  return {
    id: `test:${from}->${to}`,
    from,
    to,
    type: 'calls',
    sourceRelation: 'calls',
    evidenceType: 'EXTRACTED',
    confidence: 1,
    review: emptyReview('测试关系', 'graphify-extracted'),
    evidence: evidenceFor('nexus', COMMIT_NEXUS, 'src/a.ts'),
    selfReference: false,
    context: null,
    flags: { deferred: false, typeOnly: false },
    sourceIndex: 0,
    ...options,
  };
}

function repository(
  id: 'nexus' | 'crm',
  system: 'nexus' | 'crm',
  commit: string,
  snapshotId: string,
  commitShort: string,
): AtlasRepositoryRecord {
  return {
    id,
    name: id === 'nexus' ? 'NEXUS' : 'CRM',
    system,
    snapshots: [
      {
        snapshotId,
        snapshotKey: `${id}@${commitShort}@2026-10-21`,
        commit,
        commitShort,
        scannedAt: null,
        generatedAt: '2026-10-21',
        importedAt: IMPORTED,
        graphifyVersion: '0.9.92',
        nodeCount: 1,
        relationCount: 0,
        history: true,
      },
    ],
  };
}

function multiRepoFixture(): Record<string, unknown> {
  const demo = buildDemoDataset();
  const raw = JSON.parse(serializeAtlasDataset(demo)) as Record<string, unknown>;
  raw.source = {
    kind: 'graphify',
    label: '测试多仓库',
    detail: '仅用于 Schema 兼容性测试',
    simulated: false,
    snapshotId: 'nexus-test',
    origin: 'file-import',
  };
  raw.snapshot = {
    id: 'nexus-test',
    repository: { id: 'nexus', name: 'NEXUS' },
    commit: COMMIT_NEXUS,
    commitShort: 'aaaaaaa',
    generatedAt: '2026-10-21',
    importedAt: IMPORTED,
    graphifyVersion: '0.9.92',
    graphifySchemaVersion: 1,
    atlasSchemaVersion: '1.3.0',
    history: true,
    importStatus: 'complete',
    stats: { nodes: 2, relations: 1, files: 2, communities: 0 },
    manifest: null,
    notes: [],
  };
  raw.repositories = [
    repository('nexus', 'nexus', COMMIT_NEXUS, 'nexus-test', 'aaaaaaa'),
    repository('crm', 'crm', COMMIT_CRM, 'crm-test', 'bbbbbbb'),
  ];
  raw.nodes = [
    testNode('nexus:src/a.ts#A', 'nexus', 'nexus', 'src/a.ts', 'browser-renderer'),
    testNode('crm:src/b.ts#B', 'crm', 'crm', 'src/b.ts'),
  ];
  raw.relations = [];
  raw.flows = [];
  return raw;
}

describe('多仓库 Schema 兼容性', () => {
  it('单仓库 1.3 数据登记一个仓库与一个快照标识', () => {
    const source = JSON.parse(serializeAtlasDataset(buildDemoDataset()));
    expect(source.repositories).toEqual([]);
    const current = parseAtlasDataset(
      JSON.parse(
        readFileSync(
          join(process.cwd(), 'local-data', 'nexus', 'nexus-2026-10-20-2584284.atlas.json'),
          'utf8',
        ),
      ),
    );
    expect(current.repositories).toHaveLength(1);
    expect(current.repositories?.[0].snapshots[0].snapshotKey).toBe('nexus@2584284@2026-10-20');
    expect(isMultiRepository(current)).toBe(false);
    expect(crossRepositoryRelations(current)).toEqual([]);
    expect(crossProcessRelations(current)).toEqual([]);
  });

  it('两个仓库可以同时登记，节点 ID 必须带各自的仓库前缀', () => {
    const fixture = multiRepoFixture();
    const dataset = parseAtlasDataset(fixture);
    expect(isMultiRepository(dataset)).toBe(true);
    expect(repositorySummaries(dataset).map((summary) => summary.repository.id).sort()).toEqual([
      'crm',
      'nexus',
    ]);
    expect(repositorySummaries(dataset).find((summary) => summary.repository.id === 'crm')?.nodeCount).toBe(1);
    const collection = summarizeDatasetCollection([dataset]);
    expect(collection.snapshots).toHaveLength(2);
    expect(collection.duplicateSnapshotKeys).toEqual([]);

    const bad = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
    (bad.nodes as Record<string, unknown>[])[1].id = 'nexus:src/b.ts#B';
    expect(() => parseAtlasDataset(bad)).toThrow(/仓库前缀/);
  });

  it('跨仓库关系必须显式标记并提供接口/协议证据', () => {
    const missingScope = multiRepoFixture();
    (missingScope.relations as Record<string, unknown>[]).push(
      testRelation('nexus:src/a.ts#A', 'crm:src/b.ts#B'),
    );
    expect(() => parseAtlasDataset(missingScope)).toThrow(/cross-repository/);

    const unreviewed = multiRepoFixture();
    (unreviewed.relations as Record<string, unknown>[]).push(
      testRelation('nexus:src/a.ts#A', 'crm:src/b.ts#B', {
        scope: 'cross-repository',
        evidence: evidenceFor('nexus', COMMIT_NEXUS, 'src/a.ts'),
      }),
    );
    expect(() => parseAtlasDataset(unreviewed)).toThrow(/接口\/协议证据/);

    const valid = multiRepoFixture();
    (valid.relations as Record<string, unknown>[]).push(
      testRelation('nexus:src/a.ts#A', 'crm:src/b.ts#B', {
        scope: 'cross-repository',
        evidence: evidenceFor('nexus', COMMIT_NEXUS, 'src/a.ts'),
        review: aiReview('接口契约测试', [evidenceFor('nexus', COMMIT_NEXUS, 'src/a.ts')], {
          actor: '测试',
          reviewedAt: '2026-10-21',
        }),
      }),
    );
    const dataset = parseAtlasDataset(valid);
    expect(crossRepositoryRelations(dataset)).toHaveLength(1);
    // 跨仓库关系不应改变 NEXUS 的四个模块星图。
    expect(moduleProjection(dataset).nodes).toHaveLength(4);
    expect(moduleProjection(dataset).edges).toEqual([]);
  });

  it('不同运行时之间必须标记 cross-process，运行时验证必须有证据', () => {
    const fixture = multiRepoFixture();
    (fixture.nodes as Record<string, unknown>[]).push(
      testNode('nexus:src/c.ts#C', 'nexus', 'nexus', 'src/c.ts', 'node-service'),
    );
    (fixture.relations as Record<string, unknown>[]).push(
      testRelation('nexus:src/a.ts#A', 'nexus:src/c.ts#C'),
    );
    expect(() => parseAtlasDataset(fixture)).toThrow(/cross-process/);

    (fixture.relations as Record<string, unknown>[])[0] = testRelation(
      'nexus:src/a.ts#A',
      'nexus:src/c.ts#C',
      {
        scope: 'cross-process',
        runtimeVerified: true,
      },
    );
    expect(() => parseAtlasDataset(fixture)).toThrow(/runtimeEvidence/);

    (fixture.relations as Record<string, unknown>[])[0] = testRelation(
      'nexus:src/a.ts#A',
      'nexus:src/c.ts#C',
      {
        scope: 'cross-process',
        runtimeVerified: true,
        runtimeEvidence: [evidenceFor('nexus', COMMIT_NEXUS, 'src/a.ts')],
      },
    );
    const dataset = parseAtlasDataset(fixture);
    expect(crossProcessRelations(dataset)).toHaveLength(1);
  });

  it('重复快照标识会被多数据集索引发现', () => {
    const dataset = parseAtlasDataset(multiRepoFixture());
    const collection = summarizeDatasetCollection([dataset, dataset]);
    expect(collection.duplicateSnapshotKeys).toEqual([
      'crm@bbbbbbb@2026-10-21',
      'nexus@aaaaaaa@2026-10-21',
    ]);
  });
});

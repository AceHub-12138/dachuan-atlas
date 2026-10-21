import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '../../src/architecture/demo-dataset';
import { parseAtlasDataset, serializeAtlasDataset } from '../../src/architecture/dataset';
import {
  confirmedCrossRepositoryRelations,
  crossProcessRelations,
  crossRepositoryCrossProcessRelations,
  crossRepositoryRelations,
  datasetSnapshotKey,
  intraRepositoryCrossProcessRelations,
  isMultiRepository,
  relationScopeCounts,
  repositorySummaries,
  scopedRelationId,
  summarizeDatasetCollection,
} from '../../src/architecture/multi-repo';
import { moduleProjection, primaryRepository } from '../../src/architecture/projection';
import {
  aiReview,
  emptyReview,
  type AtlasContractEvidenceRef,
  type AtlasEvidenceRef,
  type AtlasNode,
  type AtlasRelation,
  type AtlasRepositoryRecord,
  type AtlasRuntimeEvidenceRef,
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
  moduleId: string | null = null,
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
    moduleId,
    moduleIds: moduleId ? [moduleId] : [],
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

function contractFor(
  repository: string,
  commit: string,
  file = 'contracts/openapi.yaml',
): AtlasContractEvidenceRef {
  return { ...evidenceFor(repository, commit, file), kind: 'api-contract', note: '测试契约' };
}

function runtimeFor(
  repository: string,
  commit: string,
  file = 'logs/runtime.log',
  kind: AtlasRuntimeEvidenceRef['kind'] = 'runtime-trace',
): AtlasRuntimeEvidenceRef {
  return { ...evidenceFor(repository, commit, file), kind, note: '测试运行时记录' };
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
    repositoryScope: 'intra-repository',
    runtimeScope: 'unknown',
    runtimeVerified: false,
    runtimeEvidence: [],
    interfaceEvidence: [],
    legacyScope: null,
    scopeNote: null,
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
    atlasSchemaVersion: '1.4.0',
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
  (raw.modules as Record<string, unknown>[]).forEach((module) => {
    module.repository = 'nexus';
    module.system = 'nexus';
  });
  raw.nodes = [
    testNode('nexus:src/a.ts#A', 'nexus', 'nexus', 'src/a.ts', 'browser-renderer'),
    testNode('crm:src/b.ts#B', 'crm', 'crm', 'src/b.ts'),
  ];
  raw.relations = [];
  raw.flows = [];
  return raw;
}

function legacyFixture(version = '1.3.0'): Record<string, unknown> {
  const fixture = multiRepoFixture();
  fixture.schemaVersion = version;
  delete fixture.scopeMigration;
  for (const node of fixture.nodes as Record<string, unknown>[]) {
    delete node.runtimeBoundary;
  }
  return fixture;
}

const NEXUS_A = 'nexus:src/a.ts#A';
const NEXUS_C = 'nexus:src/c.ts#C';
const CRM_B = 'crm:src/b.ts#B';

describe('多仓库与运行时双维度作用域', () => {
  it('单仓库 1.3 数据登记一个仓库、一个快照，并迁移为 1.4', () => {
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
    expect(current.schemaVersion).toBe('1.4.0');
    expect(current.schemaMigratedFrom).toBe('1.3.0');
    expect(isMultiRepository(current)).toBe(false);
    expect(crossRepositoryRelations(current)).toEqual([]);
    expect(crossProcessRelations(current)).toEqual([]);
    expect(current.relations.every((relation) => relation.runtimeScope === 'unknown')).toBe(true);
    expect(current.relations.every((relation) => relation.runtimeVerified === false)).toBe(true);
    expect(current.scopeMigration?.relations).toBe(3170);
    expect(current.scopeMigration?.runtimeScopes.unknown).toBe(3170);
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

  it('跨仓库 + 跨运行时可以同时成立，不被拆成互斥枚举', () => {
    const fixture = multiRepoFixture();
    (fixture.nodes as Record<string, unknown>[])[1] = testNode(
      CRM_B,
      'crm',
      'crm',
      'src/b.ts',
      'node-service',
    );
    (fixture.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, CRM_B, {
        repositoryScope: 'cross-repository',
        runtimeScope: 'cross-runtime',
        runtimeVerified: true,
        runtimeEvidence: [runtimeFor('crm', COMMIT_CRM)],
        interfaceEvidence: [contractFor('crm', COMMIT_CRM)],
        review: aiReview('接口契约与运行时 trace 已核对', [evidenceFor('crm', COMMIT_CRM, 'contracts/openapi.yaml')], {
          actor: '测试',
          reviewedAt: '2026-10-21',
        }),
      }),
    );
    const dataset = parseAtlasDataset(fixture);
    const relation = dataset.relations[0];
    expect(relation.repositoryScope).toBe('cross-repository');
    expect(relation.runtimeScope).toBe('cross-runtime');
    expect(crossRepositoryRelations(dataset)).toHaveLength(1);
    expect(crossProcessRelations(dataset)).toHaveLength(1);
    expect(crossRepositoryCrossProcessRelations(dataset)).toHaveLength(1);
    expect(confirmedCrossRepositoryRelations(dataset)).toHaveLength(1);
    expect(relationScopeCounts(dataset)).toMatchObject({
      crossRepository: 1,
      crossRuntime: 1,
      unknownRuntime: 0,
      runtimeVerified: 1,
    });
    // 跨仓库关系不进入 NEXUS 四模块星图。
    expect(moduleProjection(dataset).nodes).toHaveLength(4);
    expect(moduleProjection(dataset).edges).toEqual([]);
  });

  it('同一仓库也可以存在跨运行时关系', () => {
    const fixture = multiRepoFixture();
    (fixture.nodes as Record<string, unknown>[]).push(
      testNode(NEXUS_C, 'nexus', 'nexus', 'src/c.ts', 'node-service'),
    );
    (fixture.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, NEXUS_C, {
        repositoryScope: 'intra-repository',
        runtimeScope: 'cross-runtime',
        runtimeVerified: false,
      }),
    );
    const dataset = parseAtlasDataset(fixture);
    expect(crossRepositoryRelations(dataset)).toEqual([]);
    expect(crossProcessRelations(dataset)).toHaveLength(1);
    expect(intraRepositoryCrossProcessRelations(dataset)).toHaveLength(1);
    expect(crossRepositoryCrossProcessRelations(dataset)).toEqual([]);
  });

  it('跨仓库不自动等于跨运行时；边界未知时保持 unknown', () => {
    const fixture = multiRepoFixture();
    (fixture.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, CRM_B, {
        repositoryScope: 'cross-repository',
        runtimeScope: 'unknown',
        interfaceEvidence: [contractFor('crm', COMMIT_CRM)],
        review: aiReview('接口契约已核对', [evidenceFor('crm', COMMIT_CRM, 'contracts/openapi.yaml')], {
          actor: '测试',
          reviewedAt: '2026-10-21',
        }),
      }),
    );
    const dataset = parseAtlasDataset(fixture);
    expect(crossRepositoryRelations(dataset)).toHaveLength(1);
    expect(crossProcessRelations(dataset)).toEqual([]);
    expect(dataset.relations[0].runtimeScope).toBe('unknown');
    expect(relationScopeCounts(dataset).unknownRuntime).toBe(1);
  });

  it('运行时边界未知时，不得推断为同进程', () => {
    const fixture = multiRepoFixture();
    (fixture.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, CRM_B, {
        repositoryScope: 'cross-repository',
        runtimeScope: 'intra-runtime',
        interfaceEvidence: [contractFor('crm', COMMIT_CRM)],
        review: aiReview('接口契约已核对', [evidenceFor('crm', COMMIT_CRM, 'contracts/openapi.yaml')], {
          actor: '测试',
          reviewedAt: '2026-10-21',
        }),
      }),
    );
    expect(() => parseAtlasDataset(fixture)).toThrow(/不能推断为 intra-runtime/);

    const crossWithoutEvidence = multiRepoFixture();
    (crossWithoutEvidence.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, CRM_B, {
        repositoryScope: 'cross-repository',
        runtimeScope: 'cross-runtime',
        interfaceEvidence: [contractFor('crm', COMMIT_CRM)],
        review: aiReview('接口契约已核对', [evidenceFor('crm', COMMIT_CRM, 'contracts/openapi.yaml')], {
          actor: '测试',
          reviewedAt: '2026-10-21',
        }),
      }),
    );
    expect(() => parseAtlasDataset(crossWithoutEvidence)).toThrow(/必须提供带类型的 runtimeEvidence/);
  });

  it('AI 源码复核不等于运行时已验证；runtimeVerified 必须有带类型的运行时证据与复核', () => {
    const sameRepo = multiRepoFixture();
    (sameRepo.nodes as Record<string, unknown>[]).push(
      testNode(NEXUS_C, 'nexus', 'nexus', 'src/c.ts', 'node-service'),
    );
    const base = testRelation(NEXUS_A, NEXUS_C, {
      repositoryScope: 'intra-repository',
      runtimeScope: 'cross-runtime',
      runtimeVerified: true,
      review: aiReview('仅做源码复核', [evidenceFor('nexus', COMMIT_NEXUS, 'src/a.ts')], {
        actor: '测试',
        reviewedAt: '2026-10-21',
      }),
    });

    (sameRepo.relations as Record<string, unknown>[]).push({ ...base });
    expect(() => parseAtlasDataset(sameRepo)).toThrow(/没有 runtimeEvidence/);

    const untyped = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    untyped.runtimeEvidence = [evidenceFor('nexus', COMMIT_NEXUS, 'src/a.ts')];
    (sameRepo.relations as Record<string, unknown>[])[0] = untyped;
    expect(() => parseAtlasDataset(sameRepo)).toThrow(/必须标注证据类型/);

    const unreviewed = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    unreviewed.runtimeEvidence = [runtimeFor('nexus', COMMIT_NEXUS)];
    unreviewed.review = emptyReview('没有复核', 'graphify-extracted');
    (sameRepo.relations as Record<string, unknown>[])[0] = unreviewed;
    expect(() => parseAtlasDataset(sameRepo)).toThrow(/必须经过 AI 或人工复核/);

    const valid = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    valid.runtimeEvidence = [runtimeFor('nexus', COMMIT_NEXUS)];
    (sameRepo.relations as Record<string, unknown>[])[0] = valid;
    const dataset = parseAtlasDataset(sameRepo);
    expect(dataset.relations[0].runtimeVerified).toBe(true);
  });

  it('未审核的跨仓库候选不能进入已确认关系图', () => {
    const candidate = multiRepoFixture();
    (candidate.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, CRM_B, {
        repositoryScope: 'cross-repository',
        runtimeScope: 'unknown',
        interfaceEvidence: [contractFor('crm', COMMIT_CRM)],
      }),
    );
    expect(() => parseAtlasDataset(candidate)).toThrow(/尚未经过 AI 或人工复核/);

    const missingContract = multiRepoFixture();
    (missingContract.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, CRM_B, {
        repositoryScope: 'cross-repository',
        runtimeScope: 'unknown',
        review: aiReview('接口已核对', [evidenceFor('nexus', COMMIT_NEXUS, 'src/a.ts')], {
          actor: '测试',
          reviewedAt: '2026-10-21',
        }),
      }),
    );
    expect(() => parseAtlasDataset(missingContract)).toThrow(/必须提供 interfaceEvidence/);
  });

  it('旧版 1.3 scope 按规则迁移，跨仓库旧边保留为候选而不是已确认', () => {
    const fixture = legacyFixture();
    (fixture.nodes as Record<string, unknown>[]).push(
      testNode(NEXUS_C, 'nexus', 'nexus', 'src/c.ts', 'node-service'),
    );
    (fixture.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, NEXUS_C, {
        legacyScope: undefined,
        scope: 'cross-process',
      } as unknown as Partial<AtlasRelation>),
    );
    const legacyRepo = multiRepoFixture();
    (legacyRepo.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, CRM_B, {
        scope: 'cross-repository',
        review: aiReview('旧版跨仓库关系', [evidenceFor('nexus', COMMIT_NEXUS, 'src/a.ts')], {
          actor: '测试',
          reviewedAt: '2026-10-21',
        }),
      } as unknown as Partial<AtlasRelation>),
    );
    legacyRepo.schemaVersion = '1.3.0';
    for (const node of legacyRepo.nodes as Record<string, unknown>[]) delete node.runtimeBoundary;

    const dataset = parseAtlasDataset(fixture);
    const migrated = dataset.relations[0];
    expect(dataset.schemaVersion).toBe('1.4.0');
    expect(dataset.schemaMigratedFrom).toBe('1.3.0');
    expect(migrated.repositoryScope).toBe('intra-repository');
    expect(migrated.runtimeScope).toBe('cross-runtime');
    expect(migrated.legacyScope).toBe('cross-process');
    expect(migrated.runtimeVerified).toBe(false);
    expect(migrated.scopeNote).toContain('cross-process');

    const legacyCross = parseAtlasDataset(legacyRepo);
    expect(legacyCross.relations[0].repositoryScope).toBe('cross-repository');
    expect(legacyCross.relations[0].interfaceEvidence).toEqual([]);
    expect(legacyCross.relations[0].scopeNote).toContain('未确认候选');
    expect(confirmedCrossRepositoryRelations(legacyCross)).toEqual([]);
  });

  it('旧版迁移结果导出为 1.4 后仍可重新导入', () => {
    const fixture = legacyFixture();
    (fixture.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, NEXUS_A, {
        id: 'legacy:cross-process',
        selfReference: true,
        scope: 'cross-process',
      } as unknown as Partial<AtlasRelation>),
    );
    (fixture.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, CRM_B, {
        id: 'legacy:cross-repo',
        scope: 'cross-repository',
        review: aiReview('旧版跨仓库关系', [evidenceFor('nexus', COMMIT_NEXUS, 'src/a.ts')], {
          actor: '测试',
          reviewedAt: '2026-10-21',
        }),
      } as unknown as Partial<AtlasRelation>),
    );
    const first = parseAtlasDataset(fixture);
    const second = parseAtlasDataset(JSON.parse(serializeAtlasDataset(first)));
    expect(second).toEqual(first);
    expect(second.relations.every((relation) => relation.legacyScope !== null)).toBe(true);
    expect(confirmedCrossRepositoryRelations(second)).toEqual([]);
  });

  it('旧版无边界数据迁移为 runtimeScope=unknown，不推断同进程', () => {
    const fixture = legacyFixture('1.2.0');
    (fixture.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, NEXUS_A, {
        id: 'legacy:self',
        selfReference: true,
        scope: 'intra-repository',
      } as unknown as Partial<AtlasRelation>),
    );
    const dataset = parseAtlasDataset(fixture);
    expect(dataset.relations[0].runtimeScope).toBe('unknown');
    expect(dataset.relations[0].legacyScope).toBe('intra-repository');
    expect(dataset.scopeMigration?.runtimeScopes.unknown).toBe(1);
  });

  it('旧版 runtimeVerified 缺少带类型证据时降级，但保留原始证据', () => {
    const fixture = legacyFixture();
    (fixture.nodes as Record<string, unknown>[]).push(
      testNode(NEXUS_C, 'nexus', 'nexus', 'src/c.ts', 'node-service'),
    );
    (fixture.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, NEXUS_C, {
        scope: 'cross-process',
        runtimeVerified: true,
        runtimeEvidence: [evidenceFor('nexus', COMMIT_NEXUS, 'logs/old.log')],
        review: aiReview('旧版声称已验证', [evidenceFor('nexus', COMMIT_NEXUS, 'logs/old.log')], {
          actor: '测试',
          reviewedAt: '2026-10-21',
        }),
      } as unknown as Partial<AtlasRelation>),
    );
    const dataset = parseAtlasDataset(fixture);
    expect(dataset.relations[0].runtimeVerified).toBe(false);
    expect(dataset.relations[0].runtimeEvidence).toHaveLength(1);
    expect(dataset.scopeMigration?.runtimeVerifiedDowngraded).toBe(1);
  });

  it('模块定义按仓库隔离：CRM 可以有自己的模块，但不能引用 NEXUS 模块', () => {
    const fixture = multiRepoFixture();
    (fixture.modules as Record<string, unknown>[]).push({
      id: 'customer',
      index: '01',
      name: '客户',
      latin: 'CUSTOMER',
      repository: 'crm',
      system: 'crm',
      review: 'unverified',
      reviewRecord: emptyReview('测试模块'),
      summary: '测试 CRM 模块',
      responsibilities: ['客户资料'],
      explanation: null,
      keyComponents: [],
      gaps: ['测试'],
      rule: '测试',
      description: '测试',
      notes: [],
      evidence: [],
      stats: {},
    });
    (fixture.nodes as Record<string, unknown>[])[1] = testNode(
      CRM_B,
      'crm',
      'crm',
      'src/b.ts',
      null,
      'customer',
    );
    const dataset = parseAtlasDataset(fixture);
    expect(dataset.modules.find((module) => module.id === 'customer')?.repository).toBe('crm');
    // 主仓库仍是 NEXUS，NEXUS 星图保持四个模块。
    expect(primaryRepository(dataset)).toBe('nexus');
    expect(moduleProjection(dataset).nodes).toHaveLength(4);

    const wrongModule = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
    const crmNode = (wrongModule.nodes as Record<string, unknown>[])[1];
    crmNode.moduleId = 'data';
    crmNode.moduleIds = ['data'];
    expect(() => parseAtlasDataset(wrongModule)).toThrow(/不能引用 nexus 的模块 data/);
  });

  it('关系 ID 在快照内唯一；跨快照索引使用 snapshotKey 前缀避免误合并', () => {
    const fixture = multiRepoFixture();
    (fixture.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, CRM_B, {
        repositoryScope: 'cross-repository',
        runtimeScope: 'unknown',
        interfaceEvidence: [contractFor('crm', COMMIT_CRM)],
        review: aiReview('接口契约', [evidenceFor('crm', COMMIT_CRM, 'contracts/openapi.yaml')], {
          actor: '测试',
          reviewedAt: '2026-10-21',
        }),
      }),
    );
    const dataset = parseAtlasDataset(JSON.parse(JSON.stringify(fixture)));
    const duplicate = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
    (duplicate.relations as Record<string, unknown>[]).push({
      ...(duplicate.relations as Record<string, unknown>[])[0],
    });
    expect(() => parseAtlasDataset(duplicate)).toThrow(/重复关系 ID/);

    const second = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
    second.snapshot = {
      ...(second.snapshot as Record<string, unknown>),
      id: 'nexus-test-2',
      commit: 'c'.repeat(40),
      commitShort: 'ccccccc',
      generatedAt: '2026-10-22',
    };
    const secondNexus = repository('nexus', 'nexus', 'c'.repeat(40), 'nexus-test-2', 'ccccccc');
    secondNexus.snapshots[0].generatedAt = '2026-10-22';
    secondNexus.snapshots[0].snapshotKey = 'nexus@ccccccc@2026-10-22';
    second.repositories = [
      secondNexus,
      repository('crm', 'crm', COMMIT_CRM, 'crm-test', 'bbbbbbb'),
    ];
    const secondRelation = (second.relations as Record<string, unknown>[])[0];
    secondRelation.evidence = evidenceFor('nexus', 'c'.repeat(40), 'src/a.ts');
    const secondDataset = parseAtlasDataset(second);
    expect(scopedRelationId(dataset, dataset.relations[0])).not.toBe(
      scopedRelationId(secondDataset, secondDataset.relations[0]),
    );
    expect(datasetSnapshotKey(dataset)).toBe('nexus@aaaaaaa@2026-10-21');
    expect(datasetSnapshotKey(secondDataset)).toBe('nexus@ccccccc@2026-10-22');

    const duplicateSnapshot = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
    const repositoryEntry = (duplicateSnapshot.repositories as Record<string, unknown>[])[0];
    repositoryEntry.snapshots = [
      (repositoryEntry.snapshots as Record<string, unknown>[])[0],
      {
        ...(repositoryEntry.snapshots as Record<string, unknown>[])[0],
        snapshotId: 'nexus-test-copy',
      },
    ];
    expect(() => parseAtlasDataset(duplicateSnapshot)).toThrow(/快照标识重复/);
  });

  it('导出并重新导入 1.4 数据保持双维度作用域', () => {
    const fixture = multiRepoFixture();
    (fixture.relations as Record<string, unknown>[]).push(
      testRelation(NEXUS_A, CRM_B, {
        repositoryScope: 'cross-repository',
        runtimeScope: 'unknown',
        interfaceEvidence: [contractFor('crm', COMMIT_CRM)],
        review: aiReview('接口契约', [evidenceFor('crm', COMMIT_CRM, 'contracts/openapi.yaml')], {
          actor: '测试',
          reviewedAt: '2026-10-21',
        }),
      }),
    );
    const dataset = parseAtlasDataset(fixture);
    const restored = parseAtlasDataset(JSON.parse(serializeAtlasDataset(dataset)));
    expect(restored).toEqual(dataset);
    expect(restored.relations[0]).toMatchObject({
      repositoryScope: 'cross-repository',
      runtimeScope: 'unknown',
      runtimeVerified: false,
      legacyScope: null,
    });
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
